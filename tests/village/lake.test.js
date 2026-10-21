'use strict';
// The lake chapter (after the harvest festival): the forest strip, the clearing, the pier and the fishing spots.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const open = (s, ...ids) => { for (const id of ids) s.built[id].done = true; return s; };

// Tiles reachable from the start with every node cleared away.
function reach(s) {
  for (const n of s.nodes) n.hp = 0;
  const seen = new Set([`${V.START.x},${V.START.y}`]);
  const q = [[V.START.x, V.START.y]];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of DIRS) {
      const k = `${x + dx},${y + dy}`;
      if (seen.has(k) || !V.isWalkable(s, x + dx, y + dy)) continue;
      seen.add(k);
      q.push([x + dx, y + dy]);
    }
  }
  return seen;
}
const lakeTiles = (seen) => [...seen].filter((k) => Number(k.split(',')[1]) >= V.LAKE_Y);

test('the old forest walls off the lake except for the clearing; the river gives no way round', () => {
  for (const y of [V.LAKE_Y, V.LAKE_Y + 1]) {
    assert.match(V.MAP[y], /^[&o~]+$/, `row ${y} is forest, the clearing and the river`);
  }
  assert.deepEqual(V.FOOTPRINTS.glade.map((t) => V.tileAt(t.x, t.y)), ['o', 'o', 'o', 'o', 'o', 'o'], 'a clearing three tiles wide');
  const before = reach(open(V.newGame(1), 'bridge', 'road'));
  assert.deepEqual(lakeTiles(before), [], 'nothing past the forest before the glade');
  const after = reach(open(V.newGame(1), 'bridge', 'road', 'glade'));
  assert.ok(lakeTiles(after).length > 200, 'the lake shore opens with the glade');
  for (const t of V.FOOTPRINTS.glade) assert.equal(V.zoneAt(t.x, t.y), null);
});

test('the pier is water until it is built', () => {
  const s = open(V.newGame(1), 'glade');
  for (const t of V.FOOTPRINTS.pier) assert.equal(V.isWalkable(s, t.x, t.y), false, 'before the pier');
  s.built.pier.done = true;
  for (const t of V.FOOTPRINTS.pier) assert.equal(V.isWalkable(s, t.x, t.y), true, 'after the pier');
  const seen = reach(s);
  for (const t of V.FOOTPRINTS.pier) assert.ok(seen.has(`${t.x},${t.y}`), 'reachable from the shore');
});

test('lake nodes lie past the forest and are reachable once the glade and the pier stand', () => {
  for (const seed of [1, 2, 3, 77]) {
    const s = V.newGame(seed);
    const lake = s.nodes.filter((n) => V.zoneAt(n.x, n.y) === 'lake');
    const want = Object.values(V.ZONE_NODES.lake).reduce((a, n) => a + n, 0);
    assert.equal(lake.length, want, `seed ${seed}: lake nodes`);
    for (const n of lake) assert.ok(n.y > V.LAKE_Y + 1, 'past the forest');
    const seen = reach(open(s, 'bridge', 'road', 'glade', 'pier'));
    for (const n of s.nodes) {
      assert.ok(DIRS.some(([dx, dy]) => seen.has(`${n.x + dx},${n.y + dy}`)), `seed ${seed}: node ${n.id} (${n.kind}) reachable`);
    }
  }
});

test('every fishing spot holds a shoal on the water with a shore or pier tile next to it', () => {
  assert.ok(V.SPOTS.length >= 6);
  const s = V.newGame(5);
  const shoals = s.nodes.filter((n) => n.kind === 'shoal');
  assert.deepEqual(shoals.map((n) => [n.x, n.y]), V.SPOTS.map((p) => [p.x, p.y]), 'one shoal per spot, in order, after the others');
  assert.equal(shoals[0].id, s.nodes.length - shoals.length);
  for (const n of shoals) {
    assert.equal(V.tileAt(n.x, n.y), 'f');
    assert.equal(n.hp, V.NODE_KINDS.shoal.hp);
    assert.equal(V.isWalkable(open(V.newGame(5), 'glade', 'pier'), n.x, n.y), false, 'a spot is water');
    const stand = DIRS.map(([dx, dy]) => V.tileAt(n.x + dx, n.y + dy));
    assert.ok(stand.some((c) => c === ':' || c === 'j'), `spot ${n.x},${n.y} has somewhere to stand`);
  }
  // The spots by the pier can only be fished from it.
  const byPier = shoals.filter((n) => DIRS.every(([dx, dy]) => V.tileAt(n.x + dx, n.y + dy) !== ':'));
  assert.ok(byPier.length >= 2, 'some spots are off the pier');
});

test('the lake buildings stand past the forest, after the harvest festival', () => {
  for (const id of ['glade', 'pier', 'smokehouse', 'house6', 'boathouse', 'pavilion']) {
    const b = V.BUILDINGS[id];
    assert.equal(b.after, 'harvest', id);
    for (const t of V.FOOTPRINTS[id]) assert.ok(t.y >= V.LAKE_Y, `${id} lies in the lake rows`);
  }
  assert.deepEqual(V.BUILDINGS.glade.needs, ['harvest']);
  assert.equal(V.BUILDINGS.boathouse.bought, 'boat');
});
