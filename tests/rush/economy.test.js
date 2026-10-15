'use strict';
// Battle, coins, upgrades and the save of «Числовой забег», plus a whole campaign played by the smart bot.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../web/rush/core.js');
const { campaign } = require('./bot.js');

const level = (extra) => ({
  num: 4, length: 12, gates: [], obstacles: [], platforms: [], enemy: { count: 20, power: 1.5 }, ...extra,
});

// A run with this crowd that has reached the finish line (status 'battle').
function atFinish(def, count, power = 1) {
  const run = R.newRun(def, {});
  run.count = count;
  run.power = power;
  while (run.status === 'running') R.step(run, 0.25, 0);
  assert.equal(run.status, 'battle');
  return run;
}

const memStorage = (init = {}) => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};
const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('the army battle: greater strength wins, the rest survives rounded up', () => {
  const run = atFinish(level(), 40, 1); // 40 against 20·1.5 = 30
  const res = R.finishBattle(run);
  assert.equal(res.won, true);
  assert.equal(res.reason, null);
  assert.equal(res.strength, 40);
  assert.equal(res.enemy, 30);
  assert.equal(res.rest, 10);
  assert.equal(res.survivors, 10);
  assert.equal(run.status, 'won');

  const odd = R.finishBattle(atFinish(level(), 20, 1.6)); // 32 − 30 = 2 → ceil(2 / 1.6) = 2
  assert.equal(odd.won, true);
  assert.equal(odd.survivors, 2);
  const thin = R.finishBattle(atFinish(level(), 31, 1)); // a strength edge of 1 still leaves one soldier
  assert.equal(thin.survivors, 1);
});

test('the army battle: equal or smaller strength loses', () => {
  for (const [count, power] of [[30, 1], [20, 1.5], [10, 1]]) {
    const run = atFinish(level(), count, power);
    const res = R.finishBattle(run);
    assert.equal(res.won, false, `${count}·${power}`);
    assert.equal(res.reason, 'army');
    assert.equal(res.survivors, 0);
    assert.equal(run.status, 'lost');
    assert.equal(run.reason, 'army');
  }
});

test('a boss takes the rest of the strength: at least its HP wins, less loses', () => {
  const def = level({ boss: { hp: 20 } }); // army 30, then 20 HP
  const win = R.finishBattle(atFinish(def, 60, 1));
  assert.equal(win.won, true);
  assert.equal(win.rest, 30);
  assert.equal(win.boss, 20);
  assert.equal(win.survivors, 10);
  const exact = R.finishBattle(atFinish(def, 50, 1));
  assert.equal(exact.won, true, 'the rest equal to HP is enough');
  assert.equal(exact.survivors, 0);
  const run = atFinish(def, 49, 1);
  const lost = R.finishBattle(run);
  assert.equal(lost.won, false);
  assert.equal(lost.reason, 'boss');
  assert.equal(run.status, 'lost');
  assert.equal(R.finishBattle(atFinish(def, 30, 1)).reason, 'army', 'the army comes first');
});

test('finishBattle: a running run gives null, a run lost on the track settles as lost, a result is kept', () => {
  const run = R.newRun(level(), {});
  assert.equal(R.finishBattle(run), null);
  assert.equal(R.finishBattle(null), null);
  const lost = R.newRun(level({ gates: [{ z: 5, full: { op: 'sub', n: 50 } }] }), {});
  while (lost.status === 'running') R.step(lost, 0.25, 0);
  const res = R.finishBattle(lost);
  assert.deepEqual([res.won, res.reason, res.survivors], [false, 'crowd', 0]);
  assert.equal(lost.status, 'lost');
  const done = atFinish(level(), 40);
  const first = R.finishBattle(done);
  done.count = 1;
  assert.equal(R.finishBattle(done), first, 'the same result on a second call');
});

