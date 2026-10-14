'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../web/pins/core.js');

const { W, H, EMPTY, WALL, PIN, WATER, LAVA, STONE, GOLD } = P;

// A closed box: floor, side walls, no ceiling. Inside is x 1..34, y 0..52.
const shell = () => [
  { x: 0, y: 0, w: 1, h: H },
  { x: W - 1, y: 0, w: 1, h: H },
  { x: 0, y: H - 1, w: W, h: 1 },
];

const level = (extra) => ({ walls: shell(), pins: [], fills: [], ...extra });

function ticks(s, n) {
  for (let k = 0; k < n; k++) P.step(s);
}

test('grid is 36×54 and cell codes match the table', () => {
  assert.equal(W, 36);
  assert.equal(H, 54);
  assert.deepEqual([EMPTY, WALL, PIN, WATER, LAVA, STONE, GOLD], [0, 1, 2, 3, 4, 5, 6]);
});

test('buildLevel rasterizes walls, pins and fills', () => {
  const s = P.buildLevel(level({
    walls: [...shell(), { x: 5, y: 10, w: 4, h: 2 }, { x: 7, y: 11, w: 4, h: 2 }], // overlapping walls are fine
    pins: [{ id: 1, x: 10, y: 20, w: 8, h: 1, handle: 'right' }],
    fills: [{ type: 'water', x: 2, y: 2, w: 3, h: 2 }, { type: 'lava', x: 20, y: 2, w: 2, h: 2 },
      { type: 'gold', x: 25, y: 2, w: 1, h: 3 }],
  }));
  assert.equal(P.cellAt(s, 5, 10), WALL);
  assert.equal(P.cellAt(s, 10, 12), WALL);
  assert.equal(P.cellAt(s, 4, 10), EMPTY);
  for (let x = 10; x < 18; x++) {
    assert.equal(P.cellAt(s, x, 20), PIN);
    assert.equal(s.pinId[P.idx(x, 20)], 1);
  }
  assert.equal(s.pinId[P.idx(9, 20)], -1);
  assert.equal(P.count(s, WATER), 6);
  assert.equal(P.count(s, LAVA), 4);
  assert.equal(P.count(s, GOLD), 3);
  assert.equal(P.count(s, PIN), 8);
  assert.deepEqual(s.pins, [{ id: 1, x: 10, y: 20, w: 8, h: 1, handle: 'right', pulled: false }]);
  // outside the grid counts as wall
  assert.equal(P.cellAt(s, -1, 5), WALL);
  assert.equal(P.cellAt(s, 5, H), WALL);
});

test('buildLevel keeps hero, enemies, room, exit and goldTarget', () => {
  const s = P.buildLevel(level({
    hero: { x: 3, y: 47, w: 3, h: 5 },
    enemies: [{ x: 20, y: 47, w: 3, h: 5 }],
    room: { x: 1, y: 40, w: 15, h: 13 },
    exit: { x: 12, y: 47, w: 3, h: 5 },
    goldTarget: 10,
  }));
  assert.deepEqual(s.hero, { x: 3, y: 47, w: 3, h: 5 });
  assert.deepEqual(s.enemies, [{ x: 20, y: 47, w: 3, h: 5, dead: false }]);
  assert.deepEqual(s.room, { x: 1, y: 40, w: 15, h: 13 });
  assert.deepEqual(s.exit, { x: 12, y: 47, w: 3, h: 5 });
  assert.equal(s.goldTarget, 10);
});

test('pulling a pin clears its cells, re-pulling returns false', () => {
  const s = P.buildLevel(level({
    pins: [{ id: 1, x: 1, y: 20, w: 34, h: 1, handle: 'left' }, { id: 2, x: 1, y: 30, w: 34, h: 1, handle: 'right' }],
  }));
  assert.equal(P.pull(s, 1), true);
  assert.equal(P.count(s, PIN), 34);
  assert.equal(P.cellAt(s, 5, 20), EMPTY);
  assert.equal(s.pinId[P.idx(5, 20)], -1);
  assert.equal(P.cellAt(s, 5, 30), PIN);
  assert.equal(s.pins[0].pulled, true);
  assert.equal(s.pins[1].pulled, false);
  assert.equal(P.pull(s, 1), false);
  assert.equal(P.count(s, PIN), 34);
});

test('pulling an unknown pin id returns false and changes nothing', () => {
  const s = P.buildLevel(level({ pins: [{ id: 1, x: 1, y: 20, w: 34, h: 1, handle: 'left' }] }));
  const before = s.grid.slice();
  for (const id of [0, 2, -1, 99, 1.5, '1', null, undefined]) assert.equal(P.pull(s, id), false);
  assert.deepEqual(s.grid, before);
  assert.equal(s.pins[0].pulled, false);
});

