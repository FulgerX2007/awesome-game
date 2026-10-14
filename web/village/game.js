'use strict';
// Родник — client: drawing, the game loop and the HUD. Rules live in core.js (window.Village),
// pure camera/picking helpers in view.js (window.VillageView). Everything on the canvas is drawn with code.
(() => {
  const V = window.Village;
  const VV = window.VillageView;
  const { TILE: T, STEP, hash2, lerp, clamp } = VV;
  const { t } = window.I18n;
  const SAVE_KEY = 'village.save';
  const CLOUD_KEY = 'village.cloud';
  const A = window.VillageAudio;
  const TAU = Math.PI * 2;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };
  const ease = (x) => 1 - (1 - x) * (1 - x);
  const easeBack = (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;

  let S = null;
  const canvas = $('scene');
  const ctx = canvas.getContext('2d');
  let cw = 0, ch = 0, dpr = 1;
  let cam = { x: 0, y: 0 };
  let time = 0;               // animation clock, seconds (runs even when the world is idle)
  let vignette = null;

  // ───────────── Palette ─────────────
  const GRASS = { base: '#82ad55', dark: '#6f9c47', light: '#9cc46b', tuft: '#5c8a3b', tuftLight: '#a9cf73' };
  const FLOWERS = ['#fff6e0', '#f4d35e', '#f2a7c3', '#b9d4f2', '#f6b26b'];
  const SAND = { edge: '#cdb27c', main: '#e3cd98', pebble: '#bba373' };
  const WATER = { shallow: '#72c0cc', deep: '#4d9bb8', deeper: '#4189ab' };
  const PATH = { edge: '#a78457', main: '#c9a670', speck: '#b39060' };
  const SQUARE = { edge: '#8c7a5d', gap: '#a39276', stones: ['#cdbd9b', '#d8c9a8', '#c2b18e', '#d2c4a0'] };
  const WOOD = { dark: '#6e4a2b', mid: '#8b5e36', light: '#b3834f', pale: '#d2a86c' };
  const STONE = { dark: '#7d786d', mid: '#9d978a', light: '#bdb7a8' };
  const WINDOW = '#ffd98a';

  // ───────────── Geometry of the map objects ─────────────
  // Footprint boxes of the ruins/buildings in tiles and pixels; `base` is the bottom edge used for depth sorting.
  const BOX = {};
  for (const id of Object.keys(V.BUILDINGS)) {
    const fp = V.FOOTPRINTS[id];
    const x0 = Math.min(...fp.map((p) => p.x)), x1 = Math.max(...fp.map((p) => p.x));
    const y0 = Math.min(...fp.map((p) => p.y)), y1 = Math.max(...fp.map((p) => p.y));
    BOX[id] = { id, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1, X: x0 * T, Y: y0 * T, Wp: (x1 - x0 + 1) * T, Hp: (y1 - y0 + 1) * T, cx: (x0 + x1 + 1) / 2 * T, base: (y1 + 1) * T };
  }
  // The square: festival poles stand in its corners.
  const SQ = { x0: 12, y0: 20, x1: 19, y1: 25 };

  function share(id) {
    const b = V.BUILDINGS[id], own = S.built[id];
    let paid = 0, total = 0;
    for (const [r, n] of Object.entries(b.cost)) { paid += own.paid[r] || 0; total += n; }
    return total ? paid / total : 1;
  }

  // ───────────── Canvas ─────────────
  function resize() {
    const r = canvas.getBoundingClientRect();
    cw = Math.max(1, Math.round(r.width));
    ch = Math.max(1, Math.round(r.height));
    const fit = VV.fitCanvas(cw, ch, window.devicePixelRatio || 1);
    dpr = fit.ratio;
    canvas.width = fit.w;
    canvas.height = fit.h;
    vignette = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.hypot(cw, ch) * 0.62);
    vignette.addColorStop(0, 'rgba(60, 35, 10, 0)');
    vignette.addColorStop(1, 'rgba(60, 35, 10, 0.32)');
  }

  // ───────────── Drawing primitives ─────────────
  function circle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  function ellipse(x, y, rx, ry, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    ctx.fill();
  }
  function rect(x, y, w, h, color, r = 0) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }
  function poly(points, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.closePath();
    ctx.fill();
  }
  function line(x0, y0, x1, y1, color, w = 1) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  // A soft irregular blob (rocks, clay): n points around an ellipse with seeded radii, smoothed by quadratic curves.
  function blob(x, y, rx, ry, seed, color, n = 7, jag = 0.18) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, k = 1 - jag + hash2(seed, i, 41) * jag * 2;
      pts.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k]);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let m = mid(pts[n - 1], pts[0]);
    ctx.moveTo(m[0], m[1]);
    for (let i = 0; i < n; i++) {
      m = mid(pts[i], pts[(i + 1) % n]);
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    ctx.fill();
  }
  const shadow = (x, y, rx, ry) => ellipse(x, y, rx, ry, 'rgba(38, 48, 20, 0.26)');

  // ───────────── Ground (cached in chunks) ─────────────
  // Terrain classes: g grass (ruin footprints too), s sand, w water (bridge site too), p path, q square.
  const CLASS = { '.': 'g', ':': 's', '~': 'w', b: 'w', '=': 'p', '#': 'q' };
  const inSquare = (x, y) => x >= SQ.x0 && x <= SQ.x1 && y >= SQ.y0 && y <= SQ.y1;
  // Ruin footprints sit on grass, except the well, which stands in the middle of the cobbled square.
  const terr = (x, y) => {
    x = clamp(x, 0, V.W - 1); y = clamp(y, 0, V.H - 1);
    return CLASS[V.MAP[y][x]] || (inSquare(x, y) ? 'q' : 'g');
  };
  const CHUNK = 16;
  const chunks = new Map();
  let chunkRatio = 0;

  function chunk(cx, cy) {
    if (chunkRatio !== dpr) { chunks.clear(); chunkRatio = dpr; }
    const key = cx + ',' + cy;
    let c = chunks.get(key);
    if (c) return c;
    const size = CHUNK * T;
    c = document.createElement('canvas');
    c.width = c.height = Math.round(size * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(-cx * size, -cy * size);
    // One tile of overlap on every side, so blobs and rounded edges match across chunk borders.
    paintGround(g, cx * CHUNK - 1, cy * CHUNK - 1, cx * CHUNK + CHUNK, cy * CHUNK + CHUNK);
    chunks.set(key, c);
    return c;
  }

  // Fill the tiles of one terrain set as a single shape: sides facing other terrain are inset, outer corners
  // are rounded and inner corners get a fillet, so areas read as soft continuous patches. Each tile is drawn
  // as four quadrants, each shaped by its two side neighbours and the diagonal one.
  const QUADS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const ARC = [0.38, 0.71, 0.92];
  function layer(g, x0, y0, x1, y1, inSet, color, inset, radius) {
    const H = T / 2;
    g.fillStyle = color;
    g.beginPath();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!inSet(x, y)) continue;
      for (const [sx, sy] of QUADS) {
        const ox = (sx < 0 ? x : x + 1) * T, oy = (sy < 0 ? y : y + 1) * T;
        const a = inSet(x + sx, y), b = inSet(x, y + sy);
        const ix = a ? 0 : inset, iy = b ? 0 : inset;
        let pts;
        if (!a && !b) {
          // Convex corner: a quarter circle around (ix + r, iy + r).
          const r = Math.min(radius, H - inset);
          pts = [[ix, H], [ix, iy + r]];
          for (const k of ARC) pts.push([ix + r - r * Math.sqrt(1 - k * k), iy + r - r * k]);
          pts.push([ix + r, iy], [H, iy], [H, H]);
        } else if (a && b && inset && !inSet(x + sx, y + sy)) {
          // Inner corner: the neighbours' insets meet at (inset, inset); a fillet joins them.
          pts = [[0, H], [0, inset]];
          for (const k of ARC) pts.push([inset * k, inset * Math.sqrt(1 - k * k)]);
          pts.push([inset, 0], [H, 0], [H, H]);
        } else pts = [[ix, iy], [H, iy], [H, H], [ix, H]];
        // Mirrored quadrants flip the winding; keep every subpath the same way round for the nonzero fill.
        if (sx * sy < 0) pts.reverse();
        g.moveTo(ox - sx * pts[0][0], oy - sy * pts[0][1]);
        for (let i = 1; i < pts.length; i++) g.lineTo(ox - sx * pts[i][0], oy - sy * pts[i][1]);
        g.closePath();
      }
    }
    g.fill();
  }

  function paintGround(g, x0, y0, x1, y1) {
    g.fillStyle = GRASS.base;
    g.fillRect(x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T);
    // Soft light and dark patches give the meadow some life.
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      for (let k = 0; k < 3; k++) {
        const h = hash2(x, y, 10 + k);
        g.globalAlpha = 0.22 + hash2(x, y, 20 + k) * 0.25;
        g.fillStyle = h < 0.5 ? GRASS.dark : GRASS.light;
        g.beginPath();
        g.arc(x * T + hash2(x, y, 30 + k) * T, y * T + hash2(x, y, 40 + k) * T, 8 + h * 14, 0, TAU);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    const is = (c) => (x, y) => terr(x, y) === c;
    const sandy = (x, y) => terr(x, y) === 's' || terr(x, y) === 'w';
    const water = is('w');
    const deep = (x, y) => water(x, y) && water(x - 1, y) && water(x + 1, y) && water(x, y - 1) && water(x, y + 1);
    layer(g, x0, y0, x1, y1, sandy, SAND.edge, 0, 10);
    layer(g, x0, y0, x1, y1, sandy, SAND.main, 2, 9);
    layer(g, x0, y0, x1, y1, water, WATER.shallow, 5, 12);
    layer(g, x0, y0, x1, y1, deep, WATER.deep, 4, 12);
    layer(g, x0, y0, x1, y1, is('p'), PATH.edge, 0, 8);
    layer(g, x0, y0, x1, y1, is('p'), PATH.main, 2.5, 7);
    layer(g, x0, y0, x1, y1, is('q'), SQUARE.edge, 0, 6);
    layer(g, x0, y0, x1, y1, is('q'), SQUARE.gap, 2, 5);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = terr(x, y), px = x * T, py = y * T;
      if (c === 'g') grassDetail(g, x, y, px, py);
      else if (c === 'p') {
        for (let k = 0; k < 4; k++) {
          g.fillStyle = k % 2 ? PATH.speck : 'rgba(255, 240, 210, 0.35)';
          g.beginPath();
          g.arc(px + 4 + hash2(x, y, 50 + k) * (T - 8), py + 4 + hash2(x, y, 60 + k) * (T - 8), 1 + hash2(x, y, 70 + k) * 1.4, 0, TAU);
          g.fill();
        }
      } else if (c === 'q') cobbles(g, x, y, px, py);
      else if (c === 's') sandDetail(g, x, y, px, py, water);
      else if (c === 'w' && deep(x, y) && hash2(x, y, 90) < 0.07) lilyPad(g, x, y, px, py);
    }
  }

  function grassDetail(g, x, y, px, py) {
    const tufts = Math.floor(hash2(x, y, 1) * 3);
    g.lineWidth = 1.3;
    g.lineCap = 'round';
    for (let k = 0; k < tufts; k++) {
      const tx = px + 5 + hash2(x, y, 2 + k) * (T - 10), ty = py + 8 + hash2(x, y, 5 + k) * (T - 10);
      g.strokeStyle = hash2(x, y, 8 + k) < 0.7 ? GRASS.tuft : GRASS.tuftLight;
      g.beginPath();
      g.moveTo(tx - 3, ty - 4); g.lineTo(tx - 1, ty);
      g.moveTo(tx, ty - 6); g.lineTo(tx, ty);
      g.moveTo(tx + 3, ty - 4); g.lineTo(tx + 1, ty);
      g.stroke();
    }
    if (hash2(x, y, 3) < 0.16) {
      const col = FLOWERS[Math.floor(hash2(x, y, 4) * FLOWERS.length)];
      const n = 3 + Math.floor(hash2(x, y, 6) * 3);
      const fx = px + 6 + hash2(x, y, 7) * (T - 12), fy = py + 6 + hash2(x, y, 9) * (T - 12);
      for (let k = 0; k < n; k++) {
        const ax = fx + (hash2(x, y, 11 + k) - 0.5) * 12, ay = fy + (hash2(x, y, 15 + k) - 0.5) * 10;
        g.fillStyle = col;
        for (let p = 0; p < 5; p++) {
          g.beginPath();
          g.arc(ax + Math.cos(p * 1.256) * 1.6, ay + Math.sin(p * 1.256) * 1.6, 1.3, 0, TAU);
          g.fill();
        }
        g.fillStyle = '#f0b43c';
        g.beginPath();
        g.arc(ax, ay, 0.9, 0, TAU);
        g.fill();
      }
    }
  }

  function cobbles(g, x, y, px, py) {
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const k = j * 2 + i;
      const sx = px + i * 16 + 1.5 + (hash2(x, y, 100 + k) - 0.5) * 1.5, sy = py + j * 16 + 1.5 + (hash2(x, y, 110 + k) - 0.5) * 1.5;
      g.fillStyle = SQUARE.stones[Math.floor(hash2(x, y, 120 + k) * SQUARE.stones.length)];
      g.beginPath();
      g.roundRect(sx, sy, 13, 13, 4);
      g.fill();
      g.fillStyle = 'rgba(255, 250, 235, 0.35)';
      g.beginPath();
      g.roundRect(sx + 2, sy + 1.5, 7, 3, 1.5);
      g.fill();
    }
  }

  function sandDetail(g, x, y, px, py, water) {
    for (let k = 0; k < 3; k++) {
      g.fillStyle = SAND.pebble;
      g.beginPath();
      g.ellipse(px + 4 + hash2(x, y, 130 + k) * (T - 8), py + 4 + hash2(x, y, 135 + k) * (T - 8), 1.6, 1.1, 0, 0, TAU);
      g.fill();
    }
    // Reeds and cattails along the water.
    const near = water(x - 1, y) || water(x + 1, y) || water(x, y - 1) || water(x, y + 1);
    if (near && hash2(x, y, 140) < 0.3) {
      const rx = px + 6 + hash2(x, y, 141) * (T - 12), ry = py + T - 6;
      g.lineCap = 'round';
      for (let k = 0; k < 4; k++) {
        const dx = (k - 1.5) * 2.4, hgt = 11 + hash2(x, y, 142 + k) * 8;
        g.strokeStyle = k % 2 ? '#4f7a33' : '#6b9440';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(rx + dx, ry);
        g.quadraticCurveTo(rx + dx * 1.5, ry - hgt / 2, rx + dx * 2, ry - hgt);
        g.stroke();
        if (k % 2 === 0) {
          g.fillStyle = '#7a4b2a';
          g.beginPath();
          g.roundRect(rx + dx * 2 - 1.6, ry - hgt - 1, 3.2, 6, 1.6);
          g.fill();
        }
      }
    }
  }

  function lilyPad(g, x, y, px, py) {
    const lx = px + 8 + hash2(x, y, 91) * 16, ly = py + 8 + hash2(x, y, 92) * 16, a = hash2(x, y, 93) * TAU;
    g.fillStyle = '#5d9a4a';
    g.beginPath();
    g.moveTo(lx, ly);
    g.arc(lx, ly, 6, a + 0.4, a + TAU - 0.1);
    g.closePath();
    g.fill();
    if (hash2(x, y, 94) < 0.5) {
      g.fillStyle = '#f7c6d6';
      g.beginPath();
      g.arc(lx + 1, ly - 1, 2.2, 0, TAU);
      g.fill();
    }
  }

  // Gentle ripples and glints on the visible water, drifting with the current.
  function drawWater(r) {
    ctx.lineCap = 'round';
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      if (terr(x, y) !== 'w') continue;
      const vertical = terr(x, y - 1) === 'w' && terr(x, y + 1) === 'w' && !(terr(x - 1, y) === 'w' && terr(x + 1, y) === 'w');
      for (let k = 0; k < 2; k++) {
        const h = hash2(x, y, 200 + k);
        const p = (h * T + time * (5 + h * 5)) % T;
        const across = 7 + hash2(x, y, 210 + k) * (T - 14);
        ctx.strokeStyle = `rgba(235, 250, 255, ${(Math.sin((p / T) * Math.PI) * 0.4).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        if (vertical) {
          ctx.moveTo(x * T + across, y * T + p - 3);
          ctx.quadraticCurveTo(x * T + across + 2, y * T + p, x * T + across, y * T + p + 3);
        } else {
          const px = x * T + T - p;
          ctx.moveTo(px - 4, y * T + across);
          ctx.quadraticCurveTo(px, y * T + across - 2, px + 4, y * T + across);
        }
        ctx.stroke();
      }
      const tw = Math.sin(time * 1.7 + hash2(x, y, 220) * 40);
      if (tw > 0.93) circle(x * T + hash2(x, y, 221) * T, y * T + hash2(x, y, 222) * T, (tw - 0.93) * 25, 'rgba(255, 255, 255, 0.7)');
    }
  }

  // ───────────── Nodes ─────────────
  const fx = { shake: new Map(), pop: new Map(), falls: [], parts: [], smoke: [], rockets: [], sparks: [] };

  function treeLook(n) {
    const h = hash2(n.x, n.y, 300);
    const pine = V.zoneAt(n.x, n.y) === 'north' ? h < 0.6 : h < 0.18;
    const autumn = !pine && hash2(n.x, n.y, 301) < 0.13;
    const greens = [['#3f6e33', '#548a3f', '#78ad55'], ['#466f2e', '#5e8f3a', '#86b356'], ['#3a6a3f', '#4f8650', '#72a868']];
    const pal = autumn ? ['#b8662e', '#d88a3a', '#efb75a'] : pine ? ['#2f5a37', '#3d7044', '#5a8f58'] : greens[Math.floor(hash2(n.x, n.y, 302) * 3)];
    return { pine, pal, apples: !pine && !autumn && hash2(n.x, n.y, 303) < 0.15 };
  }

  function drawTree(n, cx, by, sway) {
    const L = treeLook(n);
    shadow(cx + 3, by, 13, 4.5);
    if (L.pine) {
      rect(cx - 2.5, by - 9, 5, 9, WOOD.mid, 1.5);
      const tiers = [[13, -6, -22], [11, -16, -32], [8, -26, -42]];
      tiers.forEach(([w, b, top], i) => {
        const s = sway * (i + 1) * 0.5;
        poly([cx - w, by + b, cx + w, by + b, cx + s, by + top], L.pal[i === 0 ? 0 : 1]);
        poly([cx - w + 2, by + b - 1, cx + s * 0.8 - 1, by + top + 3, cx - 2 + s * 0.5, by + b - 1], L.pal[2]);
      });
      return;
    }
    rect(cx - 3, by - 17, 6, 17, WOOD.mid, 2);
    rect(cx - 3, by - 17, 2.2, 17, WOOD.light, 1);
    const s = sway;
    circle(cx + s * 0.5, by - 22, 14, L.pal[0]);
    circle(cx - 7 + s, by - 26, 10, L.pal[1]);
    circle(cx + 7 + s, by - 25, 10, L.pal[1]);
    circle(cx + s, by - 33, 11, L.pal[1]);
    circle(cx - 4 + s, by - 33, 6.5, L.pal[2]);
    circle(cx - 9 + s, by - 27, 4, L.pal[2]);
    if (L.apples) for (let k = 0; k < 4; k++) circle(cx - 8 + hash2(n.x, n.y, 310 + k) * 16 + s, by - 34 + hash2(n.x, n.y, 320 + k) * 16, 1.8, '#d2453a');
  }

  function drawStump(n, cx, by) {
    shadow(cx + 2, by, 9, 3.5);
    rect(cx - 6, by - 7, 12, 7, WOOD.mid, 2);
    ellipse(cx, by - 7, 6, 3, WOOD.pale);
    ctx.strokeStyle = 'rgba(110, 74, 43, 0.6)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(cx, by - 7, 3, 1.5, 0, 0, TAU);
    ctx.stroke();
    sprout(n, cx + 7, by - 1);
  }

  // A small sprout shows up during the last minute before a node comes back.
  function sprout(n, x, y) {
    if (n.regrowAt === null) return;
    const k = clamp(1 - (n.regrowAt - S.t) / 60, 0, 1);
    if (k <= 0) return;
    line(x, y, x, y - 6 * k, '#4f7a33', 1.2);
    ellipse(x - 2 * k, y - 6 * k, 2.4 * k, 1.3 * k, '#7fae55');
    ellipse(x + 2 * k, y - 5 * k, 2.4 * k, 1.3 * k, '#7fae55');
  }

  function drawRock(n, cx, by) {
    const k = 0.62 + 0.38 * (n.hp / V.NODE_KINDS.rock.hp);
    const seed = n.id * 7 + 1;
    shadow(cx + 3, by - 1, 14 * k, 5 * k);
    blob(cx, by - 8 * k, 13 * k, 10 * k, seed, STONE.dark);
    blob(cx - 1, by - 10 * k, 11 * k, 8 * k, seed + 1, STONE.mid);
    blob(cx - 3 * k, by - 13 * k, 6 * k, 4 * k, seed + 2, STONE.light);
    line(cx + 2 * k, by - 12 * k, cx + 5 * k, by - 6 * k, 'rgba(70, 66, 58, 0.55)', 1);
    if (hash2(n.x, n.y, 330) < 0.4) ellipse(cx + 3 * k, by - 15 * k, 4 * k, 2 * k, 'rgba(110, 150, 70, 0.8)');
  }

  function drawPebbles(n, cx, by) {
    for (let k = 0; k < 4; k++) {
      const px = cx - 8 + hash2(n.x, n.y, 340 + k) * 16, py = by - 3 - hash2(n.x, n.y, 345 + k) * 8;
      ellipse(px + 1, py + 1, 2.8, 1.6, 'rgba(38, 48, 20, 0.2)');
      ellipse(px, py, 2.6, 1.8, k % 2 ? STONE.mid : STONE.light);
    }
    sprout(n, cx + 6, by - 2);
  }

  function drawClay(n, cx, by) {
    const k = 0.6 + 0.4 * (n.hp / V.NODE_KINDS.clay.hp);
    ellipse(cx, by - 5, 15, 8, '#7a5a3a');
    blob(cx, by - 7 * k, 12 * k, 7 * k, n.id * 5 + 3, '#b3643a', 8, 0.12);
    blob(cx - 1, by - 9 * k, 9 * k, 5 * k, n.id * 5 + 4, '#cf8452', 8, 0.12);
    ellipse(cx - 4 * k, by - 10 * k, 3 * k, 1.3 * k, 'rgba(255, 235, 210, 0.45)');
  }

  function drawPit(n, cx, by) {
    ellipse(cx, by - 5, 13, 7, '#7a5a3a');
    ellipse(cx, by - 5, 10, 5, '#56402b');
    ellipse(cx + 1, by - 4, 5, 2.2, 'rgba(110, 170, 190, 0.75)');
    sprout(n, cx + 9, by - 2);
  }

  function drawBush(n, cx, by, sway) {
    const full = n.hp > 0;
    shadow(cx + 2, by - 1, 13, 4);
    const leaves = full ? ['#4b7c38', '#5f9446', '#7aae58'] : ['#5f8f45', '#77a456', '#93bf6c'];
    const spots = [[-7, -7, 7], [7, -7, 7], [0, -12, 8], [-3, -6, 7], [4, -5, 7]];
    spots.forEach(([dx, dy, r], i) => circle(cx + dx + sway * 0.3, by + dy, r, leaves[i < 3 ? 0 : 1]));
    circle(cx - 3 + sway * 0.3, by - 13, 3.5, leaves[2]);
    circle(cx + 5 + sway * 0.3, by - 10, 2.5, leaves[2]);
    if (!full) { sprout(n, cx + 9, by - 1); return; }
    const count = n.hp * 3;
    for (let k = 0; k < count; k++) {
      const bx = cx - 9 + hash2(n.x, n.y, 350 + k) * 18 + sway * 0.3, byy = by - 15 + hash2(n.x, n.y, 370 + k) * 11;
      circle(bx, byy, 2, '#c2335a');
      circle(bx - 0.6, byy - 0.7, 0.7, 'rgba(255, 220, 230, 0.8)');
    }
  }

  function drawNode(n) {
    let cx = (n.x + 0.5) * T;
    const by = (n.y + 1) * T - 5;
    const sh = fx.shake.get(n.id);
    if (sh !== undefined) {
      const a = time - sh;
      if (a > 0.3) fx.shake.delete(n.id);
      else cx += Math.sin(a * 55) * 2.6 * (1 - a / 0.3);
    }
    const sway = Math.sin(time * 1.1 + n.id * 1.7) * 1.2;
    const pop = fx.pop.get(n.id);
    let scale = 1;
    if (pop !== undefined) {
      const a = (time - pop) / 0.6;
      if (a >= 1) fx.pop.delete(n.id);
      else scale = Math.max(0.05, easeBack(clamp(a, 0, 1)));
    }
    if (scale !== 1) {
      ctx.save();
      ctx.translate(cx, by);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -by);
    }
    const up = n.hp > 0;
    if (n.kind === 'tree') (up ? drawTree(n, cx, by, sway) : drawStump(n, cx, by));
    else if (n.kind === 'rock') (up ? drawRock(n, cx, by) : drawPebbles(n, cx, by));
    else if (n.kind === 'clay') (up ? drawClay(n, cx, by) : drawPit(n, cx, by));
    else drawBush(n, cx, by, sway);
    if (scale !== 1) ctx.restore();
  }

  // ───────────── Buildings ─────────────
  function windowBox(x, y, w, h, trim) {
    rect(x - 2.5, y + 1, 2.5, h - 2, trim, 1);
    rect(x + w, y + 1, 2.5, h - 2, trim, 1);
    rect(x - 1, y - 1, w + 2, h + 2, '#f6efe0', 2);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#fff1c4');
    g.addColorStop(1, WINDOW);
    rect(x, y, w, h, g, 1.5);
    line(x + w / 2, y, x + w / 2, y + h, trim, 1.2);
    line(x, y + h / 2, x + w, y + h / 2, trim, 1.2);
    // Flower box under the window.
    rect(x - 1.5, y + h + 1, w + 3, 3, WOOD.mid, 1);
    for (let k = 0; k < 3; k++) circle(x + 1 + k * (w - 2) / 2, y + h, 1.6, k % 2 ? '#f4d35e' : '#e0607e');
  }

  function door(x, y, w, h, color = '#7b4f2e') {
    rect(x, y, w, h, color, [w / 2, w / 2, 0, 0]);
    for (let k = 1; k < 3; k++) line(x + (k * w) / 3, y + 3, x + (k * w) / 3, y + h, 'rgba(40, 24, 10, 0.35)', 0.8);
    circle(x + w - 2.5, y + h * 0.6, 0.9, '#e9b44c');
    rect(x - 1, y + h - 1, w + 2, 2, STONE.mid, 1);
  }

  // Roof seen from above at a tilt: a trapezoid from the ridge (top) to the eave over the front wall.
  function roof(left, right, top, eave, col, dark, style = 'tile') {
    poly([left, eave, right, eave, right - 4, top, left + 4, top], col);
    const g = ctx.createLinearGradient(0, top, 0, eave);
    g.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
    g.addColorStop(0.35, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, 'rgba(255, 240, 210, 0.12)');
    poly([left, eave, right, eave, right - 4, top, left + 4, top], g);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left, eave); ctx.lineTo(right, eave); ctx.lineTo(right - 4, top); ctx.lineTo(left + 4, top);
    ctx.closePath();
    ctx.clip();
    if (style === 'thatch') {
      ctx.lineWidth = 1;
      for (let yy = top + 3, row = 0; yy < eave; yy += 4, row++) {
        for (let xx = left + (row % 2) * 2; xx < right; xx += 4) line(xx, yy - 3, xx + 0.6, yy + 1, row % 3 ? dark : 'rgba(255, 236, 170, 0.5)', 1);
      }
    } else if (style === 'metal') {
      for (let xx = left + 4; xx < right; xx += 6) line(xx, top, xx, eave, dark, 1);
    } else {
      for (let yy = top + 5, row = 0; yy < eave; yy += 5, row++) {
        line(left, yy, right, yy, dark, 1);
        for (let xx = left + (row % 2) * 4; xx < right; xx += 8) line(xx, yy - 5, xx, yy, dark, 0.7);
      }
    }
    ctx.restore();
    rect(left + 4, top - 1, right - left - 8, 3, dark, 1.5);
    rect(left - 1, eave - 2, right - left + 2, 3, dark, 1.5);
  }

  // A cottage: white-washed walls with blue trim (as in the Moldovan villages), a roof and a chimney.
  function house(b, o) {
    const left = b.X + 5, right = b.X + b.Wp - 5, base = b.Y + b.Hp - 4;
    const wallH = o.wallH || 24, wallTop = base - wallH, top = b.Y - (o.roofUp || 10);
    rect(left + 4, base - 4, right - left, 9, 'rgba(38, 48, 20, 0.22)', 4);
    rect(left, wallTop, right - left, wallH, o.wall);
    if (o.planks) for (let xx = left + 4; xx < right; xx += 5) line(xx, wallTop, xx, base, 'rgba(60, 25, 15, 0.25)', 1);
    rect(left, base - 4, right - left, 4, o.plinth || STONE.mid);
    line(left, wallTop + 3, right, wallTop + 3, 'rgba(0, 0, 0, 0.18)', 3);
    const mid = (left + right) / 2;
    const dx = o.doorAt !== undefined ? o.doorAt : mid - 5;
    if (o.door !== false) door(dx, base - 17, 10, 16, o.doorColor);
    const wy = wallTop + 7;
    for (const wx of o.windows || [left + 7, right - 17]) windowBox(wx, wy, 10, 9, o.trim);
    roof(left - 5, right + 5, top, wallTop + 3, o.roof, o.roofDark, o.roofStyle);
    if (o.chimney) {
      const cxp = o.chimney === 'left' ? left + 8 : right - 15;
      rect(cxp, top - 8, 8, 14, o.chimneyColor || '#9c4a35', 1);
      rect(cxp - 1, top - 9, 10, 3, '#5b3324', 1);
      emit(cxp + 4, top - 10, o.smoke || 1);
    }
    return { left, right, base, wallTop, top };
  }

  const ART = {
    well(b) {
      const cx = b.cx, cy = b.base - 22;
      shadow(cx + 3, cy + 10, 22, 8);
      ellipse(cx, cy + 3, 20, 13, STONE.dark);
      ellipse(cx, cy, 20, 13, STONE.mid);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * TAU;
        line(cx + Math.cos(a) * 14, cy + Math.sin(a) * 9, cx + Math.cos(a) * 20, cy + Math.sin(a) * 13, STONE.dark, 1);
      }
      ellipse(cx, cy - 1, 13, 8, '#2f5f74');
      ellipse(cx - 3, cy - 3, 4, 1.5, 'rgba(255, 255, 255, 0.4)');
      rect(cx - 19, cy - 32, 4, 34, WOOD.mid, 1);
      rect(cx + 15, cy - 32, 4, 34, WOOD.mid, 1);
      line(cx - 15, cy - 24, cx + 15, cy - 24, WOOD.dark, 2.5);
      line(cx + 2, cy - 24, cx + 2, cy - 12 + Math.sin(time * 1.4) * 1.5, '#d8c79a', 1);
      rect(cx - 2, cy - 12 + Math.sin(time * 1.4) * 1.5, 8, 7, WOOD.light, 2);
      poly([cx - 26, cy - 26, cx, cy - 44, cx + 26, cy - 26, cx + 22, cy - 22, cx, cy - 39, cx - 22, cy - 22], '#a8503a');
      line(cx - 24, cy - 25, cx, cy - 42, '#c86a4c', 1.5);
      // Pots of flowers around the well bring the square back to life.
      for (const [dx, dy, c] of [[-24, 8, '#e0607e'], [24, 6, '#f4d35e']]) {
        rect(cx + dx - 4, cy + dy - 4, 8, 7, '#b4643c', 2);
        circle(cx + dx - 1.5, cy + dy - 5, 2.4, c);
        circle(cx + dx + 1.8, cy + dy - 6, 2.4, c);
        circle(cx + dx, cy + dy - 7.5, 2, '#5f9446');
      }
    },
    home(b) {
      house(b, { wall: '#f5efe2', trim: '#4d7fb6', roof: '#b9583b', roofDark: 'rgba(90, 30, 15, 0.45)', chimney: 'right' });
    },
    house1(b) {
      house(b, { wall: '#f3ecdc', trim: '#3f8a7a', roof: '#cfa65c', roofDark: 'rgba(120, 80, 30, 0.55)', roofStyle: 'thatch', chimney: 'left' });
    },
    house2(b) {
      house(b, { wall: '#efe7d6', trim: '#4d7fb6', roof: '#7a8792', roofDark: 'rgba(40, 45, 55, 0.5)', chimney: 'right', chimneyColor: STONE.mid });
    },
    house3(b) {
      house(b, { wall: '#f6eadb', trim: '#9a5aa8', roof: '#a8563c', roofDark: 'rgba(90, 30, 15, 0.45)', chimney: 'left' });
      // Drying pots by the potter's door.
      for (let k = 0; k < 3; k++) {
        const px = b.X + b.Wp - 2 + k * 5, py = b.base + 1;
        ellipse(px, py, 3, 1.5, 'rgba(38, 48, 20, 0.25)');
        rect(px - 2.5, py - 6, 5, 6, k % 2 ? '#c8794a' : '#b4643c', [1, 1, 2.5, 2.5]);
        rect(px - 1.8, py - 7, 3.6, 1.6, '#d48a58', 0.8);
      }
    },
    barn(b) {
      const r = house(b, {
        wall: '#a9553f', planks: true, trim: '#f2e9d8', roof: '#6e5241', roofDark: 'rgba(30, 18, 10, 0.5)',
        door: false, windows: [b.X + 9, b.X + b.Wp - 19], plinth: STONE.dark,
      });
      const mid = (r.left + r.right) / 2;
      rect(mid - 11, r.base - 20, 22, 20, '#8c4332', 1);
      ctx.strokeStyle = '#f2e9d8';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(mid - 11, r.base - 20, 22, 20);
      line(mid - 11, r.base - 20, mid + 11, r.base, '#f2e9d8', 1.6);
      line(mid + 11, r.base - 20, mid - 11, r.base, '#f2e9d8', 1.6);
      line(mid, r.base - 20, mid, r.base, '#f2e9d8', 1.2);
      // A hay bale and a barrel by the wall; the upgraded barn gets a lean-to with sacks.
      ellipse(r.right + 5, r.base - 1, 6, 3, 'rgba(38, 48, 20, 0.25)');
      rect(r.right - 1, r.base - 10, 12, 10, '#e2c071', 3);
      line(r.right - 1, r.base - 5, r.right + 11, r.base - 5, '#c9a25a', 1);
      if (S.barnLevel >= 2) {
        rect(r.left - 14, r.base - 16, 14, 16, WOOD.light, 1);
        poly([r.left - 17, r.base - 14, r.left, r.base - 22, r.left, r.base - 14], '#6e5241');
        rect(r.left - 12, r.base - 8, 5, 7, '#e8d7b5', 2);
        rect(r.left - 7, r.base - 9, 5, 8, '#dccaa4', 2);
      }
    },
    sawmill(b) {
      const left = b.X + 4, right = b.X + b.Wp - 4, base = b.base - 4, top = b.Y - 4, eave = base - 26;
      rect(left + 4, base - 3, right - left, 8, 'rgba(38, 48, 20, 0.22)', 4);
      rect(left + 2, eave, right - left - 4, base - eave, '#4a3524');
      // Saw bench with a log inside the shed.
      rect(left + 20, base - 12, 40, 4, WOOD.light, 1);
      ellipse(left + 40, base - 15, 18, 4, WOOD.mid);
      ellipse(left + 58, base - 15, 3, 4, WOOD.pale);
      const a = time * 6;
      ctx.save();
      ctx.translate(left + 34, base - 16);
      ctx.rotate(a);
      circle(0, 0, 7, '#c9ccd1');
      for (let k = 0; k < 8; k++) line(0, 0, Math.cos((k * TAU) / 8) * 7.5, Math.sin((k * TAU) / 8) * 7.5, '#8d9096', 1);
      ctx.restore();
      for (const px of [left + 2, (left + right) / 2 - 2, right - 6]) rect(px, eave - 2, 4, base - eave + 2, WOOD.mid, 1);
      roof(left - 4, right + 4, top, eave + 2, '#9a7046', 'rgba(60, 35, 15, 0.45)', 'metal');
      // Log pile on the left, plank stack on the right.
      for (const [dx, dy] of [[-12, -4], [-4, -4], [-8, -11]]) {
        circle(left + dx, base + dy, 4.5, WOOD.mid);
        circle(left + dx, base + dy, 3.2, WOOD.pale);
        circle(left + dx, base + dy, 1.2, WOOD.light);
      }
      for (let k = 0; k < 4; k++) rect(right - 6 + (k % 2), base - 3 - k * 3, 18, 3, k % 2 ? '#e0b779' : '#d7a560', 1);
    },
    kiln(b) {
      const cx = b.cx, base = b.base - 4;
      shadow(cx + 4, base, 26, 7);
      ctx.fillStyle = '#b5583a';
      ctx.beginPath();
      ctx.ellipse(cx, base, 25, 34, 0, Math.PI, TAU);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.clip();
      for (let yy = base - 4, row = 0; yy > base - 36; yy -= 5, row++) {
        line(cx - 26, yy, cx + 26, yy, 'rgba(90, 30, 15, 0.35)', 0.8);
        for (let xx = cx - 26 + (row % 2) * 5; xx < cx + 26; xx += 10) line(xx, yy, xx, yy - 5, 'rgba(90, 30, 15, 0.3)', 0.8);
      }
      ctx.restore();
      ellipse(cx - 9, base - 22, 7, 9, 'rgba(255, 220, 190, 0.14)');
      rect(cx - 8, base - 17, 16, 17, '#2b1a12', [8, 8, 0, 0]);
      const f = 0.75 + Math.sin(time * 9) * 0.12 + Math.sin(time * 23) * 0.08;
      const g = ctx.createRadialGradient(cx, base - 4, 1, cx, base - 6, 13);
      g.addColorStop(0, `rgba(255, 220, 120, ${f})`);
      g.addColorStop(0.5, `rgba(240, 120, 40, ${f * 0.7})`);
      g.addColorStop(1, 'rgba(200, 60, 20, 0)');
      rect(cx - 8, base - 17, 16, 17, g, [8, 8, 0, 0]);
      rect(cx + 8, base - 40, 8, 12, '#9c4a35', 1);
      rect(cx + 7, base - 41, 10, 3, '#5b3324', 1);
      emit(cx + 12, base - 42, 1.4);
      for (let k = 0; k < 3; k++) {
        const px = b.X + b.Wp + 2 + k * 6, py = base + 2;
        rect(px - 3, py - 8, 6, 8, k === 1 ? '#a8432e' : '#c8794a', [2, 2, 3, 3]);
      }
    },
    forge(b) {
      const r = house(b, {
        wall: '#9a958a', trim: '#5b5b63', roof: '#4d4f58', roofDark: 'rgba(15, 15, 20, 0.5)',
        door: false, windows: [b.X + 10], chimney: 'left', chimneyColor: STONE.dark, smoke: 1.3,
      });
      for (let yy = r.wallTop + 6; yy < r.base - 4; yy += 6) line(r.left, yy, r.right, yy, 'rgba(60, 55, 48, 0.35)', 0.8);
      // Open hearth on the right with a glow, an anvil in front.
      const hx = r.right - 26, hy = r.base - 18;
      rect(hx, hy, 20, 18, '#2a2420', [4, 4, 0, 0]);
      const f = 0.7 + Math.sin(time * 7) * 0.15 + Math.sin(time * 19) * 0.08;
      const g = ctx.createRadialGradient(hx + 10, hy + 14, 1, hx + 10, hy + 12, 14);
      g.addColorStop(0, `rgba(255, 210, 110, ${f})`);
      g.addColorStop(1, 'rgba(230, 90, 30, 0)');
      rect(hx, hy, 20, 18, g, [4, 4, 0, 0]);
      const ax = r.left + 8, ay = r.base + 6;
      shadow(ax + 8, ay + 1, 10, 3);
      rect(ax + 5, ay - 6, 6, 6, '#3d3c40', 1);
      poly([ax, ay - 11, ax + 16, ay - 11, ax + 20, ay - 8, ax + 12, ay - 6, ax + 4, ay - 6], '#55545a');
      line(ax + 1, ay - 10.5, ax + 15, ay - 10.5, '#8d8c92', 1);
      if (Math.random() < 0.05) spark(hx + 10, hy + 8);
    },
    mill(b) {
      const cx = b.cx, base = b.base - 4;
      shadow(cx + 4, base, 20, 6);
      poly([cx - 17, base, cx + 17, base, cx + 12, base - 42, cx - 12, base - 42], '#efe6d2');
      poly([cx + 4, base, cx + 17, base, cx + 12, base - 42, cx + 3, base - 42], 'rgba(150, 120, 80, 0.18)');
      for (let yy = base - 8; yy > base - 40; yy -= 8) line(cx - 16, yy, cx + 16, yy, 'rgba(150, 120, 80, 0.18)', 0.8);
      door(cx - 5, base - 15, 10, 14);
      circle(cx, base - 29, 3.5, '#4d7fb6');
      circle(cx, base - 29, 2.4, WINDOW);
      poly([cx - 15, base - 41, cx + 15, base - 41, cx, base - 60], '#7a5236');
      poly([cx + 2, base - 41, cx + 15, base - 41, cx, base - 60], 'rgba(0, 0, 0, 0.18)');
      const hubY = base - 44, rot = time * 0.9;
      for (let k = 0; k < 4; k++) {
        ctx.save();
        ctx.translate(cx, hubY);
        ctx.rotate(rot + (k * Math.PI) / 2);
        line(0, 0, 0, -36, WOOD.dark, 2);
        rect(1, -36, 9, 28, 'rgba(250, 240, 220, 0.9)', 1);
        ctx.strokeStyle = WOOD.mid;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(1, -36, 9, 28);
        for (let yy = -31; yy < -8; yy += 5) line(1, yy, 10, yy, WOOD.mid, 0.6);
        ctx.restore();
      }
      circle(cx, hubY, 3.5, WOOD.dark);
      // Flour sacks by the door.
      rect(cx + 10, base - 8, 7, 8, '#ece0c4', 3);
      rect(cx + 16, base - 6, 6, 6, '#e2d4b4', 3);
    },
    chapel(b) {
      const left = b.X + 8, right = b.X + b.Wp - 8, base = b.base - 4, wallH = 30, wallTop = base - wallH, top = b.Y - 4;
      const cx = b.cx;
      rect(left + 5, base - 4, right - left, 10, 'rgba(38, 48, 20, 0.22)', 4);
      rect(left, wallTop, right - left, wallH, '#f6f1e6');
      rect(left, base - 5, right - left, 5, STONE.mid);
      for (const wx of [left + 6, right - 14]) {
        rect(wx - 1, wallTop + 7, 10, 16, '#e6dccb', [5, 5, 1, 1]);
        rect(wx, wallTop + 8, 8, 14, '#9ecbe0', [4, 4, 0, 0]);
        rect(wx + 1, wallTop + 9, 3, 6, 'rgba(255, 255, 255, 0.5)', [2, 0, 0, 0]);
      }
      roof(left - 5, right + 5, top, wallTop + 3, '#4f8a7e', 'rgba(20, 50, 45, 0.45)', 'metal');
      // Bell tower over the entrance: belfry, onion dome and a cross.
      const tw = 24, tTop = base - 74;
      rect(cx - tw / 2 + 3, tTop + 6, tw, base - tTop - 6, 'rgba(38, 48, 20, 0.12)');
      rect(cx - tw / 2, tTop, tw, base - tTop, '#fbf6ec');
      rect(cx + tw / 2 - 6, tTop, 6, base - tTop, 'rgba(150, 130, 100, 0.12)');
      door(cx - 6, base - 18, 12, 17, '#8b5a32');
      rect(cx - 7, tTop + 8, 14, 16, '#3d3226', [7, 7, 0, 0]);
      const bellA = S.festival ? Math.sin(time * 3.2) * 0.45 : Math.sin(time * 0.8) * 0.04;
      ctx.save();
      ctx.translate(cx, tTop + 11);
      ctx.rotate(bellA);
      poly([-4, 9, 4, 9, 3, 2, 1.5, 0, -1.5, 0, -3, 2], '#e2b44a');
      circle(0, 9.5, 1.3, '#a8802e');
      ctx.restore();
      rect(cx - tw / 2 - 2, tTop - 2, tw + 4, 4, '#4f8a7e', 1);
      ctx.fillStyle = '#e2b44a';
      ctx.beginPath();
      ctx.moveTo(cx - 10, tTop - 2);
      ctx.bezierCurveTo(cx - 16, tTop - 12, cx - 4, tTop - 18, cx, tTop - 28);
      ctx.bezierCurveTo(cx + 4, tTop - 18, cx + 16, tTop - 12, cx + 10, tTop - 2);
      ctx.closePath();
      ctx.fill();
      ellipse(cx - 4, tTop - 12, 2.5, 5, 'rgba(255, 245, 200, 0.55)');
      line(cx, tTop - 28, cx, tTop - 40, '#d4a63c', 1.8);
      line(cx - 4, tTop - 35, cx + 4, tTop - 35, '#d4a63c', 1.8);
    },
  };

  // Stage 0: tumbled walls, a fallen beam and weeds. Stage 1: walls rising with the paid share, scaffolding.
  function drawRuin(b) {
    const left = b.X + 4, right = b.X + b.Wp - 4, base = b.base - 4;
    rect(left, b.Y + b.Hp * 0.3, right - left, base - b.Y - b.Hp * 0.3, 'rgba(120, 100, 70, 0.45)', 6);
    if (b.id === 'well') {
      const cx = b.cx, cy = b.base - 22;
      ctx.strokeStyle = STONE.mid;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 17, 11, 0, 0.6, 4.4);
      ctx.stroke();
      ellipse(cx, cy - 1, 11, 7, '#3b4a3f');
      for (let k = 0; k < 4; k++) blob(cx + 10 + k * 5, cy + 4 + (k % 2) * 4, 3.5, 2.5, 900 + k, k % 2 ? STONE.light : STONE.mid);
      rect(cx - 21, cy - 14, 4, 14, WOOD.dark, 1);
      return;
    }
    const wallY = b.Y + b.Hp * 0.42;
    for (let x = left, k = 0; x < right - 4; x += 8, k++) {
      const hgt = 3 + hash2(b.x0, k, 400) * 13;
      if (hash2(b.x0, k, 401) < 0.18) continue;
      rect(x, wallY - hgt, 8, hgt + 4, STONE.mid, 1.5);
      rect(x, wallY - hgt, 8, 2.5, STONE.light, 1);
    }
    for (const sx of [left, right - 7]) {
      const hgt = 8 + hash2(b.x0, sx, 402) * 10;
      rect(sx, base - hgt, 7, hgt, STONE.mid, 1.5);
      rect(sx, base - hgt, 7, 2.5, STONE.light, 1);
    }
    ctx.save();
    ctx.translate((left + right) / 2, base - 10);
    ctx.rotate(-0.35 + hash2(b.x0, b.y0, 403) * 0.7);
    rect(-b.Wp * 0.3, -2, b.Wp * 0.6, 4, WOOD.dark, 1);
    ctx.restore();
    for (let k = 0; k < 5; k++) {
      const sx = left + hash2(b.x0, k, 404) * (right - left), sy = base - 2 - hash2(b.y0, k, 405) * 8;
      blob(sx, sy, 3.5, 2.5, b.x0 * 13 + k, STONE.light);
    }
    for (let k = 0; k < 4; k++) {
      const wx = left + 4 + hash2(b.x0, k, 406) * (right - left - 8), wy = base - hash2(b.y0, k, 407) * 4;
      line(wx - 2, wy - 6, wx, wy, GRASS.tuft, 1.3);
      line(wx + 2, wy - 7, wx, wy, GRASS.tuft, 1.3);
    }
  }

  function drawScaffold(b, part) {
    const left = b.X + 6, right = b.X + b.Wp - 6, base = b.base - 4;
    const fullH = b.h >= 3 ? 30 : 24;
    const h = Math.max(4, fullH * (0.25 + 0.75 * part));
    rect(left - 2, base - 6, right - left + 4, 8, STONE.dark, 2);
    const brick = b.id === 'kiln' || b.id === 'house1' || b.id === 'house2' || b.id === 'house3' || b.id === 'forge' || b.id === 'mill';
    rect(left, base - h, right - left, h, brick ? '#b8664a' : STONE.mid, 1);
    for (let yy = base - 5; yy > base - h; yy -= 5) line(left, yy, right, yy, 'rgba(60, 40, 30, 0.3)', 0.8);
    const poleTop = base - fullH - 16;
    for (const px of [left - 4, right + 1]) rect(px, poleTop, 3, base - poleTop, WOOD.pale, 1);
    line(left - 4, base - h - 3, right + 4, base - h - 3, WOOD.light, 3);
    line(left - 3, poleTop + 6, right + 3, base - 6, 'rgba(179, 131, 79, 0.85)', 1.6);
    // A pile of materials waiting by the wall.
    for (let k = 0; k < 3; k++) rect(right - 2, base - 3 - k * 3, 12, 3, k % 2 ? WOOD.light : WOOD.pale, 1);
    blob(left - 6, base - 2, 5, 3.5, b.x0 + 77, STONE.light);
  }

  // Bridge over the river: flat, drawn under the walkers. Posts first, planks as payment arrives.
  function drawBridge() {
    const b = BOX.bridge, st = V.stage(S, 'bridge');
    const x0 = b.X - 12, x1 = b.X + b.Wp + 12, y0 = b.Y + 5, y1 = b.Y + b.Hp - 5;
    const posts = [];
    for (let x = x0 + 6; x < x1; x += 22) posts.push(x);
    for (const px of posts) for (const py of [y0 + 1, y1 - 1]) {
      ellipse(px + 1, py + 3, 4, 2, 'rgba(30, 60, 70, 0.35)');
      rect(px - 2.5, py - 5, 5, 8, WOOD.dark, 1.5);
    }
    if (st === 0) {
      ctx.save();
      ctx.translate(b.cx + 10, b.Y + b.Hp / 2 + 4);
      ctx.rotate(0.5 + Math.sin(time * 0.9) * 0.05);
      rect(-14, -3, 28, 6, WOOD.mid, 1);
      ctx.restore();
      return;
    }
    const k = st === 2 ? 1 : clamp(share('bridge'), 0.1, 0.95);
    const end = x0 + (x1 - x0) * k;
    ellipse((x0 + end) / 2, y1 + 4, (end - x0) / 2, 4, 'rgba(30, 60, 70, 0.25)');
    for (let x = x0, i = 0; x < end; x += 6, i++) rect(x, y0, Math.min(6, end - x) - 0.6, y1 - y0, i % 2 ? WOOD.light : '#a8774a', 1);
    for (let x = x0 + 3; x < end; x += 12) circle(x, y0 + 3, 0.7, WOOD.dark);
    if (st === 2) {
      for (const py of [y0, y1]) {
        rect(x0, py - 4, x1 - x0, 3, WOOD.mid, 1.5);
        for (const px of posts) rect(px - 1.5, py - 8, 3, 8, WOOD.dark, 1);
      }
    }
  }

  // ───────────── Decorations ─────────────
  function drawDecor(d) {
    const cx = (d.x + 0.5) * T, by = (d.y + 1) * T - 4;
    if (d.kind === 'bed') {
      rect(d.x * T + 4, by - 14, T - 8, 14, '#6e4a2b', 4);
      rect(d.x * T + 6, by - 12, T - 12, 10, '#5a3d24', 3);
      for (let k = 0; k < 7; k++) {
        const fx0 = d.x * T + 8 + hash2(d.x, d.y, 500 + k) * (T - 16), fy0 = by - 11 + hash2(d.x, d.y, 510 + k) * 8;
        line(fx0, fy0 + 3, fx0, fy0, '#4f7a33', 1);
        circle(fx0, fy0, 2.2, FLOWERS[k % FLOWERS.length]);
      }
    } else if (d.kind === 'lantern') {
      shadow(cx + 2, by, 6, 2.5);
      rect(cx - 1.5, by - 26, 3, 26, WOOD.dark, 1);
      line(cx, by - 26, cx + 6, by - 26, WOOD.dark, 2);
      rect(cx + 2, by - 25, 8, 9, '#3d3226', 2);
      rect(cx + 3.5, by - 23.5, 5, 6, '#ffd27a', 1);
      glow(cx + 6, by - 20, 22, 0.32 + Math.sin(time * 2 + d.x) * 0.05, '255, 205, 120');
    } else if (d.kind === 'bench') {
      shadow(cx + 2, by, 14, 3);
      rect(cx - 13, by - 8, 3, 8, WOOD.dark, 1);
      rect(cx + 10, by - 8, 3, 8, WOOD.dark, 1);
      rect(cx - 14, by - 10, 28, 4, WOOD.light, 1.5);
      rect(cx - 14, by - 18, 28, 3, WOOD.mid, 1.5);
      rect(cx - 12, by - 16, 2, 6, WOOD.mid, 1);
      rect(cx + 10, by - 16, 2, 6, WOOD.mid, 1);
    } else {
      for (const px of [d.x * T + 3, cx - 1.5, (d.x + 1) * T - 6]) rect(px, by - 16, 3, 16, WOOD.mid, [1.5, 1.5, 0, 0]);
      line(d.x * T, by - 12, (d.x + 1) * T, by - 12, WOOD.light, 2.4);
      line(d.x * T, by - 6, (d.x + 1) * T, by - 6, WOOD.light, 2.4);
    }
  }

  function glow(x, y, r, a, rgb) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb}, ${a})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // ───────────── People ─────────────
  const TOOL_OF = { tree: 'axe', rock: 'pick', clay: 'shovel', bush: 'basket' };
  const SWING = 0.3;

  function drawTool(tool) {
    if (tool === 'basket') {
      rect(-5, -3, 10, 7, WOOD.light, [1, 1, 3, 3]);
      ctx.strokeStyle = WOOD.mid;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, -3, 4.5, Math.PI, TAU);
      ctx.stroke();
      circle(-2, -3.5, 1.6, '#c2335a');
      circle(1.5, -3.8, 1.6, '#a82a50');
      return;
    }
    rect(-1, -15, 2.2, 17, WOOD.light, 1);
    if (tool === 'axe') poly([1, -15, 7.5, -17, 7.5, -9.5, 1, -11], '#c9ccd1');
    else if (tool === 'pick') {
      ctx.strokeStyle = '#b5b8be';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-7, -11);
      ctx.quadraticCurveTo(0, -18, 7, -11);
      ctx.stroke();
    } else if (tool === 'shovel') rect(-3.5, -21, 7.5, 8, '#b5b8be', [1, 1, 3.5, 3.5]);
  }

  // A small villager seen from above at a tilt. (x, y) are the feet; o holds the look and the pose.
  function drawPerson(x, y, o) {
    const bob = o.moving ? -Math.abs(Math.sin(o.phase)) * 1.6 : Math.sin(time * 2 + x) * 0.3;
    const sw = o.moving ? Math.sin(o.phase) : 0;
    const side = o.face === 'left' || o.face === 'right';
    const flip = o.face === 'left' ? -1 : 1;
    shadow(x, y, 7, 2.6);
    // Legs and boots.
    if (side) {
      rect(x - 3 + sw * 2.2, y - 7, 3, 7, o.pants, 1);
      rect(x - sw * 2.2, y - 7, 3, 7, o.pants, 1);
      rect(x - 3 + sw * 2.2 + (flip > 0 ? 0.5 : -1), y - 2, 3.5, 2, '#3b2c1a', 1);
      rect(x - sw * 2.2 + (flip > 0 ? 0.5 : -1), y - 2, 3.5, 2, '#3b2c1a', 1);
    } else {
      rect(x - 4, y - 7 - Math.max(0, sw) * 1.5, 3, 7, o.pants, 1);
      rect(x + 1, y - 7 - Math.max(0, -sw) * 1.5, 3, 7, o.pants, 1);
      rect(x - 4.5, y - 2 - Math.max(0, sw) * 1.5, 4, 2, '#3b2c1a', 1);
      rect(x + 0.5, y - 2 - Math.max(0, -sw) * 1.5, 4, 2, '#3b2c1a', 1);
    }
    const toolOut = o.tool && (o.swing >= 0 || o.holding);
    const hand = { x: x + (side ? flip * 3 : 6.5), y: y - 11 + bob };
    if (toolOut && o.face === 'up') toolAt(hand, o, flip);
    // Body, apron, belt and arms.
    rect(x - 6, y - 17 + bob, 12, 11, o.shirt, 4);
    if (o.apron) rect(x - 4, y - 13 + bob, 8, 7, o.apron, 2);
    rect(x - 6, y - 9 + bob, 12, 1.6, 'rgba(60, 40, 20, 0.55)');
    if (!side) {
      circle(x - 6.5, y - 12 + bob + sw * 1.2, 2.2, o.shirt);
      if (!toolOut) circle(x + 6.5, y - 12 + bob - sw * 1.2, 2.2, o.shirt);
    } else if (!toolOut) circle(x - flip * 1 + sw * 2.5, y - 11 + bob, 2.2, o.shirt);
    // Head.
    const hy = y - 21 + bob;
    circle(x, hy, 5.2, o.skin);
    if (o.face !== 'up') {
      if (side) circle(x + flip * 2.6, hy + 0.3, 0.8, '#3b2c1a');
      else {
        circle(x - 2, hy + 0.3, 0.8, '#3b2c1a');
        circle(x + 2, hy + 0.3, 0.8, '#3b2c1a');
        circle(x - 3.3, hy + 2, 1.1, 'rgba(230, 120, 110, 0.45)');
        circle(x + 3.3, hy + 2, 1.1, 'rgba(230, 120, 110, 0.45)');
      }
    }
    if (o.hat === 'straw') {
      ellipse(x, hy - 3, 8.5, 3.2, '#e2c071');
      rect(x - 4.5, hy - 9, 9, 6.5, '#d4ad5a', [3.5, 3.5, 1, 1]);
      rect(x - 4.5, hy - 4.8, 9, 1.6, '#b5523b');
    } else if (o.hat === 'scarf') {
      ctx.fillStyle = o.hatColor;
      ctx.beginPath();
      ctx.arc(x, hy - 0.5, 5.8, Math.PI * 1.05, Math.PI * 1.95);
      ctx.closePath();
      ctx.fill();
      if (o.face !== 'down') circle(x - flip * 4, hy + 2, 1.8, o.hatColor);
    } else {
      ctx.fillStyle = o.hatColor;
      ctx.beginPath();
      ctx.arc(x, hy - 1, 5.4, Math.PI, TAU);
      ctx.fill();
      rect(side ? x + flip * 1 - 3 : x - 5, hy - 2, side ? 7 : 10, 1.6, o.hatColor, 1);
    }
    if (o.face === 'up') rect(x - 5, hy - 2, 10, 5, o.hair, 2);
    if (toolOut && o.face !== 'up') toolAt(hand, o, flip);
  }

  function toolAt(hand, o, flip) {
    let ang = -0.35;
    if (o.swing >= 0 && o.tool !== 'basket') {
      const p = o.swing / SWING;
      ang = p < 0.35 ? lerp(-0.35, -1.7, ease(p / 0.35)) : lerp(-1.7, 1.25, ease((p - 0.35) / 0.65));
    }
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.scale(flip, 1);
    if (o.tool !== 'basket') ctx.rotate(ang);
    drawTool(o.tool);
    ctx.restore();
    circle(hand.x, hand.y, 2.2, o.skin);
  }

  const LOOKS = {
    player: { shirt: '#3f7f8c', pants: '#5a4a3a', skin: '#f1c9a0', hat: 'straw', hair: '#6b4a2e' },
    woodcutter: { shirt: '#b5523b', pants: '#4a3d30', skin: '#e8b98f', hat: 'cap', hatColor: '#5b3a2a', hair: '#4a3020' },
    mason: { shirt: '#8d8f86', pants: '#4f4a40', skin: '#f0c49a', hat: 'cap', hatColor: '#3f4a5a', hair: '#7a5a3a', apron: '#c9b28a' },
    potter: { shirt: '#7f6aa8', pants: '#5a4a3a', skin: '#f3cfa6', hat: 'scarf', hatColor: '#d8506a', hair: '#8a5a32', apron: '#e9dcc2' },
  };

  // Cosmetic state of the player: facing, walk cycle and the swing.
  const P = { x: 0, y: 0, face: 'down', phase: 0, moving: false, swing: -1, tool: null };
  let prev = { x: 0, y: 0 };

  function updatePlayerLook(px, py, dt) {
    const dx = px - P.x, dy = py - P.y;
    const dist = Math.hypot(dx, dy);
    P.moving = dist > 0.0005;
    if (P.moving) P.phase += dist * 9;
    const tg = S.player.target;
    const node = tg && tg.type === 'node' ? S.nodes[tg.id] : null;
    if (node && !S.player.path) P.face = VV.facing(node.x + 0.5 - px, node.y + 0.5 - py, P.face);
    else P.face = VV.facing(dx, dy, P.face);
    if (node) P.tool = TOOL_OF[node.kind];
    if (P.swing >= 0) { P.swing += dt; if (P.swing > SWING) P.swing = -1; }
    P.holding = !!node;
    P.x = px; P.y = py;
  }

  // ───────────── Villagers (cosmetic) ─────────────
  // They walk between their house door and a node of their trade; core.js counts their work on its own.
  const ROLE_NODE = { woodcutter: 'tree', mason: 'rock', potter: 'clay' };
  const folk = new Map();

  function doorOf(house) {
    const b = BOX[house];
    const cands = [];
    for (let dx = 0; dx < b.w; dx++) cands.push({ x: b.x0 + dx, y: b.y0 + b.h });
    cands.push({ x: b.x0 - 1, y: b.y0 + b.h - 1 }, { x: b.x0 + b.w, y: b.y0 + b.h - 1 });
    return cands.find((c) => V.isWalkable(S, c.x, c.y)) || cands[0];
  }

  function workSpot(f) {
    const kind = ROLE_NODE[f.role];
    let best = null, bd = Infinity;
    for (const n of S.nodes) {
      if (n.kind !== kind) continue;
      const d = Math.abs(n.x - f.home.x) + Math.abs(n.y - f.home.y) + (n.hp > 0 ? 0 : 6) + hash2(n.id, f.seed, 600) * 8;
      if (d < bd) { bd = d; best = n; }
    }
    if (!best) return null;
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      if (V.isWalkable(S, best.x + dx, best.y + dy)) return { x: best.x + dx, y: best.y + dy, node: best };
    }
    return null;
  }

  function syncFolk() {
    for (const v of S.villagers) {
      if (folk.has(v.house) || !BOX[v.house]) continue;
      const home = doorOf(v.house);
      folk.set(v.house, {
        role: v.role, home, seed: folk.size + 1, x: home.x + 0.5, y: home.y + 0.5,
        path: null, at: 'home', wait: 1 + folk.size * 2, beat: 0, face: 'down', phase: 0, moving: false, swing: -1, node: null,
      });
    }
  }

  function updateFolk(dt) {
    for (const f of folk.values()) {
      f.moving = false;
      if (f.swing >= 0) { f.swing += dt; if (f.swing > SWING) f.swing = -1; }
      if (f.path) {
        let left = 1.7 * dt;
        while (f.path && left > 0) {
          const w = f.path[0], tx = w.x + 0.5, ty = w.y + 0.5;
          const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy);
          if (d > 1e-6) f.face = VV.facing(dx, dy, f.face);
          if (d <= left) { f.x = tx; f.y = ty; left -= d; f.path.shift(); if (!f.path.length) f.path = null; }
          else { f.x += (dx / d) * left; f.y += (dy / d) * left; left = 0; }
          f.moving = true;
        }
        if (f.moving) f.phase += 1.7 * dt * 9;
        if (!f.path) f.wait = f.at === 'work' ? 7 + hash2(f.seed, Math.floor(time), 610) * 5 : 4 + hash2(f.seed, Math.floor(time), 611) * 4;
        continue;
      }
      if (f.wait > 0) {
        f.wait -= dt;
        f.beat -= dt;
        if (f.at === 'work' && f.node && f.beat <= 0) {
          f.beat = 0.9 + Math.random() * 0.6;
          f.swing = 0;
          f.face = VV.facing(f.node.x + 0.5 - f.x, f.node.y + 0.5 - f.y, f.face);
          if (f.node.hp > 0) chips(f.node.kind, (f.node.x + 0.5) * T, (f.node.y + 0.6) * T, 3);
        }
        continue;
      }
      // Plan the next walk: home → work spot → home.
      const from = { x: Math.floor(f.x), y: Math.floor(f.y) };
      let to = f.home;
      if (f.at === 'home') {
        const spot = workSpot(f);
        if (!spot) { f.wait = 6; continue; }
        to = spot;
        f.node = spot.node;
      }
      const path = V.findPath(S, from, to);
      if (!path) { f.wait = 5; f.at = 'home'; f.x = f.home.x + 0.5; f.y = f.home.y + 0.5; continue; }
      f.path = path.length ? path : null;
      f.at = f.at === 'home' ? 'work' : 'home';
      if (!f.path) f.wait = 2;
    }
  }

  // Hens peck around the barn once it stands.
  const hens = [0, 1, 2].map((k) => ({ x: 0, y: 0, tx: 0, ty: 0, wait: k, face: 1, k, placed: false }));
  function updateHens(dt) {
    if (!S.built.barn.done) return;
    const b = BOX.barn;
    for (const h of hens) {
      if (!h.placed) { h.x = h.tx = b.X + 10 + h.k * 22; h.y = h.ty = b.base + 12 + (h.k % 2) * 8; h.placed = true; }
      const dx = h.tx - h.x, dy = h.ty - h.y, d = Math.hypot(dx, dy);
      if (d > 0.5) {
        const v = Math.min(d, 14 * dt);
        h.x += (dx / d) * v; h.y += (dy / d) * v;
        if (Math.abs(dx) > 0.3) h.face = dx > 0 ? 1 : -1;
      } else if ((h.wait -= dt) <= 0) {
        h.tx = b.X - 6 + Math.random() * (b.Wp + 12);
        h.ty = b.base + 6 + Math.random() * 18;
        h.wait = 2 + Math.random() * 4;
      }
    }
  }

  function drawHen(h) {
    const peck = Math.abs(Math.sin(time * 3 + h.k * 2)) > 0.85 ? 3 : 0;
    const x = h.x, y = h.y, f = h.face;
    shadow(x, y, 5, 1.8);
    ellipse(x - f * 3, y - 6, 2.5, 3, '#efe8da');
    ellipse(x, y - 5, 5, 4, '#fbf6ec');
    circle(x + f * 4, y - 9 + peck, 2.6, '#fbf6ec');
    circle(x + f * 4, y - 11.5 + peck, 1.2, '#d2453a');
    poly([x + f * 6.2, y - 9 + peck, x + f * 8, y - 8.3 + peck, x + f * 6.2, y - 7.8 + peck], '#e9a43c');
    circle(x + f * 4.6, y - 9.4 + peck, 0.5, '#3b2c1a');
    line(x - 1, y - 2, x - 1, y, '#e9a43c', 0.8);
    line(x + 1, y - 2, x + 1, y, '#e9a43c', 0.8);
  }

  // ───────────── Effects ─────────────
  function part(x, y, o) {
    fx.parts.push({ x, y, vx: o.vx || 0, vy: o.vy || 0, g: o.g ?? 160, life: o.life || 0.6, max: o.life || 0.6, size: o.size || 2, color: o.color, z: 0 });
  }

  const CHIPS = { tree: ['#c99a5e', '#8b5e36', '#7aae58'], rock: ['#bdb7a8', '#9d978a', '#fff3c4'], clay: ['#cf8452', '#b3643a'], bush: ['#c2335a', '#5f9446', '#7aae58'] };
  function chips(kind, x, y, n = 6) {
    const cols = CHIPS[kind];
    for (let k = 0; k < n; k++) {
      part(x + (Math.random() - 0.5) * 8, y - 8, {
        vx: (Math.random() - 0.5) * 70, vy: -40 - Math.random() * 60, life: 0.5 + Math.random() * 0.3,
        size: 1.2 + Math.random() * 1.6, color: cols[k % cols.length],
      });
    }
  }

  function spark(x, y) {
    part(x, y, { vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 30, g: 40, life: 0.6, size: 1, color: '#ffc861' });
  }

  function sparkle(x, y, n, colors = ['#fff3c4', '#e9b44c', '#ffffff']) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU, v = 30 + Math.random() * 70;
      part(x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, g: 50, life: 0.8 + Math.random() * 0.6, size: 1.5 + Math.random() * 1.5, color: colors[k % colors.length] });
    }
  }

  // Smoke puffs from chimneys. Emitters are registered while drawing (only visible chimneys smoke).
  let smokeClock = 0;
  const emitters = [];
  function emit(x, y, rate) { emitters.push({ x, y, rate }); }

  function updateEffects(dt) {
    for (const p of fx.parts) {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    fx.parts = fx.parts.filter((p) => p.life > 0);
    smokeClock += dt;
    if (smokeClock > 0.35) {
      smokeClock = 0;
      for (const e of emitters) {
        if (Math.random() < 0.6 * e.rate) fx.smoke.push({ x: e.x, y: e.y, r: 2.5, life: 3.2, max: 3.2, seed: Math.random() * 10 });
      }
    }
    for (const s of fx.smoke) {
      s.life -= dt;
      s.y -= 9 * dt;
      s.x += (5 + Math.sin(time * 0.7 + s.seed) * 4) * dt;
      s.r += 2.6 * dt;
    }
    fx.smoke = fx.smoke.filter((s) => s.life > 0);
    for (const f of fx.falls) f.t += dt;
    fx.falls = fx.falls.filter((f) => f.t < 1);
    updateFireworks(dt);
  }

  function drawFalls() {
    for (const f of fx.falls) {
      const a = Math.min(1, f.t / 0.55);
      ctx.save();
      ctx.globalAlpha = f.t < 0.6 ? 1 : 1 - (f.t - 0.6) / 0.4;
      ctx.translate(f.cx, f.by);
      ctx.rotate(f.dir * (Math.PI / 2) * a * a);
      ctx.translate(-f.cx, -f.by);
      drawTree(f.node, f.cx, f.by, 0);
      ctx.restore();
    }
  }

  // Fireworks over the square after the festival: frequent at first, then now and then.
  let fwNext = 1, festBoost = 0;
  const FW_COLORS = ['#ff4d6d', '#ffd60a', '#4cc9f0', '#f72585', '#80ed99', '#ff9f1c'];
  function updateFireworks(dt) {
    if (S.festival) {
      festBoost = Math.max(0, festBoost - dt);
      fwNext -= dt;
      if (fwNext <= 0) {
        fwNext = festBoost > 0 ? 0.5 + Math.random() * 0.6 : 3 + Math.random() * 4;
        const x = (SQ.x0 + Math.random() * (SQ.x1 - SQ.x0 + 1)) * T;
        fx.rockets.push({ x, y: (SQ.y1 + 1) * T, vy: -230 - Math.random() * 60, color: FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)] });
      }
    }
    for (const r of fx.rockets) {
      r.y += r.vy * dt;
      r.vy += 120 * dt;
      if (r.vy > -50) {
        r.done = true;
        const n = 40, v0 = 75 + Math.random() * 35;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + Math.random() * 0.1, v = v0 * (0.85 + Math.random() * 0.3);
          fx.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.8, color: k % 4 ? r.color : '#fff6d6' });
        }
      }
    }
    fx.rockets = fx.rockets.filter((r) => !r.done);
    for (const s of fx.sparks) {
      s.vx *= 1 - 1.4 * dt; s.vy *= 1 - 1.4 * dt;
      s.vy += 30 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.life -= dt;
    }
    fx.sparks = fx.sparks.filter((s) => s.life > 0);
  }

  function drawFireworks() {
    if (!fx.rockets.length && !fx.sparks.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of fx.rockets) {
      for (let k = 1; k < 6; k++) circle(r.x + Math.sin(r.y * 0.3 + k) * 0.8, r.y + k * 3, 1.6 - k * 0.22, `rgba(255, 210, 140, ${0.5 - k * 0.08})`);
      glow(r.x, r.y, 7, 0.5, '255, 230, 170');
      circle(r.x, r.y, 1.6, '#fff3c4');
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    for (const s of fx.sparks) {
      ctx.globalAlpha = Math.min(1, s.life / 0.9);
      line(s.x - s.vx * 0.06, s.y - s.vy * 0.06, s.x, s.y, s.color, 1.6);
      circle(s.x, s.y, 2, s.color);
    }
    ctx.restore();
  }

  // Strings of lanterns across the square for the festival.
  const POLES = [[SQ.x0 * T + 4, SQ.y0 * T + 4], [(SQ.x1 + 1) * T - 4, SQ.y0 * T + 4], [SQ.x0 * T + 4, (SQ.y1 + 1) * T - 3], [(SQ.x1 + 1) * T - 4, (SQ.y1 + 1) * T - 3]];
  const POLE_H = 38;
  function drawPole(x, y) {
    shadow(x + 2, y, 4, 1.8);
    rect(x - 1.5, y - POLE_H, 3, POLE_H, WOOD.mid, 1);
    poly([x - 1.5, y - POLE_H, x + 9, y - POLE_H + 4, x - 1.5, y - POLE_H + 8], '#d8506a');
  }
  function drawGarlands() {
    const cols = ['#ff7b6b', '#ffd166', '#8ee08a', '#7bc8f2', '#f7aef8'];
    let i = 0;
    for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]]) {
      const [x0, y0] = POLES[a], [x1, y1] = POLES[b];
      const ax = x0, ay = y0 - POLE_H + 2, bx = x1, by = y1 - POLE_H + 2;
      const sag = 18;
      ctx.strokeStyle = 'rgba(60, 40, 25, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + sag * 2, bx, by);
      ctx.stroke();
      const n = Math.max(4, Math.round(Math.hypot(bx - ax, by - ay) / 26));
      for (let k = 1; k < n; k++) {
        const u = k / n;
        const x = (1 - u) * (1 - u) * ax + 2 * (1 - u) * u * (ax + bx) / 2 + u * u * bx;
        const y = (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * ((ay + by) / 2 + sag * 2) + u * u * by;
        const c = cols[i++ % cols.length];
        const sw = Math.sin(time * 1.6 + k) * 1.2;
        glow(x + sw, y + 5, 12, 0.28 + Math.sin(time * 2.4 + k) * 0.06, '255, 210, 140');
        line(x, y, x + sw, y + 2, 'rgba(60, 40, 25, 0.7)', 0.8);
        rect(x + sw - 3, y + 2, 6, 7, c, 2.5);
        rect(x + sw - 1.5, y + 3.5, 1.5, 3, 'rgba(255, 255, 255, 0.55)', 0.7);
      }
    }
  }

  // Butterflies drift around flowers near the player; cloud shadows slide across the meadows.
  const flies = [0, 1, 2, 3].map((k) => ({ ax: 0, ay: 0, k, set: false, col: ['#f6e27a', '#ffffff', '#f2a7c3', '#9ec9f0'][k] }));
  function drawButterflies() {
    for (const b of flies) {
      const x = b.ax + Math.sin(time * (0.5 + b.k * 0.13) + b.k) * 40;
      const y = b.ay + Math.sin(time * (0.8 + b.k * 0.1) + b.k * 2) * 22;
      const off = x < cam.x - 60 || x > cam.x + cw + 60 || y < cam.y - 60 || y > cam.y + ch + 60;
      if (!b.set || off) {
        b.ax = cam.x + 60 + Math.random() * Math.max(1, cw - 120);
        b.ay = cam.y + 60 + Math.random() * Math.max(1, ch - 120);
        b.set = true;
        continue;
      }
      const flap = Math.abs(Math.sin(time * 14 + b.k));
      ellipse(x - 2.2 * flap, y, 2.6 * flap + 0.4, 2, b.col);
      ellipse(x + 2.2 * flap, y, 2.6 * flap + 0.4, 2, b.col);
      line(x, y - 1.5, x, y + 1.5, '#3b2c1a', 0.8);
    }
  }

  function drawCloudShadows() {
    const mw = V.W * T + 600;
    for (let k = 0; k < 3; k++) {
      const x = ((k * 620 + time * (7 + k * 2)) % mw) - 300;
      const y = 160 + k * 360 + Math.sin(time * 0.05 + k) * 40;
      ellipse(x, y, 170 - k * 20, 90, 'rgba(40, 55, 30, 0.07)');
      ellipse(x + 90, y + 30, 120, 70, 'rgba(40, 55, 30, 0.05)');
    }
  }

  // ───────────── Events from core.js ─────────────
  // The list is read and cleared once per frame; drawing effects, UI and sounds all hang on the same events.
  function handleEvents() {
    if (!S.events.length) return;
    const evs = S.events.splice(0);
    for (const e of evs) {
      uiEvent(e);
      const snd = VV.soundFor(e);
      if (snd) A.play(snd);
      if (e.type === 'hit') {
        P.swing = 0;
        P.tool = TOOL_OF[e.kind];
        fx.shake.set(e.id, time);
        chips(e.kind, (e.x + 0.5) * T, (e.y + 0.7) * T);
      } else if (e.type === 'deplete') {
        const n = S.nodes[e.id];
        const cx = (e.x + 0.5) * T, by = (e.y + 1) * T - 5;
        fx.shake.delete(e.id);
        if (e.kind === 'tree') fx.falls.push({ node: n, cx, by, t: 0, dir: P.x * T < cx ? 1 : -1 });
        else chips(e.kind, cx, by - 4, 12);
      } else if (e.type === 'regrow') {
        fx.pop.set(e.id, time);
      } else if (e.type === 'built' || e.type === 'contribute') {
        const b = BOX[e.id];
        if (!b) continue;
        sparkle(b.cx, b.base - b.Hp / 2, e.type === 'built' ? 40 : 10);
        if (e.type === 'built') syncFolk();
      } else if (e.type === 'festival') {
        festBoost = 25;
        fwNext = 0.5;
      } else if (e.type === 'decor') {
        sparkle((e.x + 0.5) * T, (e.y + 0.5) * T, 14);
      }
    }
  }

  // ───────────── Frame ─────────────
  let acc = 0, last = 0;

  function frame(ms) {
    requestAnimationFrame(frame);
    const now = ms / 1000;
    const dt = Math.min(0.25, Math.max(0, now - (last || now)));
    last = now;
    time += dt;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 20) {
      prev = { x: S.player.x, y: S.player.y };
      V.step(S, STEP);
      acc -= STEP;
      n++;
    }
    if (n >= 20) acc = 0;
    const a = clamp(acc / STEP, 0, 1);
    const px = lerp(prev.x, S.player.x, a), py = lerp(prev.y, S.player.y, a);
    updatePlayerLook(px, py, dt);
    handleEvents();
    syncFolk();
    updateFolk(dt);
    updateHens(dt);
    updateEffects(dt);
    draw(px, py);
    hudClock -= dt;
    if (hudClock <= 0) { hudClock = 0.25; renderHUD(); }
  }

  function draw(px, py) {
    const target = VV.clampCamera(px * T, py * T, cw, ch, V.W * T, V.H * T);
    cam = { x: VV.snap(target.x, dpr), y: VV.snap(target.y, dpr) };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#4f7a33';
    ctx.fillRect(0, 0, cw, ch);
    ctx.translate(-cam.x, -cam.y);
    // Ground: cached chunks that touch the view.
    const size = CHUNK * T;
    for (let cy = Math.max(0, Math.floor(cam.y / size)); cy * size < Math.min(V.H * T, cam.y + ch); cy++) {
      for (let cx = Math.max(0, Math.floor(cam.x / size)); cx * size < Math.min(V.W * T, cam.x + cw); cx++) {
        ctx.drawImage(chunk(cx, cy), cx * size, cy * size, size, size);
      }
    }
    const r = VV.visibleRange(cam, cw, ch, V.W, V.H);
    drawWater(r);
    drawBridge();
    // Everything that stands is drawn back to front by its base line.
    const wide = VV.visibleRange(cam, cw, ch, V.W, V.H, T, 3);
    const inView = (x, y) => x >= wide.x0 && x <= wide.x1 && y >= wide.y0 && y <= wide.y1;
    const items = [];
    for (const nd of S.nodes) if (inView(nd.x, nd.y)) items.push([(nd.y + 1) * T - 5, drawNode, nd]);
    for (const id of Object.keys(BOX)) {
      const b = BOX[id];
      if (id === 'bridge' || b.x0 + b.w < wide.x0 || b.x0 > wide.x1 || b.y0 + b.h < wide.y0 || b.y0 > wide.y1) continue;
      items.push([b.base, drawBuilding, id]);
    }
    for (const d of S.decor) if (inView(d.x, d.y)) items.push([(d.y + 1) * T - 4, drawDecor, d]);
    for (const f of folk.values()) items.push([f.y * T + 9, drawFolk, f]);
    if (S.built.barn.done) for (const h of hens) items.push([h.y, drawHen, h]);
    if (S.festival) for (const [x, y] of POLES) items.push([y, () => drawPole(x, y)]);
    items.push([py * T + 9.5, () => drawPerson(px * T, py * T + 9, { ...LOOKS.player, ...P, holding: P.holding })]);
    items.sort((p, q) => p[0] - q[0]);
    emitters.length = 0;
    for (const [, fn, arg] of items) fn(arg);
    drawFalls();
    for (const p of fx.parts) {
      ctx.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1);
      circle(p.x, p.y, p.size, p.color);
    }
    ctx.globalAlpha = 1;
    for (const s of fx.smoke) {
      ctx.globalAlpha = 0.3 * Math.min(1, s.life / s.max * 1.6) * Math.min(1, (s.max - s.life) * 3);
      circle(s.x, s.y, s.r, '#f1ece2');
    }
    ctx.globalAlpha = 1;
    if (S.festival) drawGarlands();
    drawButterflies();
    drawFireworks();
    drawCloudShadows();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (vignette) { ctx.fillStyle = vignette; ctx.fillRect(0, 0, cw, ch); }
  }

  function drawBuilding(id) {
    const b = BOX[id];
    const st = V.stage(S, id);
    if (st === 2) ART[id](b);
    else if (st === 1 && id !== 'well') drawScaffold(b, share(id));
    else drawRuin(b);
  }

  function drawFolk(f) {
    drawPerson(f.x * T, f.y * T + 9, {
      ...LOOKS[f.role], face: f.face, phase: f.phase, moving: f.moving, swing: f.swing,
      tool: f.at === 'work' && !f.path ? TOOL_OF[ROLE_NODE[f.role]] : null, holding: f.at === 'work' && !f.path,
    });
  }

  // ───────────── HUD ─────────────
  let hudClock = 0;
  const RES_IDS = Object.keys(V.RESOURCES);
  const BUILD_IDS = Object.keys(V.BUILDINGS);
  const resName = (r) => t(V.RESOURCES[r].name);
  // "Дерево 30, Камень 20" — names first, so the Russian words stay in the nominative case.
  const costText = (cost) => Object.entries(cost).map(([r, n]) => `${resName(r)} ${n}`).join(', ');
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Set innerHTML only when it changed, so buttons under the pointer aren't replaced between press and release.
  function setHTML(el, html) { if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; } }

  function goalText(g) {
    if (placing) return t('Ставь: {name}', { name: t(V.DECOR[placing].name) });
    if (!g) return t('Осмотрись вокруг');
    if (g.type === 'build') return t('Восстановить: {name}', { name: t(V.BUILDINGS[g.id].name) });
    if (g.type === 'tool') return t('Нужен инструмент: {name}', { name: t(V.TOOLS[g.tool].name) });
    return t('Украшай село');
  }

  function renderHUD() {
    const inc = VV.income(S, V);
    for (const r of RES_IDS) {
      $(`r-${r}`).textContent = VV.fmt(S.res[r]);
      const rate = VV.fmtRate(inc.rate[r]);
      $(`r-${r}-rate`).textContent = rate ? t('{v}/мин', { v: rate }) : '';
      const item = $(`r-${r}`).closest('.res-item');
      const full = inc.full.includes(r);
      item.classList.toggle('full', full);
      item.title = full ? t('Амбар полон: жители и мастерские ждут') : '';
    }
    const done = BUILD_IDS.filter((id) => S.built[id].done).length;
    $('built-label').textContent = t('Восстановлено {n}/{total}', { n: done, total: BUILD_IDS.length });
    $('goal-text').textContent = goalText(V.nextGoal(S));
    if (openId === 'panel-building') renderBuilding();
    else if (openId === 'panel-buildings') renderBuildings();
    else if (openId === 'panel-tools') renderTools();
  }

  // ───────────── Floats and toasts ─────────────
  function float(text, wx, wy, cls = '') {
    const el = document.createElement('div');
    el.className = `float ${cls}`.trim();
    el.textContent = text;
    el.style.left = `${Math.round(wx - cam.x)}px`;
    el.style.top = `${Math.round(wy - cam.y)}px`;
    $('floats').append(el);
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => el.remove(), 3000); // in case animations are off
  }

  let toastTimer = 0;
  function toast(text, ms = 2600) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ───────────── Modal ─────────────
  // actions: [{ label, primary?, danger?, run? }]; any button closes the window.
  function modal(title, bodyHTML, actions) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHTML;
    const row = $('modal-actions');
    row.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`;
      b.textContent = a.label;
      b.addEventListener('click', () => { closeModal(); if (a.run) a.run(); });
      row.append(b);
    }
    $('modal').hidden = false;
    const focus = row.querySelector('.primary') || row.lastElementChild;
    if (focus) focus.focus();
  }
  const closeModal = () => { $('modal').hidden = true; };
  const modalOpen = () => !$('modal').hidden;

  // ───────────── Panels ─────────────
  const PANELS = ['panel-building', 'panel-buildings', 'panel-tools', 'panel-settings'];
  let openId = null;      // the panel on screen
  let buildingId = null;  // the building shown in panel-building

  function openPanel(id) {
    for (const p of PANELS) $(p).hidden = p !== id;
    openId = id;
    renderHUD();
  }
  function closePanels() {
    for (const p of PANELS) $(p).hidden = true;
    openId = null;
    buildingId = null;
  }
  const togglePanel = (id) => (openId === id ? closePanels() : openPanel(id));

  const EFFECT = {
    well: 'Площадь оживёт, а рядом можно будет поднять амбар.',
    home: 'В доме появится верстак: можно улучшать инструменты.',
    barn: 'Амбар хранит запасы жителей и мастерских: до 150, с пристройкой до 400.',
    bridge: 'Откроет восточный берег и северную рощу. На том берегу найдётся лопата.',
    sawmill: 'Сама пилит доски: два дерева на доску. Тридцать брёвен всегда остаются тебе.',
    kiln: 'Сама обжигает кирпич: две глины на кирпич. Тридцать глины всегда остаются тебе.',
    house1: 'Поселится лесоруб и сам будет рубить лес.',
    house2: 'Поселится каменщик и сам будет добывать камень.',
    house3: 'Поселится гончар и сам будет копать глину.',
    forge: 'Кузнец откует инструменты третьего уровня.',
    mill: 'Все жители работают в полтора раза быстрее.',
    chapel: 'Зазвонит колокол, и село устроит праздник.',
  };
  const needsLeft = (id) => V.BUILDINGS[id].needs.filter((d) => !S.built[d].done);
  const nearBuilding = (id) => VV.footprintDist(S.player.x, S.player.y, V.FOOTPRINTS[id]) <= 1.6;

  function openBuilding(id) {
    buildingId = id;
    openPanel('panel-building');
  }

  function renderBuilding() {
    const id = buildingId;
    if (!id) return;
    // The panel belongs to the place: walking away closes it.
    if (!nearBuilding(id)) { closePanels(); return; }
    const b = V.BUILDINGS[id], own = S.built[id];
    $('pb-title').textContent = t(b.name);
    $('pb-effect').textContent = t(EFFECT[id]);
    const rows = Object.entries(b.cost).map(([r, n]) => {
      const paid = own.paid[r] || 0;
      const have = paid >= n ? '' : ` <small>${esc(t('есть {n}', { n: VV.fmt(S.res[r]) }))}</small>`;
      return `<li class="${paid >= n ? 'ok' : ''}"><i class="ico ${r}"></i>${esc(resName(r))} <b>${paid}/${n}</b>${have}</li>`;
    });
    setHTML($('pb-cost'), own.done ? '' : rows.join(''));
    const left = needsLeft(id);
    const btn = $('btn-contribute');
    let note = '';
    if (own.done) note = t('Восстановлено. Спасибо!');
    else if (left.length) note = t('Сначала: {list}', { list: left.map((d) => t(V.BUILDINGS[d].name)).join(', ') });
    else if (!Object.keys(b.cost).some((r) => (own.paid[r] || 0) < b.cost[r] && S.res[r] >= 1)) note = t('Нечего внести: собери ещё.');
    $('pb-needs').textContent = note;
    btn.hidden = own.done;
    btn.disabled = own.done || left.length > 0;
  }

  function contribute() {
    if (!buildingId) return;
    const r = V.contribute(S, buildingId);
    if (r === 'none') toast(t('Нечего внести: собери ещё.'));
    else if (r === 'locked') toast(t('Сначала: {list}', { list: needsLeft(buildingId).map((d) => t(V.BUILDINGS[d].name)).join(', ') }));
    renderHUD();
  }

  function renderBuildings() {
    const items = BUILD_IDS.map((id) => {
      const own = S.built[id];
      let status;
      if (own.done) status = t('восстановлено');
      else if (needsLeft(id).length) status = t('пока закрыто');
      else status = `${Math.floor(share(id) * 100)}%`;
      const cls = own.done ? 'done' : needsLeft(id).length ? 'locked' : '';
      return `<li class="${cls}"><button class="link" type="button" data-go="${id}"><span>${esc(t(V.BUILDINGS[id].name))}</span><small>${esc(status)}</small></button></li>`;
    });
    setHTML($('buildings-list'), items.join(''));
    // The barn extension.
    const up = $('barn-upgrade');
    up.hidden = !S.built.barn.done || S.barnLevel >= V.STORAGE.length - 1;
    if (!up.hidden) {
      $('barn-cost').textContent = costText(V.BARN_UPGRADE);
      $('btn-barn').disabled = !V.canAfford(S, V.BARN_UPGRADE);
    }
    // Decorations after the festival.
    const dec = $('decor');
    dec.hidden = !S.festival;
    if (!dec.hidden) {
      setHTML($('decor-list'), Object.entries(V.DECOR).map(([k, d]) =>
        `<li><button class="btn${placing === k ? ' primary' : ''}" type="button" data-decor="${k}"${V.canAfford(S, d.cost) ? '' : ' disabled'}>${esc(t(d.name))}</button> <small>${esc(costText(d.cost))}</small></li>`).join(''));
    }
  }

  // From the list: walk to the building; its panel opens on arrival.
  function goToBuilding(id) {
    closePanels();
    if (nearBuilding(id)) { openBuilding(id); return; }
    const fp = V.FOOTPRINTS[id][0];
    if (V.interact(S, fp.x, fp.y) === 'ruin') toast(t('Иду: {name}', { name: t(V.BUILDINGS[id].name) }), 1600);
    else toast(t('Туда пока не пройти'));
  }

  function renderTools() {
    $('tools-hint').hidden = S.built.home.done;
    const rows = Object.entries(V.TOOLS).map(([id, tool]) => {
      const lvl = S.tools[id];
      const next = lvl + 1;
      let what, btn = '';
      if (lvl < 1) what = t('найдётся за мостом');
      else if (lvl >= V.MAX_TOOL) what = t('лучший уровень');
      else {
        const need = V.TOOL_NEEDS[next];
        const cost = tool.costs[next];
        if (need && !S.built[need].done) what = t('нужно здание: {name}', { name: t(V.BUILDINGS[need].name) });
        else {
          what = costText(cost);
          btn = `<button class="btn primary" type="button" data-tool="${id}"${V.canAfford(S, cost) ? '' : ' disabled'}>${esc(t('Улучшить'))}</button>`;
        }
      }
      const level = lvl ? t('ур. {n}', { n: lvl }) : '—';
      return `<li><div class="tool-row"><b>${esc(t(tool.name))}</b> <span class="muted">${esc(level)}</span>${btn}</div><small class="muted">${esc(what)}</small></li>`;
    });
    setHTML($('tools-list'), rows.join(''));
  }

  // ───────────── Events → UI ─────────────
  function uiEvent(e) {
    if (e.type === 'hit') {
      const res = V.NODE_KINDS[e.kind].res;
      float(`+${e.gain} ${resName(res)}`, (e.x + 0.5) * T, e.y * T, res);
    } else if (e.type === 'ruin') {
      openBuilding(e.id);
    } else if (e.type === 'built') {
      if (e.level) toast(t('Амбар расширен: запасы до {n}', { n: S.storage }));
      else if (e.id !== 'chapel') toast(t('Восстановлено: {name}', { name: t(V.BUILDINGS[e.id].name) }), 3500);
      save();
    } else if (e.type === 'tool') {
      toast(t('{name}: уровень {n}', { name: t(V.TOOLS[e.tool].name), n: e.level }));
      save();
    } else if (e.type === 'festival') {
      closePanels();
      modal(t('Праздник в селе!'), `<p>${esc(t('Колокол звонит, жители танцуют на площади. Село снова живое — спасибо тебе.'))}</p>`
        + `<p>${esc(t('Дальше можно просто гулять, собирать и украшать площадь: клумбы, фонари, скамейки и заборы — в списке зданий.'))}</p>`,
      [{ label: t('Ура!'), primary: true }]);
    } else if (e.type === 'decor') {
      save();
    }
  }

  // ───────────── Actions ─────────────
  let placing = null; // decoration kind waiting for a tap on the square

  function act(a, x, y) {
    if (a.type === 'tool') { toast(t('Нужен инструмент: {name}', { name: t(V.TOOLS[a.tool].name) })); return; }
    if (a.type === 'ruin' && nearBuilding(a.id)) { openBuilding(a.id); return; }
    if (a.type === 'gather' || a.type === 'ruin') {
      if (V.interact(S, x, y) === 'none') toast(t('Туда пока не пройти'));
      return;
    }
    if (a.type === 'walk' && !V.goTo(S, x, y)) toast(t('Туда пока не пройти'));
  }

  function tapTile(x, y) {
    if (placing) {
      const kind = placing;
      const r = V.placeDecor(S, kind, x, y);
      if (r === 'ok') return;
      if (r === 'cost') { toast(t('Не хватает: {list}', { list: costText(V.DECOR[kind].cost) })); return; }
      if (V.tileAt(x, y) === '#') { toast(t('Здесь уже занято')); return; }
      placing = null; // a tap outside the square ends placing and acts as usual
    }
    if (openId && openId !== 'panel-building') closePanels();
    act(VV.tapAction(S, V, x, y), x, y);
  }

  // The action key and the touch button: whatever is in front of the player.
  function actFront() {
    const a = VV.pickFront(S, V, S.player.x, S.player.y, P.face);
    if (!a) { toast(t('Подойди к дереву, камню, кусту или руине'), 1800); return; }
    act(a, a.x, a.y);
  }

  function startPlacing(kind) {
    placing = placing === kind ? null : kind;
    if (!placing) return;
    closePanels();
    toast(t('Нажми на свободное место на площади'));
  }

  // ───────────── Input ─────────────
  const KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
  };
  const held = new Set();
  function applyKeys() {
    let dx = 0, dy = 0;
    for (const k of held) { dx += KEYS[k][0]; dy += KEYS[k][1]; }
    V.moveDir(S, dx, dy); // a zero direction only stops key walking, a tap order stays
  }
  const isEl = (e, sel) => e.target instanceof HTMLElement && e.target.matches(sel);

  function onKeyDown(e) {
    if (isEl(e, 'input:not([type=checkbox]), textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    A.unlock();
    if (modalOpen()) {
      if (e.code === 'Escape') { e.preventDefault(); closeModal(); }
      return;
    }
    if (KEYS[e.code]) {
      e.preventDefault();
      if (!held.has(e.code)) { held.add(e.code); applyKeys(); }
      return;
    }
    if (e.repeat) return;
    switch (e.code) {
      case 'Space':
        if (isEl(e, 'input')) return; // a focused checkbox toggles as usual
        e.preventDefault(); actFront(); break;
      case 'KeyE': actFront(); break;
      case 'KeyB': togglePanel('panel-buildings'); break;
      case 'KeyT': togglePanel('panel-tools'); break;
      case 'KeyM': toggleMute(); break;
      case 'Escape': placing = null; closePanels(); break;
      default:
    }
  }
  function onKeyUp(e) {
    if (KEYS[e.code] && held.delete(e.code)) applyKeys();
  }
  function releaseKeys() {
    if (!held.size) return;
    held.clear();
    applyKeys();
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    A.unlock();
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const p = VV.screenToTile(e.clientX - r.left, e.clientY - r.top, cam);
    tapTile(p.x, p.y);
  }

  // ───────────── Sound toggles ─────────────
  function setAudio(music, sounds) {
    A.setMusic(music);
    A.setSounds(sounds);
    $('opt-music').checked = music;
    $('opt-sounds').checked = sounds;
  }
  function toggleMute() {
    const on = !(A.state.music || A.state.sounds);
    setAudio(on, on);
    toast(on ? t('Звук включён') : t('Звук выключен'), 1400);
  }

  // ───────────── Saving ─────────────
  // localStorage keeps core's save plus savedAt (load ignores unknown fields); the cloud gets core's save.
  function save() {
    const ok = store.set(SAVE_KEY, JSON.stringify({ ...V.save(S), savedAt: Date.now() }));
    $('save-status').textContent = ok ? t('сохранено') : t('браузер не даёт сохранять');
    return ok;
  }

  function loadSaved() {
    const raw = store.get(SAVE_KEY);
    if (!raw) return { s: null, savedAt: null, broken: false };
    const s = V.load(raw);
    if (s.recovered) {
      store.set(`${SAVE_KEY}.broken`, raw); // keep the unreadable copy aside instead of losing it silently
      return { s: null, savedAt: null, broken: true };
    }
    let savedAt = null;
    try { savedAt = Number(JSON.parse(raw).savedAt) || null; } catch { /* checked by load */ }
    return { s, savedAt, broken: false };
  }

  const newGame = () => V.newGame((Math.random() * 0x7fffffff) | 0);

  // Swap the whole state (reset, cloud load): cosmetic followers start over, the rest is drawn from S.
  function replaceState(s) {
    S = s;
    prev = { x: S.player.x, y: S.player.y };
    P.x = S.player.x; P.y = S.player.y; P.swing = -1;
    folk.clear();
    fx.shake.clear(); fx.pop.clear(); fx.falls.length = 0;
    for (const h of hens) h.placed = false;
    placing = null;
    held.clear();
    closePanels();
    syncFolk();
    renderHUD();
  }

  function duration(sec) {
    const d = VV.splitDuration(sec);
    if (d.h) return t('{h} ч {m} мин', d);
    if (d.m) return t('{m} мин', d);
    return t('{s} с', d);
  }

  // Villagers and workshops kept working while the page was closed or hidden.
  function catchUp(away, show) {
    if (!(away > 2)) return;
    const g = V.offline(S, away);
    if (!show) return;
    const rows = Object.entries(g.gains).map(([r, n]) => `<li><i class="ico ${r}"></i>${esc(resName(r))} <b>${n > 0 ? '+' : '−'}${VV.fmt(Math.abs(n))}</b></li>`);
    if (g.regrown) rows.push(`<li>${esc(t('Отросло деревьев, камней и кустов: {n}', { n: g.regrown }))}</li>`);
    if (!rows.length) return;
    const note = away > V.OFFLINE_MAX ? t(' (дольше восьми часов село без тебя не работает)') : '';
    modal(t('Пока тебя не было…'), `<p>${esc(t('Прошло {time}{note}. Вот что успели жители и мастерские:', { time: duration(Math.min(away, V.OFFLINE_MAX)), note }))}</p><ul class="cost">${rows.join('')}</ul>`,
      [{ label: t('Хорошо'), primary: true }]);
  }

  function resetGame() {
    modal(t('Начать заново?'), `<p>${esc(t('Всё восстановленное село пропадёт. Облачная копия по коду останется.'))}</p>`, [
      { label: t('Отмена') },
      { label: t('Начать заново'), danger: true, run: () => { replaceState(newGame()); save(); toast(t('Новое село ждёт')); } },
    ]);
  }

  // ───────────── Cloud saves (only when served by the Go backend) ─────────────
  function newCode() {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => abc[b % abc.length]).join('');
  }
  const pretty = (code) => code.match(/.{1,4}/g).join('-');
  const cleanCode = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  async function cloudPut(code) {
    const res = await fetch(`/api/saves/${code}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(V.save(S)),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async function initCloud() {
    try {
      const res = await fetch('/healthz');
      if (!res.ok || (await res.text()).trim() !== 'ok') return;
    } catch { return; }
    $('cloud').hidden = false;
    let code = store.get(CLOUD_KEY);
    if (code) $('cloud-code').textContent = pretty(code);

    $('btn-cloud-save').addEventListener('click', async () => {
      code = code || newCode();
      try {
        await cloudPut(code);
        store.set(CLOUD_KEY, code);
        $('cloud-code').textContent = pretty(code);
        $('cloud-msg').textContent = t('Сохранено. Введи этот код на другом устройстве.');
      } catch (err) { $('cloud-msg').textContent = t('Не удалось сохранить: {e}', { e: err.message }); }
    });

    $('cloud-load').addEventListener('submit', async (e) => {
      e.preventDefault();
      const c = cleanCode($('cloud-input').value);
      if (c.length !== 16) { $('cloud-msg').textContent = t('Код состоит из 16 букв и цифр.'); return; }
      try {
        const res = await fetch(`/api/saves/${c}`);
        if (res.status === 404) { $('cloud-msg').textContent = t('Сохранения с таким кодом нет.'); return; }
        if (!res.ok) throw new Error(await res.text());
        const s = V.load(await res.json());
        if (s.recovered) { $('cloud-msg').textContent = t('Это сохранение не подходит к игре.'); return; }
        code = c; store.set(CLOUD_KEY, c);
        replaceState(s);
        save();
        openPanel('panel-settings');
        $('cloud-code').textContent = pretty(c);
        $('cloud-input').value = '';
        $('cloud-msg').textContent = t('Загружено.');
      } catch (err) { $('cloud-msg').textContent = t('Не удалось загрузить: {e}', { e: err.message }); }
    });

    // Quietly keep the cloud copy fresh once the player has a code.
    setInterval(() => { if (code) cloudPut(code).catch(() => {}); }, 60000);
  }

  // ───────────── Boot ─────────────
  function bindUI() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseKeys);
    $('btn-act').addEventListener('click', () => { A.unlock(); actFront(); });
    $('btn-buildings').addEventListener('click', () => togglePanel('panel-buildings'));
    $('btn-tools').addEventListener('click', () => togglePanel('panel-tools'));
    $('btn-settings').addEventListener('click', () => togglePanel('panel-settings'));
    for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', closePanels);
    $('btn-contribute').addEventListener('click', contribute);
    $('btn-barn').addEventListener('click', () => {
      if (V.upgradeBarn(S) === 'cost') toast(t('Не хватает: {list}', { list: costText(V.BARN_UPGRADE) }));
      renderHUD();
    });
    $('buildings-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]');
      if (b) goToBuilding(b.dataset.go);
    });
    $('decor-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-decor]');
      if (b) startPlacing(b.dataset.decor);
    });
    $('tools-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tool]');
      if (!b) return;
      const r = V.upgradeTool(S, b.dataset.tool);
      if (r === 'cost') toast(t('Не хватает: {list}', { list: costText(V.TOOLS[b.dataset.tool].costs[S.tools[b.dataset.tool] + 1]) }));
      renderHUD();
    });
    $('opt-music').addEventListener('change', (e) => A.setMusic(e.target.checked));
    $('opt-sounds').addEventListener('change', (e) => A.setSounds(e.target.checked));
    $('btn-reset').addEventListener('click', resetGame);
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
    document.addEventListener('pointerdown', () => A.unlock(), { once: true });

    // rAF stops in a hidden tab, so the time away is caught up through core's offline path on return.
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); releaseKeys(); save(); }
      else if (hiddenAt) { catchUp((Date.now() - hiddenAt) / 1000, (Date.now() - hiddenAt) > 60000); hiddenAt = 0; save(); renderHUD(); }
    });
    window.addEventListener('pagehide', save);
    setInterval(save, 10000);
  }

  function boot() {
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = t(meta.content);
    // Added after I18n.translateDOM has run, so the button's own labels stay as they are.
    const addToggle = () => document.querySelector('.brand').append(GameNav.home('lang-btn'), I18n.toggle('lang-btn'));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addToggle); else addToggle();
    const saved = loadSaved();
    S = saved.s || newGame();
    prev = { x: S.player.x, y: S.player.y };
    P.x = S.player.x; P.y = S.player.y;
    setAudio(A.state.music, A.state.sounds);
    resize();
    window.addEventListener('resize', resize);
    bindUI();
    syncFolk();
    if (saved.savedAt) {
      const away = (Date.now() - saved.savedAt) / 1000;
      catchUp(away, away > 30);
    }
    if (saved.broken) toast(t('Сохранение повреждено — начато новое село'), 4000);
    save();
    renderHUD();
    initCloud();
    requestAnimationFrame(frame);
  }

  boot();
})();
