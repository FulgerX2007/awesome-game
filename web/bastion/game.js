'use strict';
// Бастион — drawing, input, sound and saves. Rules live in core.js (window.BastionCore).
(() => {
  const C = window.BastionCore;
  const { t } = window.I18n;
  const SAVE_KEY = 'bastion.run';
  const BEST_KEY = 'bastion.best';
  const MUTE_KEY = 'bastion.mute';
  const NAME_KEY = 'bastion.name';
  const BOARD_URL = '/api/boards/bastion/scores';
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const fmt = new Intl.NumberFormat(window.I18n.locale);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };

  const TOWER_INFO = {
    archer: 'Быстрые выстрелы по одной цели. Достают и летунов.',
    cannon: 'Ядро бьёт по площади. Летунов не достаёт.',
    frost: 'Слабый урон, зато замедляет врагов вокруг цели.',
    storm: 'Молния перескакивает между врагами и пробивает броню.',
  };
  const DIFFICULTY = ['лёгкая', 'средняя', 'трудная'];
  const PALETTES = [
    { grass: ['#4f7d34', '#56863a'], tuft: '#6fa047', road: '#c9a46a', edge: '#8f6f3f', pebble: '#a88552', deco: ['#f2e15c', '#f4f4f4', '#e46a8c'] },
    { grass: ['#9a7a45', '#a3834c'], tuft: '#b8975c', road: '#e3c48e', edge: '#7a5a30', pebble: '#c7a46e', deco: ['#7e6a50', '#6a5a44', '#8d7a5c'] },
    { grass: ['#3c6638', '#426e3d'], tuft: '#558a4a', road: '#9e9a8c', edge: '#5c5a52', pebble: '#86837a', deco: ['#7b7b74', '#d9d36a', '#b6b6ad'] },
  ];

  // ───────────── Sound ─────────────
  const Sound = (() => {
    let ac = null, master = null, muted = !!store.get(MUTE_KEY);
    const last = {};
    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.45; master.connect(ac.destination);
    }
    // At ×3 speed dozens of towers fire per second; one sound per kind per gap is plenty.
    const gate = (k, gap) => { const now = performance.now(); if (now - (last[k] || 0) < gap) return false; last[k] = now; return true; };
    function tone(f, { at = 0, d = 0.2, vol = 0.1, type = 'sine', to = 0 } = {}) {
      if (!ac || muted) return;
      const now = ac.currentTime + at;
      const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, now);
      if (to) o.frequency.exponentialRampToValueAtTime(to, now + d);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d);
      o.connect(g); g.connect(master); o.start(now); o.stop(now + d + 0.05);
    }
    function noise({ d = 0.2, vol = 0.2, f = 1000, q = 1, type = 'bandpass' } = {}) {
      if (!ac || muted) return;
      const now = ac.currentTime, len = Math.ceil(ac.sampleRate * d);
      const buf = ac.createBuffer(1, len, ac.sampleRate), data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      const src = ac.createBufferSource(); src.buffer = buf;
      const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ac.createGain(); g.gain.value = vol;
      src.connect(fl); fl.connect(g); g.connect(master); src.start(now);
    }
    return {
      init,
      get muted() { return muted; },
      set muted(v) { muted = v; store.set(MUTE_KEY, v); },
      fire(kind) {
        if (!gate(kind, kind === 'archer' ? 90 : 140)) return;
        if (kind === 'archer') noise({ d: 0.06, vol: 0.12, f: 2600, q: 3 });
        else if (kind === 'cannon') noise({ d: 0.25, vol: 0.35, f: 180, type: 'lowpass' });
        else if (kind === 'frost') tone(1500, { d: 0.18, vol: 0.04, type: 'triangle', to: 2200 });
      },
      boom() { if (gate('boom', 120)) noise({ d: 0.35, vol: 0.3, f: 120, type: 'lowpass' }); },
      zap() { if (gate('zap', 120)) { tone(220, { d: 0.12, vol: 0.06, type: 'sawtooth', to: 1400 }); noise({ d: 0.1, vol: 0.08, f: 4000, q: 0.7 }); } },
      kill() { if (gate('kill', 70)) tone(520 + Math.random() * 200, { d: 0.09, vol: 0.05, type: 'square', to: 260 }); },
      leak() { if (gate('leak', 200)) tone(160, { d: 0.5, vol: 0.14, type: 'sawtooth', to: 90 }); },
      build() { tone(330, { d: 0.12, vol: 0.1, type: 'triangle' }); tone(495, { at: 0.07, d: 0.15, vol: 0.1, type: 'triangle' }); },
      upgrade() { [0, 4, 7].forEach((s, i) => tone(440 * 2 ** (s / 12), { at: i * 0.06, d: 0.18, vol: 0.08, type: 'triangle' })); },
      sell() { tone(700, { d: 0.12, vol: 0.07, type: 'triangle', to: 350 }); },
      deny() { tone(140, { d: 0.15, vol: 0.08, type: 'square' }); },
      horn() { tone(196, { d: 0.6, vol: 0.12, type: 'sawtooth' }); tone(294, { at: 0.12, d: 0.6, vol: 0.08, type: 'sawtooth' }); },
      cleared() { [0, 7, 12].forEach((s, i) => tone(523 * 2 ** (s / 12), { at: i * 0.09, d: 0.35, vol: 0.07, type: 'triangle' })); },
      win() { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(392 * 2 ** (s / 12), { at: i * 0.1, d: 0.9, vol: 0.09, type: 'triangle' })); },
      lose() { [0, -3, -7, -12].forEach((s, i) => tone(330 * 2 ** (s / 12), { at: i * 0.25, d: 0.6, vol: 0.1, type: 'sawtooth' })); },
    };
  })();

  // ───────────── Art (all in tile units: 1 = one tile) ─────────────
  function terrain(mapIdx, px, dpr) {
    const cv = document.createElement('canvas');
    cv.width = Math.round(px * C.COLS * dpr);
    cv.height = Math.round(px * C.ROWS * dpr);
    const g = cv.getContext('2d');
    g.setTransform(px * dpr, 0, 0, px * dpr, 0, 0);
    const pal = PALETTES[mapIdx], R = C.rng(77 + mapIdx), geo = C.geo(mapIdx);
    for (let y = 0; y < C.ROWS; y++) {
      for (let x = 0; x < C.COLS; x++) {
        g.fillStyle = pal.grass[(x + y) % 2];
        g.fillRect(x, y, 1.01, 1.01);
      }
    }
    g.strokeStyle = pal.tuft; g.lineWidth = 0.03; g.lineCap = 'round';
    for (let i = 0; i < 520; i++) {
      const x = R() * C.COLS, y = R() * C.ROWS;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 0.08, y - 0.1 - R() * 0.08); g.stroke();
    }
    // the road: a dark verge, then the surface, then pebbles
    const pts = geo.ground.pts;
    const road = (w, color) => {
      g.strokeStyle = color; g.lineWidth = w; g.lineJoin = 'round'; g.lineCap = 'square';
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
    };
    road(0.98, pal.edge);
    road(0.84, pal.road);
    g.fillStyle = pal.pebble;
    for (let d = 0; d < geo.ground.length; d += 0.35) {
      const p = C.pointAt(geo.ground, d);
      g.beginPath(); g.arc(p.x + (R() - 0.5) * 0.6, p.y + (R() - 0.5) * 0.6, 0.02 + R() * 0.03, 0, TAU); g.fill();
    }
    // flowers or stones on some grass tiles
    for (let y = 0; y < C.ROWS; y++) {
      for (let x = 0; x < C.COLS; x++) {
        if (geo.road.has(y * C.COLS + x) || R() > 0.35) continue;
        g.fillStyle = pal.deco[Math.floor(R() * pal.deco.length)];
        const n = 1 + Math.floor(R() * 3);
        for (let k = 0; k < n; k++) { g.beginPath(); g.arc(x + 0.15 + R() * 0.7, y + 0.15 + R() * 0.7, 0.035 + R() * 0.03, 0, TAU); g.fill(); }
      }
    }
    // entry cave and the castle at the end of the road
    const a = C.pointAt(geo.ground, 0.75);
    const grd = g.createRadialGradient(a.x, a.y, 0.05, a.x, a.y, 0.55);
    grd.addColorStop(0, '#120a1e'); grd.addColorStop(0.7, '#3a2350'); grd.addColorStop(1, 'rgba(58,35,80,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(a.x, a.y, 0.55, 0, TAU); g.fill();
    drawCastle(g, C.pointAt(geo.ground, geo.ground.length - 1.05));
    return cv;
  }
  function drawCastle(g, p) {
    const x = p.x, y = p.y;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x, y + 0.42, 0.62, 0.16, 0, 0, TAU); g.fill();
    g.fillStyle = '#b9b2a3'; g.fillRect(x - 0.5, y - 0.2, 1, 0.6);
    g.fillStyle = '#d2cbbb';
    for (const dx of [-0.55, 0.3]) { g.fillRect(x + dx, y - 0.5, 0.25, 0.9); for (let k = 0; k < 2; k++) g.fillRect(x + dx + k * 0.15, y - 0.6, 0.1, 0.1); }
    g.fillStyle = '#5b3b22'; g.beginPath(); g.arc(x, y + 0.25, 0.15, Math.PI, 0); g.fillRect(x - 0.15, y + 0.25, 0.3, 0.15); g.fill();
    g.strokeStyle = '#6b6252'; g.lineWidth = 0.03; g.beginPath(); g.moveTo(x - 0.42, y - 0.5); g.lineTo(x - 0.42, y - 0.95); g.stroke();
    g.fillStyle = '#e0533d'; g.beginPath(); g.moveTo(x - 0.42, y - 0.95); g.lineTo(x - 0.12, y - 0.86); g.lineTo(x - 0.42, y - 0.77); g.fill();
  }

  // A tower at its tile centre (cx, cy); kick is 0..1 right after a shot.
  function drawTower(g, type, lvl, cx, cy, angle, time, kick = 0) {
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(cx, cy + 0.3, 0.38, 0.12, 0, 0, TAU); g.fill();
    g.fillStyle = '#8b8478'; g.strokeStyle = '#5a554c'; g.lineWidth = 0.04;
    roundRect(g, cx - 0.36, cy - 0.33, 0.72, 0.66, 0.12); g.fill(); g.stroke();
    g.fillStyle = '#a49d90'; roundRect(g, cx - 0.3, cy - 0.33, 0.6, 0.12, 0.05); g.fill();
    g.save(); g.translate(cx, cy);
    if (type === 'archer') {
      g.fillStyle = '#9a6a3a'; g.beginPath(); g.arc(0, 0, 0.26, 0, TAU); g.fill();
      g.strokeStyle = '#6b4523'; g.lineWidth = 0.04; g.stroke();
      g.rotate(angle);
      g.strokeStyle = '#f1e6cf'; g.lineWidth = 0.045; g.beginPath(); g.arc(-0.02, 0, 0.18, -1.1, 1.1); g.stroke();
      g.strokeStyle = '#e8d7b0'; g.lineWidth = 0.015; g.beginPath(); g.moveTo(0.07, -0.16); g.lineTo(-0.06 - kick * 0.05, 0); g.lineTo(0.07, 0.16); g.stroke();
      if (kick < 0.5) { g.strokeStyle = '#3a2a1a'; g.lineWidth = 0.025; g.beginPath(); g.moveTo(-0.06, 0); g.lineTo(0.26, 0); g.stroke(); }
    } else if (type === 'cannon') {
      g.fillStyle = '#3b3b3e'; g.beginPath(); g.arc(0, 0, 0.24, 0, TAU); g.fill();
      g.rotate(angle);
      g.fillStyle = '#26262a'; roundRect(g, -0.05 - kick * 0.08, -0.09, 0.42, 0.18, 0.05); g.fill();
      g.fillStyle = '#55555b'; g.fillRect(0.3 - kick * 0.08, -0.1, 0.06, 0.2);
    } else if (type === 'frost') {
      const glow = 0.5 + 0.5 * Math.sin(time * 3 + cx);
      g.fillStyle = `rgba(143,214,255,${0.18 + glow * 0.15})`; g.beginPath(); g.arc(0, 0, 0.32, 0, TAU); g.fill();
      g.fillStyle = '#bfe9ff'; g.strokeStyle = '#4aa8de'; g.lineWidth = 0.03;
      g.beginPath(); g.moveTo(0, -0.3); g.lineTo(0.16, 0); g.lineTo(0, 0.24); g.lineTo(-0.16, 0); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(0, -0.24); g.lineTo(0.06, -0.02); g.lineTo(-0.04, -0.02); g.fill();
    } else if (type === 'storm') {
      g.fillStyle = '#5a3f8c'; g.beginPath(); g.arc(0, 0, 0.24, 0, TAU); g.fill();
      g.strokeStyle = '#c9a26b'; g.lineWidth = 0.035;
      for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(0, 0.04 - k * 0.07, 0.17, 0.05, 0, 0, TAU); g.stroke(); }
      const pulse = 0.5 + 0.5 * Math.sin(time * 6 + cy);
      g.fillStyle = `rgba(227,212,255,${0.7 + pulse * 0.3})`; g.beginPath(); g.arc(0, -0.18, 0.09 + kick * 0.05, 0, TAU); g.fill();
      g.fillStyle = 'rgba(185,140,255,.35)'; g.beginPath(); g.arc(0, -0.18, 0.16 + pulse * 0.04, 0, TAU); g.fill();
    }
    g.restore();
    g.fillStyle = '#f2c14e';
    for (let k = 0; k <= lvl; k++) { g.beginPath(); g.arc(cx + (k - lvl / 2) * 0.13, cy + 0.26, 0.045, 0, TAU); g.fill(); }
  }

  function drawEnemy(g, type, x, y, time, opts = {}) {
    const def = C.ENEMIES[type], r = def.size;
    const air = !!def.air, lift = air ? 0.22 : 0;
    const bob = Math.sin(time * (type === 'runner' ? 18 : 10) + x * 3) * (air ? 0.04 : 0.02);
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(x, y + r * 0.75, r * (air ? 0.6 : 0.9), r * 0.28, 0, 0, TAU); g.fill();
    const cy = y - lift + bob;
    g.save(); g.translate(x, cy);
    g.lineWidth = 0.03;
    if (type === 'runner') {
      g.fillStyle = '#d6c84a'; g.strokeStyle = '#7d7220'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); g.stroke();
      eyes(g, r, '#1a1a1a');
    } else if (type === 'soldier') {
      g.fillStyle = '#c0412f'; g.strokeStyle = '#6d2116'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#9aa0a6'; g.beginPath(); g.arc(0, -r * 0.15, r * 0.82, Math.PI, 0); g.fill();
      eyes(g, r, '#fff');
    } else if (type === 'knight') {
      g.fillStyle = '#8d949c'; g.strokeStyle = '#4d535a'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#b8bec5'; g.beginPath(); g.arc(-r * 0.2, -r * 0.25, r * 0.45, 0, TAU); g.fill();
      g.strokeStyle = '#2a2e33'; g.lineWidth = 0.04; g.beginPath(); g.moveTo(-r * 0.5, -r * 0.05); g.lineTo(r * 0.5, -r * 0.05); g.stroke();
      g.fillStyle = '#3d5fa8'; roundRect(g, r * 0.45, -r * 0.1, r * 0.55, r * 0.75, 0.04); g.fill();
    } else if (type === 'bat') {
      const flap = Math.sin(time * 16 + x * 5);
      g.fillStyle = '#5b3f8c';
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(s * r * 0.3, 0); g.lineTo(s * r * 1.6, -r * (0.2 + flap * 0.7)); g.lineTo(s * r * 1.2, r * 0.3); g.lineTo(s * r * 0.8, r * 0.1); g.closePath(); g.fill();
      }
      g.fillStyle = '#3d2860'; g.beginPath(); g.arc(0, 0, r * 0.6, 0, TAU); g.fill();
      eyes(g, r * 0.7, '#ff6b6b');
    } else if (type === 'ogre') {
      g.fillStyle = '#6b8f3a'; g.strokeStyle = '#3d5520'; g.lineWidth = 0.05; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#f4ecd8';
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * r * 0.3, r * 0.3); g.lineTo(s * r * 0.4, r * 0.05); g.lineTo(s * r * 0.18, r * 0.25); g.fill(); }
      eyes(g, r, '#1a1a1a');
      g.fillStyle = '#6b4523'; g.save(); g.rotate(-0.6 + Math.sin(time * 4) * 0.2); roundRect(g, r * 0.7, -r * 0.2, r * 0.9, r * 0.3, 0.06); g.fill(); g.restore();
    }
    if (opts.slow) { g.strokeStyle = 'rgba(143,214,255,.9)'; g.lineWidth = 0.05; g.beginPath(); g.arc(0, 0, r + 0.05, 0, TAU); g.stroke(); }
    g.restore();
    if (opts.hp !== undefined && opts.hp < 1) {
      const w = Math.max(0.5, r * 2.2), top = cy - r - 0.16;
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x - w / 2 - 0.02, top - 0.02, w + 0.04, 0.1);
      g.fillStyle = opts.hp > 0.5 ? '#7cc35a' : opts.hp > 0.25 ? '#f2c14e' : '#e0533d';
      g.fillRect(x - w / 2, top, w * Math.max(0, opts.hp), 0.06);
    }
  }
  function eyes(g, r, color) {
    g.fillStyle = color;
    for (const s of [-1, 1]) { g.beginPath(); g.arc(s * r * 0.32, -r * 0.05, Math.max(0.025, r * 0.13), 0, TAU); g.fill(); }
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  // A small square icon canvas (palette, wave preview).
  function icon(draw, css) {
    const cv = document.createElement('canvas'), d = window.devicePixelRatio || 1;
    cv.width = cv.height = Math.round(css * d);
    const g = cv.getContext('2d');
    g.setTransform(css * d, 0, 0, css * d, 0, 0);
    draw(g);
    return cv;
  }

  // ───────────── State ─────────────
  let s = null;              // the battle, see core.js
  let mapIdx = 0;
  let speed = 1, paused = false;
  let buildType = null;      // tower type picked in the palette
  let selId = 0;             // selected tower id
  let hover = null;          // tile under the mouse
  let pending = null;        // touch: tile awaiting a second tap
  let fx = [];               // short-lived effects, in real seconds
  const fired = new Map();   // tower id → time of last shot, for the recoil
  let anim = 0, acc = 0, lastNow = 0;
  let bg = null, bgKey = '', px = 40, dpr = 1;
  let uiKey = '', infoKey = '';

  const cv = $('board'), ctx = cv.getContext('2d');
  const selected = () => (s && selId ? s.towers.find((tw) => tw.id === selId) || null : null);
  const best = () => store.get(BEST_KEY) || {};
  const saveRun = () => { if (s && s.phase === 'build') store.set(SAVE_KEY, C.snapshot(s)); };

  // ───────────── Menu ─────────────
  function stars(n) {
    const el = document.createElement('span');
    el.className = 'stars-line';
    el.setAttribute('aria-label', t('Звёзды: {n} из 3', { n }));
    for (let i = 0; i < 3; i++) {
      const st = document.createElement('span');
      st.textContent = '★';
      if (i >= n) st.className = 'off';
      el.appendChild(st);
    }
    return el;
  }
  function showMenu() {
    s = null;
    $('end').hidden = true;
    $('game').hidden = true;
    $('menu').hidden = false;
    const root = $('maps');
    root.textContent = '';
    const b = best();
    C.MAPS.forEach((m, i) => {
      const card = document.createElement('button');
      card.className = 'map-card';
      const preview = document.createElement('canvas');
      const title = document.createElement('div');
      title.className = 'title';
      const name = document.createElement('b');
      name.textContent = t(m.name);
      title.append(name, stars(b[m.id] ? b[m.id].stars : 0));
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = t('Сложность: {d}', { d: t(DIFFICULTY[i]) }) + (b[m.id] ? ` · ${t('рекорд: {n}', { n: fmt.format(b[m.id].score) })}` : '');
      card.append(preview, title, meta);
      card.addEventListener('click', () => startBattle(i));
      root.appendChild(card);
      requestAnimationFrame(() => {
        const w = preview.clientWidth || 260, d = window.devicePixelRatio || 1;
        const tile = w / C.COLS;
        preview.width = Math.round(w * d); preview.height = Math.round(w * 10 / 16 * d);
        preview.getContext('2d').drawImage(terrain(i, tile, d), 0, 0);
      });
    });
    const run = store.get(SAVE_KEY);
    $('resume').hidden = !run;
    if (run) $('resume-text').textContent = t('Незаконченная битва: {map}, впереди волна {n}', { map: t(C.MAPS[run.map].name), n: run.wave + 1 });
  }

  // ───────────── Battle ─────────────
  function startBattle(i, snap) {
    Sound.init();
    mapIdx = i;
    s = snap ? C.restore(snap) : C.newGame(i);
    if (!snap) store.del(SAVE_KEY);
    buildType = null; selId = 0; hover = null; pending = null; fx = []; fired.clear();
    paused = false; acc = 0; uiKey = ''; infoKey = '';
    $('menu').hidden = true;
    $('end').hidden = true;
    $('game').hidden = false;
    buildPalette();
    resize();
    saveRun();
    renderUI(true);
  }

  function resize() {
    const w = $('field').clientWidth;
    if (!w) return;
    dpr = window.devicePixelRatio || 1;
    px = w / C.COLS;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(px * C.ROWS * dpr);
    const key = `${mapIdx}:${cv.width}`;
    if (key !== bgKey) { bg = terrain(mapIdx, px, dpr); bgKey = key; }
  }

  function callWave() {
    if (!s || !C.canCall(s)) { Sound.deny(); return; }
    Sound.init();
    if (s.phase === 'build') saveRun();
    const bonus = C.callWave(s);
    Sound.horn();
    banner(bonus ? t('Волна {n} · +{g} золота', { n: s.wave, g: bonus }) : t('Волна {n}', { n: s.wave }));
    if (paused) togglePause();
    renderUI(true);
  }

  function banner(text) {
    const b = $('banner');
    b.hidden = true;
    void b.offsetWidth; // restart the animation
    b.textContent = text;
    b.hidden = false;
    clearTimeout(banner.timer);
    banner.timer = setTimeout(() => { b.hidden = true; }, 1900);
  }

  function handle(events) {
    for (const e of events) {
      switch (e.type) {
        case 'fire': fired.set(e.tower, anim); Sound.fire(e.kind); break;
        case 'zap':
          fired.set(e.tower, anim); Sound.zap();
          fx.push({ type: 'zap', pts: jag(e.pts), t: 0, life: 0.18 });
          break;
        case 'boom': Sound.boom(); fx.push({ type: 'ring', x: e.x, y: e.y, r: e.r, color: '255,170,80', t: 0, life: 0.35 }); break;
        case 'frost': fx.push({ type: 'ring', x: e.x, y: e.y, r: e.r, color: '143,214,255', t: 0, life: 0.4 }); break;
        case 'hit': fx.push({ type: 'spark', x: e.x, y: e.y, t: 0, life: 0.15 }); break;
        case 'kill':
          Sound.kill();
          fx.push({ type: 'puff', x: e.x, y: e.y, t: 0, life: 0.35 });
          fx.push({ type: 'text', x: e.x, y: e.y - 0.3, text: `+${e.gold}`, color: '#f2c14e', t: 0, life: 0.9 });
          break;
        case 'leak': {
          Sound.leak();
          const p = C.pointAt(C.geo(mapIdx).ground, C.geo(mapIdx).ground.length - 1.05);
          fx.push({ type: 'text', x: p.x, y: p.y - 0.8, text: `−${e.lives}`, color: '#e0533d', t: 0, life: 1.1 });
          const st = $('hud-lives').parentNode;
          st.classList.add('flash');
          setTimeout(() => st.classList.remove('flash'), 450);
          break;
        }
        case 'cleared':
          Sound.cleared();
          banner(t('Волна {n} отбита · +{g} золота', { n: e.wave, g: e.gold }));
          break;
        case 'won': case 'lost': setTimeout(endBattle, 900); break;
        default: break;
      }
    }
    if (s && s.phase === 'build') saveRun();
  }
  // Lightning as a zigzag between the hit points.
  function jag(pts) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      for (let k = 1; k <= 4; k++) {
        const f = k / 5;
        out.push({ x: a.x + (b.x - a.x) * f + (Math.random() - 0.5) * 0.25, y: a.y + (b.y - a.y) * f + (Math.random() - 0.5) * 0.25 });
      }
      out.push(b);
    }
    return out;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const real = Math.min(0.1, (now - (lastNow || now)) / 1000);
    lastNow = now;
    if (!s || $('game').hidden) return;
    if (!paused) anim += real;
    if (s.phase === 'wave' && !paused) {
      acc += real * speed;
      let n = 0;
      while (acc >= C.DT && n < 60) { handle(C.step(s)); acc -= C.DT; n++; }
      if (n >= 60) acc = 0;
    }
    if (!paused) {
      for (const f of fx) f.t += real;
      fx = fx.filter((f) => f.t < f.life);
    }
    draw();
    renderUI();
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (bg) ctx.drawImage(bg, 0, 0);
    ctx.setTransform(px * dpr, 0, 0, px * dpr, 0, 0);
    const sel = selected();
    // placement preview
    const tile = pending || hover;
    if (buildType && tile) {
      const ok = C.canBuild(s, tile.x, tile.y) && s.gold >= C.TOWERS[buildType].cost[0];
      ctx.fillStyle = ok ? 'rgba(124,195,90,.35)' : 'rgba(224,83,61,.4)';
      ctx.fillRect(tile.x, tile.y, 1, 1);
      if (C.canBuild(s, tile.x, tile.y)) rangeRing(tile.x + 0.5, tile.y + 0.5, C.stats(buildType, 0).range, ok);
    }
    if (sel) rangeRing(sel.x + 0.5, sel.y + 0.5, C.stats(sel.type, sel.lvl).range, true);
    // things lower on the board are drawn later, so they overlap the ones behind
    const items = [];
    for (const tw of s.towers) items.push({ y: tw.y + 0.5, draw: () => drawTower(ctx, tw.type, tw.lvl, tw.x + 0.5, tw.y + 0.5, tw.angle, anim, kick(tw.id)) });
    for (const e of s.enemies) items.push({ y: e.y + (e.air ? 1 : 0), draw: () => drawEnemy(ctx, e.type, e.x, e.y, anim, { hp: e.hp / e.max, slow: e.slow > 0 }) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    if (sel) {
      ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 0.05;
      roundRect(ctx, sel.x + 0.08, sel.y + 0.1, 0.84, 0.8, 0.12); ctx.stroke();
    }
    for (const sh of s.shots) drawShot(sh);
    for (const f of fx) drawFx(f);
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, C.COLS, C.ROWS);
      text(t('Пауза'), C.COLS / 2, C.ROWS / 2, '#fff', 0.9);
    }
  }
  const kick = (id) => { const at = fired.get(id); return at === undefined ? 1 : Math.min(1, (anim - at) / 0.25); };
  function rangeRing(x, y, r, ok) {
    ctx.fillStyle = ok ? 'rgba(255,255,255,.08)' : 'rgba(224,83,61,.08)';
    ctx.strokeStyle = ok ? 'rgba(255,255,255,.5)' : 'rgba(224,83,61,.6)';
    ctx.lineWidth = 0.03;
    ctx.setLineDash([0.12, 0.08]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
  }
  function drawShot(sh) {
    const a = Math.atan2(sh.ty - sh.y, sh.tx - sh.x);
    ctx.save(); ctx.translate(sh.x, sh.y); ctx.rotate(a);
    if (sh.type === 'archer') {
      ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 0.03; ctx.beginPath(); ctx.moveTo(-0.18, 0); ctx.lineTo(0.08, 0); ctx.stroke();
      ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.moveTo(0.12, 0); ctx.lineTo(0.05, -0.03); ctx.lineTo(0.05, 0.03); ctx.fill();
    } else if (sh.type === 'cannon') {
      ctx.fillStyle = '#1d1d20'; ctx.beginPath(); ctx.arc(0, 0, 0.08, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = '#d8f2ff'; ctx.beginPath(); ctx.moveTo(0.1, 0); ctx.lineTo(0, -0.05); ctx.lineTo(-0.1, 0); ctx.lineTo(0, 0.05); ctx.fill();
    }
    ctx.restore();
  }
  function drawFx(f) {
    const k = f.t / f.life;
    if (f.type === 'ring') {
      ctx.strokeStyle = `rgba(${f.color},${1 - k})`; ctx.lineWidth = 0.08 * (1 - k) + 0.02;
      ctx.fillStyle = `rgba(${f.color},${0.25 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + 0.6 * k), 0, TAU); ctx.fill(); ctx.stroke();
    } else if (f.type === 'zap') {
      ctx.lineJoin = 'round';
      for (const [w, c] of [[0.14, `rgba(185,140,255,${0.5 * (1 - k)})`], [0.04, `rgba(255,255,255,${1 - k})`]]) {
        ctx.strokeStyle = c; ctx.lineWidth = w;
        ctx.beginPath(); f.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
      }
    } else if (f.type === 'spark') {
      ctx.fillStyle = `rgba(255,240,200,${1 - k})`; ctx.beginPath(); ctx.arc(f.x, f.y, 0.08 * (1 - k) + 0.02, 0, TAU); ctx.fill();
    } else if (f.type === 'puff') {
      ctx.fillStyle = `rgba(230,220,200,${0.5 * (1 - k)})`;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * k * 0.3, f.y + Math.sin(a) * k * 0.3, 0.09 * (1 - k * 0.5), 0, TAU); ctx.fill();
      }
    } else if (f.type === 'text') {
      ctx.globalAlpha = 1 - k * k;
      text(f.text, f.x, f.y - k * 0.5, f.color, 0.34);
      ctx.globalAlpha = 1;
    }
  }
  // Text is drawn in pixel space: tiny font sizes under a big scale render badly.
  function text(str, x, y, color, size) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `800 ${Math.round(size * px)}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, size * px * 0.18); ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.strokeText(str, x * px, y * px);
    ctx.fillStyle = color; ctx.fillText(str, x * px, y * px);
    ctx.restore();
  }

  // ───────────── Side panel ─────────────
  function buildPalette() {
    const root = $('palette');
    root.textContent = '';
    C.TOWER_TYPES.forEach((type, i) => {
      const b = document.createElement('button');
      b.className = 'tower-btn';
      b.dataset.type = type;
      b.title = `${t(C.TOWERS[type].name)} (${i + 1})`;
      b.setAttribute('aria-pressed', 'false');
      const hot = document.createElement('span');
      hot.className = 'hot'; hot.textContent = String(i + 1);
      const name = document.createElement('span');
      name.textContent = t(C.TOWERS[type].name);
      const cost = document.createElement('span');
      cost.className = 'cost'; cost.textContent = String(C.TOWERS[type].cost[0]);
      b.append(hot, icon((g) => drawTower(g, type, 0, 0.5, 0.48, -Math.PI / 4, 0), 40), name, cost);
      b.addEventListener('click', () => pickType(type));
      root.appendChild(b);
    });
  }
  function pickType(type) {
    Sound.init();
    buildType = buildType === type ? null : type;
    selId = 0; pending = null;
    renderUI(true);
  }

  // Redraws the HUD and panel only when something they show changed.
  function renderUI(force) {
    if (!s) return;
    const sel = selected();
    const key = [s.gold, s.lives, s.score, s.wave, s.phase, C.canCall(s), buildType, sel && sel.id, sel && sel.lvl, speed, paused].join('|');
    if (!force && key === uiKey) return;
    uiKey = key;
    $('hud-wave').textContent = `${s.wave}/${C.WAVES}`;
    $('hud-gold').textContent = fmt.format(s.gold);
    $('hud-lives').textContent = String(s.lives);
    $('hud-score').textContent = fmt.format(s.score);
    $('btn-speed').textContent = `×${speed}`;
    $('btn-pause').textContent = paused ? t('Дальше') : t('Пауза');
    for (const b of $('palette').children) {
      const type = b.dataset.type;
      b.setAttribute('aria-pressed', String(buildType === type));
      b.classList.toggle('poor', s.gold < C.TOWERS[type].cost[0]);
    }
    const wb = $('btn-wave');
    if (s.phase === 'build') { wb.textContent = t('Начать волну {n}', { n: s.wave + 1 }); wb.disabled = false; }
    else if (s.wave >= C.WAVES) { wb.textContent = t('Последняя волна'); wb.disabled = true; }
    else if (C.canCall(s)) { wb.textContent = t('Волна {n} раньше: +{g}', { n: s.wave + 1, g: C.callBonus(s.wave + 1) }); wb.disabled = s.phase !== 'wave'; }
    else { wb.textContent = t('Идёт волна {n}', { n: s.wave }); wb.disabled = true; }
    // The panel holds buttons: rebuild it only when what it shows changes, not on every coin, or clicks get lost.
    const over = s.phase === 'won' || s.phase === 'lost';
    const ik = sel ? `t${sel.id}:${sel.lvl}:${C.upgradeCost(sel) !== null && s.gold >= C.upgradeCost(sel)}:${over}`
      : buildType ? `b${buildType}` : `w${s.wave}:${s.towers.length > 0}`;
    if (force || ik !== infoKey) { infoKey = ik; renderInfo(sel); }
  }

  function renderInfo(sel) {
    const root = $('info');
    root.textContent = '';
    const h = (txt, small) => {
      const el = document.createElement('h3');
      el.textContent = txt;
      if (small) el.appendChild(Object.assign(document.createElement('small'), { textContent: small }));
      root.appendChild(el);
    };
    const para = (txt) => root.appendChild(Object.assign(document.createElement('p'), { textContent: txt }));
    const nums = (type, lvl) => {
      const st = C.stats(type, lvl), el = document.createElement('div');
      el.className = 'nums';
      const add = (label, val) => {
        const sp = document.createElement('span');
        sp.textContent = `${label} `;
        sp.appendChild(Object.assign(document.createElement('b'), { textContent: val }));
        el.appendChild(sp);
      };
      add(t('урон'), String(st.dmg));
      add(t('выстр./с'), st.rate.toFixed(2).replace(/0$/, ''));
      add(t('радиус'), st.range.toFixed(1));
      if (st.slow) add(t('замедление'), `${Math.round(st.slow * 100)}%`);
      if (st.chain) add(t('целей'), `×${st.chain}`);
      if (!st.air) add(t('летуны'), t('нет'));
      root.appendChild(el);
    };
    if (sel) {
      h(t(C.TOWERS[sel.type].name), t('уровень {n}', { n: sel.lvl + 1 }));
      nums(sel.type, sel.lvl);
      const acts = document.createElement('div');
      acts.className = 'acts';
      const cost = C.upgradeCost(sel);
      const up = document.createElement('button');
      up.className = 'btn primary';
      up.title = 'U';
      up.textContent = cost === null ? t('Максимум') : t('Улучшить: {c}', { c: cost });
      up.disabled = cost === null || s.gold < cost || s.phase === 'won' || s.phase === 'lost';
      up.addEventListener('click', upgradeSel);
      const sell = document.createElement('button');
      sell.className = 'btn';
      sell.title = 'S';
      sell.textContent = t('Продать: +{v}', { v: C.sellValue(sel) });
      sell.disabled = s.phase === 'won' || s.phase === 'lost';
      sell.addEventListener('click', sellSel);
      acts.append(up, sell);
      root.appendChild(acts);
      if (cost !== null) {
        const nx = C.stats(sel.type, sel.lvl + 1);
        para(t('Дальше: урон {d}, радиус {r}', { d: nx.dmg, r: nx.range.toFixed(1) }));
      }
      return;
    }
    if (buildType) {
      h(t(C.TOWERS[buildType].name), t('цена {c}', { c: C.TOWERS[buildType].cost[0] }));
      nums(buildType, 0);
      para(`${t(TOWER_INFO[buildType])} ${t('Нажми на свободную клетку травы.')}`);
      return;
    }
    if (s.wave >= C.WAVES) { h(t('Последняя волна')); para(t('Продержись, пока не падёт последний враг!')); return; }
    const next = s.wave + 1, list = C.waveList(mapIdx, next), counts = {};
    for (const e of list) counts[e.type] = (counts[e.type] || 0) + 1;
    h(t('Впереди волна {n}', { n: next }), next % 10 === 0 ? t('с огром!') : '');
    const foes = document.createElement('div');
    foes.className = 'foes';
    for (const [type, n] of Object.entries(counts)) {
      const sp = document.createElement('span');
      sp.title = t(C.ENEMIES[type].name);
      sp.append(icon((g) => drawEnemy(g, type, 0.5, C.ENEMIES[type].air ? 0.6 : 0.5, 0), 22), `${t(C.ENEMIES[type].name)} ×${n}`);
      foes.appendChild(sp);
    }
    root.appendChild(foes);
    if (!s.towers.length) para(t('Выбери башню внизу и поставь её у дороги.'));
  }

  function upgradeSel() {
    const sel = selected();
    if (!sel) return;
    if (C.upgrade(s, sel)) { Sound.upgrade(); fx.push({ type: 'ring', x: sel.x + 0.5, y: sel.y + 0.5, r: 0.6, color: '242,193,78', t: 0, life: 0.4 }); saveRun(); }
    else Sound.deny();
    renderUI(true);
  }
  function sellSel() {
    const sel = selected();
    if (!sel) return;
    const v = C.sell(s, sel);
    Sound.sell();
    fx.push({ type: 'text', x: sel.x + 0.5, y: sel.y, text: `+${v}`, color: '#f2c14e', t: 0, life: 0.9 });
    selId = 0;
    saveRun();
    renderUI(true);
  }

  function togglePause() {
    if (!s) return;
    paused = !paused;
    renderUI(true);
  }

  // ───────────── Board input ─────────────
  function tileAt(e) {
    const r = cv.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * C.COLS), y = Math.floor(((e.clientY - r.top) / r.height) * C.ROWS);
    return x >= 0 && y >= 0 && x < C.COLS && y < C.ROWS ? { x, y } : null;
  }
  let lastPointer = 'mouse';
  cv.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; });
  cv.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') hover = tileAt(e); });
  cv.addEventListener('pointerleave', () => { hover = null; });
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); buildType = null; selId = 0; pending = null; renderUI(true); });
  cv.addEventListener('click', (e) => {
    if (!s || s.phase === 'won' || s.phase === 'lost') return;
    Sound.init();
    const tile = tileAt(e);
    if (!tile) return;
    const tw = C.towerAt(s, tile.x, tile.y);
    if (tw) { selId = selId === tw.id ? 0 : tw.id; buildType = null; pending = null; renderUI(true); return; }
    if (!buildType) { selId = 0; renderUI(true); return; }
    if (!C.canBuild(s, tile.x, tile.y)) { Sound.deny(); pending = null; return; }
    // On touch there is no hover: the first tap shows the range, the second one builds.
    if (lastPointer !== 'mouse' && (!pending || pending.x !== tile.x || pending.y !== tile.y)) { pending = tile; return; }
    pending = null;
    const built = C.build(s, buildType, tile.x, tile.y);
    if (!built) {
      Sound.deny();
      const st = $('hud-gold').parentNode;
      st.classList.add('flash');
      setTimeout(() => st.classList.remove('flash'), 450);
      return;
    }
    Sound.build();
    fx.push({ type: 'puff', x: tile.x + 0.5, y: tile.y + 0.6, t: 0, life: 0.35 });
    if (s.gold < C.TOWERS[buildType].cost[0]) buildType = null;
    saveRun();
    renderUI(true);
  });

  // ───────────── End of battle ─────────────
  function endBattle() {
    if (!s || (s.phase !== 'won' && s.phase !== 'lost')) return;
    const won = s.phase === 'won', st = C.starsFor(s), m = C.MAPS[mapIdx];
    won ? Sound.win() : Sound.lose();
    store.del(SAVE_KEY);
    const b = best(), prev = b[m.id] || { stars: 0, score: 0, wave: 0 };
    b[m.id] = { stars: Math.max(prev.stars, st), score: Math.max(prev.score, s.score), wave: Math.max(prev.wave, s.wave) };
    store.set(BEST_KEY, b);
    $('end-title').textContent = won ? t('Победа!') : t('Замок пал');
    const starsEl = $('end-stars');
    starsEl.textContent = '';
    for (let i = 0; i < 3; i++) starsEl.appendChild(Object.assign(document.createElement('span'), { textContent: '★', className: i < st ? '' : 'off' }));
    starsEl.hidden = !won;
    const dl = $('end-stats');
    dl.textContent = '';
    const row = (k, v) => { dl.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v })); };
    row(t('Карта'), t(m.name));
    row(t('Волна'), `${s.wave}/${C.WAVES}`);
    row(t('Жизни'), String(s.lives));
    row(t('Враги повержены'), fmt.format(s.kills));
    row(t('Очки'), fmt.format(s.score));
    $('end-board').textContent = s.score > prev.score && prev.score > 0 ? t('Новый рекорд карты!') : '';
    $('submit-form').hidden = s.score <= 0;
    $('btn-submit').disabled = false;
    $('name').value = store.get(NAME_KEY) || '';
    $('end').hidden = false;
    $('btn-again').focus();
  }

  $('submit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!s) return;
    const name = ($('name').value.trim() || t('Аноним')).slice(0, 16);
    store.set(NAME_KEY, $('name').value.trim());
    $('btn-submit').disabled = true;
    try {
      const res = await fetch(BOARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, score: s.score, level: Math.max(1, s.wave) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { rank } = await res.json();
      $('end-board').textContent = rank ? t('Место в таблице рекордов: {n}', { n: rank }) : t('В таблицу рекордов не хватило очков.');
    } catch {
      $('end-board').textContent = t('Таблица рекордов сейчас недоступна.');
      $('btn-submit').disabled = false;
    }
  });

  // ───────────── Wiring ─────────────
  $('btn-wave').addEventListener('click', callWave);
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-speed').addEventListener('click', () => { speed = speed % 3 + 1; renderUI(true); });
  $('btn-menu').addEventListener('click', () => { saveRun(); showMenu(); });
  $('btn-resume').addEventListener('click', () => {
    const run = store.get(SAVE_KEY);
    if (run && run.v === 1 && C.MAPS[run.map]) startBattle(run.map, run);
    else { store.del(SAVE_KEY); showMenu(); }
  });
  $('btn-again').addEventListener('click', () => startBattle(mapIdx));
  $('btn-end-menu').addEventListener('click', showMenu);
  $('btn-sound').addEventListener('click', () => { Sound.init(); Sound.muted = !Sound.muted; renderSound(); });
  function renderSound() {
    $('btn-sound').textContent = Sound.muted ? t('Звук: выкл') : t('Звук: вкл');
    $('btn-sound').setAttribute('aria-pressed', String(!Sound.muted));
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !s || $('game').hidden || !$('end').hidden) return;
    if (e.target.closest('input')) return;
    const digit = /^Digit([1-4])$/.exec(e.code);
    if (digit) { pickType(C.TOWER_TYPES[Number(digit[1]) - 1]); return; }
    switch (e.code) {
      case 'Space': e.preventDefault(); callWave(); break;
      case 'KeyU': upgradeSel(); break;
      case 'KeyS': sellSel(); break;
      case 'KeyF': speed = speed % 3 + 1; renderUI(true); break;
      case 'KeyP': togglePause(); break;
      case 'Escape': buildType = null; selId = 0; pending = null; renderUI(true); break;
      default: break;
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && s && s.phase === 'wave' && !paused) togglePause();
  });
  window.addEventListener('resize', () => { if (s) resize(); });

  const actions = $('top-actions');
  actions.appendChild(window.I18n.toggle('chip'));
  if (window.GameNav) actions.appendChild(window.GameNav.home('chip'));
  renderSound();
  showMenu();
  requestAnimationFrame(frame);
})();
