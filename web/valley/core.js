// Долина — hex tile-laying rules. No DOM, so a bot can play it in Node.
// Pointy-top axial hexes. Edge i of a tile faces DIRS[i]; edge i meets edge (i+3)%6 of that neighbour.
(function (root) {
  'use strict';

  const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]; // E, SE, SW, W, NW, NE
  const TERRAINS = ['forest', 'field', 'water', 'village', 'meadow'];
  const WEIGHTS = { forest: 0.27, field: 0.23, meadow: 0.2, water: 0.15, village: 0.15 };
  const QUESTABLE = ['forest', 'field', 'water', 'village'];
  const START_STACK = 40;
  const MAX_QUESTS = 3;

  // mulberry32 with an exposed state, so a saved game continues the same tile sequence.
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.state = () => a;
    return next;
  }

  const key = (q, r) => `${q},${r}`;
  const rotate = (edges, n) => edges.map((_, i) => edges[(((i - n) % 6) + 6) % 6]);

  function pickTerrain(R, not) {
    for (;;) {
      let x = R();
      for (const t of TERRAINS) {
        x -= WEIGHTS[t];
        if (x <= 0) { if (t !== not) return t; break; }
      }
    }
  }

  // 1–3 contiguous runs of terrain around the hex, so tiles read like real landscape.
  function makeTile(R, id) {
    const runs = R() < 0.2 ? 1 : R() < 0.7 ? 2 : 3;
    const lens = runs === 1 ? [6] : runs === 2 ? [1 + Math.floor(R() * 5)] : [1 + Math.floor(R() * 3), 1 + Math.floor(R() * 2)];
    if (runs > 1) lens.push(6 - lens.reduce((a, b) => a + b, 0));
    const edges = [];
    let prev = null;
    for (const len of lens) {
      const t = pickTerrain(R, prev);
      for (let k = 0; k < len; k++) edges.push(t);
      prev = t;
    }
    return { id, edges: rotate(edges, Math.floor(R() * 6)), quest: null };
  }

  function newGame(seed) {
    const g = {
      seed, R: rng(seed), nextId: 0,
      tiles: new Map(), order: [], stack: [], score: 0,
      quests: [], questsDone: 0, questsFailed: 0, perfect: 0, placed: 0, over: false, events: [],
    };
    const first = makeTile(g.R, g.nextId++);
    first.edges = first.edges.map((t) => (t === 'water' ? 'meadow' : t));
    placeRaw(g, 0, 0, first);
    for (let i = 0; i < START_STACK; i++) g.stack.push(drawTile(g));
    return g;
  }

  // New tiles sometimes carry a quest for one of their terrains.
  function drawTile(g) {
    const t = makeTile(g.R, g.nextId++);
    const open = g.quests.filter((q) => q.state === 'open').length + g.stack.filter((s) => s.quest).length;
    if (open < MAX_QUESTS && g.R() < 0.3) {
      const terrains = [...new Set(t.edges)].filter((x) => QUESTABLE.includes(x));
      if (terrains.length) {
        const terrain = terrains[Math.floor(g.R() * terrains.length)];
        const base = terrain === 'water' || terrain === 'village' ? 3 : 4;
        t.quest = { terrain, target: base + Math.floor(g.R() * (4 + Math.min(6, g.placed / 12))) };
      }
    }
    return t;
  }

  function placeRaw(g, q, r, tile) {
    const cell = { q, r, ...tile };
    g.tiles.set(key(q, r), cell);
    g.order.push(cell);
    return cell;
  }

  const current = (g) => g.stack[0] || null;

  function neighbors(g, q, r) {
    return DIRS.map(([dq, dr]) => g.tiles.get(key(q + dq, r + dr)) || null);
  }

  function canPlace(g, q, r) {
    return !g.tiles.has(key(q, r)) && neighbors(g, q, r).some(Boolean);
  }

  // Empty cells next to the map.
  function frontier(g) {
    const out = new Map();
    for (const c of g.order) {
      for (const [dq, dr] of DIRS) {
        const k = key(c.q + dq, c.r + dr);
        if (!g.tiles.has(k) && !out.has(k)) out.set(k, { q: c.q + dq, r: c.r + dr });
      }
    }
    return [...out.values()];
  }

  // What a placement would do, without doing it.
  function evaluate(g, q, r, edges) {
    const nb = neighbors(g, q, r);
    let present = 0, match = 0;
    const sides = nb.map((n, i) => {
      if (!n) return null;
      present++;
      const ok = n.edges[(i + 3) % 6] === edges[i];
      if (ok) match++;
      return ok;
    });
    const perfect = present >= 3 && match === present;
    return { sides, present, match, perfect, points: match * 10 + (perfect ? 30 : 0) };
  }

  // Connected areas of one terrain, measured in tiles. Same-terrain sides of a tile count as joined.
  function regions(g) {
    const parent = new Map();
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    for (const c of g.order) for (const t of new Set(c.edges)) parent.set(`${c.id}:${t}`, `${c.id}:${t}`);
    for (const c of g.order) {
      c.edges.forEach((t, i) => {
        const n = g.tiles.get(key(c.q + DIRS[i][0], c.r + DIRS[i][1]));
        if (n && n.edges[(i + 3) % 6] === t) union(`${c.id}:${t}`, `${n.id}:${t}`);
      });
    }
    const size = new Map();
    for (const k of parent.keys()) { const root = find(k); size.set(root, (size.get(root) || 0) + 1); }
    return { sizeOf: (tileId, terrain) => (parent.has(`${tileId}:${terrain}`) ? size.get(find(`${tileId}:${terrain}`)) : 0) };
  }

  function rotateCurrent(g, dir) {
    const t = current(g);
    if (t) t.edges = rotate(t.edges, dir);
  }

  function place(g, q, r) {
    const tile = current(g);
    if (!tile || g.over || !canPlace(g, q, r)) return null;
    const ev = evaluate(g, q, r, tile.edges);
    g.stack.shift();
    const cell = placeRaw(g, q, r, tile);
    g.placed++;
    g.score += ev.points;
    if (ev.perfect) { g.perfect++; g.stack.push(drawTile(g)); g.events.push({ type: 'perfect', q, r }); }
    if (tile.quest) g.quests.push({ tileId: cell.id, q, r, ...tile.quest, progress: 0, state: 'open' });

    // Quests complete at exactly the target size and fail once a region grows past it.
    const reg = regions(g);
    for (const qu of g.quests) {
      if (qu.state !== 'open') continue;
      qu.progress = reg.sizeOf(qu.tileId, qu.terrain);
      if (qu.progress === qu.target) {
        qu.state = 'done'; g.questsDone++;
        g.score += qu.target * 10;
        for (let i = 0; i < 3; i++) g.stack.push(drawTile(g));
        g.events.push({ type: 'quest', quest: qu });
      } else if (qu.progress > qu.target) {
        qu.state = 'failed'; g.questsFailed++;
        g.events.push({ type: 'questFailed', quest: qu });
      }
    }
    g.events.push({ type: 'place', q, r, ev });
    if (!g.stack.length) { g.over = true; g.events.push({ type: 'over' }); }
    return ev;
  }

  // Plain-data snapshot for localStorage; the RNG is replayed from the seed.
  function serialize(g) {
    return {
      seed: g.seed, rng: g.R.state(), nextId: g.nextId, score: g.score,
      tiles: g.order.map(({ q, r, id, edges }) => ({ q, r, id, edges })),
      stack: g.stack, quests: g.quests, questsDone: g.questsDone, questsFailed: g.questsFailed,
      perfect: g.perfect, placed: g.placed, over: g.over,
    };
  }

  function restore(s) {
    const g = newGame(s.seed);
    Object.assign(g, {
      R: rng(s.rng), nextId: s.nextId, score: s.score, stack: s.stack, quests: s.quests,
      questsDone: s.questsDone, questsFailed: s.questsFailed, perfect: s.perfect, placed: s.placed, over: s.over,
      tiles: new Map(), order: [], events: [],
    });
    for (const t of s.tiles) placeRaw(g, t.q, t.r, { id: t.id, edges: t.edges, quest: null });
    return g;
  }

  // Pixel centre of a hex for a given circumradius.
  function toPixel(q, r, size) {
    return { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r };
  }

  function fromPixel(x, y, size) {
    const qf = (Math.sqrt(3) / 3 * x - y / 3) / size, rf = (2 / 3 * y) / size;
    let rx = Math.round(qf), rz = Math.round(rf), ry = Math.round(-qf - rf);
    const dx = Math.abs(rx - qf), dz = Math.abs(rz - rf), dy = Math.abs(ry + qf + rf);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy <= dz) rz = -rx - ry;
    return { q: rx, r: rz };
  }

  const api = {
    DIRS, TERRAINS, START_STACK, rng, key, rotate, newGame, current, neighbors, canPlace, frontier,
    evaluate, regions, rotateCurrent, place, serialize, restore, toPixel, fromPixel,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ValleyCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
