'use strict';
// Путь героя: runs with «Слава» carried over, the "one damage type" check and the first trial.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../../web/hero/content.js');
const { playRun, campaign, fullMeta } = require('./bot.js');

const SEEDS = [1, 2, 3, 4, 5];

test('a competent player wins within 8 runs on every seed, and usually not on the first', () => {
  const firsts = SEEDS.map((seed) => campaign('competent', seed, 8));
  const tag = firsts.map((c) => (c.won ? c.runs : '-')).join(',');
  for (const c of firsts) assert.ok(c.won, tag);
  assert.ok(firsts.filter((c) => c.runs > 1).length >= 3, tag);
  for (const c of firsts) {
    const win = c.list[c.list.length - 1];
    assert.ok(win.level >= 12, `a winning run ends at level ${win.level}`);
    assert.ok(win.minutes >= 10 && win.minutes <= 25, `a winning run takes ${win.minutes.toFixed(1)} min`);
  }
  assert.ok(firsts.some((c) => c.list[c.list.length - 1].level >= 15), '«Легенда» is reached in some winning run');
});

test('a casual player wins within 15 runs on at least 3 of 5 seeds', () => {
  const list = SEEDS.map((seed) => campaign('casual', seed, 15));
  assert.ok(list.filter((c) => c.won).length >= 3, list.map((c) => (c.won ? c.runs : '-')).join(','));
});

for (const type of K.TYPES) {
  test(`one damage type (${type}) with every permanent upgrade loses to the final boss on at least 4 of 5 seeds`, () => {
    const res = SEEDS.map((seed) => playRun(`single:${type}`, fullMeta(), seed));
    assert.ok(res.filter((r) => r.phase !== 'won').length >= 4, res.map((r) => `${r.phase}@${r.depth}`).join(' '));
  });
}

test('the first trial is winnable with every permanent upgrade on at least 3 of 5 seeds', () => {
  const res = SEEDS.map((seed) => playRun('competent', fullMeta(), seed, 1));
  assert.ok(res.filter((r) => r.phase === 'won').length >= 3, res.map((r) => `${r.phase}@${r.depth}`).join(' '));
});
