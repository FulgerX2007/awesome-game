// Родник — canvas art: the palette, ground chunks, nodes, buildings, people and effects.
// Everything on the canvas is drawn with code. Reads the rules state (core.js), never changes it.
// Browser only (window.VillageArt); game.js runs the loop and hands it the state and the people to draw.
(() => {
  'use strict';
  const V = window.Village;
  const VV = window.VillageView;
  const K = window.Fx;
  const { TILE: T, hash2, lerp, clamp } = VV;
  const TAU = Math.PI * 2;
  const ease = (x) => 1 - (1 - x) * (1 - x);
  const easeBack = (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;

  let S = null;
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  let cw = 0, ch = 0, dpr = 1;
  let cam = { x: 0, y: 0 };
  let time = 0;               // animation clock, seconds (runs even when the world is idle)
  let SUN = VV.sunAt(0.4, 'spring'); // this frame's daylight (view.sunAt)
  let CLOCK = V.clock(0);
  const lit = [];             // lights met while drawing this frame: { x, y, r, color, a }
  const light = (x, y, r, color, a = 1) => lit.push({ x, y, r, color, a });
  let vignette = null;


  // ───────────── Palette ─────────────
  // The ground and plant colours follow the season (view.palette); usePalette switches them. Sprites and
  // ground chunks are painted synchronously, so a paint can switch to another season and back.
  const FLOWERS = ['#fff6e0', '#f4d35e', '#f2a7c3', '#b9d4f2', '#f6b26b'];
  const SAND0 = { edge: '#cdb27c', main: '#e3cd98', pebble: '#bba373' };
  const WATER0 = { shallow: '#72c0cc', deep: '#4d9bb8' };
  const PATH0 = { edge: '#a78457', main: '#c9a670', speck: '#b39060' };
  let LOOK, GRASS, SAND, WATER, PATH, SEASON;
  function usePalette(season) {
    SEASON = season;
    LOOK = VV.palette(season);
    GRASS = LOOK.grass;
    SAND = LOOK.sand || SAND0;
    WATER = LOOK.water || WATER0;
    PATH = LOOK.path || PATH0;
  }
  function withPalette(season, fn) {
    const keep = SEASON;
    usePalette(season);
    try { return fn(); } finally { usePalette(keep); }
  }
  usePalette('spring');
  let FADE = { from: 'winter', to: 'spring', t: 1 }; // this frame's season change (view.seasonFade)
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
  // The square ('#' tiles in the map): festival poles stand in its corners.
  const SQ = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  V.MAP.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '#') return;
    SQ.x0 = Math.min(SQ.x0, x); SQ.x1 = Math.max(SQ.x1, x);
    SQ.y0 = Math.min(SQ.y0, y); SQ.y1 = Math.max(SQ.y1, y);
  }));

  const share = (id) => V.share(S, id);

  // ───────────── Canvas ─────────────
  // Fit the backing store to the canvas's CSS size and the device pixel ratio.
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
  function blob(x, y, rx, ry, seed, color, n = 7, jag = 0.18, g = ctx) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, k = 1 - jag + hash2(seed, i, 41) * jag * 2;
      pts.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k]);
    }
    g.fillStyle = color;
    g.beginPath();
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let m = mid(pts[n - 1], pts[0]);
    g.moveTo(m[0], m[1]);
    for (let i = 0; i < n; i++) {
      m = mid(pts[i], pts[(i + 1) % n]);
      g.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    g.fill();
  }
  const shadow = (x, y, rx, ry) => ellipse(x, y, rx, ry, 'rgba(38, 48, 20, 0.26)');

  // A shadow cast to the lower right, away from the top-left light: a contact patch at the foot and a longer,
  // fainter patch stretched along the ground.
  function castShadow(x, y, rx, len, a = 0.32) {
    a *= SUN.shadow;
    K.shadow(ctx, x + rx * 0.12, y, rx, rx * 0.38, a);
    ctx.save();
    ctx.translate(x + len * 0.45, y + len * 0.14);
    ctx.rotate(0.3);
    K.shadow(ctx, 0, 0, len * 0.6, rx * 0.46, a * 0.6);
    ctx.restore();
  }

  // ───────────── Cached sprites ─────────────
  // Static shapes are painted once into a small canvas at the device pixel ratio and blitted every frame.
  // (ax, ay) is where the anchor (a node's foot) sits inside the sprite; least recently used ones are dropped.
  const sprites = new Map();
  let spriteRatio = 0;
  function sprite(key, w, h, ax, ay, paint) {
    if (spriteRatio !== dpr) { sprites.clear(); spriteRatio = dpr; }
    let sp = sprites.get(key);
    if (sp) { sprites.delete(key); sprites.set(key, sp); return sp; }
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w * dpr));
    cv.height = Math.max(1, Math.ceil(h * dpr));
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, ax * dpr, ay * dpr);
    paint(g);
    sp = { cv, w, h, ax, ay };
    sprites.set(key, sp);
    if (sprites.size > 400) sprites.delete(sprites.keys().next().value);
    return sp;
  }
  const blit = (sp, x, y) => ctx.drawImage(sp.cv, x - sp.ax, y - sp.ay, sp.w, sp.h);
  // A sprite as big as a node's silhouette (view.NODE_TALL), so the art and the tap area agree.
  const nodeSprite = (kind, key, paint) => {
    const t = VV.NODE_TALL[kind], pad = 3;
    return sprite(key, t.hw * 2 + pad * 2, t.up + VV.NODE_FOOT + pad * 2, t.hw + pad, t.up + pad, paint);
  };
  // A node sprite that changes with the season: painted with that season's palette, and while a season
  // changes the old look stays under the new one as it fades in.
  function seasonal(kind, key, paint, x, y) {
    const one = (season) => nodeSprite(kind, `${key}|${season}`, (g) => withPalette(season, () => paint(g)));
    if (FADE.t < 1) {
      blit(one(FADE.from), x, y);
      ctx.globalAlpha = FADE.t;
      blit(one(FADE.to), x, y);
      ctx.globalAlpha = 1;
    } else blit(one(FADE.to), x, y);
  }

  // ───────────── Ground (cached in chunks) ─────────────
  // Terrain classes: g grass (ruin footprints too), s sand, w water (bridge site too), p path, q square.
  const CLASS = { '.': 'g', ':': 's', '~': 'w', b: 'w', '=': 'p', '#': 'q', g: 'f' };
  const inSquare = (x, y) => x >= SQ.x0 && x <= SQ.x1 && y >= SQ.y0 && y <= SQ.y1;
  // Ruin footprints sit on grass, except the well, which stands in the middle of the cobbled square.
  const terr = (x, y) => {
    x = clamp(x, 0, V.W - 1); y = clamp(y, 0, V.H - 1);
    return CLASS[V.MAP[y][x]] || (inSquare(x, y) ? 'q' : 'g');
  };
  const CHUNK = 16;
  const chunks = new Map();
  let chunkRatio = 0;

  // Chunks of seasons that are no longer on screen are dropped.
  function pruneChunks(keep) {
    for (const key of chunks.keys()) if (!keep.includes(key.slice(0, key.indexOf('|')))) chunks.delete(key);
  }

  function chunk(cx, cy, season) {
    if (chunkRatio !== dpr) { chunks.clear(); chunkRatio = dpr; }
    const key = season + '|' + cx + ',' + cy;
    let c = chunks.get(key);
    if (c) return c;
    const size = CHUNK * T;
    c = document.createElement('canvas');
    c.width = c.height = Math.round(size * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(-cx * size, -cy * size);
    // One tile of overlap on every side, so blobs and rounded edges match across chunk borders.
    withPalette(season, () => paintGround(g, cx * CHUNK - 1, cy * CHUNK - 1, cx * CHUNK + CHUNK, cy * CHUNK + CHUNK));
    chunks.set(key, c);
    return c;
  }

  // Fill the tiles of one terrain set as a single shape: sides facing other terrain are inset, outer corners
  // are rounded and inner corners get a fillet, so areas read as soft continuous patches. Each tile is drawn
  // as four quadrants, each shaped by its two side neighbours and the diagonal one.
  const QUADS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const ARC = [0.38, 0.71, 0.92];
  function layer(g, x0, y0, x1, y1, inSet, color, inset, radius) {
    g.fillStyle = color;
    layerPath(g, x0, y0, x1, y1, inSet, inset, radius);
    g.fill();
  }
  function layerPath(g, x0, y0, x1, y1, inSet, inset, radius) {
    const H = T / 2;
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
  }

  // A sunken area (water, a path) seen from above with the light at the top left: inside its shape the
  // north and west banks cast a soft shadow, the south and east banks catch the light, and a thin rim marks
  // the edge. `o`: { inset, radius, shadow: [width, alpha, rgb], lip: [width, alpha], rim }.
  function sunken(g, x0, y0, x1, y1, inSet, o) {
    const { EDGE } = VV;
    const band = (x, y, side, w, color) => {
      const px = x * T, py = y * T, i = o.inset;
      let grd;
      if (side === EDGE.N) grd = g.createLinearGradient(0, py + i, 0, py + i + w);
      else if (side === EDGE.S) grd = g.createLinearGradient(0, py + T - i, 0, py + T - i - w);
      else if (side === EDGE.W) grd = g.createLinearGradient(px + i, 0, px + i + w, 0);
      else grd = g.createLinearGradient(px + T - i, 0, px + T - i - w, 0);
      grd.addColorStop(0, color);
      grd.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
      g.fillStyle = grd;
      if (side === EDGE.N) g.fillRect(px, py, T, i + w);
      else if (side === EDGE.S) g.fillRect(px, py + T - i - w, T, i + w);
      else if (side === EDGE.W) g.fillRect(px, py, i + w, T);
      else g.fillRect(px + T - i - w, py, i + w, T);
    };
    g.save();
    layerPath(g, x0, y0, x1, y1, inSet, o.inset, o.radius);
    g.clip();
    const [sw, sa, rgb] = o.shadow, [lw, la] = o.lip;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const m = VV.edgeMask(inSet, x, y);
      if (!m) continue;
      if (m & EDGE.N) band(x, y, EDGE.N, sw, `rgba(${rgb}, ${sa})`);
      if (m & EDGE.W) band(x, y, EDGE.W, sw * 0.8, `rgba(${rgb}, ${sa * 0.8})`);
      if (m & EDGE.S) band(x, y, EDGE.S, lw, `rgba(255, 252, 240, ${la})`);
      if (m & EDGE.E) band(x, y, EDGE.E, lw * 0.8, `rgba(255, 252, 240, ${la * 0.7})`);
      if (o.rim) for (const side of [EDGE.N, EDGE.E, EDGE.S, EDGE.W]) if (m & side) band(x, y, side, 1.6, `rgba(255, 255, 255, ${o.rim})`);
    }
    g.restore();
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
    sunken(g, x0, y0, x1, y1, water, { inset: 5, radius: 12, shadow: [12, 0.34, '18, 52, 66'], lip: [5, 0.32], rim: 0.28 });
    layer(g, x0, y0, x1, y1, is('p'), PATH.edge, 0, 8);
    layer(g, x0, y0, x1, y1, is('p'), PATH.main, 2.5, 7);
    sunken(g, x0, y0, x1, y1, is('p'), { inset: 2.5, radius: 7, shadow: [5, 0.2, '74, 50, 24'], lip: [3, 0.22] });
    // Garden beds: dark tilled soil in furrows, sunk a little into the grass.
    layer(g, x0, y0, x1, y1, is('f'), '#6b4a2e', 1, 5);
    layer(g, x0, y0, x1, y1, is('f'), LOOK.snow ? '#e6edf2' : '#7e5735', 3, 4);
    sunken(g, x0, y0, x1, y1, is('f'), { inset: 3, radius: 4, shadow: [5, 0.3, '50, 30, 14'], lip: [2, 0.18] });
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (terr(x, y) !== 'f') continue;
      for (let k = 0; k < 3; k++) {
        const fy = y * T + 8 + k * 8;
        g.fillStyle = LOOK.snow ? 'rgba(160, 175, 190, 0.5)' : 'rgba(60, 38, 20, 0.55)';
        g.fillRect(x * T + 5, fy, T - 10, 2);
        g.fillStyle = LOOK.snow ? 'rgba(255, 255, 255, 0.7)' : 'rgba(170, 120, 80, 0.4)';
        g.fillRect(x * T + 5, fy - 1.5, T - 10, 1.2);
      }
    }
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
      else if (c === 'w' && LOOK.ice) iceDetail(g, x, y, px, py);
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
    if (LOOK.fallen && hash2(x, y, 160) < LOOK.fallen) {
      // Fallen leaves in autumn.
      for (let k = 0; k < 3; k++) {
        g.fillStyle = ['#c9672f', '#e0a03d', '#a8452e'][k];
        g.beginPath();
        g.ellipse(px + 4 + hash2(x, y, 161 + k) * (T - 8), py + 4 + hash2(x, y, 165 + k) * (T - 8), 2.6, 1.4, hash2(x, y, 169 + k) * TAU, 0, TAU);
        g.fill();
      }
    }
    if (LOOK.snow && hash2(x, y, 170) < 0.3) {
      // Glints on the snow.
      g.fillStyle = 'rgba(255, 255, 255, 0.9)';
      for (let k = 0; k < 3; k++) g.fillRect(px + hash2(x, y, 171 + k) * T, py + hash2(x, y, 175 + k) * T, 1.2, 1.2);
    }
    if (hash2(x, y, 3) < LOOK.flowers) {
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
      // Each cobble is a low dome: a shadow to the lower right, the stone, then its lit top.
      g.fillStyle = 'rgba(60, 48, 30, 0.35)';
      g.beginPath();
      g.roundRect(sx + 1.2, sy + 1.6, 13, 13, 4);
      g.fill();
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

  // Frozen river: pale ice with a few cracks and drifts of snow.
  function iceDetail(g, x, y, px, py) {
    g.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    g.lineWidth = 1;
    if (hash2(x, y, 180) < 0.45) {
      const ax = px + hash2(x, y, 181) * T, ay = py + hash2(x, y, 182) * T;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(ax + (hash2(x, y, 183) - 0.5) * 22, ay + (hash2(x, y, 184) - 0.5) * 16);
      g.lineTo(ax + (hash2(x, y, 185) - 0.5) * 30, ay + (hash2(x, y, 186) - 0.5) * 24);
      g.stroke();
    }
    if (hash2(x, y, 187) < 0.25) {
      g.fillStyle = 'rgba(250, 252, 255, 0.75)';
      g.beginPath();
      g.ellipse(px + hash2(x, y, 188) * T, py + hash2(x, y, 189) * T, 9, 4, 0, 0, TAU);
      g.fill();
    }
  }

  function lilyPad(g, x, y, px, py) {
    const lx = px + 8 + hash2(x, y, 91) * 16, ly = py + 8 + hash2(x, y, 92) * 16, a = hash2(x, y, 93) * TAU;
    g.fillStyle = 'rgba(16, 52, 64, 0.3)'; // the pad floats: its shadow lies on the water to the lower right
    g.beginPath();
    g.ellipse(lx + 1.5, ly + 2, 6, 5.4, 0, 0, TAU);
    g.fill();
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
    if (LOOK.ice) return; // frozen
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

  // A tree's look in the current season: pines stay green (snowy in winter); leafy trees follow the
  // palette, blossom in spring, carry apples in summer and autumn and stand bare in winter.
  function treeLook(n) {
    if (n.kind === 'apple') {
      const bare = !LOOK.leaves;
      return { pine: false, pal: bare ? null : LOOK.leaves[0], bare, snow: LOOK.snow > 0, apples: n.hp > 0, many: true, blossom: LOOK.blossom > 0 };
    }
    const h = hash2(n.x, n.y, 300);
    const pine = V.zoneAt(n.x, n.y) === 'north' ? h < 0.6 : h < 0.18;
    const snow = LOOK.snow > 0;
    if (pine) return { pine, pal: ['#2f5a37', '#3d7044', '#5a8f58'], snow };
    const sets = LOOK.leaves;
    const bare = !sets;
    // A few leafy trees turn early in late summer.
    const early = SEASON === 'summer' && hash2(n.x, n.y, 301) < 0.13;
    const pal = bare ? null : early ? VV.palette('autumn').leaves[0] : sets[Math.floor(hash2(n.x, n.y, 302) * sets.length)];
    const fruit = (SEASON === 'summer' || SEASON === 'autumn') && hash2(n.x, n.y, 303) < 0.15;
    return { pine, pal, bare, snow, apples: !bare && fruit, blossom: hash2(n.x, n.y, 304) < LOOK.blossom };
  }

  // Leafy crowns are clusters of lit balls; pines are stacked cones with a lit left face. Painted at the
  // node's foot (0, 0); the trunk and the crown are separate sprites so the crown can sway.
  const CROWN = [[0, -23, 14, 0], [-8, -27, 10, 1], [8, -26, 10, 1], [0, -35, 11, 1], [-5, -36, 6.5, 2], [-10, -28, 4.5, 2]];
  function paintCrown(g, n, L) {
    if (L.pine) {
      [[14, -6, -24], [12, -17, -35], [9, -28, -46]].forEach(([w, b, top], i) => {
        g.fillStyle = 'rgba(20, 40, 20, 0.28)'; // the tier above shades the one below
        g.beginPath(); g.ellipse(1, b + 1, w * 0.85, 2.6, 0, 0, TAU); g.fill();
        g.fillStyle = K.shade(L.pal[0], -0.12);
        g.beginPath(); g.moveTo(-w, b); g.lineTo(w, b); g.lineTo(0, top); g.closePath(); g.fill();
        g.fillStyle = i ? L.pal[1] : L.pal[0];
        g.beginPath(); g.moveTo(-w, b); g.lineTo(1, b + 0.5); g.lineTo(0, top); g.closePath(); g.fill();
        g.strokeStyle = L.pal[2]; g.lineWidth = 1.4; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-w + 2.5, b - 1); g.lineTo(-0.5, top + 2.5); g.stroke();
        if (L.snow) { // snow lies on the upper slopes of each tier
          g.fillStyle = '#f4f8fb';
          g.beginPath(); g.moveTo(-w * 0.55, b - (b - top) * 0.45); g.lineTo(0, top); g.lineTo(w * 0.45, b - (b - top) * 0.5); g.lineTo(0, b - (b - top) * 0.62); g.closePath(); g.fill();
        }
      });
      return;
    }
    if (L.bare) { // winter: bare branches with a little snow on them
      g.strokeStyle = K.shade(WOOD.mid, -0.15); g.lineCap = 'round';
      for (const [x0, y0, x1, y1, w] of [[0, -18, 0, -40, 2.6], [0, -24, -10, -36, 1.8], [0, -27, 10, -38, 1.8], [-5, -31, -12, -42, 1.2], [5, -33, 9, -45, 1.2], [0, -34, -3, -46, 1.2]]) {
        g.lineWidth = w;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        if (L.snow) { g.fillStyle = '#f4f8fb'; g.beginPath(); g.ellipse((x0 + x1) / 2 - 0.5, (y0 + y1) / 2 - 1.2, 2.4, 1, 0, 0, TAU); g.fill(); }
      }
      return;
    }
    g.fillStyle = 'rgba(20, 36, 14, 0.3)';
    g.beginPath(); g.ellipse(1, -14, 12, 5, 0, 0, TAU); g.fill();
    for (const [dx, dy, r, c] of CROWN) K.sphere(g, dx, dy, r, L.pal[c], { gloss: false, shine: 0.3 });
    if (L.blossom) for (let k = 0; k < 9; k++) {
      g.fillStyle = k % 3 ? '#fbe3ec' : '#f2a7c3';
      g.beginPath(); g.arc(-12 + hash2(n.x, n.y, 330 + k) * 24, -42 + hash2(n.x, n.y, 340 + k) * 24, 1.7, 0, TAU); g.fill();
    }
    if (L.apples) for (let k = 0; k < (L.many ? 3 + n.hp * 3 : 4); k++) {
      K.sphere(g, -9 + hash2(n.x, n.y, 310 + k) * 18, -36 + hash2(n.x, n.y, 320 + k) * 17, 2.1, '#d2453a', { shine: 0.5 });
    }
  }
  function paintTrunk(g, pine) {
    const h = pine ? 9 : 19, rx = pine ? 2.6 : 3.2;
    g.fillStyle = K.shade(WOOD.mid, -0.3);
    g.beginPath(); g.ellipse(0, 0, rx + 2, 1.8, 0, 0, TAU); g.fill();
    K.cylinder(g, 0, -h, rx, h, WOOD.mid, { cap: false, ry: 1.3 });
  }

  function drawTree(n, cx, by, sway) {
    const pine = treeLook(n).pine;
    castShadow(cx, by, 13, pine ? 36 : 34);
    blit(nodeSprite('tree', 'trunk|' + (pine ? 1 : 0), (g) => paintTrunk(g, pine)), cx, by);
    seasonal('tree', `crown|${n.x},${n.y}|${n.kind === 'apple' ? n.hp : ''}`, (g) => paintCrown(g, n, treeLook(n)), cx + sway, by);
  }

  function drawStump(n, cx, by) {
    castShadow(cx, by, 8, 12, 0.26);
    K.cylinder(ctx, cx, by - 7, 6, 6, WOOD.mid, { capColor: LOOK.snow ? '#eef3f7' : WOOD.pale, ry: 3 });
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

  // A boulder: a dark base in its own shade, a lit body and a pale top facet, smaller as it is mined.
  function paintRock(g, n, k) {
    const seed = n.id * 7 + 1;
    const body = g.createRadialGradient(-5 * k, -16 * k, 1, 0, -9 * k, 15 * k);
    body.addColorStop(0, STONE.light);
    body.addColorStop(0.55, STONE.mid);
    body.addColorStop(1, STONE.dark);
    blob(1, -8 * k, 14 * k, 10 * k, seed, K.shade(STONE.dark, -0.15), 7, 0.18, g);
    blob(-1, -11 * k, 12 * k, 9.5 * k, seed + 1, body, 7, 0.18, g);
    blob(-3 * k, -16 * k, 6.5 * k, 4 * k, seed + 2, 'rgba(232, 228, 214, 0.55)', 7, 0.18, g);
    g.strokeStyle = 'rgba(70, 66, 58, 0.55)'; g.lineWidth = 1; g.lineCap = 'round';
    g.beginPath(); g.moveTo(2 * k, -14 * k); g.lineTo(5 * k, -7 * k); g.stroke();
    if (LOOK.snow) blob(-2 * k, -17 * k, 8 * k, 3.6 * k, seed + 3, '#f4f8fb', 7, 0.2, g);
    else if (hash2(n.x, n.y, 330) < 0.4) {
      g.fillStyle = 'rgba(110, 150, 70, 0.85)';
      g.beginPath(); g.ellipse(4 * k, -18 * k, 4 * k, 2 * k, 0, 0, TAU); g.fill();
    }
  }
  function drawRock(n, cx, by) {
    const k = 0.62 + 0.38 * (n.hp / V.NODE_KINDS.rock.hp);
    castShadow(cx, by - 1, 14 * k, 22 * k, 0.34);
    seasonal('rock', `rock|${n.x},${n.y}|${n.hp}`, (g) => paintRock(g, n, k), cx, by);
  }

  function drawPebbles(n, cx, by) {
    for (let k = 0; k < 4; k++) {
      const px = cx - 8 + hash2(n.x, n.y, 340 + k) * 16, py = by - 3 - hash2(n.x, n.y, 345 + k) * 8;
      ellipse(px + 1, py + 1, 2.8, 1.6, 'rgba(38, 48, 20, 0.2)');
      ellipse(px, py, 2.6, 1.8, k % 2 ? STONE.mid : STONE.light);
    }
    sprout(n, cx + 6, by - 2);
  }

  // A wet clay mound in a muddy pit: a glossy body lit from the top left.
  function paintClay(g, n, k) {
    g.fillStyle = '#7a5a3a';
    g.beginPath(); g.ellipse(0, -5, 15, 8, 0, 0, TAU); g.fill();
    g.fillStyle = '#5e4429';
    g.beginPath(); g.ellipse(1, -3.5, 13, 5.5, 0, 0, Math.PI); g.fill();
    const body = g.createRadialGradient(-4 * k, -11 * k, 1, 0, -7 * k, 13 * k);
    body.addColorStop(0, '#e19a68');
    body.addColorStop(0.5, '#c4703f');
    body.addColorStop(1, '#8f4a26');
    blob(0, -7 * k, 12 * k, 7 * k, n.id * 5 + 3, body, 8, 0.12, g);
    g.fillStyle = 'rgba(255, 235, 210, 0.55)';
    g.beginPath(); g.ellipse(-4 * k, -10.5 * k, 3.4 * k, 1.4 * k, -0.3, 0, TAU); g.fill();
  }
  function drawClay(n, cx, by) {
    const k = 0.6 + 0.4 * (n.hp / V.NODE_KINDS.clay.hp);
    K.shadow(ctx, cx + 2, by - 3, 16, 6, 0.22);
    blit(nodeSprite('clay', `clay|${n.x},${n.y}|${n.hp}`, (g) => paintClay(g, n, k)), cx, by);
  }

  function drawPit(n, cx, by) {
    ellipse(cx, by - 5, 13, 7, '#7a5a3a');
    ellipse(cx, by - 5, 10, 5, '#56402b');
    ellipse(cx + 1, by - 4, 5, 2.2, 'rgba(110, 170, 190, 0.75)');
    sprout(n, cx + 9, by - 2);
  }

  // A berry bush: a clump of lit leafy balls with glossy berries, paler and bare once picked.
  const BUSH = [[-7, -7, 7, 0], [7, -7, 7, 0], [0, -12, 8, 0], [-3, -6, 7, 1], [4, -5, 7, 1], [-3, -14, 3.5, 2], [5, -11, 2.8, 2]];
  const BUSH_LEAVES = { autumn: ['#8c5a2e', '#a8703a', '#c99350'] };
  function paintBush(g, n) {
    const full = n.hp > 0;
    if (LOOK.snow) { // winter: bare twigs under snow; berries left on them still show
      g.strokeStyle = K.shade(WOOD.mid, -0.1); g.lineWidth = 1.3; g.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI * (0.15 + 0.7 * (k / 6));
        g.beginPath(); g.moveTo(0, -2); g.lineTo(Math.cos(a) * 12, -2 + Math.sin(a) * 14); g.stroke();
      }
      for (const [dx, dy, r] of [[-5, -12, 6], [5, -11, 5.5], [0, -15, 5]]) K.sphere(g, dx, dy, r, '#eef3f7', { gloss: false, shine: 0.2 });
    } else {
      const leaves = BUSH_LEAVES[SEASON] || (full ? ['#4b7c38', '#5f9446', '#86b860'] : ['#5f8f45', '#77a456', '#9cc674']);
      for (const [dx, dy, r, c] of BUSH) K.sphere(g, dx, dy, r, leaves[c], { gloss: false, shine: 0.3 });
    }
    for (let k = 0; k < n.hp * 3; k++) {
      K.sphere(g, -9 + hash2(n.x, n.y, 350 + k) * 18, -15 + hash2(n.x, n.y, 370 + k) * 11, 2.2, '#c2335a', { shine: 0.6 });
    }
  }
  function drawBush(n, cx, by, sway) {
    castShadow(cx, by - 1, 13, 18, 0.3);
    seasonal('bush', `bush|${n.x},${n.y}|${n.hp}`, (g) => paintBush(g, n), cx + sway * 0.3, by);
    if (n.hp <= 0) sprout(n, cx + 9, by - 1);
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
    else if (n.kind === 'apple') drawTree(n, cx, by, sway);
    else if (n.kind === 'rock') (up ? drawRock(n, cx, by) : drawPebbles(n, cx, by));
    else if (n.kind === 'clay') (up ? drawClay(n, cx, by) : drawPit(n, cx, by));
    else drawBush(n, cx, by, sway);
    if (scale !== 1) ctx.restore();
  }

  // ───────────── Buildings ─────────────
  // Drawn by houses.js with this file's canvas helpers.
  const HS = window.VillageHouses.create({
    ctx, K, WOOD, STONE, GRASS, WINDOW, rect, line, circle, ellipse, poly, blob, emit, spark,
    state: () => S, time: () => time, sun: () => SUN, light, snow: () => LOOK.snow * FADE.t,
  });

  // Bridge over the river: flat, drawn under the walkers. Posts first, planks as payment arrives.
  // A plank bridge standing on posts: the deck has a top and a front edge, posts are lit round piles, and the
  // whole thing casts its shadow on the water to the lower right.
  function drawBridge() {
    const b = BOX.bridge, st = V.stage(S, 'bridge');
    const x0 = b.X - 12, x1 = b.X + b.Wp + 12, y0 = b.Y + 5, y1 = b.Y + b.Hp - 5;
    const posts = [];
    for (let x = x0 + 6; x < x1; x += 22) posts.push(x);
    const pile = (px, py, h) => {
      K.shadow(ctx, px + 3, py + 3, 5, 2.4, 0.4);
      K.cylinder(ctx, px, py - h, 2.6, h, WOOD.dark);
    };
    for (const px of posts) for (const py of [y0 + 1, y1 - 1]) pile(px, py, 7);
    if (st === 0) {
      ctx.save();
      ctx.translate(b.cx + 10, b.Y + b.Hp / 2 + 4);
      ctx.rotate(0.5 + Math.sin(time * 0.9) * 0.05);
      K.shadow(ctx, 3, 5, 16, 4, 0.35);
      K.block(ctx, -14, -3, 28, 6, 1.5, WOOD.mid);
      ctx.restore();
      return;
    }
    const k = st === 2 ? 1 : clamp(share('bridge'), 0.1, 0.95);
    const end = x0 + (x1 - x0) * k;
    const lift = 3; // the deck stands this high above the water: the front edge shows below the top
    K.shadow(ctx, (x0 + end) / 2 + 7, y1 + 6, (end - x0) / 2 + 4, 7, 0.38);
    rect(x0, y1 - lift, end - x0, lift + 3, WOOD.dark, 1.5);
    for (let x = x0, i = 0; x < end; x += 6, i++) {
      const w = Math.min(6, end - x) - 0.6;
      K.block(ctx, x, y0 - lift, w, y1 - y0, 1, i % 2 ? WOOD.light : '#a8774a', { top: 0.18, bottom: -0.12 });
    }
    for (let x = x0 + 3; x < end; x += 12) circle(x, y0 - lift + 3, 0.7, WOOD.dark);
    if (st === 2) {
      for (const py of [y0, y1]) {
        for (const px of posts) K.cylinder(ctx, px, py - lift - 9, 1.6, 9, WOOD.dark);
        K.block(ctx, x0, py - lift - 8, x1 - x0, 3.4, 1.5, WOOD.mid, { top: 0.35, bottom: -0.25 });
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
      light(cx + 6, by - 20, 40, '#ffc870', 0.9 + Math.sin(time * 2 + d.x) * 0.08);
    } else if (d.kind === 'bench') {
      shadow(cx + 2, by, 14, 3);
      rect(cx - 13, by - 8, 3, 8, WOOD.dark, 1);
      rect(cx + 10, by - 8, 3, 8, WOOD.dark, 1);
      rect(cx - 14, by - 10, 28, 4, WOOD.light, 1.5);
      rect(cx - 14, by - 18, 28, 3, WOOD.mid, 1.5);
      rect(cx - 12, by - 16, 2, 6, WOOD.mid, 1);
      rect(cx + 10, by - 16, 2, 6, WOOD.mid, 1);
    } else if (d.kind === 'swing') {
      castShadow(cx, by, 12, 26, 0.28);
      for (const px of [cx - 12, cx + 12]) K.cylinder(ctx, px, by - 30, 1.6, 30, WOOD.dark, { ry: 0.8 });
      K.block(ctx, cx - 14, by - 32, 28, 3, 1, WOOD.mid, { top: 0.35 });
      const a = Math.sin(time * 1.6 + d.x) * 0.25;
      ctx.save();
      ctx.translate(cx, by - 30);
      ctx.rotate(a);
      line(-5, 0, -5, 20, '#d8c79a', 1);
      line(5, 0, 5, 20, '#d8c79a', 1);
      K.block(ctx, -7, 19, 14, 3, 1, WOOD.light, { top: 0.4 });
      ctx.restore();
    } else if (d.kind === 'sweep') {
      // A well sweep: a tall post with a long pole, a bucket on one end and a weight on the other.
      castShadow(cx, by, 8, 30, 0.28);
      K.cylinder(ctx, cx, by - 28, 2, 28, WOOD.dark, { ry: 1 });
      const a = -0.35 + Math.sin(time * 0.7 + d.y) * 0.08;
      ctx.save();
      ctx.translate(cx, by - 27);
      ctx.rotate(a);
      line(-18, 0, 16, 0, WOOD.mid, 2.4);
      K.block(ctx, -21, -2, 5, 5, 1, STONE.dark);
      line(15, 0, 15, 12, '#d8c79a', 1);
      K.block(ctx, 12, 12, 6, 5, 1.5, WOOD.light);
      ctx.restore();
    } else if (d.kind === 'scarecrow') {
      castShadow(cx, by, 7, 22, 0.26);
      K.cylinder(ctx, cx, by - 22, 1.3, 22, WOOD.dark, { ry: 0.6 });
      line(cx - 10, by - 16, cx + 10, by - 16, WOOD.mid, 2);
      K.block(ctx, cx - 5, by - 18, 10, 9, 2, '#b5523b', { top: 0.2 });
      K.sphere(ctx, cx, by - 22, 3.6, '#e2c071', { gloss: false });
      ellipse(cx, by - 25, 6, 2, '#d4ad5a');
      K.block(ctx, cx - 3, by - 30, 6, 5, 2, '#c99a4e', { top: 0.3 });
    } else if (d.kind === 'arch') {
      castShadow(cx, by, 12, 24, 0.26);
      ctx.strokeStyle = WOOD.mid;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(cx - 11, by);
      ctx.lineTo(cx - 11, by - 18);
      ctx.quadraticCurveTo(cx, by - 32, cx + 11, by - 18);
      ctx.lineTo(cx + 11, by);
      ctx.stroke();
      for (let k = 0; k < 12; k++) {
        const u = k / 11, ang = Math.PI * (1 - u);
        const x = cx + Math.cos(ang) * 11, y = by - 18 - Math.sin(ang) * 10 + (k % 2) * 1.5;
        K.sphere(ctx, x, y, 2.2, FLOWERS[k % FLOWERS.length], { gloss: false });
      }
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
  const SWING = 0.3; // seconds of one tool swing

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
    castShadow(x, y, 6.5, 13, 0.3);
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
    // Body (lit from the left), apron, belt and arms.
    const torso = ctx.createLinearGradient(x - 6, 0, x + 6, 0);
    torso.addColorStop(0, K.shade(o.shirt, 0.18));
    torso.addColorStop(0.5, o.shirt);
    torso.addColorStop(1, K.shade(o.shirt, -0.28));
    rect(x - 6, y - 17 + bob, 12, 11, torso, 4);
    if (o.apron) rect(x - 4, y - 13 + bob, 8, 7, o.apron, 2);
    rect(x - 6, y - 9 + bob, 12, 1.6, 'rgba(60, 40, 20, 0.55)');
    const arm = { gloss: false, shine: 0.25 };
    if (!side) {
      K.sphere(ctx, x - 6.5, y - 12 + bob + sw * 1.2, 2.3, o.shirt, arm);
      if (!toolOut) K.sphere(ctx, x + 6.5, y - 12 + bob - sw * 1.2, 2.3, o.shirt, arm);
    } else if (!toolOut) K.sphere(ctx, x - flip * 1 + sw * 2.5, y - 11 + bob, 2.3, o.shirt, arm);
    // Head.
    const hy = y - 21 + bob;
    K.sphere(ctx, x, hy, 5.2, o.skin, { gloss: false, shine: 0.3 });
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
      ellipse(x + 0.8, hy - 2.2, 8.5, 3.2, 'rgba(40, 24, 8, 0.22)'); // the brim shades the face
      ellipse(x, hy - 3, 8.5, 3.2, '#e2c071');
      K.block(ctx, x - 4.5, hy - 9, 9, 6.5, 3, '#d4ad5a', { top: 0.3, bottom: -0.15 });
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
    castShadow(x, y, 5, 8, 0.28);
    ellipse(x - f * 3, y - 6, 2.5, 3, '#e4dccb');
    K.sphere(ctx, x, y - 5, 4.6, '#fbf6ec', { gloss: false, shine: 0.25 });
    K.sphere(ctx, x + f * 4, y - 9 + peck, 2.6, '#fbf6ec', { gloss: false, shine: 0.25 });
    circle(x + f * 4, y - 11.5 + peck, 1.2, '#d2453a');
    poly([x + f * 6.2, y - 9 + peck, x + f * 8, y - 8.3 + peck, x + f * 6.2, y - 7.8 + peck], '#e9a43c');
    circle(x + f * 4.6, y - 9.4 + peck, 0.5, '#3b2c1a');
    line(x - 1, y - 2, x - 1, y, '#e9a43c', 0.8);
    line(x + 1, y - 2, x + 1, y, '#e9a43c', 0.8);
  }

  // ───────────── Effects ─────────────
  const MAX_PARTS = 300; // the oldest go first when a big moment spawns more
  function part(x, y, o) {
    if (fx.parts.length >= MAX_PARTS) fx.parts.shift();
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
  // A soft round puff, lit on its upper left.
  const PUFF = () => K.bake('village-puff', 64, (c, z) => {
    const grd = c.createRadialGradient(z * 0.4, z * 0.38, 0, z / 2, z / 2, z / 2);
    grd.addColorStop(0, 'rgba(255, 252, 244, 1)');
    grd.addColorStop(0.45, 'rgba(236, 230, 218, 0.7)');
    grd.addColorStop(1, 'rgba(220, 214, 204, 0)');
    c.fillStyle = grd;
    c.fillRect(0, 0, z, z);
  });
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
    castShadow(x, y, 3, POLE_H * 0.8, 0.28);
    K.cylinder(ctx, x, y - POLE_H, 1.7, POLE_H, WOOD.mid, { ry: 0.8 });
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
      K.shadow(ctx, x + 4, y + 14, 3 * flap + 1, 1.2, 0.25); // flying above the ground
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
  // Effects for one event; playerX (tiles) decides which way a felled tree falls.
  function onEvent(e, playerX) {
    if (e.type === 'hit') {
      fx.shake.set(e.id, time);
      chips(e.kind, (e.x + 0.5) * T, (e.y + 0.7) * T);
    } else if (e.type === 'deplete') {
      const n = S.nodes[e.id];
      const cx = (e.x + 0.5) * T, by = (e.y + 1) * T - 5;
      fx.shake.delete(e.id);
      if (e.kind === 'tree') fx.falls.push({ node: n, cx, by, t: 0, dir: playerX * T < cx ? 1 : -1 });
      else chips(e.kind, cx, by - 4, 12);
    } else if (e.type === 'regrow') {
      fx.pop.set(e.id, time);
    } else if (e.type === 'built' || e.type === 'contribute') {
      const b = BOX[e.id];
      if (b) sparkle(b.cx, b.base - b.Hp / 2, e.type === 'built' ? 40 : 10);
    } else if (e.type === 'festival') {
      festBoost = 25;
      fwNext = 0.5;
    } else if (e.type === 'decor') {
      sparkle((e.x + 0.5) * T, (e.y + 0.5) * T, 14);
    } else if (e.type === 'plot') {
      const x = (e.x + 0.5) * T, y = (e.y + 0.6) * T;
      if (e.result === 'watered') for (let k = 0; k < 12; k++) part(x + (Math.random() - 0.5) * 18, y - 10, { vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 40, life: 0.6, size: 1.4, color: k % 2 ? '#9fd4f0' : '#e6f6ff' });
      else if (e.result === 'harvest') chips('bush', x, y, 10);
      else if (e.result === 'sown') chips('clay', x, y, 5);
    } else if (e.type === 'ripe') {
      sparkle((e.x + 0.5) * T, (e.y + 0.4) * T, 8, ['#fff3c4', '#b7e08a', '#ffffff']);
    } else if (e.type === 'bucket' && !e.full) {
      const b = BOX.well;
      for (let k = 0; k < 14; k++) part(b.cx + (Math.random() - 0.5) * 16, b.base - 26, { vx: (Math.random() - 0.5) * 50, vy: -40 - Math.random() * 40, life: 0.7, size: 1.5, color: '#bfe6f6' });
    }
  }

  // ───────────── Frame ─────────────
  // A new state (boot, reset, cloud load, another tab's save): effects tied to the old one start over.
  function setState(s) {
    S = s;
    fx.shake.clear(); fx.pop.clear(); fx.falls.length = 0;
    for (const h of hens) h.placed = false;
  }

  function update(dt) {
    time += dt;
    updateHens(dt);
    updateEffects(dt);
  }

  // people: [{ role, x, y (tiles, feet), face, phase, moving, swing, tool, holding, front? }]; LOOKS[role]
  // gives the clothes. `front` lifts one above another person on the same line (the player).
  // ───────────── Garden plots ─────────────
  // What grows on a plot, by its stage: rows of sprouts that grow with it, wet soil while watered, and a ripe
  // crop (cabbages, pumpkins or carrots, by plot) ready to pick.
  const CROPS = ['cabbage', 'pumpkin', 'carrot'];
  function drawPlot(i) {
    const pl = S.plots[i], at = V.PLOTS[i];
    const px = at.x * T, py = at.y * T;
    if (pl.water) {
      ctx.fillStyle = 'rgba(40, 24, 10, 0.35)';
      ctx.fillRect(px + 4, py + 4, T - 8, T - 8);
      if (Math.sin(time * 2 + i) > 0.6) circle(px + 10 + i * 3, py + 12, 1.2, 'rgba(220, 240, 255, 0.8)');
    }
    if (pl.stage === 'empty') return;
    const crop = CROPS[i % CROPS.length];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      const x = px + 9 + c * 14, y = py + 10 + r * 8;
      if (pl.stage === 'planted') {
        const k = 0.35 + 0.65 * pl.grow;
        line(x, y, x, y - 4 * k, '#4f8a3a', 1.2);
        ellipse(x - 2 * k, y - 4 * k, 2.4 * k, 1.2 * k, '#7bbd58');
        ellipse(x + 2 * k, y - 4.5 * k, 2.4 * k, 1.2 * k, '#6aab4a');
      } else if (crop === 'cabbage') {
        K.shadow(ctx, x + 1.5, y + 1, 5, 2, 0.3);
        K.sphere(ctx, x, y - 3, 4.6, '#8cc46a', { gloss: false, shine: 0.35 });
        K.sphere(ctx, x - 0.5, y - 3.5, 2.6, '#c6e6a2', { gloss: false });
      } else if (crop === 'pumpkin') {
        K.shadow(ctx, x + 1.5, y + 1, 5.5, 2, 0.3);
        K.sphere(ctx, x, y - 3, 4.8, '#e8892e', { gloss: false, shine: 0.4 });
        line(x, y - 7.5, x + 1, y - 9.5, '#4f7a33', 1.4);
      } else {
        circle(x, y - 1, 1.8, '#e2712e');
        for (const d of [-2, 0, 2]) line(x, y - 2, x + d, y - 7, '#5f9a3e', 1.3);
      }
    }
  }
  // A low wattle fence along the top and the bottom of the beds once the garden stands.
  const BEDS = (() => {
    const xs = V.PLOTS.map((p) => p.x), ys = V.PLOTS.map((p) => p.y);
    return { x0: Math.min(...xs) * T - 3, x1: (Math.max(...xs) + 1) * T + 3, y0: Math.min(...ys) * T - 1, y1: (Math.max(...ys) + 1) * T + 2 };
  })();
  function drawFence(y) {
    const { x0, x1 } = BEDS;
    for (let x = x0; x <= x1; x += 12) K.cylinder(ctx, x, y - 10, 1.4, 10, WOOD.mid, { ry: 0.7 });
    for (const h of [3.5, 7]) line(x0, y - h, x1, y - h, WOOD.light, 1.6);
  }

  // ───────────── Daylight ─────────────
  // The whole view is multiplied by the hour's tint, then windows, lanterns and fires glow on top.
  function drawNightLight() {
    if (SUN.shade > 0.005) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${SUN.tint[0]}, ${SUN.tint[1]}, ${SUN.tint[2]})`;
      ctx.fillRect(cam.x, cam.y, cw, ch);
      ctx.restore();
    }
    if (SUN.lights < 0.02) return;
    for (const l of lit) {
      if (l.x < cam.x - l.r || l.x > cam.x + cw + l.r || l.y < cam.y - l.r || l.y > cam.y + ch + l.r) continue;
      K.glow(ctx, l.x, l.y, l.r, l.color, SUN.lights * l.a);
    }
  }

  // Falling things that belong to the season, drifting across the view: snow in winter, leaves in autumn,
  // petals in spring.
  const WEATHER = { winter: { n: 70, size: 1.6, fall: 26, colors: ['#ffffff', '#eef4fa'] },
    autumn: { n: 18, size: 2.6, fall: 18, colors: ['#c9672f', '#e0a03d', '#a8452e'] },
    spring: { n: 12, size: 1.8, fall: 12, colors: ['#fbe3ec', '#f2a7c3'] } };
  function drawWeather() {
    const w = WEATHER[CLOCK.season];
    if (!w) return;
    const n = Math.round(w.n * FADE.t);
    for (let k = 0; k < n; k++) {
      const speed = w.fall * (0.7 + hash2(k, 4, 610) * 0.6);
      const x = cam.x + ((hash2(k, 1, 610) * cw + Math.sin(time * 0.8 + k) * 24 + time * 9) % cw + cw) % cw;
      const y = cam.y + ((hash2(k, 2, 610) * ch + time * speed) % ch + ch) % ch;
      ctx.fillStyle = w.colors[k % w.colors.length];
      ctx.beginPath();
      if (CLOCK.season === 'winter') ctx.arc(x, y, w.size * (0.6 + hash2(k, 3, 610) * 0.8), 0, TAU);
      else ctx.ellipse(x, y, w.size * 1.3, w.size * 0.6, time * 2 + k, 0, TAU);
      ctx.fill();
    }
  }

  // Fireflies over the meadow on warm nights.
  const FLY_N = 16;
  function drawFireflies() {
    const warm = CLOCK.season === 'summer' ? 1 : CLOCK.season === 'spring' ? 0.5 : 0;
    const a = warm * clamp((SUN.lights - 0.5) * 2, 0, 1);
    if (a <= 0) return;
    for (let k = 0; k < FLY_N * warm; k++) {
      const bx = hash2(k, 1, 600) * cw, by = hash2(k, 2, 600) * ch;
      const x = cam.x + ((bx + Math.sin(time * 0.3 + k) * 60 + time * 4) % cw + cw) % cw;
      const y = cam.y + by + Math.sin(time * 0.5 + k * 2) * 30;
      const blink = Math.max(0, Math.sin(time * (1.3 + hash2(k, 3, 600)) + k * 1.7));
      K.glow(ctx, x, y, 7, '#d9ff8a', a * blink);
    }
  }

  function draw(px, py, people) {
    CLOCK = V.clock(S.t);
    SUN = VV.sunAt(CLOCK.phase, CLOCK.season);
    const fade = VV.seasonFade(CLOCK);
    if (fade.from !== FADE.from || fade.to !== FADE.to || (fade.t < 1) !== (FADE.t < 1)) pruneChunks(fade.t < 1 ? [fade.from, fade.to] : [fade.to]);
    FADE = fade;
    usePalette(CLOCK.season);
    lit.length = 0;
    const target = VV.clampCamera(px * T, py * T, cw, ch, V.W * T, V.H * T);
    cam = { x: VV.snap(target.x, dpr), y: VV.snap(target.y, dpr) };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = GRASS.dark;
    ctx.fillRect(0, 0, cw, ch);
    ctx.translate(-cam.x, -cam.y);
    // Ground: cached chunks that touch the view.
    const size = CHUNK * T;
    for (let cy = Math.max(0, Math.floor(cam.y / size)); cy * size < Math.min(V.H * T, cam.y + ch); cy++) {
      for (let cx = Math.max(0, Math.floor(cam.x / size)); cx * size < Math.min(V.W * T, cam.x + cw); cx++) {
        if (FADE.t < 1) {
          ctx.drawImage(chunk(cx, cy, FADE.from), cx * size, cy * size, size, size);
          ctx.globalAlpha = FADE.t;
        }
        ctx.drawImage(chunk(cx, cy, FADE.to), cx * size, cy * size, size, size);
        ctx.globalAlpha = 1;
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
    V.PLOTS.forEach((p, i) => { if (inView(p.x, p.y)) items.push([(p.y + 1) * T - 6, drawPlot, i]); });
    if (S.built.garden.done && inView(V.PLOTS[0].x, V.PLOTS[0].y)) {
      items.push([BEDS.y0, drawFence, BEDS.y0]);
      items.push([BEDS.y1, drawFence, BEDS.y1]);
    }
    for (const p of people) items.push([p.y * T + 9 + (p.front ? 0.5 : 0), drawPeople, p]);
    if (S.built.barn.done) for (const h of hens) items.push([h.y, drawHen, h]);
    if (S.festival) for (const [x, y] of POLES) items.push([y, () => drawPole(x, y)]);
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
      ctx.globalAlpha = 0.5 * Math.min(1, s.life / s.max * 1.6) * Math.min(1, (s.max - s.life) * 3);
      ctx.drawImage(PUFF(), s.x - s.r * 1.6, s.y - s.r * 1.6, s.r * 3.2, s.r * 3.2);
    }
    ctx.globalAlpha = 1;
    drawWeather();
    drawNightLight();
    if (S.festival) drawGarlands();
    if (SUN.shade < 0.35) drawButterflies();
    drawFireflies();
    drawFireworks();
    if (SUN.shade < 0.5) drawCloudShadows();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (vignette) { ctx.fillStyle = vignette; ctx.fillRect(0, 0, cw, ch); }
  }

  function drawBuilding(id) {
    HS.draw(id, V.stage(S, id), BOX[id], share(id));
  }

  const drawPeople = (p) => drawPerson(p.x * T, p.y * T + 9, { ...LOOKS[p.role], ...p });

  window.VillageArt = {
    BOX, SWING, resize, setState, update, onEvent, chips, draw,
    get cam() { return cam; },
    get time() { return time; },
  };
})();
