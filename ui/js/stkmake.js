// Свой стикер как в TikTok: фотка → вырезал (сам или по обводке) → ластик/кисть → белая обводка → покрытие.
// Вырезалка — cutout.js (без нейросетей и серверов). Готовый стикер — webp до ~180 КБ, уходит картинкой.
import { $, $$, bus, clamp } from './core.js';
import { S } from './state.js';
import { openW, closeW, OPEN, CLOSE, tmsg, fail, sfx, winOpen } from './ui.js';
import { addSticker } from './stickers.js';
import { sendSticker } from './chat.js';
import { cutout, edt } from './cutout.js';

const W = $('.win[data-win="stkmake"]');
const stage = $('.js-skstage', W), cv = $('.js-skcv', W), cx = cv.getContext('2d');
const drop = $('.js-skdrop', W), busy = $('.js-skbusy', W), hint = $('.js-skhint', W), tools = $('.js-sktool', W);
const pvImg = $('.js-skimg', W), pvFx = $('.js-skfx', W), pv0 = $('.js-skpv0', W), nameI = $('.js-skname', W), brI = $('.js-skbr', W);
const EDIT = 384, OUT = 384;
const E = { img: null, rgba: null, w: 0, h: 0, mask: null, tmp: null, undo: [], tool: 'auto', pts: null, cur: null, draw: null, stroke: 1, fin: '', out: '' };
const HINT = {
  auto: 'Вырезал сам. Не то? Жми «Обвести» и обведи объект пальцем — или подотри ластиком.',
  lasso: 'Обведи то, что нужно вырезать, — остальное уберу.',
  erase: 'Сотри лишнее. Размер кисти — ползунок или колесо мыши.',
  restore: 'Верни то, что срезалось лишнего.',
  full: 'Без выреза: вся картинка со скруглёнными углами.',
};
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2 = c => c.getContext('2d', { willReadFrequently: true });

/* ---------- фото ---------- */
const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true; document.body.appendChild(file);
file.addEventListener('change', () => { const f = file.files && file.files[0]; file.value = ''; if (f) load(f, f.name); });
const pick = () => file.click();
$$('.js-skpick', W).forEach(b => b.addEventListener('click', pick));

async function load(src, name = '') {
  try {
    const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
    if (!/^image\//.test(blob.type || 'image/')) throw new Error('это не картинка');
    const bm = await createImageBitmap(blob);
    const k = Math.min(1, EDIT / Math.max(bm.width, bm.height)), w = Math.max(8, Math.round(bm.width * k)), h = Math.max(8, Math.round(bm.height * k));
    E.img = mk(w, h); const c = ctx2(E.img); c.drawImage(bm, 0, 0, w, h); bm.close && bm.close();
    E.rgba = c.getImageData(0, 0, w, h).data; E.w = w; E.h = h;
    E.mask = mk(w, h); E.tmp = mk(w, h); E.undo = []; E.pts = null;
    if (name && !nameI.value) nameI.value = String(name).replace(/\.[^.]+$/, '').slice(0, 40);
    drop.hidden = true; fitView();
    setTool('auto');
  } catch (e) { fail(e && e.message === 'это не картинка' ? e : new Error('не открылась картинка')); }
}

/* ---------- вид ---------- */
function fitView() {
  if (!E.img) return;
  const r = stage.getBoundingClientRect(), k = Math.min((r.width - 16) / E.w, (r.height - 16) / E.h), dpr = Math.min(2, devicePixelRatio || 1);
  const cw = Math.max(40, Math.floor(E.w * k)), ch = Math.max(40, Math.floor(E.h * k));
  cv.style.width = cw + 'px'; cv.style.height = ch + 'px'; cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  paint();
}
new ResizeObserver(() => { if (winOpen() === 'stkmake') fitView(); }).observe(stage);
function masked() {
  const t = ctx2(E.tmp); t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, E.w, E.h); t.drawImage(E.img, 0, 0);
  t.globalCompositeOperation = 'destination-in'; t.drawImage(E.mask, 0, 0); t.globalCompositeOperation = 'source-over';
  return E.tmp;
}
function paint() {
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height);
  if (!E.img) return;
  const k = cv.width / E.w; cx.setTransform(k, 0, 0, k, 0, 0);
  cx.globalAlpha = .22; cx.drawImage(E.img, 0, 0); cx.globalAlpha = 1;
  cx.drawImage(masked(), 0, 0);
  if (E.pts && E.pts.length > 1) {
    cx.beginPath(); E.pts.forEach(([x, y], i) => i ? cx.lineTo(x, y) : cx.moveTo(x, y));
    cx.lineJoin = cx.lineCap = 'round'; cx.setLineDash([]); cx.lineWidth = 4 / k; cx.strokeStyle = 'rgba(0,0,0,.55)'; cx.stroke();
    cx.setLineDash([7 / k, 6 / k]); cx.lineWidth = 2 / k; cx.strokeStyle = '#fff'; cx.stroke(); cx.setLineDash([]);
  }
  if (E.cur && (E.tool === 'erase' || E.tool === 'restore')) {
    cx.beginPath(); cx.arc(E.cur[0], E.cur[1], brush() / 2, 0, Math.PI * 2);
    cx.lineWidth = 1.5 / k; cx.strokeStyle = E.tool === 'erase' ? 'rgba(255,120,140,.95)' : 'rgba(140,255,190,.95)'; cx.stroke();
  }
}
const brush = () => +brI.value * E.w / Math.max(1, parseFloat(cv.style.width) || E.w);

