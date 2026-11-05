// Вёрстка: ничего не вылезает за края и не обрезается — на всех окнах, меню и в звонке с демкой,
// при разных размерах окна (900×600 — минимальный у приложения) и масштабе интерфейса.
// node tests/layout.mjs [фильтр]  · переменные как у tests/ui.mjs (CHROMIUM, PLAYWRIGHT_FROM, HUNTY_BIN)
// Находки — в консоль, скриншоты проблемных состояний — tests/shots/layout-*.png. Код выхода 1, если есть находки.
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { node, client, sleep, BASE } from './lib.mjs';
import { audit } from './audit.js';
const { chromium } = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url)('playwright');
const UI = fileURLToPath(new URL('../ui', import.meta.url));
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url)); mkdirSync(SHOTS, { recursive: true });
const only = process.argv[2] || '';
rmSync(BASE, { recursive: true, force: true });
const web = (http, port) => ['--http', String(http), '--ui', UI, '--port', String(port)];
const PEOPLE = [['anton', 'steve'], ['vasyan', 'creeper'], ['dimon', 'fox']];
const nodes = PEOPLE.map(([n, ava], i) => node(n, 7591 + i, [...web(8591 + i, 47591 + i), '--ava', ava]));
process.on('exit', () => nodes.forEach(p => p.kill()));
{
  const C = await Promise.all(PEOPLE.map((_, i) => client(7591 + i, PEOPLE[i][0])));
  const S = await Promise.all(C.map(c => c.cmd('state'))); const [A, B] = C, id = i => S[i].me.peer;
  for (let i = 1; i < C.length; i++) {
    await C[i].cmd('friend_add', { code: (await A.cmd('friend_code')).code });
    await A.until(e => e.ev === 'friend' && e.friend.peer === id(i) && e.friend.state === 'incoming');
    await A.cmd('friend_accept', { peer: id(i) });
    await C[i].until(e => e.ev === 'friend' && e.friend.peer === id(0) && e.friend.state === 'friend');
  }
  const dm = await A.cmd('dm_open', { peer: id(1) }); await B.cmd('dm_open', { peer: id(0) });
  await B.cmd('send', { room: dm.id, text: 'здарова, как оно? длинное сообщение, чтобы строка точно переносилась и проверялась вёрстка ленты на узком окне 😄' });
  await A.cmd('send', { room: dm.id, text: 'норм' });
  const g = await A.cmd('room_create', { name: 'очень длинное название группы для проверки', color: '#ffc66b', members: [id(1), id(2)] });
  await sleep(600); await B.cmd('send', { room: g.id, text: 'всем привет' });
  await A.cmd('profile_set', { line: 'очень длинный статус чтобы проверить обрезку в панели снизу слева' }).catch(() => {});
  C.forEach(c => c.close());
}
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const fakeScreen = () => { navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const x = c.getContext('2d'); setInterval(() => { x.fillStyle = '#3a6'; x.fillRect(0, 0, 1920, 1080); x.fillStyle = '#fff'; x.fillRect((Date.now() / 5) % 1900, 500, 20, 20); }, 50); return c.captureStream(20); }; };
const errs = [], found = []; let checks = 0;
const ALL = !!process.env.LAYOUT_SHOTS; // LAYOUT_SHOTS=1 — скриншот каждого состояния, не только проблемных
async function page(name, i, vp, scale = 100) {
  const ctx = await b.newContext({ viewport: vp });
  await ctx.addInitScript(p => { try { const o = JSON.parse(localStorage.getItem('hunty-prefs') || '{}'); localStorage.setItem('hunty-prefs', JSON.stringify({ ...o, boot: false, earGuard: false, ...p })); } catch (_) {} }, { scale });
  await ctx.addInitScript(fakeScreen);
  const P = await ctx.newPage(); P.setDefaultTimeout(8000);
  P.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
  await P.goto(`http://127.0.0.1:${8591 + i}/?ws=${7591 + i}&noboot`); await P.waitForFunction(() => document.querySelectorAll('.js-chats .ci').length > 0, null, { timeout: 15000 }).catch(() => {}); await sleep(600);
  return P;
}
const AUD = `(${audit})`;
async function check(P, tag, root) {
  await sleep(450);
  const r = await P.evaluate(([src, o]) => eval(src)(o), [AUD, { root, tag }]); checks++;
  if (r.length || ALL) { found.push(...r); await P.screenshot({ path: SHOTS + 'layout-' + tag.replace(/[^\wа-я]+/gi, '_') + '.png' }).catch(() => {}); }
}
const open = (P, n, o) => P.evaluate(([n, o]) => import('/js/ui.js').then(m => m.openW(n, o)), [n, o]);
const closeAll = async P => { for (let i = 0; i < 3; i++) { await P.keyboard.press('Escape').catch(() => {}); await sleep(80); } };
const chat = async (P, name) => { await P.locator('.js-chats .ci').filter({ has: P.locator('.nm', { hasText: name }) }).first().click(); await sleep(400); };
const SIZES = [[1920, 1080], [1440, 900], [1280, 800], [1100, 680], [900, 600]];
const want = t => !only || t.includes(only);
for (const [w, h] of SIZES) for (const scale of w === 1280 ? [100, 125] : [100]) {
  const sz = `${w}x${h}${scale !== 100 ? '@' + scale : ''}`;
  const P = await page('anton', 0, { width: w, height: h }, scale);
  const T = n => `${sz} ${n}`;
  if (want('main')) { await chat(P, 'очень длинное'); await check(P, T('группа')); await chat(P, 'vasyan'); await check(P, T('лс')); }
  if (want('menu')) {
    await P.click('.js-mebtn'); await check(P, T('меню статуса')); await closeAll(P);
    await P.locator('.log:not([hidden]) .m[data-id]').first().click({ button: 'right' }).catch(() => {}); await check(P, T('меню сообщения')); await closeAll(P);
    await P.locator('.js-chats .ci').first().click({ button: 'right' }).catch(() => {}); await check(P, T('меню чата')); await closeAll(P);
  }
  if (want('win')) {
    for (const t of ['acc', 'audio', 'video', 'share', 'look', 'notif', 'keys', 'priv', 'storage', 'net', 'about']) { await open(P, 'settings', { tab: t }); await check(P, T('настройки ' + t), '.win.on'); }
    await closeAll(P);
    for (const n of ['friend', 'group', 'join', 'hall', 'media', 'micfix', 'stkmake']) { await open(P, n, {}); await check(P, T('окно ' + n), '.win.on'); await closeAll(P); }
    await chat(P, 'очень длинное');
    const gid = await P.evaluate(() => import('/js/state.js').then(m => m.S.cur));
    for (const t of ['members', 'main', 'invite']) { await open(P, 'gset', { room: gid, tab: t }); await check(P, T('группа ' + t), '.win.on'); }
    await closeAll(P);
    const vid = await P.evaluate(() => import('/js/state.js').then(m => [...m.S.friends.keys()][0]));
    await open(P, 'profile', { peer: vid }); await check(P, T('профиль'), '.win.on'); await closeAll(P);
  }
  await P.context().close();
}
// звонок: трое в голосе, dimon показывает экран, у anton — инструменты рисования
if (want('voice')) for (const [w, h] of [[1920, 1080], [1280, 800], [1100, 680], [900, 600]]) {
  const sz = `${w}x${h}`;
  const P = await page('anton', 0, { width: w, height: h }), PB = await page('vasyan', 1, { width: 900, height: 600 }), PD = await page('dimon', 2, { width: 900, height: 600 });
  for (const X of [P, PB, PD]) await chat(X, 'очень длинное');
  await P.click('.js-hbtns [data-act="voice"]'); await sleep(900); await PB.click('.js-hbtns [data-act="voice"]'); await sleep(600); await PD.click('.js-hbtns [data-act="voice"]'); await sleep(2500);
  await check(P, `${sz} голос`);
  await PD.click('.js-share'); await sleep(400); await PD.click('.js-sstart'); await sleep(3000);
  await check(P, `${sz} демка`);
  await P.click('.tl[data-tool="pen"]').catch(() => {}); await check(P, `${sz} демка-карандаш`);
  await P.locator('.vtile[data-u]:not(.me)').first().click({ button: 'right' }).catch(() => {}); await check(P, `${sz} меню плитки`); await closeAll(P);
  await P.click('.js-stfull').catch(() => {}); await check(P, `${sz} только звонок`); await P.click('.js-stfull').catch(() => {});
  await chat(P, 'vasyan'); await sleep(800); await check(P, `${sz} мини-звонок`);
  await check(PD, `${sz} у показывающего`);
  for (const X of [PD, PB, P]) await X.click('.js-leave').catch(() => {});
  await sleep(800);
  await P.click('.js-hbtns [data-act="call"]').catch(() => {}); await sleep(1200);
  await PB.locator('.js-toasts button', { hasText: 'Ответить' }).first().click({ timeout: 6000 }).catch(() => {}); await sleep(2500);
  await check(P, `${sz} звонок в лс`);
  await P.click('.js-leave').catch(() => {}); await sleep(500);
  for (const X of [P, PB, PD]) await X.context().close();
}
await b.close();
const by = new Map(); for (const f of found) { const k = f.what + ' — ' + f.why; if (!by.has(k)) by.set(k, []); by.get(k).push(f.tag + ' (' + f.px + 'px)'); }
for (const [k, v] of by) console.log('✗ ' + k + '\n    ' + v.slice(0, 6).join(', ') + (v.length > 6 ? ` … и ещё ${v.length - 6}` : ''));
console.log(`проверено состояний: ${checks}`);
console.log(by.size ? `находок: ${by.size}` : '✓ ничего не вылезает');
if (errs.length) console.log(errs.join('\n'));
process.exit(by.size ? 1 : 0);
