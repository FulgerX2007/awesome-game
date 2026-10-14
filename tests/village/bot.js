'use strict';
// Greedy balance bot for «Родник». It plays only through the public core.js API, like a real player:
// it walks to nodes with interact(), walks to ruins before contribute(), and upgrades tools as soon as it can.
// It never edits the state directly.
const V = require('../../web/village/core.js');

const CHUNK = 0.5;      // seconds of game time per bot decision while walking or gathering
const WAIT = 5;         // seconds to wait when there is nothing useful to do
const LIMIT = 6 * 3600; // a run that takes longer than this is a deadlock
const RAW = new Set(['wood', 'stone', 'clay', 'berries']);
const FEED = { planks: 'wood', bricks: 'clay' }; // product → raw material its workshop eats
const KIND_OF = Object.fromEntries(Object.entries(V.NODE_KINDS).map(([k, n]) => [n.res, k]));
const TOOL_ORDER = ['axe', 'pick', 'shovel', 'basket'];

function remaining(s, id) {
  const out = {};
  for (const [r, n] of Object.entries(V.BUILDINGS[id].cost)) {
    const left = n - s.built[id].paid[r];
    if (left > 0) out[r] = left;
  }
  return out;
}

function reachable(s, n) {
  const z = V.zoneAt(n.x, n.y);
  return z === 'west' || s.built.bridge.done;
}

// Play one game. Returns a log of milestones (game time of each building, tool and barn level).
function play(seed, opts = {}) {
  const s = V.newGame(seed);
  const limit = opts.limit || LIMIT;
  const log = [];

  const drain = () => {
    let arrived = false;
    for (const e of s.events) {
      if (e.type === 'built') log.push({ t: s.t, what: e.level ? `barn${e.level}` : e.id });
      else if (e.type === 'tool') log.push({ t: s.t, what: `${e.tool}${e.level}` });
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

  // Gather the nearest standing node of a resource. False when there is none in reach.
  const gather = (res) => {
    const kind = KIND_OF[res];
    const p = s.player;
    const cands = s.nodes
      .filter((n) => n.kind === kind && n.hp > 0 && reachable(s, n))
      .map((n) => ({ n, d: Math.hypot(n.x + 0.5 - p.x, n.y + 0.5 - p.y) }))
      .sort((a, b) => a.d - b.d);
    for (const { n } of cands.slice(0, 4)) {
      if (V.interact(s, n.x, n.y) === 'gather') {
        finishOrder();
        return true;
      }
    }
    return false;
  };

  while (!s.festival && s.t < limit) {
    upgrade();
    const goal = V.nextGoal(s);
    // No goal, or a missing tool the bot can't get (the shovel before the bridge): that is a deadlock.
    if (!goal || goal.type !== 'build') break;
    const id = goal.id;
    const left = remaining(s, id);

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
        if (RAW.has(r) || s.res[r] >= Math.min(n, s.storage)) continue;
        const gap = (n - s.res[r]) / n;
        if (gap > wantGap) { want = FEED[r]; wantGap = gap; }
      }
    }
    if (ready && visit(id)) continue;
    if (want && gather(want)) continue;
    V.step(s, WAIT);
    drain();
  }
  return { s, log, festival: s.festival, t: s.t };
}

module.exports = { play };
