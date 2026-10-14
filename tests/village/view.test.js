'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const VV = require('../../web/village/view.js');
const V = require('../../web/village/core.js');

const T = VV.TILE;
const MW = V.W * T, MH = V.H * T;

test('clampCamera centres the view on the focus point inside the map', () => {
  const cam = VV.clampCamera(700, 500, 400, 300, MW, MH);
  assert.deepEqual(cam, { x: 500, y: 350 });
});

test('clampCamera clamps at every map edge', () => {
  assert.deepEqual(VV.clampCamera(10, 10, 400, 300, MW, MH), { x: 0, y: 0 });
  assert.deepEqual(VV.clampCamera(MW - 5, MH - 5, 400, 300, MW, MH), { x: MW - 400, y: MH - 300 });
  assert.deepEqual(VV.clampCamera(-500, MH + 900, 400, 300, MW, MH), { x: 0, y: MH - 300 });
  // The view exactly as wide as the map: no room to move on that axis.
  assert.equal(VV.clampCamera(123, 0, MW, 300, MW, MH).x, 0);
});

test('clampCamera centres a map smaller than the view', () => {
  const cam = VV.clampCamera(0, 0, MW + 200, MH + 100, MW, MH);
  assert.deepEqual(cam, { x: -100, y: -50 });
  // Wide but short view: centred horizontally, clamped vertically.
  const wide = VV.clampCamera(MW, MH, MW + 60, 300, MW, MH);
  assert.equal(wide.x, -30);
  assert.equal(wide.y, MH - 300);
});

test('screenToTile maps canvas points to tiles through the camera', () => {
  const cam = { x: 100, y: 64 };
  assert.deepEqual(VV.screenToTile(0, 0, cam), { x: 3, y: 2 });
  assert.deepEqual(VV.screenToTile(27, 31, cam), { x: 3, y: 2 });
  assert.deepEqual(VV.screenToTile(28, 32, cam), { x: 4, y: 3 });
  // Negative camera (map centred in a big view): points left of the map give negative tiles.
  assert.deepEqual(VV.screenToTile(10, 10, { x: -100, y: -50 }), { x: -3, y: -2 });
  assert.deepEqual(VV.screenToTile(16, 16, { x: 0, y: 0 }, 16), { x: 1, y: 1 });
});

test('screenToTile is the inverse of the tile origin for every tile', () => {
  const cam = VV.clampCamera(20 * T, 15 * T, 360, 420, MW, MH);
  for (let y = 0; y < V.H; y++) for (let x = 0; x < V.W; x++) {
    const sx = x * T - cam.x + T / 2, sy = y * T - cam.y + T / 2;
    assert.deepEqual(VV.screenToTile(sx, sy, cam), { x, y });
  }
});

test('visibleRange covers the view and stays in the map', () => {
  const r = VV.visibleRange({ x: 0, y: 0 }, 400, 300, V.W, V.H);
  assert.deepEqual(r, { x0: 0, y0: 0, x1: 12, y1: 9 });
  const off = VV.visibleRange({ x: 50, y: 40 }, 400, 300, V.W, V.H);
  assert.deepEqual(off, { x0: 1, y0: 1, x1: 14, y1: 10 });
  // Margin widens the range but never past the map.
  const m = VV.visibleRange({ x: 0, y: 0 }, 400, 300, V.W, V.H, T, 2);
  assert.deepEqual(m, { x0: 0, y0: 0, x1: 14, y1: 11 });
  const edge = VV.visibleRange({ x: MW - 400, y: MH - 300 }, 400, 300, V.W, V.H, T, 2);
  assert.equal(edge.x1, V.W - 1);
  assert.equal(edge.y1, V.H - 1);
  // A view bigger than the map (negative camera) is clamped to the whole map.
  const big = VV.visibleRange({ x: -100, y: -50 }, MW + 200, MH + 100, V.W, V.H);
  assert.deepEqual(big, { x0: 0, y0: 0, x1: V.W - 1, y1: V.H - 1 });
});

