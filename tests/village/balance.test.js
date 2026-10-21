'use strict';
// Balance checks: a greedy bot (tests/village/bot.js) plays whole games through the public core.js API.
// Every run goes on past the festival, over the hill, to the harvest festival.
// Default run: 3 seeds. BALANCE=1 runs 20 seeds.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');
const { play } = require('./bot.js');

const SEEDS = process.env.BALANCE === '1' ? Array.from({ length: 20 }, (_, i) => i + 1) : [1, 2, 3];
const MIN = 60;
// The longest stretch with nothing new. The hamlet's end-game saves up planks and bricks, so the whole game
// allows a minute more than the village alone used to.
const GAP = 16 * MIN;

const started = Date.now();
const runs = new Map();
function run(seed) {
  if (!runs.has(seed)) runs.set(seed, play(seed, { until: 'harvest' }));
  return runs.get(seed);
}

const fmt = (t) => `${(t / MIN).toFixed(1)} min`;

// Longest stretch of game time without anything new (a building, a tool or barn level, a filled order).
function maxGap(log) {
  let prev = 0, gap = 0;
  for (const e of log) { gap = Math.max(gap, e.t - prev); prev = e.t; }
  return gap;
}

test('seed 1: the festival in 140–170 min, the harvest 75–110 min later, the well in 1–3 min, no long gap', () => {
  const r = run(1);
  assert.ok(r.festival, `festival reached (stopped at ${fmt(r.t)})`);
  assert.ok(r.festivalAt >= 140 * MIN && r.festivalAt <= 170 * MIN, `festival at ${fmt(r.festivalAt)}`);
  assert.ok(r.harvest, `harvest festival reached (stopped at ${fmt(r.t)})`);
  const after = r.t - r.festivalAt;
  assert.ok(after >= 75 * MIN && after <= 110 * MIN, `harvest ${fmt(after)} after the festival`);
  const well = r.log.find((e) => e.what === 'well');
  assert.ok(well && well.t >= 1 * MIN && well.t <= 3 * MIN, `well at ${well && fmt(well.t)}`);
  const gap = maxGap(r.log);
  assert.ok(gap <= GAP, `longest gap ${fmt(gap)}`);
});

test(`the bot reaches both festivals with no deadlock on ${SEEDS.length} seeds`, () => {
  for (const seed of SEEDS) {
    const r = run(seed);
    assert.ok(r.festival, `seed ${seed}: festival reached (stopped at ${fmt(r.t)})`);
    assert.ok(r.festivalAt <= 4 * 3600, `seed ${seed}: festival at ${fmt(r.festivalAt)}`);
    assert.ok(r.harvest, `seed ${seed}: harvest festival reached (stopped at ${fmt(r.t)})`);
    // TODO(lake plan, task 6): the bot learns the lake chapter; until then it stops at the harvest festival.
    for (const id of Object.keys(V.BUILDINGS)) if (V.BUILDINGS[id].after !== 'harvest') assert.ok(r.s.built[id].done, `seed ${seed}: ${id} built`);
    assert.ok(r.t <= 6 * 3600, `seed ${seed}: harvest festival at ${fmt(r.t)}`);
    assert.ok(maxGap(r.log) <= GAP, `seed ${seed}: longest gap ${fmt(maxGap(r.log))}`);
  }
});

test('after the bridge every resource node can be reached (BFS from the start)', () => {
  for (const seed of SEEDS) {
    const s = run(seed).s;
    assert.ok(s.built.bridge.done);
    const seen = new Set([`${V.START.x},${V.START.y}`]);
    const q = [[V.START.x, V.START.y]];
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${y + dy}`;
        if (seen.has(k) || !V.isWalkable(s, x + dx, y + dy)) continue;
        seen.add(k);
        q.push([x + dx, y + dy]);
      }
    }
    for (const n of s.nodes) {
      if (V.zoneAt(n.x, n.y) === 'hamlet' && !s.built.road.done) continue; // over the hill: after the road
      if ((n.kind === 'shoal' || V.zoneAt(n.x, n.y) === 'lake') && !s.built.pier.done) continue; // past the forest: after the glade and the pier
      const ok = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(`${n.x + dx},${n.y + dy}`));
      assert.ok(ok, `seed ${seed}: node ${n.id} (${n.kind} at ${n.x},${n.y}) reachable`);
    }
  }
});

test('the bot run stays fast (default run under 20 s)', () => {
  for (const seed of SEEDS) run(seed);
  const ms = Date.now() - started;
  if (process.env.BALANCE !== '1') assert.ok(ms < 20000, `took ${ms} ms`);
});
