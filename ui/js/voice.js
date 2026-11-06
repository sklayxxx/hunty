import { makeShareUpdater } from './share-sender.js';
// Голос: WebRTC mesh (до 6), сигналинг через P2P-ядро, мик/звук/вебка/демка, звонки в личке, кнопки F1–F6
import { $, $$, esc, ic, dur, pick, clamp, mobile, reduce, prefs, setPref, bus, sleep, short } from './core.js';
import { api } from './api.js';
import { S, myId, myNick, nickOf, avaOf, colorOf, roomName, dmPeer, voiceIn, voiceCount, isOnline, isBlocked } from './state.js';
import { app, tmsg, sfx, toast, closeToast, fail, notify, speak, actx, openW, closeW, fit, glitch, OPEN, segSet, segGet } from './ui.js';
import { getMic, micChain } from './audio.js';
import { onCtx, openMenu } from './menu.js';
import { personItems, mutedFor, volOf } from './people.js';
import { tileHTML, openChat } from './chat.js';
import { keyLabel, keyOf } from './keyname.js';

export const MAXV = 6;
export const V = {
  room: '', since: 0, mic: !prefs.selfMute, deaf: !!prefs.selfDeaf, cam: false, share: false,
  raw: null, micS: null, track: null, proc: null, gain: null, an: null, gate: null, chain: null, gateOpen: true, level: 0,
  camS: null, scrS: null, peers: new Map(), resets: new Map(), mini: false, manualMini: false, ptt: false, gkeys: false, gateMsg: null,
};
const rid = () => Math.random().toString(36).slice(2, 10);
// звонки в личке: ringOut — звоню я, ringIn — звонят мне, waitDm — друг не в сети, жду его в звонке
let ringOut = null, ringIn = new Map(), waitDm = '';
const declined = new Map(); // room → ts: «Сбросить» нажал я — не напоминаю следом
export const micOn = () => V.mic && !V.deaf && (!+prefs.ptt || V.ptt);
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
  let ch = null;
  // шумодав → громкость → порог голоса → эффект → саундборд (audio.js); тише порога — в звонок идёт тишина
  if (raw && ctx) { try { ch = await micChain(ctx, raw, { onGate: m => { V.gateOpen = !!m[0]; V.gateMsg = m; } }); } catch (e) { console.warn('mic', e); } }
  if (V.raw !== raw) { if (ch) ch.stop(true); return; } // пока собирали — вышли из голоса
  if (ch) {
    V.chain = ch; V.gain = ch.gain; V.an = ch.an; V.gate = ch.gate; V.gateOpen = true;
    V.micS = ch.stream; V.proc = ch.track;
    // пока AudioContext не запущен (Firefox до первого клика, нет аудиовыхода), из графа идёт тишина —
    // шлём мик напрямую, а как контекст оживёт — подменяем на обработанный
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
  if (V.chain) V.chain.stop(true);
  if (V.raw) V.raw.getTracks().forEach(t => t.stop()); [V.track, V.proc].forEach(t => { if (t) t.stop(); });
  V.raw = V.track = V.proc = V.micS = V.gain = V.an = V.gate = V.chain = null; V.gateOpen = true;
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
  if (V.scrS) addScreen(P);
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
  P.boost.forEach(unboost); P.boost.clear();
  clearTimeout(P.rto); clearTimeout(P.wd); clearTimeout(P.dt);
  ['cam', 'scr'].forEach(k => { if (P.media[k]) bus.emit('media', peer, k, null); });
}
async function applyBitrate(P) {
  try {
    const s = P.micTx; if (s && s.track) { const p = s.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; p.encodings[0].maxBitrate = (+prefs.bitrate || 64) * 1000; p.encodings[0].priority = p.encodings[0].networkPriority = 'high'; await s.setParameters(p); }
  } catch (_) {}
  await applyWatch(P);
}
/* Демонстрация: ограничение битрейта — потолок, а не требование. При нагрузке
   WebRTC должен иметь возможность снизить и разрешение, и частоту кадров. */
