'use strict';
// The hamlet over the hill: the trail, the road that opens it, its zone and nodes, saves.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');

function village(seed = 1) {
  const s = V.newGame(seed);
  for (const id of V.BUILDING_IDS) {
    if (V.BUILDINGS[id].after) continue;
    s.built[id].done = true;
    for (const r of Object.keys(s.built[id].paid)) s.built[id].paid[r] = V.BUILDINGS[id].cost[r];
  }
  s.festival = true;
  return s;
}
const trail = () => V.FOOTPRINTS.road;
const hamletTile = (s) => {
  for (let y = 0; y < V.H; y++) for (let x = V.HAMLET_X; x < V.W; x++) if (V.zoneAt(x, y) === 'hamlet' && V.isWalkable(s, x, y)) return { x, y };
};

test('the hill walls off the hamlet except for the trail', () => {
  const s = V.newGame(1);
  assert.ok(trail().length >= 1);
  for (const t of trail()) assert.equal(V.tileAt(t.x, t.y), 't');
  for (let y = 0; y < V.H; y++) {
    const c = V.tileAt(V.HAMLET_X, y);
    assert.ok(c === '^' || c === 't', `row ${y}: ${c}`);
    assert.equal(V.isWalkable(s, V.HAMLET_X, y), false, 'nothing passes before the road');
  }
});

test('the road opens the trail; before it the hamlet cannot be reached', () => {
  const s = village();
  const to = hamletTile(s);
  assert.equal(V.findPath(s, V.START, to), null);
  assert.equal(V.interact(s, to.x, to.y), 'none');
  for (const [r, n] of Object.entries(V.BUILDINGS.road.cost)) s.res[r] = n;
  assert.equal(V.contribute(s, 'road'), 'built');
  for (const t of trail()) assert.equal(V.isWalkable(s, t.x, t.y), true);
  const path = V.findPath(s, V.START, to);
  assert.ok(path && path.length > 10);
});

test('the road comes after the festival and is the next goal then', () => {
  const s = village();
  s.festival = false;
  s.built.chapel.done = false;
  assert.equal(V.contribute(s, 'road'), 'locked', 'needs the chapel');
  assert.equal(V.BUILDINGS.road.after, 'festival');
  s.built.chapel.done = true;
  s.festival = true;
  assert.deepEqual(V.nextGoal(s), { type: 'build', id: 'road' });
  // Before the festival the hint never points over the hill.
  const early = V.newGame(1);
  for (let i = 0; i < 5; i++) assert.notEqual(V.nextGoal(early) && V.nextGoal(early).id, 'road');
});

test('hamlet nodes are laid out past the hill and reachable once the road stands', () => {
  for (const seed of [1, 2, 3, 7]) {
    const s = V.newGame(seed);
    const here = s.nodes.filter((n) => V.zoneAt(n.x, n.y) === 'hamlet');
    const want = Object.values(V.ZONE_NODES.hamlet).reduce((a, n) => a + n, 0);
    assert.equal(here.length, want, `seed ${seed}`);
    for (const n of here) assert.ok(n.x > V.HAMLET_X, 'past the ridge');
    assert.ok(here.some((n) => n.kind === 'apple'), 'an orchard');
  }
});
