// Мини-клиент WS-моста hunty-node для тестов
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const BIN = process.env.HUNTY_BIN || join(ROOT, 'target', 'debug', 'hunty-node' + (process.platform === 'win32' ? '.exe' : ''));
export const BASE = join(tmpdir(), 'hunty-test');
/** узел в локальном режиме; nick=false — без авто-регистрации (для теста онбординга) */
export function node(name, ws, extra = [], nick = true) {
  const data = join(BASE, name);
  const p = spawn(BIN, ['--data', data, '--ws', String(ws), '--local', '--no-dht', '--no-mdns', ...(nick ? ['--nick', name] : []), ...extra], { stdio: ['ignore', 'ignore', 'pipe'] });
  p.stderr.on('data', d => { if (process.env.V) process.stderr.write(`[${name}] ${d}`); });
  return p;
}
export async function client(ws, name) {
  for (let i = 0; i < 50; i++) {
    try {
      const c = await new Promise((res, rej) => { const s = new WebSocket(`ws://127.0.0.1:${ws}`); s.onopen = () => res(s); s.onerror = rej; });
      let id = 0; const wait = new Map(); const evs = []; const subs = [];
      c.onmessage = m => { const v = JSON.parse(m.data); if (v.rid != null && wait.has(v.rid)) { const [r, j] = wait.get(v.rid); wait.delete(v.rid); v.err ? j(new Error(v.err)) : r(v.ok); } else if (v.ev) { evs.push(v); subs.forEach(f => f(v)); if (process.env.V) console.log(`  ${name} <- ${v.ev}`, v.ev === 'log' ? v.text : ''); } };
      const cmd = (cmd, a = {}) => new Promise((r, j) => { const i = ++id; wait.set(i, [r, j]); c.send(JSON.stringify({ ...a, cmd, rid: i })); });
      const until = (pred, ms = 15000) => new Promise((r, j) => { const f = evs.find(pred); if (f) return r(f); const t = setTimeout(() => j(new Error(`${name}: не дождался события`)), ms); subs.push(v => { if (pred(v)) { clearTimeout(t); r(v); } }); });
      return { cmd, until, evs, close: () => c.close() };
    } catch { await sleep(200); }
  }
  throw new Error('нет WS ' + ws);
}
