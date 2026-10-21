'use strict';
// The painted sprites (web/village/sprites, baked by tools/village-sprites/generate.py) and their manifest:
// every entry has its file at the declared size, and every palette the code asks for has a sprite.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const VV = require('../../web/village/view.js');

const DIR = path.join(__dirname, '..', '..', 'web', 'village', 'sprites');
const M = JSON.parse(fs.readFileSync(path.join(DIR, 'sprites.json'), 'utf8'));
const ART = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'village', 'art.js'), 'utf8');

// Width and height from a PNG's IHDR chunk.
function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${file} is a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test('every manifest entry has its PNG at world size × scale, with the anchor inside', () => {
  assert.ok(M.scale >= 2, 'sharp enough for the zoomed camera');
  const names = Object.keys(M.sprites);
  assert.ok(names.length > 0);
  for (const [name, e] of Object.entries(M.sprites)) {
    const file = path.join(DIR, e.file);
    assert.ok(fs.existsSync(file), `${name}: ${e.file} exists`);
    const { w, h } = pngSize(file);
    assert.ok(Math.abs(w - e.w * M.scale) <= 1 && Math.abs(h - e.h * M.scale) <= 1, `${name}: ${w}×${h} for ${e.w}×${e.h}`);
    if (e.kind !== 'texture' && e.kind !== 'material') assert.ok(e.ax >= 0 && e.ax <= e.w && e.ay >= 0, `${name}: anchor`);
  }
  // No stray files.
  const files = new Set(Object.values(M.sprites).map((e) => e.file));
  for (const f of fs.readdirSync(DIR)) if (f.endsWith('.png')) assert.ok(files.has(f), `${f} is in the manifest`);
});

test('every leafy palette of every season has a crown in each of the three shapes', () => {
  for (const season of ['spring', 'summer', 'autumn']) {
    for (const pal of VV.palette(season).leaves) {
      for (let shape = 0; shape < 3; shape++) {
        assert.ok(Object.values(M.sprites).some((e) => e.kind === 'crown' && e.mid === pal[1] && e.shape === shape), `${season} ${pal[1]} shape ${shape}`);
      }
    }
  }
});

test('bushes, pines, rocks, trunks and the meadow texture are all there', () => {
  const has = (f) => Object.values(M.sprites).some(f);
  // The bush colours art.js asks for (full, picked, autumn) are the ones the sprites were painted for.
  for (const mid of ['#4b9a36', '#6aa54e', '#a8703a']) {
    assert.ok(ART.includes(`'${mid}'`), `art.js uses ${mid}`);
    for (let shape = 0; shape < 3; shape++) assert.ok(has((e) => e.kind === 'bush' && e.mid === mid && e.shape === shape), `bush ${mid} ${shape}`);
  }
  for (let shape = 0; shape < 3; shape++) for (const snow of [0, 1]) assert.ok(has((e) => e.kind === 'pine' && e.shape === shape && e.snow === snow));
  for (let shape = 0; shape < 4; shape++) assert.ok(has((e) => e.kind === 'rock' && e.shape === shape));
  for (const pine of [0, 1]) assert.ok(has((e) => e.kind === 'trunk' && e.pine === pine));
  assert.ok(M.sprites.grass && M.sprites.grass.kind === 'texture');
});

test('a painted ruin (plain and snowy) for every footprint size that has stone ruins, and every material', () => {
  const V = require('../../web/village/core.js');
  const has = (f) => Object.values(M.sprites).some(f);
  // The well and the pavilion have ruins of their own; flat works (bridge, road, clearing, pier) have none.
  const own = new Set(['well', 'pavilion', ...VV.FLAT]);
  for (const [id, fp] of Object.entries(V.FOOTPRINTS)) {
    if (own.has(id) || !fp.length) continue;
    const xs = fp.map((p) => p.x), ys = fp.map((p) => p.y);
    const size = `${Math.max(...xs) - Math.min(...xs) + 1}x${Math.max(...ys) - Math.min(...ys) + 1}`;
    for (const snow of [0, 1]) assert.ok(has((e) => e.kind === 'ruin' && e.size === size && e.shape === 0 && e.snow === snow), `${id}: ruin ${size} snow ${snow}`);
  }
  for (const mat of ['tile', 'thatch', 'metal', 'plaster', 'planks', 'brick', 'stone']) {
    assert.ok(has((e) => e.kind === 'material' && e.mat === mat), `material ${mat}`);
  }
});
