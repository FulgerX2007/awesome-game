// Долгая зима — pure client helpers: the camera that follows the hero over the tile map, world ↔ screen, the tile
// under a tap, the light sources for the night, markers for survivors off screen and the clock. No DOM; in the
// browser it reads window.WinterCore (loaded first), in Node it requires it.
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.WinterCore;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const MIN_TILES = 11;    // at least this many tiles across the shorter side

  // The camera for a viewport { w, h } (css px) centred on `focus` (tile coords), clamped to the map.
  // → { w, h, ts (px per tile), x0, y0 (the world point at the top-left corner) }
  function camera(vp, focus) {
    const w = Math.max(1, (vp && vp.w) || 640), h = Math.max(1, (vp && vp.h) || 360);
    const ts = clamp(Math.floor(Math.min(w, h) / MIN_TILES), 16, 40);
    const vw = w / ts, vh = h / ts;
    const fx = focus ? focus.x : C.W / 2, fy = focus ? focus.y : C.H / 2;
    const x0 = vw >= C.W ? (C.W - vw) / 2 : clamp(fx - vw / 2, 0, C.W - vw);
    const y0 = vh >= C.H ? (C.H - vh) / 2 : clamp(fy - vh / 2, 0, C.H - vh);
    return { w, h, ts, x0, y0, vw, vh };
  }

  const toScreen = (cam, x, y) => ({ x: (x - cam.x0) * cam.ts, y: (y - cam.y0) * cam.ts });
  const toWorld = (cam, sx, sy) => ({ x: cam.x0 + sx / cam.ts, y: cam.y0 + sy / cam.ts });
  // The tile under a screen point, or null outside the map.
  function tileAt(cam, sx, sy) {
    const p = toWorld(cam, sx, sy);
    const x = Math.floor(p.x), y = Math.floor(p.y);
    return C.inMap(x, y) ? { x, y } : null;
  }

  // The lights of the night: { x, y, r } in tiles (the fire, the stove, torches), only those burning.
  function lights(g) {
    const out = [];
    if (C.fireOn(g)) out.push({ x: C.SPOT.fire.x + 0.5, y: C.SPOT.fire.y + 0.5, r: C.FIRE.radius + 0.5 });
    if (C.stoveOn(g)) out.push({ x: C.HUT.x + 1.5, y: C.HUT.y + 0.5, r: 3 });
    for (const t of g.torches) out.push({ x: t.x + 0.5, y: t.y + 0.5, r: C.TORCH.radius });
    return out;
  }

  // How dark the night is (0 by day, up to 0.82 at midnight), fading in and out over 10 s.
  function darkness(g) {
    const t = C.timeOfDay(g);
    if (t < C.NIGHT_AT - 10) return 0;
    const k = t < C.NIGHT_AT ? (t - (C.NIGHT_AT - 10)) / 10 : t > C.DAY - 8 ? (C.DAY - t) / 8 : 1;
    return 0.82 * clamp(k, 0, 1);
  }

  // Markers on the screen edge pointing at things outside the view: { x, y, angle } in css px, inset by `pad`.
  function edgeMarker(cam, wx, wy, pad = 14) {
    const p = toScreen(cam, wx, wy);
    if (p.x >= 0 && p.y >= 0 && p.x <= cam.w && p.y <= cam.h) return null;
    const cx = cam.w / 2, cy = cam.h / 2;
    const dx = p.x - cx, dy = p.y - cy;
    const k = Math.min((cam.w / 2 - pad) / Math.max(1e-9, Math.abs(dx)), (cam.h / 2 - pad) / Math.max(1e-9, Math.abs(dy)));
    return { x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dy, dx) };
  }

  // "День 7 · 14:20": the hour of the day on a 6:00–24:00 clock (light from 6 to 22, night from 22 to 6).
  function clock(g) {
    const t = C.timeOfDay(g);
    const minutes = t < C.NIGHT_AT ? 6 * 60 + (t / C.NIGHT_AT) * 16 * 60 : 22 * 60 + ((t - C.NIGHT_AT) / (C.DAY - C.NIGHT_AT)) * 8 * 60;
    const m = Math.floor(minutes) % (24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  const api = { MIN_TILES, camera, toScreen, toWorld, tileAt, lights, darkness, edgeMarker, clock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WinterView = api;
})(typeof window !== 'undefined' ? window : globalThis);
