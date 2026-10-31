// Мик: getUserMedia и цепочка обработки — общая для звонка, проверки мика и мастера «меня плохо слышат»:
// мик → шумодав RNNoise → громкость → (уровень) → порог голоса → эффект → микс с саундбордом → в звонок
import { prefs, clamp, sleep, bus } from './core.js';
import { idb } from './idb.js';

/* ---------- шумодав RNNoise: wasm собран из tools/denoise (nnnoiseless, чистый Rust) ---------- */
let dnP = null, dnBytes = null;
export function dnLoad() {
  if (!dnP) {
    dnP = (typeof WebAssembly !== 'object' ? Promise.reject(new Error('нет WebAssembly'))
      : fetch('audio/denoise.wasm').then(r => { if (!r.ok) throw new Error('denoise.wasm ' + r.status); return r.arrayBuffer(); })
        .then(async b => { const m = await WebAssembly.compile(b); dnBytes = b; return m; }))
      .catch(e => { console.warn('denoise', e); return null; });
  }
  return dnP;
}
/** какой шумодав реально работает: rnnoise | std (встроенный в браузер) | off */
export async function nsWork() {
  const m = prefs.nsMode || 'rnnoise';
  if (m !== 'rnnoise') return m === 'off' ? 'off' : 'std';
  return (await dnLoad()) ? 'rnnoise' : 'std';
}
export function micConstraints(any, ns = 'std') {
  const c = { echoCancellation: !!prefs.ec, noiseSuppression: ns === 'std', autoGainControl: !!prefs.agc, channelCount: 1 };
  return prefs.micId && !any ? { ...c, deviceId: { exact: prefs.micId } } : c;
}
/** мик из настроек; выбранный пропал — берём системный */
export async function getMic(deviceId) {
  const ns = await nsWork();
  const c = micConstraints(false, ns);
  if (deviceId !== undefined) { if (deviceId) c.deviceId = { exact: deviceId }; else delete c.deviceId; }
  try { return await navigator.mediaDevices.getUserMedia({ audio: c }); }
  catch (e) {
    if (c.deviceId) { try { return await navigator.mediaDevices.getUserMedia({ audio: micConstraints(true, ns) }); } catch (_) {} }
    throw e;
  }
}
export const toDb = l => (l > 1e-5 ? 20 * Math.log10(l) : -100);
/** громкость с анализатора, дБ */
export function levelDb(an, buf) {
  an.getFloatTimeDomainData(buf); let q = 0;
  for (let i = 0; i < buf.length; i++) q += buf[i] * buf[i];
  return toDb(Math.sqrt(q / buf.length));
}

