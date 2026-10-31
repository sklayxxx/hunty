// Мик: ограничения getUserMedia и «порог голоса» (noise gate на AudioWorklet) — общие для звонка и проверки мика
import { prefs, clamp, sleep } from './core.js';

export function micConstraints(any) {
  const c = { echoCancellation: !!prefs.ec, noiseSuppression: !!prefs.ns, autoGainControl: !!prefs.agc, channelCount: 1 };
  return prefs.micId && !any ? { ...c, deviceId: { exact: prefs.micId } } : c;
}
/** мик из настроек; выбранный пропал — берём системный */
export async function getMic() {
  try { return await navigator.mediaDevices.getUserMedia({ audio: micConstraints() }); }
  catch (e) {
    if (prefs.micId) { try { return await navigator.mediaDevices.getUserMedia({ audio: micConstraints(true) }); } catch (_) {} }
    throw e;
  }
}
export const toDb = l => (l > 1e-5 ? 20 * Math.log10(l) : -100);

// Работает в аудиопотоке, поэтому не тормозит, когда окно свёрнуто.
// Огибающая громкости → открыто/закрыто с удержанием 350 мс; «авто» — порог на 14 дБ выше шума (минимум за ~5 сек).
const GATE = `
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
    if ((this.t += n) >= sampleRate / 12) { this.t = 0; this.port.postMessage([open ? 1 : 0, thr, this.env]); }
    return true;
  }
}
registerProcessor('hunty-gate', HuntyGate);
`;
const loaded = new WeakMap();
function load(ctx) {
  if (!ctx || !ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return Promise.resolve(false);
  let p = loaded.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([GATE], { type: 'application/javascript' }));
    p = ctx.audioWorklet.addModule(url).then(() => true, e => { console.warn('gate', e); loaded.delete(ctx); return false; });
    loaded.set(ctx, p);
  }
  return p;
}
const MODES = { off: 0, auto: 1, manual: 2 };
/** узел «порога голоса»; onState([open, thrDb, levelDb]) ~12 раз в секунду. null — нет AudioWorklet (тогда без порога) */
export async function makeGate(ctx, onState) {
  if (!(await Promise.race([load(ctx), sleep(2000).then(() => false)]))) return null;
  try {
    const n = new AudioWorkletNode(ctx, 'hunty-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
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
