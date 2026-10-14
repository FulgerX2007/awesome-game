'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../web/pins/core.js');

// A Storage-like object backed by a Map; `broken` makes every call throw (blocked site data).
function memoryStorage(broken = false) {
  const m = new Map();
  return {
    m,
    getItem(k) { if (broken) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (broken) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
  };
}

test('a fresh storage loads a clean progress', () => {
  const p = P.loadProgress(memoryStorage());
  assert.deepEqual(p, { v: 1, stars: {} });
  assert.deepEqual(P.newProgress(), { v: 1, stars: {} });
  assert.equal(P.PROGRESS_KEY, 'pins.progress');
});

test('progress saves under pins.progress and loads back', () => {
  const st = memoryStorage();
  const p = P.newProgress();
  assert.equal(P.recordStars(p, 0, 3), true);
  assert.equal(P.recordStars(p, 1, 1), true);
  assert.equal(P.saveProgress(st, p), true);
  assert.deepEqual(JSON.parse(st.m.get('pins.progress')), { v: 1, stars: { 0: 3, 1: 1 } });
  const q = P.loadProgress(st);
  assert.deepEqual(q, { v: 1, stars: { 0: 3, 1: 1 } });
  assert.equal(P.starsOf(q, 0), 3);
  assert.equal(P.starsOf(q, 5), 0);
});

test('broken or foreign JSON falls back to a clean state', () => {
  for (const raw of ['{', 'null', '42', '"text"', '[]', '{"v":2,"stars":{"0":3}}', '{"v":1}', '{"v":1,"stars":5}', '{"stars":{"0":3}}']) {
    const st = memoryStorage();
    st.m.set('pins.progress', raw);
    assert.deepEqual(P.loadProgress(st), { v: 1, stars: {} }, raw);
  }
});

test('junk entries are dropped and good ones kept', () => {
  const st = memoryStorage();
  st.m.set('pins.progress', JSON.stringify({
    v: 1,
    stars: { 0: 2, 1: 0, 2: 4, 3: 1.5, 4: '3', x: 3, '-1': 2, 5: 3, 99999: 3, 1.5: 2 },
    extra: 'ignored',
  }));
  assert.deepEqual(P.loadProgress(st), { v: 1, stars: { 0: 2, 5: 3 } });
});

test('blocked or missing storage never throws', () => {
  const bad = memoryStorage(true);
  assert.deepEqual(P.loadProgress(bad), { v: 1, stars: {} });
  assert.equal(P.saveProgress(bad, P.newProgress()), false);
  assert.deepEqual(P.loadProgress(null), { v: 1, stars: {} });
  assert.equal(P.saveProgress(null, P.newProgress()), false);
  assert.deepEqual(P.parseProgress(undefined), { v: 1, stars: {} });
});

test('recordStars keeps the best result and rejects junk', () => {
  const p = P.newProgress();
  assert.equal(P.recordStars(p, 2, 2), true);
  assert.equal(P.recordStars(p, 2, 1), false, 'a worse result does not overwrite');
  assert.equal(P.recordStars(p, 2, 2), false, 'an equal one changes nothing');
  assert.equal(P.starsOf(p, 2), 2);
  assert.equal(P.recordStars(p, 2, 3), true);
  assert.equal(P.starsOf(p, 2), 3);
  for (const [lvl, n] of [[-1, 2], [1.5, 2], [3, 0], [3, 4], [3, 2.5], ['3', 2]]) {
    assert.equal(P.recordStars(p, lvl, n), false, `${lvl}/${n}`);
  }
  assert.deepEqual(p.stars, { 2: 3 });
});

test('levels unlock one by one up to the first unfinished', () => {
  const p = P.newProgress();
  const N = 30;
  assert.equal(P.firstUnfinished(p, N), 0);
  assert.equal(P.unlocked(p, 0, N), true);
  assert.equal(P.unlocked(p, 1, N), false);
  P.recordStars(p, 0, 1);
  assert.equal(P.firstUnfinished(p, N), 1);
  assert.equal(P.unlocked(p, 1, N), true);
  assert.equal(P.unlocked(p, 2, N), false);
  P.recordStars(p, 1, 2);
  P.recordStars(p, 2, 3);
  assert.equal(P.firstUnfinished(p, N), 3);
  assert.equal(P.unlocked(p, 3, N), true);
  assert.equal(P.unlocked(p, 4, N), false);
  assert.equal(P.unlocked(p, -1, N), false);
  assert.equal(P.unlocked(p, N, N), false, 'past the last level');
});

test('a finished level stays open even past a gap; all done → firstUnfinished is the total', () => {
  const p = P.newProgress();
  P.recordStars(p, 0, 3);
  P.recordStars(p, 5, 1); // e.g. an older save
  assert.equal(P.firstUnfinished(p, 10), 1);
  assert.equal(P.unlocked(p, 5, 10), true);
  assert.equal(P.unlocked(p, 4, 10), false);
  const all = P.newProgress();
  for (let i = 0; i < 4; i++) P.recordStars(all, i, 1);
  assert.equal(P.firstUnfinished(all, 4), 4);
  for (let i = 0; i < 4; i++) assert.equal(P.unlocked(all, i, 4), true);
});

test('a won level records its stars through the same path the client uses', () => {
  const def = {
    walls: [{ x: 0, y: 0, w: 36, h: 1 }, { x: 0, y: 53, w: 36, h: 1 }, { x: 0, y: 0, w: 1, h: 54 }, { x: 35, y: 0, w: 1, h: 54 }],
    fills: [{ type: 'gold', x: 5, y: 45, w: 10, h: 3 }],
    hero: { x: 20, y: 48, w: 3, h: 5 },
    room: { x: 1, y: 30, w: 34, h: 23 },
    exit: { x: 28, y: 48, w: 3, h: 5 },
    goldTarget: 10,
  };
  const s = P.buildLevel(def);
  P.settle(s);
  assert.equal(P.status(s).status, 'won');
  const st = memoryStorage();
  const p = P.loadProgress(st);
  assert.equal(P.recordStars(p, 0, P.stars(s)), true);
  P.saveProgress(st, p);
  assert.equal(P.starsOf(P.loadProgress(st), 0), 3);
});
