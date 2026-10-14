'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../web/parking/core.js');
const V = require('../../web/parking/view.js');
const { LEVELS } = require('../../web/parking/levels.js');

// X in the middle row; A (vertical) blocks it; B (horizontal) on the top row; a bollard and a barrier below.
const BOARD = {
  rows: [
    '.BB...',
    '......',
    'XX.A..',
    '...A..',
    '.#.|..',
    '...CC.',
  ],
};

const game = (def = BOARD) => P.newGame(def);

test('fitBoard fits the whole lot with the exit road and keeps cells square', () => {
  const L = P.parseLevel(BOARD);
  const W = V.worldSize(L);
  assert.equal(W.w, V.PAD + 6 + V.PAD + V.ROAD);
  assert.equal(W.h, V.PAD + 6 + V.PAD);
  const phone = V.fitBoard({ w: 348, h: 520, dpr: 3 }, L);
  assert.ok(phone.cssW <= 348 && phone.cssH <= 520);
  assert.equal(phone.cell, Math.floor(348 / W.w));
  assert.equal(phone.ratio, V.MAX_DPR, 'the pixel ratio is capped');
  assert.equal(phone.w, Math.round(phone.cssW * V.MAX_DPR));
  assert.equal(phone.ox, V.PAD * phone.cell);
  const desk = V.fitBoard({ w: 4000, h: 4000, dpr: 1 }, L);
  assert.equal(desk.cell, V.MAX_CELL, 'cells stop growing on a big screen');
  const junk = V.fitBoard({ w: NaN, h: -5, dpr: 'x' }, L);
  assert.ok(junk.cell >= 4 && junk.ratio === 1);
  const big = V.fitBoard({ w: 348, h: 520, dpr: 1 }, P.parseLevel(LEVELS[39]));
  assert.ok(big.cell < phone.cell, 'a 7×7 lot gets smaller cells');
  assert.equal(big.cols, 7);
});

test('cellAt maps points to grid cells and flags the outside', () => {
  const lay = V.fitBoard({ w: 600, h: 600, dpr: 1 }, P.parseLevel(BOARD));
  const at = (cx, cy) => V.cellAt(lay, lay.ox + cx * lay.cell, lay.oy + cy * lay.cell);
  assert.deepEqual([at(0.5, 0.5).x, at(0.5, 0.5).y, at(0.5, 0.5).inside], [0, 0, true]);
  assert.deepEqual([at(5.9, 2.2).x, at(5.9, 2.2).y], [5, 2]);
  assert.ok(Math.abs(at(3.25, 1.75).fx - 3.25) < 1e-9);
  assert.equal(at(-0.2, 1).inside, false, 'the curb is not a cell');
  assert.equal(at(6.5, 2.5).inside, false, 'the exit road is not a cell');
  assert.equal(at(2, 6.1).inside, false);
});

test('vehicleAt finds the vehicle on a cell, nothing on empty cells, bollards or outside', () => {
  const s = game();
  assert.equal(V.vehicleAt(s, 0, 2), 'X');
  assert.equal(V.vehicleAt(s, 1, 2), 'X');
  assert.equal(V.vehicleAt(s, 3, 2), 'A');
  assert.equal(V.vehicleAt(s, 3, 3), 'A');
  assert.equal(V.vehicleAt(s, 2, 0), 'B');
  assert.equal(V.vehicleAt(s, 2, 2), null);
  assert.equal(V.vehicleAt(s, 1, 4), null, 'a bollard is not a vehicle');
  assert.equal(V.vehicleAt(s, 3, 4), null, 'nor is a barrier');
  assert.equal(V.vehicleAt(s, -1, 2), null);
  assert.equal(V.vehicleAt(s, 6, 2), null);
  assert.equal(V.vehicleAt(null, 0, 0), null);
  // The player's car that left is not hit-tested.
  s.vehicles.find((v) => v.id === 'X').x = 6;
  assert.equal(V.vehicleAt(s, 0, 2), null);
});

