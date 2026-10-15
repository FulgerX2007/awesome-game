// Рубеж — pure client helpers: the side camera over the line (pan and clamp), world ↔ screen, hit-testing plots and
// chasms, the build panel's options and number formatting. No DOM; in the browser it reads window.FrontCore
// (loaded first), in Node it requires it.
(function (root) {
  'use strict';
  const F = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.FrontCore;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const SKY_M = 16;        // metres of the world shown from the ground up
  const UNDER = 0.22;      // share of the canvas height under the ground line

  // The camera for a viewport { w, h } (css px) over a line of length L: px per metre, the ground line, the visible
  // span and the left edge x0 (clamped so the view never leaves the line).
  function camera(vp, L, x0 = 0) {
    const w = Math.max(1, (vp && vp.w) || 640), h = Math.max(1, (vp && vp.h) || 360);
    const ground = h * (1 - UNDER);
    const scale = clamp(ground / SKY_M, 5, 26);
    const span = w / scale;
    const max = Math.max(0, L - span);
    const left = span >= L ? (L - span) / 2 : clamp(x0, 0, max);
    return { w, h, ground, scale, span, x0: left, L };
  }

  const pan = (cam, dxPx) => camera({ w: cam.w, h: cam.h }, cam.L, cam.x0 - dxPx / cam.scale);
  const centerOn = (cam, x) => camera({ w: cam.w, h: cam.h }, cam.L, x - cam.span / 2);
  const toScreen = (cam, x, y = 0) => ({ x: (x - cam.x0) * cam.scale, y: cam.ground - y * cam.scale });
  const toWorld = (cam, sx) => cam.x0 + sx / cam.scale;

  // What a tap at (sx, sy) points at: { plot: i } or { chasm: i }, or null. Plots answer within 2.5 m, chasms over
  // their width; both only near the ground (from 9 m above to under the ground line).
  function plotAt(cam, g, sx, sy) {
    if (sy < cam.ground - 9 * cam.scale || sy > cam.h) return null;
    const x = toWorld(cam, sx);
    let best = null, bd = Infinity;
    g.plots.forEach((p, i) => {
      const d = Math.abs(p.x - x);
      if (d <= 2.5 && d < bd) { bd = d; best = { plot: i }; }
    });
    if (best) return best;
    const ci = g.chasms.findIndex((c) => !c.bridged && x >= c.x0 && x <= c.x1);
    return ci >= 0 ? { chasm: ci } : null;
  }

  const PLOT_OPTIONS = ['house', 'barracks', 'wall', 'tower', 'forge'];

  // The build panel: what can go on the target, with the cost, the core's answer and what is missing.
  // → [{ id, cost, state: 'ok'|'nores'|'busy'|'locked'|'bad', missing }]
  function buildMenu(g, target) {
    if (!target) return [];
    let ids;
    if (target.chasm != null) ids = ['bridge'];
    else {
      const p = g.plots[target.plot];
      if (!p) return [];
      ids = p.b ? (p.b.id === 'wall' && p.b.done && !p.b.stone ? ['stonewall'] : []) : PLOT_OPTIONS;
    }
    return ids.map((id) => {
      const cost = id === 'bridge' ? F.bridgeCost(g, target.chasm) : F.costOf(id);
      return { id, cost, state: F.canBuild(g, target, id), missing: F.missing(g, cost) };
    });
  }

  // 1234 → "1 234".
  function fmt(n) {
    const v = Math.round(Number(n) || 0);
    return String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace(/^/, v < 0 ? '−' : '');
  }

  // 125 → "2:05".
  const clock = (s) => {
    const t = Math.max(0, Math.floor(Number(s) || 0));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };

  const api = { SKY_M, UNDER, PLOT_OPTIONS, camera, pan, centerOn, toScreen, toWorld, plotAt, buildMenu, fmt, clock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FrontView = api;
})(typeof window !== 'undefined' ? window : globalThis);
