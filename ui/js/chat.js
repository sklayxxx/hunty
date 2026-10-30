// Чаты: список, шапка, сообщения, ввод, стикеры, файлы, «печатает…»
import { $, $$, R, esc, ic, hm, when, dayLabel, size, plural, reduce, mobile, prefs, setPref, bus, short } from './core.js';
import { api, openUrl, saveFile } from './api.js';
import { S, myId, myNick, nickOf, avaOf, colorOf, isOnline, dmPeer, roomName, voiceCount, voiceIn, typers, pushLocal, isFriend } from './state.js';
import { EMO, EMN } from './stickers.js';
import { app, tmsg, tone, TONES, toast, openW, fail, notify, winOpen } from './ui.js';
import { mobURL, MOBKEYS } from './mobs.js';

const chatsEl = $('.js-chats'), friendsEl = $('.js-friends'), logsEl = $('.js-logs'), typEl = $('.js-typing'), nochat = $('.js-nochat');
const chead = $('.js-chead'), cmeta = $('.js-cmeta'), hbtns = $('.js-hbtns');
const form = $('.js-form'), input = $('.js-input'), stk = $('.js-stk'), fileIn = $('.js-file');
let tab = 'chats', Q = '';
const logs = new Map();

/* ---------- мелкие шаблоны ---------- */
export const tileHTML = r => `<span class="tile" style="--tc:${esc(r.color || '#7ee2b8')}">${esc(((r.name || '?').trim()[0] || '?').toUpperCase())}</span>`;
export function pdHTML(peer) {
  const f = S.friends.get(peer), st = f && f.profile && f.profile.status;
  if (!isOnline(peer)) return '<i class="pd" aria-hidden="true"></i>';
  const c = st === 'away' ? ' away' : st === 'dnd' ? ' dnd' : ' on';
  return `<i class="pd${c}" aria-hidden="true"></i>`;
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
  const pre = me ? '<b>ты:</b> ' : r.kind === 'dm' ? '' : `<b>${esc(nickOf(l.from))}:</b> `;
  const body = l.kind === 'sticker' ? 'стикер' : l.kind === 'image' ? '🖼 картинка' : l.kind === 'file' ? '📎 ' + esc((l.data && l.data.name) || 'файл') : esc(l.text);
  return pre + body;
}
export const sorted = () => [...S.rooms.values()].sort((a, b) => ((b.last && b.last.ts) || b.created || 0) - ((a.last && a.last.ts) || a.created || 0));

