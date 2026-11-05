// Скриншоты для README и docs/GUIDE.md (не тест): node tests/docs.mjs [фильтр]  → docs/screens/*.jpg
// Четыре узла (anton — «я», vasyan, dimon, lexa) + свежий для экрана регистрации, переписка и группа через API ядра,
// голос и демка — настоящие страницы в Chromium (фейковые мик/экран). Переменные — как у tests/ui.mjs (CHROMIUM, PLAYWRIGHT_FROM, HUNTY_BIN).
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { node, client, sleep, BASE } from './lib.mjs';
const { chromium } = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url)('playwright');
const OUT = fileURLToPath(new URL('../docs/screens/', import.meta.url)); mkdirSync(OUT, { recursive: true });
const UI = fileURLToPath(new URL('../ui', import.meta.url));
const only = process.argv[2] || '';
const W = 1280, H = 860, DPR = +(process.env.DPR || 1.5);
rmSync(BASE, { recursive: true, force: true });
const web = (http, port) => ['--http', String(http), '--ui', UI, '--port', String(port)];
const PEOPLE = [['anton', 'steve'], ['vasyan', 'creeper'], ['dimon', 'fox'], ['lexa', 'axolotl']];
const nodes = PEOPLE.map(([n, ava], i) => node(n, 7491 + i, [...web(8491 + i, 47491 + i), '--ava', ava]));
nodes.push(node('fresh', 7499, web(8499, 47499), false));
process.on('exit', () => nodes.forEach(p => p.kill()));

let GID = '', DM = '';
{
  const C = await Promise.all(PEOPLE.map((_, i) => client(7491 + i, PEOPLE[i][0])));
  const S = await Promise.all(C.map(c => c.cmd('state')));
  const [A, B, D, L] = C, id = i => S[i].me.peer;
  for (let i = 1; i < C.length; i++) {
    await C[i].cmd('friend_add', { code: (await A.cmd('friend_code')).code });
    await A.until(e => e.ev === 'friend' && e.friend.peer === id(i) && e.friend.state === 'incoming');
    await A.cmd('friend_accept', { peer: id(i) });
    await C[i].until(e => e.ev === 'friend' && e.friend.peer === id(0) && e.friend.state === 'friend');
  }
  await A.cmd('profile_set', { line: 'копаю алмазы · пишите в лс' }).catch(() => {});
  await B.cmd('profile_set', { line: 'сервак 24/7, заходите' }).catch(() => {});
  const dm = await A.cmd('dm_open', { peer: id(1) }); await B.cmd('dm_open', { peer: id(0) }); DM = dm.id;
  const say = async (X, t, o = {}) => { const m = await X.cmd('send', { room: o.room || DM, text: t, ...o.x }); await sleep(120); return m; };
  await say(B, 'здарова @anton, как оно? 😄');
  await say(A, 'норм, вечером в майн?');
  await say(A, 'могу сервак поднять');
  const m3 = await say(B, 'го! только у меня мик **хрипит** 😭 надо глянуть');
  await A.cmd('react', { room: DM, id: m3.id, e: '😂' }).catch(() => {});
  await say(A, 'щас поправим: Настройки → Звук → «Меня плохо слышат»', { x: { reply: m3.id } });
  await say(B, 'о, шумодав включил — теперь норм ||а я думал это вентилятор||');
  await B.cmd('send', { room: DM, kind: 'sticker', text: '', data: { k: 'party' } }).catch(() => {});
  await sleep(150);
  await say(A, 'ахах, всё, в 9 жду');
  const g = await A.cmd('room_create', { name: 'кухня', color: '#ffc66b', members: [id(1), id(2), id(3)] });
  GID = g.id; await sleep(800);
  const gm = [];
  const lines = [[D, 'всем привет, я тут новенький 👋'], [B, 'о, дима! заходи вечером'], [D, ':joy'], [L, 'кто сегодня в майн?'], [B, 'я построил портал в ад 🔥 заходите смотреть'], [D, 'там гаст чуть не снёс мне дом'], [L, 'ахах'], [A, 'го в 9, я демку включу — покажу ферму'], [B, 'кто возьмёт кирки?'], [D, 'я с алмазами 💎'], [L, 'жду всех, захожу в голос']];
  for (const [X, t] of lines) {
    if (t[0] === ':') { await X.cmd('send', { room: GID, kind: 'sticker', text: '', data: { k: t.slice(1) } }).catch(() => {}); await sleep(120); continue; }
    gm.push(await say(X, t, { room: GID }));
  }
  await sleep(600);
  for (const [X, e] of [[A, '🏆'], [D, '🏆'], [L, '🔥'], [D, '🔥']]) await X.cmd('react', { room: GID, id: gm[3].id, e }).catch(() => {});
  for (const [X, e] of [[A, '😂'], [L, '😂'], [B, '💀']]) await X.cmd('react', { room: GID, id: gm[4].id, e }).catch(() => {});
  await A.cmd('react', { room: GID, id: gm[8].id, e: '💎' }).catch(() => {});
  const g2 = await A.cmd('room_create', { name: 'майн 1.21', color: '#7ee2b8', members: [id(1), id(2)] }).catch(() => null);
  if (g2) { await sleep(500); await say(B, 'сид для нового мира: 8675309', { room: g2.id }); }
  await sleep(500); C.forEach(c => c.close());
}

