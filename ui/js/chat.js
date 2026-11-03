// Чаты: список, шапка, сообщения (ответы, реакции, правки, удаление, разметка), ввод, стикеры, файлы, «печатает…», меню
import { $, $$, R, esc, ic, hm, full, when, dayLabel, size, plural, reduce, mobile, prefs, setPref, bus, short } from './core.js';
import { api, openUrl, saveFile, mediaURL, saveMedia, reveal, inTauri } from './api.js';
import { S, myId, myNick, nickOf, avaOf, colorOf, colorByNick, isOnline, shownOnline, statusOf, dmPeer, roomName, voiceCount, voiceIn, typers, pushLocal, isFriend, isBlocked } from './state.js';
import { stkSrc, stkName, finWrap, addSticker } from './stickers.js';
import { emo, emoImg, emojiOnly } from './emoji.js';
import { openPicker } from './picker.js';
import { renderWs, tabOpened, isPinned } from './tabs.js';
import { flip, fly, bump, still, SOFT } from './motion.js';
import { app, tmsg, tone, TONES, toast, openW, closeW, OPEN, fail, notify, winOpen, copyText, sfx } from './ui.js';
import { mobURL, MOBKEYS } from './mobs.js';
import { onCtx, openMenu, ask, selectionIn } from './menu.js';
import { hallWhy, CUP } from './hof.js';
import { fxOf, fxChip } from './fxdef.js';

const chatsEl = $('.js-chats'), friendsEl = $('.js-friends'), logsEl = $('.js-logs'), typEl = $('.js-typing'), nochat = $('.js-nochat');
const chead = $('.js-chead'), cmeta = $('.js-cmeta'), hbtns = $('.js-hbtns');
const form = $('.js-form'), input = $('.js-input'), fileIn = $('.js-file'), cbar = $('.js-cbar');
let tab = 'chats', Q = '';
export { renderWs };
/** править своё сообщение можно 30 секунд после отправки (ядро проверяет то же самое) */
export const EDIT_MS = 30000;
export const canEdit = (m, room = S.cur) => !!m && m.from === myId() && m.kind !== 'sticker' && m.kind !== 'sys' && (Date.now() - m.ts < EDIT_MS || isSelf(room));
/** «Избранное» — чат с собой (как «Сохранённые» в Telegram) */
export const isSelf = r => { if (typeof r === 'string') r = S.rooms.get(r); return !!(r && r.kind === 'self'); };
const STL = { away: 'отошёл', dnd: 'не беспокоить' };
const logs = new Map();

/* ---------- мелкие шаблоны ---------- */
export const tileHTML = r => r.kind === 'self' ? `<span class="tile self" style="--tc:#6f8cff">${ic('bookmark')}</span>` : typeof r.pic === 'string' && r.pic.startsWith('data:image/')
  ? `<span class="tile pic" style="--tc:${esc(r.color || '#7ee2b8')}"><img alt="" src="${esc(r.pic)}" draggable="false"></span>`
  : `<span class="tile" style="--tc:${esc(r.color || '#7ee2b8')}">${esc(((r.name || '?').trim()[0] || '?').toUpperCase())}</span>`;
