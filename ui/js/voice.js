// Голос: WebRTC mesh (до 6), сигналинг через P2P-ядро, мик/звук/вебка/демка, звонки в личке, кнопки F1–F6
import { $, $$, esc, ic, dur, pick, clamp, mobile, reduce, prefs, setPref, bus, sleep, short } from './core.js';
import { api } from './api.js';
import { S, myId, myNick, nickOf, avaOf, colorOf, roomName, dmPeer, voiceIn, voiceCount, isOnline } from './state.js';
import { app, tmsg, tone, TONES, toast, closeToast, fail, notify, speak, actx, openW, closeW, fit, glitch, OPEN, segSet, segGet } from './ui.js';
import { getMic, makeGate, gateSet } from './audio.js';
import { onCtx } from './menu.js';
import { personItems, mutedFor, volOf } from './people.js';

export const MAXV = 6;
export const V = {
  room: '', since: 0, mic: true, deaf: false, cam: false, share: false,
  raw: null, micS: null, track: null, proc: null, gain: null, an: null, gate: null, gateOpen: true, level: 0,
  camS: null, scrS: null, peers: new Map(), resets: new Map(), mini: false, manualMini: false, ptt: false,
};
const rid = () => Math.random().toString(36).slice(2, 10);
const micOn = () => V.mic && !V.deaf && (!+prefs.ptt || V.ptt);
const myState = () => ({ mic: V.mic && !V.deaf, deaf: V.deaf, cam: V.cam, share: V.share, since: 0 });
export const inVoice = () => !!V.room;
const pushState = () => { if (V.room) api('voice_state', { state: myState() }).catch(() => {}); };

/* ---------- микрофон ---------- */
async function micStart() {
  let raw = null;
  try { raw = await getMic(); }
  catch (e) { tmsg('warn', 'микрофон недоступен — тебя не слышно, но ты всех слышишь'); V.mic = false; }
  V.raw = raw;
  const ctx = actx();
  if (raw && ctx) {
    const src = ctx.createMediaStreamSource(raw);
    V.gain = ctx.createGain(); V.gain.gain.value = (prefs.micVol ?? 100) / 100;
    const dest = ctx.createMediaStreamDestination();
    V.an = ctx.createAnalyser(); V.an.fftSize = 512; V.an.smoothingTimeConstant = .5;
    // порог голоса: тише порога — в звонок идёт тишина (фон и клава между фразами)
    const gate = ctx.state === 'running' ? await makeGate(ctx, m => { V.gateOpen = !!m[0]; }) : null;
    if (V.raw !== raw) { if (gate) gate.disconnect(); return; } // пока ждали — вышли из голоса
    V.gate = gate; V.gateOpen = true;
    src.connect(V.gain); V.gain.connect(V.an);
    if (gate) { V.gain.connect(gate); gate.connect(dest); } else V.gain.connect(dest);
    V.micS = dest.stream; V.proc = dest.stream.getAudioTracks()[0];
    // пока AudioContext не запущен (Firefox до первого клика, нет аудиовыхода), из графа идёт тишина —
    // шлём мик напрямую (без ползунка громкости), а как контекст оживёт — подменяем на обработанный
    if (ctx.state === 'running') V.track = V.proc;
    else {
      V.track = raw.getAudioTracks()[0];
      const up = () => {
        if (V.raw !== raw) return ctx.removeEventListener('statechange', up);
        if (ctx.state !== 'running') return;
        ctx.removeEventListener('statechange', up);
        raw.getAudioTracks().forEach(t => { t.enabled = true; });
        V.track = V.proc; V.track.enabled = micOn();
        for (const P of V.peers.values()) if (P.micTx) P.micTx.replaceTrack(V.track).catch(() => {});
      };
      ctx.addEventListener('statechange', up);
    }
  } else if (raw) { V.micS = raw; V.track = raw.getAudioTracks()[0]; }
  else { V.micS = new MediaStream(); V.track = null; }
  if (V.track) V.track.enabled = micOn();
}
function micStop() {
  if (V.raw) V.raw.getTracks().forEach(t => t.stop()); [V.track, V.proc].forEach(t => { if (t) t.stop(); });
  if (V.gate) { try { V.gate.port.onmessage = null; V.gate.disconnect(); } catch (_) {} }
  V.raw = V.track = V.proc = V.micS = V.gain = V.an = V.gate = null; V.gateOpen = true;
}
async function micRestart() {
  if (!V.room) return;
  const old = V.track; micStop(); await micStart();
  for (const P of V.peers.values()) { if (P.micTx) { try { await P.micTx.replaceTrack(V.track); } catch (_) {} } else if (V.track) P.micTx = P.pc.addTrack(V.track, V.micS); }
  if (old) old.stop();
  sendMetaAll();
}
function applyMic() { if (V.track) V.track.enabled = micOn(); syncCtrl(); renderRows(); }

