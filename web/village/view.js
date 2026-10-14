'use strict';
// Родник — pure client helpers (no DOM): camera, tile picking, canvas sizing, art hashing, HUD helpers.
// Works in the browser (window.VillageView) and in Node (module.exports) so it can be tested.
// Units: the camera and screen points are in CSS pixels; only fitCanvas deals with device pixels.
(function (root) {
  const TILE = 32;     // tile size in CSS pixels
  const STEP = 0.05;   // fixed simulation step, seconds (core.step splits by the same size)
  const MAX_DPR = 2;   // sharper than this costs fill rate on phones and isn't visible

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // Top-left corner of the view (CSS px) centred on a focus point and clamped to the map edges.
  // A map smaller than the view on an axis is centred on that axis (the offset becomes negative).
  function clampCamera(fx, fy, viewW, viewH, mapW, mapH) {
    const axis = (f, view, map) => (map <= view ? (map - view) / 2 : clamp(f - view / 2, 0, map - view));
    return { x: axis(fx, viewW, mapW), y: axis(fy, viewH, mapH) };
  }

  // The tile under a point on the canvas (CSS px relative to the canvas's top-left corner).
  function screenToTile(sx, sy, cam, tile = TILE) {
    return { x: Math.floor((sx + cam.x) / tile), y: Math.floor((sy + cam.y) / tile) };
  }

  // Inclusive tile range that touches the view, widened by `margin` tiles (tall art reaches into
  // neighbouring tiles) and clamped to the map. Empty ranges have x1 < x0 or y1 < y0.
  function visibleRange(cam, viewW, viewH, cols, rows, tile = TILE, margin = 0) {
    return {
      x0: Math.max(0, Math.floor(cam.x / tile) - margin),
      y0: Math.max(0, Math.floor(cam.y / tile) - margin),
      x1: Math.min(cols - 1, Math.ceil((cam.x + viewW) / tile) - 1 + margin),
      y1: Math.min(rows - 1, Math.ceil((cam.y + viewH) / tile) - 1 + margin),
    };
  }

  // Backing-store size for a canvas shown at cssW×cssH: the pixel ratio is capped at MAX_DPR
  // and never below 1; sizes are whole device pixels and at least 1.
  function fitCanvas(cssW, cssH, dpr) {
    const ratio = clamp(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, 1, MAX_DPR);
    return {
      ratio,
      w: Math.max(1, Math.round(Math.max(0, cssW) * ratio)),
      h: Math.max(1, Math.round(Math.max(0, cssH) * ratio)),
    };
  }

  // Snap a camera offset to whole device pixels, so tiles and chunk images don't shimmer.
  const snap = (v, ratio) => Math.round(v * ratio) / ratio;

  // Stable pseudo-random value in [0, 1) for a tile and a salt: the same art every frame and every visit.
  function hash2(x, y, salt = 0) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Facing from a movement delta; keeps the previous facing when standing still.
  function facing(dx, dy, prev = 'down') {
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return prev;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  // ── HUD helpers ──

  // Whole stock for the HUD: plain up to 9 999, then a short "12.3k" form.
  function fmt(n) {
    n = Math.floor(Number(n) || 0);
    if (Math.abs(n) < 10000) return String(n);
    const k = n / 1000;
    return (Math.abs(k) < 100 ? k.toFixed(1).replace(/\.0$/, '') : String(Math.round(k))) + 'k';
  }

  // Signed rate (units per minute) for the small label next to a resource; '' when it's about zero.
  function fmtRate(perMin) {
    if (!Number.isFinite(perMin) || Math.abs(perMin) < 0.05) return '';
    const a = Math.abs(perMin);
    const v = a < 10 ? a.toFixed(1).replace(/\.0$/, '') : String(Math.round(a));
    return (perMin < 0 ? '−' : '+') + v;
  }

  // Whole hours, minutes and seconds of a duration (negative and junk give zeros).
  function splitDuration(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
  }

  // Automatic income right now, per minute, from the same rules as core's produce(): villagers (with the
  // mill bonus) while under the storage limit, workshops while raw stock is above the reserve and the
  // product is under the limit. `full` lists resources whose producers are stopped by the storage limit.
  function income(s, core) {
    const rate = {};
    const full = new Set();
    const add = (r, v) => { rate[r] = (rate[r] || 0) + v * 60; };
    const bonus = s.built.mill && s.built.mill.done ? core.MILL_BONUS : 1;
    for (const v of s.villagers) {
      const role = core.VILLAGERS[v.role];
      if (!role) continue;
      if (s.res[role.res] < s.storage) add(role.res, role.rate * bonus);
      else full.add(role.res);
    }
    for (const [id, w] of Object.entries(core.WORKSHOPS)) {
      if (!s.built[id] || !s.built[id].done) continue;
      if (s.res[w.to] >= s.storage) { full.add(w.to); continue; }
      if (s.res[w.from] - w.ratio < core.WORKSHOP_RESERVE) continue;
      add(w.to, w.rate);
      add(w.from, -w.rate * w.ratio);
    }
    return { rate, full: [...full] };
  }

  // The building whose footprint covers a tile, or null.
  function buildingAt(core, x, y) {
    const c = core.tileAt(x, y);
    if (!c) return null;
    for (const b of Object.values(core.BUILDINGS)) if (b.ch === c) return b.id;
    return null;
  }

  // What a tap (or the action key) on a tile means:
  //   { type: 'gather', node }  a standing node the player has a tool for
  //   { type: 'tool', tool }    a standing node that needs a tool the player doesn't have yet
  //   { type: 'ruin', id }      a ruin or a restored building (walk up and open its panel)
  //   { type: 'walk' }          a walkable tile (also the restored bridge)
  //   { type: 'none' }          water, the map edge
  function tapAction(s, core, x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (core.tileAt(x, y) === null) return { type: 'none' };
    const n = core.nodeAt(s, x, y);
    if (n && n.hp > 0) {
      const tool = core.NODE_KINDS[n.kind].tool;
      return s.tools[tool] > 0 ? { type: 'gather', node: n.id } : { type: 'tool', tool };
    }
    const id = buildingAt(core, x, y);
    if (id && !(id === 'bridge' && s.built.bridge.done)) return { type: 'ruin', id };
    return core.isWalkable(s, x, y) ? { type: 'walk' } : { type: 'none' };
  }

  const FACE_DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  // Tiles around the player for the action key: the one in front first, then the other sides, then corners.
  function frontTiles(px, py, face) {
    const tx = Math.floor(px), ty = Math.floor(py);
    const [fx, fy] = FACE_DIR[face] || FACE_DIR.down;
    const out = [{ x: tx + fx, y: ty + fy }];
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (dx === fx && dy === fy) continue;
      out.push({ x: tx + dx, y: ty + dy });
    }
    return out;
  }

  // The action for the key: the first tile next to the player with a node or a building on it, or null.
  function pickFront(s, core, px, py, face) {
    for (const p of frontTiles(px, py, face)) {
      const a = tapAction(s, core, p.x, p.y);
      if (a.type === 'gather' || a.type === 'tool' || a.type === 'ruin') return { ...a, x: p.x, y: p.y };
    }
    return null;
  }

  // Distance (tiles) from a point to the nearest footprint tile's square; 0 inside one.
  function footprintDist(px, py, tiles) {
    let best = Infinity;
    for (const t of tiles) {
      const dx = Math.max(t.x - px, 0, px - (t.x + 1));
      const dy = Math.max(t.y - py, 0, py - (t.y + 1));
      best = Math.min(best, Math.hypot(dx, dy));
    }
    return best;
  }

  const api = {
    TILE, STEP, MAX_DPR, clamp, lerp, clampCamera, screenToTile, visibleRange, fitCanvas, snap, hash2, facing,
    fmt, fmtRate, splitDuration, income, buildingAt, tapAction, frontTiles, pickFront, footprintDist,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VillageView = api;
})(typeof window !== 'undefined' ? window : globalThis);
