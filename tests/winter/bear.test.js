'use strict';
// Долгая зима: the roaming bear.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/winter/core.js');

const of = (events, type) => events.filter((e) => e.type === type);
function quiet(seed = 1, diff = 'normal') {
  const g = C.newGame(diff, seed);
  g.animals = [];
  return g;
}
function dawnOf(g, day) {
  g.t = (day - 1) * C.DAY - 0.01;
  g.hero.sleeping = false;
  g.wolves = [];
  C.step(g, 0.05);
  return C.drain(g);
}
// A bear placed by hand on an open tile.
function withBear(x, y, seed = 1) {
  const g = quiet(seed);
  g.t = 7 * C.DAY + 5;
  g.fire.fuel = 0;
  g.bear = { id: g.nextId++, x: x + 0.5, y: y + 0.5, hp: C.BEAR.hp, cd: 0, calm: 0, path: null, plan: 0, chase: false };
  return g;
}
// An open stretch of snow with free tiles around (x, y), far from the camp.
// A row of open snow 6 tiles long (x … x + 5) with open rows above and below, far from the camp.
function openSpot(g) {
  const open = (x, y) => g.tiles[C.idx(x, y)] === '.' && !C.nodeAt(g, x, y);
  for (let y = 2; y < C.H - 2; y++) for (let x = 2; x < 38; x++) {
    if (Math.hypot(x - C.SPOT.fire.x, y - C.SPOT.fire.y) < 12) continue;
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 6 && ok; dx++) ok = open(x + dx, y + dy);
    if (ok) return { x, y };
  }
  return null;
}

test('the bear comes on his days, far from the camp, and leaves at nightfall', () => {
  for (const diff of ['normal', 'harsh']) {
    const g = quiet(2, diff);
    const days = [];
    for (let d = 2; d <= C.DAYS; d++) {
      const ev = dawnOf(g, d);
      if (g.event && g.event.phase === 'ask') C.answerEvent(g, C.EVENT_DEFAULT[g.event.id]);
      if (!g.bear) continue;
      days.push(d);
      assert.equal(of(ev, 'bear').length, 1);
      assert.ok(Math.hypot(g.bear.x - C.SPOT.fire.x, g.bear.y - C.SPOT.fire.y) >= C.BEAR.far);
    }
    assert.deepEqual(days, C.BEAR.days[diff]);
  }
  const g = quiet();
  dawnOf(g, C.BEAR.days.normal[0]);
  assert.ok(g.bear);
  g.t = (C.BEAR.days.normal[0] - 1) * C.DAY + C.NIGHT_AT - 0.01;
  C.step(g, 0.05);
  assert.equal(g.bear, null);
  assert.equal(of(C.drain(g), 'bearLeft').length, 1);
});

test('the bear goes for a hero he sees in the open, bites hard, then backs off for a while', () => {
  const g0 = quiet();
  const p = openSpot(g0);
  assert.ok(p, 'an open spot');
  const g = withBear(p.x + 3, p.y);
  g.hero.x = p.x + 0.5; g.hero.y = p.y + 0.5; g.hero.health = 100;
  const ev = [];
  for (let t = 0; t < 4 && !of(ev, 'bite').length; t += 0.1) { C.step(g, 0.1); ev.push(...C.drain(g)); }
  const bite = of(ev, 'bite')[0];
  assert.deepEqual(bite, { type: 'bite', who: 'hero', by: 'bear' });
  assert.ok(Math.abs(g.hero.health - (100 - C.BEAR.bite)) < 0.5, `${g.hero.health}`);
  assert.ok(g.bear.calm > 0);
  assert.equal(g.hero.target, null, 'the hero does not throw himself at the bear');
  // calm: he walks off and doesn't bite again at once
  ev.length = 0;
  for (let t = 0; t < C.BEAR.calm - 0.5; t += 0.1) { g.hero.health = 100; C.step(g, 0.1); ev.push(...C.drain(g)); }
  assert.equal(of(ev, 'bite').length, 0);
  assert.ok(Math.hypot(g.bear.x - g.hero.x, g.bear.y - g.hero.y) > C.BEAR.reach);
});

