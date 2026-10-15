'use strict';
// Рубеж: the line, the economy, building, recruiting, combat, waves, the end of a level, saves and progress.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../web/front/core.js');

// A plain test level: forest, quarry and mine close, a chasm, plots on both sides.
const DEF = {
  name: 'Тест',
  map: '..#T#S#M#..__..#.........#........',
  start: { wood: 500, stone: 500, metal: 500 }, fortressHp: 500, towers: 0, par: 300,
  waves: [{ at: 1000, units: { raider: 1 } }],
};
const level = (over = {}) => F.parseLevel({ ...DEF, ...over });
const sim = (g, seconds, frame = 0.05) => { for (let t = 0; t < seconds - 1e-9; t += frame) F.step(g, frame); };
const of = (events, type) => events.filter((e) => e.type === type);
// Builds something and waits for it.
function raise(g, target, id) {
  assert.equal(F.build(g, target, id), 'ok', id);
  sim(g, (id === 'bridge' ? F.BUILD.bridge.time * g.chasms[target.chasm].segments : F.BUILD[id] ? F.BUILD[id].time : F.STONE_WALL.time) + 0.2);
}

test('parseLevel reads the map: plots, nodes, chasms, length', () => {
  const lv = level();
  assert.equal(lv.L, DEF.map.length * F.CELL);
  assert.deepEqual(lv.plots.map((p) => p.x), [10, 18, 26, 34, 62, 102]);
  assert.deepEqual(lv.nodes.map((n) => n.res), ['wood', 'stone', 'metal']);
  assert.deepEqual(lv.chasms, [{ x0: 44, x1: 52, segments: 2 }]);
  assert.equal(lv.armor, 0);
  for (const bad of [{ map: 'x' }, { map: '..#Q#....................' }, { map: '_.#T#.........................' }, { map: '..' }, { fortressHp: 0 },
    { waves: [{ at: 5, units: { dragon: 1 } }] }, { waves: [{ at: -1, units: {} }] }]) {
    assert.throws(() => level(bad), JSON.stringify(bad));
  }
  assert.throws(() => F.parseLevel(null));
});

test('a new level: two workers at the keep, the start resources, the army holding', () => {
  const g = F.newGame(level(), 1);
  assert.equal(F.count(g, 'worker'), F.START_WORKERS);
  assert.deepEqual(g.res, DEF.start);
  assert.equal(g.order, 'hold');
  assert.equal(F.status(g), 'playing');
  assert.equal(F.workerCap(g), F.WORKER_BASE);
  assert.equal(F.frontier(g), 44);
  assert.equal(F.newGame(DEF, 'x').seed, 1, 'a raw definition and a bad seed work');
});

test('workers gather 10 at a node in 3 s and carry it to the keep', () => {
  const g = F.newGame(level({ start: { wood: 0, stone: 0, metal: 0 } }), 1);
  const ev = [];
  for (let t = 0; t < 20; t += 0.05) { F.step(g, 0.05); ev.push(...F.drain(g)); }
  // the forest at 14 m: 8 m there and back at 3 m/s plus 3 s of work
  assert.ok(of(ev, 'deposit').length >= 2);
  assert.ok(g.res.wood >= 20 && g.res.wood % F.GATHER.load === 0);
  assert.equal(g.res.stone, 0, 'everybody gathers wood by default');
});

test('the allocation sends workers to stone and metal; at most two work a node at once', () => {
  const g = F.newGame(level({ start: { wood: 500, stone: 0, metal: 0 } }), 1);
  for (let i = 0; i < 1; i++) F.recruit(g, 'worker');
  sim(g, 5);
  assert.ok(F.setAlloc(g, 'stone', 1));
  assert.ok(F.setAlloc(g, 'metal', 2));
  assert.equal(F.setAlloc(g, 'gold', 1), false);
  assert.equal(F.setAlloc(g, 'stone', NaN), false);
  sim(g, 30);
  assert.ok(g.res.stone > 0 && g.res.metal > 0, JSON.stringify(g.res));
  let max = 0;
  for (let t = 0; t < 20; t += 0.05) {
    F.step(g, 0.05);
    max = Math.max(max, g.units.filter((u) => u.kind === 'worker' && u.res === 'metal' && u.phase === 'work').length);
  }
  assert.ok(max <= F.NODE_SLOTS);
});

