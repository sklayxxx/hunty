// Вкладки сверху — открытые чаты, как в браузере: перетаскивание, закрытие (×, средняя кнопка, Ctrl+W),
// меню по правому клику, хоткеи (Alt+1…9, Ctrl+Tab, Ctrl+Shift+T). Закреплённые чаты — всегда первыми, с булавкой.
import { $, $$, esc, ic, prefs, setPref, bus } from './core.js';
import { S, roomName, dmPeer, avaOf, voiceCount } from './state.js';
import { tileHTML, openChat, chatItems, sorted, showEmpty, togglePin } from './chat.js';
import { onCtx, openMenu } from './menu.js';
import { tmsg, openW } from './ui.js';
import { flip, still, zoomOf, SOFT } from './motion.js';

const nav = $('.js-nav'), navs = $('.js-navs'), plus = $('.ws.plus', nav);
const MAXT = 8, closed = [];
const pins = () => (prefs.pinned || []).filter(id => S.rooms.has(id));
export const isPinned = id => (prefs.pinned || []).includes(id);
export function tabIds() {
  let t = prefs.tabs;
  if (!Array.isArray(t)) { t = sorted().slice(0, 4).map(r => r.id); setPref('tabs', t); }
  const p = pins();
  return [...p, ...t.filter(id => S.rooms.has(id) && !p.includes(id))];
}
/** чат открыли — у него должна быть вкладка */
export function tabOpened(id) {
  if (!id || !S.rooms.has(id) || tabIds().includes(id)) { renderWs(); return; }
  const t = (prefs.tabs || []).filter(x => S.rooms.has(x)); t.push(id);
  while (t.length > MAXT) { const i = t.findIndex(x => x !== id && x !== S.cur); if (i < 0) break; t.splice(i, 1); }
  setPref('tabs', t); renderWs(true);
}
function tabHTML(id, i) {
  const r = S.rooms.get(id), pin = isPinned(id), cur = id === S.cur, vc = voiceCount(id);
  const av = r.kind === 'dm' ? `<img class="ava" alt="" src="${avaOf(dmPeer(r))}" draggable="false">` : tileHTML(r);
  const ub = r.unread && !cur ? `<span class="wub${r.muted ? ' mute' : ''}">${r.unread > 99 ? '99+' : r.unread}</span>` : '';
  return `<button class="ws${pin ? ' pinned' : ''}" data-chat="${esc(id)}" type="button" draggable="false"${cur ? ' aria-current="page"' : ''} title="${esc(roomName(r))}${i < 9 ? ' · Alt+' + (i + 1) : ''}"><span class="wav">${av}</span><span class="wn">${esc(roomName(r))}</span>${vc ? `<span class="wvc" aria-label="в голосе">${ic('mic')}</span>` : ''}${ub}${pin ? `<span class="wpin" aria-label="закреплено">${ic('pin')}</span>` : `<span class="tx" role="button" aria-label="Закрыть вкладку" title="Закрыть · Ctrl+W">${ic('x')}</span>`}</button>`;
}
export function renderWs(anim) {
  if (drag && drag.on) return;
  const ids = tabIds(), h = ids.map(tabHTML).join('');
  if (h === nav._h) return; nav._h = h;
  const put = () => { $$('.ws[data-chat]', nav).forEach(b => b.remove()); plus.insertAdjacentHTML('beforebegin', h); };
  anim ? flip(nav, '.ws[data-chat]', put, { dur: 380 }) : put();
  const c = $('.ws[aria-current]', nav); if (c && anim) c.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: still() ? 'auto' : 'smooth' });
}
export function closeTab(id) {
  const ids = tabIds(), i = ids.indexOf(id); if (i < 0) return;
  if (isPinned(id)) { tmsg('warn', 'закреплённую вкладку не закрыть — сначала открепи (правый клик)'); return; }
  const go = () => {
    setPref('tabs', (prefs.tabs || []).filter(x => x !== id)); closed.push(id); if (closed.length > 12) closed.shift();
    if (id === S.cur) { const rest = tabIds(); const n = rest[Math.min(i, rest.length - 1)]; if (n) openChat(n, { focus: true }); else showEmpty(); }
    renderWs(true);
  };
  const b = $(`.ws[data-chat="${CSS.escape(id)}"]`, nav);
  if (!b || still()) { go(); return; }
  b.classList.add('bye'); b.style.width = b.offsetWidth + 'px'; void b.offsetWidth;
  b.animate([{ width: b.offsetWidth + 'px', opacity: 1 }, { width: '0px', opacity: 0, paddingLeft: 0, paddingRight: 0, marginLeft: '-4px' }], { duration: 200, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).onfinish = go;
}
function closeMany(ids) { const set = new Set(ids.filter(id => !isPinned(id))); if (!set.size) return; if (set.has(S.cur)) { const keep = tabIds().find(x => !set.has(x)); if (keep) openChat(keep, { focus: true }); else showEmpty(); } set.forEach(id => closed.push(id)); setPref('tabs', (prefs.tabs || []).filter(x => !set.has(x))); renderWs(true); }
function reopen() { while (closed.length) { const id = closed.pop(); if (S.rooms.has(id)) { openChat(id, { focus: true }); return; } } tmsg('ok', 'закрытых вкладок нет'); }
function step(d) { const ids = tabIds(); if (!ids.length) return; const i = ids.indexOf(S.cur); openChat(ids[(i + d + ids.length) % ids.length], { focus: true }); }

/* ---------- клики ---------- */
let noClick = 0;
nav.addEventListener('click', e => {
  const b = e.target.closest('.ws[data-chat]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  if (Date.now() < noClick) return;
  if (e.target.closest('.tx')) { closeTab(b.dataset.chat); return; }
  openChat(b.dataset.chat, { focus: true });
});
nav.addEventListener('mousedown', e => { if (e.button === 1 && e.target.closest('.ws[data-chat]')) e.preventDefault(); }); // без автопрокрутки
nav.addEventListener('auxclick', e => { const b = e.button === 1 && e.target.closest('.ws[data-chat]'); if (b) { e.preventDefault(); closeTab(b.dataset.chat); } });
navs.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && navs.scrollWidth > navs.clientWidth) { navs.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
// «+» — открыть ещё чат или создать группу
plus.removeAttribute('data-win');
plus.addEventListener('click', e => {
  e.preventDefault(); e.stopPropagation();
  const open = new Set(tabIds()), more = sorted().filter(r => !open.has(r.id)).slice(0, 8);
  openMenu([
    more.length ? { head: 'Открыть вкладку', sub: 'чаты без вкладки' } : null,
    ...more.map(r => ({ img: r.kind === 'dm' ? avaOf(dmPeer(r)) : '', tile: r.kind === 'dm' ? null : r, label: roomName(r), fn: () => openChat(r.id, { focus: true }) })),
    more.length ? '-' : null,
    { icon: 'users', label: 'Создать группу', fn: () => openW('group') },
    { icon: 'user-round-plus', label: 'Добавить друга', fn: () => openW('friend') },
    closed.length ? { icon: 'history', label: 'Вернуть закрытую', kbd: 'Ctrl+Shift+T', fn: reopen } : null,
  ], { el: plus });
});

/* ---------- перетаскивание ---------- */
let drag = null;
nav.addEventListener('pointerdown', e => {
  const b = e.target.closest('.ws[data-chat]'); if (!b || e.button !== 0 || e.target.closest('.tx')) return;
  drag = { b, id: b.dataset.chat, x0: e.clientX, on: false, pid: e.pointerId };
});
function startDrag() {
  const tabs = $$('.ws[data-chat]', nav), z = zoomOf(nav);
  drag.on = true; drag.z = z;
  drag.tabs = tabs.map(t => ({ t, id: t.dataset.chat, r: t.getBoundingClientRect(), pin: t.classList.contains('pinned') }));
  drag.i = tabs.indexOf(drag.b); drag.to = drag.i; drag.pin = drag.b.classList.contains('pinned');
  const same = drag.tabs.filter(x => x.pin === drag.pin);
  drag.lo = drag.tabs.indexOf(same[0]); drag.hi = drag.tabs.indexOf(same[same.length - 1]);
  const g = drag.tabs[1] ? drag.tabs[1].r.left - drag.tabs[0].r.right : 4; drag.gap = Math.max(0, g);
  nav.classList.add('dragging'); drag.b.classList.add('drag');
  try { drag.b.setPointerCapture(drag.pid); } catch (_) {}
}
addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  const dx = e.clientX - drag.x0;
  if (!drag.on) { if (Math.abs(dx) < 6) return; startDrag(); }
  const me = drag.tabs[drag.i], lo = drag.tabs[drag.lo].r.left - me.r.left, hi = drag.tabs[drag.hi].r.right - me.r.right;
  const x = Math.max(lo, Math.min(hi, dx)); me.t.style.transform = `translateX(${x / drag.z}px)`;
  const c = me.r.left + me.r.width / 2 + x; let to = drag.i;
  for (let j = drag.lo; j <= drag.hi; j++) { const o = drag.tabs[j]; if (j === drag.i) continue; const oc = o.r.left + o.r.width / 2; if (j < drag.i && c < oc) { to = Math.min(to, j); } if (j > drag.i && c > oc) to = Math.max(to, j); }
  drag.to = to; const w = (me.r.width + drag.gap) / drag.z;
  drag.tabs.forEach((o, j) => { if (j === drag.i) return; const sh = drag.i < to && j > drag.i && j <= to ? -w : drag.i > to && j < drag.i && j >= to ? w : 0; o.t.style.transform = sh ? `translateX(${sh}px)` : ''; });
});
function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.pid)) return;
  const d = drag; drag = null; if (!d.on) return;
  noClick = Date.now() + 80; nav.classList.remove('dragging');
  const ids = d.tabs.map(x => x.id), [m] = ids.splice(d.i, 1); ids.splice(d.to, 0, m);
  const me = d.tabs[d.i], fromX = (me.r.left - (d.tabs[d.to].r.left)) / d.z + (parseFloat((me.t.style.transform.match(/-?[\d.]+/) || [0])[0]) || 0);
  if (d.pin) setPref('pinned', ids.filter(id => isPinned(id))); else setPref('tabs', ids.filter(id => !isPinned(id)));
  nav._h = ''; d.tabs.forEach(o => { o.t.style.transform = ''; });
  renderWs();
  const nb = $(`.ws[data-chat="${CSS.escape(m)}"]`, nav);
  if (nb && !still()) nb.animate([{ transform: `translateX(${fromX}px) scale(1.04)` }, { transform: 'none' }], { duration: 360, easing: SOFT });
}
addEventListener('pointerup', endDrag); addEventListener('pointercancel', endDrag);