/* ---------- ворклеты: порог голоса, RNNoise, сдвиг высоты голоса ---------- */
// Работают в аудиопотоке, поэтому не тормозят, когда окно свёрнуто.
const WK = `
// Порог: огибающая громкости → открыто/закрыто с удержанием 350 мс; «авто» — на 14 дБ выше шума (минимум за ~5 сек)
class HuntyGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'thr', defaultValue: -50, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
            { name: 'mode', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.env = -100; this.g = 1; this.hold = 0; this.t = 0;
    this.win = new Float32Array(20).fill(0); this.wi = 0; this.bn = 0; this.bmin = 0; this.floor = -60;
    this.blk = Math.round(sampleRate / 4);
    this.ka = 1 - Math.exp(-1 / (0.002 * sampleRate)); this.kr = 1 - Math.exp(-1 / (0.08 * sampleRate));
  }
  process(ins, outs, p) {
    const out = outs[0] && outs[0][0]; if (!out) return true;
    const x = ins[0] && ins[0][0], n = out.length;
    if (!x) { out.fill(0); return true; }
    let s = 0; for (let i = 0; i < n; i++) s += x[i] * x[i];
    const db = s > 0 ? Math.max(-100, 10 * Math.log10(s / n)) : -100;
    this.env = db > this.env ? db : this.env + (db - this.env) * Math.min(1, n / (0.06 * sampleRate));
    if (this.bn === 0 || this.env < this.bmin) this.bmin = this.env;
    if ((this.bn += n) >= this.blk) {
      this.bn = 0; this.win[this.wi] = this.bmin; this.wi = (this.wi + 1) % 20;
      let m = 0; for (let i = 0; i < 20; i++) if (this.win[i] < m) m = this.win[i];
      this.floor = m < this.floor ? m : Math.min(m, this.floor + 0.75);
    }
    const mode = p.mode[0] | 0;
    const thr = mode === 1 ? Math.min(-38, Math.max(-68, this.floor + 14)) : p.thr[0];
    if (mode === 0 || this.env >= thr) this.hold = 0.35 * sampleRate; else if (this.hold > 0) this.hold -= n;
    const open = mode === 0 || this.hold > 0, tg = open ? 1 : 0, k = open ? this.ka : this.kr;
    let g = this.g; for (let i = 0; i < n; i++) { g += (tg - g) * k; out[i] = x[i] * g; } this.g = g;
    if ((this.t += n) >= sampleRate / 12) { this.t = 0; this.port.postMessage([open ? 1 : 0, thr, this.env, this.floor]); }
    return true;
  }
}
registerProcessor('hunty-gate', HuntyGate);

// RNNoise: кадры по 480 сэмплов (10 мс при 48 кГц), значения в масштабе int16; задержка ~10 мс
class HuntyDn extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const po = (o && o.processorOptions) || {};
    this.on = po.on !== false; this.ok = false; this.vad = 0; this.t = 0;
    let mod = null;
    try { if (po.mod instanceof WebAssembly.Module) mod = po.mod; } catch (_) {}
    try {
      if (!mod) mod = new WebAssembly.Module(po.bytes);
      const ins = new WebAssembly.Instance(mod, {});
      this.x = ins.exports; this.st = this.x.dn_new();
      this.pi = this.x.dn_in(this.st) >> 2; this.po = this.x.dn_out(this.st) >> 2;
      this.ok = true;
    } catch (e) { this.port.postMessage({ err: String(e && e.message || e) }); }
    this.fin = new Float32Array(480); this.fi = 0;
    this.q = new Float32Array(2048); this.qr = 0; this.qw = 480; this.qn = 480; // 480 нулей вперёд — без провалов
    this.port.onmessage = e => { if (e.data && 'on' in e.data) this.on = !!e.data.on; };
  }
  frame() {
    const H = new Float32Array(this.x.memory.buffer), f = this.fin, q = this.q, L = q.length;
    for (let i = 0; i < 480; i++) H[this.pi + i] = f[i] * 32768;
    this.vad = this.x.dn_run(this.st);
    const O = new Float32Array(this.x.memory.buffer);
    for (let i = 0; i < 480; i++) { q[this.qw] = O[this.po + i] / 32768; this.qw = (this.qw + 1) % L; }
    this.qn = Math.min(L, this.qn + 480);
  }
  process(ins, outs) {
    const out = outs[0] && outs[0][0]; if (!out) return true;
    const x = ins[0] && ins[0][0], n = out.length;
    if (!x) { out.fill(0); return true; }
    if (!this.ok || !this.on) { out.set(x); return true; }
    for (let i = 0; i < n; i++) { this.fin[this.fi++] = x[i]; if (this.fi === 480) { this.fi = 0; this.frame(); } }
    const q = this.q, L = q.length;
    for (let i = 0; i < n; i++) { if (this.qn > 0) { out[i] = q[this.qr]; this.qr = (this.qr + 1) % L; this.qn--; } else out[i] = 0; }
    if ((this.t += n) >= sampleRate / 10) { this.t = 0; this.port.postMessage({ vad: this.vad }); }
    return true;
  }
}
registerProcessor('hunty-dn', HuntyDn);

// Высота голоса без смены темпа: две «головки» чтения линии задержки с перекрёстным затуханием (окно 50 мс)
class HuntyPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }]; }
  constructor() { super(); this.N = 8192; this.b = new Float32Array(this.N); this.w = 0; this.ph = 0; this.W = Math.round(sampleRate * 0.05); }
  rd(d) {
    let p = this.w - d; if (p < 0) p += this.N;
    const i0 = Math.floor(p), f = p - i0, i1 = i0 + 1 >= this.N ? 0 : i0 + 1;
    return this.b[i0] * (1 - f) + this.b[i1] * f;
  }
  process(ins, outs, p) {
    const out = outs[0] && outs[0][0]; if (!out) return true;
    const x = ins[0] && ins[0][0], n = out.length;
    if (!x) { out.fill(0); return true; }
    const r = p.ratio[0], W = this.W, dp = (1 - r) / W;
    for (let i = 0; i < n; i++) {
      this.b[this.w] = x[i];
      let ph = this.ph + dp; if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1; this.ph = ph;
      const p2 = ph + 0.5 >= 1 ? ph - 0.5 : ph + 0.5;
      const g1 = Math.sin(Math.PI * ph), g2 = Math.sin(Math.PI * p2);
      out[i] = g1 * g1 * this.rd(ph * W) + g2 * g2 * this.rd(p2 * W);
      this.w = this.w + 1 >= this.N ? 0 : this.w + 1;
    }
    return true;
  }
}
registerProcessor('hunty-pitch', HuntyPitch);
`;
const loaded = new WeakMap(), ready = new WeakSet();
function loadWk(ctx) {
  if (!ctx || !ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return Promise.resolve(false);
  let p = loaded.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([WK], { type: 'application/javascript' }));
    p = ctx.audioWorklet.addModule(url).then(() => { ready.add(ctx); return true; }, e => { console.warn('worklet', e); loaded.delete(ctx); return false; });
    loaded.set(ctx, p);
  }
  return Promise.race([p, sleep(2500).then(() => false)]);
}
const MONO = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' };
const MODES = { off: 0, auto: 1, manual: 2 };
/** узел «порога голоса»; onState([open, thrDb, levelDb, floorDb]) ~12 раз в секунду. null — нет AudioWorklet (тогда без порога) */
export async function makeGate(ctx, onState) {
  if (!(await loadWk(ctx))) return null;
  try {
    const n = new AudioWorkletNode(ctx, 'hunty-gate', MONO);
    gateSet(n);
    if (onState) n.port.onmessage = e => onState(e.data);
    return n;
  } catch (e) { console.warn('gate', e); return null; }
}
export function gateSet(n) {
  if (!n) return;
  try {
    const t = n.context.currentTime;
    n.parameters.get('mode').setValueAtTime(MODES[prefs.gate] ?? 1, t);
    n.parameters.get('thr').setValueAtTime(clamp(+prefs.gateDb || -50, -100, 0), t);
  } catch (_) {}
}
/** узел RNNoise; null — wasm или ворклет недоступны */
export async function makeDenoise(ctx, onVad) {
  const mod = await dnLoad();
  if (!mod || !(await loadWk(ctx))) return null;
  let n = null;
  try { n = new AudioWorkletNode(ctx, 'hunty-dn', { ...MONO, processorOptions: { mod, bytes: dnBytes } }); }
  catch (_) { try { n = new AudioWorkletNode(ctx, 'hunty-dn', { ...MONO, processorOptions: { bytes: dnBytes } }); } catch (e) { console.warn('denoise', e); return null; } }
  n.port.onmessage = e => { const d = e.data || {}; if (d.err) console.warn('denoise', d.err); else if (onVad && 'vad' in d) onVad(d.vad); };
  return n;
}
function pitchNode(ctx, r) {
  if (!ready.has(ctx)) return ctx.createGain(); // нет ворклета — без сдвига, но и без тишины
  try { const n = new AudioWorkletNode(ctx, 'hunty-pitch', MONO); n.parameters.get('ratio').value = r; return n; }
  catch (_) { return ctx.createGain(); }
}

