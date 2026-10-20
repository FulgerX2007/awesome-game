'use strict';
// Глубина (web/deep): stages past the whale, the length scale, the legends and their models.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/deep/core.js');
require('../../web/deep/models.js');
const M = globalThis.DeepModels;

test('stages grow in order and end with two legends after the whale', () => {
  const names = C.STAGES.map((s) => s.name);
  assert.deepEqual(names.slice(-3), ['Кит', 'Кракен', 'Левиафан']);
  for (let i = 1; i < C.STAGES.length; i++) assert.ok(C.STAGES[i].from > C.STAGES[i - 1].from, names[i]);
  assert.ok(C.MAX_R > C.STAGES.at(-1).from);
  for (const st of C.STAGES) {
    assert.ok(C.SPECIES_BY_ID[st.species], `${st.name}: body ${st.species}`);
    assert.equal(C.SPECIES_BY_ID[st.species].cls, st.kind, `${st.name}: body fits the size class`);
  }
});

test('length runs from 10 µm through a 45 m whale to a 400 m leviathan, never shrinking', () => {
  const near = (a, b) => Math.abs(a - b) / b < 0.01;
  assert.ok(near(C.lengthMeters(C.START_R), 1e-5));
  assert.ok(near(C.lengthMeters(700), 45));
  assert.ok(near(C.lengthMeters(1500), 140));
  assert.ok(near(C.lengthMeters(C.MAX_R), 400));
  let last = 0;
  for (let r = C.START_R; r <= C.MAX_R; r *= 1.01) {
    const m = C.lengthMeters(r);
    assert.ok(m > last, `r=${r}`);
    last = m;
  }
});

test('every size class and every zone has someone to spawn', () => {
  for (const k of C.KINDS) {
    for (let z = 0; z < C.ZONES.length; z++) {
      const r = Number.isFinite(k.max) ? k.max * 0.9 : C.MAX_R * 2;
      assert.equal(C.speciesFor(r, z + 0.5, Math.random).cls, k.id, `${k.id} in zone ${z}`);
    }
  }
  const legends = C.SPECIES.filter((s) => s.legend).map((s) => s.id);
  assert.deepEqual(legends.sort(), ['aspidochelone', 'kraken', 'leviathan', 'serpent']);
});

test('the leviathan stage is calm: nothing bigger hunts you', () => {
  const big = C.SPECIES.filter((s) => s.cls === 'leviathan');
  assert.ok(big.length >= 2);
  for (const s of big) assert.equal(C.isHunter({ sp: s.id }), false, s.id);
  assert.ok(C.SPECIES.filter((s) => s.cls === 'kraken').every((s) => C.isHunter({ sp: s.id })), 'krakens and serpents hunt');
});

// A canvas context that accepts any drawing call.
function fakeCtx() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : k.startsWith('create') ? () => grad : () => {}),
    set: (o, k, v) => { o[k] = v; return true; },
  });
}

test('every species, the legends included, has a model that draws in both passes', () => {
  for (const sp of C.SPECIES) {
    const ctx = fakeCtx();
    let calls = 0;
    const counted = new Proxy(ctx, { get: (o, k) => { const v = o[k]; return typeof v === 'function' ? (...a) => { calls++; return v(...a); } : v; } });
    M.draw(counted, sp.id, 20, 1.3, 'body');
    assert.ok(calls > 5, `${sp.id} draws a body`);
    M.draw(fakeCtx(), sp.id, 20, 1.3, 'lights');
    const box = M.box(sp.id);
    assert.equal(box.length, 3);
  }
});

// A greedy bot: flee the nearest big hunter, otherwise chase the best bite, keeping to mid-depth.
function play(seed, r0, depth, maxT) {
  const w = C.createWorld(seed, r0, depth), p = w.player, reached = {};
  for (let t = 0; t < maxT && p.r < C.MAX_R - 1; t += 1 / 30) {
    let threat = null, td = Infinity, food = null, fs = Infinity;
    for (const e of w.ents) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (C.isHunter(e) && e.r > p.r * C.EAT_RATIO && d < td) { threat = e; td = d; }
      if (p.r > e.r * C.EAT_RATIO && d / (e.r + 1) < fs) { food = e; fs = d / (e.r + 1); }
    }
    let input = {};
    if (threat && td < threat.r * 5) input = { tx: 2 * p.x - threat.x, ty: 2 * p.y - threat.y, dash: td < threat.r * 2.5 };
    else if (food) input = { tx: food.x, ty: food.y + (2.5 - p.depth) * p.r * 3 };
    C.step(w, 1 / 30, input);
    w.events.length = 0;
    reached[p.stage] ??= t;
  }
  return { p, reached };
}

test('a bot grows from a whale into a full-size leviathan', () => {
  const { p, reached } = play(5, 330, 1.2, 2400);
  const last = C.STAGES.length - 1;
  assert.ok(reached[last] !== undefined, `reached ${JSON.stringify(reached)}`);
  assert.ok(p.r >= C.MAX_R - 1, `r=${p.r}`);
});
