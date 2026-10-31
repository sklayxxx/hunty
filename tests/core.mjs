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
  // v0.2: ответы, реакции, правка, удаление, «удалить у себя», вложения, хранилище
  const m2 = await B.cmd('send', { room: dmA.id, text: 'ну привет', reply: m1.id });
  const g2 = await A.until(e => e.ev === 'msg' && e.msg.id === m2.id);
  ok(g2.msg.rp && g2.msg.rp.id === m1.id && g2.msg.rp.text === 'привет, бро', 'ответ с цитатой');
  await B.cmd('react', { room: dmA.id, id: m1.id, e: '🔥' });
  const rx = await A.until(e => e.ev === 'msg_upd' && e.id === m1.id && e.msg && (e.msg.reacts || []).some(r => r.e === '🔥'));
  ok(rx.msg.reacts[0].p[0] === sb.me.peer, 'реакция дошла');
  await B.cmd('react', { room: dmA.id, id: m1.id, e: '🔥' });
  await A.until(e => e.ev === 'msg_upd' && e.id === m1.id && e.msg && !(e.msg.reacts || []).length);
  ok(true, 'повторная реакция снимает её');
  await A.cmd('edit', { room: dmA.id, id: m1.id, text: 'привет, бро!' });
  const ed = await B.until(e => e.ev === 'msg_upd' && e.id === m1.id && e.msg && e.msg.edited);
  ok(ed.msg.text === 'привет, бро!', 'правка дошла');
  await sleep(300);
  ok((await B.cmd('msgs', { room: dmA.id })).msgs.find(m => m.id === m2.id).rp.text === 'привет, бро!', 'цитата тоже видит правку');
  let bad = ''; try { await B.cmd('edit', { room: dmA.id, id: m1.id, text: 'взлом' }); } catch (e) { bad = e.message; }
  ok(bad, 'чужое не редактируется: ' + bad);
  bad = ''; try { await B.cmd('del', { room: dmA.id, id: m1.id }); } catch (e) { bad = e.message; }
  ok(bad, 'чужое у всех не удаляется: ' + bad);
  await A.cmd('del', { room: dmA.id, id: m1.id });
  await B.until(e => e.ev === 'msg_upd' && e.id === m1.id && e.msg === null);
  const hB = await B.cmd('msgs', { room: dmA.id });
  ok(!hB.msgs.some(m => m.id === m1.id) && hB.msgs.find(m => m.id === m2.id).rp.gone, 'удаление у всех; цитата → «сообщение удалено»');
  await B.cmd('msg_hide', { room: dmA.id, id: m2.id });
  ok(!(await B.cmd('msgs', { room: dmA.id })).msgs.some(m => m.id === m2.id) && (await A.cmd('msgs', { room: dmA.id })).msgs.some(m => m.id === m2.id), '«удалить у себя» не трогает собеседника');
  const png = 'data:image/png;base64,' + Buffer.alloc(6000, 7).toString('base64');
  const im = await A.cmd('send', { room: dmA.id, kind: 'image', text: 'скрин', data: { src: png, name: 'x.png', w: 10, h: 10 } });
  const gi = await B.until(e => e.ev === 'msg' && e.msg.id === im.id);
  ok(gi.msg.data.ref && !gi.msg.data.src, 'картинка пришла без base64 в событии (ref)');
  const md = await B.cmd('media', { room: dmA.id, id: im.id });
  ok(md.mime === 'image/png' && md.b64 === png.split(',')[1], 'media отдаёт вложение');
  const st1 = await B.cmd('storage');
  const sr = st1.rooms.find(r => r.room === dmA.id);
  ok(sr && sr.bytes > 8000 && sr.media === 1 && st1.total >= sr.bytes, `хранилище: ${sr.bytes} байт, файлов ${sr.media}`);
  const cl = await B.cmd('room_clear', { room: dmA.id });
  ok(cl.freed > 8000 && (await B.cmd('msgs', { room: dmA.id })).msgs.length === 0, 'очистка истории освободила ' + cl.freed + ' байт');
  // ники
  const n1 = await C.cmd('nick_check', { nick: 'anton' });
  ok(n1.state === 'nodht', 'nick_check без DHT у незнакомого C: ' + n1.state);
  ok((await A.cmd('nick_check', { nick: 'anton' })).state === 'mine', 'свой ник — mine');
  ok((await A.cmd('nick_check', { nick: 'Ж' })).state === 'bad', 'кривой ник — bad');
  ok((await B.cmd('nick_check', { nick: 'anton' })).state === 'taken', 'ник друга занят');
  bad = ''; try { await B.cmd('profile_set', { nick: 'anton' }); } catch (e) { bad = e.message; }
  ok(bad.includes('занят'), 'занятый ник не взять: ' + bad);
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
  // блок
  await A.cmd('block', { peer: sb.me.peer });
  await B.until(e => e.ev === 'friend_removed' && e.peer === sa.me.peer, 15000);
  ok(!(await A.cmd('state')).friends?.some?.(f => f.peer === sb.me.peer), 'блок: дружба снята у обоих');
  const blk = await B.cmd('send', { room: dmA.id, text: 'ты меня слышишь?' });
  await sleep(2000);
  ok(!A.evs.some(e => (e.ev === 'msg' && e.msg.id === blk.id) || (e.ev === 'msgs' && e.msgs.some(m => m.id === blk.id))), 'сообщения от заблокированного не доходят');
  const ub = await A.cmd('unblock', { peer: sb.me.peer });
  ok(!ub.blocked.some(b => b.peer === sb.me.peer), 'разблокировка');
  const net = await A.cmd('net');
  ok(net.online.length >= 1, 'net: онлайн ' + net.online.map(o => o.nick + ':' + o.via + ':' + o.rtt).join(', '));
  console.log('ВСЁ ОК');
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { P.forEach(p => p.kill()); await sleep(200); process.exit(); }
