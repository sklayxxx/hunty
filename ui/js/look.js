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
  R.dataset.font = prefs.font || 'soft';
  R.style.setProperty('--mfs', clamp(+prefs.msgSize || 15, 12, 20) + 'px');
}
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
