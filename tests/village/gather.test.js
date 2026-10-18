'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');

const DT = 0.05;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Plain BFS distance over isWalkable, as the reference for A*.
function bfsDist(s, from, to) {
  const seen = new Set([`${from.x},${from.y}`]);
  let front = [from];
  for (let d = 0; front.length; d++) {
    const next = [];
    for (const t of front) {
      if (t.x === to.x && t.y === to.y) return d;
      for (const [dx, dy] of DIRS) {
        const n = { x: t.x + dx, y: t.y + dy };
        const k = `${n.x},${n.y}`;
        if (seen.has(k) || !V.isWalkable(s, n.x, n.y)) continue;
        seen.add(k);
        next.push(n);
      }
    }
    front = next;
  }
  return null;
}

function nearest(s, pred) {
  const p = s.player;
  return s.nodes.filter(pred).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
}

function run(s, seconds) {
  for (let i = Math.round(seconds / DT); i > 0; i--) V.step(s, DT);
}

function gatherAll(s, n, limit = 120) {
  assert.equal(V.interact(s, n.x, n.y), 'gather');
  for (let t = 0; t < limit && n.hp > 0; t += DT) V.step(s, DT);
  assert.equal(n.hp, 0, 'node emptied');
}

const westTree = (s) => nearest(s, (n) => n.kind === 'tree' && V.zoneAt(n.x, n.y) === 'west');
const startTile = { x: V.START.x, y: V.START.y };

test('A* finds the shortest path (same length as BFS)', () => {
  const s = V.newGame(1);
  let checked = 0;
  for (let y = 0; y < V.H; y += 3) for (let x = 0; x < V.W; x += 3) {
    if (!V.isWalkable(s, x, y)) continue;
    const path = V.findPath(s, startTile, { x, y });
    const d = bfsDist(s, startTile, { x, y });
    if (d === null) { assert.equal(path, null, `${x},${y} unreachable`); continue; }
    assert.ok(path, `${x},${y} reachable`);
    assert.equal(path.length - 1, d, `${x},${y} shortest`);
    assert.deepEqual(path[0], startTile);
    assert.deepEqual(path[path.length - 1], { x, y });
    for (let i = 1; i < path.length; i++) {
      assert.equal(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y), 1, 'steps are 4-neighbours');
      assert.ok(V.isWalkable(s, path[i].x, path[i].y));
    }
    checked++;
  }
  assert.ok(checked > 50);
  assert.deepEqual(V.findPath(s, startTile, startTile), [startTile]);
});

test('A* returns null for the east bank and the north grove before the bridge, and for water', () => {
  const s = V.newGame(1);
  const east = { x: 40, y: 30 }, north = { x: 20, y: 3 };
  assert.equal(V.zoneAt(east.x, east.y), 'east');
  assert.equal(V.zoneAt(north.x, north.y), 'north');
  assert.equal(V.findPath(s, startTile, east), null);
  assert.equal(V.findPath(s, startTile, north), null);
  assert.equal(V.findPath(s, startTile, { x: 0, y: 9 }), null, 'water');
  assert.equal(V.goTo(s, east.x, east.y), false);
  assert.equal(V.interact(s, east.x, east.y), 'none');
  s.built.bridge.done = true;
  assert.ok(V.findPath(s, startTile, east));
  assert.ok(V.findPath(s, startTile, north));
});

test('goTo walks the player to the tile centre', () => {
  const s = V.newGame(1);
  assert.equal(V.goTo(s, 20, 30), true);
  run(s, 20);
  assert.equal(s.player.x, 20.5);
  assert.equal(s.player.y, 30.5);
  assert.equal(s.player.path, null);
});

