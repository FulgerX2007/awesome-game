'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../web/parking/core.js');
const { LEVELS } = require('../../web/parking/levels.js');

// A Storage-like object backed by a Map; `broken` makes every call throw (blocked site data).
function memoryStorage(broken = false) {
  const m = new Map();
  return {
    m,
    getItem(k) { if (broken) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (broken) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
  };
}
const CLEAN = { v: 1, stars: {}, current: null };

test('a fresh storage loads a clean progress', () => {
  assert.deepEqual(P.loadProgress(memoryStorage()), CLEAN);
  assert.deepEqual(P.newProgress(), CLEAN);
  assert.equal(P.PROGRESS_KEY, 'parking.progress');
  assert.equal(P.MAX_HINTS, 3);
});

test('progress saves under parking.progress and loads back', () => {
  const st = memoryStorage();
  const p = P.newProgress();
  assert.equal(P.recordStars(p, 0, 3), true);
  assert.equal(P.recordStars(p, 1, 1), true);
  p.current = { level: 2, path: [['A', -1], ['X', 4]], hints: 2 };
  assert.equal(P.saveProgress(st, p), true);
  assert.deepEqual(JSON.parse(st.m.get('parking.progress')),
    { v: 1, stars: { 0: 3, 1: 1 }, current: { level: 2, path: [['A', -1], ['X', 4]], hints: 2 } });
  const q = P.loadProgress(st);
  assert.deepEqual(q, { v: 1, stars: { 0: 3, 1: 1 }, current: { level: 2, path: [['A', -1], ['X', 4]], hints: 2 } });
  assert.equal(P.starsOf(q, 0), 3);
  assert.equal(P.starsOf(q, 5), 0);
  assert.equal(P.starsOf(null, 0), 0);
});

test('broken or foreign JSON falls back to a clean state', () => {
  for (const raw of ['{', 'null', '42', '"text"', '[]', '{"v":2,"stars":{"0":3}}', '{"v":1}', '{"v":1,"stars":5}', '{"stars":{"0":3}}']) {
    const st = memoryStorage();
    st.m.set('parking.progress', raw);
    assert.deepEqual(P.loadProgress(st), CLEAN, raw);
  }
});

test('junk star entries are dropped and good ones kept', () => {
  const st = memoryStorage();
  st.m.set('parking.progress', JSON.stringify({
    v: 1,
    stars: { 0: 2, 1: 0, 2: 4, 3: 1.5, 4: '3', x: 3, '-1': 2, 5: 3, 99999: 3, 1.5: 2 },
    extra: 'ignored',
  }));
  assert.deepEqual(P.loadProgress(st), { v: 1, stars: { 0: 2, 5: 3 }, current: null });
});

test('a junk level in progress is dropped, the stars stay', () => {
  const bad = [
    5, 'x', [], { level: -1, path: [] }, { level: 1.5, path: [] }, { level: 'a', path: [] }, { level: 0 },
    { level: 0, path: 'AB' }, { level: 0, path: [['A']] }, { level: 0, path: [['A', 0]] }, { level: 0, path: [['a', 1]] },
    { level: 0, path: [['AB', 1]] }, { level: 0, path: [[1, 1]] }, { level: 0, path: [['A', 1.5]] },
    { level: 0, path: Array(600).fill(['A', 1]) },
  ];
  for (const current of bad) {
    const st = memoryStorage();
    st.m.set('parking.progress', JSON.stringify({ v: 1, stars: { 0: 3 }, current }));
    assert.deepEqual(P.loadProgress(st), { v: 1, stars: { 0: 3 }, current: null }, JSON.stringify(current));
  }
  // Hints are clamped to the 0…3 range; junk hints count as none.
  const st = memoryStorage();
  st.m.set('parking.progress', JSON.stringify({ v: 1, stars: {}, current: { level: 0, path: [], hints: 9 } }));
  assert.equal(P.loadProgress(st).current.hints, 3);
  st.m.set('parking.progress', JSON.stringify({ v: 1, stars: {}, current: { level: 0, path: [], hints: -2 } }));
  assert.equal(P.loadProgress(st).current.hints, 0);
});

test('blocked or missing storage never throws', () => {
  const bad = memoryStorage(true);
  assert.deepEqual(P.loadProgress(bad), CLEAN);
  assert.equal(P.saveProgress(bad, P.newProgress()), false);
  assert.deepEqual(P.loadProgress(null), CLEAN);
  assert.equal(P.saveProgress(null, P.newProgress()), false);
  assert.deepEqual(P.parseProgress(undefined), CLEAN);
});

test('the best stars of a level are kept', () => {
  const p = P.newProgress();
  assert.equal(P.recordStars(p, 3, 2), true);
  assert.equal(P.recordStars(p, 3, 1), false, 'a worse result does not overwrite');
  assert.equal(P.recordStars(p, 3, 2), false);
  assert.equal(P.starsOf(p, 3), 2);
  assert.equal(P.recordStars(p, 3, 3), true);
  assert.equal(P.starsOf(p, 3), 3);
  for (const [lvl, n] of [[0, 0], [0, 4], [-1, 2], [1.5, 2], [0, '3'], [5000, 1]]) {
    assert.equal(P.recordStars(p, lvl, n), false, `${lvl}/${n}`);
  }
});

test('levels unlock one after another; finished levels stay open', () => {
  const total = LEVELS.length;
  const p = P.newProgress();
  assert.equal(P.firstUnfinished(p, total), 0);
  assert.equal(P.unlocked(p, 0, total), true);
  assert.equal(P.unlocked(p, 1, total), false);
  P.recordStars(p, 0, 1);
  assert.equal(P.unlocked(p, 1, total), true);
  assert.equal(P.unlocked(p, 2, total), false);
  // A gap: level 5 done (e.g. an old save) stays open, the first unfinished one too.
  P.recordStars(p, 5, 3);
  assert.equal(P.firstUnfinished(p, total), 1);
  assert.equal(P.unlocked(p, 5, total), true);
  assert.equal(P.unlocked(p, 3, total), false);
  for (const bad of [-1, total, 1.5, '1']) assert.equal(P.unlocked(p, bad, total), false);
  for (let i = 0; i < total; i++) P.recordStars(p, i, 1);
  assert.equal(P.firstUnfinished(p, total), total);
});

test('pathOf and replay bring a level in progress back exactly', () => {
  const def = LEVELS[9];
  const s = P.newGame(def);
  const sol = P.solveState(s);
  for (const [id, d] of sol.path.slice(0, 4)) assert.ok(P.move(s, id, d));
  const path = P.pathOf(s);
  assert.deepEqual(path, sol.path.slice(0, 4));
  const back = P.replay(def, JSON.parse(JSON.stringify(path)));
  assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(s)), 'the same state, history included');
  assert.ok(P.undo(back), 'undo works after a restore');
  assert.equal(back.moves, 3);
  // Undo shortens the path; the exit move is written as the distance to the edge.
  P.undo(s);
  assert.deepEqual(P.pathOf(s), sol.path.slice(0, 3));
  const w = P.newGame(LEVELS[0]);
  for (const [id, d] of P.solveState(w).path) P.move(w, id, d);
  assert.equal(w.status, 'won');
  assert.equal(P.replay(LEVELS[0], P.pathOf(w)).status, 'won');
  assert.deepEqual(P.pathOf(P.newGame(LEVELS[0])), []);
});

