'use strict';
// Путь героя: the hero, items, the damage rules and the automatic battle.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/hero/core.js');
const K = require('../../web/hero/content.js');

// A run standing in a battle against the given enemy specs, with crits switched off unless asked for.
function battleWith(specs, { weapon, armor, charm, tier = 1, crit = false, seed = 1 } = {}) {
  const run = C.newRun(C.newSave(), seed);
  if (!crit) run.hero.bonus.crit = -C.CRIT_BASE;
  if (weapon) { const it = { uid: run.nextUid++, id: weapon, tier }; run.bag.push(it); run.eq.weapon = it.uid; }
  if (armor) { const it = { uid: run.nextUid++, id: armor, tier }; run.bag.push(it); run.eq.armor = it.uid; }
  if (charm) { const it = { uid: run.nextUid++, id: charm, tier }; run.bag.push(it); run.eq.charm = it.uid; }
  run.hero.hp = C.stats(run).maxHp;
  run.at = run.map.rows[0][0];
  run.phase = 'battle';
  run.encounter = specs.map((s) => (typeof s === 'string' ? { kind: s, row: 0 } : Object.assign({ row: 0 }, s)));
  assert.ok(C.startBattle(run));
  C.drain(run);
  return run;
}

// Steps in small frames until `pred(events so far)` holds or the time runs out. Returns the events.
function until(run, pred, seconds = 30, frame = 1 / 60) {
  const all = [];
  for (let t = 0; t < seconds; t += frame) {
    C.step(run, frame);
    all.push(...C.drain(run));
    if (pred(all, run)) break;
  }
  return all;
}
const sim = (run, seconds, frame = 1 / 60) => until(run, () => false, seconds, frame);
const of = (events, type) => events.filter((e) => e.type === type);

test('a new run: level 1, the rusty sword, full health, the first row reachable', () => {
  const run = C.newRun(C.newSave(), 7);
  assert.equal(run.hero.level, 1);
  assert.equal(C.title(run.hero.level), 'Новичок');
  assert.equal(run.bag.length, 1);
  assert.equal(run.bag[0].id, 'rusty_sword');
  assert.equal(run.eq.weapon, run.bag[0].uid);
  assert.equal(run.hero.hp, C.stats(run).maxHp);
  assert.equal(C.stats(run).maxHp, C.HP_BASE);
  assert.deepEqual(C.reachable(run), run.map.rows[0]);
  assert.equal(C.status(run), 'map');
  assert.equal(C.newRun(C.newSave(), 'x').seed, 1, 'a bad seed falls back to 1');
});

test('permanent upgrades shape the start: health, attack, gold, potions and the armory weapons', () => {
  const save = C.newSave();
  Object.assign(save.meta, { vigor: 2, might: 3, purse: 1, potion: 2, armory: 2, bag: 1 });
  const run = C.newRun(save, 1);
  const st = C.stats(run);
  assert.equal(st.maxHp, C.HP_BASE + 2 * C.META_HP);
  assert.equal(st.atk, C.ATK_BASE + 3 * C.META_ATK);
  assert.equal(run.gold, 25);
  assert.equal(run.hero.potions, 3);
  assert.deepEqual(run.bag.map((x) => x.id), ['rusty_sword', 'flame_blade', 'frost_staff']);
  assert.equal(C.bagMax(run), C.BAG_BASE + 1);
});

test('a hit deals (weapon + attack) × the resistance of its type', () => {
  const run = battleWith(['skeleton']);
  const hit = of(until(run, (ev) => of(ev, 'hit').length), 'hit')[0];
  const base = K.ITEMS.rusty_sword.dmg + C.stats(run).atk;
  assert.equal(hit.dmg, Math.round(base * K.ENEMIES.skeleton.res.phys));
  assert.equal(hit.dmgType, 'phys');

  const holy = battleWith(['skeleton'], { weapon: 'sun_mace' });
  const h2 = of(until(holy, (ev) => of(ev, 'hit').length), 'hit')[0];
  assert.equal(h2.dmg, Math.round((K.ITEMS.sun_mace.dmg + C.stats(holy).atk) * 2), 'holy is doubled against the skeleton');
});