/* ---------- эффекты голоса (слышат друзья) ---------- */
export const FX = [
  { id: '', e: '1f3a4', name: 'Без эффекта' },
  { id: 'deep', e: '1f43b', name: 'Грубый' },
  { id: 'high', e: '1f476', name: 'Детский' },
  { id: 'robot', e: '1f916', name: 'Робот' },
  { id: 'radio', e: '1f4fb', name: 'Рация' },
  { id: 'cave', e: '1f987', name: 'Эхо' },
  { id: 'demon', e: '1f608', name: 'Демон' },
];
export const fxName = id => (FX.find(f => f.id === (id || '')) || FX[0]).name;
function shaper(k) { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * 2 / (n - 1) - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); } return c; }
const irs = new WeakMap();
function impulse(ctx, sec, decay) {
  let m = irs.get(ctx); if (!m) irs.set(ctx, m = new Map());
  const key = sec + ':' + decay; if (m.has(key)) return m.get(key);
  const n = Math.round(ctx.sampleRate * sec), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < n; i++) { lp += ((Math.random() * 2 - 1) - lp) * .35; d[i] = lp * Math.pow(1 - i / n, decay) * (i < 90 ? i / 90 : 1); }
  m.set(key, b); return b;
}
/** собрать эффект: { in, out, stop } */
export function buildFx(ctx, kind) {
  const inp = ctx.createGain(), out = ctx.createGain(), stops = [];
  const line = (...ns) => { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; };
  const bq = (type, f, q = .7, g = 0) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b; };
  const ws = k => { const w = ctx.createWaveShaper(); w.curve = shaper(k); w.oversample = '2x'; return w; };
  const rev = (sec, dec, wet) => { const cv = ctx.createConvolver(); cv.normalize = true; cv.buffer = impulse(ctx, sec, dec); const g = ctx.createGain(); g.gain.value = wet; cv.connect(g); return [cv, g]; };
  switch (kind) {
    case 'deep': line(inp, pitchNode(ctx, .78), bq('lowshelf', 220, .7, 4), out); break;
    case 'high': line(inp, pitchNode(ctx, 1.45), bq('highshelf', 5000, .7, -3), out); break;
    case 'robot': {
      const mod = ctx.createGain(); mod.gain.value = 0;
      const osc = ctx.createOscillator(); osc.frequency.value = 55; osc.connect(mod.gain); osc.start(); stops.push(() => osc.stop());
      const dl = ctx.createDelay(.05), fb = ctx.createGain(); dl.delayTime.value = .0067; fb.gain.value = .55;
      inp.connect(mod); mod.connect(dl); dl.connect(fb); fb.connect(dl);
      mod.connect(out); dl.connect(out); out.gain.value = 1.15; break;
    }
    case 'radio': line(inp, bq('highpass', 450, .8), bq('lowpass', 2900, .8), bq('peaking', 1600, 1.2, 7), ws(18), out); out.gain.value = .5; break;
    case 'cave': { inp.connect(out); const [cv, g] = rev(2.8, 2.4, .55); inp.connect(cv); g.connect(out); out.gain.value = .9; break; }
    case 'demon': {
      const p = pitchNode(ctx, .64); line(inp, p, ws(5), bq('lowpass', 3200), out);
      const [cv, g] = rev(1.4, 3, .3); p.connect(cv); g.connect(out); out.gain.value = .85; break;
    }
    default: inp.connect(out);
  }
  return { in: inp, out, stop: () => { stops.forEach(f => { try { f(); } catch (_) {} }); try { inp.disconnect(); out.disconnect(); } catch (_) {} } };
}

