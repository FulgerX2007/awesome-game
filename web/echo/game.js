'use strict';
// ЭХО — a stealth game played by echolocation.
// Everything (graphics, sound, levels) is generated at runtime; no assets, no dependencies.
(() => {
  const TILE = 32;
  const PULSE_SPEED = 560;   // px/s, how fast the echo ring expands
  const ECHO_LIFE = 2.4;     // s, how long a revealed wall point stays lit
  const GHOST_LIFE = 1.8;    // s, how long a revealed hunter silhouette lingers
  const LIGHT_R = 82;        // px, the player's tiny personal awareness radius
  const SENSE_R = TILE * 2.4;
  const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, ZOOM = 1;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b));
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    ZOOM = clamp(Math.min(W, H) / 720, 0.6, 1.3);
  }
  window.addEventListener('resize', resize);
  resize();

  // ───────────────────────── Audio (pure WebAudio synthesis) ─────────────────────────
  const Sound = (() => {
    let ac = null, master, echoBus, drone;

    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.7; master.connect(ac.destination);

      // Feedback delay = the cave's echo.
      const delay = ac.createDelay(1); delay.delayTime.value = 0.23;
      const fb = ac.createGain(); fb.gain.value = 0.4;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000;
      echoBus = ac.createGain(); echoBus.gain.value = 0.6;
      echoBus.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(master);

      // Ambient drone.
      drone = ac.createGain(); drone.gain.value = 0.0001;
      const dlp = ac.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 260;
      for (const f of [55, 55.35, 82.4]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(dlp); o.start();
      }
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.06;
      const lg = ac.createGain(); lg.gain.value = 140; lfo.connect(lg); lg.connect(dlp.frequency); lfo.start();
      dlp.connect(drone); drone.connect(master);
      drone.gain.setTargetAtTime(0.05, ac.currentTime, 2);
    }

    function route(node, now, pan, echo) {
      let out = node;
      if (pan && ac.createStereoPanner) {
        const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); out = p;
      }
      out.connect(master);
      if (echo) { const e = ac.createGain(); e.gain.value = echo; out.connect(e); e.connect(echoBus); }
    }

    function envelope(g, now, a, peak, d) {
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(peak, now + a);
      g.gain.exponentialRampToValueAtTime(0.0001, now + a + d);
    }

    function tone({ type = 'sine', f0, f1, t = 0, a = 0.005, d = 0.3, vol = 0.3, echo = 0, pan = 0 }) {
      if (!ac) return;
      const now = ac.currentTime + t;
      const o = ac.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, now);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, now + a + d);
      const g = ac.createGain(); envelope(g, now, a, vol, d);
      o.connect(g); route(g, now, pan, echo);
      o.start(now); o.stop(now + a + d + 0.05);
    }

    function noise({ t = 0, d = 0.2, vol = 0.2, freq = 1000, q = 1, type = 'bandpass', pan = 0, echo = 0 }) {
      if (!ac) return;
      const now = ac.currentTime + t;
      const len = Math.ceil(ac.sampleRate * (d + 0.05));
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource(); src.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ac.createGain(); envelope(g, now, 0.005, vol, d);
      src.connect(f); f.connect(g); route(g, now, pan, echo);
      src.start(now);
    }

    return {
      init,
      ping(power) {
        tone({ f0: 1500 - power * 600, f1: 480 - power * 160, d: 0.22 + power * 0.5, vol: 0.22 + power * 0.18, echo: 0.9 });
        tone({ type: 'triangle', f0: 3200, f1: 1900, d: 0.07, vol: 0.05, echo: 0.5 });
      },
      crystal() { [0, 4, 7, 12].forEach((s, i) => tone({ type: 'triangle', f0: 660 * 2 ** (s / 12), t: i * 0.07, d: 0.6, vol: 0.12, echo: 0.6 })); },
      portal() { [0, 7, 12, 19, 24].forEach((s, i) => tone({ f0: 220 * 2 ** (s / 12), t: i * 0.12, a: 0.05, d: 1.3, vol: 0.1, echo: 0.7 })); },
      win() { [0, 5, 9, 12, 17, 21, 24].forEach((s, i) => tone({ type: 'triangle', f0: 330 * 2 ** (s / 12), t: i * 0.08, d: 0.9, vol: 0.1, echo: 0.8 })); },
      heartbeat(k) {
        tone({ f0: 72, f1: 40, d: 0.12, vol: 0.2 + 0.4 * k });
        tone({ f0: 66, f1: 38, t: 0.16, d: 0.15, vol: 0.14 + 0.3 * k });
      },
      growl(pan) {
        tone({ type: 'sawtooth', f0: 95, f1: 52, a: 0.08, d: 0.8, vol: 0.16, pan });
        noise({ d: 0.7, vol: 0.14, freq: 280, q: 2.5, pan });
      },
      step(pan = 0) { noise({ d: 0.05, vol: 0.06, freq: 1700, q: 0.8, pan }); },
      whoosh() { noise({ d: 0.18, vol: 0.05, freq: 3000, type: 'highpass' }); },
      clack(pan) {
        noise({ d: 0.08, vol: 0.35, freq: 2600, q: 3, pan, echo: 0.8 });
        tone({ type: 'square', f0: 950, f1: 420, d: 0.05, vol: 0.05, pan, echo: 0.5 });
      },
      death() {
        noise({ d: 1.3, vol: 0.45, freq: 220, q: 0.7, type: 'lowpass' });
        tone({ type: 'sawtooth', f0: 210, f1: 28, a: 0.02, d: 1.5, vol: 0.25 });
      },
      drone(v) { if (ac) drone.gain.setTargetAtTime(Math.max(v, 0.0001), ac.currentTime, 0.6); },
    };
  })();

  // ───────────────────────── Level generation ─────────────────────────
  let L = null; // current level

  const isWall = (tx, ty) => tx < 0 || ty < 0 || tx >= L.w || ty >= L.h || L.grid[ty * L.w + tx] === 1;
  const wallAt = (x, y) => isWall(Math.floor(x / TILE), Math.floor(y / TILE));
  const center = (i) => ({ x: (i % L.w) * TILE + TILE / 2, y: Math.floor(i / L.w) * TILE + TILE / 2 });

  function generateCave(w, h) {
    for (let attempt = 0; ; attempt++) {
      let g = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        g[y * w + x] = border || Math.random() < 0.46 ? 1 : 0;
      }
      const count = (src, x, y, r) => {
        let n = 0;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || src[ny * w + nx]) n++;
        }
        return n;
      };
      for (let it = 0; it < 6; it++) {
        const ng = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { ng[y * w + x] = 1; continue; }
          const n1 = count(g, x, y, 1);
          // Early passes also seed pillars inside large empty areas.
          ng[y * w + x] = n1 >= 5 || (it < 3 && count(g, x, y, 2) <= 2) ? 1 : 0;
        }
        g = ng;
      }
      // Keep only the largest connected open region.
      const region = new Int32Array(w * h).fill(-1);
      let best = -1, bestSize = 0;
      const stack = [];
      for (let i = 0; i < w * h; i++) {
        if (g[i] || region[i] >= 0) continue;
        let size = 0; stack.push(i); region[i] = i;
        while (stack.length) {
          const j = stack.pop(); size++;
          const x = j % w, y = (j / w) | 0;
          for (const [dx, dy] of DIRS8.slice(0, 4)) {
            const k = (y + dy) * w + (x + dx);
            if (!g[k] && region[k] < 0) { region[k] = i; stack.push(k); }
          }
        }
        if (size > bestSize) { bestSize = size; best = i; }
      }
      for (let i = 0; i < w * h; i++) if (!g[i] && region[i] !== best) g[i] = 1;
      if (bestSize >= w * h * 0.38 || attempt > 30) return g;
    }
  }

  // 8-way BFS without cutting corners. Returns tile distances (-1 = unreachable).
  function bfs(start) {
    const { w, h, grid } = L;
    const d = new Int16Array(w * h).fill(-1);
    if (grid[start]) return d;
    const q = new Int32Array(w * h);
    let head = 0, tail = 0;
    d[start] = 0; q[tail++] = start;
    while (head < tail) {
      const i = q[head++], x = i % w, y = (i / w) | 0, nd = d[i] + 1;
      for (const [ox, oy] of DIRS8) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (grid[j] || d[j] >= 0) continue;
        if (ox && oy && (grid[y * w + nx] || grid[ny * w + x])) continue;
        d[j] = nd; q[tail++] = j;
      }
    }
    return d;
  }

  function pickSpread(candidates, n, minSep, avoid) {
    const out = [];
    for (let sep = minSep; out.length < n && sep >= 1; sep -= 2) {
      for (const i of candidates) {
        if (out.length >= n) break;
        const p = center(i);
        const ok = out.concat(avoid).every((o) => dist(p.x, p.y, o.x, o.y) >= sep * TILE);
        if (ok) out.push(p);
      }
    }
    return out;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = randi(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function buildLevel(num) {
    const w = Math.min(38 + num * 5, 92), h = Math.min(27 + num * 3, 62);
    L = { num, w, h, grid: generateCave(w, h), seen: new Uint8Array(w * h) };
    L.open = [];
    for (let i = 0; i < w * h; i++) if (!L.grid[i]) L.open.push(i);

    // Start somewhere roomy.
    const roomy = L.open.filter((i) => DIRS8.every(([dx, dy]) => !L.grid[i + dy * w + dx]));
    const startIdx = (roomy.length ? roomy : L.open)[randi(0, (roomy.length ? roomy : L.open).length)];
    const fromStart = bfs(startIdx);
    let exitIdx = startIdx;
    for (const i of L.open) if (fromStart[i] > fromStart[exitIdx]) exitIdx = i;

    const start = center(startIdx);
    L.start = start;
    L.exit = { ...center(exitIdx), open: false, known: false, revealT: -99 };

    const crystalCount = Math.min(2 + num, 8);
    const far = shuffle(L.open.filter((i) => fromStart[i] >= 7));
    L.crystals = pickSpread(far, crystalCount, 8, [L.exit, start])
      .map((p) => ({ ...p, taken: false, known: false, revealT: -99, phase: rand(0, 6) }));

    const hunterCount = Math.min(num, 8);
    const remote = shuffle(L.open.filter((i) => fromStart[i] >= 15));
    const spawns = pickSpread(remote.length >= hunterCount ? remote : shuffle(far), hunterCount, 9, [start]);
    const speed = 1 + Math.min(num - 1, 10) * 0.03;
    L.hunters = spawns.map((p) => ({
      x: p.x, y: p.y, r: 11, state: 'wander', target: null, field: null, fieldFor: -1,
      repath: 0, linger: 0, lostT: 0, speed, growlCD: 0, eye: rand(0, 6),
    }));
    return L;
  }

  // ───────────────────────── Geometry ─────────────────────────
  // DDA grid traversal; returns the first wall hit within maxD or null.
  function castRay(ox, oy, dx, dy, maxD) {
    let mx = Math.floor(ox / TILE), my = Math.floor(oy / TILE);
    const stepX = dx < 0 ? -1 : 1, stepY = dy < 0 ? -1 : 1;
    const ddx = dx === 0 ? Infinity : Math.abs(TILE / dx);
    const ddy = dy === 0 ? Infinity : Math.abs(TILE / dy);
    let sx = dx === 0 ? Infinity : (dx < 0 ? ox - mx * TILE : (mx + 1) * TILE - ox) / Math.abs(dx);
    let sy = dy === 0 ? Infinity : (dy < 0 ? oy - my * TILE : (my + 1) * TILE - oy) / Math.abs(dy);
    for (;;) {
      let d;
      if (sx < sy) { d = sx; sx += ddx; mx += stepX; } else { d = sy; sy += ddy; my += stepY; }
      if (d > maxD) return null;
      if (isWall(mx, my)) return { d, x: ox + dx * d, y: oy + dy * d, tx: mx, ty: my };
    }
  }

  function los(ax, ay, bx, by) {
    const d = dist(ax, ay, bx, by);
    return d < 1 || castRay(ax, ay, (bx - ax) / d, (by - ay) / d, d) === null;
  }

  function collides(x, y, r) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!isWall(tx, ty)) continue;
      const cx = clamp(x, tx * TILE, tx * TILE + TILE), cy = clamp(y, ty * TILE, ty * TILE + TILE);
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
    }
    return false;
  }

  function move(e, dx, dy) {
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6) || 1;
    for (let s = 0; s < steps; s++) {
      const nx = e.x + dx / steps; if (!collides(nx, e.y, e.r)) e.x = nx;
      const ny = e.y + dy / steps; if (!collides(e.x, ny, e.r)) e.y = ny;
    }
  }

  // ───────────────────────── Game state ─────────────────────────
  const G = {
    state: 'menu', // menu | playing | dying | between | paused
    score: 0, lives: 3, time: 0, levelTime: 0,
    player: null, pulses: [], ghosts: [], stones: [], sparks: [],
    cam: { x: 0, y: 0 }, shake: 0, flash: 0, danger: 0,
    heartT: 0, stepT: 0, demoT: 0, pauseFrom: null,
  };

  const input = {
    keys: new Set(), charging: false, charge: 0, cooldown: 0,
    mouse: { x: 0, y: 0, active: false }, joy: null, pulseTouch: null, touchMode: false,
  };

  function newPlayer() {
    return { x: L.start.x, y: L.start.y, r: 9, fx: 1, fy: 0, stones: 3, crystals: 0, moving: false };
  }

  function startGame() {
    Sound.init();
    G.score = 0; G.lives = 3;
    loadLevel(1);
  }

  function loadLevel(num) {
    buildLevel(num);
    G.player = newPlayer();
    G.pulses = []; G.ghosts = []; G.stones = []; G.sparks = [];
    G.levelTime = 0; G.flash = 0; G.danger = 0;
    input.charge = 0; input.charging = false; input.cooldown = 0.4;
    G.cam.x = G.player.x; G.cam.y = G.player.y;
    G.state = 'playing';
    hideOverlay();
    $('hud').classList.remove('hidden');
    $('touch').classList.toggle('hidden', !input.touchMode);
    // A free, silent pulse so the player isn't dropped into total darkness.
    emitPulse(G.player.x, G.player.y, TILE * 6, { noise: 0, hue: 190 });
    showMessage(`Уровень ${num} · кристаллов: ${L.crystals.length}`, 2.6);
    Sound.drone(0.05);
  }

  function emitPulse(x, y, radius, { noise = radius, hue = 190, rays = 560 } = {}) {
    const hits = new Array(rays);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + 0.0007;
      hits[i] = castRay(x, y, Math.cos(a), Math.sin(a), radius);
    }
    G.pulses.push({ x, y, radius, t: 0, hits, hue, marked: 0, touched: new Set() });
    if (noise > 0) makeNoise(x, y, noise);
  }

  function makeNoise(x, y, radius) {
    for (const h of L.hunters) {
      if (h.state === 'chase') continue;
      if (dist(x, y, h.x, h.y) <= radius) {
        h.state = 'investigate';
        h.target = { x, y };
        h.repath = 0;
      }
    }
  }

  function throwStone(tx, ty) {
    const p = G.player;
    if (p.stones <= 0 || G.state !== 'playing') return;
    let dx = tx - p.x, dy = ty - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) { dx = p.fx; dy = p.fy; } else { dx /= len; dy /= len; }
    let d = clamp(len, TILE * 2, TILE * 9);
    const hit = castRay(p.x, p.y, dx, dy, d);
    if (hit) d = Math.max(0, hit.d - 10);
    p.stones--;
    G.stones.push({ sx: p.x, sy: p.y, ex: p.x + dx * d, ey: p.y + dy * d, t: 0, dur: 0.18 + d / 700 });
    Sound.whoosh();
  }

  function panFor(x) { return clamp((x - G.player.x) / (TILE * 8), -1, 1); }

  function die() {
    G.state = 'dying';
    G.dyingT = 0;
    G.flash = 1; G.shake = 18;
    Sound.death();
    Sound.drone(0.0001);
    G.lives--;
  }

  function finishLevel() {
    G.state = 'between';
    const bonus = 500 * L.num;
    const timeBonus = Math.max(0, Math.round((180 - G.levelTime) * 5 * L.num));
    G.score += bonus + timeBonus;
    Sound.win();
    Sound.drone(0.0001);
    $('level-stats').innerHTML =
      `Уровень ${L.num} за ${formatTime(G.levelTime)}<br>` +
      `Бонус уровня: +${bonus} · за скорость: +${timeBonus}<br>Счёт: <b>${G.score}</b>`;
    showPanel('panel-level');
  }

  function formatTime(s) {
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  // ───────────────────────── Update ─────────────────────────
  function update(dt) {
    G.time += dt;
    G.shake = Math.max(0, G.shake - dt * 40);
    G.flash = Math.max(0, G.flash - dt * 1.5);
    updatePulses(dt);
    updateGhosts(dt);

    if (G.state === 'menu') { updateDemo(dt); return; }
    if (G.state === 'dying') {
      G.dyingT += dt;
      if (G.dyingT > 1.1) onDeathScreen();
      return;
    }
    if (G.state !== 'playing') return;

    G.levelTime += dt;
    updatePlayer(dt);
    updateStones(dt);
    for (const h of L.hunters) updateHunter(h, dt);
    updateHeart(dt);

    const p = G.player;
    G.cam.x = lerp(G.cam.x, p.x, 1 - Math.exp(-dt * 6));
    G.cam.y = lerp(G.cam.y, p.y, 1 - Math.exp(-dt * 6));
  }

  function updateDemo(dt) {
    G.demoT -= dt;
    G.cam.x = L.w * TILE / 2 + Math.cos(G.time * 0.05) * TILE * 6;
    G.cam.y = L.h * TILE / 2 + Math.sin(G.time * 0.07) * TILE * 4;
    if (G.demoT <= 0) {
      G.demoT = rand(0.9, 1.8);
      const c = center(L.open[randi(0, L.open.length)]);
      emitPulse(c.x, c.y, rand(4, 11) * TILE, { noise: 0, hue: Math.random() < 0.2 ? 35 : 190, rays: 420 });
    }
  }

  function updatePlayer(dt) {
    const p = G.player, k = input.keys;
    let mx = 0, my = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx--;
    if (k.has('KeyD') || k.has('ArrowRight')) mx++;
    if (k.has('KeyW') || k.has('ArrowUp')) my--;
    if (k.has('KeyS') || k.has('ArrowDown')) my++;
    let sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    if (input.joy) {
      const jx = input.joy.x - input.joy.ox, jy = input.joy.y - input.joy.oy;
      const jl = Math.hypot(jx, jy);
      if (jl > 8) { mx = jx / jl; my = jy / jl; sprint = jl > 70; }
    }
    const ml = Math.hypot(mx, my);
    p.moving = ml > 0;
    if (p.moving) {
      mx /= ml; my /= ml;
      p.fx = mx; p.fy = my;
      const speed = sprint ? 172 : 112;
      move(p, mx * speed * dt, my * speed * dt);
      G.stepT -= dt;
      if (G.stepT <= 0) {
        G.stepT = sprint ? 0.28 : 0.5;
        if (sprint) { Sound.step(); makeNoise(p.x, p.y, TILE * 4.5); spark(p.x, p.y, 4.5 * TILE); }
      }
    }

    // Charge-and-release echo pulse.
    input.cooldown = Math.max(0, input.cooldown - dt);
    if (input.charging && input.cooldown <= 0) input.charge = Math.min(1, input.charge + dt / 1.1);
    if (!input.charging && input.charge > 0) {
      const power = input.charge;
      input.charge = 0; input.cooldown = 0.45;
      const radius = lerp(3.5, 13, power) * TILE;
      emitPulse(p.x, p.y, radius, { noise: radius * 0.95 });
      Sound.ping(power);
    }

    // Light up whatever is right next to us.
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    for (let y = ty - 3; y <= ty + 3; y++) for (let x = tx - 3; x <= tx + 3; x++) {
      if (isWall(x, y) && x >= 0 && y >= 0 && x < L.w && y < L.h &&
          dist(p.x, p.y, x * TILE + 16, y * TILE + 16) < LIGHT_R + 16) L.seen[y * L.w + x] = 1;
    }

    for (const c of L.crystals) {
      if (!c.taken && dist(p.x, p.y, c.x, c.y) < 20) {
        c.taken = true; p.crystals++;
        G.score += 100 * L.num;
        Sound.crystal();
        burst(c.x, c.y, 280);
        const left = L.crystals.length - p.crystals;
        if (left === 0) {
          L.exit.open = true; L.exit.known = true;
          Sound.portal();
          showMessage('Портал открыт — найди выход', 3);
        } else {
          showMessage(`◆ ${p.crystals}/${L.crystals.length}`, 1.4);
        }
      }
    }
    if (L.exit.open && dist(p.x, p.y, L.exit.x, L.exit.y) < 22) finishLevel();
  }

  function updateStones(dt) {
    for (const s of G.stones) {
      s.t += dt;
      if (s.t >= s.dur && !s.done) {
        s.done = true;
        emitPulse(s.ex, s.ey, TILE * 3.5, { noise: TILE * 11, hue: 35, rays: 260 });
        Sound.clack(panFor(s.ex));
      }
    }
    G.stones = G.stones.filter((s) => !s.done);
  }

  function updatePulses(dt) {
    for (const pu of G.pulses) {
      pu.t += dt;
      const r = Math.min(pu.t * PULSE_SPEED, pu.radius);
      for (const h of pu.hits) if (h && h.d <= r) L.seen[h.ty * L.w + h.tx] = 1;
      if (G.state === 'menu') continue;
      const reveal = (o, onHit) => {
        if (pu.touched.has(o)) return;
        const d = dist(pu.x, pu.y, o.x, o.y);
        if (d <= r && los(pu.x, pu.y, o.x, o.y)) { pu.touched.add(o); onHit(o); }
      };
      for (const c of L.crystals) if (!c.taken) reveal(c, (c) => { c.known = true; c.revealT = G.time; });
      reveal(L.exit, (e) => { e.known = true; e.revealT = G.time; });
      for (const h of L.hunters) reveal(h, (h) => G.ghosts.push({ x: h.x, y: h.y, t: 0, chase: h.state === 'chase' }));
    }
    G.pulses = G.pulses.filter((pu) => pu.t < pu.radius / PULSE_SPEED + ECHO_LIFE);
  }

  function updateGhosts(dt) {
    for (const g of G.ghosts) g.t += dt;
    G.ghosts = G.ghosts.filter((g) => g.t < GHOST_LIFE);
    for (const s of G.sparks) s.t += dt;
    G.sparks = G.sparks.filter((s) => s.t < s.life);
  }

  function updateHunter(h, dt) {
    const p = G.player;
    const d = dist(h.x, h.y, p.x, p.y);
    const sees = d < TILE * 7 && los(h.x, h.y, p.x, p.y);
    h.growlCD -= dt;

    if (sees && d < SENSE_R && h.state !== 'chase') {
      h.state = 'chase';
      if (h.growlCD <= 0) { Sound.growl(panFor(h.x)); h.growlCD = 4; G.shake = 6; }
    }
    if (h.state === 'chase') {
      if (sees) { h.target = { x: p.x, y: p.y }; h.lostT = 0; }
      else if ((h.lostT += dt) > 1.6) h.state = 'investigate';
    }

    if (h.state === 'search') {
      h.linger -= dt;
      h.eye += dt * 3;
      if (h.linger <= 0) { h.state = 'wander'; h.target = null; }
      return catchCheck(h, d);
    }
    if (h.state === 'wander' && !h.target) {
      for (let i = 0; i < 25; i++) {
        const c = center(L.open[randi(0, L.open.length)]);
        if (dist(c.x, c.y, h.x, h.y) < TILE * 12) { h.target = c; break; }
      }
      if (!h.target) return;
    }

    // Repath with a BFS distance field from the target tile.
    h.repath -= dt;
    const tIdx = Math.floor(h.target.y / TILE) * L.w + Math.floor(h.target.x / TILE);
    if (h.fieldFor !== tIdx && h.repath <= 0) {
      h.field = bfs(tIdx); h.fieldFor = tIdx; h.repath = 0.25;
    }

    const speed = { wander: 48, investigate: 100, chase: 126 }[h.state] * h.speed;
    let gx = h.target.x, gy = h.target.y;
    const hx = Math.floor(h.x / TILE), hy = Math.floor(h.y / TILE);
    const here = h.field ? h.field[hy * L.w + hx] : -1;
    if (here > 0) {
      let best = here, bi = -1;
      for (const [ox, oy] of DIRS8) {
        const nx = hx + ox, ny = hy + oy;
        if (isWall(nx, ny) || (ox && oy && (isWall(hx + ox, hy) || isWall(hx, hy + oy)))) continue;
        const v = h.field[ny * L.w + nx];
        if (v >= 0 && v < best) { best = v; bi = ny * L.w + nx; }
      }
      if (bi >= 0) ({ x: gx, y: gy } = center(bi));
    }
    const gd = dist(h.x, h.y, gx, gy);
    if (gd > 1) move(h, (gx - h.x) / gd * Math.min(speed * dt, gd), (gy - h.y) / gd * Math.min(speed * dt, gd));
    h.eye += dt * (h.state === 'chase' ? 10 : 2);

    if (dist(h.x, h.y, h.target.x, h.target.y) < 14 && h.state !== 'chase') {
      if (h.state === 'investigate') { h.state = 'search'; h.linger = rand(1.8, 3.2); }
      else h.target = null;
    }
    catchCheck(h, dist(h.x, h.y, p.x, p.y));
  }

  function catchCheck(h, d) {
    if (G.state === 'playing' && d < h.r + G.player.r - 2) die();
  }

  function updateHeart(dt) {
    const p = G.player;
    let nd = Infinity;
    for (const h of L.hunters) nd = Math.min(nd, dist(h.x, h.y, p.x, p.y));
    const k = clamp(1 - (nd - TILE * 1.5) / (TILE * 10), 0, 1);
    G.danger = lerp(G.danger, k, 1 - Math.exp(-dt * 3));
    if (k <= 0) return;
    G.heartT -= dt;
    if (G.heartT <= 0) {
      G.heartT = lerp(1.3, 0.34, k);
      Sound.heartbeat(k);
    }
  }

  function spark(x, y, r) { G.sparks.push({ x, y, r, t: 0, life: 0.5, ring: true }); }
  function burst(x, y, hue) {
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2), v = rand(40, 160);
      G.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rand(0.5, 1.1), hue });
    }
  }

  // ───────────────────────── Rendering ─────────────────────────
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#02040a';
    ctx.fillRect(0, 0, W, H);
    if (!L) return;

    const sx = (Math.random() - 0.5) * G.shake, sy = (Math.random() - 0.5) * G.shake;
    const ox = W / 2 - G.cam.x * ZOOM + sx, oy = H / 2 - G.cam.y * ZOOM + sy;
    ctx.setTransform(DPR * ZOOM, 0, 0, DPR * ZOOM, DPR * ox, DPR * oy);

    const view = {
      x0: Math.floor((G.cam.x - W / 2 / ZOOM) / TILE) - 1, x1: Math.ceil((G.cam.x + W / 2 / ZOOM) / TILE) + 1,
      y0: Math.floor((G.cam.y - H / 2 / ZOOM) / TILE) - 1, y1: Math.ceil((G.cam.y + H / 2 / ZOOM) / TILE) + 1,
    };

    drawMemory(view);
    if (G.player && G.state !== 'menu') drawLight();
    drawExit();
    drawCrystals();
    drawPulses();
    drawSparks();
    drawGhosts();
    if (G.state !== 'menu') {
      drawLiveHunters();
      drawStones();
      drawPlayer();
    }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawScreenFx();
  }

  // Remembered wall outlines: a faint hand-drawn map of everything echo has touched.
  function drawMemory(v) {
    ctx.beginPath();
    for (let y = Math.max(0, v.y0); y <= Math.min(L.h - 1, v.y1); y++) {
      for (let x = Math.max(0, v.x0); x <= Math.min(L.w - 1, v.x1); x++) {
        const i = y * L.w + x;
        if (!L.seen[i] || !L.grid[i]) continue;
        const X = x * TILE, Y = y * TILE;
        if (!isWall(x, y - 1)) { ctx.moveTo(X, Y); ctx.lineTo(X + TILE, Y); }
        if (!isWall(x, y + 1)) { ctx.moveTo(X, Y + TILE); ctx.lineTo(X + TILE, Y + TILE); }
        if (!isWall(x - 1, y)) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + TILE); }
        if (!isWall(x + 1, y)) { ctx.moveTo(X + TILE, Y); ctx.lineTo(X + TILE, Y + TILE); }
      }
    }
    ctx.strokeStyle = G.state === 'menu' ? 'rgba(94,225,255,0.07)' : 'rgba(94,225,255,0.13)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawLight() {
    const p = G.player;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, LIGHT_R);
    g.addColorStop(0, 'rgba(94,225,255,0.10)');
    g.addColorStop(1, 'rgba(94,225,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, LIGHT_R, 0, Math.PI * 2); ctx.fill();

    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    for (let y = ty - 3; y <= ty + 3; y++) for (let x = tx - 3; x <= tx + 3; x++) {
      if (!isWall(x, y)) continue;
      const d = dist(p.x, p.y, x * TILE + 16, y * TILE + 16);
      const a = clamp(1 - (d - 16) / LIGHT_R, 0, 1);
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(40,80,110,${a * 0.55})`;
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }

  function glow(x, y, r, rgb, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  function visibility(o, nearR, fade) {
    let a = 0;
    if (G.player && G.state !== 'menu') a = clamp(1 - dist(o.x, o.y, G.player.x, G.player.y) / nearR, 0, 1);
    a = Math.max(a, clamp(1 - (G.time - o.revealT) / fade, 0, 1));
    if (o.known) a = Math.max(a, 0.18);
    return a;
  }

  function drawCrystals() {
    if (G.state === 'menu') return;
    for (const c of L.crystals) {
      if (c.taken) continue;
      const a = visibility(c, TILE * 4.5, 5);
      if (a <= 0) continue;
      const pulse = 0.75 + 0.25 * Math.sin(G.time * 3 + c.phase);
      glow(c.x, c.y, 34, '185,140,255', 0.35 * a * pulse);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(G.time * 0.8 + c.phase);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#d6bcff';
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 0); ctx.lineTo(0, 9); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function drawExit() {
    if (G.state === 'menu') return;
    const e = L.exit;
    if (e.open) {
      const a = Math.max(visibility(e, TILE * 14, 5), 0.5);
      glow(e.x, e.y, 70, '120,200,255', 0.25 * a);
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const r = 8 + ((G.time * 14 + i * 7) % 28);
        ctx.strokeStyle = `rgba(${i % 2 ? '185,140,255' : '94,225,255'},${a * (1 - r / 36)})`;
        ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke();
      }
    } else {
      const a = visibility(e, TILE * 3, 5) * 0.5;
      if (a <= 0) return;
      ctx.strokeStyle = `rgba(140,160,180,${a})`;
      ctx.setLineDash([4, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawPulses() {
    ctx.lineCap = 'round';
    for (const pu of G.pulses) {
      const r = pu.t * PULSE_SPEED;
      if (r < pu.radius) {
        ctx.strokeStyle = `hsla(${pu.hue},90%,70%,${0.22 * (1 - r / pu.radius)})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pu.x, pu.y, r, 0, Math.PI * 2); ctx.stroke();
      }
      const n = pu.hits.length;
      for (let i = 0; i < n; i++) {
        const h = pu.hits[i];
        if (!h) continue;
        const age = pu.t - h.d / PULSE_SPEED;
        if (age < 0 || age > ECHO_LIFE) continue;
        let a = 1 - age / ECHO_LIFE;
        a *= a;
        const fresh = age < 0.12;
        const nx = pu.hits[(i + 1) % n];
        ctx.strokeStyle = fresh ? `hsla(${pu.hue},100%,92%,${a})` : `hsla(${pu.hue},90%,65%,${a})`;
        ctx.lineWidth = fresh ? 3 : 2;
        ctx.beginPath();
        if (nx && Math.abs(nx.x - h.x) + Math.abs(nx.y - h.y) < 12 && pu.t >= nx.d / PULSE_SPEED) {
          ctx.moveTo(h.x, h.y); ctx.lineTo(nx.x, nx.y);
        } else {
          ctx.moveTo(h.x, h.y); ctx.lineTo(h.x + 0.1, h.y);
        }
        ctx.stroke();
      }
    }
  }

  function drawHunter(x, y, a, chase, eye) {
    glow(x, y, 26, chase ? '255,40,60' : '160,20,40', 0.3 * a);
    ctx.fillStyle = `rgba(8,4,8,${0.9 * a})`;
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const rr = 12 + Math.sin(ang * 5 + eye) * 2.5;
      const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.fill();
    ctx.fillStyle = `rgba(255,${chase ? 40 : 90},${chase ? 50 : 90},${a})`;
    const blink = Math.sin(eye * 0.7) > 0.97 ? 0.3 : 2.6;
    ctx.fillRect(x - 6, y - 3, 4, blink);
    ctx.fillRect(x + 2, y - 3, 4, blink);
  }

  function drawGhosts() {
    for (const g of G.ghosts) {
      const a = 1 - g.t / GHOST_LIFE;
      drawHunter(g.x, g.y, a * a, g.chase, G.time * 4);
    }
  }

  function drawLiveHunters() {
    const p = G.player;
    for (const h of L.hunters) {
      const d = dist(h.x, h.y, p.x, p.y);
      if (d > LIGHT_R + 24 || !los(p.x, p.y, h.x, h.y)) continue;
      drawHunter(h.x, h.y, clamp(1 - (d - LIGHT_R + 10) / 34, 0, 1), h.state === 'chase', h.eye);
    }
  }

  function drawStones() {
    for (const s of G.stones) {
      const k = clamp(s.t / s.dur, 0, 1);
      const x = lerp(s.sx, s.ex, k), y = lerp(s.sy, s.ey, k);
      const lift = Math.sin(k * Math.PI) * 4;
      ctx.fillStyle = '#ffcf8a';
      ctx.beginPath(); ctx.arc(x, y - lift, 3 + lift * 0.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawSparks() {
    for (const s of G.sparks) {
      const a = 1 - s.t / s.life;
      if (s.ring) {
        ctx.strokeStyle = `rgba(255,190,120,${a * 0.18})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (s.t / s.life), 0, Math.PI * 2); ctx.stroke();
      } else {
        const x = s.x + s.vx * s.t, y = s.y + s.vy * s.t;
        ctx.fillStyle = `hsla(${s.hue},90%,75%,${a})`;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
  }

  function drawPlayer() {
    const p = G.player;
    if (G.state === 'dying') return;
    glow(p.x, p.y, 22, '94,225,255', 0.45);
    ctx.fillStyle = '#e8fbff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(94,225,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.x + p.fx * 9, p.y + p.fy * 9); ctx.lineTo(p.x + p.fx * 13, p.y + p.fy * 13); ctx.stroke();

    if (input.charge > 0) {
      const c = input.charge;
      ctx.strokeStyle = `rgba(94,225,255,${0.4 + 0.6 * c})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 16, -Math.PI / 2, -Math.PI / 2 + c * Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(94,225,255,0.12)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 8]);
      ctx.beginPath(); ctx.arc(p.x, p.y, lerp(3.5, 13, c) * TILE, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawScreenFx() {
    if (G.state !== 'menu' && G.danger > 0.02) {
      const beat = 0.85 + 0.15 * Math.sin(G.time * (4 + G.danger * 8));
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(120,0,20,0)');
      g.addColorStop(1, `rgba(150,0,25,${0.5 * G.danger * beat})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (G.flash > 0) { ctx.fillStyle = `rgba(255,30,50,${G.flash * 0.45})`; ctx.fillRect(0, 0, W, H); }

    // Arrow toward the open exit when it's off-screen.
    if (G.state === 'playing' && L.exit.open) {
      const ex = (L.exit.x - G.cam.x) * ZOOM, ey = (L.exit.y - G.cam.y) * ZOOM;
      if (Math.abs(ex) > W / 2 - 30 || Math.abs(ey) > H / 2 - 30) {
        const a = Math.atan2(ey, ex), R = Math.min(W, H) / 2 - 36;
        ctx.save();
        ctx.translate(W / 2 + Math.cos(a) * R, H / 2 + Math.sin(a) * R);
        ctx.rotate(a);
        ctx.fillStyle = `rgba(185,140,255,${0.6 + 0.3 * Math.sin(G.time * 5)})`;
        ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -8); ctx.lineTo(-4, 0); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    if (input.joy) {
      const j = input.joy;
      ctx.strokeStyle = 'rgba(94,225,255,0.25)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(j.ox, j.oy, 60, 0, Math.PI * 2); ctx.stroke();
      const dx = j.x - j.ox, dy = j.y - j.oy, l = Math.min(Math.hypot(dx, dy), 60) / (Math.hypot(dx, dy) || 1);
      ctx.fillStyle = 'rgba(94,225,255,0.3)';
      ctx.beginPath(); ctx.arc(j.ox + dx * l, j.oy + dy * l, 22, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ───────────────────────── HUD & overlays ─────────────────────────
  const hudCache = {};
  function setText(id, text) {
    if (hudCache[id] !== text) { hudCache[id] = text; $(id).textContent = text; }
  }
  function updateHud() {
    if (!G.player || G.state === 'menu') return;
    setText('hud-level', `Уровень ${L.num}`);
    setText('hud-lives', '♥'.repeat(Math.max(G.lives, 0)) + '♡'.repeat(Math.max(0, 3 - G.lives)));
    setText('hud-crystals', `◆ ${G.player.crystals}/${L.crystals.length}`);
    setText('hud-stones', `● ${G.player.stones}`);
    setText('hud-score', `${G.score}`);
  }

  let msgTimer = null;
  function showMessage(text, secs) {
    const el = $('message');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => el.classList.remove('show'), secs * 1000);
  }

  function showPanel(id) {
    $('overlay').classList.remove('hidden');
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('hidden', p.id !== id);
    const btn = document.querySelector(`#${id} button`);
    if (btn) setTimeout(() => btn.focus(), 50);
  }
  function hideOverlay() { $('overlay').classList.add('hidden'); }

  function onDeathScreen() {
    G.state = 'between';
    if (G.lives > 0) {
      $('dead-stats').innerHTML = `Осталось жизней: ${G.lives}<br>Уровень будет перестроен заново.`;
      showPanel('panel-dead');
    } else {
      $('over-stats').innerHTML = `Счёт: <b>${G.score}</b> · достигнут уровень ${L.num}`;
      showPanel('panel-over');
      submitScore();
    }
  }

  function pause(on) {
    if (on && G.state === 'playing') {
      G.state = 'paused'; input.keys.clear(); input.charging = false; input.charge = 0;
      showPanel('panel-pause');
    } else if (!on && G.state === 'paused') {
      G.state = 'playing'; hideOverlay();
    }
  }

  // ───────────────────────── Leaderboard ─────────────────────────
  const playerName = () => ($('name').value.trim() || 'Аноним').slice(0, 16);

  function renderBoard(el, entries, myRank) {
    if (!entries || !entries.length) { el.innerHTML = ''; return; }
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    el.innerHTML = '<table><caption>ЛУЧШИЕ</caption>' + entries.map((e, i) =>
      `<tr class="${i + 1 === myRank ? 'me' : ''}"><td>${i + 1}.</td><td>${esc(e.name)}</td><td>ур. ${e.level}</td><td>${e.score}</td></tr>`,
    ).join('') + '</table>';
  }

  function renderLocalBest(el) {
    const best = Number(store.get('echo.best', 0));
    el.innerHTML = best ? `<p>Твой рекорд: <b>${best}</b></p>` : '';
  }

  async function loadBoard() {
    try {
      const res = await fetch('/api/boards/echo/scores');
      if (!res.ok) throw new Error(res.status);
      renderBoard($('board-menu'), await res.json());
    } catch { renderLocalBest($('board-menu')); }
  }

  async function submitScore() {
    if (G.score > Number(store.get('echo.best', 0))) store.set('echo.best', G.score);
    const el = $('board-over');
    try {
      const res = await fetch('/api/boards/echo/scores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playerName(), score: G.score, level: L.num }),
      });
      if (!res.ok) throw new Error(res.status);
      const { rank, top } = await res.json();
      renderBoard(el, top, rank);
    } catch { renderLocalBest(el); }
  }

  // ───────────────────────── Input ─────────────────────────
  function screenToWorld(x, y) {
    return { x: (x - W / 2) / ZOOM + G.cam.x, y: (y - H / 2) / ZOOM + G.cam.y };
  }

  function primaryAction() {
    if (G.state === 'menu') startGame();
    else if (G.state === 'between') {
      if (!$('panel-level').classList.contains('hidden')) loadLevel(L.num + 1);
      else if (G.lives > 0) loadLevel(L.num);
      else startGame();
    } else if (G.state === 'paused') pause(false);
  }

  window.addEventListener('keydown', (e) => {
    if (e.target === $('name')) { if (e.code === 'Enter') { e.preventDefault(); primaryAction(); } return; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); primaryAction(); return; }
    if (e.code === 'KeyP' || e.code === 'Escape') { pause(G.state === 'playing'); return; }
    if (G.state !== 'playing') return;
    input.keys.add(e.code);
    if (e.code === 'Space') input.charging = true;
    if (e.code === 'KeyE' && !e.repeat) {
      const m = input.mouse.active ? screenToWorld(input.mouse.x, input.mouse.y)
        : { x: G.player.x + G.player.fx * TILE * 6, y: G.player.y + G.player.fy * TILE * 6 };
      throwStone(m.x, m.y);
    }
  });
  window.addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
    if (e.code === 'Space') input.charging = false;
  });
  window.addEventListener('blur', () => { input.keys.clear(); input.charging = false; pause(true); });

  canvas.addEventListener('mousemove', (e) => { input.mouse = { x: e.clientX, y: e.clientY, active: true }; });
  canvas.addEventListener('mousedown', (e) => {
    if (G.state !== 'playing') return;
    if (e.button === 0) input.charging = true;
    if (e.button === 2) { const m = screenToWorld(e.clientX, e.clientY); throwStone(m.x, m.y); }
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) input.charging = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!input.touchMode) { input.touchMode = true; if (G.state === 'playing') $('touch').classList.remove('hidden'); }
    if (G.state !== 'playing') return;
    for (const t of e.changedTouches) {
      if (t.clientX < W / 2 && !input.joy) input.joy = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
      else if (input.pulseTouch === null) { input.pulseTouch = t.identifier; input.charging = true; }
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (input.joy && t.identifier === input.joy.id) { input.joy.x = t.clientX; input.joy.y = t.clientY; }
  }, { passive: false });
  const touchEnd = (e) => {
    for (const t of e.changedTouches) {
      if (input.joy && t.identifier === input.joy.id) input.joy = null;
      if (t.identifier === input.pulseTouch) { input.pulseTouch = null; input.charging = false; }
    }
  };
  canvas.addEventListener('touchend', touchEnd);
  canvas.addEventListener('touchcancel', touchEnd);
  window.addEventListener('touchstart', () => { input.touchMode = true; }, { once: true, passive: true });
  $('touch-stone').addEventListener('touchstart', (e) => {
    e.preventDefault();
    const p = G.player;
    throwStone(p.x + p.fx * TILE * 6, p.y + p.fy * TILE * 6);
  }, { passive: false });

  $('btn-start').onclick = startGame;
  $('btn-next').onclick = () => loadLevel(L.num + 1);
  $('btn-retry').onclick = () => loadLevel(L.num);
  $('btn-restart').onclick = startGame;
  $('btn-resume').onclick = () => pause(false);
  $('name').value = store.get('echo.name', '');
  $('name').addEventListener('input', () => store.set('echo.name', $('name').value));

  // ───────────────────────── Main loop ─────────────────────────
  buildLevel(3); // backdrop for the title screen
  loadBoard();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (G.state !== 'paused') update(dt);
    render();
    updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
