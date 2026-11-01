// Демка: экран из голоса (вебки — в плитках участников), указка/карандаш/реакции поверх (синхронно у всех), превью в мини-окне
import { $, $$, R, esc, ic, clamp, prefs, bus, reduce } from './core.js';
import { api } from './api.js';
import { S, myId, myNick, nickOf, avaOf, colorOf, dmPeer, voiceIn } from './state.js';
import { app, tmsg, tone, sfx } from './ui.js';
import { V, setShareQ } from './voice.js';
import { openMenu } from './menu.js';
import { HUNTY, stkSrc, stkName } from './stickers.js';

const stb = $('.js-stb'), scr = $('.js-screen'), dvid = $('.js-dvid');
const ink = $('.js-ink'), pins = $('.js-pins'), fl = $('.js-floaters');
const tools = $('.js-tools'), thint = $('.js-thint'), cx2 = ink.getContext('2d');
const dlive = $('.js-dlive'), dmeta = $('.js-dmeta'), dtag = $('.js-dtag'), sw = $('.js-dsw'), dq = $('.js-dq');
const wav = $('.js-wav'), wtx = $('.js-wtx'), rbar = $('.js-rbar');
const mini = $('.js-mini'), mscr = $('.js-mscr'), mwho = $('.js-mwho'), mlive = $('.mi-h .live', mini);

/* ---------- кто что показывает ---------- */
const MED = new Map();          // peer → {cam, scr}
const DRAW = new Map();         // peer → можно ли рисовать на его демке
let order = [];                 // порядок запуска демок
let focus = '', manual = false; // чью демку смотрю
const rid = () => Math.random().toString(36).slice(2, 9);
const room = () => V.room;
const isDM = () => { const r = S.rooms.get(V.room); return !!(r && r.kind === 'dm'); };
const sharers = () => order.filter(p => MED.get(p) && MED.get(p).scr);
const drawOk = p => p === myId() ? V.drawOk !== false : DRAW.get(p) !== false;
/** чей экран сейчас на сцене (или null) */
export const focusStream = () => (focus && MED.get(focus) && MED.get(focus).scr) || null;

bus.on('media', (peer, k, st) => {
  const m = MED.get(peer) || {}; m[k] = st || null; MED.set(peer, m);
  if (k === 'scr') {
    order = order.filter(p => p !== peer);
    if (st) { order.push(peer); if (!manual || !sharers().includes(focus)) { focus = peer; manual = false; } }
    else {
      if (focus === peer) { focus = sharers().slice(-1)[0] || ''; manual = false; }
      clearFrom(null, peer);
    }
    if (st && peer !== myId()) { tmsg('ok', `${nickOf(peer)} показывает экран${drawOk(peer) ? ' · можно рисовать поверх' : ''}`); sfx('streamon', .6); }
  }
  render();
});
bus.on('ev:share', v => { if (v.room !== room() || !v.data) return; DRAW.set(v.from, v.data.draw !== false); render(); });
bus.on('vleft', () => { MED.clear(); DRAW.clear(); order = []; focus = ''; manual = false; strokes = []; pins.innerHTML = ''; fl.innerHTML = ''; setTool('none'); render(); });
bus.on('voice', (r) => { if (r === room()) renderWatch(); });
bus.on('layout', () => { render(); requestAnimationFrame(() => { sizeInk(); redraw(); }); });
bus.on('panes', () => { sizeInk(); redraw(); });
bus.on('profile', () => render());
bus.on('shareq', () => meta());

