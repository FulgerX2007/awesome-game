'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FILE = path.join(__dirname, '..', '..', 'web', 'rush', 'audio.js');
const SRC = fs.readFileSync(FILE, 'utf8');
const GAME = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'rush', 'game.js'), 'utf8');
const audio = require(FILE);

// A minimal fake WebAudio graph: enough surface for audio.js, counting created contexts and sources.
function fakeWebAudio() {
  const stats = { contexts: 0, started: 0, resumed: 0, suspended: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {},
  });
  const node = () => ({
    connect() {}, disconnect() {}, start() { stats.started++; }, stop() {},
    gain: param(), frequency: param(), Q: param(), detune: param(),
    type: '', buffer: null,
  });
  class AudioContext {
    constructor() { stats.contexts++; this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = node(); }
    createGain() { return node(); }
    createOscillator() { return node(); }
    createBiquadFilter() { return node(); }
    createBufferSource() { return node(); }
    createBuffer(ch, len) { return { length: len, getChannelData: () => new Float32Array(len) }; }
    // Real browsers may reject these promises; audio.js must swallow the rejection.
    resume() { stats.resumed++; return Promise.reject(new Error('not allowed')); }
    suspend() { stats.suspended++; this.state = 'suspended'; return Promise.reject(new Error('not allowed')); }
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

// Runs audio.js as the browser would (window.RushAudio) in a fresh sandbox.
function browserAudio({ storage = fakeStorage(), withAudio = true, storageThrows = false } = {}) {
  const fake = fakeWebAudio();
  const listeners = {};
  const document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
  };
  const setVisibility = (v) => {
    document.visibilityState = v;
    for (const fn of listeners.visibilitychange || []) fn();
  };
  const win = { document };
  if (storageThrows) Object.defineProperty(win, 'localStorage', { get() { throw new Error('SecurityError'); } });
  else win.localStorage = storage;
  if (withAudio) win.AudioContext = fake.AudioContext;
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC, win);
  return { A: win.RushAudio, stats: fake.stats, storage, setVisibility, win };
}

test('audio.js loads in Node without AudioContext and every call is a no-op', () => {
  assert.doesNotThrow(() => {
    audio.unlock();
    for (const n of audio.SOUND_NAMES) audio.play(n);
    audio.play('nope');
    audio.play('constructor');
    audio.setEnabled(false);
    audio.setEnabled(true);
  });
  assert.equal(audio.started, false);
  assert.equal(audio.enabled, true);
  assert.equal(audio.STORE_KEY, 'rush.audio');
});

test('works without AudioContext in a browser too', () => {
  const { A } = browserAudio({ withAudio: false });
  assert.doesNotThrow(() => { A.unlock(); A.play('win'); A.setEnabled(false); A.setEnabled(true); });
  assert.equal(A.started, false);
});

