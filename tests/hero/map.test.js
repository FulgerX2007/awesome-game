'use strict';
// Путь героя: the seeded act maps.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/hero/core.js');

// Every path from row 0 to the camp (node id lists).
function paths(map) {
  const out = [];
  const walk = (id, acc) => {
    const n = map.nodes[id];
    if (n.kind === 'camp') { out.push([...acc, id]); return; }
    for (const k of n.next) walk(k, [...acc, id]);
  };
  for (const id of map.rows[0]) walk(id, []);
  return out;
}

// Do edges (a→b) and (c→d) between the same rows cross?
const crosses = (map, a, b, c, d) => {
  const n = map.nodes;
  return (n[a].col - n[c].col) * (n[b].col - n[d].col) < 0;
};

test('the map rules hold on 200 seeds for every act', () => {
  for (let seed = 1; seed <= 200; seed++) {
    for (let act = 1; act <= C.ACTS; act++) {
      const map = C.genMap(seed, act);
      const tag = `seed ${seed} act ${act}`;
      assert.equal(map.act, act);
      assert.equal(map.rows.length, C.ROWS + 1, tag);
      assert.ok(map.rows[0].length >= 2 && map.rows[0].length <= 3, tag);
      for (let r = 1; r <= 6; r++) assert.ok(map.rows[r].length >= 2 && map.rows[r].length <= 4, tag);
      assert.equal(map.rows[7].length, 1);
      assert.equal(map.nodes[map.rows[7][0]].kind, 'camp');
      assert.equal(map.nodes[map.rows[8][0]].kind, 'boss');
      for (const id of map.rows[0]) assert.equal(map.nodes[id].kind, 'battle', tag);
      const incoming = new Array(map.nodes.length).fill(0);
      for (const n of map.nodes) {
        if (n.kind !== 'boss') assert.ok(n.next.length >= 1 && n.next.length <= 2, `${tag}: node ${n.id} has ${n.next.length} ways on`);
        for (const k of n.next) {
          assert.equal(map.nodes[k].row, n.row + 1, tag);
          incoming[k]++;
        }
        if (n.kind === 'elite') assert.ok(n.row >= 2, `${tag}: an elite in row ${n.row}`);
        if (n.kind === 'shop') for (const k of n.next) assert.notEqual(map.nodes[k].kind, 'shop', `${tag}: two shops in a row`);
      }
      for (const n of map.nodes) if (n.row > 0) assert.ok(incoming[n.id] >= 1, `${tag}: node ${n.id} is unreachable`);
      // no crossing edges between any two rows
      const edges = map.nodes.flatMap((n) => n.next.map((k) => [n.id, k]));
      for (const [a, b] of edges) for (const [c, d] of edges) {
        if (map.nodes[a].row === map.nodes[c].row) assert.ok(!crosses(map, a, b, c, d), `${tag}: ${a}→${b} crosses ${c}→${d}`);
      }
      for (const p of paths(map)) {
        const kinds = p.map((id) => map.nodes[id].kind);
        assert.ok(kinds.includes('forge'), `${tag}: a path without a forge`);
        assert.ok(kinds.includes('chest'), `${tag}: a path without a chest`);
      }
      assert.ok(C.validMap(map));
    }
  }
});

test('the same seed gives the same map; another seed or act gives another', () => {
  assert.deepEqual(C.genMap(42, 1), C.genMap(42, 1));
  assert.notDeepEqual(C.genMap(42, 1), C.genMap(43, 1));
  assert.notDeepEqual(C.genMap(42, 1).nodes, C.genMap(42, 2).nodes);
});

test('everyPathHas sees a path that avoids a kind', () => {
  const map = C.genMap(3, 1);
  assert.ok(C.everyPathHas(map, 'forge'));
  assert.equal(C.everyPathHas(map, 'elite'), false);
  const broken = JSON.parse(JSON.stringify(map));
  for (const n of broken.nodes) if (n.kind === 'forge') n.kind = 'battle';
  assert.equal(C.validMap(broken), false);
});

test('only the next row can be entered, and only from the map', () => {
  const run = C.newRun(C.newSave(), 9);
  const first = run.map.rows[0];
  assert.equal(C.choose(run, run.map.rows[1][0]), false, 'row 1 is not reachable yet');
  assert.ok(C.choose(run, first[0]));
  assert.equal(run.at, first[0]);
  assert.equal(run.depth, 1);
  assert.equal(run.phase, 'battle');
  assert.deepEqual(C.reachable(run), [], 'nothing is reachable during a battle');
  assert.equal(C.choose(run, run.map.nodes[first[0]].next[0]), false);
  assert.equal(C.mapOf(run), run.map);
});
