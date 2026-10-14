'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../web/sort/core.js');

// Colours: 0 red, 1 green, 2 blue (names only for reading the boards below).
const R = 0, G = 1, B = 2;
const lvl = (tubes, extra = {}) => ({ tubes, cap: 4, ...extra });

// A Storage-like object backed by a Map; `broken` makes every call throw (blocked site data).
function memoryStorage(broken = false) {
  const m = new Map();
  return {
    m,
    getItem(k) { if (broken) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (broken) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
  };
}

test('parseLevel copies the level and counts colours', () => {
  const def = lvl([[R, G, R, G], [G, R, G, R], []], { par: 6 });
  const L = S.parseLevel(def);
  assert.equal(L.colors, 2);
  assert.equal(L.cap, 4);
  assert.equal(L.par, 6);
  assert.equal(L.solution, null);
  L.tubes[0].push(9);
  assert.equal(def.tubes[0].length, 4, 'the definition is not touched');
});

test('parseLevel rejects malformed levels', () => {
  const bad = [
    null, 'x', {},
    { tubes: [[R, R, R, R], []], cap: 2 },           // cap too small
    { tubes: [[R, R, R, R], []], cap: 7 },           // cap too big
    { tubes: [[R, R, R, R]], cap: 4 },               // one tube
    lvl([[R, R, R, R, R], []]),                      // over capacity
    lvl([[R, R, R], []]),                            // a colour short of a full set
    lvl([[R, R, R, R], [R], []]),                    // a colour with too many layers
    lvl([[12, 12, 12, 12], []]),                     // colour out of range
    lvl([[-1, -1, -1, -1], []]),
    lvl([[1.5, 1.5, 1.5, 1.5], []]),
    lvl([[], []]),                                   // no colours
    lvl(['RRRR', []]),
    lvl([[R, R, R, R], []], { par: -1 }),
    lvl([[R, R, R, R], []], { par: 2.5 }),
    lvl([[R, R, R, R], []], { solution: [[0]] }),
    lvl([[R, R, R, R], []], { solution: 'x' }),
    { tubes: Array.from({ length: S.MAX_TUBES + 1 }, () => []), cap: 4 },
  ];
  for (const def of bad) assert.throws(() => S.parseLevel(def), undefined, JSON.stringify(def));
});

test('a pour moves the whole run on top when it fits', () => {
  const g = S.newGame(lvl([[R, G, B, B], [G, R, R, G], [R, B, G, B], [], []]));
  assert.equal(S.pour(g, 0, 3), 2, 'both blues go into the empty tube');
  assert.deepEqual(g.tubes[0], [R, G]);
  assert.deepEqual(g.tubes[3], [B, B]);
  assert.equal(g.moves, 1);
  assert.equal(S.pour(g, 2, 3), 1, 'a blue lands on blue');
  assert.deepEqual(g.tubes[3], [B, B, B]);
});

test('a pour moves only as many layers as fit', () => {
  const g = S.newGame(lvl([[R, G, G, G], [G, R, R, R], [], []]));
  assert.equal(S.pour(g, 1, 2), 3);
  assert.equal(S.pour(g, 0, 1), 3, 'three greens onto one green');
  assert.deepEqual(g.tubes[1], [G, G, G, G]);
  const h = S.newGame(lvl([[R, B, B, B], [R, R, R, B], [], []]));
  assert.equal(S.pour(h, 1, 2), 1);
  assert.equal(S.pour(h, 0, 2), 3, 'room for exactly three');
  const k = S.newGame(lvl([[R, B, B, B], [G, G, B], [R, R, R], [G, G]]));
  assert.equal(S.pour(k, 0, 1), 1, 'one blue of three fits on top');
  assert.deepEqual(k.tubes[0], [R, B, B]);
  assert.deepEqual(k.tubes[1], [G, G, B, B]);
  const m = S.newGame(lvl([[R, R, B, B], [G, G, G], [B, R, R, B], [G]]));
  assert.equal(S.pourAmount(m.tubes, 4, 0, 1), 0, 'onto a different colour: refused');
});

test('illegal pours change nothing', () => {
  const g = S.newGame(lvl([[R, G, R, G], [G, R, G, R], []]));
  const before = JSON.stringify(g.tubes);
  assert.equal(S.pour(g, 0, 0), 0, 'onto itself');
  assert.equal(S.pour(g, 2, 0), 0, 'from an empty tube');
  assert.equal(S.pour(g, 0, 1), 0, 'onto a full tube');
  assert.equal(S.pour(g, 0, 9), 0, 'to a missing tube');
  assert.equal(S.pour(g, -1, 2), 0, 'from a missing tube');
  assert.equal(JSON.stringify(g.tubes), before);
  assert.equal(g.moves, 0);
  assert.equal(g.history.length, 0);
});

test('solving the level wins it and stops further pours', () => {
  const g = S.newGame(lvl([[R, R, R, G], [G, G, G, R], []]));
  assert.equal(g.status, 'playing');
  S.pour(g, 0, 2); S.pour(g, 1, 0); S.pour(g, 2, 1);
  assert.equal(g.status, 'won');
  assert.equal(S.status(g), 'won');
  assert.equal(S.canPour(g, 0, 2), false);
  assert.equal(S.pour(g, 0, 2), 0);
  assert.equal(S.solved(g.tubes, 4), true);
});

test('stuck when no pour is possible', () => {
  // Every tube full and mixed, no empty tube: nothing can move.
  assert.equal(S.newGame(lvl([[R, G, R, G], [G, R, G, R]])).status, 'stuck');
  assert.equal(S.newGame({ tubes: [[R, G, B], [G, B, R], [B, R, G]], cap: 3 }).status, 'stuck');
  // With an empty tube there is always a move.
  assert.equal(S.newGame({ tubes: [[R, G, B], [G, B, R], [B, R, G], []], cap: 3 }).status, 'playing');
  // Matching tops with room: playing.
  assert.equal(S.newGame({ tubes: [[G, B], [B, G], [R, R, R], [G, B]], cap: 3 }).status, 'playing');
});

test('stuck with free space left: every tube with room has a top no other tube shares', () => {
  // cap 3, four colours. Two full tubes topped with colour 0; three tubes with room topped with 1, 2 and 3.
  const g = S.newGame({ tubes: [[1, 2, 0], [3, 2, 0], [0, 1], [3, 2], [1, 3]], cap: 3 });
  assert.equal(g.status, 'stuck');
  assert.equal(S.addTube(g), true);
  assert.equal(g.status, 'playing', 'the spare tube gets it going again');
});

test('undo takes back pours one by one', () => {
  const g = S.newGame(lvl([[R, G, B, B], [G, R, R, G], [R, B, G, B], [], []]));
  const start = JSON.stringify(g.tubes);
  S.pour(g, 0, 3); S.pour(g, 2, 3);
  assert.equal(S.undo(g), true);
  assert.deepEqual(g.tubes[3], [B, B]);
  assert.equal(g.moves, 1);
  assert.equal(S.undo(g), true);
  assert.equal(JSON.stringify(g.tubes), start);
  assert.equal(g.moves, 0);
  assert.equal(S.undo(g), false, 'nothing left to undo');
});

test('undo brings a won game back to playing', () => {
  const g = S.newGame(lvl([[R, R, R, G], [G, G, G, R], []]));
  S.pour(g, 0, 2); S.pour(g, 1, 0); S.pour(g, 2, 1);
  assert.equal(g.status, 'won');
  S.undo(g);
  assert.equal(g.status, 'playing');
});

test('the spare tube: once per level, undoable, unsticks a stuck game', () => {
  const g = S.newGame(lvl([[R, G, R, G], [G, R, G, R]]));
  assert.equal(g.status, 'stuck');
  assert.equal(S.addTube(g), true);
  assert.equal(g.tubes.length, 3);
  assert.equal(g.extraUsed, true);
  assert.equal(g.status, 'playing');
  assert.equal(g.moves, 0, 'the spare tube is not a move');
  assert.equal(S.addTube(g), false, 'only once');
  S.pour(g, 0, 2);
  // Undo is LIFO: the pour first, then the tube.
  assert.equal(S.undo(g), true);
  assert.equal(g.tubes.length, 3);
  assert.equal(S.undo(g), true);
  assert.equal(g.tubes.length, 2);
  assert.equal(g.extraUsed, false, 'undoing the tube gives it back');
  assert.equal(g.status, 'stuck');
  assert.equal(S.addTube(g), true, 'and it can be added again');
});

test('the spare tube cannot be added after a win', () => {
  const g = S.newGame(lvl([[R, R, R, G], [G, G, G, R], []]));
  S.pour(g, 0, 2); S.pour(g, 1, 0); S.pour(g, 2, 1);
  assert.equal(S.addTube(g), false);
});

test('restart gives a fresh game of the same level', () => {
  const g = S.newGame(lvl([[R, G, B, B], [G, R, R, G], [R, B, G, B], [], []]));
  S.pour(g, 0, 3); S.addTube(g);
  const r = S.restart(g);
  assert.equal(r.moves, 0);
  assert.equal(r.extraUsed, false);
  assert.equal(r.tubes.length, 5);
});

test('stars: 3 at par without the spare tube, 2 within the slack or with it, 1 otherwise', () => {
  const won = (moves, par, extraUsed = false) => S.stars({ status: 'won', moves, extraUsed, level: { par } });
  assert.equal(S.slackFor(4), 2);
  assert.equal(S.slackFor(20), 5);
  assert.equal(S.slackFor(21), 6);
  assert.equal(won(20, 20), 3);
  assert.equal(won(19, 20), 3, 'better than par is still 3');
  assert.equal(won(20, 20, true), 2, 'the spare tube caps at 2');
  assert.equal(won(21, 20), 2);
  assert.equal(won(25, 20), 2, 'par + ⌈par/4⌉');
  assert.equal(won(26, 20), 1);
  assert.equal(won(25, 20, true), 2);
  assert.equal(won(26, 20, true), 1);
  assert.equal(won(5, 4), 2, 'slack is at least 2');
  assert.equal(won(6, 4), 2);
  assert.equal(won(7, 4), 1);
  assert.equal(won(9, null), 3, 'no par: any clean win is 3');
  assert.equal(won(9, null, true), 2);
  assert.equal(S.stars({ status: 'playing', moves: 1, extraUsed: false, level: { par: 5 } }), 0);
  assert.equal(S.stars({ status: 'stuck', moves: 1, extraUsed: false, level: { par: 5 } }), 0);
});

test('tube helpers', () => {
  assert.equal(S.topRun([R, G, G]), 2);
  assert.equal(S.topRun([]), 0);
  assert.equal(S.uniform([B, B]), true);
  assert.equal(S.uniform([]), false);
  assert.equal(S.uniform([R, B]), false);
  assert.equal(S.complete([B, B, B, B], 4), true);
  assert.equal(S.complete([B, B, B], 4), false);
  assert.equal(S.solved([[R, R, R, R], [], [G, G, G, G]], 4), true);
  assert.equal(S.solved([[R, R, R], [R], []], 4), false);
});

// ── Progress ──
const CLEAN = { v: 1, stars: {}, current: null };

test('a fresh or broken storage loads a clean progress', () => {
  assert.deepEqual(S.loadProgress(memoryStorage()), CLEAN);
  assert.deepEqual(S.loadProgress(memoryStorage(true)), CLEAN);
  assert.deepEqual(S.loadProgress(null), CLEAN);
  assert.deepEqual(S.newProgress(), CLEAN);
  assert.equal(S.PROGRESS_KEY, 'sort.progress');
  for (const raw of ['', '{', 'null', '[]', '{"v":2,"stars":{}}', '{"v":1}', '{"v":1,"stars":5}', 42]) {
    assert.deepEqual(S.parseProgress(raw), CLEAN, String(raw));
  }
});

test('progress saves and loads back, dropping junk', () => {
  const st = memoryStorage();
  const p = S.newProgress();
  assert.equal(S.recordStars(p, 0, 3), true);
  assert.equal(S.recordStars(p, 1, 1), true);
  p.current = { level: 2, path: [[0, 3], 'tube', [1, 4]] };
  assert.equal(S.saveProgress(st, p), true);
  assert.deepEqual(JSON.parse(st.m.get('sort.progress')),
    { v: 1, stars: { 0: 3, 1: 1 }, current: { level: 2, path: [[0, 3], 'tube', [1, 4]] } });
  assert.deepEqual(S.loadProgress(st), { v: 1, stars: { 0: 3, 1: 1 }, current: { level: 2, path: [[0, 3], 'tube', [1, 4]] } });
  assert.equal(S.saveProgress(memoryStorage(true), p), false);
  assert.equal(S.saveProgress(null, p), false);

  const junk = JSON.stringify({ v: 1, stars: { 0: 3, 1: 4, x: 2, 2: 0, 3: 2.5, 4: 2 }, current: { level: 1, path: [[0, 0]] } });
  assert.deepEqual(S.parseProgress(junk), { v: 1, stars: { 0: 3, 4: 2 }, current: null });
  for (const current of [{ level: -1, path: [] }, { level: 1, path: 'x' }, { level: 1, path: [[0]] }, { level: 1, path: ['spare'] }, 7]) {
    assert.equal(S.parseProgress(JSON.stringify({ v: 1, stars: {}, current })).current, null);
  }
});

test('recordStars keeps the best result; unlocking follows the first unfinished level', () => {
  const p = S.newProgress();
  assert.equal(S.recordStars(p, 0, 2), true);
  assert.equal(S.recordStars(p, 0, 1), false);
  assert.equal(S.recordStars(p, 0, 3), true);
  assert.equal(S.recordStars(p, 0, 4), false);
  assert.equal(S.recordStars(p, -1, 2), false);
  assert.equal(S.starsOf(p, 0), 3);
  assert.equal(S.firstUnfinished(p, 10), 1);
  assert.equal(S.unlocked(p, 0, 10), true);
  assert.equal(S.unlocked(p, 1, 10), true);
  assert.equal(S.unlocked(p, 2, 10), false);
  assert.equal(S.unlocked(p, 10, 10), false);
  S.recordStars(p, 5, 1);
  assert.equal(S.unlocked(p, 5, 10), true, 'a level with stars stays open');
  assert.equal(S.firstUnfinished({ v: 1, stars: { 0: 1, 1: 1 } }, 2), 2);
});

test('currentOf / resume bring back the level in progress, spare tube included', () => {
  const levels = [lvl([[R, G, B, B], [G, R, R, G], [R, B, G, B], [], []])];
  const g = S.newGame(levels[0]);
  S.pour(g, 0, 3); S.addTube(g); S.pour(g, 2, 5);
  const cur = S.currentOf(0, g);
  assert.deepEqual(cur, { level: 0, path: [[0, 3], 'tube', [2, 5]] });
  const back = S.resume({ v: 1, stars: {}, current: cur }, levels);
  assert.equal(back.level, 0);
  assert.deepEqual(back.state.tubes, g.tubes);
  assert.equal(back.state.extraUsed, true);
  assert.equal(back.state.moves, 2);
  assert.equal(S.undo(back.state), true);
  assert.equal(S.undo(back.state), true);
  assert.equal(back.state.extraUsed, false, 'the replayed history undoes like the original');

  assert.equal(S.resume({ v: 1, stars: {}, current: { level: 0, path: [[1, 0]] } }, levels), null, 'a step that is not allowed');
  assert.equal(S.resume({ v: 1, stars: {}, current: { level: 3, path: [] } }, levels), null, 'missing level');
  assert.equal(S.resume({ v: 1, stars: {}, current: null }, levels), null);
  assert.equal(S.resume(null, levels), null);

  const won = S.newGame(lvl([[R, R, R, G], [G, G, G, R], []]));
  S.pour(won, 0, 2); S.pour(won, 1, 0); S.pour(won, 2, 1);
  assert.equal(S.currentOf(0, won), null, 'a won level keeps nothing');
  assert.equal(S.resume({ v: 1, stars: {}, current: { level: 0, path: [[0, 2], [1, 0], [2, 1]] } },
    [lvl([[R, R, R, G], [G, G, G, R], []])]), null, 'a path that wins is not resumed');
});

test('replay rejects bad input', () => {
  assert.equal(S.replay({}, []), null);
  assert.equal(S.replay(lvl([[R, R, R, R], []]), 'x'), null);
  assert.equal(S.replay(lvl([[R, G, R, G], [G, R, G, R], []]), ['tube', 'tube']), null, 'the spare tube only once');
  assert.ok(S.replay(lvl([[R, G, R, G], [G, R, G, R], []]), [[0, 2]]));
});
