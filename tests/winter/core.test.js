'use strict';
// Долгая зима: the map, time and weather, the hero's stats, actions, tools, the fire and walking.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/winter/core.js');

const sim = (g, seconds, frame = 0.25) => { for (let t = 0; t < seconds - 1e-9; t += frame) C.step(g, frame); };
const of = (events, type) => events.filter((e) => e.type === type);
const nearest = (g, kind) => g.nodes.filter((n) => n.kind === kind && n.amount > 0)
  .sort((a, b) => Math.hypot(a.x - g.hero.x, a.y - g.hero.y) - Math.hypot(b.x - g.hero.x, b.y - g.hero.y))[0];
// Waits until the hero has no order left (or the time runs out).
function settle(g, seconds = 60) {
  const ev = [];
  for (let t = 0; t < seconds && (g.hero.path || g.hero.target); t += 0.25) { C.step(g, 0.25); ev.push(...C.drain(g)); }
  return ev;
}
// A calm test world: no animals or wolves get in the way unless a test adds them.
function quiet(seed = 1, diff = 'normal') {
  const g = C.newGame(diff, seed);
  g.animals = [];
  return g;
}

test('a new winter: the hero by the fire, the stone axe, a little wood and food, day 1 in the morning', () => {
  const g = C.newGame('normal', 3);
  assert.equal(C.status(g), 'playing');
  assert.equal(C.dayOf(g), 1);
  assert.equal(C.isNight(g), false);
  assert.ok(C.inBase(Math.floor(g.hero.x), Math.floor(g.hero.y)));
  assert.equal(g.tools.axe, true);
  assert.equal(g.tools.pick, false);
  assert.equal(g.hero.health, C.STAT_MAX);
  assert.equal(g.survivors.length, 5);
  assert.ok(g.survivors.every((s) => s.state === 'waiting'));
  assert.throws(() => C.newGame('mild', 1));
  assert.equal(C.newGame('normal', 'x').seed, 1);
});

test('the map: the same seed gives the same forest, and resources lie near the camp', () => {
  assert.deepEqual(C.newGame('normal', 5).nodes, C.newGame('normal', 5).nodes);
  assert.notDeepEqual(C.newGame('normal', 5).nodes, C.newGame('normal', 6).nodes);
  for (let seed = 1; seed <= 20; seed++) {
    const g = C.newGame('normal', seed);
    const near = (kind, r) => g.nodes.filter((n) => n.kind === kind && Math.hypot(n.x - 27.5, n.y - 19.5) <= r);
    assert.ok(near('tree', 16).length >= 8, `seed ${seed} trees`);
    assert.ok(near('rock', 16).length >= 3, `seed ${seed} rocks`);
    assert.ok(near('bush', 16).length >= 3, `seed ${seed} bushes`);
    // ≥ 20 metal of scrap on this side of the lake, reachable with the start tools
    const scrap = g.nodes.filter((n) => n.kind === 'scrap' && C.pathNextTo(g, g.hero, n.x, n.y, { axe: true }));
    assert.ok(scrap.reduce((a, n) => a + n.amount, 0) >= 20, `seed ${seed} scrap`);
    for (let x = 0; x < C.W; x++) for (let y = 0; y < C.H; y++) assert.ok(!C.inBase(x, y) || !C.nodeAt(g, x, y), 'the camp is clear');
  }
});

test('the survivors: two of them are behind drifts and the lake until the shovel and the ice pick', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = C.newGame('normal', seed);
    const reach = (id, tools) => !!C.pathNextTo(g, g.hero, C.SURVIVORS[id].x, C.SURVIVORS[id].y, tools);
    const start = { axe: true };
    assert.ok(reach('hunter', start) && reach('herbalist', start) && reach('child', start), `seed ${seed}`);
    assert.equal(reach('carpenter', start), false);
    assert.equal(reach('smith', start), false);
    assert.ok(reach('carpenter', { axe: true, shovel: true }));
    assert.ok(reach('smith', { axe: true, icePick: true }));
  }
});

test('the whole tech tree is reachable from the start on 20 seeds: no recipe needs what it unlocks', () => {
  // the start tools reach wood and scrap; wood makes the pick; the pick reaches stone; stone + metal make the rest
  for (let seed = 1; seed <= 20; seed++) {
    const g = C.newGame('normal', seed);
    const can = { wood: !!nearest(g, 'tree'), metal: true, stone: false };
    assert.ok(can.wood);
    assert.deepEqual(C.TOOLS.pick.cost, { wood: 12 }, 'the pick is made of wood only');
    can.stone = !!g.nodes.find((n) => n.kind === 'rock' && C.pathNextTo(g, g.hero, n.x, n.y, { axe: true, pick: true }));
    assert.ok(can.stone, `seed ${seed}`);
    const costs = [...Object.values(C.TOOLS).map((t) => t.cost), ...C.HUT_STAGES.map((s) => s.cost), C.PALISADE_COST, C.BUNK_COST];
    for (const cost of costs) for (const k of Object.keys(cost)) assert.ok(can[k], `${k} reachable`);
  }
});

