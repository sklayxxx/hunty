// Эффекты сообщений: конфетти, бум, деньги, тряска. Канвас поверх окна, частицы — без библиотек.
// Видишь эффект, только если чат открыт и окно в фокусе; иначе он ждёт, пока зайдёшь (до 10 минут).
import { $, prefs, setPref, bus } from './core.js';
import { S, myId } from './state.js';
import { sfx, winOpen } from './ui.js';
import { still } from './motion.js';
import { emoKey, emoSrc } from './emoji.js';
import { onCtx } from './menu.js';
import { FX, fxOf } from './fxdef.js';
import { submitText } from './chat.js';

const cv = document.createElement('canvas'); cv.className = 'fxcv'; cv.setAttribute('aria-hidden', 'true'); document.body.appendChild(cv);
const g = cv.getContext('2d');
let parts = [], raf = 0, W = 0, H = 0, dpr = 1, flash = 0;
const imgs = new Map();
function emoImgEl(e) {
  const k = emoKey(e); if (!k) return null;
  if (!imgs.has(k)) { const im = new Image(); im.src = emoSrc(k); imgs.set(k, im); }
  return imgs.get(k);
}
function size() { dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
const rnd = (a, b) => a + Math.random() * (b - a);
const COLORS = ['#ff6fb5', '#ffd56b', '#8dff8a', '#5fe3ff', '#9d7bff', '#ff8a5c', '#ffffff'];

function loop() {
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  if (flash > 0) { g.fillStyle = `rgba(255,240,210,${flash})`; g.fillRect(0, 0, W, H); flash = Math.max(0, flash - .045); }
  const now = performance.now();
  parts = parts.filter(p => now - p.t0 < p.life);
  for (const p of parts) {
    const t = (now - p.t0) / p.life;
    p.vx *= p.drag; p.vy = p.vy * p.drag + p.gy; p.x += p.vx; p.y += p.vy; p.r += p.vr;
    const a = t > .75 ? 1 - (t - .75) / .25 : 1;
    g.save(); g.globalAlpha = Math.max(0, a);
    if (p.k === 'rect') { g.translate(p.x, p.y); g.rotate(p.r); g.scale(1, Math.cos(p.r * 2.3)); g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); }
    else if (p.k === 'emo' && p.im && p.im.complete && p.im.naturalWidth) { g.translate(p.x, p.y); g.rotate(p.r); g.drawImage(p.im, -p.s / 2, -p.s / 2, p.s, p.s); }
    else if (p.k === 'spark') { g.globalCompositeOperation = 'lighter'; g.strokeStyle = p.c; g.lineWidth = 2.2; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); g.stroke(); }
    else if (p.k === 'ring') { const rr = p.s * (1 - (1 - t) ** 3); g.strokeStyle = p.c; g.lineWidth = 6 * (1 - t) + 1; g.beginPath(); g.arc(p.x, p.y, rr, 0, Math.PI * 2); g.stroke(); }
    g.restore();
  }
  if (parts.length || flash > 0) raf = requestAnimationFrame(loop);
  else { raf = 0; cv.classList.remove('on'); g.clearRect(0, 0, W, H); }
}
function run() { if (!raf) { size(); cv.classList.add('on'); raf = requestAnimationFrame(loop); } }
const P = o => ({ x: 0, y: 0, vx: 0, vy: 0, gy: .18, drag: .985, r: 0, vr: 0, s: 10, c: '#fff', k: 'rect', life: 2600, t0: performance.now(), ...o });
const paneRect = () => { const p = $('.pane.chat') || document.body; return p.getBoundingClientRect(); };

