'use strict';
// Глубина on Godot (godot/deep): the data it ships must match the web version it was built from.
// When this fails, run tools/deep-godot/build.sh (or just `node tools/deep-godot/data.cjs`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../../tools/deep-godot/data.cjs');
const C = require('../../web/deep/core.js');

const GODOT = path.join(__dirname, '../../godot/deep');
const WEB = path.join(__dirname, '../../web/deep-godot');

test('species, zones, stages and the Romanian dictionary are copied from web/deep', () => {
  const { json, csv } = build();
  assert.equal(fs.readFileSync(path.join(GODOT, 'data/deep.json'), 'utf8'), json, 'data/deep.json is stale');
  assert.equal(fs.readFileSync(path.join(GODOT, 'data/deep.csv'), 'utf8'), csv, 'data/deep.csv is stale');
});

test('every species has a baked sprite and an atlas card', () => {
  const baked = JSON.parse(fs.readFileSync(path.join(GODOT, 'data/creatures.json'), 'utf8'));
  for (const sp of C.SPECIES) {
    assert.ok(baked[sp.id], `${sp.id}: run tools/deep-godot/bake.cjs`);
    assert.ok(fs.existsSync(path.join(GODOT, 'assets/creatures', `${sp.id}.png`)), `${sp.id}.png`);
    if (baked[sp.id].glow) assert.ok(fs.existsSync(path.join(GODOT, 'assets/creatures', `${sp.id}.glow.png`)), `${sp.id}.glow.png`);
    assert.ok(fs.existsSync(path.join(GODOT, 'assets/art', `${sp.id}.webp`)), `${sp.id}.webp`);
  }
  assert.deepEqual(Object.keys(baked).sort(), C.SPECIES.map((s) => s.id).sort());
});

test('the web export is in place: our loading page and the game pack; the engine is shared', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(html, /Погружаемся/, 'index.html comes from godot/deep/shell.html');
  assert.match(html, /\.\.\/godot\/engine\.js/, 'the page loads the shared engine');
  assert.ok(fs.statSync(path.join(WEB, 'index.pck')).size > 1e6);
  assert.deepEqual(fs.readdirSync(WEB).sort(), ['index.html', 'index.pck'], 'only the page and the pack: the engine lives in web/godot');
  const gz = fs.readFileSync(path.join(__dirname, '../../web/godot/engine.wasm.gz'));
  assert.deepEqual([...gz.subarray(0, 2)], [0x1f, 0x8b]);
});
