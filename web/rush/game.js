'use strict';
// Числовой забег — client: screens, the shop, input, the frame loop and the pseudo-3D Canvas 2D art. The rules,
// levels and the economy live in core.js (window.RushCore), the projection and layouts in view.js (window.RushView).
(() => {
  const C = window.RushCore;
  const V = window.RushView;
  const { t } = window.I18n;
  const { clamp } = V;
  const $ = (id) => document.getElementById(id);
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const rrect = (g, x, y, w, h, r) => (g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h));

  // Storage access itself may throw (blocked site data); core's save functions tolerate a null storage.
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }

  // Sound comes from audio.js (index.html loads it first); its play() is silent while the sound is off.
  // Names: gate ({ good }), hit, fall, recruit, battle, clash, coin, win, lose, star ({ n }).
  const Sound = window.RushAudio;

  // ── Look ──
  const STRIP = 4;          // metres per track stripe
  const ARENA = 34;         // metres of track past the finish line
  const ARMY_Z = 12;        // the enemy's front rank, metres past the finish
  const BOSS_Z = 24;        // the boss, metres past the finish
  const ARMY_STEP = 3;      // the army steps this far forward during the charge
  const MEET_GAP = 2.5;     // the crowd stops this far short of the army's (stepped) front
  const BOSS_GAP = 4.5;     // the crowd stops this far short of the boss
  const START_Z = -30;      // the track starts this far behind the start line
  const GATE_H = 2.6;       // metres
  const WALL_H = 1.5;
  const WALL_D = 0.8;
  const SLAB = 0.7;         // thickness of the track and the platforms
  const SOLDIER = 0.72;      // figure size, in metres-ish units of the projection's scale
  const DRAG_GAIN = 1.4;    // a finger drag across the track's width moves the crowd 1.4× as far
  const COL = {
    skyTop: [82, 170, 238], skyLow: [206, 238, 255],
    waterNear: [24, 92, 170], waterFar: [70, 165, 228],
    trackA: [233, 238, 247], trackB: [214, 222, 236], arenaA: [247, 220, 214], arenaB: [236, 202, 196],
    side: [96, 112, 140], good: [47, 211, 106], bad: [255, 75, 75],
  };
  const rgb = (c, a) => (a === undefined ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`);
  const mix = (a, b, f) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * f));
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  // Shop cards; n fills the {n} of the description from core's tuning.
  const UPG = {
    start: { name: 'Старт', desc: '+{n} бойца в начале забега', n: C.START_PER_LEVEL },
    weapon: { name: 'Оружие', desc: '+{n} к оружию в начале забега', n: C.WEAPON_PER_LEVEL },
    shield: { name: 'Щит', desc: '−{n}% потерь от пил, стен и падений', n: Math.round(C.SHIELD_PER_LEVEL * 100) },
    income: { name: 'Доход', desc: '+{n}% монет за забег', n: Math.round(C.INCOME_PER_LEVEL * 100) },
  };
  const TIPS = [
    'Веди толпу пальцем или ←/→ через ворота с большим числом',
    'Обходи стены и пилы: они отнимают бойцов',
    'Ворота «Оружие» усиливают каждого бойца. На платформе держись середины',
  ];
  // Tips for things that first show up on a generated level: shown on the first level that has them.
  const FIRST_TIPS = [
    { tip: 'Подбирай новобранцев: проведи толпу рядом с ними', has: (L) => L.recruits.length > 0 },
    { tip: 'Эта пила ездит по трассе: проходи там, где её не будет', has: (L) => L.obstacles.some((o) => o.A > 0) },
  ];
  const firstLevels = new Map(); // FIRST_TIPS entry → the first level that has it (looked up once, campaign only)
  function firstLevel(entry) {
    if (!firstLevels.has(entry)) {
      let n = 0;
      for (let i = 1; i <= C.CAMPAIGN && !n; i++) if (entry.has(C.levelDef(i))) n = i;
      firstLevels.set(entry, n);
    }
    return firstLevels.get(entry);
  }
  function tipFor(n) {
    if (TIPS[n - 1]) return TIPS[n - 1];
    if (n > C.CAMPAIGN) return null;
    const e = FIRST_TIPS.find((x) => firstLevel(x) === n);
    return e ? e.tip : null;
  }
  const REASONS = {
    crowd: 'Толпа не добежала до финиша',
    army: 'Армия врага оказалась сильнее',
    boss: 'Босс оказался сильнее',
  };

  const canvas = $('scene');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  let save = C.loadSave(storage);
  let run = null;
  let levelNum = save.level;
  let demo = true;          // an autopilot run behind the menu screens
  let mode = 'menu';        // menu | play | pause | battle | lost | end
  let modeT = 0;
  let target = 0;
  let keys = { left: false, right: false };
  let keySteer = false;
  let drag = null;
  let battle = null;        // { plan, view }: the battle timeline and what it shows now
  let coinsWon = 0;
  let particles = [];
  let floats = [];
  let pops = new Map();     // gate z → { side, t }: the panel the crowd went through bursts
  let joined = new Map();   // recruits z → { taken, t }: recruits the crowd has passed
  let shake = 0;
  let soldiers = [];        // eased positions of the drawn soldiers { dx, dy }
  let layoutKey = '';
  let layout = [];
  let crowdZ = 0;
  let crowdX = 0;
  let shownCount = 0;
  let enemyShown = 0;
  let bossShown = 0;
  let bossFall = 0;
  let tipT = 0;
  let shopFrom = 'menu';
  let time = 0;
  let last = 0;
  let vp = { w: 360, h: 640 };
  let dpr = 1;

  // ───────────── Canvas size ─────────────
  function resize() {
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    const ratio = clamp(window.devicePixelRatio || 1, 1, 2);
    if (w === vp.w && h === vp.h && ratio === dpr && canvas.width === Math.round(w * ratio)) return;
    vp = V.viewport({ w, h });
    dpr = ratio;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }

  const P = (x, z, camZ, h) => V.project(x, z, camZ, vp, h);
  // Objects fade in at the far end and fade out as they come between the camera and the crowd.
  const fade = (d) => clamp((d - 1.2) / 3.3, 0, 1) * clamp((V.FAR - d) / 30, 0, 1);

  function poly(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
    ctx.closePath();
  }

  // ───────────── Backdrop ─────────────
  function drawSky() {
    const hy = V.horizonY(vp);
    const g = ctx.createLinearGradient(0, 0, 0, hy);
    g.addColorStop(0, rgb(COL.skyTop));
    g.addColorStop(1, rgb(COL.skyLow));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vp.w, hy + 1);
    // Sun
    const sx = vp.w * 0.8;
    const sy = hy * 0.32;
    const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, hy * 0.6);
    sun.addColorStop(0, 'rgba(255, 252, 225, .95)');
    sun.addColorStop(0.12, 'rgba(255, 246, 200, .8)');
    sun.addColorStop(1, 'rgba(255, 246, 200, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, vp.w, hy);
    // Clouds drift slowly
    ctx.fillStyle = 'rgba(255, 255, 255, .85)';
    for (let i = 0; i < 5; i++) {
      const span = vp.w + 240;
      const x = ((hash(i) * span + time * (6 + 4 * hash(i + 9))) % span) - 120;
      const y = hy * (0.15 + 0.55 * hash(i + 3));
      const s = (0.6 + hash(i + 5) * 0.7) * Math.min(1, vp.w / 400);
      ctx.beginPath();
      ctx.ellipse(x, y, 46 * s, 14 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x - 22 * s, y + 3 * s, 26 * s, 11 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 18 * s, y - 8 * s, 24 * s, 15 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Far islands on the horizon
    ctx.fillStyle = 'rgba(64, 140, 120, .55)';
    ctx.beginPath();
    ctx.moveTo(0, hy + 1);
    for (let x = 0; x <= vp.w; x += 8) {
      const u = x / vp.w;
      const bump = Math.max(0, Math.sin(u * 9 + 1.3)) * 10 + Math.max(0, Math.sin(u * 4.3 + 4)) * 16;
      ctx.lineTo(x, hy - bump * Math.min(1, vp.h / 640));
    }
    ctx.lineTo(vp.w, hy + 1);
    ctx.fill();
  }

  function drawWater(camZ) {
    const hy = V.horizonY(vp);
    const g = ctx.createLinearGradient(0, hy, 0, vp.h);
    g.addColorStop(0, rgb(COL.waterFar));
    g.addColorStop(1, rgb(COL.waterNear));
    ctx.fillStyle = g;
    ctx.fillRect(0, hy, vp.w, vp.h - hy);
    // Shimmer dashes fixed to the world, so they stream past as the crowd runs
    ctx.strokeStyle = 'rgba(220, 245, 255, .35)';
    ctx.lineCap = 'round';
    const z0 = Math.ceil((camZ + 2) / 5) * 5;
    for (let z = z0; z < camZ + 90; z += 5) {
      for (let k = 0; k < 5; k++) {
        const x = -5 + 10 * hash(z * 0.37 + k * 7.1) + Math.sin(time * 0.8 + k + z) * 0.08;
        const p = P(x, z, camZ);
        if (!p) continue;
        ctx.lineWidth = Math.max(1, p.scale * 0.08);
        ctx.beginPath();
        ctx.moveTo(p.sx - p.scale * 0.6, p.sy);
        ctx.lineTo(p.sx + p.scale * 0.6, p.sy);
        ctx.stroke();
      }
    }
  }

  // ───────────── Track ─────────────
  // Pieces of solid track between zFrom and zTo: the platform gaps are cut out.
  function trackPieces(L, zFrom, zTo) {
    const out = [];
    let a = START_Z;
    for (const p of L.platforms) {
      out.push([a, p.z0]);
      a = p.z1;
    }
    out.push([a, L.length + ARENA]);
    return out.map(([s, e]) => [Math.max(s, zFrom), Math.min(e, zTo), s]).filter(([s, e]) => e > s);
  }

  function drawTrack(L, camZ) {
    const zFrom = camZ + V.NEAR;
    const zTo = camZ + V.FAR;
    const pieces = trackPieces(L, zFrom, zTo).reverse();
    for (const [s, e, start] of pieces) {
      // Strips from far to near, cut at stripe boundaries
      let b = e;
      while (b > s) {
        const a = Math.max(s, (Math.ceil(b / STRIP) - 1) * STRIP);
        const pa = [P(-1, a, camZ), P(1, a, camZ)];
        const pb = [P(1, b, camZ), P(-1, b, camZ)];
        const idx = Math.floor((a + 0.01) / STRIP);
        const arena = a >= L.length;
        const base = arena ? (idx % 2 ? COL.arenaA : COL.arenaB) : (idx % 2 ? COL.trackA : COL.trackB);
        const fog = clamp((b - camZ - 50) / 110, 0, 1) * 0.7;
        ctx.fillStyle = rgb(mix(base, COL.skyLow, fog));
        poly([pa[0], pa[1], pb[0], pb[1]]);
        ctx.fill();
        // Curbs and the centre line
        const curb = idx % 2 ? '#e8463c' : '#ffffff';
        for (const [x0, x1, col] of [[-1, -0.93, curb], [0.93, 1, curb], [-0.012, 0.012, idx % 2 ? 'rgba(120, 140, 175, .55)' : null]]) {
          if (!col) continue;
          ctx.fillStyle = col;
          poly([P(x0, a, camZ), P(x1, a, camZ), P(x1, b, camZ), P(x0, b, camZ)]);
          ctx.fill();
        }
        b = a;
      }
      // The slab's front face where the track starts after a gap
      if (start === s && s > zFrom) {
        ctx.fillStyle = rgb(COL.side);
        poly([P(-1, s, camZ), P(1, s, camZ), P(1, s, camZ, -SLAB), P(-1, s, camZ, -SLAB)]);
        ctx.fill();
      }
    }
    // Start and finish lines: checkered bands
    for (const z of [0, L.length]) {
      if (z < zFrom || z + 1.6 > zTo) continue;
      const cols = 10;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.fillStyle = (r + c) % 2 ? '#1d2230' : '#ffffff';
          const x0 = -1 + (2 * c) / cols;
          const x1 = x0 + 2 / cols;
          const z0 = z + r * 0.8;
          poly([P(x0, z0, camZ), P(x1, z0, camZ), P(x1, z0 + 0.8, camZ), P(x0, z0 + 0.8, camZ)]);
          ctx.fill();
        }
      }
    }
  }

  // ───────────── Track objects ─────────────
  function drawGate(g, camZ) {
    const base = P(0, g.z, camZ);
    if (!base) return;
    let a = fade(base.d);
    const crossed = g.z <= run.z;
    const pop = pops.get(g.z);
    const sides = g.full ? [['full', -1, 1]] : [['left', -1, 0], ['right', 0, 1]];
    for (const [side, x0, x1] of sides) {
      const op = g[side];
      let al = a;
      let grow = 0;
      if (crossed) {
        // Passed gates get out of the way at once: the chosen panel bursts, the other one fades.
        const k = pop && pop.side === side ? clamp(pop.t / 0.2, 0, 1) : clamp((run.z - g.z) / 1.2, 0, 1);
        al *= 1 - k;
        if (pop && pop.side === side) grow = k * 0.25;
      }
      if (al <= 0.01) continue;
      const col = V.goodOp(op) ? COL.good : COL.bad;
      const l = P(x0 + 0.05 - grow, g.z, camZ);
      const r = P(x1 - 0.05 + grow, g.z, camZ);
      const top = P(0, g.z, camZ, GATE_H * (1 + grow));
      const s = l.scale;
      const w = r.sx - l.sx;
      const h = l.sy - top.sy;
      ctx.globalAlpha = al;
      const grd = ctx.createLinearGradient(0, top.sy, 0, l.sy);
      grd.addColorStop(0, rgb(col, 0.62));
      grd.addColorStop(1, rgb(col, 0.28));
      ctx.fillStyle = grd;
      ctx.fillRect(l.sx, top.sy, w, h);
      // Top bar and posts
      ctx.fillStyle = rgb(col);
      ctx.fillRect(l.sx, top.sy, w, Math.max(2, 0.28 * s));
      ctx.fillStyle = '#f7fbff';
      const pw = Math.max(1.5, 0.13 * s);
      ctx.fillRect(l.sx - pw / 2, top.sy, pw, h);
      ctx.fillRect(r.sx - pw / 2, top.sy, pw, h);
      // The number
      const cx = (l.sx + r.sx) / 2;
      const size = clamp(1.05 * s, 6, 160);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      let ty = top.sy + h * 0.55;
      if (op.op === 'pow') {
        const small = Math.max(5, size * 0.42);
        ctx.font = `800 ${small}px ${FONT}`;
        ctx.lineWidth = Math.max(1, small * 0.18);
        ctx.strokeStyle = 'rgba(0, 40, 10, .7)';
        ctx.fillStyle = '#ffffff';
        ctx.strokeText(t('ОРУЖИЕ'), cx, top.sy + h * 0.3);
        ctx.fillText(t('ОРУЖИЕ'), cx, top.sy + h * 0.3);
        drawGunIcon(cx - size * 0.95, top.sy + h * 0.62, size * 0.5);
        ty = top.sy + h * 0.62;
      }
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.lineWidth = Math.max(1, size * 0.14);
      ctx.strokeStyle = V.goodOp(op) ? 'rgba(0, 60, 20, .75)' : 'rgba(90, 0, 0, .75)';
      ctx.fillStyle = '#ffffff';
      const label = V.opLabel(op);
      const lx = op.op === 'pow' ? cx + size * 0.25 : cx;
      ctx.strokeText(label, lx, ty);
      ctx.fillText(label, lx, ty);
      ctx.globalAlpha = 1;
    }
  }

  function drawGunIcon(x, y, s) {
    ctx.fillStyle = '#2b3442';
    ctx.fillRect(x - s * 0.5, y - s * 0.18, s * 1.1, s * 0.26);
    ctx.fillRect(x - s * 0.45, y, s * 0.24, s * 0.42);
    ctx.fillStyle = '#c9d3df';
    ctx.fillRect(x + s * 0.2, y - s * 0.12, s * 0.38, s * 0.12);
  }

  function drawSaw(o, camZ, a) {
    // A slot in the track with spinning blades half sunk into it; a moving saw's slot spans all of its travel
    ctx.globalAlpha = a;
    ctx.fillStyle = '#39404d';
    const A = o.A || 0;
    const slot = [P(o.x0 - A, o.z - 0.18, camZ), P(o.x1 + A, o.z - 0.18, camZ), P(o.x1 + A, o.z + 0.18, camZ), P(o.x0 - A, o.z + 0.18, camZ)];
    if (slot.every(Boolean)) {
      poly(slot);
      ctx.fill();
      if (A) { // warning chevrons at both ends of the rail
        ctx.fillStyle = '#ffd34d';
        for (const x of [o.x0 - A, o.x1 + A]) {
          const e = [P(x - 0.03, o.z - 0.3, camZ), P(x + 0.03, o.z - 0.3, camZ), P(x + 0.03, o.z + 0.3, camZ), P(x - 0.03, o.z + 0.3, camZ)];
          if (e.every(Boolean)) { poly(e); ctx.fill(); }
        }
      }
    }
    const [x0, x1] = C.obstacleSpan(o, runTime());
    o = { ...o, x0, x1 };
    const g = P(0, o.z, camZ);
    const span = (o.x1 - o.x0) * V.HALF_M;
    const nb = Math.max(1, Math.round(span / 1.6));
    const R = Math.min(0.75, (span / nb) * 0.47);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-10, -10, vp.w + 20, g.sy + 10);
    ctx.clip();
    for (let k = 0; k < nb; k++) {
      const xc = o.x0 + ((k + 0.5) * (o.x1 - o.x0)) / nb;
      const c = P(xc, o.z, camZ, R * 0.45);
      const rr = R * c.scale;
      if (rr < 0.8) continue;
      const rot = time * 14 + k * 1.3;
      const teeth = 14;
      ctx.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const ang = rot + (i * Math.PI) / teeth;
        const rad = i % 2 ? rr * 0.84 : rr;
        const px = c.sx + Math.cos(ang) * rad;
        const py = c.sy + Math.sin(ang) * rad;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      const grd = ctx.createRadialGradient(c.sx - rr * 0.3, c.sy - rr * 0.3, rr * 0.1, c.sx, c.sy, rr);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.5, '#c4ccd6');
      grd.addColorStop(1, '#7c8796');
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = 'rgba(40, 46, 58, .6)';
      ctx.lineWidth = Math.max(0.5, rr * 0.05);
      ctx.stroke();
      ctx.fillStyle = '#d63b35';
      ctx.beginPath();
      ctx.arc(c.sx, c.sy, rr * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a2f3a';
      ctx.beginPath();
      ctx.arc(c.sx, c.sy, rr * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawWall(o, camZ, a) {
    const f0 = P(o.x0, o.z, camZ);
    const f1 = P(o.x1, o.z, camZ);
    const t0 = P(o.x0, o.z, camZ, WALL_H);
    const b0 = P(o.x0, o.z + WALL_D, camZ, WALL_H);
    const b1 = P(o.x1, o.z + WALL_D, camZ, WALL_H);
    if (!f0 || !b0) return;
    ctx.globalAlpha = a;
    // The side that faces the middle of the track
    if (o.x1 < 0 || o.x0 > 0) {
      const x = o.x1 < 0 ? o.x1 : o.x0;
      ctx.fillStyle = '#a84a24';
      poly([P(x, o.z, camZ), P(x, o.z + WALL_D, camZ), P(x, o.z + WALL_D, camZ, WALL_H), P(x, o.z, camZ, WALL_H)]);
      ctx.fill();
    }
    ctx.fillStyle = '#f59a5c';
    poly([t0, P(o.x1, o.z, camZ, WALL_H), b1, b0]);
    ctx.fill();
    const w = f1.sx - f0.sx;
    const h = f0.sy - t0.sy;
    ctx.fillStyle = '#e06a33';
    ctx.fillRect(f0.sx, t0.sy, w, h);
    // Bricks
    const s = f0.scale;
    if (s > 4) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(f0.sx, t0.sy, w, h);
      ctx.clip();
      ctx.strokeStyle = 'rgba(110, 40, 15, .55)';
      ctx.lineWidth = Math.max(1, s * 0.04);
      const bh = 0.3 * s;
      const bw = 0.7 * s;
      ctx.beginPath();
      for (let r = 0, y = t0.sy; y < f0.sy; r++, y += bh) {
        ctx.moveTo(f0.sx, y);
        ctx.lineTo(f1.sx, y);
        for (let x = f0.sx + (r % 2 ? bw / 2 : 0); x < f1.sx; x += bw) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + bh);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
    // Hazard stripe along the top edge
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(f0.sx, t0.sy, w, Math.max(1, 0.12 * s));
    ctx.globalAlpha = 1;
  }

  const runTime = () => (run ? run.ticks / C.HZ : 0);

  function drawPlatform(p, camZ) {
    const zs = Math.max(p.z0, camZ + V.NEAR);
    if (zs >= p.z1) return;
    const a = clamp((V.FAR - (p.z0 - camZ)) / 30, 0, 1);
    const px = C.platformX(p, runTime());
    const x0 = px - p.w / 2;
    const x1 = px + p.w / 2;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#f2b544';
    poly([P(x0, zs, camZ), P(x1, zs, camZ), P(x1, p.z1, camZ), P(x0, p.z1, camZ)]);
    ctx.fill();
    // Planks across
    ctx.strokeStyle = 'rgba(140, 80, 10, .45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let z = Math.ceil(zs); z < p.z1; z += 1) {
      const l = P(x0, z, camZ);
      const r = P(x1, z, camZ);
      ctx.moveTo(l.sx, l.sy);
      ctx.lineTo(r.sx, r.sy);
    }
    ctx.stroke();
    // Yellow-black edges
    for (const [e0, e1] of [[x0, x0 + 0.05], [x1 - 0.05, x1]]) {
      ctx.fillStyle = '#2b2b2b';
      poly([P(e0, zs, camZ), P(e1, zs, camZ), P(e1, p.z1, camZ), P(e0, p.z1, camZ)]);
      ctx.fill();
    }
    if (p.z0 >= camZ + V.NEAR) {
      ctx.fillStyle = '#b4761b';
      poly([P(x0, p.z0, camZ), P(x1, p.z0, camZ), P(x1, p.z0, camZ, -SLAB * 0.7), P(x0, p.z0, camZ, -SLAB * 0.7)]);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Finish arch: two posts and a checkered banner.
  function drawArch(L, camZ) {
    const z = L.length;
    const l = P(-1.02, z, camZ);
    if (!l) return;
    const a = fade(l.d) * clamp((l.d - 3) / 4, 0, 1); // out of the way before the crowd runs under it
    if (a <= 0.01) return;
    const r = P(1.02, z, camZ);
    const top = P(0, z, camZ, 3.4);
    const s = l.scale;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#eef3fa';
    const pw = Math.max(2, 0.22 * s);
    ctx.fillRect(l.sx - pw / 2, top.sy, pw, l.sy - top.sy);
    ctx.fillRect(r.sx - pw / 2, top.sy, pw, l.sy - top.sy);
    const bh = 0.7 * s;
    const n = 16;
    const cw = (r.sx - l.sx) / n;
    for (let row = 0; row < 2; row++) {
      for (let c = 0; c < n; c++) {
        ctx.fillStyle = (row + c) % 2 ? '#1d2230' : '#ffffff';
        ctx.fillRect(l.sx + c * cw, top.sy + (row * bh) / 2, cw + 0.5, bh / 2 + 0.5);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ───────────── Figures ─────────────
  const TEAM = {
    ours: { body: '#2f7bff', head: '#9fcbff', legs: '#1b4fb0' },
    enemy: { body: '#e43f3a', head: '#ffad9c', legs: '#9c1f1b' },
    recruit: { body: '#2bb35f', head: '#c4f5d3', legs: '#17773b' },
  };

  // A little soldier standing at a projected ground point p. phase: running animation phase, or null for idle.
  function drawSoldier(p, team, phase, power) {
    const s = p.scale * SOLDIER;
    const c = TEAM[team];
    if (s < 3) {
      ctx.fillStyle = c.body;
      ctx.fillRect(p.sx - s * 0.2, p.sy - s, Math.max(1, s * 0.4), Math.max(1, s));
      return;
    }
    const bob = phase === null ? 0 : Math.abs(Math.sin(phase)) * 0.08 * s;
    const swing = phase === null ? 0 : Math.sin(phase) * 0.14 * s;
    const hip = p.sy - 0.44 * s - bob;
    ctx.strokeStyle = c.legs;
    ctx.lineWidth = Math.max(1, 0.12 * s);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.sx - 0.08 * s, hip);
    ctx.lineTo(p.sx - 0.1 * s + swing, p.sy - 0.04 * s);
    ctx.moveTo(p.sx + 0.08 * s, hip);
    ctx.lineTo(p.sx + 0.1 * s - swing, p.sy - 0.04 * s);
    ctx.stroke();
    ctx.fillStyle = c.body;
    ctx.beginPath();
    rrect(ctx, p.sx - 0.2 * s, hip - 0.46 * s, 0.4 * s, 0.5 * s, 0.12 * s);
    ctx.fill();
    if (power >= 2) { // a gun shows from weapon level 2
      ctx.fillStyle = '#28303c';
      ctx.fillRect(p.sx + 0.08 * s, hip - 0.3 * s, 0.34 * s, 0.09 * s);
    }
    ctx.fillStyle = c.head;
    ctx.beginPath();
    ctx.arc(p.sx, hip - 0.62 * s, 0.17 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  function shadow(p, rx) {
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, rx * p.scale, rx * 0.32 * p.scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // A number bubble over a group (screen-sized, like the ads).
  function bubble(p, text, fill, small) {
    const size = small ? 15 : clamp(vp.w / 18, 16, 24);
    ctx.font = `900 ${size}px ${FONT}`;
    const w = Math.max(size * 1.8, ctx.measureText(text).width + size * 1.1);
    const h = size * 1.45;
    const x = p.sx - w / 2;
    const y = p.sy - h - 6;
    ctx.fillStyle = 'rgba(0, 0, 0, .25)';
    ctx.beginPath();
    rrect(ctx, x + 1, y + 3, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    rrect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.sx - 6, y + h);
    ctx.lineTo(p.sx + 6, y + h);
    ctx.lineTo(p.sx, y + h + 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, p.sx, y + h / 2 + 1);
  }

  // Target layout of the crowd for the shown count; the drawn soldiers ease towards it, new ones from the middle.
  function updateSoldiers(count, dt) {
    const key = String(count);
    if (key !== layoutKey) {
      layoutKey = key;
      layout = V.crowdLayout(count, C.radius(count));
    }
    while (soldiers.length < layout.length) soldiers.push({ dx: (Math.random() - 0.5) * 0.05, dy: (Math.random() - 0.5) * 0.05 });
    if (soldiers.length > layout.length) soldiers.length = layout.length;
    const k = Math.min(1, dt * 9);
    for (let i = 0; i < soldiers.length; i++) {
      soldiers[i].dx += (layout[i].dx - soldiers[i].dx) * k;
      soldiers[i].dy += (layout[i].dy - soldiers[i].dy) * k;
    }
  }

  function drawCrowd(camZ, x, running) {
    if (!soldiers.length) return;
    const L = run.level;
    const plat = mode === 'play' || demo ? C.platformAt(L, run.z) : null;
    let p0 = null;
    let p1 = null;
    if (plat) {
      const px = C.platformX(plat, runTime());
      p0 = px - plat.w / 2;
      p1 = px + plat.w / 2;
    }
    const pts = [];
    for (let i = 0; i < soldiers.length; i++) {
      const sx = x + soldiers[i].dx;
      if (plat && (sx < p0 || sx > p1)) continue; // off the platform: they are falling (particles)
      const z = crowdZ + soldiers[i].dy * V.HALF_M * V.DEPTH_SQUASH;
      const p = P(sx, z, camZ);
      if (p) pts.push({ p, i });
    }
    pts.sort((a, b) => a.p.d - b.p.d).reverse();
    ctx.fillStyle = 'rgba(0, 20, 60, .2)';
    for (const { p } of pts) shadow(p, 0.26 * SOLDIER);
    for (const { p, i } of pts) drawSoldier(p, 'ours', running ? time * 13 + i * 1.7 : null, run.power);
  }

  // Recruits wait in a little band, hopping and waving; taken ones vanish (they joined the crowd).
  function drawRecruits(rc, camZ) {
    const j = joined.get(rc.z);
    const gone = j && j.taken ? clamp(j.t / 0.25, 0, 1) : 0;
    if (gone >= 1) return;
    const base = P(rc.x, rc.z, camZ);
    if (!base) return;
    const a = fade(base.d) * (1 - gone);
    if (a <= 0.01) return;
    ctx.globalAlpha = a;
    const shown = Math.min(rc.n, 24);
    const lay = V.crowdLayout(shown, Math.min(0.35, C.radius(rc.n) * 0.8));
    const pts = [];
    for (let i = 0; i < lay.length; i++) {
      const hop = Math.max(0, Math.sin(time * 7 + i * 1.9)) * 0.25;
      const p = P(rc.x + lay[i].dx, rc.z + lay[i].dy * V.HALF_M * V.DEPTH_SQUASH, camZ, hop);
      if (p) pts.push({ p, ground: P(rc.x + lay[i].dx, rc.z + lay[i].dy * V.HALF_M * V.DEPTH_SQUASH, camZ) });
    }
    pts.sort((u, v) => v.p.d - u.p.d);
    ctx.fillStyle = 'rgba(0, 40, 10, .2)';
    for (const { ground } of pts) if (ground) shadow(ground, 0.26 * SOLDIER);
    for (const { p } of pts) drawSoldier(p, 'recruit', null, 1);
    const head = P(rc.x, rc.z, camZ, 1.7);
    if (head && head.d < 60 && !(j && j.taken)) bubble(head, `+${V.fmt(rc.n)}`, '#1f9c4c', true);
    ctx.globalAlpha = 1;
  }

  function enemyFront(L) {
    let z = L.length + ARMY_Z;
    if (battle) {
      const b = battle.view;
      if (b.phase === 'charge') z -= b.k * ARMY_STEP;
      else z -= ARMY_STEP;
    }
    return z;
  }

  function drawArmy(camZ) {
    const L = run.level;
    if (enemyShown <= 0) return;
    const front = enemyFront(L);
    const lay = V.armyLayout(enemyShown);
    const charging = battle && (battle.view.phase === 'charge' || battle.view.phase === 'army');
    ctx.fillStyle = 'rgba(60, 0, 0, .2)';
    const pts = [];
    for (let i = lay.length - 1; i >= 0; i--) {
      const jitter = charging && battle.view.phase === 'army' ? Math.sin(time * 20 + i) * 0.03 : 0;
      const p = P(lay[i].dx + jitter, front + lay[i].dz, camZ);
      if (p) pts.push({ p, i });
    }
    if (!pts.length) return;
    const a = fade(pts[pts.length - 1].p.d);
    ctx.globalAlpha = a;
    for (const { p } of pts) shadow(p, 0.26 * SOLDIER);
    for (const { p, i } of pts) drawSoldier(p, 'enemy', charging ? time * 13 + i : null, L.enemy.power);
    const head = P(0, front, camZ, 1.8);
    if (head && a > 0.3 && head.d < 70) bubble(head, V.fmt(enemyShown), '#d92f2a');
    ctx.globalAlpha = 1;
  }

  function drawBoss(camZ) {
    const L = run.level;
    if (!L.boss) return;
    const z = L.length + BOSS_Z;
    const p = P(0, z, camZ);
    if (!p) return;
    const a = fade(p.d) * (1 - clamp(bossFall - 0.6, 0, 1));
    if (a <= 0.01) return;
    const s = p.scale * 2.6;
    const hit = battle && battle.view.phase === 'boss' ? Math.sin(time * 40) * 0.04 * s : 0;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(40, 0, 30, .25)';
    shadow(p, 1.8);
    ctx.save();
    ctx.translate(p.sx + hit, p.sy);
    ctx.rotate(clamp(bossFall, 0, 1) * 1.3);
    // Legs, body, arms, head with horns, a club
    ctx.fillStyle = '#4a1d5e';
    ctx.fillRect(-0.42 * s, -0.7 * s, 0.3 * s, 0.7 * s);
    ctx.fillRect(0.12 * s, -0.7 * s, 0.3 * s, 0.7 * s);
    ctx.fillStyle = '#7b2f99';
    ctx.beginPath();
    rrect(ctx, -0.6 * s, -1.75 * s, 1.2 * s, 1.15 * s, 0.3 * s);
    ctx.fill();
    ctx.fillStyle = '#9b47bd';
    ctx.beginPath();
    rrect(ctx, -0.85 * s, -1.65 * s, 0.28 * s, 0.85 * s, 0.12 * s);
    rrect(ctx, 0.57 * s, -1.65 * s, 0.28 * s, 0.85 * s, 0.12 * s);
    ctx.fill();
    ctx.fillStyle = '#6b3b1c';
    ctx.save();
    ctx.translate(0.72 * s, -0.85 * s);
    ctx.rotate(-0.5);
    ctx.fillRect(-0.08 * s, -1.1 * s, 0.16 * s, 1.1 * s);
    ctx.beginPath();
    ctx.ellipse(0, -1.1 * s, 0.2 * s, 0.32 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#b05ad1';
    ctx.beginPath();
    ctx.arc(0, -2.05 * s, 0.38 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f1e6c8';
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sgn * 0.22 * s, -2.32 * s);
      ctx.lineTo(sgn * 0.42 * s, -2.75 * s);
      ctx.lineTo(sgn * 0.08 * s, -2.38 * s);
      ctx.fill();
    }
    ctx.fillStyle = '#ffe14d';
    ctx.fillRect(-0.2 * s, -2.12 * s, 0.13 * s, 0.08 * s);
    ctx.fillRect(0.07 * s, -2.12 * s, 0.13 * s, 0.08 * s);
    ctx.restore();
    // HP bar
    if (bossFall < 0.3 && p.d < 50) {
      const top = P(0, z, camZ, 7.6);
      const w = Math.max(60, 2.6 * p.scale);
      const h = 10;
      const k = L.boss.hp > 0 ? clamp(bossShown / L.boss.hp, 0, 1) : 0;
      ctx.fillStyle = 'rgba(0, 0, 0, .55)';
      ctx.fillRect(top.sx - w / 2 - 2, top.sy - 2, w + 4, h + 4);
      ctx.fillStyle = '#ff3b4f';
      ctx.fillRect(top.sx - w / 2, top.sy, w * k, h);
      ctx.font = `800 13px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0, 0, 0, .6)';
      ctx.lineWidth = 3;
      const label = `${t('Босс')} ${V.fmt(bossShown)}`;
      ctx.strokeText(label, top.sx, top.sy - 3);
      ctx.fillText(label, top.sx, top.sy - 3);
    }
    ctx.globalAlpha = 1;
  }

  // ───────────── Particles and floating numbers ─────────────
  function burst(x, z, n, kind, opts = {}) {
    for (let i = 0; i < n; i++) {
      particles.push({
        kind, x: x + (Math.random() - 0.5) * (opts.spread || 0.2), z: z + (Math.random() - 0.5) * 1.2,
        h: opts.h === undefined ? 0.6 : opts.h,
        vx: (Math.random() - 0.5) * (opts.vx || 1.2), vz: (Math.random() - 0.3) * (opts.vz || 6),
        vh: (opts.vh || 4) * (0.6 + Math.random() * 0.8), life: 0, max: opts.life || 1.1,
        spin: (Math.random() - 0.5) * 12, color: opts.color || TEAM.ours.body, size: opts.size || 0.5,
      });
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
  }

  function drawParticles(camZ, dt) {
    const keep = [];
    for (const q of particles) {
      q.life += dt;
      q.x += (q.vx * dt) / V.HALF_M;
      q.z += q.vz * dt;
      q.h += q.vh * dt;
      q.vh -= 16 * dt;
      if (q.kind !== 'fall' && q.h < 0) { q.h = 0; q.vh *= -0.3; q.vx *= 0.6; q.vz *= 0.6; }
      if (q.life >= q.max || q.h < -8) continue;
      keep.push(q);
      const p = P(q.x, q.z, camZ, q.h);
      if (!p) continue;
      const s = p.scale * q.size;
      ctx.globalAlpha = clamp((q.max - q.life) / 0.3, 0, 1);
      if (q.kind === 'spark') {
        ctx.fillStyle = q.color;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, Math.max(1, s * 0.25), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // A tumbling little soldier
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.rotate(q.spin * q.life);
        ctx.fillStyle = q.color;
        ctx.fillRect(-0.2 * s, -0.3 * s, 0.4 * s, 0.6 * s);
        ctx.beginPath();
        ctx.arc(0, -0.5 * s, 0.17 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    particles = keep;
  }

  // A number floating up from the crowd; extra adds fields (fall: a platform-fall counter, n: soldiers in it).
  function addFloat(text, good, extra) {
    floats.push({ text, good, t: 0, dx: (Math.random() - 0.5) * 40, ...extra });
    if (floats.length > 6) floats.shift();
  }

  function drawFloats(camZ, dt) {
    const base = P(crowdX, crowdZ, camZ, 2.2);
    floats = floats.filter((f) => (f.t += dt) < 1.1);
    if (!base) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floats) {
      const k = f.t / 1.1;
      const size = clamp(vp.w / 11, 26, 44) * (1 + 0.3 * Math.max(0, 0.15 - f.t) / 0.15);
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.lineWidth = size * 0.14;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = f.good ? '#0d5a26' : '#6e0d0d';
      ctx.fillStyle = f.good ? '#7dff9f' : '#ff8c80';
      const y = base.sy - 60 - k * 70;
      ctx.strokeText(f.text, base.sx + f.dx, y);
      ctx.fillText(f.text, base.sx + f.dx, y);
    }
    ctx.globalAlpha = 1;
  }

  // The duel bar at the top: the crowd's strength now against what waits at the finish (army + boss).
  function drawDuel() {
    const L = run.level;
    const ours = C.strength(run);
    const theirs = L.enemy.count * L.enemy.power + (L.boss ? L.boss.hp : 0);
    const w = Math.min(320, vp.w - 24);
    const h = 22;
    const x = (vp.w - w) / 2;
    const y = 10;
    const k = ours + theirs > 0 ? clamp(ours / (ours + theirs), 0.08, 0.92) : 0.5;
    ctx.fillStyle = 'rgba(0, 0, 0, .35)';
    ctx.beginPath();
    rrect(ctx, x - 2, y - 2, w + 4, h + 4, (h + 4) / 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    rrect(ctx, x, y, w, h, h / 2);
    ctx.clip();
    ctx.fillStyle = '#2f7bff';
    ctx.fillRect(x, y, w * k, h);
    ctx.fillStyle = '#e43f3a';
    ctx.fillRect(x + w * k, y, w * (1 - k), h);
    ctx.fillStyle = 'rgba(255, 255, 255, .9)';
    ctx.fillRect(x + w * k - 1.5, y, 3, h);
    ctx.restore();
    ctx.font = `900 13px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    const ahead = ours > theirs ? ' ✓' : '';
    ctx.fillText(`⚔ ${V.fmt(ours)}${ahead}`, x + 10, y + h / 2 + 1);
    ctx.textAlign = 'right';
    ctx.fillText(`${V.fmt(theirs)}${L.boss ? ' ♛' : ''}`, x + w - 10, y + h / 2 + 1);
  }

  // ───────────── Scene ─────────────
  function draw(dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!run) return;
    const L = run.level;
    const camZ = crowdZ - V.CAM_BACK;
    if (shake > 0) {
      const m = shake * 14;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    drawSky();
    drawWater(camZ);
    drawTrack(L, camZ);

    // Everything standing on the track, from far to near.
    const items = [];
    const inView = (z) => z > camZ + V.NEAR && z < camZ + V.FAR;
    for (const g of L.gates) if (inView(g.z)) items.push({ z: g.z, f: () => drawGate(g, camZ) });
    for (const o of L.obstacles) {
      if (!inView(o.z)) continue;
      items.push({ z: o.z, f: () => {
        const a = fade(o.z - camZ);
        if (a > 0.01) (o.kind === 'wall' ? drawWall : drawSaw)(o, camZ, a);
      } });
    }
    for (const p of L.platforms) if (p.z1 > camZ + V.NEAR && p.z0 < camZ + V.FAR) items.push({ z: p.z1, f: () => drawPlatform(p, camZ) });
    for (const rc of L.recruits) if (inView(rc.z)) items.push({ z: rc.z, f: () => drawRecruits(rc, camZ) });
    if (inView(L.length)) items.push({ z: L.length + 0.01, f: () => drawArch(L, camZ) });
    items.push({ z: L.length + ARMY_Z, f: () => drawArmy(camZ) });
    items.push({ z: L.length + BOSS_Z, f: () => drawBoss(camZ) });
    items.push({ z: crowdZ, f: () => drawCrowd(camZ, crowdX, mode === 'play' || mode === 'menu' || (battle && battle.view.phase !== 'done')) });
    items.sort((a, b) => b.z - a.z);
    for (const it of items) it.f();

    drawParticles(camZ, dt);
    if (shownCount > 0) {
      const head = P(crowdX, crowdZ, camZ, 1.6);
      if (head) bubble(head, V.fmt(shownCount), '#1f63e0');
    }
    drawFloats(camZ, dt);
    if (!demo && (mode === 'play' || mode === 'pause')) drawDuel();
    if (mode === 'lost' || (mode === 'end' && run.result && !run.result.won)) {
      const a = Math.min(1, modeT * 2) * 0.3;
      const vg = ctx.createRadialGradient(vp.w / 2, vp.h / 2, vp.h * 0.25, vp.w / 2, vp.h / 2, vp.h * 0.75);
      vg.addColorStop(0, 'rgba(120, 0, 0, 0)');
      vg.addColorStop(1, `rgba(120, 0, 0, ${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(-20, -20, vp.w + 40, vp.h + 40);
    }
  }

  // ───────────── Simulation ─────────────
  const sfx = (name, opts) => { if (!demo) Sound.play(name, opts); };
  // A short vibration on a phone, while the sound is on (the same switch for all feedback).
  const buzz = (pattern) => {
    if (demo || !Sound.enabled || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch { /* not allowed here */ }
  };

  function handleEvents() {
    for (const e of run.events) {
      if (e.type === 'gate') {
        pops.set(e.z, { side: e.side, t: 0 });
        addFloat(V.opLabel({ op: e.op, n: e.n }), e.good);
        sfx('gate', { good: e.good });
        if (e.after < e.before) burst(run.x, run.z, Math.min(24, e.before - e.after), 'man', { spread: C.radius(e.before) * 2, vh: 5 });
        else if (e.after > e.before) burst(run.x, run.z, 10, 'spark', { color: '#7dff9f', vh: 6, spread: 0.5, size: 0.6, life: 0.7 });
      } else if (e.type === 'hit') {
        shake = Math.max(shake, 0.25);
        buzz(35);
        addFloat(`−${e.lost}`, false);
        sfx('hit');
        burst(run.x, run.z, Math.min(30, e.lost), 'man', { spread: C.radius(run.count + e.lost) * 2, vh: 6, vz: 3 });
        burst(run.x, run.z, 8, 'spark', { color: '#ffd34d', vh: 5, spread: 0.6, life: 0.5 });
      } else if (e.type === 'recruit') {
        joined.set(e.z, { taken: e.taken, t: 0 });
        if (e.taken) {
          addFloat(`+${e.n}`, true);
          sfx('recruit');
          burst(e.x, e.z, 12, 'spark', { color: '#7dff9f', vh: 6, spread: 0.4, size: 0.6, life: 0.7 });
        }
      } else if (e.type === 'fall') {
        const prevFloat = floats[floats.length - 1];
        if (prevFloat && prevFloat.fall && prevFloat.t < 0.5) {
          prevFloat.n += e.lost;
          prevFloat.text = `−${prevFloat.n}`;
        } else {
          addFloat(`−${e.lost}`, false, { fall: true, n: e.lost });
          sfx('fall');
        }
        const r = C.radius(run.count + e.lost);
        for (let i = 0; i < Math.min(8, e.lost); i++) {
          const side = Math.random() < 0.5 ? -1 : 1;
          burst(run.x + side * r * (0.6 + Math.random() * 0.4), run.z, 1, 'fall', { vh: 1.5, vz: 4, h: 0, life: 1.4, spread: 0.05 });
        }
      }
    }
    run.events.length = 0;
  }

  function newRun(n, isDemo) {
    demo = isDemo;
    levelNum = n;
    run = C.newRun(n, isDemo ? C.expectedUpgrades(n) : save.upgrades);
    battle = null;
    particles = [];
    floats = [];
    pops = new Map();
    joined = new Map();
    soldiers = [];
    layoutKey = '';
    target = 0;
    drag = null;
    keySteer = false;
    crowdZ = 0;
    crowdX = 0;
    shownCount = run.count;
    enemyShown = run.level.enemy.count;
    bossShown = run.level.boss ? run.level.boss.hp : 0;
    bossFall = 0;
    modeT = 0;
  }

  function startBattle() {
    C.finishBattle(run);
    coinsWon = demo ? 0 : C.bank(storage, save, run);
    const plan = V.battlePlan(run);
    battle = { plan, view: V.battleAt(plan, 0) };
    mode = 'battle';
    modeT = 0;
    sfx('battle');
  }

  function loseOnTrack() {
    coinsWon = demo ? 0 : C.bank(storage, save, run);
    mode = 'lost';
    modeT = 0;
    shownCount = 0;
    sfx('lose');
    buzz([60, 40, 90]);
  }

  function steer() {
    if (keys.left !== keys.right) {
      target = keys.left ? -1 : 1;
      keySteer = true;
    } else if (keySteer) {
      target = run.x;
      keySteer = false;
    }
  }

  let clashT = 0;
  // The battle plays out core's result: the crowd charges, the sides melt, then the walk to the boss.
  function updateBattle(dt, L) {
    const b = V.battleAt(battle.plan, modeT);
    const prev = battle.view;
    battle.view = b;
    shownCount = b.ours;
    enemyShown = b.enemy;
    bossShown = b.boss;
    crowdX += (0 - crowdX) * Math.min(1, dt * 3);
    const meet = ARMY_Z - ARMY_STEP - MEET_GAP;
    const atBoss = BOSS_Z - BOSS_GAP;
    if (b.phase === 'charge') crowdZ = L.length + meet * b.k;
    else if (b.phase === 'army') crowdZ = L.length + meet;
    else if (b.phase === 'walk') crowdZ = L.length + meet + (atBoss - meet) * b.k;
    else if (b.phase === 'boss') crowdZ = L.length + atBoss;
    if (b.phase === 'army' || b.phase === 'boss') {
      clashT -= dt;
      if (clashT <= 0) {
        clashT = 0.13;
        // Sparks fly halfway between the crowd and whom it fights.
        const z = L.length + (b.phase === 'army' ? meet + MEET_GAP / 2 : atBoss + BOSS_GAP / 2);
        burst((Math.random() - 0.5) * 1.2, z, 4, 'spark', { color: Math.random() < 0.5 ? '#ffd34d' : '#ffffff', vh: 5, h: 1, spread: 0.3, life: 0.5 });
        if (prev.ours > b.ours) burst(crowdX, crowdZ + 1, Math.min(4, prev.ours - b.ours), 'man', { vh: 5, spread: 0.6, life: 0.9 });
        if (prev.enemy > b.enemy) burst(0, enemyFront(L), Math.min(4, prev.enemy - b.enemy), 'man', { vh: 5, spread: 0.8, life: 0.9, color: TEAM.enemy.body, vz: -2 });
        sfx('clash');
      }
    }
    if (b.phase === 'done' && prev.phase !== 'done') {
      if (battle.plan.won) {
        sfx('win');
        burst(crowdX, crowdZ + 2, 40, 'spark', { color: '#ffd34d', vh: 9, h: 1, spread: 1.4, life: 1.4, size: 0.8 });
        burst(crowdX, crowdZ + 2, 30, 'spark', { color: '#7dff9f', vh: 8, h: 1, spread: 1.4, life: 1.4, size: 0.8 });
        if (coinsWon > 0) sfx('coin');
      } else {
        sfx('lose');
      }
    }
    if (b.phase === 'done' && battle.plan.won && L.boss) bossFall += dt * 1.6;
    if (b.phase === 'done' && b.k >= 1) finish();
  }

  function update(dt) {
    modeT += dt;
    shake = Math.max(0, shake - dt);
    for (const p of pops.values()) p.t += dt;
    for (const j of joined.values()) j.t += dt;
    const L = run.level;
    if (mode === 'play' || (mode === 'menu' && run.status === 'running')) {
      if (mode === 'menu') target = C.pilotTarget(run, 'best'); else steer();
      C.step(run, dt, target);
      handleEvents();
      crowdZ = run.z;
      crowdX = run.x;
      shownCount = run.count;
      if (run.status === 'battle') startBattle();
      else if (run.status === 'lost') loseOnTrack();
    } else if (mode === 'battle') {
      updateBattle(dt, L);
    } else if (mode === 'lost') {
      if (modeT > 1.3) finish();
    }
    if (mode === 'play' && tipT > 0) {
      tipT -= dt;
      if (tipT <= 0) $('tip').hidden = true;
    }
    updateSoldiers(shownCount, dt);
    renderHUD();
  }

  function finish() {
    if (demo) { // the demo behind the menu just starts over
      newRun(levelNum, true);
      mode = 'menu';
      return;
    }
    mode = 'end';
    modeT = 0;
    showResult();
  }

  function frame(now) {
    let dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (mode === 'pause') dt = 0; // the scene stands still behind the pause screen
    time += dt;
    if (run && mode !== 'end' && mode !== 'pause') update(dt);
    else if (run && mode === 'end') { modeT += dt; updateSoldiers(shownCount, dt); }
    draw(dt);
    requestAnimationFrame(frame);
  }

  // ───────────── Screens ─────────────
  const SCREENS = ['menu', 'shop', 'levels', 'result', 'pause'];
  function show(name) {
    for (const id of SCREENS) $(id).hidden = id !== name;
    stage.classList.toggle('dim', !!name);
  }

  function startLevel(n) {
    Sound.unlock();
    newRun(clamp(n, 1, C.MAX_LEVEL), false);
    mode = 'play';
    show(null);
    $('hud').hidden = false;
    const tip = tipFor(levelNum);
    $('tip').textContent = tip ? t(tip) : '';
    $('tip').hidden = !tip;
    tipT = tip ? 4.5 : 0;
    hudKey = '';
    renderHUD();
    canvas.focus({ preventScroll: true });
  }

  // Back to the menu with the autopilot running the next level behind it. A demo already running behind the menu
  // keeps going unless force (boot: there is no run yet).
  function showMenu(force) {
    if (force === true || mode !== 'menu' || !demo) {
      newRun(save.level, true);
      mode = 'menu';
    }
    $('hud').hidden = true;
    $('tip').hidden = true;
    $('btn-play').textContent = t('Играть: уровень {n}', { n: save.level });
    $('menu-coins').textContent = String(save.coins);
    renderSound();
    show('menu');
    $('btn-play').focus({ preventScroll: true });
  }

  // Pause only stops a run on the track: the battle plays out by itself and is short.
  function pause() {
    if (mode !== 'play' || demo) return;
    mode = 'pause';
    keys = { left: false, right: false };
    drag = null;
    $('tip').hidden = true;
    show('pause');
    $('btn-resume').focus({ preventScroll: true });
  }

  function resume() {
    if (mode !== 'pause') return;
    mode = 'play';
    tipT = 0;
    show(null);
    canvas.focus({ preventScroll: true });
  }

  // Stars as small icons into a box: n of 3 filled.
  function fillStars(box, n) {
    box.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const st = document.createElement('i');
      st.className = 'star' + (i < n ? ' on' : '');
      box.append(st);
    }
  }

  function renderShop(bought) {
    $('shop-coins').textContent = String(save.coins);
    const box = $('upgrades');
    box.innerHTML = '';
    for (const id of C.UPGRADES) {
      const lvl = save.upgrades[id];
      const price = C.nextPrice(save, id);
      const card = document.createElement('div');
      card.className = 'upg' + (bought === id ? ' bought' : '');
      card.dataset.id = id;
      const h = document.createElement('h3');
      h.textContent = t(UPG[id].name);
      const p = document.createElement('p');
      p.textContent = t(UPG[id].desc, { n: UPG[id].n });
      const pips = document.createElement('div');
      pips.className = 'pips';
      pips.setAttribute('role', 'img');
      pips.setAttribute('aria-label', t('Уровень {n} из {max}', { n: lvl, max: C.MAX_UPGRADE }));
      for (let i = 0; i < C.MAX_UPGRADE; i++) {
        const pip = document.createElement('i');
        if (i < lvl) pip.className = 'on';
        pips.append(pip);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn buy';
      if (price === null) {
        b.textContent = t('Макс.');
        b.disabled = true;
      } else {
        const can = save.coins >= price;
        b.classList.toggle('can', can);
        b.disabled = !can;
        b.innerHTML = `<i class="coin" aria-hidden="true"></i><span>${price}</span>`;
        b.setAttribute('aria-label', t('Купить «{name}» за {price}', { name: t(UPG[id].name), price }));
        b.addEventListener('click', () => {
          if (C.buy(save, id) !== 'ok') return;
          C.storeSave(storage, save);
          sfx('coin');
          renderShop(id);
          const again = $('upgrades').querySelector(`[data-id="${id}"] .buy`);
          if (again && !again.disabled) again.focus({ preventScroll: true });
        });
      }
      card.append(h, b, p, pips);
      box.append(card);
    }
    $('btn-shop-play').textContent = t('Играть: уровень {n}', { n: shopLevel() });
  }

  // The level the shop's play button starts: the one just lost from the result screen, otherwise the next one.
  const shopLevel = () => (shopFrom === 'result' && run && run.result && !run.result.won && !demo ? levelNum : save.level);

  function showShop(from) {
    shopFrom = from;
    renderShop(null);
    $('hud').hidden = true;
    $('tip').hidden = true;
    show('shop');
    const first = $('upgrades').querySelector('.buy:not(:disabled)');
    (first || $('btn-shop-play')).focus({ preventScroll: true });
  }

  function showLevels() {
    const grid = $('level-grid');
    grid.innerHTML = '';
    const n = Math.ceil(Math.max(C.CAMPAIGN, save.best + 1) / 5) * 5;
    for (let i = 1; i <= n; i++) {
      const open = i <= save.best + 1;
      const done = i <= save.best;
      const boss = C.isBossLevel(i);
      const stars = C.levelStars(save, i);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lvl-btn' + (open ? '' : ' locked') + (done ? ' done' : '') + (boss ? ' boss' : '') + (i === save.level ? ' current' : '');
      b.disabled = !open;
      b.innerHTML = `<b>${i}</b>`;
      if (!open) {
        b.insertAdjacentHTML('beforeend', '<i class="lock" aria-hidden="true"></i>');
      } else if (done) {
        const box = document.createElement('span');
        box.className = 'stars';
        box.setAttribute('aria-hidden', 'true');
        fillStars(box, stars);
        b.append(box);
      } else {
        const small = document.createElement('small');
        small.textContent = boss ? t('босс') : '';
        b.append(small);
      }
      b.setAttribute('aria-label', !open ? t('Уровень {n} закрыт', { n: i })
        : done ? t('Уровень {n}, пройден, звёзд: {s} из 3', { n: i, s: stars }) : t('Уровень {n}', { n: i }));
      b.addEventListener('click', () => startLevel(i));
      grid.append(b);
    }
    $('levels-total').textContent = t('Звёзды: {n} из {max}', { n: C.totalStars(save), max: 3 * save.best });
    $('hud').hidden = true;
    $('tip').hidden = true;
    show('levels');
    const cur = grid.querySelector('.current') || grid.children[0];
    if (cur) {
      cur.focus({ preventScroll: true });
      if (cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }
  }

  function showResult() {
    const res = run.result;
    $('res-title').textContent = res.won ? t('Победа!') : t('Поражение');
    $('res-reason').textContent = res.won ? '' : t(REASONS[res.reason] || REASONS.crowd);
    $('res-reason').hidden = res.won;
    const stars = C.starsFor(run);
    const starBox = $('res-stars');
    starBox.hidden = !res.won;
    if (res.won) {
      fillStars(starBox, stars);
      starBox.setAttribute('aria-label', t('Звёзд: {n} из 3', { n: stars }));
      if (!run.starsShown) { // the first time only, not on the way back from the shop
        run.starsShown = true;
        starBox.classList.remove('reveal');
        void starBox.offsetWidth; // restart the reveal animation
        starBox.classList.add('reveal');
        sfx('star', { n: stars });
      }
    }
    const parLine = $('res-par');
    const need = Math.ceil(C.par(run) * C.STAR_SHARES[1] - C.EPS);
    parLine.hidden = !res.won || stars >= 3;
    if (!parLine.hidden) parLine.textContent = t('Для трёх звёзд нужна сила {p}, у тебя {s}', { p: V.fmt(need), s: V.fmt(res.strength) });
    const line = $('res-survivors');
    if (res.won) line.textContent = t('Выжило бойцов: {n}', { n: res.survivors });
    else if (res.reason === 'crowd') line.textContent = '';
    else line.textContent = t('Сила толпы {s} против {e}', { s: V.fmt(res.strength), e: V.fmt(res.enemy + res.boss) });
    line.hidden = !line.textContent;
    $('res-coins').textContent = `+${coinsWon}`;
    $('res-total').textContent = t('Монет всего: {n}', { n: save.coins });
    const canBuy = C.UPGRADES.some((id) => { const p = C.nextPrice(save, id); return p !== null && p <= save.coins; });
    $('res-hint').hidden = !canBuy;
    $('btn-next').hidden = !res.won;
    $('btn-next').textContent = t('Дальше: уровень {n}', { n: levelNum + 1 });
    $('hud').hidden = true;
    $('tip').hidden = true;
    show('result');
    (res.won ? $('btn-next') : canBuy ? $('btn-res-shop') : $('btn-again')).focus({ preventScroll: true });
  }

  let hudKey = '';
  function renderHUD() {
    if (!run || $('hud').hidden) return;
    const pct = Math.round(clamp(C.progress(run), 0, 1) * 100);
    const key = `${levelNum}:${shownCount}:${run.power}:${pct}`;
    if (key === hudKey) return;
    hudKey = key;
    $('hud-level').textContent = t('Уровень {n}', { n: levelNum });
    $('hud-count').textContent = V.fmt(shownCount);
    $('hud-power').textContent = V.fmtPower(run.power);
    $('hud-fill').style.width = pct + '%';
    $('hud-bar').setAttribute('aria-valuenow', String(pct));
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
  const pointerX = (e) => e.clientX - canvas.getBoundingClientRect().left;
  const trackX = (sx) => { const g = V.unproject(sx, null, 0, vp); return g ? g.x : 0; };

  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'play') return;
    Sound.unlock();
    const sx = pointerX(e);
    if (e.pointerType === 'mouse') {
      target = clamp(trackX(sx), -1, 1);
      keySteer = false;
    } else {
      drag = { id: e.pointerId, sx0: sx, x0: run.x };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (mode !== 'play') return;
    const sx = pointerX(e);
    if (e.pointerType === 'mouse') { // the mouse steers directly: the crowd runs under the cursor
      target = clamp(trackX(sx), -1, 1);
      keySteer = false;
    } else if (drag && e.pointerId === drag.id) {
      target = clamp(drag.x0 + (trackX(sx) - trackX(drag.sx0)) * DRAG_GAIN, -1, 1);
      keySteer = false;
    }
  });
  const release = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = KEYS[e.code];
    if (k && mode === 'play') {
      keys[k] = true;
      e.preventDefault();
    } else if (e.code === 'KeyR' && !demo && (mode === 'play' || mode === 'pause' || mode === 'battle' || mode === 'lost')) {
      startLevel(levelNum);
      e.preventDefault();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      if (mode === 'play') { pause(); e.preventDefault(); }
      else if (mode === 'pause') { resume(); e.preventDefault(); }
      else if (e.code === 'Escape' && !$('shop').hidden) $('btn-shop-back').click();
      else if (e.code === 'Escape' && !$('levels').hidden) showMenu();
    }
  });
  document.addEventListener('keyup', (e) => {
    const k = KEYS[e.code];
    if (k) keys[k] = false;
  });
  // Leaving the tab or the window pauses a run on the track, so nobody comes back to a lost crowd.
  window.addEventListener('blur', () => { keys = { left: false, right: false }; pause(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pause(); });

  $('btn-play').addEventListener('click', () => startLevel(save.level));
  $('btn-shop-menu').addEventListener('click', () => showShop('menu'));
  $('btn-levels-menu').addEventListener('click', showLevels);
  $('btn-sound-menu').addEventListener('click', toggleSound);
  $('btn-levels-back').addEventListener('click', () => showMenu());
  $('btn-shop-back').addEventListener('click', () => (shopFrom === 'result' && mode === 'end' ? showResult() : showMenu()));
  $('btn-shop-play').addEventListener('click', () => startLevel(shopLevel()));
  $('btn-pause').addEventListener('click', pause);
  $('btn-resume').addEventListener('click', resume);
  $('btn-pause-again').addEventListener('click', () => startLevel(levelNum));
  $('btn-pause-menu').addEventListener('click', () => showMenu());
  $('btn-sound').addEventListener('click', toggleSound);
  $('btn-next').addEventListener('click', () => startLevel(levelNum + 1));
  $('btn-again').addEventListener('click', () => startLevel(levelNum));
  $('btn-res-shop').addEventListener('click', () => showShop('result'));
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);

  // ───────────── Boot ─────────────
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = t(meta.content);
  const actions = $('top-actions');
  actions.append(window.I18n.toggle('chip'));
  if (window.GameNav) actions.append(window.GameNav.home('chip'));
  resize();
  showMenu(true);
  requestAnimationFrame(frame);
})();
