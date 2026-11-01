// Клипы: «последние 30 секунд» звонка по F8 или кнопке с хлопушкой — демка (если кто-то показывает экран)
// + общий звук звонка (ты и друзья). Пока ты в голосе, MediaRecorder пишет в память, webm.js режет поток
// на кадры и держит только свежие. По нажатию склеиваем нормальный .webm (с длительностью и перемоткой).
// Окно «Клипы и скрины» — все картинки и клипы чата плиткой.
import { $, $$, esc, ic, prefs, setPref, bus, clamp, sleep, size, when, plural } from './core.js';
import { api, saveFile, mediaURL, inTauri, reveal } from './api.js';
import { S, myId, nickOf, avaOf, roomName, pushLocal } from './state.js';
import { actx, sfx, tmsg, toast, closeToast, fail, openW, closeW, OPEN, CLOSE } from './ui.js';
import { V } from './voice.js';
import { focusStream } from './demo.js';
import { Demux, mux } from './webm.js';
import { openPic, jump, openChat } from './chat.js';
import { keyLabel, keyOf } from './keyname.js';

const LIMIT = 5.8 * 1024 * 1024;           // в чат — до 6 МБ (столько тянет P2P-сообщение)
const VBPS = 1_150_000, ABPS = 96_000;    // 30 сек ≈ 4,7 МБ
const keep = () => clamp(+prefs.clipSec || 30, 10, 60) * 1000;
const okEnv = typeof MediaRecorder !== 'undefined' && !!window.AudioContext;
const pickMime = list => list.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (_) { return false; } }) || '';
const VMIME = okEnv ? pickMime(['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']) : '';
const AMIME = okEnv ? pickMime(['audio/webm;codecs=opus', 'audio/webm']) : '';

/* ---------- общий звук звонка: мой мик (уже с саундбордом) + все друзья ---------- */
let mixCtx = null, mixDst = null; const mixIn = new Map();
function hookMix() {
  const ctx = actx(); if (!ctx || ctx.state !== 'running') return false;
  if (mixCtx !== ctx) { mixCtx = ctx; mixDst = ctx.createMediaStreamDestination(); mixIn.clear(); }
  const want = new Map();
  if (V.micS && V.track && V.track.readyState === 'live') want.set('me:' + V.micS.id, V.micS);
  for (const P of V.peers.values()) {
    if ((prefs.mute || {})[P.peer]) continue;
    P.audioEls.forEach(a => { const st = a.srcObject; if (st && st.getAudioTracks().some(t => t.readyState === 'live')) want.set(P.peer + ':' + st.id, st); });
  }
  for (const [k, it] of mixIn) if (!want.has(k)) { try { it.disconnect(); } catch (_) {} mixIn.delete(k); }
  for (const [k, st] of want) if (!mixIn.has(k)) { try { const src = ctx.createMediaStreamSource(st); src.connect(mixDst); mixIn.set(k, src); } catch (_) {} }
  return true;
}

