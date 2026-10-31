// Настройки: вкладки, привязка контролов к prefs/конфигу ядра, устройства, проверка мика, акк, бэкап,
// хранилище, блок-лист, сеть и журнал, обновления
import { $, $$, R, esc, ic, short, clamp, prefs, setPref, bus, sleep, size, plural, pad } from './core.js';
import { api, inTauri, saveFile, restart, openUrl, quitNode, reveal } from './api.js';
import { S, myId, myNick, roomName, avaOf } from './state.js';
import { avaURL, mobName, randomMob, MOBKEYS } from './mobs.js';
import { app, tmsg, tone, TONES, toast, fail, openW, closeW, OPEN, CLOSE, segSet, rgv, actx, ttsVoices, speak, fit, winOpen, JOURNAL, copyText } from './ui.js';
import { V, camStart, camStop } from './voice.js';
import { refreshCode, unblock } from './friends.js';
import { clearRoom } from './chat.js';
import { eggsText } from './eggs.js';
import { getMic, makeGate, gateSet, toDb } from './audio.js';

/** репозиторий для проверки обновлений (GitHub Releases) */
// репозиторий на GitHub, откуда брать обновления: CI подставляет сам (release.yml), руками — 'ник/hunty'
export const REPO = '';
const sw = $('.win[data-win="settings"]');

/* ---------- вкладки ---------- */
let tab = 'acc';
function setTab(t) {
  if (!$(`.spage[data-page="${t}"]`, sw)) t = 'acc';
  tab = t;
  $$('.snav [role="tab"]', sw).forEach(b => { const on = b.dataset.tab === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  $$('.spage', sw).forEach(p => p.classList.toggle('on', p.dataset.page === t));
  if (t !== 'audio') stopMicTest();
  if (t !== 'video') stopCam();
  if (t === 'audio' || t === 'video') devices();
  if (t === 'net') { renderNet(); netPoll(); renderJournal(); }
  if (t === 'storage') renderStorage();
  if (t === 'priv') renderBlocked();
  if (t === 'notif') voicesList();
  if (t === 'about') about();
  if (t === 'acc') { renderMe(); refreshCode(); }
}
$('.js-snav', sw).addEventListener('click', e => { const b = e.target.closest('[role="tab"]'); if (b) setTab(b.dataset.tab); });
$('.js-snav', sw).addEventListener('keydown', e => {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const tabs = $$('[role="tab"]', sw), i = tabs.findIndex(b => b.dataset.tab === tab), d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
  const n = tabs[(i + d + tabs.length) % tabs.length]; e.preventDefault(); setTab(n.dataset.tab); n.focus();
});
OPEN.settings = (_, o) => { syncPrefs(); syncCfg(); setTab(o.tab || tab); eggsText(); };
CLOSE.settings = () => { stopMicTest(); stopCam(); clearInterval(netIv); };

/* ---------- контролы ↔ prefs ---------- */
const NUM = new Set(['micVol', 'outVol', 'ptt', 'bitrate', 'camRes', 'shareRes', 'shareFps', 'pinTtl', 'glassA', 'scale', 'notifVol', 'gateDb']);
const val = (k, v) => NUM.has(k) ? +v : v;
export function syncPrefs() {
  $$('[data-pref]', sw).forEach(el => {
    const k = el.dataset.pref, v = prefs[k];
    if (el.classList.contains('seg')) segSet(el, String(v));
    else if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'range') { el.value = v; rgv(el); }
    else if (el.tagName === 'SELECT') { el.value = v ?? ''; if (el.value !== String(v ?? '')) el.value = ''; }
  });
  dndSync(); gateRow();
  $('.js-camv').classList.toggle('mir', prefs.camMirror !== false);
}
const gateRow = () => { $('.js-gaterow', sw).hidden = prefs.gate !== 'manual'; };
sw.addEventListener('click', e => {
  const b = e.target.closest('.seg[data-pref] button'); if (!b) return;
  const k = b.parentElement.dataset.pref; setPref(k, val(k, b.dataset.v));
});
sw.addEventListener('change', e => {
  const el = e.target; const k = el.dataset && el.dataset.pref; if (!k) return;
  if (el.type === 'checkbox') setPref(k, el.checked);
  else setPref(k, val(k, el.value));
});
sw.addEventListener('input', e => { const el = e.target; if (el.type === 'range' && el.dataset.pref) setPref(el.dataset.pref, +el.value); });
bus.on('pref', (k, v) => {
  if (k === 'scale') fit();
  if (k === 'camMirror') $('.js-camv').classList.toggle('mir', v !== false);
  if ((k === 'camId' || k === 'camRes') && V.cam) { camStop(true); camStart(); }
  if ((k === 'camId' || k === 'camRes') && cam) { stopCam(); camTest(); }
  if (['micId', 'ns', 'ec', 'agc'].includes(k) && mt) { stopMicTest(); micTest(); }
  if (k === 'gate') gateRow();
  if ((k === 'gate' || k === 'gateDb') && mt && mt.gate) gateSet(mt.gate);
  if (k === 'voiceName' || k === 'say') { if (prefs.say) speak('Привет, это голос уведомлений', true); }
});

/* «не беспокоить» — до какого времени */
const dndSeg = $('.js-dnd');
function dndSync() { const left = prefs.dnd && prefs.dnd > Date.now() ? (prefs.dnd - Date.now()) / 60000 : 0; segSet(dndSeg, left <= 0 ? '0' : left > 60 ? '480' : '60'); }
dndSeg.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const m = +b.dataset.v;
  setPref('dnd', m ? Date.now() + m * 60000 : 0);
  tmsg('ok', m ? `не беспокоить ${m >= 480 ? '8 часов' : 'час'} · звонки всё равно слышно` : 'уведомления снова включены');
  bus.emit('dnd');
});

