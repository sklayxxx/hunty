// Пасхалки: счётчик в настройках, без спойлеров
import { $$, prefs, setPref } from './core.js';
import { tmsg, tone, sfx } from './ui.js';
export const EGGS_TOTAL = 4; // steve, konami, logo, ghast
export function eggsText() { $$('.js-eggs').forEach(e => e.textContent = `найдено пасхалок: ${(prefs.eggs || []).length} из ${EGGS_TOTAL}`); }
export function egg(n) {
  const have = prefs.eggs || [];
  if (have.includes(n)) return;
  setPref('eggs', [...have, n]); eggsText();
  setTimeout(() => { tmsg('ping', `пасхалка найдена · ${(prefs.eggs || []).length} из ${EGGS_TOTAL}`); sfx('egg'); }, 600);
}
eggsText();