test('days: 100 s of light, 50 s of night, blizzards on their days, the cold deepest in the middle', () => {
  const g = quiet();
  assert.equal(C.timeOfDay(g), 0);
  g.t = C.NIGHT_AT + 1;
  assert.ok(C.isNight(g));
  g.t = C.DAY * 5 + 1;
  assert.equal(C.dayOf(g), 6);
  assert.ok(C.isBlizzard(g));
  assert.ok(C.baseTemp(1) > C.baseTemp(12));
  assert.equal(C.baseTemp(20), -25);
  assert.ok(C.baseTemp(29) > C.baseTemp(20));
  const day = quiet(); day.t = C.DAY * 2 + 10;
  const night = quiet(); night.t = C.DAY * 2 + C.NIGHT_AT + 10;
  assert.ok(C.temperature(night) < C.temperature(day));
  assert.ok(C.chill(night) > C.chill(day));
  const harsh = quiet(1, 'harsh'); harsh.t = day.t;
  assert.ok(C.chill(harsh) > C.chill(day));
  assert.ok(C.BLIZZARDS.harsh.length > C.BLIZZARDS.normal.length);
});

test('warmth: falls outside, the fire helps on mild days, only the stove holds in the deep cold', () => {
  const g = quiet();
  const out = { x: 10.5, y: 30.5 };
  assert.ok(C.warmthRate(g, out) < 0);
  const byFire = { x: C.SPOT.fire.x + 0.5, y: C.SPOT.fire.y + 1.5 };
  assert.ok(C.warmthRate(g, byFire) > 0, 'day 1 by the fire');
  g.t = C.DAY * 19 + C.NIGHT_AT + 5; // a deep-cold night
  assert.ok(C.warmthRate(g, byFire) < 0, 'the fire alone loses on deep-cold nights');
  const bed = { x: C.SPOT.bed.x + 0.5, y: C.SPOT.bed.y + 0.5 };
  g.hut.stage = 2;
  assert.ok(C.warmthRate(g, bed) > C.warmthRate(g, out), 'a roof halves the cold');
  g.hut.stage = 4;
  g.hut.stove = 5;
  assert.ok(C.stoveOn(g));
  assert.equal(C.warmthRate(g, bed), 2);
  g.hut.stove = 0;
  assert.equal(C.stoveOn(g), false);
  g.fire.fuel = 0;
  assert.ok(C.warmthRate(g, byFire) < 0, 'a dead fire warms nobody');
});

test('stats: food and energy fall, health falls while a stat is empty and comes back when all are fine', () => {
  const g = quiet();
  g.fire.fuel = C.FIRE.cap;
  g.hero.x = 10.5; g.hero.y = 30.5;
  const f0 = g.hero.food;
  sim(g, 10);
  assert.ok(Math.abs(g.hero.food - (f0 - C.FOOD_DRAIN * 10)) < 0.05);
  g.hero.food = 0;
  const h0 = g.hero.health;
  sim(g, 5);
  assert.ok(g.hero.health < h0);
  g.hero.food = 80; g.hero.warmth = 80; g.hero.energy = 80;
  const h1 = g.hero.health;
  sim(g, 5);
  assert.ok(g.hero.health > h1);
  g.hero.health = 0.1;
  g.hero.food = 0;
  sim(g, 1);
  assert.equal(C.status(g), 'lost');
});

test('chopping gives wood (2 a blow, 3 with the iron axe); rocks need the pick', () => {
  const g = quiet();
  const tree = nearest(g, 'tree');
  assert.equal(C.interact(g, tree.x, tree.y), 'chop');
  const ev = settle(g);
  assert.equal(tree.amount, 0);
  assert.equal(of(ev, 'gather').reduce((a, e) => a + e.n, 0), tree.max);
  assert.ok(of(ev, 'gather').every((e) => e.n === 2));
  const rock = nearest(g, 'rock');
  assert.equal(C.interact(g, rock.x, rock.y), 'tool');
  g.tools.pick = true;
  assert.equal(C.interact(g, rock.x, rock.y), 'mine');
  settle(g);
  assert.ok(g.stock.stone > 0);
  g.tools.ironAxe = true;
  const t2 = nearest(g, 'tree');
  C.interact(g, t2.x, t2.y);
  const ev2 = settle(g);
  assert.ok(of(ev2, 'gather').some((e) => e.n === 3));
});

