// Тесная парковка — pure rules for the sliding-car puzzle. No DOM, so the same file runs in the browser and in Node
// (tests, the level generator and the BFS solver). A level is a grid of rows like "..AA.B": letters are vehicles
// (X is the player's red car), '#' is a bollard, '|' is a barrier. The exit is on the right edge in X's row.
// A barrier is closed on odd moves and open on even ones: move k (1-based) may cross it only when k is even.
(function (root) {
  'use strict';

  const MIN_SIZE = 3, MAX_SIZE = 8;
  const MAX_STATES = 200000;   // BFS cap: solve() gives up (null) past this many distinct states
  const PLAYER = 'X';
  const EMPTY = '.', BOLLARD = '#', GATE = '|';
  const KINDS = ['car', 'bus', 'tow'];
  const LENGTHS = { car: [2], bus: [3], tow: [2, 3] };
  const TOW_STEP = 1;          // a tow truck moves at most this many cells per move

  const isLetter = (c) => c >= 'A' && c <= 'Z';
  const isInt = (v) => Number.isInteger(v);

  // ── Level format ──
  // def: { rows: ["..AA.B", ...], vehicles?: { B: 'tow' | 'bus' | { kind, dir } }, optimal?: n }
  // Orientation follows from the cells (every vehicle is 2–3 long); kind defaults to car (2) / bus (3).
  // parseLevel → { w, h, exitRow, cells: ['.', '#', '|', ...] (w·h, vehicles removed),
  //               vehicles: [{ id, kind, dir, len, x, y }] sorted by id, optimal: n | null }
  function parseLevel(def) {
    if (!def || typeof def !== 'object') throw new Error('level must be an object');
    const rows = def.rows;
    if (!Array.isArray(rows) || rows.length < MIN_SIZE || rows.length > MAX_SIZE) throw new Error('bad rows');
    const h = rows.length;
    if (!rows.every((r) => typeof r === 'string')) throw new Error('rows must be strings');
    const w = rows[0].length;
    if (w < MIN_SIZE || w > MAX_SIZE) throw new Error('bad width');
    if (!rows.every((r) => r.length === w)) throw new Error('ragged rows');

    const cells = [];
    const seen = new Map(); // letter → [[x, y], ...]
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = rows[y][x];
        if (c === EMPTY || c === BOLLARD || c === GATE) { cells.push(c); continue; }
        if (!isLetter(c)) throw new Error(`bad cell '${c}' at ${x},${y}`);
        cells.push(EMPTY);
        if (!seen.has(c)) seen.set(c, []);
        seen.get(c).push([x, y]);
      }
    }

    const meta = def.vehicles === undefined ? {} : def.vehicles;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('bad vehicles');
    for (const id of Object.keys(meta)) {
      if (!seen.has(id)) throw new Error(`vehicle ${id} is not on the board`);
    }

    const vehicles = [];
    for (const id of [...seen.keys()].sort()) {
      const pts = seen.get(id);
      const len = pts.length;
      const [x, y] = pts[0]; // row-major scan: the first cell is the top-left one
      let dir;
      if (len >= 2 && pts.every(([px, py], i) => py === y && px === x + i)) dir = 'h';
      else if (len >= 2 && pts.every(([px, py], i) => px === x && py === y + i)) dir = 'v';
      else throw new Error(`vehicle ${id} is not a straight 2–3 cell line (overlap?)`);

      let m = meta[id];
      if (typeof m === 'string') m = { kind: m };
      if (m === undefined) m = {};
      if (!m || typeof m !== 'object') throw new Error(`bad info for ${id}`);
      const kind = m.kind === undefined ? (len === 3 ? 'bus' : 'car') : m.kind;
      if (!KINDS.includes(kind)) throw new Error(`unknown kind ${kind} for ${id}`);
      if (!LENGTHS[kind].includes(len)) throw new Error(`${kind} ${id} can't be ${len} long`);
      if (m.dir !== undefined && m.dir !== dir) throw new Error(`vehicle ${id} is ${dir}, not ${m.dir}`);
      vehicles.push({ id, kind, dir, len, x, y });
    }

    const player = vehicles.find((v) => v.id === PLAYER);
    if (!player) throw new Error('no player car X');
    if (player.dir !== 'h' || player.kind !== 'car') throw new Error('X must be a horizontal car of length 2');

    let optimal = null;
    if (def.optimal !== undefined && def.optimal !== null) {
      if (!isInt(def.optimal) || def.optimal < 1) throw new Error('bad optimal');
      optimal = def.optimal;
    }
    return { w, h, exitRow: player.y, cells, vehicles, optimal };
  }

  const isParsed = (L) => !!L && isInt(L.w) && isInt(L.h) && Array.isArray(L.cells) && Array.isArray(L.vehicles);
  const asLevel = (L) => (isParsed(L) ? L : parseLevel(L));

  // ── Moves and stars ──
  const limitFor = (optimal) => optimal + Math.max(5, Math.ceil(optimal * 0.5));
  function stars(moves, optimal) {
    if (!isInt(moves) || !isInt(optimal) || optimal < 1 || moves < 0) return 0;
    if (moves <= optimal) return 3;
    if (moves <= optimal + 3) return 2;
    if (moves <= limitFor(optimal)) return 1;
    return 0;
  }
  // Barriers are closed during move k when k is odd. `moves` is how many moves were made, so the next is moves+1.
  const gateClosed = (moves) => moves % 2 === 0;
  const gateOpen = (state) => !gateClosed(state.moves);

  // ── Shared geometry over a positions array (x of 'h' vehicles, y of 'v' ones) ──
  const posOf = (vehicles) => vehicles.map((v) => (v.dir === 'h' ? v.x : v.y));

  function occupancy(L, pos) {
    const occ = new Int16Array(L.w * L.h);
    L.vehicles.forEach((v, i) => {
      for (let k = 0; k < v.len; k++) {
        const x = v.dir === 'h' ? pos[i] + k : v.x;
        const y = v.dir === 'v' ? pos[i] + k : v.y;
        if (x >= 0 && x < L.w && y >= 0 && y < L.h) occ[y * L.w + x] = i + 1;
      }
    });
    return occ;
  }

  function blocked(L, occ, x, y, closed) {
    if (x < 0 || y < 0 || x >= L.w || y >= L.h) return true;
    const j = y * L.w + x;
    if (occ[j]) return true;
    const c = L.cells[j];
    return c === BOLLARD || (c === GATE && closed);
  }

  // How far vehicle i can slide: { min ≤ 0, max ≥ 0, exit } where exit means the player can leave (any delta > max).
  function span(L, occ, pos, i, closed) {
    const v = L.vehicles[i];
    const p = pos[i];
    const reach = v.kind === 'tow' ? TOW_STEP : Infinity;
    const at = (c) => (v.dir === 'h' ? [c, v.y] : [v.x, c]);
    let max = 0, min = 0, exit = false;
    while (max < reach) {
      const [x, y] = at(p + v.len + max);
      if (v.id === PLAYER && x === L.w) { exit = true; break; }
      if (blocked(L, occ, x, y, closed)) break;
      max++;
    }
    while (-min < reach) {
      const [x, y] = at(p + min - 1);
      if (blocked(L, occ, x, y, closed)) break;
      min--;
    }
    return { min, max, exit };
  }

  // ── Game state ──
  // { level, vehicles: [{ id, kind, dir, len, x, y }], moves, optimal, limit,
  //   history: [{ pos, moves, id, delta }] (the board before each move and the move itself), status }
  // status: 'playing' | 'won' | 'lost'. Everything is plain data (JSON-serializable).
  // The level must carry its optimum (the generator and the tests solve it; the game never has to).
  function newGame(level) {
    const L = asLevel(level);
    const optimal = L.optimal;
    if (optimal === null) throw new Error('level has no optimal');
    return {
      level: L,
      vehicles: L.vehicles.map((v) => ({ ...v })),
      moves: 0,
      optimal,
      limit: limitFor(optimal),
      history: [],
      status: 'playing',
    };
  }

  const indexOf = (state, id) => state.vehicles.findIndex((v) => v.id === id);
  const playerExited = (state) => {
    const x = state.vehicles.find((v) => v.id === PLAYER);
    return !!x && x.x >= state.level.w;
  };

  function status(state) {
    if (playerExited(state)) return 'won';
    if (state.moves >= state.limit) return 'lost';
    return 'playing';
  }

  // Allowed slide range of a vehicle for the next move (null if unknown id or the game is over).
  function moveRange(state, id) {
    const i = indexOf(state, id);
    if (i < 0 || state.status !== 'playing') return null;
    const pos = posOf(state.vehicles);
    return span(state.level, occupancy(state.level, pos), pos, i, gateClosed(state.moves));
  }

  function canMove(state, id, delta) {
    if (!isInt(delta) || delta === 0) return false;
    const r = moveRange(state, id);
    if (!r) return false;
    return (delta >= r.min && delta <= r.max) || (r.exit && delta > r.max);
  }

  // Slides a vehicle by delta cells along its axis. A slide of the player past the free road to the edge leaves
  // through the exit (x = w). Returns true when the move was made (it counts as one move).
  function move(state, id, delta) {
    if (!isInt(delta) || delta === 0) return false;
    const r = moveRange(state, id);
    if (!r || !((delta >= r.min && delta <= r.max) || (r.exit && delta > r.max))) return false;
    const v = state.vehicles[indexOf(state, id)];
    const exits = delta > r.max;
    // an exit is stored as the slide to the edge (w − x), whatever overshoot the player gave
    state.history.push({ pos: posOf(state.vehicles), moves: state.moves, id, delta: exits ? state.level.w - v.x : delta });
    if (v.dir === 'h') v.x = exits ? state.level.w : v.x + delta;
    else v.y += delta;
    state.moves++;
    state.status = status(state);
    return true;
  }

  // Takes back the last move: positions, the counter (and so the barrier parity) and the status.
  function undo(state) {
    const snap = state.history.pop();
    if (!snap) return false;
    state.vehicles.forEach((v, i) => {
      if (v.dir === 'h') v.x = snap.pos[i];
      else v.y = snap.pos[i];
    });
    state.moves = snap.moves;
    state.status = status(state);
    return true;
  }

  // Back to the start of the level (keeps nothing of the history).
  function restart(state) {
    const fresh = newGame({ ...state.level, optimal: state.optimal });
    Object.assign(state, fresh);
    return state;
  }

  // Board as rows of text: a parsed level's static cells with `vehicles` (its own by default) on top; the player
  // is left out once it exited. For a game: toRows(state.level, state.vehicles).
  function toRows(L, vehicles = L.vehicles) {
    const vs = vehicles;
    const g = L.cells.slice();
    for (const v of vs) {
      for (let k = 0; k < v.len; k++) {
        const x = v.dir === 'h' ? v.x + k : v.x;
        const y = v.dir === 'v' ? v.y + k : v.y;
        if (x < L.w && y < L.h) g[y * L.w + x] = v.id;
      }
    }
    const rows = [];
    for (let y = 0; y < L.h; y++) rows.push(g.slice(y * L.w, (y + 1) * L.w).join(''));
    return rows;
  }

  // ── BFS solver ──
  // The search key is the positions plus the move parity. search() is a generator: it yields every SLICE nodes so
  // the client can spread a long search over several frames, and returns { moves, path: [[id, delta], ...] } with
  // the fewest moves, or null when there is no solution or more than maxStates states were met.
  const SLICE = 4000;
  function* search(L, pos, moves, maxStates) {
    const n = L.vehicles.length;
    const px = L.vehicles.findIndex((v) => v.id === PLAYER);
    const keyOf = (p, par) => String.fromCharCode(...p.map((c) => c + 1)) + par;

    const nodes = [pos];
    const pars = [moves % 2];
    const parent = [-1];
    const via = [null];
    const seen = new Set([keyOf(pos, moves % 2)]);
    const pathTo = (k, last) => {
      const path = [last];
      for (; k > 0; k = parent[k]) path.push(via[k]);
      return path.reverse();
    };

    for (let head = 0; head < nodes.length; head++) {
      if (head % SLICE === SLICE - 1) yield head;
      const p = nodes[head];
      const par = pars[head];
      const closed = par === 0;
      const occ = occupancy(L, p);
      for (let i = 0; i < n; i++) {
        const { min, max, exit } = span(L, occ, p, i, closed);
        if (i === px && exit) {
          const path = pathTo(head, [PLAYER, L.w - p[i]]);
          return { moves: path.length, path };
        }
        for (let d = min; d <= max; d++) {
          if (d === 0) continue;
          const q = p.slice();
          q[i] += d;
          const key = keyOf(q, 1 - par);
          if (seen.has(key)) continue;
          if (seen.size >= maxStates) return null;
          seen.add(key);
          nodes.push(q);
          pars.push(1 - par);
          parent.push(head);
          via.push([L.vehicles[i].id, d]);
        }
      }
    }
    return null;
  }

  function drain(it) {
    for (let r = it.next(); ; r = it.next()) if (r.done) return r.value;
  }

  // The shortest solution of a level (a definition or a parsed level) from its start.
  function solve(level, maxStates = MAX_STATES) {
    const L = asLevel(level);
    return drain(search(L, posOf(L.vehicles), 0, maxStates));
  }

  // The search from a game's current position as an iterator (each next() runs one slice; the final value is the
  // solve() result, { moves: 0, path: [] } once the player is out). The client steps it between frames (hints).
  function* solverFor(state, maxStates = MAX_STATES) {
    if (playerExited(state)) return { moves: 0, path: [] };
    return yield* search(state.level, posOf(state.vehicles), state.moves, maxStates);
  }

  // The shortest solution from a game's current position, in one go.
  const solveState = (state, maxStates = MAX_STATES) => drain(solverFor(state, maxStates));

  // ── Progress ──
  // Saved under PROGRESS_KEY as { v: 1, stars: { levelIndex: 1..3 }, current: null | { level, path, hints } }.
  // `current` is the level in progress: its moves as [[id, delta], ...] (replayed on load) and the hints used,
  // so a reload in the middle of a level comes back to the same board. Loading tolerates missing, broken or
  // foreign data and blocked storage: whatever doesn't look right is dropped, the rest is kept.
  const PROGRESS_KEY = 'parking.progress';
  const MAX_LEVELS = 1000;
  const MAX_HINTS = 3;
  const MAX_PATH = 500;

  const newProgress = () => ({ v: 1, stars: {}, current: null });

  function cleanCurrent(c) {
    if (!c || typeof c !== 'object') return null;
    const { level, path, hints } = c;
    if (!isInt(level) || level < 0 || level >= MAX_LEVELS) return null;
    if (!Array.isArray(path) || path.length > MAX_PATH) return null;
    const ok = path.every((m) => Array.isArray(m) && m.length === 2 && typeof m[0] === 'string' &&
      /^[A-Z]$/.test(m[0]) && isInt(m[1]) && m[1] !== 0);
    if (!ok) return null;
    const h = isInt(hints) && hints >= 0 ? Math.min(hints, MAX_HINTS) : 0;
    return { level, path: path.map((m) => [m[0], m[1]]), hints: h };
  }

  // A progress object from a JSON string (or null). Never throws.
  function parseProgress(raw) {
    const p = newProgress();
    if (typeof raw !== 'string') return p;
    let data;
    try { data = JSON.parse(raw); } catch { return p; }
    if (!data || typeof data !== 'object' || data.v !== 1 || !data.stars || typeof data.stars !== 'object') return p;
    for (const [k, v] of Object.entries(data.stars)) {
      const i = Number(k);
      if (!/^\d+$/.test(k) || i >= MAX_LEVELS || !isInt(v) || v < 1 || v > 3) continue;
      p.stars[i] = v;
    }
    p.current = cleanCurrent(data.current);
    return p;
  }

  // Reads progress from a Storage-like object ({ getItem }); a missing or throwing storage gives a clean state.
  function loadProgress(storage) {
    let raw = null;
    try { raw = storage ? storage.getItem(PROGRESS_KEY) : null; } catch { raw = null; }
    return parseProgress(raw);
  }

  // Writes progress to a Storage-like object ({ setItem }). Returns false when it couldn't be stored.
  function saveProgress(storage, p) {
    try {
      if (!storage) return false;
      storage.setItem(PROGRESS_KEY, JSON.stringify({ v: 1, stars: p.stars, current: cleanCurrent(p.current) }));
      return true;
    } catch {
      return false;
    }
  }

  const starsOf = (p, level) => (p && p.stars && p.stars[level]) || 0;

  // Keeps the best result of a level. Returns true if it improved.
  function recordStars(p, level, n) {
    if (!isInt(level) || level < 0 || level >= MAX_LEVELS || !isInt(n) || n < 1 || n > 3) return false;
    if (starsOf(p, level) >= n) return false;
    p.stars[level] = n;
    return true;
  }

  // The first level (0-based) with no stars; `total` when every level is done.
  function firstUnfinished(p, total) {
    for (let i = 0; i < total; i++) if (!starsOf(p, i)) return i;
    return total;
  }

  // A level is open when it's finished or none before it is left unfinished.
  function unlocked(p, level, total) {
    if (!isInt(level) || level < 0 || level >= total) return false;
    return starsOf(p, level) > 0 || level <= firstUnfinished(p, total);
  }

  // The moves made so far as [[id, delta], ...] (an exit is [X, w − x]).
  const pathOf = (state) => state.history.map((h) => [h.id, h.delta]);

  // What the progress keeps of the game on screen: its moves and the hints used, while it can be continued —
  // playing, or lost (an undo brings it back). A won level keeps nothing.
  function currentOf(level, state, hints) {
    return state && state.status !== 'won' ? { level, path: pathOf(state), hints } : null;
  }

  // The saved level in progress as { level, state, hints }, or null when there is none or its moves no longer
  // replay. A lost game comes back lost, so the result screen can offer the undo again.
  function resume(p, levels) {
    const cur = p && p.current;
    if (!cur || !Array.isArray(levels) || cur.level >= levels.length) return null;
    const state = replay(levels[cur.level], cur.path);
    return state && state.status !== 'won' ? { level: cur.level, state, hints: cur.hints } : null;
  }

  // ── Hints ──
  // The hint from a solution found for this game: its first move as { id, delta }, or null when there is no
  // solution or it needs more moves than are left (a hint must never lead past the limit).
  function hintOf(state, sol) {
    if (!sol || !sol.path.length || sol.moves > state.limit - state.moves) return null;
    const [id, delta] = sol.path[0];
    return { id, delta };
  }

  // A solution found when the game had made the moves `base` (pathOf), seen from the moves `now`: what is left
  // of it while the player kept to it, else null (search again).
  function followRoute(base, sol, now) {
    if (!sol || !Array.isArray(base) || !Array.isArray(now) || now.length < base.length) return null;
    const same = (a, b) => a[0] === b[0] && a[1] === b[1];
    if (!base.every((m, i) => same(m, now[i]))) return null;
    const done = now.slice(base.length);
    if (done.length > sol.path.length || !done.every((m, i) => same(m, sol.path[i]))) return null;
    const path = sol.path.slice(done.length);
    return { moves: path.length, path };
  }

  // A new game of `level` with the moves of `path` made. null when the level is bad or a move is not allowed.
  function replay(level, path) {
    let state;
    try { state = newGame(level); } catch { return null; }
    if (!Array.isArray(path)) return null;
    for (const m of path) {
      if (!Array.isArray(m) || !move(state, m[0], m[1])) return null;
    }
    return state;
  }

  const api = {
    MIN_SIZE, MAX_SIZE, MAX_STATES, PLAYER, EMPTY, BOLLARD, GATE, KINDS, LENGTHS, TOW_STEP,
    parseLevel, limitFor, stars, gateClosed, gateOpen, newGame, status, moveRange, canMove, move, undo, restart,
    toRows, solve, solveState, solverFor,
    PROGRESS_KEY, MAX_HINTS, newProgress, parseProgress, loadProgress, saveProgress, starsOf, recordStars,
    firstUnfinished, unlocked, pathOf, replay, currentOf, resume, hintOf, followRoute,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ParkingCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
