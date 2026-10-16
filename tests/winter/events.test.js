'use strict';
// Долгая зима: events of the day (the roof in a blizzard, the wounded wanderer).
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
// Steps to the next dawn and returns the events of that moment.
function toDawn(g) {
  g.t = (C.dayOf(g)) * C.DAY - 0.01;
  g.hero.sleeping = false;
  g.wolves = [];
  C.step(g, 0.05);
  return C.drain(g);
}
// A game whose next dawn (day `day`) is sure to roll the event `id`.
function forced(id, day, seed = 1) {
  for (let s = seed; s < seed + 400; s++) {
    const g = quiet(s);
    g.hut.stage = 4; g.hut.stove = 30;
    g.t = (day - 1) * C.DAY - 0.01;
    g.lastEvent = null;
    const ev = toDawn(g);
    if (g.event && g.event.id === id) return { g, ev };
  }
  throw new Error(`no seed rolls ${id} on day ${day}`);
}

test('no event on the first or the last day; none twice in a row; each only so many times a winter', () => {
  for (let s = 1; s <= 30; s++) {
    const g = quiet(s);
    g.hut.stage = 4;
    const seen = [];
    for (let d = 1; d < C.DAYS; d++) {
      if (g.event && g.event.phase === 'ask') C.answerEvent(g, C.EVENT_DEFAULT[g.event.id]);
      g.event = null;
      toDawn(g);
      if (g.event) seen.push([C.dayOf(g), g.event.id]);
    }
    for (const [day] of seen) assert.ok(day >= 2 && day < C.DAYS, `seed ${s}: ${day}`);
    for (let i = 1; i < seen.length; i++) if (seen[i][0] === seen[i - 1][0] + 1) assert.notEqual(seen[i][1], seen[i - 1][1], `seed ${s}`);
    for (const id of C.EVENT_IDS) assert.ok(seen.filter((x) => x[1] === id).length <= C.EVENT_MAX[id], `${id} on seed ${s}`);
  }
});

test('a seed replays the same events; events never touch the first rng stream', () => {
  const run = (s) => {
    const g = quiet(s);
    g.hut.stage = 4;
    const out = [];
    for (let d = 1; d < 12; d++) { if (g.event && g.event.phase === 'ask') C.answerEvent(g, 'later'); g.event = null; toDawn(g); out.push(g.event && g.event.id); }
    return { out, rng: g.rng };
  };
  assert.deepEqual(run(9), run(9));
  const a = quiet(9), b = quiet(9);
  b.hut.stage = 4;
  for (let d = 1; d < 6; d++) { toDawn(a); toDawn(b); if (b.event && b.event.phase === 'ask') C.answerEvent(b, 'later'); b.event = null; }
  assert.equal(a.rng, b.rng);
});

test('the roof: only in a blizzard from day 5 with the door hung; fix now or live with a hole', () => {
  const { g, ev } = forced('roof', 6);
  assert.ok(C.isBlizzard(g));
  assert.deepEqual(of(ev, 'event'), [{ type: 'event', id: 'roof', phase: 'ask' }]);
  Object.assign(g.stock, { wood: 5, stone: 5 });
  assert.equal(C.answerEvent(g, 'fix'), 'nores');
  assert.equal(C.answerEvent(g, 'burn'), 'bad');
  Object.assign(g.stock, { wood: 20, stone: 5 });
  assert.equal(C.answerEvent(g, 'fix'), 'ok');
  assert.deepEqual([g.stock.wood, g.stock.stone, g.hut.roofHole, g.event], [5, 0, false, null]);
  assert.equal(C.answerEvent(g, 'fix'), 'none');
  // never before the door, never on a calm day, never before day 5
  for (let s = 1; s <= 60; s++) {
    for (const [stage, day] of [[2, 6], [4, 3], [4, 7]]) {
      const h = quiet(s);
      h.hut.stage = stage;
      h.t = (day - 1) * C.DAY - 0.01;
      toDawn(h);
      if (h.event) assert.notEqual(h.event.id, 'roof', `seed ${s}, stage ${stage}, day ${day} (blizzard ${C.isBlizzard(h)})`);
    }
  }
  assert.ok(C.BLIZZARDS.normal.includes(6) && !C.BLIZZARDS.normal.includes(7) && !C.BLIZZARDS.normal.includes(3));
});

