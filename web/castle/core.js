// Последняя крепость — pure rules for the side-view castle defence. No DOM, so the same file runs in the browser
// and in Node (tests and the balance bots). Units are metres and seconds. The ground is y = 0; the castle wall
// stands at x ∈ [0, WALL_X] with its top at WALL_TOP; the archer shoots from ARCHER. Enemies come from the right
// (SPAWN_X) and walk left; arrows fly on parabolas. The world advances in fixed ticks of 1/60 s.
(function (root) {
  'use strict';

  const TICK = 1 / 60;
  const MAX_DT = 0.25;              // step() simulates at most this much per call (a slow frame doesn't explode)
  const WALL_X = 3, WALL_TOP = 8;
  const ARCHER = { x: 2, y: 9.5 };
  const SPAWN_X = 60;
  const G = 9.8;                    // gravity, m/s²
  const V_BASE = 30;                // arrow speed at full power before upgrades, m/s
  const MIN_POWER = 0.2;
  // Down to −85°: the archer stands above the wall and must be able to shoot almost straight down at enemies at
  // its foot (at −30° nothing closer than ~15 m could be hit).
  const ANGLE_MIN = -85 * Math.PI / 180, ANGLE_MAX = 80 * Math.PI / 180;
  const RELOAD_BASE = 0.6;          // seconds between shots
  const RELOAD_FLOOR = 0.4;         // reload never drops under 40 % of the base
  const DAMAGE_BASE = 1;
  const SPREAD = 4 * Math.PI / 180; // multishot: extra arrows fan out by this much each
  const SHIELD_ANGLE = 35;          // degrees below horizontal: shallower hits on a shield do a quarter
  const SHIELD_FACTOR = 0.25;
  const BURN_TIME = 3, BURN_DPS = 1;
  const WALL_HP = 100;
  const WARD_START = 1;

  // Enemy kinds. hp / speed get the wave's multipliers; w × h is the hit box; wall is wall damage per second.
  const KINDS = {
    grunt: { hp: 3, speed: 1.6, w: 0.8, h: 1.7, wall: 1, gold: 2 },
    shield: { hp: 4, speed: 1.2, w: 1.0, h: 1.8, wall: 1, gold: 3 },
    flyer: { hp: 2, speed: 2.4, w: 0.9, h: 0.6, wall: 1, gold: 3, flies: true },
    ram: { hp: 18, speed: 0.7, w: 2.6, h: 1.6, wall: 4, gold: 8 },
    boss: { hp: 60, speed: 0.6, w: 2.2, h: 3.2, wall: 6, gold: 40 },
  };
  const BOSS_HP_STEP = 12;          // boss HP = 60 + 12·bossIndex (bossIndex = wave / 10)
  const CAMPAIGN_WAVES = 30;
  const NO_DAMAGE_BONUS = 5;        // gold for a wave the wall came through untouched (+ the wave number)
  const BOSS_SUMMON = 3;            // grunts the boss calls at half HP

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  // mulberry32: the run carries its generator state, so a saved run continues the same way.
  function rand(run) {
    run.rng = (run.rng + 0x6D2B79F5) >>> 0;
    let t = run.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ── Run ──
  // status: 'ready' (before the first wave) | 'wave' | 'between' | 'lost' | 'won'
  function newRun(mode = 'campaign', seed = 1) {
    if (mode !== 'campaign' && mode !== 'endless') throw new Error(`bad mode ${mode}`);
    const s = finite(seed) ? Math.floor(seed) >>> 0 : 1;
    return {
      v: 1, mode, seed: s, rng: s, wave: 0, status: 'ready',
      wallHp: WALL_HP, wallMax: WALL_HP, gold: 0, kills: 0, damageThisWave: 0,
      aim: { angle: 0.6, power: 0.7 }, firing: false, cooldown: 0,
      ward: WARD_START, up: { power: 0, reload: 0, velocity: 0, pierce: 0, multi: 0, fire: 0, ward: 0 },
      arrows: [], enemies: [], queue: [], t: 0, acc: 0, nextId: 1, events: [],
      mult: { hp: 1, speed: 1 }, offer: [], picked: false, bought: { repair: 0, fortify: 0 },
    };
  }

  // Derived numbers from the upgrades.
  function stats(run) {
    const u = run.up;
    return {
      damage: DAMAGE_BASE * (1 + 0.2 * u.power),
      reload: Math.max(RELOAD_BASE * RELOAD_FLOOR, RELOAD_BASE * (1 - 0.12 * u.reload)),
      vmax: V_BASE * (1 + 0.1 * u.velocity),
      pierce: u.pierce,
      arrows: 1 + u.multi,
      burn: u.fire > 0,
      wardMax: WARD_START + u.ward,
    };
  }

  // Aim: angle in radians (clamped to −85°…80°), power 0.2…1 of the max speed. Bad numbers are ignored.
  function aim(run, angle, power) {
    if (finite(angle)) run.aim.angle = clamp(angle, ANGLE_MIN, ANGLE_MAX);
    if (finite(power)) run.aim.power = clamp(power, MIN_POWER, 1);
  }

  // Hold to fire: while firing the bow shoots at the reload rate; the first arrow goes when the current
  // cooldown ends. Only during a wave.
  function setFiring(run, on) {
    run.firing = run.status === 'wave' && !!on;
  }

  // ── Enemies ──
  // An enemy: { id, kind, x (middle), y (bottom), w, h, hp, maxHp, speed, wall, gold, atWall, burn, summoned,
  //             alt (flyers: cruising height), phase }
  function spawn(run, kind, opts = {}) {
    const k = KINDS[kind];
    if (!k) throw new Error(`bad enemy kind ${kind}`);
    const hpMul = finite(opts.hpMul) ? opts.hpMul : run.mult.hp;
    const spMul = finite(opts.speedMul) ? opts.speedMul : run.mult.speed;
    let hp = k.hp;
    if (kind === 'boss') hp += BOSS_HP_STEP * Math.max(0, Math.floor(run.wave / 10));
    hp *= hpMul;
    const e = {
      id: run.nextId++, kind, x: finite(opts.x) ? opts.x : SPAWN_X + k.w / 2, y: 0, w: k.w, h: k.h,
      hp, maxHp: hp, speed: k.speed * spMul, wall: k.wall, gold: k.gold,
      atWall: false, burn: 0, summoned: false, alt: 0, phase: rand(run) * Math.PI * 2, dead: false,
    };
    if (k.flies) {
      e.alt = finite(opts.alt) ? opts.alt : 6 + rand(run) * 4;
      e.y = e.alt;
    }
    run.enemies.push(e);
    return e;
  }

  const frontX = (e) => e.x - e.w / 2;

  // ── Waves ──
  // list: [{ kind, at (seconds after the start), hpMul?, speedMul? }]. Waves come from waveDef (see the wave rules).
  function startWave(run, list) {
    if (run.status !== 'ready' && run.status !== 'between') return false;
    run.wave++;
    run.status = 'wave';
    run.t = 0;
    run.damageThisWave = 0;
    run.ward = stats(run).wardMax;
    run.cooldown = 0;
    const def = list || waveDef(run.wave, run.seed);
    run.mult = { hp: def.hpMul || 1, speed: def.speedMul || 1 };
    const spawns = Array.isArray(def) ? def : def.spawns;
    run.offer = [];
    run.queue = spawns.map((s) => ({ ...s })).sort((a, b) => a.at - b.at);
    run.events.push({ type: 'waveStart', wave: run.wave });
    return true;
  }

  // ── Arrows ──
  function fire(run) {
    const st = stats(run);
    const v = run.aim.power * st.vmax;
    for (let k = 0; k < st.arrows; k++) {
      const a = run.aim.angle + (k - (st.arrows - 1) / 2) * SPREAD;
      run.arrows.push({
        x: ARCHER.x, y: ARCHER.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        damage: st.damage, pierce: st.pierce, fire: st.burn, hits: [],
      });
    }
    run.events.push({ type: 'fire', n: st.arrows });
  }

  // Where along the segment p→q (0..1) it first enters the box, or -1.
  function segmentBox(px, py, qx, qy, x0, y0, x1, y1) {
    let t0 = 0, t1 = 1;
    const dx = qx - px, dy = qy - py;
    for (const [p, d, lo, hi] of [[px, dx, x0, x1], [py, dy, y0, y1]]) {
      if (Math.abs(d) < 1e-12) {
        if (p < lo || p > hi) return -1;
      } else {
        let a = (lo - p) / d, b = (hi - p) / d;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
        if (t0 > t1) return -1;
      }
    }
    return t0;
  }

  // Degrees below horizontal of a flight direction (positive when descending).
  const descent = (vx, vy) => (Math.atan2(-vy, Math.abs(vx)) * 180) / Math.PI;

  function damage(run, e, amount, cause) {
    if (e.dead) return;
    e.hp -= amount;
    run.events.push({ type: 'hit', id: e.id, amount, cause, x: e.x, y: e.y + e.h / 2 });
    if (e.hp <= 1e-9) kill(run, e);
  }

  function kill(run, e) {
    e.dead = true;
    run.gold += e.gold;
    run.kills++;
    run.events.push({ type: 'kill', id: e.id, kind: e.kind, x: e.x, y: e.y, gold: e.gold });
  }

  function arrowHit(run, a, e) {
    let amount = a.damage;
    const angle = descent(a.vx, a.vy);
    if (e.kind === 'shield' && a.vx > 0 && angle < SHIELD_ANGLE) {
      amount *= SHIELD_FACTOR;
      run.events.push({ type: 'shieldHit', id: e.id, x: frontX(e), y: e.y + e.h / 2 });
    }
    if (a.fire) e.burn = BURN_TIME;
    damage(run, e, amount, 'arrow');
  }

  function stepArrows(run) {
    const live = [];
    for (const a of run.arrows) {
      const px = a.x, py = a.y;
      a.vy -= G * TICK;
      a.x += a.vx * TICK;
      a.y += a.vy * TICK;
      // hits along this tick's segment, nearest first
      const hits = [];
      for (const e of run.enemies) {
        if (e.dead || a.hits.includes(e.id)) continue;
        const t = segmentBox(px, py, a.x, a.y, e.x - e.w / 2, e.y, e.x + e.w / 2, e.y + e.h);
        if (t >= 0) hits.push([t, e]);
      }
      hits.sort((p, q) => p[0] - q[0]);
      let gone = false;
      for (const [t, e] of hits) {
        a.hits.push(e.id);
        arrowHit(run, a, e);
        if (a.hits.length > a.pierce) {
          run.events.push({ type: 'stick', x: px + (a.x - px) * t, y: py + (a.y - py) * t, id: e.id });
          gone = true;
          break;
        }
      }
      if (gone) continue;
      if (a.y <= 0) {
        run.events.push({ type: 'ground', x: a.x, vx: a.vx, vy: a.vy });
        continue;
      }
      if (a.x > SPAWN_X + 20 || a.x < -10) continue;
      live.push(a);
    }
    run.arrows = live;
  }

  function stepEnemies(run) {
    for (const e of run.enemies) {
      if (e.dead) continue;
      if (e.burn > 0) {
        e.burn = Math.max(0, e.burn - TICK);
        damage(run, e, BURN_DPS * TICK, 'fire');
        if (e.dead) continue;
      }
      if (e.kind === 'boss' && !e.summoned && e.hp <= e.maxHp / 2) {
        e.summoned = true;
        for (let k = 0; k < BOSS_SUMMON; k++) spawn(run, 'grunt', { x: e.x + 1.5 + k * 1.2 });
        run.events.push({ type: 'summon', id: e.id, n: BOSS_SUMMON });
      }
      if (KINDS[e.kind].flies) {
        e.phase += TICK * 3;
        e.y = e.alt + Math.sin(e.phase) * 0.6;
      }
      const stop = WALL_X + e.w / 2;
      if (!e.atWall) {
        e.x -= e.speed * TICK;
        if (e.x <= stop) {
          e.x = stop;
          if (KINDS[e.kind].flies && run.ward > 0) {
            run.ward--;
            run.events.push({ type: 'ward', id: e.id, x: e.x, y: e.y });
            e.dead = true;
            run.kills++;
            run.gold += e.gold;
            run.events.push({ type: 'kill', id: e.id, kind: e.kind, x: e.x, y: e.y, gold: e.gold });
            continue;
          }
          e.atWall = true;
        }
      }
      if (e.atWall) {
        const d = e.wall * TICK;
        run.wallHp = Math.max(0, run.wallHp - d);
        run.damageThisWave += d;
        e.hitT = (e.hitT || 0) + TICK;
        if (e.hitT >= 1) { e.hitT -= 1; run.events.push({ type: 'wallHit', id: e.id, kind: e.kind }); }
      }
    }
    run.enemies = run.enemies.filter((e) => !e.dead);
  }

  function tick(run) {
    if (run.status !== 'wave') return;
    run.t += TICK;
    while (run.queue.length && run.queue[0].at <= run.t + 1e-9) {
      const s = run.queue.shift();
      spawn(run, s.kind, s);
    }
    run.cooldown = Math.max(0, run.cooldown - TICK);
    if (run.firing && run.cooldown <= 1e-9) {
      fire(run);
      run.cooldown = stats(run).reload;
    }
    stepArrows(run);
    stepEnemies(run);
    if (run.wallHp <= 0) {
      run.status = 'lost';
      run.firing = false;
      run.events.push({ type: 'lost', wave: run.wave });
      return;
    }
    if (!run.queue.length && !run.enemies.length) clearWave(run);
  }

  // The wave is over: a bonus for a wall without a scratch, then the break with three upgrades to pick from.
  function clearWave(run) {
    run.arrows = [];
    run.firing = false;
    const noDamage = run.damageThisWave === 0;
    const bonus = noDamage ? NO_DAMAGE_BONUS + run.wave : 0;
    run.gold += bonus;
    run.status = run.mode === 'campaign' && run.wave >= CAMPAIGN_WAVES ? 'won' : 'between';
    run.picked = false;
    run.offer = run.status === 'between' ? offerUpgrades(run) : [];
    run.events.push({ type: 'waveClear', wave: run.wave, noDamage, bonus });
  }

  // Advances the world by dt seconds in fixed ticks (at most MAX_DT per call). Bad dt is ignored.
  function step(run, dt) {
    if (!finite(dt) || dt <= 0) return;
    run.acc += Math.min(dt, MAX_DT);
    while (run.acc >= TICK - 1e-9) {
      run.acc -= TICK;
      tick(run);
    }
  }

  // The events since the last call (fire, hit, shieldHit, kill, stick, ground, ward, wallHit, summon,
  // waveStart, waveClear, lost); the list is emptied.
  function drain(run) {
    const ev = run.events;
    run.events = [];
    return ev;
  }

  const status = (run) => run.status;

  // Where an arrow shot with (angle, power) is after t seconds — for the preview arc and the bots.
  function flight(run, angle, power, t) {
    const v = clamp(power, MIN_POWER, 1) * stats(run).vmax;
    return { x: ARCHER.x + Math.cos(angle) * v * t, y: ARCHER.y + Math.sin(angle) * v * t - (G * t * t) / 2 };
  }


  // ── Waves ──
  // waveDef(n, seed) → { spawns: [{ kind, at }], hpMul, speedMul }. Waves 1–3 teach (grunts, then shields, then
  // flyers); after that a budget grows by BUDGET_GROWTH per wave and buys the enemy types unlocked so far. At most
  // MAX_ENEMIES per wave: budget beyond that makes the wave's enemies tougher and faster instead. Past wave 30 the
  // budget grows by ENDLESS_GROWTH. Every 10th wave
  // brings the boss with an escort. Deterministic in (n, seed); the endless mode uses the same waves past 30.
  const MAX_ENEMIES = 40;
  const BUDGET_START = 9, BUDGET_GROWTH = 1.12;
  const ENDLESS_GROWTH = 1.16;      // past the campaign's 30 waves the budget grows faster, so endless always ends
  const COST = { grunt: 1, shield: 1.5, flyer: 1.4, ram: 5 };
  const UNLOCK = { grunt: 1, shield: 2, flyer: 3, ram: 5 };
  const WEIGHT = { grunt: 5, shield: 3, flyer: 2.5, ram: 1.2 };

  function waveRng(seed, n) {
    const r = { rng: ((seed >>> 0) ^ Math.imul(n, 0x9E3779B1)) >>> 0 };
    return () => rand(r);
  }

  const budgetOf = (n) => BUDGET_START * BUDGET_GROWTH ** (Math.min(n, CAMPAIGN_WAVES) - 1) *
    ENDLESS_GROWTH ** Math.max(0, n - CAMPAIGN_WAVES);

  function waveDef(n, seed = 1) {
    if (!Number.isInteger(n) || n < 1) throw new Error(`bad wave ${n}`);
    const r = waveRng(seed, n);
    const spawns = [];
    const gap = Math.max(0.4, 1.9 - n * 0.04);
    let at = 1;
    const add = (kind) => { spawns.push({ kind, at: Math.round(at * 100) / 100 }); at += gap * (0.6 + r() * 0.8); };
    if (n === 1) { for (let k = 0; k < 6; k++) add('grunt'); return { spawns, hpMul: 1, speedMul: 1 }; }
    if (n === 2) { ['grunt', 'grunt', 'shield', 'grunt', 'shield', 'grunt', 'shield'].forEach(add); return { spawns, hpMul: 1, speedMul: 1 }; }
    if (n === 3) { ['grunt', 'flyer', 'grunt', 'flyer', 'shield', 'flyer', 'grunt', 'flyer'].forEach(add); return { spawns, hpMul: 1, speedMul: 1 }; }
    let budget = budgetOf(n);
    const boss = n % 10 === 0;
    if (boss) { spawns.push({ kind: 'boss', at: 3 }); budget *= 0.6; }
    const kinds = Object.keys(COST).filter((k) => n >= UNLOCK[k]);
    let spent = 0;
    while (spawns.length < MAX_ENEMIES) {
      const left = budget - spent;
      const can = kinds.filter((k) => COST[k] <= left + 1e-9);
      if (!can.length) break;
      const total = can.reduce((a, k) => a + WEIGHT[k], 0);
      let x = r() * total, kind = can[can.length - 1];
      for (const k of can) { x -= WEIGHT[k]; if (x <= 0) { kind = k; break; } }
      add(kind);
      spent += COST[kind];
    }
    // only a full wave turns the leftover budget into toughness; a few points short of one more enemy are dropped
    const extra = spawns.length >= MAX_ENEMIES ? Math.max(0, budget - spent) / Math.max(1, spent) : 0;
    return {
      spawns: spawns.sort((a, b) => a.at - b.at),
      hpMul: Math.round((1 + extra) * 1000) / 1000,
      speedMul: Math.round(Math.min(1.5, 1 + extra * 0.25) * 1000) / 1000,
    };
  }

  // ── Upgrades and the shop ──
  // Additive stacks with caps; a capped upgrade is no longer offered.
  const UPGRADES = ['power', 'reload', 'velocity', 'pierce', 'multi', 'fire', 'ward'];
  const UP_CAP = { power: Infinity, reload: 5, velocity: 5, pierce: 3, multi: 3, fire: 1, ward: 2 };
  const PRICE = { repair: { base: 30, growth: 1.3 }, fortify: { base: 50, growth: 1.4 } };
  const REPAIR_SHARE = 0.25, FORTIFY_SHARE = 0.2;

  const capped = (run, id) => run.up[id] >= UP_CAP[id];

  // Three different upgrades (fewer when most are capped), drawn from the run's own generator.
  function offerUpgrades(run) {
    const pool = UPGRADES.filter((id) => !capped(run, id));
    const out = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(rand(run) * pool.length), 1)[0]);
    return out;
  }

  // Takes one of the offered upgrades; one pick per break. Returns true when applied.
  function chooseUpgrade(run, id) {
    if (run.status !== 'between' || run.picked || !run.offer.includes(id) || capped(run, id)) return false;
    run.up[id]++;
    run.picked = true;
    if (id === 'ward') run.ward = stats(run).wardMax;
    return true;
  }

  const priceOf = (run, item) => Math.round(PRICE[item].base * PRICE[item].growth ** run.bought[item]);
  const prices = (run) => ({ repair: priceOf(run, 'repair'), fortify: priceOf(run, 'fortify') });

  // Repair or fortify the wall between waves → 'ok' | 'nogold' | 'full' | 'closed' | 'unknown'.
  function buy(run, item) {
    if (!Object.prototype.hasOwnProperty.call(PRICE, item)) return 'unknown';
    if (run.status !== 'between' && run.status !== 'ready') return 'closed';
    if (item === 'repair' && run.wallHp >= run.wallMax) return 'full';
    const price = priceOf(run, item);
    if (run.gold < price) return 'nogold';
    run.gold -= price;
    run.bought[item]++;
    if (item === 'repair') {
      run.wallHp = Math.min(run.wallMax, run.wallHp + run.wallMax * REPAIR_SHARE);
    } else {
      const add = run.wallMax * FORTIFY_SHARE;
      run.wallMax += add;
      run.wallHp += add;
    }
    return 'ok';
  }

  // Endless score: 10 per kill and 100 per wave before the current one (an endless run ends in its last wave).
  const score = (run) => run.kills * 10 + Math.max(0, run.wave - 1) * 100;

  // ── Snapshots ──
  // A run between waves (or before the first) as plain data: everything the next wave needs, with the drawn
  // offer and the generator state. A wave in progress is not saved: the client snapshots right before startWave,
  // so a reload restarts that wave the same way.
  const SNAP_FIELDS = ['v', 'mode', 'seed', 'rng', 'wave', 'status', 'wallHp', 'wallMax', 'gold', 'kills', 'aim', 'ward',
    'up', 'offer', 'picked', 'bought'];

  function snapshot(run) {
    const o = {};
    for (const k of SNAP_FIELDS) o[k] = JSON.parse(JSON.stringify(run[k]));
    return o;
  }

  const num = (v, lo, hi) => finite(v) && v >= lo && v <= hi;

  // A run from a snapshot, or null when it doesn't look right.
  function restore(o) {
    if (!o || typeof o !== 'object' || o.v !== 1) return null;
    if (o.mode !== 'campaign' && o.mode !== 'endless') return null;
    if (!['ready', 'between', 'won', 'lost'].includes(o.status)) return null;
    if (!Number.isInteger(o.wave) || o.wave < 0 || o.wave > 100000) return null;
    if (!num(o.wallMax, 1, 1e7) || !num(o.wallHp, 0, o.wallMax) || !num(o.gold, 0, 1e9) || !num(o.kills, 0, 1e9)) return null;
    if (!Number.isInteger(o.seed) || !Number.isInteger(o.rng)) return null;
    if (!o.up || typeof o.up !== 'object' || !UPGRADES.every((k) => Number.isInteger(o.up[k]) && o.up[k] >= 0 && o.up[k] <= Math.min(UP_CAP[k], 1000))) return null;
    if (!Array.isArray(o.offer) || !o.offer.every((id) => UPGRADES.includes(id)) || o.offer.length > 3) return null;
    if (!o.bought || !Number.isInteger(o.bought.repair) || !Number.isInteger(o.bought.fortify)) return null;
    const run = newRun(o.mode, o.seed);
    for (const k of SNAP_FIELDS) run[k] = JSON.parse(JSON.stringify(o[k]));
    run.picked = !!o.picked;
    run.ward = Number.isInteger(o.ward) ? Math.max(0, Math.min(o.ward, stats(run).wardMax)) : stats(run).wardMax;
    if (!o.aim || !finite(o.aim.angle) || !finite(o.aim.power)) run.aim = { angle: 0.6, power: 0.7 };
    aim(run, run.aim.angle, run.aim.power);
    return run;
  }

  // ── Save ──
  // castle.save: { v: 1, campaignBest (waves cleared), campaignDone, endlessBest (score), current: snapshot | null }
  const SAVE_KEY = 'castle.save';
  const newSave = () => ({ v: 1, campaignBest: 0, campaignDone: false, endlessBest: 0, current: null });

  function parseSave(raw) {
    const out = newSave();
    if (typeof raw !== 'string') return out;
    let d;
    try { d = JSON.parse(raw); } catch { return out; }
    if (!d || typeof d !== 'object' || d.v !== 1) return out;
    if (Number.isInteger(d.campaignBest) && d.campaignBest >= 0 && d.campaignBest <= CAMPAIGN_WAVES) out.campaignBest = d.campaignBest;
    out.campaignDone = d.campaignDone === true;
    if (Number.isInteger(d.endlessBest) && d.endlessBest >= 0 && d.endlessBest < 1e9) out.endlessBest = d.endlessBest;
    out.current = restore(d.current) ? d.current : null;
    return out;
  }

  function loadSave(storage) {
    let raw = null;
    try { raw = storage ? storage.getItem(SAVE_KEY) : null; } catch { raw = null; }
    return parseSave(raw);
  }

  function storeSave(storage, save) {
    try {
      if (!storage) return false;
      storage.setItem(SAVE_KEY, JSON.stringify(save));
      return true;
    } catch {
      return false;
    }
  }

  // Folds a run into the records: campaign waves cleared and completion, endless best score. Returns true when
  // a record improved.
  function recordRun(save, run) {
    let better = false;
    if (run.mode === 'campaign') {
      const cleared = run.status === 'wave' || run.status === 'lost' ? run.wave - 1 : run.wave;
      if (cleared > save.campaignBest) { save.campaignBest = Math.min(CAMPAIGN_WAVES, cleared); better = true; }
      if (run.status === 'won' && !save.campaignDone) { save.campaignDone = true; better = true; }
    } else {
      const sc = score(run);
      if (sc > save.endlessBest) { save.endlessBest = sc; better = true; }
    }
    return better;
  }

  const api = {
    TICK, MAX_DT, WALL_X, WALL_TOP, ARCHER, SPAWN_X, G, V_BASE, MIN_POWER, ANGLE_MIN, ANGLE_MAX, RELOAD_BASE,
    RELOAD_FLOOR, DAMAGE_BASE, SPREAD, SHIELD_ANGLE, SHIELD_FACTOR, BURN_TIME, BURN_DPS, WALL_HP, WARD_START, KINDS,
    BOSS_HP_STEP, BOSS_SUMMON, CAMPAIGN_WAVES, NO_DAMAGE_BONUS, MAX_ENEMIES, BUDGET_START, BUDGET_GROWTH, ENDLESS_GROWTH, COST, UNLOCK,
    UPGRADES, UP_CAP, PRICE, REPAIR_SHARE, FORTIFY_SHARE, SAVE_KEY,
    clamp, rand, newRun, stats, aim, setFiring, spawn, startWave, step, drain, status, flight, segmentBox, descent,
    waveDef, budgetOf, offerUpgrades, chooseUpgrade, prices, buy, score, snapshot, restore,
    newSave, parseSave, loadSave, storeSave, recordRun,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CastleCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
