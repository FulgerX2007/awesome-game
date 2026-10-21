'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FILE = path.join(__dirname, '..', '..', 'web', 'village', 'audio.js');
const SRC = fs.readFileSync(FILE, 'utf8');
const audio = require(FILE);
const view = require(path.join(__dirname, '..', '..', 'web', 'village', 'view.js'));

// A minimal fake WebAudio graph: enough surface for audio.js, counting created contexts and sources.
function fakeWebAudio() {
  const stats = { contexts: 0, started: 0, resumed: 0, suspended: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {},
  });
  const node = () => ({
    connect() {}, disconnect() {}, start() { stats.started++; }, stop() {},
    gain: param(), frequency: param(), Q: param(), detune: param(), delayTime: param(), pan: param(),
    type: '', buffer: null,
  });
  class AudioContext {
    constructor() { stats.contexts++; this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = node(); }
    createGain() { return node(); }
    createOscillator() { return node(); }
    createBiquadFilter() { return node(); }
    createBufferSource() { return node(); }
    createDelay() { return node(); }
    createStereoPanner() { return node(); }
    createBuffer(ch, len) { return { length: len, getChannelData: () => new Float32Array(len) }; }
    // Real browsers may reject these promises; audio.js must swallow the rejection.
    resume() { stats.resumed++; return Promise.reject(new Error('not allowed')); }
    suspend() { stats.suspended++; return Promise.reject(new Error('not allowed')); }
  }
  return { AudioContext, stats };
}

function fakeStorage(init = {}) {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

// Runs audio.js as the browser would (window.VillageAudio) in a fresh sandbox.
function browserAudio({ storage = fakeStorage(), withAudio = true } = {}) {
  const fake = fakeWebAudio();
  const timers = [];
  const listeners = {};
  const document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
  };
  // Switch the fake tab's visibility and fire visibilitychange.
  const setVisibility = (v) => {
    document.visibilityState = v;
    for (const fn of listeners.visibilitychange || []) fn();
  };
  const win = {
    document,
    localStorage: storage,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
  };
  if (withAudio) win.AudioContext = fake.AudioContext;
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC, win);
  return { A: win.VillageAudio, stats: fake.stats, storage, timers, setVisibility };
}

test('audio.js loads in Node without AudioContext and every call is a no-op', () => {
  assert.doesNotThrow(() => {
    audio.unlock();
    for (const n of audio.SOUND_NAMES) audio.play(n);
    audio.play('nope');
    audio.setMusic(true);
    audio.setSounds(true);
    audio.setMusic(false);
  });
  assert.equal(audio.started, false);
});

test('all the planned sounds exist', () => {
  for (const n of ['axe', 'pick', 'shovel', 'berries', 'contribute', 'built', 'tool', 'festival', 'water', 'bucket', 'coins', 'fair', 'harvest',
    'cast', 'bite', 'catch', 'escape', 'lanterns']) {
    assert.ok(audio.SOUND_NAMES.includes(n), n);
  }
});

test('phrase notes come only from the pentatonic scale', () => {
  const pent = new Set(audio.PENTATONIC);
  assert.equal(pent.size, 5);
  for (const m of audio.MELODY) assert.ok(pent.has(m % 12));
  for (let seed = 1; seed <= 500; seed++) {
    const ph = audio.phrase(seed);
    assert.ok(ph.notes.length >= 4 && ph.notes.length <= 7);
    for (const n of ph.notes) {
      assert.ok(pent.has(((n.midi % 12) + 12) % 12), `seed ${seed}: ${n.midi}`);
      assert.ok(audio.MELODY.includes(n.midi));
      assert.ok(n.len > 0 && n.at >= 0);
    }
    for (const m of ph.pad) assert.ok(pent.has(m % 12), `pad ${m}`);
    // Ends at rest on D or A, notes in order, long pauses between phrases.
    assert.ok([2, 9].includes(ph.notes.at(-1).midi % 12));
    for (let k = 1; k < ph.notes.length; k++) assert.ok(ph.notes[k].at >= ph.notes[k - 1].at + ph.notes[k - 1].len);
    assert.ok(ph.rest >= 6 && ph.rest <= 14);
    assert.ok(ph.beats >= ph.notes.at(-1).at + ph.notes.at(-1).len);
  }
});

test('phrase is a pure function of the seed', () => {
  assert.deepEqual(audio.phrase(42), audio.phrase(42));
  const distinct = new Set();
  for (let seed = 1; seed <= 30; seed++) distinct.add(JSON.stringify(audio.phrase(seed).notes));
  assert.ok(distinct.size > 20);
});

test('no AudioContext before a gesture; one lazy context after unlock', () => {
  const { A, stats, timers } = browserAudio();
  A.setMusic(true);
  A.setSounds(true);
  A.play('axe');
  assert.equal(stats.contexts, 0);
  assert.equal(timers.length, 0, 'music must not be scheduled before a gesture');
  A.unlock();
  assert.equal(stats.contexts, 1);
  assert.ok(timers.length > 0, 'music starts after the gesture');
  A.unlock();
  assert.equal(stats.contexts, 1);
  // Each sound and a music phrase play through the fake graph without throwing.
  const before = stats.started;
  for (const n of A.SOUND_NAMES) A.play(n);
  assert.ok(stats.started > before);
  for (const t of timers.splice(0)) t.fn();
  assert.ok(stats.started > before);
});

