'use strict';
// Balance bots for «Последняя крепость». They play only through CastleCore's public API: aim / setFiring / step
// during waves, chooseUpgrade / buy between them. Three players:
//   competent — solves the ballistic equation with lead, shoots whoever reaches the wall first (rams and
//               bosses count double, they hit hardest), lobs at shield-bearers far out,
//               picks upgrades by a fixed priority and keeps the wall repaired;
//   casual    — aims at the nearest enemy with noise (±6°, ±10 % power) and a 0.3 s reaction lag, picks upgrades
//               at random and repairs only when the wall is low;
//   noUpgrades — competent aim, never picks an upgrade or buys anything.
// Bots re-plan every few ticks instead of every tick, which keeps the balance tests fast.
const C = require('../../web/castle/core.js');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The angle that hits (dx, dy) from the archer at speed v: the low arc, or the high one; null when out of reach.
function ballistic(dx, dy, v, high) {
  const g = C.G;
  const disc = v ** 4 - g * (g * dx * dx + 2 * dy * v * v);
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  return Math.atan2(v * v + (high ? root : -root), g * dx);
}

// Aim at an enemy, leading it: the flight time moves the target, so solve a few times.
function aimAt(run, e, { high = false, power = 1 } = {}) {
  const v = power * C.stats(run).vmax;
  let x = e.x - (high ? 0 : e.w * 0.25), angle = null;
  const y = e.y + e.h * 0.5;
  for (let k = 0; k < 3; k++) {
    angle = ballistic(x - C.ARCHER.x, y - C.ARCHER.y, v, high);
    if (angle === null) return null;
    const t = (x - C.ARCHER.x) / (v * Math.cos(angle));
    x = e.atWall ? e.x : Math.max(C.WALL_X + e.w / 2, e.x - e.speed * t);
  }
  return angle;
}

const PRIORITY = ['multi', 'reload', 'power', 'pierce', 'ward', 'velocity', 'fire'];

const BOTS = {
  competent: {
    every: 6,
    target(run) {
      const live = run.enemies;
      if (!live.length) return null;
      // seconds until it reaches the wall (0 when already there), halved for the heavy hitters
      const eta = (e) => (e.atWall ? 0 : (e.x - C.WALL_X) / e.speed) / (e.wall >= 4 ? 2 : 1);
      return live.reduce((a, b) => (eta(b) < eta(a) ? b : a));
    },
    aim(run, e) {
      const lob = e.kind === 'shield' && e.x > 25;
      const angle = aimAt(run, e, lob ? { high: true, power: 0.95 } : {});
      return angle === null ? null : { angle, power: lob ? 0.95 : 1 };
    },
    between(run) {
      const pick = PRIORITY.find((id) => run.offer.includes(id));
      if (pick) C.chooseUpgrade(run, pick);
      if (run.wallHp < run.wallMax * 0.5) while (C.buy(run, 'repair') === 'ok' && run.wallHp < run.wallMax * 0.75);
      if (run.gold >= C.prices(run).fortify + 40) C.buy(run, 'fortify');
    },
  },
  casual: {
    every: 18,
    target(run) {
      return run.enemies.length ? run.enemies.reduce((a, b) => (b.x < a.x ? b : a)) : null;
    },
    aim(run, e, r) {
      const angle = aimAt(run, e);
      if (angle === null) return null;
      return { angle: angle + (r() * 2 - 1) * (6 * Math.PI / 180), power: 1 - r() * 0.1 };
    },
    between(run, r) {
      if (run.offer.length) C.chooseUpgrade(run, run.offer[Math.floor(r() * run.offer.length)]);
      if (run.wallHp < run.wallMax * 0.25) C.buy(run, 'repair');
    },
  },
  noUpgrades: {
    every: 6,
    target(run) { return BOTS.competent.target(run); },
    aim(run, e) { return BOTS.competent.aim(run, e); },
    between() {},
  },
};

// Plays a run until it ends or `maxWave` is cleared. → { status, wave, kills, score, wallHp }
function play(botName, mode, seed, maxWave = Infinity) {
  const bot = BOTS[botName];
  if (!bot) throw new Error(`bad bot ${botName}`);
  const r = rng(seed * 7919 + botName.length);
  const run = C.newRun(mode, seed);
  while (run.status === 'ready' || run.status === 'between') {
    if (run.wave >= maxWave) break;
    if (run.status === 'between') bot.between(run, r);
    C.startWave(run);
    let k = 0;
    while (run.status === 'wave') {
      if (k++ % bot.every === 0) {
        const e = bot.target(run);
        const a = e && bot.aim(run, e, r);
        if (a) C.aim(run, a.angle, a.power);
        C.setFiring(run, !!a);
      }
      C.step(run, C.TICK);
    }
    C.drain(run);
  }
  return { status: run.status, wave: run.wave, kills: run.kills, score: C.score(run), wallHp: run.wallHp, up: run.up };
}

module.exports = { BOTS, play, ballistic, aimAt, rng };
