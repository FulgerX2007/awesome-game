'use strict';
// Greedy balance bot for «Родник». It plays only through the public core.js API, like a real player:
// it walks to nodes with interact(), walks to ruins before contribute(), and upgrades tools as soon as it can.
// It never edits the state directly.
const V = require('../../web/village/core.js');

const CHUNK = 0.5;      // seconds of game time per bot decision while walking or gathering
const WAIT = 5;         // seconds to wait when there is nothing useful to do
const LIMIT = 6 * 3600; // a run that takes longer than this is a deadlock
const RAW = new Set(['wood', 'stone', 'clay', 'berries', 'apples', 'vegetables', 'fish']);
const REACTION = 0.3;   // seconds from a bite to the bot's strike, like a player watching the float
// Resources that can only be had in some seasons: the bot stocks up on them while it can.
const SEASONAL = ['apples', 'vegetables'];
// product → raw material its workshop eats
const FEED = Object.fromEntries(Object.values(V.WORKSHOPS).map((w) => [w.to, w.from]));
const KIND_OF = Object.fromEntries(Object.entries(V.NODE_KINDS).map(([k, n]) => [n.res, k]));
const TOOL_ORDER = ['axe', 'pick', 'shovel', 'basket', 'rod'];

function reachable(s, n) {
  if (n.kind === 'shoal') return s.built.pier.done; // the rod comes with the pier
  const z = V.zoneAt(n.x, n.y);
  if (z === 'hamlet') return s.built.road.done;
  if (z === 'lake') return s.built.glade.done;
  return z === 'west' || s.built.bridge.done;
}

