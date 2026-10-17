'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FILE = path.join(__dirname, '..', '..', 'web', 'winter', 'audio.js');
const SRC = fs.readFileSync(FILE, 'utf8');
const GAME = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'winter', 'game.js'), 'utf8');
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

// Runs audio.js as the browser would (window.HeroAudio) in a fresh sandbox.
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
  return { A: win.WinterAudio, stats: fake.stats, storage, setVisibility, win };
}

test('audio.js loads in Node without AudioContext and every call is a no-op', () => {
  assert.doesNotThrow(() => {
    audio.unlock();
    for (const n of audio.SOUND_NAMES) audio.play(n);
    audio.play('nope');
    audio.play('constructor');
    audio.setEnabled(false);
    audio.setEnabled(true);
    audio.setLoop('wind', 1);
    audio.setLoop('crackle', 0);
  });
  assert.equal(audio.started, false);
  assert.equal(audio.enabled, true);
  assert.equal(audio.STORE_KEY, 'winter.audio');
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
  // sounds picked by a ternary: sfx(cond ? 'win' : 'lose')
  for (const m of GAME.matchAll(/sfx\([^)?]*\?\s*'([a-z]+)'\s*:\s*'([a-z]+)'/g)) { used.add(m[1]); used.add(m[2]); }
  for (const n of ['chop', 'mine', 'step', 'pick', 'eat', 'fire', 'howl', 'bite', 'hit', 'build', 'craft', 'rescue', 'dawn', 'win', 'lose',
    'roar', 'bells', 'trade', 'snare', 'aurora', 'creak']) {
    assert.ok(used.has(n), `game.js plays ${n}`);
  }
  for (const n of used) assert.ok(A.SOUND_NAMES.includes(n), `audio.js has ${n}`);
});

// Records every oscillator's start frequency, so a test can compare the pitch of two sounds; call A.unlock() next.
function pitchProbe() {
  const { A, stats, win } = browserAudio();
  const freqs = [];
  const ret = { A, stats, freqs, win };
  const Orig = win.AudioContext;
  win.AudioContext = class extends Orig {
    createOscillator() {
      const o = super.createOscillator();
      o.frequency.setValueAtTime = (f) => { freqs.push(f); };
      return o;
    }
  };
  return ret;
}

// Records every oscillator's start frequency and the latest stop time, so a test can compare pitch and length.
function probe(name, opts) {
  const p = pitchProbe();
  let end = 0;
  const Orig = p.win.AudioContext;
  p.win.AudioContext = class extends Orig {
    createBufferSource() {
      const n = super.createBufferSource();
      n.stop = (t) => { end = Math.max(end, t); };
      return n;
    }
  };
  p.A.unlock();
  p.A.play(name, opts);
  return { freqs: p.freqs, end: () => end };
}

test('the pick rings higher than the axe; the wolf howls in the middle range', () => {
  const chop = probe('chop'), mine = probe('mine'), howl = probe('howl');
  assert.ok(mine.freqs[0] > chop.freqs[0], `${mine.freqs} vs ${chop.freqs}`);
  assert.ok(howl.freqs.every((f) => f > 250 && f < 600), `${howl.freqs}`);
  for (const opts of [undefined, null, 42, 'x', {}]) {
    const p = pitchProbe();
    p.A.unlock();
    assert.doesNotThrow(() => p.A.play('bite', opts));
    assert.ok(p.freqs.length > 0 && p.freqs.every(Number.isFinite), JSON.stringify(opts));
  }
});

test('the crackle and wind loops start, fade and stop when the sound goes off', () => {
  const { A, stats } = browserAudio();
  A.setLoop('wind', 1);
  assert.deepEqual([...A.loops], [], 'nothing before a gesture');
  A.unlock();
  A.setLoop('wind', 1);
  A.setLoop('crackle', 0.5);
  assert.deepEqual([...A.loops].sort(), ['crackle', 'wind']);
  const started = stats.started;
  A.setLoop('wind', 0.2);
  assert.equal(stats.started, started, 'a level change does not start a new source');
  A.setLoop('rain', 1);
  assert.deepEqual([...A.LOOP_NAMES], ['crackle', 'wind']);
  A.setEnabled(false);
  assert.deepEqual([...A.loops], [], 'sound off stops the loops');
  A.setLoop('wind', 1);
  assert.deepEqual([...A.loops], []);
  const game = GAME;
  assert.match(game, /Sound\.setLoop\('crackle'/);
  assert.match(game, /Sound\.setLoop\('wind'/);
});

test('the rate limit is per sound: hits every tick are thinned, other sounds still play', () => {
  const { A, stats } = browserAudio();
  A.unlock();
  A.play('chop');
  const one = stats.started;
  for (let i = 0; i < 10; i++) A.play('chop');
  assert.equal(stats.started, one, 'the same moment: limited');
  A.play('bite');
  assert.ok(stats.started > one, 'other sounds are not limited by the axe');
});

test('no AudioContext before a gesture; one lazy context after unlock; sounds play', () => {
  const { A, stats } = browserAudio();
  A.play('wall');
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
  A.play('wall');
  const once = stats.started;
  for (let i = 0; i < 20; i++) A.play('wall');
  assert.equal(stats.started, once);
});

test('sound off: unlock creates nothing and play is silent; turning it on later works', () => {
  const { A, stats } = browserAudio({ storage: fakeStorage({ 'winter.audio': '{"enabled":false}' }) });
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

test('the toggle is saved to winter.audio and survives a reload', () => {
  const storage = fakeStorage();
  const first = browserAudio({ storage });
  first.A.setEnabled(false);
  assert.deepEqual(JSON.parse(storage.data['winter.audio']), { enabled: false });
  const second = browserAudio({ storage });
  assert.equal(second.A.enabled, false);
  second.A.setEnabled(true);
  assert.equal(browserAudio({ storage }).A.enabled, true);
});

test('broken, foreign or blocked winter.audio keeps the default and the toggle still works', () => {
  for (const raw of ['{oops', 'null', '42', '{"enabled":"no"}', '[]']) {
    const { A } = browserAudio({ storage: fakeStorage({ 'winter.audio': raw }) });
    assert.equal(A.enabled, true, raw);
  }
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  const b = browserAudio({ storage: blocked });
  assert.equal(b.A.enabled, true);
  assert.doesNotThrow(() => b.A.setEnabled(false));
  assert.equal(b.A.enabled, false, 'works for this visit even if it cannot be saved');
  const t = browserAudio({ storageThrows: true });
  assert.equal(t.A.enabled, true);
  assert.doesNotThrow(() => { t.A.setEnabled(false); t.A.unlock(); t.A.play('wall'); });
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

test('the expansion sounds play once unlocked and are rate-limited: the bear growls low, the bells ring high', () => {
  for (const n of ['roar', 'bells', 'trade', 'snare', 'aurora', 'creak']) {
    const { A, stats } = browserAudio();
    A.unlock();
    const before = stats.started;
    A.play(n);
    assert.ok(stats.started > before, `${n} starts something`);
    const mid = stats.started;
    A.play(n);
    assert.equal(stats.started, mid, `${n} is rate-limited`);
  }
  const lo = pitchProbe(); lo.A.unlock(); lo.A.play('roar');
  const hi = pitchProbe(); hi.A.unlock(); hi.A.play('bells');
  assert.ok(Math.max(...lo.freqs) < 200 && Math.min(...hi.freqs) > 1000, `${lo.freqs} vs ${hi.freqs}`);
});
