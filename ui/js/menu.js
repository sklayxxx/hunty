// Свои контекстные меню вместо браузерных, окно «точно?» и защита от браузерных хоткеев/жестов
import { $, $$, esc, ic, clamp, bus } from './core.js';

/* ---------- контекстное меню ---------- */
// пункт: {label, icon, fn, kbd, danger, disabled, check, keep} · '-' — черта · {head, sub, img} — шапка
// · {range:{min,max,step,value,fmt,on}, label} — ползунок · {emojis:[…], active:Set, on(e)} — быстрые реакции
// · {label, icon, items:[…]} — подменю
let root = null, stack = [], prevFocus = null;
const provs = [];
/** onCtx('.sel', (el, e) => items|null): меню для элементов; срабатывает самый вложенный подходящий */
export function onCtx(sel, fn) { provs.push({ sel, fn }); }
export const menuOpen = () => !!root;

function itemHTML(it, i) {
  if (it === '-') return '<div class="msep" role="separator"></div>';
  if (it.head) return `<div class="mhead">${it.img ? `<img class="ava" alt="" src="${esc(it.img)}">` : ''}<span><b>${esc(it.head)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></div>`;
  if (it.emojis) return `<div class="memo" role="group" aria-label="Реакции">${it.emojis.map(e => `<button type="button" class="${it.active && it.active.has(e) ? 'on' : ''}" data-i="${i}" data-e="${esc(e)}" title="${esc(e)}">${esc(e)}</button>`).join('')}</div>`;
  if (it.range) { const r = it.range; return `<div class="mi mrng" data-i="${i}"><span class="ml">${it.icon ? ic(it.icon) : ''}${esc(it.label || '')}</span><input type="range" class="rg" min="${r.min ?? 0}" max="${r.max ?? 100}" step="${r.step ?? 1}" value="${r.value ?? 0}" aria-label="${esc(it.label || '')}"><output>${esc((r.fmt || (v => v + '%'))(r.value ?? 0))}</output></div>`; }
  const ck = it.check !== undefined;
  const cls = 'mi' + (it.danger ? ' danger' : '') + (it.items ? ' hassub' : '') + (ck ? ' mchk' : '');
  return `<button type="button" class="${cls}" role="${ck ? 'menuitemcheckbox' : 'menuitem'}" data-i="${i}"${it.disabled ? ' disabled aria-disabled="true"' : ''}${ck ? ` aria-checked="${!!it.check}"` : ''}>${ck ? `<span class="mck">${it.check ? ic('check') : ''}</span>` : it.icon ? ic(it.icon) : '<span class="mic0"></span>'}<span class="ml">${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}${it.items ? ic('chevron-right') : ''}</button>`;
}
function build(items, level) {
  const m = document.createElement('div');
  m.className = 'cmenu glass'; m.setAttribute('role', 'menu'); m.dataset.level = level; m.tabIndex = -1;
  // лишние черты: в начале, в конце и подряд
  const list = items.filter(Boolean).filter((x, i, a) => x !== '-' || (i > 0 && a[i - 1] !== '-' && i < a.length - 1));
  m._items = list;
  m.innerHTML = list.map(itemHTML).join('');
  $$('.mrng input', m).forEach(inp => {
    const it = list[+inp.closest('[data-i]').dataset.i], r = it.range, out = inp.nextElementSibling;
    const paint = () => { const v = +inp.value; inp.style.setProperty('--v', ((v - (r.min ?? 0)) / ((r.max ?? 100) - (r.min ?? 0)) * 100).toFixed(1) + '%'); out.textContent = (r.fmt || (x => x + '%'))(v); };
    paint(); inp.addEventListener('input', () => { paint(); r.on && r.on(+inp.value); });
  });
  return m;
}
function place(m, x, y, from) {
  m.style.left = '0px'; m.style.top = '0px'; m.style.visibility = 'hidden';
  document.body.appendChild(m);
  const w = m.offsetWidth, h = m.offsetHeight, W = innerWidth, H = innerHeight;
  let l, t;
  if (from) { // подменю: справа от пункта, не влезает — слева
    const r = from.getBoundingClientRect();
    l = r.right + w + 4 <= W ? r.right + 2 : Math.max(6, r.left - w - 2); t = clamp(r.top - 6, 6, Math.max(6, H - h - 6));
  } else {
    l = x + w + 6 <= W ? x : Math.max(6, x - w); t = y + h + 6 <= H ? y : Math.max(6, y - h);
  }
  m.style.left = Math.round(l) + 'px'; m.style.top = Math.round(t) + 'px'; m.style.visibility = '';
}
export function openMenu(items, { x = 0, y = 0, el = null } = {}) {
  closeMenu();
  prevFocus = document.activeElement;
  if (el && !x && !y) { const r = el.getBoundingClientRect(); x = r.left + Math.min(24, r.width / 2); y = r.bottom - 4; }
  root = build(items, 0); stack = [root];
  place(root, x, y);
  wire(root);
  requestAnimationFrame(() => { if (!root) return; root.classList.add('on'); const f = $('.mi:not([disabled]):not(.mrng), .memo button', root); (f || root).focus({ preventScroll: true }); });
  bus.emit('menu', true);
  return root;
}
export function closeMenu() {
  if (!root) return;
  const inside = stack.some(m => m.contains(document.activeElement));
  stack.forEach(m => m.remove()); root = null; stack = [];
  if (inside && prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
  prevFocus = null;
  bus.emit('menu', false);
}
function closeFrom(level) { while (stack.length > level + 1) stack.pop().remove(); }
function openSub(m, btn) {
  const lv = +m.dataset.level; closeFrom(lv);
  const it = m._items[+btn.dataset.i]; if (!it || !it.items) return null;
  const s = build(it.items, lv + 1); s._parent = btn; stack.push(s); place(s, 0, 0, btn); wire(s); s.classList.add('on');
  return s;
}
function wire(m) {
  let hovT = 0;
  m.addEventListener('pointerover', e => {
    const b = e.target.closest('.mi'); if (!b || !m.contains(b)) return;
    clearTimeout(hovT);
    hovT = setTimeout(() => { if (!root) return; if (b.classList.contains('hassub') && !b.disabled) { if (!stack.some(s => s._parent === b)) openSub(m, b); } else closeFrom(+m.dataset.level); }, 120);
  });
  m.addEventListener('click', e => {
    const eb = e.target.closest('.memo button');
    if (eb) { const it = m._items[+eb.dataset.i]; closeMenu(); it.on && it.on(eb.dataset.e); return; }
    const b = e.target.closest('button.mi'); if (!b || b.disabled) return;
    const it = m._items[+b.dataset.i]; if (!it) return;
    if (it.items) { const s = openSub(m, b); const f = s && $('.mi:not([disabled])', s); f && f.focus(); return; }
    if (!it.keep) closeMenu();
    try { it.fn && it.fn(); } catch (er) { console.error(er); }
  });
  m.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
}
document.addEventListener('pointerdown', e => { if (root && !e.target.closest('.cmenu')) closeMenu(); }, true);
addEventListener('blur', closeMenu); addEventListener('resize', closeMenu);
document.addEventListener('wheel', e => { if (root && !e.target.closest('.cmenu')) closeMenu(); }, { passive: true, capture: true });
document.addEventListener('keydown', e => {
  if (!root) return;
  const m = stack[stack.length - 1];
  const items = $$('.mi:not([disabled]):not(.mrng), .memo button, .mrng input', m);
  const a = document.activeElement, i = items.indexOf(a);
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (stack.length > 1) { const p = m._parent; stack.pop().remove(); p && p.focus(); } else closeMenu(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') {
    e.preventDefault(); e.stopImmediatePropagation();
    const d = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
    const n = items[(i + d + items.length) % items.length] || items[0]; n && n.focus(); return;
  }
  if (e.key === 'ArrowRight' && a && a.classList.contains('hassub')) { e.preventDefault(); const s = openSub(m, a); const f = s && $('.mi:not([disabled])', s); f && f.focus(); return; }
  if (e.key === 'ArrowLeft' && stack.length > 1 && !(a && a.type === 'range')) { e.preventDefault(); const p = m._parent; stack.pop().remove(); p && p.focus(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && a && m.contains(a) && a.tagName === 'BUTTON') { e.preventDefault(); e.stopImmediatePropagation(); a.click(); return; }
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) e.stopImmediatePropagation(); // буквы не уходят в хоткеи под меню
}, true);

/* ---------- правка текста: своё меню для полей ввода ---------- */
const editable = el => el && el.nodeType === 1 && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|url|email|number|tel|password)$/i.test(el.type || 'text')) || el.isContentEditable);
async function pasteInto(el) {
  let t = '';
  try { t = await navigator.clipboard.readText(); } catch (_) { bus.emit('snack', 'warn', 'буфер обмена недоступен — вставь через Ctrl+V'); return; }
  if (!t) return;
  el.focus();
  if (!document.execCommand('insertText', false, t)) {
    try { el.setRangeText(t, el.selectionStart, el.selectionEnd, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
  }
}
function editItems(el) {
  const ro = el.readOnly || el.disabled, pw = el.type === 'password';
  let sel = '';
  try { sel = el.isContentEditable ? String(getSelection()) : el.value.slice(el.selectionStart, el.selectionEnd); } catch (_) {}
  const copySel = () => navigator.clipboard.writeText(sel).catch(() => { el.focus(); document.execCommand('copy'); });
  return [
    { icon: 'scissors', label: 'Вырезать', kbd: 'Ctrl+X', disabled: !sel || ro || pw, fn: () => { copySel().then(() => { el.focus(); document.execCommand('delete'); }); } },
    { icon: 'copy', label: 'Копировать', kbd: 'Ctrl+C', disabled: !sel || pw, fn: copySel },
    { icon: 'clipboard', label: 'Вставить', kbd: 'Ctrl+V', disabled: ro, fn: () => pasteInto(el) },
    '-',
    { icon: 'type', label: 'Выделить всё', kbd: 'Ctrl+A', disabled: !(el.value || el.textContent), fn: () => { el.focus(); if (el.select) el.select(); else document.execCommand('selectAll'); } },
  ];
}
const selText = () => { try { return String(getSelection() || ''); } catch (_) { return ''; } };
/** выделенный текст, если выделение внутри el */
export const selectionIn = el => { const s = getSelection(); return s && !s.isCollapsed && el.contains(s.anchorNode) ? String(s) : ''; };
document.addEventListener('contextmenu', e => {
  e.preventDefault(); // браузерное меню не показываем никогда
  const t = e.target instanceof Element ? e.target : e.target && e.target.parentElement;
  if (!t || t.closest('.cmenu')) return;
  let items = null, at = null;
  for (let el = t; el && el !== document.documentElement; el = el.parentElement) {
    if (editable(el)) { items = editItems(el); at = el; break; }
    for (const p of provs) if (el.matches(p.sel)) { try { items = p.fn(el, e); } catch (er) { console.error(er); } if (items) { at = el; break; } }
    if (items) break;
  }
  if (!items) { const s = selText(); if (s.trim()) items = [{ icon: 'copy', label: 'Копировать', kbd: 'Ctrl+C', fn: () => navigator.clipboard.writeText(s).catch(() => document.execCommand('copy')) }]; }
  if (items && items.length) openMenu(items, e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { el: at || t });
  else closeMenu();
});

/* ---------- «точно?» ---------- */
let askEl = null;
/** ask({title, text, ok, cancel, danger}) → Promise<boolean> */
export function ask({ title, text = '', ok = 'Ок', cancel = 'Отмена', danger = false, icon = '' }) {
  if (askEl) askEl._done(false);
  return new Promise(res => {
    const b = document.createElement('div'); b.className = 'askb'; askEl = b;
    b.innerHTML = `<div class="ask glass" role="alertdialog" aria-modal="true" aria-labelledby="askt"><div class="askh">${icon ? ic(icon) : ''}<b id="askt"></b></div><p></p><div class="btnrow"><button type="button" class="gbtn js-askno"></button><button type="button" class="${danger ? 'cbtn danger' : 'cbtn'} js-askok"></button></div></div>`;
    $('b', b).textContent = title; $('p', b).textContent = text; $('p', b).hidden = !text;
    $('.js-askok', b).textContent = ok; $('.js-askno', b).textContent = cancel;
    const prev = document.activeElement;
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(false); } else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); done(document.activeElement !== $('.js-askno', b)); } };
    const done = v => { if (b._fin) return; b._fin = 1; b.classList.add('out'); setTimeout(() => b.remove(), 160); if (askEl === b) askEl = null; document.removeEventListener('keydown', key, true); if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true }); res(v); };
    b._done = done;
    document.addEventListener('keydown', key, true);
    b.addEventListener('click', e => { if (e.target === b) done(false); else if (e.target.closest('.js-askok')) done(true); else if (e.target.closest('.js-askno')) done(false); });
    document.body.appendChild(b);
    requestAnimationFrame(() => { b.classList.add('on'); $(danger ? '.js-askno' : '.js-askok', b).focus(); });
  });
}
export const asking = () => !!askEl;