/* ---------- список чатов ---------- */
export function renderChats() {
  const q = Q.trim().toLowerCase();
  const rs = sorted().filter(r => !q || roomName(r).toLowerCase().includes(q) || ((r.last && r.last.text) || '').toLowerCase().includes(q));
  const html = rs.length ? rs.map(r => {
    const vc = voiceCount(r.id);
    const badge = r.unread && r.id !== S.cur ? `<span class="ub${r.muted ? ' mute' : ''}">${r.unread > 99 ? '99+' : r.unread}</span>` : vc ? `<span class="vc" title="в голосе">${ic('mic')}${vc}</span>` : '';
    const on = r.id === S.cur;
    return `<button class="ci${on ? ' on' : ''}" data-chat="${esc(r.id)}" role="listitem"${on ? ' aria-current="true"' : ''}>${avHTML(r)}<span class="nm">${esc(roomName(r))}${r.muted ? ic('bell-off') : ''}</span><time>${when((r.last && r.last.ts) || r.created)}</time><span class="lm">${lastPreview(r)}</span>${badge}</button>`;
  }).join('') : q ? '<div class="empty">ничего не нашлось</div>' : `<div class="empty">чатов пока нет<br><button class="pbtn wide" data-win="friend">${ic('user-round-plus')}Добавить друга</button><button class="pbtn wide" data-win="join">${ic('link')}Вступить по инвайту</button></div>`;
  // одинаковый HTML не перерисовываем: иначе клик, попавший между mousedown и mouseup, теряется
  if (html !== chatsEl._h) { chatsEl.innerHTML = html; chatsEl._h = html; }
  renderWs();
}
function friendRow(f) {
  const p = f.profile || {}, vr = Object.keys(S.voices).find(k => voiceIn(k)[f.peer]);
  const right = vr ? `<span class="vc" title="в голосе">${ic('mic')}</span>` : '';
  const line = isOnline(f.peer) ? (p.line || (f.via === 'relay' ? 'в сети · через ретранслятор' : f.via === 'lan' ? 'в сети · в локалке' : 'в сети')) : (p.line || 'не в сети');
  return `<button class="ci" data-prof="${esc(f.peer)}" role="listitem"><span class="avw"><img class="ava" alt="" src="${avaOf(f.peer)}">${pdHTML(f.peer)}</span><span class="nm">${esc(p.nick || short(f.peer))}</span><time>${isOnline(f.peer) && f.rtt != null ? f.rtt + 'ms' : ''}</time><span class="lm">${esc(line)}</span>${right}</button>`;
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
  const on = fr.filter(f => isOnline(f.peer)).sort((a, b) => (a.profile.nick || '').localeCompare(b.profile.nick || '')), off = fr.filter(f => !isOnline(f.peer));
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

/* ---------- вкладки сверху и окна tmux ---------- */
function wsRooms() {
  const pin = (prefs.pinned || []).filter(id => S.rooms.has(id));
  const rest = sorted().map(r => r.id).filter(id => !pin.includes(id));
  const list = [...pin, ...rest].slice(0, 4);
  if (S.cur && S.rooms.has(S.cur) && !list.includes(S.cur)) list[list.length ? list.length - 1 : 0] = S.cur;
  return list;
}
export function renderWs() {
  const nav = $('.js-nav'), plus = $('.ws.plus', nav);
  $$('.ws[data-chat]', nav).forEach(b => b.remove());
  const ids = wsRooms();
  ids.forEach((id, i) => {
    const r = S.rooms.get(id), b = document.createElement('button');
    b.className = 'ws'; b.dataset.chat = id; b.type = 'button';
    if (id === S.cur) b.setAttribute('aria-current', 'page');
    b.title = roomName(r) + ' · Alt+' + (i + 1);
    b.innerHTML = `<b>${i + 1}</b>${esc((r.kind === 'dm' ? 'лс·' : '') + roomName(r))}${r.unread && id !== S.cur ? '<span class="badge" role="img" aria-label="есть новые"></span>' : ''}`;
    nav.insertBefore(b, plus);
  });
  $('.js-twins').innerHTML = ids.map((id, i) => { const r = S.rooms.get(id); return `<span class="win${id === S.cur ? ' on' : ''}" data-chat="${esc(id)}">${i}:${esc((r.kind === 'dm' ? 'лс-' : '') + roomName(r))}${id === S.cur ? '*' : ''}</span>`; }).join('');
}
// переход в чат: строка списка, вкладка сверху, окно в tmux-строке
document.addEventListener('click', e => {
  const t = e.target; if (!(t instanceof Element)) return;
  const c = t.closest('.js-chats [data-chat], .js-nav .ws[data-chat], .js-twins [data-chat]'); if (!c) return;
  e.preventDefault(); openChat(c.dataset.chat, { focus: true });
});
document.addEventListener('keydown', e => {
  if (e.altKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) { const id = wsRooms()[+e.code.slice(5) - 1]; if (id) { e.preventDefault(); openChat(id, { focus: true }); } }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); setTab('chats'); $('.js-search').focus(); }
});

