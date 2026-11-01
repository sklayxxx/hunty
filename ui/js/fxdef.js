// Эффекты сообщений: список и маленькая кнопка «повторить» под сообщением.
// Сам показ — fx.js (канвас поверх чата). Тут — только данные, чтобы chat.js не тянул анимации.
import { esc } from './core.js';
import { emoImg } from './emoji.js';

export const FX = {
  confetti: { emo: '🎉', label: 'Конфетти', sub: 'хлопушка на весь чат', sfx: 'confetti' },
  boom: { emo: '💥', label: 'Бум', sub: 'взрыв и тряска окна', sfx: 'boom' },
  money: { emo: '💸', label: 'Деньги', sub: 'дождь из купюр', sfx: 'cash' },
  shake: { emo: '🫨', label: 'Тряска', sub: 'встряхнуть чат', sfx: 'shake' },
};
/** эффект сообщения или '' */
export const fxOf = m => { const k = m && m.data && m.data.fx; return k && FX[k] ? k : ''; };
/** чип под сообщением: нажал — эффект ещё раз */
export function fxChip(m) {
  const k = fxOf(m); if (!k) return '';
  return `<button type="button" class="fxb" data-fx="${esc(k)}" title="${esc(FX[k].label)} — показать ещё раз" aria-label="Повторить эффект «${esc(FX[k].label)}»">${emoImg(FX[k].emo, 'emjf')}</button>`;
}
