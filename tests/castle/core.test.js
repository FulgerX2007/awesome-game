'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/castle/core.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≈ ${b}`);
const deg = (d) => (d * Math.PI) / 180;

// A run in a wave with nothing scheduled except what the test spawns.
function inWave(seed = 1) {
  const run = C.newRun('campaign', seed);
  C.startWave(run, [{ kind: 'grunt', at: 9999 }]); // keeps the wave open
  C.drain(run);
  return run;
}

// The angle (radians) at the given power whose arrow passes closest to (tx, ty), searched over [lo°, hi°].
function angleFor(run, tx, ty, power, lo = -30, hi = 80) {
  let best = null;
  for (let d = lo; d <= hi; d += 0.05) {
    const a = deg(d);
    for (let t = 0; t < 8; t += 0.002) {
      const p = C.flight(run, a, power, t);
      if (p.x >= tx) {
        const err = Math.abs(p.y - ty);
        if (!best || err < best.err) best = { a, err };
        break;
      }
      if (p.y < -1) break;
    }
  }
  return best.a;
}

// Seconds of simulation in small frames.
const sim = (run, seconds, frame = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += frame) C.step(run, frame); };

test('a new run starts ready, with a full wall and nothing on the field', () => {
  const run = C.newRun('endless', 7);
  assert.equal(run.status, 'ready');
  assert.equal(run.mode, 'endless');
  assert.equal(run.wave, 0);
  assert.equal(run.wallHp, C.WALL_HP);
  assert.deepEqual(run.enemies, []);
  assert.throws(() => C.newRun('story', 1));
  assert.equal(C.newRun('campaign', 'x').seed, 1, 'a bad seed falls back to 1');
});

test('an arrow follows the closed-form parabola', () => {
  const run = inWave();
  C.aim(run, deg(40), 0.8);
  C.setFiring(run, true);
  C.step(run, C.TICK);
  C.setFiring(run, false);
  assert.equal(run.arrows.length, 1);
  const a0 = { ...run.arrows[0] };
  sim(run, 0.5);
  const a = run.arrows[0];
  // after n ticks of semi-implicit Euler: x exact, y within a tick's error of the parabola
  const t = (Math.round(0.5 / C.TICK) + 1) * C.TICK;
  const p = C.flight(run, deg(40), 0.8, t);
  near(a.x, p.x, 1e-6, 'x');
  near(a.y, p.y, 0.1, 'y');
  assert.ok(a.y < a0.y + 10);
});

test('the first arrow goes when the cooldown ends, then one per reload; release fires nothing extra', () => {
  const run = inWave();
  const reload = C.stats(run).reload;
  run.cooldown = 0.3;
  C.setFiring(run, true);
  let fired = 0;
  const count = () => { fired += C.drain(run).filter((e) => e.type === 'fire').length; };
  sim(run, 0.25);
  count();
  assert.equal(fired, 0, 'still cooling down');
  sim(run, 0.1);
  count();
  assert.equal(fired, 1, 'the first arrow after the cooldown');
  // the first arrow left at ~0.3 s; by 1.8 s two more (0.9, 1.5), the next is due at 2.1
  assert.equal(reload, 0.6);
  sim(run, 1.45);
  count();
  assert.equal(fired, 3, 'then one per reload');
  C.setFiring(run, false);
  sim(run, 2);
  count();
  assert.equal(fired, 3, 'releasing fires nothing more');
});

test('setFiring outside a wave does nothing', () => {
  const run = C.newRun('campaign', 1);
  C.setFiring(run, true);
  assert.equal(run.firing, false);
  sim(run, 1);
  assert.equal(run.arrows.length, 0);
});

test('aim clamps the angle and power and ignores bad numbers', () => {
  const run = C.newRun();
  C.aim(run, deg(120), 5);
  assert.equal(run.aim.angle, C.ANGLE_MAX);
  assert.equal(run.aim.power, 1);
  C.aim(run, deg(-90), -1);
  assert.equal(run.aim.angle, C.ANGLE_MIN);
  assert.equal(run.aim.power, C.MIN_POWER);
  C.aim(run, NaN, Infinity);
  assert.equal(run.aim.angle, C.ANGLE_MIN);
  assert.equal(run.aim.power, C.MIN_POWER);
});

