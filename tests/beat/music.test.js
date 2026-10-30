'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FILE = path.join(__dirname, '..', '..', 'web', 'beat', 'music.js');
const C = require('../../web/beat/core.js');

// A fresh copy of music.js, so each test sets up its own globals (AudioContext, localStorage).
function load() {
  delete require.cache[require.resolve(FILE)];
  return require(FILE);
}
const M = load();

// Every note of a stretch of steps, as [step, voice] pairs.
function notes(levels, from, to, seed = 1) {
  const out = [];
  for (let s = from; s < to; s++) for (const n of M.compose(levels, s, seed)) out.push({ step: s, ...n });
  return out;
}
const voices = (list, v) => list.filter((n) => n.v === v);

test('with no band only the metronome ticks, louder on the downbeat', () => {
  const list = notes({}, 0, 32);
  assert.deepEqual([...new Set(list.map((n) => n.v))], ['tick']);
  assert.deepEqual(list.map((n) => n.step), [0, 4, 8, 12, 16, 20, 24, 28]);
  assert.deepEqual(list.map((n) => n.m), [1, 0, 0, 0, 1, 0, 0, 0]);
});

test('every musician adds its own part', () => {
  const one = { shaker: 1, bass: 1, guitar: 1, keys: 1, sax: 1 };
  const list = notes(one, 0, 64);
  assert.deepEqual(voices(list, 'bass').map((n) => n.step % 16), [0, 8, 0, 8, 0, 8, 0, 8], 'bass on beats 1 and 3');
  assert.deepEqual([...new Set(voices(list, 'bass').map((n) => n.m))], M.PROG.map((p) => p.root), 'the bass follows Am F C G');
  assert.ok(voices(list, 'guitar').every((n) => n.step % 4 === 2 && n.m.length === 3), 'guitar chops on the offbeats');
  assert.deepEqual(voices(list, 'pad').map((n) => n.step), [0, 16, 32, 48], 'a pad chord every bar');
  assert.ok(voices(list, 'shaker').every((n) => n.step % 2 === 0), 'the shaker plays eighths');
  // a sax below level 10 answers in every other two-bar phrase: bars 2–3 of four
  const sax = voices(list, 'sax');
  assert.ok(sax.length > 4);
  assert.ok(sax.every((n) => n.step >= 32 && n.step < 64), JSON.stringify(sax.map((n) => n.step)));
  assert.ok(sax.every((n) => M.SCALE.includes(n.m)), 'the sax keeps to the pentatonic');
  assert.ok(voices(list, 'tick').every((n) => n.g < 1), 'the metronome steps back when the band plays');
});

test('levels make the parts richer', () => {
  const low = notes({ shaker: 9, bass: 9, guitar: 9, keys: 9, sax: 9 }, 0, 128);
  const high = notes({ shaker: 10, bass: 25, guitar: 10, keys: 10, sax: 10 }, 0, 128);
  for (const v of ['shaker', 'bass', 'guitar', 'sax']) assert.ok(voices(high, v).length > voices(low, v).length, v);
  assert.ok(voices(low, 'pluck').length === 0 && voices(high, 'pluck').length > 0, 'the keys start an arpeggio');
  assert.ok(voices(high, 'sax').some((n) => n.step < 32), 'a seasoned sax plays every phrase');
});

test('compose is pure: the same step, levels and seed give the same notes', () => {
  const lv = { shaker: 30, bass: 30, guitar: 30, keys: 30, sax: 30 };
  assert.deepEqual(notes(lv, 0, 256, 5), notes(lv, 0, 256, 5));
  assert.notDeepEqual(voices(notes(lv, 0, 256, 5), 'sax'), voices(notes(lv, 0, 256, 6), 'sax'), 'another seed, another tune');
  assert.deepEqual(M.compose(lv, -3), M.compose(lv, 253), 'negative steps wrap like any other');
});

test('without WebAudio everything is a safe no-op and the clock still runs', () => {
  delete globalThis.AudioContext;
  const m = load();
  assert.equal(m.unlock(), false);
  assert.equal(m.ready, false);
  const a = m.now();
  assert.ok(Number.isFinite(a) && Math.abs(m.heardNow() - a) < 0.05);
  assert.ok(m.heardAt(performance.now() - 100) < m.heardNow());
  m.hit('perfect'); m.coin(); m.tier(); m.pump(); m.suspend(); m.resume();
});

