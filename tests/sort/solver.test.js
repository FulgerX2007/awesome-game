'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../web/sort/core.js');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(colors, cap, empty, seed) {
  const r = rng(seed);
  const layers = [];
  for (let c = 0; c < colors; c++) for (let i = 0; i < cap; i++) layers.push(c);
  for (let i = layers.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [layers[i], layers[j]] = [layers[j], layers[i]];
  }
  const tubes = [];
  for (let c = 0; c < colors; c++) tubes.push(layers.slice(c * cap, (c + 1) * cap));
  for (let i = 0; i < empty; i++) tubes.push([]);
  return { tubes, cap };
}

// Plain breadth-first search over every legal pour, no pruning: the reference optimum.
function bruteForce(level) {
  const { tubes, cap } = level;
  const key = (ts) => ts.map((t) => t.join(',')).sort().join('|');
  const dist = new Map([[key(tubes), 0]]);
  const queue = [tubes];
  for (let qi = 0; qi < queue.length; qi++) {
    const ts = queue[qi];
    const d = dist.get(key(ts));
    if (S.solved(ts, cap)) return d;
    for (let a = 0; a < ts.length; a++) {
      for (let b = 0; b < ts.length; b++) {
        const n = S.pourAmount(ts, cap, a, b);
        if (!n) continue;
        const next = ts.map((t) => t.slice());
        for (let i = 0; i < n; i++) next[b].push(next[a].pop());
        const k = key(next);
        if (!dist.has(k)) { dist.set(k, d + 1); queue.push(next); }
      }
    }
  }
  return null;
}

const replays = (level, path) => {
  const g = S.newGame(level);
  for (const [a, b] of path) assert.ok(S.pour(g, a, b) > 0, `pour ${a}→${b} is legal`);
  return g.status === 'won';
};

test('hand-made boards with known optima', () => {
  // Two colours, one swap through the empty tube: 3 moves.
  const swap = { tubes: [[0, 0, 0, 1], [1, 1, 1, 0], []], cap: 4 };
  const s = S.solve(swap);
  assert.equal(s.moves, 3);
  assert.ok(replays(swap, s.path));
  // Already solved: 0 moves.
  assert.deepEqual(S.solve({ tubes: [[0, 0, 0, 0], [], [1, 1, 1, 1]], cap: 4 }).path, []);
  // One pour finishes it.
  const one = { tubes: [[0, 0, 0], [0], [1, 1, 1, 1]], cap: 4 };
  const s1 = S.solve(one);
  assert.equal(s1.moves, 1);
  assert.ok(replays(one, s1.path));
});

test('A* matches brute force on small random boards (solvable and not)', () => {
  let solvable = 0, unsolvable = 0;
  for (const [colors, cap, empty] of [[3, 3, 2], [3, 4, 2], [4, 4, 2], [4, 3, 1], [5, 3, 2], [4, 4, 1]]) {
    for (let seed = 1; seed <= 12; seed++) {
      const level = shuffled(colors, cap, empty, seed * 131 + colors * 7 + cap);
      const a = S.solve(level);
      const b = bruteForce(level);
      assert.equal(a ? a.moves : null, b, JSON.stringify(level));
      if (a) { solvable++; assert.ok(replays(level, a.path)); } else unsolvable++;
    }
  }
  assert.ok(solvable > 20 && unsolvable > 0, 'the sample covers both cases');
});

test('an unsolvable board gives null', () => {
  assert.equal(S.solve({ tubes: [[0, 1, 0, 1], [1, 0, 1, 0]], cap: 4 }), null);
});

test('the path uses real tube indices and replays on a fresh game', () => {
  // Empty tubes first, so the canonical (sorted) order differs from the real one.
  const level = shuffled(6, 4, 2, 77);
  level.tubes.unshift(level.tubes.pop());
  const s = S.solve(level);
  assert.ok(s);
  assert.ok(replays(level, s.path));
});

test('large boards finish under the default state cap', () => {
  for (const [colors, cap] of [[9, 5], [12, 4], [12, 5]]) {
    const level = shuffled(colors, cap, 2, colors * 1000 + cap);
    const s = S.solve(level);
    assert.ok(s, `${colors}×${cap} solved`);
    assert.ok(s.expanded <= S.MAX_STATES);
    assert.ok(replays(level, s.path));
  }
});

test('the state cap makes the solver give up', () => {
  const level = shuffled(10, 4, 2, 5);
  assert.equal(S.solve(level, { maxStates: 1 }), null);
});

test('the heuristic never overestimates on a solved path', () => {
  // Along an optimal path, h(state) ≤ moves left.
  const level = shuffled(6, 4, 2, 11);
  const s = S.solve(level);
  const g = S.newGame(level);
  const enc = (ts) => ts.map((t) => t.map((c) => String.fromCharCode(97 + c)).join(''));
  for (let i = 0; i <= s.path.length; i++) {
    assert.ok(S.heuristic(enc(g.tubes)) <= s.path.length - i);
    if (i < s.path.length) S.pour(g, s.path[i][0], s.path[i][1]);
  }
});

test('solveTubes works from a game in progress', () => {
  const level = shuffled(5, 4, 2, 3);
  const full = S.solve(level);
  const g = S.newGame(level);
  S.pour(g, full.path[0][0], full.path[0][1]);
  const rest = S.solveTubes(g.tubes, level.cap);
  assert.equal(rest.moves, full.moves - 1);
});
