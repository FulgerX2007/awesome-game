// Тяни штифт — synthesized sound effects (WebAudio, no files).
// Works in the browser (window.PinsAudio) and in Node (module.exports). Without an AudioContext, or before
// the first user gesture (unlock), every call is a safe no-op: nothing autoplays. The on/off toggle is kept
// in localStorage under STORE_KEY; broken or blocked storage keeps the default (on).
(function (root) {
  'use strict';
  const STORE_KEY = 'pins.audio';
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
  // Rate limit per sound: the automaton reports changes every frame, the ear needs far fewer.
  const gate = (k, gap) => {
    const now = Date.now();
    if (now - (last[k] || 0) < gap) return false;
    last[k] = now;
    return true;
  };

  // ───────────── Sounds ─────────────
  const SOUNDS = {
    pin() { // a metallic click and a short scrape as the pin slides out
      const f = vary(2100, 0.04);
      tone(f, { d: 0.12, vol: 0.07, type: 'triangle' });
      tone(f * 2.4, { d: 0.06, vol: 0.03 });
      noise({ d: 0.05, vol: 0.25, f: 5000, q: 1.2, type: 'highpass' });
      noise({ at: 0.03, d: 0.18, vol: 0.12, f: 2600, q: 4, sweep: 1300 });
    },
    gurgle() { // water pouring: a few low bubbles over a soft wash
      noise({ d: 0.35, vol: 0.12, f: 700, q: 0.8, type: 'lowpass', attack: 0.04 });
      for (let i = 0; i < 3; i++) {
        const f = vary(260 + i * 90, 0.15);
        tone(f, { at: i * 0.07 + Math.random() * 0.03, d: 0.08, vol: 0.06, to: f * 1.8 });
      }
    },
    bubble() { // lava: slow, deep blurps
      for (let i = 0; i < 2; i++) {
        const f = vary(110 + i * 40, 0.15);
        tone(f, { at: i * 0.12, d: 0.14, vol: 0.1, type: 'triangle', to: f * 1.5 });
      }
      noise({ d: 0.25, vol: 0.08, f: 300, q: 0.7, type: 'lowpass', attack: 0.03 });
    },
    hiss() { // steam where water meets lava
      noise({ d: 0.6, vol: 0.22, f: 6000, q: 0.6, type: 'highpass', attack: 0.02, sweep: 3500 });
      noise({ d: 0.3, vol: 0.08, f: 2400, q: 2 });
    },
    sizzle() { // gold burning in lava: crackles
      for (let i = 0; i < 4; i++) noise({ at: i * 0.045 + Math.random() * 0.02, d: 0.03, vol: 0.2, f: vary(3800, 0.2), q: 3 });
      tone(vary(180), { d: 0.2, vol: 0.04, type: 'sawtooth', to: 90 });
    },
    burn() { // an enemy burns: a whoosh going up and a low groan
      noise({ d: 0.5, vol: 0.25, f: 400, q: 0.9, attack: 0.05, sweep: 2600 });
      tone(vary(220), { d: 0.45, vol: 0.07, type: 'sawtooth', to: 70 });
    },
    coin() { // gold landing in the hero's room
      const f = vary(1760, 0.03);
      tone(f, { d: 0.12, vol: 0.06, type: 'square' });
      tone(f * 1.335, { at: 0.06, d: 0.22, vol: 0.05, type: 'square' });
    },
    win() { // a bright fanfare
      [60, 64, 67, 72].forEach((m, k) => tone(freq(m), { at: k * 0.1, d: 0.35, vol: 0.08, type: 'triangle', attack: 0.01 }));
      tone(freq(76), { at: 0.42, d: 0.9, vol: 0.07, type: 'triangle', attack: 0.01 });
      tone(freq(84), { at: 0.42, d: 0.7, vol: 0.025 });
    },
    lose() { // a falling minor line
      [67, 63, 60, 55].forEach((m, k) => tone(freq(m), { at: k * 0.16, d: 0.38, vol: 0.08, type: 'triangle', attack: 0.01 }));
      tone(freq(43), { at: 0.6, d: 0.8, vol: 0.06, type: 'sawtooth', to: freq(38) });
    },
  };
  const GAPS = { pin: 60, gurgle: 380, bubble: 450, hiss: 300, sizzle: 220, coin: 90 };

  function play(name) {
    if (!state.enabled || !Object.prototype.hasOwnProperty.call(SOUNDS, name) || !ensure()) return;
    if (!gate(name, GAPS[name] || 200)) return;
    try { SOUNDS[name](); } catch { /* never let sound break the game */ }
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
  else root.PinsAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
