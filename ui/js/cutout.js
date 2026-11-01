// Вырезать объект из фотки — без нейросетей и без сервера, прямо тут.
// GrabCut-lite: две смеси гауссиан по цвету (объект / фон) + сглаживание «среднего поля»
// с весами по перепаду цвета (на резких границах метка меняется легко, на ровных — нет).
// Всё на типизированных массивах — работает и в браузере, и в node (тесты).

/** тримап: 0 — точно фон, 1 — скорее фон, 2 — скорее объект, 3 — точно объект */
export const BG = 0, PBG = 1, PFG = 2, FG = 3;

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** смесь гауссиан (диагональные) по выборке пикселей; null — если пикселей нет */
function fitGMM(R, G, B, idx, n, K) {
  if (n < K * 4) K = Math.max(1, Math.floor(n / 4));
  if (n < 2) return null;
  const rnd = rng(n * 31 + K);
  // k-means++: первый центр случайный, следующие — подальше от уже выбранных
  const cx = new Float64Array(K * 3), d2 = new Float64Array(n).fill(Infinity);
  let p = idx[Math.floor(rnd() * n)];
  for (let k = 0; k < K; k++) {
    cx[k * 3] = R[p]; cx[k * 3 + 1] = G[p]; cx[k * 3 + 2] = B[p];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const q = idx[i], a = R[q] - cx[k * 3], b = G[q] - cx[k * 3 + 1], c = B[q] - cx[k * 3 + 2], d = a * a + b * b + c * c;
      if (d < d2[i]) d2[i] = d; sum += d2[i];
    }
    let t = rnd() * sum; p = idx[n - 1];
    for (let i = 0; i < n; i++) { t -= d2[i]; if (t <= 0) { p = idx[i]; break; } }
  }
  const lab = new Uint8Array(n), cnt = new Float64Array(K), acc = new Float64Array(K * 3);
  for (let it = 0; it < 7; it++) {
    cnt.fill(0); acc.fill(0);
    for (let i = 0; i < n; i++) {
      const q = idx[i], r = R[q], g = G[q], b = B[q]; let best = 0, bd = Infinity;
      for (let k = 0; k < K; k++) { const a = r - cx[k * 3], e = g - cx[k * 3 + 1], c = b - cx[k * 3 + 2], d = a * a + e * e + c * c; if (d < bd) { bd = d; best = k; } }
      lab[i] = best; cnt[best]++; acc[best * 3] += r; acc[best * 3 + 1] += g; acc[best * 3 + 2] += b;
    }
    for (let k = 0; k < K; k++) if (cnt[k]) { cx[k * 3] = acc[k * 3] / cnt[k]; cx[k * 3 + 1] = acc[k * 3 + 1] / cnt[k]; cx[k * 3 + 2] = acc[k * 3 + 2] / cnt[k]; }
  }
  const v = new Float64Array(K * 3);
  for (let i = 0; i < n; i++) { const q = idx[i], k = lab[i]; const a = R[q] - cx[k * 3], b = G[q] - cx[k * 3 + 1], c = B[q] - cx[k * 3 + 2]; v[k * 3] += a * a; v[k * 3 + 1] += b * b; v[k * 3 + 2] += c * c; }
  const m = { K: 0, c: [], m: [], iv: [] };
  for (let k = 0; k < K; k++) {
    if (!cnt[k]) continue;
    const w = cnt[k] / n; let lc = Math.log(w);
    for (let d = 0; d < 3; d++) { const vv = Math.max(v[k * 3 + d] / cnt[k], 16) + 4; lc -= 0.5 * Math.log(2 * Math.PI * vv); m.iv.push(1 / vv); m.m.push(cx[k * 3 + d]); }
    m.c.push(lc); m.K++;
  }
  return m;
}
const tmp = new Float64Array(16);
function nll(g, r, gg, b) {
  let mx = -Infinity;
  for (let k = 0; k < g.K; k++) {
    const a = r - g.m[k * 3], e = gg - g.m[k * 3 + 1], c = b - g.m[k * 3 + 2];
    const s = g.c[k] - 0.5 * (a * a * g.iv[k * 3] + e * e * g.iv[k * 3 + 1] + c * c * g.iv[k * 3 + 2]);
    tmp[k] = s; if (s > mx) mx = s;
  }
  let s = 0; for (let k = 0; k < g.K; k++) s += Math.exp(tmp[k] - mx);
  return -(mx + Math.log(s));
}

