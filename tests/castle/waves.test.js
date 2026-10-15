'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/castle/core.js');

const kinds = (def) => def.spawns.map((s) => s.kind);
const count = (def, k) => kinds(def).filter((x) => x === k).length;

// A run that has just cleared a wave (no fighting needed: the test empties the field).
function between(seed = 1, wave = 1) {
  const run = C.newRun('campaign', seed);
  C.startWave(run, []);
  C.step(run, C.TICK);
  run.wave = wave;
  C.drain(run);
  return run;
}

test('waveDef is deterministic per (wave, seed) and differs between seeds', () => {
  assert.deepEqual(C.waveDef(12, 5), C.waveDef(12, 5));
  assert.notDeepEqual(C.waveDef(12, 5).spawns, C.waveDef(12, 6).spawns);
  assert.throws(() => C.waveDef(0, 1));
  assert.throws(() => C.waveDef(2.5, 1));
});

test('teaching waves: grunts, then shields, then flyers', () => {
  const w1 = C.waveDef(1, 9), w2 = C.waveDef(2, 9), w3 = C.waveDef(3, 9);
  assert.ok(kinds(w1).every((k) => k === 'grunt') && w1.spawns.length >= 5);
  assert.ok(count(w2, 'shield') >= 2 && !kinds(w2).includes('flyer'));
  assert.ok(count(w3, 'flyer') >= 3 && !kinds(w3).includes('ram'));
});

test('enemy types unlock in order and the budget grows', () => {
  for (let n = 4; n <= 30; n++) {
    const def = C.waveDef(n, 3);
    if (n < 5) assert.ok(!kinds(def).includes('ram'), `wave ${n} has no rams yet`);
  }
  assert.ok([5, 6, 7, 8, 9].some((n) => kinds(C.waveDef(n, 3)).includes('ram')), 'rams appear from wave 5');
  assert.ok(C.budgetOf(20) > C.budgetOf(10) * 3);
  const size = (n) => C.waveDef(n, 3).spawns.length;
  assert.ok(size(25) > size(6));
});

test('every 10th wave brings the boss, and only then', () => {
  for (let n = 1; n <= 40; n++) {
    assert.equal(count(C.waveDef(n, 2), 'boss'), n % 10 === 0 ? 1 : 0, `wave ${n}`);
  }
});

test('at most 40 enemies a wave; the rest of the budget makes them tougher', () => {
  for (const n of [30, 45, 60, 80]) {
    const def = C.waveDef(n, 4);
    assert.ok(def.spawns.length <= C.MAX_ENEMIES, `wave ${n}: ${def.spawns.length}`);
  }
  const early = C.waveDef(8, 4), late = C.waveDef(60, 4);
  assert.equal(early.hpMul, 1);
  assert.ok(late.hpMul > 2, `wave 60 hp ×${late.hpMul}`);
  assert.ok(late.speedMul > 1 && late.speedMul <= 1.5);
  assert.ok(C.waveDef(80, 4).hpMul > late.hpMul, 'and keeps growing');
});

test('spawn times are sorted and positive', () => {
  for (const n of [1, 7, 20, 50]) {
    const at = C.waveDef(n, 8).spawns.map((s) => s.at);
    assert.ok(at.every((t, i) => t > 0 && (i === 0 || t >= at[i - 1])), `wave ${n}`);
  }
});

test('startWave without a list uses waveDef and its multipliers', () => {
  const run = C.newRun('endless', 11);
  run.wave = 59;
  run.status = 'between';
  C.startWave(run);
  const def = C.waveDef(60, 11);
  assert.equal(run.queue.length, def.spawns.length);
  assert.deepEqual(run.mult, { hp: def.hpMul, speed: def.speedMul });
  for (let k = 0; k < 6; k++) C.step(run, 0.25);
  const e = run.enemies[0];
  assert.ok(e && e.maxHp > C.KINDS[e.kind].hp, 'spawned enemies get the wave multiplier');
});

test('a cleared wave offers three different upgrades from the run generator', () => {
  const a = between(5), b = between(5);
  assert.equal(a.status, 'between');
  assert.equal(a.offer.length, 3);
  assert.equal(new Set(a.offer).size, 3);
  assert.deepEqual(a.offer, b.offer, 'seeded');
  for (const id of a.offer) assert.ok(C.UPGRADES.includes(id));
});

