// Тяни штифт — pure client helpers (no DOM): canvas fitting, screen → cell mapping, pin hit-testing,
// the pull gesture, the fixed-step accumulator and the hero's walk to the exit. Works in the browser
// (window.PinsView) and in Node (module.exports) so it can be tested.
// Units: the logical canvas is LW×LH (one cell = CELL logical px); screen points are CSS px relative to
// the canvas's top-left corner; only fitCanvas deals with device pixels.
(function (root) {
  'use strict';
  const Core = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.PinsCore;
  const { W, H, handleCell } = Core;

  const CELL = 10;
  const LW = W * CELL, LH = H * CELL; // 360 × 540
  const MAX_DPR = 2;      // sharper than this costs fill rate on phones and isn't visible
  const PIN_PAD = 1;      // cells around a pin's bar that still grab it
  const HANDLE_PAD = 2;   // cells around the handle's ring that grab it (a finger-sized target)
  const PULL_DRAG = 2;    // a drag pulls once the handle moved this many cells outwards along the pin
  const TAP = 1;          // a gesture that never moved farther than this (cells) is a tap, and a tap pulls too
  const TICK_RATE = 60;   // automaton ticks per second
  const MAX_TICKS_PER_FRAME = 8; // after a stall (a background tab) the backlog is dropped, not replayed
  const WALK_SPEED = 9;   // hero walk speed, cells per second

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Size of the canvas for a viewport { w, h, dpr } (CSS px): the 2:3 logical canvas scaled to fit whole,
  // and its backing store in device pixels (the ratio is capped at MAX_DPR and never below 1).
  function fitCanvas(viewport) {
    const v = viewport || {};
    const vw = Number.isFinite(v.w) && v.w > 0 ? v.w : LW;
    const vh = Number.isFinite(v.h) && v.h > 0 ? v.h : LH;
    const cssW = Math.max(1, Math.floor(Math.min(vw, (vh * LW) / LH)));
    const scale = cssW / LW;
    const cssH = Math.max(1, Math.round(LH * scale));
    const ratio = clamp(Number.isFinite(v.dpr) && v.dpr > 0 ? v.dpr : 1, 1, MAX_DPR);
    return { scale, cssW, cssH, ratio, w: Math.round(cssW * ratio), h: Math.round(cssH * ratio) };
  }

  // The cell under a point on the canvas: { x, y } whole cells and { fx, fy } in fractional cells.
  function screenToCell(sx, sy, fit) {
    const fx = sx / fit.scale / CELL, fy = sy / fit.scale / CELL;
    return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
  }

  // Chebyshev distance (cells) from a cell to a rectangle; 0 inside it.
  function rectDist(cx, cy, r) {
    const dx = Math.max(r.x - cx, 0, cx - (r.x + r.w - 1));
    const dy = Math.max(r.y - cy, 0, cy - (r.y + r.h - 1));
    return Math.max(dx, dy);
  }

  // The not-yet-pulled pin under a cell, or null. The bar grabs within PIN_PAD cells, the handle's ring within
  // HANDLE_PAD cells; when several pins are in reach the closest wins, and on a tie the handle.
  function pinAt(state, cx, cy) {
    let best = null, bestScore = Infinity;
    for (const p of state.pins) {
      if (p.pulled) continue;
      const db = rectDist(cx, cy, p);
      const h = handleCell(p);
      const dh = rectDist(cx, cy, { x: h.x, y: h.y, w: 1, h: 1 });
      let score = Infinity;
      if (db <= PIN_PAD) score = db;
      if (dh <= HANDLE_PAD) score = Math.min(score, dh - 0.5);
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  // Unit vector a pin slides out along: towards its handle.
  function pullDir(pin) {
    if (pin.handle === 'left') return { dx: -1, dy: 0 };
    if (pin.handle === 'right') return { dx: 1, dy: 0 };
    return { dx: 0, dy: -1 };
  }

  // ── The pull gesture ──
  // dragStart grabs the pin under a point (fractional cells) or returns null; dragMove tracks how far the
  // handle was dragged outwards (`along`, never negative) and the farthest the pointer got (`moved`);
  // dragEnd says whether the gesture pulls: dragged ≥ PULL_DRAG cells outwards, or a tap.
  function dragStart(state, fx, fy) {
    const pin = pinAt(state, Math.floor(fx), Math.floor(fy));
    if (!pin) return null;
    const { dx, dy } = pullDir(pin);
    return { id: pin.id, dx, dy, x0: fx, y0: fy, along: 0, moved: 0 };
  }

  function dragMove(d, fx, fy) {
    const ox = fx - d.x0, oy = fy - d.y0;
    d.along = Math.max(0, ox * d.dx + oy * d.dy);
    d.moved = Math.max(d.moved, Math.hypot(ox, oy));
    return d.along;
  }

  function dragEnd(d, fx, fy) {
    dragMove(d, fx, fy);
    return d.along >= PULL_DRAG || d.moved < TAP;
  }

  // ── Fixed step ──
  // Adds dt seconds to the accumulator (in ticks) and returns how many ticks to run now and what is left.
  // Junk or negative dt adds nothing; a backlog over MAX_TICKS_PER_FRAME is dropped.
  function fixedSteps(acc, dt) {
    const add = Number.isFinite(dt) && dt > 0 ? dt * TICK_RATE : 0;
    let a = (Number.isFinite(acc) && acc > 0 ? acc : 0) + add;
    let n = Math.floor(a);
    a -= n;
    if (n > MAX_TICKS_PER_FRAME) { n = MAX_TICKS_PER_FRAME; a = 0; }
    return { n, acc: a };
  }

  // ── The walk to the exit ──
  // Where the hero is `t` seconds into the walk from its box to the exit door (same floor): { x, y } in cells
  // (top-left of the box), the facing (1 right, −1 left) and whether the hero reached the door.
  function walkPos(hero, exit, t) {
    const dist = exit.x - hero.x;
    const face = dist < 0 ? -1 : 1;
    const go = Math.min(Math.abs(dist), Math.max(0, t) * WALK_SPEED);
    return { x: hero.x + face * go, y: hero.y, face, done: go >= Math.abs(dist) };
  }

  const walkTime = (hero, exit) => Math.abs(exit.x - hero.x) / WALK_SPEED;

  // Stable pseudo-random value in [0, 1) for a cell and a salt: the same art every frame.
  function hash2(x, y, salt = 0) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const api = {
    CELL, LW, LH, MAX_DPR, PIN_PAD, HANDLE_PAD, PULL_DRAG, TAP, TICK_RATE, MAX_TICKS_PER_FRAME, WALK_SPEED,
    clamp, fitCanvas, screenToCell, rectDist, pinAt, pullDir, dragStart, dragMove, dragEnd, fixedSteps,
    walkPos, walkTime, hash2,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PinsView = api;
})(typeof window !== 'undefined' ? window : globalThis);
