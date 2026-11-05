// Настройки: вкладки, привязка контролов к prefs/конфигу ядра, устройства, проверка мика, акк, бэкап,
// хранилище, блок-лист, сеть и журнал, обновления
import { $, $$, R, esc, ic, short, clamp, prefs, setPref, bus, sleep, size, plural, pad } from './core.js';
import { api, inTauri, saveFile, restart, openUrl, quitNode, reveal, shell, shellListen } from './api.js';
import { S, myId, myNick, roomName, avaOf, autoColor } from './state.js';
import { avaURL, mobName, randomMob, MOBKEYS, MOBS, mobURL } from './mobs.js';
import { cardHTML, BANNERS, bannerBg, isImg, isColor, shrinkImage } from './card.js';
import { openMenu } from './menu.js';
import { app, tmsg, tone, TONES, toast, closeToast, fail, openW, closeW, OPEN, CLOSE, segSet, rgv, actx, ttsVoices, speak, fit, winOpen, JOURNAL, copyText, sfx, SFX_CATS } from './ui.js';
import { V } from './voice.js';
import { refreshCode, unblock } from './friends.js';
import { clearRoom } from './chat.js';
import { eggsText } from './eggs.js';
import { getMic, micChain, levelDb, FX, fxName, dnLoad } from './audio.js';
import { renderBoard, wireBoard } from './board.js';
import { WALLS, setWallImage, wallImage } from './look.js';
import { keyLabel, keyOf } from './keyname.js';
import { gkeysOk, bindKey } from './keys.js';
import { bump } from './motion.js';

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
  if (t === 'audio') { sensSync(); nsSub(); pttSync(); renderFx(); renderBoard(sbSet, { add: true, del: true }); micTest(); }
  if (t === 'look') { fontSync(); renderWalls(); }
  if (t === 'keys') keysSync();
  if (t === 'share') $('.js-clipk', sw).textContent = keyLabel(keyOf('clip')) || 'F8';
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
const NUM = new Set(['micVol', 'outVol', 'ptt', 'bitrate', 'camRes', 'shareRes', 'shareFps', 'pinTtl', 'glassA', 'glassBlur', 'scale', 'notifVol', 'gateDb', 'msgSize', 'wallBlur', 'wallDim', 'sbVol', 'awayAfter', 'clipSec']);
const val = (k, v) => NUM.has(k) ? +v : v;
export function syncPrefs() {
  $$('[data-pref]', sw).forEach(el => {
    const k = el.dataset.pref, v = prefs[k];
    if (el.classList.contains('seg')) segSet(el, String(v));
    else if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'range') { el.value = v; rgv(el); }
    else if (el.tagName === 'SELECT') { el.value = v ?? ''; if (el.value !== String(v ?? '')) el.value = ''; }
  });
  dndSync(); sensSync(); pttSync(); wallRows(); glassRows(); sfxRows();
  $('.js-camv').classList.toggle('mir', prefs.camMirror !== false);
}
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
/* ---------- какие звуки играть: по категориям, у каждой — «послушать» ---------- */
const sfxCats = $('.js-sfxcats', sw);
const SFX_TRY = { calls: 'ring', voice: 'join', mic: 'mute', stream: 'streamon', msg: 'mention', fun: 'hall' };
function sfxRows() {
  const off = prefs.sfxOff || {};
  sfxCats.classList.toggle('off', !prefs.sound);
  sfxCats.innerHTML = SFX_CATS.map(([k, n, d]) => `<div class="row"><div class="lab"><b>${esc(n)}</b><small>${esc(d)}</small></div><button class="ib sm js-sfxtry" type="button" data-c="${k}" title="Послушать" aria-label="Послушать: ${esc(n)}">${ic('volume-2')}</button><input class="tg" type="checkbox" data-sfxcat="${k}" aria-label="${esc(n)}"${off[k] ? '' : ' checked'}></div>`).join('');
}
function sfxTry(k) { const n = sfx(SFX_TRY[k], 1, true); if (n && k === 'calls') setTimeout(() => { try { n.stop(); } catch (_) {} }, 1300); }
sfxCats.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.sfxcat; if (!k) return; setPref('sfxOff', { ...(prefs.sfxOff || {}), [k]: !e.target.checked }); if (e.target.checked) sfxTry(k); });
sfxCats.addEventListener('click', e => { const b = e.target.closest('.js-sfxtry'); if (b) sfxTry(b.dataset.c); });
bus.on('pref', k => { if (k === 'sound') sfxCats.classList.toggle('off', !prefs.sound); });
bus.on('pref', (k, v) => {
  if (k === 'scale') fit();
  if (k === 'camMirror') $('.js-camv').classList.toggle('mir', v !== false);
  if ((k === 'camId' || k === 'camRes') && cam) { stopCam(); camTest(); }
  if (['micId', 'nsMode', 'ec', 'agc'].includes(k) && mt) { stopMicTest(); micTest(); }
  if (k === 'gate' || k === 'gateDb') sensSync();
  if (k === 'nsMode') nsSub();
  if (k === 'ptt' || k === 'pttKey' || k === 'keys') pttSync();
  if (k === 'fx') renderFx();
  if (k === 'wall') { renderWalls(); wallRows(); }
  if (k === 'lite') glassRows();
  if (k === 'voiceName' || k === 'say') { if (prefs.say) speak('Привет, это голос уведомлений', true); }
});

