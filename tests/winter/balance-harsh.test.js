'use strict';
// Долгая зима: without a stove and a palisade the deep cold kills; the harsh winter is beaten most of the time.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/winter/core.js');
const { play } = require('./bot.js');

const SEEDS = [1, 2, 3, 4, 5];
const tag = (rs) => rs.map((r) => `${r.status}@${r.day}/${r.alive}`).join(' ');

test('no stove, no palisade, no torches: dead before day 24 on every seed', () => {
  const rs = SEEDS.map((seed) => play('noShelter', 'normal', seed));
  for (const r of rs) assert.ok(r.status === 'lost' && r.day < 24, tag(rs));
});

test('a greedy player survives the harsh winter on at least 3 of 5 seeds', () => {
  const rs = SEEDS.map((seed) => play('greedy', 'harsh', seed));
  assert.ok(rs.filter((r) => r.status === 'won').length >= 3, tag(rs));
  for (const r of rs) assert.ok((r.timeline['bites:bear'] || 0) * C.BEAR.bite * C.DIFF.harsh.bite < C.STAT_MAX, 'no death by the bear alone');
});
