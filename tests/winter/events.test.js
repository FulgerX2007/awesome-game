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

// A game with the child at home, whose next dawn rolls the lost child.
function childGame(day = 6) {
  for (let s = 1; s < 600; s++) {
    const g = quiet(s);
    g.hut.stage = 4; g.hut.stove = 30;
    const c = g.survivors.find((x) => x.id === 'child');
    c.state = 'home'; c.x = 27.5; c.y = 22.5; c.food = 100;
    g.t = (day - 1) * C.DAY - 0.01;
    toDawn(g);
    if (g.event && g.event.id === 'lostChild') return { g, c };
  }
  throw new Error('no seed loses the child');
}

test('the lost child: he walks off, the hero fetches him, he comes home without joining again', () => {
  const { g, c } = childGame();
  assert.equal(c.state, 'lost');
  assert.equal(C.nextTask(g), 'Найди ребёнка до ночи');
  sim(g, 20);
  const d = Math.hypot(c.x - (C.SPOT.fire.x + 0.5), c.y - (C.SPOT.fire.y + 0.5));
  assert.ok(d > 6, `walked off: ${d.toFixed(1)}`);
  assert.equal(C.interact(g, c.x, c.y), 'fetch');
  const ev = [];
  for (let t = 0; t < 60 && c.state === 'lost'; t += 0.25) { C.step(g, 0.25); ev.push(...C.drain(g)); }
  assert.equal(c.state, 'following');
  assert.deepEqual(of(ev, 'eventDone').map((e) => e.choice), ['fetched']);
  assert.equal(g.event, null);
  C.interact(g, 27, 21);
  for (let t = 0; t < 80 && c.state !== 'home'; t += 0.25) { C.step(g, 0.25); ev.push(...C.drain(g)); }
  assert.equal(c.state, 'home');
  assert.equal(of(ev, 'found').length, 1);
  assert.equal(of(ev, 'joined').length, 0, 'no second «joined»');
  assert.ok(!('back' in c));
});

test('the lost child: night in the forest costs him; he comes back at dawn; he can die of it', () => {
  const { g, c } = childGame();
  c.hp = 100;
  g.t = (C.dayOf(g) - 1) * C.DAY + C.NIGHT_AT - 0.01;
  C.step(g, 0.05);
  const ev = C.drain(g);
  assert.equal(c.hp, 100 - C.LOST_CHILD.night);
  assert.equal(c.state, 'lost');
  assert.equal(of(ev, 'eventDone')[0].choice, 'night');
  // dawn brings him home
  const dawn = toDawn(g);
  assert.equal(c.state, 'home');
  assert.equal(of(dawn, 'found').length, 1);
  // weak already: the night kills him
  const b = childGame();
  b.g.t = (C.dayOf(b.g) - 1) * C.DAY + C.NIGHT_AT - 0.01;
  b.c.hp = 30;
  C.step(b.g, 0.05);
  assert.equal(b.c.state, 'dead');
  assert.equal(of(C.drain(b.g), 'died').length, 1);
});

test('the lost child counts as alive for the stars, and comes home before the final dawn is judged', () => {
  const { g, c } = childGame(29);
  for (const s of g.survivors) if (s !== c) s.state = 'home';
  g.t = C.DAYS * C.DAY - 0.01;
  g.hut.stage = C.HUT_STAGES.length;
  C.step(g, 0.05);
  assert.equal(g.status, 'won');
  assert.equal(c.state, 'home');
  assert.equal(C.stars(g), 3);
  // and a still-lost one counts too
  const w = childGame(10);
  w.g.status = 'won';
  for (const s of w.g.survivors) if (s !== w.c) s.state = 'home';
  w.g.hut.stage = 4;
  assert.equal(C.stars(w.g), 3);
});

test('the aurora: no wolves that night; strength for the hero and the camp', () => {
  let found = null;
  for (let s = 1; s < 600 && !found; s++) {
    const g = quiet(s);
    g.hut.stage = 4;
    g.t = 7 * C.DAY - 0.01;
    toDawn(g);
    if (g.event && g.event.id === 'aurora') found = g;
  }
  const g = found;
  const sv = g.survivors[0];
  sv.state = 'home'; sv.hp = 50; sv.food = 100;
  g.hero.energy = 40;
  g.t = (C.dayOf(g) - 1) * C.DAY + C.NIGHT_AT - 0.01;
  C.step(g, 0.05);
  const ev = C.drain(g);
  assert.equal(g.wolves.length, 0);
  assert.equal(of(ev, 'howl').length, 0);
  assert.equal(of(ev, 'aurora').length, 1);
  assert.ok(g.hero.energy >= 40 + C.AURORA.energy - 0.1);
  assert.ok(sv.hp >= 50 + C.AURORA.hp - 0.5);
  assert.equal(g.event.id, 'aurora', 'it stays up for the night sky');
});

test('the thaw: a warmer day, then the crust slows the hero outside the camp only', () => {
  let found = null;
  for (let s = 1; s < 600 && !found; s++) {
    const g = quiet(s);
    g.t = 9 * C.DAY - 0.01;
    toDawn(g);
    if (g.event && g.event.id === 'thaw') found = g;
  }
  const g = found;
  const ref = quiet(1);
  ref.t = g.t;
  assert.equal(C.temperature(g), C.temperature(ref) + C.THAW.warm);
  assert.equal(g.iceDay, C.dayOf(g) + 1);
  const ev = toDawn(g);
  assert.ok(C.iceOn(g));
  assert.equal(g.event, null, 'the crust takes the day');
  assert.equal(of(ev, 'ice').length, 1);
  assert.equal(C.temperature(g), C.temperature(Object.assign(quiet(1), { t: g.t })));
  // walking outside is slower, inside the camp it is not
  const walk = (x, y) => { g.hero.x = x + 0.5; g.hero.y = y + 0.5; g.hero.path = null; g.hero.target = null; C.moveDir(g, 1, 0); const x0 = g.hero.x; C.step(g, 0.5); C.moveDir(g, 0, 0); return g.hero.x - x0; };
  const out = walk(8, 30), inside = walk(24, 21);
  g.iceDay = 0;
  const outDry = walk(8, 30);
  assert.ok(Math.abs(out / outDry - C.THAW.ice) < 0.02, `${out} vs ${outDry}`);
  assert.ok(inside > out);
  // never late in the winter
  for (let s = 1; s < 200; s++) {
    const h = quiet(s);
    h.t = C.THAW.lastDay * C.DAY - 0.01;
    toDawn(h);
    assert.ok(!h.event || h.event.id !== 'thaw');
  }
});

test('a lost child, the aurora and the ice survive a save and restore', () => {
  const { g, c } = childGame();
  sim(g, 5);
  const back = C.restore(JSON.parse(JSON.stringify(C.snapshot(g))));
  const bc = back.survivors.find((x) => x.id === 'child');
  assert.equal(bc.state, 'lost');
  assert.deepEqual(back.event, g.event);
  assert.equal(C.interact(back, bc.x, bc.y), 'fetch');
  g.iceDay = C.dayOf(g);
  assert.ok(C.iceOn(C.restore(JSON.parse(JSON.stringify(C.snapshot(g))))));
  const snap = C.snapshot(g);
  for (const bad of [{ ...snap, iceDay: -1 }, { ...snap, iceDay: 1.5 }, { ...snap, event: { id: 'aurora', phase: 'ask', day: 3 } }, { ...snap, event: { id: 'lostChild', phase: 'active', day: 3 } }]) {
    assert.equal(C.restore(bad), null);
  }
  void c;
});
