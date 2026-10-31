// Общий UI: всплывашки и журнал, звуки, тосты, окна, контролы, масштаб, уведомления
import { $, $$, R, esc, ic, hm, pad, MON, reduce, mobile, prefs, setPref, bus, clamp } from './core.js';
import { attention, focused, inTauri } from './api.js';

export const app = $('.js-app');

/* ---------- всплывашка снизу и журнал ---------- */
// tmsg(k, text) — короткая всплывашка (одна за раз); tmsg(k, text, true) — только в журнал (логи ядра и мелочи)
export const JOURNAL = [];
const snack = document.createElement('div'); snack.className = 'snack'; snack.setAttribute('role', 'status'); snack.setAttribute('aria-live', 'polite');
document.body.appendChild(snack);
let snT = 0;
snack.addEventListener('click', () => { snack.classList.remove('on'); clearTimeout(snT); });
snack.addEventListener('pointerenter', () => clearTimeout(snT));
snack.addEventListener('pointerleave', () => { if (snack.classList.contains('on')) snT = setTimeout(() => snack.classList.remove('on'), 1500); });
export function journal(k, text, src = 'hunty') {
  JOURNAL.push({ t: Date.now(), k: String(k || 'ok'), text: String(text || ''), src });
  if (JOURNAL.length > 400) JOURNAL.splice(0, JOURNAL.length - 400);
  bus.emit('journal');
}
export function tmsg(k, text, auto) {
  journal(k, text, auto ? 'ядро' : 'hunty');
  if (auto) return;
  const cls = k === 'err' ? 'err' : k === 'warn' ? 'warn' : k === 'ping' ? 'ping' : 'ok';
  snack.innerHTML = `<span class="st ${cls}" aria-hidden="true"></span><span class="mt"></span>`;
  snack.querySelector('.mt').textContent = text;
  snack.className = 'snack glass ' + cls; void snack.offsetWidth; snack.classList.add('on');
  clearTimeout(snT); snT = setTimeout(() => snack.classList.remove('on'), cls === 'err' ? 6000 : Math.min(6500, 2400 + String(text).length * 35));
}
bus.on('snack', (k, text) => tmsg(k, text));

/* ---------- звук ---------- */
let ac;
export function actx() {
  try {
    if (!ac && navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); sinkCtx(); }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  } catch (_) { return null; }
}
// весь звук приложения (сигналы, громкость >100%, «слышать себя») — в выбранные наушники
function sinkCtx() { if (ac && ac.setSinkId) { const id = prefs.outId || ''; if ((ac.sinkId || '') !== id) ac.setSinkId(id).catch(() => {}); } }
bus.on('pref', k => { if (k === 'outId') sinkCtx(); });
export function tone(seq, vol = 1) {
  if (!prefs.sound) return;
  const a = actx(); if (!a) return;
  try {
    const g0 = .07 * (prefs.notifVol / 70) * vol; let t = a.currentTime + .01;
    for (const [f, d] of seq) {
      const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.0002, g0), t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + d * 1.6);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + d * 1.6 + .03); t += d * .85;
    }
  } catch (_) {}
}
export const TONES = {
  msg: [[880, .05], [1175, .08]], mention: [[988, .06], [1319, .06], [1568, .1]], join: [[523, .06], [784, .1]], leave: [[784, .06], [523, .1]],
  ring: [[440, .15], [554, .15]], ok: [[659, .05], [988, .09]], err: [[330, .08], [262, .14]], friend: [[523, .06], [659, .06], [784, .1]],
};
let voices = [];
function loadVoices() { try { voices = speechSynthesis.getVoices(); bus.emit('voices', voices); } catch (_) {} }
try { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; } catch (_) {}
export const ttsVoices = () => voices;
export function speak(text, force) {
  if (!force && !prefs.say) return;
  try {
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ru-RU'; u.volume = clamp(prefs.notifVol / 100, 0, 1); u.rate = 1.05;
    const v = voices.find(v => v.name === prefs.voiceName) || voices.find(v => /^ru/i.test(v.lang)); if (v) u.voice = v;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (_) {}
}
export const dnd = () => prefs.dnd && prefs.dnd > Date.now();
/** уведомление: звук + голос + мигание в панели задач (если окно не в фокусе) */
export async function notify({ tone: t = 'msg', say, force } = {}) {
  if (dnd() && !force) return;
  tone(TONES[t] || TONES.msg);
  if (say) speak(say);
  if (prefs.flash && !(await focused())) attention();
  // браузерный режим: вкладка свёрнута — показываем системное уведомление
  if (!inTauri && say && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification('Hunty', { body: say, icon: '/icon.png', tag: 'hunty-' + t, silent: true }); n.onclick = () => { window.focus(); n.close(); }; } catch (_) {}
  }
}

