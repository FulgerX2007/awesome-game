'use strict';
// Долина — rendering, input, sound and persistence. Rules live in core.js (window.ValleyCore).
(() => {
  const C = window.ValleyCore;
  const SAVE_KEY = 'valley.save';
  const BOARD_URL = '/api/boards/valley/scores';
  const HEX = 40; // world circumradius
  const SQ3 = Math.sqrt(3);
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };

  const TERRAIN = {
    forest: { name: 'Лес', base: '#4f8a57', color: '#3f7d4e' },
    field: { name: 'Поле', base: '#e6c867', color: '#e6c867' },
    water: { name: 'Река', base: '#4aa3c9', color: '#4aa3c9' },
    village: { name: 'Деревня', base: '#bcae8e', color: '#c96a4a' },
    meadow: { name: 'Луг', base: '#94c66d', color: '#94c66d' },
  };
  const QUEST_NAME = { forest: 'Лес', field: 'Поле', water: 'Река', village: 'Деревня' };
  // Whole-sentence keys per terrain, so each language can decline the terrain name its own way.
  const QUEST_TEXT = {
    forest: { note: 'Задание: лес ровно из {n}', done: 'Лес из {n}: задание выполнено, +3 плитки', failed: 'Лес перерос {n}: задание сгорело' },
    field: { note: 'Задание: поле ровно из {n}', done: 'Поле из {n}: задание выполнено, +3 плитки', failed: 'Поле перерос {n}: задание сгорело' },
    water: { note: 'Задание: река ровно из {n}', done: 'Река из {n}: задание выполнено, +3 плитки', failed: 'Река перерос {n}: задание сгорело' },
    village: { note: 'Задание: деревня ровно из {n}', done: 'Деревня из {n}: задание выполнено, +3 плитки', failed: 'Деревня перерос {n}: задание сгорело' },
  };
  const t = I18n.t, TILES = 'плитка|плитки|плиток';
  const questText = (q, kind) => t(QUEST_TEXT[q.terrain][kind], { n: q.target, tiles: I18n.p(q.target, TILES) });

  // ───────────── Sound ─────────────
  const Sound = (() => {
    let ac = null, master = null, wind = null, birdT = 8;
    let muted = store.get('valley.muted', '0') === '1';
    const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ac.destination);
      // Soft wind: looped noise through a slowly wandering low-pass.
      const len = ac.sampleRate * 4, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = last * 0.98 + (Math.random() * 2 - 1) * 0.02; d[i] = last * 6; }
      const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.08;
      const lg = ac.createGain(); lg.gain.value = 250; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      wind = ac.createGain(); wind.gain.value = 0.05;
      src.connect(lp); lp.connect(wind); wind.connect(master); src.start();
    }
    function tone(f, { t = 0, a = 0.01, d = 0.4, vol = 0.12, type = 'sine', to } = {}) {
      if (!ac) return;
      const now = ac.currentTime + t;
      const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, now);
      if (to) o.frequency.exponentialRampToValueAtTime(to, now + a + d);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol, now + a);
      g.gain.exponentialRampToValueAtTime(0.0001, now + a + d);
      o.connect(g); g.connect(master); o.start(now); o.stop(now + a + d + 0.05);
    }
    return {
      init,
      get muted() { return muted; },
      toggle() {
        muted = !muted; store.set('valley.muted', muted ? '1' : '0');
        if (ac) master.gain.setTargetAtTime(muted ? 0 : 0.5, ac.currentTime, 0.05);
      },
      tick(dt) {
        if (!ac || muted) return;
        birdT -= dt;
        if (birdT > 0) return;
        birdT = 6 + Math.random() * 10;
        const f = 2400 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) tone(f, { t: i * 0.11, d: 0.08, vol: 0.02, to: f * 1.3 });
      },
      place(match) {
        tone(150, { d: 0.18, vol: 0.2, to: 90 });
        for (let i = 0; i < match; i++) tone(440 * 2 ** (PENTA[i] / 12), { t: 0.06 + i * 0.05, d: 0.5, vol: 0.06, type: 'triangle' });
      },
      rotate() { tone(900, { d: 0.05, vol: 0.03, type: 'triangle' }); },
      perfect() { [0, 4, 7, 12].forEach((s) => tone(523 * 2 ** (s / 12), { t: 0.25, d: 1.2, vol: 0.05 })); },
      quest() { [0, 4, 7, 12, 16].forEach((s, i) => tone(392 * 2 ** (s / 12), { t: 0.3 + i * 0.09, d: 0.9, vol: 0.07, type: 'triangle' })); },
      fail() { tone(220, { t: 0.2, d: 0.7, vol: 0.06, to: 160, type: 'triangle' }); },
    };
  })();

  // ───────────── Game & persistence ─────────────
  let G = null;
  let best = Number(store.get('valley.best', 0));

  function save() { if (G) store.set(SAVE_KEY, JSON.stringify(C.serialize(G))); }
  function load() {
    try {
      const raw = store.get(SAVE_KEY);
      return raw ? C.restore(JSON.parse(raw)) : null;
    } catch { return null; }
  }
  function newGame() {
    G = C.newGame((Math.random() * 2 ** 32) >>> 0);
    tileCache.clear();
    fx.drops.clear(); fx.floaters = []; fx.sparks = [];
    selected = null;
    save();
    recenter(true);
    renderHand();
    renderQuests();
    updateHud();
  }

  // ───────────── Hex drawing ─────────────
  function corner(i, size) {
    const a = (Math.PI / 180) * (60 * i - 30);
    return [Math.cos(a) * size, Math.sin(a) * size];
  }

  function hexPath(c, size) {
    c.beginPath();
    for (let i = 0; i < 6; i++) { const [x, y] = corner(i, size); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.closePath();
  }

  // Tile art at the origin of c. Deterministic per tile id so cached and live renders match.
  function drawTileArt(c, edges, size, id) {
    const R = C.rng(id * 7919 + 13);
    c.save();
    hexPath(c, size);
    c.translate(0, size * 0.08); c.fillStyle = 'rgba(8,16,18,0.45)'; c.fill(); c.translate(0, -size * 0.08);
    // Draw each run of same-terrain sides as one shape, so no seams show inside it.
    const start = edges.findIndex((t, i) => t !== edges[(i + 5) % 6]);
    const runs = [];
    if (start < 0) runs.push({ from: 0, len: 6 });
    else {
      for (let k = 0; k < 6;) {
        const from = (start + k) % 6;
        let len = 1;
        while (len < 6 - k && edges[(from + len) % 6] === edges[from]) len++;
        runs.push({ from, len });
        k += len;
      }
    }
    for (const run of runs) {
      const terrain = edges[run.from];
      c.beginPath(); c.moveTo(0, 0);
      for (let k = 0; k <= run.len; k++) { const [x, y] = corner(run.from + k, size + 0.6); c.lineTo(x, y); }
      c.closePath();
      c.fillStyle = TERRAIN[terrain].base; c.fill();
      c.save(); c.clip();
      for (let k = 0; k < run.len; k++) {
        const i = (run.from + k) % 6;
        const [ax, ay] = corner(i, size + 0.6), [bx, by] = corner(i + 1, size + 0.6);
        if (terrain !== 'field' || k === 0) decorate(c, terrain, ax, ay, bx, by, size, R, run.from);
      }
      c.restore();
    }
    hexPath(c, size);
    c.strokeStyle = 'rgba(10,20,22,0.35)'; c.lineWidth = Math.max(1, size * 0.03); c.stroke();
    c.restore();
  }

  function inTri(R, ax, ay, bx, by, shrink = 0.82) {
    let u = R(), v = R();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    return [(ax * u + bx * v) * shrink, (ay * u + by * v) * shrink];
  }

  function decorate(c, terrain, ax, ay, bx, by, size, R, i) {
    const s = size / 40;
    if (terrain === 'forest') {
      const trees = [];
      for (let k = 0; k < 3; k++) trees.push(inTri(R, ax, ay, bx, by, 0.78));
      trees.sort((p, q) => p[1] - q[1]);
      for (const [x, y] of trees) {
        const h = (9 + R() * 4) * s;
        c.fillStyle = '#5b4632'; c.fillRect(x - 1 * s, y, 2 * s, 3 * s);
        c.fillStyle = R() < 0.5 ? '#2c5e3b' : '#346d44';
        c.beginPath(); c.moveTo(x, y - h); c.lineTo(x + 5 * s, y + 1 * s); c.lineTo(x - 5 * s, y + 1 * s); c.closePath(); c.fill();
      }
    } else if (terrain === 'field') {
      c.strokeStyle = '#cfae4a'; c.lineWidth = 1.4 * s;
      const ang = (i % 3) * (Math.PI / 3) + Math.PI / 6;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      c.beginPath();
      for (let k = -8; k <= 8; k++) {
        const ox = -dy * k * 4.5 * s, oy = dx * k * 4.5 * s;
        c.moveTo(ox - dx * size, oy - dy * size); c.lineTo(ox + dx * size, oy + dy * size);
      }
      c.stroke();
    } else if (terrain === 'water') {
      c.strokeStyle = 'rgba(190,232,245,0.7)'; c.lineWidth = 1.3 * s; c.lineCap = 'round';
      for (let k = 0; k < 2; k++) {
        const [x, y] = inTri(R, ax, ay, bx, by, 0.7);
        c.beginPath(); c.arc(x - 3 * s, y, 3 * s, Math.PI * 1.1, Math.PI * 1.9); c.arc(x + 3 * s, y, 3 * s, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
      }
    } else if (terrain === 'village') {
      const n = 1 + (R() < 0.6 ? 1 : 0);
      const houses = [];
      for (let k = 0; k < n; k++) houses.push(inTri(R, ax, ay, bx, by, 0.7));
      houses.sort((p, q) => p[1] - q[1]);
      for (const [x, y] of houses) {
        c.fillStyle = '#f1e8d6'; c.fillRect(x - 4 * s, y - 3 * s, 8 * s, 6 * s);
        c.fillStyle = R() < 0.5 ? '#c0583f' : '#a8482f';
        c.beginPath(); c.moveTo(x - 5.5 * s, y - 3 * s); c.lineTo(x, y - 8 * s); c.lineTo(x + 5.5 * s, y - 3 * s); c.closePath(); c.fill();
        c.fillStyle = '#5b4632'; c.fillRect(x - 1 * s, y, 2 * s, 3 * s);
      }
    } else {
      for (let k = 0; k < 5; k++) {
        const [x, y] = inTri(R, ax, ay, bx, by);
        c.fillStyle = k % 3 === 0 ? '#fff6c8' : k % 3 === 1 ? '#f4a3b6' : '#6ea24f';
        c.beginPath(); c.arc(x, y, (k % 3 === 2 ? 1.6 : 1.3) * s, 0, Math.PI * 2); c.fill();
      }
    }
  }

  // Placed tiles never change, so each is rendered once to its own small canvas.
  const tileCache = new Map();
  const CACHE_SCALE = 2.5;
  function cachedTile(cell) {
    let cv = tileCache.get(cell.id);
    if (cv) return cv;
    const size = HEX * CACHE_SCALE;
    cv = document.createElement('canvas');
    cv.width = Math.ceil(SQ3 * size + 8); cv.height = Math.ceil(2 * size + 16);
    const c = cv.getContext('2d');
    c.translate(cv.width / 2, cv.height / 2 - 4);
    drawTileArt(c, cell.edges, size, cell.id);
    tileCache.set(cell.id, cv);
    return cv;
  }

  // ───────────── Map canvas & camera ─────────────
  const canvas = $('map');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  const cam = { x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1 };
  const fx = { drops: new Map(), floaters: [], sparks: [], rotAnim: 0 };
  let hover = null, selected = null;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  }
  window.addEventListener('resize', resize);

  const toScreen = (wx, wy) => ({ x: (wx - cam.x) * cam.z + W / 2, y: (wy - cam.y) * cam.z + H / 2 });
  const toWorld = (sx, sy) => ({ x: (sx - W / 2) / cam.z + cam.x, y: (sy - H / 2) / cam.z + cam.y });
  const cellAt = (sx, sy) => { const w = toWorld(sx, sy); return C.fromPixel(w.x, w.y, HEX); };

  function recenter(instant) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of G.order) {
      const p = C.toPixel(c.q, c.r, HEX);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    cam.tx = (minX + maxX) / 2; cam.ty = (minY + maxY) / 2;
    const span = Math.max((maxX - minX + HEX * 6) / W, (maxY - minY + HEX * 6) / H);
    cam.tz = clamp(1 / span, 0.35, 1.6);
    if (instant) { cam.x = cam.tx; cam.y = cam.ty; cam.z = cam.tz; }
  }

  function zoomBy(f, sx = W / 2, sy = H / 2) {
    const before = toWorld(sx, sy);
    cam.z = cam.tz = clamp(cam.z * f, 0.3, 2.4);
    const after = toWorld(sx, sy);
    cam.x = cam.tx = cam.x + before.x - after.x;
    cam.y = cam.ty = cam.y + before.y - after.y;
  }

  function drawBackground(now) {
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#22393f'); g.addColorStop(1, '#122125');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // drifting mist
    for (let k = 0; k < 4; k++) {
      const x = ((now / 1000) * (6 + k * 3) + k * 400 - cam.x * cam.z * 0.2) % (W + 600) - 300;
      const y = (k * 0.27 + 0.12) * H - cam.y * cam.z * 0.1;
      const m = ctx.createRadialGradient(x, y, 0, x, y, 260);
      m.addColorStop(0, 'rgba(200,225,220,0.05)'); m.addColorStop(1, 'rgba(200,225,220,0)');
      ctx.fillStyle = m; ctx.fillRect(x - 260, y - 260, 520, 520);
    }
  }

  function render(now, dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBackground(now);
    const z = cam.z;
    const size = HEX * z;

    // empty spots next to the map
    if (!G.over) {
      ctx.strokeStyle = 'rgba(242,239,228,0.10)'; ctx.lineWidth = 1;
      for (const f of C.frontier(G)) {
        const p = C.toPixel(f.q, f.r, HEX), s = toScreen(p.x, p.y);
        if (s.x < -size || s.x > W + size || s.y < -size || s.y > H + size) continue;
        ctx.save(); ctx.translate(s.x, s.y); hexPath(ctx, size * 0.92); ctx.stroke(); ctx.restore();
      }
    }

    // placed tiles, back to front
    for (const c of G.order) {
      const p = C.toPixel(c.q, c.r, HEX), s = toScreen(p.x, p.y);
      if (s.x < -size * 2 || s.x > W + size * 2 || s.y < -size * 2 || s.y > H + size * 2) continue;
      const cv = cachedTile(c);
      let k = 1, alpha = 1;
      const drop = fx.drops.get(c.id);
      if (drop !== undefined) {
        const t = clamp((now - drop) / 260, 0, 1);
        k = 1 + 0.15 * (1 - t) ** 2; alpha = 0.4 + 0.6 * t;
        if (t >= 1) fx.drops.delete(c.id);
      }
      const sc = (z / CACHE_SCALE) * k;
      ctx.globalAlpha = alpha;
      ctx.drawImage(cv, s.x - (cv.width / 2) * sc, s.y - (cv.height / 2 - 4) * sc, cv.width * sc, cv.height * sc);
      ctx.globalAlpha = 1;
    }

    drawQuestBadges(now);

    // ghost of the current tile
    const spot = selected || hover;
    const tile = C.current(G);
    if (spot && tile && C.canPlace(G, spot.q, spot.r)) {
      const p = C.toPixel(spot.q, spot.r, HEX), s = toScreen(p.x, p.y);
      const ev = C.evaluate(G, spot.q, spot.r, tile.edges);
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(fx.rotAnim); ctx.globalAlpha = 0.88;
      drawTileArt(ctx, tile.edges, size, tile.id);
      ctx.restore();
      ctx.save(); ctx.translate(s.x, s.y);
      hexPath(ctx, size); ctx.strokeStyle = 'rgba(242,198,109,0.9)'; ctx.lineWidth = 2; ctx.stroke();
      ev.sides.forEach((ok, i) => {
        if (ok === null) return;
        const a = (Math.PI / 3) * i, r = size * 0.8;
        ctx.fillStyle = ok ? '#8fe0a0' : '#f08a7a';
        ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, Math.max(3, size * 0.09), 0, Math.PI * 2); ctx.fill();
      });
      ctx.font = `700 ${Math.round(clamp(14 * z, 11, 20))}px Comfortaa, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = ev.perfect ? '#f2c66d' : '#f2efe4';
      ctx.fillText(ev.perfect ? t('+{n} идеально', { n: ev.points }) : `+${ev.points}`, 0, -size * 1.15);
      ctx.restore();
    }

    // effects
    for (const sp of fx.sparks) {
      sp.t += dt;
      const k = sp.t / sp.life;
      const s = toScreen(sp.x, sp.y);
      ctx.strokeStyle = `rgba(242,198,109,${1 - k})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, (HEX * 0.6 + k * HEX * 1.2) * z, 0, Math.PI * 2); ctx.stroke();
    }
    fx.sparks = fx.sparks.filter((s) => s.t < s.life);
    ctx.textAlign = 'center';
    for (const f of fx.floaters) {
      f.t += dt;
      const s = toScreen(f.x, f.y);
      ctx.globalAlpha = clamp(1.6 - f.t, 0, 1);
      ctx.font = `700 ${Math.round(clamp(15 * z, 12, 22))}px Comfortaa, sans-serif`;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, s.x, s.y - HEX * z * 0.9 - f.t * 26);
    }
    ctx.globalAlpha = 1;
    fx.floaters = fx.floaters.filter((f) => f.t < 1.6);
  }

  function drawQuestBadges(now) {
    for (const q of G.quests) {
      if (q.state === 'failed') continue;
      const age = q.doneAt ? (now - q.doneAt) / 1000 : 0;
      if (q.state === 'done' && age > 2.5) continue;
      const p = C.toPixel(q.q, q.r, HEX), s = toScreen(p.x, p.y);
      const r = clamp(12 * cam.z, 9, 16), y = s.y - HEX * cam.z * 0.55;
      ctx.globalAlpha = q.state === 'done' ? clamp(2.5 - age, 0, 1) : 1;
      ctx.fillStyle = '#f2efe4';
      ctx.beginPath(); ctx.arc(s.x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = TERRAIN[q.terrain].color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(s.x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, q.progress / q.target)); ctx.stroke();
      ctx.fillStyle = '#16272c';
      ctx.font = `700 ${Math.round(r * 1.05)}px Rubik, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(q.state === 'done' ? '✓' : String(q.target - q.progress), s.x, y + 1);
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
    }
  }

  // ───────────── Hand, quests, HUD ─────────────
  function drawPreview(id, tile, angle = 0) {
    const cv = $(id), c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    if (!tile) return;
    c.translate(cv.width / 2, cv.height / 2 - cv.height * 0.02);
    c.rotate(angle);
    drawTileArt(c, tile.edges, cv.width * 0.43, tile.id);
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (tile.quest) {
      const r = cv.width * 0.13, x = cv.width - r - 2, y = r + 2;
      c.fillStyle = '#f2efe4'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = TERRAIN[tile.quest.terrain].color; c.lineWidth = Math.max(2, r * 0.25); c.stroke();
      c.fillStyle = '#16272c'; c.font = `700 ${Math.round(r * 1.1)}px Rubik, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(tile.quest.target), x, y + 1);
    }
  }

  function renderHand() {
    const st = G.stack;
    drawPreview('tile-now', st[0], fx.rotAnim);
    drawPreview('tile-next1', st[1]);
    drawPreview('tile-next2', st[2]);
    const q = st[0] && st[0].quest;
    $('quest-note').hidden = !q;
    if (q) $('quest-note').textContent = questText(q, 'note');
  }

  function renderQuests() {
    const list = G.quests.filter((q) => q.state === 'open' || (q.doneAt && performance.now() - q.doneAt < 4000));
    $('quests').hidden = !list.length;
    $('quest-list').innerHTML = list.map((q) =>
      `<li class="${q.state}"><i style="background:${TERRAIN[q.terrain].color}"></i>${t(QUEST_NAME[q.terrain])}: ${q.progress}/${q.target}</li>`).join('');
  }

  function updateHud() {
    $('score').textContent = String(G.score);
    $('stack-label').textContent = G.over ? t('стопка пуста') : t('в стопке: {n}', { n: G.stack.length });
    $('btn-mute').textContent = Sound.muted ? t('Звук: выкл') : t('Звук: вкл');
    $('btn-mute').setAttribute('aria-pressed', String(Sound.muted));
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
  }

  // ───────────── Actions ─────────────
  function rotate(dir) {
    if (!C.current(G) || G.over) return;
    C.rotateCurrent(G, dir);
    fx.rotAnim = reduceMotion ? 0 : -dir * Math.PI / 3;
    Sound.rotate();
    renderHand();
  }

  function placeAt(cell) {
    Sound.init();
    const tile = C.current(G);
    if (!tile || !C.canPlace(G, cell.q, cell.r)) return;
    const ev = C.place(G, cell.q, cell.r);
    if (!ev) return;
    selected = null;
    const now = performance.now();
    fx.drops.set(tile.id, now);
    const p = C.toPixel(cell.q, cell.r, HEX);
    if (ev.points) fx.floaters.push({ x: p.x, y: p.y, t: 0, text: `+${ev.points}`, color: '#f2efe4' });
    Sound.place(ev.match);
    for (const e of G.events) {
      if (e.type === 'perfect') {
        fx.sparks.push({ x: p.x, y: p.y, t: 0, life: 0.8 });
        Sound.perfect();
        toast(t('Идеально! +1 плитка в стопку'));
      }
      if (e.type === 'quest') {
        e.quest.doneAt = now;
        const qp = C.toPixel(e.quest.q, e.quest.r, HEX);
        fx.sparks.push({ x: qp.x, y: qp.y, t: 0, life: 1.2 });
        fx.floaters.push({ x: qp.x, y: qp.y - HEX * 0.6, t: 0, text: `+${e.quest.target * 10}`, color: '#f2c66d' });
        Sound.quest();
        toast(questText(e.quest, 'done'));
      }
      if (e.type === 'questFailed') {
        Sound.fail();
        toast(questText(e.quest, 'failed'));
      }
      if (e.type === 'over') setTimeout(onOver, 900);
    }
    G.events.length = 0;
    if (G.score > best) { best = G.score; store.set('valley.best', best); }
    save();
    renderHand(); renderQuests(); updateHud();
  }

  function onOver() {
    const done = G.quests.filter((q) => q.state === 'done').length;
    $('over-text').textContent = G.score >= best ? t('Лучшая долина из всех, что ты собирал.') : t('Твой рекорд — {n}.', { n: best });
    $('over-stats').innerHTML =
      `<div><dt>${t('Очки')}</dt><dd>${G.score}</dd></div><div><dt>${t('Плиток')}</dt><dd>${G.placed}</dd></div>` +
      `<div><dt>${t('Идеально')}</dt><dd>${G.perfect}</dd></div><div><dt>${t('Заданий')}</dt><dd>${done}</dd></div>`;
    showPanel('panel-over');
    submitScore();
    recenter(false);
  }

  function showPanel(id) {
    $('overlay').hidden = false;
    for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== id;
    document.querySelector(`#${id} .btn:not(.ghost)`)?.focus();
  }
  const closePanel = () => { $('overlay').hidden = true; };

  // ───────────── Leaderboard ─────────────
  const playerName = () => ($('name').value.trim() || t('Аноним')).slice(0, 16);
  function renderBoard(el, entries, myRank) {
    if (!entries || !entries.length) { el.innerHTML = best ? `<p>${t('Твой рекорд: {n}', { n: `<b>${best}</b>` })}</p>` : ''; return; }
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    el.innerHTML = `<table><caption>${t('Лучшие долины')}</caption>` + entries.map((e, i) =>
      `<tr class="${i + 1 === myRank ? 'me' : ''}"><td>${i + 1}.</td><td>${esc(e.name === 'Аноним' ? t('Аноним') : e.name)}</td><td>${e.level} ${I18n.p(e.level, TILES)}</td><td>${e.score}</td></tr>`).join('') + '</table>';
  }
  async function loadBoard() {
    try {
      const res = await fetch(BOARD_URL);
      if (!res.ok) throw new Error(res.status);
      renderBoard($('board-menu'), await res.json());
    } catch { renderBoard($('board-menu'), null); }
  }
  async function submitScore() {
    try {
      const res = await fetch(BOARD_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playerName(), score: G.score, level: Math.max(1, G.placed) }),
      });
      if (!res.ok) throw new Error(res.status);
      const { rank, top } = await res.json();
      renderBoard($('board-over'), top, rank);
    } catch { renderBoard($('board-over'), null); }
  }

  // ───────────── Input ─────────────
  const pointers = new Map();
  let drag = null, pinch = null, wheelLock = 0;

  canvas.addEventListener('pointerdown', (e) => {
    Sound.init();
    canvas.setPointerCapture(e.pointerId);
    if (e.pointerType === 'mouse' && e.button === 2) { rotate(1); return; }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, type: e.pointerType };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      drag = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && !pointers.size) {
      const c = cellAt(e.clientX, e.clientY);
      hover = C.canPlace(G, c.q, c.r) ? c : null;
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomBy(d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.d = d;
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) { drag.moved = true; canvas.classList.add('dragging'); }
      if (drag.moved) {
        cam.x = cam.tx = cam.x - (e.clientX - drag.x) / cam.z;
        cam.y = cam.ty = cam.y - (e.clientY - drag.y) / cam.z;
      }
      drag.x = e.clientX; drag.y = e.clientY;
    }
  });
  const endPointer = (e) => {
    const wasDrag = drag;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    canvas.classList.remove('dragging');
    if (!wasDrag || wasDrag.moved || pointers.size) { if (!pointers.size) drag = null; return; }
    drag = null;
    if (e.type === 'pointercancel') return;
    const c = cellAt(e.clientX, e.clientY);
    if (!C.canPlace(G, c.q, c.r) || G.over) { selected = null; return; }
    if (wasDrag.type === 'mouse') placeAt(c);
    else if (selected && selected.q === c.q && selected.r === c.r) placeAt(c);
    else { selected = c; if (!store.get('valley.tapHint')) { store.set('valley.tapHint', '1'); toast(t('Тапни ещё раз, чтобы положить плитку')); } }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { hover = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey) { zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY); return; }
    const now = performance.now();
    if (now - wheelLock < 140 || Math.abs(e.deltaY) < 2) return;
    wheelLock = now;
    rotate(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input')) return;
    if (!$('overlay').hidden) { if (e.code === 'Escape') closePanel(); return; }
    const pan = 60 / cam.z;
    switch (e.code) {
      case 'KeyQ': rotate(-1); break;
      case 'KeyE': case 'KeyR': rotate(1); break;
      case 'Equal': case 'NumpadAdd': zoomBy(1.2); break;
      case 'Minus': case 'NumpadSubtract': zoomBy(1 / 1.2); break;
      case 'ArrowLeft': case 'KeyA': cam.tx -= pan; break;
      case 'ArrowRight': case 'KeyD': cam.tx += pan; break;
      case 'ArrowUp': case 'KeyW': cam.ty -= pan; break;
      case 'ArrowDown': case 'KeyS': cam.ty += pan; break;
      case 'KeyC': recenter(false); break;
      case 'Escape': case 'KeyM': showPanel('panel-help'); loadBoard(); break;
      default: return;
    }
    e.preventDefault();
  });

  $('rot-left').addEventListener('click', () => rotate(-1));
  $('rot-right').addEventListener('click', () => rotate(1));
  $('zoom-in').addEventListener('click', () => zoomBy(1.25));
  $('zoom-out').addEventListener('click', () => zoomBy(0.8));
  $('recenter').addEventListener('click', () => recenter(false));
  $('btn-mute').addEventListener('click', () => { Sound.init(); Sound.toggle(); updateHud(); });
  $('btn-menu').addEventListener('click', () => { showPanel('panel-help'); loadBoard(); });
  $('btn-close').addEventListener('click', () => { Sound.init(); closePanel(); });
  $('btn-new').addEventListener('click', () => { newGame(); closePanel(); });
  $('btn-again').addEventListener('click', () => { newGame(); closePanel(); });
  $('btn-look').addEventListener('click', closePanel);
  $('name').value = store.get('valley.name', '');
  $('name').addEventListener('input', () => store.set('valley.name', $('name').value));
  window.addEventListener('pagehide', save);

  // ───────────── Boot ─────────────
  $('lang-slot').replaceWith(GameNav.home('lang-toggle'), I18n.toggle('lang-toggle'));
  const meta = document.querySelector('meta[name=description]');
  if (meta) meta.content = t(meta.content);
  resize();
  G = load();
  if (G) { recenter(true); renderHand(); renderQuests(); updateHud(); } else newGame();
  if (G.over) $('btn-close').textContent = t('Смотреть карту');
  if (!store.get('valley.seenHelp')) { store.set('valley.seenHelp', '1'); showPanel('panel-help'); loadBoard(); }

  let last = performance.now(), questTick = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const k = 1 - Math.exp(-dt * 8);
    cam.x += (cam.tx - cam.x) * k; cam.y += (cam.ty - cam.y) * k; cam.z += (cam.tz - cam.z) * k;
    if (Math.abs(fx.rotAnim) > 0.001) {
      fx.rotAnim *= Math.exp(-dt * 16);
      if (Math.abs(fx.rotAnim) < 0.01) fx.rotAnim = 0;
      drawPreview('tile-now', G.stack[0], fx.rotAnim);
    }
    if ((questTick += dt) > 1) { questTick = 0; renderQuests(); }
    Sound.tick(dt);
    render(now, dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