export function pdHTML(peer) {
  if (!shownOnline(peer)) return '<i class="pd" aria-hidden="true"></i>';
  const st = statusOf(peer);
  return `<i class="pd ${st === 'away' ? 'away' : st === 'dnd' ? 'dnd' : 'on'}" aria-hidden="true"></i>`;
}
/** строка статуса человека: «в сети», «не беспокоить · пилю hunty», «играет в Minecraft» */
export function lineOf(peer) {
  const p = (S.friends.get(peer) || {}).profile || {};
  if (!shownOnline(peer)) return p.line || 'не в сети';
  if (p.game) return 'играет в ' + p.game;
  const st = STL[statusOf(peer)];
  return st ? (p.line ? st + ' · ' + p.line : st) : (p.line || 'в сети');
}
function avHTML(r) {
  if (r.kind === 'dm') { const p = dmPeer(r); return `<span class="avw"><img class="ava" alt="" src="${avaOf(p)}">${pdHTML(p)}</span>`; }
  return `<span class="avw">${tileHTML(r)}</span>`;
}
export function sysText(m) {
  const who = nickOf(m.from), t = m.text || '';
  if (t === 'join') return `${who} залетел в группу`;
  if (t === 'create') return `${who} создал группу`;
  if (t === 'leave') return `${who} вышел из группы`;
  if (t.startsWith('call:')) return `звонок · ${t.slice(5)}`;
  if (t === 'missed') return `пропущенный звонок от ${who}`;
  if (t.startsWith('rename:')) return `${who} переименовал группу в «${t.slice(7)}»`;
  if (t.startsWith('kick:')) return `${who} выгнал ${nickOf(t.slice(5))}`;
  if (t === 'voice_on') return `${who} включил голосовой канал`;
  if (t === 'roll') return `${who} устроил перекличку`;
  if (t.startsWith('rollres:')) return t.slice(8);
  if (t.startsWith('pin:')) return `${who} закрепил сообщение`;
  if (t.startsWith('unpin:')) return `${who} открепил сообщение`;
  return t;
}
function lastPreview(r) {
  const ty = typers(r.id);
  if (ty.length) return `<span class="lty">${esc(nickOf(ty[0]))}${ty.length > 1 ? ' и ещё ' + (ty.length - 1) : ''} печатает<span class="pix" aria-hidden="true"><i></i><i></i><i></i></span></span>`;
  const l = r.last;
  if (r.pending) return '<span class="dim">ищу участников группы…</span>';
  if (!l) return '<span class="dim">пока пусто — напиши первым</span>';
  if (l.kind === 'sys') return esc(sysText(l));
  const me = l.from === myId();
  const pre = r.kind === 'self' ? (l.data && l.data.fwd && l.data.fwd.n ? `<b>${esc(l.data.fwd.n)}:</b> ` : '') : me ? '<b>ты:</b> ' : r.kind === 'dm' ? '' : `<b>${esc(nickOf(l.from))}:</b> `;
  const body = l.kind === 'sticker' ? 'стикер · ' + esc(stkName(l.data)) : l.kind === 'image' ? ic('image') + 'картинка' : l.kind === 'file' ? (l.data && l.data.clip ? ic('clapperboard') + 'клип' + (l.data.dur ? ' · ' + Math.max(1, Math.round(l.data.dur / 1000)) + ' сек' : '') : ic('paperclip') + esc((l.data && l.data.name) || 'файл')) : emo(esc(plain(l.text)));
  return pre + body;
}
/** текст без разметки: для превью, ответов и озвучки (спойлеры не палим) */
export const plain = t => String(t || '').replace(/```[\s\S]*?```/g, '[код]').replace(/\|\|[\s\S]+?\|\|/g, '▒▒▒').replace(/\*\*|__|~~|`/g, '').replace(/(^|\s)\*(\S)/g, '$1$2').replace(/(\S)\*(\s|$)/g, '$1$2').replace(/^> /gm, '').replace(/\s+/g, ' ').trim();
export const sorted = () => [...S.rooms.values()].sort((a, b) => ((b.last && b.last.ts) || b.created || 0) - ((a.last && a.last.ts) || a.created || 0));

/* ---------- список чатов ---------- */
function chatRow(r) {
  const vc = voiceCount(r.id), pin = isPinned(r.id), on = r.id === S.cur;
  const badge = r.unread && r.id !== S.cur ? `<span class="ub${r.muted ? ' mute' : ''}">${r.unread > 99 ? '99+' : r.unread}</span>` : vc ? `<span class="vc" title="в голосе">${ic('mic')}${vc}</span>` : '';
  return `<button class="ci${on ? ' on' : ''}${pin ? ' pinned' : ''}" data-chat="${esc(r.id)}" role="listitem"${on ? ' aria-current="true"' : ''}>${avHTML(r)}<span class="nm">${esc(roomName(r))}${r.muted ? ic('bell-off') : ''}${pin ? `<span class="cpin" title="закреплён">${ic('pin')}</span>` : ''}</span><time>${when((r.last && r.last.ts) || r.created)}</time><span class="lm">${lastPreview(r)}</span>${badge}</button>`;
}
export function renderChats() {
  const q = Q.trim().toLowerCase();
  const rs = sorted().filter(r => !q || roomName(r).toLowerCase().includes(q) || ((r.last && r.last.text) || '').toLowerCase().includes(q));
  const po = prefs.pinned || [], pin = rs.filter(r => po.includes(r.id)).sort((a, b) => po.indexOf(a.id) - po.indexOf(b.id)), rest = rs.filter(r => !po.includes(r.id));
  let html;
  if (!rs.length) html = q ? '<div class="empty">ничего не нашлось</div>' : `<div class="empty">чатов пока нет<br><button class="pbtn wide" data-win="friend">${ic('user-round-plus')}Добавить друга</button><button class="pbtn wide" data-win="join">${ic('link')}Вступить по инвайту</button></div>`;
  else html = (pin.length ? `<div class="sec cs" data-k="s:pin">${ic('pin')}Закреплённые</div>${pin.map(chatRow).join('')}${rest.length ? '<div class="sec cs" data-k="s:all">Чаты</div>' : ''}` : '') + rest.map(chatRow).join('');
  // одинаковый HTML не перерисовываем: иначе клик, попавший между mousedown и mouseup, теряется
  if (html !== chatsEl._h) {
    const sig = [...pin, ...rest].map(r => r.id).join(','), moved = chatsEl._sig && chatsEl._sig !== sig;
    chatsEl._sig = sig;
    const put = () => { chatsEl.innerHTML = html; chatsEl._h = html; };
    if (moved) flip(chatsEl, '.ci[data-chat], .sec[data-k]', put); else put();
  }
  renderWs();
}
function friendRow(f) {
  const p = f.profile || {}, vr = Object.keys(S.voices).find(k => voiceIn(k)[f.peer]);
  const right = vr ? `<span class="vc" title="в голосе">${ic('mic')}</span>` : '';
  const g = shownOnline(f.peer) && p.game ? ' game' : '';
  return `<button class="ci" data-prof="${esc(f.peer)}" role="listitem"><span class="avw"><img class="ava" alt="" src="${avaOf(f.peer)}">${pdHTML(f.peer)}</span><span class="nm">${esc(p.nick || short(f.peer))}</span><time></time><span class="lm${g}">${g ? ic('gamepad-2') : ''}${emo(esc(lineOf(f.peer)))}</span>${right}</button>`;
}
export function reqRow(f, inWin) {
  const p = f.profile || {};
  if (f.state === 'incoming') return `<div class="ci req" role="listitem"><span class="avw"><img class="ava" alt="" src="${avaOf(f.peer)}">${pdHTML(f.peer)}</span><span class="nm">${esc(p.nick || short(f.peer))}</span><span class="lm">хочет в друзья${p.line ? ' · ' + esc(p.line) : ''}</span><span class="ra"><button class="ib ok" data-fr="ok" data-u="${esc(f.peer)}" title="Принять" aria-label="Принять">${ic('check')}</button><button class="ib no" data-fr="no" data-u="${esc(f.peer)}" title="Отклонить" aria-label="Отклонить">${ic('x')}</button></span></div>`;
  return `<div class="ci req out" role="listitem"><span class="avw"><img class="ava" alt="" src="${avaOf(f.peer)}">${pdHTML(f.peer)}</span><span class="nm">${esc(p.nick || short(f.peer))}</span><span class="lm">${isOnline(f.peer) ? 'заявка отправлена · ждём ответа' : 'ищу в сети… заявка уйдёт, когда найдётся'}</span><span class="ra"><button class="ib no" data-fr="cancel" data-u="${esc(f.peer)}" title="Отменить" aria-label="Отменить">${ic('x')}</button></span></div>`;
}
export function renderFriends() {
  const q = Q.trim().toLowerCase();
  const fl = f => !q || ((f.profile && f.profile.nick) || '').includes(q) || ((f.profile && f.profile.line) || '').toLowerCase().includes(q);
  const all = [...S.friends.values()].filter(fl);
  const inc = all.filter(f => f.state === 'incoming'), out = all.filter(f => f.state === 'outgoing'), fr = all.filter(f => f.state === 'friend');
  const on = fr.filter(f => shownOnline(f.peer)).sort((a, b) => (a.profile.nick || '').localeCompare(b.profile.nick || '')), off = fr.filter(f => !shownOnline(f.peer));
  let h = '';
  if (inc.length) h += `<div class="sec">Заявки · ${inc.length}</div>` + inc.map(f => reqRow(f)).join('');
  if (on.length) h += `<div class="sec">В сети · ${on.length}</div>` + on.map(friendRow).join('');
  if (off.length) h += `<div class="sec">Не в сети · ${off.length}</div>` + off.map(friendRow).join('');
  if (out.length) h += `<div class="sec">Отправленные · ${out.length}</div>` + out.map(f => reqRow(f)).join('');
  const near = [...S.nearby.entries()].filter(([p]) => !S.friends.has(p));
  if (near.length && !q) h += `<div class="sec">Рядом, в локалке · ${near.length}</div>` + near.map(([p, pr]) => `<div class="ci req" role="listitem"><span class="avw"><img class="ava" alt="" src="${avaOf(p)}"><i class="pd on"></i></span><span class="nm">${esc(pr.nick)}</span><span class="lm">${esc(pr.line || 'в той же сети')}</span><span class="ra"><button class="ib ok" data-add="${esc(p)}" title="Добавить" aria-label="Добавить">${ic('user-round-plus')}</button></span></div>`).join('');
  if (!h) h = `<div class="empty">${q ? 'никого не нашлось' : 'друзей пока нет — добавь по нику или скинь свой код'}</div>`;
  h += `<button class="pbtn wide" data-win="friend">${ic('user-round-plus')}Добавить друга</button>`;
  if (h !== friendsEl._h) { friendsEl.innerHTML = h; friendsEl._h = h; }
  const n = $('.js-reqn'), k = [...S.friends.values()].filter(f => f.state === 'incoming').length;
  n.textContent = k; n.hidden = !k; n.setAttribute('aria-label', 'заявок: ' + k);
}
export function renderLists() { renderChats(); renderFriends(); }
export function setTab(t) {
  tab = t; $$('.stab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  chatsEl.hidden = t !== 'chats'; friendsEl.hidden = t !== 'friends';
  $('.js-search').placeholder = t === 'chats' ? 'Поиск по чатам' : 'Поиск друзей';
}
$$('.stab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('.js-search').addEventListener('input', e => { Q = e.target.value; renderLists(); });

/* ---------- переход в чат из списка (вкладки сверху — в tabs.js) ---------- */
chatsEl.addEventListener('click', e => {
  const c = e.target instanceof Element && e.target.closest('[data-chat]'); if (!c) return;
  e.preventDefault(); openChat(c.dataset.chat, { focus: true });
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); setTab('chats'); $('.js-search').focus(); }
});
// Ctrl+F (ловит menu.js): в открытом чате — поиск по переписке, иначе — по списку чатов
bus.on('find', () => { if (S.cur && !winOpen()) { openFind(); return; } setTab('chats'); $('.js-search').focus(); });

/* ---------- шапка чата ---------- */
const MEDIAB = () => `<button class="ib" data-act="media" title="Клипы и скрины" aria-label="Клипы и скрины">${ic('images')}</button>`;
export function header() {
  const r = S.rooms.get(S.cur);
  if (!r) { chead.innerHTML = '<span class="pt">Hunty</span>'; cmeta.textContent = 'серверов: 0'; hbtns.innerHTML = ''; return; }
  if (r.kind === 'dm') {
    const p = dmPeer(r), ty = typers(r.id).length;
    chead.innerHTML = `<span class="avw" data-prof="${esc(p)}"><img class="ava" alt="" src="${avaOf(p)}">${pdHTML(p)}</span><span class="pt" data-prof="${esc(p)}">${esc(nickOf(p))}</span>`;
    cmeta.classList.toggle('ty', ty > 0);
    cmeta.textContent = ty ? 'печатает…' : shownOnline(p) ? lineOf(p) : 'не в сети · сообщения дойдут, когда появится';
    const inCall = S.myVoice && S.myVoice[0] === r.id;
    hbtns.innerHTML = inCall ? `<button class="ib hang" data-act="hang" title="Положить трубку" aria-label="Положить трубку">${ic('phone-off')}</button>` : `<button class="ib" data-act="call" title="Позвонить" aria-label="Позвонить">${ic('phone')}</button>`;
    hbtns.innerHTML += MEDIAB() + `<button class="ib" data-act="find" title="Поиск по переписке (Ctrl+F)" aria-label="Поиск по переписке">${ic('search')}</button><button class="ib" data-prof="${esc(p)}" title="Профиль" aria-label="Профиль">${ic('user-round')}</button>`;
    input.placeholder = 'Написать @' + nickOf(p);
  } else if (r.kind === 'self') {
    cmeta.classList.remove('ty');
    chead.innerHTML = tileHTML(r) + '<span class="pt">Избранное</span>';
    cmeta.textContent = 'чат с собой · лежит только у тебя';
    hbtns.innerHTML = MEDIAB() + `<button class="ib" data-act="find" title="Поиск по избранному (Ctrl+F)" aria-label="Поиск по избранному">${ic('search')}</button>`;
    input.placeholder = 'Заметка себе…';
  } else {
    cmeta.classList.remove('ty');
    const ms = r.members || [], on = ms.filter(m => m.online).length, vc = voiceCount(r.id);
    chead.innerHTML = tileHTML(r) + `<span class="pt">${esc(r.name)}</span>`;
    cmeta.textContent = r.pending ? 'ищу участников в сети…' : `${ms.length} ${plural(ms.length, 'участник', 'участника', 'участников')} · в сети ${on}` + (vc ? ` · в голосе ${vc}` : '');
    hbtns.innerHTML = (r.voice ? `<button class="ib" data-act="voice" title="Голосовой канал" aria-label="Голосовой канал">${ic('mic')}</button>` : '') +
      ((r.invite === 'all' || r.admin) ? `<button class="ib" data-act="invite" title="Пригласить" aria-label="Пригласить">${ic('user-round-plus')}</button>` : '') +
      MEDIAB() + `<button class="ib" data-act="find" title="Поиск по переписке (Ctrl+F)" aria-label="Поиск по переписке">${ic('search')}</button>` +
      `<button class="ib" data-act="gset" title="Настройки группы" aria-label="Настройки группы">${ic('settings')}</button>`;
    input.placeholder = 'Написать в #' + r.name;
  }
  syncComposer();
}
hbtns.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'call') bus.emit('call', S.cur);
  else if (a === 'hang') bus.emit('hang');
  else if (a === 'voice') bus.emit('voice-join', S.cur);
  else if (a === 'invite') openW('gset', { room: S.cur, tab: 'invite' });
  else if (a === 'gset') openW('gset', { room: S.cur });
  else if (a === 'media') openW('media', { room: S.cur });
  else if (a === 'find') { if (fbar && !fbar.hidden && F.room === S.cur) closeFind(); else openFind(); }
});

/* ---------- разметка: **жирный** *курсив* __подчёркнутый__ ~~зачёркнутый~~ `код` ```блок``` ||спойлер|| > цитата ---------- */
const URLRE = /\bhttps?:\/\/[^\s<>"'\u0000]+[^\s<>"'.,;:!?)\]\u0000]/g;
function inline(t, keep) {
  const hold = h => '\u0000' + (keep.push(h) - 1) + '\u0000';
  t = t.replace(/hunty:\/\/(add|join)\/[A-Za-z0-9_-]+/g, c => hold(`<button class="hlink" type="button" data-code="${c}">${ic(c.includes('/join/') ? 'users' : 'user-round-plus')}${c.includes('/join/') ? 'вступить в группу' : 'добавить в друзья'}</button>`));
  t = t.replace(URLRE, u => hold(`<a class="lnk" href="${esc(u)}" data-url="${esc(u)}">${esc(u.length > 64 ? u.slice(0, 60) + '…' : u)}</a>`));
  let h = esc(t);
  h = h.replace(/\|\|(?=\S)(.+?)\|\|/g, '<span class="spl" role="button" tabindex="0" title="Спойлер — клик, чтобы открыть">$1</span>');
  h = h.replace(/\*\*(?=\S)(.+?)\*\*/g, '<b>$1</b>');
  h = h.replace(/__(?=\S)(.+?)__/g, '<u>$1</u>');
  h = h.replace(/~~(?=\S)(.+?)~~/g, '<s>$1</s>');
  h = h.replace(/(^|[^\w*\\])\*(?=[^\s*])([^*]*?[^\s*\\])\*(?![\w*])/g, '$1<i>$2</i>');
  const me = myNick();
  h = h.replace(/(^|[\s(>])@([a-z0-9_.-]{2,16})/gi, (m, pre, n) => {
    const l = n.toLowerCase(), c = colorByNick(l);
    return l === me ? `${pre}<mark class="me">@${n}</mark>` : `${pre}<span class="at" data-nick="${l}"${c ? ` style="--mc:${c}"` : ''}>@${n}</span>`;
  });
  return emo(h);
}
export function fmt(t) {
  t = String(t ?? '').replace(/\u0000/g, '');
  const keep = [], hold = h => '\u0000' + (keep.push(h) - 1) + '\u0000';
  t = t.replace(/```(?:([\w+#.-]{1,16})[ \t]*\n)?([\s\S]*?)```/g, (_, lang, code) => hold(`<pre class="mcode">${lang ? `<small>${esc(lang)}</small>` : ''}<code>${esc(code.replace(/^\n+|\s+$/g, ''))}</code></pre>`));
  t = t.replace(/`([^`\n]+)`/g, (_, c) => hold(`<code class="icode">${esc(c)}</code>`));
  const out = [];
  for (const ln of t.split('\n')) {
    const q = /^>(?: (.*))?$/.exec(ln), last = out[out.length - 1];
    const h = inline(q ? q[1] || '' : ln, keep);
    if (last && last.q === !!q) last.h += '<br>' + h; else out.push({ q: !!q, h });
  }
  return out.map(b => b.q ? `<span class="mq">${b.h}</span>` : b.h).join('')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i] ?? '')
    .replace(/(<\/pre>)<br>/g, '$1').replace(/<br>(<pre)/g, '$1');
}
export const mentionsMe = m => m && m.kind === 'text' && new RegExp('(^|[\\s(])@' + myNick().replace(/[.]/g, '\\.') + '\\b', 'i').test(m.text || '');

/* ---------- сообщения ---------- */
export const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👀', '💯'];
const MORE = ['🎉', '🤝', '😎', '🤔', '😡', '💀', '✅', '❌'];
const picSrc = m => { const dt = m.data || {}; return typeof dt.src === 'string' && dt.src.startsWith('data:image/') ? dt.src : dt.ref ? mediaURL(m.room, m.id) : ''; };
function rpText(rp) {
  if (rp.kind === 'sticker') return 'стикер';
  if (rp.kind === 'image') return '🖼 ' + (plain(rp.text) || 'картинка');
  if (rp.kind === 'file') return '📎 ' + (rp.name || 'файл');
  return plain(rp.text) || '…';
}
function rxHTML(m) {
  const rs = m.reacts || []; if (!rs.length) return '';
  const me = myId();
  const hw = hallWhy(m, (S.rooms.get(m.room) || {}).kind);
  return `<div class="rx">${hw ? `<button type="button" class="rc hofc" data-hof="${esc(m.id)}" title="${hw === 'cup' ? 'Друзья отправили это в зал славы' : 'Всем зашло — это в зале славы'}" aria-label="В зале славы">${emoImg(CUP, 'emjr')}<span>зал славы</span></button>` : ''}${rs.map(r => `<button type="button" class="rc${r.p.includes(me) ? ' on' : ''}" data-e="${esc(r.e)}" data-k="${esc(r.e)}" title="${esc(r.p.map(nickOf).join(', '))}" aria-label="${esc(r.e)} · ${r.p.length}">${emoImg(r.e, 'emjr')}<b>${r.p.length}</b></button>`).join('')}<button type="button" class="rc add" data-radd="1" title="Добавить реакцию" aria-label="Добавить реакцию">${ic('smile-plus')}</button></div>`;
}
const mediaOf = m => (m.data && m.data.ref ? mediaURL(m.room, m.id) : '');
function msgEl(m) {
  const d = document.createElement('div'); d.dataset.id = m.id; d.dataset.ts = m.ts;
  const dt0 = new Date(m.ts), t = `<time datetime="${dt0.toISOString()}" title="${full(dt0)}">${hm(dt0)}</time>`;
  if (m.kind === 'sys') {
    d.className = 'm sys';
    d.innerHTML = `<span class="mav">${ic(m.text.startsWith('call') || m.text === 'missed' ? 'phone' : m.text.startsWith('pin:') ? 'pin' : 'arrow-right')}</span><div class="mb"><span class="tx">${emo(esc(sysText(m)))}</span>${t}</div>`;
    return d;
  }
  const me = m.from === myId(), u = m.from, dt = m.data || {};
  d.className = 'm' + (m.kind === 'sticker' ? ' stkm' : '') + (mentionsMe(m) ? ' ment' : '') + (m.rp ? ' hasrp' : '') + (me ? ' mine' : '') + (hallWhy(m, (S.rooms.get(m.room) || {}).kind) ? ' hof' : '') + (fxOf(m) ? ' fxm' : '');
  d.dataset.u = u; d.style.setProperty('--c', colorOf(u));
  let body, n = 0;
  if (m.kind === 'sticker') { const nm = stkName(dt), mob = String(dt.k || '').startsWith('mob:'); const ss = esc(stkSrc(dt, mediaOf(m))); body = finWrap(dt, `<img class="stkimg${mob ? ' px' : ''}" alt="стикер: ${esc(nm)}" title="${esc(nm)}" src="${ss}" draggable="false">`, ss); }
  else if (m.kind === 'image') {
    const src = picSrc(m), w = Math.min(360, +dt.w || 0), wh = w && dt.h ? ` width="${w}" height="${Math.round(w * dt.h / dt.w)}"` : '';
    body = (src ? `<img class="pic" alt="${esc(dt.name || 'картинка')}" src="${esc(src)}"${wh} loading="lazy" decoding="async">` : `<span class="dim">${ic('image')} картинка не докачалась</span>`) + (m.text ? `<span class="cap">${fmt(m.text)}</span>` : '');
  } else if (m.kind === 'file' && /^video\/(webm|mp4)/.test(dt.mime || '') && (dt.ref || (typeof dt.src === 'string' && dt.src.startsWith('data:video/')))) {
    // клип прямо в чате: плеер + маленькая кнопка «сохранить»
    const src = dt.ref ? mediaOf(m) : dt.src;
    body = `<div class="vclip"><video controls preload="metadata" playsinline src="${esc(src)}#t=0.1"></video><button class="vcl-dl" type="button" data-file="${esc(m.id)}" title="Сохранить ${esc(dt.name || 'клип')} · ${esc(size(dt.size || 0))}" aria-label="Сохранить клип">${ic('download')}</button>${dt.clip ? `<span class="vcl-tag">${ic('clapperboard')}клип${dt.dur ? ' · ' + Math.round(dt.dur / 1000) + ' сек' : ''}</span>` : ''}</div>` + (m.text ? `<span class="cap">${fmt(m.text)}</span>` : '');
  } else if (m.kind === 'file') body = `<button class="file" type="button" data-file="${esc(m.id)}" title="Сохранить"><span class="fic">${ic('file')}</span><span class="fnm"><b>${esc(dt.name || 'файл')}</b><small>${esc(size(dt.size || 0))}</small></span>${ic('download')}</button>` + (m.text ? `<span class="cap">${fmt(m.text)}</span>` : '');
  else body = (n = emojiOnly(m.text)) ? `<span class="jumbo">${emo(esc(String(m.text).trim()))}</span>` : fmt(m.text || '') + linkCards(m.text);
  const rp = m.rp ? `<button type="button" class="rq" data-jump="${esc(m.rp.id)}" title="К сообщению">${m.rp.gone ? `${ic('reply')}<i>сообщение удалено</i>` : `<img class="ava" alt="" src="${avaOf(m.rp.from)}"><b style="--c:${colorOf(m.rp.from)}">${esc(nickOf(m.rp.from))}</b><span>${emo(esc(rpText(m.rp)))}</span>`}</button>` : '';
  const ed = m.edited ? `<small class="ed" title="изменено ${full(m.edited)}">(изм.)</small>` : '';
  const fw = !dt.fwd ? '' : isSelf(m.room) && dt.fwd.n ? `<span class="fwd sv">${ic('bookmark')}<b>${esc(dt.fwd.n)}</b>${dt.fwd.room && dt.fwd.room !== m.room && S.rooms.has(dt.fwd.room) ? ' · ' + esc(roomName(dt.fwd.room)) : ''}${dt.fwd.ts ? ' · ' + esc(when(dt.fwd.ts)) : ''}</span>`
    : `<span class="fwd">${ic('forward')}переслано${dt.fwd.n ? ` от <b>${esc(dt.fwd.n)}</b>` : ''}</span>`;
  d.innerHTML = `${rp}<span class="mav" data-u="${esc(u)}"${me ? ' data-me="1"' : ''}><img class="ava" alt="" src="${avaOf(u)}" draggable="false"></span><time class="ct" aria-hidden="true">${hm(dt0)}</time><div class="mb"><div class="mh"><span class="who" data-u="${esc(u)}"${me ? ' data-me="1"' : ''}>${esc(nickOf(u))}</span>${t}</div><div class="tx">${fw}${body}${ed}${fxChip(m)}</div>${rxHTML(m)}</div>`;
  return d;
}
/** превью ссылок: картинки по прямой ссылке и YouTube — грузятся только у того, кто включил «Превью ссылок» */
function linkCards(t) {
  if (prefs.linkPrev === false || !t) return '';
  const out = [];
  for (const u of String(t).match(URLRE) || []) {
    if (out.length >= 2) break;
    const yt = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([\w-]{11})/i.exec(u);
    if (yt) out.push(`<a class="lcard yt" href="${esc(u)}" data-url="${esc(u)}"><img alt="" src="https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg" loading="lazy" referrerpolicy="no-referrer"><span class="lplay">${ic('play')}</span><span class="lsite">YouTube</span></a>`);
    else if (/^https:\/\/[^\s?#]+\.(?:png|jpe?g|gif|webp|avif)(?:[?#]\S*)?$/i.test(u)) out.push(`<a class="lcard im" href="${esc(u)}" data-url="${esc(u)}"><img alt="" src="${esc(u)}" loading="lazy" referrerpolicy="no-referrer"></a>`);
  }
  return out.length ? `<span class="lcards">${out.join('')}</span>` : '';
}
const contOf = (p, m) => !!p && !m.rp && m.kind !== 'sys' && p.kind !== 'sys' && p.from === m.from && Math.abs(m.ts - p.ts) < 5 * 60000;
function grp(d) {
  const p = d.previousElementSibling;
  d.classList.remove('cont');
  if (!p || !d.dataset.u || d.classList.contains('hasrp') || !p.classList.contains('m') || p.classList.contains('sys') || p.dataset.u !== d.dataset.u) return;
  if (Math.abs((+d.dataset.ts || 0) - (+p.dataset.ts || 0)) < 5 * 60000) d.classList.add('cont');
}
function daySep(ts) { const s = document.createElement('div'); s.className = 'dsep'; s.dataset.day = new Date(ts).toDateString(); s.innerHTML = `<span>${esc(dayLabel(ts))}</span>`; return s; }
function logOf(room) {
  let l = logs.get(room);
  if (!l) {
    l = document.createElement('div'); l.className = 'log'; l.dataset.chat = room; l.setAttribute('role', 'log'); l.hidden = true;
    logsEl.appendChild(l); logs.set(room, l);
    l.addEventListener('scroll', () => { l._stick = atBottom(l); if (l.scrollTop < 60) loadOlder(room); }, { passive: true });
  }
  return l;
}
// сцена звонка/композер меняют высоту ленты — кто был внизу, тот внизу и остаётся
new ResizeObserver(() => { const l = logs.get(S.cur); if (l && !l.hidden && l._stick !== false) toBottom(l); }).observe(logsEl);
const atBottom = l => l.scrollHeight - l.scrollTop - l.clientHeight < 80;
export const toBottom = l => { if (l) l.scrollTop = l.scrollHeight; };
/** начало чата (как в Discord): большая ава, «это начало…» и пара кнопок */
function motd(r) {
  const d = document.createElement('div'); d.className = 'motd hello';
  if (r.kind === 'self') {
    d.innerHTML = `<span class="mo-av">${tileHTML(r)}</span><h2>Избранное</h2><p>Чат с собой: сохраняй сюда сообщения из любых чатов (наведи на сообщение → «…» → «В избранное»), кидай заметки, ссылки и файлы. Видишь только ты — друзьям сюда не попасть. Править своё можно сколько угодно.</p>`;
  } else if (r.kind === 'dm') {
    const p = dmPeer(r);
    d.innerHTML = `<img class="mo-av" alt="" src="${avaOf(p)}" data-prof="${esc(p)}"><h2 style="--mc:${esc(colorOf(p))}">${esc(nickOf(p))}</h2><p>Это начало вашей переписки с <b>@${esc(nickOf(p))}</b>. Сообщения идут напрямую от компа к компу и хранятся только у вас двоих.</p><div class="mo-b"><button type="button" class="gbtn sm" data-prof="${esc(p)}">${ic('user-round')}Профиль</button><button type="button" class="gbtn sm" data-mo="call">${ic('phone')}Позвонить</button></div>`;
  } else {
    d.innerHTML = `<span class="mo-av">${tileHTML(r)}</span><h2>Добро пожаловать в «${esc(r.name)}»</h2><p>Это начало группы. История хранится у самих участников — серверов нет, поэтому новое докачивается, когда кто-то из группы в сети.</p><div class="mo-b">${r.invite === 'all' || r.admin ? `<button type="button" class="gbtn sm" data-mo="inv">${ic('user-round-plus')}Позвать друзей</button>` : ''}<button type="button" class="gbtn sm" data-mo="set">${ic('settings')}Настройки</button></div>`;
  }
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-mo]'); if (!b) return;
    if (b.dataset.mo === 'call') bus.emit('call', r.id);
    else if (b.dataset.mo === 'inv') openW('gset', { room: r.id, tab: 'invite' });
    else if (b.dataset.mo === 'set') openW('gset', { room: r.id, tab: 'main' });
  });
  return d;
}
/** в группах сообщения заблокированных не показываем */
const shown = (room, m) => !(m.from !== myId() && isBlocked(m.from) && (S.rooms.get(room) || {}).kind === 'group');
function renderLog(room, keep) {
  const r = S.rooms.get(room), l = logOf(room), arr = (S.msgs.get(room) || []).filter(m => shown(room, m));
  const was = l.scrollHeight - l.scrollTop;
  const f = document.createDocumentFragment();
  if (r && (S.full.has(room) || arr.length < 40)) f.appendChild(motd(r));
  let day = '', unreadAt = null, prev = null;
  const rt = r ? r.read_ts || 0 : 0;
  for (const m of arr) {
    const dd = new Date(m.ts).toDateString(); let brk = false;
    if (dd !== day) { day = dd; f.appendChild(daySep(m.ts)); brk = true; }
    if (!unreadAt && r && r._openUnread && m.ts > rt && m.from !== myId() && m.kind !== 'sys') { unreadAt = m; const nd = document.createElement('div'); nd.className = 'newdiv'; nd.innerHTML = `<span>новые · ${r._openUnread}</span>`; f.appendChild(nd); brk = true; }
    const e = msgEl(m); if (!brk && contOf(prev, m)) e.classList.add('cont');
    f.appendChild(e); prev = m;
  }
  l.replaceChildren(f);
  if (keep === 'top') l.scrollTop = l.scrollHeight - was; else toBottom(l);
}
/** подгруженную историю дописываем сверху кусочком, а не перерисовываем всю ленту (на 600+ сообщениях это был лаг) */
function prependOld(room, old) {
  const r = S.rooms.get(room), l = logOf(room), list = old.filter(m => shown(room, m)), rt = r ? r.read_ts || 0 : 0;
  // разделитель «новые» должен переехать в подгруженное — тут проще честно перерисовать
  if (r && r._openUnread && list.some(m => m.ts > rt && m.from !== myId() && m.kind !== 'sys')) { renderLog(room, 'top'); return; }
  const was = l.scrollHeight - l.scrollTop, f = document.createDocumentFragment();
  const mo = l.firstElementChild; if (mo && mo.classList.contains('motd')) mo.remove();
  if (r && S.full.has(room)) f.appendChild(motd(r));
  let day = '', prev = null;
  for (const m of list) {
    const dd = new Date(m.ts).toDateString(); let brk = false;
    if (dd !== day) { day = dd; f.appendChild(daySep(m.ts)); brk = true; }
    const e = msgEl(m); if (!brk && contOf(prev, m)) e.classList.add('cont');
    f.appendChild(e); prev = m;
  }
  const first = l.firstElementChild; // старая лента начинается с разделителя дня — тот же день не дублируем
  if (prev && first && first.classList.contains('dsep') && first.dataset.day === day) {
    const nx = first.nextElementSibling; first.remove(); l.prepend(f);
    if (nx && nx.classList.contains('m') && !nx.classList.contains('hasrp')) grp(nx);
  } else l.prepend(f);
  l.scrollTop = l.scrollHeight - was;
}
function lastMsgEl(l) { for (let e = l.lastElementChild; e; e = e.previousElementSibling) if (e.classList.contains('m')) return e; return null; }
function appendMsg(room, m) {
  const l = logs.get(room); if (!l || !shown(room, m)) return;
  if ($(`.m[data-id="${CSS.escape(m.id)}"]`, l)) return;
  const arr = S.msgs.get(room) || [];
  const last = arr[arr.length - 1];
  if (last && last.id !== m.id) { renderLog(room, atBottom(l) ? '' : 'top'); return; } // пришло не по порядку
  const bottom = atBottom(l) || m.from === myId();
  const prev = lastMsgEl(l);
  if (!prev || new Date(+prev.dataset.ts).toDateString() !== new Date(m.ts).toDateString()) l.appendChild(daySep(m.ts));
  const e = msgEl(m); l.appendChild(e); grp(e);
  if (!reduce && m.from !== myId() && m.kind === 'text') { e.classList.add('fresh'); setTimeout(() => e.classList.remove('fresh'), 900); }
  if (bottom) { toBottom(l); trim(room); }
}
/** длинная переписка: в памяти и в DOM держим хвост, старое догрузится при прокрутке вверх */
function trim(room) {
  const arr = S.msgs.get(room); if (!arr || arr.length <= 320) return;
  arr.splice(0, arr.length - 200); S.full.delete(room); renderLog(room);
}
const loading = new Set();
async function loadOlder(room) {
  if (S.full.has(room) || loading.has(room)) return;
  const arr = S.msgs.get(room); if (!arr || !arr.length) return;
  loading.add(room);
  try {
    const res = await api('msgs', { room, before: arr[0].ts, limit: 80 });
    const old = (res.msgs || []).filter(m => !arr.some(x => x.id === m.id));
    if (!old.length || res.msgs.length < 80) S.full.add(room);
    arr.unshift(...old);
    if (old.length) prependOld(room, old);
  } catch (e) { console.warn(e); }
  loading.delete(room);
}
async function ensureMsgs(room) {
  if (S.msgs.has(room)) return;
  S.msgs.set(room, []);
  try {
    const res = await api('msgs', { room, limit: 80 });
    const arr = S.msgs.get(room) || [];
    const have = new Set(arr.map(m => m.id));
    arr.unshift(...(res.msgs || []).filter(m => !have.has(m.id)));
    arr.sort((a, b) => a.ts - b.ts);
    if ((res.msgs || []).length < 80) S.full.add(room);
  } catch (e) { S.msgs.delete(room); throw e; }
}
const findMsg = (room, id) => (S.msgs.get(room) || []).find(x => x.id === id);

/* ---------- реакции, ответы, правки, удаление ---------- */
export function react(room, id, e) { api('react', { room, id, e }).catch(fail); }
function reactPicker(room, id, el) {
  if (!findMsg(room, id)) return;
  openPicker({ el, mode: 'react', onEmoji: e => react(room, id, e) });
}
let replyTo = null, editing = null;
function startReply(room, m) {
  if (editing) cancelEdit(true);
  replyTo = { room, id: m.id, from: m.from, text: m.kind === 'text' ? plain(m.text) : rpText(m) };
  renderCbar(); input.focus();
}
function cancelReply() { if (!replyTo) return; replyTo = null; renderCbar(); }
let edT = 0;
function startEdit(room, m) {
  if (m.from !== myId() || m.kind === 'sticker' || m.kind === 'sys') return;
  if (!canEdit(m, room)) { tmsg('warn', 'править можно только 30 секунд после отправки — дальше удали и напиши заново'); return; }
  replyTo = null;
  editing = { room, id: m.id, kind: m.kind, draft: editing ? editing.draft : input.value, text: m.text || '' };
  editing.ts = m.ts;
  input.value = m.text || ''; autosize(); renderCbar();
  input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  editing.free = isSelf(room); // в «Избранном» — без отсчёта
  clearInterval(edT); if (!editing.free) edT = setInterval(edTick, 250);
}
/** обратный отсчёт правки: кольцо в полоске над вводом, вышло время — правка отменяется */
function edTick() {
  if (!editing) { clearInterval(edT); return; }
  const left = EDIT_MS - (Date.now() - editing.ts);
  if (left <= 0) { clearInterval(edT); cancelEdit(); tmsg('warn', 'время на правку вышло — 30 секунд после отправки'); return; }
  const r = $('.js-edring', cbar), n = $('.js-edleft', cbar);
  if (r) r.style.setProperty('--p', (left / EDIT_MS * 100).toFixed(1));
  if (n) n.textContent = Math.ceil(left / 1000);
  cbar.classList.toggle('late', left < 8000);
}
function cancelEdit(keepInput) {
  if (!editing) return; const d = editing.draft; editing = null; clearInterval(edT);
  if (!keepInput) { input.value = d || ''; autosize(); }
  renderCbar();
}
async function saveEdit() {
  const ed = editing, v = input.value.trim();
  if (v === (ed.text || '').trim()) { cancelEdit(); return; }
  if (!v && ed.kind === 'text') { cancelEdit(); delMsg(ed.room, findMsg(ed.room, ed.id)); return; }
  try { await api('edit', { room: ed.room, id: ed.id, text: v }); editing = null; clearInterval(edT); input.value = ed.draft || ''; autosize(); renderCbar(); }
  catch (e) { fail(e); }
}
async function hideMsg(room, id) { try { await api('msg_hide', { room, id }); } catch (e) { fail(e); } }
async function delMsg(room, m) {
  if (!m) return;
  const mine = m.from === myId();
  if (!(await ask({ title: 'Удалить у всех?', text: mine ? 'Сообщение пропадёт у всех в чате — у тех, кто сейчас не в сети, когда они появятся.' : `Это сообщение ${nickOf(m.from)}. Ты админ — удалится у всех участников.`, ok: 'Удалить', danger: true, icon: 'trash-2' }))) return;
  try { await api('del', { room, id: m.id }); tmsg('ok', 'сообщение удалено у всех'); } catch (e) { fail(e); }
}
function mention(peer) { const n = nickOf(peer); const v = input.value; input.value = (v && !/\s$/.test(v) ? v + ' ' : v) + '@' + n + ' '; autosize(); input.focus(); }
export function openPic(src) { $('img', lbox).src = src; lbox.hidden = false; }
async function copyPic(src) {
  try {
    const blob = await (await fetch(src)).blob();
    let png = blob;
    if (blob.type !== 'image/png') {
      const bm = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; c.getContext('2d').drawImage(bm, 0, 0);
      png = await new Promise(r => c.toBlob(r, 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    tmsg('ok', 'картинка скопирована — вставляй куда хочешь');
  } catch (_) { tmsg('warn', 'не вышло скопировать картинку — сохрани её'); }
}
async function saveMsgFile(room, m) {
  const dt = m.data || {}, name = dt.name || (m.kind === 'image' ? 'hunty-' + m.id.slice(0, 8) + '.webp' : 'file');
  try {
    const path = typeof dt.src === 'string' && dt.src.startsWith('data:') ? await saveFile(name, dt.src) : await saveMedia(room, m.id, name);
    if (inTauri) toast({ icon: 'download', title: 'Сохранил в «Загрузки»', sub: String(path), dur: 7000, actions: [{ label: 'Показать в папке', cls: 'gbtn', fn: () => reveal(path) }] });
    else tmsg('ok', 'скачиваю «' + name + '»');
  } catch (e) { fail(e); }
}
/** прыжок к сообщению: если оно старше загруженного — догружаю историю до него */
export async function jump(room, id, ts, q) {
  const find = () => { const l = logs.get(room); return l && $(`.m[data-id="${CSS.escape(id)}"]`, l); };
  let el = find();
  if (!el && room === S.cur) { await loadTo(room, id, ts); el = find(); }
  if (!el) { tmsg('warn', 'не нашёл это сообщение — может, его удалили'); return; }
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  el.classList.remove('hl'); void el.offsetWidth; el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 1800);
  if (q) { unmark(); markIn(el, q); }
}
async function loadTo(room, id, ts) {
  const arr = S.msgs.get(room); if (!arr || arr.some(m => m.id === id)) return;
  if (ts) {
    try {
      const res = await api('msgs_to', { room, ts });
      const have = new Set(arr.map(m => m.id)), add = (res.msgs || []).filter(m => !have.has(m.id));
      if (add.length) { arr.unshift(...add); arr.sort((a, b) => a.ts - b.ts); }
      if ((res.msgs || []).length >= (res.total || 0)) S.full.add(room);
      renderLog(room, 'top'); return;
    } catch (_) { /* старое ядро — листаю страницами */ }
  }
  for (let k = 0; k < 25 && !S.full.has(room) && !arr.some(m => m.id === id); k++) await loadOlder(room);
}

/* ---------- поиск по переписке (Ctrl+F): ищет ядро по всей истории, тут — строка, список и прыжки ---------- */
const fbar = $('.js-fbar'), fq = $('.js-fq'), fcount = $('.js-fcount'), fres = $('.js-fres');
const F = { room: '', q: '', hits: [], total: 0, i: -1, seq: 0, t: 0 };
const norm = x => String(x || '').toLowerCase().replace(/ё/g, 'е');
const plainOf = m => m.kind === 'text' || !m.kind ? String(m.text || '').replace(/(\*\*|__|~~|\|\||```|`)/g, '') : (m.data && m.data.name) || m.text || '';
export function openFind() {
  const room = S.cur; if (!room || !fbar) return;
  if (F.room !== room) { F.room = room; F.q = ''; F.hits = []; F.total = 0; F.i = -1; fq.value = ''; fcount.textContent = ''; fres.hidden = true; unmark(); }
  fbar.hidden = false; app.classList.add('finding');
  fq.focus(); fq.select();
  if (fq.value.trim() && F.hits.length) showRes(true);
}
export function closeFind() {
  if (!fbar || fbar.hidden) return;
  fbar.hidden = true; fres.hidden = true; app.classList.remove('finding'); unmark();
  F.room = ''; F.q = ''; F.hits = []; F.i = -1; F.seq++;
}
async function runFind() {
  const q = fq.value.trim(), room = F.room, seq = ++F.seq;
  if (!q) { F.q = ''; F.hits = []; F.total = 0; F.i = -1; syncFind(); fres.hidden = true; unmark(); return; }
  let res;
  try { res = await api('search', { room, q, limit: 100 }); }
  catch (_) { // старое ядро без поиска — ищу по тому, что загружено
    const hits = (S.msgs.get(room) || []).filter(m => m.kind !== 'sys' && norm(plainOf(m)).includes(norm(q))).reverse();
    res = { msgs: hits.slice(0, 100), total: hits.length };
  }
  if (seq !== F.seq || room !== F.room) return;
  F.q = q; F.hits = res.msgs || []; F.total = res.total || 0; F.i = -1;
  syncFind(); showRes(true);
}
function syncFind() {
  fcount.textContent = !F.q ? '' : !F.total ? 'ничего' : F.i >= 0 ? `${F.i + 1} из ${F.total}` : `${F.total} ${plural(F.total, 'совпадение', 'совпадения', 'совпадений')}`;
  fbar.classList.toggle('none', !!F.q && !F.total);
  $$('.fbtn', fbar).forEach(b => { b.disabled = !F.hits.length; });
}
function snip(m, q) {
  const t = plainOf(m).replace(/\s+/g, ' '), i = norm(t).indexOf(norm(q));
  if (i < 0) return emo(esc(t.slice(0, 120)));
  const a = Math.max(0, i - 36), b = Math.min(t.length, i + q.length + 60);
  return (a ? '…' : '') + emo(esc(t.slice(a, i))) + '<mark>' + emo(esc(t.slice(i, i + q.length))) + '</mark>' + emo(esc(t.slice(i + q.length, b))) + (b < t.length ? '…' : '');
}
function showRes(on) {
  if (!on || !F.q) { fres.hidden = true; return; }
  const n = F.hits.length;
  fres.innerHTML = (n ? F.hits.map((m, i) => `<button class="fr${i === F.i ? ' on' : ''}" data-i="${i}" type="button"><img class="ava" alt="" src="${avaOf(m.from)}"><span class="frb"><span class="frt"><b style="color:${colorOf(m.from)}">${esc(nickOf(m.from))}</b><time>${esc(when(m.ts))}</time>${m.kind && m.kind !== 'text' ? `<span class="frk">${ic(m.kind === 'image' ? 'image' : m.kind === 'sticker' ? 'sticker' : 'file')}</span>` : ''}</span><span class="frx">${snip(m, F.q)}</span></span></button>`).join('')
    : `<div class="fempty"><img alt="" src="emoji/1f50e.webp" draggable="false"><b>Ничего не нашлось</b><small>попробуй другое слово — ищу по всей истории этого чата</small></div>`)
    + (F.total > n ? `<div class="frh">показаны ${n} самых новых из ${F.total}</div>` : '');
  fres.hidden = false;
  const on1 = $('.fr.on', fres); if (on1) on1.scrollIntoView({ block: 'nearest' });
}
async function goHit(i, keepList) {
  if (!F.hits.length) return;
  F.i = (i + F.hits.length) % F.hits.length; syncFind();
  $$('.fr', fres).forEach(b => b.classList.toggle('on', +b.dataset.i === F.i));
  if (!keepList) fres.hidden = true;
  const m = F.hits[F.i]; await jump(F.room, m.id, m.ts, F.q);
}
function unmark() {
  $$('mark.fm', logsEl).forEach(k => { const p = k.parentNode; k.replaceWith(document.createTextNode(k.textContent)); p && p.normalize(); });
}
function markIn(el, q) {
  const tx = $('.tx', el); if (!tx) return;
  const nq = norm(q), w = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT), nodes = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) if (norm(n.nodeValue).includes(nq)) nodes.push(n);
  for (const n of nodes) {
    let node = n;
    for (let i = norm(node.nodeValue).indexOf(nq); i >= 0 && node; i = norm(node.nodeValue).indexOf(nq)) {
      const hit = node.splitText(i), rest = hit.splitText(q.length);
      const k = document.createElement('mark'); k.className = 'fm'; k.textContent = hit.nodeValue; hit.replaceWith(k); node = rest;
    }
  }
}
if (fbar) {
  fq.addEventListener('input', () => { clearTimeout(F.t); F.t = setTimeout(runFind, 220); });
  fq.addEventListener('focus', () => { if (F.q) showRes(true); });
  fq.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!fres.hidden) fres.hidden = true; else closeFind(); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (F.q !== fq.value.trim()) { clearTimeout(F.t); runFind(); return; } goHit(F.i + (e.shiftKey ? -1 : 1), false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!F.hits.length) return; e.preventDefault(); if (fres.hidden) showRes(true); goHit(F.i + (e.key === 'ArrowDown' ? 1 : -1), true); }
  });
  fbar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('js-fnext')) goHit(F.i + 1);
    else if (b.classList.contains('js-fprev')) goHit(F.i - 1);
    else if (b.classList.contains('js-fx')) closeFind();
  });
  fres.addEventListener('click', e => { const b = e.target.closest('.fr[data-i]'); if (b) goHit(+b.dataset.i); });
  document.addEventListener('pointerdown', e => { if (!fres.hidden && !e.target.closest('.js-fres, .js-fbar')) fres.hidden = true; });
  bus.on('open', id => { if (F.room && id !== F.room) closeFind(); });
}
/** обновить одно сообщение на месте (картинку не перезагружаем) */
function patchMsg(room, id, msg) {
  const l = logs.get(room); const el = l && $(`.m[data-id="${CSS.escape(id)}"]`, l);
  if (el) {
    if (msg && shown(room, msg)) {
      const n = msgEl(msg), keepImg = $('.pic, .stkimg', el), newImg = $('.pic, .stkimg', n);
      if (keepImg && newImg && keepImg.getAttribute('src') === newImg.getAttribute('src')) newImg.replaceWith(keepImg);
      el.replaceWith(n); grp(n);
      const nx = n.nextElementSibling; if (nx && nx.classList.contains('m')) grp(nx);
    } else {
      const nx = el.nextElementSibling; el.remove(); if (nx && nx.classList.contains('m')) grp(nx);
    }
  }
  // ответы на это сообщение: цитата меняется вместе с ним
  for (const m of S.msgs.get(room) || []) {
    if (!m.rp || m.rp.id !== id) continue;
    m.rp = msg ? { id, from: msg.from, kind: msg.kind, text: String(msg.text || '').slice(0, 140), name: (msg.data && msg.data.name) || '' } : { id, gone: true };
    const re = l && $(`.m[data-id="${CSS.escape(m.id)}"]`, l); if (re) { const n = msgEl(m), op = [...re.querySelectorAll('.spl')].map(x => x.classList.contains('open')); n.className = re.className; n.querySelectorAll('.spl').forEach((x, i) => { if (op[i]) x.classList.add('open'); }); if (mact.parentElement === re) n.appendChild(mact); re.replaceWith(n); }
  }
}
bus.on('msg_upd', (room, id, msg) => {
  patchMsg(room, id, msg);
  if (!msg && editing && editing.id === id) cancelEdit();
  if (!msg && replyTo && replyTo.id === id) cancelReply();
  renderChats();
});

/* ---------- полоска над вводом: ответ, правка, блокировка ---------- */
function renderCbar() {
  const r = S.rooms.get(S.cur), p = r && r.kind === 'dm' ? dmPeer(r) : '';
  form.classList.toggle('editing', !!(editing && editing.room === S.cur));
  if (p && isBlocked(p)) {
    cbar.hidden = false; cbar.className = 'cbar js-cbar cbk';
    cbar.innerHTML = `${ic('ban')}<span class="cb-t">Ты заблокировал <b>${esc(nickOf(p))}</b> — сообщения и звонки не ходят</span><button type="button" class="gbtn sm" data-cb="unblock">Разблокировать</button>`;
    return;
  }
  if (editing && editing.room === S.cur) {
    cbar.hidden = false; cbar.className = 'cbar js-cbar ed';
    const left = Math.max(0, EDIT_MS - (Date.now() - editing.ts));
    cbar.innerHTML = `${ic('pencil')}<span class="cb-t">Редактирование <span class="dim"><kbd>Enter</kbd> сохранить · <kbd>Esc</kbd> отмена</span></span>${editing.free ? '' : `<span class="edring js-edring" style="--p:${(left / EDIT_MS * 100).toFixed(1)}" title="сколько секунд ещё можно править"><b class="js-edleft">${Math.ceil(left / 1000)}</b></span>`}<button type="button" class="ib sm" data-cb="x" title="Отменить" aria-label="Отменить">${ic('x')}</button>`;
  } else if (replyTo && replyTo.room === S.cur) {
    cbar.hidden = false; cbar.className = 'cbar js-cbar rp';
    cbar.innerHTML = `${ic('reply')}<span class="cb-t">Ответ <b style="color:${colorOf(replyTo.from)}">${esc(nickOf(replyTo.from))}</b><span class="dim"></span></span><button type="button" class="ib sm" data-cb="x" title="Не отвечать · Esc" aria-label="Не отвечать">${ic('x')}</button>`;
    $('.cb-t .dim', cbar).textContent = ' · ' + replyTo.text.slice(0, 120);
  } else { cbar.hidden = true; cbar.innerHTML = ''; }
}
function syncComposer() {
  const r = S.rooms.get(S.cur), p = r && r.kind === 'dm' ? dmPeer(r) : '';
  const bl = !!(p && isBlocked(p));
  form.hidden = !S.cur || bl;
  renderCbar();
}
cbar.addEventListener('click', e => {
  const b = e.target.closest('[data-cb]'); if (!b) return;
  if (b.dataset.cb === 'x') { cancelEdit(); cancelReply(); input.focus(); }
  if (b.dataset.cb === 'unblock') bus.emit('unblock', dmPeer(S.rooms.get(S.cur)));
});
bus.on('blocked', () => { renderLists(); if (S.cur) { syncComposer(); const l = logs.get(S.cur); renderLog(S.cur, l && !atBottom(l) ? 'top' : ''); } });

/* ---------- открыть чат ---------- */
let readT = 0;
export function markRead(room) {
  const r = S.rooms.get(room); if (!r || !r.unread) return;
  clearTimeout(readT); readT = setTimeout(() => { api('read', { room }).catch(() => {}); }, 300);
  r.unread = 0; renderChats();
}
export async function openChat(id, { focus = false } = {}) {
  const r = S.rooms.get(id); if (!r) return;
  const prev = S.cur; S.cur = id; setPref('lastChat', id);
  if (prev !== id) { if (editing && editing.room !== id) cancelEdit(); if (replyTo && replyTo.room !== id) replyTo = null; pinI = 0; }
  tabOpened(id);
  nochat.hidden = true;
  logs.forEach((l, k) => { l.hidden = k !== id; });
  const l = logOf(id); l.hidden = false;
  r._openUnread = r.unread || 0;
  header(); renderChats(); renderTyping();
  try { await ensureMsgs(id); } catch (e) { fail(e); }
  if (S.cur !== id) return;
  renderLog(id); renderPinbar();
  r._openUnread = 0;
  markRead(id);
  syncComposer();
  if (focus && !mobile() && !form.hidden) input.focus({ preventScroll: true });
  bus.emit('open', id, prev);
}
export function showEmpty() {
  S.cur = ''; logs.forEach(l => { l.hidden = true; }); nochat.hidden = false; header(); renderChats(); form.hidden = true; cbar.hidden = true; renderPinbar();
  const has = S.rooms.size > 0;
  $('.nc-h', nochat).textContent = has ? 'Выбери чат' : 'Тут пока тихо';
  $('.nc-in > small', nochat).textContent = has ? 'Слева — чаты и друзья. Открытые чаты живут во вкладках сверху: Alt+1…9 — переключиться, Ctrl+W — закрыть.' : 'Серверов нет — чаты живут у тебя и у друзей. Добавь друга по нику или коду, собери группу или вступи по инвайту.';
  const m = $('.js-ncmob'); if (m && !m.firstChild) m.innerHTML = `<img alt="" src="${mobURL(MOBKEYS[Math.floor(Math.random() * MOBKEYS.length)])}" width="56" height="56">`;
}

/* ---------- ввод и отправка ---------- */
/** ответ, если он был начат в этом чате, — уходит с первым же сообщением */
function takeReply() { if (!replyTo || replyTo.room !== S.cur) return ''; const id = replyTo.id; replyTo = null; renderCbar(); return id; }
async function send(kind, text, data, reply = takeReply(), from = null) {
  const room = S.cur; if (!room) return;
  try {
    const m = await api('send', { room, kind, text, data, reply });
    pushLocal(m);
    sendTyping(false);
    const l = logs.get(room), el = l && !l.hidden && $(`.m[data-id="${CSS.escape(m.id)}"]`, l);
    if (el) {
      if (from) fly(from.r, $('.tx', el), from.h);
      else if (!still()) el.animate([{ opacity: 0, transform: 'translateY(14px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: SOFT });
    }
    return m;
  } catch (e) { fail(e); }
}
export const sendTo = (room, kind, text, data) => api('send', { room, kind, text, data }).then(m => { pushLocal(m); return m; });
export function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 168) + 'px'; }
/** отправить то, что в поле; data — доп. поля (эффект), empty — что слать, если поле пустое */
export function submitText(data, empty = '') {
  if (editing && editing.room === S.cur) { saveEdit(); return; }
  const v = input.value.trim() || empty; if (!v || !S.cur || form.hidden) return;
  const fr = input.getBoundingClientRect(), cs = getComputedStyle(input);
  const from = { r: { left: fr.left + parseFloat(cs.paddingLeft), top: fr.top + parseFloat(cs.paddingTop), width: fr.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }, h: emojiOnly(v) ? `<span class="jumbo">${emo(esc(v))}</span>` : emo(esc(plain(v))) };
  input.value = ''; autosize(); return send('text', v, data, takeReply(), from);
}
form.addEventListener('submit', e => { e.preventDefault(); submitText(); });
let tyT = 0, tySent = 0;
function sendTyping(on = true) {
  if (!S.cur) return;
  const r = S.rooms.get(S.cur); if (!r || r.pending) return;
  if (on && Date.now() - tySent < 3000) return;
  if (!on && !tySent) return;
  tySent = on ? Date.now() : 0;
  api('ev', { room: S.cur, kind: 'typing', data: { on } }).catch(() => {});
}
input.addEventListener('input', () => { autosize(); if (editing) return; if (input.value.trim()) { sendTyping(true); clearTimeout(tyT); tyT = setTimeout(() => sendTyping(false), 5000); } });
function wrapSel(a, b = a) {
  const s = input.selectionStart, e = input.selectionEnd, sel = input.value.slice(s, e);
  input.focus(); document.execCommand('insertText', false, a + sel + b);
  if (!sel) input.setSelectionRange(s + a.length, s + a.length);
}
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !e.ctrlKey && !e.altKey) { e.preventDefault(); form.requestSubmit(); return; }
  if (e.key === 'Escape' && (editing || replyTo)) { e.preventDefault(); e.stopPropagation(); if (editing) cancelEdit(); else cancelReply(); return; }
  if (e.key === 'ArrowUp' && !input.value && !editing && !e.shiftKey) { // ↑ в пустом поле — править своё последнее (30 сек)
    const arr = S.msgs.get(S.cur) || [];
    for (let i = arr.length - 1; i >= 0; i--) { const m = arr[i]; if (m.from === myId() && m.kind !== 'sys' && m.kind !== 'sticker') { if (canEdit(m)) { e.preventDefault(); startEdit(S.cur, m); } return; } }
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && ['KeyB', 'KeyI', 'KeyU'].includes(e.code)) { e.preventDefault(); wrapSel(e.code === 'KeyB' ? '**' : e.code === 'KeyI' ? '*' : '__'); return; }
  if (e.key === 'Tab' && !e.shiftKey) { // @ник — дополнение по Tab
    const m = /@([a-z0-9_.-]*)$/i.exec(input.value.slice(0, input.selectionStart));
    if (m) {
      const r = S.rooms.get(S.cur); const cands = ((r && r.members) || []).map(x => x.nick).filter(n => n && n.startsWith(m[1].toLowerCase()) && n !== myNick());
      if (cands.length) { e.preventDefault(); const s = input.selectionStart; input.value = input.value.slice(0, s - m[1].length) + cands[0] + ' ' + input.value.slice(s); }
    }
  }
});

/* ---------- эмодзи и стикеры: один пикер (picker.js) ---------- */
const emoB = $('.js-emo'), stkB = $('.js-stkb');
function insertText(t) { input.focus(); if (!document.execCommand('insertText', false, t)) { const a = input.selectionStart, b = input.selectionEnd; input.setRangeText(t, a, b, 'end'); } autosize(); }
export function sendSticker(dt) { if (!S.cur || form.hidden) return; send('sticker', '', dt); sfx('pop', .6); }
function pick(tab, el) { openPicker({ el, tab, mode: 'insert', onEmoji: insertText, onSticker: sendSticker, onClose: back => { if (back) input.focus(); } }); }
emoB.addEventListener('click', e => { e.preventDefault(); pick('emoji', emoB); });
stkB.addEventListener('click', e => { e.preventDefault(); pick('sticker', stkB); });
export function stkToggle() { pick('sticker', stkB); }

/* ---------- картинки и файлы ---------- */
const MAXF = 6 * 1024 * 1024;
const readURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
async function shrink(f) {
  const url = await readURL(f);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  let w = img.naturalWidth, h = img.naturalHeight;
  if (f.type === 'image/gif' && f.size < 2.5 * 1024 * 1024) return { src: url, w, h };
  const k = Math.min(1, 1600 / Math.max(w, h));
  if (k === 1 && f.size < 700 * 1024) return { src: url, w, h };
  w = Math.round(w * k); h = Math.round(h * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
  return { src: c.toDataURL('image/webp', .86), w, h, webp: true };
}
export async function sendFiles(files) {
  if (!S.cur) return;
  for (const f of files) {
    try {
      if (f.type.startsWith('image/')) {
        tmsg('ping', 'готовлю картинку…');
        const { webp, ...im } = await shrink(f);
        const name = webp && !/\.webp$/i.test(f.name) ? (f.name.replace(/\.[^.]+$/, '') || 'image') + '.webp' : f.name;
        await send('image', '', { ...im, name });
      } else {
        if (f.size > MAXF) { tmsg('warn', `«${f.name}» больше 6 МБ — для P2P-чата пока многовато`); continue; }
        tmsg('ping', `отправляю «${f.name}»…`);
        await send('file', '', { name: f.name, size: f.size, mime: f.type, src: await readURL(f) });
      }
    } catch (e) { fail(e); }
  }
}
$('.js-attach').addEventListener('click', () => fileIn.click());
fileIn.addEventListener('change', () => { sendFiles([...fileIn.files]); fileIn.value = ''; });
input.addEventListener('paste', e => { const fs = [...(e.clipboardData && e.clipboardData.files) || []]; if (fs.length) { e.preventDefault(); sendFiles(fs); } });
const chatPane = $('.pane.chat');
chatPane.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files') && S.cur && !form.hidden) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; chatPane.classList.add('drop'); } });
chatPane.addEventListener('dragleave', e => { if (!chatPane.contains(e.relatedTarget)) chatPane.classList.remove('drop'); });
chatPane.addEventListener('drop', e => { e.preventDefault(); chatPane.classList.remove('drop'); if (e.dataTransfer.files.length && S.cur && !form.hidden) sendFiles([...e.dataTransfer.files]); });

/* ---------- клики в логе ---------- */
const lbox = $('.js-lbox');
logsEl.addEventListener('click', e => {
  const t = e.target; if (!(t instanceof Element)) return;
  const a = t.closest('a[data-url]'); if (a) { e.preventDefault(); openUrl(a.dataset.url); return; }
  const sp = t.closest('.spl'); if (sp && !sp.classList.contains('open')) { sp.classList.add('open'); return; }
  const hl = t.closest('[data-code]'); if (hl) { bus.emit('code', hl.dataset.code); return; }
  const me = t.closest('.m[data-id]'), log = t.closest('.log'); if (!me || !log) return;
  const room = log.dataset.chat, id = me.dataset.id;
  const pic = t.closest('img.pic'); if (pic) { openPic(pic.currentSrc || pic.src); return; }
  const fb = t.closest('[data-file]'); if (fb) { const m = findMsg(room, id); if (m) saveMsgFile(room, m); return; }
  const rq = t.closest('.rq[data-jump]'); if (rq) { jump(room, rq.dataset.jump); return; }
  const hf = t.closest('[data-hof]'); if (hf) { openW('hall', { room, id }); return; }
  const rc = t.closest('.rc[data-e]'); if (rc) { react(room, id, rc.dataset.e); return; }
  const ra = t.closest('[data-radd]'); if (ra) { reactPicker(room, id, ra); return; }
  const qr = t.closest('.mact [data-qr]'); if (qr) { react(room, id, qr.dataset.qr); return; }
  const ma = t.closest('.mact [data-ma]');
  if (ma) {
    const m = findMsg(room, id); if (!m) return; const act = ma.dataset.ma;
    if (act === 'react') reactPicker(room, id, ma);
    else if (act === 'reply') startReply(room, m);
    else if (act === 'edit') startEdit(room, m);
    else if (act === 'fwd') forward(room, m, ma);
    else if (act === 'more') { const items = msgItems(me); if (items) openMenu(items, { el: ma }); }
    return;
  }
  const at = t.closest('.at[data-nick]');
  if (at) { const r = S.rooms.get(room), mm = ((r && r.members) || []).find(x => x.nick === at.dataset.nick); if (mm && mm.peer) bus.emit('open-profile', mm.peer); }
});
logsEl.addEventListener('keydown', e => { const sp = e.target.closest && e.target.closest('.spl'); if (sp && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sp.classList.add('open'); } });
lbox.addEventListener('click', () => { lbox.hidden = true; });

/* панелька действий над сообщением под курсором — одна на весь чат */
const mact = document.createElement('span'); mact.className = 'mact'; mact.setAttribute('role', 'toolbar'); mact.setAttribute('aria-label', 'Действия с сообщением');
logsEl.addEventListener('pointerover', e => {
  const m = e.target.closest && e.target.closest('.m[data-id]');
  if (!m || m.classList.contains('sys') || mact.parentElement === m || e.pointerType === 'touch') return;
  const log = m.closest('.log'), msg = log && findMsg(log.dataset.chat, m.dataset.id); if (!msg) return;
  const mine = msg.from === myId();
  const quick = [...new Set([...(prefs.emoRecent || []), ...QUICK])].filter(x => x !== CUP).slice(0, 3);
  const cupT = mine ? 'Кубок за своё не считается' : 'В зал славы · ' + ((S.rooms.get(log.dataset.chat) || {}).kind === 'group' ? 'нужно два кубка' : 'хватит одного кубка');
  mact.innerHTML = quick.map(x => `<button type="button" class="qr" data-qr="${esc(x)}" title="${esc(x)}">${emoImg(x, 'emjq')}</button>`).join('') + `<button type="button" class="qr cup" data-qr="${CUP}" title="${esc(cupT)}" aria-label="В зал славы">${emoImg(CUP, 'emjq')}</button>` + '<i class="msep"></i>' +
    `<button type="button" data-ma="react" title="Реакция" aria-label="Реакция">${ic('smile-plus')}</button><button type="button" data-ma="reply" title="Ответить" aria-label="Ответить">${ic('reply')}</button>` +
    (canEdit(msg, log.dataset.chat) ? `<button type="button" data-ma="edit" title="Редактировать${isSelf(log.dataset.chat) ? '' : ' · ещё ' + Math.ceil((EDIT_MS - Date.now() + msg.ts) / 1000) + ' сек'}" aria-label="Редактировать">${ic('pencil')}</button>` : '') +
    `<button type="button" data-ma="fwd" title="Переслать" aria-label="Переслать">${ic('forward')}</button>` +
    `<button type="button" data-ma="more" title="Ещё" aria-label="Ещё">${ic('ellipsis')}</button>`;
  m.appendChild(mact);
});
logsEl.addEventListener('pointerleave', () => mact.remove());

/* ---------- контекстные меню: сообщение, чат в списке и во вкладках ---------- */
/** чужой «свой» стикер → себе в «Мои» */
async function keepSticker(m) {
  const dt = m.data || {};
  try {
    let src = typeof dt.src === 'string' && dt.src.startsWith('data:image/') ? dt.src : '';
    if (!src && dt.ref) {
      const b = await (await fetch(mediaURL(m.room, m.id))).blob();
      src = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(b); });
    }
    if (!src) throw new Error('стикер ещё не докачался');
    await addSticker(src, dt.n || '', dt.fin);
    tmsg('ok', 'стикер в твоих — смотри в пикере, раздел «Мои»');
  } catch (e) { fail(e); }
}
function msgItems(el) {
  const log = el.closest('.log'); if (!log) return null;
  const room = log.dataset.chat, id = el.dataset.id, m = findMsg(room, id); if (!m) return null;
  const r = S.rooms.get(room), me = m.from === myId(), admin = !!(r && r.kind === 'group' && r.admin);
  const sel = selectionIn(el);
  if (m.kind === 'sys') return [sel ? { icon: 'copy', label: 'Копировать', fn: () => copyText(sel) } : null, { icon: 'eye-off', label: 'Удалить у себя', fn: () => hideMsg(room, id) }];
  const mine = new Set((m.reacts || []).filter(x => x.p.includes(myId())).map(x => x.e)), on = e => react(room, id, e);
  const pic = m.kind === 'image' ? picSrc(m) : '', pinned = pinsOf(room).includes(m.id), fw = (m.data || {}).fwd;
  const quick = [...new Set([...(prefs.emoRecent || []), ...QUICK])].filter(x => x !== CUP).slice(0, 5).concat(CUP);
  return [
    { emojis: quick, active: mine, on, more: () => reactPicker(room, id, el) },
    '-',
    { icon: 'reply', label: 'Ответить', fn: () => startReply(room, m) },
    { icon: 'forward', label: 'Переслать', fn: () => forward(room, m) },
    sel ? { icon: 'copy', label: 'Копировать выделенное', fn: () => copyText(sel) } : null,
    m.text ? { icon: 'copy', label: 'Копировать текст', kbd: sel ? '' : 'Ctrl+C', fn: () => copyText(m.text) } : null,
    canEdit(m, room) ? { icon: 'pencil', label: 'Редактировать', sub: isSelf(room) ? '' : 'ещё ' + Math.ceil((EDIT_MS - Date.now() + m.ts) / 1000) + ' сек', kbd: '↑', fn: () => startEdit(room, m) } : null,
    isSelf(room) ? (fw && fw.room && fw.id && S.rooms.has(fw.room) ? { icon: 'reply', label: 'К оригиналу', sub: 'в «' + roomName(fw.room) + '»', fn: () => openChat(fw.room).then(() => setTimeout(() => jump(fw.room, fw.id), 250)) } : null)
      : { icon: 'bookmark', label: 'В избранное', sub: 'чат с собой', fn: () => toSelf(room, m) },
    r && (r.kind === 'dm' || r.admin) ? { icon: pinned ? 'pin-off' : 'pin', label: pinned ? 'Открепить сообщение' : 'Закрепить сообщение', fn: () => pinMsg(room, m, !pinned) } : null,
    pic ? '-' : null,
    pic ? { icon: 'maximize-2', label: 'Открыть картинку', fn: () => openPic(pic) } : null,
    pic ? { icon: 'download', label: 'Сохранить картинку', fn: () => saveMsgFile(room, m) } : null,
    pic ? { icon: 'images', label: 'Копировать картинку', fn: () => copyPic(pic) } : null,
    pic ? { icon: 'scissors', label: 'Сделать стикер', sub: 'вырезать и обвести', fn: () => bus.emit('stkmake', { src: pic, name: '' }) } : null,
    m.kind === 'sticker' && (m.data || {}).k === 'my' && !me ? { icon: 'star', label: 'В мои стикеры', sub: 'будет в пикере у тебя', fn: () => keepSticker(m) } : null,
    m.kind === 'file' ? { icon: 'download', label: 'Сохранить файл', fn: () => saveMsgFile(room, m) } : null,
    '-',
    !me ? { icon: 'at-sign', label: 'Упомянуть', fn: () => mention(m.from) } : null,
    !me ? { icon: 'user-round', label: 'Профиль', fn: () => bus.emit('open-profile', m.from) } : null,
    '-',
    { icon: 'eye-off', label: 'Удалить у себя', fn: () => hideMsg(room, id) },
    me || admin ? { icon: 'trash-2', label: 'Удалить у всех', danger: true, fn: () => delMsg(room, m) } : null,
  ];
}
onCtx('.log .m[data-id]', el => msgItems(el));

/* ---------- пересылка ---------- */
function forward(room, m, el) {
  const items = sorted().filter(r => r.id !== room && !r.pending && !(r.kind === 'dm' && isBlocked(dmPeer(r)))).slice(0, 12)
    .map(r => ({ img: r.kind === 'dm' ? avaOf(dmPeer(r)) : '', tile: r.kind === 'dm' ? null : r, label: roomName(r), fn: () => doForward(r.id, m) }));
  if (!items.length) { tmsg('warn', 'переслать некуда — других чатов пока нет'); return; }
  openMenu([{ head: 'Переслать в…', sub: 'сообщение уйдёт от тебя с пометкой «переслано»' }, ...items], el ? { el } : {});
}
async function doForward(to, m) {
  const dt = { ...(m.data || {}), fwd: { n: nickOf(m.from) } };
  if (m.data && m.data.ref) { tmsg('warn', 'этот файл ещё не докачался — переслать не выйдет'); return; }
  try { await sendTo(to, m.kind, m.text || '', dt); toast({ icon: 'forward', title: 'Переслано в «' + roomName(to) + '»', dur: 3500, actions: [{ label: 'Открыть', cls: 'gbtn', fn: () => openChat(to, { focus: true }) }] }); }
  catch (e) { fail(e); }
}

/* ---------- закреплённые сообщения: обычные системные сообщения pin:/unpin: — видят все, работает без серверов ---------- */
export function pinsOf(room) {
  const res = []; const st = new Map();
  for (const m of S.msgs.get(room) || []) if (m.kind === 'sys' && /^(un)?pin:/.test(m.text || '')) { const un = m.text.startsWith('un'), id = m.text.slice(un ? 6 : 4); st.set(id, !un); }
  st.forEach((on, id) => { if (on && findMsg(room, id)) res.push(id); });
  return res.reverse();
}
async function pinMsg(room, m, on) {
  try { await sendTo(room, 'sys', (on ? 'pin:' : 'unpin:') + m.id); tmsg('ok', on ? 'сообщение закреплено — видно всем сверху чата' : 'сообщение откреплено'); }
  catch (e) { fail(e); }
}
const pinbar = $('.js-pinbar');
let pinI = 0;
export function renderPinbar() {
  const ids = S.cur ? pinsOf(S.cur) : [];
  if (!ids.length) { pinbar.hidden = true; pinbar.innerHTML = ''; return; }
  pinI = pinI % ids.length; const m = findMsg(S.cur, ids[pinI]);
  const txt = m.kind === 'text' ? plain(m.text) : rpText(m);
  pinbar.hidden = false;
  pinbar.innerHTML = `<span class="pbl" aria-hidden="true">${ids.map((_, i) => `<i${i === pinI ? ' class="on"' : ''}></i>`).join('')}</span><button type="button" class="pbm" data-pin="${esc(m.id)}">${ic('pin')}<span><b>Закреплено${ids.length > 1 ? ` · ${pinI + 1} из ${ids.length}` : ''}</b><span>${emo(esc(nickOf(m.from) + ': ' + txt.slice(0, 140)))}</span></span></button>`;
}
pinbar.addEventListener('click', e => {
  const b = e.target.closest('[data-pin]'); if (!b || !S.cur) return;
  jump(S.cur, b.dataset.pin); const n = pinsOf(S.cur).length; if (n > 1) { pinI = (pinI + 1) % n; renderPinbar(); }
});

/* ---------- Избранное: чат с собой, лежит только у тебя (ядро никому его не отправляет) ---------- */
let selfId = '';
export async function selfRoom() {
  if (selfId && S.rooms.has(selfId)) return selfId;
  for (const r of S.rooms.values()) if (r.kind === 'self') return (selfId = r.id);
  const r = await api('self_open');
  if (r && r.id) { if (!S.rooms.has(r.id)) S.rooms.set(r.id, r); selfId = r.id; renderChats(); }
  return selfId;
}
export async function openSelf() { try { const id = await selfRoom(); if (id) await openChat(id, { focus: true }); } catch (e) { fail(e); } }
async function toSelf(room, m) {
  if (m.data && m.data.ref) { tmsg('warn', 'этот файл ещё не докачался — сохранить не выйдет'); return; }
  try {
    const id = await selfRoom(); if (!id) return;
    await sendTo(id, m.kind, m.text || '', { ...(m.data || {}), fwd: { n: nickOf(m.from), p: m.from, ts: m.ts, room, id: m.id } });
    toast({ icon: 'bookmark', title: 'Сохранено в Избранное', sub: 'это чат с собой — видишь только ты', dur: 3500, actions: [{ label: 'Открыть', cls: 'gbtn', fn: () => openChat(id, { focus: true }) }] });
    bus.emit('fav-saved', m);
  } catch (e) { fail(e); }
}
/** раньше избранное лежало в настройках — один раз переносим в чат с собой */
let moving = false;
async function moveFavs() {
  const old = prefs.favs || [];
  if (moving || prefs.favsMoved || !S.me || !S.link) return;
  if (!old.length) { setPref('favsMoved', true); return; }
  moving = true;
  try {
    const id = await selfRoom(); if (!id) return;
    for (const f of old.slice().reverse()) {
      const dt = { ...(f.data || {}) }, fwd = { n: f.nick || nickOf(f.from), p: f.from, ts: f.ts, room: f.room, id: f.id };
      let kind = f.kind || 'text', text = f.text || '';
      // большие картинки и файлы в старое избранное не влезали — переносим подписью
      if ((kind === 'image' && !dt.src) || (kind === 'file' && !dt.src && !dt.ref)) { text = (kind === 'image' ? '🖼 картинка' : '📎 ' + (dt.name || 'файл')) + (text ? ' · ' + text : ''); kind = 'text'; }
      try { await api('send', { room: id, kind, text, data: kind === 'text' ? { fwd } : { ...dt, fwd } }); } catch (_) {}
    }
    setPref('favsMoved', true); setPref('favs', []);
    toast({ icon: 'bookmark', title: 'Избранное переехало', sub: `теперь это чат с собой · перенёс ${old.length} ${plural(old.length, 'сообщение', 'сообщения', 'сообщений')}`, dur: 6000, actions: [{ label: 'Открыть', cls: 'gbtn', fn: () => openChat(id, { focus: true }) }] });
  } catch (_) {} finally { moving = false; }
}
bus.on('link', () => setTimeout(moveFavs, 2500));
bus.on('me', () => setTimeout(moveFavs, 2500));
async function setMuted(id, on) {
  try {
    const j = await api('room_update', { room: id, muted: on }); if (j && j.id) S.rooms.set(j.id, j);
    renderChats(); if (id === S.cur) header();
    tmsg('ok', on ? 'без звука · непрочитанные всё равно посчитаю' : 'уведомления включены');
  } catch (e) { fail(e); }
}
export function togglePin(id) {
  const cur = (prefs.pinned || []).filter(x => S.rooms.has(x)), has = cur.includes(id);
  if (!has && cur.length >= 6) { tmsg('warn', 'закрепить можно до 6 чатов — открепи какой-нибудь'); return; }
  setPref('pinned', has ? cur.filter(x => x !== id) : [...cur, id]);
  if (has) setPref('tabs', [id, ...(prefs.tabs || []).filter(x => x !== id)]); // откреплённый остаётся вкладкой
  renderWs(true); renderChats();
  tmsg('ok', has ? 'чат откреплён' : 'чат закреплён — он первым в списке и во вкладках');
}
export async function clearRoom(id) {
  const r = S.rooms.get(id); if (!r) return;
  if (!(await ask({ title: `Очистить историю «${roomName(r)}»?`, text: 'Сообщения и файлы удалятся только у тебя — у остальных всё останется, а старое к тебе обратно не докачается.', ok: 'Очистить', danger: true, icon: 'eraser' }))) return;
  try { const res = await api('room_clear', { room: id }); tmsg('ok', `история очищена${res && res.freed ? ' · освобождено ' + size(res.freed) : ''}`); } catch (e) { fail(e); }
}
export async function leaveGroup(id) {
  const r = S.rooms.get(id); if (!r) return;
  if (!(await ask({ title: `Покинуть «${r.name}»?`, text: 'История у тебя удалится. Вернуться можно по инвайту.', ok: 'Покинуть', danger: true, icon: 'log-out' }))) return;
  try { try { await api('send', { room: id, kind: 'sys', text: 'leave' }); } catch (_) {} await api('room_leave', { room: id }); tmsg('ok', `ты вышел из «${r.name}»`); } catch (e) { fail(e); }
}
export function chatItems(id) {
  const r = S.rooms.get(id); if (!r) return null;
  const pin = isPinned(id);
  const common = [
    { icon: pin ? 'pin-off' : 'pin', label: pin ? 'Открепить чат' : 'Закрепить чат', fn: () => togglePin(id) },
    { icon: r.muted ? 'bell' : 'bell-off', label: r.muted ? 'Включить уведомления' : 'Без звука', fn: () => setMuted(id, !r.muted) },
  ];
  if (r.kind === 'dm') {
    const p = dmPeer(r), f = S.friends.get(p), fr = !!(f && f.state === 'friend'), bl = isBlocked(p);
    return [
      { head: nickOf(p), sub: bl ? 'заблокирован' : isOnline(p) ? 'в сети' : 'не в сети', img: avaOf(p) },
      S.cur !== id ? { icon: 'message-circle', label: 'Открыть чат', fn: () => openChat(id, { focus: true }) } : null,
      { icon: 'user-round', label: 'Профиль', fn: () => bus.emit('open-profile', p) },
      { icon: 'phone', label: 'Позвонить', disabled: !fr || bl, fn: async () => { await openChat(id); bus.emit('call', id); } },
      { icon: 'film', label: 'Клипы и скрины', fn: () => openW('media', { room: id }) },
      '-', ...common, '-',
      { icon: 'at-sign', label: 'Копировать ник', fn: () => copyText('@' + nickOf(p)).then(() => tmsg('ok', 'ник скопирован')) },
      { icon: 'copy', label: 'Копировать ID', fn: () => copyText(p).then(() => tmsg('ok', 'ID скопирован')) },
      '-',
      { icon: 'eraser', label: 'Очистить историю', danger: true, fn: () => clearRoom(id) },
      fr ? { icon: 'user-x', label: 'Удалить из друзей', danger: true, fn: () => bus.emit('unfriend', p) } : null,
      { icon: 'ban', label: bl ? 'Разблокировать' : 'Заблокировать', danger: !bl, fn: () => bus.emit(bl ? 'unblock' : 'block', p) },
    ];
  }
  if (r.kind === 'self') return [
    { head: 'Избранное', sub: 'чат с собой · видишь только ты' },
    S.cur !== id ? { icon: 'message-circle', label: 'Открыть', fn: () => openChat(id, { focus: true }) } : null,
    { icon: pin ? 'pin-off' : 'pin', label: pin ? 'Открепить чат' : 'Закрепить чат', fn: () => togglePin(id) },
    { icon: 'film', label: 'Клипы и скрины', fn: () => openW('media', { room: id }) },
    '-',
    { icon: 'eraser', label: 'Очистить избранное', danger: true, fn: () => clearRoom(id) },
  ];
  const n = (r.members || []).length;
  return [
    { head: r.name || 'группа', sub: r.pending ? 'ищу участников…' : `${n} ${plural(n, 'участник', 'участника', 'участников')}` },
    S.cur !== id ? { icon: 'message-circle', label: 'Открыть чат', fn: () => openChat(id, { focus: true }) } : null,
    r.voice && !r.pending ? { icon: 'mic', label: 'Зайти в голос', fn: () => bus.emit('voice-join', id) } : null,
    (r.invite === 'all' || r.admin) && !r.pending ? { icon: 'user-round-plus', label: 'Пригласить', fn: () => openW('gset', { room: id, tab: 'invite' }) } : null,
    { icon: 'settings', label: 'Настройки группы', fn: () => openW('gset', { room: id }) },
    { icon: 'film', label: 'Клипы и скрины', fn: () => openW('media', { room: id }) },
    '-', ...common, '-',
    { icon: 'eraser', label: 'Очистить историю', danger: true, fn: () => clearRoom(id) },
    { icon: 'log-out', label: 'Покинуть группу', danger: true, fn: () => leaveGroup(id) },
  ];
}
onCtx('.js-chats [data-chat], .js-pgroups [data-chat]', el => chatItems(el.dataset.chat));
onCtx('.pane.chat .ph', () => S.cur ? chatItems(S.cur) : null);

/* ---------- «печатает…» ---------- */
export function renderTyping() {
  const us = S.cur ? typers(S.cur).filter(u => !isBlocked(u)) : [];
  const r = S.rooms.get(S.cur);
  if (r && r.kind === 'dm') header();
  if (!us.length) { typEl.classList.remove('on'); return; }
  const names = us.map(u => `<b style="--c:${colorOf(u)}">${esc(nickOf(u))}</b>`);
  const txt = us.length === 1 ? names[0] + ' печатает' : us.length === 2 ? names.join(' и ') + ' печатают' : 'несколько человек печатают';
  typEl.innerHTML = `<span class="theads">${us.slice(0, 3).map(u => `<img alt="" src="${avaOf(u)}" width="18" height="18">`).join('')}</span><span class="tt">${txt}</span><span class="pix" style="--c:${colorOf(us[0])}" aria-hidden="true"><i></i><i></i><i></i></span>`;
  typEl.classList.add('on');
}
setInterval(() => { if (S.cur && typEl.classList.contains('on')) { renderTyping(); } }, 2000);

/* ---------- пиксельные искры из-под каретки (как в прототипе) ---------- */
const spk = $('.js-sparks'), sctx = spk.getContext('2d'), meas = document.createElement('canvas').getContext('2d'); let parts = [], sraf = 0;
function caretXY() {
  const cs = getComputedStyle(input); meas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const s = input.value.slice(0, input.selectionStart || 0), ln = s.slice(s.lastIndexOf('\n') + 1), row = (s.match(/\n/g) || []).length;
  const ir = input.getBoundingClientRect(), cr = spk.getBoundingClientRect(), lh = parseFloat(cs.lineHeight) || 20;
  return [ir.left - cr.left + parseFloat(cs.paddingLeft) + Math.min(input.clientWidth - 4, meas.measureText(ln).width), ir.top - cr.top + parseFloat(cs.paddingTop) + Math.min(row * lh, input.clientHeight - lh) + lh / 2 - (row ? input.scrollTop : 0)];
}
input.addEventListener('keydown', e => {
  if (reduce || prefs.lite || e.key.length !== 1 || e.ctrlKey || e.metaKey) return;
  requestAnimationFrame(() => {
    const r = spk.getBoundingClientRect(), d = devicePixelRatio || 1; if (!r.width) return;
    if (spk.width !== Math.round(r.width * d)) { spk.width = Math.round(r.width * d); spk.height = Math.round(r.height * d); }
    const [cx, cy] = caretXY(), x = cx * d, y = cy * d; const col = getComputedStyle(R).getPropertyValue('--ok').trim() || '#7ee2b8';
    for (let i = 0; i < 3; i++) parts.push({ x, y, vx: (Math.random() - .5) * 1.6 * d, vy: -(1.3 + Math.random() * 1.8) * d, s: (2 + Math.round(Math.random() * 2)) * d, l: 1, c: i ? '#ffffff' : col });
    if (parts.length > 120) parts.splice(0, parts.length - 120);
    if (!sraf) sraf = requestAnimationFrame(sloop);
  });
});
function sloop() { sraf = 0; sctx.clearRect(0, 0, spk.width, spk.height); parts = parts.filter(p => p.l > 0); for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += .09 * (devicePixelRatio || 1); p.l -= .035; sctx.globalAlpha = Math.max(0, p.l); sctx.fillStyle = p.c; sctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s); } sctx.globalAlpha = 1; if (parts.length) sraf = requestAnimationFrame(sloop); }

/* ---------- реакция на события ---------- */
bus.on('msg', async (room, m) => {
  const r = S.rooms.get(room);
  if (room === S.cur && m.kind === 'sys' && /^(un)?pin:/.test(m.text || '')) setTimeout(renderPinbar);
  if (room === S.cur) { appendMsg(room, m); if (document.hasFocus() && !document.hidden) markRead(room); }
  renderChats(); if (room === S.cur) renderTyping();
  if (m.from === myId() || m.kind === 'sys' || isBlocked(m.from)) return;
  const ment = mentionsMe(m), seeing = room === S.cur && document.hasFocus() && !document.hidden;
  if (seeing) { sfx('msg', .45); return; }
  if (r && r.muted && !ment) return;
  if (r && r.kind === 'group' && prefs.mentionsOnly && !ment) return;
  notify({ tone: ment ? 'mention' : 'msg', say: `${nickOf(m.from)} ${ment ? 'зовёт тебя' : 'пишет'}${r && r.kind === 'group' ? ' в ' + r.name : ''}` });
  if (!document.hidden) {
    const what = m.kind === 'text' ? plain(m.text).slice(0, 90) : m.kind === 'sticker' ? 'стикер' : m.kind === 'image' ? '🖼 картинка' : '📎 файл';
    toast({ ava: avaOf(m.from), icon: ment ? 'at-sign' : 'message-circle', title: nickOf(m.from) + (r && r.kind === 'group' ? ' · ' + r.name : ''), sub: what, dur: 5000, cls: 'msgt', actions: [{ label: 'Открыть', cls: 'gbtn', fn: () => openChat(room, { focus: true }) }] });
  }
});
bus.on('msgs', (room, add) => { if (room === S.cur && add.length) { const l = logs.get(room); renderLog(room, l && !atBottom(l) ? 'top' : ''); markRead(room); renderPinbar(); } renderChats(); });
bus.on('typing', room => { if (room === S.cur) renderTyping(); renderChats(); });
bus.on('voice', room => { renderChats(); if (room === S.cur) header(); });
addEventListener('focus', () => { if (S.cur) markRead(S.cur); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.cur) markRead(S.cur); });
bus.on('room_removed', room => { const l = logs.get(room); if (l) { l.remove(); logs.delete(room); } if (S.cur === room) { const n = sorted()[0]; n ? openChat(n.id) : showEmpty(); } renderChats(); });
bus.on('room', (r, old, v) => {
  if (v && v.cleared) { const l = logs.get(r.id); if (l) { l.remove(); logs.delete(r.id); } if (S.cur === r.id) { openChat(r.id); return; } }
  renderChats(); if (r.id === S.cur) header();
});
bus.on('profile', () => { renderLists(); header(); });