/* ---------- шапка чата ---------- */
export function header() {
  const r = S.rooms.get(S.cur);
  if (!r) { chead.innerHTML = '<span class="pt">Hunty</span>'; cmeta.textContent = 'серверов: 0'; hbtns.innerHTML = ''; return; }
  if (r.kind === 'dm') {
    const p = dmPeer(r), f = S.friends.get(p) || {}, o = S.online.get(p), ty = typers(r.id).length;
    chead.innerHTML = `<img class="ava" alt="" src="${avaOf(p)}" data-prof="${esc(p)}"><span class="pt" data-prof="${esc(p)}">${esc(nickOf(p))}</span>`;
    cmeta.classList.toggle('ty', ty > 0);
    cmeta.textContent = ty ? 'печатает…' : o ? `в сети · ${o.via === 'relay' ? 'через ретранслятор' : o.via === 'lan' ? 'в локалке' : 'напрямую'}${o.rtt != null ? ' · ' + o.rtt + 'ms' : ''}` : ((f.profile && f.profile.line) || 'не в сети · сообщения дойдут, когда появится');
    const inCall = S.myVoice && S.myVoice[0] === r.id;
    hbtns.innerHTML = inCall ? `<button class="ib hang" data-act="hang" title="Положить трубку" aria-label="Положить трубку">${ic('phone-off')}</button>` : `<button class="ib" data-act="call" title="Позвонить" aria-label="Позвонить">${ic('phone')}</button>`;
    hbtns.innerHTML += `<button class="ib" data-prof="${esc(p)}" title="Профиль" aria-label="Профиль">${ic('user-round')}</button>`;
    input.placeholder = 'Написать @' + nickOf(p);
  } else {
    cmeta.classList.remove('ty');
    const ms = r.members || [], on = ms.filter(m => m.online).length, vc = voiceCount(r.id);
    chead.innerHTML = tileHTML(r) + `<span class="pt">${esc(r.name)}</span>`;
    cmeta.textContent = r.pending ? 'ищу участников в сети…' : `${ms.length} ${plural(ms.length, 'участник', 'участника', 'участников')} · в сети ${on}` + (vc ? ` · в голосе ${vc}` : '');
    hbtns.innerHTML = (r.voice ? `<button class="ib" data-act="voice" title="Голосовой канал" aria-label="Голосовой канал">${ic('mic')}</button>` : '') +
      ((r.invite === 'all' || r.admin) ? `<button class="ib" data-act="invite" title="Пригласить" aria-label="Пригласить">${ic('user-round-plus')}</button>` : '') +
      `<button class="ib" data-act="gset" title="Настройки группы" aria-label="Настройки группы">${ic('settings')}</button>`;
    input.placeholder = 'Написать в #' + r.name;
  }
}
hbtns.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'call') bus.emit('call', S.cur);
  else if (a === 'hang') bus.emit('hang');
  else if (a === 'voice') bus.emit('voice-join', S.cur);
  else if (a === 'invite') openW('gset', { room: S.cur, tab: 'invite' });
  else if (a === 'gset') openW('gset', { room: S.cur });
});