const SHARE_MBIT = { 720: 3.5, 1080: 6, 1440: 10 };
export function shareProfile(res = +prefs.shareRes || 1080, fps = +prefs.shareFps || 30) {
  const base = SHARE_MBIT[res] || (res > 1080 ? 10 : res > 720 ? 6 : 3.5);
  const motion = prefs.shareHint === 'motion' || fps >= 50;
  return { res, fps, motion, maxBitrate: Math.round(base * (fps >= 50 ? 1.5 : fps <= 15 ? .7 : 1) * 1e6) };
}
V.watch = new Map();
export const watchesMe = p => !V.watch.has(p) || V.watch.get(p) === myId();
export const watchersOf = sharer => Object.keys(voiceIn(V.room)).filter(p => p !== sharer && p !== myId() && (!V.watch.has(p) || V.watch.get(p) === sharer));
// setParameters использует transactionId: параллельные изменения одной дорожки
// конфликтуют и могли оставить трансляцию на паузе. Обновляем каждый sender последовательно.
const updateShareSender = makeShareUpdater(shareProfile, watchesMe);
async function applyWatch(P) {
  await Promise.all((P.scrTx || []).filter(tx => tx.track).map(tx => updateShareSender(tx, P.peer)));
}
bus.on('ev:watch', v => {
  if (!V.room || v.room !== V.room || !v.from || v.from === myId()) return;
  const was = V.watch.get(v.from), now = String((v.data && v.data.p) || '');
  V.watch.set(v.from, now); if (was === now) return;
  const P = V.peers.get(v.from); if (P) applyWatch(P);
  bus.emit('watch', v.from); syncShareBar();
});
bus.on('voice', (room, peer, st) => { if (peer && !st && V.watch.delete(peer)) bus.emit('watch', peer); });
bus.on('vleft', () => V.watch.clear());
/* видеокарта умеет кодировать (NVENC/AMF/QuickSync)? — тогда кодирует она: проц свободен, кадры не теряются */
const hwMemo = new Map();
function hwCodec(res, fps) {
  const k = res + '@' + fps; if (hwMemo.has(k)) return hwMemo.get(k);
  const w = Math.round(res * 16 / 9), br = shareProfile(res, fps).maxBitrate;
  const p = (async () => {
    const mc = navigator.mediaCapabilities; if (!mc || !mc.encodingInfo || !window.RTCRtpReceiver || !RTCRtpReceiver.getCapabilities) return '';
    const have = ((RTCRtpReceiver.getCapabilities('video') || {}).codecs || []).map(c => c.mimeType.toLowerCase());
    for (const mime of ['video/H264', 'video/AV1', 'video/VP9']) {
      if (!have.includes(mime.toLowerCase())) continue;
      try { const r = await mc.encodingInfo({ type: 'webrtc', video: { contentType: mime, width: w, height: res, bitrate: br, framerate: fps } }); if (r && r.supported && r.powerEfficient) return mime; } catch (_) {}
    }
    return '';
  })();
  hwMemo.set(k, p); return p;
}
function preferCodec(P, tx, mime) {
  if (!mime) return;
  try {
    const tr = P.pc.getTransceivers().find(t => t.sender === tx); if (!tr || !tr.setCodecPreferences) return;
    const all = (RTCRtpReceiver.getCapabilities('video') || {}).codecs || [];
    const want = all.filter(c => c.mimeType.toLowerCase() === mime.toLowerCase()).sort((a, b) => /packetization-mode=1/.test(b.sdpFmtpLine || '') - /packetization-mode=1/.test(a.sdpFmtpLine || ''));
    if (want.length) tr.setCodecPreferences([...want, ...all.filter(c => !want.includes(c))]);
  } catch (e) { console.warn('codec', e); }
}
function addScreen(P) {
  P.scrTx = V.scrS.getTracks().map(t => P.pc.addTrack(t, V.scrS));
  const vt = P.scrTx.find(tx => tx.track && tx.track.kind === 'video');
  if (vt) preferCodec(P, vt, V.scrCodec);
  applyWatch(P);
  // После согласования некоторые браузеры только тогда создают encodings.
  setTimeout(() => { if (V.peers.get(P.peer) === P && P.scrTx) applyWatch(P); }, 1500);
}
/* что реально уходит друзьям: разрешение, fps, кодек, во что упирается — раз в 2 с, пока показываешь */
export const shareStat = { h: 0, fps: 0, codec: '', hw: false, lim: '', n: 0 };
setInterval(async () => {
  if (!V.share || !V.scrS) return;
  let h = 0, fps = 0, codec = '', hw = false, lim = '', n = 0;
  for (const P of V.peers.values()) {
    const tx = (P.scrTx || []).find(t => t.track && t.track.kind === 'video'); if (!tx || !watchesMe(P.peer)) continue; // не смотрит — копия на паузе
    try {
      const st = await tx.getStats(); let o = null; const codecs = {};
      st.forEach(x => { if (x.type === 'outbound-rtp' && x.kind === 'video' && (!o || (x.frameHeight || 0) > (o.frameHeight || 0))) o = x; if (x.type === 'codec') codecs[x.id] = x; });
      if (!o || !o.frameHeight) continue;
      n++; h = h ? Math.min(h, o.frameHeight) : o.frameHeight; fps = fps ? Math.min(fps, o.framesPerSecond || 0) : (o.framesPerSecond || 0);
      const c = codecs[o.codecId]; if (c) codec = c.mimeType.split('/')[1];
      hw = hw || o.powerEfficientEncoder === true || /mediafoundation|nvenc|vaapi|videotoolbox|hardware|D3D|AMF|QSV/i.test(o.encoderImplementation || '');
      if (o.qualityLimitationReason && o.qualityLimitationReason !== 'none') lim = o.qualityLimitationReason;
    } catch (_) {}
  }
  Object.assign(shareStat, { h, fps: Math.round(fps), codec, hw, lim, n });
  syncShareBar(); bus.emit('sharestat');
}, 2000);
function onTrack(P, e) {
  const st = e.streams[0] || new MediaStream([e.track]);
  const k = st.id === P.kinds.scr ? 'scr' : st.id === P.kinds.cam ? 'cam' : e.track.kind === 'audio' ? 'mic' : 'cam';
  if (e.track.kind === 'audio') {
    let a = P.audioEls.get(st.id);
    if (!a) { a = new Audio(); a.autoplay = true; a.dataset.peer = P.peer; document.body.appendChild(a); a.hidden = true; P.audioEls.set(st.id, a); }
    const ob = P.boost.get(st.id); if (ob) { unboost(ob); P.boost.delete(st.id); }
    a.srcObject = st; applyVol(P); a.play().catch(() => {});
    if (k === 'mic') { const ctx = actx(); if (ctx) { try { const src = ctx.createMediaStreamSource(st); P.an = ctx.createAnalyser(); P.an.fftSize = 512; P.an.smoothingTimeConstant = .5; src.connect(P.an); } catch (_) {} } }
  } else {
    P.media[k] = st; bus.emit('media', P.peer, k, st);
    e.track.onended = () => { if (P.media[k] === st) { delete P.media[k]; bus.emit('media', P.peer, k, null); } };
    st.onremovetrack = () => { if (!st.getVideoTracks().length && P.media[k] === st) { delete P.media[k]; bus.emit('media', P.peer, k, null); } };
  }
}
// громкость друга: обычно звук идёт через WebAudio — там лимитер «защита ушей» и усилитель выше 100%
// (сам <audio> при этом молчит, но остаётся подключённым: без него Chrome не отдаёт звук WebRTC в WebAudio).
// WebAudio ещё не запущен (не было клика) — играет сам <audio>, громкостью элемента.
const DUCK_K = .35;
function applyVol(P) {
  const v = clamp(((prefs.vol || {})[P.peer] ?? 100) / 100 * ((prefs.outVol ?? 100) / 100), 0, 2) * (P.duck > Date.now() ? DUCK_K : 1);
  const mute = V.deaf || !!(prefs.mute || {})[P.peer], guardOn = prefs.earGuard !== false;
  const ctx = !mute && (v > 1.001 || guardOn) ? actx() : null, web = !!(ctx && ctx.state === 'running');
  P.audioEls.forEach((a, sid) => {
    const out = prefs.outId || '';
    if (a.setSinkId && (a.sinkId || '') !== out) a.setSinkId(out).catch(() => {});
    let b = P.boost.get(sid);
    if (b && !!b.lim !== guardOn) { unboost(b); P.boost.delete(sid); b = null; }
    if (web && !b && a.srcObject) {
      try {
        const src = ctx.createMediaStreamSource(a.srcObject), g = ctx.createGain(); let lim = null; src.connect(g);
        if (guardOn) { // лимитер: резкий ор и хрип в микрофон не режут уши
          lim = ctx.createDynamicsCompressor(); lim.threshold.value = -10; lim.knee.value = 4; lim.ratio.value = 20; lim.attack.value = .002; lim.release.value = .18;
          g.connect(lim); lim.connect(ctx.destination);
        } else g.connect(ctx.destination);
        b = { src, g, lim }; P.boost.set(sid, b);
      } catch (_) { b = null; }
    }
    if (web && b) { b.g.gain.setTargetAtTime(v, ctx.currentTime, .03); a.muted = true; return; }
    if (b) b.g.gain.value = 0;
    a.volume = clamp(v, 0, 1); a.muted = mute;
  });
}
function unboost(b) { try { b.src.disconnect(); b.g.disconnect(); if (b.lim) b.lim.disconnect(); } catch (_) {} }
/* защита ушей: кто-то орёт дольше четверти секунды — приглушаем его на 3 секунды */
const LOUD = .34, HOLD = 250, DUCK_MS = 3000;
let duckTold = 0;
function guard(P, dt) {
  if (prefs.earGuard === false || !P.audioEls.size) { if (P.duck) { P.duck = 0; applyVol(P); } return; }
  const now = Date.now();
  P.loud = P.level > LOUD ? (P.loud || 0) + dt : Math.max(0, (P.loud || 0) - dt * 2);
  if (P.loud >= HOLD) {
    const was = P.duck > now; P.duck = now + DUCK_MS; P.loud = 0;
    if (!was) {
      applyVol(P); renderRows();
      if (now - duckTold > 120000) {
        duckTold = now;
        toast({ ava: avaOf(P.peer), icon: 'ear', title: `${nickOf(P.peer)} слишком громко`, sub: 'приглушил на пару секунд, чтобы не резало уши', dur: 5000,
          actions: [{ label: 'Ок', cls: 'gbtn' }, { label: 'Не глушить', cls: 'gbtn', fn: () => { setPref('earGuard', false); tmsg('ok', 'защита ушей выключена · вернуть — Настройки → Звук'); } }] });
      }
    }
  } else if (P.duck && P.duck <= now) { P.duck = 0; applyVol(P); renderRows(); }
}
bus.on('actx', st => { if (st === 'running' && V.room) applyVolAll(); });
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
  V.room = room; V.since = Date.now(); V.mini = false; V.manualMini = false; V.mic = o.mic ?? !prefs.selfMute; V.deaf = !!prefs.selfDeaf;
  actx();
  await micStart();
  try {
    const res = await api('voice_join', { room, state: myState() });
    if (V.room !== room) return;
    for (const p of Object.keys(res.peers || {})) if (p !== myId()) pcFor(p);
  } catch (e) { V.room = ''; micStop(); fail(e); layout(); return; }
  if (!o.silent) { sfx('join'); tmsg('ok', r.kind === 'dm' ? `звонок с ${nickOf(dmPeer(r))} · напрямую P2P` : `ты в голосе «${r.name}» · ${n ? 'там ' + n : 'пока один — друзья увидят, что ты тут'}`); }
  if (S.cur !== room && !mobile()) { V.mini = true; }
  layout(); vuStart(); bus.emit('vjoined', room);
}
export async function leave(o = {}) {
  if (!V.room) return;
  const room = V.room, secs = (Date.now() - V.since) / 1000;
  if (ringOut && ringOut.room === room) { hangOut('left'); o = { ...o, logCall: false }; } // ушёл, пока ещё звонили — гасим звонок у друга
  if (V.share) stopShare(true);
  if (V.cam) camStop(true);
  for (const p of [...V.peers.keys()]) closePeer(p);
  V.resets.clear(); micStop(); V.room = ''; V.mini = false; popToggle(false);
  try { await api('voice_leave'); } catch (_) {}
  const r = S.rooms.get(room);
  if (r && r.kind === 'dm' && !o.silent && secs > 5 && o.logCall !== false) api('send', { room, kind: 'sys', text: 'call:' + dur(secs) }).then(m => import('./state.js').then(s => s.pushLocal(m))).catch(() => {});
  if (!o.silent) { sfx('leave'); tmsg('ok', r && r.kind === 'dm' ? `звонок завершён · ${dur(secs)}` : 'ты вышел из голоса · чат остаётся'); }
  layout(); bus.emit('vleft', room);
}

