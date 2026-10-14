'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../web/pins/core.js');

const { W, H, EMPTY, WATER, LAVA, GOLD } = P;

// A fully closed frame (with a ceiling, so the air at the top doesn't join every chamber).
const frame = () => [
  { x: 0, y: 0, w: W, h: 1 },
  { x: 0, y: H - 1, w: W, h: 1 },
  { x: 0, y: 0, w: 1, h: H },
  { x: W - 1, y: 0, w: 1, h: H },
];

// The hero's room is the bottom-left chamber x 1..16, y 36..52; a wall at x 17 cuts it off from the right.
const HERO = { x: 3, y: 48, w: 3, h: 5 };
const EXIT = { x: 12, y: 48, w: 3, h: 5 };
const ROOM = { x: 1, y: 36, w: 16, h: 17 };
const ROOF = { x: 1, y: 35, w: 16, h: 1 }; // closes the hero's room from above when there is no gold tank

const base = (extra) => ({
  walls: [...frame(), { x: 17, y: 18, w: 1, h: 35 }],
  pins: [], fills: [], hero: HERO, enemies: [], room: ROOM, exit: EXIT, goldTarget: 0,
  ...extra,
});

// A gold tank above the hero's room (112 cells, x 1..16, y 28..34) held by pin `id` at y 35.
const goldTank = (id) => ({
  pin: { id, x: 1, y: 35, w: 16, h: 1, handle: 'left' },
  fill: { type: 'gold', x: 1, y: 28, w: 16, h: 7 },
});

// The right chamber (x 18..34) is open to the air above; the gap in the divider (y 1..17) joins it with the
// space above the gold tank. An enemy stands on the floor under a lava tank (x 26..34, 72 cells) held by pin `id`.
const ENEMY = { x: 28, y: 48, w: 3, h: 5 };
const lavaTank = (id) => ({
  wall: { x: 25, y: 18, w: 1, h: 11 },
  pin: { id, x: 26, y: 28, w: 9, h: 1, handle: 'right' },
  fill: { type: 'lava', x: 26, y: 20, w: 9, h: 8 },
});

// Two pins: L drops lava on the enemy, G drops gold into the hero's room. Only L then G wins:
// G first opens the hero's room to the live enemy.
function orderLevel(goldTarget) {
  const g = goldTank(1), l = lavaTank(2);
  const b = base();
  return base({
    walls: [...b.walls, l.wall],
    pins: [g.pin, l.pin],
    fills: [g.fill, l.fill],
    enemies: [ENEMY],
    goldTarget,
  });
}

function boxCells(r, fn) {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) fn(x, y);
}

function rest(s) {
  let n = 0;
  while (!s.lost && !P.settled(s) && n < 5000) { P.step(s); n++; }
}

test('a hero box is solid: water piles on it and never enters it', () => {
  const s = P.buildLevel(base({ fills: [{ type: 'water', x: 3, y: 30, w: 3, h: 4 }] }));
  rest(s);
  boxCells(HERO, (x, y) => assert.equal(P.cellAt(s, x, y), EMPTY));
  assert.equal(P.count(s, WATER), 12);
  // the water rested on the hero's head or slid off it, but none of it got in
  assert.equal(s.lost, null);
});

test('an enemy burns in lava and its box becomes free', () => {
  const l = lavaTank(1);
  const s = P.buildLevel(base({
    walls: [...base().walls, ROOF, l.wall], pins: [l.pin], fills: [l.fill], enemies: [ENEMY],
  }));
  assert.equal(P.liveEnemies(s), 1);
  assert.equal(s.body[P.idx(ENEMY.x, ENEMY.y)], 2);
  P.pull(s, 1);
  rest(s);
  assert.equal(s.enemies[0].dead, true);
  assert.equal(P.liveEnemies(s), 0);
  boxCells(ENEMY, (x, y) => assert.equal(s.body[P.idx(x, y)], 0));
  // lava flowed into the place where the enemy stood
  let inBox = 0;
  boxCells(ENEMY, (x, y) => { if (P.cellAt(s, x, y) === LAVA) inBox++; });
  assert.ok(inBox > 0, 'lava fills the freed box');
  assert.equal(s.lost, null);
});

test('an enemy dies from 3 touching lava cells, not from 2; diagonal corners do not count', () => {
  const at = (cells) => P.buildLevel(base({
    walls: [...base().walls, ROOF],
    fills: cells.map(([x, y]) => ({ type: 'lava', x, y, w: 1, h: 1 })),
    enemies: [ENEMY],
  }));
  // x 31 is right of the box (x 28..30), x 27 is left of it, (31, 47) is the top-right corner
  assert.equal(at([[31, 52], [31, 51]]).enemies[0].dead, false);
  assert.equal(at([[31, 52], [31, 51], [31, 47]]).enemies[0].dead, false);
  const dead = at([[31, 52], [31, 51], [27, 52]]);
  assert.equal(dead.enemies[0].dead, true);
  assert.equal(dead.body[P.idx(ENEMY.x, ENEMY.y)], 0);
  // the hero's box is free of lava, so nothing is lost
  assert.equal(dead.lost, null);
});

