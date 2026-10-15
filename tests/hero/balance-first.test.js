'use strict';
// Путь героя: the first run, with no permanent upgrades. A good player gets past the first boss, but the final
// boss is rarely beaten on the first try (as the ads promise: you grow from a noob over several runs).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/hero/core.js');
const { playRun } = require('./bot.js');

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const runs = SEEDS.map((seed) => playRun('competent', C.newSave(), seed));
const tag = runs.map((r) => `${r.phase}@act${r.act}/depth${r.depth}`).join(' ');

test('a competent first run beats the first boss on at least 8 of 10 seeds', () => {
  assert.ok(runs.filter((r) => r.act >= 2 || r.phase === 'won').length >= 8, tag);
});

test('a competent first run beats the final boss on at most 2 of 10 seeds', () => {
  assert.ok(runs.filter((r) => r.phase === 'won').length <= 2, tag);
});

test('the hero grows: level by the end of each act is logged and keeps rising', () => {
  for (const r of runs) {
    const levels = Object.values(r.actLevel);
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] >= levels[i - 1], JSON.stringify(r.actLevel));
  }
});
