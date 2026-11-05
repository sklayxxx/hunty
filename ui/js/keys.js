// Хоткеи: любую клавишу можно переназначить (Настройки → Хоткеи). В окне Hunty ловим обычным образом,
// в играх — через оболочку Windows: она только смотрит, нажата ли клавиша, игра её получает как обычно.
import { $, $$, esc, prefs, setPref, bus } from './core.js';
import { inTauri, shell, shellListen } from './api.js';
import { tmsg, toast } from './ui.js';
import { KEYDEF, KDEF, keyOf, keyLabel, keyKbd, vkOf, parts, MODS } from './keyname.js';
import { V, toggleMic, toggleDeaf, toggleShare, fireKey, setPtt, setMini, leave } from './voice.js';

export { keyOf, keyLabel };
const NAME = Object.fromEntries(KEYDEF.map(k => [k[0], k[1]]));
const GLOBAL = new Set(KEYDEF.filter(k => k[4]).map(k => k[0]));
// сочетания самого приложения — их не отдаём
const RESERVED = { 'Ctrl+KeyK': 'поиск чата', 'Ctrl+KeyF': 'поиск по переписке', 'Ctrl+KeyW': 'закрыть вкладку', 'Ctrl+Tab': 'вкладки', 'Ctrl+Shift+KeyT': 'вернуть вкладку',
  'Ctrl+KeyB': 'жирный', 'Ctrl+KeyI': 'курсив', 'Ctrl+KeyU': 'подчёркнутый', 'Ctrl+KeyC': 'копировать', 'Ctrl+KeyV': 'вставить', 'Ctrl+KeyX': 'вырезать', 'Ctrl+KeyA': 'выделить всё', 'Ctrl+KeyZ': 'отменить',
  Enter: 'отправить', Escape: 'закрыть', Tab: 'переход по кнопкам', Backspace: 'стереть', Delete: 'стереть' };
for (let i = 1; i <= 9; i++) RESERVED['Alt+Digit' + i] = 'вкладка ' + i;
const MODCODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

