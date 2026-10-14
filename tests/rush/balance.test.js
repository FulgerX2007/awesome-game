'use strict';
// Level balance of «Числовой забег»: the bots (tests/rush/bot.js) play every campaign level through the core API
// with the upgrades a player is expected to have by then.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../web/rush/core.js');
const { play } = require('./bot.js');

const CAMPAIGN = Array.from({ length: 30 }, (_, i) => i + 1);
const smart = new Map();
const smartRun = (n) => {
  if (!smart.has(n)) smart.set(n, play(n, R.expectedUpgrades(n), 'smart'));
  return smart.get(n);
};

test('levelDef is deterministic, returns fresh copies and rejects bad numbers', () => {
  const a = R.levelDef(7);
  const b = R.levelDef(7);
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
  a.gates.length = 0;
  assert.ok(R.levelDef(7).gates.length > 0, 'changing a copy changes nothing');
  assert.notDeepEqual(R.levelDef(8), R.levelDef(9));
  for (const bad of [0, -1, 1.5, NaN, '3', null, undefined, R.MAX_LEVEL + 1]) {
    assert.throws(() => R.levelDef(bad), /bad level/, String(bad));
  }
  assert.throws(() => R.newRun(0, {}), /bad level/);
});

test('newRun takes a level number', () => {
  const run = R.newRun(12, {});
  assert.equal(run.level.num, 12);
  assert.deepEqual(run.level, R.parseLevel(R.levelDef(12)));
});

test('every campaign level is valid: 300–700 m, growing, numbered, a boss exactly on every 5th', () => {
  let prev = 0;
  for (const n of CAMPAIGN) {
    const def = R.levelDef(n);
    const lv = R.parseLevel(def);
    assert.equal(lv.num, n);
    assert.ok(lv.length >= 300 && lv.length <= 700, `level ${n}: ${lv.length} m`);
    assert.ok(lv.length >= prev, `level ${n} is not shorter than the one before`);
    prev = lv.length;
    assert.ok(lv.gates.length >= 3, `level ${n}: ${lv.gates.length} gates`);
    assert.equal(lv.boss !== null, n % 5 === 0, `level ${n}: boss`);
    assert.equal(R.isBossLevel(n), n % 5 === 0);
    assert.ok(lv.enemy.count >= 1);
    // Things on the track are far enough apart to steer from one to the next.
    const zs = [...lv.gates.map((g) => g.z), ...lv.obstacles.map((o) => o.z), ...lv.platforms.flatMap((p) => [p.z0, p.z1])]
      .sort((x, y) => x - y);
    for (let i = 1; i < zs.length; i++) assert.ok(zs[i] - zs[i - 1] >= 8, `level ${n}: crowded at z=${zs[i]}`);
  }
});

test('levels 1–3 teach: number gates, then obstacles, then the weapon gate and a platform', () => {
  const [l1, l2, l3] = [1, 2, 3].map((n) => R.parseLevel(R.levelDef(n)));
  assert.equal(l1.obstacles.length + l1.platforms.length, 0);
  assert.ok(l1.gates.every((g) => (g.full ? [g.full] : [g.left, g.right]).every((o) => o.op !== 'pow')));
  assert.ok(l2.obstacles.length >= 2);
  assert.deepEqual(new Set(l2.obstacles.map((o) => o.kind)), new Set(['saw', 'wall']));
  assert.equal(l2.platforms.length, 0);
  assert.ok(l3.gates.some((g) => g.left.op === 'pow' || g.right.op === 'pow'));
  assert.equal(l3.platforms.length, 1);
});

test('the smart bot with the expected upgrades wins levels 1–30 with a margin of 15–40%', () => {
  for (const n of CAMPAIGN) {
    const { result, margin } = smartRun(n);
    assert.ok(result.won, `level ${n}: lost (${result.reason})`);
    assert.ok(margin >= 0.15 && margin <= 0.4, `level ${n}: margin ${(margin * 100).toFixed(1)}%`);
  }
});

test('the dumb bot (always the worse side) loses on at least 80% of levels 1–30', () => {
  const lost = CAMPAIGN.filter((n) => !play(n, R.expectedUpgrades(n), 'dumb').result.won);
  assert.ok(lost.length >= 24, `the dumb bot lost only ${lost.length} of 30`);
});

test('boss levels are winnable: the rest after the army covers the boss', () => {
  for (const n of CAMPAIGN.filter((i) => i % 5 === 0)) {
    const { result } = smartRun(n);
    assert.ok(result.boss > 0, `level ${n}: a boss`);
    assert.ok(result.won, `level ${n}: lost to the boss (rest ${result.rest} vs HP ${result.boss})`);
    // the boss is a real fight: it takes a good share of what the army left, and the survivors are what remains
    assert.ok(result.boss >= result.rest * 0.4, `level ${n}: the boss (${result.boss}) is a pushover after ${result.rest}`);
    const { power } = smartRun(n).run;
    assert.equal(result.survivors, Math.max(0, Math.ceil((result.rest - result.boss) / power - 1e-9)), `level ${n}: survivors`);
  }
});

