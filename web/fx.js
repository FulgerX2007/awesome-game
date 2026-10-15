'use strict';
// Shared 2.5D art kit for the Canvas 2D games: one light, one material model, soft shadows, easing, particles,
// screen shake and chunky game text. Every game draws its own world; this file only gives them the same look.
// Works in the browser (window.Fx) and in Node (module.exports): nothing here touches the DOM until a sprite
// is baked, so the pure parts (colours, easing, particles, shake) are tested in Node.
//
// The light comes from the top left, slightly in front of the screen (LIGHT). Shapes are lit with gradients
// that follow it: a bright highlight towards the light, a darker core on the far side and a faint rim of
// bounced light. Contact shadows are soft ellipses under objects, never hard outlines.
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const LIGHT = { x: -0.55, y: -0.75 };  // unit-ish direction towards the light, in screen space
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ───────────── Easing ─────────────
  const ease = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
    outCubic: (t) => 1 - (1 - t) ** 3,
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    // Overshoots a little and settles: pop-ins, buttons, badges.
    outBack: (t) => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
    // Springs past the target a few times: rewards, landings.
    outElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
    // A squash-and-stretch pulse 0 → 1 → 0 with a soft start and end.
    pulse: (t) => Math.sin(clamp(t, 0, 1) * Math.PI),
  };

  // Moves `cur` towards `target` by a frame-rate independent fraction: `rate` is how much of the gap closes
  // per second (0.9 closes 90% each second). Used for camera follow and smoothed UI values.
  function damp(cur, target, rate, dt) {
    if (!(dt > 0)) return cur;
    return target + (cur - target) * Math.pow(1 - clamp(rate, 0, 0.99999), dt);
  }

  // ───────────── Colour ─────────────
  // Colours are '#rgb', '#rrggbb' or 'rgb(…)'/'rgba(…)'; results are 'rgb(…)' / 'rgba(…)' strings, cached.
  const parsed = new Map();
  function parse(c) {
    let v = parsed.get(c);
    if (v) return v;
    if (c[0] === '#') {
      let h = c.slice(1);
      if (h.length === 3) h = h.replace(/./g, (d) => d + d);
      const n = parseInt(h, 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    } else {
      const m = c.match(/[\d.]+/g) || [0, 0, 0];
      v = [+m[0], +m[1], +m[2], m[3] == null ? 1 : +m[3]];
    }
    parsed.set(c, v);
    return v;
  }
  const fmt = (r, g, b, a) => (a >= 1 ? `rgb(${r | 0}, ${g | 0}, ${b | 0})` : `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${+a.toFixed(3)})`);

  // Mixes two colours, t = 0 gives a, 1 gives b.
  function mix(a, b, t) {
    const p = parse(a), q = parse(b);
    return fmt(lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t), lerp(p[3], q[3], t));
  }

  // Lightens (amt > 0, towards a warm white) or darkens (amt < 0, towards a cool deep shade, never grey mud).
  const shades = new Map();
  function shade(c, amt) {
    const key = c + '|' + amt;
    let v = shades.get(key);
    if (v) return v;
    v = amt >= 0 ? mix(c, withAlpha('#fffaf0', parse(c)[3]), clamp(amt, 0, 1)) : mix(c, withAlpha('#120c24', parse(c)[3]), clamp(-amt, 0, 1));
    shades.set(key, v);
    return v;
  }

  function withAlpha(c, a) {
    const p = parse(c);
    return fmt(p[0], p[1], p[2], clamp(a, 0, 1));
  }

  // ───────────── Paths ─────────────
  function rrect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    if (g.roundRect) { g.roundRect(x, y, w, h, r); return; }
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // ───────────── Baked sprites ─────────────
  // Gradients that never change (glows, shadows) are baked once into small canvases and stretched: drawing
  // an image is far cheaper on phones than building a radial gradient every frame.
  const baked = new Map();
  function canvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const cv = root.document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }
  function bake(key, size, paint) {
    let cv = baked.get(key);
    if (!cv) {
      cv = canvas(size, size);
      paint(cv.getContext('2d'), size);
      baked.set(key, cv);
    }
    return cv;
  }
  function radialSprite(key, stops) {
    return bake(key, 64, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      for (const [o, c] of stops) grd.addColorStop(o, c);
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
    });
  }

  // A soft contact shadow: an ellipse centred at (x, y) with radii rx, ry, darkest in the middle.
  function shadow(g, x, y, rx, ry, alpha = 0.35) {
    if (rx <= 0 || ry <= 0 || alpha <= 0) return;
    const sp = radialSprite('shadow', [[0, 'rgba(8, 4, 20, 1)'], [0.45, 'rgba(8, 4, 20, .7)'], [1, 'rgba(8, 4, 20, 0)']]);
    const a = g.globalAlpha;
    g.globalAlpha = a * clamp(alpha, 0, 1);
    g.drawImage(sp, x - rx, y - ry, rx * 2, ry * 2);
    g.globalAlpha = a;
  }

  // An additive glow of a colour around (x, y). Cheap enough for dozens per frame.
  function glow(g, x, y, r, color, alpha = 1) {
    if (r <= 0 || alpha <= 0) return;
    const p = parse(color);
    const sp = radialSprite('glow|' + color, [[0, fmt(p[0], p[1], p[2], 0.9)], [0.35, fmt(p[0], p[1], p[2], 0.35)], [1, fmt(p[0], p[1], p[2], 0)]]);
    const a = g.globalAlpha, op = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = a * clamp(alpha, 0, 1);
    g.drawImage(sp, x - r, y - r, r * 2, r * 2);
    g.globalAlpha = a;
    g.globalCompositeOperation = op;
  }

  // Darkens the edges of a w×h area: draws the eye to the middle and gives every scene the same framing.
  function vignette(g, w, h, strength = 0.35) {
    const sp = bake('vignette', 128, (c, s) => {
      const grd = c.createRadialGradient(s / 2, s / 2, s * 0.32, s / 2, s / 2, s * 0.72);
      grd.addColorStop(0, 'rgba(10, 6, 24, 0)');
      grd.addColorStop(1, 'rgba(10, 6, 24, 1)');
      c.fillStyle = grd;
      c.fillRect(0, 0, s, s);
    });
    const a = g.globalAlpha;
    g.globalAlpha = a * strength;
    g.drawImage(sp, 0, 0, w, h);
    g.globalAlpha = a;
  }

  // ───────────── Lit shapes ─────────────
  // A lit sphere: highlight towards the light, a darker core on the far side and a soft rim of bounce light.
  function sphere(g, x, y, r, color, o = {}) {
    if (r <= 0) return;
    const hx = x + LIGHT.x * r * 0.45, hy = y + LIGHT.y * r * 0.45;
    const grd = g.createRadialGradient(hx, hy, r * 0.05, x, y, r);
    grd.addColorStop(0, shade(color, o.shine == null ? 0.55 : o.shine));
    grd.addColorStop(0.35, color);
    grd.addColorStop(0.85, shade(color, -0.42));
    grd.addColorStop(1, shade(color, -0.25));
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    if (o.gloss !== false) {
      g.fillStyle = 'rgba(255, 255, 255, .55)';
      g.beginPath(); g.ellipse(hx, hy - r * 0.05, r * 0.28, r * 0.18, -0.6, 0, TAU); g.fill();
    }
  }

  // A rounded box that reads as a solid object: vertical body gradient, a bright bevel on the top edge,
  // a darker band on the bottom edge and an optional glossy streak. (x, y) is its top-left corner.
  function block(g, x, y, w, h, r, color, o = {}) {
    if (w <= 0 || h <= 0) return;
    const grd = g.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, shade(color, o.top == null ? 0.22 : o.top));
    grd.addColorStop(0.5, color);
    grd.addColorStop(1, shade(color, o.bottom == null ? -0.3 : o.bottom));
    g.fillStyle = grd;
    rrect(g, x, y, w, h, r);
    g.fill();
    const bev = Math.max(1, Math.min(w, h) * 0.12);
    g.save();
    g.clip();
    g.fillStyle = withAlpha('#ffffff', 0.28);
    rrect(g, x + 0.5, y + 0.5, w - 1, bev, Math.max(0, r - 0.5));
    g.fill();
    g.fillStyle = withAlpha('#0b0618', 0.22);
    g.fillRect(x, y + h - bev, w, bev);
    if (o.gloss) {
      g.fillStyle = 'rgba(255, 255, 255, .18)';
      g.beginPath();
      g.moveTo(x + w * 0.08, y + h * 0.14);
      g.lineTo(x + w * 0.32, y + h * 0.14);
      g.lineTo(x + w * 0.18, y + h * 0.86);
      g.lineTo(x - w * 0.06, y + h * 0.86);
      g.closePath();
      g.fill();
    }
    g.restore();
    if (o.edge) {
      g.strokeStyle = withAlpha(shade(color, -0.6), 0.65);
      g.lineWidth = o.edge;
      rrect(g, x, y, w, h, r);
      g.stroke();
    }
  }

  // An extruded box seen from slightly above: a top face of depth `d` above a front face. Walls, crates,
  // gates, buildings. (x, y) is the top-left of the FRONT face; the top face rises above it.
  function prism(g, x, y, w, h, d, color, o = {}) {
    const r = o.r || 0;
    if (d > 0) {
      const tg = g.createLinearGradient(x, y - d, x, y);
      tg.addColorStop(0, shade(color, 0.42));
      tg.addColorStop(1, shade(color, 0.2));
      g.fillStyle = tg;
      rrect(g, x, y - d, w, d + r * 2 + 1, r);
      g.fill();
    }
    block(g, x, y, w, h, r, o.front || shade(color, -0.06), { top: 0.1, bottom: -0.38, gloss: o.gloss, edge: o.edge });
  }

  // A vertical cylinder (tube, tower, barrel, post) seen slightly from above: a horizontally lit body and
  // an elliptical cap. (cx, top) is the centre of the cap; rx its half-width.
  function cylinder(g, cx, top, rx, h, color, o = {}) {
    const ry = o.ry == null ? rx * 0.32 : o.ry;
    const grd = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
    grd.addColorStop(0, shade(color, -0.15));
    grd.addColorStop(0.28, shade(color, 0.38));
    grd.addColorStop(0.55, color);
    grd.addColorStop(0.9, shade(color, -0.45));
    grd.addColorStop(1, shade(color, -0.25));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(cx - rx, top);
    g.lineTo(cx - rx, top + h);
    g.ellipse(cx, top + h, rx, ry, 0, Math.PI, 0, true);
    g.lineTo(cx + rx, top);
    g.closePath();
    g.fill();
    if (o.cap !== false) {
      const cg = g.createLinearGradient(cx - rx, top - ry, cx + rx, top + ry);
      cg.addColorStop(0, shade(o.capColor || color, 0.45));
      cg.addColorStop(1, shade(o.capColor || color, 0.05));
      g.fillStyle = cg;
      g.beginPath(); g.ellipse(cx, top, rx, ry, 0, 0, TAU); g.fill();
    }
  }

  // A chrome/steel bar from (x0, y0) to (x1, y1) of thickness `t` with rounded ends: polished metal with
  // a hard specular line, the way pins, pipes, swords and rails look. `tint` colours the metal (brass, gold).
  function metalBar(g, x0, y0, x1, y1, t, tint = '#b9c3d3') {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len <= 0) return;
    const nx = -dy / len, ny = dx / len;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const grd = g.createLinearGradient(mx + nx * t / 2, my + ny * t / 2, mx - nx * t / 2, my - ny * t / 2);
    // n points "up/left" for a left→right bar, so the first stop is the lit side.
    const lit = nx * LIGHT.x + ny * LIGHT.y < 0;
    const stops = [[0, shade(tint, 0.75)], [0.22, shade(tint, 0.35)], [0.5, tint], [0.62, shade(tint, -0.5)], [0.85, shade(tint, -0.2)], [1, shade(tint, -0.55)]];
    for (const [o, c] of stops) grd.addColorStop(lit ? 1 - o : o, c);
    g.save();
    g.lineCap = 'round';
    g.strokeStyle = shade(tint, -0.7);
    g.lineWidth = t + 1;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = grd;
    g.lineWidth = t;
    g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, .75)';
    g.lineWidth = Math.max(0.6, t * 0.14);
    const sh = (lit ? -1 : 1) * t * 0.26;
    g.beginPath(); g.moveTo(x0 + nx * sh + dx / len * t * 0.4, y0 + ny * sh + dy / len * t * 0.4); g.lineTo(x1 + nx * sh - dx / len * t * 0.4, y1 + ny * sh - dy / len * t * 0.4); g.stroke();
    g.restore();
  }

  // A glossy capsule character body (a casual-game "bean"): lit body, head sphere, contact shadow.
  // Returns nothing; games add eyes, hats and gear on top. (x, y) is where the feet touch the ground.
  function bean(g, x, y, r, h, color, o = {}) {
    if (o.shadow !== false) shadow(g, x, y, r * 1.2, r * 0.45, 0.4);
    const top = y - h;
    const grd = g.createLinearGradient(x - r, 0, x + r, 0);
    grd.addColorStop(0, shade(color, 0.3));
    grd.addColorStop(0.4, color);
    grd.addColorStop(1, shade(color, -0.45));
    g.fillStyle = grd;
    rrect(g, x - r, top, r * 2, h, r);
    g.fill();
    g.fillStyle = 'rgba(255, 255, 255, .3)';
    g.beginPath(); g.ellipse(x - r * 0.4, top + r * 0.75, r * 0.22, r * 0.45, 0, 0, TAU); g.fill();
  }

  // Glass: a translucent body with a bright left edge, a soft right reflection and a rim line. Fill the
  // contents first, then call this over them. (x, y, w, h) is the outline; r the corner radius at the bottom.
  function glass(g, x, y, w, h, r, o = {}) {
    g.save();
    rrect(g, x, y, w, h, r);
    g.fillStyle = o.tint || 'rgba(200, 225, 255, .07)';
    g.fill();
    g.clip();
    const sw = Math.max(1.5, w * 0.16);
    const lg = g.createLinearGradient(x, 0, x + sw * 1.6, 0);
    lg.addColorStop(0, 'rgba(255, 255, 255, 0)');
    lg.addColorStop(0.4, 'rgba(255, 255, 255, .5)');
    lg.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = lg;
    g.fillRect(x + w * 0.08, y + r * 0.4, sw * 1.6, h - r * 1.2);
    g.fillStyle = 'rgba(255, 255, 255, .16)';
    g.fillRect(x + w - sw * 1.1, y + h * 0.1, sw * 0.45, h * 0.62);
    const sg = g.createLinearGradient(x, 0, x + w, 0);
    sg.addColorStop(0, 'rgba(10, 6, 30, .18)');
    sg.addColorStop(0.3, 'rgba(10, 6, 30, 0)');
    sg.addColorStop(0.75, 'rgba(10, 6, 30, 0)');
    sg.addColorStop(1, 'rgba(10, 6, 30, .3)');
    g.fillStyle = sg;
    g.fillRect(x, y, w, h);
    g.restore();
    g.strokeStyle = o.rim || 'rgba(225, 240, 255, .75)';
    g.lineWidth = o.lineWidth || 1.6;
    rrect(g, x, y, w, h, r);
    g.stroke();
  }

  // Chunky game text: a dark outline, a soft drop shadow and a light-to-colour vertical gradient fill.
  function text(g, str, x, y, o = {}) {
    const size = o.size || 16;
    g.save();
    g.font = `${o.weight || 900} ${size}px ${o.font || 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'}`;
    g.textAlign = o.align || 'center';
    g.textBaseline = o.baseline || 'middle';
    g.lineJoin = 'round';
    const col = o.color || '#ffffff';
    g.fillStyle = 'rgba(8, 4, 20, .35)';
    g.fillText(str, x, y + size * 0.12);
    g.strokeStyle = o.stroke || shade(col, -0.75);
    g.lineWidth = o.outline == null ? Math.max(2, size * 0.18) : o.outline;
    if (g.lineWidth > 0) g.strokeText(str, x, y);
    const grd = g.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    grd.addColorStop(0, shade(col, 0.6));
    grd.addColorStop(0.55, col);
    grd.addColorStop(1, shade(col, -0.2));
    g.fillStyle = grd;
    g.fillText(str, x, y);
    g.restore();
  }

  // ───────────── Particles ─────────────
  // A pool of short-lived particles in world units. Shapes: 'dot' (lit droplet), 'spark' (streak along the
  // velocity, additive), 'star' (reward), 'ring' (shock wave), 'smoke' (soft puff that grows), 'chunk'
  // (tumbling debris square), 'confetti' (flat spinning paper).
  class Particles {
    constructor(max = 400) { this.max = max; this.list = []; }
    emit(p) {
      if (this.list.length >= this.max) this.list.shift();
      this.list.push({
        x: p.x, y: p.y, vx: p.vx || 0, vy: p.vy || 0, life: p.life || 0.6, t: 0,
        size: p.size || 2, grow: p.grow || 0, color: p.color || '#ffffff', gravity: p.gravity || 0, drag: p.drag || 0,
        shape: p.shape || 'dot', spin: p.spin || 0, a: p.angle || 0, alpha: p.alpha == null ? 1 : p.alpha,
      });
    }
    // n particles bursting from (x, y) in all directions (or within `spread` around `angle`).
    burst(x, y, n, o = {}, rnd = Math.random) {
      for (let i = 0; i < n; i++) {
        const a = o.angle == null ? rnd() * TAU : o.angle + (rnd() - 0.5) * (o.spread || TAU);
        const sp = (o.speed || 60) * (0.4 + rnd() * 0.8);
        this.emit({
          ...o, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: (o.life || 0.6) * (0.7 + rnd() * 0.6), size: (o.size || 2) * (0.6 + rnd() * 0.8),
          color: Array.isArray(o.colors) ? o.colors[(rnd() * o.colors.length) | 0] : o.color,
          spin: (rnd() - 0.5) * (o.spin || 0) * 2, angle: rnd() * TAU,
        });
      }
    }
    update(dt) {
      if (!(dt > 0)) return;
      const keep = [];
      for (const p of this.list) {
        p.t += dt;
        if (p.t >= p.life) continue;
        const k = p.drag ? Math.pow(1 - clamp(p.drag, 0, 0.999), dt) : 1;
        p.vx *= k; p.vy = p.vy * k + p.gravity * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.a += p.spin * dt;
        keep.push(p);
      }
      this.list = keep;
    }
    get count() { return this.list.length; }
    clear() { this.list = []; }
    draw(g) {
      const a0 = g.globalAlpha, op0 = g.globalCompositeOperation;
      for (const p of this.list) {
        const f = p.t / p.life, fade = p.alpha * (1 - f * f), s = p.size + p.grow * p.t;
        g.globalAlpha = a0 * fade;
        switch (p.shape) {
          case 'spark': {
            g.globalCompositeOperation = 'lighter';
            g.strokeStyle = p.color;
            g.lineWidth = s;
            g.lineCap = 'round';
            g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); g.stroke();
            g.globalCompositeOperation = op0;
            break;
          }
          case 'star': {
            g.save(); g.translate(p.x, p.y); g.rotate(p.a);
            g.fillStyle = p.color;
            g.beginPath();
            for (let i = 0; i < 10; i++) {
              const r = i % 2 ? s * 0.45 : s, an = (i / 10) * TAU - Math.PI / 2;
              g.lineTo(Math.cos(an) * r, Math.sin(an) * r);
            }
            g.closePath(); g.fill();
            g.restore();
            break;
          }
          case 'ring': {
            g.strokeStyle = p.color;
            g.lineWidth = Math.max(0.5, p.size * 0.3 * (1 - f));
            g.beginPath(); g.arc(p.x, p.y, s, 0, TAU); g.stroke();
            break;
          }
          case 'smoke': {
            g.globalAlpha = a0 * fade * 0.55;
            g.fillStyle = p.color;
            g.beginPath(); g.arc(p.x, p.y, s, 0, TAU); g.fill();
            break;
          }
          case 'chunk':
          case 'confetti': {
            g.save(); g.translate(p.x, p.y); g.rotate(p.a);
            g.fillStyle = p.color;
            if (p.shape === 'confetti') g.scale(1, Math.abs(Math.cos(p.a * 2)) + 0.15);
            g.fillRect(-s / 2, -s / 2, s, s);
            if (p.shape === 'chunk') { g.fillStyle = 'rgba(255, 255, 255, .25)'; g.fillRect(-s / 2, -s / 2, s, s * 0.3); }
            g.restore();
            break;
          }
          default: {
            g.fillStyle = p.color;
            g.beginPath(); g.arc(p.x, p.y, s, 0, TAU); g.fill();
            if (s > 1.5) { g.fillStyle = 'rgba(255, 255, 255, .5)'; g.beginPath(); g.arc(p.x - s * 0.3, p.y - s * 0.3, s * 0.35, 0, TAU); g.fill(); }
          }
        }
      }
      g.globalAlpha = a0;
      g.globalCompositeOperation = op0;
    }
  }

  // ───────────── Screen shake ─────────────
  // Trauma-style shake: add() stacks up to 1, it decays over time, and the offset grows with trauma².
  // Small hits barely move the camera, big ones clearly do. Purely visual: input never uses the offset.
  class Shake {
    constructor(maxPx = 8, decay = 1.8) { this.maxPx = maxPx; this.decay = decay; this.trauma = 0; this.t = 0; }
    add(amount) { this.trauma = clamp(this.trauma + amount, 0, 1); }
    update(dt) { if (dt > 0) { this.t += dt; this.trauma = Math.max(0, this.trauma - this.decay * dt); } }
    offset() {
      const k = this.trauma * this.trauma * this.maxPx;
      if (k <= 0.01) return { x: 0, y: 0 };
      return { x: k * Math.sin(this.t * 61.7) * Math.cos(this.t * 23.1), y: k * Math.sin(this.t * 47.3 + 1.3) };
    }
  }

  // ───────────── Floating labels ─────────────
  // "+10", "x2", "-25": pop in with outBack, rise and fade.
  class Floaters {
    constructor() { this.list = []; }
    add(str, x, y, o = {}) { this.list.push({ str, x, y, t: 0, life: o.life || 0.9, color: o.color || '#ffffff', size: o.size || 14, rise: o.rise == null ? 26 : o.rise }); }
    update(dt) { if (dt > 0) this.list = this.list.filter((f) => (f.t += dt) < f.life); }
    draw(g) {
      const a0 = g.globalAlpha;
      for (const f of this.list) {
        const p = f.t / f.life, sc = ease.outBack(Math.min(1, p * 4));
        g.globalAlpha = a0 * (p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3);
        text(g, f.str, f.x, f.y - ease.outCubic(p) * f.rise, { size: f.size * Math.max(0.01, sc), color: f.color });
      }
      g.globalAlpha = a0;
    }
  }

  const api = {
    TAU, LIGHT, clamp, lerp, ease, damp, parse, mix, shade, withAlpha, rrect, bake,
    shadow, glow, vignette, sphere, block, prism, cylinder, metalBar, bean, glass, text,
    Particles, Shake, Floaters,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Fx = api;
})(typeof window !== 'undefined' ? window : globalThis);
