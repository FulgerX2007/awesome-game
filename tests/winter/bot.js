'use strict';
// Долгая зима: bots that live through a winter using the WinterCore API only. They think every second.
//   greedy    — a priority list: eat, keep the fire, sleep at night, repair the hut stage by stage, the pick, the
//               palisade, tools, then rescue survivors one by one; gathers what the next goal needs;
//   casual    — the same list, but thinks every 3 s and one time in four does a random useful thing instead;
//   noShelter — greedy, but never builds the stove, the palisade or torches.
const C = require('../../web/winter/core.js');

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

const FOODS = C.EAT_ORDER;
const foodStock = (g) => FOODS.reduce((a, k) => a + g.stock[k] * C.FOOD[k], 0);
const dist = (a, x, y) => Math.abs(a.x - (x + 0.5)) + Math.abs(a.y - (y + 0.5));
const busy = (g) => !!(g.hero.path || g.hero.target);
const center = { x: C.SPOT.fire.x, y: C.SPOT.fire.y + 1 };

// The nearest standing node of a kind that a path reaches, away from the bear.
function nearestNode(g, kind) {
  const safe = (n) => !g.bear || Math.hypot(g.bear.x - n.x - 0.5, g.bear.y - n.y - 0.5) > C.BEAR.sight + 3;
  const list = g.nodes.filter((n) => n.kind === kind && n.amount > 0 && safe(n)).sort((a, b) => dist(g.hero, a.x, a.y) - dist(g.hero, b.x, b.y));
  for (const n of list.slice(0, 6)) if (C.pathNextTo(g, g.hero, n.x, n.y)) return n;
  return null;
}

// The comforts (upgrades, gear) are paid in full and leave wood for the fires.
const WOOD_RESERVE = 30;
const spare = (g, cost) => C.afford(g, cost) && g.stock.wood - (cost.wood || 0) >= WOOD_RESERVE;

// The goals in order: what to build or make next. → { id, cost, act: () => result } | null
function nextGoal(g, cfg) {
  const patch = { id: 'patch', cost: C.ROOF_FIX, paid: g.hut.patchPaid, act: () => C.contribute(g, 'patch') };
  if (g.hut.stage >= 1 && !g.tools.pick) return { id: 'pick', cost: C.TOOLS.pick.cost, act: () => C.craft(g, 'pick') };
  if (g.hut.stage < 3) return { id: 'hut', cost: C.HUT_STAGES[g.hut.stage].cost, paid: g.hut.paid, act: () => C.contribute(g, 'hut') };
  if (g.hut.stage < 4 && cfg.shelter) return { id: 'hut', cost: C.HUT_STAGES[g.hut.stage].cost, paid: g.hut.paid, act: () => C.contribute(g, 'hut') };
  if (!g.tools.spear) return { id: 'spear', cost: C.TOOLS.spear.cost, act: () => C.craft(g, 'spear') };
  if (cfg.shelter) {
    const i = g.palisade.findIndex((p) => !p.built || p.hp < C.PALISADE_HP * 0.5);
    if (i >= 0) return { id: `palisade:${i}`, cost: C.needOf(g, `palisade:${i}`).cost, paid: g.palisade[i].paid, act: () => C.contribute(g, `palisade:${i}`) };
  }
  // a hole in the roof: patched once the camp is fenced, with wood to spare for the fires
  if (g.hut.roofHole && g.stock.wood >= C.ROOF_FIX.wood + 10) return patch;
  if (!g.tools.shovel) return { id: 'shovel', cost: C.TOOLS.shovel.cost, act: () => C.craft(g, 'shovel') };
  const home = g.survivors.filter((s) => s.state === 'home' || s.state === 'following').length;
  const bunks = g.bunks.filter((b) => b.built).length;
  if (bunks * 2 < home + 1 && bunks < 3) {
    const i = g.bunks.findIndex((b) => !b.built);
    return { id: `bunk:${i}`, cost: C.BUNK_COST, paid: g.bunks[i].paid, act: () => C.contribute(g, `bunk:${i}`) };
  }
  if (!g.tools.icePick) return { id: 'icePick', cost: C.TOOLS.icePick.cost, act: () => C.craft(g, 'icePick') };
  if (!g.tools.ironAxe) return { id: 'ironAxe', cost: C.TOOLS.ironAxe.cost, act: () => C.craft(g, 'ironAxe') };
  // the house upgrades, in the core's order, once the stove stands
  if (g.hut.stage >= C.HUT_STAGES.length) {
    const up = C.UPGRADE_IDS.find((u) => !g.upgrades[u].built);
    if (up) return { id: `up:${up}`, cost: C.UPGRADES[up].cost, paid: g.upgrades[up].paid, reserve: WOOD_RESERVE, act: () => (spare(g, C.UPGRADES[up].cost) ? C.contribute(g, `up:${up}`) : 'wait') };
  }
  // the workshop's gear: the sled, the coat, the lantern, then snares to set around the camp
  if (C.upgradeOn(g, 'workshop')) {
    const gear = ['sled', 'coat', 'lantern'].find((id) => !g.gear[id]);
    if (gear) return { id: gear, cost: C.GEAR[gear].cost, reserve: WOOD_RESERVE, act: () => (spare(g, C.GEAR[gear].cost) ? C.craft(g, gear) : 'wait') };
    if (g.gear.snares + g.snares.length < C.SNARE.max) return { id: 'snares', cost: C.GEAR.snares.cost, reserve: WOOD_RESERVE, act: () => (spare(g, C.GEAR.snares.cost) ? C.craft(g, 'snares') : 'wait') };
  }
  return null;
}

