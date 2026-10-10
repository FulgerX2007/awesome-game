// Оазис — puzzle generation and rules. No DOM, so it runs in Node for checks.
// Tiles are 4-bit masks of open sides: N=1, E=2, S=4, W=8 (clockwise order).
(function (root) {
  'use strict';

  const DIRS = [
    { bit: 1, dx: 0, dy: -1, opp: 4 },
    { bit: 2, dx: 1, dy: 0, opp: 8 },
    { bit: 4, dx: 0, dy: 1, opp: 1 },
    { bit: 8, dx: -1, dy: 0, opp: 2 },
  ];

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

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  const rot = (m, r) => { r = ((r % 4) + 4) % 4; return ((m << r) | (m >> (4 - r))) & 15; };
  const degree = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

  function neighbor(size, i, d) {
    const x = (i % size) + d.dx, y = Math.floor(i / size) + d.dy;
    return x < 0 || y < 0 || x >= size || y >= size ? -1 : y * size + x;
  }

  // Random spanning tree (randomised Prim) with degree ≤ 3, then random rotations.
  function generate(size, seed) {
    const R = rng(seed);
    const n = size * size;
    for (;;) {
      const sol = new Array(n).fill(0);
      const c = Math.floor(size / 2);
      const src = (c + Math.floor(R() * 2) - (size % 2 ? 0 : 1)) * size + c;
      const inTree = new Uint8Array(n);
      const frontier = [];
      const grow = (i) => { inTree[i] = 1; for (const d of DIRS) frontier.push([i, d]); };
      grow(src);
      let count = 1;
      while (frontier.length) {
        const k = Math.floor(R() * frontier.length);
        const [a, d] = frontier[k];
        frontier[k] = frontier[frontier.length - 1]; frontier.pop();
        const b = neighbor(size, a, d);
        if (b < 0 || inTree[b] || degree(sol[a]) >= 3) continue;
        sol[a] |= d.bit; sol[b] |= d.opp;
        grow(b); count++;
      }
      if (count < n) continue; // a cell got boxed in by full neighbours; try again

      const base = sol.map((m) => rot(m, Math.floor(R() * 4)));
      const p = { size, src, sol, base };
      if (check(p, base).solved) {
        const i = base.findIndex((m) => m !== rot(m, 1));
        base[i] = rot(base[i], 1);
      }
      return p;
    }
  }

  // Water spreads from the spring through sides that are open on both tiles.
  function check(p, masks) {
    const { size, src } = p, n = size * size;
    const dist = new Int16Array(n).fill(-1);
    const q = [src];
    dist[src] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      for (const d of DIRS) {
        if (!(masks[i] & d.bit)) continue;
        const j = neighbor(size, i, d);
        if (j < 0 || dist[j] >= 0 || !(masks[j] & d.opp)) continue;
        dist[j] = dist[i] + 1;
        q.push(j);
      }
    }
    let leaks = 0;
    for (let i = 0; i < n; i++) {
      for (const d of DIRS) {
        if (!(masks[i] & d.bit)) continue;
        const j = neighbor(size, i, d);
        if (j < 0 || !(masks[j] & d.opp)) leaks++;
      }
    }
    return { dist, reached: q.length, leaks, solved: q.length === n && leaks === 0 };
  }

  // Fewest clicks (either direction) from the scrambled board to the generated solution.
  function minMoves(p) {
    let total = 0;
    p.base.forEach((m, i) => {
      for (let r = 0; r < 4; r++) if (rot(m, r) === p.sol[i]) { total += Math.min(r, 4 - r); break; }
    });
    return total;
  }

  const sizeForLevel = (level) => Math.min(4 + Math.floor((level - 1) / 3), 10);
  const levelSeed = (level) => hash(`oasis-level-${level}`);
  const dailySeed = (date) => hash(`oasis-daily-${date}`);
  const DAILY_SIZE = 8;

  const api = { DIRS, rng, hash, rot, degree, neighbor, generate, check, minMoves, sizeForLevel, levelSeed, dailySeed, DAILY_SIZE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OasisCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
