'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../web/rush/core.js');
const V = require('../../web/rush/view.js');

const VP = { w: 360, h: 640 };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('project: nearer is larger and lower, farther goes up to the horizon', () => {
  const camZ = 100;
  const a = V.project(0, camZ + 8, camZ, VP);
  const b = V.project(0, camZ + 40, camZ, VP);
  const c = V.project(0, camZ + 1e7, camZ, VP);
  assert.ok(a.scale > b.scale, 'nearer is larger');
  assert.ok(a.sy > b.sy, 'nearer is lower');
  assert.ok(b.sy > V.horizonY(VP));
  assert.ok(near(c.sy, V.horizonY(VP), 1e-3), 'far away is on the horizon');
  assert.ok(near(c.sx, VP.w / 2, 1e-3), 'the track converges to the middle');
  assert.equal(a.d, 8);
});

test('project: the crowd stands on the ground line with the track edges at ±trackHalf', () => {
  const camZ = 37;
  const p = V.project(0, camZ + V.CAM_BACK, camZ, VP);
  assert.ok(near(p.sy, V.groundY(VP)));
  assert.ok(near(p.sx, VP.w / 2));
  const edge = V.project(1, camZ + V.CAM_BACK, camZ, VP);
  assert.ok(near(edge.sx - VP.w / 2, V.trackHalf(VP)));
  assert.ok(near(p.scale * V.HALF_M, V.trackHalf(VP)), 'scale is px per metre');
  // Height lifts a point by h·scale.
  const up = V.project(0, camZ + V.CAM_BACK, camZ, VP, 2);
  assert.ok(near(p.sy - up.sy, 2 * p.scale));
  // A landscape screen keeps the track from getting too wide.
  assert.ok(V.trackHalf({ w: 1280, h: 600 }) < 0.44 * 1280);
});

test('project is symmetric in x', () => {
  for (const [x, z] of [[0.3, 10], [1, 50], [0.75, 7.5], [2, 120]]) {
    const l = V.project(-x, z, 0, VP);
    const r = V.project(x, z, 0, VP);
    assert.ok(near(l.sx - VP.w / 2, -(r.sx - VP.w / 2)));
    assert.equal(l.sy, r.sy);
    assert.equal(l.scale, r.scale);
  }
});

test('project: too near or behind the camera is not drawn; junk viewports fall back to a phone', () => {
  assert.equal(V.project(0, 0.2, 0, VP), null);
  assert.equal(V.project(0, -5, 0, VP), null);
  assert.equal(V.project(0, NaN, 0, VP), null);
  assert.ok(V.project(0, V.NEAR, 0, VP), 'exactly NEAR is drawn');
  for (const vp of [undefined, {}, { w: -1, h: 0 }, { w: NaN, h: 'x' }]) {
    const p = V.project(0, V.CAM_BACK, 0, vp);
    assert.ok(near(p.sx, 180) && near(p.sy, 640 * V.GROUND));
  }
});

test('unproject is the inverse of project', () => {
  for (const vp of [VP, { w: 1280, h: 720 }, { w: 320, h: 900 }]) {
    for (const camZ of [0, 55.5]) {
      for (const [x, z] of [[0, 6], [0.5, 9], [-1, 20], [0.9, 3], [-0.25, 140]]) {
        const p = V.project(x, camZ + z, camZ, vp);
        const g = V.unproject(p.sx, p.sy, camZ, vp);
        assert.ok(near(g.x, x, 1e-9), `x ${x} at ${z}`);
        assert.ok(near(g.z, camZ + z, 1e-6), `z ${z}`);
      }
    }
  }
});

test('unproject without sy answers at the crowd: the pointer X becomes a steering target', () => {
  const g = V.unproject(VP.w / 2 + V.trackHalf(VP), undefined, 10, VP);
  assert.ok(near(g.x, 1));
  assert.ok(near(g.z, 10 + V.CAM_BACK));
  assert.ok(near(V.unproject(VP.w / 2, null, 0, VP).x, 0));
  assert.ok(near(V.unproject(0, null, 0, VP).x, -VP.w / 2 / V.trackHalf(VP)));
  assert.equal(V.unproject(100, V.horizonY(VP), 0, VP), null, 'the horizon is infinitely far');
  assert.equal(V.unproject(100, 10, 0, VP), null, 'the sky has no ground');
  assert.equal(V.unproject(100, 1e6, 0, VP), null, 'nearer than NEAR');
});

