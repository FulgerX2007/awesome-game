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

  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  const isSolid = (c) => c === WALL || c === PIN || c === STONE;

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

  // Rasterizes a level definition onto a fresh grid. Walls may overlap each other (they are a union);
  // pins, fills, the hero and enemies must not overlap anything. Throws on invalid input.
  function buildLevel(def) {
    if (!def || typeof def !== 'object') throw new Error('level: not an object');
    const grid = new Uint8Array(W * H);
    const pinId = new Int8Array(W * H).fill(-1);
    const flow = new Uint8Array(W * H);
    const taken = new Uint8Array(W * H); // cells claimed by entities (they are not cells of the grid)

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

    const claim = (r, what) => {
      checkRect(r, what);
      eachCell(r, (i) => {
        if (grid[i] !== EMPTY || taken[i]) throw new Error(`${what}: overlaps`);
        taken[i] = 1;
      });
      return box(r);
    };
    const hero = def.hero ? claim(def.hero, 'hero') : null;
    const enemies = (def.enemies || []).map((e, n) => claim(e, `enemy ${n}`));
    if (def.room) checkRect(def.room, 'room');
    if (def.exit) checkRect(def.exit, 'exit');

    return {
      tick: 0,
      quiet: 0,      // ticks in a row with no change
      sincePull: 0,  // ticks since the last pull (or the start)
      grid, pinId, flow, pins, hero, enemies,
      room: def.room ? box(def.room) : null,
      exit: def.exit ? box(def.exit) : null,
      goldTarget: Number.isInteger(def.goldTarget) ? def.goldTarget : 0,
    };
  }

  function clone(s) {
    return {
      tick: s.tick, quiet: s.quiet, sincePull: s.sincePull,
      grid: s.grid.slice(), pinId: s.pinId.slice(), flow: s.flow.slice(),
      pins: s.pins.map((p) => ({ ...p })),
      hero: s.hero ? box(s.hero) : null,
      enemies: s.enemies.map(box),
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

  const cell = (s, x, y) => (inside(x, y) ? s.grid[idx(x, y)] : WALL);

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
    s.quiet = changed ? 0 : s.quiet + 1;
    return changed;
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

  const cellAt = (s, x, y) => cell(s, x, y);

  const api = {
    W, H, EMPTY, WALL, PIN, WATER, LAVA, STONE, GOLD, FILL_TYPES, HANDLES, SETTLE_TICKS, MAX_TICKS, FLOW,
    idx, buildLevel, clone, pull, step, settled, settle, count, cellAt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PinsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
