'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');

const DT = 0.05;

function run(s, seconds) {
  for (let i = Math.round(seconds / DT); i > 0; i--) V.step(s, DT);
}

// Mark buildings done directly, with their effects, the way a finished contribution would.
function finish(s, ...ids) {
  for (const id of ids) {
    if (s.built[id].done) continue;
    for (const [r, n] of Object.entries(V.BUILDINGS[id].cost)) s.res[r] += n;
    s.built[id].paid = Object.fromEntries(Object.keys(V.BUILDINGS[id].cost).map((r) => [r, 0]));
    for (const d of V.BUILDINGS[id].needs) if (!s.built[d].done) finish(s, d);
    assert.equal(V.contribute(s, id), 'built', id);
  }
}

const ALL_BUT_CHAPEL = Object.keys(V.BUILDINGS).filter((id) => id !== 'chapel');

test('contribute: partial then full contribution, stages and events', () => {
  const s = V.newGame(1);
  assert.equal(V.stage(s, 'well'), 0);
  s.res.stone = 12;
  s.res.wood = 3;
  assert.equal(V.contribute(s, 'well'), 'ok');
  assert.deepEqual(s.built.well.paid, { stone: 12, wood: 3 });
  assert.deepEqual([s.res.stone, s.res.wood], [0, 0]);
  assert.equal(V.stage(s, 'well'), 1);
  assert.deepEqual(s.events.at(-1), { type: 'contribute', id: 'well', given: { stone: 12, wood: 3 }, stage: 1 });
  assert.equal(V.contribute(s, 'well'), 'none', 'nothing to add');

  const cost = V.BUILDINGS.well.cost;
  s.res.stone = 100;
  s.res.wood = 100;
  s.events.length = 0;
  assert.equal(V.contribute(s, 'well'), 'built');
  assert.deepEqual([s.res.stone, s.res.wood], [100 - (cost.stone - 12), 100 - (cost.wood - 3)],
    'only what is still needed is taken');
  assert.equal(s.built.well.done, true);
  assert.equal(V.stage(s, 'well'), 2);
  assert.deepEqual(s.events.map((e) => e.type), ['contribute', 'built']);
  assert.equal(s.events[1].effect, 'square');
  assert.equal(V.contribute(s, 'well'), 'done');
  assert.equal(V.contribute(s, 'tower'), 'unknown');
});

test('contribute is blocked by dependencies', () => {
  const s = V.newGame(1);
  for (const r of Object.keys(s.res)) s.res[r] = 1000;
  assert.equal(V.contribute(s, 'barn'), 'locked');
  assert.equal(V.contribute(s, 'bridge'), 'locked');
  assert.equal(V.contribute(s, 'chapel'), 'locked');
  assert.equal(s.res.wood, 1000, 'nothing is taken when locked');
  assert.equal(V.contribute(s, 'well'), 'built');
  assert.equal(V.contribute(s, 'barn'), 'built');
  const s2 = V.newGame(1);
  finish(s2, ...ALL_BUT_CHAPEL.filter((id) => id !== 'house3'));
  for (const r of Object.keys(s2.res)) s2.res[r] = 1000;
  assert.equal(V.contribute(s2, 'chapel'), 'locked', 'the chapel needs every other building');
});

test('the bridge opens the east bank and the north grove and gives the shovel', () => {
  const s = V.newGame(1);
  const clay = s.nodes.find((n) => n.kind === 'clay');
  const north = s.nodes.find((n) => V.zoneAt(n.x, n.y) === 'north');
  assert.equal(s.tools.shovel, 0);
  assert.equal(V.interact(s, clay.x, clay.y), 'tool');
  const bridge = V.FOOTPRINTS.bridge[0];
  assert.equal(V.isWalkable(s, bridge.x, bridge.y), false);
  finish(s, 'bridge');
  assert.equal(V.isWalkable(s, bridge.x, bridge.y), true);
  assert.equal(s.tools.shovel, 1);
  assert.equal(V.interact(s, clay.x, clay.y), 'gather');
  assert.notEqual(V.findPath(s, s.player, { x: north.x + 1, y: north.y }) || V.findPath(s, s.player, { x: north.x - 1, y: north.y }), null);
});

