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
  assert.equal(VV.STEP, V.MAX_DT); // the client's fixed step is core's step size
});

// ── HUD helpers ──

test('fmt shows whole numbers and a short form above 9 999', () => {
  assert.equal(VV.fmt(0), '0');
  assert.equal(VV.fmt(12.9), '12');
  assert.equal(VV.fmt(9999), '9999');
  assert.equal(VV.fmt(12345), '12.3k');
  assert.equal(VV.fmt(20000), '20k');
  assert.equal(VV.fmt(250400), '250k');
  assert.equal(VV.fmt(undefined), '0');
  assert.equal(VV.fmt(NaN), '0');
});

test('fmtRate is signed, drops near-zero and junk', () => {
  assert.equal(VV.fmtRate(0), '');
  assert.equal(VV.fmtRate(0.04), '');
  assert.equal(VV.fmtRate(NaN), '');
  assert.equal(VV.fmtRate(12), '+12');
  assert.equal(VV.fmtRate(9), '+9');
  assert.equal(VV.fmtRate(4.56), '+4.6');
  assert.equal(VV.fmtRate(-36), '−36');
  assert.equal(VV.fmtRate(-0.5), '−0.5');
  assert.equal(VV.fmtRate(13.6), '+14');
});

test('splitDuration gives hours, minutes and seconds', () => {
  assert.deepEqual(VV.splitDuration(3725.9), { h: 1, m: 2, s: 5 });
  assert.deepEqual(VV.splitDuration(59), { h: 0, m: 0, s: 59 });
  assert.deepEqual(VV.splitDuration(-5), { h: 0, m: 0, s: 0 });
  assert.deepEqual(VV.splitDuration('junk'), { h: 0, m: 0, s: 0 });
  assert.deepEqual(VV.splitDuration(8 * 3600), { h: 8, m: 0, s: 0 });
});

test('income matches the core rates: villagers, mill bonus, workshops, limits', () => {
  const s = V.newGame(1);
  assert.deepEqual(VV.income(s, V), { rate: {}, full: [] });
  s.villagers.push({ role: 'woodcutter', house: 'house1' });
  assert.ok(Math.abs(VV.income(s, V).rate.wood - V.VILLAGERS.woodcutter.rate * 60) < 1e-9);
  s.built.mill.done = true;
  assert.ok(Math.abs(VV.income(s, V).rate.wood - V.VILLAGERS.woodcutter.rate * V.MILL_BONUS * 60) < 1e-9);
  // At the storage limit the villager stops and the resource is marked full.
  s.res.wood = s.storage;
  assert.deepEqual(VV.income(s, V), { rate: {}, full: ['wood'] });

  // Sawmill: works only above the reserve, eats wood, stops at the planks limit.
  const w = V.WORKSHOPS.sawmill;
  const k = V.newGame(1);
  k.built.sawmill.done = true;
  k.res.wood = V.WORKSHOP_RESERVE;
  assert.deepEqual(VV.income(k, V).rate, {});
  k.res.wood = V.WORKSHOP_RESERVE + w.ratio;
  const r = VV.income(k, V).rate;
  assert.ok(Math.abs(r.planks - w.rate * 60) < 1e-9);
  assert.ok(Math.abs(r.wood + w.rate * w.ratio * 60) < 1e-9);
  k.res.planks = k.storage;
  assert.deepEqual(VV.income(k, V), { rate: {}, full: ['planks'] });
});

test('income agrees with what step() actually produces', () => {
  const s = V.newGame(3);
  s.built.sawmill.done = true;
  s.built.kiln.done = true;
  s.villagers.push({ role: 'mason', house: 'house2' });
  s.storage = 400;
  s.res.wood = 200; s.res.clay = 200;
  const { rate } = VV.income(s, V);
  const before = { ...s.res };
  for (let i = 0; i < 60 * 20; i++) V.step(s, 0.05);
  for (const r of ['planks', 'bricks', 'stone', 'wood', 'clay']) {
    assert.ok(Math.abs(s.res[r] - before[r] - rate[r]) <= 2, `${r}: ${s.res[r] - before[r]} vs ${rate[r]}`);
  }
});

test('ruinAt finds footprints', () => {
  for (const [id, tiles] of Object.entries(V.FOOTPRINTS)) {
    for (const t of tiles) assert.equal(V.ruinAt(t.x, t.y), id);
  }
  assert.equal(V.ruinAt(V.START.x, V.START.y), null);
  assert.equal(V.ruinAt(-1, 0), null);
});