test('a hole in the roof: the hut keeps less cold out, the stove burns faster; a patch mends it', () => {
  const { g } = forced('roof', 6);
  const hole = C.newGame('normal', 1);
  Object.assign(hole.hut, { stage: 4, stove: 0 });
  hole.fire.fuel = 0;
  hole.t = C.DAY * 18 + 1;
  hole.hero.x = C.HUT.x + 1.5; hole.hero.y = C.HUT.y + 0.5;
  const whole = C.warmthRate(hole, hole.hero);
  hole.hut.roofHole = true;
  assert.ok(Math.abs(C.warmthRate(hole, hole.hero) / whole - C.ROOF_HOLE.chill / 0.4) < 1e-9);
  // the stove
  assert.equal(C.answerEvent(g, 'later'), 'ok');
  assert.equal(g.hut.roofHole, true);
  g.hut.stove = 20;
  sim(g, 30);
  const used = 20 - g.hut.stove;
  assert.ok(Math.abs(used - (30 / C.STOVE.burn) * C.ROOF_HOLE.stove) < 0.05, `${used}`);
  // the patch
  for (const k of C.RES) g.stock[k] = 0;
  assert.equal(C.contribute(g, 'patch'), 'nores');
  g.stock.wood = 15;
  assert.equal(C.contribute(g, 'patch'), 'part');
  g.stock.stone = 5;
  assert.equal(C.contribute(g, 'patch'), 'done');
  assert.ok(of(C.drain(g), 'patched').length === 1);
  assert.equal(g.hut.roofHole, false);
  assert.equal(C.contribute(g, 'patch'), 'built');
});

test('the wanderer: found in the forest, helped with food for a gift, or left; he goes at night', () => {
  const { g, ev } = forced('wanderer', 4);
  const w = g.event;
  assert.deepEqual(of(ev, 'event'), [{ type: 'event', id: 'wanderer', phase: 'active' }]);
  const d = Math.hypot(w.x - C.SPOT.fire.x, w.y - C.SPOT.fire.y);
  assert.ok(d >= C.WANDERER.near && d <= C.WANDERER.far, `${d}`);
  assert.equal(C.nextTask(g), 'Помоги путнику');
  assert.equal(C.answerEvent(g, 'help'), 'none', 'nothing asks until the hero reaches him');
  assert.equal(C.interact(g, w.x, w.y), 'wanderer');
  for (let t = 0; t < 30 && g.event.phase === 'active'; t += 0.25) C.step(g, 0.25);
  assert.equal(g.event.phase, 'ask');
  for (const k of C.FOOD_ITEMS) g.stock[k] = 0;
  g.stock.berries = 9;
  assert.equal(C.answerEvent(g, 'help'), 'nores', 'berries are not for a wounded man');
  Object.assign(g.stock, { smokedMeat: 1, fish: 3 });
  const before = { ...g.stock, tools: { ...g.tools } };
  assert.equal(C.answerEvent(g, 'help'), 'ok');
  assert.deepEqual([g.stock.smokedMeat, g.stock.fish], [0, 2]);
  const done = of(C.drain(g), 'eventDone')[0];
  assert.equal(done.choice, 'help');
  const r = done.reward;
  if (r.tool) { assert.ok(C.WANDERER.tools.includes(r.tool)); assert.ok(!before.tools[r.tool] && g.tools[r.tool]); }
  else { assert.ok(['hide', 'metal'].includes(r.item)); assert.equal(g.stock[r.item], before[r.item] + r.n); }
  assert.equal(g.event, null);
  // left alone, he goes at nightfall
  const b = forced('wanderer', 4).g;
  b.t = (C.dayOf(b) - 1) * C.DAY + C.NIGHT_AT - 0.01;
  C.step(b, 0.05);
  const ev2 = C.drain(b);
  assert.equal(b.event, null);
  assert.equal(of(ev2, 'eventDone')[0].choice, 'ignore');
});

test('an event left unanswered takes its default at nightfall', () => {
  const { g } = forced('roof', 6);
  g.t = (C.dayOf(g) - 1) * C.DAY + C.NIGHT_AT - 0.01;
  C.step(g, 0.05);
  assert.equal(g.event, null);
  assert.equal(g.hut.roofHole, true);
  assert.equal(of(C.drain(g), 'eventDone')[0].choice, 'later');
});

test('events survive a save and restore; broken ones are refused; old saves get none', () => {
  const { g } = forced('wanderer', 4);
  const back = C.restore(JSON.parse(JSON.stringify(C.snapshot(g))));
  assert.deepEqual([back.event, back.lastEvent, back.eventsSeen], [g.event, g.lastEvent, g.eventsSeen]);
  assert.equal(C.interact(back, g.event.x, g.event.y), 'wanderer');
  const old = JSON.parse(JSON.stringify(C.snapshot(g)));
  for (const k of ['event', 'lastEvent', 'eventsSeen']) delete old[k];
  delete old.hut.roofHole; delete old.hut.patchPaid;
  const o = C.restore(old);
  assert.deepEqual([o.event, o.lastEvent, o.eventsSeen, o.hut.roofHole], [null, null, {}, false]);
  const snap = C.snapshot(g);
  for (const bad of [{ ...snap, event: { id: 'flood', phase: 'ask', day: 3 } }, { ...snap, event: { ...snap.event, phase: 'done' } }, { ...snap, event: { ...snap.event, x: 99 } },
    { ...snap, event: { id: 'roof', phase: 'active', day: 3 } }, { ...snap, lastEvent: 'flood' }, { ...snap, eventsSeen: { roof: -1 } }, { ...snap, hut: { ...snap.hut, roofHole: 'yes' } }]) {
    assert.equal(C.restore(bad), null, JSON.stringify(bad.event));
  }
  // answers: nothing outside a winter
  g.status = 'won';
  assert.equal(C.answerEvent(g, 'help'), 'bad');
});
