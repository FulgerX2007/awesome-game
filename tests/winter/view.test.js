'use strict';
// Долгая зима: the pure client helpers in view.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/winter/core.js');
const V = require('../../web/winter/view.js');

test('the camera follows the hero and stays inside the map at 320, 360 and 1280 px', () => {
  for (const vp of [{ w: 320, h: 360 }, { w: 360, h: 420 }, { w: 1280, h: 700 }]) {
    const mid = V.camera(vp, { x: 27.5, y: 20.5 });
    assert.ok(Math.abs(mid.x0 + mid.vw / 2 - 27.5) < 1e-9 && Math.abs(mid.y0 + mid.vh / 2 - 20.5) < 1e-9, 'centred on the hero');
    assert.ok(Math.min(vp.w, vp.h) / mid.ts >= V.MIN_TILES - 1);
    const corner = V.camera(vp, { x: 0, y: 0 });
    assert.equal(corner.x0, 0);
    assert.equal(corner.y0, 0);
    const far = V.camera(vp, { x: C.W, y: C.H });
    assert.ok(Math.abs(far.x0 + far.vw - C.W) < 1e-9 && Math.abs(far.y0 + far.vh - C.H) < 1e-9);
  }
  const big = V.camera({ w: 4000, h: 3000 }, { x: 5, y: 5 });
  assert.ok(big.x0 < 0 && big.y0 < 0, 'a view bigger than the map centres it');
});

test('toScreen, toWorld and tileAt agree', () => {
  const cam = V.camera({ w: 360, h: 420 }, { x: 20.5, y: 15.5 });
  const p = V.toScreen(cam, 20.5, 15.5);
  const w = V.toWorld(cam, p.x, p.y);
  assert.ok(Math.abs(w.x - 20.5) < 1e-9 && Math.abs(w.y - 15.5) < 1e-9);
  assert.deepEqual(V.tileAt(cam, p.x, p.y), { x: 20, y: 15 });
  const corner = V.camera({ w: 360, h: 420 }, { x: 0, y: 0 });
  assert.equal(V.tileAt(corner, -5, -5), null);
});

test('lights: the fire while it burns, the stove, torches', () => {
  const g = C.newGame('normal', 1);
  assert.equal(V.lights(g).length, 1);
  g.fire.fuel = 0;
  assert.equal(V.lights(g).length, 0);
  g.hut.stage = 4; g.hut.stove = 3;
  g.torches.push({ x: 3, y: 4 });
  const l = V.lights(g);
  assert.equal(l.length, 2);
  assert.deepEqual([l[1].x, l[1].y, l[1].r], [3.5, 4.5, C.TORCH.radius]);
});

test('darkness rises at dusk, holds at night and lifts toward dawn', () => {
  const g = C.newGame('normal', 1);
  g.t = 20; assert.equal(V.darkness(g), 0);
  g.t = C.NIGHT_AT - 5; const dusk = V.darkness(g);
  g.t = C.NIGHT_AT + 20; const night = V.darkness(g);
  g.t = C.DAY - 2; const dawn = V.darkness(g);
  assert.ok(dusk > 0 && dusk < night && dawn < night);
  assert.ok(night <= 0.85, 'never pitch black');
});

test('edge markers sit on the screen border and point outward', () => {
  const cam = V.camera({ w: 360, h: 420 }, { x: 27.5, y: 20.5 });
  assert.equal(V.edgeMarker(cam, 27.5, 20.5), null, 'nothing for what is on screen');
  const m = V.edgeMarker(cam, 50, 20.5);
  assert.ok(Math.abs(m.x - (cam.w - 14)) < 1e-6 && m.y > 0 && m.y < cam.h);
  assert.ok(Math.abs(m.angle) < 0.2);
  const up = V.edgeMarker(cam, 27.5, 0);
  assert.ok(Math.abs(up.y - 14) < 1e-6);
});

test('the clock: 06:00 at dawn, 22:00 at nightfall, past midnight before the morning', () => {
  const g = C.newGame('normal', 1);
  g.t = 0; assert.equal(V.clock(g), '06:00');
  g.t = C.NIGHT_AT; assert.equal(V.clock(g), '22:00');
  g.t = C.NIGHT_AT + (C.DAY - C.NIGHT_AT) / 2; assert.equal(V.clock(g), '02:00');
  g.t = C.DAY + C.NIGHT_AT / 2; assert.equal(V.clock(g), '14:00');
});