test('a hidden tab suspends the context and skips music phrases', async () => {
  const { A, stats, timers, setVisibility } = browserAudio();
  A.unlock();
  setVisibility('hidden');
  assert.equal(stats.suspended, 1);
  const before = stats.started;
  for (const t of timers.splice(0)) t.fn();
  assert.equal(stats.started, before, 'no new sources while hidden');
  assert.ok(timers.length > 0, 'music keeps its schedule for later');
  setVisibility('visible');
  assert.ok(stats.resumed > 0);
  // Rejected resume()/suspend() promises must not surface as unhandled rejections.
  let unhandled = 0;
  const onUnhandled = () => { unhandled++; };
  process.on('unhandledRejection', onUnhandled);
  await new Promise((r) => setImmediate(r));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, 0);
});

test('with music and sounds off, unlock creates nothing', () => {
  const { A, stats, timers } = browserAudio({ storage: fakeStorage({ 'village.audio': '{"music":false,"sounds":false}' }) });
  assert.equal(A.state.music, false);
  assert.equal(A.state.sounds, false);
  A.unlock();
  A.play('axe');
  assert.equal(stats.contexts, 0);
  assert.equal(timers.length, 0);
  A.setSounds(true); // a later gesture (checkbox) turns sound on
  assert.equal(stats.contexts, 1);
});

test('toggles are saved to village.audio and survive a reload', () => {
  const storage = fakeStorage();
  const first = browserAudio({ storage });
  first.A.setMusic(false);
  assert.deepEqual(JSON.parse(storage.data['village.audio']), { music: false, sounds: true });
  first.A.setSounds(false);
  const second = browserAudio({ storage });
  assert.equal(second.A.state.music, false);
  assert.equal(second.A.state.sounds, false);
});

test('a broken or blocked village.audio keeps the defaults', () => {
  const { A } = browserAudio({ storage: fakeStorage({ 'village.audio': '{oops' }) });
  assert.equal(A.state.music, true);
  assert.equal(A.state.sounds, true);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  const b = browserAudio({ storage: blocked });
  assert.doesNotThrow(() => b.A.setMusic(false));
  assert.equal(b.A.state.music, false);
});

test('works without AudioContext in a browser too', () => {
  const { A } = browserAudio({ withAudio: false });
  assert.doesNotThrow(() => { A.unlock(); A.play('built'); A.setMusic(true); });
  assert.equal(A.started, false);
});

test('soundFor maps core events to sounds', () => {
  assert.equal(view.soundFor({ type: 'hit', kind: 'tree' }), 'axe');
  assert.equal(view.soundFor({ type: 'hit', kind: 'rock' }), 'pick');
  assert.equal(view.soundFor({ type: 'hit', kind: 'clay' }), 'shovel');
  assert.equal(view.soundFor({ type: 'hit', kind: 'bush' }), 'berries');
  assert.equal(view.soundFor({ type: 'contribute', id: 'well' }), 'contribute');
  assert.equal(view.soundFor({ type: 'decor', kind: 'bench' }), 'contribute');
  assert.equal(view.soundFor({ type: 'built', id: 'well', effect: 'water' }), 'built');
  assert.equal(view.soundFor({ type: 'built', id: 'chapel', effect: 'festival' }), null);
  assert.equal(view.soundFor({ type: 'tool', tool: 'axe', level: 2 }), 'tool');
  assert.equal(view.soundFor({ type: 'festival' }), 'festival');
  for (const type of ['deplete', 'regrow', 'ruin', 'unknown']) assert.equal(view.soundFor({ type }), null);
  assert.equal(view.soundFor(null), null);
  for (const n of ['tree', 'rock', 'clay', 'bush']) assert.ok(audio.SOUND_NAMES.includes(view.soundFor({ type: 'hit', kind: n })));
});

test('ambience follows the hour and the season', () => {
  assert.equal(audio.ambience({ part: 'day', season: 'summer' }), 'birds');
  assert.equal(audio.ambience({ part: 'dawn', season: 'spring' }), 'birds');
  assert.equal(audio.ambience({ part: 'night', season: 'summer' }), 'crickets');
  assert.equal(audio.ambience({ part: 'dusk', season: 'autumn' }), 'crickets');
  assert.equal(audio.ambience({ part: 'day', season: 'winter' }), 'wind');
  assert.equal(audio.ambience({ part: 'night', season: 'winter' }), 'wind');
  audio.setScene('night', 'winter'); // no AudioContext: just remembered, never throws
});

test('every sound soundFor names exists in the synth', () => {
  const VV = require('../../web/village/view.js');
  const events = [
    { type: 'hit', kind: 'tree' }, { type: 'hit', kind: 'apple' }, { type: 'contribute' }, { type: 'built' }, { type: 'tool' },
    { type: 'festival' }, { type: 'plot', result: 'watered' }, { type: 'plot', result: 'sown' }, { type: 'plot', result: 'harvest' },
    { type: 'bucket', n: 6 }, { type: 'order' }, { type: 'buy' }, { type: 'harvest-festival' },
    { type: 'cast' }, { type: 'bite' }, { type: 'catch', gain: 1 }, { type: 'escape' }, { type: 'gone' }, { type: 'lantern-festival' },
  ];
  for (const e of events) {
    const n = VV.soundFor(e);
    assert.ok(n && audio.SOUND_NAMES.includes(n), `${e.type}: ${n}`);
  }
});

test('the fishing and lantern sounds each play through the fake graph', () => {
  const { A, stats } = browserAudio();
  A.setSounds(true);
  A.unlock();
  for (const n of ['cast', 'bite', 'catch', 'escape', 'lanterns']) {
    const before = stats.started;
    A.play(n);
    assert.ok(stats.started > before, `${n} starts its voices`);
  }
});
