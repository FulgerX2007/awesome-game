'use strict';
// Balance bots for «Числовой забег». They play only through the public core.js API, like a player with a finger
// on the screen: every tick they look at the run and pass a target x to step(). They never edit the run.
//   smart: looks one gate ahead and takes the side with the larger resulting strength (count·power), steers to
//          the spot where the next obstacle takes the fewest soldiers, and rides the moving platforms;
//   dumb:  steers the same way but always takes the worse side of a gate.
//   casual: an imperfect human, built independently of the generator's autopilot: it rethinks only every
//          quarter second (holding its finger in between), aims with a little seeded jitter, dodges an obstacle by
//          going to the far side of the track instead of the exact best spot, and follows a platform where it is
//          now rather than where it will be. At a gate it still takes the side with the larger strength.
const R = require('../../web/rush/core.js');

const SAMPLES = 40; // candidate positions tried when dodging an obstacle

// The first item of a z-sorted list that is still ahead of the crowd.
const ahead = (list, z, key = 'z') => list.find((it) => it[key] > z) || null;

// Strength after taking a gate op.
function after(run, op) {
  const r = R.applyOp(run.count, run.power, op);
  return r.count * r.power;
}

// Where the crowd's centre should go now.
function target(run, mode) {
  const L = run.level;
  const t = run.ticks / R.HZ;
  const on = R.platformAt(L, run.z);
  if (on) return R.platformX(on, t + R.TICK);

  const gate = L.gates.find((g) => g.z > run.z && !g.full) || null;
  const obst = ahead(L.obstacles, run.z);
  const plat = ahead(L.platforms, run.z, 'z0');
  const dist = (v, z) => (v ? z - run.z : Infinity);
  const dg = dist(gate, gate && gate.z);
  const dob = dist(obst, obst && obst.z);
  const dp = dist(plat, plat && plat.z0);

  if (dp < dg && dp < dob) return R.platformX(plat, t + dp / R.SPEED);
  if (dob < dg) {
    // Try positions across the track and keep the one that loses the fewest soldiers (closest on a tie).
    const lim = 1 - R.radius(run.count);
    let best = run.x;
    let bestLoss = Infinity;
    for (let i = 0; i <= SAMPLES; i++) {
      const x = -lim + (2 * lim * i) / SAMPLES;
      const loss = R.spanOverlap(x, run.count, obst.x0, obst.x1);
      if (loss < bestLoss - 1e-12 || (Math.abs(loss - bestLoss) <= 1e-12 && Math.abs(x - run.x) < Math.abs(best - run.x))) {
        best = x;
        bestLoss = loss;
      }
    }
    return best;
  }
  if (!gate) return run.target;
  const sl = after(run, gate.left);
  const sr = after(run, gate.right);
  const goLeft = mode === 'dumb' ? sl < sr : sl > sr;
  return goLeft ? -1 : 1;
}

const CASUAL_LAG = 15;     // ticks between decisions (0.25 s)
const CASUAL_JITTER = 0.12; // ± aim error, track units

function casualTarget(run, mem) {
  if (mem.wait > 0) { mem.wait--; return mem.x; }
  mem.wait = CASUAL_LAG - 1;
  const L = run.level;
  const t = run.ticks / R.HZ;
  const jitter = (mem.rand() * 2 - 1) * CASUAL_JITTER;
  const on = R.platformAt(L, run.z);
  const gate = L.gates.find((g) => g.z > run.z && !g.full) || null;
  const obst = ahead(L.obstacles, run.z);
  const plat = ahead(L.platforms, run.z, 'z0');
  const dg = gate ? gate.z - run.z : Infinity;
  const dob = obst ? obst.z - run.z : Infinity;
  const dp = plat ? plat.z0 - run.z : Infinity;
  let x;
  if (on) x = R.platformX(on, t);
  else if (dp < dg && dp < dob) x = R.platformX(plat, t);
  else if (dob < dg) x = (obst.x0 + obst.x1) / 2 > 0 ? -0.75 : 0.75;
  else if (gate) x = after(run, gate.left) >= after(run, gate.right) ? -0.6 : 0.6;
  else x = mem.x;
  mem.x = Math.max(-1, Math.min(1, x + jitter));
  return mem.x;
}

// Plays one level (a number or a definition) to the end. Returns { run, result, margin, events } where margin is
// strength / (army + boss HP) − 1 (−1 when the crowd was lost on the track).
// `seed` drives the casual bot's jitter.
function play(level, upgrades = {}, mode = 'smart', seed = 1) {
  const run = R.newRun(level, upgrades);
  const events = [];
  const mem = { wait: 0, x: 0, rand: R.rng(seed) };
  let guard = 0;
  while (run.status === 'running') {
    R.step(run, R.TICK, mode === 'casual' ? casualTarget(run, mem) : target(run, mode));
    events.push(...run.events);
    run.events.length = 0;
    if (++guard > 1e6) throw new Error('the run never ends');
  }
  const result = R.finishBattle(run);
  const margin = result.strength / (result.enemy + result.boss) - 1;
  return { run, result, margin, events };
}

// A whole campaign from a fresh save: play the next level, bank the coins, then buy the cheapest upgrade while
// there are coins for it. Stops after `upTo` is won or after `maxRuns` runs.
// Options: mode — the bot ('smart' or 'casual'); shop — 'cheapest' (the generator's own model), 'none', or a
// priority list of upgrade ids (buy the first affordable one in that order, again and again).
// Returns { save, runs: [{ n, won, coins, upgrades }], worstStreak } where worstStreak is the longest run of
// losses in a row on one level.
function campaign(upTo = 30, maxRuns = 200, { mode = 'smart', shop = 'cheapest' } = {}) {
  const save = R.newSave();
  const runs = [];
  let streak = 0;
  let worstStreak = 0;
  while (save.level <= upTo && runs.length < maxRuns) {
    const n = save.level;
    const upgrades = { ...save.upgrades };
    const { result, run } = play(n, upgrades, mode, runs.length + 1);
    const coins = R.record(save, run);
    runs.push({ n, won: result.won, coins, upgrades, margin: result.strength / (result.enemy + result.boss) - 1 });
    streak = result.won ? 0 : streak + 1;
    worstStreak = Math.max(worstStreak, streak);
    if (shop === 'cheapest') {
      for (let id = R.cheapest(save.upgrades); id && R.buy(save, id) === 'ok'; id = R.cheapest(save.upgrades));
    } else if (Array.isArray(shop)) {
      while (shop.some((id) => R.buy(save, id) === 'ok'));
    }
  }
  return { save, runs, worstStreak };
}

module.exports = { play, campaign, target };
