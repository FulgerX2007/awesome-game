'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../web/parking/core.js');

// Replays a path on a fresh game and returns the final state.
function replay(def, path) {
  const s = P.newGame({ ...def, optimal: def.optimal || 99 });
  for (const [id, d] of path) assert.equal(P.move(s, id, d), true, `move ${id} ${d} on ${P.toRows(s.level, s.vehicles).join('/')}`);
  return s;
}

test('a trivial board takes one move: straight out', () => {
  const def = { rows: ['......', '......', 'XX....', '......', '......', '......'] };
  const sol = P.solve(def);
  assert.deepEqual(sol, { moves: 1, path: [['X', 6]] });
  assert.equal(replay(def, sol.path).status, 'won');
  const near = P.solve({ rows: ['......', '......', '....XX', '......', '......', '......'] });
  assert.deepEqual(near, { moves: 1, path: [['X', 2]] }, 'the tail passes the edge');
});

test('a hand-checked board: B clears the way for bus A, then X leaves (3 moves)', () => {
  // A (bus, column 2, rows 0–2) blocks X. It can only go down to rows 3–5, where car B sits in row 5.
  const def = { rows: ['..A...', '..A...', 'XXA...', '......', '......', '.BB...'] };
  const sol = P.solve(def);
  assert.equal(sol.moves, 3);
  assert.equal(sol.path.length, 3);
  assert.equal(sol.path[0][0], 'B');
  assert.deepEqual(sol.path.slice(1), [['A', 3], ['X', 6]]);
  assert.equal(replay(def, sol.path).status, 'won');
  // the same accepts a parsed level; solveState answers for a game in progress
  assert.equal(P.solve(P.parseLevel(def)).moves, 3);
  const s = P.newGame({ ...def, optimal: 3 });
  P.move(s, 'B', 3);
  assert.deepEqual(P.solveState(s), { moves: 2, path: [['A', 3], ['X', 6]] }, 'solve from the current state (hint)');
  P.move(s, 'A', 3);
  P.move(s, 'X', 6);
  assert.deepEqual(P.solveState(s), { moves: 0, path: [] }, 'already out');
});

test('a classic jam with a hand-checked optimum of 4', () => {
  // X needs both car A (column 3) and bus E (column 4) out of row 2.
  //  - E can only go down 3 (rows 3–5).
  //  - A up needs C (row 0) out of column 3: C ← is blocked by D (stuck on top of X), C → needs E gone first.
  //  - A down needs bus B (row 3) out of column 3: G ↓, B ←, A ↓ — three moves, so that way costs 5.
  // Best: E ↓ 3, C → 2, A ↑ 1, X out = 4.
  const def = {
    rows: [
      '.DCCE.',
      '.D.AE.',
      'XX.AE.',
      'GBBB.#',
      'G.....',
      '......',
    ],
  };
  const sol = P.solve(def);
  assert.equal(sol.moves, 4);
  assert.deepEqual(sol.path, [['E', 3], ['C', 2], ['A', -1], ['X', 6]]);
  assert.equal(replay(def, sol.path).status, 'won');
  assert.equal(shortest(def, 3), false, 'no 3-move solution');
});

test('the optimum waits for the barrier: the first move can never cross it', () => {
  // Move 1 is odd → the barrier in X's row is closed. Without it the board takes 1 move, with it 2.
  const free = { rows: ['......', '......', 'XX....', '......', '......', 'BB....'] };
  const gated = { rows: ['......', '......', 'XX.|..', '......', '......', 'BB....'] };
  assert.equal(P.solve(free).moves, 1);
  const sol = P.solve(gated);
  assert.equal(sol.moves, 2);
  assert.notEqual(sol.path[0][0] === 'X' && sol.path[0][1] >= 4, true, 'the first move does not leave');
  assert.deepEqual(sol.path[1], ['X', 6]);
  assert.equal(replay(gated, sol.path).status, 'won');
  // from a state with an odd number of moves made the barrier is open: one move
  const s = P.newGame({ ...gated, optimal: 2 });
  P.move(s, 'B', 1);
  assert.deepEqual(P.solveState(s), { moves: 1, path: [['X', 6]] });
  // two barriers that need opposite parities can't both be passed in one slide: still 2 moves here,
  // and with a vehicle pinned on its only cell the barrier forces a wasted move
  const lone = { rows: ['......', '......', 'XX.|..', '......', '......', '#.....'] };
  const l = P.solve(lone);
  assert.equal(l.moves, 2, 'X shuffles itself one cell first');
  assert.deepEqual(l.path[0], ['X', 1]);
});

