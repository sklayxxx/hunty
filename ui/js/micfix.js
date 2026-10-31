// Мастер «Меня плохо слышат»: выбрать мик → 3 сек тишины (что вокруг) → 4 сек голоса → итог, всё чинится в один клик.
// Слушаем ту же цепочку, что слышат друзья (audio.js), плюс «сырой» мик — чтобы отличить тихий мик от злого порога.
import { $, $$, esc, ic, prefs, setPref, clamp, sleep } from './core.js';
import { getMic, micChain, levelDb, nsWork } from './audio.js';
import { actx, tmsg, closeW, OPEN, CLOSE, winOpen } from './ui.js';

const w = $('.win[data-win="micfix"]'), body = $('.js-mfbody', w), foot = $('.js-mffoot', w), steps = $('.js-mfsteps', w);
const ORDER = ['mic', 'quiet', 'voice', 'done'];
let run = 0, M = null, raf = 0, devs = [], pick = '', R = {}, recUrl = '', au = null;
const alive = my => my === run && winOpen() === 'micfix';
const pct = (a, p) => { if (!a.length) return -100; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const dbPos = db => clamp((db + 80) / 70 * 100, 0, 100);
const r5 = v => Math.round(v / 5) * 5;

function setStep(k) {
  const i = ORDER.indexOf(k);
  $$('li', steps).forEach(li => { const j = ORDER.indexOf(li.dataset.s); li.classList.toggle('on', j === i); li.classList.toggle('done', j < i); });
  body.dataset.step = k;
}
function stopMic() {
  cancelAnimationFrame(raf); raf = 0;
  if (!M) return; const m = M; M = null;
  try { m.src.disconnect(); } catch (_) {}
  m.ch.stop();
}
function stopAll() { run++; stopMic(); if (au) { try { au.pause(); } catch (_) {} au = null; } if (recUrl) { URL.revokeObjectURL(recUrl); recUrl = ''; } }
/** открыть мик (deviceId: '' — системный) и собрать цепочку */
async function openMic(dev, my) {
  stopMic();
  const a = actx(); if (!a) throw new Error('кликни по окну — звук ещё не включён');
  const s = await getMic(dev);
  if (!alive(my)) { s.getTracks().forEach(t => t.stop()); return null; }
  const m = { gate: null, dev };
  const ch = await micChain(a, s, { onGate: g => { m.gate = g; } });
  if (!alive(my)) { ch.stop(); return null; }
  const src = a.createMediaStreamSource(s), an = a.createAnalyser(); an.fftSize = 2048; src.connect(an);
  Object.assign(m, { s, ch, src, an, braw: new Float32Array(2048), bout: new Float32Array(ch.an.fftSize), lv: -100 });
  M = m; return m;
}
function sample(m) {
  const raw = levelDb(m.an, m.braw), out = levelDb(m.ch.an, m.bout);
  let pk = 0; for (let i = 0; i < m.bout.length; i++) { const x = Math.abs(m.bout[i]); if (x > pk) pk = x; }
  return { raw, out, pk, open: m.gate ? !!m.gate[0] : true, thr: m.gate ? m.gate[1] : null };
}
function meterLoop(el, onLv) {
  const tick = () => {
    if (!M) return; raf = requestAnimationFrame(tick);
    const x = sample(M); M.lv = x.raw > M.lv ? x.raw : M.lv + (x.raw - M.lv) * .2;
    if (el) el.style.setProperty('--lv', dbPos(M.lv).toFixed(1) + '%');
    if (onLv) onLv(x);
  };
  tick();
}

/* ---------- шаг 1: какой мик ---------- */
async function stepMic(dev) {
  const my = ++run; setStep('mic');
  try { devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications'); } catch (_) { devs = []; }
  if (dev === undefined) dev = prefs.micId || '';
  pick = dev;
  const name = d => (d.deviceId === 'default' ? 'Как в системе' : (d.label || 'Микрофон').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, ''));
  const list = devs.filter(d => d.deviceId !== 'default');
  body.innerHTML = `<h4>Какой мик твой?</h4><p class="mfp">Скажи «раз-два» — у правильного мика полоска прыгает.</p>
    <div class="mfdevs" role="radiogroup" aria-label="Микрофон">
      ${[{ deviceId: '', label: 'Как в системе (Windows)' }, ...list].map(d => `<button type="button" role="radio" class="mfdev${(d.deviceId || '') === pick ? ' on' : ''}" aria-checked="${(d.deviceId || '') === pick}" data-dev="${esc(d.deviceId || '')}"><span class="pkc"></span><b>${esc(d.deviceId ? name(d) : d.label)}</b><i class="mfm"><i></i></i></button>`).join('')}
    </div>
    <p class="mfst js-mfst">слушаю…</p>`;
  foot.innerHTML = `<button class="gbtn js-mfcancel" type="button">Отмена</button><span class="sp"></span><button class="cbtn js-mfnext" type="button">Дальше${ic('arrow-right')}</button>`;
  const st = $('.js-mfst', body);
  let m;
  try { m = await openMic(pick, my); } catch (e) { if (alive(my)) st.textContent = e && e.name === 'NotAllowedError' ? 'нет доступа к мику — разреши его в Windows: Параметры → Конфиденциальность → Микрофон' : 'этот мик не открылся: ' + (e.message || e.name); return; }
  if (!m) return;
  const t0 = Date.now(); let heard = 0;
  meterLoop($(`.mfdev.on .mfm`, body), x => {
    if (x.raw > -48) heard = Date.now();
    const quiet = Date.now() - t0 > 4500 && !heard;
    st.textContent = heard && Date.now() - heard < 2500 ? '✓ слышу тебя' : quiet ? 'ничего не слышно — выбери другой мик или проверь кнопку mute на гарнитуре' : 'слушаю…';
    st.classList.toggle('ok', !!heard && Date.now() - heard < 2500); st.classList.toggle('bad', quiet);
  });
}

/* ---------- шаг 2: тишина — какой шум вокруг ---------- */
async function stepQuiet() {
  const my = ++run; setStep('quiet');
  if (pick !== (prefs.micId || '')) setPref('micId', pick);
  if (!M) { try { await openMic(pick, my); } catch (e) { tmsg('err', e.message || e.name); return stepMic(); } }
  if (!alive(my)) return;
  body.innerHTML = `<div class="mfbig"><span class="mfring" style="--d:3s;--dl:.5s"><b class="js-mfc">3</b></span><h4>Помолчи 3 секунды</h4><p class="mfp">Послушаю, что шумит вокруг: кулер, клава, улица.</p><i class="mfm wide js-mfm"><i></i></i></div>`;
  foot.innerHTML = `<button class="gbtn js-mfcancel" type="button">Отмена</button>`;
  await sleep(500); if (!alive(my) || !M) return;
  const raw = [], out = [], c = $('.js-mfc', body);
  meterLoop($('.js-mfm', body), x => { raw.push(x.raw); out.push(x.out); });
  for (let i = 3; i > 0; i--) { c.textContent = i; await sleep(1000); if (!alive(my) || !M) return; }
  cancelAnimationFrame(raf);
  R.noise = pct(raw, .5); R.noiseOut = pct(out, .5);
  stepVoice();
}

/* ---------- шаг 3: голос ---------- */
async function stepVoice() {
  const my = ++run; setStep('voice');
  if (!M) return stepMic();
  body.innerHTML = `<div class="mfbig"><span class="mfring rec" style="--d:4s;--dl:.7s"><b class="js-mfc">4</b></span><h4>Скажи обычным голосом, как в игре:</h4><blockquote class="mfq">«Раз, два, три — проверка связи. Меня хорошо слышно?»</blockquote><i class="mfm wide js-mfm"><i></i></i></div>`;
  foot.innerHTML = `<button class="gbtn js-mfcancel" type="button">Отмена</button>`;
  await sleep(700); if (!alive(my) || !M) return;
  const fr = [], c = $('.js-mfc', body), chunks = [];
  let rec = null;
  try { rec = new MediaRecorder(M.ch.stream); rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); }; rec.start(250); } catch (_) { rec = null; }
  meterLoop($('.js-mfm', body), x => fr.push(x));
  for (let i = 4; i > 0; i--) { c.textContent = i; await sleep(1000); if (!alive(my) || !M) { if (rec && rec.state !== 'inactive') rec.stop(); return; } }
  cancelAnimationFrame(raf);
  if (rec && rec.state !== 'inactive') { await new Promise(r => { rec.onstop = r; rec.stop(); setTimeout(r, 800); }); }
  if (recUrl) URL.revokeObjectURL(recUrl);
  recUrl = chunks.length ? URL.createObjectURL(new Blob(chunks, { type: (rec && rec.mimeType) || 'audio/webm' })) : '';
  // голос — кадры заметно громче шума вокруг
  const speech = fr.filter(x => x.raw > Math.max(R.noise + 8, -62));
  R.voiced = speech.length / Math.max(1, fr.length);
  R.speech = pct(speech.map(x => x.out), .9); R.speechRaw = pct(speech.map(x => x.raw), .9);
  R.clip = speech.filter(x => x.pk >= .99).length / Math.max(1, speech.length);
  R.cut = speech.length ? speech.filter(x => !x.open).length / speech.length : 0;
  R.thr = (fr.find(x => x.thr != null) || {}).thr ?? null;
  R.ns = await nsWork();
  stopMic();
  stepDone();
}

