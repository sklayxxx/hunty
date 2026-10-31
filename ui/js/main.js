// Точка входа: связь с ядром, загрузочный экран, регистрация, первый рендер, мелкие индикаторы,
// сторож тормозов и ошибок (→ журнал и лог ядра), пасхалки
import { $, $$, R, esc, ic, prefs, setPref, bus, reduce, sleep, short, plural } from './core.js';
import './menu.js';
import * as API from './api.js';
import { S, load, wire, myId, myNick, nickOf } from './state.js';
import { app, tmsg, tone, TONES, toast, closeToast, openW, closeW, fit, glitch, winOpen } from './ui.js';
import { renderLists, renderWs, header, openChat, showEmpty, setTab, sorted } from './chat.js';
import { refreshCode, getMyCode } from './friends.js';
import './groups.js';
import { layout, V } from './voice.js';
import './demo.js';
import { initLayout } from './layout.js';
import { renderMe, syncPrefs, checkUpdate } from './settings.js';
import { onboard } from './onboard.js';
import { steveAPI } from './afk.js';
import { egg, eggsText } from './eggs.js';
import { mobURL, mobName } from './mobs.js';

const QS = new URLSearchParams(location.search);
const OK = `<span class="ok">${ic('check')}</span>`, WR = `<span class="wr">${ic('info')}</span>`;

/* ---------- загрузочный экран: короткий лог реального запуска ---------- */
function bootScreen() {
  if (!prefs.boot || reduce || QS.has('noboot')) return null;
  const b = document.createElement('div'); b.className = 'boot'; b.setAttribute('role', 'status');
  const logo = $('.js-logo svg'); b.innerHTML = `<div class="brand">${logo ? logo.outerHTML : ''}Hunty</div><pre></pre><div class="skip">клик — пропустить</div>`;
  document.body.appendChild(b);
  const pre = $('pre', b); let q = Promise.resolve(), skip = false, gone = false;
  b.addEventListener('click', () => { skip = true; hide(); });
  const line = html => { q = q.then(async () => { if (gone) return; pre.insertAdjacentHTML('beforeend', html + '\n'); if (!skip) await sleep(110); }); return q; };
  function hide() { if (gone) return; gone = true; b.classList.add('gone'); setTimeout(() => b.remove(), 500); }
  return { line, done: async () => { await q; if (!skip) await sleep(380); hide(); }, hide, el: b };
}

/* ---------- старт ---------- */
async function connect(boot) {
  for (let i = 0; ; i++) {
    try { await API.init(); return; }
    catch (e) {
      if (i === 0) {
        if (boot) boot.line(`${WR}нет связи с ядром: ${esc(e.message)}`);
        tmsg('err', API.inTauri ? 'ядро не запустилось' : 'нет связи с ядром — запусти hunty-node (ws ' + (QS.get('ws') || '7457') + ')');
      }
      await sleep(1500);
    }
  }
}
async function start() {
  initLayout(); syncPrefs(); fit();
  const boot = bootScreen();
  wire();
  if (boot) boot.line(`<span class="dm">hunty · p2p · серверов нет</span>`);
  await connect(boot);
  let st = await API.api('state');
  load(st);
  if (boot) boot.line(`${OK}ядро v${esc(S.version)} · libp2p: QUIC + TCP, Noise, DHT, relay`);
  if (!st.me.onboarded) {
    if (boot) { boot.line(`${WR}акка ещё нет — создаю ключ у тебя на компе`); await boot.done(); }
    await onboard();
    st = await API.api('state'); load(st);
  } else if (boot) {
    const fr = [...S.friends.values()].filter(f => f.state === 'friend'), on = fr.filter(f => S.online.has(f.peer)).length;
    boot.line(`${OK}ключ акка: @${esc(myNick())} (Ed25519, хранится только тут)`);
    boot.line(`${OK}система выдала моба: ${esc(mobName(S.me.profile.ava))}`);
    boot.line(`${OK}друзей: ${fr.length} · в сети: ${on}`);
    boot.line(`${OK}чатов: ${S.rooms.size} · история у тебя и у друзей`);
    boot.line(S.net && S.net.dht && S.net.dht.on ? `${OK}DHT (IPFS): ${S.net.dht.ready ? 'подключён' : 'подключаюсь…'}` : `${WR}DHT выключен — друзей найду в локалке или по адресу`);
    boot.line(`${WR}Центральный сервер не найден. Так и задумано.`);
    boot.line(`<span class="dm">открываю…</span>`);
  }
  render();
  if (boot) boot.done();
  tmsg('ok', `ты @${myNick()} · ${S.online.size ? 'в сети ' + S.online.size : 'друзья найдутся сами — через DHT или локалку'}`);
  if (Date.now() - (prefs.updT || 0) > 864e5) setTimeout(() => { setPref('updT', Date.now()); checkUpdate(true); }, 9000);
}
function render() {
  // окно перезагрузилось, а ядро ещё числит нас в голосе — WebRTC-соединений уже нет, выходим начисто
  if (S.myVoice && !V.room) { S.myVoice = null; API.api('voice_leave').catch(() => {}); }
  renderMe(); renderLists(); renderWs(); setTab('chats');
  const last = prefs.lastChat && S.rooms.has(prefs.lastChat) ? prefs.lastChat : (sorted()[0] || {}).id;
  if (last) openChat(last); else showEmpty();
  layout(); ping(); title(); refreshCode().catch(() => {});
}