/* ---------- запись: звук всегда, видео — пока на сцене чья-то демка ---------- */
let rA = null, rV = null;
function mkRec(stream, video) {
  const mimeType = video ? VMIME : AMIME; if (!mimeType) return null;
  const R = { video, frames: [], head: null, t0: performance.now(), off: 0, q: Promise.resolve(), bytes: 0, dead: false };
  R.demux = new Demux(h => { R.head = h; R.vnum = (h.tracks.find(t => t.type === 'video') || {}).num; }, f => { R.frames.push(f); R.bytes += f.data.length; });
  const opt = { mimeType, audioBitsPerSecond: ABPS };
  if (video) Object.assign(opt, { videoBitsPerSecond: VBPS, videoKeyFrameIntervalDuration: 2000 });
  try { R.mr = new MediaRecorder(stream, opt); } catch (e) { console.warn('clip rec', e); return null; }
  R.mr.ondataavailable = e => { if (!e.data || !e.data.size || R.dead) return; R.q = R.q.then(async () => { if (R.dead) return; R.demux.push(new Uint8Array(await e.data.arrayBuffer())); prune(R); }).catch(err => { console.warn('clip', err); stopRec(R); }); };
  R.mr.onerror = () => stopRec(R);
  try { R.mr.start(500); } catch (e) { console.warn('clip start', e); return null; }
  return R;
}
function stopRec(R) {
  if (!R || R.dead) return; R.dead = true;
  try { if (R.mr.state !== 'inactive') R.mr.stop(); } catch (_) {}
  if (R === rA) rA = null; if (R === rV) rV = null;
  paint();
}
/** выкидываю старое, но так, чтобы клип всегда начинался с ключевого кадра */
function prune(R) {
  const fr = R.frames; if (!fr.length) return;
  const cut = now(R) - keep() - 1500;
  if (fr[0].ts >= cut) return;
  let i = 0;
  if (R.video) { for (let j = 0; j < fr.length && fr[j].ts <= cut; j++) if (fr[j].track === R.vnum && fr[j].key) i = j; }
  else while (i < fr.length && fr[i].ts < cut) i++;
  if (i > 0) { for (let j = 0; j < i; j++) R.bytes -= fr[j].data.length; R.frames = fr.slice(i); }
  // ключевых кадров нет слишком долго — перезапускаю видео, иначе память растёт
  if (R.video && R.bytes > 40 * 1024 * 1024) { stopRec(R); }
}
const want = () => okEnv && !!V.room && prefs.clips !== false;
/** «сейчас» во времени записи: паузы (демка ушла со сцены) не считаются */
const now = R => performance.now() - R.t0 - R.off - (R.pz ? performance.now() - R.pz : 0);
function tick() {
  if (!want()) { stopRec(rA); stopRec(rV); mixIn.forEach(s => { try { s.disconnect(); } catch (_) {} }); mixIn.clear(); return; }
  if (!hookMix()) return;
  if (!rA) rA = mkRec(mixDst.stream, false);
  const st = focusStream(), vt = st && st.getVideoTracks().find(t => t.readyState === 'live');
  if (vt && (!rV || rV.vt !== vt)) { stopRec(rV); rV = mkRec(new MediaStream([vt, mixDst.stream.getAudioTracks()[0]]), true); if (rV) rV.vt = vt; }
  else if (vt && rV && rV.ended) { try { if (rV.mr.state === 'paused') rV.mr.resume(); } catch (_) {} rV.off += performance.now() - (rV.pz || performance.now()); rV.pz = 0; rV.ended = 0; }
  else if (!vt && rV) {
    if (!rV.ended) { rV.ended = Date.now(); rV.pz = performance.now(); try { if (rV.mr.state === 'recording') { rV.mr.requestData(); rV.mr.pause(); } } catch (_) {} }
    else if (Date.now() - rV.ended > 15000) stopRec(rV);
  }
  paint();
}
setInterval(tick, 1500);
bus.on('voice', () => setTimeout(tick, 300)); bus.on('media', () => setTimeout(tick, 300)); bus.on('stagevid', () => setTimeout(tick, 300));
bus.on('vleft', () => { stopRec(rA); stopRec(rV); });
bus.on('pref', k => { if (k === 'clips' || k === 'clipSec' || k === 'keys') tick(); });

/* ---------- кнопка ---------- */
const clipB = $('.js-clip');
function paint() {
  if (!clipB) return;
  const on = !!rA || !!rV;
  clipB.classList.toggle('rec', on);
  clipB.title = !okEnv || (!VMIME && !AMIME) ? 'Клипы не поддерживаются этим окном' : prefs.clips === false ? 'Клипы выключены в настройках' : `Клип: последние ${Math.round(keep() / 1000)} сек${rV && !rV.ended ? ' с демкой' : ''} · ${keyLabel(keyOf('clip')) || 'F8'}`;
}
clipB && clipB.addEventListener('click', () => clip());
bus.on('clip', () => clip());

