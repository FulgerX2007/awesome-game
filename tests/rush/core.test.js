'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../web/rush/core.js');

const { TICK, HZ, SPEED, STEER } = R;

const level = (extra) => ({
  length: 100, gates: [], obstacles: [], platforms: [], enemy: { count: 5, power: 1 }, ...extra,
});

// A fresh run with the crowd parked at x (and steering to stay there).
function runAt(def, x = 0, count) {
  const run = R.newRun(def, {});
  if (count !== undefined) run.count = count;
  run.x = x;
  run.target = x;
  return run;
}

// Steps one tick at a time until the crowd passes z (or the run stops). `target` may be a function of the run.
function driveTo(run, z, target = run.target) {
  while (run.status === 'running' && run.z < z) R.step(run, TICK, typeof target === 'function' ? target(run) : target);
  return run;
}

const gateLevel = (gate) => level({ gates: [{ z: 10, ...gate }] });

test('crowd radius grows with √count and is capped at 0.9', () => {
  assert.equal(R.radius(0), 0);
  assert.ok(Math.abs(R.radius(25) - 0.4) < 1e-12);
  assert.ok(Math.abs(R.radius(100) - 0.8) < 1e-12);
  assert.equal(R.radius(127), 0.9);
  assert.equal(R.radius(5000), 0.9);
});

test('newRun starts at the line with the upgrades applied', () => {
  const plain = R.newRun(level(), {});
  assert.equal(plain.count, R.BASE_COUNT);
  assert.equal(plain.power, R.BASE_POWER);
  assert.equal(plain.shield, 1);
  assert.equal(plain.z, 0);
  assert.equal(plain.x, 0);
  assert.equal(plain.status, 'running');
  const up = R.newRun(level(), { start: 2, weapon: 3, shield: 5, income: 1 });
  assert.equal(up.count, R.BASE_COUNT + 6);
  assert.ok(Math.abs(up.power - 1.6) < 1e-12);
  assert.ok(Math.abs(up.shield - 0.7) < 1e-12);
});

test('cleanUpgrades drops junk and caps at the max level', () => {
  assert.deepEqual(R.cleanUpgrades(null), { start: 0, weapon: 0, shield: 0, income: 0 });
  assert.deepEqual(R.cleanUpgrades({ start: 'x', weapon: 2.5, shield: 99, income: -3, extra: 4 }),
    { start: 0, weapon: 0, shield: 10, income: 0 });
  assert.ok(Math.abs(R.shieldMul({ shield: 10 }) - 0.4) < 1e-12);
});

test('the crowd runs at 12 m/s and steers at up to 2.5 units/s', () => {
  const run = R.newRun(level(), {});
  for (let i = 0; i < HZ; i++) R.step(run, TICK, 1);
  assert.equal(run.z, SPEED);
  const r = R.radius(run.count);
  assert.ok(Math.abs(run.x - (1 - r)) < 1e-9, 'stops at the edge: the whole crowd stays on the track');
  const run2 = R.newRun(level(), {});
  for (let i = 0; i < 12; i++) R.step(run2, TICK, 1);
  assert.ok(Math.abs(run2.x - STEER * 0.2) < 1e-9);
  for (let i = 0; i < 60; i++) R.step(run2, TICK, -0.25);
  assert.ok(Math.abs(run2.x + 0.25) < 1e-9, 'eases to the target and stops there');
});

test('every gate op changes the crowd as in the rules', () => {
  const cases = [
    [{ op: 'add', n: 5 }, 15, 1],
    [{ op: 'sub', n: 3 }, 7, 1],
    [{ op: 'mul', n: 2 }, 20, 1],
    [{ op: 'mul', n: 3 }, 30, 1],
    [{ op: 'div', n: 2 }, 5, 1],
    [{ op: 'div', n: 3 }, 3, 1], // 10 / 3 rounds down
    [{ op: 'pow' }, 10, 2],
    [{ op: 'pow', n: 1 }, 10, 2],
  ];
  for (const [op, count, power] of cases) {
    const run = driveTo(runAt(gateLevel({ full: op })), 20);
    assert.equal(run.count, count, `${op.op} ${op.n}`);
    assert.equal(run.power, power, `${op.op} ${op.n}`);
    assert.equal(run.status, 'running');
  }
});