test('tiers raise item numbers by 30% each', () => {
  const t1 = C.itemStats({ id: 'chain', tier: 1 }), t3 = C.itemStats({ id: 'chain', tier: 3 });
  assert.equal(t1.armor, K.ITEMS.chain.armor);
  assert.equal(t3.armor, Math.round(K.ITEMS.chain.armor * 1.3 ** 2));
  const w = C.itemStats({ id: 'sword', tier: 2 });
  assert.ok(Math.abs(w.dmg - K.ITEMS.sword.dmg * 1.3) < 1e-9);
  assert.equal(C.itemStats({ id: 'sword', tier: 1, type: 'holy' }).type, 'holy', 'a reforged weapon keeps its new type');
  assert.ok(C.priceOf({ id: 'sword', tier: 2 }) > C.priceOf({ id: 'sword', tier: 1 }));
});

test('a zero resistance is a real immunity', () => {
  const run = battleWith(['imp'], { weapon: 'flame_blade' });
  const ev = sim(run, 5);
  assert.ok(of(ev, 'immune').length >= 3);
  assert.equal(of(ev, 'hit').length, 0);
  const imp = run.battle ? run.battle.enemies[0] : null;
  assert.ok(!imp || imp.hp === imp.maxHp);
});

test('dodge makes hits miss, and keen weapons ignore it', () => {
  const plain = battleWith(['bandit', 'bandit', 'bandit'], { armor: 'plate', tier: 5 });
  plain.hero.hp = 1e6; // only the misses matter here
  const ev = sim(plain, 20);
  const miss = of(ev, 'miss').length, hits = of(ev, 'hit').length;
  assert.ok(miss > 0);
  const share = miss / (miss + hits);
  assert.ok(share > 0.15 && share < 0.45, `miss share ${share}`);

  const keen = battleWith(['bandit', 'bandit', 'bandit'], { weapon: 'dagger', armor: 'plate', tier: 5 });
  keen.hero.hp = 1e6;
  assert.equal(of(sim(keen, 20), 'miss').length, 0);
});

test('regeneration heals, and a fire hit stops it for three seconds', () => {
  const run = battleWith([{ kind: 'troll' }]);
  const troll = run.battle.enemies[0];
  until(run, (ev) => of(ev, 'hit').length);
  run.eq.weapon = run.bag[0].uid;
  // stop attacking: a 1000 s swing keeps the hero idle while we watch the troll
  run.battle.heroTimer = 1000;
  const hurt = troll.hp;
  sim(run, 1);
  assert.ok(troll.hp > hurt, 'it regenerates');

  const fire = battleWith([{ kind: 'troll' }], { weapon: 'flame_blade' });
  const t2 = fire.battle.enemies[0];
  until(fire, (ev) => of(ev, 'hit').length);
  fire.battle.heroTimer = 1000;
  const after = t2.hp;
  sim(fire, 2.5);
  assert.equal(t2.hp, after, 'no regeneration right after a fire hit');
  sim(fire, 1.5);
  assert.ok(t2.hp > after, 'it comes back after three seconds');
});

test('thorns hurt the hero for a share of each melee hit', () => {
  const run = battleWith(['golem'], { weapon: 'frost_staff' });
  const ev = until(run, (e) => of(e, 'thorns').length);
  const hit = of(ev, 'hit')[0], th = of(ev, 'thorns')[0];
  assert.equal(th.dmg, Math.max(1, Math.round(hit.dmg * K.ENEMIES.golem.thorns)));
});