/* ---------- глитч ---------- */
export function glitch() { if (reduce) return; const f = document.createElement('div'); f.className = 'flash'; document.body.appendChild(f); setTimeout(() => f.remove(), 700); }

/* ---------- тосты ---------- */
const toastsEl = $('.js-toasts');
export function toast({ ava, icon, title, sub, tag, dur = 0, cd = 0, actions = [], onTimeout, cls = '' }) {
  const t = document.createElement('div'); t.className = 'toast glass ' + cls; t.setAttribute('role', 'status');
  t.innerHTML = `<div class="tt">${ava ? `<span class="tav"><img class="ava" alt="" src="${ava}">${icon ? `<span class="tbadge">${ic(icon)}</span>` : ''}</span>` : icon ? `<span class="tav ti">${ic(icon)}</span>` : ''}<span class="tw"><b>${esc(title)}</b><small>${esc(sub || '')}</small></span>${tag ? `<span class="tk">${esc(tag)}</span>` : ''}</div>${cd ? `<div class="tbar" style="--d:${cd}s"><i></i></div>` : ''}${actions.length ? `<div class="ta">${actions.map((a, i) => `<button class="${a.cls || 'gbtn'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;
  t.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; const a = actions[+b.dataset.i]; if (!(a && a.keep)) closeToast(t); a && a.fn && a.fn(); });
  toastsEl.appendChild(t); while (toastsEl.children.length > 4) toastsEl.firstElementChild.remove();
  if (cd) {
    let s = cd; const tk = $('.tk', t); if (tk) tk.textContent = s + ' сек';
    const iv = setInterval(() => { if (!t.isConnected || t.classList.contains('out')) { clearInterval(iv); return; } s--; if (tk) tk.textContent = s + ' сек'; if (s <= 0) { clearInterval(iv); closeToast(t); onTimeout && onTimeout(); } }, 1000);
  } else if (dur) setTimeout(() => closeToast(t), dur);
  bus.emit('toast', t);
  return t;
}
export function closeToast(t) { if (!t || !t.isConnected || t.classList.contains('out')) return; t.classList.add('out'); setTimeout(() => t.remove(), 280); }
export const fail = e => { tmsg('err', String((e && e.message) || e)); tone(TONES.err); };

/* ---------- окна ---------- */
const wback = $('.js-wback'); let openWin = null, lastFocus = null;
export const OPEN = {}, CLOSE = {};
export const winOpen = () => openWin;
export function openW(name, opt = {}) {
  const w = $(`.win[data-win="${name}"]`, wback); if (!w) return;
  if (openWin && openWin !== name) { const ow = $(`.win[data-win="${openWin}"]`, wback); ow && ow.classList.remove('on'); CLOSE[openWin] && CLOSE[openWin](); }
  if (!openWin) lastFocus = document.activeElement;
  openWin = name; bus.emit('win', name);
  if (OPEN[name]) OPEN[name](w, opt);
  w.classList.add('on'); wback.classList.add('on'); w.scrollTop = 0;
  const f = (!mobile() && $('[data-autofocus]', w)) || $('.js-close', w);
  setTimeout(() => f && f.focus({ preventScroll: true }), 40);
}
export function closeW(force) {
  if (!openWin) return;
  const w = $(`.win[data-win="${openWin}"]`, wback);
  if (!force && w && w.dataset.lock) return;
  w && w.classList.remove('on'); wback.classList.remove('on');
  const n = openWin; openWin = null; CLOSE[n] && CLOSE[n]();
  if (lastFocus && document.contains(lastFocus) && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}
wback.addEventListener('click', e => { if (e.target === wback) closeW(); });
document.addEventListener('click', e => {
  const t = e.target; if (!(t instanceof Element)) return;
  const cp = t.closest('.js-copy'); if (cp) { copy(cp); return; }
  if (t.closest('.js-close')) { closeW(); return; }
  const w = t.closest('button[data-win]'); if (w && !w.disabled) { e.preventDefault(); openW(w.dataset.win, { tab: w.dataset.tab }); }
});
/* общие контролы: сегменты и палитры */
document.addEventListener('click', e => {
  const t = e.target; if (!(t instanceof Element)) return;
  const b = t.closest('.seg button'); if (b && !b.disabled) $$('button', b.parentElement).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  const s = t.closest('.swatches button'); if (s) $$('button', s.parentElement).forEach(x => x.setAttribute('aria-pressed', String(x === s)));
}, true);
export function segSet(seg, v) { if (!seg) return; $$('button', seg).forEach(x => x.setAttribute('aria-pressed', String(String(x.dataset.v ?? x.dataset.g ?? x.dataset.c ?? '') === String(v)))); }
export const segGet = seg => { const b = seg && $('button[aria-pressed="true"]', seg); return b ? (b.dataset.v ?? b.dataset.c ?? '') : ''; };
export function rgv(r) {
  const v = +r.value, mn = +r.min || 0, mx = +r.max || 100;
  r.style.setProperty('--v', ((v - mn) / (mx - mn) * 100).toFixed(1) + '%');
  const o = r.parentElement.querySelector('.rgv'); if (o) o.textContent = v + (r.dataset.unit ?? '%');
}
document.addEventListener('input', e => { if (e.target.classList && e.target.classList.contains('rg')) rgv(e.target); });
export function copy(b) {
  const v = b.dataset.copy || ''; if (!v) return;
  if (!b.dataset.label) b.dataset.label = b.innerHTML; const old = b.dataset.label;
  const ok = () => { b.innerHTML = ic('check') + 'Скопировано'; b.classList.add('done'); setTimeout(() => { b.innerHTML = old; b.classList.remove('done'); }, 1400); };
  copyText(v).then(ok, ok);
}
export async function copyText(v) {
  try { await navigator.clipboard.writeText(v); return true; }
  catch (_) { const ta = document.createElement('textarea'); ta.value = v; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (_) {} ta.remove(); return true; }
}
// Esc: сначала меню (своё, в menu.js), потом картинка на весь экран, потом окно
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const lb = $('.js-lbox'); if (lb && !lb.hidden) { e.preventDefault(); lb.hidden = true; return; }
  if (openWin) { e.preventDefault(); closeW(); }
});

/* ---------- масштаб под окно ---------- */
const MINH = 600;
export function fit() {
  const w = innerWidth, h = innerHeight, k = (prefs.scale || 100) / 100;
  if (w <= 640) { app.style.zoom = ''; app.style.height = ''; return; }
  const z = Math.min(1, w / (app.classList.contains('calm') ? 880 : 1180)) * k;
  app.style.zoom = z !== 1 ? String(z) : '';
  app.style.height = Math.round(Math.max(h / z, MINH)) + 'px';
  bus.emit('fit');
}
addEventListener('resize', fit);
// Ctrl+колёсико, Ctrl+= / Ctrl+- / Ctrl+0 — свой масштаб (браузерный зум выключен)
bus.on('zoom', d => {
  const v = d === 0 ? 100 : clamp((prefs.scale || 100) + d * 5, 80, 130);
  if (v === prefs.scale) return;
  setPref('scale', v); fit(); tmsg('ok', 'масштаб ' + v + '%' + (d ? ' · Ctrl+0 — как было' : ''));
});

/* ---------- тик раз в секунду (таймеры звонка и т.п.) ---------- */
setInterval(() => bus.emit('tick', new Date()), 1000);
export { pad };