test('applyOp rounds division down and only pow touches the weapon', () => {
  assert.deepEqual(R.applyOp(7, 1.4, { op: 'div', n: 2 }), { count: 3, power: 1.4 });
  assert.deepEqual(R.applyOp(7, 1.4, { op: 'mul', n: 3 }), { count: 21, power: 1.4 });
  assert.deepEqual(R.applyOp(7, 1.4, { op: 'pow', n: 1 }), { count: 7, power: 2.4 });
  assert.equal(R.applyOp(R.MAX_COUNT - 1, 1, { op: 'mul', n: 3 }).count, R.MAX_COUNT);
});

test('the side is picked by the crowd centre', () => {
  const pair = { left: { op: 'add', n: 5 }, right: { op: 'mul', n: 3 } };
  assert.equal(driveTo(runAt(gateLevel(pair), -0.5), 20).count, 15);
  assert.equal(driveTo(runAt(gateLevel(pair), 0.5), 20).count, 30);
  assert.equal(driveTo(runAt(gateLevel(pair), -0.01), 20).count, 15, 'a crowd mostly over the line still takes its centre side');
  assert.equal(driveTo(runAt(gateLevel(pair), 0), 20).count, 30, 'the centre line belongs to the right gate');
  assert.equal(R.gateSide({ full: {} }, -0.9), 'full');
  // A full-width gate applies wherever the crowd is.
  for (const x of [-0.6, 0, 0.6]) assert.equal(driveTo(runAt(gateLevel({ full: { op: 'add', n: 4 } }), x), 20).count, 14);
});

test('a gate pair is crossed only once, however the steps are cut', () => {
  const def = level({ gates: [{ z: 10, left: { op: 'add', n: 5 }, right: { op: 'add', n: 5 } }] });
  const run = runAt(def, 0);
  // Tiny steps around the gate, then zig-zag across the line right after it.
  while (run.z < 9.9) R.step(run, TICK, 0);
  for (let i = 0; i < 400; i++) R.step(run, 0.001, i % 2 ? -0.8 : 0.8);
  driveTo(run, 60, -0.5);
  assert.equal(run.count, 15);
  const gates = run.events.filter((e) => e.type === 'gate');
  assert.equal(gates.length, 1);
  assert.deepEqual(gates[0], { type: 'gate', z: 10, side: 'right', op: 'add', n: 5, before: 10, after: 15, good: true });

  // Two gates crossed inside one long step are each applied once, in order of z.
  const two = runAt(level({ gates: [{ z: 2.1, full: { op: 'mul', n: 2 } }, { z: 2.05, full: { op: 'add', n: 1 } }] }));
  R.step(two, 0.25, 0);
  assert.equal(two.count, 22, '(10 + 1) · 2');
  assert.equal(two.gateIdx, 2);
});

test('gate events say whether the gate was good', () => {
  const ev = (op) => driveTo(runAt(gateLevel({ full: op })), 20).events[0];
  assert.equal(ev({ op: 'add', n: 1 }).good, true);
  assert.equal(ev({ op: 'mul', n: 2 }).good, true);
  assert.equal(ev({ op: 'pow' }).good, true);
  assert.equal(ev({ op: 'sub', n: 1 }).good, false);
  assert.equal(ev({ op: 'div', n: 2 }).good, false);
});

test('overlap is the covered share of the span', () => {
  assert.equal(R.overlap(-1, 1, -1, 1), 1);
  assert.equal(R.overlap(-1, 1, 0, 5), 0.5);
  assert.equal(R.overlap(0, 1, 2, 3), 0);
  assert.equal(R.overlap(0, 1, 1, 2), 0, 'touching is not overlapping');
  assert.equal(R.overlap(1, 1, 0, 2), 0, 'an empty span overlaps nothing');
  assert.ok(Math.abs(R.spanOverlap(0, 100, 0.4, 1) - 0.25) < 1e-12); // span [-0.8, 0.8]
});

