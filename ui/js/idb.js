// Мини-хранилище ключ → значение в IndexedDB (свои стикеры, обои): больше, чем влезает в localStorage
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('hunty', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('kv', mode), st = t.objectStore('kv'), q = fn(st); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
export const idb = {
  get: k => tx('readonly', s => s.get(k)),
  set: (k, v) => tx('readwrite', s => s.put(v, k)),
  del: k => tx('readwrite', s => s.delete(k)),
};
