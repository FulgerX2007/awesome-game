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
  // A tree with nothing else to act on around the spots the test stands at.
  const alone = (n) => !s.nodes.some((m) => m !== n && m.hp > 0 && Math.abs(m.x - n.x) <= 2 && Math.abs(m.y - n.y) <= 2)
    && [[-2, 0], [-2, 1], [-1, 1], [0, 2], [1, 2], [-1, 2], [1, 1]].every(([dx, dy]) => !V.ruinAt(n.x + dx, n.y + dy) && V.plotAt(n.x + dx, n.y + dy) < 0);
  const tree = s.nodes.find((n) => n.kind === 'tree' && alone(n) && V.isWalkable(s, n.x - 1, n.y) && V.isWalkable(s, n.x, n.y + 1));
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

// ── 2.5D silhouettes ──

test('tallBox rises above the node tile and is null for unknown kinds', () => {
  for (const kind of Object.keys(VV.NODE_TALL)) {
    const b = VV.tallBox(kind, 5, 7);
    assert.ok(b.y0 < b.base, `${kind} rises above its foot`);
    assert.ok(b.y1 <= 8 * T && b.y1 > b.base - 1, `${kind} ends at its foot`);
    assert.ok(b.x0 < 5.5 * T && b.x1 > 5.5 * T, `${kind} is centred on its tile`);
  }
  // A tree is the tallest thing that grows and reaches into the tile behind it.
  assert.ok(VV.tallBox('tree', 5, 7).y0 < 7 * T);
  assert.ok(VV.tallBox('tree', 0, 0).y0 < VV.tallBox('rock', 0, 0).y0);
  assert.equal(VV.tallBox('cloud', 0, 0), null);
});

test('houseBox covers the footprint and rises with the stage', () => {
  const tiles = V.FOOTPRINTS.barn;
  const ruin = VV.houseBox(tiles, 0), built = VV.houseBox(tiles, 2);
  const xs = tiles.map((t) => t.x), ys = tiles.map((t) => t.y);
  assert.equal(built.x0, Math.min(...xs) * T);
  assert.equal(built.x1, (Math.max(...xs) + 1) * T);
  assert.equal(built.base, (Math.max(...ys) + 1) * T);
  assert.ok(built.y0 < ruin.y0 && ruin.y0 < Math.min(...ys) * T);
  assert.deepEqual(VV.houseBox(tiles, 9), built, 'stages past the last are clamped');
});

// A game with one standing tree at (x, y) and nothing else, for silhouette taps.
function lone(x, y, kind = 'tree') {
  const s = V.newGame(1);
  s.nodes = [{ id: 1, kind, x, y, hp: V.NODE_KINDS[kind].hp, regrowAt: null }];
  return s;
}
const freeTile = (s) => {
  for (let y = 2; y < V.H; y++) for (let x = 0; x < V.W; x++) {
    if (V.tileAt(x, y) === '.' && V.tileAt(x, y - 1) === '.' && !V.ruinAt(x, y) && !V.ruinAt(x, y - 1)) return { x, y };
  }
};

test('tapAt picks a tree by its crown over the tile behind it', () => {
  const at = freeTile(V.newGame(1));
  const s = lone(at.x, at.y);
  const crown = VV.tapAt(s, V, (at.x + 0.5) * T, (at.y - 0.3) * T); // a point on the tile above the tree
  assert.equal(crown.type, 'gather');
  assert.equal(crown.node, 1);
  assert.deepEqual([crown.x, crown.y], [at.x, at.y]);
  // A felled tree is flat again: the tile behind is just ground.
  s.nodes[0].hp = 0;
  const behind = VV.tapAt(s, V, (at.x + 0.5) * T, (at.y - 0.3) * T);
  assert.equal(behind.type, 'walk');
  assert.deepEqual([behind.x, behind.y], [at.x, at.y - 1]);
});

test('tapAt prefers the nearer of two overlapping silhouettes', () => {
  const at = freeTile(V.newGame(1));
  const s = lone(at.x, at.y - 1, 'rock');
  s.nodes.push({ id: 2, kind: 'tree', x: at.x, y: at.y, hp: V.NODE_KINDS.tree.hp, regrowAt: null });
  // Low on the rock's tile, where the tree's crown covers it: the tree stands in front.
  const p = VV.tapAt(s, V, (at.x + 0.5) * T, (at.y - 0.2) * T);
  assert.equal(p.node, 2);
});