/* ---------- отрисовка ---------- */
let fpsTxt = '', hadScr = false;
export function render() {
  const me = myId(), sh = sharers();
  if (focus && !sh.includes(focus)) focus = sh.slice(-1)[0] || '';
  const st = focusStream(), mine = focus === me;
  if (st) { if (dvid.srcObject !== st) { dvid.srcObject = st; fpsTxt = ''; dvid.play().catch(() => {}); } dvid.hidden = false; }
  else { if (dvid.srcObject) dvid.srcObject = null; dvid.hidden = true; }
  // нет экрана — сцена отдаётся плиткам; есть — экран крупно, плитки полоской снизу
  scr.hidden = !st; stb.classList.toggle('has-scr', !!st); scr.classList.toggle('has-scr', !!st); scr.classList.toggle('mine', mine);
  if (hadScr !== !!st) { hadScr = !!st; bus.emit('stagevid'); }
  const can = !!st && drawOk(focus);
  tools.hidden = !can; if (!can && scr.dataset.tool !== 'none') setTool('none');
  dlive.hidden = !st; dtag.hidden = !can;
  dq.hidden = !(st && mine && V.share);
  meta();
  // переключатель, если показывают несколько
  sw.innerHTML = sh.length > 1 ? sh.map(p => `<button type="button" class="dswb${p === focus ? ' on' : ''}" data-u="${esc(p)}" title="Смотреть демку ${esc(nickOf(p))}"><img alt="" src="${avaOf(p)}">${esc(p === me ? 'ты' : nickOf(p))}</button>`).join('') : '';
  renderWatch(); renderMini();
  if (st) requestAnimationFrame(() => { sizeInk(); redraw(); });
}
function meta() {
  const st = focusStream();
  if (!st) { dmeta.textContent = ''; return; }
  const t = st.getVideoTracks()[0], s = t && t.getSettings ? t.getSettings() : {};
  const h = focus === myId() ? s.height : dvid.videoHeight, fps = focus === myId() ? Math.round(s.frameRate || 0) : fpsTxt;
  dmeta.textContent = `${focus === myId() ? 'твой экран' : nickOf(focus)}${h ? ' · ' + h + 'p' : ''}${fps ? ' · ' + fps + ' fps' : ''}`;
  if (!dq.hidden) $('span', dq).textContent = `${s.height || prefs.shareRes || 1080}p · ${Math.round(s.frameRate || prefs.shareFps || 30)}`;
}
dvid.addEventListener('resize', meta);
dvid.addEventListener('loadedmetadata', () => { meta(); sizeInk(); redraw(); });
sw.addEventListener('click', e => { const b = e.target.closest('[data-u]'); if (!b) return; focus = b.dataset.u; manual = true; strokes = []; pins.innerHTML = ''; render(); });
// качество своей демки — на лету, без перезапуска
dq.addEventListener('click', e => {
  e.stopPropagation();
  const res = +prefs.shareRes || 1080, fps = +prefs.shareFps || 30;
  openMenu([
    { head: 'Качество показа', sub: 'меняется сразу, без перезапуска' },
    ...[[720, 'для слабого интернета'], [1080, 'чётко'], [1440, 'очень чётко · нужен хороший интернет']].map(([r, d]) => ({ label: r + 'p', sub: d, check: r === res, fn: () => setShareQ(r, fps) })),
    '-',
    ...[[15, 'текст, код, презентации'], [30, 'обычно'], [60, 'игры и видео']].map(([f, d]) => ({ label: f + ' fps', sub: d, check: f === fps, fn: () => setShareQ(res, f) })),
  ], { el: dq });
});
// fps у входящей демки — из статистики WebRTC
setInterval(async () => {
  if (!focus || focus === myId() || dvid.hidden) return;
  const P = V.peers.get(focus), st = focusStream(); if (!P || !st) return;
  const tid = (st.getVideoTracks()[0] || {}).id;
  try { const rs = await P.pc.getStats(); rs.forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'video' && (!x.trackIdentifier || x.trackIdentifier === tid) && x.framesPerSecond) fpsTxt = Math.round(x.framesPerSecond); }); meta(); } catch (_) {}
}, 2000);

