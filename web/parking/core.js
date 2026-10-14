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
  const startPos = (L) => L.vehicles.map((v) => (v.dir === 'h' ? v.x : v.y));

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
  // { level, vehicles: [{ id, kind, dir, len, x, y }], moves, optimal, limit, history: [{ pos, moves }], status }
  // status: 'playing' | 'won' | 'lost'. Everything is plain data (JSON-serializable).
  function newGame(level) {
    const L = asLevel(level);
    let optimal = L.optimal;
    if (optimal === null) {
      const sol = solve(L);
      if (!sol) throw new Error('level has no solution');
      optimal = sol.moves;
    }
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

  const positions = (state) => state.vehicles.map((v) => (v.dir === 'h' ? v.x : v.y));
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
    const pos = positions(state);
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
    if (!canMove(state, id, delta)) return false;
    const r = moveRange(state, id);
    const v = state.vehicles[indexOf(state, id)];
    state.history.push({ pos: positions(state), moves: state.moves });
    if (v.dir === 'h') v.x = delta > r.max ? state.level.w : v.x + delta;
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

  // Board as rows of text (vehicles on top of the static cells); the player is left out once it exited.
  function toRows(state) {
    const L = state.level || state;
    const vs = state.vehicles || L.vehicles;
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
  // solve(def | parsed level | state) → { moves, path: [[id, delta], ...] } with the fewest moves, or null when there
  // is no solution or more than MAX_STATES states were met. The search key is the positions plus the move parity.
  function solve(arg, maxStates = MAX_STATES) {
    let L, pos, moves = 0;
    if (arg && Array.isArray(arg.vehicles) && arg.level && isInt(arg.moves)) {
      L = arg.level;
      pos = positions(arg);
      moves = arg.moves;
      if (playerExited(arg)) return { moves: 0, path: [] };
    } else {
      L = asLevel(arg);
      pos = startPos(L);
    }
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

  const api = {
    MIN_SIZE, MAX_SIZE, MAX_STATES, PLAYER, EMPTY, BOLLARD, GATE, KINDS, LENGTHS, TOW_STEP,
    parseLevel, limitFor, stars, gateClosed, gateOpen, newGame, status, moveRange, canMove, move, undo, restart,
    toRows, solve,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ParkingCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
