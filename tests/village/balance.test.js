'use strict';
// Balance checks: a greedy bot (tests/village/bot.js) plays whole games through the public core.js API.
// Default run: 3 seeds. BALANCE=1 runs 20 seeds.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');
const { play } = require('./bot.js');

const SEEDS = process.env.BALANCE === '1' ? Array.from({ length: 20 }, (_, i) => i + 1) : [1, 2, 3];
const MIN = 60;

const started = Date.now();
const runs = new Map();
function run(seed) {
  if (!runs.has(seed)) runs.set(seed, play(seed));
  return runs.get(seed);
}

const fmt = (t) => `${(t / MIN).toFixed(1)} min`;

// Longest stretch of game time without anything new (a building, a tool level or a barn level).
function maxGap(log) {
  let prev = 0, gap = 0;
  for (const e of log) { gap = Math.max(gap, e.t - prev); prev = e.t; }
  return gap;
}

test('seed 1: the festival in 2–3.5 h, the well in 1–3 min, something new at least every 15 min', () => {
  const r = run(1);
  assert.ok(r.festival, `festival reached (stopped at ${fmt(r.t)})`);
  assert.ok(r.t >= 120 * MIN && r.t <= 210 * MIN, `festival at ${fmt(r.t)}`);
  const well = r.log.find((e) => e.what === 'well');
  assert.ok(well && well.t >= 1 * MIN && well.t <= 3 * MIN, `well at ${well && fmt(well.t)}`);
  const gap = maxGap(r.log);
  assert.ok(gap <= 15 * MIN, `longest gap ${fmt(gap)}`);
});

test(`the bot reaches the festival with no deadlock on ${SEEDS.length} seeds`, () => {
  for (const seed of SEEDS) {
    const r = run(seed);
    assert.ok(r.festival, `seed ${seed}: festival reached (stopped at ${fmt(r.t)})`);
    for (const id of Object.keys(V.BUILDINGS)) assert.ok(r.s.built[id].done, `seed ${seed}: ${id} built`);
    assert.ok(r.t <= 4 * 3600, `seed ${seed}: festival at ${fmt(r.t)}`);
    assert.ok(maxGap(r.log) <= 15 * MIN, `seed ${seed}: longest gap ${fmt(maxGap(r.log))}`);
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
