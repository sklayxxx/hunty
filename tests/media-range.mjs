// Real hunty-node HTTP endpoint, including playback/seek through Chromium.
import assert from 'node:assert/strict';
import { node, client, BASE } from './lib.mjs';
import { rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { Demux, mux } from '../ui/js/webm.js';
rmSync(BASE,{recursive:true,force:true});
const p=node('seektest',7651,['--http','8651','--ui','ui','--no-upnp','--no-relay']); let c, browser;
try {
  c=await client(7651,'seektest'); const room=await c.cmd('self_open');
  execFileSync('ffmpeg',['-y','-loglevel','error','-f','lavfi','-i','testsrc2=duration=8:size=320x180:rate=15','-f','lavfi','-i','sine=frequency=440:duration=8','-c:v','libvpx','-g','30','-c:a','libopus','-shortest','/tmp/hunty-range-source.webm']);
  const raw=readFileSync('/tmp/hunty-range-source.webm'); let head; const frames=[]; const demux=new Demux(h=>head=h,f=>frames.push(f));
  for (let i=0;i<raw.length;i+=333) demux.push(raw.subarray(i,i+333)); const bytes=Buffer.from(mux(head,frames).bytes);
  const m=await c.cmd('send',{room:room.id,kind:'file',data:{name:'test.webm',size:bytes.length,mime:'video/webm',clip:1,src:'data:video/webm;base64,'+bytes.toString('base64')}});
  const url=`http://127.0.0.1:8651/media/${encodeURIComponent(room.id)}/${encodeURIComponent(m.id)}`;
  let r=await fetch(url,{headers:{Range:'bytes=10-99'}}); assert.equal(r.status,206); assert.equal(r.headers.get('content-range'),`bytes 10-99/${bytes.length}`); assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes.subarray(10,100));
  r=await fetch(url,{headers:{Range:'bytes=-7'}}); assert.equal(r.status,206); assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes.subarray(-7));
  r=await fetch(url,{headers:{Range:`bytes=${bytes.length}-`}}); assert.equal(r.status,416); assert.equal(r.headers.get('content-range'),`bytes */${bytes.length}`);
  r=await fetch(url); assert.equal(r.status,200); assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/local/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage(); await page.goto('http://127.0.0.1:8651/');
  const result=await page.evaluate(async url=>{
    const v=document.createElement('video'); document.body.appendChild(v); v.src=url;
    function wait(ev){return new Promise((res,rej)=>{let t=setTimeout(()=>rej(Error('timeout '+ev)),10000);v.addEventListener(ev,()=>{clearTimeout(t);res();},{once:true})})}
    await wait('loadedmetadata'); const duration=v.duration; v.currentTime=5; await wait('seeked'); await v.play(); await new Promise(r=>setTimeout(r,300)); return {duration,time:v.currentTime};
  },url);
  assert(result.duration>7 && result.duration<9); assert(result.time>5.1); console.log('HTTP ranges and chat clip seek OK',result);
} finally { await browser?.close(); c?.close(); p.kill(); rmSync('/tmp/hunty-range-source.webm',{force:true}); }
