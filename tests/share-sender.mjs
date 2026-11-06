import assert from 'node:assert/strict';
import { makeShareUpdater } from '../ui/js/share-sender.js';
let watching = true, inFlight = false, overlap = false, last, calls = 0;
const tx = { track: {kind: 'video'}, getParameters: () => ({ encodings: [{scaleResolutionDownBy: 1}] }), async setParameters(p) {
  if (inFlight) overlap = true; inFlight = true; calls++;
  await new Promise(r => setTimeout(r, 15)); last = p; inFlight = false;
} };
const update = makeShareUpdater(() => ({fps:30,maxBitrate:6000000}), () => watching);
const a = update(tx, 'peer'); await new Promise(r => setTimeout(r, 2)); watching = false; const b = update(tx,'peer');
await Promise.all([a,b]);
assert.equal(overlap, false); assert.equal(calls,2); assert.equal(last.encodings[0].active,false); assert.equal(last.degradationPreference,'balanced'); assert.equal(last.encodings[0].scaleResolutionDownBy,undefined);
let fallbackCalls = 0; const old = { track:{kind:'video'}, getParameters:()=>({encodings:[{}]}), async setParameters(p){ fallbackCalls++; if (p.degradationPreference) throw Error('unsupported'); last=p; } };
await update(old,'peer'); assert.equal(fallbackCalls,2); assert.equal(last.encodings[0].active,false); assert.equal(last.degradationPreference,undefined);
console.log('share sender: queue, watch state, adaptive quality, fallback OK');