test('tapAt picks a building by its roof and falls back to the tile elsewhere', () => {
  const s = V.newGame(1);
  s.nodes = [];
  const tiles = V.FOOTPRINTS.home;
  s.built.home.done = true;
  for (const r of Object.keys(s.built.home.paid)) s.built.home.paid[r] = V.BUILDINGS.home.cost[r];
  const top = Math.min(...tiles.map((t) => t.y)), left = Math.min(...tiles.map((t) => t.x));
  const roof = VV.tapAt(s, V, (left + 0.5) * T, (top - 0.5) * T);
  assert.deepEqual([roof.type, roof.id], ['ruin', 'home']);
  // Plain ground and the map edge behave like tapAction.
  assert.equal(VV.tapAt(s, V, (V.START.x + 0.5) * T, (V.START.y + 0.5) * T).type, 'walk');
  assert.equal(VV.tapAt(s, V, -10, 40).type, 'none');
  // The bridge lies flat: the water above it is not the bridge.
  const br = V.FOOTPRINTS.bridge[0];
  const above = VV.tapAt(s, V, (br.x + 0.5) * T, (Math.min(...V.FOOTPRINTS.bridge.map((t) => t.y)) - 0.5) * T);
  assert.notEqual(above.id, 'bridge');
});

test('edgeMask marks the sides that face outside the set', () => {
  const { N, E, S, W } = VV.EDGE;
  const water = (x, y) => V.tileAt(x, y) === '~';
  // A lone tile: every side is an edge. Outside the set: nothing.
  const one = (x, y) => x === 3 && y === 3;
  assert.equal(VV.edgeMask(one, 3, 3), N | E | S | W);
  assert.equal(VV.edgeMask(one, 4, 3), 0);
  // A row of three: the middle only has its long sides, the ends add their caps.
  const row = (x, y) => y === 0 && x >= 0 && x <= 2;
  assert.equal(VV.edgeMask(row, 1, 0), N | S);
  assert.equal(VV.edgeMask(row, 0, 0), N | S | W);
  assert.equal(VV.edgeMask(row, 2, 0), N | E | S);
  // The open river: a tile deep inside has no edge, a bank tile has one.
  let inner = null, bank = null;
  for (let y = 1; y < V.H - 1 && !(inner && bank); y++) for (let x = 1; x < V.W - 1; x++) {
    if (!water(x, y)) continue;
    const m = VV.edgeMask(water, x, y);
    if (!m && !inner) inner = m;
    if ((m & N) && !bank) bank = m;
  }
  assert.equal(inner, 0);
  assert.ok(bank & N);
});

test('node silhouettes stay close to their tile so they never swallow taps far away', () => {
  for (const [kind, t] of Object.entries(VV.NODE_TALL)) {
    assert.ok(t.hw * 2 <= T * 1.25, `${kind} is at most a tile and a quarter wide`);
    assert.ok(t.up <= T * 1.6, `${kind} rises at most a tile and a half`);
  }
  // A tap a full tile to the side of a tree is not the tree.
  const s = V.newGame(1);
  const tree = { id: 1, kind: 'tree', x: 10, y: 10, hp: 4, regrowAt: null };
  s.nodes = [tree];
  assert.notEqual(VV.tapAt(s, V, 11.9 * T, 10.2 * T).node, 1);
});

// ── Daylight ──

test('sunAt: noon is plain daylight, midnight is dark with lights on', () => {
  const noon = VV.sunAt(0.4, 'spring'), night = VV.sunAt(0.92, 'spring');
  assert.equal(noon.shade, 0);
  assert.equal(noon.lights, 0);
  assert.deepEqual(noon.tint, [255, 255, 255]);
  assert.ok(night.shade > 0.5);
  assert.ok(night.lights > 0.9);
  assert.ok(night.shadow < noon.shadow);
  const lum = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  assert.ok(lum(night.tint) < lum(noon.tint));
});

test('sunAt changes smoothly through the day and wraps without a jump', () => {
  const N = 2000;
  let prev = VV.sunAt(0, 'summer');
  for (let i = 1; i <= N; i++) {
    const cur = VV.sunAt(i / N, 'summer');
    for (const k of ['shade', 'shadow', 'lights']) {
      assert.ok(cur[k] >= 0 && cur[k] <= 1, `${k} in range at ${i / N}`);
      assert.ok(Math.abs(cur[k] - prev[k]) < 0.05, `${k} jumps at ${i / N}`);
    }
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(cur.tint[c] - prev.tint[c]) <= 4, `tint jumps at ${i / N}`);
    prev = cur;
  }
  assert.deepEqual(VV.sunAt(1, 'summer'), VV.sunAt(0, 'summer'));
  assert.deepEqual(VV.sunAt(-0.25, 'summer'), VV.sunAt(0.75, 'summer'));
});

test('sunAt tints the seasons differently and tolerates junk', () => {
  const w = VV.sunAt(0.4, 'winter').tint, a = VV.sunAt(0.4, 'autumn').tint;
  assert.ok(w[2] > a[2], 'winter is bluer than autumn');
  assert.deepEqual(VV.sunAt('x', 'nope'), VV.sunAt(0, 'spring'));
  for (const c of VV.sunAt(0.92, 'winter').tint) assert.ok(c >= 0 && c <= 255);
});