test('visibleRange includes every tile touched by the view', () => {
  for (const [cx, cy, w, h] of [[13, 7, 333, 211], [0, 0, 1, 1], [MW - 97, 3, 97, 500]]) {
    const r = VV.visibleRange({ x: cx, y: cy }, w, h, V.W, V.H);
    assert.equal(r.x0, Math.floor(cx / T));
    assert.equal(r.x1, Math.floor((cx + w - 1e-9) / T));
    assert.equal(r.y0, Math.floor(cy / T));
    assert.equal(r.y1, Math.floor((cy + h - 1e-9) / T));
  }
});

test('fitCanvas scales by the pixel ratio with a cap and sane fallbacks', () => {
  assert.deepEqual(VV.fitCanvas(400, 300, 1), { ratio: 1, w: 400, h: 300 });
  assert.deepEqual(VV.fitCanvas(400, 300, 1.5), { ratio: 1.5, w: 600, h: 450 });
  assert.deepEqual(VV.fitCanvas(390, 500, 3), { ratio: VV.MAX_DPR, w: 390 * VV.MAX_DPR, h: 500 * VV.MAX_DPR });
  assert.deepEqual(VV.fitCanvas(100, 100, 0.5), { ratio: 1, w: 100, h: 100 });
  assert.deepEqual(VV.fitCanvas(100, 100, undefined), { ratio: 1, w: 100, h: 100 });
  assert.deepEqual(VV.fitCanvas(100, 100, NaN), { ratio: 1, w: 100, h: 100 });
  assert.deepEqual(VV.fitCanvas(0, -5, 2), { ratio: 2, w: 1, h: 1 });
  assert.deepEqual(VV.fitCanvas(333.3, 10.2, 1.25), { ratio: 1.25, w: 417, h: 13 });
});

test('snap rounds the camera to whole device pixels', () => {
  assert.equal(VV.snap(10.3, 1), 10);
  assert.equal(VV.snap(10.3, 2), 10.5);
  assert.equal(VV.snap(-3.2, 2), -3);
  // A tile-picking round trip is unaffected by snapping at any ratio.
  for (const ratio of [1, 1.5, 2]) {
    const cam = { x: VV.snap(123.37, ratio), y: VV.snap(77.77, ratio) };
    assert.ok(Math.abs(cam.x - 123.37) <= 0.5 / ratio + 1e-9);
    assert.deepEqual(VV.screenToTile(5 * T - cam.x + 1, 4 * T - cam.y + 1, cam), { x: 5, y: 4 });
  }
});

test('hash2 is stable, in [0, 1) and varies by tile and salt', () => {
  const seen = new Set();
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const v = VV.hash2(x, y, 1);
    assert.ok(v >= 0 && v < 1);
    assert.equal(v, VV.hash2(x, y, 1));
    seen.add(v);
  }
  assert.ok(seen.size > 390);
  assert.notEqual(VV.hash2(3, 4, 1), VV.hash2(3, 4, 2));
  assert.notEqual(VV.hash2(3, 4), VV.hash2(4, 3));
});

test('facing follows the bigger axis and keeps the last one when still', () => {
  assert.equal(VV.facing(1, 0.2), 'right');
  assert.equal(VV.facing(-1, 0.5), 'left');
  assert.equal(VV.facing(0.1, 2), 'down');
  assert.equal(VV.facing(0, -1), 'up');
  assert.equal(VV.facing(0, 0, 'left'), 'left');
  assert.equal(VV.facing(0, 0), 'down');
});

test('clamp and lerp helpers', () => {
  assert.equal(VV.clamp(5, 0, 3), 3);
  assert.equal(VV.clamp(-1, 0, 3), 0);
  assert.equal(VV.lerp(2, 4, 0.5), 3);
  assert.equal(VV.STEP, 0.05);
});