test('crowdLayout fits the soldiers in the crowd radius, up to 150 figures', () => {
  for (const count of [1, 2, 7, 10, 33, 100, 149, 150, 151, 500, 99999]) {
    const r = R.radius(count);
    const lay = V.crowdLayout(count, r);
    assert.equal(lay.length, Math.min(count, V.MAX_SOLDIERS));
    let far = 0;
    for (const p of lay) {
      const d = Math.hypot(p.dx, p.dy);
      assert.ok(d <= r + 1e-9, `count ${count}: ${d} > ${r}`);
      far = Math.max(far, d);
    }
    if (lay.length > 5) assert.ok(far > r * 0.9, 'the disc is filled to its edge');
  }
  assert.deepEqual(V.crowdLayout(1, 0.5), [{ dx: 0, dy: 0 }], 'one soldier stands in the middle');
  assert.deepEqual(V.crowdLayout(0, 0.5), []);
  assert.deepEqual(V.crowdLayout(-3, 0.5), []);
  assert.deepEqual(V.crowdLayout(NaN, 0.5), []);
  assert.equal(V.crowdLayout(10, 0.5, 4).length, 4, 'a custom cap');
  assert.ok(V.crowdLayout(10, NaN).every((p) => p.dx === 0 && p.dy === 0), 'junk radius collapses to the middle');
  // No two soldiers on the same spot.
  const lay = V.crowdLayout(150, 0.9);
  const keys = new Set(lay.map((p) => `${p.dx.toFixed(4)},${p.dy.toFixed(4)}`));
  assert.equal(keys.size, 150);
});

test('armyLayout lines the enemy up in centred ranks inside the track', () => {
  for (const count of [1, 2, 5, 16, 44, 150, 1000]) {
    const lay = V.armyLayout(count);
    assert.equal(lay.length, Math.min(count, V.MAX_SOLDIERS));
    for (const p of lay) assert.ok(Math.abs(p.dx) <= 0.85 + 1e-9 && p.dz >= 0);
    // Every rank is centred.
    const ranks = new Map();
    for (const p of lay) ranks.set(p.dz, (ranks.get(p.dz) || 0) + p.dx);
    for (const sum of ranks.values()) assert.ok(Math.abs(sum) < 1e-9);
  }
  assert.deepEqual(V.armyLayout(0), []);
  assert.deepEqual(V.armyLayout(1), [{ dx: 0, dz: 0 }]);
});

test('number formatting and gate labels', () => {
  assert.equal(V.fmt(0), '0');
  assert.equal(V.fmt(7.4), '7');
  assert.equal(V.fmt(9999), '9999');
  assert.equal(V.fmt(12345), '12.3K');
  assert.equal(V.fmt(99999), '99.9K');
  assert.equal(V.fmt(123456), '123K');
  assert.equal(V.fmt(2500000), '2.5M');
  assert.equal(V.fmt(-5), '0');
  assert.equal(V.fmt(NaN), '0');
  assert.equal(V.fmtPower(1), '1');
  assert.equal(V.fmtPower(1.4000000001), '1.4');
  assert.equal(V.fmtPower(3.25), '3.3');
  assert.equal(V.opLabel({ op: 'add', n: 10 }), '+10');
  assert.equal(V.opLabel({ op: 'sub', n: 5 }), '−5');
  assert.equal(V.opLabel({ op: 'mul', n: 2 }), '×2');
  assert.equal(V.opLabel({ op: 'div', n: 3 }), '÷3');
  assert.equal(V.opLabel({ op: 'pow', n: 1 }), '+1');
  assert.equal(V.opLabel({ op: 'nope' }), '');
  assert.equal(V.opLabel(null), '');
  for (const op of ['add', 'mul', 'pow']) assert.equal(V.goodOp({ op }), true);
  for (const op of ['sub', 'div']) assert.equal(V.goodOp({ op }), false);
  assert.equal(V.goodOp(null), false);
});

// A run brought to the finish line with a given crowd, then settled by core.
function settled(enemy, boss, count, power = 1) {
  const run = R.newRun({ length: 10, enemy, boss }, {});
  while (run.status === 'running') R.step(run, R.TICK, 0);
  run.count = count;
  run.power = power;
  const start = { count, power };
  R.finishBattle(run);
  return { run, plan: V.battlePlan(run, start) };
}

// Samples the timeline and checks that the shown numbers only go down.
function sample(plan) {
  const frames = [];
  for (let t = 0; t <= plan.total + 0.5; t += 0.05) frames.push(V.battleAt(plan, t));
  for (let i = 1; i < frames.length; i++) {
    for (const k of ['ours', 'enemy', 'boss']) assert.ok(frames[i][k] <= frames[i - 1][k], `${k} grows at ${i}`);
  }
  return frames;
}