/* «не беспокоить» — тот же статус, что под списком друзей (me.js) */
const dndSeg = $('.js-dnd');
function dndSync() { const left = prefs.dnd && prefs.dnd > Date.now() ? (prefs.dnd - Date.now()) / 60000 : 0; segSet(dndSeg, left <= 0 ? '0' : left > 60 * 24 * 30 ? '-1' : left > 60 ? '480' : '60'); }
dndSeg.addEventListener('click', e => { const b = e.target.closest('button'); if (b) bus.emit('dnd-set', +b.dataset.v); });
bus.on('dnd', dndSync);

/* ---------- конфиг ядра: сеть и приватность (нужен перезапуск) ---------- */
function syncCfg() {
  $$('[data-cfg]', sw).forEach(el => { el.checked = !!S.config[el.dataset.cfg]; });
  $('.js-port').value = S.config.port || 0;
}
let rsToast = null;
async function setCfg(patch) {
  try {
    const r = await api('config_set', patch);
    if (r && r.config) { S.config = r.config; syncCfg(); renderSrv(S.net); } // «сервер» тянет за собой ретранслятор и UPnP
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

/* ---------- чувствительность и проверка мика, как в Discord ---------- */
// та же цепочка, что в звонке (audio.js): мик → шумодав → громкость → порог → эффект → (наушники | запись).
// Полоска живая, пока открыта эта вкладка; зелёное уходит в звонок, жёлтое режет порог.
let mt = null, mtBusy = false;
const mtEl = $('.js-mtest', sw), mtSt = $('.js-mtst', sw), sensBar = $('.js-sensbar', sw), sensRg = $('.js-sensrg', sw), sensV = $('.js-sensv', sw), gAuto = $('.js-gauto', sw);
const loopBtn = $('.js-loop', sw), recBtn = $('.js-rec', sw);
const HINT_ON = 'говори — зелёное слышат друзья, жёлтое отрезает порог';
const dbPos = db => clamp((db + 80) / 70 * 100, 0, 100); // -80…-10 дБ → 0…100%
const isAuto = () => prefs.gate !== 'manual' && prefs.gate !== 'off';
function sensSync() {
  const auto = isAuto();
  gAuto.checked = auto; sensRg.disabled = auto; mtEl.classList.toggle('auto', auto);
  if (!auto) {
    const v = prefs.gate === 'off' ? -80 : clamp(+prefs.gateDb || -50, -80, -10);
    sensRg.value = v; sensBar.style.setProperty('--t', dbPos(v).toFixed(1) + '%');
    sensV.textContent = prefs.gate === 'off' ? 'порог выключен' : `порог ${v} дБ`;
  } else sensV.textContent = mt && mt.st.thr != null ? `авто · ${Math.round(mt.st.thr)} дБ` : 'авто';
}
gAuto.addEventListener('change', () => setPref('gate', gAuto.checked ? 'auto' : 'manual'));
sensRg.addEventListener('input', () => { if (prefs.gate !== 'manual') setPref('gate', 'manual'); setPref('gateDb', +sensRg.value); });
sensRg.addEventListener('dblclick', () => setPref('gateDb', -50));
async function micTest() {
  if (mt || mtBusy) return;
  mtBusy = true;
  try {
    const a = actx(); if (!a) { mtSt.textContent = 'кликни по окну — и полоска оживёт'; return; }
    mtSt.textContent = 'открываю мик…';
    let s;
    try { s = await getMic(); }
    catch (e) { mtEl.classList.add('err'); mtSt.textContent = e && e.name === 'NotAllowedError' ? 'нет доступа к мику — разреши его в Windows: Параметры → Конфиденциальность → Микрофон' : 'мик недоступен: ' + (e.message || e.name); return; }
    if (winOpen() !== 'settings' || tab !== 'audio') { s.getTracks().forEach(t => t.stop()); return; }
    const st = { open: true, thr: null };
    let ch;
    try { ch = await micChain(a, s, { onGate: m => { st.open = !!m[0]; st.thr = m[1]; } }); } catch (e) { s.getTracks().forEach(t => t.stop()); mtSt.textContent = 'звук не запустился: ' + (e.message || e); return; }
    if (winOpen() !== 'settings' || tab !== 'audio') { ch.stop(); return; }
    const loop = a.createGain(); loop.gain.value = 0; ch.mix.connect(loop); loop.connect(a.destination);
    mt = { ch, st, loop, raf: 0, k: 0, buf: new Float32Array(ch.an.fftSize), rec: null, play: null, loopOn: false, lv: -100 };
    mtEl.classList.add('on'); mtEl.classList.remove('err'); mtSt.textContent = HINT_ON;
    const tick = () => {
      if (!mt) return; mt.raf = requestAnimationFrame(tick);
      const db = levelDb(ch.an, mt.buf); mt.lv = db > mt.lv ? db : mt.lv + (db - mt.lv) * .18;
      sensBar.style.setProperty('--lv', dbPos(mt.lv).toFixed(1) + '%');
      if (isAuto() && st.thr != null) sensBar.style.setProperty('--t', dbPos(st.thr).toFixed(1) + '%');
      mtEl.classList.toggle('open', !ch.gate || prefs.gate === 'off' || st.open);
      if (isAuto() && ++mt.k % 20 === 0) sensSync();
    };
    tick(); devices();
  } finally { mtBusy = false; }
}
function setLoop(on) {
  if (!mt) return;
  mt.loopOn = on; mt.loop.gain.setTargetAtTime(on ? 1 : 0, mt.loop.context.currentTime, .02);
  loopBtn.setAttribute('aria-pressed', String(on)); loopBtn.classList.toggle('on', on);
  mtSt.textContent = on ? 'ты слышишь себя так, как слышат друзья · без наушников может засвистеть' : HINT_ON;
}
function resetRec() { recBtn.disabled = false; recBtn.classList.remove('rec'); recBtn.innerHTML = ic('circle-dot') + 'Запись 5 сек'; }
async function recTest() {
  if (mt && (mt.rec || mt.play)) return;
  if (!mt) await micTest(); if (!mt) return;
  if (typeof MediaRecorder === 'undefined') { tmsg('warn', 'запись тут не поддерживается — включи «Слышать себя»'); return; }
  const my = mt; if (my.loopOn) setLoop(false);
  const chunks = []; let r;
  try { r = new MediaRecorder(my.ch.stream); } catch (e) { tmsg('err', 'запись не запустилась: ' + (e.message || e.name)); return; }
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
    recBtn.innerHTML = ic('play') + 'Слушаем…'; mtSt.textContent = 'так тебя слышат друзья — с громкостью, шумодавом, порогом и эффектом';
    const done = () => { URL.revokeObjectURL(url); if (my.play === au) my.play = null; resetRec(); if (mt === my) mtSt.textContent = HINT_ON; };
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
  try { m.loop.disconnect(); } catch (_) {}
  m.ch.stop();
  mtEl.classList.remove('on', 'open'); sensBar.style.setProperty('--lv', '0%');
  loopBtn.setAttribute('aria-pressed', 'false'); loopBtn.classList.remove('on'); resetRec(); mtSt.textContent = 'мик не слушаю';
}
loopBtn.addEventListener('click', async () => { if (!mt) await micTest(); if (mt) setLoop(!mt.loopOn); });
recBtn.addEventListener('click', recTest);
$('.js-micfix', sw).addEventListener('click', () => { stopMicTest(); openW('micfix'); });

/* шумодав: подпись под выбором */
const NSSUB = {
  rnnoise: 'умный — нейросеть RNNoise прямо у тебя на компе: режет клаву, кулер, собаку и улицу, голос не трогает',
  std: 'обычный — встроенный в браузер: мягче, но пропускает щелчки клавы',
  off: 'без обработки — для хороших студийных миков',
};
function nsSub() {
  const el = $('.js-nssub', sw), m = prefs.nsMode || 'rnnoise'; el.textContent = NSSUB[m] || '';
  if (m === 'rnnoise') dnLoad().then(ok => { if (!ok && (prefs.nsMode || 'rnnoise') === 'rnnoise') el.textContent = 'умный шумодав тут не запустился — пока работает обычный'; });
}

/* рация: своя клавиша (или кнопка мыши) — назначается там же, где все хоткеи */
const pttBtn = $('.js-pttkey', sw);
function pttSync() {
  pttBtn.textContent = keyLabel(keyOf('ptt'));
  $$('.js-pttrow', sw).forEach(r => { r.hidden = !+prefs.ptt; });
}
pttBtn.addEventListener('click', () => bindKey('ptt', pttBtn));

/* эффекты голоса */
const fxGrid = $('.js-fxgrid', sw);
function renderFx() {
  const cur = prefs.fx || '';
  fxGrid.innerHTML = FX.map(f => `<button type="button" role="radio" class="fxt${cur === f.id ? ' on' : ''}" aria-checked="${cur === f.id}" data-fx="${f.id}"><img alt="" src="emoji/${f.e}.webp" draggable="false"><span>${f.name}</span></button>`).join('');
}
fxGrid.addEventListener('click', e => {
  const b = e.target.closest('[data-fx]'); if (!b) return;
  const id = b.dataset.fx; if ((prefs.fx || '') === id) return;
  setPref('fx', id); bump($(`[data-fx="${id}"] img`, fxGrid), 1.25);
  tmsg('ok', id ? `эффект «${fxName(id)}» — друзья слышат тебя так` : 'эффект выключен');
  if (id && mt && !mt.loopOn) mtSt.textContent = 'нажми «Слышать себя», чтобы послушать эффект';
});

/* саундборд в настройках — только послушать */
const sbSet = $('.js-sbset', sw);
wireBoard(sbSet, { preview: true });
bus.on('sb', () => { if (winOpen() === 'settings' && tab === 'audio') renderBoard(sbSet, { add: true, del: true }); });

/* ---------- внешний вид: шрифт и обои ---------- */
const fontsEl = $('.js-fonts', sw);
function fontSync() { $$('[data-f]', fontsEl).forEach(b => { const on = b.dataset.f === (prefs.font || 'soft'); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); }
fontsEl.addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; setPref('font', b.dataset.f); fontSync(); bump($('b', b), 1.15); });
const wallsEl = $('.js-walls', sw), wallFile = $('.js-wallfile', sw);
async function renderWalls() {
  const cur = prefs.wall || '', img = await wallImage();
  const t = (id, name, bg, extra = '') => `<button type="button" role="radio" class="wl${cur === id ? ' on' : ''}${extra}" aria-checked="${cur === id}" data-w="${id}" style="--wbg:${esc(bg)}"><i></i><span>${name}</span></button>`;
  wallsEl.innerHTML = WALLS.map(w => t(w.id, w.name, w.css)).join('')
    + (img ? t('img', 'Своя', `#000 url('${img}') center/cover`, ' own') : '')
    + `<button type="button" class="wl add js-walladd"><i>${ic('image-plus')}</i><span>${img ? 'Другая' : 'Своя картинка'}</span></button>`;
}
// затемнение — для любых обоев, кроме чёрного и свечения; размытие — только для своей картинки (градиенты размывать нечего)
function wallRows() {
  const w = prefs.wall || '';
  $$('.js-wallrow', sw).forEach(r => { r.hidden = !w || w === 'glow' || (r.classList.contains('js-wallblur') && w !== 'img'); });
  $('.js-liverow', sw).hidden = w !== 'glow';
}
// в лёгком режиме стекла нет — его ползунки ничего не меняют, гасим их и говорим почему
function glassRows() { const off = !!prefs.lite; $$('.js-glrow', sw).forEach(r => { r.classList.toggle('na', off); $$('input,button', r).forEach(c => { c.disabled = off; }); }); $('.js-glnote', sw).hidden = !off; }
// пока тянешь ползунок стекла/обоев — затемнение под окном настроек убираем, чтобы было видно, что меняется
let peekT = 0;
sw.addEventListener('input', e => {
  if (!['glassA', 'glassBlur', 'wallBlur', 'wallDim'].includes(e.target.dataset && e.target.dataset.pref)) return;
  const b = sw.closest('.wback'); if (!b) return; b.classList.add('peek'); clearTimeout(peekT); peekT = setTimeout(() => b.classList.remove('peek'), 1600);
});
wallsEl.addEventListener('click', e => {
  if (e.target.closest('.js-walladd')) { wallFile.click(); return; }
  const b = e.target.closest('[data-w]'); if (!b) return;
  setPref('wall', b.dataset.w); bump($('i', b), 1.08);
});
wallFile.addEventListener('change', async () => {
  const f = wallFile.files && wallFile.files[0]; wallFile.value = ''; if (!f) return;
  try { await setWallImage(f); renderWalls(); tmsg('ok', 'обои поставлены · размытие и затемнение — ниже'); } catch (e) { fail(e); }
});

/* хоткеи в играх — только в приложении для Windows */
function keysSync() {
  const ok = gkeysOk(), t = $('.js-gkeys', sw);
  t.disabled = !ok; if (!ok) t.checked = false;
  $('.js-gksub', sw).textContent = ok ? 'рация и мик ловятся, даже когда Hunty свёрнут · клавиши у игры не отбираются' : 'только в приложении для Windows — в браузере хоткеи работают, пока окно активно';
  pttSync();
}

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

/* ---------- акк: редактор профиля с живым превью ---------- */
const statusInp = $('.js-statusinp'), bioInp = $('.js-bio'), swEl = $('.js-sw'), swPick = $('.js-swpick');
const SWC = new Set($$('button[data-c]', swEl).map(b => b.dataset.c));
/** выбранное, но ещё не подтверждённое ядром — превью показывает сразу */
const draft = {};
const meP = () => Object.assign({}, (S.me && S.me.profile) || {}, draft);
const myColor = p => (isColor(p.color) ? p.color : autoColor(myId()));
const STP = { '': ['on', 'в сети'], away: ['away', 'отошёл'], dnd: ['dnd', 'не беспокоить'], inv: ['inv', 'невидимка'] };
function renderPrev() {
  const p = meP(), [c, l] = STP[p.status || ''] || STP[''];
  let line = `<span class="pst3 ${c}"><i></i>${l}</span>`;
  if (p.game) line += `<span class="pgm3">${ic('gamepad-2')}играет в <b>${esc(p.game)}</b></span>`;
  if ((p.line || '').trim()) line += `<span class="pln3">${esc(p.line.trim())}</span>`;
  $('.js-accprev').innerHTML = cardHTML({ ava: avaURL(p.ava, myId()), nick: p.nick || '…', color: myColor(p), banner: p.banner, bio: p.bio, pd: `<i class="pd ${c === 'inv' ? '' : c}"></i>`, tag: '@' + esc(p.nick || '') + ' · так тебя видят друзья', line });
}
function renderBans() {
  const p = meP(), cur = p.banner || '', c = myColor(p);
  const b = (v, bg, lab, inner = '') => { const on = v === 'img' ? isImg(cur) : cur === v; return `<button type="button" class="ban${on ? ' on' : ''}" data-b="${esc(v)}" style="background:${esc(bg)}" aria-pressed="${on}" aria-label="${esc(lab)}" title="${esc(lab)}">${inner}</button>`; };
  $('.js-bans').innerHTML = b('', bannerBg('', c), 'Авто — от цвета ника', '<span>Авто</span>') +
    Object.entries(BANNERS).map(([k, [n, bg]]) => b('g:' + k, bg, n)).join('') +
    (isImg(cur) ? b('img', bannerBg(cur), 'Своя картинка') : '') +
    `<button type="button" class="ban add js-banup" title="Своя картинка" aria-label="Загрузить свою картинку">${ic('image-plus')}</button>`;
}
function renderMobs() {
  const g = $('.js-mobgrid'); if (g.hidden) return;
  const cur = meP().ava || '';
  g.innerHTML = `<button type="button" class="mobb rnd js-mobrnd" title="Случайный моб">${ic('dices')}<span>Случайный</span></button>` +
    MOBKEYS.map(k => `<button type="button" class="mobb${cur === 'mob:' + k ? ' on' : ''}" data-mob="${k}" aria-pressed="${cur === 'mob:' + k}" title="${esc(MOBS[k].n)}"><img alt="" src="${mobURL(k)}"><span>${esc(MOBS[k].n)}</span></button>`).join('');
}
function bioCount() { $('.js-bioc').textContent = `${bioInp.value.length} / 190`; }
export function renderMe() {
  const p = (S.me && S.me.profile) || {}, peer = myId();
  for (const k of Object.keys(draft)) if ((p[k] || '') === (draft[k] || '')) delete draft[k];
  $$('.js-meava').forEach(i => { if (!i.classList.contains('spin')) i.src = avaURL(p.ava, peer); });
  $$('.js-menick').forEach(e => e.textContent = p.nick || '…');
  $$('.js-mestatus').forEach(e => e.textContent = p.line || 'в сети');
  if (document.activeElement !== statusInp) statusInp.value = p.line || '';
  if (document.activeElement !== bioInp) { bioInp.value = p.bio || ''; bioCount(); }
  const c = 'color' in draft ? draft.color : p.color || '', custom = isColor(c) && !SWC.has(c);
  segSet(swEl, custom ? '\u0000' : c);
  const lab = swPick.parentElement; lab.classList.toggle('on', custom); lab.style.setProperty('--sc', custom ? c : 'transparent');
  if (document.activeElement !== swPick) swPick.value = isColor(c) && c.length === 7 ? c : '#9db7ff';
  $$('.js-mypeer').forEach(e => { e.textContent = short(peer); e.title = peer; });
  $$('.js-mypeerc').forEach(b => b.dataset.copy = peer);
  R.style.setProperty('--me', p.color || 'var(--acc)');
  renderPrev(); renderBans(); renderMobs();
}
bus.on('me', () => { renderMe(); refreshCode(); });
async function saveProf(patch, msg) {
  Object.assign(draft, patch); renderPrev(); renderBans(); renderMobs();
  try { await api('profile_set', patch); if (msg) tmsg('ok', msg); }
  catch (e) { for (const k of Object.keys(patch)) delete draft[k]; fail(e); renderMe(); }
}
/** барабан: мелькают мобы, потом выпадает итоговый */
export function spin(imgs, final, n = 10) {
  return new Promise(res => {
    let i = 0; imgs.forEach(im => im.classList.add('spin'));
    const iv = setInterval(() => {
      const k = i < n ? randomMob() : final; imgs.forEach(im => { im.src = avaURL(k); });
      if (i % 2 === 0) sfx('tick', .35);
      if (++i > n) { clearInterval(iv); imgs.forEach(im => { im.classList.remove('spin'); im.classList.remove('landed'); void im.offsetWidth; im.classList.add('landed'); }); res(); }
    }, 60 + i * 4);
  });
}
async function rollMob() {
  const next = randomMob(meP().ava);
  await spin($$('.js-meava, .js-accprev .pa3 img'), next);
  saveProf({ ava: next }, `выпал моб: ${mobName(next)}`); tone(TONES.ok);
}
function mobsToggle(on) {
  const g = $('.js-mobgrid'); g.hidden = on === undefined ? !g.hidden : !on;
  $('.js-avamob').setAttribute('aria-expanded', String(!g.hidden)); renderMobs();
  if (!g.hidden) g.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function pickImg(sel, o, patch, msg) {
  const f = $(sel); f.value = '';
  f.onchange = async () => {
    const file = f.files && f.files[0]; if (!file) return;
    try { const url = await shrinkImage(file, o); saveProf(patch(url), msg); } catch (e) { fail(e); }
  };
  f.click();
}
const avaUp = () => pickImg('.js-avafile', { w: 128, h: 128, max: 90 * 1024 }, u => ({ ava: u }), 'аватарка обновлена · друзья увидят сразу');
$('.js-avamob').addEventListener('click', () => mobsToggle());
$('.js-avaup').addEventListener('click', avaUp);
$('.js-accava').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  openMenu([
    { icon: 'dices', label: 'Выбрать моба', fn: () => mobsToggle(true) },
    { icon: 'sparkles', label: 'Случайный моб', fn: rollMob },
    { icon: 'image-plus', label: 'Своя картинка', sub: 'ужму до 128×128 сам', fn: avaUp },
  ], { x: r.left, y: r.bottom + 6, el: e.currentTarget });
});
$('.js-mobgrid').addEventListener('click', e => {
  if (e.target.closest('.js-mobrnd')) { rollMob(); return; }
  const b = e.target.closest('[data-mob]'); if (!b) return;
  saveProf({ ava: 'mob:' + b.dataset.mob }, `теперь ты — ${MOBS[b.dataset.mob].n}`); sfx('ok', .7);
});
$('.js-bans').addEventListener('click', e => {
  if (e.target.closest('.js-banup')) { pickImg('.js-banfile', { w: 600, h: 212, max: 190 * 1024 }, u => ({ banner: u }), 'шапка профиля обновлена'); return; }
  const b = e.target.closest('[data-b]'); if (!b || b.dataset.b === 'img') return;
  saveProf({ banner: b.dataset.b }, b.dataset.b ? 'шапка профиля обновлена' : 'шапка снова от цвета ника');
});
$('.js-renick').addEventListener('click', () => openW('onboard', { edit: true }));
let stT = 0, bioT = 0;
statusInp.addEventListener('input', () => { draft.line = statusInp.value.slice(0, 64); renderPrev(); clearTimeout(stT); stT = setTimeout(saveLine, 900); });
statusInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); statusInp.blur(); } });
statusInp.addEventListener('blur', () => { clearTimeout(stT); saveLine(); });
async function saveLine() {
  const v = statusInp.value.trim().slice(0, 64); if (v === ((S.me.profile || {}).line || '')) { delete draft.line; renderPrev(); return; }
  saveProf({ line: v }, v ? `статус: «${v}» · видят друзья` : 'статус убран');
}
bioInp.addEventListener('input', () => { bioCount(); draft.bio = bioInp.value.slice(0, 190); renderPrev(); clearTimeout(bioT); bioT = setTimeout(saveBio, 1200); });
bioInp.addEventListener('blur', () => { clearTimeout(bioT); saveBio(); });
function saveBio() {
  const v = bioInp.value.trim().slice(0, 190); if (v === ((S.me.profile || {}).bio || '')) { delete draft.bio; renderPrev(); return; }
  saveProf({ bio: v }, v ? '«о себе» сохранено' : '«о себе» убрано — блока в профиле больше нет');
}
swEl.addEventListener('click', e => {
  const b = e.target.closest('button[data-c]'); if (!b) return;
  saveProf({ color: b.dataset.c }, 'цвет ника поменян · друзья увидят сразу'); renderMe();
});
swPick.addEventListener('input', () => { draft.color = swPick.value; renderPrev(); renderBans(); const lab = swPick.parentElement; lab.classList.add('on'); lab.style.setProperty('--sc', swPick.value); segSet(swEl, '\u0000'); });
swPick.addEventListener('change', () => saveProf({ color: swPick.value }, 'свой цвет ника · друзья увидят сразу'));

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
/** главное о связи — по-человечески; подробности (NAT, DHT, адреса) — под «Подробнее» */
function netHero() {
  const n = S.net, hero = $('.js-nethero'); if (!hero) return;
  const put = (st, t, sub) => { hero.dataset.st = st; $('.js-nhb').textContent = t; $('.js-nhs').textContent = sub; };
  if (!n) { put('bad', 'Ядро не отвечает', 'перезапусти Hunty — если не поможет, скопируй журнал ниже и скинь разработчику'); return; }
  const on = n.online || [], relay = on.filter(o => o.via === 'relay').length, direct = on.length - relay;
  const fr = [...S.friends.values()].filter(f => f.state === 'friend').length;
  const dht = n.dht && n.dht.on, dhtOk = dht && n.dht.ready;
  if (on.length) {
    put(direct ? 'ok' : 'mid', direct ? 'Всё работает' : 'Связь есть — через друга',
      `в сети ${on.length} ${plural(on.length, 'человек', 'человека', 'человек')}` + (direct ? ` · напрямую ${direct}` : '') + (relay ? ` · через помощника ${relay}` : '') + (n.nat === 'public' ? ' · у тебя белый IP' : ''));
  } else if (!fr) put('ok', 'Готов к работе', 'друзей пока нет — добавь по нику или коду, Hunty найдёт их сам');
  else if (dhtOk || n.lan) put('mid', 'Друзья не в сети', 'как только кто-то зайдёт — подключусь сам' + (n.nat === 'private' ? ' · ты за роутером, но это не страшно' : ''));
  else if (!dht) put('bad', 'Поиск через интернет выключен', 'друзья найдутся только по локалке — включи «Искать друзей через интернет»');
  else put('mid', 'Подключаюсь к сети…', 'обычно до минуты — потом друзья найдутся сами');
  const srv = n.server ? 'ты сервер для друзей' : n.servers ? `серверов друзей в сети: ${n.servers}` : '';
  if (srv) $('.js-nhs').textContent += ' · ' + srv;
}
/** режим «сервер для друзей»: работает ли, видно ли снаружи, какой порт открыть на роутере */
function renderSrv(n) {
  const box = $('.js-srvbox'); if (!box) return;
  const want = !!(S.config && S.config.server), on = !!(n && n.server);
  box.hidden = !want && !on; if (box.hidden) return;
  if (want !== on) { box.dataset.st = 'mid'; box.innerHTML = `<b>${ic('rotate-ccw')}${want ? 'Включится после перезапуска Hunty' : 'Выключится после перезапуска Hunty'}</b>`; return; }
  const it = n.intros || {}, port = esc(String(n.port || '—'));
  box.dataset.st = n.reachable ? 'ok' : 'mid';
  box.innerHTML = `<b>${ic(n.reachable ? 'check' : 'info')}${n.reachable ? 'Сервер работает, до тебя достучатся из интернета' : 'Сервер работает, но снаружи порт закрыт'}</b>` +
    `<small>${n.reachable ? (n.nat === 'public' ? 'у тебя белый IP' : `роутер сам открыл порт <b class="mono">${port}</b>`) : `открой на роутере порт <b class="mono">${port}</b> (TCP и UDP) на этот комп или включи UPnP в настройках роутера. Пока порт закрыт, сервер помогает только тем, кто уже на связи`}</small>` +
    `<small>через тебя на связи: ${n.reserved || 0} · познакомил друзей: ${it.made || 0}${it.waiting ? ' · ждут друг друга: ' + it.waiting : ''}</small>`;
}
function renderNet() {
  netHero(); renderSrv(S.net);
  const n = S.net; const ul = $('.js-netul'); if (!n) { ul.innerHTML = '<li>ядро не ответило</li>'; return; }
  const li = (k, v, cls = '') => `<li class="${cls}"><span>${esc(k)}</span><b>${v}</b></li>`;
  const on = n.online || [], rel = (n.relays || []).filter(r => r.ok);
  const it = n.intros || {};
  ul.innerHTML = [
    li('Ключ', `<span class="mono" title="${esc(n.peer)}">${esc(short(n.peer))}</span>`),
    li('NAT', esc(NAT[n.nat] || n.nat || '—'), n.nat === 'public' ? 'ok' : ''),
    li('Роутер (UPnP)', esc(n.upnp || '—'), /проброшен/.test(n.upnp || '') ? 'ok' : ''),
    li('DHT (IPFS)', n.dht && n.dht.on ? (n.dht.ready ? 'подключён' : 'подключаюсь…') : 'выключен', n.dht && n.dht.ready ? 'ok' : ''),
    li('Локалка', n.mdns ? `mDNS · рядом ${n.lan || 0}` : 'выключена'),
    li('Ретрансляторы', rel.length ? rel.map(r => esc(r.nick || short(r.peer))).join(', ') : 'не нужны'),
    li('Помогаю со связью', n.server ? 'я сервер для друзей' : n.relay_server ? 'да, друзьям' : 'нет', n.server ? 'ok' : ''),
    li('Серверы друзей', n.servers ? `в сети ${n.servers}` + (n.servers_known > n.servers ? ` из ${n.servers_known}` : '') : n.servers_known ? `знаю ${n.servers_known}, сейчас не в сети` : 'нет', n.servers ? 'ok' : ''),
    li('Знакомства', `меня свели: ${it.got || 0} · я свёл: ${it.made || 0}`),
    li('Порт', `<span class="mono">${esc(String(n.port || '—'))}</span> <small>TCP и UDP</small>`),
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
    const q = r => r == null ? 'не ответил' : r < 60 ? 'отлично' : r < 150 ? 'хорошо' : r < 300 ? 'терпимо' : 'тормозит';
    out.textContent = on.length ? on.map(o => `${o.nick || short(o.peer)} — ${q(o.rtt)}${o.rtt != null ? ' (' + o.rtt + ' мс' + (o.via === 'relay' ? ', через друга' : '') + ')' : ''}`).join(' · ') : 'друзей в сети нет — проверять не с кем';
    tone(TONES.ok);
  } catch (e) { out.textContent = 'ошибка: ' + e.message; }
});

