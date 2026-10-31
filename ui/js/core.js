// Общие мелочи: DOM, форматирование, настройки, шина событий
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const R = document.documentElement;
export const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const mobile = () => matchMedia('(max-width:640px)').matches;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pad = n => String(n).padStart(2, '0');
export const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
export const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const pick = a => a[Math.floor(Math.random() * a.length)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ic = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
export const short = p => (p ? '…' + String(p).slice(-6) : '');
export function when(ts) {
  if (!ts) return '';
  const d = new Date(ts), n = new Date();
  if (d.toDateString() === n.toDateString()) return hm(d);
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'вчера';
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1);
}
export function dayLabel(ts) {
  const d = new Date(ts), n = new Date();
  if (d.toDateString() === n.toDateString()) return 'сегодня';
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'вчера';
  return d.getDate() + ' ' + MON[d.getMonth()] + (d.getFullYear() !== n.getFullYear() ? ' ' + d.getFullYear() : '');
}
export const dur = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600); return (h ? h + ':' + pad(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ':' + pad(s % 60); };
export const size = b => b < 1024 ? b + ' Б' : b < 1048576 ? (b / 1024).toFixed(0) + ' КБ' : (b / 1048576).toFixed(1) + ' МБ';
export const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };

/* ---------- шина событий внутри UI ---------- */
const subs = {};
export const bus = {
  on(ev, fn) { (subs[ev] = subs[ev] || []).push(fn); return () => { subs[ev] = subs[ev].filter(f => f !== fn); }; },
  emit(ev, ...a) { (subs[ev] || []).slice().forEach(f => { try { f(...a); } catch (e) { console.error(ev, e); } }); },
};

/* ---------- локальные настройки (только у тебя на компе) ---------- */
const PDEF = {
  micId: '', outId: '', camId: '', micVol: 100, outVol: 100, ptt: 0, ns: true, ec: true, agc: true, bitrate: 64,
  camRes: 720, camMirror: true, shareRes: 1080, shareFps: 30, shareAudio: false, shareDraw: 'all', pinTtl: 10, shareHint: 'detail',
  glass: 'liquid', glassA: 60, scale: 100, boot: true, liveBg: false, lite: false, gate: 'auto', gateDb: -50,
  sound: true, say: false, voiceName: '', notifVol: 70, dnd: 0, mentionsOnly: false, friendOnline: true, flash: true,
  vol: {}, mute: {}, pinned: [], lastChat: '', eggs: [],
};
export const prefs = Object.assign({}, PDEF);
try { Object.assign(prefs, JSON.parse(localStorage.getItem('hunty-prefs') || '{}')); } catch (_) {}
let saveT = 0;
export function setPref(k, v) {
  prefs[k] = v;
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem('hunty-prefs', JSON.stringify(prefs)); } catch (_) {} }, 150);
  bus.emit('pref', k, v);
}
export const savePrefs = () => setPref('_', Date.now());
