'use strict';
// Тесная парковка — client: screens, input, animation and the Canvas 2D art of the lot. The rules live in core.js
// (window.ParkingCore), the levels in levels.js (window.ParkingLevels), pure helpers in view.js (window.ParkingView).
(() => {
  const C = window.ParkingCore;
  const V = window.ParkingView;
  const LEVELS = window.ParkingLevels.LEVELS;
  const { t } = window.I18n;
  const $ = (id) => document.getElementById(id);
  const { clamp, hash2, PAD, ROAD } = V;
  // A rounded rectangle path; older browsers without roundRect get a plain one.
  const rrect = (g, x, y, w, h, r) => (g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h));
  const TAU = Math.PI * 2;

  // Storage access itself may throw (blocked site data); core's progress functions tolerate a null storage.
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }

  // Sound comes from audio.js when it's there; without it the toggle still works for this visit.
  // Names: slide ({ dist, kind }), bump, barrier ({ open }), undo, hint, win, lose.
  const Sound = window.ParkingAudio || {
    enabled: true,
    setEnabled(v) { this.enabled = !!v; },
    unlock() {},
    play() {},
  };
  const sfx = (name, opts) => { if (Sound.enabled) Sound.play(name, opts); };

  // Level facts the tips and the art need.
  const PARSED = LEVELS.map((d) => C.parseLevel(d));
  const hasGate = (L) => L.cells.includes(C.GATE);
  const hasTow = (L) => L.vehicles.some((v) => v.kind === 'tow');
  const FIRST_GATE = PARSED.findIndex(hasGate);
  const FIRST_TOW = PARSED.findIndex(hasTow);
  function tipFor(i) {
    if (i === 0) return 'Перетащи машину, чтобы освободить путь красной';
    if (i === 1) return 'Сдвиг на любое число клеток — один ход';
    if (i === FIRST_GATE && i === FIRST_TOW) return 'Шлагбаум открыт на чётных ходах, тягач едет на одну клетку';
    if (i === FIRST_GATE) return 'Шлагбаум открыт только на чётных ходах';
    if (i === FIRST_TOW) return 'Тягач едет только на одну клетку за ход';
    return null;
  }

  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  let progress = C.loadProgress(storage);
  let level = 0;
  let s = null;            // core state of the level on screen
  let phase = 'menu';      // menu | play | exit | lose | end
  let phaseT = 0;          // seconds in the current phase
  let outcome = null;      // { won, stars, moves }
  let hintsUsed = 0;
  let hint = null;         // { id, delta } shown until the next move
  let hintBusy = false;
  let drag = null;         // { id, pointer, x0, y0, shift, over, started, bumped }
  let sel = null;          // vehicle picked with the keyboard
  let pending = 0;         // keyboard shift of `sel` not yet made into a move
  let pendingT = 0;
  let rp = {};             // id → drawn position along the vehicle's axis (cells)
  let bumps = {};          // id → { dir, t } a short wobble after hitting something
  let gates = [];          // barrier cells: { x, y, a } with a = 0 closed … 1 raised
  let particles = [];
  let exitV = 0;           // speed of the player's car driving off after the win
  let shake = 0;
  let time = 0;
  let last = 0;

  // ───────────── Canvas size and the cached static layer ─────────────
  let fit = V.fitBoard({}, PARSED[0]);
  let staticLayer = null;
  let staticKey = '';

  function resize() {
    const L = s ? s.level : PARSED[0];
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const next = V.fitBoard({ w: stage.clientWidth - padX, h: stage.clientHeight - padY, dpr: window.devicePixelRatio || 1 }, L);
    if (next.w === canvas.width && next.h === canvas.height && next.cell === fit.cell && next.cols === fit.cols && next.rows === fit.rows) return;
    fit = next;
    canvas.style.width = fit.cssW + 'px';
    canvas.style.height = fit.cssH + 'px';
    canvas.width = fit.w;
    canvas.height = fit.h;
    staticKey = '';
  }

  // Draw in cell units with the grid's top-left corner at (0, 0).
  const worldTransform = (g) => {
    const k = fit.cell * fit.ratio;
    g.setTransform(k, 0, 0, k, fit.ox * fit.ratio, fit.oy * fit.ratio);
  };

  // Mixes a #rrggbb colour towards white (f > 0) or black (f < 0).
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
  }

  // ───────────── Static layer: pavement, asphalt, curbs, markings, bollards, the exit ─────────────
  function buildStatic() {
    const L = s.level;
    const cv = document.createElement('canvas');
    cv.width = fit.w;
    cv.height = fit.h;
    const g = cv.getContext('2d');
    worldTransform(g);
    const x0 = -PAD, y0 = -PAD, X1 = L.w + PAD + ROAD, Y1 = L.h + PAD;
    const ey = L.exitRow;

    // Pavement: square concrete tiles with a little tint each.
    g.fillStyle = '#5d6572';
    g.fillRect(x0, y0, X1 - x0, Y1 - y0);
    const T = 0.5;
    for (let ty = Math.floor(y0 / T); ty * T < Y1; ty++) {
      for (let tx = Math.floor(x0 / T); tx * T < X1; tx++) {
        const v = hash2(tx, ty, 3);
        g.fillStyle = `rgba(${v > 0.5 ? '255, 255, 255' : '0, 0, 0'}, ${0.03 + Math.abs(v - 0.5) * 0.08})`;
        g.fillRect(tx * T + 0.015, ty * T + 0.015, T - 0.03, T - 0.03);
      }
    }
    // Planters with bushes on the pavement right of the lot, above and below the exit road.
    const bush = (bx, by, r, salt) => {
      g.fillStyle = 'rgba(0, 0, 0, .3)';
      g.beginPath(); g.ellipse(bx + 0.06, by + 0.08, r, r * 0.9, 0, 0, TAU); g.fill();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + hash2(i, salt, 9);
        const rr = r * (0.45 + hash2(i, salt, 4) * 0.2);
        const px = bx + Math.cos(a) * r * 0.45, py = by + Math.sin(a) * r * 0.45;
        const gr = g.createRadialGradient(px - rr * 0.3, py - rr * 0.3, rr * 0.1, px, py, rr);
        gr.addColorStop(0, '#7fca63');
        gr.addColorStop(1, '#2f6b33');
        g.fillStyle = gr;
        g.beginPath(); g.arc(px, py, rr, 0, TAU); g.fill();
      }
      g.fillStyle = 'rgba(190, 240, 150, .35)';
      g.beginPath(); g.arc(bx - r * 0.25, by - r * 0.3, r * 0.22, 0, TAU); g.fill();
    };
    const rx = L.w + PAD + 0.12, rw = ROAD - 0.24;
    for (const [top, bot] of [[y0 + 0.15, ey - 0.25], [ey + 1.25, Y1 - 0.15]]) {
      if (bot - top < 0.5) continue;
      g.fillStyle = '#4a3a2c';
      g.beginPath(); rrect(g, rx, top, rw, bot - top, 0.12); g.fill();
      g.strokeStyle = '#9aa1ab';
      g.lineWidth = 0.06;
      g.stroke();
      for (let by = top + 0.42, i = 0; by < bot - 0.25; by += 0.8, i++) bush(rx + rw / 2, by, 0.33, i + Math.round(top * 10));
    }

    // Asphalt: the lot and the exit road, with speckles.
    g.save();
    g.beginPath();
    g.rect(0, 0, L.w, L.h);
    g.rect(L.w - 0.01, ey, X1 - L.w + 0.02, 1);
    g.clip();
    const asph = g.createLinearGradient(0, 0, L.w, L.h);
    asph.addColorStop(0, '#3c4049');
    asph.addColorStop(1, '#30343c');
    g.fillStyle = asph;
    g.fillRect(0, 0, X1, L.h);
    const n = Math.round((L.w + ROAD) * L.h * 70);
    for (let i = 0; i < n; i++) {
      const px = hash2(i, 1, 21) * (L.w + PAD + ROAD), py = hash2(i, 2, 21) * L.h;
      const v = hash2(i, 3, 21);
      g.fillStyle = v > 0.5 ? `rgba(255, 255, 255, ${0.03 + (v - 0.5) * 0.12})` : `rgba(0, 0, 0, ${0.05 + v * 0.15})`;
      const sz = 0.015 + hash2(i, 4, 21) * 0.03;
      g.fillRect(px, py, sz, sz);
    }
    // Oil stains and patched cracks here and there.
    for (let i = 0; i < Math.round(L.w * L.h / 7); i++) {
      const px = 0.3 + hash2(i, 5, level) * (L.w - 0.6), py = 0.3 + hash2(i, 6, level) * (L.h - 0.6);
      const gr = g.createRadialGradient(px, py, 0, px, py, 0.32);
      gr.addColorStop(0, 'rgba(10, 12, 16, .35)');
      gr.addColorStop(1, 'rgba(10, 12, 16, 0)');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(px, py, 0.32, 0.22, hash2(i, 7, level) * 3, 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(15, 17, 21, .5)';
    g.lineWidth = 0.025;
    for (let i = 0; i < 3; i++) {
      let px = hash2(i, 8, level) * L.w, py = hash2(i, 9, level) * L.h;
      g.beginPath(); g.moveTo(px, py);
      for (let k = 0; k < 5; k++) { px += (hash2(i, k, 30) - 0.5) * 0.5; py += hash2(i, k, 31) * 0.3; g.lineTo(px, py); }
      g.stroke();
    }

    // Bay lines: short white strokes along the grid lines, leaving the crossings open.
    g.strokeStyle = 'rgba(235, 240, 246, .26)';
    g.lineWidth = 0.035;
    g.lineCap = 'round';
    g.beginPath();
    for (let x = 1; x < L.w; x++) for (let y = 0; y < L.h; y++) { g.moveTo(x, y + 0.14); g.lineTo(x, y + 0.86); }
    for (let y = 1; y < L.h; y++) for (let x = 0; x < L.w; x++) { g.moveTo(x + 0.14, y); g.lineTo(x + 0.86, y); }
    g.stroke();
    // Crossing ticks.
    g.fillStyle = 'rgba(235, 240, 246, .18)';
    for (let x = 1; x < L.w; x++) for (let y = 1; y < L.h; y++) g.fillRect(x - 0.03, y - 0.03, 0.06, 0.06);

    // The exit lane: a yellow dashed line on the road and arrows pointing out.
    g.strokeStyle = 'rgba(255, 205, 60, .75)';
    g.lineWidth = 0.05;
    g.setLineDash([0.18, 0.14]);
    g.beginPath(); g.moveTo(L.w + 0.08, ey + 0.08); g.lineTo(X1, ey + 0.08); g.moveTo(L.w + 0.08, ey + 0.92); g.lineTo(X1, ey + 0.92); g.stroke();
    g.setLineDash([]);
    const arrow = (ax, ay, sz, alpha) => {
      g.fillStyle = `rgba(245, 248, 252, ${alpha})`;
      g.beginPath();
      g.moveTo(ax - sz * 0.6, ay - sz * 0.16); g.lineTo(ax, ay - sz * 0.16); g.lineTo(ax, ay - sz * 0.42);
      g.lineTo(ax + sz * 0.5, ay); g.lineTo(ax, ay + sz * 0.42); g.lineTo(ax, ay + sz * 0.16); g.lineTo(ax - sz * 0.6, ay + sz * 0.16);
      g.closePath(); g.fill();
    };
    arrow(L.w + PAD + ROAD * 0.45, ey + 0.5, 0.7, 0.75);
    // Stop line where the lot meets the road.
    g.fillStyle = 'rgba(245, 248, 252, .55)';
    for (let k = 0; k < 4; k++) g.fillRect(L.w + 0.04, ey + 0.1 + k * 0.22, 0.09, 0.12);
    g.restore();

    // Barrier boxes: yellow-black hatching on the asphalt.
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        if (L.cells[y * L.w + x] !== C.GATE) continue;
        g.save();
        g.beginPath(); g.rect(x + 0.06, y + 0.06, 0.88, 0.88); g.clip();
        g.fillStyle = 'rgba(255, 196, 30, .18)';
        g.fillRect(x, y, 1, 1);
        g.strokeStyle = 'rgba(255, 196, 30, .55)';
        g.lineWidth = 0.07;
        g.beginPath();
        for (let d = -1; d < 2; d += 0.25) { g.moveTo(x + d, y); g.lineTo(x + d + 1, y + 1); }
        g.stroke();
        g.restore();
        g.strokeStyle = 'rgba(255, 196, 30, .9)';
        g.lineWidth = 0.05;
        g.strokeRect(x + 0.06, y + 0.06, 0.88, 0.88);
      }
    }

    // Curb: a raised concrete rim around the asphalt, open at the exit; a soft shadow inside it.
    const curb = (ax, ay, bx, by) => {
      g.strokeStyle = 'rgba(0, 0, 0, .35)';
      g.lineWidth = 0.18;
      g.beginPath(); g.moveTo(ax + 0.03, ay + 0.05); g.lineTo(bx + 0.03, by + 0.05); g.stroke();
      g.strokeStyle = '#b8bec7';
      g.lineWidth = 0.14;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.strokeStyle = 'rgba(255, 255, 255, .35)';
      g.lineWidth = 0.035;
      g.beginPath(); g.moveTo(ax - 0.02, ay - 0.03); g.lineTo(bx - 0.02, by - 0.03); g.stroke();
    };
    g.lineCap = 'square';
    const e = 0.07;
    curb(-e, -e, L.w + e, -e);
    curb(-e, L.h + e, L.w + e, L.h + e);
    curb(-e, -e, -e, L.h + e);
    curb(L.w + e, -e, L.w + e, ey);
    curb(L.w + e, ey + 1, L.w + e, L.h + e);
    curb(L.w + e, ey, X1, ey);
    curb(L.w + e, ey + 1, X1, ey + 1);
    g.lineCap = 'butt';
    const inner = (gx0, gy0, gx1, gy1, x, y, w, h) => {
      const gr = g.createLinearGradient(gx0, gy0, gx1, gy1);
      gr.addColorStop(0, 'rgba(0, 0, 0, .3)');
      gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = gr;
      g.fillRect(x, y, w, h);
    };
    inner(0, 0, 0, 0.25, 0, 0, L.w, 0.25);
    inner(0, 0, 0.25, 0, 0, 0, 0.25, L.h);

    // Exit sign on a post at the corner of the road.
    const sx = L.w + PAD * 0.55, sy = ey > 0 ? ey - 0.32 : ey + 1.32;
    g.fillStyle = 'rgba(0, 0, 0, .35)';
    g.beginPath(); rrect(g, sx - 0.2 + 0.07, sy - 0.2 + 0.09, 0.4, 0.4, 0.06); g.fill();
    g.fillStyle = '#1f9d55';
    g.beginPath(); rrect(g, sx - 0.2, sy - 0.2, 0.4, 0.4, 0.06); g.fill();
    g.strokeStyle = '#e8f6ee';
    g.lineWidth = 0.03;
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(sx - 0.12, sy - 0.035); g.lineTo(sx + 0.01, sy - 0.035); g.lineTo(sx + 0.01, sy - 0.1); g.lineTo(sx + 0.13, sy);
    g.lineTo(sx + 0.01, sy + 0.1); g.lineTo(sx + 0.01, sy + 0.035); g.lineTo(sx - 0.12, sy + 0.035); g.closePath(); g.fill();

    // Bollards: yellow posts with a black reflective band, seen from above.
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        if (L.cells[y * L.w + x] !== C.BOLLARD) continue;
        const cx = x + 0.5, cy = y + 0.5;
        g.fillStyle = 'rgba(255, 196, 30, .14)';
        g.beginPath(); g.arc(cx, cy, 0.4, 0, TAU); g.fill();
        g.fillStyle = 'rgba(0, 0, 0, .4)';
        g.beginPath(); g.ellipse(cx + 0.12, cy + 0.16, 0.25, 0.22, 0.6, 0, TAU); g.fill();
        g.fillStyle = '#6c737e';
        g.beginPath(); g.arc(cx, cy, 0.27, 0, TAU); g.fill();
        const gr = g.createRadialGradient(cx - 0.07, cy - 0.08, 0.02, cx, cy, 0.22);
        gr.addColorStop(0, '#fff2a0');
        gr.addColorStop(0.5, '#ffcc1f');
        gr.addColorStop(1, '#b58700');
        g.fillStyle = gr;
        g.beginPath(); g.arc(cx, cy, 0.22, 0, TAU); g.fill();
        g.strokeStyle = '#1d1f24';
        g.lineWidth = 0.05;
        g.beginPath(); g.arc(cx, cy, 0.15, 0, TAU); g.stroke();
        g.fillStyle = 'rgba(255, 255, 255, .7)';
        g.beginPath(); g.arc(cx - 0.06, cy - 0.07, 0.04, 0, TAU); g.fill();
      }
    }
    return cv;
  }

  // ───────────── Vehicles ─────────────
  const CAR_COLORS = ['#3b82f6', '#22a06b', '#f2c94c', '#8e5cc9', '#e8ecf1', '#2b3240', '#14b8a6', '#8b5e3c', '#94a3b8', '#ec6fa9', '#6c8cff', '#a3d65c'];
  const BUS_COLORS = ['#f4b400', '#2f7fd8', '#2ea86a', '#7a5cd6'];
  const PLAYER_COLOR = '#e3342f';
  const TOW_COLOR = '#ff8a1f';

  const code = (id) => id.charCodeAt(0);
  function colorOf(v) {
    if (v.id === C.PLAYER) return PLAYER_COLOR;
    if (v.kind === 'tow') return TOW_COLOR;
    if (v.kind === 'bus') return BUS_COLORS[(code(v.id) + level) % BUS_COLORS.length];
    return CAR_COLORS[(code(v.id) * 5 + level * 3) % CAR_COLORS.length];
  }
  // Which way the vehicle faces: the player's car looks at the exit, the rest are parked either way.
  function angleOf(v) {
    if (v.id === C.PLAYER) return 0;
    const flip = hash2(code(v.id), level, 7) < 0.5;
    if (v.dir === 'h') return flip ? Math.PI : 0;
    return flip ? -Math.PI / 2 : Math.PI / 2;
  }

  const basePos = (v) => (v.dir === 'h' ? v.x : v.y);
  const vehicle = (id) => s && s.vehicles.find((v) => v.id === id);
  // Top-left corner of a vehicle drawn at position p along its axis.
  const cornerAt = (v, p) => (v.dir === 'h' ? { x: p, y: v.y } : { x: v.x, y: p });

  function bumpOffset(id) {
    const b = bumps[id];
    if (!b) return 0;
    return b.dir * 0.09 * Math.exp(-b.t * 9) * Math.sin(b.t * 34);
  }

  function drawShadow(v, p) {
    const { x, y } = cornerAt(v, p);
    const w = v.dir === 'h' ? v.len : 1, h = v.dir === 'h' ? 1 : v.len;
    ctx.fillStyle = 'rgba(0, 0, 0, .22)';
    ctx.beginPath(); rrect(ctx, x + 0.1, y + 0.14, w - 0.12, h - 0.12, 0.25); ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, .25)';
    ctx.beginPath(); rrect(ctx, x + 0.1, y + 0.12, w - 0.16, h - 0.16, 0.22); ctx.fill();
  }

  // Body gradient across the width: dark sides, a lit ridge along the middle.
  function bodyFill(W, color) {
    const gr = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
    gr.addColorStop(0, shade(color, -0.45));
    gr.addColorStop(0.16, color);
    gr.addColorStop(0.45, shade(color, 0.22));
    gr.addColorStop(0.84, color);
    gr.addColorStop(1, shade(color, -0.45));
    return gr;
  }
  function glass(x0, x1) {
    const gr = ctx.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, '#16202b');
    gr.addColorStop(1, '#3f5a70');
    return gr;
  }

  function drawCar(L, W, color, player) {
    const h = L / 2, w = W / 2;
    ctx.fillStyle = bodyFill(W, color);
    ctx.beginPath(); rrect(ctx, -h, -w, L, W, 0.26); ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, .5)';
    ctx.lineWidth = 0.03;
    ctx.stroke();
    if (player) { // racing stripes
      ctx.fillStyle = 'rgba(255, 255, 255, .9)';
      ctx.fillRect(-h + 0.05, -0.1, L - 0.1, 0.06);
      ctx.fillRect(-h + 0.05, 0.04, L - 0.1, 0.06);
    }
    // Mirrors.
    ctx.fillStyle = shade(color, -0.3);
    ctx.beginPath(); ctx.ellipse(h - 0.62, -w - 0.02, 0.06, 0.05, 0, 0, TAU); ctx.ellipse(h - 0.62, w + 0.02, 0.06, 0.05, 0, 0, TAU); ctx.fill();
    // Windscreen and rear window.
    ctx.fillStyle = glass(h - 0.36, h - 0.64);
    ctx.beginPath();
    ctx.moveTo(h - 0.64, -w + 0.09); ctx.lineTo(h - 0.4, -w + 0.15); ctx.lineTo(h - 0.4, w - 0.15); ctx.lineTo(h - 0.64, w - 0.09);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = glass(-h + 0.2, -h + 0.42);
    ctx.beginPath();
    ctx.moveTo(-h + 0.2, -w + 0.15); ctx.lineTo(-h + 0.4, -w + 0.1); ctx.lineTo(-h + 0.4, w - 0.1); ctx.lineTo(-h + 0.2, w - 0.15);
    ctx.closePath(); ctx.fill();
    // Side windows.
    ctx.fillStyle = 'rgba(22, 32, 43, .85)';
    ctx.fillRect(-h + 0.42, -w + 0.05, L - 1.08, 0.06);
    ctx.fillRect(-h + 0.42, w - 0.11, L - 1.08, 0.06);
    // Roof.
    ctx.fillStyle = shade(color, 0.1);
    ctx.beginPath(); rrect(ctx, -h + 0.42, -w + 0.13, L - 1.08, W - 0.26, 0.08); ctx.fill();
    if (player) {
      ctx.fillStyle = 'rgba(255, 255, 255, .9)';
      ctx.fillRect(-h + 0.42, -0.1, L - 1.08, 0.06);
      ctx.fillRect(-h + 0.42, 0.04, L - 1.08, 0.06);
    }
    ctx.fillStyle = 'rgba(255, 255, 255, .22)';
    ctx.fillRect(h - 0.6, -w + 0.12, 0.12, 0.05);
    // Lights.
    ctx.fillStyle = '#fff6cf';
    ctx.beginPath(); rrect(ctx, h - 0.09, -w + 0.06, 0.07, 0.15, 0.03); rrect(ctx, h - 0.09, w - 0.21, 0.07, 0.15, 0.03); ctx.fill();
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath(); rrect(ctx, -h + 0.02, -w + 0.06, 0.05, 0.16, 0.02); rrect(ctx, -h + 0.02, w - 0.22, 0.05, 0.16, 0.02); ctx.fill();
  }

  function drawBus(L, W, color) {
    const h = L / 2, w = W / 2;
    ctx.fillStyle = bodyFill(W, color);
    ctx.beginPath(); rrect(ctx, -h, -w, L, W, 0.14); ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, .5)';
    ctx.lineWidth = 0.03;
    ctx.stroke();
    // Side window bands with pillars.
    ctx.fillStyle = '#1b2733';
    ctx.fillRect(-h + 0.12, -w + 0.04, L - 0.38, 0.08);
    ctx.fillRect(-h + 0.12, w - 0.12, L - 0.38, 0.08);
    ctx.fillStyle = shade(color, -0.2);
    for (let x = -h + 0.42; x < h - 0.3; x += 0.32) { ctx.fillRect(x, -w + 0.04, 0.03, 0.08); ctx.fillRect(x, w - 0.12, 0.03, 0.08); }
    // Windscreen.
    ctx.fillStyle = glass(h - 0.05, h - 0.24);
    ctx.beginPath(); rrect(ctx, h - 0.24, -w + 0.06, 0.18, W - 0.12, 0.05); ctx.fill();
    // Roof panel, AC units and a hatch.
    ctx.fillStyle = shade(color, 0.28);
    ctx.beginPath(); rrect(ctx, -h + 0.14, -w + 0.15, L - 0.42, W - 0.3, 0.06); ctx.fill();
    for (const ax of [-h + 0.55, 0.15]) {
      ctx.fillStyle = '#d8dde4';
      ctx.beginPath(); rrect(ctx, ax, -0.2, 0.5, 0.4, 0.05); ctx.fill();
      ctx.strokeStyle = '#9aa3ae';
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      for (let k = 1; k < 6; k++) { ctx.moveTo(ax + k * 0.083, -0.16); ctx.lineTo(ax + k * 0.083, 0.16); }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(30, 40, 52, .6)';
    ctx.fillRect(h - 0.62, -0.12, 0.22, 0.24);
    // Rear engine grille and lights.
    ctx.fillStyle = 'rgba(0, 0, 0, .35)';
    ctx.fillRect(-h + 0.02, -0.2, 0.06, 0.4);
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(-h + 0.01, -w + 0.04, 0.04, 0.12);
    ctx.fillRect(-h + 0.01, w - 0.16, 0.04, 0.12);
    ctx.fillStyle = '#fff6cf';
    ctx.fillRect(h - 0.05, -w + 0.05, 0.04, 0.12);
    ctx.fillRect(h - 0.05, w - 0.17, 0.04, 0.12);
    // Mirrors on stalks.
    ctx.strokeStyle = '#20262e';
    ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.moveTo(h - 0.05, -w); ctx.lineTo(h + 0.02, -w - 0.06); ctx.moveTo(h - 0.05, w); ctx.lineTo(h + 0.02, w + 0.06); ctx.stroke();
  }

  function drawTow(L, W, color) {
    const h = L / 2, w = W / 2;
    const cab = 0.78;
    // Steel bed.
    const bed = ctx.createLinearGradient(0, -w, 0, w);
    bed.addColorStop(0, '#3c424b');
    bed.addColorStop(0.5, '#6d7581');
    bed.addColorStop(1, '#3c424b');
    ctx.fillStyle = bed;
    ctx.beginPath(); rrect(ctx, -h, -w + 0.03, L - cab + 0.05, W - 0.06, 0.08); ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, .55)';
    ctx.lineWidth = 0.03;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, .12)';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    for (let x = -h + 0.15; x < h - cab; x += 0.12) { ctx.moveTo(x, -w + 0.1); ctx.lineTo(x, w - 0.1); }
    ctx.stroke();
    // Hazard stripes on the rear edge.
    ctx.save();
    ctx.beginPath(); ctx.rect(-h, -w + 0.03, 0.16, W - 0.06); ctx.clip();
    ctx.fillStyle = '#ffcc1f';
    ctx.fillRect(-h, -w, 0.16, W);
    ctx.fillStyle = '#1b1d22';
    for (let y = -w - 0.2; y < w; y += 0.16) {
      ctx.beginPath(); ctx.moveTo(-h, y); ctx.lineTo(-h + 0.16, y + 0.16); ctx.lineTo(-h + 0.16, y + 0.24); ctx.lineTo(-h, y + 0.08); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // The crane boom and the hook.
    const bx0 = h - cab - 0.05, bx1 = -h + 0.28;
    ctx.strokeStyle = 'rgba(0, 0, 0, .35)';
    ctx.lineWidth = 0.14;
    ctx.beginPath(); ctx.moveTo(bx0 + 0.05, 0.07); ctx.lineTo(bx1 + 0.05, 0.07); ctx.stroke();
    ctx.strokeStyle = '#ffb21f';
    ctx.lineWidth = 0.12;
    ctx.beginPath(); ctx.moveTo(bx0, 0); ctx.lineTo(bx1, 0); ctx.stroke();
    ctx.strokeStyle = '#a86a00';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    for (let x = bx1 + 0.08; x < bx0; x += 0.14) { ctx.moveTo(x, -0.05); ctx.lineTo(x + 0.07, 0.05); }
    ctx.stroke();
    ctx.strokeStyle = '#c9ced6';
    ctx.lineWidth = 0.025;
    ctx.beginPath(); ctx.arc(bx1 - 0.08, 0, 0.06, 0.4, TAU - 0.4); ctx.stroke();
    // The cab.
    const c0 = h - cab;
    ctx.fillStyle = bodyFill(W, color);
    ctx.beginPath(); rrect(ctx, c0, -w, cab, W, 0.18); ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, .5)';
    ctx.lineWidth = 0.03;
    ctx.stroke();
    ctx.fillStyle = glass(h - 0.08, h - 0.3);
    ctx.beginPath(); rrect(ctx, h - 0.3, -w + 0.08, 0.2, W - 0.16, 0.05); ctx.fill();
    ctx.fillStyle = shade(color, 0.2);
    ctx.beginPath(); rrect(ctx, c0 + 0.08, -w + 0.12, cab - 0.42, W - 0.24, 0.06); ctx.fill();
    // Beacon bar: amber lights blinking in turn.
    const on = Math.sin(time * 9) > 0;
    ctx.fillStyle = '#2a2f37';
    ctx.fillRect(c0 + 0.14, -w + 0.1, 0.1, W - 0.2);
    for (const [y, lit] of [[-w + 0.16, on], [w - 0.16, !on]]) {
      ctx.fillStyle = lit ? '#ffd23a' : '#8a5a00';
      ctx.beginPath(); ctx.arc(c0 + 0.19, y, 0.06, 0, TAU); ctx.fill();
      if (lit) {
        ctx.fillStyle = 'rgba(255, 190, 40, .28)';
        ctx.beginPath(); ctx.arc(c0 + 0.19, y, 0.2, 0, TAU); ctx.fill();
      }
    }
    ctx.fillStyle = '#fff6cf';
    ctx.fillRect(h - 0.05, -w + 0.06, 0.04, 0.13);
    ctx.fillRect(h - 0.05, w - 0.19, 0.04, 0.13);
  }

  function drawVehicle(v, p) {
    const { x, y } = cornerAt(v, p);
    const cx = v.dir === 'h' ? x + v.len / 2 : x + 0.5;
    const cy = v.dir === 'h' ? y + 0.5 : y + v.len / 2;
    const L = v.len - (v.kind === 'bus' ? 0.12 : 0.16);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleOf(v));
    const color = colorOf(v);
    if (v.kind === 'bus') drawBus(L, 0.84, color);
    else if (v.kind === 'tow') drawTow(L, 0.8, color);
    else drawCar(L, 0.78, color, v.id === C.PLAYER);
    ctx.restore();
  }

  // Outline around a vehicle at a position (selection, hint and its ghost).
  function outline(v, p, color, width, dash) {
    const { x, y } = cornerAt(v, p);
    const w = v.dir === 'h' ? v.len : 1, h = v.dir === 'h' ? 1 : v.len;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.beginPath(); rrect(ctx, x + 0.03, y + 0.03, w - 0.06, h - 0.06, 0.26); ctx.stroke();
    ctx.setLineDash([]);
  }

  function arrowHead(x, y, ang, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.6, -size * 0.75); ctx.lineTo(-size * 0.6, size * 0.75); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ───────────── Barriers ─────────────
  function cellTaken(x, y) {
    return s.vehicles.some((v) => V.covers(v, x, y));
  }

  function drawGates(dt) {
    const open = C.gateOpen(s);
    for (const gt of gates) {
      const target = open || cellTaken(gt.x, gt.y) ? 1 : 0;
      gt.a = V.approach(gt.a, target, dt, 7);
      const a = gt.a;
      const px = gt.x + 0.14, py = gt.y + 0.5;
      const len = 0.82 * (1 - 0.8 * a);     // the arm swings up towards the viewer: it looks shorter
      const th = 0.1 * (1 + 0.5 * a);
      const lift = 0.04 + 0.22 * a;         // and its shadow falls farther away
      ctx.fillStyle = `rgba(0, 0, 0, ${0.35 - a * 0.15})`;
      ctx.beginPath(); rrect(ctx, px + lift * 0.6, py - th / 2 + lift, len, th, th / 2); ctx.fill();
      ctx.save();
      ctx.beginPath(); rrect(ctx, px, py - th / 2, len, th, th / 2); ctx.clip();
      ctx.fillStyle = '#f4f6f8';
      ctx.fillRect(px, py - th, len, th * 2);
      ctx.fillStyle = '#e8322b';
      const seg = 0.16 * (1 - 0.8 * a);
      for (let k = 0; k * seg < len; k += 2) ctx.fillRect(px + k * seg, py - th, seg, th * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, .35)';
      ctx.fillRect(px, py - th / 2, len, th * 0.3);
      ctx.restore();
      // Post with a signal lamp.
      ctx.fillStyle = 'rgba(0, 0, 0, .4)';
      ctx.beginPath(); ctx.arc(px + 0.04, py + 0.06, 0.11, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a4048';
      ctx.beginPath(); ctx.arc(px, py, 0.11, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#79818c';
      ctx.lineWidth = 0.02;
      ctx.stroke();
      const lamp = target ? '#45e07a' : '#ff4136';
      ctx.fillStyle = lamp;
      ctx.beginPath(); ctx.arc(px, py, 0.045, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.3 + 0.15 * Math.sin(time * 6);
      ctx.beginPath(); ctx.arc(px, py, 0.13, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ───────────── Particles ─────────────
  function puff(x, y, n, kind) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = 0.2 + Math.random() * 0.5;
      particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.5 + Math.random() * 0.4, kind,
        r: 0.06 + Math.random() * 0.06, c: kind === 'conf' ? ['#ffd34d', '#5aa7ff', '#ff6a5c', '#6fdc8c', '#ffffff'][i % 5] : null,
        rot: Math.random() * TAU,
      });
    }
  }
  // Exhaust behind a vehicle that just moved.
  function exhaust(v) {
    const ang = angleOf(v);
    const p = rp[v.id];
    const { x, y } = cornerAt(v, p);
    const cx = v.dir === 'h' ? x + v.len / 2 : x + 0.5, cy = v.dir === 'h' ? y + 0.5 : y + v.len / 2;
    puff(cx - Math.cos(ang) * v.len * 0.5, cy - Math.sin(ang) * v.len * 0.5, 4, 'puff');
  }

  function drawParticles(dt) {
    particles = particles.filter((q) => (q.life += dt) < q.max);
    for (const q of particles) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      const k = q.life / q.max;
      if (q.kind === 'conf') {
        q.vy += 2.5 * dt;
        q.rot += dt * 8;
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.rot);
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = q.c;
        ctx.fillRect(-0.06, -0.03, 0.12, 0.06);
        ctx.restore();
      } else {
        q.vx *= 0.96; q.vy *= 0.96;
        ctx.fillStyle = q.kind === 'dust' ? `rgba(200, 190, 170, ${0.4 * (1 - k)})` : `rgba(180, 186, 196, ${0.35 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r * (1 + k * 2), 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ───────────── Frame ─────────────
  // Where a vehicle should be drawn this frame (cells along its axis).
  function targetPos(v) {
    if (drag && drag.started && drag.id === v.id) return basePos(v) + drag.shift + drag.over;
    if (sel === v.id && pending) return basePos(v) + pending;
    return basePos(v);
  }

  function draw(dt) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!s) return;
    const key = `${level}:${fit.w}x${fit.h}`;
    if (key !== staticKey) { staticLayer = buildStatic(); staticKey = key; }
    ctx.drawImage(staticLayer, 0, 0);
    worldTransform(ctx);
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 0.3, (Math.random() - 0.5) * shake * 0.3);

    const order = s.vehicles.slice().sort((a, b) => (drag && a.id === drag.id) - (drag && b.id === drag.id) || (a.id === C.PLAYER) - (b.id === C.PLAYER));
    for (const v of order) {
      if (s.status !== 'won' || v.id !== C.PLAYER) rp[v.id] = drag && drag.started && drag.id === v.id ? targetPos(v) : V.approach(rp[v.id], targetPos(v), dt, 16);
    }
    const drawn = (v) => rp[v.id] + bumpOffset(v.id);
    for (const v of order) drawShadow(v, drawn(v));
    for (const v of order) drawVehicle(v, drawn(v));
    drawGates(dt);

    // The hint: the vehicle pulses, a ghost shows where it goes.
    if (hint && phase === 'play') {
      const v = vehicle(hint.id);
      if (v) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 6);
        const to = basePos(v) + hint.delta;
        outline(v, to, `rgba(255, 211, 77, ${0.45 + pulse * 0.35})`, 0.05, [0.12, 0.08]);
        outline(v, rp[v.id], `rgba(255, 211, 77, ${0.6 + pulse * 0.4})`, 0.07);
        const from = cornerAt(v, rp[v.id]), dest = cornerAt(v, to);
        const dx = v.dir === 'h' ? 1 : 0, dy = 1 - dx;
        const mid = v.len / 2;
        const ax = (from.x + dest.x) / 2 + (dx ? mid : 0.5), ay = (from.y + dest.y) / 2 + (dy ? mid : 0.5);
        arrowHead(ax + dx * Math.sign(hint.delta) * 0.1 * pulse, ay + dy * Math.sign(hint.delta) * 0.1 * pulse,
          Math.atan2(dy * Math.sign(hint.delta), dx * Math.sign(hint.delta)), 0.22, '#ffd34d');
      }
    }
    // Keyboard selection: a dashed frame and the ways it can go.
    if (sel && phase === 'play') {
      const v = vehicle(sel);
      if (v && v.x < s.level.w) {
        outline(v, rp[v.id], 'rgba(255, 255, 255, .95)', 0.045, [0.1, 0.07]);
        const r = C.moveRange(s, sel);
        if (r) {
          const { x, y } = cornerAt(v, rp[v.id]);
          const back = pending > r.min, fwd = pending < r.max || r.exit;
          const ends = v.dir === 'h'
            ? [[back, x - 0.12, y + 0.5, Math.PI], [fwd, x + v.len + 0.12, y + 0.5, 0]]
            : [[back, x + 0.5, y - 0.12, -Math.PI / 2], [fwd, x + 0.5, y + v.len + 0.12, Math.PI / 2]];
          for (const [ok, ax, ay, ang] of ends) if (ok) arrowHead(ax, ay, ang, 0.12, 'rgba(255, 255, 255, .9)');
        }
      }
    }
    drawParticles(dt);

    if (phase === 'lose' || (phase === 'end' && outcome && !outcome.won)) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const a = Math.min(1, phaseT * 2) * 0.4;
      const vg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.25, canvas.width / 2, canvas.height / 2, canvas.height * 0.75);
      vg.addColorStop(0, 'rgba(120, 0, 0, 0)');
      vg.addColorStop(1, `rgba(120, 0, 0, ${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function update(dt) {
    phaseT += dt;
    shake = Math.max(0, shake - dt * 1.5);
    for (const id of Object.keys(bumps)) if ((bumps[id].t += dt) > 0.6) delete bumps[id];
    if (phase === 'play' && pending && !drag && (pendingT += dt) > 0.7) commitPending();
    if (phase === 'exit') {
      // The red car speeds away down the road, then the result shows.
      exitV += dt * 14;
      rp[C.PLAYER] = Math.max(rp[C.PLAYER] + exitV * dt, rp[C.PLAYER]);
      if (Math.random() < 0.5) {
        const v = vehicle(C.PLAYER);
        puff(rp[C.PLAYER] - 0.05, v.y + 0.5 + (Math.random() - 0.5) * 0.4, 1, 'puff');
      }
      if (rp[C.PLAYER] > s.level.w + PAD + ROAD + 0.3 || phaseT > 2.2) finish();
    } else if (phase === 'lose' && phaseT > 0.9) {
      finish();
    }
  }

  function frame(now) {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    time += dt;
    if (s) update(dt);
    draw(dt);
    requestAnimationFrame(frame);
  }

  function setPhase(p) {
    phase = p;
    phaseT = 0;
  }

  // ───────────── Levels, moves and results ─────────────
  // Puts level i on screen: a fresh game, or the given state (a restored one).
  function loadLevel(i, state) {
    level = clamp(i, 0, LEVELS.length - 1);
    s = state || C.newGame(LEVELS[level]);
    rp = {};
    for (const v of s.vehicles) rp[v.id] = basePos(v);
    bumps = {};
    particles = [];
    drag = null;
    sel = null;
    pending = 0;
    hint = null;
    hintBusy = false;
    outcome = null;
    exitV = 0;
    shake = 0;
    gates = [];
    const L = s.level;
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) if (L.cells[y * L.w + x] === C.GATE) gates.push({ x, y, a: C.gateOpen(s) ? 1 : 0 });
    resize();
  }

  // A saved level in progress that still replays to a playable board, or null.
  function restored() {
    const cur = progress.current;
    if (!cur || cur.level >= LEVELS.length) return null;
    const st = C.replay(LEVELS[cur.level], cur.path);
    return st && st.status === 'playing' ? { level: cur.level, state: st, hints: cur.hints } : null;
  }

  function saveCurrent() {
    progress.current = s && s.status === 'playing' && phase !== 'menu' ? { level, path: C.pathOf(s), hints: hintsUsed } : null;
    C.saveProgress(storage, progress);
  }

  function enterPlay() {
    setPhase('play');
    show(null);
    $('hud').hidden = false;
    $('controls').hidden = false;
    renderHUD();
    canvas.focus({ preventScroll: true });
  }

  // Starts level i from scratch with all hints, or resumes it when it's the saved level in progress.
  function startLevel(i) {
    Sound.unlock();
    const r = restored();
    if (r && r.level === i) {
      loadLevel(i, r.state);
      hintsUsed = r.hints;
    } else {
      loadLevel(i);
      hintsUsed = 0;
    }
    enterPlay();
    const tip = s.moves === 0 ? tipFor(level) : null;
    showTip(tip);
    saveCurrent();
  }

  function showTip(text) {
    $('tip').textContent = text ? t(text) : '';
    $('tip').hidden = !text;
  }

  function bump(id, dir) {
    bumps[id] = { dir: dir < 0 ? -1 : 1, t: 0 };
    sfx('bump');
    const v = vehicle(id);
    if (v) {
      const { x, y } = cornerAt(v, basePos(v));
      const ex = v.dir === 'h' ? (dir > 0 ? x + v.len : x) : x + 0.5;
      const ey = v.dir === 'h' ? y + 0.5 : (dir > 0 ? y + v.len : y);
      puff(ex, ey, 3, 'dust');
    }
  }

  // Makes a move; the drawn car eases from wherever it is to the new cell.
  function doMove(id, delta) {
    if (phase !== 'play' || !delta) return false;
    if (!C.move(s, id, delta)) { bump(id, delta); return false; }
    const v = vehicle(id);
    hint = null;
    showTip(null);
    sfx('slide', { dist: Math.abs(delta), kind: v.kind });
    if (gates.length) sfx('barrier', { open: C.gateOpen(s) });
    exhaust(v);
    if (s.status === 'won') win();
    else if (s.status === 'lost') lose();
    else saveCurrent();
    renderHUD();
    return true;
  }

  function commitPending() {
    if (!pending || !sel) { pending = 0; return; }
    const d = pending;
    pending = 0;
    doMove(sel, d);
  }

  function win() {
    outcome = { won: true, moves: s.moves, stars: C.stars(s.moves, s.optimal) };
    C.recordStars(progress, level, outcome.stars);
    drag = null;
    sel = null;
    exitV = 2;
    setPhase('exit');
    saveCurrent();
    sfx('win');
    const v = vehicle(C.PLAYER);
    puff(s.level.w + 0.3, v.y + 0.5, 24, 'conf');
  }

  function lose() {
    outcome = { won: false, moves: s.moves, stars: 0 };
    drag = null;
    sel = null;
    shake = 0.6;
    setPhase('lose');
    saveCurrent();
    sfx('lose');
  }

  function finish() {
    setPhase('end');
    showResult();
    renderHUD();
  }

  function undo() {
    const lost = phase === 'end' && outcome && !outcome.won;
    if (!(phase === 'play' || lost) || !s.history.length) return;
    commitPending();
    C.undo(s);
    hint = null;
    sfx('undo');
    if (lost) {
      outcome = null;
      enterPlay();
    }
    saveCurrent();
    renderHUD();
  }

  function restart() {
    if (!s || !(phase === 'play' || (phase === 'end' && !outcome.won))) return;
    pending = 0;
    C.restart(s);
    hint = null;
    outcome = null;
    if (phase !== 'play') enterPlay();
    sfx('undo');
    saveCurrent();
    renderHUD();
  }

  function useHint() {
    if (phase !== 'play' || hintBusy || hint || hintsUsed >= C.MAX_HINTS) return;
    commitPending();
    if (phase !== 'play') return;
    hintBusy = true;
    renderHUD();
    // Let the button show it's thinking: the solver can take a moment on the big boards.
    setTimeout(() => {
      hintBusy = false;
      if (phase !== 'play') { renderHUD(); return; }
      const sol = C.solve(s);
      if (sol && sol.path.length) {
        const [id, delta] = sol.path[0];
        hint = { id, delta };
        hintsUsed++;
        sfx('hint');
        showTip(null);
        saveCurrent();
      } else {
        showTip('Отсюда не выехать: отмени ход или начни заново');
      }
      renderHUD();
    }, 40);
  }

  function starsHTML(n, total = 3) {
    let h = '';
    for (let i = 0; i < total; i++) h += `<span class="${i < n ? 'on' : 'off'}">★</span>`;
    return h;
  }

  function showResult() {
    const o = outcome;
    $('res-title').textContent = o.won ? t('Выехали!') : t('Ходы кончились');
    $('res-title').classList.toggle('lost', !o.won);
    $('res-stars').innerHTML = starsHTML(o.stars);
    $('res-stars').setAttribute('aria-label', t('Звёзды: {n} из 3', { n: o.stars }));
    $('res-moves').textContent = o.won
      ? t('Ходы: {n}, оптимум: {opt}', { n: o.moves, opt: s.optimal })
      : t('Ходы: {n} из {limit}', { n: o.moves, limit: s.limit });
    let note;
    if (!o.won) note = t('Отмени ход или начни заново');
    else if (o.stars === 3) note = t('Идеально: быстрее не выехать!');
    else note = t('Для ★★★ нужно уложиться в {opt}', { opt: s.optimal });
    $('res-note').textContent = note;
    const hasNext = level + 1 < LEVELS.length;
    $('btn-next').hidden = !(o.won && hasNext);
    $('btn-res-undo').hidden = o.won;
    $('res-final').hidden = !(o.won && !hasNext);
    show('result');
    (o.won && hasNext ? $('btn-next') : o.won ? $('btn-again') : $('btn-res-undo')).focus({ preventScroll: true });
  }

  // ───────────── Screens ─────────────
  const SCREENS = ['menu', 'levels', 'result'];
  function show(name) {
    for (const id of SCREENS) $(id).hidden = id !== name;
    stage.classList.toggle('dim', !!name);
  }

  function nextLevel() {
    return Math.min(C.firstUnfinished(progress, LEVELS.length), LEVELS.length - 1);
  }

  function showMenu() {
    if (phase === 'play') saveCurrent();
    const r = restored();
    if (r) loadLevel(r.level, r.state);
    else loadLevel(nextLevel());
    setPhase('menu');
    $('hud').hidden = true;
    $('controls').hidden = true;
    showTip(null);
    $('btn-play').textContent = r ? t('Продолжить: уровень {n}', { n: r.level + 1 }) : t('Играть: уровень {n}', { n: level + 1 });
    renderSound();
    show('menu');
    $('btn-play').focus({ preventScroll: true });
  }

  function showLevels() {
    if (phase === 'play') { commitPending(); saveCurrent(); }
    setPhase('menu');
    const grid = $('level-grid');
    grid.innerHTML = '';
    let total = 0;
    LEVELS.forEach((_, i) => {
      const n = C.starsOf(progress, i);
      total += n;
      const open = C.unlocked(progress, i, LEVELS.length);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lvl-btn' + (open ? '' : ' locked') + (n ? ' done' : '') + (PARSED[i].w > 6 ? ' big7' : '');
      b.disabled = !open;
      b.innerHTML = `<b>${i + 1}</b>` + (open ? `<span class="mini-stars">${starsHTML(n)}</span>` : '<i class="lock" aria-hidden="true"></i>');
      b.setAttribute('aria-label', open ? t('Уровень {n}, звёзды: {s} из 3', { n: i + 1, s: n }) : t('Уровень {n} закрыт', { n: i + 1 }));
      b.addEventListener('click', () => startLevel(i));
      grid.append(b);
    });
    $('levels-total').textContent = t('Звёзд: {n} из {total}', { n: total, total: LEVELS.length * 3 });
    $('hud').hidden = true;
    $('controls').hidden = true;
    showTip(null);
    show('levels');
    const cur = grid.children[nextLevel()];
    if (cur) {
      cur.focus({ preventScroll: true });
      cur.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderHUD() {
    if (!s) return;
    $('hud-level').textContent = t('Уровень {n}', { n: level + 1 });
    $('hud-moves').textContent = t('Ходы: {n}/{limit}', { n: s.moves, limit: s.limit });
    $('hud-moves-wrap').classList.toggle('low', s.status === 'playing' && s.limit - s.moves <= 2);
    const gate = $('hud-gate');
    gate.hidden = !gates.length;
    if (gates.length) {
      const open = C.gateOpen(s);
      gate.classList.toggle('open', open);
      $('hud-gate-text').textContent = open ? t('Шлагбаум открыт') : t('Шлагбаум закрыт');
    }
    const best = $('hud-best');
    best.hidden = s.status !== 'won';
    best.textContent = t('Оптимум: {n}', { n: s.optimal });
    const lost = phase === 'end' && outcome && !outcome.won;
    $('btn-undo').disabled = !s.history.length || !(phase === 'play' || lost);
    $('btn-restart').disabled = !(phase === 'play' || lost) || (!s.history.length && phase === 'play');
    const left = C.MAX_HINTS - hintsUsed;
    $('hint-left').textContent = String(left);
    $('btn-hint').disabled = phase !== 'play' || left <= 0 || !!hint;
    $('btn-hint').classList.toggle('busy', hintBusy);
    $('btn-hint').setAttribute('aria-label', t('Подсказка, осталось: {n}', { n: left }));
  }

  function renderSound() {
    const on = !!Sound.enabled;
    const label = on ? t('Звук: вкл') : t('Звук: выкл');
    $('btn-sound-menu').textContent = label;
    $('btn-sound-menu').setAttribute('aria-pressed', String(on));
    const b = $('btn-sound');
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('off', !on);
    b.title = label;
    b.setAttribute('aria-label', label);
  }

  function toggleSound() {
    Sound.setEnabled(!Sound.enabled);
    Sound.unlock();
    renderSound();
  }

  // ───────────── Input ─────────────
  function pointerCell(e) {
    const r = canvas.getBoundingClientRect();
    return V.cellAt(fit, e.clientX - r.left, e.clientY - r.top);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (phase !== 'play' || drag) return;
    Sound.unlock();
    commitPending();
    if (phase !== 'play') return;
    const c = pointerCell(e);
    const id = c.inside ? V.vehicleAt(s, c.x, c.y) : null;
    sel = null;
    if (!id) return;
    drag = { id, pointer: e.pointerId, x0: c.fx, y0: c.fy, shift: 0, over: 0, started: false, bumped: false };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (phase !== 'play') { canvas.style.cursor = ''; return; }
    const c = pointerCell(e);
    if (drag && e.pointerId === drag.pointer) {
      const d = { dx: c.fx - drag.x0, dy: c.fy - drag.y0 };
      const v = vehicle(drag.id);
      const want = V.along(v, d);
      if (!drag.started && Math.abs(want) < V.DRAG_START) return;
      drag.started = true;
      drag.shift = V.dragTarget(s, drag.id, d);
      const push = V.overPush(s, drag.id, d);
      drag.over = Math.sign(want - drag.shift) * V.give(push);
      if (push > 0.3 && !drag.bumped) {
        drag.bumped = true;
        sfx('bump');
      } else if (push < 0.1) drag.bumped = false;
      return;
    }
    if (!drag) canvas.style.cursor = c.inside && V.vehicleAt(s, c.x, c.y) ? 'grab' : '';
  });
  const release = (e, cancel) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    drag = null;
    canvas.style.cursor = '';
    if (!d.started) return;
    const delta = cancel ? 0 : V.dropDelta(s, d.id, d.shift);
    if (delta) doMove(d.id, delta);
  };
  canvas.addEventListener('pointerup', (e) => release(e, false));
  canvas.addEventListener('pointercancel', (e) => release(e, true));

  // Arrows along the picked vehicle's axis slide it (made into a move on Enter, on picking another vehicle or
  // after a short pause); arrows across pick the nearest vehicle that way.
  function keyArrow(dx, dy) {
    const v = vehicle(sel);
    if (!v || v.x >= s.level.w) { sel = V.cycle(s, null); pending = 0; return; }
    const step = v.dir === 'h' ? dx : dy;
    if (step) {
      const r = C.moveRange(s, sel);
      if (!r) return;
      const exitAt = s.level.w - v.x;
      let next = pending + step;
      if (r.exit && step > 0 && next > r.max) next = exitAt;
      else if (pending > r.max && step < 0) next = r.max;
      if (next < r.min || (next > r.max && !(r.exit && next === exitAt))) { bump(sel, step); return; }
      pending = next;
      pendingT = 0;
      if (pending > r.max) commitPending(); // straight out through the exit
    } else {
      commitPending();
      if (phase !== 'play') return;
      const n = V.neighbor(s, sel, dx, dy);
      if (n) sel = n;
    }
  }

  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onBoard = phase === 'play' && (document.activeElement === canvas || document.activeElement === document.body);
    if (phase === 'play' && ARROWS[e.code]) {
      Sound.unlock();
      keyArrow(...ARROWS[e.code]);
      e.preventDefault();
    } else if (onBoard && e.code === 'Tab') {
      commitPending();
      if (phase === 'play') sel = V.cycle(s, sel, e.shiftKey ? -1 : 1);
      e.preventDefault();
    } else if (onBoard && (e.code === 'Enter' || e.code === 'Space')) {
      commitPending();
      e.preventDefault();
    } else if (e.code === 'Escape') {
      if (phase === 'play' && (pending || sel)) { pending = 0; sel = null; } else if (!$('levels').hidden) showMenu();
    } else if ((e.code === 'KeyZ' || e.code === 'Backspace') && phase !== 'menu') {
      undo();
      e.preventDefault();
    } else if (e.code === 'KeyR' && (phase === 'play' || phase === 'end')) {
      if (phase === 'end' && outcome && outcome.won) startLevel(level);
      else restart();
      e.preventDefault();
    } else if (e.code === 'KeyH' && phase === 'play') {
      useHint();
      e.preventDefault();
    }
  });

  $('btn-play').addEventListener('click', () => {
    const r = restored();
    startLevel(r ? r.level : nextLevel());
  });
  $('btn-levels-menu').addEventListener('click', showLevels);
  $('btn-sound-menu').addEventListener('click', toggleSound);
  $('btn-levels-back').addEventListener('click', showMenu);
  $('btn-levels').addEventListener('click', showLevels);
  $('btn-sound').addEventListener('click', toggleSound);
  // The move controls hand the keyboard back to the lot, so Tab and the arrows keep working after a click.
  const backToBoard = (fn) => () => { fn(); if (phase === 'play') canvas.focus({ preventScroll: true }); };
  $('btn-undo').addEventListener('click', backToBoard(undo));
  $('btn-restart').addEventListener('click', backToBoard(restart));
  $('btn-hint').addEventListener('click', backToBoard(useHint));
  $('btn-next').addEventListener('click', () => startLevel(level + 1));
  $('btn-again').addEventListener('click', () => (outcome && !outcome.won ? restart() : startLevel(level)));
  $('btn-res-undo').addEventListener('click', undo);
  $('btn-res-levels').addEventListener('click', showLevels);
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  window.addEventListener('pagehide', () => { if (phase === 'play') { commitPending(); saveCurrent(); } });

  // ───────────── Boot ─────────────
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = t(meta.content);
  const actions = $('top-actions');
  actions.append(window.I18n.toggle('chip'));
  if (window.GameNav) actions.append(window.GameNav.home('chip'));
  showMenu();
  requestAnimationFrame(frame);
})();
