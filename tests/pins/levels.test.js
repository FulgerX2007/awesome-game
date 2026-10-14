'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../web/pins/core.js');
const { LEVELS, SRC, make, rock } = require('../../web/pins/levels.js');

const { W, H, WALL, PIN, GOLD } = P;

function cells(r, fn) {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) fn(x, y);
}
const within = (inner, outer) => inner.x >= outer.x && inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

// The solver runs once per level; several tests read its results.
const solved = new Map();
function solution(i) {
  if (!solved.has(i)) solved.set(i, P.solve(LEVELS[i]));
  return solved.get(i);
}

function play(def, order) {
  const s = P.buildLevel(def);
  const rest = () => { while (!s.lost && !P.settled(s)) P.step(s); };
  rest();
  for (const id of order) { P.pull(s, id); rest(); }
  return s;
}

test('there are 30 levels, all made from the compact sources', () => {
  assert.equal(LEVELS.length, 30);
  assert.equal(SRC.length, 30);
});

test('rock() covers exactly the cells that are not carved, without overlaps', () => {
  const carved = [{ x: 2, y: 3, w: 5, h: 4 }, { x: 4, y: 6, w: 10, h: 2 }, { x: 30, y: 50, w: 10, h: 10 }];
  const open = new Uint8Array(W * H);
  for (const r of carved) {
    cells(r, (x, y) => { if (x < W && y < H) open[y * W + x] = 1; });
  }
  const hits = new Uint8Array(W * H);
  for (const r of rock(carved)) cells(r, (x, y) => { hits[y * W + x]++; });
  for (let i = 0; i < W * H; i++) assert.equal(hits[i], open[i] ? 0 : 1, `cell ${i % W},${Math.floor(i / W)}`);
});

test('make() carves pins and their handle cells out of the rock', () => {
  const def = make({
    open: [[5, 5, 6, 4]],
    pins: [[1, 5, 9, 6, 1, 'right']],
    hero: [5, 20], room: [5, 20, 3, 5], exit: [5, 20], goldTarget: 0,
  });
  assert.deepEqual(def.pins, [{ id: 1, x: 5, y: 9, w: 6, h: 1, handle: 'right' }]);
  assert.deepEqual(P.handleCell(def.pins[0]), { x: 11, y: 9 });
  assert.deepEqual(def.hero, { x: 5, y: 20, w: 3, h: 5 });
  assert.deepEqual(def.exit, { x: 5, y: 20, w: 3, h: 5 });
  assert.equal(def.enemies.length, 0);
  // the hero stands in rock here, so the level is invalid
  assert.throws(() => P.buildLevel(def), /hero: overlaps/);
  const s = P.buildLevel({ ...def, hero: null });
  assert.equal(P.cellAt(s, 11, 9), P.EMPTY); // the handle's pocket
  assert.equal(P.cellAt(s, 12, 9), WALL);
  assert.equal(P.cellAt(s, 11, 8), WALL);
  assert.equal(P.cellAt(s, 8, 9), PIN);
  assert.equal(P.cellAt(s, 8, 7), P.EMPTY);
  assert.equal(P.cellAt(s, 4, 7), WALL);
});

test('handleCell sits past the handle end of the pin', () => {
  assert.deepEqual(P.handleCell({ x: 4, y: 10, w: 6, h: 1, handle: 'left' }), { x: 3, y: 10 });
  assert.deepEqual(P.handleCell({ x: 4, y: 10, w: 6, h: 1, handle: 'right' }), { x: 10, y: 10 });
  assert.deepEqual(P.handleCell({ x: 19, y: 48, w: 1, h: 5, handle: 'top' }), { x: 19, y: 47 });
  assert.deepEqual(P.handleCell({ x: 4, y: 10, w: 2, h: 3, handle: 'left' }), { x: 3, y: 11 });
});

