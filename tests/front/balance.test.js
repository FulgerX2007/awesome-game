'use strict';
// Рубеж: balance on 3 seeds. A good player wins every level, mostly with three stars; a casual one wins most; an
// army without walls and towers falls in the second half.
const test = require('node:test');
const assert = require('node:assert/strict');
const { LEVELS } = require('../../web/front/levels.js');
const { play } = require('./bot.js');

const SEEDS = [1, 2, 3];
const runs = (bot) => SEEDS.map((seed) => LEVELS.map((l) => play(bot, l, seed)));
const tag = (rows) => rows.map((r) => r.map((x) => (x.status === 'won' ? `${x.stars}` : 'L')).join('')).join(' ');

test('a competent player wins all 12 levels on every seed, with ★★★ on at least 8, in 2–12 minutes', () => {
  const rows = runs('competent');
  for (const r of rows) {
    assert.ok(r.every((x) => x.status === 'won'), tag(rows));
    assert.ok(r.filter((x) => x.stars === 3).length >= 8, tag(rows));
    for (const x of r) assert.ok(x.t >= 100 && x.t <= 720, `${x.t}`);
  }
});

test('a casual player wins at least 9 of 12 levels on every seed', () => {
  const rows = runs('casual');
  for (const r of rows) assert.ok(r.filter((x) => x.status === 'won').length >= 9, tag(rows));
});

test('an army without walls and towers loses at least 4 of levels 5–12', () => {
  const rows = runs('armyOnly');
  for (const r of rows) assert.ok(r.slice(4).filter((x) => x.status !== 'won').length >= 4, tag(rows));
});
