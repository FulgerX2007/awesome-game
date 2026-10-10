'use strict';
// Оазис — rendering, input and persistence. Rules live in core.js (window.OasisCore).
(() => {
  const C = window.OasisCore;
  const SAVE_KEY = 'oasis.v1';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } },
    set(v) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  // ───────────── Sound ─────────────
  const Sound = (() => {
    let ac = null, master = null, muted = false;
    const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
    }
    function tone(f, { t = 0, d = 0.4, vol = 0.15, type = 'sine' } = {}) {
      if (!ac || muted) return;
      const now = ac.currentTime + t;
      const o = ac.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d);
      o.connect(g); g.connect(master); o.start(now); o.stop(now + d + 0.05);
    }
    function click() {
      if (!ac || muted) return;
      const now = ac.currentTime, len = Math.ceil(ac.sampleRate * 0.04);
      const buf = ac.createBuffer(1, len, ac.sampleRate), data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
      const src = ac.createBufferSource(); src.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1.5;
      const g = ac.createGain(); g.gain.value = 0.5;
      src.connect(f); f.connect(g); g.connect(master); src.start(now);
    }
    return {
      init, click,
      get muted() { return muted; },
      set muted(v) { muted = v; },
      drip(k) { tone(523 * 2 ** (PENTA[k % PENTA.length] / 12), { d: 0.5, vol: 0.08, type: 'triangle' }); },
      bloom(k) { tone(392 * 2 ** (PENTA[k % PENTA.length] / 12), { d: 0.9, vol: 0.1 }); },
      win() { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(330 * 2 ** (s / 12), { t: i * 0.09, d: 1.4, vol: 0.09, type: 'triangle' })); },
    };
  })();

  // ───────────── Game state ─────────────
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  let saved = store.get();
  let mode = saved.mode === 'daily' ? 'daily' : 'path';
  let G = null; // current puzzle session
  Sound.muted = !!saved.muted;

  function newSession(kind) {
    const level = saved.level || 1;
    const date = today();
    const p = kind === 'daily'
      ? C.generate(C.DAILY_SIZE, C.dailySeed(date))
      : C.generate(C.sizeForLevel(level), C.levelSeed(level));
    const n = p.size * p.size;
    const s = {
      kind, level, date, p,
      turns: new Array(n).fill(0), locked: new Array(n).fill(false),
      moves: 0, time: 0, hints: 0, solved: false, started: false, history: [],
      angle: new Array(n).fill(0), water: new Array(n).fill(0), wetAt: new Array(n).fill(Infinity),
      grow: new Array(n).fill(0), plant: Array.from({ length: n }, (_, i) => C.hash(`plant${i}${p.src}`) % 3),
      solDist: C.check(p, p.sol).dist, minMoves: C.minMoves(p), cursor: -1, winShown: false,
    };
    // Resume an unfinished (or finished daily) board that matches this puzzle.
    const prev = kind === 'daily' ? saved.daily : saved.path;
    const sameBoard = prev && prev.turns && prev.turns.length === n &&
      (kind === 'daily' ? prev.date === date : prev.level === level);
    if (sameBoard) {
      Object.assign(s, { turns: prev.turns, locked: prev.locked || s.locked, moves: prev.moves || 0, time: prev.time || 0, hints: prev.hints || 0, started: (prev.moves || 0) > 0 });
      if (prev.solved) { s.solved = true; s.winShown = true; }
    }
    s.angle = s.turns.map((t) => t * Math.PI / 2);
    return s;
  }

  const masks = () => G.p.base.map((m, i) => C.rot(m, G.turns[i]));
  const isEnd = (i) => C.degree(G.p.base[i]) === 1 && i !== G.p.src;
  const gardens = () => G.p.base.reduce((n, m, i) => n + (isEnd(i) ? 1 : 0), 0);

  let state = null; // last check() result
  function refresh(animate) {
    const now = performance.now();
    state = C.check(G.p, masks());
    for (let i = 0; i < state.dist.length; i++) {
      const wet = state.dist[i] >= 0;
      if (wet && G.wetAt[i] === Infinity) G.wetAt[i] = animate ? now + state.dist[i] * 70 : now - 1000;
      if (!wet) G.wetAt[i] = Infinity;
    }
    if (state.solved && !G.solved) onSolved();
    persist();
    renderHud();
  }

  function persist() {
    const snap = { turns: G.turns, locked: G.locked, moves: G.moves, time: Math.floor(G.time), hints: G.hints, level: G.level, date: G.date, solved: G.solved };
    if (G.kind === 'daily') saved.daily = snap; else saved.path = snap;
    saved.mode = mode;
    saved.muted = Sound.muted;
    store.set(saved);
  }

  function rotate(i, dir, { record = true, counts = true } = {}) {
    if (G.solved || i < 0) return;
    if (G.locked[i]) { nudge[i] = performance.now(); return; }
    G.turns[i] += dir;
    if (record) G.history.push({ i, dir });
    if (counts) { G.moves++; G.started = true; }
    Sound.click();
    refresh(true);
  }

  function toggleLock(i) {
    if (G.solved || i < 0) return;
    G.locked[i] = !G.locked[i];
    persist();
  }

  function undo() {
    const h = G.history.pop();
    if (!h || G.solved) return;
    G.locked[h.i] = false;
    G.turns[h.i] -= h.dir;
    G.moves = Math.max(0, G.moves - 1);
    Sound.click();
    refresh(true);
  }

  // Fix the wrong tile closest to the spring, then pin it.
  function hint() {
    if (G.solved) return;
    const cur = masks();
    let best = -1;
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] === G.p.sol[i]) continue;
      if (best < 0 || G.solDist[i] < G.solDist[best]) best = i;
    }
    if (best < 0) return;
    let r = 0;
    while (C.rot(cur[best], r) !== G.p.sol[best]) r++;
    G.turns[best] += r === 3 ? -1 : r;
    G.locked[best] = true;
    G.hints++;
    G.started = true;
    G.history = G.history.filter((h) => h.i !== best);
    hintFlash[best] = performance.now();
    Sound.click();
    refresh(true);
  }

  function restart() {
    if (G.kind === 'daily') saved.daily = null; else saved.path = null;
    G = newSession(G.kind);
    $('win').hidden = true;
    refresh(false);
    resize();
  }

  function onSolved() {
    G.solved = true;
    if (G.kind === 'daily') {
      saved.dailyDone = saved.dailyDone || {};
      const prev = saved.dailyDone[G.date];
      if (!prev || G.moves < prev.moves) saved.dailyDone[G.date] = { moves: G.moves, time: Math.floor(G.time), hints: G.hints };
    } else {
      saved.best = saved.best || {};
      const prev = saved.best[G.level];
      if (!prev || G.moves < prev) saved.best[G.level] = G.moves;
    }
    persist();
    const maxDist = Math.max(...state.dist);
    setTimeout(() => { Sound.win(); fireflies(); }, Math.min(maxDist * 70 + 500, 2500));
    setTimeout(showWin, reduceMotion ? 300 : Math.min(maxDist * 70 + 1800, 3600));
  }

  function showWin() {
    if (!G.solved || G.winShown) return;
    G.winShown = true;
    const g = gardens();
    $('win-title').textContent = G.kind === 'daily' ? 'Задача дня решена' : 'Оазис ожил';
    $('win-text').textContent = G.kind === 'daily'
      ? `Вода дошла до всех ${g} садов. Новая задача появится завтра.`
      : `Вода дошла до всех ${g} садов. ${nextSizeText()}`;
    const extra = G.moves <= G.minMoves ? 'безупречно' : `минимум ${G.minMoves}`;
    $('win-stats').innerHTML =
      `<div><dt>Ходы</dt><dd>${G.moves}</dd><dt>${extra}</dt></div>` +
      `<div><dt>Время</dt><dd>${clock(G.time)}</dd></div>` +
      `<div><dt>Подсказки</dt><dd>${G.hints}</dd></div>`;
    $('btn-next').textContent = G.kind === 'daily' ? 'К колодцам' : 'Дальше';
    $('win').hidden = false;
    $('btn-next').focus();
  }

  function nextSizeText() {
    const n = C.sizeForLevel(G.level + 1);
    return n > G.p.size ? `Следующий колодец больше: ${n}×${n}.` : 'Следующий колодец того же размера, но запутаннее.';
  }

  function next() {
    $('win').hidden = true;
    if (G.kind === 'daily') { switchMode('path'); return; }
    saved.level = G.level + 1;
    saved.path = null;
    G = newSession('path');
    refresh(false);
    resize();
  }

  function switchMode(m) {
    if (mode === m && G) return;
    mode = m;
    $('win').hidden = true;
    $('tab-path').setAttribute('aria-selected', String(m === 'path'));
    $('tab-daily').setAttribute('aria-selected', String(m === 'daily'));
    G = newSession(m);
    refresh(false);
    resize();
  }

  // ───────────── HUD ─────────────
  const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  function renderHud() {
    const total = gardens();
    let watered = 0;
    for (let i = 0; i < state.dist.length; i++) if (isEnd(i) && state.dist[i] >= 0) watered++;
    $('title-label').textContent = G.kind === 'daily' ? `Задача дня · ${G.date.split('-').reverse().slice(0, 2).join('.')}` : `Колодец ${G.level}`;
    $('moves-label').textContent = `ходов: ${G.moves}`;
    $('time-label').textContent = clock(G.time);
    $('gardens-label').textContent = `сады: ${watered}/${total}`;
    $('btn-undo').disabled = !G.history.length || G.solved;
    $('btn-hint').disabled = G.solved;
    $('btn-sound').textContent = Sound.muted ? 'Звук: выкл' : 'Звук: вкл';
    $('btn-sound').setAttribute('aria-pressed', String(!Sound.muted));
  }

  // ───────────── Rendering ─────────────
  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  let L = { s: 40, pad: 14, px: 0, dpr: 1 };
  const nudge = {}, hintFlash = {};
  let flies = [];

  const sand = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#e8cf9c'; g.fillRect(0, 0, 96, 96);
    const R = C.rng(7);
    for (let i = 0; i < 520; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(160,120,70,0.16)' : 'rgba(255,245,220,0.35)';
      g.fillRect(R() * 96, R() * 96, R() < 0.9 ? 1 : 2, 1);
    }
    return ctx.createPattern(c, 'repeat');
  })();

  function resize() {
    const wrap = $('board-wrap').getBoundingClientRect();
    const avail = clamp(Math.min(wrap.width, window.innerHeight - 230, 640), 240, 640);
    const n = G.p.size;
    L.pad = Math.round(avail * 0.03);
    L.s = Math.floor((avail - L.pad * 2) / n);
    L.px = L.s * n + L.pad * 2;
    L.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = canvas.style.height = `${L.px}px`;
    canvas.width = canvas.height = Math.round(L.px * L.dpr);
  }
  window.addEventListener('resize', () => G && resize());

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }

  function arms(m, s, w) {
    ctx.beginPath();
    for (const d of C.DIRS) {
      if (!(m & d.bit)) continue;
      if (d.dx) ctx.rect(d.dx > 0 ? 0 : -s / 2 - 1, -w / 2, s / 2 + 1, w);
      else ctx.rect(-w / 2, d.dy > 0 ? 0 : -s / 2 - 1, w, s / 2 + 1);
    }
    ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
  }

  function drawTile(i, now, dt) {
    const n = G.p.size, s = L.s;
    const x = L.pad + (i % n) * s, y = L.pad + Math.floor(i / n) * s;
    const cx = x + s / 2, cy = y + s / 2;
    const target = G.turns[i] * Math.PI / 2;
    G.angle[i] += (target - G.angle[i]) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 22));
    const wetNow = G.wetAt[i] <= now;
    G.water[i] += ((wetNow ? 1 : 0) - G.water[i]) * (1 - Math.exp(-dt * (wetNow ? 8 : 14)));
    const growTarget = wetNow && now - G.wetAt[i] > 150 ? 1 : 0;
    const before = G.grow[i];
    G.grow[i] += (growTarget - G.grow[i]) * (1 - Math.exp(-dt * 3.2));
    if (isEnd(i) && before < 0.05 && G.grow[i] >= 0.05) Sound.bloom(i);

    // tile seams
    ctx.strokeStyle = 'rgba(150,110,60,0.18)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);

    let shake = 0;
    if (nudge[i] && now - nudge[i] < 300) shake = Math.sin((now - nudge[i]) / 20) * 0.08 * (1 - (now - nudge[i]) / 300);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(G.angle[i] + shake);
    const m = G.p.base[i];
    const w = s * 0.3;
    // carved channel bed
    arms(m, s, w);
    ctx.fillStyle = '#b8915a'; ctx.fill();
    arms(m, s, w * 0.72);
    ctx.fillStyle = '#9d7746'; ctx.fill();
    // water
    if (G.water[i] > 0.01) {
      ctx.globalAlpha = G.water[i];
      arms(m, s, w * 0.62);
      ctx.fillStyle = '#2fa8cf'; ctx.fill();
      // shimmer drifting away from the spring
      ctx.strokeStyle = 'rgba(155,228,245,0.75)'; ctx.lineWidth = Math.max(1, s * 0.03); ctx.lineCap = 'round';
      const phase = ((now / 1000) * 0.6 + (state.dist[i] || 0) * 0.5) % 1;
      ctx.beginPath();
      for (const d of C.DIRS) {
        if (!(m & d.bit)) continue;
        const k = (phase * s) / 2;
        ctx.moveTo(d.dx * k - d.dy * w * 0.12, d.dy * k + d.dx * w * 0.12);
        ctx.lineTo(d.dx * (k + s * 0.08) - d.dy * w * 0.12, d.dy * (k + s * 0.08) + d.dx * w * 0.12);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (i === G.p.src) drawSpring(cx, cy, s, now);
    else if (isEnd(i)) drawPlant(cx, cy, s, G.grow[i], G.plant[i], now + i * 300);

    if (G.locked[i]) {
      ctx.strokeStyle = 'rgba(70,45,20,0.55)'; ctx.lineWidth = Math.max(1.5, s * 0.04);
      const c = s * 0.18, o = s * 0.08;
      ctx.beginPath();
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const px = cx + sx * (s / 2 - o), py = cy + sy * (s / 2 - o);
        ctx.moveTo(px - sx * c, py); ctx.lineTo(px, py); ctx.lineTo(px, py - sy * c);
      }
      ctx.stroke();
    }
    if (hintFlash[i] && now - hintFlash[i] < 1200) {
      ctx.fillStyle = `rgba(155,228,245,${0.45 * (1 - (now - hintFlash[i]) / 1200)})`;
      ctx.fillRect(x, y, s, s);
    }
    if (i === G.cursor) {
      ctx.strokeStyle = '#101a33'; ctx.lineWidth = 2.5;
      ctx.strokeRect(x + 3, y + 3, s - 6, s - 6);
    }
  }

  function drawSpring(cx, cy, s, now) {
    const r = s * 0.27;
    ctx.fillStyle = '#8a7a6a';
    ctx.beginPath(); ctx.arc(cx, cy, r + s * 0.07, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.fillStyle = k % 2 ? '#a8998a' : '#9a8b7c';
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (r + s * 0.035), cy + Math.sin(a) * (r + s * 0.035), s * 0.045, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#2fa8cf';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(155,228,245,0.8)'; ctx.lineWidth = 1.2;
    for (let k = 0; k < 2; k++) {
      const t = ((now / 1600) + k / 2) % 1;
      ctx.globalAlpha = 1 - t;
      ctx.beginPath(); ctx.arc(cx, cy, r * t, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlant(cx, cy, s, g, kind, t) {
    // seed mound, always visible
    ctx.fillStyle = '#9d7746';
    ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.06, s * 0.15, s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    if (g < 0.03) {
      ctx.fillStyle = '#6b4a2a';
      ctx.beginPath(); ctx.arc(cx, cy + s * 0.04, s * 0.03, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const sway = Math.sin(t / 900) * 0.06 * g;
    const base = { x: cx, y: cy + s * 0.06 };
    const h = s * 0.42 * g;
    ctx.save();
    ctx.translate(base.x, base.y);
    ctx.rotate(sway);
    if (kind === 0) { // palm
      ctx.strokeStyle = '#8a5a32'; ctx.lineWidth = s * 0.06; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(s * 0.06, -h * 0.5, 0, -h); ctx.stroke();
      ctx.fillStyle = '#4f9a5a';
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + (k - 2.5) * 0.55;
        ctx.save(); ctx.translate(0, -h); ctx.rotate(a + Math.PI / 2);
        ctx.beginPath(); ctx.ellipse(0, -s * 0.13 * g, s * 0.05 * g, s * 0.15 * g, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#6b4a2a';
      ctx.beginPath(); ctx.arc(-s * 0.03, -h + s * 0.03, s * 0.025 * g, 0, Math.PI * 2); ctx.arc(s * 0.03, -h + s * 0.035, s * 0.025 * g, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 1) { // flower
      ctx.strokeStyle = '#4f9a5a'; ctx.lineWidth = s * 0.035; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -h); ctx.stroke();
      ctx.fillStyle = '#5aa463';
      ctx.beginPath(); ctx.ellipse(-s * 0.07 * g, -h * 0.4, s * 0.07 * g, s * 0.03 * g, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(s * 0.07 * g, -h * 0.55, s * 0.07 * g, s * 0.03 * g, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f07a9a';
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        ctx.beginPath(); ctx.arc(Math.cos(a) * s * 0.07 * g, -h + Math.sin(a) * s * 0.07 * g, s * 0.055 * g, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#f6d36b';
      ctx.beginPath(); ctx.arc(0, -h, s * 0.045 * g, 0, Math.PI * 2); ctx.fill();
    } else { // bush with berries
      ctx.fillStyle = '#4f9a5a';
      for (const [bx, by, br] of [[-0.09, -0.12, 0.12], [0.09, -0.12, 0.12], [0, -0.22, 0.13]]) {
        ctx.beginPath(); ctx.arc(bx * s * g, by * s * g, br * s * g, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#d9485f';
      for (const [bx, by] of [[-0.08, -0.16], [0.07, -0.2], [0.01, -0.28], [0.1, -0.1]]) {
        ctx.beginPath(); ctx.arc(bx * s * g, by * s * g, s * 0.025 * g, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function fireflies() {
    if (reduceMotion) return;
    const n = G.p.size;
    for (let k = 0; k < 40; k++) {
      const i = Math.floor(Math.random() * n * n);
      flies.push({
        x: L.pad + (i % n + Math.random()) * L.s, y: L.pad + (Math.floor(i / n) + Math.random()) * L.s,
        vx: (Math.random() - 0.5) * 20, vy: -10 - Math.random() * 25, t: 0, life: 2 + Math.random() * 2, p: Math.random() * 6,
      });
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (G.started && !G.solved && document.visibilityState === 'visible') {
      const before = Math.floor(G.time);
      G.time += dt;
      if (Math.floor(G.time) !== before) { $('time-label').textContent = clock(G.time); if (Math.floor(G.time) % 5 === 0) persist(); }
    }

    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.clearRect(0, 0, L.px, L.px);
    // sand island
    roundRect(0, 0, L.px, L.px, L.pad * 1.4);
    ctx.fillStyle = '#c9a46a'; ctx.fill();
    roundRect(L.pad * 0.45, L.pad * 0.45, L.px - L.pad * 0.9, L.px - L.pad * 0.9, L.pad);
    ctx.fillStyle = sand; ctx.fill();
    for (let i = 0; i < G.p.size * G.p.size; i++) drawTile(i, now, dt);

    if (G.solved && G.water[G.p.src] > 0.5) {
      const glow = 0.12 + 0.06 * Math.sin(now / 500);
      ctx.fillStyle = `rgba(155,228,245,${glow})`;
      roundRect(0, 0, L.px, L.px, L.pad * 1.4); ctx.fill();
    }
    for (const f of flies) {
      f.t += dt; f.x += (f.vx + Math.sin(f.t * 3 + f.p) * 12) * dt; f.y += f.vy * dt;
      const a = Math.sin(Math.PI * clamp(f.t / f.life, 0, 1));
      ctx.fillStyle = `rgba(230,255,150,${a})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(230,255,150,${a * 0.2})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, 6, 0, Math.PI * 2); ctx.fill();
    }
    flies = flies.filter((f) => f.t < f.life);
    requestAnimationFrame(frame);
  }

  // ───────────── Input ─────────────
  function tileAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left - L.pad, y = e.clientY - r.top - L.pad;
    const n = G.p.size;
    const tx = Math.floor(x / L.s), ty = Math.floor(y / L.s);
    return tx < 0 || ty < 0 || tx >= n || ty >= n ? -1 : ty * n + tx;
  }

  let press = null;
  canvas.addEventListener('pointerdown', (e) => {
    Sound.init();
    const i = tileAt(e);
    if (i < 0) return;
    G.cursor = -1;
    if (e.pointerType === 'mouse') {
      if (e.button === 2) toggleLock(i);
      else if (e.button === 0) rotate(i, e.shiftKey ? -1 : 1);
      return;
    }
    press = { i, long: false, timer: setTimeout(() => { press.long = true; toggleLock(i); navigator.vibrate?.(15); }, 450) };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!press) return;
    clearTimeout(press.timer);
    if (!press.long && tileAt(e) === press.i) rotate(press.i, 1);
    press = null;
  });
  canvas.addEventListener('pointercancel', () => { if (press) clearTimeout(press.timer); press = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (!$('win').hidden) {
      if (e.key === 'Enter') { e.preventDefault(); next(); }
      return;
    }
    const n = G.p.size;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('button') && (e.code === 'Space' || e.code === 'Enter')) return;
    const moves = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 };
    if (e.code in moves) {
      e.preventDefault();
      Sound.init();
      if (G.cursor < 0) { G.cursor = G.p.src; return; }
      const c = G.cursor, d = moves[e.code];
      if ((d === -1 && c % n === 0) || (d === 1 && c % n === n - 1)) return;
      if (c + d >= 0 && c + d < n * n) G.cursor = c + d;
      return;
    }
    if ((e.code === 'Space' || e.code === 'Enter') && G.cursor >= 0) { e.preventDefault(); rotate(G.cursor, e.shiftKey ? -1 : 1); }
    else if (e.code === 'KeyL' && G.cursor >= 0) toggleLock(G.cursor);
    else if (e.code === 'KeyZ') undo();
    else if (e.code === 'KeyH') hint();
  });

  $('btn-undo').addEventListener('click', undo);
  $('btn-hint').addEventListener('click', () => { Sound.init(); hint(); });
  $('btn-restart').addEventListener('click', restart);
  $('btn-sound').addEventListener('click', () => { Sound.init(); Sound.muted = !Sound.muted; persist(); renderHud(); });
  $('btn-next').addEventListener('click', next);
  $('btn-stay').addEventListener('click', () => { $('win').hidden = true; });
  $('tab-path').addEventListener('click', () => switchMode('path'));
  $('tab-daily').addEventListener('click', () => switchMode('daily'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && G) persist(); });

  // ───────────── Boot ─────────────
  const start = mode;
  mode = null;
  switchMode(start);
  requestAnimationFrame(frame);
})();
