// Числовой забег — synthesized sound effects (WebAudio, no files).
// Works in the browser (window.RushAudio) and in Node (module.exports). Without an AudioContext, or before
// the first user gesture (unlock), every call is a safe no-op: nothing autoplays. The on/off toggle is kept
// in localStorage under STORE_KEY; broken or blocked storage keeps the default (on).
(function (root) {
  'use strict';
  const STORE_KEY = 'rush.audio';
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
  // Rate limit per sound: hits, falls and clashes can come many times a second, the ear needs far fewer.
  const due = (k, gap) => {
    const now = Date.now();
    if (now - (last[k] || 0) < gap) return false;
    last[k] = now;
    return true;
  };

  // ───────────── Sounds ─────────────
  const SOUNDS = {
    gate({ good = true } = {}) { // a whoosh through the gate: a rising chime for a good one, a falling buzz for a bad one
      noise({ d: 0.18, vol: 0.12, f: good ? 2400 : 900, q: 1.2, sweep: good ? 5200 : 400 });
      if (good) {
        const m = 76 + Math.floor(Math.random() * 3) * 2;
        tone(freq(m), { d: 0.16, vol: 0.07, type: 'triangle' });
        tone(freq(m + 7), { at: 0.07, d: 0.24, vol: 0.06, type: 'triangle' });
      } else {
        const f = vary(220, 0.03);
        tone(f, { d: 0.32, vol: 0.06, type: 'sawtooth', to: f * 0.55 });
        tone(f * 1.06, { d: 0.32, vol: 0.04, type: 'square', to: f * 0.5 });
      }
    },
    hit() { // a saw or a wall: a crunch and a thud
      noise({ d: 0.16, vol: 0.3, f: 1800, q: 0.9, sweep: 500 });
      tone(vary(140), { d: 0.18, vol: 0.12, type: 'triangle', to: 55 });
    },
    fall() { // soldiers dropping off a platform: a short falling whistle
      const f = vary(900, 0.08);
      tone(f, { d: 0.45, vol: 0.05, to: f * 0.35 });
      noise({ at: 0.25, d: 0.2, vol: 0.06, f: 500, q: 0.8, type: 'lowpass' });
    },
    recruit() { // recruits join: a quick rising arpeggio
      [72, 76, 79].forEach((m, k) => tone(freq(m), { at: k * 0.05, d: 0.14, vol: 0.06, type: 'triangle' }));
      noise({ d: 0.12, vol: 0.06, f: 3000, q: 1.5, sweep: 6000 });
    },
    star({ n = 1 } = {}) { // the result's stars light up one after another
      const k = Math.max(0, Math.min(3, Math.round(Number(n) || 0)));
      for (let i = 0; i < k; i++) tone(freq(81 + 4 * i), { at: 0.25 + 0.2 * i, d: 0.3, vol: 0.06, type: 'triangle' });
    },
    battle() { // the charge: a low drum roll under a horn call
      for (let i = 0; i < 6; i++) noise({ at: i * 0.07, d: 0.08, vol: 0.18, f: 160, q: 0.7, type: 'lowpass' });
      [55, 60, 62].forEach((m, k) => tone(freq(m), { at: 0.1 + k * 0.12, d: 0.3, vol: 0.06, type: 'sawtooth', attack: 0.02 }));
    },
    clash() { // a metal clang in the melee
      const f = vary(1500, 0.12);
      noise({ d: 0.06, vol: 0.15, f: 4200, q: 2.5 });
      tone(f, { d: 0.1, vol: 0.03, type: 'square', to: f * 0.8 });
    },
    coin() { // coins: two bright pings
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
  const GAPS = { gate: 60, hit: 90, fall: 250, recruit: 80, battle: 500, clash: 110, coin: 90 };

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
  else root.RushAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
