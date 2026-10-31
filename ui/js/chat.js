// Чаты: список, шапка, сообщения (ответы, реакции, правки, удаление, разметка), ввод, стикеры, файлы, «печатает…», меню
import { $, $$, R, esc, ic, hm, when, dayLabel, size, plural, reduce, mobile, prefs, setPref, bus, short } from './core.js';
import { api, openUrl, saveFile, mediaURL, saveMedia, reveal, inTauri } from './api.js';
import { S, myId, myNick, nickOf, avaOf, colorOf, isOnline, dmPeer, roomName, voiceCount, voiceIn, typers, pushLocal, isFriend, isBlocked } from './state.js';
import { EMO, EMN } from './stickers.js';
import { app, tmsg, tone, TONES, toast, openW, fail, notify, winOpen, copyText } from './ui.js';
import { mobURL, MOBKEYS } from './mobs.js';
import { onCtx, openMenu, ask, selectionIn } from './menu.js';

const chatsEl = $('.js-chats'), friendsEl = $('.js-friends'), logsEl = $('.js-logs'), typEl = $('.js-typing'), nochat = $('.js-nochat');
const chead = $('.js-chead'), cmeta = $('.js-cmeta'), hbtns = $('.js-hbtns');
const form = $('.js-form'), input = $('.js-input'), stk = $('.js-stk'), fileIn = $('.js-file'), cbar = $('.js-cbar');
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
  const body = l.kind === 'sticker' ? 'стикер' : l.kind === 'image' ? '🖼 картинка' : l.kind === 'file' ? '📎 ' + esc((l.data && l.data.name) || 'файл') : esc(plain(l.text));
  return pre + body;
}
/** текст без разметки: для превью, ответов и озвучки (спойлеры не палим) */
export const plain = t => String(t || '').replace(/```[\s\S]*?```/g, '[код]').replace(/\|\|[\s\S]+?\|\|/g, '▒▒▒').replace(/\*\*|__|~~|`/g, '').replace(/(^|\s)\*(\S)/g, '$1$2').replace(/(\S)\*(\s|$)/g, '$1$2').replace(/^> /gm, '').replace(/\s+/g, ' ').trim();
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

/* ---------- вкладки сверху ---------- */
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
}
// переход в чат: строка списка или вкладка сверху
document.addEventListener('click', e => {
  const t = e.target; if (!(t instanceof Element)) return;
  const c = t.closest('.js-chats [data-chat], .js-nav .ws[data-chat]'); if (!c) return;
  e.preventDefault(); openChat(c.dataset.chat, { focus: true });
});
document.addEventListener('keydown', e => {
  if (e.altKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) { const id = wsRooms()[+e.code.slice(5) - 1]; if (id) { e.preventDefault(); openChat(id, { focus: true }); } }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); setTab('chats'); $('.js-search').focus(); }
});
bus.on('find', () => { setTab('chats'); $('.js-search').focus(); });

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
  h = h.replace(/(^|[\s(>])@([a-z0-9_.-]{2,16})/gi, (m, pre, n) => n.toLowerCase() === me ? `${pre}<mark class="me">@${n}</mark>` : `${pre}<span class="at" data-nick="${n.toLowerCase()}">@${n}</span>`);
  return h;
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
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200d|\ufe0f|\s)+$/u;
const jumbo = t => !!t && t.length <= 40 && EMOJI_ONLY.test(t) && (t.match(/\p{Extended_Pictographic}/gu) || []).length <= 3;
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
  return `<span class="rx">${rs.map(r => `<button type="button" class="rc${r.p.includes(me) ? ' on' : ''}" data-e="${esc(r.e)}" title="${esc(r.p.map(nickOf).join(', '))}" aria-label="${esc(r.e)} · ${r.p.length}">${esc(r.e)}<b>${r.p.length}</b></button>`).join('')}<button type="button" class="rc add" data-radd="1" title="Добавить реакцию" aria-label="Добавить реакцию">${ic('smile-plus')}</button></span>`;
}
function msgEl(m) {
  const d = document.createElement('div'); d.dataset.id = m.id; d.dataset.ts = m.ts;
  const t = `<time title="${new Date(m.ts).toLocaleString('ru-RU')}">${hm(new Date(m.ts))}</time>`;
  if (m.kind === 'sys') {
    d.className = 'm sys';
    d.innerHTML = `<span class="mav">${ic(m.text.startsWith('call') || m.text === 'missed' ? 'phone' : 'arrow-right')}</span><span class="who" aria-hidden="true"></span><span class="tx">${esc(sysText(m))}</span>${t}`;
    return d;
  }
  const me = m.from === myId(), u = m.from, dt = m.data || {};
  d.className = 'm' + (m.kind === 'sticker' ? ' stkm' : '') + (mentionsMe(m) ? ' ment' : '') + (m.rp ? ' hasrp' : '');
  d.dataset.u = u; d.style.setProperty('--c', colorOf(u));
  let body;
  if (m.kind === 'sticker') body = `<img class="stkimg" alt="стикер: ${esc(EMN[dt.k] || '')}" src="${EMO[dt.k] || EMO.fire}">`;
  else if (m.kind === 'image') {
    const src = picSrc(m), w = Math.min(320, +dt.w || 0), wh = w && dt.h ? ` width="${w}" height="${Math.round(w * dt.h / dt.w)}"` : '';
    body = (src ? `<img class="pic" alt="${esc(dt.name || 'картинка')}" src="${esc(src)}"${wh} loading="lazy" decoding="async">` : `<span class="dim">${ic('image')} картинка не докачалась</span>`) + (m.text ? `<span class="cap">${fmt(m.text)}</span>` : '');
  } else if (m.kind === 'file') body = `<button class="file" type="button" data-file="${esc(m.id)}" title="Сохранить">${ic('file')}${esc(dt.name || 'файл')} <small class="dim">${esc(size(dt.size || 0))}</small>${ic('download')}</button>` + (m.text ? `<span class="cap">${fmt(m.text)}</span>` : '');
  else body = jumbo(m.text) ? `<span class="jumbo">${esc(m.text)}</span>` : fmt(m.text || '');
  const rp = m.rp ? `<button type="button" class="rq" data-jump="${esc(m.rp.id)}" title="К сообщению">${ic('reply')}${m.rp.gone ? '<i>сообщение удалено</i>' : `<b style="--c:${colorOf(m.rp.from)}">${esc(nickOf(m.rp.from))}</b><span>${esc(rpText(m.rp))}</span>`}</button>` : '';
  const ed = m.edited ? ` <small class="ed" title="изменено ${esc(new Date(m.edited).toLocaleString('ru-RU'))}">(изм.)</small>` : '';
  d.innerHTML = `<span class="mav" data-u="${esc(u)}"${me ? ' data-me="1"' : ''}><img class="ava" alt="" src="${avaOf(u)}"></span><span class="who" data-u="${esc(u)}"${me ? ' data-me="1"' : ''}>${me ? `<span class="nk">${esc(nickOf(u))}</span>` : esc(nickOf(u))}</span><span class="tx">${rp}${body}${ed}${rxHTML(m)}</span>${t}`;
  return d;
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
    l.addEventListener('scroll', () => { if (l.scrollTop < 60) loadOlder(room); }, { passive: true });
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
const findMsg = (room, id) => (S.msgs.get(room) || []).find(x => x.id === id);

/* ---------- реакции, ответы, правки, удаление ---------- */
export function react(room, id, e) { api('react', { room, id, e }).catch(fail); }
function reactPicker(room, id, el) {
  const m = findMsg(room, id); if (!m) return;
  const mine = new Set((m.reacts || []).filter(x => x.p.includes(myId())).map(x => x.e)), on = e => react(room, id, e);
  openMenu([{ emojis: QUICK, active: mine, on }, { emojis: MORE, active: mine, on }], { el });
}
let replyTo = null, editing = null;
function startReply(room, m) {
  if (editing) cancelEdit(true);
  replyTo = { room, id: m.id, from: m.from, text: m.kind === 'text' ? plain(m.text) : rpText(m) };
  renderCbar(); input.focus();
}
function cancelReply() { if (!replyTo) return; replyTo = null; renderCbar(); }
function startEdit(room, m) {
  if (m.from !== myId() || m.kind === 'sticker' || m.kind === 'sys') return;
  replyTo = null;
  editing = { room, id: m.id, kind: m.kind, draft: editing ? editing.draft : input.value, text: m.text || '' };
  input.value = m.text || ''; autosize(); renderCbar();
  input.focus(); input.setSelectionRange(input.value.length, input.value.length);
}
function cancelEdit(keepInput) {
  if (!editing) return; const d = editing.draft; editing = null;
  if (!keepInput) { input.value = d || ''; autosize(); }
  renderCbar();
}
async function saveEdit() {
  const ed = editing, v = input.value.trim();
  if (v === (ed.text || '').trim()) { cancelEdit(); return; }
  if (!v && ed.kind === 'text') { cancelEdit(); delMsg(ed.room, findMsg(ed.room, ed.id)); return; }
  try { await api('edit', { room: ed.room, id: ed.id, text: v }); editing = null; input.value = ed.draft || ''; autosize(); renderCbar(); }
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
function openPic(src) { $('img', lbox).src = src; lbox.hidden = false; }
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
function jump(room, id) {
  const l = logs.get(room), el = l && $(`.m[data-id="${CSS.escape(id)}"]`, l);
  if (!el) { tmsg('warn', 'это сообщение выше — пролистай историю'); return; }
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  el.classList.remove('hl'); void el.offsetWidth; el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 1800);
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
    cbar.innerHTML = `${ic('pencil')}<span class="cb-t">Редактирование сообщения <span class="dim"><kbd>Enter</kbd> сохранить · <kbd>Esc</kbd> отмена</span></span><button type="button" class="ib sm" data-cb="x" title="Отменить" aria-label="Отменить">${ic('x')}</button>`;
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
  if (prev !== id) { if (editing && editing.room !== id) cancelEdit(); if (replyTo && replyTo.room !== id) replyTo = null; }
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
  syncComposer();
  if (focus && !mobile() && !form.hidden) input.focus({ preventScroll: true });
  bus.emit('open', id, prev);
}
export function showEmpty() {
  S.cur = ''; logs.forEach(l => { l.hidden = true; }); nochat.hidden = false; header(); renderChats(); form.hidden = true; cbar.hidden = true;
  const m = $('.js-ncmob'); if (m && !m.firstChild) m.innerHTML = `<img alt="" src="${mobURL(MOBKEYS[Math.floor(Math.random() * MOBKEYS.length)])}" width="56" height="56">`;
}

/* ---------- ввод и отправка ---------- */
/** ответ, если он был начат в этом чате, — уходит с первым же сообщением */
function takeReply() { if (!replyTo || replyTo.room !== S.cur) return ''; const id = replyTo.id; replyTo = null; renderCbar(); return id; }
async function send(kind, text, data, reply = takeReply()) {
  const room = S.cur; if (!room) return;
  try {
    const m = await api('send', { room, kind, text, data, reply });
    pushLocal(m);
    sendTyping(false);
  } catch (e) { fail(e); }
}
export function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 168) + 'px'; }
form.addEventListener('submit', e => {
  e.preventDefault();
  if (editing && editing.room === S.cur) { saveEdit(); return; }
  const v = input.value.trim(); if (!v || !S.cur) return;
  input.value = ''; autosize(); send('text', v);
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
input.addEventListener('input', () => { autosize(); if (editing) return; if (input.value.trim()) { sendTyping(true); clearTimeout(tyT); tyT = setTimeout(() => sendTyping(false), 5000); } });
function wrapSel(a, b = a) {
  const s = input.selectionStart, e = input.selectionEnd, sel = input.value.slice(s, e);
  input.focus(); document.execCommand('insertText', false, a + sel + b);
  if (!sel) input.setSelectionRange(s + a.length, s + a.length);
}
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !e.ctrlKey && !e.altKey) { e.preventDefault(); form.requestSubmit(); return; }
  if (e.key === 'Escape' && (editing || replyTo)) { e.preventDefault(); e.stopPropagation(); if (editing) cancelEdit(); else cancelReply(); return; }
  if (e.key === 'ArrowUp' && !input.value && !editing && !e.shiftKey) { // ↑ в пустом поле — править своё последнее
    const arr = S.msgs.get(S.cur) || [];
    for (let i = arr.length - 1; i >= 0; i--) { const m = arr[i]; if (m.from === myId() && m.kind !== 'sys' && m.kind !== 'sticker') { e.preventDefault(); startEdit(S.cur, m); return; } }
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
  const rc = t.closest('.rc[data-e]'); if (rc) { react(room, id, rc.dataset.e); return; }
  const ra = t.closest('[data-radd]'); if (ra) { reactPicker(room, id, ra); return; }
  const qr = t.closest('.mact [data-qr]'); if (qr) { react(room, id, qr.dataset.qr); return; }
  const ma = t.closest('.mact [data-ma]');
  if (ma) {
    const m = findMsg(room, id); if (!m) return; const act = ma.dataset.ma;
    if (act === 'react') reactPicker(room, id, ma);
    else if (act === 'reply') startReply(room, m);
    else if (act === 'edit') startEdit(room, m);
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
  mact.innerHTML = QUICK.slice(0, 3).map(x => `<button type="button" data-qr="${x}" title="${x}">${x}</button>`).join('') +
    `<button type="button" data-ma="react" title="Реакция" aria-label="Реакция">${ic('smile-plus')}</button><button type="button" data-ma="reply" title="Ответить" aria-label="Ответить">${ic('reply')}</button>` +
    (mine && msg.kind !== 'sticker' ? `<button type="button" data-ma="edit" title="Редактировать" aria-label="Редактировать">${ic('pencil')}</button>` : '') +
    `<button type="button" data-ma="more" title="Ещё" aria-label="Ещё">${ic('ellipsis')}</button>`;
  m.appendChild(mact);
});
logsEl.addEventListener('pointerleave', () => mact.remove());

/* ---------- контекстные меню: сообщение, чат в списке и во вкладках ---------- */
function msgItems(el) {
  const log = el.closest('.log'); if (!log) return null;
  const room = log.dataset.chat, id = el.dataset.id, m = findMsg(room, id); if (!m) return null;
  const r = S.rooms.get(room), me = m.from === myId(), admin = !!(r && r.kind === 'group' && r.admin);
  const sel = selectionIn(el);
  if (m.kind === 'sys') return [sel ? { icon: 'copy', label: 'Копировать', fn: () => copyText(sel) } : null, { icon: 'eye-off', label: 'Удалить у себя', fn: () => hideMsg(room, id) }];
  const mine = new Set((m.reacts || []).filter(x => x.p.includes(myId())).map(x => x.e)), on = e => react(room, id, e);
  const pic = m.kind === 'image' ? picSrc(m) : '';
  return [
    { emojis: QUICK, active: mine, on },
    '-',
    { icon: 'reply', label: 'Ответить', fn: () => startReply(room, m) },
    { icon: 'smile-plus', label: 'Реакция', items: [{ emojis: QUICK, active: mine, on }, { emojis: MORE, active: mine, on }] },
    sel ? { icon: 'copy', label: 'Копировать выделенное', fn: () => copyText(sel) } : null,
    m.text ? { icon: 'copy', label: 'Копировать текст', kbd: sel ? '' : 'Ctrl+C', fn: () => copyText(m.text) } : null,
    me && m.kind !== 'sticker' ? { icon: 'pencil', label: 'Редактировать', kbd: '↑', fn: () => startEdit(room, m) } : null,
    pic ? '-' : null,
    pic ? { icon: 'maximize-2', label: 'Открыть картинку', fn: () => openPic(pic) } : null,
    pic ? { icon: 'download', label: 'Сохранить картинку', fn: () => saveMsgFile(room, m) } : null,
    pic ? { icon: 'images', label: 'Копировать картинку', fn: () => copyPic(pic) } : null,
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
async function setMuted(id, on) {
  try {
    const j = await api('room_update', { room: id, muted: on }); if (j && j.id) S.rooms.set(j.id, j);
    renderChats(); if (id === S.cur) header();
    tmsg('ok', on ? 'без звука · непрочитанные всё равно посчитаю' : 'уведомления включены');
  } catch (e) { fail(e); }
}
function togglePin(id) {
  const cur = prefs.pinned || [], has = cur.includes(id);
  setPref('pinned', has ? cur.filter(x => x !== id) : [id, ...cur].slice(0, 4)); renderWs();
  tmsg('ok', has ? 'вкладка откреплена' : 'вкладка закреплена сверху · Alt+цифра — переключиться');
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
  const pin = (prefs.pinned || []).includes(id);
  const common = [
    { icon: 'check-check', label: 'Отметить прочитанным', disabled: !r.unread, fn: () => { api('read', { room: id }).catch(() => {}); r.unread = 0; renderChats(); } },
    { icon: r.muted ? 'bell' : 'bell-off', label: r.muted ? 'Включить уведомления' : 'Без звука', fn: () => setMuted(id, !r.muted) },
    { icon: 'pin', label: pin ? 'Открепить вкладку' : 'Закрепить вкладку', fn: () => togglePin(id) },
  ];
  if (r.kind === 'dm') {
    const p = dmPeer(r), f = S.friends.get(p), fr = !!(f && f.state === 'friend'), bl = isBlocked(p);
    return [
      { head: nickOf(p), sub: bl ? 'заблокирован' : isOnline(p) ? 'в сети' : 'не в сети', img: avaOf(p) },
      S.cur !== id ? { icon: 'message-circle', label: 'Открыть чат', fn: () => openChat(id, { focus: true }) } : null,
      { icon: 'user-round', label: 'Профиль', fn: () => bus.emit('open-profile', p) },
      { icon: 'phone', label: 'Позвонить', disabled: !fr || bl || !isOnline(p), fn: async () => { await openChat(id); bus.emit('call', id); } },
      '-', ...common, '-',
      { icon: 'at-sign', label: 'Копировать ник', fn: () => copyText('@' + nickOf(p)).then(() => tmsg('ok', 'ник скопирован')) },
      { icon: 'copy', label: 'Копировать ID', fn: () => copyText(p).then(() => tmsg('ok', 'ID скопирован')) },
      '-',
      { icon: 'eraser', label: 'Очистить историю', danger: true, fn: () => clearRoom(id) },
      fr ? { icon: 'user-x', label: 'Удалить из друзей', danger: true, fn: () => bus.emit('unfriend', p) } : null,
      { icon: 'ban', label: bl ? 'Разблокировать' : 'Заблокировать', danger: !bl, fn: () => bus.emit(bl ? 'unblock' : 'block', p) },
    ];
  }
  const n = (r.members || []).length;
  return [
    { head: r.name || 'группа', sub: r.pending ? 'ищу участников…' : `${n} ${plural(n, 'участник', 'участника', 'участников')}` },
    S.cur !== id ? { icon: 'message-circle', label: 'Открыть чат', fn: () => openChat(id, { focus: true }) } : null,
    r.voice && !r.pending ? { icon: 'mic', label: 'Зайти в голос', fn: () => bus.emit('voice-join', id) } : null,
    (r.invite === 'all' || r.admin) && !r.pending ? { icon: 'user-round-plus', label: 'Пригласить', fn: () => openW('gset', { room: id, tab: 'invite' }) } : null,
    { icon: 'settings', label: 'Настройки группы', fn: () => openW('gset', { room: id }) },
    '-', ...common, '-',
    { icon: 'eraser', label: 'Очистить историю', danger: true, fn: () => clearRoom(id) },
    { icon: 'log-out', label: 'Покинуть группу', danger: true, fn: () => leaveGroup(id) },
  ];
}
onCtx('.js-chats [data-chat], .js-nav .ws[data-chat], .js-pgroups [data-chat]', el => chatItems(el.dataset.chat));
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
  if (room === S.cur) { appendMsg(room, m); if (document.hasFocus() && !document.hidden) markRead(room); }
  renderChats(); if (room === S.cur) renderTyping();
  if (m.from === myId() || m.kind === 'sys' || isBlocked(m.from)) return;
  const ment = mentionsMe(m), seeing = room === S.cur && document.hasFocus() && !document.hidden;
  if (seeing) { tone(TONES.msg, .45); return; }
  if (r && r.muted && !ment) return;
  if (r && r.kind === 'group' && prefs.mentionsOnly && !ment) return;
  notify({ tone: ment ? 'mention' : 'msg', say: `${nickOf(m.from)} ${ment ? 'зовёт тебя' : 'пишет'}${r && r.kind === 'group' ? ' в ' + r.name : ''}` });
  if (!document.hidden) {
    const what = m.kind === 'text' ? plain(m.text).slice(0, 90) : m.kind === 'sticker' ? 'стикер' : m.kind === 'image' ? '🖼 картинка' : '📎 файл';
    toast({ ava: avaOf(m.from), icon: ment ? 'at-sign' : 'message-circle', title: nickOf(m.from) + (r && r.kind === 'group' ? ' · ' + r.name : ''), sub: what, dur: 5000, cls: 'msgt', actions: [{ label: 'Открыть', cls: 'gbtn', fn: () => openChat(room, { focus: true }) }] });
  }
});
bus.on('msgs', (room, add) => { if (room === S.cur && add.length) { const l = logs.get(room); renderLog(room, l && !atBottom(l) ? 'top' : ''); markRead(room); } renderChats(); });
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
