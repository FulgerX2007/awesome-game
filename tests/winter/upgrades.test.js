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

// ── The workshop's gear ──
const withWorkshop = (seed = 1) => { const g = withStove(seed); build(g, 'workshop'); return g; };

test('gear is locked without the workshop, then made once at the camp; snares are counted', () => {
  const g = withStove();
  plenty(g);
  for (const id of C.GEAR_IDS) assert.equal(C.craft(g, id), 'locked', id);
  build(g, 'workshop');
  for (const k of C.RES) g.stock[k] = 0;
  assert.equal(C.craft(g, 'coat'), 'nores');
  plenty(g);
  g.hero.x = 5.5; g.hero.y = 5.5;
  assert.equal(C.craft(g, 'coat'), 'far');
  g.hero.x = 27.5; g.hero.y = 21.5;
  for (const id of ['coat', 'lantern', 'sled']) {
    assert.equal(C.craft(g, id), 'ok');
    assert.equal(g.gear[id], true);
    assert.equal(C.craft(g, id), 'have');
  }
  assert.equal(C.craft(g, 'snares'), 'ok');
  assert.equal(g.gear.snares, C.SNARE.per);
  assert.equal(C.craft(g, 'snares'), 'ok');
  assert.equal(g.gear.snares, C.SNARE.max);
  const wood = g.stock.wood;
  assert.equal(C.craft(g, 'snares'), 'have');
  assert.equal(g.stock.wood, wood);
  assert.equal(C.craft(g, 'sauna'), 'bad');
  g.status = 'lost';
  assert.equal(C.craft(g, 'coat'), 'bad');
});

test('the coat: the hero feels less cold, survivors are not changed', () => {
  const g = withWorkshop();
  g.fire.fuel = 0; g.hut.stove = 0;
  g.t = C.DAY * 18 + 1;
  g.hero.x = 10.5; g.hero.y = 30.5;
  const before = C.warmthRate(g, g.hero);
  assert.equal(C.craft(g, 'coat'), 'far');
  g.gear.coat = true;
  assert.ok(Math.abs(C.warmthRate(g, g.hero) - before * C.COAT) < 1e-9);
  const sv = { x: 10.5, y: 30.5 };
  assert.equal(C.warmthRate(g, sv), before);
});

test('the sled: the hero carries twice as much away from the camp', () => {
  const g = withWorkshop();
  assert.equal(C.carryOf(g), C.CARRY);
  g.gear.sled = true;
  assert.equal(C.carryOf(g), C.SLED_CARRY);
  g.stock.wood = 0;
  const tree = g.nodes.filter((n) => n.kind === 'tree' && !C.inBase(n.x, n.y) && C.pathNextTo(g, g.hero, n.x, n.y))[0];
  tree.amount = 999;
  g.hero.load = C.CARRY + 10;
  g.hero.x = tree.x + 1.5; g.hero.y = tree.y + 0.5;
  if (!C.walkable(g, Math.floor(g.hero.x), Math.floor(g.hero.y))) { g.hero.x = tree.x - 0.5; }
  assert.equal(C.interact(g, tree.x, tree.y), 'chop');
  sim(g, 3);
  assert.ok(g.stock.wood > 0, 'still chopping past the old limit');
  g.hero.load = C.SLED_CARRY;
  const w = g.stock.wood;
  C.interact(g, tree.x, tree.y);
  sim(g, 3);
  assert.equal(g.stock.wood, w, 'full at the sled limit');
});

