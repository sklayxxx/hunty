// Замер скорости интерфейса: node tests/perf.mjs [папка ui] [метка]
// Холодный старт (до первого готового экрана), простой (CPU за 10 с), память JS, открытие чата,
// прокрутка истории вверх. Пишет JSON в stdout — сравнивать версии на одной машине.
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { node, client, sleep, BASE } from './lib.mjs';
const { chromium } = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url)('playwright');
const UI = process.argv[2] || fileURLToPath(new URL('../ui', import.meta.url));
const label = process.argv[3] || 'ui';
rmSync(BASE, { recursive: true, force: true });
const nodes = [node('anton', 7591, ['--http', '8591', '--ui', UI, '--port', '47591']), node('vasyan', 7592, ['--port', '47592'])];
const out = { label };
try {
  const [A, B] = await Promise.all([client(7591, 'A'), client(7592, 'B')]);
  const [sa, sb] = await Promise.all([A.cmd('state'), B.cmd('state')]);
  await B.cmd('friend_add', { code: (await A.cmd('friend_code')).code });
  await A.until(e => e.ev === 'friend' && e.friend.peer === sb.me.peer && e.friend.state === 'incoming');
  await A.cmd('friend_accept', { peer: sb.me.peer });
  const dm = await A.cmd('dm_open', { peer: sb.me.peer });
  const words = 'го вечером в майн кто со мной строим базу у реки нашёл алмазы скинь координаты'.split(' ');
  for (let i = 0; i < 600; i++) {
    const t = Array.from({ length: 4 + (i % 9) }, (_, j) => words[(i * 7 + j * 3) % words.length]).join(' ') + (i % 11 === 0 ? ' 😂🔥' : '');
    await (i % 3 ? B : A).cmd('send', { room: dm.id, text: t });
  }
  await sleep(800);
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const runs = [];
  for (const boot of [true, false]) {
    for (let k = 0; k < 3; k++) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const P = await ctx.newPage();
      await P.addInitScript(boot => {
        localStorage.setItem('hunty-prefs', JSON.stringify({ boot, lastChat: '' }));
        // «готово» = загрузочного экрана нет и сообщения чата на экране
        const t = () => { if (!document.querySelector('.boot') && document.querySelector('.tx')) { window.__ready = performance.now(); return true; } };
        new MutationObserver((_, o) => { if (t()) o.disconnect(); }).observe(document, { subtree: true, childList: true });
      }, boot);
      await P.goto('http://127.0.0.1:8591/?ws=7591');
      await P.waitForFunction(() => window.__ready, null, { timeout: 30000 });
      const m = await P.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const res = performance.getEntriesByType('resource');
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        return { ready: window.__ready, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, fcp: fcp ? fcp.startTime : 0, n: res.length, kb: Math.round(res.reduce((s, r) => s + (r.decodedBodySize || 0), 0) / 1024) + Math.round((nav.decodedBodySize || 0) / 1024) };
      });
      runs.push({ boot, ...m });
      if (!boot && k === 2) {
        // простой: 10 с с открытым чатом
        const cdp = await ctx.newCDPSession(P); await cdp.send('Performance.enable');
        await sleep(3000);
        const g = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
        const m0 = await g(); await sleep(10000); const m1 = await g();
        out.idle = { cpu_ms_per_s: +((m1.TaskDuration - m0.TaskDuration) * 100).toFixed(1), script_ms: +((m1.ScriptDuration - m0.ScriptDuration) * 1000).toFixed(0), style_ms: +((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000).toFixed(0), layout_ms: +((m1.LayoutDuration - m0.LayoutDuration) * 1000).toFixed(0), heap_mb: +(m1.JSHeapUsedSize / 1048576).toFixed(1), nodes: m1.Nodes };
        // прокрутка вверх: подгрузка старых сообщений, пока не кончатся
        const sc = await P.evaluate(async () => {
          const box = [...document.querySelectorAll('.log')].find(l => l.offsetParent && l.querySelector('.tx'));
          const t0 = performance.now(); let n0 = document.querySelectorAll('.tx').length, frames = 0, worst = 0, last = performance.now();
          let run = true; const raf = () => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; frames++; if (run) requestAnimationFrame(raf); }; requestAnimationFrame(raf);
          for (let i = 0; i < 40; i++) { box.scrollTop = 0; box.dispatchEvent(new Event('scroll')); await new Promise(r => setTimeout(r, 120)); }
          run = false;
          return { msgs: document.querySelectorAll('.tx').length, from: n0, ms: Math.round(performance.now() - t0), fps: Math.round(frames / ((performance.now() - t0) / 1000)), worst_frame_ms: Math.round(worst) };
        });
        out.scroll = sc;
        const m2 = await g(); out.after_scroll = { heap_mb: +(m2.JSHeapUsedSize / 1048576).toFixed(1), nodes: m2.Nodes };
      }
      await ctx.close();
    }
  }
  const med = (a, k) => { const v = a.map(x => x[k]).sort((x, y) => x - y); return Math.round(v[Math.floor(v.length / 2)]); };
  for (const boot of [true, false]) { const r = runs.filter(x => x.boot === boot); out[boot ? 'start_boot' : 'start_noboot'] = { ready_ms: med(r, 'ready'), fcp_ms: med(r, 'fcp'), dcl_ms: med(r, 'dcl'), files: r[0].n, kb: r[0].kb }; }
  await b.close();
  console.log(JSON.stringify(out));
} catch (e) { console.error(e); process.exitCode = 1; }
finally { nodes.forEach(p => p.kill()); await sleep(200); process.exit(); }