test('replay refuses a path that does not fit the level', () => {
  assert.equal(P.replay(LEVELS[0], [['X', 1]]), null, 'X is blocked at the start');
  assert.equal(P.replay(LEVELS[0], [['Q', 1]]), null, 'no such vehicle');
  assert.equal(P.replay(LEVELS[0], 'nope'), null);
  assert.equal(P.replay(LEVELS[0], [5]), null);
  assert.equal(P.replay({ rows: ['bad'] }, []), null, 'a broken level');
  assert.equal(P.replay(LEVELS[0], []).moves, 0);
});

test('a won level records stars and the saved progress survives a reload', () => {
  const st = memoryStorage();
  const p = P.loadProgress(st);
  const s = P.newGame(LEVELS[0]);
  for (const [id, d] of P.solveState(s).path) P.move(s, id, d);
  assert.equal(s.status, 'won');
  P.recordStars(p, 0, P.stars(s.moves, s.optimal));
  p.current = null;
  P.saveProgress(st, p);
  const q = P.loadProgress(st);
  assert.equal(P.starsOf(q, 0), 3);
  assert.equal(P.firstUnfinished(q, LEVELS.length), 1);
  assert.equal(q.current, null);
});

// The client's save/restore of the level in progress goes through currentOf (after every move, win and loss)
// and resume (on the menu and on «Играть»).
test('currentOf keeps a playing or lost game and drops a won one', () => {
  const s = P.newGame(LEVELS[0]);
  assert.deepEqual(P.currentOf(0, s, 0), { level: 0, path: [], hints: 0 });
  const sol = P.solveState(s);
  P.move(s, ...sol.path[0]);
  assert.deepEqual(P.currentOf(0, s, 2), { level: 0, path: [sol.path[0]], hints: 2 });
  for (const m of sol.path.slice(1)) P.move(s, ...m);
  assert.equal(s.status, 'won');
  assert.equal(P.currentOf(0, s, 2), null, 'a won level keeps nothing');
  assert.equal(P.currentOf(0, null, 0), null);
});