/* ---------- цепочка мика ---------- */
const chains = new Set();
/**
 * мик → [RNNoise] → громкость → анализатор → [порог] → эффект → микс (+ саундборд) → dest
 * o.onGate([open, thr, level, floor]), o.onVad(0..1). Вернёт { stream, track, an, gain, gate, dn, sb, stop() }
 */
export async function micChain(ctx, raw, o = {}) {
  const c = { ctx, raw, fx: null, ns: await nsWork(), dead: false };
  c.src = ctx.createMediaStreamSource(raw);
  c.dn = c.ns === 'rnnoise' ? await makeDenoise(ctx, o.onVad) : null;
  c.gain = ctx.createGain(); c.gain.gain.value = (prefs.micVol ?? 100) / 100;
  c.an = ctx.createAnalyser(); c.an.fftSize = 1024; c.an.smoothingTimeConstant = .2;
  c.gate = o.gate === false ? null : await makeGate(ctx, o.onGate);
  c.fxIn = ctx.createGain(); c.mix = ctx.createGain(); c.sb = ctx.createGain();
  c.dest = ctx.createMediaStreamDestination();
  if (c.dn) c.src.connect(c.dn).connect(c.gain); else c.src.connect(c.gain);
  c.gain.connect(c.an);
  if (c.gate) c.gain.connect(c.gate).connect(c.fxIn); else c.gain.connect(c.fxIn);
  c.sb.connect(c.mix); c.mix.connect(c.dest);
  setFx(c, prefs.fx);
  c.stream = c.dest.stream; c.track = c.stream.getAudioTracks()[0];
  c.stop = (keepRaw) => {
    if (c.dead) return; c.dead = true; chains.delete(c);
    if (c.fx) c.fx.stop();
    for (const n of [c.src, c.dn, c.gain, c.gate, c.fxIn, c.sb, c.mix]) { if (n) { try { n.disconnect(); } catch (_) {} } }
    if (c.gate) c.gate.port.onmessage = null; if (c.dn) c.dn.port.onmessage = null;
    if (c.track) c.track.stop();
    if (!keepRaw) raw.getTracks().forEach(t => t.stop());
  };
  chains.add(c);
  return c;
}
function setFx(c, kind) {
  if (c.fx) { try { c.fxIn.disconnect(); } catch (_) {} c.fx.stop(); }
  c.fx = buildFx(c.ctx, kind || ''); c.fxKind = kind || '';
  c.fxIn.connect(c.fx.in); c.fx.out.connect(c.mix);
}
bus.on('pref', k => {
  for (const c of chains) {
    if (k === 'micVol') c.gain.gain.setTargetAtTime((prefs.micVol ?? 100) / 100, c.ctx.currentTime, .02);
    if (k === 'gate' || k === 'gateDb') gateSet(c.gate);
    if (k === 'fx') setFx(c, prefs.fx);
  }
});

