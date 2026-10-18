// Родник — pure client helpers (no DOM): camera, tile picking, canvas sizing, art hashing, HUD helpers.
// Works in the browser (window.VillageView) and in Node (module.exports) so it can be tested.
// Units: the camera and screen points are in CSS pixels; only fitCanvas deals with device pixels.
(function (root) {
  'use strict';
  const Core = typeof module === 'object' && module.exports ? require('./core.js') : root.Village;
  const TILE = 32;     // tile size in CSS pixels
  const STEP = Core.MAX_DT; // fixed simulation step, seconds: the size core.step splits by
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

  // ── HUD helpers ──

  // Whole stock for the HUD: plain up to 9 999, then a short "12.3k" form.
  function fmt(n) {
    n = Math.floor(Number(n) || 0);
    if (Math.abs(n) < 10000) return String(n);
    const k = n / 1000;
    return (Math.abs(k) < 100 ? k.toFixed(1).replace(/\.0$/, '') : String(Math.round(k))) + 'k';
  }

  // Signed rate (units per minute) for the small label next to a resource; '' when it's about zero.
  function fmtRate(perMin) {
    if (!Number.isFinite(perMin) || Math.abs(perMin) < 0.05) return '';
    const a = Math.abs(perMin);
    const v = a < 10 ? a.toFixed(1).replace(/\.0$/, '') : String(Math.round(a));
    return (perMin < 0 ? '−' : '+') + v;
  }

  // Whole hours, minutes and seconds of a duration (negative and junk give zeros).
  function splitDuration(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
  }

  // Automatic income right now, per minute, from core's rates() (the same rules as its produce()).
  // `full` lists resources whose producers are stopped by the storage limit.
  function income(s, core) {
    const { rate, full } = core.rates(s);
    for (const r of Object.keys(rate)) rate[r] *= 60;
    return { rate, full };
  }

  // What a tap (or the action key) on a tile means:
  //   { type: 'gather', node }  a standing node the player has a tool for
  //   { type: 'tool', tool }    a standing node that needs a tool the player doesn't have yet
  //   { type: 'plot', i }       a garden plot once the garden stands (walk up and tend it)
  //   { type: 'well' }          the restored well once the garden stands (walk up and fill the bucket)
  //   { type: 'ruin', id }      a ruin or a restored building (walk up and open its panel); plots before
  //                             the garden stands belong to the garden's ruin
  //   { type: 'walk' }          a walkable tile (also the restored bridge)
  //   { type: 'none' }          water, the map edge
  function tapAction(s, core, x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (core.tileAt(x, y) === null) return { type: 'none' };
    const n = core.nodeAt(s, x, y);
    if (n && n.hp > 0) {
      const tool = core.NODE_KINDS[n.kind].tool;
      return s.tools[tool] > 0 ? { type: 'gather', node: n.id } : { type: 'tool', tool };
    }
    const pi = core.plotAt(x, y);
    if (pi >= 0) return s.built.garden.done ? { type: 'plot', i: pi } : { type: 'ruin', id: 'garden' };
    const id = core.ruinAt(x, y);
    if (id === 'well' && s.built.well.done && s.built.garden.done) return { type: 'well' };
    if (id && !((id === 'bridge' || id === 'road') && s.built[id].done)) return { type: 'ruin', id };
    return core.isWalkable(s, x, y) ? { type: 'walk' } : { type: 'none' };
  }

  // ── 2.5D ground ──
  // Sides of a tile whose neighbour is outside a terrain set (bits N, E, S, W): where a sunken area such as
  // water or a path gets its bank shadow (north and west, away from the top-left light) or its lit lip (south, east).
  const EDGE = { N: 1, E: 2, S: 4, W: 8 };
  function edgeMask(inSet, x, y) {
    if (!inSet(x, y)) return 0;
    return (inSet(x, y - 1) ? 0 : EDGE.N) | (inSet(x + 1, y) ? 0 : EDGE.E)
      | (inSet(x, y + 1) ? 0 : EDGE.S) | (inSet(x - 1, y) ? 0 : EDGE.W);
  }

  // ── Daylight ──
  // How the frame is lit at a phase of the day (0..1, 0 = dawn; see core.clock) and in a season.
  //   tint    [r, g, b] multiplied over the frame (white = no change)
  //   shade   0..1 how dark the frame is (0 at noon); day-only things such as butterflies fade with it
  //   shadow  0..1 how dark cast shadows are (they fade at night)
  //   lights  0..1 how bright windows, lanterns and fires glow
  // Keyframes are blended linearly, and the last one equals the first, so the day wraps without a jump.
  const SUN_KEYS = [
    // phase, tint, shade, shadow, lights
    [0.00, [255, 196, 170], 0.42, 0.45, 0.7],  // dawn: pink and still dim
    [0.06, [255, 232, 205], 0.12, 0.85, 0.15],
    [0.16, [255, 255, 255], 0, 1, 0],          // full day
    [0.62, [255, 255, 255], 0, 1, 0],
    [0.72, [255, 214, 160], 0.14, 0.9, 0.1],   // golden hour
    [0.80, [178, 150, 205], 0.42, 0.5, 0.75],  // dusk
    [0.88, [96, 112, 178], 0.62, 0.25, 1],     // night
    [0.97, [96, 112, 178], 0.62, 0.25, 1],
    [1.00, [255, 196, 170], 0.42, 0.45, 0.7],
  ];
  // Seasons nudge the tint: a cooler winter, a warmer autumn.
  const SEASON_TINT = { spring: [0, 0, 0], summer: [4, 2, -6], autumn: [8, -2, -16], winter: [-14, -4, 12] };

  function sunAt(phase, season) {
    const p = ((Number(phase) || 0) % 1 + 1) % 1;
    let i = 0;
    while (i < SUN_KEYS.length - 2 && SUN_KEYS[i + 1][0] <= p) i++;
    const a = SUN_KEYS[i], b = SUN_KEYS[i + 1];
    const k = b[0] > a[0] ? clamp((p - a[0]) / (b[0] - a[0]), 0, 1) : 0;
    const nudge = SEASON_TINT[season] || SEASON_TINT.spring;
    const tint = [0, 1, 2].map((c) => Math.round(clamp(lerp(a[1][c], b[1][c], k) + nudge[c], 0, 255)));
    return { tint, shade: lerp(a[2], b[2], k), shadow: lerp(a[3], b[3], k), lights: lerp(a[4], b[4], k) };
  }

  // ── Seasons ──
  // The colours of the land in each season. art.js bakes the ground and the plants from these.
  //   grass, sand, path, water: the ground layers; ice: the river is frozen
  //   flowers: the share of grass tiles with flowers; leaves: crown colours (null = bare branches)
  //   blossom: the share of leafy trees in bloom; fallen: leaves lying on the grass; snow: 0..1 snow cover
  const SEASON_LOOKS = {
    spring: {
      grass: { base: '#8cbf5a', dark: '#77ab48', light: '#a9d475', tuft: '#5c9a3b', tuftLight: '#b5dc80' },
      flowers: 0.28, leaves: [['#4f8a3a', '#68a64a', '#92cc66'], ['#578f36', '#73ad45', '#9ad06a']], blossom: 0.35, fallen: 0, snow: 0,
    },
    summer: {
      grass: { base: '#82ad55', dark: '#6f9c47', light: '#9cc46b', tuft: '#5c8a3b', tuftLight: '#a9cf73' },
      flowers: 0.16, leaves: [['#3f6e33', '#548a3f', '#78ad55'], ['#466f2e', '#5e8f3a', '#86b356'], ['#3a6a3f', '#4f8650', '#72a868']], blossom: 0, fallen: 0, snow: 0,
    },
    autumn: {
      grass: { base: '#a3a65a', dark: '#8f9049', light: '#bfba6c', tuft: '#7e7c3c', tuftLight: '#cbbf73' },
      flowers: 0.04, leaves: [['#b8662e', '#d88a3a', '#efb75a'], ['#a8452e', '#c95e36', '#e98a52'], ['#b88a2e', '#d9a83a', '#f2cf62']], blossom: 0, fallen: 0.35, snow: 0,
    },
    winter: {
      grass: { base: '#e9eff3', dark: '#d3dde6', light: '#f8fbfd', tuft: '#a4b39f', tuftLight: '#c9d5dc' },
      sand: { edge: '#d6dde2', main: '#eef2f4', pebble: '#b9c3c8' },
      path: { edge: '#b3a58f', main: '#d6ccbc', speck: '#a5977f' },
      water: { shallow: '#cfe6ee', deep: '#a9cfdd' }, ice: true,
      flowers: 0, leaves: null, blossom: 0, fallen: 0, snow: 1,
    },
  };
  const palette = (season) => SEASON_LOOKS[season] || SEASON_LOOKS.spring;

  // The change from the last season to this one is shown over the first day of a season: t goes 0 → 1.
  // The game's very first season has nothing to change from.
  const SEASON_NAMES = Object.keys(SEASON_LOOKS);
  function seasonFade(c) {
    const i = SEASON_NAMES.indexOf(c.season);
    const from = SEASON_NAMES[(i + SEASON_NAMES.length - 1) % SEASON_NAMES.length];
    const first = c.year === 0 && c.season === SEASON_NAMES[0];
    const t = first || c.seasonDay > 0 ? 1 : clamp(c.phase, 0, 1);
    return { from, to: c.season, t };
  }

  // ── 2.5D silhouettes ──
  // Standing things rise above their tile and cover the tiles behind them, so a tap on a tree crown or a roof
  // should pick that thing. Sizes are in CSS px around the base point the art draws from:
  // (x + 0.5) * TILE, (y + 1) * TILE - NODE_FOOT; `hw` is the half width, `up` the height above the base.
  const NODE_FOOT = 5;
  const NODE_TALL = {
    tree: { hw: 18, up: 48 },
    apple: { hw: 18, up: 48 },
    rock: { hw: 16, up: 24 },
    bush: { hw: 15, up: 21 },
    clay: { hw: 16, up: 15 },
  };
  // How far a building rises above its footprint, in tiles, by stage: 0 ruin, 1 scaffold, 2 restored.
  const HOUSE_RISE = [0.4, 1, 1.25];

  // The box (CSS px, world space) a standing node covers; `base` is its depth line (bigger is nearer).
  function tallBox(kind, x, y) {
    const t = NODE_TALL[kind];
    if (!t) return null;
    const cx = (x + 0.5) * TILE, by = (y + 1) * TILE - NODE_FOOT;
    return { x0: cx - t.hw, x1: cx + t.hw, y0: by - t.up, y1: by + NODE_FOOT, base: by };
  }

  // The box a building covers: its footprint plus how high it rises at this stage.
  function houseBox(tiles, stage) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of tiles) {
      x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x + 1); y1 = Math.max(y1, t.y + 1);
    }
    const rise = HOUSE_RISE[clamp(stage | 0, 0, 2)];
    return { x0: x0 * TILE, x1: x1 * TILE, y0: (y0 - rise) * TILE, y1: y1 * TILE, base: y1 * TILE };
  }

  // A tap at a world point (CSS px): the nearest standing node or building whose silhouette covers the point
  // wins, otherwise the tile under the point. Returns tapAction's result plus the tile it was taken from.
  function tapAt(s, core, wx, wy) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    let best = null;
    const consider = (box, x, y) => {
      if (!box || wx < box.x0 || wx >= box.x1 || wy < box.y0 || wy >= box.y1) return;
      if (!best || box.base >= best.base) best = { base: box.base, x, y };
    };
    for (const n of s.nodes) if (n.hp > 0) consider(tallBox(n.kind, n.x, n.y), n.x, n.y);
    for (const [id, tiles] of Object.entries(core.FOOTPRINTS)) {
      if (id === 'bridge' || id === 'road' || !tiles.length) continue; // the bridge and the road lie flat
      const hit = tiles.find((t) => t.x === tx && t.y === ty) || tiles[0];
      consider(houseBox(tiles, core.stage(s, id)), hit.x, hit.y);
    }
    const p = best || { x: tx, y: ty };
    return { ...tapAction(s, core, p.x, p.y), x: p.x, y: p.y };
  }

  // What the garden needs most right now, for the hint in the HUD: 'ripe' (something to pick), 'water'
  // (a sown plot is dry), 'sow' (an empty plot while buildings still want vegetables), or null.
  // Nothing is sown or watered in winter.
  function farmHint(s, core) {
    if (!s.built.garden || !s.built.garden.done) return null;
    if (s.plots.some((p) => p.stage === 'ripe')) return 'ripe';
    if (core.clock(s.t).season === 'winter') return null;
    if (s.plots.some((p) => p.stage === 'planted' && !p.water)) return 'water';
    let want = -s.res.vegetables;
    for (const id of core.BUILDING_IDS) if (!s.built[id].done) want += core.remaining(s, id).vegetables || 0;
    if (want > 0 && s.plots.some((p) => p.stage === 'empty')) return 'sow';
    return null;
  }

  const FACE_DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  // Tiles around the player for the action key: the one in front first, then the other sides, then corners.
  function frontTiles(px, py, face) {
    const tx = Math.floor(px), ty = Math.floor(py);
    const [fx, fy] = FACE_DIR[face] || FACE_DIR.down;
    const out = [{ x: tx + fx, y: ty + fy }];
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (dx === fx && dy === fy) continue;
      out.push({ x: tx + dx, y: ty + dy });
    }
    return out;
  }

  // The action for the key: the first tile next to the player with a node or a building on it, or null.
  function pickFront(s, core, px, py, face) {
    for (const p of frontTiles(px, py, face)) {
      const a = tapAction(s, core, p.x, p.y);
      if (['gather', 'tool', 'ruin', 'plot', 'well'].includes(a.type)) return { ...a, x: p.x, y: p.y };
    }
    return null;
  }

  // Distance (tiles) from a point to the nearest footprint tile's square; 0 inside one.
  function footprintDist(px, py, tiles) {
    let best = Infinity;
    for (const t of tiles) {
      const dx = Math.max(t.x - px, 0, px - (t.x + 1));
      const dy = Math.max(t.y - py, 0, py - (t.y + 1));
      best = Math.min(best, Math.hypot(dx, dy));
    }
    return best;
  }

  // The sound name (VillageAudio) for a core event, or null. The chapel's 'built' stays quiet:
  // the 'festival' event right after it plays the bigger tune.
  const HIT_SOUND = { tree: 'axe', rock: 'pick', clay: 'shovel', bush: 'berries', apple: 'berries' };
  function soundFor(e) {
    switch (e && e.type) {
      case 'hit': return HIT_SOUND[e.kind] || null;
      case 'contribute': case 'decor': return 'contribute';
      case 'plot': return e.result === 'harvest' ? 'berries' : e.result === 'sown' || e.result === 'watered' ? 'shovel' : null;
      case 'bucket': return e.full ? null : 'contribute';
      case 'built': return e.effect === 'festival' ? null : 'built';
      case 'tool': return 'tool';
      case 'festival': return 'festival';
      default: return null;
    }
  }

  const api = {
    TILE, STEP, MAX_DPR, clamp, lerp, clampCamera, screenToTile, visibleRange, fitCanvas, snap, hash2, facing,
    fmt, fmtRate, splitDuration, income, tapAction, frontTiles, pickFront, footprintDist, soundFor,
    sunAt, SEASON_LOOKS, palette, seasonFade, farmHint, EDGE, edgeMask, NODE_FOOT, NODE_TALL, HOUSE_RISE, tallBox, houseBox, tapAt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VillageView = api;
})(typeof window !== 'undefined' ? window : globalThis);