test('reward: survivors + 10·level, +10% per Доход level; a loss still pays the level bonus, a replay does not', () => {
  const won = atFinish(level(), 40); // 10 survivors on level 4
  assert.equal(R.reward(won, {}), 0, 'nothing before the battle is settled');
  R.finishBattle(won);
  assert.equal(R.reward(won, {}), 50);
  assert.equal(R.reward(won, { income: 3 }), 65);
  assert.equal(R.reward(won, { income: 10 }), 100);
  assert.equal(R.reward(won, {}, false), 10, 'without the level bonus: survivors only');
  assert.equal(R.reward(won, { income: 10 }, false), 20);
  const lost = atFinish(level(), 5);
  R.finishBattle(lost);
  assert.equal(R.reward(lost, {}), 40);
  assert.equal(R.reward(lost, {}, false), 0);
  const plain = atFinish(level({ num: undefined }), 40); // a level without a number counts as level 1
  R.finishBattle(plain);
  assert.equal(R.reward(plain, {}), 20);
  assert.equal(R.reward(null, {}), 0);
});

test('prices grow as base·1.35^level', () => {
  for (const id of R.UPGRADES) {
    assert.equal(R.price(id, 0), R.PRICE_BASE[id]);
    for (let lvl = 1; lvl < R.MAX_UPGRADE; lvl++) {
      assert.equal(R.price(id, lvl), Math.round(R.PRICE_BASE[id] * 1.35 ** lvl));
      assert.ok(R.price(id, lvl) > R.price(id, lvl - 1));
    }
  }
});

test('buy: takes the coins and raises the level; refuses without coins, above the cap and for junk ids', () => {
  const save = R.newSave();
  const cost = R.price('start', 0);
  save.coins = cost - 1;
  assert.equal(R.buy(save, 'start'), 'nocoins');
  assert.equal(save.coins, cost - 1);
  assert.equal(save.upgrades.start, 0);
  save.coins = cost + 5;
  assert.equal(R.buy(save, 'start'), 'ok');
  assert.equal(save.coins, 5);
  assert.equal(save.upgrades.start, 1);
  assert.equal(R.nextPrice(save, 'start'), R.price('start', 1));

  save.upgrades.weapon = R.MAX_UPGRADE;
  save.coins = 1e6;
  assert.equal(R.buy(save, 'weapon'), 'max');
  assert.equal(save.upgrades.weapon, R.MAX_UPGRADE);
  assert.equal(save.coins, 1e6);
  assert.equal(R.nextPrice(save, 'weapon'), null);
  assert.equal(R.buy(save, 'laser'), 'unknown');
  assert.equal(R.buy(save, '__proto__'), 'unknown');
  assert.equal(R.nextPrice(save, 'laser'), null);
  assert.equal(R.buy(null, 'start'), 'unknown');
  assert.equal(save.coins, 1e6);
});

test('cheapest picks the lowest next price and skips maxed upgrades', () => {
  assert.equal(R.cheapest({}), 'start');
  assert.equal(R.cheapest({ start: 3 }), 'shield'); // 30·1.35³ ≈ 74 > 40
  const maxed = Object.fromEntries(R.UPGRADES.map((id) => [id, R.MAX_UPGRADE]));
  assert.equal(R.cheapest(maxed), null);
  assert.equal(R.cheapest({ ...maxed, income: 9 }), 'income');
});

test('the save loads clean from missing, broken, foreign or blocked storage', () => {
  const clean = R.newSave();
  assert.deepEqual(clean, { v: 1, level: 1, best: 0, coins: 0, upgrades: { start: 0, weapon: 0, shield: 0, income: 0 }, stars: [] });
  for (const raw of [null, undefined, '', '{', 'null', '42', '"x"', '[]', '{"v":2,"level":5}', '{"level":5}']) {
    assert.deepEqual(R.parseSave(raw), clean, String(raw));
  }
  assert.deepEqual(R.loadSave(null), clean);
  assert.deepEqual(R.loadSave(throwing), clean);
  assert.deepEqual(R.loadSave(memStorage()), clean);
  assert.deepEqual(R.loadSave(memStorage({ [R.SAVE_KEY]: '{oops' })), clean);
});

