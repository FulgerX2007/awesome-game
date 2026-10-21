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
  const screen = canvas.getContext('2d');
  let ctx = screen;             // where the drawing helpers paint: the screen, or a sprite being baked
  // sw×sh: the canvas in CSS px; cw×ch: the part of the world it shows (world px, sw / zoom).
  // dpr: device px per CSS px; zoom: CSS px per world px; R: device px per world px in cached images
  // (capped, so chunks and sprites stay small enough for phones).
  let sw = 0, sh = 0, cw = 0, ch = 0, dpr = 1, zoom = 1, R = 1;
  const MAX_RASTER = 2.5;
  let cam = { x: 0, y: 0 };
  let time = 0;               // animation clock, seconds (runs even when the world is idle)
  let SUN = VV.sunAt(0.4, 'spring'); // this frame's daylight (view.sunAt)
  let CLOCK = V.clock(0);
  const lit = [];             // lights met while drawing this frame: { x, y, r, color, a }
  const light = (x, y, r, color, a = 1) => lit.push({ x, y, r, color, a });
  let vignette = null, grade = null;


  // ───────────── Palette ─────────────
  // The ground and plant colours follow the season (view.palette); usePalette switches them. Sprites and
  // ground chunks are painted synchronously, so a paint can switch to another season and back.
  const FLOWERS = ['#ffffff', '#ffd23f', '#ff8fb8', '#8fc2ff', '#ff9a4a', '#e04a5f'];
  const SAND0 = { edge: '#c99a58', main: '#ecca88', pebble: '#b58f58' };
  const WATER0 = { shallow: '#43bfe6', deep: '#1f8fd6' };
  const PATH0 = { edge: '#94592b', main: '#cf8e4e', speck: '#a5693a' };
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
  const SQUARE = { edge: '#8d867a', gap: '#7d8f52', stones: ['#c2b7a2', '#cdc3ae', '#b4a994', '#bfb39c', '#a99f8c', '#c8bfae'] };
  const WOOD = { dark: '#6e4a2b', mid: '#8b5e36', light: '#b3834f', pale: '#d2a86c' };
  const STONE = { dark: '#716e67', mid: '#9c988f', light: '#c8c4ba' };
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
    sw = Math.max(1, Math.round(r.width));
    sh = Math.max(1, Math.round(r.height));
    const fit = VV.fitCanvas(sw, sh, window.devicePixelRatio || 1);
    dpr = fit.ratio;
    zoom = VV.zoomFor(sw, sh);
    cw = sw / zoom;
    ch = sh / zoom;
    R = Math.min(dpr * zoom, MAX_RASTER);
    canvas.width = fit.w;
    canvas.height = fit.h;
    vignette = ctx.createRadialGradient(sw / 2, sh / 2, Math.min(sw, sh) * 0.35, sw / 2, sh / 2, Math.hypot(sw, sh) * 0.62);
    vignette.addColorStop(0, 'rgba(40, 30, 10, 0)');
    vignette.addColorStop(1, 'rgba(40, 30, 10, 0.2)');
    // A soft grade: warm light from the top left, a cooler shade towards the bottom right.
    grade = ctx.createLinearGradient(0, 0, sw, sh);
    grade.addColorStop(0, 'rgba(255, 236, 180, 0.07)');
    grade.addColorStop(0.5, 'rgba(255, 236, 180, 0)');
    grade.addColorStop(1, 'rgba(20, 50, 70, 0.07)');
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
    if (spriteRatio !== R) { sprites.clear(); spriteRatio = R; }
    let sp = sprites.get(key);
    if (sp) { sprites.delete(key); sprites.set(key, sp); return sp; }
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w * R));
    cv.height = Math.max(1, Math.ceil(h * R));
    const g = cv.getContext('2d');
    g.setTransform(R, 0, 0, R, ax * R, ay * R);
    paint(g);
    sp = { cv, w, h, ax, ay };
    sprites.set(key, sp);
    if (sprites.size > 400) sprites.delete(sprites.keys().next().value);
    return sp;
  }
  const blit = (sp, x, y) => ctx.drawImage(sp.cv, x - sp.ax, y - sp.ay, sp.w, sp.h);

  // ───────────── Painted sprites ─────────────
  // web/village/sprites holds PNGs baked by tools/village-sprites/generate.py (or painted by hand to the
  // same sizes): crowns, pines, bushes, shrubs, rocks, trunks and the meadow texture. sprites.json gives each
  // its world size, its anchor (the foot) and the palette colour it was painted for. Until they have loaded,
  // or if they can't be, the code-drawn art below stands in. Berries, blossom, apples and snow stay code.
  let PNG = null;
  (function loadPainted() {
    if (typeof fetch !== 'function' || typeof Image !== 'function') return;
    fetch('sprites/sprites.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((m) => Promise.all(Object.entries(m.sprites).map(([name, e]) => new Promise((ok, bad) => {
        const img = new Image();
        img.onload = () => ok([name, { ...e, img }]);
        img.onerror = () => bad(new Error(e.file));
        img.src = 'sprites/' + e.file;
      }))))
      .then((list) => {
        const idx = {};
        for (const [name, e] of list) {
          idx[name] = e;
          if (e.kind === 'crown' || e.kind === 'bush' || e.kind === 'shrub') idx[`${e.kind}|${e.mid}|${e.shape}`] = e;
          else if (e.kind === 'pine') idx[`pine|${e.snow}|${e.shape}`] = e;
          else if (e.kind === 'rock') idx[`rock|${e.shape}`] = e;
          else if (e.kind === 'trunk') idx[`trunk|${e.pine}`] = e;
          else if (e.kind === 'ruin') idx[`ruin|${e.size}|${e.shape}|${e.snow}`] = e;
        }
        PNG = idx;
        sprites.clear();
        chunks.clear();
      })
      .catch(() => { /* keep the code-drawn art */ });
  })();
  const png = (key) => (PNG && PNG[key]) || null;
  // A painted sprite at the painter's origin (the foot), optionally scaled around it.
  const put = (g, e, k = 1) => g.drawImage(e.img, -e.ax * k, -e.ay * k, e.w * k, e.h * k);
  // How big a node's art may be. Crowns and bushes spill over their neighbours for a lush look; the tap area
  // stays the smaller silhouette of view.NODE_TALL, so taps and gameplay don't change with the art.
  const ART_TALL = { tree: { hw: 36, up: 84 }, apple: { hw: 36, up: 84 }, bush: { hw: 24, up: 33 }, rock: { hw: 24, up: 35 } };
  const nodeSprite = (kind, key, paint) => {
    const t = ART_TALL[kind] || VV.NODE_TALL[kind], pad = 3;
    return sprite(key, t.hw * 2 + pad * 2, t.up + VV.NODE_FOOT + pad * 2, t.hw + pad, t.up + pad, paint);
  };
  // A node sprite that changes with the season: painted with that season's palette, and while a season
  // changes the old look stays under the new one as it fades in.
  function seasonal(kind, key, paint, x, y) {
    const one = (season) => nodeSprite(kind, `${key}|${season}`, (g) => withPalette(season, () => paint(g)));
    if (FADE.t < 1) {
      const a0 = ctx.globalAlpha;
      blit(one(FADE.from), x, y);
      ctx.globalAlpha = a0 * FADE.t;
      blit(one(FADE.to), x, y);
      ctx.globalAlpha = a0;
    } else blit(one(FADE.to), x, y);
  }

  // ───────────── Ground (cached in chunks) ─────────────
  // Terrain classes: g grass (ruin footprints too), s sand, w water (bridge site too), p path, q square.
  // The lake: k the old forest's floor (its trees stand on it), the clearing o (a path), the pier site j and the
  // fishing spots f (water); the pavilion Q stands on the water.
  const CLASS = { '.': 'g', ':': 's', '~': 'w', b: 'w', '=': 'p', '#': 'q', g: 'f', '^': 'h', t: 'p', '&': 'k', o: 'p', j: 'w', f: 'w', Q: 'w' };
  const inSquare = (x, y) => x >= SQ.x0 && x <= SQ.x1 && y >= SQ.y0 && y <= SQ.y1;
  // Ruin footprints sit on grass, except the well, which stands in the middle of the cobbled square.
  const terr = (x, y) => {
    x = clamp(x, 0, V.W - 1); y = clamp(y, 0, V.H - 1);
    return CLASS[V.MAP[y][x]] || (inSquare(x, y) ? 'q' : 'g');
  };
  const CHUNK = 16;
  const chunks = new Map(); // least recently used first
  const MAX_CHUNKS = 12;
  let chunkRatio = 0;

  // Chunks of seasons that are no longer on screen are dropped.
  function pruneChunks(keep) {
    for (const key of chunks.keys()) if (!keep.includes(key.slice(0, key.indexOf('|')))) chunks.delete(key);
  }

  function chunk(cx, cy, season) {
    if (chunkRatio !== R) { chunks.clear(); chunkRatio = R; }
    const key = season + '|' + cx + ',' + cy;
    let c = chunks.get(key);
    if (c) { chunks.delete(key); chunks.set(key, c); return c; }
    if (chunks.size >= MAX_CHUNKS) chunks.delete(chunks.keys().next().value);
    const size = CHUNK * T;
    c = document.createElement('canvas');
    c.width = c.height = Math.round(size * R);
    const g = c.getContext('2d');
    g.scale(R, R);
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
      const lip = o.lipRgb || '255, 252, 240';
      if (m & EDGE.S) band(x, y, EDGE.S, lw, `rgba(${lip}, ${la})`);
      if (m & EDGE.E) band(x, y, EDGE.E, lw * 0.8, `rgba(${lip}, ${la * 0.7})`);
      if (o.rim) for (const side of [EDGE.N, EDGE.E, EDGE.S, EDGE.W]) if (m & side) band(x, y, side, 1.6, `rgba(255, 255, 255, ${o.rim})`);
    }
    g.restore();
  }

  // Smooth value noise over world tile coordinates: the same field in every chunk, every frame and every visit.
  const smooth = (t) => t * t * (3 - 2 * t);
  function vnoise(x, y, salt) {
    const xi = Math.floor(x), yi = Math.floor(y), u = smooth(x - xi), v = smooth(y - yi);
    return lerp(lerp(hash2(xi, yi, salt), hash2(xi + 1, yi, salt), u), lerp(hash2(xi, yi + 1, salt), hash2(xi + 1, yi + 1, salt), u), v);
  }
  const fbm = (x, y, salt) => vnoise(x / 7, y / 7, salt) * 0.55 + vnoise(x / 3, y / 3, salt + 1) * 0.3 + vnoise(x, y, salt + 2) * 0.15;

  // The meadow's colour: drifts of darker, lusher grass and lighter sunny patches, computed on a coarse grid
  // (CELL cells a tile) and scaled up with smoothing, so there are no repeating circles or tile seams.
  const CELL = 4;
  const WARM = [226, 214, 112]; // a sunlit, slightly dry meadow
  function grassField(g, x0, y0, x1, y1) {
    const w = (x1 - x0 + 1) * CELL, h = (y1 - y0 + 1) * CELL;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    const img = c.createImageData(w, h);
    const D = K.parse(GRASS.dark), B = K.parse(GRASS.base), L = K.parse(GRASS.light);
    const warm = 0.22 * (1 - LOOK.snow);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const wx = x0 + (i + 0.5) / CELL, wy = y0 + (j + 0.5) / CELL;
      const t = clamp((fbm(wx, wy, 11) - 0.5) * 3.4 + (vnoise(wx * 1.8, wy * 1.8, 17) - 0.5) * 0.6, -1, 1);
      const A = t < 0 ? D : L, k = Math.abs(t);
      const sun = clamp((fbm(wx, wy, 23) - 0.6) * 3.5, 0, 1) * warm;
      const o = (j * w + i) * 4;
      for (let ch = 0; ch < 3; ch++) img.data[o + ch] = lerp(lerp(B[ch], A[ch], k), WARM[ch], sun);
      img.data[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cv, x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T);
  }

  // Soft mottling inside a terrain set (worn earth on the paths): noise-placed light and dark smudges.
  function mottle(g, x0, y0, x1, y1, inSet, dark, light, salt) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!inSet(x, y)) continue;
      for (let k = 0; k < 3; k++) {
        const mx = x * T + hash2(x, y, salt + k) * T, my = y * T + hash2(x, y, salt + 10 + k) * T;
        const r = 5 + hash2(x, y, salt + 20 + k) * 9;
        const grd = g.createRadialGradient(mx, my, 0, mx, my, r);
        const col = hash2(x, y, salt + 30 + k) < 0.5 ? dark : light;
        grd.addColorStop(0, col);
        grd.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
        g.fillStyle = grd;
        g.fillRect(mx - r, my - r, r * 2, r * 2);
      }
    }
  }

  function paintGround(g, x0, y0, x1, y1) {
    grassField(g, x0, y0, x1, y1);
    // The painted meadow texture (soft brush strokes and tufts) over the colour field, in world space so it
    // runs on seamlessly from chunk to chunk.
    const tex = png('grass');
    if (tex) {
      const pat = g.createPattern(tex.img, 'repeat');
      pat.setTransform(new DOMMatrix().scale(tex.w / tex.img.width));
      g.save();
      g.globalCompositeOperation = 'soft-light';
      g.globalAlpha = 0.75;
      g.fillStyle = pat;
      g.fillRect(x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T);
      g.restore();
    }
    const is = (c) => (x, y) => terr(x, y) === c;
    const sandy = (x, y) => terr(x, y) === 's' || terr(x, y) === 'w';
    const water = is('w');
    const deep = (x, y) => water(x, y) && water(x - 1, y) && water(x + 1, y) && water(x, y - 1) && water(x, y + 1);
    layer(g, x0, y0, x1, y1, sandy, SAND.edge, 0, 10);
    layer(g, x0, y0, x1, y1, sandy, SAND.main, 2, 9);
    // Wet sand darkens just above the waterline, then a pale band of shallows runs along every bank.
    layer(g, x0, y0, x1, y1, water, K.shade(SAND.edge, -0.08), 2.5, 12);
    layer(g, x0, y0, x1, y1, water, LOOK.ice ? K.shade(WATER.shallow, 0.2) : '#86dcef', 4.5, 12);
    layer(g, x0, y0, x1, y1, water, WATER.shallow, 8, 12);
    layer(g, x0, y0, x1, y1, deep, WATER.deep, 3, 14);
    if (!LOOK.ice) mottle(g, x0, y0, x1, y1, deep, 'rgba(12, 70, 140, 0.18)', 'rgba(150, 235, 255, 0.12)', 600);
    sunken(g, x0, y0, x1, y1, water, { inset: 4.5, radius: 12, shadow: [10, 0.3, '10, 60, 90'], lip: [4, 0.3], rim: LOOK.ice ? 0.3 : 0.75 });
    // The old forest's floor: deep shade under the crowns.
    layer(g, x0, y0, x1, y1, is('k'), K.shade(GRASS.base, -0.3), 0, 10);
    layer(g, x0, y0, x1, y1, is('k'), K.shade(GRASS.base, -0.42), 6, 10);
    layer(g, x0, y0, x1, y1, is('p'), PATH.edge, 0, 8);
    layer(g, x0, y0, x1, y1, is('p'), PATH.main, 2.5, 7);
    g.save();
    layerPath(g, x0, y0, x1, y1, is('p'), 2.5, 7);
    g.clip();
    mottle(g, x0, y0, x1, y1, is('p'), 'rgba(140, 85, 40, 0.22)', 'rgba(255, 222, 170, 0.22)', 620);
    g.restore();
    sunken(g, x0, y0, x1, y1, is('p'), { inset: 2.5, radius: 7, shadow: [6, 0.3, '90, 50, 20'], lip: [3, 0.25] });
    // The hill east of the village: a raised ridge, lit on its north-west slope and shaded to the south-east,
    // with rocks poking out of the turf.
    const hill = is('h');
    layer(g, x0, y0, x1, y1, hill, K.shade(GRASS.base, -0.2), 0, 10);
    // Lumpy mounds, each lit from the top left: together they read as a rounded ridge.
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!hill(x, y)) continue;
      for (let k = 0; k < 2; k++) {
        const mx = x * T + 6 + hash2(x, y, 193 + k) * 20, my = y * T + 4 + hash2(x, y, 195 + k) * 22, r = 15 + hash2(x, y, 197 + k) * 8;
        const grd = g.createRadialGradient(mx - r * 0.4, my - r * 0.45, r * 0.1, mx, my, r);
        grd.addColorStop(0, K.withAlpha(K.shade(GRASS.base, 0.14), 0.8));
        grd.addColorStop(0.55, K.withAlpha(K.shade(GRASS.base, -0.04), 0.5));
        grd.addColorStop(1, K.withAlpha(K.shade(GRASS.base, -0.2), 0));
        g.fillStyle = grd;
        g.beginPath(); g.ellipse(mx, my, r, r * 0.85, 0, 0, TAU); g.fill();
      }
    }
    sunken(g, x0, y0, x1, y1, hill, { inset: 0, radius: 10, shadow: [8, 0.22, '255, 250, 220'], lip: [14, 0.32], lipRgb: '30, 40, 20' });
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!hill(x, y) || hash2(x, y, 190) > 0.45) continue;
      const rx = x * T + 8 + hash2(x, y, 191) * 16, ry = y * T + 8 + hash2(x, y, 192) * 16;
      g.fillStyle = 'rgba(30, 40, 20, 0.3)';
      g.beginPath(); g.ellipse(rx + 2, ry + 2, 5, 3, 0, 0, TAU); g.fill();
      g.fillStyle = LOOK.snow ? '#f2f6f9' : STONE.mid;
      g.beginPath(); g.ellipse(rx, ry, 5, 3.6, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255, 255, 255, 0.35)';
      g.beginPath(); g.ellipse(rx - 1.5, ry - 1.2, 2.2, 1.2, 0, 0, TAU); g.fill();
    }
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
    layer(g, x0, y0, x1, y1, is('q'), LOOK.snow ? '#c9d2d8' : SQUARE.edge, 0, 6);
    layer(g, x0, y0, x1, y1, is('q'), LOOK.snow ? '#e3e9ed' : K.shade(GRASS.dark, -0.12), 1.5, 5);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = terr(x, y), px = x * T, py = y * T;
      if (c === 'g') grassDetail(g, x, y, px, py);
      else if (c === 'p') pathDetail(g, x, y, px, py); else if (c === 'q') cobbles(g, x, y, px, py);
      else if (c === 's') sandDetail(g, x, y, px, py, water);
      else if (c === 'w' && LOOK.ice) iceDetail(g, x, y, px, py);
      else if (c === 'w' && deep(x, y) && hash2(x, y, 90) < 0.1) lilyPad(g, x, y, px, py);
    }
  }

  // A clump of grass blades fanning out from (tx, ty): short curved strokes, lit ones on the left.
  function clump(g, tx, ty, n, len, seed, dark, lit, lean = 0) {
    g.fillStyle = 'rgba(28, 56, 10, 0.16)';
    g.beginPath(); g.ellipse(tx + 1, ty + 0.5, 1.5 + n, 1.3, 0, 0, TAU); g.fill();
    g.lineCap = 'round';
    g.lineWidth = 1.1;
    for (let b = 0; b < n; b++) {
      const a = lean + (n > 1 ? b / (n - 1) - 0.5 : 0) * 1.2 + (hash2(seed, b, 21) - 0.5) * 0.7;
      const l = len * (0.55 + hash2(seed, b, 22) * 0.7);
      const ex = tx + Math.sin(a) * l, ey = ty - Math.cos(a) * l;
      g.strokeStyle = a < lean ? lit : dark;
      g.beginPath(); g.moveTo(tx + (b - n / 2) * 0.6, ty); g.quadraticCurveTo(tx + Math.sin(a) * l * 0.25, ty - l * 0.6, ex, ey); g.stroke();
    }
  }

  // Grass, from far to near: clumps of blades (more in the lush drifts), blades leaning over the edges of
  // paths, sand and the square so those borders look ragged and natural, then leaves, snow and flowers.
  const OVER = { p: 1, q: 1, s: 1 };
  function grassDetail(g, x, y, px, py) {
    const lush = 1 - fbm(x + 0.5, y + 0.5, 11);
    const dark = K.withAlpha(K.mix(GRASS.dark, GRASS.tuft, 0.7), 0.8), mid = K.withAlpha(K.mix(GRASS.base, GRASS.tuft, 0.6), 0.85), lit = K.withAlpha(K.mix(GRASS.light, GRASS.tuftLight, 0.6), 0.85);
    // With the painted texture the blades are only an accent; without it they carry the grass.
    const n = png('grass') ? Math.floor(hash2(x, y, 1) * 1.6 + lush * 1.4) : 1 + Math.floor(hash2(x, y, 1) * 2 + lush * 3);
    for (let k = 0; k < n; k++) {
      const tx = px + 3 + hash2(x, y, 2 + k) * (T - 6), ty = py + 6 + hash2(x, y, 30 + k) * (T - 7);
      const seed = x * 131 + y * 7 + k;
      clump(g, tx, ty, 3 + Math.floor(hash2(seed, 1, 23) * 3), 4.5 + lush * 3.5, seed, hash2(seed, 2, 24) < 0.5 ? dark : mid, lit);
    }
    // Specks of light on single blades.
    g.fillStyle = K.withAlpha(GRASS.tuftLight, 0.7);
    for (let k = 0; k < 4; k++) g.fillRect(px + hash2(x, y, 60 + k) * T, py + hash2(x, y, 64 + k) * T, 1.2, 1.2);
    // Ragged borders: blades from this tile lean over a neighbouring path, beach or square.
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      if (!OVER[terr(x + dx, y + dy)]) continue;
      for (let k = 0; k < 4; k++) {
        const u = (k + 0.2 + hash2(x, y, 70 + k + dx * 3 + dy * 5) * 0.6) / 4;
        const ex = dx ? px + (dx > 0 ? T - 1 : 1) : px + u * T, ey = dy ? py + (dy > 0 ? T + 1 : 3) : py + u * T + 3;
        const seed = x * 977 + y * 31 + k + dx * 5 + dy * 11;
        clump(g, ex, ey, 3, 5 + hash2(seed, 3, 25) * 3, seed, mid, lit, dx * 0.6);
      }
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
    // Flowers grow in patches (a slow noise field), each patch mostly one colour.
    const patch = vnoise(x / 3.2, y / 3.2, 61);
    if (LOOK.flowers > 0 && patch > 1 - LOOK.flowers * 1.05 && hash2(x, y, 3) < 0.6) {
      const main = FLOWERS[Math.floor(vnoise(x / 5, y / 5, 62) * 7919) % FLOWERS.length];
      const n = 1 + Math.floor(hash2(x, y, 6) * 3.5);
      for (let k = 0; k < n; k++) {
        const ax = px + 4 + hash2(x, y, 11 + k) * (T - 8), ay = py + 4 + hash2(x, y, 15 + k) * (T - 8);
        const col = hash2(x, y, 19 + k) < 0.75 ? main : FLOWERS[Math.floor(hash2(x, y, 25 + k) * FLOWERS.length)];
        flower(g, ax, ay, 1.5 + hash2(x, y, 31 + k) * 0.7, col);
      }
    }
  }

  // A small flower seen from above: leaves, a soft shadow, five lit petals and a golden heart.
  function flower(g, x, y, r, col) {
    g.fillStyle = K.shade(GRASS.tuft, -0.1);
    g.beginPath(); g.ellipse(x - r * 1.6, y + r * 0.9, r * 1.2, r * 0.5, -0.5, 0, TAU); g.ellipse(x + r * 1.5, y + r * 1.1, r * 1.1, r * 0.45, 0.5, 0, TAU); g.fill();
    g.fillStyle = 'rgba(20, 50, 10, 0.25)';
    g.beginPath(); g.arc(x + 0.8, y + 1.1, r * 1.9, 0, TAU); g.fill();
    g.fillStyle = K.shade(col, -0.12);
    g.beginPath();
    for (let p = 0; p < 5; p++) g.arc(x + Math.cos(p * 1.2566 - 1.57) * r, y + Math.sin(p * 1.2566 - 1.57) * r, r * 0.85, 0, TAU);
    g.fill();
    g.fillStyle = col;
    g.beginPath();
    for (let p = 0; p < 5; p++) g.arc(x - 0.3 + Math.cos(p * 1.2566 - 1.57) * r * 0.9, y - 0.3 + Math.sin(p * 1.2566 - 1.57) * r * 0.9, r * 0.6, 0, TAU);
    g.fill();
    g.fillStyle = '#f0a81e';
    g.beginPath(); g.arc(x, y, r * 0.55, 0, TAU); g.fill();
  }

  // Pebbles and small stones pressed into the dirt of the paths, each with its own shadow.
  function pathDetail(g, x, y, px, py) {
    for (let k = 0; k < 5; k++) {
      const sx = px + 4 + hash2(x, y, 50 + k) * (T - 8), sy = py + 4 + hash2(x, y, 60 + k) * (T - 8);
      const r = 0.8 + hash2(x, y, 70 + k) ** 2 * 2.6;
      if (r > 1.6) {
        g.fillStyle = 'rgba(90, 52, 20, 0.35)';
        g.beginPath(); g.ellipse(sx + 0.8, sy + 0.9, r, r * 0.75, 0, 0, TAU); g.fill();
        g.fillStyle = hash2(x, y, 80 + k) < 0.5 ? '#c9b9a2' : '#b5a48c';
        g.beginPath(); g.ellipse(sx, sy, r, r * 0.75, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255, 250, 235, 0.55)';
        g.beginPath(); g.ellipse(sx - r * 0.3, sy - r * 0.3, r * 0.45, r * 0.3, -0.4, 0, TAU); g.fill();
      } else {
        g.fillStyle = k % 2 ? PATH.speck : 'rgba(255, 236, 200, 0.45)';
        g.beginPath(); g.arc(sx, sy, r, 0, TAU); g.fill();
      }
    }
  }

  // Flagstones of the square: mostly four to a tile, often a long pair or one big slab, set with grass and
  // moss growing in the joints. Each slab is an irregular quad with rounded corners, lit at the top left,
  // with a little thickness showing on its lower right.
  function slab(g, pts, r) {
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (i === 0) g.moveTo(mx, my);
      const c = pts[(i + 1) % pts.length], d = pts[(i + 2) % pts.length];
      g.arcTo(c[0], c[1], (c[0] + d[0]) / 2, (c[1] + d[1]) / 2, r);
    }
    g.closePath();
  }
  function cobbles(g, x, y, px, py) {
    const h = hash2(x, y, 99);
    const cells = h < 0.2 ? [[0, 0, 2, 2]] : h < 0.38 ? [[0, 0, 2, 1], [0, 1, 1, 1], [1, 1, 1, 1]]
      : h < 0.54 ? [[0, 0, 1, 2], [1, 0, 1, 1], [1, 1, 1, 1]] : h < 0.66 ? [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 2, 1]]
        : [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1]];
    const snow = LOOK.snow;
    cells.forEach(([i, j, w, hh], k) => {
      const x0 = px + i * 16 + 1.6, y0 = py + j * 16 + 1.6, x1 = px + (i + w) * 16 - 1.6, y1 = py + (j + hh) * 16 - 1.6;
      const jit = (q) => (hash2(x * 4 + i, y * 4 + j, 160 + q + k * 8) - 0.5) * 2.4;
      const pts = [[x0 + jit(0), y0 + jit(1)], [x1 + jit(2), y0 + jit(3)], [x1 + jit(4), y1 + jit(5)], [x0 + jit(6), y1 + jit(7)]];
      const rr = 2.5 + hash2(x, y, 115 + k) * 2;
      g.fillStyle = 'rgba(36, 40, 18, 0.5)';
      slab(g, pts.map(([a, b]) => [a + 1, b + 1.7]), rr); g.fill();
      const col = snow ? '#f1f5f8' : SQUARE.stones[Math.floor(hash2(x, y, 120 + k) * SQUARE.stones.length)];
      const grd = g.createLinearGradient(x0, y0, x1, y1);
      grd.addColorStop(0, K.shade(col, 0.2));
      grd.addColorStop(0.5, col);
      grd.addColorStop(1, K.shade(col, -0.12));
      g.fillStyle = grd;
      slab(g, pts, rr); g.fill();
      g.save();
      g.clip();
      // Lit top edge and a few soft darker spots of weathering.
      g.strokeStyle = 'rgba(255, 252, 240, 0.45)';
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(pts[0][0] + rr, pts[0][1] + 0.6); g.lineTo(pts[1][0] - rr, pts[1][1] + 0.6); g.stroke();
      for (let q = 0; q < 3; q++) {
        g.fillStyle = 'rgba(110, 96, 72, 0.14)';
        g.beginPath(); g.ellipse(lerp(x0, x1, hash2(x, y, 140 + k * 3 + q)), lerp(y0, y1, hash2(x, y, 150 + k * 3 + q)), 3, 1.8, 0, 0, TAU); g.fill();
      }
      g.restore();
      if (snow) return;
      if (w + hh > 2 && hash2(x, y, 125 + k) < 0.3) { // a hairline crack across a big slab
        g.strokeStyle = 'rgba(80, 70, 52, 0.45)';
        g.lineWidth = 0.8;
        const cx0 = lerp(x0, x1, 0.3 + hash2(x, y, 126 + k) * 0.4);
        g.beginPath(); g.moveTo(cx0, y0 + 1); g.lineTo(cx0 - 3, lerp(y0, y1, 0.45)); g.lineTo(cx0 + 2, y1 - 1); g.stroke();
      }
      if (hash2(x, y, 127 + k) < 0.12) { // a patch of lichen
        g.fillStyle = 'rgba(140, 160, 80, 0.3)';
        g.beginPath(); g.ellipse(lerp(x0, x1, 0.7), lerp(y0, y1, 0.65), 2.6, 1.8, 0.3, 0, TAU); g.fill();
      }
    });
    if (snow) return;
    // Moss and a blade or two in the joints.
    g.fillStyle = K.withAlpha(K.shade(GRASS.base, 0.05), 0.9);
    for (let k = 0; k < 3; k++) {
      if (hash2(x, y, 130 + k) > 0.6) continue;
      const jx = px + (k === 1 ? 16 : hash2(x, y, 132 + k) * T), jy = py + (k === 1 ? hash2(x, y, 133 + k) * T : k ? 16 : 0.5);
      g.beginPath(); g.ellipse(jx, jy, k === 1 ? 1.3 : 3, k === 1 ? 3 : 1.3, 0, 0, TAU); g.fill();
    }
    if (hash2(x, y, 135) < 0.25) {
      const seed = x * 53 + y * 17;
      clump(g, px + 16, py + 16 + 2, 3, 3.5 + hash2(seed, 1, 26) * 2, seed, GRASS.tuft, GRASS.tuftLight);
    }
  }

  function sandDetail(g, x, y, px, py, water) {
    for (let k = 0; k < 4; k++) {
      g.fillStyle = k % 2 ? SAND.pebble : K.withAlpha(K.shade(SAND.main, 0.3), 0.8);
      g.beginPath();
      g.ellipse(px + 4 + hash2(x, y, 130 + k) * (T - 8), py + 4 + hash2(x, y, 135 + k) * (T - 8), 1.6, 1.1, 0, 0, TAU);
      g.fill();
    }
    const near = water(x - 1, y) || water(x + 1, y) || water(x, y - 1) || water(x, y + 1);
    // Rounded grey stones on the banks, half sunk in the sand, each with a soft shadow.
    if (hash2(x, y, 145) < (near ? 0.42 : 0.12)) {
      const n = 1 + Math.floor(hash2(x, y, 146) * 2.4);
      for (let k = 0; k < n; k++) {
        const sx = px + 6 + hash2(x, y, 147 + k) * (T - 12), sy = py + 6 + hash2(x, y, 150 + k) * (T - 12);
        const r = 2.4 + hash2(x, y, 153 + k) * 3.6;
        g.fillStyle = 'rgba(80, 60, 30, 0.3)';
        g.beginPath(); g.ellipse(sx + 1.4, sy + 1.6, r * 1.05, r * 0.7, 0, 0, TAU); g.fill();
        const grd = g.createRadialGradient(sx - r * 0.4, sy - r * 0.5, r * 0.1, sx, sy, r * 1.1);
        grd.addColorStop(0, LOOK.snow ? '#ffffff' : '#d8d6d0');
        grd.addColorStop(0.6, LOOK.snow ? '#e8eef2' : '#a9a69e');
        grd.addColorStop(1, LOOK.snow ? '#c9d3da' : '#7d7a72');
        blob(sx, sy, r, r * 0.78, x * 37 + y * 11 + k, grd, 7, 0.14, g);
      }
    }
    // Reeds and cattails along the water.
    if (near && hash2(x, y, 140) < 0.42 && !LOOK.snow) {
      const rx = px + 6 + hash2(x, y, 141) * (T - 12), ry = py + T - 6;
      g.fillStyle = 'rgba(40, 60, 20, 0.22)';
      g.beginPath(); g.ellipse(rx + 2, ry + 1, 7, 2.2, 0, 0, TAU); g.fill();
      g.lineCap = 'round';
      const n = 5 + Math.floor(hash2(x, y, 149) * 3);
      for (let k = 0; k < n; k++) {
        const dx = (k - (n - 1) / 2) * 2.1, hgt = 12 + hash2(x, y, 142 + k) * 10;
        g.strokeStyle = ['#3f7a2a', '#5f9a36', '#7fb546'][k % 3];
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(rx + dx * 0.6, ry);
        g.quadraticCurveTo(rx + dx * 1.2, ry - hgt / 2, rx + dx * 1.9, ry - hgt);
        g.stroke();
        if (k % 3 === 1) {
          g.fillStyle = '#6e4224';
          g.beginPath(); g.roundRect(rx + dx * 1.9 - 1.7, ry - hgt - 1, 3.4, 6.5, 1.7); g.fill();
          g.fillStyle = 'rgba(255, 220, 170, 0.35)';
          g.fillRect(rx + dx * 1.9 - 1, ry - hgt, 0.9, 4.5);
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
    for (const [r, col, dx] of [[6, '#3f8a34', 0], [5, '#62ad45', -0.6]]) {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(lx + dx, ly + dx);
      g.arc(lx + dx, ly + dx, r, a + 0.4, a + TAU - 0.1);
      g.closePath();
      g.fill();
    }
    if (hash2(x, y, 94) < 0.5) {
      g.fillStyle = '#f7c6d6';
      g.beginPath();
      g.arc(lx + 1, ly - 1, 2.2, 0, TAU);
      g.fill();
    }
  }

  // The water's surface over the baked ground: soft bands of light drifting with the current, short ripple
  // strokes, and glints that flash now and then. Cheap: a few strokes per visible water tile.
  function drawWater(r) {
    if (LOOK.ice) return; // frozen
    ctx.lineCap = 'round';
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      if (terr(x, y) !== 'w') continue;
      const vertical = terr(x, y - 1) === 'w' && terr(x, y + 1) === 'w' && !(terr(x - 1, y) === 'w' && terr(x + 1, y) === 'w');
      // A broad, faint band of light (one per tile, sliding along the flow).
      const hb = hash2(x, y, 230), pb = (hb * T + time * 6) % T;
      ctx.fillStyle = `rgba(190, 245, 255, ${(Math.sin((pb / T) * Math.PI) * 0.1).toFixed(3)})`;
      ctx.beginPath();
      if (vertical) ctx.ellipse(x * T + 8 + hb * 16, y * T + pb, 6, 3, 0, 0, TAU);
      else ctx.ellipse(x * T + T - pb, y * T + 8 + hb * 16, 3, 6, 0, 0, TAU);
      ctx.fill();
      for (let k = 0; k < 3; k++) {
        const h = hash2(x, y, 200 + k);
        const p = (h * T + time * (5 + h * 6)) % T;
        const across = 6 + hash2(x, y, 210 + k) * (T - 12);
        ctx.strokeStyle = `rgba(240, 252, 255, ${(Math.sin((p / T) * Math.PI) * (k === 2 ? 0.3 : 0.55)).toFixed(3)})`;
        ctx.lineWidth = k === 2 ? 1 : 1.5;
        const l = k === 2 ? 2.5 : 4.5;
        ctx.beginPath();
        if (vertical) {
          ctx.moveTo(x * T + across, y * T + p - l);
          ctx.quadraticCurveTo(x * T + across + 2, y * T + p, x * T + across, y * T + p + l);
        } else {
          const px = x * T + T - p;
          ctx.moveTo(px - l, y * T + across);
          ctx.quadraticCurveTo(px, y * T + across - 2, px + l, y * T + across);
        }
        ctx.stroke();
      }
      const tw = Math.sin(time * 1.7 + hash2(x, y, 220) * 40);
      if (tw > 0.9) {
        const gx = x * T + hash2(x, y, 221) * T, gy = y * T + hash2(x, y, 222) * T, z = (tw - 0.9) * 40;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath(); ctx.moveTo(gx - z, gy); ctx.lineTo(gx, gy - z * 0.3); ctx.lineTo(gx + z, gy); ctx.lineTo(gx, gy + z * 0.3); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(gx, gy - z * 0.6); ctx.lineTo(gx + z * 0.25, gy); ctx.lineTo(gx, gy + z * 0.6); ctx.lineTo(gx - z * 0.25, gy); ctx.closePath(); ctx.fill();
      }
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
    const pine = n.forest ? h < 0.7 : V.zoneAt(n.x, n.y) === 'north' ? h < 0.6 : h < 0.18;
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

  // Leafy crowns: a dark outline, then dark, mid and lit balls of foliage from the bottom up, each ball
  // carrying small leaf clumps (lit on its upper left, shaded on its lower right). Pines are stacked tiers
  // with ragged lower edges, lit on the left. Painted at the node's foot (0, 0); the trunk and the crown are
  // separate sprites so the crown can sway.
  const CROWN = [
    [-12, -27, 12, 0], [12, -27, 12, 0], [0, -23, 13, 0], [-18, -37, 10, 0], [18, -37, 10, 0],
    [-8, -38, 13, 1], [9, -40, 12.5, 1], [0, -31, 13, 1], [-15, -31, 9, 1], [15, -32, 9, 1],
    [-6, -49, 10, 2], [6, -51, 9, 2], [-13, -44, 7, 2], [2, -42, 9, 2],
  ];
  const PINE = [[18, -6, -28], [15.5, -18, -40], [12.5, -30, -52], [8.5, -42, -64]];
  function paintCrown(g, n, L) {
    const shape = Math.floor(hash2(n.x, n.y, 309) * 3);
    const painted = L.pine ? png(`pine|${L.snow ? 1 : 0}|${shape}`) : L.bare ? null : png(`crown|${L.pal[1]}|${shape}`);
    if (painted) {
      put(g, painted);
      if (!L.pine) crownExtras(g, n, L);
      return;
    }
    if (L.pine) {
      const outline = K.shade(L.pal[0], -0.5);
      const tier = (w, b, top, grow) => {
        g.beginPath();
        g.moveTo(-0.5, top - grow);
        for (let i = 0; i <= 8; i++) {
          const u = i / 8, x = lerp(-w - grow, w + grow, u);
          g.lineTo(x, b + grow + (i % 2 ? -3.2 : 0.6) + Math.sin(u * Math.PI) * 2);
        }
        g.closePath();
      };
      PINE.forEach(([w, b, top], i) => {
        const s = 0.92 + hash2(n.x, n.y, 305) * 0.18;
        w *= s; b *= s; top *= s;
        g.fillStyle = 'rgba(10, 30, 15, 0.35)'; // the tier above shades the one below
        g.beginPath(); g.ellipse(2, b + 2, w * 0.85, 3, 0, 0, TAU); g.fill();
        g.fillStyle = outline; tier(w, b, top, 1.2); g.fill();
        g.fillStyle = K.shade(L.pal[0], -0.15); tier(w, b, top, 0); g.fill();
        g.save(); tier(w, b, top, 0); g.clip();
        const lit = g.createLinearGradient(-w, 0, w * 0.4, 0);
        lit.addColorStop(0, i ? L.pal[2] : L.pal[1]);
        lit.addColorStop(1, K.withAlpha(L.pal[1], 0));
        g.fillStyle = lit;
        g.beginPath(); g.moveTo(-w - 2, b + 2); g.lineTo(0.5, b + 2); g.lineTo(0, top); g.closePath(); g.fill();
        g.strokeStyle = K.withAlpha(K.shade(L.pal[2], 0.25), 0.8); g.lineWidth = 1.1; g.lineCap = 'round';
        for (let k = 0; k < 4; k++) { // needle strokes
          const u = 0.2 + k * 0.17;
          g.beginPath(); g.moveTo(-w * (1 - u) * 0.9, b - (b - top) * u * 0.6); g.lineTo(-w * (1 - u) * 0.9 + 3, b - (b - top) * u * 0.6 - 2.5); g.stroke();
        }
        g.restore();
        if (L.snow) { // snow lies on the upper slopes of each tier
          g.fillStyle = '#f4f8fb';
          g.beginPath(); g.moveTo(-w * 0.55, b - (b - top) * 0.45); g.lineTo(0, top); g.lineTo(w * 0.45, b - (b - top) * 0.5); g.lineTo(0, b - (b - top) * 0.62); g.closePath(); g.fill();
        }
      });
      return;
    }
    if (L.bare) { // winter: bare branches with a little snow on them
      g.strokeStyle = K.shade(WOOD.mid, -0.15); g.lineCap = 'round';
      for (const [x0, y0, x1, y1, w] of [[0, -18, 0, -48, 3], [0, -26, -14, -42, 2], [0, -30, 14, -46, 2], [-7, -36, -16, -52, 1.3], [7, -40, 12, -56, 1.3], [0, -42, -4, -58, 1.3]]) {
        g.lineWidth = w;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        if (L.snow) { g.fillStyle = '#f4f8fb'; g.beginPath(); g.ellipse((x0 + x1) / 2 - 0.5, (y0 + y1) / 2 - 1.2, 2.6, 1.1, 0, 0, TAU); g.fill(); }
      }
      return;
    }
    const sz = 0.84 + hash2(n.x, n.y, 306) * 0.22, flip = hash2(n.x, n.y, 307) < 0.5 ? -1 : 1;
    const balls = CROWN.map(([dx, dy, r, c], i) => [dx * sz * flip + (hash2(n.x, i, 308) - 0.5) * 3, dy * sz - 4 * (1 - sz), r * sz, c]);
    // Shade of the crown on the trunk and an outline that gives the silhouette a crisp edge.
    g.fillStyle = 'rgba(16, 36, 10, 0.35)';
    g.beginPath(); g.ellipse(1, -15, 15 * sz, 5.5, 0, 0, TAU); g.fill();
    g.fillStyle = K.shade(L.pal[0], -0.5);
    g.beginPath();
    for (const [dx, dy, r] of balls) { g.moveTo(dx + r + 1.3, dy); g.arc(dx, dy, r + 1.3, 0, TAU); }
    g.fill();
    for (const [dx, dy, r, c] of balls) {
      K.sphere(g, dx, dy, r, L.pal[c], { gloss: false, shine: 0.22 });
      // Leaf clumps: lit scallops on the side towards the light, darker ones on the far side.
      for (let k = 0; k < 5; k++) {
        const h = hash2(n.x + k, n.y, (dx | 0) + 50);
        const a = -2.6 + k * 0.5 + (h - 0.5) * 0.5, d = r * (0.5 + h * 0.25);
        K.sphere(g, dx + Math.cos(a) * d, dy + Math.sin(a) * d, r * (0.2 + h * 0.12), K.shade(L.pal[Math.min(2, c + 1)], c === 2 ? 0.12 : 0), { gloss: false, shine: 0.3 });
      }
      if (c < 2) for (let k = 0; k < 3; k++) {
        const a = 0.35 + k * 0.5;
        g.fillStyle = K.withAlpha(K.shade(L.pal[0], -0.35), 0.45);
        g.beginPath(); g.arc(dx + Math.cos(a) * r * 0.7, dy + Math.sin(a) * r * 0.7, r * 0.26, 0, TAU); g.fill();
      }
    }
    crownExtras(g, n, L);
  }
  // Blossom and apples over a leafy crown (code-drawn or painted).
  function crownExtras(g, n, L) {
    if (L.blossom) for (let k = 0; k < 14; k++) {
      const bx = -18 + hash2(n.x, n.y, 330 + k) * 36, by = -58 + hash2(n.x, n.y, 340 + k) * 34;
      g.fillStyle = k % 3 ? '#fde8f0' : '#f5a3c4';
      g.beginPath(); g.arc(bx, by, 2, 0, TAU); g.fill();
      g.fillStyle = '#f7d36b';
      g.beginPath(); g.arc(bx, by, 0.6, 0, TAU); g.fill();
    }
    if (L.apples) for (let k = 0; k < (L.many ? 3 + n.hp * 3 : 4); k++) {
      K.sphere(g, -14 + hash2(n.x, n.y, 310 + k) * 28, -50 + hash2(n.x, n.y, 320 + k) * 26, 2.7, '#d9302c', { shine: 0.55 });
    }
  }
  function paintTrunk(g, pine) {
    const painted = png(`trunk|${pine ? 1 : 0}`);
    if (painted) { put(g, painted); return; }
    const h = pine ? 10 : 22, rx = pine ? 3 : 4;
    // Root flare: two small roots and a dark collar of earth.
    g.fillStyle = 'rgba(30, 20, 8, 0.4)';
    g.beginPath(); g.ellipse(0.5, 0.5, rx + 4, 2.4, 0, 0, TAU); g.fill();
    g.fillStyle = K.shade(WOOD.mid, -0.2);
    g.beginPath(); g.ellipse(-rx - 1, -0.5, 2.6, 1.4, 0.4, 0, TAU); g.ellipse(rx + 1, -0.3, 2.4, 1.3, -0.4, 0, TAU); g.fill();
    K.cylinder(g, 0, -h, rx, h, WOOD.mid, { cap: false, ry: 1.5 });
    g.strokeStyle = 'rgba(50, 30, 15, 0.35)'; g.lineWidth = 0.8; // bark
    for (const dx of [-1.6, 1.2]) { g.beginPath(); g.moveTo(dx, -2); g.lineTo(dx + 0.4, -h + 3); g.stroke(); }
  }

  // The player, this frame (CSS px, feet): a crown in front of the player fades so they are never lost.
  let PL = { x: -1e9, y: -1e9 };
  function drawTree(n, cx, by, sway) {
    const pine = treeLook(n).pine;
    K.shadow(ctx, cx + 2, by, 15, 5, 0.38 * SUN.shadow);
    castShadow(cx, by, pine ? 15 : 19, pine ? 50 : 46, 0.34);
    blit(nodeSprite('tree', 'trunk|' + (pine ? 1 : 0), (g) => paintTrunk(g, pine)), cx, by);
    const behind = PL.y < by - 2 && PL.y > by - 70 && Math.abs(PL.x - cx) < 26;
    if (behind) ctx.globalAlpha = 0.55;
    seasonal('tree', `crown|${n.x},${n.y}|${n.kind === 'apple' ? n.hp : ''}`, (g) => paintCrown(g, n, treeLook(n)), cx + sway, by);
    ctx.globalAlpha = 1;
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

  // A boulder: a dark outline and base in its own shade, a rounded lit body, a pale top facet and a smaller
  // stone leaning on it; smaller as it is mined.
  function paintRock(g, n, k) {
    const painted = png(`rock|${Math.floor(hash2(n.x, n.y, 331) * 4)}`);
    if (painted) {
      put(g, painted, k);
      if (LOOK.snow) blob(-2 * k * 1.2, -18 * k * 1.2, 9 * k * 1.2, 3.8 * k * 1.2, n.id * 7 + 4, '#f4f8fb', 7, 0.2, g);
      return;
    }
    const seed = n.id * 7 + 1;
    k *= 1.2;
    const body = g.createRadialGradient(-6 * k, -17 * k, 1, 0, -9 * k, 16 * k);
    body.addColorStop(0, '#e4e1d8');
    body.addColorStop(0.45, STONE.light);
    body.addColorStop(0.8, STONE.mid);
    body.addColorStop(1, STONE.dark);
    blob(1, -7.5 * k, 15 * k + 1.2, 10.5 * k + 1.2, seed, K.shade(STONE.dark, -0.45), 7, 0.16, g);
    blob(1, -7.5 * k, 15 * k, 10.5 * k, seed, K.shade(STONE.dark, -0.1), 7, 0.16, g);
    blob(-1, -10.5 * k, 13 * k, 10 * k, seed + 1, body, 7, 0.16, g);
    blob(-3.5 * k, -15.5 * k, 6.5 * k, 3.8 * k, seed + 2, 'rgba(250, 248, 240, 0.5)', 7, 0.2, g);
    // A smaller stone leaning on the boulder's right foot.
    const s2 = g.createRadialGradient(9 * k, -6 * k, 0.5, 11 * k, -3.5 * k, 6 * k);
    s2.addColorStop(0, STONE.light); s2.addColorStop(1, STONE.dark);
    blob(11 * k, -3.5 * k, 5.5 * k, 4 * k, seed + 5, s2, 6, 0.15, g);
    g.strokeStyle = 'rgba(60, 58, 52, 0.55)'; g.lineWidth = 1; g.lineCap = 'round';
    g.beginPath(); g.moveTo(2 * k, -15 * k); g.lineTo(4.5 * k, -10 * k); g.lineTo(3.5 * k, -5 * k); g.stroke();
    if (LOOK.snow) blob(-2 * k, -16 * k, 9 * k, 3.8 * k, seed + 3, '#f4f8fb', 7, 0.2, g);
    else if (hash2(n.x, n.y, 330) < 0.55) { // moss on the shaded top
      g.fillStyle = 'rgba(96, 150, 60, 0.85)';
      blob(5 * k, -17 * k, 4.5 * k, 2.2 * k, seed + 4, g.fillStyle, 6, 0.3, g);
      g.fillStyle = 'rgba(160, 205, 100, 0.7)';
      g.beginPath(); g.ellipse(4 * k, -17.6 * k, 2 * k, 0.9 * k, 0, 0, TAU); g.fill();
    }
  }
  function drawRock(n, cx, by) {
    const k = 0.62 + 0.38 * (n.hp / V.NODE_KINDS.rock.hp);
    K.shadow(ctx, cx + 2, by - 1, 17 * k, 5 * k, 0.4 * SUN.shadow);
    castShadow(cx, by - 1, 16 * k, 26 * k, 0.34);
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

  // A berry bush: an outlined clump of lit leafy balls with leaf scallops and glossy berries, paler and bare
  // once picked.
  const BUSH = [[-9, -8, 8.5, 0], [9, -8, 8.5, 0], [0, -6, 9.5, 0], [-5, -15, 8.5, 1], [6, -15, 8, 1], [-11, -14, 5.5, 1], [0, -20, 6.5, 2], [-6, -21, 4, 2]];
  const BUSH_LEAVES = { autumn: ['#8c5a2e', '#a8703a', '#c99350'] };
  function paintBush(g, n) {
    const full = n.hp > 0;
    if (LOOK.snow) { // winter: bare twigs under snow; berries left on them still show
      g.strokeStyle = K.shade(WOOD.mid, -0.1); g.lineWidth = 1.3; g.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI * (0.15 + 0.7 * (k / 6));
        g.beginPath(); g.moveTo(0, -2); g.lineTo(Math.cos(a) * 14, -2 + Math.sin(a) * 16); g.stroke();
      }
      for (const [dx, dy, r] of [[-6, -13, 7], [6, -12, 6.5], [0, -17, 6]]) K.sphere(g, dx, dy, r, '#eef3f7', { gloss: false, shine: 0.2 });
    } else {
      const leaves = BUSH_LEAVES[SEASON] || (full ? ['#2f7a2c', '#4b9a36', '#7cc64c'] : ['#4f8a3c', '#6aa54e', '#94c86c']);
      const painted = png(`bush|${leaves[1]}|${Math.floor(hash2(n.x, n.y, 332) * 3)}`);
      if (painted) put(g, painted);
      else {
      g.fillStyle = K.shade(leaves[0], -0.5);
      g.beginPath();
      for (const [dx, dy, r] of BUSH) { g.moveTo(dx + r + 1.2, dy); g.arc(dx, dy, r + 1.2, 0, TAU); }
      g.fill();
      for (const [dx, dy, r, c] of BUSH) {
        K.sphere(g, dx, dy, r, leaves[c], { gloss: false, shine: 0.25 });
        for (let k = 0; k < 4; k++) {
          const a = -2.5 + k * 0.5;
          K.sphere(g, dx + Math.cos(a) * r * 0.6, dy + Math.sin(a) * r * 0.6, r * 0.3, leaves[Math.min(2, c + 1)], { gloss: false, shine: 0.3 });
        }
      }
      }
    }
    for (let k = 0; k < n.hp * 3; k++) {
      const bx = -12 + hash2(n.x, n.y, 350 + k) * 24, by = -22 + hash2(n.x, n.y, 370 + k) * 15;
      g.fillStyle = 'rgba(40, 10, 10, 0.35)';
      g.beginPath(); g.arc(bx + 0.7, by + 0.9, 2.8, 0, TAU); g.fill();
      K.sphere(g, bx, by, 2.7, '#e0263f', { shine: 0.6 });
    }
  }
  function drawBush(n, cx, by, sway) {
    K.shadow(ctx, cx + 2, by - 1, 16, 4.5, 0.36 * SUN.shadow);
    castShadow(cx, by - 1, 15, 22, 0.3);
    seasonal('bush', `bush|${n.x},${n.y}|${n.hp}`, (g) => paintBush(g, n), cx + sway * 0.3, by);
    if (n.hp <= 0) sprout(n, cx + 9, by - 1);
  }

  function drawNode(n) {
    if (n.kind === 'shoal') return; // drawn flat on the water by drawShoals()
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

  // ───────────── Flora: low plants that are only decoration ─────────────
  // Shrubs, ferns, tall grass, mushrooms and little stones fill the meadow the way the resources alone can't.
  // They stand only on open grass away from paths, the square, water, beds, the map edge and the resources,
  // are low enough to walk through, and are not in the rules: taps and movement don't see them.
  let FLORA = [];
  // (paintFlora also knows 'fern'; at this scale ferns read as fans, so the meadow doesn't use them.)
  const FLORA_KINDS = ['shrub', 'tall', 'shrub', 'tall', 'mush', 'stones', 'tall', 'shrub', 'shrub', 'tall'];
  const CLOSED = new Set(['=', '#', '~', 'b', 't', 'o', 'j', 'f', 'Q', 'g', '^']);
  function plantFlora() {
    FLORA = [];
    const near = new Set();
    for (const n of S.nodes) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) near.add((n.x + dx) + ',' + (n.y + dy));
    const open = (x, y) => { const c = (V.MAP[y] || '')[x]; return c !== undefined && !CLOSED.has(c); };
    for (let y = 1; y < V.H - 1; y++) for (let x = 1; x < V.W - 1; x++) {
      if (V.MAP[y][x] !== '.' || near.has(x + ',' + y) || V.plotAt(x, y) >= 0) continue;
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!open(x + dx, y + dy)) { ok = false; break; }
      if (!ok) continue;
      const grove = vnoise(x / 4.5, y / 4.5, 91);
      if (hash2(x, y, 92) >= (grove > 0.6 ? 0.8 : grove > 0.48 ? 0.32 : 0.1)) continue;
      FLORA.push({
        x, y, kind: FLORA_KINDS[Math.floor(hash2(x, y, 93) * FLORA_KINDS.length)], v: Math.floor(hash2(x, y, 94) * 3),
        dx: (hash2(x, y, 95) - 0.5) * 14, dy: (hash2(x, y, 96) - 0.5) * 10,
      });
    }
  }
  // A sprite that follows the season, cross-faded while the season changes (like seasonal() for nodes).
  function seasonalSprite(key, w, h, ax, ay, paint, x, y) {
    const one = (season) => sprite(`${key}|${season}`, w, h, ax, ay, (g) => withPalette(season, () => paint(g)));
    if (FADE.t < 1) {
      blit(one(FADE.from), x, y);
      ctx.globalAlpha = FADE.t;
      blit(one(FADE.to), x, y);
      ctx.globalAlpha = 1;
    } else blit(one(FADE.to), x, y);
  }
  const FLORA_LEAVES = { autumn: ['#7d5a2a', '#a8763a', '#d3a14e'] };
  function paintFlora(g, kind, v) {
    const lv = LOOK.leaves ? LOOK.leaves[v % LOOK.leaves.length] : null;
    const leaves = FLORA_LEAVES[SEASON] || lv;
    if (kind === 'shrub') {
      const k0 = 1.2 + v * 0.12;
      const balls = [[-7, -5, 6], [6, -5, 6.5], [0, -4, 7], [-3, -10, 6], [4, -10, 5.5]].map(([x, y, r]) => [x * k0, y * k0, r * k0]);
      if (LOOK.snow) { for (const [x, y, r] of balls) K.sphere(g, x, y, r, '#eef3f7', { gloss: false, shine: 0.2 }); return; }
      const painted = png(`shrub|${leaves[1]}|${v}`);
      if (painted) put(g, painted);
      else {
      g.fillStyle = K.shade(leaves[0], -0.5);
      g.beginPath();
      for (const [x, y, r] of balls) { g.moveTo(x + r + 1, y); g.arc(x, y, r + 1, 0, TAU); }
      g.fill();
      balls.forEach(([x, y, r], i) => {
        K.sphere(g, x, y, r, leaves[i < 3 ? 0 : 1], { gloss: false, shine: 0.25 });
        for (let k = 0; k < 3; k++) { const a = -2.4 + k * 0.6; K.sphere(g, x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.32, leaves[i < 3 ? 1 : 2], { gloss: false, shine: 0.3 }); }
      });
      }
      if (v === 2 && LOOK.flowers > 0.1) for (let k = 0; k < 5; k++) { // a flowering shrub
        g.fillStyle = k % 2 ? '#fff4f8' : '#ffd23f';
        g.beginPath(); g.arc(-8 + hash2(k, v, 97) * 16, -13 + hash2(k, v, 98) * 9, 1.4, 0, TAU); g.fill();
      }
    } else if (kind === 'fern') {
      if (LOOK.snow) return;
      const col = leaves ? leaves[1] : '#5a8a3a', lit = leaves ? leaves[2] : '#8ab85a';
      g.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (k - 3) * 0.45 + (hash2(k, v, 99) - 0.5) * 0.2, l = 15 + hash2(k, v, 100) * 6;
        const ex = Math.cos(a) * l, ey = Math.sin(a) * l * 0.75 - 1;
        g.strokeStyle = K.shade(col, -0.2); g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, -1); g.quadraticCurveTo(ex * 0.5, ey * 0.7 - 3, ex, ey); g.stroke();
        for (let q = 1; q <= 5; q++) { // leaflets along the frond
          const u = q / 6, px = ex * u, py = ey * u - Math.sin(u * Math.PI) * 2.5, r = 3.4 * (1 - u * 0.55);
          g.fillStyle = K.shade(q % 2 ? lit : col, -0.05);
          g.beginPath(); g.ellipse(px, py, r, r * 0.45, a + 1.2, 0, TAU); g.ellipse(px, py, r, r * 0.45, a - 1.2, 0, TAU); g.fill();
        }
      }
    } else if (kind === 'tall') {
      const dry = !leaves || SEASON === 'autumn';
      const cols = LOOK.snow ? ['#b9a77a', '#d6c79a'] : dry ? ['#b59a52', '#d8bf72'] : [K.shade(GRASS.tuft, -0.1), GRASS.tuftLight];
      g.lineCap = 'round';
      const n = 9 + v * 2;
      for (let k = 0; k < n; k++) {
        const a = (k / (n - 1) - 0.5) * 1.1 + (hash2(k, v, 101) - 0.5) * 0.3, l = 11 + hash2(k, v, 102) * 8;
        const ex = Math.sin(a) * l, ey = -Math.cos(a) * l;
        g.strokeStyle = cols[k % 2]; g.lineWidth = 1.3;
        g.beginPath(); g.moveTo((k - n / 2) * 0.7, 0); g.quadraticCurveTo(ex * 0.3, ey * 0.6, ex, ey); g.stroke();
        if (k % 4 === 1) { // a seed head
          g.fillStyle = LOOK.snow ? '#ffffff' : '#e8d9a0';
          g.beginPath(); g.ellipse(ex, ey - 1.5, 1.2, 2.6, a, 0, TAU); g.fill();
        }
      }
    } else if (kind === 'mush') {
      if (LOOK.snow) return;
      for (let k = 0; k < 3; k++) {
        const x = -6 + k * 5.5 + (hash2(k, v, 103) - 0.5) * 2, h = 4 + hash2(k, v, 104) * 3, r = 2.6 + hash2(k, v, 105) * 1.6;
        g.fillStyle = '#efe6d2'; g.fillRect(x - 0.9, -h, 1.8, h);
        const cap = v === 1 ? '#a8673a' : '#d93a2f';
        K.sphere(g, x, -h, r, cap, { gloss: true, shine: 0.4 });
        g.fillStyle = K.shade(cap, -0.35);
        g.fillRect(x - r, -h, r * 2, 1);
        if (v !== 1) { g.fillStyle = '#fff'; for (const [dx, dy] of [[-1, -1.2], [1, -0.4], [0, -2]]) { g.beginPath(); g.arc(x + dx * r * 0.5, -h + dy * r * 0.4, 0.5, 0, TAU); g.fill(); } }
      }
    } else {
      for (let k = 0; k < 3; k++) {
        const x = -7 + k * 6 + (hash2(k, v, 106) - 0.5) * 3, r = 2.2 + hash2(k, v, 107) * 2.4, y = -r * 0.6;
        const grd = g.createRadialGradient(x - r * 0.4, y - r * 0.4, 0.3, x, y, r * 1.1);
        grd.addColorStop(0, '#dad7cf'); grd.addColorStop(0.6, '#a5a198'); grd.addColorStop(1, '#757169');
        blob(x, y, r, r * 0.75, k * 7 + v, grd, 6, 0.15, g);
        if (LOOK.snow) blob(x - 0.3, y - r * 0.4, r * 0.8, r * 0.35, k * 7 + v + 1, '#f4f8fb', 6, 0.2, g);
        else if (k === 1) { g.fillStyle = 'rgba(100, 150, 60, 0.8)'; g.beginPath(); g.ellipse(x + 0.5, y - r * 0.5, r * 0.5, r * 0.25, 0, 0, TAU); g.fill(); }
      }
    }
  }
  const FLORA_SIZE = { shrub: [23, 27], fern: [24, 22], tall: [16, 24], mush: [14, 12], stones: [14, 10] };
  function drawFlora(f) {
    const cx = (f.x + 0.5) * T + f.dx, by = (f.y + 1) * T - 6 + f.dy;
    const [hw, up] = FLORA_SIZE[f.kind];
    if (f.kind === 'shrub' || f.kind === 'tall') K.shadow(ctx, cx + 3, by, hw * 0.9, 3.4, 0.32 * SUN.shadow);
    else K.shadow(ctx, cx + 1.5, by, hw * 0.7, 2.4, 0.25 * SUN.shadow);
    const sway = f.kind === 'tall' || f.kind === 'fern' ? Math.sin(time * 1.3 + f.x * 0.7 + f.y) * 0.6 : 0;
    seasonalSprite(`flora|${f.kind}|${f.v}`, hw * 2 + 4, up + 6, hw + 2, up + 2, (g) => paintFlora(g, f.kind, f.v), cx + sway, by);
  }

  // ───────────── Buildings ─────────────
  // Drawn by houses.js with this file's canvas helpers.
  const HS = window.VillageHouses.create({
    ctx, K, WOOD, STONE, GRASS, WINDOW, rect, line, circle, ellipse, poly, blob, emit, spark,
    state: () => S, time: () => time, sun: () => SUN, light, snow: () => LOOK.snow * FADE.t,
    tex: (name) => png('mat-' + name),
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

  // The trail over the hill: blocked by fallen rocks and a log until the road is built, then a stone-edged
  // path. Flat, drawn under everything that stands.
  function drawRoad() {
    const b = BOX.road, st = V.stage(S, 'road');
    if (b.X > cam.x + cw || b.X + b.Wp < cam.x) return;
    const y = b.Y + b.Hp / 2;
    if (st === 2) {
      // Stones set along both edges of the trail.
      for (let i = 0, x = b.X - 6; x < b.X + b.Wp + 6; i++, x += 7 + hash2(i, 1, 720) * 6) {
        for (const [dy, salt] of [[-12, 721], [11, 722]]) {
          const r = 2.6 + hash2(i, salt, 723) * 2;
          blob(x + 1, y + dy + 1, r, r * 0.7, i * 7 + salt, 'rgba(30, 30, 20, 0.3)');
          blob(x, y + dy, r, r * 0.7, i * 7 + salt, hash2(i, salt, 724) < 0.5 ? STONE.mid : STONE.light);
        }
      }
      return;
    }
    const k = st === 1 ? 1 - share('road') : 1;
    for (let i = 0; i < 4; i++) {
      if (i / 4 >= k) continue;
      const x = b.X + 10 + i * 20, r = 8 + (i % 2) * 3;
      castShadow(x, y + 6, r, 12, 0.3);
      blob(x, y - 2, r, r * 0.75, 700 + i, STONE.mid);
      blob(x - 2, y - 5, r * 0.6, r * 0.4, 710 + i, STONE.light);
    }
    if (k > 0.5) {
      ctx.save();
      ctx.translate(b.X + b.Wp / 2, y + 4);
      ctx.rotate(-0.2);
      K.block(ctx, -b.Wp / 2, -3, b.Wp, 6, 3, WOOD.dark);
      ctx.restore();
    }
  }

  // ───────────── The lake ─────────────
  // The old forest: a tree on every '&' tile, mostly pines, nudged off the grid so the strip reads as woods.
  const FOREST = [];
  V.MAP.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '&') return;
    FOREST.push({ id: 9000 + FOREST.length, kind: 'tree', x, y, hp: 1, regrowAt: null, forest: true,
      dx: (hash2(x, y, 730) - 0.5) * 10, dy: (hash2(x, y, 731) - 0.5) * 6 });
  }));
  function drawForestTree(t) {
    drawTree(t, (t.x + 0.5) * T + t.dx, (t.y + 1) * T - 5 + t.dy, Math.sin(time * 0.9 + t.id) * 0.8);
  }

  // The clearing through the forest: brush and fallen trunks until the glade is cleared, then a path between
  // two rows of trimmed logs. Flat, drawn under everything that stands.
  function drawGlade() {
    const b = BOX.glade, st = V.stage(S, 'glade');
    if (b.Y > cam.y + ch || b.Y + b.Hp < cam.y) return;
    if (st === 2) {
      for (const x of [b.X - 2, b.X + b.Wp + 2]) {
        for (let y = b.Y + 4; y < b.Y + b.Hp - 4; y += 14) K.cylinder(ctx, x, y, 3.2, 10, WOOD.mid, { capColor: WOOD.pale, ry: 1.6 });
      }
      return;
    }
    const k = st === 1 ? 1 - share('glade') : 1;
    // Bushes in the gap.
    for (let i = 0; i < 6; i++) {
      if (i / 6 >= k) continue;
      const x = b.X + 12 + (i % 3) * 30 + hash2(i, 2, 740) * 8, y = b.Y + 14 + Math.floor(i / 3) * 28;
      castShadow(x, y + 6, 11, 14, 0.3);
      blob(x, y - 2, 12, 9, 741 + i, K.shade(GRASS.base, -0.15));
      blob(x - 3, y - 6, 7, 5, 751 + i, LOOK.snow ? '#eef3f7' : K.shade(GRASS.base, 0.12));
    }
    // Fallen trunks across the clearing.
    for (let i = 0; i < 2; i++) {
      if ((i + 0.5) / 2 > k + 0.25) continue;
      ctx.save();
      ctx.translate(b.X + b.Wp / 2, b.Y + 20 + i * 26);
      ctx.rotate(i ? 0.25 : -0.18);
      K.shadow(ctx, 3, 6, b.Wp / 2 + 6, 4, 0.32);
      K.block(ctx, -b.Wp / 2 - 6, -4, b.Wp + 12, 8, 4, WOOD.dark, { top: 0.25, bottom: -0.2 });
      circle(b.Wp / 2 + 5, 0, 3.4, WOOD.pale);
      ctx.restore();
    }
  }

  // The pier: piles in the water, then planks laid from the shore as payment arrives, with a post at each side.
  function drawPier() {
    const b = BOX.pier, st = V.stage(S, 'pier');
    if (b.Y > cam.y + ch || b.Y + b.Hp < cam.y) return;
    const x0 = b.X + 4, x1 = b.X + b.Wp - 4, y0 = b.Y - 6, y1 = b.Y + b.Hp + 4;
    const pile = (px, py, h) => {
      K.shadow(ctx, px + 3, py + 3, 4.5, 2.2, 0.4);
      K.cylinder(ctx, px, py - h, 2.6, h, WOOD.dark);
    };
    for (let py = y0 + 14; py < y1; py += 24) for (const px of [x0 + 1, x1 - 1]) pile(px, py, 6);
    if (st === 0) return;
    const k = st === 2 ? 1 : clamp(share('pier'), 0.1, 0.95);
    const end = y0 + (y1 - y0) * k;
    const lift = 3;
    K.shadow(ctx, (x0 + x1) / 2 + 7, (y0 + end) / 2 + 6, (x1 - x0) / 2 + 3, (end - y0) / 2 + 4, 0.34);
    rect(x0, y0 - lift + 2, x1 - x0, end - y0 + lift, WOOD.dark, 1.5);
    for (let y = y0, i = 0; y < end; y += 5.5, i++) {
      K.block(ctx, x0, y - lift, x1 - x0, Math.min(5, end - y) - 0.6, 1, i % 2 ? WOOD.light : '#a8774a', { top: 0.18, bottom: -0.12 });
    }
    if (st === 2) for (const px of [x0 - 1, x1 + 1]) K.cylinder(ctx, px, y1 - lift - 12, 1.8, 12, WOOD.dark, { capColor: WOOD.pale });
  }

  // Shoals: rings and fish shadows on the water while the shoal is full; in winter, a hole in the ice.
  // The bobber floats at the spot being fished and dips under on a bite. Flat, under everything that stands.
  const rings = []; // { x, y, t, r } splashes spreading on the water
  const ring = (x, y, r = 10) => rings.push({ x, y, t: time, r });
  let rodTip = null; // where the player's rod ends this frame (set by drawPerson), for the line
  function fishing() {
    const p = S.player;
    return p.fish && p.target && p.target.type === 'fish' ? p.fish : null;
  }
  function drawShoals(r) {
    for (const n of S.nodes) {
      if (n.kind !== 'shoal' || n.x < r.x0 - 1 || n.x > r.x1 + 1 || n.y < r.y0 - 1 || n.y > r.y1 + 1) continue;
      const cx = (n.x + 0.5) * T, cy = (n.y + 0.5) * T;
      if (LOOK.ice) {
        ellipse(cx, cy + 1, 9, 5.5, 'rgba(255, 255, 255, 0.9)');
        ellipse(cx, cy + 1.5, 7, 4, '#2e5f78');
        ellipse(cx - 2, cy + 0.5, 3, 1.2, 'rgba(255, 255, 255, 0.35)');
        continue;
      }
      if (n.hp <= 0) continue;
      for (let k = 0; k < 2; k++) {
        const ph = (time * 0.45 + k * 0.5 + hash2(n.x, n.y, 760)) % 1;
        ctx.strokeStyle = `rgba(235, 250, 255, ${(0.45 * (1 - ph)).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 3 + ph * 11, (3 + ph * 11) * 0.55, 0, 0, TAU);
        ctx.stroke();
      }
      for (let k = 0; k < n.hp; k++) {
        const a = time * (0.8 + k * 0.25) + k * 2.1 + n.id;
        const fx0 = cx + Math.cos(a) * 8, fy0 = cy + Math.sin(a) * 4.5;
        ctx.save();
        ctx.translate(fx0, fy0);
        ctx.rotate(a + Math.PI / 2);
        ellipse(0, 0, 4, 1.6, 'rgba(20, 50, 70, 0.35)');
        poly([-4, 0, -6.5, -1.6, -6.5, 1.6], 'rgba(20, 50, 70, 0.3)');
        ctx.restore();
      }
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const g = rings[i], a = (time - g.t) / 0.9;
      if (a >= 1) { rings.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(240, 252, 255, ${(0.7 * (1 - a)).toFixed(3)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, 2 + a * g.r, (2 + a * g.r) * 0.55, 0, 0, TAU);
      ctx.stroke();
    }
    const f = fishing();
    if (!f) return;
    const n = S.nodes[f.id];
    const bx = (n.x + 0.5) * T + 2, by = (n.y + 0.5) * T;
    const bite = f.phase === 'bite';
    const dip = bite ? 2.5 + Math.sin(time * 26) * 1.2 : Math.sin(time * 2.4) * 0.7;
    ellipse(bx, by + 2.5, 4, 1.8, 'rgba(20, 50, 70, 0.3)');
    if (!bite) circle(bx, by + dip - 1, 2.6, '#f4f4ee');
    circle(bx, by + dip - 3, 2.4, '#d6403a');
    circle(bx - 0.8, by + dip - 3.8, 0.8, 'rgba(255, 255, 255, 0.7)');
  }
  // The line from the rod's tip to the bobber, over the player.
  function drawFishLine() {
    const f = fishing();
    if (!f || !rodTip) return;
    const n = S.nodes[f.id];
    const bx = (n.x + 0.5) * T + 2, by = (n.y + 0.5) * T - 3;
    const sag = f.phase === 'bite' ? 2 : 8;
    ctx.strokeStyle = 'rgba(250, 250, 240, 0.75)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(rodTip.x, rodTip.y);
    ctx.quadraticCurveTo((rodTip.x + bx) / 2, Math.max(rodTip.y, by) + sag, bx, by);
    ctx.stroke();
  }
  // A fish leaps from the spot towards the player on a catch.
  const leaps = [];
  function drawLeaps() {
    for (let i = leaps.length - 1; i >= 0; i--) {
      const l = leaps[i], a = (time - l.t) / 0.55;
      if (a >= 1) { leaps.splice(i, 1); continue; }
      const x = lerp(l.x0, l.x1, a), y = lerp(l.y0, l.y1, a) - Math.sin(a * Math.PI) * 22;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((a - 0.5) * 2.4 * Math.sign(l.x1 - l.x0 || 1));
      ellipse(0, 0, 5, 2.4, '#6f9fb8');
      poly([-4.5, 0, -8, -2.6, -8, 2.6], '#558aa3');
      ellipse(0.5, 0.9, 3.4, 0.9, 'rgba(230, 245, 250, 0.7)');
      circle(3, -0.6, 0.7, '#1f2b33');
      ctx.restore();
    }
  }

  // ───────────── Decorations ─────────────
  // A decoration the player placed on a tile hides the flora there.
  const decorAt = (x, y) => S.decor.length > 0 && S.decor.some((d) => d.x === x && d.y === y);
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
  // The rod: a long thin switch with a reel; returns nothing, its tip is at (0, -ROD) in the hand's frame.
  const ROD = 30;
  function drawRod() {
    line(0, 2, 0, -ROD, WOOD.mid, 1.6);
    line(0, -ROD * 0.6, 0, -ROD, WOOD.light, 1);
    circle(1.6, -2, 2, '#8d8f86');
  }

  // A small villager seen from above at a tilt. (x, y) are the feet; o holds the look and the pose.
  function drawPerson(x, y, o) {
    const bob = o.moving ? -Math.abs(Math.sin(o.phase)) * 1.6 : Math.sin(time * 2 + x) * 0.3;
    const sw = o.moving ? Math.sin(o.phase) : 0;
    const side = o.face === 'left' || o.face === 'right';
    const flip = o.face === 'left' ? -1 : 1;
    K.shadow(ctx, x + 0.5, y, 7, 2.6, 0.4 * SUN.shadow);
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
    if (o.tool === 'rod') {
      // Held out over the water, towards the way the player faces; the tip is kept for the line.
      const ang = o.face === 'up' ? 0.15 : o.face === 'down' ? 2.6 : 0.95;
      ctx.save();
      ctx.translate(hand.x, hand.y);
      ctx.scale(flip, 1);
      ctx.rotate(ang);
      drawRod();
      ctx.restore();
      if (o.role === 'player') rodTip = { x: hand.x + Math.sin(ang) * ROD * flip, y: hand.y - Math.cos(ang) * ROD };
      circle(hand.x, hand.y, 2.2, o.skin);
      return;
    }
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
    beekeeper: { shirt: '#f0e6c8', pants: '#6b5a3a', skin: '#e8b98f', hat: 'straw', hair: '#5a3a20', apron: '#e2c26a' },
    gardener: { shirt: '#5f9446', pants: '#4a3d30', skin: '#f1c9a0', hat: 'scarf', hatColor: '#e8892e', hair: '#7a4a2a', apron: '#c9b28a' },
    fisher: { shirt: '#3d6a8a', pants: '#4a4238', skin: '#e8b98f', hat: 'cap', hatColor: '#2f4f5f', hair: '#6a4a2a', apron: '#7f8a5a' },
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

  const CHIPS = {
    tree: ['#c99a5e', '#8b5e36', '#7aae58'], rock: ['#bdb7a8', '#9d978a', '#fff3c4'], clay: ['#cf8452', '#b3643a'], bush: ['#c2335a', '#5f9446', '#7aae58'],
    apple: ['#d9473a', '#5f9446', '#7aae58'], shoal: ['#bfe6f6', '#e6f6ff', '#9fd4f0'],
  };
  function chips(kind, x, y, n = 6) {
    const cols = CHIPS[kind] || CHIPS.bush;
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
    updateLanterns(dt);
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
  let hwNext = 0, harvestBoost = 0; // the harvest festival's own burst over the hamlet
  // The lantern festival: paper lanterns rise from the pavilion (a burst after the festival, then now and then
  // at dusk and at night) and small ones float on the lake for good.
  let lanternBoost = 0, slNext = 0;
  const skyLanterns = [];
  const LAKE_WATER = [];
  V.MAP.forEach((row, y) => [...row].forEach((c, x) => { if (y > V.LAKE_Y + 4 && c === '~') LAKE_WATER.push({ x, y }); }));
  const FLOATERS = Array.from({ length: 16 }, (_, k) => LAKE_WATER[Math.floor(hash2(k, 3, 780) * LAKE_WATER.length)]);
  function updateLanterns(dt) {
    if (!S.lanternFestival) { skyLanterns.length = 0; return; }
    lanternBoost = Math.max(0, lanternBoost - dt);
    slNext -= dt;
    const evening = SUN.lights > 0.2;
    if (slNext <= 0 && (lanternBoost > 0 || evening)) {
      slNext = lanternBoost > 0 ? 0.25 + Math.random() * 0.3 : 2.5 + Math.random() * 3.5;
      const b = BOX.pavilion;
      skyLanterns.push({ x: b.cx + (Math.random() - 0.5) * b.Wp * 0.8, y: b.base - 30, vx: 4 + Math.random() * 6, vy: -16 - Math.random() * 10, life: 9, max: 9, k: Math.floor(Math.random() * 4) });
    }
    for (const l of skyLanterns) { l.x += (l.vx + Math.sin(time * 0.7 + l.k) * 4) * dt; l.y += l.vy * dt; l.life -= dt; }
    for (let i = skyLanterns.length - 1; i >= 0; i--) if (skyLanterns[i].life <= 0) skyLanterns.splice(i, 1);
  }
  const LANTERN_COLORS = ['#ff9f43', '#ff6b6b', '#ffd166', '#f78fb3'];
  function drawFloaters() {
    if (!S.lanternFestival) return;
    FLOATERS.forEach((t, k) => {
      if (!t) return;
      const x = (t.x + 0.5) * T + Math.sin(time * 0.3 + k) * 10, y = (t.y + 0.5) * T + Math.cos(time * 0.25 + k * 1.3) * 5;
      if (x < cam.x - 20 || x > cam.x + cw + 20 || y < cam.y - 20 || y > cam.y + ch + 20) return;
      ellipse(x + 2, y + 3, 5, 2, 'rgba(20, 40, 50, 0.3)');
      rect(x - 3.5, y - 6, 7, 7, LANTERN_COLORS[k % 4], 2);
      rect(x - 2, y - 4.5, 4, 3.5, 'rgba(255, 245, 210, 0.75)', 1);
      light(x, y - 3, 22, '#ffb35a', 0.85);
    });
  }
  function drawSkyLanterns() {
    for (const l of skyLanterns) {
      const a = Math.min(1, l.life / 2, (l.max - l.life) * 2);
      ctx.globalAlpha = a;
      rect(l.x - 3, l.y - 5, 6, 8, LANTERN_COLORS[l.k], [3, 3, 1.5, 1.5]);
      rect(l.x - 1.6, l.y - 3, 3.2, 3, 'rgba(255, 245, 210, 0.85)', 1);
      ctx.globalAlpha = 1;
      light(l.x, l.y - 1, 24, '#ffb35a', a);
    }
  }
  const FW_COLORS = ['#ff4d6d', '#ffd60a', '#4cc9f0', '#f72585', '#80ed99', '#ff9f1c'];
  function updateFireworks(dt) {
    if (S.harvestFestival && harvestBoost > 0) {
      harvestBoost = Math.max(0, harvestBoost - dt);
      hwNext -= dt;
      if (hwNext <= 0) {
        hwNext = 0.5 + Math.random() * 0.7;
        const h = BOX.harvest;
        fx.rockets.push({ x: h.X + Math.random() * h.Wp, y: h.base, vy: -230 - Math.random() * 60, color: ['#f2cf62', '#e8892e', '#8ee08a', '#c46ad8'][Math.floor(Math.random() * 4)] });
      }
    }
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
    } else if (e.type === 'harvest-festival') {
      harvestBoost = 30;
      hwNext = 0.3;
    } else if (e.type === 'lantern-festival') {
      lanternBoost = 30;
      slNext = 0.2;
    } else if (e.type === 'decor') {
      sparkle((e.x + 0.5) * T, (e.y + 0.5) * T, 14);
    } else if (e.type === 'plot') {
      const x = (e.x + 0.5) * T, y = (e.y + 0.6) * T;
      if (e.result === 'watered') for (let k = 0; k < 12; k++) part(x + (Math.random() - 0.5) * 18, y - 10, { vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 40, life: 0.6, size: 1.4, color: k % 2 ? '#9fd4f0' : '#e6f6ff' });
      else if (e.result === 'harvest') chips('bush', x, y, 10);
      else if (e.result === 'sown') chips('clay', x, y, 5);
    } else if (e.type === 'ripe') {
      sparkle((e.x + 0.5) * T, (e.y + 0.4) * T, 8, ['#fff3c4', '#b7e08a', '#ffffff']);
    } else if (e.type === 'cast' || e.type === 'escape' || e.type === 'early') {
      ring((e.x + 0.5) * T + 2, (e.y + 0.5) * T, e.type === 'cast' ? 8 : 12);
    } else if (e.type === 'bite') {
      ring((e.x + 0.5) * T + 2, (e.y + 0.5) * T, 14);
      chips('shoal', (e.x + 0.5) * T, (e.y + 0.8) * T, 4);
    } else if (e.type === 'catch') {
      const x = (e.x + 0.5) * T, y = (e.y + 0.5) * T;
      leaps.push({ t: time, x0: x, y0: y, x1: playerX * T, y1: S.player.y * T - 12 });
      ring(x, y, 16);
      chips('shoal', x, y + 6, 12);
    } else if (e.type === 'bucket' && !e.full) {
      const b = BOX.well;
      for (let k = 0; k < 14; k++) part(b.cx + (Math.random() - 0.5) * 16, b.base - 26, { vx: (Math.random() - 0.5) * 50, vy: -40 - Math.random() * 40, life: 0.7, size: 1.5, color: '#bfe6f6' });
    }
  }

  // ───────────── Frame ─────────────
  // A new state (boot, reset, cloud load, another tab's save): effects tied to the old one start over.
  function setState(s) {
    S = s;
    plantFlora();
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
    PL = { x: px * T, y: py * T + 9 };
    const target = VV.clampCamera(px * T, py * T, cw, ch, V.W * T, V.H * T);
    cam = { x: VV.snap(target.x, dpr * zoom), y: VV.snap(target.y, dpr * zoom) };
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
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
    drawRoad();
    drawGlade();
    drawPier();
    drawShoals(r);
    drawFloaters();
    // Everything that stands is drawn back to front by its base line.
    const wide = VV.visibleRange(cam, cw, ch, V.W, V.H, T, 3);
    const inView = (x, y) => x >= wide.x0 && x <= wide.x1 && y >= wide.y0 && y <= wide.y1;
    const items = [];
    for (const nd of S.nodes) if (inView(nd.x, nd.y)) items.push([(nd.y + 1) * T - 5, drawNode, nd]);
    for (const t of FOREST) if (inView(t.x, t.y)) items.push([(t.y + 1) * T - 5 + t.dy, drawForestTree, t]);
    for (const id of Object.keys(BOX)) {
      const b = BOX[id];
      if (VV.FLAT.has(id) || b.x0 + b.w < wide.x0 || b.x0 > wide.x1 || b.y0 + b.h < wide.y0 || b.y0 > wide.y1) continue;
      items.push([b.base, drawBuilding, id]);
    }
    for (const d of S.decor) if (inView(d.x, d.y)) items.push([(d.y + 1) * T - 4, drawDecor, d]);
    for (const f of FLORA) if (inView(f.x, f.y) && !decorAt(f.x, f.y)) items.push([(f.y + 1) * T - 6 + f.dy, drawFlora, f]);
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
    rodTip = null;
    for (const [, fn, arg] of items) fn(arg);
    drawFishLine();
    drawLeaps();
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
    drawSkyLanterns();
    if (SUN.shade < 0.5) drawCloudShadows();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (grade) { ctx.fillStyle = grade; ctx.fillRect(0, 0, sw, sh); }
    if (vignette) { ctx.fillStyle = vignette; ctx.fillRect(0, 0, sw, sh); }
  }

  // Paint with every helper (here and in houses.js) aimed at another canvas, e.g. a sprite being baked.
  function paintWith(g, fn) {
    const keep = ctx;
    ctx = g; HS.setCtx(g);
    try { fn(); } finally { ctx = keep; HS.setCtx(keep); }
  }

  // A painted ruin (tools/village-sprites) for this footprint's size, if there is one: a variant picked by
  // place, the snowy one in winter (cross-faded while the season changes). False if none has loaded.
  function paintedRuin(b, snowy) {
    const size = `${b.w}x${b.h}`;
    const v = Math.floor(hash2(b.x0, b.y0, 820) * 3);
    return png(`ruin|${size}|${v}|${snowy}`) || png(`ruin|${size}|0|${snowy}`);
  }
  function drawPaintedRuin(b) {
    const one = (season) => paintedRuin(b, VV.palette(season).snow > 0.5 ? 1 : 0);
    const to = one(FADE.to);
    if (!to) return false;
    const put = (e) => ctx.drawImage(e.img, b.X - e.ax, b.Y - e.ay, e.w, e.h);
    const from = FADE.t < 1 ? one(FADE.from) : null;
    if (from && from !== to) {
      put(from);
      ctx.globalAlpha = FADE.t;
      put(to);
      ctx.globalAlpha = 1;
    } else put(to);
    return true;
  }

  // Ruins don't move, so each is baked once into a sprite (per season and shadow strength) instead of
  // repainting its many stone blocks every frame.
  function drawBuilding(id) {
    const st = V.stage(S, id), b = BOX[id];
    if (st === 0 && id !== 'well' && id !== 'pavilion' && drawPaintedRuin(b)) return;
    if (st === 0 && id !== 'well' && id !== 'pavilion') {
      const ox = b.X - 24, oy = b.Y - 32;
      const sp = sprite(`ruin|${id}|${SEASON}|${Math.round(SUN.shadow * 4)}`, b.Wp + 56, b.Hp + 52, 0, 0, (g) => {
        g.translate(-ox, -oy);
        paintWith(g, () => HS.draw(id, 0, b, 0));
      });
      blit(sp, ox, oy);
      return;
    }
    HS.draw(id, st, b, share(id));
  }

  // People are drawn a little larger than their feet's footprint so they read well next to the big crowns;
  // the scale is around the feet, so where they stand (and collide) doesn't change.
  const PERSON_SCALE = 1.15;
  function drawPeople(p) {
    const x = p.x * T, y = p.y * T + 9;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(PERSON_SCALE, PERSON_SCALE);
    ctx.translate(-x, -y);
    drawPerson(x, y, { ...LOOKS[p.role], ...p });
    ctx.restore();
    if (p.role === 'player' && rodTip) rodTip = { x: x + (rodTip.x - x) * PERSON_SCALE, y: y + (rodTip.y - y) * PERSON_SCALE };
  }

  window.VillageArt = {
    BOX, SWING, resize, setState, update, onEvent, chips, draw,
    get cam() { return cam; },
    get zoom() { return zoom; },
    get time() { return time; },
  };
})();
