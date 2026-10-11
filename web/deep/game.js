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
      zone(z) { tone(330 / (1 + z * 0.25), { d: 2.2, vol: 0.06, to: 220 / (1 + z * 0.25) }); tone(495 / (1 + z * 0.25), { t: 0.3, d: 2, vol: 0.04 }); },
      discover() { [0, 7, 12].forEach((s, i) => tone(660 * 2 ** (s / 12), { t: i * 0.08, d: 0.9, vol: 0.05, type: 'triangle' })); },
      whale() { tone(220, { d: 3, vol: 0.06, to: 330 }); tone(330, { t: 1.4, d: 3, vol: 0.05, to: 196 }); },
      setDanger(k) { if (ac) danger.gain.setTargetAtTime(muted ? 0 : k * 0.12, ac.currentTime, 0.3); },
    };
  })();

  // ───────────── State ─────────────
  let W = null;
  let playing = false;
  let best = Number(store.get('deep.best') || 0);
  const cam = { x: 0, y: 0, z: 1 };
  const fx = { parts: [], texts: [], flash: 0, danger: 0 };

  function startWorld(r0, depth) {
    W = C.createWorld((Math.random() * 2 ** 32) >>> 0, r0, depth);
    cam.x = W.player.x; cam.y = W.player.y; cam.z = targetZoom();
    fx.parts = [];
    renderLadder();
  }
  function save() { if (W) store.set(SAVE_KEY, JSON.stringify({ r: W.player.r, peak: W.player.peak, depth: W.player.depth })); }

  // ───────────── Atlas: every species met, kept across runs ─────────────
  const ATLAS_KEY = 'deep.atlas';
  const atlas = (() => { try { return JSON.parse(store.get(ATLAS_KEY)) || {}; } catch { return {}; } })();
  let atlasDirty = false;
  function note(sp, field) {
    const rec = atlas[sp] || (atlas[sp] = { seen: 0, eaten: 0 });
    const isNew = !rec.seen;
    rec[field]++;
    if (field === 'eaten' && !rec.seen) rec.seen = 1;
    atlasDirty = true;
    return isNew;
  }
  const spName = (id) => tr(C.SPECIES_BY_ID[id].name);
  const known = () => C.SPECIES.filter((x) => atlas[x.id]?.seen).length;

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

  // Water colour follows depth: green-blue shallows, blue twilight, black deep.
  const WATER = [
    [[22, 92, 104], [8, 44, 66]], [[8, 48, 92], [3, 20, 48]], [[3, 12, 30], [1, 5, 14]], [[1, 4, 12], [1, 2, 6]], [[3, 2, 10], [1, 1, 4]], [[3, 2, 10], [1, 1, 4]],
  ];
  const surfaceY = () => sy(W.player.y - W.player.depth * C.depthScale(W.player));
  const floorY = () => sy(W.player.y + (C.MAX_DEPTH - W.player.depth) * C.depthScale(W.player));
  function drawWater(t) {
    const d = W.player.depth, z = Math.floor(d), k = d - z;
    const top = mix(WATER[z][0], WATER[z + 1][0], k), bot = mix(WATER[z][1], WATER[z + 1][1], k);
    const g = ctx.createLinearGradient(0, 0, 0, SH);
    g.addColorStop(0, `rgb(${top})`); g.addColorStop(1, `rgb(${bot})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, SW, SH);
    // light shafts fade out in the twilight zone
    const shafts = clamp(1.2 - d, 0, 1);
    if (!reduceMotion && shafts > 0) {
      for (let i = 0; i < 5; i++) {
        const x = ((i * 0.23 + t * 0.008 + Math.sin(t * 0.2 + i) * 0.02) % 1.2 - 0.1) * SW;
        const lg = ctx.createLinearGradient(x, 0, x + SW * 0.15, SH);
        lg.addColorStop(0, `rgba(200,240,230,${0.08 * shafts})`); lg.addColorStop(1, 'rgba(200,240,230,0)');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + SW * 0.06, 0); ctx.lineTo(x + SW * 0.25, SH); ctx.lineTo(x + SW * 0.12, SH); ctx.fill();
      }
    }
    // the surface: sky above, rippling line
    const sY = surfaceY();
    if (sY > -20) {
      const sk = ctx.createLinearGradient(0, sY - SH * 0.5, 0, sY);
      sk.addColorStop(0, '#2f6f8c'); sk.addColorStop(1, '#8cc4cf');
      ctx.fillStyle = sk; ctx.fillRect(0, 0, SW, Math.max(0, sY));
      ctx.fillStyle = 'rgba(230,250,250,0.5)';
      ctx.beginPath(); ctx.moveTo(0, sY);
      for (let x = 0; x <= SW; x += 12) ctx.lineTo(x, sY + Math.sin(x * 0.03 + t * 1.5 + cam.x * cam.z * 0.03) * 3);
      ctx.lineTo(SW, sY + 10); ctx.lineTo(0, sY + 10); ctx.fill();
    }
    // marine snow drifting with parallax, thicker in the deep
    const flakes = Math.round(snow.length * (0.5 + clamp(d / 3, 0, 0.5)));
    for (let i = 0; i < flakes; i++) {
      const p = snow[i];
      const x = (((p.x * SW - cam.x * cam.z * 0.15 * p.z) % SW) + SW) % SW;
      const y = (((p.y * SH - cam.y * cam.z * 0.15 * p.z + t * 6 * p.z) % SH) + SH) % SH;
      if (y < sY) continue;
      ctx.fillStyle = `rgba(220,240,235,${0.15 + p.s * 0.25})`;
      ctx.fillRect(x, y, 1 + p.z * 1.5, 1 + p.z * 1.5);
    }
  }

  // The trench floor: silty hills and a hydrothermal vent now and then.
  function drawFloor(t) {
    const fY = floorY();
    if (fY > SH + 20) return;
    const step = 16, ground = (x) => {
      const wx = (x - SW / 2) / cam.z + cam.x;
      return fY - (Math.sin(wx * 0.004) * 0.5 + Math.sin(wx * 0.011 + 1) * 0.3 + Math.sin(wx * 0.031) * 0.2) * 40 - 20;
    };
    ctx.fillStyle = '#17131c';
    ctx.beginPath(); ctx.moveTo(0, SH);
    for (let x = 0; x <= SW + step; x += step) ctx.lineTo(x, ground(x));
    ctx.lineTo(SW, SH); ctx.closePath(); ctx.fill();
    // vents every ~1200 world units
    const span = 1200;
    const w0 = (0 - SW / 2) / cam.z + cam.x, w1 = (SW - SW / 2) / cam.z + cam.x;
    for (let wx = Math.ceil(w0 / span) * span; wx < w1; wx += span) {
      const x = sx(wx), y = ground(x);
      ctx.fillStyle = '#231b20';
      ctx.beginPath(); ctx.moveTo(x - 18, y + 4); ctx.lineTo(x - 6, y - 46); ctx.lineTo(x + 6, y - 46); ctx.lineTo(x + 18, y + 4); ctx.fill();
      for (let k = 0; k < 6; k++) {
        const f = ((t * 0.4 + k / 6) % 1);
        ctx.fillStyle = `rgba(90,80,90,${0.35 * (1 - f)})`;
        ctx.beginPath(); ctx.arc(x + Math.sin(t + k) * 8 * f, y - 50 - f * 120, 8 + f * 26, 0, Math.PI * 2); ctx.fill();
      }
      vents.push({ x, y: y - 46 });
    }
  }
  let vents = [];

  // Deep zones: darkness everywhere except a pool of light around the player, then what glows.
  function drawDark(t, ents) {
    const dark = C.darkAt(W.player.depth);
    const glowVents = vents; vents = [];
    if (dark < 0.03) return;
    const px = sx(W.player.x), py = sy(W.player.y), R = Math.max(70, lightPx());
    const g = ctx.createRadialGradient(px, py, R * 0.35, px, py, R * 1.6);
    g.addColorStop(0, 'rgba(0,2,8,0)'); g.addColorStop(1, `rgba(0,2,8,${dark})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, SW, SH);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(dark * 1.2, 0, 1);
    for (const e of ents) if (C.traits(e).glow) drawLights(e);
    for (const v of glowVents) {
      const vg = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, 60);
      vg.addColorStop(0, 'rgba(255,120,40,0.45)'); vg.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = vg; ctx.beginPath(); ctx.arc(v.x, v.y, 60, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',');

  // ───────────── Creatures (models.js draws them) ─────────────
  const M = window.DeepModels;
  const playerSpecies = () => C.STAGES[W.player.stage].species;
  // Screen-space light radius around the player in the deep zones.
  const lightPx = () => C.lightRadius(W.player) * cam.z;

  function drawEntity(e, t, isPlayer) {
    const x = sx(e.x), y = sy(e.y), s = e.r * cam.z;
    const reach = s * 5;
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
    orient(e);
    M.draw(ctx, e.sp, s, e.phase, 'body');
    ctx.restore();
  }
  function orient(e) {
    const round = e.cls === 'cell' || e.cls === 'plankton';
    ctx.rotate(e.angle);
    if (Math.cos(e.angle) < 0 && !round) ctx.scale(1, -1);
  }
  // What glows, drawn over the darkness with additive light.
  function drawLights(e) {
    const x = sx(e.x), y = sy(e.y), s = e.r * cam.z, reach = s * 6;
    if (x < -reach || x > SW + reach || y < -reach || y > SH + reach) return;
    ctx.save(); ctx.translate(x, y); orient(e);
    M.draw(ctx, e.sp, s, e.phase, 'lights');
    ctx.restore();
  }

  function render(t, dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawWater(t);
    const ents = W.ents.slice().sort((a, b) => a.r - b.r);
    for (const e of ents) if (e.r <= W.player.r) drawEntity(e, t, false);
    const me = { ...W.player, sp: playerSpecies(), cls: C.STAGES[W.player.stage].kind, phase: t * 3 + Math.hypot(W.player.vx, W.player.vy) * 0.01 };
    drawEntity(me, t, true);
    for (const e of ents) if (e.r > W.player.r) drawEntity(e, t, false);
    drawFloor(t);
    drawDark(t, ents);

    for (const pt of fx.parts) {
      pt.t += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      ctx.globalAlpha = clamp(1 - pt.t / pt.life, 0, 1);
      ctx.fillStyle = pt.c;
      ctx.beginPath(); ctx.arc(sx(pt.x), sy(pt.y), Math.max(1, pt.s * cam.z), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    fx.parts = fx.parts.filter((p) => p.t < p.life);
    ctx.font = '600 14px "Golos Text", sans-serif'; ctx.textAlign = 'center';
    for (const f of fx.texts) {
      f.t += dt;
      ctx.globalAlpha = clamp(1.2 - f.t, 0, 1);
      ctx.fillStyle = '#ffd98a'; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3;
      const x = sx(f.x), y = sy(f.y) - 10 - f.t * 28;
      ctx.strokeText(f.text, x, y); ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
    fx.texts = fx.texts.filter((f) => f.t < 1.2);

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
    $('depth').textContent = tr('глубина {m} м · {zone}', { m: depthFmt.format(Math.round(C.metersAt(p.depth))), zone: tr(C.ZONES[p.zone].name) });
    $('gauge-mark').style.top = `${(p.depth / C.MAX_DEPTH) * 100}%`;
    $('btn-atlas').textContent = tr('Атлас {n}/{total}', { n: known(), total: C.SPECIES.length });
    const pr = C.progress(p.r), pct = Math.floor(pr.k * 100);
    $('next-label').textContent = pr.next === null
      ? tr('Кит растёт до 45 м · {pct}%', { pct })
      : tr('Дальше: {stage} · {pct}%', { stage: stageName(pr.next), pct });
    $('next-fill').style.width = `${pr.k * 100}%`;
    $('next').classList.toggle('lost', p.invuln > 0 && W.deaths > 0);
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

  const depthFmt = new Intl.NumberFormat(window.I18n.locale);
  const pctFmt = new Intl.NumberFormat(window.I18n.locale, { maximumFractionDigits: 1 });
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
      if (e.type === 'eat') {
        Sound.gulp(e.r / p.r); burst(e.x, e.y, e.r, 'rgba(220,255,230,0.8)');
        // How far this bite moved you towards the next stage.
        if (e.pct >= 0.05) fx.texts.push({ x: e.x, y: e.y, t: 0, text: `+${pctFmt.format(e.pct)}%` });
        if (note(e.sp, 'eaten')) newSpecies(e.sp);
      }
      if (e.type === 'meet' && note(e.sp, 'seen')) newSpecies(e.sp);
      if (e.type === 'zone') {
        const z = C.ZONES[e.zone];
        if (e.down) Sound.zone(e.zone);
        toast(`${tr(z.name)}<small>${e.first ? tr(z.text) : tr('глубина {m} м', { m: depthFmt.format(z.top) })}</small>`, e.first ? 5 : 2.5);
      }
      if (e.type === 'dash') Sound.dash();
      if (e.type === 'stage') {
        Sound.stage();
        if (e.stage === 6) Sound.whale();
        toast(`${stageName(e.stage)}<small>${tr(STAGE_TEXT[e.stage])}</small>`, 5);
        save();
      }
      if (e.type === 'death') {
        Sound.eaten(); fx.flash = 1;
        toast(`${tr('Тебя поймали: {name}', { name: spName(e.by) })}<small>${tr('Ты потерял половину размера, но плывёшь дальше.')}</small>`, 4);
        save();
      }
    }
    W.events.length = 0;
    if (atlasDirty) { atlasDirty = false; store.set(ATLAS_KEY, JSON.stringify(atlas)); }
    if (p.peak > best) { best = p.peak; store.set('deep.best', String(best)); }
  }

  function newSpecies(id) {
    Sound.discover();
    toast(`${tr('Новый вид: {name}', { name: spName(id) })}<small>${tr('Запись в атласе: {n} из {total}', { n: known(), total: C.SPECIES.length })}</small>`, 3.5);
  }

  // Thumbnails reuse the game's models; unknown species are dark silhouettes.
  function thumb(sp, seen) {
    const cv = document.createElement('canvas'), w = 200, h = 120, dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = w * dpr; cv.height = h * dpr; cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    const [back, front, half] = M.box(sp.id);
    const s = Math.min((w - 16) / (back + front), (h - 14) / (half * 2));
    c.translate(8 + back * s, h / 2);
    M.draw(c, sp.id, s, 1.3, 'body');
    if (C.traits({ sp: sp.id }).glow && seen) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.6; M.draw(c, sp.id, s, 1.3, 'lights'); }
    if (!seen) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = '#0d2333'; c.fillRect(0, 0, cv.width, cv.height); }
    return cv;
  }
  let atlasWasPlaying = false;
  function openAtlas() {
    atlasWasPlaying = playing;
    playing = false;
    const list = $('atlas-list');
    list.innerHTML = '';
    for (const sp of C.SPECIES) {
      const rec = atlas[sp.id], seen = !!rec?.seen;
      const li = document.createElement('li');
      li.className = seen ? 'seen' : '';
      li.append(thumb(sp, seen));
      const zones = sp.zones.map((z) => tr(C.ZONES[z].name)).join(', ');
      const body = document.createElement('div');
      body.innerHTML = seen
        ? `<b>${spName(sp.id)}</b><span class="zone">${zones}</span><p>${tr(sp.fact)}</p><span class="count">${tr('встречено: {seen} · съедено: {eaten}', { seen: rec.seen, eaten: rec.eaten })}</span>`
        : `<b>???</b><span class="zone">${zones}</span><p>${tr('Ещё не встречался.')}</p>`;
      li.append(body);
      list.append(li);
    }
    $('atlas-count').textContent = tr('{n} из {total}', { n: known(), total: C.SPECIES.length });
    $('atlas').hidden = false;
    $('btn-atlas-close').focus();
  }
  function closeAtlas() {
    $('atlas').hidden = true;
    if (atlasWasPlaying) playing = true;
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
    if (!$('atlas').hidden) return;
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
  $('btn-atlas').addEventListener('click', () => openAtlas());
  $('btn-menu-atlas').addEventListener('click', () => openAtlas());
  $('btn-atlas-close').addEventListener('click', closeAtlas);
  window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !$('atlas').hidden) closeAtlas(); });
  $('btn-sound').addEventListener('click', () => { Sound.init(); Sound.toggle(); updateHud(); });

  // Language switch lives in the menu (the page reloads, the save is kept).
  $('menu-row').prepend(window.I18n.toggle('chip lang'));
  $('menu-row').prepend(window.GameNav.home('chip lang'));
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = tr(meta.content);

  // Continue at the size you reached last time, in a fresh stretch of ocean.
  resize();
  try {
    const saved = JSON.parse(store.get(SAVE_KEY));
    if (saved && saved.r > C.START_R + 0.5) {
      startWorld(saved.r, Number.isFinite(saved.depth) ? saved.depth : undefined);
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
      for (const e of W.ents) e.met = false; // the atlas only counts what you meet while swimming
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
