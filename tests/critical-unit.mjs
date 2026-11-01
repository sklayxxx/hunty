// Dependency-free regression tests for actual UI functions (no running core needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { avaURL } from '../ui/js/mobs.js';
import { isImageData } from '../ui/js/image-data.js';

test('untrusted avatars cannot escape an HTML attribute', () => {
  for (const value of ['data:image/x" onerror="alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'https://example.com/a.png', 'mob:__proto__']) {
    const src = avaURL(value, 'test');
    assert.match(src, /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/);
    assert(!/["'<>]/.test(src));
  }
  assert.equal(avaURL('data:image/png;base64,aGVsbG8='), 'data:image/png;base64,aGVsbG8=');
  assert(!isImageData('data:image/png;base64,aGVsbG8=\n" onload="alert(1)'));
  assert.notEqual(avaURL('data:image/png;base64,' + 'a'.repeat(100_000)), 'data:image/png;base64,' + 'a'.repeat(100_000));
});

const source = readFileSync(new URL('../ui/js/voice.js', import.meta.url), 'utf8');
const cameraCode = source.slice(source.indexOf('let camRequest ='), source.indexOf('/* ---------- демка')).replaceAll('export ', '');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
function stream() {
  const track = {stopped:false, stop() {this.stopped = true;}};
  return {track, getVideoTracks:()=>[track], getTracks:()=>[track]};
}
function cameraContext(request) {
  const ctx = {V:{room:'r',session:1,cam:false,camS:null,peers:new Map()},prefs:{}, navigator:{mediaDevices:{getUserMedia:request}},
    myId:()=> 'me',tmsg(){},sendMetaAll(){},bus:{emit(){}},syncCtrl(){},renderRows(){},pushState(){}};
  vm.createContext(ctx); vm.runInContext(cameraCode, ctx); return ctx;
}

test('camera is stopped when permission arrives after leaving or rejoining', async () => {
  for (const room of ['', 'r', 'another-room']) {
    const wait = deferred(), s = stream(), ctx = cameraContext(()=>wait.promise);
    const pending = ctx.camStart(); ctx.V.session++; ctx.V.room = room;
    wait.resolve(s); await pending;
    assert(s.track.stopped); assert.equal(ctx.V.cam, false); assert.equal(ctx.V.camS, null);
  }
});

test('stopping camera cancels pending permission, and stale requests cannot replace a newer camera', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const ctx = cameraContext(()=> (++calls === 1 ? first : second).promise);
  const a = ctx.camStart(); ctx.camStop(true); const b = ctx.camStart();
  const old = stream(), current = stream(); second.resolve(current); await b;
  first.resolve(old); await a;
  assert(old.track.stopped); assert(!current.track.stopped); assert.equal(ctx.V.camS, current);
  ctx.camStop(true); assert(current.track.stopped); assert.equal(ctx.V.cam, false);
});

test('microphone permission resolving after leaving stops all tracks', async () => {
  const code = source.slice(source.indexOf('async function micStart()'), source.indexOf('async function micRestart()'));
  const wait = deferred(), s = stream();
  const ctx = {V:{room:'r',session:1}, getMic:()=>wait.promise,tmsg(){}};
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const pending = ctx.micStart(); ctx.V.session++; ctx.V.room = '';
  wait.resolve(s); await pending; assert(s.track.stopped);
});

test('screen selection cannot leak into another call', async () => {
  const code = source.slice(source.indexOf('export async function startShare('), source.indexOf('/* плашка сверху')).replace('export ', '');
  const wait = deferred(), s = stream();
  const ctx = {V:{room:'r',session:1}, prefs:{},navigator:{mediaDevices:{getDisplayMedia:()=>wait.promise}},setTimeout,clearTimeout,tmsg(){},closeToast(){},toast(){}};
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const pending = ctx.startShare(); ctx.V.session++; ctx.V.room = 'another-room';
  wait.resolve(s); await pending; assert(s.track.stopped);
});

test('failed sends restore the draft and reply without overwriting new typing', async () => {
  const chat = readFileSync(new URL('../ui/js/chat.js', import.meta.url), 'utf8');
  const code = chat.slice(chat.indexOf('export async function submitText('), chat.indexOf("form.addEventListener('submit'")).replace('export ', '');
  for (const newText of ['', 'new draft']) {
    const wait = deferred();
    const ctx = {S:{cur:'r'},input:{value:'original draft',getBoundingClientRect:()=>({left:0,top:0,width:200,height:30})},form:{hidden:false},
      getComputedStyle:()=>({paddingLeft:'0',paddingTop:'0',paddingRight:'0'}),emojiOnly:()=>false,emo:x=>x,esc:x=>x,plain:x=>x,
      send:()=>wait.promise,autosize(){},renderCbar(){},takeReply:()=>{vm.runInContext('replyTo = null',ctx);return 'target';}};
    vm.createContext(ctx); vm.runInContext('let replyTo = {room:"r",id:"target"}; let editing = null;\n' + code, ctx);
    const pending = ctx.submitText(); ctx.input.value = newText; wait.resolve(undefined); await pending;
    assert.equal(ctx.input.value, newText || 'original draft');
    if (!newText) assert.equal(vm.runInContext('replyTo.id', ctx), 'target');
  }
});
