// UI e2e на трёх узлах через Playwright: регистрация, голос/вебка/демка/рисование/мини-окно, звонок в личке, окна.
// Подготовка: cargo build -p hunty-node && npm i -D playwright && npx playwright install chromium
// Запуск:     node tests/ui.mjs [onboard] [voice] [dm] [win] [slow] [ff]   (без аргументов — всё; slow — со стеклом и бут-анимацией;
//             ff — vasyan в Firefox: npx playwright install firefox)
// Переменные: CHROMIUM=путь к браузеру, PLAYWRIGHT_FROM=папка с node_modules, где лежит playwright. Скриншоты — tests/shots/.
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { node, client, sleep, BASE } from './lib.mjs';
const { chromium, firefox } = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url)('playwright');
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url)); mkdirSync(SHOTS, { recursive: true });
const UI = fileURLToPath(new URL('../ui', import.meta.url));
const ARGS = process.argv.slice(2).filter(a => a !== 'slow' && a !== 'ff'), FAST = !process.argv.includes('slow');
const FF = process.argv.includes('ff'); // ff — второй участник (vasyan) в Firefox: проверка Chromium ⇄ Firefox
const only = s => !ARGS.length || ARGS.includes(s);
let failed = false;
rmSync(BASE, { recursive: true, force: true });
const web = (http, port) => ['--http', String(http), '--ui', UI, '--port', String(port)];
const nodes = [node('anton', 7461, web(8461, 47461)), node('vasyan', 7462, web(8462, 47462)), node('fresh', 7463, web(8463, 47463), false)];
process.on('exit', () => nodes.forEach(p => p.kill()));
{ // дружба, личка, группа «кухня»
  const [A, B] = await Promise.all([client(7461, 'A'), client(7462, 'B')]);
  const sa = await A.cmd('state'), sb = await B.cmd('state');
  await B.cmd('friend_add', { code: (await A.cmd('friend_code')).code });
  await A.until(e => e.ev === 'friend' && e.friend.peer === sb.me.peer && e.friend.state === 'incoming');
  await A.cmd('friend_accept', { peer: sb.me.peer });
  await B.until(e => e.ev === 'friend' && e.friend.peer === sa.me.peer && e.friend.state === 'friend');
  const dm = await A.cmd('dm_open', { peer: sb.me.peer }); await B.cmd('dm_open', { peer: sa.me.peer });
  for (const t of ['здарова, бро', 'го вечером в майн?']) await A.cmd('send', { room: dm.id, text: t });
  await A.cmd('room_create', { name: 'кухня', color: '#ffc66b', members: [sb.me.peer] });
  const rB = await B.until(e => e.ev === 'room' && e.room.kind === 'group' && e.room.name === 'кухня');
  await B.cmd('send', { room: rB.room.id, text: 'кто на созвон?' });
  await sleep(500); A.close(); B.close();
  console.log('узлы готовы: anton ⇄ vasyan, личка + группа «кухня»');
}
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const bf = FF ? await firefox.launch({ firefoxUserPrefs: {
  'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true, 'media.autoplay.default': 0,
  // в контейнерах/CI бывает только link-local сеть (169.254.x.x), которую Firefox по умолчанию не берёт в ICE
  'media.peerconnection.ice.link_local': true,
} }) : null;
const errs = { A: [], B: [], C: [] };
async function page(name, url) {
  const ctx = await (bf && name === 'B' ? bf : b).newContext({ viewport: { width: 1440, height: 900 } });
  if (FAST) await ctx.addInitScript(() => { try { localStorage.setItem('hunty-prefs', JSON.stringify({ glass: 'matte', boot: false })); } catch (_) {} });
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); let t = 0;
      setInterval(() => { t++; x.fillStyle = '#0b0f17'; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#7ee2b8'; x.font = '30px monospace';
        ['fn main() {', '    let swarm = hunty::start();', '    // демка идёт напрямую P2P', '    loop { swarm.poll(); }', '}'].forEach((l, i) => x.fillText(l, 60, 110 + i * 48));
        x.fillStyle = '#ff94b8'; x.fillRect(60 + (t * 6) % 1100, 430, 120, 120); }, 33);
      return c.captureStream(30);
    };
  });
  const p = await ctx.newPage(); p.setDefaultTimeout(20000);
  p.on('console', m => { if (m.type() === 'error') errs[name].push(m.text()); });
  p.on('response', r => { if (r.status() >= 400) errs[name].push('HTTP ' + r.status() + ' ' + r.url()); });
  p.on('pageerror', e => errs[name].push('pageerror: ' + e.message));
  await p.goto(url); return p;
}
const shot = (p, n) => p.screenshot({ path: SHOTS + n + '.png', timeout: 30000 }).catch(e => console.log('shot fail', n));
const A = await page('A', 'http://127.0.0.1:8461/?ws=7461&noboot');
const B = await page('B', 'http://127.0.0.1:8462/?ws=7462&noboot');
await sleep(1800);
const step = s => console.log('·', s);
const openChat = async (P, name) => { await P.click('.stab[data-tab="chats"]'); await P.locator('.js-chats .ci').filter({ has: P.locator('.nm', { hasText: new RegExp('^' + name + '$') }) }).first().click(); await sleep(500); };
const vis = (P, sel) => P.locator(sel).first().isVisible();
// звук за ~3 с: свой мик (после гейна) и что слышно от каждого пира — пик RMS по анализаторам (опрос каждые 15 мс:
// фейковый мик Chromium пищит коротко раз в секунду) + энергия из WebRTC-статистики — проверка, что звук реально идёт
const levels = P => P.evaluate(async () => {
  const { V } = await import('/js/voice.js'); const { actx } = await import('/js/ui.js');
  const buf = new Uint8Array(512), rms = an => { if (!an) return 0; an.getByteTimeDomainData(buf); let q = 0; for (const b of buf) q += ((b - 128) / 128) ** 2; return Math.sqrt(q / buf.length); };
  let me = 0; const peers = {}, energy = {};
  for (let i = 0; i < 200; i++) { me = Math.max(me, rms(V.an)); for (const p of V.peers.values()) peers[p.peer.slice(-6)] = Math.max(peers[p.peer.slice(-6)] || 0, rms(p.an)); await new Promise(r => setTimeout(r, 15)); }
  for (const p of V.peers.values()) { try { (await p.pc.getStats()).forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio' && x.totalAudioEnergy != null) energy[p.peer.slice(-6)] = (energy[p.peer.slice(-6)] || 0) + x.totalAudioEnergy; }); } catch (_) {} }
  const r4 = x => Math.round(x * 1e4) / 1e4;
  return { ctx: actx() ? actx().state : null, me: r4(me), peers: Object.fromEntries(Object.entries(peers).map(([k, v]) => [k, r4(v)])), energy: Object.fromEntries(Object.entries(energy).map(([k, v]) => [k, r4(v)])) };
});
const hears = l => Math.max(0, ...Object.values(l.peers)) > 0.005 || Math.max(0, ...Object.values(l.energy)) > 0;
const dump = P => P.evaluate(async () => { const { V } = await import('/js/voice.js'); return [...V.peers.values()].map(P => ({ peer: P.peer.slice(-6), polite: P.polite, sig: P.pc.signalingState, ice: P.pc.iceConnectionState, q: P.q, rexp: P.rexp, buf: [...P.rbuf.keys()] })); });
try {
if (only('onboard')) {
  step('onboard (первый запуск)');
  const C = await page('C', 'http://127.0.0.1:8463/?ws=7463');
  await C.waitForSelector('.win[data-win="onboard"].on', { state: 'visible', timeout: 15000 });
  // ждём, пока доиграет анимация появления (в headless без GPU первые кадры рисуются медленно)
  await C.waitForFunction(() => !document.querySelector('.win[data-win="onboard"]').getAnimations().length && getComputedStyle(document.querySelector('.js-wback')).opacity === '1');
  await shot(C, 'a1-onboard');
  await C.fill('.js-onick', 'дима'); await sleep(100);
  if (!(await C.isDisabled('.js-ogo'))) throw new Error('кириллица в нике должна блокировать кнопку');
  await C.click('.js-oroll'); await sleep(1500);
  await C.fill('.js-onick', 'Dimon'); await sleep(200);
  console.log('ник:', await C.inputValue('.js-onick'), '·', await C.textContent('.js-ncheck'), '· моб:', await C.textContent('.js-omob'));
  await C.click('.js-ogo'); await sleep(1500); await shot(C, 'a2-after-onboard');
  await C.reload(); await sleep(2500);
  if (await C.isVisible('.win[data-win="onboard"]')) throw new Error('после регистрации окно не должно открываться снова');
  console.log('регистрация сохранилась после перезагрузки ✓');
}
if (only('voice')) {
  step('group voice');
  await openChat(A, 'кухня'); await openChat(B, 'кухня');
  await A.click('.js-vjoin'); await sleep(1500);
  console.log('B vjoin visible', await vis(B, '.js-vjoin'));
  await B.click('.js-vjoin'); await sleep(4500);
  await shot(A, 'd1-voice-A'); await shot(B, 'd1-voice-B');
  console.log('pcs', JSON.stringify(await dump(A)), JSON.stringify(await dump(B)));
  console.log('rows A', await A.evaluate(() => [...document.querySelectorAll('.vtile')].map(r => r.className + ' ' + r.textContent.trim().slice(0, 40))));
  const la = await levels(A), lb = await levels(B);
  console.log('audio A', JSON.stringify(la), '· B', JSON.stringify(lb));
  // B должен быть слышен у A; обратно меряем, только если у B живой AudioContext (в Firefox без звуковой карты он спит)
  if (!hears(la)) throw new Error('A не слышит B: от B идёт тишина');
  if (!hears(lb) && lb.ctx === 'running') throw new Error('B не слышит A: от A идёт тишина');
  step('cam');
  await A.click('.js-cam'); await sleep(3500);
  await shot(B, 'd2-cam-B'); await shot(A, 'd2-cam-A');
  console.log('B cam tiles', await B.evaluate(() => [...document.querySelectorAll('.vtile .tv, .vtile video, .dvid video')].map(v => v.videoWidth + 'x' + v.videoHeight + ' ' + (v.srcObject ? 'src' : '-'))));
  step('share');
  await B.click('.js-share'); await sleep(500); await shot(B, 'd3-share-win');
  await B.click('.js-sstart'); await sleep(4500);
  await shot(A, 'd4-share-A'); await shot(B, 'd4-share-B');
  console.log('A demo video', await A.evaluate(() => { const v = document.querySelector('.js-dvid, .js-dv, .demo video'); return v ? v.videoWidth + 'x' + v.videoHeight : 'none'; }));
  step('draw');
  await A.click('.tl[data-tool="pen"]'); await sleep(200);
  const box = await A.locator('.js-ink').boundingBox();
  await A.mouse.move(box.x + box.width * .3, box.y + box.height * .45); await A.mouse.down();
  for (let i = 0; i <= 20; i++) await A.mouse.move(box.x + box.width * (.3 + i * .015), box.y + box.height * (.45 + Math.sin(i / 3) * .06), { steps: 2 });
  await A.mouse.up(); await sleep(200);
  await A.click('.tl[data-tool="ptr"]'); await A.mouse.click(box.x + box.width * .6, box.y + box.height * .3); await sleep(200);
  await A.click('.rbtn >> nth=0'); await A.click('.rbtn >> nth=1');
  await sleep(800);
  await shot(A, 'd5-draw-A'); await shot(B, 'd5-draw-B');
  step('mini');
  await openChat(A, 'vasyan'); await sleep(1200);
  await shot(A, 'd6-mini-A');
  console.log('A mini', await A.evaluate(() => ({ mini: !document.querySelector('.js-mini').hidden, title: document.title })));
  await A.click('.js-mexp').catch(e => console.log('mexp', e.message)); await sleep(600);
  await shot(A, 'd7-expanded-A');
  await B.click('.js-leave'); await A.click('.js-leave'); await sleep(1200);
  await shot(A, 'd8-left-A');
}
if (only('dm')) {
  step('dm call');
  await openChat(A, 'vasyan'); await openChat(B, 'anton');
  await A.click('.js-hbtns [data-act="call"]'); await sleep(1500);
  await shot(B, 'e1-ring-B'); await shot(A, 'e1-ring-A');
  await B.locator('.toast button', { hasText: 'Ответить' }).first().click().catch(e => console.log('answer', e.message));
  await sleep(4000);
  await shot(A, 'e2-dmcall-A'); await shot(B, 'e2-dmcall-B');
  await B.click('.js-share').catch(e => console.log('share', e.message)); await sleep(400);
  await B.click('.js-sstart').catch(e => console.log('sstart', e.message)); await sleep(4000);
  await shot(A, 'e3-dmshare-A'); await shot(B, 'e3-dmshare-B');
  await A.click('[data-act="hang"]').catch(() => A.click('.js-leave')); await sleep(1500);
  await shot(A, 'e4-hang-A'); await shot(B, 'e4-hang-B');
}
if (only('win')) {
  step('settings');
  await A.keyboard.press('Escape');
  await A.click('.ib[data-win="settings"]'); await sleep(500);
  for (const t of ['acc', 'audio', 'video', 'share', 'look', 'notif', 'keys', 'priv', 'net', 'about']) {
    await A.click(`.js-snav [data-tab="${t}"]`); await sleep(t === 'net' ? 1500 : t === 'audio' || t === 'video' ? 1200 : 300); await shot(A, 'f-set-' + t);
  }
  await A.keyboard.press('Escape'); await sleep(400);
  console.log('wback open after esc', await A.evaluate(() => document.querySelector('.wback, .js-wback') && document.querySelector('.wback, .js-wback').className));
  step('gset');
  await openChat(A, 'кухня');
  await A.click('[data-act="gset"]'); await sleep(500); await shot(A, 'g1-gset-members');
  await A.click('.js-gtabs [data-g="main"]'); await sleep(300); await shot(A, 'g2-gset-main');
  await A.click('.js-gtabs [data-g="invite"]'); await sleep(500); await shot(A, 'g3-gset-invite');
  await A.keyboard.press('Escape'); await sleep(300);
  step('profile');
  await A.click('.stab[data-tab="friends"]'); await sleep(300);
  await A.locator('.js-friends [data-prof]').first().click(); await sleep(500); await shot(A, 'h1-profile');
  await A.keyboard.press('Escape'); await sleep(300);
  step('friend win');
  await A.click('.pbtn[data-win="friend"]'); await sleep(500); await shot(A, 'h2-friend');
  await A.keyboard.press('Escape'); await sleep(300);
  await A.click('.ws.plus'); await sleep(400); await shot(A, 'h3-group'); await A.keyboard.press('Escape'); await sleep(300);
  await shot(A, 'h4-after');
}
} catch (e) { failed = true; console.log('FAIL', e.message.split('\n').slice(0, 12).join('\n')); await shot(A, 'zz-fail-A'); await shot(B, 'zz-fail-B'); }
console.log('A errs', errs.A.join(' | ')); console.log('B errs', errs.B.join(' | '));
await b.close(); if (bf) await bf.close(); nodes.forEach(p => p.kill());
const bad = failed || errs.A.length || errs.B.length || errs.C.length;
console.log(bad ? '✗ есть ошибки' : '✓ UI e2e ОК', '· скриншоты:', SHOTS);
process.exit(bad ? 1 : 0);