test('barn and its upgrade raise the storage limit', () => {
  const s = V.newGame(1);
  assert.equal(s.storage, 50);
  assert.equal(V.upgradeBarn(s), 'locked');
  finish(s, 'barn');
  assert.equal(s.storage, 150);
  assert.equal(s.barnLevel, 1);
  s.res.planks = 99;
  s.res.bricks = 40;
  assert.equal(V.upgradeBarn(s), 'cost');
  s.res.planks = 100;
  assert.equal(V.upgradeBarn(s), 'ok');
  assert.deepEqual([s.storage, s.barnLevel, s.res.planks, s.res.bricks], [400, 2, 0, 0]);
  assert.equal(s.events.at(-1).type, 'built');
  assert.equal(V.upgradeBarn(s), 'max');
  const r = V.load(V.save(s));
  assert.equal(r.storage, 400);
});

test('houses bring villagers who produce their resource; the mill speeds them up', () => {
  const s = V.newGame(1);
  finish(s, 'house1');
  assert.deepEqual(s.villagers, [{ role: 'woodcutter', house: 'house1' }]);
  s.res.wood = 0;
  run(s, 10);
  const rate = V.VILLAGERS.woodcutter.rate;
  assert.equal(s.res.wood, Math.floor(rate * 10 + 1e-9));
  finish(s, 'house2', 'mill');
  assert.equal(s.villagers.length, 2);
  s.res.wood = 0;
  s.res.stone = 0;
  s.acc = {};
  run(s, 20);
  assert.equal(s.res.wood, Math.floor(rate * V.MILL_BONUS * 20 + 1e-9));
  assert.equal(s.res.stone, Math.floor(V.VILLAGERS.mason.rate * V.MILL_BONUS * 20 + 1e-9));
  finish(s, 'house3');
  assert.deepEqual(s.villagers.map((v) => v.role), ['woodcutter', 'mason', 'potter']);
});

test('the forge unlocks level 3 tools', () => {
  const s = V.newGame(1);
  finish(s, 'home');
  Object.assign(s.res, V.TOOLS.axe.costs[2]);
  assert.equal(V.upgradeTool(s, 'axe'), 'ok');
  Object.assign(s.res, V.TOOLS.axe.costs[3]);
  assert.equal(V.upgradeTool(s, 'axe'), 'locked');
  finish(s, 'forge');
  Object.assign(s.res, V.TOOLS.axe.costs[3]);
  assert.equal(V.upgradeTool(s, 'axe'), 'ok');
  assert.equal(s.tools.axe, 3);
});

test('the chapel starts the festival', () => {
  const s = V.newGame(1);
  finish(s, ...ALL_BUT_CHAPEL);
  assert.equal(s.festival, false);
  s.events.length = 0;
  finish(s, 'chapel');
  assert.equal(s.festival, true);
  assert.deepEqual(s.events.map((e) => e.type), ['contribute', 'built', 'festival']);
  assert.equal(V.load(V.save(s)).festival, true);
});

test('workshops keep the reserve and stop at the output limit', () => {
  const s = V.newGame(1);
  finish(s, 'sawmill', 'kiln');
  s.res.wood = 40;
  s.res.clay = 31;
  s.res.planks = 0;
  s.res.bricks = 0;
  run(s, 120);
  assert.equal(s.res.wood, V.WORKSHOP_RESERVE, 'the sawmill only takes wood above the reserve');
  assert.equal(s.res.planks, 5);
  assert.equal(s.res.clay, 31, 'one unit above the reserve is not enough for a brick');
  assert.equal(s.res.bricks, 0);

  s.res.wood = 1000;
  s.res.planks = 48;
  run(s, 120);
  assert.equal(s.res.planks, s.storage, 'the sawmill stops at the storage limit');
  assert.equal(s.res.wood, 1000 - 2 * 2);
  run(s, 60);
  assert.equal(s.res.planks, 50);
  s.res.planks = 40;
  run(s, 4);
  assert.ok(s.res.planks <= 42, 'no burst after a long block');
});