// ── Seasons ──

test('palette gives every season its own ground and crowns', () => {
  const bases = V.SEASONS.map((x) => VV.palette(x).grass.base);
  assert.equal(new Set(bases).size, V.SEASONS.length, 'each season has its own grass');
  assert.equal(VV.palette('winter').leaves, null, 'bare trees in winter');
  assert.ok(VV.palette('winter').ice && VV.palette('winter').snow === 1);
  assert.ok(VV.palette('spring').flowers > VV.palette('autumn').flowers);
  for (const x of V.SEASONS) {
    const p = VV.palette(x);
    for (const k of ['base', 'dark', 'light', 'tuft', 'tuftLight']) assert.match(p.grass[k], /^#[0-9a-f]{6}$/i, `${x}.${k}`);
  }
  assert.equal(VV.palette('nope'), VV.palette('spring'));
});

test('seasonFade blends over the first day of a season, never at the very start', () => {
  const at = (t) => VV.seasonFade(V.clock(t));
  assert.deepEqual(at(0), { from: 'winter', to: 'spring', t: 1 }, 'the first spring needs no fade');
  const summer = V.DAY * V.SEASON_DAYS; // summer, day 0, dawn
  assert.deepEqual(at(summer), { from: 'spring', to: 'summer', t: 0 });
  assert.equal(at(summer + V.DAY / 2).t, 0.5);
  assert.equal(at(summer + V.DAY).t, 1, 'done after the first day');
  const spring2 = V.DAY * V.SEASON_DAYS * 4;
  assert.deepEqual(at(spring2 + 1).from, 'winter');
  assert.ok(at(spring2 + 1).t < 0.01, 'the second spring fades in from winter');
});

test('tapAction and pickFront know garden plots and the well', () => {
  const s = V.newGame(1);
  const p = V.PLOTS[0], w = V.FOOTPRINTS.well[0];
  assert.deepEqual(VV.tapAction(s, V, p.x, p.y), { type: 'ruin', id: 'garden' }, 'before the garden: its ruin');
  assert.deepEqual(VV.tapAction(s, V, w.x, w.y), { type: 'ruin', id: 'well' });
  s.built.well.done = true;
  s.built.garden.done = true;
  assert.deepEqual(VV.tapAction(s, V, p.x, p.y), { type: 'plot', i: 0 });
  assert.deepEqual(VV.tapAction(s, V, w.x, w.y), { type: 'well' });
  // Standing right of the last plot of the first row, facing left.
  const row = V.PLOTS.filter((q) => q.y === p.y);
  const last = row[row.length - 1];
  const a = VV.pickFront(s, V, last.x + 1.5, last.y + 0.5, 'left');
  assert.equal(a.type, 'plot');
  assert.deepEqual([a.x, a.y], [last.x, last.y]);
});

test('farmHint points at ripe, dry and (while vegetables are wanted) empty plots', () => {
  const s = V.newGame(1);
  assert.equal(VV.farmHint(s, V), null, 'no garden yet');
  s.built.well.done = true;
  s.built.garden.done = true;
  s.t = V.DAY * 0.3; // a spring day
  assert.equal(VV.farmHint(s, V), 'sow', 'the potter and the chapel want vegetables');
  s.res.vegetables = 10000;
  assert.equal(VV.farmHint(s, V), null, 'enough vegetables: no need to sow');
  s.plots[3] = { stage: 'planted', water: false, grow: 0.2 };
  assert.equal(VV.farmHint(s, V), 'water');
  s.plots[1] = { stage: 'ripe', water: false, grow: 1 };
  assert.equal(VV.farmHint(s, V), 'ripe', 'picking comes first');
  s.t = V.DAY * V.SEASON_DAYS * 3 + 10; // winter
  assert.equal(VV.farmHint(s, V), 'ripe', 'a ripe crop can be picked in winter');
  s.plots[1] = { stage: 'empty', water: false, grow: 0 };
  assert.equal(VV.farmHint(s, V), null, 'nothing to water or sow in winter');
});

test('soundFor covers the garden and the bucket', () => {
  assert.equal(VV.soundFor({ type: 'plot', result: 'harvest' }), 'berries');
  assert.equal(VV.soundFor({ type: 'plot', result: 'watered' }), 'shovel');
  assert.equal(VV.soundFor({ type: 'plot', result: 'bucket' }), null);
  assert.equal(VV.soundFor({ type: 'bucket', n: 6 }), 'contribute');
  assert.equal(VV.soundFor({ type: 'bucket', n: 6, full: true }), null);
  assert.equal(VV.soundFor({ type: 'hit', kind: 'apple' }), 'berries');
});