test('moveDir moves by velocity, slides along walls and stops on (0, 0)', () => {
  const s = V.newGame(1);
  const x0 = s.player.x;
  V.moveDir(s, 1, 0);
  run(s, 0.5);
  assert.ok(Math.abs(s.player.x - (x0 + V.SPEED * 0.5)) < 1e-6, 'moved at SPEED');
  V.moveDir(s, 0, 0);
  const x1 = s.player.x;
  run(s, 0.5);
  assert.equal(s.player.x, x1, 'stopped');

  // Walk up into the river: the player stops at the bank and never enters water.
  const t = V.newGame(1);
  t.player.x = 3.5; t.player.y = 13.5;
  V.moveDir(t, 0, -1);
  run(t, 3);
  assert.ok(V.isWalkable(t, t.player.x, t.player.y - 0.3));
  assert.ok(t.player.y > 11 && t.player.y < 12, `stopped at the bank (${t.player.y})`);
  // Diagonal into the river: blocked on y, keeps sliding on x.
  const xb = t.player.x;
  V.moveDir(t, 1, -1);
  run(t, 0.5);
  assert.ok(t.player.x > xb + 1, 'slides along the bank');
  assert.ok(t.player.y > 11);
});

test('gathering a tree adds wood by axe level, emits hit/deplete events and stats', () => {
  const s = V.newGame(1);
  const n = westTree(s);
  gatherAll(s, n);
  assert.equal(s.res.wood, V.NODE_KINDS.tree.hp);
  assert.equal(s.stats.gathered.wood, V.NODE_KINDS.tree.hp);
  const hits = s.events.filter((e) => e.type === 'hit');
  assert.equal(hits.length, V.NODE_KINDS.tree.hp);
  assert.deepEqual(hits[0], { type: 'hit', kind: 'tree', res: 'wood', gain: 1, id: n.id, x: n.x, y: n.y });
  const dep = s.events.filter((e) => e.type === 'deplete');
  assert.equal(dep.length, 1);
  assert.equal(dep[0].id, n.id);
  assert.equal(s.player.target, null, 'gathering ends with the node');
  assert.ok(V.isWalkable(s, n.x, n.y), 'an empty node no longer blocks');

  const t = V.newGame(1);
  t.tools.axe = 2;
  gatherAll(t, westTree(t));
  assert.equal(t.res.wood, 2 * V.NODE_KINDS.tree.hp);
});

test('hits follow the tool cooldown', () => {
  for (const level of [1, 2, 3]) {
    const s = V.newGame(1);
    s.tools.axe = level;
    const n = westTree(s);
    V.interact(s, n.x, n.y);
    const times = [];
    for (let t = 0; t < 30 && n.hp > 0; t += DT) {
      V.step(s, DT);
      for (const e of s.events.splice(0)) if (e.type === 'hit') times.push(s.t);
    }
    assert.equal(times.length, V.NODE_KINDS.tree.hp, `level ${level} hits`);
    assert.equal(n.hp, 0);
    for (let i = 1; i < times.length; i++) {
      assert.ok(Math.abs(times[i] - times[i - 1] - V.TOOL_CD[level]) < DT + 1e-6, `level ${level} gap`);
    }
  }
});

test('a new order cancels gathering', () => {
  const s = V.newGame(1);
  const n = westTree(s);
  V.interact(s, n.x, n.y);
  run(s, 3);
  const hp = n.hp;
  assert.ok(hp < V.NODE_KINDS.tree.hp && hp > 0);
  V.moveDir(s, -1, 0);
  assert.equal(s.player.target, null);
  run(s, 2);
  assert.equal(n.hp, hp);

  const t = V.newGame(1);
  const m = westTree(t);
  V.interact(t, m.x, m.y);
  run(t, 2);
  assert.equal(V.goTo(t, V.START.x, V.START.y), true);
  assert.equal(t.player.target, null);
  const hp2 = m.hp;
  run(t, 3);
  assert.equal(m.hp, hp2);
});