test('house1 (more planks than the storage limit) is finished with no barn through partial contributions', () => {
  const s = V.newGame(1);
  finish(s, 'sawmill', 'kiln');
  assert.equal(s.barnLevel, 0);
  const need = V.BUILDINGS.house1.cost.planks;
  assert.ok(need > s.storage, 'the cost is above the starting limit');
  s.res.bricks = V.BUILDINGS.house1.cost.bricks;
  s.res.planks = 0;
  s.res.wood = 1000;
  let paid = 0;
  while (paid + s.storage < need) {
    run(s, 400);
    assert.equal(s.res.planks, 50, 'the sawmill stops at the limit');
    assert.equal(V.contribute(s, 'house1'), 'ok');
    paid += 50;
    assert.equal(s.built.house1.paid.planks, paid);
  }
  run(s, 400);
  assert.equal(V.contribute(s, 'house1'), 'built');
  assert.equal(s.villagers.length, 1);
});

test('the storage limit does not cut hand gathering, only automatic income', () => {
  const s = V.newGame(1);
  finish(s, 'house1');
  s.built.sawmill.done = false; // keep the sawmill from eating the wood
  s.res.wood = 60;
  run(s, 30);
  assert.equal(s.res.wood, 60, 'the woodcutter stops above the limit');
  const tree = s.nodes.find((n) => n.kind === 'tree' && V.interact(s, n.x, n.y) === 'gather');
  for (let i = 0; i < 2400 && tree.hp > 0; i++) V.step(s, DT);
  assert.equal(tree.hp, 0);
  assert.equal(s.res.wood, 60 + V.NODE_KINDS.tree.hp, 'hand gathering goes over the limit');
});

test('offline: caps at 8 h, is deterministic and regrows nodes', () => {
  const make = () => {
    const s = V.newGame(3);
    finish(s, 'house1', 'sawmill', 'kiln', 'barn');
    V.upgradeBarn(Object.assign(s, { res: { ...s.res, planks: 100, bricks: 40 } }));
    s.res.wood = 0;
    s.res.clay = 200;
    s.nodes[0].hp = 0;
    s.nodes[0].regrowAt = s.t + 100;
    s.events.length = 0;
    return s;
  };
  const a = make(), b = make();
  const t0 = a.t;
  const ra = V.offline(a, 3600);
  const rb = V.offline(b, 3600);
  assert.deepEqual(ra, rb);
  assert.deepEqual(V.save(a), V.save(b));
  assert.equal(ra.seconds, 3600);
  assert.equal(a.t, t0 + 3600);
  assert.equal(ra.regrown, 1);
  assert.equal(a.nodes[0].hp, V.NODE_KINDS[a.nodes[0].kind].hp);
  assert.deepEqual(a.events, [], 'no burst of regrow events');
  assert.ok(ra.gains.bricks > 0);
  assert.ok(ra.gains.clay < 0);
  assert.ok(a.res.clay >= V.WORKSHOP_RESERVE);

  const c = make(), d = make();
  const rc = V.offline(c, 100 * 3600);
  const rd = V.offline(d, V.OFFLINE_MAX);
  assert.equal(rc.seconds, V.OFFLINE_MAX);
  assert.deepEqual(rc, rd);
  assert.equal(V.offline(make(), -5).seconds, 0);
  assert.equal(V.offline(make(), 'x').seconds, 0);
  assert.deepEqual(V.offline(make(), 0).gains, {});
});

test('offline matches step for automatic income', () => {
  const a = V.newGame(4);
  finish(a, 'house1', 'house2');
  a.res.wood = 0; a.res.stone = 0;
  const b = V.load(V.save(a));
  V.offline(a, 200);
  run(b, 200);
  assert.equal(a.res.wood, b.res.wood);
  assert.equal(a.res.stone, b.res.stone);
});