/* кто смотрит */
function renderWatch() {
  if (!room()) { wav.innerHTML = ''; wtx.textContent = '—'; return; }
  const me = myId(), ids = Object.keys(voiceIn(room()));
  if (!ids.includes(me)) ids.unshift(me);
  const st = focus && MED.get(focus) && MED.get(focus).scr;
  if (st) {
    const w = ids.filter(p => p !== focus).sort((a, b) => (a === me ? -1 : b === me ? 1 : 0));
    wav.innerHTML = w.slice(0, 6).map(p => `<img alt="" src="${avaOf(p)}" title="${esc(nickOf(p))}">`).join('');
    wtx.textContent = focus === me ? (w.length ? 'смотрят: ' + w.map(nickOf).join(', ') : 'пока никто не смотрит') : 'смотрят: ' + w.map(p => p === me ? 'ты' : nickOf(p)).join(', ');
  } else {
    wav.innerHTML = ids.slice(0, 6).map(p => `<img alt="" src="${avaOf(p)}" title="${esc(nickOf(p))}">`).join('');
    wtx.textContent = `в голосе ${ids.length}`;
  }
}

/* ---------- мини-окно: превью экрана, вебки или аватарки ---------- */
const mvid = document.createElement('video'); mvid.className = 'mi-vid'; mvid.muted = true; mvid.autoplay = true; mvid.playsInline = true; mvid.hidden = true;
const mdm = document.createElement('span'); mdm.className = 'mi-dm'; mdm.setAttribute('aria-hidden', 'true');
mscr.prepend(mvid); mscr.prepend(mdm);
function renderMini() {
  if (!room()) { mvid.srcObject = null; return; }
  const me = myId();
  const st = focus && MED.get(focus) ? MED.get(focus).scr : null;
  const camP = !st ? [...MED.entries()].filter(([p, m]) => m.cam && p !== me).map(([p]) => p)[0] : '';
  const src = st || (camP ? MED.get(camP).cam : null);
  if (src) { if (mvid.srcObject !== src) { mvid.srcObject = src; mvid.play().catch(() => {}); } mvid.hidden = false; }
  else { mvid.srcObject = null; mvid.hidden = true; }
  mini.classList.toggle('dm', !src); mlive.hidden = !src;
  mvid.classList.toggle('cam', !st && !!camP);
  const ids = Object.keys(voiceIn(room())); if (!ids.includes(me)) ids.unshift(me);
  mdm.classList.toggle('many', ids.length > 3);
  mdm.innerHTML = ids.slice(0, 6).map(p => `<img alt="" data-u="${esc(p)}" src="${avaOf(p)}">`).join('');
  const dm = isDM(), peer = dm ? dmPeer(V.room) : '';
  const P = peer && V.peers.get(peer), rtt = P && P.rtt != null ? P.rtt + 'ms' : '';
  mwho.innerHTML = st ? `<span class="mi-dot"></span>${esc(focus === me ? 'ты' : nickOf(focus))} · экран`
    : camP ? `<span class="mi-dot"></span>${esc(nickOf(camP))} · вебка`
    : dm ? `<span class="mi-dot ok"></span>${esc(nickOf(peer))}${rtt ? ' · ' + rtt : ''}` : `<span class="mi-dot ok"></span>голос · ${ids.length}`;
}
const talkT = new Map();
bus.on('talk', peer => {
  const im = $(`img[data-u="${CSS.escape(peer)}"]`, mdm); if (!im) return;
  im.classList.add('talking'); clearTimeout(talkT.get(peer)); talkT.set(peer, setTimeout(() => im.classList.remove('talking'), 260));
});
bus.on('layout', renderMini); bus.on('voice', () => renderMini());
setInterval(() => { if (room() && !mini.hidden && isDM()) renderMini(); }, 3000);

