'use strict';
// Путь героя: nodes, rewards, the bag, the forge, the shop, the camp, permanent upgrades, snapshots and the save.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/hero/core.js');
const K = require('../../web/hero/content.js');

// A run with a node of `kind` entered (searching seeds until the first act has one after row 0).
function entered(kind, seed0 = 1) {
  for (let seed = seed0; seed < seed0 + 200; seed++) {
    const run = C.newRun(C.newSave(), seed);
    const node = run.map.nodes.find((n) => n.kind === kind && n.row > 0);
    if (!node) continue;
    const pred = run.map.nodes.find((n) => n.next.includes(node.id));
    run.at = pred.id;
    assert.ok(C.choose(run, node.id));
    return run;
  }
  throw new Error(`no ${kind}`);
}

// Fights the current battle to its end with an unbeatable hero.
function win(run) {
  C.startBattle(run);
  run.hero.hp = 1e6;
  run.hero.bonus.atk = 500;
  for (let i = 0; i < 6000 && run.phase === 'battle'; i++) C.step(run, 0.25);
  run.hero.bonus.atk = 0;
  C.drain(run);
}

const fill = (run) => { while (run.bag.length < C.bagMax(run)) run.bag.push({ uid: run.nextUid++, id: 'leather', tier: 1 }); };

test('a chest offers three items; one goes into the bag, or the chest can be skipped', () => {
  const run = entered('chest');
  assert.equal(run.phase, 'chest');
  assert.equal(run.offer.length, 3);
  assert.equal(new Set(run.offer.map((o) => o.id)).size, 3);
  for (const o of run.offer) assert.ok(K.ITEMS[o.id].pool.includes(1));
  const id = run.offer[1].id;
  assert.equal(C.pickReward(run, 1), 'ok');
  assert.equal(run.bag[run.bag.length - 1].id, id);
  assert.equal(run.phase, 'map');

  const skip = entered('chest');
  const n = skip.bag.length;
  assert.equal(C.pickReward(skip, null), 'ok');
  assert.equal(skip.bag.length, n);
  assert.equal(skip.phase, 'map');
});

test('a full bag refuses a reward until something is discarded', () => {
  const run = entered('chest');
  fill(run);
  assert.equal(C.pickReward(run, 0), 'full');
  assert.equal(run.phase, 'chest');
  assert.ok(C.discard(run, run.bag[run.bag.length - 1].uid));
  assert.equal(C.pickReward(run, 0), 'ok');
  assert.equal(C.pickReward(run, 0), 'bad', 'the chest is gone');
  assert.equal(C.pickReward(entered('chest'), 7), 'bad');
});

test('discard: the last weapon stays, an equipped weapon is replaced, an equipped armour is taken off', () => {
  const run = C.newRun(C.newSave(), 1);
  assert.equal(C.discard(run, run.eq.weapon), false, 'the only weapon');
  const sword = { uid: run.nextUid++, id: 'sword', tier: 1 }, coat = { uid: run.nextUid++, id: 'plate', tier: 1 };
  run.bag.push(sword, coat);
  assert.ok(C.equip(run, coat.uid));
  assert.equal(C.stats(run).maxHp, C.HP_BASE + K.ITEMS.plate.hp);
  run.hero.hp = C.stats(run).maxHp;
  assert.ok(C.discard(run, run.eq.weapon));
  assert.equal(run.eq.weapon, sword.uid);
  assert.ok(C.discard(run, coat.uid));
  assert.equal(run.eq.armor, null);
  assert.equal(run.hero.hp, C.HP_BASE, 'health is clamped to the new maximum');
  assert.equal(C.discard(run, 999), false);
  assert.equal(C.equip(run, 999), false);
});

test('the bag order sets the four quick slots', () => {
  const run = C.newRun(C.newSave(), 1);
  for (const id of ['sword', 'axe', 'dagger', 'spear', 'chain']) run.bag.push({ uid: run.nextUid++, id, tier: 1 });
  assert.deepEqual(C.quickSlots(run).map((x) => x.id), ['rusty_sword', 'sword', 'axe', 'dagger']);
  const spear = run.bag.find((x) => x.id === 'spear');
  assert.ok(C.moveItem(run, spear.uid, 0));
  assert.deepEqual(C.quickSlots(run).map((x) => x.id), ['spear', 'rusty_sword', 'sword', 'axe']);
  assert.equal(C.moveItem(run, 999, 0), false);
});

test('a shrine offers three perks at double strength', () => {
  const run = entered('shrine');
  assert.equal(run.phase, 'shrine');
  run.offer = ['might', 'vigor', 'focus'];
  const atk = C.stats(run).atk;
  assert.equal(C.pickReward(run, 0), 'ok');
  assert.equal(C.stats(run).atk, atk + 2 * K.PERKS.might.atk);
});