test('saws and walls take a share of the crowd by overlap: full, partial, none', () => {
  // 100 soldiers: r = 0.8, the crowd at x = 0 spans [-0.8, 0.8].
  const hit = (o, upgrades = {}) => {
    const run = R.newRun(level({ obstacles: [{ z: 10, ...o }] }), upgrades);
    run.count = 100;
    return driveTo(run, 20, 0);
  };
  assert.equal(hit({ kind: 'wall', x0: -1, x1: 1 }).status, 'lost', 'a full-width wall takes everyone');
  assert.equal(hit({ kind: 'saw', x0: -1, x1: 1 }).count, 50, 'a full-width saw takes half');
  assert.equal(hit({ kind: 'wall', x0: 0, x1: 1 }).count, 50);
  assert.equal(hit({ kind: 'saw', x0: 0, x1: 1 }).count, 75);
  assert.equal(hit({ kind: 'saw', x0: 0.4, x1: 1 }).count, 87, 'ceil(100 · 0.25 · 0.5) = 13');
  const miss = hit({ kind: 'wall', x0: 0.85, x1: 1 });
  assert.equal(miss.count, 100);
  assert.equal(miss.events.length, 0, 'a dodge makes no hit event');
  const ev = hit({ kind: 'wall', x0: 0, x1: 1 }).events[0];
  assert.deepEqual(ev, { type: 'hit', z: 10, kind: 'wall', lost: 50 });
});

test('a crowd can dodge an obstacle by steering away', () => {
  const def = level({ obstacles: [{ z: 30, kind: 'wall', x0: 0, x1: 1 }] });
  const stay = driveTo(runAt(def, 0.3), 40);
  const dodge = driveTo(runAt(def, 0.3), 40, -1);
  assert.ok(stay.count < 10);
  assert.equal(dodge.count, 10);
});

test('the Щит upgrade scales obstacle losses down by 6% a level', () => {
  const hit = (shield) => {
    const run = R.newRun(level({ obstacles: [{ z: 10, kind: 'wall', x0: 0, x1: 1 }] }), { shield });
    run.count = 100;
    return 100 - driveTo(run, 20, 0).count;
  };
  assert.equal(hit(0), 50);
  assert.equal(hit(5), 35);
  assert.equal(hit(10), 20);
});

test('platforms: soldiers off the platform fall, depending on its phase', () => {
  // A still platform (omega = 0) at x = A·sin(phi), 0.8 wide; 50 soldiers at x = 0 span ±0.566.
  const cross = (phi, count = 50, shield = 0) => {
    const def = level({ platforms: [{ z0: 20, z1: 40, w: 0.8, A: 0.6, omega: 0, phi }] });
    const run = R.newRun(def, { shield });
    run.count = count;
    return driveTo(run, 60, 0);
  };
  const under = cross(0, 16); // r = 0.32 fits on [-0.4, 0.4]
  assert.equal(under.count, 16);
  assert.equal(under.events.length, 0);

  const partial = cross(0); // span wider than the platform: the edges fall until the crowd fits
  assert.ok(partial.status === 'running' && partial.count < 50 && partial.count >= 20, `count ${partial.count}`);
  assert.ok(R.radius(partial.count) <= 0.4 + 0.08, 'what is left is about the platform width');
  assert.ok(partial.events.every((e) => e.type === 'fall' && e.lost > 0));

  const away = cross(Math.PI / 2); // the platform sits at x = 0.6: [0.2, 1.0], the crowd is off it
  assert.equal(away.status, 'lost');
  assert.equal(away.reason, 'crowd');
  assert.ok(away.z >= 20 && away.z < 40, 'falls inside the gap');

  const shielded = cross(0, 50, 10);
  assert.ok(shielded.count >= partial.count, 'the shield slows the fall');

  // After the gap nothing more falls.
  const after = cross(0);
  const n = after.count;
  driveTo(after, 90, 0);
  assert.equal(after.count, n);
});

