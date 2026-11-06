// One queue per RTCRtpSender: setParameters transactions must not overlap.
export function makeShareUpdater(profile, watchesMe) {
  const queues = new WeakMap();
  return function update(tx, peer) {
    const previous = queues.get(tx) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (!tx.track) return;
      const q = profile(), p = tx.getParameters();
      if (!p.encodings || !p.encodings.length) return;
      for (const e of p.encodings) {
        e.active = watchesMe(peer);
        if (tx.track.kind === 'video') {
          e.maxBitrate = q.maxBitrate; e.maxFramerate = q.fps;
          e.priority = e.networkPriority = 'high';
          delete e.scaleResolutionDownBy;
        }
      }
      if (tx.track.kind === 'video') p.degradationPreference = 'balanced';
      try { await tx.setParameters(p); }
      catch (err) {
        if (!tx.track || tx.track.kind !== 'video') throw err;
        // Older browsers may reject degradationPreference. Retry with browser default.
        const fallback = tx.getParameters();
        if (!fallback.encodings || !fallback.encodings.length) throw err;
        for (const e of fallback.encodings) { e.active = watchesMe(peer); e.maxBitrate = q.maxBitrate; e.maxFramerate = q.fps; }
        delete fallback.degradationPreference;
        await tx.setParameters(fallback);
      }
    }).catch(e => console.warn('share params', e));
    queues.set(tx, next); return next;
  };
}