test('a tow truck costs a move per cell', () => {
  // T (column 2, rows 1–3) blocks X; a bollard above it means it must drive down 2 cells.
  const rows = ['..#...', '..T...', 'XXT...', '..T...', '......', '......'];
  assert.equal(P.solve({ rows }).moves, 2, 'a plain bus clears the row in one move');
  const sol = P.solve({ rows, vehicles: { T: 'tow' } });
  assert.equal(sol.moves, 3);
  assert.deepEqual(sol.path, [['T', 1], ['T', 1], ['X', 6]]);
});

test('an unsolvable board → null', () => {
  assert.equal(P.solve({ rows: ['......', '......', 'XX..BB', '......', '......', '......'] }), null, 'a car in the exit row');
  assert.equal(P.solve({ rows: ['......', '......', 'XX.#..', '......', '......', '......'] }), null, 'a bollard in the exit row');
  assert.equal(P.solve({ rows: ['..#...', '..A...', 'XXA...', '..#...', '......', '......'] }), null, 'A boxed in');
});

test('the state cap gives up with null', () => {
  const jam = { rows: ['..A...', '..A...', 'XXA...', '......', '......', '.BB...'] };
  assert.equal(P.solve(jam, 3), null, 'too few states allowed');
  assert.equal(P.solve(jam, 1000).moves, 3);
  assert.equal(P.MAX_STATES, 200000);
});

test('invalid levels → parseLevel throws', () => {
  const ok = ['......', '......', 'XX....', '......', '......', '......'];
  const bad = [
    null, 42, 'XX', {}, { rows: 'XX....' }, { rows: [] }, { rows: ['XX.', 'X..'] },
    { rows: ['XX', '..', '..'] },                                       // too narrow
    { rows: Array(9).fill('XX.......') },                               // too big
    { rows: ['......', '.....', 'XX....', '......', '......', '......'] }, // ragged
    { rows: ['......', '......', 'XX....', '......', '......', 5] },
    { rows: ['......', '......', 'XX..x.', '......', '......', '......'] }, // lowercase
    { rows: ['......', '......', 'XX..*.', '......', '......', '......'] },
    { rows: ['......', '......', '......', '......', 'AA....', '......'] }, // no X
    { rows: ['X.....', 'X.....', '......', '......', '......', '......'] }, // vertical X
    { rows: ['......', '......', 'XXX...', '......', '......', '......'] }, // X is a bus
    { rows: ok, vehicles: { X: 'tow' } },                                  // X as a tow truck
    { rows: ['......', 'A.....', 'AA....', 'XX....', '......', '......'] }, // L shape (overlap)
    { rows: ['A.....', '......', 'A.....', 'XX....', '......', '......'] }, // split
    { rows: ['A.A...', '......', '......', 'XX....', '......', '......'] }, // split in a row
    { rows: ['A.....', '......', '......', 'XX....', '......', '......'] }, // one cell
    { rows: ['AAAA..', '......', '......', 'XX....', '......', '......'] }, // 4 long
    { rows: ['AAA...', '......', 'XX....', '......', '......', '......'], vehicles: { A: 'car' } },
    { rows: ['AA....', '......', 'XX....', '......', '......', '......'], vehicles: { A: 'bus' } },
    { rows: ['AA....', '......', 'XX....', '......', '......', '......'], vehicles: { A: 'truck' } },
    { rows: ['AA....', '......', 'XX....', '......', '......', '......'], vehicles: { A: { dir: 'v' } } },
    { rows: ['AA....', '......', 'XX....', '......', '......', '......'], vehicles: { A: 7 } },
    { rows: ok, vehicles: { B: 'car' } },                                   // not on the board
    { rows: ok, vehicles: [] },
    { rows: ok, optimal: 0 },
    { rows: ok, optimal: 2.5 },
    { rows: ok, optimal: '3' },
  ];
  for (const def of bad) assert.throws(() => P.parseLevel(def), Error, JSON.stringify(def));
  assert.doesNotThrow(() => P.parseLevel({ rows: ok, optimal: null }));
  assert.throws(() => P.newGame({ rows: ['......', '......', 'XX....', '......', '......', '......'], optimal: -1 }));
  assert.throws(() => P.solve({ rows: ['XX'] }));
});