test('opening the way to a live enemy loses at once (enemy)', () => {
  // the divider has a door at the floor held by a vertical pin
  const s = P.buildLevel(base({
    walls: [...frame(), { x: 17, y: 1, w: 1, h: 45 }],
    pins: [{ id: 1, x: 17, y: 46, w: 1, h: 7, handle: 'top' }],
    enemies: [ENEMY],
  }));
  assert.equal(s.lost, null);
  assert.deepEqual(P.status(s), { status: 'playing', reason: null });
  P.pull(s, 1);
  assert.deepEqual(P.status(s), { status: 'lost', reason: 'enemy' });
});

test('water and gold do not stop an enemy, stone does', () => {
  const lvl = base({
    walls: [...frame(), { x: 17, y: 1, w: 1, h: 45 }],
    pins: [{ id: 1, x: 17, y: 46, w: 1, h: 7, handle: 'top' }],
    enemies: [ENEMY],
  });
  // replace the pin in the doorway (x 17, y 46..52) with other cells; the check runs at the end of a tick
  // that changed something
  const doorway = (code) => {
    const s = P.buildLevel(lvl);
    s.pins[0].pulled = true;
    for (let y = 46; y < 53; y++) { s.grid[P.idx(17, y)] = code; s.pinId[P.idx(17, y)] = -1; }
    s.grid[P.idx(20, 20)] = GOLD; // something to move, so the tick counts as a change
    P.step(s);
    return s.lost;
  };
  assert.equal(doorway(WATER), 'enemy');
  assert.equal(doorway(GOLD), 'enemy');
  assert.equal(doorway(P.STONE), null);
});

test('a dead enemy does not reach the hero', () => {
  const l = lavaTank(2);
  // the divider is whole except a hole at y 30 (pin 1), far above where the lava ends up
  const lvl = base({
    walls: [...frame(), { x: 17, y: 1, w: 1, h: 29 }, { x: 17, y: 31, w: 1, h: 22 }, l.wall],
    pins: [{ id: 1, x: 17, y: 30, w: 1, h: 1, handle: 'top' }, l.pin],
    fills: [l.fill],
    enemies: [ENEMY],
  });
  const s = P.buildLevel(lvl);
  P.pull(s, 2);
  rest(s);
  assert.equal(s.enemies[0].dead, true);
  P.pull(s, 1);
  rest(s);
  assert.equal(s.lost, null);
  assert.deepEqual(P.status(s), { status: 'won', reason: null });
  // the other order: the enemy is still alive when the hole opens
  const t = P.buildLevel(lvl);
  P.pull(t, 1);
  assert.deepEqual(P.status(t), { status: 'lost', reason: 'enemy' });
});

test('lava on the hero loses at once (lava)', () => {
  const s = P.buildLevel(base({
    walls: [...base().walls, { x: 1, y: 30, w: 16, h: 1 }],
    pins: [{ id: 1, x: 1, y: 35, w: 16, h: 1, handle: 'left' }],
    fills: [{ type: 'lava', x: 1, y: 31, w: 16, h: 4 }],
  }));
  P.pull(s, 1);
  rest(s);
  assert.deepEqual(P.status(s), { status: 'lost', reason: 'lava' });
  assert.equal(P.stars(s), 0);
});

test('gold in the room wins after the world settles', () => {
  const g = goldTank(1);
  const s = P.buildLevel(base({ pins: [g.pin], fills: [g.fill], goldTarget: 60 }));
  assert.equal(P.goldInRoom(s), 0);
  P.pull(s, 1);
  P.step(s);
  assert.equal(P.status(s).status, 'playing', 'nothing is decided while gold is falling');
  rest(s);
  assert.equal(P.goldInRoom(s), 112);
  assert.deepEqual(P.status(s), { status: 'won', reason: null });
});

test('too little gold with no pins left is a loss (nogold); with a pin left it is still playing', () => {
  const g = goldTank(1);
  const lvl = base({
    pins: [g.pin, { id: 2, x: 20, y: 30, w: 5, h: 1, handle: 'right' }],
    fills: [{ ...g.fill, y: 33, h: 2 }], // 32 cells
    goldTarget: 50,
  });
  const s = P.buildLevel(lvl);
  P.pull(s, 1);
  rest(s);
  assert.equal(P.goldInRoom(s), 32);
  assert.deepEqual(P.status(s), { status: 'playing', reason: null });
  P.pull(s, 2);
  rest(s);
  assert.deepEqual(P.status(s), { status: 'lost', reason: 'nogold' });
  assert.equal(P.stars(s), 0);
});

