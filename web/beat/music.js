// Аншлаг — the band, synthesized on WebAudio (no files).
//
// compose() is pure: which notes start on a given sixteenth for the band at given levels. The engine books them
// on the audio clock: a timer wakes every 25 ms and schedules everything up to LOOKAHEAD seconds ahead, so the
// beat never depends on frames or timer jitter. The beat grid comes from BeatCore (the same one the judge uses).
//
// Clocks: the grid is in AudioContext time. A sound booked at time T reaches the ears when the output reaches T,
// so heardNow() is the context time the listener hears right now, and a tap is judged on that clock.
//
// Works in Node (module.exports) for tests: without an AudioContext every call is a safe no-op and the clock
// falls back to performance.now().
(function (root) {
  'use strict';
  const Core = typeof module === 'object' && module.exports ? require('./core.js') : root.BeatCore;

  const STORE_KEY = 'beat.audio';
  const LOOKAHEAD = 0.12; // seconds booked ahead of the audio clock
  const WAKE_MS = 25;
  const STEPS = 4; // sixteenths per beat
  const BAR = 16;
  const VOL = 0.75;

  const freq = (m) => 440 * 2 ** ((m - 69) / 12);

  // A minor, four bars: Am – F – C – G. Roots for the bass, close triads for guitar and keys.
  const PROG = [
    { root: 45, chord: [57, 60, 64] },
    { root: 41, chord: [57, 60, 65] },
    { root: 48, chord: [55, 60, 64] },
    { root: 43, chord: [55, 59, 62] },
  ];
  // A minor pentatonic for the sax.
  const SCALE = [64, 67, 69, 72, 74, 76, 79, 81, 84];

  // mulberry32: the sax phrase for a pair of bars is the same every time it is composed.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A two-bar sax phrase: notes on eighths with a few sixteenths, a random walk on the pentatonic that starts
  // and ends on a tone of the chord, and a breath at the end. Keys: step within the 32 sixteenths.
  const phrases = new Map();
  function phrase(seed, motif) {
    const key = `${seed}|${motif}`;
    let p = phrases.get(key);
    if (p) return p;
    const rnd = rng(seed * 7919 + motif * 104729 + 13);
    p = new Map();
    let i = 2 + Math.floor(rnd() * 3);
    let step = Math.floor(rnd() * 2) * 2;
    while (step < 26) {
      const len = rnd() < 0.2 ? 1 : rnd() < 0.65 ? 2 : rnd() < 0.85 ? 3 : 4;
      if (rnd() < 0.82) p.set(step, { m: SCALE[i], d: Math.max(0.25, len / STEPS - 0.05) });
      step += len;
      const jump = rnd() < 0.7 ? 1 : 2;
      i = Math.max(0, Math.min(SCALE.length - 1, i + (rnd() < 0.5 ? -jump : jump)));
    }
    if (phrases.size > 64) phrases.clear();
    phrases.set(key, p);
    return p;
  }

  // Notes that start on sixteenth `step` (counted from the start of the session) for the band at `levels`
  // ({ shaker, bass, guitar, keys, sax }). Each note: { v: voice, m: midi or [midis], d: length in beats,
  // g: loudness 0..1 }. The metronome tick (v: 'tick', m: 1 on the downbeat) is always there.
  function compose(levels, step, seed = 1) {
    const lv = (id) => (levels && levels[id]) || 0;
    const out = [];
    const bar = Math.floor(step / BAR);
    const pos = ((step % BAR) + BAR) % BAR;
    const sub = pos % STEPS;
    const ch = PROG[((bar % PROG.length) + PROG.length) % PROG.length];
    const band = lv('bass') + lv('guitar') + lv('keys') + lv('sax');
    if (sub === 0) out.push({ v: 'tick', m: pos === 0 ? 1 : 0, d: 0, g: band > 0 ? 0.55 : 1 });

    if (lv('shaker') > 0) {
      if (sub === 2) out.push({ v: 'shaker', d: 0, g: 1 });
      else if (sub === 0) out.push({ v: 'shaker', d: 0, g: 0.45 });
      else if (lv('shaker') >= 10) out.push({ v: 'shaker', d: 0, g: 0.28 });
    }
    if (lv('bass') > 0) {
      if (pos === 0 || pos === 8) out.push({ v: 'bass', m: ch.root, d: 0.9, g: 1 });
      if (lv('bass') >= 10 && (pos === 6 || pos === 14)) out.push({ v: 'bass', m: ch.root + 12, d: 0.4, g: 0.7 });
      if (lv('bass') >= 25 && (pos === 3 || pos === 11)) out.push({ v: 'bass', m: ch.root + 7, d: 0.2, g: 0.6 });
    }
    if (lv('guitar') > 0) {
      if (sub === 2) out.push({ v: 'guitar', m: ch.chord, d: 0.22, g: 1 });
      if (lv('guitar') >= 10 && (pos === 7 || pos === 15)) out.push({ v: 'guitar', m: ch.chord, d: 0.1, g: 0.45 });
    }
    if (lv('keys') > 0) {
      if (pos === 0) out.push({ v: 'pad', m: ch.chord, d: 3.9, g: 1 });
      if (lv('keys') >= 10 && sub === 0 && pos > 0) out.push({ v: 'pluck', m: ch.chord[pos / STEPS - 1] + 12, d: 0.3, g: 0.6 });
    }
    if (lv('sax') > 0) {
      // Two-bar phrases. A new sax answers every other phrase; from level 10 it plays all of them.
      const pair = Math.floor(bar / 2);
      if (lv('sax') >= 10 || pair % 2 === 1) {
        const motif = ((pair % 4) + 4) % 4;
        const note = phrase(seed, motif).get((bar - pair * 2) * BAR + pos);
        if (note) out.push({ v: 'sax', m: note.m, d: note.d, g: 1 });
      }
    }
    return out;
  }

  // ───────────── Settings ─────────────
  const prefs = { enabled: true };
  function storage() {
    try { return typeof root.localStorage !== 'undefined' ? root.localStorage : null; } catch { return null; }
  }
  (function load() {
    try {
      const s = storage();
      const p = s && JSON.parse(s.getItem(STORE_KEY));
      if (p && typeof p === 'object' && typeof p.enabled === 'boolean') prefs.enabled = p.enabled;
    } catch { /* broken or blocked storage: keep the default */ }
  })();
  function savePrefs() {
    try { const s = storage(); if (s) s.setItem(STORE_KEY, JSON.stringify(prefs)); } catch { /* full or blocked */ }
  }

  // ───────────── Engine ─────────────
  let ac = null, out = null, wet = null, noiseBuf = null, timer = null;
  let source = null; // { grid(), levels(), seed, only }
  let nextStep = null;
  const perf = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());

  function settle(call) {
    try {
      const p = call();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* ignore */ }
  }

  // An impulse response for a tiled underpass: a short bright slap and a two-second tail.
  function impulse(ctx, secs) {
    const n = Math.floor(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let k = 0; k < n; k++) {
        const t = k / n;
        d[k] = (Math.random() * 2 - 1) * (1 - t) ** 3 * (k < ctx.sampleRate * 0.012 ? 0.2 : 0.55);
      }
    }
    return buf;
  }

  // Creates the context on the first gesture. It is created even with sound off: the game runs on its clock.
  function unlock() {
    if (!ac) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return false;
      try { ac = new AC({ latencyHint: 'interactive' }); } catch { try { ac = new AC(); } catch { ac = null; return false; } }
      out = ac.createGain();
      out.gain.value = prefs.enabled ? VOL : 0;
      let last = out;
      if (ac.createDynamicsCompressor) {
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 4;
        comp.attack.value = 0.001; // fast enough to catch the knocks and the bucket
        out.connect(comp);
        last = comp;
      }
      last.connect(ac.destination);
      if (ac.createConvolver) {
        const verb = ac.createConvolver();
        verb.buffer = impulse(ac, 1.8);
        wet = ac.createGain();
        wet.gain.value = 0.22;
        wet.connect(verb);
        verb.connect(out);
      }
      noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate), ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') settle(() => ac.resume());
    if (!timer && root.setInterval) timer = root.setInterval(pump, WAKE_MS);
    return true;
  }

  // The scheduling clock (seconds).
  const now = () => (ac ? ac.currentTime : perf() / 1000);
  // The context time the listener hears right now.
  function heardNow() {
    if (!ac) return perf() / 1000;
    if (typeof ac.getOutputTimestamp === 'function') {
      const ts = ac.getOutputTimestamp();
      if (ts && ts.performanceTime > 0 && ts.contextTime > 0) return ts.contextTime + (perf() - ts.performanceTime) / 1000;
    }
    return ac.currentTime - (ac.outputLatency || ac.baseLatency || 0);
  }
  // The heard time of an input event, from its timeStamp (the same clock as performance.now()).
  function heardAt(stamp) {
    const h = heardNow();
    return Number.isFinite(stamp) && stamp > 0 ? h - Math.max(0, perf() - stamp) / 1000 : h;
  }
  // How far ahead the next free moment is: tempo changes start after what is already booked.
  const horizon = () => now() + LOOKAHEAD + 0.02;

  // Plays this band. `get`: { grid(), levels(), seed, only } — `only: 'tick'` plays just the metronome.
  function play(get) { source = get; nextStep = null; }
  function stop() { source = null; nextStep = null; }
  // After a new grid (a new session) the step counter starts over.
  function resync() { nextStep = null; }

  function pump() {
    if (!ac || !source) return;
    const g = source.grid();
    if (!g) return;
    const t0 = ac.currentTime;
    const until = t0 + LOOKAHEAD;
    if (nextStep === null) nextStep = Math.ceil(Core.beatAt(g, t0) * STEPS);
    const spb = 60 / g.bpm;
    for (let n = 0; n < 64; n++) {
      const at = Core.timeOf(g, nextStep / STEPS);
      if (at >= until) break;
      // a late step (the tab was throttled) is skipped rather than played out of time
      if (at >= t0 - 0.005 && prefs.enabled) {
        const levels = source.levels();
        for (const note of compose(source.only === 'tick' ? {} : levels, nextStep, source.seed || 1)) voice(note, Math.max(at, t0), spb);
      }
      nextStep++;
    }
  }

  // ───────────── Voices ─────────────
  function env(g, at, peak, attack, hold) {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold);
  }
  function send(node, wetAmt) {
    node.connect(out);
    if (wet && wetAmt > 0) {
      const s = ac.createGain();
      s.gain.value = wetAmt;
      node.connect(s);
      s.connect(wet);
    }
  }
  function osc(type, f, at, end, dest, detune = 0) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (detune) o.detune.setValueAtTime(detune, at);
    o.connect(dest);
    o.start(at);
    o.stop(end);
    return o;
  }
  function noise(at, d, dest) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.connect(dest);
    src.start(at, Math.random() * 0.5);
    src.stop(at + d + 0.02);
  }
  function filter(type, f, q = 1) {
    const fl = ac.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    return fl;
  }

  const VOICES = {
    tick(n, at) { // a wood block: a short knock, higher and louder on the downbeat
      const f = n.m ? 1900 : 1500;
      const g = ac.createGain();
      env(g, at, 0.16 * n.g * (n.m ? 1.3 : 1), 0.002, 0.06);
      osc('triangle', f, at, at + 0.09, g);
      const c = ac.createGain();
      env(c, at, 0.06 * n.g, 0.001, 0.012);
      const fl = filter('highpass', 3000, 0.7);
      fl.connect(c);
      noise(at, 0.02, fl);
      send(g, 0.12);
      send(c, 0);
    },
    shaker(n, at) { // rice in a can
      const g = ac.createGain();
      env(g, at, 0.1 * n.g, 0.012, 0.05);
      const fl = filter('highpass', 5000, 0.7);
      fl.connect(g);
      noise(at, 0.08, fl);
      send(g, 0.2);
    },
    bass(n, at, spb) { // a round, plucked bass
      const d = n.d * spb;
      const g = ac.createGain();
      env(g, at, 0.22 * n.g, 0.008, d);
      const fl = filter('lowpass', 900, 2);
      fl.frequency.setValueAtTime(1400, at);
      fl.frequency.exponentialRampToValueAtTime(300, at + d);
      fl.connect(g);
      osc('sawtooth', freq(n.m), at, at + d + 0.05, fl);
      osc('sine', freq(n.m), at, at + d + 0.05, g);
      send(g, 0.05);
    },
    guitar(n, at, spb) { // a muted funk chop on the offbeat
      const d = Math.max(0.06, n.d * spb);
      const g = ac.createGain();
      env(g, at, 0.05 * n.g, 0.004, d);
      const fl = filter('bandpass', 1800, 1.1);
      fl.connect(g);
      n.m.forEach((m, k) => osc('sawtooth', freq(m), at + k * 0.006, at + d + 0.05, fl, k * 3 - 3));
      send(g, 0.3);
    },
    pad(n, at, spb) { // warm keys: detuned saws under a slow filter
      const d = n.d * spb;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.03 * n.g, at + 0.35);
      g.gain.setValueAtTime(0.03 * n.g, at + Math.max(0.36, d - 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, at + d + 0.2);
      const fl = filter('lowpass', 1100, 0.5);
      fl.connect(g);
      for (const m of n.m) { osc('sawtooth', freq(m), at, at + d + 0.25, fl, -7); osc('sawtooth', freq(m), at, at + d + 0.25, fl, 7); }
      send(g, 0.45);
    },
    pluck(n, at, spb) { // an arpeggio note on top of the pad
      const g = ac.createGain();
      env(g, at, 0.04 * n.g, 0.004, n.d * spb);
      osc('triangle', freq(n.m), at, at + n.d * spb + 0.05, g);
      send(g, 0.4);
    },
    sax(n, at, spb) { // a breathy reed: a saw through a formant, with vibrato that comes in late
      const d = n.d * spb;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.06 * n.g, at + 0.03);
      g.gain.setValueAtTime(0.055 * n.g, at + Math.max(0.04, d * 0.7));
      g.gain.exponentialRampToValueAtTime(0.0001, at + d + 0.08);
      const f1 = filter('bandpass', 1200, 1.4);
      const f2 = filter('lowpass', 3200, 0.7);
      f1.connect(f2);
      f2.connect(g);
      const o = osc('sawtooth', freq(n.m), at, at + d + 0.12, f1);
      if (d > 0.25) {
        const lfo = ac.createOscillator();
        lfo.frequency.value = 5.5;
        const depth = ac.createGain();
        depth.gain.setValueAtTime(0, at);
        depth.gain.linearRampToValueAtTime(9, at + d);
        lfo.connect(depth);
        depth.connect(o.detune);
        lfo.start(at);
        lfo.stop(at + d + 0.12);
      }
      send(g, 0.35);
    },
  };
  function voice(n, at, spb) {
    const v = VOICES[n.v];
    if (v) v(n, at, spb);
  }

  // ───────────── Effects played on input ─────────────
  // The player's own drum: a thump on the bucket. A perfect hit rings brighter, a miss is dull and short.
  function hit(grade) {
    if (!ac || !prefs.enabled) return;
    const at = ac.currentTime;
    const miss = grade === 'miss';
    const g = ac.createGain();
    env(g, at, miss ? 0.3 : 0.62, 0.003, miss ? 0.09 : 0.2);
    const o = osc('sine', miss ? 120 : 190, at, at + 0.25, g);
    o.frequency.exponentialRampToValueAtTime(miss ? 70 : 62, at + 0.16);
    const n = ac.createGain();
    env(n, at, miss ? 0.14 : 0.3, 0.002, 0.05);
    const fl = filter(miss ? 'lowpass' : 'bandpass', miss ? 500 : grade === 'perfect' ? 1500 : 1000, 1.2);
    fl.connect(n);
    noise(at, 0.07, fl);
    send(g, 0.2);
    send(n, 0.25);
  }
  // Coins in the case: a short bright jingle.
  function coin() {
    if (!ac || !prefs.enabled) return;
    const at = ac.currentTime;
    [88, 95].forEach((m, k) => {
      const g = ac.createGain();
      env(g, at + k * 0.06, 0.05, 0.003, 0.18);
      osc('square', freq(m), at + k * 0.06, at + k * 0.06 + 0.22, g);
      send(g, 0.3);
    });
  }
  // A new multiplier: three notes up the chord.
  function tier() {
    if (!ac || !prefs.enabled) return;
    const at = ac.currentTime;
    [69, 76, 81].forEach((m, k) => {
      const g = ac.createGain();
      env(g, at + k * 0.05, 0.05, 0.004, 0.25);
      osc('triangle', freq(m), at + k * 0.05, at + k * 0.05 + 0.3, g);
      send(g, 0.4);
    });
  }

  // ───────────── Toggle and visibility ─────────────
  function setEnabled(on) {
    prefs.enabled = !!on;
    savePrefs();
    if (ac && out) {
      const t = ac.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(prefs.enabled ? VOL : 0, t);
    }
    return prefs.enabled;
  }
  const toggle = () => setEnabled(!prefs.enabled);
  function suspend() { if (ac && ac.state === 'running') settle(() => ac.suspend()); }
  function resume() { if (ac && ac.state === 'suspended') settle(() => ac.resume()); }

  const api = {
    STORE_KEY, LOOKAHEAD, STEPS, BAR, PROG, SCALE,
    compose, phrase, unlock, now, heardNow, heardAt, horizon, play, stop, resync, pump, hit, coin, tier,
    setEnabled, toggle, suspend, resume,
    get enabled() { return prefs.enabled; },
    get ready() { return !!ac; },
    get context() { return ac; },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BeatMusic = api;
})(typeof window !== 'undefined' ? window : globalThis);
