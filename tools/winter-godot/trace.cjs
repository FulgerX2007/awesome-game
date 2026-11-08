'use strict';
// Долгая зима on Godot: the parity trace. A bot from tests/winter/bot.js plays web/winter/core.js; every call it
// makes that can change the game is recorded with the frame it came in, and a digest of the state is taken every
// world second. godot/winter/tests/parity.gd replays the same calls on the GDScript port (WinterSim) and writes its
// own digests; tests/winter-godot/parity.test.js compares the two.
//   node tools/winter-godot/trace.cjs <bot> <difficulty> <seed> <maxDays> <out.json>
const fs = require('node:fs');
const C = require('../../web/winter/core.js');
const bot = require('../../tests/winter/bot.js');

const FRAME = 0.25;   // the bot's frame, as in bot.play()
// The calls that change the game (bot.js uses nothing else that mutates). name in core.js → name in WinterSim.
const MUTATORS = {
  interact: 'interact', eat: 'eat', answerEvent: 'answer_event', contribute: 'contribute', craft: 'craft',
  trade: 'trade', placeSnare: 'place_snare', placeTorch: 'place_torch', moveDir: 'move_dir',
};

// What both sides compare every second: floats (with a tolerance) and exact values.
function digest(g, events) {
  const h = g.hero;
  const floats = [g.t, h.x, h.y, h.warmth, h.food, h.energy, h.health, g.fire.fuel, g.hut.stove];
  for (const s of g.survivors) floats.push(s.x, s.y, s.hp, s.food);
  for (const w of g.wolves) floats.push(w.x, w.y, w.hp);
  for (const a of g.animals) floats.push(a.x, a.y);
  if (g.bear) floats.push(g.bear.x, g.bear.y, g.bear.hp);
  const exact = [
    C.dayOf(g), g.status, g.rng, g.erng, g.nextId, g.hut.stage, g.hut.roofHole, g.iceDay, g.lastEvent,
    g.event ? `${g.event.id}:${g.event.phase}` : null, g.trader ? g.trader.offers.map((o) => (o.taken ? 1 : 0)).join('') : null,
    g.bear ? g.bear.id : null, h.load, h.sleeping, h.target ? h.target.type : null, h.path ? h.path.length : -1,
    C.ITEMS.map((k) => g.stock[k]).join(','), Object.keys(C.TOOLS).map((k) => (g.tools[k] ? 1 : 0)).join(''),
    g.palisade.map((p) => `${p.built ? 1 : 0}:${p.hp}`).join(','), g.bunks.map((b) => (b.built ? 1 : 0)).join(''),
    C.UPGRADE_IDS.map((u) => (g.upgrades[u].built ? 1 : 0)).join(''), `${g.gear.coat}${g.gear.lantern}${g.gear.sled}${g.gear.snares}`,
    g.survivors.map((s) => s.state).join(','), g.wolves.map((w) => w.id).join(','), g.animals.map((a) => a.id).join(','),
    g.torches.length, g.snares.length, g.nodes.reduce((a, n) => a + n.amount, 0), g.tiles.join('').replace(/[^D]/g, '').length,
    events.map((e) => e.type).join(','),
  ];
  return [floats, exact];
}

function trace(name, difficulty, seed, maxDays) {
  const cfg = bot.config(name);
  const r = bot.mulberry(seed * 31 + 7);
  const g = C.newGame(difficulty, seed);
  const calls = {};
  let frame = 0;
  const saved = {};
  for (const [js, gd] of Object.entries(MUTATORS)) {
    saved[js] = C[js];
    C[js] = (state, ...args) => {
      (calls[frame] ||= []).push([gd, ...args]);
      return saved[js](state, ...args);
    };
  }
  const digests = [];
  let events = [];
  try {
    let next = 0;
    while (g.status === 'playing' && C.dayOf(g) <= maxDays) {
      if (g.t >= next) { bot.think(g, cfg, r); next = g.t + cfg.think; }
      C.step(g, FRAME);
      events = events.concat(C.drain(g));
      frame++;
      if (frame % 4 === 0) { digests.push(digest(g, events)); events = []; }
    }
    if (frame % 4 !== 0) digests.push(digest(g, events));   // the last moment (the win, the loss) too
  } finally {
    Object.assign(C, saved);
  }
  return { bot: name, difficulty, seed, frames: frame, frame: FRAME, calls, digests };
}

if (require.main === module) {
  const [name, difficulty, seed, maxDays, out] = process.argv.slice(2);
  const tr = trace(name, difficulty, Number(seed), Number(maxDays));
  fs.writeFileSync(out, JSON.stringify(tr));
  console.log(`${tr.frames} frames, ${tr.digests.length} digests, ${Object.keys(tr.calls).length} frames with calls`);
}
module.exports = { trace, digest, MUTATORS, FRAME };
