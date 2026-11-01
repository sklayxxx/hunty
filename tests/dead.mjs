// Поиск «мёртвых» кнопок: у кнопки и её предков (кроме body/html/document) нет click/pointer-обработчиков.
// Запуск: DEAD=1 node tests/look.mjs  (подключается из look.mjs)
export async function deadScan(P, ctx, label) {
  const cdp = await ctx.newCDPSession(P);
  await cdp.send('DOM.enable'); await cdp.send('Runtime.enable'); await cdp.send('DOMDebugger.enable').catch(() => {});
  const { result: root } = await cdp.send('Runtime.evaluate', { expression: 'document', objectGroup: 'dead' });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: root.objectId, depth: -1, pierce: false });
  const T = new Set(['click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'contextmenu', 'dblclick', 'change', 'input']);
  const docL = [], wideL = [];
  await P.evaluate(() => document.querySelectorAll('[data-hl]').forEach(e => e.removeAttribute('data-hl')));
  for (const l of listeners) {
    if (!T.has(l.type)) continue;
    if (!l.backendNodeId) continue;
    let obj; try { obj = await cdp.send('DOM.resolveNode', { backendNodeId: l.backendNodeId, objectGroup: 'dead' }); } catch (_) { continue; }
    const r = await cdp.send('Runtime.callFunctionOn', { objectId: obj.object.objectId, functionDeclaration: 'function(t){ if (this.nodeType !== 1) return this.nodeName; if (this === document.body || this === document.documentElement) return this.nodeName; this.setAttribute("data-hl", (this.getAttribute("data-hl") || "") + " " + t); return ""; }', arguments: [{ value: l.type }], returnByValue: true });
    if (r.result.value) docL.push(r.result.value + ':' + l.type + '@' + l.scriptId + ':' + l.lineNumber);
    else { const n = await cdp.send('Runtime.callFunctionOn', { objectId: obj.object.objectId, functionDeclaration: 'function(){ return this.querySelectorAll ? this.querySelectorAll("button").length : 0 }', returnByValue: true }); if (n.result.value > 4) wideL.push([l.type, l.scriptId, l.lineNumber, l.columnNumber, n.result.value]); }
  }
  const wide = await P.evaluate(() => [...document.querySelectorAll('[data-hl]')].map(e => [e, e.querySelectorAll('button').length]).filter(([, n]) => n > 4).map(([e, n]) => e.tagName.toLowerCase() + '.' + String(e.className).trim().split(/\s+/).slice(0, 3).join('.') + ' [' + e.getAttribute('data-hl').trim() + '] кнопок ' + n));
  console.log('--- широкие контейнеры с обработчиками:'); wide.forEach(w => console.log('  ' + w));
  const dead = await P.evaluate((skip) => {
    const out = [];
    for (const b of document.querySelectorAll('button,[role="button"],a[href="#"],summary')) {
      if (b.disabled) continue;
      let ok = false;
      for (let e = b; e && e !== document.body; e = e.parentElement) if (e.hasAttribute('data-hl') && !(skip && e.matches(skip))) { ok = true; break; }
      if (ok) continue;
      if (b.matches('[data-win],[data-close],.wx,[type="submit"],summary')) continue;
      if (b.closest('form') && (b.type === 'submit' || !b.getAttribute('type'))) continue;
      const path = []; for (let e = b; e && e !== document.body && path.length < 4; e = e.parentElement) path.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : ''));
      out.push(path.join(' > ') + ' «' + (b.getAttribute('aria-label') || b.title || b.textContent || '').trim().slice(0, 40) + '»');
    }
    return out;
  }, process.env.DEAD_SKIP || 'main.tiles,div.wback');
  // где висят делегаты на body/document — чтобы руками проверить, что они покрывают кнопки
  const srcs = new Map();
  await cdp.send('Debugger.enable').catch(() => {});
  const src = async id => { if (!srcs.has(id)) { try { const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: id }); srcs.set(id, scriptSource.split('\n')); } catch (e) { srcs.set(id, null); } } return srcs.get(id); };
  if (process.env.DEAD_SRC) {
    console.log('--- код делегатов:');
    for (const [t, id, ln, col, n] of wideL) { const L = await src(id); console.log(`  [${t}] (${n} кн.) ` + (L ? L[ln].slice(Math.max(0, col - 20), col + 220) : '?')); }
    for (const d of docL) { const m = d.match(/@(\d+):(\d+)$/); const L = m && await src(m[1]); console.log('  [doc ' + d.split('@')[0] + '] ' + (L ? L[+m[2]].trim().slice(0, 240) : '?')); }
  }
  await cdp.detach().catch(() => {});
  console.log(`\n=== ${label}: кнопок без обработчиков: ${dead.length}`);
  dead.forEach(d => console.log('  ' + d));
  console.log(`--- делегаты на body/document (${docL.length}):`);
  for (const d of docL) console.log('  ' + d);
}