/**
 * «Связность с фоном»: геодезическое расстояние от затравок (рамка кадра или всё снаружи обводки).
 * Шум и плавные градиенты не копятся (порог τ по медиане перепадов), а край объекта — дорогой.
 */
export function geo(R, G, B, W, H, seed) {
  const N = W * H, cR = new Float32Array(N), cD = new Float32Array(N), D = new Float32Array(N);
  const hist = new Uint32Array(442); let cnt = 0;
  for (let p = 0; p < N; p++) {
    const x = p % W;
    if (x + 1 < W) { const a = R[p] - R[p + 1], b = G[p] - G[p + 1], c = B[p] - B[p + 1], d = Math.sqrt(a * a + b * b + c * c); cR[p] = d; hist[d | 0]++; cnt++; }
    if (p + W < N) { const a = R[p] - R[p + W], b = G[p] - G[p + W], c = B[p] - B[p + W], d = Math.sqrt(a * a + b * b + c * c); cD[p] = d; hist[d | 0]++; cnt++; }
  }
  let med = 0; for (let i = 0, s = 0; i < hist.length; i++) { s += hist[i]; if (s >= cnt / 2) { med = i; break; } }
  const tau = 1.3 * med + 3;
  for (let p = 0; p < N; p++) { cR[p] = Math.max(0, cR[p] - tau); cD[p] = Math.max(0, cD[p] - tau); D[p] = seed[p] ? 0 : 1e9; }
  for (let it = 0; it < 3; it++) {
    for (let p = 0; p < N; p++) { const x = p % W; let d = D[p]; if (x > 0 && D[p - 1] + cR[p - 1] < d) d = D[p - 1] + cR[p - 1]; if (p >= W && D[p - W] + cD[p - W] < d) d = D[p - W] + cD[p - W]; D[p] = d; }
    for (let p = N - 1; p >= 0; p--) { const x = p % W; let d = D[p]; if (x + 1 < W && D[p + 1] + cR[p] < d) d = D[p + 1] + cR[p]; if (p + W < N && D[p + W] + cD[p] < d) d = D[p + W] + cD[p]; D[p] = d; }
  }
  return D;
}

/**
 * rgba — пиксели W×H, tri — тримап (Uint8Array W×H).
 * Возвращает Float32Array: вероятность «это объект» для каждого пикселя.
 */