test('the forge raises a tier or reforges a weapon type, once', () => {
  const run = entered('forge');
  const w = run.bag[0];
  assert.equal(C.forge(run, w.uid, 'reforge', 'phys'), 'same');
  assert.equal(C.forge(run, w.uid, 'reforge', 'void'), 'bad');
  assert.equal(C.forge(run, w.uid, 'polish'), 'bad');
  assert.equal(C.forge(run, w.uid, 'upgrade'), 'ok');
  assert.equal(w.tier, 2);
  assert.equal(run.phase, 'map');
  assert.equal(C.forge(run, w.uid, 'upgrade'), 'bad', 'one use per forge');

  const re = entered('forge');
  assert.equal(C.forge(re, re.bag[0].uid, 'reforge', 'holy'), 'ok');
  assert.equal(C.itemStats(re.bag[0]).type, 'holy');

  const max = entered('forge');
  max.bag[0].tier = C.MAX_TIER;
  assert.equal(C.forge(max, max.bag[0].uid, 'upgrade'), 'max');
  const coat = { uid: max.nextUid++, id: 'chain', tier: 1 };
  max.bag.push(coat);
  assert.equal(C.forge(max, coat.uid, 'reforge', 'fire'), 'bad', 'only weapons are reforged');
  assert.ok(C.leave(max));
  assert.equal(max.phase, 'map');
});

test('the shop sells items and potions, buys items back, and refuses without gold or room', () => {
  const run = entered('shop');
  assert.equal(run.offer.length, 5);
  assert.equal(run.offer[4].kind, 'potion');
  assert.equal(C.buy(run, 0), 'nogold');
  run.gold = 1000;
  assert.equal(C.buy(run, 0), 'ok');
  assert.equal(run.gold, 1000 - run.offer[0].price);
  assert.equal(C.buy(run, 0), 'sold');
  assert.equal(C.buy(run, 4), 'ok');
  assert.equal(run.hero.potions, 2);
  run.hero.potions = C.MAX_POTIONS;
  assert.equal(C.buy(run, 4), 'full');
  fill(run);
  assert.equal(C.buy(run, 1), 'full');
  assert.equal(C.buy(run, 9), 'bad');
  const item = run.bag[run.bag.length - 1], gold = run.gold;
  assert.ok(C.sell(run, item.uid));
  assert.equal(run.gold, gold + C.sellPrice(item));
  assert.equal(C.sell(run, run.eq.weapon), run.bag.filter((x) => K.ITEMS[x.id].slot === 'weapon').length > 1);
  assert.ok(C.leave(run));
  assert.equal(C.buy(run, 1), 'bad', 'the shop is closed');
  assert.equal(C.sell(run, run.bag[0].uid), false);
  assert.equal(C.leave(run), false);
});

test('the camp heals 40% or trains a level', () => {
  const run = entered('camp');
  run.hero.hp = 10;
  assert.ok(C.camp(run, 'rest'));
  assert.ok(Math.abs(run.hero.hp - (10 + C.stats(run).maxHp * C.CAMP_HEAL)) < 1e-9);
  assert.equal(C.camp(run, 'rest'), false);
  const t = entered('camp');
  assert.equal(C.camp(t, 'nap'), false);
  assert.ok(C.camp(t, 'train'));
  assert.equal(t.hero.level, 2);
  assert.equal(t.phase, 'perk');
});

test('battles and elites: rewards, then the elite loot; a perk comes first after a level-up', () => {
  const run = entered('elite');
  assert.equal(run.encounter[0].elite, true);
  run.hero.xp = C.xpToNext(1) - 1;
  win(run);
  assert.equal(run.phase, 'perk');
  assert.ok(C.pickPerk(run, 2));
  while (run.phase === 'perk') C.pickPerk(run, 0);
  assert.equal(run.phase, 'loot');
  assert.equal(run.offer.length, 3);
  for (const o of run.offer) assert.equal(o.tier, 2, 'loot is one tier above the act');
  assert.equal(C.pickPerk(run, 0), false, 'no perk is pending');
  assert.equal(C.pickReward(run, null), 'ok');
  assert.equal(run.phase, 'map');
});

test('a boss win heals, moves to the next act with a new map and offers loot; the third boss wins the run', () => {
  const run = C.newRun(C.newSave(), 4);
  const camp = run.map.rows[7][0], boss = run.map.rows[8][0];
  run.at = camp;
  assert.ok(C.choose(run, boss));
  assert.equal(run.encounter[0].kind, K.BOSS_OF_ACT[1]);
  const map1 = run.map;
  win(run);
  while (run.phase === 'perk') C.pickPerk(run, 0);
  assert.equal(run.phase, 'loot');
  assert.equal(C.pickReward(run, null), 'ok');
  assert.equal(run.act, 2);
  assert.notDeepEqual(run.map, map1);
  assert.equal(run.at, null);
  assert.equal(run.bosses, 1);
  assert.equal(run.phase, 'map');

  run.act = 3;
  run.map = C.genMap(run.seed, 3);
  run.at = run.map.rows[7][0];
  assert.ok(C.choose(run, run.map.rows[8][0]));
  assert.equal(run.encounter[0].kind, 'ash_lord');
  win(run);
  assert.equal(run.phase, 'won');
  assert.equal(run.bosses, 2);
  assert.equal(C.status(run), 'won');
});