test('nodes beyond an open chasm are out of reach until the bridge is built', () => {
  const lv = level({ map: '..#T#..__..M....#........' });
  const g = F.newGame(lv, 1);
  assert.equal(F.reachableNodes(g, 'metal').length, 0);
  F.setAlloc(g, 'metal', 2);
  sim(g, 15);
  assert.equal(g.res.metal, DEF.start.metal, 'workers fall back to wood');
  assert.equal(F.canBuild(g, { plot: 2 }, 'house'), 'locked', 'plots beyond the chasm are locked');
  raise(g, { chasm: 0 }, 'bridge');
  assert.ok(g.chasms[0].bridged);
  assert.equal(F.reachableNodes(g, 'metal').length, 1);
  sim(g, 40);
  assert.ok(g.res.metal > DEF.start.metal);
});

test('building costs, refusals and construction time', () => {
  const g = F.newGame(level({ start: { wood: 60, stone: 20, metal: 0 } }), 1);
  assert.equal(F.canBuild(g, { plot: 0 }, 'tower'), 'nores');
  assert.deepEqual(F.missing(g, F.costOf('tower')), { stone: 20 });
  assert.equal(F.build(g, { plot: 0 }, 'castle'), 'bad');
  assert.equal(F.build(g, { plot: 99 }, 'house'), 'bad');
  assert.equal(F.build(g, null, 'house'), 'bad');
  assert.equal(F.build(g, { plot: 0 }, 'house'), 'ok');
  assert.deepEqual(g.res, { wood: 30, stone: 20, metal: 0 });
  assert.equal(F.build(g, { plot: 0 }, 'house'), 'busy');
  sim(g, F.BUILD.house.time - 0.5);
  assert.equal(g.plots[0].b.done, false);
  sim(g, 1);
  assert.equal(g.plots[0].b.done, true);
  assert.equal(F.workerCap(g), F.WORKER_BASE + F.HOUSE_WORKERS);
  assert.equal(F.costOf('soldier'), F.UNITS.soldier.cost);
  assert.equal(F.costOf('nothing'), null);
  assert.deepEqual(F.bridgeCost(F.newGame(level(), 1), 0), { wood: 60 }, 'a two-segment bridge costs twice');
  assert.ok(F.afford(g, { wood: 10 }));
});

test('recruiting: barracks and forge unlock units, the worker cap and the queue', () => {
  const g = F.newGame(level(), 1);
  assert.equal(F.recruit(g, 'soldier'), 'locked');
  assert.equal(F.recruit(g, 'dragon'), 'bad');
  assert.equal(F.recruit(g, 'worker'), 'ok');
  assert.equal(F.recruit(g, 'worker'), 'cap', 'two workers plus one queued fill the cap of three');
  raise(g, { plot: 0 }, 'barracks');
  assert.equal(F.recruit(g, 'knight'), 'locked');
  assert.equal(F.recruit(g, 'soldier'), 'ok');
  assert.equal(F.recruit(g, 'archer'), 'ok');
  assert.equal(F.armySize(g), 2);
  sim(g, F.UNITS.soldier.time + F.UNITS.archer.time + 0.5);
  assert.deepEqual(g.units.filter((u) => u.kind !== 'worker').map((u) => u.kind).sort(), ['archer', 'soldier']);
  raise(g, { plot: 1 }, 'forge');
  assert.equal(F.recruit(g, 'knight'), 'ok');
  assert.equal(F.recruit(g, 'catapult'), 'ok');
  const poor = F.newGame(level({ start: { wood: 0, stone: 0, metal: 0 } }), 1);
  assert.equal(F.recruit(poor, 'worker'), 'nores');
});

