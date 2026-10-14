'use strict';
// Endless balance: the waves outgrow any build, so even a competent player always falls, and before wave 60.
// Its own file so `node --test` runs it in parallel with the campaign balance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { play, ballistic } = require('./bot.js');

test('endless always ends by wave 60 for a competent player', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = play('competent', 'endless', seed, 200);
    assert.equal(r.status, 'lost', `seed ${seed}`);
    assert.ok(r.wave > 30 && r.wave <= 60, `seed ${seed}: lost at wave ${r.wave}`);
    assert.ok(r.score > 0);
  }
});

test('the bots aim with the ballistic formula (sanity of the test player itself)', () => {
  // A shot on flat ground at speed v and angle a lands at v²·sin 2a / g; the formula gives a back (low arc) and
  // 90° − a (high arc).
  const v = 20, g = 9.8, a = Math.PI / 6;
  const dx = (v * v * Math.sin(2 * a)) / g;
  assert.ok(Math.abs(ballistic(dx, 0, v, false) - a) < 1e-6);
  assert.ok(Math.abs(ballistic(dx, 0, v, true) - (Math.PI / 2 - a)) < 1e-6);
  assert.equal(ballistic(1000, 0, v, false), null, 'out of reach');
  assert.ok(ballistic(10, 0, v, true) > ballistic(10, 0, v, false), 'the high arc is steeper');
});
