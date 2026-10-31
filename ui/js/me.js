// Панель «я» внизу слева (как в Discord): статус, мик и звук с меню устройств, избранное, настройки;
// счётчик «друзья в сети» сверху слева; авто-«отошёл» после 10 минут без активности.
import { $, $$, esc, ic, prefs, setPref, bus, plural } from './core.js';
import { api } from './api.js';
import { S, myId, myNick, avaOf, statusOf, shownOnline } from './state.js';
import { tmsg, tone, openW, fail, copyText } from './ui.js';
import { openMenu } from './menu.js';
import { V, toggleMic, toggleDeaf } from './voice.js';
import { FX, fxName } from './audio.js';
import { setTab } from './chat.js';
import { bump } from './motion.js';

export const STATUS = {
  '': { label: 'В сети', sub: '', cls: 'on' },
  away: { label: 'Отошёл', sub: 'друзья видят жёлтую луну', cls: 'away' },
  dnd: { label: 'Не беспокоить', sub: 'без звуков и всплывашек', cls: 'dnd' },
  inv: { label: 'Невидимка', sub: 'для всех не в сети, но всё работает', cls: 'inv' },
};
const meBtn = $('.js-mebtn'), micB = $('.js-memic'), deafB = $('.js-medeaf');

/* ---------- статус ---------- */
const myStatus = () => statusOf(myId());
async function setStatus(st, { dndMin = 0, auto = false, quiet = false } = {}) {
  if (!S.me) return;
  if (st === 'dnd') setPref('dnd', Date.now() + (dndMin > 0 ? dndMin : 525600 * 10) * 60000);
  else if (prefs.dnd) setPref('dnd', 0);
  setPref('autoAway', auto);
  if (myStatus() === st) { renderPanel(); return; }
  try { await api('profile_set', { status: st }); } catch (e) { fail(e); return; }
  bus.emit('dnd');
  if (!quiet) tmsg('ok', st === '' ? 'ты в сети' : st === 'dnd' ? (dndMin ? `не беспокоить · ${dndMin >= 60 ? dndMin / 60 + ' ч' : dndMin + ' мин'}` : 'не беспокоить, пока не выключишь') : st === 'away' ? 'статус: отошёл' : 'невидимка: для всех ты не в сети');
}
export function statusItems() {
  const cur = myStatus(), p = (S.me && S.me.profile) || {};
  const it = st => ({ dot: STATUS[st].cls, cur: cur === st, label: STATUS[st].label, sub: STATUS[st].sub, fn: () => setStatus(st) });
  const d = { ...it('dnd'), items: [[30, '30 минут'], [60, '1 час'], [480, '8 часов'], [1440, '24 часа'], [0, 'Пока не выключу']].map(([m, l]) => ({ icon: 'clock', label: l, fn: () => setStatus('dnd', { dndMin: m }) })) };
  delete d.fn;
  return [
    { head: p.nick || myNick(), sub: (STATUS[cur] || STATUS['']).label + (cur === 'dnd' && prefs.dnd && prefs.dnd - Date.now() < 86400000 * 2 ? ' · до ' + new Date(prefs.dnd).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''), img: avaOf(myId()) },
    '-',
    it(''), it('away'), d, it('inv'),
    '-',
    { icon: 'pencil', label: p.line ? 'Сменить статус' : 'Написать статус', sub: p.line ? '«' + p.line + '»' : 'чем занят — видят друзья', fn: () => openW('settings', { tab: 'acc', focus: '.js-statusinp' }) },
    p.line ? { icon: 'eraser', label: 'Убрать статус', fn: () => api('profile_set', { line: '' }).catch(fail) } : null,
    { icon: 'user-round', label: 'Мой профиль', fn: () => bus.emit('open-profile', myId()) },
    { icon: 'bookmark', label: 'Избранное', fn: () => openW('favs') },
    '-',
    { icon: 'at-sign', label: 'Копировать ник', fn: () => copyText('@' + myNick()).then(() => tmsg('ok', 'ник скопирован')) },
  ];
}
meBtn.addEventListener('click', e => { e.preventDefault(); openMenu(statusItems(), { el: meBtn }); });
// «не беспокоить» на время — само выключится
setInterval(() => { if (S.me && myStatus() === 'dnd' && prefs.dnd && prefs.dnd < Date.now()) setStatus('', { quiet: true }).then(() => tmsg('ok', '«не беспокоить» закончилось — ты снова в сети')); }, 20000);
// Настройки → Уведомления → «Не беспокоить» — тот же статус
bus.on('dnd-set', min => setStatus(min ? 'dnd' : '', { dndMin: min }));

/* ---------- авто-«отошёл»: 10 минут без мыши и клавы ---------- */
let lastAct = Date.now();
['pointerdown', 'keydown', 'pointermove', 'wheel'].forEach(t => addEventListener(t, () => {
  lastAct = Date.now();
  if (prefs.autoAway && myStatus() === 'away') setStatus('', { quiet: true });
}, { passive: true, capture: true }));
bus.on('talk', p => { if (p === myId()) lastAct = Date.now(); });
setInterval(() => {
  if (!S.me || prefs.awayAfter === 0 || myStatus() !== '' || (V.room && V.mic)) return;
  if (Date.now() - lastAct > (prefs.awayAfter || 10) * 60000) setStatus('away', { auto: true, quiet: true });
}, 30000);

