'use strict';
// Тяни штифт — client: screens, input, the fixed-step loop and the Canvas 2D art. The rules live in
// core.js (window.PinsCore), the levels in levels.js (window.PinsLevels), pure helpers in view.js (window.PinsView).
(() => {
  const C = window.PinsCore;
  const V = window.PinsView;
  const LEVELS = window.PinsLevels.LEVELS;
  const { t } = window.I18n;
  const { W, H, WALL, PIN, WATER, LAVA, STONE, GOLD } = C;
  const { CELL, LW, LH, hash2, clamp } = V;
  const $ = (id) => document.getElementById(id);
  // A rounded rectangle path; older browsers without roundRect get a plain one.
  const rrect = (g, x, y, w, h, r) => (g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h));

  // Storage access itself may throw (blocked site data); core's progress functions tolerate a null storage.
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }

  // Sound comes from audio.js (index.html loads it first); its play() is silent while the sound is off.
  const Sound = window.PinsAudio;
  const sfx = (name) => Sound.play(name);

  // One-line lessons for the teaching levels, shown until the first pull.
  const TIPS = [
    'Потяни штифт, чтобы золото упало к герою',
    'Вода не опасна: золото тонет в ней',
    'Лава сжигает золото. Успей уронить его раньше',
    'Сожги врага лавой, пока он не добрался до героя',
    'Вода и лава вместе дают камень',
  ];

  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  let progress = C.loadProgress(storage);
  let level = 0;
  let s = null;            // core state of the level on screen
  let phase = 'menu';      // menu | play | walk | lose | end
  let phaseT = 0;          // seconds in the current phase
  let acc = 0;             // fixed-step accumulator (ticks)
  let drag = null;         // the pull gesture in progress (view.dragStart)
  let pulled = [];         // pins sliding out: { pin, t }
  let burning = [];        // enemies burning up: { e, t }
  let particles = [];
  let prevGrid = null;
  let prevGold = 0;
  let deadSeen = [];
  let outcome = null;      // { won, reason, stars, gold }
  let hint = null;         // pin id to point at on level 1
  let anyPull = false;
  let time = 0;
  let last = 0;

  // ───────────── Canvas size and cached art ─────────────
  let fit = V.fitCanvas({ w: LW, h: LH, dpr: 1 });
  let k = 1;               // device px per logical px
  let staticLayer = null;  // rock, chamber backs and edges of the current level
  let staticKey = '';
  const sprites = {};

  // Fits the canvas into the stage. Runs on window resizes and whenever the stage itself changes size
  // (the HUD showing up or wrapping onto a second line).
  function resize() {
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const next = V.fitCanvas({ w: stage.clientWidth - padX, h: stage.clientHeight - padY, dpr: window.devicePixelRatio || 1 });
    if (next.w === canvas.width && next.h === canvas.height && next.cssW === fit.cssW && sprites.coin) return;
    fit = next;
    k = fit.scale * fit.ratio;
    canvas.style.width = fit.cssW + 'px';
    canvas.style.height = fit.cssH + 'px';
    canvas.width = fit.w;
    canvas.height = fit.h;
    buildSprites();
    staticKey = '';
  }

  // An offscreen canvas sized in logical px (w×h) at the current device resolution, drawn in logical units.
  function offscreen(w, h) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w * k));
    cv.height = Math.max(1, Math.ceil(h * k));
    const g = cv.getContext('2d');
    g.setTransform(cv.width / w, 0, 0, cv.height / h, 0, 0);
    return { cv, g };
  }

  function buildSprites() {
    // Gold coin, front and slightly tilted.
    for (const [name, sy] of [['coin', 1], ['coinTilt', 0.72]]) {
      const { cv, g } = offscreen(12, 12);
      g.translate(6, 6);
      g.scale(1, sy);
      const grd = g.createRadialGradient(-1.6, -1.8, 0.5, 0, 0, 5.4);
      grd.addColorStop(0, '#fff6c4');
      grd.addColorStop(0.45, '#ffd34d');
      grd.addColorStop(1, '#c98a12');
      g.fillStyle = grd;
      g.beginPath(); g.arc(0, 0, 5.2, 0, Math.PI * 2); g.fill();
      g.lineWidth = 0.8; g.strokeStyle = '#8a5a08'; g.stroke();
      g.lineWidth = 0.6; g.strokeStyle = 'rgba(138, 90, 8, .55)';
      g.beginPath(); g.arc(0, 0, 3.3, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255, 255, 255, .85)';
      g.beginPath(); g.ellipse(-1.8, -2, 1.3, 0.8, -0.6, 0, Math.PI * 2); g.fill();
      sprites[name] = cv;
    }
    // Soft glow for lava edges and torches (drawn with 'lighter').
    for (const [name, inner, outer] of [['lavaGlow', 'rgba(255, 150, 40, .55)', 'rgba(255, 80, 0, 0)'],
      ['torchGlow', 'rgba(255, 190, 90, .32)', 'rgba(255, 140, 40, 0)']]) {
      const { cv, g } = offscreen(40, 40);
      const grd = g.createRadialGradient(20, 20, 0, 20, 20, 20);
      grd.addColorStop(0, inner);
      grd.addColorStop(1, outer);
      g.fillStyle = grd;
      g.fillRect(0, 0, 40, 40);
      sprites[name] = cv;
    }
  }

  // ───────────── Static layer: masonry rock, chamber backs, edges ─────────────
  const isWall = (x, y) => C.cellAt(s, x, y) === WALL;
  const inRect = (r, x, y) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

  function buildStatic() {
    const { cv, g } = offscreen(LW, LH);
    // Mortar, then the blocks: rows one cell high, blocks two cells wide, every other row shifted.
    g.fillStyle = '#17120f';
    g.fillRect(0, 0, LW, LH);
    for (let row = 0; row < H; row++) {
      const shift = row % 2 ? -CELL : 0;
      for (let bx = shift, n = 0; bx < LW; bx += 2 * CELL, n++) {
        const v = hash2(n, row, 11);
        const l = 23 + v * 9 - (row / H) * 5;
        g.fillStyle = `hsl(${24 + v * 10}, ${10 + v * 6}%, ${l}%)`;
        const y = row * CELL;
        g.fillRect(bx + 0.6, y + 0.6, 2 * CELL - 1.2, CELL - 1.2);
        g.fillStyle = 'rgba(255, 235, 200, .07)';
        g.fillRect(bx + 0.6, y + 0.6, 2 * CELL - 1.2, 1.2);
        g.fillStyle = 'rgba(0, 0, 0, .22)';
        g.fillRect(bx + 0.6, y + CELL - 2, 2 * CELL - 1.2, 1.4);
        if (v > 0.86) { // a chipped corner or a crack
          g.strokeStyle = 'rgba(0, 0, 0, .35)';
          g.lineWidth = 0.6;
          g.beginPath(); g.moveTo(bx + 4 + v * 8, y + 1); g.lineTo(bx + 7 + v * 6, y + 5); g.lineTo(bx + 5 + v * 9, y + 9); g.stroke();
        } else if (v < 0.03) { // a bit of moss
          g.fillStyle = 'rgba(96, 140, 60, .35)';
          g.beginPath(); g.ellipse(bx + 6 + v * 60, y + 2, 4, 1.6, 0, 0, Math.PI * 2); g.fill();
        }
      }
    }

    // Chamber backs: a dark cave wall, warm planks in the hero's room.
    g.save();
    g.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!isWall(x, y)) g.rect(x * CELL, y * CELL, CELL, CELL);
    g.clip();
    const cave = g.createLinearGradient(0, 0, 0, LH);
    cave.addColorStop(0, '#2b2540');
    cave.addColorStop(1, '#16121f');
    g.fillStyle = cave;
    g.fillRect(0, 0, LW, LH);
    g.strokeStyle = 'rgba(255, 255, 255, .035)';
    g.lineWidth = 1;
    for (let row = 0; row * 15 < LH; row++) {
      const y = row * 15;
      g.beginPath(); g.moveTo(0, y); g.lineTo(LW, y); g.stroke();
      for (let x = (row % 2) * 15; x < LW; x += 30) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 15); g.stroke(); }
    }
    const room = s.room;
    if (room) {
      const rx = room.x * CELL, ry = room.y * CELL, rw = room.w * CELL, rh = room.h * CELL;
      const wood = g.createLinearGradient(0, ry, 0, ry + rh);
      wood.addColorStop(0, '#3d2a1d');
      wood.addColorStop(1, '#2a1c13');
      g.fillStyle = wood;
      g.fillRect(rx, ry, rw, rh);
      for (let x = rx, n = 0; x < rx + rw; x += 15, n++) {
        g.fillStyle = `rgba(${hash2(n, 3, 5) > 0.5 ? '255, 220, 170, .05' : '0, 0, 0, .12'})`;
        g.fillRect(x, ry, 15, rh);
        g.fillStyle = 'rgba(0, 0, 0, .4)';
        g.fillRect(x, ry, 1, rh);
        g.fillStyle = 'rgba(0, 0, 0, .3)'; // nail heads
        g.fillRect(x + 7, ry + rh - 34, 1.4, 1.4);
        g.fillRect(x + 7, ry + 12, 1.4, 1.4);
      }
      g.fillStyle = 'rgba(0, 0, 0, .28)'; // a beam across the room
      g.fillRect(rx, ry + rh - 36, rw, 4);
    }
    g.restore();

    // Edges: an inner shadow inside the chamber, a lit rim on floors, a dark lip under ceilings.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (isWall(x, y)) continue;
        const px = x * CELL, py = y * CELL;
        if (isWall(x, y - 1)) {
          const gr = g.createLinearGradient(0, py, 0, py + 6);
          gr.addColorStop(0, 'rgba(0, 0, 0, .55)'); gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
          g.fillStyle = gr; g.fillRect(px, py, CELL, 6);
        }
        if (isWall(x - 1, y)) {
          const gr = g.createLinearGradient(px, 0, px + 5, 0);
          gr.addColorStop(0, 'rgba(0, 0, 0, .45)'); gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
          g.fillStyle = gr; g.fillRect(px, py, 5, CELL);
        }
        if (isWall(x + 1, y)) {
          const gr = g.createLinearGradient(px + CELL, 0, px + CELL - 5, 0);
          gr.addColorStop(0, 'rgba(0, 0, 0, .45)'); gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
          g.fillStyle = gr; g.fillRect(px + CELL - 5, py, 5, CELL);
        }
        if (isWall(x, y + 1)) { // the floor's lit top face
          g.fillStyle = inRect(room, x, y) ? '#7a5434' : '#5d4f45';
          g.fillRect(px, py + CELL, CELL, 2);
          g.fillStyle = 'rgba(255, 230, 190, .22)';
          g.fillRect(px, py + CELL, CELL, 0.8);
        }
        if (isWall(x, y - 1)) {
          g.fillStyle = 'rgba(0, 0, 0, .5)';
          g.fillRect(px, py - 1.5, CELL, 1.5);
        }
      }
    }
    // Handle pockets: a dark hole the pin goes into.
    for (const p of s.pins) {
      const h = C.handleCell(p);
      g.fillStyle = 'rgba(0, 0, 0, .45)';
      g.beginPath(); g.arc(h.x * CELL + 5, h.y * CELL + 5, 4, 0, Math.PI * 2); g.fill();
    }
    // A thin frame around the whole board.
    g.strokeStyle = 'rgba(0, 0, 0, .6)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, LW - 2, LH - 2);
    return cv;
  }

  // ───────────── Cells: stone, gold, water, lava ─────────────
  const WATER_TOP = [120, 200, 255], WATER_DEEP = [24, 78, 190];
  const LAVA_TOP = [255, 214, 90], LAVA_DEEP = [190, 40, 18];
  const mix = (a, b, f) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)}, ${Math.round(a[1] + (b[1] - a[1]) * f)}, ${Math.round(a[2] + (b[2] - a[2]) * f)})`;
  const WATER_SHADES = Array.from({ length: 13 }, (_, i) => mix(WATER_TOP, WATER_DEEP, i / 12));
  const LAVA_SHADES = Array.from({ length: 13 }, (_, i) => mix(LAVA_TOP, LAVA_DEEP, i / 12));

  // Depth of each liquid cell below the surface of its run in its column (0 = the surface).
  const depthBuf = new Uint8Array(W * H);
  function liquidDepth() {
    const g = s.grid, depth = depthBuf;
    for (let x = 0; x < W; x++) {
      let run = 0, type = -1;
      for (let y = 0; y < H; y++) {
        const c = g[y * W + x];
        if (c === WATER || c === LAVA) { run = c === type ? run + 1 : 0; type = c; depth[y * W + x] = run; } else { type = -1; run = 0; }
      }
    }
    return depth;
  }

  // Stone and gold, drawn before the door (the pile lies behind it).
  function drawSolids() {
    const g = s.grid;
    // Stone formed where lava met water.
    for (let i = 0; i < W * H; i++) {
      if (g[i] !== STONE) continue;
      const x = i % W, y = (i - x) / W, px = x * CELL, py = y * CELL, v = hash2(x, y, 7);
      ctx.fillStyle = `hsl(220, 6%, ${22 + v * 8}%)`;
      ctx.fillRect(px - 0.2, py - 0.2, CELL + 0.4, CELL + 0.4);
      ctx.fillStyle = 'rgba(255, 255, 255, .12)';
      ctx.fillRect(px + 2 + v * 4, py + 2 + v * 3, 1.6, 1.6);
      ctx.fillStyle = 'rgba(0, 0, 0, .25)';
      ctx.fillRect(px + 6 - v * 3, py + 6, 2, 1.4);
      if (C.cellAt(s, x, y - 1) !== STONE) { ctx.fillStyle = 'rgba(255, 255, 255, .14)'; ctx.fillRect(px, py, CELL, 1); }
    }
    // Gold coins, a little jitter per cell so the pile looks loose.
    for (let i = 0; i < W * H; i++) {
      if (g[i] !== GOLD) continue;
      const x = i % W, y = (i - x) / W, v = hash2(x, y, 3);
      ctx.drawImage(v > 0.6 ? sprites.coinTilt : sprites.coin, x * CELL - 1 + (v - 0.5) * 2, y * CELL - 1 + (hash2(y, x, 4) - 0.5) * 1.5, 12, 12);
    }
  }

  // Water and lava, drawn after the door so a flood shows over it.
  function drawLiquids(depth) {
    const g = s.grid;
    // Water: shaded by depth, translucent, a rippling bright line on the surface.
    ctx.globalAlpha = 0.86;
    for (let i = 0; i < W * H; i++) {
      if (g[i] !== WATER) continue;
      const x = i % W, y = (i - x) / W;
      ctx.fillStyle = WATER_SHADES[Math.min(12, depth[i])];
      ctx.fillRect(x * CELL - 0.3, y * CELL - 0.3, CELL + 0.6, CELL + 0.6);
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < W * H; i++) {
      if (g[i] !== WATER || depth[i] !== 0) continue;
      const x = i % W, y = (i - x) / W;
      if (C.cellAt(s, x, y - 1) !== 0) continue;
      const wave = Math.sin(time * 3 + x * 0.9) * 0.9;
      ctx.fillStyle = 'rgba(225, 245, 255, .85)';
      ctx.fillRect(x * CELL, y * CELL + 1 + wave, CELL, 1.5);
      if (hash2(x, Math.floor(time * 2 + x), 9) < 0.12) {
        ctx.fillStyle = 'rgba(255, 255, 255, .7)';
        ctx.fillRect(x * CELL + 3, y * CELL + 4 + wave, 3, 1);
      }
    }
    // Lava: hot top, deep red bottom, bubbles; then a glow over its exposed edges.
    for (let i = 0; i < W * H; i++) {
      if (g[i] !== LAVA) continue;
      const x = i % W, y = (i - x) / W;
      ctx.fillStyle = LAVA_SHADES[Math.min(12, depth[i] * 2)];
      ctx.fillRect(x * CELL - 0.3, y * CELL - 0.3, CELL + 0.6, CELL + 0.6);
      const v = hash2(x, y, 21);
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + v * 9);
      ctx.fillStyle = `rgba(255, 240, 150, ${0.08 + pulse * 0.16})`;
      ctx.fillRect(x * CELL + v * 5, y * CELL + 2 + pulse * 3, 3, 2);
    }
    for (let i = 0; i < W * H; i++) {
      if (g[i] !== LAVA || depth[i] !== 0) continue;
      const x = i % W, y = (i - x) / W;
      if (C.cellAt(s, x, y - 1) !== 0) continue;
      const b = (time * 0.9 + hash2(x, y, 5) * 3) % 1;
      if (hash2(x, Math.floor(time * 0.9 + hash2(x, y, 5) * 3), 6) < 0.18) {
        ctx.fillStyle = `rgba(255, 220, 120, ${1 - b})`;
        ctx.beginPath(); ctx.arc(x * CELL + 5, y * CELL + 3 - b * 4, 1 + b * 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255, 250, 200, .9)';
      ctx.fillRect(x * CELL, y * CELL, CELL, 1.6);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 + 0.08 * Math.sin(time * 3);
    for (let i = 0; i < W * H; i++) {
      if (g[i] !== LAVA) continue;
      const x = i % W, y = (i - x) / W;
      if (C.cellAt(s, x, y - 1) !== 0 && C.cellAt(s, x - 1, y) !== 0 && C.cellAt(s, x + 1, y) !== 0) continue;
      ctx.drawImage(sprites.lavaGlow, x * CELL - 12, y * CELL - 14, 34, 34);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ───────────── Pins ─────────────
  function drawPin(p, off, alpha) {
    const { dx, dy } = V.pullDir(p);
    const h = C.handleCell(p);
    const hx = h.x * CELL + 5 + dx * off * CELL, hy = h.y * CELL + 5 + dy * off * CELL;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(dx * off * CELL, dy * off * CELL);
    const horiz = p.handle !== 'top';
    // The bar: a steel rod with a rounded tip, reaching into the handle's ring.
    let x0 = p.x * CELL + 1, y0 = p.y * CELL + 2.2, x1 = (p.x + p.w) * CELL - 1, y1 = y0 + 5.6;
    if (!horiz) { x0 = p.x * CELL + 2.2; x1 = x0 + 5.6; y0 = p.y * CELL - 2; y1 = (p.y + p.h) * CELL - 1; }
    if (p.handle === 'left') x0 -= 4;
    if (p.handle === 'right') x1 += 4;
    const grd = horiz ? ctx.createLinearGradient(0, y0, 0, y1) : ctx.createLinearGradient(x0, 0, x1, 0);
    grd.addColorStop(0, '#f6f8fc');
    grd.addColorStop(0.45, '#b4bdcb');
    grd.addColorStop(1, '#5a6372');
    ctx.fillStyle = grd;
    ctx.strokeStyle = '#262a33';
    ctx.lineWidth = 0.8;
    const r = 2.8;
    ctx.beginPath();
    rrect(ctx, x0, y0, x1 - x0, y1 - y0, r);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, .55)';
    if (horiz) ctx.fillRect(x0 + 2, y0 + 1, x1 - x0 - 4, 0.9);
    else ctx.fillRect(x0 + 1, y0 + 2, 0.9, y1 - y0 - 4);
    ctx.restore();

    // The ring: a brass loop around the handle cell.
    ctx.save();
    ctx.globalAlpha = alpha;
    const ring = ctx.createLinearGradient(hx - 7, hy - 7, hx + 7, hy + 7);
    ring.addColorStop(0, '#fff1a8');
    ring.addColorStop(0.5, '#f0b62e');
    ring.addColorStop(1, '#9a6510');
    ctx.lineWidth = 4.2;
    ctx.strokeStyle = '#3a2706';
    ctx.beginPath(); ctx.arc(hx, hy, 6.2, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ring;
    ctx.beginPath(); ctx.arc(hx, hy, 6.2, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = 'rgba(255, 255, 255, .7)';
    ctx.beginPath(); ctx.arc(hx, hy, 6.4, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
    // The pin's number (keys 1–5) on a small badge beside the ring.
    if (off === 0 && alpha === 1) {
      const bx = hx + (horiz ? 0 : 9), by = hy + (horiz ? -10 : 0);
      ctx.fillStyle = 'rgba(20, 16, 28, .82)';
      ctx.beginPath(); ctx.arc(bx, by, 4.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.font = 'bold 7px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.id), bx, by + 0.4);
    }
    ctx.restore();
  }

  function drawPins(dt) {
    for (const p of s.pins) {
      if (p.pulled) continue;
      const off = drag && drag.id === p.id ? Math.min(1.6, drag.along * 0.6) : 0;
      drawPin(p, off, 1);
    }
    pulled = pulled.filter((a) => (a.t += dt) < 0.4);
    for (const a of pulled) {
      const f = a.t / 0.4;
      const len = (a.pin.handle === 'top' ? a.pin.h : a.pin.w) + 3;
      drawPin(a.pin, (0.3 + f * f) * len, 1 - f * f);
    }
  }

  // Level 1: a pulsing ring and an arrow on the pin to pull, until the first pull.
  function drawHint() {
    if (hint == null || anyPull || phase !== 'play') return;
    const p = s.pins.find((q) => q.id === hint);
    if (!p || p.pulled) return;
    const h = C.handleCell(p);
    const { dx, dy } = V.pullDir(p);
    const cx = h.x * CELL + 5, cy = h.y * CELL + 5;
    const f = (time % 1.4) / 1.4;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * (1 - f)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 8 + f * 12, 0, Math.PI * 2); ctx.stroke();
    const o = 12 + Math.sin(time * 5) * 3;
    const ax = cx + dx * o, ay = cy + dy * o;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = 'rgba(255, 255, 255, .92)';
    ctx.strokeStyle = 'rgba(0, 0, 0, .5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(10, 0); ctx.lineTo(2, -6); ctx.lineTo(2, -2.5); ctx.lineTo(-6, -2.5);
    ctx.lineTo(-6, 2.5); ctx.lineTo(2, 2.5); ctx.lineTo(2, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ───────────── Hero, enemies, the door, torches ─────────────
  const HERO_LOOK = { skin: '#f5c9a0', hair: '#6b3f1f', body: ['#5b9bff', '#2b5fb8'], cape: '#c8324a', belt: '#5b3a1e', legs: '#3b3550', boots: '#2a1d14' };
  const ENEMY_LOOK = { skin: '#7cc04f', hair: '#8a8f98', body: ['#8a5a34', '#5a3a20'], cape: null, belt: '#2f2018', legs: '#4a3a2a', boots: '#21170f' };
  const BURNT = { skin: '#3a302b', hair: '#1d1714', body: ['#2e2622', '#1d1714'], cape: '#2a1f1c', belt: '#151010', legs: '#1d1714', boots: '#120d0b' };

  // A figure in a 3×5-cell box at logical (bx, by). o: { look, face, walk (phase or null), mood, enemy, alpha }.
  function drawFigure(bx, by, o) {
    const L = o.look;
    const cx = bx + 15;
    const bob = o.walk == null ? Math.sin(time * 2.2 + bx) * 0.6 : Math.abs(Math.sin(o.walk)) * -1.5;
    ctx.save();
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    ctx.fillStyle = 'rgba(0, 0, 0, .35)';
    ctx.beginPath(); ctx.ellipse(cx, by + 49.5, 11, 2.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(cx, by + bob);
    ctx.scale(o.face || 1, 1);
    // Legs and boots.
    const sw = o.walk == null ? 0 : Math.sin(o.walk) * 3;
    for (const [lx, d] of [[-5, sw], [2, -sw]]) {
      ctx.fillStyle = L.legs;
      ctx.fillRect(lx + d * 0.5, 37, 4, 9);
      ctx.fillStyle = L.boots;
      ctx.beginPath(); rrect(ctx, lx - 1 + d, 44.5, 6.5, 5, 1.5); ctx.fill();
    }
    // Cape behind the body.
    if (L.cape) {
      ctx.fillStyle = L.cape;
      ctx.beginPath();
      ctx.moveTo(-7, 21); ctx.lineTo(7, 21);
      ctx.lineTo(10 + (o.walk == null ? 0 : -Math.abs(sw)), 41); ctx.lineTo(-11 - (o.walk == null ? 0 : Math.abs(sw)), 41);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0, 0, 0, .22)';
      ctx.fillRect(-11, 39, 21, 2);
    }
    // Arms (raised when cheering), body, belt.
    const up = o.mood === 'cheer';
    for (const ax of [-11, 7]) {
      const swing = o.walk == null ? 0 : (ax < 0 ? sw : -sw) * 0.6;
      ctx.fillStyle = L.body[1];
      if (up) { ctx.beginPath(); rrect(ctx, ax, 9, 4, 14, 2); ctx.fill(); }
      else { ctx.beginPath(); rrect(ctx, ax + swing * 0.3, 21, 4, 13, 2); ctx.fill(); }
      ctx.fillStyle = L.skin;
      ctx.beginPath(); ctx.arc(ax + 2 + (up ? 0 : swing * 0.3), up ? 9 : 34, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    const bodyG = ctx.createLinearGradient(-8, 20, 8, 38);
    bodyG.addColorStop(0, L.body[0]);
    bodyG.addColorStop(1, L.body[1]);
    ctx.fillStyle = bodyG;
    ctx.beginPath(); rrect(ctx, -8, 20, 16, 18, 4); ctx.fill();
    ctx.fillStyle = L.belt;
    ctx.fillRect(-8, 31, 16, 3);
    ctx.fillStyle = o.enemy ? '#6b6f78' : '#ffcf4a';
    ctx.fillRect(-1.6, 31, 3.2, 3);
    // Head.
    ctx.fillStyle = L.skin;
    ctx.strokeStyle = 'rgba(0, 0, 0, .3)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(0, 12, 8.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (o.enemy) {
      // Pointy ears, an iron helmet with horns, angry brows, red eyes, fangs.
      ctx.fillStyle = L.skin;
      ctx.beginPath(); ctx.moveTo(-8, 10); ctx.lineTo(-13, 7); ctx.lineTo(-7.5, 14); ctx.fill();
      ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(13, 7); ctx.lineTo(7.5, 14); ctx.fill();
      ctx.fillStyle = '#e9e2cc';
      ctx.beginPath(); ctx.moveTo(-6, 5); ctx.quadraticCurveTo(-12, 1, -10, -4); ctx.lineTo(-4, 4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(6, 5); ctx.quadraticCurveTo(12, 1, 10, -4); ctx.lineTo(4, 4); ctx.fill();
      ctx.fillStyle = L.hair;
      ctx.beginPath(); ctx.arc(0, 11, 9, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, .25)';
      ctx.fillRect(-6, 5, 5, 1.2);
      ctx.fillStyle = o.mood === 'burnt' ? '#222' : '#ff3b2f';
      ctx.beginPath(); ctx.arc(-3, 13, 1.6, 0, Math.PI * 2); ctx.arc(3.2, 13, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#1d2a12';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-5.5, 10); ctx.lineTo(-1, 11.6); ctx.moveTo(5.5, 10); ctx.lineTo(1.2, 11.6); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(-3, 17); ctx.lineTo(-2, 19.5); ctx.lineTo(-1, 17); ctx.moveTo(1, 17); ctx.lineTo(2, 19.5); ctx.lineTo(3, 17); ctx.fill();
      // A club raised over the shoulder, swaying.
      ctx.save();
      ctx.translate(9, 28);
      ctx.rotate(-0.5 + Math.sin(time * 3 + bx) * 0.12);
      ctx.fillStyle = '#7a4d26';
      ctx.fillRect(-1.3, -18, 2.6, 18);
      ctx.fillStyle = '#5e3a1b';
      ctx.beginPath(); ctx.ellipse(0, -19, 3.6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#cfcfcf';
      ctx.fillRect(-3.8, -21, 1.2, 1.2); ctx.fillRect(2.6, -18, 1.2, 1.2);
      ctx.restore();
    } else {
      // Hair, eyes looking ahead, cheeks, a mouth that follows the mood.
      ctx.fillStyle = L.hair;
      ctx.beginPath(); ctx.arc(0, 10.5, 9, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-8.6, 9); ctx.quadraticCurveTo(-2, 7, 3, 4); ctx.lineTo(8.6, 9); ctx.lineTo(8.6, 6); ctx.lineTo(-8.6, 6); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-1, 2.5); ctx.quadraticCurveTo(2, -2, 5, 1); ctx.quadraticCurveTo(2, 0, 1, 3); ctx.fill();
      if (o.mood === 'burnt') {
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1;
        for (const ex of [-2.5, 4]) { ctx.beginPath(); ctx.moveTo(ex - 1.4, 11); ctx.lineTo(ex + 1.4, 14); ctx.moveTo(ex + 1.4, 11); ctx.lineTo(ex - 1.4, 14); ctx.stroke(); }
      } else {
        ctx.fillStyle = '#2a1a10';
        ctx.beginPath(); ctx.ellipse(-2.5, 12.5, 1.3, 1.7, 0, 0, Math.PI * 2); ctx.ellipse(4, 12.5, 1.3, 1.7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(-2.3, 11.4, 0.8, 0.8); ctx.fillRect(4.2, 11.4, 0.8, 0.8);
        ctx.fillStyle = 'rgba(255, 110, 110, .35)';
        ctx.beginPath(); ctx.arc(-4.8, 15.5, 1.8, 0, Math.PI * 2); ctx.arc(6.4, 15.5, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = '#7a3b22';
      ctx.fillStyle = '#7a3b22';
      ctx.lineWidth = 1;
      if (o.mood === 'scared') { ctx.beginPath(); ctx.ellipse(1, 17.2, 1.4, 1.9, 0, 0, Math.PI * 2); ctx.fill(); }
      else if (o.mood === 'cheer') { ctx.beginPath(); ctx.arc(1, 16, 2.8, 0, Math.PI); ctx.fill(); }
      else if (o.mood !== 'burnt') { ctx.beginPath(); ctx.arc(1, 15.4, 2.4, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); }
      if (o.mood === 'scared') { // a drop of sweat
        ctx.fillStyle = '#9fd8ff';
        ctx.beginPath(); ctx.moveTo(-8, 5); ctx.quadraticCurveTo(-10, 9, -8, 10); ctx.quadraticCurveTo(-6, 9, -8, 5); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawDoor(open) {
    const e = s.exit;
    if (!e) return;
    const x = e.x * CELL, y = e.y * CELL;
    // Stone arch frame.
    ctx.fillStyle = '#6e6560';
    ctx.beginPath(); ctx.moveTo(x - 3, y + 50); ctx.lineTo(x - 3, y + 12); ctx.arc(x + 15, y + 12, 18, Math.PI, 0); ctx.lineTo(x + 33, y + 50); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, .35)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 6; i++) {
      const a = Math.PI + (i / 5) * Math.PI;
      ctx.beginPath(); ctx.moveTo(x + 15 + Math.cos(a) * 15, y + 12 + Math.sin(a) * 15); ctx.lineTo(x + 15 + Math.cos(a) * 18, y + 12 + Math.sin(a) * 18); ctx.stroke();
    }
    // The opening: warm daylight behind the door.
    ctx.save();
    ctx.beginPath(); ctx.moveTo(x, y + 50); ctx.lineTo(x, y + 12); ctx.arc(x + 15, y + 12, 15, Math.PI, 0); ctx.lineTo(x + 30, y + 50); ctx.closePath();
    ctx.clip();
    const light = ctx.createLinearGradient(0, y - 3, 0, y + 50);
    light.addColorStop(0, '#fff6d0');
    light.addColorStop(1, '#ffc768');
    ctx.fillStyle = light;
    ctx.fillRect(x, y - 3, 30, 53);
    // The door swings open: its visible width shrinks towards the hinge.
    const dw = 30 * (1 - open * 0.85);
    const wood = ctx.createLinearGradient(x, 0, x + dw, 0);
    wood.addColorStop(0, '#8a5328');
    wood.addColorStop(1, '#5e3416');
    ctx.fillStyle = wood;
    ctx.fillRect(x, y - 3, dw, 53);
    ctx.fillStyle = 'rgba(0, 0, 0, .3)';
    for (let i = 1; i < 4; i++) ctx.fillRect(x + (dw * i) / 4, y - 3, 0.8, 53);
    ctx.fillStyle = '#2d2a2a';
    ctx.fillRect(x, y + 12, dw, 2.4);
    ctx.fillRect(x, y + 38, dw, 2.4);
    if (open < 0.5) {
      ctx.strokeStyle = '#d9a640';
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(x + dw - 6, y + 27, 2.4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    // A green arrow sign over the arch.
    ctx.fillStyle = '#1f7a3a';
    ctx.beginPath(); rrect(ctx, x + 5, y - 13, 20, 8, 2); ctx.fill();
    ctx.fillStyle = '#d9ffe0';
    ctx.beginPath(); ctx.moveTo(x + 9, y - 9); ctx.lineTo(x + 17, y - 9); ctx.lineTo(x + 17, y - 11.5); ctx.lineTo(x + 21.5, y - 9); ctx.lineTo(x + 17, y - 6.5); ctx.lineTo(x + 17, y - 9); ctx.fill();
    ctx.fillRect(x + 9, y - 9.8, 8, 1.6);
  }

  // Torches on the wall on both sides of the door (where the room has space), with a flicker and a warm light.
  function drawTorches() {
    const r = s.room, e = s.exit;
    if (!r || !e) return;
    const ty = e.y * CELL + 6;
    for (const tx of [e.x * CELL - 10, (e.x + e.w) * CELL + 10]) {
      if (tx < r.x * CELL + 5 || tx > (r.x + r.w) * CELL - 5) continue;
      ctx.fillStyle = '#4a3020';
      ctx.fillRect(tx - 1.5, ty, 3, 9);
      ctx.fillStyle = '#2a2420';
      ctx.fillRect(tx - 3, ty + 6, 6, 2);
      const f = Math.sin(time * 13 + tx) * 0.6 + Math.sin(time * 7.3 + tx * 2) * 0.4;
      ctx.fillStyle = '#ff8a1e';
      ctx.beginPath(); ctx.ellipse(tx, ty - 2, 3 + f * 0.4, 5.5 + f, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe58a';
      ctx.beginPath(); ctx.ellipse(tx, ty - 0.5, 1.6, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85 + f * 0.1;
      ctx.drawImage(sprites.torchGlow, tx - 34, ty - 36, 68, 68);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawEntities(dt) {
    s.enemies.forEach((e, n) => {
      if (!e.dead) drawFigure(e.x * CELL, e.y * CELL, { look: ENEMY_LOOK, enemy: true, face: s.hero && s.hero.x < e.x ? -1 : 1, mood: 'idle' });
      else if (!deadSeen[n]) {
        deadSeen[n] = true;
        burning.push({ e, t: 0 });
        sfx('burn');
      }
    });
    burning = burning.filter((b) => (b.t += dt) < 1);
    for (const b of burning) {
      const f = b.t;
      drawFigure(b.e.x * CELL, b.e.y * CELL - f * 4, { look: f < 0.25 ? ENEMY_LOOK : BURNT, enemy: true, mood: 'burnt', alpha: 1 - f });
      if (Math.random() < 0.5) puff(b.e.x * CELL + 5 + Math.random() * 20, b.e.y * CELL + 10 + Math.random() * 35, 'smoke');
    }
    const h = s.hero;
    if (!h) return;
    if (phase === 'end' && outcome && outcome.won) return; // gone through the door
    if (phase === 'walk') {
      const cheer = 0.5, door = 0.5;
      const tw = Math.max(0, phaseT - cheer);
      const p = V.walkPos(h, s.exit, tw);
      const into = p.done ? clamp((tw - V.walkTime(h, s.exit)) / door, 0, 1) : 0;
      const hop = phaseT < cheer ? -Math.abs(Math.sin(phaseT * Math.PI * 2 / cheer)) * 5 : 0;
      drawFigure(p.x * CELL, p.y * CELL + hop, { look: HERO_LOOK, face: p.face, walk: phaseT < cheer || p.done ? null : tw * 14, mood: phaseT < cheer ? 'cheer' : 'idle', alpha: 1 - into });
      return;
    }
    const lostTo = s.lost || (outcome && !outcome.won && outcome.reason);
    const mood = lostTo === 'lava' && s.lost ? 'burnt' : lostTo ? 'scared' : 'idle';
    const shake = mood === 'scared' && phase === 'lose' ? Math.sin(time * 40) * 0.8 : 0;
    const face = s.exit && s.exit.x < h.x ? -1 : 1;
    drawFigure(h.x * CELL + shake, h.y * CELL, { look: mood === 'burnt' ? BURNT : HERO_LOOK, face, mood });
  }

  // ───────────── Particles ─────────────
  function puff(x, y, kind) {
    if (particles.length > 260) return;
    const steam = kind === 'steam' || kind === 'smoke';
    particles.push({
      x, y, kind,
      vx: (Math.random() - 0.5) * (steam ? 14 : 60),
      vy: steam ? -18 - Math.random() * 16 : -40 - Math.random() * 50,
      life: 0,
      max: steam ? 0.9 + Math.random() * 0.6 : 0.5 + Math.random() * 0.3,
      r: steam ? 2.5 + Math.random() * 2.5 : 1 + Math.random(),
    });
  }

  function drawParticles(dt) {
    particles = particles.filter((p) => (p.life += dt) < p.max);
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const f = p.life / p.max;
      if (p.kind === 'spark') {
        p.vy += 160 * dt;
        ctx.fillStyle = `rgba(255, ${180 - f * 120 | 0}, 60, ${1 - f})`;
        ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
      } else {
        const c = p.kind === 'steam' ? '230, 236, 245' : '60, 52, 50';
        ctx.fillStyle = `rgba(${c}, ${(1 - f) * 0.55})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + f * 1.6), 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  const FLOW_CELLS = 6; // liquid cells that moved into empty space in one frame to count as pouring
  // Changes since the last frame: new stone hisses with steam, burnt gold sparks, gold reaching the room clinks,
  // pouring water gurgles and pouring lava bubbles.
  function watchChanges() {
    const g = s.grid;
    if (!prevGrid) { prevGrid = g.slice(); prevGold = C.goldInRoom(s); return; }
    let hiss = false, burn = false, water = 0, lava = 0;
    for (let i = 0; i < W * H; i++) {
      const was = prevGrid[i], now = g[i];
      if (was === now) continue;
      const x = i % W, y = (i - x) / W;
      if (was === 0 && now === WATER) water++;
      else if (was === 0 && now === LAVA) lava++;
      if (now === STONE && was !== STONE) {
        hiss = true;
        puff(x * CELL + 5, y * CELL + 2, 'steam');
      } else if (was === GOLD && now === 0) {
        const nearLava = [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => C.cellAt(s, x + dx, y + dy) === LAVA);
        if (nearLava) {
          burn = true;
          for (let n = 0; n < 2; n++) puff(x * CELL + 5, y * CELL + 5, 'spark');
        }
      }
    }
    prevGrid.set(g);
    if (hiss) sfx('hiss');
    if (burn) sfx('sizzle');
    if (water >= FLOW_CELLS) sfx('gurgle');
    if (lava >= FLOW_CELLS) sfx('bubble');
    const gold = C.goldInRoom(s);
    if (gold > prevGold) sfx('coin');
    prevGold = gold;
  }

  // ───────────── Frame ─────────────
  function draw(dt) {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (!s) return;
    const key = String(level); // resize() clears staticKey
    if (key !== staticKey) { staticLayer = buildStatic(); staticKey = key; }
    ctx.drawImage(staticLayer, 0, 0, LW, LH);
    drawTorches();
    // The door opens as the hero comes close and stays open once the hero is through.
    let open = 0;
    if (phase === 'walk') open = clamp((phaseT - V.walkTime(s.hero, s.exit)) / 0.5, 0, 1);
    else if (outcome && outcome.won && phase === 'end') open = 1;
    drawSolids();
    drawDoor(open);
    drawLiquids(liquidDepth());
    drawEntities(dt);
    drawPins(dt);
    drawParticles(dt);
    drawHint();
    if (phase === 'lose' || (phase === 'end' && outcome && !outcome.won)) {
      const a = Math.min(1, phaseT * 2) * 0.35;
      const vg = ctx.createRadialGradient(LW / 2, LH / 2, LH * 0.25, LW / 2, LH / 2, LH * 0.7);
      vg.addColorStop(0, 'rgba(120, 0, 0, 0)');
      vg.addColorStop(1, `rgba(120, 0, 0, ${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, LW, LH);
    }
  }

  function update(dt) {
    phaseT += dt;
    if (phase === 'play' || phase === 'lose' || phase === 'walk') {
      const r = V.fixedSteps(acc, dt);
      acc = r.acc;
      for (let i = 0; i < r.n; i++) C.step(s);
      watchChanges();
    }
    if (phase === 'play') {
      const st = C.status(s);
      if (st.status === 'won') {
        outcome = { won: true, reason: null, stars: C.stars(s), gold: C.goldInRoom(s), allDead: C.liveEnemies(s) === 0 };
        C.recordWin(storage, progress, level, outcome.stars);
        drag = null;
        setPhase('walk');
        sfx('win');
      } else if (st.status === 'lost') {
        outcome = { won: false, reason: st.reason, burnt: s.lost === 'lava', stars: 0, gold: C.goldInRoom(s), allDead: C.liveEnemies(s) === 0 };
        drag = null;
        setPhase('lose');
        sfx('lose');
      }
    }
    if (phase === 'play' || phase === 'lose' || phase === 'walk') renderHUD();
    if (phase === 'walk' && phaseT > 0.5 + V.walkTime(s.hero, s.exit) + 0.6) {
      finish();
    } else if (phase === 'lose' && phaseT > 1.3) {
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

  // ───────────── Levels and results ─────────────
  function loadLevel(i) {
    level = clamp(i, 0, LEVELS.length - 1);
    s = C.buildLevel(LEVELS[level]);
    acc = 0;
    drag = null;
    pulled = [];
    burning = [];
    particles = [];
    prevGrid = null;
    deadSeen = s.enemies.map((e) => e.dead);
    outcome = null;
    anyPull = false;
    hint = null;
    if (level === 0) {
      const sol = C.solve(LEVELS[0]);
      if (sol.wins.length) hint = sol.wins[0][0];
    }
  }

  function startLevel(i) {
    Sound.unlock();
    loadLevel(i);
    setPhase('play');
    show(null);
    $('hud').hidden = false;
    const tip = TIPS[level];
    $('tip').textContent = tip ? t(tip) : '';
    $('tip').hidden = !tip;
    renderHUD();
  }

  function doPull(id) {
    if (phase !== 'play' || !s) return false;
    const pin = s.pins.find((p) => p.id === id);
    if (!C.pull(s, id)) return false;
    pulled.push({ pin: { ...pin }, t: 0 });
    anyPull = true;
    $('tip').hidden = true;
    sfx('pin');
    return true;
  }

  function finish() {
    if (!outcome.won) outcome.gold = C.goldInRoom(s);
    setPhase('end');
    showResult();
  }

  const REASONS = {
    burnt: 'Лава добралась до героя',
    lava: 'Лава преградила путь к выходу',
    enemy: 'Враг добрался до героя',
    nogold: 'Золота не хватило',
  };

  function starsHTML(n) {
    let h = '';
    for (let i = 0; i < 3; i++) h += `<span class="${i < n ? 'on' : 'off'}">★</span>`;
    return h;
  }

  function showResult() {
    const o = outcome;
    $('res-title').textContent = o.won ? t('Уровень пройден!') : t('Неудача');
    $('res-reason').textContent = o.won ? '' : t(REASONS[o.burnt ? 'burnt' : o.reason] || REASONS.nogold);
    $('res-reason').hidden = o.won;
    $('res-stars').innerHTML = starsHTML(o.stars);
    $('res-stars').setAttribute('aria-label', t('Звёзды: {n} из 3', { n: o.stars }));
    $('res-gold').textContent = t('Золото: {n} из {target}', { n: o.gold, target: s.goldTarget });
    const goals = $('res-goals');
    goals.innerHTML = '';
    const rich = o.gold * 2 >= s.goldTarget * 3;
    for (const [ok, text] of [[o.won, 'Герой дошёл до выхода'], [o.won && o.allDead, s.enemies.length ? 'Все враги повержены' : 'Врагов нет'],
      [o.won && rich, 'Золота в полтора раза больше нужного']]) {
      const li = document.createElement('li');
      li.className = ok ? 'ok' : 'no';
      li.textContent = t(text);
      goals.append(li);
    }
    const hasNext = level + 1 < LEVELS.length;
    $('btn-next').hidden = !(o.won && hasNext);
    $('res-final').hidden = !(o.won && !hasNext);
    show('result');
    (o.won && hasNext ? $('btn-next') : $('btn-again')).focus({ preventScroll: true });
  }

  // ───────────── Screens ─────────────
  const SCREENS = ['menu', 'levels', 'result'];
  function show(name) {
    for (const id of SCREENS) $(id).hidden = id !== name;
    stage.classList.toggle('dim', !!name);
  }

  function showMenu() {
    const next = Math.min(C.firstUnfinished(progress, LEVELS.length), LEVELS.length - 1);
    loadLevel(next);
    setPhase('menu');
    $('hud').hidden = true;
    $('tip').hidden = true;
    $('btn-play').textContent = t('Играть: уровень {n}', { n: next + 1 });
    renderSound();
    show('menu');
    $('btn-play').focus({ preventScroll: true });
  }

  function showLevels() {
    setPhase('menu'); // the level behind the screen stands still
    const grid = $('level-grid');
    grid.innerHTML = '';
    let total = 0;
    LEVELS.forEach((_, i) => {
      const n = C.starsOf(progress, i);
      total += n;
      const open = C.unlocked(progress, i, LEVELS.length);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lvl-btn' + (open ? '' : ' locked') + (n ? ' done' : '');
      b.disabled = !open;
      b.innerHTML = `<b>${i + 1}</b>` + (open ? `<span class="mini-stars">${starsHTML(n)}</span>` : '<i class="lock" aria-hidden="true"></i>');
      b.setAttribute('aria-label', open ? t('Уровень {n}, звёзды: {s} из 3', { n: i + 1, s: n }) : t('Уровень {n} закрыт', { n: i + 1 }));
      b.addEventListener('click', () => startLevel(i));
      grid.append(b);
    });
    $('levels-total').textContent = t('Звёзд: {n} из {total}', { n: total, total: LEVELS.length * 3 });
    $('hud').hidden = true;
    $('tip').hidden = true;
    show('levels');
    const cur = grid.children[Math.min(C.firstUnfinished(progress, LEVELS.length), LEVELS.length - 1)];
    if (cur) cur.focus({ preventScroll: true });
  }

  let hudKey = '';
  function renderHUD() {
    if (!s) return;
    const gold = C.goldInRoom(s);
    const key = `${level}:${gold}/${s.goldTarget}`;
    if (key === hudKey) return;
    hudKey = key;
    $('hud-level').textContent = t('Уровень {n}', { n: level + 1 });
    $('hud-gold').textContent = `${gold}/${s.goldTarget}`;
    $('hud-gold-wrap').classList.toggle('full', gold >= s.goldTarget);
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
    return V.screenToCell(e.clientX - r.left, e.clientY - r.top, fit);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (phase !== 'play' || drag) return;
    Sound.unlock();
    const c = pointerCell(e);
    drag = V.dragStart(s, c.fx, c.fy);
    if (!drag) return;
    drag.pointer = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (phase !== 'play') { canvas.style.cursor = ''; return; }
    const c = pointerCell(e);
    if (drag && e.pointerId === drag.pointer) {
      V.dragMove(drag, c.fx, c.fy);
      if (drag.along >= V.PULL_DRAG) { // pulled far enough: no need to wait for the release
        const id = drag.id;
        drag = null;
        canvas.style.cursor = '';
        doPull(id);
      }
      return;
    }
    if (!drag) canvas.style.cursor = V.pinAt(s, c.x, c.y) ? 'grab' : '';
  });
  const release = (e, cancel) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const c = pointerCell(e);
    const d = drag;
    drag = null;
    canvas.style.cursor = '';
    if (!cancel && V.dragEnd(d, c.fx, c.fy)) doPull(d.id);
  };
  canvas.addEventListener('pointerup', (e) => release(e, false));
  canvas.addEventListener('pointercancel', (e) => release(e, true));

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (phase === 'play' && /^Digit[1-5]$/.test(e.code)) {
      doPull(Number(e.code.slice(5)));
      e.preventDefault();
    } else if (e.code === 'KeyR' && s && phase !== 'menu') {
      startLevel(level);
      e.preventDefault();
    } else if (e.code === 'Escape' && !$('levels').hidden) {
      showMenu();
    }
  });

  $('btn-play').addEventListener('click', () => startLevel(Math.min(C.firstUnfinished(progress, LEVELS.length), LEVELS.length - 1)));
  $('btn-levels-menu').addEventListener('click', showLevels);
  $('btn-sound-menu').addEventListener('click', toggleSound);
  $('btn-levels-back').addEventListener('click', showMenu);
  $('btn-restart').addEventListener('click', () => startLevel(level));
  $('btn-levels').addEventListener('click', showLevels);
  $('btn-sound').addEventListener('click', toggleSound);
  $('btn-next').addEventListener('click', () => startLevel(level + 1));
  $('btn-again').addEventListener('click', () => startLevel(level));
  $('btn-res-levels').addEventListener('click', showLevels);
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);

  // ───────────── Boot ─────────────
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = t(meta.content);
  const actions = $('top-actions');
  actions.append(window.I18n.toggle('chip'));
  if (window.GameNav) actions.append(window.GameNav.home('chip'));
  resize();
  showMenu();
  requestAnimationFrame(frame);
})();
