'use strict';
// Рубеж: bots that play a level through the FrontCore API only.
//   competent — a build order: workers and houses, a barracks, a wall at the front of the camp with a tower behind,
//               the forge and catapults where the level asks for them; attacks when the army outweighs the fortress;
//   casual    — thinks every 4 s and picks one of its three best moves at random, attacks at a random army size;
//   armyOnly  — competent, but never builds walls or towers;
//   skip:<idea> — competent without one of the level ideas (bridge, walls, towers, forge, catapult, stonewall).
// A bot that hasn't won within 3× the level's par of game time counts as lost.
const F = require('../../web/front/core.js');

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL = { bridge: true, walls: true, towers: true, forge: true, catapult: true, stonewall: true };

function config(name) {
  if (name === 'competent') return { ...ALL, think: 1 };
  if (name === 'casual') return { ...ALL, think: 4, casual: true };
  if (name === 'armyOnly') return { ...ALL, walls: false, towers: false, stonewall: false, think: 1 };
  if (name.startsWith('skip:')) {
    const idea = name.slice(5);
    const cfg = { ...ALL, think: 1 };
    if (!(idea in cfg)) throw new Error(`unknown idea ${idea}`);
    cfg[idea] = false;
    if (idea === 'walls') cfg.stonewall = false;
    return cfg;
  }
  throw new Error(`unknown bot ${name}`);
}

const free = (g, i) => !g.plots[i].b;
const plotsLeftOf = (g, x) => g.plots.map((p, i) => ({ p, i })).filter(({ p }) => p.x < x);

// The plot the camp is defended at: the front-most reachable plot not far past the last reachable resource node.
function defencePlot(g) {
  const lim = F.frontier(g);
  const lastNode = Math.max(F.KEEP_X, ...g.nodes.filter((n) => n.x < lim).map((n) => n.x));
  const list = plotsLeftOf(g, Math.min(lim, lastNode + 14));
  return list.length ? list[list.length - 1].i : -1;
}

// The candidate moves, best first. Each move is { name, go: () => result }.
function moves(g, cfg, level) {
  const out = [];
  const lim = F.frontier(g);
  const workers = F.count(g, 'worker'), cap = F.workerCap(g);
  const building = (id) => g.plots.some((p) => p.b && p.b.id === id);
  const built = (id) => g.plots.filter((p) => p.b && p.b.id === id).length;
  const back = plotsLeftOf(g, lim).filter(({ i }) => free(g, i));
  const backPlot = back.length ? back[0].i : -1;
  const def = defencePlot(g);
  const metalHere = g.nodes.some((n) => n.res === 'metal' && n.x < lim);
  const fortOpen = lim >= g.L - F.FORT_W;
  const army = g.units.filter((u) => u.kind !== 'worker').length + g.queue.filter((q) => q !== 'worker').length;
  const nextWave = g.waves.find((w) => !w.sent);
  const threat = g.foes.length > 0 || (nextWave && nextWave.at - g.t < 30);
  const bigWaves = level.waves.some((w) => Object.values(w.units).reduce((a, b) => a + b, 0) >= 4);
  const armyMove = () => {
    if (F.hasBuilding(g, 'forge')) {
      if (cfg.catapult && level.fortressHp >= 2000 && F.count(g, 'catapult') < 2) return { name: 'catapult', go: () => F.recruit(g, 'catapult') };
      // knights when the metal is there, else the cheaper troops: the wood shouldn't pile up
      return {
        name: 'knight',
        go: () => {
          const order = F.count(g, 'knight') > 2 * F.count(g, 'archer') ? ['archer', 'knight', 'soldier'] : ['knight', 'soldier', 'archer'];
          let last = 'nores';
          for (const k of order) { last = F.recruit(g, k); if (last === 'ok') return 'ok'; }
          return last;
        },
      };
    }
    return { name: 'army', go: () => F.recruit(g, F.count(g, 'soldier') > 2 * F.count(g, 'archer') ? 'archer' : 'soldier') };
  };

  if (workers < Math.min(cap, 5)) out.push({ name: 'worker', go: () => F.recruit(g, 'worker') });
  if (!building('barracks') && backPlot >= 0) out.push({ name: 'barracks', go: () => F.build(g, { plot: backPlot }, 'barracks') });
  // no metal on this side: the bridge to the mine comes first
  if (cfg.bridge && !metalHere && !fortOpen && building('barracks')) {
    const ci = g.chasms.findIndex((c) => !c.bridged);
    if (ci >= 0 && !g.chasms[ci].busy) out.push({ name: 'bridge', go: () => F.build(g, { chasm: ci }, 'bridge') });
  }
  if (F.hasBuilding(g, 'barracks') && threat && army < 4) out.push(armyMove());
  // with big waves coming, two houses until the tower stands (plots are few)
  const houseCap = cfg.towers && bigWaves && built('tower') === 0 ? 9 : 12;
  if (cap < houseCap && cap - workers <= 1 && !g.plots.some((p) => p.b && p.b.id === 'house' && !p.b.done) && backPlot >= 0) {
    out.push({ name: 'house', go: () => F.build(g, { plot: backPlot }, 'house') });
  }
  if (cfg.walls && bigWaves && def >= 0 && free(g, def) && built('wall') < 2 && building('barracks')) {
    out.push({ name: 'wall', go: () => F.build(g, { plot: def }, 'wall') });
  }
  if (cfg.towers && bigWaves && def >= 0 && built('tower') < 2 && (building('wall') || !cfg.walls) && building('barracks')) {
    const behind = plotsLeftOf(g, g.plots[def].x + 1).filter(({ i }) => free(g, i)).pop();
    if (behind) out.push({ name: 'tower', go: () => F.build(g, { plot: behind.i }, 'tower') });
  }
  if (cfg.bridge && !fortOpen && building('barracks')) {
    const ci = g.chasms.findIndex((c) => !c.bridged);
    if (ci >= 0 && !g.chasms[ci].busy) out.push({ name: 'bridge', go: () => F.build(g, { chasm: ci }, 'bridge') });
  }
  if (cfg.forge && metalHere && !building('forge') && building('barracks') && (level.towers >= 2 || level.fortressHp >= 1000) && backPlot >= 0) {
    out.push({ name: 'forge', go: () => F.build(g, { plot: backPlot }, 'forge') });
  }
  if (cfg.stonewall && level.waves.some((w) => w.units.ogre)) {
    const wp = g.plots.findIndex((p) => p.b && p.b.id === 'wall' && p.b.done && !p.b.stone);
    if (wp >= 0) out.push({ name: 'stonewall', go: () => F.build(g, { plot: wp }, 'stonewall') });
  }
  if (workers < Math.min(cap, 12)) out.push({ name: 'worker', go: () => F.recruit(g, 'worker') });
  if (F.hasBuilding(g, 'barracks')) out.push(armyMove());
  return out;
}