test('battle timeline: a won army battle melts both sides down to what core says', () => {
  const { run, plan } = settled({ count: 20, power: 1 }, null, 50, 2);
  assert.equal(run.result.won, true);
  const start = V.battleAt(plan, 0);
  assert.equal(start.phase, 'charge');
  assert.equal(start.ours, 50);
  assert.equal(start.enemy, 20);
  const frames = sample(plan);
  assert.ok(!frames.some((f) => f.phase === 'boss' || f.phase === 'walk'));
  const end = V.battleAt(plan, plan.total);
  assert.equal(end.phase, 'done');
  assert.equal(end.k, 1);
  assert.equal(end.ours, run.result.survivors);
  assert.equal(end.enemy, 0);
  assert.equal(V.battleAt(plan, -1).phase, 'charge');
  assert.equal(V.battleAt(plan, NaN).ours, 50);
});

test('battle timeline: a lost army battle leaves the enemy standing and skips the boss', () => {
  const { run, plan } = settled({ count: 30, power: 2 }, { hp: 10 }, 20, 1);
  assert.equal(run.result.reason, 'army');
  assert.equal(plan.hasBoss, false);
  const frames = sample(plan);
  assert.ok(!frames.some((f) => f.phase === 'boss'));
  const end = V.battleAt(plan, plan.total);
  assert.equal(end.ours, 0);
  assert.equal(end.enemy, 20, 'ceil((60 − 20) / 2)');
  assert.equal(end.boss, 10, 'the boss was never reached');
});

test('battle timeline: a boss level walks on to the boss and melts its HP', () => {
  const won = settled({ count: 10, power: 1 }, { hp: 20 }, 50, 1);
  assert.equal(won.run.result.won, true);
  assert.equal(won.plan.hasBoss, true);
  const phases = new Set(sample(won.plan).map((f) => f.phase));
  for (const p of ['charge', 'army', 'walk', 'boss', 'done']) assert.ok(phases.has(p), p);
  const mid = V.battleAt(won.plan, won.plan.t.charge + won.plan.t.army + 0.1);
  assert.equal(mid.phase, 'walk');
  assert.equal(mid.ours, 40, 'after the army');
  assert.equal(mid.boss, 20);
  const end = V.battleAt(won.plan, won.plan.total);
  assert.equal(end.boss, 0);
  assert.equal(end.ours, won.run.result.survivors);
  assert.equal(end.ours, 20);

  const lost = settled({ count: 10, power: 1 }, { hp: 50 }, 30, 1);
  assert.equal(lost.run.result.reason, 'boss');
  const e2 = V.battleAt(lost.plan, lost.plan.total);
  assert.equal(e2.ours, 0);
  assert.equal(e2.boss, 30, 'HP 50 − the rest 20');
  assert.ok(lost.plan.total > settled({ count: 10, power: 1 }, null, 30, 1).plan.total, 'the boss takes longer');
});

test('clamp keeps a value inside [lo, hi]', () => {
  assert.equal(V.clamp(0.5, -1, 1), 0.5);
  assert.equal(V.clamp(-2, -1, 1), -1);
  assert.equal(V.clamp(2, -1, 1), 1);
});

test('viewport: a usable size, 360×640 for a missing or broken one', () => {
  assert.deepEqual(V.viewport({ w: 800, h: 600 }), { w: 800, h: 600 });
  assert.deepEqual(V.viewport(), { w: 360, h: 640 });
  assert.deepEqual(V.viewport({ w: 0, h: NaN }), { w: 360, h: 640 });
  assert.deepEqual(V.viewport({ w: -5, h: 300 }), { w: 360, h: 300 });
});

test('focal: px per metre at 1 m, so the track half is trackHalf px at the crowd (CAM_BACK away)', () => {
  for (const vp of [VP, { w: 1280, h: 720 }, { w: 320, h: 568 }]) {
    assert.ok(near((V.focal(vp) / V.CAM_BACK) * V.HALF_M, V.trackHalf(vp)));
    assert.ok(near(V.project(0, V.CAM_BACK, 0, vp).scale, V.focal(vp) / V.CAM_BACK), 'project scales by focal / distance');
  }
  assert.ok(V.focal({ w: 1280, h: 720 }) > V.focal(VP), 'a bigger screen has a longer focal length');
});