const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
// «экран» для демки: пиксельный пейзаж в духе майна (своя картинка, без чужих текстур)
const fakeScreen = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); const B = 40;
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const noise = []; for (let i = 0; i < 32 * 18; i++) noise.push(rnd());
    const hill = i => 9 + Math.round(Math.sin(i / 4) * 1.5 + Math.sin(i / 9 + 1) * 1.2);
    let t = 0;
    setInterval(() => {
      t++;
      const sky = x.createLinearGradient(0, 0, 0, 420); sky.addColorStop(0, '#6fb7ff'); sky.addColorStop(1, '#bfe3ff'); x.fillStyle = sky; x.fillRect(0, 0, 1280, 720);
      x.fillStyle = '#fff6a8'; x.fillRect(1040, 70, 80, 80);
      x.fillStyle = 'rgba(255,255,255,.92)';
      for (const [cx, cy, w] of [[120, 90, 200], [520, 60, 160], [860, 130, 240]]) { const px = (cx + t * .6) % 1480 - 200; x.fillRect(px, cy, w, 40); x.fillRect(px + 40, cy - 20, w - 80, 20); }
      for (let i = 0; i < 32; i++) {
        const top = hill(i);
        for (let j = top; j < 18; j++) {
          const n = noise[j * 32 + i];
          x.fillStyle = j === top ? (n > .5 ? '#5dbb4a' : '#55ad43') : j < top + 3 ? (n > .5 ? '#8a5a35' : '#7c4f2e') : (n > .7 ? '#8d8d8d' : n > .2 ? '#7a7a7a' : '#5c5c5c');
          x.fillRect(i * B, j * B, B, B);
          if (j > top + 4 && n > .93) { x.fillStyle = '#62e6e9'; x.fillRect(i * B + 12, j * B + 12, 14, 14); }
        }
      }
      for (const i of [4, 13, 23]) { const top = hill(i); x.fillStyle = '#6b4a2b'; x.fillRect(i * B, (top - 3) * B, B, 3 * B); x.fillStyle = '#2f8f3a'; x.fillRect((i - 1) * B, (top - 6) * B, 3 * B, 3 * B); x.fillRect(i * B, (top - 7) * B, B, B); }
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(460, 650, 360, 44);
      for (let k = 0; k < 9; k++) { x.strokeStyle = k === 2 ? '#fff' : '#9a9a9a'; x.lineWidth = 3; x.strokeRect(464 + k * 40, 654, 36, 36); }
      x.fillStyle = '#62e6e9'; x.fillRect(475 + 80, 665, 14, 14); x.fillStyle = '#8a5a35'; x.fillRect(475, 665, 14, 14); x.fillStyle = '#5dbb4a'; x.fillRect(475 + 40, 665, 14, 14);
      for (let k = 0; k < 10; k++) { x.fillStyle = '#e8413c'; x.fillRect(462 + k * 18, 626, 14, 12); }
      x.fillStyle = '#fff'; x.fillRect(636, 352, 8, 24); x.fillRect(628, 360, 24, 8);
    }, 33);
    return c.captureStream(30);
  };
};
async function page(name, http, ws, prefs = {}) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  await ctx.addInitScript(p => { try { const o = JSON.parse(localStorage.getItem('hunty-prefs') || '{}'); localStorage.setItem('hunty-prefs', JSON.stringify({ ...o, boot: false, ...p })); } catch (_) {} }, prefs);
  await ctx.addInitScript(fakeScreen);
  const P = await ctx.newPage(); P.setDefaultTimeout(10000);
  P.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(name + ': ' + m.text()); });
  P.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
  await P.goto(`http://127.0.0.1:${http}/?ws=${ws}&noboot`); await sleep(1500);
  return P;
}
// «Беречь уши» на фейковом мике (пищит каждую секунду) приглушает людей и показывает всплывашку — для картинок выключено
const P = await page('anton', 8491, 7491, { earGuard: false });
const openChat = async (X, name) => { await X.locator('.js-chats .ci').filter({ has: X.locator('.nm', { hasText: new RegExp('^' + name + '$') }) }).first().click(); await sleep(500); };
const esc = async () => { for (let i = 0; i < 2; i++) { await P.keyboard.press('Escape').catch(() => {}); await sleep(120); } };
const shot = async (n, f, X = P) => {
  if (only && !only.split(',').some(o => n.includes(o))) return;
  try { if (await f() !== 'hover') await X.mouse.move(W - 4, H / 2); await sleep(600); await X.screenshot({ path: OUT + n + '.jpg', type: 'jpeg', quality: 80, timeout: 30000 }); console.log('✓', n); }
  catch (e) { console.log('✗', n, e.message.split('\n').slice(0, 3).join(' | ')); }
};
const settings = async tab => { await P.click('button.ib[data-win="settings"]'); await P.waitForSelector('.win[data-win="settings"].on'); await P.click(`.js-snav [data-tab="${tab}"]`); await sleep(400); };

