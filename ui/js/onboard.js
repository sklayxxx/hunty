// Первый запуск: ник + моб от системы, без пароля (ключ создаётся на компе) — или восстановление из бэкапа.
// Потом это же окно — «Сменить ник и моба».
import { $, esc, bus, sleep } from './core.js';
import { api } from './api.js';
import { S, nickOf } from './state.js';
import { avaURL, mobName, randomMob, mobKey } from './mobs.js';
import { OPEN, CLOSE, openW, closeW, tmsg, tone, TONES, fail, glitch, toast, winOpen } from './ui.js';
import { spin, pickBackup, renderMe } from './settings.js';

const w = $('.win[data-win="onboard"]');
const nick = $('.js-onick'), ncheck = $('.js-ncheck'), oava = $('.js-oava'), omob = $('.js-omob'), go = $('.js-ogo');
const RX = /^[a-z0-9._-]{2,16}$/;
let ava = '', edit = false, done = null;

function setAva(a) { ava = a; oava.src = avaURL(a); omob.textContent = mobName(a); nick.placeholder = (mobKey(a) || 'steve') + '_' + (10 + Math.floor(Math.random() * 89)); }
/* ник уникальный: ядро спрашивает друзей, локалку и DHT, не занят ли он (серверов нет — проверка «по-честному», без гарантии) */
const NS = {
  checking: ['проверяю, свободен ли ник…', 'wait'],
  free: ['✓ ник свободен · друзья найдут тебя по нему', 'ok'],
  taken: ['✗ ник уже занят — придумай другой', 'bad'],
  maybe: ['✗ похоже, ник занят (хозяин сейчас не в сети) — лучше другой', 'bad'],
  wait: ['сеть ещё подключается — проверю ник, как только смогу', 'wait'],
  nodht: ['поиск по нику выключен — свободен ли ник, не проверить', ''],
  mine: ['это твой ник сейчас', 'ok'],
};
const BUSY = new Set(['taken', 'maybe']);
let ns = { nick: '', state: '' }, nT = 0;
const curNick = () => (S.me && S.me.profile && S.me.profile.nick) || '';
function check() {
  const raw = nick.value, v = raw.trim().replace(/^@/, '').toLowerCase().replace(/\s+/g, '_');
  if (v !== raw) { const p = nick.selectionStart; nick.value = v; try { nick.setSelectionRange(p, p); } catch (_) {} }
  let ok = false, t = 'латиница, цифры, точка, _ и - · от 2 до 16', cls = '';
  if (v && !/^[a-z0-9._-]*$/.test(v)) { t = 'только латиница, цифры, точка, _ и -'; cls = 'bad'; }
  else if (v.length === 1) { t = 'ещё хотя бы символ'; cls = 'bad'; }
  else if (RX.test(v)) {
    ok = true;
    if (edit && v === curNick()) [t, cls] = NS.mine;
    else if (ns.nick === v && NS[ns.state]) [t, cls] = NS[ns.state];
    else { [t, cls] = NS.checking; askNick(v); }
    if (BUSY.has(ns.nick === v ? ns.state : '')) ok = false;
  }
  ncheck.textContent = t; ncheck.className = 'ncheck js-ncheck ' + cls;
  go.disabled = !ok && !(edit && !v);
  return ok ? v : '';
}
function askNick(v, delay = 350) {
  clearTimeout(nT);
  nT = setTimeout(async () => {
    if (winOpen() !== 'onboard' || nickVal() !== v) return;
    try { const r = await api('nick_check', { nick: v }); setNs(v, r.state || ''); } catch (_) { setNs(v, 'wait'); }
  }, delay);
}
const nickVal = () => nick.value.trim().replace(/^@/, '').toLowerCase();
function setNs(v, st) {
  ns = { nick: v, state: st };
  if (nickVal() === v) check();
  if ((st === 'checking' || st === 'wait') && winOpen() === 'onboard') askNick(v, 3000); // ждём ответа сети
}
bus.on('nick_status', v => {
  if (v && v.nick && winOpen() === 'onboard' && v.nick === nickVal() && !v.own) setNs(v.nick, v.state);
  // после регистрации выяснилось, что ник занял кто-то раньше
  if (v && v.own && v.state === 'taken' && v.nick === curNick()) {
    toast({ icon: 'at-sign', title: `Ник @${v.nick} уже занят`, sub: 'кто-то взял его раньше тебя — смени, чтобы друзья не добавили не того', actions: [{ label: 'Сменить ник', cls: 'cbtn', fn: () => openW('onboard', { edit: true }) }, { label: 'Потом', cls: 'gbtn' }] });
  }
});
nick.addEventListener('input', check);
nick.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
$('.js-oroll').addEventListener('click', async e => {
  const b = e.currentTarget; if (b.disabled) return; b.disabled = true;
  const next = randomMob(ava); await spin([oava], next, 12); setAva(next); tone(TONES.ok, .6); b.disabled = false;
});
$('.js-orestore').addEventListener('click', () => pickBackup());
go.addEventListener('click', submit);
async function submit() {
  let v = check(); if (go.disabled) return;
  go.disabled = true;
  // проверка ещё идёт — подождём её немного (до 8 сек), потом пускаем: доп. проверка будет в фоне
  if (v && !(edit && v === curNick()) && ns.nick === v && ns.state === 'checking') {
    const old = go.textContent; go.textContent = 'Проверяю ник…';
    for (let i = 0; i < 8 && ns.nick === v && ns.state === 'checking'; i++) {
      await sleep(1000);
      try { const r = await api('nick_check', { nick: v }); ns = { nick: v, state: r.state || '' }; } catch (_) { break; }
    }
    go.textContent = old;
    v = check(); if (go.disabled || !v) { go.disabled = BUSY.has(ns.state); return; }
    go.disabled = true;
  }
  try {
    if (edit) {
      const p = {}; if (v && v !== S.me.profile.nick) p.nick = v; if (ava !== S.me.profile.ava) p.ava = ava;
      if (Object.keys(p).length) { await api('profile_set', p); tmsg('ok', p.nick ? `теперь ты @${p.nick} · друзья увидят сразу` : `моб поменян: ${mobName(ava)}`); tone(TONES.ok); }
      closeW(true);
    } else {
      const me = await api('onboard', { nick: v, ava });
      S.me = me; w.dataset.lock = ''; closeW(true); glitch(); tone(TONES.friend);
      tmsg('ok', `привет, @${v}! ключ создан у тебя на компе · серверов: 0`);
      renderMe(); bus.emit('me', me);
      const d = done; done = null; d && d(me);
    }
  } catch (e) { fail(e); }
  go.disabled = false; check();
}
OPEN.onboard = (_, o = {}) => {
  edit = !!o.edit;
  $('.js-otitle').textContent = edit ? 'Ник и моб' : 'Создать акк';
  $('.js-osub').textContent = edit ? 'друзья увидят изменения сразу' : 'первый запуск · 10 секунд · без пароля';
  $('.js-oclose').hidden = !edit; $('.js-orestore').hidden = edit;
  go.textContent = edit ? 'Сохранить' : 'Поехали';
  w.dataset.lock = edit ? '' : '1';
  const p = (S.me && S.me.profile) || {};
  nick.value = edit ? p.nick || '' : '';
  ns = { nick: '', state: '' };
  setAva(edit && p.ava ? p.ava : randomMob());
  check();
};
CLOSE.onboard = () => {};
/** первый запуск: ждёт, пока человек создаст акк */
export function onboard() { return new Promise(res => { done = res; openW('onboard', {}); }); }
