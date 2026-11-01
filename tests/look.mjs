// Скриншоты для дизайн-ревью (не тест): node tests/look.mjs [фильтр]  → tests/shots/look-*.png
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { node, client, sleep, BASE } from './lib.mjs';
const { chromium } = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url)('playwright');
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url)); mkdirSync(SHOTS, { recursive: true });
const UI = fileURLToPath(new URL('../ui', import.meta.url));
const only = process.argv[2] || '';
rmSync(BASE, { recursive: true, force: true });
const web = (http, port) => ['--http', String(http), '--ui', UI, '--port', String(port)];
const nodes = [node('anton', 7481, web(8481, 47481)), node('vasyan', 7482, web(8482, 47482)), node('dimon', 7483, web(8483, 47483))];
process.on('exit', () => nodes.forEach(p => p.kill()));
let GID = '';
{
  const [A, B, C] = await Promise.all([client(7481, 'A'), client(7482, 'B'), client(7483, 'C')]);
  const [sa, sb, sc] = await Promise.all([A.cmd('state'), B.cmd('state'), C.cmd('state')]);
  for (const [X, sx] of [[B, sb], [C, sc]]) {
    await X.cmd('friend_add', { code: (await A.cmd('friend_code')).code });
    await A.until(e => e.ev === 'friend' && e.friend.peer === sx.me.peer && e.friend.state === 'incoming');
    await A.cmd('friend_accept', { peer: sx.me.peer });
    await X.until(e => e.ev === 'friend' && e.friend.peer === sa.me.peer && e.friend.state === 'friend');
  }
  await A.cmd('profile_set', { line: 'копаю алмазы · пишите в лс' }).catch(() => {});
  const dm = await A.cmd('dm_open', { peer: sb.me.peer }); await B.cmd('dm_open', { peer: sa.me.peer });
  await B.cmd('send', { room: dm.id, text: 'здарова @anton, как оно? 😄' }); await sleep(150);
  await A.cmd('send', { room: dm.id, text: 'норм, вечером в майн?' }); await sleep(150);
  await A.cmd('send', { room: dm.id, text: 'могу сервак поднять' }); await sleep(150);
  const m3 = await B.cmd('send', { room: dm.id, text: 'го! только у меня мик **хрипит** 😭 надо глянуть' }); await sleep(150);
  await A.cmd('react', { room: dm.id, id: m3.id, e: '😂' }).catch(() => {});
  await A.cmd('send', { room: dm.id, text: 'щас поправим', reply: m3.id }); await sleep(150);
  await B.cmd('send', { room: dm.id, text: '🔥' }); await sleep(150);
  await B.cmd('send', { room: dm.id, kind: 'sticker', text: '', data: { k: 'party' } }).catch(e => console.log('stk', e.message));
  const g = await A.cmd('room_create', { name: 'кухня', members: [sb.me.peer, sc.me.peer] }).catch(e => (console.log('group', e.message), null));
  if (g) { GID = g.id; await sleep(500); await C.cmd('send', { room: g.id, text: 'всем привет, я тут новенький' }).catch(() => {}); }
  await A.cmd('react', { room: dm.id, id: m3.id, e: '🏆' }).catch(() => {});
  if (g) {
    // зал славы и награды недели: болтун (10+), стикерщик (3+), кубки ×2 в группе
    const gm = [];
    for (const t of ['кто сегодня в майн?', 'я построил портал в ад 🔥 заходите смотреть', 'там гаст чуть не снёс мне дом', 'ахах', 'го в 9', 'кто возьмёт кирки?', 'я с алмазами', 'ок', 'жду всех', 'бро ты лучший']) { gm.push(await B.cmd('send', { room: g.id, text: t }).catch(() => null)); await sleep(40); }
    for (const k of ['party', 'joy', 'fire']) { await C.cmd('send', { room: g.id, kind: 'sticker', text: '', data: { k } }).catch(() => {}); await sleep(40); }
    await sleep(900);
    if (gm[1]) { await A.cmd('react', { room: g.id, id: gm[1].id, e: '🏆' }).catch(e => console.log('r', e.message)); await C.cmd('react', { room: g.id, id: gm[1].id, e: '🏆' }).catch(e => console.log('r', e.message)); await C.cmd('react', { room: g.id, id: gm[1].id, e: '🔥' }).catch(() => {}); }
    if (gm[2]) for (const [X, e] of [[A, '😂'], [C, '😂'], [C, '💀']]) await X.cmd('react', { room: g.id, id: gm[2].id, e }).catch(() => {});
  }
  await sleep(500); A.close(); B.close(); C.close();
}
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { const p = JSON.parse(localStorage.getItem('hunty-prefs') || '{}'); if (!('boot' in p)) localStorage.setItem('hunty-prefs', JSON.stringify({ ...p, boot: false })); } catch (_) {} });
const P = await ctx.newPage(); P.setDefaultTimeout(8000);
P.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
P.on('pageerror', e => errs.push('pageerror: ' + e.message));
P.on('response', r => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')); });
await P.goto('http://127.0.0.1:8481/?ws=7481&noboot'); await sleep(2000);
const shot = async (n, f) => { if (only && !only.split(',').some(o => n.includes(o))) return; try { await f(); await sleep(450); await P.screenshot({ path: SHOTS + 'look-' + n + '.png' }); console.log('✓', n); } catch (e) { console.log('✗', n, e.message.split('\n').filter(l => /intercept|waiting|✗|Timeout|not visible|resolved/.test(l)).slice(0, 5).join(' | ')); } await P.keyboard.press('Escape').catch(() => {}); await P.keyboard.press('Escape').catch(() => {}); await sleep(250); };
const openChat = async name => { await P.click('.stab[data-tab="chats"]'); await P.locator('.js-chats .ci').filter({ has: P.locator('.nm', { hasText: new RegExp('^' + name + '$') }) }).first().click(); await sleep(500); };
if (process.env.DEAD) {
  const { deadScan } = await import('./dead.mjs');
  await openChat('vasyan'); await deadScan(P, ctx, 'лс');
  await openChat('кухня'); await P.click('.js-hbtns [data-act="voice"]'); await sleep(1500); await deadScan(P, ctx, 'группа + голос');
  console.log(errs.join('\n') || 'без ошибок'); await b.close(); process.exit(0);
}
if (process.env.PROBE) { await openChat(process.env.PROBE_CHAT || 'vasyan'); for (const [i, f] of process.env.PROBE.split(',').entries()) { try { console.log(JSON.stringify(await P.evaluate(readFileSync(f, 'utf8')), null, 1)); } catch (e) { console.log('probe err', e.message.split('\n')[0]); } if (process.env.PROBE_SHOT === 'each') { await sleep(400); await P.screenshot({ path: SHOTS + 'probe-' + i + '.png' }); } } if (process.env.PROBE_SHOT) await P.screenshot({ path: SHOTS + 'probe.png' }); console.log(errs.join('\n') || 'без ошибок'); await b.close(); process.exit(0); }
await shot('1-chat', () => openChat('vasyan'));
await shot('2-profile', async () => { await openChat('vasyan'); await P.locator('.log:not([hidden]) .mav[data-u]:not([data-me])').first().click(); });
await shot('2b-status', async () => { await P.click('.js-mebtn'); });
await shot('2c-myprofile', async () => { await P.keyboard.press('Escape'); await P.evaluate(() => window.__hunty && 0); await P.locator('.log:not([hidden]) .mav[data-me]').first().click(); });
await shot('3-group', async () => { await P.click('.sbar [data-win="group"]'); });
await shot('4-stk', async () => { await openChat('vasyan'); await P.click('.js-stkb'); await sleep(300); });
await shot('4b-emo', async () => { await P.keyboard.press('Escape'); await P.click('.js-emo'); await sleep(300); });
await shot('4c-hover', async () => { await P.keyboard.press('Escape'); await P.locator('.log:not([hidden]) .m[data-id]').nth(2).hover(); });
await shot('5-menu-person', async () => { await P.click('.stab[data-tab="friends"]'); await sleep(300); await P.locator('.js-friends [data-prof]').first().click({ button: 'right' }); });
await shot('6-friends', async () => { await P.click('.stab[data-tab="friends"]'); });
await shot('7-groupchat', () => openChat('кухня'));
await shot('8-chatmenu', async () => { await P.click('.stab[data-tab="chats"]'); await P.locator('.js-chats .ci').first().click({ button: 'right' }); });
for (const t of ['acc', 'audio', 'look', 'keys', 'notif', 'priv', 'net', 'about']) await shot('9-set-' + t, async () => { await P.click('button.ib[data-win="settings"]'); await P.waitForSelector('.win[data-win="settings"].on'); await P.click(`.js-snav [data-tab="${t}"]`); });
await shot('11-micmenu', async () => { await P.keyboard.press('Escape'); await P.click('.js-memicx'); });
await shot('12-tabmenu', async () => { await P.keyboard.press('Escape'); await P.locator('.js-nav .ws[data-chat]').first().click({ button: 'right' }); });
await shot('13-pinned', async () => { await P.keyboard.press('Escape'); await P.locator('.js-chats .ci').nth(1).click({ button: 'right' }); await P.locator('.cmenu .mi', { hasText: 'Закрепить чат' }).click(); await sleep(600); });
await shot('14-find', async () => { await P.keyboard.press('Escape'); await openChat('vasyan'); await P.keyboard.press('Control+f'); await P.keyboard.type('мик'); await sleep(700); });
await shot('14b-findjump', async () => { await P.keyboard.press('Control+f'); await P.keyboard.type('мик'); await sleep(700); await P.keyboard.press('Enter'); await sleep(900); });
await shot('14c-findnone', async () => { await P.keyboard.press('Control+f'); await P.keyboard.type('жираф'); await sleep(700); });
await shot('15-micfix', async () => { await P.keyboard.press('Escape'); await P.keyboard.press('Escape'); await P.click('button.ib[data-win="settings"]'); await P.waitForSelector('.win[data-win="settings"].on'); await P.click('.js-snav [data-tab="audio"]'); await sleep(400); await P.click('.js-micfix'); await sleep(1500); });
await shot('15b-micfix-go', async () => { await P.click('button.ib[data-win="settings"]'); await P.waitForSelector('.win[data-win="settings"].on'); await P.click('.js-snav [data-tab="audio"]'); await sleep(400); await P.click('.js-micfix'); await sleep(1200); await P.locator('.win[data-win="micfix"] .cbtn:visible').first().click(); await sleep(2500); });
await shot('16-call', async () => { await P.keyboard.press('Escape'); await P.keyboard.press('Escape'); await openChat('vasyan'); await P.click('.js-hbtns [data-act="call"]'); await sleep(1800); });
await shot('16b-vpop', async () => { await P.click('.js-btns'); await sleep(500); if (process.env.DBG) console.log('vpop', JSON.stringify(await P.evaluate(() => { const v = document.querySelector('.js-vpop'); const r = e => { const b = e.getBoundingClientRect(); return [e.className, Math.round(b.top), Math.round(b.height), getComputedStyle(e).position]; }; return [r(v), r(v.parentElement), ...[...v.children].map(r)]; }))); });
let VB = null, VC = null;
await shot('16c-group-voice', async () => { await P.click('.js-leave'); await sleep(600); await openChat('кухня'); await P.click('.js-hbtns [data-act="voice"]'); await sleep(1200);
  if (GID && !VB) { VB = await client(7482, 'B'); VC = await client(7483, 'C'); await VB.cmd('voice_join', { room: GID }).catch(e => console.log('vj', e.message)); await VC.cmd('voice_join', { room: GID }).catch(e => console.log('vj', e.message)); await sleep(1500); } });
await shot('16c2-group-vpop', async () => { await P.click('.js-btns'); await sleep(500); });
await shot('16c3-focus', async () => { await P.click('.js-stfull'); await sleep(700); });
await shot('16c4-unfocus', async () => { await P.click('.js-stfull'); await sleep(700); });
await shot('16d-left', async () => { await P.click('.js-leave'); await sleep(800); if (VB) { VB.close(); VC.close(); } });
await shot('16e-self', async () => { await P.evaluate(() => document.querySelector('.js-mefav').click()); await sleep(900); });
for (const w of ['aurora', 'sunset', 'nether']) await shot('17-wall-' + w, async () => { await P.click('button.ib[data-win="settings"]'); await P.waitForSelector('.win[data-win="settings"].on'); await P.click('.js-snav [data-tab="look"]'); await sleep(300); await P.click(`.js-walls [data-w="${w}"]`); await sleep(300); await P.keyboard.press('Escape'); await sleep(500); });
await shot('17z-wall-reset', async () => { await P.click('button.ib[data-win="settings"]'); await P.waitForSelector('.win[data-win="settings"].on'); await P.click('.js-snav [data-tab="look"]'); await sleep(300); await P.click('.js-walls [data-w=""]'); await sleep(300); await P.keyboard.press('Escape'); await sleep(400); });
await shot('10-gset', async () => { await openChat('кухня'); await P.locator('.js-hbtns button').last().click(); });
await shot('20-hall', async () => { await P.keyboard.press('Escape'); await P.click('.js-hallb'); await sleep(900); });
await shot('20b-hof-chat', async () => { await P.keyboard.press('Escape'); await openChat('кухня'); await sleep(500); });
await shot('20c-hof-hover', async () => { await P.locator('.log:not([hidden]) .m.hof').first().hover(); await sleep(300); });
await shot('18-mobile', async () => { await P.setViewportSize({ width: 400, height: 820 }); await sleep(500); });
await shot('18b-mobile-chat', async () => { await openChat('vasyan'); await sleep(400); });
await P.setViewportSize({ width: 1440, height: 900 }); await sleep(300);
await shot('19-lite', async () => { await P.evaluate(() => document.documentElement.classList.add('lite')); await openChat('vasyan'); await sleep(300); });
await P.evaluate(() => document.documentElement.classList.remove('lite'));
console.log(errs.length ? 'errs: ' + errs.join(' | ') : 'без ошибок');
await b.close(); process.exit(0);
