// Бастион — tower defense rules: maps, towers, enemies, waves. No DOM, so it runs in Node for balance checks.
// Units: positions and ranges are in tiles, time in seconds. step() advances the world by a fixed dt.
(function (root) {
  'use strict';

  // mulberry32: small, fast, seedable.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const COLS = 16, ROWS = 10;
  const WAVES = 30;
  const START_LIVES = 20;
  const SELL_BACK = 0.7;
  const DT = 1 / 60;

  // Waypoints are tile coordinates of path corners; the first and last sit just off the board.
  // hp scales enemy health on harder maps, gold is the starting purse.
  const MAPS = [
    { id: 'meadow', name: 'Луг', hp: 1, gold: 220, path: [[-1, 2], [4, 2], [4, 7], [9, 7], [9, 2], [13, 2], [13, 8], [16, 8]] },
    { id: 'canyon', name: 'Каньон', hp: 1.2, gold: 240, path: [[-1, 8], [2, 8], [2, 1], [6, 1], [6, 6], [10, 6], [10, 1], [14, 1], [14, 5], [16, 5]] },
    { id: 'fortress', name: 'Крепость', hp: 1.35, gold: 260, path: [[7, -1], [7, 3], [2, 3], [2, 7], [12, 7], [12, 3], [16, 3]] },
  ];

  // Per level: cost to build/upgrade, damage per hit, shots per second, range in tiles.
  const TOWERS = {
    archer: {
      name: 'Лучники', air: true, speed: 9,
      cost: [70, 60, 110], dmg: [11, 19, 32], rate: [1.6, 1.8, 2.2], range: [2.6, 2.9, 3.2],
    },
    cannon: {
      name: 'Пушка', air: false, speed: 6, splash: 0.95,
      cost: [120, 100, 180], dmg: [38, 66, 115], rate: [0.65, 0.7, 0.8], range: [2.4, 2.6, 2.9],
    },
    frost: {
      name: 'Мороз', air: true, speed: 8, splash: 0.7, slowFor: 1.6,
      cost: [90, 80, 140], dmg: [4, 7, 12], rate: [1.2, 1.3, 1.4], range: [2.2, 2.5, 2.8], slow: [0.35, 0.45, 0.55],
    },
    storm: {
      name: 'Молния', air: true, pierce: true, falloff: 0.8, hop: 1.6,
      cost: [150, 130, 220], dmg: [22, 36, 60], rate: [0.9, 1, 1.15], range: [2.6, 2.9, 3.2], chain: [3, 4, 5],
    },
  };
  const TOWER_TYPES = Object.keys(TOWERS);

  // hp at wave 1, speed in tiles per second, armor is subtracted from every hit (at least 25% gets through).
  // Flyers follow the road too, but above it: the cannon cannot reach them.
  const ENEMIES = {
    runner: { name: 'Бегун', hp: 26, speed: 1.9, armor: 0, gold: 4, lives: 1, size: 0.22 },
    soldier: { name: 'Пехотинец', hp: 55, speed: 1.1, armor: 0, gold: 6, lives: 1, size: 0.27 },
    knight: { name: 'Рыцарь', hp: 100, speed: 0.8, armor: 6, gold: 10, lives: 1, size: 0.31 },
    bat: { name: 'Нетопырь', hp: 42, speed: 1.4, armor: 0, gold: 8, lives: 1, size: 0.25, air: true },
    ogre: { name: 'Огр', hp: 800, speed: 0.55, armor: 4, gold: 80, lives: 5, size: 0.42 },
  };

  const hpScale = (w) => 1 + 0.15 * (w - 1) + 0.015 * (w - 1) ** 2;
  const waveReward = (w) => 20 + 2 * w;
  const callBonus = (w) => 10 + w;

  // The enemies of wave w (1-based), in spawn order, with the pause before each. Deterministic per map.
  function waveList(mapIdx, w) {
    const R = rng(1000 * (mapIdx + 1) + w);
    const out = [];
    const boss = w % 10 === 0;
    const n = boss ? 4 + Math.floor(w / 5) : 6 + Math.floor(w * 0.8);
    const pool = ['soldier'];
    if (w >= 2) pool.push('runner');
    if (w >= 5) pool.push('knight');
    if (w >= 8) pool.push('bat');
    // A themed wave every few waves: all of one kind.
    const theme = w >= 4 && w % 3 === 1 ? pool[Math.floor(R() * pool.length)] : null;
    for (let i = 0; i < n; i++) {
      const type = theme || pool[Math.floor(R() * pool.length)];
      out.push({ type, gap: type === 'runner' ? 0.5 : type === 'knight' ? 1.1 : 0.8 });
    }
    if (boss) out.push({ type: 'ogre', gap: 1.5 });
    return out;
  }

  // ───────────── Path geometry ─────────────
  function buildPath(points) {
    const pts = points.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
    const segs = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      segs.push({ a, b, len, at: total });
      total += len;
    }
    return { pts, segs, length: total };
  }
  function pointAt(path, d) {
    d = Math.max(0, Math.min(path.length, d));
    for (const s of path.segs) {
      if (d <= s.at + s.len) {
        const k = s.len ? (d - s.at) / s.len : 0;
        return { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k };
      }
    }
    return { ...path.pts[path.pts.length - 1] };
  }
  // Tiles the road covers (axis-aligned segments only).
  function pathTiles(points) {
    const set = new Set();
    for (let i = 1; i < points.length; i++) {
      let [x, y] = points[i - 1];
      const [x2, y2] = points[i];
      const dx = Math.sign(x2 - x), dy = Math.sign(y2 - y);
      for (;;) {
        if (x >= 0 && y >= 0 && x < COLS && y < ROWS) set.add(y * COLS + x);
        if (x === x2 && y === y2) break;
        x += dx; y += dy;
      }
    }
    return set;
  }

  // Derived, not saved: rebuilt from the map index on load.
  const cache = new Map();
  function geo(mapIdx) {
    if (!cache.has(mapIdx)) {
      const m = MAPS[mapIdx];
      const ground = buildPath(m.path);
      cache.set(mapIdx, { ground, road: pathTiles(m.path) });
    }
    return cache.get(mapIdx);
  }

  // ───────────── State ─────────────
  function newGame(mapIdx) {
    return {
      v: 1, map: mapIdx, gold: MAPS[mapIdx].gold, lives: START_LIVES, score: 0, wave: 0, t: 0,
      phase: 'build', towers: [], enemies: [], shots: [], spawners: [], nextId: 1,
      kills: 0, leaked: 0,
    };
  }

  // Between waves nothing moves, so this is all a save needs.
  function snapshot(s) {
    return {
      v: 1, map: s.map, gold: s.gold, lives: s.lives, score: s.score, wave: s.wave, kills: s.kills, leaked: s.leaked,
      towers: s.towers.map(({ type, lvl, x, y, spent }) => ({ type, lvl, x, y, spent })),
    };
  }
  function restore(snap) {
    const s = newGame(snap.map);
    Object.assign(s, {
      gold: snap.gold, lives: snap.lives, score: snap.score, wave: snap.wave, kills: snap.kills || 0, leaked: snap.leaked || 0,
    });
    s.towers = snap.towers.map((t) => ({ ...t, id: s.nextId++, cd: 0, angle: -Math.PI / 2 }));
    return s;
  }

  const towerAt = (s, x, y) => s.towers.find((t) => t.x === x && t.y === y) || null;
  function canBuild(s, x, y) {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS && !geo(s.map).road.has(y * COLS + x) && !towerAt(s, x, y);
  }

  function build(s, type, x, y) {
    const def = TOWERS[type];
    if (!def || !canBuild(s, x, y) || s.gold < def.cost[0] || s.phase === 'won' || s.phase === 'lost') return null;
    s.gold -= def.cost[0];
    const t = { id: s.nextId++, type, lvl: 0, x, y, spent: def.cost[0], cd: 0, angle: -Math.PI / 2 };
    s.towers.push(t);
    return t;
  }
  const upgradeCost = (t) => TOWERS[t.type].cost[t.lvl + 1] ?? null;
  function upgrade(s, t) {
    const c = upgradeCost(t);
    if (c === null || s.gold < c || s.phase === 'won' || s.phase === 'lost') return false;
    s.gold -= c;
    t.spent += c;
    t.lvl++;
    return true;
  }
  const sellValue = (t) => Math.floor(t.spent * SELL_BACK);
  function sell(s, t) {
    const i = s.towers.indexOf(t);
    if (i < 0 || s.phase === 'won' || s.phase === 'lost') return 0;
    s.towers.splice(i, 1);
    const v = sellValue(t);
    s.gold += v;
    return v;
  }
  // Stats of a tower at a level, for the info panel.
  function stats(type, lvl) {
    const d = TOWERS[type];
    return { dmg: d.dmg[lvl], rate: d.rate[lvl], range: d.range[lvl], slow: d.slow ? d.slow[lvl] : 0, chain: d.chain ? d.chain[lvl] : 0, air: d.air };
  }

  // The next wave can start in the build phase, or early once every running wave has spawned everyone.
  const canCall = (s) => s.wave < WAVES && (s.phase === 'build' || (s.phase === 'wave' && s.spawners.every((sp) => !sp.queue.length)));
  function callWave(s) {
    if (!canCall(s)) return 0;
    const early = s.phase === 'wave';
    s.wave++;
    s.phase = 'wave';
    s.spawners.push({ wave: s.wave, queue: waveList(s.map, s.wave), t: 0.4, alive: 0 });
    if (!early) return 0;
    const bonus = callBonus(s.wave);
    s.gold += bonus;
    return bonus;
  }

  function spawn(s, type, wave) {
    const def = ENEMIES[type], m = MAPS[s.map];
    const hp = Math.round(def.hp * hpScale(wave) * m.hp);
    const e = { id: s.nextId++, type, wave, hp, max: hp, d: 0, slow: 0, slowT: 0, x: 0, y: 0, air: !!def.air };
    Object.assign(e, pointAt(geo(s.map).ground, 0));
    s.enemies.push(e);
    return e;
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const center = (t) => ({ x: t.x + 0.5, y: t.y + 0.5 });

  function hurt(s, e, dmg, pierce, ev) {
    if (e.hp <= 0) return;
    const armor = pierce ? 0 : ENEMIES[e.type].armor;
    e.hp -= Math.max(dmg * 0.25, dmg - armor);
    if (e.hp <= 0) {
      const def = ENEMIES[e.type];
      s.gold += def.gold;
      s.score += def.gold * 10;
      s.kills++;
      ev.push({ type: 'kill', x: e.x, y: e.y, gold: def.gold, enemy: e.type });
    }
  }

  // Furthest along the road among enemies in range — the usual "first" targeting.
  function target(s, t, def, range) {
    const c = center(t);
    let best = null, bestD = -1;
    for (const e of s.enemies) {
      if (e.hp <= 0 || (e.air && !def.air)) continue;
      if (dist(c, e) > range) continue;
      if (e.d > bestD) { bestD = e.d; best = e; }
    }
    return best;
  }

  function impact(s, sh, ev) {
    const def = TOWERS[sh.type];
    const tgt = s.enemies.find((e) => e.id === sh.target);
    const at = tgt && tgt.hp > 0 ? { x: tgt.x, y: tgt.y } : { x: sh.tx, y: sh.ty };
    if (def.splash) {
      for (const e of s.enemies) {
        if (e.hp <= 0 || (e.air && !def.air) || dist(e, at) > def.splash) continue;
        hurt(s, e, sh.dmg, false, ev);
        if (sh.slow) { e.slow = Math.max(e.slow, sh.slow); e.slowT = def.slowFor; }
      }
      ev.push({ type: sh.type === 'cannon' ? 'boom' : 'frost', x: at.x, y: at.y, r: def.splash });
    } else if (tgt && tgt.hp > 0) {
      hurt(s, tgt, sh.dmg, false, ev);
      ev.push({ type: 'hit', x: at.x, y: at.y });
    }
  }

  function fire(s, t, e, ev) {
    const def = TOWERS[t.type], st = stats(t.type, t.lvl), c = center(t);
    t.angle = Math.atan2(e.y - c.y, e.x - c.x);
    if (t.type === 'storm') {
      // Lightning jumps from the target to the nearest enemies not hit yet, weaker with each hop.
      const hit = [e];
      let cur = e, dmg = st.dmg;
      const pts = [c, { x: e.x, y: e.y }];
      hurt(s, e, dmg, true, ev);
      while (hit.length < st.chain) {
        let next = null, nd = def.hop;
        for (const o of s.enemies) {
          if (o.hp <= 0 || hit.includes(o)) continue;
          const d = dist(cur, o);
          if (d < nd) { nd = d; next = o; }
        }
        if (!next) break;
        dmg *= def.falloff;
        hurt(s, next, dmg, true, ev);
        hit.push(next);
        pts.push({ x: next.x, y: next.y });
        cur = next;
      }
      ev.push({ type: 'zap', pts, tower: t.id });
      return;
    }
    s.shots.push({ type: t.type, x: c.x, y: c.y, tx: e.x, ty: e.y, target: e.id, dmg: st.dmg, slow: st.slow, speed: def.speed });
    ev.push({ type: 'fire', tower: t.id, kind: t.type });
  }

  // Advances the world by dt and returns what happened, for sounds and effects.
  function step(s, dt = DT) {
    const ev = [];
    if (s.phase !== 'wave') return ev;
    s.t += dt;
    const g = geo(s.map);

    for (const sp of s.spawners) {
      if (!sp.queue.length) continue;
      sp.t -= dt;
      if (sp.t <= 0) {
        const { type } = sp.queue.shift();
        spawn(s, type, sp.wave);
        sp.t = sp.queue.length ? sp.queue[0].gap : 0;
      }
    }

    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      const def = ENEMIES[e.type];
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slow = 0; }
      e.d += def.speed * (1 - e.slow) * dt;
      Object.assign(e, pointAt(g.ground, e.d));
      if (e.d >= g.ground.length) {
        e.hp = 0;
        e.leaked = true;
        s.lives = Math.max(0, s.lives - def.lives);
        s.leaked++;
        ev.push({ type: 'leak', lives: def.lives });
      }
    }

    for (const t of s.towers) {
      t.cd -= dt;
      if (t.cd > 0) continue;
      const def = TOWERS[t.type], st = stats(t.type, t.lvl);
      const e = target(s, t, def, st.range);
      if (!e) { t.cd = 0; continue; }
      fire(s, t, e, ev);
      t.cd = 1 / st.rate;
    }

    for (const sh of s.shots) {
      const tgt = s.enemies.find((e) => e.id === sh.target && e.hp > 0);
      if (tgt) { sh.tx = tgt.x; sh.ty = tgt.y; }
      const dx = sh.tx - sh.x, dy = sh.ty - sh.y, d = Math.hypot(dx, dy), mv = sh.speed * dt;
      if (d <= mv) { sh.done = true; impact(s, sh, ev); } else { sh.x += (dx / d) * mv; sh.y += (dy / d) * mv; }
    }
    s.shots = s.shots.filter((sh) => !sh.done);
    s.enemies = s.enemies.filter((e) => e.hp > 0);

    // A wave pays out once all of it has spawned and none of it is left on the board.
    for (const sp of s.spawners) {
      if (sp.queue.length || s.enemies.some((e) => e.wave === sp.wave)) continue;
      sp.done = true;
      const r = waveReward(sp.wave);
      s.gold += r;
      s.score += sp.wave * 20;
      ev.push({ type: 'cleared', wave: sp.wave, gold: r });
    }
    s.spawners = s.spawners.filter((sp) => !sp.done);

    if (s.lives <= 0) {
      s.phase = 'lost';
      ev.push({ type: 'lost' });
    } else if (!s.spawners.length && !s.enemies.length) {
      s.shots = [];
      if (s.wave >= WAVES) {
        s.phase = 'won';
        s.score += s.lives * 100;
        ev.push({ type: 'won' });
      } else s.phase = 'build';
    }
    return ev;
  }

  // 3 stars for losing at most 2 lives, 2 for at most 10, 1 for any win.
  const starsFor = (s) => (s.phase !== 'won' ? 0 : s.lives >= START_LIVES - 2 ? 3 : s.lives >= START_LIVES - 10 ? 2 : 1);

  const api = {
    rng, COLS, ROWS, WAVES, START_LIVES, SELL_BACK, DT, MAPS, TOWERS, TOWER_TYPES, ENEMIES,
    hpScale, waveReward, callBonus, waveList, geo, pointAt, newGame, snapshot, restore, towerAt, canBuild, build,
    upgradeCost, upgrade, sellValue, sell, stats, canCall, callWave, step, starsFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BastionCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