test('a shield absorbs its first hits', () => {
  const run = battleWith(['knight']);
  const ev = until(run, (e) => of(e, 'hit').length);
  assert.equal(of(ev, 'block').length, K.ENEMIES.knight.shield);
  assert.deepEqual(of(ev, 'block').map((b) => b.left), [2, 1, 0]);
});

test('cleave hits the next enemy for half', () => {
  const run = battleWith(['wolf', 'wolf'], { weapon: 'axe' });
  const ev = until(run, (e) => of(e, 'hit').length >= 2);
  const [a, b] = of(ev, 'hit');
  assert.notEqual(a.uid, b.uid);
  const base = K.ITEMS.axe.dmg + C.stats(run).atk;
  assert.equal(a.dmg, Math.round(base));
  assert.equal(b.dmg, Math.round(base * C.CLEAVE));
});

test('lifesteal heals the hero for a share of the hit', () => {
  const run = battleWith(['troll'], { weapon: 'sickle' });
  run.hero.hp = 20;
  run.battle.enemies[0].timer = 1000; // the troll doesn't hit back here
  const ev = until(run, (e) => of(e, 'hit').length);
  const hit = of(ev, 'hit')[0];
  assert.ok(Math.abs(run.hero.hp - (20 + hit.dmg * C.LIFESTEAL)) < 1e-9);
});

test('chill and frost nova slow enemy attacks', () => {
  const run = battleWith(['troll'], { weapon: 'frost_staff' });
  until(run, (e) => of(e, 'hit').length);
  const troll = run.battle.enemies[0];
  assert.equal(troll.slow, C.CHILL.slow);
  assert.ok(troll.slowT > 0);
  const nova = battleWith(['wolf', 'wolf'], { charm: 'frost_amulet' });
  const ev = until(nova, (e) => of(e, 'spell').length);
  assert.equal(of(ev, 'spell')[0].spell, 'nova');
  for (const w of nova.battle.enemies) if (!w.dead) assert.equal(w.slow, C.NOVA_SLOW.slow);
});

test('the charm casts on its cooldown: first at half, then every full cooldown', () => {
  const run = battleWith([{ kind: 'troll' }], { charm: 'fire_orb' });
  run.hero.hp = 1e6;
  const times = [];
  for (let i = 0; i < 60 * 16; i++) {
    C.step(run, 1 / 60);
    for (const e of C.drain(run)) if (e.type === 'spell') times.push(run.battle ? run.battle.t : NaN);
    if (run.phase !== 'battle') break;
  }
  const cd = K.ITEMS.fire_orb.cd;
  assert.ok(Math.abs(times[0] - cd / 2) < 0.05, `first at ${times[0]}`);
  assert.ok(Math.abs(times[1] - times[0] - cd) < 0.05, `then after ${times[1] - times[0]}`);
});

test('the healing charm waits until the hero is hurt', () => {
  const run = battleWith(['wolf'], { charm: 'heal_stone' });
  run.battle.enemies[0].timer = 1000;
  run.battle.heroTimer = 1000;
  let ev = sim(run, 5);
  assert.equal(of(ev, 'spell').length, 0);
  run.hero.hp = 10;
  ev = sim(run, 0.5);
  assert.equal(of(ev, 'spell')[0].spell, 'heal');
  assert.ok(run.hero.hp > 10);
});

test('the armour cuts physical damage, the ward cuts magic', () => {
  const run = battleWith(['wolf'], { armor: 'plate' });
  const hurt = of(until(run, (e) => of(e, 'hurt').length), 'hurt')[0];
  const armor = C.stats(run).armor;
  assert.equal(hurt.dmg, Math.max(1, Math.round(K.ENEMIES.wolf.dmg * 100 / (100 + armor))));

  const ghost = battleWith(['ghost'], { armor: 'robe' });
  const h2 = of(until(ghost, (e) => of(e, 'hurt').length), 'hurt')[0];
  assert.equal(h2.dmgType, 'ice');
  assert.equal(h2.dmg, Math.max(1, Math.round(K.ENEMIES.ghost.dmg * 100 / (100 + C.stats(ghost).ward))));
});

