// Пикер эмодзи и стикеров (как в Discord): вкладки, поиск, разделы, недавние, свои стикеры.
// openPicker({el, tab, mode:'insert'|'react', onEmoji, onSticker}) — одна панель на всё приложение
import { $, $$, esc, ic, prefs, setPref, reduce, clamp } from './core.js';
import { emoImg, emoKey, emoSrc } from './emoji.js';
import { HUNTY, MOBSTK, mobStk, stkName, myStickers, makeSticker, addSticker, delSticker } from './stickers.js';
import { MOBS } from './mobs.js';
import { segPill } from './ui.js';

const CAT = ['1f600', '1f44b', '1f43b', '1f354', '26bd', '1f697', '1f4a1', '2764', '1f3c1'];
let P = null, opt = {}, data = null, tab = 'emoji', built = { emoji: false, sticker: false }, hoverT = 0;

function el() {
  if (P) return P;
  P = document.createElement('div'); P.className = 'epk glass'; P.setAttribute('role', 'dialog'); P.setAttribute('aria-label', 'Эмодзи и стикеры'); P.hidden = true;
  P.innerHTML = `<div class="epk-h"><div class="seg slide epk-tabs" role="tablist"><button type="button" data-v="emoji" aria-pressed="true">Эмодзи</button><button type="button" data-v="sticker" aria-pressed="false">Стикеры</button></div>
    <label class="epk-s">${ic('search')}<input class="js-eq" placeholder="Найти эмодзи" autocomplete="off" spellcheck="false" aria-label="Поиск"><button type="button" class="epk-x js-eqx" aria-label="Очистить" hidden>${ic('x')}</button></label></div>
    <div class="epk-b"><nav class="epk-rail js-erail" aria-label="Разделы"></nav><div class="epk-g js-eg" tabindex="-1"></div></div>
    <div class="epk-f"><span class="epk-pv js-epv"></span><span class="epk-pt"><b class="js-epn">Выбери эмодзи</b><small class="js-eps">наведи — покажу название</small></span></div>
    <input type="file" class="js-estkf" accept="image/*" hidden>`;
  document.body.appendChild(P);
  $('.epk-tabs', P).addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) setTab(b.dataset.v); });
  const q = $('.js-eq', P);
  q.addEventListener('input', () => { $('.js-eqx', P).hidden = !q.value; search(q.value); });
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); const b = $('.js-eg [data-e], .js-eg [data-s]', P); if (b) b.click(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); const b = $('.js-eg button', P); if (b) b.focus(); }
  });
  $('.js-eqx', P).addEventListener('click', () => { q.value = ''; $('.js-eqx', P).hidden = true; search(''); q.focus(); });
  const g = $('.js-eg', P);
  g.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.e) { pickEmoji(b.dataset.e, e.shiftKey); return; }
    if (b.dataset.s) { pickSticker(JSON.parse(b.dataset.s)); return; }
    if (b.classList.contains('js-eadd')) $('.js-estkf', P).click();
  });
  g.addEventListener('contextmenu', async e => {
    const b = e.target.closest('[data-my]'); if (!b) return; e.preventDefault(); e.stopPropagation();
    await delSticker(b.dataset.my); buildStickers(true);
  });
  g.addEventListener('pointerover', e => { const b = e.target.closest('button[data-e],button[data-s]'); if (b) preview(b); });
  g.addEventListener('focusin', e => { const b = e.target.closest('button[data-e],button[data-s]'); if (b) preview(b); });
  g.addEventListener('keydown', e => gridKeys(e));
  g.addEventListener('scroll', () => railSync(), { passive: true });
  $('.js-erail', P).addEventListener('click', e => {
    const b = e.target.closest('[data-sec]'); if (!b) return;
    const s = $(`.epk-sec[data-sec="${b.dataset.sec}"]`, P); if (s) g.scrollTo({ top: s.offsetTop - 4, behavior: reduce ? 'auto' : 'smooth' });
  });
  $('.js-estkf', P).addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const src = await makeSticker(f); await addSticker(src, f.name.replace(/\.[^.]+$/, '')); buildStickers(true); }
    catch (_) { /* не картинка */ }
  });
  document.addEventListener('pointerdown', e => { if (!P.hidden && !P.contains(e.target) && !(opt.el && opt.el.contains(e.target))) closePicker(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !P.hidden) { e.preventDefault(); e.stopPropagation(); closePicker(true); } }, true);
  addEventListener('resize', () => { if (!P.hidden) place(); });
  return P;
}

