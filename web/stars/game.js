'use strict';
// Звездочёт — sky rendering, panel UI and persistence. Rules live in core.js (window.StarsCore).
(() => {
  const C = window.StarsCore;
  const SAVE_KEY = 'stars.save';
  const CLOUD_KEY = 'stars.cloud';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  };

  // ───────────── Numbers ─────────────
  const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 2 });
  const plain = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  function fmt(n) {
    if (n < 1000) return plain.format(n < 10 ? Math.floor(n * 10) / 10 : Math.floor(n));
    if (n < 1e15) return compact.format(n);
    return n.toExponential(2).replace('e+', '·10^');
  }
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };

  // ───────────── State ─────────────
  let S = C.newState();
  let meteor = null;
  let lastSave = 0;

  function save() {
    const ok = store.set(SAVE_KEY, JSON.stringify({ state: S, savedAt: Date.now() }));
    lastSave = performance.now();
    $('save-status').textContent = ok ? 'сохранено' : 'браузер не даёт сохранять';
  }

  function load() {
    try {
      const raw = JSON.parse(store.get(SAVE_KEY));
      if (!raw) return null;
      S = C.migrate(raw.state);
      return raw.savedAt || null;
    } catch { return null; }
  }

  // Messages queue up so a new one never hides the previous before it was read.
  const toasts = [];
  let toastBusy = false;
  function toast(text, secs = 3.5) {
    toasts.push({ text, secs });
    if (!toastBusy) nextToast();
  }
  function nextToast() {
    const el = $('toast'), m = toasts.shift();
    if (!m) { toastBusy = false; el.hidden = true; return; }
    toastBusy = true;
    el.textContent = m.text; el.hidden = false;
    setTimeout(nextToast, (toasts.length ? Math.min(m.secs, 2.2) : m.secs) * 1000);
  }

  // ───────────── Sound ─────────────
  const Sound = (() => {
    let ac = null, master = null;
    const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.45; master.connect(ac.destination);
    }
    function tone(f, { t = 0, d = 0.5, vol = 0.08, type = 'sine' } = {}) {
      if (!ac) return;
      const now = ac.currentTime + t;
      const o = ac.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d);
      o.connect(g); g.connect(master); o.start(now); o.stop(now + d + 0.05);
    }
    let note = 0;
    return {
      init,
      click() { note = (note + 1 + Math.floor(Math.random() * 3)) % SCALE.length; tone(660 * 2 ** (SCALE[note] / 12), { d: 0.4, vol: 0.035, type: 'triangle' }); },
      buy() { tone(330, { d: 0.25, vol: 0.06, type: 'triangle' }); tone(495, { t: 0.06, d: 0.3, vol: 0.05, type: 'triangle' }); },
      star(k) { tone(880 * 2 ** (SCALE[k % SCALE.length] / 12), { d: 0.9, vol: 0.07 }); },
      constellation() { [0, 4, 7, 11, 14].forEach((s, i) => tone(392 * 2 ** (s / 12), { t: i * 0.11, d: 1.6, vol: 0.06 })); },
      meteor() { [0, 7, 12, 19].forEach((s, i) => tone(523 * 2 ** (s / 12), { t: i * 0.05, d: 0.7, vol: 0.06, type: 'triangle' })); },
    };
  })();

  // ───────────── Sky ─────────────
  const canvas = $('sky');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  const HORIZON = 0.84;
  const fx = { floaters: [], sparks: [], streaks: [], hover: null, hintFaded: false };

  const seeded = (seed) => { let a = seed; return () => ((a = (a * 16807) % 2147483647) / 2147483647); };
  const R0 = seeded(20261010);
  const SKY = Array.from({ length: 900 }, () => ({ x: R0() * 1.2 - 0.1, y: R0() * 0.95 - 0.1, m: R0() ** 3, tw: R0() * 6, hue: R0() < 0.15 ? 20 : R0() < 0.3 ? 210 : 45 }));
  const MILKY = Array.from({ length: 60 }, (_, i) => ({ t: i / 60, off: (R0() - 0.5) * 0.12, r: 0.05 + R0() * 0.08 }));
  const HILLS = Array.from({ length: 40 }, (_, i) => 0.03 + Math.abs(Math.sin(i * 0.7) * 0.04) + R0() * 0.025);

  // Where each constellation sits, as the centre of its shape in screen fractions.
  const ANCHORS = { uma: [0.62, 0.2], cas: [0.24, 0.32], lyr: [0.85, 0.4], cyg: [0.47, 0.44], leo: [0.17, 0.6], ori: [0.72, 0.62], sco: [0.42, 0.7], and: [0.88, 0.16] };

  function resize() {
    const r = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  }
  window.addEventListener('resize', resize);

  // The whole sky sways slowly around a pole above the screen.
  function skyAngle(t) { return reduceMotion ? 0 : Math.sin(t / 90) * 0.06; }
  function project(fx_, fy_, t) {
    const px = W * 0.5, py = -H * 0.6;
    const x = fx_ * W - px, y = fy_ * H - py, a = skyAngle(t);
    return { x: px + x * Math.cos(a) - y * Math.sin(a), y: py + x * Math.sin(a) + y * Math.cos(a) };
  }

  function constellationStars(c, t) {
    const u = Math.min(W * 0.085, H * 0.12);
    const xs = c.stars.map((s) => s[1]), ys = c.stars.map((s) => s[2]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const [ax, ay] = ANCHORS[c.id];
    return c.stars.map(([name, x, y], i) => {
      const p = project(ax + ((x - cx) * u) / W, ay + ((y - cy) * u) / H, t);
      return { name, i, x: p.x, y: p.y };
    });
  }

  const shownStars = () => Math.min(SKY.length, Math.floor(15 + 80 * Math.log10(1 + S.stats.light)));

  function drawSky(t, dt) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const warm = S.frenzy > 0 ? 0.25 : 0;
    g.addColorStop(0, '#04071a');
    g.addColorStop(0.65, warm ? '#1a1636' : '#0c1433');
    g.addColorStop(HORIZON, warm ? '#3a2a40' : '#1a2550');
    g.addColorStop(1, '#03050c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // Milky Way: soft blobs along a diagonal band.
    for (const b of MILKY) {
      const p = project(-0.05 + b.t * 1.1, 0.85 - b.t * 0.9 + b.off, t);
      const r = b.r * Math.max(W, H);
      const mg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      mg.addColorStop(0, 'rgba(170,180,230,0.045)'); mg.addColorStop(1, 'rgba(170,180,230,0)');
      ctx.fillStyle = mg; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }

    // Discovered background stars.
    const n = shownStars();
    for (let i = 0; i < n; i++) {
      const s = SKY[i];
      const p = project(s.x, s.y, t);
      if (p.y > H * HORIZON + 4 || p.x < -4 || p.x > W + 4) continue;
      const fade = clamp((n - i) / 3, 0, 1);
      const a = (0.35 + 0.65 * s.m) * (0.75 + 0.25 * Math.sin(t * 1.7 + s.tw)) * fade;
      const r = 0.6 + s.m * 1.6;
      ctx.fillStyle = `hsla(${s.hue}, 60%, 88%, ${a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      if (s.m > 0.6) {
        ctx.fillStyle = `hsla(${s.hue}, 70%, 85%, ${a * 0.15})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2); ctx.fill();
      }
    }

    drawConstellations(t);
    drawMeteor(dt);
    drawStreaks(dt);
    drawHorizon(t);
    drawFx(dt);
  }

  function drawConstellations(t) {
    fx.hit = [];
    for (const c of C.CONSTELLATIONS) {
      if (!C.revealed(S, c)) continue;
      const done = !!S.const[c.id];
      const found = new Set(S.found[c.id] || []);
      const pts = constellationStars(c, t);
      // lines between found stars
      ctx.lineWidth = 1.2;
      for (const [a, b] of c.lines) {
        if (!done && !(found.has(a) && found.has(b))) continue;
        ctx.strokeStyle = done ? 'rgba(245,201,106,0.35)' : 'rgba(143,182,255,0.55)';
        ctx.beginPath(); ctx.moveTo(pts[a].x, pts[a].y); ctx.lineTo(pts[b].x, pts[b].y); ctx.stroke();
      }
      for (const p of pts) {
        const got = done || found.has(p.i);
        const pulse = got ? 0 : 0.5 + 0.5 * Math.sin(t * 3 + p.i);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16);
        glow.addColorStop(0, got ? 'rgba(245,201,106,0.5)' : `rgba(143,182,255,${0.25 + pulse * 0.3})`);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = got ? '#ffe7b0' : '#dfe9ff';
        ctx.beginPath(); ctx.arc(p.x, p.y, got ? 2.6 : 2.2, 0, Math.PI * 2); ctx.fill();
        if (!got) {
          ctx.strokeStyle = `rgba(143,182,255,${0.25 + pulse * 0.35})`; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, 8 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
          fx.hit.push({ c, p });
        }
      }
      if (done) {
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = Math.max(...pts.map((p) => p.y)) + 20;
        ctx.font = 'italic 14px "Old Standard TT", Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(245,201,106,0.55)';
        ctx.fillText(c.name, cx, cy);
      }
    }
    if (fx.hover) {
      ctx.font = 'italic 15px "Old Standard TT", Georgia, serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e9ecf8';
      ctx.fillText(`${fx.hover.p.name} · ${fx.hover.c.name}`, fx.hover.p.x + 14, fx.hover.p.y - 10);
    }
  }

  function spawnMeteor() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const a = (Math.PI / 180) * rand(18, 38);
    meteor = {
      x: dir > 0 ? rand(W * 0.05, W * 0.5) : rand(W * 0.5, W * 0.95), y: rand(H * 0.06, H * 0.3),
      vx: Math.cos(a) * 230 * dir, vy: Math.sin(a) * 230, t: 0, life: 4.2,
    };
  }

  function drawMeteor(dt) {
    if (!meteor) return;
    meteor.t += dt; meteor.x += meteor.vx * dt; meteor.y += meteor.vy * dt;
    const k = meteor.t / meteor.life;
    if (k >= 1) { meteor = null; S.meteorIn = C.nextMeteorDelay(S, Math.random()); return; }
    const a = Math.sin(Math.PI * k) * 0.6 + 0.4;
    const tx = meteor.x - meteor.vx * 0.45, ty = meteor.y - meteor.vy * 0.45;
    const g = ctx.createLinearGradient(tx, ty, meteor.x, meteor.y);
    g.addColorStop(0, 'rgba(255,217,160,0)'); g.addColorStop(1, `rgba(255,236,200,${a})`);
    ctx.strokeStyle = g; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(meteor.x, meteor.y); ctx.stroke();
    const hg = ctx.createRadialGradient(meteor.x, meteor.y, 0, meteor.x, meteor.y, 18);
    hg.addColorStop(0, `rgba(255,245,220,${a})`); hg.addColorStop(1, 'rgba(255,217,160,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(meteor.x, meteor.y, 18, 0, Math.PI * 2); ctx.fill();
  }

  // Decorative shooting stars during a frenzy.
  function drawStreaks(dt) {
    if (S.frenzy > 0 && !reduceMotion && Math.random() < dt * 4) {
      fx.streaks.push({ x: rand(0, W), y: rand(0, H * 0.4), vx: rand(-260, 260), vy: rand(140, 260), t: 0 });
    }
    for (const s of fx.streaks) {
      s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt;
      ctx.strokeStyle = `rgba(255,217,160,${0.6 * (1 - s.t / 0.8)})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.12, s.y - s.vy * 0.12); ctx.stroke();
    }
    fx.streaks = fx.streaks.filter((s) => s.t < 0.8);
  }

  // Hills with the instruments the player owns standing on them.
  function drawHorizon(t) {
    const base = H * HORIZON;
    ctx.fillStyle = '#04060f';
    ctx.beginPath(); ctx.moveTo(0, H);
    HILLS.forEach((h, i) => ctx.lineTo((i / (HILLS.length - 1)) * W, base - h * H));
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    const ground = (fx_) => base - HILLS[Math.round(fx_ * (HILLS.length - 1))] * H + 1;
    const own = (id) => C.count(S, id) > 0;
    ctx.fillStyle = '#04060f'; ctx.strokeStyle = '#04060f';
    const u = clamp(H / 400, 0.7, 1.6);

    // the stargazer
    { const x = W * 0.1, y = ground(0.1);
      ctx.beginPath(); ctx.arc(x, y - 16 * u, 4 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - 3 * u, y - 12 * u, 6 * u, 12 * u);
      if (own('spyglass')) { ctx.lineWidth = 2.5 * u; ctx.beginPath(); ctx.moveTo(x + 2 * u, y - 15 * u); ctx.lineTo(x + 13 * u, y - 24 * u); ctx.stroke(); } }
    if (own('refractor')) { const x = W * 0.2, y = ground(0.2);
      ctx.lineWidth = 1.5 * u; ctx.beginPath(); ctx.moveTo(x - 6 * u, y); ctx.lineTo(x, y - 14 * u); ctx.lineTo(x + 6 * u, y); ctx.moveTo(x, y - 14 * u); ctx.lineTo(x, y); ctx.stroke();
      ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(x - 7 * u, y - 10 * u); ctx.lineTo(x + 10 * u, y - 24 * u); ctx.stroke(); }
    if (own('reflector')) { const x = W * 0.29, y = ground(0.29);
      ctx.save(); ctx.translate(x, y - 10 * u); ctx.rotate(-0.6); ctx.fillRect(-6 * u, -16 * u, 12 * u, 26 * u); ctx.restore();
      ctx.fillRect(x - 8 * u, y - 4 * u, 16 * u, 4 * u); }
    if (own('gw')) { const x = W * 0.38, y = ground(0.38);
      ctx.fillRect(x, y - 3 * u, 70 * u, 3 * u); ctx.fillRect(x - 3 * u, y - 10 * u, 8 * u, 10 * u); }
    if (own('interferometer')) for (let k = 0; k < 4; k++) { const x = W * (0.52 + k * 0.035), y = ground(0.52 + k * 0.035);
      ctx.beginPath(); ctx.arc(x, y - 10 * u, 6 * u, Math.PI * 0.9, Math.PI * 1.9); ctx.fill(); ctx.fillRect(x - 1 * u, y - 10 * u, 2 * u, 10 * u); }
    if (own('observatory')) { const x = W * 0.72, y = ground(0.72);
      ctx.fillRect(x - 16 * u, y - 14 * u, 32 * u, 14 * u);
      ctx.beginPath(); ctx.arc(x, y - 14 * u, 16 * u, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(245,201,106,0.85)'; ctx.fillRect(x - 2 * u, y - 29 * u, 4 * u, 10 * u);
      ctx.fillRect(x - 10 * u, y - 9 * u, 4 * u, 4 * u); ctx.fillStyle = '#04060f'; }
    if (own('radio')) { const x = W * 0.86, y = ground(0.86);
      ctx.save(); ctx.translate(x, y - 22 * u); ctx.rotate(-0.5);
      ctx.beginPath(); ctx.ellipse(0, 0, 18 * u, 7 * u, 0, 0, Math.PI); ctx.fill(); ctx.restore();
      ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.moveTo(x - 6 * u, y); ctx.lineTo(x, y - 18 * u); ctx.lineTo(x + 6 * u, y); ctx.stroke(); }
    if (own('orbital')) { // a satellite crossing the sky
      const k = ((t / 40) % 1), x = -20 + k * (W + 40), y = H * 0.12 + Math.sin(k * Math.PI) * -H * 0.04;
      ctx.fillStyle = '#c9d4ff'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      ctx.fillStyle = 'rgba(143,182,255,0.8)'; ctx.fillRect(x - 7, y - 1, 4, 2); ctx.fillRect(x + 3, y - 1, 4, 2);
    }
  }

  function drawFx(dt) {
    for (const s of fx.sparks) {
      s.t += dt;
      const k = s.t / s.life;
      ctx.strokeStyle = `rgba(${s.color},${1 - k})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, 4 + k * s.r, 0, Math.PI * 2); ctx.stroke();
    }
    fx.sparks = fx.sparks.filter((s) => s.t < s.life);
    ctx.font = '700 15px "PT Sans", sans-serif'; ctx.textAlign = 'center';
    for (const f of fx.floaters) {
      f.t += dt;
      ctx.globalAlpha = clamp(1.1 - f.t, 0, 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - f.t * 36);
    }
    ctx.globalAlpha = 1;
    fx.floaters = fx.floaters.filter((f) => f.t < 1.1);
  }

  // ───────────── Sky input ─────────────
  function skyPoint(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function starAt(x, y) {
    let best = null;
    for (const h of fx.hit || []) {
      const d = Math.hypot(h.p.x - x, h.p.y - y);
      if (d < 18 && (!best || d < best.d)) best = { ...h, d };
    }
    return best;
  }

  canvas.addEventListener('pointerdown', (e) => {
    Sound.init();
    const { x, y } = skyPoint(e);
    if (meteor && Math.hypot(meteor.x - x, meteor.y - y) < 34) {
      const res = C.catchMeteor(S, Math.random());
      meteor = null;
      S.meteorIn = C.nextMeteorDelay(S, Math.random());
      Sound.meteor();
      fx.sparks.push({ x, y, t: 0, life: 0.9, r: 60, color: '255,217,160' });
      toast(res.kind === 'burst' ? `Метеор! +${fmt(res.amount)} света` : `Звездопад! Весь свет ×7 на ${Math.round(res.seconds)} с`);
      render(true);
      return;
    }
    const hit = starAt(x, y);
    if (hit) {
      const r = C.findStar(S, hit.c.id, hit.p.i);
      if (r) {
        Sound.star((S.found[hit.c.id] || []).length);
        fx.sparks.push({ x: hit.p.x, y: hit.p.y, t: 0, life: 0.7, r: 26, color: '143,182,255' });
        if (r === 'complete') {
          Sound.constellation();
          toast(`${hit.c.name} собрана: ${hit.c.bonusText}`);
        }
        render(true);
        return;
      }
    }
    const n = C.click(S);
    Sound.click();
    fx.floaters.push({ x, y: y - 6, t: 0, text: `+${fmt(n)}`, color: '#f5c96a' });
    if (!reduceMotion) fx.sparks.push({ x, y, t: 0, life: 0.5, r: 14, color: '245,201,106' });
    if (!fx.hintFaded && S.stats.clicks > 5) { fx.hintFaded = true; $('sky-hint').style.opacity = 0; }
    render(true);
  });
  canvas.addEventListener('pointermove', (e) => {
    const { x, y } = skyPoint(e);
    fx.hover = starAt(x, y);
    canvas.style.cursor = fx.hover || (meteor && Math.hypot(meteor.x - x, meteor.y - y) < 34) ? 'pointer' : 'crosshair';
  });
  canvas.addEventListener('pointerleave', () => { fx.hover = null; });

  // ───────────── Panel ─────────────
  let buyMode = '1';
  for (const b of document.querySelectorAll('.seg button')) {
    b.addEventListener('click', () => {
      buyMode = b.dataset.n;
      for (const o of document.querySelectorAll('.seg button')) o.setAttribute('aria-pressed', String(o === b));
      render(true);
    });
  }

  const instEls = {};
  for (const inst of C.INSTRUMENTS) {
    const b = document.createElement('button');
    b.className = 'inst';
    b.innerHTML = `<span class="inst-name"></span><span class="inst-count">0</span><span class="inst-meta"></span>`;
    b.title = inst.note;
    b.addEventListener('click', () => {
      Sound.init();
      const n = buyAmount(inst.id);
      if (n > 0 && C.buy(S, inst.id, n)) { Sound.buy(); render(true); }
    });
    $('instruments').append(b);
    instEls[inst.id] = { b, name: b.querySelector('.inst-name'), count: b.querySelector('.inst-count'), meta: b.querySelector('.inst-meta') };
  }

  function buyAmount(id) {
    if (buyMode === 'max') return C.maxAffordable(S, id);
    return Number(buyMode);
  }

  const atlasEls = C.CONSTELLATIONS.map((c) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="mark"></span><span class="name"></span><span class="bonus"></span>';
    $('atlas').append(li);
    return { li, mark: li.querySelector('.mark'), name: li.querySelector('.name'), bonus: li.querySelector('.bonus') };
  });

  let upKey = '';
  const set = (el, prop, v) => { if (el[prop] !== v) el[prop] = v; };

  function render(force) {
    const d = C.derived(S);
    set($('light'), 'textContent', fmt(S.light));
    set($('rate'), 'textContent', `${fmt(d.rate)} в секунду · клик ${fmt(d.click)}`);
    $('frenzy').hidden = !(S.frenzy > 0);
    if (S.frenzy > 0) set($('frenzy'), 'textContent', `Звездопад ×7 · ${Math.ceil(S.frenzy)} с`);
    set($('novae'), 'textContent', S.dust ? `пыль: ${S.dust} (+${S.dust * 10}%)` : '');

    // Instruments: show owned ones, the next affordable-ish one, and one mystery row.
    let mysteryShown = false;
    for (const inst of C.INSTRUMENTS) {
      const e = instEls[inst.id];
      const owned = C.count(S, inst.id);
      const known = owned > 0 || S.stats.light >= inst.base * 0.6;
      if (!known) {
        e.b.hidden = mysteryShown; mysteryShown = true;
        e.b.disabled = true; e.b.className = 'inst mystery';
        set(e.name, 'textContent', '???'); set(e.count, 'textContent', '');
        set(e.meta, 'innerHTML', `откроется ближе к ${fmt(inst.base)} света`);
        continue;
      }
      e.b.hidden = false;
      const n = Math.max(1, buyAmount(inst.id));
      const price = C.cost(inst.id, owned, n);
      const poor = price > S.light;
      e.b.className = `inst${poor ? ' poor' : ''}`;
      e.b.disabled = poor;
      set(e.name, 'textContent', inst.name);
      set(e.count, 'textContent', String(owned));
      const total = d.per[inst.id] * owned;
      const meta = `<span class="cost">${n > 1 ? `×${n} · ` : ''}${fmt(price)}</span> · ${fmt(d.per[inst.id])}/с каждый${owned ? ` · всего ${fmt(total)}/с` : ''}`;
      set(e.meta, 'innerHTML', meta);
    }

    // Upgrades: rebuild only when the available set changes.
    const avail = C.UPGRADES.filter((u) => C.upgradeAvailable(S, u)).sort((a, b) => a.cost - b.cost);
    const key = avail.map((u) => u.id).join('|');
    if (key !== upKey || force) {
      if (key !== upKey) {
        upKey = key;
        $('upgrades').innerHTML = '';
        for (const u of avail) {
          const b = document.createElement('button');
          b.className = 'up'; b.dataset.id = u.id;
          b.innerHTML = `<b>${u.name}</b><span>${u.desc}</span><span class="cost">${fmt(u.cost)}</span>`;
          b.addEventListener('click', () => { if (C.buyUpgrade(S, u.id)) { Sound.buy(); render(true); } });
          $('upgrades').append(b);
        }
      }
    }
    $('sec-upgrades').hidden = !avail.length;
    for (const b of $('upgrades').children) b.disabled = C.UPGRADES.find((u) => u.id === b.dataset.id).cost > S.light;

    // Atlas
    let done = 0;
    C.CONSTELLATIONS.forEach((c, i) => {
      const e = atlasEls[i];
      const isDone = !!S.const[c.id], open = C.revealed(S, c);
      if (isDone) done++;
      e.li.className = isDone ? 'done' : open ? 'open' : 'hidden-c';
      set(e.mark, 'textContent', isDone ? '✦' : open ? `${(S.found[c.id] || []).length}/${c.stars.length}` : '·');
      set(e.name, 'textContent', open ? c.name : 'Не открыто');
      set(e.bonus, 'textContent', isDone ? c.bonusText : open ? 'найди звёзды на небе' : `при ${fmt(c.need)} света`);
    });
    set($('atlas-count'), 'textContent', `${done} из ${C.CONSTELLATIONS.length}`);

    const gain = C.dustGain(S);
    $('sec-nova').hidden = gain < 1;
    if (gain >= 1 && !novaArmed) set($('btn-nova'), 'textContent', `Взорвать: +${gain} ${plural(gain, 'пылинка', 'пылинки', 'пылинок')}`);
  }

  // Story-ish notices when constellations appear.
  function checkReveals() {
    for (const c of C.CONSTELLATIONS) {
      if (C.revealed(S, c) && !S.seen[c.id]) {
        S.seen[c.id] = true;
        toast(`На небе проступило созвездие «${c.name}». Найди его звёзды и кликни по каждой.`, 5);
      }
    }
  }

  let novaArmed = null;
  $('btn-nova').addEventListener('click', () => {
    if (!novaArmed) {
      $('btn-nova').textContent = 'Точно? Всё, кроме пыли, начнётся заново';
      novaArmed = setTimeout(() => { novaArmed = null; render(true); }, 3500);
      return;
    }
    clearTimeout(novaArmed); novaArmed = null;
    const gain = C.dustGain(S);
    S = C.supernova(S);
    meteor = null; upKey = '';
    fx.hintFaded = false; $('sky-hint').style.opacity = 1;
    save();
    toast(`Сверхновая! Звёздная пыль: ${S.dust} (+${gain}). Небо снова тёмное.`, 5);
    render(true);
  });

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
    S = C.newState(); meteor = null; upKey = '';
    save(); render(true);
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
      const res = await fetch(`/api/saves/${code}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S) });
      if (!res.ok) throw new Error(await res.text());
    };
    $('btn-cloud-save').addEventListener('click', async () => {
      if (!code) {
        const abc = 'abcdefghjkmnpqrstuvwxyz23456789', bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        code = Array.from(bytes, (b) => abc[b % abc.length]).join('');
      }
      try {
        await put();
        store.set(CLOUD_KEY, code);
        $('cloud-code').textContent = pretty(code);
        $('cloud-msg').textContent = 'Сохранено. Введи этот код на другом устройстве.';
      } catch (err) { $('cloud-msg').textContent = `Не удалось сохранить: ${err.message}`; }
    });
    $('cloud-load').addEventListener('submit', async (e) => {
      e.preventDefault();
      const c = $('cloud-input').value.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (c.length !== 16) { $('cloud-msg').textContent = 'Код состоит из 16 букв и цифр.'; return; }
      try {
        const res = await fetch(`/api/saves/${c}`);
        if (res.status === 404) { $('cloud-msg').textContent = 'Сохранения с таким кодом нет.'; return; }
        if (!res.ok) throw new Error(await res.text());
        S = C.migrate(await res.json());
        code = c; store.set(CLOUD_KEY, c); $('cloud-code').textContent = pretty(c);
        upKey = ''; save(); render(true);
        $('cloud-msg').textContent = 'Загружено.';
      } catch (err) { $('cloud-msg').textContent = `Не удалось загрузить: ${err.message}`; }
    });
    setInterval(() => { if (code) put().catch(() => {}); }, 60000);
  }

  // ───────────── Boot & loop ─────────────
  resize();
  const savedAt = load();
  if (savedAt) {
    const away = (Date.now() - savedAt) / 1000;
    if (away > 30) {
      const got = C.offline(S, away);
      if (got >= 1) toast(`Пока тебя не было, инструменты собрали ${fmt(got)} света.`, 5);
    }
  }
  if (S.stats.clicks > 5) { fx.hintFaded = true; $('sky-hint').style.opacity = 0; }
  checkReveals();
  render(true);
  initCloud();

  let last = performance.now(), uiT = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    C.tick(S, dt);
    if (S.meteorIn <= 0 && !meteor) spawnMeteor();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawSky(now / 1000, dt);
    if ((uiT += dt) > 0.1) { uiT = 0; render(false); checkReveals(); }
    if (now - lastSave > 5000) save();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { save(); return; }
    try {
      const away = (Date.now() - JSON.parse(store.get(SAVE_KEY)).savedAt) / 1000;
      if (away > 2) { C.offline(S, away); save(); render(true); }
    } catch { /* nothing saved yet */ }
  });
  window.addEventListener('pagehide', save);
})();