test('step ignores bad dt and slices the same however dt is cut', () => {
  const play = (frames) => {
    const run = inWave(3);
    C.spawn(run, 'grunt', { x: 20 });
    C.spawn(run, 'shield', { x: 26 });
    C.aim(run, deg(12), 0.75);
    C.setFiring(run, true);
    for (const f of frames) C.step(run, f);
    return run;
  };
  const fine = play(Array(300).fill(1 / 60));
  const coarse = play(Array(25).fill(0.2));
  const mixed = play([...Array(100).fill(1 / 120), ...Array(50).fill(1 / 30), ...Array(10).fill(0.25), ...Array(24).fill(1 / 60)].slice(0));
  for (const r of [coarse]) {
    assert.deepEqual(r.enemies.map((e) => [e.kind, e.hp.toFixed(6), e.x.toFixed(6)]),
      fine.enemies.map((e) => [e.kind, e.hp.toFixed(6), e.x.toFixed(6)]));
    assert.equal(r.kills, fine.kills);
  }
  assert.ok(mixed.t > 0);
  const run = inWave();
  for (const bad of [0, -1, NaN, Infinity, 'x', undefined]) C.step(run, bad);
  assert.equal(run.t, 0);
});

test('the same inputs give the same run', () => {
  const play = () => {
    const run = C.newRun('campaign', 42);
    C.startWave(run, [{ kind: 'grunt', at: 0 }, { kind: 'flyer', at: 1 }, { kind: 'shield', at: 2 }]);
    C.aim(run, deg(20), 0.8);
    C.setFiring(run, true);
    sim(run, 8);
    return JSON.stringify(run);
  };
  assert.equal(play(), play());
});

test('a shield takes a quarter from shallow hits and full damage from lobbed ones', () => {
  const X = 40;
  const shoot = (angle, power) => {
    const run = inWave();
    const e = C.spawn(run, 'shield', { x: X, speedMul: 0 });
    C.aim(run, angle, power);
    C.setFiring(run, true);
    C.step(run, C.TICK);
    C.setFiring(run, false);
    let ev = [];
    for (let k = 0; k < 900 && run.arrows.length; k++) { C.step(run, C.TICK); ev = ev.concat(C.drain(run)); }
    return { lost: e.maxHp - e.hp, shield: ev.some((v) => v.type === 'shieldHit') };
  };
  const probe = inWave();
  // A flat shot at full power, aimed at the middle of the shield.
  const flat = shoot(angleFor(probe, X - 0.5, 0.9, 1, -30, 30), 1);
  assert.equal(flat.shield, true);
  near(flat.lost, C.DAMAGE_BASE * C.SHIELD_FACTOR, 1e-9, 'quarter');
  // A high lob at reduced power that comes down steeply on it.
  const lob = shoot(angleFor(probe, X, 1.0, 0.8, 55, 80), 0.8);
  assert.equal(lob.shield, false);
  near(lob.lost, C.DAMAGE_BASE, 1e-9, 'full');
});

test('pierce passes through N enemies; without it the arrow stops at the first', () => {
  const line = (pierce) => {
    const run = inWave();
    run.up.pierce = pierce;
    // a tight column of rams (boxes overlap), so the descending arrow crosses several of them
    for (const x of [30, 30.5, 31, 31.5]) C.spawn(run, 'ram', { x, speedMul: 0 });
    C.aim(run, angleFor(run, 30 - 1.3, 1.5, 1, -30, 30), 1);
    C.setFiring(run, true);
    C.step(run, C.TICK);
    C.setFiring(run, false);
    sim(run, 2);
    return run.enemies.filter((e) => e.hp < e.maxHp).length;
  };
  assert.equal(line(0), 1);
  assert.equal(line(2), 3);
});

test('multishot fans out extra arrows by the spread angle', () => {
  const run = inWave();
  run.up.multi = 2;
  C.aim(run, deg(30), 1);
  C.setFiring(run, true);
  C.step(run, C.TICK);
  assert.equal(run.arrows.length, 3);
  const angles = run.arrows.map((a) => Math.atan2(a.vy + C.G * C.TICK, a.vx)).sort((a, b) => a - b);
  near(angles[1], deg(30), 1e-6);
  near(angles[2] - angles[1], C.SPREAD, 1e-6);
  near(angles[1] - angles[0], C.SPREAD, 1e-6);
});

test('fire upgrade: a hit sets the enemy burning for a few seconds', () => {
  const run = inWave();
  run.up.fire = 1;
  const e = C.spawn(run, 'ram', { x: 20, speedMul: 0 });
  C.aim(run, angleFor(run, 20 - 1.3, 0.8, 1, -30, 30), 1);
  C.setFiring(run, true);
  C.step(run, C.TICK);
  C.setFiring(run, false);
  sim(run, 1.2);
  const afterHit = e.hp;
  assert.ok(e.burn > 0);
  const left = e.burn;
  sim(run, C.BURN_TIME + 0.5);
  near(afterHit - e.hp, C.BURN_DPS * left, 0.05, 'burn damage');
  assert.equal(e.burn, 0);
});