/** сочетание из события клавиатуры: «Ctrl+Shift+KeyS»; одиночный модификатор — как есть («ShiftLeft», для рации) */
export function comboOf(e) {
  const c = e.code; if (!c) return '';
  if (MODCODES.has(c)) return c;
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + c;
}
const typing = e => { const t = e.target; return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')); };
/** одиночная обычная клавиша (буква, цифра, пробел) — пока печатаешь, её не перехватываем */
const plain = combo => { const p = parts(combo); return p.length === 1 && !/^(F\d{1,2}|Mouse\d|Pause|ScrollLock|Insert|Home|End|PageUp|PageDown|Numpad.*)$/.test(p[0]) && !MODCODES.has(p[0]) && p[0] !== 'CapsLock'; };
let binding = null; // идёт назначение — хоткеи молчат

/* ---------- действия ---------- */
function run(id) {
  if (id === 'mic') return toggleMic();
  if (id === 'deaf') return toggleDeaf();
  if (id === 'share') return toggleShare();
  if (id === 'clip') { if (!V.room) { tmsg('warn', 'клип пишется в звонке — зайди в голос'); return; } bus.emit('clip'); return; }
  if (id === 'mini') { if (V.room) setMini(!V.mini, true); return; }
  if (id === 'leave') { if (V.room) leave(); return; }
  if (/^F\d$/.test(id)) { if (V.room) fireKey(id); }
}
const pttOn = () => !!+prefs.ptt && !!V.room;

/* ---------- в окне Hunty ---------- */
function findId(combo) { if (!combo) return ''; for (const [id] of KEYDEF) if (id !== 'ptt' && keyOf(id) === combo) return id; return ''; }
addEventListener('keydown', e => {
  if (binding || e.isComposing) return;
  const combo = comboOf(e), ptt = keyOf('ptt');
  // рация: только сама клавиша, модификаторы рядом не мешают
  if (pttOn() && (e.code === ptt || combo === ptt) && !(typing(e) && plain(ptt))) {
    if (!e.repeat && !V.gkeys) setPtt(true);
    if (!typing(e)) e.preventDefault();
    return;
  }
  const id = findId(combo); if (!id) return;
  if (typing(e) && plain(combo)) return;
  if (document.querySelector('.cmenu') && plain(combo)) return;
  e.preventDefault(); if (e.repeat) return;
  run(id);
}, true);
addEventListener('keyup', e => {
  const ptt = keyOf('ptt');
  if (V.ptt && !V.gkeys && (e.code === ptt || parts(ptt).slice(-1)[0] === e.code)) setPtt(false);
});
// боковые кнопки мыши и колёсико тоже можно назначить
const mouseCode = e => e.button === 1 ? 'Mouse3' : e.button === 3 ? 'Mouse4' : e.button === 4 ? 'Mouse5' : '';
addEventListener('mousedown', e => {
  if (binding) return; const c = mouseCode(e); if (!c) return;
  if (pttOn() && keyOf('ptt') === c) { e.preventDefault(); if (!V.gkeys) setPtt(true); return; }
  const id = findId(c); if (id) { e.preventDefault(); run(id); }
}, true);
addEventListener('mouseup', e => { const c = mouseCode(e); if (c && keyOf('ptt') === c && V.ptt && !V.gkeys) setPtt(false); }, true);
// «назад/вперёд» мыши не листают окно, если на них что-то висит
addEventListener('auxclick', e => { const c = mouseCode(e); if (c && (findId(c) || keyOf('ptt') === c)) e.preventDefault(); }, true);
addEventListener('blur', () => { if (V.ptt && !V.gkeys) setPtt(false); });

/* ---------- в играх: оболочка Windows сообщает о нажатиях ---------- */
const down = new Set();
let watch = new Map(); // vk главной клавиши → [{id, mods:[vk…]}]
let pttVk = 0;
export const gkeysOk = () => inTauri && /win/i.test(navigator.userAgent);
async function syncGlobal() {
  if (!inTauri) return;
  const want = !!prefs.pttGlobal, vks = new Set(); watch = new Map();
  const ptt = keyOf('ptt'); pttVk = vkOf(parts(ptt).slice(-1)[0] || '');
  if (want) {
    if (pttVk) vks.add(pttVk);
    for (const id of GLOBAL) {
      if (id === 'ptt') continue;
      const p = parts(keyOf(id)); if (!p.length) continue;
      const main = vkOf(p[p.length - 1]); if (!main) continue;
      const mods = p.slice(0, -1).map(m => vkOf(m)).filter(Boolean);
      vks.add(main); mods.forEach(m => vks.add(m));
      (watch.get(main) || watch.set(main, []).get(main)).push({ id, mods });
    }
  }
  try { V.gkeys = !!(await shell('hunty_keys', { vks: [...vks].slice(0, 48) })) && want; } catch (_) { V.gkeys = false; }
  if (!V.gkeys) down.clear();
}
if (inTauri) {
  shellListen('hunty-key', ({ vk, down: d }) => {
    if (d) down.add(vk); else down.delete(vk);
    if (vk === pttVk) { if (pttOn()) setPtt(!!d); else if (!d) setPtt(false); }
    if (!d || binding || document.hasFocus()) return; // в окне Hunty это и так ловится обычным образом
    const all = [0x11, 0x10, 0x12];
    for (const w of watch.get(vk) || []) {
      // нужные модификаторы зажаты, лишних — нет
      if (w.mods.every(m => down.has(m)) && all.every(m => w.mods.includes(m) || !down.has(m))) { run(w.id); break; }
    }
  });
  syncGlobal();
  bus.on('pref', k => { if (k === 'pttGlobal' || k === 'pttKey' || k === 'keys' || k === 'ptt') syncGlobal(); });
}

/* ---------- назначить клавишу ---------- */
/** ждёт нажатия: вернёт сочетание, '' (убрать) или null (передумал) */
export function capture(btn) {
  return new Promise(res => {
    binding = btn; btn.classList.add('wait'); const was = btn.innerHTML; btn.innerHTML = '<span class="kwait">нажми клавишу…</span>';
    let t = 0;
    const end = v => {
      removeEventListener('keydown', kd, true); removeEventListener('keyup', ku, true); removeEventListener('mousedown', md, true); clearTimeout(t);
      btn.classList.remove('wait'); btn.innerHTML = was; setTimeout(() => { binding = null; }, 0); res(v);
    };
    let mod = ''; // одиночный модификатор отпустили, ничего не нажав — значит, он и нужен (рация на Ctrl)
    const kd = e => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (e.code === 'Escape') return end(null);
      if ((e.code === 'Backspace' || e.code === 'Delete') && !e.ctrlKey && !e.altKey && !e.shiftKey) return end('');
      if (MODCODES.has(e.code)) { mod = e.code; return; }
      end(comboOf(e));
    };
    const ku = e => { if (mod && e.code === mod) { e.preventDefault(); end(mod); } };
    const md = e => {
      if (e.button === 0 || e.button === 2) { if (!btn.contains(e.target)) end(null); return; }
      e.preventDefault(); e.stopPropagation(); end(mouseCode(e));
    };
    addEventListener('keydown', kd, true); addEventListener('keyup', ku, true); addEventListener('mousedown', md, true);
    t = setTimeout(() => end(null), 10000);
  });
}
/** поставить сочетание действию: с проверкой занятости */
export function setKey(id, combo) {
  const keys = Object.assign({}, prefs.keys || {});
  if (combo && RESERVED[combo]) { tmsg('warn', `${keyLabel(combo)} занято приложением (${RESERVED[combo]}) — выбери другую`); return false; }
  let freed = '';
  if (combo) for (const [o] of KEYDEF) if (o !== id && keyOf(o) === combo) { keys[o] = ''; freed = o; }
  keys[id] = combo;
  if (id === 'ptt' && prefs.pttKey) setPref('pttKey', '');
  setPref('keys', keys);
  if (freed) tmsg('warn', `«${NAME[freed]}» теперь без клавиши — ${keyLabel(combo)} отдал «${NAME[id]}»`);
  else tmsg('ok', combo ? `${NAME[id]}: ${keyLabel(combo)}` : `${NAME[id]}: без клавиши`);
  return true;
}
export function resetKeys() { setPref('keys', {}); if (prefs.pttKey) setPref('pttKey', ''); tmsg('ok', 'все хоткеи — как были'); }
/** кнопка «нажми клавишу» для любого действия */
export async function bindKey(id, btn) {
  if (binding) return;
  const c = await capture(btn); if (c === null) return;
  setKey(id, c);
}