test('interact: a ruin walks up and emits a ruin event, missing tool refuses, plain tile walks', () => {
  const s = V.newGame(1);
  const well = V.FOOTPRINTS.well[0];
  assert.equal(V.interact(s, well.x, well.y), 'ruin');
  run(s, 10);
  assert.deepEqual(s.events.filter((e) => e.type === 'ruin'), [{ type: 'ruin', id: 'well' }]);
  assert.equal(s.player.target, null);

  const t = V.newGame(1);
  t.built.bridge.done = true;
  const clay = t.nodes.find((n) => n.kind === 'clay');
  assert.equal(V.interact(t, clay.x, clay.y), 'tool', 'no shovel before it is given');
  t.tools.shovel = 1;
  assert.equal(V.interact(t, clay.x, clay.y), 'gather');
  assert.equal(V.interact(t, 20, 30), 'walk');
  assert.equal(V.interact(t, 0, 9), 'none', 'water');
});

test('an empty node regrows after its regrow time (NODE_KINDS.regrow)', () => {
  const s = V.newGame(1);
  const n = westTree(s);
  gatherAll(s, n);
  const [lo, hi] = V.NODE_KINDS.tree.regrow;
  assert.ok(n.regrowAt >= s.t + lo - 1e-9 && n.regrowAt <= s.t + hi, 'regrowAt in range');
  V.goTo(s, V.START.x, V.START.y);
  s.events.length = 0;
  while (s.t < n.regrowAt - 0.1) V.step(s, DT);
  assert.equal(n.hp, 0, 'not before regrowAt');
  run(s, 0.2);
  assert.equal(n.hp, V.NODE_KINDS.tree.hp);
  assert.equal(n.regrowAt, null);
  assert.deepEqual(s.events.filter((e) => e.type === 'regrow').map((e) => e.id), [n.id]);
  assert.equal(V.isWalkable(s, n.x, n.y), false);
});

test('regrowth times differ between nodes and come from the seed', () => {
  const a = V.newGame(5), b = V.newGame(5);
  const picked = (m) => V.zoneAt(m.x, m.y) === 'west' && m.kind !== 'apple'; // apples wait for summer anyway
  for (const s of [a, b]) for (const n of s.nodes.filter(picked).slice(0, 3)) {
    gatherAll(s, n);
  }
  const ra = a.nodes.filter((n) => n.hp === 0 && n.kind !== 'apple').map((n) => n.regrowAt);
  const rb = b.nodes.filter((n) => n.hp === 0 && n.kind !== 'apple').map((n) => n.regrowAt);
  assert.equal(ra.length, 3);
  assert.deepEqual(ra, rb);
  assert.ok(new Set(ra.map((v) => Math.round(v))).size > 1);
});

test('a node does not regrow under the player', () => {
  const s = V.newGame(1);
  const n = westTree(s);
  gatherAll(s, n);
  V.goTo(s, n.x, n.y);
  run(s, 3);
  assert.equal(Math.floor(s.player.x), n.x);
  assert.equal(Math.floor(s.player.y), n.y);
  const due = n.regrowAt;
  while (s.t < due + 5) V.step(s, DT);
  assert.equal(n.hp, 0, 'still empty while the player stands there');
  const back = DIRS.map(([dx, dy]) => ({ x: n.x + dx, y: n.y + dy })).find((t) => V.isWalkable(s, t.x, t.y));
  V.goTo(s, back.x, back.y);
  run(s, 5);
  assert.equal(n.hp, V.NODE_KINDS.tree.hp, 'regrows once the player steps off');
});

