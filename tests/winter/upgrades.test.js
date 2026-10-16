'use strict';
// Долгая зима: the house upgrades after the stove (insulation, cellar, smokehouse, annex, workshop).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/winter/core.js');

const sim = (g, seconds, frame = 0.25) => { for (let t = 0; t < seconds - 1e-9; t += frame) C.step(g, frame); };
const of = (events, type) => events.filter((e) => e.type === type);
function quiet(seed = 1, diff = 'normal') {
  const g = C.newGame(diff, seed);
  g.animals = [];
  return g;
}
const plenty = (g) => Object.assign(g.stock, { wood: 100, stone: 50, metal: 20, hide: 20 });
function withStove(seed = 1) {
  const g = quiet(seed);
  g.hut.stage = C.HUT_STAGES.length;
  g.hut.stove = 6;
  return g;
}
const build = (g, id) => { plenty(g); assert.equal(C.contribute(g, `up:${id}`), 'done', id); };

test('every upgrade is locked before the stove, then paid in parts, then built once', () => {
  assert.deepEqual(C.UPGRADE_IDS, ['insulation', 'cellar', 'smokehouse', 'annex', 'workshop']);
  for (const id of C.UPGRADE_IDS) {
    const g = quiet();
    plenty(g);
    g.hut.stage = 3;
    assert.equal(C.contribute(g, `up:${id}`), 'locked');
    assert.equal(g.stock.wood, 100, 'nothing taken while locked');
    g.hut.stage = 4;
    for (const k of C.RES) g.stock[k] = 0;
    assert.equal(C.contribute(g, `up:${id}`), 'nores');
    const cost = C.UPGRADES[id].cost, first = Object.keys(cost)[0];
    g.stock[first] = cost[first];
    assert.equal(C.contribute(g, `up:${id}`), Object.keys(cost).length > 1 ? 'part' : 'done');
    assert.equal(g.upgrades[id].paid[first], cost[first]);
    plenty(g);
    const ev = [];
    assert.equal(C.contribute(g, `up:${id}`), 'done');
    ev.push(...C.drain(g));
    assert.deepEqual(of(ev, 'upgraded'), [{ type: 'upgraded', id }]);
    assert.equal(of(ev, 'built').length, 0, 'not a «built» event: the client branches on its id');
    assert.ok(C.upgradeOn(g, id));
    assert.equal(C.contribute(g, `up:${id}`), 'built');
  }
});

test('upgrades: bad ids, away from the camp, not when the winter is over', () => {
  const g = withStove();
  plenty(g);
  assert.equal(C.contribute(g, 'up:sauna'), 'bad');
  assert.equal(C.contribute(g, 'up:'), 'bad');
  assert.equal(C.needOf(g, 'up:toString'), undefined);
  assert.equal(C.upgradeOn(g, 'sauna'), false);
  g.hero.x = 5.5; g.hero.y = 5.5;
  assert.equal(C.contribute(g, 'up:cellar'), 'far');
  g.hero.x = 27.5; g.hero.y = 21.5;
  g.status = 'won';
  assert.equal(C.contribute(g, 'up:cellar'), 'bad');
});

test('insulation: the stove burns slower, and the hut keeps most of the cold out without it', () => {
  const a = withStove(), b = withStove();
  build(b, 'insulation');
  a.hut.stove = b.hut.stove = 20;
  sim(a, 60); sim(b, 60);
  const usedA = 20 - a.hut.stove, usedB = 20 - b.hut.stove;
  assert.ok(Math.abs(usedB / usedA - C.INSULATION.stove) < 0.01, `${usedA} vs ${usedB}`);
  // in the hut, stove out, deep cold: the insulated hut loses far less warmth
  for (const g of [a, b]) { g.hut.stove = 0; g.fire.fuel = 0; g.t = C.DAY * 18 + 1; g.hero.x = C.HUT.x + 1.5; g.hero.y = C.HUT.y + 0.5; }
  const ra = C.warmthRate(a, a.hero), rb = C.warmthRate(b, b.hero);
  assert.ok(ra < 0 && rb < 0 && rb > ra * 0.5, `${ra} vs ${rb}`);
  assert.ok(Math.abs(rb / ra - C.INSULATION.chill / 0.4) < 1e-9);
});

