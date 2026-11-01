// Карточка профиля как в Discord: шапка (цвет ника / градиент / своя картинка), ава с вырезом, ник, статус, «о себе».
// Одна разметка на всё: окно профиля друга, «мой профиль», живое превью в настройках.
import { esc } from './core.js';
import { isImageData } from './image-data.js';

/** готовые шапки: ключ → [подпись, CSS-фон] */
export const BANNERS = {
  sunset: ['Закат', 'linear-gradient(135deg,#ffb36b 0%,#ff5e8a 52%,#7a4bff 100%)'],
  ocean: ['Океан', 'linear-gradient(135deg,#63e6ff 0%,#3d7bff 55%,#4b2bd6 100%)'],
  mint: ['Мята', 'linear-gradient(135deg,#c4ffd9 0%,#3ccf9a 50%,#127a7a 100%)'],
  lava: ['Лава', 'radial-gradient(70% 120% at 20% 100%,#ffd36b,transparent 60%),linear-gradient(135deg,#ff7a3d 0%,#c4183c 70%,#4a0b1c 100%)'],
  aurora: ['Сияние', 'radial-gradient(60% 140% at 15% 0%,#6bffb8,transparent 60%),radial-gradient(70% 140% at 85% 20%,#b06bff,transparent 65%),linear-gradient(180deg,#0f2a3a,#0b0b1a)'],
  night: ['Ночь', 'radial-gradient(2px 2px at 20% 30%,#fff,transparent),radial-gradient(1.5px 1.5px at 70% 20%,#fff,transparent),radial-gradient(1.5px 1.5px at 45% 70%,#fff8,transparent),radial-gradient(2px 2px at 85% 60%,#fffa,transparent),linear-gradient(160deg,#1d2b64 0%,#3a1f5c 60%,#0b0b14 100%)'],
  grass: ['Блок травы', 'linear-gradient(180deg,#86d65e 0 26%,#5fae3d 26% 36%,#8a5a35 36% 100%)'],
  nether: ['Незер', 'radial-gradient(60% 120% at 80% 100%,#ff9a3d88,transparent 60%),linear-gradient(135deg,#8a1c1c 0%,#4a0d14 60%,#1a0508 100%)'],
  end: ['Энд', 'radial-gradient(40% 80% at 75% 35%,#f4f0b8,transparent 55%),linear-gradient(135deg,#2a1450 0%,#140b24 70%)'],
  mono: ['Графит', 'linear-gradient(135deg,#4a4a55 0%,#1c1c22 100%)'],
};
export const isImg = isImageData;
export const isColor = c => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c);
/** CSS-фон шапки: своя картинка → готовый градиент → «от цвета ника» */
export function bannerBg(banner, color) {
  if (isImg(banner)) return `center/cover no-repeat url("${banner}")`;
  if (typeof banner === 'string' && banner.startsWith('g:') && BANNERS[banner.slice(2)]) return BANNERS[banner.slice(2)][1];
  const c = isColor(color) ? color : '#9db7ff';
  return `radial-gradient(110% 150% at 0% 0%,color-mix(in srgb,${c} 80%,#fff),transparent 58%),radial-gradient(90% 130% at 100% 100%,color-mix(in srgb,${c} 40%,#000),transparent 70%),linear-gradient(120deg,${c},color-mix(in srgb,${c} 50%,#000))`;
}
/**
 * o: { ava, nick, color, banner, bio, line, pd (html точки статуса), tag (строка под ником), chips (html), big }
 */
export function cardHTML(o) {
  const c = isColor(o.color) ? o.color : '#9db7ff';
  const bio = String(o.bio || '').trim();
  return `<div class="pc3${o.big ? ' big' : ''}" style="--pc:${c}">
  <div class="pb3" style="background:${esc(bannerBg(o.banner, c))}"></div>
  <div class="pa3"><img alt="" src="${esc(o.ava || '')}">${o.pd || ''}</div>
  <div class="pt3">
    <b class="pnick">${esc(o.nick || '—')}</b>
    ${o.tag ? `<span class="ptag">${o.tag}</span>` : ''}
    ${o.line ? `<div class="pl3">${o.line}</div>` : ''}
    ${o.chips || ''}
  </div>
  ${bio ? `<div class="pbio3"><h6>О себе</h6><p>${esc(bio)}</p></div>` : ''}
</div>`;
}
/** картинку → квадрат/прямоугольник нужного размера (ава 128×128, шапка 600×210), сжато, чтобы летало по p2p */
export async function shrinkImage(file, { w = 128, h = 128, max = 90 * 1024, cover = true } = {}) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('нужна картинка');
  if (file.size > 20 * 1024 * 1024) throw new Error('картинка больше 20 МБ');
  const bm = await createImageBitmap(file);
  const k = cover ? Math.max(w / bm.width, h / bm.height) : Math.min(w / bm.width, h / bm.height, 1);
  const dw = Math.round(bm.width * k), dh = Math.round(bm.height * k);
  const c = document.createElement('canvas'); c.width = cover ? w : dw; c.height = cover ? h : dh;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(bm, cover ? (w - dw) / 2 : 0, cover ? (h - dh) / 2 : 0, dw, dh);
  for (const q of [0.88, 0.8, 0.7, 0.6, 0.5, 0.4]) {
    let u = c.toDataURL('image/webp', q);
    if (!u.startsWith('data:image/webp')) u = c.toDataURL('image/jpeg', q);
    if (u.length <= max) return u;
  }
  throw new Error('не получилось ужать картинку — возьми попроще');
}