test('capped upgrades are not offered; the pool can run short', () => {
  const run = between(1);
  for (const id of C.UPGRADES) if (Number.isFinite(C.UP_CAP[id])) run.up[id] = C.UP_CAP[id];
  for (let k = 0; k < 20; k++) assert.deepEqual(C.offerUpgrades(run), ['power']);
});

test('one pick per break, only from the offer; stacking is additive with caps', () => {
  const run = between(2);
  run.offer = ['multi', 'reload', 'ward'];
  assert.equal(C.chooseUpgrade(run, 'power'), false, 'not offered');
  assert.equal(C.chooseUpgrade(run, 'multi'), true);
  assert.equal(C.chooseUpgrade(run, 'reload'), false, 'one per break');
  assert.equal(C.stats(run).arrows, 2);
  // additive stacks and caps
  run.up.power = 3;
  assert.ok(Math.abs(C.stats(run).damage - 1.6) < 1e-12);
  run.up.reload = 99;
  assert.equal(C.stats(run).reload, C.RELOAD_BASE * C.RELOAD_FLOOR, 'the reload floor');
  const w = between(3);
  w.offer = ['ward'];
  C.chooseUpgrade(w, 'ward');
  assert.equal(w.ward, 2, 'a ward pick fills the new charge at once');
  w.up.multi = C.UP_CAP.multi;
  w.picked = false;
  w.offer = ['multi'];
  assert.equal(C.chooseUpgrade(w, 'multi'), false, 'capped');
  const fresh = C.newRun();
  fresh.offer = ['power'];
  assert.equal(C.chooseUpgrade(fresh, 'power'), false, 'not during ready');
});

test('shop: repair heals a quarter, fortify raises the max and heals as much; prices grow', () => {
  const run = between(1);
  run.gold = 1000;
  assert.equal(C.buy(run, 'repair'), 'full', 'nothing to repair');
  run.wallHp = 40;
  const p0 = C.prices(run);
  assert.deepEqual(p0, { repair: 30, fortify: 50 });
  assert.equal(C.buy(run, 'repair'), 'ok');
  assert.equal(run.wallHp, 65);
  assert.equal(run.gold, 970);
  assert.equal(C.prices(run).repair, 39);
  assert.equal(C.buy(run, 'fortify'), 'ok');
  assert.equal(run.wallMax, 120);
  assert.equal(run.wallHp, 85);
  assert.equal(C.prices(run).fortify, 70);
  run.wallHp = 119;
  C.buy(run, 'repair');
  assert.equal(run.wallHp, 120, 'repair never goes past the max');
  run.gold = 1;
  run.wallHp = 10;
  assert.equal(C.buy(run, 'repair'), 'nogold');
  assert.equal(C.buy(run, 'tower'), 'unknown');
  run.status = 'wave';
  run.gold = 999;
  assert.equal(C.buy(run, 'repair'), 'closed', 'only between waves');
});

test('the score counts kills and the waves before the last', () => {
  const run = C.newRun('endless', 1);
  run.kills = 12;
  run.wave = 7;
  assert.equal(C.score(run), 12 * 10 + 6 * 100);
  assert.equal(C.score(C.newRun()), 0);
});

test('snapshot / restore round-trip keeps the cleared wave, the same offer and the purchases', () => {
  const run = between(7, 4);
  run.gold = 200;
  run.wallHp = 50;
  C.buy(run, 'repair');
  const offer = run.offer.slice();
  const snap = JSON.parse(JSON.stringify(C.snapshot(run)));
  const back = C.restore(snap);
  assert.equal(back.status, 'between');
  assert.equal(back.wave, 4);
  assert.deepEqual(back.offer, offer, 'the same three cards after a reload');
  assert.equal(back.wallHp, run.wallHp);
  assert.equal(back.gold, run.gold);
  assert.deepEqual(back.bought, { repair: 1, fortify: 0 });
  assert.equal(back.rng, run.rng);
  // the next wave plays out the same from the restored run
  C.chooseUpgrade(run, offer[0]);
  C.chooseUpgrade(back, offer[0]);
  C.startWave(run);
  C.startWave(back);
  for (let k = 0; k < 600; k++) { C.step(run, C.TICK); C.step(back, C.TICK); }
  assert.deepEqual(back.enemies.map((e) => [e.kind, e.x, e.y]), run.enemies.map((e) => [e.kind, e.x, e.y]));
});