/* ---------- раскладка ---------- */
function cell(k, g, name) { return `<button type="button" class="ec" data-e="${esc(g)}" data-n="${esc(name)}" title="${esc(name)}"><img src="${emoSrc(k)}" alt="${esc(g)}" loading="lazy" decoding="async" draggable="false"></button>`; }
function recentEmoji() {
  const r = (prefs.emoRecent || []).filter(g => emoKey(g)).slice(0, 18);
  return r.length ? r : ['👍', '😂', '❤️', '🔥', '😭', '🥺', '😎', '👀', '💀', '🎉', '🤝', '😡', '🤔', '✅', '😮', '🙏', '💯', '😅'];
}
async function buildEmoji() {
  if (!data) { const m = await import('./emoji-data.js'); data = m; }
  const g = $('.js-eg', P), names = new Map(data.E.map(x => [x[1], x[3]]));
  let h = `<section class="epk-sec" data-sec="r"><h4>${ic('clock')}Часто используемые</h4><div class="epk-grid">${recentEmoji().map(x => cell(emoKey(x), x, names.get(x) || '')).join('')}</div></section>`;
  data.GROUPS.forEach((nm, i) => {
    h += `<section class="epk-sec" data-sec="${i}"><h4>${esc(nm)}</h4><div class="epk-grid">${data.E.filter(x => x[2] === i).map(x => cell(x[0], x[1], x[3])).join('')}</div></section>`;
  });
  g.innerHTML = h;
  $('.js-erail', P).innerHTML = `<button type="button" data-sec="r" title="Часто используемые">${ic('clock')}</button>` + CAT.map((k, i) => `<button type="button" data-sec="${i}" title="${esc(data.GROUPS[i])}"><img src="${emoSrc(k)}" alt="" draggable="false"></button>`).join('');
  built.emoji = true; railSync();
}
function stkCell(dt, src, name, my) { return `<button type="button" class="sc" data-s="${esc(JSON.stringify(dt))}" data-n="${esc(name)}" title="${esc(name)}"${my ? ` data-my="${esc(my)}"` : ''}><img src="${esc(src)}" alt="${esc(name)}" loading="lazy" decoding="async" draggable="false"></button>`; }
async function buildStickers(keep) {
  const g = $('.js-eg', P), top = keep ? g.scrollTop : 0, mine = await myStickers();
  const rec = (prefs.stkRecent || []).filter(d => d && (d.k !== 'my' || mine.some(s => s.id === d.id))).slice(0, 8);
  const src = d => d.k === 'my' ? (mine.find(s => s.id === d.id) || {}).src : d.k.startsWith('mob:') ? mobStk(d.k.slice(4)) : 'stickers/' + d.k + '.webp';
  let h = '';
  if (rec.length) h += `<section class="epk-sec" data-sec="r"><h4>${ic('clock')}Недавние</h4><div class="epk-grid s">${rec.map(d => stkCell(d, src(d), d.k === 'my' ? (mine.find(s => s.id === d.id) || {}).n || 'мой стикер' : stkName(d))).join('')}</div></section>`;
  h += `<section class="epk-sec" data-sec="my"><h4>${ic('star')}Мои<small>видишь только ты · правый клик — убрать</small></h4><div class="epk-grid s">${mine.map(s => stkCell({ k: 'my', id: s.id }, s.src, s.n || 'мой стикер', s.id)).join('')}<button type="button" class="sc add js-eadd" title="Добавить свой стикер из картинки">${ic('plus')}<small>Свой</small></button></div></section>`;
  h += `<section class="epk-sec" data-sec="h"><h4>Hunty 3D</h4><div class="epk-grid s">${HUNTY.map(([k, n]) => stkCell({ k }, 'stickers/' + k + '.webp', n)).join('')}</div></section>`;
  h += `<section class="epk-sec" data-sec="m"><h4>Мобы</h4><div class="epk-grid s">${MOBSTK.map(k => stkCell({ k: 'mob:' + k }, mobStk(k), MOBS[k].n)).join('')}</div></section>`;
  g.innerHTML = h; g.scrollTop = top;
  $('.js-erail', P).innerHTML = (rec.length ? `<button type="button" data-sec="r" title="Недавние">${ic('clock')}</button>` : '') + `<button type="button" data-sec="my" title="Мои">${ic('star')}</button><button type="button" data-sec="h" title="Hunty 3D"><img src="stickers/party.webp" alt="" draggable="false"></button><button type="button" data-sec="m" title="Мобы"><img src="${mobStk('creeper')}" alt="" draggable="false" class="px"></button>`;
  built.sticker = true; railSync();
}
function railSync() {
  const g = $('.js-eg', P), secs = $$('.epk-sec', g); let cur = secs[0];
  for (const s of secs) if (s.offsetTop - g.scrollTop <= 40) cur = s;
  $$('.js-erail button', P).forEach(b => b.classList.toggle('on', !!cur && b.dataset.sec === cur.dataset.sec));
}
function search(q) {
  q = q.trim().toLowerCase();
  const g = $('.js-eg', P);
  if (!q) { tab === 'emoji' ? buildEmoji() : buildStickers(); return; }
  if (tab === 'emoji') {
    if (!data) return;
    const words = q.split(/\s+/);
    const hit = data.E.filter(x => { const hay = x[3] + ' ' + x[4]; return words.every(w => hay.includes(w)); })
      .sort((a, b) => (b[3].startsWith(q) - a[3].startsWith(q)) || (b[3].includes(q) - a[3].includes(q)));
    g.innerHTML = hit.length ? `<section class="epk-sec"><h4>Нашлось: ${hit.length}</h4><div class="epk-grid">${hit.slice(0, 180).map(x => cell(x[0], x[1], x[3])).join('')}</div></section>` : `<div class="epk-none">${emoImg('🤔', 'emjb')}<span>Таких эмодзи нет — попробуй другое слово</span></div>`;
  } else {
    myStickers().then(mine => {
      const all = [...mine.map(s => [{ k: 'my', id: s.id }, s.src, s.n || 'мой стикер']), ...HUNTY.map(([k, n]) => [{ k }, 'stickers/' + k + '.webp', n]), ...MOBSTK.map(k => [{ k: 'mob:' + k }, mobStk(k), MOBS[k].n])];
      const hit = all.filter(x => x[2].toLowerCase().includes(q));
      g.innerHTML = hit.length ? `<section class="epk-sec"><h4>Нашлось: ${hit.length}</h4><div class="epk-grid s">${hit.map(x => stkCell(...x)).join('')}</div></section>` : `<div class="epk-none">${emoImg('🤔', 'emjb')}<span>Таких стикеров нет</span></div>`;
    });
  }
}
function preview(b) {
  clearTimeout(hoverT);
  const pv = $('.js-epv', P), n = b.dataset.n || '';
  if (b.dataset.e) { pv.innerHTML = emoImg(b.dataset.e, 'emjb'); $('.js-epn', P).textContent = n || b.dataset.e; $('.js-eps', P).textContent = opt.mode === 'react' ? 'клик — реакция' : 'клик — вставить · Shift+клик — выбрать несколько'; }
  else { const im = $('img', b); pv.innerHTML = im ? `<img src="${esc(im.src)}" alt="">` : ''; $('.js-epn', P).textContent = n; $('.js-eps', P).textContent = b.dataset.my ? 'твой стикер · клик — отправить' : 'клик — отправить в чат'; }
}
function gridKeys(e) {
  const b = e.target.closest && e.target.closest('.js-eg button'); if (!b) return;
  const all = $$('.js-eg button', P), i = all.indexOf(b), cols = Math.max(1, Math.round(b.parentElement.clientWidth / b.offsetWidth));
  const go = j => { const n = all[clamp(j, 0, all.length - 1)]; if (n) { e.preventDefault(); n.focus(); } };
  if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1);
  else if (e.key === 'ArrowDown') go(i + cols); else if (e.key === 'ArrowUp') { if (i < cols) { e.preventDefault(); $('.js-eq', P).focus(); } else go(i - cols); }
}

