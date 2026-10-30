// Группы: создать, настройки, инвайт с QR, вступить по ссылке
import { $, $$, esc, ic, short, plural, bus } from './core.js';
import { api } from './api.js';
import { S, myId, nickOf, avaOf, isOnline, roomName } from './state.js';
import { OPEN, CLOSE, openW, closeW, tmsg, tone, TONES, toast, fail, segSet, segGet, winOpen } from './ui.js';
import { openChat, renderLists, header, tileHTML } from './chat.js';
import qrcode from './vendor/qrcode.js';

/* ---------- создать ---------- */
const gw = $('.win[data-win="group"]');
const gname = $('.js-gname', gw), gtile = $('.js-gtile', gw), gpick = $('.js-gpick', gw);
const picked = new Set();
function gcolor() { return segGet($('.js-gcol', gw)) || '#7ee2b8'; }
function gTile() { gtile.textContent = ((gname.value.trim() || '?')[0] || '?').toUpperCase(); gtile.style.setProperty('--tc', gcolor()); }
function renderPick() {
  const fr = [...S.friends.values()].filter(f => f.state === 'friend').sort((a, b) => (isOnline(b.peer) - isOnline(a.peer)));
  gpick.innerHTML = fr.length ? fr.map(f => `<button type="button" class="pk" data-p="${esc(f.peer)}" aria-pressed="${picked.has(f.peer)}"><img class="ava" alt="" src="${avaOf(f.peer)}"><span>${esc(nickOf(f.peer))}</span>${ic('check')}</button>`).join('') : '<div class="empty">друзей пока нет — создай группу и пригласи по ссылке</div>';
  $('.js-gcount', gw).textContent = '· выбрано ' + picked.size;
}
gpick.addEventListener('click', e => { const b = e.target.closest('.pk'); if (!b) return; const p = b.dataset.p; picked.has(p) ? picked.delete(p) : picked.add(p); b.setAttribute('aria-pressed', String(picked.has(p))); $('.js-gcount', gw).textContent = '· выбрано ' + picked.size; });
gname.addEventListener('input', gTile);
$('.js-gcol', gw).addEventListener('click', () => setTimeout(gTile, 0));
gname.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('.js-gcreate', gw).click(); } });
OPEN.group = (_, o) => { picked.clear(); if (o.with) picked.add(o.with); gname.value = ''; segSet($('.js-gcol', gw), ['#7ee2b8', '#9db7ff', '#ffb36b', '#ff94b8', '#63e6ff', '#ffd36b'][Math.floor(Math.random() * 6)]); gTile(); renderPick(); };
$('.js-gcreate', gw).addEventListener('click', async () => {
  const name = gname.value.trim();
  if (!name) { gname.focus(); tmsg('warn', 'назови группу'); return; }
  try {
    const r = await api('room_create', { name, color: gcolor(), members: [...picked], voice: $('.js-gvoice', gw).checked, invite: segGet($('.js-ginv', gw)) || 'all' });
    const room = r.room || r; S.rooms.set(room.id, room);
    closeW(true); renderLists(); openChat(room.id, { focus: true });
    tmsg('ok', `группа «${name}» создана · ты админ${picked.size ? ' · приглашения ушли ' + picked.size + ' ' + plural(picked.size, 'другу', 'друзьям', 'друзьям') : ''}`); tone(TONES.friend);
  } catch (e) { fail(e); }
});

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
  const t = $('.js-gstile', sw); t.textContent = (r.name || '?')[0].toUpperCase(); t.style.setProperty('--tc', r.color || '#7ee2b8');
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
$('.js-gsvoice', sw).addEventListener('change', e => upd({ voice: e.target.checked }, e.target.checked ? 'голосовой канал включён' : 'голосовой канал выключен'));
$('.js-gsinv', sw).addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b && !b.disabled) upd({ invite: b.dataset.v }); });
$('.js-gsmute', sw).addEventListener('change', e => upd({ muted: e.target.checked }, e.target.checked ? 'группа без звука' : 'уведомления группы включены'));
$('.js-gsleave', sw).addEventListener('click', async e => {
  const b = e.currentTarget;
  if (!b.dataset.sure) { b.dataset.sure = 1; b.innerHTML = ic('log-out') + 'Точно выйти?'; setTimeout(() => { delete b.dataset.sure; b.innerHTML = ic('log-out') + 'Выйти'; }, 4000); return; }
  try { const r = S.rooms.get(gsRoom); try { await api('send', { room: gsRoom, kind: 'sys', text: 'leave' }); } catch (_) {} await api('room_leave', { room: gsRoom }); closeW(true); tmsg('ok', `ты вышел из «${r ? r.name : 'группы'}»`); }
  catch (err) { fail(err); }
});
sw.addEventListener('click', async e => {
  const k = e.target.closest('[data-gkick]');
  if (k) {
    if (!k.dataset.sure) { k.dataset.sure = 1; k.classList.add('warn'); k.title = 'Точно выгнать?'; tmsg('warn', `ещё раз — и ${nickOf(k.dataset.gkick)} вылетит из группы (инвайт сбросится)`); return; }
    try { await api('send', { room: gsRoom, kind: 'sys', text: 'kick:' + k.dataset.gkick }).catch(() => {}); const j = await api('room_kick', { room: gsRoom, peer: k.dataset.gkick }); S.rooms.set(j.id, j); renderGset(); tmsg('ok', `${nickOf(k.dataset.gkick)} выгнан · старый инвайт больше не работает`); } catch (err) { fail(err); }
    return;
  }
  const a = e.target.closest('[data-gadm]');
  if (a) { try { const j = await api('room_admin', { room: gsRoom, peer: a.dataset.gadm, on: a.dataset.on === '1' }); S.rooms.set(j.id, j); renderGset(); } catch (err) { fail(err); } return; }
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