test('dragTarget follows the pointer along the axis only', () => {
  const s = game();
  assert.equal(V.dragTarget(s, 'B', { dx: 1.4, dy: 3 }), 1.4, 'only the axis part counts');
  assert.equal(V.dragTarget(s, 'B', { dx: -0.6, dy: 0 }), -0.6);
  assert.equal(V.dragTarget(s, 'A', { dx: 5, dy: -1.5 }), -1.5);
  assert.equal(V.dragTarget(s, 'A', -0.7), -0.7, 'a plain number is the axis offset');
  assert.equal(V.dragTarget(s, 'A', { dx: NaN, dy: NaN }), 0);
  assert.equal(V.dragTarget(s, 'Q', { dx: 1, dy: 1 }), 0, 'unknown vehicle');
  assert.equal(V.along(s.vehicles[0], null), 0);
});

test('dragTarget stops at an obstacle: a vehicle, a bollard', () => {
  const s = game();
  assert.equal(V.dragTarget(s, 'X', { dx: 4, dy: 0 }), 1, 'X stops against A');
  assert.equal(V.dragTarget(s, 'A', { dx: 0, dy: -9 }), -2, 'A stops at the top wall');
  const b = game({ rows: ['......', '......', 'XX....', '.#....', '.A....', '.A....'] });
  assert.equal(V.dragTarget(b, 'A', { dx: 0, dy: -3 }), 0, 'A sits right under a bollard');
  assert.equal(V.dragTarget(b, 'A', { dx: 0, dy: 2 }), 0, 'and on the bottom wall');
});

test('dragTarget stops at the edge and lets the player out through the exit', () => {
  const s = game();
  assert.equal(V.dragTarget(s, 'B', { dx: 9, dy: 0 }), 3, 'B stops at the right wall');
  assert.equal(V.dragTarget(s, 'B', { dx: -9, dy: 0 }), -1, 'and the left wall');
  assert.equal(V.dragTarget(s, 'X', { dx: -2, dy: 0 }), 0, 'X stands at the left wall');
  const free = game({ rows: ['......', '......', 'XX....', '......', '......', '...AA.'] });
  assert.equal(V.dragTarget(free, 'X', { dx: 3, dy: 0 }), 3, 'past the free road');
  assert.equal(V.dragTarget(free, 'X', { dx: 99, dy: 0 }), 6, 'up to leaving the lot entirely');
  assert.equal(P.moveRange(free, 'X').max, 4);
  assert.equal(V.dropDelta(free, 'X', 4.6), 6, 'half a cell past the free road is the exit move');
  assert.equal(V.dropDelta(free, 'X', 4.6) > P.moveRange(free, 'X').max, true);
  assert.equal(V.dropDelta(free, 'X', 4.4), 4, 'less than that stays at the edge');
  assert.equal(V.dropDelta(free, 'X', 3.6), 4);
  assert.ok(P.move(free, 'X', V.dropDelta(free, 'X', 5)));
  assert.equal(free.status, 'won');
});

test('dragTarget stops at a closed barrier and passes an open one', () => {
  const s = game({ rows: ['BB....', '......', 'XX....', '...|..', '...A..', '...A..'] });
  assert.equal(P.gateOpen(s), false, 'closed for the first move');
  assert.equal(V.dragTarget(s, 'A', { dx: 0, dy: -4 }), 0, 'the barrier holds A');
  assert.ok(V.overPush(s, 'A', { dx: 0, dy: -4 }) > 3.9, 'pushing into it shows as a bump');
  assert.ok(P.move(s, 'B', 1));
  assert.equal(P.gateOpen(s), true);
  assert.equal(V.dragTarget(s, 'A', { dx: 0, dy: -4 }), -4, 'open on the even move: A drives through');
  assert.equal(V.dropDelta(s, 'A', -3.6), -4);
});

test('a tow truck drags by one cell at most', () => {
  const s = game({ rows: ['......', '..T...', 'XXT...', '......', '......', '......'], vehicles: { T: 'tow' } });
  assert.equal(V.dragTarget(s, 'T', { dx: 0, dy: 3 }), 1);
  assert.equal(V.dragTarget(s, 'T', { dx: 0, dy: -3 }), -1);
  assert.equal(V.dropDelta(s, 'T', 2.9), 1);
});

