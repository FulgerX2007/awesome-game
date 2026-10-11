'use strict';
// Муравейник — drawing, input, panel and persistence. World: sim.js (AntSim). Economy: core.js (AntCore).
(() => {
  const A = window.AntSim, C = window.AntCore;
  const T = (k, v) => I18n.t(k, v);
  const P = (n, forms) => I18n.p(n, forms);
  const SAVE_KEY = 'ants.save', CLOUD_KEY = 'ants.cloud', PREFS_KEY = 'ants.prefs';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };

  // ───────────── Numbers ─────────────
  const compact = new Intl.NumberFormat(I18n.locale, { notation: 'compact', maximumFractionDigits: 1 });
  const plain = new Intl.NumberFormat(I18n.locale, { maximumFractionDigits: 0 });
  const fmt = (n) => (n < 10000 ? plain.format(Math.floor(n)) : compact.format(n));

  // ───────────── State ─────────────
  let S = C.newState();
  const prefs = Object.assign({ sound: true, trails: true, bulk: '1' }, (() => { try { return JSON.parse(store.get(PREFS_KEY)) || {}; } catch { return {}; } })());
  const savePrefs = () => store.set(PREFS_KEY, JSON.stringify(prefs));
  function load() {
    try { const raw = store.get(SAVE_KEY); if (raw) { S = C.migrate(JSON.parse(raw)); return S.savedAt; } } catch { S = C.newState(); }
    return 0;
  }
  function save() { S.savedAt = Date.now(); store.set(SAVE_KEY, JSON.stringify(S)); }

  // ───────────── Sound ─────────────
  let ac = null;
  function tone(freq, at, dur, type = 'sine', vol = 0.08) {
    if (!prefs.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.05);
    } catch { /* audio is optional */ }
  }
  const sfx = {
    crumb: () => tone(880 + Math.random() * 120, 0, 0.09, 'triangle', 0.05),
    buy: () => { tone(523, 0, 0.18, 'triangle', 0.07); tone(784, 0.07, 0.25, 'triangle', 0.06); },
    up: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.3, 'triangle', 0.06)),
    fly: () => [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.12, 0.6, 'sine', 0.07)),
  };

  // ───────────── World & canvas ─────────────
  const canvas = $('world'), ctx = canvas.getContext('2d');
  let DPR = 1, CW = 0, CH = 0, K = 1, W = null, ground = null, scent = null, scentData = null;
  // The short side of the screen is 320 world units, so ants look the same size everywhere.
  function setup() {
    const r = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    CW = Math.max(200, r.width); CH = Math.max(200, r.height);
    canvas.width = Math.round(CW * DPR); canvas.height = Math.round(CH * DPR);
    K = Math.min(CW, CH) / 320;
    const ww = CW / K, wh = CH / K;
    const old = W;
    W = A.create(ww, wh, (Math.random() * 1e9) >>> 0);
    // Keep crumbs the player placed if the screen only changed a little.
    if (old && Math.abs(old.w - ww) < 1 && Math.abs(old.h - wh) < 1) { W.home = old.home; W.food = old.food; W.piles = old.piles; }
    A.syncAnts(W, S.ants);
    for (let i = 0; i < 4; i++) A.addPile(W, 30, 60 + Math.random() * 40);
    paintGround();
    scent = document.createElement('canvas');
    scent.width = W.gw; scent.height = W.gh;
    scentData = scent.getContext('2d').createImageData(W.gw, W.gh);
  }
  const worldR = () => Math.max(W.w, W.h) / 2 - 15;

  // Ground is painted once: soil, moss, pebbles, fallen leaves, little flowers.
  function paintGround() {
    ground = document.createElement('canvas');
    ground.width = canvas.width; ground.height = canvas.height;
    const g = ground.getContext('2d');
    g.scale(DPR, DPR);
    const grad = g.createRadialGradient(CW / 2, CH / 2, 10, CW / 2, CH / 2, Math.max(CW, CH) * 0.7);
    grad.addColorStop(0, '#b59b6d'); grad.addColorStop(1, '#8f7a52');
    g.fillStyle = grad; g.fillRect(0, 0, CW, CH);
    const R = (a, b) => a + Math.random() * (b - a);
    const n = (CW * CH) / 900;
    for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${R(60, 90)}, ${R(45, 60)}, ${R(25, 35)}, ${R(0.05, 0.15)})`; g.beginPath(); g.arc(R(0, CW), R(0, CH), R(1, 4) * K, 0, 7); g.fill(); }
    // Moss patches away from the nest
    for (let i = 0; i < n / 30; i++) {
      const x = R(0, CW), y = R(0, CH);
      if (Math.hypot(x - CW / 2, y - CH / 2) < 70 * K) continue;
      for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(${R(80, 110)}, ${R(120, 150)}, ${R(55, 75)}, ${R(0.25, 0.5)})`; g.beginPath(); g.arc(x + R(-14, 14) * K, y + R(-10, 10) * K, R(3, 8) * K, 0, 7); g.fill(); }
    }
    // Grass blades
    g.lineCap = 'round';
    for (let i = 0; i < n / 3; i++) {
      const x = R(0, CW), y = R(0, CH);
      if (Math.hypot(x - CW / 2, y - CH / 2) < 50 * K) continue;
      g.strokeStyle = `rgba(${R(70, 100)}, ${R(110, 140)}, ${R(50, 70)}, .7)`; g.lineWidth = R(0.8, 1.6) * K;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + R(-3, 3) * K, y - R(3, 6) * K, x + R(-5, 5) * K, y - R(6, 12) * K); g.stroke();
    }
    // Pebbles
    for (let i = 0; i < n / 40; i++) {
      const x = R(0, CW), y = R(0, CH), r = R(3, 9) * K;
      g.fillStyle = 'rgba(40,30,15,.25)'; g.beginPath(); g.ellipse(x + r * 0.2, y + r * 0.3, r, r * 0.7, 0, 0, 7); g.fill();
      const c = R(150, 200); g.fillStyle = `rgb(${c}, ${c - 8}, ${c - 20})`; g.beginPath(); g.ellipse(x, y, r, r * 0.72, R(0, 3), 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.ellipse(x - r * 0.3, y - r * 0.25, r * 0.35, r * 0.2, 0, 0, 7); g.fill();
    }
    // Fallen leaves
    for (let i = 0; i < n / 90; i++) {
      const x = R(0, CW), y = R(0, CH), s = R(8, 15) * K, a = R(0, 6.3);
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = ['#c7883a', '#a9682c', '#d4a446', '#8c9a45'][Math.floor(R(0, 4))];
      g.beginPath(); g.moveTo(-s, 0); g.quadraticCurveTo(0, -s * 0.6, s, 0); g.quadraticCurveTo(0, s * 0.6, -s, 0); g.fill();
      g.strokeStyle = 'rgba(80,50,20,.4)'; g.lineWidth = 0.8 * K; g.beginPath(); g.moveTo(-s, 0); g.lineTo(s, 0); g.stroke();
      g.restore();
    }
    // Tiny flowers
    for (let i = 0; i < n / 60; i++) {
      const x = R(0, CW), y = R(0, CH), r = R(1.5, 2.6) * K;
      g.fillStyle = ['#fff8e8', '#f6d65e', '#e9a6c3', '#c6b6f2'][Math.floor(R(0, 4))];
      for (let k = 0; k < 5; k++) { const a = k * 1.256; g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.8, 0, 7); g.fill(); }
      g.fillStyle = '#e8a43a'; g.beginPath(); g.arc(x, y, r * 0.6, 0, 7); g.fill();
    }
    // The nest: a mound of soil with a dark entrance
    const nx = W.nest.x * K, ny = W.nest.y * K;
    const m = g.createRadialGradient(nx, ny, 2 * K, nx, ny, 34 * K);
    m.addColorStop(0, '#5d4428'); m.addColorStop(0.35, '#8a6a40'); m.addColorStop(0.7, 'rgba(160,125,80,.6)'); m.addColorStop(1, 'rgba(160,125,80,0)');
    g.fillStyle = m; g.beginPath(); g.arc(nx, ny, 34 * K, 0, 7); g.fill();
    for (let i = 0; i < 60; i++) { const a = R(0, 6.3), d = R(10, 26) * K; g.fillStyle = `rgba(${R(90, 130)}, ${R(65, 90)}, ${R(35, 55)}, .8)`; g.beginPath(); g.arc(nx + Math.cos(a) * d, ny + Math.sin(a) * d, R(0.8, 1.8) * K, 0, 7); g.fill(); }
    g.fillStyle = '#2a1c0f'; g.beginPath(); g.ellipse(nx, ny, 6 * K, 4.5 * K, 0, 0, 7); g.fill();
  }

  function drawPile(p) {
    const x = p.x * K, y = p.y * K, r = A.pileR(p) * K;
    ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
    ctx.fillStyle = 'rgba(40,25,10,.25)'; ctx.beginPath(); ctx.ellipse(r * 0.15, r * 0.25, r * 1.05, r * 0.8, 0, 0, 7); ctx.fill();
    const n = Math.max(1, Math.min(14, Math.ceil(p.amount / Math.max(1, p.max / 14))));
    if (p.kind === 'berry') {
      for (let i = 0; i < n; i++) { const a = i * 2.4, d = r * 0.55 * Math.sqrt(i / 14); ctx.fillStyle = i % 3 ? '#b8323f' : '#d24a55'; ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.32, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(Math.cos(a) * d - r * 0.1, Math.sin(a) * d - r * 0.1, r * 0.08, 0, 7); ctx.fill(); }
    } else if (p.kind === 'seed') {
      for (let i = 0; i < n; i++) { const a = i * 2.4, d = r * 0.6 * Math.sqrt(i / 14); ctx.fillStyle = i % 2 ? '#e2c27c' : '#c9a35c'; ctx.beginPath(); ctx.ellipse(Math.cos(a) * d, Math.sin(a) * d, r * 0.24, r * 0.14, a, 0, 7); ctx.fill(); }
    } else if (p.kind === 'sugar') {
      for (let i = 0; i < n; i++) { const a = i * 2.4, d = r * 0.6 * Math.sqrt(i / 14), s = r * 0.3; ctx.fillStyle = '#fbf7ee'; ctx.fillRect(Math.cos(a) * d - s / 2, Math.sin(a) * d - s / 2, s, s); ctx.strokeStyle = 'rgba(160,140,110,.5)'; ctx.lineWidth = 0.6; ctx.strokeRect(Math.cos(a) * d - s / 2, Math.sin(a) * d - s / 2, s, s); }
    } else if (p.kind === 'apple') {
      const f = 0.5 + 0.5 * p.amount / p.max;
      ctx.fillStyle = '#f3e0a8'; ctx.beginPath(); ctx.arc(0, 0, r * f, 0.3, Math.PI * 2 - 0.3); ctx.lineTo(0, 0); ctx.fill();
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = r * 0.14; ctx.beginPath(); ctx.arc(0, 0, r * f, 0.3, Math.PI * 2 - 0.3); ctx.stroke();
      ctx.fillStyle = '#5a3a1a'; ctx.beginPath(); ctx.ellipse(r * 0.3 * f, 0, r * 0.08, r * 0.14, 0, 0, 7); ctx.fill();
    } else if (p.kind === 'mushroom') {
      for (let i = 0; i < Math.min(7, n); i++) {
        const a = i * 2.4, d = r * 0.55 * Math.sqrt(i / 7), mx = Math.cos(a) * d, my = Math.sin(a) * d, cr = r * 0.32;
        ctx.fillStyle = '#efe4cf'; ctx.fillRect(mx - cr * 0.25, my, cr * 0.5, cr * 0.8);
        ctx.fillStyle = i % 2 ? '#c96a3a' : '#b5552e'; ctx.beginPath(); ctx.arc(mx, my, cr, Math.PI, 0); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(mx - cr * 0.3, my - cr * 0.45, cr * 0.15, 0, 7); ctx.arc(mx + cr * 0.35, my - cr * 0.3, cr * 0.12, 0, 7); ctx.fill();
      }
    } else {
      for (let i = 0; i < n; i++) { const a = i * 2.4, d = r * 0.5 * Math.sqrt(i / 14); ctx.fillStyle = i % 2 ? '#d7b47a' : '#bf9658'; ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.26, 0, 7); ctx.fill(); }
    }
    ctx.restore();
  }
  function drawAnt(a) {
    const x = a.x * K, y = a.y * K, s = K * 1.15;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a.a);
    // Legs swing as the ant walks
    ctx.strokeStyle = 'rgba(30,18,8,.85)'; ctx.lineWidth = 0.5 * s;
    const sw = Math.sin(a.legs) * 0.9 * s;
    ctx.beginPath();
    for (const [lx, side] of [[-0.6, 1], [0.4, -1], [1.3, 1]]) {
      ctx.moveTo(lx * s, 0); ctx.lineTo(lx * s + sw * side, 2.2 * s);
      ctx.moveTo(lx * s, 0); ctx.lineTo(lx * s - sw * side, -2.2 * s);
    }
    ctx.stroke();
    const sp = C.SPECIES[S.species];
    ctx.fillStyle = sp.color;
    ctx.beginPath(); ctx.ellipse(-1.7 * s, 0, 1.5 * s, 1.05 * s, 0, 0, 7); ctx.fill();
    ctx.fillStyle = sp.head;
    ctx.beginPath(); ctx.ellipse(0.2 * s, 0, 0.9 * s, 0.6 * s, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(1.6 * s, 0, 0.8 * s, 0, 7); ctx.fill();
    if (a.carry) { ctx.fillStyle = '#f1c27a'; ctx.beginPath(); ctx.arc(2.7 * s, 0, 0.75 * s, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  // Big finds, drawn on any context (the board, collection icons, the treasury in the nest).
  function drawFind(c, kind, x, y, r, rot = 0) {
    c.save(); c.translate(x, y); c.rotate(rot);
    const blob = (rx, ry, fill) => { c.fillStyle = fill; c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, 7); c.fill(); };
    const shine = (ox, oy, s) => { c.fillStyle = 'rgba(255,255,255,.45)'; c.beginPath(); c.ellipse(ox, oy, s, s * 0.6, -0.5, 0, 7); c.fill(); };
    switch (kind) {
      case 'raisin': blob(r * 0.8, r * 0.6, '#5a2a3a'); c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = r * 0.08; c.beginPath(); c.moveTo(-r * 0.5, -r * 0.1); c.quadraticCurveTo(0, r * 0.2, r * 0.5, -r * 0.1); c.stroke(); shine(-r * 0.3, -r * 0.25, r * 0.15); break;
      case 'corn': blob(r * 0.7, r * 0.85, '#f2c443'); c.fillStyle = '#e0a52a'; c.beginPath(); c.ellipse(0, r * 0.4, r * 0.45, r * 0.3, 0, 0, 7); c.fill(); shine(-r * 0.25, -r * 0.35, r * 0.18); break;
      case 'acorn':
        blob(r * 0.62, r * 0.85, '#b9783a');
        c.fillStyle = '#7a5230'; c.beginPath(); c.ellipse(0, -r * 0.45, r * 0.72, r * 0.42, 0, Math.PI, 0); c.fill(); c.fillRect(-r * 0.72, -r * 0.48, r * 1.44, r * 0.2);
        c.fillStyle = '#5a3a1e'; c.fillRect(-r * 0.06, -r * 1.05, r * 0.12, r * 0.3); shine(-r * 0.2, r * 0.05, r * 0.15); break;
      case 'cherry':
        c.strokeStyle = '#5d7a2a'; c.lineWidth = r * 0.1; c.beginPath(); c.moveTo(0, -r * 0.6); c.quadraticCurveTo(r * 0.2, -r * 1.1, r * 0.55, -r * 1.2); c.stroke();
        c.fillStyle = '#b3182a'; c.beginPath(); c.arc(0, 0, r * 0.75, 0, 7); c.fill(); shine(-r * 0.28, -r * 0.28, r * 0.2); break;
      case 'honeydrop': c.fillStyle = 'rgba(232, 160, 40, .92)'; c.beginPath(); c.moveTo(0, -r); c.quadraticCurveTo(r * 0.85, r * 0.1, 0, r * 0.8); c.quadraticCurveTo(-r * 0.85, r * 0.1, 0, -r); c.fill(); shine(-r * 0.2, r * 0.05, r * 0.2); break;
      case 'strawberry':
        c.fillStyle = '#e0303e'; c.beginPath(); c.moveTo(0, r * 0.95); c.quadraticCurveTo(r * 0.95, r * 0.2, r * 0.6, -r * 0.45); c.quadraticCurveTo(0, -r * 0.75, -r * 0.6, -r * 0.45); c.quadraticCurveTo(-r * 0.95, r * 0.2, 0, r * 0.95); c.fill();
        c.fillStyle = '#ffe9a8'; for (let i = 0; i < 9; i++) { const a = i * 2.2, d = r * 0.45 * ((i % 3) / 3 + 0.3); c.beginPath(); c.arc(Math.cos(a) * d, Math.sin(a) * d + r * 0.1, r * 0.05, 0, 7); c.fill(); }
        c.fillStyle = '#4e8a32'; for (let i = 0; i < 5; i++) { c.save(); c.translate(0, -r * 0.55); c.rotate(-1.2 + i * 0.6); c.beginPath(); c.ellipse(0, -r * 0.15, r * 0.1, r * 0.25, 0, 0, 7); c.fill(); c.restore(); } break;
      case 'cookie':
        blob(r * 0.9, r * 0.85, '#d39b55'); c.fillStyle = '#4a2a16';
        for (const [ox, oy] of [[-0.35, -0.2], [0.3, -0.35], [0.1, 0.3], [-0.3, 0.35], [0.45, 0.15]]) { c.beginPath(); c.arc(ox * r, oy * r, r * 0.12, 0, 7); c.fill(); } break;
      case 'mushroom':
        c.fillStyle = '#efe4cf'; c.fillRect(-r * 0.22, -r * 0.1, r * 0.44, r * 0.9);
        c.fillStyle = '#c4452e'; c.beginPath(); c.arc(0, 0, r * 0.85, Math.PI, 0); c.fill();
        c.fillStyle = '#fff'; for (const [ox, oy, s] of [[-0.4, -0.35, 0.14], [0.15, -0.6, 0.12], [0.45, -0.25, 0.1]]) { c.beginPath(); c.arc(ox * r, oy * r, s * r, 0, 7); c.fill(); } break;
      case 'cheese':
        c.fillStyle = '#f6cf4f'; c.beginPath(); c.moveTo(-r * 0.9, r * 0.55); c.lineTo(r * 0.9, r * 0.55); c.lineTo(r * 0.6, -r * 0.6); c.closePath(); c.fill();
        c.fillStyle = '#e0b234'; for (const [ox, oy, s] of [[0.2, 0.15, 0.14], [-0.3, 0.32, 0.1], [0.5, -0.1, 0.08]]) { c.beginPath(); c.arc(ox * r, oy * r, s * r, 0, 7); c.fill(); } break;
      case 'tangerine':
        c.fillStyle = '#f28a1c'; c.beginPath(); c.ellipse(0, 0, r * 0.95, r * 0.55, 0, Math.PI, 0); c.fill();
        c.fillStyle = '#ffc06a'; c.beginPath(); c.ellipse(0, 0, r * 0.95, r * 0.25, 0, 0, Math.PI); c.fill();
        c.strokeStyle = 'rgba(255,240,200,.7)'; c.lineWidth = r * 0.05; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(0, 0); c.lineTo(i * r * 0.3, -r * 0.45); c.stroke(); } break;
      case 'cake':
        c.fillStyle = '#f3dfb8'; c.fillRect(-r * 0.8, -r * 0.3, r * 1.6, r * 0.8);
        c.fillStyle = '#e6799a'; c.fillRect(-r * 0.8, -r * 0.45, r * 1.6, r * 0.22); c.fillStyle = '#c96a4a'; c.fillRect(-r * 0.8, r * 0.05, r * 1.6, r * 0.12);
        c.fillStyle = '#c0182a'; c.beginPath(); c.arc(0, -r * 0.6, r * 0.2, 0, 7); c.fill(); break;
      case 'golden': {
        const g2 = c.createRadialGradient(-r * 0.2, -r * 0.2, 1, 0, 0, r);
        g2.addColorStop(0, '#fff6c8'); g2.addColorStop(0.5, '#f2c440'); g2.addColorStop(1, '#b07a12');
        c.fillStyle = 'rgba(255, 220, 110, .25)'; c.beginPath(); c.arc(0, 0, r * 1.5, 0, 7); c.fill();
        c.fillStyle = g2; c.beginPath(); c.ellipse(0, 0, r * 0.6, r * 0.9, 0, 0, 7); c.fill(); break;
      }
      default: blob(r * 0.8, r * 0.8, '#c9a35c');
    }
    c.restore();
  }
  const findIcons = {};
  function findIcon(kind) {
    if (findIcons[kind]) return findIcons[kind];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    drawFind(c.getContext('2d'), kind, 32, 34, 22);
    findIcons[kind] = c.toDataURL();
    return findIcons[kind];
  }
  function drawBig(b) {
    const r = A.bigR(b) * K;
    ctx.fillStyle = 'rgba(40,25,10,.25)'; ctx.beginPath(); ctx.ellipse(b.x * K + r * 0.15, b.y * K + r * 0.35, r, r * 0.6, 0, 0, 7); ctx.fill();
    drawFind(ctx, b.kind, b.x * K, b.y * K, r, b.rot * 0.2);
    // How many ants hold it, out of how many it needs
    const label = `${Math.min(b.carriers, b.need)}/${b.need}`;
    ctx.font = `800 ${Math.max(11, 4.2 * K)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const w = ctx.measureText(label).width + 10, x = b.x * K, y = b.y * K - r - 4 * K;
    ctx.fillStyle = b.moving ? 'rgba(95, 138, 63, .92)' : 'rgba(58, 47, 34, .85)';
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - Math.max(15, 5.6 * K), w, Math.max(15, 5.6 * K), 6); ctx.fill();
    ctx.fillStyle = '#fbf3e2'; ctx.fillText(label, x, y - 1);
  }
  // Rain: slanted streaks and rings on the ground.
  const drops = [];
  function drawRain(t, strength) {
    if (strength <= 0) return;
    ctx.fillStyle = `rgba(40, 55, 80, ${0.18 * strength})`; ctx.fillRect(0, 0, CW, CH);
    const n = Math.round(90 * strength * (CW * CH) / 400000) + 10;
    ctx.strokeStyle = `rgba(210, 225, 255, ${0.45 * strength})`; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const sx = ((i * 97.3 + t * 0.35) % (CW + 60)) - 30, sy = ((i * 53.7 + t * 0.9 + i * i) % (CH + 40)) - 20;
      ctx.moveTo(sx, sy); ctx.lineTo(sx - 4, sy + 14);
    }
    ctx.stroke();
    if (Math.random() < 0.6 * strength) drops.push({ x: Math.random() * CW, y: Math.random() * CH, t0: t });
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i], k = (t - d.t0) / 600;
      if (k > 1) { drops.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(220, 235, 255, ${0.5 * (1 - k)})`; ctx.beginPath(); ctx.ellipse(d.x, d.y, 2 + k * 9, (2 + k * 9) * 0.5, 0, 0, 7); ctx.stroke();
    }
  }

  // ───────────── The nest underground ─────────────
  // Chambers are dug as the colony grows; positions are fractions of the soil area.
  const CHAMBERS = [
    { id: 'queen', name: 'Покои королевы', about: 'Здесь живёт королева и лежат яйца.', x: 0.5, y: 0.84, s: 0.15, open: () => true },
    { id: 'nursery', name: 'Детская', about: 'Личинки растут, пока их кормят рабочие.', x: 0.24, y: 0.56, s: 0.12, open: () => S.ants >= 10 },
    { id: 'pantry', name: 'Кладовая', about: 'Запасы еды на чёрный день.', x: 0.77, y: 0.5, s: 0.12, open: () => S.ants >= 25 },
    { id: 'aphids', name: 'Стойло тли', about: 'Здесь муравьи доят тлю.', x: 0.2, y: 0.28, s: 0.1, open: () => S.up.aphids > 0 },
    { id: 'fungus', name: 'Грибной сад', about: 'Муравьи растят грибы на пережёванных листьях.', x: 0.8, y: 0.8, s: 0.12, open: () => S.up.fungus > 0 },
    { id: 'treasury', name: 'Сокровищница', about: 'Все большие находки колонии.', x: 0.8, y: 0.23, s: 0.11, open: () => C.collected(S) > 0 },
    { id: 'wings', name: 'Зал крылатых', about: 'Здесь подрастают принцессы для брачного полёта.', x: 0.2, y: 0.82, s: 0.11, open: () => S.ants >= 100 },
  ];
  const dug = {};
  let walkers = [];
  function nestGeom() {
    const top = CH * 0.17, h = CH - top - 8;
    const R = Math.min(CW, h * 1.5);
    const at = (c) => ({ x: CW * c.x, y: top + h * c.y, rx: R * c.s, ry: R * c.s * 0.55 });
    return { top, h, at };
  }
  function tunnels(geo) {
    const spine = [[CW * 0.5, geo.top - 4], [CW * 0.47, geo.top + geo.h * 0.2], [CW * 0.53, geo.top + geo.h * 0.42], [CW * 0.49, geo.top + geo.h * 0.64], [CW * 0.5, geo.top + geo.h * 0.84]];
    const out = [spine];
    for (const c of CHAMBERS) {
      if (c.id === 'queen' || !c.open()) continue;
      const p = geo.at(c);
      // Branch from the spine point at the nearest height
      let best = spine[0];
      for (const s of spine) if (Math.abs(s[1] - p.y) < Math.abs(best[1] - p.y)) best = s;
      const mid = [(best[0] + p.x) / 2, (best[1] + p.y) / 2 + geo.h * 0.04];
      out.push([best, mid, [p.x + (best[0] < p.x ? -p.rx * 0.8 : p.rx * 0.8), p.y]]);
    }
    return out;
  }
  function pathPoint(path, k) {
    let total = 0;
    const seg = [];
    for (let i = 1; i < path.length; i++) { const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); seg.push(d); total += d; }
    let want = k * total;
    for (let i = 0; i < seg.length; i++) {
      if (want <= seg[i]) { const f = want / seg[i]; return [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f, Math.atan2(path[i + 1][1] - path[i][1], path[i + 1][0] - path[i][0])]; }
      want -= seg[i];
    }
    const L = path[path.length - 1];
    return [L[0], L[1], 0];
  }
  function drawNest(t, day) {
    const geo = nestGeom();
    // Sky and grass
    const sky = ctx.createLinearGradient(0, 0, 0, geo.top);
    sky.addColorStop(0, day > 0.35 ? '#a9d3ef' : '#1a2448'); sky.addColorStop(1, day > 0.35 ? '#dcefd8' : '#2c3a5c');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, CW, geo.top);
    if (day <= 0.35) for (let i = 0; i < 30; i++) { ctx.fillStyle = `rgba(255,255,230,${0.4 + 0.4 * Math.sin(t / 700 + i)})`; ctx.fillRect((i * 137.5) % CW, (i * 29.3) % (geo.top * 0.8), 1.5, 1.5); }
    // Soil with layers
    const soil = ctx.createLinearGradient(0, geo.top, 0, CH);
    soil.addColorStop(0, '#8a6a42'); soil.addColorStop(0.4, '#6f5233'); soil.addColorStop(1, '#4a3420');
    ctx.fillStyle = soil; ctx.fillRect(0, geo.top, CW, CH - geo.top);
    ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = 2;
    for (let k = 1; k < 6; k++) { const y = geo.top + geo.h * k / 6; ctx.beginPath(); ctx.moveTo(0, y); for (let x = 0; x <= CW; x += 40) ctx.lineTo(x, y + Math.sin(x / 90 + k) * 6); ctx.stroke(); }
    for (let i = 0; i < 40; i++) { const x = (i * 211.7) % CW, y = geo.top + 20 + ((i * 97.1) % (geo.h - 30)), r = 3 + (i % 5) * 2; ctx.fillStyle = 'rgba(160,140,110,.35)'; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, i, 0, 7); ctx.fill(); }
    // Roots from above
    ctx.strokeStyle = 'rgba(70,45,25,.55)'; ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const x = CW * (0.08 + i * 0.14) + 20 * Math.sin(i * 3);
      ctx.lineWidth = 3 - i % 2; ctx.beginPath(); ctx.moveTo(x, geo.top);
      ctx.bezierCurveTo(x + 20, geo.top + 40, x - 25, geo.top + 70, x + 10 * Math.sin(i), geo.top + 60 + (i % 3) * 30); ctx.stroke();
    }
    ctx.fillStyle = '#6f9a48'; ctx.fillRect(0, geo.top - 6, CW, 8);
    ctx.strokeStyle = '#5f8a3f'; ctx.lineWidth = 1.5;
    for (let x = 0; x < CW; x += 6) { ctx.beginPath(); ctx.moveTo(x, geo.top); ctx.lineTo(x + Math.sin(x) * 3, geo.top - 6 - (x * 7 % 9)); ctx.stroke(); }
    // Mound and entrance
    ctx.fillStyle = '#9a7a4c'; ctx.beginPath(); ctx.ellipse(CW * 0.5, geo.top, CW * 0.09, geo.top * 0.28, 0, Math.PI, 0); ctx.fill();
    // Tunnels
    const paths = tunnels(geo);
    for (const [w, col] of [[Math.max(10, CW * 0.018), '#3a2614'], [Math.max(6, CW * 0.011), '#5a3e24']]) {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'round';
      for (const p of paths) { ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); ctx.stroke(); }
    }
    // Chambers, dug open with a short animation
    const now = performance.now();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const c of CHAMBERS) {
      if (!c.open()) continue;
      if (dug[c.id] == null) dug[c.id] = now;
      const grow = Math.min(1, (now - dug[c.id]) / 2500);
      const p = geo.at(c), rx = p.rx * grow, ry = p.ry * grow;
      ctx.fillStyle = '#2e1e10'; ctx.beginPath(); ctx.ellipse(p.x, p.y, rx + 4, ry + 4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#4a321c'; ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, 7); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, 7); ctx.clip();
      chamberContent(c.id, p.x, p.y, rx, ry, t);
      ctx.restore();
      if (grow >= 1) {
        ctx.font = `700 ${Math.max(11, Math.min(14, CW / 60))}px ${getComputedStyle(document.body).fontFamily}`;
        const label = T(c.name), w = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(30,20,10,.55)'; ctx.beginPath(); ctx.roundRect(p.x - w / 2, p.y + ry + 6, w, 18, 6); ctx.fill();
        ctx.fillStyle = '#f4e6c8'; ctx.fillText(label, p.x, p.y + ry + 8);
      }
    }
    // Ants walking the tunnels
    const want = Math.min(48, Math.max(3, Math.floor(S.ants / 3)));
    while (walkers.length < want) walkers.push({ p: Math.floor(Math.random() * 99), k: Math.random(), dir: Math.random() < 0.5 ? 1 : -1, v: 0.05 + Math.random() * 0.05 });
    walkers.length = want;
    for (const w of walkers) {
      const path = paths[w.p % paths.length];
      w.k += w.dir * w.v * (1 / 60) * (S.rain > 0 ? 0.6 : 1);
      if (w.k > 1 || w.k < 0) { w.dir *= -1; w.k = Math.max(0, Math.min(1, w.k)); if (Math.random() < 0.5) w.p = Math.floor(Math.random() * 99); }
      const [x, y, a] = pathPoint(path, w.k);
      drawAnt({ x: x / K, y: y / K, a: w.dir > 0 ? a : a + Math.PI, legs: t / 60 + w.p, carry: w.dir < 0 && w.p % 3 === 0 });
    }
    if (day < 0.9) { ctx.fillStyle = `rgba(16, 22, 48, ${(1 - day) * 0.25})`; ctx.fillRect(0, 0, CW, geo.top); }
  }
  function chamberContent(id, x, y, rx, ry, t) {
    const ant = (ax, ay, a) => drawAnt({ x: ax / K, y: ay / K, a, legs: t / 200 + ax, carry: false });
    if (id === 'queen') {
      // The queen: a big ant with a long abdomen, eggs around her
      ctx.save(); ctx.translate(x - rx * 0.05, y + ry * 0.05); ctx.scale(3.4, 3.4);
      drawAnt({ x: 0, y: 0, a: Math.sin(t / 2000) * 0.1, legs: t / 900, carry: false });
      ctx.fillStyle = C.SPECIES[S.species].color; ctx.beginPath(); ctx.ellipse(-3.4 * K, 0, 2.6 * K, 1.6 * K, 0, 0, 7); ctx.fill();
      ctx.restore();
      const eggs = Math.min(14, 3 + S.up.queen * 2);
      for (let i = 0; i < eggs; i++) { ctx.fillStyle = '#f8f2e2'; ctx.beginPath(); ctx.ellipse(x + rx * 0.35 + (i % 4) * rx * 0.13, y + ry * 0.45 - Math.floor(i / 4) * ry * 0.22, rx * 0.05, rx * 0.035, 0.3, 0, 7); ctx.fill(); }
    } else if (id === 'nursery') {
      const n = Math.min(14, Math.ceil(S.ants / 8));
      for (let i = 0; i < n; i++) {
        const lx = x - rx * 0.6 + (i % 5) * rx * 0.3, ly = y + ry * 0.45 - Math.floor(i / 5) * ry * 0.35, s = rx * 0.07;
        ctx.fillStyle = '#f6edd7'; ctx.beginPath(); ctx.arc(lx, ly, s, 0.3, Math.PI * 1.7 + Math.sin(t / 500 + i) * 0.2); ctx.lineTo(lx, ly); ctx.fill();
      }
      ant(x + rx * 0.4, y - ry * 0.2, 2.6);
    } else if (id === 'pantry') {
      const amount = Math.min(1, Math.log10(S.food + 10) / 8);
      for (let i = 0; i < 6 + amount * 40; i++) { const a = i * 2.4, d = Math.sqrt(i / (6 + amount * 40)) * rx * 0.7; ctx.fillStyle = i % 2 ? '#e2c27c' : '#c9a35c'; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * d, y + ry * 0.55 - Math.abs(Math.sin(a)) * d * 0.5, rx * 0.07, rx * 0.045, a, 0, 7); ctx.fill(); }
    } else if (id === 'aphids') {
      for (let i = 0; i < Math.min(12, S.up.aphids * 2); i++) {
        const ax = x - rx * 0.6 + (i % 4) * rx * 0.38, ay = y + ry * 0.4 - Math.floor(i / 4) * ry * 0.4 + Math.sin(t / 700 + i) * 1.5;
        ctx.fillStyle = '#9ccf5a'; ctx.beginPath(); ctx.ellipse(ax, ay, rx * 0.11, rx * 0.08, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#7fae44'; ctx.beginPath(); ctx.arc(ax + rx * 0.1, ay - rx * 0.02, rx * 0.04, 0, 7); ctx.fill();
      }
      ant(x + rx * 0.5, y - ry * 0.3, 3.4);
    } else if (id === 'fungus') {
      for (let i = 0; i < Math.min(15, S.up.fungus * 3); i++) {
        const mx = x - rx * 0.7 + (i % 5) * rx * 0.35, my = y + ry * 0.55 - Math.floor(i / 5) * ry * 0.4, r = rx * 0.08;
        ctx.fillStyle = '#efe4cf'; ctx.fillRect(mx - r * 0.25, my - r * 0.2, r * 0.5, r);
        ctx.fillStyle = '#e8dcc2'; ctx.beginPath(); ctx.arc(mx, my - r * 0.2, r, Math.PI, 0); ctx.fill();
      }
    } else if (id === 'treasury') {
      const kinds = C.FIND_ORDER.filter((k) => S.found[k]);
      kinds.forEach((k, i) => drawFind(ctx, k, x - rx * 0.65 + (i % 4) * rx * 0.43, y + ry * 0.45 - Math.floor(i / 4) * ry * 0.55, rx * 0.15));
    } else if (id === 'wings') {
      const n = Math.min(6, Math.floor((S.ants - 100) / 10) + 1);
      for (let i = 0; i < n; i++) {
        const wx = x - rx * 0.55 + (i % 3) * rx * 0.55, wy = y + ry * 0.25 - Math.floor(i / 3) * ry * 0.5;
        ctx.fillStyle = 'rgba(220, 235, 255, .55)'; ctx.beginPath(); ctx.ellipse(wx - rx * 0.05, wy - rx * 0.08, rx * 0.16, rx * 0.06, -0.5, 0, 7); ctx.ellipse(wx + rx * 0.05, wy - rx * 0.08, rx * 0.16, rx * 0.06, 0.5, 0, 7); ctx.fill();
        drawAnt({ x: wx / K, y: wy / K, a: -Math.PI / 2 + Math.sin(t / 900 + i) * 0.2, legs: t / 400, carry: false });
      }
    }
  }

  // Scent fields as a soft glow: amber where food was found, faint blue toward home.
  function drawScent(night) {
    const d = scentData.data, n = W.gw * W.gh;
    // Brightness is relative: a big colony lays far more scent, but the picture should stay calm.
    let top = 0;
    for (let i = 0; i < n; i++) if (W.food[i] > top) top = W.food[i];
    const fNorm = Math.max(6, top * 0.6), hNorm = fNorm * 1.6;
    for (let i = 0; i < n; i++) {
      const f = Math.min(1, W.food[i] / fNorm), h = Math.min(1, W.home[i] / hNorm);
      const o = i * 4;
      d[o] = 255 * f + 120 * h * (1 - f); d[o + 1] = 200 * f + 170 * h * (1 - f); d[o + 2] = 90 * f + 255 * h * (1 - f);
      d[o + 3] = Math.min(255, (f * f * 170 + h * 35) * (night ? 1.4 : 1));
    }
    scent.getContext('2d').putImageData(scentData, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.filter = `blur(${Math.round(A.CS * K * 0.6)}px)`;
    ctx.globalCompositeOperation = night ? 'lighter' : 'source-over';
    ctx.drawImage(scent, 0, 0, W.gw * A.CS * K, W.gh * A.CS * K);
    ctx.restore();
  }
  let stroke = null, strokes = [];
  let view = 'surface', rainLevel = 0;
  function draw(t) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // A slow day: about six minutes from noon to night and back.
    const day = 0.5 + 0.5 * Math.cos((t / 1000) * (Math.PI * 2 / 360));
    const night = day < 0.35;
    rainLevel += ((S.rain > 0 ? 1 : 0) - rainLevel) * 0.02;
    if (view === 'nest') { drawNest(t, day); drawRain(t, rainLevel * 0.5); return; }
    ctx.drawImage(ground, 0, 0, CW, CH);
    if (prefs.trails) drawScent(night);
    for (const p of W.piles) drawPile(p);
    for (const b of W.bigs) drawBig(b);
    for (const a of W.ants) drawAnt(a);
    // Fresh finger trails fade out
    const now = performance.now();
    strokes = strokes.filter((s) => now - s.t < 1200);
    for (const s of strokes) {
      ctx.strokeStyle = `rgba(255, 220, 140, ${0.6 * (1 - (now - s.t) / 1200)})`; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(s.x1 * K, s.y1 * K); ctx.lineTo(s.x2 * K, s.y2 * K); ctx.stroke();
    }
    const dark = (1 - day) * 0.42;
    if (dark > 0.01) { ctx.fillStyle = `rgba(16, 22, 48, ${dark})`; ctx.fillRect(0, 0, CW, CH); }
    drawRain(t, rainLevel);
    if (night) {
      // Fireflies
      for (let i = 0; i < 12; i++) {
        const fx = (Math.sin(t / 3000 + i * 7.1) * 0.5 + 0.5) * CW, fy = (Math.cos(t / 3700 + i * 3.3) * 0.5 + 0.5) * CH;
        const glow = 0.5 + 0.5 * Math.sin(t / 400 + i);
        ctx.fillStyle = `rgba(230, 255, 140, ${0.5 * glow * (0.35 - day) / 0.35})`; ctx.beginPath(); ctx.arc(fx, fy, 2.2 * K, 0, 7); ctx.fill();
      }
    }
  }

  // ───────────── Input: tap = crumb, drag = trail ─────────────
  const toWorld = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / K, y: (e.clientY - r.top) / K }; };
  let lastCrumb = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (view === 'nest') { nestTap(e); return; }
    canvas.setPointerCapture(e.pointerId);
    const p = toWorld(e);
    stroke = { x: p.x, y: p.y, sx: p.x, sy: p.y, moved: 0 };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    const p = toWorld(e);
    const d = Math.hypot(p.x - stroke.x, p.y - stroke.y);
    if (d < 2) return;
    stroke.moved += d;
    if (stroke.moved > 6) {
      A.paint(W, stroke.x, stroke.y, p.x, p.y);
      strokes.push({ x1: stroke.x, y1: stroke.y, x2: p.x, y2: p.y, t: performance.now() });
      hideHint();
    }
    stroke.x = p.x; stroke.y = p.y;
  });
  canvas.addEventListener('pointerup', () => {
    if (!stroke) return;
    if (stroke.moved <= 6) placeCrumb(stroke.sx, stroke.sy);
    stroke = null;
  });
  canvas.addEventListener('pointercancel', () => { stroke = null; });
  function nestTap(e) {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const geo = nestGeom();
    for (const c of CHAMBERS) {
      if (!c.open()) continue;
      const p = geo.at(c);
      if (((x - p.x) / (p.rx + 8)) ** 2 + ((y - p.y) / (p.ry + 8)) ** 2 <= 1) { toast(`${T(c.name)}. ${T(c.about)}`, 4); return; }
    }
  }
  function setView(v) {
    view = v;
    for (const b of document.querySelectorAll('.views button')) b.classList.toggle('on', b.dataset.view === v);
    $('hint').classList.toggle('hidden-view', v !== 'surface');
    canvas.style.cursor = v === 'nest' ? 'pointer' : 'crosshair';
  }
  document.querySelector('.views').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) setView(b.dataset.view);
  });
  function placeCrumb(x, y) {
    const now = performance.now();
    if (now - lastCrumb < 250) return;
    if (W.piles.filter((p) => p.crumb).length >= 8) { toast(T('Муравьи ещё не унесли прошлые крошки.')); return; }
    if (Math.hypot(x - W.nest.x, y - W.nest.y) < A.NEST_R + 6) return;
    lastCrumb = now;
    A.addPile(W, C.crumbSize(S), 0, x, y, true);
    S.crumbs++;
    sfx.crumb();
    hideHint();
  }
  function hideHint() { if (S.crumbs > 2 || S.total > 60) $('hint').classList.add('gone'); }

  // ───────────── Panel ─────────────
  let toastT = 0;
  function toast(text, secs = 3) {
    const el = $('toast');
    el.textContent = text; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), secs * 1000);
  }
  // How many ants the current bulk setting buys, and for how much.
  function bulkPlan() {
    const want = prefs.bulk === 'max' ? Infinity : Number(prefs.bulk);
    let n = 0, cost = 0;
    const probe = { bought: S.bought };
    while (n < want) {
      const c = C.antCost(probe);
      if (prefs.bulk === 'max' ? cost + c > S.food : false) break;
      cost += c; probe.bought++; n++;
      if (n > 2000) break;
    }
    if (prefs.bulk === 'max' && n === 0) return { n: 1, cost: C.antCost(S) };
    return { n, cost };
  }
  const known = new Set();
  let upsKey = '';
  function renderUps() {
    const list = C.ORDER.filter((k) => C.visible(S, k));
    const key = list.map((k) => `${k}${S.up[k]}`).join('|');
    const box = $('ups');
    if (key !== upsKey) {
      upsKey = key;
      box.innerHTML = list.map((k) => {
        const u = C.UPGRADES[k], done = C.maxed(S, k);
        const isNew = !known.has(k) && known.size > 0;
        return `<div class="up${done ? ' done' : ''}${isNew ? ' new' : ''}" data-k="${k}">
          <div class="up-name">${esc(T(u.name))}<span class="up-lvl">${S.up[k]}/${u.max}</span></div>
          <div class="up-about">${esc(T(u.about))}</div>
          <button type="button" class="buy" data-k="${k}">${done ? '✓' : fmt(C.upCost(S, k))}</button></div>`;
      }).join('');
      for (const k of list) {
        if (!known.has(k) && known.size > 0) toast(T('Новое: {name}', { name: T(C.UPGRADES[k].name) }));
        known.add(k);
      }
      if (!known.size) list.forEach((k) => known.add(k));
    }
    for (const b of box.querySelectorAll('button[data-k]')) {
      const k = b.dataset.k;
      b.disabled = C.maxed(S, k) || S.food < C.upCost(S, k);
      if (C.maxed(S, k)) b.setAttribute('aria-label', T('Улучшено полностью'));
    }
  }
  let choosing = false;
  function renderFlight() {
    const box = $('flight');
    const show = S.ants >= C.FLIGHT_AT * 0.66 || S.flights > 0;
    box.hidden = !show;
    if (!show) return;
    const pct = Math.min(100, (S.ants / C.FLIGHT_AT) * 100);
    const ready = C.canFly(S);
    if (!ready) choosing = false;
    let html = `<h2>${esc(T('Брачный полёт'))}</h2>
      <p>${esc(T('Когда в колонии {n} муравьёв, молодая королева может улететь и основать новый муравейник. Всё начнётся заново, но вся еда навсегда будет ценнее на 50%.', { n: C.FLIGHT_AT }))}</p>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <p>${esc(S.flights ? T('Полётов: {n}. Еда ценнее в {m} раза.', { n: S.flights, m: (1 + 0.5 * S.flights).toLocaleString(I18n.locale) }) : T('{n} из {m} муравьёв', { n: S.ants, m: C.FLIGHT_AT }))}</p>`;
    if (choosing) {
      html += `<p>${esc(T('Каким будет новый муравейник?'))}</p><div class="species">${C.SPECIES_ORDER.map((k) => `<button type="button" class="sp" data-sp="${k}"><i style="background:${C.SPECIES[k].head}"></i><b>${esc(T(C.SPECIES[k].name))}</b><span>${esc(T(C.SPECIES[k].about))}</span></button>`).join('')}</div>
        <button type="button" class="link light" id="btn-fly-cancel">${esc(T('Подождать'))}</button>`;
    } else {
      html += `<button type="button" class="buy" id="btn-fly" ${ready ? '' : 'disabled'}>${esc(T('Отпустить королеву'))}</button>`;
    }
    if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
  }
  let findsKey = '';
  function renderFinds() {
    const n = C.collected(S);
    const box = $('finds');
    box.hidden = n === 0 && !Object.keys(S.found).length && S.ants < 12;
    const key = C.FIND_ORDER.map((k) => S.found[k] || 0).join(',');
    if (key === findsKey) return;
    findsKey = key;
    $('finds-sub').textContent = T('Собрано {n} из {m}. Каждая новая находка — +3% к еде навсегда.', { n, m: C.FIND_ORDER.length });
    $('finds-grid').innerHTML = C.FIND_ORDER.map((k) => (S.found[k]
      ? `<div class="find" title="${esc(T(C.FINDS[k].name))}"><img alt="${esc(T(C.FINDS[k].name))}" src="${findIcon(k)}"><small>×${S.found[k]}</small></div>`
      : `<div class="find no" title="${esc(T('Ещё не найдено'))}">?</div>`)).join('');
  }
  function render() {
    $('food').textContent = fmt(S.food);
    $('rate').textContent = T('{n} в минуту', { n: fmt(S.rate * 60) });
    $('ant-count').textContent = `${fmt(S.ants)} ${P(S.ants, 'муравей|муравья|муравьёв')}`;
    const plan = bulkPlan();
    const b = $('btn-ant');
    b.textContent = plan.n > 1 ? T('+{n} за {c}', { n: plan.n, c: fmt(plan.cost) }) : T('+1 за {c}', { c: fmt(plan.cost) });
    b.disabled = S.food < plan.cost;
    const each = C.scale(S) > 1 ? ` ${T('Каждый на земле — за {n}.', { n: C.scale(S).toLocaleString(I18n.locale, { maximumFractionDigits: 1 }) })}` : '';
    $('breed-sub').textContent = T('В колонии {n} {ants}.', { n: fmt(S.ants), ants: P(S.ants, 'муравей|муравья|муравьёв') }) + each;
    renderUps();
    renderFlight();
    renderFinds();
    const parts = [T('Всего собрано: {n}', { n: fmt(S.total) })];
    if (C.aphidRate(S)) parts.push(T('Тля даёт {n} в минуту', { n: fmt(C.aphidRate(S) * 60) }));
    if (S.up.queen) parts.push(T('Королева: муравей каждые {n} с', { n: Math.round(C.eggEvery(S)) }));
    if (S.flights) parts.push(T('Множитель еды: ×{n}', { n: C.mult(S).toLocaleString(I18n.locale, { maximumFractionDigits: 2 }) }));
    parts.push(T('Вид: {name}', { name: T(C.SPECIES[S.species].name) }));
    $('stats').textContent = parts.join(' · ');
  }

  $('btn-ant').addEventListener('click', () => {
    const plan = bulkPlan();
    let bought = 0;
    for (let i = 0; i < plan.n; i++) if (C.buyAnt(S)) bought++; else break;
    if (bought) { sfx.buy(); A.syncAnts(W, S.ants); save(); render(); }
  });
  document.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]');
    if (!b) return;
    prefs.bulk = b.dataset.n; savePrefs();
    for (const x of document.querySelectorAll('.seg button')) x.classList.toggle('on', x === b);
    render();
  });
  for (const x of document.querySelectorAll('.seg button')) x.classList.toggle('on', x.dataset.n === prefs.bulk);
  $('ups').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b || !C.buy(S, b.dataset.k)) return;
    sfx.up(); save(); upsKey = ''; render();
  });
  $('flight').addEventListener('click', (e) => {
    if (e.target.closest('#btn-fly') && C.canFly(S)) { choosing = true; render(); return; }
    if (e.target.closest('#btn-fly-cancel')) { choosing = false; render(); return; }
    const b = e.target.closest('button[data-sp]');
    if (!b || !C.canFly(S)) return;
    choosing = false;
    C.fly(S, b.dataset.sp);
    sfx.fly();
    W.ants.length = 0; W.bigs.length = 0; W.home.fill(0); W.food.fill(0);
    A.syncAnts(W, S.ants);
    save(); upsKey = ''; render();
    toast(T('Королева улетела. Новый муравейник: {name}.', { name: T(C.SPECIES[S.species].name) }), 5);
  });
  $('btn-trails').addEventListener('click', () => {
    prefs.trails = !prefs.trails; savePrefs();
    $('btn-trails').setAttribute('aria-pressed', String(prefs.trails));
  });
  $('btn-trails').setAttribute('aria-pressed', String(prefs.trails));
  $('btn-sound').addEventListener('click', () => {
    prefs.sound = !prefs.sound; savePrefs();
    $('btn-sound').classList.toggle('off', !prefs.sound);
  });
  $('btn-sound').classList.toggle('off', !prefs.sound);
  let resetArmed = 0;
  $('btn-reset').addEventListener('click', () => {
    const b = $('btn-reset');
    if (!resetArmed) {
      b.textContent = T('Точно? Нажми ещё раз — всё пропадёт');
      resetArmed = setTimeout(() => { resetArmed = 0; b.textContent = T('Начать с нуля'); }, 4000);
      return;
    }
    clearTimeout(resetArmed); resetArmed = 0; b.textContent = T('Начать с нуля');
    S = C.newState();
    W.ants.length = 0; W.home.fill(0); W.food.fill(0);
    A.syncAnts(W, S.ants);
    upsKey = ''; known.clear();
    save(); render();
  });

  // ───────────── Cloud saves (only when served by the Go backend) ─────────────
  async function initCloud() {
    try {
      const res = await fetch('/healthz');
      if (!res.ok || (await res.text()).trim() !== 'ok') return;
    } catch { return; }
    $('cloud').hidden = false;
    const pretty = (c) => c.match(/.{1,4}/g).join('-');
    let code = store.get(CLOUD_KEY);
    if (code) $('cloud-code').textContent = pretty(code);
    const put = async () => {
      save();
      const res = await fetch(`/api/saves/${code}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S) });
      if (!res.ok) throw new Error(await res.text());
    };
    $('btn-cloud-save').addEventListener('click', async () => {
      if (!code) {
        const abc = 'abcdefghjkmnpqrstuvwxyz23456789', bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        code = Array.from(bytes, (x) => abc[x % abc.length]).join('');
      }
      try {
        await put();
        store.set(CLOUD_KEY, code);
        $('cloud-code').textContent = pretty(code);
        $('cloud-msg').textContent = T('Сохранено. Введи этот код на другом устройстве.');
      } catch (err) { $('cloud-msg').textContent = T('Не удалось сохранить: {e}', { e: err.message }); }
    });
    $('cloud-load').addEventListener('submit', async (e) => {
      e.preventDefault();
      const c = $('cloud-input').value.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (c.length !== 16) { $('cloud-msg').textContent = T('Код состоит из 16 букв и цифр.'); return; }
      try {
        const res = await fetch(`/api/saves/${c}`);
        if (res.status === 404) { $('cloud-msg').textContent = T('Сохранения с таким кодом нет.'); return; }
        if (!res.ok) throw new Error(await res.text());
        S = C.migrate(await res.json());
        code = c; store.set(CLOUD_KEY, c); $('cloud-code').textContent = pretty(c);
        W.ants.length = 0; A.syncAnts(W, S.ants);
        upsKey = ''; save(); render();
        $('cloud-msg').textContent = T('Загружено.');
      } catch (err) { $('cloud-msg').textContent = T('Не удалось загрузить: {e}', { e: err.message }); }
    });
    setInterval(() => { if (code) put().catch(() => {}); }, 60000);
  }

  // ───────────── Boot & loop ─────────────
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = T(meta.content);
  document.addEventListener('DOMContentLoaded', () => $('lang-slot').appendChild(I18n.toggle('lang-toggle')));
  const savedAt = load();
  setup();
  if (savedAt) {
    const away = (Date.now() - savedAt) / 1000;
    const got = C.offline(S, away);
    if (got >= 1) toast(T('Пока тебя не было, муравьи собрали {n} еды.', { n: fmt(got) }), 5);
    A.syncAnts(W, S.ants);
  }
  if (S.total > 60) $('hint').classList.add('gone');
  render();
  initCloud();
  let rT = 0;
  window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(setup, 200); });
  window.addEventListener('pagehide', save);
  setInterval(save, 5000);

  let last = performance.now(), secT = 0, secGot = 0, uiT = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const steps = dt > 0.05 ? 2 : 1;
    for (let i = 0; i < steps; i++) A.step(W, dt / steps, C.simParams(S, worldR()));
    secGot += C.deliver(S, A.take(W));
    const found = C.bigDue(S, dt, W.bigs.length > 0);
    if (found) {
      A.addBig(W, found, C.bigNeed(S, found), worldR() * (0.45 + Math.random() * 0.4));
      toast(T('Разведчики нашли: {name}. Чтобы утащить, нужно {n} {ants}.', { name: T(C.FINDS[found].name), n: C.bigNeed(S, found), ants: P(C.bigNeed(S, found), 'муравей|муравья|муравьёв') }), 5);
      sfx.crumb();
    }
    for (const k of A.arrivals(W)) {
      const r = C.bigReward(S, k);
      secGot += r.got;
      toast(r.first ? T('Новая находка в коллекции: {name}! +{n} еды и +3% навсегда.', { name: T(C.FINDS[k].name), n: fmt(r.got) }) : T('{name} в гнезде: +{n} еды.', { name: T(C.FINDS[k].name), n: fmt(r.got) }), 5);
      sfx.up();
      findsKey = '';
    }
    const wx = C.weather(S, dt);
    if (wx === 'start') toast(T('Пошёл дождь. Муравьи замедлились, тропы размывает.'), 4);
    if (wx === 'end') {
      for (let i = 0; i < 3; i++) A.addPile(W, C.simParams(S, worldR()).pileAmount * 1.5, worldR() * (0.3 + Math.random() * 0.5), null, null, false, 'mushroom');
      toast(T('Дождь кончился, и выросли грибы.'), 4);
    }
    const before = S.ants;
    C.tick(S, dt);
    if (S.ants !== before) A.syncAnts(W, S.ants);
    if ((secT += dt) >= 1) { C.trackRate(S, secGot / secT); secT = 0; secGot = 0; }
    draw(reduceMotion ? 0 : now);
    if ((uiT += dt) > 0.25) { uiT = 0; render(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
