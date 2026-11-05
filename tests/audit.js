// Ищет на странице то, что вылезает за край: обрезанные кнопки и текст, окна и меню за пределами экрана,
// текст, обрезанный без «…». Вызывается внутри страницы: page.evaluate(audit, { root, tag }).
// Возвращает [{ what, why, px, tag }] — без дублей. Используется в tests/layout.mjs.
export function audit({ root = 'body', tag = '' } = {}) {
  const out = [], seen = new Set();
  const R = document.querySelector(root) || document.body;
  const vw = innerWidth, vh = innerHeight;
  const POP = '.cmenu,.toast,.wback>.win,.tip,.gtip,.mini,.snack';
  const cs = el => getComputedStyle(el);
  const visible = el => {
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) { const s = cs(a); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05 || a.hidden) return false; }
    return el.getClientRects().length > 0;
  };
  const scrolls = a => { const s = cs(a); return /auto|scroll/.test(s.overflowX) || /auto|scroll/.test(s.overflowY); };
  const name = el => {
    const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(x => x && !/^(on|js-)/.test(x)).slice(0, 3).join('.') : '';
    const js = typeof el.className === 'string' ? (el.className.match(/js-[\w-]+/) || [''])[0] : '';
    // цифры (fps, время, счётчики) меняются от прогона к прогону — в имени их нет, чтобы находки склеивались
    const t = (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().replace(/\s+/g, ' ').replace(/\d+/g, '#').slice(0, 28);
    return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}${js ? '[' + js + ']' : ''}${t ? ' «' + t + '»' : ''}`;
  };
  const add = (el, why, px) => { const k = name(el) + why; if (seen.has(k)) return; seen.add(k); out.push({ what: name(el), why, px: Math.round(px), tag }); };
  const offscreen = r => Math.max(0, -r.left, r.right - vw, -r.top, r.bottom - vh);
  // сами окна, меню, тосты и подсказки — целиком в пределах экрана
  for (const el of [R, ...R.querySelectorAll(POP)]) {
    if (!el.matches(POP) || !visible(el)) continue;
    const d = offscreen(el.getBoundingClientRect()); if (d > 1) add(el, 'за краем экрана', d);
  }
  const els = [R, ...R.querySelectorAll('*')].filter(el => !(el instanceof SVGElement) && !['SCRIPT', 'STYLE', 'AUDIO', 'TEMPLATE', 'BR'].includes(el.tagName));
  for (const el of els) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 3 || r.height < 3) continue;
    const s = cs(el);
    const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const inter = el.matches('button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=menuitem],[role=option],[tabindex="0"]');
    const media = el.matches('img,canvas,video');
    if (!ownText && !inter && !media) continue;
    if (el.closest('[aria-hidden="true"]') && !inter) continue;
    // за край экрана: только то, что не лежит в прокручиваемой области (её можно докрутить)
    let sc = null; for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (scrolls(a)) { sc = a; break; }
    const pop = el.closest(POP);
    if ((s.position === 'fixed' || pop) && !(sc && (!pop || pop.contains(sc)))) {
      const d = offscreen(r); if (d > 1) add(el, 'за краем экрана', d);
    }
    // обрезано предком с overflow:hidden/clip (прокручиваемые предки — не ошибка, «…» — задумано)
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const as = cs(a), ox = as.overflowX, oy = as.overflowY;
      if (/auto|scroll/.test(ox) || /auto|scroll/.test(oy)) break; // дальше — зона прокрутки
      const hx = /hidden|clip/.test(ox), hy = /hidden|clip/.test(oy);
      if (!hx && !hy) continue;
      if (as.textOverflow === 'ellipsis' && as.whiteSpace.includes('nowrap') && as.display !== 'flex') break; // обрезка с «…» — так задумано
      const ar = a.getBoundingClientRect(), z = ar.width / (a.offsetWidth || ar.width || 1);
      const L = ar.left + a.clientLeft * z, T = ar.top + a.clientTop * z, Rr = L + a.clientWidth * z, B = T + a.clientHeight * z;
      const cx = hx ? Math.max(0, L - r.left, r.right - Rr) : 0, cy = hy ? Math.max(0, T - r.top, r.bottom - B) : 0;
      const inside = r.right > L && r.left < Rr && r.bottom > T && r.top < B;
      // тень/обводку и пару пикселей скругления не считаем
      if (inside && (cx > 3 || cy > 3)) { add(el, `обрезано краем ${name(a)}`, Math.max(cx, cy)); break; }
      if (!inside && inter && (cx > 3 || cy > 3)) { add(el, `кнопка целиком за краем ${name(a)}`, Math.max(cx, cy)); break; }
    }
    // текст вылезает за свою плашку (кнопка, бейдж): фон/рамка уже, чем надпись
    const bg = s.backgroundColor, boxed = (bg && bg !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(bg)) || parseFloat(s.borderLeftWidth) > 0 || s.boxShadow !== 'none';
    if (ownText && boxed && s.display !== 'inline' && !/hidden|clip|auto|scroll/.test(s.overflowX) && el.clientWidth && el.scrollWidth > el.clientWidth + 2) add(el, 'текст вылезает за свою плашку', el.scrollWidth - el.clientWidth);
    // текст обрезан без многоточия
    if (ownText && !inter && s.whiteSpace.includes('nowrap') && /hidden|clip/.test(s.overflowX) && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2) add(el, 'текст обрезан без «…»', el.scrollWidth - el.clientWidth);
  }
  return out;
}