test('a weapon swap in battle takes 0.8 s without attacks', () => {
  const run = battleWith(['troll']);
  const it = { uid: run.nextUid++, id: 'sun_mace', tier: 1 };
  run.bag.push(it);
  until(run, (e) => of(e, 'hit').length);
  assert.ok(C.swapWeapon(run, it.uid));
  assert.equal(run.eq.weapon, it.uid);
  assert.equal(C.swapWeapon(run, run.bag[0].uid), false, 'no second swap while swapping');
  const ev = sim(run, C.SWAP_TIME - 0.05);
  assert.equal(of(ev, 'hit').length, 0);
  const ev2 = until(run, (e) => of(e, 'hit').length, 1);
  assert.ok(of(ev2, 'swapped').length === 1 && of(ev2, 'hit')[0].dmgType === 'holy');
});

test('swap errors: unknown item, armour, the same weapon, outside a battle', () => {
  const run = battleWith(['wolf'], { armor: 'leather' });
  assert.equal(C.swapWeapon(run, 999), false);
  assert.equal(C.swapWeapon(run, run.eq.armor), false);
  assert.equal(C.swapWeapon(run, run.eq.weapon), false);
  const calm = C.newRun(C.newSave(), 1);
  calm.bag.push({ uid: calm.nextUid++, id: 'sword', tier: 1 });
  assert.equal(C.swapWeapon(calm, calm.bag[1].uid), false);
});

test('potions heal 35% and run out', () => {
  const run = battleWith(['wolf']);
  assert.equal(C.usePotion(run), false, 'not at full health');
  run.hero.hp = 10;
  assert.ok(C.usePotion(run));
  assert.ok(Math.abs(run.hero.hp - (10 + C.stats(run).maxHp * C.POTION_HEAL)) < 1e-9);
  assert.equal(run.hero.potions, 0);
  run.hero.hp = 10;
  assert.equal(C.usePotion(run), false, 'none left');
});

test('the final boss changes resistances and damage type at 66% and 33%', () => {
  const run = battleWith([{ kind: 'ash_lord', boss: true, hpFrac: 0.67 }], { weapon: 'flame_blade', tier: 5 });
  run.hero.hp = 1e6;
  const boss = run.battle.enemies[0];
  assert.equal(boss.phase, 0);
  assert.deepEqual(boss.res, K.BOSSES.ash_lord.phases[0].res);
  const ev = until(run, (e) => of(e, 'phase').length);
  const ph = of(ev, 'phase')[0];
  assert.equal(ph.phase, 1);
  assert.equal(boss.res.fire, 0, 'the flame body is immune to fire');
  assert.equal(boss.dmgType, 'fire');
  assert.ok(boss.pause > 0, 'the boss pauses to announce the phase');

  const late = battleWith([{ kind: 'ash_lord', boss: true, hpFrac: 0.3 }]);
  assert.equal(late.battle.enemies[0].phase, 2, 'a boss that starts low is already in its last phase');
  assert.equal(late.battle.enemies[0].res.holy, 2);
});

test('every damage type is weak against at least one phase of the final boss, and each phase has its own best type', () => {
  const phases = K.BOSSES.ash_lord.phases;
  for (const t of K.TYPES) assert.ok(phases.some((p) => p.res[t] <= 0.25), `${t} is resisted somewhere`);
  const best = phases.map((p) => K.TYPES.reduce((a, b) => (p.res[b] > p.res[a] ? b : a)));
  assert.equal(new Set(best).size, phases.length);
});

