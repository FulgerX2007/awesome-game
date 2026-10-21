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
  s.barnLevel = V.STORAGE.length - 1;
  s.storage = V.STORAGE[s.barnLevel];
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
  for (let y = 0; y < V.LAKE_Y; y++) { // below LAKE_Y the old forest walls everything off (lake.test.js)
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

// ── The hamlet's buildings ──
function over(s) {
  for (const [r, n] of Object.entries(V.BUILDINGS.road.cost)) s.res[r] += n;
  assert.equal(V.contribute(s, 'road'), 'built');
}
function build(s, id) {
  for (const [r, n] of Object.entries(V.BUILDINGS[id].cost)) s.res[r] += n;
  return V.contribute(s, id);
}
const SEASON = V.DAY * V.SEASON_DAYS;

test('the vineyard needs the cuttings from the fair; the hint says so', () => {
  const s = village();
  over(s);
  assert.equal(build(s, 'vineyard'), 'locked');
  // The cheaper houses come first; once they are done the hint waits for the fair.
  s.bought = [];
  for (const id of ['house4', 'house5']) assert.equal(build(s, id), 'built');
  assert.deepEqual(V.nextGoal(s), { type: 'fair', item: 'cuttings', id: 'vineyard' });
  s.bought.push('cuttings');
  assert.equal(V.contribute(s, 'vineyard'), 'built');
  assert.equal(V.nextGoal(s).type, 'build');
});

test('the chain: road → vineyard → press, the houses, then the harvest hall', () => {
  const s = village();
  s.bought.push('cuttings');
  assert.equal(build(s, 'harvest'), 'locked');
  over(s);
  for (const id of ['vineyard', 'press', 'house4', 'house5']) assert.equal(build(s, id), 'built', id);
  s.events.length = 0;
  assert.equal(build(s, 'harvest'), 'built');
  assert.equal(s.harvestFestival, true);
  assert.deepEqual(s.events.filter((e) => e.type === 'harvest-festival').length, 1);
  assert.equal(build(s, 'harvest'), 'done', 'only once');
  assert.equal(V.nextGoal(s).id, 'glade', 'then on to the lake');
});

test('the vineyard grows grapes except in winter; the press makes juice above the reserve', () => {
  const s = village();
  s.bought.push('cuttings');
  over(s);
  build(s, 'vineyard');
  s.t = SEASON + 10; // summer
  V.step(s, 600);
  assert.equal(s.res.grapes, Math.floor(600 * V.PRODUCERS.vineyard.rate + 1e-6));
  const w = village();
  w.bought.push('cuttings'); over(w); build(w, 'vineyard');
  w.t = SEASON * 3 + 10;
  V.step(w, 600);
  assert.equal(w.res.grapes, 0, 'vines rest in winter');
  build(s, 'press');
  const p = V.WORKSHOPS.press;
  s.res.grapes = V.WORKSHOP_RESERVE + p.ratio * 5;
  s.res.juice = 0;
  s.built.vineyard.done = false; // no more grapes, to count the press alone
  V.step(s, 5 / p.rate + 1);
  assert.equal(s.res.juice, 5);
  assert.equal(s.res.grapes, V.WORKSHOP_RESERVE, 'the reserve stays for the player');
});

test('the beekeeper and the gardener work except in winter', () => {
  const s = village();
  over(s);
  build(s, 'house4'); build(s, 'house5');
  assert.deepEqual(s.villagers.slice(-2).map((v) => v.role), ['beekeeper', 'gardener']);
  s.res.honey = 0; s.res.apples = 0;
  s.t = 10; // spring
  V.step(s, 600);
  assert.ok(s.res.honey >= 600 * V.VILLAGERS.beekeeper.rate - 1);
  assert.ok(s.res.apples >= 600 * V.VILLAGERS.gardener.rate - 1);
  const h = s.res.honey, a = s.res.apples;
  s.t = SEASON * 3 + 10; // winter
  s.built.apiary.done = false; // only the villagers
  V.step(s, 600);
  assert.equal(s.res.honey, h);
  assert.equal(s.res.apples, a);
});

test('the festival never needs the hamlet', () => {
  for (const id of V.BUILDINGS.chapel.needs) assert.ok(!V.BUILDINGS[id].after, id);
  for (const id of V.BUILDING_IDS) if (V.BUILDINGS[id].after) assert.ok(V.BUILDING_IDS.indexOf(id) > V.BUILDING_IDS.indexOf('chapel'));
});
