// Тяни штифт — pure rules for the pin-pull puzzle. No DOM, so the same file runs in the browser and in Node
// (tests and the level solver). The world is a W×H grid of cells handled by a deterministic cellular automaton:
// cells are processed bottom to top, sideways/diagonal choices follow the parity of (x + y + tick), no rng.
(function (root) {
  'use strict';

  const W = 36, H = 54;
  const EMPTY = 0, WALL = 1, PIN = 2, WATER = 3, LAVA = 4, STONE = 5, GOLD = 6;
  const FILL_TYPES = { water: WATER, lava: LAVA, gold: GOLD };
  const HANDLES = ['left', 'right', 'top'];

  const SETTLE_TICKS = 20;  // no cell changed for this many ticks → settled
  const MAX_TICKS = 3000;   // hard cap after the last pull (or the start)
  // Sideways budget of a liquid cell. A fall (straight or diagonal) refills it, every sideways step spends one.
  // Without it a thin puddle on a flat floor would wander forever and the level would never settle.
  const FLOW = 24;

  const KILL_LAVA = 3;      // an enemy dies when this many lava cells touch its box
  // Not a grid code: what the automaton sees in a cell covered by a live hero or enemy box (solid).
  const BODY = 7;

  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  const isSolid = (c) => c === WALL || c === PIN || c === STONE || c === BODY;

  // ── Level building ──
  function checkRect(r, what) {
    if (!r || typeof r !== 'object') throw new Error(`${what}: not a rectangle`);
    for (const k of ['x', 'y', 'w', 'h']) {
      if (!Number.isInteger(r[k])) throw new Error(`${what}: ${k} must be an integer`);
    }
    if (r.w < 1 || r.h < 1) throw new Error(`${what}: empty rectangle`);
    if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) throw new Error(`${what}: out of bounds`);
  }

  function eachCell(r, fn) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) fn(idx(x, y));
  }

  const box = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h });

  // The cell where a pin's handle (the ring the player grabs) sits: just past the pin's end on the handle side,
  // in the middle of that end. Levels keep it free of rock.
  function handleCell(p) {
    if (p.handle === 'left') return { x: p.x - 1, y: p.y + ((p.h - 1) >> 1) };
    if (p.handle === 'right') return { x: p.x + p.w, y: p.y + ((p.h - 1) >> 1) };
    return { x: p.x + ((p.w - 1) >> 1), y: p.y - 1 };
  }

  // Rasterizes a level definition onto a fresh grid. Walls may overlap each other (they are a union);
  // pins, fills, the hero and enemies must not overlap anything. Throws on invalid input.
  function buildLevel(def) {
    if (!def || typeof def !== 'object') throw new Error('level: not an object');
    const grid = new Uint8Array(W * H);
    const pinId = new Int8Array(W * H).fill(-1);
    const flow = new Uint8Array(W * H);
    // Cells covered by entities: 0 free, 1 the hero, 2 + k enemy k. Entities are boxes, not grid cells,
    // but the automaton treats a live entity's box as solid.
    const body = new Uint8Array(W * H);

    (def.walls || []).forEach((r, n) => {
      checkRect(r, `wall ${n}`);
      eachCell(r, (i) => { grid[i] = WALL; });
    });

    const pins = [];
    const ids = new Set();
    (def.pins || []).forEach((p, n) => {
      checkRect(p, `pin ${n}`);
      if (!Number.isInteger(p.id) || p.id < 0 || p.id > 127) throw new Error(`pin ${n}: bad id`);
      if (ids.has(p.id)) throw new Error(`pin ${n}: duplicate id ${p.id}`);
      if (!HANDLES.includes(p.handle)) throw new Error(`pin ${n}: bad handle`);
      ids.add(p.id);
      eachCell(p, (i) => {
        if (grid[i] !== EMPTY) throw new Error(`pin ${p.id}: overlaps`);
        grid[i] = PIN;
        pinId[i] = p.id;
      });
      pins.push({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, handle: p.handle, pulled: false });
    });

    (def.fills || []).forEach((f, n) => {
      checkRect(f, `fill ${n}`);
      const type = FILL_TYPES[f.type];
      if (!type) throw new Error(`fill ${n}: bad type`);
      eachCell(f, (i) => {
        if (grid[i] !== EMPTY) throw new Error(`fill ${n}: overlaps`);
        grid[i] = type;
        if (type !== GOLD) flow[i] = FLOW;
      });
    });

    const claim = (r, what, mark) => {
      checkRect(r, what);
      eachCell(r, (i) => {
        if (grid[i] !== EMPTY || body[i]) throw new Error(`${what}: overlaps`);
        body[i] = mark;
      });
      return box(r);
    };
    const hero = def.hero ? claim(def.hero, 'hero', 1) : null;
    const enemies = (def.enemies || []).map((e, n) => ({ ...claim(e, `enemy ${n}`, 2 + n), dead: false }));
    if (def.room) checkRect(def.room, 'room');
    if (def.exit) checkRect(def.exit, 'exit');

    const s = {
      tick: 0,
      quiet: 0,      // ticks in a row with no change
      sincePull: 0,  // ticks since the last pull (or the start)
      lost: null,    // latched instant loss: 'lava' | 'enemy'
      grid, pinId, flow, body, pins, hero, enemies,
      room: def.room ? box(def.room) : null,
      exit: def.exit ? box(def.exit) : null,
      goldTarget: Number.isInteger(def.goldTarget) ? def.goldTarget : 0,
    };
    checkEntities(s);
    return s;
  }

  function clone(s) {
    return {
      tick: s.tick, quiet: s.quiet, sincePull: s.sincePull, lost: s.lost,
      grid: s.grid.slice(), pinId: s.pinId.slice(), flow: s.flow.slice(), body: s.body.slice(),
      pins: s.pins.map((p) => ({ ...p })),
      hero: s.hero ? box(s.hero) : null,
      enemies: s.enemies.map((e) => ({ ...e })),
      room: s.room ? box(s.room) : null,
      exit: s.exit ? box(s.exit) : null,
      goldTarget: s.goldTarget,
    };
  }

  // ── Player action ──
  // Pulls a pin out: its cells become empty. Returns false for an unknown or already pulled pin.
  function pull(s, id) {
    const pin = s.pins.find((p) => p.id === id);
    if (!pin || pin.pulled) return false;
    pin.pulled = true;
    for (let i = 0; i < W * H; i++) {
      if (s.grid[i] === PIN && s.pinId[i] === id) {
        s.grid[i] = EMPTY;
        s.pinId[i] = -1;
      }
    }
    s.quiet = 0;
    s.sincePull = 0;
    checkEntities(s); // the pulled pin may have opened the way between an enemy and the hero
    return true;
  }

  // ── Automaton ──
  const moved = new Uint8Array(W * H); // scratch: a cell moves at most once per tick

  function swap(s, a, b) {
    const g = s.grid, f = s.flow;
    const c = g[a]; g[a] = g[b]; g[b] = c;
    const v = f[a]; f[a] = f[b]; f[b] = v;
    moved[a] = 1;
    moved[b] = 1;
  }

  // What the automaton sees: grid code, BODY for a live entity's box, WALL outside the grid.
  function cell(s, x, y) {
    if (!inside(x, y)) return WALL;
    const i = idx(x, y);
    return s.body[i] ? BODY : s.grid[i];
  }

  // Water and lava: down → diagonally down (preferred side first) → one cell sideways (preferred side only,
  // while the flow budget lasts). The diagonal step needs the side cell free of solids so nothing leaks
  // through a corner.
  function moveLiquid(s, x, y, d) {
    const i = idx(x, y);
    if (cell(s, x, y + 1) === EMPTY) {
      const j = idx(x, y + 1);
      swap(s, i, j);
      s.flow[j] = FLOW;
      return true;
    }
    for (const dd of [d, -d]) {
      if (cell(s, x + dd, y + 1) === EMPTY && !isSolid(cell(s, x + dd, y))) {
        const j = idx(x + dd, y + 1);
        swap(s, i, j);
        s.flow[j] = FLOW;
        return true;
      }
    }
    if (s.flow[i] > 0 && cell(s, x + d, y) === EMPTY) {
      const j = idx(x + d, y);
      swap(s, i, j);
      s.flow[j]--;
      return true;
    }
    return false;
  }

  // Gold is like sand: down, then diagonally down, never sideways. It sinks through liquids by swapping
  // places with them; the displaced liquid gets a fresh flow budget.
  const sinkable = (c) => c === EMPTY || c === WATER || c === LAVA;
  function moveGold(s, x, y, d) {
    const i = idx(x, y);
    const tryTo = (tx, ty) => {
      const j = idx(tx, ty);
      const liquid = s.grid[j] !== EMPTY;
      swap(s, i, j);
      if (liquid) s.flow[i] = FLOW;
      return true;
    };
    if (sinkable(cell(s, x, y + 1))) return tryTo(x, y + 1);
    for (const dd of [d, -d]) {
      if (sinkable(cell(s, x + dd, y + 1)) && !isSolid(cell(s, x + dd, y))) return tryTo(x + dd, y + 1);
    }
    return false;
  }

  const NEIGHBOURS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  // Lava destroys every gold cell it touches; touching water turns the lava cell into stone and
  // the (first) water cell into empty. Returns true if anything changed.
  function react(s, x, y) {
    let changed = false;
    for (const [dx, dy] of NEIGHBOURS) {
      if (cell(s, x + dx, y + dy) === GOLD) {
        s.grid[idx(x + dx, y + dy)] = EMPTY;
        changed = true;
      }
    }
    for (const [dx, dy] of NEIGHBOURS) {
      if (cell(s, x + dx, y + dy) === WATER) {
        const i = idx(x, y), j = idx(x + dx, y + dy);
        s.grid[i] = STONE;
        s.grid[j] = EMPTY;
        s.flow[i] = 0;
        s.flow[j] = 0;
        moved[i] = 1;
        moved[j] = 1;
        return true;
      }
    }
    return changed;
  }

  // One tick (the client runs 60 ticks per second). Returns true if any cell changed.
  function step(s) {
    const t = s.tick;
    s.tick++;
    s.sincePull++;
    // A grid that stayed the same for two ticks (both parities) can never change again on its own.
    if (s.quiet >= SETTLE_TICKS) {
      s.quiet++;
      return false;
    }
    moved.fill(0);
    const g = s.grid;
    let changed = false;
    for (let y = H - 1; y >= 0; y--) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        if (moved[i]) continue;
        const c = g[i];
        if (c !== WATER && c !== LAVA && c !== GOLD) continue;
        const d = (x + y + t) & 1 ? 1 : -1;
        if (c === WATER) {
          if (moveLiquid(s, x, y, d)) changed = true;
        } else if (c === LAVA) {
          if (react(s, x, y)) changed = true;
          if (g[i] === LAVA && !moved[i] && t % 2 === 0 && moveLiquid(s, x, y, d)) changed = true;
        } else if (moveGold(s, x, y, d)) {
          changed = true;
        }
      }
    }
    if (changed && checkEntities(s)) changed = true;
    s.quiet = changed ? 0 : s.quiet + 1;
    return changed;
  }

  // ── Entities ──
  // Lava cells touching a box: inside it or 4-adjacent to it (the box's ring without the corners).
  function lavaTouching(s, r) {
    let n = 0;
    for (let y = r.y - 1; y <= r.y + r.h; y++) {
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        const outX = x < r.x || x >= r.x + r.w, outY = y < r.y || y >= r.y + r.h;
        if (outX && outY) continue; // corner: touches diagonally only
        if (inside(x, y) && s.grid[idx(x, y)] === LAVA) n++;
      }
    }
    return n;
  }

  const passable = (c) => c === EMPTY || c === WATER || c === GOLD;
  const queue = new Int16Array(W * H);
  const seen = new Uint8Array(W * H);

  // Flood fill over passable cells (empty, water, gold) from every live enemy's box: true if it reaches the hero.
  // Entity boxes are empty in the grid, so they are passable too.
  function enemyReachesHero(s) {
    const live = s.enemies.filter((e) => !e.dead);
    if (!s.hero || live.length === 0) return false;
    seen.fill(0);
    let head = 0, tail = 0;
    for (const e of live) eachCell(e, (i) => { seen[i] = 1; queue[tail++] = i; });
    while (head < tail) {
      const i = queue[head++];
      if (s.body[i] === 1) return true;
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        if (seen[j] || !passable(s.grid[j])) continue;
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
    return false;
  }

  // Kills enemies burnt by lava (their boxes become free) and latches an instant loss: lava touching
  // the hero, or a live enemy connected to the hero. Returns true if an enemy died (the grid's solids changed).
  function checkEntities(s) {
    let died = false;
    s.enemies.forEach((e, k) => {
      if (e.dead || lavaTouching(s, e) < KILL_LAVA) return;
      e.dead = true;
      died = true;
      eachCell(e, (i) => { if (s.body[i] === 2 + k) s.body[i] = 0; });
    });
    if (died) s.quiet = 0;
    if (!s.lost && s.hero) {
      if (lavaTouching(s, s.hero) > 0) s.lost = 'lava';
      else if (enemyReachesHero(s)) s.lost = 'enemy';
    }
    return died;
  }

  const settled = (s) => s.quiet >= SETTLE_TICKS || s.sincePull >= MAX_TICKS;

  // Runs the automaton until it settles (or hits the tick cap). Returns the number of ticks run.
  function settle(s) {
    let n = 0;
    while (!settled(s)) {
      step(s);
      n++;
    }
    return n;
  }

  function count(s, type, r) {
    let n = 0;
    if (r) eachCell(r, (i) => { if (s.grid[i] === type) n++; });
    else for (let i = 0; i < W * H; i++) if (s.grid[i] === type) n++;
    return n;
  }

  // The grid code of a cell (entities are not cells: a box reads as what lies under it); WALL outside.
  const cellAt = (s, x, y) => (inside(x, y) ? s.grid[idx(x, y)] : WALL);

  const goldInRoom = (s) => (s.room ? count(s, GOLD, s.room) : 0);
  const liveEnemies = (s) => s.enemies.filter((e) => !e.dead).length;

  // Lava in the room on the hero's way to the exit: the rows of the hero's box between the hero and the door.
  function lavaOnWay(s) {
    if (!s.hero || !s.exit) return false;
    const h = s.hero, e = s.exit;
    const x0 = Math.min(h.x, e.x), x1 = Math.max(h.x + h.w, e.x + e.w);
    for (let y = h.y; y < h.y + h.h; y++) {
      for (let x = x0; x < x1; x++) {
        if (s.room && (x < s.room.x || x >= s.room.x + s.room.w || y < s.room.y || y >= s.room.y + s.room.h)) continue;
        if (inside(x, y) && s.grid[idx(x, y)] === LAVA) return true;
      }
    }
    return false;
  }

  // { status: 'playing' | 'won' | 'lost', reason: null | 'lava' | 'enemy' | 'nogold' }.
  // Lava on the hero and an enemy reaching the hero lose at once. Otherwise nothing is decided until the
  // automaton settles: then enough gold in the room and a lava-free way to the exit win; short of that the
  // player may still pull a pin, and with no pins left it's a loss ('lava' if lava blocks the way, else 'nogold').
  function status(s) {
    if (s.lost) return { status: 'lost', reason: s.lost };
    if (!settled(s)) return { status: 'playing', reason: null };
    const blocked = lavaOnWay(s);
    if (!blocked && goldInRoom(s) >= s.goldTarget) return { status: 'won', reason: null };
    if (s.pins.some((p) => !p.pulled)) return { status: 'playing', reason: null };
    return { status: 'lost', reason: blocked ? 'lava' : 'nogold' };
  }

  // 0 unless won; 3 with every enemy dead and ≥1.5× goldTarget gold, 2 when either holds, otherwise 1.
  function stars(s) {
    if (status(s).status !== 'won') return 0;
    const allDead = liveEnemies(s) === 0;
    const rich = goldInRoom(s) * 2 >= s.goldTarget * 3;
    return 1 + (allDead ? 1 : 0) + (rich ? 1 : 0);
  }

  // Runs until the automaton settles or an instant loss happens (a patient player waits for that).
  function rest(s) {
    while (!s.lost && !settled(s)) step(s);
  }

  // Tries pull orders of every subset of pins (DFS). After each pull the world runs to rest; the snapshot of
  // each prefix is kept and cloned for its continuations, so a prefix is simulated once. A won prefix is a
  // winning order (the game ends there), a lost one is a losing order.
  // Returns { wins: [[ids]], losses: [[ids]], wonWithoutPull, nodes }.
  function solve(def) {
    const start = buildLevel(def);
    rest(start);
    const res = { wins: [], losses: [], wonWithoutPull: false, nodes: 1 };
    const st = status(start);
    if (st.status === 'won') { res.wonWithoutPull = true; return res; }
    if (st.status === 'lost') { res.losses.push([]); return res; }
    (function dfs(s, order) {
      for (const p of s.pins) {
        if (p.pulled) continue;
        const next = clone(s);
        pull(next, p.id);
        rest(next);
        res.nodes++;
        const seq = [...order, p.id];
        const r = status(next).status;
        if (r === 'won') res.wins.push(seq);
        else if (r === 'lost') res.losses.push(seq);
        else dfs(next, seq);
      }
    })(start, []);
    return res;
  }

  const api = {
    W, H, EMPTY, WALL, PIN, WATER, LAVA, STONE, GOLD, FILL_TYPES, HANDLES, SETTLE_TICKS, MAX_TICKS, FLOW, KILL_LAVA,
    idx, handleCell, buildLevel, clone, pull, step, settled, settle, count, cellAt,
    goldInRoom, liveEnemies, status, stars, solve,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PinsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
