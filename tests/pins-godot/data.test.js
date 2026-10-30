'use strict';
// Тяни штифт on Godot (godot/pins): what it ships must match the web version it was made from (web/pins).
// When this fails, run tools/pins-godot/build.sh (or `node tools/pins-godot/data.cjs` for the data alone).
// The levels themselves are checked with real physics by godot/pins/tests/levels.gd (CI runs it).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../../tools/pins-godot/data.cjs');
const L = require('../../web/pins/levels.js');

const GODOT = path.join(__dirname, '../../godot/pins');
const WEB = path.join(__dirname, '../../web/pins-godot');

test('levels, solver orders, tips and the Romanian dictionary are copied from web/pins', () => {
  const { json, csv } = build();
  assert.equal(fs.readFileSync(path.join(GODOT, 'data/levels.json'), 'utf8'), json, 'data/levels.json is stale');
  assert.equal(fs.readFileSync(path.join(GODOT, 'data/pins.csv'), 'utf8'), csv, 'data/pins.csv is stale');
});

test('every level has a plan; the style parts and the baked goblins are all there', () => {
  const plans = JSON.parse(fs.readFileSync(path.join(GODOT, 'data/plans.json'), 'utf8'));
  L.LEVELS.forEach((lv, i) => {
    const plan = plans[String(i + 1)];
    assert.ok(Array.isArray(plan) && plan.length, `level ${i + 1} has a plan (the hint)`);
    for (const id of plan) assert.ok(lv.pins.some((p) => p.id === id), `level ${i + 1}: plan pin ${id}`);
  });
  // the parts cut from the style reference by tools/pins-godot/slice.py
  const style = JSON.parse(fs.readFileSync(path.join(GODOT, 'data/style.json'), 'utf8'));
  for (const name of ['hero', 'torch', 'door', 'sign', 'ring', 'collar', 'cap', 'rod', 'coin0', 'coin1', 'coin2',
    'gem_blue', 'gem_green', 'gem_red', 'vine0', 'stone', 'faces', 'back', 'wood', 'band', 'lava']) {
    assert.ok(style[name], `style.json: ${name}`);
    assert.ok(fs.existsSync(path.join(GODOT, `assets/style/${name}.png`)), `assets/style/${name}.png`);
  }
  assert.ok(style.hero.feet && style.torch.flame, 'anchor points of the hero and the torch');
  // what is still baked from web/pins
  const sprites = fs.readdirSync(path.join(GODOT, 'assets/sprites'));
  for (const pose of ['idle', 'cheer', 'scared']) for (const f of ['l', 'r']) assert.ok(sprites.includes(`enemy_${pose}_${f}.png`), `enemy ${pose} ${f}`);
  for (const s of ['enemy_burnt', 'enemy_poisoned', 'keg', 'stone0']) assert.ok(sprites.includes(`${s}.png`), s);
  assert.ok(!fs.existsSync(path.join(GODOT, 'assets/boards')), 'the levels are drawn from their cells, not from pictures');
  const sounds = fs.readdirSync(path.join(GODOT, 'assets/sounds'));
  for (const s of require('../../web/pins/audio.js').SOUND_NAMES) assert.ok(sounds.includes(`${s}.wav`), `sound ${s}`);
});

test('the web export is in place: our loading page and the game pack; the engine is shared', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(html, /Готовим штифты/, 'index.html comes from godot/pins/shell.html');
  assert.match(html, /\.\.\/godot\/engine\.js/);
  assert.deepEqual(fs.readdirSync(WEB).sort(), ['index.html', 'index.pck']);
  assert.ok(fs.statSync(path.join(WEB, 'index.pck')).size > 3e5, 'the pack holds the art, the sounds and the fonts');
});
