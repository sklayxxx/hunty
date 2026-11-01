// Группы: создать, настройки, инвайт с QR, вступить по ссылке
import { $, $$, esc, ic, short, plural, bus } from './core.js';
import { api } from './api.js';
import { S, myId, myNick, nickOf, avaOf, isOnline, roomName } from './state.js';
import { OPEN, CLOSE, openW, closeW, tmsg, tone, TONES, toast, fail, segSet, segGet, winOpen } from './ui.js';
import { openChat, renderLists, header, tileHTML, leaveGroup, pdHTML, lineOf } from './chat.js';
import { shrinkImage } from './card.js';
import { bump } from './motion.js';
import { onCtx, ask } from './menu.js';
import { personItems } from './people.js';
import qrcode from './vendor/qrcode.js';

/* ---------- создать: понятный выбор (галочка-кружок + чипы выбранных), своя картинка ---------- */
const gw = $('.win[data-win="group"]');
const gname = $('.js-gname', gw), gtile = $('.js-gtile', gw), gpick = $('.js-gpick', gw), gq = $('.js-gq', gw);
const picked = new Set(); let gpic = '';
function gcolor() { return segGet($('.js-gcol', gw)) || '#7ee2b8'; }
function gTile() {
  gtile.style.setProperty('--tc', gcolor());
  gtile.classList.toggle('pic', !!gpic);
  gtile.innerHTML = gpic ? `<img alt="" src="${esc(gpic)}" draggable="false">` : esc(((gname.value.trim() || '?')[0] || '?').toUpperCase());
}
const friendsList = () => [...S.friends.values()].filter(f => f.state === 'friend').sort((a, b) => (isOnline(b.peer) - isOnline(a.peer)) || nickOf(a.peer).localeCompare(nickOf(b.peer)));
function gCount() {
  const n = picked.size, all = friendsList().length;
  $('.js-gcount', gw).textContent = n ? `выбрано ${n} ${plural(n, 'друг', 'друга', 'друзей')}` : 'пока никого · можно позвать потом по ссылке';
  $('.js-gall', gw).hidden = !all || n === all; $('.js-gnone', gw).hidden = !n;
  $('.js-gchips', gw).innerHTML = [...picked].map(p => `<button type="button" class="gchip" data-un="${esc(p)}" title="Убрать"><img class="ava" alt="" src="${avaOf(p)}"><span>${esc(nickOf(p))}</span>${ic('x')}</button>`).join('');
}
function renderPick() {
  const q = gq.value.trim().toLowerCase(), fr = friendsList();
  const list = q ? fr.filter(f => nickOf(f.peer).toLowerCase().includes(q)) : fr;
  gq.parentElement.hidden = fr.length < 6;
  gpick.innerHTML = !fr.length ? '<div class="empty">друзей пока нет — создай группу и позови по ссылке</div>'
    : !list.length ? '<div class="empty">никого с таким ником</div>'
    : list.map(f => `<button type="button" class="pk" role="option" data-p="${esc(f.peer)}" aria-pressed="${picked.has(f.peer)}" aria-selected="${picked.has(f.peer)}"><span class="avw"><img class="ava" alt="" src="${avaOf(f.peer)}">${pdHTML(f.peer)}</span><span class="pkn"><b>${esc(nickOf(f.peer))}</b><small>${esc(lineOf(f.peer))}</small></span><span class="pkc">${ic('check')}</span></button>`).join('');
  gCount();
}
function toggle(p, on) {
  on = on ?? !picked.has(p); on ? picked.add(p) : picked.delete(p);
  const b = gpick.querySelector(`.pk[data-p="${CSS.escape(p)}"]`);
  if (b) { b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-selected', String(on)); if (on) bump(b.querySelector('.pkc'), 1.25); }
  gCount();
}
gpick.addEventListener('click', e => { const b = e.target.closest('.pk'); if (b) toggle(b.dataset.p); });
$('.js-gchips', gw).addEventListener('click', e => { const b = e.target.closest('[data-un]'); if (b) toggle(b.dataset.un, false); });
$('.js-gall', gw).addEventListener('click', () => { friendsList().forEach(f => picked.add(f.peer)); renderPick(); });
$('.js-gnone', gw).addEventListener('click', () => { picked.clear(); renderPick(); });
gq.addEventListener('input', renderPick);
gname.addEventListener('input', gTile);
$('.js-gcol', gw).addEventListener('click', () => setTimeout(gTile, 0));
gname.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('.js-gcreate', gw).click(); } });
/** картинка группы: квадрат 128×128, до ~90 КБ — уходит всем участникам */
export function pickGroupPic(input, done) {
  input.value = '';
  input.onchange = async () => { const f = input.files && input.files[0]; if (!f) return; try { done(await shrinkImage(f, { w: 128, h: 128, max: 90 * 1024 })); } catch (e) { fail(e); } };
  input.click();
}
$('.js-gpic', gw).addEventListener('click', () => {
  if (gpic) { gpic = ''; gTile(); tmsg('ok', 'картинка убрана · будет буква'); return; }
  pickGroupPic($('.js-gpicf', gw), u => { gpic = u; gTile(); bump(gtile); });
});
let fromCall = '';
OPEN.group = (_, o) => { picked.clear(); gpic = ''; gq.value = ''; if (o.with) picked.add(o.with); fromCall = o.fromCall || ''; gname.value = fromCall && o.with ? `${myNick()}, ${nickOf(o.with)}` : ''; segSet($('.js-gcol', gw), ['#7ee2b8', '#9db7ff', '#ffb36b', '#ff94b8', '#63e6ff', '#ffd36b', '#d6a8ff', '#ff9f8f'][Math.floor(Math.random() * 8)]); gTile(); renderPick(); };
$('.js-gcreate', gw).addEventListener('click', async () => {
  const name = gname.value.trim();
  if (!name) { gname.focus(); gname.classList.remove('shake'); void gname.offsetWidth; gname.classList.add('shake'); tmsg('warn', 'назови группу'); return; }
  try {
    const r = await api('room_create', { name, color: gcolor(), members: [...picked], voice: true, invite: segGet($('.js-ginv', gw)) || 'all', ...(gpic ? { pic: gpic } : {}) });
    const room = r.room || r; S.rooms.set(room.id, room);
    closeW(true); renderLists(); openChat(room.id, { focus: true });
    if (fromCall) moveCall(fromCall, room.id, [...picked]);
    tmsg('ok', `группа «${name}» создана · ты админ${picked.size ? ' · приглашения ушли ' + picked.size + ' ' + plural(picked.size, 'другу', 'друзьям', 'друзьям') : ''}`); tone(TONES.friend);
  } catch (e) { fail(e); }
});

