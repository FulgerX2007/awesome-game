// Числовой забег — pure rules for the auto-run arcade. No DOM, so the same file runs in the browser and in Node
// (tests and the balance bot). The run advances in fixed ticks of 1/60 s whatever `dt` the caller passes,
// so the result does not depend on the frame rate. No rng: a level plus the steering decide everything.
(function (root) {
  'use strict';

  const HZ = 60;
  const TICK = 1 / HZ;
  const MAX_DT = 0.25;      // one step() call simulates at most this much (a hidden tab doesn't fast-forward)
  const SPEED = 12;         // m/s forward
  const STEER = 2.5;        // track units/s sideways (the track is x ∈ [-1, 1])
  const BASE_COUNT = 10;    // soldiers at the start before upgrades
  const BASE_POWER = 1;     // weapon level at the start before upgrades
  const MAX_COUNT = 99999;
  const FALL_RATE = 4;      // share of the uncovered soldiers that fall off a platform per second

  const UPGRADES = ['start', 'weapon', 'shield', 'income'];
  const MAX_UPGRADE = 10;
  const START_PER_LEVEL = 3;     // Старт: +3 soldiers
  const WEAPON_PER_LEVEL = 0.2;  // Оружие: +0.2 weapon level
  const SHIELD_PER_LEVEL = 0.06; // Щит: −6% losses from obstacles and platforms

  const OPS = ['add', 'sub', 'mul', 'div', 'pow'];
  const KINDS = ['saw', 'wall'];
  const KIND_RATE = { saw: 0.5, wall: 1 };

  const radius = (count) => Math.min(0.9, 0.08 * Math.sqrt(Math.max(0, count)));
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  // Share of [a0, a1] covered by [b0, b1].
  function overlap(a0, a1, b0, b1) {
    if (!(a1 > a0)) return 0;
    const len = Math.min(a1, b1) - Math.max(a0, b0);
    return len > 0 ? Math.min(1, len / (a1 - a0)) : 0;
  }

  // ── Level format ──
  // { length, gates: [{z, left, right} | {z, full}], obstacles: [{z, x0, x1, kind}],
  //   platforms: [{z0, z1, w, A, omega, phi}], enemy: {count, power}, boss: null | {hp} }
  // A gate op is {op: 'add'|'sub'|'mul'|'div'|'pow', n}: add/sub take n ≥ 1, mul/div 2–3, pow is always +1.
  function checkOp(g, what) {
    if (!g || typeof g !== 'object') throw new Error(`${what}: not a gate op`);
    if (!OPS.includes(g.op)) throw new Error(`${what}: unknown op ${g.op}`);
    if (g.op === 'pow') {
      if (g.n !== undefined && g.n !== 1) throw new Error(`${what}: pow is always +1`);
      return { op: 'pow', n: 1 };
    }
    if (!Number.isInteger(g.n)) throw new Error(`${what}: n must be an integer`);
    if ((g.op === 'add' || g.op === 'sub') && (g.n < 1 || g.n > MAX_COUNT)) throw new Error(`${what}: n out of range`);
    if ((g.op === 'mul' || g.op === 'div') && (g.n < 2 || g.n > 3)) throw new Error(`${what}: n must be 2 or 3`);
    return { op: g.op, n: g.n };
  }

  const list = (v, what) => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new Error(`level: ${what} must be an array`);
    return v;
  };

  // Validates a level definition and returns a clean copy with every list sorted by z. Throws on invalid input.
  function parseLevel(def) {
    if (!def || typeof def !== 'object') throw new Error('level: not an object');
    const length = def.length;
    if (!isNum(length) || length <= 0) throw new Error('level: bad length');
    const inTrack = (z) => isNum(z) && z > 0 && z < length;

    const gates = list(def.gates, 'gates').map((g, i) => {
      const what = `gate ${i}`;
      if (!g || !inTrack(g.z)) throw new Error(`${what}: bad z`);
      if (g.full !== undefined) {
        if (g.left !== undefined || g.right !== undefined) throw new Error(`${what}: full and sides together`);
        return { z: g.z, full: checkOp(g.full, what) };
      }
      return { z: g.z, left: checkOp(g.left, `${what} left`), right: checkOp(g.right, `${what} right`) };
    });

    const obstacles = list(def.obstacles, 'obstacles').map((o, i) => {
      const what = `obstacle ${i}`;
      if (!o || !inTrack(o.z)) throw new Error(`${what}: bad z`);
      if (!KINDS.includes(o.kind)) throw new Error(`${what}: unknown kind ${o && o.kind}`);
      if (!isNum(o.x0) || !isNum(o.x1) || o.x0 < -1 || o.x1 > 1 || o.x1 <= o.x0) throw new Error(`${what}: bad x0/x1`);
      return { z: o.z, x0: o.x0, x1: o.x1, kind: o.kind };
    });

    const platforms = list(def.platforms, 'platforms').map((p, i) => {
      const what = `platform ${i}`;
      if (!p || !isNum(p.z0) || !isNum(p.z1) || p.z0 <= 0 || p.z1 <= p.z0 || p.z1 >= length) throw new Error(`${what}: bad z0/z1`);
      if (!isNum(p.w) || p.w <= 0 || p.w > 2) throw new Error(`${what}: bad width`);
      for (const k of ['A', 'omega', 'phi']) if (!isNum(p[k])) throw new Error(`${what}: ${k} must be a number`);
      if (p.A < 0) throw new Error(`${what}: negative amplitude`);
      return { z0: p.z0, z1: p.z1, w: p.w, A: p.A, omega: p.omega, phi: p.phi };
    });
    const byZ0 = platforms.slice().sort((a, b) => a.z0 - b.z0);
    for (let i = 1; i < byZ0.length; i++) {
      if (byZ0[i].z0 < byZ0[i - 1].z1) throw new Error('level: platforms overlap');
    }

    const e = def.enemy;
    if (!e || !Number.isInteger(e.count) || e.count < 0 || !isNum(e.power) || e.power <= 0) throw new Error('level: bad enemy');
    let boss = null;
    if (def.boss !== undefined && def.boss !== null) {
      if (!isNum(def.boss.hp) || def.boss.hp <= 0) throw new Error('level: bad boss');
      boss = { hp: def.boss.hp };
    }

    return {
      length,
      gates: gates.sort((a, b) => a.z - b.z),
      obstacles: obstacles.sort((a, b) => a.z - b.z),
      platforms: byZ0,
      enemy: { count: e.count, power: e.power },
      boss,
    };
  }

  // Upgrade levels as integers 0..MAX_UPGRADE; anything else counts as 0.
  function cleanUpgrades(u) {
    const out = {};
    for (const id of UPGRADES) {
      const v = u && u[id];
      out[id] = Number.isInteger(v) ? clamp(v, 0, MAX_UPGRADE) : 0;
    }
    return out;
  }

  const shieldMul = (u) => Math.max(0, 1 - SHIELD_PER_LEVEL * cleanUpgrades(u).shield);

  function newRun(def, upgrades) {
    const level = parseLevel(def);
    const u = cleanUpgrades(upgrades);
    return {
      level,
      upgrades: u,
      count: BASE_COUNT + START_PER_LEVEL * u.start,
      power: BASE_POWER + WEAPON_PER_LEVEL * u.weapon,
      shield: shieldMul(u),
      x: 0,          // crowd centre
      target: 0,
      z: 0,
      ticks: 0,
      acc: 0,        // dt not yet turned into ticks
      fallAcc: 0,    // fractional soldiers already falling off a platform
      gateIdx: 0,    // next gate / obstacle to cross: each one is crossed at most once
      obstIdx: 0,
      status: 'running', // 'running' → 'battle' at the finish line, or 'lost'
      reason: null,
      events: [],    // what happened, for the client's animations and sounds; the client empties it
    };
  }

  // Result of a gate op on a crowd; pow raises the weapon level instead.
  function applyOp(count, power, g) {
    switch (g.op) {
      case 'add': return { count: Math.min(MAX_COUNT, count + g.n), power };
      case 'sub': return { count: count - g.n, power };
      case 'mul': return { count: Math.min(MAX_COUNT, count * g.n), power };
      case 'div': return { count: Math.floor(count / g.n), power };
      case 'pow': return { count, power: power + 1 };
      default: throw new Error(`unknown op ${g.op}`);
    }
  }

  // The op the crowd takes at a gate: the side its centre is on (x < 0 is left, x ≥ 0 right).
  const gateSide = (g, x) => (g.full ? 'full' : x < 0 ? 'left' : 'right');

  function lose(run) {
    run.count = 0;
    run.status = 'lost';
    run.reason = 'crowd';
  }

  function crossGate(run, g) {
    const side = gateSide(g, run.x);
    const op = g[side];
    const before = { count: run.count, power: run.power };
    const after = applyOp(run.count, run.power, op);
    run.count = after.count;
    run.power = after.power;
    run.events.push({
      type: 'gate', z: g.z, side, op: op.op, n: op.n, before: before.count, after: Math.max(0, after.count),
      good: after.count * after.power > before.count * before.power,
    });
    if (run.count <= 0) lose(run);
  }

  // Share of the crowd span [x − r, x + r] that overlaps [x0, x1].
  function spanOverlap(x, count, x0, x1) {
    const r = radius(count);
    return overlap(x - r, x + r, x0, x1);
  }

  function obstacleLoss(run, o) {
    const share = spanOverlap(run.x, run.count, o.x0, o.x1);
    return Math.min(run.count, Math.ceil(run.count * share * KIND_RATE[o.kind] * run.shield - 1e-9));
  }

  function crossObstacle(run, o) {
    const lost = obstacleLoss(run, o);
    if (lost <= 0) return;
    run.count -= lost;
    run.events.push({ type: 'hit', z: o.z, kind: o.kind, lost });
    if (run.count <= 0) lose(run);
  }

  const platformX = (p, t) => p.A * Math.sin(p.omega * t + p.phi);

  const platformAt = (level, z) => {
    for (const p of level.platforms) if (z >= p.z0 && z < p.z1) return p;
    return null;
  };

  // Share of the crowd span not covered by the platform at time t.
  function uncovered(x, count, p, t) {
    const px = platformX(p, t);
    return 1 - spanOverlap(x, count, px - p.w / 2, px + p.w / 2);
  }

  function tick(run) {
    const L = run.level;
    const prevZ = run.z;
    run.ticks++;
    const t = run.ticks / HZ;
    run.z = Math.min(L.length, (run.ticks * SPEED) / HZ); // from the tick count: no drift, gates at whole metres hit exactly

    const r = radius(run.count);
    const d = run.target - run.x;
    const max = STEER * TICK;
    run.x = clamp(run.x + clamp(d, -max, max), -(1 - r), 1 - r);

    // Gates and obstacles in (prevZ, z], in order of z (a gate before an obstacle at the same z).
    while (run.status === 'running') {
      const g = L.gates[run.gateIdx];
      const o = L.obstacles[run.obstIdx];
      const gz = g && g.z <= run.z && g.z > prevZ ? g.z : Infinity;
      const oz = o && o.z <= run.z && o.z > prevZ ? o.z : Infinity;
      if (gz === Infinity && oz === Infinity) break;
      if (gz <= oz) { run.gateIdx++; crossGate(run, g); } else { run.obstIdx++; crossObstacle(run, o); }
    }
    if (run.status !== 'running') return;

    const p = platformAt(L, run.z);
    if (p) {
      run.fallAcc += run.count * uncovered(run.x, run.count, p, t) * FALL_RATE * TICK * run.shield;
      const lost = Math.min(run.count, Math.floor(run.fallAcc + 1e-9));
      if (lost > 0) {
        run.fallAcc -= lost;
        run.count -= lost;
        run.events.push({ type: 'fall', z: run.z, lost });
        if (run.count <= 0) { lose(run); return; }
      }
    } else {
      run.fallAcc = 0;
    }

    if (run.z >= L.length) run.status = 'battle';
  }

  // Advances the run by dt seconds while the crowd steers towards targetX. dt ≤ 0, NaN or ±Infinity is ignored;
  // a non-finite targetX keeps the previous target. Returns the run.
  function step(run, dt, targetX) {
    if (!run || run.status !== 'running' || !isNum(dt) || dt <= 0) return run;
    if (isNum(targetX)) run.target = clamp(targetX, -1, 1);
    run.acc += Math.min(dt, MAX_DT);
    while (run.acc >= TICK - 1e-9 && run.status === 'running') {
      run.acc -= TICK;
      tick(run);
    }
    if (run.acc < 0) run.acc = 0;
    return run;
  }

  // Track progress 0..1 for the HUD.
  const progress = (run) => run.z / run.level.length;
  const strength = (run) => run.count * run.power;

  const api = {
    HZ, TICK, MAX_DT, SPEED, STEER, BASE_COUNT, BASE_POWER, MAX_COUNT, FALL_RATE,
    UPGRADES, MAX_UPGRADE, START_PER_LEVEL, WEAPON_PER_LEVEL, SHIELD_PER_LEVEL, OPS, KINDS, KIND_RATE,
    radius, overlap, spanOverlap, parseLevel, cleanUpgrades, shieldMul, newRun, applyOp, gateSide,
    obstacleLoss, platformX, platformAt, uncovered, step, progress, strength,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RushCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