test('a wall blocks enemies and takes their blows; the army holds right behind it', () => {
  const g = F.newGame(level({ waves: [{ at: 0.1, units: { brute: 1 } }] }), 1);
  raise(g, { plot: 3 }, 'wall');
  assert.equal(F.frontWall(g), 34);
  const ev = [];
  let hitAt = -1;
  for (let t = 0; t < 150 && (hitAt < 0 || t < hitAt + 10); t += 0.05) {
    F.step(g, 0.05);
    ev.push(...F.drain(g));
    if (hitAt < 0 && of(ev, 'wallHit').length) hitAt = t;
  }
  assert.ok(hitAt > 0, 'the brute hits the wall');
  assert.equal(of(ev, 'keepHit').length, 0, 'the keep is untouched behind the wall');
  assert.ok(g.foes.every((f) => f.x > 34));
});

test('a stone wall upgrade holds longer', () => {
  const g = F.newGame(level(), 1);
  raise(g, { plot: 3 }, 'wall');
  assert.equal(g.plots[3].b.maxHp, F.BUILD.wall.hp);
  assert.equal(F.canBuild(g, { plot: 0 }, 'stonewall'), 'bad', 'no wall there');
  raise(g, { plot: 3 }, 'stonewall');
  assert.equal(g.plots[3].b.maxHp, F.STONE_WALL.hp);
  assert.equal(F.canBuild(g, { plot: 3 }, 'stonewall'), 'bad', 'once');
});

test('a tower shoots enemies in range', () => {
  const g = F.newGame(level({ waves: [{ at: 0.1, units: { raider: 1 } }] }), 1);
  raise(g, { plot: 3 }, 'tower');
  const ev = [];
  for (let t = 0; t < 40; t += 0.05) { F.step(g, 0.05); ev.push(...F.drain(g)); }
  const shots = of(ev, 'shot').filter((e) => e.kind === 'tower');
  assert.ok(shots.length > 0);
  for (const s of shots) assert.ok(Math.abs(s.to - s.from) <= F.BUILD.tower.range + 1e-9);
  assert.ok(of(ev, 'kill').some((e) => e.side === 'foe'));
});

test('combat on the line: soldiers beat a raider, enemies walk on to the keep', () => {
  const g = F.newGame(level({ waves: [{ at: 0.1, units: { raider: 1 } }] }), 2);
  raise(g, { plot: 0 }, 'barracks');
  F.recruit(g, 'soldier');
  F.recruit(g, 'soldier');
  const ev = [];
  for (let t = 0; t < 60; t += 0.05) { F.step(g, 0.05); ev.push(...F.drain(g)); }
  assert.ok(of(ev, 'kill').some((e) => e.side === 'foe' && e.kind === 'raider'));
  const lone = F.newGame(level({ waves: [{ at: 0.1, units: { brute: 2 } }] }), 2);
  const ev2 = [];
  for (let t = 0; t < 120; t += 0.05) { F.step(lone, 0.05); ev2.push(...F.drain(lone)); }
  assert.ok(of(ev2, 'keepHit').length > 0, 'with nobody in the way the keep is hit');
});

test('the attack order: the army marches, takes the fortress and wins', () => {
  const g = F.newGame(level({ map: '..#T#S#M#..........#..', fortressHp: 100 }), 1);
  raise(g, { plot: 0 }, 'barracks');
  for (let i = 0; i < 3; i++) F.recruit(g, 'soldier');
  sim(g, 20);
  assert.ok(F.setOrder(g, 'attack'));
  assert.equal(F.setOrder(g, 'charge'), false);
  const ev = [];
  for (let t = 0; t < 120 && g.status === 'playing'; t += 0.05) { F.step(g, 0.05); ev.push(...F.drain(g)); }
  assert.ok(of(ev, 'fortHit').length > 0);
  assert.equal(F.status(g), 'won');
  assert.ok(F.stars(g) >= 2);
});

