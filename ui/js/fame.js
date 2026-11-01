// Зал славы: лучшие моменты всех чатов + награды недели.
// Что попадает — решает ядро (api hall) по тем же правилам, что hof.js: 🏆 от друзей или «всем зашло».
// Новые попадания ловлю вживую по msg_upd: тост, звук и бейдж на кубке в шапке.
import { $, $$, esc, ic, prefs, setPref, bus, when, plural, MON } from './core.js';
import { api, mediaURL } from './api.js';
import { S, myId, nickOf, avaOf, colorOf, roomName } from './state.js';
import { sfx, toast, openW, closeW, OPEN, CLOSE, winOpen } from './ui.js';
import { openChat, jump, plain, openPic } from './chat.js';
import { stkSrc } from './stickers.js';
import { emo, emoImg } from './emoji.js';
import { hallWhy, cupsOf, CUP } from './hof.js';

const W = $('.win[data-win="hall"]'), btn = $('.js-hallb'), badge = $('.js-halln');
const H = { entries: [], awards: [], week: 0, ids: new Set(), loaded: false, room: '', focus: '' };
const T0 = Date.now();

/** понедельник 00:00 по местному времени */
export function weekStart(now = new Date()) { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); }

async function load() {
  const r = await api('hall', { week: weekStart(), tz: new Date().getTimezoneOffset() });
  H.entries = r.entries || []; H.awards = r.awards || []; H.week = r.week || weekStart(); H.loaded = true;
  H.ids = new Set(H.entries.map(e => e.id));
  // первый запуск с залом славы — всё старое уже «видел», бейдж с нуля
  if (!prefs.hallSeen) setPref('hallSeen', Math.max(Date.now() - 1, ...H.entries.map(e => e.at || 0)));
  paintBadge();
}
const fresh = () => H.entries.filter(e => (e.at || 0) > (prefs.hallSeen || 0)).length;
function paintBadge() {
  const n = winOpen() === 'hall' ? 0 : fresh();
  badge.hidden = !n; badge.textContent = n > 9 ? '9+' : String(n);
  btn.classList.toggle('new', n > 0);
  btn.title = n ? `Зал славы · новых моментов: ${n}` : 'Зал славы · лучшие моменты';
}
bus.on('ready', () => setTimeout(() => load().catch(() => {}), 2500));
btn.addEventListener('click', () => openW('hall'));

/* ---------- вживую: реакция докинула сообщение до зала славы ---------- */
let burst = [], burstT = 0;
bus.on('msg_upd', (room, id, m) => {
  if (!H.loaded) return;
  const r = S.rooms.get(room), why = m ? hallWhy(m, r && r.kind) : '';
  if (why && !H.ids.has(id)) {
    H.ids.add(id); const e = { ...m, why, at: Date.now(), cups: cupsOf(m) };
    H.entries.unshift(e);
    if (Date.now() - T0 > 15000) { burst.push(e); clearTimeout(burstT); burstT = setTimeout(announce, 700); }
  } else if (!why && H.ids.has(id)) { H.ids.delete(id); H.entries = H.entries.filter(x => x.id !== id); }
  else if (why) { const i = H.entries.findIndex(x => x.id === id); if (i >= 0) H.entries[i] = { ...m, why, at: H.entries[i].at, cups: cupsOf(m) }; }
  else return;
  paintBadge(); if (winOpen() === 'hall') render();
});
function announce() {
  const list = burst; burst = []; if (!list.length) return;
  const e = list[0], open = winOpen() === 'hall';
  if (open) { setPref('hallSeen', Date.now()); paintBadge(); }
  sfx('hall');
  if (open) return;
  toast({ ava: avaOf(e.from), icon: 'trophy', cls: 'hallt', dur: 9000,
    title: list.length > 1 ? `В зал славы: +${list.length} ${plural(list.length, 'момент', 'момента', 'моментов')}` : `В зал славы! ${e.from === myId() ? 'Твоё сообщение' : nickOf(e.from)}`,
    sub: list.length > 1 ? 'реакции решили — заходи посмотреть' : `${roomLabel(e.room)} · ${cut(previewText(e), 70)}`,
    tag: '🏆', actions: [{ label: 'Смотреть', cls: 'cbtn', fn: () => openW('hall', { room: e.room, id: e.id }) }] });
}

