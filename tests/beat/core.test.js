'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/beat/core.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≈ ${b}`);

// A session at 90 bpm whose beat 0 sounds at 1 s (beats are 2/3 s apart).
function session(o = {}) {
  const s = C.newState();
  Object.assign(s, o);
  C.start(s, 1);
  return s;
}
const at = (s, beat, off = 0) => C.timeOf(s.run.grid, beat) + off;

test('the grid maps beats to seconds and back', () => {
  const g = C.newGrid(90, 2);
  near(C.timeOf(g, 0), 2, 1e-12);
  near(C.timeOf(g, 3), 4, 1e-12);
  near(C.beatAt(g, 4), 3, 1e-12);
  for (const b of [-2, 0, 0.5, 7, 100]) near(C.beatAt(g, C.timeOf(g, b)), b, 1e-9);
});

test('a tempo change starts at the next whole beat after the booked music and keeps the past', () => {
  const g = C.newGrid(90, 0); // beats at 0, 0.667, 1.333, 2 …
  const r = C.retime(g, 120, 1.0);
  assert.equal(r.beat0, 2, 'the first beat at or after 1.0 s');
  near(r.t0, 4 / 3, 1e-12);
  near(C.timeOf(r, 1), 2 / 3, 1e-12, 'earlier beats keep their old times');
  near(C.timeOf(r, 3), 4 / 3 + 0.5, 1e-12, 'later beats follow the new tempo');
  near(C.beatAt(r, 0.5), 0.75, 1e-12);
  // a second change before the first took effect replaces it at the same beat
  const r2 = C.retime(r, 150, 1.1);
  assert.equal(r2.beat0, 2);
  near(C.timeOf(r2, 3), 4 / 3 + 0.4, 1e-12);
  near(C.timeOf(r2, 1), 2 / 3, 1e-12);
  assert.equal(C.retime(r2, 150, 5), r2, 'the same tempo is no change');
  // after the anchor has passed, a new change chains from there
  const r3 = C.retime(r2, 90, 3);
  assert.ok(r3.beat0 > 2);
  near(C.timeOf(r3, r3.beat0), C.timeOf(r2, r3.beat0), 1e-12, 'the anchor beat keeps its time');
});

test('judge: perfect within 50 ms, a hit within 120 ms, the nearest beat wins', () => {
  const g = C.newGrid(90, 0);
  const b = C.timeOf(g, 5);
  for (const [off, grade] of [[0, 'perfect'], [0.049, 'perfect'], [-0.05, 'perfect'], [0.06, 'good'], [-0.119, 'good'], [0.121, 'miss'], [-0.2, 'miss']]) {
    const j = C.judge(g, b + off);
    assert.equal(j.grade, grade, `${off}`);
    assert.equal(j.beat, 5);
    near(j.delta, off, 1e-9);
  }
  assert.equal(C.judge(g, b + 0.4).beat, 6, 'past half a beat it is the next beat');
});

test('hits grow the streak and pay; perfect pays PERFECT_MULT times more', () => {
  const s = session();
  const r1 = C.tap(s, at(s, 0, 0.01));
  assert.equal(r1.grade, 'perfect');
  assert.equal(r1.coins, C.CLICK_BASE * C.PERFECT_MULT);
  const r2 = C.tap(s, at(s, 1, 0.08));
  assert.equal(r2.grade, 'good');
  assert.equal(r2.coins, C.CLICK_BASE);
  assert.equal(s.streak, 2);
  assert.equal(s.coins, r1.coins + r2.coins);
  assert.deepEqual([s.stats.hits, s.stats.perfect, s.stats.misses], [2, 1, 0]);
});

test('a miss pays nothing, never takes coins and cuts the streak in half', () => {
  const s = session();
  for (let b = 0; b < 10; b++) C.tap(s, at(s, b));
  assert.equal(s.streak, 10);
  const coins = s.coins;
  const r = C.tap(s, at(s, 10, 0.2));
  assert.equal(r.grade, 'miss');
  assert.equal(r.coins, 0);
  assert.equal(s.coins, coins);
  assert.equal(s.streak, 5);
  // a second tap on a beat that was already hit is a miss too
  C.tap(s, at(s, 11));
  const again = C.tap(s, at(s, 11, 0.03));
  assert.equal(again.grade, 'miss');
  assert.equal(s.streak, 3);
  assert.equal(s.stats.misses, 2);
});

test('spamming pays at most once per beat and keeps the streak near zero', () => {
  const s = session();
  let paid = 0;
  for (let time = 0.5; time < at(s, 20); time += 0.1) {
    C.advance(s, time);
    if (C.tap(s, time).coins > 0) paid++;
  }
  assert.ok(paid <= 21, String(paid));
  assert.ok(s.best <= 2, `best streak ${s.best}`);
});

