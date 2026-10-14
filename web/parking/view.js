// Тесная парковка — pure client helpers (no DOM): fitting the lot to the screen, hit-testing cells and vehicles,
// how far a drag may slide a vehicle, keyboard picking and the easing of animations. Works in the browser
// (window.ParkingView) and in Node (module.exports) so it can be tested.
// Units: the lot is drawn in cell units; a layout maps them to CSS px (screen points relative to the canvas's
// top-left corner). Only fitBoard deals with device pixels.
(function (root) {
  'use strict';
  const Core = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.ParkingCore;

  const PAD = 0.55;       // curb and pavement around the grid, cells
  const ROAD = 1.25;      // the exit road beyond the right curb, cells
  const MAX_CELL = 92;    // CSS px; bigger cells only look blown up on a desktop
  const MAX_DPR = 2;
  const DRAG_START = 0.12; // cells the pointer must travel before a press becomes a drag
  const OVERDRAG = 0.18;  // cells a vehicle gives way past its stop when pushed into something (a visual bump)

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // World size of a level in cells: the grid, the curbs around it and the exit road on the right.
  const worldSize = (level) => ({ w: PAD + level.w + PAD + ROAD, h: PAD + level.h + PAD });

  // Layout of the lot inside a viewport { w, h, dpr } (CSS px): the cell size in CSS px, the canvas size in CSS px
  // and device px, and where the grid's top-left corner lands (ox, oy, CSS px).
  function fitBoard(viewport, level) {
    const v = viewport || {};
    const W = worldSize(level);
    const vw = Number.isFinite(v.w) && v.w > 0 ? v.w : W.w * 40;
    const vh = Number.isFinite(v.h) && v.h > 0 ? v.h : W.h * 40;
    const cell = Math.max(4, Math.min(MAX_CELL, Math.floor(Math.min(vw / W.w, vh / W.h))));
    const cssW = Math.round(W.w * cell), cssH = Math.round(W.h * cell);
    const ratio = clamp(Number.isFinite(v.dpr) && v.dpr > 0 ? v.dpr : 1, 1, MAX_DPR);
    return {
      cell, cssW, cssH, ratio, w: Math.round(cssW * ratio), h: Math.round(cssH * ratio),
      ox: PAD * cell, oy: PAD * cell, cols: level.w, rows: level.h, world: W,
    };
  }

  // Grid cell under a point (CSS px on the canvas): { x, y } whole cells, { fx, fy } fractional, `inside` the grid.
  function cellAt(lay, sx, sy) {
    const fx = (sx - lay.ox) / lay.cell, fy = (sy - lay.oy) / lay.cell;
    const x = Math.floor(fx), y = Math.floor(fy);
    return { x, y, fx, fy, inside: x >= 0 && y >= 0 && x < lay.cols && y < lay.rows };
  }

  // Cells a vehicle covers (the player's car past the right edge covers none inside the grid).
  function covers(v, x, y) {
    if (v.dir === 'h') return y === v.y && x >= v.x && x < v.x + v.len;
    return x === v.x && y >= v.y && y < v.y + v.len;
  }

  // Id of the vehicle on a grid cell, or null.
  function vehicleAt(state, x, y) {
    if (!state || x < 0 || y < 0 || x >= state.level.w || y >= state.level.h) return null;
    const v = state.vehicles.find((u) => covers(u, x, y));
    return v ? v.id : null;
  }

  // The part of a pointer offset { dx, dy } (cells, or a plain number) along a vehicle's axis.
  function along(v, d) {
    if (typeof d === 'number') return Number.isFinite(d) ? d : 0;
    if (!d) return 0;
    const a = v.dir === 'h' ? d.dx : d.dy;
    return Number.isFinite(a) ? a : 0;
  }

  // How far a drag by pointerDelta may slide vehicle `id` (cells along its axis, fractional): clamped to the
  // stretch it can reach this move — never through a vehicle, a bollard, a closed barrier or a wall. The player's
  // car may follow the pointer out through the exit when the road is free. 0 when the vehicle can't move.
  function dragTarget(state, id, pointerDelta) {
    const r = Core.moveRange(state, id);
    if (!r) return 0;
    const v = state.vehicles.find((u) => u.id === id);
    const want = along(v, pointerDelta);
    const max = r.exit ? state.level.w - v.x : r.max;
    return clamp(want, r.min, max);
  }

  // The whole-cell move a released drag makes: the shift rounded to the nearest cell (0 = no move). A player's
  // car dragged at least half a cell beyond the free road leaves through the exit.
  function dropDelta(state, id, shift) {
    const r = Core.moveRange(state, id);
    if (!r || !Number.isFinite(shift)) return 0;
    const d = Math.round(shift);
    if (r.exit && shift >= r.max + 0.5) return state.level.w - state.vehicles.find((u) => u.id === id).x;
    return clamp(d, r.min, r.max);
  }

  // How far past the allowed shift the pointer pushes (cells, ≥ 0): drives the bump wobble and its sound.
  function overPush(state, id, pointerDelta) {
    const r = Core.moveRange(state, id);
    if (!r) return 0;
    const v = state.vehicles.find((u) => u.id === id);
    const want = along(v, pointerDelta);
    const got = dragTarget(state, id, pointerDelta);
    return Math.abs(want - got);
  }

  // A soft give past the stop for the drawing: approaches OVERDRAG cells however hard the pointer pushes.
  const give = (push) => (push > 0 ? OVERDRAG * (1 - Math.exp(-push * 3)) : 0);

  // ── Keyboard picking ──
  const onBoard = (state) => state.vehicles.filter((v) => v.x < state.level.w);
  const centre = (v) => (v.dir === 'h' ? { x: v.x + v.len / 2, y: v.y + 0.5 } : { x: v.x + 0.5, y: v.y + v.len / 2 });

  // Next/previous vehicle in reading order (top to bottom, left to right), wrapping around; the player's car
  // first when nothing is picked.
  function cycle(state, id, step = 1) {
    const vs = onBoard(state).slice().sort((a, b) => a.y - b.y || a.x - b.x);
    if (!vs.length) return null;
    const i = vs.findIndex((v) => v.id === id);
    if (i < 0) return (vs.find((v) => v.id === Core.PLAYER) || vs[0]).id;
    return vs[(i + (step < 0 ? -1 : 1) + vs.length) % vs.length].id;
  }

  // The nearest vehicle from `id` in a direction (dx, dy one of ±1/0), or null: it must lie that way, and the
  // straighter it lies the closer it counts.
  function neighbor(state, id, dx, dy) {
    const from = state.vehicles.find((v) => v.id === id);
    if (!from) return null;
    const c = centre(from);
    let best = null, bestScore = Infinity;
    for (const v of onBoard(state)) {
      if (v.id === id) continue;
      const o = centre(v);
      const ax = (o.x - c.x) * dx + (o.y - c.y) * dy; // distance along the direction
      if (ax <= 0.25) continue;
      const side = Math.abs((o.x - c.x) * dy) + Math.abs((o.y - c.y) * dx);
      const score = ax + side * 2;
      if (score < bestScore) { bestScore = score; best = v.id; }
    }
    return best;
  }

  // ── Animation ──
  // Moves a value towards a target at a smooth exponential rate (frame-rate independent); snaps when close.
  function approach(cur, target, dt, rate = 18) {
    if (!Number.isFinite(cur)) return target;
    const k = 1 - Math.exp(-rate * Math.max(0, dt || 0));
    const next = cur + (target - cur) * k;
    return Math.abs(target - next) < 0.002 ? target : next;
  }

  const easeInQuad = (t) => clamp(t, 0, 1) ** 2;
  const easeOutBack = (t) => {
    const u = clamp(t, 0, 1) - 1;
    return 1 + 2.2 * u ** 3 + 1.2 * u ** 2;
  };

  // Stable pseudo-random value in [0, 1) for two integers and a salt: the same art every frame.
  function hash2(x, y, salt = 0) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const api = {
    PAD, ROAD, MAX_CELL, MAX_DPR, DRAG_START, OVERDRAG,
    clamp, worldSize, fitBoard, cellAt, covers, vehicleAt, along, dragTarget, dropDelta, overPush, give,
    cycle, neighbor, approach, easeInQuad, easeOutBack, hash2,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ParkingView = api;
})(typeof window !== 'undefined' ? window : globalThis);
