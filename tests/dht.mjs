// Поиск друга только через публичный IPFS DHT (без mDNS, без адресов в коде)
import { spawn } from 'node:child_process';
import { client, sleep, BIN } from './lib.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const DIR = join(tmpdir(), 'hunty-dht');
import { rmSync } from 'node:fs';
rmSync(DIR, { recursive: true, force: true });
const t0 = Date.now(); const T = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
const run = (n, ws) => spawn(BIN, ['--data', join(DIR, n), '--ws', String(ws), '--no-mdns', '--no-upnp', '--nick', n], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, RUST_LOG: 'info,libp2p=warn' } });
const P = [run('xx', 7701), run('yy', 7702)];
P.forEach((p, i) => p.stderr.on('data', d => String(d).split('\n').filter(l => /hunty_core|DHT|NAT|ретранс|внешний|опубликовал|нашёл/.test(l)).forEach(l => console.log(T(), i ? 'Y' : 'X', l.replace(/^.*?INFO /, '').slice(0, 160)))));
try {
  const [X, Y] = await Promise.all([client(7701, 'X'), client(7702, 'Y')]);
  const sx = await X.cmd('state');
  await sleep(60000);
  console.log(T(), 'X net:', JSON.stringify((await X.cmd('net'))).slice(0, 600));
  await Y.cmd('friend_add', { code: sx.me.peer });
  const r = await X.until(e => e.ev === 'friend' && e.friend.state === 'incoming', 240000);
  console.log(T(), 'НАЙДЕН ЧЕРЕЗ DHT ✓', r.friend.profile.nick, 'via', (await X.cmd('net')).online.map(o => o.via + ' ' + o.addr).join(','));
} catch (e) { console.log(T(), 'FAIL', e.message); }
finally { P.forEach(p => p.kill()); await sleep(300); process.exit(); }