/* ---------- меню вкладки ---------- */
onCtx('.js-nav .ws[data-chat]', el => {
  const id = el.dataset.chat, base = chatItems(id); if (!base) return null;
  const ids = tabIds(), i = ids.indexOf(id), pin = isPinned(id);
  return [base[0],
    { icon: 'x', label: 'Закрыть вкладку', kbd: 'Ctrl+W', disabled: pin, fn: () => closeTab(id) },
    { icon: 'minus', label: 'Закрыть остальные', disabled: ids.filter(x => x !== id && !isPinned(x)).length === 0, fn: () => closeMany(ids.filter(x => x !== id)) },
    { icon: 'chevron-right', label: 'Закрыть справа', disabled: !ids.slice(i + 1).some(x => !isPinned(x)), fn: () => closeMany(ids.slice(i + 1)) },
    ...base.slice(1)];
});

/* ---------- хоткеи ---------- */
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.altKey && !mod && /^Digit[1-9]$/.test(e.code)) { const ids = tabIds(), n = +e.code.slice(5), id = n === 9 ? ids[ids.length - 1] : ids[n - 1]; if (id) { e.preventDefault(); openChat(id, { focus: true }); } return; }
  if (mod && !e.altKey && (e.code === 'Tab' || e.code === 'PageDown' || e.code === 'PageUp')) { e.preventDefault(); step(e.code === 'PageUp' || (e.code === 'Tab' && e.shiftKey) ? -1 : 1); return; }
  if (mod && !e.altKey && !e.shiftKey && (e.code === 'KeyW' || e.code === 'F4')) { e.preventDefault(); if (S.cur) closeTab(S.cur); return; }
  if (mod && e.shiftKey && !e.altKey && e.code === 'KeyT') { e.preventDefault(); reopen(); }
}, true);

bus.on('room_removed', room => { if ((prefs.tabs || []).includes(room)) setPref('tabs', prefs.tabs.filter(x => x !== room)); renderWs(); });