test('a moving platform: following it saves the crowd, standing still does not', () => {
  const p = { z0: 20, z1: 60, w: 0.6, A: 0.5, omega: 1.5, phi: 0.3 };
  const def = level({ platforms: [p] });
  const follow = driveTo(runAt(def, 0), 80, (run) => R.platformX(p, (run.ticks + 1) / HZ));
  const still = driveTo(runAt(def, 0), 80, 0);
  assert.equal(follow.count, 10);
  assert.ok(still.count < follow.count);
  assert.equal(R.platformX(p, 0), 0.5 * Math.sin(0.3));
  const lv = R.parseLevel(def);
  assert.equal(R.platformAt(lv, 20), lv.platforms[0]);
  assert.equal(R.platformAt(lv, 19.9), null);
  assert.equal(R.platformAt(lv, 60), null);
  assert.equal(R.uncovered(0, 4, { w: 2, A: 0, omega: 0, phi: 0 }, 0), 0);
});

test('losing at zero: the run stops and stays lost', () => {
  const sub = driveTo(runAt(gateLevel({ full: { op: 'sub', n: 10 } })), 20);
  assert.equal(sub.status, 'lost');
  assert.equal(sub.reason, 'crowd');
  assert.equal(sub.count, 0);
  const z = sub.z;
  R.step(sub, 1, 0.5);
  assert.equal(sub.z, z, 'a lost run does not move');

  const over = driveTo(runAt(gateLevel({ full: { op: 'sub', n: 50 } })), 20);
  assert.equal(over.count, 0, 'never negative');
  assert.equal(over.events[0].after, 0);

  const run = runAt(gateLevel({ full: { op: 'div', n: 3 } }));
  run.count = 2;
  assert.equal(driveTo(run, 20).status, 'lost', '2 / 3 rounds down to 0');

  // A gate behind a losing gate in the same step is not applied.
  const two = runAt(level({ gates: [{ z: 2, full: { op: 'sub', n: 10 } }, { z: 2.1, full: { op: 'add', n: 50 } }] }));
  R.step(two, 0.25, 0);
  assert.equal(two.status, 'lost');
  assert.equal(two.count, 0);
});

test('reaching the end of the track starts the battle', () => {
  const run = driveTo(R.newRun(level({ length: 30 }), {}), 1000);
  assert.equal(run.status, 'battle');
  assert.equal(run.z, 30);
  assert.equal(R.progress(run), 1);
  assert.equal(R.strength(run), run.count * run.power);
  R.step(run, TICK, 0);
  assert.equal(run.ticks, 30 * HZ / SPEED, 'stops moving');
});

test('determinism: the same steering gives the same run, however dt is cut', () => {
  const def = level({
    length: 200,
    gates: [{ z: 30, left: { op: 'mul', n: 3 }, right: { op: 'add', n: 20 } }, { z: 90, full: { op: 'pow' } },
      { z: 150, left: { op: 'sub', n: 4 }, right: { op: 'mul', n: 2 } }],
    obstacles: [{ z: 60, kind: 'saw', x0: -0.3, x1: 0.4 }, { z: 120, kind: 'wall', x0: 0.2, x1: 1 }],
    platforms: [{ z0: 160, z1: 190, w: 1.8, A: 0.2, omega: 2, phi: 1 }],
  });
  const play = (cut) => {
    const run = R.newRun(def, { start: 2, shield: 3 });
    let i = 0;
    while (run.status === 'running') {
      const target = Math.sin(run.ticks / 40);
      R.step(run, cut(i++), target);
    }
    return run;
  };
  const a = play(() => TICK);
  const b = play(() => TICK);
  assert.deepEqual(a, b);
  assert.equal(a.status, 'battle');
  assert.deepEqual(a.events.filter((e) => e.type !== 'fall').map((e) => e.type), ['gate', 'hit', 'gate', 'hit', 'gate']);
  // Coarser and mixed steps (the target changes only between calls) still tick the same simulation clock.
  const c = play((i) => (i % 3 === 0 ? 2 * TICK : TICK / 2));
  assert.equal(c.ticks, a.ticks);
  assert.equal(c.status, a.status);
});

test('step ignores dt ≤ 0, NaN and infinite dt, and caps a long dt', () => {
  const run = R.newRun(level(), {});
  R.step(run, TICK * 3, 0.5);
  const snap = JSON.parse(JSON.stringify(run));
  for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined, '0.1', null]) R.step(run, dt, -1);
  assert.deepEqual(run, snap);
  // A non-finite target keeps the previous one.
  R.step(run, TICK, NaN);
  assert.equal(run.target, 0.5);
  // A long pause doesn't fast-forward the run.
  const long = R.newRun(level(), {});
  R.step(long, 5, 0);
  assert.equal(long.z, R.MAX_DT * SPEED);
  assert.equal(R.step(null, TICK, 0), null);
});

