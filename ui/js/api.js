// Мост к Rust-ядру: в приложении — Tauri invoke/events, в браузере (dev) — WebSocket hunty-node
import { bus } from './core.js';

const T = window.__TAURI__;
export const inTauri = !!(T && T.core);
let ws = null, wsReady = null, seq = 0;
const wait = new Map();
const handlers = {};

export function on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); }
function dispatch(v) {
  if (!v || !v.ev) return;
  (handlers[v.ev] || []).forEach(f => { try { f(v); } catch (e) { console.error('ev', v.ev, e); } });
  (handlers['*'] || []).forEach(f => { try { f(v); } catch (e) { console.error(e); } });
}

function wsConnect() {
  if (wsReady) return wsReady;
  const qs = new URLSearchParams(location.search);
  // hunty сам раздаёт интерфейс и мост к ядру на одном порту; ?ws=PORT — отдельный порт (разработка, тесты)
  const port = qs.get('ws') || location.port || '7457';
  const host = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) ? location.hostname : '127.0.0.1';
  wsReady = new Promise((res, rej) => {
    const s = new WebSocket(`ws://${host}:${port}`);
    s.onopen = () => { ws = s; res(s); bus.emit('link', true); };
    s.onerror = () => rej(new Error('нет связи с ядром (ws ' + port + ')'));
    s.onclose = () => {
      ws = null; wsReady = null;
      wait.forEach(([, j]) => j(new Error('ядро отключилось'))); wait.clear();
      bus.emit('link', false);
      setTimeout(() => wsConnect().then(() => bus.emit('relink')).catch(() => {}), 1500);
    };
    s.onmessage = m => {
      let v; try { v = JSON.parse(m.data); } catch (_) { return; }
      if (v.id != null && wait.has(v.id)) { const [r, j] = wait.get(v.id); wait.delete(v.id); v.err != null ? j(new Error(v.err)) : r(v.ok); }
      else dispatch(v);
    };
  });
  return wsReady;
}

export async function init() {
  if (inTauri) {
    await T.event.listen('hunty', e => dispatch(e.payload));
    return;
  }
  await wsConnect();
}

/** вызов команды ядра: api('send', {room, text}) */
export async function api(cmd, args = {}) {
  if (inTauri) {
    try { return await T.core.invoke('hunty', { cmd: { cmd, ...args } }); }
    catch (e) { throw new Error(typeof e === 'string' ? e : (e && e.message) || String(e)); }
  }
  const s = await wsConnect();
  return new Promise((r, j) => { const i = ++seq; wait.set(i, [r, j]); s.send(JSON.stringify({ id: i, cmd, ...args })); });
}

/* ---------- то, что умеет только оболочка (Tauri) ---------- */
export async function shell(cmd, args = {}) {
  if (!inTauri) throw new Error('нет оболочки');
  return T.core.invoke(cmd, args);
}
export async function openUrl(url) {
  if (inTauri) { try { await T.core.invoke('hunty_open', { url }); return; } catch (_) {} }
  window.open(url, '_blank', 'noopener');
}
/** сохранить файл: в приложении — в «Загрузки», в браузере — обычное скачивание */
export async function saveFile(name, data, mime = 'application/octet-stream') {
  if (inTauri) {
    let b64;
    if (typeof data === 'string' && data.startsWith('data:')) b64 = data.slice(data.indexOf(',') + 1);
    else b64 = btoa(unescape(encodeURIComponent(typeof data === 'string' ? data : JSON.stringify(data, null, 2))));
    return T.core.invoke('hunty_save', { name, b64 });
  }
  const href = typeof data === 'string' && data.startsWith('data:') ? data : URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: mime }));
  const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  return 'Загрузки/' + name;
}
export async function restart() {
  if (inTauri) return T.core.invoke('hunty_restart');
  // браузерный режим: узел перезапустит сам себя, страница переподключится и обновится
  try { await api('node_restart'); } catch (_) { bus.emit('need-restart'); }
}
/** выключить узел (браузерный режим: в приложении это делает закрытие окна/трея) */
export async function quitNode() { try { await api('quit'); } catch (_) {} }
export async function attention() {
  if (!inTauri) return;
  try { await T.core.invoke('hunty_attention'); } catch (_) {}
}
export async function focused() {
  if (!inTauri) return document.hasFocus();
  try { return await T.core.invoke('hunty_focused'); } catch (_) { return document.hasFocus(); }
}