test('dropDelta snaps to the nearest allowed cell', () => {
  const s = game();
  assert.equal(V.dropDelta(s, 'B', 0.4), 0);
  assert.equal(V.dropDelta(s, 'B', 0.6), 1);
  assert.equal(V.dropDelta(s, 'B', 2.5), 3);
  assert.equal(V.dropDelta(s, 'B', -0.7), -1);
  assert.equal(V.dropDelta(s, 'B', 99), 3, 'clamped to the reach');
  assert.equal(V.dropDelta(s, 'B', NaN), 0);
  assert.equal(V.dropDelta(s, 'Q', 1), 0);
  assert.equal(V.dropDelta(s, 'X', 1.4), 1, 'X is blocked by A: no exit');
});

test('overPush and give measure pushing past a stop', () => {
  const s = game();
  assert.equal(V.overPush(s, 'B', { dx: 1, dy: 0 }), 0);
  assert.equal(V.overPush(s, 'B', { dx: 4, dy: 0 }), 1);
  assert.equal(V.overPush(s, 'Q', { dx: 4, dy: 0 }), 0);
  assert.equal(V.give(0), 0);
  assert.ok(V.give(0.3) > 0 && V.give(0.3) < V.give(2));
  assert.ok(V.give(100) <= V.OVERDRAG);
});

test('cycle picks vehicles in reading order, X first, and wraps', () => {
  const s = game();
  assert.equal(V.cycle(s, null), 'X');
  assert.equal(V.cycle(s, 'B'), 'X', 'B (row 0), then X (row 2, col 0)');
  assert.equal(V.cycle(s, 'X'), 'A');
  assert.equal(V.cycle(s, 'A'), 'C');
  assert.equal(V.cycle(s, 'C'), 'B', 'wraps around');
  assert.equal(V.cycle(s, 'B', -1), 'C');
  s.vehicles.find((v) => v.id === 'X').x = 6;
  assert.equal(V.cycle(s, 'B'), 'A', 'the car that left is skipped');
});

test('neighbor picks the nearest vehicle in a direction', () => {
  const s = game();
  assert.equal(V.neighbor(s, 'X', 1, 0), 'A');
  assert.equal(V.neighbor(s, 'X', 0, -1), 'B');
  assert.equal(V.neighbor(s, 'A', 0, 1), 'C');
  assert.equal(V.neighbor(s, 'X', -1, 0), null, 'nothing to the left');
  assert.equal(V.neighbor(s, 'Q', 1, 0), null);
});

test('approach eases towards the target and settles exactly', () => {
  assert.equal(V.approach(NaN, 3, 0.016), 3);
  const a = V.approach(0, 1, 0.016);
  assert.ok(a > 0 && a < 1);
  let v = 0;
  for (let i = 0; i < 120; i++) v = V.approach(v, 1, 1 / 60);
  assert.equal(v, 1);
  assert.equal(V.approach(0.5, 1, -1), 0.5, 'no time, no change');
  assert.equal(V.easeInQuad(0.5), 0.25);
  assert.equal(V.easeInQuad(2), 1);
  assert.ok(Math.abs(V.easeOutBack(1) - 1) < 1e-9);
  assert.ok(Math.abs(V.easeOutBack(0)) < 1e-9);
  assert.equal(V.clamp(5, 0, 3), 3);
});

test('hash2 is stable and in [0, 1)', () => {
  assert.equal(V.hash2(3, 4, 5), V.hash2(3, 4, 5));
  assert.notEqual(V.hash2(3, 4, 5), V.hash2(4, 3, 5));
  for (let i = 0; i < 200; i++) {
    const h = V.hash2(i, i * 7, i % 3);
    assert.ok(h >= 0 && h < 1);
  }
});

test('every level: dragging along the solution path wins with 3 stars', () => {
  for (const [i, def] of LEVELS.entries()) {
    if (i % 4) continue; // a sample keeps this fast; levels.test.js replays every solution through core
    const s = P.newGame(def);
    const sol = P.solve(s);
    for (const [id, delta] of sol.path) {
      const shift = V.dragTarget(s, id, delta + (delta > 0 ? 0.2 : -0.2));
      assert.ok(P.move(s, id, V.dropDelta(s, id, shift)), `level ${i + 1}: ${id} ${delta}`);
    }
    assert.equal(s.status, 'won', `level ${i + 1}`);
    assert.equal(P.stars(s.moves, s.optimal), 3);
  }
});