test('restore rejects broken snapshots', () => {
  const good = C.snapshot(between(1));
  assert.ok(C.restore(good));
  const bad = [
    null, 5, {}, { ...good, v: 2 }, { ...good, mode: 'story' }, { ...good, status: 'wave' }, { ...good, wave: -1 },
    { ...good, wallHp: 500 }, { ...good, gold: -1 }, { ...good, up: { ...good.up, multi: 9 } }, { ...good, up: null },
    { ...good, offer: ['laser'] }, { ...good, offer: 'x' }, { ...good, bought: {} }, { ...good, seed: 1.5 },
  ];
  for (const b of bad) assert.equal(C.restore(b), null, JSON.stringify(b).slice(0, 80));
  const odd = C.restore({ ...good, aim: { angle: 'x' }, ward: 99 });
  assert.ok(odd);
  assert.equal(odd.ward, C.stats(odd).wardMax, 'ward clamped');
  assert.ok(Number.isFinite(odd.aim.angle));
});

// A Storage-like object backed by a Map; `broken` makes every call throw.
function memoryStorage(broken = false) {
  const m = new Map();
  return {
    m,
    getItem(k) { if (broken) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (broken) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
  };
}

test('castle.save: defaults, round-trip, broken data and blocked storage', () => {
  const clean = { v: 1, campaignBest: 0, campaignDone: false, endlessBest: 0, current: null };
  assert.deepEqual(C.loadSave(memoryStorage()), clean);
  assert.deepEqual(C.loadSave(memoryStorage(true)), clean);
  assert.deepEqual(C.loadSave(null), clean);
  for (const raw of ['', '{', 'null', '[]', '{"v":2}', '7']) assert.deepEqual(C.parseSave(raw), clean, raw);
  assert.equal(C.SAVE_KEY, 'castle.save');

  const st = memoryStorage();
  const save = C.newSave();
  save.campaignBest = 7;
  save.endlessBest = 4321;
  save.current = C.snapshot(between(3, 7));
  assert.equal(C.storeSave(st, save), true);
  const back = C.loadSave(st);
  assert.equal(back.campaignBest, 7);
  assert.equal(back.endlessBest, 4321);
  assert.deepEqual(back.current, JSON.parse(JSON.stringify(save.current)));
  assert.equal(C.storeSave(memoryStorage(true), save), false);

  const junk = C.parseSave(JSON.stringify({ v: 1, campaignBest: 99, campaignDone: 'yes', endlessBest: -5, current: { v: 1 } }));
  assert.deepEqual(junk, clean);
});

test('recordRun keeps the campaign waves cleared, completion and the endless best', () => {
  const save = C.newSave();
  const c = C.newRun('campaign', 1);
  c.wave = 6; c.status = 'lost';
  assert.equal(C.recordRun(save, c), true);
  assert.equal(save.campaignBest, 5, 'lost in wave 6: five cleared');
  c.wave = 6; c.status = 'between';
  C.recordRun(save, c);
  assert.equal(save.campaignBest, 6, 'cleared wave 6');
  c.wave = 30; c.status = 'won';
  C.recordRun(save, c);
  assert.equal(save.campaignBest, 30);
  assert.equal(save.campaignDone, true);
  assert.equal(C.recordRun(save, c), false, 'nothing new');
  const e = C.newRun('endless', 1);
  e.kills = 50; e.wave = 12; e.status = 'lost';
  assert.equal(C.recordRun(save, e), true);
  assert.equal(save.endlessBest, 500 + 1100);
  e.kills = 1;
  assert.equal(C.recordRun(save, e), false, 'a worse run keeps the record');
});

test('clearing wave 30 wins the campaign; endless goes on', () => {
  const c = C.newRun('campaign', 1);
  c.wave = 29; c.status = 'between';
  C.startWave(c, []);
  C.step(c, C.TICK);
  assert.equal(c.status, 'won');
  assert.deepEqual(c.offer, []);
  const e = C.newRun('endless', 1);
  e.wave = 29; e.status = 'between';
  C.startWave(e, []);
  C.step(e, C.TICK);
  assert.equal(e.status, 'between');
});
