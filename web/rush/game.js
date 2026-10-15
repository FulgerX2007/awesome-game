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
    trackA: [240, 243, 251], trackB: [224, 230, 244], arenaA: [250, 224, 216], arenaB: [240, 206, 198],
    side: [92, 104, 168], sideLit: [120, 136, 200], sideDark: [62, 70, 128], trim: [255, 214, 92],
    curbA: [236, 64, 64], curbB: [250, 250, 255],
  };
  const FOG = [214, 234, 248]; // the haze far things melt into
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

  // ───────────── Art kit, camera and baked layers ─────────────
  // Everything below only draws. The camera's drift (camX), roll, zoom and shake move the picture, never the
  // input: a pointer still maps to the track through V.unproject, exactly as before.
  const Fx = window.Fx;
  const WATER_H = -1.15;    // the sea, metres below the track's surface
  const SKIRT = 0.3;        // the slab widens this much (track units) down to the sea, so its sides show
  const TRIM = 0.3;         // metres: the bright trim under the track's rim
  const RAIL = 0.2;         // the curbs stand this high (m)
  const RAIL_W = 0.055;     // and are this wide (track units)
  const GOOD = '#22cf63';
  const BAD = '#ff4545';
  let camX = 0;
  let camRoll = 0;
  let lastCrowdX = 0;
  let flash = null;         // { color, t }: a gate's flash over the scene
  let endT = -1;            // seconds since a won battle ended (confetti, rays, push-in), -1 while not
  let endBurst = false;     // the confetti of this win has been thrown
  let loseT = 0;            // seconds the run has been lost (red grade, pull-out)
  const shakeFx = new Fx.Shake(10, 1.8);
  const confetti = new Fx.Particles(160);

  const P = (x, z, camZ, h) => V.project(x - camX, z, camZ, vp, h);
  // Objects fade in at the far end and fade out as they come between the camera and the crowd.
  const fade = (d) => clamp((d - 1.2) / 3.3, 0, 1) * clamp((V.FAR - d) / 30, 0, 1);
  const fogK = (d) => clamp((d - 40) / 120, 0, 1) * 0.75;
  const fogged = (c, d) => rgb(mix(c, FOG, fogK(d)));

  function poly(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
    ctx.closePath();
  }
  const quad = (pts) => { if (pts.every(Boolean)) { poly(pts); return true; } return false; };

  function layer(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // Sky, sun, far islands, sea and the horizon haze: baked once per canvas size.
  let backdrop = null;
  let haze = null;
  let backdropKey = '';
  function bakeBackdrop() {
    const key = `${vp.w}|${vp.h}|${dpr}`;
    if (key === backdropKey) return;
    backdropKey = key;
    const W = vp.w;
    const H = vp.h;
    const hy = V.horizonY(vp);
    const c = layer(W * dpr, H * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    let gr = g.createLinearGradient(0, 0, 0, hy);
    gr.addColorStop(0, '#3a86dc');
    gr.addColorStop(0.5, '#86c3f0');
    gr.addColorStop(1, '#e2f2fc');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, hy + 2);
    // The sun sits top left: the light every object in the scene is shaded with.
    const sx = W * 0.16;
    const sy = hy * 0.26;
    gr = g.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, hy) * 0.75);
    gr.addColorStop(0, 'rgba(255, 252, 232, 1)');
    gr.addColorStop(0.06, 'rgba(255, 247, 212, .95)');
    gr.addColorStop(0.22, 'rgba(255, 238, 196, .35)');
    gr.addColorStop(1, 'rgba(255, 238, 196, 0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, hy);
    // Far islands: a hazy back range and a nearer green one with a sandy rim.
    const range = (amp, f1, f2, ph, top, low, lift) => {
      g.beginPath();
      g.moveTo(0, hy + 1);
      for (let x = 0; x <= W + 8; x += 6) {
        const u = x / W;
        const bump = Math.max(0, Math.sin(u * f1 + ph)) * amp + Math.max(0, Math.sin(u * f2 + ph * 2.1)) * amp * 1.5;
        g.lineTo(x, hy - (bump + lift) * Math.min(1, H / 640));
      }
      g.lineTo(W, hy + 1);
      g.closePath();
      const lg = g.createLinearGradient(0, hy - amp * 3, 0, hy);
      lg.addColorStop(0, top);
      lg.addColorStop(1, low);
      g.fillStyle = lg;
      g.fill();
    };
    range(9, 7.3, 3.1, 0.4, 'rgba(150, 190, 205, .75)', 'rgba(200, 228, 240, .9)', 0);
    range(8, 9, 4.3, 1.3, 'rgba(70, 150, 112, .95)', 'rgba(150, 196, 180, .95)', -3);
    // The sea: light at the horizon, deep blue at the bottom.
    gr = g.createLinearGradient(0, hy, 0, H);
    gr.addColorStop(0, '#9ad6f0');
    gr.addColorStop(0.05, '#3fa6dd');
    gr.addColorStop(0.35, '#1876c6');
    gr.addColorStop(1, '#083f86');
    g.fillStyle = gr;
    g.fillRect(0, hy, W, H - hy);
    // The sun's glitter path on the sea, under the sun.
    g.save();
    g.translate(sx, hy);
    g.scale(1, 4.5);
    gr = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.32);
    gr.addColorStop(0, 'rgba(255, 250, 225, .4)');
    gr.addColorStop(1, 'rgba(255, 250, 225, 0)');
    g.fillStyle = gr;
    g.fillRect(-W * 0.32, 0, W * 0.64, W * 0.32);
    g.restore();
    backdrop = c;
    // The haze over the horizon: drawn over the far track so it melts into the sea and the sky.
    const hz = layer(4, 128);
    const hg = hz.getContext('2d');
    gr = hg.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(226, 242, 252, 0)');
    gr.addColorStop(0.45, 'rgba(226, 242, 252, .65)');
    gr.addColorStop(1, 'rgba(226, 242, 252, 0)');
    hg.fillStyle = gr;
    hg.fillRect(0, 0, 4, 128);
    haze = hz;
  }

  // A puffy cloud lit from the top left, baked once.
  let cloud = null;
  function cloudSprite() {
    if (cloud) return cloud;
    const c = layer(256, 112);
    const g = c.getContext('2d');
    const puffs = [[70, 70, 38], [112, 52, 46], [158, 60, 40], [196, 74, 30], [40, 80, 24], [130, 82, 36]];
    g.fillStyle = '#ffffff';
    for (const [x, y, r] of puffs) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    g.globalCompositeOperation = 'source-atop';
    const gr = g.createLinearGradient(0, 10, 0, 112);
    gr.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gr.addColorStop(0.55, 'rgba(190, 214, 238, .25)');
    gr.addColorStop(1, 'rgba(150, 180, 220, .7)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 112);
    const hl = g.createRadialGradient(90, 30, 4, 90, 30, 90);
    hl.addColorStop(0, 'rgba(255, 250, 235, .6)');
    hl.addColorStop(1, 'rgba(255, 250, 235, 0)');
    g.fillStyle = hl;
    g.fillRect(0, 0, 256, 112);
    cloud = c;
    return c;
  }

  // ───────────── Backdrop ─────────────
  function drawSky() {
    bakeBackdrop();
    ctx.drawImage(backdrop, 0, 0, vp.w, vp.h);
    const hy = V.horizonY(vp);
    const cs = cloudSprite();
    for (let i = 0; i < 5; i++) {
      const span = vp.w + 300;
      const x = ((hash(i) * span + time * (5 + 4 * hash(i + 9))) % span) - 150;
      const y = hy * (0.12 + 0.52 * hash(i + 3));
      const s = (0.45 + hash(i + 5) * 0.55) * Math.min(1, vp.w / 400) * (0.6 + 0.4 * (y / hy));
      ctx.globalAlpha = 0.75 + 0.25 * (1 - y / hy);
      ctx.drawImage(cs, x - 128 * s, y - 56 * s, 256 * s, 112 * s);
    }
    ctx.globalAlpha = 1;
  }

  function drawWater(camZ) {
    // Glints on the swell, fixed to the world so they stream past as the crowd runs.
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#e6f7ff';
    const z0 = Math.ceil((camZ + 2) / 4) * 4;
    for (let z = z0; z < camZ + 110; z += 4) {
      const d = z - camZ;
      ctx.globalAlpha = 0.45 * clamp(1 - d / 110, 0, 1);
      for (let k = 0; k < 6; k++) {
        const x = -6 + 12 * hash(z * 0.37 + k * 7.1) + Math.sin(time * 0.8 + k + z) * 0.06;
        if (Math.abs(x) < 1 + SKIRT) continue;
        const p = P(x, z + hash(k + z) * 3, camZ, WATER_H);
        if (!p) continue;
        const len = p.scale * (0.5 + 0.5 * Math.sin(time * 2 + k * 2 + z));
        if (len < 0.5) continue;
        ctx.lineWidth = Math.max(1, p.scale * 0.07);
        ctx.beginPath();
        ctx.moveTo(p.sx - len, p.sy);
        ctx.lineTo(p.sx + len, p.sy);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
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
    const trimR = mix(COL.trim, [60, 40, 90], 0.3);
    const lx0 = P(-1, camZ + 6, camZ).sx;
    const lx1 = P(1, camZ + 6, camZ).sx;
    const k = TRIM / -WATER_H;  // share of the skirt the trim takes
    for (const [s, e, start] of pieces) {
      // The slab's shadow on the sea, cast to the right.
      ctx.fillStyle = 'rgba(4, 28, 70, .3)';
      if (quad([P(-0.7, s, camZ, WATER_H), P(1 + SKIRT + 0.45, s, camZ, WATER_H), P(1 + SKIRT + 0.45, e, camZ, WATER_H), P(-0.7, e, camZ, WATER_H)])) ctx.fill();
      // Foam where the slab meets the sea
      for (const sg of [-1, 1]) {
        const xb = sg * (1 + SKIRT);
        const f0 = P(xb, s, camZ, WATER_H);
        const f1 = P(xb, e, camZ, WATER_H);
        if (f0 && f1) {
          ctx.strokeStyle = 'rgba(235, 250, 255, .55)';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(f0.sx, f0.sy); ctx.lineTo(f1.sx, f1.sy); ctx.stroke();
        }
      }
      // The surface, from far to near, cut at stripe boundaries
      let b = e;
      while (b > s) {
        const a = Math.max(s, (Math.ceil(b / STRIP) - 1) * STRIP);
        const idx = Math.floor((a + 0.01) / STRIP);
        const arena = a >= L.length;
        const base = arena ? (idx % 2 ? COL.arenaA : COL.arenaB) : (idx % 2 ? COL.trackA : COL.trackB);
        const d = b - camZ;
        // The sloped sides down to the sea: a bright trim along the rim, then the body; the left one faces the light.
        for (const sg of [-1, 1]) {
          const xt = sg * (1 + SKIRT * k);
          const xb = sg * (1 + SKIRT);
          ctx.fillStyle = fogged(sg < 0 ? COL.trim : trimR, d);
          quad([P(sg, a, camZ), P(sg, b, camZ), P(xt, b, camZ, -TRIM), P(xt, a, camZ, -TRIM)]) && ctx.fill();
          ctx.fillStyle = fogged(sg < 0 ? COL.sideLit : COL.sideDark, d);
          quad([P(xt, a, camZ, -TRIM), P(xt, b, camZ, -TRIM), P(xb, b, camZ, WATER_H), P(xb, a, camZ, WATER_H)]) && ctx.fill();
          // a darker band near the waterline
          ctx.fillStyle = 'rgba(10, 20, 70, .25)';
          const xw = sg * (1 + SKIRT * 0.8);
          quad([P(xw, a, camZ, WATER_H * 0.8), P(xw, b, camZ, WATER_H * 0.8), P(xb, b, camZ, WATER_H), P(xb, a, camZ, WATER_H)]) && ctx.fill();
        }
        if (d < 45) { // near stripes catch the light from the left
          const lg = ctx.createLinearGradient(lx0, 0, lx1, 0);
          lg.addColorStop(0, fogged(mix(base, [255, 250, 235], 0.5), d));
          lg.addColorStop(0.5, fogged(base, d));
          lg.addColorStop(1, fogged(mix(base, [60, 60, 120], 0.12), d));
          ctx.fillStyle = lg;
        } else ctx.fillStyle = fogged(base, d);
        if (quad([P(-1, a, camZ), P(1, a, camZ), P(1, b, camZ), P(-1, b, camZ)])) ctx.fill();
        // Tile seams: a thin darker line at the near edge of every stripe
        if (d < 60) {
          ctx.fillStyle = fogged(mix(base, [90, 100, 140], 0.25), d);
          quad([P(-1, a, camZ), P(1, a, camZ), P(1, a + 0.08, camZ), P(-1, a + 0.08, camZ)]) && ctx.fill();
        }
        if (idx % 2) { // the centre dashes
          ctx.fillStyle = fogged([168, 182, 210], d);
          quad([P(-0.012, a + 0.6, camZ), P(0.012, a + 0.6, camZ), P(0.012, b - 0.6, camZ), P(-0.012, b - 0.6, camZ)]) && ctx.fill();
        }
        // Raised curbs: the inner face (towards the camera's middle) and the top, red and white
        const curb = idx % 2 ? COL.curbA : COL.curbB;
        for (const sg of [-1, 1]) {
          const xo = sg;
          const xi = sg * (1 - RAIL_W);
          ctx.fillStyle = fogged(mix(curb, [30, 20, 70], sg < 0 ? 0.32 : 0.42), d);
          quad([P(xi, a, camZ), P(xi, b, camZ), P(xi, b, camZ, RAIL), P(xi, a, camZ, RAIL)]) && ctx.fill();
          ctx.fillStyle = fogged(mix(curb, [255, 252, 240], sg < 0 ? 0.18 : 0), d);
          quad([P(xo, a, camZ, RAIL), P(xi, a, camZ, RAIL), P(xi, b, camZ, RAIL), P(xo, b, camZ, RAIL)]) && ctx.fill();
        }
        b = a;
      }
      // Soft ambient occlusion next to the curbs and the light falling from the left
      ctx.fillStyle = 'rgba(30, 30, 90, .09)';
      for (const sg of [-1, 1]) {
        quad([P(sg * (1 - RAIL_W), s, camZ), P(sg * (1 - RAIL_W * 2.6), s, camZ), P(sg * (1 - RAIL_W * 2.6), e, camZ), P(sg * (1 - RAIL_W), e, camZ)]) && ctx.fill();
      }
      // The slab's front face where the track starts after a gap
      if (start === s && s > zFrom) {
        ctx.fillStyle = fogged(COL.trim, s - camZ);
        quad([P(-1, s, camZ), P(1, s, camZ), P(1 + SKIRT * k, s, camZ, -TRIM), P(-1 - SKIRT * k, s, camZ, -TRIM)]) && ctx.fill();
        ctx.fillStyle = fogged(COL.side, s - camZ);
        quad([P(-1 - SKIRT * k, s, camZ, -TRIM), P(1 + SKIRT * k, s, camZ, -TRIM), P(1 + SKIRT, s, camZ, WATER_H), P(-1 - SKIRT, s, camZ, WATER_H)]) && ctx.fill();
      }
    }
    // Start and finish lines: checkered bands
    for (const z of [0, L.length]) {
      if (z < zFrom || z + 1.6 > zTo) continue;
      const cols = 10;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.fillStyle = fogged((r + c) % 2 ? [29, 34, 48] : [255, 255, 255], z - camZ);
          const x0 = -1 + RAIL_W + ((2 - 2 * RAIL_W) * c) / cols;
          const x1 = x0 + (2 - 2 * RAIL_W) / cols;
          const z0 = z + r * 0.8;
          quad([P(x0, z0, camZ), P(x1, z0, camZ), P(x1, z0 + 0.8, camZ), P(x0, z0 + 0.8, camZ)]) && ctx.fill();
        }
      }
    }
    // The horizon haze over the far end of the track
    const hy = V.horizonY(vp);
    ctx.drawImage(haze, -10, hy - 40, vp.w + 20, 90);
  }

  // ───────────── Volumes ─────────────
  // A box standing on the track (x in track units, z and h in metres), lit from the top left: the top face is the
  // brightest, the side that faces the light is lit, the other one is in shade, the front darkens to the ground.
  // Returns the front face's screen rectangle { x, y, w, h, s } (null if it isn't drawn).
  function box(x0, x1, z0, z1, h0, h1, camZ, color, o = {}) {
    const A = P(x0, z0, camZ, h0);
    const B = P(x1, z0, camZ, h0);
    const D = P(x0, z0, camZ, h1);
    const E = P(x0, z1, camZ, h1);
    const F = P(x1, z1, camZ, h1);
    if (!E || !F) return null;
    if (camX < x0) {
      ctx.fillStyle = Fx.shade(color, 0.08);
      quad([A || P(x0, z0 + 0.7, camZ, h0), D || P(x0, z0 + 0.7, camZ, h1), E, P(x0, z1, camZ, h0)]) && ctx.fill();
    }
    if (camX > x1) {
      ctx.fillStyle = Fx.shade(color, -0.32);
      quad([B, P(x1, z0, camZ, h1), F, P(x1, z1, camZ, h0)]) && ctx.fill();
    }
    let rect = null;
    if (A && B && D && o.front !== false) {
      rect = { x: A.sx, y: D.sy, w: B.sx - A.sx, h: A.sy - D.sy, s: A.scale };
      const g = ctx.createLinearGradient(0, D.sy, 0, A.sy);
      g.addColorStop(0, Fx.shade(color, 0.06));
      g.addColorStop(1, Fx.shade(color, -0.24));
      ctx.fillStyle = g;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      // a bevel of light along the top edge
      ctx.fillStyle = 'rgba(255, 255, 255, .28)';
      ctx.fillRect(rect.x, rect.y, rect.w, Math.max(0.6, Math.min(rect.h * 0.08, A.scale * 0.04)));
    }
    if (D || o.front === false) {
      const Dt = D || P(x0, z0 + 0.7, camZ, h1);
      const Ct = P(x1, z0, camZ, h1) || P(x1, z0 + 0.7, camZ, h1);
      ctx.fillStyle = o.top || Fx.shade(color, 0.3);
      quad([Dt, Ct, F, E]) && ctx.fill();
    }
    return rect;
  }

  // A soft shadow on the track: a darker core inside a fainter wider band.
  function groundShadow(x0, x1, z0, z1, camZ, alpha, h = 0) {
    ctx.fillStyle = `rgba(16, 20, 60, ${alpha * 0.5})`;
    quad([P(x0 - 0.03, z0 - 0.15, camZ, h), P(x1 + 0.05, z0 - 0.15, camZ, h), P(x1 + 0.05, z1 + 0.3, camZ, h), P(x0 - 0.03, z1 + 0.3, camZ, h)]) && ctx.fill();
    ctx.fillStyle = `rgba(16, 20, 60, ${alpha})`;
    quad([P(x0, z0, camZ, h), P(x1, z0, camZ, h), P(x1, z1, camZ, h), P(x0, z1, camZ, h)]) && ctx.fill();
  }

  // Chunky extruded numbers: a dark extrusion under an outlined, glossy face.
  function chunky(str, x, y, size, deep, face) {
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const ex = Math.max(1, size * 0.07);
    ctx.lineWidth = Math.max(1.5, size * 0.17);
    ctx.strokeStyle = deep;
    ctx.fillStyle = deep;
    ctx.strokeText(str, x, y + ex);
    ctx.fillText(str, x, y + ex);
    ctx.strokeText(str, x, y);
    const g = ctx.createLinearGradient(0, y - size * 0.45, 0, y + size * 0.45);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, face);
    g.addColorStop(0.52, Fx.shade(face, -0.08));
    g.addColorStop(1, Fx.shade(face, -0.2));
    ctx.fillStyle = g;
    ctx.fillText(str, x, y);
  }

  // ───────────── Track objects ─────────────
  const GATE_POST = 0.042;  // half the width of a gate post (track units)
  function drawGate(g, camZ) {
    const base = P(0, g.z, camZ);
    if (!base) return;
    const a = fade(base.d);
    const crossed = g.z <= run.z;
    const pop = pops.get(g.z);
    const sides = g.full ? [['full', -1, 1]] : [['left', -1, 0], ['right', 0, 1]];
    let postA = 0;
    const panels = [];
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
      postA = Math.max(postA, al);
      panels.push({ side, x0, x1, op, al, grow });
    }
    if (postA <= 0.01) return;
    // Coloured light spilling on the track in front of each panel
    for (const p of panels) {
      if (p.al <= 0.01) continue;
      const col = V.goodOp(p.op) ? GOOD : BAD;
      const q0 = P(p.x0 + 0.04, g.z, camZ);
      const q1 = P(p.x0 + 0.08, g.z - 1.8, camZ);
      if (!q0 || !q1) continue;
      ctx.globalAlpha = p.al;
      const lg = ctx.createLinearGradient(0, q0.sy, 0, q1.sy);
      lg.addColorStop(0, Fx.withAlpha(col, 0.32));
      lg.addColorStop(1, Fx.withAlpha(col, 0));
      ctx.fillStyle = lg;
      quad([q1, P(p.x1 - 0.08, g.z - 1.8, camZ), P(p.x1 - 0.04, g.z, camZ), q0]) && ctx.fill();
    }
    // Glass panels with their numbers
    for (const p of panels) {
      if (p.al <= 0.01) continue;
      const good = V.goodOp(p.op);
      const col = good ? GOOD : BAD;
      const l = P(p.x0 + GATE_POST - p.grow, g.z, camZ);
      const r = P(p.x1 - GATE_POST + p.grow, g.z, camZ);
      const top = P(0, g.z, camZ, GATE_H * (1 + p.grow));
      const s = l.scale;
      const w = r.sx - l.sx;
      const h = l.sy - top.sy;
      ctx.globalAlpha = p.al;
      const grd = ctx.createLinearGradient(0, top.sy, 0, l.sy);
      grd.addColorStop(0, Fx.withAlpha(Fx.shade(col, 0.1), 0.72));
      grd.addColorStop(0.6, Fx.withAlpha(col, 0.5));
      grd.addColorStop(1, Fx.withAlpha(Fx.shade(col, -0.2), 0.32));
      ctx.fillStyle = grd;
      ctx.fillRect(l.sx, top.sy, w, h);
      const cx = (l.sx + r.sx) / 2;
      const label = V.opLabel(p.op);
      const size = clamp(Math.min(1.45 * s, (w * 1.45) / (label.length + 0.6)), 6, 180);
      let ty = top.sy + h * 0.55;
      if (s > 3) Fx.glow(ctx, cx, ty, Math.min(w, h) * 0.55, Fx.shade(col, 0.4), 0.45);
      if (s > 2) Fx.glass(ctx, l.sx, top.sy, w, h, 0, { tint: 'rgba(255, 255, 255, .05)', rim: 'rgba(255, 255, 255, .55)', lineWidth: Math.max(0.8, s * 0.03) });
      if (size < 5) continue;
      const deep = good ? '#0a5a2b' : '#7a0c12';
      const face = good ? '#e9fff0' : '#fff0ee';
      if (p.op.op === 'pow') {
        const small = Math.max(5, size * 0.42);
        ctx.font = `800 ${small}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(1, small * 0.2);
        ctx.strokeStyle = deep;
        ctx.fillStyle = '#ffffff';
        ctx.strokeText(t('ОРУЖИЕ'), cx, top.sy + h * 0.28);
        ctx.fillText(t('ОРУЖИЕ'), cx, top.sy + h * 0.28);
        drawGunIcon(cx - size * 0.95, top.sy + h * 0.62, size * 0.5);
        ty = top.sy + h * 0.62;
      }
      chunky(label, p.op.op === 'pow' ? cx + size * 0.25 : cx, ty, size, deep, face);
    }
    // Posts and the coloured beams on top: dimensional frames
    const posts = g.full ? [-1, 1] : [-1, 0, 1];
    for (const p of panels) {
      if (p.al <= 0.01) continue;
      ctx.globalAlpha = p.al;
      const col = V.goodOp(p.op) ? GOOD : BAD;
      const f = box(p.x0 + GATE_POST, p.x1 - GATE_POST, g.z - 0.16, g.z + 0.16, GATE_H, GATE_H + 0.55, camZ, col);
      if (f && f.s > 3) { // a glossy streak along the beam
        ctx.fillStyle = 'rgba(255, 255, 255, .3)';
        ctx.fillRect(f.x + f.w * 0.04, f.y + f.h * 0.22, f.w * 0.92, Math.max(0.6, f.h * 0.14));
      }
    }
    ctx.globalAlpha = postA;
    for (const x of posts) {
      const f = box(x - GATE_POST, x + GATE_POST, g.z - 0.2, g.z + 0.2, 0, GATE_H + 0.62, camZ, '#eef2fa');
      if (f && f.s > 3) { // a post cap
        ctx.fillStyle = 'rgba(255, 255, 255, .5)';
        ctx.fillRect(f.x + f.w * 0.2, f.y + f.h * 0.04, f.w * 0.18, f.h * 0.9);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawGunIcon(x, y, s) {
    ctx.fillStyle = '#2b3442';
    ctx.fillRect(x - s * 0.5, y - s * 0.18, s * 1.1, s * 0.26);
    ctx.fillRect(x - s * 0.45, y, s * 0.24, s * 0.42);
    ctx.fillStyle = '#c9d3df';
    ctx.fillRect(x + s * 0.2, y - s * 0.12, s * 0.38, s * 0.12);
  }

  // A circular saw blade: polished steel with teeth, a groove ring and a red hub, baked once and rotated.
  let saw = null;
  function sawSprite() {
    if (saw) return saw;
    const N = 160;
    const c = layer(N, N);
    const g = c.getContext('2d');
    const m = N / 2;
    const R = m - 2;
    const teeth = 18;
    g.beginPath();
    for (let i = 0; i < teeth * 3; i++) {
      const ang = (i * Math.PI * 2) / (teeth * 3);
      const rad = i % 3 === 0 ? R : i % 3 === 1 ? R * 0.9 : R * 0.82;
      g.lineTo(m + Math.cos(ang) * rad, m + Math.sin(ang) * rad);
    }
    g.closePath();
    let gr = g.createRadialGradient(m - R * 0.35, m - R * 0.4, R * 0.05, m, m, R);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.35, '#d9e0ea');
    gr.addColorStop(0.75, '#8d99ab');
    gr.addColorStop(1, '#5b6678');
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = 'rgba(40, 48, 64, .55)';
    g.lineWidth = 2;
    g.stroke();
    // Brushed-metal sheen: two bright wedges
    g.save();
    g.beginPath(); g.arc(m, m, R * 0.8, 0, Math.PI * 2); g.clip();
    for (const a0 of [-2.4, 0.75]) {
      g.beginPath();
      g.moveTo(m, m);
      g.arc(m, m, R * 0.8, a0, a0 + 0.55);
      g.closePath();
      g.fillStyle = 'rgba(255, 255, 255, .35)';
      g.fill();
    }
    g.restore();
    g.strokeStyle = 'rgba(60, 70, 90, .5)';
    g.lineWidth = 3;
    g.beginPath(); g.arc(m, m, R * 0.6, 0, Math.PI * 2); g.stroke();
    // holes
    g.fillStyle = '#4a5466';
    for (let i = 0; i < 5; i++) {
      const ang = (i * Math.PI * 2) / 5;
      g.beginPath(); g.arc(m + Math.cos(ang) * R * 0.42, m + Math.sin(ang) * R * 0.42, R * 0.07, 0, Math.PI * 2); g.fill();
    }
    Fx.sphere(g, m, m, R * 0.24, '#e0393a');
    g.fillStyle = '#2a2f3a';
    g.beginPath(); g.arc(m, m, R * 0.07, 0, Math.PI * 2); g.fill();
    saw = c;
    return c;
  }

  function drawSaw(o, camZ, a) {
    // A slot in the track with spinning blades half sunk into it; a moving saw's slot spans all of its travel
    ctx.globalAlpha = a;
    const A = o.A || 0;
    const slot = [P(o.x0 - A, o.z - 0.2, camZ), P(o.x1 + A, o.z - 0.2, camZ), P(o.x1 + A, o.z + 0.2, camZ), P(o.x0 - A, o.z + 0.2, camZ)];
    if (slot.every(Boolean)) {
      poly(slot);
      const sg = ctx.createLinearGradient(0, slot[2].sy, 0, slot[0].sy);
      sg.addColorStop(0, '#141824');
      sg.addColorStop(1, '#3a4252');
      ctx.fillStyle = sg;
      ctx.fill();
      // A steel lip on the near edge of the slot
      ctx.fillStyle = '#aab4c4';
      quad([P(o.x0 - A, o.z - 0.26, camZ), P(o.x1 + A, o.z - 0.26, camZ), P(o.x1 + A, o.z - 0.2, camZ), P(o.x0 - A, o.z - 0.2, camZ)]) && ctx.fill();
      if (A) { // warning chevrons at both ends of the rail
        for (const x of [o.x0 - A, o.x1 + A]) {
          for (let i = 0; i < 2; i++) {
            ctx.fillStyle = i ? '#1d2230' : '#ffd34d';
            const w0 = i ? 0.012 : 0.035;
            quad([P(x - w0, o.z - 0.34, camZ), P(x + w0, o.z - 0.34, camZ), P(x + w0, o.z + 0.34, camZ), P(x - w0, o.z + 0.34, camZ)]) && ctx.fill();
          }
        }
      }
    }
    const [x0, x1] = C.obstacleSpan(o, runTime());
    const gp = P(0, o.z, camZ);
    const span = (x1 - x0) * V.HALF_M;
    const nb = Math.max(1, Math.round(span / 1.6));
    const R = Math.min(0.75, (span / nb) * 0.47);
    const sp = sawSprite();
    ctx.save();
    ctx.beginPath();
    ctx.rect(-10, -10, vp.w + 20, gp.sy + 10);
    ctx.clip();
    for (let k = 0; k < nb; k++) {
      const xc = x0 + ((k + 0.5) * (x1 - x0)) / nb;
      const c = P(xc, o.z, camZ, R * 0.45);
      const rr = R * c.scale;
      if (rr < 0.8) continue;
      Fx.shadow(ctx, c.sx + rr * 0.15, gp.sy, rr * 1.05, rr * 0.22, 0.45);
      const rot = time * 14 + k * 1.3;
      ctx.save();
      ctx.translate(c.sx, c.sy);
      ctx.rotate(rot);
      ctx.drawImage(sp, -rr, -rr, rr * 2, rr * 2);
      ctx.globalAlpha = a * 0.35; // motion blur: a ghost a little behind
      ctx.rotate(-0.13);
      ctx.drawImage(sp, -rr, -rr, rr * 2, rr * 2);
      ctx.restore();
      ctx.globalAlpha = a;
      // Sparks where the teeth bite into the slot
      const flick = 0.5 + 0.5 * Math.sin(time * 37 + k * 3);
      Fx.glow(ctx, c.sx - rr * 0.55, gp.sy - rr * 0.05, rr * 0.45, '#ffb347', 0.35 + 0.4 * flick);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawWall(o, camZ, a) {
    ctx.globalAlpha = a;
    groundShadow(o.x0 + 0.03, o.x1 + 0.06, o.z + 0.2, o.z + WALL_D + 1.4, camZ, 0.22);
    groundShadow(o.x0 - 0.02, o.x1 + 0.04, o.z - 0.25, o.z + 0.05, camZ, 0.12);
    const f = box(o.x0, o.x1, o.z, o.z + WALL_D, 0, WALL_H, camZ, '#e66a35', { top: '#f69a62' });
    if (f && f.s > 4) {
      // Bricks with lit top edges and dark mortar
      ctx.save();
      ctx.beginPath();
      ctx.rect(f.x, f.y, f.w, f.h);
      ctx.clip();
      const bh = 0.3 * f.s;
      const bw = 0.7 * f.s;
      ctx.lineWidth = Math.max(1, f.s * 0.035);
      ctx.strokeStyle = 'rgba(105, 34, 12, .55)';
      ctx.beginPath();
      for (let r = 0, y = f.y + bh; y < f.y + f.h; r++, y += bh) {
        ctx.moveTo(f.x, y);
        ctx.lineTo(f.x + f.w, y);
      }
      for (let r = 0, y = f.y; y < f.y + f.h; r++, y += bh) {
        for (let x = f.x + (r % 2 ? bw / 2 : 0); x < f.x + f.w; x += bw) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + bh);
        }
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 200, 160, .35)';
      ctx.lineWidth = Math.max(0.6, f.s * 0.02);
      ctx.beginPath();
      for (let y = f.y + bh + ctx.lineWidth * 1.5; y < f.y + f.h; y += bh) {
        ctx.moveTo(f.x, y);
        ctx.lineTo(f.x + f.w, y);
      }
      ctx.stroke();
      ctx.restore();
    }
    // A yellow-black hazard cap
    const cap = box(o.x0 - 0.008, o.x1 + 0.008, o.z - 0.04, o.z + WALL_D + 0.04, WALL_H, WALL_H + 0.18, camZ, '#ffcc33');
    if (cap && cap.s > 4) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cap.x, cap.y, cap.w, cap.h);
      ctx.clip();
      ctx.fillStyle = 'rgba(29, 34, 48, .85)';
      const st = 0.35 * cap.s;
      ctx.beginPath();
      for (let x = cap.x - cap.h; x < cap.x + cap.w; x += st * 2) {
        ctx.moveTo(x, cap.y + cap.h);
        ctx.lineTo(x + st, cap.y + cap.h);
        ctx.lineTo(x + st + cap.h, cap.y);
        ctx.lineTo(x + cap.h, cap.y);
      }
      ctx.fill();
      ctx.restore();
    }
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
    // Its shadow and a ring of ripples on the sea
    ctx.fillStyle = 'rgba(4, 28, 70, .32)';
    quad([P(x0 + 0.05, zs, camZ, WATER_H), P(x1 + 0.2, zs, camZ, WATER_H), P(x1 + 0.2, p.z1, camZ, WATER_H), P(x0 + 0.05, p.z1, camZ, WATER_H)]) && ctx.fill();
    ctx.strokeStyle = 'rgba(235, 250, 255, .35)';
    const wob = Math.sin(time * 3) * 0.02;
    if (quad([P(x0 - 0.05 + wob, zs, camZ, WATER_H), P(x1 + 0.05 - wob, zs, camZ, WATER_H), P(x1 + 0.05 - wob, p.z1, camZ, WATER_H), P(x0 - 0.05 + wob, p.z1, camZ, WATER_H)])) {
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    box(x0, x1, zs, p.z1, -0.45, 0, camZ, '#d98f2e', { top: '#f2b544', front: p.z0 >= camZ + V.NEAR });
    // Planks across, each with a lit edge
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(130, 70, 10, .5)';
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
      for (let z = Math.floor(zs); z < p.z1; z += 1) {
        ctx.fillStyle = Math.floor(z) % 2 ? '#1d2230' : '#ffcc33';
        quad([P(e0, Math.max(z, zs), camZ), P(e1, Math.max(z, zs), camZ), P(e1, Math.min(z + 1, p.z1), camZ), P(e0, Math.min(z + 1, p.z1), camZ)]) && ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Finish arch: two pillars and a checkered banner with depth.
  function drawArch(L, camZ) {
    const z = L.length;
    const l = P(-1.02, z, camZ);
    if (!l) return;
    const a = fade(l.d) * clamp((l.d - 3) / 4, 0, 1); // out of the way before the crowd runs under it
    if (a <= 0.01) return;
    ctx.globalAlpha = a;
    for (const x of [-1.09, 0.97]) box(x, x + 0.12, z - 0.25, z + 0.25, 0, 3.4, camZ, '#eef2fa');
    const f = box(-1.09, 1.09, z - 0.2, z + 0.2, 3.0, 4.0, camZ, '#ffffff');
    if (f) {
      const n = 16;
      const cw = f.w / n;
      for (let row = 0; row < 2; row++) {
        for (let c = 0; c < n; c++) {
          if ((row + c) % 2) continue;
          ctx.fillStyle = 'rgba(29, 34, 48, .92)';
          ctx.fillRect(f.x + c * cw, f.y + (row * f.h) / 2, cw + 0.5, f.h / 2 + 0.5);
        }
      }
      ctx.fillStyle = 'rgba(255, 255, 255, .22)';
      ctx.fillRect(f.x, f.y, f.w, f.h * 0.3);
    }
    ctx.globalAlpha = 1;
  }

  // ───────────── Figures ─────────────
  // Every figure is a baked lit sprite (one per team and gear) stretched with drawImage: a big crowd costs a
  // shadow, two strokes and one image per soldier, no gradients.
  const TEAM = {
    ours: { body: '#2f7bff', legs: '#1b4fb0', face: false },
    enemy: { body: '#e43f3a', legs: '#9c1f1b', face: true },
    recruit: { body: '#2bb35f', legs: '#17773b', face: true },
  };
  const FIG = { w: 0.7, top: 0.82, bottom: 0.12 }; // sprite box in figure units around the hip
  const FIG_PX = 96;                                // sprite px per figure unit
  const figSprites = new Map();
  function figSprite(team, gun) {
    const key = team + (gun ? '+' : '');
    let c = figSprites.get(key);
    if (c) return c;
    const U = FIG_PX;
    c = layer(FIG.w * U, (FIG.top + FIG.bottom) * U);
    const g = c.getContext('2d');
    g.translate((FIG.w * U) / 2, FIG.top * U);
    g.scale(U, U);
    const col = TEAM[team].body;
    // Body: a capsule lit from the left, with a rim of bounced light on the right
    let gr = g.createLinearGradient(-0.2, 0, 0.2, 0);
    gr.addColorStop(0, Fx.shade(col, 0.4));
    gr.addColorStop(0.35, col);
    gr.addColorStop(0.85, Fx.shade(col, -0.42));
    gr.addColorStop(1, Fx.shade(col, -0.2));
    g.fillStyle = gr;
    Fx.rrect(g, -0.2, -0.5, 0.4, 0.6, 0.18);
    g.fill();
    gr = g.createRadialGradient(-0.08, -0.45, 0.01, -0.08, -0.45, 0.3);
    gr.addColorStop(0, 'rgba(255, 255, 255, .45)');
    gr.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = gr;
    Fx.rrect(g, -0.2, -0.5, 0.4, 0.6, 0.18);
    g.fill();
    // a belt
    g.fillStyle = Fx.withAlpha(Fx.shade(col, -0.55), 0.55);
    g.fillRect(-0.2, -0.05, 0.4, 0.06);
    if (gun) {
      g.fillStyle = '#2a313d';
      Fx.rrect(g, 0.1, -0.32, 0.3, 0.09, 0.03);
      g.fill();
      g.fillStyle = '#7d8898';
      g.fillRect(0.14, -0.31, 0.24, 0.025);
    }
    // Head
    Fx.sphere(g, 0, -0.64, 0.17, Fx.shade(col, 0.12), { shine: 0.65 });
    if (TEAM[team].face) {
      for (const sx of [-0.06, 0.06]) {
        g.fillStyle = '#ffffff';
        g.beginPath(); g.ellipse(sx, -0.64, 0.04, 0.05, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#1a1430';
        g.beginPath(); g.arc(sx + 0.008, -0.63, 0.022, 0, Math.PI * 2); g.fill();
      }
    }
    figSprites.set(key, c);
    return c;
  }

  // One whole figure — contact shadow, legs, arms and the lit body — painted at the feet (0, 0) in figure units.
  // frame: a step of the run cycle, or -1 standing.
  const FIG_FRAMES = 8;
  const FIG_BOX = { l: 0.38, top: 1.16, bottom: 0.16 }; // the baked frame around the feet, figure units
  function paintFigure(g, team, gun, frame, shadow) {
    const c = TEAM[team];
    const running = frame >= 0;
    const sn = running ? Math.sin((frame / FIG_FRAMES) * Math.PI * 2) : 0;
    const bob = running ? Math.abs(sn) * 0.07 : 0;
    const hip = -0.3 - bob;
    if (shadow) Fx.shadow(g, 0.05, 0, 0.32, 0.11, 0.42);
    // Legs: seen from behind, the feet lift in turn
    g.lineCap = 'round';
    g.strokeStyle = c.legs;
    g.lineWidth = 0.14;
    g.beginPath();
    g.moveTo(-0.09, hip);
    g.lineTo(-0.1 - sn * 0.03, -0.05 - Math.max(0, sn) * 0.13);
    g.moveTo(0.09, hip);
    g.lineTo(0.1 - sn * 0.03, -0.05 - Math.max(0, -sn) * 0.13);
    g.stroke();
    // Arms swing opposite the legs
    g.strokeStyle = Fx.shade(c.body, -0.15);
    g.lineWidth = 0.1;
    g.beginPath();
    g.moveTo(-0.19, hip - 0.4);
    g.lineTo(-0.27, hip - 0.16 - Math.max(0, -sn) * 0.1);
    g.moveTo(0.19, hip - 0.4);
    g.lineTo(0.27, hip - 0.16 - Math.max(0, sn) * 0.1);
    g.stroke();
    const sq = running ? 1 + Math.abs(sn) * 0.04 : 1; // a little stretch at the top of each stride
    g.drawImage(figSprite(team, gun), -(FIG.w / 2) / sq, hip - FIG.top * sq, FIG.w / sq, (FIG.top + FIG.bottom) * sq);
  }

  // Baked frames per size: a figure costs one unscaled drawImage, however big the crowd. Sizes are bucketed
  // in 7% steps of device pixels, so a run uses a handful of buckets.
  const figFrames = new Map();
  function figFrame(team, gun, frame, shadow, px) {
    const key = `${team}|${gun ? 1 : 0}|${frame}|${shadow ? 1 : 0}|${px}`;
    let c = figFrames.get(key);
    if (c) return c;
    if (figFrames.size > 900) figFrames.clear();
    const u = px / 100;
    c = layer(FIG_BOX.l * 2 * u, (FIG_BOX.top + FIG_BOX.bottom) * u);
    const g = c.getContext('2d');
    g.translate(FIG_BOX.l * u, FIG_BOX.top * u);
    g.scale(u, u);
    paintFigure(g, team, gun, frame, shadow);
    figFrames.set(key, c);
    return c;
  }

  // A figure standing at a projected ground point p. phase: running animation phase, or null for idle;
  // k: a pop-in scale (new soldiers spring in); shadow: false when the caller draws it (hopping recruits).
  function drawSoldier(p, team, phase, power, k = 1, shadow = true) {
    const s = p.scale * SOLDIER * k;
    if (s < 2.2) {
      ctx.fillStyle = TEAM[team].body;
      ctx.fillRect(p.sx - s * 0.2, p.sy - s, Math.max(1, s * 0.4), Math.max(1, s));
      return;
    }
    const b = Math.round(Math.log(s * dpr) / Math.log(1.07) * 100) / 100;
    const px = Math.round(Math.pow(1.07, Math.round(b)) * 100); // device px per figure unit ×100, bucketed
    const frame = phase === null ? -1 : Math.floor((((phase / (Math.PI * 2)) % 1 + 1) % 1) * FIG_FRAMES);
    const img = figFrame(team, power >= 2, frame, shadow, px);
    const u = px / 100 / dpr;
    ctx.drawImage(img, p.sx - FIG_BOX.l * u, p.sy - FIG_BOX.top * u, img.width / dpr, img.height / dpr);
  }

  const figShadow = (p, k = 1) => Fx.shadow(ctx, p.sx + 0.05 * p.scale * SOLDIER, p.sy, 0.32 * p.scale * SOLDIER * k, 0.11 * p.scale * SOLDIER * k, 0.42);

  // A number bubble over a group (screen-sized, like the ads): a glossy pill with a white rim.
  function bubble(p, text, fill, small) {
    const size = small ? 15 : clamp(vp.w / 18, 16, 24);
    ctx.font = `900 ${size}px ${FONT}`;
    const w = Math.max(size * 1.8, ctx.measureText(text).width + size * 1.1);
    const h = size * 1.45;
    const x = p.sx - w / 2;
    const y = p.sy - h - 6;
    ctx.fillStyle = 'rgba(8, 4, 30, .25)';
    Fx.rrect(ctx, x + 1, y + 4, w, h, h / 2);
    ctx.fill();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, Fx.shade(fill, 0.3));
    g.addColorStop(0.5, fill);
    g.addColorStop(1, Fx.shade(fill, -0.25));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(p.sx - 7, y + h - 1);
    ctx.lineTo(p.sx + 7, y + h - 1);
    ctx.lineTo(p.sx, y + h + 7);
    ctx.closePath();
    ctx.fill();
    Fx.rrect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, .28)';
    Fx.rrect(ctx, x + h * 0.3, y + 3, w - h * 0.6, h * 0.32, h * 0.16);
    ctx.fill();
    Fx.text(ctx, text, p.sx, y + h / 2 + 1, { size, color: '#ffffff', stroke: Fx.shade(fill, -0.55), outline: size * 0.14, font: FONT });
  }

  // Target layout of the crowd for the shown count; the drawn soldiers ease towards it, new ones from the middle.
  function updateSoldiers(count, dt) {
    const key = String(count);
    if (key !== layoutKey) {
      layoutKey = key;
      layout = V.crowdLayout(count, C.radius(count));
    }
    while (soldiers.length < layout.length) soldiers.push({ dx: (Math.random() - 0.5) * 0.05, dy: (Math.random() - 0.5) * 0.05, born: time });
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
      if (p) pts.push({ p, i, k: Fx.ease.outBack(clamp((time - (soldiers[i].born || 0)) / 0.28, 0, 1)) });
    }
    pts.sort((a, b) => b.p.d - a.p.d);
    for (const { p, i, k } of pts) drawSoldier(p, 'ours', running ? time * 13 + i * 1.7 : null, run.power, Math.max(0.01, k));
  }

  // Recruits wait in a little band on a glowing ring, hopping; taken ones vanish (they joined the crowd).
  function drawRecruits(rc, camZ) {
    const j = joined.get(rc.z);
    const gone = j && j.taken ? clamp(j.t / 0.25, 0, 1) : 0;
    if (gone >= 1) return;
    const base = P(rc.x, rc.z, camZ);
    if (!base) return;
    const a = fade(base.d) * (1 - gone);
    if (a <= 0.01) return;
    ctx.globalAlpha = a;
    const rad = Math.min(0.35, C.radius(rc.n) * 0.8);
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    const rx = (rad + 0.08) * V.HALF_M * base.scale;
    ctx.fillStyle = 'rgba(80, 255, 140, .16)';
    ctx.strokeStyle = `rgba(140, 255, 180, ${0.5 + 0.4 * pulse})`;
    ctx.lineWidth = Math.max(1, base.scale * 0.08);
    ctx.beginPath();
    ctx.ellipse(base.sx, base.sy, rx * (1 + pulse * 0.06), rx * 0.3 * (1 + pulse * 0.06), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const shown = Math.min(rc.n, 24);
    const lay = V.crowdLayout(shown, rad);
    const pts = [];
    for (let i = 0; i < lay.length; i++) {
      const hop = Math.max(0, Math.sin(time * 7 + i * 1.9)) * 0.25;
      const gx = rc.x + lay[i].dx;
      const gz = rc.z + lay[i].dy * V.HALF_M * V.DEPTH_SQUASH;
      const p = P(gx, gz, camZ, hop);
      if (p) pts.push({ p, ground: P(gx, gz, camZ), hop });
    }
    pts.sort((u, v) => v.p.d - u.p.d);
    for (const { ground, hop } of pts) if (ground) figShadow(ground, 1 - hop);
    for (const { p } of pts) drawSoldier(p, 'recruit', null, 1, 1, false);
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
    const pts = [];
    for (let i = lay.length - 1; i >= 0; i--) {
      const jitter = charging && battle.view.phase === 'army' ? Math.sin(time * 20 + i) * 0.03 : 0;
      const p = P(lay[i].dx + jitter, front + lay[i].dz, camZ);
      if (p) pts.push({ p, i });
    }
    if (!pts.length) return;
    const a = fade(pts[pts.length - 1].p.d);
    ctx.globalAlpha = a;
    for (const { p, i } of pts) drawSoldier(p, 'enemy', charging ? time * 13 + i : null, L.enemy.power);
    const head = P(0, front, camZ, 1.8);
    if (head && a > 0.3 && head.d < 70) bubble(head, V.fmt(enemyShown), '#d92f2a');
    ctx.globalAlpha = 1;
  }

  // A lit capsule limb from (x0, y0) to (x1, y1) of width w.
  function limb(x0, y0, x1, y1, w, col) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const g = ctx.createLinearGradient(x0 + nx * w, y0 + ny * w, x0 - nx * w, y0 - ny * w);
    g.addColorStop(0, Fx.shade(col, -0.35));
    g.addColorStop(0.6, col);
    g.addColorStop(1, Fx.shade(col, 0.3));
    ctx.strokeStyle = g;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
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
    const fighting = battle && battle.view.phase === 'boss';
    const hit = fighting ? Math.sin(time * 40) * 0.04 * s : 0;
    const breathe = 1 + Math.sin(time * 2.2) * 0.015;
    ctx.globalAlpha = a;
    Fx.shadow(ctx, p.sx + 0.2 * s, p.sy, 1.25 * s * (1 - clamp(bossFall, 0, 1) * 0.3), 0.32 * s, 0.5);
    ctx.save();
    ctx.translate(p.sx + hit, p.sy);
    ctx.rotate(clamp(bossFall, 0, 1) * 1.3);
    // Legs
    limb(-0.27 * s, -0.75 * s, -0.3 * s, -0.12 * s, 0.32 * s, '#4a1d5e');
    limb(0.27 * s, -0.75 * s, 0.3 * s, -0.12 * s, 0.32 * s, '#4a1d5e');
    for (const sg of [-1, 1]) { // boots
      Fx.block(ctx, sg * 0.3 * s - 0.22 * s, -0.2 * s, 0.44 * s, 0.22 * s, 0.1 * s, '#2c1238');
    }
    // The left arm hangs, the right one holds the club up
    limb(-0.7 * s, -1.55 * s, -0.86 * s, -0.85 * s, 0.3 * s, '#8f3fb1');
    ctx.save();
    ctx.translate(0.78 * s, -0.95 * s);
    ctx.rotate(-0.5 + (fighting ? Math.sin(time * 9) * 0.25 : 0));
    limb(0, 0, 0, -1.1 * s, 0.17 * s, '#7a4a22');
    Fx.sphere(ctx, 0, -1.15 * s, 0.26 * s, '#6b3b1c', { shine: 0.35 });
    for (let i = 0; i < 5; i++) {
      const an = -Math.PI / 2 + (i - 2) * 0.6;
      Fx.metalBar(ctx, Math.cos(an) * 0.2 * s, -1.15 * s + Math.sin(an) * 0.2 * s, Math.cos(an) * 0.36 * s, -1.15 * s + Math.sin(an) * 0.36 * s, Math.max(1, 0.06 * s));
    }
    ctx.restore();
    // Body: a big lit bean with a lighter belly
    const bx = -0.62 * s * breathe;
    const bw = 1.24 * s * breathe;
    let g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, Fx.shade('#7b2f99', 0.35));
    g.addColorStop(0.4, '#7b2f99');
    g.addColorStop(0.9, Fx.shade('#7b2f99', -0.45));
    g.addColorStop(1, Fx.shade('#7b2f99', -0.25));
    ctx.fillStyle = g;
    Fx.rrect(ctx, bx, -1.85 * s, bw, 1.25 * s, 0.5 * s);
    ctx.fill();
    g = ctx.createRadialGradient(-0.1 * s, -1.1 * s, 0.05 * s, 0, -1.1 * s, 0.5 * s);
    g.addColorStop(0, 'rgba(230, 180, 255, .55)');
    g.addColorStop(1, 'rgba(230, 180, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, -1.12 * s, 0.42 * s, 0.45 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, .28)';
    ctx.beginPath(); ctx.ellipse(-0.35 * s, -1.55 * s, 0.1 * s, 0.22 * s, 0.3, 0, Math.PI * 2); ctx.fill();
    // Shoulder pads
    for (const sg of [-1, 1]) Fx.sphere(ctx, sg * 0.66 * s, -1.62 * s, 0.24 * s, '#9b47bd');
    // Head with horns and glowing eyes
    for (const sg of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sg * 0.18 * s, -2.3 * s);
      ctx.quadraticCurveTo(sg * 0.55 * s, -2.45 * s, sg * 0.46 * s, -2.85 * s);
      ctx.quadraticCurveTo(sg * 0.38 * s, -2.5 * s, sg * 0.05 * s, -2.38 * s);
      ctx.closePath();
      const hg = ctx.createLinearGradient(sg * 0.1 * s, -2.3 * s, sg * 0.46 * s, -2.85 * s);
      hg.addColorStop(0, '#f7eedb');
      hg.addColorStop(1, '#b9a57e');
      ctx.fillStyle = hg;
      ctx.fill();
    }
    Fx.sphere(ctx, 0, -2.05 * s, 0.4 * s, '#b05ad1');
    for (const sg of [-1, 1]) {
      Fx.glow(ctx, sg * 0.14 * s, -2.08 * s, 0.16 * s, '#ffe14d', 0.9);
      ctx.fillStyle = '#fff7b0';
      ctx.beginPath(); ctx.ellipse(sg * 0.14 * s, -2.08 * s, 0.07 * s, 0.04 * s, sg * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    if (fighting) Fx.glow(ctx, 0, -1.3 * s, 1.4 * s, '#ffffff', 0.18 + 0.18 * Math.sin(time * 40));
    ctx.restore();
    // HP bar
    if (bossFall < 0.3 && p.d < 50) {
      const top = P(0, z, camZ, 7.6);
      const w = Math.max(60, 2.6 * p.scale);
      const h = 11;
      const k = L.boss.hp > 0 ? clamp(bossShown / L.boss.hp, 0, 1) : 0;
      ctx.fillStyle = 'rgba(8, 4, 30, .55)';
      Fx.rrect(ctx, top.sx - w / 2 - 3, top.sy - 3, w + 6, h + 6, (h + 6) / 2);
      ctx.fill();
      if (k > 0) {
        const hg = ctx.createLinearGradient(0, top.sy, 0, top.sy + h);
        hg.addColorStop(0, '#ff8a96');
        hg.addColorStop(0.5, '#ff3b4f');
        hg.addColorStop(1, '#b81a2e');
        ctx.fillStyle = hg;
        Fx.rrect(ctx, top.sx - w / 2, top.sy, Math.max(h, w * k), h, h / 2);
        ctx.fill();
      }
      Fx.text(ctx, `${t('Босс')} ${V.fmt(bossShown)}`, top.sx, top.sy - 11, { size: 14, color: '#ffffff', stroke: '#2a0d3a', outline: 3.5, font: FONT });
    }
    ctx.globalAlpha = 1;
  }

  // ───────────── Particles and floating numbers ─────────────
  function burst(x, z, n, kind, opts = {}) {
    for (let i = 0; i < n; i++) {
      particles.push({
        kind, x: x + (Math.random() - 0.5) * (opts.spread || 0.2), z: z + (Math.random() - 0.5) * (opts.zs === undefined ? 1.2 : opts.zs),
        h: opts.h === undefined ? 0.6 : opts.h + (opts.hs ? Math.random() * opts.hs : 0),
        vx: (Math.random() - 0.5) * (opts.vx || 1.2), vz: (Math.random() - 0.3) * (opts.vz || 6) + (opts.vz0 || 0),
        vh: (opts.vh || 4) * (0.6 + Math.random() * 0.8), life: 0, max: opts.life || 1.1,
        spin: (Math.random() - 0.5) * 12, color: opts.color || TEAM.ours.body, size: opts.size || 0.5,
      });
    }
    if (particles.length > 320) particles.splice(0, particles.length - 320);
  }

  function drawParticles(camZ, dt) {
    const keep = [];
    for (const q of particles) {
      q.life += dt;
      q.x += (q.vx * dt) / V.HALF_M;
      q.z += q.vz * dt;
      q.h += q.vh * dt;
      q.vh -= (q.kind === 'shard' ? 9 : 16) * dt;
      if (q.kind === 'fall' && q.h < WATER_H) { // a splash where a falling soldier hits the sea
        burst(q.x, q.z, 5, 'drop', { h: WATER_H, vh: 4, spread: 0.06, vx: 2, vz: 2, zs: 0.2, color: '#e8f8ff', size: 0.12, life: 0.6 });
        burst(q.x, q.z, 1, 'ring', { h: WATER_H, vh: 0, spread: 0, vx: 0, vz: 0, zs: 0, color: '#e8f8ff', size: 0.3, life: 0.7 });
        continue;
      }
      if (q.kind !== 'fall' && q.kind !== 'drop' && q.kind !== 'ring' && q.h < 0) { q.h = 0; q.vh *= -0.3; q.vx *= 0.6; q.vz *= 0.6; }
      if (q.life >= q.max || q.h < -8) continue;
      keep.push(q);
      const p = P(q.x, q.z, camZ, q.kind === 'ring' ? WATER_H : q.h);
      if (!p) continue;
      const s = p.scale * q.size;
      const al = clamp((q.max - q.life) / 0.3, 0, 1) * clamp((p.d - 1.5) / 2.5, 0, 1); // gone before they fill the lens
      if (al <= 0.01) continue;
      ctx.globalAlpha = al;
      if (q.kind === 'spark') {
        Fx.glow(ctx, p.sx, p.sy, clamp(s * 0.9, 2, 40), q.color, 0.8);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, Math.max(0.8, s * 0.16), 0, Math.PI * 2);
        ctx.fill();
      } else if (q.kind === 'shard') { // a tumbling sliver of the gate's glass
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.rotate(q.spin * q.life);
        ctx.scale(1, Math.abs(Math.cos(q.spin * q.life * 0.7)) + 0.2);
        ctx.fillStyle = q.color;
        ctx.beginPath();
        ctx.moveTo(-s * 0.5, -s * 0.3);
        ctx.lineTo(s * 0.5, -s * 0.5);
        ctx.lineTo(s * 0.1, s * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, .7)';
        ctx.fillRect(-s * 0.3, -s * 0.35, s * 0.5, Math.max(0.6, s * 0.1));
        ctx.restore();
      } else if (q.kind === 'drop') {
        ctx.fillStyle = q.color;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, Math.max(0.8, s * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (q.kind === 'ring') {
        const k = q.life / q.max;
        const r = p.scale * (0.2 + k * 1.2);
        ctx.strokeStyle = q.color;
        ctx.lineWidth = Math.max(0.8, p.scale * 0.08 * (1 - k));
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy, r, r * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // A tumbling little soldier
        const team = q.color === TEAM.enemy.body ? 'enemy' : 'ours';
        const sz = p.scale * SOLDIER;
        if (q.kind !== 'fall') Fx.shadow(ctx, p.sx, P(q.x, q.z, camZ).sy, sz * 0.25, sz * 0.08, 0.3 * al);
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.rotate(q.spin * q.life);
        ctx.drawImage(figSprite(team, false), -FIG.w * sz / 2, -FIG.top * sz * 0.7, FIG.w * sz, (FIG.top + FIG.bottom) * sz);
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
    for (const f of floats) {
      const k = f.t / 1.1;
      const pop = Fx.ease.outBack(clamp(f.t / 0.22, 0, 1));
      const size = clamp(vp.w / 10, 28, 48) * Math.max(0.05, pop);
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const y = base.sy - 60 - Fx.ease.outCubic(k) * 70;
      if (f.t < 0.3) Fx.glow(ctx, base.sx + f.dx, y, size * 1.4, f.good ? '#7dff9f' : '#ff6a5a', (0.3 - f.t) * 2);
      chunky(f.text, base.sx + f.dx, y, size, f.good ? '#0b5a26' : '#6e0d0d', f.good ? '#8dffaa' : '#ff9488');
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
    ctx.fillStyle = 'rgba(8, 4, 30, .4)';
    Fx.rrect(ctx, x - 3, y - 2, w + 6, h + 6, (h + 6) / 2);
    ctx.fill();
    ctx.save();
    Fx.rrect(ctx, x, y, w, h, h / 2);
    ctx.clip();
    for (const [x0, ww, col] of [[x, w * k, '#2f7bff'], [x + w * k, w * (1 - k), '#e43f3a']]) {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, Fx.shade(col, 0.35));
      g.addColorStop(0.5, col);
      g.addColorStop(1, Fx.shade(col, -0.3));
      ctx.fillStyle = g;
      ctx.fillRect(x0, y, ww, h);
    }
    ctx.fillStyle = 'rgba(255, 255, 255, .25)';
    ctx.fillRect(x, y + 2, w, h * 0.28);
    ctx.fillStyle = 'rgba(255, 255, 255, .95)';
    ctx.fillRect(x + w * k - 1.5, y, 3, h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 255, 255, .5)';
    ctx.lineWidth = 1.5;
    Fx.rrect(ctx, x, y, w, h, h / 2);
    ctx.stroke();
    Fx.glow(ctx, x + w * k, y + h / 2, h * 0.9, '#ffffff', 0.35);
    ctx.font = `900 13px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8, 4, 30, .45)';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    const ahead = ours > theirs ? ' ✓' : '';
    ctx.strokeText(`⚔ ${V.fmt(ours)}${ahead}`, x + 10, y + h / 2 + 1);
    ctx.fillText(`⚔ ${V.fmt(ours)}${ahead}`, x + 10, y + h / 2 + 1);
    ctx.textAlign = 'right';
    ctx.strokeText(`${V.fmt(theirs)}${L.boss ? ' ♛' : ''}`, x + w - 10, y + h / 2 + 1);
    ctx.fillText(`${V.fmt(theirs)}${L.boss ? ' ♛' : ''}`, x + w - 10, y + h / 2 + 1);
  }

  // Golden rays behind the winning crowd, baked once.
  let rays = null;
  function raysSprite() {
    if (rays) return rays;
    const N = 256;
    const c = layer(N, N);
    const g = c.getContext('2d');
    const m = N / 2;
    const gr = g.createRadialGradient(m, m, 0, m, m, m);
    gr.addColorStop(0, 'rgba(255, 236, 150, .9)');
    gr.addColorStop(0.5, 'rgba(255, 220, 120, .35)');
    gr.addColorStop(1, 'rgba(255, 220, 120, 0)');
    g.fillStyle = gr;
    for (let i = 0; i < 14; i++) {
      const a0 = (i / 14) * Math.PI * 2;
      g.beginPath();
      g.moveTo(m, m);
      g.arc(m, m, m, a0, a0 + 0.2);
      g.closePath();
      g.fill();
    }
    rays = c;
    return c;
  }

  // A gate the crowd went through: the glass bursts into shards with a flash of its colour.
  function gateBurst(e) {
    const gate = run.level.gates.find((g) => g.z === e.z);
    const [x0, x1] = !gate || gate.full ? [-1, 1] : e.side === 'left' ? [-1, 0] : [0, 1];
    const col = e.good ? '#9bffbe' : '#ff9a90';
    burst((x0 + x1) / 2, e.z, 18, 'shard', { spread: x1 - x0, h: 0.2, hs: GATE_H, vh: 3, vx: 2.5, vz: 6, vz0: 9, zs: 0.2, color: col, size: 0.3, life: 0.9 });
    burst((x0 + x1) / 2, e.z, 10, 'spark', { spread: x1 - x0, h: 0.4, hs: 2, vh: 4, vz: 6, vz0: 8, zs: 0.2, color: e.good ? '#7dff9f' : '#ff7a6a', size: 0.5, life: 0.6 });
    flash = { color: e.good ? '#7dff9f' : '#ff5a4a', t: 0 };
  }

  // ───────────── Scene ─────────────
  function draw(dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!run) return;
    const L = run.level;
    const camZ = crowdZ - V.CAM_BACK;
    shakeFx.update(dt);
    confetti.update(dt);
    // The camera drifts a little after the crowd and banks into its turns (drawing only).
    if (dt > 0) {
      camX = Fx.damp(camX, crowdX * 0.12, 0.95, dt);
      const vx = (crowdX - lastCrowdX) / dt;
      camRoll = Fx.damp(camRoll, clamp(-vx * 0.012, -0.022, 0.022), 0.98, dt);
    }
    lastCrowdX = crowdX;
    const won = battle && battle.plan.won && battle.view.phase === 'done';
    if (won) { if (endT < 0) endT = 0; endT += dt; } else if (mode !== 'end') { endT = -1; endBurst = false; }
    else if (endT >= 0) endT += dt;
    const lost = mode === 'lost' || (mode === 'end' && run.result && !run.result.won);
    loseT = lost ? loseT + dt : 0;
    drawSky();
    const off = shakeFx.offset();
    const anchor = P(crowdX, crowdZ, camZ) || { sx: vp.w / 2, sy: V.groundY(vp) };
    const zoom = endT >= 0 ? 1 + 0.07 * Fx.ease.inOutCubic(clamp(endT / 1.2, 0, 1))
      : lost ? 1 - 0.05 * Fx.ease.outCubic(clamp(loseT / 1.5, 0, 1)) : 1;
    ctx.save();
    ctx.translate(anchor.sx + off.x, anchor.sy + off.y);
    ctx.rotate(camRoll);
    ctx.scale(zoom, zoom);
    ctx.translate(-anchor.sx, -anchor.sy);
    drawWater(camZ);
    drawTrack(L, camZ);
    if (endT >= 0) { // golden rays behind the winners
      const head = P(crowdX, crowdZ, camZ, 1.2);
      if (head) {
        const r = Math.max(vp.w, vp.h) * 0.6 * Fx.ease.outBack(clamp(endT / 0.6, 0, 1));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.45 * clamp(endT / 0.4, 0, 1);
        ctx.translate(head.sx, head.sy);
        ctx.rotate(time * 0.25);
        ctx.drawImage(raysSprite(), -r, -r, r * 2, r * 2);
        ctx.restore();
      }
    }

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
    if (flash) { // the flash of a gate the crowd just went through
      flash.t += dt;
      const k = flash.t / 0.35;
      if (k >= 1) flash = null;
      else if (anchor) Fx.glow(ctx, anchor.sx, anchor.sy - 30, vp.w * (0.35 + 0.4 * k), flash.color, 0.55 * (1 - k));
    }
    if (shownCount > 0) {
      const head = P(crowdX, crowdZ, camZ, 1.6);
      if (head) bubble(head, V.fmt(shownCount), '#1f63e0');
    }
    drawFloats(camZ, dt);
    ctx.restore();

    // Screen-space layers: confetti, the duel bar and the end-of-run grading.
    if (endT >= 0 && !endBurst && !demo) {
      endBurst = true;
      const cols = ['#ffd34d', '#4fd17a', '#2f7bff', '#ff5a8a', '#ffffff'];
      confetti.burst(vp.w * 0.2, vp.h * 0.35, 50, { speed: 260, angle: -1.1, spread: 1.4, gravity: 260, drag: 0.6, shape: 'confetti', colors: cols, size: 7, spin: 9, life: 2.2 });
      confetti.burst(vp.w * 0.8, vp.h * 0.35, 50, { speed: 260, angle: -2.0, spread: 1.4, gravity: 260, drag: 0.6, shape: 'confetti', colors: cols, size: 7, spin: 9, life: 2.2 });
    }
    confetti.draw(ctx);
    if (!demo && (mode === 'play' || mode === 'pause')) drawDuel();
    if (lost) {
      const a = Math.min(1, loseT * 2) * 0.38;
      const vg = ctx.createRadialGradient(vp.w / 2, vp.h / 2, vp.h * 0.2, vp.w / 2, vp.h / 2, vp.h * 0.75);
      vg.addColorStop(0, 'rgba(120, 0, 20, 0)');
      vg.addColorStop(1, `rgba(120, 0, 20, ${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(-20, -20, vp.w + 40, vp.h + 40);
      ctx.fillStyle = `rgba(20, 10, 40, ${a * 0.35})`;
      ctx.fillRect(0, 0, vp.w, vp.h);
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
        gateBurst(e);
        addFloat(V.opLabel({ op: e.op, n: e.n }), e.good);
        sfx('gate', { good: e.good });
        if (e.after < e.before) burst(run.x, run.z, Math.min(24, e.before - e.after), 'man', { spread: C.radius(e.before) * 2, vh: 5 });
        else if (e.after > e.before) burst(run.x, run.z, 10, 'spark', { color: '#7dff9f', vh: 6, spread: 0.5, size: 0.6, life: 0.7 });
      } else if (e.type === 'hit') {
        shakeFx.add(0.5);
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
    shakeFx.add(0.5);
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
        shakeFx.add(0.12);
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
        shakeFx.add(0.45);
      }
    }
    if (b.phase === 'done' && battle.plan.won && L.boss) bossFall += dt * 1.6;
    if (b.phase === 'done' && b.k >= 1) finish();
  }

  function update(dt) {
    modeT += dt;
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
