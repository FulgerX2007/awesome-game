'use strict';
// Gas, powder kegs and the hint planner.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../web/pins/core.js');
const { LEVELS } = require('../../web/pins/levels.js');

const { W, H, EMPTY, WALL, WATER, LAVA, STONE, GOLD, GAS, BOMB } = P;

// A closed box: floor, ceiling and side walls. Inside is x 1..34, y 1..52.
const box = () => [
  { x: 0, y: 0, w: W, h: 1 },
  { x: 0, y: H - 1, w: W, h: 1 },
  { x: 0, y: 0, w: 1, h: H },
  { x: W - 1, y: 0, w: 1, h: H },
];
const level = (extra) => ({ walls: box(), pins: [], fills: [], ...extra });
const ticks = (s, n) => { for (let k = 0; k < n; k++) P.step(s); };

test('gas rises to the ceiling and spreads under it', () => {
  const s = P.buildLevel(level({ fills: [{ type: 'gas', x: 10, y: 40, w: 3, h: 2 }] }));
  P.settle(s);
  assert.ok(s.quiet >= P.SETTLE_TICKS, 'gas settles by itself');
  assert.equal(P.count(s, GAS), 6);
  for (let x = 1; x < W - 1; x++) {
    for (let y = 2; y < H - 1; y++) assert.notEqual(P.cellAt(s, x, y), GAS, `gas below the ceiling at ${x},${y}`);
  }
});

test('gas bubbles up through water, and the water ends up below it', () => {
  const s = P.buildLevel(level({
    walls: [...box(), { x: 1, y: 30, w: 4, h: 1 }, { x: 9, y: 30, w: 26, h: 1 }],
    fills: [{ type: 'gas', x: 5, y: 26, w: 4, h: 4 }, { type: 'water', x: 5, y: 20, w: 4, h: 6 }],
  }));
  // The gas sits under the water in a pocket open at the top: it has to swap its way up.
  P.settle(s);
  assert.equal(P.count(s, GAS), 16);
  assert.equal(P.count(s, WATER), 24);
  let lowestGas = 0, highestWater = H;
  for (let i = 0; i < W * H; i++) {
    const y = Math.floor(i / W);
    if (s.grid[i] === GAS) lowestGas = Math.max(lowestGas, y);
    if (s.grid[i] === WATER) highestWater = Math.min(highestWater, y);
  }
  assert.ok(lowestGas < highestWater, `gas (down to ${lowestGas}) above water (from ${highestWater})`);
});

test('gold falls through gas; lava burns the gas it touches', () => {
  const s = P.buildLevel(level({
    fills: [{ type: 'gold', x: 5, y: 1, w: 2, h: 2 }, { type: 'gas', x: 5, y: 3, w: 2, h: 3 }],
  }));
  P.settle(s);
  assert.equal(P.count(s, GOLD), 4);
  assert.equal(P.cellAt(s, 5, 52), GOLD);
  const t = P.buildLevel(level({
    fills: [{ type: 'lava', x: 5, y: 48, w: 4, h: 5 }, { type: 'gas', x: 5, y: 40, w: 4, h: 8 }],
  }));
  P.settle(t);
  assert.equal(P.count(t, LAVA), 20);
  assert.ok(P.count(t, GAS) < 32, 'some gas burnt');
});

test('gas kills an enemy (3 touching cells) and the hero (any touch)', () => {
  const enemy = { x: 10, y: 48, w: 3, h: 5 };
  const s = P.buildLevel(level({ enemies: [enemy], fills: [{ type: 'gas', x: 13, y: 50, w: 1, h: 2 }] }));
  P.step(s);
  assert.equal(s.enemies[0].dead, false, '2 cells are not enough');
  const t = P.buildLevel(level({ enemies: [enemy], fills: [{ type: 'gas', x: 13, y: 49, w: 1, h: 4 }] }));
  P.step(t);
  assert.equal(t.enemies[0].dead, true);
  assert.equal(t.enemies[0].cause, 'gas');
  const h = P.buildLevel(level({ hero: enemy, fills: [{ type: 'gas', x: 13, y: 52, w: 1, h: 1 }] }));
  assert.equal(h.lost, 'gas');
  assert.deepEqual(P.status(h), { status: 'lost', reason: 'gas' });
});

test('gas between the hero and the exit blocks the win', () => {
  const room = { x: 1, y: 40, w: 30, h: 13 };
  const def = level({
    walls: [...box(), { x: 1, y: 39, w: 34, h: 1 }, { x: 15, y: 40, w: 1, h: 10 }],
    hero: { x: 2, y: 48, w: 3, h: 5 }, exit: { x: 26, y: 48, w: 3, h: 5 }, room,
    fills: [{ type: 'gas', x: 16, y: 50, w: 2, h: 1 }],
  });
  const s = P.buildLevel(def);
  P.settle(s); // the gas rises into the corner under the divider... and away from the hero's rows
  const blocked = P.buildLevel({ ...def, walls: [...def.walls, { x: 16, y: 40, w: 19, h: 9 }] });
  P.settle(blocked); // ...unless a low ceiling keeps it on the hero's way
  assert.deepEqual(P.status(s), { status: 'won', reason: null });
  assert.deepEqual(P.status(blocked), { status: 'lost', reason: 'gas' });
});