const ENV = (globalThis.process && globalThis.process.env) || {};
export function segment(rgba, W, H, tri, { iters = 4, mf = 6, gamma = +(ENV.CUT_G || 4), K = +(ENV.CUT_K || 5), maxSamples = 6000, geoW = +(ENV.CUT_GW || 1.5), geoD = +(ENV.CUT_GD || 25), geoS = +(ENV.CUT_GS || 12), autoMode = false } = {}) {
  const N = W * H, R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  for (let p = 0; p < N; p++) { R[p] = rgba[p * 4]; G[p] = rgba[p * 4 + 1]; B[p] = rgba[p * 4 + 2]; }
  // β — по среднему перепаду цвета между соседями, как в GrabCut
  let sum = 0, cnt = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (x + 1 < W) { const a = R[p] - R[p + 1], b = G[p] - G[p + 1], c = B[p] - B[p + 1]; sum += a * a + b * b + c * c; cnt++; }
    if (y + 1 < H) { const a = R[p] - R[p + W], b = G[p] - G[p + W], c = B[p] - B[p + W]; sum += a * a + b * b + c * c; cnt++; }
  }
  const beta = 1 / (2 * Math.max(sum / Math.max(cnt, 1), 1e-3));
  const wR = new Float32Array(N), wD = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (x + 1 < W) { const a = R[p] - R[p + 1], b = G[p] - G[p + 1], c = B[p] - B[p + 1]; wR[p] = gamma * Math.exp(-beta * (a * a + b * b + c * c)); }
    if (y + 1 < H) { const a = R[p] - R[p + W], b = G[p] - G[p + W], c = B[p] - B[p + W]; wD[p] = gamma * Math.exp(-beta * (a * a + b * b + c * c)); }
  }
  const mu = new Float32Array(N), U = new Float32Array(N);
  // связность с фоном: затравки — всё «точно фон», а в авто — ещё верх и бока кадра (низ — нет: там часто стоит сам объект)
  const seed = new Uint8Array(N); let ns = 0;
  for (let p = 0; p < N; p++) { const x = p % W, y = (p - x) / W; if (tri[p] === BG && (!autoMode || y < H - 1)) { seed[p] = 1; ns++; } }
  const L = new Float32Array(N);
  if (ns) { const D = geo(R, G, B, W, H, seed); for (let p = 0; p < N; p++) { const v = (D[p] - geoD) / geoS; L[p] = v > 4 ? 4 : v < -3 ? -3 : v; } }
  let nf0 = 0; for (let p = 0; p < N; p++) { mu[p] = tri[p] === FG || (tri[p] !== BG && (ns ? L[p] > 0 : tri[p] === PFG)) ? 1 : 0; nf0 += mu[p]; }
  if (nf0 < N * 0.01) for (let p = 0; p < N; p++) mu[p] = tri[p] >= PFG ? 1 : 0; // краёв не нашлось — стартую с тримапа
  const idxF = new Int32Array(Math.min(N, maxSamples)), idxB = new Int32Array(Math.min(N, maxSamples));
  const sample = (want, out) => {
    let n = 0; for (let p = 0; p < N; p++) if (want(p)) n++;
    const step = Math.max(1, n / out.length); let k = 0, i = 0, next = 0;
    for (let p = 0; p < N && k < out.length; p++) if (want(p)) { if (i >= next) { out[k++] = p; next += step; } i++; }
    return k;
  };
  for (let it = 0; it < iters; it++) {
    const nf = sample(p => mu[p] > 0.5 && tri[p] !== BG, idxF), nb = sample(p => mu[p] <= 0.5 && tri[p] !== FG, idxB);
    const gf = fitGMM(R, G, B, idxF, nf, K), gb = fitGMM(R, G, B, idxB, nb, K);
    if (!gf || !gb) break;
    for (let p = 0; p < N; p++) {
      const t = tri[p];
      if (t === BG) { U[p] = -60; continue; } if (t === FG) { U[p] = 60; continue; }
      let u = nll(gb, R[p], G[p], B[p]) - nll(gf, R[p], G[p], B[p]) + geoW * L[p];
      U[p] = u > 14 ? 14 : u < -14 ? -14 : u;
    }
    // старт — с того, что говорит цвет (иначе сглаживание держится за начальную разметку)
    for (let p = 0; p < N; p++) { const u = U[p]; mu[p] = u > 30 ? 1 : u < -30 ? 0 : 1 / (1 + Math.exp(-u)); }
    // среднее поле: туда-обратно, сразу обновляю (быстрее сходится)
    for (let t = 0; t < mf; t++) {
      const fwd = !(t & 1);
      for (let j = 0; j < N; j++) {
        const p = fwd ? j : N - 1 - j, x = p % W;
        let s = U[p];
        if (x + 1 < W) s += wR[p] * (2 * mu[p + 1] - 1);
        if (x > 0) s += wR[p - 1] * (2 * mu[p - 1] - 1);
        if (p + W < N) s += wD[p] * (2 * mu[p + W] - 1);
        if (p >= W) s += wD[p - W] * (2 * mu[p - W] - 1);
        mu[p] = s > 30 ? 1 : s < -30 ? 0 : 1 / (1 + Math.exp(-s));
      }
    }
  }
  return mu;
}

