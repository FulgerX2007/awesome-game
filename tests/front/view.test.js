'use strict';
// Рубеж: the pure client helpers in view.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../web/front/core.js');
const V = require('../../web/front/view.js');
const { LEVELS } = require('../../web/front/levels.js');

test('the camera clamps at both ends of the line and centres a short one', () => {
  for (const vp of [{ w: 320, h: 220 }, { w: 360, h: 250 }, { w: 1280, h: 700 }]) {
    const cam = V.camera(vp, 200, -50);
    assert.equal(cam.x0, 0);
    const far = V.camera(vp, 200, 9999);
    assert.ok(Math.abs(far.x0 + far.span - 200) < 1e-9);
    assert.ok(cam.ground > vp.h / 2 && cam.ground < vp.h);
    assert.ok(cam.scale >= 5 && cam.scale <= 26);
  }
  const short = V.camera({ w: 1280, h: 300 }, 40, 10);
  assert.ok(short.span >= 40 && short.x0 < 0, 'a line shorter than the view is centred');
});

test('panning moves the view against the drag and stays clamped; centerOn centres a point', () => {
  const cam = V.camera({ w: 360, h: 250 }, 200, 50);
  const right = V.pan(cam, -100);
  assert.ok(right.x0 > cam.x0);
  assert.ok(Math.abs(right.x0 - cam.x0 - 100 / cam.scale) < 1e-9);
  assert.equal(V.pan(cam, 1e6).x0, 0);
  const c = V.centerOn(cam, 120);
  assert.ok(Math.abs(c.x0 + c.span / 2 - 120) < 1e-9);
});

test('toScreen and toWorld round-trip', () => {
  const cam = V.camera({ w: 640, h: 360 }, 200, 37);
  for (const x of [37, 50, 80.5]) {
    const p = V.toScreen(cam, x, 0);
    assert.ok(Math.abs(V.toWorld(cam, p.x) - x) < 1e-9);
    assert.equal(p.y, cam.ground);
  }
  assert.ok(V.toScreen(cam, 50, 2).y < cam.ground);
});

test('plotAt finds plots near the ground and open chasms, and nothing up in the sky', () => {
  const g = F.newGame(LEVELS[1], 1);
  const cam = V.camera({ w: 360, h: 250 }, g.L, 0);
  const p0 = V.toScreen(cam, g.plots[0].x);
  assert.deepEqual(V.plotAt(cam, g, p0.x, cam.ground - 5), { plot: 0 });
  assert.deepEqual(V.plotAt(cam, g, p0.x + 2 * cam.scale, cam.ground - 5), { plot: 0 });
  assert.equal(V.plotAt(cam, g, p0.x, 2), null, 'not in the sky');
  const c = g.chasms[0];
  const far = V.centerOn(cam, (c.x0 + c.x1) / 2);
  assert.deepEqual(V.plotAt(far, g, V.toScreen(far, (c.x0 + c.x1) / 2).x, far.ground + 4), { chasm: 0 });
  c.bridged = true;
  assert.equal(V.plotAt(far, g, V.toScreen(far, (c.x0 + c.x1) / 2).x, far.ground + 4), null, 'a bridged chasm is no target');
});

test('the build panel lists options with their state and what is missing', () => {
  const g = F.newGame(LEVELS[1], 1);
  g.res = { wood: 40, stone: 0, metal: 0 };
  const menu = V.buildMenu(g, { plot: 0 });
  assert.deepEqual(menu.map((o) => o.id), V.PLOT_OPTIONS);
  const house = menu.find((o) => o.id === 'house');
  assert.equal(house.state, 'ok');
  const tower = menu.find((o) => o.id === 'tower');
  assert.equal(tower.state, 'nores');
  assert.deepEqual(tower.missing, { wood: 10, stone: 40 });
  const bridge = V.buildMenu(g, { chasm: 0 });
  assert.equal(bridge.length, 1);
  assert.deepEqual(bridge[0].cost, F.bridgeCost(g, 0));
  const far = V.buildMenu(g, { plot: g.plots.length - 1 });
  assert.ok(far.every((o) => o.state === 'locked'), 'a plot beyond the chasm is locked');
  F.build(g, { plot: 0 }, 'house');
  assert.deepEqual(V.buildMenu(g, { plot: 0 }), [], 'a plot with a house has nothing to add');
  g.plots[1].b = { id: 'wall', done: true, hp: 400, maxHp: 400 };
  assert.deepEqual(V.buildMenu(g, { plot: 1 }).map((o) => o.id), ['stonewall']);
  assert.deepEqual(V.buildMenu(g, null), []);
  assert.deepEqual(V.buildMenu(g, { plot: 99 }), []);
});

test('formatting: numbers and the clock', () => {
  assert.equal(V.fmt(12345), '12 345');
  assert.equal(V.fmt(-3), '−3');
  assert.equal(V.clock(0), '0:00');
  assert.equal(V.clock(125.7), '2:05');
  assert.equal(V.clock('x'), '0:00');
});
