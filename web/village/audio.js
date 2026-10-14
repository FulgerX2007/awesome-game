'use strict';
// Родник — synthesized sounds and a quiet ambient score (WebAudio, no files).
// Works in the browser (window.VillageAudio) and in Node (module.exports). Without an AudioContext,
// or before the first user gesture (unlock), every call is a safe no-op: nothing autoplays.
(function (root) {
  const STORE_KEY = 'village.audio';
  const MUSIC_VOL = 0.15;
  const SFX_VOL = 0.4;

  // D major pentatonic: D E F# A B (pitch classes).
  const PENTATONIC = [2, 4, 6, 9, 11];
  // Melody range: pentatonic notes from A3 (57) to D6 (86).
  const MELODY = [];
  for (let m = 57; m <= 86; m++) if (PENTATONIC.includes(m % 12)) MELODY.push(m);
  // Low open pads, every note from the scale: D, Bm-ish, A and E-ish voicings.
  const PADS = [[38, 45, 54], [35, 42, 50], [33, 45, 52], [40, 47, 54]];
  const BEAT = 0.62; // seconds — slow, unhurried

  const freq = (m) => 440 * 2 ** ((m - 69) / 12);

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A pure phrase generator: the same seed always gives the same phrase.
  // notes: { midi, at (beats), len (beats) }; pad: midi notes held under the phrase; beats: phrase length;
  // rest: seconds of silence after the phrase.
  function phrase(seed) {
    const r = rng(seed);
    const count = 4 + Math.floor(r() * 4); // 4..7 notes
    const home = MELODY.indexOf(74); // D5
    let i = home - 2 + Math.floor(r() * 5);
    let at = r() < 0.5 ? 0 : 1;
    const notes = [];
    for (let k = 0; k < count; k++) {
      const last = k === count - 1;
      if (last) {
        // Resolve to D or A near the current place.
        const ends = MELODY.map((m, j) => j).filter((j) => MELODY[j] % 12 === 2 || MELODY[j] % 12 === 9);
        i = ends.reduce((b, j) => (Math.abs(j - i) < Math.abs(b - i) ? j : b), ends[0]);
      }
      const len = last ? 4 : [1, 1, 2, 2, 3][Math.floor(r() * 5)];
      notes.push({ midi: MELODY[i], at, len });
      at += len + (r() < 0.2 ? 1 : 0); // an occasional breath
      // Mostly steps, sometimes a small leap; stay in range and near home.
      const step = [-2, -1, -1, 1, 1, 2][Math.floor(r() * 6)];
      i = Math.max(1, Math.min(MELODY.length - 2, i + step));
      if (Math.abs(i - home) > 5) i += i > home ? -2 : 2;
    }
    return {
      notes,
      pad: PADS[Math.floor(r() * PADS.length)].slice(),
      beats: at,
      rest: 6 + r() * 8,
    };
  }

  // ───────────── Settings ─────────────
  const state = { music: true, sounds: true };
  function storage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
  }
  (function loadPrefs() {
    try {
      const raw = storage() && storage().getItem(STORE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        if (typeof p.music === 'boolean') state.music = p.music;
        if (typeof p.sounds === 'boolean') state.sounds = p.sounds;
      }
    } catch { /* broken or blocked storage: keep defaults */ }
  })();
  function savePrefs() {
    try { const s = storage(); if (s) s.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  }

  // ───────────── Engine ─────────────
  let ac = null, sfxBus = null, musicBus = null, musicIn = null, noiseBuf = null;
  let unlocked = false, musicTimer = null, birdTimer = null, seed = (Date.now() >>> 0) || 1;
  const last = {};
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

  function ensure() {
    if (!unlocked || (!state.music && !state.sounds)) return false;
    if (!ac) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return false;
      try { ac = new AC(); } catch { ac = null; return false; }
      const master = ac.createGain();
      master.gain.value = 1;
      master.connect(ac.destination);
      sfxBus = ac.createGain();
      sfxBus.gain.value = state.sounds ? SFX_VOL : 0;
      sfxBus.connect(master);
      musicBus = ac.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(master);
      // Music goes through a soft lowpass and a quiet echo for space.
      musicIn = ac.createBiquadFilter();
      musicIn.type = 'lowpass';
      musicIn.frequency.value = 2400;
      musicIn.connect(musicBus);
      const delay = ac.createDelay(2);
      delay.delayTime.value = BEAT * 0.75;
      const fb = ac.createGain();
      fb.gain.value = 0.28;
      const damp = ac.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 1400;
      musicIn.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      damp.connect(musicBus);
      noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate), ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended' && !hidden()) { try { ac.resume(); } catch { /* ignore */ } }
    return true;
  }

  function fade(bus, to, time) {
    if (!ac || !bus) return;
    const now = ac.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(to, now + time);
  }

  // A single enveloped oscillator into `out`.
  function tone(out, f, { at = 0, d = 0.3, vol = 0.1, type = 'sine', to = 0, attack = 0.006, pan = 0 } = {}) {
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
    connectPan(g, out, pan);
    o.start(now);
    o.stop(now + d + 0.05);
  }

  // A filtered burst from the shared noise buffer.
  function noise(out, { at = 0, d = 0.1, vol = 0.2, f = 1000, q = 1, type = 'bandpass', attack = 0.004 } = {}) {
    const now = ac.currentTime + at;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const fl = ac.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + d);
    src.connect(fl);
    fl.connect(g);
    g.connect(out);
    src.start(now, Math.random() * 0.5);
    src.stop(now + d + 0.05);
  }

  function connectPan(node, out, pan) {
    if (pan && ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      p.connect(out);
    } else node.connect(out);
  }

  const vary = (f, amt = 0.04) => f * (1 + (Math.random() * 2 - 1) * amt);
  const gate = (k, gap) => {
    const now = Date.now();
    if (now - (last[k] || 0) < gap) return false;
    last[k] = now;
    return true;
  };

  // ───────────── Sounds ─────────────
  // Soft and short: a relaxing game hears these hundreds of times.
  const SOUNDS = {
    axe() { // a dull wooden chop
      noise(sfxBus, { d: 0.09, vol: 0.5, f: vary(700), q: 1.6 });
      tone(sfxBus, vary(190), { d: 0.12, vol: 0.18, type: 'triangle', to: 120 });
    },
    pick() { // stone clink
      const f = vary(1650, 0.06);
      tone(sfxBus, f, { d: 0.16, vol: 0.06 });
      tone(sfxBus, f * 1.48, { d: 0.1, vol: 0.035 });
      noise(sfxBus, { d: 0.05, vol: 0.18, f: 3200, q: 0.9, type: 'highpass' });
    },
    shovel() { // a dig into soft earth
      noise(sfxBus, { d: 0.2, vol: 0.35, f: vary(520), q: 0.8, type: 'lowpass', attack: 0.02 });
      tone(sfxBus, vary(120), { d: 0.12, vol: 0.12, type: 'sine', to: 80 });
    },
    berries() { // a little pluck
      const f = vary(880, 0.05);
      tone(sfxBus, f, { d: 0.14, vol: 0.07 });
      tone(sfxBus, f * 1.5, { at: 0.05, d: 0.16, vol: 0.05 });
    },
    contribute() { // two wooden knocks
      tone(sfxBus, freq(62), { d: 0.16, vol: 0.09, type: 'triangle' });
      tone(sfxBus, freq(69), { at: 0.08, d: 0.2, vol: 0.08, type: 'triangle' });
      noise(sfxBus, { d: 0.05, vol: 0.12, f: 900, q: 2 });
    },
    built() { // a rising pentatonic arpeggio with a soft bell on top
      [62, 66, 69, 74].forEach((m, k) => tone(sfxBus, freq(m), { at: k * 0.11, d: 0.7, vol: 0.07, type: 'triangle', attack: 0.01 }));
      tone(sfxBus, freq(86), { at: 0.44, d: 1.4, vol: 0.035 });
      tone(sfxBus, freq(86) * 2.76, { at: 0.44, d: 0.6, vol: 0.01 });
    },
    tool() { // two light anvil taps
      for (const at of [0, 0.18]) {
        tone(sfxBus, 1320, { at, d: 0.6, vol: 0.05 });
        tone(sfxBus, 1320 * 2.76, { at, d: 0.25, vol: 0.015 });
        noise(sfxBus, { at, d: 0.03, vol: 0.12, f: 4000, q: 1, type: 'highpass' });
      }
      tone(sfxBus, freq(81), { at: 0.4, d: 0.8, vol: 0.05, type: 'triangle' });
    },
    festival() { // a bell and a happy run up and back down the scale
      for (const [at, m] of [[0, 62], [0.9, 69], [1.8, 62]]) {
        tone(sfxBus, freq(m), { at, d: 2.4, vol: 0.06, attack: 0.01 });
        tone(sfxBus, freq(m) * 2.76, { at, d: 1.2, vol: 0.02 });
        tone(sfxBus, freq(m) * 5.4, { at, d: 0.5, vol: 0.008 });
      }
      [74, 76, 78, 81, 83, 86, 83, 81, 78, 81, 86].forEach((m, k) =>
        tone(sfxBus, freq(m), { at: 0.3 + k * 0.14, d: 0.45, vol: 0.05, type: 'triangle', attack: 0.01 }));
    },
  };
  const GAPS = { axe: 80, pick: 80, shovel: 80, berries: 80, contribute: 120 };

  function play(name) {
    if (!state.sounds || !SOUNDS[name] || !ensure()) return;
    if (!gate(name, GAPS[name] || 200)) return;
    try { SOUNDS[name](); } catch { /* never let sound break the game */ }
  }

  // ───────────── Music ─────────────
  function playPhrase(ph) {
    const t0 = 0.2;
    const total = (ph.beats * BEAT) + 2;
    // Pad: slow swell in, long fade out, two slightly detuned voices per note.
    for (const m of ph.pad) {
      for (const det of [-4, 4]) {
        const o = ac.createOscillator();
        o.type = 'triangle';
        o.frequency.value = freq(m);
        o.detune.value = det;
        const g = ac.createGain();
        const now = ac.currentTime + t0;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(0.09, now + 2.5);
        g.gain.setValueAtTime(0.09, now + total - 2);
        g.gain.linearRampToValueAtTime(0.0001, now + total + 2.5);
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 700;
        o.connect(lp);
        lp.connect(g);
        g.connect(musicIn);
        o.start(now);
        o.stop(now + total + 2.7);
      }
    }
    // Melody: a gentle sine with a faint octave, like a soft flute or kalimba.
    for (const n of ph.notes) {
      const at = t0 + 1.2 + n.at * BEAT;
      const d = Math.max(0.8, n.len * BEAT * 1.6);
      tone(musicIn, freq(n.midi), { at, d, vol: 0.22, attack: 0.04 });
      tone(musicIn, freq(n.midi) * 2, { at, d: d * 0.5, vol: 0.025, attack: 0.04 });
    }
    return total + 1.2;
  }

  function nextPhrase() {
    musicTimer = null;
    if (!state.music || !ensure()) return;
    let wait = 4;
    if (!hidden()) {
      seed = (seed + 1) >>> 0;
      const ph = phrase(seed);
      try { wait = playPhrase(ph) + ph.rest; } catch { wait = 10; }
    }
    musicTimer = setTimeout(nextPhrase, wait * 1000);
  }

  // Birdsong: a few short chirps from a random side every so often.
  function birds() {
    birdTimer = null;
    if (!state.music || !ensure()) return;
    if (!hidden()) {
      try {
        const base = 2600 + Math.random() * 1600, pan = Math.random() * 1.4 - 0.7;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let k = 0; k < n; k++) {
          const f = base * (1 + (Math.random() - 0.5) * 0.25);
          tone(musicIn, f, { at: k * (0.1 + Math.random() * 0.08), d: 0.08 + Math.random() * 0.06, vol: 0.05, to: f * (Math.random() < 0.5 ? 1.3 : 0.8), attack: 0.01, pan });
        }
      } catch { /* ignore */ }
    }
    birdTimer = setTimeout(birds, (9 + Math.random() * 16) * 1000);
  }

  function startMusic() {
    if (!state.music || !ensure()) return;
    fade(musicBus, MUSIC_VOL, 3);
    if (!musicTimer) musicTimer = setTimeout(nextPhrase, 1500);
    if (!birdTimer) birdTimer = setTimeout(birds, 5000);
  }
  function stopMusic() {
    if (musicTimer) clearTimeout(musicTimer);
    if (birdTimer) clearTimeout(birdTimer);
    musicTimer = birdTimer = null;
    fade(musicBus, 0, 0.6);
  }

  // ───────────── Public ─────────────
  // Called from user gestures only (key, tap, click): the context is created lazily here.
  function unlock() {
    if (unlocked && ac && ac.state === 'running') return;
    unlocked = true;
    if (!ensure()) return;
    if (state.music) startMusic();
  }
  function setMusic(on) {
    state.music = !!on;
    savePrefs();
    if (state.music) startMusic(); else stopMusic();
  }
  function setSounds(on) {
    state.sounds = !!on;
    savePrefs();
    if (state.sounds) ensure();
    if (sfxBus) fade(sfxBus, state.sounds ? SFX_VOL : 0, 0.1);
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (!ac) return;
      try {
        if (hidden()) ac.suspend();
        else if (state.music || state.sounds) ac.resume();
      } catch { /* ignore */ }
    });
  }

  const api = {
    state,
    STORE_KEY,
    PENTATONIC,
    MELODY,
    SOUND_NAMES: Object.keys(SOUNDS),
    phrase,
    unlock,
    play,
    setMusic,
    setSounds,
    get started() { return !!ac; },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VillageAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
