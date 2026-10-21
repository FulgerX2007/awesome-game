'use strict';
// The lake chapter must not move anything that was already on the map: the nodes of the old zones
// (and the random state left after laying them out) match a snapshot taken before the lake was added.
// The snapshot (fixtures/nodes-v3.json) was made with:
//   for seed 1..50: s = newGame(seed); key = s.nodes.map((n) => `${n.id}:${n.kind}:${n.x},${n.y}:${n.hp}:${n.regrowAt}`).join(';')
//   out[seed] = { nodes: s.nodes.length, hash: fnv1a(key), rng: s.rng }
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');
const SNAP = require('./fixtures/nodes-v3.json');

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const OLD_ZONES = new Set(['west', 'north', 'east', 'hamlet']);

test('the old zones keep their node layout and the random state for 50 seeds', () => {
  for (const [seed, want] of Object.entries(SNAP)) {
    const s = V.newGame(Number(seed));
    const old = s.nodes.filter((n) => OLD_ZONES.has(V.zoneAt(n.x, n.y)) && n.kind !== 'shoal');
    assert.equal(old.length, want.nodes, `seed ${seed}: old node count`);
    old.forEach((n, i) => assert.equal(n.id, i, `seed ${seed}: old nodes come first`));
    const key = old.map((n) => `${n.id}:${n.kind}:${n.x},${n.y}:${n.hp}:${n.regrowAt}`).join(';');
    assert.equal(fnv1a(key), want.hash, `seed ${seed}: layout`);
    assert.equal(s.rng, want.rng, `seed ${seed}: random state`);
  }
});
