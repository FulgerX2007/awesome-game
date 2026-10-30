'use strict';
// Глубина on Godot (godot/deep): the GDScript port of the simulation must play exactly like
// web/deep/core.js. Both run the same greedy bot from the same seed and are compared every second.
// Needs Godot: set GODOT to the binary (CI does); without it the test is skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trace } = require('./trace.cjs');

const GODOT = process.env.GODOT;
const PROJECT = path.join(__dirname, '../../godot/deep');

function godotTrace(...args) {
  const out = execFileSync(GODOT, ['--headless', '--path', PROJECT, '-s', 'res://tests/run.gd', '--', 'trace', ...args.map(String)],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 300000 });
  return JSON.parse(out.split('\n').find((l) => l.startsWith('[')));
}

for (const [seed, r0, depth, steps] of [[5, 3, 0.15, 1800], [7, 30, 1.2, 1800], [11, 330, 2.5, 900]]) {
  test(`the Godot port plays like core.js: seed ${seed}, r ${r0}, depth ${depth}`, { skip: !GODOT && 'set GODOT to run' }, () => {
    const js = trace(seed, r0, depth, steps), gd = godotTrace(seed, r0, depth, steps);
    assert.equal(gd.length, js.length);
    js.forEach((a, i) => {
      const b = gd[i], scale = Math.max(1, Math.abs(a[1]), Math.abs(a[2]));
      assert.ok(Math.abs(a[0] - b[0]) < 1e-6 * a[0], `second ${i + 1}: size ${b[0]} vs ${a[0]}`);
      assert.ok(Math.abs(a[1] - b[1]) < 1e-6 * scale && Math.abs(a[2] - b[2]) < 1e-6 * scale, `second ${i + 1}: position`);
      assert.deepEqual(b.slice(3), a.slice(3), `second ${i + 1}: creature count and ids`);
    });
  });
}