/* ---------- конфиг ядра: сеть и приватность (нужен перезапуск) ---------- */
function syncCfg() {
  $$('[data-cfg]', sw).forEach(el => { el.checked = !!S.config[el.dataset.cfg]; });
  $('.js-port').value = S.config.port || 0;
}
let rsToast = null;
async function setCfg(patch) {
  try {
    const r = await api('config_set', patch);
    if (r && r.config) S.config = r.config;
    if (r && r.restart) askRestart();
  } catch (e) { fail(e); syncCfg(); }
}
export function askRestart(why = 'Сетевые настройки применятся после перезапуска') {
  if (rsToast && rsToast.isConnected) return;
  rsToast = toast({ icon: 'rotate-ccw', title: 'Нужен перезапуск', sub: why, actions: [
    { label: 'Перезапустить', cls: 'cbtn', fn: () => restart() }, { label: 'Потом', cls: 'gbtn' }] });
}
sw.addEventListener('change', e => { const el = e.target; if (el.dataset && el.dataset.cfg) setCfg({ [el.dataset.cfg]: el.checked }); });
$('.js-port').addEventListener('change', e => { const p = clamp(Math.round(+e.target.value || 0), 0, 65535); e.target.value = p; setCfg({ port: p }); });

/* ---------- устройства ---------- */
const DLBL = { audioinput: 'Микрофон', audiooutput: 'Выход', videoinput: 'Камера' };
export async function devices() {
  let list = [];
  try { list = await navigator.mediaDevices.enumerateDevices(); } catch (_) {}
  $$('.js-dev').forEach(sel => {
    const kind = sel.dataset.kind, k = sel.dataset.pref;
    const ds = list.filter(d => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
    sel.innerHTML = `<option value="">По умолчанию (как в системе)</option>` + ds.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || DLBL[kind] + ' ' + (i + 1))}</option>`).join('');
    sel.value = prefs[k] || ''; if (sel.value !== (prefs[k] || '')) sel.value = '';
    if (kind === 'audiooutput') { const ok = 'setSinkId' in HTMLMediaElement.prototype; sel.disabled = !ok; if (!ok) sel.title = 'тут нельзя выбрать выход — играет системный'; }
  });
}
try { navigator.mediaDevices.addEventListener('devicechange', () => { devices(); tmsg('ok', 'устройства поменялись', 1); }); } catch (_) {}

/* ---------- проверка мика, как в Discord: уровень с порогом, «слышать себя», запись 5 сек ---------- */
// цепочка та же, что в звонке: мик → громкость → порог голоса → (наушники | запись)
let mt = null;
const mtEl = $('.js-mtest', sw), mtFill = $('.js-mtfill', sw), mtThr = $('.js-mtthr', sw), mtSt = $('.js-mtst', sw);
const mtBtn = $('.js-mictest', sw), loopBtn = $('.js-loop', sw), recBtn = $('.js-rec', sw);
const MT_HINT = mtSt.textContent;
const dbPos = db => clamp((db + 80) / 70 * 100, 0, 100); // -80…-10 дБ → 0…100% (как ползунок порога)
let mtBusy = false;
async function micTest() {
  if (mt) { stopMicTest(); return; }
  if (mtBusy) return; mtBusy = true;
  try {
    const a = actx(); if (!a) { tmsg('warn', 'звук ещё не включён — кликни по окну и попробуй снова'); return; }
    let s;
    try { s = await getMic(); } catch (e) { tmsg('err', 'мик недоступен: ' + (e.message || e.name)); return; }
    if (winOpen() !== 'settings' || tab !== 'audio') { s.getTracks().forEach(t => t.stop()); return; }
    const src = a.createMediaStreamSource(s), g = a.createGain(), an = a.createAnalyser(), dest = a.createMediaStreamDestination(), loop = a.createGain();
    an.fftSize = 1024; an.smoothingTimeConstant = .2; g.gain.value = (prefs.micVol ?? 100) / 100; loop.gain.value = 0;
    const st = { open: true, thr: null };
    const gate = await makeGate(a, m => { st.open = !!m[0]; st.thr = m[1]; });
    src.connect(g); g.connect(an);
    const out = gate || g; if (gate) g.connect(gate);
    out.connect(dest); out.connect(loop); loop.connect(a.destination);
    mt = { s, src, g, gate, an, dest, loop, st, raf: 0, buf: new Float32Array(an.fftSize), rec: null, play: null, loopOn: false, lv: -100 };
    mtEl.classList.add('on'); mtBtn.innerHTML = ic('square') + 'Стоп';
    mtSt.textContent = 'говори — зелёное уходит в звонок, серое режет порог голоса';
    const tick = () => {
      if (!mt) return; mt.raf = requestAnimationFrame(tick);
      an.getFloatTimeDomainData(mt.buf); let q = 0; for (let i = 0; i < mt.buf.length; i++) q += mt.buf[i] * mt.buf[i];
      const db = toDb(Math.sqrt(q / mt.buf.length)); mt.lv = db > mt.lv ? db : mt.lv + (db - mt.lv) * .25;
      mtFill.style.width = dbPos(mt.lv).toFixed(1) + '%';
      const mode = prefs.gate, thr = !gate || mode === 'off' ? null : mode === 'manual' ? +prefs.gateDb : st.thr;
      mtEl.classList.toggle('open', thr == null || st.open);
      mtThr.hidden = thr == null; if (thr != null) mtThr.style.left = dbPos(thr).toFixed(1) + '%';
      mtThr.classList.toggle('auto', mode === 'auto');
    };
    tick(); devices();
  } finally { mtBusy = false; }
}
function setLoop(on) {
  if (!mt) return;
  mt.loopOn = on; mt.loop.gain.setTargetAtTime(on ? 1 : 0, mt.loop.context.currentTime, .02);
  loopBtn.setAttribute('aria-pressed', String(on)); loopBtn.classList.toggle('on', on);
  mtSt.textContent = on ? 'ты слышишь себя так, как слышат друзья · без наушников может засвистеть' : 'говори — зелёное уходит в звонок, серое режет порог голоса';
}
function resetRec() { recBtn.disabled = false; recBtn.classList.remove('rec'); recBtn.innerHTML = ic('circle-dot') + 'Запись 5 сек'; }
async function recTest() {
  if (mt && (mt.rec || mt.play)) return;
  if (!mt) await micTest(); if (!mt) return;
  if (typeof MediaRecorder === 'undefined') { tmsg('warn', 'запись тут не поддерживается — включи «Слышать себя»'); return; }
  const my = mt; if (my.loopOn) setLoop(false);
  const chunks = []; let r;
  try { r = new MediaRecorder(my.dest.stream); } catch (e) { tmsg('err', 'запись не запустилась: ' + (e.message || e.name)); return; }
  my.rec = r; let left = 5;
  r.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  recBtn.disabled = true; recBtn.classList.add('rec'); recBtn.innerHTML = ic('circle-dot') + 'Запись… 5';
  const iv = setInterval(() => { if (--left > 0) recBtn.innerHTML = ic('circle-dot') + 'Запись… ' + left; }, 1000);
  r.onstop = async () => {
    clearInterval(iv); my.rec = null;
    if (mt !== my || !chunks.length) { resetRec(); return; }
    const url = URL.createObjectURL(new Blob(chunks, { type: r.mimeType || 'audio/webm' }));
    const au = new Audio(url); my.play = au;
    if (prefs.outId && au.setSinkId) { try { await au.setSinkId(prefs.outId); } catch (_) {} }
    au.volume = clamp((prefs.outVol ?? 100) / 100, 0, 1);
    recBtn.innerHTML = ic('play') + 'Слушаем…'; mtSt.textContent = 'так тебя слышат друзья — с громкостью мика, шумодавом и порогом';
    const done = () => { URL.revokeObjectURL(url); if (my.play === au) my.play = null; resetRec(); if (mt === my) mtSt.textContent = 'говори — зелёное уходит в звонок, серое режет порог голоса'; };
    au.onended = done; au.onerror = done;
    au.play().catch(done);
  };
  r.start(250); setTimeout(() => { if (r.state !== 'inactive') r.stop(); }, 5000);
  mtSt.textContent = 'пишу 5 секунд — скажи что-нибудь обычным голосом';
}
function stopMicTest() {
  if (!mt) return; const m = mt; mt = null;
  cancelAnimationFrame(m.raf);
  if (m.rec && m.rec.state !== 'inactive') { try { m.rec.stop(); } catch (_) {} }
  if (m.play) { try { m.play.pause(); } catch (_) {} m.play = null; }
  try { m.loop.disconnect(); m.src.disconnect(); m.g.disconnect(); if (m.gate) { m.gate.port.onmessage = null; m.gate.disconnect(); } } catch (_) {}
  m.s.getTracks().forEach(t => t.stop());
  mtEl.classList.remove('on', 'open'); mtFill.style.width = '0%'; mtThr.hidden = true;
  mtBtn.innerHTML = ic('mic') + 'Проверить'; loopBtn.setAttribute('aria-pressed', 'false'); loopBtn.classList.remove('on'); resetRec(); mtSt.textContent = MT_HINT;
}
mtBtn.addEventListener('click', micTest);
loopBtn.addEventListener('click', async () => { if (!mt) await micTest(); if (mt) setLoop(!mt.loopOn); });
recBtn.addEventListener('click', recTest);
bus.on('pref', k => { if (k === 'micVol' && mt) mt.g.gain.value = (prefs.micVol ?? 100) / 100; });

/* превью вебки */
let cam = null;
const camPrev = $('.js-camprev'), camTag = $('.js-camtag'), camBtn = $('.js-camtest');
async function camTest() {
  if (cam) { stopCam(); return; }
  const h = +prefs.camRes || 720, c = { height: { ideal: h }, width: { ideal: Math.round(h * 16 / 9) } };
  try { cam = await navigator.mediaDevices.getUserMedia({ video: prefs.camId ? { ...c, deviceId: { exact: prefs.camId } } : c }); }
  catch (e) { tmsg('err', 'камера недоступна: ' + (e.message || e.name)); return; }
  camPrev.srcObject = cam; camPrev.play().catch(() => {});
  const st = cam.getVideoTracks()[0].getSettings();
  camTag.textContent = `Превью · ${st.height || h}p${st.frameRate ? ' · ' + Math.round(st.frameRate) + ' fps' : ''}`;
  camBtn.textContent = 'Выключить превью'; devices();
}
function stopCam() { if (!cam) return; cam.getTracks().forEach(t => t.stop()); cam = null; camPrev.srcObject = null; camTag.textContent = 'Превью выключено'; camBtn.textContent = 'Включить превью'; }
camBtn.addEventListener('click', camTest);

/* голоса синтезатора */
function voicesList() {
  const sel = $('.js-voices'); const vs = ttsVoices().slice().sort((a, b) => (/^ru/i.test(b.lang) - /^ru/i.test(a.lang)) || a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">Системный русский</option>` + vs.map(v => `<option value="${esc(v.name)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
  sel.value = prefs.voiceName || ''; if (sel.value !== (prefs.voiceName || '')) sel.value = '';
  sel.disabled = !vs.length; if (!vs.length) sel.title = 'синтезатор речи не найден';
}
bus.on('voices', () => { if (winOpen() === 'settings' && tab === 'notif') voicesList(); });

/* ---------- акк ---------- */
const statusInp = $('.js-statusinp');
export function renderMe() {
  const p = (S.me && S.me.profile) || {}, peer = myId();
  $$('.js-meava').forEach(i => { if (!i.classList.contains('spin')) i.src = avaURL(p.ava, peer); });
  $$('.js-menick').forEach(e => e.textContent = p.nick || '…');
  $$('.js-mestatus').forEach(e => e.textContent = p.line || 'в сети');
  $('.js-mobname').textContent = mobName(p.ava);
  if (document.activeElement !== statusInp) statusInp.value = p.line || '';
  segSet($('.js-sw'), p.color || '');
  $$('.js-mypeer').forEach(e => { e.textContent = short(peer); e.title = peer; });
  $$('.js-mypeerc').forEach(b => b.dataset.copy = peer);
  R.style.setProperty('--me', p.color || 'var(--acc)');
}
bus.on('me', () => { renderMe(); refreshCode(); });
/** барабан: мелькают мобы, потом выпадает итоговый */
export function spin(imgs, final, n = 10) {
  return new Promise(res => {
    let i = 0; imgs.forEach(im => im.classList.add('spin'));
    const iv = setInterval(() => {
      const k = i < n ? randomMob() : final; imgs.forEach(im => { im.src = avaURL(k); });
      if (i % 2 === 0) tone([[300 + i * 40, .02]], .25);
      if (++i > n) { clearInterval(iv); imgs.forEach(im => { im.classList.remove('spin'); im.classList.remove('landed'); void im.offsetWidth; im.classList.add('landed'); }); res(); }
    }, 60 + i * 4);
  });
}
$('.js-reroll').addEventListener('click', async e => {
  const b = e.currentTarget; if (b.disabled) return; b.disabled = true;
  const cur = (S.me.profile || {}).ava, next = randomMob(cur);
  await spin($$('.js-meava'), next);
  try { await api('profile_set', { ava: next }); tmsg('ok', `система выдала нового моба: ${mobName(next)}`); tone(TONES.ok); }
  catch (er) { fail(er); renderMe(); }
  b.disabled = false;
});
$('.js-renick').addEventListener('click', () => openW('onboard', { edit: true }));
let stT = 0;
statusInp.addEventListener('input', () => { clearTimeout(stT); stT = setTimeout(saveLine, 900); });
statusInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); statusInp.blur(); } });
statusInp.addEventListener('blur', () => { clearTimeout(stT); saveLine(); });
async function saveLine() {
  const v = statusInp.value.trim().slice(0, 64); if (v === ((S.me.profile || {}).line || '')) return;
  try { await api('profile_set', { line: v }); tmsg('ok', v ? `статус: «${v}» · видят друзья` : 'статус убран'); } catch (e) { fail(e); }
}
$('.js-sw').addEventListener('click', async e => {
  const b = e.target.closest('button[data-c]'); if (!b) return;
  try { await api('profile_set', { color: b.dataset.c }); tmsg('ok', 'цвет ника поменян · друзья увидят сразу'); } catch (er) { fail(er); }
});

/* бэкап */
$('.js-bexport').addEventListener('click', async () => {
  try {
    const d = await api('backup_export');
    const name = `hunty-${myNick() || 'akk'}-${new Date().toISOString().slice(0, 10)}.hunty.json`;
    const path = await saveFile(name, JSON.stringify(d, null, 2), 'application/json');
    tmsg('ok', `бэкап сохранён: ${path} · храни в надёжном месте — это ключ от акка`); tone(TONES.ok);
  } catch (e) { fail(e); }
});
$('.js-bimport').addEventListener('click', () => pickBackup());
export function pickBackup() {
  const f = $('.js-bfile'); f.value = '';
  f.onchange = () => { const file = f.files && f.files[0]; if (file) importBackup(file); };
  f.click();
}
async function importBackup(file) {
  let d;
  try { d = JSON.parse(await file.text()); } catch (_) { fail('это не бэкап Hunty — файл не читается'); return; }
  if (!d || !d.hunty_backup) { fail('это не бэкап Hunty'); return; }
  const go = async () => {
    try {
      await api('backup_import', { data: d });
      tmsg('ok', `акк @${(d.profile && d.profile.nick) || '?'} восстановлен · перезапуск…`); tone(TONES.ok);
      bus.emit('restoring');
      await sleep(500); restart();
    } catch (e) { fail(e); }
  };
  if (S.me && S.me.onboarded && S.me.peer !== d.peer) {
    toast({ icon: 'shield', title: 'Заменить акк?', sub: `сейчас ты @${myNick()}, станешь @${(d.profile && d.profile.nick) || '?'} — без бэкапа текущий ключ не вернуть`,
      actions: [{ label: 'Заменить', cls: 'cbtn', fn: go }, { label: 'Отмена', cls: 'gbtn' }] });
  } else go();
}

/* ---------- сеть ---------- */
const NAT = { public: 'белый IP — тебя видно напрямую', private: 'за роутером — пробиваю дырки и хожу через друзей', unknown: 'выясняю…' };
const VIA = { direct: 'напрямую', lan: 'локалка', relay: 'через друга' };
function renderNet() {
  const n = S.net; const ul = $('.js-netul'); if (!n) { ul.innerHTML = '<li>ядро не ответило</li>'; return; }
  const li = (k, v, cls = '') => `<li class="${cls}"><span>${esc(k)}</span><b>${v}</b></li>`;
  const on = n.online || [], rel = (n.relays || []).filter(r => r.ok);
  $('.js-netcard .big').textContent = 'Серверов: ' + (n.servers || 0);
  ul.innerHTML = [
    li('Ключ', `<span class="mono" title="${esc(n.peer)}">${esc(short(n.peer))}</span>`),
    li('NAT', esc(NAT[n.nat] || n.nat || '—'), n.nat === 'public' ? 'ok' : ''),
    li('Роутер (UPnP)', esc(n.upnp || '—'), /проброшен/.test(n.upnp || '') ? 'ok' : ''),
    li('DHT (IPFS)', n.dht && n.dht.on ? (n.dht.ready ? 'подключён' : 'подключаюсь…') : 'выключен', n.dht && n.dht.ready ? 'ok' : ''),
    li('Локалка', n.mdns ? `mDNS · рядом ${n.lan || 0}` : 'выключена'),
    li('Ретрансляторы', rel.length ? rel.map(r => esc(r.nick || short(r.peer))).join(', ') : 'не нужны'),
    li('Помогаю со связью', n.relay_server ? 'да, друзьям' : 'нет'),
    li('Соединений', String(n.connections || 0)),
    li('В сети', on.length ? on.map(o => `${esc(o.nick || short(o.peer))} <small>${o.rtt != null ? o.rtt + 'ms · ' : ''}${esc(VIA[o.via] || o.via || '')}</small>`).join('<br>') : 'никого'),
  ].join('');
  const ad = [...new Set([...(n.external || []).map(a => ['внешний', a]), ...(n.listen || []).map(a => ['слушаю', a])].map(x => JSON.stringify(x)))].map(x => JSON.parse(x));
  $('.js-addrs').innerHTML = ad.length ? ad.map(([k, a]) => `<div class="addr"><small>${k}</small><code class="mono">${esc(a)}</code><button class="gbtn sm js-copy" data-copy="${esc(a)}">${ic('copy')}</button></div>`).join('') : '<small class="dim">пока нет адресов</small>';
}
let netIv = 0;
function netPoll() { clearInterval(netIv); netIv = setInterval(async () => { if (winOpen() !== 'settings' || tab !== 'net') { clearInterval(netIv); return; } try { S.net = await api('net'); renderNet(); } catch (_) {} }, 3000); }
bus.on('net', () => { if (winOpen() === 'settings' && tab === 'net') renderNet(); });
$('.js-netbtn').addEventListener('click', async () => {
  const out = $('.js-nettest'); out.textContent = 'проверяю…';
  try {
    S.net = await api('net'); renderNet();
    const on = S.net.online || [];
    out.textContent = on.length ? on.map(o => `${o.nick || short(o.peer)}: ${o.rtt != null ? o.rtt + 'ms' : '?'} (${VIA[o.via] || o.via})`).join(' · ') : 'друзей в сети нет — проверять не с кем';
    tone(TONES.ok);
  } catch (e) { out.textContent = 'ошибка: ' + e.message; }
});

/* ---------- о программе и обновления ---------- */
function about() { $('.js-ver').textContent = `v${S.version || '0.2.0'} · бесплатно навсегда`; }
const cmpV = (a, b) => { const p = s => String(s).replace(/^v/, '').split(/[.-]/).map(x => +x || 0); const x = p(a), y = p(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
export async function checkUpdate(silent) {
  const st = $('.js-updst');
  if (!REPO) { if (!silent) st.textContent = 'сборка без адреса репозитория — обновления смотри на GitHub руками'; return; }
  if (!silent) st.textContent = 'проверяю GitHub…';
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status === 404 ? 'релизов пока нет' : 'GitHub ответил ' + r.status);
    const j = await r.json(), tag = j.tag_name || '';
    if (cmpV(tag, S.version) > 0) {
      const want = inTauri ? /\.(exe|msi)$/i : /Linux/i.test(navigator.userAgent) ? /linux/i : /Mac/i.test(navigator.userAgent) ? /mac/i : /\.(exe|msi)$/i;
      const exe = (j.assets || []).find(a => want.test(a.name));
      st.innerHTML = `вышла ${esc(tag)} · <button class="lnk js-updgo">скачать</button>`;
      $('.js-updgo', st).onclick = () => openUrl(exe ? exe.browser_download_url : j.html_url);
      if (silent) toast({ icon: 'download', title: `Вышел Hunty ${tag}`, sub: 'скачай с GitHub — история и друзья останутся', actions: [{ label: 'Скачать', cls: 'cbtn', fn: () => openUrl(exe ? exe.browser_download_url : j.html_url) }, { label: 'Потом', cls: 'gbtn' }] });
    } else if (!silent) st.textContent = `у тебя последняя версия (${S.version})`;
  } catch (e) { if (!silent) st.textContent = 'не вышло: ' + e.message; }
}
$('.js-upd').addEventListener('click', () => checkUpdate(false));
/* браузерный режим (Linux/macOS): у узла нет трея — выключаем кнопкой */
if (!inTauri) {
  $$('.js-quitrow').forEach(e => { e.hidden = false; });
  $('.js-quit').addEventListener('click', () => { closeW(true); bus.emit('quitting'); quitNode(); });
}

/* ---------- хранилище ---------- */
let stDir = '';
async function renderStorage() {
  const tot = $('.js-sttotal', sw), sub = $('.js-stsub', sw), list = $('.js-stlist', sw);
  let st;
  try { st = await api('storage'); } catch (e) { tot.textContent = '—'; sub.textContent = 'не вышло посчитать: ' + e.message; return; }
  stDir = st.dir || '';
  const rooms = (st.rooms || []).filter(r => r.bytes > 0 || S.rooms.has(r.room)).sort((a, b) => b.bytes - a.bytes);
  const media = rooms.reduce((n, r) => n + (r.media_bytes || 0), 0);
  tot.textContent = size(st.total || 0);
  sub.textContent = `история ${size(Math.max(0, (st.total || 0) - media - (st.log || 0)))} · файлы и картинки ${size(media)}${st.log ? ' · логи ' + size(st.log) : ''}${stDir ? ' · ' + stDir : ''}`;
  sub.title = stDir;
  list.innerHTML = rooms.length ? rooms.map(r => {
    const known = S.rooms.get(r.room), nm = known ? (known.kind === 'dm' ? 'лс · ' : '') + roomName(known) : 'удалённый чат';
    return `<div class="strow"><span class="st-n"><b>${esc(nm)}</b><small>${r.msgs || 0} ${plural(r.msgs || 0, 'сообщение', 'сообщения', 'сообщений')}${r.media ? ` · ${r.media} ${plural(r.media, 'файл', 'файла', 'файлов')} (${size(r.media_bytes || 0)})` : ''}</small></span><span class="st-b">${size(r.bytes || 0)}</span>${known ? `<button class="gbtn sm warn" type="button" data-stclear="${esc(r.room)}">${ic('eraser')}Очистить</button>` : ''}</div>`;
  }).join('') : '<div class="empty">чатов пока нет</div>';
}
sw.addEventListener('click', async e => {
  const b = e.target.closest('[data-stclear]'); if (!b) return;
  await clearRoom(b.dataset.stclear); if (winOpen() === 'settings' && tab === 'storage') renderStorage();
});
$('.js-strefresh', sw).addEventListener('click', renderStorage);
$('.js-stopen', sw).addEventListener('click', async () => {
  if (!stDir) return;
  if (!(await reveal(stDir))) { await copyText(stDir); tmsg('ok', 'путь к папке скопирован: ' + stDir); }
});
bus.on('room', (id, old, v) => { if (v && v.cleared && winOpen() === 'settings' && tab === 'storage') renderStorage(); });

/* ---------- заблокированные ---------- */
function renderBlocked() {
  const l = $('.js-blist', sw), bl = [...S.blocked.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('.js-bcount', sw).textContent = bl.length ? '· ' + bl.length : '';
  l.innerHTML = bl.length ? bl.map(b => `<div class="bkrow"><img class="ava" alt="" src="${avaOf(b.peer)}"><span class="br-n"><b>${esc(b.nick || short(b.peer))}</b><small>${esc(short(b.peer))}${b.ts ? ' · с ' + new Date(b.ts).toLocaleDateString('ru-RU') : ''}</small></span><button class="gbtn sm" type="button" data-unbl="${esc(b.peer)}">${ic('shield-off')}Разблокировать</button></div>`).join('') : '<div class="empty">никого — и хорошо</div>';
}
sw.addEventListener('click', async e => { const b = e.target.closest('[data-unbl]'); if (b) { b.disabled = true; await unblock(b.dataset.unbl); renderBlocked(); } });
bus.on('blocked', () => { if (winOpen() === 'settings' && tab === 'priv') renderBlocked(); });

/* ---------- журнал: все всплывашки и логи ядра, чтобы разобраться, если что-то пошло не так ---------- */
const hms = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
function renderJournal() {
  const l = $('.js-jlist', sw), items = JOURNAL.slice(-250).reverse();
  $('.js-jcount', sw).textContent = JOURNAL.length ? '· ' + JOURNAL.length : '';
  l.innerHTML = items.length ? items.map(j => `<div class="jl ${esc(j.k)}"><time>${hms(j.t)}</time><span class="jk">${esc(j.src)}</span><span class="jt">${esc(j.text)}</span></div>`).join('') : '<div class="empty">пока пусто</div>';
}
let jT = 0;
bus.on('journal', () => { if (winOpen() === 'settings' && tab === 'net' && !jT) jT = setTimeout(() => { jT = 0; renderJournal(); }, 400); });
const journalText = () => [`Hunty v${S.version || '?'} · ${navigator.userAgent} · ${new Date().toLocaleString('ru-RU')}`, '']
  .concat(JOURNAL.map(j => `${new Date(j.t).toLocaleString('ru-RU')} [${j.k}] ${j.src}: ${j.text}`)).join('\n');
$('.js-jcopy', sw).addEventListener('click', async () => { await copyText(journalText()); tmsg('ok', 'журнал скопирован — можно вставить другу или в issue'); });
$('.js-jsave', sw).addEventListener('click', async () => {
  try { const path = await saveFile(`hunty-journal-${new Date().toISOString().slice(0, 10)}.txt`, journalText(), 'text/plain'); tmsg('ok', 'журнал сохранён: ' + path); } catch (e) { fail(e); }
});
$('.js-jclear', sw).addEventListener('click', () => { JOURNAL.length = 0; renderJournal(); });