function confetti(x, y) {
  for (let i = 0; i < 150; i++) { const a = rnd(-Math.PI * .92, -Math.PI * .08), v = rnd(7, 17); parts.push(P({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vr: rnd(-.25, .25), s: rnd(7, 13), c: COLORS[i % COLORS.length], gy: .28, drag: .972, life: rnd(2200, 3600) })); }
  const im = emoImgEl('🎉'); for (let i = 0; i < 6; i++) parts.push(P({ k: 'emo', im, x: x + rnd(-40, 40), y, vx: rnd(-6, 6), vy: rnd(-14, -8), vr: rnd(-.1, .1), s: rnd(28, 40), gy: .32, life: 2400 }));
}
function boom(x, y) {
  flash = .35;
  parts.push(P({ k: 'ring', x, y, s: Math.max(W, H) * .45, c: 'rgba(255,200,120,.9)', life: 700, gy: 0 }));
  parts.push(P({ k: 'ring', x, y, s: Math.max(W, H) * .28, c: 'rgba(255,255,255,.8)', life: 520, gy: 0 }));
  for (let i = 0; i < 90; i++) { const a = rnd(0, Math.PI * 2), v = rnd(6, 20); parts.push(P({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, gy: .12, drag: .93, c: ['#ffd56b', '#ff8a5c', '#fff3c2'][i % 3], life: rnd(500, 1000) })); }
  const im = emoImgEl('💥'); parts.push(P({ k: 'emo', im, x, y, s: 120, gy: 0, drag: 1, life: 600 }));
}
function money() {
  const r = paneRect(), im = emoImgEl('💸'), im2 = emoImgEl('💵');
  for (let i = 0; i < 46; i++) parts.push(P({ k: 'emo', im: i % 3 ? im2 : im, x: rnd(r.left + 10, r.right - 10), y: r.top - rnd(20, 420), vx: rnd(-1, 1), vy: rnd(1.5, 4), gy: .05, drag: .99, vr: rnd(-.05, .05), r: rnd(-.4, .4), s: rnd(26, 40), life: rnd(2800, 4200) }));
}
function shakeEl(el, amp = 9) {
  if (!el || !el.animate) return;
  const k = []; for (let i = 0; i <= 10; i++) { const d = amp * (1 - i / 10); k.push({ transform: i === 10 ? 'none' : `translate(${(i % 2 ? -1 : 1) * d}px, ${rnd(-d, d) * .4}px) rotate(${(i % 2 ? -1 : 1) * d * .08}deg)` }); }
  el.animate(k, { duration: 620, easing: 'ease-out' });
}

/** показать эффект k; el — сообщение (откуда летит и что подсветить) */
export function playFx(k, el) {
  const f = FX[k]; if (!f) return;
  sfx(f.sfx, .8);
  if (el) { el.classList.remove('fxgo'); void el.offsetWidth; el.classList.add('fxgo'); setTimeout(() => el.classList.remove('fxgo'), 1600); }
  if (still()) return;
  size();
  const r = el ? el.getBoundingClientRect() : paneRect(), x = r.left + Math.min(r.width, 240) / 2, y = r.top + r.height / 2;
  if (k === 'confetti') confetti(x, Math.min(y, H - 40));
  else if (k === 'boom') { boom(x, y); shakeEl($('.pane.chat'), 12); }
  else if (k === 'money') money();
  else if (k === 'shake') { shakeEl($('.pane.chat'), 10); shakeEl($('.js-form'), 6); }
  run();
}

/* ---------- вживую: пришло сообщение с эффектом ---------- */
const pend = new Map(); let lastAt = 0;
const seeing = room => room === S.cur && document.visibilityState === 'visible' && document.hasFocus() && !winOpen();
const elOf = (room, id) => document.querySelector(`.log[data-chat="${CSS.escape(room)}"] .m[data-id="${CSS.escape(id)}"]`);
function go(room, id, k) {
  if (Date.now() - lastAt < 900) return; lastAt = Date.now();
  requestAnimationFrame(() => playFx(k, elOf(room, id)));
}
bus.on('msg', (room, m) => {
  if (!m || prefs.fxMsg === false) return;
  const k = fxOf(m); if (!k || Date.now() - (m.ts || 0) > 10 * 60 * 1000) return;
  if (m.from === myId()) { go(m.room, m.id, k); return; }
  if (seeing(m.room)) go(m.room, m.id, k); else pend.set(m.room, { id: m.id, k });
});
function flush() {
  const p = S.cur && pend.get(S.cur); if (!p || !seeing(S.cur)) return;
  pend.delete(S.cur); setTimeout(() => go(S.cur, p.id, p.k), 350);
}
bus.on('open', flush);
bus.on('win', n => { if (!n) flush(); });
addEventListener('focus', flush);
document.addEventListener('visibilitychange', flush);
addEventListener('resize', () => { if (raf) size(); });

// нажал на чип под сообщением — ещё раз
document.addEventListener('click', e => {
  const b = e.target instanceof Element && e.target.closest('.log .fxb'); if (!b) return;
  e.preventDefault(); playFx(b.dataset.fx, b.closest('.m'));
});

// правый клик по «Отправить» — отправить с эффектом
onCtx('.js-form .send', () => [
  { head: 'Отправить с эффектом', sub: 'друзья увидят, когда откроют чат' },
  ...Object.entries(FX).map(([k, f]) => ({ emo: f.emo, label: f.label, sub: f.sub, fn: () => submitText({ fx: k }, f.emo) })),
  '-',
  { label: 'Показывать эффекты', check: prefs.fxMsg !== false, fn: () => setPref('fxMsg', prefs.fxMsg === false) },
]);