const dps = (kind) => F.UNITS[kind].dmg * (F.UNITS[kind].siege || 1) / F.UNITS[kind].interval;
const power = (g) => g.units.filter((u) => u.kind !== 'worker').reduce((s, u) => s + u.hp * dps(u.kind), 0);

function think(g, cfg, level, r, st) {
  // resources: metal and stone workers by what the next things cost
  const lim = F.frontier(g);
  const has = (res) => g.nodes.some((n) => n.res === res && n.x < lim);
  const workers = F.count(g, 'worker');
  F.setAlloc(g, 'metal', has('metal') && F.hasBuilding(g, 'barracks') ? Math.max(1, Math.round(workers * 0.35)) : 0);
  F.setAlloc(g, 'stone', has('stone') ? Math.max(1, Math.round(workers * 0.25)) : 0);
  F.setAlloc(g, 'wood', Math.max(1, workers - g.alloc.metal - g.alloc.stone));

  const list = moves(g, cfg, level);
  let waiting = null;
  if (cfg.casual) {
    const top = list.slice(0, 3);
    if (top.length) {
      const m = top[Math.floor(r() * top.length)];
      if (m.go() === 'nores') waiting = m;
    }
  } else {
    // try moves in order; a building that waits for resources blocks the cheaper moves after it
    for (const m of list) {
      const res = m.go();
      if (res === 'ok') continue;
      if (res === 'nores') { waiting = waiting || m; if (m.name !== 'army' && m.name !== 'knight' && m.name !== 'catapult') break; }
    }
  }
  // the workers go where the move we wait for is short
  if (waiting) {
    const short = F.missing(g, F.costOf(waiting.name === 'army' ? 'soldier' : waiting.name === 'knight' ? 'knight' : waiting.name));
    const keys = Object.keys(short).filter((k) => has(k));
    if (keys.length) {
      const total = keys.reduce((a, k) => a + short[k], 0);
      const n = Math.max(0, workers - 1);
      // keep a trickle of every reachable resource so the next goal isn't starved
      const floor = (res) => (has(res) && workers >= 6 ? 1 : 0);
      // more workers than the nodes have slots only queue up
      const slots = (res) => F.reachableNodes(g, res).length * F.NODE_SLOTS + 1;
      F.setAlloc(g, 'metal', Math.min(slots('metal'), Math.max(floor('metal'), keys.includes('metal') ? Math.round((n * short.metal) / total) : 0)));
      F.setAlloc(g, 'stone', Math.min(slots('stone'), Math.max(floor('stone'), keys.includes('stone') ? Math.round((n * short.stone) / total) : 0)));
      F.setAlloc(g, 'wood', Math.max(1, workers - g.alloc.metal - g.alloc.stone));
    }
  }

  // attack when the army is clearly stronger than the fortress; fall back when it melts
  const fortNeed = g.fort.hp * 5 + g.fort.towers * 2500;
  const armyN = g.units.filter((u) => u.kind !== 'worker').length;
  const fortOpen = lim >= g.L - F.FORT_W;
  // the foes on the field have to be beaten on the way
  const foePower = g.foes.reduce((a, f) => a + f.hp * F.ENEMIES[f.kind].dmg / F.ENEMIES[f.kind].interval, 0);
  if (g.order === 'hold' && fortOpen && (power(g) >= (fortNeed + foePower) * st.attackAt || F.armySize(g) >= F.ARMY_CAP)) F.setOrder(g, 'attack');
  if (g.order === 'attack' && (armyN < 3 || !fortOpen)) F.setOrder(g, 'hold');
}

// Plays one level. → { status, t, stars, keep, level }
function play(name, level, seed = 1) {
  const cfg = config(name), r = mulberry(seed * 977 + 5);
  const g = F.newGame(F.parseLevel(level), seed);
  const st = { attackAt: cfg.casual ? 0.6 + r() * 0.9 : 1 };
  const cap = level.par * 3;
  let next = 0;
  while (g.status === 'playing' && g.t < cap) {
    if (g.t >= next) { think(g, cfg, level, r, st); next = g.t + cfg.think; }
    F.step(g, 0.25);
    F.drain(g);
  }
  const status = g.status === 'playing' ? 'lost' : g.status;
  return { status, t: g.t, stars: status === 'won' ? F.stars(g) : 0, keep: g.keep.hp / g.keep.maxHp, g };
}

module.exports = { play, config, mulberry };
