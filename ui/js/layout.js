// Раскладка: щели между панелями тянутся, мини-окно звонка таскается и липнет к углам, жидкое стекло
import { $, $$, R, clamp, mobile, reduce, prefs, setPref, bus, idle } from './core.js';
import { app, tmsg } from './ui.js';

const tilesEl = $('.tiles'), listP = $('.pane.list'), chatP = $('.pane.chat'), stageP = $('.js-stage'), stb = $('.js-stb');
const mini = $('.js-mini');

/* ---------- ресайз: щель между списком и остальным, между сценой звонка и чатом ---------- */
// sh — высота сцены без видео (только аватарки), shv — когда есть экран или вебки
const LAYD = { c1: 272, sh: 0, shv: 0 };
const LAY = Object.assign({}, LAYD);
try { const o = JSON.parse(localStorage.getItem('hunty-lay') || '{}'); ['c1', 'sh', 'shv'].forEach(k => { if (+o[k] > 0) LAY[k] = +o[k]; }); } catch (_) {}
const zf = () => parseFloat(app.style.zoom) || 1;
const gapPx = () => parseFloat(getComputedStyle(tilesEl).columnGap) || 10;
const saveLay = () => { try { localStorage.setItem('hunty-lay', JSON.stringify(LAY)); } catch (_) {} };
const vid = () => stb.classList.contains('has-scr') || !!$('.vtile.cam', stb);
const shKey = () => vid() ? 'shv' : 'sh';
const G = {};
[['c1', 'v', 'Ширина списка чатов', 'список'], ['sh', 'h', 'Высота звонка', 'звонок']].forEach(([k, d, l, s]) => {
  const g = document.createElement('div'); g.className = 'gut ' + d; g.dataset.k = k; g.dataset.s = s; g.tabIndex = 0;
  g.setAttribute('role', 'separator'); g.setAttribute('aria-orientation', d === 'h' ? 'horizontal' : 'vertical');
  g.setAttribute('aria-label', l); g.title = l + ' · тяни · двойной клик — как было'; g.innerHTML = '<i aria-hidden="true"></i>';
  tilesEl.appendChild(g); G[k] = g;
});
const gtip = document.createElement('div'); gtip.className = 'gtip'; gtip.hidden = true; gtip.setAttribute('aria-hidden', 'true'); document.body.appendChild(gtip);
const inCall = () => !app.classList.contains('calm');
const focusOn = () => app.classList.contains('stfocus');
function limits() {
  const W = tilesEl.clientWidth, H = tilesEl.clientHeight, g = gapPx();
  return { c1: [216, Math.max(216, Math.min(440, W - 420 - g))], sh: [180, Math.max(180, H - 230 - g)] };
}
/** высота сцены по умолчанию: без видео — поменьше (аватарки), с видео — побольше */
const shDef = k => { const H = tilesEl.clientHeight || 700; return Math.round(k === 'shv' ? clamp(H * .6, 300, 640) : clamp(H * .36, 236, 350)); };
const shNow = () => { const k = shKey(); return LAY[k] || shDef(k); };
export function applyLay() {
  const L = limits(); const c1 = clamp(LAY.c1, ...L.c1);
  app.style.setProperty('--c1', c1 + 'px');
  app.style.setProperty('--sh', Math.round(clamp(shNow(), ...L.sh)) + 'px');
  requestAnimationFrame(placeGuts);
}
function placeGuts() {
  const mob = mobile(), g = gapPx(), shOn = !mob && inCall() && !focusOn();
  G.c1.hidden = mob; G.sh.hidden = !shOn; if (mob) return;
  const set = (e, l, t, w, h) => { e.style.left = l + 'px'; e.style.top = t + 'px'; e.style.width = w + 'px'; e.style.height = h + 'px'; };
  set(G.c1, listP.offsetLeft + listP.offsetWidth, listP.offsetTop, g, listP.offsetHeight);
  if (shOn) set(G.sh, stageP.offsetLeft, stageP.offsetTop + stageP.offsetHeight, stageP.offsetWidth, g);
  const L = limits();
  [['c1', listP.offsetWidth], ['sh', stageP.offsetHeight]].forEach(([k, v]) => { G[k].setAttribute('aria-valuemin', L[k][0]); G[k].setAttribute('aria-valuemax', Math.round(L[k][1])); G[k].setAttribute('aria-valuenow', Math.round(v)); });
}
const sizeOf = k => k === 'c1' ? listP.offsetWidth : stageP.offsetHeight;
function tipAt(x, y, k) { gtip.textContent = `${G[k].dataset.s} · ${Math.round(sizeOf(k))}px`; gtip.hidden = false; gtip.style.left = (x + 14) + 'px'; gtip.style.top = (y + 16) + 'px'; }
let gd = null;
tilesEl.addEventListener('pointerdown', e => {
  const g = e.target.closest('.gut'); if (!g || e.button !== 0) return; e.preventDefault();
  const k = g.dataset.k;
  gd = { k, g, id: e.pointerId, x: e.clientX, y: e.clientY, c1: listP.offsetWidth, sh: stageP.offsetHeight, z: zf() };
  g.setPointerCapture(e.pointerId); g.classList.add('on'); R.classList.add('resizing', k === 'sh' ? 'rs-h' : 'rs-v'); tipAt(e.clientX, e.clientY, k);
});
tilesEl.addEventListener('pointermove', e => {
  if (!gd || e.pointerId !== gd.id) return;
  const dx = (e.clientX - gd.x) / gd.z, dy = (e.clientY - gd.y) / gd.z, L = limits();
  if (gd.k === 'c1') LAY.c1 = Math.round(clamp(gd.c1 + dx, ...L.c1));
  if (gd.k === 'sh') LAY[shKey()] = Math.round(clamp(gd.sh + dy, ...L.sh));
  applyLay(); tipAt(e.clientX, e.clientY, gd.k);
});
function gEnd() { if (!gd) return; gd.g.classList.remove('on'); gd = null; R.classList.remove('resizing', 'rs-h', 'rs-v'); gtip.hidden = true; saveLay(); placeMini(false); bus.emit('panes'); }
tilesEl.addEventListener('pointerup', gEnd); tilesEl.addEventListener('pointercancel', gEnd);
function resetLay(k) {
  const key = k === 'sh' ? shKey() : k;
  const from = sizeOf(k); LAY[key] = LAYD[key]; applyLay(); const to = k === 'sh' ? clamp(shNow(), ...limits().sh) : sizeOf(k); tmsg('ok', 'размер вернул как было');
  if (reduce || Math.abs(to - from) < 2) { saveLay(); placeMini(false); return; }
  const t0 = performance.now(), D = 260; LAY[key] = from; applyLay();
  let done = false; const fin = () => { if (done) return; done = true; LAY[key] = LAYD[key]; applyLay(); saveLay(); placeMini(false); };
  const f = () => { if (done) return; const q = Math.min(1, (performance.now() - t0) / D), ee = 1 - Math.pow(1 - q, 3); LAY[key] = Math.round(from + (to - from) * ee); applyLay(); if (q < 1) requestAnimationFrame(f); else fin(); };
  requestAnimationFrame(f); setTimeout(fin, D + 120);
}
tilesEl.addEventListener('dblclick', e => { const g = e.target.closest('.gut'); if (g) resetLay(g.dataset.k); });
tilesEl.addEventListener('keydown', e => {
  const g = e.target.closest('.gut'); if (!g) return;
  const k = g.dataset.k, st = e.shiftKey ? 48 : 16, L = limits(), cur0 = sizeOf(k); let v = null;
  if (k === 'sh') { if (e.key === 'ArrowDown') v = cur0 + st; if (e.key === 'ArrowUp') v = cur0 - st; }
  else { if (e.key === 'ArrowRight') v = cur0 + st; if (e.key === 'ArrowLeft') v = cur0 - st; }
  if (e.key === 'Enter' || e.key === 'Home') { e.preventDefault(); resetLay(k); return; }
  if (v == null) return; e.preventDefault(); LAY[k === 'sh' ? shKey() : k] = Math.round(clamp(v, ...L[k])); applyLay(); saveLay();
});
const roLay = new ResizeObserver(() => requestAnimationFrame(() => { placeGuts(); bus.emit('panes'); placeMini(false); }));
[tilesEl, listP, chatP, stageP].forEach(el => roLay.observe(el));
addEventListener('resize', applyLay);
bus.on('layout', () => { applyLay(); placeMini(false); requestAnimationFrame(() => placeMini(false)); });
bus.on('stagevid', () => applyLay());
bus.on('fit', () => requestAnimationFrame(placeGuts));

