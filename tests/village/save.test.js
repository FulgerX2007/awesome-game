'use strict';
// Save versions: the current one round-trips, older ones start a new village and say so.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');

test('a save of an earlier version gives a new village marked old', () => {
  for (let v = 1; v < V.VERSION; v++) {
    const s = V.load({ v, seed: 7, t: 999, res: { wood: 50 } });
    assert.equal(s.recovered, 'old', `v${v}`);
    assert.equal(s.v, V.VERSION);
    assert.equal(s.res.wood, 0, 'nothing is carried over');
    assert.equal(s.t, 0);
  }
  // Also from a JSON string, the way localStorage holds it.
  assert.equal(V.load(JSON.stringify({ v: 1, seed: 7 })).recovered, 'old');
});

test('junk, future versions and saves without a seed are broken, not old', () => {
  for (const bad of [{ v: V.VERSION + 1, seed: 1 }, { v: 0, seed: 1 }, { v: 1.5, seed: 1 }, { v: '1', seed: 1 }, { v: 1 }, 'nope{']) {
    assert.equal(V.load(bad).recovered, true, JSON.stringify(bad));
  }
});

test('the current version keeps the clock across a save and a load', () => {
  const s = V.newGame(9);
  V.step(s, V.DAY * 4 + 30);
  const back = V.load(JSON.parse(JSON.stringify(V.save(s))));
  assert.equal(back.recovered, undefined);
  assert.equal(back.t, s.t);
  assert.deepEqual(V.clock(back.t), V.clock(s.t));
});
