#!/usr/bin/env node
// Тесная парковка — level generator (a dev tool, not part of `node --test`).
//   node tests/parking/generate.js > web/parking/levels.js
// For each of the 40 levels it throws random boards (seeded, so the output is reproducible), explores the whole
// state graph reachable from each board (positions + move parity), and computes for every state its distance to
// the exit by a backward BFS. A state with even parity at exactly the level's target distance becomes the level
// (the "farthest state" trick: random boards alone are almost always easy). Among the candidates it prefers the
// ones whose optimal path moves the most different vehicles — blocking chains, not a crowd of idle cars.
// A barrier level must need its barrier: with every barrier open the optimum has to be shorter. When the level's
// regular pick doesn't qualify, a dedicated search (its own seed, so the other levels stay as they were) builds
// a board whose barrier really slows it down.
// Each pick is verified with ParkingCore.solve, which is the authority on `optimal`. Progress goes to stderr.
// A full run takes 20–30 minutes plus the barrier searches; `--fix-barriers` redoes only the barrier levels
// whose barrier doesn't matter in the committed levels.js (with the same result as a full run), and
// `--only=n,m` limits that to some levels so the work can be split between processes.
'use strict';
const P = require('../../web/parking/core.js');

const SEED = 20261014;
const COUNT = 40;
const EXPLORE_CAP = 150000;   // a board whose state graph is larger is skipped
const TRIES = 4000;           // random boards per level before giving up
const CANDIDATES = 12;        // good boards collected per level before picking the best

// mulberry32
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── The difficulty curve (see the plan, Technical Details §3) ──
// target optimum per level; levels 1–25 are 6×6, 26–40 are 7×7; barriers / tow trucks from level 12.
const TARGETS = [
  2, 3, 3, 4, 5,                                                 // 1–5   : 2–5
  6, 6, 7, 7, 8, 8, 9, 9, 10, 10,                                // 6–15  : 6–10
  10, 11, 11, 12, 12, 13, 14, 14, 15, 16,                        // 16–25 : 10–16
  14, 15, 15, 16, 17, 17, 18, 19, 19, 20, 21, 22, 23, 24, 25,    // 26–40 : 14–25
];

function config(n) { // n is 1-based
  const size = n >= 26 ? 7 : 6;
  // from level 12 every level has a special: barrier, tow truck, or both, in turn
  const special = n < 12 ? 'none' : ['gate', 'tow', 'both'][(n - 12) % 3];
  const gates = special === 'gate' || special === 'both' ? (n >= 30 ? 2 : 1) : 0;
  const tows = special === 'tow' || special === 'both' ? 1 : 0;
  const bollards = n <= 5 ? 0 : n <= 15 ? 1 : 2;
  // vehicles besides X: dense boards have small state graphs and the long solutions
  const fill = size === 7 ? [16, 21] : n >= 16 ? [9, 13] : [7, 11];
  return { n, size, target: TARGETS[n - 1], gates, tows, bollards, fill };
}