/* ---------- подписи: кнопки в звонке, F-клавиши, Настройки → Хоткеи ---------- */
function paintLabels() {
  $$('.vpop .key[data-k]').forEach(b => { const k = $('kbd', b); if (k) { const c = keyOf(b.dataset.k); k.textContent = c ? keyLabel(c) : '—'; } });
  const set = (sel, base, id) => { const el = $(sel); if (el) el.title = base + ' · ' + keyLabel(keyOf(id)); };
  set('.js-clip', `Клип: последние ${+prefs.clipSec || 30} сек`, 'clip');
  // .js-memic / .js-medeaf подписывает me.js (там ещё состояние и эффект голоса)
  set('.js-mmic', 'Микрофон', 'mic'); set('.js-mdeaf', 'Звук', 'deaf'); set('.js-vmin', 'Свернуть в мини-окно', 'mini');
  const sb = $('.js-sbstop'); if (sb) sb.title = 'Остановить показ · ' + keyLabel(keyOf('share'));
  const bt = $('.js-btns'); if (bt) bt.title = 'Кнопки и звуки · ' + ['F1', 'F2', 'F3', 'F7'].map(k => keyLabel(keyOf(k))).filter(x => x !== 'без клавиши').slice(0, 2).join(', ') + '…';
  renderList();
}
const list = $('.js-klist');
function renderList() {
  if (!list) return;
  const glob = !!prefs.pttGlobal && gkeysOk();
  list.innerHTML = KEYDEF.map(([id, name, sub, , g]) => (id === 'clip' ? (sub = `сохранить последние ${+prefs.clipSec || 30} секунд звонка`) : 0, `<div class="krow kbind" data-id="${id}"><span class="kl"><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${g && glob ? '<span class="kg" title="ловится, даже когда ты в игре">в играх</span>' : ''}${keyOf(id) !== (KDEF[id] || '') && !(id === 'ptt' && !prefs.keys?.ptt && !prefs.pttKey) ? '<button class="kx" type="button" data-reset="' + id + '" title="Вернуть как было" aria-label="Вернуть как было">↺</button>' : ''}<button class="kset" type="button" data-id="${id}" title="Нажми и выбери клавишу · Backspace — убрать" aria-label="${esc(name)}: ${esc(keyLabel(keyOf(id)))}. Нажми, чтобы поменять">${keyKbd(keyOf(id))}</button></div>`)).join('');
}
if (list) {
  list.addEventListener('click', e => {
    const r = e.target.closest('[data-reset]'); if (r) { const id = r.dataset.reset; const keys = Object.assign({}, prefs.keys || {}); delete keys[id]; if (id === 'ptt' && prefs.pttKey) setPref('pttKey', ''); setPref('keys', keys); tmsg('ok', `${NAME[id]}: снова ${keyLabel(keyOf(id))}`); return; }
    const b = e.target.closest('.kset'); if (b) bindKey(b.dataset.id, b);
  });
  const rs = $('.js-kreset'); if (rs) rs.addEventListener('click', resetKeys);
}
bus.on('pref', k => { if (k === 'keys' || k === 'pttKey' || k === 'pttGlobal' || k === 'clipSec') paintLabels(); });
bus.on('layout', () => requestAnimationFrame(paintLabels));
paintLabels();
