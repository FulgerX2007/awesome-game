'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../web/parking/core.js');
const { LEVELS } = require('../../web/parking/levels.js');

// Difficulty bands from the plan (1-based level numbers, inclusive).
const BANDS = [
  { from: 1, to: 5, min: 2, max: 5 },
  { from: 6, to: 15, min: 6, max: 10 },
  { from: 16, to: 25, min: 10, max: 16 },
  { from: 26, to: 40, min: 14, max: 25 },
];
const SPECIALS_FROM = 12;
const BIG_FROM = 26;

const parsed = LEVELS.map((def) => P.parseLevel(def));
const hasGate = (L) => L.cells.includes(P.GATE);
const hasTow = (L) => L.vehicles.some((v) => v.kind === 'tow');

// BFS runs once per level; several tests read it.
const solved = new Map();
function solution(i) {
  if (!solved.has(i)) solved.set(i, P.solve(LEVELS[i]));
  return solved.get(i);
}

test('there are 40 levels and every one parses with a stored optimum', () => {
  assert.equal(LEVELS.length, 40);
  parsed.forEach((L, i) => {
    assert.ok(Number.isInteger(LEVELS[i].optimal) && LEVELS[i].optimal >= 1, `level ${i + 1} has optimal`);
    assert.equal(L.optimal, LEVELS[i].optimal);
    assert.equal(L.exitRow, (L.h - 1) >> 1, `level ${i + 1}: X sits in the middle row`);
  });
});

test('the stored optimum equals the BFS optimum, and the BFS path wins in exactly that many moves', () => {
  LEVELS.forEach((def, i) => {
    const sol = solution(i);
    assert.ok(sol, `level ${i + 1} is solvable`);
    assert.equal(sol.moves, def.optimal, `level ${i + 1}`);
    const s = P.newGame(def);
    assert.equal(s.optimal, def.optimal);
    for (const [id, d] of sol.path) assert.equal(P.move(s, id, d), true, `level ${i + 1}: ${id} ${d}`);
    assert.equal(s.status, 'won', `level ${i + 1}`);
    assert.equal(P.stars(s.moves, s.optimal), 3);
  });
});

test('the optimum follows the difficulty bands and grows overall', () => {
  for (const b of BANDS) {
    for (let n = b.from; n <= b.to; n++) {
      const opt = LEVELS[n - 1].optimal;
      assert.ok(opt >= b.min && opt <= b.max, `level ${n}: optimum ${opt} outside ${b.min}–${b.max}`);
    }
  }
  // within each band the levels never get easier
  for (const b of BANDS) {
    for (let n = b.from + 1; n <= b.to; n++) {
      assert.ok(LEVELS[n - 1].optimal >= LEVELS[n - 2].optimal, `level ${n} is not easier than ${n - 1}`);
    }
  }
  assert.ok(LEVELS[39].optimal >= 20, 'the last level is a long one');
});

test('no duplicate levels', () => {
  const keys = LEVELS.map((d) => d.rows.join('/') + '|' + JSON.stringify(d.vehicles || {}));
  assert.equal(new Set(keys).size, LEVELS.length);
});

test('board size, barriers and tow trucks are where the curve says', () => {
  parsed.forEach((L, i) => {
    const n = i + 1;
    const size = n >= BIG_FROM ? 7 : 6;
    assert.equal(L.w, size, `level ${n} width`);
    assert.equal(L.h, size, `level ${n} height`);
    if (n < SPECIALS_FROM) {
      assert.equal(hasGate(L), false, `level ${n} has no barrier yet`);
      assert.equal(hasTow(L), false, `level ${n} has no tow truck yet`);
    } else {
      assert.ok(hasGate(L) || hasTow(L), `level ${n} has a barrier or a tow truck`);
    }
  });
  const from = parsed.slice(SPECIALS_FROM - 1);
  assert.ok(from.filter(hasGate).length >= 10, 'barriers are common after level 12');
  assert.ok(from.filter(hasTow).length >= 10, 'tow trucks are common after level 12');
  assert.ok(hasGate(parsed[SPECIALS_FROM - 1]) || hasTow(parsed[SPECIALS_FROM - 1]), 'level 12 introduces one');
});

test('every barrier matters: with the barriers open each barrier level is solved in fewer moves', () => {
  const gated = LEVELS.map((def, i) => [def, i]).filter(([, i]) => hasGate(parsed[i]));
  assert.ok(gated.length >= 10);
  for (const [def, i] of gated) {
    const open = { rows: def.rows.map((r) => r.split(P.GATE).join(P.EMPTY)) };
    if (def.vehicles) open.vehicles = def.vehicles;
    const sol = P.solve(open);
    assert.ok(sol && sol.moves < def.optimal, `level ${i + 1}: ${sol && sol.moves} moves without the barrier, ${def.optimal} with it`);
  }
});

test('levels are blocking chains, not idle crowds', () => {
  LEVELS.forEach((def, i) => {
    const sol = solution(i);
    const movers = new Set(sol.path.map(([id]) => id));
    // X plus at least one blocker; from level 6 at least half the optimal moves are made by different vehicles
    assert.ok(movers.size >= 2, `level ${i + 1}: something has to move out of the way`);
    if (i + 1 >= 6) assert.ok(movers.size * 2 >= sol.moves, `level ${i + 1}: ${movers.size} movers for ${sol.moves}`);
    // a tow truck, where present, is part of the solution
    const tows = parsed[i].vehicles.filter((v) => v.kind === 'tow').map((v) => v.id);
    if (tows.length) assert.ok(tows.some((t) => movers.has(t)), `level ${i + 1}: the tow truck matters`);
  });
});

test('the move limit as played: wasted moves up to the limit still win, one pair more loses', () => {
  LEVELS.forEach((def, i) => {
    const sol = solution(i);
    // a vehicle that can step out and back from the start: two wasted moves that keep the barrier parity
    const probe = P.newGame(def);
    let shuffle = null;
    for (const u of probe.vehicles) {
      for (const d of [1, -1]) {
        if (shuffle || !P.move(probe, u.id, d)) continue;
        if (P.canMove(probe, u.id, -d)) shuffle = [u.id, d];
        P.undo(probe);
      }
    }
    assert.ok(shuffle, `level ${i + 1}: something can shuffle`);
    const [id0, d0] = shuffle;
    const playWith = (pairs) => {
      const s = P.newGame(def);
      for (let k = 0; k < pairs && s.status === 'playing'; k++) { P.move(s, id0, d0); P.move(s, id0, -d0); }
      for (const [id, d] of sol.path) if (s.status === 'playing') P.move(s, id, d);
      return s;
    };
    const spare = Math.floor((P.limitFor(def.optimal) - def.optimal) / 2);
    const ok = playWith(spare);
    assert.equal(ok.status, 'won', `level ${i + 1}: ${spare} wasted pairs`);
    assert.equal(P.stars(ok.moves, ok.optimal), 1);
    assert.equal(playWith(spare + 1).status, 'lost', `level ${i + 1}: ${spare + 1} wasted pairs`);
  });
});