/* ---------- раскладка: без голоса — список и чат; в голосе — сверху сцена звонка (как в Discord), под ней чат ---------- */
const vjoin = $('.js-vjoin'), mini = $('.js-mini'), stage = $('.js-stage'), stb = $('.js-stb');
export function layout() {
  const calm = !V.room || V.mini;
  app.classList.toggle('calm', calm); app.classList.toggle('invoice', !!V.room);
  if (calm) setFocus(false);
  const r = S.rooms.get(V.room);
  app.classList.toggle('dmcall', !!(r && r.kind === 'dm'));
  mini.hidden = !(V.room && V.mini);
  $('.me').classList.toggle('vc', !!V.room);
  syncJoin(); syncCtrl(); renderRows(); renderBar(); fit();
  bus.emit('layout');
}
/** «только звонок»: чат прячется, сцена на всю высоту */
export function setFocus(on) {
  on = !!on && !!V.room && !V.mini;
  if (app.classList.contains('stfocus') === on) return;
  app.classList.toggle('stfocus', on);
  const b = $('.js-stfull'); b.setAttribute('aria-pressed', String(on)); b.innerHTML = ic(on ? 'minimize-2' : 'expand');
  b.title = on ? 'Вернуть чат под звонок' : 'Только звонок — чат спрятать';
  bus.emit('layout');
}
$('.js-stfull').addEventListener('click', () => setFocus(!app.classList.contains('stfocus')));
export function setMini(on, manual) {
  if (!V.room || mobile()) return;
  V.mini = !!on; V.manualMini = V.mini && !!manual; layout();
  if (!V.mini) tmsg('ok', 'звонок развёрнут'); else if (manual) tmsg('ok', 'звонок свёрнут · окошко можно таскать');
}
function syncJoin() {
  // «Зайти» в голос группы — только трубкой в шапке чата; сверху остаётся лишь свёрнутый звонок (вернуться в него)
  if (!V.room) vjoin.hidden = true;
  else if (V.mini) {
    vjoin.hidden = false; vjoin.className = 'vjoin min js-vjoin';
    vjoin.innerHTML = `<span class="vj-dot"></span><span class="vj-t">${esc(roomLabel(V.room))}</span><span class="n js-up">${dur((Date.now() - V.since) / 1000)}</span>${ic('maximize-2')}`;
    vjoin.setAttribute('aria-label', 'Развернуть звонок'); vjoin.title = 'Развернуть звонок';
  } else vjoin.hidden = true;
}
const roomLabel = id => { const r = S.rooms.get(id); return r ? (r.kind === 'dm' ? 'лс·' + nickOf(dmPeer(r)) : r.name) : '—'; };
vjoin.addEventListener('click', () => { if (!V.room) join(S.cur); else setMini(false); });
$('.js-vmin').addEventListener('click', () => setMini(true, true));
/* шапка сцены: кто/где, сколько, качество связи, таймер */
const stwho = $('.js-stwho'), stq = $('.js-stq');
let whoSig = '';
function renderBar() {
  if (!V.room) { whoSig = ''; return; }
  const n = voiceCount(V.room), r = S.rooms.get(V.room), dm = r && r.kind === 'dm', p = dm ? dmPeer(r) : '';
  $('.js-mch').textContent = roomLabel(V.room);
  const sig = V.room + '|' + (dm ? avaOf(p) + nickOf(p) : (r ? r.name + r.pic + r.color : ''));
  if (sig !== whoSig) {
    whoSig = sig;
    stwho.innerHTML = dm ? `<img class="ava" alt="" src="${avaOf(p)}"><b>${esc(nickOf(p))}</b>` : r ? `${tileHTML(r)}<b>${esc(r.name)}</b>` : '';
  }
  $('.js-vmeta').textContent = dm ? (voiceIn(V.room)[p] ? 'звонок напрямую' : ringOut ? 'звоним…' : isOnline(p) ? 'ждём ответа' : 'ждём, когда зайдёт в сеть') : n >= MAXV ? `в голосе ${n} · мест нет` : n >= MAXV - 1 ? `в голосе ${n} · осталось одно место` : n <= 1 ? 'ты пока один — позови друзей «+»' : `в голосе ${n}`;
  const add = $('.js-stadd'); add.hidden = !r || (r.kind === 'group' && r.pending);
  add.title = dm ? 'Добавить друзей — звонок станет группой' : 'Позвать в голос';
  paintQ();
}
/** качество связи — по худшему пингу до участников */
function paintQ() {
  const ps = [...V.peers.values()].filter(P => ['connected', 'completed'].includes(P.pc.iceConnectionState));
  const worst = ps.reduce((m, P) => Math.max(m, P.rtt ?? 0), 0), relay = ps.some(P => P.path === 'relay');
  const lv = !ps.length ? 0 : worst < 90 ? 4 : worst < 160 ? 3 : worst < 300 ? 2 : 1;
  stq.dataset.lv = String(lv);
  stq.title = !ps.length ? (V.peers.size ? 'соединяю…' : 'пока ты один') : `пинг ${worst} мс · ${relay ? 'через ретранслятор' : ps.some(P => P.path === 'lan') ? 'по локалке' : 'напрямую'}`;
  stq.setAttribute('aria-label', 'Качество связи: ' + stq.title);
}
bus.on('tick', () => {
  if (!V.room) return;
  const s = dur((Date.now() - V.since) / 1000); $$('.js-up').forEach(e => e.textContent = s);
  if (brbUntil && brbUntil < Date.now()) { brbUntil = 0; tmsg('ok', 'перерыв закончился — все назад!'); sfx('allhere'); renderRows(); }
});

/* ---------- плитки участников (как в Discord): аватарка или вебка, ник, значки, отметки переклички ---------- */
const vt = $('.js-vt');
let lastCamV = false;
const tiles = new Map(); // peer → плитка (живут, пока человек в звонке: видео внутри не пересоздаётся)
const brbs = new Map();  // peer → до скольки перерыв
export const camOf = p => p === myId() ? V.camS : (V.peers.get(p) || {}).media ? V.peers.get(p).media.cam || null : null;
function tileFor(p) {
  let el = tiles.get(p);
  if (!el) {
    el = document.createElement('div'); el.className = 'vtile'; el.dataset.u = p; el.setAttribute('role', 'listitem'); el.tabIndex = 0;
    el.innerHTML = `<video class="tv" autoplay playsinline muted hidden></video><span class="tav"><img class="ava" alt=""></span><span class="tbadge"></span><span class="tmark" hidden></span><span class="tfoot"><span class="tn"><b></b><span class="tic"></span></span><span class="tping"></span></span>`;
    tiles.set(p, el);
  }
  return el;
}
function badgeOf(p, st, me, P) {
  if (st.share) return ['live', 'LIVE'];
  if (!me && P && P.duck > Date.now()) return ['duck', 'громко — приглушил'];
  if ((brbs.get(p) || 0) > Date.now()) return ['brb', 'перерыв'];
  if (!me && P && !['connected', 'completed'].includes(P.pc.iceConnectionState)) return ['wait', 'соединяю…'];
  if (me && +prefs.ptt && V.mic && !V.deaf && !V.ptt) return ['ptt', 'рация · ' + keyLabel(pttCode())];
  return null;
}
function paintTile(el, p, st) {
  const me = p === myId(), P = V.peers.get(p), loc = !me && mutedFor(p);
  const img = $('.ava', el), src = avaOf(p); if (img.getAttribute('src') !== src) img.src = src;
  el.style.setProperty('--tc', colorOf(p));
  $('.tn b', el).textContent = nickOf(p);
  const micOff = !st.mic || (me && !micOn()), icons = [];
  if (loc) icons.push(['volume-x', 'заглушён у тебя']);
  if (st.deaf) icons.push(['headphone-off', 'не слышит']); else if (micOff) icons.push(['mic-off', 'без мика']);
  if (st.cam) icons.push(['video', 'вебка']);
  const isig = icons.map(i => i[0]).join();
  const tic = $('.tic', el); if (tic.dataset.s !== isig) { tic.dataset.s = isig; tic.innerHTML = icons.map(([i, t]) => `<span title="${t}">${ic(i)}</span>`).join(''); }
  const bd = badgeOf(p, st, me, P), be = $('.tbadge', el), bsig = bd ? bd.join() : '';
  if (be.dataset.s !== bsig) { be.dataset.s = bsig; be.className = 'tbadge' + (bd ? ' b-' + bd[0] : ''); be.textContent = bd ? bd[1] : ''; }
  const ping = me ? '' : P && P.rtt != null ? P.rtt + ' мс' + (P.path === 'relay' ? ' · через друга' : '') : '';
  $('.tping', el).textContent = ping;
  el.classList.toggle('me', me); el.classList.toggle('muted', micOff || !!st.deaf); el.classList.toggle('loc', loc);
  const cs = camOf(p), v = $('.tv', el);
  if (cs) { if (v.srcObject !== cs) { v.srcObject = cs; v.play().catch(() => {}); } v.hidden = false; }
  else if (v.srcObject) { v.srcObject = null; v.hidden = true; }
  el.classList.toggle('cam', !!cs); el.classList.toggle('mir', !!cs && me && prefs.camMirror !== false);
  paintMark(el, p);
  el.title = me ? 'это ты · правый клик — мик и звук' : `клик — пнуть · правый клик — громкость${volOf(p) !== 100 ? ' (сейчас ' + volOf(p) + '%)' : ''} и меню`;
  el.setAttribute('aria-label', `${nickOf(p)}${me ? ' (ты)' : ''}${micOff ? ', без мика' : ''}${st.deaf ? ', без звука' : ''}${st.share ? ', показывает экран' : ''}`);
}
export function renderRows() {
  if (!V.room) { tiles.forEach(el => { const v = $('.tv', el); v.srcObject = null; }); tiles.clear(); vt.innerHTML = ''; return; }
  const vs = voiceIn(V.room), me = myId();
  const ids = [me, ...Object.keys(vs).filter(p => p !== me).sort((a, b) => (vs[a].since || 0) - (vs[b].since || 0))];
  for (const [p, el] of tiles) if (!ids.includes(p)) { $('.tv', el).srcObject = null; el.remove(); tiles.delete(p); }
  ids.forEach((p, i) => {
    const el = tileFor(p); paintTile(el, p, p === me ? myState() : vs[p] || {});
    if (vt.children[i] !== el) vt.insertBefore(el, vt.children[i] || null);
  });
  const w = waitTile(vs), old = $('.vtile.wait', vt);
  if (w) { if (old) old.replaceWith(w); else vt.appendChild(w); } else if (old) old.remove();
  vt.dataset.n = String(vt.children.length);
  const camV = [...tiles.values()].some(el => el.classList.contains('cam')); if (camV !== lastCamV) { lastCamV = camV; bus.emit('stagevid'); }
  $('.js-mav').innerHTML = ids.map(p => `<img alt="${esc(nickOf(p))}" title="${esc(nickOf(p))}" data-u="${esc(p)}" src="${avaOf(p)}" width="24" height="24">`).join('');
  renderBar(); fitTiles();
}
// в личке, пока друга нет в звонке — его «призрак»: звоним / не в сети, ждём
function waitTile(vs) {
  const r = S.rooms.get(V.room); if (!r || r.kind !== 'dm') return null;
  const p = dmPeer(r); if (!p || vs[p]) return null;
  const on = isOnline(p), ringing = !!(ringOut && ringOut.peer === p), what = ringing ? 'звоним…' : on ? 'в сети · не в звонке' : 'не в сети · позвоним, как зайдёт';
  const d = document.createElement('div'); d.className = 'vtile wait' + (on ? '' : ' off') + (ringing ? ' ringing' : ''); d.dataset.wait = p; d.setAttribute('role', 'listitem');
  d.style.setProperty('--tc', colorOf(p));
  d.innerHTML = `<span class="tav"><img class="ava" alt="" src="${avaOf(p)}"></span><span class="tfoot"><span class="tn"><b>${esc(nickOf(p))}</b></span><span class="tping">${what}</span></span>${on && !ringOut ? `<button class="vtag js-reRing" type="button">${ic('phone')}Позвонить</button>` : ''}`;
  return d;
}
/** раскладка плиток: подбираем число колонок, чтобы плитки 16:9 были как можно крупнее */
function fitTiles() {
  const n = vt.children.length; if (!n || !V.room) return;
  if (stb.classList.contains('has-scr')) { vt.style.removeProperty('--tw'); return; }
  const W = vt.clientWidth - 4, H = vt.clientHeight - 4, g = 10; if (W < 40 || H < 40) return;
  let best = 0;
  for (let c = 1; c <= n; c++) { const r = Math.ceil(n / c); const w = Math.min((W - g * (c - 1)) / c, ((H - g * (r - 1)) / r) * 16 / 9); if (w > best) best = w; }
  vt.style.setProperty('--tw', Math.max(120, Math.floor(Math.min(best, 560))) + 'px');
}
new ResizeObserver(() => requestAnimationFrame(fitTiles)).observe(vt);
vt.addEventListener('click', e => {
  if (e.target.closest('.js-reRing')) { const r = S.rooms.get(V.room); if (r && r.kind === 'dm' && !ringOut) ring(V.room, dmPeer(r)); return; }
  const r = e.target.closest('.vtile[data-u]'); if (r && r.dataset.u !== myId()) nudge(r.dataset.u);
});
vt.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.vtile[data-u]')) { e.preventDefault(); e.target.click(); } });
$('.js-mav').addEventListener('click', e => { const i = e.target.closest('img[data-u]'); if (i && i.dataset.u !== myId()) nudge(i.dataset.u); });
bus.on('media', (peer, k) => { if (k === 'cam' && V.room) renderRows(); });
bus.on('pref', k => { if (k === 'camMirror' && V.room) renderRows(); });