/* ---------- указка и карандаш: координаты — доли картинки, поэтому у всех совпадает ---------- */
const PENS = [null, '#ffc66b', '#63e6ff', '#ff6f8c', '#ffffff']; let penI = 0;
const accCol = () => getComputedStyle(R).getPropertyValue('--acc').trim() || '#8dffb8';
const myCol = () => { const c = colorOf(myId()); return !c || c.startsWith('var') ? accCol() : c; };
const penCol = () => PENS[penI] || myCol();
const syncPen = () => scr.style.setProperty('--pen', penCol());
const FADE = 900;
const life = () => (+prefs.pinTtl === 0 ? Infinity : (+prefs.pinTtl || 10) * 1000);
let strokes = [], raf = 0, drawing = null;
function sizeInk() {
  const r = ink.getBoundingClientRect(), d = devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (ink.width !== w || ink.height !== h) { ink.width = w; ink.height = h; }
  return r;
}
/** прямоугольник картинки внутри video (object-fit: contain), в долях холста */
function box() {
  const r = ink.getBoundingClientRect(), vr = dvid.getBoundingClientRect();
  const vw = dvid.videoWidth, vh = dvid.videoHeight;
  let x = vr.left, y = vr.top, w = vr.width, h = vr.height;
  if (vw && vh && w && h) { const k = Math.min(w / vw, h / vh); const cw = vw * k, ch = vh * k; x += (w - cw) / 2; y += (h - ch) / 2; w = cw; h = ch; }
  return { x: (x - r.left) / (r.width || 1), y: (y - r.top) / (r.height || 1), w: w / (r.width || 1), h: h / (r.height || 1), r };
}
const toScreen = (p, b) => [b.x + p[0] * b.w, b.y + p[1] * b.h]; // доли холста
function render2() {
  raf = 0; sizeInk();
  const W = ink.width, H = ink.height, d = devicePixelRatio || 1, lw = Math.max(2.5, W / (ink.getBoundingClientRect().width || 1) * 3.2), now = performance.now(), L = life(), b = box();
  cx2.clearRect(0, 0, W, H);
  strokes = strokes.filter(s => { const alive = s.live || now - s.t < L + FADE; if (!alive && s.tag) s.tag.remove(); return alive; });
  cx2.lineCap = 'round'; cx2.lineJoin = 'round';
  for (const s of strokes) {
    if (s.on !== focus) continue;
    const age = s.live ? 0 : now - s.t, a = age < L ? 1 : Math.max(0, 1 - (age - L) / FADE);
    const P2 = s.pts.map(p => { const q = toScreen(p, b); return [q[0] * W, q[1] * H]; }); if (!P2.length) continue;
    const path = () => {
      cx2.beginPath(); cx2.moveTo(P2[0][0], P2[0][1]); if (P2.length === 1) cx2.lineTo(P2[0][0] + .01, P2[0][1]);
      for (let i = 1; i < P2.length - 1; i++) { const mx = (P2[i][0] + P2[i + 1][0]) / 2, my = (P2[i][1] + P2[i + 1][1]) / 2; cx2.quadraticCurveTo(P2[i][0], P2[i][1], mx, my); }
      if (P2.length > 1) { const q = P2[P2.length - 1]; cx2.lineTo(q[0], q[1]); }
    };
    cx2.globalAlpha = a * .35; cx2.strokeStyle = '#000'; cx2.lineWidth = lw + 3 * d; path(); cx2.stroke();
    cx2.globalAlpha = a; cx2.strokeStyle = s.c; cx2.lineWidth = lw; cx2.shadowColor = s.c; cx2.shadowBlur = 10 * d; path(); cx2.stroke(); cx2.shadowBlur = 0;
    if (s.tag) { s.tag.style.opacity = String(a); placeTag(s.tag, s.pts[s.pts.length - 1], b); }
  }
  cx2.globalAlpha = 1;
  $$('.pin', pins).forEach(el => placePin(el, b));
  if (strokes.some(s => s.live || (L !== Infinity))) { if (strokes.length) raf = requestAnimationFrame(render2); }
}
const redraw = () => { if (!raf) raf = requestAnimationFrame(render2); };
function norm(e) { const b = box(), r = b.r; const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height; return [+clamp((fx - b.x) / (b.w || 1), 0, 1).toFixed(4), +clamp((fy - b.y) / (b.h || 1), 0, 1).toFixed(4)]; }
function placeTag(t, p, b = box()) { const q = toScreen([Math.min(p[0], .86), p[1]], b); t.style.left = `calc(${(q[0] * 100).toFixed(2)}% + 8px)`; t.style.top = `calc(${(q[1] * 100).toFixed(2)}% - 26px)`; }
function tagAt(p, label, col) { const t = document.createElement('span'); t.className = 'inktag'; t.style.background = col; t.textContent = label; pins.appendChild(t); placeTag(t, p); return t; }
function placePin(el, b) { const q = toScreen([+el.dataset.x, +el.dataset.y], b); el.style.left = (q[0] * 100).toFixed(2) + '%'; el.style.top = (q[1] * 100).toFixed(2) + '%'; }
function pinAt(p, label, col, from) {
  const el = document.createElement('div'); el.className = 'pin'; el.dataset.x = p[0]; el.dataset.y = p[1]; el.dataset.from = from;
  el.style.setProperty('--pc', col); el.innerHTML = `<i></i><b>${esc(label)}</b>`; pins.appendChild(el); placePin(el, box());
  sfx('tick', .6);
  const L = life(); if (L !== Infinity) setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, Math.max(2000, L - 600));
  return el;
}
const send = (kind, data) => { if (room()) api('ev', { room: room(), kind, data: { ...data, on: focus } }).catch(() => {}); };
function myPin(p) { pinAt(p, myNick(), myCol(), myId()); send('pin', { x: p[0], y: p[1], c: myCol() }); tmsg('ok', 'метка поставлена · её видят все, кто смотрит демку'); }
// свой штрих уходит пачками, чтобы не спамить сеть
let flushT = 0, sent = 0;
function flush(end) {
  clearTimeout(flushT); flushT = 0; const s = drawing || (end && end.s); if (!s) return;
  const pts = s.pts.slice(sent); sent = s.pts.length;
  if (pts.length || end) send('ink', { s: s.id, c: s.c, p: pts, n: sent - pts.length, end: !!end });
}
ink.addEventListener('pointerdown', e => {
  const tool = scr.dataset.tool;
  if (tool === 'ptr') { myPin(norm(e)); return; }
  if (tool !== 'pen') return;
  e.preventDefault(); try { ink.setPointerCapture(e.pointerId); } catch (_) {}
  drawing = { id: rid(), pts: [norm(e)], c: penCol(), live: true, me: true, from: myId(), on: focus, t: performance.now() };
  sent = 0; strokes.push(drawing); redraw(); flushT = setTimeout(() => flush(), 50);
});
ink.addEventListener('pointermove', e => {
  if (!drawing) return;
  const p = norm(e), q = drawing.pts[drawing.pts.length - 1];
  if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > .002) { drawing.pts.push(p); if (!flushT) flushT = setTimeout(() => flush(), 60); }
  redraw();
});
function endDraw() {
  if (!drawing) return; const s = drawing; flush({ s }); drawing = null;
  s.live = false; s.t = performance.now(); s.tag = tagAt(s.pts[s.pts.length - 1], myNick(), s.c);
  const n = Math.max(0, Object.keys(voiceIn(room())).length - 1);
  if (s.pts.length > 2) tmsg('ok', `штрих видят все в голосе (${n})${life() !== Infinity ? ' · исчезнет через ' + Math.round(life() / 1000) + ' сек' : ''}`);
  redraw();
}
ink.addEventListener('pointerup', endDraw); ink.addEventListener('pointercancel', endDraw);
scr.addEventListener('click', e => { if (!e.altKey || scr.dataset.tool !== 'none' || dvid.hidden || !drawOk(focus)) return; myPin(norm(e)); });
export function setTool(t) {
  scr.dataset.tool = t; $$('.tl[data-tool]', tools).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  thint.hidden = t === 'none'; thint.textContent = t === 'pen' ? 'веди мышкой — карандаш · видят все' : 'клик — метка, её видят все';
  if (t !== 'none') sizeInk();
}
$$('.tl[data-tool]', tools).forEach(b => b.addEventListener('click', () => setTool(scr.dataset.tool === b.dataset.tool ? 'none' : b.dataset.tool)));
$('.js-pencolor').addEventListener('click', () => { penI = (penI + 1) % PENS.length; syncPen(); if (scr.dataset.tool !== 'pen') setTool('pen'); });
$('.js-erase').addEventListener('click', () => { clearFrom(myId()); send('erase', {}); tmsg('ok', 'стёр своё · у остальных тоже пропало'); });
function clearFrom(from, on) {
  strokes = strokes.filter(s => { const hit = (from == null || s.from === from) && (on == null || s.on === on); if (hit && s.tag) s.tag.remove(); return !hit; });
  $$('.pin', pins).forEach(p => { if (from == null || p.dataset.from === from) p.remove(); });
  redraw();
}
// полный экран
const dfull = $('.js-dfull');
dfull.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else scr.requestFullscreen && scr.requestFullscreen().catch(() => tmsg('warn', 'полный экран недоступен')); });
document.addEventListener('fullscreenchange', () => { const on = document.fullscreenElement === scr; dfull.innerHTML = ic(on ? 'minimize-2' : 'maximize-2'); dfull.title = on ? 'Выйти из полного экрана' : 'На весь экран'; setTimeout(() => { sizeInk(); redraw(); }, 60); });
dvid.addEventListener('dblclick', () => dfull.click());
syncPen(); setTool('none');

