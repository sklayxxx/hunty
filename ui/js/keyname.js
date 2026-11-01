// Хоткеи: справочник (что бывает, клавиши по умолчанию) и как показать клавишу человеку. Без зависимостей — чтобы любой модуль мог подписать кнопку.
import { prefs } from './core.js';

/** id, название, подсказка, по умолчанию, ловится ли в играх */
export const KEYDEF = [
  ['mic', 'Микрофон', 'включить / выключить', 'Ctrl+KeyM', true],
  ['deaf', 'Звук', 'никого не слышать — и тебя тоже', 'Ctrl+KeyD', true],
  ['ptt', 'Рация', 'держишь — говоришь · включается в «Голос → Режим»', 'KeyV', true],
  ['share', 'Показ экрана', 'начать / остановить', 'Ctrl+Shift+KeyS', true],
  ['clip', 'Клип', 'сохранить последние 30 секунд звонка', 'F8', true],
  ['mini', 'Свернуть звонок', 'мини-окно / обратно', '', false],
  ['leave', 'Выйти из голоса', '', '', false],
  ['F1', 'Перекличка', 'кто тут — отметки на плитках', 'F1', false],
  ['F2', 'Общий сбор', 'позвать всю группу в голос', 'F2', false],
  ['F3', 'Перерыв', '5 минут', 'F3', false],
  ['F7', 'Голосование', 'за или против', 'F7', false],
  ['F4', 'Фраза «Эй!»', 'скажет голос у каждого', 'F4', false],
  ['F5', 'Фраза «Заходи»', '', 'F5', false],
  ['F6', 'Случайная фраза', '', 'F6', false],
];
export const KDEF = Object.fromEntries(KEYDEF.map(k => [k[0], k[3]]));
/** какая клавиша сейчас у действия ('' — никакой) */
export function keyOf(id) {
  const k = prefs.keys || {};
  if (id === 'ptt') return k.ptt || prefs.pttKey || KDEF.ptt;
  return Object.prototype.hasOwnProperty.call(k, id) ? String(k[id] || '') : (KDEF[id] || '');
}

const VKT = { Space: 0x20, Tab: 0x09, CapsLock: 0x14, ShiftLeft: 0xA0, ShiftRight: 0xA1, ControlLeft: 0xA2, ControlRight: 0xA3, AltLeft: 0xA4, AltRight: 0xA5,
  Backquote: 0xC0, Minus: 0xBD, Equal: 0xBB, BracketLeft: 0xDB, BracketRight: 0xDD, Backslash: 0xDC, Semicolon: 0xBA, Quote: 0xDE, Comma: 0xBC, Period: 0xBE, Slash: 0xBF,
  Insert: 0x2D, Delete: 0x2E, Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22, ArrowUp: 0x26, ArrowDown: 0x28, ArrowLeft: 0x25, ArrowRight: 0x27,
  Enter: 0x0D, Backspace: 0x08, Pause: 0x13, ScrollLock: 0x91, NumpadAdd: 0x6B, NumpadSubtract: 0x6D, NumpadMultiply: 0x6A, NumpadDivide: 0x6F, NumpadDecimal: 0x6E,
  Mouse3: 0x04, Mouse4: 0x05, Mouse5: 0x06, Ctrl: 0x11, Shift: 0x10, Alt: 0x12 };
/** e.code → виртуальный код клавиши Windows (0 — не знаем) */
export function vkOf(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1].charCodeAt(0);
  if ((m = /^Digit(\d)$/.exec(code))) return 0x30 + +m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return 0x60 + +m[1];
  if ((m = /^F(\d{1,2})$/.exec(code)) && +m[1] >= 1 && +m[1] <= 24) return 0x6F + +m[1];
  return VKT[code] || 0;
}
const KN = { Space: 'Пробел', CapsLock: 'Caps Lock', ShiftLeft: 'Левый Shift', ShiftRight: 'Правый Shift', ControlLeft: 'Левый Ctrl', ControlRight: 'Правый Ctrl',
  AltLeft: 'Левый Alt', AltRight: 'Правый Alt', Backquote: 'Ё', Tab: 'Tab', Enter: 'Enter', Mouse3: 'Колёсико', Mouse4: 'Мышь «назад»', Mouse5: 'Мышь «вперёд»',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
  Minus: '-', Equal: '=', BracketLeft: 'Х', BracketRight: 'Ъ', Semicolon: 'Ж', Quote: 'Э', Comma: 'Б', Period: 'Ю', Slash: '.', Backslash: '\\', Backspace: 'Backspace',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num ,', NumpadEnter: 'Num Enter', Pause: 'Pause', ScrollLock: 'Scroll Lock' };
/** как показать одну клавишу */
export function keyName(code) {
  code = code || 'KeyV'; let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return 'Num ' + m[1];
  return KN[code] || code;
}
export const MODS = ['Ctrl', 'Alt', 'Shift'];
/** части сочетания: ['Ctrl', 'Shift', 'KeyS'] */
export const parts = combo => String(combo || '').split('+').filter(Boolean);
/** «Ctrl+Shift+S» для подсказок; '' — «нет» */
export function keyLabel(combo) {
  const p = parts(combo); if (!p.length) return 'без клавиши';
  return p.map(x => MODS.includes(x) ? x : keyName(x)).join('+');
}
/** то же, но плашками <kbd> */
export function keyKbd(combo) {
  const p = parts(combo); if (!p.length) return '<span class="knone">нет</span>';
  return p.map(x => `<kbd class="k">${(MODS.includes(x) ? x : keyName(x)).replace(/[<>&]/g, '')}</kbd>`).join('<i class="kp">+</i>');
}