/* ---------- мелочи в шапке ---------- */
function ping() {
  const el = $('.js-ping'), d = $('.js-p2pd'), box = $('.js-p2p');
  const rt = [...S.online.entries()].filter(([p]) => S.friends.has(p)).map(([, o]) => o.rtt).filter(x => x != null);
  let cls = 'on';
  if (!S.link) { el.textContent = 'нет ядра'; cls = 'dnd'; }
  else if (!rt.length) { el.textContent = S.online.size ? 'в сети' : 'один'; cls = S.online.size ? 'on' : 'away'; }
  else { const m = Math.round(rt.reduce((a, b) => a + b, 0) / rt.length); el.textContent = m + 'ms'; cls = m < 150 ? 'on' : 'away'; }
  d.className = 'pd js-p2pd ' + cls;
  const n = S.online.size; box.title = `Серверов нет: всё напрямую · в сети ${n} ${plural(n, 'друг', 'друга', 'друзей')}`;
}
['presence', 'net', 'friend', 'friend_removed'].forEach(e => bus.on(e, ping));
setInterval(ping, 5000);
function title() {
  let n = 0; for (const r of S.rooms.values()) if (!r.muted) n += r.unread || 0;
  document.title = n ? `(${n}) Hunty` : 'Hunty';
}
['msg', 'msgs', 'open', 'room', 'room_removed'].forEach(e => bus.on(e, () => setTimeout(title, 350)));
// новый чат (друг принял заявку, позвали в группу) — открываю, если сейчас ничего не открыто
bus.on('room', (r, old) => { if (!old && !S.cur && r && !r.pending) openChat(r.id); });

/* логи ядра → журнал (Настройки → Сеть), всплывашками не мешают */
bus.on('log', (k, text) => tmsg(k === 'err' ? 'err' : k === 'warn' ? 'warn' : 'ok', text, true));

/* ---------- внешний вид: живой фон, лёгкий режим; свёрнуто — анимации на паузе ---------- */
function look() { R.classList.toggle('bglive', !!prefs.liveBg && !reduce && !prefs.lite); R.classList.toggle('lite', !!prefs.lite); }
look();
bus.on('pref', k => { if (k === 'liveBg' || k === 'lite') look(); });
const vis = () => R.classList.toggle('hid', document.hidden);
document.addEventListener('visibilitychange', vis); vis();