/* ---------- шаг 4: итог и исправления ---------- */
function verdicts() {
  const v = [], vol = prefs.micVol ?? 100;
  if (R.voiced < .12 || R.speechRaw < -60) {
    v.push({ lvl: 'bad', icon: 'mic-off', t: 'Мик почти не слышно', s: 'проверь кнопку mute на гарнитуре и громкость мика в Windows — или выбери другой мик', act: { label: 'Выбрать другой мик', fn: () => stepMic() } });
  } else if (R.speech < -34) {
    const nv = clamp(r5(vol * Math.pow(10, (-20 - R.speech) / 20)), vol + 10, 200);
    v.push(vol >= 200 ? { lvl: 'warn', icon: 'volume-1', t: 'Тебя тихо слышно', s: 'громкость в Hunty уже максимум — подними мик в Windows: Параметры → Звук → Микрофон, или поднеси его ближе' }
      : { lvl: 'warn', icon: 'volume-1', t: 'Тебя тихо слышно', s: `подниму громкость мика: ${vol}% → ${nv}%`, fix: () => setPref('micVol', nv) });
  } else if (R.clip > .02 || R.speech > -6) {
    const nv = clamp(r5(vol * Math.pow(10, (-14 - R.speech) / 20)), 20, vol - 10);
    v.push({ lvl: 'warn', icon: 'volume-2', t: 'Слишком громко — голос хрипит', s: `убавлю громкость мика: ${vol}% → ${nv}%`, fix: () => setPref('micVol', nv) });
  } else v.push({ lvl: 'ok', icon: 'volume-2', t: 'Громкость в самый раз' });
  if (R.noise > -52) {
    if (R.ns !== 'rnnoise') v.push({ lvl: 'warn', icon: 'waves', t: 'Вокруг шумно', s: 'включу умный шумодав — уберёт кулер, клаву и улицу', fix: () => setPref('nsMode', 'rnnoise') });
    else v.push({ lvl: 'ok', icon: 'waves', t: 'Шум вокруг есть, но шумодав его режет' });
  } else v.push({ lvl: 'ok', icon: 'waves', t: 'Вокруг тихо' });
  if (R.voiced >= .12 && R.cut > .3) {
    v.push(prefs.gate === 'manual' ? { lvl: 'warn', icon: 'scissors', t: 'Порог глотает начало слов', s: 'поставлю чувствительность «авто»', fix: () => setPref('gate', 'auto') }
      : { lvl: 'warn', icon: 'scissors', t: 'Порог глотает начало слов', s: `опущу порог до ${Math.round(clamp(R.noiseOut + 8, -80, -20))} дБ — чуть выше шума`, fix: () => { setPref('gateDb', Math.round(clamp(R.noiseOut + 8, -80, -20))); setPref('gate', 'manual'); } });
  }
  if (!prefs.ec) v.push({ lvl: 'warn', icon: 'ear', t: 'Эхоподавление выключено', s: 'без наушников друзья услышат себя из твоих колонок', fix: () => setPref('ec', true) });
  return v;
}
function stepDone() {
  const my = ++run; setStep('done');
  const v = verdicts(), fixes = v.filter(x => x.fix), bad = v.some(x => x.lvl !== 'ok');
  body.innerHTML = `<div class="mfres ${bad ? 'warn' : 'ok'}"><img class="mfhero" alt="" src="emoji/${bad ? '1f6e0' : '2705'}.webp"><h4>${bad ? 'Нашёл, что поправить' : 'Всё отлично — тебя слышно чётко'}</h4></div>
    <ul class="mflist">${v.map((x, i) => `<li class="${x.lvl}"><span class="mfi">${ic(x.icon)}</span><div><b>${esc(x.t)}</b>${x.s ? `<small>${esc(x.s)}</small>` : ''}</div>${x.fix ? `<button class="gbtn sm js-mffix" data-i="${i}" type="button">Исправить</button>` : x.act ? `<button class="gbtn sm js-mfact" data-i="${i}" type="button">${esc(x.act.label)}</button>` : `<span class="mfok">${ic('check')}</span>`}</li>`).join('')}</ul>
    <p class="mfp dim">Друзья всё равно слышат эхо? Надень наушники — это решает 9 из 10 случаев.</p>`;
  foot.innerHTML = `${recUrl ? `<button class="gbtn js-mfplay" type="button">${ic('play')}Послушать, как тебя слышат</button>` : ''}<button class="gbtn js-mfagain" type="button">${ic('rotate-ccw')}Ещё раз</button><span class="sp"></span>${fixes.length > 1 ? `<button class="cbtn js-mfall" type="button">${ic('wand-sparkles')}Исправить всё</button>` : `<button class="cbtn js-mfok" type="button">Готово</button>`}`;
  body._v = v;
  void my;
}
function applyFix(li, x) {
  x.fix(); x.done = true;
  if (li) { li.className = 'ok'; const b = $('.js-mffix', li); if (b) b.outerHTML = `<span class="mfok">${ic('check')}</span>`; }
}

