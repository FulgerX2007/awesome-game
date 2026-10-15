// Цветные колбы — synthesized sound effects (WebAudio, no files): glass clinks, gurgling pours and chimes.
// Works in the browser (window.SortAudio) and in Node (module.exports). Without an AudioContext, or before
// the first user gesture (unlock), every call is a safe no-op: nothing autoplays. The on/off toggle is kept
// in localStorage under STORE_KEY; broken or blocked storage keeps the default (on).
(function (root) {
  'use strict';
  const STORE_KEY = 'sort.audio';
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
  // Rate limit per sound: quick taps can come faster than the ear needs.
  const due = (k, gap) => {
    const now = Date.now();
    if (now - (last[k] || 0) < gap) return false;
    last[k] = now;
    return true;
  };

  // ───────────── Sounds ─────────────
  const num = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  // A glass clink: two high partials that ring a little.
  const clink = (at, f, vol) => {
    tone(f, { at, d: 0.22, vol, type: 'sine' });
    tone(f * 2.76, { at, d: 0.12, vol: vol * 0.4, type: 'sine' });
  };

  const SOUNDS = {
    lift() { // the tube is picked up: a light clink
      clink(0, vary(1760, 0.03), 0.05);
    },
    pour({ layers = 1 } = {}) { // liquid pours: a filtered rush plus bubbles rising in pitch as the tube fills
      const n = num(layers, 1, 6, 1);
      const d = 0.22 + 0.1 * n;
      noise({ at: 0.3, d, vol: 0.06, f: 900, q: 0.7, sweep: 1500, attack: 0.04 });
      const bubbles = 3 + n * 2;
      for (let k = 0; k < bubbles; k++) {
        const f = vary(380 + (k / bubbles) * 420, 0.12);
        tone(f, { at: 0.3 + (k / bubbles) * d, d: 0.06, vol: 0.05, type: 'sine', to: f * 1.6 });
      }
    },
    complete() { // a tube holds one colour: a bright three-note chime
      [84, 88, 91].forEach((m, k) => clink(k * 0.07, freq(m), 0.05));
    },
    undo() { // a quick reverse whoosh
      noise({ d: 0.14, vol: 0.07, f: 2000, q: 1.1, sweep: 600 });
      tone(vary(700, 0.03), { d: 0.12, vol: 0.035, type: 'triangle', to: 460 });
    },
    deny() { // can't pour there: a soft low knock
      tone(vary(180, 0.05), { d: 0.12, vol: 0.08, type: 'triangle', to: 120 });
    },
    win() { // all sorted: a rising glassy arpeggio and a held chord
      [72, 76, 79, 84, 88].forEach((m, k) => clink(k * 0.09, freq(m), 0.06));
      [72, 76, 79].forEach((m) => tone(freq(m), { at: 0.5, d: 1.2, vol: 0.035, type: 'triangle', attack: 0.05 }));
    },
    stuck() { // no moves left: two soft falling notes
      tone(freq(67), { d: 0.3, vol: 0.06, type: 'triangle' });
      tone(freq(62), { at: 0.2, d: 0.5, vol: 0.06, type: 'triangle' });
    },
  };
  const GAPS = { lift: 50, pour: 80, complete: 120, undo: 60, deny: 120, win: 500, stuck: 500 };

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
  else root.SortAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
