'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../web/pins/core.js');
const V = require('../../web/pins/view.js');
const { LEVELS } = require('../../web/pins/levels.js');

// A frame with a horizontal pin (handle on the left), another one on the right and a vertical one (handle on top).
const LEVEL = {
  walls: [{ x: 0, y: 0, w: 36, h: 1 }, { x: 0, y: 53, w: 36, h: 1 }],
  pins: [
    { id: 1, x: 5, y: 20, w: 10, h: 1, handle: 'left' },
    { id: 2, x: 20, y: 20, w: 10, h: 1, handle: 'right' },
    { id: 3, x: 17, y: 30, w: 1, h: 6, handle: 'top' },
  ],
};

test('fitCanvas scales the 2:3 board to fit whole and keeps the aspect', () => {
  const wide = V.fitCanvas({ w: 1000, h: 540, dpr: 1 });
  assert.equal(wide.cssH, 540);
  assert.equal(wide.cssW, 360);
  assert.equal(wide.scale, 1);
  const tall = V.fitCanvas({ w: 360, h: 2000, dpr: 1 });
  assert.equal(tall.cssW, 360);
  assert.equal(tall.cssH, 540);
  const phone = V.fitCanvas({ w: 340, h: 600, dpr: 3 });
  assert.equal(phone.cssW, 340);
  assert.ok(phone.cssH <= 600);
  assert.ok(Math.abs(phone.cssH / phone.cssW - 1.5) < 0.01);
  assert.equal(phone.ratio, V.MAX_DPR, 'the pixel ratio is capped');
  assert.equal(phone.w, 340 * V.MAX_DPR);
  assert.equal(phone.h, Math.round(phone.cssH * V.MAX_DPR));
  const big = V.fitCanvas({ w: 1080, h: 1620, dpr: 1 });
  assert.equal(big.scale, 3);
});

test('fitCanvas survives junk: zero, negative and missing sizes or ratio', () => {
  for (const vp of [{}, { w: 0, h: 0 }, { w: -5, h: NaN, dpr: -1 }, undefined]) {
    const f = V.fitCanvas(vp);
    assert.ok(f.cssW >= 1 && f.cssH >= 1 && f.w >= 1 && f.h >= 1);
    assert.equal(f.ratio, 1);
    assert.ok(Number.isFinite(f.scale) && f.scale > 0);
  }
  assert.equal(V.fitCanvas({ w: 360, h: 540, dpr: 0.5 }).ratio, 1, 'never below 1');
});

test('screenToCell maps CSS px to cells at any scale', () => {
  const f1 = V.fitCanvas({ w: 360, h: 540 });
  assert.deepEqual(V.screenToCell(0, 0, f1), { x: 0, y: 0, fx: 0, fy: 0 });
  const c = V.screenToCell(359, 539, f1);
  assert.equal(c.x, 35);
  assert.equal(c.y, 53);
  const f2 = V.fitCanvas({ w: 720, h: 1080 });
  assert.equal(f2.scale, 2);
  const d = V.screenToCell(25, 45, f2); // logical (12.5, 22.5)
  assert.equal(d.x, 1);
  assert.equal(d.y, 2);
  assert.ok(Math.abs(d.fx - 1.25) < 1e-9 && Math.abs(d.fy - 2.25) < 1e-9);
});

test('pinAt finds a pin by its bar, with a one-cell pad', () => {
  const s = P.buildLevel(LEVEL);
  assert.equal(V.pinAt(s, 9, 20).id, 1);
  assert.equal(V.pinAt(s, 9, 21).id, 1, 'just below the bar');
  assert.equal(V.pinAt(s, 14, 19).id, 1, 'just above the far end');
  assert.equal(V.pinAt(s, 9, 23), null, 'too far from the bar');
  assert.equal(V.pinAt(s, 17, 33).id, 3, 'vertical pin');
  assert.equal(V.pinAt(s, 18, 33).id, 3);
  assert.equal(V.pinAt(s, 20, 33), null);
});

test('pinAt finds a pin by its handle ring, with a wider pad', () => {
  const s = P.buildLevel(LEVEL);
  const h1 = P.handleCell(LEVEL.pins[0]); // (4, 20)
  assert.deepEqual(h1, { x: 4, y: 20 });
  assert.equal(V.pinAt(s, 4, 20).id, 1);
  assert.equal(V.pinAt(s, 2, 18).id, 1, 'two cells off the ring still grabs it');
  assert.equal(V.pinAt(s, 1, 20), null, 'three cells off the ring does not');
  const h2 = P.handleCell(LEVEL.pins[1]); // (30, 20)
  assert.equal(V.pinAt(s, h2.x + 2, h2.y + 2).id, 2);
  const h3 = P.handleCell(LEVEL.pins[2]); // (17, 29)
  assert.equal(V.pinAt(s, h3.x, h3.y - 2).id, 3);
});

test('pinAt prefers the closest pin and skips pulled ones', () => {
  const s = P.buildLevel({
    pins: [
      { id: 1, x: 5, y: 20, w: 10, h: 1, handle: 'left' },
      { id: 2, x: 5, y: 22, w: 10, h: 1, handle: 'left' },
    ],
  });
  assert.equal(V.pinAt(s, 8, 20).id, 1);
  assert.equal(V.pinAt(s, 8, 22).id, 2);
  assert.equal(V.pinAt(s, 8, 21).id, 1, 'a tie between the bars goes to the first');
  P.pull(s, 1);
  assert.equal(V.pinAt(s, 8, 20), null, 'a pulled pin is gone');
  assert.equal(V.pinAt(s, 8, 21).id, 2, 'the other one is still in reach');
});

