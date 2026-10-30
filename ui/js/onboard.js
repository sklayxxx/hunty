// Первый запуск: ник + моб от системы, без пароля (ключ создаётся на компе) — или восстановление из бэкапа.
// Потом это же окно — «Сменить ник и моба».
import { $, esc, bus } from './core.js';
import { api } from './api.js';
import { S } from './state.js';
import { avaURL, mobName, randomMob, mobKey } from './mobs.js';
import { OPEN, CLOSE, openW, closeW, tmsg, tone, TONES, fail, glitch } from './ui.js';
import { spin, pickBackup, renderMe } from './settings.js';

const w = $('.win[data-win="onboard"]');
const nick = $('.js-onick'), ncheck = $('.js-ncheck'), oava = $('.js-oava'), omob = $('.js-omob'), go = $('.js-ogo');
const RX = /^[a-z0-9._-]{2,16}$/;
let ava = '', edit = false, done = null;

function setAva(a) { ava = a; oava.src = avaURL(a); omob.textContent = mobName(a); nick.placeholder = (mobKey(a) || 'steve') + '_' + (10 + Math.floor(Math.random() * 89)); }
function check() {
  const raw = nick.value, v = raw.trim().replace(/^@/, '').toLowerCase().replace(/\s+/g, '_');
  if (v !== raw) { const p = nick.selectionStart; nick.value = v; try { nick.setSelectionRange(p, p); } catch (_) {} }
  let ok = false, t = 'латиница, цифры, точка, _ и - · от 2 до 16', cls = '';
  if (v && !/^[a-z0-9._-]*$/.test(v)) { t = 'только латиница, цифры, точка, _ и -'; cls = 'bad'; }
  else if (v.length === 1) { t = 'ещё хотя бы символ'; cls = 'bad'; }
  else if (RX.test(v)) { ok = true; cls = 'ok'; t = edit && S.me && S.me.profile && v === S.me.profile.nick ? 'это твой ник сейчас' : '✓ норм ник · друзья найдут тебя по нему'; }
  ncheck.textContent = t; ncheck.className = 'ncheck js-ncheck ' + cls;
  go.disabled = !ok && !(edit && !v);
  return ok ? v : '';
}
nick.addEventListener('input', check);
nick.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
$('.js-oroll').addEventListener('click', async e => {
  const b = e.currentTarget; if (b.disabled) return; b.disabled = true;
  const next = randomMob(ava); await spin([oava], next, 12); setAva(next); tone(TONES.ok, .6); b.disabled = false;
});
$('.js-orestore').addEventListener('click', () => pickBackup());
go.addEventListener('click', submit);
async function submit() {
  const v = check(); if (go.disabled) return;
  go.disabled = true;
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
  setAva(edit && p.ava ? p.ava : randomMob());
  check();
};
CLOSE.onboard = () => {};
/** первый запуск: ждёт, пока человек создаст акк */
export function onboard() { return new Promise(res => { done = res; openW('onboard', {}); }); }
