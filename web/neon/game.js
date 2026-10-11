'use strict';
// Неон — city rendering, panel UI and persistence. Rules live in core.js (window.NeonCore).
(() => {
  const C = window.NeonCore;
  const { t } = I18n;
  const SAVE_KEY = 'neon.save';
  const CLOUD_KEY = 'neon.cloud';
  const SOUND_KEY = 'neon.sound';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  };

  // ───────────── Numbers: data is counted in bytes ─────────────
  const UNITS = t('Б КБ МБ ГБ ТБ ПБ ЭБ ЗБ ИБ').split(' ');
  const num = new Intl.NumberFormat(I18n.locale, { maximumFractionDigits: 2 });
  const num1 = new Intl.NumberFormat(I18n.locale, { maximumFractionDigits: 1 });
  function fmt(n) {
    if (!(n >= 0)) n = 0;
    if (n < 1000) return `${num1.format(n < 10 ? Math.floor(n * 10) / 10 : Math.floor(n))} ${UNITS[0]}`;
    const k = Math.min(UNITS.length - 1, Math.floor(Math.log10(n) / 3));
    const v = n / 1000 ** k;
    if (v >= 1000) return `${(n / 1e24).toExponential(2).replace('e+', '·10^')} ${UNITS[UNITS.length - 1]}`;
    return `${num.format(v < 100 ? Math.floor(v * 100) / 100 : Math.floor(v))} ${UNITS[k]}`;
  }

  // ───────────── State ─────────────
  let S = C.newState();
  let drone = null;
  let lastSave = 0;

  function save() {
    const ok = store.set(SAVE_KEY, JSON.stringify({ state: S, savedAt: Date.now() }));
    lastSave = performance.now();
    $('save-status').textContent = t(ok ? 'сохранено' : 'браузер не даёт сохранять');
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
  function toast(text, secs = 3.5, kind = '') {
    toasts.push({ text, secs, kind });
    if (!toastBusy) nextToast();
  }
  function nextToast() {
    const el = $('toast'), m = toasts.shift();
    if (!m) { toastBusy = false; el.hidden = true; return; }
    toastBusy = true;
    el.textContent = m.text; el.className = `toast ${m.kind}`; el.hidden = false;
    setTimeout(nextToast, (toasts.length ? Math.min(m.secs, 2.2) : m.secs) * 1000);
  }

  // ───────────── Sound: a small synth ─────────────
  const Sound = (() => {
    let ac = null, master = null, on = store.get(SOUND_KEY) !== 'off';
    const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22]; // minor pentatonic
    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = on ? 0.4 : 0;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
      master.connect(lp); lp.connect(ac.destination);
    }
    function tone(f, { t = 0, d = 0.2, vol = 0.06, type = 'square', to = 0 } = {}) {
      if (!ac || !on) return;
      const now = ac.currentTime + t;
      const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, now);
      if (to) o.frequency.exponentialRampToValueAtTime(to, now + d);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d);
      o.connect(g); g.connect(master); o.start(now); o.stop(now + d + 0.05);
    }
    let note = 0;
    const pitch = (base, k) => base * 2 ** (SCALE[k % SCALE.length] / 12);
    return {
      init,
      get on() { return on; },
      toggle() {
        on = !on; store.set(SOUND_KEY, on ? 'on' : 'off');
        if (master) master.gain.value = on ? 0.4 : 0;
        return on;
      },
      click(isHot) {
        note = (note + 1 + Math.floor(Math.random() * 3)) % SCALE.length;
        tone(pitch(isHot ? 440 : 220, note), { d: 0.09, vol: isHot ? 0.045 : 0.03 });
        if (isHot) tone(pitch(880, note), { d: 0.06, vol: 0.02, type: 'sawtooth' });
      },
      buy() { tone(330, { d: 0.12, vol: 0.05 }); tone(660, { t: 0.05, d: 0.14, vol: 0.04 }); },
      node(k) { [0, 2, 4].forEach((s, i) => tone(pitch(330, k + s), { t: i * 0.04, d: 0.16, vol: 0.05, type: 'sawtooth' })); },
      breach() { [0, 3, 7, 10, 12, 15].forEach((s, i) => tone(220 * 2 ** (s / 12), { t: i * 0.07, d: 0.9, vol: 0.05, type: 'sawtooth' })); },
      lock() { for (let i = 0; i < 4; i++) tone(i % 2 ? 520 : 390, { t: i * 0.22, d: 0.2, vol: 0.06, type: 'square' }); tone(90, { d: 1, vol: 0.08, type: 'sawtooth', to: 40 }); },
      drone() { tone(200, { d: 0.35, vol: 0.06, type: 'sawtooth', to: 1600 }); tone(1200, { t: 0.1, d: 0.4, vol: 0.04, type: 'triangle' }); },
    };
  })();

  // ───────────── City ─────────────
  const canvas = $('city');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  const GROUND = 0.88;
  const fx = { floaters: [], sparks: [], glyphs: [], rain: [], cars: [], hover: null, hintFaded: false, shake: 0, flash: 0 };

  const seeded = (seed) => { let a = seed; return () => ((a = (a * 16807) % 2147483647) / 2147483647); };
  const R0 = seeded(20261011);
  // Far skyline: a dense wall of blocks with windows.
  const FAR = Array.from({ length: 46 }, (_, i) => ({ x: i / 46 + (R0() - 0.5) * 0.01, w: 0.018 + R0() * 0.03, h: 0.18 + R0() * 0.3, win: R0() }));
  // Near street buildings with signs.
  const SIGNS = ['БАР', 'РАМЕН', 'ОТЕЛЬ', '24/7', 'ИМПЛАНТЫ', 'КЛИНИКА', 'ЛОМБАРД', 'КАРАОКЕ'];
  const NEAR = Array.from({ length: 9 }, (_, i) => ({
    x: i / 9 - 0.02 + R0() * 0.02, w: 0.08 + R0() * 0.05, h: 0.1 + R0() * 0.1,
    sign: SIGNS[i % SIGNS.length], hue: [320, 185, 50, 280, 150, 200, 10, 300][i % 8], flick: R0() * 10,
  }));
  // Megacorp towers. Their hue is the corp's logo colour; breached towers switch to the player's cyan.
  const TOWERS = [
    { x: 0.07, w: 0.075, h: 0.42, hue: 210 }, { x: 0.19, w: 0.07, h: 0.5, hue: 140 },
    { x: 0.31, w: 0.08, h: 0.46, hue: 30 }, { x: 0.43, w: 0.075, h: 0.6, hue: 0 },
    { x: 0.56, w: 0.08, h: 0.55, hue: 50 }, { x: 0.68, w: 0.075, h: 0.64, hue: 90 },
    { x: 0.8, w: 0.07, h: 0.58, hue: 260 }, { x: 0.92, w: 0.08, h: 0.72, hue: 40 },
  ];

  function resize() {
    const r = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  }
  window.addEventListener('resize', resize);

  const ground = () => H * GROUND;
  // Towers keep a sane size on narrow phones and very wide screens.
  function towerBox(i) {
    const tw = TOWERS[i];
    const w = clamp(tw.w * W, 24, 90);
    const h = tw.h * H * 0.78;
    const x = tw.x * W - w / 2;
    return { x, y: ground() - h, w, h };
  }
  function nodePoints(i, c) {
    const b = towerBox(i);
    return Array.from({ length: c.nodes }, (_, k) => {
      const f = (k + 0.5) / c.nodes;
      return { k, x: b.x + b.w * (k % 2 ? 0.7 : 0.3), y: b.y + b.h * (0.12 + f * 0.72) };
    });
  }

  const totalRigs = () => C.RIGS.reduce((a, r) => a + C.count(S, r.id), 0);
  const own = (id) => C.count(S, id) > 0;

  function drawCity(t, dt) {
    const od = S.overdrive > 0, locked = S.lock > 0;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#07020f');
    g.addColorStop(0.5, od ? '#2a0636' : '#140726');
    g.addColorStop(GROUND - 0.05, od ? '#5a0d4a' : '#3a0b3d');
    g.addColorStop(1, '#05020a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    drawHologram(t);
    drawFar(t);
    drawTowers(t);
    drawCars(t, dt);
    drawDrone(dt);
    drawNear(t);
    drawRain(dt);
    drawFx(dt);
    if (locked) drawLock(t);
    if (fx.flash > 0) {
      ctx.fillStyle = `rgba(255,43,214,${fx.flash * 0.25})`; ctx.fillRect(0, 0, W, H);
      fx.flash = Math.max(0, fx.flash - dt * 2.5);
    }
  }

  // The rogue AI watches the city as a giant eye in the clouds.
  function drawHologram(t) {
    if (!own('ai')) return;
    const r = Math.min(W, H) * 0.08, x = W - r * 2.2, y = H * 0.3;
    const blink = reduceMotion ? 1 : Math.abs(Math.sin(t * 0.35)) > 0.04 ? 1 : 0.1;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.1 * Math.sin(t * 2);
    ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.8, r * blink, 0, 0, Math.PI * 2); ctx.stroke();
    if (blink > 0.5) {
      ctx.fillStyle = 'rgba(0,240,255,0.6)';
      ctx.beginPath(); ctx.arc(x + Math.sin(t * 0.7) * r * 0.5, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#07020f';
      ctx.beginPath(); ctx.arc(x + Math.sin(t * 0.7) * r * 0.5, y, r * 0.18, 0, Math.PI * 2); ctx.fill();
    }
    // scanlines through the hologram
    ctx.globalAlpha = 0.15; ctx.fillStyle = '#00f0ff';
    for (let yy = y - r; yy < y + r; yy += 4) ctx.fillRect(x - r * 1.8, yy + ((t * 20) % 4), r * 3.6, 1);
    ctx.restore();
  }

  function drawFar(t) {
    // More rigs light up more windows across the city: the botnet lives in its appliances.
    const lit = clamp(0.08 + Math.log10(1 + totalRigs()) * 0.18 + (own('botnet') ? 0.1 : 0), 0, 0.85);
    const R = seeded(77);
    for (const b of FAR) {
      const x = b.x * W, w = b.w * W, h = b.h * H, y = ground() - h;
      ctx.fillStyle = '#12081f'; ctx.fillRect(x, y, w, h);
      const cols = Math.max(1, Math.floor(w / 6)), rows = Math.floor(h / 8);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = R();
          if (v > lit) continue;
          const hue = v < lit * 0.15 ? 320 : v < lit * 0.3 ? 185 : 45;
          ctx.fillStyle = `hsla(${hue}, 90%, 65%, ${0.25 + 0.2 * Math.sin(t * 0.5 + r * c)})`;
          ctx.fillRect(x + 2 + c * 6, y + 4 + r * 8, 2, 3);
        }
      }
    }
    // Server farm: antennas with blinking red lights on the far roofs.
    if (own('server')) {
      for (let k = 0; k < 6; k++) {
        const b = FAR[3 + k * 7], x = b.x * W + b.w * W * 0.5, y = ground() - b.h * H;
        ctx.strokeStyle = '#2a1840'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 18); ctx.stroke();
        if (Math.sin(t * 3 + k) > 0) { ctx.fillStyle = '#ff2448'; ctx.fillRect(x - 1.5, y - 20, 3, 3); }
      }
    }
  }

  function drawTowers(t) {
    fx.hit = [];
    C.CORPS.forEach((c, i) => {
      const b = towerBox(i);
      const open = C.revealed(S, c), done = !!S.corp[c.id];
      const hue = TOWERS[i].hue;
      ctx.fillStyle = '#0b0517'; ctx.fillRect(b.x, b.y, b.w, b.h);
      // spire
      ctx.beginPath(); ctx.moveTo(b.x + b.w * 0.35, b.y); ctx.lineTo(b.x + b.w * 0.5, b.y - b.h * 0.08); ctx.lineTo(b.x + b.w * 0.65, b.y); ctx.fill();
      if (!open) {
        ctx.strokeStyle = 'rgba(120,90,160,0.18)'; ctx.lineWidth = 1; ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
        return;
      }
      const col = done ? '0,240,255' : `hsl(${hue} 100% 60%)`;
      const glow = done ? 'rgba(0,240,255,' : `hsla(${hue},100%,60%,`;
      // facade stripes
      ctx.fillStyle = `${glow}0.06)`;
      for (let y = b.y + 6; y < b.y + b.h; y += 10) ctx.fillRect(b.x + 3, y, b.w - 6, 4);
      // neon outline
      ctx.save();
      ctx.shadowColor = done ? '#00f0ff' : `hsl(${hue} 100% 60%)`; ctx.shadowBlur = reduceMotion ? 0 : 12;
      ctx.strokeStyle = done ? '#00f0ff' : col; ctx.lineWidth = done ? 2 : 1.2;
      ctx.globalAlpha = done ? 0.9 : 0.55 + 0.15 * Math.sin(t * 2 + i);
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      ctx.restore();
      // logo on the roof
      ctx.save();
      const fs = clamp(b.w * 0.2, 8, 13);
      ctx.font = `${fs}px "Russo One", sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = done ? '#00f0ff' : `hsl(${hue} 100% 70%)`;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = reduceMotion ? 0 : 8;
      const label = c.logo;
      ctx.translate(b.x + b.w / 2, b.y + b.h * 0.06 + fs);
      if (ctx.measureText(label).width > b.w - 4) ctx.scale((b.w - 4) / ctx.measureText(label).width, 1);
      ctx.fillText(label, 0, 0);
      ctx.restore();
      if (done) return;
      // ICE nodes
      const got = new Set(S.cracked[c.id] || []);
      for (const p of nodePoints(i, c)) {
        const isGot = got.has(p.k);
        const pulse = 0.5 + 0.5 * Math.sin(t * 4 + p.k);
        const r = 5 + (isGot ? 0 : pulse * 1.5);
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4);
        ctx.shadowColor = isGot ? '#00f0ff' : '#ff2448'; ctx.shadowBlur = reduceMotion ? 0 : 10;
        ctx.fillStyle = isGot ? '#00f0ff' : `rgba(255,36,72,${0.55 + pulse * 0.45})`;
        ctx.fillRect(-r / 1.4, -r / 1.4, r * 1.4, r * 1.4);
        ctx.restore();
        if (!isGot) fx.hit.push({ c, p, i });
      }
    });
    if (fx.hover) {
      ctx.save();
      ctx.font = '12px "JetBrains Mono", monospace';
      const text = `${I18n.t('УЗЕЛ ЛЬДА')} · ${fx.hover.c.name} · +${C.TRACE.node}% ${I18n.t('следа')}`;
      const w = ctx.measureText(text).width;
      const x = clamp(fx.hover.p.x + 14, 4, W - w - 4);
      ctx.fillStyle = 'rgba(7,2,15,0.85)'; ctx.fillRect(x - 4, fx.hover.p.y - 24, w + 8, 18);
      ctx.fillStyle = '#ff2448'; ctx.fillText(text, x, fx.hover.p.y - 11);
      ctx.restore();
    }
  }

  // Hover cars: the drone swarm and the city traffic; count grows with the swarm.
  function drawCars(t, dt) {
    const want = Math.min(14, 2 + (own('drones') ? 4 + Math.floor(Math.log2(1 + C.count(S, 'drones'))) : 0));
    while (fx.cars.length < want) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      fx.cars.push({ x: dir > 0 ? -20 : W + 20, y: rand(0.2, 0.62) * H, v: rand(40, 110) * dir, hue: Math.random() < 0.5 ? 320 : 185 });
    }
    for (const car of fx.cars) {
      car.x += car.v * dt * (S.overdrive > 0 ? 2 : 1) * (reduceMotion ? 0.3 : 1);
      ctx.fillStyle = '#1a0d2a'; ctx.fillRect(car.x - 7, car.y - 2, 14, 4);
      ctx.fillStyle = `hsl(${car.hue} 100% 65%)`; ctx.fillRect(car.v > 0 ? car.x + 6 : car.x - 8, car.y - 1, 2, 2);
      ctx.fillStyle = 'rgba(255,40,80,0.9)'; ctx.fillRect(car.v > 0 ? car.x - 8 : car.x + 6, car.y - 1, 2, 2);
    }
    fx.cars = fx.cars.filter((c) => c.x > -40 && c.x < W + 40);
  }

  function drawNear(t) {
    const base = H;
    for (const b of NEAR) {
      const x = b.x * W, w = b.w * W, h = b.h * H, y = base - h;
      ctx.fillStyle = '#06030c'; ctx.fillRect(x, y, w, h);
      // flickering sign
      const flick = reduceMotion ? 1 : Math.sin(t * 9 + b.flick) > -0.92 ? 1 : 0.25;
      const fs = clamp(w * 0.16, 9, 16);
      ctx.save();
      ctx.font = `${fs}px "Russo One", sans-serif`; ctx.textAlign = 'center';
      ctx.globalAlpha = flick;
      ctx.fillStyle = `hsl(${b.hue} 100% 65%)`;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = reduceMotion ? 0 : 12;
      const label = I18n.t(b.sign), lw = ctx.measureText(label).width;
      ctx.translate(x + w / 2, y + fs + 6);
      if (lw > w - 6) ctx.scale((w - 6) / lw, 1);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    // The hideout: your window with a deck's glow.
    const hx = W * 0.02, hy = H - H * 0.075, hw = clamp(W * 0.06, 30, 60), hh = H * 0.05;
    const screen = own('deck') ? '#00f0ff' : '#5a3a7a';
    ctx.fillStyle = 'rgba(0,240,255,0.08)'; ctx.fillRect(hx, hy, hw, hh);
    ctx.fillStyle = screen; ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 6); ctx.fillRect(hx + hw * 0.55, hy + hh * 0.35, hw * 0.3, hh * 0.3); ctx.globalAlpha = 1;
    ctx.fillStyle = '#05020a'; ctx.beginPath(); ctx.arc(hx + hw * 0.3, hy + hh * 0.45, hh * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(hx + hw * 0.18, hy + hh * 0.6, hw * 0.24, hh * 0.4);
    if (own('implant')) { ctx.fillStyle = '#ff2bd6'; ctx.fillRect(hx + hw * 0.36, hy + hh * 0.42, 2, 2); }
    // Quantum rig: a beam from the hideout into the clouds.
    if (own('quantum')) {
      const bx = hx + hw / 2, bg = ctx.createLinearGradient(0, hy, 0, 0);
      bg.addColorStop(0, 'rgba(160,80,255,0.35)'); bg.addColorStop(1, 'rgba(160,80,255,0)');
      ctx.fillStyle = bg; ctx.fillRect(bx - 2 - Math.sin(t * 5), 0, 4 + 2 * Math.sin(t * 5), hy);
    }
  }

  function drawRain(dt) {
    const want = reduceMotion ? 40 : S.overdrive > 0 ? 260 : 150;
    while (fx.rain.length < want) fx.rain.push({ x: rand(-50, W), y: rand(-H, H), v: rand(500, 800), l: rand(8, 18) });
    if (fx.rain.length > want) fx.rain.length = want;
    ctx.strokeStyle = S.overdrive > 0 ? 'rgba(255,43,214,0.35)' : 'rgba(150,180,255,0.22)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const r of fx.rain) {
      if (!reduceMotion) { r.y += r.v * dt; r.x += r.v * dt * 0.12; }
      if (r.y > H) { r.y = rand(-40, 0); r.x = rand(-50, W); }
      ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.l * 0.12, r.y + r.l);
    }
    ctx.stroke();
  }

  function spawnDrone() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    drone = { x: dir > 0 ? -30 : W + 30, y: rand(0.12, 0.4) * H, vx: rand(70, 110) * dir, t: 0, life: (W + 60) / 80 };
  }

  function drawDrone(dt) {
    if (!drone) return;
    drone.t += dt; drone.x += drone.vx * dt;
    if (drone.x < -40 || drone.x > W + 40) { drone = null; S.droneIn = C.nextDroneDelay(S, Math.random()); return; }
    const y = drone.y + Math.sin(drone.t * 3) * 6, x = drone.x;
    ctx.save();
    ctx.shadowColor = '#f5ff4a'; ctx.shadowBlur = reduceMotion ? 0 : 16;
    ctx.fillStyle = '#e8ff3a';
    ctx.fillRect(x - 9, y - 3, 18, 6);
    ctx.fillRect(x - 16, y - 6, 8, 2); ctx.fillRect(x + 8, y - 6, 8, 2);
    ctx.fillStyle = '#ff2bd6'; ctx.fillRect(x - 4, y + 3, 8, 7); // the data cache
    ctx.restore();
    if (Math.sin(drone.t * 10) > 0) { ctx.fillStyle = '#ff2448'; ctx.fillRect(x - 17, y - 8, 3, 3); }
    ctx.strokeStyle = 'rgba(232,255,58,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, 22 + Math.sin(drone.t * 5) * 3, 0, Math.PI * 2); ctx.stroke();
  }

  // ICE lockout: red glitch over the whole city.
  function drawLock(t) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,20,60,0.12)'; ctx.fillRect(0, 0, W, H);
    if (!reduceMotion) {
      for (let k = 0; k < 6; k++) {
        const y = rand(0, H), h = rand(2, 14);
        ctx.fillStyle = `rgba(255,${Math.random() < 0.5 ? 20 : 240},${Math.random() < 0.5 ? 60 : 255},0.18)`;
        ctx.fillRect(rand(-20, 20), y, W, h);
      }
    }
    const fs = clamp(W * 0.12, 36, 96);
    ctx.font = `${fs}px "Russo One", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const jx = reduceMotion ? 0 : rand(-3, 3);
    ctx.fillStyle = 'rgba(0,240,255,0.6)'; ctx.fillText(I18n.t('ЛЁД'), W / 2 + jx - 3, H * 0.42);
    ctx.fillStyle = '#ff2448'; ctx.fillText(I18n.t('ЛЁД'), W / 2 + jx, H * 0.42);
    ctx.font = '14px "JetBrains Mono", monospace'; ctx.fillStyle = '#ffd0da';
    ctx.fillText(I18n.t('СОЕДИНЕНИЕ РАЗОРВАНО · {s} с', { s: Math.ceil(S.lock) }), W / 2, H * 0.42 + fs * 0.65);
    ctx.restore();
  }

  const HEX = '0123456789ABCDEF';
  function drawFx(dt) {
    for (const s of fx.sparks) {
      s.t += dt;
      const k = s.t / s.life;
      ctx.strokeStyle = `rgba(${s.color},${1 - k})`; ctx.lineWidth = 1.5;
      if (s.square) {
        const r = 4 + k * s.r;
        ctx.strokeRect(s.x - r, s.y - r, r * 2, r * 2);
      } else { ctx.beginPath(); ctx.arc(s.x, s.y, 4 + k * s.r, 0, Math.PI * 2); ctx.stroke(); }
    }
    fx.sparks = fx.sparks.filter((s) => s.t < s.life);
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
    for (const g of fx.glyphs) {
      g.t += dt; g.x += g.vx * dt; g.y += g.vy * dt;
      ctx.fillStyle = `rgba(${g.color},${clamp(1 - g.t / 0.7, 0, 1)})`;
      ctx.fillText(g.ch, g.x, g.y);
    }
    fx.glyphs = fx.glyphs.filter((g) => g.t < 0.7);
    for (const f of fx.floaters) {
      f.t += dt;
      ctx.font = `700 ${f.big ? 17 : 14}px "JetBrains Mono", monospace`;
      ctx.globalAlpha = clamp(1.1 - f.t, 0, 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - f.t * 40);
    }
    ctx.globalAlpha = 1;
    fx.floaters = fx.floaters.filter((f) => f.t < 1.1);
  }

  function burstGlyphs(x, y, color, n) {
    if (reduceMotion) return;
    for (let k = 0; k < n; k++) {
      const a = rand(0, Math.PI * 2), v = rand(40, 120);
      fx.glyphs.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, color, ch: HEX[Math.floor(Math.random() * 16)] });
    }
  }

  // ───────────── City input ─────────────
  function cityPoint(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function nodeAt(x, y) {
    let best = null;
    for (const h of fx.hit || []) {
      const d = Math.hypot(h.p.x - x, h.p.y - y);
      if (d < 16 && (!best || d < best.d)) best = { ...h, d };
    }
    return best;
  }
  const onDrone = (x, y) => drone && Math.hypot(drone.x - x, drone.y - y) < 36;

  function onLocked(lost) {
    Sound.lock();
    fx.shake = 0.5;
    toast(t('ЛЁД засёк тебя! Стёрто {n}. Блокировка {s} с.', { n: fmt(lost), s: Math.ceil(S.lock) }), 4, 'alarm');
  }

  canvas.addEventListener('pointerdown', (e) => {
    Sound.init();
    const { x, y } = cityPoint(e);
    if (onDrone(x, y)) {
      const res = C.catchDrone(S, Math.random());
      drone = null;
      S.droneIn = C.nextDroneDelay(S, Math.random());
      Sound.drone();
      fx.sparks.push({ x, y, t: 0, life: 0.9, r: 60, color: '232,255,58' });
      burstGlyphs(x, y, '232,255,58', 16);
      if (res.kind === 'overdrive') fx.flash = 1;
      toast(res.kind === 'cache' ? t('Перехвачен кэш дрона: +{n}', { n: fmt(res.amount) }) : t('Овердрайв! Весь поток ×7 на {s} с', { s: Math.round(res.seconds) }));
      render(true);
      return;
    }
    if (S.lock > 0) return;
    const hit = nodeAt(x, y);
    if (hit) {
      const r = C.crack(S, hit.c.id, hit.p.k);
      if (r === 'locked') { onLocked(S.lost); render(true); return; }
      if (r) {
        Sound.node((S.cracked[hit.c.id] || []).length);
        fx.sparks.push({ x: hit.p.x, y: hit.p.y, t: 0, life: 0.6, r: 22, color: '0,240,255', square: true });
        burstGlyphs(hit.p.x, hit.p.y, '0,240,255', 10);
        if (r === 'breach') {
          Sound.breach();
          fx.flash = 0.8;
          toast(t('Взлом завершён: {name}. Бонус навсегда: {bonus}', { name: hit.c.name, bonus: hit.c.bonusText }), 4.5);
        }
        render(true);
        return;
      }
    }
    const res = C.click(S);
    if (!res) return;
    Sound.click(res.hot);
    fx.floaters.push({ x, y: y - 6, t: 0, text: `+${fmt(res.amount)}`, color: res.hot ? '#ff2bd6' : '#00f0ff', big: res.hot });
    burstGlyphs(x, y, res.hot ? '255,43,214' : '0,240,255', res.hot ? 6 : 3);
    if (!reduceMotion) fx.sparks.push({ x, y, t: 0, life: 0.4, r: 12, color: res.hot ? '255,43,214' : '0,240,255', square: true });
    if (res.locked) onLocked(S.lost);
    if (!fx.hintFaded && S.stats.clicks > 8) { fx.hintFaded = true; $('hint').style.opacity = 0; }
    render(true);
  });
  canvas.addEventListener('pointermove', (e) => {
    const { x, y } = cityPoint(e);
    fx.hover = nodeAt(x, y);
    canvas.style.cursor = S.lock > 0 ? 'not-allowed' : fx.hover || onDrone(x, y) ? 'pointer' : 'crosshair';
  });
  canvas.addEventListener('pointerleave', () => { fx.hover = null; });

  // ───────────── Panel ─────────────
  $('lang-slot').append(GameNav.home('lang-toggle'), I18n.toggle('lang-toggle'));
  let buyMode = '1';
  for (const b of document.querySelectorAll('.seg button')) {
    b.addEventListener('click', () => {
      buyMode = b.dataset.n;
      for (const o of document.querySelectorAll('.seg button')) o.setAttribute('aria-pressed', String(o === b));
      render(true);
    });
  }

  const soundLabel = () => t(Sound.on ? 'Звук: вкл' : 'Звук: выкл');
  $('btn-sound').textContent = soundLabel();
  $('btn-sound').setAttribute('aria-pressed', String(Sound.on));
  $('btn-sound').addEventListener('click', () => {
    Sound.init();
    const on = Sound.toggle();
    $('btn-sound').textContent = soundLabel();
    $('btn-sound').setAttribute('aria-pressed', String(on));
  });

  const rigEls = {};
  for (const rig of C.RIGS) {
    const b = document.createElement('button');
    b.className = 'rig';
    b.innerHTML = '<span class="rig-name"></span><span class="rig-count">0</span><span class="rig-meta"></span>';
    b.title = rig.note;
    b.addEventListener('click', () => {
      Sound.init();
      const n = buyAmount(rig.id);
      if (n > 0 && C.buy(S, rig.id, n)) { Sound.buy(); render(true); }
    });
    $('rigs').append(b);
    rigEls[rig.id] = { b, name: b.querySelector('.rig-name'), count: b.querySelector('.rig-count'), meta: b.querySelector('.rig-meta') };
  }

  function buyAmount(id) {
    if (buyMode === 'max') return C.maxAffordable(S, id);
    return Number(buyMode);
  }

  const corpEls = C.CORPS.map((c, i) => {
    const li = document.createElement('li');
    li.style.setProperty('--hue', TOWERS[i].hue);
    li.innerHTML = '<span class="mark"></span><span class="name"></span><span class="bonus"></span>';
    $('corps').append(li);
    return { li, mark: li.querySelector('.mark'), name: li.querySelector('.name'), bonus: li.querySelector('.bonus') };
  });

  let upKey = '';
  const set = (el, prop, v) => { if (el[prop] !== v) el[prop] = v; };

  function render(force) {
    const d = C.derived(S);
    set($('data'), 'textContent', fmt(S.data));
    set($('rate'), 'textContent', t('{rate}/с · клик {click} · в красной зоне {hot}', { rate: fmt(d.rate), click: fmt(d.click), hot: fmt(d.hotClick) }));

    // Trace meter
    const tr = Math.round(S.trace);
    set($('trace-pct'), 'textContent', S.lock > 0 ? t('ЛЁД · {s} с', { s: Math.ceil(S.lock) }) : `${tr}%`);
    $('trace-fill').style.width = `${S.trace}%`;
    $('trace-hot').style.left = `${d.hotFrom}%`;
    const wrap = $('trace-wrap');
    wrap.classList.toggle('is-hot', C.hot(S));
    wrap.classList.toggle('is-locked', S.lock > 0);

    $('overdrive').hidden = !(S.overdrive > 0);
    if (S.overdrive > 0) set($('overdrive'), 'textContent', t('Овердрайв ×7 · {s} с', { s: Math.ceil(S.overdrive) }));
    $('lock').hidden = !(S.lock > 0);
    if (S.lock > 0) set($('lock'), 'textContent', t('Блокировка ЛЬДА · {s} с', { s: Math.ceil(S.lock) }));
    set($('cred'), 'textContent', S.cred ? t('слава: {n} (+{pct}%)', { n: S.cred, pct: S.cred * 10 }) : '');

    // Rigs: show owned ones, the next affordable-ish one, and one mystery row.
    let mysteryShown = false;
    for (const rig of C.RIGS) {
      const e = rigEls[rig.id];
      const owned = C.count(S, rig.id);
      const known = owned > 0 || S.stats.data >= rig.base * 0.6;
      if (!known) {
        e.b.hidden = mysteryShown; mysteryShown = true;
        e.b.disabled = true; e.b.className = 'rig mystery';
        set(e.name, 'textContent', '▒▒▒▒▒▒'); set(e.count, 'textContent', '');
        set(e.meta, 'textContent', t('откроется ближе к {n}', { n: fmt(rig.base) }));
        continue;
      }
      e.b.hidden = false;
      const n = Math.max(1, buyAmount(rig.id));
      const price = C.cost(rig.id, owned, n);
      const poor = price > S.data;
      e.b.className = `rig${poor ? ' poor' : ''}`;
      e.b.disabled = poor;
      set(e.name, 'textContent', rig.name);
      set(e.count, 'textContent', String(owned));
      const total = d.per[rig.id] * owned;
      const meta = `<span class="cost">${n > 1 ? `×${n} · ` : ''}${fmt(price)}</span> · ${t('{n}/с каждый', { n: fmt(d.per[rig.id]) })}${owned ? ` · ${t('всего {n}/с', { n: fmt(total) })}` : ''}`;
      set(e.meta, 'innerHTML', meta);
    }

    // Upgrades: rebuild only when the available set changes.
    const avail = C.UPGRADES.filter((u) => C.upgradeAvailable(S, u)).sort((a, b) => a.cost - b.cost);
    const key = avail.map((u) => u.id).join('|');
    if (key !== upKey) {
      upKey = key;
      $('upgrades').innerHTML = '';
      for (const u of avail) {
        const b = document.createElement('button');
        b.className = `up${u.kind === 'rig' ? '' : ' special'}`; b.dataset.id = u.id;
        b.innerHTML = `<b>${u.name}</b><span>${u.desc}</span><span class="cost">${fmt(u.cost)}</span>`;
        b.addEventListener('click', () => { if (C.buyUpgrade(S, u.id)) { Sound.buy(); render(true); } });
        $('upgrades').append(b);
      }
    }
    $('sec-upgrades').hidden = !avail.length;
    for (const b of $('upgrades').children) b.disabled = C.UPGRADES.find((u) => u.id === b.dataset.id).cost > S.data;

    // Corporations
    let done = 0;
    C.CORPS.forEach((c, i) => {
      const e = corpEls[i];
      const isDone = !!S.corp[c.id], open = C.revealed(S, c);
      if (isDone) done++;
      e.li.className = isDone ? 'done' : open ? 'open' : 'locked';
      set(e.mark, 'textContent', isDone ? '◆' : open ? `${(S.cracked[c.id] || []).length}/${c.nodes}` : '·');
      set(e.name, 'textContent', open ? c.name : t('Цель скрыта'));
      set(e.bonus, 'textContent', isDone ? c.bonusText : open ? t('взломай узлы на башне') : t('при {n}', { n: fmt(c.need) }));
    });
    set($('corp-count'), 'textContent', t('{done} из {total}', { done, total: C.CORPS.length }));

    const gain = C.credGain(S);
    $('sec-reflash').hidden = gain < 1;
    if (gain >= 1 && !reflashArmed) set($('btn-reflash'), 'textContent', t('Перепрошиться: +{n} {cred}', { n: gain, cred: I18n.p(gain, 'очко славы|очка славы|очков славы') }));
    if (force) checkReveals();
  }

  function checkReveals() {
    for (const c of C.CORPS) {
      if (C.revealed(S, c) && !S.seen[c.id]) {
        S.seen[c.id] = true;
        toast(t('Новая цель: {name}. Взломай красные узлы ЛЬДА на башне, каждый поднимает след на {n}%.', { name: c.name, n: C.TRACE.node }), 5.5);
      }
    }
  }

  let reflashArmed = null;
  $('btn-reflash').addEventListener('click', () => {
    if (!reflashArmed) {
      $('btn-reflash').textContent = t('Точно? Всё, кроме славы, начнётся заново');
      reflashArmed = setTimeout(() => { reflashArmed = null; render(true); }, 3500);
      return;
    }
    clearTimeout(reflashArmed); reflashArmed = null;
    const gain = C.credGain(S);
    S = C.reflash(S);
    drone = null; upKey = '';
    fx.hintFaded = false; $('hint').style.opacity = 1;
    save();
    toast(t('Перепрошивка! Уличная слава: {cred} (+{gain}). Город тебя ещё помнит.', { cred: S.cred, gain }), 5);
    render(true);
  });

  let resetArmed = null;
  $('btn-reset').addEventListener('click', () => {
    const b = $('btn-reset');
    if (!resetArmed) {
      b.textContent = t('Точно? Нажми ещё раз');
      resetArmed = setTimeout(() => { b.textContent = t('Начать с нуля'); resetArmed = null; }, 3000);
      return;
    }
    clearTimeout(resetArmed); resetArmed = null;
    b.textContent = t('Начать с нуля');
    S = C.newState(); drone = null; upKey = '';
    save(); render(true);
  });

  // ───────────── Cloud saves (only when served by the Go backend) ─────────────
  async function initCloud() {
    if (!(await GameNav.onServer())) return;
    $('cloud').hidden = false;
    const pretty = (c) => c.match(/.{1,4}/g).join('-');
    let code = store.get(CLOUD_KEY);
    if (code) $('cloud-code').textContent = pretty(code);
    const put = async () => {
      const res = await fetch(`../api/saves/${code}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S) });
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
        $('cloud-msg').textContent = t('Сохранено. Введи этот код на другом устройстве.');
      } catch (err) { $('cloud-msg').textContent = t('Не удалось сохранить: {err}', { err: err.message }); }
    });
    $('cloud-load').addEventListener('submit', async (e) => {
      e.preventDefault();
      const c = $('cloud-input').value.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (c.length !== 16) { $('cloud-msg').textContent = t('Код состоит из 16 букв и цифр.'); return; }
      try {
        const res = await fetch(`../api/saves/${c}`);
        if (res.status === 404) { $('cloud-msg').textContent = t('Сохранения с таким кодом нет.'); return; }
        if (!res.ok) throw new Error(await res.text());
        S = C.migrate(await res.json());
        code = c; store.set(CLOUD_KEY, c); $('cloud-code').textContent = pretty(c);
        drone = null; upKey = ''; save(); render(true);
        $('cloud-msg').textContent = t('Загружено.');
      } catch (err) { $('cloud-msg').textContent = t('Не удалось загрузить: {err}', { err: err.message }); }
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
      if (got >= 1) toast(t('Пока тебя не было, железо выкачало {n}.', { n: fmt(got) }), 5);
    }
  }
  if (S.stats.clicks > 8) { fx.hintFaded = true; $('hint').style.opacity = 0; }
  render(true);
  initCloud();

  let last = performance.now(), uiT = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    C.tick(S, dt);
    if (S.droneIn <= 0 && !drone) spawnDrone();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (fx.shake > 0 && !reduceMotion) { ctx.translate(rand(-4, 4) * fx.shake, rand(-4, 4) * fx.shake); fx.shake = Math.max(0, fx.shake - dt); }
    drawCity(now / 1000, dt);
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
