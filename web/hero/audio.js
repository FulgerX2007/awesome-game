// Путь героя — synthesized sound effects (WebAudio, no files): steel, fire and frost hits, spells, level-ups.
// Works in the browser (window.HeroAudio) and in Node (module.exports). Without an AudioContext, or before
// the first user gesture (unlock), every call is a safe no-op: nothing autoplays. The on/off toggle is kept
// in localStorage under STORE_KEY; broken or blocked storage keeps the default (on).
(function (root) {
  'use strict';
  const STORE_KEY = 'hero.audio';
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
    step() { // a footstep on the map path
      noise({ d: 0.06, vol: 0.05, f: 380, q: 1, type: 'lowpass' });
    },
    hit(o) { // a weapon lands; the colour of the sound follows the damage type
      const type = o.type || 'phys';
      if (type === 'fire') {
        noise({ d: 0.18, vol: 0.09, f: 900, q: 0.7, sweep: 300 });
        tone(vary(180, 0.08), { d: 0.12, vol: 0.05, type: 'sawtooth', to: 110 });
      } else if (type === 'ice') {
        tone(vary(1600, 0.05), { d: 0.14, vol: 0.05, type: 'sine', to: 2200 });
        noise({ d: 0.08, vol: 0.06, f: 4200, q: 3 });
      } else if (type === 'holy') {
        tone(vary(freq(84), 0.01), { d: 0.25, vol: 0.05, type: 'triangle' });
        tone(vary(freq(91), 0.01), { at: 0.03, d: 0.25, vol: 0.04, type: 'sine' });
      } else {
        noise({ d: 0.07, vol: 0.12, f: 1800, q: 1.4 });
        tone(vary(240, 0.08), { d: 0.08, vol: 0.05, type: 'square', to: 160 });
      }
    },
    crit() { // a critical hit: a heavier blow
      noise({ d: 0.12, vol: 0.14, f: 700, q: 0.8, type: 'lowpass' });
      tone(vary(320, 0.05), { d: 0.16, vol: 0.07, type: 'square', to: 120 });
    },
    dodge() { // a miss: a whoosh past the target
      noise({ d: 0.16, vol: 0.05, f: 2600, q: 0.8, sweep: 700 });
    },
    block() { // a shield or an immunity: a dull clank
      tone(vary(900, 0.04), { d: 0.2, vol: 0.05, type: 'square', to: 700 });
    },
    hurt() { // the hero is hit
      noise({ d: 0.1, vol: 0.1, f: 420, q: 0.8, type: 'lowpass' });
      tone(vary(150, 0.05), { d: 0.12, vol: 0.05, type: 'triangle', to: 90 });
    },
    swap() { // the weapon is drawn: a short metal slide
      noise({ d: 0.22, vol: 0.06, f: 3000, q: 4, sweep: 5000, attack: 0.02 });
    },
    spell(o) { // a charm fires
      if (o.spell === 'heal') [76, 81, 88].forEach((m, k) => tone(freq(m), { at: k * 0.06, d: 0.35, vol: 0.045, type: 'sine' }));
      else if (o.spell === 'nova') { noise({ d: 0.35, vol: 0.07, f: 5000, q: 2, sweep: 1500 }); tone(freq(96), { d: 0.3, vol: 0.03 }); }
      else if (o.spell === 'smite') { tone(freq(79), { d: 0.5, vol: 0.06, type: 'triangle' }); tone(freq(86), { at: 0.05, d: 0.5, vol: 0.04 }); }
      else { noise({ d: 0.3, vol: 0.1, f: 600, q: 0.6, sweep: 2000 }); tone(120, { d: 0.25, vol: 0.05, type: 'sawtooth', to: 60 }); }
    },
    death() { // an enemy falls
      tone(vary(140, 0.1), { d: 0.25, vol: 0.06, type: 'sawtooth', to: 60 });
      noise({ at: 0.06, d: 0.12, vol: 0.08, f: 300, q: 0.8, type: 'lowpass' });
    },
    levelup() { // a new level: a rising arpeggio
      [67, 71, 74, 79, 83].forEach((m, k) => tone(freq(m), { at: k * 0.07, d: 0.3, vol: 0.06, type: 'triangle' }));
    },
    chest() { // a reward is taken
      [84, 88, 91].forEach((m, k) => tone(freq(m), { at: k * 0.06, d: 0.2, vol: 0.05, type: 'square' }));
    },
    forge() { // hammer on the anvil
      [0, 0.16].forEach((at) => { tone(vary(1300, 0.03), { at, d: 0.3, vol: 0.06, type: 'square', to: 1100 }); noise({ at, d: 0.05, vol: 0.08, f: 3000, q: 1 }); });
    },
    potion() { // a gulp and a sparkle
      tone(300, { d: 0.12, vol: 0.05, type: 'sine', to: 520 });
      tone(freq(88), { at: 0.12, d: 0.25, vol: 0.04 });
    },
    phase() { // the boss changes its form: a deep roar
      noise({ d: 0.8, vol: 0.12, f: 200, q: 0.5, type: 'lowpass', attack: 0.06 });
      tone(freq(36), { d: 0.8, vol: 0.07, type: 'sawtooth', attack: 0.1, to: freq(31) });
    },
    win() { // the final boss falls: a fanfare
      [60, 64, 67, 72, 76, 79].forEach((m, k) => tone(freq(m), { at: k * 0.11, d: 0.4, vol: 0.07, type: 'triangle', attack: 0.01 }));
      [72, 76, 79].forEach((m) => tone(freq(m), { at: 0.7, d: 1.2, vol: 0.05, type: 'sawtooth', attack: 0.05 }));
    },
    lose() { // the hero falls
      [64, 60, 57, 52].forEach((m, k) => tone(freq(m), { at: k * 0.18, d: 0.4, vol: 0.07, type: 'triangle', attack: 0.01 }));
    },
  };
  // Hits come several times a second in a crowded fight: the ear needs fewer.
  const GAPS = { step: 120, hit: 60, crit: 80, dodge: 90, block: 90, hurt: 80, swap: 200, spell: 150, death: 80, levelup: 400, chest: 200, forge: 300, potion: 200, phase: 800, win: 1000, lose: 1000 };

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
  else root.HeroAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
