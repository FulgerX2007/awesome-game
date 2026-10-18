'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');

const near = (n, x, y, r) => Math.abs(n.x - x) <= r && Math.abs(n.y - y) <= r;
const bridgeTiles = V.FOOTPRINTS.bridge;

test('map is 64×36 with only known tile characters', () => {
  assert.equal(V.W, 64);
  assert.equal(V.H, 36);
  for (const row of V.MAP) {
    assert.equal(row.length, 64);
    assert.match(row, /^[.~:=#bWHASK123FMCGgPR^t]+$/);
  }
  for (const id of Object.keys(V.BUILDINGS)) assert.ok(V.FOOTPRINTS[id].length > 0, `${id} has a footprint`);
});

test('same seed gives the same map, different seeds give different ones', () => {
  const a = V.newGame(1), b = V.newGame(1), c = V.newGame(2);
  assert.deepEqual(a.nodes, b.nodes);
  assert.equal(a.rng, b.rng);
  assert.notDeepEqual(a.nodes.map((n) => [n.x, n.y, n.kind]), c.nodes.map((n) => [n.x, n.y, n.kind]));
});

test('node counts per zone match ZONE_NODES', () => {
  for (const seed of [1, 7, 12345]) {
    const s = V.newGame(seed);
    const counts = {};
    for (const n of s.nodes) {
      const z = V.zoneAt(n.x, n.y);
      counts[z] = counts[z] || {};
      counts[z][n.kind] = (counts[z][n.kind] || 0) + 1;
    }
    assert.deepEqual(counts, V.ZONE_NODES, `seed ${seed}`);
    // Clay only on the east bank.
    for (const n of s.nodes) if (n.kind === 'clay') assert.equal(V.zoneAt(n.x, n.y), 'east');
  }
});

test('nodes avoid paths, sand, square, ruins, the bridge approach and the start', () => {
  for (const seed of [1, 2, 3, 99]) {
    const s = V.newGame(seed);
    for (const n of s.nodes) {
      assert.equal(V.tileAt(n.x, n.y), '.', `node ${n.id} on grass`);
      for (const b of bridgeTiles) assert.ok(!near(n, b.x, b.y, 2), `node ${n.id} near the bridge`);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const c = V.tileAt(n.x + dx, n.y + dy);
        assert.ok(c === null || !/[#WHASK123FMC]/.test(c), `node ${n.id} touches the square or a ruin`);
      }
      assert.ok(!near(n, V.START.x, V.START.y, 1));
      if (V.NODE_KINDS[n.kind].rests && V.NODE_KINDS[n.kind].rests.includes(V.clock(0).season)) {
        assert.equal(n.hp, 0, 'out-of-season fruit starts bare');
        assert.ok(n.regrowAt >= V.DAY * V.SEASON_DAYS, 'and waits for its season');
        continue;
      }
      assert.equal(n.hp, V.NODE_KINDS[n.kind].hp);
      assert.equal(n.regrowAt, null);
    }
  }
});

test('the start tile is walkable, water/ruins/nodes/bridge site block', () => {
  const s = V.newGame(1);
  assert.equal(V.tileAt(V.START.x, V.START.y), '#');
  assert.ok(V.isWalkable(s, V.START.x, V.START.y));
  assert.ok(V.isWalkable(s, s.player.x, s.player.y), 'continuous coordinates are floored');
  assert.equal(V.isWalkable(s, 0, 9), false, 'water');
  const well = V.FOOTPRINTS.well[0];
  assert.equal(V.isWalkable(s, well.x, well.y), false, 'ruin');
  const n = s.nodes[0];
  assert.equal(V.isWalkable(s, n.x, n.y), false, 'standing node');
  n.hp = 0;
  assert.equal(V.isWalkable(s, n.x, n.y), true, 'empty node');
  const b = bridgeTiles[0];
  assert.equal(V.isWalkable(s, b.x, b.y), false, 'bridge site before restoration');
  s.built.bridge.done = true;
  assert.equal(V.isWalkable(s, b.x, b.y), true, 'restored bridge');
  assert.equal(V.isWalkable(s, -1, 0), false);
  assert.equal(V.isWalkable(s, V.W, 0), false);
});

test('all walkable ground is connected with every node standing (bridge and road open)', () => {
  for (const seed of [1, 5, 42]) {
    const s = V.newGame(seed);
    s.built.bridge.done = true;
    s.built.road.done = true;
    const seen = new Set([`${V.START.x},${V.START.y}`]);
    const q = [[V.START.x, V.START.y]];
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${y + dy}`;
        if (!seen.has(k) && V.isWalkable(s, x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); }
      }
    }
    for (let y = 0; y < V.H; y++) for (let x = 0; x < V.W; x++) {
      if (V.isWalkable(s, x, y)) assert.ok(seen.has(`${x},${y}`), `seed ${seed}: ${x},${y} cut off`);
    }
    // Every node has a reachable 4-neighbour to stand on.
    for (const n of s.nodes) {
      const ok = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(`${n.x + dx},${n.y + dy}`));
      assert.ok(ok, `seed ${seed}: node ${n.id} unreachable`);
    }
  }
});

test('zones: east and north are cut off by the river', () => {
  assert.equal(V.zoneAt(V.START.x, V.START.y), 'west');
  assert.equal(V.zoneAt(40, 30), 'east');
  assert.equal(V.zoneAt(5, 3), 'north');
  assert.equal(V.zoneAt(0, 9), null);
});

test('new game state: starting tools, built skeleton, empty events', () => {
  const s = V.newGame(3);
  assert.equal(s.v, V.VERSION);
  assert.deepEqual(s.tools, { axe: 1, pick: 1, shovel: 0, basket: 1 });
  assert.deepEqual(Object.keys(s.built), Object.keys(V.BUILDINGS));
  for (const [id, b] of Object.entries(s.built)) {
    assert.equal(b.done, false);
    assert.deepEqual(Object.keys(b.paid), Object.keys(V.BUILDINGS[id].cost));
  }
  assert.deepEqual(s.events, []);
  assert.equal(s.storage, 50);
  assert.equal(s.festival, false);
  assert.ok(Object.values(s.res).every((v) => v === 0));
});

test('save → load round-trip drops transient fields', () => {
  const s = V.newGame(11);
  s.res.wood = 12; s.res.stone = 3.5;
  s.nodes[4].hp = 0; s.nodes[4].regrowAt = 140;
  s.nodes[5].hp = 2;
  s.built.well.paid.stone = 7;
  s.built.home.done = true; s.built.home.paid = { ...V.BUILDINGS.home.cost };
  s.tools.axe = 2;
  s.t = 99;
  s.player.x = 20.25; s.player.target = { node: 3 }; s.player.path = [[1, 2]]; s.player.cd = 0.3;
  s.events.push({ type: 'hit' });
  s.stats.gathered.wood = 12;

  const data = V.save(s);
  assert.equal(data.events, undefined);
  assert.equal(data.player.target, undefined);
  assert.equal(data.player.path, undefined);
  assert.equal(data.player.cd, undefined);
  assert.ok(JSON.stringify(data).length < 64 * 1024, 'fits the cloud save limit');
  assert.equal(s.player.cd, 0.3, 'save does not touch the live state');

  for (const input of [data, JSON.stringify(data)]) {
    const r = V.load(input);
    assert.equal(r.recovered, undefined);
    assert.deepEqual(V.save(r), data);
    assert.deepEqual(r.events, []);
    assert.equal(r.player.target, null);
    assert.equal(r.player.path, null);
    assert.equal(r.player.cd, 0);
  }
});

test('a full late-game state still fits in 64 KB', () => {
  const s = V.newGame(5);
  for (const id of Object.keys(s.built)) s.built[id].done = true;
  s.festival = true;
  // Every free square tile gets a decoration.
  for (let y = 0; y < V.H; y++) for (let x = 0; x < V.W; x++) if (V.tileAt(x, y) === '#') s.decor.push({ kind: 'bench', x, y });
  assert.ok(s.decor.length > 30);
  s.villagers = [{ role: 'woodcutter', house: 'house1' }, { role: 'mason', house: 'house2' }, { role: 'potter', house: 'house3' }];
  const r = V.load(JSON.stringify(V.save(s)));
  assert.ok(JSON.stringify(V.save(r)).length < 64 * 1024);
  assert.equal(r.villagers.length, 3);
  assert.equal(r.decor.length, s.decor.length);
});

test('load of garbage, null or a foreign version gives a new game with recovered', () => {
  for (const bad of [null, undefined, 42, 'not json{', '[]', [], { v: 99, seed: 1 }, { v: 1 }, { seed: 1 }, '{"v":0,"seed":5}']) {
    const s = V.load(bad);
    assert.equal(s.recovered, true, `input ${JSON.stringify(bad)}`);
    assert.equal(s.v, V.VERSION);
    assert.equal(s.nodes.length, Object.values(V.ZONE_NODES).reduce((a, z) => a + Object.values(z).reduce((b, n) => b + n, 0), 0));
    assert.equal(V.save(s).recovered, undefined, 'the flag is not saved');
  }
});

test('missing fields get defaults and junk is dropped', () => {
  const s = V.load({ v: V.VERSION, seed: 8 });
  const fresh = V.newGame(8);
  assert.equal(s.recovered, undefined);
  assert.deepEqual(V.save(s), V.save(fresh));

  const junk = V.load({
    v: V.VERSION, seed: 8, t: -5, rng: 'x',
    player: { x: 'a', y: 1e9, junk: 'x'.repeat(1000) },
    res: { wood: -3, stone: NaN, clay: '7', berries: 4, gold: 100 },
    tools: { axe: 9, pick: 2, saw: 3, basket: 1.5 },
    nodes: [{ id: 0, kind: 'rock', x: 0, y: 0, hp: 0 }, { id: 1, hp: 99 }, null, 'x', { id: 9999, kind: 'tree' }],
    built: { well: { done: 'yes', paid: { stone: 500, wood: -1, gold: 3 } }, tower: { done: true }, home: null },
    barnLevel: 2,
    villagers: [{ role: 'mason', house: 'house2' }, { role: 'king', house: 'house1' }, { role: 'mason', house: 'house1' }, 5],
    decor: [{ kind: 'bench', x: 3, y: 4 }, { kind: 'bench', x: -1, y: 0 }, { x: 1, y: 1 },
      { kind: 'bench', x: 13, y: 20 }, { kind: 'lantern', x: 13, y: 20 }],
    festival: 'true',
    stats: { gathered: { wood: 5, stone: -1 }, playTime: 'long' },
  });
  assert.equal(junk.recovered, undefined);
  assert.equal(junk.t, 0);
  assert.equal(junk.rng, fresh.rng);
  assert.deepEqual([junk.player.x, junk.player.y], [fresh.player.x, fresh.player.y]);
  assert.equal(junk.player.junk, undefined, 'unknown player keys are dropped');
  assert.equal(V.save(junk).player.junk, undefined);
  assert.deepEqual(junk.res, { wood: 0, stone: 0, clay: 0, berries: 4, planks: 0, bricks: 0, vegetables: 0, honey: 0, apples: 0, coins: 0 });
  assert.deepEqual(junk.tools, { axe: 1, pick: 2, shovel: 0, basket: 1 });
  assert.deepEqual(junk.nodes, fresh.nodes, 'node layout comes from the seed');
  assert.equal(junk.built.well.done, false);
  assert.deepEqual(junk.built.well.paid, { stone: V.BUILDINGS.well.cost.stone, wood: 0 }, 'paid is clamped to the cost');
  assert.equal(junk.built.tower, undefined);
  assert.equal(junk.barnLevel, 0, 'no barn upgrade without the barn');
  assert.equal(junk.storage, 50);
  assert.deepEqual(junk.villagers, [], 'villagers come only from done houses');
  assert.deepEqual(junk.decor, [{ kind: 'bench', x: 13, y: 20 }], 'square tiles only, one per tile');
  assert.equal(junk.festival, false);
  assert.deepEqual(junk.stats.gathered, { wood: 5, stone: 0, clay: 0, berries: 0, planks: 0, bricks: 0, vegetables: 0, honey: 0, apples: 0, coins: 0 });
  assert.equal(junk.stats.playTime, 0);
});

test('a saved position where the player does not fit falls back to the start', () => {
  const s = V.newGame(3);
  const n = s.nodes.find((o) => o.hp > 0);
  const water = { x: 0.5, y: 9.5 };
  assert.equal(V.tileAt(0, 9), '~');
  for (const [x, y] of [[V.W, 5.5], [water.x, water.y], [n.x + 0.5, n.y + 0.5], [-0.5, 3]]) {
    const r = V.load({ v: V.VERSION, seed: 3, player: { x, y } });
    assert.deepEqual([r.player.x, r.player.y], [s.player.x, s.player.y], `${x},${y}`);
  }
  const ok = V.load({ v: V.VERSION, seed: 3, player: { x: 14.5, y: 21.5 } });
  assert.deepEqual([ok.player.x, ok.player.y], [14.5, 21.5]);
});

test('festival and done buildings must agree with the dependencies', () => {
  const fest = V.load({ v: V.VERSION, seed: 3, festival: true });
  assert.equal(fest.festival, false, 'no festival without the chapel');
  const chapel = V.load({ v: V.VERSION, seed: 3, festival: true, built: { chapel: { done: true } } });
  assert.equal(chapel.built.chapel.done, false, 'a building with unmet needs is not done');
  assert.equal(chapel.festival, false);
  assert.equal(V.nextGoal(chapel).type, 'build');
  // A house without its dependencies brings no villager either.
  const house = V.load({ v: V.VERSION, seed: 3, built: { house1: { done: true } }, villagers: [{ role: 'woodcutter', house: 'house1' }] });
  assert.equal(house.built.house1.done, false);
  assert.deepEqual(house.villagers, []);
  // It stays fully paid and is finished by a contribute once its needs are met.
  for (const id of ['home', 'bridge', 'sawmill', 'kiln']) house.built[id].done = true;
  assert.equal(V.contribute(house, 'house1'), 'built');
  assert.deepEqual(house.villagers, [{ role: 'woodcutter', house: 'house1' }]);
  // A consistent chain is kept, and the festival follows the chapel.
  const all = V.newGame(3);
  for (const id of Object.keys(all.built)) all.built[id].done = true;
  const full = V.load({ ...V.save(all), festival: false });
  assert.equal(full.built.chapel.done, true);
  assert.equal(full.festival, true);
  // Villagers: wrong roles, duplicates and junk are dropped; done houses missing one get it back.
  const mixed = V.load({ ...V.save(all), villagers: [{ role: 'mason', house: 'house2' }, { role: 'king', house: 'house1' }, { role: 'mason', house: 'house1' }, { role: 'mason', house: 'house2' }, 5] });
  assert.deepEqual(mixed.villagers, [{ role: 'mason', house: 'house2' }, { role: 'woodcutter', house: 'house1' }, { role: 'potter', house: 'house3' }]);
});

test('a far-future regrow time is clamped to the longest regrowth', () => {
  const s = V.newGame(2);
  const n = s.nodes[10];
  const r = V.load({ v: V.VERSION, seed: 2, t: 50, nodes: [{ id: n.id, kind: n.kind, x: n.x, y: n.y, hp: 0, regrowAt: 1e12 }] });
  assert.equal(r.nodes[10].regrowAt, 50 + V.NODE_KINDS[n.kind].regrow[1]);
  const kept = V.load({ v: V.VERSION, seed: 2, t: 50, nodes: [{ id: n.id, kind: n.kind, x: n.x, y: n.y, hp: 0, regrowAt: 120 }] });
  assert.equal(kept.nodes[10].regrowAt, 120);
});

test('loaded empty nodes keep a regrow time', () => {
  const s = V.newGame(2);
  const n = s.nodes[10];
  const r = V.load({ v: V.VERSION, seed: 2, t: 50, nodes: [{ id: n.id, kind: n.kind, x: n.x, y: n.y, hp: 0 }] });
  assert.equal(r.nodes[10].hp, 0);
  assert.equal(r.nodes[10].regrowAt, 50);
});

test('rand advances the saved generator state deterministically', () => {
  const a = V.newGame(4), b = V.newGame(4);
  const xs = [V.rand(a), V.rand(a)], ys = [V.rand(b), V.rand(b)];
  assert.deepEqual(xs, ys);
  assert.notEqual(xs[0], xs[1]);
  assert.equal(a.rng, b.rng);
  const c = V.load(V.save(a));
  assert.equal(V.rand(c), V.rand(a));
});

test('rng is deterministic, in [0, 1) and exposes its state', () => {
  const a = V.rng(42), b = V.rng(42);
  const xs = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b()));
  for (const x of xs) assert.ok(x >= 0 && x < 1);
  assert.ok(new Set(xs).size > 990, 'values do not repeat early');
  const c = V.rng(a.state());
  assert.equal(c(), a(), 'a generator restarted from state() continues the sequence');
});

test('nodeAt finds nodes by tile and returns null elsewhere', () => {
  const s = V.newGame(6);
  for (const n of s.nodes) assert.equal(V.nodeAt(s, n.x, n.y), n);
  assert.equal(V.nodeAt(s, V.START.x, V.START.y), null);
  assert.equal(V.nodeAt(s, -1, -1), null);
  // A loaded state gets its own lookup, pointing at its own node objects.
  const r = V.load(V.save(s));
  const n = r.nodes[3];
  assert.equal(V.nodeAt(r, n.x, n.y), n);
  assert.notEqual(V.nodeAt(r, n.x, n.y), s.nodes[3]);
});

test('stage: unknown building is 0, restored building is 2', () => {
  const s = V.newGame(1);
  assert.equal(V.stage(s, 'nope'), 0);
  assert.equal(V.share(s, 'well'), 0);
  s.res.stone = 40;
  assert.equal(V.contribute(s, 'well'), 'ok');
  assert.equal(V.share(s, 'well'), 40 / 100);
  s.res.stone = 100; s.res.wood = 100;
  assert.equal(V.contribute(s, 'well'), 'built');
  assert.equal(V.share(s, 'well'), 1);
  assert.equal(V.stage(s, 'well'), 2);
});
