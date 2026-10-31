// Меню человека (правый клик по нику, аве, строке друга или участнику голоса):
// громкость 0–200% и «заглушить» только у тебя, профиль, лс, звонок, друзья, блок
import { prefs, setPref, bus, short } from './core.js';
import { S, myId, nickOf, avaOf, isOnline, shownOnline, statusOf, isBlocked, voiceIn, roomName } from './state.js';
import { tmsg, copyText, openW } from './ui.js';

export const volOf = p => (prefs.vol || {})[p] ?? 100;
export function setVol(p, v) {
  const o = Object.assign({}, prefs.vol); if (+v === 100) delete o[p]; else o[p] = +v;
  setPref('vol', o); bus.emit('peer-vol', p);
}
export const mutedFor = p => !!(prefs.mute || {})[p];
export function setMute(p, on) {
  const o = Object.assign({}, prefs.mute); if (on) o[p] = 1; else delete o[p];
  setPref('mute', o); bus.emit('peer-vol', p);
  tmsg('ok', on ? `${nickOf(p)} заглушён — только для тебя` : `${nickOf(p)} снова слышно`);
}
const voiceOf = p => Object.keys(S.voices).find(k => voiceIn(k)[p]);

/** пункты меню; extra — свои пункты после основных (голос, админка группы) */
export function personItems(p, { extra = [], sub = '' } = {}) {
  if (!p) return null;
  const copyNick = { icon: 'at-sign', label: 'Копировать ник', fn: () => copyText('@' + nickOf(p)).then(() => tmsg('ok', 'ник скопирован')) };
  const copyId = { icon: 'copy', label: 'Копировать ID', fn: () => copyText(p).then(() => tmsg('ok', 'ID скопирован')) };
  if (p === myId()) return [
    { head: nickOf(p), sub: sub || 'это ты', img: avaOf(p) },
    ...extra,
    { icon: 'user-round', label: 'Мой профиль', fn: () => bus.emit('open-profile', p) },
    { icon: 'pencil', label: 'Настроить профиль', fn: () => openW('settings', { tab: 'acc' }) },
    { icon: 'sliders-horizontal', label: 'Звук и мик', fn: () => openW('settings', { tab: 'audio' }) },
    '-', copyNick, copyId,
  ];
  const f = S.friends.get(p), st = f && f.state, fr = st === 'friend', bl = isBlocked(p), on = isOnline(p), vr = voiceOf(p);
  const sl = { away: 'отошёл', dnd: 'не беспокоить' }[statusOf(p)];
  return [
    { head: nickOf(p), sub: sub || (bl ? 'заблокирован' : vr ? 'в голосе · ' + roomName(vr) : shownOnline(p) ? sl || 'в сети' : 'не в сети'), img: avaOf(p) },
    { icon: 'user-round', label: 'Профиль', fn: () => bus.emit('open-profile', p) },
    fr ? { icon: 'message-circle', label: 'Написать', disabled: bl, fn: () => bus.emit('dm', p) } : null,
    fr ? { icon: 'phone', label: 'Позвонить', disabled: bl, fn: () => bus.emit('dm-call', p) } : null,
    fr && on && !bl ? { icon: 'hand', label: 'Пнуть', sub: 'у друга прилетит кроссовок', fn: () => bus.emit('nudge', p) } : null,
    !fr && !bl && st !== 'outgoing' ? { icon: 'user-round-plus', label: st === 'incoming' ? 'Принять заявку' : 'Добавить в друзья', fn: () => bus.emit(st === 'incoming' ? 'friend-accept' : 'friend-add', p) } : null,
    st === 'outgoing' ? { icon: 'x', label: 'Отменить заявку', fn: () => bus.emit('friend-cancel', p) } : null,
    ...(extra.length ? ['-', ...extra] : []),
    '-',
    { range: { min: 0, max: 200, step: 5, value: volOf(p), on: v => setVol(p, v) }, label: 'Громкость', icon: 'volume-2' },
    { label: 'Заглушить', check: mutedFor(p), fn: () => setMute(p, !mutedFor(p)) },
    '-', copyNick, copyId, '-',
    fr ? { icon: 'user-x', label: 'Удалить из друзей', danger: true, fn: () => bus.emit('unfriend', p) } : null,
    { icon: bl ? 'shield-off' : 'ban', label: bl ? 'Разблокировать' : 'Заблокировать', danger: !bl, fn: () => bus.emit(bl ? 'unblock' : 'block', p) },
  ];
}
