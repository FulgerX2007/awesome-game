'use strict';
// Долгая зима on Godot (godot/winter): the GDScript port of the rules must play exactly like web/winter/core.js.
// A bot of tests/winter/bot.js plays a whole winter on core.js; its calls are replayed on WinterSim and the two
// are compared every second (positions and stats to 1e-6, everything else exactly: stock, rng streams, ids,
// events). So the balance the web bots prove (tests/winter/balance-*.test.js) holds for the Godot game too.
// Needs Godot: set GODOT to the binary (CI does); without it the test is skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('./compare.cjs');

const GODOT = process.env.GODOT;

// [bot, difficulty, seed, how the winter ends, the events it must have gone through besides the basic ones]
const FULL = ['joined', 'upgraded', 'trader', 'traded', 'bear', 'event', 'eventDone', 'hitWolf', 'won'];
const CASES = [
  ['greedy', 'normal', 1, 'won', FULL],
  ['greedy', 'harsh', 1, 'won', FULL],
  ['casual', 'normal', 3, 'won', FULL.filter((t) => t !== 'traded')],   // the casual bot never trades
  ['noShelter', 'normal', 5, 'lost', ['lost']],
];

for (const [bot, difficulty, seed, end, also] of CASES) {
  test(`the Godot port plays like core.js: ${bot} bot, ${difficulty} winter, seed ${seed}`, { skip: !GODOT && 'set GODOT to run', timeout: 300000 }, () => {
    const { js, diff } = run(GODOT, bot, difficulty, seed, 31);
    assert.equal(diff, null, diff);
    const last = js.digests[js.digests.length - 1][1];
    assert.equal(last[1], end, 'the winter ends as the web bot\'s does');
    // the comparison went through the content that matters (the last exact field lists the second's events)
    const types = new Set(js.digests.flatMap((d) => d[1][d[1].length - 1].split(',')));
    for (const t of ['howl', 'bite', 'gather', 'built', 'craft', 'dawn', 'night']) assert.ok(types.has(t), `a ${t} event was compared`);
    for (const t of also) assert.ok(types.has(t), `a ${t} event was compared`);
  });
}
