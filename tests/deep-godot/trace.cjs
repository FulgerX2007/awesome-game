'use strict';
// The bot run from tests/deep-godot/parity.test.js, on web/deep/core.js. Same bot as godot/deep/tests/run.gd.
const C = require('../../web/deep/core.js');

function botInput(w) {
  const p = w.player;
  let threat = null, td = Infinity, food = null, fs = Infinity;
  for (const e of w.ents) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (C.isHunter(e) && e.r > p.r * C.EAT_RATIO && d < td) { threat = e; td = d; }
    if (p.r > e.r * C.EAT_RATIO && d / (e.r + 1) < fs) { food = e; fs = d / (e.r + 1); }
  }
  if (threat && td < threat.r * 5) return { tx: 2 * p.x - threat.x, ty: 2 * p.y - threat.y, dash: td < threat.r * 2.5 };
  if (food) return { tx: food.x, ty: food.y + (2.5 - p.depth) * p.r * 3 };
  return {};
}

function trace(seed, r0, depth, steps) {
  const w = C.createWorld(seed, r0, depth), out = [];
  for (let i = 0; i < steps; i++) {
    C.step(w, 1 / 30, botInput(w));
    w.events.length = 0;
    if (i % 30 === 29) out.push([w.player.r, w.player.x, w.player.y, w.ents.length, w.nextId]);
  }
  return out;
}
module.exports = { trace };
if (require.main === module) console.log(JSON.stringify(trace(...process.argv.slice(2, 6).map(Number))));
