'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/castle/core.js');
const V = require('../../web/castle/view.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≈ ${b}`);

test('fit keeps the whole field visible at phone and desktop sizes', () => {
  for (const vp of [{ w: 360, h: 640 }, { w: 640, h: 360 }, { w: 1280, h: 800 }]) {
    const f = V.fit(vp);
    const left = V.toScreen(f, V.X0, 0), right = V.toScreen(f, V.X1, 0);
    assert.ok(left.x >= -0.5 && right.x <= f.cssW + 0.5, `${vp.w}×${vp.h}: x ${left.x}…${right.x}`);
    const sky = V.toScreen(f, 0, V.SKY), under = V.toScreen(f, 0, -V.UNDER);
    assert.ok(sky.y >= -0.5, `${vp.w}×${vp.h}: sky at ${sky.y}`);
    assert.ok(under.y <= f.cssH + 0.5);
    // the spawn point and the archer are on screen
    const s = V.toScreen(f, C.SPAWN_X, 1), a = V.toScreen(f, C.ARCHER.x, C.ARCHER.y);
    for (const p of [s, a]) assert.ok(p.x >= 0 && p.x <= f.cssW && p.y >= 0 && p.y <= f.cssH);
  }
});

test('a taller screen gets more sky up to a cap, not a smaller field', () => {
  const tall = V.fit({ w: 360, h: 640 }), short = V.fit({ w: 360, h: 120 });
  assert.equal(tall.scale, 360 / (V.X1 - V.X0));
  assert.ok(tall.gy > short.gy);
  assert.equal(tall.cssH, Math.floor(360 * V.MAX_ASPECT), 'a portrait phone gets a band, not a tower of sky');
  assert.equal(V.fit({ w: 360, h: 640, dpr: 3 }).w, 1080);
  assert.equal(V.fit({ w: 10, h: 10, dpr: 9 }).dpr, 3);
  assert.ok(V.fit({}).scale > 0, 'a missing viewport falls back to defaults');
});

test('toScreen and toWorld are inverses', () => {
  const f = V.fit({ w: 800, h: 450 });
  for (const [x, y] of [[0, 0], [30, 5], [-1, 12], [61, -1]]) {
    const p = V.toScreen(f, x, y);
    const w = V.toWorld(f, p.x, p.y);
    near(w.x, x, 1e-9);
    near(w.y, y, 1e-9);
  }
});

test('aimFromDrag: pull back to shoot forward, power from the pull length, clamped', () => {
  const up = V.aimFromDrag(-100, 100); // pull left and down → shoot right and up at 45°
  near(up.angle, Math.PI / 4, 1e-9);
  near(up.power, 100 * Math.SQRT2 / V.FULL_DRAG, 1e-9);
  const down = V.aimFromDrag(-50, -50); // pull left and up → shoot right and down
  near(down.angle, -Math.PI / 4, 1e-9);
  assert.equal(V.aimFromDrag(-1000, 0).power, 1, 'full power at most');
  near(V.aimFromDrag(-10, 0).power, C.MIN_POWER, 1e-9, 'at least the minimum');
  assert.equal(V.aimFromDrag(3, 4), null, 'a tiny pull keeps the old aim');
  assert.equal(V.aimFromDrag(NaN, 0), null);
  // pulling forward can't shoot backwards
  assert.equal(V.aimFromDrag(100, 100).angle, C.ANGLE_MAX);
  assert.equal(V.aimFromDrag(100, -100).angle, C.ANGLE_MIN);
  assert.equal(V.aimFromDrag(0, -300).angle, C.ANGLE_MIN, 'straight down is clamped');
});

test('trajectory follows CastleCore.flight and stops at the ground', () => {
  const run = C.newRun();
  const pts = V.trajectory(run, 0.5, 0.8, 0.05);
  assert.ok(pts.length > 5);
  pts.forEach((p, k) => {
    const q = C.flight(run, 0.5, 0.8, (k + 1) * 0.05);
    near(p.x, q.x, 1e-9);
    near(p.y, q.y, 1e-9);
  });
  assert.ok(pts.every((p) => p.y >= 0));
  const next = C.flight(run, 0.5, 0.8, (pts.length + 1) * 0.05);
  assert.ok(next.y < 0 || next.x > V.X1, 'the preview ends where the arrow leaves the field');
  assert.equal(V.trajectory(run, 0.5, 0.8, 0.05, 3).length, 3, 'capped');
});

test('number formatting groups thousands', () => {
  assert.equal(V.fmt(0), '0');
  assert.equal(V.fmt(999), '999');
  assert.equal(V.fmt(1234), '1 234');
  assert.equal(V.fmt(1234567.4), '1 234 567');
  assert.equal(V.clamp(5, 0, 2), 2);
});