/* ---------- инструменты ---------- */
function pushUndo() { if (!E.mask) return; E.undo.push(ctx2(E.mask).getImageData(0, 0, E.w, E.h)); if (E.undo.length > 14) E.undo.shift(); }
function undo() { const d = E.undo.pop(); if (!d) return; ctx2(E.mask).putImageData(d, 0, 0); paint(); preview(); }
$('.js-skundo', W).addEventListener('click', undo);
function setMask(alpha) {
  const id = new ImageData(E.w, E.h), d = id.data;
  for (let p = 0; p < alpha.length; p++) { d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = 255; d[p * 4 + 3] = alpha[p]; }
  ctx2(E.mask).putImageData(id, 0, 0);
}
async function cut(mode, pts) {
  busy.hidden = false; await new Promise(r => requestAnimationFrame(() => setTimeout(r, 16)));
  try {
    const { alpha, area } = cutout(E.rgba, E.w, E.h, mode, pts);
    if (area < 0.004) { tmsg('warn', mode === 'lasso' ? 'внутри обводки ничего не нашёл — обведи пошире' : 'не понял, что вырезать — обведи объект пальцем'); if (mode === 'auto') full(); }
    else setMask(alpha);
  } catch (e) { console.warn('cutout', e); full(); }
  busy.hidden = true; paint(); preview();
}
function full() {
  const c = ctx2(E.mask); c.clearRect(0, 0, E.w, E.h); c.fillStyle = '#fff';
  const r = Math.min(E.w, E.h) * .09; c.beginPath(); c.roundRect ? c.roundRect(0, 0, E.w, E.h, r) : c.rect(0, 0, E.w, E.h); c.fill();
}
function setTool(t) {
  E.tool = t; $$('button', tools).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === t)));
  hint.textContent = HINT[t] || ''; $('.js-sksize', W).hidden = !(t === 'erase' || t === 'restore');
  stage.dataset.tool = t;
  if (!E.img) return;
  if (t === 'auto') { pushUndo(); cut('auto'); }
  else if (t === 'full') { pushUndo(); full(); paint(); preview(); }
}
tools.addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (!b) return; if (!E.img) { pick(); return; } setTool(b.dataset.t); });

