// Общий UI: всплывашки и журнал, звуки, тосты, окна, контролы, масштаб, уведомления
import { $, $$, R, esc, ic, hm, pad, MON, reduce, mobile, prefs, setPref, bus, clamp, PDEF } from './core.js';
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
    if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); sinkCtx(); ac.onstatechange = () => bus.emit('actx', ac.state); setTimeout(sfxWarm, 1200); }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  } catch (_) { return null; }
}
// весь звук приложения (сигналы, громкость >100%, «слышать себя») — в выбранные наушники
function sinkCtx() { if (ac && ac.setSinkId) { const id = prefs.outId || ''; if ((ac.sinkId || '') !== id) ac.setSinkId(id).catch(() => {}); } }
bus.on('pref', k => { if (k === 'outId') sinkCtx(); });
export const TONES = {
  msg: [[880, .05], [1175, .08]], mention: [[988, .06], [1319, .06], [1568, .1]], join: [[523, .06], [784, .1]], leave: [[784, .06], [523, .1]],
  ring: [[440, .15], [554, .15]], ok: [[659, .05], [988, .09]], err: [[330, .08], [262, .14]], friend: [[523, .06], [659, .06], [784, .1]],
};
/* ---------- звуки действий: настоящие файлы (CC0, ui/sfx/*.ogg, громкость выровнена), синтез — только запасной ---------- */
// cat — галочка в «Уведомления → Звуки»; v — громкость относительно остальных
export const SFX_CATS = [
  ['calls', 'Звонки', 'входящий и исходящий звонок, сброс'],
  ['voice', 'Голос', 'зашёл / вышел ты или друг'],
  ['mic', 'Мик и звук', 'включил / выключил'],
  ['stream', 'Демка', 'кто-то начал или закончил показ экрана'],
  ['msg', 'Сообщения', 'новое сообщение, упоминание, друг в сети'],
  ['fun', 'Фишки', 'клипы, Зал славы, пинки, перекличка, эффекты'],
];
const SFX = {
  msg: ['msg', .55, TONES.msg], mention: ['msg', .7, TONES.mention], friend: ['msg', .6, TONES.friend], online: ['msg', .45, TONES.join],
  ring: ['calls', .8, TONES.ring], ringback: ['calls', .55, TONES.ring], hangup: ['calls', .7, TONES.leave],
  join: ['voice', .7, TONES.join], leave: ['voice', .7, TONES.leave], pjoin: ['voice', .6, [[587, .05], [880, .08]]], pleave: ['voice', .6, [[880, .05], [587, .08]]],
  mute: ['mic', .55, [[660, .04], [440, .05]]], unmute: ['mic', .55, [[660, .04], [880, .05]]], deaf: ['mic', .55, [[520, .04], [330, .06]]], undeaf: ['mic', .55, [[440, .04], [660, .05]]],
  streamon: ['stream', .6, [[523, .05], [659, .05], [784, .08]]], streamoff: ['stream', .6, [[784, .05], [523, .08]]],
  clip: ['fun', .7, [[1320, .03], [990, .05]]], hall: ['fun', .7, [[523, .1], [659, .1], [784, .1], [1047, .25]]], nudge: ['fun', .8, [[260, .05], [200, .06], [520, .05]]],
  roll: ['fun', .6, TONES.mention], tick: ['fun', .5, [[1320, .03]]], allhere: ['fun', .65, TONES.friend], say: ['fun', .5, [[880, .04], [1320, .05]]], brb: ['fun', .6, [[523, .1], [392, .14]]],
  pop: ['fun', .45, [[990, .05]]], boom: ['fun', .7, [[120, .2], [80, .3]]], cash: ['fun', .65, [[1568, .05], [2093, .08]]], confetti: ['fun', .6, [[784, .05], [988, .05], [1319, .08]]], shake: ['fun', .6, [[180, .05], [150, .08]]],
  ok: ['ui', .5, TONES.ok], err: ['ui', .55, TONES.err], egg: ['fun', .6, [[784, .05], [988, .05], [1319, .1]]],
};
const sfxBuf = new Map(); // имя → AudioBuffer | Promise
function sfxLoad(a, name) {
  if (!sfxBuf.has(name)) sfxBuf.set(name, fetch('sfx/' + name + '.ogg').then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(b => a.decodeAudioData(b)).then(b => (sfxBuf.set(name, b), b)).catch(() => (sfxBuf.set(name, null), null)));
  return sfxBuf.get(name);
}
/** все звуки заранее: первый звонок не должен ждать загрузки */
export function sfxWarm() { const a = actx(); if (a) Object.keys(SFX).forEach(n => sfxLoad(a, n)); }
export const sfxOn = cat => !!prefs.sound && !((prefs.sfxOff || {})[cat]);
/** сыграть звук действия; вернёт узел (можно остановить) или null */
export function sfx(name, vol = 1, force = false) {
  const d = SFX[name]; if (!d || (!force && !sfxOn(d[0]))) return null;
  const a = actx(); if (!a) return null;
  const b = sfxBuf.get(name);
  if (!(b instanceof AudioBuffer)) { if (b === undefined) sfxLoad(a, name); if (d[2]) toneRaw(d[2], vol, force); return null; }
  try {
    const s = a.createBufferSource(), g = a.createGain(); s.buffer = b;
    g.gain.value = d[1] * vol * clamp((prefs.notifVol ?? 70) / 70, 0, 1.5) * .9;
    s.connect(g).connect(a.destination); s.start(); s.onended = () => { try { g.disconnect(); } catch (_) {} };
    return s;
  } catch (_) { return null; }
}
/** старые вызовы tone(TONES.x) — теперь настоящие звуки */
const TONE2SFX = new Map(Object.entries(TONES).map(([k, v]) => [v, k === 'ring' ? 'ringback' : k]));
export function tone(seq, vol = 1) { const n = TONE2SFX.get(seq); if (n) { sfx(n, vol); return; } if (sfxOn('ui')) toneRaw(seq, vol); }
function toneRaw(seq, vol = 1, force = false) {
  if (!prefs.sound && !force) return;
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
  sfx(SFX[t] ? t : 'msg');
  if (say) speak(say);
  if ((prefs.flash || t === 'ring') && !(await focused())) attention(t);
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
export const fail = e => { tmsg('err', String((e && e.message) || e)); sfx('err'); };

/* ---------- окна ---------- */
const wback = $('.js-wback'); let openWin = null, lastFocus = null;
export const OPEN = {}, CLOSE = {};
export const winOpen = () => openWin;
let ghostW = null, ghostT = 0;
/** окно уезжает мягко, а не пропадает (80–170 мс), потом display:none */
function ghost(w) {
  if (ghostW && ghostW !== w) { ghostW.classList.remove('on', 'out'); }
  clearTimeout(ghostT); ghostW = w;
  if (!w) return;
  if (reduce || R.classList.contains('lite')) { w.classList.remove('on'); ghostW = null; return; }
  w.classList.add('out'); ghostT = setTimeout(() => { w.classList.remove('on', 'out'); ghostW = null; }, 170);
}
export function openW(name, opt = {}) {
  const w = $(`.win[data-win="${name}"]`, wback); if (!w) return;
  if (ghostW) { clearTimeout(ghostT); ghostW.classList.remove('on', 'out'); ghostW = null; }
  if (openWin && openWin !== name) { const ow = $(`.win[data-win="${openWin}"]`, wback); ow && ow.classList.remove('on'); CLOSE[openWin] && CLOSE[openWin](); }
  if (!openWin) lastFocus = document.activeElement;
  openWin = name; bus.emit('win', name);
  if (OPEN[name]) OPEN[name](w, opt);
  w.classList.add('on'); wback.classList.add('on'); w.scrollTop = 0;
  segScan(w);
  const f = (!mobile() && $('[data-autofocus]', w)) || $('.js-close', w);
  setTimeout(() => f && f.focus({ preventScroll: true }), 40);
  if (opt.focus) setTimeout(() => flash($(opt.focus, w)), 140);
}
/** подсветить строку настроек (переход «Эффекты голоса» → нужное место) */
export function flash(el) {
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1700);
}
export function closeW(force) {
  if (!openWin) return;
  const w = $(`.win[data-win="${openWin}"]`, wback);
  if (!force && w && w.dataset.lock) return;
  ghost(w); wback.classList.remove('on');
  const n = openWin; openWin = null; CLOSE[n] && CLOSE[n](); bus.emit('win', '');
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
  const b = t.closest('.seg button'); if (b && !b.disabled) { $$('button', b.parentElement).forEach(x => x.setAttribute('aria-pressed', String(x === b))); segPill(b.parentElement); }
  const s = t.closest('.swatches button'); if (s) $$('button', s.parentElement).forEach(x => x.setAttribute('aria-pressed', String(x === s)));
}, true);
export function segSet(seg, v) { if (!seg) return; $$('button', seg).forEach(x => x.setAttribute('aria-pressed', String(String(x.dataset.v ?? x.dataset.g ?? x.dataset.c ?? '') === String(v)))); segPill(seg); }
/** «капля» сегмента переезжает к выбранной кнопке; пока сегмент не виден — без анимации */
export function segPill(seg, instant) {
  if (!seg || !seg.classList || !seg.classList.contains('seg')) return;
  const b = $('button[aria-pressed="true"]', seg);
  if (!b || !b.offsetWidth) { seg.classList.remove('has'); return; }
  seg.classList.add('slide');
  const jump = instant || !seg.classList.contains('has');
  if (jump) seg.classList.add('ready');
  seg.style.setProperty('--sx', b.offsetLeft + 'px'); seg.style.setProperty('--sy', b.offsetTop + 'px');
  seg.style.setProperty('--sw', b.offsetWidth + 'px'); seg.style.setProperty('--sh', b.offsetHeight + 'px');
  seg.classList.add('has');
  if (jump) requestAnimationFrame(() => requestAnimationFrame(() => seg.classList.remove('ready')));
}
const segRO = typeof ResizeObserver === 'function' ? new ResizeObserver(es => es.forEach(e => segPill(e.target, true))) : null;
const segSeen = new WeakSet();
export function segScan(root = document) {
  $$('.seg', root).forEach(s => { if (s.closest('.epk')) return; if (segRO && !segSeen.has(s)) { segSeen.add(s); segRO.observe(s); } segPill(s, true); });
}
setTimeout(() => segScan(), 0);
export const segGet = seg => { const b = seg && $('button[aria-pressed="true"]', seg); return b ? (b.dataset.v ?? b.dataset.c ?? '') : ''; };
export function rgv(r) {
  const v = +r.value, mn = +r.min || 0, mx = +r.max || 100;
  r.style.setProperty('--v', ((v - mn) / (mx - mn) * 100).toFixed(1) + '%');
  const o = r.parentElement.querySelector('.rgv'); if (o) o.textContent = v + (r.dataset.unit ?? '%');
}
document.addEventListener('input', e => { if (e.target.classList && e.target.classList.contains('rg')) rgv(e.target); });
// ползунки: «тянется» (подсветка значения), двойной клик — вернуть значение по умолчанию
let rgDrag = null;
const rgEnd = () => { if (rgDrag) { rgDrag.classList.remove('drag'); rgDrag = null; } };
document.addEventListener('pointerdown', e => {
  const r = e.target.closest && e.target.closest('.rg'); if (!r || !r.parentElement) return;
  rgDrag = r.parentElement; rgDrag.classList.add('drag');
}, true);
addEventListener('pointerup', rgEnd, true); addEventListener('pointercancel', rgEnd, true); addEventListener('blur', rgEnd);
document.addEventListener('dblclick', e => {
  const r = e.target.closest && e.target.closest('.rg[data-pref]'); if (!r) return;
  const d = PDEF[r.dataset.pref]; if (typeof d !== 'number' || +r.value === d) return;
  r.value = d; rgv(r);
  r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
  const o = r.parentElement.querySelector('.rgv'); if (o) { o.classList.remove('reset'); void o.offsetWidth; o.classList.add('reset'); }
});
setTimeout(() => $$('.rg[data-pref]').forEach(r => { if (!r.title) r.title = 'Двойной клик — как было по умолчанию'; }), 0);
// клик по строке настройки с одним переключателем — щёлкает переключатель (как в Discord)
document.addEventListener('click', e => {
  const row = e.target.closest && e.target.closest('.row'); if (!row) return;
  if (e.target.closest('input,button,select,textarea,a,label,.rgw,.seg,[contenteditable]')) return;
  const tgs = $$('input.tg', row); if (tgs.length !== 1) return;
  const t = tgs[0]; if (t.disabled || row.querySelector('select,input[type=range],input[type=text],.seg')) return;
  t.checked = !t.checked; t.dispatchEvent(new Event('change', { bubbles: true })); t.dispatchEvent(new Event('input', { bubbles: true }));
});
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
