// Модель: всё, что знает ядро, + то, что нужно только UI
import { bus, short } from './core.js';
import { avaURL } from './mobs.js';
import { on } from './api.js';

export const S = {
  me: null,               // {peer, profile, onboarded}
  friends: new Map(),     // peer → friend
  rooms: new Map(),       // id → room
  online: new Map(),      // peer → {rtt, via}
  voices: {},             // room → {peer: VoiceState}
  myVoice: null,          // [room, state] | null
  nearby: new Map(),      // peer → profile
  net: null, config: {}, ice: [], version: '',
  cur: '',                // открытый чат
  typing: {},             // room → Map(peer → ts)
  msgs: new Map(),        // room → [msg] (загруженное)
  full: new Set(),        // комнаты, где история загружена до начала
  link: true,             // есть связь с ядром
  blocked: new Map(),     // peer → {peer, nick, ts}: заблокированные
};
export const myId = () => (S.me ? S.me.peer : '');
export const myNick = () => (S.me && S.me.profile ? S.me.profile.nick : '');

export function load(st) {
  S.me = st.me; S.version = st.version || ''; S.config = st.config || {}; S.ice = st.ice || []; S.net = st.net || null;
  S.friends = new Map((st.friends || []).filter(Boolean).map(f => [f.peer, f]));
  S.rooms = new Map((st.rooms || []).filter(Boolean).map(r => [r.id, r]));
  S.online = new Map(Object.entries(st.online || {}));
  S.voices = (st.voice && st.voice.rooms) || {};
  S.myVoice = (st.voice && st.voice.mine) || null;
  S.nearby = new Map((st.nearby || []).filter(x => x.profile).map(x => [x.peer, x.profile]));
  setBlocked(st.blocked);
}
function setBlocked(list) { S.blocked = new Map((list || []).filter(b => b && b.peer).map(b => [b.peer, b])); }
export const isBlocked = peer => S.blocked.has(peer);