const missing = (g, goal) => {
  const out = {};
  for (const k of Object.keys(goal.cost)) {
    const left = goal.cost[k] + (k === 'wood' ? goal.reserve || 0 : 0) - ((goal.paid && goal.paid[k]) || 0) - g.stock[k];
    if (left > 0) out[k] = left;
  }
  return out;
};

const RESCUE_ORDER = ['herbalist', 'hunter', 'child', 'carpenter', 'smith'];

function think(g, cfg, r) {
  const h = g.hero;
  const night = C.isNight(g), tod = C.timeOfDay(g);
  const atBase = C.atBase(g);
  if (h.food < 45) C.eat(g);
  // events that ask: fix the roof when the stock allows, help the wanderer when food is plentiful
  const ev = g.event;
  if (ev && ev.phase === 'ask') {
    // the roof now only with wood to spare for the fires; else later, from the build list
    if (ev.id === 'roof') { if (g.stock.wood < C.ROOF_FIX.wood + 30 || C.answerEvent(g, 'fix') !== 'ok') C.answerEvent(g, 'later'); }
    else if (ev.id === 'wanderer') { if (C.answerEvent(g, 'help') !== 'ok') C.answerEvent(g, 'ignore'); }
  }
  // the bear in sight: back to the camp, where he never goes
  if (g.bear && !atBase && Math.hypot(g.bear.x - h.x, g.bear.y - h.y) <= C.BEAR.sight + 2) {
    if (!h.target || h.target.type !== 'walk' || !h.path) C.interact(g, center.x, center.y);
    return;
  }
  // a wolf close by: fight it
  const wolf = g.wolves.filter((w) => Math.hypot(w.x - h.x, w.y - h.y) < 2.5)[0];
  if (wolf) { if (!h.target || h.target.type !== 'wolf') C.interact(g, wolf.x, wolf.y); return; }
  if (h.sleeping) return;
  // the fires: keep them fed from the camp
  const fireLow = g.fire.fuel < 6 || (cfg.shelter && g.hut.stage >= 4 && g.hut.stove < 10);
  if (fireLow && g.stock.wood > 0 && (atBase || night || h.warmth < 50)) {
    if (!h.target || h.target.type !== 'fire') C.interact(g, C.SPOT.fire.x, C.SPOT.fire.y);
    return;
  }
  // cook raw food when there's some
  if (atBase && (g.stock.meat >= 2 || g.stock.fish >= 2) && C.fireOn(g) && !busy(g)) { C.interact(g, C.SPOT.fire.x, C.SPOT.fire.y); return; }
  // night: home, the bed when it's there
  const lateDay = tod > C.NIGHT_AT - 18;
  if (night || (lateDay && !atBase)) {
    if (g.hut.stage >= 2) {
      if (!h.target || h.target.type !== 'bed') C.interact(g, C.SPOT.bed.x, C.SPOT.bed.y);
    } else if (!atBase || dist(h, C.SPOT.fire.x, C.SPOT.fire.y) > 2.5) {
      C.interact(g, center.x, center.y);
    }
    return;
  }
  // the fires dying and no wood: waiting by the ashes only kills; fetch a log
  if (g.fire.fuel < 3 && g.hut.stove < 3 && g.stock.wood < 2 && h.health > 15) {
    if (!h.target || h.target.type !== 'node') { const n = nearestNode(g, 'tree'); if (n) C.interact(g, n.x, n.y); }
    return;
  }
  // a killing frost with the stove lit: sleep it off in the warm hut (sleep there runs faster)
  if (C.stoveOn(g) && C.chill(g) >= 1.3 && g.hut.stove > 4 && h.warmth < 95 && atBase) {
    if (!h.target || h.target.type !== 'bed') C.interact(g, C.SPOT.bed.x, C.SPOT.bed.y);
    return;
  }
  // cold: into the hut by the stove when it burns, else to the fire; on a cold day turn back in time
  const warmSpot = C.stoveOn(g) ? C.SPOT.bed : center;
  const turnBack = Math.min(70, 20 + C.chill(g) * 22);
  if (h.warmth < 35 || (!atBase && h.warmth < turnBack)) {
    const there = C.stoveOn(g) ? C.inHut(h) : dist(h, C.SPOT.fire.x, C.SPOT.fire.y) <= 2.5;
    if (!there && (!h.target || h.target.type !== 'walk')) C.interact(g, warmSpot.x, warmSpot.y);
    // waiting only helps where it actually warms; by a fire that loses to the frost, go for wood instead
    if (!there || (h.warmth < 80 && C.warmthRate(g, h) > 0)) return;
  }
  // full hands: back to the camp
  if (!atBase && h.load >= C.carryOf(g) - 2) { C.interact(g, center.x, center.y); return; }
  // snares in hand: set one beside the path, outside the camp
  if (!atBase && g.gear.snares > 0) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (C.placeSnare(g, h.x + dx, h.y + dy) === 'ok') break;
  }
  if (busy(g)) return;
  // build whatever can be built now, from the camp
  const goal = nextGoal(g, cfg);
  if (goal && atBase) {
    const res = goal.act();
    if (res === 'done' || res === 'ok') return;
  }
  // the trader: hides for metal, meat for a tool, and whatever spare food buys; from next to his sled
  if (g.trader && !cfg.casual && tod < C.NIGHT_AT - 20 && h.warmth > 50) {
    const spareFood = foodStock(g) > 220;
    const want = g.trader.offers.map((o, i) => ({ o, i })).filter(({ o }) => !o.taken && C.afford(g, o.give)
      && (o.give.hide ? true : o.give.wood ? g.stock.wood >= o.give.wood + 40 : o.give.stone || o.give.metal ? false : spareFood || o.get.tool));
    if (want.length) {
      const near = Math.hypot(g.trader.x + 0.5 - h.x, g.trader.y + 0.5 - h.y) <= C.TRADE_REACH;
      if (near) { for (const { i } of want) C.trade(g, i); return; }
      if (!busy(g) || (h.target && h.target.type === 'walk')) { if (C.interact(g, g.trader.x, g.trader.y) === 'trader') return; }
    }
  }
  // a lost child first: bring him back before night
  const lost = g.survivors.find((s) => s.state === 'lost');
  if (lost && tod < C.NIGHT_AT - 10) {
    if (!h.target || h.target.type !== 'fetch') C.interact(g, lost.x, lost.y);
    return;
  }
  // the wanderer, when there's food to spare and light enough for the walk
  if (ev && ev.id === 'wanderer' && ev.phase === 'active' && foodStock(g) > 150 && g.stock.wood >= 30 && h.warmth > 70 && tod < C.NIGHT_AT - 40 && !cfg.casual) {
    if (C.interact(g, ev.x, ev.y) === 'wanderer') return;
  }
  // rescue: survivors whose need is met
  if (g.hut.stage >= (cfg.shelter ? 4 : 3) && (!cfg.shelter || C.palisadeUp(g))) {
    for (const id of RESCUE_ORDER) {
      const sv = g.survivors.find((s) => s.id === id);
      if (sv.state !== 'waiting') continue;
      const need = C.SURVIVORS[id].need;
      if (need === 'shovel' && !g.tools.shovel) continue;
      if (need === 'icePick' && !g.tools.icePick) continue;
      if (need === 'meat' && g.stock.meat < 3) continue;
      if (need === 'palisade' && !C.palisadeUp(g)) continue;
      if (tod > C.NIGHT_AT - 45) break; // not enough light left for a long walk
      if (C.interact(g, sv.x, sv.y) === 'rescue') return;
    }
  }
  // food first when low, then the goal's resources
  const people = 1 + g.survivors.filter((s) => s.state === 'home').length;
  const wantFood = foodStock(g) < 120 * people;
  const need = goal ? missing(g, goal) : {};
  const order = [];
  if (wantFood) order.push('food');
  for (const k of ['wood', 'stone', 'metal', 'hide']) if (need[k]) order.push(k);
  if (g.stock.wood < 30) order.push('wood');
  if (!wantFood) order.push('food');
  order.push('wood');
  if (cfg.casual && r() < 0.25) order.unshift(['wood', 'food', 'stone'][Math.floor(r() * 3)]);
  for (const what of order) {
    if (what === 'food') {
      const prey = g.animals.filter((a) => a.kind === 'rabbit' || g.tools.spear).sort((a, b) => dist(h, a.x - 0.5, a.y - 0.5) - dist(h, b.x - 0.5, b.y - 0.5))[0];
      if (prey && dist(h, prey.x - 0.5, prey.y - 0.5) < 14 && C.interact(g, prey.x, prey.y) === 'hunt') return;
      const bush = nearestNode(g, 'bush');
      if (bush && C.interact(g, bush.x, bush.y) === 'pick') return;
      // fishing from the shore
      for (const [x, y] of [[44, 8], [44, 12], [44, 16]]) if (C.interact(g, x, y) === 'fish') return;
      continue;
    }
    if (what === 'hide') {
      // hides come from deer, and deer need the spear
      const deer = g.tools.spear && g.animals.filter((a) => a.kind === 'deer').sort((a, b) => dist(h, a.x - 0.5, a.y - 0.5) - dist(h, b.x - 0.5, b.y - 0.5))[0];
      if (deer && C.interact(g, deer.x, deer.y) === 'hunt') return;
      continue;
    }
    const kind = { wood: 'tree', stone: 'rock', metal: 'scrap' }[what];
    if (kind === 'rock' && !g.tools.pick) continue;
    const n = nearestNode(g, kind);
    if (n && C.interact(g, n.x, n.y) !== 'none') return;
  }
}

