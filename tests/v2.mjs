// UI e2e фич v0.2: свои меню, ответы, реакции, правка/удаление, разметка, блок, хранилище, журнал, проверка мика.
// Запуск: cargo build -p hunty-node && node tests/v2.mjs   (переменные — как у tests/ui.mjs). Скриншоты — tests/shots/v2-*.png
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { node, client, sleep, BASE } from './lib.mjs';
const { chromium } = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url)('playwright');
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url)); mkdirSync(SHOTS, { recursive: true });
const UI = fileURLToPath(new URL('../ui', import.meta.url));
rmSync(BASE, { recursive: true, force: true });
const web = (http, port) => ['--http', String(http), '--ui', UI, '--port', String(port)];
const nodes = [node('anton', 7471, web(8471, 47471)), node('vasyan', 7472, web(8472, 47472))];
process.on('exit', () => nodes.forEach(p => p.kill()));
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('✓', m); };
let dmId = '';
{
  const [A, B] = await Promise.all([client(7471, 'A'), client(7472, 'B')]);
  const sb = await B.cmd('state'), sa = await A.cmd('state');
  await B.cmd('friend_add', { code: (await A.cmd('friend_code')).code });
  await A.until(e => e.ev === 'friend' && e.friend.state === 'incoming');
  await A.cmd('friend_accept', { peer: sb.me.peer });
  await B.until(e => e.ev === 'friend' && e.friend.peer === sa.me.peer && e.friend.state === 'friend');
  const dm = await A.cmd('dm_open', { peer: sb.me.peer }); await B.cmd('dm_open', { peer: sa.me.peer }); dmId = dm.id;
  await B.cmd('send', { room: dm.id, text: 'смотри, теперь есть **жирный**, *курсив*, __подчёркнутый__, ~~зачёркнутый~~, `код` и ||спойлер||' });
  await B.cmd('send', { room: dm.id, text: '> цитата\n> в две строки\nи ответ под ней' });
  await B.cmd('send', { room: dm.id, text: '```rust\nfn main() {\n    println!("hunty");\n}\n```' });
  await B.cmd('send', { room: dm.id, text: '🔥' });
  await sleep(400); A.close(); B.close();
}
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const errs = { A: [], B: [] };
async function page(name, url) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
  await ctx.addInitScript(() => { try { localStorage.setItem('hunty-prefs', JSON.stringify({ glass: 'matte', boot: false })); } catch (_) {} });
  const p = await ctx.newPage(); p.setDefaultTimeout(15000);
  p.on('console', m => { if (m.type() === 'error') errs[name].push(m.text()); });
  p.on('pageerror', e => errs[name].push('pageerror: ' + e.message));
  await p.goto(url); return p;
}
const shot = (p, n) => p.screenshot({ path: SHOTS + 'v2-' + n + '.png' }).catch(() => console.log('shot fail', n));
const A = await page('A', 'http://127.0.0.1:8471/?ws=7471&noboot');
const B = await page('B', 'http://127.0.0.1:8472/?ws=7472&noboot');
await sleep(1800);
const openChat = async (P, name) => { await P.click('.stab[data-tab="chats"]'); await P.locator('.js-chats .ci').filter({ has: P.locator('.nm', { hasText: new RegExp('^' + name + '$') }) }).first().click(); await sleep(500); };
const log = P => P.locator('.log:not([hidden])');
const msg = (P, text) => log(P).locator('.m[data-id]').filter({ hasText: text }).last();
const menuItem = (P, label) => P.locator('.cmenu.on .mi', { hasText: label }).first();
let failed = false;
try {
  await openChat(A, 'vasyan'); await openChat(B, 'anton');
  // разметка
  const html = await msg(A, 'жирный').locator('.tx').innerHTML();
  ok(/<b>жирный<\/b>/.test(html) && /<i>курсив<\/i>/.test(html) && /<u>/.test(html) && /<s>/.test(html) && /class="icode"/.test(html) && /class="spl"/.test(html), 'разметка: жирный, курсив, подчёркнутый, зачёркнутый, код, спойлер');
  ok(await log(A).locator('.mq').count() === 1 && await log(A).locator('pre.mcode').count() === 1 && await log(A).locator('.jumbo').count() === 1, 'цитата, блок кода, большой эмодзи');
  await msg(A, 'жирный').locator('.spl').click();
  ok(await msg(A, 'жирный').locator('.spl.open').count() === 1, 'спойлер открывается кликом');
  // панелька над сообщением
  await msg(A, 'жирный').hover(); await sleep(300);
  ok(await A.locator('.mact').isVisible(), 'панелька действий при наведении');
  await shot(A, '1-hover');
  // реакция с панельки
  await A.locator('.mact [data-qr="👍"]').click();
  await B.waitForFunction(() => [...document.querySelectorAll('.log:not([hidden]) .rc')].some(r => r.textContent.includes('👍')));
  ok(true, 'реакция с панельки дошла до собеседника');
  // меню сообщения → ответить
  await msg(A, 'цитата').click({ button: 'right' }); await A.waitForSelector('.cmenu.on'); await sleep(200);
  await shot(A, '2-msg-menu');
  ok(await A.locator('.cmenu.on .memo button').count() >= 6, 'в меню сообщения — быстрые реакции');
  await menuItem(A, 'Ответить').click();
  ok(await A.locator('.js-cbar.rp').isVisible(), 'полоска «Ответ …» над полем');
  await A.fill('.js-input', 'отвечаю на цитату\nвторой строкой'); await sleep(100);
  await shot(A, '3-reply-bar');
  await A.press('.js-input', 'Enter');
  await B.waitForSelector('.log:not([hidden]) .m .rq', { timeout: 10000 });
  ok((await B.locator('.log:not([hidden]) .m .rq').last().textContent()).includes('цитата'), 'ответ с цитатой у собеседника');
  ok((await msg(B, 'отвечаю').locator('.tx').innerHTML()).includes('<br>'), 'Shift+Enter/многострочность сохраняется');
  // правка: ↑ в пустом поле
  await A.click('.js-input'); await A.press('.js-input', 'ArrowUp'); await sleep(150);
  ok(await A.locator('.js-cbar.ed').isVisible() && (await A.inputValue('.js-input')).startsWith('отвечаю'), '↑ — правка своего последнего');
  await A.fill('.js-input', 'отвечаю на цитату (поправил)'); await A.press('.js-input', 'Enter');
  await B.waitForFunction(() => [...document.querySelectorAll('.log:not([hidden]) .m')].some(m => m.textContent.includes('(поправил)') && m.querySelector('.ed')));
  ok(true, 'правка дошла, стоит «(изм.)»');
  // удалить у всех — с подтверждением
  await msg(A, 'поправил').click({ button: 'right' }); await A.waitForSelector('.cmenu.on');
  await menuItem(A, 'Удалить у всех').click(); await A.waitForSelector('.askb.on'); await sleep(250);
  await shot(A, '4-ask');
  await A.click('.js-askok');
  await B.waitForFunction(() => ![...document.querySelectorAll('.log:not([hidden]) .m')].some(m => m.textContent.includes('(поправил)')));
  ok(true, 'удаление у всех после «точно?»');
  // меню поля ввода
  await A.fill('.js-input', 'текст для меню'); await A.click('.js-input', { button: 'right' }); await A.waitForSelector('.cmenu.on');
  ok(await menuItem(A, 'Вставить').isVisible() && await menuItem(A, 'Выделить всё').isVisible(), 'своё меню у поля ввода');
  await A.keyboard.press('Escape'); await A.fill('.js-input', '');
  // меню человека: громкость, заглушить
  await A.click('.stab[data-tab="friends"]'); await sleep(400);
  await A.locator('.js-friends [data-prof]').first().click({ button: 'right' }); await A.waitForSelector('.cmenu.on'); await sleep(200);
  await shot(A, '5-person-menu');
  ok(await A.locator('.cmenu.on .mrng input[type=range]').count() === 1, 'громкость 0–200% в меню человека');
  await A.locator('.cmenu.on .mrng input').fill('150'); await sleep(100);
  ok(await A.evaluate(async () => { const { prefs } = await import('/js/core.js'); return Object.values(prefs.vol || {})[0]; }) === 150, 'громкость сохранилась (150%)');
  await A.keyboard.press('Escape');
  // tooltip
  await A.hover('button.ib[data-win="settings"]'); await sleep(700);
  ok(await A.locator('.tip.on').isVisible() && (await A.textContent('.tip')).includes('Настройки'), 'своя подсказка при наведении');
  await shot(A, '5b-tip'); await A.mouse.move(700, 400);
  // блок
  await A.locator('.js-friends [data-prof]').first().click({ button: 'right' }); await A.waitForSelector('.cmenu.on');
  await menuItem(A, 'Заблокировать').click(); await A.waitForSelector('.askb.on'); await A.click('.js-askok'); await sleep(800);
  await openChat(A, 'vasyan');
  ok(await A.locator('.js-cbar.cbk').isVisible(), 'в чате с заблокированным — плашка «Разблокировать»');
  await shot(A, '6-blocked');
  // настройки: блок-лист, хранилище, журнал, мик
  await A.click('button.ib[data-win="settings"]'); await A.waitForSelector('.win[data-win="settings"].on');
  await A.click('.js-snav [data-tab="priv"]'); await sleep(400);
  ok(await A.locator('.js-blist .bkrow').count() === 1, 'блок-лист в «Приватность»');
  await A.locator('.js-blist .bkrow').scrollIntoViewIfNeeded(); await shot(A, '7-priv');
  await A.click('.js-blist [data-unbl]'); await sleep(600);
  ok(await A.locator('.js-blist .bkrow').count() === 0, 'разблокировка из настроек');
  await A.click('.js-snav [data-tab="storage"]'); await sleep(900);
  ok(/\d/.test(await A.textContent('.js-sttotal')) && await A.locator('.js-stlist .strow').count() >= 1, 'хранилище: размер и список чатов');
  await shot(A, '8-storage');
  await A.click('.js-snav [data-tab="net"]'); await sleep(600);
  ok(await A.locator('.js-jlist .jl').count() >= 3, 'журнал: ' + await A.locator('.js-jlist .jl').count() + ' записей');
  await A.locator('.js-jlist').scrollIntoViewIfNeeded(); await shot(A, '9-journal');
  await A.click('.js-snav [data-tab="audio"]'); await sleep(300);
  await A.click('.js-mictest'); await sleep(1800);
  const w = await A.evaluate(() => parseFloat(document.querySelector('.js-mtfill').style.width) || 0);
  ok(await A.locator('.js-mtest.on').count() === 1, 'проверка мика идёт · полоска ' + w.toFixed(0) + '%');
  await shot(A, '10-mictest');
  await A.click('.js-mictest'); await sleep(200);
  await A.keyboard.press('Escape'); await sleep(300);
  // всплывашка снизу
  await A.evaluate(async () => { const { tmsg } = await import('/js/ui.js'); tmsg('ok', 'пример всплывашки — всё остальное в журнале (Настройки → Сеть)'); });
  await sleep(400); await shot(A, '11-snack');
  ok(await A.locator('.snack.on').isVisible(), 'всплывашка снизу');
  // браузерные хоткеи не работают
  const before = A.url(); await A.keyboard.press('F5'); await sleep(500);
  ok(A.url() === before && await A.locator('.js-app').isVisible(), 'F5 не перезагружает приложение');
} catch (e) { failed = true; console.error(e.message); await shot(A, 'fail-A'); await shot(B, 'fail-B'); }
for (const k of ['A', 'B']) if (errs[k].length) { console.log(k, 'errs', errs[k].join(' | ')); failed = true; }
await b.close();
console.log(failed ? '✗ есть ошибки' : '✓ v0.2 UI ОК · скриншоты: tests/shots/v2-*.png');
process.exit(failed ? 1 : 0);