test('bosses summon helpers while they are few', () => {
  const run = battleWith([{ kind: 'wolf_king', boss: true }], { armor: 'plate', tier: 5 });
  run.hero.hp = 1e6;
  run.battle.heroTimer = 1000;
  const ev = sim(run, K.BOSSES.wolf_king.summon.every * 3 + 0.5);
  assert.equal(of(ev, 'summon').length, K.BOSSES.wolf_king.summon.max);
});

test('elites are tougher and carry an extra trait', () => {
  const run = battleWith([{ kind: 'wolf', elite: true, trait: 1 }]);
  const e = run.battle.enemies[0];
  assert.equal(e.maxHp, Math.round(K.ENEMIES.wolf.hp * K.ELITE.hp));
  assert.equal(e.shield, 2);
  assert.ok(e.elite);
});

test('kills pay gold and XP; level-ups raise health and attack and queue a perk', () => {
  const run = C.newRun(C.newSave(), 1);
  const st0 = C.stats(run);
  run.phase = 'camp';
  assert.ok(C.camp(run, 'train'));
  assert.equal(run.hero.level, 2);
  assert.equal(run.phase, 'perk');
  assert.equal(run.offer.length, 3);
  const st1 = C.stats(run);
  assert.equal(st1.maxHp, st0.maxHp + C.LEVEL_HP);
  assert.equal(st1.atk, st0.atk + C.LEVEL_ATK);
  assert.ok(C.pickPerk(run, 0));
  assert.equal(run.phase, 'map');

  const fight = battleWith(['wolf']);
  const ev = until(fight, (e) => of(e, 'victory').length);
  assert.equal(of(ev, 'kill')[0].gold, K.ENEMIES.wolf.gold);
  assert.equal(fight.gold, K.ENEMIES.wolf.gold);
  let total = fight.hero.xp;
  for (let l = 1; l < fight.hero.level; l++) total += C.xpToNext(l);
  assert.equal(total, K.ENEMIES.wolf.xp);
  assert.equal(fight.kills, 1);
});

test('titles change at levels 3, 6, 9, 12 and 15', () => {
  const at = (l) => C.title(l);
  assert.deepEqual([1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 30].map(at),
    ['Новичок', 'Новичок', 'Оруженосец', 'Оруженосец', 'Воин', 'Воин', 'Рыцарь', 'Рыцарь', 'Герой', 'Герой', 'Легенда', 'Легенда']);
  assert.equal(C.xpToNext(1), 12);
  assert.ok(C.xpToNext(10) > C.xpToNext(9));
});

test('losing the battle ends the run', () => {
  const run = battleWith(['troll', 'troll', 'troll']);
  run.hero.hp = 3;
  const ev = until(run, (e) => of(e, 'defeat').length);
  assert.equal(of(ev, 'defeat').length, 1);
  assert.equal(run.phase, 'lost');
  assert.equal(run.battle, null);
});

test('the same inputs give the same battle, and frame size does not matter', () => {
  const a = battleWith(['bandit', 'slime'], { crit: true, seed: 5 });
  const b = battleWith(['bandit', 'slime'], { crit: true, seed: 5 });
  const c = battleWith(['bandit', 'slime'], { crit: true, seed: 5 });
  sim(a, 6, 1 / 60);
  sim(b, 6, 1 / 60);
  sim(c, 6, 0.1);
  assert.deepEqual(a, b);
  assert.equal(Math.round(a.hero.hp * 1000), Math.round(c.hero.hp * 1000));
  assert.equal(a.kills, c.kills);
});

test('step ignores bad dt and caps a long frame', () => {
  const run = battleWith(['troll']);
  const t = run.battle.t;
  for (const dt of [0, -1, NaN, Infinity, 'x', undefined]) C.step(run, dt);
  assert.equal(run.battle.t, t);
  C.step(run, 5);
  assert.ok(Math.abs(run.battle.t - C.MAX_DT) < C.TICK);
  const calm = C.newRun(C.newSave(), 1);
  C.step(calm, 1);
  assert.equal(calm.t, 0, 'nothing runs outside a battle');
});