// Play one game: to the festival; with { until: 'harvest' } on over the hill to the harvest festival;
// with { until: 'lanterns' } on past the forest to the lantern festival.
// Returns a log of milestones (game time of each building, tool or barn level, order and purchase).
function play(seed, opts = {}) {
  const s = V.newGame(seed);
  const limit = opts.limit || LIMIT;
  const log = [];

  const drain = () => {
    let arrived = false;
    for (const e of s.events) {
      if (e.type === 'built') log.push({ t: s.t, what: e.level ? `barn${e.level}` : e.id });
      else if (e.type === 'tool') log.push({ t: s.t, what: `${e.tool}${e.level}` });
      else if (e.type === 'order') log.push({ t: s.t, what: `order${e.id}` });
      else if (e.type === 'buy') log.push({ t: s.t, what: `buy-${e.id}` });
      else if (e.type === 'ruin') arrived = true;
    }
    s.events.length = 0;
    return arrived;
  };

  // Advance until the current order (walk/gather) is over.
  const busy = () => s.player.path || s.player.target;
  const finishOrder = () => {
    let arrived = false;
    while (busy() && s.t < limit) {
      V.step(s, CHUNK);
      if (drain()) arrived = true;
    }
    return arrived;
  };

  const upgrade = () => {
    for (const tool of TOOL_ORDER) while (V.upgradeTool(s, tool) === 'ok');
    V.upgradeBarn(s);
    drain();
  };

  // Walk to the ruin, then contribute.
  const visit = (id) => {
    const f = V.FOOTPRINTS[id][0];
    if (V.interact(s, f.x, f.y) !== 'ruin') return false;
    finishOrder();
    const r = V.contribute(s, id);
    drain();
    return r === 'ok' || r === 'built';
  };

  // Walk to a tile and act there through interact(); true when the order was carried out.
  const go = (x, y, expect) => {
    if (V.interact(s, x, y) !== expect) return false;
    finishOrder();
    drain();
    return true;
  };

  // One garden job, the most useful first: harvest, water a dry plot (filling the bucket first), sow.
  // False when no plot needs anything that can be done now.
  const tend = () => {
    if (!s.built.garden.done) return false;
    const winter = V.clock(s.t).season === 'winter';
    const plots = s.plots.map((pl, i) => ({ pl, i, at: V.PLOTS[i] }));
    const ripe = plots.find((p) => p.pl.stage === 'ripe');
    if (ripe) return go(ripe.at.x, ripe.at.y, 'plot');
    const dry = plots.find((p) => p.pl.stage === 'planted' && !p.pl.water);
    if (dry && !winter) {
      if (s.bucket <= 0) { const w = V.FOOTPRINTS.well[0]; return go(w.x, w.y, 'well'); }
      return go(dry.at.x, dry.at.y, 'plot');
    }
    const empty = plots.find((p) => p.pl.stage === 'empty');
    if (empty && !winter) {
      if (s.res.berries >= 1) return go(empty.at.x, empty.at.y, 'plot');
      return gather('berries'); // seed first
    }
    return false;
  };

  // How much of a resource the buildings still to come need beyond the stock.
  const shortOf = (r) => {
    let need = 0;
    for (const id of V.BUILDING_IDS) if (!s.built[id].done) need += V.remaining(s, id)[r] || 0;
    return need - s.res[r];
  };

  // Fish at a shoal the bot already walks to: strike REACTION seconds after each bite, until the shoal is
  // empty or the fish are gone. Small steps, so the strike lands inside the window.
  const fish = () => {
    let biteAt = null;
    while (s.player.target && s.t < limit) {
      V.step(s, V.MAX_DT);
      for (const e of s.events) if (e.type === 'bite') biteAt = s.t;
      drain();
      if (biteAt !== null && s.t - biteAt >= REACTION - 1e-9) { V.strike(s); biteAt = null; drain(); }
    }
    return true;
  };

  // Gather the nearest standing node of a resource. False when there is none in reach.
  const gather = (res) => {
    if (res === 'vegetables') return tend();
    const kind = KIND_OF[res];
    const p = s.player;
    const cands = s.nodes
      .filter((n) => n.kind === kind && n.hp > 0 && reachable(s, n))
      .map((n) => ({ n, d: Math.hypot(n.x + 0.5 - p.x, n.y + 0.5 - p.y) }))
      .sort((a, b) => a.d - b.d);
    for (const { n } of cands.slice(0, 4)) {
      const r = V.interact(s, n.x, n.y);
      if (r === 'gather') {
        finishOrder();
        return true;
      }
      if (r === 'fish') return fish();
    }
    return false;
  };

  // Orders the bot can fill without touching what the next building still needs.
  const spare = () => {
    const goal = V.nextGoal(s);
    let keep = goal && goal.type === 'build' ? V.remaining(s, goal.id) : {};
    // Short of coins for it (the pavilion): orders come first, the goods grow back.
    if (keep.coins && s.res.coins < keep.coins) keep = {};
    return s.orders.filter((o) => Object.entries(o.need).every(([r, n]) => s.res[r] - n >= (keep[r] || 0)));
  };
  // What the bot buys at the fair, most useful first, when it has the coins.
  const WISH = ['bucket', 'cuttings', 'boat'];
  const wanted = () => WISH.filter((id) => V.fairItems(s).includes(id) && !s.bought.includes(id) && s.res.coins >= V.FAIR[id].price && V.fairOpen(s));
  const fillOrders = () => {
    if (!s.built.market.done || (!spare().length && !wanted().length)) return false;
    const f = V.FOOTPRINTS.market[0];
    if (V.interact(s, f.x, f.y) !== 'ruin') return false;
    finishOrder();
    for (const o of spare()) V.fulfill(s, o.id);
    for (const id of wanted()) V.buy(s, id);
    drain();
    return true;
  };

  const done = () => (opts.until === 'lanterns' ? s.lanternFestival : opts.until === 'harvest' ? s.harvestFestival : s.festival);
  let festivalAt = null, harvestAt = null, harvestCoins = null;
  const marks = () => {
    if (s.festival && festivalAt === null) festivalAt = s.t;
    if (s.harvestFestival && harvestAt === null) { harvestAt = s.t; harvestCoins = s.res.coins; }
  };
  // Coins come from orders: gather whatever raw good an order still lacks, or wait for new orders.
  const earn = () => {
    const lack = s.orders.flatMap((o) => Object.entries(o.need).filter(([r, n]) => RAW.has(r) && s.res[r] < n).map(([r]) => r));
    if (lack.length && gather(lack[0])) return;
    V.step(s, WAIT); drain();
  };
  // An order short of a few raw goods: the bot gathers them, like a player who keeps the board busy.
  const orderLack = () => {
    for (const o of s.orders) {
      const miss = Object.entries(o.need).filter(([r, n]) => s.res[r] < n);
      if (miss.length && miss.every(([r, n]) => RAW.has(r) && n - s.res[r] <= 30)) return miss[0][0];
    }
    return null;
  };

  while (!done() && s.t < limit) {
    marks();
    upgrade();
    if (fillOrders()) continue;
    const lackR = s.built.market.done ? orderLack() : null;
    if (lackR && gather(lackR)) continue;
    // Seasonal things first, while they last: ripe or thirsty plots, apples on the trees.
    if (SEASONAL.some((r) => shortOf(r) > 0 && gather(r))) continue;
    const goal = V.nextGoal(s);
    // Waiting for the fair (the vine cuttings): orders and the garden meanwhile, then wait.
    if (goal && goal.type === 'fair') {
      // Short of coins for it: earn them; with the coins, wait for the fair day.
      if (s.res.coins < V.FAIR[goal.item].price) earn();
      else { V.step(s, WAIT); drain(); }
      continue;
    }
    // No goal, or a missing tool the bot can't get (the shovel before the bridge): that is a deadlock.
    if (!goal || goal.type !== 'build') break;
    const id = goal.id;
    const left = V.remaining(s, id);

    // Ready to visit when the raw resources are all there and every product is either enough or capped by storage.
    let ready = true;
    let want = null, wantGap = 0;
    for (const [r, n] of Object.entries(left)) {
      const have = s.res[r];
      if (have >= n) continue;
      if (RAW.has(r)) {
        ready = false;
        const gap = (n - have) / n;
        if (gap > wantGap) { want = r; wantGap = gap; }
      } else if (have < Math.min(n, s.storage)) {
        ready = false;
      }
    }
    if (!want) {
      // Only products are missing: feed the workshop that lags most.
      for (const [r, n] of Object.entries(left)) {
        if (RAW.has(r) || !FEED[r] || s.res[r] >= Math.min(n, s.storage)) continue; // coins, honey, juice: no workshop to feed
        const gap = (n - s.res[r]) / n;
        if (gap > wantGap) { want = FEED[r]; wantGap = gap; }
      }
    }
    if (ready && visit(id)) continue;
    if (want && gather(want)) continue;
    // A building that costs coins (the pavilion): pay what is there, then earn the rest.
    if (left.coins && s.res.coins < left.coins) {
      if (s.res.coins > 0 && visit(id)) continue;
      earn();
      continue;
    }
    V.step(s, WAIT);
    drain();
  }
  marks();
  return { s, log, festival: s.festival, harvest: s.harvestFestival, lanterns: s.lanternFestival, festivalAt, harvestAt, harvestCoins, t: s.t };
}

module.exports = { play };
