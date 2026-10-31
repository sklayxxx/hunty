// Друзья: добавить по нику/коду, заявки, локалка, профиль, блок, меню человека по правому клику
import { $, $$, esc, ic, short, when, prefs, setPref, bus } from './core.js';
import { api } from './api.js';
import { S, myId, myNick, nickOf, avaOf, colorOf, isOnline, isFriend, isBlocked, dmOf, voiceIn, roomName, profileOf } from './state.js';
import { OPEN, CLOSE, openW, closeW, tmsg, tone, TONES, toast, fail, notify, winOpen, rgv } from './ui.js';
import { reqRow, renderLists, openChat, pdHTML } from './chat.js';
import { mobName } from './mobs.js';
import { onCtx, ask } from './menu.js';
import { personItems, setVol, setMute } from './people.js';

const w = $('.win[data-win="friend"]');
const fres = $('.js-fres', w), fnick = $('.js-fnick', w);
let myCode = '';
export const getMyCode = () => myCode;
export async function refreshCode() {
  try { const r = await api('friend_code'); myCode = r.code; } catch (_) {}
  $$('.js-mycode').forEach(e => { e.textContent = myCode.length > 34 ? myCode.slice(0, 30) + '…' : myCode; e.title = myCode; });
  $$('.js-mycodec').forEach(b => b.dataset.copy = myCode);
  $$('.js-copynick').forEach(b => b.dataset.copy = '@' + myNick());
  const nc = $('.js-nccode'); if (nc) nc.innerHTML = myCode ? `<span>твой код для друзей</span><code class="kc" title="${esc(myCode)}">${esc(myCode.length > 40 ? myCode.slice(0, 36) + '…' : myCode)}</code><button class="gbtn sm js-copy" data-copy="${esc(myCode)}">${ic('copy')}Копировать</button>` : '';
}

/* ---------- окно «Добавить друга» ---------- */
function renderReqs() {
  const inc = [...S.friends.values()].filter(f => f.state === 'incoming' || f.state === 'outgoing');
  $('.js-freq', w).innerHTML = inc.map(f => reqRow(f, true)).join('');
  $('.js-freqw', w).hidden = !inc.length;
  const near = [...S.nearby.entries()].filter(([p]) => !S.friends.has(p));
  $('.js-fsugg', w).innerHTML = near.map(([p, pr]) => resRow(p, pr)).join('');
  $('.js-fsuggw', w).hidden = !near.length;
}
function resRow(p, pr, note) {
  const f = S.friends.get(p);
  const btn = f && f.state === 'friend' ? `<button class="gbtn sm" data-dm="${esc(p)}">${ic('message-circle')}Написать</button>` : f && f.state === 'outgoing' ? '<span class="dim">заявка отправлена</span>' : f && f.state === 'incoming' ? `<button class="cbtn sm" data-fr="ok" data-u="${esc(p)}">Принять</button>` : `<button class="cbtn sm" data-add="${esc(p)}">${ic('user-round-plus')}Добавить</button>`;
  return `<div class="fres-i"><img class="ava" alt="" src="${avaOf(p)}"><span class="fr-t"><b>@${esc(pr.nick || short(p))}</b><small>${esc(note || pr.line || mobName(pr.ava))} · ${esc(short(p))}</small></span>${btn}</div>`;
}
const isCode = v => /^hunty:\/\/(add|join)\//.test(v) || /^12D3Koo[1-9A-HJ-NP-Za-km-z]{40,}$/.test(v);
let finding = null;
async function doFind(raw) {
  const v = raw.trim().replace(/^@/, '');
  if (!v) return;
  if (v.startsWith('hunty://join/')) { closeW(); bus.emit('code', v); return; }
  if (isCode(v)) {
    try {
      const r = await api('friend_add', { code: v });
      fres.innerHTML = r.already ? `<div class="fnote ok">${ic('check')}${esc(nickOf(r.friend.peer))} уже в друзьях</div>` : `<div class="fnote ok">${ic('check')}Заявка отправлена${r.friend && r.friend.profile && r.friend.profile.nick ? ' @' + esc(r.friend.profile.nick) : ''} · дойдёт, как только найдём друга в сети</div>`;
      fnick.value = ''; tone(TONES.ok); renderLists(); renderReqs();
    } catch (e) { fres.innerHTML = `<div class="fnote bad">${ic('x')}${esc(e.message)}</div>`; }
    return;
  }
  const nick = v.toLowerCase();
  if (!/^[a-z0-9._-]{2,16}$/.test(nick)) { fres.innerHTML = `<div class="fnote bad">${ic('x')}Ник: 2–16 символов — a–z, 0–9, точка, _ и -. Или вставь код hunty://add/…</div>`; return; }
  if (nick === myNick()) { fres.innerHTML = `<div class="fnote">${ic('smile')}Это ты :)</div>`; return; }
  finding = { nick, found: new Map(), t0: Date.now() };
  fres.innerHTML = `<div class="fnote js-fsearching">${ic('search')}Ищу @${esc(nick)} в сети — DHT и локалка, до 30 сек…</div><div class="js-flist"></div>`;
  try { await api('nick_find', { nick }); }
  catch (e) { fres.innerHTML = `<div class="fnote bad">${ic('x')}${esc(e.message)}</div><div class="fnote">Можно добавить по коду: попроси у друга его hunty://add/… из настроек</div>`; finding = null; return; }
  const my = finding;
  setTimeout(() => {
    if (finding !== my) return;
    const s = $('.js-fsearching', fres); if (!s) return;
    s.innerHTML = my.found.size ? `${ic('check')}Нашлось: ${my.found.size} · сверь моба и хвост ID с другом` : `${ic('x')}@${esc(nick)} не нашёлся. Друг должен быть в сети и включить «Находить меня по нику». Надёжнее — код hunty://add/…`;
    finding = null;
  }, 30000);
}
bus.on('found', v => {
  if (!finding || v.nick !== finding.nick || v.peer === myId()) return;
  finding.found.set(v.peer, v.profile);
  S.nearby.has(v.peer) || (v.profile && profileCache.set(v.peer, v.profile));
  const l = $('.js-flist', fres); if (!l) return;
  l.innerHTML = [...finding.found.entries()].map(([p, pr]) => resRow(p, pr)).join('');
  const s = $('.js-fsearching', fres); if (s) s.innerHTML = `${ic('check')}Нашлось: ${finding.found.size} · ищу ещё…`;
});
const profileCache = new Map();
$('.js-fform', w).addEventListener('submit', e => { e.preventDefault(); doFind(fnick.value); });
fnick.addEventListener('paste', () => setTimeout(() => { if (isCode(fnick.value.trim())) doFind(fnick.value); }, 0));
OPEN.friend = (_, o) => { fres.innerHTML = ''; fnick.value = o.code || ''; renderReqs(); refreshCode(); if (o.code) doFind(o.code); };
bus.on('friend', () => { if (winOpen() === 'friend') renderReqs(); });
bus.on('nearby', () => { if (winOpen() === 'friend') renderReqs(); renderLists(); });