/* ---------- соединения ---------- */
function sig(P, m) {
  m.sid = P.sid; m.q = P.q++;
  api('rtc', { room: V.room, to: P.peer, data: m }).catch(() => {});
}
const meta = () => ({ t: 'meta', m: { mic: V.micS ? V.micS.id : '', cam: V.camS ? V.camS.id : '', scr: V.scrS ? V.scrS.id : '' } });
function sendMetaAll() { for (const P of V.peers.values()) sig(P, meta()); }
function pcFor(peer) {
  let P = V.peers.get(peer); if (P) return P;
  const pc = new RTCPeerConnection({ iceServers: Array.isArray(S.ice) ? S.ice : [], bundlePolicy: 'max-bundle' });
  P = { peer, pc, polite: myId() < peer, makingOffer: false, ignoreOffer: false, sid: rid(), q: 0, rsid: '', rexp: 0, rbuf: new Map(), rto: 0, chain: Promise.resolve(),
    kinds: {}, media: {}, audioEls: new Map(), boost: new Map(), an: null, level: 0, talkT: 0, pend: [], restarts: 0, rtt: null, path: '' };
  V.peers.set(peer, P);
  sig(P, meta());
  if (V.track) P.micTx = pc.addTrack(V.track, V.micS);
  else P.micTx = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
  if (V.camS) P.camTx = pc.addTrack(V.camS.getVideoTracks()[0], V.camS);
  if (V.scrS) P.scrTx = V.scrS.getTracks().map(t => pc.addTrack(t, V.scrS));
  pc.onnegotiationneeded = async () => {
    try { P.makingOffer = true; await pc.setLocalDescription(); sig(P, { t: 'd', d: pc.localDescription.toJSON() }); }
    catch (e) { console.warn('offer', e); } finally { P.makingOffer = false; }
  };
  pc.onicecandidate = e => { if (e.candidate) sig(P, { t: 'c', c: e.candidate.toJSON() }); };
  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState;
    clearTimeout(P.dt);
    if (s === 'connected' || s === 'completed') { P.restarts = 0; V.resets.delete(peer); applyBitrate(P); renderRows(); }
    if (s === 'disconnected') P.dt = setTimeout(() => { if (pc.iceConnectionState === 'disconnected' && V.peers.get(peer) === P) { try { pc.restartIce(); } catch (_) {} } }, 4000);
    if (s === 'failed') {
      if (P.restarts++ < 2) { try { pc.restartIce(); } catch (_) {} }
      else tmsg('err', `голос до ${nickOf(peer)} не пробился: у обоих строгий NAT — нужен TURN (сервер-ретранслятор), а его нет`);
    }
    renderRows();
  };
  pc.ontrack = e => onTrack(P, e);
  // сторож: ICE не сошёлся за пару секунд (завис сбор кандидатов, потерялся сигнал) — сначала restartIce,
  // потом (только «невежливая» сторона, чтобы не было пинг-понга) пересоздаём соединение целиком
  const wd = n => { P.wd = setTimeout(() => {
    if (V.peers.get(peer) !== P || pc.signalingState === 'closed') return;
    const s = pc.iceConnectionState; if (s === 'connected' || s === 'completed') return;
    if (n === 0) { console.info('ice watchdog: restartIce', peer.slice(-6), s, pc.iceGatheringState); try { pc.restartIce(); } catch (_) {} if (!P.polite) wd(1); return; }
    const k = V.resets.get(peer) || 0; if (k >= 3) return;
    V.resets.set(peer, k + 1); console.info('ice watchdog: новое соединение', peer.slice(-6), k + 1);
    closePeer(peer); pcFor(peer); renderRows();
  }, P.polite ? 6000 : 4000); };
  wd(0);
  return P;
}
function closePeer(peer) {
  const P = V.peers.get(peer); if (!P) return;
  V.peers.delete(peer);
  try { P.pc.close(); } catch (_) {}
  P.audioEls.forEach(a => { a.srcObject = null; a.remove(); });
  P.boost.forEach(b => { try { b.src.disconnect(); b.g.disconnect(); } catch (_) {} }); P.boost.clear();
  clearTimeout(P.rto); clearTimeout(P.wd); clearTimeout(P.dt);
  ['cam', 'scr'].forEach(k => { if (P.media[k]) bus.emit('media', peer, k, null); });
}
async function applyBitrate(P) {
  try {
    const s = P.micTx; if (s && s.track) { const p = s.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; p.encodings[0].maxBitrate = (+prefs.bitrate || 64) * 1000; await s.setParameters(p); }
    for (const tx of P.scrTx || []) {
      if (!tx.track || tx.track.kind !== 'video') continue;
      const p = tx.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      const res = +prefs.shareRes || 1080; p.encodings[0].maxBitrate = (res >= 1440 ? 8 : res >= 1080 ? 5 : 2.5) * 1e6;
      p.degradationPreference = prefs.shareHint === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
      await tx.setParameters(p);
    }
  } catch (_) {}
}
function onTrack(P, e) {
  const st = e.streams[0] || new MediaStream([e.track]);
  const k = st.id === P.kinds.scr ? 'scr' : st.id === P.kinds.cam ? 'cam' : e.track.kind === 'audio' ? 'mic' : 'cam';
  if (e.track.kind === 'audio') {
    let a = P.audioEls.get(st.id);
    if (!a) { a = new Audio(); a.autoplay = true; a.dataset.peer = P.peer; document.body.appendChild(a); a.hidden = true; P.audioEls.set(st.id, a); }
    const ob = P.boost.get(st.id); if (ob) { try { ob.src.disconnect(); ob.g.disconnect(); } catch (_) {} P.boost.delete(st.id); }
    a.srcObject = st; applyVol(P); a.play().catch(() => {});
    if (k === 'mic') { const ctx = actx(); if (ctx) { try { const src = ctx.createMediaStreamSource(st); P.an = ctx.createAnalyser(); P.an.fftSize = 512; P.an.smoothingTimeConstant = .5; src.connect(P.an); } catch (_) {} } }
  } else {
    P.media[k] = st; bus.emit('media', P.peer, k, st);
    e.track.onended = () => { if (P.media[k] === st) { delete P.media[k]; bus.emit('media', P.peer, k, null); } };
    st.onremovetrack = () => { if (!st.getVideoTracks().length && P.media[k] === st) { delete P.media[k]; bus.emit('media', P.peer, k, null); } };
  }
}
// громкость друга: до 100% — громкостью <audio>, выше — через усилитель WebAudio
// (сам <audio> при этом молчит, но остаётся подключённым: без него Chrome не отдаёт звук WebRTC в WebAudio)
function applyVol(P) {
  const v = clamp(((prefs.vol || {})[P.peer] ?? 100) / 100 * ((prefs.outVol ?? 100) / 100), 0, 2);
  const mute = V.deaf || !!(prefs.mute || {})[P.peer];
  const ctx = v > 1.001 && !mute ? actx() : null, boost = !!(ctx && ctx.state === 'running');
  P.audioEls.forEach((a, sid) => {
    const out = prefs.outId || '';
    if (a.setSinkId && (a.sinkId || '') !== out) a.setSinkId(out).catch(() => {});
    let b = P.boost.get(sid);
    if (boost && !b && a.srcObject) {
      try { const src = ctx.createMediaStreamSource(a.srcObject), g = ctx.createGain(); src.connect(g); g.connect(ctx.destination); b = { src, g }; P.boost.set(sid, b); } catch (_) { b = null; }
    }
    if (boost && b) { b.g.gain.value = v; a.muted = true; return; }
    if (b) b.g.gain.value = 0;
    a.volume = clamp(v, 0, 1); a.muted = mute;
  });
}
const applyVolAll = () => V.peers.forEach(applyVol);

