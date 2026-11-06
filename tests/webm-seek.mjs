// Requires ffmpeg and Chromium. Verifies the clip muxer using a real media decoder.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Demux, mux } from '../ui/js/webm.js';
const dir = mkdtempSync(join(tmpdir(), 'hunty-seek-'));
let browser;
try {
  const src = join(dir, 'input.webm');
  execFileSync('ffmpeg', ['-y','-loglevel','error','-f','lavfi','-i','testsrc2=duration=8:size=320x180:rate=15','-f','lavfi','-i','sine=frequency=440:duration=8','-c:v','libvpx','-g','30','-c:a','libopus','-shortest',src]);
  let head; const frames = []; const d = new Demux(h => head=h, f=>frames.push(f)); const input=readFileSync(src);
  for (let i=0;i<input.length;i+=333) d.push(input.subarray(i,i+333));
  assert(head && frames.length > 20); const out=mux(head,frames);
  browser=await chromium.launch({headless:true, executablePath: process.env.CHROMIUM || '/usr/local/bin/chromium', args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage(); await page.setContent('<video controls></video>');
  const result=await page.evaluate(async b64=>{
    const video=document.querySelector('video'); const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); const url=URL.createObjectURL(new Blob([bytes],{type:'video/webm'})); video.src=url;
    const event=(type)=>new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(Error('timeout '+type)),10000);video.addEventListener(type,()=>{clearTimeout(timer);resolve();},{once:true}); });
    await event('loadedmetadata'); const duration=video.duration; video.currentTime=5; await event('seeked'); const at=video.currentTime; await video.play(); await new Promise(r=>setTimeout(r,300)); const advanced=video.currentTime; video.pause(); URL.revokeObjectURL(url); return {duration,at,advanced};
  }, Buffer.from(out.bytes).toString('base64'));
  assert(result.duration > 7 && result.duration < 9); assert(Math.abs(result.at-5)<0.1); assert(result.advanced>5.1); console.log('muxed WebM: duration, seek and playback OK',result);
} finally { await browser?.close(); rmSync(dir,{recursive:true,force:true}); }