/* ---------- действия с заявками (из списка и из окна) ---------- */
export async function addPeer(peer) {
  try {
    const pr = S.nearby.get(peer) || profileCache.get(peer) || {};
    // код из ID + известного ника — чтобы в заявке сразу был ник
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify({ p: peer, n: pr.nick || '', a: [] })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await api('friend_add', { code: 'hunty://add/' + b64 });
    tmsg('ok', `заявка ушла ${pr.nick ? '@' + pr.nick : short(peer)}`); tone(TONES.ok);
    renderLists(); if (winOpen() === 'friend') { renderReqs(); if (finding === null) $$('.fres-i [data-add="' + CSS.escape(peer) + '"]', w).forEach(b => b.outerHTML = '<span class="dim">заявка отправлена</span>'); }
  } catch (e) { fail(e); }
}
document.addEventListener('click', async e => {
  const t = e.target; if (!(t instanceof Element)) return;
  const fr = t.closest('[data-fr]');
  if (fr) { friendAct(fr.dataset.u, fr.dataset.fr); return; }
  const ad = t.closest('[data-add]'); if (ad) { addPeer(ad.dataset.add); return; }
  const dm = t.closest('[data-dm]'); if (dm) { closeW(true); openDM(dm.dataset.dm); return; }
  const pr = t.closest('[data-prof]'); if (pr) { openProfile(pr.dataset.prof); return; }
  const who = t.closest('.who[data-u],.mav[data-u]'); if (who) { who.dataset.u === myId() ? openW('settings', { tab: 'acc' }) : openProfile(who.dataset.u); return; }
});
export async function openDM(peer) {
  let id = dmOf(peer);
  if (!id) { try { const r = await api('dm_open', { peer }); id = r.id; if (r.id && !S.rooms.has(r.id)) S.rooms.set(r.id, r); } catch (e) { fail(e); return; } }
  if (id) openChat(id, { focus: true });
}