function config(name) {
  if (name === 'greedy') return { think: 1, shelter: true };
  if (name === 'casual') return { think: 3, shelter: true, casual: true };
  if (name === 'noShelter') return { think: 1, shelter: false };
  throw new Error(`unknown bot ${name}`);
}

// Plays a whole winter. → { status, day, alive, stars, timeline, realMinutes, g }
function play(name, difficulty = 'normal', seed = 1, opts = {}) {
  const cfg = config(name), r = mulberry(seed * 31 + 7);
  const g = C.newGame(difficulty, seed);
  const timeline = {};
  let next = 0, real = 0;
  const frame = 0.25;
  while (g.status === 'playing') {
    if (g.t >= next) { think(g, cfg, r); next = g.t + cfg.think; }
    const before = g.t;
    C.step(g, frame);
    real += frame;
    for (const e of C.drain(g)) {
      if (e.type === 'built') timeline[e.id === 'hut' ? `hut:${e.stage}` : e.id === 'palisade' ? `palisade:${e.segment}` : `bunk:${e.bunk}`] ??= C.dayOf(g);
      if (e.type === 'joined') timeline[`joined:${e.id}`] = C.dayOf(g);
      if (e.type === 'eventDone') timeline[`ev:${e.id}:${e.choice}`] = (timeline[`ev:${e.id}:${e.choice}`] || 0) + 1;
      if (e.type === 'upgraded') timeline[`up:${e.id}`] = C.dayOf(g);
      if (e.type === 'died') timeline[`died:${e.id}`] = C.dayOf(g);
    }
    if (opts.maxDays && C.dayOf(g) > opts.maxDays) break;
    if (g.t === before && g.status === 'playing') break; // safety
  }
  return {
    status: g.status, day: C.dayOf(g), alive: g.survivors.filter((s) => s.state === 'home' || s.state === 'lost').length,
    stars: C.stars(g), timeline, realMinutes: real / 60, g,
  };
}

module.exports = { play, config, think, mulberry };
