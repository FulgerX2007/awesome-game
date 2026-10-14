// Последняя крепость — pure client helpers: fitting the battlefield to the screen, the slingshot aim from a drag,
// the dotted flight preview and number formatting. No DOM; in the browser it reads window.CastleCore (core.js is
// loaded first), in Node it requires it.
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.CastleCore;

  // The world shown: x from X0 to X1 (just behind the wall to past the spawn point), y from the ground to the sky.
  const X0 = -1.5, X1 = C.SPAWN_X + 2;
  const SKY = 15;          // metres of sky above the ground that must fit
  const UNDER = 1.6;       // metres of earth under the ground line
  const FULL_DRAG = 160;   // css px of pull for full power
  const DEAD_DRAG = 8;     // a smaller pull keeps the previous aim
  const MAX_ASPECT = 0.62; // the canvas is never taller than this share of its width (a portrait phone gets a band)

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Fits the field into the viewport { w, h, dpr } (css px): the width always shows X0…X1; a taller screen gets
  // more sky up to MAX_ASPECT, never a smaller field. → { scale (px per metre), ox, gy (screen y of the ground),
  // cssW, cssH, w, h, dpr }
  function fit(vp) {
    const cssW = Math.max(1, Math.floor((vp && vp.w) || 640));
    const cssH = Math.max(1, Math.floor(Math.min((vp && vp.h) || 360, cssW * MAX_ASPECT)));
    const dpr = clamp((vp && vp.dpr) || 1, 1, 3);
    const scale = Math.min(cssW / (X1 - X0), cssH / (SKY + UNDER));
    const fieldW = (X1 - X0) * scale;
    const ox = (cssW - fieldW) / 2 - X0 * scale;
    const gy = cssH - UNDER * scale;
    return { scale, ox, gy, cssW, cssH, w: Math.round(cssW * dpr), h: Math.round(cssH * dpr), dpr };
  }

  const toScreen = (f, x, y) => ({ x: f.ox + x * f.scale, y: f.gy - y * f.scale });
  const toWorld = (f, px, py) => ({ x: (px - f.ox) / f.scale, y: (f.gy - py) / f.scale });

  // Slingshot aim: the arrow flies opposite to the pull. (dx, dy) is the pull in css px from where the touch
  // started (screen y grows down). → { angle, power } or null for a pull too short to mean anything.
  function aimFromDrag(dx, dy) {
    const len = Math.hypot(dx, dy);
    if (!(len >= DEAD_DRAG)) return null;
    // shooting direction in world terms: pull left/down → shoot right/up
    let fx = -dx;
    const fy = dy;
    if (fx < 0) fx = 0; // pulling forward can't shoot backwards: aim straight up or down instead
    const angle = clamp(Math.atan2(fy, fx), C.ANGLE_MIN, C.ANGLE_MAX);
    const power = clamp(len / FULL_DRAG, C.MIN_POWER, 1);
    return { angle, power };
  }

  // Points of the flight for the preview: every dt seconds until the arrow is under the ground or off the field.
  function trajectory(run, angle, power, dt = 0.06, max = 60) {
    const pts = [];
    for (let k = 1; k <= max; k++) {
      const p = C.flight(run, angle, power, k * dt);
      if (p.y < 0 || p.x > X1 || p.x < X0) break;
      pts.push(p);
    }
    return pts;
  }

  // 1234 → «1 234» (a thin space), as the rest of the games show scores.
  const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const api = { X0, X1, SKY, UNDER, FULL_DRAG, DEAD_DRAG, MAX_ASPECT, clamp, fit, toScreen, toWorld, aimFromDrag, trajectory, fmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CastleView = api;
})(typeof window !== 'undefined' ? window : globalThis);