/* ---------- саундборд: свои звуки синтезом (без чужих файлов) + свои файлы (IndexedDB) ---------- */
export const SB = [
  { id: 'horn', e: '1f4ef', name: 'Дудка' },
  { id: 'drum', e: '1f941', name: 'Ба-дум-тсс' },
  { id: 'sad', e: '1f3ba', name: 'Грустный тромбон' },
  { id: 'clap', e: '1f44f', name: 'Аплодисменты' },
  { id: 'boing', e: '1f300', name: 'Пружинка' },
  { id: 'laser', e: '1f52b', name: 'Пиу-пиу' },
  { id: 'win', e: '1f3c6', name: 'Победа' },
  { id: 'cricket', e: '1f997', name: 'Сверчки' },
];
const noiseBuf = (oc, sec) => { const n = Math.round(oc.sampleRate * sec), b = oc.createBuffer(1, n, oc.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return b; };
const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
const SYN = {
  horn: [1.6, (oc, o) => {
    const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; const w = oc.createWaveShaper(); w.curve = shaper(3);
    lp.connect(w).connect(o);
    for (const [t, d] of [[0, .16], [.22, .16], [.44, .9]]) for (const f of [466, 587, 698]) {
      const s = oc.createOscillator(), g = oc.createGain(); s.type = 'sawtooth'; s.frequency.setValueAtTime(f * .97, t); s.frequency.linearRampToValueAtTime(f, t + .05); s.detune.value = Math.random() * 8 - 4;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.12, t + .02); g.gain.setValueAtTime(.12, t + d); g.gain.linearRampToValueAtTime(0, t + d + .06);
      s.connect(g).connect(lp); s.start(t); s.stop(t + d + .1);
    }
  }],
  drum: [2, (oc, o) => {
    for (const [t, f] of [[0, 190], [.2, 140]]) {
      const s = oc.createOscillator(), g = oc.createGain(); s.frequency.setValueAtTime(f, t); s.frequency.exponentialRampToValueAtTime(f / 2, t + .25);
      env(g, t, .004, .9, .3); s.connect(g).connect(o); s.start(t); s.stop(t + .4);
    }
    const n = oc.createBufferSource(); n.buffer = noiseBuf(oc, 1.6); const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = oc.createGain(); env(g, .46, .005, .5, 1.3); n.connect(hp).connect(g).connect(o); n.start(.46);
    const k = oc.createOscillator(), kg = oc.createGain(); k.frequency.setValueAtTime(120, .46); k.frequency.exponentialRampToValueAtTime(45, .7); env(kg, .46, .003, .8, .35); k.connect(kg).connect(o); k.start(.46); k.stop(.9);
  }],
  sad: [2.8, (oc, o) => {
    const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 2; lp.connect(o);
    const s = oc.createOscillator(); s.type = 'sawtooth'; const g = oc.createGain(); g.gain.value = 0; s.connect(g).connect(lp);
    const notes = [[311, 0, .42], [294, .48, .42], [277, .96, .42], [262, 1.44, 1.2]];
    for (const [f, t, d] of notes) {
      s.frequency.setValueAtTime(f * 1.02, t); s.frequency.linearRampToValueAtTime(f * .985, t + d);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.32, t + .05); g.gain.setValueAtTime(.3, t + d - .06); g.gain.linearRampToValueAtTime(0, t + d);
    }
    const lfo = oc.createOscillator(), lg = oc.createGain(); lfo.frequency.value = 5.5; lg.gain.setValueAtTime(0, 1.5); lg.gain.linearRampToValueAtTime(7, 1.9); lfo.connect(lg).connect(s.frequency);
    s.start(0); lfo.start(0); s.stop(2.7); lfo.stop(2.7);
  }],
  clap: [2.4, (oc, o) => {
    const nb = noiseBuf(oc, .05);
    for (let i = 0; i < 70; i++) {
      const t = Math.pow(Math.random(), .8) * 2.1, n = oc.createBufferSource(); n.buffer = nb;
      const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 1500; bp.Q.value = 1.2;
      const g = oc.createGain(); env(g, t, .002, (.25 + Math.random() * .35) * (1 - t / 2.4), .045);
      n.connect(bp).connect(g).connect(o); n.start(t); n.stop(t + .06);
    }
  }],
  boing: [1, (oc, o) => {
    const s = oc.createOscillator(), g = oc.createGain(), n = 200, cv = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / n * .9; cv[i] = 260 + 160 * Math.sin(2 * Math.PI * 11 * t) * Math.exp(-3.5 * t) + 120 * t; }
    s.frequency.setValueCurveAtTime(cv, 0, .9); env(g, 0, .01, .6, .85); s.connect(g).connect(o); s.start(0); s.stop(.95);
  }],
  laser: [.75, (oc, o) => {
    for (const t of [0, .2, .4]) {
      const s = oc.createOscillator(), g = oc.createGain(); s.type = 'square'; s.frequency.setValueAtTime(1900, t); s.frequency.exponentialRampToValueAtTime(180, t + .17);
      env(g, t, .004, .18, .17); s.connect(g).connect(o); s.start(t); s.stop(t + .2);
    }
  }],
  win: [1.6, (oc, o) => {
    const notes = [[523, 0, .11], [659, .12, .11], [784, .24, .11], [1047, .36, .9]];
    for (const [f, t, d] of notes) for (const [type, m, v] of [['square', 1, .09], ['triangle', .5, .2]]) {
      const s = oc.createOscillator(), g = oc.createGain(); s.type = type; s.frequency.value = f * m;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .015); g.gain.setValueAtTime(v, t + d * .7); g.gain.linearRampToValueAtTime(0, t + d);
      if (d > .5) { const l = oc.createOscillator(), lg = oc.createGain(); l.frequency.value = 6; lg.gain.value = 9; l.connect(lg).connect(s.frequency); l.start(t); l.stop(t + d); }
      s.connect(g).connect(o); s.start(t); s.stop(t + d + .02);
    }
  }],
  cricket: [2.2, (oc, o) => {
    for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) {
      const t = k * .52 + j * .07, s = oc.createOscillator(), g = oc.createGain(); s.frequency.value = 4400 + k * 30;
      env(g, t, .006, .16, .045); s.connect(g).connect(o); s.start(t); s.stop(t + .07);
    }
  }],
};
const sbCache = new Map(); // id → Promise<AudioBuffer|null>
async function synthBuf(id, rate) {
  const [sec, fn] = SYN[id]; const oc = new OfflineAudioContext(1, Math.round(rate * sec), rate);
  const o = oc.createGain(); o.connect(oc.destination); fn(oc, o);
  const b = await oc.startRendering(), d = b.getChannelData(0);
  let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  if (pk > 0) { const k = .7 / pk; for (let i = 0; i < d.length; i++) d[i] *= k; }
  return b;
}
export const SB_MAX = 8, SB_SEC = 10, SB_BYTES = 1.5e6;
/** свои звуки: [{ id, name }] (сами байты — в idb под 'sb:'+id) */
export async function sbCustom() { try { return (await idb.get('sb:list')) || []; } catch (_) { return []; } }
export async function sbAdd(file, ctx) {
  if (file.size > SB_BYTES) throw new Error('файл больше 1,5 МБ — обрежь покороче');
  const bytes = await file.arrayBuffer();
  const buf = await ctx.decodeAudioData(bytes.slice(0)); // не звук — упадёт тут
  if (buf.duration > SB_SEC + .5) throw new Error(`звук длиннее ${SB_SEC} сек — играть будет только начало`);
  const list = await sbCustom(); if (list.length >= SB_MAX) throw new Error(`своих звуков максимум ${SB_MAX}`);
  const id = 'u' + Date.now().toString(36), name = file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 24) || 'звук';
  await idb.set('sb:' + id, bytes); list.push({ id, name }); await idb.set('sb:list', list);
  sbCache.set(id, Promise.resolve(buf));
  return { id, name };
}
export async function sbDel(id) {
  const list = (await sbCustom()).filter(x => x.id !== id); await idb.set('sb:list', list); await idb.del('sb:' + id); sbCache.delete(id);
}
function sbBuf(ctx, id) {
  if (!sbCache.has(id)) {
    sbCache.set(id, (async () => {
      if (SYN[id]) return synthBuf(id, ctx.sampleRate);
      const bytes = await idb.get('sb:' + id); if (!bytes) return null;
      return ctx.decodeAudioData(bytes.slice(0));
    })().catch(e => { console.warn('sb', e); sbCache.delete(id); return null; }));
  }
  return sbCache.get(id);
}
let sbPlaying = [];
/** сыграть звук: себе (monitor) и в цепочку мика (друзьям). Вернёт длительность, сек */
export async function sbPlay(ctx, id, chain, { monitor = true } = {}) {
  const b = await sbBuf(ctx, id); if (!b) return 0;
  const vol = clamp((prefs.sbVol ?? 70) / 100, 0, 1), t = ctx.currentTime + .01, dur = Math.min(b.duration, SB_SEC);
  const s = ctx.createBufferSource(); s.buffer = b;
  const g = ctx.createGain(); g.gain.value = vol; s.connect(g);
  if (chain && !chain.dead) g.connect(chain.sb);
  if (monitor) { const m = ctx.createGain(); m.gain.value = .8; g.connect(m); m.connect(ctx.destination); }
  s.start(t); s.stop(t + dur);
  const it = { s, g }; sbPlaying.push(it);
  s.onended = () => { try { g.disconnect(); } catch (_) {} sbPlaying = sbPlaying.filter(x => x !== it); };
  return dur;
}
export function sbStop() { for (const { s } of sbPlaying) { try { s.stop(); } catch (_) {} } sbPlaying = []; }