test('lava between the hero and the exit blocks the win', () => {
  // a pit between two stubs on the way to the exit, lava drops straight into it
  const s = P.buildLevel(base({
    walls: [...base().walls, { x: 7, y: 50, w: 1, h: 3 }, { x: 10, y: 50, w: 1, h: 3 },
      { x: 7, y: 28, w: 1, h: 6 }, { x: 10, y: 28, w: 1, h: 6 }],
    pins: [{ id: 1, x: 8, y: 33, w: 2, h: 1, handle: 'top' }],
    fills: [{ type: 'lava', x: 8, y: 30, w: 2, h: 3 }],
  }));
  P.pull(s, 1);
  rest(s);
  assert.equal(P.count(s, LAVA), 6);
  assert.equal(P.cellAt(s, 8, 52), LAVA);
  assert.deepEqual(P.status(s), { status: 'lost', reason: 'lava' });
});

test('stars: 3 with every enemy dead and 1.5× gold, 2 when one holds, 1 otherwise', () => {
  const play = (lvl, order) => {
    const s = P.buildLevel(lvl);
    rest(s);
    for (const id of order) { P.pull(s, id); rest(s); }
    return s;
  };
  // enemies dead, 112 ≥ 1.5·60
  const three = play(orderLevel(60), [2, 1]);
  assert.equal(P.status(three).status, 'won');
  assert.equal(P.stars(three), 3);
  // enemies dead, 112 < 1.5·80
  const two = play(orderLevel(80), [2, 1]);
  assert.equal(P.status(two).status, 'won');
  assert.equal(P.stars(two), 2);

  // a live enemy walled off in the right chamber
  const g = goldTank(1);
  const walled = (goldTarget) => base({
    walls: [...frame(), { x: 17, y: 1, w: 1, h: 52 }],
    pins: [g.pin], fills: [g.fill], enemies: [ENEMY], goldTarget,
  });
  const richAlive = play(walled(70), [1]);
  assert.equal(P.status(richAlive).status, 'won');
  assert.equal(P.stars(richAlive), 2);
  const one = play(walled(100), [1]);
  assert.equal(P.status(one).status, 'won');
  assert.equal(P.stars(one), 1);
});

test('no enemies count as all dead; stars are 0 while playing', () => {
  const g = goldTank(1);
  const s = P.buildLevel(base({ pins: [g.pin], fills: [g.fill], goldTarget: 100 }));
  assert.equal(P.stars(s), 0);
  P.pull(s, 1);
  rest(s);
  assert.equal(P.stars(s), 2);
});

test('clone keeps entities and the latched loss independent', () => {
  const l = lavaTank(1);
  const s = P.buildLevel(base({
    walls: [...base().walls, ROOF, l.wall], pins: [l.pin], fills: [l.fill], enemies: [ENEMY],
  }));
  const c = P.clone(s);
  P.pull(c, 1);
  rest(c);
  assert.equal(c.enemies[0].dead, true);
  assert.equal(s.enemies[0].dead, false);
  assert.equal(s.body[P.idx(ENEMY.x, ENEMY.y)], 2);
  c.lost = 'lava';
  assert.equal(s.lost, null);
});

test('solve finds the only correct order on a 2-pin level', () => {
  const r = P.solve(orderLevel(60));
  assert.deepEqual(r.wins, [[2, 1]]);
  assert.deepEqual(r.losses, [[1]]);
  assert.equal(r.wonWithoutPull, false);
});

test('solve finds both solutions where there are two', () => {
  // two gold tanks over the room, each with enough gold
  const lvl = base({
    walls: [...base().walls, { x: 8, y: 20, w: 1, h: 16 }],
    pins: [{ id: 1, x: 1, y: 35, w: 7, h: 1, handle: 'left' }, { id: 2, x: 9, y: 35, w: 8, h: 1, handle: 'right' }],
    fills: [{ type: 'gold', x: 1, y: 30, w: 7, h: 5 }, { type: 'gold', x: 9, y: 30, w: 8, h: 5 }],
    goldTarget: 30,
  });
  const r = P.solve(lvl);
  assert.deepEqual(r.wins, [[1], [2]]);
  assert.deepEqual(r.losses, []);
});

test('solve returns no wins for an unsolvable level', () => {
  const lvl = base({
    walls: [...base().walls, { x: 1, y: 30, w: 16, h: 1 }],
    pins: [{ id: 1, x: 1, y: 35, w: 16, h: 1, handle: 'left' }, { id: 2, x: 20, y: 30, w: 5, h: 1, handle: 'right' }],
    fills: [{ type: 'lava', x: 1, y: 31, w: 16, h: 4 }],
    goldTarget: 10,
  });
  const r = P.solve(lvl);
  assert.deepEqual(r.wins, []);
  assert.ok(r.losses.length > 0);
  assert.ok(r.losses.some((o) => o.length === 1 && o[0] === 1), 'pulling the lava pin loses at once');
});

test('solve reports a level won without pulling', () => {
  const r = P.solve(base({ goldTarget: 0, pins: [{ id: 1, x: 20, y: 30, w: 5, h: 1, handle: 'right' }] }));
  assert.equal(r.wonWithoutPull, true);
  assert.deepEqual(r.wins, []);
});

test('solve is deterministic', () => {
  assert.deepEqual(P.solve(orderLevel(60)), P.solve(orderLevel(60)));
});