test('a beat let pass cuts the streak; stopping lets it drain to zero', () => {
  const s = session();
  for (let b = 0; b < 40; b++) C.tap(s, at(s, b));
  assert.equal(s.streak, 40);
  assert.equal(C.multiplier(s.streak), 4);
  // beat 40 is skipped: its window closes 0.12 s after it
  const out = C.advance(s, at(s, 40, 0.13));
  assert.equal(out.passed, 1);
  assert.equal(s.streak, 20);
  C.tap(s, at(s, 41));
  assert.equal(s.streak, 21, 'the next hit continues from the cut streak');
  C.advance(s, at(s, 60));
  assert.equal(s.streak, 0, 'nineteen silent beats drain it');
  // a tap without advance() in between still sees the beats that passed
  for (let b = 61; b < 71; b++) C.tap(s, at(s, b));
  assert.equal(s.streak, 10);
  C.tap(s, at(s, 73));
  assert.equal(s.streak, 3, 'two skipped beats halve it twice before the hit');
});

test('multiplier tiers and the next tier', () => {
  assert.deepEqual([0, 3, 4, 7, 8, 16, 31, 32, 500].map((n) => C.multiplier(n)), [1, 1, 1.5, 1.5, 2, 3, 3, 4, 4]);
  assert.equal(C.nextTier(0), 4);
  assert.equal(C.nextTier(5), 8);
  assert.equal(C.nextTier(32), null);
  assert.equal(C.multiplier(100, true), C.FREE.cap);
  assert.equal(C.nextTier(4, true), null, 'free play tops out at its cap');
});

test('free play: timing does not matter, one tap per beat pays, the streak waits for a pause', () => {
  const s = session({ free: true });
  const r = C.tap(s, at(s, 0, 0.3));
  assert.equal(r.grade, 'good');
  assert.equal(C.tap(s, at(s, 0, 0.32)).grade, 'extra', 'a second tap on the beat is ignored');
  assert.equal(s.streak, 1);
  assert.equal(s.stats.misses, 0);
  // skipping beats does not cut the streak while you keep tapping
  C.tap(s, at(s, 2, 0.25));
  C.tap(s, at(s, 4, -0.25));
  assert.equal(s.streak, 3);
  for (let b = 5; b < 30; b++) C.tap(s, at(s, b, 0.31));
  assert.equal(C.tap(s, at(s, 30)).mult, C.FREE.cap);
  assert.equal(C.tap(s, at(s, 31)).coins, C.CLICK_BASE * C.FREE.cap, 'never the perfect bonus');
  C.advance(s, at(s, 31) + C.FREE.idle + 0.1);
  assert.equal(s.streak, 0, 'a long pause resets it');
});

test('the band is paid once per beat that sounded, tempo changes included', () => {
  const s = session({ levels: { bass: 1 } });
  const per = C.bandPerBeat(s);
  assert.equal(per, C.MUSICIAN.bass.beat);
  C.advance(s, 0.5);
  assert.equal(s.coins, 0, 'nothing before beat 0');
  C.advance(s, at(s, 0));
  near(s.coins, per, 1e-9);
  C.advance(s, at(s, 0)); // the same moment again pays nothing
  near(s.coins, per, 1e-9);
  C.advance(s, at(s, 9, 0.01));
  near(s.coins, 10 * per, 1e-9);
  s.rush = 2;
  assert.ok(C.setTempo(s, 100, at(s, 9, 0.1)));
  assert.equal(s.run.grid.bpm, 100);
  C.advance(s, at(s, 19, 0.01));
  near(s.coins, 20 * per, 1e-9);
  assert.equal(s.stats.beats, 20);
  // a hit also pays a share of the band's income per beat
  const before = s.coins;
  C.tap(s, at(s, 20));
  near(s.coins - before, (C.CLICK_BASE + C.CLICK_SHARE * per) * C.PERFECT_MULT, 1e-9);
});

test('musicians: price grows 15% a level, income doubles at 10, 25 and 50', () => {
  const s = C.newState();
  assert.equal(C.cost(s, 'shaker'), 15);
  assert.equal(C.buy(s, 'shaker'), false, 'no coins');
  s.coins = 1e9;
  assert.ok(C.buy(s, 'shaker'));
  assert.equal(C.cost(s, 'shaker'), Math.ceil(15 * 1.15));
  s.levels.shaker = 9;
  near(C.perBeat(s, 'shaker'), 0.9, 1e-12);
  s.levels.shaker = 10;
  near(C.perBeat(s, 'shaker'), 2, 1e-12);
  s.levels.shaker = 25;
  near(C.perBeat(s, 'shaker'), 10, 1e-12);
  s.levels.shaker = 50;
  near(C.perBeat(s, 'shaker'), 40, 1e-12);
  assert.equal(C.nextMilestone(0), 10);
  assert.equal(C.nextMilestone(25), 50);
  assert.equal(C.nextMilestone(50), null);
  assert.equal(C.buy(s, 'nobody'), false);
});

