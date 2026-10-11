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
    ctx.fillStyle = '#2b1a0c';
    ctx.beginPath(); ctx.ellipse(-1.7 * s, 0, 1.5 * s, 1.05 * s, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0.2 * s, 0, 0.9 * s, 0.6 * s, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(1.6 * s, 0, 0.8 * s, 0, 7); ctx.fill();
    if (a.carry) { ctx.fillStyle = '#f1c27a'; ctx.beginPath(); ctx.arc(2.7 * s, 0, 0.75 * s, 0, 7); ctx.fill(); }
    ctx.restore();
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
  function draw(t) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(ground, 0, 0, CW, CH);
    // A slow day: about six minutes from noon to night and back.
    const day = 0.5 + 0.5 * Math.cos((t / 1000) * (Math.PI * 2 / 360));
    const night = day < 0.35;
    if (prefs.trails) drawScent(night);
    for (const p of W.piles) drawPile(p);
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
  function renderFlight() {
    const box = $('flight');
    const show = S.ants >= C.FLIGHT_AT * 0.66 || S.flights > 0;
    box.hidden = !show;
    if (!show) return;
    const pct = Math.min(100, (S.ants / C.FLIGHT_AT) * 100);
    const ready = C.canFly(S);
    const html = `<h2>${esc(T('Брачный полёт'))}</h2>
      <p>${esc(T('Когда в колонии {n} муравьёв, молодая королева может улететь и основать новый муравейник. Всё начнётся заново, но вся еда навсегда будет ценнее на 50%.', { n: C.FLIGHT_AT }))}</p>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <p>${esc(S.flights ? T('Полётов: {n}. Еда ценнее в {m} раза.', { n: S.flights, m: (1 + 0.5 * S.flights).toLocaleString(I18n.locale) }) : T('{n} из {m} муравьёв', { n: S.ants, m: C.FLIGHT_AT }))}</p>
      <button type="button" class="buy" id="btn-fly" ${ready ? '' : 'disabled'}>${esc(flyArmed ? T('Точно? Нажми ещё раз') : T('Отпустить королеву'))}</button>`;
    if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
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
    const parts = [T('Всего собрано: {n}', { n: fmt(S.total) })];
    if (C.aphidRate(S)) parts.push(T('Тля даёт {n} в минуту', { n: fmt(C.aphidRate(S) * 60) }));
    if (S.up.queen) parts.push(T('Королева: муравей каждые {n} с', { n: Math.round(C.eggEvery(S)) }));
    if (S.flights) parts.push(T('Множитель еды: ×{n}', { n: C.mult(S).toLocaleString(I18n.locale) }));
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
  let flyArmed = 0;
  $('flight').addEventListener('click', (e) => {
    if (!e.target.closest('#btn-fly') || !C.canFly(S)) return;
    if (!flyArmed) { flyArmed = setTimeout(() => { flyArmed = 0; render(); }, 4000); render(); return; }
    clearTimeout(flyArmed); flyArmed = 0;
    C.fly(S);
    sfx.fly();
    W.ants.length = 0; W.home.fill(0); W.food.fill(0);
    A.syncAnts(W, S.ants);
    save(); upsKey = ''; render();
    toast(T('Королева улетела. Новый муравейник — и еда отныне ценнее.'), 5);
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
