'use strict';
// Глубина — rendering, input, sound. The simulation lives in core.js (window.DeepCore).
(() => {
  const C = window.DeepCore;
  const { t: tr } = window.I18n;
  const stageName = (i) => tr(C.STAGES[i].name);
  const SAVE_KEY = 'deep.save';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };

  // ───────────── Sound ─────────────
  const Sound = (() => {
    let ac = null, master = null, danger = null;
    let muted = store.get('deep.muted') === '1';
    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.55; master.connect(ac.destination);
      // Underwater hum: brown noise through a low-pass that breathes slowly.
      const len = ac.sampleRate * 4, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + (Math.random() * 2 - 1) * 0.02) * 0.995; d[i] = last * 8; }
      const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.05;
      const lg = ac.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      const hum = ac.createGain(); hum.gain.value = 0.16;
      src.connect(lp); lp.connect(hum); hum.connect(master); src.start();
      // Danger throb, faded in while a predator chases you.
      const o = ac.createOscillator(); o.frequency.value = 55;
      const am = ac.createOscillator(); am.frequency.value = 2.2;
      const amg = ac.createGain(); amg.gain.value = 0.5; am.connect(amg);
      danger = ac.createGain(); danger.gain.value = 0;
      amg.connect(danger.gain);
      o.connect(danger); danger.connect(master); o.start(); am.start();
    }
    function tone(f, { t = 0, d = 0.4, vol = 0.1, type = 'sine', to } = {}) {
      if (!ac) return;
      const now = ac.currentTime + t;
      const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, now);
      if (to) o.frequency.exponentialRampToValueAtTime(to, now + d);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol, now + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d);
      o.connect(g); g.connect(master); o.start(now); o.stop(now + d + 0.05);
    }
    return {
      init,
      get muted() { return muted; },
      toggle() {
        muted = !muted; store.set('deep.muted', muted ? '1' : '0');
        if (ac) master.gain.setTargetAtTime(muted ? 0 : 0.55, ac.currentTime, 0.05);
      },
      gulp(ratio) { const f = 300 + 500 * (1 - clamp(ratio, 0, 1)); tone(f, { d: 0.18, vol: 0.09, to: f * 0.55 }); },
      dash() { tone(180, { d: 0.35, vol: 0.06, to: 420, type: 'triangle' }); },
      stage() { [0, 4, 7, 12, 16].forEach((s, i) => tone(262 * 2 ** (s / 12), { t: i * 0.12, d: 1.8, vol: 0.07, type: 'triangle' })); },
      eaten() { tone(140, { d: 1.2, vol: 0.18, to: 45, type: 'sawtooth' }); },
      whale() { tone(220, { d: 3, vol: 0.06, to: 330 }); tone(330, { t: 1.4, d: 3, vol: 0.05, to: 196 }); },
      setDanger(k) { if (ac) danger.gain.setTargetAtTime(muted ? 0 : k * 0.12, ac.currentTime, 0.3); },
    };
  })();

  // ───────────── State ─────────────
  let W = null;
  let playing = false;
  let best = Number(store.get('deep.best') || 0);
  const cam = { x: 0, y: 0, z: 1 };
  const fx = { parts: [], flash: 0, danger: 0 };

  function startWorld(r0) {
    W = C.createWorld((Math.random() * 2 ** 32) >>> 0, r0);
    cam.x = W.player.x; cam.y = W.player.y; cam.z = targetZoom();
    fx.parts = [];
    renderLadder();
  }
  function save() { if (W) store.set(SAVE_KEY, JSON.stringify({ r: W.player.r, peak: W.player.peak })); }

  // ───────────── Canvas ─────────────
  const canvas = $('sea');
  const ctx = canvas.getContext('2d');
  let SW = 0, SH = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    SW = window.innerWidth; SH = window.innerHeight;
    canvas.width = Math.round(SW * DPR); canvas.height = Math.round(SH * DPR);
  }
  window.addEventListener('resize', resize);
  const targetZoom = () => Math.min(SW, SH) / C.viewSize(W.player.r);
  const sx = (x) => (x - cam.x) * cam.z + SW / 2;
  const sy = (y) => (y - cam.y) * cam.z + SH / 2;

  const snow = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, s: Math.random() }));

  // Murky green shallows for tiny creatures, deep blue open ocean for big ones.
  function drawWater(t) {
    const k = clamp(W.player.stage / 6, 0, 1);
    const top = mix([16, 70, 64], [10, 60, 105], k), bot = mix([3, 22, 26], [2, 12, 34], k);
    const g = ctx.createLinearGradient(0, 0, 0, SH);
    g.addColorStop(0, `rgb(${top})`); g.addColorStop(1, `rgb(${bot})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, SW, SH);
    // light shafts
    if (!reduceMotion) {
      for (let i = 0; i < 5; i++) {
        const x = ((i * 0.23 + t * 0.008 + Math.sin(t * 0.2 + i) * 0.02) % 1.2 - 0.1) * SW;
        const lg = ctx.createLinearGradient(x, 0, x + SW * 0.15, SH);
        lg.addColorStop(0, 'rgba(200,240,230,0.07)'); lg.addColorStop(1, 'rgba(200,240,230,0)');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + SW * 0.06, 0); ctx.lineTo(x + SW * 0.25, SH); ctx.lineTo(x + SW * 0.12, SH); ctx.fill();
      }
    }
    // marine snow drifting with parallax
    for (const p of snow) {
      const x = (((p.x * SW - cam.x * cam.z * 0.15 * p.z) % SW) + SW) % SW;
      const y = (((p.y * SH - cam.y * cam.z * 0.15 * p.z + t * 6 * p.z) % SH) + SH) % SH;
      ctx.fillStyle = `rgba(220,240,235,${0.15 + p.s * 0.25})`;
      ctx.fillRect(x, y, 1 + p.z * 1.5, 1 + p.z * 1.5);
    }
  }
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',');

  // ───────────── Creatures ─────────────
  function body(len, h, color, belly) {
    const g = ctx.createLinearGradient(0, -h, 0, h);
    g.addColorStop(0, color); g.addColorStop(1, belly || color);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(len * 0.55, 0);
    ctx.quadraticCurveTo(len * 0.3, -h, -len * 0.3, -h * 0.6);
    ctx.quadraticCurveTo(-len * 0.5, -h * 0.2, -len * 0.5, 0);
    ctx.quadraticCurveTo(-len * 0.5, h * 0.2, -len * 0.3, h * 0.6);
    ctx.quadraticCurveTo(len * 0.3, h, len * 0.55, 0);
    ctx.fill();
  }
  function tail(len, h, color, swing) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-len * 0.45, 0);
    ctx.lineTo(-len * 0.78, -h * 0.75 + swing);
    ctx.lineTo(-len * 0.68, swing * 0.5);
    ctx.lineTo(-len * 0.78, h * 0.75 + swing);
    ctx.closePath(); ctx.fill();
  }
  function eye(x, y, r) {
    ctx.fillStyle = '#0b1215'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(x + r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill();
  }

  function drawCreature(e, s, t) {
    const ph = e.phase;
    switch (e.kind) {
      case 'plankton': {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2.2);
        g.addColorStop(0, 'rgba(170,255,210,0.95)'); g.addColorStop(0.4, 'rgba(120,230,190,0.5)'); g.addColorStop(1, 'rgba(120,230,190,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s * 2.2, 0, Math.PI * 2); ctx.fill();
        return;
      }
      case 'cell': {
        ctx.fillStyle = 'rgba(150,220,140,0.45)'; ctx.strokeStyle = 'rgba(200,255,190,0.8)'; ctx.lineWidth = Math.max(1, s * 0.08);
        ctx.beginPath();
        for (let k = 0; k <= 24; k++) {
          const a = (k / 24) * Math.PI * 2, rr = s * (1 + 0.08 * Math.sin(a * 3 + ph * 2));
          k ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(60,120,70,0.8)'; ctx.beginPath(); ctx.arc(s * 0.2, -s * 0.1, s * 0.35, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(200,255,190,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2, w = Math.sin(ph * 4 + k) * 0.3;
          ctx.moveTo(Math.cos(a) * s, Math.sin(a) * s); ctx.lineTo(Math.cos(a + w) * s * 1.3, Math.sin(a + w) * s * 1.3);
        }
        ctx.stroke();
        return;
      }
      case 'krill': {
        const L = s * 2.2;
        ctx.strokeStyle = 'rgba(255,190,170,0.7)'; ctx.lineWidth = Math.max(1, s * 0.06);
        ctx.beginPath();
        for (let k = 0; k < 5; k++) { const x = L * (0.25 - k * 0.12); ctx.moveTo(x, s * 0.3); ctx.lineTo(x - s * 0.1, s * (0.7 + 0.15 * Math.sin(ph * 6 + k))); }
        ctx.moveTo(L * 0.45, -s * 0.1); ctx.quadraticCurveTo(L * 0.8, -s * 0.8, L * 1.1, -s * 0.4 + Math.sin(ph) * s * 0.2);
        ctx.stroke();
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = k % 2 ? 'rgba(242,140,120,0.85)' : 'rgba(250,165,145,0.85)';
          ctx.beginPath(); ctx.ellipse(L * (0.3 - k * 0.2), 0, s * 0.42 - k * s * 0.05, s * 0.36 - k * s * 0.04, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = 'rgba(242,140,120,0.85)';
        ctx.beginPath(); ctx.moveTo(-L * 0.5, 0); ctx.lineTo(-L * 0.75, -s * 0.35); ctx.lineTo(-L * 0.75, s * 0.35); ctx.fill();
        eye(L * 0.42, -s * 0.12, Math.max(1, s * 0.12));
        return;
      }
      case 'minnow': {
        const L = s * 2.4, H = s * 0.55, sw = Math.sin(ph * 5) * H * 0.4;
        tail(L, H, '#8fb8c8', sw);
        body(L, H, '#b9d7e2', '#e8f3f6');
        ctx.fillStyle = 'rgba(80,120,140,0.5)'; ctx.fillRect(-L * 0.3, -H * 0.1, L * 0.6, H * 0.15);
        eye(L * 0.32, -H * 0.15, Math.max(1, s * 0.12));
        return;
      }
      case 'fish': {
        const L = s * 2.3, H = s * 0.8, sw = Math.sin(ph * 4) * H * 0.35, hue = Math.round(e.hue * 60 + 15);
        tail(L, H, `hsl(${hue},75%,45%)`, sw);
        ctx.fillStyle = `hsl(${hue},70%,40%)`;
        ctx.beginPath(); ctx.moveTo(-L * 0.1, -H * 0.7); ctx.lineTo(L * 0.1, -H * 1.2); ctx.lineTo(L * 0.2, -H * 0.75); ctx.fill();
        body(L, H, `hsl(${hue},80%,58%)`, `hsl(${hue + 20},80%,78%)`);
        ctx.strokeStyle = `hsla(${hue},60%,30%,0.4)`; ctx.lineWidth = Math.max(1, s * 0.07);
        ctx.beginPath(); for (let k = 0; k < 3; k++) { const x = L * (0.15 - k * 0.15); ctx.moveTo(x, -H * 0.6); ctx.lineTo(x - L * 0.04, H * 0.6); } ctx.stroke();
        eye(L * 0.33, -H * 0.15, Math.max(1.2, s * 0.1));
        return;
      }
      case 'jelly': {
        const pulse = 1 + Math.sin(ph * 2) * 0.08;
        ctx.strokeStyle = 'rgba(214,170,255,0.45)'; ctx.lineWidth = Math.max(1, s * 0.05);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const x0 = -s * 0.3, y0 = s * (k / 5 - 0.5) * 1.2;
          ctx.moveTo(x0, y0);
          for (let j = 1; j <= 6; j++) ctx.lineTo(x0 - j * s * 0.35, y0 + Math.sin(ph * 2 + j + k) * s * 0.12);
        }
        ctx.stroke();
        const g = ctx.createRadialGradient(s * 0.2, 0, 0, 0, 0, s * 1.2);
        g.addColorStop(0, 'rgba(240,210,255,0.85)'); g.addColorStop(1, 'rgba(170,110,240,0.35)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.8 * pulse, s * 0.95 / pulse, 0, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
        return;
      }
      case 'squid': {
        const L = s * 2.4, H = s * 0.7;
        ctx.strokeStyle = '#d0573c'; ctx.lineWidth = Math.max(1.5, s * 0.1); ctx.lineCap = 'round';
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const y0 = H * (k / 5 - 0.5) * 0.8;
          ctx.moveTo(L * 0.3, y0);
          ctx.quadraticCurveTo(L * 0.6, y0 + Math.sin(ph * 3 + k) * H * 0.5, L * 0.85, y0 * 1.6 + Math.sin(ph * 3 + k + 1) * H * 0.4);
        }
        ctx.stroke();
        ctx.fillStyle = '#e8735a';
        ctx.beginPath(); ctx.ellipse(-L * 0.05, 0, L * 0.42, H * 0.62, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c9503a';
        ctx.beginPath(); ctx.moveTo(-L * 0.47, 0); ctx.lineTo(-L * 0.3, -H * 0.9); ctx.lineTo(-L * 0.22, 0); ctx.lineTo(-L * 0.3, H * 0.9); ctx.fill();
        ctx.fillStyle = 'rgba(255,200,170,0.35)';
        for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(-L * 0.2 + k * L * 0.07, (k % 2 ? 1 : -1) * H * 0.2, s * 0.06, 0, Math.PI * 2); ctx.fill(); }
        eye(L * 0.28, -H * 0.25, Math.max(1.5, s * 0.14));
        return;
      }
      case 'shark': {
        const L = s * 2.6, H = s * 0.62, sw = Math.sin(ph * 3) * H * 0.3;
        ctx.fillStyle = '#5d7686';
        ctx.beginPath(); ctx.moveTo(-L * 0.42, 0); ctx.lineTo(-L * 0.72, -H * 1.1 + sw); ctx.lineTo(-L * 0.6, sw * 0.3); ctx.lineTo(-L * 0.68, H * 0.6 + sw); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-L * 0.05, -H * 0.8); ctx.lineTo(L * 0.05, -H * 1.6); ctx.lineTo(L * 0.18, -H * 0.85); ctx.fill();
        ctx.beginPath(); ctx.moveTo(L * 0.1, H * 0.6); ctx.lineTo(-L * 0.05, H * 1.3); ctx.lineTo(L * 0.25, H * 0.7); ctx.fill();
        body(L, H, '#7590a0', '#e3ebee');
        ctx.strokeStyle = 'rgba(40,55,65,0.5)'; ctx.lineWidth = Math.max(1, s * 0.03);
        ctx.beginPath(); for (let k = 0; k < 4; k++) { const x = L * (0.3 - k * 0.04); ctx.moveTo(x, -H * 0.3); ctx.lineTo(x - L * 0.02, H * 0.2); } ctx.stroke();
        eye(L * 0.4, -H * 0.2, Math.max(1.2, s * 0.07));
        return;
      }
      case 'whale': {
        const L = s * 2.8, H = s * 0.75, sw = Math.sin(ph * 1.5) * H * 0.35;
        ctx.fillStyle = '#3e5f80';
        ctx.beginPath(); ctx.moveTo(-L * 0.45, 0); ctx.quadraticCurveTo(-L * 0.62, sw, -L * 0.7, -H * 0.7 + sw); ctx.lineTo(-L * 0.6, sw * 0.6); ctx.lineTo(-L * 0.7, H * 0.7 + sw); ctx.quadraticCurveTo(-L * 0.6, sw, -L * 0.45, 0); ctx.fill();
        body(L, H, '#4f7396', '#c9d9e3');
        ctx.fillStyle = '#3e5f80';
        ctx.beginPath(); ctx.ellipse(L * 0.12, H * 0.7, L * 0.14, H * 0.18, 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(30,50,70,0.35)'; ctx.lineWidth = Math.max(1, s * 0.02);
        ctx.beginPath(); for (let k = 0; k < 5; k++) { const y = H * (0.2 + k * 0.1); ctx.moveTo(L * 0.45, y); ctx.lineTo(L * 0.05, y + H * 0.05); } ctx.stroke();
        eye(L * 0.33, H * 0.05, Math.max(1.2, s * 0.05));
        return;
      }
      default:
    }
  }

  function drawEntity(e, t, isPlayer) {
    const x = sx(e.x), y = sy(e.y), s = e.r * cam.z;
    const reach = s * 3;
    if (x < -reach || x > SW + reach || y < -reach || y > SH + reach) return;
    const p = W.player;
    ctx.save();
    ctx.translate(x, y);
    if (isPlayer) {
      const g = ctx.createRadialGradient(0, 0, s * 0.5, 0, 0, s * 2.6);
      g.addColorStop(0, 'rgba(255,217,138,0.28)'); g.addColorStop(1, 'rgba(255,217,138,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s * 2.6, 0, Math.PI * 2); ctx.fill();
      if (p.invuln > 0) ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 14);
    } else if (C.isHunter(e) && e.r > p.r * C.EAT_RATIO) {
      const chasing = e.mode === 'hunt' && e.target === p;
      const a = chasing ? 0.35 + 0.25 * Math.sin(t * 8) : 0.12;
      const g = ctx.createRadialGradient(0, 0, s * 0.6, 0, 0, s * 2.2);
      g.addColorStop(0, `rgba(255,90,90,${a})`); g.addColorStop(1, 'rgba(255,90,90,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s * 2.2, 0, Math.PI * 2); ctx.fill();
    }
    const flip = Math.cos(e.angle) < 0;
    ctx.rotate(e.angle);
    if (flip && e.kind !== 'cell' && e.kind !== 'plankton') ctx.scale(1, -1);
    drawCreature(e, s, t);
    ctx.restore();
  }

  function render(t, dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawWater(t);
    const ents = W.ents.slice().sort((a, b) => a.r - b.r);
    for (const e of ents) if (e.r <= W.player.r) drawEntity(e, t, false);
    drawEntity({ ...W.player, hue: 0.55, kind: C.STAGES[W.player.stage].kind, phase: t * 3 + Math.hypot(W.player.vx, W.player.vy) * 0.01 }, t, true);
    for (const e of ents) if (e.r > W.player.r) drawEntity(e, t, false);

    for (const pt of fx.parts) {
      pt.t += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      ctx.globalAlpha = clamp(1 - pt.t / pt.life, 0, 1);
      ctx.fillStyle = pt.c;
      ctx.beginPath(); ctx.arc(sx(pt.x), sy(pt.y), Math.max(1, pt.s * cam.z), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    fx.parts = fx.parts.filter((p) => p.t < p.life);

    if (fx.danger > 0.02) {
      const g = ctx.createRadialGradient(SW / 2, SH / 2, Math.min(SW, SH) * 0.3, SW / 2, SH / 2, Math.max(SW, SH) * 0.75);
      g.addColorStop(0, 'rgba(120,0,20,0)'); g.addColorStop(1, `rgba(140,10,30,${0.35 * fx.danger})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, SW, SH);
    }
    if (fx.flash > 0) { ctx.fillStyle = `rgba(180,20,40,${fx.flash * 0.4})`; ctx.fillRect(0, 0, SW, SH); }

    // cursor: a soft ring where the creature is heading
    if (pointer.active && pointer.type === 'mouse' && playing) {
      ctx.strokeStyle = 'rgba(255,217,138,0.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 7, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function burst(x, y, r, color) {
    if (reduceMotion) return;
    for (let i = 0; i < 10; i++) {
      const a = rand(0, Math.PI * 2), v = rand(0.5, 2) * r;
      fx.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rand(0.4, 0.9), s: r * rand(0.08, 0.18), c: color });
    }
  }

  // ───────────── HUD ─────────────
  function renderLadder() {
    $('ladder').innerHTML = C.STAGES.slice(1).map(() => '<i><b></b></i>').join('');
  }
  let toastTimer = null;
  function toast(html, secs = 3.5) {
    const el = $('toast');
    el.innerHTML = html; el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, secs * 1000);
  }
  function updateHud() {
    const p = W.player;
    $('stage-name').textContent = stageName(p.stage);
    $('length').textContent = tr('длина {len}', { len: C.lengthText(p.r) });
    const bars = $('ladder').children;
    for (let i = 0; i < bars.length; i++) {
      const st = C.STAGES[i + 1], prev = C.STAGES[i];
      const k = p.r >= st.from ? 1 : p.r <= prev.from ? 0 : (p.r - prev.from) / (st.from - prev.from);
      bars[i].className = k >= 1 ? 'done' : '';
      bars[i].firstChild.style.width = `${(k < 1 ? k : 0) * 100}%`;
    }
    $('best').textContent = best ? tr('рекорд: {len}', { len: C.lengthText(best) }) : '';
    $('btn-dash').style.setProperty('--cd', String(1 - p.dashCD / C.DASH_COOLDOWN));
    $('btn-sound').textContent = tr(Sound.muted ? 'Звук: выкл' : 'Звук: вкл');
  }

  const KILLER = { fish: 'Тебя съела хищная рыба', squid: 'Тебя съел кальмар', shark: 'Тебя съела акула' };
  const STAGE_TEXT = [
    '', 'Появились лапки и усики. Теперь тебя видно в микроскоп.',
    'Плавник, хвост и глаза. Стайки мальков разбегаются от тебя.',
    'Ты рыба. Здесь уже водятся хищники, держи ухо востро.',
    'Щупальца ловят всё, что меньше. Ты быстрый и опасный.',
    'Ты акула. Опасаться почти некого.',
    'Ты стал китом. Океан теперь спокоен, и он твой дом.',
  ];
  function handleEvents() {
    const p = W.player;
    for (const e of W.events) {
      if (e.type === 'eat') { Sound.gulp(e.r / p.r); burst(e.x, e.y, e.r, 'rgba(220,255,230,0.8)'); }
      if (e.type === 'dash') Sound.dash();
      if (e.type === 'stage') {
        Sound.stage();
        if (e.stage === 6) Sound.whale();
        toast(`${stageName(e.stage)}<small>${tr(STAGE_TEXT[e.stage])}</small>`, 5);
        save();
      }
      if (e.type === 'death') {
        Sound.eaten(); fx.flash = 1;
        toast(`${tr(KILLER[e.by] || 'Тебя съели')}<small>${tr('Ты потерял половину размера, но плывёшь дальше.')}</small>`, 4);
        save();
      }
    }
    W.events.length = 0;
    if (p.peak > best) { best = p.peak; store.set('deep.best', String(best)); }
  }

  // ───────────── Input ─────────────
  const pointer = { x: 0, y: 0, active: false, type: 'mouse', down: false };
  const keys = new Set();
  let dashReq = false;

  canvas.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; pointer.type = e.pointerType; });
  canvas.addEventListener('pointerdown', (e) => {
    Sound.init();
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; pointer.type = e.pointerType; pointer.down = true;
    if (e.pointerType === 'mouse') dashReq = true;
    else $('btn-dash').hidden = !playing;
  });
  window.addEventListener('pointerup', (e) => { pointer.down = false; if (e.pointerType !== 'mouse') pointer.active = false; });
  canvas.addEventListener('pointerleave', () => { if (pointer.type === 'mouse') pointer.active = false; });
  $('btn-dash').addEventListener('pointerdown', (e) => { e.stopPropagation(); dashReq = true; });
  window.addEventListener('keydown', (e) => {
    if (!playing) { if (e.code === 'Enter') { e.preventDefault(); start(); } return; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'Space') dashReq = true;
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  function readInput() {
    const p = W.player;
    let kx = 0, ky = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) kx--;
    if (keys.has('KeyD') || keys.has('ArrowRight')) kx++;
    if (keys.has('KeyW') || keys.has('ArrowUp')) ky--;
    if (keys.has('KeyS') || keys.has('ArrowDown')) ky++;
    const dash = dashReq;
    dashReq = false;
    if (kx || ky) return { tx: p.x + kx * p.r * 20, ty: p.y + ky * p.r * 20, dash };
    if (pointer.active) return { tx: (pointer.x - SW / 2) / cam.z + cam.x, ty: (pointer.y - SH / 2) / cam.z + cam.y, dash };
    return { dash };
  }

  // ───────────── Flow ─────────────
  function start() {
    Sound.init();
    if (!W) startWorld(C.START_R);
    playing = true;
    $('overlay').hidden = true;
    $('hud').hidden = false;
    $('btn-dash').hidden = !window.matchMedia('(hover: none)').matches;
    toast(`${stageName(W.player.stage)}<small>${tr('Ешь тех, кто меньше. Красное свечение — опасность.')}</small>`, 4);
  }
  $('btn-start').addEventListener('click', start);
  $('btn-restart').addEventListener('click', () => { startWorld(C.START_R); start(); });
  $('btn-sound').addEventListener('click', () => { Sound.init(); Sound.toggle(); updateHud(); });

  // Language switch lives in the menu (the page reloads, the save is kept).
  $('menu-row').prepend(window.I18n.toggle('chip lang'));
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = tr(meta.content);

  // Continue at the size you reached last time, in a fresh stretch of ocean.
  resize();
  try {
    const saved = JSON.parse(store.get(SAVE_KEY));
    if (saved && saved.r > C.START_R + 0.5) {
      startWorld(saved.r);
      W.player.peak = saved.peak || saved.r;
      $('btn-start').textContent = tr('Продолжить: {stage}, {len}', { stage: stageName(W.player.stage).toLocaleLowerCase(window.I18n.locale), len: C.lengthText(saved.r) });
      $('btn-restart').hidden = false;
    }
  } catch { /* no save */ }
  if (!W) startWorld(C.START_R);
  updateHud();

  let last = performance.now(), hudT = 0, saveT = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = now / 1000;
    if (playing) {
      C.step(W, dt, readInput());
      handleEvents();
      const chased = W.ents.some((e) => e.mode === 'hunt' && e.target === W.player);
      fx.danger += ((chased ? 1 : 0) - fx.danger) * (1 - Math.exp(-dt * 3));
      Sound.setDanger(fx.danger);
      if ((saveT += dt) > 5) { saveT = 0; save(); }
    } else {
      W.player.invuln = 1; // the menu is a safe window onto the sea
      C.step(W, dt, null); W.events.length = 0;
    }
    fx.flash = Math.max(0, fx.flash - dt * 1.5);
    const k = 1 - Math.exp(-dt * 4);
    cam.x += (W.player.x - cam.x) * k; cam.y += (W.player.y - cam.y) * k;
    cam.z += (targetZoom() - cam.z) * (1 - Math.exp(-dt * 1.2));
    render(t, dt);
    if ((hudT += dt) > 0.1) { hudT = 0; updateHud(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.addEventListener('pagehide', save);
})();