/* ---------- это приложение, а не вкладка браузера ---------- */
const BLOCK = new Set(['KeyR', 'KeyP', 'KeyS', 'KeyU', 'KeyJ', 'KeyH', 'KeyG', 'KeyO', 'KeyN', 'KeyT', 'KeyE', 'KeyL', 'KeyF']);
document.addEventListener('keydown', e => {
  const k = e.code, mod = e.ctrlKey || e.metaKey;
  if (k === 'F5' || k === 'F3' || k === 'F7' || k === 'BrowserBack' || k === 'BrowserForward' || k === 'BrowserRefresh') { e.preventDefault(); return; }
  if (e.altKey && !mod && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home')) { if (!(e.target.closest && e.target.closest('input,textarea'))) e.preventDefault(); return; }
  if (!mod || e.altKey) return;
  if (BLOCK.has(k) && !(e.shiftKey && k === 'KeyS')) { e.preventDefault(); if (k === 'KeyF' && !e.shiftKey) bus.emit('find'); return; }
  if (k === 'Equal' || k === 'NumpadAdd' || k === 'Minus' || k === 'NumpadSubtract' || k === 'Digit0' || k === 'Numpad0') { e.preventDefault(); bus.emit('zoom', k === 'Digit0' || k === 'Numpad0' ? 0 : k === 'Minus' || k === 'NumpadSubtract' ? -1 : 1); }
}, true);
addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); bus.emit('zoom', e.deltaY < 0 ? 1 : -1); } }, { passive: false });
// файл мимо чата — не открываем его вместо приложения; картинки и ссылки не таскаются
document.addEventListener('dragover', e => { if (!e.defaultPrevented) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; } });
document.addEventListener('drop', e => { if (!e.defaultPrevented) e.preventDefault(); });
document.addEventListener('dragstart', e => { const t = e.target; if (t && t.nodeType === 1 && (t.tagName === 'IMG' || t.tagName === 'A') && t.getAttribute('draggable') !== 'true') e.preventDefault(); });
// средняя кнопка и Shift/Ctrl-клик по ссылке открыли бы новое окно браузера
document.addEventListener('auxclick', e => { if (e.button === 1 && e.target.closest && e.target.closest('a')) e.preventDefault(); });
document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href]'); if (a && (e.shiftKey || e.ctrlKey || e.metaKey) && !a.dataset.url) e.preventDefault(); }, true);

