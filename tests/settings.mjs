// Настройки — проверка каждой функции: меняем через интерфейс → смотрим, что реально сработало → переживает перезагрузку.
// Запуск: node tests/settings.mjs [acc] [audio] [video] [share] [look] [notif] [keys] [priv] [storage] [net] [about] [reload] [call]
// (без аргументов — всё). Переменные: CHROMIUM, PLAYWRIGHT_FROM — как в tests/ui.mjs. Код выхода 1 — что-то не сработало.
import { createRequire } from 'node:module';
import { rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { node, client, sleep, BASE } from './lib.mjs';
const { chromium } = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url)('playwright');
const UI = fileURLToPath(new URL('../ui', import.meta.url));
const ARGS = process.argv.slice(2), only = s => !ARGS.length || ARGS.includes(s);
// короткий бип 0,4 сек — для «Свой звук» в саундборде
const WAV = (() => { const n = 3200, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8000 * 2 * Math.PI * 660) * 12000), 44 + i * 2); return b; })();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAYElEQVR42u3WwQnAIAwF0C/UXRzRERy7CzRHbaEveIo5PAiE35LRk6c3i/7aOn+l51MFBAR0ADSLr1X0985bGRDQH0Hv3Jtq3sqAgOQheQgICEgesjIgIHlIHgICAjpaN0iBFDTVYH+/AAAAAElFTkSuQmCC', 'base64');
rmSync(BASE, { recursive: true, force: true });
const web = (http, port) => ['--http', String(http), '--ui', UI, '--port', String(port)];
const nodes = [node('anton', 7621, web(8621, 47621)), node('vasyan', 7622, web(8622, 47622))];
process.on('exit', () => nodes.forEach(p => p.kill()));
const A = await client(7621, 'A'), B = await client(7622, 'B');
const sa = await A.cmd('state'), sb = await B.cmd('state');
await B.cmd('friend_add', { code: (await A.cmd('friend_code')).code });
await A.until(e => e.ev === 'friend' && e.friend.peer === sb.me.peer && e.friend.state === 'incoming');
await A.cmd('friend_accept', { peer: sb.me.peer });
await B.until(e => e.ev === 'friend' && e.friend.peer === sa.me.peer && e.friend.state === 'friend');
const dm = await A.cmd('dm_open', { peer: sb.me.peer }); const dmB = await B.cmd('dm_open', { peer: sa.me.peer });
for (const t of ['здарова', 'го вечером в майн?']) await A.cmd('send', { room: dm.id, text: t });
const grp = await A.cmd('room_create', { name: 'кухня', members: [sb.me.peer] });
const gB = (await B.until(e => e.ev === 'room' && e.room.kind === 'group' && e.room.name === 'кухня')).room;
await B.cmd('send', { room: gB.id, text: 'кто на созвон?' });
console.log('узлы готовы: anton ⇄ vasyan, личка + группа «кухня»');

const br = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await br.newContext({ viewport: { width: 1280, height: 820 }, acceptDownloads: true });
for (const origin of ['http://127.0.0.1:8621', 'http://127.0.0.1:8622']) await ctx.grantPermissions(['clipboard-read', 'clipboard-write', 'microphone', 'camera'], { origin });
await ctx.addInitScript(() => {
  try { const p = JSON.parse(localStorage.getItem('hunty-prefs') || '{}'); if (!('boot' in p)) localStorage.setItem('hunty-prefs', JSON.stringify({ ...p, boot: false })); } catch (_) {}
  // что сказал голос уведомлений — записываем, а не говорим
  window.__said = []; try { speechSynthesis.speak = u => window.__said.push(u.text); } catch (_) {}
  // «экран» для демки — живой холст вместо системного окна выбора
  navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); setInterval(() => { x.fillStyle = '#123'; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#7ee2b8'; x.fillRect((Date.now() / 4) % 1200, 300, 80, 80); }, 50); return c.captureStream(30); };
});
const errs = [];
const P = await ctx.newPage(); P.setDefaultTimeout(8000);
P.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text()); });
P.on('pageerror', e => errs.push('pageerror: ' + e.message));
await P.goto('http://127.0.0.1:8621/?ws=7621&noboot'); await P.waitForSelector('.js-chats .ci'); await sleep(1200);
await P.mouse.click(640, 400); // первый клик — чтобы ожил AudioContext