/* VU и «говорит»: зелёная обводка плитки */
const buf = new Uint8Array(512);
function lvl(an) { if (!an) return 0; an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; s += x * x; } return Math.sqrt(s / buf.length); }
let vuT = 0, vuRaf = 0;
function vuStart() { if (!vuRaf) vuRaf = requestAnimationFrame(vuLoop); }
function vuLoop(ts) {
  if (!V.room) { vuRaf = 0; return; }
  vuRaf = requestAnimationFrame(vuLoop);
  if (ts - vuT < 60) return; const dt = vuT ? ts - vuT : 60; vuT = ts;
  const put = (peer, l) => {
    const talk = l > .02, el = tiles.get(peer);
    // --lv нужен только обводке «говорит»; шаг 0.1 — меньше пересчётов стиля и перерисовок (16 раз в секунду на каждого)
    if (el) { el.classList.toggle('talking', talk); if (talk) { const v = (Math.round(Math.min(1, l * 6) * 10) / 10).toFixed(1); if (el._lv !== v) { el._lv = v; el.style.setProperty('--lv', v); } } }
    const im = $(`.js-mav img[data-u="${CSS.escape(peer)}"]`); if (im) im.classList.toggle('talking', talk);
    if (talk) bus.emit('talk', peer);
  };
  V.level = micOn() && V.gateOpen ? lvl(V.an) : 0; put(myId(), V.level);
  for (const P of V.peers.values()) { P.level = (V.deaf || (prefs.mute || {})[P.peer]) ? 0 : lvl(P.an); guard(P, dt); put(P.peer, P.level); }
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
  if (V.room) { tiles.forEach((el, p) => { const P = V.peers.get(p); const t = $('.tping', el); if (P && t && P.rtt != null) t.textContent = P.rtt + ' мс' + (P.path === 'relay' ? ' · через друга' : ''); }); paintQ(); }
}, 3000);

/* ---------- кнопки управления ---------- */
const micB = $('.js-mic'), deafB = $('.js-deaf'), camB = $('.js-cam'), shareB = $('.js-share'), leaveB = $('.js-leave');
function syncCtrl() {
  const mOn = V.mic && !V.deaf;
  micB.setAttribute('aria-pressed', String(mOn)); micB.classList.toggle('off', !mOn); micB.innerHTML = ic(mOn ? 'mic' : 'mic-off');
  deafB.setAttribute('aria-pressed', String(!V.deaf)); deafB.classList.toggle('off', V.deaf); deafB.innerHTML = ic(V.deaf ? 'headphone-off' : 'headphones');
  camB.setAttribute('aria-pressed', String(V.cam)); camB.innerHTML = ic(V.cam ? 'video' : 'video-off');
  shareB.classList.toggle('on', V.share); shareB.innerHTML = ic(V.share ? 'monitor-off' : 'monitor-up');
  shareB.title = (V.share ? 'Остановить показ экрана · ' : 'Показать экран друзьям в голосе · ') + keyLabel(keyOf('share'));
  shareB.setAttribute('aria-label', V.share ? 'Остановить показ экрана' : 'Показать экран');
  shareB.setAttribute('aria-pressed', String(V.share));
  micB.title = 'Микрофон · ' + keyLabel(keyOf('mic')); deafB.title = 'Звук · ' + keyLabel(keyOf('deaf'));
  syncShareBar();
  const mm = $('.js-mmic'), md = $('.js-mdeaf');
  mm.innerHTML = micB.innerHTML; mm.classList.toggle('off', !mOn); mm.setAttribute('aria-pressed', String(mOn)); mm.setAttribute('aria-label', 'Микрофон');
  md.innerHTML = deafB.innerHTML; md.classList.toggle('off', V.deaf); md.setAttribute('aria-pressed', String(!V.deaf)); md.setAttribute('aria-label', 'Звук');
  bus.emit('selfstate');
}
// мик и звук переключаются и вне звонка: состояние запоминается и действует при следующем заходе
export function toggleMic() {
  if (V.deaf) { V.deaf = false; setPref('selfDeaf', false); if (V.room) applyVolAll(); V.mic = true; } // как в Discord: из «без звука» — сразу всё включено
  else V.mic = !V.mic;
  setPref('selfMute', !V.mic);
  if (V.room) { applyMic(); pushState(); } else syncCtrl();
  tmsg('ok', V.mic ? 'мик включён' : 'мик выключен' + (V.room ? '' : ' — так и зайдёшь в звонок')); sfx(V.mic ? 'unmute' : 'mute');
}
export function toggleDeaf() {
  V.deaf = !V.deaf; setPref('selfDeaf', V.deaf);
  if (V.room) { applyVolAll(); applyMic(); pushState(); } else syncCtrl();
  tmsg('ok', V.deaf ? 'звук выключен — ты никого не слышишь, и тебя тоже' : 'звук снова включён'); sfx(V.deaf ? 'deaf' : 'undeaf');
}
micB.addEventListener('click', toggleMic); deafB.addEventListener('click', toggleDeaf);
$('.js-mmic').addEventListener('click', toggleMic); $('.js-mdeaf').addEventListener('click', toggleDeaf);
leaveB.addEventListener('click', () => leave()); $('.js-mleave').addEventListener('click', () => leave());
$('.js-mexp').addEventListener('click', () => setMini(false)); $('.js-mscr').addEventListener('click', () => setMini(false));
camB.addEventListener('click', () => V.cam ? camStop() : camStart());
export const toggleShare = () => { if (!V.room) { tmsg('warn', 'экран показывают в голосе — сначала зайди'); return; } if (V.share) stopShare(); else openW('share'); };
shareB.addEventListener('click', toggleShare);

/* ---------- вебка ---------- */
const camC = () => { const h = +prefs.camRes || 720, c = { height: { ideal: h }, width: { ideal: Math.round(h * 16 / 9) }, frameRate: { ideal: 30 } }; if (prefs.camId) c.deviceId = { ideal: prefs.camId }; return c; };
export async function camStart() {
  if (!V.room) { tmsg('warn', 'вебка работает в голосе — сначала зайди'); return; }
  try { V.camS = await navigator.mediaDevices.getUserMedia({ video: camC() }); }
  catch (e) { tmsg('err', 'вебка недоступна: ' + (e.message || e.name)); return; }
  V.cam = true; sendMetaAll();
  const t = V.camS.getVideoTracks()[0];
  for (const P of V.peers.values()) P.camTx = P.pc.addTrack(t, V.camS);
  t.onended = () => camStop();
  bus.emit('media', myId(), 'cam', V.camS); syncCtrl(); renderRows(); pushState();
  tmsg('ok', 'вебка включена · видят все в голосе');
}
/* качество или камеру сменили в настройках, пока вебка включена, — меняем на лету, друзья видят сразу */
async function camRe(dev) {
  const s = V.camS, old = s && s.getVideoTracks()[0]; if (!old) return;
  const c = camC();
  if (!dev) { const { deviceId, ...q } = c; try { await old.applyConstraints(q); renderRows(); return; } catch (_) {} } // не вышло — откроем камеру заново
  let t; try { t = (await navigator.mediaDevices.getUserMedia({ video: c })).getVideoTracks()[0]; }
  catch (e) { tmsg('err', 'вебка недоступна: ' + (e.message || e.name)); return; }
  if (V.camS !== s) { t.stop(); return; } // пока открывали — выключил вебку
  for (const P of V.peers.values()) if (P.camTx) P.camTx.replaceTrack(t).catch(() => {});
  old.onended = null; s.removeTrack(old); old.stop(); s.addTrack(t); t.onended = () => camStop();
  document.querySelectorAll('video').forEach(v => { if (v.srcObject === s) { v.srcObject = null; v.srcObject = s; v.play().catch(() => {}); } });
  bus.emit('media', myId(), 'cam', s); renderRows();
}
export function camStop(silent) {
  if (!V.camS) return;
  for (const P of V.peers.values()) { if (P.camTx) { try { P.pc.removeTrack(P.camTx); } catch (_) {} P.camTx = null; } }
  V.camS.getTracks().forEach(t => t.stop()); V.camS = null; V.cam = false;
  sendMetaAll(); bus.emit('media', myId(), 'cam', null); syncCtrl(); renderRows(); pushState();
  if (!silent) tmsg('ok', 'вебка выключена');
}