// ── Random board ──
function randomBoard(cfg, rand) {
  const w = cfg.size, h = cfg.size;
  const exitRow = (h - 1) >> 1;
  const g = Array.from({ length: h }, () => Array(w).fill('.'));
  const ri = (k) => Math.floor(rand() * k);
  const free = (x, y) => x >= 0 && y >= 0 && x < w && y < h && g[y][x] === '.';

  const px = ri(w - 3);
  g[exitRow][px] = g[exitRow][px + 1] = 'X';

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWYZ'.split('');
  const vehicles = {};
  const want = cfg.fill[0] + ri(cfg.fill[1] - cfg.fill[0] + 1);
  let towLeft = cfg.tows;
  let placed = 0;
  for (let attempt = 0; placed < want && attempt < 400; attempt++) {
    const isTow = towLeft > 0;
    const len = isTow ? 2 + ri(2) : rand() < 0.25 ? 3 : 2;
    const dir = rand() < 0.5 ? 'h' : 'v';
    const x = ri(w), y = ri(h);
    if (dir === 'h' && y === exitRow) continue; // a horizontal car in the exit row could never clear it
    const cellsOf = [];
    for (let k = 0; k < len; k++) cellsOf.push(dir === 'h' ? [x + k, y] : [x, y + k]);
    if (!cellsOf.every(([cx, cy]) => free(cx, cy))) continue;
    // a tow truck is only interesting across the exit row (it has to be dragged out of the way)
    if (isTow && !(dir === 'v' && y <= exitRow && y + len > exitRow && x > px + 1)) continue;
    const id = letters[placed++];
    for (const [cx, cy] of cellsOf) g[cy][cx] = id;
    if (isTow) { vehicles[id] = 'tow'; towLeft--; }
  }
  if (towLeft > 0) return null;

  const drop = (count, ch, where) => {
    for (let attempt = 0; count > 0 && attempt < 200; attempt++) {
      const x = ri(w), y = ri(h);
      if (!free(x, y) || !where(x, y)) continue;
      g[y][x] = ch;
      count--;
    }
    return count === 0;
  };
  // barriers sit right of X in the exit row half the time (X has to time its run), anywhere else otherwise
  for (let i = 0; i < cfg.gates; i++) {
    const inRow = i === 0 && rand() < 0.5;
    if (!drop(1, '|', (x, y) => (inRow ? y === exitRow && x > px + 1 : y !== exitRow))) return null;
  }
  if (!drop(cfg.bollards, '#', (x, y) => y !== exitRow)) return null;

  const def = { rows: g.map((r) => r.join('')) };
  if (Object.keys(vehicles).length) def.vehicles = vehicles;
  return def;
}

// ── Full state graph and distances to the exit ──
// Geometry mirrors core.js (span/occupancy); core.solve re-checks every pick.
// `open`: every barrier stays open (the board as if the barriers were not there).
function explore(L, open = false) {
  const { w, h, cells, vehicles } = L;
  const n = vehicles.length;
  const px = vehicles.findIndex((v) => v.id === P.PLAYER);
  const occOf = (p) => {
    const occ = new Int8Array(w * h);
    vehicles.forEach((v, i) => {
      for (let k = 0; k < v.len; k++) {
        const x = v.dir === 'h' ? p[i] + k : v.x;
        const y = v.dir === 'v' ? p[i] + k : v.y;
        occ[y * w + x] = i + 1;
      }
    });
    return occ;
  };
  const blocked = (occ, x, y, closed) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return true;
    const j = y * w + x;
    const c = cells[j];
    return occ[j] !== 0 || c === P.BOLLARD || (c === P.GATE && closed);
  };
  const keyOf = (p, par) => String.fromCharCode(...p) + par;

  const start = vehicles.map((v) => (v.dir === 'h' ? v.x : v.y));
  const states = [start];
  const pars = [0];
  const index = new Map([[keyOf(start, 0), 0]]);
  const succ = [];      // succ[s] = [t, ...]
  const exitAt = [];    // X can leave from s in one move
  for (let s = 0; s < states.length; s++) {
    const p = states[s];
    const par = pars[s];
    const closed = !open && par === 0;
    const occ = occOf(p);
    const out = [];
    let canExit = false;
    for (let i = 0; i < n; i++) {
      const v = vehicles[i];
      const reach = v.kind === 'tow' ? P.TOW_STEP : Infinity;
      const at = (c) => (v.dir === 'h' ? [c, v.y] : [v.x, c]);
      const add = (d) => {
        const q = p.slice();
        q[i] += d;
        const key = keyOf(q, 1 - par);
        let t = index.get(key);
        if (t === undefined) {
          t = states.length;
          index.set(key, t);
          states.push(q);
          pars.push(1 - par);
        }
        out.push(t);
      };
      for (let d = 1; d <= reach; d++) {
        const [x, y] = at(p[i] + v.len + d - 1);
        if (i === px && x === w) { canExit = true; break; }
        if (blocked(occ, x, y, closed)) break;
        add(d);
      }
      for (let d = 1; d <= reach; d++) {
        const [x, y] = at(p[i] - d);
        if (blocked(occ, x, y, closed)) break;
        add(-d);
      }
    }
    succ.push(out);
    exitAt.push(canExit);
    if (states.length > EXPLORE_CAP) return null;
  }
  // backward BFS from the states that can leave
  const N = states.length;
  const pred = Array.from({ length: N }, () => []);
  for (let s = 0; s < N; s++) for (const t of succ[s]) pred[t].push(s);
  const dist = new Int32Array(N).fill(-1);
  const queue = [];
  for (let s = 0; s < N; s++) if (exitAt[s]) { dist[s] = 1; queue.push(s); }
  for (let qi = 0; qi < queue.length; qi++) {
    const t = queue[qi];
    for (const s of pred[t]) if (dist[s] < 0) { dist[s] = dist[t] + 1; queue.push(s); }
  }
  return { states, pars, dist, index, keyOf };
}