function member(peer) {
  for (const r of S.rooms.values()) { const m = (r.members || []).find(m => m.peer === peer); if (m && m.nick) return m; }
  return null;
}
export function profileOf(peer) {
  if (S.me && peer === S.me.peer) return S.me.profile || {};
  const f = S.friends.get(peer); if (f && f.profile && f.profile.nick) return f.profile;
  const n = S.nearby.get(peer); if (n) return n;
  const m = member(peer); if (m) return { nick: m.nick, ava: m.ava };
  const b = S.blocked.get(peer); if (b && b.nick) return { nick: b.nick };
  return (f && f.profile) || {};
}
export const nickOf = peer => profileOf(peer).nick || short(peer);
export const avaOf = peer => avaURL(profileOf(peer).ava, peer);
const PAL = ['#9db7ff', '#ffb36b', '#ff94b8', '#63e6ff', '#ffd36b', '#b8f59a', '#d6a8ff', '#ff9f8f'];
export function colorOf(peer) {
  const c = profileOf(peer).color; if (c) return c;
  if (S.me && peer === S.me.peer) return 'var(--acc)';
  let h = 0; for (const ch of String(peer)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PAL[h % PAL.length];
}
export const isOnline = peer => !!(S.me && peer === S.me.peer) || S.online.has(peer);
export const friendOf = peer => S.friends.get(peer);
export const isFriend = peer => (S.friends.get(peer) || {}).state === 'friend';
export function dmPeer(r) {
  if (typeof r === 'string') r = S.rooms.get(r);
  if (!r || r.kind !== 'dm') return '';
  const m = (r.members || []).find(m => !m.me); if (m) return m.peer;
  for (const f of S.friends.values()) if (f.dm === r.id) return f.peer;
  return '';
}
export function dmOf(peer) { const f = S.friends.get(peer); return f && f.dm && S.rooms.has(f.dm) ? f.dm : ''; }
export function roomName(r) { if (typeof r === 'string') r = S.rooms.get(r); if (!r) return '?'; return r.kind === 'dm' ? nickOf(dmPeer(r)) : r.name || 'группа'; }
export const voiceIn = room => S.voices[room] || {};
export const voiceCount = room => Object.keys(voiceIn(room)).length;
export const myVoiceRoom = () => (S.myVoice ? S.myVoice[0] : '');
export function typers(room) {
  const m = S.typing[room]; if (!m) return [];
  const now = Date.now(); const out = [];
  for (const [p, t] of m) { if (now - t < 6000 && p !== myId()) out.push(p); else if (now - t >= 6000) m.delete(p); }
  return out;
}

/* ---------- события ядра → модель → шина UI ---------- */
function addMsgs(room, list) {
  const arr = S.msgs.get(room); if (!arr) return [];
  const have = new Set(arr.map(m => m.id)); const add = list.filter(m => m && !have.has(m.id));
  if (!add.length) return [];
  arr.push(...add); arr.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  return add;
}
function onMsg(v) {
  const r = S.rooms.get(v.room);
  if (r) { if (!r.last || v.msg.ts >= r.last.ts) r.last = v.msg; r.unread = v.unread || 0; r.count = (r.count || 0) + 1; }
  const tm = S.typing[v.room]; if (tm) tm.delete(v.msg.from);
  addMsgs(v.room, [v.msg]);
  bus.emit('msg', v.room, v.msg);
}
/** своё сообщение: ядро не шлёт событие отправителю — добавляю сам */
export const pushLocal = msg => onMsg({ room: msg.room, msg, unread: 0 });
export function wire() {
  on('msg', onMsg);
  on('msgs', v => {
    const r = S.rooms.get(v.room);
    if (r) { r.unread = v.unread || 0; const l = v.msgs[v.msgs.length - 1]; if (l && (!r.last || l.ts >= r.last.ts)) r.last = l; }
    const add = addMsgs(v.room, v.msgs || []);
    bus.emit('msgs', v.room, add);
  });
  on('room', v => {
    if (!v.room) return; const old = S.rooms.get(v.room.id); S.rooms.set(v.room.id, v.room);
    if (v.cleared) { S.msgs.delete(v.room.id); S.full.delete(v.room.id); }
    bus.emit('room', v.room, old, v);
  });
  // правка, реакция, удаление: сообщение целиком (или null — его больше нет)
  on('msg_upd', v => {
    const arr = S.msgs.get(v.room);
    if (arr) { const i = arr.findIndex(m => m.id === v.id); if (i >= 0) { if (v.msg) arr[i] = v.msg; else arr.splice(i, 1); } }
    const r = S.rooms.get(v.room); if (r && r.last && r.last.id === v.id && v.msg) r.last = v.msg;
    bus.emit('msg_upd', v.room, v.id, v.msg || null);
  });
  on('blocked', v => { setBlocked(v.blocked); bus.emit('blocked'); });
  on('nick_status', v => bus.emit('nick_status', v));
  on('room_removed', v => { const r = S.rooms.get(v.room); S.rooms.delete(v.room); S.msgs.delete(v.room); bus.emit('room_removed', v.room, v.why, r); });
  on('friend', v => { if (!v.friend) return; const old = S.friends.get(v.friend.peer); S.friends.set(v.friend.peer, v.friend); S.nearby.delete(v.friend.peer); bus.emit('friend', v.friend, old, v); });
  on('friend_removed', v => { const f = S.friends.get(v.peer); S.friends.delete(v.peer); bus.emit('friend_removed', v.peer, f); });
  on('presence', v => {
    const was = S.online.has(v.peer);
    if (v.online) S.online.set(v.peer, { rtt: v.rtt, via: v.via }); else S.online.delete(v.peer);
    const f = S.friends.get(v.peer); if (f) { f.online = !!v.online; f.rtt = v.rtt; f.via = v.via || 'off'; }
    for (const r of S.rooms.values()) (r.members || []).forEach(m => { if (m.peer === v.peer) m.online = !!v.online; });
    bus.emit('presence', v.peer, !!v.online, was);
  });
  on('profile', v => {
    const f = S.friends.get(v.peer); if (f) f.profile = v.profile;
    for (const r of S.rooms.values()) (r.members || []).forEach(m => { if (m.peer === v.peer) { m.nick = v.profile.nick; m.ava = v.profile.ava; } });
    bus.emit('profile', v.peer, v.profile);
  });
  on('me', v => { S.me = v.me; bus.emit('me', v.me); });
  on('voice', v => {
    const m = (S.voices[v.room] = S.voices[v.room] || {});
    const had = !!m[v.peer];
    if (v.state) m[v.peer] = v.state; else delete m[v.peer];
    if (!Object.keys(m).length) delete S.voices[v.room];
    if (S.me && v.peer === S.me.peer) S.myVoice = v.state ? [v.room, v.state] : (S.myVoice && S.myVoice[0] === v.room ? null : S.myVoice);
    bus.emit('voice', v.room, v.peer, v.state, had);
  });
  on('ev', v => {
    if (v.kind === 'typing') { (S.typing[v.room] = S.typing[v.room] || new Map()).set(v.from, v.data && v.data.on === false ? 0 : Date.now()); bus.emit('typing', v.room); return; }
    bus.emit('ev', v); bus.emit('ev:' + v.kind, v);
  });
  on('rtc', v => bus.emit('rtc', v));
  on('net', v => { S.net = v.net; bus.emit('net', v.net); });
  on('nearby', v => { if (v.profile) S.nearby.set(v.peer, v.profile); else S.nearby.delete(v.peer); bus.emit('nearby'); });
  on('log', v => bus.emit('log', v.k, v.text));
  on('join_failed', v => bus.emit('join_failed', v));
  on('found', v => bus.emit('found', v));
}