/* входящие штрихи, метки, стирание */
const remote = new Map();
bus.on('ev:ink', v => {
  if (v.room !== room() || !v.data || v.from === myId()) return;
  const d = v.data, key = v.from + ':' + d.s;
  let s = remote.get(key);
  if (!s) {
    s = { id: d.s, pts: [], c: String(d.c || '#fff').slice(0, 24), live: true, from: v.from, on: d.on || '', t: performance.now() };
    remote.set(key, s); strokes.push(s);
  }
  (Array.isArray(d.p) ? d.p : []).slice(0, 400).forEach(p => { if (Array.isArray(p) && p.length === 2) s.pts.push([clamp(+p[0] || 0, 0, 1), clamp(+p[1] || 0, 0, 1)]); });
  clearTimeout(s.to);
  const fin = () => { if (!s.live) return; s.live = false; s.t = performance.now(); remote.delete(key); if (s.pts.length) s.tag = tagAt(s.pts[s.pts.length - 1], nickOf(v.from), s.c); redraw(); };
  if (d.end) fin(); else s.to = setTimeout(fin, 3000);
  redraw();
});
bus.on('ev:pin', v => {
  if (v.room !== room() || !v.data || v.from === myId() || (v.data.on || '') !== focus) return;
  pinAt([clamp(+v.data.x || 0, 0, 1), clamp(+v.data.y || 0, 0, 1)], nickOf(v.from), String(v.data.c || colorOf(v.from)).slice(0, 24), v.from);
  tmsg('ok', `${nickOf(v.from)} показывает на демке`, 1);
});
bus.on('ev:erase', v => { if (v.room === room()) clearFrom(v.from); });

