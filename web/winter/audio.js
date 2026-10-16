// Долгая зима — synthesized sound (WebAudio, no files): the axe, the pick, crunching snow, wolves, the bear, the
// trader's bells, snares, the aurora, the fire's
// crackle and the blizzard's wind as two loops. Works in the browser (window.WinterAudio) and in Node (module.exports). Without an AudioContext, or before
// the first user gesture (unlock), every call is a safe no-op: nothing autoplays. The on/off toggle is kept
// in localStorage under STORE_KEY; broken or blocked storage keeps the default (on).
(function (root) {
  'use strict';
  const STORE_KEY = 'winter.audio';
  const VOL = 0.45;

  const freq = (m) => 440 * 2 ** ((m - 69) / 12);

  // ───────────── Settings ─────────────
  const state = { enabled: true };
  function storage() {
    try { return typeof root.localStorage !== 'undefined' ? root.localStorage : null; } catch { return null; }
  }
  (function loadPrefs() {
    try {
      const s = storage();
      const raw = s && s.getItem(STORE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p && typeof p === 'object' && typeof p.enabled === 'boolean') state.enabled = p.enabled;
    } catch { /* broken or blocked storage: keep the default */ }
  })();
  function savePrefs() {
    try { const s = storage(); if (s) s.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  }

  // ───────────── Engine ─────────────
  let ac = null, bus = null, noiseBuf = null, unlocked = false;
  const last = {};
  const hidden = () => typeof root.document !== 'undefined' && root.document.visibilityState === 'hidden';

  // resume()/suspend() may throw or return a promise that rejects; neither matters for the game.
  function settle(call) {
    try {
      const p = call();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* ignore */ }
  }

  // The context is created lazily, only after a gesture and only while sound is on.
  function ensure() {
    if (!unlocked || !state.enabled) return false;
    if (!ac) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return false;
      try { ac = new AC(); } catch { ac = null; return false; }
      bus = ac.createGain();
      bus.gain.value = VOL;
      bus.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate), ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended' && !hidden()) settle(() => ac.resume());
    return true;
  }

  // A single enveloped oscillator.
  function tone(f, { at = 0, d = 0.3, vol = 0.1, type = 'sine', to = 0, attack = 0.005 } = {}) {
    const now = ac.currentTime + at;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, now);
    if (to) o.frequency.exponentialRampToValueAtTime(to, now + d);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + d);
    o.connect(g);
    g.connect(bus);
    o.start(now);
    o.stop(now + d + 0.05);
  }

  // A filtered burst from the shared noise buffer; `sweep` glides the filter frequency to that value.
  function noise({ at = 0, d = 0.1, vol = 0.2, f = 1000, q = 1, type = 'bandpass', attack = 0.004, sweep = 0 } = {}) {
    const now = ac.currentTime + at;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const fl = ac.createBiquadFilter();
    fl.type = type;
    fl.frequency.setValueAtTime(f, now);
    if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, now + d);
    fl.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + d);
    src.connect(fl);
    fl.connect(g);
    g.connect(bus);
    src.start(now, Math.random() * 0.5);
    src.stop(now + d + 0.05);
  }

  const vary = (f, amt = 0.05) => f * (1 + (Math.random() * 2 - 1) * amt);
  // Rate limit per sound.
  const due = (k, gap) => {
    const now = Date.now();
    if (now - (last[k] || 0) < gap) return false;
    last[k] = now;
    return true;
  };

  // ───────────── Sounds ─────────────
  const SOUNDS = {
    chop() { // the axe in a trunk
      noise({ d: 0.09, vol: 0.1, f: 650, q: 1.2 });
      tone(vary(170, 0.08), { d: 0.07, vol: 0.04, type: 'square', to: 110 });
    },
    mine() { // the pick on stone
      tone(vary(1500, 0.06), { d: 0.12, vol: 0.05, type: 'square', to: 1200 });
      noise({ d: 0.05, vol: 0.06, f: 3200, q: 2 });
    },
    step() { // a crunch in the snow
      noise({ d: 0.07, vol: 0.05, f: 2600, q: 0.7, sweep: 1200 });
    },
    pick() { // berries, scrap: a soft rustle
      noise({ d: 0.12, vol: 0.04, f: 1800, q: 1.5 });
    },
    eat() {
      noise({ d: 0.06, vol: 0.05, f: 900, q: 2 });
      noise({ at: 0.12, d: 0.06, vol: 0.05, f: 900, q: 2 });
    },
    fire() { // a log on the fire
      noise({ d: 0.3, vol: 0.08, f: 500, q: 0.6, sweep: 1500 });
    },
    howl() { // wolves at night: a long rising and falling howl
      tone(vary(330, 0.05), { d: 1.6, vol: 0.05, type: 'sine', to: 520, attack: 0.3 });
      tone(vary(480, 0.04), { at: 0.9, d: 1.2, vol: 0.03, type: 'sine', to: 300, attack: 0.2 });
    },
    bite() {
      noise({ d: 0.1, vol: 0.12, f: 400, q: 0.8, type: 'lowpass' });
      tone(vary(220, 0.08), { d: 0.12, vol: 0.06, type: 'sawtooth', to: 120 });
    },
    hit() { // a blow at a wolf or game
      noise({ d: 0.07, vol: 0.1, f: 700, q: 1 });
    },
    build() {
      [0, 0.12, 0.24].forEach((at) => noise({ at, d: 0.07, vol: 0.09, f: 500, q: 1.5 }));
    },
    craft() {
      tone(vary(1300, 0.03), { d: 0.25, vol: 0.05, type: 'square', to: 1100 });
      tone(freq(84), { at: 0.15, d: 0.3, vol: 0.04, type: 'triangle' });
    },
    rescue() { // a survivor joins: a warm chord
      [60, 64, 67, 72].forEach((m, k) => tone(freq(m), { at: k * 0.08, d: 0.6, vol: 0.05, type: 'triangle' }));
    },
    dawn() { // a new day: a bright bell
      tone(freq(84), { d: 1.2, vol: 0.05, type: 'sine' });
      tone(freq(91), { at: 0.1, d: 1.2, vol: 0.03, type: 'sine' });
    },
    win() { // spring
      [60, 64, 67, 72, 76, 79].forEach((m, k) => tone(freq(m), { at: k * 0.11, d: 0.4, vol: 0.07, type: 'triangle', attack: 0.01 }));
      [72, 76, 79].forEach((m) => tone(freq(m), { at: 0.7, d: 1.2, vol: 0.05, type: 'sine', attack: 0.05 }));
    },
    lose() {
      noise({ d: 1.2, vol: 0.08, f: 300, q: 0.6, type: 'lowpass', attack: 0.2 });
      [64, 60, 57, 52].forEach((m, k) => tone(freq(m), { at: 0.2 + k * 0.2, d: 0.5, vol: 0.06, type: 'triangle', attack: 0.01 }));
    },
    roar() { // the bear: a low growl swelling and breaking off
      tone(vary(90, 0.06), { d: 1.1, vol: 0.09, type: 'sawtooth', to: 60, attack: 0.15 });
      noise({ d: 1.0, vol: 0.08, f: 260, q: 0.7, type: 'lowpass', attack: 0.15, sweep: 140 });
    },
    bells() { // the trader's sled: harness bells
      [88, 91, 88, 93, 88].forEach((m, k) => tone(freq(m), { at: k * 0.09, d: 0.35, vol: 0.035, type: 'triangle' }));
    },
    trade() { // a deal: two coins and a pleased note
      tone(vary(2200, 0.03), { d: 0.12, vol: 0.04, type: 'square', to: 1900 });
      tone(vary(2600, 0.03), { at: 0.08, d: 0.12, vol: 0.035, type: 'square', to: 2300 });
      tone(freq(79), { at: 0.18, d: 0.35, vol: 0.04, type: 'triangle' });
    },
    snare() { // a snare set, or a catch at dawn: a taut cord's twang
      tone(vary(520, 0.05), { d: 0.25, vol: 0.05, type: 'triangle', to: 420 });
      noise({ d: 0.05, vol: 0.04, f: 1500, q: 2 });
    },
    aurora() { // the northern lights: a soft high shimmer
      [84, 88, 91, 96].forEach((m, k) => tone(freq(m) * (1 + k * 0.003), { at: k * 0.25, d: 2.2, vol: 0.02, type: 'sine', attack: 0.6 }));
    },
    creak() { // the roof gives way: a wooden groan and a crack
      tone(vary(140, 0.05), { d: 0.7, vol: 0.06, type: 'sawtooth', to: 95, attack: 0.1 });
      noise({ at: 0.55, d: 0.18, vol: 0.12, f: 900, q: 1 });
    },
  };
  const GAPS = { chop: 140, mine: 140, step: 180, pick: 160, eat: 300, fire: 300, howl: 3000, bite: 200, hit: 120, build: 300, craft: 300, rescue: 800, dawn: 1500, win: 1000, lose: 1000, roar: 2000, bells: 1500, trade: 200, snare: 300, aurora: 4000, creak: 1500 };

  // ───────────── Loops: the fire's crackle and the wind ─────────────
  // Each loop is a looping noise buffer through a filter and a gain; setLoop(name, level) fades it to 0…1.
  const LOOPS = { crackle: { f: 1800, q: 0.8, type: 'bandpass', vol: 0.05 }, wind: { f: 500, q: 0.4, type: 'lowpass', vol: 0.09 } };
  const loops = {};
  function setLoop(name, level) {
    if (!Object.prototype.hasOwnProperty.call(LOOPS, name)) return;
    const lv = Math.max(0, Math.min(1, Number(level) || 0));
    if (!state.enabled || !ensure()) { stopLoops(); return; }
    let l = loops[name];
    if (!l && lv > 0) {
      try {
        const src = ac.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        const fl = ac.createBiquadFilter();
        fl.type = LOOPS[name].type;
        fl.frequency.value = LOOPS[name].f;
        fl.Q.value = LOOPS[name].q;
        const g = ac.createGain();
        g.gain.value = 0.0001;
        src.connect(fl); fl.connect(g); g.connect(bus);
        src.start();
        l = loops[name] = { src, g };
      } catch { return; }
    }
    if (!l) return;
    try { l.g.gain.linearRampToValueAtTime(Math.max(0.0001, lv * LOOPS[name].vol), ac.currentTime + 0.4); } catch { /* ignore */ }
  }
  function stopLoops() {
    for (const k of Object.keys(loops)) {
      try { loops[k].src.stop(); } catch { /* already stopped */ }
      delete loops[k];
    }
  }

  function play(name, opts) {
    if (!state.enabled || !Object.prototype.hasOwnProperty.call(SOUNDS, name) || !ensure()) return;
    if (!due(name, GAPS[name] || 200)) return;
    try { SOUNDS[name](opts && typeof opts === 'object' ? opts : {}); } catch { /* never let sound break the game */ }
  }

  // ───────────── Public ─────────────
  // Called from user gestures only (key, tap, click).
  function unlock() {
    unlocked = true;
    ensure();
  }
  function setEnabled(on) {
    state.enabled = !!on;
    savePrefs();
    if (state.enabled) ensure();
    else { stopLoops(); if (ac) settle(() => ac.suspend()); }
  }

  if (typeof root.document !== 'undefined' && root.document.addEventListener) {
    root.document.addEventListener('visibilitychange', () => {
      if (!ac) return;
      if (hidden()) settle(() => ac.suspend());
      else if (state.enabled) settle(() => ac.resume());
    });
  }

  const api = {
    STORE_KEY,
    SOUND_NAMES: Object.keys(SOUNDS),
    get enabled() { return state.enabled; },
    setEnabled,
    unlock,
    play,
    setLoop,
    LOOP_NAMES: Object.keys(LOOPS),
    get loops() { return Object.keys(loops); },
    get started() { return !!ac; },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WinterAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