/* ---------- профиль ---------- */
const pw = $('.win[data-win="profile"]');
let pPeer = '';
export function openProfile(peer) { if (peer === myId()) { openW('settings', { tab: 'acc' }); return; } pPeer = peer; openW('profile', { peer }); }
function renderProfile() {
  const p = pPeer, pr = profileOf(p), f = S.friends.get(p), on = isOnline(p), o = S.online.get(p);
  $('.js-pava', pw).src = avaOf(p);
  $('.js-pnick', pw).textContent = pr.nick || short(p); $('.js-pnick', pw).style.color = colorOf(p);
  const vr = Object.keys(S.voices).find(k => voiceIn(k)[p]);
  $('.js-pst', pw).innerHTML = isBlocked(p) ? 'заблокирован' : on ? (vr ? `в голосе · ${esc(roomName(vr))}` : `в сети · ${o && o.via === 'relay' ? 'через ретранслятор' : o && o.via === 'lan' ? 'в локалке' : 'напрямую'}${o && o.rtt != null ? ' · ' + o.rtt + 'ms' : ''}`) : 'не в сети';
  $('.js-pban', pw).style.setProperty('--pc', colorOf(p));
  $('.js-pabout', pw).textContent = pr.line || '';
  const fr = f && f.state === 'friend';
  $('.js-pmsg', pw).hidden = !fr; $('.js-pcall', pw).hidden = !fr;
  $('.js-padd', pw).hidden = fr || (f && f.state === 'outgoing');
  $('.js-pask', pw).hidden = !(fr && on);
  const vol = (prefs.vol || {})[p] ?? 100; const rg = $('.js-pvol', pw); rg.value = vol; rgv(rg);
  $('.js-pmute', pw).checked = !!(prefs.mute || {})[p];
  const groups = [...S.rooms.values()].filter(r => r.kind === 'group' && (r.members || []).some(m => m.peer === p));
  $('.js-pgroups', pw).innerHTML = groups.length ? groups.map(r => `<button class="ci" data-chat="${esc(r.id)}"><span class="avw"><span class="tile" style="--tc:${esc(r.color || '#7ee2b8')}">${esc((r.name || '?')[0].toUpperCase())}</span></span><span class="nm">${esc(r.name)}</span><span class="lm">${(r.members || []).length} участн.</span></button>`).join('') : '<div class="empty">общих групп нет</div>';
  const bl = isBlocked(p);
  $('.js-pfoot', pw).innerHTML = `<span class="dim mono" title="${esc(p)}">ID ${esc(short(p))}</span>${f && f.since ? `<span class="dim">в друзьях с ${new Date(f.since).toLocaleDateString('ru-RU')}</span>` : ''}<span class="pf-sp"></span>${fr ? `<button class="gbtn sm warn js-punf">${ic('user-x')}Удалить из друзей</button>` : ''}<button class="gbtn sm ${bl ? '' : 'warn '}js-pblock">${ic(bl ? 'shield-off' : 'ban')}${bl ? 'Разблокировать' : 'Заблокировать'}</button>`;
}
OPEN.profile = (_, o) => { if (o.peer) pPeer = o.peer; renderProfile(); };
$('.js-pmsg', pw).addEventListener('click', () => { closeW(true); openDM(pPeer); });
$('.js-pcall', pw).addEventListener('click', async () => { closeW(true); await openDM(pPeer); bus.emit('call', dmOf(pPeer)); });
$('.js-padd', pw).addEventListener('click', () => { addPeer(pPeer); setTimeout(renderProfile, 300); });
$('.js-pvol', pw).addEventListener('input', e => setVol(pPeer, +e.target.value));
$('.js-pmute', pw).addEventListener('change', e => setMute(pPeer, e.target.checked));
$('.js-pcam', pw).addEventListener('click', () => bus.emit('ask', pPeer, 'cam'));
$('.js-pdemo', pw).addEventListener('click', () => bus.emit('ask', pPeer, 'share'));
pw.addEventListener('click', async e => {
  if (e.target.closest('.js-punf')) { if (await unfriend(pPeer)) closeW(true); return; }
  if (e.target.closest('.js-pblock')) { await (isBlocked(pPeer) ? unblock(pPeer) : block(pPeer)); if (winOpen() === 'profile') renderProfile(); return; }
  const ci = e.target.closest('[data-chat]'); if (ci) { closeW(true); openChat(ci.dataset.chat, { focus: true }); }
});
bus.on('presence', p => { if (winOpen() === 'profile' && p === pPeer) renderProfile(); });
bus.on('peer-vol', p => { if (winOpen() === 'profile' && p === pPeer) { const rg = $('.js-pvol', pw); if (document.activeElement !== rg) { rg.value = (prefs.vol || {})[p] ?? 100; rgv(rg); } $('.js-pmute', pw).checked = !!(prefs.mute || {})[p]; } });
bus.on('blocked', () => { if (winOpen() === 'profile') renderProfile(); renderLists(); });