/* ---------- рисование: обводка и кисти ---------- */
const at = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * E.w / r.width, (e.clientY - r.top) * E.h / r.height]; };
cv.addEventListener('pointerdown', e => {
  if (!E.img || e.button > 0) return;
  try { cv.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault();
  const p = at(e);
  if (E.tool === 'lasso' || E.tool === 'auto' || E.tool === 'full') { if (E.tool !== 'lasso') setTool('lasso'); E.pts = [p]; E.draw = 'lasso'; }
  else { pushUndo(); E.draw = E.tool; E.last = p; dab(p, p); }
  paint();
});
cv.addEventListener('pointermove', e => {
  if (!E.img) return;
  const p = at(e); E.cur = p;
  if (E.draw === 'lasso') { const l = E.pts[E.pts.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 2) E.pts.push(p); }
  else if (E.draw) { dab(E.last, p); E.last = p; }
  paint();
});
const end = () => {
  if (!E.draw) return;
  const d = E.draw; E.draw = null;
  if (d === 'lasso') {
    const pts = E.pts; E.pts = null;
    if (pts && pts.length > 8) { pushUndo(); cut('lasso', pts); } else paint();
  } else preview();
};
cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
cv.addEventListener('pointerleave', () => { E.cur = null; if (!E.draw) paint(); });
function dab(a, b) {
  const c = ctx2(E.mask);
  c.globalCompositeOperation = E.draw === 'erase' ? 'destination-out' : 'source-over';
  c.strokeStyle = c.fillStyle = '#fff'; c.lineWidth = brush(); c.lineCap = c.lineJoin = 'round';
  c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0] + .01, b[1]); c.stroke();
  c.globalCompositeOperation = 'source-over';
}
cv.addEventListener('wheel', e => { if (E.tool !== 'erase' && E.tool !== 'restore') return; e.preventDefault(); brI.value = clamp(+brI.value - Math.sign(e.deltaY) * 3, +brI.min, +brI.max); paint(); }, { passive: false });
brI.addEventListener('input', paint);

