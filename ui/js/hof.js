// Зал славы: правило «попало ли сообщение» — то же, что в ядре (store.rs → hall).
// 🏆 от других: в личке хватит одного, в группе нужно два. Или «всем зашло»:
// в личке 4+ реакций, в группе 5+ реакций от трёх и больше человек. Свои реакции на своё не считаются.
export const CUP = '🏆';
export function hallWhy(m, kind) {
  if (!m || !m.reacts || !m.reacts.length || (kind !== 'dm' && kind !== 'group')) return '';
  let total = 0, cups = 0; const people = new Set();
  for (const r of m.reacts) for (const p of r.p || []) { if (p === m.from) continue; total++; people.add(p); if (r.e === CUP) cups++; }
  if (cups >= (kind === 'dm' ? 1 : 2)) return 'cup';
  if (kind === 'dm' ? total >= 4 : people.size >= 3 && total >= 5) return 'many';
  return '';
}
export const cupsOf = m => ((m && m.reacts) || []).filter(r => r.e === CUP).reduce((n, r) => n + (r.p || []).filter(p => p !== m.from).length, 0);