/* ---------- сообщения ---------- */
const URLRE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;
function fmt(t) {
  const me = myNick();
  let h = esc(t);
  h = h.replace(URLRE, u => `<a class="lnk" href="${u}" data-url="${u}">${u.length > 64 ? u.slice(0, 60) + '…' : u}</a>`);
  h = h.replace(/(^|[\s(])@([a-z0-9_.-]{2,16})/gi, (m, pre, n) => n.toLowerCase() === me ? `${pre}<mark class="me">@${n}</mark>` : `${pre}<span class="at">@${n}</span>`);
  h = h.replace(/hunty:\/\/(add|join)\/[A-Za-z0-9_-]+/g, c => `<button class="hlink" type="button" data-code="${c}">${ic(c.includes('/join/') ? 'users' : 'user-round-plus')}${c.includes('/join/') ? 'вступить в группу' : 'добавить в друзья'}</button>`);
  return h;
}
export const mentionsMe = m => m && m.kind === 'text' && new RegExp('(^|[\\s(])@' + myNick().replace(/[.]/g, '\\.') + '\\b', 'i').test(m.text || '');
function msgEl(m) {
  const d = document.createElement('div'); d.dataset.id = m.id; d.dataset.ts = m.ts;
  const t = `<time title="${new Date(m.ts).toLocaleString('ru-RU')}">${hm(new Date(m.ts))}</time>`;
  if (m.kind === 'sys') {
    d.className = 'm sys';
    d.innerHTML = `<span class="mav">${ic(m.text.startsWith('call') || m.text === 'missed' ? 'phone' : 'arrow-right')}</span><span class="who" aria-hidden="true"></span><span class="tx">${esc(sysText(m))}</span>${t}`;
    return d;
  }
  const me = m.from === myId(), u = m.from, dt = m.data || {};
  d.className = 'm' + (m.kind === 'sticker' ? ' stkm' : '') + (mentionsMe(m) ? ' ment' : '');
  d.dataset.u = u; d.style.setProperty('--c', colorOf(u));
  let body;
  if (m.kind === 'sticker') body = `<img class="stkimg" alt="стикер: ${esc(EMN[dt.k] || '')}" src="${EMO[dt.k] || EMO.fire}">`;
  else if (m.kind === 'image' && typeof dt.src === 'string' && dt.src.startsWith('data:image/')) body = `<img class="pic" alt="${esc(dt.name || 'картинка')}" src="${dt.src}"${dt.w ? ` width="${Math.min(320, dt.w)}"` : ''} loading="lazy">` + (m.text ? `<span class="cap">${fmt(m.text)}</span>` : '');
  else if (m.kind === 'file') body = `<button class="file" type="button" data-file="${esc(m.id)}">${ic('file')}${esc(dt.name || 'файл')} <small class="dim">${esc(size(dt.size || 0))}</small>${ic('download')}</button>` + (m.text ? `<span class="cap">${fmt(m.text)}</span>` : '');
  else body = fmt(m.text || '');
  d.innerHTML = `<span class="mav" data-u="${esc(u)}"${me ? ' data-me="1"' : ''}><img class="ava" alt="" src="${avaOf(u)}"></span><span class="who" data-u="${esc(u)}"${me ? ' data-me="1"' : ''}>${me ? `<span class="nk">${esc(nickOf(u))}</span>` : esc(nickOf(u))}</span><span class="tx">${body}</span>${t}`;
  return d;
}
function grp(d) {
  const p = d.previousElementSibling;
  d.classList.remove('cont');
  if (!p || !d.dataset.u || !p.classList.contains('m') || p.classList.contains('sys') || p.dataset.u !== d.dataset.u) return;
  if (Math.abs((+d.dataset.ts || 0) - (+p.dataset.ts || 0)) < 5 * 60000) d.classList.add('cont');
}
function daySep(ts) { const s = document.createElement('div'); s.className = 'dsep'; s.dataset.day = new Date(ts).toDateString(); s.innerHTML = `<span>${esc(dayLabel(ts))}</span>`; return s; }
function logOf(room) {
  let l = logs.get(room);
  if (!l) {
    l = document.createElement('div'); l.className = 'log'; l.dataset.chat = room; l.setAttribute('role', 'log'); l.hidden = true;
    logsEl.appendChild(l); logs.set(room, l);
    l.addEventListener('scroll', () => { if (l.scrollTop < 60) loadOlder(room); });
  }
  return l;
}
const atBottom = l => l.scrollHeight - l.scrollTop - l.clientHeight < 80;
export const toBottom = l => { if (l) l.scrollTop = l.scrollHeight; };
function motd(r) {
  const d = document.createElement('div'); d.className = 'motd';
  if (r.kind === 'dm') { const p = dmPeer(r); d.innerHTML = `${ic('lock')}<span><b>${esc(nickOf(p))}</b> — личка напрямую, без серверов. Сообщения подписаны и шифруются, история хранится только у вас двоих.</span>`; }
  else d.innerHTML = `${ic('users')}<span><b>${esc(r.name)}</b> — история хранится у всех участников и докачивается, когда кто-то из них в сети. Серверов: 0.</span>`;
  return d;
}
function renderLog(room, keep) {
  const r = S.rooms.get(room), l = logOf(room), arr = S.msgs.get(room) || [];
  const was = l.scrollHeight - l.scrollTop;
  l.innerHTML = '';
  if (r && (S.full.has(room) || arr.length < 40)) l.appendChild(motd(r));
  let day = '', unreadAt = null;
  const rt = r ? r.read_ts || 0 : 0;
  for (const m of arr) {
    const dd = new Date(m.ts).toDateString();
    if (dd !== day) { day = dd; l.appendChild(daySep(m.ts)); }
    if (!unreadAt && r && r._openUnread && m.ts > rt && m.from !== myId() && m.kind !== 'sys') { unreadAt = m; const nd = document.createElement('div'); nd.className = 'newdiv'; nd.innerHTML = `<span>новые · ${r._openUnread}</span>`; l.appendChild(nd); }
    const e = msgEl(m); l.appendChild(e); grp(e);
  }
  if (keep === 'top') l.scrollTop = l.scrollHeight - was; else toBottom(l);
}
function appendMsg(room, m) {
  const l = logs.get(room); if (!l) return;
  if ($(`[data-id="${CSS.escape(m.id)}"]`, l)) return;
  const arr = S.msgs.get(room) || [];
  const last = arr[arr.length - 1];
  if (last && last.id !== m.id) { renderLog(room, atBottom(l) ? '' : 'top'); return; } // пришло не по порядку
  const bottom = atBottom(l) || m.from === myId();
  const prev = $$('.m', l).pop();
  if (!prev || new Date(+prev.dataset.ts).toDateString() !== new Date(m.ts).toDateString()) l.appendChild(daySep(m.ts));
  const e = msgEl(m); l.appendChild(e); grp(e);
  if (!reduce && m.from !== myId() && m.kind === 'text') { e.classList.add('fresh'); setTimeout(() => e.classList.remove('fresh'), 900); }
  if (bottom) toBottom(l);
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
    if (old.length) renderLog(room, 'top');
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
  nochat.hidden = true;
  logs.forEach((l, k) => { l.hidden = k !== id; });
  const l = logOf(id); l.hidden = false;
  r._openUnread = r.unread || 0;
  header(); renderChats(); renderTyping();
  try { await ensureMsgs(id); } catch (e) { fail(e); }
  if (S.cur !== id) return;
  renderLog(id);
  r._openUnread = 0;
  markRead(id);
  form.hidden = false;
  if (focus && !mobile()) input.focus({ preventScroll: true });
  bus.emit('open', id, prev);
}
export function showEmpty() {
  S.cur = ''; logs.forEach(l => { l.hidden = true; }); nochat.hidden = false; header(); renderChats();
  const m = $('.js-ncmob'); if (m && !m.firstChild) m.innerHTML = `<img alt="" src="${mobURL(MOBKEYS[Math.floor(Math.random() * MOBKEYS.length)])}" width="56" height="56">`;
}

/* ---------- ввод и отправка ---------- */
async function send(kind, text, data) {
  const room = S.cur; if (!room) return;
  try {
    const m = await api('send', { room, kind, text, data });
    pushLocal(m);
    sendTyping(false);
  } catch (e) { fail(e); }
}
form.addEventListener('submit', e => {
  e.preventDefault();
  const v = input.value.trim(); if (!v || !S.cur) return;
  input.value = ''; send('text', v);
});
let tyT = 0, tySent = 0;
function sendTyping(on = true) {
  if (!S.cur) return;
  const r = S.rooms.get(S.cur); if (!r || r.pending) return;
  if (on && Date.now() - tySent < 3000) return;
  if (!on && !tySent) return;
  tySent = on ? Date.now() : 0;
  api('ev', { room: S.cur, kind: 'typing', data: { on } }).catch(() => {});
}
input.addEventListener('input', () => { if (input.value.trim()) { sendTyping(true); clearTimeout(tyT); tyT = setTimeout(() => sendTyping(false), 5000); } });
input.addEventListener('keydown', e => {
  if (e.key === 'Tab' && !e.shiftKey) { // @ник — дополнение по Tab
    const m = /@([a-z0-9_.-]*)$/i.exec(input.value.slice(0, input.selectionStart));
    if (m) {
      const r = S.rooms.get(S.cur); const cands = ((r && r.members) || []).map(x => x.nick).filter(n => n && n.startsWith(m[1].toLowerCase()) && n !== myNick());
      if (cands.length) { e.preventDefault(); const s = input.selectionStart; input.value = input.value.slice(0, s - m[1].length) + cands[0] + ' ' + input.value.slice(s); }
    }
  }
});

/* ---------- стикеры ---------- */
$('.js-stkg').innerHTML = Object.keys(EMO).map(k => `<button type="button" data-stk="${k}" title="${esc(EMN[k] || k)}"><img alt="${esc(EMN[k] || k)}" src="${EMO[k]}"></button>`).join('');
export function stkToggle(on) { stk.hidden = on === undefined ? !stk.hidden : !on; $('.js-emo').setAttribute('aria-expanded', String(!stk.hidden)); }
$('.js-emo').addEventListener('click', e => { e.stopPropagation(); stkToggle(); });
stk.addEventListener('click', e => { const b = e.target.closest('[data-stk]'); if (!b) return; stkToggle(false); send('sticker', '', { k: b.dataset.stk }); tone([[784, .04], [1046, .06]], .6); });
document.addEventListener('click', e => { if (!stk.hidden && !e.target.closest('.js-stk,.js-emo')) stkToggle(false); });

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
  return { src: c.toDataURL('image/webp', .86), w, h };
}
export async function sendFiles(files) {
  if (!S.cur) return;
  for (const f of files) {
    try {
      if (f.type.startsWith('image/')) { tmsg('ping', 'готовлю картинку…'); const im = await shrink(f); await send('image', '', { ...im, name: f.name }); }
      else {
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
chatPane.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); chatPane.classList.add('drop'); } });
chatPane.addEventListener('dragleave', e => { if (!chatPane.contains(e.relatedTarget)) chatPane.classList.remove('drop'); });
chatPane.addEventListener('drop', e => { e.preventDefault(); chatPane.classList.remove('drop'); if (e.dataTransfer.files.length) sendFiles([...e.dataTransfer.files]); });

