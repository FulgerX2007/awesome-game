'use strict';
// Последняя крепость — client: screens, input, effects and the Canvas 2D art of the battlefield. The rules live in
// core.js (window.CastleCore), pure helpers in view.js (window.CastleView).
(() => {
  const C = window.CastleCore;
  const V = window.CastleView;
  const { t } = window.I18n;
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const NAME_KEY = 'castle.name';
  const BOARD_URL = '/api/boards/castle/scores';

  // Storage access itself may throw (blocked site data); core's save functions tolerate a null storage.
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }
  const store = {
    get(k) { try { return storage ? storage.getItem(k) : null; } catch { return null; } },
    set(k, v) { try { if (storage) storage.setItem(k, v); } catch { /* blocked or full */ } },
  };

  // Sound comes from audio.js (index.html loads it first); its play() is silent while the sound is off.
  // Names: draw, release, hit, shield, death, wall, horn, ward, upgrade, coin, win, lose.
  const Sound = window.CastleAudio;
  const sfx = (name, opts) => Sound.play(name, opts);

  const UPGRADE_INFO = {
    power: { name: 'Острые наконечники', desc: '+20% урона', icon: '➶' },
    reload: { name: 'Тугая тетива', desc: 'Перезарядка быстрее на 12%', icon: '⟳' },
    velocity: { name: 'Длинный лук', desc: 'Стрелы летят быстрее и дальше', icon: '➹' },
    pierce: { name: 'Бронебойные стрелы', desc: 'Стрела пробивает ещё одного врага', icon: '⇶' },
    multi: { name: 'Двойной выстрел', desc: '+1 стрела за выстрел', icon: '⋔' },
    fire: { name: 'Огненные стрелы', desc: 'Поджигают врага на 3 секунды', icon: '✹' },
    ward: { name: 'Оберег', desc: '+1 заряд против летунов', icon: '◈' },
  };

  const canvas = $('field');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  let save = C.loadSave(storage);
  let run = null;
  let screen = 'menu';      // menu | wave | between | result
  let paused = false;
  let pickedId = null;      // the card picked in this break (for the highlight)
  let pendingMode = null;   // the mode a confirm screen would start
  let aiming = null;        // { id, x0, y0 } pointer pull in progress
  let keys = {};            // held keys for keyboard aiming
  let fx = { particles: [], floats: [], sticks: [], flashes: {}, shake: 0, bow: 0 };
  let demo = null;          // a quiet field behind the menu
  let time = 0;
  let last = 0;

  // ───────────── Canvas size ─────────────
  let f = V.fit({ w: 640, h: 360 });
  function resize() {
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const next = V.fit({ w: stage.clientWidth - padX, h: stage.clientHeight - padY, dpr: window.devicePixelRatio || 1 });
    if (next.w === canvas.width && next.h === canvas.height) { f = next; return; }
    f = next;
    canvas.width = f.w;
    canvas.height = f.h;
    canvas.style.width = f.cssW + 'px';
    canvas.style.height = f.cssH + 'px';
    bg = null;
  }

  // ───────────── Runs and saving ─────────────
  function persist() { C.storeSave(storage, save); }

  // The wave starts: the run as it is now is the save point, so a reload during the wave restarts this wave.
  function beginWave() {
    save.current = C.snapshot(run);
    persist();
    C.startWave(run);
    paused = false;
    screen = 'wave';
    show(null);
    $('hud').hidden = false;
    const portrait = window.innerHeight > window.innerWidth * 1.2;
    showTip(run.wave === 1 ? (portrait ? 'Поверни телефон — так поле больше' : 'Потяни назад и держи, чтобы стрелять') : null);
    renderHUD();
    canvas.focus({ preventScroll: true });
  }

  function newRunOf(mode) {
    run = C.newRun(mode, (Date.now() % 1e9) >>> 0);
    clearFx();
    beginWave();
  }

  function resume() {
    run = C.restore(save.current);
    if (!run) { save.current = null; persist(); showMenu(); return; }
    clearFx();
    if (run.status === 'ready') beginWave();
    else showBetween();
  }

  function startMode(mode) {
    Sound.unlock();
    if (save.current && save.current.mode === mode) { resume(); return; }
    if (save.current) { pendingMode = mode; show('confirm'); $('btn-confirm-no').focus(); return; }
    newRunOf(mode);
  }

  // A wave ended (cleared, won or lost): records first, then the screen.
  function afterWave() {
    C.recordRun(save, run);
    if (run.status === 'between') {
      save.current = C.snapshot(run);
      persist();
      sfx('coin');
      showBetween();
    } else {
      save.current = null;
      persist();
      sfx(run.status === 'won' ? 'win' : 'lose');
      showResult();
    }
  }

  // ───────────── Effects from core events ─────────────
  function clearFx() { fx = { particles: [], floats: [], sticks: [], flashes: {}, shake: 0, bow: 0 }; }

  function puff(x, y, color, n, speed) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU, sp = speed * (0.3 + Math.random());
      fx.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + speed * 0.4, life: 0.5 + Math.random() * 0.4, t: 0, color });
    }
  }

  function handle(events, quiet) {
    for (const e of events) {
      if (e.type === 'fire') { fx.bow = 0.12; if (!quiet) sfx('release'); }
      else if (e.type === 'hit') {
        fx.flashes[e.id] = 0.1;
        if (e.cause === 'arrow' && !quiet) sfx('hit');
      } else if (e.type === 'shieldHit') { puff(e.x, e.y, '#ffe9a8', 6, 3); if (!quiet) sfx('shield'); }
      else if (e.type === 'kill') {
        puff(e.x, e.y + 0.8, '#d8cbb3', 12, 3);
        if (!quiet) {
          fx.floats.push({ x: e.x, y: e.y + 2.2, text: `+${e.gold}`, t: 0, color: '#ffd34d' });
          sfx('death');
        }
      } else if (e.type === 'ground') fx.sticks.push({ x: e.x, a: Math.atan2(e.vy, e.vx), t: 0 });
      else if (e.type === 'ward') { puff(e.x, e.y, '#8fd0ff', 16, 4); if (!quiet) sfx('ward'); }
      else if (e.type === 'wallHit') {
        if (!quiet) { fx.shake = Math.min(0.4, fx.shake + 0.15); sfx('wall'); }
        puff(C.WALL_X + 0.2, 1 + Math.random() * 3, '#9a8a74', 4, 2);
      } else if (e.type === 'summon' || e.type === 'waveStart') { if (!quiet) sfx('horn'); }
    }
  }

  // ───────────── Simulation ─────────────
  function playerAim() {
    if (!run || screen !== 'wave') return;
    let { angle, power } = run.aim;
    const da = 1.2 * (1 / 60), dp = 0.6 * (1 / 60);
    if (keys.ArrowUp) angle += da;
    if (keys.ArrowDown) angle -= da;
    if (keys.ArrowRight) power += dp;
    if (keys.ArrowLeft) power -= dp;
    if (keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight) C.aim(run, angle, power);
    C.setFiring(run, !!aiming || !!keys.Space);
  }

  function update(dt) {
    time += dt;
    for (const k of Object.keys(fx.flashes)) { fx.flashes[k] -= dt; if (fx.flashes[k] <= 0) delete fx.flashes[k]; }
    fx.shake = Math.max(0, fx.shake - dt);
    fx.bow = Math.max(0, fx.bow - dt);
    for (const p of fx.particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 9 * dt; }
    fx.particles = fx.particles.filter((p) => p.t < p.life);
    for (const fl of fx.floats) { fl.t += dt; fl.y += dt * 1.2; }
    fx.floats = fx.floats.filter((fl) => fl.t < 1);
    for (const s of fx.sticks) s.t += dt;
    fx.sticks = fx.sticks.filter((s) => s.t < 3);

    if (screen === 'wave' && run && !paused) {
      playerAim();
      C.step(run, dt);
      handle(C.drain(run), false);
      renderHUD();
      if (run.status !== 'wave') afterWave();
    } else if (screen === 'menu' && demo) {
      demoStep(dt);
    }
  }

  // Behind the menu: a quiet autopilot holds the wall against an endless trickle.
  function demoStep(dt) {
    if (demo.status !== 'wave') {
      demo = C.newRun('endless', 7);
      C.startWave(demo);
    }
    const e = demo.enemies.length ? demo.enemies.reduce((a, b) => (b.x < a.x ? b : a)) : null;
    if (e) {
      const v = C.stats(demo).vmax;
      const dx = e.x - C.ARCHER.x, dy = e.y + e.h / 2 - C.ARCHER.y;
      const disc = v ** 4 - C.G * (C.G * dx * dx + 2 * dy * v * v);
      if (disc >= 0) C.aim(demo, Math.atan2(v * v - Math.sqrt(disc), C.G * dx) + (Math.sin(time * 3) * 0.02), 1);
    }
    C.setFiring(demo, !!e);
    C.step(demo, dt);
    handle(C.drain(demo), true);
    if (demo.wallHp < 40) demo.wallHp = demo.wallMax;
  }

  // ───────────── Drawing ─────────────
  let bg = null; // cached sky, hills and ground for the current size and wave tint
  let bgKey = '';

  function waveTint() {
    const w = run ? run.wave : 1;
    return (((w - 1) % 10) + 10) % 10 / 9; // 0 day … 1 dusk, every ten waves
  }

  function mix(a, b, k) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (s) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  function drawBackground() {
    const tint = Math.round(waveTint() * 9) / 9;
    const key = `${f.w}x${f.h}:${tint}`;
    if (!bg || bgKey !== key) {
      bgKey = key;
      bg = document.createElement('canvas');
      bg.width = f.w;
      bg.height = f.h;
      const g = bg.getContext('2d');
      g.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
      const sky = g.createLinearGradient(0, 0, 0, f.gy);
      sky.addColorStop(0, mix('#5aa6e8', '#2b2350', tint));
      sky.addColorStop(1, mix('#cfe8f5', '#f09a62', tint));
      g.fillStyle = sky;
      g.fillRect(0, 0, f.cssW, f.gy);
      // the sun sinking with the waves
      const sun = V.toScreen(f, 44, 14 - tint * 9);
      const sg = g.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, f.scale * 6);
      sg.addColorStop(0, mix('#fff8d0', '#ffd08a', tint));
      sg.addColorStop(0.25, mix('#fff2b0', '#ff9a50', tint));
      sg.addColorStop(1, 'rgba(255,220,150,0)');
      g.fillStyle = sg;
      g.fillRect(0, 0, f.cssW, f.gy);
      // two ranges of hills
      for (const [h, col, seed] of [[5.5, mix('#7aa8a0', '#5a4a6e', tint), 1.3], [3, mix('#5f8f52', '#4a3f45', tint), 2.1]]) {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(0, f.gy);
        for (let x = V.X0; x <= V.X1 + 1; x += 0.5) {
          const y = h + Math.sin(x * 0.11 * seed) * 1.4 + Math.sin(x * 0.37 + seed) * 0.5;
          const p = V.toScreen(f, x, y);
          g.lineTo(p.x, p.y);
        }
        g.lineTo(f.cssW, f.gy);
        g.closePath();
        g.fill();
      }
      // ground: grass on dirt
      const ground = g.createLinearGradient(0, f.gy, 0, f.cssH);
      ground.addColorStop(0, '#6a4a2c');
      ground.addColorStop(1, '#3a2716');
      g.fillStyle = ground;
      g.fillRect(0, f.gy, f.cssW, f.cssH - f.gy);
      g.fillStyle = mix('#5aa83a', '#3d5a30', tint);
      g.fillRect(0, f.gy - f.scale * 0.25, f.cssW, f.scale * 0.35);
      g.fillStyle = 'rgba(0,0,0,.18)';
      for (let x = V.X0; x < V.X1; x += 1.7) {
        const p = V.toScreen(f, x + Math.sin(x * 3.1) * 0.4, -0.5 - Math.abs(Math.sin(x)) * 0.8);
        g.beginPath();
        g.ellipse(p.x, p.y, f.scale * 0.25, f.scale * 0.12, 0, 0, TAU);
        g.fill();
      }
    }
    ctx.drawImage(bg, 0, 0, f.cssW, f.cssH);
  }

  function drawWall(r) {
    const s = f.scale;
    const a = V.toScreen(f, 0, C.WALL_TOP), b = V.toScreen(f, C.WALL_X, 0);
    const w = b.x - a.x, h = b.y - a.y;
    // stone blocks
    ctx.fillStyle = '#8c8170';
    ctx.fillRect(a.x, a.y, w, h);
    ctx.strokeStyle = 'rgba(40,30,20,.45)';
    ctx.lineWidth = Math.max(1, s * 0.06);
    const rowH = s * 0.8;
    for (let y = a.y, row = 0; y < b.y; y += rowH, row++) {
      ctx.beginPath();
      ctx.moveTo(a.x, y);
      ctx.lineTo(b.x, y);
      ctx.stroke();
      for (let x = a.x + (row % 2 ? s * 0.5 : 0); x < b.x; x += s) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, Math.min(b.y, y + rowH));
        ctx.stroke();
      }
    }
    // battlements
    ctx.fillStyle = '#9a8e7b';
    for (let k = 0; k < 3; k++) ctx.fillRect(a.x + k * (w / 3) + w * 0.04, a.y - s * 0.7, w / 3 - w * 0.08, s * 0.7);
    // shade on the front face
    const sh = ctx.createLinearGradient(a.x, 0, b.x, 0);
    sh.addColorStop(0, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,.25)');
    ctx.fillStyle = sh;
    ctx.fillRect(a.x, a.y, w, h);
    // cracks grow as the wall weakens
    const hurt = r ? 1 - r.wallHp / r.wallMax : 0;
    ctx.strokeStyle = 'rgba(20,12,6,.8)';
    ctx.lineWidth = Math.max(1, s * 0.08);
    const cracks = Math.floor(hurt * 6);
    for (let k = 0; k < cracks; k++) {
      const x0 = a.x + w * (0.2 + ((k * 0.37) % 0.7)), y0 = a.y + h * (0.15 + ((k * 0.53) % 0.75));
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + s * 0.4, y0 + s * 0.5);
      ctx.lineTo(x0 + s * 0.1, y0 + s * 1.0);
      ctx.lineTo(x0 + s * 0.5, y0 + s * 1.5);
      ctx.stroke();
    }
    // a banner
    const pole = V.toScreen(f, 0.3, C.WALL_TOP + 3.2);
    ctx.fillStyle = '#5a4630';
    ctx.fillRect(pole.x, pole.y, s * 0.12, a.y - pole.y);
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    const wave = Math.sin(time * 4) * s * 0.15;
    ctx.moveTo(pole.x + s * 0.12, pole.y);
    ctx.quadraticCurveTo(pole.x + s * 0.9, pole.y + s * 0.3 + wave, pole.x + s * 1.6, pole.y + s * 0.2);
    ctx.lineTo(pole.x + s * 1.6, pole.y + s * 0.9);
    ctx.quadraticCurveTo(pole.x + s * 0.9, pole.y + s * 1.1 + wave, pole.x + s * 0.12, pole.y + s * 1.0);
    ctx.fill();
  }

  function drawArcher(r) {
    const s = f.scale;
    const p = V.toScreen(f, C.ARCHER.x, C.ARCHER.y);
    const angle = r ? r.aim.angle : 0.5;
    const pull = r && r.firing ? 0.35 + (fx.bow > 0 ? 0 : 0.3) : 0.15;
    // body
    ctx.fillStyle = '#3b5a8a';
    ctx.fillRect(p.x - s * 0.35, p.y - s * 0.1, s * 0.7, s * 1.3);
    ctx.fillStyle = '#e8c39e';
    ctx.beginPath();
    ctx.arc(p.x, p.y - s * 0.45, s * 0.35, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2f7d3a';
    ctx.beginPath();
    ctx.moveTo(p.x - s * 0.4, p.y - s * 0.55);
    ctx.lineTo(p.x + s * 0.4, p.y - s * 0.55);
    ctx.lineTo(p.x + s * 0.1, p.y - s * 1.15);
    ctx.closePath();
    ctx.fill();
    // bow in the aim direction (screen angle is minus the world angle)
    ctx.save();
    ctx.translate(p.x + s * 0.2, p.y + s * 0.2);
    ctx.rotate(-angle);
    ctx.strokeStyle = '#7a4b22';
    ctx.lineWidth = Math.max(2, s * 0.14);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.9, -1.1, 1.1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 1;
    const ex = Math.cos(1.1) * s * 0.9, ey = Math.sin(1.1) * s * 0.9;
    ctx.beginPath();
    ctx.moveTo(ex, -ey);
    ctx.lineTo(-pull * s, 0);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    if (r && r.firing && fx.bow <= 0) { // the nocked arrow
      ctx.strokeStyle = '#d8c39a';
      ctx.lineWidth = Math.max(1.5, s * 0.07);
      ctx.beginPath();
      ctx.moveTo(-pull * s, 0);
      ctx.lineTo(s * 1.1, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPreview(r) {
    if (!r || screen !== 'wave' || !(aiming || keys.Space || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight)) return;
    const pts = V.trajectory(r, r.aim.angle, r.aim.power, 0.06, 40);
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    pts.forEach((q, k) => {
      const p = V.toScreen(f, q.x, q.y);
      ctx.globalAlpha = Math.max(0.15, 1 - k / pts.length);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.5, f.scale * 0.1), 0, TAU);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawArrow(x, y, a, len) {
    const s = f.scale;
    const p = V.toScreen(f, x, y);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-a);
    ctx.strokeStyle = '#3a2a18';
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    ctx.beginPath();
    ctx.moveTo(-len * s, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.fillStyle = '#c9ccd2';
    ctx.beginPath();
    ctx.moveTo(s * 0.18, 0);
    ctx.lineTo(-s * 0.05, -s * 0.09);
    ctx.lineTo(-s * 0.05, s * 0.09);
    ctx.fill();
    ctx.fillStyle = '#e04a3a';
    ctx.fillRect(-len * s, -s * 0.08, s * 0.25, s * 0.16);
    ctx.restore();
  }

  function drawEnemy(e) {
    const s = f.scale;
    const base = V.toScreen(f, e.x, e.y);
    const w = e.w * s, h = e.h * s;
    const walk = e.atWall ? Math.sin(time * 10 + e.id) * 0.15 : Math.sin(time * 8 + e.id) * 0.35;
    const flash = fx.flashes[e.id] > 0;
    ctx.save();
    ctx.translate(base.x, base.y);
    if (e.kind === 'flyer') {
      const flap = Math.sin(time * 16 + e.id) * 0.6;
      ctx.fillStyle = flash ? '#fff' : '#3d2b4a';
      ctx.beginPath();
      ctx.ellipse(0, -h * 0.5, w * 0.28, h * 0.5, 0, 0, TAU);
      ctx.fill();
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.5);
        ctx.quadraticCurveTo(side * w * 0.6, -h * (1.4 + flap), side * w * 0.9, -h * (0.3 + flap * 0.5));
        ctx.quadraticCurveTo(side * w * 0.5, -h * 0.4, 0, -h * 0.3);
        ctx.fill();
      }
      ctx.fillStyle = '#ffde59';
      ctx.fillRect(-w * 0.12, -h * 0.7, w * 0.07, w * 0.07);
      ctx.fillRect(w * 0.04, -h * 0.7, w * 0.07, w * 0.07);
    } else if (e.kind === 'ram') {
      ctx.fillStyle = flash ? '#fff' : '#7a5230';
      ctx.fillRect(-w / 2, -h * 0.85, w, h * 0.55);
      ctx.fillStyle = flash ? '#fff' : '#5a3a1e';
      ctx.fillRect(-w / 2 - s * 0.6, -h * 0.75, w * 0.6, h * 0.3); // the log's head pointing at the wall
      ctx.fillStyle = '#4a4a4a';
      ctx.fillRect(-w / 2 - s * 0.7, -h * 0.8, s * 0.25, h * 0.4);
      ctx.fillStyle = '#2b1d10';
      for (const wx of [-w * 0.3, w * 0.3]) {
        ctx.beginPath();
        ctx.arc(wx, -s * 0.3, s * 0.32, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#8a6a3a';
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h * 0.85);
      ctx.lineTo(0, -h * 1.1);
      ctx.lineTo(w / 2, -h * 0.85);
      ctx.fill();
    } else {
      const big = e.kind === 'boss';
      const skin = big ? '#6b8f3a' : e.kind === 'shield' ? '#8a6a4a' : '#7a9a4a';
      // legs
      ctx.strokeStyle = flash ? '#fff' : '#3a2a1a';
      ctx.lineWidth = Math.max(2, w * 0.18);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * w * 0.15, -h * 0.4);
        ctx.lineTo(side * w * 0.15 + Math.sin(walk * side) * w * 0.4, 0);
        ctx.stroke();
      }
      // body and head
      ctx.fillStyle = flash ? '#fff' : big ? '#5a3a6a' : '#6a4a2a';
      ctx.fillRect(-w * 0.32, -h * 0.75, w * 0.64, h * 0.4);
      ctx.fillStyle = flash ? '#fff' : skin;
      ctx.beginPath();
      ctx.arc(0, -h * 0.85, w * 0.28, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-w * 0.18, -h * 0.9, w * 0.08, w * 0.08);
      if (big) { // a crown and a club
        ctx.fillStyle = '#ffd34d';
        ctx.beginPath();
        ctx.moveTo(-w * 0.25, -h * 1.0);
        for (let k = 0; k <= 4; k++) ctx.lineTo(-w * 0.25 + k * w * 0.125, -h * (k % 2 ? 1.0 : 1.12));
        ctx.lineTo(w * 0.25, -h * 1.0);
        ctx.fill();
        ctx.strokeStyle = '#5a3a1e';
        ctx.lineWidth = Math.max(3, w * 0.12);
        ctx.beginPath();
        ctx.moveTo(-w * 0.35, -h * 0.6);
        ctx.lineTo(-w * 0.8, -h * (0.95 + walk * 0.2));
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#8a8a8a'; // a short blade
        ctx.lineWidth = Math.max(1.5, w * 0.08);
        ctx.beginPath();
        ctx.moveTo(-w * 0.35, -h * 0.55);
        ctx.lineTo(-w * 0.7, -h * (0.7 + walk * 0.2));
        ctx.stroke();
      }
      if (e.kind === 'shield') { // a big round shield in front
        ctx.fillStyle = flash ? '#fff' : '#9a7a4a';
        ctx.strokeStyle = '#5a4020';
        ctx.lineWidth = Math.max(1.5, w * 0.08);
        ctx.beginPath();
        ctx.ellipse(-w * 0.45, -h * 0.55, w * 0.22, h * 0.36, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#c8c8c8';
        ctx.beginPath();
        ctx.arc(-w * 0.45, -h * 0.55, w * 0.07, 0, TAU);
        ctx.fill();
      }
    }
    // burning
    if (e.burn > 0) {
      for (let k = 0; k < 3; k++) {
        const fx0 = Math.sin(time * 9 + k * 2 + e.id) * w * 0.3;
        ctx.fillStyle = k % 2 ? 'rgba(255,170,40,.85)' : 'rgba(255,90,30,.8)';
        ctx.beginPath();
        ctx.ellipse(fx0, -h * (0.7 + 0.2 * Math.sin(time * 12 + k)), w * 0.12, h * 0.18, 0, 0, TAU);
        ctx.fill();
      }
    }
    // health bar once hurt
    if (e.hp < e.maxHp) {
      const bw = Math.max(w, s * 1.2);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(-bw / 2, -h - s * 0.55, bw, s * 0.2);
      ctx.fillStyle = e.kind === 'boss' ? '#ff5a3c' : '#7ad85a';
      ctx.fillRect(-bw / 2, -h - s * 0.55, bw * Math.max(0, e.hp / e.maxHp), s * 0.2);
    }
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
    const r = screen === 'menu' ? demo : run;
    const sh = fx.shake > 0 ? fx.shake * f.scale * 0.6 : 0;
    ctx.save();
    if (sh) ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    drawBackground();
    for (const st of fx.sticks) {
      ctx.globalAlpha = Math.min(1, 3 - st.t);
      drawArrow(st.x, 0.05, st.a, 0.9);
    }
    ctx.globalAlpha = 1;
    if (r) for (const e of r.enemies) drawEnemy(e);
    drawWall(r);
    drawArcher(r);
    if (r) for (const a of r.arrows) drawArrow(a.x, a.y, Math.atan2(a.vy, a.vx), 1.1);
    drawPreview(r);
    for (const p of fx.particles) {
      const q = V.toScreen(f, p.x, p.y);
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, f.scale * 0.13, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = `700 ${Math.max(11, f.scale * 0.8)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (const fl of fx.floats) {
      const q = V.toScreen(f, fl.x, fl.y);
      ctx.globalAlpha = 1 - fl.t;
      ctx.fillStyle = '#000';
      ctx.fillText(fl.text, q.x + 1, q.y + 1);
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.text, q.x, q.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ───────────── HUD and screens ─────────────
  function showTip(text) {
    $('tip').hidden = !text;
    if (text) $('tip').textContent = t(text);
  }

  function renderHUD() {
    if (!run) return;
    $('hud-wave').textContent = run.mode === 'campaign'
      ? t('Волна {n}/{total}', { n: run.wave, total: C.CAMPAIGN_WAVES })
      : t('Волна {n}', { n: run.wave });
    const share = run.wallHp / run.wallMax;
    $('wall-fill').style.width = `${Math.max(0, share * 100)}%`;
    $('wall-bar').classList.toggle('mid', share < 0.6 && share >= 0.3);
    $('wall-bar').classList.toggle('low', share < 0.3);
    $('wall-text').textContent = `${Math.ceil(run.wallHp)}/${Math.round(run.wallMax)}`;
    $('hud-gold').textContent = V.fmt(run.gold);
    $('hud-ward').textContent = String(run.ward);
    $('btn-pause').textContent = paused ? t('Дальше') : t('Пауза');
  }

  const SCREENS = ['menu', 'confirm', 'between', 'result', 'pause'];
  function show(name) {
    for (const id of SCREENS) $(id).hidden = id !== name;
    stage.classList.toggle('dim', !!name && name !== 'pause');
  }

  function showMenu() {
    if (screen === 'wave' && run && run.status === 'wave') {
      // leaving a wave: the save point is its start, nothing else to store
    }
    screen = 'menu';
    paused = false;
    aiming = null;
    run = null;
    clearFx();
    demo = null;
    $('hud').hidden = true;
    showTip(null);
    const cur = save.current;
    $('btn-campaign').textContent = cur && cur.mode === 'campaign'
      ? t('Кампания: волна {n}', { n: cur.wave + 1 }) : t('Кампания');
    $('btn-endless').textContent = cur && cur.mode === 'endless'
      ? t('Бесконечный: волна {n}', { n: cur.wave + 1 }) : t('Бесконечный режим');
    const lines = [];
    if (save.campaignDone) lines.push(t('Кампания пройдена'));
    else if (save.campaignBest) lines.push(t('Кампания: отбито волн — {n} из {total}', { n: save.campaignBest, total: C.CAMPAIGN_WAVES }));
    if (save.endlessBest) lines.push(t('Рекорд бесконечного режима: {n}', { n: V.fmt(save.endlessBest) }));
    $('records').textContent = lines.join('\n');
    $('records').hidden = !lines.length;
    renderSound();
    show('menu');
    $('btn-campaign').focus({ preventScroll: true });
  }

  function showBetween() {
    screen = 'between';
    paused = false;
    aiming = null;
    $('hud').hidden = false;
    showTip(null);
    renderHUD();
    $('between-title').textContent = t('Волна {n} отбита!', { n: run.wave });
    $('between-lead').textContent = t('Золото: {gold}. Стена: {hp} из {max}.',
      { gold: V.fmt(run.gold), hp: Math.ceil(run.wallHp), max: Math.round(run.wallMax) });
    const cards = $('cards');
    cards.innerHTML = '';
    $('cards-title').hidden = !run.offer.length;
    for (const id of run.offer) {
      const info = UPGRADE_INFO[id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card' + (pickedId === id && run.picked ? ' picked' : '');
      b.disabled = run.picked;
      const lvl = run.up[id] ? `<span class="lvl">${t('Уровень {n}', { n: run.up[id] })}</span>` : '';
      b.innerHTML = `<span class="ico-up" aria-hidden="true">${info.icon}</span><b>${t(info.name)}</b><small>${t(info.desc)}</small>${lvl}`;
      b.addEventListener('click', () => {
        if (!C.chooseUpgrade(run, id)) return;
        pickedId = id;
        sfx('upgrade');
        save.current = C.snapshot(run);
        persist();
        showBetween();
        $('btn-fight').focus({ preventScroll: true });
      });
      cards.append(b);
    }
    const p = C.prices(run);
    $('btn-repair').textContent = t('Починить +25% — {p} зол.', { p: p.repair });
    $('btn-repair').disabled = run.wallHp >= run.wallMax || run.gold < p.repair;
    $('btn-fortify').textContent = t('Укрепить +20% — {p} зол.', { p: p.fortify });
    $('btn-fortify').disabled = run.gold < p.fortify;
    show('between');
    if (!run.picked && cards.firstChild) cards.firstChild.focus({ preventScroll: true });
  }

  function shop(item) {
    if (C.buy(run, item) !== 'ok') return;
    sfx('coin');
    save.current = C.snapshot(run);
    persist();
    showBetween();
  }

  function showResult() {
    screen = 'result';
    aiming = null;
    showTip(null);
    renderHUD();
    const title = $('res-title');
    const won = run.status === 'won';
    title.textContent = won ? t('Кампания пройдена!') : t('Стена пала');
    title.classList.toggle('won', won);
    title.classList.toggle('lost', !won);
    if (run.mode === 'campaign') {
      $('res-main').textContent = won ? t('Все {n} волн отбиты', { n: C.CAMPAIGN_WAVES }) : t('Волна {n}', { n: run.wave });
      $('res-note').textContent = won ? t('Попробуй бесконечный режим') : t('Лучшее: отбито волн — {n}', { n: save.campaignBest });
      $('submit').hidden = true;
    } else {
      const sc = C.score(run);
      $('res-main').textContent = t('Счёт: {n}', { n: V.fmt(sc) });
      $('res-note').textContent = t('Волна {n}, врагов повержено: {k}. Рекорд: {best}',
        { n: run.wave, k: run.kills, best: V.fmt(save.endlessBest) });
      $('submit').hidden = sc <= 0;
      $('btn-submit').disabled = false;
      $('submit-status').textContent = '';
      $('submit-status').classList.remove('ok');
      $('name').value = store.get(NAME_KEY) || '';
    }
    show('result');
    $('btn-again').focus({ preventScroll: true });
  }

  function togglePause() {
    if (screen !== 'wave') return;
    paused = !paused;
    aiming = null;
    if (run) C.setFiring(run, false);
    show(paused ? 'pause' : null);
    renderHUD();
  }

  function renderSound() {
    const on = !!Sound.enabled;
    const label = on ? t('Звук: вкл') : t('Звук: выкл');
    $('btn-sound-menu').textContent = label;
    $('btn-sound-menu').setAttribute('aria-pressed', String(on));
    const b = $('btn-sound');
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('off', !on);
    b.title = label;
    b.setAttribute('aria-label', label);
  }

  function toggleSound() {
    Sound.setEnabled(!Sound.enabled);
    Sound.unlock();
    renderSound();
  }

  // ───────────── Input ─────────────
  // Pointer down anywhere on the stage (the field or the empty space around it on a phone) starts aiming and
  // firing; the pull from the touch point sets angle and power.
  stage.addEventListener('pointerdown', (e) => {
    if (screen !== 'wave' || paused || aiming || e.target.closest('.screen')) return;
    Sound.unlock();
    aiming = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
    try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    showTip(null);
    sfx('draw');
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!aiming || e.pointerId !== aiming.id || !run) return;
    const a = V.aimFromDrag(e.clientX - aiming.x0, e.clientY - aiming.y0);
    if (a) C.aim(run, a.angle, a.power);
  });
  const release = (e) => {
    if (!aiming || e.pointerId !== aiming.id) return;
    aiming = null;
    if (run) C.setFiring(run, false);
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (screen === 'wave' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      if (!keys[e.code] && e.code === 'Space') sfx('draw');
      keys[e.code] = true;
      Sound.unlock();
      showTip(null);
      e.preventDefault();
    } else if (e.code === 'KeyP') {
      togglePause();
    } else if (e.code === 'Escape') {
      if (screen === 'wave') { if (!paused) togglePause(); else showMenu(); }
      else if (screen === 'between' || screen === 'result' || !$('confirm').hidden) showMenu();
    }
  });
  document.addEventListener('keyup', (e) => { delete keys[e.code]; });
  window.addEventListener('blur', () => { keys = {}; aiming = null; });

  $('btn-campaign').addEventListener('click', () => startMode('campaign'));
  $('btn-endless').addEventListener('click', () => startMode('endless'));
  $('btn-sound-menu').addEventListener('click', toggleSound);
  $('btn-sound').addEventListener('click', toggleSound);
  $('btn-confirm-no').addEventListener('click', showMenu);
  $('btn-confirm-yes').addEventListener('click', () => {
    save.current = null;
    persist();
    newRunOf(pendingMode || 'campaign');
  });
  $('btn-repair').addEventListener('click', () => shop('repair'));
  $('btn-fortify').addEventListener('click', () => shop('fortify'));
  $('btn-fight').addEventListener('click', () => { pickedId = null; beginWave(); });
  $('btn-between-menu').addEventListener('click', showMenu);
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-resume').addEventListener('click', togglePause);
  $('btn-pause-menu').addEventListener('click', showMenu);
  $('btn-res-menu').addEventListener('click', showMenu);
  $('btn-again').addEventListener('click', () => newRunOf(run ? run.mode : 'campaign'));

  $('submit').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!run) return;
    const typed = $('name').value.trim();
    const name = (typed || t('Аноним')).slice(0, 16);
    store.set(NAME_KEY, typed);
    $('btn-submit').disabled = true;
    const status = $('submit-status');
    try {
      const res = await fetch(BOARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, score: C.score(run), level: Math.max(1, run.wave) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { rank } = await res.json();
      status.textContent = rank ? t('Место в таблице рекордов: {n}', { n: rank }) : t('В таблицу рекордов не хватило очков.');
      status.classList.add('ok');
    } catch {
      status.textContent = t('Таблица рекордов сейчас недоступна.');
      $('btn-submit').disabled = false;
    }
  });

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);

  // ───────────── Boot ─────────────
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = t(meta.content);
  const actions = $('top-actions');
  actions.append(window.I18n.toggle('chip'));
  if (window.GameNav) actions.append(window.GameNav.home('chip'));
  resize();
  showMenu();
  requestAnimationFrame(frame);
})();