test('soldiers can not cross an open chasm, enemies climb through it slowly', () => {
  const g = F.newGame(level({ waves: [{ at: 0.1, units: { raider: 1 } }] }), 1);
  raise(g, { plot: 0 }, 'barracks');
  F.recruit(g, 'soldier');
  sim(g, 10);
  F.setOrder(g, 'attack');
  sim(g, 30);
  for (const u of g.units) assert.ok(u.x < 44, `unit at ${u.x}`);
  const f = F.newGame(level({ waves: [{ at: 0.1, units: { raider: 1 } }] }), 1);
  sim(f, 2);
  const foe = f.foes[0];
  foe.x = 50;
  const x0 = foe.x;
  F.step(f, 1);
  assert.ok(x0 - foe.x <= F.ENEMIES.raider.speed * F.CHASM_SLOW + 1e-6, 'slow inside the chasm');
});

test('catapults and knights break armoured fortresses; others do a quarter', () => {
  const g = F.newGame(level({ map: '..#T#S#M#..........#..', fortressHp: 10000, armor: 0.75 }), 1);
  raise(g, { plot: 0 }, 'barracks');
  raise(g, { plot: 1 }, 'forge');
  F.recruit(g, 'soldier');
  F.recruit(g, 'catapult');
  sim(g, 20);
  F.setOrder(g, 'attack');
  const hits = {};
  for (let t = 0; t < 90; t += 0.05) { F.step(g, 0.05); for (const e of F.drain(g)) if (e.type === 'fortHit') (hits[e.kind] = hits[e.kind] || []).push(e.dmg); }
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(Math.abs(avg(hits.soldier) - F.UNITS.soldier.dmg * (1 + F.FORGE_BONUS) * 0.25) < 1.5, JSON.stringify(hits.soldier));
  assert.ok(Math.abs(avg(hits.catapult) - F.UNITS.catapult.dmg * F.UNITS.catapult.siege) < 15, JSON.stringify(hits.catapult));
});

test('the fortress towers shoot units that come close', () => {
  const g = F.newGame(level({ map: '..#T#S#M#..........#..', fortressHp: 5000, towers: 2 }), 1);
  raise(g, { plot: 0 }, 'barracks');
  F.recruit(g, 'soldier');
  sim(g, 8);
  F.setOrder(g, 'attack');
  const ev = [];
  for (let t = 0; t < 60; t += 0.05) { F.step(g, 0.05); ev.push(...F.drain(g)); }
  assert.ok(of(ev, 'shot').some((e) => e.kind === 'fort'));
  assert.ok(of(ev, 'kill').some((e) => e.side === 'own' && e.kind === 'soldier'));
});

test('waves leave on schedule, one enemy a second; then patrols keep coming and grow', () => {
  const g = F.newGame(level({ waves: [{ at: 5, units: { raider: 3 } }] }), 1);
  const ev = [];
  for (let t = 0; t < 9; t += 0.05) { F.step(g, 0.05); ev.push(...F.drain(g)); }
  assert.equal(of(ev, 'wave').length, 1);
  assert.equal(of(ev, 'wave')[0].last, true);
  assert.equal(g.foes.length, 3);
  for (let t = 0; t < F.PATROL.every * 2 + 1; t += 0.05) { F.step(g, 0.05); ev.push(...F.drain(g)); }
  const patrols = of(ev, 'patrol');
  assert.equal(patrols.length, 2);
  assert.equal(g.patrols, 2);
});

test('losing the keep ends the level; stars at their boundaries', () => {
  const g = F.newGame(level(), 1);
  g.keep.hp = 1;
  g.units = [];
  g.foes.push({ id: 999, kind: 'brute', x: F.KEEP_X + 1, hp: 100, maxHp: 100, cd: 0 });
  sim(g, 3);
  assert.equal(F.status(g), 'lost');
  assert.equal(F.stars(g), 0);
  const w = F.newGame(level(), 1);
  w.status = 'won';
  w.t = 299;
  assert.equal(F.stars(w), 3);
  w.t = 301;
  assert.equal(F.stars(w), 2);
  w.keep.hp = w.keep.maxHp * 0.59;
  assert.equal(F.stars(w), 1);
});