/* ---------- окно ---------- */
const AW = {
  meme: ['😂', 'Мем недели', n => `${n} ${plural(n, 'реакция', 'реакции', 'реакций')}`],
  star: ['🌟', 'Звезда недели', n => `собрал ${n} ${plural(n, 'реакцию', 'реакции', 'реакций')}`],
  talk: ['💬', 'Главный болтун', n => `${n} ${plural(n, 'сообщение', 'сообщения', 'сообщений')}`],
  stk: ['🎨', 'Стикерщик', n => `${n} ${plural(n, 'стикер', 'стикера', 'стикеров')}`],
  night: ['🦉', 'Ночная сова', n => `${n} ${plural(n, 'сообщение', 'сообщения', 'сообщений')} с 00 до 05`],
  gave: ['❤️', 'Щедрая душа', n => `раздал ${n} ${plural(n, 'реакцию', 'реакции', 'реакций')}`],
};
const ORDER = ['meme', 'star', 'talk', 'stk', 'night', 'gave'];
const roomLabel = id => { const r = S.rooms.get(id); return r && r.kind === 'dm' ? 'личка' : roomName(id); };
const cut = (t, n) => { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
function previewText(m) {
  const d = m.data || {};
  if (m.kind === 'sticker') return 'стикер';
  if (m.kind === 'image') return plain(m.text) || 'картинка';
  if (m.kind === 'file') return d.clip ? 'клип' : d.name || 'файл';
  return plain(m.text) || '…';
}
const picOf = m => { const d = m.data || {}; return typeof d.src === 'string' && d.src.startsWith('data:image/') ? d.src : d.ref ? mediaURL(m.room, m.id) : ''; };
function bodyHTML(m) {
  const d = m.data || {};
  if (m.kind === 'sticker') return `<img class="he-stk" alt="стикер" src="${esc(stkSrc(d, d.ref ? mediaURL(m.room, m.id) : ''))}" draggable="false">`;
  if (m.kind === 'image') { const src = picOf(m); return (src ? `<img class="he-pic" alt="" loading="lazy" decoding="async" src="${esc(src)}" data-pic="1">` : `<span class="he-dim">${ic('image')}картинка не докачалась</span>`) + (m.text ? `<span class="he-tx">${emo(esc(cut(plain(m.text), 160)))}</span>` : ''); }
  if (m.kind === 'file') return `<span class="he-file">${ic(d.clip ? 'clapperboard' : 'paperclip')}${esc(d.clip ? 'клип' + (d.dur ? ' · ' + Math.max(1, Math.round(d.dur / 1000)) + ' сек' : '') : d.name || 'файл')}</span>`;
  return `<span class="he-tx">${emo(esc(cut(plain(m.text), 260)))}</span>`;
}
function awardsHTML() {
  const list = ORDER.map(k => H.awards.find(a => a.k === k)).filter(Boolean);
  if (!list.length) return `<div class="aw-none">${emoImg('🏅', 'emja')}<span><b>Наград пока нет</b>неделя только началась — переписывайтесь, кидайте стикеры и реакции, лидеры появятся тут</span></div>`;
  return list.map(a => {
    const [e, t, s] = AW[a.k], me = a.peer === myId();
    const meme = a.k === 'meme' && a.msg ? `<button type="button" class="aw-msg" data-jump="${esc(a.room)}|${esc(a.id)}|${a.msg.ts || 0}" title="К сообщению">${bodyHTML(a.msg)}</button>` : '';
    return `<div class="aw${a.k === 'meme' ? ' wide' : ''}${me ? ' me' : ''}"><span class="aw-e">${emoImg(e, 'emja')}</span><span class="aw-b"><small>${esc(t)}</small><button type="button" class="aw-who" data-prof="${esc(a.peer)}"><img class="ava" alt="" src="${avaOf(a.peer)}"><b style="--c:${colorOf(a.peer)}">${me ? 'ты' : esc(nickOf(a.peer))}</b></button><span class="aw-n">${esc(s(a.n))}</span></span>${meme}</div>`;
  }).join('');
}
function entryHTML(e) {
  const isNew = (e.at || 0) > (H.seen || 0), rs = (e.reacts || []).filter(r => e.why !== 'cup' || r.e !== CUP).slice().sort((a, b) => (b.e === CUP) - (a.e === CUP) || b.p.length - a.p.length).slice(0, 5);
  const why = e.why === 'cup' ? `<span class="he-why cup">${emoImg(CUP, 'emjw')}${e.cups > 1 ? `${e.cups} ${plural(e.cups, 'кубок', 'кубка', 'кубков')}` : 'кубок'}</span>` : `<span class="he-why many">${ic('flame')}всем зашло</span>`;
  return `<button type="button" class="he${isNew ? ' new' : ''}" data-jump="${esc(e.room)}|${esc(e.id)}|${e.ts || 0}" data-id="${esc(e.id)}" title="К сообщению в чате">
    <img class="ava he-ava" alt="" src="${avaOf(e.from)}">
    <span class="he-m"><span class="he-h"><b style="--c:${colorOf(e.from)}">${e.from === myId() ? 'ты' : esc(nickOf(e.from))}</b><span class="he-room">${esc(roomLabel(e.room))}</span><time>${esc(when(e.ts))}</time>${isNew ? '<span class="he-newt">новое</span>' : ''}</span>
    <span class="he-body">${bodyHTML(e)}</span>
    <span class="he-f">${why}<span class="he-rx">${rs.map(r => `<span class="he-r">${emoImg(r.e, 'emjw')}${r.p.length}</span>`).join('')}</span></span></span></button>`;
}
function render() {
  const d = new Date(H.week || weekStart());
  $('.js-hlweek', W).textContent = `неделя с ${d.getDate()} ${MON[d.getMonth()]} · считается до воскресенья`;
  $('.js-hlaw', W).innerHTML = awardsHTML();
  const rooms = [...new Set(H.entries.map(e => e.room))].filter(r => S.rooms.has(r));
  const sel = $('.js-hlroom', W);
  if (H.room && !rooms.includes(H.room)) H.room = '';
  sel.innerHTML = `<option value="">все чаты · ${H.entries.length}</option>` + rooms.map(r => `<option value="${esc(r)}"${r === H.room ? ' selected' : ''}>${esc(roomName(r))} · ${H.entries.filter(e => e.room === r).length}</option>`).join('');
  sel.parentElement.hidden = rooms.length < 2;
  const list = H.entries.filter(e => !H.room || e.room === H.room);
  $('.js-hlcount', W).textContent = list.length ? `${list.length} ${plural(list.length, 'момент', 'момента', 'моментов')}` : '';
  $('.js-hlist', W).innerHTML = list.length ? list.map(entryHTML).join('') :
    `<div class="hl-empty">${emoImg(CUP, 'emjb')}<b>Тут будут лучшие моменты</b><span>Наведи на сообщение и жми ${emoImg(CUP, 'emji')} — в личке хватит одного кубка, в группе нужно два. Ещё сюда попадает то, на что накидали кучу реакций.</span></div>`;
}
OPEN.hall = async (_, o = {}) => {
  H.seen = prefs.hallSeen || 0; H.room = o.room && o.id ? '' : H.room;
  if (!H.loaded) $('.js-hlist', W).innerHTML = '<div class="hl-load">собираю лучшие моменты…</div>';
  else render();
  try { await load(); } catch (_) {}
  render(); setPref('hallSeen', Date.now()); paintBadge();
  if (o.id) {
    const el = $(`.he[data-id="${CSS.escape(o.id)}"]`, W);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 1800); }
  }
};
CLOSE.hall = () => { H.seen = Date.now(); paintBadge(); };
$('.js-hlroom', W).addEventListener('change', e => { H.room = e.target.value; render(); });
W.addEventListener('click', async e => {
  const t = e.target; if (!(t instanceof Element)) return;
  const pf = t.closest('[data-prof]'); if (pf) { e.stopPropagation(); closeW(); bus.emit('open-profile', pf.dataset.prof); return; }
  const pic = t.closest('img[data-pic]'); if (pic && e.altKey) { openPic(pic.src); return; }
  const j = t.closest('[data-jump]'); if (!j) return;
  const [room, id, ts] = j.dataset.jump.split('|');
  if (!S.rooms.has(room)) return;
  closeW();
  if (S.cur !== room) await openChat(room);
  setTimeout(() => jump(room, id, +ts || 0), 260);
});