/* ---------- подсказки: свои вместо системных — появляются быстрее и с хоткеем ---------- */
const tip = document.createElement('div'); tip.className = 'tip'; tip.setAttribute('aria-hidden', 'true'); tip.hidden = true;
document.body.appendChild(tip);
let tipEl = null, tipT = 0;
const KBD = /^(.*?) · ((?:Ctrl|Shift|Alt|Esc|Enter|Del|Space|Пробел|F\d{1,2}|[A-ZА-Я↑↓←→]|ПКМ)(?:[+–-][^·]{1,14})?)$/;
function tipHide() {
  clearTimeout(tipT); tipT = 0;
  const el = tipEl; tipEl = null;
  if (el) { if (!el.hasAttribute('title') && el.dataset.tip) el.setAttribute('title', el.dataset.tip); delete el.dataset.tip; }
  if (!tip.hidden) { tip.classList.remove('on'); tip.hidden = true; }
}
function tipShow(el) {
  if (el !== tipEl || !document.contains(el) || root || askEl) return;
  const t = el.dataset.tip || ''; if (!t) return;
  const m = KBD.exec(t);
  tip.innerHTML = m ? `${esc(m[1])}<kbd>${esc(m[2])}</kbd>` : esc(t);
  tip.hidden = false; tip.classList.remove('on');
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  let top = r.top - h - 8, below = false;
  if (top < 6) { top = r.bottom + 8; below = true; }
  tip.style.left = Math.round(clamp(r.left + r.width / 2 - w / 2, 6, innerWidth - w - 6)) + 'px';
  tip.style.top = Math.round(clamp(top, 6, innerHeight - h - 6)) + 'px';
  tip.classList.toggle('below', below);
  requestAnimationFrame(() => { if (tipEl === el) tip.classList.add('on'); });
}
document.addEventListener('pointerover', e => {
  if (e.pointerType === 'touch') return;
  const el = e.target.closest && e.target.closest('[title],[data-tip]');
  if (el === tipEl) return;
  tipHide();
  if (!el || el.closest('.cmenu')) return;
  const t = el.getAttribute('title') || el.dataset.tip; if (!t || !t.trim()) return;
  el.dataset.tip = t; el.removeAttribute('title'); tipEl = el; // системная подсказка не вылезает поверх нашей
  tipT = setTimeout(() => tipShow(el), tip.classList.contains('warm') ? 120 : 420);
}, true);
document.addEventListener('pointerout', e => { if (tipEl && (!e.relatedTarget || !tipEl.contains(e.relatedTarget))) { tip.classList.add('warm'); clearTimeout(tip._w); tip._w = setTimeout(() => tip.classList.remove('warm'), 500); tipHide(); } }, true);
['pointerdown', 'keydown', 'wheel', 'blur'].forEach(ev => addEventListener(ev, () => { if (tipEl) tipHide(); }, { capture: true, passive: true }));
bus.on('menu', on => { if (on) tipHide(); });
