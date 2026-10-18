'use strict';
// Save versions: the current one round-trips, older ones start a new village and say so.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');

test('a save of version 1 gives a new village marked old', () => {
  for (const v of [1]) {
    const s = V.load({ v, seed: 7, t: 999, res: { wood: 50 } });
    assert.equal(s.recovered, 'old', `v${v}`);
    assert.equal(s.v, V.VERSION);
    assert.equal(s.res.wood, 0, 'nothing is carried over');
    assert.equal(s.t, 0);
  }
  // Also from a JSON string, the way localStorage holds it.
  assert.equal(V.load(JSON.stringify({ v: 1, seed: 7 })).recovered, 'old');
});

test('a version 2 save loads into version 3: everything but the node layout carries over', () => {
  const s = V.newGame(9);
  s.res.wood = 77;
  s.built.well.done = true;
  for (const r of Object.keys(s.built.well.paid)) s.built.well.paid[r] = V.BUILDINGS.well.cost[r];
  s.t = V.DAY * 2.5;
  const v2 = { ...JSON.parse(JSON.stringify(V.save(s))), v: 2, nodes: [{ id: 0, kind: 'tree', x: 0, y: 0, hp: 0, regrowAt: 5 }] };
  const back = V.load(v2);
  assert.equal(back.recovered, undefined);
  assert.equal(back.v, V.VERSION);
  assert.equal(back.res.wood, 77);
  assert.equal(back.built.well.done, true);
  assert.equal(back.t, s.t);
  assert.deepEqual(back.nodes.map((n) => [n.kind, n.x, n.y]), V.newGame(9).nodes.map((n) => [n.kind, n.x, n.y]), 'nodes from the seed');
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