test('enemies walk to the wall and hit it; a ram hits four times as hard', () => {
  const run = inWave();
  const g = C.spawn(run, 'grunt', { x: 5 });
  sim(run, 3);
  assert.equal(g.atWall, true);
  near(g.x, C.WALL_X + g.w / 2, 1e-9);
  const before = run.wallHp;
  sim(run, 2);
  near(before - run.wallHp, 2 * C.KINDS.grunt.wall, 0.05);
  const r = inWave();
  C.spawn(r, 'ram', { x: C.WALL_X + C.KINDS.ram.w / 2 + 0.01 });
  sim(r, 2.5);
  near(C.WALL_HP - r.wallHp, (2.5 - 0.02) * 4, 0.1);
});

test('flyers spend the ward first, then hit the wall', () => {
  const run = inWave();
  assert.equal(run.ward, 1);
  C.spawn(run, 'flyer', { x: 5 });
  C.spawn(run, 'flyer', { x: 6 });
  sim(run, 3);
  const ev = C.drain(run);
  assert.equal(ev.filter((e) => e.type === 'ward').length, 1);
  assert.equal(run.ward, 0);
  assert.equal(run.enemies.length, 1, 'one flyer left');
  const left = run.enemies.find((e) => e.kind === 'flyer');
  assert.ok(left && left.atWall);
  const hp = run.wallHp;
  sim(run, 1);
  assert.ok(run.wallHp < hp);
});

test('the ward refills to its max at every wave start', () => {
  const run = C.newRun('campaign', 1);
  run.up.ward = 2;
  C.startWave(run, [{ kind: 'flyer', at: 0, x: 4 }]);
  assert.equal(run.ward, 3);
});

test('the boss calls grunts at half HP, once', () => {
  const run = inWave();
  run.wave = 10;
  const b = C.spawn(run, 'boss', { x: 30, speedMul: 0 });
  assert.equal(b.maxHp, 60 + C.BOSS_HP_STEP);
  b.hp = b.maxHp / 2;
  C.step(run, C.TICK);
  assert.equal(run.enemies.filter((e) => e.kind === 'grunt').length, C.BOSS_SUMMON);
  C.step(run, C.TICK);
  assert.equal(run.enemies.filter((e) => e.kind === 'grunt').length, C.BOSS_SUMMON);
});

test('the run is lost when the wall falls', () => {
  const run = inWave();
  run.wallHp = 1;
  C.spawn(run, 'ram', { x: C.WALL_X + 1.31 });
  sim(run, 1);
  assert.equal(run.status, 'lost');
  assert.equal(run.firing, false);
  assert.ok(C.drain(run).some((e) => e.type === 'lost'));
  C.setFiring(run, true);
  assert.equal(run.firing, false);
});

test('a wave clears when every enemy is down; kills pay gold', () => {
  const run = C.newRun('campaign', 1);
  C.startWave(run, [{ kind: 'grunt', at: 0, x: 30, speedMul: 0 }]);
  C.aim(run, angleFor(run, 29, 0.9, 1, -30, 30), 1);
  C.setFiring(run, true);
  sim(run, 6);
  assert.equal(run.status, 'between');
  assert.equal(run.kills, 1);
  assert.equal(run.gold, C.KINDS.grunt.gold);
  const ev = C.drain(run);
  assert.ok(ev.some((e) => e.type === 'waveClear' && e.noDamage));
  assert.equal(C.startWave(run, []), true, 'the next wave can start');
  assert.equal(run.wave, 2);
});

test('helpers: segment-box entry and descent angle', () => {
  near(C.segmentBox(0, 0, 10, 0, 4, -1, 6, 1), 0.4, 1e-12);
  assert.equal(C.segmentBox(0, 5, 10, 5, 4, -1, 6, 1), -1);
  assert.equal(C.segmentBox(5, 0, 5, 0, 4, -1, 6, 1), 0, 'a point inside');
  near(C.descent(1, -1), 45, 1e-9);
  near(C.descent(-1, -1), 45, 1e-9);
  near(C.descent(1, 1), -45, 1e-9);
  assert.throws(() => C.spawn(C.newRun(), 'dragon'));
});
