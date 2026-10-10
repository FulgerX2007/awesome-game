'use strict';
// Комета — rendering, input, sound and leaderboard. Physics lives in core.js (window.CometCore).
(() => {
  const C = window.CometCore;
  const BOARD_URL = '/api/boards/comet/scores';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };

  // ───────────── Sound ─────────────
  const Sound = (() => {
    let ac = null, master = null, pad = null, padTimer = 0, chord = 0;
    let muted = store.get('comet.muted', '0') === '1';
    const CHORDS = [[0, 7, 16], [-3, 4, 12], [-7, 0, 9], [-5, 2, 11]];
    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.55; master.connect(ac.destination);
      pad = ac.createGain(); pad.gain.value = 0.0001; pad.connect(master);
    }
    function tone(f, { t = 0, a = 0.01, d = 0.4, vol = 0.15, type = 'sine', to, dest } = {}) {
      if (!ac) return;
      const now = ac.currentTime + t;
      const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, now);
      if (to) o.frequency.exponentialRampToValueAtTime(to, now + a + d);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol, now + a);
      g.gain.exponentialRampToValueAtTime(0.0001, now + a + d);
      o.connect(g); g.connect(dest || master); o.start(now); o.stop(now + a + d + 0.05);
    }
    function noise(d, vol, freq, type = 'bandpass') {
      if (!ac) return;
      const now = ac.currentTime, len = Math.ceil(ac.sampleRate * d);
      const buf = ac.createBuffer(1, len, ac.sampleRate), data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      const src = ac.createBufferSource(); src.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = ac.createGain(); g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(master); src.start(now);
    }
    return {
      init,
      get muted() { return muted; },
      toggle() {
        muted = !muted; store.set('comet.muted', muted ? '1' : '0');
        if (ac) master.gain.setTargetAtTime(muted ? 0 : 0.55, ac.currentTime, 0.05);
      },
      // Slow ambient chords; louder while flying.
      tick(dt, playing) {
        if (!ac) return;
        pad.gain.setTargetAtTime(playing ? 0.05 : 0.03, ac.currentTime, 0.5);
        padTimer -= dt;
        if (padTimer > 0) return;
        padTimer = 4;
        chord = (chord + 1) % CHORDS.length;
        for (const s of CHORDS[chord]) tone(220 * 2 ** (s / 12), { a: 1.2, d: 3.6, vol: 0.6, type: 'triangle', dest: pad });
      },
      release() { noise(0.25, 0.12, 2400, 'highpass'); },
      capture(r, fresh) { tone(880 * (30 / r) ** 0.5, { d: 0.6, vol: fresh ? 0.14 : 0.07, type: 'triangle' }); },
      star(k) { tone(1320 * 2 ** ((k % 5) * 2 / 12), { d: 0.35, vol: 0.08 }); tone(1980, { t: 0.05, d: 0.3, vol: 0.04 }); },
      death() { noise(1.2, 0.5, 180, 'lowpass'); tone(160, { to: 40, d: 1.2, vol: 0.25, type: 'sawtooth' }); },
      record() { [0, 4, 7, 12].forEach((s, i) => tone(523 * 2 ** (s / 12), { t: 0.3 + i * 0.1, d: 0.8, vol: 0.08, type: 'triangle' })); },
    };
  })();

  // ───────────── State ─────────────
  let W = null;                 // world
  let mode = 'menu';            // menu | play | over | pause
  let best = Number(store.get('comet.best', 0));
  const fx = { trail: [], parts: [], rings: [], shake: 0, flash: 0, floaters: [] };

  function newWorld() {
    W = C.createWorld((Math.random() * 2 ** 32) >>> 0);
    fx.trail = []; fx.parts = []; fx.rings = []; fx.floaters = [];
    cam.y = W.player.y - viewH() * 0.62;
  }

  // ───────────── Canvas & camera ─────────────
  const canvas = $('space');
  const ctx = canvas.getContext('2d');
  let SW = 0, SH = 0, DPR = 1, scale = 1, offX = 0;
  const cam = { y: 0 };
  const viewH = () => SH / scale;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    SW = window.innerWidth; SH = window.innerHeight;
    canvas.width = Math.round(SW * DPR); canvas.height = Math.round(SH * DPR);
    scale = Math.min(SW, SH * 0.68) / C.WIDTH;
    offX = (SW - C.WIDTH * scale) / 2;
  }
  window.addEventListener('resize', resize);

  // Parallax starfield tiles.
  const layers = [0.15, 0.35, 0.6].map((depth, li) => ({
    depth,
    stars: Array.from({ length: 70 - li * 15 }, () => ({ x: Math.random(), y: Math.random(), r: 0.5 + li * 0.45 + Math.random() * 0.5, tw: Math.random() * 6 })),
  }));
  const nebulae = Array.from({ length: 6 }, (_, i) => ({ x: Math.random(), y: i * 700 + Math.random() * 400, r: 260 + Math.random() * 260, hue: Math.random() * 360 }));

  // ───────────── Effects ─────────────
  function burst(x, y, color, n, speed = 140, life = 0.8) {
    if (reduceMotion) n = Math.ceil(n / 4);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(speed * 0.3, speed);
      fx.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rand(life * 0.5, life), color, s: rand(1.5, 3.5) });
    }
  }

  function handleEvents() {
    for (const e of W.events) {
      if (e.type === 'release') Sound.release();
      if (e.type === 'capture') {
        Sound.capture(e.planet.r, e.fresh);
        fx.rings.push({ x: e.planet.x, y: e.planet.y, planet: e.planet, r: e.planet.r, t: 0 });
        if (e.fresh) floater(e.planet.x, e.planet.y - e.planet.r - 16, `${W.planetsVisited}`, 'rgba(189,243,255,0.9)');
      }
      if (e.type === 'star') {
        Sound.star(W.starsGot);
        burst(e.x, e.y, '#ffd166', 14, 120, 0.6);
        floater(e.x, e.y - 14, '+10', '#ffd166');
      }
      if (e.type === 'death') onDeath(e.cause);
    }
    W.events.length = 0;
  }

  function floater(x, y, text, color) { fx.floaters.push({ x, y, text, color, t: 0 }); }

  // ───────────── Drawing ─────────────
  const sx = (x) => offX + x * scale;
  const sy = (y) => (y - cam.y) * scale;

  function skyHue() { return (220 + C.height(cam.y + viewH()) * 0.06) % 360; }

  function drawBackground(now) {
    const hue = skyHue();
    const g = ctx.createLinearGradient(0, 0, 0, SH);
    g.addColorStop(0, `hsl(${hue}, 45%, 5%)`);
    g.addColorStop(1, `hsl(${(hue + 40) % 360}, 50%, 9%)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, SW, SH);

    for (const n of nebulae) {
      const period = 4200;
      const ny = ((((n.y - cam.y * 0.1) % period) + period) % period) - 600;
      const ng = ctx.createRadialGradient(n.x * SW, ny * scale * 0.5, 0, n.x * SW, ny * scale * 0.5, n.r * scale);
      ng.addColorStop(0, `hsla(${(n.hue + hue) % 360}, 70%, 45%, 0.10)`);
      ng.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = ng; ctx.fillRect(0, 0, SW, SH);
    }
    for (const L of layers) {
      const tileH = SH * 1.2;
      for (const s of L.stars) {
        const y = (((s.y * tileH - cam.y * scale * L.depth) % tileH) + tileH) % tileH - SH * 0.1;
        const a = 0.35 + 0.35 * Math.sin(now / 900 + s.tw);
        ctx.fillStyle = `rgba(230,236,255,${a})`;
        ctx.fillRect(s.x * SW, y, s.r, s.r);
      }
    }
    // Edges of the playable column.
    if (offX > 4) {
      ctx.fillStyle = 'rgba(7,6,15,0.55)';
      ctx.fillRect(0, 0, offX, SH); ctx.fillRect(SW - offX, 0, offX, SH);
      ctx.strokeStyle = 'rgba(143,147,184,0.15)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(offX, 0); ctx.lineTo(offX, SH); ctx.moveTo(SW - offX, 0); ctx.lineTo(SW - offX, SH); ctx.stroke();
    }
    // Altitude marks every 100 m.
    ctx.font = `600 ${Math.round(11 * Math.max(scale, 0.8))}px Manrope, sans-serif`;
    ctx.textAlign = 'left';
    const top = cam.y, bottom = cam.y + viewH();
    for (let m = Math.ceil(C.height(bottom) / 100) * 100; m * -10 > top; m += 100) {
      if (m <= 0) continue;
      const y = sy(-m * 10);
      ctx.strokeStyle = 'rgba(143,147,184,0.12)';
      ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.moveTo(sx(0), y); ctx.lineTo(sx(C.WIDTH), y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(143,147,184,0.45)';
      ctx.fillText(`${m} м`, sx(0) + 6, y - 4);
    }
  }

  function drawPlanet(p, now) {
    const x = sx(p.x), y = sy(p.y), r = p.r * scale;
    if (y < -300 || y > SH + 300) return;
    const pl = W.player;
    const isNext = pl.state === 'fly' || (pl.planet === p);
    // capture field
    ctx.strokeStyle = p.kind === 'hole' ? 'rgba(196,139,255,0.25)' : `rgba(189,243,255,${isNext ? 0.16 : 0.08})`;
    ctx.setLineDash([3, 7]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, p.cap * scale, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    if (p.kind === 'hole') {
      const t = now / 1000;
      const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 3.2);
      g.addColorStop(0, 'rgba(196,139,255,0.35)'); g.addColorStop(1, 'rgba(196,139,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2.5 * scale;
      for (let k = 0; k < 5; k++) {
        const a0 = t * (1.6 + k * 0.3) + k * 1.3;
        ctx.strokeStyle = k % 2 ? 'rgba(255,122,61,0.8)' : 'rgba(255,190,140,0.7)';
        ctx.beginPath(); ctx.arc(x, y, r * (1.25 + k * 0.22), a0, a0 + 1.6 + k * 0.2); ctx.stroke();
      }
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,190,0.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r * 1.05, 0, Math.PI * 2); ctx.stroke();
      return;
    }

    // atmosphere glow
    const glow = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 1.8);
    glow.addColorStop(0, `hsla(${p.hue}, 80%, 65%, 0.35)`); glow.addColorStop(1, `hsla(${p.hue}, 80%, 65%, 0)`);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.fill();

    if (p.ringed) drawRing(x, y, r, p.hue, true);
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    const body = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
    body.addColorStop(0, `hsl(${p.hue}, 65%, 68%)`); body.addColorStop(1, `hsl(${(p.hue + 20) % 360}, 55%, 38%)`);
    ctx.fillStyle = body; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    for (let b = 0; b < p.bands; b++) {
      const by = y - r + ((b + 0.7) / (p.bands + 0.4)) * r * 2;
      ctx.fillStyle = `hsla(${(p.hue + 30 + b * 15) % 360}, 50%, ${b % 2 ? 30 : 75}%, 0.22)`;
      ctx.fillRect(x - r, by - r * 0.12, r * 2, r * (0.14 + (b % 2) * 0.1));
    }
    const shade = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    shade.addColorStop(0.45, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(4,2,12,0.6)');
    ctx.fillStyle = shade; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
    if (p.ringed) drawRing(x, y, r, p.hue, false);

    if (p.belt) {
      for (let k = 0; k < p.belt.n; k++) {
        const a = p.belt.angle + (k / p.belt.n) * Math.PI * 2;
        const ax = sx(p.x + Math.cos(a) * p.belt.r), ay = sy(p.y + Math.sin(a) * p.belt.r), s = p.belt.size * scale;
        ctx.fillStyle = '#7d7064';
        ctx.beginPath();
        for (let j = 0; j < 7; j++) {
          const aa = (j / 7) * Math.PI * 2 + a * 2;
          const rr = s * (0.8 + 0.25 * Math.sin(j * 2.3 + k));
          j ? ctx.lineTo(ax + Math.cos(aa) * rr, ay + Math.sin(aa) * rr) : ctx.moveTo(ax + Math.cos(aa) * rr, ay + Math.sin(aa) * rr);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(183,169,154,0.6)';
        ctx.beginPath(); ctx.arc(ax - s * 0.25, ay - s * 0.25, s * 0.3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Ring split in two halves so the planet sits between them.
  function drawRing(x, y, r, hue, back) {
    ctx.strokeStyle = `hsla(${(hue + 50) % 360}, 60%, 75%, 0.65)`;
    ctx.lineWidth = Math.max(2, r * 0.14);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.7, r * 0.45, -0.35, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI);
    ctx.stroke();
  }

  function drawStars(now) {
    for (const s of W.stars) {
      if (s.got) continue;
      const x = sx(s.x), y = sy(s.y);
      if (y < -30 || y > SH + 30) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 18 * scale);
      g.addColorStop(0, 'rgba(255,209,102,0.45)'); g.addColorStop(1, 'rgba(255,209,102,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 18 * scale, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(x, y); ctx.rotate(now / 700 + s.spin);
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const rr = (k % 2 ? 3.5 : 8) * scale, a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        k ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }

  function drawFlare(now) {
    const top = sy(W.flareY);
    if (top > SH + 40) return;
    const g = ctx.createLinearGradient(0, top - 60 * scale, 0, SH);
    g.addColorStop(0, 'rgba(255,122,61,0)');
    g.addColorStop(0.15, 'rgba(255,122,61,0.55)');
    g.addColorStop(0.5, 'rgba(255,70,40,0.85)');
    g.addColorStop(1, 'rgba(160,20,30,0.95)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, SH);
    for (let x = 0; x <= SW + 20; x += 20) {
      const wave = Math.sin(x / 60 + now / 400) * 8 + Math.sin(x / 23 - now / 250) * 4;
      ctx.lineTo(x, top + wave * scale);
    }
    ctx.lineTo(SW, SH); ctx.closePath(); ctx.fill();
    if (!reduceMotion && Math.random() < 0.5) {
      const ex = rand(0, C.WIDTH);
      fx.parts.push({ x: ex, y: W.flareY, vx: rand(-15, 15), vy: rand(-90, -40), t: 0, life: rand(0.6, 1.4), color: '#ffb36b', s: rand(1.5, 3) });
    }
  }

  function drawComet(now) {
    const pl = W.player;
    const x = sx(pl.x), y = sy(pl.y);
    // aim preview while orbiting
    if (pl.state === 'orbit' && mode !== 'over') {
      const t = C.tangent(pl);
      for (let k = 1; k <= 9; k++) {
        const d = k * 18;
        ctx.fillStyle = `rgba(189,243,255,${0.5 * (1 - k / 10)})`;
        ctx.beginPath(); ctx.arc(sx(pl.x + t.x * d), sy(pl.y + t.y * d), 1.6 * scale, 0, Math.PI * 2); ctx.fill();
      }
      // Black hole: show how much orbit is left.
      if (pl.planet.kind === 'hole') {
        const p = pl.planet;
        ctx.strokeStyle = 'rgba(196,139,255,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), (p.r + 4) * scale, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (W.dead) return;
    fx.trail.push({ x: pl.x, y: pl.y, t: 0 });
    for (const tr of fx.trail) {
      const k = 1 - tr.t / 0.6;
      if (k <= 0) continue;
      ctx.fillStyle = `hsla(${190 - (1 - k) * 60}, 100%, ${70 + k * 20}%, ${k * 0.55})`;
      ctx.beginPath(); ctx.arc(sx(tr.x), sy(tr.y), (1 + k * 5) * scale, 0, Math.PI * 2); ctx.fill();
    }
    const g = ctx.createRadialGradient(x, y, 0, x, y, 22 * scale);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.25, 'rgba(189,243,255,0.7)'); g.addColorStop(1, 'rgba(189,243,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 22 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 4.5 * scale, 0, Math.PI * 2); ctx.fill();
  }

  function drawFx(dt) {
    for (const tr of fx.trail) tr.t += dt;
    fx.trail = fx.trail.filter((t) => t.t < 0.6);
    for (const r of fx.rings) {
      r.t += dt;
      const k = r.t / 0.6;
      ctx.strokeStyle = `rgba(189,243,255,${0.6 * (1 - k)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx(r.planet.x), sy(r.planet.y), (r.r + k * 50) * scale, 0, Math.PI * 2); ctx.stroke();
    }
    fx.rings = fx.rings.filter((r) => r.t < 0.6);
    for (const p of fx.parts) {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.98; p.vy *= 0.98;
      ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
      ctx.fillStyle = p.color; ctx.fillRect(sx(p.x), sy(p.y), p.s * scale, p.s * scale);
    }
    ctx.globalAlpha = 1;
    fx.parts = fx.parts.filter((p) => p.t < p.life);
    ctx.font = `700 ${Math.round(14 * Math.max(scale, 0.8))}px Manrope, sans-serif`;
    ctx.textAlign = 'center';
    for (const f of fx.floaters) {
      f.t += dt;
      ctx.globalAlpha = clamp(1.2 - f.t, 0, 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, sx(f.x), sy(f.y) - f.t * 30);
    }
    ctx.globalAlpha = 1;
    fx.floaters = fx.floaters.filter((f) => f.t < 1.2);
  }

  function render(now, dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const shakeX = fx.shake ? rand(-fx.shake, fx.shake) : 0, shakeY = fx.shake ? rand(-fx.shake, fx.shake) : 0;
    ctx.translate(shakeX, shakeY);
    drawBackground(now);
    for (const p of W.planets) drawPlanet(p, now);
    drawStars(now);
    drawComet(now);
    drawFlare(now);
    drawFx(dt);
    if (fx.flash > 0) {
      ctx.fillStyle = `rgba(255,140,90,${fx.flash * 0.35})`; ctx.fillRect(-20, -20, SW + 40, SH + 40);
    }
  }

  // ───────────── Flow ─────────────
  const CAUSES = {
    flare: 'Солнечная вспышка догнала комету.',
    void: 'Комета улетела в пустоту, мимо всех полей гравитации.',
    asteroid: 'Столкновение с астероидом.',
    hole: 'Чёрная дыра затянула комету за горизонт событий.',
  };

  function start() {
    Sound.init();
    newWorld();
    mode = 'play';
    $('overlay').hidden = true;
    $('hud').hidden = false;
    updateHud(true);
  }

  function onDeath(cause) {
    const pl = W.player;
    burst(pl.x, pl.y, '#bdf3ff', 40, 220, 1.2);
    burst(pl.x, pl.y, '#ff7a3d', 20, 160, 1);
    fx.shake = reduceMotion ? 0 : 10; fx.flash = 1;
    Sound.death();
    const score = C.score(W);
    const record = score > best;
    if (record) { best = score; store.set('comet.best', best); setTimeout(() => Sound.record(), 600); }
    setTimeout(() => {
      mode = 'over';
      $('over-title').textContent = record ? 'Новый рекорд' : 'Комета погасла';
      $('over-cause').textContent = CAUSES[cause] || '';
      $('over-stats').innerHTML =
        `<div class="${record ? 'record' : ''}"><dt>Очки</dt><dd>${score}</dd></div>` +
        `<div><dt>Высота</dt><dd>${Math.floor(C.height(W.maxY))} м</dd></div>` +
        `<div><dt>Планеты</dt><dd>${W.planetsVisited}</dd></div>`;
      showPanel('panel-over');
      submitScore(score);
    }, 1100);
  }

  function showPanel(id) {
    $('overlay').hidden = false;
    for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== id;
    document.querySelector(`#${id} .btn`)?.focus();
  }

  function pause(on) {
    if (on && mode === 'play') { mode = 'pause'; showPanel('panel-pause'); }
    else if (!on && mode === 'pause') { mode = 'play'; $('overlay').hidden = true; }
  }

  const hudCache = {};
  function setText(id, t) { if (hudCache[id] !== t) { hudCache[id] = t; $(id).textContent = t; } }
  function updateHud() {
    setText('hud-score', String(C.score(W)));
    setText('hud-height', `${Math.floor(C.height(W.maxY))} м`);
    setText('hud-stars', `★ ${W.starsGot}`);
    setText('hud-best', best ? `рекорд ${best}` : '');
  }

  // ───────────── Leaderboard ─────────────
  const playerName = () => ($('name').value.trim() || 'Аноним').slice(0, 16);
  function renderBoard(el, entries, myRank) {
    if (!entries || !entries.length) { el.innerHTML = best ? `<p>Твой рекорд: <b>${best}</b></p>` : ''; return; }
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    el.innerHTML = '<table><caption>ЛУЧШИЕ ПОЛЁТЫ</caption>' + entries.map((e, i) =>
      `<tr class="${i + 1 === myRank ? 'me' : ''}"><td>${i + 1}.</td><td>${esc(e.name)}</td><td>${e.score}</td></tr>`).join('') + '</table>';
  }
  async function loadBoard() {
    try {
      const res = await fetch(BOARD_URL);
      if (!res.ok) throw new Error(res.status);
      renderBoard($('board-menu'), await res.json());
    } catch { renderBoard($('board-menu'), null); }
  }
  async function submitScore(score) {
    try {
      const res = await fetch(BOARD_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: playerName(), score, level: Math.max(1, W.planetsVisited) }),
      });
      if (!res.ok) throw new Error(res.status);
      const { rank, top } = await res.json();
      renderBoard($('board-over'), top, rank);
    } catch { renderBoard($('board-over'), null); }
  }

  // ───────────── Input ─────────────
  function primary() {
    Sound.init();
    if (mode === 'play') C.release(W);
    else if (mode === 'menu' || mode === 'over') start();
    else if (mode === 'pause') pause(false);
  }
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); if (mode === 'play') primary(); });
  window.addEventListener('keydown', (e) => {
    if (e.target === $('name')) { if (e.key === 'Enter') { e.preventDefault(); start(); } return; }
    if (e.code === 'Escape' || e.code === 'KeyP') { pause(mode === 'play'); return; }
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp') {
      if (e.target.closest('button') && mode !== 'play') return;
      e.preventDefault();
      if (!e.repeat) primary();
    }
  });
  window.addEventListener('blur', () => pause(true));
  $('btn-start').addEventListener('click', start);
  $('btn-retry').addEventListener('click', start);
  $('btn-resume').addEventListener('click', () => pause(false));
  $('btn-mute').addEventListener('click', (e) => { Sound.init(); Sound.toggle(); e.currentTarget.blur(); syncMute(); });
  function syncMute() {
    $('btn-mute').textContent = Sound.muted ? 'Звук: выкл' : 'Звук: вкл';
    $('btn-mute').setAttribute('aria-pressed', String(Sound.muted));
  }
  $('name').value = store.get('comet.name', '');
  $('name').addEventListener('input', () => store.set('comet.name', $('name').value));

  // ───────────── Loop ─────────────
  resize();
  newWorld();
  syncMute();
  loadBoard();
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    fx.shake = Math.max(0, fx.shake - dt * 25);
    fx.flash = Math.max(0, fx.flash - dt * 2);
    if (mode === 'menu') { W.flareY = W.player.y + 420; C.step(W, dt); W.events.length = 0; }
    else if (mode === 'play') { C.step(W, dt); handleEvents(); updateHud(); }
    // Camera only climbs; the comet sits a bit below centre.
    const target = Math.min(W.player.y - viewH() * 0.62, cam.y);
    cam.y += (target - cam.y) * (1 - Math.exp(-dt * 5));
    Sound.tick(dt, mode === 'play');
    render(now, dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