/* ---------- о программе и обновления ---------- */
function about() { $('.js-ver').textContent = `v${S.version || '0.7.0'} · бесплатно навсегда`; }
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
      const assets = j.assets || [];
      // в приложении для Windows — обновление в один клик (скачать → закрыться → поставить → запуститься)
      let mode = '', one = null;
      if (inTauri) { mode = await shell('hunty_upd_mode').catch(() => ''); one = assets.find(a => mode === 'portable' ? /portable\.exe$/i.test(a.name) : /setup\.exe$/i.test(a.name)); }
      const want = inTauri ? /\.(exe|msi)$/i : /Linux/i.test(navigator.userAgent) ? /linux/i : /Mac/i.test(navigator.userAgent) ? /mac/i : /\.(exe|msi)$/i;
      const exe = one || assets.find(a => want.test(a.name));
      const manual = () => openUrl(exe ? exe.browser_download_url : j.html_url);
      UPD = one ? { tag, asset: one } : null;
      st.innerHTML = UPD ? `вышла ${esc(tag)} · <button class="lnk js-updgo">обновить сейчас</button> · <button class="lnk js-updman">что нового</button>` : `вышла ${esc(tag)} · <button class="lnk js-updgo">скачать</button>`;
      $('.js-updgo', st).onclick = () => UPD ? runUpdate() : manual();
      const wn = $('.js-updman', st); if (wn) wn.onclick = () => openUrl(j.html_url);
      if (silent) toast({ icon: 'download', title: `Вышел Hunty ${tag}`, sub: UPD ? 'обновится за минуту — история и друзья останутся' : 'скачай с GitHub — история и друзья останутся',
        actions: [{ label: UPD ? 'Обновить' : 'Скачать', cls: 'cbtn', fn: () => UPD ? runUpdate() : manual() }, { label: 'Потом', cls: 'gbtn' }] });
    } else if (!silent) st.textContent = `у тебя последняя версия (${S.version})`;
  } catch (e) { if (!silent) st.textContent = 'не вышло: ' + e.message; }
}
let UPD = null, updBusy = false, updListen = false, updOn = null;
async function runUpdate() {
  if (!UPD || updBusy) return;
  if (V.room) { tmsg('warn', 'сначала выйди из звонка — Hunty перезапустится'); return; }
  updBusy = true;
  const { tag, asset } = UPD, total = asset.size || 0;
  const t = toast({ icon: 'download', title: `Обновляю до ${tag}`, sub: 'качаю…', tag: '0%', cls: 'upd' });
  const st = $('.js-updst'), sub = $('.tw small', t), tg = $('.tk', t);
  const show = (txt, pct) => { if (st) st.textContent = txt; if (sub) sub.textContent = txt; if (tg && pct != null) tg.textContent = pct + '%'; t.style.setProperty('--p', (pct || 0) + '%'); };
  const done = (ok, msg) => { updBusy = false; if (!ok) { closeToast(t); tmsg('err', msg); if (st) st.textContent = msg; } };
  if (!updListen) { updListen = true; shellListen('hunty-upd', e => updOn && updOn(e)); }
  updOn = async e => {
    if (!updBusy) return;
    if (e.err) { done(false, 'обновление: ' + e.err); return; }
    if (e.ok) {
      show('скачал — перезапускаю Hunty…', 100);
      await sleep(700);
      try { bus.emit('quitting', 'update'); await shell('hunty_update_run'); } catch (er) { $$('body > .boot').forEach(b => b.remove()); S.quitting = false; done(false, 'не запустилось: ' + (er.message || er)); }
      return;
    }
    const pct = total ? Math.min(99, Math.round(e.got / total * 100)) : null;
    show(total ? `качаю ${size(e.got)} из ${size(total)}` : `качаю ${size(e.got)}`, pct);
  };
  try { await shell('hunty_update_get', { url: asset.browser_download_url, size: total }); }
  catch (e) { done(false, 'обновление: ' + (e.message || e)); }
}
$('.js-upd').addEventListener('click', () => checkUpdate(false));
/* браузерный режим (Linux/macOS): у узла нет трея — выключаем кнопкой; то, что умеет только приложение, — гасим */
if (!inTauri) {
  for (const k of ['gameScan', 'flash']) { const t = $(`input[data-pref="${k}"]`, sw); if (t) { t.disabled = true; t.closest('.row').classList.add('na'); t.closest('.row').title = 'только в приложении для Windows'; } }
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