// 1. первый запуск
if (!only || '01-registration'.includes(only)) {
  const F = await page('fresh', 8499, 7499);
  await F.waitForSelector('.win[data-win="onboard"].on', { state: 'visible', timeout: 15000 });
  await F.waitForFunction(() => !document.querySelector('.win[data-win="onboard"]').getAnimations().length);
  await F.mouse.move(W - 4, H / 2); await sleep(300);
  await F.screenshot({ path: OUT + '01-registration.jpg', type: 'jpeg', quality: 80 }); console.log('✓ 01-registration');
  await F.context().close();
}
// 2. переписка
await shot('07-chat', () => openChat(P, 'vasyan'));
await shot('08-group', async () => { await openChat(P, 'кухня'); });
// 3. голос + демка: vasyan и dimon — настоящие страницы
const PB = await page('vasyan', 8492, 7492, { earGuard: false }), PD = await page('dimon', 8493, 7493, { earGuard: false });
await P.evaluate(() => { localStorage.setItem('hunty-lay', JSON.stringify({ shv: 470 })); }); await P.reload(); await sleep(1500);
await openChat(P, 'кухня'); await openChat(PB, 'кухня'); await openChat(PD, 'кухня');
await P.click('.js-hbtns [data-act="voice"]'); await sleep(1200); await PB.click('.js-hbtns [data-act="voice"]'); await sleep(800); await PD.click('.js-hbtns [data-act="voice"]'); await sleep(3500);
await shot('09-voice', async () => {});
await PD.click('.js-share'); await sleep(600); await PD.click('.js-sstart');
{ // ждём, пока у anton пойдут кадры (на слабой машине кодировщик стартует не сразу), и ещё чуть-чуть — чтобы в шапке были 720p и fps
  const t0 = Date.now();
  await P.waitForFunction(() => { const v = document.querySelector('.js-dvid'); return v && v.videoWidth > 0 && v.currentTime > 0.5; }, null, { timeout: 20000 }).catch(() => console.log('! у anton демка без кадров 20 с'));
  console.log('  демка пошла через', Date.now() - t0, 'мс'); await sleep(2000);
}
await shot('00-hero', async () => {});
await shot('02-demo-draw', async () => {
  await P.click('.tl[data-tool="pen"]'); await sleep(200);
  const box = await P.locator('.js-ink').boundingBox();
  await P.mouse.move(box.x + box.width * .42, box.y + box.height * .62); await P.mouse.down();
  for (let i = 0; i <= 24; i++) await P.mouse.move(box.x + box.width * (.42 + i * .012), box.y + box.height * (.62 - Math.sin(i / 7.6) * .16), { steps: 2 });
  await P.mouse.up(); await sleep(200);
  await P.click('.tl[data-tool="ptr"]'); await P.mouse.click(box.x + box.width * .74, box.y + box.height * .4); await sleep(300);
  await P.click('.tl[data-tool="pen"]'); await sleep(200);
  return 'hover';
});
await shot('10-volume', async () => {
  await P.locator('.vtile[data-u]:not(.me)').filter({ hasText: 'vasyan' }).first().click({ button: 'right' }); await sleep(500);
  return 'hover';
});
await esc();
await shot('04-mini-call', async () => { await openChat(P, 'vasyan'); await sleep(1200); });
await shot('03-dm-call', async () => {
  await PD.click('.js-leave').catch(() => {}); await PB.click('.js-leave').catch(() => {}); await P.click('.js-leave').catch(() => {}); await sleep(1000);
  await openChat(P, 'vasyan'); await openChat(PB, 'anton'); await P.click('.js-hbtns [data-act="call"]'); await sleep(1500);
  const ans = PB.locator('.js-toasts button', { hasText: 'Ответить' }).first(); await ans.click({ timeout: 8000 }); await sleep(3000);
});
await P.click('.js-leave').catch(() => {}); await sleep(800);
await PB.context().close(); await PD.context().close();
// дальше — без чужих всплывашек и с настройками по умолчанию («Беречь уши» выключал только на время голоса)
await P.evaluate(async () => { const { setPref } = await import('/js/core.js'); setPref('earGuard', true); document.querySelectorAll('.js-toasts > *').forEach(t => t.remove()); });
await sleep(300);
// 4. друзья, инвайт, стикеры, зал славы
await shot('11-friends', async () => { await P.locator('button.ib[data-win="friend"]').first().click(); await sleep(800); await P.evaluate(() => { document.querySelectorAll('.js-toasts > *').forEach(t => t.remove()); document.querySelectorAll('.snack.on').forEach(s => s.classList.remove('on')); }); await sleep(400); });
await esc();
await shot('05-invite', async () => { await openChat(P, 'кухня'); await P.locator('.js-hbtns button').last().click(); await sleep(300); await P.click('.js-gtabs button[data-g="invite"]'); await sleep(900); });
await esc();
await shot('12-stickers', async () => { await openChat(P, 'vasyan'); await P.click('.js-stkb'); await sleep(500); });
await esc();
await shot('18-group-create', async () => {
  await P.locator('[data-win="group"]:visible').first().click(); await sleep(400);
  await P.fill('.js-gname', 'катка в пятницу'); await P.locator('.js-gcol button').nth(1).click();
  await P.locator('.js-gpick [role="option"], .js-gpick button, .js-gpick .pk').nth(0).click().catch(() => {}); await P.locator('.js-gpick [role="option"], .js-gpick button, .js-gpick .pk').nth(1).click().catch(() => {});
  await sleep(400);
});
await esc();
await shot('20-msg-menu', async () => {
  await openChat(P, 'vasyan');
  await P.locator('.log:not([hidden]) .m[data-id]').filter({ hasText: 'хрипит' }).first().click({ button: 'right' }); await sleep(500);
  return 'hover';
});
await esc();
await shot('13-hall', async () => { await P.click('.js-hallb'); await sleep(900); });
await esc();
await shot('14-profile', async () => { await openChat(P, 'vasyan'); await P.locator('.log:not([hidden]) .mav[data-u]:not([data-me])').first().click(); await sleep(600); });
await esc();
// 5. настройки
await shot('06-settings', () => settings('look'));
await esc();
await shot('15-settings-audio', () => settings('audio'));
await esc();
await shot('16-settings-net', () => settings('net'));
await esc();
await shot('19-settings-acc', async () => { await settings('acc'); await P.locator('.js-bexport').evaluate(e => e.closest('.row').scrollIntoView({ block: 'end' })); await sleep(300); });
await esc();
await shot('17-wallpaper', async () => { await settings('look'); await P.click('.js-walls [data-w="aurora"]'); await sleep(300); await esc(); await openChat(P, 'кухня'); await sleep(600); });
console.log(errs.join('\n') || 'без ошибок');
await b.close(); process.exit(0);
