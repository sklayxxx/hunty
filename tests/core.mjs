// e2e ядра: дружба, личка, группа, инвайт, синк истории, голос/сигналинг
import { node, client, sleep, BASE } from './lib.mjs';
import { rmSync } from 'node:fs';
rmSync(BASE, { recursive: true, force: true });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('✓', m); };
const P = [node('anton', 7601), node('vasyan', 7602), node('dimon', 7603)];
try {
  const [A, B, C] = await Promise.all([client(7601, 'A'), client(7602, 'B'), client(7603, 'C')]);
  const sa = await A.cmd('state'), sb = await B.cmd('state'), sc = await C.cmd('state');
  ok(sa.me.onboarded && sa.me.profile.nick === 'anton', 'A зарегистрирован');
  const { code } = await A.cmd('friend_code');
  ok(code.startsWith('hunty://add/'), 'код дружбы ' + code.slice(0, 40) + '… (' + code.length + ' симв.)');
  await B.cmd('friend_add', { code });
  const req = await A.until(e => e.ev === 'friend' && e.friend.peer === sb.me.peer && e.friend.state === 'incoming');
  ok(req.friend.profile.nick === 'vasyan', 'A получил заявку от vasyan');
  await A.cmd('friend_accept', { peer: sb.me.peer });
  await B.until(e => e.ev === 'friend' && e.friend.peer === sa.me.peer && e.friend.state === 'friend');
  ok(true, 'B видит дружбу');
  const dmA = await A.cmd('dm_open', { peer: sb.me.peer });
  const m1 = await A.cmd('send', { room: dmA.id, text: 'привет, бро' });
  const got = await B.until(e => e.ev === 'msg' && e.msg.id === m1.id);
  ok(got.msg.text === 'привет, бро', 'личка дошла до B, подпись проверена');
  // группа
  await A.cmd('room_create', { name: 'кухня', color: '#ffc66b', members: [sb.me.peer] });
  const rB = await B.until(e => e.ev === 'room' && e.room.kind === 'group' && e.room.name === 'кухня');
  ok(rB.room.members.length === 2, 'B добавлен в группу при создании');
  const g = rB.room.id;
  for (let i = 0; i < 5; i++) await A.cmd('send', { room: g, text: 'сообщение ' + i });
  await B.until(e => e.ev === 'msg' && e.msg.text === 'сообщение 4');
  ok(true, 'B получил 5 сообщений в группе');
  // инвайт для C (не друг)
  const inv = await B.cmd('room_invite', { room: g });
  ok(inv.code.startsWith('hunty://join/'), 'инвайт ' + inv.code.length + ' симв.');
  await C.cmd('room_join', { code: inv.code });
  const jc = await C.until(e => e.ev === 'room' && e.room.id === g && e.room.pending === false, 20000);
  ok(jc.room.members.length === 3, 'C зашёл по инвайту, участников: ' + jc.room.members.length);
  await C.until(e => (e.ev === 'msgs' || e.ev === 'msg') && e.room === g && (e.msgs || [e.msg]).some(m => m.text === 'сообщение 4'), 20000);
  const hist = await C.cmd('msgs', { room: g });
  ok(hist.msgs.filter(m => m.kind === 'text').length === 5, 'C подтянул историю: ' + hist.msgs.length + ' (вкл. системные)');
  await A.until(e => e.ev === 'room' && e.room.id === g && e.room.members.length === 3, 20000);
  ok(true, 'A узнал о новом участнике');
  const mc = await C.cmd('send', { room: g, text: 'всем ку, я dimon' });
  // A и C только что соединились: сообщение может прийти пушем (msg) или раньше — синком истории (msgs)
  await A.until(e => (e.ev === 'msg' || e.ev === 'msgs') && e.room === g && (e.msgs || [e.msg]).some(m => m.id === mc.id), 20000);
  ok(true, 'сообщение C дошло до A (напрямую, через пересылку или синком)');
  // голос и сигналинг
  await A.cmd('voice_join', { room: g, state: { mic: true } });
  await C.until(e => e.ev === 'voice' && e.room === g && e.peer === sa.me.peer && e.state);
  ok(true, 'C видит A в голосе');
  await C.cmd('rtc', { room: g, to: sa.me.peer, data: { sdp: 'offer-test' } });
  const r = await A.until(e => e.ev === 'rtc' && e.from === sc.me.peer);
  ok(r.data.sdp === 'offer-test', 'сигналинг WebRTC C→A');
  await B.cmd('ev', { room: g, kind: 'typing', data: {} });
  await A.until(e => e.ev === 'ev' && e.kind === 'typing' && e.from === sb.me.peer);
  ok(true, 'эфемерные события (печатает…)');
  // кик
  await A.cmd('room_kick', { room: g, peer: sc.me.peer });
  await C.until(e => e.ev === 'room_removed' && e.room === g, 15000);
  ok(true, 'кик: C убран из хаты');
  const net = await A.cmd('net');
  ok(net.online.length >= 1, 'net: онлайн ' + net.online.map(o => o.nick + ':' + o.via + ':' + o.rtt).join(', '));
  console.log('ВСЁ ОК');
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { P.forEach(p => p.kill()); await sleep(200); process.exit(); }