// The level with every barrier replaced by an empty cell.
function withoutGates(def) {
  const open = { rows: def.rows.map((r) => r.split(P.GATE).join(P.EMPTY)) };
  if (def.vehicles) open.vehicles = def.vehicles;
  return open;
}

// True when the barriers lengthen the optimum: the same board with them open is solved faster.
function gateMatters(def, optimal) {
  const sol = P.solve(withoutGates(def));
  return !!sol && sol.moves < optimal;
}

// Cells of a level's barriers and a test whether positions p put a vehicle on one (the text format can't show that).
function gateTest(L) {
  const gateCells = [];
  L.cells.forEach((c, j) => { if (c === P.GATE) gateCells.push(j); });
  return (p) => gateCells.length > 0 && L.vehicles.some((v, i) => {
    for (let k = 0; k < v.len; k++) {
      const x = v.dir === 'h' ? p[i] + k : v.x;
      const y = v.dir === 'v' ? p[i] + k : v.y;
      if (gateCells.includes(y * L.w + x)) return true;
    }
    return false;
  });
}

// A candidate from a state's definition, or null when it breaks a rule (solver check, tow truck in the solution).
function candidate(def, cfg, meta, k) {
  const sol = P.solve(def);
  if (!sol || sol.moves !== cfg.target) throw new Error(`level ${cfg.n}: core.solve disagrees (${sol && sol.moves})`);
  if (cfg.tows && !sol.path.some(([id]) => meta[id] === 'tow')) return null;
  return { def, sol, movers: new Set(sol.path.map(([id]) => id)).size, k };
}

// Barrier levels whose regular candidates all ignore the barrier. Random boards rarely make a barrier matter,
// so this search builds it in: a board without barriers (from a per-level stream), a state 1–2 moves short of the
// target, then barriers dropped on its empty cells (the first one in the exit row only right of X, the second off
// it, as in randomBoard) until the solver says the barriers stretch the optimum to exactly the target.
const GATE_DROPS = 10;        // barrier placements tried per state
const GATE_CANDIDATES = 6;    // the search is slow on 7×7: fewer candidates than the regular one