test('a musician shows up after the one before is hired or halfway to its price', () => {
  const s = C.newState();
  assert.deepEqual(C.MUSICIANS.map((m) => C.revealed(s, m.id)), [true, false, false, false, false]);
  s.levels.shaker = 1;
  assert.ok(C.revealed(s, 'bass'));
  assert.ok(!C.revealed(s, 'guitar'));
  s.total = C.MUSICIAN.guitar.base / 2;
  assert.ok(C.revealed(s, 'guitar'));
  s.coins = 1e12;
  assert.equal(C.buy(s, 'sax'), false, 'a hidden musician cannot be hired');
  // prices and incomes climb tier by tier
  for (let i = 1; i < C.MUSICIANS.length; i++) {
    assert.ok(C.MUSICIANS[i].base > C.MUSICIANS[i - 1].base * 8);
    assert.ok(C.MUSICIANS[i].beat / C.MUSICIANS[i].base < C.MUSICIANS[i - 1].beat / C.MUSICIANS[i - 1].base * 1.01, 'later tiers pay back slower');
  }
});

test('«Разгон» raises the tempo ceiling 5 bpm a level up to 180; tempo is clamped and rounded', () => {
  const s = session();
  assert.ok(!C.rushRevealed(s));
  s.total = C.RUSH.base;
  s.coins = 1e12;
  assert.equal(C.rushCost(s), C.RUSH.base);
  assert.ok(C.buyRush(s));
  assert.equal(C.maxBpm(s), 95);
  assert.equal(C.rushCost(s), Math.ceil(C.RUSH.base * C.RUSH.growth));
  assert.equal(C.setTempo(s, 200, 2), true);
  assert.equal(s.bpm, 95, 'clamped to the ceiling');
  assert.equal(C.setTempo(s, 93, 3), false, 'rounded to a step: still 95');
  assert.equal(C.setTempo(s, 10, 3), true);
  assert.equal(s.bpm, 90);
  s.rush = C.RUSH_LEVELS;
  assert.equal(C.maxBpm(s), 180);
  assert.equal(C.rushCost(s), Infinity);
  assert.equal(C.buyRush(s), false);
  // the window is the same in seconds at any tempo, and windows of neighbouring beats never overlap
  assert.ok(60 / C.BPM.max > 2 * C.JUDGE.hit);
});

test('offline: the band plays without you, up to 8 hours', () => {
  const s = C.newState();
  s.levels = { bass: 10 };
  s.bpm = 120;
  const rate = C.perSecond(s);
  near(rate, 0.8 * 10 * 2 * 2, 1e-9);
  near(C.offline(s, 60), rate * 60, 1e-9);
  near(C.offline(s, 1e9), rate * C.OFFLINE_MAX, 1e-6);
  assert.equal(C.offline(s, -5), 0);
  assert.equal(C.offline(s, NaN), 0);
});

test('calibration takes the median offset and clamps it', () => {
  assert.equal(C.calibrate([]), 0);
  assert.equal(C.calibrate([0.2, 0.21, 0.19, 0.5, 0.2]), 0.2);
  assert.equal(C.calibrate([0.1, 0.2]), 0.15);
  assert.equal(C.calibrate([2, 2, 2]), 0.45);
  assert.equal(C.calibrate([-1]), -0.25);
  assert.equal(C.calibrate([NaN, 0.123456]), 0.123);
});

test('saves round-trip and broken saves fall back to sane values', () => {
  const s = C.newState();
  Object.assign(s, { coins: 123.5, total: 999, rush: 3, bpm: 105, free: true, best: 77 });
  s.levels = { shaker: 12, bass: 3 };
  s.stats.hits = 50;
  C.start(s, 1);
  const raw = JSON.parse(JSON.stringify(C.serialize(s)));
  assert.equal(raw.run, undefined, 'the session is not saved');
  const back = C.migrate(raw);
  assert.deepEqual(C.serialize(back), C.serialize(s));
  assert.equal(back.run, null);
  assert.deepEqual(C.serialize(C.migrate(null)), C.serialize(C.newState()));
  assert.deepEqual(C.serialize(C.migrate('nope')), C.serialize(C.newState()));
  const bad = C.migrate({ coins: -5, total: 'x', levels: { shaker: 2.5, bass: -1, ghost: 4, keys: 3 }, rush: 99, bpm: 999, free: 'yes', stats: { hits: -1, taps: 4 } });
  assert.equal(bad.coins, 0);
  assert.deepEqual(bad.levels, { keys: 3 });
  assert.equal(bad.rush, C.RUSH_LEVELS);
  assert.equal(bad.bpm, 180);
  assert.equal(bad.free, false);
  assert.equal(bad.stats.hits, 0);
  assert.equal(bad.stats.taps, 4);
  assert.equal(C.migrate({ bpm: 150, rush: 1 }).bpm, 95, 'the tempo never exceeds the bought ceiling');
});

test('musician names and notes are translated on read', () => {
  const I18n = require('../../web/i18n.js');
  I18n.add({ ro: { 'Басист': 'Basist' } });
  I18n._use('ro');
  try { assert.equal(C.MUSICIAN.bass.name, 'Basist'); } finally { I18n._use('ru'); }
  assert.equal(C.MUSICIAN.bass.name, 'Басист');
});