test('tapAction picks gather, tool, ruin, walk and none', () => {
  const s = V.newGame(1);
  const tree = s.nodes.find((n) => n.kind === 'tree');
  assert.deepEqual(VV.tapAction(s, V, tree.x + 0.7, tree.y + 0.2), { type: 'gather', node: tree.id });
  const clay = s.nodes.find((n) => n.kind === 'clay');
  assert.deepEqual(VV.tapAction(s, V, clay.x, clay.y), { type: 'tool', tool: 'shovel' });
  // An empty node is just ground.
  tree.hp = 0;
  assert.deepEqual(VV.tapAction(s, V, tree.x, tree.y), { type: 'walk' });
  const well = V.FOOTPRINTS.well[0];
  assert.deepEqual(VV.tapAction(s, V, well.x, well.y), { type: 'ruin', id: 'well' });
  s.built.well.done = true; // a restored building still opens its panel
  assert.deepEqual(VV.tapAction(s, V, well.x, well.y), { type: 'ruin', id: 'well' });
  const br = V.FOOTPRINTS.bridge[0];
  assert.deepEqual(VV.tapAction(s, V, br.x, br.y), { type: 'ruin', id: 'bridge' });
  s.built.bridge.done = true; // the restored bridge is a road
  assert.deepEqual(VV.tapAction(s, V, br.x, br.y), { type: 'walk' });
  assert.deepEqual(VV.tapAction(s, V, V.START.x, V.START.y), { type: 'walk' });
  assert.deepEqual(VV.tapAction(s, V, -1, 5), { type: 'none' });
  assert.deepEqual(VV.tapAction(s, V, V.W, 5), { type: 'none' });
  const water = (() => { for (let y = 0; y < V.H; y++) for (let x = 0; x < V.W; x++) if (V.tileAt(x, y) === '~') return { x, y }; })();
  assert.deepEqual(VV.tapAction(s, V, water.x, water.y), { type: 'none' });
});

test('frontTiles puts the faced tile first and covers all 8 neighbours once', () => {
  const ft = VV.frontTiles(5.5, 7.4, 'left');
  assert.deepEqual(ft[0], { x: 4, y: 7 });
  assert.equal(ft.length, 8);
  assert.equal(new Set(ft.map((p) => `${p.x},${p.y}`)).size, 8);
  assert.ok(!ft.some((p) => p.x === 5 && p.y === 7));
  assert.deepEqual(VV.frontTiles(5.5, 7.4, 'up')[0], { x: 5, y: 6 });
  assert.deepEqual(VV.frontTiles(5.5, 7.4, 'junk')[0], { x: 5, y: 8 });
});

test('pickFront prefers the faced node, falls back to neighbours, null when nothing is near', () => {
  const s = V.newGame(1);
  const tree = s.nodes.find((n) => n.kind === 'tree' && V.isWalkable(s, n.x - 1, n.y) && V.isWalkable(s, n.x, n.y + 1));
  // Standing left of the tree, facing it.
  assert.deepEqual(VV.pickFront(s, V, tree.x - 0.5, tree.y + 0.5, 'right'), { type: 'gather', node: tree.id, x: tree.x, y: tree.y });
  // Facing away: still found among the neighbours.
  assert.equal(VV.pickFront(s, V, tree.x - 0.5, tree.y + 0.5, 'left').node, tree.id);
  // Below the tree, facing up.
  assert.equal(VV.pickFront(s, V, tree.x + 0.5, tree.y + 1.5, 'up').node, tree.id);
  // Next to the well ruin.
  const w = V.FOOTPRINTS.well[0];
  const spot = [[0, 1], [-1, 0], [1, 0], [0, -1]].map(([dx, dy]) => ({ x: w.x + dx, y: w.y + dy }))
    .find((p) => V.isWalkable(s, p.x, p.y) && !V.ruinAt(p.x, p.y));
  const a = VV.pickFront(s, V, spot.x + 0.5, spot.y + 0.5, 'down');
  assert.equal(a.type, 'ruin');
  assert.equal(a.id, 'well');
  // Middle of nowhere: find a tile with no node or building around.
  let empty = null;
  for (let y = 1; y < V.H - 1 && !empty; y++) for (let x = 1; x < V.W - 1 && !empty; x++) {
    if (VV.frontTiles(x + 0.5, y + 0.5, 'down').every((p) => VV.tapAction(s, V, p.x, p.y).type === 'walk')) empty = { x, y };
  }
  assert.ok(empty);
  assert.equal(VV.pickFront(s, V, empty.x + 0.5, empty.y + 0.5, 'down'), null);
});

test('footprintDist is 0 inside, 0.5 from a neighbouring tile centre', () => {
  const tiles = [{ x: 3, y: 3 }, { x: 4, y: 3 }];
  assert.equal(VV.footprintDist(3.5, 3.5, tiles), 0);
  assert.equal(VV.footprintDist(5.5, 3.5, tiles), 0.5);
  assert.equal(VV.footprintDist(3.5, 4.5, tiles), 0.5);
  assert.ok(Math.abs(VV.footprintDist(5.5, 4.5, tiles) - Math.SQRT1_2) < 1e-12);
  assert.equal(VV.footprintDist(0, 0, []), Infinity);
});