test('a node regrowing on the path makes the player go around', () => {
  const s = V.newGame(1);
  const n = westTree(s);
  gatherAll(s, n);
  // Stand on one side of the stump and walk across it as it regrows.
  const sides = [[[-1, 0], [1, 0]], [[0, -1], [0, 1]]]
    .map(([a, b]) => [{ x: n.x + a[0], y: n.y + a[1] }, { x: n.x + b[0], y: n.y + b[1] }])
    .find(([a, b]) => V.isWalkable(s, a.x, a.y) && V.isWalkable(s, b.x, b.y));
  V.goTo(s, sides[0].x, sides[0].y);
  run(s, 10);
  while (s.t + DT < n.regrowAt) V.step(s, DT);
  V.goTo(s, sides[1].x, sides[1].y);
  assert.ok(s.player.path.some((t) => t.x === n.x && t.y === n.y), 'the path crosses the stump');
  run(s, 10);
  assert.equal(n.hp, V.NODE_KINDS.tree.hp);
  assert.equal(s.player.x, sides[1].x + 0.5);
  assert.equal(s.player.y, sides[1].y + 0.5);
});

test('every zone and every node stays reachable after forced regrowth of all nodes', () => {
  for (const seed of [1, 2, 3]) {
    const s = V.newGame(seed);
    s.built.bridge.done = true;
    for (const n of s.nodes) { n.hp = V.NODE_KINDS[n.kind].hp; n.regrowAt = null; }
    const zones = new Set();
    for (const n of s.nodes) {
      const ok = DIRS.some(([dx, dy]) => {
        const x = n.x + dx, y = n.y + dy;
        return V.isWalkable(s, x, y) && V.findPath(s, startTile, { x, y });
      });
      assert.ok(ok, `seed ${seed}: node ${n.id} reachable`);
      zones.add(V.zoneAt(n.x, n.y));
    }
    assert.deepEqual([...zones].sort(), ['east', 'north', 'west']);
    for (const id of Object.keys(V.BUILDINGS)) {
      const ok = V.FOOTPRINTS[id].some((f) => DIRS.some(([dx, dy]) => {
        const x = f.x + dx, y = f.y + dy;
        return V.isWalkable(s, x, y) && V.findPath(s, startTile, { x, y });
      }));
      assert.ok(ok, `seed ${seed}: ruin ${id} reachable`);
    }
  }
});

test('upgradeTool: costs, dependencies and return codes', () => {
  const s = V.newGame(1);
  assert.equal(V.upgradeTool(s, 'hammer'), 'unknown');
  assert.equal(V.upgradeTool(s, 'axe'), 'locked', 'level 2 needs home');
  s.built.home.done = true;
  assert.equal(V.upgradeTool(s, 'axe'), 'cost');
  const c2 = V.TOOLS.axe.costs[2], c3 = V.TOOLS.axe.costs[3];
  s.res.stone = c2.stone; s.res.wood = c2.wood + 2;
  assert.equal(V.canAfford(s, c2), true);
  assert.equal(V.upgradeTool(s, 'axe'), 'ok');
  assert.equal(s.tools.axe, 2);
  assert.equal(s.res.stone, 0);
  assert.equal(s.res.wood, 2);
  assert.deepEqual(s.events, [{ type: 'tool', tool: 'axe', level: 2 }]);

  s.res.bricks = 200; s.res.planks = 200;
  assert.equal(V.upgradeTool(s, 'axe'), 'locked', 'level 3 needs the forge');
  s.built.forge.done = true;
  assert.equal(V.upgradeTool(s, 'axe'), 'ok');
  assert.equal(s.tools.axe, 3);
  assert.equal(s.res.bricks, 200 - c3.bricks);
  assert.equal(s.res.planks, 200 - c3.planks);
  assert.equal(V.upgradeTool(s, 'axe'), 'max');

  // The shovel can't be upgraded before the bridge gives it.
  s.res.wood = V.TOOLS.shovel.costs[2].wood;
  assert.equal(V.upgradeTool(s, 'shovel'), 'locked');
  s.tools.shovel = 1;
  assert.equal(V.upgradeTool(s, 'shovel'), 'ok');
  assert.equal(s.tools.shovel, 2);

  const t = V.newGame(1);
  t.built.home.done = true;
  t.res.wood = V.TOOLS.basket.costs[2].wood - 1;
  assert.equal(V.upgradeTool(t, 'basket'), 'cost');
  assert.equal(t.res.wood, V.TOOLS.basket.costs[2].wood - 1, 'nothing taken on failure');
  assert.equal(t.tools.basket, 1);
  assert.deepEqual(t.events, []);
});