/* ---------- выбор ---------- */
function pickEmoji(g, keep) {
  setPref('emoRecent', [g, ...(prefs.emoRecent || []).filter(x => x !== g)].slice(0, 27));
  const fn = opt.onEmoji; if (opt.mode === 'react' || !keep) closePicker(); fn && fn(g);
}
async function pickSticker(dt) {
  setPref('stkRecent', [dt, ...(prefs.stkRecent || []).filter(x => JSON.stringify(x) !== JSON.stringify(dt))].slice(0, 12));
  const fn = opt.onSticker; closePicker();
  if (dt.k === 'my') { const s = (await myStickers()).find(x => x.id === dt.id); if (!s) return; fn && fn({ k: 'my', src: s.src, n: s.n || '' }); return; }
  fn && fn(dt);
}

/* ---------- открыть / закрыть ---------- */
async function setTab(t) {
  tab = t; const seg = $('.epk-tabs', P);
  $$('button', seg).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === t)));
  segPill(seg, P.hidden || !P.classList.contains('on'));
  const q = $('.js-eq', P); q.value = ''; $('.js-eqx', P).hidden = true; q.placeholder = t === 'emoji' ? 'Найти эмодзи' : 'Найти стикер';
  P.dataset.tab = t;
  $('.js-epn', P).textContent = t === 'emoji' ? 'Выбери эмодзи' : 'Выбери стикер'; $('.js-eps', P).textContent = 'наведи — покажу название'; $('.js-epv', P).innerHTML = '';
  if (t === 'emoji') await buildEmoji(); else await buildStickers();
  $('.js-eg', P).scrollTop = 0; railSync();
}
function place() {
  const r = opt.el.getBoundingClientRect(), w = P.offsetWidth, h = P.offsetHeight, W = innerWidth, H = innerHeight;
  let left = opt.mode === 'react' ? r.left + r.width / 2 - w / 2 : r.right - w + 8, top = r.top - h - 10;
  if (top < 8) top = Math.min(H - h - 8, r.bottom + 10);
  P.style.left = Math.round(clamp(left, 8, W - w - 8)) + 'px'; P.style.top = Math.round(clamp(top, 8, H - h - 8)) + 'px';
  P.style.transformOrigin = `${clamp(r.left + r.width / 2 - parseFloat(P.style.left), 0, w)}px ${top < r.top ? h : 0}px`;
}
export const pickerOpen = () => !!(P && !P.hidden);
export async function openPicker(o) {
  el();
  if (!P.hidden && opt.el === o.el && (o.tab || 'emoji') === tab && opt.mode === (o.mode || 'insert')) { closePicker(); return; }
  opt = { mode: 'insert', ...o };
  P.classList.toggle('react', opt.mode === 'react');
  P.hidden = false; P.classList.remove('on');
  await setTab(opt.mode === 'react' ? 'emoji' : (o.tab || 'emoji'));
  place(); void P.offsetWidth; P.classList.add('on');
  opt.el && opt.el.setAttribute('aria-expanded', 'true');
  setTimeout(() => $('.js-eq', P).focus({ preventScroll: true }), 30);
  opt.onOpen && opt.onOpen();
}
export function closePicker(refocus) {
  if (!P || P.hidden) return;
  const o = opt; P.classList.remove('on'); P.hidden = true;
  o.el && o.el.setAttribute('aria-expanded', 'false');
  o.onClose && o.onClose(refocus);
}