test('the save keeps good fields and drops junk ones', () => {
  const s = R.parseSave(JSON.stringify({
    v: 1, level: 7, best: 6, coins: 345, upgrades: { start: 2, weapon: 'x', shield: 40, income: 1.5, extra: 3 }, junk: 1,
  }));
  assert.deepEqual(s, {
    v: 1, level: 7, best: 6, coins: 345, upgrades: { start: 2, weapon: 0, shield: 10, income: 0 }, stars: [1, 1, 1, 1, 1, 1],
  }, 'a save from before stars: every level won has one star');
  const junk = R.parseSave(JSON.stringify({ v: 1, level: -3, best: 'a', coins: -5, upgrades: null }));
  assert.deepEqual(junk, R.newSave());
  assert.equal(R.parseSave(JSON.stringify({ v: 1, level: 9, best: 2 })).level, 3, 'no skipping past the best + 1');
  assert.equal(R.parseSave(JSON.stringify({ v: 1, level: 2.5, best: 4, coins: 1e12 })).level, 1);
  assert.equal(R.parseSave(JSON.stringify({ v: 1, coins: 1e12 })).coins, 0);
});

test('storeSave writes rush.save and loadSave reads it back; a blocked storage gives false', () => {
  const st = memStorage();
  const save = R.newSave();
  save.level = 4;
  save.best = 3;
  save.coins = 99;
  save.upgrades.shield = 2;
  save.stars = [3, 1, 2];
  assert.equal(R.SAVE_KEY, 'rush.save');
  assert.equal(R.storeSave(st, save), true);
  assert.deepEqual(R.loadSave(st), save);
  assert.equal(R.storeSave(throwing, save), false);
  assert.equal(R.storeSave(null, save), false);
});

test('record banks the coins and moves on only after a win', () => {
  const save = R.newSave();
  save.level = 4;
  save.best = 3;
  const lost = atFinish(level(), 5);
  assert.equal(R.record(save, lost), 40);
  assert.deepEqual([save.level, save.best, save.coins], [4, 3, 40]);
  const won = atFinish(level(), 40);
  assert.equal(R.record(save, won), 50);
  assert.deepEqual([save.level, save.best, save.coins], [5, 4, 90]);
  const replay = atFinish(level({ num: 2 }), 40);
  assert.equal(R.record(save, replay), 10, 'a replay of a won level pays its survivors, no level bonus');
  assert.deepEqual([save.level, save.best, save.coins], [5, 4, 100], 'replaying an old level does not move back');
  const lostReplay = atFinish(level(), 5);
  assert.equal(R.record(save, lostReplay), 0, 'losing a won level again pays nothing');
  assert.equal(R.record(save, R.newRun(level(), {})), 0, 'a running run banks nothing');
  assert.equal(save.coins, 100);
});

test('record banks a run once: recording it again adds nothing', () => {
  const save = R.newSave();
  save.level = 4;
  save.best = 3;
  const won = atFinish(level(), 40);
  assert.equal(R.record(save, won), 50);
  assert.equal(R.record(save, won), 0);
  assert.equal(R.record(save, won), 0);
  assert.deepEqual([save.level, save.best, save.coins], [5, 4, 50]);
  const lost = atFinish(level({ num: 5 }), 5);
  assert.equal(R.record(save, lost), 50);
  assert.equal(R.record(save, lost), 0);
  assert.equal(save.coins, 100);
});

test('bank records the run and writes the save at once; a blocked storage keeps the coins for this visit', () => {
  const st = memStorage();
  const save = R.newSave();
  save.level = 4;
  save.best = 3;
  assert.equal(R.bank(st, save, atFinish(level(), 40)), 50);
  assert.deepEqual(R.loadSave(st), save);
  assert.deepEqual([save.level, save.coins], [5, 50]);
  assert.equal(R.bank(throwing, save, atFinish(level({ num: 5 }), 5)), 50);
  assert.equal(save.coins, 100);
  assert.equal(R.bank(st, save, R.newRun(level(), {})), 0, 'a running run banks nothing');
});

test('a smart bot buying the cheapest upgrades wins levels 1–30 with at most 3 losses in a row', () => {
  const { save, runs, worstStreak } = campaign(30, 300);
  assert.equal(save.best, 30, `reached level ${save.level} after ${runs.length} runs`);
  assert.ok(worstStreak <= 3, `worst losing streak ${worstStreak}`);
  for (const id of R.UPGRADES) assert.ok(save.upgrades[id] >= 5, `${id} bought along the way`);
  // Upgrades spread over the campaign: something left to buy at level 20.
  const at20 = runs.find((r) => r.n === 20).upgrades;
  assert.ok(R.UPGRADES.some((id) => at20[id] < R.MAX_UPGRADE));
});

