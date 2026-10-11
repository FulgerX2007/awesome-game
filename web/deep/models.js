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
    ctx.save(); ctx.translate(end.x, end.y); ctx.rotate(ang - Math.PI);
    // drawn pointing +x from the tail base
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
      L: 1.7, H: 0.95, k: 0.42, top: '#5e7890', mid: '#c9d8e4', belly: '#eef4f8', finColor: 'rgba(170,190,205,0.7)', tail: 'fork', tailSize: 0.45, ped: 0.15, botK: 1.1,
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
        const p = pts.at(0.02);
        ctx.strokeStyle = 'rgba(235,240,245,0.9)'; ctx.lineWidth = Math.max(0.6, s * 0.035);
        ctx.beginPath();
        ctx.moveTo(p.x - s * 0.05, p.y - s * 0.05); ctx.lineTo(p.x + s * 0.12, p.y + s * 0.35);
        ctx.moveTo(p.x - s * 0.15, p.y + s * 0.1); ctx.lineTo(p.x - s * 0.02, p.y - s * 0.4);
        ctx.moveTo(p.x - s * 0.25, p.y + s * 0.05); ctx.lineTo(p.x - s * 0.18, p.y + s * 0.3);
        ctx.stroke();
      },
    }, bellyRow(12, 0.12, 0.85, '100,190,255', 0.045, 0.8)),
    angler: {
      L: 1.8, H: 0.8, k: 0.3, blunt: 0.95, top: '#2b211f', mid: '#3b2e2a', belly: '#4a3a34', finColor: 'rgba(55,40,36,0.9)', tail: 'round', tailSize: 0.75, ped: 0.2, nose: 1.5, swim: 0.1, botK: 1.05,
      fins: [{ u: 0.55, len: 0.15, h: 0.35, soft: true }, { u: 0.58, len: 0.12, h: 0.3, soft: true, side: 'bottom' }, { u: 0.35, len: 0.12, h: 0.4, front: true }],
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
      L: 3.2, H: 0.55, k: 0.25, blunt: 0.95, top: '#3d434b', mid: '#4b525b', belly: '#6c737c', finColor: '#3a4048', tail: 'whale', tailSize: 1.05, swim: 0.25, nose: 1.4, topK: 1, botK: 0.85,
      fins: [{ u: 0.65, len: 0.12, h: 0.25, soft: true }, { u: 0.36, len: 0.12, h: 0.3, front: true }],
      eye: { u: 0.36, r: 0.04, up: -0.2, iris: '#222' },
      extra(ctx, pts, s) {
        // wrinkled skin and the narrow lower jaw
        ctx.strokeStyle = 'rgba(20,24,28,0.25)'; ctx.lineWidth = Math.max(0.6, s * 0.02);
        for (let k = 0; k < 12; k++) { const a = pts.at(0.4 + k * 0.04); ctx.beginPath(); ctx.moveTo(a.x, a.y - a.t * 0.8); ctx.lineTo(a.x - s * 0.04, a.y + a.t * 0.5); ctx.stroke(); }
        const a = pts.at(0.02), b = pts.at(0.36);
        ctx.strokeStyle = 'rgba(220,225,230,0.6)'; ctx.lineWidth = Math.max(0.8, s * 0.04);
        ctx.beginPath(); ctx.moveTo(a.x - s * 0.1, a.y + a.t * 0.7); ctx.lineTo(b.x, b.y + b.t * 0.55); ctx.stroke();
      },
    },
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
    paramecium(ctx, s, ph, mode) {
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
      const L = s * 2.4, H = s * 0.7;
      const mantle = opt.mantle || ['#e9785d', '#c8513b'], arm = opt.arm || '#d0573c';
      if (mode === 'lights') return;
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
          ctx.fillStyle = arm; ctx.beginPath(); ctx.ellipse(L * 1.7, side * H * 0.5 + Math.sin(ph * 2 + side) * H * 0.6, s * 0.18, s * 0.08, 0, 0, TAU); ctx.fill();
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
      // whip body
      ctx.strokeStyle = '#1c1820'; ctx.lineCap = 'round';
      for (let i = 0; i < 12; i++) {
        const a = tailAt(i / 12), b = tailAt((i + 1) / 12);
        ctx.lineWidth = Math.max(0.6, s * 0.3 * (1 - i / 12) + s * 0.03);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      // the enormous mouth pouch
      const open = 0.6 + 0.4 * Math.sin(ph * 0.8);
      ctx.fillStyle = '#2a222c';
      ctx.beginPath(); ctx.moveTo(L * 0.25, -s * 0.1);
      ctx.quadraticCurveTo(L * 0.5, -s * (0.9 * open + 0.2), L * 0.62, -s * 0.15 * open);
      ctx.lineTo(L * 0.6, s * 0.1);
      ctx.quadraticCurveTo(L * 0.45, s * (1.1 * open + 0.3), L * 0.22, s * 0.15); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#0c090d';
      ctx.beginPath(); ctx.moveTo(L * 0.6, -s * 0.12 * open); ctx.quadraticCurveTo(L * 0.4, 0, L * 0.6, s * 0.08); ctx.fill();
      eye(ctx, L * 0.55, -s * 0.25 * open - s * 0.05, Math.max(0.6, s * 0.06), '#888');
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
  };

  const SQUIDS = {
    squid: {},
    giantsquid: { mantle: ['#c4553f', '#8f3326'], arm: '#a8402f', tentacles: true, eye: 0.2, thick: 1.2 },
  };

  // Overall extent in units of s, used to fit thumbnails: [back, front, half-height].
  const BOX = {
    diatom: [1, 1, 1], noctiluca: [1.8, 1, 1], snow: [1, 1, 1], paramecium: [1.8, 1.8, 1], radiolarian: [1.6, 1.6, 1.6],
    foram: [2, 2, 2], xeno: [1.3, 1.3, 1.1], copepod: [1.8, 1.3, 2.3], krill: [1.8, 2.8, 1], shrimp: [1.8, 3.7, 1], amphipod: [1, 2.1, 1.2],
    moonjelly: [1.6, 0.9, 1.1], combjelly: [1.1, 1.1, 0.9], squid: [1.4, 2.1, 0.8], giantsquid: [1.4, 4.2, 1.1], vampire: [1.1, 1.6, 1],
    dumbo: [1, 1.3, 1.1], gulper: [2.7, 2.3, 1.1], siphonophore: [2.5, 2.6, 1.4],
  };
  for (const [id, c] of Object.entries(FISH)) {
    const back = c.L * 0.5 + c.H * (c.tailSize ?? 1) * (c.tail === 'shark' ? 1.3 : 1);
    BOX[id] = [back, c.L * 0.5 + (id === 'goblin' ? 0.85 : id === 'angler' ? 0.3 : id === 'tripod' ? 1.3 : 0.1), c.H * (id === 'tripod' ? 3.6 : 1.4)];
  }

  function draw(ctx, id, s, ph, mode = 'body') {
    if (FISH[id]) return drawFish(ctx, s, ph, FISH[id], mode);
    if (SQUIDS[id]) return OTHER.squid(ctx, s, ph, mode, SQUIDS[id]);
    if (id === 'shrimp') return OTHER.krill(ctx, s, ph, mode, true);
    if (OTHER[id]) return OTHER[id](ctx, s, ph, mode);
    return undefined;
  }

  root.DeepModels = { draw, box: (id) => BOX[id] || [1.5, 1.5, 1] };
})(typeof window !== 'undefined' ? window : globalThis);