/* входящий сигналинг — строго по порядку (запросы в P2P могут обгонять друг друга) */
bus.on('rtc', v => {
  if (!V.room || v.room !== V.room || !voiceIn(V.room)[v.from]) return;
  const m = v.data || {}; if (typeof m.q !== 'number') return;
  let P = V.peers.get(v.from);
  if (P && P.rsid && m.sid !== P.rsid) { if (m.q !== 0) return; closePeer(v.from); P = null; } // друг пересоздал соединение
  if (!P) P = pcFor(v.from);
  if (!P.rsid) {
    if (m.q !== 0) { P.rbuf.set(m.q, m); return; }
    P.rsid = m.sid; for (const [q, x] of P.rbuf) if (x.sid !== m.sid) P.rbuf.delete(q); // хвосты старого соединения — мимо
  }
  if (m.sid !== P.rsid || m.q < P.rexp) return;
  P.rbuf.set(m.q, m);
  drain(P);
});
function drain(P) {
  while (P.rbuf.has(P.rexp)) { const m = P.rbuf.get(P.rexp); P.rbuf.delete(P.rexp); P.rexp++; P.chain = P.chain.then(() => handle(P, m)).catch(e => console.warn('rtc', e)); }
  clearTimeout(P.rto);
  if (P.rbuf.size) P.rto = setTimeout(() => { const ks = [...P.rbuf.keys()].sort((a, b) => a - b); if (ks.length) { P.rexp = ks[0]; drain(P); } }, 2000);
}
async function handle(P, m) {
  const pc = P.pc; if (pc.signalingState === 'closed') return;
  if (m.t === 'meta') { P.kinds = m.m || {}; return; }
  if (m.t === 'd') {
    const d = m.d; const coll = d.type === 'offer' && (P.makingOffer || pc.signalingState !== 'stable');
    P.ignoreOffer = !P.polite && coll; if (P.ignoreOffer) return;
    await pc.setRemoteDescription(d);
    if (d.type === 'offer') { await pc.setLocalDescription(); sig(P, { t: 'd', d: pc.localDescription.toJSON() }); }
    for (const c of P.pend.splice(0)) { try { await pc.addIceCandidate(c); } catch (_) {} }
    return;
  }
  if (m.t === 'c') {
    if (!pc.remoteDescription) { P.pend.push(m.c); return; }
    try { await pc.addIceCandidate(m.c); } catch (e) { if (!P.ignoreOffer) console.warn('cand', e); }
  }
}

/* ---------- зайти / выйти ---------- */
export async function join(room, o = {}) {
  const r = S.rooms.get(room); if (!r) return;
  if (V.room === room) { setMini(false); return; }
  if (r.kind === 'group' && !r.voice) { tmsg('warn', 'в этой группе голосовой канал выключен'); return; }
  const n = Object.keys(voiceIn(room)).filter(p => p !== myId()).length;
  if (n >= MAXV) { tmsg('warn', `в голосе уже ${MAXV} — больше прямых соединений mesh не потянет`); return; }
  if (V.room) await leave({ silent: true });
  V.room = room; V.since = Date.now(); V.mini = false; V.manualMini = false; V.mic = o.mic ?? true; V.deaf = false;
  actx();
  await micStart();
  try {
    const res = await api('voice_join', { room, state: myState() });
    if (V.room !== room) return;
    for (const p of Object.keys(res.peers || {})) if (p !== myId()) pcFor(p);
  } catch (e) { V.room = ''; micStop(); fail(e); layout(); return; }
  if (!o.silent) { tone(TONES.join); tmsg('ok', r.kind === 'dm' ? `звонок с ${nickOf(dmPeer(r))} · напрямую P2P` : `ты в голосе «${r.name}» · ${n ? 'там ' + n : 'пока один — друзья увидят, что ты тут'}`); }
  if (S.cur !== room && !mobile()) { V.mini = true; }
  layout(); vuStart(); bus.emit('vjoined', room);
}
export async function leave(o = {}) {
  if (!V.room) return;
  const room = V.room, secs = (Date.now() - V.since) / 1000;
  if (V.share) stopShare(true);
  if (V.cam) camStop(true);
  for (const p of [...V.peers.keys()]) closePeer(p);
  V.resets.clear(); micStop(); V.room = ''; V.mini = false; popToggle(false);
  try { await api('voice_leave'); } catch (_) {}
  const r = S.rooms.get(room);
  if (r && r.kind === 'dm' && !o.silent && secs > 5 && o.logCall !== false) api('send', { room, kind: 'sys', text: 'call:' + dur(secs) }).then(m => import('./state.js').then(s => s.pushLocal(m))).catch(() => {});
  if (!o.silent) { tone(TONES.leave); tmsg('ok', r && r.kind === 'dm' ? `звонок завершён · ${dur(secs)}` : 'ты вышел из голоса · чат остаётся'); }
  layout(); bus.emit('vleft', room);
}

/* ---------- раскладка: без голоса — список и чат, в голосе — справа демка и голос ---------- */
const vjoin = $('.js-vjoin'), mini = $('.js-mini');
export function layout() {
  const calm = !V.room || V.mini;
  app.classList.toggle('calm', calm); app.classList.toggle('invoice', !!V.room);
  const r = S.rooms.get(V.room);
  app.classList.toggle('dmcall', !!(r && r.kind === 'dm'));
  mini.hidden = !(V.room && V.mini);
  $('.me').classList.toggle('vc', !!V.room);
  syncJoin(); syncCtrl(); renderRows(); renderBar(); fit();
  bus.emit('layout');
}
export function setMini(on, manual) {
  if (!V.room || mobile()) return;
  V.mini = !!on; V.manualMini = V.mini && !!manual; layout();
  if (!V.mini) tmsg('ok', 'звонок развёрнут'); else if (manual) tmsg('ok', 'звонок свёрнут · окошко можно таскать');
}
function syncJoin() {
  const r = S.rooms.get(S.cur);
  if (!V.room) {
    const ok = r && r.kind === 'group' && r.voice && !r.pending;
    vjoin.hidden = !ok; if (!ok) return;
    const n = voiceCount(r.id);
    vjoin.className = 'vjoin js-vjoin';
    vjoin.innerHTML = `${ic('mic')}<span class="n">${n}</span><span class="vj-t">в голосе</span><span class="vj-go">Зайти</span>`;
    vjoin.setAttribute('aria-label', `Зайти в голос «${r.name}», там ${n}`); vjoin.title = `Голос «${r.name}»`;
  } else if (V.mini) {
    vjoin.hidden = false; vjoin.className = 'vjoin min js-vjoin';
    vjoin.innerHTML = `<span class="vj-dot"></span><span class="vj-t">${esc(roomLabel(V.room))}</span><span class="n js-up">${dur((Date.now() - V.since) / 1000)}</span>${ic('maximize-2')}`;
    vjoin.setAttribute('aria-label', 'Развернуть звонок'); vjoin.title = 'Развернуть звонок';
  } else vjoin.hidden = true;
}
const roomLabel = id => { const r = S.rooms.get(id); return r ? (r.kind === 'dm' ? 'лс·' + nickOf(dmPeer(r)) : r.name) : '—'; };
vjoin.addEventListener('click', () => { if (!V.room) join(S.cur); else setMini(false); });
$('.js-vmin').addEventListener('click', () => setMini(true, true));
function renderBar() {
  if (!V.room) return;
  const n = voiceCount(V.room);
  $('.js-vbch').textContent = roomLabel(V.room);
  $$('.js-vcount').forEach(e => e.textContent = n + '/' + MAXV);
  $('.js-mch').textContent = roomLabel(V.room);
  const r = S.rooms.get(V.room);
  $('.js-vmeta').textContent = r && r.kind === 'dm' ? `звонок с ${nickOf(dmPeer(r))} · напрямую P2P` : `${roomLabel(V.room)}, ${n} из ${MAXV} · клик по нику — пнуть`;
}
bus.on('tick', () => {
  if (!V.room) return;
  const s = dur((Date.now() - V.since) / 1000); $$('.js-up').forEach(e => e.textContent = s);
  if (brbUntil && brbUntil < Date.now()) { brbUntil = 0; tmsg('ok', 'перерыв закончился — все назад!'); tone(TONES.mention); }
});

