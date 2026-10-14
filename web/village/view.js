'use strict';
// Родник — pure client helpers (no DOM): camera, tile picking, canvas sizing, art hashing.
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

  const api = { TILE, STEP, MAX_DPR, clamp, lerp, clampCamera, screenToTile, visibleRange, fitCanvas, snap, hash2, facing };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VillageView = api;
})(typeof window !== 'undefined' ? window : globalThis);
