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
  const RECRUIT_REACH = 0.12; // recruits join when the crowd's edge comes this close (track units)
  const EPS = 1e-9;         // float tolerance for ceil/floor/compare on soldier counts and strengths

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
  // { num, length, gates: [{z, left, right} | {z, full}], obstacles: [{z, x0, x1, kind, A?, omega?, phi?}],
  //   platforms: [{z0, z1, w, A, omega, phi}], recruits: [{z, x, n}], enemy: {count, power}, boss: null | {hp} }
  // num is the level number (1-based, default 1): it sets the coin bonus.
  // A saw with A > 0 slides across the track: its span is shifted by A·sin(omega·t + phi) and stays on the track.
  // Recruits are n soldiers waiting at x: the crowd takes them in if its edge comes within RECRUIT_REACH.
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
      const out = { z: o.z, x0: o.x0, x1: o.x1, kind: o.kind };
      if (o.A === undefined && o.omega === undefined && o.phi === undefined) return out;
      for (const k of ['A', 'omega', 'phi']) if (!isNum(o[k])) throw new Error(`${what}: ${k} must be a number`);
      if (o.kind !== 'saw') throw new Error(`${what}: only a saw moves`);
      if (o.A < 0 || o.x0 - o.A < -1 - EPS || o.x1 + o.A > 1 + EPS) throw new Error(`${what}: moves off the track`);
      return { ...out, A: o.A, omega: o.omega, phi: o.phi };
    });

    const recruits = list(def.recruits, 'recruits').map((r, i) => {
      const what = `recruits ${i}`;
      if (!r || !inTrack(r.z)) throw new Error(`${what}: bad z`);
      if (!isNum(r.x) || r.x < -1 || r.x > 1) throw new Error(`${what}: bad x`);
      if (!Number.isInteger(r.n) || r.n < 1 || r.n > MAX_COUNT) throw new Error(`${what}: bad n`);
      return { z: r.z, x: r.x, n: r.n };
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

    let num = 1;
    if (def.num !== undefined) {
      if (!Number.isInteger(def.num) || def.num < 1) throw new Error('level: bad num');
      num = def.num;
    }

    return {
      num,
      length,
      gates: gates.sort((a, b) => a.z - b.z),
      obstacles: obstacles.sort((a, b) => a.z - b.z),
      platforms: byZ0,
      recruits: recruits.sort((a, b) => a.z - b.z),
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

  // u: clean upgrades (see cleanUpgrades).
  const shieldMul = (u) => Math.max(0, 1 - SHIELD_PER_LEVEL * u.shield);

  // def is a level definition or a level number (see levelDef).
  function newRun(def, upgrades) {
    const level = parseLevel(typeof def === 'number' ? levelDef(def) : def);
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
      recruitIdx: 0,
      status: 'running', // 'running' → 'battle' at the finish line → 'won' | 'lost' (finishBattle), or 'lost'
      reason: null,      // why it was lost: 'crowd' | 'army' | 'boss'
      result: null,      // set by finishBattle
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

  // The span [x0, x1] an obstacle covers at time t: a moving saw slides, everything else stays put.
  function obstacleSpan(o, t) {
    const dx = o.A ? o.A * Math.sin(o.omega * t + o.phi) : 0;
    return [o.x0 + dx, o.x1 + dx];
  }

  // The time of the tick on which the crowd crosses z (the run reaches z on a whole tick, see tick()).
  const crossTime = (z) => Math.ceil((z * HZ) / SPEED - EPS) / HZ;

  function obstacleLoss(run, o) {
    const [x0, x1] = obstacleSpan(o, run.ticks / HZ);
    const share = spanOverlap(run.x, run.count, x0, x1);
    return Math.min(run.count, Math.ceil(run.count * share * KIND_RATE[o.kind] * run.shield - EPS));
  }

  function crossObstacle(run, o) {
    const lost = obstacleLoss(run, o);
    if (lost <= 0) return;
    run.count -= lost;
    run.events.push({ type: 'hit', z: o.z, kind: o.kind, lost });
    if (run.count <= 0) lose(run);
  }

  // Recruits join when the crowd's edge comes within RECRUIT_REACH of them.
  const reaches = (x, count, rx) => Math.abs(x - rx) <= radius(count) + RECRUIT_REACH + EPS;

  function crossRecruits(run, rc) {
    const taken = reaches(run.x, run.count, rc.x);
    if (taken) run.count = Math.min(MAX_COUNT, run.count + rc.n);
    run.events.push({ type: 'recruit', z: rc.z, x: rc.x, n: rc.n, taken });
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

    // Gates, obstacles and recruits in (prevZ, z], in order of z (at the same z: gate, obstacle, recruits).
    const due = (it) => (it && it.z <= run.z && it.z > prevZ ? it.z : Infinity);
    while (run.status === 'running') {
      const g = L.gates[run.gateIdx];
      const o = L.obstacles[run.obstIdx];
      const rc = L.recruits[run.recruitIdx];
      const gz = due(g);
      const oz = due(o);
      const rz = due(rc);
      const first = Math.min(gz, oz, rz);
      if (first === Infinity) break;
      if (gz === first) { run.gateIdx++; crossGate(run, g); }
      else if (oz === first) { run.obstIdx++; crossObstacle(run, o); }
      else { run.recruitIdx++; crossRecruits(run, rc); }
    }
    if (run.status !== 'running') return;

    const p = platformAt(L, run.z);
    if (p) {
      run.fallAcc += run.count * uncovered(run.x, run.count, p, t) * FALL_RATE * TICK * run.shield;
      const lost = Math.min(run.count, Math.floor(run.fallAcc + EPS));
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
    while (run.acc >= TICK - EPS && run.status === 'running') {
      run.acc -= TICK;
      tick(run);
    }
    if (run.acc < 0) run.acc = 0;
    return run;
  }

  // Track progress 0..1 for the HUD.
  const progress = (run) => run.z / run.level.length;
  const strength = (run) => run.count * run.power;

  // ── Battle ──
  // At the finish line the crowd (strength count·power) fights the enemy army (E·p_e): ours must be greater.
  // On a boss level the rest of the strength (ours − the army's) must then reach the boss's HP.

  // Settles a run that has stopped: 'battle' becomes 'won' or 'lost' (reason 'army' or 'boss'); a run lost on the
  // track stays lost. Returns run.result { won, reason, survivors, strength, enemy, boss, rest }, or null while the
  // run is still on the track. Calling it again returns the same result.
  function finishBattle(run) {
    if (!run) return null;
    if (run.result) return run.result;
    if (run.status !== 'battle' && run.status !== 'lost') return null;
    const L = run.level;
    const enemy = L.enemy.count * L.enemy.power;
    const boss = L.boss ? L.boss.hp : 0;
    const res = { won: false, reason: null, survivors: 0, strength: 0, enemy, boss, rest: 0 };
    if (run.status === 'lost') {
      res.reason = run.reason || 'crowd';
    } else {
      res.strength = run.count * run.power;
      if (!(res.strength > enemy + EPS)) {
        res.reason = 'army';
      } else {
        res.rest = res.strength - enemy;
        if (L.boss && res.rest < boss - EPS) {
          res.reason = 'boss';
        } else {
          res.won = true;
          // After the army alone at least one soldier is left; a boss may take the last one.
          res.survivors = Math.max(L.boss ? 0 : 1, Math.ceil((res.rest - boss) / run.power - EPS));
        }
      }
      run.status = res.won ? 'won' : 'lost';
      run.reason = res.reason;
    }
    run.result = res;
    return res;
  }

  // ── Economy ──
  const COIN_PER_LEVEL = 10;      // coins = survivors + 10·level number
  const INCOME_PER_LEVEL = 0.1;   // Доход: +10% coins
  const PRICE_BASE = { start: 30, weapon: 45, shield: 40, income: 60 };
  const PRICE_GROWTH = 1.35;
  const SAVE_KEY = 'rush.save';
  const MAX_LEVEL = 9999;
  const MAX_COINS = 1e9;

  // Price of the next level of an upgrade that is now at `lvl`.
  const price = (id, lvl) => Math.round(PRICE_BASE[id] * PRICE_GROWTH ** lvl);

  // Coins for a settled run (call finishBattle first): survivors + 10·level number, +10% per Доход level.
  // The level bonus is paid while the level is new (`fresh`): a lost run still gets it, so a stuck player can buy
  // upgrades, but a replay of a level already won pays only its survivors. 0 for a run not settled yet.
  function reward(run, upgrades, fresh = true) {
    const res = run && run.result;
    if (!res) return 0;
    const u = cleanUpgrades(upgrades);
    const bonus = fresh ? COIN_PER_LEVEL * run.level.num : 0;
    return Math.round((res.survivors + bonus) * (1 + INCOME_PER_LEVEL * u.income));
  }

  // Saved under SAVE_KEY: { v: 1, level: the level to play next, best: the highest level won, coins, upgrades,
  // stars: [stars of level 1, level 2, …] }. Every level up to best has been won, so stars has best entries of 1–3
  // (a save from before stars existed gets 1 star for each level it has won).
  const newSave = () => ({ v: 1, level: 1, best: 0, coins: 0, upgrades: cleanUpgrades(null), stars: [] });

  // A save from a JSON string (or null). Broken or foreign data gives a clean save, junk fields their defaults.
  function parseSave(raw) {
    const s = newSave();
    if (typeof raw !== 'string') return s;
    let d;
    try { d = JSON.parse(raw); } catch { return s; }
    if (!d || typeof d !== 'object' || d.v !== 1) return s;
    const int = (v, lo, hi, def) => (Number.isInteger(v) && v >= lo && v <= hi ? v : def);
    s.best = int(d.best, 0, MAX_LEVEL, 0);
    s.level = Math.min(int(d.level, 1, MAX_LEVEL, 1), s.best + 1);
    s.coins = int(d.coins, 0, MAX_COINS, 0);
    s.upgrades = cleanUpgrades(d.upgrades);
    const stars = Array.isArray(d.stars) ? d.stars : [];
    s.stars = Array.from({ length: s.best }, (_, i) => int(stars[i], 1, 3, 1));
    return s;
  }

  // Reads the save from a Storage-like object ({ getItem }); a missing or throwing storage gives a clean save.
  function loadSave(storage) {
    let raw = null;
    try { raw = storage ? storage.getItem(SAVE_KEY) : null; } catch { raw = null; }
    return parseSave(raw);
  }

  // Writes the save to a Storage-like object ({ setItem }). Returns false when it couldn't be stored.
  function storeSave(storage, save) {
    try {
      if (!storage) return false;
      const { level, best, coins, upgrades, stars } = save;
      storage.setItem(SAVE_KEY, JSON.stringify({ v: 1, level, best, coins, upgrades: cleanUpgrades(upgrades), stars }));
      return true;
    } catch {
      return false;
    }
  }

  // Price of the next level of an upgrade in this save, or null when it is maxed (or unknown).
  function nextPrice(save, id) {
    if (!UPGRADES.includes(id)) return null;
    const lvl = cleanUpgrades(save && save.upgrades)[id];
    return lvl >= MAX_UPGRADE ? null : price(id, lvl);
  }

  // Buys one level of an upgrade. Returns 'ok', or why not: 'unknown' | 'max' | 'nocoins'.
  function buy(save, id) {
    if (!save || !UPGRADES.includes(id)) return 'unknown';
    const lvl = save.upgrades[id];
    if (lvl >= MAX_UPGRADE) return 'max';
    const cost = price(id, lvl);
    if (!(save.coins >= cost)) return 'nocoins';
    save.coins -= cost;
    save.upgrades[id] = lvl + 1;
    return 'ok';
  }

  // The upgrade whose next level is cheapest (ties in UPGRADES order), or null when all are maxed.
  function cheapest(upgrades) {
    const u = cleanUpgrades(upgrades);
    let best = null;
    for (const id of UPGRADES) {
      if (u[id] < MAX_UPGRADE && (best === null || price(id, u[id]) < price(best, u[best]))) best = id;
    }
    return best;
  }

  // Puts a settled run into the save: its coins, and on a win the next level. Returns the coins earned.
  // A run is banked once: recording it again adds nothing. The level bonus is paid only on a level not won yet.
  function record(save, run) {
    const res = finishBattle(run);
    if (!save || !res || run.recorded) return 0;
    run.recorded = true;
    const coins = reward(run, save.upgrades, run.level.num > save.best);
    save.coins = Math.min(MAX_COINS, save.coins + coins);
    if (res.won) {
      const n = run.level.num;
      save.best = Math.max(save.best, n);
      save.level = Math.min(MAX_LEVEL, Math.max(save.level, n + 1));
      if (!Array.isArray(save.stars)) save.stars = [];
      while (save.stars.length < save.best) save.stars.push(1);
      save.stars[n - 1] = Math.max(save.stars[n - 1] || 1, starsFor(run));
    }
    return coins;
  }

  // Stars of a level in this save: 1–3 for a level won, 0 otherwise.
  const levelStars = (save, n) => (save && Array.isArray(save.stars) && save.stars[n - 1]) || 0;
  const totalStars = (save) => (save && Array.isArray(save.stars) ? save.stars.reduce((a, b) => a + b, 0) : 0);

  // The client's end of a run: record it and write the save at once (before the battle animation), so leaving
  // mid-animation loses nothing. Returns the coins earned.
  function bank(storage, save, run) {
    const coins = record(save, run);
    storeSave(storage, save);
    return coins;
  }

  // ── Levels ──
  // Levels 1–3 are written by hand; the rest come from a deterministic generator seeded with level·7919, and past
  // level 30 they keep coming (endless mode). Either way the enemy is sized by a simulated "smart" run with the
  // upgrades a player is expected to have by then, so that run wins with a margin of about 25%.
  const LEVEL_SEED = 7919;
  const BOSS_EVERY = 5;
  const BOSS_SHARE = 0.4;    // share of the enemy budget that goes to the boss on a boss level
  const MARGIN = 0.25;       // designed margin of the smart run over the enemy (±0.03 by the seed)
  const MARGIN_JITTER = 0.06;
  const CAMPAIGN = 30;       // levels past this are the endless mode: the margin shrinks
  const MAX_ATTEMPTS = 40;
  const TIE = 1.15;          // at every gate pair the better side beats the worse one by at least this much

  const op = (o, n) => (n === undefined ? { op: o } : { op: o, n });
  const HAND = [
    { // 1: plain number gates
      length: 300,
      gates: [
        { z: 60, left: op('add', 10), right: op('sub', 5) },
        { z: 130, left: op('sub', 8), right: op('mul', 2) },
        { z: 200, left: op('add', 15), right: op('div', 2) },
        { z: 260, full: op('add', 10) },
      ],
    },
    { // 2: a choice between two good gates, a wall and a saw to steer around
      length: 300,
      gates: [
        { z: 50, left: op('mul', 2), right: op('add', 5) },
        { z: 150, left: op('add', 20), right: op('sub', 10) },
        { z: 250, left: op('div', 2), right: op('mul', 2) },
      ],
      obstacles: [
        { z: 100, x0: -1, x1: -0.2, kind: 'wall' },
        { z: 200, x0: 0, x1: 1, kind: 'saw' },
      ],
    },
    { // 3: the weapon gate and a moving platform
      length: 300,
      gates: [
        { z: 50, left: op('add', 10), right: op('mul', 3) },
        { z: 160, left: op('pow'), right: op('add', 10) },
        { z: 260, left: op('sub', 15), right: op('add', 15) },
      ],
      obstacles: [{ z: 210, x0: -0.3, x1: 0.3, kind: 'saw' }],
      platforms: [{ z0: 100, z1: 112, w: 1.2, A: 0.3, omega: 1.2, phi: 0 }],
    },
  ];

  // mulberry32
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Survivors a player is expected to bring home from level k (the expected-economy model, close to the bot's).
  const expectSurvivors = (k) => 3 + 2 * k;

  // Upgrades a player is expected to have when starting level n: they won every level before it with the expected
  // survivors and always bought the cheapest upgrade they could afford.
  const expMemo = [null, cleanUpgrades(null)];
  let expCoins = 0;
  function expectedUpgrades(n) {
    if (!Number.isInteger(n) || n < 1 || n > MAX_LEVEL) throw new Error(`bad level ${n}`);
    while (expMemo.length <= n) {
      const k = expMemo.length - 1; // the level just won
      const u = { ...expMemo[k] };
      expCoins += Math.round((expectSurvivors(k) + COIN_PER_LEVEL * k) * (1 + INCOME_PER_LEVEL * u.income));
      for (let id = cheapest(u); id && price(id, u[id]) <= expCoins; id = cheapest(u)) {
        expCoins -= price(id, u[id]);
        u[id]++;
      }
      expMemo.push(u);
    }
    return { ...expMemo[n] };
  }

  // Where an autopilot steers: onto the platform it is on or is coming to, away from the next obstacle (where a
  // moving saw will be when the crowd gets there), to the next recruits, or to the side of the next gate pair with
  // the greater ('best') or smaller ('worst') resulting strength. It looks only at the nearest thing ahead.
  // The generator sizes the enemy with it, stars compare a run with it, and the client uses it for a demo run.
  function pilotTarget(run, mode) {
    const L = run.level;
    const z = run.z;
    const t = run.ticks / HZ;
    const on = platformAt(L, z);
    if (on) return platformX(on, t + TICK);
    const g = L.gates.find((x) => x.z > z && !x.full);
    const o = L.obstacles.find((x) => x.z > z);
    const p = L.platforms.find((x) => x.z0 > z);
    const rc = L.recruits.find((x) => x.z > z);
    const gz = g ? g.z : Infinity;
    const oz = o ? o.z : Infinity;
    const pz = p ? p.z0 : Infinity;
    const rz = rc ? rc.z : Infinity;
    const first = Math.min(gz, oz, pz, rz);
    if (first === Infinity) return run.target;
    if (pz === first) return platformX(p, t + (pz - z) / SPEED);
    if (oz === first) {
      const r = radius(run.count);
      const a = -(1 - r);
      const b = 1 - r;
      const [x0, x1] = obstacleSpan(o, crossTime(oz));
      const la = spanOverlap(a, run.count, x0, x1);
      const lb = spanOverlap(b, run.count, x0, x1);
      if (la !== lb) return la < lb ? a : b;
      return Math.abs(run.x - a) <= Math.abs(run.x - b) ? a : b;
    }
    if (rz === first) return mode === 'worst' ? (rc.x < 0 ? 1 : -1) : rc.x;
    const s = (side) => { const r = applyOp(run.count, run.power, g[side]); return r.count * r.power; };
    const sl = s('left');
    const sr = s('right');
    const left = mode === 'worst' ? sl <= sr : sl >= sr;
    return left ? -1 : 1;
  }

  // ── Stars ──
  // A won run earns 1–3 stars by its strength at the finish against par: what the smart autopilot brings to the
  // finish on the same level with the same upgrades. The autopilot looks one thing ahead, so a player who plays
  // the whole level well can match or beat it.
  const STAR_SHARES = [0.9, 0.98]; // share of par for 2 and for 3 stars

  // Par of a run (computed once, kept on the run): the autopilot's strength at the finish, 0 if it fell on the way.
  function par(run) {
    if (!run) return 0;
    if (run.par === undefined) {
      const auto = autoplay(run.level, run.upgrades, 'best').run;
      run.par = auto.status === 'battle' ? strength(auto) : 0;
    }
    return run.par;
  }

  // Stars for a settled run: 0 for a loss (or a run not settled yet), else 1–3.
  function starsFor(run) {
    const res = run && run.result;
    if (!res || !res.won) return 0;
    const p = par(run);
    if (!(p > 0)) return 3;
    const k = res.strength / p;
    return k >= STAR_SHARES[1] - EPS ? 3 : k >= STAR_SHARES[0] - EPS ? 2 : 1;
  }

  // Runs a level with the autopilot. Returns { run, ties } where ties counts gate pairs whose two sides were
  // closer than TIE for the crowd that came to them.
  function autoplay(def, upgrades, mode) {
    const run = newRun(def, upgrades);
    let ties = 0;
    while (run.status === 'running') {
      const gi = run.gateIdx;
      const c = run.count;
      const pw = run.power;
      step(run, TICK, pilotTarget(run, mode));
      for (let i = gi; i < run.gateIdx; i++) {
        const g = run.level.gates[i];
        if (g.full) continue;
        const a = applyOp(c, pw, g.left);
        const b = applyOp(c, pw, g.right);
        const sa = a.count * a.power;
        const sb = b.count * b.power;
        if (Math.min(sa, sb) > 0 && Math.max(sa, sb) < TIE * Math.min(sa, sb)) ties++;
      }
      run.events.length = 0;
    }
    return { run, ties };
  }

  const r2 = (v) => Math.round(v * 100) / 100;
  // Round gate numbers like a designer would: 7, 35, 120.
  const nice = (v) => Math.max(1, v < 20 ? Math.round(v) : v < 100 ? Math.round(v / 5) * 5 : Math.round(v / 10) * 10);

  // Track layout of a generated level (no enemy yet). It follows the expected count of the good path to pick gate
  // numbers that keep the crowd near a target size that grows with the level.
  function genLayout(n, rnd, u) {
    const length = Math.min(700, Math.round((280 + 14 * n) / 10) * 10);
    const target = Math.min(600, 30 + 10 * n);
    const powMax = Math.min(4, 1 + Math.floor(n / 8));
    const pPlat = Math.min(0.15, 0.05 + 0.005 * n);
    const pObst = Math.min(0.45, 0.25 + 0.01 * n);
    const pFull = 0.1;
    const pTwoGood = 0.35;
    const pRecruit = n >= 4 ? Math.min(0.3, 0.16 + 0.005 * n) : 0;
    const pMoving = n >= 8 ? Math.min(0.55, 0.3 + 0.01 * n) : 0;
    const shield = shieldMul(u);
    let c = BASE_COUNT + START_PER_LEVEL * u.start;
    let pw = BASE_POWER + WEAPON_PER_LEVEL * u.weapon;
    let pows = 0;
    const gates = [];
    const obstacles = [];
    const platforms = [];
    const recruits = [];
    const end = length - 25;
    let z = 40 + Math.floor(rnd() * 10);
    let sinceGate = 0;

    const good = () => {
      if (pows < powMax && gates.length > 0 && rnd() < 0.25) return op('pow');
      if (c < target * 0.35) return op('mul', c * 3 <= target * 0.6 && rnd() < 0.5 ? 3 : 2);
      return op('add', nice(c * (0.3 + 0.4 * rnd())));
    };
    const bad = () => (rnd() < 0.45
      ? op('div', c >= 30 && rnd() < 0.35 ? 3 : 2)
      : op('sub', Math.max(2, nice(c * (0.3 + 0.4 * rnd())))));
    const strengthOf = (g) => { const a = applyOp(c, pw, g); return a.count * a.power; };
    const take = (g) => {
      const a = applyOp(c, pw, g);
      c = Math.max(1, a.count);
      pw = a.power;
      if (g.op === 'pow') pows++;
    };

    while (z < end) {
      const roll = rnd();
      let kind = 'gate';
      if (gates.length > 0 && sinceGate < 2) {
        if (roll < pPlat) kind = 'platform';
        else if (roll < pPlat + pObst) kind = 'obstacle';
        else if (roll < pPlat + pObst + pRecruit) kind = 'recruits';
      }
      if (kind === 'recruits') {
        // A small band off to one side: worth a detour, not a level-maker
        const side = rnd() < 0.5 ? -1 : 1;
        const rc = { z, x: r2(side * (0.45 + rnd() * 0.35)), n: Math.max(2, nice(c * (0.15 + 0.2 * rnd()))) };
        recruits.push(rc);
        c = Math.min(MAX_COUNT, c + rc.n);
      }
      if (kind === 'platform') {
        const len = Math.round(8 + rnd() * Math.min(6, 2 + n / 5));
        if (z + len >= end) kind = 'obstacle';
        else {
          platforms.push({
            z0: z, z1: z + len,
            w: r2(Math.max(0.9, 1.5 - 0.015 * n) + rnd() * 0.2),
            A: r2(0.2 + rnd() * Math.min(0.5, 0.02 * n)),
            omega: r2(0.8 + rnd() * 0.8),
            phi: r2(rnd() * 6.28),
          });
          c = Math.max(1, Math.round(c * 0.85));
          z += len;
        }
      }
      if (kind === 'obstacle') {
        const w = Math.min(1.2, 0.4 + Math.min(0.5, 0.02 * n) + rnd() * 0.3);
        const where = rnd();
        let x0;
        let x1;
        if (where < 0.4) { x0 = -1; x1 = -1 + w; } else if (where < 0.8) { x0 = 1 - w; x1 = 1; } else {
          const m = (rnd() - 0.5) * 0.4;
          x0 = m - w / 2;
          x1 = m + w / 2;
        }
        let o = { z, x0: r2(x0), x1: r2(x1), kind: rnd() < 0.5 ? 'saw' : 'wall' };
        if (rnd() < pMoving) {
          // A narrower saw that sweeps across the middle of the track
          const sw = r2(0.45 + rnd() * 0.25);
          const A = Math.floor(100 * Math.min(1 - sw / 2, 0.3 + rnd() * 0.3 + 0.005 * n)) / 100;
          o = { z, x0: -sw / 2, x1: sw / 2, kind: 'saw', A, omega: r2(1.2 + rnd() * 1.0), phi: r2(rnd() * 6.28) };
        }
        obstacles.push(o);
        const r = radius(c);
        const [sx0, sx1] = obstacleSpan(o, crossTime(z));
        const share = Math.min(spanOverlap(-(1 - r), c, sx0, sx1), spanOverlap(1 - r, c, sx0, sx1));
        c = Math.max(1, c - Math.ceil(c * share * KIND_RATE[o.kind] * shield));
      }
      if (kind === 'gate') {
        if (gates.length > 0 && rnd() < pFull) {
          const g = rnd() < 0.5
            ? op('sub', Math.max(1, nice(c * (0.1 + 0.1 * rnd()))))
            : op('add', nice(c * (0.2 + 0.2 * rnd())));
          gates.push({ z, full: g });
          take(g);
        } else {
          const a = good();
          let b = rnd() < pTwoGood ? good() : bad();
          let sa = strengthOf(a);
          let sb = strengthOf(b);
          if (b.op !== 'sub' && b.op !== 'div' && Math.max(sa, sb) < 1.3 * Math.min(sa, sb)) {
            b = bad();
            sb = strengthOf(b);
          }
          const better = sa >= sb ? a : b;
          if (rnd() < 0.5) gates.push({ z, left: a, right: b }); else gates.push({ z, left: b, right: a });
          take(better);
        }
        sinceGate = 0;
      } else {
        sinceGate++;
      }
      z += Math.round(Math.max(26, 42 - 0.4 * n) + rnd() * 10);
    }
    return { num: n, length, gates, obstacles, platforms, recruits };
  }

  const isBossLevel = (n) => n % BOSS_EVERY === 0;
  const enemyPower = (n) => Math.min(9.9, Math.round(10 * (1 + 0.08 * (n - 1))) / 10);
  const marginFor = (n) => (n <= CAMPAIGN ? MARGIN : Math.max(0.12, MARGIN - 0.004 * (n - CAMPAIGN)));

  // Adds the enemy (and the boss) to a layout so the smart autopilot with the expected upgrades wins with margin m:
  // strength / (army + boss HP) = 1 + m. Returns null when the layout doesn't make a fair level: the smart run
  // doesn't reach the finish, a gate pair is a near tie, or the dumb run (always the worse side) would win.
  function sizeEnemy(layout, u, m) {
    const n = layout.num;
    const probe = { ...layout, enemy: { count: 0, power: 1 }, boss: null };
    const smart = autoplay(probe, u, 'best');
    if (smart.run.status !== 'battle' || smart.ties > 0) return null;
    const S = strength(smart.run);
    if (S < 15) return null;
    const budget = S / (1 + m);
    const boss = isBossLevel(n) ? { hp: Math.max(1, Math.round(budget * BOSS_SHARE)) } : null;
    const pe = enemyPower(n);
    const count = Math.max(1, Math.round((budget - (boss ? boss.hp : 0)) / pe));
    const def = { ...layout, enemy: { count, power: pe }, boss };
    const dumb = autoplay(def, u, 'worst').run;
    if (finishBattle(dumb).won) return null;
    return def;
  }

  const levelMemo = new Map();
  function makeLevel(n) {
    const u = expectedUpgrades(n);
    if (n <= HAND.length) {
      const def = sizeEnemy({ num: n, obstacles: [], platforms: [], recruits: [], ...HAND[n - 1] }, u, MARGIN);
      if (!def) throw new Error(`hand-written level ${n} is unfair`);
      return def;
    }
    let def = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !def; attempt++) {
      const rnd = rng(n * LEVEL_SEED + attempt * 104729);
      const m = Math.max(0.1, marginFor(n) + (rnd() - 0.5) * MARGIN_JITTER);
      def = sizeEnemy(genLayout(n, rnd, u), u, m);
    }
    if (!def) throw new Error(`level ${n}: no fair layout`);
    return def;
  }

  // Level definition by number (1-based). Deterministic; returns a fresh copy each time.
  function levelDef(n) {
    if (!Number.isInteger(n) || n < 1 || n > MAX_LEVEL) throw new Error(`bad level ${n}`);
    if (!levelMemo.has(n)) levelMemo.set(n, JSON.stringify(makeLevel(n)));
    return JSON.parse(levelMemo.get(n));
  }

  const api = {
    HZ, TICK, MAX_DT, SPEED, STEER, BASE_COUNT, BASE_POWER, MAX_COUNT, FALL_RATE, EPS,
    UPGRADES, MAX_UPGRADE, START_PER_LEVEL, WEAPON_PER_LEVEL, SHIELD_PER_LEVEL, OPS, KINDS, KIND_RATE,
    radius, overlap, spanOverlap, parseLevel, cleanUpgrades, shieldMul, newRun, applyOp, gateSide,
    obstacleLoss, platformX, platformAt, uncovered, step, progress, strength,
    finishBattle, COIN_PER_LEVEL, INCOME_PER_LEVEL, PRICE_BASE, PRICE_GROWTH, SAVE_KEY, MAX_LEVEL, MAX_COINS,
    price, reward, newSave, parseSave, loadSave, storeSave, nextPrice, buy, cheapest, record, bank,
    levelStars, totalStars, STAR_SHARES, par, starsFor,
    LEVEL_SEED, BOSS_EVERY, BOSS_SHARE, MARGIN, CAMPAIGN, TIE, rng, expectedUpgrades, pilotTarget, autoplay,
    enemyPower, levelDef, isBossLevel, RECRUIT_REACH, obstacleSpan, crossTime, reaches,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RushCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
