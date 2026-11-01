// WebM без библиотек: разбор потока MediaRecorder на кадры и сборка из них нового файла.
// Нужен клипам: держим в памяти последние ~30 сек кадров и по F8 склеиваем их в нормальный .webm
// (с длительностью, Cues и временем от нуля — такой файл перематывается в любом плеере).
const ID = { EBML: 0x1A45DFA3, SEG: 0x18538067, INFO: 0x1549A966, SCALE: 0x2AD7B1, TRACKS: 0x1654AE6B, ENTRY: 0xAE, TNUM: 0xD7, TTYPE: 0x83, CODEC: 0x86,
  CLUSTER: 0x1F43B675, TC: 0xE7, SBLOCK: 0xA3, BGROUP: 0xA0, BLOCK: 0xA1, REFB: 0xFB, VIDEO: 0xE0, PW: 0xB0, PH: 0xBA };

/* ---------- чтение EBML ---------- */
function rdId(b, p) {
  if (p >= b.length) return null;
  const x = b[p], n = x & 0x80 ? 1 : x & 0x40 ? 2 : x & 0x20 ? 3 : x & 0x10 ? 4 : 0;
  if (!n) throw new Error('webm: плохой id');
  if (p + n > b.length) return null;
  let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i];
  return [v, n];
}
function rdSize(b, p) {
  if (p >= b.length) return null;
  const x = b[p]; let n = 1, m = 0x80; while (n <= 8 && !(x & m)) { n++; m >>= 1; }
  if (n > 8) throw new Error('webm: плохой размер');
  if (p + n > b.length) return null;
  let v = x & (m - 1), ones = v === m - 1;
  for (let i = 1; i < n; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xFF) ones = false; }
  return [ones ? -1 : v, n];
}
const rdUint = (b, p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; };
/** дети элемента [p, end): [{id, p (начало данных), n (длина данных)}] */
function kids(b, p, end) {
  const out = [];
  while (p < end) {
    const i = rdId(b, p); if (!i) break; const s = rdSize(b, p + i[1]); if (!s) break;
    const d = p + i[1] + s[1]; out.push({ id: i[0], p: d, n: s[0] }); p = d + s[0];
  }
  return out;
}

/** потоковый разбор: push(кусок) → onHead({tracks, raw}) один раз и onFrame({track, ts, key, lace, data}) на каждый кадр */
export class Demux {
  constructor(onHead, onFrame) { this.onHead = onHead; this.onFrame = onFrame; this.buf = new Uint8Array(0); this.scale = 1e6; this.cts = 0; this.head = null; }
  push(chunk) {
    const c = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    if (this.buf.length) { const n = new Uint8Array(this.buf.length + c.length); n.set(this.buf); n.set(c, this.buf.length); this.buf = n; } else this.buf = c;
    const b = this.buf; let p = 0;
    for (;;) {
      const i = rdId(b, p); if (!i) break; const s = rdSize(b, p + i[1]); if (!s) break;
      const [id] = i, size = s[0], d = p + i[1] + s[1];
      if (id === ID.SEG || id === ID.CLUSTER) { p = d; continue; } // контейнеры (часто «размер неизвестен») — заходим внутрь
      if (size < 0) throw new Error('webm: неизвестный размер у 0x' + id.toString(16));
      if (d + size > b.length) break; // элемент ещё не докачан
      if (id === ID.INFO) { for (const k of kids(b, d, d + size)) if (k.id === ID.SCALE) this.scale = rdUint(b, k.p, k.n); }
      else if (id === ID.TRACKS) {
        const tracks = [];
        for (const e of kids(b, d, d + size)) if (e.id === ID.ENTRY) {
          const t = {}; for (const k of kids(b, e.p, e.p + e.n)) {
            if (k.id === ID.TNUM) t.num = rdUint(b, k.p, k.n); else if (k.id === ID.TTYPE) t.type = rdUint(b, k.p, k.n) === 1 ? 'video' : 'audio';
            else if (k.id === ID.CODEC) t.codec = new TextDecoder().decode(b.subarray(k.p, k.p + k.n));
            else if (k.id === ID.VIDEO) for (const v of kids(b, k.p, k.p + k.n)) { if (v.id === ID.PW) t.w = rdUint(b, v.p, v.n); if (v.id === ID.PH) t.h = rdUint(b, v.p, v.n); }
          }
          tracks.push(t);
        }
        this.head = { tracks, raw: b.slice(p, d + size) }; this.onHead(this.head);
      }
      else if (id === ID.TC) this.cts = rdUint(b, d, size);
      else if (id === ID.SBLOCK) this.block(b, d, size, null);
      else if (id === ID.BGROUP) { let blk = null, ref = false; for (const k of kids(b, d, d + size)) { if (k.id === ID.BLOCK) blk = k; if (k.id === ID.REFB) ref = true; } if (blk) this.block(b, blk.p, blk.n, !ref); }
      p = d + size;
    }
    this.buf = p ? b.slice(p) : b;
  }
  block(b, p, n, key) {
    const t = rdSize(b, p); if (!t) return;
    const q = p + t[1], rel = (b[q] << 8 | b[q + 1]) << 16 >> 16, fl = b[q + 2];
    const ts = (this.cts + rel) * this.scale / 1e6;
    this.onFrame({ track: t[0], ts, key: key == null ? !!(fl & 0x80) : key, lace: fl & 0x06, data: b.slice(q + 3, p + n) });
  }
}