/* ---------- строки участников ---------- */
const vt = $('.js-vt');
const VU = '<i></i>'.repeat(12);
function rowTag(peer, st) {
  const me = peer === myId(), P = V.peers.get(peer);
  if (!me && mutedFor(peer)) return `<span class="tag t-mute" title="Заглушён только у тебя · правый клик — вернуть">${ic('volume-x')}Заглушён</span>`;
  if (st.share) return `<span class="tag t-demo">${ic('monitor-up')}Демка</span>`;
  if (st.cam) return `<span class="tag t-cam">${ic('video')}Вебка</span>`;
  if (st.deaf) return `<span class="tag t-mute">${ic('headphone-off')}Не слышит</span>`;
  if (!st.mic || (me && !micOn())) return `<span class="tag t-mute">${ic('mic-off')}${me && +prefs.ptt && V.mic ? 'Рация · V' : 'Без мика'}</span>`;
  if (!me && P && !['connected', 'completed'].includes(P.pc.iceConnectionState)) return `<span class="tag t-lock">${ic('radio-tower')}Соединяю…</span>`;
  return `<span class="tag t-talk">${ic('mic')}Говорит</span>`;
}
export function renderRows() {
  if (!V.room) { vt.innerHTML = ''; return; }
  const vs = voiceIn(V.room), me = myId();
  const ids = [me, ...Object.keys(vs).filter(p => p !== me).sort((a, b) => (vs[a].since || 0) - (vs[b].since || 0))];
  vt.innerHTML = ids.map(p => {
    const st = p === me ? myState() : vs[p] || {}; const P = V.peers.get(p);
    const ping = p === me ? '' : P && P.rtt != null ? P.rtt + 'ms' : S.online.get(p) && S.online.get(p).rtt != null ? S.online.get(p).rtt + 'ms' : '';
    return `<button class="vr" data-u="${esc(p)}" title="${p === me ? 'это ты · правый клик — мик и звук' : `клик — пнуть · правый клик — громкость${volOf(p) !== 100 ? ' (сейчас ' + volOf(p) + '%)' : ''} и меню`}"><img class="ava" alt="" src="${avaOf(p)}"><b style="color:${colorOf(p)}">${esc(nickOf(p))}</b><span class="vu">${VU}</span><span class="ping">${ping}${P && P.path === 'relay' ? ' · relay' : ''}</span>${rowTag(p, st)}</button>`;
  }).join('');
  $('.js-mav').innerHTML = ids.map(p => `<img alt="${esc(nickOf(p))}" title="${esc(nickOf(p))}" data-u="${esc(p)}" src="${avaOf(p)}" width="24" height="24">`).join('');
  renderBar();
}
vt.addEventListener('click', e => { const r = e.target.closest('.vr[data-u]'); if (r && r.dataset.u !== myId()) nudge(r.dataset.u); });
$('.js-mav').addEventListener('click', e => { const i = e.target.closest('img[data-u]'); if (i && i.dataset.u !== myId()) nudge(i.dataset.u); });