/* ---------- кнопки ---------- */
w.addEventListener('click', e => {
  const t = e.target;
  const d = t.closest('[data-dev]'); if (d) { stepMic(d.dataset.dev); return; }
  if (t.closest('.js-mfcancel') || t.closest('.js-mfok')) { closeW(); return; }
  if (t.closest('.js-mfnext')) { stepQuiet(); return; }
  if (t.closest('.js-mfagain')) { stepMic(prefs.micId || ''); return; }
  const f = t.closest('.js-mffix'); if (f) { const x = body._v[+f.dataset.i]; applyFix(f.closest('li'), x); tmsg('ok', 'готово · можно пройти ещё раз и проверить'); return; }
  const a = t.closest('.js-mfact'); if (a) { body._v[+a.dataset.i].act.fn(); return; }
  if (t.closest('.js-mfall')) {
    const lis = $$('.mflist li', body);
    body._v.forEach((x, i) => { if (x.fix && !x.done) applyFix(lis[i], x); });
    tmsg('ok', 'всё поправил — пройди ещё раз, чтобы убедиться');
    const b = t.closest('.js-mfall'); b.outerHTML = `<button class="cbtn js-mfok" type="button">Готово</button>`; return;
  }
  const p = t.closest('.js-mfplay');
  if (p && recUrl) {
    if (au) { au.pause(); au = null; p.innerHTML = ic('play') + 'Послушать, как тебя слышат'; return; }
    au = new Audio(recUrl); au.volume = clamp((prefs.outVol ?? 100) / 100, 0, 1);
    if (prefs.outId && au.setSinkId) au.setSinkId(prefs.outId).catch(() => {});
    const done = () => { au = null; p.innerHTML = ic('play') + 'Послушать, как тебя слышат'; };
    au.onended = done; au.onerror = done; au.play().catch(done);
    p.innerHTML = ic('pause') + 'Стоп';
  }
});
OPEN.micfix = () => { R = {}; stepMic(); };
CLOSE.micfix = () => { stopAll(); };
