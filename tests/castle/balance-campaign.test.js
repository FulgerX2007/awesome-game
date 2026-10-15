'use strict';
// Campaign balance on 5 seeds: a competent player clears it every time, a casual one (noisy aim, reaction lag,
// random upgrades) clears it on most seeds and otherwise gets far, and skipping every upgrade fails in the middle.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/castle/core.js');
const { play } = require('./bot.js');

const SEEDS = [1, 2, 3, 4, 5];

test('a competent player clears the 30-wave campaign on every seed', () => {
  for (const seed of SEEDS) {
    const r = play('competent', 'campaign', seed);
    assert.equal(r.status, 'won', `seed ${seed}: ${r.status} at wave ${r.wave}`);
    assert.equal(r.wave, C.CAMPAIGN_WAVES);
  }
});

test('a casual player clears it on at least 3 of 5 seeds, and otherwise reaches wave 20', () => {
  const runs = SEEDS.map((seed) => play('casual', 'campaign', seed));
  const won = runs.filter((r) => r.status === 'won').length;
  assert.ok(won >= 3, runs.map((r) => `${r.status}@${r.wave}`).join(' '));
  for (const r of runs) if (r.status !== 'won') assert.ok(r.wave >= 20, `lost at wave ${r.wave}`);
});

test('skipping every upgrade and the shop falls between waves 12 and 18', () => {
  for (const seed of SEEDS) {
    const r = play('noUpgrades', 'campaign', seed);
    assert.equal(r.status, 'lost', `seed ${seed}`);
    assert.ok(r.wave >= 12 && r.wave <= 18, `seed ${seed}: lost at wave ${r.wave}`);
  }
});