test('every pin of every level can be grabbed by its handle cell', () => {
  LEVELS.forEach((def, i) => {
    const s = P.buildLevel(def);
    for (const p of s.pins) {
      const h = P.handleCell(p);
      assert.equal(V.pinAt(s, h.x, h.y).id, p.id, `level ${i + 1} pin ${p.id}`);
    }
  });
});

test('pullDir points towards the handle', () => {
  assert.deepEqual(V.pullDir({ handle: 'left' }), { dx: -1, dy: 0 });
  assert.deepEqual(V.pullDir({ handle: 'right' }), { dx: 1, dy: 0 });
  assert.deepEqual(V.pullDir({ handle: 'top' }), { dx: 0, dy: -1 });
});

test('a drag pulls once it moves the handle at least 2 cells outwards', () => {
  const s = P.buildLevel(LEVEL);
  const d = V.dragStart(s, 4.5, 20.5);
  assert.equal(d.id, 1);
  assert.equal(V.dragMove(d, 3.5, 20.5), 1);
  assert.equal(V.dragEnd(d, 3.0, 20.6), false, '1.5 cells is not enough');
  const e = V.dragStart(s, 4.5, 20.5);
  assert.equal(V.dragEnd(e, 2.5, 21.0), true, 'exactly 2 cells outwards');
  const r = V.dragStart(s, 30.5, 20.5);
  assert.equal(r.id, 2);
  assert.equal(V.dragEnd(r, 33, 20.5), true, 'a right-handled pin pulls to the right');
  const v = V.dragStart(s, 17.5, 29.5);
  assert.equal(v.id, 3);
  assert.equal(V.dragEnd(v, 17.6, 27.2), true, 'a top-handled pin pulls upwards');
});

test('a drag inwards or across the pin does not pull; a tap does', () => {
  const s = P.buildLevel(LEVEL);
  const inward = V.dragStart(s, 4.5, 20.5);
  assert.equal(V.dragMove(inward, 8.5, 20.5), 0, 'inwards never counts');
  assert.equal(V.dragEnd(inward, 8.5, 20.5), false);
  const across = V.dragStart(s, 9.5, 20.5);
  assert.equal(V.dragEnd(across, 9.5, 24.5), false, 'across the axis');
  const back = V.dragStart(s, 4.5, 20.5);
  V.dragMove(back, 4.5, 23);
  assert.equal(V.dragEnd(back, 4.6, 20.5), false, 'wandered off and came back: not a tap');
  const tap = V.dragStart(s, 9.5, 20.5);
  assert.equal(V.dragEnd(tap, 9.8, 20.7), true, 'a tap on the bar pulls');
  assert.equal(V.dragStart(s, 20, 45), null, 'nothing to grab');
});

test('fixedSteps runs 60 ticks a second and keeps the remainder', () => {
  let r = V.fixedSteps(0, 1 / 60);
  assert.equal(r.n, 1);
  assert.ok(r.acc < 1e-9);
  r = V.fixedSteps(0, 0.025); // 1.5 ticks
  assert.equal(r.n, 1);
  assert.ok(Math.abs(r.acc - 0.5) < 1e-9);
  r = V.fixedSteps(r.acc, 0.025);
  assert.equal(r.n, 2);
  let total = 0, acc = 0;
  for (let i = 0; i < 120; i++) { const x = V.fixedSteps(acc, 1 / 120); total += x.n; acc = x.acc; }
  assert.equal(total, 60, 'one second at 120 fps is 60 ticks');
});

test('fixedSteps drops a backlog and ignores junk dt', () => {
  const r = V.fixedSteps(0, 5);
  assert.equal(r.n, V.MAX_TICKS_PER_FRAME);
  assert.equal(r.acc, 0);
  for (const dt of [0, -1, NaN, Infinity, undefined]) {
    const x = V.fixedSteps(0.25, dt);
    assert.equal(x.n, 0);
    assert.equal(x.acc, 0.25);
  }
  assert.equal(V.fixedSteps(NaN, 1 / 60).n, 1);
});

test('walkPos moves the hero along the floor to the door, both ways', () => {
  const hero = { x: 3, y: 48, w: 3, h: 5 }, exit = { x: 21, y: 48, w: 3, h: 5 };
  assert.deepEqual(V.walkPos(hero, exit, 0), { x: 3, y: 48, face: 1, done: false });
  const mid = V.walkPos(hero, exit, 1);
  assert.equal(mid.x, 3 + V.WALK_SPEED);
  assert.equal(mid.done, false);
  const end = V.walkPos(hero, exit, V.walkTime(hero, exit));
  assert.equal(end.x, 21);
  assert.equal(end.done, true);
  assert.equal(V.walkPos(hero, exit, 100).x, 21, 'stops at the door');
  const back = V.walkPos({ x: 30, y: 48 }, { x: 3, y: 48 }, 1);
  assert.equal(back.face, -1);
  assert.equal(back.x, 30 - V.WALK_SPEED);
  assert.equal(V.walkPos(hero, exit, -1).x, 3);
});

test('hash2 is stable and in [0, 1)', () => {
  for (let i = 0; i < 200; i++) {
    const v = V.hash2(i, i * 7, 3);
    assert.ok(v >= 0 && v < 1);
    assert.equal(v, V.hash2(i, i * 7, 3));
  }
  assert.notEqual(V.hash2(1, 2, 0), V.hash2(2, 1, 0));
});