/* ---------- демка (показ экрана) ---------- */
export async function startShare(o = {}) {
  if (!V.room) { tmsg('warn', 'экран показывают в голосе — сначала зайди'); return; }
  const h = +(o.res || prefs.shareRes) || 1080, fps = +(o.fps || prefs.shareFps) || 30;
  const wantAudio = o.audio ?? !!prefs.shareAudio;
  const codecP = hwCodec(h, fps); // пока выбираешь экран — узнаём, умеет ли видеокарта
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
  const vt0 = s.getVideoTracks()[0]; if (vt0) { vt0.contentHint = shareProfile(h, fps).motion ? 'motion' : 'detail'; vt0.onended = () => stopShare(); }
  // Не держим запуск заложником зависшего драйвера MediaCapabilities.
  V.scrCodec = await Promise.race([codecP.catch(() => ''), new Promise(resolve => setTimeout(() => resolve(''), 800))]);
  if (!V.room || V.scrS !== s) return;
  Object.assign(shareStat, { h: 0, fps: 0, codec: '', hw: false, lim: '', n: 0 });
  sendMetaAll();
  for (const P of V.peers.values()) addScreen(P);
  bus.emit('media', myId(), 'scr', s); syncCtrl(); renderRows(); pushState();
  api('ev', { room: V.room, kind: 'share', data: { on: true, draw: V.drawOk } }).catch(() => {});
  tmsg('ok', `ты показываешь экран · ${vt0 && vt0.getSettings().height || h}p${s.getAudioTracks().length ? ' со звуком' : ''} · ${V.drawOk ? 'рисовать можно всем' : 'рисовать нельзя'}`);
  sfx('streamon');
}
/* плашка сверху, пока показываешь экран: видно всегда, даже в мини-окне звонка */
const sbar = $('.js-sharebar');
function syncShareBar() {
  const on = !!(V.share && V.room); sbar.hidden = !on; app.classList.toggle('sharing', on); if (!on) return;
  const n = watchersOf(myId()).length, t = V.scrS && V.scrS.getVideoTracks()[0], st = t ? t.getSettings() : {}, q = shareStat;
  // друзьям уходит q.h/q.fps (из статистики WebRTC); пока никто не смотрит — что захватывается с экрана
  const h = q.n ? q.h : st.height, f = q.n ? q.fps : Math.round(st.frameRate || 0);
  const lim = q.lim === 'bandwidth' ? ' · упирается в интернет' : q.lim === 'cpu' ? ' · упирается в процессор' : '';
  $('.js-sbsub', sbar).textContent = (n ? `видят ${n} · ` : 'пока никто не смотрит · ') + (h ? h + 'p' : '') + (f ? ' · ' + f + ' fps' : '') + (q.n && q.codec ? ' · ' + q.codec + (q.hw ? ' на видеокарте' : '') : '') + lim + (V.scrS && V.scrS.getAudioTracks().length ? ' · со звуком' : '');
  sbar.title = lim ? (q.lim === 'bandwidth' ? 'Интернет не тянет выбранное качество — WebRTC снижает его сам. Помогает 720p или 30 fps.' : 'Процессор не успевает кодировать — помогает 30 fps или 720p, или видеокарта с аппаратным кодеком.') : '';
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
  if (!silent) { tmsg('ok', 'показ экрана остановлен'); sfx('streamoff'); }
}

/** качество показа на лету — без перезапуска демки */
export async function setShareQ(res, fps) {
  const t = V.scrS && V.scrS.getVideoTracks()[0]; if (!t) return;
  res = +res || +prefs.shareRes || 1080; fps = +fps || +prefs.shareFps || 30;
  try { await t.applyConstraints({ height: { ideal: res, max: res }, frameRate: { ideal: fps, max: fps } }); }
  catch (_) { tmsg('warn', 'такое качество экран не тянет — оставил как было'); return; }
  setPref('shareRes', res); setPref('shareFps', fps);
  t.contentHint = shareProfile(res, fps).motion ? 'motion' : 'detail';
  V.peers.forEach(applyBitrate); syncShareBar(); bus.emit('shareq');
  const st = t.getSettings(); tmsg('ok', `качество показа: ${st.height || res}p · ${Math.round(st.frameRate || fps)} fps · друзья видят сразу`);
}

/* ---------- события голоса от ядра ---------- */
bus.on('voice', (room, peer, st, had) => {
  // bus.emit('voice', room) без человека — просто «перерисуй»: это не «друг вышел» (иначе звонок в личке сам вешался,
  // когда звонишь ещё раз или друг появляется в сети, пока ты ждёшь его в звонке)
  if (!peer) { if (room === V.room) renderRows(); layout(); return; }
  if (peer === myId()) { if (room === V.room && !st && V.room) { /* ядро выкинуло */ } layout(); return; }
  if (room === V.room) {
    if (st && !had) { pcFor(peer); sfx('pjoin'); tmsg('ok', `${nickOf(peer)} зашёл в голос`, true); }
    else if (st && !V.peers.has(peer)) pcFor(peer);
    if (!st) { closePeer(peer); if (had) { sfx('pleave'); tmsg('ok', `${nickOf(peer)} вышел из голоса`, true); } const r = S.rooms.get(room); if (r && r.kind === 'dm' && !Object.keys(voiceIn(room)).some(p => p !== myId())) { if (Date.now() - V.since > 3000) leave({ logCall: false }); /* запись «звонок · 0:23» оставляет тот, кто положил трубку — без дублей */ } }
    if (st && !st.share) { const P = V.peers.get(peer); if (P && P.media.scr) { delete P.media.scr; bus.emit('media', peer, 'scr', null); } }
    if (st && !st.cam) { const P = V.peers.get(peer); if (P && P.media.cam) { delete P.media.cam; bus.emit('media', peer, 'cam', null); } }
    renderRows(); syncShareBar();
  }
  syncJoin();
});
bus.on('room', r => { if (r && r.id === S.cur) syncJoin(); }); // админ выключил/включил голос — «Зайти» сразу прячется/появляется
bus.on('presence', (peer, on) => { if (!on && V.peers.has(peer)) { closePeer(peer); renderRows(); } });
bus.on('open', id => {
  syncJoin();
  if (!V.room || mobile()) return;
  if (id === V.room) { if (V.mini && !V.manualMini) setMini(false); }
  else if (!V.mini) setMini(true, false);
});
bus.on('pref', k => {
  if (k === 'vol' || k === 'mute' || k === 'outVol' || k === 'outId' || k === 'earGuard') applyVolAll();
  if (['micId', 'nsMode', 'ec', 'agc'].includes(k) && V.room) micRestart();
  if (k === 'bitrate') V.peers.forEach(applyBitrate);
  if (k === 'ptt') applyMic();
  if ((k === 'camRes' || k === 'camId') && V.camS) camRe(k === 'camId');
  // сменили в настройках во время демки: режим — сразу в кодек, «кто рисует» — сразу всем в звонке
  if (k === 'shareHint' && V.scrS) { const t = V.scrS.getVideoTracks()[0]; if (t) t.contentHint = shareProfile(+prefs.shareRes || 1080, Math.round(t.getSettings().frameRate || 0) || +prefs.shareFps || 30).motion ? 'motion' : 'detail'; V.peers.forEach(applyBitrate); }
  if (k === 'shareDraw' && V.share && V.room) { V.drawOk = prefs.shareDraw !== 'none'; api('ev', { room: V.room, kind: 'share', data: { on: true, draw: V.drawOk } }).catch(() => {}); }
});
bus.on('peer-vol', () => { applyVolAll(); renderRows(); });
bus.on('room_removed', room => { if (room === V.room) leave({ silent: true }); });

