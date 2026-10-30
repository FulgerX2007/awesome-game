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

test('every level has a board, its pins and a plan; the art has every pose', () => {
  const art = JSON.parse(fs.readFileSync(path.join(GODOT, 'data/art.json'), 'utf8'));
  const plans = JSON.parse(fs.readFileSync(path.join(GODOT, 'data/plans.json'), 'utf8'));
  L.LEVELS.forEach((lv, i) => {
    const n = i + 1;
    assert.ok(fs.existsSync(path.join(GODOT, `assets/boards/${n}.webp`)), `board ${n}`);
    for (const p of lv.pins) {
      assert.ok(art.pins[`${n}-${p.id}`], `pin ${n}-${p.id} in art.json`);
      assert.ok(fs.existsSync(path.join(GODOT, `assets/pins/${n}-${p.id}.png`)), `pin ${n}-${p.id}.png`);
    }
    const plan = plans[String(n)];
    assert.ok(Array.isArray(plan) && plan.length, `level ${n} has a plan (the hint)`);
    for (const id of plan) assert.ok(lv.pins.some((p) => p.id === id), `level ${n}: plan pin ${id}`);
  });
  const sprites = fs.readdirSync(path.join(GODOT, 'assets/sprites'));
  for (const who of ['hero', 'enemy']) {
    for (const pose of ['idle', 'cheer', 'scared']) for (const f of ['l', 'r']) assert.ok(sprites.includes(`${who}_${pose}_${f}.png`), `${who} ${pose} ${f}`);
    for (let i = 0; i < 8; i++) assert.ok(sprites.includes(`${who}_walk_r${i}.png`), `${who} walk ${i}`);
    assert.ok(sprites.includes(`${who}_burnt.png`) && sprites.includes(`${who}_poisoned.png`));
  }
  for (const s of ['keg', 'coin', 'coinTilt', 'door0', 'door4', 'torch']) assert.ok(sprites.includes(`${s}.png`), s);
  const sounds = fs.readdirSync(path.join(GODOT, 'assets/sounds'));
  for (const s of require('../../web/pins/audio.js').SOUND_NAMES) assert.ok(sounds.includes(`${s}.wav`), `sound ${s}`);
});

test('the web export is in place: our loading page and the game pack; the engine is shared', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(html, /Готовим штифты/, 'index.html comes from godot/pins/shell.html');
  assert.match(html, /\.\.\/godot\/engine\.js/);
  assert.deepEqual(fs.readdirSync(WEB).sort(), ['index.html', 'index.pck']);
  assert.ok(fs.statSync(path.join(WEB, 'index.pck')).size > 1e6);
});
