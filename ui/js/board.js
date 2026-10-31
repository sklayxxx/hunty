// Саундборд: плитки звуков в звонке (кнопка «Кнопки» внизу) и в настройках; свои звуки — в IndexedDB
import { $, esc, ic, bus } from './core.js';
import { SB, SB_MAX, sbCustom, sbAdd, sbDel, sbPlay } from './audio.js';
import { actx, tmsg, fail } from './ui.js';
import { ask } from './menu.js';
import { V, micOn } from './voice.js';

export async function sbList() {
  return [...SB, ...(await sbCustom()).map(s => ({ ...s, e: '1f3b5', own: true }))];
}
const tile = (s, del) => `<button type="button" class="sbt${s.own ? ' own' : ''}" data-sb="${esc(s.id)}" title="${esc(s.name)}"><img alt="" src="emoji/${s.e}.webp" draggable="false"><span>${esc(s.name)}</span>${s.own && del ? `<i class="sbx" role="button" tabindex="0" aria-label="Удалить звук" data-sbdel="${esc(s.id)}">${ic('x')}</i>` : ''}<b class="sbp" aria-hidden="true"></b></button>`;
/** нарисовать плитки; o.add — плитка «Свой звук», o.del — крестики у своих */
export async function renderBoard(el, o = {}) {
  if (!el) return;
  const list = await sbList(), own = list.filter(s => s.own).length;
  el.innerHTML = list.map(s => tile(s, o.del)).join('') + (o.add && own < SB_MAX ? `<button type="button" class="sbt add" data-sbadd="1" title="mp3, ogg, wav · до 10 сек и 1,5 МБ">${ic('plus')}<span>Свой звук</span></button>` : '');
}
/** сыграть: в звонке — всем (и себе), иначе — только себе */
export async function playBoard(id, btn, { preview = false } = {}) {
  const a = actx(); if (!a) { tmsg('warn', 'звук ещё не включён — кликни по окну'); return; }
  const live = !preview && !!V.room && !!V.chain;
  if (live && !micOn()) tmsg('warn', 'мик выключен — звук слышишь только ты');
  const dur = await sbPlay(a, id, live ? V.chain : null);
  if (btn && dur) { btn.style.setProperty('--d', dur.toFixed(2) + 's'); btn.classList.remove('play'); void btn.offsetWidth; btn.classList.add('play'); setTimeout(() => btn.classList.remove('play'), dur * 1000 + 50); }
}
let fileIn = null;
export function pickSound() {
  if (!fileIn) {
    fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'audio/*'; fileIn.hidden = true; document.body.appendChild(fileIn);
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
      const a = actx(); if (!a) return;
      try { const s = await sbAdd(f, a); tmsg('ok', `звук «${s.name}» добавлен`); bus.emit('sb'); }
      catch (e) { fail(e && e.name === 'EncodingError' ? new Error('это не звук или формат не поддерживается — попробуй mp3 или ogg') : e); }
    });
  }
  fileIn.click();
}
/** клики по плиткам внутри el (делегирование) */
export function wireBoard(el, o = {}) {
  el.addEventListener('click', async e => {
    const x = e.target.closest('[data-sbdel]');
    if (x) {
      e.stopPropagation(); const id = x.dataset.sbdel;
      const s = (await sbCustom()).find(t => t.id === id);
      if (await ask({ title: `Удалить звук «${s ? s.name : ''}»?`, text: 'Он пропадёт только у тебя.', ok: 'Удалить', danger: true, icon: 'trash-2' })) { await sbDel(id); bus.emit('sb'); }
      return;
    }
    if (e.target.closest('[data-sbadd]')) { pickSound(); return; }
    const b = e.target.closest('[data-sb]'); if (b) playBoard(b.dataset.sb, b, o);
  });
}

/* в звонке: блок в всплывашке «Кнопки» */
const vsb = $('.js-vsb');
if (vsb) { wireBoard(vsb); renderBoard(vsb, { add: true }); }
bus.on('sb', () => { renderBoard(vsb, { add: true }); });