/* VU-метры и «говорит» */
const buf = new Uint8Array(512);
function lvl(an) { if (!an) return 0; an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; s += x * x; } return Math.sqrt(s / buf.length); }
let vuT = 0, vuRaf = 0;
function vuStart() { if (!vuRaf) vuRaf = requestAnimationFrame(vuLoop); }
function vuLoop(ts) {
  if (!V.room) { vuRaf = 0; return; }
  vuRaf = requestAnimationFrame(vuLoop);
  if (ts - vuT < 60) return; vuT = ts;
  const rows = new Map($$('.vr', vt).map(r => [r.dataset.u, r]));
  const put = (peer, l) => {
    const r = rows.get(peer); const n = Math.min(12, Math.round(Math.pow(l * 9, .7) * 12));
    const talk = l > .02;
    if (r) { $$('.vu i', r).forEach((b, i) => b.classList.toggle('on', i < n)); r.classList.toggle('talking', talk); }
    const im = $(`.js-mav img[data-u="${CSS.escape(peer)}"]`); if (im) im.classList.toggle('talking', talk);
    if (talk) bus.emit('talk', peer);
  };
  V.level = micOn() && V.gateOpen ? lvl(V.an) : 0; put(myId(), V.level);
  for (const P of V.peers.values()) { P.level = (V.deaf || (prefs.mute || {})[P.peer]) ? 0 : lvl(P.an); put(P.peer, P.level); }
}
/* пинг и путь по WebRTC */
setInterval(async () => {
  for (const P of V.peers.values()) {
    try {
      const st = await P.pc.getStats(); let pair = null; const cands = {};
      st.forEach(x => { if (x.type === 'transport' && x.selectedCandidatePairId) pair = st.get(x.selectedCandidatePairId); if (x.type === 'local-candidate' || x.type === 'remote-candidate') cands[x.id] = x; });
      if (!pair) st.forEach(x => { if (x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded') pair = x; });
      if (pair) { P.rtt = pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : P.rtt; const l = cands[pair.localCandidateId], r = cands[pair.remoteCandidateId]; P.path = l && r && (l.candidateType === 'relay' || r.candidateType === 'relay') ? 'relay' : l && l.candidateType === 'host' && r && r.candidateType === 'host' ? 'lan' : 'p2p'; }
    } catch (_) {}
  }
  if (V.room) $$('.vr', vt).forEach(r => { const P = V.peers.get(r.dataset.u); const p = $('.ping', r); if (P && p && P.rtt != null) p.textContent = P.rtt + 'ms' + (P.path === 'lan' ? ' · lan' : ''); });
}, 3000);

/* ---------- кнопки управления ---------- */
const micB = $('.js-mic'), deafB = $('.js-deaf'), camB = $('.js-cam'), shareB = $('.js-share'), leaveB = $('.js-leave');
function syncCtrl() {
  const mOn = V.mic && !V.deaf;
  micB.setAttribute('aria-pressed', String(mOn)); micB.classList.toggle('off', !mOn); micB.innerHTML = ic(mOn ? 'mic' : 'mic-off');
  deafB.setAttribute('aria-pressed', String(!V.deaf)); deafB.classList.toggle('off', V.deaf); deafB.innerHTML = ic(V.deaf ? 'headphone-off' : 'headphones');
  camB.setAttribute('aria-pressed', String(V.cam)); camB.innerHTML = ic(V.cam ? 'video' : 'video-off');
  shareB.classList.toggle('on', V.share); shareB.innerHTML = ic(V.share ? 'monitor-off' : 'monitor-up') + `<span>${V.share ? 'Стоп показ' : 'Экран'}</span>`;
  shareB.title = V.share ? 'Остановить показ экрана · Ctrl+Shift+S' : 'Показать экран друзьям в голосе · Ctrl+Shift+S';
  shareB.setAttribute('aria-pressed', String(V.share));
  syncShareBar();
  leaveB.innerHTML = ic('log-out') + '<span>Выйти</span>';
  const mm = $('.js-mmic'), md = $('.js-mdeaf');
  mm.innerHTML = micB.innerHTML; mm.classList.toggle('off', !mOn); mm.setAttribute('aria-pressed', String(mOn)); mm.setAttribute('aria-label', 'Микрофон');
  md.innerHTML = deafB.innerHTML; md.classList.toggle('off', V.deaf); md.setAttribute('aria-pressed', String(!V.deaf)); md.setAttribute('aria-label', 'Звук');
}
export function toggleMic() { if (!V.room) return; if (V.deaf) { V.deaf = false; applyVolAll(); } V.mic = !V.mic; applyMic(); pushState(); tmsg('ok', V.mic ? 'мик включён' : 'мик выключен'); tone(V.mic ? [[660, .04], [880, .05]] : [[660, .04], [440, .05]], .5); }
export function toggleDeaf() { if (!V.room) return; V.deaf = !V.deaf; applyVolAll(); applyMic(); pushState(); tmsg('ok', V.deaf ? 'звук выключен — ты никого не слышишь, и тебя тоже' : 'звук снова включён'); }
micB.addEventListener('click', toggleMic); deafB.addEventListener('click', toggleDeaf);
$('.js-mmic').addEventListener('click', toggleMic); $('.js-mdeaf').addEventListener('click', toggleDeaf);
leaveB.addEventListener('click', () => leave()); $('.js-mleave').addEventListener('click', () => leave());
$('.js-mexp').addEventListener('click', () => setMini(false)); $('.js-mscr').addEventListener('click', () => setMini(false));
camB.addEventListener('click', () => V.cam ? camStop() : camStart());
shareB.addEventListener('click', () => { if (V.share) stopShare(); else openW('share'); });

/* ---------- вебка ---------- */
export async function camStart() {
  if (!V.room) { tmsg('warn', 'вебка работает в голосе — сначала зайди'); return; }
  const h = +prefs.camRes || 720;
  try {
    const c = { height: { ideal: h }, width: { ideal: Math.round(h * 16 / 9) }, frameRate: { ideal: 30 } };
    if (prefs.camId) c.deviceId = { ideal: prefs.camId };
    V.camS = await navigator.mediaDevices.getUserMedia({ video: c });
  } catch (e) { tmsg('err', 'вебка недоступна: ' + (e.message || e.name)); return; }
  V.cam = true; sendMetaAll();
  const t = V.camS.getVideoTracks()[0];
  for (const P of V.peers.values()) P.camTx = P.pc.addTrack(t, V.camS);
  t.onended = () => camStop();
  bus.emit('media', myId(), 'cam', V.camS); syncCtrl(); renderRows(); pushState();
  tmsg('ok', 'вебка включена · видят все в голосе');
}
export function camStop(silent) {
  if (!V.camS) return;
  for (const P of V.peers.values()) { if (P.camTx) { try { P.pc.removeTrack(P.camTx); } catch (_) {} P.camTx = null; } }
  V.camS.getTracks().forEach(t => t.stop()); V.camS = null; V.cam = false;
  sendMetaAll(); bus.emit('media', myId(), 'cam', null); syncCtrl(); renderRows(); pushState();
  if (!silent) tmsg('ok', 'вебка выключена');
}
$('.js-dcam').addEventListener('click', () => V.cam ? camStop() : camStart());

/* ---------- демка (показ экрана) ---------- */
export async function startShare(o = {}) {
  if (!V.room) { tmsg('warn', 'экран показывают в голосе — сначала зайди'); return; }
  const h = +(o.res || prefs.shareRes) || 1080, fps = +(o.fps || prefs.shareFps) || 30;
  const wantAudio = o.audio ?? !!prefs.shareAudio;
  let s, hint = null;
  // системное окно выбора экрана иногда открывается позади Hunty — тогда кажется, что всё зависло
  const hintT = setTimeout(() => { hint = toast({ icon: 'monitor-up', title: 'Выбери, что показать', sub: 'Окно выбора экрана открыто. Не видно — нажми Alt+Tab, оно могло спрятаться за Hunty', dur: 12000 }); }, 4000);
  try {
    s = await navigator.mediaDevices.getDisplayMedia({
      video: { height: { ideal: h, max: h }, frameRate: { ideal: fps, max: fps }, displaySurface: o.surface || 'monitor' },
      // свой звук (голоса друзей из Hunty) не захватываем — иначе они слышат себя эхом
      audio: wantAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true } : false,
      selfBrowserSurface: 'exclude', systemAudio: 'include', surfaceSwitching: 'include',
    });
  } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') tmsg('err', 'демка не запустилась: ' + (e.message || e.name)); return; }
  finally { clearTimeout(hintT); if (hint) closeToast(hint); }
  if (!V.room) { s.getTracks().forEach(t => t.stop()); return; } // пока выбирал — вышел из голоса
  if (V.share) stopShare(true);
  V.scrS = s; V.share = true; V.drawOk = o.draw ?? (prefs.shareDraw !== 'none');
  const vt0 = s.getVideoTracks()[0]; if (vt0) { vt0.contentHint = prefs.shareHint === 'motion' ? 'motion' : 'detail'; vt0.onended = () => stopShare(); }
  sendMetaAll();
  for (const P of V.peers.values()) { P.scrTx = s.getTracks().map(t => P.pc.addTrack(t, s)); setTimeout(() => applyBitrate(P), 1500); }
  bus.emit('media', myId(), 'scr', s); syncCtrl(); renderRows(); pushState();
  api('ev', { room: V.room, kind: 'share', data: { on: true, draw: V.drawOk } }).catch(() => {});
  tmsg('ok', `ты показываешь экран · ${vt0 && vt0.getSettings().height || h}p${s.getAudioTracks().length ? ' со звуком' : ''} · ${V.drawOk ? 'рисовать можно всем' : 'рисовать нельзя'}`);
  tone([[523, .05], [659, .05], [784, .08]]);
}
/* плашка сверху, пока показываешь экран: видно всегда, даже в мини-окне звонка */
const sbar = $('.js-sharebar');
function syncShareBar() {
  const on = !!(V.share && V.room); sbar.hidden = !on; app.classList.toggle('sharing', on); if (!on) return;
  const n = Math.max(0, voiceCount(V.room) - 1), t = V.scrS && V.scrS.getVideoTracks()[0], st = t ? t.getSettings() : {};
  $('.js-sbsub', sbar).textContent = (n ? `видят ${n} · ` : 'пока никто не смотрит · ') + (st.height ? st.height + 'p' : '') + (V.scrS && V.scrS.getAudioTracks().length ? ' · со звуком' : '');
}
$('.js-sbstop', sbar).addEventListener('click', () => stopShare());
/* окно «Запустить демку» */
const shw = $('.win[data-win="share"]');
OPEN.share = () => {
  segSet($('.js-ssurf', shw), prefs.shareSurf || 'monitor'); segSet($('.js-sq', shw), String(prefs.shareRes || 1080)); segSet($('.js-sf', shw), String(prefs.shareFps || 30));
  $('.js-saudio', shw).checked = !!prefs.shareAudio; $('.js-sdraw', shw).checked = prefs.shareDraw !== 'none';
  const r = S.rooms.get(V.room); $('.js-sroom', shw).textContent = r ? 'в звонок · ' + (r.kind === 'dm' ? 'лс с ' + nickOf(dmPeer(r)) : r.name) : 'сначала зайди в голос';
  const n = Math.max(0, voiceCount(V.room) - 1); $('.js-sinfo', shw).textContent = n ? `увидят ${n} · напрямую P2P` : 'пока никто не смотрит · напрямую P2P';
};
$('.js-sstart', shw).addEventListener('click', () => {
  const o = { surface: segGet($('.js-ssurf', shw)) || 'monitor', res: +segGet($('.js-sq', shw)) || 1080, fps: +segGet($('.js-sf', shw)) || 30, audio: $('.js-saudio', shw).checked, draw: $('.js-sdraw', shw).checked };
  setPref('shareSurf', o.surface); setPref('shareRes', o.res); setPref('shareFps', o.fps); setPref('shareAudio', o.audio); setPref('shareDraw', o.draw ? 'all' : 'none');
  closeW(); startShare(o);
});
export function stopShare(silent) {
  if (!V.scrS) return;
  for (const P of V.peers.values()) { (P.scrTx || []).forEach(tx => { try { P.pc.removeTrack(tx); } catch (_) {} }); P.scrTx = null; }
  V.scrS.getTracks().forEach(t => t.stop()); V.scrS = null; V.share = false;
  sendMetaAll(); bus.emit('media', myId(), 'scr', null); syncCtrl(); renderRows(); pushState();
  if (V.room) api('ev', { room: V.room, kind: 'share', data: { on: false } }).catch(() => {});
  if (!silent) tmsg('ok', 'показ экрана остановлен');
}

/* ---------- события голоса от ядра ---------- */
bus.on('voice', (room, peer, st, had) => {
  if (peer === myId()) { if (room === V.room && !st && V.room) { /* ядро выкинуло */ } layout(); return; }
  if (room === V.room) {
    if (st && !had) { pcFor(peer); tone([[587, .05], [880, .08]], .6); tmsg('ok', `${nickOf(peer)} зашёл в голос`, true); }
    else if (st && !V.peers.has(peer)) pcFor(peer);
    if (!st) { closePeer(peer); if (had) { tone([[880, .05], [587, .08]], .6); tmsg('ok', `${nickOf(peer)} вышел из голоса`, true); } const r = S.rooms.get(room); if (r && r.kind === 'dm' && !Object.keys(voiceIn(room)).some(p => p !== myId())) { if (Date.now() - V.since > 3000) leave(); } }
    if (st && !st.share) { const P = V.peers.get(peer); if (P && P.media.scr) { delete P.media.scr; bus.emit('media', peer, 'scr', null); } }
    if (st && !st.cam) { const P = V.peers.get(peer); if (P && P.media.cam) { delete P.media.cam; bus.emit('media', peer, 'cam', null); } }
    renderRows(); syncShareBar();
  }
  syncJoin();
});
bus.on('presence', (peer, on) => { if (!on && V.peers.has(peer)) { closePeer(peer); renderRows(); } });
bus.on('open', id => {
  syncJoin();
  if (!V.room || mobile()) return;
  if (id === V.room) { if (V.mini && !V.manualMini) setMini(false); }
  else if (!V.mini) setMini(true, false);
});
bus.on('pref', k => {
  if (k === 'vol' || k === 'mute' || k === 'outVol' || k === 'outId') applyVolAll();
  if (k === 'micVol' && V.gain) V.gain.gain.value = (prefs.micVol ?? 100) / 100;
  if ((k === 'gate' || k === 'gateDb') && V.gate) gateSet(V.gate);
  if (['micId', 'ns', 'ec', 'agc'].includes(k) && V.room) micRestart();
  if (k === 'bitrate') V.peers.forEach(applyBitrate);
  if (k === 'ptt') applyMic();
});
bus.on('peer-vol', () => { applyVolAll(); renderRows(); });
bus.on('room_removed', room => { if (room === V.room) leave({ silent: true }); });

/* ---------- звонки в личке ---------- */
let ringOut = null, ringIn = new Map();
export async function call(room) {
  const r = S.rooms.get(room); if (!r || r.kind !== 'dm') return;
  const p = dmPeer(r);
  if (!isOnline(p)) { tmsg('warn', `${nickOf(p)} не в сети — звонок не дойдёт`); return; }
  if (voiceIn(room)[p]) { join(room); return; } // друг уже ждёт в звонке
  await join(room, { silent: true });
  if (V.room !== room) return;
  try { await api('ev', { room, kind: 'ring', data: {} }); } catch (e) { fail(e); leave({ silent: true }); return; }
  let n = 0;
  const t = toast({ ava: avaOf(p), icon: 'phone', title: `звоним ${nickOf(p)}…`, sub: 'напрямую P2P, без серверов', tag: 'Звонок', cls: 'ring', actions: [{ label: 'Сбросить', cls: 'gbtn', fn: () => { hangOut('cancel'); } }] });
  ringOut = { room, peer: p, t, iv: setInterval(() => { if (++n > 10) { hangOut('timeout'); return; } tone(TONES.ring, .8); }, 2500) };
  tone(TONES.ring, .8); bus.emit('voice', room);
}
function hangOut(why) {
  if (!ringOut) return; const { room, peer, t, iv } = ringOut; ringOut = null;
  clearInterval(iv); closeToast(t);
  if (why === 'answered') return;
  api('ev', { room, kind: 'ring_stop', data: { why } }).catch(() => {});
  if (why === 'timeout') { tmsg('warn', `${nickOf(peer)} не ответил`); api('send', { room, kind: 'sys', text: 'missed' }).then(m => import('./state.js').then(s => s.pushLocal(m))).catch(() => {}); }
  if (why === 'declined') tmsg('warn', `${nickOf(peer)} сбросил звонок`);
  if (V.room === room) leave({ silent: true, logCall: false });
  else layout();
}
bus.on('voice', (room, peer, st) => { if (ringOut && room === ringOut.room && peer === ringOut.peer && st) { hangOut('answered'); tmsg('ok', `${nickOf(peer)} ответил · голос напрямую`); } });
bus.on('ev:ring', v => {
  const r = S.rooms.get(v.room); if (!r || r.kind !== 'dm' || ringIn.has(v.room)) return;
  if (V.room === v.room) return;
  const p = v.from; let n = 0;
  const t = toast({ ava: avaOf(p), icon: 'phone', title: `${nickOf(p)} звонит`, sub: 'личка · напрямую P2P', tag: '30 сек', cd: 30, cls: 'ring',
    actions: [{ label: 'Ответить', cls: 'cbtn', fn: () => { stopRing(v.room); join(v.room); } }, { label: 'Сбросить', cls: 'gbtn', fn: () => { stopRing(v.room); api('ev', { room: v.room, kind: 'ring_stop', data: { why: 'declined' } }).catch(() => {}); } }],
    onTimeout: () => stopRing(v.room) });
  const iv = setInterval(() => { if (++n > 12) { stopRing(v.room); return; } tone([[554, .15], [440, .15]], 1.1); }, 2500);
  ringIn.set(v.room, { t, iv });
  notify({ tone: 'ring', say: `${nickOf(p)} звонит`, force: true });
});
function stopRing(room) { const x = ringIn.get(room); if (!x) return; ringIn.delete(room); clearInterval(x.iv); closeToast(x.t); }
bus.on('ev:ring_stop', v => {
  stopRing(v.room);
  if (ringOut && ringOut.room === v.room && v.data && v.data.why === 'declined') hangOut('declined');
  else if (v.data && v.data.why === 'timeout') tmsg('warn', `пропущенный звонок от ${nickOf(v.from)}`);
});
bus.on('call', room => call(room));
bus.on('hang', () => { if (ringOut) hangOut('cancel'); else leave(); });
bus.on('voice-join', room => { if (V.room === room) { if (V.mini) setMini(false); else tmsg('ok', 'ты уже тут'); } else join(room); });

/* ---------- «попросить вебку/демку», пнуть ---------- */
bus.on('ask', async (peer, what) => {
  const room = V.room && voiceIn(V.room)[peer] ? V.room : '';
  if (!room) { tmsg('warn', `попросить можно в голосе — зайди туда, где ${nickOf(peer)}`); return; }
  try { await api('ev', { room, to: peer, kind: 'ask', data: { what } }); tmsg('ok', `попросил ${nickOf(peer)} ${what === 'cam' ? 'включить вебку' : 'показать экран'}`); } catch (e) { fail(e); }
});
bus.on('ev:ask', v => {
  if (v.room !== V.room) return; const what = v.data && v.data.what;
  toast({ ava: avaOf(v.from), icon: what === 'cam' ? 'video' : 'monitor-up', title: `${nickOf(v.from)} просит ${what === 'cam' ? 'включить вебку' : 'показать экран'}`, sub: 'увидят все в голосе', tag: '30 сек', cd: 30,
    actions: [{ label: what === 'cam' ? 'Включить' : 'Показать', cls: 'cbtn', fn: () => what === 'cam' ? camStart() : openW('share') }, { label: 'Не сейчас', cls: 'gbtn' }] });
  tone([[660, .08], [520, .12]]);
});
function voiceItems(p) {
  if (!p) return null;
  if (p === myId()) return personItems(p, { sub: 'ты в голосе', extra: [
    { label: 'Микрофон', check: V.mic && !V.deaf, kbd: 'Ctrl+M', fn: toggleMic },
    { label: 'Звук', check: !V.deaf, kbd: 'Ctrl+D', fn: toggleDeaf },
    { icon: V.share ? 'monitor-off' : 'monitor-up', label: V.share ? 'Остановить показ' : 'Показать экран', kbd: 'Ctrl+Shift+S', fn: () => V.share ? stopShare() : openW('share') },
    '-'] });
  const st = voiceIn(V.room)[p] || {};
  return personItems(p, { extra: V.room && voiceIn(V.room)[p] ? [
    { icon: 'hand', label: 'Пнуть', fn: () => nudge(p) },
    !st.cam ? { icon: 'video', label: 'Попросить вебку', fn: () => bus.emit('ask', p, 'cam') } : null,
    !st.share ? { icon: 'monitor-up', label: 'Попросить показать экран', fn: () => bus.emit('ask', p, 'share') } : null,
  ] : [] });
}
onCtx('.vr[data-u]', el => voiceItems(el.dataset.u));
onCtx('.js-mav img[data-u]', el => voiceItems(el.dataset.u));
let nudgeT = 0;
async function nudge(peer) {
  if (Date.now() - nudgeT < 2500) return; nudgeT = Date.now();
  try { await api('ev', { room: V.room, to: peer, kind: 'nudge', data: {} }); tmsg('ok', `пнул ${nickOf(peer)}`); } catch (e) { fail(e); }
}
bus.on('ev:nudge', v => {
  if (!voiceIn(v.room)[v.from] && v.room !== V.room) return;
  app.classList.remove('shake'); void app.offsetWidth; app.classList.add('shake'); setTimeout(() => app.classList.remove('shake'), 600);
  tone([[220, .06], [180, .08]], 1.2); tmsg('ping', `${nickOf(v.from)} пнул тебя`);
});

/* ---------- кнопки F1–F6 ---------- */
const pop = $('.js-vpop');
export function popToggle(on) { pop.hidden = on === undefined ? !pop.hidden : !on; $('.js-btns').classList.toggle('on', !pop.hidden); }
$('.js-btns').addEventListener('click', e => { e.stopPropagation(); popToggle(); });
document.addEventListener('click', e => { if (!pop.hidden && !e.target.closest('.js-vpop,.js-btns')) popToggle(false); });
const RND = ['Кто не спит — тот молодец', 'Погнали!', 'Ну вы даёте', 'Это база', 'Я щас вернусь', 'Кринж', 'Красава!', 'Хорош'];
let brbUntil = 0, roll = null;
async function fireKey(k) {
  if (!V.room) return;
  const b = $(`.key[data-k="${k}"]`, pop); if (!b) return;
  b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
  const act = b.dataset.act, say = b.dataset.say;
  try {
    if (say) { const text = say === '?' ? pick(RND) : say; await api('ev', { room: V.room, kind: 'say', data: { text } }); playSay(myId(), text); return; }
    if (act === 'roll') { roll = { here: new Set([myId()]), t0: Date.now() }; await api('ev', { room: V.room, kind: 'roll', data: {} }); tmsg('ok', 'перекличка: ждём 10 сек…'); setTimeout(finishRoll, 11000); return; }
    if (act === 'call') { await api('ev', { room: V.room, kind: 'gather', data: {} }); tmsg('ok', 'общий сбор: всем в группе, кто не в голосе, пришёл пуш'); return; }
    if (act === 'brb') { const until = Date.now() + 5 * 60000; await api('ev', { room: V.room, kind: 'brb', data: { until } }); onBrb(myId(), until); }
  } catch (e) { fail(e); }
}
function playSay(from, text) { tone([[880, .04], [1320, .05]], .8); speak(text, true); toast({ ava: avaOf(from), icon: 'zap', title: nickOf(from), sub: '«' + text + '»', dur: 3500 }); }
async function finishRoll() {
  if (!roll || !V.room) return; const all = Object.keys(voiceIn(V.room)); const miss = all.filter(p => !roll.here.has(p));
  const text = `rollres:перекличка — тут ${roll.here.size} из ${all.length}${miss.length ? ' · молчат: ' + miss.map(nickOf).join(', ') : ' · все на месте'}`;
  roll = null;
  try { const m = await api('send', { room: V.room, kind: 'sys', text }); (await import('./state.js')).pushLocal(m); } catch (_) {}
}
function onBrb(from, until) { brbUntil = until; tmsg('ping', `${nickOf(from)}: перерыв 5 минут — до ${new Date(until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`); tone([[523, .1], [392, .14]]); }
bus.on('ev:say', v => { if (v.room === V.room) playSay(v.from, String((v.data && v.data.text) || '').slice(0, 80)); });
bus.on('ev:roll', v => {
  if (v.room !== V.room) return;
  toast({ ava: avaOf(v.from), icon: 'users', title: `перекличка от ${nickOf(v.from)}`, sub: 'жми «Тут!» за 10 секунд', tag: '10 сек', cd: 10, actions: [{ label: 'Тут!', cls: 'cbtn', fn: () => api('ev', { room: v.room, to: v.from, kind: 'here', data: {} }).catch(() => {}) }] });
  tone(TONES.mention);
});
bus.on('ev:here', v => { if (roll && v.room === V.room) { roll.here.add(v.from); tmsg('ok', `${nickOf(v.from)}: тут!`); } });
bus.on('ev:brb', v => { if (v.room === V.room && v.data) onBrb(v.from, +v.data.until || Date.now() + 300000); });
bus.on('ev:gather', v => {
  if (V.room === v.room) return; const r = S.rooms.get(v.room); if (!r) return;
  toast({ ava: avaOf(v.from), icon: 'mic', title: `${nickOf(v.from)} зовёт всех в голос`, sub: `«${r.name}» · там ${voiceCount(v.room)}`, dur: 20000, actions: [{ label: 'Зайти', cls: 'cbtn', fn: () => join(v.room) }, { label: 'Потом', cls: 'gbtn' }] });
  notify({ tone: 'mention', say: `${nickOf(v.from)} зовёт всех в голос`, force: true });
});
pop.addEventListener('click', e => { const b = e.target.closest('.key[data-k]'); if (b) fireKey(b.dataset.k); });

/* ---------- хоткеи ---------- */
const typing = e => e.target.closest && e.target.closest('input,textarea,select,[contenteditable]');
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyM') { e.preventDefault(); toggleMic(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyD') { e.preventDefault(); toggleDeaf(); return; }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); if (V.share) stopShare(); else if (V.room) openW('share'); return; }
  if (/^F[1-6]$/.test(e.key) && V.room) { e.preventDefault(); fireKey(e.key); return; }
  if (e.code === 'KeyV' && +prefs.ptt && !typing(e) && !e.repeat && V.room) { V.ptt = true; applyMic(); }
});
document.addEventListener('keyup', e => { if (e.code === 'KeyV' && V.ptt) { V.ptt = false; applyMic(); } });
addEventListener('blur', () => { if (V.ptt) { V.ptt = false; applyMic(); } });
window.addEventListener('beforeunload', () => { if (V.room) { try { api('voice_leave'); } catch (_) {} } });