// Runs a level out of moves by shuffling one vehicle back and forth. Returns the lost game.
function runOut(def) {
  const s = P.newGame(def);
  const u = s.vehicles.find((v) => v.id !== P.PLAYER && P.canMove(s, v.id, 1));
  while (s.status === 'playing') { P.move(s, u.id, 1); if (s.status === 'playing') P.move(s, u.id, -1); }
  return s;
}

test('a level lost on moves survives a reload and can still be undone', () => {
  const st = memoryStorage();
  const p = P.loadProgress(st);
  const s = runOut(LEVELS[2]);
  assert.equal(s.status, 'lost');
  p.current = P.currentOf(2, s, 1);
  assert.ok(p.current, 'the lost game is kept');
  P.saveProgress(st, p);
  const r = P.resume(P.loadProgress(st), LEVELS);
  assert.equal(r.level, 2);
  assert.equal(r.hints, 1);
  assert.equal(r.state.status, 'lost');
  assert.equal(r.state.moves, s.limit);
  assert.ok(P.undo(r.state), 'the last move can be taken back');
  assert.equal(r.state.status, 'playing');
});

test('resume: nothing saved, a won path, a path that no longer fits or a missing level give null', () => {
  assert.equal(P.resume(P.newProgress(), LEVELS), null);
  assert.equal(P.resume(null, LEVELS), null);
  const won = P.newGame(LEVELS[0]);
  for (const m of P.solveState(won).path) P.move(won, ...m);
  assert.equal(P.resume({ current: { level: 0, path: P.pathOf(won), hints: 0 } }, LEVELS), null);
  assert.equal(P.resume({ current: { level: 0, path: [['X', 1]], hints: 0 } }, LEVELS), null);
  assert.equal(P.resume({ current: { level: 99, path: [], hints: 0 } }, LEVELS), null);
  const ok = P.resume({ current: { level: 5, path: [], hints: 3 } }, LEVELS);
  assert.equal(ok.state.status, 'playing');
  assert.equal(ok.hints, 3);
});

test('pathOf stores the exit as the slide to the edge, whatever the overshoot', () => {
  const s = P.newGame({ rows: ['......', '......', 'XX....', '......', '......', '......'], optimal: 1 });
  assert.ok(P.move(s, 'X', 9));
  assert.deepEqual(P.pathOf(s), [['X', 6]]);
  assert.equal(P.replay({ rows: ['......', '......', 'XX....', '......', '......', '......'], optimal: 1 }, P.pathOf(s)).status, 'won');
});