test('BFS finds a short path on a 7×7 board with every kind of object', () => {
  const def = {
    rows: [
      '..A..B.',
      '..A..B.',
      'XXA.|B.',
      'CCC....',
      '...#...',
      'T......',
      'T..EE..',
    ],
    vehicles: { T: 'tow' },
  };
  const sol = P.solve(def);
  assert.equal(sol.moves, 4, JSON.stringify(sol));
  assert.equal(replay(def, sol.path).status, 'won');
  // no shorter path exists: every path of fewer moves found by a brute-force check fails
  assert.equal(shortest(def, sol.moves - 1), false);
});

// Depth-limited brute force through the public move API (independent of the BFS internals).
function shortest(def, depth) {
  const s = P.newGame({ ...def, optimal: 99 });
  const ids = s.vehicles.map((v) => v.id);
  const dfs = (d) => {
    if (s.status === 'won') return true;
    if (d === 0) return false;
    for (const id of ids) {
      const r = P.moveRange(s, id);
      if (!r) continue;
      const deltas = [];
      for (let k = r.min; k <= r.max; k++) if (k) deltas.push(k);
      if (r.exit) deltas.push(r.max + 1);
      for (const k of deltas) {
        P.move(s, id, k);
        const ok = dfs(d - 1);
        P.undo(s);
        if (ok) return true;
      }
    }
    return false;
  };
  return dfs(depth);
}

// Hints: the client runs solverFor a slice at a time and turns the result into a hint with hintOf.
test('solverFor gives the same answer as solveState, a slice per next()', () => {
  const { LEVELS } = require('../../web/parking/levels.js');
  const def = LEVELS[27];
  const s = P.newGame(def);
  const it = P.solverFor(s);
  let slices = 0;
  let r = it.next();
  while (!r.done) { slices++; r = it.next(); }
  assert.ok(slices >= 1, 'a big board takes more than one slice');
  assert.deepEqual(r.value, P.solveState(s));
  assert.equal(r.value.moves, def.optimal);
  const out = P.newGame({ rows: ['......', '......', 'XX....', '......', '......', '......'], optimal: 1 });
  P.move(out, 'X', 6);
  assert.deepEqual(P.solveState(out), { moves: 0, path: [] });
});

test('hintOf: the first move, but no hint without a way out or past the move limit', () => {
  const def = { rows: ['..A...', '..A...', 'XXA...', '......', '......', '......'], optimal: 2 };
  const s = P.newGame(def);
  const sol = P.solveState(s);
  assert.deepEqual(P.hintOf(s, sol), { id: sol.path[0][0], delta: sol.path[0][1] });
  assert.equal(P.hintOf(s, null), null, 'no solution');
  assert.equal(P.hintOf(s, { moves: 0, path: [] }), null);
  // waste moves until the solution no longer fits in what is left
  while (s.limit - s.moves >= sol.moves) { P.move(s, 'A', 1); P.move(s, 'A', -1); }
  const late = P.solveState(s);
  assert.equal(late.moves, sol.moves, 'still solvable on the board');
  assert.ok(late.moves > s.limit - s.moves);
  assert.equal(P.hintOf(s, late), null, 'but not within the moves left');
});

test('followRoute reuses a solution while the player keeps to it', () => {
  const sol = { moves: 3, path: [['B', 3], ['A', 3], ['X', 6]] };
  assert.deepEqual(P.followRoute([], sol, []), sol);
  assert.deepEqual(P.followRoute([], sol, [['B', 3]]), { moves: 2, path: [['A', 3], ['X', 6]] });
  assert.deepEqual(P.followRoute([['C', 1]], sol, [['C', 1], ['B', 3], ['A', 3]]), { moves: 1, path: [['X', 6]] });
  assert.equal(P.followRoute([], sol, [['B', 2]]), null, 'left the route');
  assert.equal(P.followRoute([['C', 1]], sol, []), null, 'undone past where it was found');
  assert.equal(P.followRoute([['C', 1]], sol, [['C', -1]]), null);
  assert.equal(P.followRoute([], null, []), null);
});