test('the lantern: a wolf that comes close at night runs, then may come back and bite', () => {
  const g = withWorkshop();
  g.gear.lantern = true;
  g.fire.fuel = 0; g.hut.stove = 0;
  g.t = C.NIGHT_AT + 5;
  g.hero.x = 10.5; g.hero.y = 30.5; g.hero.health = 100;
  const w = { id: g.nextId++, x: 12.5, y: 30.5, hp: C.WOLF_HP, maxHp: C.WOLF_HP, cd: 0, flee: false };
  g.wolves.push(w);
  const ev = [];
  for (let t = 0; t < 1; t += 0.25) { C.step(g, 0.25); ev.push(...C.drain(g)); }
  assert.equal(of(ev, 'scared').length, 1);
  assert.ok(w.scared > 0 && !w.flee, 'scared, not routed for good');
  for (let t = 0; t < 15; t += 0.25) { g.hero.health = 100; C.step(g, 0.25); ev.push(...C.drain(g)); }
  assert.ok(of(ev, 'scared').length >= 2, 'scared again after the cooldown');
  assert.ok(of(ev, 'bite').length >= 1, 'the lantern is no shield');
  // by day, or without the lantern, it scares nobody
  const d = withWorkshop();
  d.hero.x = 10.5; d.hero.y = 30.5;
  d.wolves.push({ id: d.nextId++, x: 11.5, y: 30.5, hp: C.WOLF_HP, maxHp: C.WOLF_HP, cd: 0, flee: false });
  d.t = C.NIGHT_AT + 5;
  C.step(d, 0.25);
  assert.equal(of(C.drain(d), 'scared').length, 0);
});

test('snares: set next to the hero outside the camp, up to four; they catch at dawn', () => {
  const g = withWorkshop();
  assert.equal(C.placeSnare(g, 10, 30), 'none');
  g.gear.snares = 4;
  g.hero.x = 27.5; g.hero.y = 21.5;
  assert.equal(C.placeSnare(g, 27, 22), 'base');
  g.hero.x = 10.5; g.hero.y = 33.5;
  assert.equal(C.placeSnare(g, 20, 33), 'far');
  assert.equal(C.placeSnare(g, -1, 33), 'bad');
  assert.equal(C.placeSnare(g, NaN, 33), 'bad');
  const free = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = 10 + dx, y = 33 + dy;
    if (g.tiles[C.idx(x, y)] === '.' && !C.nodeAt(g, x, y)) free.push([x, y]); else if (free.length < 9) assert.equal(C.placeSnare(g, x, y), 'blocked');
  }
  assert.ok(free.length >= 4, 'enough free tiles in the test spot');
  for (const [x, y] of free.slice(0, 4)) assert.equal(C.placeSnare(g, x, y), 'ok');
  assert.equal(C.placeSnare(g, free[0][0], free[0][1]), 'none');
  g.gear.snares = 1;
  assert.equal(C.placeSnare(g, free[4] ? free[4][0] : 9, free[4] ? free[4][1] : 32), 'max');
  // dawns: catches come from the second stream, the same for a seed
  const catches = (seed) => {
    const h = withWorkshop(seed);
    h.snares = [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }];
    h.stock.meat = 0;
    const out = [];
    for (let d = 0; d < 5; d++) {
      h.t = C.DAY * (d + 1) - 0.01;
      h.hero.sleeping = false;
      C.step(h, 0.05);
      out.push(of(C.drain(h), 'snareCaught').length);
    }
    return { out, meat: h.stock.meat };
  };
  const a = catches(5), b = catches(5);
  assert.deepEqual(a, b);
  const total = a.out.reduce((s, n) => s + n, 0);
  assert.equal(a.meat, total);
  assert.ok(total >= 6 && total <= 18, `${total} of 20`);
});

test('gear and snares survive a save; broken ones are refused', () => {
  const g = withWorkshop();
  g.gear.coat = true; g.gear.snares = 1;
  g.snares = [{ x: 3, y: 3 }];
  const back = C.restore(JSON.parse(JSON.stringify(C.snapshot(g))));
  assert.deepEqual([back.gear, back.snares], [g.gear, g.snares]);
  const old = JSON.parse(JSON.stringify(C.snapshot(g)));
  delete old.gear; delete old.snares;
  assert.deepEqual(C.restore(old).gear, { coat: false, lantern: false, sled: false, snares: 0 });
  const snap = C.snapshot(g);
  for (const bad of [{ ...snap, gear: { ...snap.gear, coat: 1 } }, { ...snap, gear: { ...snap.gear, snares: 9 } }, { ...snap, snares: [{ x: 99, y: 3 }] },
    { ...snap, snares: Array.from({ length: 5 }, (_, i) => ({ x: i, y: 3 })) }, { ...snap, snares: {} }]) {
    assert.equal(C.restore(bad), null);
  }
});