test('water held by a pin falls once it is pulled and spreads over the floor', () => {
  const s = P.buildLevel(level({
    pins: [{ id: 1, x: 10, y: 20, w: 6, h: 1, handle: 'right' }],
    walls: [...shell(), { x: 9, y: 10, w: 1, h: 11 }, { x: 16, y: 10, w: 1, h: 11 }], // a cup on top of the pin
    fills: [{ type: 'water', x: 10, y: 16, w: 6, h: 4 }],
  }));
  P.settle(s);
  assert.equal(P.count(s, WATER, { x: 10, y: 16, w: 6, h: 4 }), 24, 'held by the pin');
  P.pull(s, 1);
  P.settle(s);
  assert.equal(P.count(s, WATER), 24);
  assert.equal(P.count(s, WATER, { x: 10, y: 0, w: 6, h: 21 }), 0, 'the cup emptied');
  // it lies on the floor in a layer of one or two cells
  const floorRow = H - 2;
  let onFloor = 0;
  for (let x = 1; x < W - 1; x++) if (P.cellAt(s, x, floorRow) === WATER) onFloor++;
  assert.ok(onFloor >= 12, `spread along the floor: ${onFloor}`);
  for (let y = 0; y < floorRow - 1; y++) for (let x = 0; x < W; x++) assert.notEqual(P.cellAt(s, x, y), WATER);
});

test('a single water cell falls straight down one cell per tick and rests on the floor', () => {
  const s = P.buildLevel(level({ fills: [{ type: 'water', x: 17, y: 10, w: 1, h: 1 }] }));
  P.step(s);
  assert.equal(P.cellAt(s, 17, 11), WATER);
  assert.equal(P.cellAt(s, 17, 10), EMPTY);
  ticks(s, 41); // reaches the floor (y = 52) after 42 ticks
  assert.equal(P.cellAt(s, 17, H - 2), WATER);
  const t = P.settle(s);
  assert.ok(t > 0 && P.settled(s));
  assert.equal(P.count(s, WATER), 1);
  assert.equal(P.count(s, WATER, { x: 0, y: H - 2, w: W, h: 1 }), 1);
});

test('water falls diagonally off a ledge and does not leak through corners', () => {
  // two walls touching only at a corner: (10,30) and (11,31). Water sitting on (10,30)'s top must not pass.
  const s = P.buildLevel(level({
    walls: [...shell(), { x: 1, y: 31, w: 10, h: 1 }, { x: 11, y: 30, w: 24, h: 1 }],
    fills: [{ type: 'water', x: 1, y: 25, w: 10, h: 6 }],
  }));
  P.settle(s);
  assert.equal(P.count(s, WATER, { x: 0, y: 32, w: W, h: H - 32 }), 0, 'nothing below the floors');
  assert.equal(P.count(s, WATER), 60);
});

test('gold falls like sand and never moves sideways on a flat floor', () => {
  const s = P.buildLevel(level({ fills: [{ type: 'gold', x: 17, y: 10, w: 1, h: 6 }] }));
  P.settle(s);
  assert.equal(P.count(s, GOLD), 6);
  // a column of 6 collapses into a heap: the bottom row has gold, nothing hangs in the air
  for (let y = 0; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (P.cellAt(s, x, y) !== GOLD) continue;
      assert.notEqual(P.cellAt(s, x, y + 1), EMPTY, `gold at ${x},${y} rests on something`);
    }
  }
  // a single gold grain on a flat floor stays where it lands
  const one = P.buildLevel(level({ fills: [{ type: 'gold', x: 5, y: 5, w: 1, h: 1 }] }));
  P.settle(one);
  assert.equal(P.cellAt(one, 5, H - 2), GOLD);
});

test('gold sinks through water to the bottom', () => {
  const s = P.buildLevel(level({
    walls: [...shell(), { x: 9, y: 30, w: 1, h: 23 }, { x: 16, y: 30, w: 1, h: 23 }], // a tank x 10..15
    fills: [{ type: 'water', x: 10, y: 43, w: 6, h: 10 }, { type: 'gold', x: 12, y: 35, w: 2, h: 2 }],
  }));
  P.settle(s);
  assert.equal(P.count(s, GOLD), 4);
  assert.equal(P.count(s, WATER), 60);
  assert.equal(P.count(s, GOLD, { x: 10, y: H - 3, w: 6, h: 2 }), 4, 'gold lies on the tank floor');
});