/* ---------- мини-окно звонка: таскается, липнет к углам чата, тянется за уголок ---------- */
let mCorner = 'tr'; try { mCorner = localStorage.getItem('hunty-mini') || 'tr'; } catch (_) {}
function miniBox() {
  const ch = chatP.getBoundingClientRect(), hd = $('.ph', chatP).getBoundingClientRect(), cf = $('.js-form').getBoundingClientRect();
  return { l: ch.left + 12, r: ch.right - 12, t: hd.bottom + 10, b: cf.top - 12 };
}
export function placeMini(anim = true) {
  if (mini.hidden) return;
  mini.dataset.c = mCorner;
  const b = miniBox(), w = mini.offsetWidth, h = mini.offsetHeight;
  const x = mCorner[1] === 'l' ? b.l : b.r - w, y = mCorner[0] === 't' ? b.t : Math.max(b.t, b.b - h);
  mini.classList.toggle('noanim', !anim); mini.style.left = Math.round(x) + 'px'; mini.style.top = Math.round(y) + 'px';
}
addEventListener('resize', () => placeMini(false));
(() => {
  const hd = $('.js-mdrag'); let s = null;
  hd.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const r = mini.getBoundingClientRect(); s = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId }; hd.setPointerCapture(e.pointerId); mini.classList.add('drag'); });
  hd.addEventListener('pointermove', e => { if (!s) return; mini.style.left = Math.round(Math.min(innerWidth - mini.offsetWidth - 6, Math.max(6, e.clientX - s.dx))) + 'px'; mini.style.top = Math.round(Math.min(innerHeight - mini.offsetHeight - 6, Math.max(6, e.clientY - s.dy))) + 'px'; });
  const end = () => {
    if (!s) return; s = null; mini.classList.remove('drag');
    const r = mini.getBoundingClientRect(), b = miniBox(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    mCorner = (cy < (b.t + b.b) / 2 ? 't' : 'b') + (cx < (b.l + b.r) / 2 ? 'l' : 'r');
    try { localStorage.setItem('hunty-mini', mCorner); } catch (_) {}
    placeMini(true);
  };
  hd.addEventListener('pointerup', end); hd.addEventListener('pointercancel', end);
})();
const mgrip = document.createElement('button'); mgrip.type = 'button'; mgrip.className = 'mgrip';
mgrip.setAttribute('aria-label', 'Изменить размер окна звонка'); mgrip.title = 'Тяни, чтобы поменять размер'; mgrip.innerHTML = '<i></i><i></i><i></i>';
mini.appendChild(mgrip);
let MW = 290; try { MW = +localStorage.getItem('hunty-miniw') || 290; } catch (_) {}
function setMW(w) { MW = Math.round(clamp(w, 230, 560)); mini.style.setProperty('--mw', MW + 'px'); mini.style.setProperty('--mk', (MW / 290).toFixed(3)); }
setMW(MW);
(() => {
  let s = null;
  mgrip.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); s = { x: e.clientX, w: MW, id: e.pointerId, left: mCorner[1] === 'r' }; mgrip.setPointerCapture(e.pointerId); mini.classList.add('drag', 'sizing'); });
  mgrip.addEventListener('pointermove', e => { if (!s) return; const dx = e.clientX - s.x; setMW(s.left ? s.w - dx : s.w + dx); placeMini(false); });
  const end = () => { if (!s) return; s = null; mini.classList.remove('drag', 'sizing'); try { localStorage.setItem('hunty-miniw', MW); } catch (_) {} placeMini(true); };
  mgrip.addEventListener('pointerup', end); mgrip.addEventListener('pointercancel', end);
  mgrip.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault();
    const s2 = (e.key === 'ArrowRight' ? 1 : -1) * (mCorner[1] === 'r' ? -1 : 1); setMW(MW + s2 * 20); placeMini(false);
    try { localStorage.setItem('hunty-miniw', MW); } catch (_) {}
  });
})();
new MutationObserver(() => { if (!mini.hidden) { placeMini(false); requestAnimationFrame(() => placeMini(false)); } }).observe(mini, { attributes: true, attributeFilter: ['hidden'] });