/* ---------- мик и звук: работают и вне звонка (как в Discord — состояние запоминается) ---------- */
function micMenu() {
  const ns = prefs.nsMode || 'rnnoise', fx = prefs.fx || '';
  const nsIt = (v, l, sub) => ({ label: l, sub, check: ns === v, fn: () => { setPref('nsMode', v); tmsg('ok', v === 'off' ? 'шумодав выключен' : `шумодав: ${l.toLowerCase()}`); } });
  return [
    { head: 'Микрофон', sub: V.mic && !V.deaf ? 'включён' + (fx ? ' · эффект «' + fxName(fx) + '»' : '') : 'выключен' },
    { icon: 'mic', label: 'Устройство ввода', items: devItems('audioinput', 'micId') },
    { label: 'Громкость мика', icon: 'volume-2', range: { min: 0, max: 200, step: 5, value: prefs.micVol ?? 100, on: v => setPref('micVol', v) } },
    { icon: 'sparkles', label: 'Шумодав', sub: ns === 'rnnoise' ? 'умный' : ns === 'std' ? 'обычный' : 'выключен', items: [nsIt('rnnoise', 'Умный', 'нейросеть: режет клаву, кулер, собаку'), nsIt('std', 'Обычный', 'встроенный, помягче'), nsIt('off', 'Выкл', 'без обработки')] },
    { icon: 'audio-waveform', label: 'Эффект голоса', sub: fx ? fxName(fx) : 'без эффекта', items: [...FX.map(f => ({ img: `emoji/${f.e}.webp`, label: f.name, cur: fx === f.id, fn: () => { setPref('fx', f.id); tmsg('ok', f.id ? `эффект «${f.name}» — друзья слышат тебя так` : 'эффект выключен'); } })), '-', { icon: 'settings', label: 'Послушать и настроить', fn: () => openW('settings', { tab: 'audio', focus: '.js-fxrow' }) }] },
    '-',
    { icon: 'wand-sparkles', label: 'Меня плохо слышат', sub: 'мастер за минуту всё проверит', fn: () => openW('micfix') },
    { icon: 'settings', label: 'Настройки голоса', fn: () => openW('settings', { tab: 'audio' }) },
  ];
}
$('.js-mefav').addEventListener('click', () => openW('favs'));

/* ---------- отрисовка ---------- */
export function renderPanel() {
  const st = myStatus(), p = (S.me && S.me.profile) || {};
  const pd = $('.js-mepd'); pd.className = 'pd js-mepd ' + (STATUS[st] || STATUS['']).cls;
  const sub = $('.js-mestatus', meBtn);
  sub.textContent = p.game ? 'играет в ' + p.game : p.line || (st ? STATUS[st].label.toLowerCase() : 'в сети');
  meBtn.title = 'Статус: ' + (STATUS[st] || STATUS['']).label.toLowerCase() + ' · клик — сменить';
  const mOn = V.mic && !V.deaf;
  micB.innerHTML = ic(mOn ? 'mic' : 'mic-off'); micB.classList.toggle('off', !mOn); micB.setAttribute('aria-pressed', String(mOn));
  micB.title = (mOn ? 'Выключить мик' : 'Включить мик') + ' · Ctrl+M' + (prefs.fx ? ' · эффект «' + fxName(prefs.fx) + '»' : '');
  micB.classList.toggle('fx', !!prefs.fx);
  deafB.innerHTML = ic(V.deaf ? 'headphone-off' : 'headphones'); deafB.classList.toggle('off', V.deaf); deafB.setAttribute('aria-pressed', String(!V.deaf));
  deafB.title = (V.deaf ? 'Включить звук' : 'Выключить звук') + ' · Ctrl+D';
}
bus.on('me', renderPanel); bus.on('selfstate', renderPanel); bus.on('voice', renderPanel); bus.on('pref', k => { if (k === 'fx') renderPanel(); });

/* ---------- сверху слева: зелёная точка и «в сети 1/4» ---------- */
const onl = $('.js-onl');
export function renderOnline() {
  const fr = [...S.friends.values()].filter(f => f.state === 'friend'), on = fr.filter(f => shownOnline(f.peer)).length;
  const d = $('.js-onld'), n = $('.js-onln'), prev = n.textContent;
  if (!S.link) { d.className = 'pd dnd js-onld'; n.textContent = 'нет связи'; onl.title = 'нет связи с ядром Hunty — переподключаюсь'; return; }
  d.className = 'pd js-onld ' + (on ? 'on' : 'off');
  n.textContent = fr.length ? `${on}/${fr.length}` : '0';
  onl.title = fr.length ? `друзей в сети: ${on} из ${fr.length} · клик — список` : 'друзей пока нет — добавь кого-нибудь';
  onl.setAttribute('aria-label', onl.title);
  if (prev && prev !== n.textContent && prev !== '…') bump(n, 1.25);
}
onl.addEventListener('click', () => { setTab('friends'); bump(onl, 1.06); });
['presence', 'net', 'friend', 'friend_removed', 'link', 'profile', 'me'].forEach(e => bus.on(e, () => setTimeout(renderOnline)));
setInterval(renderOnline, 15000);