test('the bear never steps into the camp nor into the light, and ignores the survivors', () => {
  const g = withBear(C.BASE.x0 - 4, 20);
  g.hero.x = C.BASE.x0 + 1.5; g.hero.y = 20.5;
  for (const s of g.survivors) { s.state = 'home'; s.x = C.BASE.x0 + 0.5; s.y = 21.5; s.food = 100; }
  const bites = [];
  for (let t = 0; t < 40; t += 0.1) {
    C.step(g, 0.1);
    bites.push(...of(C.drain(g), 'bite'));
    if (!g.bear) break;
    assert.ok(!C.inBase(Math.floor(g.bear.x), Math.floor(g.bear.y)), `at ${g.bear.x}, ${g.bear.y}`);
  }
  assert.deepEqual(bites, [], 'nobody in the camp is bitten');
  // a torch keeps him off: the hero in its light outside the camp is safe
  const h = quiet();
  const p = openSpot(h);
  const b = withBear(p.x + 4, p.y);
  b.hero.x = p.x + 0.5; b.hero.y = p.y + 0.5; b.hero.health = 100;
  b.stock.wood = 10;
  assert.ok(C.placeTorch(b, p.x, p.y));
  const ev = [];
  for (let t = 0; t < 20; t += 0.1) { C.step(b, 0.1); ev.push(...C.drain(b)); assert.ok(!C.lit(b, Math.floor(b.bear.x), Math.floor(b.bear.y)) || t < 0.5); }
  assert.equal(of(ev, 'bite').length, 0);
});

test('the hero kills the bear: a lot of meat and hides; the spear hits twice as hard', () => {
  const g0 = quiet();
  const p = openSpot(g0);
  const g = withBear(p.x + 1, p.y);
  g.hero.x = p.x + 0.5; g.hero.y = p.y + 0.5; g.hero.health = 100;
  g.tools.spear = true;
  g.bear.calm = 999;    // a calm bear for the test
  g.hero.x = C.BASE.x0 - 6.5; g.hero.y = 30.5;
  g.bear.x = g.hero.x + 1; g.bear.y = g.hero.y;
  for (const k of ['meat', 'hide']) g.stock[k] = 0;
  g.hero.load = 0;
  assert.equal(C.interact(g, g.bear.x, g.bear.y), 'fight');
  const ev = [];
  for (let t = 0; t < 30 && g.bear; t += 0.1) { g.hero.health = 100; C.step(g, 0.1); ev.push(...C.drain(g)); }
  assert.equal(g.bear, null);
  assert.equal(of(ev, 'bearHit').length, Math.ceil(C.BEAR.hp / 2));
  const dead = of(ev, 'bearDead')[0];
  assert.deepEqual([dead.meat, dead.hide], [C.BEAR.meat, C.BEAR.hide]);
  assert.deepEqual([g.stock.meat, g.stock.hide], [C.BEAR.meat, C.BEAR.hide]);
  assert.equal(g.hero.target, null);
});

test('no bear on other days; the bear survives a save and restore; broken ones are refused', () => {
  const g = quiet();
  dawnOf(g, C.BEAR.days.normal[0] + 1);
  assert.equal(g.bear, null);
  dawnOf(g, C.BEAR.days.normal[1]);
  assert.ok(g.bear);
  assert.equal(C.nextTask(Object.assign(g, {})), C.nextTask(g));
  const back = C.restore(JSON.parse(JSON.stringify(C.snapshot(g))));
  assert.deepEqual(back.bear, g.bear);
  const old = JSON.parse(JSON.stringify(C.snapshot(g)));
  delete old.bear;
  assert.equal(C.restore(old).bear, null);
  const snap = C.snapshot(g);
  for (const bad of [{ ...snap, bear: { ...snap.bear, hp: 0 } }, { ...snap, bear: { ...snap.bear, x: -1 } }, { ...snap, bear: { ...snap.bear, id: 'b' } }, { ...snap, bear: 5 }]) {
    assert.equal(C.restore(bad), null);
  }
});

test('the hint: run to the camp when the bear is near', () => {
  const g0 = quiet();
  const p = openSpot(g0);
  const g = withBear(p.x + 4, p.y);
  g.hero.x = p.x + 0.5; g.hero.y = p.y + 0.5;
  g.fire.fuel = 10;
  assert.equal(C.nextTask(g), 'Медведь рядом: уходи в лагерь');
  g.bear.x = 2.5; g.bear.y = 2.5;
  assert.notEqual(C.nextTask(g), 'Медведь рядом: уходи в лагерь');
});