const RES = [];
const ok = (n, c, x = '') => { RES.push([n, !!c]); console.log((c ? '✓ ' : '✗ ') + n + (!c && x !== '' ? '  — ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); return !!c; };
const SW = '.win[data-win="settings"]';
const pr = k => P.evaluate(k => import('/js/core.js').then(m => m.prefs[k]), k);
const saved = k => P.evaluate(k => JSON.parse(localStorage.getItem('hunty-prefs') || '{}')[k], k);
const hcl = c => P.evaluate(c => document.documentElement.classList.contains(c), c);
const cssv = v => P.evaluate(v => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), v);
const txt = s => P.locator(s).first().textContent().then(t => (t || '').trim()).catch(() => '');
const vis = s => P.locator(s).first().isVisible().catch(() => false);
const snack = () => txt('.snack .mt');
const journal = re => P.evaluate(re => import('/js/ui.js').then(m => m.JOURNAL.slice(-12).some(j => new RegExp(re).test(j.text))), re);
const me = async () => (await A.cmd('state')).me.profile;
const cfg = async () => (await A.cmd('state')).config;
const until = async (f, ms = 5000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await f(); if (v) return v; await sleep(150); } return v; };
async function open(t) {
  if (!(await vis(SW + '.on'))) { await P.click('.js-meset'); await P.waitForSelector(SW + '.on'); await sleep(250); }
  await P.click(`${SW} .js-snav [data-tab="${t}"]`); await sleep(350);
}
async function close() { if (await vis(SW + '.on')) { await P.keyboard.press('Escape'); await sleep(300); } }
const el = s => { const l = P.locator(s).first(); return l.scrollIntoViewIfNeeded().then(() => l); };
const click = async s => { await (await el(s)).click(); await sleep(220); };
const seg = (k, v) => click(`${SW} .seg[data-pref="${k}"] button[data-v="${v}"]`);
const tg = k => click(`${SW} input[data-pref="${k}"]`);
const press = async (s, key) => { const l = await el(s); await l.focus(); await P.keyboard.press(key); await sleep(180); };
const rg = (k, key) => press(`${SW} input.rg[data-pref="${k}"]`, key);
const file = async (trigger, buf, name = 'pic.png', mimeType = 'image/png') => {
  const [fc] = await Promise.all([P.waitForEvent('filechooser'), typeof trigger === 'string' ? click(trigger) : trigger()]);
  await fc.setFiles({ name, mimeType, buffer: buf }); await sleep(700);
};
const clip = () => P.evaluate(() => navigator.clipboard.readText()).catch(() => '');
const section = async (name, f) => { if (!only(name)) return; console.log('\n— ' + name); try { await f(); } catch (e) { ok(name + ': без исключений', false, e.message.split('\n')[0]); } };

/* ===================== Акк ===================== */
await section('acc', async () => {
  await open('acc');
  await click(`${SW} .js-accava`); await P.click('.cmenu >> text=Выбрать моба'); await sleep(300);
  ok('аватар: «Выбрать моба» открывает сетку', await vis(`${SW} .js-mobgrid`));
  const mob = await P.locator(`${SW} .js-mobgrid [data-mob]`).nth(4).getAttribute('data-mob');
  await click(`${SW} .js-mobgrid [data-mob="${mob}"]`);
  ok('аватар: выбранный моб ушёл в профиль', await until(async () => (await me()).ava === 'mob:' + mob), (await me()).ava);
  ok('аватар: внизу у ника тоже сменился', await until(async () => (await P.getAttribute('.js-meava', 'src')) === (await P.getAttribute(`${SW} .js-mobgrid [data-mob="${mob}"] img`, 'src'))));
  await click(`${SW} .js-mobrnd`); await sleep(1600);
  const rnd = (await me()).ava; ok('аватар: «Случайный моб» выдаёт другого', /^mob:/.test(rnd) && rnd !== 'mob:' + mob, rnd);
  await click(`${SW} .js-accava`);
  await file(() => P.click('.cmenu >> text=Своя картинка'), PNG);
  ok('аватар: своя картинка ужата и сохранена', await until(async () => /^data:image\//.test((await me()).ava || '')), String((await me()).ava).slice(0, 30));
  const sw2 = await P.locator(`${SW} .js-sw button[data-c]`).nth(2).getAttribute('data-c');
  await click(`${SW} .js-sw button[data-c="${sw2}"]`);
  ok('цвет ника: образец', await until(async () => (await me()).color === sw2), (await me()).color);
  await P.locator(`${SW} .js-swpick`).evaluate(e => { e.value = '#ff3d7f'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
  ok('цвет ника: свой цвет из пипетки', await until(async () => (await me()).color === '#ff3d7f'), (await me()).color);
  ok('цвет ника: применился к интерфейсу (--me)', (await P.evaluate(() => document.documentElement.style.getPropertyValue('--me'))) === '#ff3d7f');
  const ban = await P.locator(`${SW} .js-bans [data-b^="g:"]`).nth(1).getAttribute('data-b');
  await click(`${SW} .js-bans [data-b="${ban}"]`);
  ok('шапка профиля: градиент', await until(async () => (await me()).banner === ban), (await me()).banner);
  await file(`${SW} .js-banup`, PNG);
  ok('шапка профиля: своя картинка', await until(async () => /^data:image\//.test((await me()).banner || '')));
  const st = await el(`${SW} .js-statusinp`); await st.fill('проверяю настройки'); await P.keyboard.press('Enter');
  ok('статус: сохранился', await until(async () => (await me()).line === 'проверяю настройки'), (await me()).line);
  ok('статус: виден внизу под ником', await until(async () => (await txt('.js-mestatus')) === 'проверяю настройки'), await txt('.js-mestatus'));
  const bio = await el(`${SW} .js-bio`); await bio.fill('люблю майн и редстоун'); await st.focus(); await sleep(400);
  ok('о себе: сохранилось', await until(async () => (await me()).bio === 'люблю майн и редстоун'), (await me()).bio);
  ok('о себе: счётчик символов', (await txt(`${SW} .js-bioc`)) === '21 / 190', await txt(`${SW} .js-bioc`));
  ok('превью «так тебя видят друзья» обновляется', await until(async () => { const t = await txt(`${SW} .js-accprev`); return /люблю майн/.test(t) && /проверяю настройки/.test(t); }), await txt(`${SW} .js-accprev`));
  await click(`${SW} .js-renick`);
  ok('ник: открывается окно смены ника', await until(() => vis('.win[data-win="onboard"].on')));
  await P.keyboard.press('Escape'); await sleep(400); await open('acc');
  const code = await P.getAttribute(`${SW} .js-mycodec`, 'data-copy');
  await click(`${SW} .js-mycodec`);
  ok('код для друзей: копируется', (await clip()) === code && code.length > 8, [String(await clip()).slice(0, 20), code.slice(0, 20)]);
  await click(`${SW} .js-mypeerc`);
  ok('ключ: копируется', (await clip()) === sa.me.peer, await clip());
  const [dl] = await Promise.all([P.waitForEvent('download'), click(`${SW} .js-bexport`)]);
  let bk = null; try { bk = JSON.parse(readFileSync(await dl.path(), 'utf8')); } catch (_) {}
  ok('бэкап: выгружается файл с ключом акка', bk && bk.hunty_backup && bk.peer === sa.me.peer && /\.hunty\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await file(`${SW} .js-bimport`, Buffer.from('{"hello":1}'), 'x.hunty.json', 'application/json');
  ok('бэкап: чужой файл не принимается', /не бэкап Hunty/.test(await snack()), await snack());
});

/* ===================== Звук и мик ===================== */
await section('audio', async () => {
  await open('audio');
  ok('проверка мика: полоска ожила', await until(() => P.evaluate(() => document.querySelector('.js-mtest').classList.contains('on')), 6000), await txt(`${SW} .js-mtst`));
  const mics = await P.locator(`${SW} select[data-pref="micId"] option`).evaluateAll(o => o.map(x => x.value));
  ok('микрофон: список устройств', mics.length >= 2, mics);
  if (mics[1]) {
    await (await el(`${SW} select[data-pref="micId"]`)).selectOption(mics[1]); await sleep(300);
    ok('микрофон: выбор запоминается', (await pr('micId')) === mics[1] && (await saved('micId')) === mics[1]);
    ok('микрофон: проверка перезапустилась на новом', await until(() => P.evaluate(() => document.querySelector('.js-mtest').classList.contains('on')), 6000));
    await (await el(`${SW} select[data-pref="micId"]`)).selectOption(''); await sleep(300);
  }
  const outs = await P.locator(`${SW} select[data-pref="outId"] option`).evaluateAll(o => o.map(x => x.value));
  ok('наушники: выбор вывода доступен (Chromium/WebView2)', !(await P.locator(`${SW} select[data-pref="outId"]`).isDisabled()) && outs.length >= 1, outs);
  await rg('micVol', 'End'); ok('громкость мика: до 200%', (await pr('micVol')) === 200 && (await txt(`${SW} input[data-pref="micVol"] + .rgv`)) === '200%');
  await (await el(`${SW} input[data-pref="micVol"]`)).dblclick(); await sleep(200);
  ok('ползунок: двойной клик — обратно по умолчанию', (await pr('micVol')) === 100, await pr('micVol'));
  await rg('outVol', 'Home'); ok('громкость звука: 0%', (await pr('outVol')) === 0); await rg('outVol', 'End');
  await tg('earGuard'); ok('беречь уши: выкл', (await pr('earGuard')) === false); await tg('earGuard'); ok('беречь уши: вкл', (await pr('earGuard')) === true);
  await click(`${SW} .js-gauto`);
  ok('чувствительность: ручной режим открывает ползунок', (await pr('gate')) === 'manual' && !(await P.locator(`${SW} .js-sensrg`).isDisabled()));
  await press(`${SW} .js-sensrg`, 'ArrowRight'); await press(`${SW} .js-sensrg`, 'ArrowRight');
  const gdb = await pr('gateDb');
  ok('чувствительность: порог двигается и подписан', gdb === -48 && (await txt(`${SW} .js-sensv`)) === 'порог -48 дБ', [gdb, await txt(`${SW} .js-sensv`)]);
  await click(`${SW} .js-gauto`);
  ok('чувствительность: снова авто, ползунок заблокирован', (await pr('gate')) === 'auto' && (await P.locator(`${SW} .js-sensrg`).isDisabled()));
  await click(`${SW} .js-loop`);
  ok('«Слышать себя»: включается', (await P.getAttribute(`${SW} .js-loop`, 'aria-pressed')) === 'true');
  await click(`${SW} .js-loop`);
  ok('«Слышать себя»: выключается', (await P.getAttribute(`${SW} .js-loop`, 'aria-pressed')) === 'false');
  await click(`${SW} .js-rec`);
  ok('запись 5 сек: пошла', /Запись…/.test(await txt(`${SW} .js-rec`)), await txt(`${SW} .js-rec`));
  ok('запись 5 сек: потом проигрывается и кнопка возвращается', await until(async () => /Слушаем|Запись 5 сек/.test(await txt(`${SW} .js-rec`)) && !/Запись…/.test(await txt(`${SW} .js-rec`)), 9000), await txt(`${SW} .js-rec`));
  await click(`${SW} .js-micfix`);
  ok('«Меня плохо слышат»: открывается мастер', await until(() => vis('.win[data-win="micfix"].on')));
  await P.keyboard.press('Escape'); await sleep(400); await open('audio');
  await seg('ptt', '1');
  ok('режим мика: рация показывает клавишу', (await pr('ptt')) === 1 && await vis(`${SW} .js-pttrow`));
  await click(`${SW} .js-pttkey`); await P.keyboard.press('KeyB'); await sleep(300);
  ok('рация: своя клавиша назначается', (await pr('keys')).ptt === 'KeyB' && (await txt(`${SW} .js-pttkey`)) === 'B', [(await pr('keys')).ptt, await txt(`${SW} .js-pttkey`)]);
  await seg('ptt', '0'); ok('режим мика: голосом — клавиша спрятана', (await pr('ptt')) === 0 && !(await vis(`${SW} .js-pttrow`)));
  await seg('nsMode', 'std'); ok('шумодав: обычный', (await pr('nsMode')) === 'std' && /обычный/.test(await txt(`${SW} .js-nssub`)), await txt(`${SW} .js-nssub`));
  await seg('nsMode', 'off'); ok('шумодав: выкл', (await pr('nsMode')) === 'off' && /без обработки/.test(await txt(`${SW} .js-nssub`)));
  await seg('nsMode', 'rnnoise'); await sleep(800);
  ok('шумодав: умный (RNNoise) грузится', (await pr('nsMode')) === 'rnnoise' && /умный/.test(await txt(`${SW} .js-nssub`)) && !/не запустился/.test(await txt(`${SW} .js-nssub`)), await txt(`${SW} .js-nssub`));
  await tg('ec'); ok('эхоподавление: выкл', (await pr('ec')) === false); await tg('ec');
  await tg('agc'); ok('автогромкость: выкл', (await pr('agc')) === false); await tg('agc');
  await seg('bitrate', '128'); ok('качество голоса: 128', (await pr('bitrate')) === 128);
  const fx = await P.locator(`${SW} .js-fxgrid [data-fx]`).nth(2).getAttribute('data-fx');
  await click(`${SW} .js-fxgrid [data-fx="${fx}"]`);
  ok('эффект голоса: выбирается', (await pr('fx')) === fx && (await P.getAttribute(`${SW} .js-fxgrid [data-fx="${fx}"]`, 'aria-checked')) === 'true', fx);
  ok('эффект голоса: виден на кнопке мика внизу', await P.evaluate(() => { const b = document.querySelector('.js-memic'); return b.classList.contains('fx') && /эффект/.test(b.title); }));
  await click(`${SW} .js-fxgrid [data-fx=""]`); ok('эффект голоса: выключается', (await pr('fx')) === '');
  await rg('sbVol', 'Home'); ok('громкость звуков саундборда: 0', (await pr('sbVol')) === 0); await (await el(`${SW} input[data-pref="sbVol"]`)).dblclick(); await sleep(150);
  const sbn = await P.locator(`${SW} .js-sbset button[data-sb], ${SW} .js-sbset .sbb`).count();
  ok('саундборд: звуки на месте', sbn >= 4, sbn);
  await file(`${SW} .js-sbset [data-sbadd]`, WAV, 'бип.wav', 'audio/wav'); await sleep(500);
  ok('саундборд: «Свой звук» добавляется', await until(async () => (await txt(`${SW} .js-sbset .sbt.own span`)) === 'бип', 4000), await txt(`${SW} .js-sbset .sbt.own`));
  await click(`${SW} .js-sbset .sbt.own`);
  ok('саундборд: свой звук играет (послушать)', await until(() => P.evaluate(() => !!document.querySelector('.win[data-win="settings"] .js-sbset .sbt.own.play')), 2000));
  await click(`${SW} .js-sbset .sbt.own [data-sbdel]`); await P.click('.js-askok'); await sleep(600);
  ok('саундборд: свой звук удаляется', !(await vis(`${SW} .js-sbset .sbt.own`)));
});

/* ===================== Вебка ===================== */
await section('video', async () => {
  await open('video');
  const cams = await P.locator(`${SW} select[data-pref="camId"] option`).evaluateAll(o => o.map(x => x.value));
  ok('камера: список устройств', cams.length >= 2, cams);
  await click(`${SW} .js-camtest`);
  ok('превью: включается и показывает картинку', await until(() => P.evaluate(() => { const v = document.querySelector('.js-camprev'); return v.srcObject && v.videoWidth > 0; }), 6000));
  ok('превью: подпись 720p', /720p/.test(await txt(`${SW} .js-camtag`)), await txt(`${SW} .js-camtag`));
  await seg('camRes', '360');
  ok('качество: 360p — превью перезапускается', await until(async () => /360p/.test(await txt(`${SW} .js-camtag`)), 6000), await txt(`${SW} .js-camtag`));
  ok('качество: реальная картинка 360 строк', await until(() => P.evaluate(() => document.querySelector('.js-camprev').videoHeight === 360), 4000), await P.evaluate(() => document.querySelector('.js-camprev').videoHeight));
  await seg('camRes', '720');
  await tg('camMirror'); ok('зеркалить: выкл', (await pr('camMirror')) === false && !(await P.evaluate(() => document.querySelector('.js-camv').classList.contains('mir'))));
  await tg('camMirror'); ok('зеркалить: вкл', (await pr('camMirror')) === true && (await P.evaluate(() => document.querySelector('.js-camv').classList.contains('mir'))));
  if (cams[1]) { await (await el(`${SW} select[data-pref="camId"]`)).selectOption(cams[1]); await sleep(1200); ok('камера: выбор запоминается, превью живое', (await pr('camId')) === cams[1] && await until(() => P.evaluate(() => document.querySelector('.js-camprev').videoWidth > 0), 5000)); await (await el(`${SW} select[data-pref="camId"]`)).selectOption(''); await sleep(800); }
  await click(`${SW} .js-camtest`);
  ok('превью: выключается', /выключено/.test(await txt(`${SW} .js-camtag`)) && await P.evaluate(() => !document.querySelector('.js-camprev').srcObject));
  await open('acc'); await sleep(200); await open('video');
  ok('превью: уходя с вкладки, камера гасится', await P.evaluate(() => !document.querySelector('.js-camprev').srcObject));
});

/* ===================== Демка ===================== */
await section('share', async () => {
  await open('share');
  await seg('shareRes', '720'); await seg('shareFps', '60'); await tg('shareAudio');
  await (await el(`${SW} select[data-pref="shareDraw"]`)).selectOption('none'); await sleep(200);
  await seg('pinTtl', '0'); await seg('shareHint', 'motion'); await tg('clips'); await seg('clipSec', '60');
  const got = {}; for (const k of ['shareRes', 'shareFps', 'shareAudio', 'shareDraw', 'pinTtl', 'shareHint', 'clips', 'clipSec']) got[k] = await saved(k);
  ok('демка: все пункты сохраняются', JSON.stringify(got) === JSON.stringify({ shareRes: 720, shareFps: 60, shareAudio: true, shareDraw: 'none', pinTtl: 0, shareHint: 'motion', clips: false, clipSec: 60 }), got);
  ok('демка: окно «Показать экран» берёт эти значения', await P.evaluate(async () => { const { shareProfile } = await import('/js/voice.js'); const q = shareProfile(); return q.res === 720 && q.fps === 60 && q.motion; }));
  ok('клипы: подпись хоткея знает длину (60 сек)', await P.evaluate(() => /60 сек/.test(document.querySelector('.js-clip').title)), await P.evaluate(() => document.querySelector('.js-clip').title));
  await open('keys');
  ok('клипы: в «Хоткеях» тоже 60 секунд', /60 секунд/.test(await txt(`${SW} .js-klist .kbind[data-id="clip"] small`)), await txt(`${SW} .js-klist .kbind[data-id="clip"] small`));
  await open('share');
  await seg('shareRes', '1080'); await seg('shareFps', '30'); await tg('shareAudio'); await (await el(`${SW} select[data-pref="shareDraw"]`)).selectOption('all');
  await seg('pinTtl', '10'); await seg('shareHint', 'detail'); await tg('clips'); await seg('clipSec', '30');
});

/* ===================== Внешний вид ===================== */
const paneBg = () => P.evaluate(() => getComputedStyle(document.querySelector('.pane.glass.chat')).backgroundColor);
const paneBlur = () => P.evaluate(() => getComputedStyle(document.querySelector('.pane.glass.chat')).backdropFilter);
await section('look', async () => {
  await open('look');
  await click(`${SW} .js-fonts [data-f="mono"]`);
  ok('шрифт: меняется во всём интерфейсе', (await P.evaluate(() => document.documentElement.dataset.font)) === 'mono' && (await saved('font')) === 'mono');
  await click(`${SW} .js-fonts [data-f="soft"]`);
  await rg('msgSize', 'End');
  ok('размер текста: 19 px в сообщениях', (await P.evaluate(() => document.documentElement.style.getPropertyValue('--mfs'))) === '19px' && (await P.evaluate(() => getComputedStyle(document.querySelector('.log .mtxt, .log .tx, .log .mb') || document.body).fontSize)) !== '', await P.evaluate(() => document.documentElement.style.getPropertyValue('--mfs')));
  await (await el(`${SW} input[data-pref="msgSize"]`)).dblclick(); await sleep(150);
  await tg('fxMsg'); ok('эффекты сообщений: выкл', (await saved('fxMsg')) === false); await tg('fxMsg');
  // обои
  await click(`${SW} .js-walls [data-w="aurora"]`);
  ok('обои: пресет ложится под стекло', (await hcl('haswall')) && /radial-gradient/.test(await P.evaluate(() => document.querySelector('.js-wall').style.background)));
  ok('обои-пресет: есть «Затемнение», нет бессмысленного «Размытия»', (await vis(`${SW} input[data-pref="wallDim"]`)) && !(await vis(`${SW} input[data-pref="wallBlur"]`)));
  await rg('wallDim', 'End'); ok('затемнение: применяется', (await P.evaluate(() => document.querySelector('.js-wall').style.getPropertyValue('--wd'))) === '0.90');
  ok('затемнение: пока тянешь — под окном видно приложение', await P.evaluate(() => document.querySelector('.wback').classList.contains('peek')));
  await (await el(`${SW} input[data-pref="wallDim"]`)).dblclick(); await sleep(150);
  await click(`${SW} .js-walls [data-w="glow"]`);
  ok('обои «Свечение»: старый фон с пятнами', (await hcl('wglow')) && !(await hcl('haswall')) && await vis(`${SW} input[data-pref="liveBg"]`));
  await tg('liveBg'); ok('живой фон: пятна плавают', await hcl('bglive')); await tg('liveBg'); ok('живой фон: выкл', !(await hcl('bglive')));
  await file(`${SW} .js-walladd`, PNG);
  ok('обои: своя картинка', (await saved('wall')) === 'img' && (await hcl('haswall')) && /url\(/.test(await P.evaluate(() => document.querySelector('.js-wall').style.background)) && await vis(`${SW} .js-walls .wl.own`));
  ok('своя картинка: есть «Размытие картинки»', await vis(`${SW} input[data-pref="wallBlur"]`));
  await rg('wallBlur', 'End'); ok('размытие картинки: применяется', (await P.evaluate(() => document.querySelector('.js-wall').style.getPropertyValue('--wb'))) === '60px');
  await (await el(`${SW} input[data-pref="wallBlur"]`)).dblclick(); await sleep(150);
  // стекло
  await click(`${SW} .js-glassmode [data-g="matte"]`); ok('стекло: матовое', !(await hcl('lg')) && (await saved('glass')) === 'matte');
  await click(`${SW} .js-glassmode [data-g="liquid"]`); ok('стекло: жидкое (преломление)', (await hcl('lg')) && (await saved('glass')) === 'liquid');
  await rg('glassA', 'Home'); const a0 = await paneBg();
  await rg('glassA', 'End'); const a100 = await paneBg();
  const al = s => +((s.match(/rgba?\([^)]*,\s*([\d.]+)\)$/) || [])[1] ?? 1);
  ok('прозрачность: 0% — почти сплошное, 100% — почти прозрачное', al(a0) >= .9 && al(a100) <= .12, [a0, a100]);
  ok('прозрачность: окна тоже', (await cssv('--wa')) === '0.420', await cssv('--wa'));
  await (await el(`${SW} input[data-pref="glassA"]`)).dblclick(); await sleep(150);
  ok('прозрачность: по умолчанию как было (60%)', (await pr('glassA')) === 60 && Math.abs(al(await paneBg()) - .43) < .01, await paneBg());
  await rg('glassBlur', 'Home'); ok('матовость 0: без размытия', /blur\(0px\)/.test(await paneBlur()), await paneBlur());
  await rg('glassBlur', 'End'); ok('матовость 100: размытие вдвое сильнее', /blur\(60px\)/.test(await paneBlur()), await paneBlur());
  await (await el(`${SW} input[data-pref="glassBlur"]`)).dblclick(); await sleep(150);
  ok('матовость: по умолчанию как было', /blur\(30px\)/.test(await paneBlur()) && (await pr('glassBlur')) === 50, await paneBlur());
  await rg('scale', 'End'); ok('масштаб: 130%', (await P.evaluate(() => document.querySelector('.app').style.zoom)) === '1.3', await P.evaluate(() => document.querySelector('.app').style.zoom));
  await rg('scale', 'Home'); ok('масштаб: 80%', (await P.evaluate(() => document.querySelector('.app').style.zoom)) === '0.8');
  await (await el(`${SW} input[data-pref="scale"]`)).dblclick(); await sleep(200); ok('масштаб: 100%', (await P.evaluate(() => document.querySelector('.app').style.zoom)) === '');
  const sideX = () => P.evaluate(() => { const l = document.querySelector('.pane.list').getBoundingClientRect(), c = document.querySelector('.pane.chat').getBoundingClientRect(); return l.left > c.left ? 'right' : 'left'; });
  ok('список друзей: по умолчанию справа', (await hcl('sr')) && (await sideX()) === 'right');
  await seg('side', 'left'); await sleep(300); ok('список друзей: слева', !(await hcl('sr')) && (await sideX()) === 'left' && (await saved('side')) === 'left');
  await seg('side', 'right'); await sleep(300); ok('список друзей: снова справа', (await hcl('sr')) && (await sideX()) === 'right');
  await tg('lite');
  ok('лёгкий режим: без стекла и анимаций', (await hcl('lite')) && /none/.test(await paneBlur()), await paneBlur());
  ok('лёгкий режим: ползунки стекла погашены с пояснением', (await P.locator(`${SW} .js-glrow.na`).count()) === 3 && await vis(`${SW} .js-glnote`));
  await tg('lite'); ok('лёгкий режим: выкл — стекло вернулось', !(await hcl('lite')) && (await P.locator(`${SW} .js-glrow.na`).count()) === 0);
  await tg('boot'); ok('загрузочный экран: вкл', (await saved('boot')) === true); await tg('boot');
  // AFK-мобы
  await click(`${SW} .js-afkwho [data-w="off"]`);
  ok('AFK: «Никто» запоминается', (await P.evaluate(() => JSON.parse(localStorage.getItem('hunty-afk') || '{}').who)) === 'off');
  await click(`${SW} .js-afkwho [data-w="queue"]`);
  await click(`${SW} .js-steve-after button >> nth=0`);
  ok('AFK: «Приходит через» запоминается', (await P.evaluate(() => JSON.parse(localStorage.getItem('hunty-afk') || '{}').after)) === +(await P.getAttribute(`${SW} .js-steve-after button >> nth=0`, 'data-s')));
  await click(`${SW} .js-steve-speed button >> nth=0`);
  ok('AFK: «Темп» запоминается', (await P.evaluate(() => JSON.parse(localStorage.getItem('hunty-afk') || '{}').speed)) === +(await P.getAttribute(`${SW} .js-steve-speed button >> nth=0`, 'data-v')));
  const q1 = await P.locator(`${SW} .js-afkq [data-m]`).nth(2).getAttribute('data-m');
  await click(`${SW} .js-afkq [data-m="${q1}"]`);
  ok('AFK: клик по очереди — придёт он', (await P.getAttribute(`${SW} .js-afkq [data-m="${q1}"]`, 'aria-pressed')) === 'true');
  await click(`${SW} .js-steve-now`); await sleep(4300);
  ok('AFK: «Позвать» — моб приходит через 3 сек тишины', await P.evaluate(() => !document.querySelector('.js-mc').hidden));
  await P.mouse.move(600, 420); await P.mouse.move(640, 400); await sleep(400);
  await open('look'); await click(`${SW} .js-steve-after button[data-s="60"]`).catch(() => {}); await click(`${SW} .js-steve-speed button[data-v="3"]`).catch(() => {});
  await click(`${SW} .js-walls [data-w=""]`); ok('обои: чёрный', !(await hcl('haswall')) && !(await hcl('wglow')));
});

/* ===================== Уведомления ===================== */
const sfxOn = c => P.evaluate(c => import('/js/ui.js').then(m => m.sfxOn(c)), c);
const msgToasts = () => P.locator('.toast.msgt').count();
const said = () => P.evaluate(() => window.__said.slice());
async function fromVasya(text, room = gB.id) { await B.cmd('send', { room, text }); await sleep(1300); }
await section('notif', async () => {
  // смотрим личку — сообщения в «кухне» должны уведомлять
  await close(); await P.locator('.js-chats .ci').filter({ has: P.locator('.nm', { hasText: /^vasyan$/ }) }).first().click(); await sleep(400);
  await open('notif');
  await tg('sound'); ok('звук уведомлений: выкл гасит все звуки', (await saved('sound')) === false && !(await sfxOn('msg')) && await P.evaluate(() => document.querySelector('.js-sfxcats').classList.contains('off')));
  await tg('sound'); ok('звук уведомлений: вкл', await sfxOn('msg'));
  const cat = await P.locator(`${SW} .js-sfxcats input[data-sfxcat]`).first().getAttribute('data-sfxcat');
  await click(`${SW} .js-sfxcats input[data-sfxcat="${cat}"]`);
  ok('какие звуки: категория выключается', (await saved('sfxOff'))[cat] === true && !(await sfxOn(cat)), cat);
  await click(`${SW} .js-sfxcats input[data-sfxcat="${cat}"]`); ok('какие звуки: и включается', await sfxOn(cat));
  await rg('notifVol', 'End'); ok('громкость уведомлений: 100', (await saved('notifVol')) === 100); await (await el(`${SW} input[data-pref="notifVol"]`)).dblclick(); await sleep(150);
  const vs = await P.locator(`${SW} .js-voices option`).count();
  ok('голос: список голосов (или честно «не найден»)', vs >= 1 && (vs > 1 || /не найден/.test(await P.getAttribute(`${SW} .js-voices`, 'title') || '')));
  await tg('say'); ok('озвучка: вкл (сразу говорит пример)', (await saved('say')) === true && (await said()).some(t => /Привет/.test(t)), await said());
  await close();
  await fromVasya('го в майн');
  ok('озвучка: называет отправителя', (await said()).some(t => /vasyan пишет в кухня/.test(t)), await said());
  ok('сообщение в группе: всплывашка', (await msgToasts()) >= 1);
  await open('notif'); await tg('say'); await tg('mentionsOnly'); await close();
  await P.evaluate(() => document.querySelectorAll('.toast.msgt').forEach(t => t.remove()));
  await fromVasya('просто болтаем');
  ok('только упоминания: обычное сообщение в группе молчит', (await msgToasts()) === 0);
  await fromVasya('@anton ты где?');
  ok('только упоминания: упоминание — уведомляет', (await msgToasts()) >= 1);
  await open('notif'); await tg('mentionsOnly');
  await click(`${SW} .js-dnd button[data-v="60"]`);
  ok('не беспокоить: 1 час — статус сменился', await until(async () => (await me()).status === 'dnd') && (await P.getAttribute(`${SW} .js-dnd button[data-v="60"]`, 'aria-pressed')) === 'true');
  await close(); await P.evaluate(() => document.querySelectorAll('.toast.msgt').forEach(t => t.remove()));
  await fromVasya('@anton срочно');
  ok('не беспокоить: без всплывашек даже на упоминание', (await msgToasts()) === 0);
  await open('notif'); await click(`${SW} .js-dnd button[data-v="-1"]`);
  ok('не беспокоить: «пока не выключу»', await until(async () => (await me()).status === 'dnd') && (await pr('dnd')) > Date.now() + 365 * 864e5);
  await click(`${SW} .js-dnd button[data-v="0"]`);
  ok('не беспокоить: выкл — снова в сети', await until(async () => (await me()).status === '') && (await P.getAttribute(`${SW} .js-dnd button[data-v="0"]`, 'aria-pressed')) === 'true');
  await seg('awayAfter', '5'); ok('«отошёл» сам: 5 мин', (await saved('awayAfter')) === 5); await seg('awayAfter', '10');
  await tg('friendOnline'); ok('друг зашёл в сеть: выкл', (await saved('friendOnline')) === false); await tg('friendOnline');
  ok('мигать в панели задач: в браузере честно выключено', (await P.locator(`${SW} input[data-pref="flash"]`).isDisabled()) && /только в приложении/.test(await P.locator(`${SW} input[data-pref="flash"]`).evaluate(e => e.closest('.row').title)));
});

/* ===================== Хоткеи ===================== */
const V_ = f => P.evaluate(f);
await section('keys', async () => {
  await open('keys');
  ok('хоткеи в играх: в браузере честно выключено', (await P.locator(`${SW} .js-gkeys`).isDisabled()) && /только в приложении/.test(await txt(`${SW} .js-gksub`)), await txt(`${SW} .js-gksub`));
  await click(`${SW} .js-klist .kset[data-id="mic"]`);
  ok('назначение: ждёт клавишу', /нажми клавишу/.test(await txt(`${SW} .js-klist .kset[data-id="mic"]`)));
  await P.keyboard.press('KeyJ'); await sleep(300);
  ok('назначение: клавиша сохранена', (await pr('keys')).mic === 'KeyJ' && (await txt(`${SW} .js-klist .kset[data-id="mic"]`)) === 'J', [(await pr('keys')).mic, await txt(`${SW} .js-klist .kset[data-id="mic"]`)]);
  ok('назначение: появилось «вернуть как было»', await vis(`${SW} .js-klist [data-reset="mic"]`));
  ok('кнопка мика внизу подписана новой клавишей', /· J\b/.test(await P.getAttribute('.js-memic', 'title')), await P.getAttribute('.js-memic', 'title'));
  await close();
  const m0 = await V_(() => import('/js/voice.js').then(m => m.V.mic));
  await P.keyboard.press('KeyJ'); await sleep(300);
  ok('новая клавиша работает: мик переключился', (await V_(() => import('/js/voice.js').then(m => m.V.mic))) === !m0);
  await P.keyboard.press('KeyJ'); await sleep(300);
  await open('keys');
  await click(`${SW} .js-klist .kset[data-id="deaf"]`); await P.keyboard.press('Control+KeyK'); await sleep(300);
  ok('занятое приложением (Ctrl+K) не отдаётся', !(await pr('keys')).deaf && /занято приложением/.test(await snack()), await snack());
  await click(`${SW} .js-klist .kset[data-id="deaf"]`); await P.keyboard.press('KeyJ'); await sleep(300);
  ok('та же клавиша другому действию — у первого снимается', (await pr('keys')).deaf === 'KeyJ' && (await pr('keys')).mic === '', await pr('keys'));
  await click(`${SW} .js-kreset`);
  ok('«Сбросить всё»', JSON.stringify(await pr('keys')) === '{}' && (await txt(`${SW} .js-klist .kset[data-id="mic"]`)) === 'Ctrl+M', await txt(`${SW} .js-klist .kset[data-id="mic"]`));
});

/* ===================== Приватность ===================== */
await section('priv', async () => {
  await open('priv');
  for (const k of ['findable', 'mdns']) {
    const v0 = !!(await cfg())[k];
    await click(`${SW} input[data-cfg="${k}"]`); await sleep(500);
    ok(`${k}: уходит в ядро`, !!(await cfg())[k] === !v0);
    if (k === 'findable') ok('сетевые: просит перезапуск', await vis('.toast >> text=Нужен перезапуск'));
    await click(`${SW} input[data-cfg="${k}"]`); await sleep(400);
    ok(`${k}: и обратно`, !!(await cfg())[k] === v0);
  }
  await P.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  ok('«во что играю»: в браузере честно выключено', await P.locator(`${SW} input[data-pref="gameScan"]`).isDisabled());
  const yt = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  await close(); await P.locator('.js-chats .ci').filter({ has: P.locator('.nm', { hasText: /^vasyan$/ }) }).first().click(); await sleep(300);
  await B.cmd('send', { room: dmB.id, text: 'зацени ' + yt }); await sleep(1200);
  const cards = () => P.locator('.log .lcard').count();
  ok('превью ссылок: вкл — карточка YouTube', (await cards()) >= 1, await cards());
  await open('priv'); await tg('linkPrev'); await close(); await sleep(400);
  ok('превью ссылок: выкл — карточек нет', (await cards()) === 0, await cards());
  await open('priv'); await tg('linkPrev');
  await A.cmd('block', { peer: sb.me.peer }); await sleep(700); await open('acc'); await open('priv');
  ok('заблокированные: видны в списке', (await P.locator(`${SW} .js-blist [data-unbl]`).count()) === 1);
  await click(`${SW} .js-blist [data-unbl]`); await sleep(700);
  ok('заблокированные: «Разблокировать»', (await P.locator(`${SW} .js-blist [data-unbl]`).count()) === 0 && !((await A.cmd('state')).blocked || []).some(b => b.peer === sb.me.peer));
  // блок снимает дружбу — дружимся обратно для звонка
  await B.cmd('friend_add', { code: (await A.cmd('friend_code')).code }).catch(() => {});
  await A.until(e => e.ev === 'friend' && e.friend.peer === sb.me.peer && e.friend.state === 'incoming', 15000).catch(() => {});
  await A.cmd('friend_accept', { peer: sb.me.peer }).catch(() => {});
  await B.until(e => e.ev === 'friend' && e.friend.peer === sa.me.peer && e.friend.state === 'friend' && e !== null, 15000).catch(() => {});
});

/* ===================== Хранилище ===================== */
await section('storage', async () => {
  await open('storage'); await sleep(600);
  ok('хранилище: размер посчитан, чаты перечислены', /\d/.test(await txt(`${SW} .js-sttotal`)) && (await P.locator(`${SW} .js-stlist .strow`).count()) >= 2, await txt(`${SW} .js-sttotal`));
  await click(`${SW} .js-stopen`); await sleep(300);
  ok('открыть папку: в браузере — путь скопирован', /путь к папке скопирован/.test(await snack()) && (await clip()).length > 3, await snack());
  await click(`${SW} .js-strefresh`); await sleep(400); ok('обновить: пересчитывает', /\d/.test(await txt(`${SW} .js-sttotal`)));
  const row = () => txt(`${SW} .js-stlist .strow:has([data-stclear="${dm.id}"])`);
  const r0 = await row();
  await click(`${SW} [data-stclear="${dm.id}"]`); await P.click('.js-askok'); await sleep(900);
  ok('очистить чат: история удалена', /(^|\D)0 сообщений/.test(await row()) && r0 !== (await row()), [r0, await row()]);
});

/* ===================== Сеть ===================== */
await section('net', async () => {
  await open('net'); await sleep(500);
  ok('сеть: главное по-человечески', (await txt(`${SW} .js-nhb`)).length > 3, await txt(`${SW} .js-nhb`));
  await click(`${SW} .js-netbtn`);
  ok('проверить связь: пинг до друзей', await until(async () => /vasyan/.test(await txt(`${SW} .js-nettest`)), 6000), await txt(`${SW} .js-nettest`));
  for (const k of ['server', 'relay_server', 'upnp', 'dht']) {
    const v0 = !!(await cfg())[k];
    await click(`${SW} input[data-cfg="${k}"]`); await sleep(600);
    ok(`${k}: уходит в ядро`, !!(await cfg())[k] === !v0);
    if (k === 'server' && !v0) ok('сервер для друзей: «включится после перезапуска»', /после перезапуска/.test(await txt(`${SW} .js-srvbox`)), await txt(`${SW} .js-srvbox`));
    await click(`${SW} input[data-cfg="${k}"]`); await sleep(600);
    ok(`${k}: и обратно`, !!(await cfg())[k] === v0);
  }
  await click(`${SW} .js-geek summary`);
  const p0 = (await cfg()).port; const pi = await el(`${SW} .js-port`);
  await pi.fill('47999'); await pi.press('Enter'); await sleep(500);
  ok('порт: уходит в ядро', (await cfg()).port === 47999, (await cfg()).port);
  await pi.fill(String(p0)); await pi.press('Enter'); await sleep(400);
  await P.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await click(`${SW} .js-jcopy`); ok('журнал: копируется', /^Hunty v0\.7/.test(await clip()), (await clip()).slice(0, 30));
  const [dl] = await Promise.all([P.waitForEvent('download'), click(`${SW} .js-jsave`)]);
  ok('журнал: сохраняется в файл', /^hunty-journal-.*\.txt$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await click(`${SW} .js-jclear`); ok('журнал: очищается', /пока пусто/.test(await txt(`${SW} .js-jlist`)));
});

/* ===================== О Hunty ===================== */
await section('about', async () => {
  await open('about');
  ok('версия', /^v0\.7\.0/.test(await txt(`${SW} .js-ver`)), await txt(`${SW} .js-ver`));
  await click(`${SW} .js-upd`); await sleep(600);
  ok('проверка обновлений: отвечает', (await txt(`${SW} .js-updst`)).length > 5, await txt(`${SW} .js-updst`));
  ok('«Выключить Hunty» (браузерный режим): кнопка есть', await vis(`${SW} .js-quit`));
});

/* ===================== Всё переживает перезагрузку ===================== */
await section('reload', async () => {
  const keep = await P.evaluate(() => localStorage.getItem('hunty-prefs'));
  await open('look');
  await seg('side', 'left'); await click(`${SW} .js-glassmode [data-g="matte"]`); await rg('glassA', 'End'); await rg('glassBlur', 'Home');
  await click(`${SW} .js-walls [data-w="ocean"]`); await rg('msgSize', 'Home'); await rg('scale', 'ArrowRight');
  await open('audio'); await seg('bitrate', '32'); await seg('nsMode', 'std'); await rg('micVol', 'PageDown');
  await open('notif'); await seg('awayAfter', '30');
  await open('share'); await seg('shareRes', '1440'); await seg('clipSec', '15');
  await open('video'); await seg('camRes', '1080');
  await close();
  const before = await P.evaluate(() => import('/js/core.js').then(m => JSON.stringify(m.prefs)));
  await P.reload(); await P.waitForSelector('.js-chats .ci'); await sleep(1200);
  ok('после перезагрузки: настройки те же', (await P.evaluate(() => import('/js/core.js').then(m => JSON.stringify(m.prefs)))) === before);
  ok('после перезагрузки: список слева', !(await hcl('sr')));
  ok('после перезагрузки: стекло матовое', !(await hcl('lg')));
  ok('после перезагрузки: обои «Океан»', (await hcl('haswall')) && /rgb\(1, 6, 13\)|#01060d/.test(await P.evaluate(() => document.querySelector('.js-wall').style.background)), await P.evaluate(() => document.querySelector('.js-wall').style.background.slice(-40)));
  ok('после перезагрузки: прозрачность 100%', (await cssv('--pa')) === '0.120', await cssv('--pa'));
  ok('после перезагрузки: матовость 0', (await cssv('--gbk')) === '0.00', await cssv('--gbk'));
  ok('после перезагрузки: текст 13 px, масштаб', (await P.evaluate(() => document.documentElement.style.getPropertyValue('--mfs'))) === '13px' && (await P.evaluate(() => document.querySelector('.app').style.zoom)) === '1.05');
  // каждый переключатель/ползунок/список в настройках показывает то, что сохранено
  await open('acc');
  const bad = await P.evaluate(async () => {
    const { prefs } = await import('/js/core.js'), out = [];
    document.querySelectorAll('.win[data-win="settings"] [data-pref]').forEach(el => {
      const k = el.dataset.pref, v = prefs[k];
      if (el.classList.contains('seg')) { const b = el.querySelector('button[aria-pressed="true"]'); if ((b ? b.dataset.v : '') !== String(v)) out.push(k + ': seg ' + (b && b.dataset.v) + ' ≠ ' + v); }
      else if (el.type === 'checkbox') { if (el.checked !== !!v) out.push(k + ': ' + el.checked + ' ≠ ' + v); }
      else if (el.type === 'range') { if (+el.value !== +v) out.push(k + ': ' + el.value + ' ≠ ' + v); const t = el.parentElement.querySelector('.rgv'); if (t && !t.textContent.includes(String(v))) out.push(k + ': подпись «' + t.textContent + '»'); }
      else if (el.tagName === 'SELECT') { const has = [...el.options].some(o => o.value === String(v ?? '')); if (has && el.value !== String(v ?? '')) out.push(k + ': select ' + el.value + ' ≠ ' + v); }
    });
    return out;
  });
  ok('после перезагрузки: каждый контрол в настройках показывает сохранённое', bad.length === 0, bad);
  await close();
  // загрузочный экран: включён — показывается при запуске
  await P.evaluate(() => { const p = JSON.parse(localStorage.getItem('hunty-prefs')); p.boot = true; localStorage.setItem('hunty-prefs', JSON.stringify(p)); });
  await P.goto('http://127.0.0.1:8621/?ws=7621'); await sleep(300);
  ok('загрузочный экран: показывается при запуске', await until(() => P.evaluate(() => !!document.querySelector('.boot')), 3000));
  await P.waitForSelector('.js-chats .ci', { timeout: 20000 }); await sleep(800);
  // назад как было
  await P.evaluate(k => localStorage.setItem('hunty-prefs', k), keep);
  await P.goto('http://127.0.0.1:8621/?ws=7621&noboot'); await P.waitForSelector('.js-chats .ci'); await sleep(1000);
  ok('сброс к прежним: список снова справа', await hcl('sr'));
  await P.mouse.click(640, 400);
});

/* ===================== В звонке: настройки действуют на лету ===================== */
await section('call', async () => {
  const Q = await ctx.newPage(); Q.setDefaultTimeout(8000);
  Q.on('pageerror', e => errs.push('vasyan pageerror: ' + e.message));
  await Q.goto('http://127.0.0.1:8622/?ws=7622&noboot'); await Q.waitForSelector('.js-chats .ci'); await sleep(800); await Q.mouse.click(640, 400);
  const openG = async X => { await X.locator('.js-chats .ci').filter({ has: X.locator('.nm', { hasText: /^кухня$/ }) }).first().click(); await sleep(500); };
  await close(); await openG(P); await openG(Q);
  ok('шапка группы: трубка «Зайти в голос»', await vis('.js-hbtns .ib.vgo[data-act="voice"]'));
  await Q.click('.js-hbtns [data-act="voice"]'); await sleep(1200);
  ok('трубка: показывает, сколько уже в голосе', await until(async () => (await txt('.js-hbtns .ib.vgo .vn')) === '1', 4000), await txt('.js-hbtns .ib.vgo'));
  await P.click('.js-hbtns [data-act="voice"]');
  const VP = f => P.evaluate(f), peer0 = () => VP(() => import('/js/voice.js').then(m => { const p = [...m.V.peers.values()][0]; return !!(p && p.pc && p.pc.connectionState === 'connected'); }));
  const tj = Date.now(); ok('зашли в голос: связь с vasyan', await until(peer0, 30000), await VP(() => import('/js/voice.js').then(m => [...m.V.peers.values()].map(p => p.pc && p.pc.connectionState))));
  console.log('  (связь за ' + ((Date.now() - tj) / 1000).toFixed(1) + ' с)');
  ok('в голосе: в шапке красная трубка «Выйти»', await vis('.js-hbtns .ib.hang[data-act="hang"]'));
  // мик
  await open('audio');
  await rg('micVol', 'End'); await sleep(400);
  ok('громкость мика: усиление в звонке 200%', Math.abs((await VP(() => import('/js/voice.js').then(m => m.V.gain && m.V.gain.gain.value))) - 2) < .05, await VP(() => import('/js/voice.js').then(m => m.V.gain && m.V.gain.gain.value)));
  await (await el(`${SW} input[data-pref="micVol"]`)).dblclick(); await sleep(200);
  await seg('bitrate', '128'); await sleep(500);
  const brt = () => VP(() => import('/js/voice.js').then(m => { const p = [...m.V.peers.values()][0]; return p && p.micTx ? (p.micTx.getParameters().encodings || [{}])[0].maxBitrate : null; }));
  ok('качество голоса: 128 кбит/с уходит в звонок', (await brt()) === 128000, await brt());
  await seg('bitrate', '64'); await sleep(500); ok('качество голоса: 64 обратно', (await brt()) === 64000, await brt());
  const ms = () => VP(() => import('/js/voice.js').then(m => { const t = m.V.raw && m.V.raw.getAudioTracks()[0]; return t ? t.getSettings() : {}; }));
  await tg('ec'); await sleep(1500);
  ok('эхоподавление: мик перезапущен без него', (await ms()).echoCancellation === false, await ms());
  await tg('ec'); await sleep(1500); ok('эхоподавление: снова вкл', (await ms()).echoCancellation === true);
  await tg('agc'); await sleep(1500); ok('автогромкость: мик перезапущен без неё', (await ms()).autoGainControl === false, await ms());
  await tg('agc'); await sleep(1500);
  ok('после перезапуска мика связь живая', await until(peer0, 6000) && await VP(() => import('/js/voice.js').then(m => { const p = [...m.V.peers.values()][0]; return !!(p.micTx && p.micTx.track && p.micTx.track === m.V.track); })));
  const fx = await P.locator(`${SW} .js-fxgrid [data-fx]`).nth(3).getAttribute('data-fx');
  await click(`${SW} .js-fxgrid [data-fx="${fx}"]`); await sleep(300);
  ok('эффект голоса: включается прямо в звонке', (await VP(() => import('/js/voice.js').then(m => m.V.chain && m.V.chain.fxKind))) === fx);
  await click(`${SW} .js-fxgrid [data-fx=""]`); await sleep(200);
  // звук друга
  const boost = () => VP(() => import('/js/voice.js').then(m => { const p = [...m.V.peers.values()][0]; if (!p) return null; const b = [...p.boost.values()][0], a = [...p.audioEls.values()][0]; return { g: b ? +b.g.gain.value.toFixed(2) : null, lim: b ? !!b.lim : null, vol: a ? a.volume : null }; }));
  await until(async () => (await boost()) && (await boost()).g != null, 5000);
  await rg('outVol', 'Home'); await sleep(500);
  ok('громкость звука 0%: друга не слышно', (await boost()).g === 0 || (await boost()).vol === 0, await boost());
  await (await el(`${SW} input[data-pref="outVol"]`)).dblclick(); await sleep(500);
  ok('громкость звука 100%: снова слышно', (await boost()).g > .9 || (await boost()).vol === 1, await boost());
  await tg('earGuard'); await sleep(300); ok('беречь уши: выкл — без лимитера', !(await boost()).lim && (await boost()).vol === 1, await boost());
  await tg('earGuard'); await sleep(300); ok('беречь уши: вкл — лимитер на месте', (await boost()).lim === true, await boost());
  // рация
  const trk = () => VP(() => import('/js/voice.js').then(m => !!(m.V.track && m.V.track.enabled)));
  await seg('ptt', '1'); await close(); await P.evaluate(() => document.activeElement && document.activeElement.blur());
  ok('рация: без клавиши мик молчит', !(await trk()));
  const pk = await VP(() => import('/js/voice.js').then(m => m.pttCode()));
  await P.keyboard.down(pk); await sleep(250); const held = await trk(); await P.keyboard.up(pk); await sleep(250);
  ok('рация: держишь клавишу — говоришь, отпустил — тишина', held && !(await trk()), [pk, held]);
  await open('audio'); await seg('ptt', '0'); await sleep(200); ok('голосом: мик снова открыт', await trk());
  // вебка
  await close(); await click('.js-cam'); await sleep(1500);
  const camH = () => VP(() => import('/js/voice.js').then(m => { const t = m.V.camS && m.V.camS.getVideoTracks()[0]; return t ? t.getSettings().height : 0; }));
  ok('вебка: качество из настроек (720p)', (await camH()) === 720, await camH());
  ok('вебка: у себя зеркально', await vis('.vtile.me.cam.mir'));
  await open('video'); await seg('camRes', '360'); await sleep(1200);
  ok('вебка: качество меняется на лету (360p)', (await camH()) === 360, await camH());
  const qH = () => Q.evaluate(() => { const v = [...document.querySelectorAll('.vtile.cam .tv')].find(v => v.srcObject); return v ? v.videoHeight : 0; });
  ok('вебка: друг видит новое качество', await until(async () => (await qH()) === 360, 8000), await qH());
  await seg('camRes', '720'); await sleep(800);
  await tg('camMirror'); await sleep(300); ok('зеркалить выкл: у себя не зеркально', !(await vis('.vtile.me.cam.mir')) && await vis('.vtile.me.cam'));
  await tg('camMirror'); await sleep(200);
  await close(); await click('.js-cam'); await sleep(600);
  // демка
  await open('share'); await seg('shareRes', '720'); await seg('shareFps', '60'); await (await el(`${SW} select[data-pref="shareDraw"]`)).selectOption('none'); await seg('shareHint', 'detail'); await close();
  await click('.js-share'); await sleep(400);
  const segOn = s => P.evaluate(s => { const b = document.querySelector(s + ' button[aria-pressed="true"]'); return b ? b.dataset.v : ''; }, s);
  ok('окно «Показать экран»: подставлены значения из настроек', (await segOn('.win[data-win="share"] .js-sq')) === '720' && (await segOn('.win[data-win="share"] .js-sf')) === '60' && !(await P.isChecked('.win[data-win="share"] .js-sdraw')), [await segOn('.win[data-win="share"] .js-sq'), await segOn('.win[data-win="share"] .js-sf')]);
  await click('.win[data-win="share"] .js-sf button[data-v="30"]'); await click('.js-sstart'); await sleep(2500);
  const sh = () => VP(() => import('/js/voice.js').then(m => { const t = m.V.scrS && m.V.scrS.getVideoTracks()[0]; return { on: !!t, hint: t && t.contentHint, draw: m.V.drawOk }; }));
  ok('демка: идёт, рисовать нельзя (как в настройках)', (await sh()).on && (await sh()).draw === false, await sh());
  ok('окно «Показать экран»: выбранное там запоминается (30 fps)', (await pr('shareFps')) === 30, await pr('shareFps'));
  ok('демка: у друга нет инструментов рисования', await until(() => Q.evaluate(() => { const t = document.querySelector('.js-tools'); return !!document.querySelector('.js-dvid') && !document.querySelector('.js-dvid').hidden && t.hidden; }), 8000));
  await open('share'); await (await el(`${SW} select[data-pref="shareDraw"]`)).selectOption('all'); await sleep(1200);
  ok('«Рисовать на моей демке» на лету: друг сразу может рисовать', (await sh()).draw === true && await until(() => Q.evaluate(() => !document.querySelector('.js-tools').hidden), 6000));
  ok('режим «Чёткость текста»: кодек держит буквы', (await sh()).hint === 'detail', await sh());
  await seg('shareHint', 'motion'); await sleep(300); ok('режим на лету: «Плавность»', (await sh()).hint === 'motion', await sh());
  await seg('shareHint', 'detail'); await sleep(200);
  // клипы
  ok('клипы: в звонке идёт запись последних секунд', await until(() => P.evaluate(() => document.querySelector('.js-clip').classList.contains('rec')), 4000));
  await tg('clips'); await sleep(400); ok('клипы выкл: запись остановлена', !(await P.evaluate(() => document.querySelector('.js-clip').classList.contains('rec'))));
  await tg('clips'); await sleep(400); ok('клипы вкл: снова пишет', await P.evaluate(() => document.querySelector('.js-clip').classList.contains('rec')));
  await seg('shareRes', '1080'); await seg('shareFps', '30'); await close();
  await click('.js-share'); await sleep(500);
  ok('демка: кнопка останавливает показ', !(await sh()).on, await sh());
  await click('.js-hbtns [data-act="hang"]'); await sleep(800);
  ok('красная трубка: вышли из голоса', !(await VP(() => import('/js/voice.js').then(m => m.V.room))) && await vis('.js-hbtns .ib.vgo'));
  await Q.close();
});

/* ===================== итог ===================== */
const bad = RES.filter(r => !r[1]);
console.log(`\nнастройки: ${RES.length - bad.length} из ${RES.length} проверок прошли` + (bad.length ? '\nне сработало:\n' + bad.map(r => '  ✗ ' + r[0]).join('\n') : ''));
const errU = [...new Set(errs)].filter(e => !/AudioContext|play\(\) request|autoplay/i.test(e));
if (errU.length) console.log('ошибки в консоли:\n' + errU.slice(0, 20).map(e => '  ! ' + e.slice(0, 200)).join('\n'));
await br.close();
process.exit(bad.length || errU.length ? 1 : 0);
