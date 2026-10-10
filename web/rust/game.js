'use strict';
// Ржавый рассвет — UI, scene and persistence. Rules live in core.js (window.RustCore).
(() => {
  const C = window.RustCore;
  const SAVE_KEY = 'rust-dawn.save';
  const CLOUD_KEY = 'rust-dawn.cloud';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };

  const ROLE_META = {
    digger: { name: 'Копатели', unit: 'хлама/с', color: '--rust' },
    sorter: { name: 'Сортировщики', unit: 'деталей/с', color: '--verdigris' },
    mechanic: { name: 'Механики', unit: 'ремонта/с', color: '--lamp' },
  };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // ───────────── Number formatting ─────────────
  const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
  const fixed1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const fmt = (n) => (n < 10000 ? String(Math.floor(n)) : compact.format(n));
  function rateText(n) {
    if (Math.abs(n) < 0.05) return '';
    const v = Math.abs(n) < 10 ? fixed1.format(Math.abs(n)) : fmt(Math.abs(n));
    return `${n < 0 ? '−' : '+'}${v}/с`;
  }
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function duration(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h) return `${h} ч ${m} мин`;
    if (m) return `${m} мин`;
    return `${Math.floor(sec)} с`;
  }

  // ───────────── State & persistence ─────────────
  let S = C.newState();
  let lastSave = 0;

  function save() {
    const ok = store.set(SAVE_KEY, JSON.stringify({ state: S, savedAt: Date.now() }));
    lastSave = performance.now();
    $('save-status').textContent = ok ? 'сохранено' : 'браузер не даёт сохранять';
  }

  function load() {
    const raw = store.get(SAVE_KEY);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      S = C.migrate(data.state);
      return data.savedAt || null;
    } catch { return null; }
  }

  // ───────────── Chronicle ─────────────
  const STORY = [
    { id: 'wake', when: () => true, text: 'Ты просыпаешься среди ржавых гор. Ни души, только хлам до горизонта и закатное небо.' },
    { id: 'scrap', when: (s) => s.stats.scrap >= 10, text: 'Руки помнят: из хлама можно выбирать детали. Пять горстей на одну.' },
    { id: 'body', when: (s) => s.stats.parts >= 5, text: 'Под грудой лома лежит робот. Корпус цел. Если собрать десяток деталей, его можно починить.' },
    { id: 'first', when: (s) => s.built >= 1, text: 'Робот открывает глаз, смотрит на тебя и тянется к лопате. Дай ему работу в «Бригаде».' },
    { id: 'three', when: (s) => s.built >= 3, text: 'Роботы перещёлкиваются между собой. Похоже, им нравится работать вместе.' },
    { id: 'core', when: (s) => s.stats.cores >= 1, text: 'Среди деталей что-то светится. Ядро — сердце старых машин.' },
    { id: 'ark', when: (s) => C.arkUnlocked(s), text: 'В дымке на краю свалки виден остов огромного корабля. Ковчег. Его можно достроить.' },
    { id: 'twenty', when: (s) => s.built >= 20, text: 'Свалка гудит. Ты сидишь на ящике и просто смотришь, как они работают.' },
    { id: 'ark1', when: (s) => s.ark >= 1, text: 'Каркас ковчега стоит. Роботы носят балки и, кажется, гордятся.' },
    { id: 'ark2', when: (s) => s.ark >= 2, text: 'Двигатели на месте. По ночам слышно, как они тихо остывают.' },
    { id: 'ark3', when: (s) => s.ark >= 3, text: 'Реактор теплится. Небо на востоке стало чуть светлее.' },
    { id: 'ark4', when: (s) => s.ark >= 4, text: 'Навигация ожила и сама нашла звезду, к которой стоит лететь.' },
  ];

  function addLog(text) {
    const li = document.createElement('li');
    li.textContent = text;
    const log = $('log');
    log.prepend(li);
    while (log.children.length > 6) log.lastChild.remove();
  }

  function checkStory(silent) {
    for (const st of STORY) {
      if (!S.seen[st.id] && st.when(S)) {
        S.seen[st.id] = true;
        if (!silent) addLog(st.text);
      }
    }
  }

  function rebuildLog() {
    $('log').innerHTML = '';
    for (const st of STORY) if (S.seen[st.id]) addLog(st.text);
  }

  // ───────────── Scene ─────────────
  const canvas = $('scene');
  const ctx = canvas.getContext('2d');
  const sc = {
    w: 0, h: 0, dpr: 1, ground: 0, t: 0,
    bots: [], floaters: [], particles: [],
    hillsFar: [], hillsNear: [], stars: [], chunks: [],
    swing: 0, repairFx: 0, lastRepair: 0, launch: null,
  };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function genHills(n, rough) {
    const pts = [];
    let y = 0.5;
    for (let i = 0; i <= n; i++) {
      y = clamp(y + rand(-rough, rough), 0.15, 0.95);
      pts.push(y);
    }
    return pts;
  }
  sc.hillsFar = genHills(48, 0.18);
  sc.hillsNear = genHills(30, 0.22);
  for (let i = 0; i < 70; i++) sc.stars.push({ x: Math.random(), y: Math.random() * 0.5, r: rand(0.4, 1.3), p: rand(0, 6) });
  const CHUNK_COLORS = ['#8a4a33', '#a9572f', '#6e5a6e', '#5a4a5e', '#7a6a58', '#b5683a', '#4f5c63'];
  for (let i = 0; i < 70; i++) {
    const a = Math.random();
    sc.chunks.push({ u: rand(-1, 1) * (1 - a * 0.7), v: a, w: rand(5, 13), h: rand(3, 8), r: rand(-0.6, 0.6), c: CHUNK_COLORS[i % CHUNK_COLORS.length] });
  }
  sc.chunks.sort((p, q) => p.v - q.v);

  function resizeScene() {
    const rect = canvas.getBoundingClientRect();
    sc.dpr = Math.min(window.devicePixelRatio || 1, 2);
    sc.w = rect.width; sc.h = rect.height;
    canvas.width = Math.round(sc.w * sc.dpr); canvas.height = Math.round(sc.h * sc.dpr);
    sc.ground = sc.h * 0.74;
  }
  window.addEventListener('resize', resizeScene);

  const X = {
    heap: () => sc.w * 0.13, player: () => sc.w * 0.25, bench: () => sc.w * 0.46,
    bay: () => sc.w * 0.68, ark: () => sc.w * 0.89,
  };
  const heapHeight = () => sc.h * (0.1 + 0.2 * clamp(Math.log10(S.scrap + 1) / 6, 0, 1));
  const unit = () => clamp(sc.h / 300, 0.75, 1.4);

  // Keep on-screen robots in sync with the real crew (capped for readability).
  const VISIBLE_CAP = { digger: 14, sorter: 8, mechanic: 6, idle: 6 };
  function syncBots() {
    for (const role of ['digger', 'sorter', 'mechanic', 'idle']) {
      const want = Math.min(S.robots[role], VISIBLE_CAP[role]);
      const have = sc.bots.filter((b) => b.role === role);
      for (let i = have.length; i < want; i++) {
        sc.bots.push({
          role, x: X.bay() + rand(-10, 10), y: rand(0, 14), tx: null, state: 'walk',
          timer: 0, carry: false, phase: rand(0, 6), dir: -1, speed: rand(42, 60), slot: Math.random(),
        });
      }
      for (let i = want; i < have.length; i++) sc.bots.splice(sc.bots.indexOf(have[i]), 1);
    }
  }

  function updateBot(b, dt) {
    const u = unit();
    b.phase += dt * 6;
    const goto = (tx) => {
      const d = tx - b.x;
      if (Math.abs(d) < 2) { b.x = tx; return true; }
      b.dir = Math.sign(d);
      b.x += Math.sign(d) * Math.min(Math.abs(d), b.speed * u * dt);
      return false;
    };
    switch (b.role) {
      case 'digger':
        if (b.state === 'walk' || b.state === 'toHeap') {
          b.state = 'toHeap';
          if (goto(X.heap() + 18 * u + b.slot * 26 * u)) { b.state = 'dig'; b.timer = rand(0.8, 1.6); }
        } else if (b.state === 'dig') {
          b.timer -= dt;
          if (b.timer <= 0) { b.state = 'toBench'; b.carry = true; }
        } else if (b.state === 'toBench') {
          if (goto(X.bench() - 34 * u - b.slot * 14 * u)) { b.state = 'drop'; b.timer = 0.35; b.carry = false; }
        } else if (b.state === 'drop') {
          b.timer -= dt;
          if (b.timer <= 0) b.state = 'toHeap';
        }
        break;
      case 'sorter':
        b.state = goto(X.bench() - 22 * u + b.slot * 50 * u) ? 'work' : 'walk';
        break;
      case 'mechanic':
        b.state = goto(X.bay() - 30 * u + b.slot * 60 * u) ? 'work' : 'walk';
        if (b.state === 'work') b.dir = b.x < X.bay() ? 1 : -1;
        break;
      default: // idle: amble around
        if (b.tx === null || b.state === 'rest' && (b.timer -= dt) <= 0) { b.tx = rand(X.player() + 20, X.bay() - 30); b.state = 'walk'; }
        if (b.state === 'walk' && goto(b.tx)) { b.state = 'rest'; b.timer = rand(1.5, 4); }
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }

  const ROLE_EYE = { digger: '#e2733d', sorter: '#5fc7a9', mechanic: '#f3c24f', idle: '#a698b1' };

  function drawBot(x, y, role, phase, opts = {}) {
    const u = unit() * (opts.scale || 1);
    const walking = opts.walking;
    const bob = walking ? Math.abs(Math.sin(phase)) * 1.5 * u : 0;
    ctx.save();
    ctx.translate(x, y - bob);
    ctx.globalAlpha = opts.alpha ?? 1;
    // legs
    ctx.fillStyle = '#3b3247';
    const step = walking ? Math.sin(phase) * 2.5 * u : 0;
    ctx.fillRect(-5 * u + step, -5 * u, 3 * u, 5 * u + bob);
    ctx.fillRect(2 * u - step, -5 * u, 3 * u, 5 * u + bob);
    // body
    ctx.fillStyle = '#7b6d86';
    roundRect(-8 * u, -17 * u, 16 * u, 12 * u, 3 * u); ctx.fill();
    ctx.fillStyle = ROLE_EYE[role];
    ctx.fillRect(-8 * u, -11 * u, 16 * u, 2 * u);
    // arm
    ctx.strokeStyle = '#5d5068'; ctx.lineWidth = 2 * u; ctx.lineCap = 'round';
    const armA = opts.working ? Math.sin(phase * 2) * 0.9 : walking ? Math.sin(phase) * 0.4 : 0.2;
    const dir = opts.dir || 1;
    ctx.beginPath(); ctx.moveTo(dir * 6 * u, -14 * u);
    ctx.lineTo(dir * (6 + Math.cos(armA) * 7) * u, (-14 + Math.sin(armA) * 7) * u); ctx.stroke();
    // head
    ctx.fillStyle = '#968aa0';
    roundRect(-6 * u, -26 * u, 12 * u, 9 * u, 2.5 * u); ctx.fill();
    ctx.fillStyle = ROLE_EYE[role];
    ctx.shadowColor = ROLE_EYE[role]; ctx.shadowBlur = 6 * u;
    ctx.beginPath(); ctx.arc(dir * 2 * u, -21.5 * u, 2 * u, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // antenna
    ctx.strokeStyle = '#5d5068'; ctx.lineWidth = 1.2 * u;
    ctx.beginPath(); ctx.moveTo(0, -26 * u); ctx.lineTo(-2 * u, -31 * u); ctx.stroke();
    ctx.fillStyle = Math.sin(phase * 0.7) > 0.6 ? '#ff8f6b' : '#5d5068';
    ctx.beginPath(); ctx.arc(-2 * u, -31.5 * u, 1.4 * u, 0, Math.PI * 2); ctx.fill();
    if (opts.carry) {
      ctx.fillStyle = '#a9572f';
      ctx.fillRect(-4 * u, -38 * u, 8 * u, 5 * u);
    }
    ctx.restore();
  }

  function drawPlayer() {
    const u = unit();
    const x = X.player(), y = sc.ground + 6 * u;
    const swing = sc.swing > 0 ? Math.sin((1 - sc.swing) * Math.PI) : 0;
    ctx.save();
    ctx.translate(x, y);
    // coat
    ctx.fillStyle = '#3a2d4a';
    ctx.beginPath(); ctx.moveTo(-8 * u, 0); ctx.lineTo(-6 * u, -22 * u); ctx.lineTo(6 * u, -22 * u); ctx.lineTo(8 * u, 0); ctx.closePath(); ctx.fill();
    // scarf
    ctx.fillStyle = '#e2733d';
    ctx.fillRect(-6 * u, -23 * u, 12 * u, 3 * u);
    ctx.fillRect(3 * u, -22 * u, 3 * u, 8 * u);
    // hood
    ctx.fillStyle = '#4a3a5c';
    ctx.beginPath(); ctx.arc(0, -28 * u, 6 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#20182c';
    ctx.beginPath(); ctx.arc(-1.5 * u, -27.5 * u, 3.5 * u, 0, Math.PI * 2); ctx.fill();
    // shovel
    ctx.rotate(-0.6 - swing * 1.2);
    ctx.strokeStyle = '#8a7a6a'; ctx.lineWidth = 2 * u;
    ctx.beginPath(); ctx.moveTo(0, -14 * u); ctx.lineTo(-22 * u, -14 * u); ctx.stroke();
    ctx.fillStyle = '#a0a6ad';
    ctx.fillRect(-28 * u, -17 * u, 6 * u, 6 * u);
    ctx.restore();
  }

  function drawSky() {
    const { w, h, ground } = sc;
    // Dawn creeps in as the ark gets built.
    const dawn = clamp((S.ark + Math.min(S.built, 40) / 40) / 6, 0, 1);
    const g = ctx.createLinearGradient(0, 0, 0, ground);
    g.addColorStop(0, mix('#140f22', '#2c3e66', dawn));
    g.addColorStop(0.55, mix('#3d2648', '#7a5a8a', dawn));
    g.addColorStop(1, mix('#c4613a', '#f0a868', dawn));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, ground);

    for (const s of sc.stars) {
      const a = (1 - dawn) * (0.35 + 0.35 * Math.sin(sc.t * 1.3 + s.p));
      if (a <= 0.02) continue;
      ctx.fillStyle = `rgba(255,240,220,${a})`;
      ctx.fillRect(s.x * w, s.y * ground, s.r, s.r);
    }
    // sun
    const sunY = ground - h * (0.02 + dawn * 0.22);
    const sr = h * 0.12;
    const sg = ctx.createRadialGradient(w * 0.58, sunY, sr * 0.2, w * 0.58, sunY, sr * 3);
    sg.addColorStop(0, 'rgba(255,200,120,0.55)');
    sg.addColorStop(1, 'rgba(255,160,90,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, w, ground);
    ctx.fillStyle = mix('#f08a4a', '#ffd38a', dawn);
    ctx.beginPath(); ctx.arc(w * 0.58, sunY, sr, Math.PI, 0); ctx.fill();
  }

  function drawHills(pts, color, top, amp) {
    const { w, ground } = sc;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(0, ground);
    pts.forEach((p, i) => {
      const x = (i / (pts.length - 1)) * w;
      ctx.lineTo(x, ground - top - p * amp);
      if (i % 3 === 1) ctx.lineTo(x + w / pts.length * 0.4, ground - top - p * amp - 4);
    });
    ctx.lineTo(w, ground); ctx.closePath(); ctx.fill();
  }

  function drawHeap() {
    const x = X.heap(), base = sc.ground + 4, hh = heapHeight(), ww = sc.w * 0.12;
    ctx.fillStyle = '#3a2533';
    ctx.beginPath(); ctx.moveTo(x - ww, base);
    ctx.quadraticCurveTo(x - ww * 0.4, base - hh * 1.1, x, base - hh);
    ctx.quadraticCurveTo(x + ww * 0.4, base - hh * 1.1, x + ww, base);
    ctx.closePath(); ctx.fill();
    const u = unit();
    for (const c of sc.chunks) {
      const cx = x + c.u * ww * 0.85, top = hh * (1 - Math.abs(c.u) ** 2 * 0.9);
      const cy = base - c.v * top;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(c.r);
      ctx.fillStyle = c.c; ctx.fillRect(-c.w * u / 2, -c.h * u / 2, c.w * u, c.h * u);
      ctx.restore();
    }
  }

  function drawBench() {
    const u = unit(), x = X.bench(), y = sc.ground + 2;
    // lamp
    const lg = ctx.createRadialGradient(x + 40 * u, y - 60 * u, 4, x + 40 * u, y - 60 * u, 90 * u);
    lg.addColorStop(0, 'rgba(243,194,79,0.35)'); lg.addColorStop(1, 'rgba(243,194,79,0)');
    ctx.fillStyle = lg; ctx.fillRect(x - 60 * u, y - 150 * u, 200 * u, 170 * u);
    ctx.strokeStyle = '#2a2034'; ctx.lineWidth = 3 * u;
    ctx.beginPath(); ctx.moveTo(x + 52 * u, y); ctx.lineTo(x + 52 * u, y - 62 * u); ctx.lineTo(x + 40 * u, y - 62 * u); ctx.stroke();
    ctx.fillStyle = '#f3c24f';
    ctx.beginPath(); ctx.arc(x + 40 * u, y - 59 * u, 3.5 * u, 0, Math.PI * 2); ctx.fill();
    // table + belt
    ctx.fillStyle = '#4a3b58';
    ctx.fillRect(x - 40 * u, y - 18 * u, 80 * u, 6 * u);
    ctx.fillRect(x - 36 * u, y - 12 * u, 4 * u, 12 * u);
    ctx.fillRect(x + 32 * u, y - 12 * u, 4 * u, 12 * u);
    ctx.fillStyle = '#2a2034';
    ctx.fillRect(x - 40 * u, y - 22 * u, 80 * u, 4 * u);
    if (S.robots.sorter > 0) {
      ctx.fillStyle = '#5fc7a9';
      const off = (sc.t * 20) % (10 * u);
      for (let i = -40 * u + off; i < 40 * u; i += 10 * u) ctx.fillRect(x + i, y - 21.5 * u, 3 * u, 1.5 * u);
    }
    // parts bin
    ctx.fillStyle = '#33283f';
    ctx.fillRect(x + 22 * u, y - 10 * u, 16 * u, 10 * u);
    if (S.parts >= 1) {
      ctx.strokeStyle = '#5fc7a9'; ctx.lineWidth = 2 * u;
      for (let i = 0; i < Math.min(3, Math.ceil(Math.log10(S.parts + 1))); i++) {
        ctx.beginPath(); ctx.arc(x + (26 + i * 4) * u, y - (12 + (i % 2) * 2) * u, 2.5 * u, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  function drawBay() {
    const u = unit(), x = X.bay(), y = sc.ground + 2;
    ctx.strokeStyle = '#2a2034'; ctx.lineWidth = 4 * u;
    ctx.beginPath();
    ctx.moveTo(x - 26 * u, y); ctx.lineTo(x - 26 * u, y - 56 * u); ctx.lineTo(x + 26 * u, y - 56 * u); ctx.lineTo(x + 26 * u, y);
    ctx.stroke();
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath(); ctx.moveTo(x, y - 56 * u); ctx.lineTo(x, y - 40 * u); ctx.stroke();
    ctx.fillStyle = '#33283f';
    ctx.fillRect(x - 22 * u, y - 4 * u, 44 * u, 4 * u);
    if (S.repair) {
      const k = S.repair.progress / S.repair.need;
      drawBot(x, y - 4 * u, 'idle', sc.t, { alpha: 0.25 + 0.75 * k, scale: 1.1 });
      ctx.fillStyle = 'rgba(243,194,79,0.9)';
      ctx.fillRect(x - 20 * u, y - 48 * u, 40 * u * k, 3 * u);
    }
  }

  // The ark is drawn as a stack of stages; unbuilt ones are dashed outlines.
  function drawArk() {
    if (!C.arkUnlocked(S)) return;
    const u = unit();
    let x = X.ark(), y = sc.ground + 2;
    let lift = 0;
    if (sc.launch !== null) {
      const t = sc.t - sc.launch;
      lift = t < 1.2 ? 0 : (t - 1.2) ** 2 * 60 * u;
      x += t < 1.2 ? Math.sin(t * 60) * 1.5 : 0;
      if (y - lift < -200 * u) return;
    } else if (S.launched) return;
    y -= lift;
    const H = 110 * u, W = 26 * u;
    const built = S.ark;
    const part = (i, fn) => {
      const done = i < built;
      ctx.save();
      if (!done) { ctx.setLineDash([3 * u, 4 * u]); ctx.globalAlpha = 0.45; }
      fn(done);
      ctx.restore();
    };
    const fillOr = (done, color) => {
      if (done) { ctx.fillStyle = color; ctx.fill(); }
      ctx.strokeStyle = done ? 'rgba(0,0,0,0.25)' : '#a698b1'; ctx.lineWidth = 1.2 * u; ctx.stroke();
    };
    // 0 frame
    part(0, (d) => {
      ctx.strokeStyle = d ? '#4a3b58' : '#a698b1'; ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(x - W * 1.2, y); ctx.lineTo(x - W * 1.2, y - H * 0.8);
      ctx.moveTo(x + W * 1.2, y); ctx.lineTo(x + W * 1.2, y - H * 0.8);
      for (let k = 1; k <= 4; k++) { ctx.moveTo(x - W * 1.2, y - H * 0.2 * k); ctx.lineTo(x + W * 1.2, y - H * 0.2 * k); }
      if (lift === 0) ctx.stroke();
    });
    // 1 engines
    part(1, (d) => {
      ctx.beginPath();
      ctx.moveTo(x - W, y - 6 * u); ctx.lineTo(x - W * 1.4, y); ctx.lineTo(x - W * 0.5, y); ctx.lineTo(x - W * 0.5, y - 14 * u); ctx.closePath();
      ctx.moveTo(x + W, y - 6 * u); ctx.lineTo(x + W * 1.4, y); ctx.lineTo(x + W * 0.5, y); ctx.lineTo(x + W * 0.5, y - 14 * u); ctx.closePath();
      fillOr(d, '#6e5a6e');
    });
    // 2 hull (reactor)
    part(2, (d) => {
      roundRect(x - W * 0.75, y - H * 0.75, W * 1.5, H * 0.72, 6 * u);
      fillOr(d, '#9b8a8f');
      if (d) {
        ctx.fillStyle = `rgba(143,211,255,${0.5 + 0.3 * Math.sin(sc.t * 2)})`;
        ctx.fillRect(x - W * 0.2, y - H * 0.25, W * 0.4, H * 0.12);
      }
    });
    // 3 nose + windows (navigation)
    part(3, (d) => {
      ctx.beginPath();
      ctx.moveTo(x - W * 0.75, y - H * 0.75); ctx.quadraticCurveTo(x, y - H * 1.25, x + W * 0.75, y - H * 0.75); ctx.closePath();
      fillOr(d, '#e2733d');
      if (d) {
        ctx.fillStyle = '#f3c24f';
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x, y - H * (0.62 - k * 0.12), 3 * u, 0, Math.PI * 2); ctx.fill(); }
      }
    });
    // 4 launch: flame
    if (sc.launch !== null) {
      const f = 14 * u + Math.random() * 10 * u;
      ctx.fillStyle = 'rgba(255,190,90,0.9)';
      ctx.beginPath(); ctx.moveTo(x - W * 0.6, y); ctx.lineTo(x, y + f * 2.4); ctx.lineTo(x + W * 0.6, y); ctx.fill();
      if (Math.random() < 0.6) sc.particles.push({ x: x + rand(-8, 8), y: y + 6, vx: rand(-30, 30), vy: rand(10, 60), life: 1.4, t: 0, c: '#b9a7a0', s: rand(3, 7) });
    }
  }

  function mix(a, b, k) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = Math.round(((pa >> 16) & 255) * (1 - k) + ((pb >> 16) & 255) * k);
    const g = Math.round(((pa >> 8) & 255) * (1 - k) + ((pb >> 8) & 255) * k);
    const bl = Math.round((pa & 255) * (1 - k) + (pb & 255) * k);
    return `rgb(${r},${g},${bl})`;
  }

  function floater(x, y, text, color) {
    sc.floaters.push({ x: x + rand(-8, 8), y, text, color, t: 0 });
  }
  function burst(x, y, color, n, spread = 80) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      sc.particles.push({ x, y, vx: rand(-spread, spread), vy: rand(-spread * 1.6, -spread * 0.4), life: rand(0.4, 0.9), t: 0, c: color, s: rand(2, 4), g: 260 });
    }
  }

  function renderScene(dt) {
    sc.t += dt;
    sc.swing = Math.max(0, sc.swing - dt * 4);
    ctx.setTransform(sc.dpr, 0, 0, sc.dpr, 0, 0);
    drawSky();
    drawHills(sc.hillsFar, '#2b1d36', sc.h * 0.05, sc.h * 0.16);
    drawArk();
    drawHills(sc.hillsNear, '#211629', 0, sc.h * 0.09);
    ctx.fillStyle = '#1b1322';
    ctx.fillRect(0, sc.ground, sc.w, sc.h - sc.ground);
    ctx.fillStyle = '#2a1e30';
    ctx.fillRect(0, sc.ground, sc.w, 3);

    drawHeap();
    drawBench();
    drawBay();

    // Sparks at the bay while repairs progress.
    if (S.repair && S.repair.progress !== sc.lastRepair) {
      sc.repairFx += dt;
      if (sc.repairFx > 0.12) { sc.repairFx = 0; burst(X.bay() + rand(-10, 10), sc.ground - 20 * unit(), '#f3c24f', 2, 50); }
    }
    sc.lastRepair = S.repair ? S.repair.progress : 0;

    syncBots();
    const order = sc.bots.slice().sort((a, b) => a.y - b.y);
    for (const b of sc.bots) updateBot(b, dt);
    for (const b of order) {
      const walking = b.state === 'walk' || b.state === 'toHeap' || b.state === 'toBench';
      const working = b.state === 'dig' || b.state === 'work';
      drawBot(b.x, sc.ground + 4 + b.y * unit() * 0.6, b.role, b.phase, { walking, working, carry: b.carry, dir: b.dir });
      if (b.state === 'dig' && Math.random() < dt * 3) burst(b.x - 6, sc.ground, '#a9572f', 1, 40);
    }
    drawPlayer();

    for (const p of sc.particles) {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || -20) * dt;
      ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
      ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    sc.particles = sc.particles.filter((p) => p.t < p.life);

    ctx.font = `600 ${Math.round(14 * unit())}px "IBM Plex Mono", monospace`;
    ctx.textAlign = 'center';
    for (const f of sc.floaters) {
      f.t += dt;
      ctx.globalAlpha = clamp(1.2 - f.t, 0, 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - f.t * 40);
    }
    ctx.globalAlpha = 1;
    sc.floaters = sc.floaters.filter((f) => f.t < 1.2);

    // Crowd counters when there are more robots than we draw.
    ctx.font = `500 ${Math.round(11 * unit())}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = 'rgba(241,231,220,0.75)';
    const label = (role, x) => { if (S.robots[role] > VISIBLE_CAP[role]) ctx.fillText(`×${fmt(S.robots[role])}`, x, sc.h - 10); };
    label('digger', X.heap() + 30); label('sorter', X.bench()); label('mechanic', X.bay());
  }

  // ───────────── Actions ─────────────
  function doDig() {
    const n = C.dig(S);
    sc.swing = 1;
    floater(X.heap(), sc.ground - heapHeight() - 10, `+${fmt(n)}`, css('--rust'));
    burst(X.heap() + 10, sc.ground - heapHeight() * 0.6, '#a9572f', 3);
    afterAction();
  }
  function doSort() {
    const before = Math.floor(S.cores);
    const n = C.disassemble(S);
    if (!n) { floater(X.bench(), sc.ground - 40, 'мало хлама', css('--dim')); return; }
    floater(X.bench(), sc.ground - 40 * unit(), `+${fmt(n)} дет.`, css('--verdigris'));
    if (Math.floor(S.cores) > before) floater(X.bench(), sc.ground - 64 * unit(), '+ядро', css('--core'));
    afterAction();
  }
  function doRepair() {
    const built = S.built;
    const n = C.repairClick(S);
    if (!n) { floater(X.bay(), sc.ground - 60 * unit(), `нужно ${fmt(C.derived(S).robotCost)} дет.`, css('--dim')); return; }
    burst(X.bay(), sc.ground - 20 * unit(), '#f3c24f', 4, 60);
    if (S.built > built) floater(X.bay(), sc.ground - 70 * unit(), 'робот готов!', css('--lamp'));
    afterAction();
  }
  function afterAction() { checkStory(false); renderUI(true); }

  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < (X.player() + X.bench()) / 2) doDig();
    else if (x < (X.bench() + X.bay()) / 2) doSort();
    else doRepair();
  });
  $('act-dig').addEventListener('click', doDig);
  $('act-sort').addEventListener('click', doSort);
  $('act-repair').addEventListener('click', doRepair);

  const keyTimes = {};
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input') || !$('modal').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const act = { KeyQ: doDig, Digit1: doDig, KeyW: doSort, Digit2: doSort, KeyE: doRepair, Digit3: doRepair }[e.code];
    if (!act) return;
    e.preventDefault();
    const now = performance.now();
    if (e.repeat && now - (keyTimes[e.code] || 0) < 110) return;
    keyTimes[e.code] = now;
    act();
  });

  // ───────────── Panels ─────────────
  const roleEls = {};
  for (const role of C.ROLES) {
    const m = ROLE_META[role];
    const el = document.createElement('div');
    el.className = 'role';
    el.style.setProperty('--c', `var(${m.color})`);
    el.innerHTML = `
      <span class="role-name">${m.name}</span>
      <span class="role-ctl">
        <button class="mini" data-d="-1" aria-label="Снять одного">−</button>
        <span class="role-count">0</span>
        <button class="mini" data-d="1" aria-label="Назначить одного">+</button>
        <button class="mini wide" data-d="all" aria-label="Назначить всех свободных">все</button>
      </span>
      <span class="role-desc"></span>`;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      C.assign(S, role, btn.dataset.d === 'all' ? S.robots.idle : Number(btn.dataset.d));
      renderUI(true);
    });
    $('roles').append(el);
    roleEls[role] = {
      count: el.querySelector('.role-count'), desc: el.querySelector('.role-desc'),
      minus: el.querySelector('[data-d="-1"]'), plus: el.querySelector('[data-d="1"]'), all: el.querySelector('[data-d="all"]'),
    };
  }
  $('auto-repair').addEventListener('change', (e) => { S.autoRepair = e.target.checked; });

  function costHtml(cost) {
    let h = '';
    if (cost.parts) h += `<span class="cost ${S.parts < cost.parts ? 'short' : ''}"><i class="ico parts"></i>${fmt(cost.parts)}</span>`;
    if (cost.cores) h += `<span class="cost ${S.cores < cost.cores ? 'short' : ''}"><i class="ico core"></i>${fmt(cost.cores)}</span>`;
    return h;
  }

  const upEls = {};
  for (const u of C.UPGRADES) {
    const b = document.createElement('button');
    b.className = 'up'; b.hidden = true;
    b.innerHTML = `<span class="up-name">${u.name}</span><span class="up-lvl"></span><span class="up-desc">${u.desc}</span><span class="up-cost"></span>`;
    b.addEventListener('click', () => {
      if (C.buy(S, u.id)) { burst(X.bench(), sc.ground - 30, '#f3c24f', 8); renderUI(true); }
    });
    $('upgrades').append(b);
    upEls[u.id] = { b, lvl: b.querySelector('.up-lvl'), cost: b.querySelector('.up-cost') };
  }

  const stageEls = C.ARK.map((st, i) => {
    const li = document.createElement('li');
    li.className = 'stage';
    li.innerHTML = `<span class="num">${i + 1}/${C.ARK.length}</span><span><span class="stage-name">${st.name}</span><span class="stage-cost"></span></span><button class="btn primary">Построить</button>`;
    li.querySelector('button').addEventListener('click', () => {
      if (C.buildArk(S)) {
        burst(X.ark(), sc.ground - 60, '#f3c24f', 20, 100);
        checkStory(false);
        if (S.launched) onLaunch();
        renderUI(true);
      }
    });
    $('stages').append(li);
    return { li, cost: li.querySelector('.stage-cost'), btn: li.querySelector('button') };
  });

  const ui = {};
  function setText(el, text) { if (ui[el.id || el] !== text) { el.textContent = text; if (el.id) ui[el.id] = text; } }

  let uiTimer = 0;
  let uiReady = false; // highlight upgrades only when they unlock during play
  function renderUI(force) {
    if (!force && (uiTimer += 1) % 6) return; // ~10 Hz at 60 fps
    const d = C.derived(S), r = C.rates(S);

    setText($('r-scrap'), fmt(S.scrap));
    setText($('r-parts'), fmt(S.parts));
    setText($('r-cores'), fmt(S.cores));
    setText($('r-robots'), fmt(S.built));
    setText($('r-scrap-rate'), rateText(r.scrap));
    $('r-scrap-rate').classList.toggle('neg', r.scrap < 0);
    setText($('r-parts-rate'), rateText(r.parts));
    setText($('r-cores-rate'), r.cores >= 0.01 ? `+${fixed1.format(r.cores * 60)}/мин` : '');
    $('chip-cores').hidden = S.stats.cores < 1;
    $('chip-robots').hidden = S.built < 1;
    $('chip-bp').hidden = S.blueprints < 1;
    setText($('r-bp'), fmt(S.blueprints));
    setText($('r-bp-bonus'), `+${S.blueprints * 10}%`);
    setText($('run-label'), S.runs ? `Рассвет №${S.runs + 1}` : 'День первый');

    setText($('dig-sub'), `+${fmt(d.click)} хлам`);
    setText($('sort-sub'), `${d.ratio * d.batch} хлама → ${d.batch} дет.`);
    $('act-sort').disabled = S.scrap < d.ratio;
    if (S.repair) {
      setText($('repair-name'), 'Чинить робота');
      setText($('repair-sub'), `+${d.wrench} к ремонту · ${fmt(S.repair.progress)}/${S.repair.need}`);
      $('repair-bar').style.width = `${(S.repair.progress / S.repair.need) * 100}%`;
      $('act-repair').disabled = false;
    } else {
      setText($('repair-name'), S.built ? 'Чинить следующего' : 'Чинить робота');
      setText($('repair-sub'), `нужно ${fmt(d.robotCost)} деталей`);
      $('repair-bar').style.width = '0%';
      $('act-repair').disabled = S.parts < d.robotCost;
    }

    // Crew
    $('sec-robots').hidden = S.built < 1;
    setText($('idle-label'), S.robots.idle ? `свободны: ${S.robots.idle}` : 'все при деле');
    const per = { digger: d.digger, sorter: d.sorter, mechanic: d.mechanic };
    for (const role of C.ROLES) {
      const e = roleEls[role];
      setText(e.count, String(S.robots[role]));
      const extra = role === 'sorter' ? ` · ${d.ratio} хлама → 1` : '';
      setText(e.desc, `${fixed1.format(per[role])} ${ROLE_META[role].unit} каждый${extra}`);
      e.minus.disabled = S.robots[role] === 0;
      e.plus.disabled = e.all.disabled = S.robots.idle === 0;
    }
    $('auto-wrap').hidden = !(S.robots.mechanic > 0 || C.lvl(S, 'factory') > 0);
    $('auto-repair').checked = S.autoRepair;

    // Workshop
    let shown = 0;
    for (const u of C.UPGRADES) {
      const st = C.upgradeState(S, u.id), e = upEls[u.id];
      const hide = !st.unlocked;
      if (e.b.hidden !== hide) {
        e.b.hidden = hide;
        if (!hide && uiReady) e.b.classList.add('fresh');
      }
      if (hide) continue;
      shown++;
      setText(e.lvl, u.max === 1 ? (st.maxed ? 'есть' : '') : `${st.level}/${u.max}`);
      const ch = st.maxed ? '<span class="muted">готово</span>' : costHtml(st.cost);
      if (e.cost._h !== ch) { e.cost.innerHTML = ch; e.cost._h = ch; }
      const poor = !st.maxed && !C.canAfford(S, st.cost);
      e.b.classList.toggle('poor', poor);
      e.b.classList.toggle('maxed', st.maxed);
      e.b.disabled = st.maxed || poor;
    }
    $('up-hint').hidden = shown >= C.UPGRADES.length;

    // Ark
    $('sec-ark').hidden = !C.arkUnlocked(S);
    setText($('ark-label'), S.launched ? 'улетел' : `${S.ark}/${C.ARK.length}`);
    $('stages').hidden = S.launched;
    $('ark-done').hidden = !S.launched;
    if (S.launched) setText($('btn-prestige'), `Новый рассвет: +${C.blueprintGain(S)} ${plural(C.blueprintGain(S), 'чертёж', 'чертежа', 'чертежей')}`);
    stageEls.forEach((e, i) => {
      const st = C.ARK[i];
      e.li.classList.toggle('done', i < S.ark);
      e.li.classList.toggle('next', i === S.ark);
      e.btn.hidden = i !== S.ark;
      e.btn.disabled = !C.canAfford(S, st);
      const ch = i < S.ark ? '' : costHtml(st);
      if (e.cost._h !== ch) { e.cost.innerHTML = ch; e.cost._h = ch; }
    });
  }

  // ───────────── Modal ─────────────
  function modal(title, bodyHtml, actions) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHtml;
    const box = $('modal-actions');
    box.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = `btn ${a.primary ? 'primary' : ''}`;
      b.textContent = a.label;
      b.addEventListener('click', () => { $('modal').hidden = true; a.run?.(); });
      box.append(b);
    }
    $('modal').hidden = false;
    box.lastChild?.focus();
  }

  function onLaunch() {
    sc.launch = sc.t;
    save();
    const gain = C.blueprintGain(S);
    setTimeout(() => modal('Ковчег взлетел',
      `<p>Свалка провожает его щелчками сотен роботов. Ты остаёшься на земле, но небо уже светлеет.</p>
       <p>За ${duration(S.time)} ты собрал ${fmt(S.stats.parts)} деталей и починил ${S.built} ${plural(S.built, 'робота', 'роботов', 'роботов')}.</p>
       <p>«Новый рассвет» начнёт всё сначала, но даст <b>${gain} ${plural(gain, 'чертёж', 'чертежа', 'чертежей')}</b>: каждый навсегда ускоряет всю работу на 10%.</p>`,
      [{ label: 'Посмотреть ещё' }, { label: 'Новый рассвет', primary: true, run: doPrestige }]), reduceMotion ? 0 : 3500);
  }

  function doPrestige() {
    if (!S.launched) return;
    S = C.prestige(S);
    sc.bots = []; sc.launch = null;
    $('log').innerHTML = '';
    checkStory(false);
    addLog(`Новый рассвет. В тетради ${S.blueprints} ${plural(S.blueprints, 'чертёж', 'чертежа', 'чертежей')}, руки помнят больше.`);
    save();
    renderUI(true);
  }
  $('btn-prestige').addEventListener('click', doPrestige);

  let resetArmed = null;
  $('btn-reset').addEventListener('click', () => {
    const b = $('btn-reset');
    if (!resetArmed) {
      b.textContent = 'Точно? Нажми ещё раз';
      resetArmed = setTimeout(() => { b.textContent = 'Начать с нуля'; resetArmed = null; }, 3000);
      return;
    }
    clearTimeout(resetArmed); resetArmed = null;
    b.textContent = 'Начать с нуля';
    S = C.newState();
    sc.bots = []; sc.launch = null;
    $('log').innerHTML = '';
    checkStory(false);
    save();
    renderUI(true);
  });

  // ───────────── Cloud saves (only when served by the Go backend) ─────────────
  function newCode() {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => abc[b % abc.length]).join('');
  }
  const pretty = (code) => code.match(/.{1,4}/g).join('-');
  const cleanCode = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  async function cloudPut(code) {
    const res = await fetch(`/api/saves/${code}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async function initCloud() {
    try {
      const res = await fetch('/healthz');
      if (!res.ok || (await res.text()).trim() !== 'ok') return;
    } catch { return; }
    $('cloud').hidden = false;
    let code = store.get(CLOUD_KEY);
    if (code) $('cloud-code').textContent = pretty(code);

    $('btn-cloud-save').addEventListener('click', async () => {
      code = code || newCode();
      try {
        await cloudPut(code);
        store.set(CLOUD_KEY, code);
        $('cloud-code').textContent = pretty(code);
        $('cloud-msg').textContent = 'Сохранено. Введи этот код на другом устройстве.';
      } catch (err) { $('cloud-msg').textContent = `Не удалось сохранить: ${err.message}`; }
    });

    $('cloud-load').addEventListener('submit', async (e) => {
      e.preventDefault();
      const c = cleanCode($('cloud-input').value);
      if (c.length !== 16) { $('cloud-msg').textContent = 'Код состоит из 16 букв и цифр.'; return; }
      try {
        const res = await fetch(`/api/saves/${c}`);
        if (res.status === 404) { $('cloud-msg').textContent = 'Сохранения с таким кодом нет.'; return; }
        if (!res.ok) throw new Error(await res.text());
        S = C.migrate(await res.json());
        code = c; store.set(CLOUD_KEY, c);
        $('cloud-code').textContent = pretty(c);
        sc.bots = []; sc.launch = null;
        rebuildLog(); save(); renderUI(true);
        $('cloud-msg').textContent = 'Загружено.';
      } catch (err) { $('cloud-msg').textContent = `Не удалось загрузить: ${err.message}`; }
    });

    // Quietly keep the cloud copy fresh once the player has a code.
    setInterval(() => { if (code) cloudPut(code).catch(() => {}); }, 60000);
  }

  // ───────────── Boot ─────────────
  function boot() {
    resizeScene();
    const savedAt = load();
    rebuildLog();
    checkStory(false);
    if (savedAt) {
      const away = (Date.now() - savedAt) / 1000;
      if (away > 30 && !S.launched) {
        const g = C.offline(S, away);
        if (g.scrap >= 1 || g.parts >= 1) {
          checkStory(false);
          const items = [];
          if (g.scrap >= 1) items.push(`<li>+${fmt(g.scrap)} хлама</li>`);
          if (g.parts >= 1) items.push(`<li>+${fmt(g.parts)} деталей</li>`);
          if (g.cores >= 1) items.push(`<li>+${fmt(g.cores)} ${plural(Math.floor(g.cores), 'ядро', 'ядра', 'ядер')}</li>`);
          if (g.robots) items.push(`<li>+${g.robots} ${plural(g.robots, 'робот', 'робота', 'роботов')} в строю</li>`);
          modal('Пока тебя не было', `<p>Бригада работала ${duration(Math.min(away, 8 * 3600))}${away > 8 * 3600 ? ' (больше восьми часов роботы без присмотра не работают)' : ''}:</p><ul>${items.join('')}</ul>`,
            [{ label: 'Отлично', primary: true }]);
        }
      }
    }
    renderUI(true);
    uiReady = true;
    initCloud();

    let last = performance.now();
    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      C.tick(S, dt);
      if (S.built !== frame.built) { checkStory(false); frame.built = S.built; }
      renderScene(dt);
      renderUI(false);
      if (now - lastSave > 5000) save();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Ticks run in rAF, so a hidden tab catches up through the offline path on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
    else {
      const raw = store.get(SAVE_KEY);
      try {
        const away = (Date.now() - JSON.parse(raw).savedAt) / 1000;
        if (away > 2) { C.offline(S, away); save(); checkStory(false); renderUI(true); }
      } catch { /* nothing saved yet */ }
    }
  });
  window.addEventListener('pagehide', save);

  boot();
})();