/* ---------- жидкое стекло: преломление по краям, как в iOS (только Chromium/WebView2) ---------- */
export const LGOK = /Chrome\//.test(navigator.userAgent) && !/Firefox|FxiOS/.test(navigator.userAgent);
const SVGNS = 'http://www.w3.org/2000/svg';
const lgDefs = document.createElementNS(SVGNS, 'svg');
lgDefs.setAttribute('width', '0'); lgDefs.setAttribute('height', '0'); lgDefs.setAttribute('aria-hidden', 'true');
lgDefs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'; document.body.prepend(lgDefs);
let lgN = 0; const lgMaps = new Map(); // карты линз: держим последние 40, остальное выкидываем
function lensMap(w, h, r, bez, k) {
  const W = Math.max(2, Math.round(w * k)), H = Math.max(2, Math.round(h * k)); const key = [W, H, r, bez].join('x');
  if (lgMaps.has(key)) { const v = lgMaps.get(key); lgMaps.delete(key); lgMaps.set(key, v); return v; }
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); const im = x.createImageData(W, H), d = im.data; const cx = w / 2, cy = h / 2;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const px = (i + .5) / k - cx, py = (j + .5) / k - cy; const qx = Math.abs(px) - (cx - r), qy = Math.abs(py) - (cy - r);
    const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r, ins = -sd; let dx = 0, dy = 0;
    if (ins >= 0 && ins < bez) {
      let nx, ny;
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = qx / l * Math.sign(px); ny = qy / l * Math.sign(py); }
      else if (qx > qy) { nx = Math.sign(px); ny = 0; } else { nx = 0; ny = Math.sign(py); }
      const t = 1 - ins / bez, m = Math.pow(t, 2.5); dx = -nx * m; dy = -ny * m;
    }
    const o = (j * W + i) * 4; d[o] = 128 + dx * 127; d[o + 1] = 128 + dy * 127; d[o + 2] = 128; d[o + 3] = 255;
  }
  x.putImageData(im, 0, 0); const url = c.toDataURL(); lgMaps.set(key, url);
  while (lgMaps.size > 40) lgMaps.delete(lgMaps.keys().next().value);
  return url;
}
function lgBuild(el) {
  const w = el.offsetWidth, h = el.offsetHeight; if (w < 8 || h < 8) return;
  const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);
  const sig = w + 'x' + h + 'r' + r; if (el._lgSig === sig) return; el._lgSig = sig;
  const bez = Math.max(7, Math.min(r * .6 + 8, 28, Math.min(w, h) / 2)), Sc = bez * 2.1, k = w * h > 160000 ? .5 : 1;
  let f = el._lgF; if (!f) { f = document.createElementNS(SVGNS, 'filter'); f.id = 'lg' + (++lgN); lgDefs.appendChild(f); el._lgF = f; }
  const ch = (n, res, m) => `<feDisplacementMap in="SourceGraphic" in2="m" scale="${(Sc * m).toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="d${res}"/><feColorMatrix in="d${res}" type="matrix" values="${n}" result="${res}"/>`;
  ['x', 'y'].forEach(a => f.setAttribute(a, '0')); f.setAttribute('width', w); f.setAttribute('height', h);
  f.setAttribute('filterUnits', 'userSpaceOnUse'); f.setAttribute('primitiveUnits', 'userSpaceOnUse'); f.setAttribute('color-interpolation-filters', 'sRGB');
  const map = lensMap(w, h, r, bez, k);
  f.innerHTML = `<feImage href="${map}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>` +
    ch('1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', 'r', 1) + ch('0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', 'g', 1.05) + ch('0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0', 'b', 1.1) +
    '<feComposite in="r" in2="g" operator="arithmetic" k2="1" k3="1" result="rg"/><feComposite in="rg" in2="b" operator="arithmetic" k2="1" k3="1"/>';
  const on = () => { el.style.setProperty('--lgf', `url(#${f.id})`); el.classList.add('lqf'); };
  if (el.classList.contains('lqf')) on(); else { const im = new Image(); im.src = map; (im.decode ? im.decode() : Promise.resolve()).then(() => requestAnimationFrame(on), on); }
}
// пересчёт карты — не на каждый кадр ресайза, а когда размер устоялся (иначе на слабых компах всё встаёт колом)
const lgLater = el => { clearTimeout(el._lgT); el._lgT = setTimeout(() => { if (el.isConnected && R.classList.contains('lg')) lgBuild(el); }, 160); };
const lgRO = 'ResizeObserver' in window ? new ResizeObserver(es => es.forEach(e => lgLater(e.target))) : null;
function lgAttach(el) { if (!LGOK || el._lgOn) return; el._lgOn = 1; if (R.classList.contains('lg')) lgBuild(el); lgRO && lgRO.observe(el); }
function lgDetach(el) { if (!el._lgOn) return; el._lgOn = 0; clearTimeout(el._lgT); lgRO && lgRO.unobserve(el); if (el._lgF) { el._lgF.remove(); el._lgF = null; } el._lgSig = ''; }
const LGSEL = '.island.glass,.tools,.vpop,.stk,.wback>.win,.field,.toast';
export const lgScan = (root = document) => $$(LGSEL, root).forEach(lgAttach);
export function setGlass(m) {
  const on = LGOK && m === 'liquid' && !prefs.lite, was = R.classList.contains('lg');
  R.classList.toggle('lg', on);
  if (on && !was) $$(LGSEL).forEach(el => { if (el._lgOn) { el._lgSig = ''; lgBuild(el); } });
  $$('.js-glassmode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.g === m)));
}
export function setGA(v = prefs.glassA) { v = +v; R.style.setProperty('--pa', (.92 - v * .0062).toFixed(3)); R.style.setProperty('--la', (.5 - v * .0042).toFixed(3)); }
$('.js-glassmode').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  setPref('glass', b.dataset.g); setGlass(b.dataset.g);
  tmsg('ok', b.dataset.g === 'liquid' ? (LGOK ? 'стекло: жидкое — края преломляют то, что под ними' : 'тут преломление не поддерживается — будет матовое') : 'стекло: только матовое — меньше нагрузка на видюху');
});
if (!LGOK) $('.js-glassmode button[data-g="liquid"]').title = 'в этом браузере преломление не поддерживается — будет матовое';
bus.on('pref', (k, v) => { if (k === 'glassA') setGA(v); if (k === 'lite') setGlass(prefs.glass || 'liquid'); });
export function initLayout() {
  setGlass(prefs.glass || 'liquid'); setGA();
  // карты преломления считаются попиксельно — после первого кадра, когда браузер свободен
  idle(() => lgScan());
  // тосты приходят и уходят: фильтр стекла убираем вместе с тостом, чтобы не копились
  new MutationObserver(ms => ms.forEach(m => {
    m.addedNodes.forEach(n => { if (n.nodeType === 1 && n.matches(LGSEL)) lgAttach(n); });
    m.removedNodes.forEach(n => { if (n.nodeType === 1) lgDetach(n); });
  })).observe($('.js-toasts'), { childList: true });
  applyLay();
}
