// UI-only preview. Uses synthetic data, never opens a real Hunty data directory.
// node tests/preview.mjs -> http://127.0.0.1:8765/?wall=aurora
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root = fileURLToPath(new URL('../ui/', import.meta.url));
const bridge = fileURLToPath(new URL('./fixtures/preview-bridge.js', import.meta.url));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.ogg':'audio/ogg','.wasm':'application/wasm','.webmanifest':'application/manifest+json'};
createServer(async(req,res)=>{
  try {
    const path = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const file = path === '/__preview.js' ? bridge : resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (file !== bridge && !file.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
    let body = await readFile(file);
    if (extname(file) === '.html') body = Buffer.from(body.toString().replace('<script type="module" src="js/main.js">','<script src="/__preview.js"></script><script type="module" src="js/main.js">'));
    res.writeHead(200,{'Content-Type':types[extname(file)] || 'application/octet-stream','Cache-Control':'no-store'}).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(8765,'127.0.0.1',()=>console.log('Synthetic UI preview: http://127.0.0.1:8765/?wall=aurora'));
