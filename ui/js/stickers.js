// Стикеры: 3D-набор Hunty (ui/stickers/*.webp), мобы (пиксель-арт из mobs.js) и свои — картинка уходит вместе с сообщением.
import { MOBS } from './mobs.js';
import { idb } from './idb.js';

/** 3D-набор: [ключ, подпись] — ключи старых стикеров (fire, joy, …) те же, старые сообщения покажутся новыми картинками */
export const HUNTY = [['fire','Огонь'],['joy','Ахах'],['rofl','Ржу'],['cry','Плачу'],['plead','Ну пж'],['heart','Люблю'],['thumbs','Лайк'],['skull','Умер'],['eyes','Смотрю'],['grimace','Кринж'],['party','Ура'],['salute','Есть!'],['rage','Злюсь'],['boom','Взрыв мозга'],['scream','Ааа'],['cool','Чил'],['think','Хм'],['roll','Ну-ну'],['smirk','Хе-хе'],['clown','Клоун'],['devil','Хитрю'],['ghost','Бу!'],['robot','Бип-буп'],['poop','Ну такое'],['sleep','Сплю'],['melt','Таю'],['hug','Обнимаю'],['kiss','Целую'],['star','Вау'],['nerd','Умник'],['money','Богач'],['vomit','Фу'],['shush','Тсс'],['zany','Безумие'],['hot','Жара'],['cold','Дубак'],['hundred','Сто из ста'],['pray','Спасибо'],['handshake','По рукам'],['clap','Браво'],['muscle','Сила'],['wave','Привет'],['ok','Окей'],['trophy','Победа'],['gem','Алмазы'],['pick','Копаю'],['tnt','Бабах'],['game','Го играть'],['pizza','Пицца'],['coffee','Кофе'],['popcorn','Попкорн'],['cat','Кот'],['dog','Пёс'],['fox','Лис'],['frog','Ква'],['monkey','Не вижу'],['rocket','Полетели'],['bug','Баг'],['sparkles','Красота'],['crown','Король']];
const NAME = Object.fromEntries(HUNTY);
/** мобы-стикеры: лицо 8×8 с белой «вырезкой» по контуру */
export const MOBSTK = Object.keys(MOBS);
const mc = {};
export function mobStk(k) {
  if (mc[k]) return mc[k];
  const m = MOBS[k] || MOBS.creeper; let r = '';
  m.g.forEach((row, y) => { let x = 0; while (x < 8) { const ch = row[x]; let w = 1; while (x + w < 8 && row[x + w] === ch) w++; r += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${m.p[ch] || '#000'}"/>`; x += w; } });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.2 -1.2 10.4 10.4"><rect x="-.9" y="-.9" width="9.8" height="9.8" rx="1.6" fill="#fff"/><rect x="-.15" y="-.15" width="8.3" height="8.3" rx=".5" fill="rgba(0,0,0,.18)"/><g shape-rendering="crispEdges">${r}</g></svg>`;
  return mc[k] = 'data:image/svg+xml;base64,' + btoa(svg);
}
/** картинка стикера из data сообщения: {k} | {k:'mob:…'} | {k:'my', src|ref} */
export function stkSrc(dt, media) {
  dt = dt || {};
  if (typeof dt.src === 'string' && dt.src.startsWith('data:image/')) return dt.src;
  if (dt.ref && media) return media;
  const k = String(dt.k || '');
  if (k.startsWith('mob:')) return mobStk(k.slice(4));
  return 'stickers/' + (NAME[k] ? k : 'fire') + '.webp';
}
export function stkName(dt) {
  dt = dt || {}; const k = String(dt.k || '');
  if (dt.n) return String(dt.n).slice(0, 40);
  if (k.startsWith('mob:')) return (MOBS[k.slice(4)] || {}).n || 'моб';
  return NAME[k] || 'стикер';
}

/* ---------- свои стикеры: лежат только у тебя (IndexedDB), уходят картинкой в сообщении ---------- */
let mine = null;
export async function myStickers() { if (!mine) { try { mine = (await idb.get('stickers')) || []; } catch (_) { mine = []; } } return mine; }
async function saveMine() { try { await idb.set('stickers', mine); } catch (_) {} }
/** картинка → стикер 256px webp (прозрачность сохраняется), до ~120 КБ */
export async function makeSticker(file) {
  const bm = await createImageBitmap(file);
  let side = 256, q = .9, url = '';
  for (let i = 0; i < 4; i++) {
    const k = Math.min(1, side / Math.max(bm.width, bm.height)), w = Math.max(1, Math.round(bm.width * k)), h = Math.max(1, Math.round(bm.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bm, 0, 0, w, h);
    url = c.toDataURL('image/webp', q);
    if (url.length < 160000) break;
    side = Math.round(side * .8); q -= .1;
  }
  return url;
}
export async function addSticker(src, n = '') {
  await myStickers();
  if (mine.some(s => s.src === src)) return mine.find(s => s.src === src);
  const s = { id: Math.random().toString(36).slice(2, 10), src, n: String(n).slice(0, 40) };
  mine.unshift(s); if (mine.length > 80) mine.length = 80; await saveMine(); return s;
}
export async function delSticker(id) { await myStickers(); mine = mine.filter(s => s.id !== id); await saveMine(); }
