'use strict';
// Долгая зима on Godot: runs a parity case (tools/winter-godot/trace.cjs on core.js, godot/winter/tests/parity.gd on
// the port) and returns the first difference, or null when the two played the same.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trace } = require('../../tools/winter-godot/trace.cjs');

const PROJECT = path.join(__dirname, '../../godot/winter');
const FLOAT_NAMES = ['t', 'hero.x', 'hero.y', 'warmth', 'food', 'energy', 'health', 'fire', 'stove'];
const EXACT_NAMES = ['day', 'status', 'rng', 'erng', 'nextId', 'hut.stage', 'roofHole', 'iceDay', 'lastEvent', 'event', 'trader',
  'bear', 'load', 'sleeping', 'target', 'path', 'stock', 'tools', 'palisade', 'bunks', 'upgrades', 'gear', 'survivors', 'wolves',
  'animals', 'torches', 'snares', 'nodes', 'drifts', 'events'];

function run(godot, bot, difficulty, seed, maxDays) {
  const js = trace(bot, difficulty, seed, maxDays);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'winter-parity-'));
  const inp = path.join(dir, 'trace.json'), out = path.join(dir, 'godot.json');
  fs.writeFileSync(inp, JSON.stringify(js));
  try {
    execFileSync(godot, ['--headless', '--path', PROJECT, '-s', 'res://tests/parity.gd', '--', inp, out],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
    const gd = JSON.parse(fs.readFileSync(out, 'utf8'));
    return { js, gd, diff: compare(js.digests, gd) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function compare(a, b) {
  if (a.length !== b.length) return `digests: ${b.length} vs ${a.length}`;
  for (let i = 0; i < a.length; i++) {
    const [fa, ea] = a[i], [fb, eb] = b[i];
    if (fa.length !== fb.length) return `second ${i + 1}: ${fb.length} floats vs ${fa.length}`;
    for (let k = 0; k < fa.length; k++) {
      const tol = 1e-6 * Math.max(1, Math.abs(fa[k]));
      if (!(Math.abs(fa[k] - fb[k]) <= tol)) return `second ${i + 1}: ${FLOAT_NAMES[k] || `float ${k}`} ${fb[k]} vs ${fa[k]}`;
    }
    for (let k = 0; k < ea.length; k++) {
      const x = ea[k], y = eb[k];
      const same = typeof x === 'number' && typeof y === 'number' ? x === y : String(x) === String(y);
      if (!same) return `second ${i + 1}: ${EXACT_NAMES[k]} ${JSON.stringify(y)} vs ${JSON.stringify(x)}`;
    }
  }
  return null;
}

if (require.main === module) {
  const [bot, difficulty, seed, maxDays] = process.argv.slice(2);
  const t0 = Date.now();
  const r = run(process.env.GODOT, bot, difficulty, Number(seed), Number(maxDays));
  const last = r.js.digests[r.js.digests.length - 1][1];
  console.log(`${bot} ${difficulty} seed ${seed}: ${r.js.digests.length} s, day ${last[0]} ${last[1]}, ${Date.now() - t0} ms →`, r.diff || 'same');
}
module.exports = { run, compare };