// A player profile the generator knows nothing about (bot.js 'casual': reaction lag, jitter, coarse dodging, no
// platform lead). If the levels were tuned only to the generator's own autopilot, this would show it.
test('an imperfect casual player with the expected upgrades still wins nearly every level 1–30', () => {
  for (const seed of [1, 2, 3]) {
    const runs = CAMPAIGN.map((n) => ({ n, ...play(n, R.expectedUpgrades(n), 'casual', seed) }));
    const won = runs.filter((r) => r.result.won);
    assert.ok(won.length >= 27, `seed ${seed}: the casual bot won only ${won.length} of 30`);
    for (const r of won) assert.ok(r.margin <= 0.4, `level ${r.n}: margin ${(r.margin * 100).toFixed(1)}% — too easy`);
  }
});

test('the levels are not trivial: without upgrades even the smart bot loses most of levels 11–30', () => {
  const late = CAMPAIGN.filter((n) => n > 10);
  const lost = late.filter((n) => !play(n, {}, 'smart').result.won);
  assert.ok(lost.length >= 15, `won ${late.length - lost.length} of ${late.length} with no upgrades at all`);
});

test('the smart bot meets every kind of gate, obstacle and recruits along the campaign', () => {
  const seen = new Set();
  for (const n of CAMPAIGN) {
    for (const e of smartRun(n).events) seen.add(e.type === 'gate' ? `${e.op}` : e.type === 'hit' ? e.kind : e.type);
  }
  for (const k of ['add', 'sub', 'mul', 'pow', 'saw', 'wall', 'fall', 'recruit']) assert.ok(seen.has(k), `no ${k} met`);
  const taken = CAMPAIGN.flatMap((n) => smartRun(n).events.filter((e) => e.type === 'recruit'));
  assert.ok(taken.length >= 20 && taken.every((e) => e.taken), 'the smart bot picks up every band of recruits');
});

test('difficulty grows: more on the track and a stronger enemy weapon', () => {
  const things = (n) => { const d = R.levelDef(n); return d.gates.length + d.obstacles.length + d.platforms.length; };
  const avg = (ns) => ns.reduce((s, n) => s + things(n), 0) / ns.length;
  assert.ok(avg([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]) > avg([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]));
  for (let n = 2; n <= 40; n++) assert.ok(R.levelDef(n).enemy.power >= R.levelDef(n - 1).enemy.power, `level ${n}`);
});

test('expected upgrades start at zero, never go down and stay within the cap', () => {
  assert.deepEqual(R.expectedUpgrades(1), { start: 0, weapon: 0, shield: 0, income: 0 });
  let prev = R.expectedUpgrades(1);
  for (let n = 2; n <= 40; n++) {
    const u = R.expectedUpgrades(n);
    for (const id of R.UPGRADES) {
      assert.ok(u[id] >= prev[id] && u[id] <= R.MAX_UPGRADE, `level ${n}: ${id}`);
    }
    prev = u;
  }
  assert.throws(() => R.expectedUpgrades(0), /bad level/);
});

test('endless mode: levels past 30 keep coming and stay winnable with smaller margins', () => {
  for (let n = 31; n <= 45; n++) {
    const def = R.levelDef(n);
    assert.equal(def.length, 700);
    const { result, margin } = play(n, R.expectedUpgrades(n), 'smart');
    assert.ok(result.won, `level ${n}: lost (${result.reason})`);
    assert.ok(margin > 0.05 && margin <= 0.4, `level ${n}: margin ${(margin * 100).toFixed(1)}%`);
  }
  assert.ok(R.levelDef(500).enemy.count >= 1);
});

test('the generator autopilot agrees with the bot', () => {
  for (const n of [4, 13, 27]) {
    const u = R.expectedUpgrades(n);
    const auto = R.autoplay(R.levelDef(n), u, 'best').run;
    assert.equal(R.strength(auto), smartRun(n).result.strength, `level ${n}`);
  }
});

test('stars: the smart bot earns three on every level; the casual one mostly does, but not always', () => {
  for (const n of CAMPAIGN) assert.equal(R.starsFor(smartRun(n).run), 3, `level ${n}`);
  const casual = CAMPAIGN.flatMap((n) => [1, 2, 3].map((seed) => R.starsFor(play(n, R.expectedUpgrades(n), 'casual', seed).run)));
  const three = casual.filter((s) => s === 3).length;
  assert.ok(three >= casual.length * 0.5 && three < casual.length, `casual: ${three} of ${casual.length} with three stars`);
});

test('a moving saw is a real hazard: standing still in the middle loses soldiers on most of them', () => {
  let hits = 0;
  let total = 0;
  for (let n = 8; n <= 30; n++) {
    const L = R.parseLevel(R.levelDef(n));
    for (const o of L.obstacles.filter((x) => x.A > 0)) {
      total++;
      const [x0, x1] = R.obstacleSpan(o, R.crossTime(o.z));
      if (R.spanOverlap(0, 20, x0, x1) > 0) hits++;
    }
  }
  assert.ok(total >= 20 && hits >= total * 0.4, `${hits} of ${total} moving saws pass through the middle`);
});