// Other players: the casual bot (bot.js) and shopping orders unlike the generator's cheapest-first model.
test('a casual bot reaches level 30 whatever it buys first, and a player who never buys gets stuck', () => {
  for (const shop of ['cheapest', ['weapon', 'start', 'shield', 'income'], ['income', 'weapon', 'start', 'shield']]) {
    const { save, runs, worstStreak } = campaign(30, 60, { mode: 'casual', shop });
    const name = Array.isArray(shop) ? shop.join('>') : shop;
    assert.equal(save.best, 30, `${name}: stopped at level ${save.level} after ${runs.length} runs`);
    assert.ok(runs.length <= 40, `${name}: ${runs.length} runs for 30 levels`);
    assert.ok(worstStreak <= 3, `${name}: worst losing streak ${worstStreak}`);
  }
  const { save } = campaign(30, 40, { mode: 'smart', shop: 'none' });
  assert.ok(save.best < 10, `with no upgrades the smart bot still got to level ${save.best}`);
});

test('stars in the save: one entry per level won, 1–3, junk cleaned', () => {
  const s = R.parseSave(JSON.stringify({ v: 1, level: 5, best: 4, stars: [3, 0, 'x', 2.5, 2, 3, 3] }));
  assert.deepEqual(s.stars, [3, 1, 1, 1], 'cut to best, junk becomes 1');
  assert.deepEqual(R.parseSave(JSON.stringify({ v: 1, level: 3, best: 2, stars: 'abc' })).stars, [1, 1]);
  assert.equal(R.levelStars(s, 1), 3);
  assert.equal(R.levelStars(s, 5), 0, 'a level not won has no stars');
  assert.equal(R.levelStars(null, 1), 0);
  assert.equal(R.totalStars(s), 6);
  assert.equal(R.totalStars(R.newSave()), 0);
});

test('stars of a run: strength at the finish against the autopilot on the same level with the same upgrades', () => {
  // Plain level: +10 or ×2, then the battle. The autopilot takes ×2: 20 soldiers at the finish.
  const def = level({
    length: 100, gates: [{ z: 40, left: { op: 'add', n: 10 }, right: { op: 'mul', n: 2 } }], enemy: { count: 10, power: 1 },
  });
  const at = (count) => {
    const run = R.newRun(def, {});
    while (run.status === 'running') R.step(run, R.TICK, 1);
    run.count = count;
    R.finishBattle(run);
    return run;
  };
  assert.equal(R.par(at(20)), 20);
  assert.deepEqual([at(25), at(20), at(19), at(18), at(17), at(11)].map(R.starsFor), [3, 3, 2, 2, 1, 1]);
  const lost = at(15);
  lost.level.enemy.count = 100;
  lost.result = null;
  lost.status = 'battle';
  R.finishBattle(lost);
  assert.equal(R.starsFor(lost), 0, 'a loss has none');
  assert.equal(R.starsFor(R.newRun(def, {})), 0, 'a run on the track has none');
});

test('record keeps the best stars of every level', () => {
  const save = R.newSave();
  const def = level({
    num: 1, length: 100, gates: [{ z: 40, left: { op: 'add', n: 10 }, right: { op: 'mul', n: 2 } }], enemy: { count: 10, power: 1 },
  });
  const finish = (count) => {
    const run = R.newRun(def, {});
    while (run.status === 'running') R.step(run, R.TICK, 1);
    run.count = count;
    return run;
  };
  R.record(save, finish(17));
  assert.deepEqual(save.stars, [1]);
  R.record(save, finish(20));
  assert.deepEqual(save.stars, [3]);
  R.record(save, finish(18));
  assert.deepEqual(save.stars, [3], 'a worse replay keeps the best');
  const old = R.parseSave(JSON.stringify({ v: 1, level: 4, best: 3 }));
  R.record(old, finish(18));
  assert.deepEqual(old.stars, [2, 1, 1]);
});
