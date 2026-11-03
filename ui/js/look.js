// Внешний вид: шрифт, размер текста, обои под стеклом (по умолчанию — чёрный фон)
import { prefs, setPref, bus, clamp } from './core.js';
import { idb } from './idb.js';
import { shrinkImage } from './card.js';

const R = document.documentElement;
/** обои: id → css-фон ('' — чёрный, glow — старое свечение с пятнами, img — своя картинка из IndexedDB) */
export const WALLS = [
  { id: '', name: 'Чёрный', css: '#000' },
  { id: 'glow', name: 'Свечение', css: 'radial-gradient(60% 55% at 82% 0%,rgba(80,96,255,.5),transparent 70%),radial-gradient(55% 50% at 0% 100%,rgba(0,170,255,.32),transparent 70%),#000' },
  { id: 'aurora', name: 'Сияние', css: 'radial-gradient(55% 45% at 22% 28%,#1c9b82 0%,transparent 72%),radial-gradient(50% 45% at 76% 34%,#4b3bc0 0%,transparent 72%),radial-gradient(70% 55% at 55% 100%,#0b4e96 0%,transparent 72%),#03060c' },
  { id: 'sunset', name: 'Закат', css: 'radial-gradient(55% 50% at 24% 82%,#ff7a59 0%,transparent 70%),radial-gradient(50% 45% at 74% 26%,#c2367a 0%,transparent 72%),radial-gradient(60% 50% at 92% 92%,#3a1c71 0%,transparent 72%),#0b0610' },
  { id: 'ocean', name: 'Океан', css: 'radial-gradient(55% 50% at 28% 22%,#0077b6 0%,transparent 72%),radial-gradient(50% 45% at 80% 78%,#00a6c8 0%,transparent 72%),radial-gradient(60% 50% at 8% 96%,#023e8a 0%,transparent 72%),#01060d' },
  { id: 'forest', name: 'Лес', css: 'radial-gradient(55% 50% at 20% 30%,#2d6a4f 0%,transparent 72%),radial-gradient(45% 40% at 82% 70%,#52b788 0%,transparent 72%),radial-gradient(60% 50% at 60% 0%,#1b4332 0%,transparent 72%),#020704' },
  { id: 'nether', name: 'Незер', css: 'radial-gradient(55% 50% at 30% 82%,#b5341f 0%,transparent 72%),radial-gradient(45% 42% at 76% 24%,#ff8c42 0%,transparent 70%),radial-gradient(60% 50% at 0% 0%,#4a0d0d 0%,transparent 72%),#0d0302' },
  { id: 'end', name: 'Энд', css: 'radial-gradient(50% 45% at 70% 30%,#7a3bbf 0%,transparent 72%),radial-gradient(55% 50% at 20% 80%,#25126b 0%,transparent 72%),radial-gradient(35% 30% at 90% 90%,#c9b3ff 0%,transparent 70%),#050208' },
];
export function applyFont() {
  const f = prefs.font || 'soft', mfs = clamp(+prefs.msgSize || 15, 12, 20);
  R.dataset.font = f;
  R.style.setProperty('--mfs', (f === 'pixel' ? pixMfs(mfs) : mfs) + 'px');
  pixSheet(f === 'pixel');
  const note = document.querySelector('.js-fsnote');
  if (note) {
    let tx = 'сообщения, ники и поле ввода';
    if (f === 'pixel') { // какие позиции ползунка дают какой чёткий размер
      const z = appZoom(), st = []; for (let v = 13; v <= 19; v++) { const k = pixK(v, z, .2); if (!st.length || st[st.length - 1].k !== k) st.push({ k, a: v, b: v }); else st[st.length - 1].b = v; }
      tx = st.length > 1 ? 'пиксели чёткие ступенями: ' + st.map(x => (x.a === x.b ? x.a : x.a + '–' + x.b) + ' px ×' + x.k).join(' · ') : 'на этом экране пиксели чёткие в одном размере';
    }
    note.textContent = tx;
  }
}

/* ---------- «Пиксели» без мыла ----------
   Press Start 2P нарисован на сетке 8×8: чёткий, только когда пиксель шрифта = целому числу пикселей экрана
   (em 8, 16, 24… физических пикселей). Поэтому в этом режиме каждый размер текста из CSS округляем до ближайшего
   чёткого с учётом масштаба Windows (devicePixelRatio) и зума окна; разрядку и «жирный» отключаем — они мылят. */