test('battle encounters grow with the row', () => {
  const sizes = { early: [], late: [] };
  for (let seed = 1; seed < 80; seed++) {
    const run = C.newRun(C.newSave(), seed);
    for (const n of run.map.nodes.filter((x) => x.kind === 'battle')) {
      const pred = run.map.nodes.find((p) => p.next.includes(n.id));
      const r = C.restore(C.snapshot(run));
      r.at = pred ? pred.id : null;
      if (!C.choose(r, n.id)) continue;
      (n.row <= 1 ? sizes.early : n.row >= 5 ? sizes.late : []).push(r.encounter.length);
    }
  }
  assert.ok(sizes.early.every((x) => x === 1));
  assert.ok(sizes.late.every((x) => x >= 2 && x <= 3));
});

test('trials make enemies tougher and pay more «Слава»', () => {
  const save = C.newSave();
  save.trialsUnlocked = 2;
  const plain = C.newRun(save, 3, 0), hard = C.newRun(save, 3, 2);
  assert.equal(C.newRun(save, 3, 3).trial, 2, 'a locked trial is clamped');
  for (const r of [plain, hard]) {
    r.at = r.map.rows[0][0]; r.phase = 'battle'; r.encounter = [{ kind: 'wolf', row: 0 }];
    C.startBattle(r);
  }
  assert.equal(hard.battle.enemies[0].maxHp, Math.round(K.ENEMIES.wolf.hp * C.TRIAL_MUL ** 2));
  plain.depth = hard.depth = 10;
  assert.ok(C.glory(hard) > C.glory(plain));
  assert.equal(C.glory(plain), 80);
});

test('«Слава»: prices grow, levels are capped, unknown ids are refused', () => {
  const save = C.newSave();
  assert.equal(C.buyMeta(save, 'vigor'), 'noglory');
  save.glory = 10000;
  const p0 = C.metaPrice(save, 'vigor');
  assert.equal(C.buyMeta(save, 'vigor'), 'ok');
  assert.equal(save.glory, 10000 - p0);
  assert.ok(C.metaPrice(save, 'vigor') > p0);
  for (let i = 0; i < 10; i++) C.buyMeta(save, 'vigor');
  assert.equal(save.meta.vigor, K.META.vigor.max);
  assert.equal(C.buyMeta(save, 'vigor'), 'max');
  assert.equal(C.buyMeta(save, 'luck'), 'unknown');
  for (let i = 0; i < 5; i++) C.buyMeta(save, 'armory');
  assert.equal(save.meta.armory, 3);
  assert.deepEqual(C.newRun(save, 1).bag.map((x) => x.id), ['rusty_sword', ...K.ARMORY]);
});

test('recordRun folds a finished run into the save once and unlocks the next trial on a win', () => {
  const save = C.newSave();
  const run = C.newRun(save, 1);
  assert.equal(C.recordRun(save, run), 0, 'the run is not over');
  run.phase = 'won'; run.depth = 27; run.kills = 40; run.bosses = 3;
  save.current = C.snapshot(run);
  const g = C.recordRun(save, run);
  assert.equal(g, 27 * 8 + 40 * 2 + 3 * 60);
  assert.equal(save.glory, g);
  assert.equal(save.wins, 1);
  assert.equal(save.bestDepth, 27);
  assert.equal(save.trialsUnlocked, 1);
  assert.equal(save.current, null);
  assert.equal(C.recordRun(save, run), 0, 'only once');
  const lost = C.newRun(save, 2);
  lost.phase = 'lost'; lost.depth = 3;
  C.recordRun(save, lost);
  assert.equal(save.trialsUnlocked, 1);
  assert.equal(save.bestDepth, 27);
});

test('snapshots round-trip at every node kind and keep pending offers', () => {
  for (const kind of ['chest', 'shrine', 'shop', 'forge', 'camp', 'elite', 'battle']) {
    const run = entered(kind);
    const back = C.restore(JSON.parse(JSON.stringify(C.snapshot(run))));
    assert.ok(back, kind);
    assert.deepEqual(C.snapshot(back), C.snapshot(run), kind);
  }
  const perk = entered('camp');
  C.camp(perk, 'train');
  const p = C.restore(C.snapshot(perk));
  assert.equal(p.phase, 'perk');
  assert.deepEqual(p.offer, perk.offer);
});