test('invalid levels throw', () => {
  const bad = [
    null,
    level({ length: 0 }),
    level({ length: NaN }),
    level({ gates: [{ z: 10, full: { op: 'mod', n: 2 } }] }),
    level({ gates: [{ z: 10, left: { op: 'add', n: 2 }, right: { op: 'xor', n: 1 } }] }),
    level({ gates: [{ z: 10, left: { op: 'add', n: 2 } }] }),
    level({ gates: [{ z: 10, full: { op: 'add', n: 0 } }] }),
    level({ gates: [{ z: 10, full: { op: 'add', n: 1.5 } }] }),
    level({ gates: [{ z: 10, full: { op: 'mul', n: 4 } }] }),
    level({ gates: [{ z: 10, full: { op: 'div', n: 1 } }] }),
    level({ gates: [{ z: 10, full: { op: 'pow', n: 2 } }] }),
    level({ gates: [{ z: 10, full: { op: 'add', n: 1 }, left: { op: 'add', n: 1 } }] }),
    level({ gates: [{ z: 150, full: { op: 'add', n: 1 } }] }),
    level({ gates: [{ z: 0, full: { op: 'add', n: 1 } }] }),
    level({ gates: {} }),
    level({ obstacles: [{ z: 10, kind: 'lava', x0: 0, x1: 1 }] }),
    level({ obstacles: [{ z: 10, kind: 'saw', x0: 0.5, x1: 0.2 }] }),
    level({ obstacles: [{ z: 10, kind: 'saw', x0: -2, x1: 0.2 }] }),
    level({ platforms: [{ z0: 30, z1: 20, w: 0.5, A: 0.2, omega: 1, phi: 0 }] }),
    level({ platforms: [{ z0: 20, z1: 30, w: 0, A: 0.2, omega: 1, phi: 0 }] }),
    level({ platforms: [{ z0: 20, z1: 30, w: 0.5, A: -1, omega: 1, phi: 0 }] }),
    level({ platforms: [{ z0: 20, z1: 30, w: 0.5, A: 0.2, phi: 0 }] }),
    level({ platforms: [{ z0: 20, z1: 40, w: 0.5, A: 0.2, omega: 1, phi: 0 }, { z0: 30, z1: 50, w: 0.5, A: 0, omega: 0, phi: 0 }] }),
    level({ enemy: undefined }),
    level({ enemy: { count: -1, power: 1 } }),
    level({ enemy: { count: 5, power: 0 } }),
    level({ boss: { hp: 0 } }),
    level({ num: 0 }),
    level({ num: 2.5 }),
    level({ num: '3' }),
  ];
  for (const def of bad) assert.throws(() => R.newRun(def, {}), Error, JSON.stringify(def));
});

test('parseLevel sorts by z and keeps a boss', () => {
  const lv = R.parseLevel(level({
    gates: [{ z: 50, full: { op: 'add', n: 1 } }, { z: 20, full: { op: 'pow' } }],
    obstacles: [{ z: 70, kind: 'saw', x0: -1, x1: 0 }, { z: 30, kind: 'wall', x0: 0, x1: 1 }],
    boss: { hp: 300 },
  }));
  assert.deepEqual(lv.gates.map((g) => g.z), [20, 50]);
  assert.deepEqual(lv.obstacles.map((o) => o.z), [30, 70]);
  assert.deepEqual(lv.boss, { hp: 300 });
  assert.equal(R.parseLevel(level({ boss: null })).boss, null);
  assert.deepEqual(R.parseLevel({ length: 50, enemy: { count: 0, power: 1 } }).gates, [], 'lists are optional');
});

test('parseLevel keeps the level number, 1 by default', () => {
  assert.equal(R.parseLevel(level()).num, 1);
  assert.equal(R.parseLevel(level({ num: 17 })).num, 17);
  const run = R.newRun(level({ num: 6 }), {});
  assert.equal(run.level.num, 6);
  assert.equal(run.result, null);
});