/* ---------- клики в логе ---------- */
const lbox = $('.js-lbox');
logsEl.addEventListener('click', e => {
  const a = e.target.closest('a[data-url]'); if (a) { e.preventDefault(); openUrl(a.dataset.url); return; }
  const pic = e.target.closest('img.pic'); if (pic) { $('img', lbox).src = pic.src; lbox.hidden = false; return; }
  const fb = e.target.closest('[data-file]');
  if (fb) { const m = (S.msgs.get(S.cur) || []).find(x => x.id === fb.dataset.file); if (m && m.data && m.data.src) saveFile(m.data.name || 'file', m.data.src).then(p => tmsg('ok', 'сохранил: ' + p), fail); return; }
  const hl = e.target.closest('[data-code]'); if (hl) { bus.emit('code', hl.dataset.code); return; }
});
lbox.addEventListener('click', () => { lbox.hidden = true; });

/* ---------- «печатает…» ---------- */
export function renderTyping() {
  const us = S.cur ? typers(S.cur) : [];
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
function caretX() { const cs = getComputedStyle(input); meas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; const s = input.value.slice(0, input.selectionStart || 0); const ir = input.getBoundingClientRect(), cr = spk.getBoundingClientRect(); return ir.left - cr.left + parseFloat(cs.paddingLeft) + Math.min(input.clientWidth - 4, meas.measureText(s).width - input.scrollLeft); }
input.addEventListener('keydown', e => {
  if (reduce || e.key.length !== 1 || e.ctrlKey || e.metaKey) return;
  requestAnimationFrame(() => {
    const r = spk.getBoundingClientRect(), d = devicePixelRatio || 1; if (!r.width) return;
    if (spk.width !== Math.round(r.width * d)) { spk.width = Math.round(r.width * d); spk.height = Math.round(r.height * d); }
    const ir = input.getBoundingClientRect(), x = caretX() * d, y = (ir.top - r.top + ir.height * .5) * d; const col = getComputedStyle(R).getPropertyValue('--ok').trim() || '#7ee2b8';
    for (let i = 0; i < 3; i++) parts.push({ x, y, vx: (Math.random() - .5) * 1.6 * d, vy: -(1.3 + Math.random() * 1.8) * d, s: (2 + Math.round(Math.random() * 2)) * d, l: 1, c: i ? '#ffffff' : col });
    if (!sraf) sraf = requestAnimationFrame(sloop);
  });
});
function sloop() { sraf = 0; sctx.clearRect(0, 0, spk.width, spk.height); parts = parts.filter(p => p.l > 0); for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += .09 * (devicePixelRatio || 1); p.l -= .035; sctx.globalAlpha = Math.max(0, p.l); sctx.fillStyle = p.c; sctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s); } sctx.globalAlpha = 1; if (parts.length) sraf = requestAnimationFrame(sloop); }