test('the cellar holds more food', () => {
  const g = withStove();
  assert.equal(C.foodCap(g), C.FOOD_CAP);
  g.stock.berries = C.FOOD_CAP;
  for (const k of ['meat', 'fish', 'cookedMeat', 'cookedFish', 'smokedMeat', 'smokedFish']) g.stock[k] = 0;
  assert.equal(C.roomFor(g, 'fish'), 0);
  build(g, 'cellar');
  assert.equal(C.foodCap(g), C.FOOD_CAP + C.CELLAR_FOOD);
  assert.equal(C.roomFor(g, 'fish'), C.CELLAR_FOOD);
  assert.equal(C.roomFor(g, 'wood'), C.STORE_CAP - C.stockTotal(g), 'materials are not changed');
});

test('the smokehouse smokes raw meat, then fish, on its own, a log for every three pieces', () => {
  const g = withStove();
  g.fire.fuel = 0;
  Object.assign(g.stock, { meat: 2, fish: 2, wood: 1, smokedMeat: 0, smokedFish: 0 });
  sim(g, 60);
  assert.equal(g.stock.meat, 2, 'nothing without the smokehouse');
  build(g, 'smokehouse');
  Object.assign(g.stock, { meat: 2, fish: 2, wood: 1, stone: 0, metal: 0, hide: 0 });
  const ev = [];
  for (let t = 0; t < C.SMOKE.every * 4 + 1; t += 0.25) { C.step(g, 0.25); ev.push(...C.drain(g)); }
  assert.deepEqual([g.stock.meat, g.stock.smokedMeat, g.stock.fish, g.stock.smokedFish], [0, 2, 1, 1]);
  assert.equal(g.stock.wood, 0, 'one log for the first three');
  assert.deepEqual(of(ev, 'smoked').map((e) => e.item), ['smokedMeat', 'smokedMeat', 'smokedFish']);
  // no wood: it waits, and goes on when a log comes
  sim(g, C.SMOKE.every * 2);
  assert.equal(g.stock.fish, 1);
  g.stock.wood = 1;
  sim(g, 1);
  assert.deepEqual([g.stock.fish, g.stock.smokedFish, g.stock.wood], [0, 2, 0]);
  // nothing raw: it idles
  sim(g, C.SMOKE.every * 2);
  assert.equal(g.upgrades.smokehouse.work, 0);
});

test('the annex: survivors stay warm by any fire, heal twice as fast and work faster', () => {
  const setup = (annex) => {
    const g = withStove();
    if (annex) build(g, 'annex');
    g.hut.stove = 0;
    g.fire.fuel = C.FIRE.cap;
    g.t = C.DAY * 18 + 1;           // the deep cold, no bunk: without the annex the fire is not enough
    const s = g.survivors.find((x) => x.id === 'carpenter');
    s.state = 'home'; s.x = 27.5; s.y = 22.5; s.food = 100; s.hp = 50;
    return { g, s };
  };
  const a = setup(false), b = setup(true);
  sim(a.g, 10); sim(b.g, 10);
  assert.ok(a.s.hp < 50, `cold without it: ${a.s.hp}`);
  assert.ok(Math.abs(b.s.hp - (50 + 0.2 * C.ANNEX.heal * 10)) < 0.2, `warm and healing: ${b.s.hp}`);
  // a heat source is still needed
  b.g.fire.fuel = 0;
  const hp = b.s.hp;
  sim(b.g, 5);
  assert.ok(b.s.hp < hp);
  // work: the carpenter's 6 s becomes 4.5 s
  const c = setup(true);
  c.g.t = C.DAY * 2 + 1;
  const wood = c.g.stock.wood;
  sim(c.g, 9.1);
  assert.equal(c.g.stock.wood - wood, 2);
});

test('upgrades survive a save and restore half paid; an old save gets them all unbuilt', () => {
  const g = withStove();
  g.stock.wood = 10;
  assert.equal(C.contribute(g, 'up:cellar'), 'part');
  build(g, 'smokehouse');
  const back = C.restore(JSON.parse(JSON.stringify(C.snapshot(g))));
  assert.deepEqual(back.upgrades, g.upgrades);
  const old = JSON.parse(JSON.stringify(C.snapshot(g)));
  delete old.upgrades;
  assert.deepEqual(C.restore(old).upgrades.cellar, { built: false, paid: {} });
  const snap = C.snapshot(g);
  for (const bad of [{ ...snap, upgrades: 7 }, { ...snap, upgrades: { ...snap.upgrades, annex: null } }, { ...snap, upgrades: { ...snap.upgrades, cellar: { built: 'yes', paid: {} } } },
    { ...snap, upgrades: { ...snap.upgrades, smokehouse: { built: true, paid: {}, work: -1, fuel: 0 } } }]) {
    assert.equal(C.restore(bad), null);
  }
});
