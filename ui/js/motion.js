// Движение: FLIP-перестановки, «полёт» сообщения при отправке, пружины. Лёгкий режим и «меньше движения» — без анимаций.
import { $, $$, R, reduce } from './core.js';

export const still = () => reduce || R.classList.contains('lite') || R.classList.contains('hid');
export const SPRING = 'linear(0, 0.009, 0.035 2.1%, 0.141 4.4%, 0.723 12.9%, 0.938 16.7%, 1.017 19.4%, 1.067, 1.099 24.3%, 1.108 26%, 1.1, 1.077 30.6%, 1.035 34.1%, 0.998 38.4%, 0.985 41.1%, 0.981 44.1%, 0.991 51.6%, 1.002 59.9%, 1.001 75.5%, 1)';
export const SOFT = 'linear(0, 0.006, 0.025 2.8%, 0.101 6.1%, 0.539 18.9%, 0.721 25.3%, 0.849 31.5%, 0.937 38.1%, 0.968 41.8%, 0.991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001)';
const app = () => $('.js-app');
/** во сколько раз отмасштабировано окно (зум под маленький экран) — для элементов внутри .app */
export function zoomOf(el) { const a = app(); return a && (!el || a.contains(el)) ? (+a.style.zoom || 1) : 1; }
const keyOf = e => e.dataset.k || e.dataset.chat || e.dataset.id || e.dataset.prof || '';
/** перестановка списка с плавным переездом: flip(box, '.ci', () => box.innerHTML = …) */
export function flip(box, sel, change, { dur = 420, ease = SOFT, enter = true } = {}) {
  if (still() || !box || !box.isConnected || !box.offsetParent) { change(); return; }
  const z = zoomOf(box), before = new Map();
  $$(sel, box).forEach(e => { const k = keyOf(e); if (k) before.set(k, e.getBoundingClientRect()); });
  change();
  $$(sel, box).forEach(e => {
    const k = keyOf(e), a = before.get(k), b = e.getBoundingClientRect();
    if (!a) { if (enter && before.size) e.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: SOFT }); return; }
    const dx = (a.left - b.left) / z, dy = (a.top - b.top) / z;
    if (Math.abs(dx) < .5 && Math.abs(dy) < .5) return;
    e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: dur, easing: ease, composite: 'add' });
  });
}
/** «отправка»: текст из поля ввода перелетает в своё место в ленте */
export function fly(fromRect, toEl, html) {
  if (still() || !fromRect || !toEl) return;
  const to = toEl.getBoundingClientRect(); if (!to.width) return;
  const g = document.createElement('div'); g.className = 'flyer'; g.innerHTML = html;
  Object.assign(g.style, { left: fromRect.left + 'px', top: fromRect.top + 'px', width: Math.min(fromRect.width, to.width) + 'px' });
  document.body.appendChild(g);
  const dx = to.left - fromRect.left, dy = to.top - fromRect.top;
  toEl.style.opacity = '0';
  const a = g.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1, filter: 'blur(0)' }, { transform: `translate(${dx * .55}px,${dy * .6 - 14}px) scale(1.02)`, opacity: 1, offset: .55 }, { transform: `translate(${dx}px,${dy}px) scale(1)`, opacity: .2 }], { duration: 420, easing: 'cubic-bezier(.3,.7,.25,1)' });
  const done = () => { g.remove(); toEl.style.opacity = ''; toEl.animate([{ opacity: .3, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: SOFT }); };
  a.onfinish = done; a.oncancel = done;
}
/** короткий «пульс» элемента (счётчик, бейдж) */
export function bump(el, k = 1.18) { if (still() || !el) return; el.animate([{ transform: 'scale(1)' }, { transform: `scale(${k})` }, { transform: 'scale(1)' }], { duration: 420, easing: SPRING }); }
/** закрытие: копия элемента красиво исчезает, оригинал можно прятать сразу */
export function ghostOut(el, kf, opt = {}) {
  if (still() || !el || !el.isConnected) return;
  const r = el.getBoundingClientRect(); if (!r.width) return;
  const g = el.cloneNode(true); g.classList.add('ghost'); g.removeAttribute('id'); g.inert = true;
  Object.assign(g.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0, zIndex: 999, pointerEvents: 'none', zoom: 1 });
  document.body.appendChild(g);
  const a = g.animate(kf || [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96) translateY(6px)' }], { duration: 200, easing: 'cubic-bezier(.4,0,1,1)', ...opt });
  a.onfinish = () => g.remove(); a.oncancel = () => g.remove();
}