/* ---------- сторож: ошибки и долгие подвисания → журнал и лог ядра (hunty.log), чтобы потом разобраться ---------- */
let logN = 0, logT0 = 0;
function uiLog(k, text) {
  tmsg('err', text, true);
  const now = Date.now(); if (now - logT0 > 60000) { logT0 = now; logN = 0; }
  if (++logN <= 20) API.api('log_ui', { k, text: String(text).slice(0, 2000) }).catch(() => {});
}
addEventListener('error', e => { if (e && e.message) uiLog('error', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno || 0}`); });
addEventListener('unhandledrejection', e => { const r = e.reason; console.warn('unhandled', r); uiLog('promise', (r && (r.stack || r.message)) || String(r)); });
let slow = [], slowAsked = false;
try {
  new PerformanceObserver(list => {
    for (const t of list.getEntries()) {
      if (t.duration < 200) continue;
      if (t.duration >= 1000) uiLog('longtask', `интерфейс подвис на ${Math.round(t.duration)} мс`);
      const now = performance.now(); slow = slow.filter(x => now - x < 60000); slow.push(now);
      if (slow.length >= 6 && !slowAsked && !prefs.lite && !document.hidden && performance.now() > 20000) {
        slowAsked = true;
        toast({ icon: 'zap', title: 'Hunty подтормаживает', sub: 'включи лёгкий режим — без стекла, размытия и анимаций. Вернуть можно в Настройки → Внешний вид', dur: 20000,
          actions: [{ label: 'Включить', cls: 'cbtn', fn: () => { setPref('lite', true); tmsg('ok', 'лёгкий режим включён'); } }, { label: 'Не надо', cls: 'gbtn' }] });
      }
    }
  }).observe({ type: 'longtask', buffered: false });
} catch (_) {}

/* ---------- связь с ядром ---------- */
let lost = null, lostT = 0;
bus.on('link', on => {
  S.link = on; ping();
  if (!on && !S.quitting) {
    clearTimeout(lostT);
    lostT = setTimeout(() => {
      if (S.link || lost) return;
      lost = document.createElement('div'); lost.className = 'linklost glass'; lost.setAttribute('role', 'alert');
      lost.innerHTML = `${ic('radio-tower')}<span><b>нет связи с ядром</b><small>${API.inTauri ? 'перезапускаю…' : 'жду hunty-node — переподключаюсь сам'}</small></span>`;
      document.body.appendChild(lost);
    }, 1200);
  }
});
bus.on('relink', () => { clearTimeout(lostT); if (lost) { lost.remove(); lost = null; } location.reload(); });
bus.on('need-restart', () => toast({ icon: 'rotate-ccw', title: 'Перезапусти ядро', sub: 'в браузерном режиме перезапуск делает hunty-node — запусти его заново', dur: 9000 }));
bus.on('quitting', () => { S.quitting = true; const b = document.createElement('div'); b.className = 'boot'; b.innerHTML = `<div class="brand">${($('.js-logo svg') || {}).outerHTML || ''}Hunty</div><pre>${OK}история сохранена\n${OK}Hunty выключен — друзья видят тебя не в сети\n<span class="dm">можно закрыть вкладку · запустишь Hunty снова — эта страница оживёт сама</span></pre>`; document.body.appendChild(b); });
// браузерный режим: разрешение на системные уведомления — по первому клику после входа (браузеры требуют жест)
if (!API.inTauri && 'Notification' in window && Notification.permission === 'default') {
  const ask = () => { if (!S.me || !S.me.onboarded) return; removeEventListener('pointerdown', ask, true); try { Notification.requestPermission().catch(() => {}); } catch (_) {} };
  addEventListener('pointerdown', ask, true);
}
bus.on('restoring', () => { const b = document.createElement('div'); b.className = 'boot'; b.innerHTML = `<div class="brand">${($('.js-logo svg') || {}).outerHTML || ''}Hunty</div><pre>${OK}бэкап принят\n${OK}перезапускаю ядро с твоим ключом…</pre>`; document.body.appendChild(b); });

/* ---------- AFK: мой голос — тоже активность ---------- */
bus.on('talk', p => { if (p === myId() && steveAPI) steveAPI.wake(); });

/* ---------- пасхалки ---------- */
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
let kq = [];
addEventListener('keydown', e => {
  kq.push(e.code); if (kq.length > KONAMI.length) kq.shift();
  if (kq.join() !== KONAMI.join()) return; kq = [];
  egg('konami'); glitch(); tone([[220, .2], [180, .3]], .8);
  tmsg('ping', 'ссссссс… все стали криперами на 12 секунд');
  const cr = mobURL('creeper'), imgs = $$('img.ava, .js-mav img, .theads img, .wav img, .mi-dm img, .avbig');
  imgs.forEach(i => { i.dataset.konami = i.src; i.src = cr; });
  setTimeout(() => imgs.forEach(i => { if (i.dataset.konami) { i.src = i.dataset.konami; delete i.dataset.konami; } }), 12000);
});
let lc = 0, lcT = 0;
$('.js-logo').addEventListener('click', () => {
  clearTimeout(lcT); lcT = setTimeout(() => { lc = 0; }, 2500);
  if (++lc >= 7) { lc = 0; egg('logo'); glitch(); setTimeout(glitch, 220); tmsg('ping', 'hunty: тут ничего нет. честно. ну почти'); }
});
let gc = 0, gcT = 0;
document.addEventListener('click', e => {
  const m = e.target.closest && e.target.closest('.js-ncmob, .about .big'); if (!m) return;
  clearTimeout(gcT); gcT = setTimeout(() => { gc = 0; }, 2000);
  if (++gc >= 5) {
    gc = 0; egg('ghast'); tone([[880, .3], [660, .4], [440, .6]], .6);
    tmsg('ping', 'гаст заплакал и улетел. зачем ты так');
    const im = $('.js-ncmob img'); if (im) { const o = im.src; im.src = mobURL('ghast'); setTimeout(() => { im.src = o; }, 4000); }
  }
});
eggsText();

start().catch(e => { console.error(e); tmsg('err', 'запуск сломался: ' + e.message); });
