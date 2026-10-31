// Эмодзи картинками (Fluent Emoji 3D, MIT): в тексте, реакциях и пикере. Нет картинки — остаётся системный глиф.
import { EK } from './emoji-keys.js';

let RE;
try { RE = new RegExp('\\p{RGI_Emoji}', 'gv'); }
catch (_) { RE = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu; }
const ONE = new RegExp('^(?:' + RE.source + ')$', RE.flags.replace('g', ''));

/** код картинки: кодпоинты без FE0F и без оттенков кожи (их у набора нет — берём базовый) */
export function emoKey(g) {
  const k = [...String(g)].map(c => c.codePointAt(0)).filter(c => c !== 0xfe0f && !(c >= 0x1f3fb && c <= 0x1f3ff)).map(c => c.toString(16)).join('-');
  if (EK.has(k)) return k;
  const k2 = k.replace(/-200d-2640$|-200d-2642$/, ''); // «женщина/мужчина-…» → нейтральный вариант
  return EK.has(k2) ? k2 : '';
}
export const emoSrc = k => 'emoji/' + k + '.webp';
const ea = s => s.replace(/"/g, '&quot;');
/** одна картинка эмодзи (или сам глиф, если такой нет) */
export function emoImg(g, cls = 'emj') {
  const k = emoKey(g);
  return k ? `<img class="${cls}" src="${emoSrc(k)}" alt="${ea(g)}" draggable="false" decoding="async">` : `<span class="${cls} eg">${g}</span>`;
}
/** заменить эмодзи в готовом HTML (только в тексте, не в тегах) */
export function emo(html) {
  const s = String(html);
  if (!/[\u00a9\u00ae\u203c-\u3299\ud83c-\ud83e]/.test(s)) return s;
  return s.split(/(<[^>]*>)/).map((p, i) => i % 2 ? p : p.replace(RE, g => { const k = emoKey(g); return k ? `<img class="emj" src="${emoSrc(k)}" alt="${ea(g)}" draggable="false" decoding="async">` : g; })).join('');
}
/** сообщение только из эмодзи (до 27 штук) — показываем крупно */
export function emojiOnly(t) {
  t = String(t || '').trim(); if (!t || t.length > 200) return 0;
  const m = t.match(RE); if (!m || m.length > 27) return 0;
  return t.replace(RE, '').replace(/[\s\uFE0F\u200D]/g, '') === '' ? m.length : 0;
}
export const isEmoji = g => ONE.test(g);
/** копирование: картинки эмодзи → обратно в символы */
export function textOf(node) {
  const c = node.cloneNode(true);
  c.querySelectorAll && c.querySelectorAll('img.emj,img.emjb,img.emjs').forEach(i => i.replaceWith(i.alt || ''));
  return c.textContent;
}
document.addEventListener('copy', e => {
  const sel = getSelection(); if (!sel || !sel.rangeCount || sel.isCollapsed) return;
  const fr = sel.getRangeAt(0).cloneContents(); if (!fr.querySelector || !fr.querySelector('img.emj,img.emjb')) return;
  const d = document.createElement('div'); d.appendChild(fr);
  d.querySelectorAll('img.emj,img.emjb').forEach(i => i.replaceWith(i.alt || ''));
  d.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  d.querySelectorAll('.m').forEach(m => m.append('\n'));
  e.clipboardData.setData('text/plain', d.textContent.replace(/\n{3,}/g, '\n\n').trim());
  e.preventDefault();
});