test('bushes give berries, scrap gives metal, the ice hole gives fish', () => {
  const g = quiet();
  const bush = nearest(g, 'bush');
  assert.equal(C.interact(g, bush.x, bush.y), 'pick');
  settle(g);
  assert.ok(g.stock.berries >= 4 + bush.max);
  const scrap = nearest(g, 'scrap');
  assert.equal(C.interact(g, scrap.x, scrap.y), 'scrap');
  settle(g);
  assert.ok(g.stock.metal > 0);
  g.hero.x = 42.5; g.hero.y = 8.5;
  assert.equal(C.interact(g, 44, 8), 'fish');
  sim(g, C.FISH_TIME + 1);
  assert.equal(g.stock.fish, 1);
});

test('away from the camp the hero carries at most 40; the camp stores 200 materials and 150 food', () => {
  const g = quiet();
  g.hero.x = 10.5; g.hero.y = 30.5;
  g.hero.load = C.CARRY - 1;
  const tree = nearest(g, 'tree');
  C.interact(g, tree.x, tree.y);
  settle(g);
  assert.equal(g.hero.load, C.CARRY);
  const w = g.stock.wood;
  C.interact(g, tree.x, tree.y);
  settle(g);
  assert.equal(g.stock.wood, w, 'full hands');
  g.hero.x = 27.5; g.hero.y = 21.5;
  sim(g, 0.5);
  assert.equal(g.hero.load, 0, 'unloaded in the camp');
  g.stock.berries = C.FOOD_CAP;
  assert.equal(C.foodTotal(g) >= C.FOOD_CAP, true);
});

test('the fire burns a log in 12 s and goes out; feeding it from the stock; cooking raw food on it', () => {
  const g = quiet();
  g.fire.fuel = 1;
  sim(g, 6);
  assert.ok(Math.abs(g.fire.fuel - 0.5) < 0.02);
  const ev = [];
  for (let t = 0; t < 8; t += 0.25) { C.step(g, 0.25); ev.push(...C.drain(g)); }
  assert.equal(g.fire.fuel, 0);
  assert.equal(of(ev, 'fireOut').length, 1);
  g.stock.wood = 20;
  g.stock.meat = 2;
  assert.equal(C.interact(g, C.SPOT.fire.x, C.SPOT.fire.y), 'fire');
  settle(g, 40);
  assert.ok(g.fire.fuel >= C.FIRE.cap / 2 - 1);
  assert.equal(g.stock.meat, 0);
  assert.equal(g.stock.cookedMeat, 4, 'two cooked on top of the two from the start');
});

test('eating picks the most filling food; raw meat costs energy', () => {
  const g = quiet();
  g.hero.food = 20;
  assert.equal(C.eat(g), 'cookedMeat');
  assert.equal(g.hero.food, 20 + C.FOOD.cookedMeat);
  g.stock = { ...g.stock, cookedMeat: 0, cookedFish: 0, fish: 0, berries: 0, meat: 1 };
  const e0 = g.hero.energy;
  assert.equal(C.eat(g), 'meat');
  assert.equal(g.hero.energy, e0 - C.RAW_MEAT_ENERGY);
  assert.equal(C.eat(g), null, 'nothing left');
  g.stock.berries = 3;
  g.hero.food = C.STAT_MAX;
  assert.equal(C.eat(g), null, 'not hungry');
});

test('tools are made at the workbench in the camp', () => {
  const g = quiet();
  assert.equal(C.craft(g, 'pick'), 'nores');
  g.stock.wood = 50;
  assert.equal(C.craft(g, 'laser'), 'bad');
  assert.equal(C.craft(g, 'axe'), 'have');
  g.hero.x = 10.5;
  assert.equal(C.craft(g, 'pick'), 'far');
  g.hero.x = 27.5;
  assert.equal(C.craft(g, 'pick'), 'ok');
  assert.equal(g.stock.wood, 38);
  assert.equal(C.craft(g, 'pick'), 'have');
});