function gateSearch(cfg, seen) {
  const rand = rng(SEED + cfg.n * 7919);
  const plain = { ...cfg, gates: 0 };
  const cands = [];
  let tries = 0;
  for (; tries < TRIES && cands.length < GATE_CANDIDATES; tries++) {
    const board = randomBoard(plain, rand);
    if (!board) continue;
    let L;
    try { L = P.parseLevel(board); } catch (e) { continue; }
    const g = explore(L);
    if (!g) continue;
    const pick = [];
    for (let s = 0; s < g.states.length; s++) {
      if (g.pars[s] === 0 && g.dist[s] >= cfg.target - 2 && g.dist[s] < cfg.target) pick.push(s);
    }
    for (let k = 0; k < 4 && pick.length; k++) {
      const s = pick.splice(Math.floor(rand() * pick.length), 1)[0];
      const base = defAt(L, g.states[s], board.vehicles);
      const rows = base.rows.map((r) => r.split(''));
      const px = rows[L.exitRow].indexOf(P.PLAYER);
      const spots = (first) => {
        const out = [];
        rows.forEach((r, y) => r.forEach((c, x) => {
          if (c === P.EMPTY && (y !== L.exitRow || (first && x > px + 1))) out.push([x, y]);
        }));
        return out;
      };
      for (let d = 0; d < GATE_DROPS; d++) {
        const put = [];
        for (let i = 0; i < cfg.gates; i++) {
          const free = spots(i === 0).filter(([x, y]) => !put.some(([u, v]) => u === x && v === y));
          if (!free.length) break;
          put.push(free[Math.floor(rand() * free.length)]);
        }
        if (put.length < cfg.gates) break;
        const def = { rows: rows.map((r, y) => r.map((c, x) => (put.some(([u, v]) => u === x && v === y) ? P.GATE : c)).join('')) };
        if (base.vehicles) def.vehicles = base.vehicles;
        if (seen.has(keyOfDef(def))) continue;
        const sol = P.solve(def);
        if (!sol || sol.moves !== cfg.target) continue;
        const c = candidate(def, cfg, board.vehicles || {}, tries);
        if (!c || c.movers * 2 < cfg.target) continue; // a blocking chain, as levels.test.js asks
        if (!gateMatters(def, cfg.target)) throw new Error(`level ${cfg.n}: core.solve disagrees on the open board`);
        process.stderr.write(`  level ${cfg.n}: barrier search, candidate ${cands.length + 1} on board ${tries}\n`);
        cands.push(c);
        break;
      }
    }
  }
  return { cands, tries };
}

// Rebuilds a level definition with the vehicles at positions p.
function defAt(L, p, meta) {
  const vs = L.vehicles.map((v, i) => ({ ...v, x: v.dir === 'h' ? p[i] : v.x, y: v.dir === 'v' ? p[i] : v.y }));
  const def = { rows: P.toRows(L, vs) };
  if (meta) def.vehicles = meta;
  return def;
}

const keyOfDef = (def) => def.rows.join('/') + '|' + JSON.stringify(def.vehicles || {});

// The barrier search's best candidate (most vehicles moving), or an error when it found none.
function pickGated(cfg, seen) {
  const { cands, tries } = gateSearch(cfg, seen);
  if (!cands.length) throw new Error(`level ${cfg.n}: no barrier board with optimum ${cfg.target} in ${tries} tries`);
  cands.sort((a, b) => b.movers - a.movers || a.k - b.k);
  return { ...cands[0], tries };
}

// What a full run would do to the barrier levels, without redoing the rest: every level of `old` (the committed
// LEVELS) is kept, except barrier levels whose barrier doesn't matter, which go through the barrier search — the
// same per-level search a full run falls back to. `only` (level numbers) limits the work, e.g. to split it
// between processes.
function fixBarriers(old, only = null) {
  const seen = new Set();
  const levels = [];
  for (let n = 1; n <= COUNT; n++) {
    const cfg = config(n);
    let level = old[n - 1];
    if (cfg.gates && (!only || only.includes(n)) && !gateMatters(level, level.optimal)) {
      const best = pickGated(cfg, seen);
      level = { rows: best.def.rows };
      if (best.def.vehicles) level.vehicles = best.def.vehicles;
      level.optimal = best.sol.moves;
      process.stderr.write(`level ${n}: barrier board, optimal ${level.optimal}, ${best.movers} vehicles move, ` +
        `${best.tries} boards\n`);
    }
    seen.add(keyOfDef(level));
    levels.push(level);
  }
  return levels;
}