test('every level builds and fits the grid: hero, room, exit and handles stay clear of rock', () => {
  LEVELS.forEach((def, i) => {
    const n = `level ${i + 1}`;
    const s = P.buildLevel(def); // throws on overlaps and out-of-bounds rectangles
    assert.equal(s.lost, null, `${n}: lost at the start`);
    assert.ok(within(def.room, { x: 0, y: 0, w: W, h: H }), `${n}: room out of the grid`);
    assert.ok(within(def.hero, def.room), `${n}: the hero is outside the room`);
    assert.ok(within(def.exit, def.room), `${n}: the exit is outside the room`);
    cells(def.room, (x, y) => assert.notEqual(P.cellAt(s, x, y), WALL, `${n}: rock in the room at ${x},${y}`));
    cells(def.room, (x, y) => assert.notEqual(P.cellAt(s, x, y), PIN, `${n}: a pin in the room at ${x},${y}`));
    assert.equal(P.count(s, GOLD, def.room), 0, `${n}: gold starts in the room`);
    assert.ok(def.goldTarget > 0, `${n}: no gold target`);
    for (const p of def.pins) {
      const c = P.handleCell(p);
      assert.ok(c.x >= 0 && c.x < W && c.y >= 0 && c.y < H, `${n}: handle of pin ${p.id} is off the grid`);
      const code = P.cellAt(s, c.x, c.y);
      assert.ok(code !== WALL && code !== PIN, `${n}: handle of pin ${p.id} is in rock or another pin`);
    }
  });
});

test('pins are numbered 1..n and their count follows the difficulty curve', () => {
  LEVELS.forEach((def, i) => {
    const level = i + 1;
    const ids = def.pins.map((p) => p.id).sort((a, b) => a - b);
    assert.deepEqual(ids, ids.map((_, k) => k + 1), `level ${level}: pin ids`);
    const n = def.pins.length;
    const [lo, hi] = level <= 5 ? [1, 2] : level <= 20 ? [3, 4] : [4, 5];
    assert.ok(n >= lo && n <= hi, `level ${level}: ${n} pins, expected ${lo}–${hi}`);
  });
});

test('the teaching levels 1–5 introduce gold, water, lava, an enemy and water + lava', () => {
  const has = (i, type) => LEVELS[i].fills.some((f) => f.type === type);
  assert.ok(has(0, 'gold') && !has(0, 'water') && !has(0, 'lava') && LEVELS[0].enemies.length === 0);
  assert.ok(has(1, 'water') && !has(1, 'lava') && LEVELS[1].enemies.length === 0);
  assert.ok(has(2, 'lava') && !has(2, 'water') && LEVELS[2].enemies.length === 0);
  assert.ok(LEVELS[3].enemies.length > 0 && !has(3, 'water'));
  assert.ok(has(4, 'water') && has(4, 'lava'));
});

test('every level is solvable, not won without pulling, and some pull order loses', () => {
  LEVELS.forEach((_, i) => {
    const r = solution(i);
    assert.equal(r.wonWithoutPull, false, `level ${i + 1}: won without pulling`);
    assert.ok(r.wins.length >= 1, `level ${i + 1}: no winning order`);
    assert.ok(r.losses.length >= 1, `level ${i + 1}: no losing order`);
  });
});

test('at least 10 levels have two or more winning orders', () => {
  const many = LEVELS.map((_, i) => i).filter((i) => solution(i).wins.length >= 2);
  assert.ok(many.length >= 10, `only ${many.length} levels with several solutions`);
});

test('the winning orders really win, and every level can be finished with 3 stars', () => {
  LEVELS.forEach((def, i) => {
    let best = 0;
    for (const order of solution(i).wins) {
      const s = play(def, order);
      assert.equal(P.status(s).status, 'won', `level ${i + 1}: order ${order} does not win`);
      best = Math.max(best, P.stars(s));
    }
    assert.equal(best, 3, `level ${i + 1}: no 3-star solution`);
  });
});

test('every losing order really loses', () => {
  LEVELS.forEach((def, i) => {
    for (const order of solution(i).losses) {
      assert.equal(P.status(play(def, order)).status, 'lost', `level ${i + 1}: order ${order} does not lose`);
    }
  });
});

// The solver's player waits for the world to settle after every pull; a real one may pull while things still flow.
function hasty(def, order, gap) {
  const s = P.buildLevel(def);
  P.settle(s);
  for (const id of order) {
    P.pull(s, id);
    for (let k = 0; k < gap && !s.lost; k++) P.step(s);
  }
  P.settle(s);
  return s;
}

test('a hasty player who pulls 10–30 ticks apart can still win every level with 3 stars', () => {
  LEVELS.forEach((def, i) => {
    for (const gap of [10, 20, 30]) {
      const ok = solution(i).wins.some((order) => {
        const s = hasty(def, order, gap);
        return P.status(s).status === 'won' && P.stars(s) === 3;
      });
      assert.ok(ok, `level ${i + 1}: no 3-star win when pins are pulled ${gap} ticks apart`);
    }
  });
});