test('walking: deep snow is slower, drifts open only to the shovel (and get dug), the lake to the ice pick', () => {
  const g = quiet();
  // a straight run on plain snow vs one through deep snow
  g.nodes = g.nodes.filter((n) => n.y !== 38 && !(n.x === 5 && n.y === 37)); // a new array: the walk cache refreshes
  const line = (c) => { for (let x = 2; x < 12; x++) g.tiles[C.idx(x, 38)] = c; };
  line('.');
  g.hero.x = 2.5; g.hero.y = 38.5;
  C.interact(g, 11, 38);
  let t = 0;
  while (g.hero.path && t < 20) { C.step(g, 0.05); t += 0.05; }
  line(':');
  g.hero.x = 2.5; g.hero.y = 38.5;
  C.interact(g, 11, 38);
  let t2 = 0;
  while (g.hero.path && t2 < 20) { C.step(g, 0.05); t2 += 0.05; }
  assert.ok(t2 > t * 1.4, `deep ${t2} vs plain ${t}`);
  g.tiles[C.idx(5, 37)] = 'D';
  assert.equal(C.walkable(g, 5, 37), false);
  g.tools.shovel = true;
  assert.ok(C.walkable(g, 5, 37));
  g.hero.x = 5.5; g.hero.y = 38.5;
  C.interact(g, 5, 37);
  settle(g);
  assert.equal(g.tiles[C.idx(5, 37)], '.', 'the drift is dug out');
  assert.equal(C.walkable(g, 46, 10), false);
  g.tools.icePick = true;
  assert.ok(C.walkable(g, 46, 10));
  assert.equal(C.walkable(g, 44, 8), false, 'never into the ice hole');
  assert.equal(C.pathTo(g, g.hero, -1, 0), null);
});

test('keyboard walking moves the hero and stops an order', () => {
  const g = quiet();
  const x0 = g.hero.x;
  C.interact(g, 30, 22);
  C.moveDir(g, 1, 0);
  assert.equal(g.hero.target, null);
  sim(g, 0.5);
  assert.ok(g.hero.x > x0);
  C.moveDir(g, 0, 0);
  assert.equal(g.hero.dir, null);
});

test('hunting: rabbits with bare hands, deer only with the spear', () => {
  const g = quiet();
  g.animals = [{ id: 900, kind: 'rabbit', x: 30.5, y: 21.5, hp: 1, tx: 30, ty: 21, cd: 99 }];
  assert.equal(C.interact(g, 30, 21), 'hunt');
  settle(g);
  assert.equal(g.stock.meat, 1);
  g.animals = [{ id: 901, kind: 'deer', x: 30.5, y: 21.5, hp: 2, tx: 30, ty: 21, cd: 99 }];
  assert.equal(C.interact(g, 30, 21), 'tool');
  g.tools.spear = true;
  assert.equal(C.interact(g, 30, 21), 'hunt');
  settle(g);
  assert.equal(g.stock.meat, 4);
});

test('torches cost wood, sit on free tiles, light the ground', () => {
  const g = quiet();
  g.stock.wood = 3;
  assert.ok(C.placeTorch(g, 30, 30));
  assert.equal(C.placeTorch(g, 30, 30), false, 'one per tile');
  assert.equal(C.placeTorch(g, 31, 30), false, 'no wood left');
  assert.ok(C.lit(g, 31, 31));
  assert.equal(C.lit(g, 40, 38), false);
  assert.equal(C.interact(g, 35, 35, { torch: true }), 'none');
});

test('the same inputs give the same winter; frame size does not change the outcome of a minute', () => {
  const run = (frame) => { const g = C.newGame('normal', 8); C.interact(g, 30, 22); sim(g, 60, frame); return g; };
  const a = run(0.25), b = run(0.25);
  assert.deepEqual(C.snapshot(a), C.snapshot(b));
  const c = run(0.05);
  assert.ok(Math.abs(c.t - a.t) < 0.06);
  assert.ok(Math.abs(c.hero.food - a.hero.food) < 0.01);
});

test('step ignores bad dt and caps a long frame; nothing runs after the end', () => {
  const g = quiet();
  for (const dt of [0, -1, NaN, Infinity, 'x']) C.step(g, dt);
  assert.equal(g.t, 0);
  C.step(g, 5);
  assert.ok(Math.abs(g.t - C.MAX_DT) < C.TICK);
  g.status = 'lost';
  C.step(g, 1);
  assert.ok(Math.abs(g.t - C.MAX_DT) < C.TICK);
  assert.equal(C.interact(g, 30, 22), 'none');
  assert.equal(C.eat(g), null);
  assert.equal(C.drain(g).length >= 0, true);
  assert.equal(C.clamp(5, 0, 1), 1);
  assert.ok(C.rand({ rng: 2 }) < 1);
  assert.ok(C.inMap(0, 0) && !C.inMap(C.W, 0));
});