test('nextGoal skips a building that needs planks or bricks until their workshop works', () => {
  const s = V.newGame(1);
  finish(s, 'kiln');
  // The forge needs only the kiln, but it also costs planks: with no sawmill it can't be paid.
  s.built.forge.paid.stone = V.BUILDINGS.forge.cost.stone;
  s.built.forge.paid.bricks = V.BUILDINGS.forge.cost.bricks;
  assert.notDeepEqual(V.nextGoal(s), { type: 'build', id: 'forge' });
  s.res.planks = V.BUILDINGS.forge.cost.planks; // planks already in stock are fine
  assert.deepEqual(V.nextGoal(s), { type: 'build', id: 'forge' });
  s.res.planks = 0;
  finish(s, 'sawmill');
  assert.deepEqual(V.nextGoal(s), { type: 'build', id: 'forge' });
});

test('nextGoal: the cheapest available building, then decorations after the festival', () => {
  const s = V.newGame(1);
  assert.deepEqual(V.nextGoal(s), { type: 'build', id: 'well' });
  finish(s, 'well');
  assert.deepEqual(V.nextGoal(s), { type: 'build', id: 'home' });
  // Pay the barn until less is left than for the home.
  const homeLeft = Object.values(V.BUILDINGS.home.cost).reduce((a, n) => a + n, 0);
  s.res.wood = Object.values(V.BUILDINGS.barn.cost).reduce((a, n) => a + n, 0) - homeLeft + 1;
  s.res.stone = 0;
  V.contribute(s, 'barn');
  assert.deepEqual(V.nextGoal(s), { type: 'build', id: 'barn' }, 'what is left to pay counts');
  const t = V.newGame(1);
  finish(t, 'bridge');
  t.tools.shovel = 0;
  t.built.sawmill.done = true;
  t.built.well.done = true;
  t.built.barn.done = true;
  t.built.forge.done = true; // leaves the kiln (needs clay) as the cheapest
  assert.deepEqual(V.nextGoal(t), { type: 'tool', tool: 'shovel' });
  finish(s, ...ALL_BUT_CHAPEL, 'chapel');
  assert.deepEqual(V.nextGoal(s), { type: 'decor' });
});

test('placeDecor: only after the festival, on free square tiles, for resources', () => {
  const s = V.newGame(1);
  const sq = [];
  for (let y = 0; y < V.H; y++) for (let x = 0; x < V.W; x++) if (V.tileAt(x, y) === '#') sq.push({ x, y });
  const [a, b] = sq;
  s.res.planks = 100; s.res.stone = 100; s.res.berries = 100;
  assert.equal(V.placeDecor(s, 'bench', a.x, a.y), 'locked');
  s.festival = true;
  assert.equal(V.placeDecor(s, 'statue', a.x, a.y), 'unknown');
  assert.equal(V.placeDecor(s, 'bench', a.x, a.y), 'ok');
  assert.equal(s.res.planks, 100 - V.DECOR.bench.cost.planks);
  assert.deepEqual(s.events.at(-1), { type: 'decor', kind: 'bench', x: a.x, y: a.y });
  assert.equal(V.placeDecor(s, 'lantern', a.x, a.y), 'occupied', 'an occupied tile is refused');
  const grass = { x: 0, y: 0 };
  assert.equal(V.placeDecor(s, 'lantern', grass.x, grass.y), 'occupied', 'only square tiles');
  s.res.berries = 0;
  assert.equal(V.placeDecor(s, 'bed', b.x, b.y), 'cost');
  assert.equal(s.decor.length, 1);
  assert.deepEqual(V.load(V.save(s)).decor, s.decor);
});

test('load restores effects of done buildings and production progress', () => {
  const s = V.newGame(6);
  finish(s, 'barn', 'bridge', 'house1');
  const data = V.save(s);
  data.villagers = [];
  data.barnLevel = 0;
  data.tools.shovel = 0;
  data.acc = { house1: 0.5, junk: 3, sawmill: 'x' };
  const r = V.load(data);
  assert.deepEqual(r.villagers, [{ role: 'woodcutter', house: 'house1' }]);
  assert.equal(r.storage, 150);
  assert.equal(r.tools.shovel, 1);
  assert.deepEqual(r.acc, { house1: 0.5 });
});
