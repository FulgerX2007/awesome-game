// Рубеж — synthesized sound effects (WebAudio, no files): axes and picks, hammers, clashes, arrows, war horns.
// Works in the browser (window.FrontAudio) and in Node (module.exports). Without an AudioContext, or before
// the first user gesture (unlock), every call is a safe no-op: nothing autoplays. The on/off toggle is kept
// in localStorage under STORE_KEY; broken or blocked storage keeps the default (on).
(function (root) {
  'use strict';
  const STORE_KEY = 'front.audio';
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
    chop() { // an axe in wood
      noise({ d: 0.08, vol: 0.09, f: 700, q: 1.2 });
      tone(vary(180, 0.08), { d: 0.06, vol: 0.04, type: 'square', to: 120 });
    },
    mine() { // a pick on stone or ore
      tone(vary(1500, 0.06), { d: 0.12, vol: 0.05, type: 'square', to: 1200 });
      noise({ d: 0.05, vol: 0.06, f: 3200, q: 2 });
    },
    build() { // hammering a building: three knocks
      [0, 0.12, 0.24].forEach((at) => noise({ at, d: 0.07, vol: 0.09, f: 500, q: 1.5 }));
    },
    built() { // a building stands: a short rising chime
      [72, 76, 79].forEach((m, k) => tone(freq(m), { at: k * 0.07, d: 0.25, vol: 0.05, type: 'triangle' }));
    },
    recruit() { // a new unit steps out
      tone(freq(67), { d: 0.12, vol: 0.05, type: 'square' });
      tone(freq(74), { at: 0.08, d: 0.16, vol: 0.05, type: 'square' });
    },
    clash() { // steel on steel
      tone(vary(1900, 0.08), { d: 0.1, vol: 0.04, type: 'square', to: 1500 });
      noise({ d: 0.06, vol: 0.07, f: 2600, q: 1.6 });
    },
    arrow() { // an arrow or a stone flies
      noise({ d: 0.14, vol: 0.05, f: 2400, q: 0.9, sweep: 900 });
    },
    wall() { // a blow on a wall
      noise({ d: 0.16, vol: 0.13, f: 220, q: 0.7, type: 'lowpass' });
      tone(vary(70, 0.06), { d: 0.18, vol: 0.07, type: 'triangle', to: 45 });
    },
    horn() { // a wave leaves the enemy fortress
      tone(freq(43), { d: 0.9, vol: 0.06, type: 'sawtooth', attack: 0.12 });
      tone(freq(50), { at: 0.15, d: 0.8, vol: 0.04, type: 'sawtooth', attack: 0.12 });
    },
    fort() { // a heavy hit on the enemy fortress
      noise({ d: 0.3, vol: 0.14, f: 160, q: 0.6, type: 'lowpass' });
      tone(vary(55, 0.05), { d: 0.3, vol: 0.08, type: 'triangle', to: 35 });
    },
    order() { // the army gets an order: a drum roll
      [0, 0.08, 0.16].forEach((at) => noise({ at, d: 0.06, vol: 0.08, f: 180, q: 0.8, type: 'lowpass' }));
    },
    win() { // the fortress falls: a fanfare
      [60, 64, 67, 72, 76, 79].forEach((m, k) => tone(freq(m), { at: k * 0.11, d: 0.4, vol: 0.07, type: 'triangle', attack: 0.01 }));
      [72, 76, 79].forEach((m) => tone(freq(m), { at: 0.7, d: 1.2, vol: 0.05, type: 'sawtooth', attack: 0.05 }));
    },
    lose() { // the keep falls
      noise({ d: 0.9, vol: 0.14, f: 160, q: 0.6, type: 'lowpass', attack: 0.05 });
      [64, 60, 57, 52].forEach((m, k) => tone(freq(m), { at: 0.2 + k * 0.18, d: 0.4, vol: 0.07, type: 'triangle', attack: 0.01 }));
    },
  };
  // Many workers chop and many soldiers clash at once: the ear needs far fewer.
  const GAPS = { chop: 140, mine: 140, build: 300, built: 300, recruit: 150, clash: 90, arrow: 80, wall: 200, horn: 800, fort: 200, order: 300, win: 1000, lose: 1000 };

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
    else if (ac) settle(() => ac.suspend());
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
    get started() { return !!ac; },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FrontAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
