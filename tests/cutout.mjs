// Проверка вырезалки на синтетике: стикер (с альфой = эталон) на разных фонах → IoU.
// node tests/cutout.mjs [out-dir]
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { cutout } from '../ui/js/cutout.js';
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const sharp = require('sharp');
const OUT = process.argv[2] || '';
const S = 320;
const rnd = (() => { let s = 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
function bgImage(kind) {
  const px = new Uint8ClampedArray(S * S * 4);
  const blobs = Array.from({ length: 26 }, () => [rnd() * S, rnd() * S, 20 + rnd() * 70, [rnd() * 255, rnd() * 255, rnd() * 255]]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const p = (y * S + x) * 4; let r, g, b;
    if (kind === 'plain') { r = 196; g = 182; b = 164; }
    else if (kind === 'grad') { r = 40 + x * .5; g = 90 + y * .4; b = 160 - x * .2; }
    else if (kind === 'wood') { const t = Math.sin(x * .05 + Math.sin(y * .02) * 3) * .5 + .5; r = 120 + 70 * t; g = 80 + 40 * t; b = 40 + 20 * t; }
    else { // blobs: «фотка» с пятнами разного цвета
      r = 90; g = 100; b = 110;
      for (const [cx, cy, rr, c] of blobs) { const d = Math.hypot(x - cx, y - cy); if (d < rr) { const k = 1 - d / rr; r = r * (1 - k) + c[0] * k; g = g * (1 - k) + c[1] * k; b = b * (1 - k) + c[2] * k; } }
    }
    const n = (rnd() - .5) * 18; px[p] = r + n; px[p + 1] = g + n; px[p + 2] = b + n; px[p + 3] = 255;
  }
  return px;
}
const files = readdirSync(new URL('../ui/stickers/', import.meta.url)).filter(f => f.endsWith('.webp')).slice(0, 60);
const pickF = ['cat.webp', 'fire.webp', 'joy.webp', 'skull.webp', 'party.webp', 'heart.webp', 'clown.webp', 'eyes.webp'].filter(f => files.includes(f));
const res = { auto: {}, lasso: {} };
for (const kind of ['plain', 'grad', 'wood', 'blobs']) {
  for (const f of pickF) {
    const { data: st } = await sharp(new URL('../ui/stickers/' + f, import.meta.url).pathname).resize(220, 220).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const img = bgImage(kind), gt = new Uint8Array(S * S), ox = 50, oy = 60;
    for (let y = 0; y < 220; y++) for (let x = 0; x < 220; x++) {
      const s = (y * 220 + x) * 4, a = st[s + 3] / 255, p = ((y + oy) * S + x + ox) * 4;
      for (let c = 0; c < 3; c++) img[p + c] = img[p + c] * (1 - a) + st[s + c] * a;
      gt[(y + oy) * S + x + ox] = a > .5 ? 1 : 0;
    }
    // «обводка пальцем»: эллипс вокруг эталона с запасом
    const pts = []; for (let i = 0; i < 48; i++) { const t = i / 48 * Math.PI * 2; pts.push([ox + 110 + Math.cos(t) * 140 + (rnd() - .5) * 10, oy + 110 + Math.sin(t) * 140 + (rnd() - .5) * 10]); }
    for (const mode of ['auto', 'lasso']) {
      const t0 = performance.now(); const { alpha } = cutout(img, S, S, mode, pts); const ms = performance.now() - t0;
      let I = 0, U = 0; for (let p = 0; p < S * S; p++) { const a = alpha[p] > 127, g = gt[p] === 1; if (a && g) I++; if (a || g) U++; }
      const iou = I / U; (res[mode][kind] = res[mode][kind] || []).push(iou);
      if (OUT && (iou < .9)) {
        const vis = Buffer.alloc(S * S * 4); for (let p = 0; p < S * S; p++) { vis[p * 4] = img[p * 4]; vis[p * 4 + 1] = img[p * 4 + 1]; vis[p * 4 + 2] = img[p * 4 + 2]; vis[p * 4 + 3] = Math.max(alpha[p], 40); }
        await sharp(vis, { raw: { width: S, height: S, channels: 4 } }).png().toFile(`${OUT}/${kind}-${f.replace('.webp', '')}-${mode}.png`);
      }
      if (process.env.V) console.log(kind, f, mode, iou.toFixed(3), ms.toFixed(0) + 'ms');
    }
  }
}
for (const mode of ['auto', 'lasso']) console.log(mode, Object.entries(res[mode]).map(([k, v]) => `${k}: ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)} (min ${Math.min(...v).toFixed(2)})`).join(' · '));
