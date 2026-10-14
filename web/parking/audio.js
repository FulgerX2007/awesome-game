// Тесная парковка — synthesized sound effects (WebAudio, no files).
// Works in the browser (window.ParkingAudio) and in Node (module.exports). Without an AudioContext, or before
// the first user gesture (unlock), every call is a safe no-op: nothing autoplays. The on/off toggle is kept
// in localStorage under STORE_KEY; broken or blocked storage keeps the default (on).
(function (root) {
  'use strict';
  const STORE_KEY = 'parking.audio';
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
  // Rate limit per sound: a drag can report bumps and quick moves can come faster than the ear needs.
  const due = (k, gap) => {
    const now = Date.now();
    if (now - (last[k] || 0) < gap) return false;
    last[k] = now;
    return true;
  };

  // ───────────── Sounds ─────────────
  // Engine pitch per vehicle kind: a car hums higher than a bus, the tow truck growls lowest.
  const ENGINE = { car: 120, bus: 78, tow: 62 };
  const num = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);

  const SOUNDS = {
    slide({ dist = 1, kind = 'car' } = {}) { // a vehicle rolls: an engine hum rising with the run plus tyre swish
      const cells = num(dist, 1, 8, 1);
      const base = vary(ENGINE[kind] || ENGINE.car, 0.04);
      const d = 0.16 + cells * 0.05;
      tone(base, { d, vol: 0.07, type: 'sawtooth', to: base * (1.25 + cells * 0.06), attack: 0.02 });
      tone(base * 2, { d: d * 0.8, vol: 0.025, type: 'square', to: base * 2.3, attack: 0.02 });
      noise({ d, vol: 0.07, f: 1400, q: 0.8, sweep: 700, attack: 0.03 });
      if (kind === 'tow') tone(freq(81), { at: d * 0.4, d: 0.09, vol: 0.03, type: 'square' }); // the beacon's beep
    },
    bump() { // blocked: a dull rubber thud
      tone(vary(95, 0.06), { d: 0.14, vol: 0.13, type: 'triangle', to: 50 });
      noise({ d: 0.07, vol: 0.12, f: 380, q: 0.9, type: 'lowpass' });
    },
    barrier({ open = true } = {}) { // the arm swings: a motor whirr gliding up when it opens, down when it closes
      const f = open ? 330 : 520;
      tone(f, { d: 0.26, vol: 0.035, type: 'square', to: open ? 520 : 330, attack: 0.02 });
      tone(freq(open ? 84 : 77), { at: 0.24, d: 0.12, vol: 0.04, type: 'sine' }); // a click-chime at the end
    },
    undo() { // a quick reverse whoosh
      noise({ d: 0.14, vol: 0.08, f: 2200, q: 1.1, sweep: 600 });
      tone(vary(660, 0.03), { d: 0.12, vol: 0.04, type: 'triangle', to: 440 });
    },
    hint() { // a soft two-note "idea" chime
      tone(freq(79), { d: 0.2, vol: 0.06, type: 'sine' });
      tone(freq(86), { at: 0.1, d: 0.35, vol: 0.05, type: 'sine' });
    },
    win() { // a honk and a bright fanfare as the red car drives off
      tone(freq(64), { d: 0.12, vol: 0.05, type: 'square' });
      tone(freq(68), { d: 0.12, vol: 0.04, type: 'square' });
      [60, 64, 67, 72].forEach((m, k) => tone(freq(m), { at: 0.18 + k * 0.1, d: 0.35, vol: 0.08, type: 'triangle', attack: 0.01 }));
      tone(freq(76), { at: 0.6, d: 0.9, vol: 0.07, type: 'triangle', attack: 0.01 });
    },
    lose() { // out of moves: a falling minor line
      [67, 63, 60, 55].forEach((m, k) => tone(freq(m), { at: k * 0.16, d: 0.38, vol: 0.08, type: 'triangle', attack: 0.01 }));
      tone(freq(43), { at: 0.6, d: 0.8, vol: 0.06, type: 'sawtooth', to: freq(38) });
    },
  };
  const GAPS = { slide: 60, bump: 150, barrier: 80, undo: 60, hint: 200 };

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
  else root.ParkingAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