test('lava and water make stone; the lava cell turns to stone, the water cell vanishes', () => {
  const s = P.buildLevel(level({
    fills: [{ type: 'lava', x: 10, y: 51, w: 1, h: 1 }, { type: 'water', x: 11, y: 51, w: 1, h: 1 }],
    walls: [...shell(), { x: 9, y: 51, w: 1, h: 2 }, { x: 12, y: 51, w: 1, h: 2 }],
  }));
  P.step(s);
  assert.equal(P.cellAt(s, 10, 51), STONE);
  assert.equal(P.cellAt(s, 11, 51), EMPTY);
  assert.equal(P.count(s, LAVA), 0);
  assert.equal(P.count(s, WATER), 0);
});

test('water poured on a lava pool covers it with stone', () => {
  const s = P.buildLevel(level({
    pins: [{ id: 1, x: 1, y: 30, w: 34, h: 1, handle: 'left' }],
    fills: [{ type: 'water', x: 1, y: 20, w: 34, h: 3 }, { type: 'lava', x: 1, y: 50, w: 34, h: 3 }],
  }));
  P.pull(s, 1);
  P.settle(s);
  assert.ok(P.count(s, STONE) >= 34, 'a crust of stone');
  const stone = P.count(s, STONE), water = P.count(s, WATER), lava = P.count(s, LAVA);
  assert.equal(water + stone, 102, 'each stone used up one water cell');
  assert.equal(lava + stone, 102, 'each stone used up one lava cell');
});

test('lava destroys the gold it touches', () => {
  const s = P.buildLevel(level({
    walls: [...shell(), { x: 9, y: 40, w: 1, h: 13 }, { x: 16, y: 40, w: 1, h: 13 }],
    fills: [{ type: 'lava', x: 10, y: 48, w: 6, h: 5 }, { type: 'gold', x: 11, y: 30, w: 4, h: 3 }],
  }));
  P.settle(s);
  assert.equal(P.count(s, GOLD), 0);
  assert.equal(P.count(s, LAVA), 30);
});

test('lava moves only on even ticks', () => {
  const s = P.buildLevel(level({ fills: [{ type: 'lava', x: 17, y: 10, w: 1, h: 1 }] }));
  P.step(s); // tick 0: moves
  assert.equal(P.cellAt(s, 17, 11), LAVA);
  P.step(s); // tick 1: rests
  assert.equal(P.cellAt(s, 17, 11), LAVA);
  P.step(s); // tick 2: moves
  assert.equal(P.cellAt(s, 17, 12), LAVA);
});

test('the automaton is deterministic', () => {
  const def = level({
    pins: [{ id: 1, x: 1, y: 25, w: 17, h: 1, handle: 'left' }, { id: 2, x: 18, y: 25, w: 17, h: 1, handle: 'right' }],
    fills: [{ type: 'water', x: 2, y: 15, w: 14, h: 8 }, { type: 'lava', x: 20, y: 15, w: 12, h: 6 },
      { type: 'gold', x: 5, y: 2, w: 20, h: 4 }],
  });
  const run = () => {
    const s = P.buildLevel(def);
    ticks(s, 30);
    P.pull(s, 2);
    ticks(s, 50);
    P.pull(s, 1);
    P.settle(s);
    return s;
  };
  const a = run(), b = run();
  assert.deepEqual(a.grid, b.grid);
  assert.equal(a.tick, b.tick);
  // a clone continues exactly like the original
  const s = P.buildLevel(def);
  P.pull(s, 1);
  ticks(s, 10);
  const c = P.clone(s);
  ticks(s, 100);
  ticks(c, 100);
  assert.deepEqual(s.grid, c.grid);
  assert.deepEqual(s.flow, c.flow);
});

test('water and gold cells are conserved when there is no lava', () => {
  const s = P.buildLevel(level({
    walls: [...shell(), { x: 12, y: 35, w: 12, h: 2 }],
    pins: [{ id: 1, x: 1, y: 20, w: 34, h: 1, handle: 'left' }],
    fills: [{ type: 'water', x: 1, y: 10, w: 34, h: 6 }, { type: 'gold', x: 8, y: 2, w: 20, h: 5 }],
  }));
  const water = P.count(s, WATER), gold = P.count(s, GOLD);
  P.pull(s, 1);
  for (let k = 0; k < 400; k++) {
    P.step(s);
    if (k % 25 === 0) {
      assert.equal(P.count(s, WATER), water);
      assert.equal(P.count(s, GOLD), gold);
    }
  }
  P.settle(s);
  assert.equal(P.count(s, WATER), water);
  assert.equal(P.count(s, GOLD), gold);
});

