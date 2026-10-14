'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../web/sort/core.js');
const { LEVELS } = require('../../web/sort/levels.js');
const { BANDS, EMPTY_TUBES } = require('./generate.js');

const bandOf = (i) => BANDS.find((b) => i + 1 >= b.from && i + 1 <= b.to);

test('there are 60 levels and every one parses', () => {
  assert.equal(LEVELS.length, 60);
  assert.equal(BANDS[BANDS.length - 1].to, 60);
  for (const [i, def] of LEVELS.entries()) {
    const L = S.parseLevel(def);
    assert.ok(Number.isInteger(L.par), `level ${i + 1} has a par`);
    assert.ok(Array.isArray(L.solution), `level ${i + 1} has a solution`);
  }
});

test('no tube is sorted at the start and every level starts playable', () => {
  for (const [i, def] of LEVELS.entries()) {
    assert.ok(!def.tubes.some((t) => S.complete(t, def.cap)), `level ${i + 1}`);
    assert.equal(S.newGame(def).status, 'playing', `level ${i + 1}`);
  }
});

test('colours, capacity and empty tubes follow the bands', () => {
  for (const [i, def] of LEVELS.entries()) {
    const band = bandOf(i);
    const L = S.parseLevel(def);
    assert.equal(L.cap, band.cap, `level ${i + 1} capacity`);
    assert.ok(band.colors.includes(L.colors), `level ${i + 1}: ${L.colors} colours`);
    assert.equal(L.tubes.filter((t) => !t.length).length, EMPTY_TUBES, `level ${i + 1} empty tubes`);
    assert.equal(L.tubes.length, L.colors + EMPTY_TUBES);
  }
  const colours = LEVELS.map((l) => S.parseLevel(l).colors);
  assert.equal(Math.min(...colours.slice(0, 5)), 3);
  assert.equal(Math.max(...colours), 12);
});

test('par is at least the band minimum and does not drop within a band', () => {
  for (const band of BANDS) {
    const pars = LEVELS.slice(band.from - 1, band.to).map((l) => l.par);
    assert.ok(pars.every((p) => p >= band.minPar), `levels ${band.from}–${band.to}: ${pars}`);
    for (let k = 1; k < pars.length; k++) assert.ok(pars[k] >= pars[k - 1], `levels ${band.from}–${band.to}: ${pars}`);
  }
  // Later bands start harder than earlier ones end, give or take.
  assert.ok(LEVELS[59].par > LEVELS[0].par * 5);
});

test('the stored solution is par long and replays to a win', () => {
  for (const [i, def] of LEVELS.entries()) {
    assert.equal(def.solution.length, def.par, `level ${i + 1}`);
    const g = S.newGame(def);
    for (const [a, b] of def.solution) assert.ok(S.pour(g, a, b) > 0, `level ${i + 1}: ${a}→${b}`);
    assert.equal(g.status, 'won', `level ${i + 1}`);
    assert.equal(S.stars(g), 3, `level ${i + 1}`);
  }
});

test('levels are all different', () => {
  const sig = (tubes) => tubes.map((t) => t.join('')).sort().join('|');
  assert.equal(new Set(LEVELS.map((l) => sig(l.tubes))).size, LEVELS.length);
});

test('the generator output is exactly what is committed', () => {
  // Reproducible: the same seed gives the same levels.js (cheap: the whole run takes well under a second).
  const fs = require('node:fs');
  const path = require('node:path');
  const { generate, format } = require('./generate.js');
  const stderr = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const text = format(generate());
    assert.equal(text, fs.readFileSync(path.join(__dirname, '../../web/sort/levels.js'), 'utf8'));
  } finally {
    process.stderr.write = stderr;
  }
});
