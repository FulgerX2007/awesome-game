// Цветные колбы — pure rules for the colour-sort puzzle. No DOM, so the same file runs in the browser and in Node
// (tests and the level generator). A level is a set of tubes of equal capacity, each a stack of colour layers
// (bottom first). A pour moves the run of same-coloured layers on top of one tube onto another tube that is empty
// or has the same colour on top, as many layers as fit. The level is solved when every tube is empty or full of
// one colour. There is no move limit; stars compare the moves made with the level's par (the solver's optimum).
(function (root) {
  'use strict';

  const MIN_CAP = 3, MAX_CAP = 6;
  const MAX_COLORS = 12;
  const MAX_TUBES = 16;          // 12 colours + 2 empty + the spare, with room to spare
  const MAX_STATES = 300000;     // A* cap: solve() gives up (null) past this many expanded states
  const TUBE = 'tube';           // the spare-tube entry in a saved path

  const isInt = (v) => Number.isInteger(v);

  // ── Level format ──
  // def: { tubes: [[colour, ...], ...] (bottom first, colours 0..11), cap, par?, solution? }
  // Every colour present must fill exactly `cap` layers. parseLevel → { tubes, cap, colors, par, solution } (copies).
  function parseLevel(def) {
    if (!def || typeof def !== 'object') throw new Error('level must be an object');
    const { tubes, cap } = def;
    if (!isInt(cap) || cap < MIN_CAP || cap > MAX_CAP) throw new Error('bad cap');
    if (!Array.isArray(tubes) || tubes.length < 2 || tubes.length > MAX_TUBES) throw new Error('bad tubes');
    const count = new Map();
    for (const t of tubes) {
      if (!Array.isArray(t) || t.length > cap) throw new Error('bad tube');
      for (const c of t) {
        if (!isInt(c) || c < 0 || c >= MAX_COLORS) throw new Error(`bad colour ${c}`);
        count.set(c, (count.get(c) || 0) + 1);
      }
    }
    if (!count.size) throw new Error('no colours');
    for (const [c, n] of count) if (n !== cap) throw new Error(`colour ${c} has ${n} layers, needs ${cap}`);
    const par = def.par === undefined || def.par === null ? null : def.par;
    if (par !== null && (!isInt(par) || par < 0)) throw new Error('bad par');
    let solution = null;
    if (def.solution !== undefined && def.solution !== null) {
      if (!Array.isArray(def.solution) || !def.solution.every((m) => Array.isArray(m) && m.length === 2 &&
        isInt(m[0]) && isInt(m[1]))) throw new Error('bad solution');
      solution = def.solution.map((m) => [m[0], m[1]]);
    }
    return { tubes: tubes.map((t) => t.slice()), cap, colors: count.size, par, solution };
  }

  const isParsed = (L) => !!L && Array.isArray(L.tubes) && isInt(L.cap) && isInt(L.colors);
  const asLevel = (L) => (isParsed(L) ? L : parseLevel(L));

  // ── Tube helpers ──
  const top = (t) => t[t.length - 1];
  // How many layers of the top colour sit on top of each other.
  function topRun(t) {
    let n = 0;
    for (let i = t.length - 1; i >= 0 && t[i] === t[t.length - 1]; i--) n++;
    return n;
  }
  const uniform = (t) => t.length > 0 && topRun(t) === t.length;
  const complete = (t, cap) => t.length === cap && uniform(t);
  const solved = (tubes, cap) => tubes.every((t) => t.length === 0 || complete(t, cap));

  // Layers a pour from tube a to tube b would move (0 when it is not allowed).
  function pourAmount(tubes, cap, a, b) {
    if (a === b || !tubes[a] || !tubes[b]) return 0;
    const ta = tubes[a], tb = tubes[b];
    if (!ta.length || tb.length >= cap) return 0;
    if (tb.length && top(tb) !== top(ta)) return 0;
    return Math.min(topRun(ta), cap - tb.length);
  }

  // A pour that changes nothing worth having: a single-colour tube into an empty one just swaps tubes.
  const useless = (tubes, a, b) => uniform(tubes[a]) && tubes[b].length === 0;

  // ── Game ──
  // state: { level, tubes, moves, history: [{ pour: [a, b, n] } | { addTube: true }], extraUsed, status }
  function newGame(level) {
    const L = asLevel(level);
    const state = { level: L, tubes: L.tubes.map((t) => t.slice()), moves: 0, history: [], extraUsed: false, status: 'playing' };
    state.status = statusOf(state);
    return state;
  }

  function statusOf(state) {
    const { tubes } = state, cap = state.level.cap;
    if (solved(tubes, cap)) return 'won';
    for (let a = 0; a < tubes.length; a++) {
      for (let b = 0; b < tubes.length; b++) {
        if (pourAmount(tubes, cap, a, b) && !useless(tubes, a, b)) return 'playing';
      }
    }
    return 'stuck';
  }
  const status = (state) => state.status;

  const canPour = (state, a, b) => state.status !== 'won' && pourAmount(state.tubes, state.level.cap, a, b) > 0;

  // Pours a → b. Returns the layers moved, or 0 when the pour is not allowed (nothing changes then).
  function pour(state, a, b) {
    if (!canPour(state, a, b)) return 0;
    const n = pourAmount(state.tubes, state.level.cap, a, b);
    const ta = state.tubes[a], tb = state.tubes[b];
    for (let i = 0; i < n; i++) tb.push(ta.pop());
    state.moves++;
    state.history.push({ pour: [a, b, n] });
    state.status = statusOf(state);
    return n;
  }

  // Adds the spare empty tube, once per level. Allowed while the level is not won (also when stuck — that is
  // what it is for). Not a move. Returns true when added.
  function addTube(state) {
    if (state.extraUsed || state.status === 'won' || state.tubes.length >= MAX_TUBES) return false;
    state.tubes.push([]);
    state.extraUsed = true;
    state.history.push({ addTube: true });
    state.status = statusOf(state);
    return true;
  }

  // Takes back the last pour or the spare tube (LIFO, so the spare tube is empty again when its turn comes).
  function undo(state) {
    const h = state.history.pop();
    if (!h) return false;
    if (h.addTube) {
      state.tubes.pop();
      state.extraUsed = false;
    } else {
      const [a, b, n] = h.pour;
      for (let i = 0; i < n; i++) state.tubes[a].push(state.tubes[b].pop());
      state.moves--;
    }
    state.status = statusOf(state);
    return true;
  }

  const restart = (state) => newGame(state.level);

  // ── Stars ──
  // 3★: no more moves than par and no spare tube; 2★: within par + max(2, ⌈par/4⌉), or par with the spare tube;
  // 1★: any win. 0 until the level is won. A level without par counts every win as par.
  const slackFor = (par) => Math.max(2, Math.ceil(par * 0.25));
  function stars(state) {
    if (state.status !== 'won') return 0;
    const par = state.level.par === null ? state.moves : state.level.par;
    if (state.moves <= par && !state.extraUsed) return 3;
    if (state.moves <= par + slackFor(par)) return 2;
    return 1;
  }

  // ── Solver: A* ──
  // Tubes are strings of colour codes ('a' + colour). The visited set uses a canonical key (tubes sorted), since
  // the order of tubes doesn't matter; every node keeps its real tube order, so the path is [from, to] in real
  // indices and replays on newGame(level) as is. Pruning: never pour out of a complete tube, never pour a
  // single-colour tube into an empty one, and of several empty tubes try only the first.
  // Heuristic: colour boundaries inside tubes, plus for each colour the tubes it is the bottom of beyond one.
  // A pour lowers it by at most 1 (it removes at most one boundary or one extra bottom), so it is consistent
  // and the first solution found is optimal.
  const enc = (t) => t.map((c) => String.fromCharCode(97 + c)).join('');
  const keyOf = (ts) => ts.slice().sort().join('|');

  function heuristic(ts) {
    let h = 0;
    const bottoms = new Map();
    for (const t of ts) {
      if (!t.length) continue;
      for (let i = 1; i < t.length; i++) if (t[i] !== t[i - 1]) h++;
      bottoms.set(t[0], (bottoms.get(t[0]) || 0) + 1);
    }
    for (const n of bottoms.values()) h += n - 1;
    return h;
  }

  const runOf = (t) => { let n = 1; while (n < t.length && t[t.length - 1 - n] === t[t.length - 1]) n++; return n; };

  function neighbours(ts, cap) {
    const out = [];
    const firstEmpty = ts.findIndex((t) => !t.length);
    for (let a = 0; a < ts.length; a++) {
      const ta = ts[a];
      if (!ta.length) continue;
      const run = runOf(ta);
      const uni = run === ta.length;
      if (uni && ta.length === cap) continue;
      const c = ta[ta.length - 1];
      for (let b = 0; b < ts.length; b++) {
        if (b === a) continue;
        const tb = ts[b];
        if (tb.length >= cap) continue;
        if (!tb.length) {
          if (uni || b !== firstEmpty) continue;
        } else if (tb[tb.length - 1] !== c) continue;
        const n = Math.min(run, cap - tb.length);
        const next = ts.slice();
        next[a] = ta.slice(0, ta.length - n);
        next[b] = tb + c.repeat(n);
        out.push([a, b, next]);
      }
    }
    return out;
  }

  // Binary min-heap on f, ties broken by larger g (deeper first).
  function heap() {
    const a = [];
    const less = (x, y) => x.f < y.f || (x.f === y.f && x.g > y.g);
    return {
      get size() { return a.length; },
      push(n) {
        a.push(n);
        let i = a.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (!less(a[i], a[p])) break;
          [a[i], a[p]] = [a[p], a[i]]; i = p;
        }
      },
      pop() {
        const r = a[0], last = a.pop();
        if (a.length) {
          a[0] = last;
          let i = 0;
          for (;;) {
            const l = 2 * i + 1, rr = l + 1;
            let m = i;
            if (l < a.length && less(a[l], a[m])) m = l;
            if (rr < a.length && less(a[rr], a[m])) m = rr;
            if (m === i) break;
            [a[i], a[m]] = [a[m], a[i]]; i = m;
          }
        }
        return r;
      },
    };
  }

  // The optimal solution of a level (or of a game's current tubes) as { moves, path: [[from, to], ...], expanded },
  // or null when there is none or the search expands more than maxStates states.
  function solve(level, opts) {
    const L = asLevel(level);
    return solveTubes(L.tubes, L.cap, opts);
  }

  function solveTubes(tubes, cap, opts) {
    const maxStates = (opts && opts.maxStates) || MAX_STATES;
    const ts0 = tubes.map(enc);
    const isGoal = (ts) => ts.every((t) => !t.length || (t.length === cap && runOf(t) === cap));
    const best = new Map();
    const open = heap();
    open.push({ ts: ts0, g: 0, f: heuristic(ts0), parent: null, mv: null });
    best.set(keyOf(ts0), 0);
    let expanded = 0;
    while (open.size) {
      const node = open.pop();
      const key = keyOf(node.ts);
      if (best.get(key) < node.g) continue; // a shorter way here was found later
      if (isGoal(node.ts)) {
        const path = [];
        for (let n = node; n.parent; n = n.parent) path.push(n.mv);
        path.reverse();
        return { moves: path.length, path, expanded };
      }
      if (++expanded > maxStates) return null;
      for (const [a, b, next] of neighbours(node.ts, cap)) {
        const g = node.g + 1;
        const k = keyOf(next);
        const seen = best.get(k);
        if (seen !== undefined && seen <= g) continue;
        best.set(k, g);
        open.push({ ts: next, g, f: g + heuristic(next), parent: node, mv: [a, b] });
      }
    }
    return null;
  }

  // ── Progress ──
  // Saved under PROGRESS_KEY as { v: 1, stars: { levelIndex: 1..3 }, current: null | { level, path } }.
  // `current` is the level in progress: its history as [[from, to], ...] with 'tube' for the spare tube,
  // replayed on load. Loading tolerates missing, broken or foreign data and blocked storage.
  const PROGRESS_KEY = 'sort.progress';
  const MAX_LEVELS = 1000;
  const MAX_PATH = 2000;

  const newProgress = () => ({ v: 1, stars: {}, current: null });

  const goodStep = (m) => m === TUBE || (Array.isArray(m) && m.length === 2 && isInt(m[0]) && isInt(m[1]) &&
    m[0] >= 0 && m[1] >= 0 && m[0] < MAX_TUBES && m[1] < MAX_TUBES && m[0] !== m[1]);

  function cleanCurrent(c) {
    if (!c || typeof c !== 'object') return null;
    const { level, path } = c;
    if (!isInt(level) || level < 0 || level >= MAX_LEVELS) return null;
    if (!Array.isArray(path) || path.length > MAX_PATH || !path.every(goodStep)) return null;
    return { level, path: path.map((m) => (m === TUBE ? TUBE : [m[0], m[1]])) };
  }

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

  function loadProgress(storage) {
    let raw = null;
    try { raw = storage ? storage.getItem(PROGRESS_KEY) : null; } catch { raw = null; }
    return parseProgress(raw);
  }

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

  function recordStars(p, level, n) {
    if (!isInt(level) || level < 0 || level >= MAX_LEVELS || !isInt(n) || n < 1 || n > 3) return false;
    if (starsOf(p, level) >= n) return false;
    p.stars[level] = n;
    return true;
  }

  function firstUnfinished(p, total) {
    for (let i = 0; i < total; i++) if (!starsOf(p, i)) return i;
    return total;
  }

  function unlocked(p, level, total) {
    if (!isInt(level) || level < 0 || level >= total) return false;
    return starsOf(p, level) > 0 || level <= firstUnfinished(p, total);
  }

  // The history as a saved path: [from, to] per pour, 'tube' for the spare tube.
  const pathOf = (state) => state.history.map((h) => (h.addTube ? TUBE : [h.pour[0], h.pour[1]]));

  // What progress keeps of the game on screen: its path while it can be continued (playing or stuck). A won
  // level keeps nothing.
  const currentOf = (level, state) => (state && state.status !== 'won' ? { level, path: pathOf(state) } : null);

  // A new game of `level` with `path` replayed, or null when the level is bad or a step is not allowed.
  function replay(level, path) {
    let state;
    try { state = newGame(level); } catch { return null; }
    if (!Array.isArray(path)) return null;
    for (const m of path) {
      if (m === TUBE) { if (!addTube(state)) return null; continue; }
      if (!Array.isArray(m) || !pour(state, m[0], m[1])) return null;
    }
    return state;
  }

  // The saved level in progress as { level, state }, or null when there is none or it no longer replays.
  function resume(p, levels) {
    const cur = p && p.current;
    if (!cur || !Array.isArray(levels) || cur.level >= levels.length) return null;
    const state = replay(levels[cur.level], cur.path);
    return state && state.status !== 'won' ? { level: cur.level, state } : null;
  }

  const api = {
    MIN_CAP, MAX_CAP, MAX_COLORS, MAX_TUBES, MAX_STATES, TUBE,
    parseLevel, topRun, uniform, complete, solved, pourAmount,
    newGame, status, canPour, pour, addTube, undo, restart, slackFor, stars,
    solve, solveTubes, heuristic,
    PROGRESS_KEY, newProgress, parseProgress, loadProgress, saveProgress, starsOf, recordStars,
    firstUnfinished, unlocked, pathOf, currentOf, replay, resume,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SortCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
