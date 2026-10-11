'use strict';
// Дозор — board drawing, input, animation of turn events, overlays and persistence. Rules: core.js (window.GuardCore).
(() => {
  const C = window.GuardCore;
  const T = (k, v) => I18n.t(k, v);
  const P = (n, forms) => I18n.p(n, forms);
  const SAVE_KEY = 'guard.run', BEST_KEY = 'guard.best', NAME_KEY = 'guard.name', SOUND_KEY = 'guard.sound';
  const BOARD_URL = '/api/boards/guard/scores';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };
  const HERO_COLOR = { knight: '#8fb8ff', archer: '#8ee59a', mage: '#c9a0ff' };
  const TILE_NAME = { g: 'Трава', f: 'Роща', w: 'Вода', m: 'Скала', h: 'Дом', r: 'Руины' };
  const TILE_ABOUT = {
    g: 'Обычная земля.',
    f: 'Деревья не мешают ни ходить, ни стрелять.',
    w: 'Враг, которого столкнули в воду, тонет. Нетопыри летают над ней, хранители в неё не заходят.',
    m: 'Преграда. Кто ударится о скалу, получит 1 урона, а скала треснет. После двух ударов рассыпается.',
    h: 'Дом с фонарём. Если его разрушат, деревня теряет фонарь. Удар о дом тоже разрушает его.',
    r: 'Здесь был дом. Теперь по руинам можно ходить.',
  };

  // ───────────── Sound ─────────────
  let ac = null, soundOn = store.get(SOUND_KEY, '1') === '1';
  function tone(freq, at, dur, type = 'sine', vol = 0.12, slide = 0) {
    if (!soundOn) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.05);
    } catch { /* audio is optional */ }
  }
  const sfx = {
    select: () => tone(520, 0, 0.08, 'triangle', 0.06),
    step: () => tone(300, 0, 0.08, 'triangle', 0.06, -80),
    hit: () => { tone(160, 0, 0.16, 'square', 0.07, -60); tone(90, 0.02, 0.2, 'sine', 0.12); },
    bump: () => tone(110, 0, 0.14, 'sine', 0.14, -40),
    shot: () => tone(900, 0, 0.12, 'triangle', 0.05, -600),
    whirl: () => { tone(300, 0, 0.3, 'sawtooth', 0.04, 400); tone(200, 0.05, 0.3, 'sine', 0.06, 300); },
    house: () => { tone(220, 0, 0.4, 'sawtooth', 0.06, -150); tone(70, 0.05, 0.5, 'sine', 0.14); },
    die: () => tone(400, 0, 0.25, 'triangle', 0.06, -300),
    splash: () => { tone(600, 0, 0.2, 'sine', 0.06, -400); tone(240, 0.05, 0.25, 'sine', 0.05, -100); },
    emerge: () => tone(90, 0, 0.5, 'sawtooth', 0.04, 60),
    win: () => [392, 494, 587, 784].forEach((f, i) => tone(f, i * 0.12, 0.4, 'triangle', 0.1)),
    lose: () => [330, 262, 196].forEach((f, i) => tone(f, i * 0.2, 0.5, 'sine', 0.1)),
  };

  // ───────────── State ─────────────
  let run = null;
  let sel = null, mode = 'move', hover = null;
  let undo = [], turnStart = null;
  let disp = null, effects = [], busy = false;
  const now = () => performance.now();

  function save() { if (run) store.set(SAVE_KEY, JSON.stringify(run)); }
  function loadSaved() {
    try {
      const r = JSON.parse(store.get(SAVE_KEY, 'null'));
      if (r && r.v === 1 && (r.status === 'battle' || r.status === 'reward')) return r;
    } catch { /* corrupt save */ }
    return null;
  }

  // ───────────── Layout ─────────────
  const canvas = $('board');
  // Drawing helpers use this ctx; iconURL() points it at a small canvas for a moment.
  let ctx = canvas.getContext('2d');
  let DPR = 1, SIZE = 480, TS = 60;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const wide = window.innerWidth > 900;
    const availW = wide ? Math.min(window.innerWidth - 32 - 338, 760) : Math.min(window.innerWidth - 32, 560);
    const availH = wide ? window.innerHeight - 80 : Infinity;
    SIZE = Math.max(280, Math.floor(Math.min(availW, availH) / 8) * 8);
    TS = SIZE / 8;
    canvas.width = SIZE * DPR; canvas.height = SIZE * DPR;
    canvas.style.width = `${SIZE}px`; canvas.style.height = `${SIZE}px`;
  }

  // ───────────── Drawing ─────────────
  const rnd = (x, y, k) => { const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function drawTile(t, x, y, time) {
    const px = x * TS, py = y * TS;
    const shade = ((x + y) % 2 ? 0 : 6);
    if (t.t === 'w') {
      ctx.fillStyle = '#1c4f80'; ctx.fillRect(px, py, TS, TS);
      ctx.strokeStyle = 'rgba(160, 210, 255, .35)'; ctx.lineWidth = 1.5;
      for (let k = 0; k < 3; k++) {
        const yy = py + TS * (0.28 + k * 0.24), off = Math.sin(time / 700 + x + k) * TS * 0.08;
        ctx.beginPath(); ctx.moveTo(px + TS * 0.2 + off, yy); ctx.quadraticCurveTo(px + TS * 0.35 + off, yy - 4, px + TS * 0.5 + off, yy); ctx.quadraticCurveTo(px + TS * 0.65 + off, yy + 4, px + TS * 0.8 + off, yy); ctx.stroke();
      }
      return;
    }
    ctx.fillStyle = `rgb(${38 + shade}, ${70 + shade}, ${52 + shade})`;
    ctx.fillRect(px, py, TS, TS);
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = 'rgba(120, 170, 120, .12)';
      ctx.fillRect(px + rnd(x, y, k) * TS * 0.9, py + rnd(x, y, k + 9) * TS * 0.9, 2, 4);
    }
    if (t.t === 'f') {
      for (const [ox, oy, s] of [[0.32, 0.55, 0.26], [0.66, 0.42, 0.3], [0.55, 0.72, 0.22]]) {
        const cx = px + TS * ox, cy = py + TS * oy, r = TS * s;
        ctx.fillStyle = '#183a2a'; ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.8, cy + r * 0.6); ctx.lineTo(cx - r * 0.8, cy + r * 0.6); ctx.fill();
        ctx.fillStyle = '#21503a'; ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.35, cy + r * 0.6); ctx.lineTo(cx - r * 0.8, cy + r * 0.6); ctx.fill();
      }
    } else if (t.t === 'm') {
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(px + TS / 2, py + TS * 0.8, TS * 0.38, TS * 0.1, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#6f7891';
      ctx.beginPath(); ctx.moveTo(px + TS * 0.12, py + TS * 0.8); ctx.lineTo(px + TS * 0.32, py + TS * 0.3); ctx.lineTo(px + TS * 0.52, py + TS * 0.18); ctx.lineTo(px + TS * 0.74, py + TS * 0.36); ctx.lineTo(px + TS * 0.9, py + TS * 0.8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8d97b1';
      ctx.beginPath(); ctx.moveTo(px + TS * 0.32, py + TS * 0.3); ctx.lineTo(px + TS * 0.52, py + TS * 0.18); ctx.lineTo(px + TS * 0.5, py + TS * 0.8); ctx.lineTo(px + TS * 0.24, py + TS * 0.8); ctx.closePath(); ctx.fill();
      if (t.hp < 2) {
        ctx.strokeStyle = '#2b3146'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px + TS * 0.5, py + TS * 0.22); ctx.lineTo(px + TS * 0.44, py + TS * 0.45); ctx.lineTo(px + TS * 0.56, py + TS * 0.55); ctx.lineTo(px + TS * 0.48, py + TS * 0.78); ctx.stroke();
      }
    } else if (t.t === 'h') {
      const cx = px + TS / 2;
      ctx.fillStyle = 'rgba(255, 207, 107, .10)'; ctx.beginPath(); ctx.arc(cx, py + TS * 0.58, TS * 0.48, 0, 7); ctx.fill();
      ctx.fillStyle = '#7a5a3f'; ctx.fillRect(px + TS * 0.22, py + TS * 0.45, TS * 0.56, TS * 0.38);
      ctx.fillStyle = '#9b3f36'; ctx.beginPath(); ctx.moveTo(px + TS * 0.14, py + TS * 0.48); ctx.lineTo(cx, py + TS * 0.16); ctx.lineTo(px + TS * 0.86, py + TS * 0.48); ctx.closePath(); ctx.fill();
      const flick = 0.8 + Math.sin(time / 180 + x * 3 + y) * 0.1;
      ctx.fillStyle = `rgba(255, 214, 120, ${flick})`; ctx.fillRect(px + TS * 0.32, py + TS * 0.55, TS * 0.14, TS * 0.13); ctx.fillRect(px + TS * 0.54, py + TS * 0.55, TS * 0.14, TS * 0.13);
    } else if (t.t === 'r') {
      ctx.fillStyle = '#3d3632';
      for (const [ox, oy, w, h] of [[0.2, 0.62, 0.3, 0.16], [0.5, 0.55, 0.28, 0.22], [0.32, 0.45, 0.2, 0.12]]) { rr(px + TS * ox, py + TS * oy, TS * w, TS * h, 3); ctx.fill(); }
      ctx.fillStyle = '#5a2f2a'; ctx.beginPath(); ctx.moveTo(px + TS * 0.25, py + TS * 0.6); ctx.lineTo(px + TS * 0.45, py + TS * 0.4); ctx.lineTo(px + TS * 0.55, py + TS * 0.6); ctx.fill();
    }
  }
  function glyph(kind, cx, cy, r) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const L = r;
    if (kind === 'knight') {
      ctx.fillStyle = '#dce8ff'; ctx.beginPath(); ctx.moveTo(0, -L * 0.62); ctx.lineTo(L * 0.5, -L * 0.42); ctx.lineTo(L * 0.42, L * 0.2); ctx.lineTo(0, L * 0.62); ctx.lineTo(-L * 0.42, L * 0.2); ctx.lineTo(-L * 0.5, -L * 0.42); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#4f72b8'; ctx.lineWidth = L * 0.12; ctx.beginPath(); ctx.moveTo(0, -L * 0.4); ctx.lineTo(0, L * 0.38); ctx.moveTo(-L * 0.26, -L * 0.08); ctx.lineTo(L * 0.26, -L * 0.08); ctx.stroke();
    } else if (kind === 'archer') {
      ctx.strokeStyle = '#e8ffe9'; ctx.lineWidth = L * 0.12;
      ctx.beginPath(); ctx.arc(-L * 0.12, 0, L * 0.55, -1.2, 1.2); ctx.stroke();
      ctx.lineWidth = L * 0.05; ctx.beginPath(); ctx.moveTo(L * 0.07, -L * 0.51); ctx.lineTo(L * 0.07, L * 0.51); ctx.stroke();
      ctx.lineWidth = L * 0.08; ctx.beginPath(); ctx.moveTo(-L * 0.5, 0); ctx.lineTo(L * 0.6, 0); ctx.stroke();
      ctx.fillStyle = '#e8ffe9'; ctx.beginPath(); ctx.moveTo(L * 0.7, 0); ctx.lineTo(L * 0.48, -L * 0.12); ctx.lineTo(L * 0.48, L * 0.12); ctx.fill();
    } else if (kind === 'mage') {
      ctx.fillStyle = '#efe2ff'; ctx.beginPath(); ctx.moveTo(-L * 0.55, L * 0.42); ctx.lineTo(L * 0.1, -L * 0.65); ctx.lineTo(L * 0.55, L * 0.42); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7b4fc9'; ctx.beginPath(); ctx.ellipse(0, L * 0.42, L * 0.62, L * 0.13, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffd86b'; star(L * 0.02, -L * 0.02, L * 0.16);
    } else if (kind === 'wolf') {
      ctx.fillStyle = '#e7d9d9';
      ctx.beginPath(); ctx.moveTo(-L * 0.5, -L * 0.55); ctx.lineTo(-L * 0.18, -L * 0.25); ctx.lineTo(L * 0.18, -L * 0.25); ctx.lineTo(L * 0.5, -L * 0.55); ctx.lineTo(L * 0.48, L * 0.05); ctx.lineTo(0, L * 0.6); ctx.lineTo(-L * 0.48, L * 0.05); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(-L * 0.2, -L * 0.02, L * 0.08, 0, 7); ctx.arc(L * 0.2, -L * 0.02, L * 0.08, 0, 7); ctx.fill();
      ctx.fillStyle = '#2b1b1b'; ctx.beginPath(); ctx.arc(0, L * 0.38, L * 0.1, 0, 7); ctx.fill();
    } else if (kind === 'slinger') {
      ctx.fillStyle = '#b8d98c'; ctx.beginPath(); ctx.arc(0, 0, L * 0.42, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-L * 0.38, -L * 0.1); ctx.lineTo(-L * 0.75, -L * 0.32); ctx.lineTo(-L * 0.36, L * 0.1); ctx.moveTo(L * 0.38, -L * 0.1); ctx.lineTo(L * 0.75, -L * 0.32); ctx.lineTo(L * 0.36, L * 0.1); ctx.fill();
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(-L * 0.15, -L * 0.06, L * 0.07, 0, 7); ctx.arc(L * 0.15, -L * 0.06, L * 0.07, 0, 7); ctx.fill();
      ctx.strokeStyle = '#2b1b1b'; ctx.lineWidth = L * 0.07; ctx.beginPath(); ctx.moveTo(-L * 0.16, L * 0.2); ctx.lineTo(L * 0.16, L * 0.2); ctx.stroke();
    } else if (kind === 'bat') {
      ctx.fillStyle = '#d7c8f0';
      ctx.beginPath(); ctx.moveTo(0, -L * 0.15); ctx.quadraticCurveTo(-L * 0.4, -L * 0.6, -L * 0.75, -L * 0.15); ctx.lineTo(-L * 0.55, L * 0.05); ctx.lineTo(-L * 0.4, -L * 0.02); ctx.lineTo(-L * 0.22, L * 0.2); ctx.lineTo(0, L * 0.3);
      ctx.lineTo(L * 0.22, L * 0.2); ctx.lineTo(L * 0.4, -L * 0.02); ctx.lineTo(L * 0.55, L * 0.05); ctx.lineTo(L * 0.75, -L * 0.15); ctx.quadraticCurveTo(L * 0.4, -L * 0.6, 0, -L * 0.15); ctx.fill();
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(-L * 0.08, L * 0.02, L * 0.05, 0, 7); ctx.arc(L * 0.08, L * 0.02, L * 0.05, 0, 7); ctx.fill();
    } else if (kind === 'troll') {
      ctx.fillStyle = '#9fb59a'; rr(-L * 0.55, -L * 0.5, L * 1.1, L * 1.0, L * 0.35); ctx.fill();
      ctx.fillStyle = '#2b1b1b'; ctx.fillRect(-L * 0.38, -L * 0.2, L * 0.28, L * 0.08); ctx.fillRect(L * 0.1, -L * 0.2, L * 0.28, L * 0.08);
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(-L * 0.22, -L * 0.04, L * 0.07, 0, 7); ctx.arc(L * 0.22, -L * 0.04, L * 0.07, 0, 7); ctx.fill();
      ctx.fillStyle = '#f2ecd9'; ctx.beginPath(); ctx.moveTo(-L * 0.3, L * 0.25); ctx.lineTo(-L * 0.22, L * 0.02); ctx.lineTo(-L * 0.14, L * 0.25); ctx.moveTo(L * 0.14, L * 0.25); ctx.lineTo(L * 0.22, L * 0.02); ctx.lineTo(L * 0.3, L * 0.25); ctx.fill();
    }
    ctx.restore();
  }
  function star(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); }
    ctx.closePath(); ctx.fill();
  }
  function unitPos(u, t) {
    if (u.t0 == null) return [u.x, u.y];
    const k = Math.min(1, (t - u.t0) / u.dur), e = 1 - (1 - k) * (1 - k);
    if (k >= 1) { u.t0 = null; return [u.x, u.y]; }
    return [u.fx + (u.x - u.fx) * e, u.fy + (u.y - u.fy) * e];
  }
  function drawUnit(u, t, opts = {}) {
    const [ux, uy] = unitPos(u, t);
    const cx = (ux + 0.5) * TS, cy = (uy + 0.5) * TS, r = TS * 0.34;
    const hero = u.side === 'hero';
    const enemyFlying = !hero && C.ENEMIES[u.kind].flying;
    const bob = enemyFlying ? Math.sin(t / 260 + u.id) * TS * 0.04 - TS * 0.05 : 0;
    ctx.save();
    ctx.globalAlpha = opts.alpha ?? (hero && u.acted ? 0.62 : 1);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.85, r * 0.85, r * 0.28, 0, 0, 7); ctx.fill();
    const ring = hero ? HERO_COLOR[u.kind] : '#e0524f';
    ctx.fillStyle = hero ? '#1e2b48' : '#3a1a24';
    ctx.beginPath(); ctx.arc(cx, cy + bob, r, 0, 7); ctx.fill();
    ctx.lineWidth = TS * 0.06; ctx.strokeStyle = ring; ctx.stroke();
    glyph(u.kind, cx, cy + bob, r * 0.82);
    if (u.elite) { ctx.fillStyle = '#ffcf6b'; star(cx + r * 0.72, cy - r * 0.72 + bob, r * 0.3); }
    // Health pips
    const n = u.maxHp, pw = Math.min(TS * 0.12, (TS * 0.7) / n - 2), total = n * (pw + 2) - 2;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i < u.hp ? (hero ? '#6be08a' : '#ff8a7a') : '#2a334a';
      ctx.fillRect(cx - total / 2 + i * (pw + 2), cy + r + TS * 0.06, pw, TS * 0.08);
    }
    ctx.restore();
  }
  function arrow(x1, y1, x2, y2, color, w) {
    const a = Math.atan2(y2 - y1, x2 - x1), hl = TS * 0.16;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - Math.cos(a) * hl * 0.6, y2 - Math.sin(a) * hl * 0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - Math.cos(a - 0.5) * hl, y2 - Math.sin(a - 0.5) * hl); ctx.lineTo(x2 - Math.cos(a + 0.5) * hl, y2 - Math.sin(a + 0.5) * hl); ctx.closePath(); ctx.fill();
  }
  function drawIntents(b, t) {
    const enemies = b.units.filter((u) => u.side === 'enemy' && u.intent != null).sort((a, c) => a.id - c.id);
    enemies.forEach((u, i) => {
      const tt = C.intentTile(b, u);
      const [ux, uy] = unitPos(u, t);
      const sx = (ux + 0.5) * TS, sy = (uy + 0.5) * TS;
      if (tt) {
        const px = tt.x * TS, py = tt.y * TS;
        const pulse = 0.22 + Math.sin(t / 300) * 0.06;
        ctx.fillStyle = `rgba(255, 80, 80, ${pulse})`; ctx.fillRect(px + 2, py + 2, TS - 4, TS - 4);
        ctx.strokeStyle = 'rgba(255, 110, 110, .9)'; ctx.lineWidth = 2; ctx.strokeRect(px + 3, py + 3, TS - 6, TS - 6);
        const tx = px + TS / 2, ty = py + TS / 2;
        const d = Math.hypot(tx - sx, ty - sy);
        arrow(sx + (tx - sx) / d * TS * 0.36, sy + (ty - sy) / d * TS * 0.36, tx - (tx - sx) / d * TS * 0.18, ty - (ty - sy) / d * TS * 0.18, 'rgba(255, 110, 110, .85)', TS * 0.05);
        ctx.fillStyle = '#ff6464'; ctx.font = `800 ${TS * 0.24}px ${getComputedStyle(document.body).fontFamily}`; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillText(`-${u.dmg}`, px + TS - 5, py + 4);
      } else {
        const [dx, dy] = C.DIRS[u.intent];
        arrow(sx + dx * TS * 0.36, sy + dy * TS * 0.36, sx + dx * TS * 0.62, sy + dy * TS * 0.62, 'rgba(255, 110, 110, .5)', TS * 0.05);
      }
      // Order badge
      ctx.fillStyle = '#ff6464'; ctx.beginPath(); ctx.arc(sx - TS * 0.32, sy - TS * 0.32, TS * 0.12, 0, 7); ctx.fill();
      ctx.fillStyle = '#1a0a0a'; ctx.font = `800 ${TS * 0.16}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), sx - TS * 0.32, sy - TS * 0.31);
    });
  }
  function drawMarks(b, t) {
    for (const m of b.marks) {
      const cx = (m.x + 0.5) * TS, cy = (m.y + 0.5) * TS;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(t / 900);
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = `rgba(190, 120, 255, ${0.55 - k * 0.12})`; ctx.lineWidth = TS * 0.05;
        ctx.beginPath(); ctx.arc(0, 0, TS * (0.16 + k * 0.1), k, k + 4.2); ctx.stroke();
      }
      ctx.restore();
    }
  }
  function draw() {
    const t = now();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (!run) return;
    // During animation the display copy is drawn; while previewing, a what-if copy.
    const pv = !disp && preview();
    const b = disp || (pv ? pv.b : run.b);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) drawTile(C.tileAt(b, x, y), x, y, t);
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * TS, 0); ctx.lineTo(i * TS, SIZE); ctx.moveTo(0, i * TS); ctx.lineTo(SIZE, i * TS); ctx.stroke(); }
    drawMarks(b, t);
    if (!disp) drawSelection(t, pv);
    if (!disp || b.phase === 'player') drawIntents(b, t);
    // Ghost of units that the preview pushes away or kills
    if (pv) {
      for (const u of run.b.units) {
        const after = pv.b.units.find((v) => v.id === u.id);
        if (!after || after.x !== u.x || after.y !== u.y) drawUnit(u, t, { alpha: 0.22 });
      }
    }
    for (const u of b.units) drawUnit(u, t);
    if (pv) drawPreviewMarks(pv);
    drawEffects(t);
    // Night vignette
    const g = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.35, SIZE / 2, SIZE / 2, SIZE * 0.75);
    g.addColorStop(0, 'rgba(5,10,25,0)'); g.addColorStop(1, 'rgba(5,10,25,.45)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
  }
  function drawSelection(t, pv) {
    const u = selected();
    if (!u) return;
    const cx = (u.x + 0.5) * TS, cy = (u.y + 0.5) * TS;
    ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -t / 60;
    ctx.beginPath(); ctx.arc(cx, cy, TS * 0.44, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    if (mode === 'move' && !u.moved) {
      for (const p of C.reach(run.b, u, u.move)) {
        ctx.fillStyle = 'rgba(90, 169, 255, .22)'; ctx.fillRect(p.x * TS + 3, p.y * TS + 3, TS - 6, TS - 6);
        ctx.strokeStyle = 'rgba(90, 169, 255, .55)'; ctx.lineWidth = 1.5; ctx.strokeRect(p.x * TS + 3.5, p.y * TS + 3.5, TS - 7, TS - 7);
      }
      if (hover && C.reach(run.b, u, u.move).some((p) => p.x === hover.x && p.y === hover.y)) drawUnit(Object.assign({}, u, { x: hover.x, y: hover.y, t0: null }), t, { alpha: 0.45 });
    } else if (mode === 'act' && !u.acted) {
      for (const p of C.targets(run.b, u)) {
        ctx.strokeStyle = 'rgba(255, 154, 92, .7)'; ctx.lineWidth = 2; ctx.strokeRect(p.x * TS + 5, p.y * TS + 5, TS - 10, TS - 10);
      }
      if (pv) for (const a of pv.area) {
        ctx.fillStyle = a.main ? 'rgba(255, 154, 92, .4)' : 'rgba(255, 154, 92, .18)';
        ctx.fillRect(a.x * TS + 2, a.y * TS + 2, TS - 4, TS - 4);
      }
    }
  }
  // What happens if the selected hero uses its ability on the hovered tile.
  let pvKey = '', pvCache = null;
  function preview() {
    const u = selected();
    if (!u || mode !== 'act' || u.acted || !hover || busy) return null;
    const tg = C.targets(run.b, u).find((p) => p.x === hover.x && p.y === hover.y);
    if (!tg) return null;
    const key = `${JSON.stringify(run.b.units)}|${u.id}|${hover.x},${hover.y}`;
    if (key === pvKey) return pvCache;
    const r = C.clone(run);
    r.b.log = [];
    C.act(r, r.b, u.id, hover.x, hover.y);
    pvKey = key;
    pvCache = { b: r.b, log: r.b.log, area: C.area(run.b, u, tg), power: r.power };
    return pvCache;
  }
  function drawPreviewMarks(pv) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const dmg = new Map();
    for (const e of pv.log) {
      if (e.t === 'dmg') { const k = `${e.id}`; dmg.set(k, (dmg.get(k) || 0) + e.n); }
    }
    for (const u of run.b.units) {
      const after = pv.b.units.find((v) => v.id === u.id);
      if (after && after.x !== u.x) arrow((u.x + 0.5) * TS, (u.y + 0.5) * TS, (after.x + 0.5) * TS, (after.y + 0.5) * TS, 'rgba(255,255,255,.7)', 2);
      if (after && after.y !== u.y) arrow((u.x + 0.5) * TS, (u.y + 0.5) * TS, (after.x + 0.5) * TS, (after.y + 0.5) * TS, 'rgba(255,255,255,.7)', 2);
      const n = dmg.get(`${u.id}`);
      const at = after || u;
      if (!after) {
        ctx.font = `${TS * 0.4}px sans-serif`; ctx.fillText('💀', (at.x + 0.5) * TS, (at.y + 0.5) * TS);
      } else if (n) {
        ctx.font = `800 ${TS * 0.3}px sans-serif`; ctx.fillStyle = '#ffeb7a'; ctx.strokeStyle = '#2a1508'; ctx.lineWidth = 4;
        ctx.strokeText(`-${n}`, (at.x + 0.5) * TS, (at.y + 0.1) * TS); ctx.fillText(`-${n}`, (at.x + 0.5) * TS, (at.y + 0.1) * TS);
      }
    }
    for (const e of pv.log) {
      if (e.t === 'house') { ctx.font = `${TS * 0.38}px sans-serif`; ctx.fillText('💥', (e.x + 0.5) * TS, (e.y + 0.5) * TS); }
    }
  }

  // ───────────── Effects & event playback ─────────────
  function fx(kind, o) { effects.push(Object.assign({ kind, t0: now(), dur: 600 }, o)); }
  function drawEffects(t) {
    effects = effects.filter((e) => t - e.t0 < e.dur);
    for (const e of effects) {
      const k = (t - e.t0) / e.dur;
      ctx.save();
      if (e.kind === 'text') {
        ctx.globalAlpha = 1 - k; ctx.font = `800 ${TS * 0.32}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = e.color || '#ff6464'; ctx.strokeStyle = '#120808'; ctx.lineWidth = 4;
        const y = (e.y + 0.3) * TS - k * TS * 0.5;
        ctx.strokeText(e.text, (e.x + 0.5) * TS, y); ctx.fillText(e.text, (e.x + 0.5) * TS, y);
      } else if (e.kind === 'line') {
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = e.color; ctx.lineWidth = TS * 0.08 * (1 - k * 0.5);
        ctx.beginPath(); ctx.moveTo((e.x + 0.5) * TS, (e.y + 0.5) * TS); ctx.lineTo((e.tx + 0.5) * TS, (e.ty + 0.5) * TS); ctx.stroke();
      } else if (e.kind === 'proj') {
        const x = e.x + (e.tx - e.x) * Math.min(1, k * 1.2), y = e.y + (e.ty - e.y) * Math.min(1, k * 1.2);
        ctx.fillStyle = e.color; ctx.beginPath(); ctx.arc((x + 0.5) * TS, (y + 0.5) * TS, TS * 0.08, 0, 7); ctx.fill();
      } else if (e.kind === 'ring') {
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = e.color; ctx.lineWidth = TS * 0.06;
        ctx.beginPath(); ctx.arc((e.x + 0.5) * TS, (e.y + 0.5) * TS, TS * (0.2 + k * (e.r || 0.6)), 0, 7); ctx.stroke();
      } else if (e.kind === 'ghost') {
        ctx.globalAlpha = (1 - k) * 0.8; drawUnit(Object.assign({}, e.u, { t0: null }), t, { alpha: (1 - k) * 0.8 });
      }
      ctx.restore();
    }
  }
  const DUR = { move: 170, dmg: 90, die: 160, house: 260, rock: 110, bump: 140, shot: 190, strike: 330, blocked: 220, emerge: 240, act: 120 };
  // Replays core events on a display copy, so the real state jumps but the picture moves step by step.
  function play(before, events, done) {
    if (!events.length || reduceMotion) { disp = null; done(); return; }
    disp = C.clone(before);
    busy = true;
    const finalUnits = run.b.units;
    let i = 0;
    const step = () => {
      if (i >= events.length) { disp = null; busy = false; done(); return; }
      const e = events[i++];
      let wait = DUR[e.t] || 100;
      const u = e.id != null ? disp.units.find((v) => v.id === e.id) : null;
      switch (e.t) {
        case 'move':
          if (u) { u.fx = u.x; u.fy = u.y; u.x = e.tx; u.y = e.ty; u.t0 = now(); u.dur = e.push ? 140 : 170; }
          if (e.push) sfx.bump(); else if (!e.enemy) sfx.step();
          wait = e.enemy ? 120 : wait;
          break;
        case 'dmg':
          if (u) u.hp -= e.n;
          fx('text', { x: e.x, y: e.y, text: `-${e.n}`, dur: 800 });
          sfx.hit();
          break;
        case 'die':
          if (u) { disp.units = disp.units.filter((v) => v !== u); fx('ghost', { u, dur: 500 }); }
          if (e.why === 'drown') { sfx.splash(); fx('ring', { x: e.x, y: e.y, color: '#9fd3ff', dur: 600 }); } else sfx.die();
          break;
        case 'house': {
          const tt = C.tileAt(disp, e.x, e.y); tt.t = 'r';
          fx('ring', { x: e.x, y: e.y, color: '#ff8a5c', r: 0.8, dur: 700 });
          fx('text', { x: e.x, y: e.y, text: T('−фонарь'), color: '#ffcf6b', dur: 1100 });
          sfx.house();
          flashLanterns();
          break;
        }
        case 'rock': { const tt = C.tileAt(disp, e.x, e.y); tt.hp -= 1; if (e.broke) tt.t = 'r'; sfx.bump(); break; }
        case 'bump': fx('ring', { x: e.tx, y: e.ty, color: '#ffffff', r: 0.3, dur: 300 }); break;
        case 'shot': fx('proj', { x: e.x, y: e.y, tx: e.tx, ty: e.ty, color: '#d9ffe0', dur: 200 }); sfx.shot(); break;
        case 'act':
          if (e.kind === 'mage') { fx('ring', { x: e.x, y: e.y, color: '#c9a0ff', r: 0.9, dur: 500 }); sfx.whirl(); }
          else if (e.kind === 'knight') { fx('ring', { x: e.x, y: e.y, color: '#8fb8ff', r: 0.4, dur: 300 }); }
          break;
        case 'strike':
          if (u) u.intent = null;
          if (e.tx != null) {
            if (e.kind === 'slinger') fx('proj', { x: e.x, y: e.y, tx: e.tx, ty: e.ty, color: '#d0c3a5', dur: 260 });
            else fx('line', { x: e.x, y: e.y, tx: e.tx, ty: e.ty, color: '#ff5050', dur: 320 });
          }
          break;
        case 'blocked': fx('ring', { x: e.x, y: e.y, color: '#be78ff', r: 0.5, dur: 500 }); break;
        case 'emerge': {
          const nu = finalUnits.find((v) => v.id === e.id);
          disp.units.push(C.clone(nu || { id: e.id, side: 'enemy', kind: e.kind, x: e.x, y: e.y, hp: 1, maxHp: 1 }));
          const du = disp.units[disp.units.length - 1]; du.x = e.x; du.y = e.y; du.intent = null;
          disp.marks = disp.marks.filter((m) => m.x !== e.x || m.y !== e.y);
          fx('ring', { x: e.x, y: e.y, color: '#be78ff', r: 0.6, dur: 500 });
          sfx.emerge();
          break;
        }
        default: break;
      }
      setTimeout(step, wait);
    };
    step();
  }

  // ───────────── Panel ─────────────
  function selected() { return sel == null || !run ? null : run.b.units.find((u) => u.id === sel) || null; }
  const iconCache = {};
  function iconURL(kind) {
    if (iconCache[kind]) return iconCache[kind];
    const c = document.createElement('canvas');
    c.width = c.height = 76;
    const board = ctx;
    ctx = c.getContext('2d');
    ctx.fillStyle = '#1e2b48'; ctx.beginPath(); ctx.arc(38, 38, 34, 0, 7); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = HERO_COLOR[kind] || '#e0524f'; ctx.stroke();
    glyph(kind, 38, 38, 26);
    ctx = board;
    iconCache[kind] = c.toDataURL();
    return iconCache[kind];
  }

  function heroName(k) { return T(C.HEROES[k].name); }
  function abilityText(u) {
    let s = T(C.HEROES[u.kind].about, { dmg: u.dmg });
    if (u.kind === 'mage' && u.hurt) s += ` ${T('Расталкиваемые получают 1 урона.')}`;
    return s;
  }
  function renderHeroes() {
    const box = $('heroes');
    box.innerHTML = '';
    for (const k of C.HERO_ORDER) {
      const u = run.b.units.find((v) => v.side === 'hero' && v.kind === k);
      const maxHp = run.heroes[k].hp;
      const el = document.createElement('div');
      el.className = `hero${u && sel === u.id ? ' sel' : ''}${u && u.acted ? ' done' : ''}${u ? '' : ' ko'}`;
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      const hp = u ? u.hp : 0;
      const status = !u ? T('без сил до конца битвы') : u.acted ? T('ход сделан') : u.moved ? T('может действовать') : T('готов');
      el.innerHTML = `<img class="ic" alt="" src="${iconURL(k)}"><div><div class="nm">${esc(heroName(k))}</div><div class="st">${esc(status)}</div></div>
        <div class="hp">${Array.from({ length: maxHp }, (_, i) => `<i class="${i < hp ? '' : 'off'}"></i>`).join('')}</div>`;
      if (u) {
        const sk = document.createElement('div');
        sk.className = 'skill';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = T(C.HEROES[k].ability);
        btn.className = sel === u.id && mode === 'act' ? 'on' : '';
        btn.disabled = u.acted || busy || run.b.phase !== 'player';
        btn.addEventListener('click', (e) => { e.stopPropagation(); select(u.id, 'act'); });
        sk.appendChild(btn);
        const small = document.createElement('small');
        small.textContent = T('шаг {n}', { n: u.move });
        sk.appendChild(small);
        el.appendChild(sk);
        el.addEventListener('click', () => select(u.id));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(u.id); } });
      }
      box.appendChild(el);
    }
  }
  function renderStatus() {
    const b = run.b;
    $('isle').textContent = T('Остров {n} из {m} · {name}', { n: run.battle + 1, m: C.BATTLES.length, name: T(C.ISLANDS[run.battle]) });
    const lan = $('lanterns');
    const prev = lan.querySelectorAll('i.on').length;
    lan.innerHTML = Array.from({ length: C.MAX_POWER }, (_, i) => `<i class="${i < run.power ? 'on' : ''}"></i>`).join('');
    lan.setAttribute('aria-label', T('Фонари деревни: {n} из {m}', { n: run.power, m: C.MAX_POWER }));
    lan.title = T('Фонари деревни: {n} из {m}', { n: run.power, m: C.MAX_POWER });
    if (prev > run.power) for (let i = run.power; i < prev; i++) lan.children[i] && lan.children[i].classList.add('lost');
    $('turn').textContent = T('Ход {n} из {m}', { n: b.turn, m: b.turns });
    const o = b.objective;
    const done = C.objectiveDone(b);
    const txt = o.kind === 'kills' ? T('Задача: победи {n} врагов ({k}/{n})', { n: o.n, k: Math.min(b.kills, o.n) }) : T('Задача: не потеряй ни одного дома');
    $('objective').innerHTML = `${esc(txt)} <span class="${done ? 'ok' : ''}">${done ? '✓' : ''}</span><br>${esc(T('Награда: +1 фонарь'))}`;
    $('btn-undo').disabled = busy || !undo.length || undo[undo.length - 1].kind !== 'move';
    $('btn-reset').disabled = busy || !turnStart || !(run.b.resets > 0) || !undo.length;
    $('btn-reset').textContent = T('Заново ход ({n})', { n: run.b.resets || 0 });
    $('btn-end').disabled = busy || run.b.phase !== 'player' || run.status !== 'battle';
    const left = run.b.units.filter((v) => v.side === 'hero' && !v.acted).length;
    $('btn-end').classList.toggle('ready', left === 0 && !busy);
  }
  function renderInfo() {
    const box = $('info');
    const b = run.b;
    let html = '';
    const at = hover || null;
    const su = selected();
    const unit = at ? C.unitAt(b, at.x, at.y) : null;
    if (unit && unit.side === 'enemy') {
      const e = C.ENEMIES[unit.kind];
      const tt = C.intentTile(b, unit);
      html = `<h3>${esc(T(e.name))}${unit.elite ? ` ★` : ''}</h3><p>${esc(T('Здоровье {hp} из {max}, урон {dmg}', { hp: unit.hp, max: unit.maxHp, dmg: unit.dmg }))}</p><p>${esc(T(e.about))}</p>`;
      if (unit.elite) html += `<p>${esc(T('★ Вожак: +1 к здоровью и урону.'))}</p>`;
      if (tt) {
        const o = C.unitAt(b, tt.x, tt.y), t = C.tileAt(b, tt.x, tt.y);
        const what = o ? (o.side === 'hero' ? T('по хранителю') : T('по своему же')) : t.t === 'h' ? T('по дому!') : t.t === 'm' ? T('по скале') : T('в пустоту');
        html += `<p class="${t.t === 'h' && !o ? 'warn' : ''}">${esc(T('Ударит {what}', { what }))}</p>`;
      }
    } else if (unit && unit.side === 'hero') {
      html = `<h3>${esc(heroName(unit.kind))}</h3><p>${esc(T('Здоровье {hp} из {max}, шаг {move}', { hp: unit.hp, max: unit.maxHp, move: unit.move }))}</p><p><b>${esc(T(C.HEROES[unit.kind].ability))}.</b> ${esc(abilityText(unit))}</p>`;
    } else if (at && b.marks.some((m) => m.x === at.x && m.y === at.y)) {
      const m = b.marks.find((mm) => mm.x === at.x && mm.y === at.y);
      html = `<h3>${esc(T('Здесь выползет враг'))}</h3><p>${esc(T('В конце хода тут появится: {name}. Встань на клетку, чтобы не пустить его (получишь 1 урона).', { name: T(C.ENEMIES[m.kind].name) }))}</p>`;
    } else if (at) {
      const t = C.tileAt(b, at.x, at.y);
      html = `<h3>${esc(T(TILE_NAME[t.t]))}</h3><p>${esc(T(TILE_ABOUT[t.t]))}</p>`;
    } else if (su) {
      html = `<h3>${esc(heroName(su.kind))}</h3><p><b>${esc(T(C.HEROES[su.kind].ability))}.</b> ${esc(abilityText(su))}</p><p>${esc(mode === 'move' && !su.moved ? T('Синие клетки — куда можно шагнуть. Потом выбери цель.') : T('Оранжевые рамки — цели. Наведи, чтобы увидеть, что случится.'))}</p>`;
    } else {
      html = `<p>${esc(T('Выбери хранителя. Красные клетки — куда враги ударят в конце хода. Толкай врагов, чтобы они промахнулись.'))}</p>`;
    }
    box.innerHTML = html;
  }
  function renderAll() {
    if (!run) return;
    renderStatus();
    renderHeroes();
    renderInfo();
  }

  // ───────────── Actions ─────────────
  function select(id, want) {
    if (busy || run.b.phase !== 'player') return;
    const u = run.b.units.find((v) => v.id === id);
    if (!u) return;
    if (sel === id && !want) { mode = mode === 'move' && !u.acted ? 'act' : (!u.moved ? 'move' : 'act'); }
    else { sel = id; mode = want || (!u.moved ? 'move' : 'act'); }
    if (u.acted) mode = 'move';
    sfx.select();
    renderAll();
  }
  function snapshot(kind) { undo.push({ kind, run: JSON.stringify(run), sel }); }
  function doMove(u, x, y) {
    const before = C.clone(run.b);
    snapshot('move');
    run.b.log = [];
    if (!C.move(run, run.b, u.id, x, y)) { undo.pop(); return; }
    mode = 'act';
    save();
    play(before, run.b.log, () => renderAll());
    renderAll();
  }
  function doAct(u, x, y) {
    const before = C.clone(run.b);
    snapshot('act');
    run.b.log = [];
    if (!C.act(run, run.b, u.id, x, y)) { undo.pop(); return; }
    hover = null;
    save();
    const next = run.b.units.find((v) => v.side === 'hero' && !v.acted && v.id !== u.id);
    play(before, run.b.log, () => {
      if (run.status === 'lost') { finishRun(); return; }
      if (next && sel === u.id) { sel = next.id; mode = next.moved ? 'act' : 'move'; }
      renderAll();
    });
    renderAll();
  }
  function undoMove() {
    if (busy || !undo.length || undo[undo.length - 1].kind !== 'move') return;
    const s = undo.pop();
    run = JSON.parse(s.run);
    sel = s.sel;
    mode = 'move';
    save();
    renderAll();
  }
  function resetTurn() {
    if (busy || !turnStart || !(run.b.resets > 0)) return;
    const left = run.b.resets - 1;
    run = JSON.parse(turnStart);
    run.b.resets = left;
    undo = [];
    sel = null;
    save();
    renderAll();
  }
  function endTurn() {
    if (busy || run.b.phase !== 'player' || run.status !== 'battle') return;
    const before = C.clone(run.b);
    sel = null; hover = null;
    C.endTurn(run);
    save();
    banner(T('Ход врагов'), true);
    // The intents of the new turn should only appear after the replay.
    play(before, run.b.log, afterEnemyTurn);
    renderAll();
  }
  function afterEnemyTurn() {
    undo = [];
    if (run.status === 'battle') {
      turnStart = JSON.stringify(run);
      banner(T('Ход {n} из {m}', { n: run.b.turn, m: run.b.turns }));
      const first = run.b.units.find((u) => u.side === 'hero');
      if (first) { sel = first.id; mode = 'move'; }
    } else if (run.status === 'reward') {
      sfx.win();
      showReward();
    } else {
      finishRun();
    }
    renderAll();
  }
  let bannerT = 0;
  function banner(text, enemy) {
    const b = $('banner');
    b.textContent = text;
    b.className = `banner on${enemy ? ' enemy' : ''}`;
    clearTimeout(bannerT);
    bannerT = setTimeout(() => { b.className = 'banner'; }, 1300);
  }
  function flashLanterns() { renderStatus(); }

  // ───────────── Overlays ─────────────
  function overlay(html, onReady) {
    $('ov-card').innerHTML = html;
    $('overlay').hidden = false;
    if (onReady) onReady($('ov-card'));
    const f = $('ov-card').querySelector('button, input');
    if (f) f.focus();
  }
  function closeOverlay() { $('overlay').hidden = true; }
  function rulesHTML() {
    return `<ul>
      <li>${esc(T('Враги ходят первыми и показывают, куда ударят: красная клетка и номер очереди.'))}</li>
      <li>${esc(T('Удар бьёт по направлению от врага. Сдвинешь врага — сдвинется и удар: пусть он попадёт по пустоте или по другому чудищу.'))}</li>
      <li>${esc(T('Каждый хранитель за ход может шагнуть и один раз применить умение. Порядок любой.'))}</li>
      <li>${esc(T('Столкнутый в воду враг тонет. Удар о скалу, дом или другого — 1 урона.'))}</li>
      <li>${esc(T('Фиолетовый вихрь — здесь выползет враг. Встань на него, чтобы не пустить.'))}</li>
      <li>${esc(T('Разрушенный дом гасит фонарь. Погаснут все — деревня падёт. Продержись нужное число ходов на каждом из пяти островов.'))}</li>
    </ul>`;
  }
  async function boardHTML(listId) {
    try {
      const res = await fetch(BOARD_URL);
      if (!res.ok) throw new Error(res.status);
      return renderBoardList(await res.json(), -1, listId);
    } catch { return ''; }
  }
  function renderBoardList(top, rank, id) {
    if (!Array.isArray(top) || !top.length) return '';
    return `<h3>${esc(T('Лучшие хранители'))}</h3><ol class="board-list" id="${id}">${top.map((e, i) => `<li class="${i + 1 === rank ? 'me' : ''}"><span>${i + 1}. ${esc(e.name === 'Аноним' ? T('Аноним') : e.name)}</span><span>${e.score}</span></li>`).join('')}</ol>`;
  }
  async function showStart() {
    const saved = loadSaved();
    const best = Number(store.get(BEST_KEY, 0));
    const html = `<h2>${esc(T('Дозор'))}</h2>
      <p>${esc(T('Ночью из леса выходят чудища. Три хранителя — рыцарь, лучница и маг — берегут фонари деревни.'))}</p>
      ${rulesHTML()}
      ${best ? `<p class="muted">${esc(T('Лучший счёт: {n}', { n: best }))}</p>` : ''}
      <div class="row">${saved ? `<button type="button" class="btn main" id="ov-continue">${esc(T('Продолжить поход'))}</button>` : ''}
      <button type="button" class="btn ${saved ? '' : 'main'}" id="ov-new">${esc(T('Новый поход'))}</button></div>
      <div id="ov-board"></div>`;
    overlay(html, (card) => {
      const c = card.querySelector('#ov-continue');
      if (c) c.addEventListener('click', () => { run = saved; startBattleUI(true); });
      card.querySelector('#ov-new').addEventListener('click', () => { run = C.newRun((Math.random() * 2 ** 32) >>> 0); save(); startBattleUI(); });
    });
    const bh = await boardHTML('board-start');
    const slot = $('ov-board');
    if (slot && bh) slot.innerHTML = bh;
  }
  function startBattleUI(resume) {
    closeOverlay();
    if (run.status === 'reward') { renderAll(); showReward(); return; }
    if (run.b.resets == null) run.b.resets = 1;
    undo = [];
    turnStart = JSON.stringify(run);
    const first = run.b.units.find((u) => u.side === 'hero' && !u.acted);
    sel = first ? first.id : null; mode = first && first.moved ? 'act' : 'move';
    renderAll();
    banner(resume ? T('Ход {n} из {m}', { n: run.b.turn, m: run.b.turns }) : T(C.ISLANDS[run.battle]));
  }
  function showReward() {
    const b = run.b;
    const objLine = b.objDone ? T('Задача выполнена: +1 фонарь и +50 очков.') : T('Задача не выполнена.');
    const html = `<h2>${esc(T('Остров спасён'))}</h2>
      <p>${esc(T('Деревня пережила ночь на острове «{name}».', { name: T(C.ISLANDS[run.battle]) }))}</p>
      <p class="muted">${esc(objLine)} ${esc(T('Фонарей: {n} из {m}. Счёт: {s}.', { n: run.power, m: C.MAX_POWER, s: run.score }))}</p>
      <h3>${esc(T('Выбери награду'))}</h3>
      <div class="rewards">${run.rewards.map((k) => `<button type="button" class="reward" data-k="${k}"><b>${esc(T(C.REWARDS[k].name))}</b><span>${esc(T(C.REWARDS[k].about))}</span></button>`).join('')}</div>`;
    overlay(html, (card) => {
      card.querySelectorAll('.reward').forEach((btn) => btn.addEventListener('click', () => {
        C.takeReward(run, btn.dataset.k);
        save();
        startBattleUI();
      }));
    });
  }
  function finishRun() {
    const won = run.status === 'won';
    (won ? sfx.win : sfx.lose)();
    const best = Math.max(Number(store.get(BEST_KEY, 0)), run.score);
    store.set(BEST_KEY, String(best));
    store.del(SAVE_KEY);
    const html = `<h2>${esc(won ? T('Рассвет!') : T('Деревня погрузилась во тьму'))}</h2>
      <p>${esc(won ? T('Все пять островов спасены. Фонари горят до утра.') : T('Погас последний фонарь на острове «{name}».', { name: T(C.ISLANDS[run.battle]) }))}</p>
      <div class="score">${run.score}</div>
      <p class="muted">${esc(T('Побеждено врагов: {k}. Задач выполнено: {o}. Лучший счёт: {b}.', { k: run.kills, o: run.objectives, b: best }))}</p>
      <form class="name-row" id="ov-name"><input id="ov-name-in" maxlength="16" placeholder="${esc(T('Твоё имя'))}" value="${esc(store.get(NAME_KEY, ''))}" autocomplete="off"><button class="btn">${esc(T('В таблицу'))}</button></form>
      <div id="ov-board"></div>
      <div class="row"><button type="button" class="btn main" id="ov-again">${esc(T('Новый поход'))}</button></div>`;
    overlay(html, (card) => {
      card.querySelector('#ov-again').addEventListener('click', () => { run = C.newRun((Math.random() * 2 ** 32) >>> 0); save(); startBattleUI(); });
      const form = card.querySelector('#ov-name');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = card.querySelector('#ov-name-in').value.trim();
        store.set(NAME_KEY, name);
        form.querySelector('button').disabled = true;
        try {
          const res = await fetch(BOARD_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || T('Аноним'), score: run.score, level: run.battle + 1 }) });
          if (!res.ok) throw new Error(res.status);
          const { rank, top } = await res.json();
          $('ov-board').innerHTML = renderBoardList(top, rank, 'board-over');
          form.hidden = true;
        } catch {
          $('ov-board').innerHTML = `<p class="muted">${esc(T('Таблица рекордов доступна, когда игра запущена на сервере.'))}</p>`;
          form.hidden = true;
        }
      });
    });
  }
  function showHelp() {
    overlay(`<h2>${esc(T('Как играть'))}</h2>${rulesHTML()}
      <p class="muted">${esc(T('Клавиши: 1–3 — выбрать хранителя, Пробел — шаг или умение, Z — отменить шаг, Enter — конец хода, Esc — снять выбор.'))}</p>
      <div class="row"><button type="button" class="btn main" id="ov-close">${esc(T('Понятно'))}</button></div>`, (card) => {
      card.querySelector('#ov-close').addEventListener('click', closeOverlay);
    });
  }

  // ───────────── Input ─────────────
  function cell(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (r.width / 8)), y = Math.floor((e.clientY - r.top) / (r.height / 8));
    return C.inB(x, y) ? { x, y } : null;
  }
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const c = cell(e);
    if ((c && hover && c.x === hover.x && c.y === hover.y) || (!c && !hover)) return;
    hover = c;
    renderInfo();
  });
  canvas.addEventListener('pointerleave', () => { hover = null; renderInfo(); });
  // On touch the first tap on an ability target previews it, the second tap confirms.
  let touchArmed = null;
  canvas.addEventListener('click', (e) => {
    if (!run || busy || run.b.phase !== 'player' || !$('overlay').hidden) return;
    const c = cell(e);
    if (!c) return;
    const touch = e.pointerType === 'touch' || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents);
    const u = selected();
    const at = C.unitAt(run.b, c.x, c.y);
    if (u && mode === 'act' && !u.acted && C.targets(run.b, u).some((p) => p.x === c.x && p.y === c.y)) {
      if (touch && !(touchArmed && touchArmed.x === c.x && touchArmed.y === c.y)) { touchArmed = c; hover = c; renderInfo(); return; }
      touchArmed = null;
      doAct(u, c.x, c.y);
      return;
    }
    touchArmed = null;
    if (at && at.side === 'hero') { select(at.id); hover = touch ? c : hover; return; }
    if (u && mode === 'move' && !u.moved && C.reach(run.b, u, u.move).some((p) => p.x === c.x && p.y === c.y)) { doMove(u, c.x, c.y); return; }
    // Anything else: show what is there.
    hover = c;
    if (!at) { sel = sel && selected() ? sel : null; }
    renderInfo();
  });
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); sel = null; renderAll(); });
  document.addEventListener('keydown', (e) => {
    if (!$('overlay').hidden) { if (e.key === 'Escape' && run && run.status === 'battle') closeOverlay(); return; }
    if (!run || e.target.tagName === 'INPUT') return;
    const heroes = C.HERO_ORDER.map((k) => run.b.units.find((u) => u.side === 'hero' && u.kind === k));
    if (['1', '2', '3'].includes(e.key)) { const u = heroes[Number(e.key) - 1]; if (u) select(u.id); }
    else if (e.key === ' ') { e.preventDefault(); const u = selected(); if (u) select(u.id); }
    else if (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я') undoMove();
    else if (e.key === 'Enter') endTurn();
    else if (e.key === 'Escape') { sel = null; renderAll(); }
  });
  $('btn-end').addEventListener('click', endTurn);
  $('btn-undo').addEventListener('click', undoMove);
  $('btn-reset').addEventListener('click', resetTurn);
  $('btn-help').addEventListener('click', showHelp);
  $('btn-sound').addEventListener('click', () => {
    soundOn = !soundOn;
    store.set(SOUND_KEY, soundOn ? '1' : '0');
    $('btn-sound').classList.toggle('off', !soundOn);
  });
  $('btn-sound').classList.toggle('off', !soundOn);
  $('overlay').addEventListener('click', (e) => { if (e.target === $('overlay') && run && run.status === 'battle' && !$('ov-card').querySelector('#ov-new')) closeOverlay(); });
  let rT = 0;
  window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(resize, 120); });
  window.addEventListener('pagehide', save);

  // ───────────── Boot ─────────────
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = T(meta.content);
  document.addEventListener('DOMContentLoaded', () => $('lang-slot').appendChild(I18n.toggle('lang-toggle')));
  resize();
  (function loop() { draw(); requestAnimationFrame(loop); })();
  showStart();
})();
