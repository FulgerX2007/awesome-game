'use strict';
// Аншлаг — the page: the underpass on a canvas, the band panel, input, calibration and saving.
// Rules live in core.js, the music in music.js; this file only wires them to the screen.
(function () {
  const C = window.BeatCore;
  const M = window.BeatMusic;
  const t = (k, v) => I18n.t(k, v);
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = 'beat.save';
  const PREFS_KEY = 'beat.prefs';
  const SAVE_EVERY = 10;
  const CALIB_TAPS = 10;
  const CALIB_SKIP = 2; // the first taps find the beat, they are not measured
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* blocked */ } },
  };

  // ───────────── Numbers ─────────────
  const nf1 = new Intl.NumberFormat(I18n.locale, { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat(I18n.locale, { maximumFractionDigits: 0 });
  const cf = new Intl.NumberFormat(I18n.locale, { notation: 'compact', maximumFractionDigits: 1 });
  function fmt(x) {
    if (!Number.isFinite(x)) return '∞';
    if (x < 10) return nf1.format(Math.floor(x * 10) / 10);
    if (x < 1e4) return nf0.format(Math.floor(x));
    return cf.format(x);
  }

  // ───────────── State ─────────────
  let S = C.newState();
  let away = 0;
  try {
    const raw = JSON.parse(store.get(SAVE_KEY));
    if (raw && raw.state) {
      S = C.migrate(raw.state);
      if (Number.isFinite(raw.savedAt)) away = Math.max(0, (Date.now() - raw.savedAt) / 1000);
    }
  } catch { S = C.newState(); }
  const prefs = { offset: 0 };
  try {
    const p = JSON.parse(store.get(PREFS_KEY));
    if (p && Number.isFinite(p.offset)) prefs.offset = C.calibrate([p.offset]);
  } catch { /* keep 0 */ }
  const save = () => store.set(SAVE_KEY, JSON.stringify({ state: C.serialize(S), savedAt: Date.now() }));
  const savePrefs = () => store.set(PREFS_KEY, JSON.stringify(prefs));

  // intro → play; calib is the calibration screen
  let mode = 'intro';
  let calib = null;
  const BAND = { grid: () => (S.run ? S.run.grid : null), levels: () => S.levels, seed: 1 };
  // The judge's clock: what the player hears now, minus the measured delay.
  const clock = () => M.heardNow() - prefs.offset;

  // ───────────── Canvas and layout ─────────────
  const wrap = $('stage-wrap');
  const canvas = $('stage');
  const g = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, L = null, bg = null;

  function layout(w, h) {
    const u = Math.min(w / 6.3, h / 3.6);
    // a tall phone screen gets the stage a bit higher and more room for the crowd
    const floor = h * (h > w * 1.1 ? 0.64 : 0.7);
    const cx = w / 2;
    return {
      w, h, u, cx, floor, wallY: floor - 0.38 * u,
      bx: cx, btop: floor - 0.45 * u, brx: 0.4 * u, bh: 0.6 * u,
      comboY: floor - 2.3 * u,
      kase: { x: cx + 0.62 * u, y: floor + 0.42 * u, w: 1.05 * u, h: 0.36 * u },
      slots: {
        keys: { x: cx - 1.95 * u, y: floor - 0.34 * u, s: 0.8 },
        bass: { x: cx - 2.65 * u, y: floor + 0.02 * u, s: 1 },
        shaker: { x: cx - 1.3 * u, y: floor + 0.08 * u, s: 0.92 },
        guitar: { x: cx + 1.35 * u, y: floor + 0.06 * u, s: 1 },
        sax: { x: cx + 2.65 * u, y: floor + 0.02 * u, s: 1 },
      },
    };
  }

  function resize() {
    const r = wrap.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    L = layout(W, H);
    bg = bakeBackground(L);
    crowdLayout();
  }

  // A tiny seeded generator for the scenery, so the wall and the crowd don't jump on resize.
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The still part of the scene: tiled walls, the ochre stripe, the exit sign, a poster and the granite floor.
  function bakeBackground(l) {
    const cv = document.createElement('canvas');
    cv.width = Math.round(l.w * DPR); cv.height = Math.round(l.h * DPR);
    const b = cv.getContext('2d');
    b.scale(DPR, DPR);
    const { w, h, u, cx, wallY } = l;
    const rnd = seeded(7);
    // wall
    const wg = b.createLinearGradient(0, 0, 0, wallY);
    wg.addColorStop(0, '#16232b'); wg.addColorStop(1, '#2b3d45');
    b.fillStyle = wg; b.fillRect(0, 0, w, wallY);
    const tw = Math.max(14, 0.34 * u), th = tw / 2;
    for (let row = 0, y = wallY - th; y > -th; row++, y -= th) {
      const stripe = row === 4 || row === 5;
      for (let x = -((row % 2) * tw) / 2; x < w; x += tw) {
        const k = rnd();
        b.fillStyle = stripe ? Fx.mix('#b8892c', '#d8a640', k) : Fx.mix('#9fb3b5', '#c3d1cf', k);
        b.globalAlpha = stripe ? 0.85 : 0.16 + 0.06 * k;
        b.fillRect(x + 1, y + 1, tw - 2, th - 2);
      }
    }
    b.globalAlpha = 1;
    // grime towards the floor
    const gr = b.createLinearGradient(0, wallY - 1.2 * u, 0, wallY);
    gr.addColorStop(0, 'rgba(10, 8, 16, 0)'); gr.addColorStop(1, 'rgba(10, 8, 16, .55)');
    b.fillStyle = gr; b.fillRect(0, wallY - 1.2 * u, w, 1.2 * u);
    // the lamp's light on the wall
    const lg = b.createRadialGradient(cx, 0, 0, cx, 0, Math.max(w, h) * 0.75);
    lg.addColorStop(0, 'rgba(255, 236, 200, .32)'); lg.addColorStop(0.5, 'rgba(255, 236, 200, .08)'); lg.addColorStop(1, 'rgba(255, 236, 200, 0)');
    b.fillStyle = lg; b.fillRect(0, 0, w, wallY);
    // a poster on the left, above the band's heads
    const px = cx - 2.45 * u, py = wallY - 2.8 * u;
    if (px > 0.1 * u && py > 0.9 * u) {
      b.save(); b.translate(px, py); b.rotate(-0.04);
      Fx.block(b, 0, 0, 0.8 * u, 1.05 * u, 3, '#e9e1cf');
      b.fillStyle = '#c0392b'; b.fillRect(0.06 * u, 0.08 * u, 0.68 * u, 0.22 * u);
      b.fillStyle = 'rgba(40, 30, 30, .45)';
      for (let k = 0; k < 4; k++) b.fillRect(0.08 * u, 0.42 * u + k * 0.13 * u, (0.64 - (k % 2) * 0.2) * u, 0.05 * u);
      b.restore();
    }
    // the exit sign, no bigger than a real one next to the band
    const su = Math.min(u, 80);
    const sx = Math.min(w - 1.1 * su, cx + 2.4 * u), sy = 0.35 * su;
    Fx.block(b, sx - 0.75 * su, sy, 1.5 * su, 0.42 * su, 6, '#1f7a4a', { edge: 1 });
    Fx.text(b, `${t('ВЫХОД')} →`, sx, sy + 0.22 * su, { size: Math.max(10, 0.2 * su), color: '#f4fff8', outline: 0 });
    // floor: granite with tile seams in perspective
    const fg = b.createLinearGradient(0, wallY, 0, h);
    fg.addColorStop(0, '#2e2733'); fg.addColorStop(1, '#141118');
    b.fillStyle = fg; b.fillRect(0, wallY, w, h - wallY);
    b.strokeStyle = 'rgba(255, 255, 255, .05)'; b.lineWidth = 1;
    const vy = wallY - 3 * u;
    for (let k = -12; k <= 12; k++) {
      const x = cx + k * 0.9 * u;
      b.beginPath(); b.moveTo(cx + (x - cx) * ((wallY - vy) / (h - vy)), wallY); b.lineTo(x, h); b.stroke();
    }
    for (let y = wallY + 0.12 * u, k = 1; y < h; k++, y += 0.12 * u * k) { b.beginPath(); b.moveTo(0, y); b.lineTo(w, y); b.stroke(); }
    b.fillStyle = 'rgba(0, 0, 0, .35)'; b.fillRect(0, wallY, w, 3);
    // the lamp's reflection on the floor
    const rg = b.createRadialGradient(cx, wallY + 0.5 * u, 0, cx, wallY + 0.5 * u, 2.6 * u);
    rg.addColorStop(0, 'rgba(255, 230, 190, .16)'); rg.addColorStop(1, 'rgba(255, 230, 190, 0)');
    b.fillStyle = rg; b.fillRect(0, wallY, w, h - wallY);
    return cv;
  }

  // ───────────── Effects ─────────────
  const parts = new Fx.Particles(500);
  const floats = new Fx.Floaters();
  const shake = new Fx.Shake(6, 2.2);
  const fly = []; // coins thrown into the case: { x0, y0, x1, y1, t, life }
  let strike = 0, strikeHand = 0, flash = 0, flashColor = '#ffffff';

  const TIER_COLORS = { 1: '#ffffff', 1.5: '#9be564', 2: '#4cc9f0', 3: '#ff5fa2', 4: '#ffd166' };
  const tierColor = (m) => TIER_COLORS[m] || '#ffffff';

  function showTap(r, before) {
    const { u, bx, btop } = L;
    strike = 1;
    strikeHand ^= 1;
    // labels pop up beside the bucket, on the side of the stick that hit
    const fx = bx + (strikeHand ? 1 : -1) * (0.85 + Math.random() * 0.15) * u, fy = btop - 0.05 * u;
    if (r.grade === 'miss') {
      floats.add(t('мимо'), fx, fy, { color: '#ff6b6b', size: Math.max(14, 0.26 * u) });
      flash = 0.7; flashColor = '#ff5d5d';
      return;
    }
    if (r.grade === 'extra') return;
    const perfect = r.grade === 'perfect';
    floats.add(`+${fmt(r.coins)}`, fx, fy,
      { color: perfect ? '#ffd166' : '#ffffff', size: Math.max(14, (perfect ? 0.3 : 0.24) * u) });
    parts.burst(bx, btop, perfect ? 12 : 5, {
      speed: 2.4 * u, life: 0.45, size: perfect ? 0.06 * u : 0.035 * u, shape: perfect ? 'star' : 'dot',
      colors: perfect ? ['#ffd166', '#fff3b0'] : ['#ffffff', '#bde0fe'], gravity: 5 * u, angle: -Math.PI / 2, spread: 2.4,
    });
    flash = perfect ? 1 : 0.55; flashColor = perfect ? '#ffd166' : '#ffffff';
    if (r.mult > before) {
      M.tier();
      floats.add(`×${nf1.format(r.mult)}!`, L.cx, L.comboY + 0.5 * u, { color: tierColor(r.mult), size: Math.max(22, 0.5 * u), life: 1.2, rise: 0.4 * u });
      parts.burst(L.cx, L.comboY + 0.4 * u, 26, { speed: 3 * u, life: 1, size: 0.07 * u, shape: 'confetti', colors: ['#ffd166', '#ff5fa2', '#4cc9f0', '#9be564'], gravity: 4 * u, spin: 8 });
      shake.add(0.35);
    }
  }

  // A listener tosses a coin into the case.
  function tossCoin() {
    if (!L || fly.length > 24) return;
    const shown = crowd.slice(0, crowdCount());
    const who = shown.length ? shown[(Math.random() * shown.length) | 0] : { x: L.cx + (Math.random() - 0.5) * L.w * 0.6, y: L.h };
    const k = L.kase;
    fly.push({ x0: who.x, y0: who.y - 0.4 * L.u, x1: k.x + (Math.random() - 0.5) * k.w * 0.6, y1: k.y + k.h * 0.45, t: 0, life: 0.55 + Math.random() * 0.2 });
  }

  // ───────────── The crowd ─────────────
  let crowd = [];
  function crowdLayout() {
    const rnd = seeded(42);
    const COLORS = ['#3a2f4d', '#2d3a4d', '#4d2f3a', '#2f4d40', '#4a3d2a', '#3d2a4a'];
    crowd = [];
    for (let i = 0; i < 30; i++) {
      const row = i % 3;
      crowd.push({
        x: L.w * (0.05 + 0.9 * rnd()), row,
        y: L.h - (0.12 + (2 - row) * 0.22) * L.u + rnd() * 0.08 * L.u,
        s: 0.85 + rnd() * 0.3 + row * 0.08, color: COLORS[(rnd() * COLORS.length) | 0], phase: rnd(), phone: rnd() < 0.45,
      });
    }
    // fill the middle first, then spread out
    crowd.sort((a, b) => Math.abs(a.x - L.cx) - Math.abs(b.x - L.cx));
  }
  // Listeners grow with the band's income: two passers-by at first, a packed underpass later.
  const crowdCount = () => Math.max(2, Math.min(crowd.length, Math.round(2 + 3.2 * Math.log10(1 + C.perSecond(S)))));

  // ───────────── Drawing ─────────────
  const PEOPLE = {
    player: { body: '#e85d75', skin: '#f1c27d', hat: '#2b2d42' },
    shaker: { body: '#58b368', skin: '#c68642', hair: '#2b1b0e' },
    bass: { body: '#5a7bd8', skin: '#e0ac69', hat: '#1f1f24' },
    guitar: { body: '#f4a259', skin: '#f1c27d', hair: '#6b3e26', long: true },
    keys: { body: '#9b5de5', skin: '#8d5524', hair: '#111111' },
    sax: { body: '#3d405b', skin: '#ffdbac', hat: '#1d1d1d', brim: true },
  };

  // A person standing at (x, y) (the feet), scale s. Returns the head centre and the shoulder line.
  function person(x, y, s, look, bob = 0, lean = 0) {
    const { u } = L;
    const k = u * s;
    Fx.shadow(g, x, y, 0.36 * k, 0.1 * k, 0.45);
    g.fillStyle = '#1d1a24';
    Fx.rrect(g, x - 0.17 * k, y - 0.42 * k, 0.13 * k, 0.42 * k, 0.05 * k); g.fill();
    Fx.rrect(g, x + 0.04 * k, y - 0.42 * k, 0.13 * k, 0.42 * k, 0.05 * k); g.fill();
    const hip = y - 0.36 * k + bob;
    g.save();
    g.translate(x, hip); g.rotate(lean); g.translate(-x, -hip);
    Fx.bean(g, x, hip, 0.26 * k, 0.72 * k, look.body, { shadow: false });
    const head = { x: x + lean * 0.5 * k, y: hip - 0.86 * k };
    if (look.long) { g.fillStyle = look.hair; Fx.rrect(g, head.x - 0.23 * k, head.y - 0.1 * k, 0.46 * k, 0.4 * k, 0.12 * k); g.fill(); }
    Fx.sphere(g, head.x, head.y, 0.2 * k, look.skin, { gloss: false });
    g.fillStyle = '#1a1420';
    g.beginPath(); g.arc(head.x - 0.07 * k, head.y + 0.01 * k, 0.022 * k, 0, Fx.TAU); g.arc(head.x + 0.07 * k, head.y + 0.01 * k, 0.022 * k, 0, Fx.TAU); g.fill();
    if (look.hat) {
      g.fillStyle = look.hat;
      g.beginPath(); g.ellipse(head.x, head.y - 0.1 * k, 0.21 * k, 0.15 * k, 0, Math.PI, 0); g.fill();
      if (look.brim) { g.beginPath(); g.ellipse(head.x, head.y - 0.1 * k, 0.3 * k, 0.05 * k, 0, 0, Fx.TAU); g.fill(); }
    } else if (look.hair) {
      g.fillStyle = look.hair;
      g.beginPath(); g.ellipse(head.x, head.y - 0.08 * k, 0.21 * k, 0.14 * k, 0, Math.PI, 0); g.fill();
    }
    g.restore();
    return { head, shoulder: hip - 0.58 * k, k };
  }

  function drawMusician(id, phase, beat) {
    const sl = L.slots[id];
    if (!sl || C.level(S, id) <= 0) return;
    const look = PEOPLE[id];
    const pulse = Math.pow(1 - phase, 3);
    const k = L.u * sl.s;
    switch (id) {
      case 'shaker': {
        const p = person(sl.x, sl.y, sl.s, look, pulse * 0.04 * k);
        const sh = Math.sin(phase * Math.PI * 4) * 0.07 * k;
        Fx.metalBar(g, sl.x + 0.18 * k, p.shoulder + 0.1 * k, sl.x + 0.36 * k + sh, p.shoulder - 0.28 * k, 0.07 * k, look.skin);
        Fx.cylinder(g, sl.x + 0.38 * k + sh, p.shoulder - 0.42 * k, 0.07 * k, 0.2 * k, '#e63946', { capColor: '#c0c0c0' });
        break;
      }
      case 'bass': {
        const p = person(sl.x, sl.y, sl.s, look, (beat % 2 === 0 ? pulse : pulse * 0.4) * 0.05 * k, -0.05);
        Fx.metalBar(g, sl.x + 0.05 * k, p.shoulder + 0.42 * k, sl.x - 0.62 * k, p.shoulder - 0.42 * k, 0.07 * k, '#7a4b2a');
        g.fillStyle = '#8b1e3f';
        g.beginPath(); g.ellipse(sl.x + 0.06 * k, p.shoulder + 0.46 * k, 0.24 * k, 0.17 * k, -0.6, 0, Fx.TAU); g.fill();
        g.fillStyle = 'rgba(255, 255, 255, .25)';
        g.beginPath(); g.ellipse(sl.x, p.shoulder + 0.4 * k, 0.08 * k, 0.04 * k, -0.6, 0, Fx.TAU); g.fill();
        break;
      }
      case 'guitar': {
        // the strumming hand hits on the offbeat
        const off = Math.pow(1 - Math.abs(phase - 0.5) * 2, 4);
        const p = person(sl.x, sl.y, sl.s, look, pulse * 0.04 * k, 0.04);
        Fx.metalBar(g, sl.x - 0.05 * k, p.shoulder + 0.4 * k, sl.x + 0.55 * k, p.shoulder - 0.3 * k, 0.06 * k, '#5c3a1e');
        g.fillStyle = '#d4a373';
        g.beginPath(); g.ellipse(sl.x - 0.06 * k, p.shoulder + 0.44 * k, 0.24 * k, 0.18 * k, 0.5, 0, Fx.TAU); g.fill();
        g.fillStyle = '#3b2414';
        g.beginPath(); g.arc(sl.x - 0.04 * k, p.shoulder + 0.42 * k, 0.06 * k, 0, Fx.TAU); g.fill();
        Fx.metalBar(g, sl.x - 0.28 * k, p.shoulder + 0.1 * k, sl.x - 0.08 * k, p.shoulder + (0.3 + off * 0.18) * k, 0.07 * k, look.skin);
        break;
      }
      case 'keys': {
        const p = person(sl.x, sl.y, sl.s, look, pulse * 0.03 * k);
        const ky = p.shoulder + 0.3 * k;
        g.strokeStyle = '#555'; g.lineWidth = 0.04 * k;
        g.beginPath(); g.moveTo(sl.x - 0.4 * k, sl.y); g.lineTo(sl.x + 0.4 * k, ky); g.moveTo(sl.x + 0.4 * k, sl.y); g.lineTo(sl.x - 0.4 * k, ky); g.stroke();
        Fx.block(g, sl.x - 0.6 * k, ky - 0.08 * k, 1.2 * k, 0.16 * k, 0.03 * k, '#26232e');
        g.fillStyle = '#f2f2f2'; g.fillRect(sl.x - 0.55 * k, ky - 0.02 * k, 1.1 * k, 0.06 * k);
        g.fillStyle = '#26232e';
        for (let i = 1; i < 14; i++) if (i % 7 !== 3 && i % 7 !== 0) g.fillRect(sl.x - 0.55 * k + i * 0.0786 * k - 0.012 * k, ky - 0.02 * k, 0.024 * k, 0.035 * k);
        Fx.glow(g, sl.x + 0.48 * k, ky - 0.02 * k, 0.08 * k, '#4cc9f0', 0.6 + 0.4 * pulse);
        break;
      }
      case 'sax': {
        const sway = Math.sin((beat + phase) * Math.PI / 2) * 0.06;
        const p = person(sl.x, sl.y, sl.s, look, 0, sway);
        const mx = p.head.x - 0.05 * k, my = p.head.y + 0.16 * k;
        Fx.metalBar(g, mx, my, sl.x + 0.05 * k, p.shoulder + 0.62 * k, 0.07 * k, '#d4a017');
        Fx.metalBar(g, sl.x + 0.05 * k, p.shoulder + 0.62 * k, sl.x + 0.22 * k, p.shoulder + 0.52 * k, 0.09 * k, '#d4a017');
        g.fillStyle = '#e9c46a';
        g.beginPath(); g.ellipse(sl.x + 0.27 * k, p.shoulder + 0.46 * k, 0.1 * k, 0.07 * k, -0.7, 0, Fx.TAU); g.fill();
        g.fillStyle = '#6b4e0a';
        g.beginPath(); g.ellipse(sl.x + 0.28 * k, p.shoulder + 0.45 * k, 0.06 * k, 0.035 * k, -0.7, 0, Fx.TAU); g.fill();
        break;
      }
      default:
    }
  }

  // The player behind the upturned bucket, two sticks; a strike drops one stick onto the bucket.
  function drawPlayer(phase) {
    const { u, cx, floor, bx, btop, brx, bh } = L;
    const p = person(cx, floor - 0.28 * u, 1, PEOPLE.player, Math.pow(1 - phase, 3) * 0.03 * u);
    const sq = strike * 0.05;
    // bucket
    Fx.shadow(g, bx, btop + bh, brx * 1.35, brx * 0.3, 0.55);
    g.save();
    g.translate(bx, btop + bh); g.scale(1 + sq * 0.5, 1 - sq); g.translate(-bx, -(btop + bh));
    Fx.cylinder(g, bx, btop, brx, bh, '#2f80ed', { capColor: '#3a8ef5' });
    g.fillStyle = '#1d5fb8';
    g.beginPath(); g.ellipse(bx, btop + bh, brx * 1.08, brx * 0.32, 0, 0, Math.PI); g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, .25)'; g.lineWidth = Math.max(1, 0.02 * u);
    g.beginPath(); g.ellipse(bx, btop + bh * 0.82, brx * 1.01, brx * 0.3, 0, 0.1, Math.PI - 0.1); g.stroke();
    if (flash > 0) {
      g.globalAlpha = flash * 0.8;
      g.fillStyle = flashColor;
      g.beginPath(); g.ellipse(bx, btop, brx, brx * 0.32, 0, 0, Fx.TAU); g.fill();
      g.globalAlpha = 1;
      Fx.glow(g, bx, btop, brx * 2.2, flashColor, flash * 0.7);
    }
    g.restore();
    // sticks: resting tips hover over the bucket, the striking one comes down
    for (let side = 0; side < 2; side++) {
      const dir = side ? 1 : -1;
      const hit = side === strikeHand ? strike : 0;
      const hx = cx + dir * 0.3 * u, hy = p.shoulder + 0.36 * u;
      const tx = bx + dir * Fx.lerp(0.42, 0.14, hit) * u;
      const ty = Fx.lerp(btop - 0.5 * u, btop - 0.02 * u, hit);
      Fx.metalBar(g, hx, hy, tx, ty, Math.max(2, 0.05 * u), '#e9c46a');
      Fx.sphere(g, hx, hy, 0.07 * u, PEOPLE.player.skin, { gloss: false });
    }
  }

  // The open guitar case: velvet and a pile of coins that grows with everything ever earned.
  function drawCase() {
    const k = L.kase;
    Fx.shadow(g, k.x, k.y + k.h, k.w * 0.6, k.h * 0.35, 0.5);
    Fx.block(g, k.x - k.w / 2, k.y, k.w, k.h, k.h * 0.45, '#3b2418');
    g.fillStyle = '#7a1f2b';
    Fx.rrect(g, k.x - k.w * 0.44, k.y + k.h * 0.18, k.w * 0.88, k.h * 0.64, k.h * 0.3); g.fill();
    const n = Math.min(26, Math.floor(Math.log2(1 + S.total)));
    const rnd = seeded(3);
    for (let i = 0; i < n; i++) {
      const cx = k.x + (rnd() - 0.5) * k.w * 0.74, cy = k.y + k.h * (0.32 + rnd() * 0.4);
      g.fillStyle = '#b8860b';
      g.beginPath(); g.ellipse(cx, cy + 1, 0.07 * L.u, 0.035 * L.u, 0, 0, Fx.TAU); g.fill();
      g.fillStyle = '#ffd166';
      g.beginPath(); g.ellipse(cx, cy, 0.07 * L.u, 0.035 * L.u, 0, 0, Fx.TAU); g.fill();
    }
  }

  function drawCrowd(phase, beat) {
    const n = crowdCount();
    const groove = Math.min(1, 0.2 + S.streak / 24);
    const mult = C.multiplier(S.streak, S.free);
    const shown = crowd.slice(0, n).sort((a, b) => a.row - b.row || a.y - b.y);
    for (const c of shown) {
      const k = L.u * 0.5 * c.s;
      const jump = Math.pow(1 - ((phase + c.phase * 0.15) % 1), 4) * groove * 0.25 * k;
      const sway = Math.sin((beat + phase + c.phase) * Math.PI) * 0.1 * k * groove;
      const x = c.x + sway, y = c.y - jump;
      g.fillStyle = c.color;
      Fx.rrect(g, x - 0.55 * k, y - 0.45 * k, 1.1 * k, 1.2 * k, 0.4 * k); g.fill();
      g.beginPath(); g.arc(x, y - 0.75 * k, 0.32 * k, 0, Fx.TAU); g.fill();
      // stage light on the top edge
      g.strokeStyle = 'rgba(255, 230, 190, .22)'; g.lineWidth = Math.max(1, 0.06 * k);
      g.beginPath(); g.arc(x, y - 0.75 * k, 0.3 * k, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      if (mult >= 3 && c.phone) {
        const px = x + 0.45 * k, py = y - 1.3 * k;
        g.strokeStyle = c.color; g.lineWidth = 0.18 * k;
        g.beginPath(); g.moveTo(x + 0.35 * k, y - 0.3 * k); g.lineTo(px, py); g.stroke();
        g.fillStyle = '#e8f6ff'; g.fillRect(px - 0.1 * k, py - 0.18 * k, 0.2 * k, 0.32 * k);
        Fx.glow(g, px, py, 0.5 * k, '#bde0fe', 0.5);
      }
    }
  }

  // The approach ring: it closes on the bucket's rim exactly on the beat.
  function drawRing(frac, beatNow) {
    const { bx, btop, brx, u } = L;
    g.save();
    g.strokeStyle = 'rgba(255, 255, 255, .18)';
    g.lineWidth = Math.max(1, 0.025 * u);
    g.beginPath(); g.ellipse(bx, btop, brx * 1.05, brx * 0.34, 0, 0, Fx.TAU); g.stroke();
    const r = brx * (1.05 + 1.5 * (1 - frac));
    const mult = C.multiplier(S.streak, S.free);
    g.strokeStyle = Fx.withAlpha(tierColor(mult), 0.2 + 0.75 * frac);
    g.lineWidth = Math.max(1.5, (0.03 + 0.04 * frac) * u);
    g.beginPath(); g.ellipse(bx, btop, r, r * 0.32, 0, 0, Fx.TAU); g.stroke();
    // a burst of light when the ring lands
    const land = Math.pow(Math.max(0, 1 - (beatNow - Math.floor(beatNow)) * 6), 2);
    if (land > 0) Fx.glow(g, bx, btop, brx * 1.6, tierColor(mult), land * 0.45);
    g.restore();
  }

  function drawCombo() {
    if (S.streak <= 0) return;
    const { u, cx, comboY } = L;
    const mult = C.multiplier(S.streak, S.free);
    const next = C.nextTier(S.streak, S.free);
    Fx.text(g, `×${nf1.format(mult)}`, cx, comboY, { size: Math.max(20, 0.42 * u), color: tierColor(mult) });
    Fx.text(g, t('серия {n}', { n: S.streak }), cx, comboY + 0.36 * u, { size: Math.max(11, 0.16 * u), color: '#f1ece4', outline: 2 });
    if (next) {
      const prev = C.COMBO.slice().reverse().filter(([n]) => n <= S.streak).pop();
      const from = prev ? prev[0] : 0;
      const p = (S.streak - from) / (next - from);
      const bw = 1.1 * u, by = comboY + 0.55 * u;
      g.fillStyle = 'rgba(0, 0, 0, .45)'; Fx.rrect(g, cx - bw / 2, by, bw, 0.07 * u, 0.035 * u); g.fill();
      g.fillStyle = tierColor(C.multiplier(next, S.free)); Fx.rrect(g, cx - bw / 2, by, Math.max(0.07 * u, bw * p), 0.07 * u, 0.035 * u); g.fill();
    }
  }

  function draw(now, dt) {
    if (!L) return;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    const off = shake.offset();
    g.translate(off.x, off.y);
    g.drawImage(bg, 0, 0, W, H);
    // the beat as the scene sees it
    let bp;
    if (mode === 'play' && S.run && now != null) bp = C.beatAt(S.run.grid, now);
    else bp = (performance.now() / 1000) * (C.BPM.min / 60) * 0.5; // a lazy idle sway before the start
    const beat = Math.floor(bp), phase = bp - beat;
    const pulse = Math.pow(1 - phase, 3);
    const mult = C.multiplier(S.streak, S.free);
    // the fluorescent tube pulses on the beat
    const { u, cx } = L;
    Fx.glow(g, cx, 0.2 * u, 2.2 * u, '#fff1d6', 0.35 + (mode === 'play' ? 0.4 * pulse : 0));
    Fx.block(g, cx - 0.9 * u, 0.12 * u, 1.8 * u, 0.12 * u, 0.06 * u, '#fffaf0');
    // a warm spotlight that grows with the multiplier
    const spot = g.createRadialGradient(cx, L.floor - 0.6 * u, 0, cx, L.floor - 0.6 * u, (1.6 + 0.5 * mult) * u);
    spot.addColorStop(0, `rgba(255, 214, 150, ${0.1 + 0.05 * mult})`); spot.addColorStop(1, 'rgba(255, 214, 150, 0)');
    g.fillStyle = spot; g.fillRect(0, 0, W, H);

    for (const id of ['keys', 'bass', 'shaker']) drawMusician(id, phase, beat);
    drawPlayer(mode === 'play' ? phase : 0.5);
    for (const id of ['guitar', 'sax']) drawMusician(id, phase, beat);
    drawCase();
    if (mode === 'play') drawRing(phase, bp);
    // coins in flight
    for (const f of fly) {
      const p = Math.min(1, f.t / f.life);
      const x = Fx.lerp(f.x0, f.x1, p), y = Fx.lerp(f.y0, f.y1, p) - Math.sin(p * Math.PI) * 0.9 * u;
      g.fillStyle = '#ffd166';
      g.beginPath(); g.ellipse(x, y, 0.06 * u, 0.06 * u * Math.abs(Math.cos(f.t * 14)) + 0.01 * u, 0, 0, Fx.TAU); g.fill();
    }
    drawCrowd(phase, beat);
    parts.draw(g);
    floats.draw(g);
    if (mode === 'play') drawCombo();
    Fx.vignette(g, W, H, 0.45);
    g.setTransform(1, 0, 0, 1, 0, 0);
    void dt;
  }

  // ───────────── HUD and panel ─────────────
  const hud = { coins: $('coins'), rate: $('rate') };
  let hudCoins = '', hudRate = '';
  function renderHud() {
    const c = fmt(S.coins);
    if (c !== hudCoins) { hud.coins.textContent = c; hudCoins = c; }
    const r = t('{rate}/с · {bpm} уд/мин', { rate: fmt(C.perSecond(S)), bpm: S.bpm });
    if (r !== hudRate) { hud.rate.textContent = r; hudRate = r; }
  }

  const rows = {};
  function musicianRow(m) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'buy';
    btn.dataset.id = m.id;
    btn.innerHTML = '<span class="buy-top"><b class="buy-name"></b><span class="buy-lv"></span></span>'
      + '<span class="buy-note"></span><span class="buy-meta"></span><span class="buy-cost"></span>';
    btn.addEventListener('click', () => {
      if (!C.buy(S, m.id)) return;
      M.coin();
      if (L) parts.burst(L.slots[m.id].x, L.slots[m.id].y - 0.9 * L.u, 16, { speed: 2 * L.u, life: 0.7, size: 0.05 * L.u, shape: 'star', colors: ['#ffd166', '#ffffff'], gravity: 3 * L.u });
      renderPanel();
      save();
    });
    $('band').append(btn);
    rows[m.id] = {
      btn, name: btn.querySelector('.buy-name'), lv: btn.querySelector('.buy-lv'), note: btn.querySelector('.buy-note'),
      meta: btn.querySelector('.buy-meta'), cost: btn.querySelector('.buy-cost'),
    };
    return rows[m.id];
  }
  const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };

  function renderPanel() {
    for (const m of C.MUSICIANS) {
      if (!C.revealed(S, m.id)) { if (rows[m.id]) rows[m.id].btn.hidden = true; continue; }
      const r = rows[m.id] || musicianRow(m);
      r.btn.hidden = false;
      const lv = C.level(S, m.id), cost = C.cost(S, m.id), ms = C.nextMilestone(lv);
      setText(r.name, m.name);
      setText(r.lv, lv > 0 ? t('ур. {n}', { n: lv }) : t('не в группе'));
      setText(r.note, m.note);
      const per = lv > 0 ? t('{n} за долю', { n: fmt(C.perBeat(S, m.id)) }) : t('+{n} за долю', { n: fmt(m.beat) });
      setText(r.meta, ms ? `${per} · ${t('×2 на {n}-м уровне', { n: ms })}` : per);
      setText(r.cost, fmt(cost));
      const poor = S.coins < cost;
      r.btn.classList.toggle('poor', poor);
      r.btn.setAttribute('aria-disabled', String(poor));
    }
    setText($('band-rate'), t('{n} за долю', { n: fmt(C.bandPerBeat(S)) }));
    // tempo
    setText($('bpm'), String(S.bpm));
    $('bpm-down').disabled = S.bpm <= C.BPM.min;
    $('bpm-up').disabled = S.bpm >= C.maxBpm(S);
    setText($('bpm-note'), t('потолок {n}', { n: C.maxBpm(S) }));
    const rush = $('rush');
    rush.hidden = !C.rushRevealed(S) || C.rushCost(S) === Infinity;
    if (!rush.hidden) {
      setText(rush.querySelector('.buy-cost'), fmt(C.rushCost(S)));
      setText(rush.querySelector('.buy-lv'), t('ур. {n}', { n: S.rush }));
      const poor = S.coins < C.rushCost(S);
      rush.classList.toggle('poor', poor);
      rush.setAttribute('aria-disabled', String(poor));
    }
    // settings
    setText($('btn-sound'), M.enabled ? t('Звук: вкл') : t('Звук: выкл'));
    $('btn-sound').setAttribute('aria-pressed', String(M.enabled));
    setText($('btn-free'), S.free ? t('Свободная игра: вкл') : t('Свободная игра: выкл'));
    $('btn-free').setAttribute('aria-pressed', String(S.free));
    setText($('offset'), t('задержка {ms} мс', { ms: Math.round(prefs.offset * 1000) }));
    const acc = S.stats.hits ? Math.round((100 * S.stats.perfect) / S.stats.hits) : 0;
    setText($('stats'), t('Лучшая серия: {best}. Точных ударов: {acc}%.', { best: S.best, acc }));
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  // ───────────── Input ─────────────
  function begin() {
    M.unlock();
    if (!S.run) C.start(S, M.now() + 0.5);
    M.play(BAND);
    mode = 'play';
    $('intro').hidden = true;
    $('hint').hidden = S.stats.hits >= 20;
    if (touch) $('hint').textContent = t('Бей, когда кольцо ляжет на край ведра');
  }
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  function onTap(stamp) {
    if (mode === 'intro') { begin(); return; }
    if (mode === 'calib') { calibTap(stamp); return; }
    if (!S.run) return;
    const before = C.multiplier(S.streak, S.free);
    const r = C.tap(S, M.heardAt(stamp) - prefs.offset);
    M.hit(r.grade === 'perfect' ? 'perfect' : r.grade === 'miss' ? 'miss' : 'good');
    showTap(r, before);
    if (S.stats.hits >= 20) $('hint').hidden = true;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    onTap(e.timeStamp);
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.code === 'KeyM') { if (!e.repeat) toggleSound(); return; }
    if (e.code === 'Space' || /^Key[A-Z]$/.test(e.code)) {
      e.preventDefault();
      if (!e.repeat) onTap(e.timeStamp);
    }
  });

  function toggleSound() { M.toggle(); renderPanel(); }

  $('intro').addEventListener('click', (e) => {
    if (e.target.closest('#btn-calib-intro')) return;
    begin();
  });
  $('btn-calib-intro').addEventListener('click', calibStart);
  $('btn-calib').addEventListener('click', calibStart);
  $('btn-sound').addEventListener('click', toggleSound);
  $('btn-free').addEventListener('click', () => {
    S.free = !S.free;
    S.streak = 0;
    renderPanel();
    save();
    toast(S.free ? t('Свободная игра: в долю попадать не нужно, множитель до ×1,5.') : t('Обычная игра: бей в долю, множитель до ×4.'));
  });
  $('bpm-down').addEventListener('click', () => { if (C.setTempo(S, S.bpm - C.BPM.step, M.horizon())) { renderPanel(); save(); } });
  $('bpm-up').addEventListener('click', () => { if (C.setTempo(S, S.bpm + C.BPM.step, M.horizon())) { renderPanel(); save(); } });
  $('rush').addEventListener('click', () => {
    if (!C.buyRush(S)) return;
    C.setTempo(S, C.maxBpm(S), M.horizon());
    M.coin();
    renderPanel();
    save();
  });
  $('btn-reset').addEventListener('click', () => {
    if (!window.confirm(t('Начать с нуля? Монеты и группа пропадут.'))) return;
    store.del(SAVE_KEY);
    S = C.newState();
    if (mode !== 'intro') { C.start(S, M.now() + 0.5); M.resync(); }
    for (const id of Object.keys(rows)) { rows[id].btn.remove(); delete rows[id]; }
    renderPanel();
    save();
  });

  // ───────────── Calibration ─────────────
  // Ten taps to the metronome alone; the median offset of the last eight becomes the delay. The ring is hidden:
  // the point is to tap to the sound.
  function calibStart() {
    M.unlock();
    if (!M.enabled) M.setEnabled(true);
    calib = { grid: C.newGrid(C.BPM.min, M.now() + 0.6), deltas: [] };
    M.play({ grid: () => calib.grid, levels: () => ({}), seed: 1, only: 'tick' });
    mode = 'calib';
    $('intro').hidden = true;
    $('calib').hidden = false;
    renderCalib();
  }
  function calibTap(stamp) {
    const j = C.judge(calib.grid, M.heardAt(stamp));
    calib.deltas.push(j.delta);
    renderCalib();
    if (calib.deltas.length >= CALIB_TAPS) {
      prefs.offset = C.calibrate(calib.deltas.slice(CALIB_SKIP));
      savePrefs();
      calibEnd(t('Готово: задержка {ms} мс.', { ms: Math.round(prefs.offset * 1000) }));
    }
  }
  function calibEnd(msg) {
    calib = null;
    $('calib').hidden = true;
    begin();
    renderPanel();
    if (msg) toast(msg);
  }
  function renderCalib() {
    const n = calib ? calib.deltas.length : 0;
    $('calib-dots').innerHTML = Array.from({ length: CALIB_TAPS }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
  }
  $('calib').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    onTap(e.timeStamp);
  });
  $('btn-calib-cancel').addEventListener('click', () => calibEnd(null));

  // ───────────── Loop, saving, visibility ─────────────
  let last = 0, saveIn = SAVE_EVERY, panelIn = 0;
  function frame(ms) {
    const dt = Math.min(0.1, Math.max(0, (ms - last) / 1000));
    last = ms;
    let now = null;
    if (mode === 'play' && S.run) {
      now = clock();
      const a = C.advance(S, now);
      if (a.paid > 0) for (let i = 0; i < Math.min(2, a.beats); i++) tossCoin();
    }
    strike = Math.max(0, strike - dt * 9);
    flash = Math.max(0, flash - dt * 4);
    parts.update(dt); floats.update(dt); shake.update(dt);
    for (const f of fly) f.t += dt;
    for (let i = fly.length - 1; i >= 0; i--) if (fly[i].t >= fly[i].life) fly.splice(i, 1);
    draw(now, dt);
    renderHud();
    panelIn -= dt;
    if (panelIn <= 0) { renderPanel(); panelIn = 0.25; }
    saveIn -= dt;
    if (saveIn <= 0) { save(); saveIn = SAVE_EVERY; }
    requestAnimationFrame(frame);
  }

  let hiddenAt = 0, clockAtHide = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      clockAtHide = M.now();
      save();
      M.suspend();
    } else if (hiddenAt) {
      M.resume();
      // The suspended audio clock stood still, so the beats it missed are paid here, without the groove.
      const gap = (Date.now() - hiddenAt) / 1000 - Math.max(0, M.now() - clockAtHide);
      hiddenAt = 0;
      if (gap > 2) {
        const got = C.offline(S, gap);
        if (got >= 1) toast(t('Пока тебя не было, группа заработала {n}.', { n: fmt(got) }));
      }
    }
  });
  window.addEventListener('pagehide', save);
  window.addEventListener('resize', resize);

  // ───────────── Start ─────────────
  $('lang-slot').append(GameNav.home('lang-toggle'), I18n.toggle('lang-toggle'));
  resize();
  if (away > 5) {
    const got = C.offline(S, away);
    if (got >= 1) toast(t('Пока тебя не было, группа заработала {n}.', { n: fmt(got) }));
  }
  renderPanel();
  renderHud();
  requestAnimationFrame(frame);

  // For the smoke test and the curious: the live state and the clocks.
  window.Beat = { get state() { return S; }, get mode() { return mode; }, get calib() { return calib; }, clock, prefs, onTap };
})();