/* ---------- удалить, заблокировать (спрашиваем, потом делаем) ---------- */
export async function unfriend(p) {
  if (!(await ask({ title: `Удалить ${nickOf(p)} из друзей?`, text: 'Переписка останется у обоих, но писать в лс и звонить друг другу будет нельзя, пока снова не добавитесь.', ok: 'Удалить', danger: true, icon: 'user-x' }))) return false;
  try { await api('friend_remove', { peer: p }); tmsg('ok', `${nickOf(p)} больше не в друзьях`); renderLists(); return true; } catch (e) { fail(e); return false; }
}
export async function block(p) {
  if (!(await ask({ title: `Заблокировать ${nickOf(p)}?`, text: 'Не сможет писать тебе в лс, звонить и слать заявки, его сообщения в группах скроются, из друзей он тоже удалится. Он об этом не узнает.', ok: 'Заблокировать', danger: true, icon: 'ban' }))) return false;
  try { await api('block', { peer: p }); tmsg('ok', `${nickOf(p)} заблокирован · разблокировать — Настройки → Приватность`); return true; } catch (e) { fail(e); return false; }
}
export async function unblock(p) {
  try { await api('unblock', { peer: p }); tmsg('ok', `${nickOf(p)} разблокирован · чтобы снова переписываться, добавьтесь в друзья`); return true; } catch (e) { fail(e); return false; }
}
async function friendAct(p, a) {
  try {
    if (a === 'ok') { await api('friend_accept', { peer: p }); tmsg('ok', `${nickOf(p)} теперь в друзьях · личка создана`); tone(TONES.friend); }
    else if (a === 'no') { await api('friend_decline', { peer: p }); tmsg('ok', 'заявка отклонена'); }
    else if (a === 'cancel') { await api('friend_remove', { peer: p }); tmsg('ok', 'заявка отменена'); }
  } catch (err) { fail(err); }
  renderLists(); if (winOpen() === 'friend') renderReqs();
}
bus.on('open-profile', p => openProfile(p));
bus.on('dm', p => { closeW(true); openDM(p); });
bus.on('dm-call', async p => { closeW(true); await openDM(p); const id = dmOf(p); if (id) bus.emit('call', id); });
bus.on('friend-add', p => addPeer(p));
bus.on('friend-accept', p => friendAct(p, 'ok'));
bus.on('friend-cancel', p => friendAct(p, 'cancel'));
bus.on('unfriend', p => unfriend(p));
bus.on('block', p => block(p));
bus.on('unblock', p => unblock(p));

/* ---------- правый клик по людям ---------- */
onCtx('[data-prof]', el => el.closest('.js-gmembers') ? null : personItems(el.dataset.prof));
onCtx('.who[data-u], .mav[data-u]', el => personItems(el.dataset.u));
// заявки и «рядом»: свои пункты сверху
const rowPeer = el => { const b = el.querySelector('[data-u],[data-add],[data-dm]'); return b ? b.dataset.u || b.dataset.add || b.dataset.dm : ''; };
onCtx('.ci.req, .fres-i', el => {
  const p = rowPeer(el); if (!p || p === myId()) return null;
  const f = S.friends.get(p), st = f && f.state;
  const extra = st === 'incoming' ? [{ icon: 'check', label: 'Принять', fn: () => friendAct(p, 'ok') }, { icon: 'x', label: 'Отклонить', fn: () => friendAct(p, 'no') }] : [];
  return personItems(p, { extra, sub: st === 'incoming' ? 'хочет в друзья' : st === 'outgoing' ? 'заявка отправлена' : '' });
});

/* ---------- входящие заявки и друзья онлайн ---------- */
bus.on('friend', (f, old, v) => {
  renderLists();
  if (v && v.request && f.state === 'incoming') {
    notify({ tone: 'friend', say: `${nickOf(f.peer)} хочет в друзья` });
    toast({ ava: avaOf(f.peer), icon: 'user-round-plus', title: `@${nickOf(f.peer)} хочет в друзья`, sub: (f.profile && f.profile.line) || 'заявка напрямую, без серверов', dur: 20000,
      actions: [{ label: 'Принять', cls: 'cbtn', fn: () => api('friend_accept', { peer: f.peer }).then(() => { tmsg('ok', `${nickOf(f.peer)} теперь в друзьях`); tone(TONES.friend); }, fail) }, { label: 'Потом', cls: 'gbtn' }] });
  }
  if (old && old.state === 'outgoing' && f.state === 'friend') { tmsg('ok', `${nickOf(f.peer)} принял заявку · личка готова`); notify({ tone: 'friend', say: `${nickOf(f.peer)} теперь в друзьях` }); }
});
const seenOnline = new Map();
bus.on('presence', (p, on, was) => {
  const f = S.friends.get(p);
  renderLists();
  if (!f || f.state !== 'friend' || on === was) return;
  if (on && prefs.friendOnline && Date.now() - (seenOnline.get(p) || 0) > 10 * 60000 && performance.now() > 15000) { tmsg('ok', `${nickOf(p)} в сети`); tone([[659, .04], [880, .06]], .5); }
  if (on) seenOnline.set(p, Date.now());
});