/* ---------- сохранить клип ---------- */
let busy = false; const recent = []; // клипы этой сессии, которые ещё не ушли в чат
const durOf = R => R && R.frames.length ? R.frames[R.frames.length - 1].ts - R.frames[0].ts : 0;
export async function clip() {
  if (busy) return;
  if (!V.room) { tmsg('warn', 'клипы пишутся в звонке — зайди в голос'); return; }
  if (!okEnv || (!VMIME && !AMIME)) { tmsg('warn', 'это окно не умеет записывать — обнови приложение'); return; }
  if (prefs.clips === false) { toast({ icon: 'clapperboard', title: 'Клипы выключены', sub: 'запись последних секунд звонка не идёт', actions: [{ label: 'Включить', cls: 'cbtn', fn: () => { setPref('clips', true); tick(); } }] }); return; }
  // демка ушла со сцены больше 5 сек назад — свежий момент есть только в звуке
  const R = rV && rV.head && durOf(rV) >= 3000 && (!rV.ended || Date.now() - rV.ended < 5000) ? rV : rA;
  if (!R || !R.head || durOf(R) < 1500) { tick(); tmsg('ping', 'запись только началась — нажми через пару секунд'); return; }
  busy = true; clipB && clipB.classList.add('saving');
  try {
    try { if (R.mr.state === 'recording') R.mr.requestData(); } catch (_) {}
    await sleep(120); await R.q;
    const fr = R.frames, from = now(R) - keep();
    let start = 0;
    if (R.video) { for (let j = 0; j < fr.length; j++) { if (fr[j].track !== R.vnum || !fr[j].key) continue; if (fr[j].ts <= from || start === 0) start = j; if (fr[j].ts > from) break; } }
    else { start = fr.findIndex(f => f.ts >= from); if (start < 0) start = 0; }
    let out = build(R, start);
    // не влезло в 6 МБ — подрезаю начало до следующего ключевого кадра
    while (out && out.bytes.length > LIMIT) {
      const nx = fr.findIndex((f, j) => j > start && (!R.video || (f.track === R.vnum && f.key)) && f.ts > fr[start].ts + 2000);
      if (nx < 0) break; start = nx; out = build(R, start);
    }
    if (!out) throw new Error('пустой клип');
    const c = { blob: new Blob([out.bytes], { type: 'video/webm' }), dur: out.dur, video: R.video, room: V.room, at: Date.now() };
    c.name = `hunty-клип-${stamp(c.at)}.webm`;
    recent.unshift(c); recent.length = Math.min(recent.length, 6);
    sfx('clip');
    api('ev', { room: V.room, kind: 'clip', data: { dur: Math.round(c.dur), video: c.video } }).catch(() => {});
    clipToast(c);
  } catch (e) { fail(e); }
  finally { busy = false; clipB && clipB.classList.remove('saving'); }
}
function build(R, start) {
  const fr = R.frames; if (start < 0 || start >= fr.length) return null;
  const t0 = fr[start].ts, sel = fr.slice(start).filter(f => f.ts >= t0).sort((a, b) => a.ts - b.ts);
  return sel.length ? mux(R.head, sel) : null;
}
const stamp = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`; };
const secs = ms => Math.max(1, Math.round(ms / 1000));
const toURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
function clipToast(c) {
  const t = toast({ icon: 'clapperboard', title: `Клип готов · ${secs(c.dur)} сек`, sub: `${c.video ? 'демка + звук' : 'звук звонка'} · ${size(c.blob.size)}`, tag: 'Клип', dur: 15000,
    actions: [{ label: 'В чат', cls: 'cbtn', fn: () => sendClip(c) }, { label: 'Сохранить', cls: 'gbtn', fn: () => saveClip(c) }] });
  return t;
}
export async function sendClip(c, room = c.room) {
  if (!S.rooms.has(room)) { tmsg('warn', 'чат звонка не найден'); return; }
  if (c.blob.size > 6 * 1024 * 1024) { tmsg('warn', 'клип больше 6 МБ — сохрани его к себе'); return; }
  try {
    tmsg('ping', 'отправляю клип…');
    const m = await api('send', { room, kind: 'file', text: '', data: { name: c.name, size: c.blob.size, mime: 'video/webm', clip: 1, dur: Math.round(c.dur), src: await toURL(c.blob) } });
    pushLocal(m); c.sent = true; const i = recent.indexOf(c); if (i >= 0) recent.splice(i, 1);
    tmsg('ok', `клип ушёл в «${roomName(room)}»`);
  } catch (e) { fail(e); }
}
export async function saveClip(c) {
  try {
    const path = await saveFile(c.name, await toURL(c.blob), 'video/webm');
    if (inTauri) toast({ icon: 'download', title: 'Клип сохранён в «Загрузки»', sub: String(path), dur: 7000, actions: [{ label: 'Показать в папке', cls: 'gbtn', fn: () => reveal(String(path)) }] });
    else tmsg('ok', 'скачиваю клип');
  } catch (e) { fail(e); }
}
// друзья видят, что кто-то сохранил момент
bus.on('ev:clip', v => {
  if (v.from === myId()) return;
  tmsg('ping', `${nickOf(v.from)} сохранил клип${v.data && v.data.dur ? ' · ' + secs(v.data.dur) + ' сек' : ''} 🎬`);
  sfx('clip', .5);
});

/* ---------- окно «Клипы и скрины» ---------- */
const mw = $('.win[data-win="media"]');
const grid = $('.js-mdgrid', mw), empty = $('.js-mdempty', mw), seg = $('.js-mdf', mw), play = $('.js-mdplay', mw), pv = $('video', play);
let MR = { room: '', items: [], f: 'all', cur: null };
const isClip = m => m.kind === 'file' && /^video\//.test((m.data || {}).mime || '');
const srcOf = m => { const d = m.data || {}; return typeof d.src === 'string' && d.src.startsWith('data:') ? d.src : d.ref ? mediaURL(m.room, m.id) : ''; };
OPEN.media = async (_, o = {}) => {
  MR = { room: o.room || S.cur || '', items: [], f: o.f || 'all', cur: null };
  $('.js-mdroom', mw).textContent = MR.room ? roomName(MR.room) : '';
  $$('button', seg).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === MR.f)));
  showPlayer(null); grid.innerHTML = '<div class="mdload">гружу…</div>'; empty.hidden = true;
  try { const r = await api('media_list', { room: MR.room, limit: 300 }); MR.items = r.msgs || []; } catch (e) { MR.items = []; }
  renderGrid();
};
CLOSE.media = () => { try { pv.pause(); } catch (_) {} pv.removeAttribute('src'); pv.load(); };
function renderGrid() {
  const mine = recent.filter(c => c.room === MR.room && !c.sent);
  const list = MR.items.filter(m => MR.f === 'all' || (MR.f === 'clip' ? isClip(m) : !isClip(m)));
  const nC = MR.items.filter(isClip).length, nP = MR.items.length - nC;
  $('.js-mdn', mw).textContent = MR.items.length ? `${nC} ${plural(nC, 'клип', 'клипа', 'клипов')} · ${nP} ${plural(nP, 'картинка', 'картинки', 'картинок')}` : '';
  const fresh = MR.f !== 'pic' && mine.length ? `<div class="mdsec">Только что · ещё не в чате</div>` + mine.map((c, i) => `<div class="mdt clip fresh" data-fresh="${i}"><video muted preload="metadata" src="${esc(c.url || (c.url = URL.createObjectURL(c.blob)))}#t=0.3"></video><span class="mdd">${secs(c.dur)} сек</span><span class="mdx"><button type="button" class="gbtn sm" data-fsend="${i}">${ic('send')}В чат</button><button type="button" class="gbtn sm" data-fsave="${i}">${ic('download')}</button></span></div>`).join('') + (list.length ? '<div class="mdsec">В чате</div>' : '') : '';
  grid.innerHTML = fresh + list.map(m => {
    const d = m.data || {}, src = srcOf(m), who = `<span class="mdw"><img alt="" src="${avaOf(m.from)}">${esc(nickOf(m.from))} · ${esc(when(m.ts))}</span>`;
    if (!src) return `<div class="mdt gone" title="ещё не докачалось">${ic(isClip(m) ? 'film' : 'image')}${who}</div>`;
    return isClip(m)
      ? `<button type="button" class="mdt clip" data-id="${esc(m.id)}" title="Смотреть"><video muted preload="metadata" src="${esc(src)}#t=0.3"></video><span class="mdp">${ic('play')}</span>${d.dur ? `<span class="mdd">${secs(d.dur)} сек</span>` : ''}${who}</button>`
      : `<button type="button" class="mdt pic" data-id="${esc(m.id)}" title="Открыть"><img alt="" loading="lazy" decoding="async" src="${esc(src)}">${who}</button>`;
  }).join('');
  empty.hidden = !!(list.length || fresh);
  if (!empty.hidden) empty.innerHTML = `${ic(MR.f === 'pic' ? 'image' : 'clapperboard')}<b>${MR.f === 'pic' ? 'Картинок пока нет' : 'Клипов пока нет'}</b><span>${MR.f === 'pic' ? 'скрины и картинки из этого чата соберутся здесь' : `в звонке жми <kbd class="k">${esc(keyLabel(keyOf('clip')) || 'F8')}</kbd> — сохранятся последние ${Math.round(keep() / 1000)} секунд`}</span>`;
}
seg.addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; MR.f = b.dataset.v; renderGrid(); });
grid.addEventListener('click', e => {
  const t = e.target; if (!(t instanceof Element)) return;
  const fs = t.closest('[data-fsend]'); if (fs) { const c = recent.filter(c => c.room === MR.room && !c.sent)[+fs.dataset.fsend]; if (c) sendClip(c).then(() => OPEN.media(null, { room: MR.room, f: MR.f })); return; }
  const fv = t.closest('[data-fsave]'); if (fv) { const c = recent.filter(c => c.room === MR.room && !c.sent)[+fv.dataset.fsave]; if (c) saveClip(c); return; }
  const fr = t.closest('[data-fresh]'); if (fr) { const c = recent.filter(c => c.room === MR.room && !c.sent)[+fr.dataset.fresh]; if (c) showPlayer({ src: c.url, title: `${secs(c.dur)} сек · только что`, fresh: c }); return; }
  const it = t.closest('.mdt[data-id]'); if (!it) return;
  const m = MR.items.find(x => x.id === it.dataset.id); if (!m) return;
  if (isClip(m)) showPlayer({ src: srcOf(m), title: `${nickOf(m.from)} · ${when(m.ts)}`, m });
  else { closeW(); openPic(srcOf(m)); }
});
function showPlayer(o) {
  MR.cur = o; play.hidden = !o; grid.hidden = !!o; seg.parentElement.hidden = !!o; if (o) empty.hidden = true;
  if (!o) { try { pv.pause(); } catch (_) {} return; }
  pv.src = o.src; pv.play().catch(() => {});
  $('.js-mdpinfo', mw).textContent = o.title;
  $('.js-mdjump', mw).hidden = !o.m;
}
$('.js-mdback', mw).addEventListener('click', () => { showPlayer(null); renderGrid(); });
$('.js-mdsave', mw).addEventListener('click', async () => {
  const o = MR.cur; if (!o) return;
  if (o.fresh) return saveClip(o.fresh);
  try { const d = o.m.data || {}; const path = typeof d.src === 'string' && d.src.startsWith('data:') ? await saveFile(d.name || 'clip.webm', d.src) : await import('./api.js').then(a => a.saveMedia(o.m.room, o.m.id, d.name || 'clip.webm')); if (inTauri) tmsg('ok', 'сохранил: ' + path); else tmsg('ok', 'скачиваю'); } catch (e) { fail(e); }
});
$('.js-mdjump', mw).addEventListener('click', async () => {
  const m = MR.cur && MR.cur.m; if (!m) return; closeW();
  if (S.cur !== m.room) { await openChat(m.room); await sleep(260); }
  jump(m.room, m.id, m.ts);
});