/** чистка: мелкие островки прочь, дырки внутри — залить. Возвращает Uint8Array 0/1 */
export function cleanup(mu, W, H, tri) {
  const N = W * H, bin = new Uint8Array(N);
  for (let p = 0; p < N; p++) bin[p] = mu[p] > 0.5 && (!tri || tri[p] !== BG) ? 1 : 0;
  const comp = new Int32Array(N).fill(-1), stack = new Int32Array(N);
  const label = (val) => {
    const areas = [], edge = [];
    for (let s = 0; s < N; s++) {
      if (bin[s] !== val || comp[s] !== -1) continue;
      const id = areas.length; let top = 0, area = 0, touch = false; stack[top++] = s; comp[s] = id;
      while (top) {
        const p = stack[--top], x = p % W, y = (p - x) / W; area++;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || (tri && tri[p] === BG)) touch = true;
        if (x > 0 && bin[p - 1] === val && comp[p - 1] === -1) { comp[p - 1] = id; stack[top++] = p - 1; }
        if (x < W - 1 && bin[p + 1] === val && comp[p + 1] === -1) { comp[p + 1] = id; stack[top++] = p + 1; }
        if (y > 0 && bin[p - W] === val && comp[p - W] === -1) { comp[p - W] = id; stack[top++] = p - W; }
        if (y < H - 1 && bin[p + W] === val && comp[p + W] === -1) { comp[p + W] = id; stack[top++] = p + W; }
      }
      areas.push(area); edge.push(touch);
    }
    return { areas, edge };
  };
  const f = label(1), big = Math.max(0, ...f.areas), keepMin = Math.max(big * 0.12, N * 0.0015);
  for (let p = 0; p < N; p++) if (bin[p] && f.areas[comp[p]] < keepMin) bin[p] = 0;
  comp.fill(-1);
  const b = label(0);
  for (let p = 0; p < N; p++) if (!bin[p] && !b.edge[comp[p]] && b.areas[comp[p]] < N * 0.02) bin[p] = 1;
  return bin;
}

/** мягкий край: размытие 3×3 → альфа 0..255 */
export function feather(bin, W, H) {
  const out = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; s += bin[yy * W + xx]; n++; } }
    out[y * W + x] = Math.round(255 * s / n);
  }
  return out;
}

/** тримап «авто»: рамка — фон, эллипс в центре — объект */
export function autoTri(W, H) {
  const tri = new Uint8Array(W * H).fill(PBG), cx = (W - 1) / 2, cy = (H - 1) / 2, rx = W * 0.36, ry = H * 0.4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) tri[p] = BG;
    else if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) tri[p] = PFG;
  }
  return tri;
}
/** тримап по обводке: снаружи — точно фон, внутри — скорее объект (заливка многоугольника по строкам) */
export function polyTri(pts, W, H) {
  const tri = new Uint8Array(W * H).fill(BG), n = pts.length;
  if (n < 3) return tri;
  const xs = [];
  for (let y = 0; y < H; y++) {
    const yc = y + 0.5; xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[j];
      if ((y1 <= yc) !== (y2 <= yc)) xs.push(x1 + (yc - y1) * (x2 - x1) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x++) tri[y * W + x] = PFG;
    }
  }
  return tri;
}

/** евклидово расстояние до ближайшего пикселя объекта (квадрат), Felzenszwalb–Huttenlocher */
export function edt(bin, W, H) {
  const INF = 1e12, f = new Float64Array(Math.max(W, H)), d = new Float64Array(Math.max(W, H)), v = new Int32Array(Math.max(W, H)), z = new Float64Array(Math.max(W, H) + 1);
  const out = new Float64Array(W * H);
  const dt1 = n => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = bin[y * W + x] ? 0 : INF; dt1(H); for (let y = 0; y < H; y++) out[y * W + x] = d[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = out[y * W + x]; dt1(W); for (let x = 0; x < W; x++) out[y * W + x] = d[x]; }
  return out;
}

/** вырезать: режим 'auto' | 'lasso' (pts в пикселях) → альфа-маска W×H (0..255) */
export function cutout(rgba, W, H, mode = 'auto', pts = null) {
  const tri = mode === 'lasso' && pts ? polyTri(pts, W, H) : autoTri(W, H);
  const mu = segment(rgba, W, H, tri, { autoMode: mode !== 'lasso' });
  const bin = cleanup(mu, W, H, mode === 'lasso' ? tri : null);
  let n = 0; for (let p = 0; p < bin.length; p++) n += bin[p];
  return { alpha: feather(bin, W, H), area: n / bin.length };
}