/* ---------- звонки в личке ---------- */
export async function call(room) {
  const r = S.rooms.get(room); if (!r || r.kind !== 'dm') return;
  const p = dmPeer(r);
  // заблокированному звонок всё равно не дойдёт (ядро молча режет) — не держу человека 30 сек на «звоним…»
  if (isBlocked(p)) { tmsg('warn', `${nickOf(p)} в блоке — разблокируй, чтобы позвонить`); return; }
  if (voiceIn(room)[p]) { join(room); return; } // друг уже ждёт в звонке
  await join(room, { silent: true });
  if (V.room !== room) return;
  if (!isOnline(p)) {
    // друг не в сети — сижу в звонке и жду: как появится, ядро скажет ему, что я тут, и я сразу позвоню
    waitDm = p; sfx('join');
    toast({ ava: avaOf(p), icon: 'phone', title: `${nickOf(p)} сейчас не в сети`, sub: 'ты в звонке — как зайдёт, ему позвонит, и он увидит, что ты ждёшь', tag: 'Ждём', dur: 9000,
      actions: [{ label: 'Не ждать', cls: 'gbtn', fn: () => leave({ silent: true }) }] });
    renderRows(); return;
  }
  ring(room, p);
}
async function ring(room, p, back) {
  waitDm = '';
  try { await api('ev', { room, kind: 'ring', data: {} }); } catch (e) { fail(e); leave({ silent: true }); return; }
  if (V.room !== room || ringOut) return;
  let n = 0;
  // сцена и так показывает «звоним…» и кнопку сброса — тост нужен, только когда звонок свёрнут
  const t = !V.mini ? null : toast({ ava: avaOf(p), icon: 'phone', title: back ? `${nickOf(p)} в сети — звоним…` : `звоним ${nickOf(p)}…`, sub: 'напрямую P2P, без серверов', tag: 'Звонок', cls: 'ring', actions: [{ label: 'Сбросить', cls: 'gbtn', fn: () => { hangOut('cancel'); } }] });
  ringOut = { room, peer: p, t, iv: setInterval(() => { if (++n > 10) { hangOut('timeout'); return; } sfx('ringback'); }, 2500) };
  sfx('ringback'); bus.emit('voice', room); renderRows();
}
// друг, которого я жду в звонке, появился в сети — звоню ему
bus.on('presence', (peer, on, was) => {
  if (!on || !V.room || ringOut) return;
  const r = S.rooms.get(V.room); if (!r || r.kind !== 'dm' || dmPeer(r) !== peer || voiceIn(V.room)[peer]) { if (r && r.kind === 'dm') renderRows(); return; }
  if (was) return; // и так был в сети — это просто свежий пинг, а не «появился»: не перезваниваю сам каждые полминуты
  const room = V.room; renderRows();
  setTimeout(() => { if (V.room === room && !ringOut && isOnline(peer) && !voiceIn(room)[peer]) ring(room, peer, true); }, 1500);
});
bus.on('presence', (peer, on) => { if (!on && waitDm !== peer && V.room) { const r = S.rooms.get(V.room); if (r && r.kind === 'dm' && dmPeer(r) === peer) renderRows(); } });
bus.on('vleft', () => { waitDm = ''; });
// друг ждёт меня в звонке (зашёл, пока я был не в сети, или звонок не дошёл) — напоминаю, если не звонит сам
function waitingFor(room, peer) {
  const r = S.rooms.get(room); if (!r || r.kind !== 'dm' || dmPeer(r) !== peer) return;
  setTimeout(() => {
    if (V.room === room || ringIn.has(room) || !voiceIn(room)[peer] || Date.now() - (declined.get(room) || 0) < 60000) return;
    if (document.querySelector(`.toast[data-wait="${CSS.escape(room)}"]`)) return;
    const t = toast({ ava: avaOf(peer), icon: 'phone', title: `${nickOf(peer)} в звонке с тобой`, sub: 'ждёт, когда зайдёшь', tag: 'Звонок', cls: 'ring',
      actions: [{ label: 'Зайти', cls: 'cbtn', fn: () => join(room) }, { label: 'Не сейчас', cls: 'gbtn', fn: () => declined.set(room, Date.now()) }] });
    if (t) t.dataset.wait = room;
    notify({ tone: 'ring', say: `${nickOf(peer)} ждёт тебя в звонке` });
  }, 2500);
}
const unwait = room => document.querySelectorAll(`.toast[data-wait="${CSS.escape(room)}"]`).forEach(closeToast);
bus.on('voice', (room, peer, st, had) => {
  if (st && !had && peer !== myId() && room !== V.room) waitingFor(room, peer);
  if (!st || (peer === myId() && st)) unwait(room);
});
export function checkWaiting() { for (const room of Object.keys(S.voices)) for (const peer of Object.keys(S.voices[room] || {})) if (peer !== myId()) waitingFor(room, peer); }
function hangOut(why) {
  if (!ringOut) return; const { room, peer, t, iv } = ringOut; ringOut = null;
  clearInterval(iv); closeToast(t);
  if (why === 'answered') return;
  api('ev', { room, kind: 'ring_stop', data: { why } }).catch(() => {});
  if (why === 'timeout' || why === 'declined') sfx('hangup');
  if (why === 'timeout') {
    // не вешаю трубку: звонок перестаёт звенеть, а ты остаёшься в звонке и ждёшь сколько угодно —
    // у друга висит «ждёт тебя в звонке», и можно позвонить ещё раз кнопкой на сцене
    api('send', { room, kind: 'sys', text: 'missed' }).then(m => import('./state.js').then(s => s.pushLocal(m))).catch(() => {});
    if (V.room === room) { tmsg('warn', `${nickOf(peer)} пока не ответил — ты в звонке, ждём · «Позвонить ещё раз» — на сцене`); bus.emit('voice', room); renderRows(); return; }
    tmsg('warn', `${nickOf(peer)} не ответил`);
  }
  if (why === 'declined') tmsg('warn', `${nickOf(peer)} сбросил звонок`);
  if (why === 'left') return;
  if (V.room === room) leave({ silent: true, logCall: false });
  else layout();
}
bus.on('voice', (room, peer, st) => { if (ringOut && room === ringOut.room && peer === ringOut.peer && st) { hangOut('answered'); tmsg('ok', `${nickOf(peer)} ответил · голос напрямую`); } });
bus.on('ev:ring', v => {
  const r = S.rooms.get(v.room); if (!r || r.kind !== 'dm' || ringIn.has(v.room)) return;
  if (V.room === v.room) return;
  const p = v.from; let n = 0;
  const t = toast({ ava: avaOf(p), icon: 'phone', title: `${nickOf(p)} звонит`, sub: 'личка · напрямую P2P', tag: '30 сек', cd: 30, cls: 'ring',
    actions: [{ label: 'Ответить', cls: 'cbtn', fn: () => { stopRing(v.room); openChat(v.room); join(v.room); } }, { label: 'Сбросить', cls: 'gbtn', fn: () => { stopRing(v.room); declined.set(v.room, Date.now()); api('ev', { room: v.room, kind: 'ring_stop', data: { why: 'declined' } }).catch(() => {}); } }],
    onTimeout: () => { stopRing(v.room); waitingFor(v.room, p); } });
  const iv = setInterval(() => { if (++n > 12) { stopRing(v.room); waitingFor(v.room, p); return; } sfx('ring'); }, 2500);
  ringIn.set(v.room, { t, iv });
  notify({ tone: 'ring', say: `${nickOf(p)} звонит`, force: true });
});
function stopRing(room) { const x = ringIn.get(room); if (!x) return; ringIn.delete(room); clearInterval(x.iv); closeToast(x.t); }
bus.on('ev:ring_stop', v => {
  stopRing(v.room);
  if (ringOut && ringOut.room === v.room && v.data && v.data.why === 'declined') hangOut('declined');
  else if (v.data && v.data.why === 'timeout') { tmsg('warn', `пропущенный звонок от ${nickOf(v.from)}`); waitingFor(v.room, v.from); } // друг остался в звонке и ждёт
});
bus.on('call', room => call(room));
bus.on('hang', () => { if (ringOut) hangOut('cancel'); else leave(); });
/* ---------- «+» на сцене: из лички — сделать группу и перенести звонок, в группе — позвать в голос ---------- */
$('.js-stadd').addEventListener('click', e => {
  const r = S.rooms.get(V.room); if (!r) return;
  if (r.kind === 'dm') { openW('group', { with: dmPeer(r), fromCall: V.room }); return; }
  const room = V.room, inV = voiceIn(room), mem = (r.members || []).filter(m => m.peer !== myId());
  const off = mem.filter(m => !inV[m.peer]).sort((a, b) => isOnline(b.peer) - isOnline(a.peer));
  const canAdd = r.invite === 'all' || r.admin, have = new Set(mem.map(m => m.peer));
  const fr = canAdd ? [...S.friends.values()].filter(f => f.state === 'friend' && !have.has(f.peer)).sort((a, b) => isOnline(b.peer) - isOnline(a.peer)).slice(0, 8) : [];
  const call = async (p, add) => {
    try {
      if (add) { const j = await api('room_add', { room, peers: [p] }); if (j && j.id) S.rooms.set(j.id, j); await sleep(1200); }
      await api('ev', { room, kind: 'gather', data: { you: p } });
      tmsg('ok', `${nickOf(p)}${add ? ' в группе —' : ''} позвал в голос`);
    } catch (err) { fail(err); }
  };
  const full = Object.keys(inV).length >= MAXV;
  const items = [{ head: 'Позвать в голос', sub: full ? `в голосе уже ${MAXV} — больше не влезет` : 'друг получит пуш со звуком' }];
  if (!full) {
    for (const m of off) items.push({ img: avaOf(m.peer), label: nickOf(m.peer), sub: isOnline(m.peer) ? 'в сети' : 'не в сети — увидит, когда зайдёт', fn: () => call(m.peer) });
    if (off.length > 1) items.push({ icon: 'bell-ring', label: 'Позвать всех', sub: off.length + ' не в голосе', fn: () => api('ev', { room, kind: 'gather', data: {} }).then(() => tmsg('ok', 'позвал всех, кто не в голосе')).catch(fail) });
    if (fr.length) { items.push('-', { head: 'Добавить в группу и позвать' }); for (const f of fr) items.push({ img: avaOf(f.peer), label: nickOf(f.peer), sub: isOnline(f.peer) ? 'в сети' : 'не в сети', fn: () => call(f.peer, true) }); }
    if (!off.length && !fr.length) items.push({ icon: 'check', label: 'Все уже тут', disabled: true });
  }
  const b = e.currentTarget.getBoundingClientRect();
  openMenu(items, { x: b.left, y: b.bottom + 6, el: e.currentTarget });
});
// друг сделал из нашего звонка группу — переезжаю за ним
bus.on('ev:move', async v => {
  const to = v.data && String(v.data.to || ''); if (!to || V.room !== v.room) return;
  for (let i = 0; i < 40 && !S.rooms.has(to); i++) await sleep(250);
  if (!S.rooms.has(to) || V.room !== v.room) return;
  tmsg('ok', `${nickOf(v.from)} сделал из звонка группу — переношу тебя`);
  join(to);
});
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
  sfx('mention');
});
function voiceItems(p) {
  if (!p) return null;
  if (p === myId()) return personItems(p, { sub: 'ты в голосе', extra: [
    { label: 'Микрофон', check: V.mic && !V.deaf, kbd: 'Ctrl+M', fn: toggleMic },
    { label: 'Звук', check: !V.deaf, kbd: 'Ctrl+D', fn: toggleDeaf },
    { icon: V.share ? 'monitor-off' : 'monitor-up', label: V.share ? 'Остановить показ' : 'Показать экран', kbd: 'Ctrl+Shift+S', fn: () => V.share ? stopShare() : openW('share') },
    '-'] });
  const st = voiceIn(V.room)[p] || {};
  return personItems(p, { voice: !!(V.room && voiceIn(V.room)[p]), extra: V.room && voiceIn(V.room)[p] ? [
    (S.friends.get(p) || {}).state === 'friend' ? null : { icon: 'hand', label: 'Пнуть', fn: () => nudge(p) },
    !st.cam ? { icon: 'video', label: 'Попросить вебку', fn: () => bus.emit('ask', p, 'cam') } : null,
    !st.share ? { icon: 'monitor-up', label: 'Попросить показать экран', fn: () => bus.emit('ask', p, 'share') } : null,
  ] : [] });
}
onCtx('.vr[data-u], .vtile[data-u]', el => voiceItems(el.dataset.u));
onCtx('.vtile.wait[data-wait]', el => personItems(el.dataset.wait));
onCtx('.js-mav img[data-u], .js-wav img[data-u], .js-dsw .dswb[data-u]', el => voiceItems(el.dataset.u));
let nudgeT = 0;
export async function nudge(peer, room) {
  room = room || V.room || (S.friends.get(peer) || {}).dm || '';
  if (!room) { tmsg('warn', 'пнуть можно друга или того, кто с тобой в голосе'); return; }
  if (Date.now() - nudgeT < 2500) { tmsg('ok', 'не так часто — подожди пару секунд'); return; }
  nudgeT = Date.now();
  try { await api('ev', { room, to: peer, kind: 'nudge', data: {} }); tmsg('ok', `пнул ${nickOf(peer)} — у него на экране прилетел кроссовок`); } catch (e) { fail(e); }
}
bus.on('nudge', (peer, room) => nudge(peer, room));
let nudgeEl = null;
/** пинок: прилетает кроссовок в аватарку того, кто пнул, — понятно, кто и зачем, без тряски окна */
function showNudge(from) {
  if (nudgeEl) nudgeEl.remove();
  const d = document.createElement('div'); d.className = 'nudge'; d.setAttribute('role', 'alert'); nudgeEl = d;
  d.innerHTML = `<div class="ng-card glass"><span class="ng-hit"><i class="ng-ring"></i><i class="ng-ring r2"></i><img class="ng-ava" alt="" src="${avaOf(from)}"><img class="ng-boot" alt="" src="emoji/1f45f.webp"><img class="ng-boom" alt="" src="emoji/1f4a5.webp"></span><b style="--c:${colorOf(from)}">${esc(nickOf(from))}</b><small>пнул тебя — зовёт</small></div>`;
  document.body.appendChild(d);
  d.addEventListener('click', () => d.remove());
  requestAnimationFrame(() => d.classList.add('on'));
  setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 500); }, reduce ? 2200 : 2600);
  if (!reduce) app.animate([{ transform: 'none' }, { transform: 'translateX(5px) rotate(.15deg)', offset: .18 }, { transform: 'translateX(-2px)', offset: .45 }, { transform: 'none' }], { duration: 420, delay: 430, easing: 'ease-out' });
}
bus.on('ev:nudge', v => {
  const r = S.rooms.get(v.room), dm = r && r.kind === 'dm' && dmPeer(r) === v.from;
  if (!dm && !voiceIn(v.room)[v.from] && v.room !== V.room) return;
  showNudge(v.from);
  sfx('nudge'); notify({ tone: 'msg', say: `${nickOf(v.from)} пнул тебя` });
});