/* ---------- запись EBML ---------- */
const idBytes = id => { const a = []; while (id > 0) { a.unshift(id & 0xFF); id = Math.floor(id / 256); } return a; };
function szBytes(n, w) { // w — фиксированная ширина (1..8), иначе минимальная
  if (!w) { w = 1; while (n >= 2 ** (7 * w) - 1) w++; }
  const a = new Array(w); let v = n; for (let i = w - 1; i >= 0; i--) { a[i] = v % 256; v = Math.floor(v / 256); }
  a[0] |= 0x80 >> (w - 1); return a;
}
const uintBytes = (v, w) => { if (!w) { w = 1; while (v >= 2 ** (8 * w)) w++; } const a = new Array(w); for (let i = w - 1; i >= 0; i--) { a[i] = v % 256; v = Math.floor(v / 256); } return a; };
const cat = parts => { let n = 0; for (const x of parts) n += x.length; const o = new Uint8Array(n); let p = 0; for (const x of parts) { o.set(x, p); p += x.length; } return o; };
const el = (id, body, w) => { const b = body instanceof Uint8Array ? body : Array.isArray(body) && body.length && body[0] instanceof Uint8Array ? cat(body) : new Uint8Array(body); return cat([new Uint8Array(idBytes(id)), new Uint8Array(szBytes(b.length, w)), b]); };
const elU = (id, v, w) => el(id, uintBytes(v, w));
const elS = (id, s) => el(id, new TextEncoder().encode(s));
const elF = (id, f) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, f); return el(id, b); };

/**
 * собрать .webm из кадров одной «эпохи» записи.
 * head — то, что отдал Demux (tracks + raw Tracks), frames — [{track, ts, key, lace, data}] по времени, ts в мс
 * вернёт { bytes, dur } — время в файле начинается с нуля
 */
export function mux(head, frames) {
  if (!frames.length) throw new Error('webm: пусто');
  const vt = head.tracks.find(t => t.type === 'video'), t0 = frames[0].ts;
  const last = frames[frames.length - 1].ts - t0, dur = Math.max(1, last + (vt ? 33 : 20));
  // кластеры: новый на каждом ключевом кадре видео и не реже раза в 5 сек (смещение блока — int16 в мс)
  const clusters = []; let cur = null;
  for (const f of frames) {
    const ts = Math.max(0, Math.round(f.ts - t0));
    const vkey = vt && f.track === vt.num && f.key;
    if (!cur || vkey || ts - cur.tc > 5000 || ts - cur.tc > 32000) { cur = { tc: ts, blocks: [], key: vkey || !vt }; clusters.push(cur); }
    const rel = ts - cur.tc, h = new Uint8Array([...szBytes(f.track), (rel >> 8) & 0xFF, rel & 0xFF, (f.key ? 0x80 : 0) | (f.lace || 0)]);
    cur.blocks.push(el(ID.SBLOCK, cat([h, f.data])));
  }
  const cl = clusters.map(c => ({ tc: c.tc, bytes: el(ID.CLUSTER, [elU(ID.TC, c.tc), ...c.blocks]) }));
  const info = el(ID.INFO, [elU(ID.SCALE, 1e6), elS(0x4D80, 'Hunty'), elS(0x5741, 'Hunty'), elF(0x4489, dur)]);
  const tracks = head.raw;
  // SeekHead фиксированного размера: позиции — 8-байтные, чтобы посчитать всё за один проход
  const seek = (id, pos) => el(0x4DBB, [el(0x53AB, new Uint8Array(idBytes(id))), elU(0x53AC, pos, 8)]);
  const shLen = el(0x114D9B74, [seek(ID.INFO, 0), seek(ID.TRACKS, 0), seek(0x1C53BB6B, 0)]).length;
  const pInfo = shLen, pTracks = pInfo + info.length; let p = pTracks + tracks.length;
  const cuePts = [];
  for (const c of cl) { cuePts.push([c.tc, p]); p += c.bytes.length; }
  const pCues = p;
  const tnum = (vt || head.tracks[0] || { num: 1 }).num;
  const cues = el(0x1C53BB6B, cuePts.filter((_, i) => !vt || clusters[i].key).map(([t, pos]) => el(0xBB, [elU(0xB3, t), el(0xB7, [elU(0xF7, tnum), elU(0xF1, pos)])])));
  const sh = el(0x114D9B74, [seek(ID.INFO, pInfo), seek(ID.TRACKS, pTracks), seek(0x1C53BB6B, pCues)]);
  const body = cat([sh, info, tracks, ...cl.map(c => c.bytes), cues]);
  const ebml = el(ID.EBML, [elU(0x4286, 1), elU(0x42F7, 1), elU(0x42F2, 4), elU(0x42F3, 8), elS(0x4282, 'webm'), elU(0x4287, 4), elU(0x4285, 2)]);
  const seg = cat([new Uint8Array(idBytes(ID.SEG)), new Uint8Array(szBytes(body.length, 8)), body]);
  return { bytes: cat([ebml, seg]), dur };
}