// A fake WebAudio graph: enough surface for music.js, counting oscillators and noise sources.
function fakeWebAudio() {
  const stats = { contexts: 0, oscillators: 0, sources: 0, starts: [] };
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({
    connect() {}, disconnect() {}, start(at) { stats.starts.push(at); }, stop() {},
    gain: param(), frequency: param(), Q: param(), detune: param(), threshold: param(), ratio: param(), attack: param(), type: '', buffer: null,
  });
  class AudioContext {
    constructor() { stats.contexts++; this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = node(); }
    createGain() { return node(); }
    createOscillator() { stats.oscillators++; return node(); }
    createBiquadFilter() { return node(); }
    createBufferSource() { stats.sources++; return node(); }
    createDynamicsCompressor() { return node(); }
    createConvolver() { return node(); }
    createBuffer(ch, len) { return { length: len, getChannelData: () => new Float32Array(len) }; }
    resume() { return Promise.reject(new Error('not allowed')); }
    suspend() { this.state = 'suspended'; return Promise.reject(new Error('not allowed')); }
  }
  return { AudioContext, stats };
}

test('the scheduler books the band on the audio clock, only a little ahead', () => {
  const { AudioContext, stats } = fakeWebAudio();
  globalThis.AudioContext = AudioContext;
  const realInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0; // pump() is driven by hand below
  try {
    const m = load();
    assert.equal(m.unlock(), true);
    assert.equal(m.unlock(), true);
    assert.equal(stats.contexts, 1, 'one context for the whole page');
    const s = C.newState();
    s.levels = { bass: 1 };
    C.start(s, 0.5);
    m.play({ grid: () => s.run.grid, levels: () => s.levels, seed: 1 });
    const ac = m.context;
    m.pump();
    assert.equal(stats.oscillators, 0, 'nothing before the first beat is near');
    ac.currentTime = 0.45;
    m.pump();
    assert.ok(stats.oscillators > 0, 'beat 0 (tick and bass) is booked');
    assert.ok(stats.starts.every((t) => t <= 0.45 + m.LOOKAHEAD + 1e-9), 'never further ahead than LOOKAHEAD');
    assert.ok(stats.starts.some((t) => Math.abs(t - 0.5) < 1e-9), 'exactly on the beat');
    const booked = stats.oscillators;
    m.pump();
    assert.equal(stats.oscillators, booked, 'a step is booked once');
    // muted: steps still advance, but no sound is made
    m.setEnabled(false);
    ac.currentTime = 2;
    m.pump();
    assert.equal(stats.oscillators, booked);
    m.hit('good');
    assert.equal(stats.oscillators, booked, 'no drum either');
    m.setEnabled(true);
    ac.currentTime = C.timeOf(s.run.grid, 4) - 0.05; // just before beat 4
    m.pump();
    assert.ok(stats.oscillators > booked, 'it plays on from where it is, not from where it stopped');
    assert.ok(stats.starts.filter((t) => t > 2).every((t) => t >= ac.currentTime - 0.006), 'late steps are skipped, not played out of time');
    // the player's drum and the effects play at once
    const before = stats.oscillators;
    m.hit('perfect'); m.coin(); m.tier();
    assert.ok(stats.oscillators >= before + 6);
  } finally {
    globalThis.setInterval = realInterval;
    delete globalThis.AudioContext;
  }
});

test('the sound switch is remembered; broken or blocked storage keeps it on', () => {
  const data = {};
  globalThis.localStorage = { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
  try {
    let m = load();
    assert.equal(m.enabled, true);
    m.toggle();
    assert.equal(JSON.parse(data[m.STORE_KEY]).enabled, false);
    m = load();
    assert.equal(m.enabled, false, 'restored after a reload');
    data[m.STORE_KEY] = '{oops';
    assert.equal(load().enabled, true);
    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    m = load();
    assert.equal(m.enabled, true);
    m.toggle();
    assert.equal(m.enabled, false, 'still toggles without storage');
  } finally {
    delete globalThis.localStorage;
  }
});