/* перетащить / вставить картинку */
stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('over'); });
stage.addEventListener('dragleave', () => stage.classList.remove('over'));
stage.addEventListener('drop', e => { e.preventDefault(); stage.classList.remove('over'); const f = [...(e.dataTransfer.files || [])].find(f => /^image\//.test(f.type)); if (f) load(f, f.name); });
document.addEventListener('paste', e => {
  if (winOpen() !== 'stkmake' || document.activeElement === nameI) return;
  const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(f => /^image\//.test(f.type)); if (f) { e.preventDefault(); load(f, ''); }
});
W.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && document.activeElement !== nameI) { e.preventDefault(); undo(); } });

/* ---------- сборка стикера: кроп по маске, белая обводка (EDT), webp ---------- */
const SW = [0, .032, .058];
export function compose() {
  if (!E.img) return '';
  const md = ctx2(E.mask).getImageData(0, 0, E.w, E.h).data;
  let x0 = E.w, y0 = E.h, x1 = -1, y1 = -1;
  for (let y = 0; y < E.h; y++) for (let x = 0; x < E.w; x++) if (md[(y * E.w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return '';
  const sw = Math.round(SW[E.stroke] * OUT), pad = sw + 4, bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const k = Math.min((OUT - 2 * pad) / bw, (OUT - 2 * pad) / bh, 3), dw = bw * k, dh = bh * k, ox = (OUT - dw) / 2, oy = (OUT - dh) / 2;
  const c1 = mk(OUT, OUT), g1 = ctx2(c1); g1.imageSmoothingQuality = 'high'; g1.drawImage(masked(), x0, y0, bw, bh, ox, oy, dw, dh);
  const F = mk(OUT, OUT), gf = F.getContext('2d');
  if (sw) {
    const a = g1.getImageData(0, 0, OUT, OUT).data, bin = new Uint8Array(OUT * OUT);
    for (let p = 0; p < bin.length; p++) bin[p] = a[p * 4 + 3] > 110 ? 1 : 0;
    const d2 = edt(bin, OUT, OUT), o = new ImageData(OUT, OUT), od = o.data;
    for (let p = 0; p < bin.length; p++) { const v = clamp(sw + .5 - Math.sqrt(d2[p]), 0, 1); od[p * 4] = od[p * 4 + 1] = od[p * 4 + 2] = 255; od[p * 4 + 3] = Math.round(v * 255); }
    const co = mk(OUT, OUT); co.getContext('2d').putImageData(o, 0, 0);
    // чуть заметная тень внутри обводки — объект «лежит» на наклейке
    gf.drawImage(co, 0, 0);
    gf.save(); gf.shadowColor = 'rgba(0,0,0,.22)'; gf.shadowBlur = 3; gf.shadowOffsetY = 1; gf.drawImage(c1, 0, 0); gf.restore();
  } else gf.drawImage(c1, 0, 0);
  let q = .9, url = F.toDataURL('image/webp', q);
  while (url.length > 180000 && q > .5) { q -= .12; url = F.toDataURL('image/webp', q); }
  if (!url.startsWith('data:image/webp')) url = F.toDataURL('image/png');
  return url;
}
let pvT = 0;
function preview() {
  clearTimeout(pvT);
  pvT = setTimeout(() => {
    E.out = compose();
    pvImg.hidden = !E.out; pv0.hidden = !!E.out;
    if (E.out) { pvImg.src = E.out; pvFx.style.setProperty('--m', `url("${E.out}")`); }
    pvFx.className = 'stkfx js-skfx' + (E.fin ? ' ' + E.fin + ' loop' : '');
    syncBtns();
  }, 90);
}
function segSync(el, v) { $$('button', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(v)))); }
$('.js-skstroke', W).addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; E.stroke = +b.dataset.v; segSync(e.currentTarget, E.stroke); preview(); });
$('.js-skfin', W).addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; E.fin = b.dataset.v; segSync(e.currentTarget, E.fin); preview(); });

/* ---------- сохранить / отправить ---------- */
const canSend = () => !!S.cur && !$('.js-form').hidden;
function syncBtns() {
  $('.js-sksave', W).disabled = !E.out; const sb = $('.js-sksend', W); sb.disabled = !E.out || !canSend();
  sb.title = canSend() ? 'Отправить в открытый чат и сохранить себе' : 'Открой чат, чтобы отправить';
}
async function save(send) {
  if (!E.out) return;
  const n = nameI.value.trim().slice(0, 40) || 'мой стикер', fin = E.fin || undefined;
  try {
    await addSticker(E.out, n, fin);
    if (send && canSend()) { closeW(); sendSticker({ k: 'my', src: E.out, n, fin }); }
    else { closeW(); sfx('pop', .6); tmsg('ok', 'стикер лежит в «Мои» — открой стикеры в чате'); }
  } catch (e) { fail(e); }
}
$('.js-sksave', W).addEventListener('click', () => save(false));
$('.js-sksend', W).addEventListener('click', () => save(true));

OPEN.stkmake = (_, o = {}) => {
  Object.assign(E, { img: null, rgba: null, mask: null, undo: [], pts: null, cur: null, draw: null, out: '' });
  nameI.value = o.name || ''; drop.hidden = false; busy.hidden = true;
  cv.width = cv.height = 0; cv.style.width = cv.style.height = '0px';
  segSync($('.js-skstroke', W), E.stroke); segSync($('.js-skfin', W), E.fin);
  setTool('auto'); preview();
  if (o.src) load(o.src, o.name || '');
  else if (o.file) load(o.file, o.file.name);
  else if (o.pick) pick();
};
CLOSE.stkmake = () => { E.img = E.mask = E.tmp = null; E.rgba = null; E.undo = []; };
// из пикера «Мои → +» и из меню картинки «Сделать стикер»
bus.on('stkmake', o => openW('stkmake', o || {}));
