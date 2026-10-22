'use strict';
// Глубина — creature models. Every model is drawn at the origin, facing +x, with s = screen radius.
// draw(ctx, id, s, ph, mode): mode 'body' paints the creature, 'lights' paints only what glows
// (the game draws lights over the darkness of the deep zones with additive blending).
(function (root) {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function glowDot(ctx, x, y, r, color, a = 1) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${color},${a})`); g.addColorStop(0.35, `rgba(${color},${a * 0.45})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  function eye(ctx, x, y, r, iris = '#c9b25a') {
    if (r < 0.6) { ctx.fillStyle = '#081015'; ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2); return; }
    ctx.fillStyle = iris; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#060b0e'; ctx.beginPath(); ctx.arc(x + r * 0.12, y, r * 0.68, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(x + r * 0.35, y - r * 0.35, r * 0.28, 0, TAU); ctx.fill();
  }
  // A curved fang from (x0, y0) to its tip (x1, y1); bend picks the side it curves to.
  function fang(ctx, x0, y0, x1, y1, w, bend) {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, nx = -(y1 - y0), ny = x1 - x0, k = 0.18 * bend;
    ctx.fillStyle = '#eef2f6';
    ctx.beginPath(); ctx.moveTo(x0 - w, y0);
    ctx.quadraticCurveTo(mx + nx * k - w * 0.5, my + ny * k, x1, y1);
    ctx.quadraticCurveTo(mx + nx * k + w * 0.5, my + ny * k, x0 + w, y0);
    ctx.closePath(); ctx.fill();
  }
  // A smooth closed shape through points.
  function smooth(ctx, pts) {
    ctx.beginPath();
    const n = pts.length;
    ctx.moveTo((pts[n - 1].x + pts[0].x) / 2, (pts[n - 1].y + pts[0].y) / 2);
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    ctx.closePath();
  }
  function fin(ctx, pts, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fill();
  }

  // ───────────── Generic fish: an undulating spine with a thickness profile ─────────────
  // c: L, H (in s), k (where the body is thickest, lower = further forward), colours top/mid/belly,
  // fin colour, tail type, dorsal/anal/pectoral fins, eye, photophores, extras.
  function spine(s, ph, c) {
    const N = 18, L = c.L * s, H = c.H * s, sw = (c.swim ?? 0.35) * H;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const a = Math.pow(Math.max(u, 0.02), c.k ?? 0.7);
      let p = Math.pow(Math.sin(Math.PI * a), 0.8) * (1 - 0.3 * u);
      if (c.blunt) p = Math.max(p, c.blunt * Math.sqrt(clamp(1 - Math.pow((u - 0.18) / 0.2, 2), 0, 1)));
      // round: an egg-shaped body, thickest at u = round (globular deep-sea fish)
      if (c.round) p = Math.sqrt(clamp(1 - Math.pow((u - c.round) / (u < c.round ? c.round + 0.04 : 1.05 - c.round), 2), 0, 1));
      p = Math.max(p, (c.ped ?? 0.1) * u);
      if (u < 0.03) p *= c.nose ?? 0.6;
      pts.push({ u, x: L * (0.5 - u), y: sw * Math.sin(ph * 3 - u * 4.2) * u * u, t: H * p });
    }
    pts.at = (u) => {
      const f = clamp(u, 0, 1) * N, i = Math.min(N - 1, Math.floor(f)), k = f - i, a = pts[i], b = pts[i + 1];
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, t: a.t + (b.t - a.t) * k };
    };
    return pts;
  }

  function fishOutline(ctx, pts, c) {
    const top = pts.map((p) => ({ x: p.x, y: p.y - p.t * (c.topK ?? 1) }));
    const bot = pts.map((p) => ({ x: p.x, y: p.y + p.t * (c.botK ?? 0.9) })).reverse();
    smooth(ctx, top.concat(bot));
  }

  function tail(ctx, pts, s, ph, c) {
    const end = pts[pts.length - 1], prev = pts[pts.length - 3];
    const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
    const H = c.H * s, size = (c.tailSize ?? 1) * H;
    // ang points from the body towards the tail tip, so local +x runs backwards, away from the body
    ctx.save(); ctx.translate(end.x, end.y); ctx.rotate(ang);
    ctx.fillStyle = c.finColor;
    switch (c.tail) {
      case 'fork':
        ctx.beginPath(); ctx.moveTo(-size * 0.1, 0);
        ctx.quadraticCurveTo(size * 0.5, -size * 0.3, size * 0.95, -size * 0.95);
        ctx.quadraticCurveTo(size * 0.55, -size * 0.2, size * 0.45, 0);
        ctx.quadraticCurveTo(size * 0.55, size * 0.2, size * 0.95, size * 0.95);
        ctx.quadraticCurveTo(size * 0.5, size * 0.3, -size * 0.1, 0); ctx.fill();
        break;
      case 'round':
        ctx.beginPath(); ctx.moveTo(-size * 0.1, -size * 0.15);
        ctx.quadraticCurveTo(size * 1.1, -size * 0.9, size * 0.9, 0);
        ctx.quadraticCurveTo(size * 1.1, size * 0.9, -size * 0.1, size * 0.15); ctx.fill();
        break;
      case 'shark':
        ctx.beginPath(); ctx.moveTo(-size * 0.15, -size * 0.1);
        ctx.quadraticCurveTo(size * 0.6, -size * 0.45, size * 1.3, -size * 1.25);
        ctx.quadraticCurveTo(size * 0.9, -size * 0.3, size * 0.75, 0);
        ctx.quadraticCurveTo(size * 0.75, size * 0.35, size * 0.95, size * 0.6);
        ctx.quadraticCurveTo(size * 0.4, size * 0.35, -size * 0.15, size * 0.1); ctx.fill();
        break;
      case 'whale': // flukes seen edge-on, with a soft notch
        ctx.beginPath(); ctx.moveTo(-size * 0.2, -size * 0.12);
        ctx.quadraticCurveTo(size * 0.5, -size * 0.25, size * 0.95, -size * 0.75);
        ctx.quadraticCurveTo(size * 1.05, -size * 0.2, size * 0.8, 0);
        ctx.quadraticCurveTo(size * 1.05, size * 0.2, size * 0.95, size * 0.75);
        ctx.quadraticCurveTo(size * 0.5, size * 0.25, -size * 0.2, size * 0.12); ctx.fill();
        break;
      case 'whip':
        ctx.strokeStyle = c.finColor; ctx.lineWidth = Math.max(1, size * 0.12); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(size * 1.5, Math.sin(ph * 3) * size * 0.6, size * 3, Math.sin(ph * 3 - 1) * size * 0.4); ctx.stroke();
        break;
      default:
    }
    ctx.restore();
  }

  function drawFish(ctx, s, ph, c, mode) {
    const pts = spine(s, ph, c);
    const H = c.H * s, L = c.L * s;
    if (mode === 'lights') {
      if (c.lights) c.lights(ctx, pts, s, ph);
      return;
    }
    ctx.lineJoin = 'round';
    // fins behind the body
    tail(ctx, pts, s, ph, c);
    for (const f of c.fins || []) {
      if (f.front) continue;
      const a = pts.at(f.u), b = pts.at(f.u + f.len);
      const side = f.side === 'bottom' ? 1 : -1;
      const ay = a.y + side * a.t * 0.85, by = b.y + side * b.t * 0.85;
      const tip = { x: (a.x + b.x) / 2 - f.len * L * (f.sweep ?? 0.4), y: (ay + by) / 2 + side * f.h * H };
      ctx.fillStyle = f.color || c.finColor;
      ctx.beginPath(); ctx.moveTo(a.x, ay);
      if (f.soft) { ctx.quadraticCurveTo(a.x, tip.y, (a.x + tip.x) / 2, tip.y); ctx.quadraticCurveTo(tip.x, tip.y, b.x, by); }
      else { ctx.quadraticCurveTo(a.x - (a.x - tip.x) * 0.2, tip.y * 0.6 + ay * 0.4, tip.x, tip.y); ctx.lineTo(b.x, by); }
      ctx.closePath(); ctx.fill();
    }
    // body with countershading
    fishOutline(ctx, pts, c);
    const g = ctx.createLinearGradient(0, -H, 0, H);
    g.addColorStop(0, c.top); g.addColorStop(0.5, c.mid || c.top); g.addColorStop(1, c.belly);
    ctx.fillStyle = g; ctx.fill();
    if (c.extra) { ctx.save(); fishOutline(ctx, pts, c); ctx.clip(); c.extra(ctx, pts, s, ph); ctx.restore(); }
    ctx.strokeStyle = c.edge || 'rgba(5,15,20,0.35)'; ctx.lineWidth = Math.max(0.6, s * 0.035); ctx.stroke();
    // back highlight
    if (s > 4) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = Math.max(0.6, s * 0.05);
      ctx.beginPath();
      for (let i = 2; i < pts.length - 4; i++) { const p = pts[i]; i === 2 ? ctx.moveTo(p.x, p.y - p.t * 0.55) : ctx.lineTo(p.x, p.y - p.t * 0.55); }
      ctx.stroke();
    }
    // fins in front of the body (pectorals)
    for (const f of c.fins || []) {
      if (!f.front) continue;
      const a = pts.at(f.u);
      const flap = Math.sin(ph * 4) * 0.25;
      ctx.save(); ctx.translate(a.x, a.y + a.t * 0.25); ctx.rotate(Math.PI * 0.82 + flap + (f.angle || 0));
      ctx.fillStyle = f.color || c.finColor;
      ctx.beginPath(); ctx.moveTo(0, -H * 0.12);
      ctx.quadraticCurveTo(f.len * L * 0.6, -H * 0.2, f.len * L, f.h * H * 0.2);
      ctx.quadraticCurveTo(f.len * L * 0.5, H * 0.18, 0, H * 0.12); ctx.fill();
      ctx.restore();
    }
    if (c.gills && s > 5) {
      const a = pts.at(c.gills.u);
      ctx.strokeStyle = 'rgba(10,20,30,0.35)'; ctx.lineWidth = Math.max(0.6, s * 0.03);
      for (let k = 0; k < (c.gills.n || 1); k++) {
        const x = a.x - k * s * 0.08;
        ctx.beginPath(); ctx.moveTo(x, a.y - a.t * 0.5); ctx.quadraticCurveTo(x - s * 0.08, a.y, x, a.y + a.t * 0.55); ctx.stroke();
      }
    }
    if (c.head) c.head(ctx, pts, s, ph);
    if (c.eye) { const e = pts.at(c.eye.u); eye(ctx, e.x, e.y - e.t * (c.eye.up ?? 0.25), Math.max(0.7, c.eye.r * s), c.eye.iris); }
    if (c.dots) c.dots(ctx, pts, s, ph);
  }

  // Photophores along the belly: a row of small dots, glowing in the lights pass.
  const bellyRow = (n, from, to, colour, size = 0.07, lift = 0.75) => ({
    dots(ctx, pts, s) {
      ctx.fillStyle = `rgba(${colour},0.9)`;
      for (let i = 0; i < n; i++) { const p = pts.at(from + (to - from) * (i / (n - 1))); ctx.beginPath(); ctx.arc(p.x, p.y + p.t * lift, Math.max(0.5, s * size), 0, TAU); ctx.fill(); }
    },
    lights(ctx, pts, s, ph) {
      for (let i = 0; i < n; i++) {
        const p = pts.at(from + (to - from) * (i / (n - 1)));
        glowDot(ctx, p.x, p.y + p.t * lift, Math.max(3, s * size * 6), colour, 0.55 + 0.25 * Math.sin(ph * 2 + i));
      }
    },
  });

  const FISH = {
    anchovy: {
      L: 2.5, H: 0.42, k: 0.75, top: '#2f5f78', mid: '#9fc4d3', belly: '#f2f8fa', finColor: 'rgba(160,200,215,0.75)', tail: 'fork', tailSize: 1.1,
      fins: [{ u: 0.42, len: 0.12, h: 0.55 }, { u: 0.62, len: 0.1, h: 0.4, side: 'bottom' }, { u: 0.2, len: 0.12, h: 0.4, front: true }],
      eye: { u: 0.1, r: 0.13, up: 0.1, iris: '#d9e4e8' }, gills: { u: 0.17 },
      extra(ctx, pts, s) { ctx.fillStyle = 'rgba(235,250,255,0.55)'; ctx.fillRect(pts[17].x, -s * 0.06, pts[2].x - pts[17].x, s * 0.08); },
    },
    mackerel: {
      L: 2.6, H: 0.5, k: 0.62, top: '#1b5a64', mid: '#5d9ea2', belly: '#f3f5ee', finColor: 'rgba(60,110,120,0.85)', tail: 'fork', tailSize: 1.15,
      fins: [{ u: 0.32, len: 0.1, h: 0.7 }, { u: 0.55, len: 0.08, h: 0.45 }, { u: 0.56, len: 0.08, h: 0.45, side: 'bottom' }, { u: 0.2, len: 0.13, h: 0.4, front: true }],
      eye: { u: 0.1, r: 0.11, up: 0.15, iris: '#e6d9a8' }, gills: { u: 0.18 },
      extra(ctx, pts, s) {
        ctx.strokeStyle = 'rgba(8,30,35,0.75)'; ctx.lineWidth = Math.max(0.7, s * 0.07);
        for (let k = 0; k < 9; k++) {
          const p = pts.at(0.22 + k * 0.07);
          ctx.beginPath(); ctx.moveTo(p.x, p.y - p.t); ctx.quadraticCurveTo(p.x - s * 0.12, p.y - p.t * 0.5, p.x + s * 0.03, p.y - p.t * 0.1); ctx.stroke();
        }
      },
    },
    lanternfish: Object.assign({
      L: 2.4, H: 0.5, k: 0.55, top: '#1d2633', mid: '#4b5868', belly: '#9aa8b8', finColor: 'rgba(70,85,100,0.8)', tail: 'fork',
      fins: [{ u: 0.38, len: 0.12, h: 0.55 }, { u: 0.58, len: 0.12, h: 0.4, side: 'bottom' }, { u: 0.2, len: 0.12, h: 0.35, front: true }],
      eye: { u: 0.1, r: 0.19, up: 0.15, iris: '#8fb8d0' },
    }, bellyRow(8, 0.15, 0.8, '120,230,255', 0.06, 0.7)),
    hatchetfish: Object.assign({
      L: 1.7, H: 0.9, round: 0.35, top: '#5e7890', mid: '#c9d8e4', belly: '#eef4f8', finColor: 'rgba(170,190,205,0.7)', tail: 'fork', tailSize: 0.45, ped: 0.15, botK: 1.1,
      fins: [{ u: 0.45, len: 0.12, h: 0.25 }, { u: 0.2, len: 0.15, h: 0.3, front: true }],
      eye: { u: 0.12, r: 0.2, up: 0.45, iris: '#b8d4ff' },
    }, bellyRow(9, 0.12, 0.7, '120,200,255', 0.055, 1.0)),
    snailfish: {
      L: 2.7, H: 0.55, k: 0.35, top: 'rgba(240,185,195,0.85)', mid: 'rgba(250,210,215,0.8)', belly: 'rgba(255,230,232,0.8)',
      finColor: 'rgba(245,200,210,0.5)', tail: 'round', tailSize: 0.5, ped: 0.06, nose: 0.9,
      fins: [{ u: 0.3, len: 0.6, h: 0.35, soft: true, sweep: 0.05 }, { u: 0.35, len: 0.55, h: 0.3, soft: true, side: 'bottom', sweep: 0.05 }, { u: 0.18, len: 0.18, h: 0.5, front: true }],
      eye: { u: 0.08, r: 0.08, up: 0.3, iris: '#555' }, edge: 'rgba(160,90,110,0.35)',
    },
    viperfish: Object.assign({
      L: 2.9, H: 0.36, k: 0.4, top: '#141c26', mid: '#26394a', belly: '#3b5266', finColor: 'rgba(40,60,80,0.8)', tail: 'fork', tailSize: 0.9,
      fins: [{ u: 0.18, len: 0.06, h: 1.3 }, { u: 0.7, len: 0.1, h: 0.5, side: 'bottom' }],
      eye: { u: 0.07, r: 0.13, up: 0.3, iris: '#6fb6ff' },
      head(ctx, pts, s) {
        // the gaping mouth: the lower jaw drops below the snout back to under the eye
        const p = pts.at(0), q = pts.at(0.11);
        ctx.fillStyle = '#05080c';
        ctx.beginPath(); ctx.moveTo(p.x + s * 0.06, p.y + s * 0.02);
        ctx.lineTo(q.x, q.y + q.t * 0.15); ctx.lineTo(p.x + s * 0.02, p.y + s * 0.3); ctx.closePath(); ctx.fill();
        // fangs too long for the mouth: the lower ones rise past the snout, the upper ones hang below the jaw
        if (s < 3) return;
        fang(ctx, p.x + s * 0.03, p.y + s * 0.28, p.x - s * 0.03, p.y - s * 0.38, s * 0.035, 1);
        fang(ctx, p.x - s * 0.08, p.y + s * 0.24, p.x - s * 0.12, p.y - s * 0.22, s * 0.028, 1);
        fang(ctx, p.x - s * 0.01, p.y + s * 0.02, p.x + s * 0.09, p.y + s * 0.42, s * 0.032, -1);
        fang(ctx, p.x - s * 0.13, p.y + s * 0.05, p.x - s * 0.08, p.y + s * 0.34, s * 0.025, -1);
      },
    }, bellyRow(12, 0.12, 0.85, '100,190,255', 0.045, 0.8)),
    angler: {
      L: 1.8, H: 0.8, round: 0.4, top: '#2b211f', mid: '#3b2e2a', belly: '#4a3a34', finColor: 'rgba(55,40,36,0.9)', tail: 'round', tailSize: 0.75, ped: 0.2, nose: 1.5, swim: 0.1, botK: 1.05,
      fins: [{ u: 0.6, len: 0.14, h: 0.18, soft: true, sweep: 0.2 }, { u: 0.62, len: 0.12, h: 0.15, soft: true, side: 'bottom', sweep: 0.2 }, { u: 0.35, len: 0.1, h: 0.4, front: true }],
      eye: { u: 0.18, r: 0.07, up: 0.55, iris: '#999' }, edge: 'rgba(0,0,0,0.5)',
      head(ctx, pts, s, ph) {
        const p = pts.at(0.03);
        // gaping jaw with needle teeth
        ctx.fillStyle = '#120a09';
        ctx.beginPath(); ctx.moveTo(p.x + s * 0.05, p.y - s * 0.15); ctx.quadraticCurveTo(p.x - s * 0.5, p.y + s * 0.05, p.x + s * 0.05, p.y + s * 0.4); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#efe6d6'; ctx.lineWidth = Math.max(0.5, s * 0.025);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) { const y = p.y - s * 0.12 + k * s * 0.09; ctx.moveTo(p.x, y); ctx.lineTo(p.x - s * 0.13, y + (k % 2 ? -1 : 1) * s * 0.05); }
        ctx.stroke();
        // the rod
        const rod = angLure(pts, s, ph);
        ctx.strokeStyle = '#4d3a33'; ctx.lineWidth = Math.max(0.7, s * 0.05);
        ctx.beginPath(); ctx.moveTo(rod.x0, rod.y0); ctx.quadraticCurveTo(rod.cx, rod.cy, rod.x, rod.y); ctx.stroke();
        ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(rod.x, rod.y, Math.max(1, s * 0.09), 0, TAU); ctx.fill();
      },
      lights(ctx, pts, s, ph) {
        const rod = angLure(pts, s, ph);
        glowDot(ctx, rod.x, rod.y, Math.max(8, s * 0.9), '180,255,230', 0.9);
        glowDot(ctx, rod.x, rod.y, Math.max(3, s * 0.2), '240,255,250', 1);
      },
    },
    tripod: {
      L: 2.7, H: 0.38, k: 0.45, top: '#7e858f', mid: '#a5acb5', belly: '#c9cfd6', finColor: 'rgba(120,128,138,0.85)', tail: 'fork', tailSize: 0.7,
      fins: [{ u: 0.35, len: 0.1, h: 0.6 }, { u: 0.55, len: 0.15, h: 0.35, side: 'bottom' }],
      eye: { u: 0.08, r: 0.05, up: 0.3, iris: '#333' },
      head(ctx, pts, s, ph) {
        // the stilts: long rays of the pelvic fins and the tail
        ctx.strokeStyle = 'rgba(200,205,212,0.85)'; ctx.lineWidth = Math.max(0.6, s * 0.035); ctx.lineCap = 'round';
        const a = pts.at(0.3), b = pts.at(1);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y + a.t); ctx.lineTo(a.x + s * 0.2, a.y + s * 1.4);
        ctx.moveTo(a.x - s * 0.05, a.y + a.t); ctx.lineTo(a.x - s * 0.25, a.y + s * 1.45);
        ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - s * 0.5, b.y + s * 1.2);
        const h = pts.at(0.12);
        ctx.moveTo(h.x, h.y); ctx.quadraticCurveTo(h.x + s * 0.6, h.y - s * 0.8, h.x + s * 1.3, h.y - s * 0.6 + Math.sin(ph) * s * 0.1);
        ctx.stroke();
      },
    },
    shark: {
      L: 2.9, H: 0.42, k: 0.55, top: '#2c5c9a', mid: '#4f86bf', belly: '#eef3f6', finColor: '#2f5f9c', tail: 'shark', tailSize: 1.25, nose: 0.4,
      fins: [{ u: 0.36, len: 0.13, h: 1.25, sweep: 0.7 }, { u: 0.72, len: 0.05, h: 0.4 }, { u: 0.68, len: 0.05, h: 0.35, side: 'bottom' }, { u: 0.24, len: 0.24, h: 0.6, front: true, angle: -0.15 }],
      eye: { u: 0.1, r: 0.06, up: 0.15, iris: '#222' }, gills: { u: 0.2, n: 5 },
    },
    goblin: {
      L: 3.0, H: 0.4, k: 0.6, top: '#d79a97', mid: '#e3b2ae', belly: '#f2d4cf', finColor: '#c98583', tail: 'shark', tailSize: 1.1, nose: 0.5,
      fins: [{ u: 0.45, len: 0.1, h: 0.6, sweep: 0.5 }, { u: 0.55, len: 0.1, h: 0.5 }, { u: 0.25, len: 0.18, h: 0.5, front: true }],
      eye: { u: 0.13, r: 0.05, up: 0.2, iris: '#333' }, gills: { u: 0.22, n: 5 },
      head(ctx, pts, s, ph) {
        const p = pts.at(0);
        ctx.fillStyle = '#d99c98';
        ctx.beginPath(); ctx.moveTo(p.x - s * 0.1, p.y - s * 0.18); ctx.quadraticCurveTo(p.x + s * 0.5, p.y - s * 0.25, p.x + s * 0.85, p.y - s * 0.08);
        ctx.quadraticCurveTo(p.x + s * 0.5, p.y + s * 0.02, p.x - s * 0.1, p.y + s * 0.02); ctx.fill();
        // protruding jaw that snaps
        const jut = (Math.sin(ph * 1.5) * 0.5 + 0.5) * s * 0.15;
        ctx.fillStyle = '#b06b6b';
        ctx.beginPath(); ctx.moveTo(p.x - s * 0.2, p.y + s * 0.1); ctx.lineTo(p.x + s * 0.2 + jut, p.y + s * 0.12); ctx.lineTo(p.x - s * 0.15, p.y + s * 0.28); ctx.fill();
        ctx.strokeStyle = '#f4ece0'; ctx.lineWidth = Math.max(0.5, s * 0.02);
        ctx.beginPath(); for (let k = 0; k < 4; k++) { const x = p.x - s * 0.1 + k * s * 0.08 + jut * 0.5; ctx.moveTo(x, p.y + s * 0.12); ctx.lineTo(x + s * 0.02, p.y + s * 0.05); } ctx.stroke();
      },
    },
    // A long blue-grey back with pale mottling, a tiny dorsal fin far back, throat grooves.
    bluewhale: {
      L: 3.7, H: 0.42, k: 0.4, top: '#46657e', mid: '#6687a0', belly: '#a5b8c7', finColor: '#46647c', tail: 'whale', tailSize: 1.0, swim: 0.22, nose: 0.8,
      fins: [{ u: 0.76, len: 0.04, h: 0.25, sweep: 0.6 }, { u: 0.26, len: 0.16, h: 0.3, front: true, color: '#5b7a92', angle: 0.15 }],
      eye: { u: 0.15, r: 0.035, up: -0.1, iris: '#1b2630' },
      extra(ctx, pts, s) {
        ctx.fillStyle = 'rgba(200,220,232,0.22)';
        for (let k = 0; k < 22; k++) { const p = pts.at(0.1 + ((k * 0.37) % 1) * 0.75); ctx.beginPath(); ctx.ellipse(p.x, p.y + p.t * (((k * 0.53) % 1) - 0.6), s * 0.06, s * 0.035, 0, 0, TAU); ctx.fill(); }
        ctx.strokeStyle = 'rgba(40,60,80,0.3)'; ctx.lineWidth = Math.max(0.5, s * 0.018);
        for (let k = 0; k < 7; k++) { const a = pts.at(0.03), b = pts.at(0.45); ctx.beginPath(); ctx.moveTo(a.x, a.y + a.t * (0.35 + k * 0.09)); ctx.lineTo(b.x, b.y + b.t * (0.45 + k * 0.08)); ctx.stroke(); }
      },
    },
    // Black and white: a tall dorsal fin, a white eye patch, a grey saddle and a white belly.
    orca: {
      L: 2.8, H: 0.55, k: 0.4, top: '#0f1114', mid: '#15181c', belly: '#1c2025', finColor: '#101215', tail: 'whale', tailSize: 1.0, swim: 0.25, nose: 0.75,
      fins: [{ u: 0.38, len: 0.1, h: 1.7, sweep: 0.25 }, { u: 0.22, len: 0.17, h: 0.55, front: true, angle: 0.2 }],
      eye: { u: 0.12, r: 0.035, up: 0.05, iris: '#222' },
      extra(ctx, pts, s) {
        ctx.fillStyle = '#f2f1ec';
        // white chin and throat along the lower jaw
        const at = (u, k) => { const p = pts.at(u); return [p.x, p.y + p.t * k]; };
        ctx.beginPath(); ctx.moveTo(...at(0.0, 0.15));
        for (const [u, k] of [[0.1, 0.25], [0.2, 0.35], [0.32, 0.45], [0.45, 0.6], [0.55, 0.55], [0.62, 0.15], [0.7, 0.05], [0.74, 0.5], [0.66, 0.85], [0.5, 1.1], [0.2, 1.1], [0.02, 0.6]]) ctx.lineTo(...at(u, k));
        ctx.closePath(); ctx.fill();
        // the eye patch
        const e = pts.at(0.17);
        ctx.beginPath(); ctx.ellipse(e.x, e.y - e.t * 0.3, s * 0.17, s * 0.06, -0.12, 0, TAU); ctx.fill();
        // grey saddle behind the dorsal fin
        const d = pts.at(0.5);
        ctx.fillStyle = 'rgba(150,155,165,0.55)';
        ctx.beginPath(); ctx.ellipse(d.x, d.y - d.t * 0.85, s * 0.28, s * 0.09, 0, 0, TAU); ctx.fill();
      },
    },
    // An eel-like shark: frilled gill slits, a mouth at the tip of the snout full of three-pointed teeth.
    frilled: {
      L: 3.6, H: 0.27, k: 0.3, top: '#5a4a40', mid: '#6d5c50', belly: '#8a796b', finColor: 'rgba(85,70,60,0.9)', tail: 'shark', tailSize: 0.9, swim: 0.55, nose: 0.9,
      fins: [{ u: 0.72, len: 0.08, h: 0.7, sweep: 0.4 }, { u: 0.66, len: 0.12, h: 0.6, side: 'bottom' }, { u: 0.2, len: 0.12, h: 0.6, front: true }],
      eye: { u: 0.05, r: 0.07, up: 0.25, iris: '#9fb39a' },
      head(ctx, pts, s) {
        // six frilly gill slits
        ctx.strokeStyle = 'rgba(150,60,60,0.75)'; ctx.lineWidth = Math.max(0.6, s * 0.03);
        for (let k = 0; k < 6; k++) {
          const p = pts.at(0.09 + k * 0.025);
          ctx.beginPath(); ctx.moveTo(p.x, p.y - p.t * 0.8);
          for (let j = 1; j <= 6; j++) ctx.lineTo(p.x + (j % 2 ? -1 : 1) * s * 0.025, p.y - p.t * 0.8 + (p.t * 1.6 * j) / 6);
          ctx.stroke();
        }
        const p = pts.at(0);
        ctx.fillStyle = '#1a1210';
        ctx.beginPath(); ctx.moveTo(p.x + s * 0.02, p.y - s * 0.02); ctx.lineTo(p.x - s * 0.18, p.y + s * 0.06); ctx.lineTo(p.x, p.y + s * 0.1); ctx.fill();
        if (s > 6) {
          ctx.strokeStyle = '#f2ece0'; ctx.lineWidth = Math.max(0.4, s * 0.012);
          ctx.beginPath(); for (let k = 0; k < 4; k++) { const x = p.x - k * s * 0.04; ctx.moveTo(x, p.y + s * 0.02); ctx.lineTo(x - s * 0.01, p.y + s * 0.07); } ctx.stroke();
        }
      },
    },
    // A short dark brute with a huge head and the biggest teeth for its size.
    fangtooth: {
      L: 1.7, H: 0.72, round: 0.3, top: '#241817', mid: '#352523', belly: '#46322e', finColor: 'rgba(50,36,32,0.9)', tail: 'fork', tailSize: 0.7, ped: 0.18, nose: 1.3, swim: 0.2,
      fins: [{ u: 0.42, len: 0.2, h: 0.3, soft: true }, { u: 0.6, len: 0.12, h: 0.25, side: 'bottom', soft: true }, { u: 0.32, len: 0.1, h: 0.35, front: true }],
      eye: { u: 0.2, r: 0.07, up: 0.5, iris: '#a7a28e' }, edge: 'rgba(0,0,0,0.5)',
      extra(ctx, pts, s) {
        // rough skin
        ctx.strokeStyle = 'rgba(90,60,55,0.35)'; ctx.lineWidth = Math.max(0.5, s * 0.02);
        for (let k = 0; k < 10; k++) { const p = pts.at(0.2 + k * 0.06); ctx.beginPath(); ctx.arc(p.x, p.y, p.t * 0.8, -1, 1); ctx.stroke(); }
      },
      head(ctx, pts, s) {
        const p = pts.at(0.02);
        ctx.fillStyle = '#0c0606';
        ctx.beginPath(); ctx.moveTo(p.x + s * 0.06, p.y - s * 0.12); ctx.quadraticCurveTo(p.x - s * 0.45, p.y + s * 0.02, p.x + s * 0.04, p.y + s * 0.32); ctx.closePath(); ctx.fill();
        if (s < 3) return;
        fang(ctx, p.x + s * 0.02, p.y + s * 0.3, p.x - s * 0.02, p.y - s * 0.28, s * 0.045, 1);
        fang(ctx, p.x - s * 0.12, p.y + s * 0.22, p.x - s * 0.15, p.y - s * 0.12, s * 0.035, 1);
        fang(ctx, p.x, p.y - s * 0.1, p.x + s * 0.05, p.y + s * 0.2, s * 0.035, -1);
        fang(ctx, p.x - s * 0.15, p.y - s * 0.06, p.x - s * 0.12, p.y + s * 0.14, s * 0.03, -1);
      },
    },
    // Barreleye: a clear dome over the head with two green tube eyes looking up.
    barreleye: {
      L: 2.1, H: 0.4, k: 0.5, top: '#4b5862', mid: '#6d7b85', belly: '#a3afb6', finColor: 'rgba(110,125,135,0.8)', tail: 'fork', tailSize: 0.7,
      fins: [{ u: 0.5, len: 0.1, h: 0.4 }, { u: 0.62, len: 0.1, h: 0.35, side: 'bottom' }, { u: 0.25, len: 0.2, h: 0.6, front: true, color: 'rgba(150,165,175,0.85)' }],
      head(ctx, pts, s) {
        const p = pts.at(0.13), n = pts.at(0.02);
        // nostrils that look like eyes, and the small mouth
        ctx.fillStyle = '#10161b';
        for (const dx of [0, s * 0.07]) { ctx.beginPath(); ctx.arc(n.x - s * 0.05 - dx, n.y - n.t * 0.25, Math.max(0.5, s * 0.03), 0, TAU); ctx.fill(); }
        ctx.beginPath(); ctx.arc(n.x + s * 0.02, n.y + n.t * 0.15, Math.max(0.4, s * 0.02), 0, TAU); ctx.fill();
        // green barrel eyes inside the dome, pointing up
        ctx.fillStyle = '#2f9e4a';
        ctx.beginPath(); ctx.ellipse(p.x, p.y - p.t * 0.75, s * 0.07, s * 0.13, -0.15, 0, TAU); ctx.fill();
        ctx.fillStyle = '#9cf5a6'; ctx.beginPath(); ctx.ellipse(p.x + s * 0.02, p.y - p.t * 0.75 - s * 0.1, s * 0.055, s * 0.03, -0.15, 0, TAU); ctx.fill();
        // the clear dome
        ctx.fillStyle = 'rgba(200,240,255,0.18)'; ctx.strokeStyle = 'rgba(220,245,255,0.55)'; ctx.lineWidth = Math.max(0.5, s * 0.02);
        ctx.beginPath(); ctx.ellipse(p.x + s * 0.02, p.y - p.t * 0.4, s * 0.3, s * 0.32, 0, Math.PI, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath(); ctx.arc(p.x + s * 0.05, p.y - p.t * 0.4, s * 0.22, Math.PI * 1.25, Math.PI * 1.5); ctx.stroke();
      },
    },
    // The deepest fish ever caught: pale, soft, with long low fins and tiny eyes.
    abysso: {
      L: 2.9, H: 0.36, k: 0.35, top: 'rgba(222,196,186,0.95)', mid: 'rgba(232,210,200,0.92)', belly: 'rgba(242,226,218,0.9)',
      finColor: 'rgba(225,200,190,0.55)', tail: 'round', tailSize: 0.45, ped: 0.05, nose: 1.0, swim: 0.45,
      fins: [{ u: 0.28, len: 0.66, h: 0.28, soft: true, sweep: 0.05 }, { u: 0.4, len: 0.55, h: 0.25, soft: true, side: 'bottom', sweep: 0.05 }, { u: 0.17, len: 0.12, h: 0.4, front: true }],
      eye: { u: 0.06, r: 0.04, up: 0.3, iris: '#6a5a55' }, edge: 'rgba(150,110,100,0.35)',
    },
    // A tall silver disc that ends in a scalloped rim instead of a tail, with tall fins at the back.
    sunfish: {
      L: 2.0, H: 1.0, round: 0.45, ped: 0.62, top: '#7d8b97', mid: '#aab7c1', belly: '#dfe6ea', finColor: '#8996a2', tail: 'none', swim: 0.08, nose: 1.0,
      fins: [{ u: 0.66, len: 0.2, h: 1.0, sweep: 0.5 }, { u: 0.66, len: 0.2, h: 0.95, side: 'bottom', sweep: 0.5 }, { u: 0.3, len: 0.08, h: 0.3, front: true }],
      eye: { u: 0.17, r: 0.07, up: 0.2, iris: '#c9cfd4' },
      extra(ctx, pts, s) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        for (let k = 0; k < 14; k++) { const p = pts.at(0.15 + ((k * 0.41) % 1) * 0.7); ctx.beginPath(); ctx.arc(p.x, p.y + p.t * (((k * 0.29) % 1) * 1.4 - 0.7), s * 0.06, 0, TAU); ctx.fill(); }
      },
      head(ctx, pts, s, ph) {
        // the clavus: a frilled rim where the tail should be
        const e = pts.at(1);
        ctx.fillStyle = '#8996a2';
        ctx.beginPath(); ctx.moveTo(e.x + s * 0.05, e.y - e.t);
        for (let k = 0; k <= 8; k++) { const y = e.y - e.t + (2 * e.t * k) / 8; ctx.lineTo(e.x - s * (0.12 + 0.05 * Math.sin(ph * 2 + k)) - (k % 2) * s * 0.05, y); }
        ctx.lineTo(e.x + s * 0.05, e.y + e.t); ctx.closePath(); ctx.fill();
        const n = pts.at(0);
        ctx.fillStyle = '#4d5660'; ctx.beginPath(); ctx.ellipse(n.x - s * 0.02, n.y + s * 0.02, s * 0.05, s * 0.04, 0, 0, TAU); ctx.fill();
      },
    },
    humpback: {
      L: 3.1, H: 0.6, k: 0.42, top: '#25313d', mid: '#33424f', belly: '#cfd8de', finColor: '#2a3643', tail: 'whale', tailSize: 1.1, swim: 0.25, nose: 0.7,
      fins: [{ u: 0.62, len: 0.06, h: 0.3, sweep: 0.8 }, { u: 0.28, len: 0.42, h: 0.5, front: true, color: '#dfe6ea', angle: 0.1 }],
      eye: { u: 0.2, r: 0.04, up: -0.1, iris: '#222' },
      extra(ctx, pts, s) {
        // throat grooves
        ctx.strokeStyle = 'rgba(40,55,70,0.35)'; ctx.lineWidth = Math.max(0.6, s * 0.02);
        for (let k = 0; k < 6; k++) { const a = pts.at(0.04), b = pts.at(0.42); ctx.beginPath(); ctx.moveTo(a.x, a.y + a.t * (0.3 + k * 0.1)); ctx.lineTo(b.x, b.y + b.t * (0.4 + k * 0.1)); ctx.stroke(); }
        // tubercles on the head
        ctx.fillStyle = 'rgba(20,28,36,0.6)';
        for (let k = 0; k < 6; k++) { const a = pts.at(0.03 + k * 0.025); ctx.beginPath(); ctx.arc(a.x, a.y - a.t * 0.6, Math.max(0.6, s * 0.035), 0, TAU); ctx.fill(); }
      },
    },
    sperm: {
      L: 3.2, H: 0.55, k: 0.25, blunt: 0.95, top: '#353d48', mid: '#4a5563', belly: '#6d7884', finColor: '#3a4048', tail: 'whale', tailSize: 1.05, swim: 0.25, nose: 1.4, topK: 1, botK: 0.85,
      fins: [{ u: 0.65, len: 0.12, h: 0.25, soft: true }, { u: 0.36, len: 0.12, h: 0.3, front: true }],
      eye: { u: 0.36, r: 0.04, up: -0.2, iris: '#222' },
      extra(ctx, pts, s) {
        // wrinkled skin and the narrow lower jaw
        ctx.strokeStyle = 'rgba(20,24,28,0.25)'; ctx.lineWidth = Math.max(0.6, s * 0.02);
        for (let k = 0; k < 12; k++) { const a = pts.at(0.4 + k * 0.04); ctx.beginPath(); ctx.moveTo(a.x, a.y - a.t * 0.8); ctx.lineTo(a.x - s * 0.04, a.y + a.t * 0.5); ctx.stroke(); }
        // the crease where the box-shaped head meets the body
        const c = pts.at(0.34);
        ctx.strokeStyle = 'rgba(15,20,26,0.35)'; ctx.lineWidth = Math.max(0.8, s * 0.05);
        ctx.beginPath(); ctx.moveTo(c.x, c.y - c.t); ctx.quadraticCurveTo(c.x + s * 0.12, c.y, c.x, c.y + c.t * 0.4); ctx.stroke();
        // the narrow lower jaw, pale, with a row of conical teeth
        const a = pts.at(0.05), b = pts.at(0.34);
        const jaw = (k) => ({ x: a.x - s * 0.1 + (b.x - a.x + s * 0.1) * k, y: a.y + a.t * 0.7 + (b.y + b.t * 0.55 - a.y - a.t * 0.7) * k });
        ctx.strokeStyle = 'rgba(220,225,230,0.7)'; ctx.lineWidth = Math.max(0.8, s * 0.05);
        ctx.beginPath(); ctx.moveTo(jaw(0).x, jaw(0).y); ctx.lineTo(jaw(1).x, jaw(1).y); ctx.stroke();
        if (s > 4) {
          ctx.fillStyle = '#f1ede4';
          for (let k = 0; k < 9; k++) {
            const j = jaw(0.06 + k * 0.1), w = s * 0.025;
            ctx.beginPath(); ctx.moveTo(j.x - w, j.y); ctx.lineTo(j.x, j.y - s * 0.07); ctx.lineTo(j.x + w, j.y); ctx.fill();
          }
        }
      },
    },
    // Legend: an armoured sea dragon with a glowing lateral line and ember eyes.
    leviathan: (() => {
      const row = bellyRow(12, 0.16, 0.86, '80,240,210', 0.05, 0.1);
      return {
        L: 3.4, H: 0.5, k: 0.45, top: '#10262e', mid: '#1d4148', belly: '#8fa89a', finColor: '#14323a', tail: 'fork', tailSize: 1.3, swim: 0.3, nose: 0.8,
        fins: [{ u: 0.7, len: 0.1, h: 0.5 }, { u: 0.6, len: 0.1, h: 0.45, side: 'bottom' }, { u: 0.24, len: 0.34, h: 0.7, front: true, angle: -0.1 }],
        eye: { u: 0.08, r: 0.06, up: 0.3, iris: '#ffb347' }, edge: 'rgba(0,10,12,0.55)',
        extra(ctx, pts, s) {
          // overlapping scales
          ctx.strokeStyle = 'rgba(140,210,195,0.16)'; ctx.lineWidth = Math.max(0.5, s * 0.025);
          for (let k = 0; k < 16; k++) {
            const p = pts.at(0.1 + k * 0.05);
            for (let j = -1; j <= 1; j++) { ctx.beginPath(); ctx.arc(p.x, p.y + j * p.t * 0.5, s * 0.09, -Math.PI / 2, Math.PI / 2); ctx.stroke(); }
          }
        },
        head(ctx, pts, s) {
          // a crest of spikes along the back
          ctx.fillStyle = '#0b1c22';
          for (let k = 0; k < 11; k++) {
            const p = pts.at(0.1 + k * 0.06), h = s * (0.38 - k * 0.025);
            ctx.beginPath(); ctx.moveTo(p.x + s * 0.07, p.y - p.t * 0.92); ctx.lineTo(p.x - s * 0.12, p.y - p.t - h); ctx.lineTo(p.x - s * 0.13, p.y - p.t * 0.88); ctx.fill();
          }
          // swept-back horns
          const h = pts.at(0.06);
          ctx.fillStyle = '#d8cfb8';
          for (const [dx, k] of [[0, 1], [-s * 0.14, 0.75]]) {
            ctx.beginPath(); ctx.moveTo(h.x + dx + s * 0.06, h.y - h.t * 0.75); ctx.quadraticCurveTo(h.x + dx - s * 0.05, h.y - h.t - s * 0.2 * k, h.x + dx - s * 0.32 * k, h.y - h.t - s * 0.24 * k);
            ctx.quadraticCurveTo(h.x + dx - s * 0.06, h.y - h.t - s * 0.05, h.x + dx - s * 0.06, h.y - h.t * 0.7); ctx.fill();
          }
          // the jaw line and teeth
          const a = pts.at(0), b = pts.at(0.13);
          ctx.strokeStyle = 'rgba(5,12,14,0.8)'; ctx.lineWidth = Math.max(0.6, s * 0.03);
          ctx.beginPath(); ctx.moveTo(a.x, a.y + a.t * 0.1); ctx.lineTo(b.x, b.y + b.t * 0.25); ctx.stroke();
          ctx.strokeStyle = '#efe6d6'; ctx.lineWidth = Math.max(0.5, s * 0.02);
          ctx.beginPath();
          for (let k = 0; k < 6; k++) { const x = a.x - (a.x - b.x) * (k + 0.5) / 6, y = a.y + (b.y + b.t * 0.25 - a.y) * (k + 0.5) / 6; ctx.moveTo(x, y); ctx.lineTo(x - s * 0.02, y + s * 0.07); }
          ctx.stroke();
        },
        dots: row.dots,
        lights(ctx, pts, s, ph) {
          row.lights(ctx, pts, s, ph);
          const e = pts.at(0.08);
          glowDot(ctx, e.x, e.y - e.t * 0.3, Math.max(5, s * 0.35), '255,170,70', 0.9);
        },
      };
    })(),
  };

  function angLure(pts, s, ph) {
    const base = pts.at(0.12);
    const x0 = base.x, y0 = base.y - base.t * 0.95;
    return { x0, y0, cx: x0 + s * 0.4, cy: y0 - s * 0.9, x: x0 + s * 0.95 + Math.sin(ph * 0.8) * s * 0.06, y: y0 - s * 0.35 + Math.cos(ph * 0.9) * s * 0.06 };
  }

  // ───────────── Other body plans ─────────────
  const OTHER = {
    diatom(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      ctx.rotate(ph * 0.1);
      const g = ctx.createRadialGradient(-s * 0.3, -s * 0.3, 0, 0, 0, s * 1.2);
      g.addColorStop(0, 'rgba(240,235,170,0.95)'); g.addColorStop(1, 'rgba(160,170,70,0.75)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(90,100,30,0.6)'; ctx.lineWidth = Math.max(0.4, s * 0.06);
      ctx.beginPath(); ctx.arc(0, 0, s * 0.95, 0, TAU);
      for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; ctx.moveTo(Math.cos(a) * s * 0.25, Math.sin(a) * s * 0.25); ctx.lineTo(Math.cos(a) * s * 0.9, Math.sin(a) * s * 0.9); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(180,120,40,0.55)'; ctx.beginPath(); ctx.arc(0, 0, s * 0.25, 0, TAU); ctx.fill();
    },
    noctiluca(ctx, s, ph, mode) {
      if (mode === 'lights') { glowDot(ctx, 0, 0, s * 3.2, '90,190,255', 0.55 + 0.25 * Math.sin(ph * 2)); return; }
      const g = ctx.createRadialGradient(-s * 0.3, -s * 0.3, 0, 0, 0, s * 1.1);
      g.addColorStop(0, 'rgba(225,245,255,0.75)'); g.addColorStop(1, 'rgba(120,190,240,0.35)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(200,235,255,0.7)'; ctx.lineWidth = Math.max(0.4, s * 0.08);
      ctx.beginPath(); ctx.moveTo(-s * 0.9, 0); ctx.quadraticCurveTo(-s * 1.4, Math.sin(ph * 3) * s * 0.4, -s * 1.8, Math.sin(ph * 3 + 1) * s * 0.3); ctx.stroke();
    },
    snow(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      ctx.rotate(ph * 0.05);
      ctx.fillStyle = 'rgba(225,230,225,0.55)';
      for (let k = 0; k < 7; k++) { const a = k * 2.4; ctx.beginPath(); ctx.arc(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.45, s * (0.35 + (k % 3) * 0.1), 0, TAU); ctx.fill(); }
      ctx.fillStyle = 'rgba(160,140,110,0.6)'; ctx.beginPath(); ctx.arc(s * 0.1, 0, s * 0.25, 0, TAU); ctx.fill();
    },
    ciliate(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      const L = s * 1.6, Hh = s * 0.75;
      const shape = () => {
        ctx.beginPath(); ctx.moveTo(L, 0);
        ctx.bezierCurveTo(L, -Hh * 1.1, -L * 0.6, -Hh * 1.2, -L, -Hh * 0.1);
        ctx.bezierCurveTo(-L * 1.05, Hh * 0.6, -L * 0.2, Hh * 0.5, 0, Hh * 0.35);
        ctx.bezierCurveTo(L * 0.3, Hh * 0.9, L, Hh * 0.9, L, 0); ctx.closePath();
      };
      // cilia beating in a wave
      ctx.strokeStyle = 'rgba(200,250,210,0.55)'; ctx.lineWidth = Math.max(0.4, s * 0.04);
      ctx.beginPath();
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * TAU, x = Math.cos(a) * L * 0.98, y = Math.sin(a) * Hh * 0.95, w = Math.sin(ph * 6 - k * 0.7) * 0.35;
        ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a + w) * s * 0.28, y + Math.sin(a + w) * s * 0.28);
      }
      ctx.stroke();
      shape();
      const g = ctx.createRadialGradient(L * 0.3, -Hh * 0.4, 0, 0, 0, L);
      g.addColorStop(0, 'rgba(220,255,215,0.7)'); g.addColorStop(1, 'rgba(120,200,140,0.5)');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(210,255,215,0.85)'; ctx.lineWidth = Math.max(0.5, s * 0.07); ctx.stroke();
      ctx.fillStyle = 'rgba(70,130,90,0.75)'; ctx.beginPath(); ctx.ellipse(0, -Hh * 0.1, s * 0.4, s * 0.28, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(L * 0.55, -Hh * 0.15, s * 0.16 * (1 + 0.3 * Math.sin(ph * 2)), 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(-L * 0.6, -Hh * 0.2, s * 0.14 * (1 + 0.3 * Math.cos(ph * 2)), 0, TAU); ctx.fill();
    },
    radiolarian(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      ctx.rotate(ph * 0.08);
      ctx.strokeStyle = 'rgba(235,225,200,0.8)'; ctx.lineWidth = Math.max(0.4, s * 0.05);
      ctx.beginPath();
      for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; ctx.moveTo(Math.cos(a) * s * 0.75, Math.sin(a) * s * 0.75); ctx.lineTo(Math.cos(a) * s * 1.6, Math.sin(a) * s * 1.6); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(240,205,140,0.4)'; ctx.beginPath(); ctx.arc(0, 0, s * 0.85, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(250,240,215,0.9)';
      ctx.beginPath(); ctx.arc(0, 0, s * 0.85, 0, TAU); ctx.arc(0, 0, s * 0.5, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(30,25,20,0.55)';
      for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU + 0.3; ctx.beginPath(); ctx.arc(Math.cos(a) * s * 0.67, Math.sin(a) * s * 0.67, s * 0.1, 0, TAU); ctx.fill(); }
      ctx.fillStyle = 'rgba(230,140,80,0.8)'; ctx.beginPath(); ctx.arc(0, 0, s * 0.3, 0, TAU); ctx.fill();
    },
    foram(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      ctx.strokeStyle = 'rgba(240,230,210,0.35)'; ctx.lineWidth = Math.max(0.3, s * 0.03);
      ctx.beginPath();
      for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU + Math.sin(ph + k) * 0.1; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * s * 2, Math.sin(a) * s * 2); }
      ctx.stroke();
      for (let k = 7; k >= 0; k--) {
        const a = k * 0.9, rr = s * 0.18 * (1 + k * 0.17), d = s * 0.12 * k;
        ctx.fillStyle = `rgba(${235 - k * 6},${215 - k * 8},${185 - k * 10},0.95)`;
        ctx.beginPath(); ctx.arc(Math.cos(a) * d * 0.7, Math.sin(a) * d * 0.7, rr, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(120,90,60,0.5)'; ctx.stroke();
      }
    },
    xeno(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      ctx.fillStyle = '#8e826d';
      const pts = [];
      for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU, rr = s * (0.85 + 0.25 * Math.sin(k * 2.7)); pts.push({ x: Math.cos(a) * rr * 1.2, y: Math.sin(a) * rr }); }
      smooth(ctx, pts); ctx.fill();
      ctx.fillStyle = 'rgba(60,52,40,0.6)';
      for (let k = 0; k < 9; k++) { ctx.beginPath(); ctx.arc(Math.cos(k * 2.1) * s * 0.6, Math.sin(k * 1.7) * s * 0.5, s * 0.12, 0, TAU); ctx.fill(); }
      ctx.fillStyle = 'rgba(200,190,170,0.35)';
      for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(Math.cos(k * 1.3 + 1) * s * 0.4, Math.sin(k * 2.3) * s * 0.4, s * 0.15, 0, TAU); ctx.fill(); }
    },
    copepod(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      const L = s * 1.4;
      // long first antennae, flicking
      ctx.strokeStyle = 'rgba(255,215,170,0.8)'; ctx.lineWidth = Math.max(0.4, s * 0.05);
      const fl = Math.sin(ph * 5) * 0.2;
      ctx.beginPath();
      ctx.moveTo(L * 0.6, -s * 0.1); ctx.quadraticCurveTo(L * 0.9, -s * 1.2, L * 0.2, -s * (2.2 + fl));
      ctx.moveTo(L * 0.6, s * 0.1); ctx.quadraticCurveTo(L * 0.9, s * 1.2, L * 0.2, s * (2.2 + fl));
      ctx.stroke();
      const g = ctx.createLinearGradient(L, 0, -L, 0);
      g.addColorStop(0, 'rgba(255,190,140,0.9)'); g.addColorStop(1, 'rgba(240,140,110,0.75)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(L * 0.2, 0, L * 0.55, s * 0.55, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-L * 0.3, -s * 0.2); ctx.lineTo(-L * 0.95, -s * 0.08); ctx.lineTo(-L * 0.95, s * 0.08); ctx.lineTo(-L * 0.3, s * 0.2); ctx.fill();
      ctx.strokeStyle = 'rgba(240,140,110,0.8)';
      ctx.beginPath(); ctx.moveTo(-L * 0.95, 0); ctx.lineTo(-L * 1.25, -s * 0.3); ctx.moveTo(-L * 0.95, 0); ctx.lineTo(-L * 1.25, s * 0.3); ctx.stroke();
      ctx.fillStyle = '#b8122a'; ctx.beginPath(); ctx.arc(L * 0.6, 0, Math.max(0.6, s * 0.12), 0, TAU); ctx.fill();
    },
    krill(ctx, s, ph, mode, deep) {
      const L = s * 2.3;
      if (mode === 'lights') {
        if (!deep) return;
        for (let k = 0; k < 4; k++) glowDot(ctx, L * (0.3 - k * 0.2), s * 0.35, Math.max(3, s * 0.6), '110,180,255', 0.5 + 0.3 * Math.sin(ph * 3 + k));
        return;
      }
      const shell = deep ? ['rgba(200,30,40,0.92)', 'rgba(230,60,60,0.92)'] : ['rgba(242,140,120,0.8)', 'rgba(250,170,150,0.8)'];
      ctx.strokeStyle = deep ? 'rgba(230,90,90,0.8)' : 'rgba(255,190,170,0.75)'; ctx.lineWidth = Math.max(0.5, s * 0.06); ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < 6; k++) { const x = L * (0.3 - k * 0.12); ctx.moveTo(x, s * 0.3); ctx.lineTo(x - s * 0.12, s * (0.75 + 0.2 * Math.sin(ph * 7 - k * 0.8))); }
      ctx.moveTo(L * 0.5, -s * 0.1); ctx.quadraticCurveTo(L * 0.9, -s * 0.9, L * (deep ? 1.5 : 1.15), -s * 0.5 + Math.sin(ph) * s * 0.2);
      ctx.moveTo(L * 0.5, 0); ctx.quadraticCurveTo(L * 0.9, -s * 0.4, L * (deep ? 1.6 : 1.2), -s * 0.1 + Math.sin(ph + 1) * s * 0.15);
      ctx.stroke();
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = shell[k % 2];
        ctx.beginPath(); ctx.ellipse(L * (0.32 - k * 0.17), -k * s * 0.03, s * (0.42 - k * 0.04), s * (0.38 - k * 0.04), 0, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = shell[0];
      ctx.beginPath(); ctx.moveTo(-L * 0.45, -s * 0.1); ctx.lineTo(-L * 0.75, -s * 0.4); ctx.lineTo(-L * 0.7, 0); ctx.lineTo(-L * 0.75, s * 0.3); ctx.fill();
      if (!deep) { ctx.fillStyle = 'rgba(190,40,40,0.5)'; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(L * (0.3 - k * 0.17), s * 0.15, s * 0.07, 0, TAU); ctx.fill(); } }
      eye(ctx, L * 0.45, -s * 0.12, Math.max(0.7, s * 0.14), '#222');
    },
    amphipod(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      // a curled, segmented scavenger
      ctx.strokeStyle = 'rgba(230,215,190,0.85)'; ctx.lineWidth = Math.max(0.5, s * 0.06); ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI * (0.15 + k * 0.13); const x = Math.cos(a) * s, y = Math.sin(a) * s * 0.7; ctx.moveTo(x, y); ctx.lineTo(x * 1.2, y + s * (0.5 + 0.15 * Math.sin(ph * 6 + k))); }
      ctx.moveTo(s * 1.0, -s * 0.2); ctx.quadraticCurveTo(s * 1.8, -s * 0.6, s * 2.1, -s * 0.2 + Math.sin(ph * 2) * s * 0.15);
      ctx.stroke();
      for (let k = 0; k < 8; k++) {
        const a = Math.PI * (-0.1 + k * 0.15), rr = s * (0.42 - k * 0.02);
        ctx.fillStyle = k % 2 ? 'rgba(225,205,175,0.95)' : 'rgba(240,225,200,0.95)';
        ctx.beginPath(); ctx.ellipse(Math.cos(-a) * s * 0.8, -Math.sin(-a) * s * 0.55 - s * 0.2, rr, rr * 0.85, -a, 0, TAU); ctx.fill();
      }
      eye(ctx, s * 0.95, -s * 0.3, Math.max(0.6, s * 0.08), '#222');
    },
    moonjelly(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      const pulse = 1 + Math.sin(ph * 2) * 0.1;
      // fringe tentacles trailing behind the bell
      ctx.strokeStyle = 'rgba(225,220,255,0.35)'; ctx.lineWidth = Math.max(0.4, s * 0.025);
      ctx.beginPath();
      for (let k = 0; k < 14; k++) {
        const y0 = s * (k / 13 - 0.5) * 1.8 / pulse;
        ctx.moveTo(-s * 0.15, y0);
        for (let j = 1; j <= 5; j++) ctx.lineTo(-s * 0.15 - j * s * 0.3, y0 + Math.sin(ph * 2 + j + k) * s * 0.06);
      }
      ctx.stroke();
      // oral arms
      ctx.strokeStyle = 'rgba(240,200,240,0.55)'; ctx.lineWidth = Math.max(0.6, s * 0.08);
      ctx.beginPath();
      for (let k = 0; k < 4; k++) { const y0 = s * (k / 3 - 0.5) * 0.5; ctx.moveTo(0, y0); ctx.bezierCurveTo(-s * 0.5, y0 + s * 0.3 * Math.sin(ph + k), -s * 0.8, y0 - s * 0.2, -s * 1.2, y0 + Math.sin(ph * 1.5 + k) * s * 0.2); }
      ctx.stroke();
      const g = ctx.createRadialGradient(s * 0.3, 0, 0, 0, 0, s * 1.1);
      g.addColorStop(0, 'rgba(245,240,255,0.65)'); g.addColorStop(1, 'rgba(190,180,240,0.3)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.75 * pulse, s * 1.0 / pulse, 0, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(240,235,255,0.6)'; ctx.lineWidth = Math.max(0.5, s * 0.04); ctx.stroke();
      // four violet rings
      ctx.strokeStyle = 'rgba(180,110,210,0.75)'; ctx.lineWidth = Math.max(0.6, s * 0.08);
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(s * 0.3, s * (k / 3 - 0.5) * 0.9 / pulse, s * 0.16, 0, TAU); ctx.stroke(); }
    },
    combjelly(ctx, s, ph, mode) {
      const rows = 8;
      if (mode === 'lights') {
        for (let k = 0; k < rows; k++) {
          const y = s * (k / (rows - 1) - 0.5) * 1.3, hue = (ph * 80 + k * 45) % 360;
          ctx.strokeStyle = `hsla(${hue},100%,65%,0.5)`; ctx.lineWidth = Math.max(2, s * 0.15);
          ctx.beginPath(); ctx.moveTo(s * 0.8, y * 0.6); ctx.quadraticCurveTo(0, y * 1.1, -s * 0.8, y * 0.6); ctx.stroke();
        }
        return;
      }
      ctx.fillStyle = 'rgba(220,235,255,0.22)';
      ctx.beginPath(); ctx.ellipse(0, 0, s * 1.1, s * 0.85, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(230,240,255,0.45)'; ctx.lineWidth = Math.max(0.4, s * 0.03); ctx.stroke();
      for (let k = 0; k < rows; k++) {
        const y = s * (k / (rows - 1) - 0.5) * 1.3;
        for (let j = 0; j < 9; j++) {
          const u = j / 8, x = s * 0.8 - u * s * 1.6, yy = y * (0.6 + 0.5 * Math.sin(u * Math.PI));
          const hue = (ph * 80 + k * 45 + j * 25) % 360;
          ctx.fillStyle = `hsla(${hue},95%,70%,0.85)`;
          ctx.fillRect(x - Math.max(0.5, s * 0.05), yy - Math.max(0.4, s * 0.025), Math.max(1, s * 0.1), Math.max(0.8, s * 0.05));
        }
      }
    },
    squid(ctx, s, ph, mode, opt = {}) {
      const L = s * 2.4, H = s * 0.7 * (opt.wide || 1);
      const mantle = opt.mantle || ['#e9785d', '#c8513b'], arm = opt.arm || '#d0573c';
      if (mode === 'lights') {
        if (opt.glowEye) glowDot(ctx, L * 0.22, -H * 0.15, Math.max(5, s * 0.6), opt.glowEye, 0.85);
        return;
      }
      // arms trail ahead of the head (+x), two long tentacles for the giant
      ctx.strokeStyle = arm; ctx.lineCap = 'round';
      const arms = 8;
      for (let k = 0; k < arms; k++) {
        const y0 = H * (k / (arms - 1) - 0.5) * 0.7;
        ctx.lineWidth = Math.max(0.8, s * 0.09 * (opt.thick || 1));
        ctx.beginPath(); ctx.moveTo(L * 0.25, y0);
        ctx.quadraticCurveTo(L * 0.55, y0 + Math.sin(ph * 3 + k) * H * 0.5, L * (0.8 + (k % 3) * 0.04), y0 * 1.5 + Math.sin(ph * 3 + k + 1) * H * 0.35);
        ctx.stroke();
      }
      if (opt.tentacles) {
        ctx.lineWidth = Math.max(0.7, s * 0.05);
        for (const side of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(L * 0.25, side * H * 0.1);
          ctx.bezierCurveTo(L * 0.8, side * H * 0.8 + Math.sin(ph * 2) * H, L * 1.2, side * H * 0.2, L * 1.7, side * H * 0.5 + Math.sin(ph * 2 + side) * H * 0.6);
          ctx.stroke();
          const cy = side * H * 0.5 + Math.sin(ph * 2 + side) * H * 0.6;
          ctx.fillStyle = arm; ctx.beginPath(); ctx.ellipse(L * 1.7, cy, s * 0.18, s * 0.08, 0, 0, TAU); ctx.fill();
          // swivelling hooks on the club
          if (opt.hooks && s > 5) {
            ctx.strokeStyle = '#f3ead8'; ctx.lineWidth = Math.max(0.5, s * 0.02);
            for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.arc(L * 1.7 + k * s * 0.07, cy - s * 0.02, s * 0.035, Math.PI, Math.PI * 1.9); ctx.stroke(); }
            ctx.strokeStyle = arm; ctx.lineWidth = Math.max(0.7, s * 0.05);
          }
        }
      }
      // fins at the rear, rippling
      const fl = Math.sin(ph * 4) * H * 0.15;
      ctx.fillStyle = mantle[1];
      ctx.beginPath(); ctx.moveTo(-L * 0.5, 0); ctx.quadraticCurveTo(-L * 0.35, -H * 0.95 - fl, -L * 0.15, -H * 0.15); ctx.lineTo(-L * 0.15, H * 0.15); ctx.quadraticCurveTo(-L * 0.35, H * 0.95 + fl, -L * 0.5, 0); ctx.fill();
      const g = ctx.createLinearGradient(0, -H, 0, H);
      g.addColorStop(0, mantle[0]); g.addColorStop(1, mantle[1]);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-L * 0.55, 0);
      ctx.bezierCurveTo(-L * 0.4, -H * 0.55, L * 0.15, -H * 0.6, L * 0.3, -H * 0.3);
      ctx.lineTo(L * 0.3, H * 0.3);
      ctx.bezierCurveTo(L * 0.15, H * 0.6, -L * 0.4, H * 0.55, -L * 0.55, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(60,15,10,0.3)'; ctx.lineWidth = Math.max(0.5, s * 0.03); ctx.stroke();
      // chromatophores flickering
      for (let k = 0; k < 10; k++) {
        const a = Math.sin(ph * 3 + k * 1.7) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(120,30,20,${0.15 + a * 0.35})`;
        ctx.beginPath(); ctx.arc(-L * 0.35 + (k % 5) * L * 0.12, (k < 5 ? -1 : 1) * H * 0.18, s * 0.06, 0, TAU); ctx.fill();
      }
      eye(ctx, L * 0.22, -H * 0.15, Math.max(0.8, s * (opt.eye || 0.15)), '#e6e0c8');
    },
    vampire(ctx, s, ph, mode) {
      const L = s * 1.6, H = s * 0.9;
      if (mode === 'lights') {
        for (let k = 0; k < 8; k++) glowDot(ctx, L * 0.9 + Math.sin(ph * 2 + k) * s * 0.1, H * (k / 7 - 0.5) * 1.6, Math.max(4, s * 0.45), '110,170,255', 0.6 + 0.3 * Math.sin(ph * 3 + k));
        return;
      }
      // the webbed cloak
      ctx.fillStyle = 'rgba(80,10,20,0.92)';
      ctx.beginPath(); ctx.moveTo(0, -H * 0.4);
      for (let k = 0; k <= 8; k++) {
        const y = H * (k / 8 - 0.5) * 1.6, x = L * 0.95 + Math.sin(ph * 2 + k) * s * 0.1;
        ctx.quadraticCurveTo(L * 0.7, y - H * 0.1, x, y);
      }
      ctx.lineTo(0, H * 0.4); ctx.closePath(); ctx.fill();
      const g = ctx.createRadialGradient(-L * 0.1, -H * 0.2, 0, 0, 0, L);
      g.addColorStop(0, '#8e1f2d'); g.addColorStop(1, '#4a0c16');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(-L * 0.1, 0, L * 0.5, H * 0.45, 0, 0, TAU); ctx.fill();
      // ear-like fins
      const fl = Math.sin(ph * 3) * 0.3;
      ctx.fillStyle = '#6d1522';
      ctx.beginPath(); ctx.ellipse(-L * 0.45, -H * 0.4, s * 0.35, s * 0.16, -0.8 + fl, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-L * 0.45, H * 0.4, s * 0.35, s * 0.16, 0.8 - fl, 0, TAU); ctx.fill();
      eye(ctx, L * 0.15, -H * 0.12, Math.max(0.8, s * 0.17), '#5aa0ff');
    },
    dumbo(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      const fl = Math.sin(ph * 2.5) * 0.45;
      ctx.fillStyle = 'rgba(245,190,175,0.9)';
      ctx.beginPath(); ctx.ellipse(-s * 0.2, -s * 0.85, s * 0.45, s * 0.22, -0.6 + fl, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-s * 0.2, s * 0.85, s * 0.45, s * 0.22, 0.6 - fl, 0, TAU); ctx.fill();
      // short webbed arms
      ctx.fillStyle = 'rgba(240,170,160,0.8)';
      ctx.beginPath(); ctx.moveTo(s * 0.4, -s * 0.5);
      for (let k = 0; k <= 6; k++) { const y = s * (k / 6 - 0.5) * 1.3; ctx.quadraticCurveTo(s * 0.9, y - s * 0.1, s * 1.15 + Math.sin(ph * 2 + k) * s * 0.08, y); }
      ctx.lineTo(s * 0.4, s * 0.5); ctx.closePath(); ctx.fill();
      const g = ctx.createRadialGradient(-s * 0.3, -s * 0.3, 0, 0, 0, s * 1.1);
      g.addColorStop(0, '#ffd9cc'); g.addColorStop(1, '#e8a08f');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(-s * 0.1, 0, s * 0.85, s * 0.7, 0, 0, TAU); ctx.fill();
      eye(ctx, s * 0.35, -s * 0.25, Math.max(0.7, s * 0.12), '#333');
    },
    gulper(ctx, s, ph, mode) {
      const L = s * 3.6;
      const tailAt = (u) => ({ x: L * (0.3 - u), y: Math.sin(ph * 3 - u * 6) * s * 0.25 * u });
      if (mode === 'lights') { const p = tailAt(1.05); glowDot(ctx, p.x, p.y, Math.max(6, s * 0.7), '255,110,160', 0.8); return; }
      // whip body: a pale rim under a dark core, so it reads against black water
      ctx.lineCap = 'round';
      for (const [col, rim] of [['rgba(200,160,225,0.45)', s * 0.07], ['#3b2a47', 0]]) {
        ctx.strokeStyle = col;
        for (let i = 0; i < 12; i++) {
          const a = tailAt(i / 12), b = tailAt((i + 1) / 12);
          ctx.lineWidth = Math.max(0.6, s * 0.3 * (1 - i / 12) + s * 0.03) + rim;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      const tip = tailAt(1.05);
      ctx.fillStyle = '#ff86b6'; ctx.beginPath(); ctx.arc(tip.x, tip.y, Math.max(0.8, s * 0.09), 0, TAU); ctx.fill();
      // the enormous mouth: two thin jaws hinged far back, a pouch sagging under the lower one
      const open = 0.6 + 0.4 * Math.sin(ph * 0.8);
      const hx = L * 0.2, fx = L * 0.66, up = -s * (0.55 * open + 0.15), lo = s * (0.75 * open + 0.2);
      ctx.fillStyle = 'rgba(88,62,104,0.95)';
      ctx.beginPath(); ctx.moveTo(hx, s * 0.12); ctx.quadraticCurveTo(L * 0.38, lo + s * 0.6 * open, fx, lo); ctx.lineTo(hx, s * 0.12); ctx.fill();
      ctx.strokeStyle = 'rgba(215,180,235,0.55)'; ctx.lineWidth = Math.max(0.6, s * 0.035);
      ctx.beginPath(); ctx.moveTo(hx, s * 0.12); ctx.quadraticCurveTo(L * 0.38, lo + s * 0.6 * open, fx, lo); ctx.stroke();
      ctx.fillStyle = '#0d0612';
      ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(fx, up); ctx.lineTo(fx, lo); ctx.closePath(); ctx.fill();
      ctx.lineWidth = Math.max(0.8, s * 0.09);
      ctx.strokeStyle = '#5d4570'; ctx.beginPath(); ctx.moveTo(hx - s * 0.1, -s * 0.08); ctx.lineTo(fx, up); ctx.stroke();
      ctx.strokeStyle = '#6f5482'; ctx.beginPath(); ctx.moveTo(hx - s * 0.1, s * 0.1); ctx.lineTo(fx, lo); ctx.stroke();
      if (s > 6) {
        ctx.fillStyle = 'rgba(240,235,245,0.85)';
        for (let k = 1; k < 8; k++) {
          const u = k / 8, w = s * 0.02;
          const ux = hx + (fx - hx) * u, uy = up * u, ly = s * 0.1 + (lo - s * 0.1) * u;
          ctx.beginPath(); ctx.moveTo(ux - w, uy + s * 0.03); ctx.lineTo(ux, uy + s * 0.09); ctx.lineTo(ux + w, uy + s * 0.03); ctx.fill();
          ctx.beginPath(); ctx.moveTo(ux - w, ly - s * 0.03); ctx.lineTo(ux, ly - s * 0.09); ctx.lineTo(ux + w, ly - s * 0.03); ctx.fill();
        }
      }
      // tiny eyes sit right at the snout
      eye(ctx, fx - s * 0.12, up + s * 0.05, Math.max(0.6, s * 0.06), '#9a8fa6');
    },
    // Legend: a giant cephalopod. A warty bulbous mantle, eight thick arms that curl at the tips,
    // two long clubbed tentacles, suckers and a burning slit eye.
    kraken(ctx, s, ph, mode) {
      const L = s * 2.6, H = s * 0.95, N = 16;
      const eyeX = L * 0.1, eyeY = -H * 0.25;
      const spots = [[-0.45, -0.35], [-0.3, -0.55], [-0.15, -0.45], [-0.4, 0.3], [-0.2, 0.45], [0, -0.6]];
      if (mode === 'lights') {
        glowDot(ctx, eyeX, eyeY, Math.max(6, s * 0.75), '255,170,60', 0.9);
        spots.forEach(([u, v], i) => glowDot(ctx, L * u, H * v, Math.max(3, s * 0.22), '190,140,255', 0.35 + 0.25 * Math.sin(ph * 1.5 + i)));
        return;
      }
      // the centre line of an arm: out of the head, waving, curling at the tip
      const line = (k, n, len, fan, curl) => {
        const pts = [], seg = len / N;
        let x = L * 0.16, y = H * (k / (n - 1) - 0.5) * 0.6, a = fan * (k / (n - 1) - 0.5);
        for (let i = 0; i <= N; i++) {
          const u = i / N;
          pts.push({ x, y, u });
          a += Math.cos(ph * 2 + k * 1.7 - u * 3) * 0.07 + curl * Math.max(0, u - 0.55) * 0.9;
          x += Math.cos(a) * seg; y += Math.sin(a) * seg;
        }
        return pts;
      };
      // fill a tapering band along a line; returns the inner edge for suckers
      const band = (pts, w0, w1, color) => {
        const lf = [], rt = [], inner = [];
        pts.forEach((p, i) => {
          const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
          const dx = q.x - o.x, dy = q.y - o.y, d = Math.hypot(dx, dy) || 1, w = w0 + (w1 - w0) * p.u;
          lf.push([p.x - (dy / d) * w, p.y + (dx / d) * w]); rt.push([p.x + (dy / d) * w, p.y - (dx / d) * w]);
          inner.push({ x: p.x - (dy / d) * w * 0.45, y: p.y + (dx / d) * w * 0.45, r: w * 0.32 });
        });
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(lf[0][0], lf[0][1]);
        for (const [x, y] of lf) ctx.lineTo(x, y);
        for (const [x, y] of rt.reverse()) ctx.lineTo(x, y);
        ctx.closePath(); ctx.fill();
        return inner;
      };
      const suckers = (inner, from) => {
        if (s < 6) return;
        ctx.fillStyle = 'rgba(225,195,235,0.75)';
        for (let i = from; i < inner.length - 1; i += 2) { const c = inner[i]; ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(0.5, c.r), 0, TAU); ctx.fill(); }
      };
      const arms = 8;
      const curlOf = (k) => (k < arms / 2 ? 1.5 : -1.5); // tips curl back towards the middle
      // back arms, darker
      for (let k = 1; k < arms; k += 2) band(line(k, arms, L * 1.1, 0.9, curlOf(k)), s * 0.2, s * 0.03, '#36224a');
      // the two long tentacles with clubs
      for (const k of [0, 1]) {
        const pts = line(k, 2, L * 1.6, 0.5, k ? -0.5 : 0.5);
        band(pts, s * 0.07, s * 0.035, '#4a3060');
        const end = pts[pts.length - 1], prev = pts[pts.length - 3];
        ctx.save(); ctx.translate(end.x, end.y); ctx.rotate(Math.atan2(end.y - prev.y, end.x - prev.x));
        ctx.fillStyle = '#5b3c74'; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.26, s * 0.1, 0, 0, TAU); ctx.fill();
        if (s > 6) { ctx.fillStyle = 'rgba(225,195,235,0.75)'; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(i * s * 0.09, s * 0.03, s * 0.03, 0, TAU); ctx.fill(); } }
        ctx.restore();
      }
      // front arms
      for (let k = 0; k < arms; k += 2) suckers(band(line(k, arms, L * 1.15, 0.9, curlOf(k)), s * 0.22, s * 0.03, '#5a3a78'), 3);
      // fins at the rear
      const fl = Math.sin(ph * 3) * H * 0.1;
      ctx.fillStyle = '#3b2652';
      ctx.beginPath(); ctx.moveTo(-L * 0.66, 0); ctx.quadraticCurveTo(-L * 0.55, -H * 0.95 - fl, -L * 0.38, -H * 0.35);
      ctx.lineTo(-L * 0.38, H * 0.35); ctx.quadraticCurveTo(-L * 0.55, H * 0.95 + fl, -L * 0.66, 0); ctx.fill();
      // the bulbous mantle
      const mantle = () => {
        ctx.beginPath(); ctx.moveTo(-L * 0.62, 0);
        ctx.bezierCurveTo(-L * 0.55, -H * 1.05, L * 0.08, -H * 1.0, L * 0.26, -H * 0.38);
        ctx.lineTo(L * 0.26, H * 0.38);
        ctx.bezierCurveTo(L * 0.08, H * 0.95, -L * 0.55, H * 0.9, -L * 0.62, 0);
      };
      const g = ctx.createRadialGradient(-L * 0.2, -H * 0.45, s * 0.1, -L * 0.15, 0, L * 0.7);
      g.addColorStop(0, '#9a72bc'); g.addColorStop(0.55, '#5c3b7c'); g.addColorStop(1, '#24142f');
      mantle(); ctx.fillStyle = g; ctx.fill();
      ctx.save(); mantle(); ctx.clip();
      // ridges, warts and old scars from sperm whale fights
      ctx.strokeStyle = 'rgba(25,10,35,0.35)'; ctx.lineWidth = Math.max(0.5, s * 0.03);
      for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(-L * 0.6, k * H * 0.12); ctx.quadraticCurveTo(-L * 0.2, k * H * 0.35, L * 0.24, k * H * 0.14); ctx.stroke(); }
      if (s > 5) {
        for (let k = 0; k < 18; k++) {
          const x = -L * 0.55 + ((k * 0.61) % 1) * L * 0.75, y = H * (((k * 0.37) % 1) - 0.5) * 1.3;
          ctx.fillStyle = 'rgba(190,150,215,0.35)'; ctx.beginPath(); ctx.arc(x, y, s * 0.045, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(20,8,30,0.3)'; ctx.beginPath(); ctx.arc(x + s * 0.015, y + s * 0.015, s * 0.03, 0, TAU); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(235,215,240,0.35)'; ctx.lineWidth = Math.max(0.5, s * 0.025);
        for (const [x, y, r] of [[-0.35, 0.2, 0.12], [-0.1, 0.35, 0.09], [-0.45, -0.2, 0.08]]) { ctx.beginPath(); ctx.arc(L * x, H * y, s * r, 0.3, 2.6); ctx.stroke(); }
      }
      spots.forEach(([u, v]) => { ctx.fillStyle = 'rgba(215,185,255,0.8)'; ctx.beginPath(); ctx.arc(L * u, H * v, Math.max(0.5, s * 0.05), 0, TAU); ctx.fill(); });
      ctx.restore();
      mantle(); ctx.strokeStyle = 'rgba(15,5,25,0.5)'; ctx.lineWidth = Math.max(0.6, s * 0.035); ctx.stroke();
      // the eye: an amber iris with a horizontal slit, under a heavy lid
      const er = Math.max(0.8, s * 0.2);
      ctx.fillStyle = '#1a0d22'; ctx.beginPath(); ctx.arc(eyeX, eyeY, er * 1.25, 0, TAU); ctx.fill();
      const ig = ctx.createRadialGradient(eyeX, eyeY, 0, eyeX, eyeY, er);
      ig.addColorStop(0, '#ffe08a'); ig.addColorStop(0.6, '#ffa531'); ig.addColorStop(1, '#a5420e');
      ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(eyeX, eyeY, er, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0a0408'; ctx.beginPath(); ctx.ellipse(eyeX, eyeY, er * 0.75, er * 0.18, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2a173a'; ctx.lineWidth = Math.max(0.6, er * 0.35);
      ctx.beginPath(); ctx.arc(eyeX, eyeY + er * 0.3, er * 1.25, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    },
    siphonophore(ctx, s, ph, mode) {
      const n = 14, L = s * 5;
      const at = (u) => ({ x: L * (0.5 - u), y: Math.sin(ph * 1.2 - u * 5) * s * 0.35 });
      if (mode === 'lights') {
        for (let k = 0; k < n; k++) { const p = at(k / n); glowDot(ctx, p.x, p.y, Math.max(5, s * 0.4), '140,150,255', 0.22 + 0.18 * Math.sin(ph * 2 - k * 0.6)); }
        return;
      }
      ctx.strokeStyle = 'rgba(220,210,255,0.3)'; ctx.lineWidth = Math.max(0.4, s * 0.02);
      ctx.beginPath();
      for (let k = 0; k < n * 2; k++) { const p = at(k / (n * 2)); ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(p.x - s * 0.1, p.y + s * 0.6, p.x + Math.sin(ph + k) * s * 0.15, p.y + s * (1 + (k % 3) * 0.3)); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(230,220,255,0.6)'; ctx.lineWidth = Math.max(0.5, s * 0.05);
      ctx.beginPath(); for (let k = 0; k <= 30; k++) { const p = at(k / 30); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); } ctx.stroke();
      for (let k = 0; k < n; k++) {
        const p = at(k / n), rr = s * (k === 0 ? 0.35 : 0.25);
        ctx.fillStyle = k === 0 ? 'rgba(255,190,140,0.75)' : 'rgba(200,190,255,0.45)';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, rr * 1.3, rr, 0, 0, TAU); ctx.fill();
      }
    },
    // Legend: the sea serpent, long and silver with the red crest of an oarfish.
    serpent(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      const L = s * 4.6, N = 26;
      const at = (u) => ({ x: L * (0.32 - u), y: Math.sin(ph * 2.2 - u * 7) * s * 0.45 * Math.min(1, u * 3) });
      const th = (u) => s * (0.3 * (1 - u * 0.85) + 0.04);
      const top = [], bot = [];
      for (let i = 0; i <= N; i++) { const u = i / N, p = at(u); top.push({ x: p.x, y: p.y - th(u) }); bot.push({ x: p.x, y: p.y + th(u) }); }
      // the red crest, rippling along the back
      ctx.fillStyle = 'rgba(215,45,55,0.85)';
      ctx.beginPath(); ctx.moveTo(top[1].x, top[1].y);
      for (let i = 1; i <= N - 2; i++) { const u = i / N; ctx.lineTo(top[i].x, top[i].y - s * 0.28 * (1 - u * 0.6) * (0.7 + 0.3 * Math.sin(u * 40 + ph * 4))); }
      for (let i = N - 2; i >= 1; i--) ctx.lineTo(top[i].x, top[i].y + s * 0.02);
      ctx.closePath(); ctx.fill();
      // the plume on the head
      ctx.strokeStyle = 'rgba(230,60,70,0.9)'; ctx.lineWidth = Math.max(0.6, s * 0.05); ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < 5; k++) { const p = top[1 + k]; ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(p.x - s * 0.2, p.y - s * 0.8, p.x - s * (0.6 + k * 0.15), p.y - s * (0.9 + Math.sin(ph * 2 + k) * 0.12)); }
      ctx.stroke();
      smooth(ctx, top.concat(bot.reverse()));
      const g = ctx.createLinearGradient(0, -s * 0.4, 0, s * 0.4);
      g.addColorStop(0, '#5f7f92'); g.addColorStop(0.5, '#b9ccd2'); g.addColorStop(1, '#e8f0ee');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(20,35,45,0.4)'; ctx.lineWidth = Math.max(0.5, s * 0.03); ctx.stroke();
      // dark wavy bands
      ctx.strokeStyle = 'rgba(40,60,75,0.35)'; ctx.lineWidth = Math.max(0.5, s * 0.04);
      ctx.beginPath();
      for (let k = 1; k < 12; k++) { const u = k / 13, p = at(u), t = th(u); ctx.moveTo(p.x, p.y - t * 0.9); ctx.quadraticCurveTo(p.x - s * 0.12, p.y, p.x, p.y + t * 0.6); }
      ctx.stroke();
      const h = at(0.03);
      eye(ctx, h.x, h.y - s * 0.08, Math.max(0.7, s * 0.09), '#d9c37a');
    },
    // Legend: a turtle the size of an island, with a grove growing on its shell.
    // A leathery shell with seven ridges, white speckles and long front flippers; it stays level.
    leatherback(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      const fl = Math.sin(ph * 1.4) * 0.45;
      // a flipper hinged at (x, y), reaching backwards; a larger a turns the tip down
      const flipper = (x, y, len, w, a, color) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(-a); ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(0, -w * 0.6); ctx.quadraticCurveTo(-len * 0.5, -w * 1.2, -len, w * 0.2);
        ctx.quadraticCurveTo(-len * 0.45, w * 0.9, 0, w * 0.6); ctx.closePath(); ctx.fill(); ctx.restore();
      };
      flipper(s * 0.6, s * 0.05, s * 1.6, s * 0.2, 0.35 - fl * 0.6, '#1c2024');
      flipper(-s * 1.0, s * 0.12, s * 0.5, s * 0.14, 0.25 - fl * 0.3, '#1c2024');
      // head and neck
      ctx.fillStyle = '#353b42';
      ctx.beginPath(); ctx.moveTo(s * 0.7, -s * 0.15); ctx.quadraticCurveTo(s * 1.15, -s * 0.32, s * 1.42, -s * 0.12);
      ctx.quadraticCurveTo(s * 1.55, s * 0.05, s * 1.3, s * 0.18); ctx.quadraticCurveTo(s * 1.0, s * 0.25, s * 0.7, s * 0.2); ctx.fill();
      ctx.fillStyle = 'rgba(230,180,190,0.5)'; ctx.beginPath(); ctx.ellipse(s * 1.15, -s * 0.22, s * 0.08, s * 0.04, 0, 0, TAU); ctx.fill();
      eye(ctx, s * 1.3, -s * 0.07, Math.max(0.7, s * 0.05), '#2b2b2b');
      // the shell: a teardrop that narrows to a point at the back
      const shell = () => {
        ctx.beginPath(); ctx.moveTo(-s * 1.6, s * 0.05);
        ctx.bezierCurveTo(-s * 1.0, -s * 0.55, s * 0.5, -s * 0.75, s * 0.95, -s * 0.05);
        ctx.quadraticCurveTo(s * 0.4, s * 0.32, -s * 1.6, s * 0.05);
      };
      const g = ctx.createLinearGradient(0, -s * 0.7, 0, s * 0.3);
      g.addColorStop(0, '#3a4148'); g.addColorStop(1, '#1d2125');
      shell(); ctx.fillStyle = g; ctx.fill();
      ctx.save(); shell(); ctx.clip();
      ctx.strokeStyle = 'rgba(120,130,140,0.45)'; ctx.lineWidth = Math.max(0.6, s * 0.035);
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-s * 1.55, s * 0.03); ctx.bezierCurveTo(-s * 1.0, -s * (0.5 - k * 0.12), s * 0.4, -s * (0.68 - k * 0.16), s * 0.92, -s * (0.05 + k * 0.02)); ctx.stroke(); }
      if (s > 5) {
        ctx.fillStyle = 'rgba(235,240,245,0.5)';
        for (let k = 0; k < 26; k++) { ctx.beginPath(); ctx.arc(-s * 1.3 + ((k * 0.61) % 1) * s * 2.1, -s * 0.5 + ((k * 0.37) % 1) * s * 0.6, Math.max(0.4, s * 0.02), 0, TAU); ctx.fill(); }
      }
      ctx.restore();
      shell(); ctx.strokeStyle = 'rgba(10,12,14,0.5)'; ctx.lineWidth = Math.max(0.6, s * 0.03); ctx.stroke();
      flipper(s * 0.65, s * 0.15, s * 1.7, s * 0.22, 0.5 + fl * 0.6, '#2c3238');
      flipper(-s * 0.95, s * 0.2, s * 0.55, s * 0.15, 0.3 + fl * 0.3, '#2c3238');
    },
    // A manta seen from a little above: two wings that beat together, horn-like head fins, a thin tail.
    manta(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      const fl = Math.sin(ph * 1.3) * s * 0.35;
      ctx.strokeStyle = '#1b242d'; ctx.lineWidth = Math.max(0.6, s * 0.04); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-s * 0.6, 0); ctx.quadraticCurveTo(-s * 1.2, Math.sin(ph * 2) * s * 0.1, -s * 1.85, Math.sin(ph * 2 - 1) * s * 0.15); ctx.stroke();
      const wing = (side, color, rim) => {
        const tipY = side * s * 1.25 - fl;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(s * 0.55, side * s * 0.12);
        ctx.quadraticCurveTo(s * 0.1, side * s * 0.6 - fl * 0.5, -s * 0.15, tipY);
        ctx.quadraticCurveTo(-s * 0.35, side * s * 0.55 - fl * 0.4, -s * 0.7, side * s * 0.08); ctx.closePath(); ctx.fill();
        if (rim) {
          ctx.strokeStyle = rim; ctx.lineWidth = Math.max(0.6, s * 0.05);
          ctx.beginPath(); ctx.moveTo(s * 0.5, side * s * 0.16); ctx.quadraticCurveTo(s * 0.1, side * s * 0.62 - fl * 0.5, -s * 0.13, tipY); ctx.stroke();
        }
      };
      wing(-1, '#151d26');
      // body
      const g = ctx.createLinearGradient(0, -s * 0.3, 0, s * 0.3);
      g.addColorStop(0, '#2a3644'); g.addColorStop(1, '#3a4756');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(-s * 0.05, 0, s * 0.75, s * 0.26, 0, 0, TAU); ctx.fill();
      wing(1, '#263240', 'rgba(235,240,245,0.75)');
      // the head fins, rolled like horns
      ctx.fillStyle = '#1e2832';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(s * 0.6, side * s * 0.08);
        ctx.quadraticCurveTo(s * 1.0, side * s * 0.12, s * 1.05, side * s * 0.3); ctx.quadraticCurveTo(s * 0.85, side * s * 0.22, s * 0.62, side * s * 0.2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(240,244,248,0.55)'; ctx.beginPath(); ctx.ellipse(s * 0.1, s * 0.12, s * 0.35, s * 0.07, 0, 0, TAU); ctx.fill();
      eye(ctx, s * 0.62, -s * 0.06, Math.max(0.6, s * 0.045), '#4a4a4a');
    },
    // A deep-red crown jelly with one long trailing tentacle; grabbed, it flashes a ring of blue lights.
    atolla(ctx, s, ph, mode) {
      const pulse = 1 + Math.sin(ph * 2) * 0.08;
      const rim = (k, n) => { const a = -Math.PI / 2 + (Math.PI * k) / (n - 1); return { x: Math.cos(a) * s * 0.55 * pulse, y: Math.sin(a) * s * 0.95 / pulse }; };
      if (mode === 'lights') {
        for (let k = 0; k < 12; k++) { const p = rim(k, 12); glowDot(ctx, p.x, p.y, Math.max(3, s * 0.3), '80,150,255', 0.25 + 0.55 * Math.max(0, Math.sin(ph * 2.5 - k * 0.7))); }
        return;
      }
      ctx.strokeStyle = 'rgba(160,40,60,0.45)'; ctx.lineWidth = Math.max(0.4, s * 0.025);
      ctx.beginPath();
      for (let k = 0; k < 18; k++) { const y0 = s * (k / 17 - 0.5) * 1.7 / pulse; ctx.moveTo(-s * 0.05, y0); ctx.quadraticCurveTo(-s * 0.35, y0 + Math.sin(ph * 2 + k) * s * 0.08, -s * 0.6, y0 + Math.sin(ph * 2 + k + 1) * s * 0.1); }
      ctx.stroke();
      // the one long tentacle, used for hunting
      ctx.strokeStyle = 'rgba(200,70,90,0.6)'; ctx.lineWidth = Math.max(0.5, s * 0.04);
      ctx.beginPath(); ctx.moveTo(0, s * 0.2); ctx.bezierCurveTo(-s * 0.8, s * 0.5 + Math.sin(ph) * s * 0.2, -s * 1.4, s * 0.1, -s * 2.1, s * 0.35 + Math.sin(ph * 1.3) * s * 0.25); ctx.stroke();
      const g = ctx.createRadialGradient(s * 0.25, 0, 0, 0, 0, s);
      g.addColorStop(0, 'rgba(190,40,60,0.95)'); g.addColorStop(0.7, 'rgba(120,15,35,0.92)'); g.addColorStop(1, 'rgba(70,8,22,0.85)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.55 * pulse, s * 0.95 / pulse, 0, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
      // the coronal groove that gives the crown its look
      ctx.strokeStyle = 'rgba(40,0,10,0.6)'; ctx.lineWidth = Math.max(0.5, s * 0.04);
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.3 * pulse, s * 0.78 / pulse, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(40,0,10,0.4)';
      ctx.beginPath(); for (let k = 1; k < 8; k++) { const p = rim(k, 9); ctx.moveTo(p.x * 0.55, p.y * 0.82); ctx.lineTo(p.x, p.y); } ctx.stroke();
      ctx.fillStyle = 'rgba(120,180,255,0.7)';
      for (let k = 0; k < 12; k++) { const p = rim(k, 12); ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, s * 0.04), 0, TAU); ctx.fill(); }
    },
    // A plump pink sea cucumber walking on tube feet, with soft feelers on its back.
    seapig(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      ctx.strokeStyle = 'rgba(230,150,170,0.85)'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(0.6, s * 0.1);
      for (let k = 0; k < 6; k++) {
        const x = -s * 0.75 + k * s * 0.3, step = Math.sin(ph * 3 + k * 1.2) * s * 0.08;
        ctx.beginPath(); ctx.moveTo(x, s * 0.3); ctx.lineTo(x + step, s * 0.62); ctx.stroke();
      }
      // feelers on top, swaying
      ctx.lineWidth = Math.max(0.6, s * 0.09);
      for (const [x, h] of [[s * 0.2, 0.65], [s * 0.45, 0.75], [s * 0.6, 0.55]]) {
        ctx.beginPath(); ctx.moveTo(x, -s * 0.3); ctx.quadraticCurveTo(x + Math.sin(ph * 2 + x) * s * 0.15, -s * (0.3 + h * 0.6), x + s * 0.1 + Math.sin(ph * 2 + x + 1) * s * 0.12, -s * (0.3 + h)); ctx.stroke();
      }
      const g = ctx.createRadialGradient(-s * 0.1, -s * 0.15, s * 0.05, 0, 0, s);
      g.addColorStop(0, 'rgba(255,215,222,0.95)'); g.addColorStop(1, 'rgba(225,135,160,0.85)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.95, s * 0.38, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(170,80,105,0.4)'; ctx.lineWidth = Math.max(0.5, s * 0.03); ctx.stroke();
      // mouth tentacles at the front
      ctx.strokeStyle = 'rgba(210,120,145,0.9)'; ctx.lineWidth = Math.max(0.5, s * 0.05);
      ctx.beginPath(); for (let k = 0; k < 4; k++) { ctx.moveTo(s * 0.85, s * 0.15); ctx.lineTo(s * 1.05 + Math.sin(ph * 3 + k) * s * 0.05, s * (0.15 + k * 0.08)); } ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(-s * 0.2, -s * 0.18, s * 0.4, s * 0.07, 0, 0, TAU); ctx.fill();
    },
    // A pale, eyeless crab with long hairy claws that it waves over the vent water.
    yeti(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      ctx.lineCap = 'round';
      // walking legs
      ctx.strokeStyle = '#d8cfbd'; ctx.lineWidth = Math.max(0.6, s * 0.07);
      for (let k = 0; k < 4; k++) {
        const x = -s * 0.45 + k * s * 0.25, lift = Math.sin(ph * 3 + k * 1.4) * s * 0.06;
        ctx.beginPath(); ctx.moveTo(x, s * 0.15); ctx.lineTo(x - s * 0.15, s * 0.45 - lift); ctx.lineTo(x - s * 0.3, s * 0.8); ctx.stroke();
      }
      // tucked tail and the carapace
      ctx.fillStyle = '#d9d1c1'; ctx.beginPath(); ctx.ellipse(-s * 0.7, s * 0.12, s * 0.25, s * 0.14, 0.4, 0, TAU); ctx.fill();
      const g = ctx.createLinearGradient(0, -s * 0.45, 0, s * 0.3);
      g.addColorStop(0, '#f4efe4'); g.addColorStop(1, '#cfc6b3');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.62, s * 0.38, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(120,105,85,0.35)'; ctx.lineWidth = Math.max(0.5, s * 0.03); ctx.stroke();
      // the two hairy claws, waving slowly
      for (const [side, k] of [[-1, 0], [1, 1]]) {
        const wave = Math.sin(ph * 1.2 + k) * 0.18;
        ctx.save(); ctx.translate(s * 0.45, side * s * 0.05); ctx.rotate(-0.25 + wave + side * 0.12);
        const arm = s * 1.1;
        ctx.strokeStyle = '#e6dfcf'; ctx.lineWidth = Math.max(0.8, s * 0.13);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(arm, 0); ctx.stroke();
        if (s > 4) {
          ctx.strokeStyle = 'rgba(245,238,222,0.85)'; ctx.lineWidth = Math.max(0.4, s * 0.015);
          ctx.beginPath();
          for (let j = 0; j < 22; j++) { const x = (j / 22) * arm, h = s * (0.12 + ((j * 7) % 5) * 0.025); ctx.moveTo(x, s * 0.04); ctx.lineTo(x - s * 0.03 + Math.sin(ph * 2 + j) * s * 0.02, s * 0.04 + h); }
          ctx.stroke();
        }
        ctx.fillStyle = '#efe8d8';
        ctx.beginPath(); ctx.moveTo(arm - s * 0.05, -s * 0.08); ctx.quadraticCurveTo(arm + s * 0.3, -s * 0.12, arm + s * 0.38, -s * 0.02); ctx.lineTo(arm, 0); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(arm - s * 0.05, s * 0.06); ctx.quadraticCurveTo(arm + s * 0.25, s * 0.1, arm + s * 0.32, s * 0.03); ctx.lineTo(arm, 0); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    },
    aspidochelone(ctx, s, ph, mode) {
      if (mode === 'lights') return;
      const fl = Math.sin(ph * 1.5) * 0.35;
      const flipper = (x, y, rx, ry, a, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, a, 0, TAU); ctx.fill(); };
      // far-side flippers
      flipper(s * 0.55, s * 0.4, s * 0.85, s * 0.2, 0.7 + fl, '#3f4a31');
      flipper(-s * 1.05, s * 0.35, s * 0.45, s * 0.16, -0.5 - fl * 0.6, '#3f4a31');
      // neck and head
      ctx.fillStyle = '#6b7550';
      ctx.beginPath(); ctx.moveTo(s * 0.9, -s * 0.05); ctx.quadraticCurveTo(s * 1.3, -s * 0.15, s * 1.6, -s * 0.05);
      ctx.quadraticCurveTo(s * 1.85, s * 0.08, s * 1.6, s * 0.22); ctx.quadraticCurveTo(s * 1.3, s * 0.3, s * 0.9, s * 0.3); ctx.fill();
      eye(ctx, s * 1.62, s * 0.02, Math.max(0.7, s * 0.06), '#c9a24a');
      // belly plate
      ctx.fillStyle = '#c4b183';
      ctx.beginPath(); ctx.ellipse(-s * 0.05, s * 0.28, s * 1.3, s * 0.2, 0, 0, TAU); ctx.fill();
      // the shell dome
      ctx.beginPath(); ctx.moveTo(-s * 1.45, s * 0.25); ctx.bezierCurveTo(-s * 1.2, -s * 0.85, s * 1.0, -s * 0.9, s * 1.25, s * 0.25); ctx.closePath();
      const g = ctx.createLinearGradient(0, -s * 0.7, 0, s * 0.25);
      g.addColorStop(0, '#6e6c4a'); g.addColorStop(1, '#3a4130');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(20,24,14,0.45)'; ctx.lineWidth = Math.max(0.6, s * 0.03); ctx.stroke();
      // scutes
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) { const x = k * s * 0.5; ctx.moveTo(x, s * 0.22); ctx.lineTo(x * 0.85, -s * 0.2); }
      ctx.moveTo(-s * 1.1, -s * 0.2); ctx.quadraticCurveTo(0, -s * 0.32, s * 0.95, -s * 0.2);
      ctx.stroke();
      // algae hanging from the rim
      ctx.strokeStyle = 'rgba(80,130,60,0.6)'; ctx.lineWidth = Math.max(0.5, s * 0.03);
      ctx.beginPath();
      for (let k = 0; k < 9; k++) { const x = -s * 1.3 + k * s * 0.3; ctx.moveTo(x, s * 0.25); ctx.quadraticCurveTo(x + Math.sin(ph + k) * s * 0.1, s * 0.4, x + Math.sin(ph * 1.3 + k) * s * 0.12, s * (0.5 + (k % 3) * 0.08)); }
      ctx.stroke();
      // the island on top: rocks, grass and a lone tree
      ctx.fillStyle = '#7a7466';
      ctx.beginPath(); ctx.ellipse(-s * 0.45, -s * 0.58, s * 0.28, s * 0.12, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(s * 0.5, -s * 0.55, s * 0.2, s * 0.09, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5c8a3e';
      ctx.beginPath(); ctx.ellipse(0, -s * 0.64, s * 0.55, s * 0.12, 0, Math.PI, TAU); ctx.fill();
      ctx.strokeStyle = '#5a4128'; ctx.lineWidth = Math.max(0.7, s * 0.05);
      ctx.beginPath(); ctx.moveTo(s * 0.05, -s * 0.68); ctx.quadraticCurveTo(s * 0.12, -s * 1.0, s * 0.02, -s * 1.3); ctx.stroke();
      ctx.fillStyle = '#4f7d36';
      for (let k = 0; k < 5; k++) { const a = Math.PI * (1.05 + k * 0.22); ctx.beginPath(); ctx.ellipse(s * 0.02 + Math.cos(a) * s * 0.22, -s * 1.3 + Math.sin(a) * s * 0.1 + s * 0.08, s * 0.24, s * 0.06, a + Math.PI / 2 + Math.sin(ph) * 0.05, 0, TAU); ctx.fill(); }
      // near-side flippers
      flipper(s * 0.75, s * 0.3, s * 0.95, s * 0.22, 0.5 - fl, '#5d6845');
      flipper(-s * 1.15, s * 0.28, s * 0.5, s * 0.17, -0.35 + fl * 0.6, '#5d6845');
    },
  };

  const SQUIDS = {
    squid: {},
    giantsquid: { mantle: ['#c4553f', '#8f3326'], arm: '#a8402f', tentacles: true, eye: 0.2, thick: 1.2 },
    colossal: { mantle: ['#d9705c', '#9c3a2c'], arm: '#b44a38', tentacles: true, eye: 0.3, thick: 1.7, wide: 1.25, hooks: true },
  };

  // Overall extent in units of s, used to fit thumbnails: [back, front, half-height].
  const BOX = {
    diatom: [1, 1, 1], noctiluca: [1.8, 1, 1], snow: [1, 1, 1], ciliate: [1.8, 1.8, 1], radiolarian: [1.6, 1.6, 1.6],
    foram: [2, 2, 2], xeno: [1.3, 1.3, 1.1], copepod: [1.8, 1.3, 2.3], krill: [1.8, 2.8, 1], shrimp: [1.8, 3.7, 1], amphipod: [1, 2.1, 1.2],
    moonjelly: [1.6, 0.9, 1.1], combjelly: [1.1, 1.1, 0.9], squid: [1.4, 2.1, 0.8], giantsquid: [1.4, 4.2, 1.1], vampire: [1.1, 1.6, 1],
    dumbo: [1, 1.3, 1.1], gulper: [2.7, 2.5, 1.4], siphonophore: [2.5, 2.6, 1.4],
    kraken: [1.8, 4.7, 1.7], serpent: [3.2, 1.7, 1.4], aspidochelone: [1.6, 1.9, 1.5],
    colossal: [1.4, 4.2, 1.2], leatherback: [2.0, 1.6, 1.4], manta: [1.9, 1.15, 1.65], atolla: [2.2, 0.7, 1.1],
    seapig: [1.0, 1.15, 1.2], yeti: [1.0, 1.95, 1.0],
  };
  // What sticks out past the snout, and how tall the fins reach, in units of s and of H.
  const FRONT = { goblin: 0.85, angler: 0.3, tripod: 1.3, fangtooth: 0.15 };
  const HALF = { tripod: 3.6, leviathan: 1.8, orca: 2.8, sunfish: 2.0, frilled: 2.2, barreleye: 1.6 };
  for (const [id, c] of Object.entries(FISH)) {
    const back = c.L * 0.5 + c.H * (c.tailSize ?? 1) * (c.tail === 'shark' ? 1.3 : 1);
    BOX[id] = [back, c.L * 0.5 + (FRONT[id] ?? 0.1), c.H * (HALF[id] ?? 1.4)];
  }

  function draw(ctx, id, s, ph, mode = 'body') {
    if (FISH[id]) return drawFish(ctx, s, ph, FISH[id], mode);
    if (SQUIDS[id]) return OTHER.squid(ctx, s, ph, mode, SQUIDS[id]);
    if (id === 'shrimp') return OTHER.krill(ctx, s, ph, mode, true);
    if (OTHER[id]) return OTHER[id](ctx, s, ph, mode);
    return undefined;
  }

  // Creatures that stay level when they swim up or down (an island does not stand on end).
  const UPRIGHT = new Set(['aspidochelone', 'leatherback', 'manta', 'seapig', 'yeti']);

  root.DeepModels = { draw, box: (id) => BOX[id] || [1.5, 1.5, 1], upright: (id) => UPRIGHT.has(id) };
})(typeof window !== 'undefined' ? window : globalThis);