/** звонок в личке → группа: друг из лички переезжает сам (ev move), остальных зову */
async function moveCall(dm, to, picks) {
  const r = S.rooms.get(dm), peer = r && r.kind === 'dm' ? (r.members || []).map(m => m.peer).find(p => p !== myId()) : '';
  api('ev', { room: dm, kind: 'move', data: { to } }).catch(() => {});
  bus.emit('voice-join', to);
  await new Promise(ok => setTimeout(ok, 1500));
  for (const p of picks) if (p !== peer) api('ev', { room: to, kind: 'gather', data: { you: p } }).catch(() => {});
}

/* ---------- вступить по инвайту ---------- */
const jw = $('.win[data-win="join"]'), jst = $('.js-jst', jw), jcode = $('.js-jcode', jw);
let joining = '';
OPEN.join = (_, o) => { jcode.value = o.code || ''; jst.innerHTML = ''; if (o.code) doJoin(o.code); };
$('.js-jform', jw).addEventListener('submit', e => { e.preventDefault(); doJoin(jcode.value); });
jcode.addEventListener('paste', () => setTimeout(() => { if (/^hunty:\/\/join\//.test(jcode.value.trim())) doJoin(jcode.value); }, 0));
async function doJoin(code) {
  code = code.trim(); if (!code) return;
  jst.innerHTML = `<div class="fnote">${ic('search')}Ищу группу в сети…</div>`;
  try {
    const r = await api('room_join', { code });
    const room = r.room || r;
    if (room && room.id) { S.rooms.set(room.id, room); joining = room.id; }
    if (r.already) { jst.innerHTML = `<div class="fnote ok">${ic('check')}Ты уже в «${esc(room.name)}»</div>`; setTimeout(() => { closeW(true); openChat(room.id); }, 600); return; }
    jst.innerHTML = `<div class="fnote">${ic('radio-tower')}«${esc(room.name || 'группа')}» — стучусь к участникам. Если никого нет в сети, вступлю автоматически, когда кто-то появится.</div>`;
    renderLists();
  } catch (e) { jst.innerHTML = `<div class="fnote bad">${ic('x')}${esc(e.message)}</div>`; }
}
bus.on('room', (room, old, v) => {
  if (v && v.joined) {
    tmsg('ok', `ты в группе «${room.name}» · история скачивается`); tone(TONES.friend);
    if (joining === room.id) { joining = ''; if (winOpen() === 'join') closeW(true); openChat(room.id, { focus: true }); }
  }
  if (v && v.added_by && !old) {
    toast({ icon: 'users', title: `${nickOf(v.added_by)} добавил тебя в «${room.name}»`, sub: `${(room.members || []).length} участн.`, dur: 9000, actions: [{ label: 'Открыть', cls: 'cbtn', fn: () => openChat(room.id, { focus: true }) }] });
    tone(TONES.friend);
  }
  if (winOpen() === 'gset' && room.id === gsRoom) renderGset();
});
bus.on('join_failed', v => {
  const t = `не получилось вступить: ${v.error}`;
  if (winOpen() === 'join') jst.innerHTML = `<div class="fnote bad">${ic('x')}${esc(t)}</div>`; else tmsg('err', t);
});
bus.on('code', code => { if (code.startsWith('hunty://join/')) openW('join', { code }); else openW('friend', { code }); });

/* ---------- настройки группы ---------- */
const sw = $('.win[data-win="gset"]');
let gsRoom = '', gsTab = 'members';
function setGTab(t) { gsTab = t; segSet($('.js-gtabs', sw), t); $$('.gpage', sw).forEach(p => p.hidden = p.dataset.g !== t); if (t === 'invite') loadInvite(); }
$('.js-gtabs', sw).addEventListener('click', e => { const b = e.target.closest('button[data-g]'); if (b) setGTab(b.dataset.g); });
$$('.js-gtabs button', sw).forEach(b => b.dataset.v = b.dataset.g);
function renderGset() {
  const r = S.rooms.get(gsRoom); if (!r) { closeW(true); return; }
  $('.js-gstile', sw).innerHTML = tileHTML(r); $('.js-gspic', sw).innerHTML = tileHTML(r);
  $('.js-gspicup', sw).hidden = !r.admin; $('.js-gspicdel', sw).hidden = !r.admin || !r.pic;
  $('.js-gstitle', sw).textContent = r.name;
  $('.js-gssub', sw).textContent = r.admin ? 'настройки группы · ты админ' : 'настройки группы';
  const ms = (r.members || []).slice().sort((a, b) => (b.role === 'owner') - (a.role === 'owner') || (b.role === 'admin') - (a.role === 'admin') || (b.online - a.online));
  $('.js-gmembers', sw).innerHTML = ms.map(m => {
    const role = m.role === 'owner' ? '<span class="role own">создатель</span>' : m.role === 'admin' ? '<span class="role adm">админ</span>' : '';
    const acts = r.admin && !m.me && m.role !== 'owner' ? `<button class="ib sm" data-gadm="${esc(m.peer)}" data-on="${m.role === 'admin' ? 0 : 1}" title="${m.role === 'admin' ? 'Снять админа' : 'Сделать админом'}">${ic('crown')}</button><button class="ib sm no" data-gkick="${esc(m.peer)}" title="Выгнать">${ic('ban')}</button>` : '';
    return `<div class="mrow"><span class="avw"><img class="ava" alt="" src="${avaOf(m.peer)}"><i class="pd${m.online ? ' on' : ''}"></i></span><b class="mn" ${m.me ? '' : `data-prof="${esc(m.peer)}"`}>${esc(m.nick || short(m.peer))}${m.me ? ' <span class="dim">(ты)</span>' : ''}</b>${role}<span class="mra">${acts}</span></div>`;
  }).join('') + ((r.invite === 'all' || r.admin) ? `<button class="pbtn wide js-ginvadd">${ic('user-round-plus')}Добавить друзей</button><div class="js-gadd" hidden></div>` : '');
  $('.js-gsname', sw).value = r.name; $('.js-gsname', sw).disabled = !r.admin;
  segSet($('.js-gscol', sw), r.color); $('.js-gscol', sw).classList.toggle('ro', !r.admin);
  $('.js-gsvoice', sw).checked = !!r.voice; $('.js-gsvoice', sw).disabled = !r.admin;
  segSet($('.js-gsinv', sw), r.invite); $$('.js-gsinv button', sw).forEach(b => b.disabled = !r.admin);
  $('.js-gsmute', sw).checked = !!r.muted;
  $('.js-gnew', sw).hidden = !r.admin;
}
OPEN.gset = (_, o) => { gsRoom = o.room || S.cur; renderGset(); setGTab(o.tab || 'members'); };
async function upd(patch, msg) {
  try { const j = await api('room_update', { room: gsRoom, ...patch }); if (j && j.id) S.rooms.set(j.id, j); renderGset(); header(); renderLists(); if (msg) tmsg('ok', msg); }
  catch (e) { fail(e); renderGset(); }
}
$('.js-gsname', sw).addEventListener('change', e => { const v = e.target.value.trim(); if (v) upd({ name: v }, 'группа переименована'); });
$('.js-gscol', sw).addEventListener('click', e => { const b = e.target.closest('button[data-c]'); if (b && S.rooms.get(gsRoom).admin) upd({ color: b.dataset.c }); });
$('.js-gspicup', sw).addEventListener('click', () => pickGroupPic($('.js-gpicf', gw), u => upd({ pic: u }, 'картинка группы обновлена · участники увидят сразу')));
$('.js-gspicdel', sw).addEventListener('click', () => upd({ pic: '' }, 'картинка убрана'));
$('.js-gsvoice', sw).addEventListener('change', e => upd({ voice: e.target.checked }, e.target.checked ? 'голосовой канал включён' : 'голосовой канал выключен'));
$('.js-gsinv', sw).addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b && !b.disabled) upd({ invite: b.dataset.v }); });
$('.js-gsmute', sw).addEventListener('change', e => upd({ muted: e.target.checked }, e.target.checked ? 'группа без звука' : 'уведомления группы включены'));
$('.js-gsleave', sw).addEventListener('click', () => leaveGroup(gsRoom));
bus.on('room_removed', room => { if (winOpen() === 'gset' && room === gsRoom) closeW(true); });
async function kick(peer) {
  if (!(await ask({ title: `Выгнать ${nickOf(peer)} из группы?`, text: 'Инвайт-ссылка сбросится, чтобы он не вернулся по старой.', ok: 'Выгнать', danger: true, icon: 'ban' }))) return;
  try { await api('send', { room: gsRoom, kind: 'sys', text: 'kick:' + peer }).catch(() => {}); const j = await api('room_kick', { room: gsRoom, peer }); S.rooms.set(j.id, j); renderGset(); tmsg('ok', `${nickOf(peer)} выгнан · старый инвайт больше не работает`); } catch (err) { fail(err); }
}
async function setAdmin(peer, on) { try { const j = await api('room_admin', { room: gsRoom, peer, on }); S.rooms.set(j.id, j); renderGset(); tmsg('ok', on ? `${nickOf(peer)} теперь админ` : `${nickOf(peer)} больше не админ`); } catch (err) { fail(err); } }
// правый клик по участнику: меню человека + админка
onCtx('.js-gmembers .mrow', el => {
  const b = el.querySelector('[data-prof]'), p = b ? b.dataset.prof : myId();
  const r = S.rooms.get(gsRoom), m = ((r && r.members) || []).find(x => x.peer === p);
  const extra = r && r.admin && m && !m.me && m.role !== 'owner' ? [
    { icon: 'crown', label: m.role === 'admin' ? 'Снять админа' : 'Сделать админом', fn: () => setAdmin(p, m.role !== 'admin') },
    { icon: 'ban', label: 'Выгнать из группы', danger: true, fn: () => kick(p) },
  ] : [];
  return personItems(p, { extra, sub: m ? (m.role === 'owner' ? 'создатель группы' : m.role === 'admin' ? 'админ группы' : '') : '' });
});
sw.addEventListener('click', async e => {
  const k = e.target.closest('[data-gkick]');
  if (k) { kick(k.dataset.gkick); return; }
  const a = e.target.closest('[data-gadm]');
  if (a) { setAdmin(a.dataset.gadm, a.dataset.on === '1'); return; }
  if (e.target.closest('.js-ginvadd')) {
    const r = S.rooms.get(gsRoom), have = new Set((r.members || []).map(m => m.peer));
    const fr = [...S.friends.values()].filter(f => f.state === 'friend' && !have.has(f.peer));
    const box = $('.js-gadd', sw); box.hidden = false;
    box.innerHTML = fr.length ? `<div class="pick">${fr.map(f => `<button type="button" class="pk" data-ginv="${esc(f.peer)}"><img class="ava" alt="" src="${avaOf(f.peer)}"><span>${esc(nickOf(f.peer))}</span>${ic('plus')}</button>`).join('')}</div>` : '<div class="empty">все друзья уже тут — зови остальных по ссылке во вкладке «Инвайт»</div>';
    return;
  }
  const gi = e.target.closest('[data-ginv]');
  if (gi) { try { const j = await api('room_add', { room: gsRoom, peers: [gi.dataset.ginv] }); if (j && j.id) S.rooms.set(j.id, j); gi.setAttribute('aria-pressed', 'true'); gi.disabled = true; tmsg('ok', `${nickOf(gi.dataset.ginv)} добавлен в группу`); } catch (err) { fail(err); } }
});
async function loadInvite() {
  const c = $('.js-ginvc', sw), q = $('.js-qr', sw);
  c.textContent = '…'; q.innerHTML = '';
  try {
    const { code } = await api('room_invite', { room: gsRoom });
    c.textContent = code.length > 46 ? code.slice(0, 42) + '…' : code; c.title = code;
    $('.js-ginvcp', sw).dataset.copy = code;
    const qr = qrcode(0, 'L'); qr.addData(code); qr.make();
    const n = qr.getModuleCount(); let p = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) p += `M${x} ${y}h1v1h-1z`;
    q.innerHTML = `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" aria-hidden="true"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${p}" fill="#000"/></svg>`;
  } catch (e) { c.textContent = e.message; }
}
$('.js-gnew', sw).addEventListener('click', async () => { await upd({ new_secret: true }, 'ссылка сброшена — старые инвайты больше не работают'); loadInvite(); });