/* ---------- кнопки F1–F6 ---------- */
const pop = $('.js-vpop');
app.appendChild(pop); // живёт над сеткой: узкая панель голоса её больше не обрезает
function placePop() {
  const b = $('.js-btns').getBoundingClientRect();
  if (!b.width) return popToggle(false);
  // открывается под кнопкой: сцена сверху, места снизу больше
  const w = Math.min(520, innerWidth - 16), left = clamp(b.left + b.width / 2 - w / 2, 8, innerWidth - w - 8);
  const below = innerHeight - b.bottom - 16, above = b.top - 16, down = below >= 260 || below > above;
  Object.assign(pop.style, { left: left + 'px', width: w + 'px', top: down ? (b.bottom + 8) + 'px' : 'auto', bottom: down ? 'auto' : (innerHeight - b.top + 8) + 'px', maxHeight: Math.max(180, down ? below : above) + 'px' });
  pop.classList.toggle('down', down);
}
export function popToggle(on) { pop.hidden = on === undefined ? !pop.hidden : !on; $('.js-btns').classList.toggle('on', !pop.hidden); if (!pop.hidden) placePop(); }
addEventListener('resize', () => { if (!pop.hidden) placePop(); });
new ResizeObserver(() => { if (!pop.hidden) placePop(); }).observe(stage);
$('.js-btns').addEventListener('click', e => { e.stopPropagation(); popToggle(); });
document.addEventListener('click', e => { if (!pop.hidden && !e.target.closest('.js-vpop,.js-btns')) popToggle(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden && !e.defaultPrevented) { e.preventDefault(); popToggle(false); } });
const RND = ['Кто не спит — тот молодец', 'Погнали!', 'Ну вы даёте', 'Это база', 'Я щас вернусь', 'Кринж', 'Красава!', 'Хорош'];
let brbUntil = 0;
export async function fireKey(k) {
  if (!V.room) return;
  const b = $(`.key[data-k="${k}"]`, pop); if (!b) return;
  b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
  const act = b.dataset.act, say = b.dataset.say;
  const rm = S.rooms.get(V.room); if (rm && rm.kind === 'dm' && (act === 'roll' || act === 'call')) { tmsg('ok', 'в личке перекличка и сбор ни к чему'); return; }
  try {
    if (say) { const text = say === '?' ? pick(RND) : say; await api('ev', { room: V.room, kind: 'say', data: { text } }); playSay(myId(), text); return; }
    if (act === 'roll' || act === 'vote') { await startRoll(act); return; }
    if (act === 'call') { await api('ev', { room: V.room, kind: 'gather', data: {} }); tmsg('ok', 'общий сбор: всем в группе, кто не в голосе, пришёл пуш'); return; }
    if (act === 'brb') { const until = Date.now() + 5 * 60000; await api('ev', { room: V.room, kind: 'brb', data: { until } }); onBrb(myId(), until); }
  } catch (e) { fail(e); }
}
function playSay(from, text) { sfx('say'); speak(text, true); toast({ ava: avaOf(from), icon: 'zap', title: nickOf(from), sub: '«' + text + '»', dur: 3500 }); }
function onBrb(from, until) {
  brbUntil = until; brbs.set(from, until); renderRows();
  tmsg('ping', `${nickOf(from)}: перерыв 5 минут — до ${new Date(until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`); sfx('brb');
}
bus.on('ev:say', v => { if (v.room === V.room) playSay(v.from, String((v.data && v.data.text) || '').slice(0, 80)); });
bus.on('ev:brb', v => { if (v.room === V.room && v.data) onBrb(v.from, +v.data.until || Date.now() + 300000); });
bus.on('ev:gather', v => {
  if (V.room === v.room || (v.data && v.data.you && v.data.you !== myId())) return; const r = S.rooms.get(v.room); if (!r) return;
  toast({ ava: avaOf(v.from), icon: 'mic', title: `${nickOf(v.from)} зовёт ${v.data && v.data.you ? 'тебя' : 'всех'} в голос`, sub: `«${r.name}» · там ${voiceCount(v.room)}`, dur: 20000, actions: [{ label: 'Зайти', cls: 'cbtn', fn: () => join(v.room) }, { label: 'Потом', cls: 'gbtn' }] });
  notify({ tone: 'mention', say: `${nickOf(v.from)} зовёт ${v.data && v.data.you ? 'тебя' : 'всех'} в голос`, force: true });
});

