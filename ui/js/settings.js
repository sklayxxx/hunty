// Настройки: вкладки, привязка контролов к prefs/конфигу ядра, устройства, акк, бэкап, сеть, обновления
import { $, $$, R, esc, ic, short, clamp, prefs, setPref, bus, sleep } from './core.js';
import { api, inTauri, saveFile, restart, openUrl, quitNode } from './api.js';
import { S, myId, myNick } from './state.js';
import { avaURL, mobName, randomMob, MOBKEYS } from './mobs.js';
import { app, tmsg, tone, TONES, toast, fail, openW, closeW, OPEN, CLOSE, segSet, rgv, actx, ttsVoices, speak, fit, winOpen } from './ui.js';
import { V, camStart, camStop } from './voice.js';
import { refreshCode } from './friends.js';
import { eggsText } from './eggs.js';

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
  if (t === 'net') { renderNet(); netPoll(); }
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
const NUM = new Set(['micVol', 'outVol', 'ptt', 'bitrate', 'camRes', 'shareRes', 'shareFps', 'pinTtl', 'glassA', 'scale', 'notifVol']);
const val = (k, v) => NUM.has(k) ? +v : v;
export function syncPrefs() {
  $$('[data-pref]', sw).forEach(el => {
    const k = el.dataset.pref, v = prefs[k];
    if (el.classList.contains('seg')) segSet(el, String(v));
    else if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'range') { el.value = v; rgv(el); }
    else if (el.tagName === 'SELECT') { el.value = v ?? ''; if (el.value !== String(v ?? '')) el.value = ''; }
  });
  dndSync();
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
bus.on('pref', (k, v) => {
  if (k === 'scale') fit();
  if (k === 'camMirror') $('.js-camv').classList.toggle('mir', v !== false);
  if ((k === 'camId' || k === 'camRes') && V.cam) { camStop(true); camStart(); }
  if ((k === 'camId' || k === 'camRes') && cam) { stopCam(); camTest(); }
  if (k === 'micId' && mt) { stopMicTest(); micTest(); }
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

/* проверка мика */
let mt = null;
const micVU = $$('.js-micvu i'), mtBtn = $('.js-mictest');
async function micTest() {
  if (mt) { stopMicTest(); return; }
  const c = { echoCancellation: !!prefs.ec, noiseSuppression: !!prefs.ns, autoGainControl: !!prefs.agc };
  let s;
  try { s = await navigator.mediaDevices.getUserMedia({ audio: prefs.micId ? { ...c, deviceId: { exact: prefs.micId } } : c }); }
  catch (e) { tmsg('err', 'мик недоступен: ' + (e.message || e.name)); return; }
  const a = actx(); if (!a) { s.getTracks().forEach(t => t.stop()); return; }
  const src = a.createMediaStreamSource(s), g = a.createGain(), an = a.createAnalyser(); an.fftSize = 512; g.gain.value = (prefs.micVol ?? 100) / 100;
  src.connect(g); g.connect(an);
  const buf = new Uint8Array(512);
  mt = { s, g, iv: setInterval(() => {
    an.getByteTimeDomainData(buf); let q = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; q += x * x; }
    const l = Math.sqrt(q / buf.length), n = Math.min(12, Math.round(Math.pow(l * 9, .7) * 12));
    micVU.forEach((b, i) => b.classList.toggle('on', i < n));
  }, 60) };
  mtBtn.textContent = 'Стоп'; devices();
}
function stopMicTest() {
  if (!mt) return; clearInterval(mt.iv); mt.s.getTracks().forEach(t => t.stop()); mt = null;
  micVU.forEach(b => b.classList.remove('on')); mtBtn.textContent = 'Проверить';
}
mtBtn.addEventListener('click', micTest);
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
function about() { $('.js-ver').textContent = `v${S.version || '0.1.0'} · бесплатно навсегда`; }
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