const PIXK = .55; // size-adjust у hu-pixel в fonts.css
const appZoom = () => +((document.querySelector('.js-app') || {}).style || {}).zoom || 1;
const pixK = (px, z, bias = 0) => { const d = devicePixelRatio || 1; return Math.max(1, Math.round(px * PIXK * d * z / 8 + bias)); };
const pixPx = (k, z) => +(k * 8 / ((devicePixelRatio || 1) * z * PIXK)).toFixed(4);
// размер сообщений: ползунок переключает чёткие ступени (×1, ×2) — 19 px уже крупный пиксель
function pixMfs(mfs) { const z = appZoom(); return pixPx(pixK(mfs, z, .2), z); }
function splitSel(t) { // запятые верхнего уровня (не внутри :is(…)/:not(…))
  const out = []; let d = 0, cur = '';
  for (const ch of t) { if (ch === '(') d++; else if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  if (cur.trim()) out.push(cur.trim()); return out;
}
// размер из правила: font-size или из шорткода font (там бывает var() — тогда CSSOM не раскладывает его на части)
function sizeOf(st) {
  const v = st.getPropertyValue('font-size').trim();
  if (v) return v;
  const f = st.getPropertyValue('font').trim(); if (!f) return '';
  if (/^(inherit|initial|unset|revert)$/.test(f)) return f;
  const m = f.match(/(?:^|\s)((?:\d*\.)?\d+(?:px|em|rem|%))(?=\s*\/|\s)/); return m ? m[1] : '';
}
// шрифт правила: font-family или хвост шорткода font; пусто — наследуется (почти всегда это --sans)
function famOf(st) {
  const ff = st.getPropertyValue('font-family').trim(); if (ff) return ff;
  const f = st.getPropertyValue('font').trim(); if (!f || /^(inherit|initial|unset|revert)$/.test(f)) return '';
  const m = f.match(/(?:^|\s)(?:\d*\.)?\d+(?:px|em|rem|%)(?:\s*\/\s*\S+)?\s+(.+)$/); return m ? m[1] : '';
}
const famPix = fam => !fam || fam === 'inherit' || /var\(--sans\b|hu-pixel/.test(fam);
function pixVal(v, z, mfs) {
  let m = v.match(/^((?:\d*\.)?\d+)px$/); if (m) return pixPx(pixK(+m[1], z), z) + 'px';
  m = v.match(/^calc\(\s*var\(--mfs(?:,\s*[\d.]+px)?\)\s*\*\s*([\d.]+)\s*\)$/); if (m) return pixPx(pixK(mfs * +m[1], z), z) + 'px';
  return v; // em, %, var(--mfs) — как есть (порядок перекрытия правил сохраняется)
}
function pixRules(rules, z, pre, mfs, out) {
  for (const r of rules) {
    if (r.cssRules && r.media) { const inn = []; pixRules(r.cssRules, z, pre, mfs, inn); if (inn.length) out.push(`@media ${r.media.mediaText}{${inn.join('')}}`); continue; }
    if (!r.style || !r.selectorText) continue;
    let v = sizeOf(r.style); if (!v) continue;
    if (famPix(famOf(r.style))) v = pixVal(v, z, mfs); // моно и прочие шрифты — свой размер, только порядок правил
    const sel = splitSel(r.selectorText).map(x => /^(html|:root)\b/.test(x) ? x.replace(/^(html|:root)/, pre) : pre + ' ' + x).join(',');
    out.push(`${sel}{font-size:${v}}`);
  }
}
let pixEl = null, pixSig = '';
function pixSheet(on) {
  if (!on) { if (pixEl) { pixEl.remove(); pixEl = null; pixSig = ''; } return; }
  const z = appZoom(), mfs = clamp(+prefs.msgSize || 15, 12, 20), sig = [devicePixelRatio, z, mfs].join();
  if (pixEl && sig === pixSig) return;
  const t0 = performance.now(), base = [], app = [];
  for (const sh of document.styleSheets) {
    if (sh.ownerNode === pixEl) continue;
    let rs; try { rs = sh.cssRules; } catch (_) { continue; }
    pixRules(rs, 1, ':root[data-font="pixel"]', mfs, base);
    if (z !== 1) pixRules(rs, z, ':root[data-font="pixel"] .js-app', mfs, app);
  }
  if (!pixEl) { pixEl = document.createElement('style'); pixEl.id = 'pixsnap'; document.head.appendChild(pixEl); }
  pixEl.textContent = ':root[data-font="pixel"]{font-synthesis:none}:root[data-font="pixel"] *{letter-spacing:0!important}' + base.join('') + app.join('');
  pixSig = sig;
  if (location.search.includes('pixdbg')) console.log('pixsnap', base.length + app.length, 'rules', (performance.now() - t0).toFixed(1) + 'ms');
}
// сменился масштаб Windows / зум окна — пересчитать чёткие размеры
let dprMq = null;
function watchDpr() { if (dprMq) dprMq.removeEventListener('change', onDpr); dprMq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`); dprMq.addEventListener('change', onDpr); }
function onDpr() { watchDpr(); if (R.dataset.font === 'pixel') applyFont(); }
watchDpr();
let fitT = 0;
bus.on('fit', () => { if (R.dataset.font !== 'pixel') return; clearTimeout(fitT); fitT = setTimeout(applyFont, 120); });
let wallUrl = '';
export async function applyWall() {
  const el = document.querySelector('.js-wall'); if (!el) return;
  const w = prefs.wall || '';
  R.classList.toggle('wglow', w === 'glow');
  R.classList.toggle('haswall', !!w && w !== 'glow');
  el.style.setProperty('--wb', clamp(+prefs.wallBlur, 0, 80) + 'px');
  el.style.setProperty('--wd', (clamp(+prefs.wallDim, 0, 95) / 100).toFixed(2));
  if (w === 'img') {
    let src = '';
    try { src = (await idb.get('wall:img')) || ''; } catch (_) {}
    if (!src) { setPref('wall', ''); return; }
    if (src !== wallUrl) { wallUrl = src; el.style.background = `#000 url("${src}") center/cover no-repeat`; }
  } else { wallUrl = ''; el.style.background = (WALLS.find(x => x.id === w) || WALLS[0]).css; }
}
/** своя картинка на обои: ужимаем до 2560 px и кладём в IndexedDB (в настройки не влезет) */
export async function setWallImage(file) {
  const src = await shrinkImage(file, { w: 2560, h: 1600, max: 1400 * 1024, cover: false });
  await idb.set('wall:img', src); wallUrl = '';
  if (prefs.wall === 'img') applyWall(); else setPref('wall', 'img');
  return src;
}
export const wallImage = () => idb.get('wall:img').catch(() => '');
bus.on('pref', k => {
  if (k === 'font' || k === 'msgSize') applyFont();
  if (k === 'wall' || k === 'wallBlur' || k === 'wallDim') applyWall();
});
applyFont(); applyWall();