test('the interface game.js relies on, and every sound it plays exists', () => {
  const { A } = browserAudio();
  assert.equal(typeof A.enabled, 'boolean');
  for (const fn of ['setEnabled', 'unlock', 'play']) assert.equal(typeof A[fn], 'function', fn);
  const used = new Set([...GAME.matchAll(/sfx\('([a-z]+)'/g)].map((m) => m[1]));
  for (const n of ['gate', 'hit', 'fall', 'battle', 'clash', 'coin', 'win', 'lose']) assert.ok(used.has(n), `game.js plays ${n}`);
  for (const n of used) assert.ok(A.SOUND_NAMES.includes(n), `audio.js has ${n}`);
  assert.match(GAME, /sfx\('gate', \{ good: e\.good \}\)/, 'the gate sound gets the good flag');
});

// Records every oscillator's start frequency, so a test can compare the pitch of two sounds.
function pitchProbe() {
  const { A, stats, win } = browserAudio();
  const freqs = [];
  const Orig = win.AudioContext;
  win.AudioContext = class extends Orig {
    createOscillator() {
      const o = super.createOscillator();
      o.frequency.setValueAtTime = (f) => { freqs.push(f); };
      return o;
    }
  };
  A.unlock();
  return { A, stats, freqs };
}

test('a good gate sounds higher than a bad one; opts are optional and junk opts are safe', () => {
  const good = pitchProbe();
  good.A.play('gate', { good: true });
  const bad = pitchProbe();
  bad.A.play('gate', { good: false });
  assert.ok(good.freqs.length > 0 && bad.freqs.length > 0);
  assert.ok(Math.min(...good.freqs) > Math.max(...bad.freqs), `${good.freqs} vs ${bad.freqs}`);
  const p = pitchProbe();
  for (const opts of [undefined, null, 42, 'x', {}]) {
    assert.doesNotThrow(() => p.A.play('gate', opts));
    p.A.play('battle', opts);
  }
});

test('the rate limit is per sound: a second gate in the same frame is dropped, other sounds still play', () => {
  const { A, stats } = browserAudio();
  A.unlock();
  A.play('gate', { good: true });
  const one = stats.started;
  A.play('gate', { good: false });
  assert.equal(stats.started, one, 'the same frame: limited');
  A.play('win');
  assert.ok(stats.started > one, 'other sounds are not limited by the gate');
});

test('no AudioContext before a gesture; one lazy context after unlock; sounds play', () => {
  const { A, stats } = browserAudio();
  A.play('hit');
  A.setEnabled(true);
  assert.equal(stats.contexts, 0, 'nothing before a gesture');
  A.unlock();
  assert.equal(stats.contexts, 1);
  A.unlock();
  assert.equal(stats.contexts, 1);
  const before = stats.started;
  for (const n of A.SOUND_NAMES) A.play(n);
  assert.ok(stats.started > before);
});

test('a sound is rate-limited when the game reports it every frame', () => {
  const { A, stats } = browserAudio();
  A.unlock();
  A.play('clash');
  const once = stats.started;
  for (let i = 0; i < 20; i++) A.play('clash');
  assert.equal(stats.started, once);
});

test('sound off: unlock creates nothing and play is silent; turning it on later works', () => {
  const { A, stats } = browserAudio({ storage: fakeStorage({ 'rush.audio': '{"enabled":false}' }) });
  assert.equal(A.enabled, false);
  A.unlock();
  A.play('win');
  assert.equal(stats.contexts, 0);
  A.setEnabled(true); // the toggle is a gesture itself
  assert.equal(stats.contexts, 1);
  const before = stats.started;
  A.play('win');
  assert.ok(stats.started > before);
  A.setEnabled(false);
  const after = stats.started;
  A.play('lose');
  assert.equal(stats.started, after);
  assert.equal(stats.suspended, 1, 'turning sound off suspends the context');
});

test('the toggle is saved to rush.audio and survives a reload', () => {
  const storage = fakeStorage();
  const first = browserAudio({ storage });
  first.A.setEnabled(false);
  assert.deepEqual(JSON.parse(storage.data['rush.audio']), { enabled: false });
  const second = browserAudio({ storage });
  assert.equal(second.A.enabled, false);
  second.A.setEnabled(true);
  assert.equal(browserAudio({ storage }).A.enabled, true);
});

test('broken, foreign or blocked rush.audio keeps the default and the toggle still works', () => {
  for (const raw of ['{oops', 'null', '42', '{"enabled":"no"}', '[]']) {
    const { A } = browserAudio({ storage: fakeStorage({ 'rush.audio': raw }) });
    assert.equal(A.enabled, true, raw);
  }
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  const b = browserAudio({ storage: blocked });
  assert.equal(b.A.enabled, true);
  assert.doesNotThrow(() => b.A.setEnabled(false));
  assert.equal(b.A.enabled, false, 'works for this visit even if it cannot be saved');
  const t = browserAudio({ storageThrows: true });
  assert.equal(t.A.enabled, true);
  assert.doesNotThrow(() => { t.A.setEnabled(false); t.A.unlock(); t.A.play('hit'); });
  assert.equal(t.A.enabled, false);
});

test('a hidden tab suspends the context; rejected promises are swallowed', async () => {
  const { A, stats, setVisibility } = browserAudio();
  A.unlock();
  setVisibility('hidden');
  assert.equal(stats.suspended, 1);
  setVisibility('visible');
  assert.ok(stats.resumed > 0);
  let unhandled = 0;
  const onUnhandled = () => { unhandled++; };
  process.on('unhandledRejection', onUnhandled);
  await new Promise((r) => setImmediate(r));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, 0);
});