function generate() {
  const rand = rng(SEED);
  const seen = new Set();
  const levels = [];
  for (let n = 1; n <= COUNT; n++) {
    const cfg = config(n);
    let cands = [];
    let tries = 0;
    for (; tries < TRIES && cands.length < CANDIDATES; tries++) {
      const board = randomBoard(cfg, rand);
      if (!board) continue;
      let L;
      try { L = P.parseLevel(board); } catch (e) { continue; }
      const g = explore(L);
      if (!g) continue;
      // the text format can't show a vehicle standing on a barrier, so such states are not offered
      const onGate = gateTest(L);
      const pick = [];
      for (let s = 0; s < g.states.length; s++) {
        if (g.pars[s] === 0 && g.dist[s] === cfg.target && !onGate(g.states[s])) pick.push(s);
      }
      if (!pick.length) continue;
      // a few states of this board: keep the one that moves the most vehicles
      for (let k = 0; k < 6 && pick.length; k++) {
        const s = pick.splice(Math.floor(rand() * pick.length), 1)[0];
        const def = defAt(L, g.states[s], board.vehicles);
        if (seen.has(keyOfDef(def))) continue;
        const c = candidate(def, cfg, board.vehicles || {}, tries);
        if (c) cands.push(c);
      }
    }
    if (!cands.length) throw new Error(`level ${n}: no board with optimum ${cfg.target} in ${TRIES} tries`);
    cands.sort((a, b) => b.movers - a.movers || a.k - b.k);
    let best = cands[0];
    // a barrier level keeps its regular pick only when the barrier matters there; the regular search ran in full
    // either way, so the shared random stream (and every other level) does not depend on this
    if (cfg.gates && !gateMatters(best.def, cfg.target)) {
      best = pickGated(cfg, seen);
      tries += best.tries;
    }
    const level = { rows: best.def.rows };
    if (best.def.vehicles) level.vehicles = best.def.vehicles;
    level.optimal = best.sol.moves;
    seen.add(keyOfDef(level));
    levels.push(level);
    process.stderr.write(`level ${n}: ${cfg.size}×${cfg.size} optimal ${level.optimal}, ` +
      `${best.movers} vehicles move, ${tries} boards\n`);
  }
  return levels;
}

function render(levels) {
  const out = [];
  out.push('// Тесная парковка — the 40 levels. GENERATED by tests/parking/generate.js, do not edit by hand:');
  out.push('//   node tests/parking/generate.js > web/parking/levels.js');
  out.push('// A level is { rows, vehicles?, optimal } in the ParkingCore.parseLevel format; `optimal` is the BFS optimum.');
  out.push('(function (root) {');
  out.push("  'use strict';");
  out.push('');
  out.push('  const LEVELS = [');
  levels.forEach((l, i) => {
    out.push(`    { // ${i + 1}`);
    out.push('      rows: [');
    for (const r of l.rows) out.push(`        '${r}',`);
    out.push('      ],');
    if (l.vehicles) {
      const parts = Object.keys(l.vehicles).sort().map((id) => `${id}: '${l.vehicles[id]}'`);
      out.push(`      vehicles: { ${parts.join(', ')} },`);
    }
    out.push(`      optimal: ${l.optimal},`);
    out.push('    },');
  });
  out.push('  ];');
  out.push('');
  out.push('  const api = { LEVELS };');
  out.push('  if (typeof module !== \'undefined\' && module.exports) module.exports = api;');
  out.push('  else root.ParkingLevels = api;');
  out.push('})(typeof window !== \'undefined\' ? window : globalThis);');
  return out.join('\n') + '\n';
}

if (require.main === module) {
  // node tests/parking/generate.js [--fix-barriers [--only=12,17]] > web/parking/levels.js
  const args = process.argv.slice(2);
  const only = args.find((a) => a.startsWith('--only='));
  if (args.includes('--fix-barriers')) {
    const { LEVELS } = require('../../web/parking/levels.js');
    process.stdout.write(render(fixBarriers(LEVELS, only ? only.slice(7).split(',').map(Number) : null)));
  } else {
    process.stdout.write(render(generate()));
  }
}

module.exports = { rng, config, randomBoard, explore, withoutGates, gateMatters, gateSearch, fixBarriers, generate, render, TARGETS };