test('a keg is solid and stays put; lava sets it off and the blast wipes everything within reach', () => {
  const s = P.buildLevel(level({
    walls: [...box(), { x: 8, y: 30, w: 20, h: 3 }],
    fills: [{ type: 'bomb', x: 16, y: 28, w: 2, h: 2 }, { type: 'water', x: 16, y: 20, w: 2, h: 2 }],
  }));
  P.settle(s);
  assert.equal(P.count(s, BOMB), 4, 'water does not set a keg off');
  assert.equal(P.cellAt(s, 16, 28), BOMB, 'the keg did not move');
  const t = P.buildLevel(level({
    walls: [...box(), { x: 8, y: 30, w: 20, h: 3 }],
    fills: [{ type: 'bomb', x: 16, y: 28, w: 2, h: 2 }, { type: 'lava', x: 16, y: 25, w: 2, h: 1 }],
    pins: [],
  }));
  const rock = t.rock;
  ticks(t, 6);
  assert.equal(P.count(t, BOMB), 0);
  assert.equal(P.cellAt(t, 16, 32), EMPTY, 'the blast broke the rock under the keg');
  assert.equal(P.cellAt(t, 8, 30), WALL, 'out of reach stays');
  assert.equal(P.cellAt(t, 22, 31), WALL, 'out of reach stays');
  assert.ok(t.rock > rock, 'rock changes are counted');
  assert.ok(t.blasts.length >= 4, 'every keg cell reports its blast');
});

test('kegs go off in a chain, pins and the frame survive a blast', () => {
  const s = P.buildLevel(level({
    pins: [{ id: 1, x: 2, y: 30, w: 6, h: 1, handle: 'right' }],
    fills: [
      { type: 'bomb', x: 3, y: 32, w: 1, h: 1 }, { type: 'bomb', x: 7, y: 32, w: 1, h: 1 },
      { type: 'bomb', x: 11, y: 32, w: 1, h: 1 }, { type: 'bomb', x: 20, y: 32, w: 1, h: 1 },
      { type: 'lava', x: 11, y: 33, w: 1, h: 1 },
    ],
  }));
  ticks(s, 2);
  assert.equal(P.cellAt(s, 3, 32), EMPTY, 'the chain reached the last keg in range');
  assert.equal(P.cellAt(s, 20, 32), BOMB, 'a keg out of range stays');
  assert.equal(P.cellAt(s, 0, 32), WALL, 'the frame holds');
  assert.equal(P.cellAt(s, 4, 30), P.PIN, 'the pin holds');
});

test('a blast kills enemies and the hero it reaches', () => {
  const enemy = { x: 20, y: 48, w: 3, h: 5 };
  const hero = { x: 2, y: 48, w: 3, h: 5 };
  const s = P.buildLevel(level({
    walls: [...box(), { x: 12, y: 1, w: 1, h: 52 }], // keeps the enemy away from the hero
    hero, enemies: [enemy],
    fills: [{ type: 'bomb', x: 24, y: 51, w: 2, h: 2 }, { type: 'lava', x: 26, y: 52, w: 1, h: 1 }],
  }));
  P.step(s);
  assert.equal(s.enemies[0].dead, true);
  assert.equal(s.enemies[0].cause, 'blast');
  assert.equal(s.lost, null);
  const t = P.buildLevel(level({
    hero, fills: [{ type: 'bomb', x: 7, y: 51, w: 2, h: 2 }, { type: 'lava', x: 9, y: 52, w: 1, h: 1 }],
  }));
  P.step(t);
  assert.equal(t.lost, 'blast');
  assert.deepEqual(P.status(t), { status: 'lost', reason: 'blast' });
});

test('clone keeps the blast log and the rock counter independent', () => {
  const s = P.buildLevel(level({
    walls: [...box(), { x: 1, y: 48, w: 3, h: 1 }],
    fills: [{ type: 'bomb', x: 5, y: 51, w: 1, h: 1 }, { type: 'lava', x: 6, y: 51, w: 1, h: 1 }],
  }));
  const c = P.clone(s);
  P.step(s);
  assert.ok(s.blasts.length > 0 && s.rock > 0);
  assert.equal(c.blasts.length, 0);
  assert.equal(c.rock, 0);
});

test('bestPlan finds a 3-star way from the start of every level', () => {
  LEVELS.forEach((def, i) => {
    const plan = P.bestPlan(P.buildLevel(def));
    assert.ok(plan && plan.stars === 3 && plan.order.length > 0, `level ${i + 1}`);
  });
});

test('bestPlan continues from the current state and gives up on a lost cause', () => {
  // Level 4: lava (1) must burn the enemy before the gold (2) opens the way.
  const s = P.buildLevel(LEVELS[3]);
  P.pull(s, 1);
  assert.deepEqual(P.bestPlan(s), { order: [2], stars: 3 });
  const lost = P.buildLevel(LEVELS[3]);
  P.pull(lost, 2);
  assert.equal(P.bestPlan(lost), null);
  // An already winning world needs no more pulls.
  P.settle(s);
  P.pull(s, 2);
  assert.deepEqual(P.bestPlan(s), { order: [], stars: 3 });
  // The planner works on a copy.
  assert.equal(s.pins.filter((p) => p.pulled).length, 2);
});

test('fill types include gas and kegs; kegs never move', () => {
  assert.equal(P.FILL_TYPES.gas, GAS);
  assert.equal(P.FILL_TYPES.bomb, BOMB);
  const s = P.buildLevel(level({ fills: [{ type: 'bomb', x: 10, y: 5, w: 2, h: 2 }] }));
  P.settle(s);
  assert.equal(P.cellAt(s, 10, 5), BOMB);
  assert.notEqual(STONE, BOMB);
});
