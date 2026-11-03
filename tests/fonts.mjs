// Шрифты интерфейса: любой шрифт из «Внешнего вида» не раздувает и не сжимает вёрстку.
// Меряю ширину и высоту одних и тех же элементов (список, чат, кнопки) при каждом шрифте
// относительно «Мягкого» и сохраняю скриншоты tests/shots/font-*.png
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { node, client, sleep, BASE } from './lib.mjs';
const { chromium } = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url)('playwright');
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url)); mkdirSync(SHOTS, { recursive: true });
const UI = fileURLToPath(new URL('../ui', import.meta.url));
rmSync(BASE, { recursive: true, force: true });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('✓', m); };
const nodes = [node('anton', 7491, ['--http', '8491', '--ui', UI, '--port', '47491']), node('vasyan', 7492, ['--port', '47492'])];
let code = 0;
try {
  const [A, B] = await Promise.all([client(7491, 'A'), client(7492, 'B')]);
  const [sa, sb] = await Promise.all([A.cmd('state'), B.cmd('state')]);
  await B.cmd('friend_add', { code: (await A.cmd('friend_code')).code });
  await A.until(e => e.ev === 'friend' && e.friend.peer === sb.me.peer && e.friend.state === 'incoming');
  await A.cmd('friend_accept', { peer: sb.me.peer });
  const dm = await A.cmd('dm_open', { peer: sb.me.peer });
  for (const t of ['здарова, как оно? вечером в майн?', 'норм, могу сервак поднять — заходи после девяти', 'Привет! Hunty 0.5: Ёжик, щука, 1234567890']) { await B.cmd('send', { room: dm.id, text: t }); await sleep(120); }
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const P = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await P.addInitScript(() => localStorage.setItem('hunty-prefs', JSON.stringify({ boot: false, lastChat: '' })));
  await P.goto('http://127.0.0.1:8491/?ws=7491');
  await P.waitForSelector('.tx', { timeout: 20000 }).catch(() => {});
  await P.evaluate(() => { const r = document.querySelector('[data-room], .ci'); r && r.click(); });
  await sleep(1200);
  const keys = await P.evaluate(() => [...document.querySelectorAll('.js-fonts [data-f]')].map(b => b.dataset.f));
  ok(keys.length >= 12, 'шрифтов на выбор: ' + keys.length + ' (' + keys.join(', ') + ')');
  const probe = () => {
    const pick = sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent && e.textContent.trim()).slice(0, 12);
    const els = [...pick('.tx'), ...pick('.nm, .ci b, .it b'), ...pick('button span')];
    // ширина «текста как есть»: ставлю копию в inline-блок без переносов
    const m = document.createElement('span'); m.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:nowrap;font:15px/1.4 var(--sans)';
    m.textContent = 'Привет, бро! Как дела? Зайдёшь вечером в войс — поиграем в Minecraft 1.21, ок?'; document.body.append(m);
    const w = m.getBoundingClientRect().width, h = m.getBoundingClientRect().height; m.remove();
    const over = [...document.querySelectorAll('button, .ci, .row b, .tab, .stab')].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible').length;
    return { w, h, els: els.length, docH: document.scrollingElement.scrollHeight, over };
  };
  let ref = null; const rows = [];
  for (const k of keys) {
    await P.evaluate(k => { document.documentElement.dataset.font = k; }, k);
    await P.evaluate(() => document.fonts.ready);
    await sleep(250);
    const loaded = await P.evaluate(k => k === 'system' || [...document.fonts].some(f => f.family === 'hu-' + k && f.status === 'loaded'), k);
    const r = await P.evaluate(probe);
    if (!ref) ref = r;
    rows.push({ k, loaded, dw: r.w / ref.w - 1, h: r.h, over: r.over });
    await P.screenshot({ path: SHOTS + 'font-' + k + '.png' });
  }
  for (const r of rows) console.log(`  ${r.k.padEnd(7)} ширина ${(r.dw * 100).toFixed(0).padStart(4)}%  строка ${r.h.toFixed(1)}px  обрезано ${r.over}  ${r.loaded ? 'загружен' : 'НЕ ЗАГРУЖЕН'}`);
  ok(rows.every(r => r.loaded), 'все шрифты загрузились из файлов');
  ok(rows.every(r => Math.abs(r.dw) <= 0.2), 'ширина текста у всех шрифтов в пределах ±20% от «Мягкого»');
  ok(rows.every(r => Math.abs(r.h - rows[0].h) < 0.5), 'высота строки одинаковая — вёрстка не прыгает');
  await b.close();
} catch (e) { console.error(e.message); code = 1; }
finally { nodes.forEach(p => p.kill()); await sleep(200); process.exit(code); }