test('a reload during a battle restarts it with the same enemies', () => {
  const run = entered('battle', 5);
  C.startBattle(run);
  const enemies = run.battle.enemies.map((e) => [e.kind, e.maxHp]);
  for (let i = 0; i < 30; i++) C.step(run, 0.1);
  const snap = C.snapshot(run);
  assert.equal(snap.battle, undefined);
  const back = C.restore(JSON.parse(JSON.stringify(snap)));
  assert.equal(back.phase, 'battle');
  assert.equal(back.battle, null);
  assert.ok(C.startBattle(back));
  assert.deepEqual(back.battle.enemies.map((e) => [e.kind, e.maxHp]), enemies);
  assert.equal(C.startBattle(back), false, 'a running battle is not restarted');
  // the same seeded fight from the same start
  const again = C.restore(JSON.parse(JSON.stringify(snap)));
  C.startBattle(again);
  const b2 = C.restore(JSON.parse(JSON.stringify(snap)));
  C.startBattle(b2);
  for (let i = 0; i < 40; i++) { C.step(again, 0.1); C.step(b2, 0.1); }
  assert.deepEqual(C.snapshot(again), C.snapshot(b2));
});

test('a boss snapshot may start the boss lower (hpFrac), as the browser smoke does', () => {
  const run = C.newRun(C.newSave(), 1);
  run.phase = 'battle';
  run.at = run.map.rows[0][0];
  run.encounter = [{ kind: 'ash_lord', boss: true, row: 8, hpFrac: 0.34 }];
  const back = C.restore(C.snapshot(run));
  C.startBattle(back);
  assert.equal(back.battle.enemies[0].hp, Math.round(back.battle.enemies[0].maxHp * 0.34));
  run.encounter[0].hpFrac = 3;
  assert.equal(C.restore(C.snapshot(run)), null);
});

test('restore refuses broken snapshots', () => {
  const good = C.snapshot(C.newRun(C.newSave(), 1));
  const broken = [
    null, 5, {}, { ...good, v: 2 }, { ...good, phase: 'nap' }, { ...good, act: 4 }, { ...good, gold: -1 },
    { ...good, hero: { ...good.hero, level: 0 } }, { ...good, bag: [{ uid: 1, id: 'laser', tier: 1 }] },
    { ...good, bag: [{ uid: 1, id: 'sword', tier: 9 }] }, { ...good, eq: { weapon: 99, armor: null, charm: null } },
    { ...good, eq: { weapon: null, armor: null, charm: null } }, { ...good, map: { ...good.map, act: 2 } },
    { ...good, at: 999 }, { ...good, phase: 'battle', encounter: [{ kind: 'dragon' }] },
    { ...good, hero: { ...good.hero, bonus: { atk: 1 } } },
  ];
  for (const b of broken) assert.equal(C.restore(b), null, JSON.stringify(b).slice(0, 80));
});

test('the save tolerates broken JSON, wrong values and blocked storage', () => {
  assert.deepEqual(C.parseSave('not json'), C.newSave());
  assert.deepEqual(C.parseSave(null), C.newSave());
  assert.deepEqual(C.parseSave(JSON.stringify({ v: 9 })), C.newSave());
  const odd = C.parseSave(JSON.stringify({ v: 1, glory: -5, meta: { vigor: 99, might: 'x' }, wins: 2, trialsUnlocked: 7, trial: 1, current: { v: 1 } }));
  assert.equal(odd.glory, 0);
  assert.equal(odd.meta.vigor, K.META.vigor.max);
  assert.equal(odd.meta.might, 0);
  assert.equal(odd.wins, 2);
  assert.equal(odd.trialsUnlocked, 0);
  assert.equal(odd.trial, 0);
  assert.equal(odd.current, null);

  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const save = C.newSave();
  save.glory = 77;
  save.current = C.snapshot(C.newRun(save, 3));
  assert.ok(C.storeSave(storage, save));
  assert.deepEqual(C.loadSave(storage), save);
  const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(C.loadSave(blocked), C.newSave());
  assert.equal(C.storeSave(blocked, save), false);
  assert.equal(C.storeSave(null, save), false);
  assert.deepEqual(C.loadSave(null), C.newSave());
});

test('the rng helper and clamp', () => {
  const a = { rng: 3 }, b = { rng: 3 };
  assert.equal(C.rand(a), C.rand(b));
  assert.ok(C.rand(a) >= 0 && C.rand(a) < 1);
  assert.equal(C.clamp(5, 0, 3), 3);
  assert.equal(C.tierMul(1), 1);
  assert.equal(C.drain(C.newRun(C.newSave(), 1)).length, 0);
});