test('step splits long intervals and is deterministic; save drops the transient order', () => {
  const a = V.newGame(3), b = V.newGame(3);
  for (const s of [a, b]) { const n = westTree(s); V.interact(s, n.x, n.y); }
  V.step(a, 4);
  run(b, 4);
  assert.ok(Math.abs(a.t - b.t) < 1e-6);
  assert.deepEqual(a.res, b.res);
  assert.ok(Math.abs(a.player.x - b.player.x) < 1e-6 && Math.abs(a.player.y - b.player.y) < 1e-6);

  V.moveDir(a, 1, 0);
  const n = westTree(a);
  V.interact(a, n.x, n.y);
  a.player.cd = 0.3;
  const out = V.save(a);
  for (const k of ['target', 'path', 'cd', 'dir']) assert.ok(!(k in out.player), k);
  const back = V.load(out);
  assert.equal(back.player.target, null);
  assert.equal(back.player.dir, null);
});

test('regrowth survives save/load', () => {
  const s = V.newGame(1);
  const n = westTree(s);
  gatherAll(s, n);
  V.goTo(s, V.START.x, V.START.y);
  run(s, 5);
  const t = V.load(JSON.stringify(V.save(s)));
  const m = t.nodes[n.id];
  assert.equal(m.hp, 0);
  while (t.t < m.regrowAt + 0.1) V.step(t, DT);
  assert.equal(m.hp, V.NODE_KINDS.tree.hp);
});

// ── Seasons ──
const WINTER = V.DAY * V.SEASON_DAYS * 3; // winter starts here in the first year
const SPRING2 = V.DAY * V.SEASON_DAYS * 4;

function emptyBush(s, at) {
  const b = s.nodes.find((n) => n.kind === 'bush');
  b.hp = 0;
  b.regrowAt = at;
  return b;
}

test('a bush due in winter waits for spring; other nodes regrow as usual', () => {
  const s = V.newGame(5);
  s.t = WINTER + 100;
  const bush = emptyBush(s, WINTER + 200);
  const tree = s.nodes.find((n) => n.kind === 'tree');
  tree.hp = 0; tree.regrowAt = WINTER + 200;
  V.step(s, 200);
  assert.equal(bush.hp, 0, 'no berries in winter');
  assert.ok(bush.regrowAt >= SPRING2 && bush.regrowAt < SPRING2 + 60, `back early in spring (${bush.regrowAt})`);
  assert.equal(tree.hp, V.NODE_KINDS.tree.hp, 'trees still grow back');
  V.step(s, bush.regrowAt - s.t + 1);
  assert.equal(bush.hp, V.NODE_KINDS.bush.hp, 'berries are back in spring');
});

test('a bush that regrew before winter keeps its berries through it', () => {
  const s = V.newGame(5);
  s.t = WINTER - 50;
  const bush = emptyBush(s, WINTER - 10);
  V.step(s, 100);
  assert.equal(bush.hp, V.NODE_KINDS.bush.hp);
});

test('offline through winter regrows bushes exactly as step() does', () => {
  const make = () => {
    const s = V.newGame(6);
    s.t = WINTER - 300;
    const bushes = s.nodes.filter((n) => n.kind === 'bush').slice(0, 4);
    bushes.forEach((b, i) => { b.hp = 0; b.regrowAt = WINTER - 200 + i * 150; }); // two before winter, two in it
    return s;
  };
  const a = make(), b = make();
  const span = SPRING2 - WINTER + 800;
  const r = V.offline(a, span);
  V.step(b, span);
  const hp = (s) => s.nodes.filter((n) => n.kind === 'bush').slice(0, 4).map((n) => n.hp);
  assert.deepEqual(hp(a), hp(b));
  assert.ok(r.regrown >= 4);
});
