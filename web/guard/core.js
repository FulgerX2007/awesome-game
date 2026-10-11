'use strict';
// Дозор — rules for a small turn-based tactics game. Enemies telegraph their attacks; heroes push them around.
// No DOM here: Node runs the balance bot against the same code.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GuardCore = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  const W = 8, H = 8;
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  // ───────────── Randomness (state is saved with the run) ─────────────
  function rngNext(s) {
    s.rng = (s.rng + 0x6d2b79f5) >>> 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const ri = (s, a, b) => a + Math.floor(rngNext(s) * (b - a + 1));
  const pick = (s, arr) => arr[Math.floor(rngNext(s) * arr.length)];
  function shuffle(s, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rngNext(s) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ───────────── Content ─────────────
  // Names and descriptions are Russian keys; the UI translates them (web/i18n.js).
  const HEROES = {
    knight: { name: 'Рыцарь', hp: 3, move: 3, dmg: 2, ability: 'Удар щитом', about: 'Бьёт соседнюю клетку на {dmg} и отталкивает цель на шаг.' },
    archer: { name: 'Лучница', hp: 3, move: 3, dmg: 1, ability: 'Стрела', about: 'Стреляет по прямой: первая цель получает {dmg} и отлетает по ходу стрелы.' },
    mage: { name: 'Маг', hp: 3, move: 3, dmg: 1, ability: 'Вихрь', about: 'Бьёт клетку через одну и дальше по прямой на {dmg} (дома не задевает) и расталкивает всех вокруг неё.' },
  };
  const HERO_ORDER = ['knight', 'archer', 'mage'];
  const ENEMIES = {
    wolf: { name: 'Волк', hp: 2, move: 3, attack: 'melee', dmg: 1, about: 'Кусает соседнюю клетку.' },
    slinger: { name: 'Пращник', hp: 2, move: 2, attack: 'shot', dmg: 1, about: 'Метает камень по прямой: попадает в первое препятствие.' },
    bat: { name: 'Нетопырь', hp: 1, move: 4, attack: 'melee', dmg: 1, flying: true, about: 'Летает над водой и скалами. Кусает соседнюю клетку.' },
    troll: { name: 'Тролль', hp: 4, move: 2, attack: 'smash', dmg: 2, about: 'Бьёт соседнюю клетку и отбрасывает цель.' },
  };
  // Five islands; each row is one battle.
  const BATTLES = [
    { turns: 4, start: 2, spawn: [1, 2], kinds: ['wolf', 'slinger'], elite: 0 },
    { turns: 4, start: 3, spawn: [1, 2], kinds: ['wolf', 'slinger', 'bat'], elite: 0 },
    { turns: 4, start: 3, spawn: [2, 2], kinds: ['wolf', 'slinger', 'bat', 'troll'], elite: 0.15 },
    { turns: 5, start: 3, spawn: [2, 2], kinds: ['wolf', 'slinger', 'bat', 'troll'], elite: 0.25 },
    { turns: 5, start: 4, spawn: [2, 3], kinds: ['wolf', 'slinger', 'bat', 'troll', 'troll'], elite: 0.35 },
  ];
  const ISLANDS = ['Мшистый берег', 'Совиная гать', 'Старая мельница', 'Каменный брод', 'Сердце леса'];
  const START_POWER = 5, MAX_POWER = 7;

  // ───────────── Run (the whole campaign) ─────────────
  function newRun(seed) {
    const run = {
      v: 1, rng: seed >>> 0, seed: seed >>> 0, battle: 0, power: START_POWER, score: 0, kills: 0,
      heroes: {}, taken: [], status: 'battle', rewards: null, objectives: 0, b: null,
    };
    for (const k of HERO_ORDER) run.heroes[k] = { hp: HEROES[k].hp, move: HEROES[k].move, dmg: HEROES[k].dmg, hurt: false };
    run.b = newBattle(run);
    return run;
  }

  // ───────────── Battle setup ─────────────
  const idx = (x, y) => y * W + x;
  const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const tileAt = (b, x, y) => b.tiles[idx(x, y)];
  const unitAt = (b, x, y) => b.units.find((u) => u.x === x && u.y === y) || null;
  const ground = (t) => t.t === 'g' || t.t === 'f' || t.t === 'r';
  const solid = (t) => t.t === 'm' || t.t === 'h';

  function newBattle(run) {
    const cfg = BATTLES[run.battle];
    // Retry until the open ground is one connected area, so heroes can reach every fight.
    for (let attempt = 0; attempt < 50; attempt++) {
      const b = genMap(run);
      if (connected(b)) return populate(run, b, cfg);
    }
    return populate(run, genMap(run), cfg);
  }
  function genMap(run) {
    const b = { tiles: [], units: [], marks: [], turn: 1, turns: BATTLES[run.battle].turns, nextId: 1, kills: 0, housesLost: 0, phase: 'player', objective: null, log: [] };
    for (let i = 0; i < W * H; i++) b.tiles.push({ t: rngNext(run) < 0.12 ? 'f' : 'g', hp: 0 });
    // Village in the lower half, rocks and ponds anywhere.
    const houses = ri(run, 5, 7);
    for (let n = 0, guard = 0; n < houses && guard < 200; guard++) {
      const x = ri(run, 0, W - 1), y = ri(run, 3, H - 1), t = tileAt(b, x, y);
      if (t.t === 'h') continue;
      // Keep houses from forming a wall: at most one other house next to it.
      const near = DIRS.filter(([dx, dy]) => inB(x + dx, y + dy) && tileAt(b, x + dx, y + dy).t === 'h').length;
      if (near > 1) continue;
      t.t = 'h'; t.hp = 1; n++;
    }
    const rocks = ri(run, 3, 5);
    for (let n = 0, guard = 0; n < rocks && guard < 200; guard++) {
      const t = tileAt(b, ri(run, 0, W - 1), ri(run, 0, H - 1));
      if (t.t === 'g' || t.t === 'f') { t.t = 'm'; t.hp = 2; n++; }
    }
    const ponds = ri(run, 0, 2);
    for (let n = 0; n < ponds; n++) {
      let x = ri(run, 0, W - 1), y = ri(run, 1, H - 2);
      for (let k = ri(run, 1, 3); k > 0; k--) {
        const t = tileAt(b, x, y);
        if (t.t === 'g' || t.t === 'f') { t.t = 'w'; t.hp = 0; }
        const [dx, dy] = pick(run, DIRS);
        if (inB(x + dx, y + dy)) { x += dx; y += dy; }
      }
    }
    return b;
  }
  function connected(b) {
    const open = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ground(tileAt(b, x, y))) open.push([x, y]);
    if (open.length < 34) return false;
    const seen = new Set([idx(...open[0])]), q = [open[0]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (inB(nx, ny) && !seen.has(idx(nx, ny)) && ground(tileAt(b, nx, ny))) { seen.add(idx(nx, ny)); q.push([nx, ny]); }
      }
    }
    return seen.size === open.length;
  }
  function freeGround(b, rows, avoid = []) {
    const out = [];
    for (const y of rows) for (let x = 0; x < W; x++) {
      if (ground(tileAt(b, x, y)) && !unitAt(b, x, y) && !b.marks.some((m) => m.x === x && m.y === y) && !avoid.some((a) => a.x === x && a.y === y)) out.push({ x, y });
    }
    return out;
  }
  function makeEnemy(run, b, kind, x, y) {
    const e = ENEMIES[kind];
    const elite = rngNext(run) < BATTLES[run.battle].elite;
    const u = { id: b.nextId++, side: 'enemy', kind, x, y, hp: e.hp + (elite ? 1 : 0), maxHp: e.hp + (elite ? 1 : 0), dmg: e.dmg + (elite ? 1 : 0), elite, intent: null };
    b.units.push(u);
    return u;
  }
  function populate(run, b, cfg) {
    // Heroes stand among the houses, spread apart.
    let spots = shuffle(run, freeGround(b, [4, 5, 6]));
    for (const k of HERO_ORDER) {
      const h = run.heroes[k];
      const s = spots.find((p) => !b.units.some((u) => Math.abs(u.x - p.x) + Math.abs(u.y - p.y) < 2)) || spots[0];
      spots = spots.filter((p) => p !== s);
      b.units.push({ id: b.nextId++, side: 'hero', kind: k, x: s.x, y: s.y, hp: h.hp, maxHp: h.hp, move: h.move, dmg: h.dmg, hurt: h.hurt, moved: false, acted: false });
    }
    const top = shuffle(run, freeGround(b, [0, 1, 2]));
    for (let i = 0; i < cfg.start && i < top.length; i++) makeEnemy(run, b, pick(run, cfg.kinds), top[i].x, top[i].y);
    b.objective = rngNext(run) < 0.5 ? { kind: 'kills', n: [3, 4, 5, 5, 6][run.battle] } : { kind: 'houses' };
    placeMarks(run, b);
    enemyPlan(run, b);
    return b;
  }
  function placeMarks(run, b) {
    const cfg = BATTLES[run.battle];
    const n = ri(run, cfg.spawn[0], cfg.spawn[1]);
    const spots = shuffle(run, freeGround(b, [0, 1, 2]));
    b.marks = spots.slice(0, n).map((p) => ({ x: p.x, y: p.y, kind: pick(run, cfg.kinds) }));
  }

  // ───────────── Movement ─────────────
  // Heroes walk through each other but not through enemies; bats fly over anything.
  function reach(b, u, range) {
    const fly = u.side === 'enemy' && ENEMIES[u.kind].flying;
    const out = [], seen = new Map([[idx(u.x, u.y), 0]]), q = [[u.x, u.y]];
    while (q.length) {
      const [x, y] = q.shift(), d = seen.get(idx(x, y));
      if (d >= range) continue;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!inB(nx, ny) || seen.has(idx(nx, ny))) continue;
        const t = tileAt(b, nx, ny), o = unitAt(b, nx, ny);
        if (!fly && (!ground(t) || (o && o.side !== u.side))) continue;
        seen.set(idx(nx, ny), d + 1);
        q.push([nx, ny]);
        const endOk = fly ? (t.t !== 'm' && t.t !== 'h') : true;
        if (!o && endOk) out.push({ x: nx, y: ny });
      }
    }
    return out;
  }

  // ───────────── Damage & push ─────────────
  function ev(b, e) { b.log.push(e); }
  function hurtUnit(run, b, u, n, why) {
    if (n <= 0) return;
    u.hp -= n;
    ev(b, { t: 'dmg', id: u.id, x: u.x, y: u.y, n, why });
    if (u.hp <= 0) kill(run, b, u, why);
  }
  function kill(run, b, u, why) {
    b.units = b.units.filter((v) => v !== u);
    ev(b, { t: 'die', id: u.id, kind: u.kind, side: u.side, x: u.x, y: u.y, why });
    if (u.side === 'enemy') { b.kills++; run.kills++; run.score += 10; }
  }
  function hitTile(run, b, x, y, n, opts = {}) {
    const t = tileAt(b, x, y);
    if (t.t === 'h' && !opts.spare) {
      t.t = 'r'; t.hp = 0; b.housesLost++; run.power = Math.max(0, run.power - 1);
      ev(b, { t: 'house', x, y });
    } else if (t.t === 'm' && !opts.spare) {
      t.hp -= 1;
      ev(b, { t: 'rock', x, y, broke: t.hp <= 0 });
      if (t.hp <= 0) { t.t = 'r'; t.hp = 0; }
    }
  }
  function damageAt(run, b, x, y, n, opts = {}) {
    if (!inB(x, y)) return;
    const u = unitAt(b, x, y);
    if (u) hurtUnit(run, b, u, n, opts.why);
    else hitTile(run, b, x, y, n, opts);
  }
  function push(run, b, x, y, dir) {
    const u = unitAt(b, x, y);
    if (!u) return;
    const [dx, dy] = DIRS[dir], nx = x + dx, ny = y + dy;
    if (!inB(nx, ny)) return;
    const t = tileAt(b, nx, ny), o = unitAt(b, nx, ny);
    const fly = u.side === 'enemy' && ENEMIES[u.kind].flying;
    if (o) {
      ev(b, { t: 'bump', x, y, tx: nx, ty: ny });
      hurtUnit(run, b, u, 1, 'bump');
      hurtUnit(run, b, o, 1, 'bump');
      return;
    }
    if (solid(t) || (t.t === 'w' && u.side === 'hero')) {
      ev(b, { t: 'bump', x, y, tx: nx, ty: ny });
      hurtUnit(run, b, u, 1, 'bump');
      if (solid(t)) hitTile(run, b, nx, ny, 1);
      return;
    }
    ev(b, { t: 'move', id: u.id, x, y, tx: nx, ty: ny, push: true });
    u.x = nx; u.y = ny;
    if (t.t === 'w' && !fly) kill(run, b, u, 'drown');
  }
  // A projectile flies from (x, y) in dir and stops at the first unit, rock or house.
  function flight(b, x, y, dir) {
    const [dx, dy] = DIRS[dir];
    let cx = x + dx, cy = y + dy;
    while (inB(cx, cy)) {
      if (unitAt(b, cx, cy) || solid(tileAt(b, cx, cy))) return { x: cx, y: cy };
      cx += dx; cy += dy;
    }
    return null;
  }

  // ───────────── Hero abilities ─────────────
  // Targets are the tiles a player can click; each maps to an effect.
  function targets(b, u) {
    const out = [];
    for (let dir = 0; dir < 4; dir++) {
      const [dx, dy] = DIRS[dir];
      if (u.kind === 'knight') {
        if (inB(u.x + dx, u.y + dy)) out.push({ x: u.x + dx, y: u.y + dy, dir });
      } else if (u.kind === 'archer') {
        const hit = flight(b, u.x, u.y, dir);
        for (let k = 1; inB(u.x + dx * k, u.y + dy * k); k++) out.push({ x: u.x + dx * k, y: u.y + dy * k, dir, hit });
      } else {
        for (let k = 2; inB(u.x + dx * k, u.y + dy * k); k++) out.push({ x: u.x + dx * k, y: u.y + dy * k, dir });
      }
    }
    return out;
  }
  // The tiles an ability will touch, for highlighting before the click.
  function area(b, u, tg) {
    if (u.kind === 'knight') return [{ x: tg.x, y: tg.y, main: true }];
    if (u.kind === 'archer') return tg.hit ? [{ x: tg.hit.x, y: tg.hit.y, main: true }] : [];
    return [{ x: tg.x, y: tg.y, main: true }, ...DIRS.map(([dx, dy]) => ({ x: tg.x + dx, y: tg.y + dy })).filter((p) => inB(p.x, p.y))];
  }
  function act(run, b, id, x, y) {
    const u = b.units.find((v) => v.id === id);
    if (!u || u.side !== 'hero' || u.acted || b.phase !== 'player') return false;
    const tg = targets(b, u).find((t) => t.x === x && t.y === y);
    if (!tg) return false;
    ev(b, { t: 'act', id, kind: u.kind, x, y, dir: tg.dir });
    if (u.kind === 'knight') {
      damageAt(run, b, tg.x, tg.y, u.dmg, { why: 'knight' });
      push(run, b, tg.x, tg.y, tg.dir);
    } else if (u.kind === 'archer') {
      if (tg.hit) {
        ev(b, { t: 'shot', x: u.x, y: u.y, tx: tg.hit.x, ty: tg.hit.y });
        damageAt(run, b, tg.hit.x, tg.hit.y, u.dmg, { why: 'archer' });
        push(run, b, tg.hit.x, tg.hit.y, tg.dir);
      }
    } else {
      damageAt(run, b, tg.x, tg.y, u.dmg, { spare: true, why: 'mage' });
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = DIRS[d], nx = tg.x + dx, ny = tg.y + dy;
        if (!inB(nx, ny)) continue;
        const v = unitAt(b, nx, ny);
        if (v && u.hurt) hurtUnit(run, b, v, 1, 'mage');
        if (unitAt(b, nx, ny)) push(run, b, nx, ny, d);
      }
    }
    if (b.units.includes(u)) { u.acted = true; u.moved = true; }
    checkEnd(run);
    return true;
  }
  function move(run, b, id, x, y) {
    const u = b.units.find((v) => v.id === id);
    if (!u || u.side !== 'hero' || u.moved || u.acted || b.phase !== 'player') return false;
    if (!reach(b, u, u.move).some((p) => p.x === x && p.y === y)) return false;
    ev(b, { t: 'move', id, x: u.x, y: u.y, tx: x, ty: y });
    u.x = x; u.y = y; u.moved = true;
    return true;
  }

  // ───────────── Enemy turn ─────────────
  // Where an attack from (x, y) in dir would land, or null.
  function strikeTile(b, u, x, y, dir) {
    const kind = ENEMIES[u.kind].attack;
    if (kind === 'shot') {
      const [dx, dy] = DIRS[dir];
      let cx = x + dx, cy = y + dy;
      while (inB(cx, cy)) {
        const o = unitAt(b, cx, cy);
        if ((o && o !== u) || solid(tileAt(b, cx, cy))) return { x: cx, y: cy };
        cx += dx; cy += dy;
      }
      return null;
    }
    const [dx, dy] = DIRS[dir];
    return inB(x + dx, y + dy) ? { x: x + dx, y: y + dy } : null;
  }
  function enemyPlan(run, b) {
    const enemies = b.units.filter((u) => u.side === 'enemy').sort((a, c) => a.id - c.id);
    const houses = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (tileAt(b, x, y).t === 'h') houses.push({ x, y });
    for (const u of enemies) {
      const spots = [{ x: u.x, y: u.y }, ...reach(b, u, ENEMIES[u.kind].move)];
      let best = null;
      const ox = u.x, oy = u.y;
      for (const s of spots) {
        if (b.marks.some((m) => m.x === s.x && m.y === s.y)) continue;
        u.x = s.x; u.y = s.y;
        const near = houses.length ? Math.min(...houses.map((h) => Math.abs(h.x - s.x) + Math.abs(h.y - s.y))) : 0;
        for (let dir = 0; dir < 4; dir++) {
          const tt = strikeTile(b, u, s.x, s.y, dir);
          let v = -2;
          if (tt) {
            const o = unitAt(b, tt.x, tt.y), t = tileAt(b, tt.x, tt.y);
            if (o && o.side === 'hero') v = 6;
            else if (o) v = -8;
            else if (t.t === 'h') v = 10;
            else if (t.t === 'm') v = 0;
            else v = -1;
          }
          v += -0.15 * near + rngNext(run) * 0.6;
          if (!best || v > best.v) best = { v, x: s.x, y: s.y, dir };
        }
      }
      u.x = ox; u.y = oy;
      if (best) {
        if (best.x !== u.x || best.y !== u.y) ev(b, { t: 'move', id: u.id, x: u.x, y: u.y, tx: best.x, ty: best.y, enemy: true });
        u.x = best.x; u.y = best.y; u.intent = best.dir;
      }
    }
  }
  // Ends the player's turn: enemies strike in order, new ones emerge, the next turn is planned.
  function endTurn(run) {
    const b = run.b;
    if (run.status !== 'battle' || b.phase !== 'player') return false;
    b.phase = 'enemy';
    b.log = [];
    const enemies = b.units.filter((u) => u.side === 'enemy' && u.intent != null).sort((a, c) => a.id - c.id);
    for (const u of enemies) {
      if (!b.units.includes(u)) continue;
      const tt = strikeTile(b, u, u.x, u.y, u.intent);
      ev(b, { t: 'strike', id: u.id, x: u.x, y: u.y, dir: u.intent, tx: tt ? tt.x : null, ty: tt ? tt.y : null, kind: u.kind });
      if (tt) {
        damageAt(run, b, tt.x, tt.y, u.dmg, { why: u.kind });
        if (ENEMIES[u.kind].attack === 'smash') push(run, b, tt.x, tt.y, u.intent);
      }
      u.intent = null;
      if (run.power <= 0) break;
    }
    if (checkEnd(run)) return true;
    for (const m of b.marks) {
      const o = unitAt(b, m.x, m.y);
      if (o) { ev(b, { t: 'blocked', x: m.x, y: m.y }); hurtUnit(run, b, o, 1, 'blocked'); continue; }
      const e = makeEnemy(run, b, m.kind, m.x, m.y);
      ev(b, { t: 'emerge', id: e.id, x: m.x, y: m.y, kind: m.kind });
    }
    b.marks = [];
    if (b.turn >= b.turns) { winBattle(run); return true; }
    b.turn++;
    for (const u of b.units) if (u.side === 'hero') { u.moved = false; u.acted = false; }
    if (b.turn < b.turns) placeMarks(run, b);
    enemyPlan(run, b);
    b.phase = 'player';
    return true;
  }
  function checkEnd(run) {
    if (run.power <= 0 && run.status === 'battle') {
      run.status = 'lost';
      run.b.phase = 'over';
      return true;
    }
    return false;
  }
  function objectiveDone(b) {
    return b.objective.kind === 'kills' ? b.kills >= b.objective.n : b.housesLost === 0;
  }

  // ───────────── Between battles ─────────────
  const REWARDS = {
    hp_knight: { name: 'Крепкий рыцарь', about: 'Рыцарь: +1 к здоровью.', ok: (r) => r.heroes.knight.hp < 5, apply: (r) => { r.heroes.knight.hp++; } },
    hp_archer: { name: 'Выносливая лучница', about: 'Лучница: +1 к здоровью.', ok: (r) => r.heroes.archer.hp < 5, apply: (r) => { r.heroes.archer.hp++; } },
    hp_mage: { name: 'Стойкий маг', about: 'Маг: +1 к здоровью.', ok: (r) => r.heroes.mage.hp < 5, apply: (r) => { r.heroes.mage.hp++; } },
    knight_dmg: { name: 'Тяжёлый щит', about: 'Удар щитом наносит 3 урона.', ok: (r) => r.heroes.knight.dmg < 3, apply: (r) => { r.heroes.knight.dmg = 3; } },
    archer_dmg: { name: 'Стальные наконечники', about: 'Стрела наносит 2 урона.', ok: (r) => r.heroes.archer.dmg < 2, apply: (r) => { r.heroes.archer.dmg = 2; } },
    mage_hurt: { name: 'Колючий ветер', about: 'Вихрь ранит на 1 всех, кого расталкивает.', ok: (r) => !r.heroes.mage.hurt, apply: (r) => { r.heroes.mage.hurt = true; } },
    move_knight: { name: 'Быстрые сапоги', about: 'Рыцарь: +1 шаг.', ok: (r) => r.heroes.knight.move < 4, apply: (r) => { r.heroes.knight.move = 4; } },
    move_archer: { name: 'Лёгкий плащ', about: 'Лучница: +1 шаг.', ok: (r) => r.heroes.archer.move < 4, apply: (r) => { r.heroes.archer.move = 4; } },
    move_mage: { name: 'Посох-скороход', about: 'Маг: +1 шаг.', ok: (r) => r.heroes.mage.move < 4, apply: (r) => { r.heroes.mage.move = 4; } },
    lanterns: { name: 'Новые фонари', about: '+2 фонаря деревни (не больше 7).', ok: (r) => r.power < MAX_POWER, apply: (r) => { r.power = Math.min(MAX_POWER, r.power + 2); } },
  };
  function winBattle(run) {
    const b = run.b;
    b.phase = 'won';
    run.score += 100;
    b.objDone = objectiveDone(b);
    if (b.objDone) { run.objectives++; run.score += 50; run.power = Math.min(MAX_POWER, run.power + 1); }
    if (run.battle >= BATTLES.length - 1) {
      run.status = 'won';
      run.score += run.power * 100;
      return;
    }
    run.status = 'reward';
    const pool = shuffle(run, Object.keys(REWARDS).filter((k) => REWARDS[k].ok(run)));
    run.rewards = pool.slice(0, 3);
  }
  function takeReward(run, key) {
    if (run.status !== 'reward' || !run.rewards.includes(key)) return false;
    REWARDS[key].apply(run);
    run.taken.push(key);
    run.rewards = null;
    run.battle++;
    run.status = 'battle';
    run.b = newBattle(run);
    return true;
  }

  // ───────────── Helpers for the UI ─────────────
  const clone = (x) => JSON.parse(JSON.stringify(x));
  // What an enemy's telegraphed attack will hit right now (it follows the enemy if pushed).
  function intentTile(b, u) {
    if (u.side !== 'enemy' || u.intent == null) return null;
    return strikeTile(b, u, u.x, u.y, u.intent);
  }
  function heroesLeft(b) { return b.units.filter((u) => u.side === 'hero').length; }

  return {
    W, H, DIRS, HEROES, HERO_ORDER, ENEMIES, BATTLES, ISLANDS, REWARDS, START_POWER, MAX_POWER,
    newRun, newBattle, reach, targets, area, act, move, endTurn, intentTile, takeReward,
    tileAt, unitAt, inB, clone, heroesLeft, objectiveDone, flight,
  };
});
