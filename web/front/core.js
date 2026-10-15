// Рубеж — pure rules for the side-view build & defend game. No DOM, so the same file runs in the browser and in
// Node (tests and the balance bots). The world is a line x ∈ [0, L] in metres: the player's keep on the left, the
// enemy fortress on the right. The level string gives 4 m per character: ground, chasms, forest, quarry, mine and
// build plots. Workers carry wood, stone and metal to the keep; the player builds and recruits; enemy waves come
// on a schedule; the army takes the fortress. The world advances in fixed ticks of 1/20 s.
(function (root) {
  'use strict';

  const TICK = 1 / 20;
  const MAX_DT = 0.25;
  const CELL = 4;                    // metres per level character
  const KEEP_X = 6;                  // the keep spans 0…KEEP_X; workers unload at its door
  const FORT_W = 8;                  // the fortress spans L − FORT_W … L
  const KEEP_HP = 400;
  const KEEP_SHOT = { range: 14, dmg: 4, interval: 1.5 };
  const FORT_SHOT = { range: 20, dmg: 8, interval: 1.5 };
  const GATHER = { time: 3, load: 10 };
  const NODE_SLOTS = 2;              // workers a resource node serves at once
  const WORKER_BASE = 3, HOUSE_WORKERS = 3, START_WORKERS = 2;
  const ARMY_CAP = 30;
  const PATROL = { every: 40, growth: 1.15 };
  const CHASM_SLOW = 0.4;            // enemies climb through an open chasm at this share of their speed
  const SPREAD = 0.1;                // ±10% damage spread
  const RES = ['wood', 'stone', 'metal'];
  const NODE_RES = { T: 'wood', S: 'stone', M: 'metal' };

  // Buildings on plots (the bridge goes over a chasm, per 4 m segment).
  const BUILD = {
    bridge: { cost: { wood: 30 }, time: 4 },
    house: { cost: { wood: 30 }, time: 6, hp: 150 },
    wall: { cost: { wood: 30, stone: 10 }, time: 8, hp: 400 },
    tower: { cost: { wood: 50, stone: 40 }, time: 10, hp: 250, range: 22, dmg: 12, interval: 1 },
    barracks: { cost: { wood: 60, stone: 30 }, time: 10, hp: 250 },
    forge: { cost: { stone: 40, metal: 40 }, time: 12, hp: 250 },
  };
  const STONE_WALL = { cost: { stone: 60 }, time: 8, hp: 1000 };

  // Units. need: the building that unlocks them. siege: damage multiplier against the fortress and walls.
  const UNITS = {
    worker: { cost: { wood: 15 }, time: 4, hp: 20, dmg: 2, range: 1, interval: 1, speed: 3 },
    soldier: { cost: { wood: 20, metal: 10 }, time: 6, hp: 60, dmg: 8, range: 1.2, interval: 1, speed: 1.4, need: 'barracks' },
    archer: { cost: { wood: 25, metal: 5 }, time: 6, hp: 35, dmg: 6, range: 16, interval: 1.2, speed: 1.4, need: 'barracks' },
    knight: { cost: { metal: 30 }, time: 9, hp: 140, dmg: 14, range: 1.3, interval: 1, speed: 1.6, need: 'forge', siege: 1.5 },
    catapult: { cost: { wood: 80, metal: 40 }, time: 12, hp: 80, dmg: 30, range: 24, interval: 3, speed: 0.8, need: 'forge', siege: 4 },
  };
  const FORGE_BONUS = 0.25; // soldiers hit 25% harder once a forge stands

  const ENEMIES = {
    raider: { hp: 40, dmg: 5, range: 1.2, interval: 1, speed: 2.2 },
    brute: { hp: 140, dmg: 14, range: 1.3, interval: 1.4, speed: 1.1 },
    slinger: { hp: 35, dmg: 6, range: 14, interval: 1.6, speed: 1.6 },
    ogre: { hp: 600, dmg: 30, range: 1.6, interval: 2, speed: 0.8, wall: 3 },
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function rand(g) {
    g.rng = (g.rng + 0x6D2B79F5) >>> 0;
    let t = g.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ── Levels ──
  // def: { name, map, start: {wood, stone, metal}, waves: [{ at, units: {kind: n} }], fortressHp, towers, par }
  function parseLevel(def) {
    if (!def || typeof def.map !== 'string') throw new Error('level: no map');
    const map = def.map;
    if (!/^[._TSM#]+$/.test(map)) throw new Error('level: bad map characters');
    if (map.length < 20 || map.length > 80) throw new Error('level: map length');
    if (map[0] !== '.' || map[1] !== '.' || map[map.length - 1] !== '.' || map[map.length - 2] !== '.') {
      throw new Error('level: the keep and the fortress stand on ground');
    }
    const L = map.length * CELL;
    const plots = [], chasms = [], nodes = [];
    for (let i = 0; i < map.length; i++) {
      const c = map[i], x = i * CELL + CELL / 2;
      if (c === '#') plots.push({ x });
      else if (NODE_RES[c]) nodes.push({ x, res: NODE_RES[c] });
      else if (c === '_') {
        const last = chasms[chasms.length - 1];
        if (last && last.i1 === i - 1) { last.i1 = i; last.x1 = (i + 1) * CELL; last.segments++; }
        else chasms.push({ i0: i, i1: i, x0: i * CELL, x1: (i + 1) * CELL, segments: 1 });
      }
    }
    const start = {};
    for (const r of RES) start[r] = Math.max(0, Math.floor((def.start && def.start[r]) || 0));
    const waves = Array.isArray(def.waves) ? def.waves.map((w) => {
      if (!finite(w.at) || w.at < 0 || !w.units) throw new Error('level: bad wave');
      for (const k of Object.keys(w.units)) if (!has(ENEMIES, k)) throw new Error(`level: unknown enemy ${k}`);
      return { at: w.at, units: Object.assign({}, w.units) };
    }).sort((a, b) => a.at - b.at) : [];
    if (!finite(def.fortressHp) || def.fortressHp <= 0) throw new Error('level: fortress hp');
    return {
      name: def.name || '', map, L, plots, chasms: chasms.map(({ x0, x1, segments }) => ({ x0, x1, segments })), nodes,
      start, waves, fortressHp: def.fortressHp, towers: Math.max(0, def.towers | 0), par: finite(def.par) ? def.par : 300,
      armor: finite(def.armor) ? clamp(def.armor, 0, 0.95) : 0,
    };
  }

  // ── Game ──
  function newGame(level, seed = 1) {
    const lv = level.L ? level : parseLevel(level);
    const s = finite(seed) ? Math.floor(seed) >>> 0 : 1;
    const g = {
      v: 1, seed: s, rng: s, L: lv.L, t: 0, acc: 0, status: 'playing',
      res: Object.assign({}, lv.start),
      keep: { hp: KEEP_HP, maxHp: KEEP_HP, cd: 0 },
      fort: { hp: lv.fortressHp, maxHp: lv.fortressHp, towers: lv.towers, armor: lv.armor, cd: 0 },
      plots: lv.plots.map((p) => ({ x: p.x, b: null })),
      chasms: lv.chasms.map((c) => ({ x0: c.x0, x1: c.x1, segments: c.segments, built: 0, bridged: false, work: 0, busy: false })),
      nodes: lv.nodes.map((n) => ({ x: n.x, res: n.res })),
      units: [], foes: [], queue: [], trainT: 0, nextId: 1,
      alloc: { wood: 0, stone: 0, metal: 0 },
      order: 'hold',
      waves: lv.waves.map((w) => ({ at: w.at, units: Object.assign({}, w.units), sent: false })),
      spawnQ: [], patrolT: 0, patrols: 0, par: lv.par,
      events: [],
    };
    for (let i = 0; i < START_WORKERS; i++) addUnit(g, 'worker', KEEP_X);
    return g;
  }

  function addUnit(g, kind, x) {
    const u = UNITS[kind];
    const unit = { id: g.nextId++, kind, x, hp: u.hp, maxHp: u.hp, cd: rand(g) * u.interval, task: null };
    if (kind === 'worker') Object.assign(unit, { res: null, phase: 'idle', node: -1, load: 0, work: 0 });
    g.units.push(unit);
    return unit;
  }

  function addFoe(g, kind) {
    const e = ENEMIES[kind];
    const foe = { id: g.nextId++, kind, x: g.L - FORT_W - 1, hp: e.hp, maxHp: e.hp, cd: rand(g) * e.interval };
    g.foes.push(foe);
    return foe;
  }

  const status = (g) => g.status;

  function drain(g) {
    const ev = g.events;
    g.events = [];
    return ev;
  }

  // ── Map queries ──
  // The first chasm that isn't bridged blocks the player's units (and so the workers' reach).
  function frontier(g) {
    for (const c of g.chasms) if (!c.bridged) return c.x0;
    return g.L;
  }
  const chasmAt = (g, x) => g.chasms.find((c) => !c.bridged && x > c.x0 && x < c.x1) || null;
  const plotOf = (g, kind) => g.plots.filter((p) => p.b && p.b.id === kind && p.b.done);
  const hasBuilding = (g, kind) => plotOf(g, kind).length > 0;
  const workerCap = (g) => WORKER_BASE + HOUSE_WORKERS * plotOf(g, 'house').length;
  const count = (g, kind) => g.units.filter((u) => u.kind === kind).length + g.queue.filter((q) => q === kind).length;
  const armySize = (g) => g.units.filter((u) => u.kind !== 'worker').length + g.queue.filter((q) => q !== 'worker').length;

  function reachableNodes(g, res) {
    const lim = frontier(g);
    return g.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.res === res && n.x < lim);
  }

  // ── Economy ──
  const afford = (g, cost) => RES.every((r) => (g.res[r] || 0) >= (cost[r] || 0));
  const pay = (g, cost) => { for (const r of RES) g.res[r] -= cost[r] || 0; };
  const missing = (g, cost) => {
    const m = {};
    for (const r of RES) if ((cost[r] || 0) > (g.res[r] || 0)) m[r] = cost[r] - (g.res[r] || 0);
    return m;
  };

  // Desired workers per resource; the rest go to wood.
  function setAlloc(g, res, n) {
    if (!RES.includes(res) || !finite(n)) return false;
    g.alloc[res] = clamp(Math.floor(n), 0, 99);
    return true;
  }

  // Which resource each worker gathers: the first alloc.wood workers wood, then stone, then metal; the rest wood.
  // A resource with no reachable node falls back to wood.
  function assignWorkers(g) {
    const workers = g.units.filter((u) => u.kind === 'worker');
    const want = [];
    for (const r of RES) for (let k = 0; k < g.alloc[r]; k++) want.push(r);
    workers.forEach((w, i) => {
      let r = want[i] || 'wood';
      if (!reachableNodes(g, r).length) r = 'wood';
      if (w.res !== r) { w.res = r; if (w.phase === 'go' || w.phase === 'work' || w.phase === 'wait') { w.phase = 'idle'; w.node = -1; } }
    });
  }

  function workerTick(g, w) {
    const sp = UNITS.worker.speed * TICK;
    if (w.phase === 'idle') {
      if (w.load > 0) { w.phase = 'back'; return; }
      const list = reachableNodes(g, w.res);
      if (!list.length) { w.x += clamp(KEEP_X - w.x, -sp, sp); return; }
      // the nearest node with a free slot, else the nearest
      const busy = (i) => g.units.filter((u) => u.kind === 'worker' && u.node === i && (u.phase === 'work' || u.phase === 'go')).length;
      list.sort((a, b) => a.n.x - b.n.x);
      const pick = list.find(({ i }) => busy(i) < NODE_SLOTS) || list[0];
      w.node = pick.i;
      w.phase = 'go';
      return;
    }
    if (w.phase === 'go') {
      const n = g.nodes[w.node];
      if (!n || n.x >= frontier(g)) { w.phase = 'idle'; w.node = -1; return; }
      w.x += clamp(n.x - w.x, -sp, sp);
      if (Math.abs(n.x - w.x) < 0.01) {
        const working = g.units.filter((u) => u !== w && u.kind === 'worker' && u.node === w.node && u.phase === 'work').length;
        w.phase = working < NODE_SLOTS ? 'work' : 'wait';
        w.work = 0;
      }
      return;
    }
    if (w.phase === 'wait') {
      const working = g.units.filter((u) => u.kind === 'worker' && u.node === w.node && u.phase === 'work').length;
      if (working < NODE_SLOTS) { w.phase = 'work'; w.work = 0; }
      return;
    }
    if (w.phase === 'work') {
      w.work += TICK;
      if (w.work >= GATHER.time - 1e-9) {
        w.load = GATHER.load;
        w.carry = g.nodes[w.node].res;
        w.phase = 'back';
        g.events.push({ type: 'gather', res: w.carry, x: w.x });
      }
      return;
    }
    if (w.phase === 'back') {
      w.x += clamp(KEEP_X - w.x, -sp, sp);
      if (Math.abs(KEEP_X - w.x) < 0.01) {
        g.res[w.carry] += w.load;
        g.events.push({ type: 'deposit', res: w.carry, n: w.load });
        w.load = 0;
        w.carry = null;
        w.phase = 'idle';
        w.node = -1;
      }
    }
  }

  // ── Building ──
  // target: { plot: i } or { chasm: i }. → 'ok' | 'nores' | 'busy' | 'locked' | 'bad'
  function canBuild(g, target, id) {
    if (g.status !== 'playing' || !target) return 'bad';
    if (id === 'bridge') {
      const c = g.chasms[target.chasm];
      if (!c) return 'bad';
      if (c.bridged || c.busy) return 'busy';
      if (c.x0 > frontier(g)) return 'locked'; // only the nearest open chasm can be bridged
      return afford(g, bridgeCost(g, target.chasm)) ? 'ok' : 'nores';
    }
    const p = g.plots[target.plot];
    if (!p) return 'bad';
    if (id === 'stonewall') {
      if (!p.b || p.b.id !== 'wall' || !p.b.done || p.b.stone) return 'bad';
      return afford(g, STONE_WALL.cost) ? 'ok' : 'nores';
    }
    if (!has(BUILD, id) || id === 'bridge') return 'bad';
    if (p.b) return 'busy';
    if (p.x >= frontier(g)) return 'locked';
    return afford(g, BUILD[id].cost) ? 'ok' : 'nores';
  }

  // The whole bridge over a chasm: BUILD.bridge.cost for every 4 m segment still open.
  function bridgeCost(g, ci) {
    const c = g.chasms[ci], left = c ? c.segments - c.built : 0, out = {};
    for (const r of Object.keys(BUILD.bridge.cost)) out[r] = BUILD.bridge.cost[r] * left;
    return out;
  }

  function costOf(id) {
    if (id === 'stonewall') return STONE_WALL.cost;
    return BUILD[id] ? BUILD[id].cost : UNITS[id] ? UNITS[id].cost : null;
  }

  function build(g, target, id) {
    const r = canBuild(g, target, id);
    if (r !== 'ok') return r;
    if (id === 'bridge') {
      const c = g.chasms[target.chasm];
      pay(g, bridgeCost(g, target.chasm));
      c.busy = true;
      c.work = 0;
    } else if (id === 'stonewall') {
      const p = g.plots[target.plot];
      pay(g, STONE_WALL.cost);
      Object.assign(p.b, { done: false, work: 0, need: STONE_WALL.time, stone: true });
    } else {
      const p = g.plots[target.plot];
      pay(g, BUILD[id].cost);
      p.b = { id, done: false, work: 0, need: BUILD[id].time, hp: BUILD[id].hp, maxHp: BUILD[id].hp, cd: 0 };
    }
    g.events.push({ type: 'build', id, target });
    return 'ok';
  }

  function constructTick(g) {
    for (const c of g.chasms) {
      if (!c.busy) continue;
      c.work += TICK;
      if (c.work >= BUILD.bridge.time - 1e-9) {
        // one segment after another until the whole bridge stands
        c.work = 0;
        c.built++;
        g.events.push({ type: 'built', id: 'bridge', x: c.x0 + (c.built - 0.5) * CELL });
        if (c.built >= c.segments) { c.busy = false; c.bridged = true; g.events.push({ type: 'bridged', x0: c.x0 }); }
      }
    }
    for (const p of g.plots) {
      if (!p.b || p.b.done) continue;
      p.b.work += TICK;
      if (p.b.work >= p.b.need - 1e-9) {
        p.b.done = true;
        if (p.b.stone) { p.b.maxHp = STONE_WALL.hp; p.b.hp = STONE_WALL.hp; }
        g.events.push({ type: 'built', id: p.b.stone ? 'stonewall' : p.b.id, x: p.x });
      }
    }
  }

  // ── Recruiting ──
  function canRecruit(g, kind) {
    if (g.status !== 'playing' || !has(UNITS, kind)) return 'bad';
    const u = UNITS[kind];
    if (u.need && !hasBuilding(g, u.need)) return 'locked';
    if (kind === 'worker' ? count(g, 'worker') >= workerCap(g) : armySize(g) >= ARMY_CAP) return 'cap';
    return afford(g, u.cost) ? 'ok' : 'nores';
  }

  function recruit(g, kind) {
    const r = canRecruit(g, kind);
    if (r !== 'ok') return r;
    pay(g, UNITS[kind].cost);
    g.queue.push(kind);
    if (g.queue.length === 1) g.trainT = 0;
    g.events.push({ type: 'queue', kind });
    return 'ok';
  }

  function trainTick(g) {
    if (!g.queue.length) return;
    g.trainT += TICK;
    const kind = g.queue[0];
    if (g.trainT >= UNITS[kind].time - 1e-9) {
      g.queue.shift();
      g.trainT = 0;
      addUnit(g, kind, KEEP_X);
      g.events.push({ type: 'recruit', kind });
    }
  }

  function setOrder(g, order) {
    if (order !== 'hold' && order !== 'attack') return false;
    g.order = order;
    g.events.push({ type: 'order', order });
    return true;
  }

  // ── Combat ──
  const frontWall = (g) => {
    let x = -1;
    for (const p of g.plots) if (p.b && p.b.id === 'wall' && p.b.done && p.x > x) x = p.x;
    return x;
  };
  const hit = (g, dmg) => dmg * (1 + (rand(g) * 2 - 1) * SPREAD);

  function damageFoe(g, f, dmg, by) {
    f.hp -= dmg;
    g.events.push({ type: 'hit', side: 'foe', id: f.id, dmg: Math.round(dmg), by, x: f.x });
    if (f.hp <= 0 && !f.dead) { f.dead = true; g.events.push({ type: 'kill', side: 'foe', id: f.id, kind: f.kind, x: f.x }); }
  }

  function damageUnit(g, u, dmg) {
    u.hp -= dmg;
    g.events.push({ type: 'hit', side: 'own', id: u.id, dmg: Math.round(dmg), x: u.x });
    if (u.hp <= 0 && !u.dead) { u.dead = true; g.events.push({ type: 'kill', side: 'own', id: u.id, kind: u.kind, x: u.x }); }
  }

  // The nearest living foe in front of x within range (or behind for the keep and towers), or null.
  function foeInRange(g, x, range) {
    let best = null, bd = Infinity;
    for (const f of g.foes) {
      if (f.dead) continue;
      const d = Math.abs(f.x - x);
      if (d <= range && d < bd) { bd = d; best = f; }
    }
    return best;
  }

  function soldierTick(g, u) {
    const st = UNITS[u.kind];
    u.cd -= TICK;
    const target = foeInRange(g, u.x, st.range + (st.range < 2 ? 0.4 : 0));
    const lim = frontier(g) - 1;
    if (target) {
      if (u.cd <= 0) {
        u.cd += st.interval;
        let dmg = st.dmg * (u.kind === 'soldier' && hasBuilding(g, 'forge') ? 1 + FORGE_BONUS : 1);
        damageFoe(g, target, hit(g, dmg), u.kind);
        if (st.range > 2) g.events.push({ type: 'shot', from: u.x, to: target.x, kind: u.kind });
      }
      if (u.cd < 0) u.cd = 0;
      return;
    }
    if (u.cd < 0) u.cd = 0;
    // where it wants to stand
    let goal;
    if (g.order === 'attack') {
      const fx = g.L - FORT_W;
      const reach = st.siege ? st.range - 1 : st.range > 2 ? st.range - 2 : 0.5;
      goal = fx - reach;
      if (u.x >= goal - 0.05 && u.x <= fx) {
        if (u.cd <= 0) {
          u.cd += st.interval;
          // stone fortress walls shrug off all but siege engines (level `armor`)
          const dmg = hit(g, st.dmg * (st.siege || 1 - (g.fort.armor || 0)));
          g.fort.hp -= dmg;
          g.events.push({ type: 'fortHit', dmg: Math.round(dmg), kind: u.kind });
          if (st.range > 2) g.events.push({ type: 'shot', from: u.x, to: fx + 1, kind: u.kind });
        }
        return;
      }
    } else {
      // hold: right behind the front wall (melee reaches over it, the wall takes the blows), or ahead of the keep
      const w = frontWall(g);
      const base = w >= 0 ? w - 0.3 : KEEP_X + 8;
      goal = st.range > 2 ? base - 3 : base;
    }
    goal = Math.min(goal, lim);
    const sp = st.speed * TICK;
    u.x += clamp(goal - u.x, -sp, sp);
  }

  function foeTick(g, f) {
    const st = ENEMIES[f.kind];
    f.cd -= TICK;
    // the first own thing in its way (to its left): a unit, a wall, the keep
    let target = null, tx = -Infinity;
    for (const u of g.units) if (!u.dead && u.x <= f.x + 0.5 && u.x > tx) { tx = u.x; target = { unit: u }; }
    for (const p of g.plots) if (p.b && p.b.id === 'wall' && p.b.done && p.x <= f.x + 0.5 && p.x > tx) { tx = p.x; target = { wall: p }; }
    if (KEEP_X > tx) { tx = KEEP_X; target = { keep: true }; }
    const dist = f.x - tx;
    if (dist <= st.range) {
      if (f.cd <= 0) {
        f.cd += st.interval;
        const dmg = hit(g, st.dmg);
        if (target.unit) damageUnit(g, target.unit, dmg);
        else if (target.wall) {
          const p = target.wall;
          p.b.hp -= dmg * (st.wall || 1);
          g.events.push({ type: 'wallHit', x: p.x, dmg: Math.round(dmg * (st.wall || 1)) });
          if (p.b.hp <= 0) { g.events.push({ type: 'wallDown', x: p.x }); p.b = null; }
        } else {
          g.keep.hp -= dmg * (st.wall || 1);
          g.events.push({ type: 'keepHit', dmg: Math.round(dmg * (st.wall || 1)) });
        }
        if (st.range > 2) g.events.push({ type: 'shot', from: f.x, to: tx, kind: f.kind, side: 'foe' });
      }
      if (f.cd < 0) f.cd = 0;
      return;
    }
    if (f.cd < 0) f.cd = 0;
    const slow = chasmAt(g, f.x) ? CHASM_SLOW : 1;
    f.x -= Math.min(st.speed * slow * TICK, dist - st.range);
  }

  function towersTick(g) {
    for (const p of g.plots) {
      if (!p.b || p.b.id !== 'tower' || !p.b.done) continue;
      p.b.cd -= TICK;
      if (p.b.cd > 0) continue;
      const f = foeInRange(g, p.x, BUILD.tower.range);
      if (!f) { p.b.cd = 0; continue; }
      p.b.cd += BUILD.tower.interval;
      damageFoe(g, f, hit(g, BUILD.tower.dmg), 'tower');
      g.events.push({ type: 'shot', from: p.x, to: f.x, kind: 'tower' });
    }
    // the keep's own archer
    g.keep.cd -= TICK;
    if (g.keep.cd <= 0) {
      const f = foeInRange(g, KEEP_X, KEEP_SHOT.range);
      if (f) {
        g.keep.cd += KEEP_SHOT.interval;
        damageFoe(g, f, hit(g, KEEP_SHOT.dmg), 'keep');
        g.events.push({ type: 'shot', from: KEEP_X, to: f.x, kind: 'keep' });
      } else g.keep.cd = 0;
    }
    // the fortress towers shoot the nearest own unit in range
    if (g.fort.towers > 0) {
      g.fort.cd -= TICK;
      if (g.fort.cd <= 0) {
        const fx = g.L - FORT_W;
        let best = null;
        for (const u of g.units) if (!u.dead && fx - u.x <= FORT_SHOT.range && (!best || u.x > best.x)) best = u;
        if (best) {
          g.fort.cd += FORT_SHOT.interval;
          for (let k = 0; k < g.fort.towers; k++) damageUnit(g, best, hit(g, FORT_SHOT.dmg));
          g.events.push({ type: 'shot', from: fx, to: best.x, kind: 'fort', side: 'foe' });
        } else g.fort.cd = 0;
      }
    }
  }

  // ── Waves ──
  function wavesTick(g) {
    g.waves.forEach((w, i) => {
      if (w.sent || g.t < w.at) return;
      w.sent = true;
      for (const k of Object.keys(w.units)) for (let n = 0; n < w.units[k]; n++) g.spawnQ.push(k);
      g.events.push({ type: 'wave', n: i + 1, last: i === g.waves.length - 1 });
    });
    const lastAt = g.waves.length ? g.waves[g.waves.length - 1].at : 0;
    if (g.waves.every((w) => w.sent) && g.t >= lastAt) {
      g.patrolT += TICK;
      if (g.patrolT >= PATROL.every) {
        g.patrolT = 0;
        g.patrols++;
        const size = 2 * PATROL.growth ** g.patrols;
        const raiders = Math.ceil(size), brutes = Math.floor(size / 3);
        for (let n = 0; n < raiders; n++) g.spawnQ.push('raider');
        for (let n = 0; n < brutes; n++) g.spawnQ.push('brute');
        g.events.push({ type: 'patrol', n: g.patrols });
      }
    }
    // one enemy leaves the gate every second
    if (g.spawnQ.length) {
      g.spawnT = (g.spawnT || 0) - TICK;
      if (g.spawnT <= 0) { g.spawnT = 1; addFoe(g, g.spawnQ.shift()); }
    }
  }

  function tick(g) {
    g.t += TICK;
    assignWorkers(g);
    constructTick(g);
    trainTick(g);
    wavesTick(g);
    for (const u of g.units) {
      if (u.dead) continue;
      if (u.kind === 'worker') {
        // a worker in a fight swings back only when cornered
        const f = foeInRange(g, u.x, UNITS.worker.range);
        if (f) { u.cd -= TICK; if (u.cd <= 0) { u.cd += UNITS.worker.interval; damageFoe(g, f, hit(g, UNITS.worker.dmg), 'worker'); } }
        else workerTick(g, u);
      } else soldierTick(g, u);
    }
    for (const f of g.foes) if (!f.dead) foeTick(g, f);
    towersTick(g);
    g.units = g.units.filter((u) => !u.dead);
    g.foes = g.foes.filter((f) => !f.dead);
    if (g.fort.hp <= 0) {
      g.fort.hp = 0;
      g.status = 'won';
      g.events.push({ type: 'won' });
    } else if (g.keep.hp <= 0) {
      g.keep.hp = 0;
      g.status = 'lost';
      g.events.push({ type: 'lost' });
    }
  }

  function step(g, dt) {
    if (g.status !== 'playing' || !finite(dt) || dt <= 0) return;
    g.acc += Math.min(dt, MAX_DT);
    while (g.acc >= TICK - 1e-9) {
      g.acc -= TICK;
      tick(g);
      if (g.status !== 'playing') { g.acc = 0; break; }
    }
  }

  // ★ any win, ★★ the keep kept ≥ 60%, ★★★ that and before par.
  function stars(g) {
    if (g.status !== 'won') return 0;
    if (g.keep.hp < g.keep.maxHp * 0.6) return 1;
    return g.t <= g.par ? 3 : 2;
  }

  // ── Snapshots ──
  function snapshot(g) {
    const o = clone(g);
    o.events = [];
    o.acc = 0;
    return o;
  }

  const num = (v, lo, hi) => finite(v) && v >= lo && v <= hi;

  function restore(o) {
    if (!o || typeof o !== 'object' || o.v !== 1 || o.status !== 'playing') return null;
    if (!num(o.L, 40, 400) || !num(o.t, 0, 1e7) || !Number.isInteger(o.rng) || !Number.isInteger(o.nextId)) return null;
    if (!o.res || !RES.every((r) => num(o.res[r], 0, 1e9))) return null;
    if (!o.keep || !num(o.keep.hp, 0, 1e6) || !o.fort || !num(o.fort.hp, 0, 1e7)) return null;
    if (!Array.isArray(o.plots) || !Array.isArray(o.chasms) || !Array.isArray(o.nodes) || !Array.isArray(o.units) || !Array.isArray(o.foes)) return null;
    if (!o.units.every((u) => u && has(UNITS, u.kind) && num(u.x, -10, o.L + 10) && num(u.hp, 0, 1e5))) return null;
    if (!o.foes.every((f) => f && has(ENEMIES, f.kind) && num(f.x, -10, o.L + 10) && num(f.hp, 0, 1e5))) return null;
    if (!o.plots.every((p) => p && num(p.x, 0, o.L) && (p.b === null || (p.b && has(BUILD, p.b.id))))) return null;
    if (!Array.isArray(o.queue) || !o.queue.every((k) => has(UNITS, k)) || !Array.isArray(o.waves) || !Array.isArray(o.spawnQ)) return null;
    if (o.order !== 'hold' && o.order !== 'attack' || !o.alloc) return null;
    const g = clone(o);
    g.events = [];
    g.acc = 0;
    return g;
  }

  // ── Progress ──
  // front.progress: { v: 1, stars: [0–3 per level], current: { level, state } | null }
  const PROGRESS_KEY = 'front.progress';
  const newProgress = (n) => ({ v: 1, stars: new Array(n).fill(0), current: null });

  function loadProgress(storage, n) {
    const out = newProgress(n);
    let raw = null;
    try { raw = storage ? storage.getItem(PROGRESS_KEY) : null; } catch { raw = null; }
    if (typeof raw !== 'string') return out;
    let d;
    try { d = JSON.parse(raw); } catch { return out; }
    if (!d || d.v !== 1 || !Array.isArray(d.stars)) return out;
    for (let i = 0; i < n; i++) if (Number.isInteger(d.stars[i]) && d.stars[i] >= 0 && d.stars[i] <= 3) out.stars[i] = d.stars[i];
    if (d.current && Number.isInteger(d.current.level) && d.current.level >= 0 && d.current.level < n && restore(d.current.state)) out.current = d.current;
    return out;
  }

  function saveProgress(storage, p) {
    try {
      if (!storage) return false;
      storage.setItem(PROGRESS_KEY, JSON.stringify(p));
      return true;
    } catch {
      return false;
    }
  }

  // Keeps the best stars; returns true when they improved.
  function recordStars(p, level, n) {
    if (!Number.isInteger(level) || level < 0 || level >= p.stars.length) return false;
    if (n > p.stars[level]) { p.stars[level] = n; return true; }
    return false;
  }

  // Level i is open when it's the first or the one before has a star.
  const unlocked = (p, i) => i === 0 || (i > 0 && i < p.stars.length && p.stars[i - 1] > 0);
  const firstUnfinished = (p) => { const i = p.stars.findIndex((s) => s === 0); return i < 0 ? p.stars.length - 1 : i; };

  const api = {
    TICK, MAX_DT, CELL, KEEP_X, FORT_W, KEEP_HP, KEEP_SHOT, FORT_SHOT, GATHER, NODE_SLOTS, WORKER_BASE, HOUSE_WORKERS,
    START_WORKERS, ARMY_CAP, PATROL, CHASM_SLOW, SPREAD, RES, BUILD, STONE_WALL, UNITS, FORGE_BONUS, ENEMIES, PROGRESS_KEY,
    clamp, rand, parseLevel, newGame, status, drain, frontier, workerCap, count, armySize, hasBuilding, reachableNodes,
    afford, missing, costOf, bridgeCost, setAlloc, canBuild, build, canRecruit, recruit, setOrder, frontWall, step, stars,
    snapshot, restore, newProgress, loadProgress, saveProgress, recordStars, unlocked, firstUnfinished,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FrontCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
