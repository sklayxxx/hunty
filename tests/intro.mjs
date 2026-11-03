// e2e v0.5: каждый ПК — мини-сервер знакомств.
// A и C дружат, но после перезапуска у обоих сменились порты — старые адреса друг друга мертвы,
// DHT и локалка выключены. Найтись они могут только через общего друга B.
import { node, client, sleep, BASE } from './lib.mjs';
import { rmSync } from 'node:fs';
rmSync(BASE, { recursive: true, force: true });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('✓', m); };
const port = n => ['--port', String(n)];
let P = [node('anton', 7611, port(41011)), node('vasyan', 7612, port(41012)), node('dimon', 7613, port(41013))];
// событие могло прийти раньше, чем подключился тестовый клиент, — поэтому опрашиваю net
async function online(X, peer, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const n = await X.cmd('net');
    if ((n.online || []).some(o => o.peer === peer)) return true;
    await sleep(100);
  }
  throw new Error('не дождался «в сети» ' + peer.slice(-6));
}
async function befriend(X, Y, sx, sy) {
  const { code } = await X.cmd('friend_code');
  await Y.cmd('friend_add', { code });
  await X.until(e => e.ev === 'friend' && e.friend.peer === sy.me.peer && e.friend.state === 'incoming');
  await X.cmd('friend_accept', { peer: sy.me.peer });
  await Y.until(e => e.ev === 'friend' && e.friend.peer === sx.me.peer && e.friend.state === 'friend');
}
try {
  let [A, B, C] = await Promise.all([client(7611, 'A'), client(7612, 'B'), client(7613, 'C')]);
  const [sa, sb, sc] = await Promise.all([A.cmd('state'), B.cmd('state'), C.cmd('state')]);
  await befriend(A, B, sa, sb); await befriend(B, C, sb, sc); await befriend(A, C, sa, sc);
  ok(true, 'A–B, B–C, A–C — друзья');
  await online(A, sc.me.peer);
  ok(true, 'A видит C (старые порты)');
  // перезапуск A и C на новых портах: кеш адресов друг друга устарел
  A.close(); C.close(); P[0].kill(); P[2].kill();
  await sleep(1500);
  const t0 = Date.now();
  P[0] = node('anton', 7611, port(41021)); P[2] = node('dimon', 7613, port(41023));
  [A, C] = await Promise.all([client(7611, 'A'), client(7613, 'C')]);
  await online(A, sb.me.peer);
  ok(true, `A снова у B за ${Date.now() - t0} мс`);
  await Promise.all([online(A, sc.me.peer, 20000), online(C, sa.me.peer, 20000)]);
  const dt = Date.now() - t0;
  ok(dt < 12000, `A и C нашли друг друга через B за ${dt} мс (без DHT и локалки)`);
  const nb = await B.cmd('net'), na = await A.cmd('net');
  ok(nb.intros && nb.intros.made >= 1, `B познакомил: ${JSON.stringify(nb.intros)}`);
  ok(na.intros && na.intros.got >= 1, `A получил знакомств: ${na.intros.got}`);
  // C уходит и возвращается на третьем порту, пока A уже ждёт: B помнит просьбу и знакомит сразу
  C.close(); P[2].kill();
  for (let i = 0; i < 150 && ((await A.cmd('net')).online || []).some(o => o.peer === sc.me.peer); i++) await sleep(100);
  await sleep(500);
  const t1 = Date.now();
  P[2] = node('dimon', 7613, port(41033));
  C = await client(7613, 'C');
  await online(A, sc.me.peer, 20000);
  ok(Date.now() - t1 < 8000, `C вернулся на новом порту — A увидел его за ${Date.now() - t1} мс (B ждал вместе с A)`);
  const msg = await A.cmd('send', { room: (await A.cmd('dm_open', { peer: sc.me.peer })).id, text: 'нашёлся' });
  const got = await C.until(e => e.ev === 'msg' && e.msg.id === msg.id);
  ok(got.msg.text === 'нашёлся', 'личка A→C ходит напрямую');
  console.log('\nвсё ок');
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { P.forEach(p => p.kill()); await sleep(200); process.exit(); }
