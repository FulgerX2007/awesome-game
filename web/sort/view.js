// Цветные колбы — pure client helpers: tube layout for the screen, hit-testing, the pour animation timeline and the
// colour palette (each colour also has its own pattern, so the layers can be told apart without colour vision).
// No DOM, so the same file runs in the browser (window.SortView) and in Node (module.exports) for the tests.
(function (root) {
  'use strict';

  // Layout units (multiples of the tube width).
  const TUBE_W = 1;
  const GAP = 0.55;          // between tubes and at the edges
  const LAYER_H = 0.72;      // one layer
  const NECK = 0.6;          // empty glass above a full tube
  const ROW_GAP = 1.0;       // between two rows (room for the lifted tube)
  const TOP = 1.5;           // above the first row: room to lift a tube and to tilt one over a tube to pour
  const BOTTOM = 0.3;
  const LIFT = 0.45;         // how high a picked tube rises
  const POUR_ANGLE = 1.75;   // radians a pouring tube turns (a bit past horizontal, mouth down)
  const POUR_HOVER = 0.45;   // how far above the target's rim the pouring tube's mouth hangs
  const MAX_UNIT = 74;       // px per unit at most: big screens don't get giant tubes
  const ONE_ROW = 7;         // up to this many tubes in one row

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Tubes laid out in one row (≤ ONE_ROW) or two, centred, fitted into the viewport { w, h, dpr } in css px.
  // → { unit, cssW, cssH, w, h, dpr, cap, rows, tubes: [{ x, y, w, h }] } (tube boxes in css px, y = top of the glass).
  function layout(n, cap, vp) {
    const rows = n <= ONE_ROW ? 1 : 2;
    const perRow = Math.ceil(n / rows);
    const tubeH = cap * LAYER_H + NECK;
    const unitsW = perRow * TUBE_W + (perRow + 1) * GAP;
    const unitsH = TOP + rows * tubeH + (rows - 1) * ROW_GAP + BOTTOM;
    const w = Math.max(1, (vp && vp.w) || 320), h = Math.max(1, (vp && vp.h) || 480);
    const unit = Math.max(4, Math.min(w / unitsW, h / unitsH, MAX_UNIT));
    const dpr = clamp((vp && vp.dpr) || 1, 1, 3);
    const cssW = Math.floor(unitsW * unit), cssH = Math.floor(unitsH * unit);
    const tubes = [];
    for (let r = 0; r < rows; r++) {
      const inRow = r === 0 ? perRow : n - perRow;
      const rowW = inRow * TUBE_W + (inRow - 1) * GAP;
      const x0 = (unitsW - rowW) / 2;
      const y = TOP + r * (tubeH + ROW_GAP);
      for (let i = 0; i < inRow; i++) {
        tubes.push({ x: (x0 + i * (TUBE_W + GAP)) * unit, y: y * unit, w: TUBE_W * unit, h: tubeH * unit });
      }
    }
    return { unit, cssW, cssH, w: Math.round(cssW * dpr), h: Math.round(cssH * dpr), dpr, cap, rows, tubes };
  }

  // The tube under a point (css px), with a padded hit area: half a gap to each side, the lift room above and a
  // little below. -1 when none.
  function tubeAt(lay, x, y) {
    const padX = (GAP / 2) * lay.unit, padTop = TOP * lay.unit, padBottom = BOTTOM * lay.unit;
    let best = -1, bestD = Infinity;
    lay.tubes.forEach((t, i) => {
      if (x < t.x - padX || x > t.x + t.w + padX || y < t.y - padTop || y > t.y + t.h + padBottom) return;
      const d = Math.abs(x - (t.x + t.w / 2));
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  // Pixel box of layer k (0 = bottom) in a tube box.
  function layerBox(lay, tube, k) {
    const lh = LAYER_H * lay.unit;
    const bottom = tube.y + tube.h - 0.12 * lay.unit;
    return { x: tube.x + 0.1 * lay.unit, y: bottom - (k + 1) * lh, w: tube.w - 0.2 * lay.unit, h: lh };
  }

  // ── Pour animation ──
  // A pour of n layers: the tube flies over the target, tilts, the liquid flows (longer for more layers), and the
  // tube goes back. Durations in seconds.
  function pourTimeline(n) {
    const move = 0.18, tilt = 0.14, flow = 0.12 + 0.1 * Math.max(1, n), back = 0.2;
    return { move, tilt, flow, back, total: move + tilt + flow + back };
  }

  // Progress of each stage (0..1) at time t of a timeline.
  function pourAt(tl, t) {
    const seg = (start, len) => clamp((t - start) / len, 0, 1);
    const a = tl.move, b = a + tl.tilt, c = b + tl.flow;
    return {
      move: seg(0, tl.move),
      tilt: t < b + 1e-9 ? seg(a, tl.tilt) : 1 - seg(c, tl.back),
      flow: seg(b, tl.flow),
      back: seg(c, tl.back),
      done: t >= tl.total,
    };
  }

  const easeOut = (x) => 1 - (1 - x) * (1 - x);
  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));

  // ── Colours ──
  // 12 colours, clearly apart, each with a pattern drawn over the layer.
  const PALETTE = [
    { color: '#ff4f5a', pattern: 'plain' },   // red
    { color: '#ffa53b', pattern: 'dots' },    // orange
    { color: '#ffe14d', pattern: 'diag' },    // yellow
    { color: '#4ccf62', pattern: 'rdiag' },   // green
    { color: '#28c2b4', pattern: 'hlines' },  // teal
    { color: '#4aa3ff', pattern: 'vlines' },  // blue
    { color: '#4c5cff', pattern: 'grid' },    // indigo
    { color: '#a75cff', pattern: 'rings' },   // purple
    { color: '#ff6fd0', pattern: 'zigzag' },  // pink
    { color: '#a06a42', pattern: 'checks' },  // brown
    { color: '#d3dbe2', pattern: 'cross' },   // silver
    { color: '#b2f04b', pattern: 'tri' },     // lime
  ];

  // Lighter / darker shade of a #rrggbb colour (k > 0 lighter, k < 0 darker, |k| ≤ 1).
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
    const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  const api = {
    TUBE_W, GAP, LAYER_H, NECK, ROW_GAP, TOP, BOTTOM, LIFT, POUR_ANGLE, POUR_HOVER, MAX_UNIT, ONE_ROW,
    clamp, layout, tubeAt, layerBox, pourTimeline, pourAt, easeOut, easeInOut, PALETTE, shade,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SortView = api;
})(typeof window !== 'undefined' ? window : globalThis);