test('the same inputs give the same game; frame size does not matter', () => {
  const play = (frame) => {
    const g = F.newGame(level({ waves: [{ at: 3, units: { raider: 2, brute: 1 } }] }), 9);
    F.build(g, { plot: 0 }, 'barracks');
    F.setAlloc(g, 'metal', 1);
    for (let t = 0; t < 30; t += frame) { F.step(g, frame); if (Math.abs(t - 12) < frame / 2) F.recruit(g, 'soldier'); }
    return g;
  };
  const a = play(0.05), b = play(0.05);
  assert.deepEqual(F.snapshot(a), F.snapshot(b));
  const c = play(0.25);
  assert.equal(Math.round(c.t), Math.round(a.t));
});

test('step ignores bad dt and caps a long frame', () => {
  const g = F.newGame(level(), 1);
  for (const dt of [0, -1, NaN, Infinity, 'x']) F.step(g, dt);
  assert.equal(g.t, 0);
  F.step(g, 5);
  assert.ok(Math.abs(g.t - F.MAX_DT) < F.TICK);
});

test('snapshots round-trip, and broken ones are refused', () => {
  const g = F.newGame(level({ waves: [{ at: 2, units: { raider: 2 } }] }), 4);
  F.build(g, { plot: 0 }, 'barracks');
  sim(g, 12);
  const snap = JSON.parse(JSON.stringify(F.snapshot(g)));
  const back = F.restore(snap);
  assert.deepEqual(F.snapshot(back), F.snapshot(g));
  sim(back, 5);
  sim(g, 5);
  assert.deepEqual(F.snapshot(back), F.snapshot(g), 'a restored game goes on the same way');
  for (const bad of [null, {}, { ...snap, v: 2 }, { ...snap, status: 'won' }, { ...snap, res: { wood: -1 } }, { ...snap, units: [{ kind: 'dragon', x: 1, hp: 1 }] },
    { ...snap, order: 'flee' }, { ...snap, plots: [{ x: 1, b: { id: 'castle' } }] }, { ...snap, queue: ['dragon'] }]) {
    assert.equal(F.restore(bad), null, JSON.stringify(bad).slice(0, 60));
  }
});

test('progress: stars keep the best, levels unlock in order, the level in progress is kept', () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const p = F.loadProgress(storage, 12);
  assert.deepEqual(p, F.newProgress(12));
  assert.ok(F.unlocked(p, 0));
  assert.equal(F.unlocked(p, 1), false);
  assert.ok(F.recordStars(p, 0, 2));
  assert.equal(F.recordStars(p, 0, 1), false);
  assert.equal(F.recordStars(p, 99, 3), false);
  assert.ok(F.unlocked(p, 1));
  assert.equal(F.firstUnfinished(p), 1);
  p.current = { level: 1, state: F.snapshot(F.newGame(level(), 2)) };
  assert.ok(F.saveProgress(storage, p));
  const back = F.loadProgress(storage, 12);
  assert.equal(back.stars[0], 2);
  assert.equal(back.current.level, 1);
  mem.set(F.PROGRESS_KEY, '{oops');
  assert.deepEqual(F.loadProgress(storage, 12), F.newProgress(12));
  mem.set(F.PROGRESS_KEY, JSON.stringify({ v: 1, stars: [9, 2, 'x'], current: { level: 1, state: { v: 9 } } }));
  const odd = F.loadProgress(storage, 12);
  assert.deepEqual(odd.stars.slice(0, 3), [0, 2, 0]);
  assert.equal(odd.current, null);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(F.loadProgress(blocked, 12), F.newProgress(12));
  assert.equal(F.saveProgress(blocked, p), false);
  assert.equal(F.saveProgress(null, p), false);
  const all = F.newProgress(3);
  all.stars = [3, 3, 3];
  assert.equal(F.firstUnfinished(all), 2);
  assert.ok(F.clamp(5, 0, 1) === 1 && F.rand({ rng: 1 }) < 1);
});
