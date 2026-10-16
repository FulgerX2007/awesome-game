'use strict';
// Долгая зима, the ordinary winter on 5 seeds: a greedy player lives to spring with most survivors, a casual one
// mostly too, and the first days never kill.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/winter/core.js');
const { play } = require('./bot.js');

const SEEDS = [1, 2, 3, 4, 5];
const tag = (rs) => rs.map((r) => `${r.status}@${r.day}/${r.alive}`).join(' ');

test('a greedy player survives the winter on every seed with at least 4 survivors, in 30–65 real minutes', () => {
  const rs = SEEDS.map((seed) => play('greedy', 'normal', seed));
  for (const r of rs) {
    assert.equal(r.status, 'won', tag(rs));
    assert.ok(r.alive >= 4, tag(rs));
    assert.ok(r.realMinutes >= 30 && r.realMinutes <= 65, `${r.realMinutes.toFixed(1)} min`);
    // the expansion: the house upgrades give the second half of the winter its goals; the bear never kills
    const ups = Object.keys(r.timeline).filter((k) => k.startsWith('up:'));
    assert.ok(ups.length >= 3, `upgrades: ${ups.join(' ')}`);
    assert.ok(ups.every((k) => r.timeline[k] >= 8), 'not all at once at the start');
    assert.ok((r.timeline['bites:bear'] || 0) * C.BEAR.bite < C.STAT_MAX, 'the bear alone could not kill');
  }
  // the timeline of seed 1, for the plan: the hut, the palisade and every rescue happen in the first third
  const t = rs[0].timeline;
  assert.ok(t['hut:stove'] <= 4 && t['palisade:3'] <= 6, JSON.stringify(t));
  assert.ok(Object.keys(t).filter((k) => k.startsWith('joined:')).length >= 4, JSON.stringify(t));
});

test('a casual player survives the ordinary winter on at least 3 of 5 seeds', () => {
  const rs = SEEDS.map((seed) => play('casual', 'normal', seed));
  assert.ok(rs.filter((r) => r.status === 'won').length >= 3, tag(rs));
  // he meets the bear now and then, and runs; it never mauls him to death
  for (const r of rs) assert.ok((r.timeline['bites:bear'] || 0) <= 3, JSON.stringify(r.timeline));
});

test('the first three days never kill a greedy player', () => {
  for (const seed of SEEDS) assert.equal(play('greedy', 'normal', seed, { maxDays: 3 }).status, 'playing');
  assert.ok(C.DAYS === 30);
});