/* ---------- перекличка (F1) и голосование (F7): отметки видят все — справа на плитках ---------- */
// roll: { id, by, kind: 'roll'|'vote', q, until, marks: Map(peer → 'here'|'yes'|'no'), done, toast }
let roll = null;
const ROLL_SEC = { roll: 10, vote: 20 };
async function startRoll(kind) {
  if (roll && !roll.done) { tmsg('warn', roll.kind === 'vote' ? 'уже идёт голосование' : 'перекличка уже идёт'); return; }
  let q = '';
  if (kind === 'vote') { q = await askQ(); if (q == null) return; }
  const id = Math.random().toString(36).slice(2, 9);
  await api('ev', { room: V.room, kind: 'roll', data: { id, kind, q, sec: ROLL_SEC[kind] } });
  beginRoll({ id, by: myId(), kind, q, sec: ROLL_SEC[kind] });
  if (kind === 'roll') markRoll(myId(), 'here', true);
  else rollToast();
  tmsg('ok', kind === 'vote' ? 'голосование: ждём всех ' + ROLL_SEC.vote + ' сек' : 'перекличка: ждём ' + ROLL_SEC.roll + ' сек');
}
/** вопрос для голосования — маленькое поле прямо в тосте */
function askQ() {
  return new Promise(res => {
    let done = false; const fin = v => { if (done) return; done = true; closeToast(t); res(v); };
    const t = toast({ icon: 'vote', title: 'Голосование', sub: 'о чём? (можно пусто — просто «да или нет»)', actions: [{ label: 'Начать', cls: 'cbtn', keep: true, fn: () => fin(inp.value.trim().slice(0, 80)) }, { label: 'Отмена', cls: 'gbtn', keep: true, fn: () => fin(null) }] });
    const inp = document.createElement('input'); inp.className = 'tq'; inp.maxLength = 80; inp.placeholder = 'Идём в данж?'; inp.setAttribute('aria-label', 'Вопрос для голосования');
    $('.tw', t).appendChild(inp); setTimeout(() => inp.focus(), 60);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fin(inp.value.trim().slice(0, 80)); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fin(null); } });
    setTimeout(() => fin(null), 30000);
  });
}
function beginRoll({ id, by, kind, q, sec }) {
  if (roll && roll.toast) closeToast(roll.toast);
  clearTimeout(roll && roll.tm);
  roll = { id, by, kind: kind === 'vote' ? 'vote' : 'roll', q: String(q || '').slice(0, 80), until: Date.now() + (sec || 10) * 1000, marks: new Map(), done: false, toast: null };
  roll.tm = setTimeout(() => finishRoll(), (sec || 10) * 1000 + 600);
  renderRows(); paintRoll();
}
function rollToast() {
  if (!roll) return;
  const by = roll.by, vote = roll.kind === 'vote', sec = Math.max(1, Math.round((roll.until - Date.now()) / 1000));
  const answer = v => { if (!roll || roll.done) return; api('ev', { room: V.room, kind: 'here', data: { id: roll.id, v } }).catch(() => {}); markRoll(myId(), v, true); };
  roll.toast = toast({ ava: avaOf(by), icon: vote ? 'vote' : 'users', title: vote ? (roll.q ? '«' + roll.q + '»' : `${by === myId() ? 'ты устроил' : nickOf(by) + ' устроил'} голосование`) : `перекличка от ${nickOf(by)}`,
    sub: vote ? 'за или против? ответ видно только в итоге' : `жми «Тут!» за ${sec} секунд`, tag: sec + ' сек', cd: sec,
    actions: vote ? [{ label: 'За', cls: 'cbtn', fn: () => answer('yes') }, { label: 'Против', cls: 'gbtn', fn: () => answer('no') }] : [{ label: 'Тут!', cls: 'cbtn', fn: () => answer('here') }] });
  if (roll.toast) roll.toast.classList.add('rolltoast');
}
function markRoll(p, v, mine) {
  if (!roll || roll.done) return;
  const had = roll.marks.has(p); roll.marks.set(p, v === 'yes' || v === 'no' ? v : 'here');
  if (!had && !mine) sfx('tick');
  const t = tiles.get(p); if (t) { paintMark(t, p); t.classList.remove('marked'); void t.offsetWidth; t.classList.add('marked'); }
  paintRoll();
  const all = Object.keys(voiceIn(V.room)); if (!all.includes(myId())) all.push(myId());
  if (all.every(x => roll.marks.has(x))) { clearTimeout(roll.tm); roll.tm = setTimeout(() => finishRoll(), 350); }
}
function paintMark(el, p) {
  const m = $('.tmark', el); if (!m) return;
  const v = roll ? roll.marks.get(p) : '';
  const show = roll && (v || !roll.done);
  m.hidden = !show; if (!show) return;
  const reveal = roll.done && roll.kind === 'vote';
  const k = !v ? 'wait' : reveal ? v : 'ok';
  if (m.dataset.k === k) return; m.dataset.k = k;
  m.className = 'tmark m-' + k;
  m.innerHTML = k === 'wait' ? '<i></i><i></i><i></i>' : k === 'yes' ? ic('thumbs-up') : k === 'no' ? ic('thumbs-down') : ic('check');
  m.title = k === 'wait' ? (roll.kind === 'vote' ? 'ещё думает' : 'ещё не отметился') : k === 'ok' ? (roll.kind === 'vote' ? 'проголосовал' : 'отметился') : k === 'yes' ? 'за' : 'против';
}
/** счётчик в шапке сцены: «отметились 2 из 3» */
function paintRoll() {
  let pill = $('.st-roll', stage);
  if (!roll || (roll.done && Date.now() > roll.hideAt)) { if (pill) pill.remove(); return; }
  if (!pill) { pill = document.createElement('span'); pill.className = 'st-roll'; $('.js-vmeta', stage).after(pill); }
  const all = Object.keys(voiceIn(V.room)); if (!all.includes(myId())) all.push(myId());
  const n = all.filter(p => roll.marks.has(p)).length, vote = roll.kind === 'vote';
  if (roll.done && vote) { const y = [...roll.marks.values()].filter(v => v === 'yes').length, no = [...roll.marks.values()].filter(v => v === 'no').length; pill.innerHTML = `${ic('vote')}за ${y} · против ${no}`; }
  else pill.innerHTML = `${ic(vote ? 'vote' : 'check')}${vote ? 'проголосовали' : 'отметились'} <b>${n}</b> из ${all.length}`;
  pill.classList.toggle('done', !!roll.done);
}
async function finishRoll() {
  if (!roll || roll.done || !V.room) return;
  roll.done = true; roll.hideAt = Date.now() + 8000; if (roll.toast) closeToast(roll.toast);
  const all = Object.keys(voiceIn(V.room)); if (!all.includes(myId())) all.push(myId());
  const miss = all.filter(p => !roll.marks.has(p)), vote = roll.kind === 'vote';
  let text;
  if (vote) {
    const y = all.filter(p => roll.marks.get(p) === 'yes'), no = all.filter(p => roll.marks.get(p) === 'no');
    text = `голосование${roll.q ? ' «' + roll.q + '»' : ''}: за ${y.length}, против ${no.length}` + (miss.length ? ` · не ответили: ${miss.map(nickOf).join(', ')}` : '');
    toast({ icon: 'vote', title: y.length > no.length ? 'Решено: «за»' : no.length > y.length ? 'Решено: «против»' : 'Ничья', sub: text, dur: 7000 });
  } else {
    text = `перекличка — тут ${all.length - miss.length} из ${all.length}` + (miss.length ? ' · молчат: ' + miss.map(nickOf).join(', ') : ' · все на месте');
    toast({ icon: 'users', title: miss.length ? `отметились ${all.length - miss.length} из ${all.length}` : 'Все на месте!', sub: miss.length ? 'молчат: ' + miss.map(nickOf).join(', ') : 'перекличка закончилась', dur: 5000 });
  }
  sfx(miss.length ? 'tick' : 'allhere');
  tiles.forEach((el, p) => paintMark(el, p)); paintRoll();
  const r0 = roll; setTimeout(() => { if (roll === r0) { roll = null; tiles.forEach((el, p) => paintMark(el, p)); paintRoll(); } }, 8000);
  // итог в чат пишет только тот, кто начал — без дублей
  if (r0.by === myId()) { try { const m = await api('send', { room: V.room, kind: 'sys', text: 'rollres:' + text }); (await import('./state.js')).pushLocal(m); } catch (_) {} }
}
bus.on('ev:roll', v => {
  if (v.room !== V.room || v.from === myId()) return;
  const d = v.data || {};
  beginRoll({ id: d.id || v.from + ':' + Date.now(), by: v.from, kind: d.kind, q: d.q, sec: clamp(+d.sec || 10, 5, 30) });
  if (roll.kind === 'roll') markRoll(v.from, 'here');
  rollToast(); sfx('roll');
});
bus.on('ev:here', v => { if (!roll || v.room !== V.room) return; const d = v.data || {}; if (d.id && d.id !== roll.id) return; markRoll(v.from, d.v || 'here'); });
bus.on('vleft', () => { if (roll) { clearTimeout(roll.tm); if (roll.toast) closeToast(roll.toast); } roll = null; brbs.clear(); });
pop.addEventListener('click', e => { const b = e.target.closest('.key[data-k]'); if (b) fireKey(b.dataset.k); });

/* ---------- рация (держишь — говоришь); сами клавиши — в keys.js ---------- */
export const pttCode = () => (prefs.keys && prefs.keys.ptt) || prefs.pttKey || 'KeyV';
/** V.gkeys — клавишу ловит оболочка даже в игре, тогда окно её не трогает */
export function setPtt(on) { if (V.ptt === on) return; V.ptt = on; applyMic(); }
addEventListener('blur', () => { if (V.ptt && !V.gkeys) setPtt(false); });
window.addEventListener('beforeunload', () => { if (V.room) { try { api('voice_leave'); } catch (_) {} } });