/* ---------- реакции ---------- */
const HK = new Set(HUNTY.map(h => h[0]));
const RX = ['fire', 'joy', 'grimace', 'thumbs', 'eyes', 'skull'].filter(k => HK.has(k));
rbar.innerHTML = RX.map(k => `<button class="rbtn" type="button" data-r="${k}" aria-label="${esc(stkName({ k }))}" title="${esc(stkName({ k }))}"><img alt="" src="${stkSrc({ k })}"></button>`).join('');
function floatEmo(k, who) {
  if (!HK.has(k) || reduce && fl.children.length > 3) return;
  const s = document.createElement('span'); s.className = 'floater';
  s.style.left = (6 + Math.random() * 76) + '%'; s.style.setProperty('--dx', (Math.random() * 40 - 20).toFixed(0) + 'px'); s.style.setProperty('--rot', (Math.random() * 24 - 12).toFixed(0) + 'deg');
  s.innerHTML = `<img alt="" src="${stkSrc({ k })}">` + (who ? `<b>${esc(who)}</b>` : '');
  fl.appendChild(s); while (fl.children.length > 16) fl.firstElementChild.remove();
  setTimeout(() => s.remove(), 2700);
}
let rxT = 0;
rbar.addEventListener('click', e => {
  const b = e.target.closest('.rbtn'); if (!b || !room()) return;
  floatEmo(b.dataset.r, myNick()); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); sfx('pop', .5);
  if (Date.now() - rxT > 250) { rxT = Date.now(); send('react', { k: b.dataset.r }); }
});
bus.on('ev:react', v => { if (v.room === room() && v.data && HK.has(v.data.k)) floatEmo(v.data.k, nickOf(v.from)); });

render();