test('settled after 20 quiet ticks; a pull wakes it; the 3000-tick cap ends any run', () => {
  const s = P.buildLevel(level({
    pins: [{ id: 1, x: 1, y: 20, w: 34, h: 1, handle: 'left' }],
    fills: [{ type: 'water', x: 1, y: 15, w: 34, h: 5 }],
  }));
  assert.equal(P.settled(s), false);
  const n = P.settle(s);
  assert.ok(n >= P.SETTLE_TICKS && n < 100, `settles quickly: ${n}`);
  assert.equal(P.settled(s), true);
  P.pull(s, 1);
  assert.equal(P.settled(s), false);
  const m = P.settle(s);
  assert.ok(m < P.MAX_TICKS, `the flood settles before the cap: ${m}`);
  assert.equal(s.quiet >= P.SETTLE_TICKS, true);
  // a quiet grid stays quiet
  const snap = s.grid.slice();
  ticks(s, 10);
  assert.deepEqual(s.grid, snap);
  // the cap: sincePull reaching MAX_TICKS counts as settled even if cells still move
  const busy = P.buildLevel(level({ fills: [{ type: 'water', x: 17, y: 0, w: 1, h: 1 }] }));
  busy.sincePull = P.MAX_TICKS - 1;
  assert.equal(P.settled(busy), false);
  P.step(busy);
  assert.equal(P.settled(busy), true);
  assert.equal(P.settle(busy), 0);
});

test('every liquid level settles before the cap (no endless wandering)', () => {
  for (const w of [1, 3, 7, 15]) {
    const s = P.buildLevel(level({ fills: [{ type: 'water', x: 10, y: 5, w, h: 2 }, { type: 'lava', x: 30, y: 5, w: 2, h: w }] }));
    P.settle(s);
    assert.ok(s.quiet >= P.SETTLE_TICKS, `width ${w} settled by itself`);
  }
});

test('buildLevel throws on out-of-bounds rectangles', () => {
  const bad = [
    { walls: [{ x: -1, y: 0, w: 2, h: 2 }] },
    { walls: [{ x: 30, y: 0, w: 7, h: 2 }] },
    { walls: [{ x: 0, y: 50, w: 2, h: 5 }] },
    { pins: [{ id: 1, x: 30, y: 10, w: 10, h: 1, handle: 'left' }] },
    { fills: [{ type: 'water', x: 0, y: 53, w: 1, h: 2 }] },
    { hero: { x: 34, y: 0, w: 3, h: 5 } },
    { enemies: [{ x: 0, y: 52, w: 3, h: 5 }] },
    { room: { x: 0, y: 0, w: 37, h: 1 } },
    { exit: { x: 0, y: -2, w: 1, h: 1 } },
  ];
  for (const def of bad) assert.throws(() => P.buildLevel(def), /out of bounds/, JSON.stringify(def));
});

test('buildLevel throws on overlapping rectangles', () => {
  const wall = { x: 5, y: 5, w: 5, h: 5 };
  const bad = [
    { walls: [wall], pins: [{ id: 1, x: 8, y: 8, w: 5, h: 1, handle: 'left' }] },
    { pins: [{ id: 1, x: 2, y: 8, w: 5, h: 1, handle: 'left' }, { id: 2, x: 4, y: 6, w: 1, h: 5, handle: 'top' }] },
    { walls: [wall], fills: [{ type: 'water', x: 9, y: 9, w: 3, h: 3 }] },
    { fills: [{ type: 'water', x: 0, y: 0, w: 3, h: 3 }, { type: 'lava', x: 2, y: 2, w: 3, h: 3 }] },
    { walls: [wall], hero: { x: 9, y: 9, w: 3, h: 5 } },
    { hero: { x: 0, y: 0, w: 3, h: 5 }, enemies: [{ x: 2, y: 4, w: 3, h: 5 }] },
    { fills: [{ type: 'gold', x: 20, y: 20, w: 1, h: 1 }], enemies: [{ x: 19, y: 18, w: 3, h: 5 }] },
  ];
  for (const def of bad) assert.throws(() => P.buildLevel(def), /overlaps/, JSON.stringify(def));
});

test('buildLevel throws on malformed definitions', () => {
  const bad = [
    null,
    { walls: [{ x: 1, y: 1, w: 0, h: 2 }] },
    { walls: [{ x: 1.5, y: 1, w: 1, h: 2 }] },
    { pins: [{ id: 1, x: 1, y: 1, w: 3, h: 1, handle: 'down' }] },
    { pins: [{ id: 'a', x: 1, y: 1, w: 3, h: 1, handle: 'left' }] },
    { pins: [{ id: 1, x: 1, y: 1, w: 3, h: 1, handle: 'left' }, { id: 1, x: 1, y: 3, w: 3, h: 1, handle: 'left' }] },
    { fills: [{ type: 'mud', x: 1, y: 1, w: 3, h: 1 }] },
  ];
  for (const def of bad) assert.throws(() => P.buildLevel(def), undefined, JSON.stringify(def));
});