/* ---------- реакция на события ---------- */
bus.on('msg', async (room, m) => {
  const r = S.rooms.get(room);
  if (room === S.cur) { appendMsg(room, m); if (document.hasFocus() && !document.hidden) markRead(room); }
  renderChats(); if (room === S.cur) renderTyping();
  if (m.from === myId() || m.kind === 'sys') return;
  const ment = mentionsMe(m), seeing = room === S.cur && document.hasFocus() && !document.hidden;
  if (seeing) { tone(TONES.msg, .45); return; }
  if (r && r.muted && !ment) return;
  if (r && r.kind === 'group' && prefs.mentionsOnly && !ment) return;
  notify({ tone: ment ? 'mention' : 'msg', say: `${nickOf(m.from)} ${ment ? 'зовёт тебя' : 'пишет'}${r && r.kind === 'group' ? ' в ' + r.name : ''}` });
  if (!document.hidden) tmsg('ok', `${nickOf(m.from)}${r && r.kind === 'group' ? ' → ' + r.name : ''}: ${m.kind === 'text' ? m.text.slice(0, 80) : m.kind === 'sticker' ? 'стикер' : m.kind === 'image' ? 'картинка' : 'файл'}`);
});
bus.on('msgs', (room, add) => { if (room === S.cur && add.length) { const l = logs.get(room); renderLog(room, l && !atBottom(l) ? 'top' : ''); markRead(room); } renderChats(); });
bus.on('typing', room => { if (room === S.cur) renderTyping(); renderChats(); });
bus.on('voice', room => { renderChats(); if (room === S.cur) header(); });
addEventListener('focus', () => { if (S.cur) markRead(S.cur); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.cur) markRead(S.cur); });
bus.on('room_removed', room => { const l = logs.get(room); if (l) { l.remove(); logs.delete(room); } if (S.cur === room) { const n = sorted()[0]; n ? openChat(n.id) : showEmpty(); } renderChats(); });
bus.on('profile', () => { renderLists(); header(); });
