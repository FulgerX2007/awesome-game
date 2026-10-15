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
  let fx = { flashes: {}, sticks: [], bow: 0 }; // hit flashes, arrows stuck in the ground, the bow's twang
  let demo = null;          // a quiet field behind the menu
  let time = 0;
  let last = 0;

  // ───────────── Canvas size ─────────────
  // The field fits the way view.js says (the whole width shows the battlefield, the scale never changes with the
  // art). The canvas then fills the whole stage: spare height becomes more sky above and more meadow below, so a
  // portrait phone shows a full picture instead of a band in an empty frame. Input only uses pull deltas, so the
  // canvas size never touches aiming. The pixel ratio is capped at 2 to keep the baked layers cheap.
  let f = V.fit({ w: 640, h: 360 });
  function resize() {
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const aw = stage.clientWidth - padX, ah = stage.clientHeight - padY;
    const base = V.fit({ w: aw, h: ah, dpr: Math.min(2, window.devicePixelRatio || 1) });
    const H = Math.max(base.cssH, Math.floor(ah));
    const gy = Math.max(base.gy, Math.min(H - V.UNDER * base.scale, Math.round(H * 0.75)));
    const next = { ...base, cssH: H, gy, h: Math.round(H * base.dpr) };
    if (next.w === canvas.width && next.h === canvas.height && next.gy === f.gy) { f = next; return; }
    f = next;
    canvas.width = f.w;
    canvas.height = f.h;
    canvas.style.width = f.cssW + 'px';
    canvas.style.height = f.cssH + 'px';
    layers = {};
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
      if (run.status === 'lost') wallCollapse();
      showResult();
    }
  }

  // ───────────── Effects from core events ─────────────
  // Particles, floating numbers and the shake live in screen space (css px); they never feed back into the rules.
  const Fx = window.Fx;
  const { shade, withAlpha } = Fx;
  const parts = new Fx.Particles(320);
  const floaters = new Fx.Floaters();
  const shake = new Fx.Shake(9, 2.2);
  let banner = null;      // { text, t, boss } the wave-start ribbon
  let wallSeen = null;    // wall HP last frame: a rise means a repair → sparkles
  let dragNow = null;     // where the pulling pointer is now (client px), for the pull band

  function clearFx() {
    fx = { flashes: {}, sticks: [], bow: 0 };
    parts.clear();
    floaters.list = [];
    shake.trauma = 0;
    banner = null;
    wallSeen = null;
  }

  const P = (x, y) => V.toScreen(f, x, y);
  const rnd = (a, b) => a + Math.random() * (b - a);

  function hitPuff(x, y) {
    const q = P(x, y), s = f.scale;
    parts.burst(q.x, q.y, 4, { shape: 'smoke', colors: ['#fff6e6', '#efe2cc'], speed: s * 1.6, size: s * 0.16, grow: s * 0.55, life: 0.35, drag: 0.95, alpha: 0.8 });
    parts.burst(q.x, q.y, 4, { shape: 'spark', colors: ['#fff3c4', '#ffffff'], speed: s * 5, size: Math.max(1, s * 0.07), life: 0.16, drag: 0.9 });
  }

  function shieldSparks(x, y) {
    const q = P(x, y), s = f.scale;
    parts.burst(q.x, q.y, 9, { shape: 'spark', colors: ['#fff6c8', '#ffd36b', '#ffffff'], angle: -2.2, spread: 2.2, speed: s * 7, size: Math.max(1, s * 0.08), gravity: s * 14, life: 0.3, drag: 0.6 });
    parts.emit({ x: q.x, y: q.y, shape: 'ring', color: '#ffe9a8', size: s * 0.25, grow: s * 3.2, life: 0.22 });
  }

  const POOF = { grunt: 1, shield: 1.1, flyer: 0.8, ram: 1.6, boss: 2.6 };
  function deathPoof(e) {
    const s = f.scale, k = POOF[e.kind] || 1;
    const h = (C.KINDS[e.kind] || C.KINDS.grunt).h;
    const q = P(e.x, e.y + h * 0.45);
    parts.burst(q.x, q.y, Math.round(9 * k), { shape: 'smoke', colors: ['#f1ebf7', '#d6cbe3', '#bfb0cf'], speed: s * 2.4 * k, size: s * 0.3 * k, grow: s * 1.1 * k, life: 0.6, drag: 0.92, gravity: -s * 1.5, alpha: 0.85 });
    parts.burst(q.x, q.y, Math.round(5 * k), { shape: 'star', colors: ['#ffe27a', '#fff3b8'], speed: s * 4.5, size: s * 0.2, spin: 6, life: 0.65, gravity: s * 7, drag: 0.4 });
    parts.emit({ x: q.x, y: q.y, shape: 'ring', color: '#ffffff', size: s * 0.3 * k, grow: s * 4 * k, life: 0.3, alpha: 0.8 });
    if (e.kind === 'ram') parts.burst(q.x, q.y, 12, { shape: 'chunk', colors: ['#8a5a2b', '#6b4423', '#a8743d'], angle: -Math.PI / 2, spread: 2.6, speed: s * 6, size: s * 0.22, spin: 10, gravity: s * 22, life: 0.9, drag: 0.2 });
    if (e.kind === 'boss') parts.burst(q.x, q.y, 18, { shape: 'spark', colors: ['#ff8a5a', '#ffd36b', '#c58cff'], speed: s * 9, size: Math.max(1.2, s * 0.12), life: 0.45, drag: 0.7 });
  }

  function wallDust(big) {
    const s = f.scale, q = P(C.WALL_X + 0.1, rnd(0.4, big ? 2.6 : 2));
    parts.burst(q.x, q.y, big ? 7 : 4, { shape: 'smoke', colors: ['#c9b796', '#a99878', '#d8cbb0'], angle: -0.3, spread: 2.2, speed: s * 2, size: s * 0.25, grow: s * 0.9, life: 0.75, drag: 0.9, gravity: -s * 0.6, alpha: 0.8 });
    parts.burst(q.x, q.y, big ? 5 : 2, { shape: 'chunk', colors: ['#9b917f', '#7d7465', '#b3a892'], angle: -1.2, spread: 1.4, speed: s * 4, size: s * 0.15, spin: 10, gravity: s * 25, life: 0.7, drag: 0.2 });
  }

  // The wall falls: a cloud of dust and stones over the whole wall.
  function wallCollapse() {
    const s = f.scale;
    for (let k = 0; k < 6; k++) {
      const q = P(rnd(0, C.WALL_X), rnd(1, C.WALL_TOP));
      parts.burst(q.x, q.y, 5, { shape: 'smoke', colors: ['#bfae8f', '#9c8d72', '#d6c9ae'], speed: s * 2.5, size: s * 0.4, grow: s * 1.4, life: 1.2, drag: 0.9, gravity: -s * 0.8, alpha: 0.85 });
      parts.burst(q.x, q.y, 4, { shape: 'chunk', colors: ['#9b917f', '#7d7465', '#b3a892'], speed: s * 5, size: s * 0.25, spin: 8, gravity: s * 25, life: 1, drag: 0.2 });
    }
    shake.add(0.8);
  }

  function handle(events, quiet) {
    const s = f.scale;
    for (const e of events) {
      if (e.type === 'fire') { fx.bow = 0.12; if (!quiet) sfx('release'); }
      else if (e.type === 'hit') {
        fx.flashes[e.id] = 0.1;
        if (e.cause === 'arrow') { hitPuff(e.x - 0.2, e.y); if (!quiet) sfx('hit'); }
        else { const q = P(e.x + rnd(-0.3, 0.3), e.y + rnd(-0.3, 0.5)); parts.emit({ x: q.x, y: q.y, vy: -s * 2, shape: 'spark', color: '#ffb347', size: Math.max(1, s * 0.07), life: 0.3 }); }
      } else if (e.type === 'shieldHit') { shieldSparks(e.x, e.y); if (!quiet) sfx('shield'); }
      else if (e.type === 'kill') {
        deathPoof(e);
        if (!quiet) {
          const q = P(e.x, e.y + (C.KINDS[e.kind] || C.KINDS.grunt).h + 0.6);
          floaters.add(`+${e.gold}`, q.x, q.y, { color: '#ffd34d', size: Math.max(13, s * 1.05), rise: s * 2.2, life: 1 });
          if (e.kind === 'boss') shake.add(0.6);
          sfx('death');
        }
      } else if (e.type === 'ground') {
        fx.sticks.push({ x: e.x, a: Math.atan2(e.vy, e.vx), t: 0 });
        const q = P(e.x, 0);
        parts.burst(q.x, q.y, 3, { colors: ['#9a7a52', '#7a5e3c'], angle: -Math.PI / 2, spread: 1.6, speed: s * 2.5, size: s * 0.07, gravity: s * 18, life: 0.4 });
      } else if (e.type === 'ward') {
        const q = P(e.x, e.y + 0.3);
        parts.emit({ x: q.x, y: q.y, shape: 'ring', color: '#9fd8ff', size: s * 0.4, grow: s * 5, life: 0.4 });
        parts.burst(q.x, q.y, 12, { shape: 'star', colors: ['#bfe6ff', '#7fc4ff', '#ffffff'], speed: s * 4, size: s * 0.18, spin: 5, life: 0.6, drag: 0.6 });
        parts.burst(q.x, q.y, 6, { shape: 'smoke', color: '#d6cbe3', speed: s * 1.5, size: s * 0.2, grow: s * 0.8, life: 0.5, drag: 0.9 });
        if (!quiet) sfx('ward');
      } else if (e.type === 'wallHit') {
        const big = e.kind === 'ram' || e.kind === 'boss';
        if (!quiet) { shake.add(big ? 0.32 : 0.16); sfx('wall'); }
        wallDust(big);
      } else if (e.type === 'summon') { if (!quiet) sfx('horn'); }
      else if (e.type === 'waveStart') {
        if (!quiet) {
          sfx('horn');
          banner = { text: t('Волна {n}', { n: e.wave }), t: 0, boss: e.wave % 10 === 0 };
        }
      }
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
    fx.bow = Math.max(0, fx.bow - dt);
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
    if (paused) return; // effects freeze with the pause
    if (banner && (banner.t += dt) > 2.2) banner = null;
    ambient(dt);
    parts.update(dt);
    floaters.update(dt);
    shake.update(dt);
  }

  // Embers from fire arrows and burning monsters, smoke from a broken wall, sparkles after a repair.
  function ambient(dt) {
    const r = screen === 'menu' ? demo : run;
    if (!r) return;
    const s = f.scale;
    for (const a of r.arrows) {
      if (!a.fire || Math.random() > dt * 45) continue;
      const q = P(a.x, a.y);
      parts.emit({ x: q.x + rnd(-2, 2), y: q.y + rnd(-2, 2), vx: rnd(-s, s), vy: -s * rnd(0.5, 2), shape: 'dot', color: Math.random() < 0.5 ? '#ffb347' : '#ff7a2a', size: Math.max(0.8, s * 0.06), life: 0.35, gravity: -s * 2 });
    }
    for (const e of r.enemies) {
      if (!(e.burn > 0) || Math.random() > dt * 14) continue;
      const q = P(e.x + rnd(-e.w / 3, e.w / 3), e.y + e.h * rnd(0.3, 0.9));
      parts.emit({ x: q.x, y: q.y, vx: rnd(-s, s) * 0.5, vy: -s * rnd(1.5, 3), shape: 'dot', color: Math.random() < 0.5 ? '#ffd36b' : '#ff7a2a', size: Math.max(0.8, s * 0.07), life: 0.5 });
    }
    const lvl = wallLevel(r);
    if (lvl >= 3 && Math.random() < dt * (lvl - 2) * 3) {
      const q = P(rnd(2.5, C.WALL_X + 0.2), C.WALL_TOP + 0.3); // from the battered right side, drifting away from the archer
      parts.emit({ x: q.x, y: q.y, vx: s * rnd(0.3, 1), vy: -s * rnd(1, 2), shape: 'smoke', color: '#4e4640', size: s * 0.3, grow: s * 0.9, life: 1.8, alpha: 0.35, drag: 0.3 });
    }
    if (wallSeen != null && r.wallHp > wallSeen + 0.5) {
      for (let k = 0; k < 14; k++) {
        const q = P(rnd(0, C.WALL_X), rnd(0.5, C.WALL_TOP));
        parts.emit({ x: q.x, y: q.y, vy: -s * rnd(1, 3), shape: 'star', color: Math.random() < 0.5 ? '#ffe27a' : '#9cf0a8', size: s * rnd(0.15, 0.3), spin: 4, life: rnd(0.6, 1) });
      }
      const q = P(C.WALL_X / 2, C.WALL_TOP / 2);
      parts.emit({ x: q.x, y: q.y, shape: 'ring', color: '#bff5c4', size: s, grow: s * 6, life: 0.5, alpha: 0.7 });
    }
    wallSeen = r.wallHp;
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
  // Layers baked offscreen: the sky, the land (mountains, hills, meadow, road) and the castle (rebuilt only when
  // its damage state, fortification or the dusk tint changes). Monsters are baked per kind and animation frame.
  // Everything else (archer, arrows, particles) is drawn live. The light comes from the top left (Fx.LIGHT).
  let layers = {};

  function waveTint() {
    const w = run ? run.wave : 1;
    return (((w - 1) % 10) + 10) % 10 / 9; // 0 day … 1 dusk, every ten waves
  }

  // Wall damage state 0 (whole) … 4 (crumbling).
  function wallLevel(r) {
    if (!r) return 0;
    const share = r.wallHp / r.wallMax;
    return share > 0.8 ? 0 : share > 0.6 ? 1 : share > 0.4 ? 2 : share > 0.2 ? 3 : 4;
  }

  function offscreen(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // A deterministic hash in [0, 1): the same stones, trees and tufts every bake.
  function hash(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  const mixc = (a, b, k) => Fx.mix(a, b, k);
  const skyTop = (k) => mixc('#3f8fe0', '#2b2350', k);
  const skyLow = (k) => mixc('#cdeaf8', '#f39a5e', k);

  // ── Sky: gradient, sun and its halo ──
  function paintSky(g, W, H, gy, tint) {
    const sky = g.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, skyTop(tint));
    sky.addColorStop(0.65, mixc('#8cc6f0', '#9a5a86', tint));
    sky.addColorStop(1, skyLow(tint));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    const sx = W * 0.74, sy = gy * (0.3 + tint * 0.42), R = Math.min(W, gy) * 0.06 + 8;
    const halo = g.createRadialGradient(sx, sy, 0, sx, sy, R * 7);
    halo.addColorStop(0, withAlpha(mixc('#fff6d0', '#ffc27a', tint), 0.75));
    halo.addColorStop(0.25, withAlpha(mixc('#fff1b8', '#ff9a50', tint), 0.3));
    halo.addColorStop(1, 'rgba(255, 220, 160, 0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);
    // soft light rays from the sun
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.translate(sx, sy);
    for (let k = 0; k < 9; k++) {
      g.rotate(TAU / 9 + hash(k) * 0.2);
      const rg = g.createLinearGradient(0, 0, R * 9, 0);
      rg.addColorStop(0, 'rgba(255, 240, 200, .06)');
      rg.addColorStop(1, 'rgba(255, 240, 200, 0)');
      g.fillStyle = rg;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(R * 9, -R * 0.5); g.lineTo(R * 9, R * 0.5); g.closePath(); g.fill();
    }
    g.restore();
    const disc = g.createRadialGradient(sx - R * 0.3, sy - R * 0.3, R * 0.1, sx, sy, R);
    disc.addColorStop(0, '#fffdf2');
    disc.addColorStop(1, mixc('#ffe9a0', '#ffb070', tint));
    g.fillStyle = disc;
    g.beginPath(); g.arc(sx, sy, R, 0, TAU); g.fill();
    // a few faint stars at dusk
    if (tint > 0.5) {
      g.fillStyle = withAlpha('#ffffff', (tint - 0.5) * 1.2);
      for (let k = 0; k < 40; k++) {
        const x = hash(k + 3) * W, y = hash(k + 50) * gy * 0.45;
        g.fillRect(x, y, 1.2, 1.2);
      }
    }
  }

  // ── Clouds: three puffy sprites, drifting live ──
  function cloudSprite(k, w, tint) {
    const h = w * 0.5;
    const c = offscreen(w * f.dpr, h * f.dpr);
    const g = c.getContext('2d');
    g.scale(f.dpr, f.dpr);
    const lit = mixc('#ffffff', '#ffd9b8', tint), dark = mixc('#c9d6ea', '#9a6f9a', tint);
    const grd = g.createLinearGradient(0, h * 0.2, 0, h);
    grd.addColorStop(0, lit);
    grd.addColorStop(0.6, mixc(lit, dark, 0.45));
    grd.addColorStop(1, dark);
    g.fillStyle = grd;
    const n = 5 + k;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, cx = w * (0.12 + 0.76 * u);
      const r = h * (0.18 + 0.2 * Math.sin(u * Math.PI) + 0.06 * hash(i + k * 9));
      g.moveTo(cx + r, h * 0.78 - r * 0.9);
      g.arc(cx, h * 0.78 - r * 0.9, r, 0, TAU);
    }
    g.moveTo(w * 0.88, h * 0.7);
    g.ellipse(w * 0.5, h * 0.7, w * 0.38, h * 0.12, 0, 0, TAU);
    g.fill();
    // light rim on the upper left bumps
    g.globalCompositeOperation = 'source-atop';
    const hl = g.createLinearGradient(0, 0, w * 0.6, h);
    hl.addColorStop(0, 'rgba(255,255,255,.55)');
    hl.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = hl;
    g.fillRect(0, 0, w, h);
    return c;
  }

  function drawClouds(tint) {
    const W = f.cssW, gy = f.gy;
    const n = gy > W * 0.7 ? 7 : 4;
    const cw = Math.max(70, W * 0.2);
    const key = `${Math.round(cw)}:${tint}`;
    if (layers.cloudKey !== key) {
      layers.cloudKey = key;
      layers.clouds = [0, 1, 2].map((k) => cloudSprite(k, cw * (0.8 + k * 0.2), tint));
    }
    for (let k = 0; k < n; k++) {
      const sp = layers.clouds[k % 3];
      const w = sp.width / f.dpr, h = sp.height / f.dpr;
      const sc = 0.6 + hash(k + 20) * 0.6;
      const span = W + w * sc;
      const x = ((hash(k + 7) * span + time * (4 + k * 1.5)) % span) - w * sc;
      const y = gy * (0.02 + 0.26 * (k / n)) + hash(k + 13) * gy * 0.05;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(sp, x, y, w * sc, h * sc);
    }
    ctx.globalAlpha = 1;
    // a few birds far away
    ctx.strokeStyle = 'rgba(30, 24, 50, .55)';
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      const span = W + 40, x = ((hash(k + 60) * span + time * (10 + k * 3)) % span) - 20;
      const y = gy * (0.1 + hash(k + 61) * 0.3) + Math.sin(time * 0.7 + k) * 4, b = 3 + hash(k + 62) * 2;
      const fl = Math.sin(time * 9 + k * 2) * b * 0.6;
      ctx.beginPath(); ctx.moveTo(x - b, y - fl); ctx.quadraticCurveTo(x - b * 0.4, y - b * 0.2, x, y); ctx.quadraticCurveTo(x + b * 0.4, y - b * 0.2, x + b, y - fl); ctx.stroke();
    }
  }

  // ── Land: mountains, forested hills, meadow, the road and the foreground ──
  function ridgePath(g, W, base, yAt, step = 4) {
    g.beginPath();
    g.moveTo(-2, base);
    for (let x = -2; x <= W + step; x += step) g.lineTo(x, yAt(x));
    g.lineTo(W + step, base);
    g.closePath();
  }

  function conifer(g, x, y, h, col) {
    const w = h * 0.42;
    g.fillStyle = shade(col, -0.25);
    g.fillRect(x - h * 0.03, y - h * 0.12, h * 0.06, h * 0.14);
    for (let k = 0; k < 3; k++) {
      const ty = y - h * (0.1 + k * 0.28), tw = w * (1 - k * 0.25);
      g.fillStyle = col;
      g.beginPath(); g.moveTo(x, ty - h * 0.42); g.lineTo(x + tw, ty); g.lineTo(x - tw, ty); g.closePath(); g.fill();
      g.fillStyle = withAlpha(shade(col, 0.35), 0.6); // lit left side
      g.beginPath(); g.moveTo(x, ty - h * 0.42); g.lineTo(x, ty); g.lineTo(x - tw, ty); g.closePath(); g.fill();
    }
  }

  function roundTree(g, x, y, h, col) {
    g.fillStyle = '#5a3c22';
    g.fillRect(x - h * 0.05, y - h * 0.45, h * 0.1, h * 0.46);
    const r = h * 0.3;
    for (const [dx, dy, k] of [[-0.45, 0.1, 0.9], [0.45, 0.12, 0.85], [0, -0.25, 1]]) {
      Fx.sphere(g, x + dx * r, y - h * 0.62 + dy * r, r * k, col, { gloss: false, shine: 0.3 });
    }
  }

  // A bush: a few overlapping clumps filled as one lit mass, with brighter clumps on the lit side.
  function bush(g, x, y, r, col) {
    Fx.shadow(g, x + r * 0.2, y, r * 1.6, r * 0.35, 0.4);
    const clumps = [[-0.75, -0.5, 0.62], [0.75, -0.5, 0.6], [-0.3, -0.95, 0.7], [0.35, -0.9, 0.66], [0, -0.55, 0.75]];
    const grd = g.createLinearGradient(x - r, y - r * 1.6, x + r * 0.8, y);
    grd.addColorStop(0, shade(col, 0.35));
    grd.addColorStop(0.5, col);
    grd.addColorStop(1, shade(col, -0.45));
    g.fillStyle = grd;
    g.beginPath();
    for (const [dx, dy, k] of clumps) { g.moveTo(x + dx * r + k * r, y + dy * r); g.arc(x + dx * r, y + dy * r, k * r, 0, TAU); }
    g.fill();
    g.fillStyle = withAlpha(shade(col, 0.55), 0.35);
    for (const [dx, dy, k] of clumps.slice(0, 3)) { g.beginPath(); g.arc(x + dx * r - k * r * 0.25, y + dy * r - k * r * 0.3, k * r * 0.45, 0, TAU); g.fill(); }
  }

  function tuft(g, x, y, h, col) {
    g.strokeStyle = col;
    g.lineWidth = Math.max(0.8, h * 0.12);
    g.lineCap = 'round';
    g.beginPath();
    for (let k = -2; k <= 2; k++) {
      g.moveTo(x + k * h * 0.12, y);
      g.quadraticCurveTo(x + k * h * 0.2, y - h * 0.6, x + k * h * 0.35 + h * 0.08, y - h * (0.85 + 0.15 * ((k + 2) % 2)));
    }
    g.stroke();
  }

  function rock(g, x, y, r, col) {
    Fx.shadow(g, x + r * 0.2, y, r * 1.3, r * 0.35, 0.35);
    g.fillStyle = col;
    const grd = g.createLinearGradient(x - r, y - r, x + r, y);
    grd.addColorStop(0, shade(col, 0.35));
    grd.addColorStop(0.5, col);
    grd.addColorStop(1, shade(col, -0.4));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x - r, y);
    g.quadraticCurveTo(x - r * 0.95, y - r * 0.7, x - r * 0.3, y - r * 0.85);
    g.quadraticCurveTo(x + r * 0.6, y - r * 0.9, x + r, y);
    g.closePath();
    g.fill();
  }

  function mountain(g, px, py, bw, base, col, tint, seed) {
    const h0 = base - py;
    const side = (dir) => {
      const pts = [];
      for (let i = 1; i <= 7; i++) {
        const t = i / 7;
        pts.push([px + dir * bw * t + (hash(seed * 13 + i * dir) - 0.5) * bw * 0.1, py + h0 * Math.pow(t, 0.75) + (hash(seed * 17 + i * dir) - 0.5) * h0 * 0.07]);
      }
      return pts;
    };
    const L = side(-1), R = side(1);
    g.save();
    g.beginPath();
    g.moveTo(px, py);
    for (const [x, y] of R) g.lineTo(x, Math.min(base, y));
    g.lineTo(px + bw, base); g.lineTo(px - bw, base);
    for (let i = L.length - 1; i >= 0; i--) g.lineTo(L[i][0], Math.min(base, L[i][1]));
    g.closePath();
    const grd = g.createLinearGradient(0, py, 0, base);
    grd.addColorStop(0, shade(col, 0.12));
    grd.addColorStop(1, col);
    g.fillStyle = grd;
    g.fill();
    g.clip();
    // snow down to a ragged line
    const sl = py + h0 * (0.2 + hash(seed + 3) * 0.08);
    g.fillStyle = withAlpha(mixc('#ffffff', '#ffd9c8', tint), 0.9);
    g.beginPath();
    g.moveTo(px - bw, py - 5);
    g.lineTo(px + bw, py - 5);
    for (let i = 0; i <= 8; i++) {
      const x = px + bw * 0.5 - (i / 8) * bw, y = sl + (i % 2 ? h0 * 0.06 : -h0 * 0.02) * (1 - Math.abs(i - 4) / 6);
      g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    // the face away from the light along a ragged ridge
    g.fillStyle = withAlpha(shade(col, -0.45), 0.42);
    g.beginPath();
    g.moveTo(px, py);
    for (let i = 1; i <= 5; i++) g.lineTo(px + bw * (hash(seed * 7 + i) - 0.35) * 0.18 * i / 2, py + h0 * i / 5);
    g.lineTo(px + bw + 5, base + 5);
    g.lineTo(px + bw + 5, py - 5);
    g.closePath();
    g.fill();
    g.restore();
  }

  function paintLand(g, W, H, gy, s, tint) {
    const haze = skyLow(tint);
    // far mountains in two rows: jagged slopes, a lit left face, a shaded right face and snow caps
    const farCol = mixc(mixc('#7f93bd', '#6d5a92', tint), haze, 0.3);
    const rows = [[0.3, 0.16, mixc(farCol, haze, 0.4)], [0.16, 0.14, farCol]];
    rows.forEach(([hk, vk, col], row) => {
      for (let k = 0, x = -W * 0.06 + hash(row + 7) * W * 0.12; x < W * 1.1; k++) {
        const hgt = gy * (hk + hash(k * 3 + row * 50) * vk);
        const bw = hgt * (1.15 + hash(k + row * 20 + 5) * 0.6);
        mountain(g, x, gy - hgt - 4, bw, gy + 2, col, tint, k + row * 100);
        x += bw * (0.95 + hash(k + row * 30) * 0.6);
      }
    });
    // haze band at the foot of the mountains
    const hz = g.createLinearGradient(0, gy - gy * 0.25, 0, gy);
    hz.addColorStop(0, withAlpha(haze, 0));
    hz.addColorStop(1, withAlpha(haze, 0.55));
    g.fillStyle = hz;
    g.fillRect(0, gy - gy * 0.25, W, gy * 0.25);

    // mid hills with a pine forest
    const midCol = mixc(mixc('#5f9a6a', '#4b4a6a', tint), haze, 0.25);
    const midY = (x) => gy - gy * 0.1 - gy * 0.04 * Math.sin(x / W * 7 + 1.3) - gy * 0.02 * Math.sin(x / W * 19);
    ridgePath(g, W, gy, midY);
    const mg = g.createLinearGradient(0, gy * 0.8, 0, gy);
    mg.addColorStop(0, shade(midCol, 0.12));
    mg.addColorStop(1, shade(midCol, -0.15));
    g.fillStyle = mg;
    g.fill();
    const pine = mixc(mixc('#3f7a4e', '#3a3a58', tint), haze, 0.2);
    const ph = Math.max(6, Math.min(gy * 0.05, s * 1.6));
    for (let x = W * 0.06, k = 0; x < W; x += ph * (0.35 + hash(k) * 0.5), k++) {
      if (hash(k + 99) < 0.25) continue;
      conifer(g, x, midY(x) + ph * 0.25, ph * (0.7 + hash(k + 5) * 0.5), pine);
    }
    // a distant keep on the hills
    const kx = W * 0.58, ky = midY(W * 0.58) + 2, ku = Math.max(4, ph * 0.5);
    g.fillStyle = shade(midCol, -0.3);
    g.fillRect(kx - ku, ky - ku * 3, ku * 2, ku * 3);
    g.fillRect(kx - ku * 1.8, ky - ku * 2, ku * 0.8, ku * 2);
    g.beginPath(); g.moveTo(kx - ku * 1.3, ky - ku * 3); g.lineTo(kx, ky - ku * 4.6); g.lineTo(kx + ku * 1.3, ky - ku * 3); g.fill();

    // near hills with round trees
    const nearCol = mixc('#79b552', '#5a6a48', tint);
    const nearY = (x) => gy - s * 1.2 - gy * 0.035 * (1 + Math.sin(x / W * 5 + 0.4)) - gy * 0.012 * Math.sin(x / W * 23);
    ridgePath(g, W, gy, nearY);
    const ng = g.createLinearGradient(0, gy - gy * 0.12, 0, gy);
    ng.addColorStop(0, shade(nearCol, 0.15));
    ng.addColorStop(1, shade(nearCol, -0.08));
    g.fillStyle = ng;
    g.fill();
    const tree = mixc('#4f9a3c', '#3e5a3a', tint);
    const th = Math.max(7, Math.min(gy * 0.07, s * 2.4));
    for (let x = W * 0.12, k = 0; x < W; x += th * (1.2 + hash(k + 3) * 2.2), k++) {
      if (hash(k + 31) < 0.3) continue;
      roundTree(g, x, nearY(x) + th * 0.15, th * (0.75 + hash(k + 8) * 0.5), tree);
    }

    // the meadow under the lane and in front of it
    const grass = mixc('#6fae45', '#4c6a3a', tint);
    const mg2 = g.createLinearGradient(0, gy - s * 1.4, 0, H);
    mg2.addColorStop(0, shade(grass, 0.12));
    mg2.addColorStop(0.3, grass);
    mg2.addColorStop(1, shade(grass, -0.35));
    g.fillStyle = mg2;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W + 4; x += 4) g.lineTo(x, Math.max(gy - s * 1.1, nearY(x) + s * 0.6));
    g.lineTo(W, H);
    g.closePath();
    g.fill();

    // the road the monsters walk: packed dirt with ruts, a little wider towards the viewer
    const rTop = gy - s * 0.32, rBot = Math.min(H - 1, gy + Math.max(s * 0.55, Math.min((H - gy) * 0.1, s * 2.2)));
    const road = g.createLinearGradient(0, rTop, 0, rBot);
    road.addColorStop(0, mixc('#c9a46e', '#9a7458', tint));
    road.addColorStop(1, mixc('#9a7446', '#6e5040', tint));
    g.fillStyle = road;
    g.beginPath();
    g.moveTo(0, rTop + 1);
    for (let x = 0; x <= W + 6; x += 6) g.lineTo(x, rTop + Math.sin(x * 0.07) * 0.8);
    for (let x = W + 6; x >= 0; x -= 6) g.lineTo(x, rBot + Math.sin(x * 0.05 + 2) * 1.5);
    g.closePath();
    g.fill();
    g.strokeStyle = withAlpha('#5a3e22', 0.22);
    g.lineWidth = Math.max(1, s * 0.08);
    for (const k of [0.35, 0.7]) {
      g.beginPath();
      g.moveTo(0, rTop + (rBot - rTop) * k);
      for (let x = 0; x <= W; x += 10) g.lineTo(x, rTop + (rBot - rTop) * k + Math.sin(x * 0.03 + k * 9) * 0.8);
      g.stroke();
    }
    for (let k = 0; k < W / 9; k++) { // pebbles
      const x = hash(k + 300) * W, y = rTop + (rBot - rTop) * (0.15 + hash(k + 400) * 0.8);
      g.fillStyle = withAlpha(k % 3 ? '#e2c9a0' : '#6b4f33', 0.55);
      g.beginPath(); g.ellipse(x, y, Math.max(0.8, s * 0.07), Math.max(0.5, s * 0.04), 0, 0, TAU); g.fill();
    }

    // grass tufts along the road edges
    const tuftCol = shade(grass, 0.2), tuftDark = shade(grass, -0.25);
    for (let k = 0; k < W / 7; k++) {
      const x = hash(k + 500) * W;
      tuft(g, x, rTop + 1, Math.max(3, s * (0.25 + hash(k + 600) * 0.25)), k % 2 ? tuftCol : tuftDark);
    }
    // the foreground meadow: tufts, flowers, rocks and bushes, bigger towards the viewer
    const fgTop = rBot + 2, fgH = H - fgTop;
    if (fgH > 8) {
      const n = Math.round(W * fgH / 900);
      for (let k = 0; k < n; k++) {
        const u = hash(k + 700), d = hash(k + 800);
        const x = u * W, y = fgTop + d * fgH, sz = 1 + d * 2.2;
        tuft(g, x, y, Math.max(3, s * 0.35) * sz, k % 3 ? tuftCol : tuftDark);
        if (k % 5 === 0 && fgH > 40) {
          g.fillStyle = ['#ffe36a', '#ffffff', '#ff9ac0', '#b7a6ff'][k % 4];
          g.beginPath(); g.arc(x + 3 * sz, y - 4 * sz, 1.2 * sz, 0, TAU); g.fill();
        }
      }
      if (fgH > s * 3) {
        const m = Math.max(3, Math.round(W / 90));
        for (let k = 0; k < m; k++) {
          const d = 0.3 + hash(k + 900) * 0.7, x = hash(k + 950) * W, y = fgTop + d * fgH;
          if (x < s * 6 && d < 0.5) continue; // keep the castle foot clear
          if (k % 2) rock(g, x, y, s * (0.5 + d * 1.6), mixc('#9a958a', '#6e6478', tint));
          else bush(g, x, y, s * (0.6 + d * 1.6), mixc('#5aa83f', '#46703a', tint));
        }
      }
      if (fgH > s * 8) {
        // a line of sharpened stakes facing the enemy, and big boulders framing the corners
        const py = fgTop + fgH * 0.4, L = Math.max(12, s * 2.6, fgH * 0.12);
        Fx.shadow(g, W * 0.6, py + 2, W * 0.42, L * 0.12, 0.35);
        for (let x = W * 0.2, k = 0; x < W * 1.02; x += L * (0.42 + hash(k + 1200) * 0.12), k++) {
          const lean = 0.5 + hash(k + 1300) * 0.15, len = L * (0.85 + hash(k + 1400) * 0.3);
          const tx = x + Math.cos(-lean) * len, ty = py + Math.sin(-lean) * len, w = L * 0.09;
          const nx = Math.sin(lean) * w, ny = Math.cos(lean) * w;
          const sg = g.createLinearGradient(x - nx, py - ny, x + nx, py + ny);
          sg.addColorStop(0, '#c08a52'); sg.addColorStop(0.5, '#8a5a2b'); sg.addColorStop(1, '#4a2e14');
          g.fillStyle = sg;
          g.beginPath();
          g.moveTo(x - nx, py - ny); g.lineTo(tx - nx - (tx - x) * 0.12, ty - ny - (ty - py) * 0.12);
          g.lineTo(tx, ty); g.lineTo(tx + nx - (tx - x) * 0.12, ty + ny - (ty - py) * 0.12); g.lineTo(x + nx, py + ny);
          g.closePath(); g.fill();
          g.fillStyle = '#e8cfa0'; // the pale cut point
          g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx - (tx - x) * 0.12 - nx, ty - (ty - py) * 0.12 - ny); g.lineTo(tx - (tx - x) * 0.12 + nx, ty - (ty - py) * 0.12 + ny); g.closePath(); g.fill();
        }
        const lg = g.createLinearGradient(0, py - L * 0.08, 0, py + L * 0.1);
        lg.addColorStop(0, '#b07a44'); lg.addColorStop(1, '#4e3018');
        g.fillStyle = lg;
        Fx.rrect(g, W * 0.18, py - L * 0.08, W * 0.86, L * 0.18, L * 0.09); g.fill();
        // the garrison's supplies: barrels and a crate
        const u = Math.max(8, fgH * 0.07), bx = W * 0.1, by = fgTop + fgH * 0.62;
        Fx.shadow(g, bx + u * 1.4, by + u * 0.1, u * 2.8, u * 0.5, 0.45);
        Fx.prism(g, bx + u * 1.5, by - u * 1.5, u * 1.6, u * 1.5, u * 0.35, '#a0703c', { r: 2 });
        g.strokeStyle = 'rgba(60, 34, 14, .6)'; g.lineWidth = Math.max(1, u * 0.08);
        g.beginPath(); g.moveTo(bx + u * 1.5, by - u * 1.5); g.lineTo(bx + u * 3.1, by); g.moveTo(bx + u * 3.1, by - u * 1.5); g.lineTo(bx + u * 1.5, by); g.stroke();
        for (const [dx, dy, k2] of [[0, 0, 1], [u * 0.9, u * 0.35, 0.9]]) {
          const rx = u * 0.6 * k2, top = by + dy - u * 1.7 * k2;
          Fx.cylinder(g, bx + dx, top, rx, u * 1.7 * k2 - rx * 0.32, '#8a5a2b', { capColor: '#a8743d' });
          g.strokeStyle = '#3a3a40'; g.lineWidth = Math.max(1, u * 0.1);
          for (const t of [0.25, 0.75]) { g.beginPath(); g.ellipse(bx + dx, top + u * 1.7 * k2 * t, rx, rx * 0.3, 0, 0, Math.PI); g.stroke(); }
        }
        const br = Math.min(fgH * 0.2, W * 0.13);
        const stone = mixc('#9a958a', '#6e6478', tint);
        rock(g, W * 0.07, H - fgH * 0.06, br * 1.3, stone);
        rock(g, W * 0.2, H - fgH * 0.02, br * 0.8, shade(stone, -0.08));
        rock(g, W * 0.95, H - fgH * 0.1, br * 1.1, stone);
        for (const [x, y, rr] of [[W * 0.3, H - fgH * 0.08, 0.6], [W * 0.82, H - fgH * 0.2, 0.55], [W * 0.88, H - fgH * 0.02, 0.7]]) {
          bush(g, x, y, br * rr * 1.2, mixc('#5aa83f', '#46703a', tint));
        }
      }
      // a soft darker band near the bottom edge pulls the eye up to the lane
      const bot = g.createLinearGradient(0, H - fgH * 0.4, 0, H);
      bot.addColorStop(0, 'rgba(20, 30, 10, 0)');
      bot.addColorStop(1, 'rgba(20, 30, 10, .35)');
      g.fillStyle = bot;
      g.fillRect(0, H - fgH * 0.4, W, fgH * 0.4);
    }
  }

  // A baked layer covering the css rect (x, y, w, h); painters draw in canvas css coordinates.
  function layer(name, key, x, y, w, h, paint) {
    if (layers[name + 'Key'] !== key) {
      const c = offscreen(w * f.dpr, h * f.dpr);
      const g = c.getContext('2d');
      g.setTransform(f.dpr, 0, 0, f.dpr, -x * f.dpr, -y * f.dpr);
      paint(g);
      layers[name] = { c, x, y, w: c.width / f.dpr, h: c.height / f.dpr };
      layers[name + 'Key'] = key;
    }
    return layers[name];
  }
  const blit = (l) => ctx.drawImage(l.c, l.x, l.y, l.w, l.h);

  // ── The castle: a round keep with a wooden hoarding and slate roof, the curtain wall with bevelled stones,
  // a gate, torches and banners, cracks and missing stones as the wall loses HP ──
  const COURSE = 0.62;
  let stones = null;
  function wallStones() {
    if (stones) return stones;
    stones = [];
    let n = 0;
    for (let row = 0, y = 0; y < C.WALL_TOP - 0.05; row++, y += COURSE) {
      let x = row % 2 ? -0.35 : 0;
      while (x < C.WALL_X) {
        const w = 0.55 + hash(++n) * 0.5;
        const x0 = Math.max(0, x), x1 = Math.min(C.WALL_X, x + w);
        if (x1 - x0 > 0.12) stones.push({ x0, x1, y0: y, y1: Math.min(C.WALL_TOP, y + COURSE), tone: hash(n + 1000), id: n });
        x += w;
      }
    }
    return stones;
  }

  function stoneFace(g, x, y, w, h, base, s) {
    const m = Math.max(0.6, s * 0.05);
    const grd = g.createLinearGradient(x, y, x + w * 0.7, y + h);
    grd.addColorStop(0, shade(base, 0.22));
    grd.addColorStop(0.5, base);
    grd.addColorStop(1, shade(base, -0.22));
    g.fillStyle = grd;
    Fx.rrect(g, x + m / 2, y + m / 2, w - m, h - m, Math.min(s * 0.1, 3));
    g.fill();
    if (s > 7) {
      g.fillStyle = 'rgba(255, 250, 235, .22)';
      g.fillRect(x + m, y + m / 2, w - m * 2, Math.max(0.7, s * 0.05));
      g.fillStyle = 'rgba(20, 12, 30, .22)';
      g.fillRect(x + m, y + h - m / 2 - Math.max(0.7, s * 0.06), w - m * 2, Math.max(0.7, s * 0.06));
    }
  }

  // A chosen set of stones to knock out at a damage level (near the right face, where the monsters strike).
  function brokenStones(level) {
    const list = wallStones().filter((st) => st.x1 > 1.2 && st.y0 > 0.4 && !(st.x1 > 0.7 && st.x0 < 2.3 && st.y0 < 2.6));
    list.sort((a, b) => a.tone - b.tone);
    return new Set(list.slice(0, [0, 1, 3, 6, 10][level]).map((st) => st.id));
  }

  function paintCastleBack(g, s, level, fort, tint) {
    const stoneCol = mixc('#a59c8b', '#8f8090', tint * 0.6);
    // ── the keep: a round tower behind the wall, partly off the left edge ──
    const cx = -0.55, rx = 1.6, top = 11.6;
    const T = P(cx, top), B = P(cx, 0), rp = rx * s;
    g.save();
    g.beginPath(); g.rect(T.x - rp, T.y, rp * 2, B.y - T.y); g.clip();
    g.fillStyle = shade(stoneCol, -0.35);
    g.fillRect(T.x - rp, T.y, rp * 2, B.y - T.y);
    let n = 0;
    for (let y = 0, row = 0; y < top; y += COURSE, row++) {
      // stones narrow towards the edges of the round body
      for (let a = -Math.PI / 2 + (row % 2 ? 0.18 : 0); a < Math.PI / 2; a += 0.36) {
        const a0 = Math.max(-Math.PI / 2, a), a1 = Math.min(Math.PI / 2, a + 0.36);
        const x0 = T.x + Math.sin(a0) * rp, x1 = T.x + Math.sin(a1) * rp;
        const yy = P(0, y + COURSE).y;
        if (x1 - x0 > 1) stoneFace(g, x0, yy, x1 - x0, COURSE * s, shade(stoneCol, (hash(++n) - 0.5) * 0.18), s);
      }
    }
    const cyl = g.createLinearGradient(T.x - rp, 0, T.x + rp, 0);
    cyl.addColorStop(0, 'rgba(20, 12, 30, .25)');
    cyl.addColorStop(0.3, 'rgba(255, 245, 225, .12)');
    cyl.addColorStop(0.55, 'rgba(20, 12, 30, 0)');
    cyl.addColorStop(1, 'rgba(20, 12, 30, .55)');
    g.fillStyle = cyl;
    g.fillRect(T.x - rp, T.y, rp * 2, B.y - T.y);
    // arrow slits with warm light inside
    for (const [wx, wy] of [[-0.2, 5.2], [0.25, 9.0]]) {
      const q = P(cx + wx, wy);
      g.fillStyle = shade(stoneCol, 0.25);
      Fx.rrect(g, q.x - s * 0.22, q.y - s * 0.95, s * 0.44, s * 1.1, s * 0.2); g.fill();
      g.fillStyle = mixc('#2a1a14', '#ffb45a', tint * 0.8);
      Fx.rrect(g, q.x - s * 0.1, q.y - s * 0.8, s * 0.2, s * 0.85, s * 0.1); g.fill();
    }
    g.restore();
    // wooden hoarding round the top of the keep
    const hb = P(cx, top), ht = P(cx, top + 1.3), hr = (rx + 0.25) * s;
    const wood = mixc('#8a5a32', '#6a4a40', tint * 0.5);
    const hg = g.createLinearGradient(hb.x - hr, 0, hb.x + hr, 0);
    hg.addColorStop(0, shade(wood, 0.1));
    hg.addColorStop(0.3, shade(wood, 0.3));
    hg.addColorStop(1, shade(wood, -0.5));
    g.fillStyle = hg;
    g.fillRect(hb.x - hr, ht.y, hr * 2, hb.y - ht.y);
    g.strokeStyle = withAlpha('#2a160a', 0.45);
    g.lineWidth = Math.max(0.6, s * 0.05);
    for (let a = -1.4; a <= 1.4; a += 0.2) {
      const x = hb.x + Math.sin(a) * hr;
      g.beginPath(); g.moveTo(x, ht.y); g.lineTo(x, hb.y); g.stroke();
    }
    g.fillStyle = withAlpha('#1a0e06', 0.55); // corbels under it
    for (let a = -1.3; a <= 1.3; a += 0.42) {
      const x = hb.x + Math.sin(a) * rx * s;
      g.beginPath(); g.moveTo(x - s * 0.15, hb.y); g.lineTo(x + s * 0.15, hb.y); g.lineTo(x, hb.y + s * 0.5); g.closePath(); g.fill();
    }
    g.fillStyle = withAlpha('#1a0e06', 0.7); // loopholes in the planks
    for (const a of [-0.9, -0.2, 0.5]) {
      const x = hb.x + Math.sin(a) * hr;
      g.fillRect(x - s * 0.08, ht.y + s * 0.35, s * 0.16, s * 0.5);
    }
    // the slate roof
    const apex = P(cx, top + 5.0), rr = (rx + 0.5) * s, eave = ht.y;
    const slate = mixc('#4d6a9a', '#4a3f6e', tint);
    const rg = g.createLinearGradient(hb.x - rr, 0, hb.x + rr, 0);
    rg.addColorStop(0, shade(slate, 0.15));
    rg.addColorStop(0.32, shade(slate, 0.45));
    rg.addColorStop(0.6, slate);
    rg.addColorStop(1, shade(slate, -0.5));
    g.fillStyle = rg;
    g.beginPath();
    g.moveTo(apex.x, apex.y);
    g.lineTo(hb.x + rr, eave);
    g.quadraticCurveTo(hb.x, eave + s * 0.45, hb.x - rr, eave);
    g.closePath();
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = withAlpha('#0e0a1e', 0.25);
    g.lineWidth = Math.max(0.6, s * 0.05);
    for (let k = 1; k < 7; k++) {
      const y = apex.y + (eave - apex.y) * (k / 7), w = rr * (k / 7);
      g.beginPath(); g.moveTo(hb.x - w, y); g.quadraticCurveTo(hb.x, y + s * 0.35 * (k / 7), hb.x + w, y); g.stroke();
    }
    g.restore();
    // a long banner hanging from the hoarding
    const bn = P(cx + 0.55, top - 0.1), bw = s * 0.95, bh = s * 3.4;
    const red = mixc('#c4352b', '#9a2a3a', tint * 0.5);
    const bg2 = g.createLinearGradient(bn.x - bw / 2, 0, bn.x + bw / 2, 0);
    bg2.addColorStop(0, shade(red, 0.25));
    bg2.addColorStop(0.5, red);
    bg2.addColorStop(1, shade(red, -0.4));
    g.fillStyle = bg2;
    g.beginPath();
    g.moveTo(bn.x - bw / 2, bn.y); g.lineTo(bn.x + bw / 2, bn.y); g.lineTo(bn.x + bw / 2, bn.y + bh);
    g.lineTo(bn.x, bn.y + bh - s * 0.5); g.lineTo(bn.x - bw / 2, bn.y + bh); g.closePath(); g.fill();
    g.fillStyle = '#f2c14e'; // a gold emblem: a tower
    const ey = bn.y + bh * 0.4, eu = bw * 0.14;
    g.fillRect(bn.x - eu * 1.5, ey - eu * 2, eu * 3, eu * 3.2);
    for (const dx of [-1.5, -0.25, 1]) g.fillRect(bn.x + dx * eu, ey - eu * 2.8, eu * 0.5 + 0.5, eu);
    g.fillStyle = shade(red, -0.3);
    g.fillRect(bn.x - eu * 0.4, ey - eu * 0.2, eu * 0.8, eu * 1.4);
    g.fillStyle = shade('#f2c14e', -0.2);
    g.fillRect(bn.x - bw / 2, bn.y, bw, Math.max(1, s * 0.12));

    // ── the curtain wall ──
    const A = P(0, C.WALL_TOP), Z = P(C.WALL_X, 0);
    // earth bank and foundation under the wall
    const bank = mixc('#7a6448', '#5a4a48', tint);
    g.fillStyle = bank;
    g.beginPath();
    g.moveTo(A.x - s * 0.5, Z.y + s * 0.25);
    g.quadraticCurveTo(Z.x + s * 0.3, Z.y - s * 0.4, Z.x + s * 1.5, Z.y + s * 0.3);
    g.lineTo(A.x - s * 0.5, Z.y + s * 0.6);
    g.closePath();
    g.fill();
    g.fillStyle = shade(stoneCol, -0.55); // mortar
    g.fillRect(A.x, A.y, Z.x - A.x, Z.y - A.y);
    const broken = brokenStones(level);
    for (const st of wallStones()) {
      const q0 = P(st.x0, st.y1), q1 = P(st.x1, st.y0);
      if (broken.has(st.id)) {
        // a knocked-out stone: a dark cavity with a lit lower lip
        g.fillStyle = '#2a221c';
        g.fillRect(q0.x, q0.y, q1.x - q0.x, q1.y - q0.y);
        const cg = g.createLinearGradient(q0.x, q0.y, q0.x, q1.y);
        cg.addColorStop(0, 'rgba(0,0,0,.5)');
        cg.addColorStop(1, 'rgba(120,100,80,.35)');
        g.fillStyle = cg;
        g.fillRect(q0.x, q0.y, q1.x - q0.x, q1.y - q0.y);
        continue;
      }
      stoneFace(g, q0.x, q0.y, q1.x - q0.x, q1.y - q0.y, shade(stoneCol, (st.tone - 0.5) * 0.22), s);
    }
    // the gate: an arched recess with a plank door and iron bands
    const gl = P(0.72, 0), gr = P(2.28, 0), gw = gr.x - gl.x, gTop = P(0, 1.75).y, arcR = gw / 2;
    const gateCx = (gl.x + gr.x) / 2;
    g.fillStyle = shade(stoneCol, 0.05); // voussoirs
    g.beginPath(); g.arc(gateCx, gTop, arcR + s * 0.38, Math.PI, 0); g.lineTo(gr.x + s * 0.38, gl.y); g.lineTo(gl.x - s * 0.38, gl.y); g.closePath(); g.fill();
    g.strokeStyle = shade(stoneCol, -0.55);
    g.lineWidth = Math.max(0.6, s * 0.05);
    for (let a = Math.PI; a <= TAU + 0.01; a += Math.PI / 6) {
      g.beginPath(); g.moveTo(gateCx + Math.cos(a) * arcR, gTop + Math.sin(a) * arcR); g.lineTo(gateCx + Math.cos(a) * (arcR + s * 0.38), gTop + Math.sin(a) * (arcR + s * 0.38)); g.stroke();
    }
    g.save();
    g.beginPath(); g.arc(gateCx, gTop, arcR, Math.PI, 0); g.lineTo(gr.x, gl.y); g.lineTo(gl.x, gl.y); g.closePath(); g.clip();
    const dg = g.createLinearGradient(gl.x, 0, gr.x, 0);
    dg.addColorStop(0, shade(wood, -0.1)); dg.addColorStop(0.4, shade(wood, 0.15)); dg.addColorStop(1, shade(wood, -0.35));
    g.fillStyle = dg;
    g.fillRect(gl.x, gTop - arcR, gw, gl.y - gTop + arcR);
    g.strokeStyle = withAlpha('#2a160a', 0.55);
    for (let k = 1; k < 5; k++) { const x = gl.x + gw * k / 5; g.beginPath(); g.moveTo(x, gTop - arcR); g.lineTo(x, gl.y); g.stroke(); }
    for (const yy of [0.5, 1.5]) { // iron bands with studs
      const q = P(0, yy);
      const ig = g.createLinearGradient(0, q.y - s * 0.12, 0, q.y + s * 0.12);
      ig.addColorStop(0, '#9aa3ad'); ig.addColorStop(0.5, '#5d646e'); ig.addColorStop(1, '#2e3238');
      g.fillStyle = ig;
      g.fillRect(gl.x, q.y - s * 0.12, gw, s * 0.24);
      g.fillStyle = '#c9d0d8';
      for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(gl.x + gw * (k + 0.5) / 5, q.y, Math.max(0.6, s * 0.05), 0, TAU); g.fill(); }
    }
    const ao = g.createLinearGradient(gl.x, gTop - arcR, gl.x + gw * 0.5, gTop + arcR); // the recess shadow from the top left
    ao.addColorStop(0, 'rgba(10, 6, 20, .55)'); ao.addColorStop(1, 'rgba(10, 6, 20, 0)');
    g.fillStyle = ao;
    g.fillRect(gl.x, gTop - arcR, gw, gl.y - gTop + arcR);
    g.restore();
    // torch brackets
    for (const tx of [0.32, 2.68]) {
      const q = P(tx, 2.75);
      g.fillStyle = '#3a3a40';
      g.fillRect(q.x - s * 0.06, q.y, s * 0.12, s * 0.5);
      g.fillStyle = '#6b4423';
      g.fillRect(q.x - s * 0.09, q.y - s * 0.45, s * 0.18, s * 0.5);
    }
    // the wall banner, torn when the wall is in a bad way
    const wb = P(1.5, C.WALL_TOP - 0.15), ww = s * 1.1, wh = s * (level >= 4 ? 1.7 : 2.6);
    g.fillStyle = bg2;
    g.beginPath();
    g.moveTo(wb.x - ww / 2, wb.y); g.lineTo(wb.x + ww / 2, wb.y);
    if (level >= 4) { g.lineTo(wb.x + ww / 2, wb.y + wh); g.lineTo(wb.x + ww * 0.2, wb.y + wh * 0.75); g.lineTo(wb.x - ww * 0.1, wb.y + wh * 1.05); g.lineTo(wb.x - ww / 2, wb.y + wh * 0.8); }
    else { g.lineTo(wb.x + ww / 2, wb.y + wh); g.lineTo(wb.x, wb.y + wh - s * 0.45); g.lineTo(wb.x - ww / 2, wb.y + wh); }
    g.closePath(); g.fill();
    g.fillStyle = '#f2c14e';
    g.beginPath(); g.arc(wb.x, wb.y + wh * 0.42, ww * 0.18, 0, TAU); g.fill();
    g.fillStyle = shade('#f2c14e', -0.2);
    g.fillRect(wb.x - ww / 2, wb.y, ww, Math.max(1, s * 0.12));
    // fortification: iron straps along the right face and bands across
    if (fort > 0) {
      const iron = (x0, y0, x1, y1) => {
        const ig = g.createLinearGradient(x0, y0, x1, y1);
        ig.addColorStop(0, '#a9b2bd'); ig.addColorStop(0.5, '#646c77'); ig.addColorStop(1, '#30353d');
        g.fillStyle = ig;
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
      };
      const r0 = P(C.WALL_X - 0.28, C.WALL_TOP), r1 = P(C.WALL_X, 0);
      iron(r0.x, r0.y, r1.x, r1.y);
      const bands = fort >= 3 ? [3.6, 6.2] : fort >= 2 ? [4.8] : [];
      for (const yy of bands) { const q = P(0, yy + 0.15), q2 = P(C.WALL_X, yy - 0.15); iron(q.x, q.y, q2.x, q2.y); }
      g.fillStyle = '#dfe5ec';
      for (let yy = 0.5; yy < C.WALL_TOP; yy += 0.9) { const q = P(C.WALL_X - 0.14, yy); g.beginPath(); g.arc(q.x, q.y, Math.max(0.7, s * 0.06), 0, TAU); g.fill(); }
    }
    // cracks spreading from the right face
    const crackN = [0, 2, 4, 6, 9][level];
    g.save();
    g.beginPath(); g.rect(A.x, A.y, Z.x - A.x, Z.y - A.y); g.clip();
    g.lineJoin = 'round';
    for (let k = 0; k < crackN; k++) {
      let x = C.WALL_X - hash(k + 70) * 1.6, y = 1 + hash(k + 80) * 6;
      const pts = [[x, y]];
      for (let j = 0; j < 5; j++) { x += (hash(k * 7 + j) - 0.6) * 0.5; y -= 0.25 + hash(k * 5 + j + 3) * 0.35; pts.push([x, y]); }
      for (const [col, off, lw] of [['rgba(255,245,225,.3)', 1, 0.07], ['rgba(25,14,8,.85)', 0, 0.08]]) {
        g.strokeStyle = col;
        g.lineWidth = Math.max(0.8, s * lw);
        g.beginPath();
        pts.forEach(([px, py], j) => { const q = P(px, py); if (j) g.lineTo(q.x + off, q.y + off); else g.moveTo(q.x + off, q.y + off); });
        g.stroke();
      }
    }
    g.restore();
    // soot and rubble when it's bad
    if (level >= 3) {
      const so = g.createRadialGradient(Z.x, A.y + s * 2, 0, Z.x, A.y + s * 2, s * 3);
      so.addColorStop(0, 'rgba(20,14,10,.45)');
      so.addColorStop(1, 'rgba(20,14,10,0)');
      g.fillStyle = so;
      g.fillRect(A.x, A.y, Z.x - A.x, Z.y - A.y);
    }
    // shading: the right side turns away from the light, the foot sits in ambient occlusion
    const face = g.createLinearGradient(A.x, 0, Z.x, 0);
    face.addColorStop(0, 'rgba(255,245,225,.08)');
    face.addColorStop(0.6, 'rgba(20,12,30,0)');
    face.addColorStop(1, 'rgba(20,12,30,.32)');
    g.fillStyle = face;
    g.fillRect(A.x, A.y, Z.x - A.x, Z.y - A.y);
    const foot = g.createLinearGradient(0, Z.y - s * 1.2, 0, Z.y);
    foot.addColorStop(0, 'rgba(20,12,30,0)');
    foot.addColorStop(1, 'rgba(20,12,30,.35)');
    g.fillStyle = foot;
    g.fillRect(A.x, Z.y - s * 1.2, Z.x - A.x, s * 1.2);
    // the walkway top and the inner parapet the archer stands behind
    const wt = P(-0.1, C.WALL_TOP + 0.12);
    Fx.prism(g, wt.x, wt.y, (C.WALL_X + 0.2) * s, s * 0.22, s * 0.25, stoneCol, { r: Math.min(2, s * 0.08) });
    for (let k = 0; k < [0, 1, 3, 5, 8][level]; k++) {
      const x = C.WALL_X + 0.2 + hash(k + 150) * 1.6, sz = 0.18 + hash(k + 160) * 0.3;
      const q = P(x, 0);
      Fx.shadow(g, q.x, q.y + 1, sz * s * 1.2, sz * s * 0.35, 0.4);
      Fx.block(g, q.x - sz * s / 2, q.y - sz * s * 0.85, sz * s, sz * s * 0.85, Math.min(2, s * 0.06), shade(stoneCol, (hash(k) - 0.5) * 0.2));
    }
  }

  // Merlons in front of the archer; the right one chips off at level 3, the left at level 4.
  function paintCastleFront(g, s, level, tint) {
    const stoneCol = mixc('#a59c8b', '#8f8090', tint * 0.6);
    const p0 = P(-0.05, C.WALL_TOP + 0.5);
    Fx.prism(g, p0.x, p0.y, (C.WALL_X + 0.1) * s, s * 0.5, s * 0.18, shade(stoneCol, 0.04), { r: Math.min(2, s * 0.06) });
    const merlon = (x0, x1, chipped) => {
      const q = P(x0, C.WALL_TOP + 1.3), w = (x1 - x0) * s, h = s * 0.8;
      if (!chipped) { Fx.prism(g, q.x, q.y, w, h, s * 0.18, stoneCol, { r: Math.min(2, s * 0.06) }); return; }
      g.save();
      g.beginPath();
      g.moveTo(q.x - 1, q.y + h + 1);
      g.lineTo(q.x - 1, q.y + h * 0.15);
      g.lineTo(q.x + w * 0.3, q.y + h * 0.35);
      g.lineTo(q.x + w * 0.55, q.y + h * 0.1);
      g.lineTo(q.x + w * 0.75, q.y + h * 0.55);
      g.lineTo(q.x + w + 1, q.y + h * 0.45);
      g.lineTo(q.x + w + 1, q.y + h + 1);
      g.closePath();
      g.clip();
      Fx.prism(g, q.x, q.y, w, h, s * 0.18, stoneCol, { r: Math.min(2, s * 0.06) });
      g.restore();
    };
    merlon(-0.05, 0.75, level >= 4);
    merlon(2.45, 3.08, level >= 3);
    const fl = g.createLinearGradient(p0.x, 0, p0.x + C.WALL_X * s, 0);
    fl.addColorStop(0.6, 'rgba(20,12,30,0)');
    fl.addColorStop(1, 'rgba(20,12,30,.25)');
    g.fillStyle = fl;
    g.fillRect(p0.x, P(0, C.WALL_TOP + 1.3).y, (C.WALL_X + 0.15) * s, s * 1.4);
  }

  function drawCastle(r, front) {
    const s = f.scale, tint = Math.round(waveTint() * 4) / 4;
    const level = wallLevel(r);
    const fort = r ? Math.max(0, Math.min(3, Math.round((r.wallMax - C.WALL_HP) / 20))) : 0;
    const key = `${f.w}x${f.h}:${f.gy}:${level}:${fort}:${tint}`;
    // only the rectangle the castle covers is baked and blitted
    if (front) {
      const y0 = Math.floor(P(0, C.WALL_TOP + 1.7).y), y1 = Math.ceil(P(0, C.WALL_TOP - 0.2).y);
      blit(layer('front', key, 0, y0, P(C.WALL_X + 0.6, 0).x, y1 - y0, (g) => paintCastleFront(g, s, level, tint)));
    } else {
      const y0 = Math.max(0, Math.floor(P(0, 17.2).y)), y1 = Math.min(f.cssH, Math.ceil(f.gy + s * 1.2 + 2));
      blit(layer('castle', key, 0, y0, P(C.WALL_X + 2.4, 0).x, y1 - y0, (g) => paintCastleBack(g, s, level, fort, tint)));
    }
  }

  // The flag on the keep and the torch flames: alive every frame.
  function drawCastleLive() {
    const s = f.scale;
    const pole = P(-0.55, 16.6), top = P(-0.55, 18.6);
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.beginPath(); ctx.moveTo(pole.x, pole.y); ctx.lineTo(top.x, top.y); ctx.stroke();
    const fw = s * 1.9, fh = s * 0.95;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    const N = 8;
    for (let k = 1; k <= N; k++) { const u = k / N; ctx.lineTo(top.x + fw * u, top.y + Math.sin(time * 5 - u * 4) * s * 0.18 * u + s * 0.08 * u); }
    for (let k = N; k >= 0; k--) { const u = k / N; ctx.lineTo(top.x + fw * u, top.y + fh - u * s * 0.15 + Math.sin(time * 5 - u * 4) * s * 0.18 * u); }
    ctx.closePath();
    const fg = ctx.createLinearGradient(top.x, top.y, top.x + fw, top.y + fh);
    fg.addColorStop(0, '#ff6a50');
    fg.addColorStop(1, '#a8241c');
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(top.x, top.y + fh * 0.4, fw * 0.6, Math.max(1, fh * 0.16));
    Fx.sphere(ctx, top.x, top.y, Math.max(1.5, s * 0.14), '#ffd34d', { gloss: false });
  }

  function drawTorches(glowOnly) {
    const s = f.scale, tint = waveTint();
    for (const [k, tx] of [[0, 0.32], [1, 2.68]]) {
      const q = P(tx, 3.25);
      const fl = Math.sin(time * 13 + k * 2) * 0.5 + Math.sin(time * 7.3 + k) * 0.5;
      if (glowOnly) { Fx.glow(ctx, q.x, q.y, s * (1.6 + tint * 1.4 + fl * 0.2), '#ffa040', 0.35 + tint * 0.4); continue; }
      const h = s * (0.55 + fl * 0.08);
      ctx.fillStyle = '#ff8a2a';
      ctx.beginPath();
      ctx.moveTo(q.x - s * 0.16, q.y);
      ctx.quadraticCurveTo(q.x - s * 0.12, q.y - h * 0.6, q.x + fl * s * 0.06, q.y - h);
      ctx.quadraticCurveTo(q.x + s * 0.14, q.y - h * 0.5, q.x + s * 0.16, q.y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffe9a0';
      ctx.beginPath(); ctx.ellipse(q.x, q.y - h * 0.25, s * 0.07, h * 0.3, 0, 0, TAU); ctx.fill();
    }
  }

  // ── Small lit-shape helpers in metre space (the sprite and archer painters draw with 1 unit = 1 m) ──
  function limb(g, x0, y0, x1, y1, w, col) {
    g.lineCap = 'round';
    g.strokeStyle = shade(col, -0.55);
    g.lineWidth = w + 0.06;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = col;
    g.lineWidth = w;
    g.stroke();
    g.strokeStyle = withAlpha(shade(col, 0.5), 0.55);
    g.lineWidth = w * 0.3;
    g.beginPath(); g.moveTo(x0 - w * 0.18, y0 - w * 0.1); g.lineTo(x1 - w * 0.18, y1 - w * 0.1); g.stroke();
  }

  function torso(g, x, y, w, h, r, col) {
    const grd = g.createLinearGradient(x, y, x + w * 0.9, y + h);
    grd.addColorStop(0, shade(col, 0.3));
    grd.addColorStop(0.45, col);
    grd.addColorStop(1, shade(col, -0.45));
    g.fillStyle = grd;
    Fx.rrect(g, x, y, w, h, r);
    g.fill();
    g.strokeStyle = shade(col, -0.65);
    g.lineWidth = 0.04;
    g.stroke();
  }

  function ball(g, x, y, r, col, gloss) {
    Fx.sphere(g, x, y, r, col, { gloss: !!gloss, shine: 0.45 });
    g.strokeStyle = withAlpha(shade(col, -0.65), 0.8);
    g.lineWidth = 0.035;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
  }

  function metalGrad(g, x0, y0, x1, y1, tint = '#b9c3d3') {
    const grd = g.createLinearGradient(x0, y0, x1, y1);
    grd.addColorStop(0, shade(tint, 0.7));
    grd.addColorStop(0.35, tint);
    grd.addColorStop(0.55, shade(tint, -0.45));
    grd.addColorStop(1, shade(tint, -0.15));
    return grd;
  }

  // A blade from the hand (hx, hy) along (dx, dy) of length len.
  function blade(g, hx, hy, dx, dy, len, wid) {
    const nx = -dy, ny = dx;
    limb(g, hx - dx * 0.1, hy - dy * 0.1, hx + dx * 0.08, hy + dy * 0.08, 0.07, '#5a3a1e');
    g.strokeStyle = '#8a7a50';
    g.lineWidth = 0.06;
    g.beginPath(); g.moveTo(hx + dx * 0.1 - nx * 0.13, hy + dy * 0.1 - ny * 0.13); g.lineTo(hx + dx * 0.1 + nx * 0.13, hy + dy * 0.1 + ny * 0.13); g.stroke();
    const bx = hx + dx * 0.12, by = hy + dy * 0.12, tx = hx + dx * len, ty = hy + dy * len;
    g.fillStyle = metalGrad(g, bx - nx * wid, by - ny * wid, bx + nx * wid, by + ny * wid);
    g.beginPath();
    g.moveTo(bx - nx * wid, by - ny * wid);
    g.lineTo(tx - nx * wid * 0.8 - dx * 0.1, ty - ny * wid * 0.8 - dy * 0.1);
    g.lineTo(tx, ty);
    g.lineTo(tx + nx * wid - dx * 0.12, ty + ny * wid - dy * 0.12);
    g.lineTo(bx + nx * wid, by + ny * wid);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(40, 44, 56, .7)';
    g.lineWidth = 0.025;
    g.stroke();
  }

  // ── Monster painters: feet at (0, 0), facing left (towards the wall), p = animation phase 0…1 ──
  function paintGrunt(g, p, atk) {
    const T = p * TAU;
    const sw = atk ? Math.sin(T) * 0.12 : Math.sin(T) * 0.5;
    const bob = atk ? 0 : -Math.abs(Math.cos(T)) * 0.07;
    const skin = '#7cbf45', cloth = '#9a6236', boot = '#4a2e1c';
    const hip = -0.8 + bob;
    const leg = (side, col) => {
      const a = side * sw, fx0 = Math.sin(a) * 0.72, fy = hip + Math.cos(a) * 0.72;
      limb(g, side * 0.02, hip, fx0, Math.min(-0.08, fy - 0.02), 0.2, col);
      torso(g, fx0 - 0.18, -0.16 + Math.min(0, fy + 0.08), 0.3, 0.16, 0.07, boot);
    };
    leg(-1, shade(cloth, -0.35));
    limb(g, 0.16, -1.22 + bob, 0.32 + sw * 0.1, -0.86 + bob, 0.15, shade(skin, -0.3)); // back arm
    torso(g, -0.32, -1.38 + bob, 0.62, 0.68, 0.22, cloth);
    g.fillStyle = '#3a2416'; g.fillRect(-0.32, -0.9 + bob, 0.62, 0.1);
    g.fillStyle = '#f2c14e'; g.fillRect(-0.12, -0.91 + bob, 0.1, 0.12);
    leg(1, shade(cloth, -0.15));
    const hx = -0.05, hy = -1.63 + bob;
    g.fillStyle = shade(skin, -0.2); // the ear
    g.beginPath(); g.moveTo(hx + 0.18, hy - 0.05); g.lineTo(hx + 0.55, hy - 0.22); g.lineTo(hx + 0.2, hy + 0.1); g.closePath(); g.fill();
    ball(g, hx, hy, 0.3, skin);
    ball(g, hx - 0.17, hy - 0.01, 0.08, '#ffffff');
    g.fillStyle = '#1a1020'; g.beginPath(); g.arc(hx - 0.2, hy, 0.04, 0, TAU); g.fill();
    g.strokeStyle = '#2a1a10'; g.lineWidth = 0.05;
    g.beginPath(); g.moveTo(hx - 0.3, hy - 0.13); g.lineTo(hx - 0.08, hy - 0.06); g.stroke();
    g.fillStyle = '#fff6e0'; g.beginPath(); g.moveTo(hx - 0.22, hy + 0.13); g.lineTo(hx - 0.17, hy + 0.04); g.lineTo(hx - 0.13, hy + 0.14); g.fill();
    g.fillStyle = metalGrad(g, hx - 0.3, hy - 0.3, hx + 0.3, hy); // a dented cap
    g.beginPath(); g.arc(hx + 0.02, hy - 0.04, 0.32, Math.PI * 1.03, TAU * 0.99); g.closePath(); g.fill();
    g.fillStyle = '#5d646e'; g.fillRect(hx - 0.32, hy - 0.08, 0.66, 0.06);
    // the sword arm
    let hand, dir;
    if (atk) {
      const k = 0.5 + 0.5 * Math.sin(T);
      hand = [-0.2 - 0.35 * k, -1.62 + 0.62 * k];
      const a = -1.28 - 2.15 * k; // from raised overhead to a forward chop
      dir = [Math.cos(a), Math.sin(a)];
    } else {
      hand = [-0.45, -1.0 + bob + Math.sin(T) * 0.04];
      dir = [-0.55, -0.83];
    }
    const dl = Math.hypot(dir[0], dir[1]);
    blade(g, hand[0], hand[1], dir[0] / dl, dir[1] / dl, 0.62, 0.065);
    limb(g, -0.12, -1.22 + bob, hand[0], hand[1], 0.15, skin);
    ball(g, hand[0], hand[1], 0.08, skin);
  }

  function paintShield(g, p, atk) {
    const T = p * TAU;
    const sw = atk ? Math.sin(T) * 0.1 : Math.sin(T) * 0.42;
    const bob = atk ? 0 : -Math.abs(Math.cos(T)) * 0.06;
    const skin = '#9aa86a', cloth = '#a33b2c', mail = '#8a929e';
    const hip = -0.82 + bob;
    const leg = (side, col) => {
      const a = side * sw, fx0 = Math.sin(a) * 0.74, fy = hip + Math.cos(a) * 0.74;
      limb(g, side * 0.04, hip, fx0, Math.min(-0.08, fy - 0.02), 0.24, col);
      torso(g, fx0 - 0.2, -0.17 + Math.min(0, fy + 0.08), 0.34, 0.17, 0.07, '#3a2a1e');
    };
    leg(-1, '#4a3a30');
    // an axe over the back shoulder
    limb(g, 0.2, -1.25 + bob, 0.55, -1.9 + bob, 0.07, '#6b4423');
    g.fillStyle = metalGrad(g, 0.4, -2.1 + bob, 0.8, -1.8 + bob);
    g.beginPath(); g.moveTo(0.5, -1.8 + bob); g.quadraticCurveTo(0.82, -1.95 + bob, 0.72, -2.15 + bob); g.lineTo(0.56, -1.88 + bob); g.closePath(); g.fill();
    torso(g, -0.36, -1.45 + bob, 0.72, 0.74, 0.24, mail);
    torso(g, -0.34, -1.1 + bob, 0.68, 0.4, 0.12, cloth);
    g.fillStyle = '#3a2416'; g.fillRect(-0.36, -0.92 + bob, 0.72, 0.1);
    leg(1, '#5a483a');
    const hx = -0.04, hy = -1.68 + bob;
    ball(g, hx, hy, 0.3, skin);
    g.fillStyle = '#1a1020'; g.beginPath(); g.arc(hx - 0.2, hy + 0.01, 0.045, 0, TAU); g.fill();
    g.fillStyle = '#fff6e0'; g.beginPath(); g.moveTo(hx - 0.24, hy + 0.15); g.lineTo(hx - 0.2, hy + 0.04); g.lineTo(hx - 0.15, hy + 0.15); g.fill();
    // a steel helm with a nose guard
    g.fillStyle = metalGrad(g, hx - 0.34, hy - 0.36, hx + 0.34, hy + 0.1, '#aab4c2');
    g.beginPath(); g.arc(hx, hy - 0.03, 0.34, Math.PI, TAU); g.lineTo(hx + 0.34, hy + 0.1); g.lineTo(hx + 0.1, hy + 0.1); g.lineTo(hx + 0.1, hy - 0.03); g.closePath(); g.fill();
    g.fillRect(hx - 0.27, hy - 0.06, 0.06, 0.2);
    g.strokeStyle = 'rgba(30, 34, 44, .6)'; g.lineWidth = 0.03; g.stroke();
    // the round shield in front: planks, a metal rim and a boss
    const sx = -0.52 - (atk ? Math.max(0, Math.sin(T)) * 0.12 : 0), sy = -1.0 + bob;
    g.save();
    g.beginPath(); g.ellipse(sx, sy, 0.27, 0.62, 0, 0, TAU);
    const wg = g.createLinearGradient(sx - 0.27, sy - 0.6, sx + 0.27, sy + 0.6);
    wg.addColorStop(0, '#c9935a'); wg.addColorStop(0.5, '#9a6a3a'); wg.addColorStop(1, '#5e3c1e');
    g.fillStyle = wg;
    g.fill();
    g.clip();
    g.strokeStyle = 'rgba(50, 26, 10, .55)'; g.lineWidth = 0.025;
    for (const yy of [-0.32, -0.08, 0.16, 0.4]) { g.beginPath(); g.moveTo(sx - 0.3, sy + yy); g.lineTo(sx + 0.3, sy + yy); g.stroke(); }
    g.restore();
    g.strokeStyle = metalGrad(g, sx - 0.3, sy - 0.62, sx + 0.3, sy + 0.62, '#c4ccd8');
    g.lineWidth = 0.08;
    g.beginPath(); g.ellipse(sx, sy, 0.27, 0.62, 0, 0, TAU); g.stroke();
    g.fillStyle = '#e8edf3';
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; g.beginPath(); g.arc(sx + Math.cos(a) * 0.27, sy + Math.sin(a) * 0.62, 0.025, 0, TAU); g.fill(); }
    Fx.sphere(g, sx - 0.02, sy, 0.1, '#c4ccd8');
  }

  function paintFlyer(g, p) {
    const T = p * TAU, flap = Math.sin(T);
    const fur = '#4a3160', mem = '#6d4a8a';
    const by = -0.32 + flap * 0.05;
    for (const side of [1, -1]) { // far wing first
      const col = side > 0 ? shade(mem, -0.3) : mem;
      const tipX = side * (0.98 - Math.abs(flap) * 0.15), tipY = by - 0.1 - flap * 0.65;
      const midX = side * 0.55, midY = by - 0.25 - flap * 0.35;
      const grd = g.createLinearGradient(0, by - 0.6, 0, by + 0.4);
      grd.addColorStop(0, shade(col, 0.25)); grd.addColorStop(1, shade(col, -0.35));
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(side * 0.12, by - 0.12);
      g.quadraticCurveTo(midX, midY - 0.15, tipX, tipY);
      g.quadraticCurveTo(side * 0.82, by + 0.05 - flap * 0.3, side * 0.68, by + 0.02 - flap * 0.2);
      g.quadraticCurveTo(side * 0.55, by + 0.12 - flap * 0.22, side * 0.42, by + 0.05 - flap * 0.15);
      g.quadraticCurveTo(side * 0.28, by + 0.14 - flap * 0.1, side * 0.12, by + 0.08);
      g.closePath();
      g.fill();
      g.strokeStyle = shade(col, -0.6); g.lineWidth = 0.035;
      g.beginPath(); g.moveTo(side * 0.12, by - 0.12); g.quadraticCurveTo(midX, midY - 0.15, tipX, tipY); g.stroke();
      g.lineWidth = 0.02;
      for (const [fx0, fy] of [[0.68, 0.02], [0.42, 0.05]]) { g.beginPath(); g.moveTo(midX, midY - 0.1); g.lineTo(side * fx0, by + fy - flap * 0.18); g.stroke(); }
    }
    ball(g, 0, by, 0.22, fur);
    g.fillStyle = fur; // ears
    for (const sx of [-0.12, 0.08]) { g.beginPath(); g.moveTo(sx - 0.06, by - 0.18); g.lineTo(sx, by - 0.38); g.lineTo(sx + 0.07, by - 0.16); g.fill(); }
    g.fillStyle = '#ffe35a';
    for (const ex of [-0.1, 0.04]) { g.beginPath(); g.arc(ex, by - 0.04, 0.045, 0, TAU); g.fill(); }
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(-0.06, by + 0.08); g.lineTo(-0.04, by + 0.15); g.lineTo(-0.02, by + 0.08); g.fill();
  }

  function paintRam(g, p, atk) {
    const T = p * TAU;
    const wheelA = atk ? 0 : p * TAU / 6;
    const swing = atk ? -Math.max(0, Math.sin(T)) * 0.45 + 0.1 : Math.sin(T * 2) * 0.03;
    const wood = '#9a6a3a', dark = '#5e3c1e';
    // far wheels
    for (const wx of [-0.75, 0.8]) ball(g, wx + 0.12, -0.36, 0.3, shade(dark, -0.2));
    // the swinging log with an iron head
    const ly = -0.95, lx0 = -1.75 + swing, lx1 = 1.2 + swing;
    g.strokeStyle = '#3a2a1a'; g.lineWidth = 0.04;
    for (const x of [-0.5, 0.6]) { g.beginPath(); g.moveTo(x * 0.6, -1.62); g.lineTo(x + swing, ly - 0.1); g.stroke(); }
    const lg = g.createLinearGradient(0, ly - 0.17, 0, ly + 0.17);
    lg.addColorStop(0, '#c08a52'); lg.addColorStop(0.4, '#8a5a2b'); lg.addColorStop(1, '#4a2e14');
    g.fillStyle = lg;
    Fx.rrect(g, lx0, ly - 0.17, lx1 - lx0, 0.34, 0.15); g.fill();
    g.fillStyle = metalGrad(g, lx0 - 0.2, ly - 0.25, lx0 + 0.2, ly + 0.25, '#9aa4b1');
    g.beginPath(); g.moveTo(lx0 + 0.3, ly - 0.25); g.lineTo(lx0 - 0.15, ly - 0.2); g.quadraticCurveTo(lx0 - 0.35, ly, lx0 - 0.15, ly + 0.2); g.lineTo(lx0 + 0.3, ly + 0.25); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(30,34,44,.7)'; g.lineWidth = 0.03; g.stroke();
    // the hide-covered A-frame roof
    const roof = g.createLinearGradient(-1.2, -1.7, 1.0, -0.4);
    roof.addColorStop(0, '#c9a77a'); roof.addColorStop(0.5, '#a07f58'); roof.addColorStop(1, '#5e4630');
    g.fillStyle = roof;
    g.beginPath(); g.moveTo(-1.25, -0.55); g.lineTo(-0.15, -1.72); g.lineTo(1.3, -0.55); g.closePath(); g.fill();
    g.save(); g.clip();
    g.strokeStyle = 'rgba(60,36,16,.45)'; g.lineWidth = 0.03;
    for (let k = 0; k < 6; k++) { const y = -1.6 + k * 0.2; g.beginPath(); g.moveTo(-1.4, y); g.lineTo(1.4, y + 0.05); g.stroke(); }
    g.fillStyle = 'rgba(20,12,30,.35)';
    g.beginPath(); g.moveTo(-0.15, -1.72); g.lineTo(1.3, -0.55); g.lineTo(0.4, -0.55); g.closePath(); g.fill();
    g.restore();
    g.strokeStyle = dark; g.lineWidth = 0.1; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-1.25, -0.55); g.lineTo(-0.15, -1.72); g.lineTo(1.3, -0.55); g.stroke();
    // chassis beam
    torso(g, -1.35, -0.62, 2.7, 0.22, 0.06, wood);
    // near wheels with turning spokes
    for (const wx of [-0.8, 0.75]) {
      ball(g, wx, -0.34, 0.33, '#6b4423');
      g.fillStyle = '#3a2614'; g.beginPath(); g.arc(wx, -0.34, 0.24, 0, TAU); g.fill();
      g.strokeStyle = '#8a5a2b'; g.lineWidth = 0.06;
      for (let k = 0; k < 6; k++) { const a = wheelA - k * TAU / 6; g.beginPath(); g.moveTo(wx, -0.34); g.lineTo(wx + Math.cos(a) * 0.25, -0.34 + Math.sin(a) * 0.25); g.stroke(); }
      Fx.sphere(g, wx, -0.34, 0.08, '#9aa4b1');
    }
  }

  function paintBoss(g, p, atk) {
    const T = p * TAU;
    const sw = atk ? Math.sin(T) * 0.08 : Math.sin(T) * 0.32;
    const bob = atk ? 0 : -Math.abs(Math.cos(T)) * 0.1;
    const skin = '#6f9a3c', armor = '#5b3a7a', steel = '#8d97a8';
    const hip = -1.3 + bob;
    const leg = (side, col) => {
      const a = side * sw, fx0 = Math.sin(a) * 1.15, fy = hip + Math.cos(a) * 1.15;
      limb(g, side * 0.12, hip, fx0, Math.min(-0.15, fy - 0.05), 0.5, col);
      torso(g, fx0 - 0.38, -0.3 + Math.min(0, fy + 0.15), 0.62, 0.3, 0.12, '#2e2236');
    };
    leg(-1, shade(armor, -0.35));
    // the club: raised when walking, smashing down at the wall
    const k = atk ? 0.5 + 0.5 * Math.sin(T) : 0;
    const hand = atk ? [-0.6 - 0.5 * k, -3.0 + 1.3 * k] : [0.55, -2.15 + bob];
    const ca = atk ? -1.3 + 1.7 * k : -2.2;
    const dir = [Math.cos(ca), Math.sin(ca)];
    if (!atk) limb(g, 0.4, -2.35 + bob, hand[0], hand[1], 0.3, shade(skin, -0.25));
    const drawClub = () => {
      const ex = hand[0] + dir[0] * 1.4, ey = hand[1] + dir[1] * 1.4;
      limb(g, hand[0] - dir[0] * 0.2, hand[1] - dir[1] * 0.2, ex, ey, 0.16, '#6b4423');
      const cx = hand[0] + dir[0] * 1.2, cy = hand[1] + dir[1] * 1.2;
      g.fillStyle = '#c9d0d8';
      for (let j = 0; j < 7; j++) {
        const a = j / 7 * TAU;
        g.beginPath(); g.moveTo(cx + Math.cos(a + 0.25) * 0.24, cy + Math.sin(a + 0.25) * 0.24); g.lineTo(cx + Math.cos(a) * 0.48, cy + Math.sin(a) * 0.48); g.lineTo(cx + Math.cos(a - 0.25) * 0.24, cy + Math.sin(a - 0.25) * 0.24); g.fill();
      }
      ball(g, cx, cy, 0.32, '#7a5030');
    };
    if (!atk) drawClub();
    // the body: dark armour with a steel breastplate and pauldrons
    torso(g, -0.78, -2.65 + bob, 1.5, 1.5, 0.45, armor);
    g.fillStyle = metalGrad(g, -0.6, -2.5 + bob, 0.4, -1.6 + bob, steel);
    Fx.rrect(g, -0.62, -2.5 + bob, 0.95, 0.85, 0.3); g.fill();
    g.fillStyle = '#e8edf3';
    for (const [rx, ry] of [[-0.5, -2.38], [0.2, -2.38], [-0.5, -1.78], [0.2, -1.78]]) { g.beginPath(); g.arc(rx, ry + bob, 0.04, 0, TAU); g.fill(); }
    g.fillStyle = '#2a1a10'; g.fillRect(-0.78, -1.45 + bob, 1.5, 0.18);
    ball(g, -0.12, -1.36 + bob, 0.14, '#ffd34d', true);
    leg(1, shade(armor, -0.15));
    // head with a horned, crowned helm and glowing eyes
    const hx = -0.18, hy = -2.92 + bob;
    ball(g, hx, hy, 0.44, skin);
    g.fillStyle = '#fff6e0';
    for (const tx of [-0.38, -0.12]) { g.beginPath(); g.moveTo(hx + tx - 0.05, hy + 0.2); g.lineTo(hx + tx, hy + 0.0); g.lineTo(hx + tx + 0.05, hy + 0.2); g.fill(); }
    g.fillStyle = '#ff3a2a';
    g.beginPath(); g.ellipse(hx - 0.25, hy - 0.06, 0.08, 0.05, -0.2, 0, TAU); g.fill();
    g.fillStyle = '#ffe0a0'; g.beginPath(); g.arc(hx - 0.26, hy - 0.06, 0.025, 0, TAU); g.fill();
    g.fillStyle = metalGrad(g, hx - 0.46, hy - 0.5, hx + 0.46, hy, '#6a7080');
    g.beginPath(); g.arc(hx, hy - 0.05, 0.47, Math.PI, TAU); g.closePath(); g.fill();
    for (const side of [-1, 1]) { // horns
      const hg = g.createLinearGradient(hx + side * 0.4, hy - 0.2, hx + side * 0.8, hy - 0.9);
      hg.addColorStop(0, '#e8dcc0'); hg.addColorStop(1, '#8a7a5a');
      g.fillStyle = hg;
      g.beginPath();
      g.moveTo(hx + side * 0.36, hy - 0.3);
      g.quadraticCurveTo(hx + side * 0.85, hy - 0.35, hx + side * 0.75, hy - 0.95);
      g.quadraticCurveTo(hx + side * 0.62, hy - 0.5, hx + side * 0.3, hy - 0.12);
      g.closePath(); g.fill();
    }
    g.fillStyle = '#ffd34d';
    g.beginPath(); g.moveTo(hx - 0.3, hy - 0.42);
    for (let j = 0; j <= 4; j++) g.lineTo(hx - 0.3 + j * 0.15, hy - (j % 2 ? 0.48 : 0.7));
    g.lineTo(hx + 0.3, hy - 0.42); g.closePath(); g.fill();
    g.strokeStyle = '#a8741d'; g.lineWidth = 0.03; g.stroke();
    // pauldron over the front shoulder and the front arm
    if (atk) drawClub();
    ball(g, -0.55, -2.5 + bob, 0.3, steel, true);
    const fh = atk ? hand : [-0.85, -1.6 + bob];
    limb(g, -0.55, -2.4 + bob, fh[0], fh[1], 0.3, skin);
    ball(g, fh[0], fh[1], 0.16, skin);
  }

  const PAINT = { grunt: paintGrunt, shield: paintShield, flyer: paintFlyer, ram: paintRam, boss: paintBoss };
  // Sprite bounds in metres around the feet: [left, right, above, below].
  const BOX = { grunt: [-1.25, 0.8, 2.25, 0.12], shield: [-1.1, 1.0, 2.4, 0.12], flyer: [-1.15, 1.15, 1.25, 0.55], ram: [-2.6, 1.6, 1.95, 0.12], boss: [-2.6, 2.4, 4.4, 0.15] };
  const FRAMES = 8;
  let spriteCache = new Map(), spriteK = 0;
  function sprite(kind, frame, atk, flash) {
    const k = f.scale * f.dpr;
    if (k !== spriteK) { spriteCache = new Map(); spriteK = k; }
    const key = `${kind}:${frame}:${atk ? 1 : 0}:${flash ? 1 : 0}`;
    let c = spriteCache.get(key);
    if (!c) {
      const [l, r, top, bot] = BOX[kind];
      c = offscreen((r - l) * k + 2, (top + bot) * k + 2);
      const g = c.getContext('2d');
      g.setTransform(k, 0, 0, k, -l * k + 1, top * k + 1);
      PAINT[kind](g, frame / FRAMES, atk);
      if (flash) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = 'rgba(255, 250, 235, .8)';
        g.fillRect(0, 0, c.width, c.height);
      }
      spriteCache.set(key, c);
    }
    return c;
  }

  const RATE = { grunt: 1.7, shield: 1.35, flyer: 4.2, ram: 1, boss: 0.75 };
  function enemyFrame(e) {
    if (e.kind === 'ram' && !e.atWall) {
      const ang = (C.SPAWN_X - e.x) / 0.33;
      return Math.floor((ang / (TAU / 6)) * FRAMES) % FRAMES;
    }
    const rate = e.atWall && e.kind !== 'flyer' ? 1.1 : RATE[e.kind];
    const ph = time * rate + e.phase / TAU;
    return Math.floor((ph - Math.floor(ph)) * FRAMES) % FRAMES;
  }

  function drawEnemyShadow(e) {
    const s = f.scale, q = P(e.x, 0);
    if (e.kind === 'flyer') {
      const k = Math.max(0.2, 1 - e.y / 14);
      Fx.shadow(ctx, q.x, q.y, s * 0.55 * k, s * 0.15 * k, 0.3 * k);
    } else {
      const big = e.kind === 'boss' ? 1.25 : e.kind === 'ram' ? 1.1 : 0.7;
      Fx.shadow(ctx, q.x + s * 0.1, q.y, e.w * s * big * 0.75, s * 0.22 * big, 0.45);
    }
  }

  function drawEnemy(e) {
    const s = f.scale;
    const q = P(e.x, e.y);
    const atk = e.atWall && e.kind !== 'flyer';
    const flash = fx.flashes[e.id] > 0;
    const sp = sprite(e.kind, enemyFrame(e), atk, flash);
    const [l, , top] = BOX[e.kind];
    const sq = flash ? 1.06 : 1, sy = flash ? 0.95 : 1;
    const w = sp.width / f.dpr, h = sp.height / f.dpr;
    const x0 = q.x + (l * s - 1 / f.dpr) * sq, y0 = q.y - (top * s + 1 / f.dpr) * sy;
    ctx.drawImage(sp, x0, y0, w * sq, h * sy);
    if (e.burn > 0) { // licking flames
      for (let k = 0; k < 3; k++) {
        const fx0 = q.x + Math.sin(time * 9 + k * 2 + e.id) * e.w * s * 0.25;
        const fy = q.y - e.h * s * (0.45 + 0.15 * k);
        const fh = s * (0.45 + 0.15 * Math.sin(time * 14 + k * 3));
        ctx.fillStyle = k % 2 ? 'rgba(255,170,40,.9)' : 'rgba(255,90,30,.85)';
        ctx.beginPath();
        ctx.moveTo(fx0 - s * 0.16, fy);
        ctx.quadraticCurveTo(fx0 - s * 0.1, fy - fh * 0.7, fx0, fy - fh);
        ctx.quadraticCurveTo(fx0 + s * 0.12, fy - fh * 0.5, fx0 + s * 0.16, fy);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (e.hp < e.maxHp) {
      const boss = e.kind === 'boss';
      const bw = Math.max(e.w * s, s * 1.2, 16), bh = Math.max(3, s * (boss ? 0.3 : 0.2));
      const by = q.y - e.h * s - s * (e.kind === 'flyer' ? 0.9 : 0.7) - (boss ? s * 0.9 : 0);
      const share = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = 'rgba(15, 8, 20, .7)';
      Fx.rrect(ctx, q.x - bw / 2 - 1, by - 1, bw + 2, bh + 2, bh); ctx.fill();
      const col = boss ? '#ff5a3c' : share > 0.5 ? '#7ad85a' : share > 0.25 ? '#ffc43d' : '#ff6a4a';
      const hg = ctx.createLinearGradient(0, by, 0, by + bh);
      hg.addColorStop(0, shade(col, 0.4)); hg.addColorStop(1, shade(col, -0.2));
      ctx.fillStyle = hg;
      Fx.rrect(ctx, q.x - bw / 2, by, bw * share, bh, bh / 2); ctx.fill();
      if (boss) { ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 1; Fx.rrect(ctx, q.x - bw / 2 - 1, by - 1, bw + 2, bh + 2, bh); ctx.stroke(); }
    }
  }

  // Glows drawn after everything lit: fire, the boss's eyes and aura, bat eyes.
  function drawEnemyGlow(e) {
    const s = f.scale;
    if (e.kind === 'boss') {
      const q = P(e.x - 0.43, e.y + 2.98);
      Fx.glow(ctx, q.x, q.y, s * (0.55 + 0.1 * Math.sin(time * 6)), '#ff3a2a', 0.9);
    } else if (e.kind === 'flyer') {
      const q = P(e.x - 0.03, e.y + 0.36);
      Fx.glow(ctx, q.x, q.y, s * 0.35, '#ffe35a', 0.6);
    }
    if (e.burn > 0) { const q = P(e.x, e.y + e.h * 0.6); Fx.glow(ctx, q.x, q.y, s * 1.4, '#ff8a2a', 0.55); }
  }

  function drawBossAura(e) {
    const s = f.scale, q = P(e.x, e.y + 1.7);
    Fx.glow(ctx, q.x, q.y, s * (2.6 + 0.25 * Math.sin(time * 3)), '#b04aff', 0.28);
  }

  // ── The archer on the wall: hood, cape, quiver, a bow that bends with the draw ──
  function drawArcher(r) {
    const s = f.scale;
    const angle = r ? r.aim.angle : 0.5;
    let draw = 0.15;
    if (r && r.firing) {
      const rel = C.stats(r).reload;
      draw = fx.bow > 0 ? 0.05 : 0.25 + 0.75 * Fx.ease.outCubic(1 - Math.min(1, r.cooldown / rel));
    }
    const q = P(C.ARCHER.x, C.WALL_TOP);
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.scale(s, s);
    const g = ctx;
    const tunic = '#3f7fc4', cape = '#2f7a44', skin = '#f2c79e';
    const breath = Math.sin(time * 2) * 0.015;
    // cape flowing behind
    const cw = Math.sin(time * 3) * 0.06;
    const cg = g.createLinearGradient(-0.6, -1.6, 0, 0);
    cg.addColorStop(0, shade(cape, 0.2)); cg.addColorStop(1, shade(cape, -0.4));
    g.fillStyle = cg;
    g.beginPath();
    g.moveTo(-0.05, -1.62); g.quadraticCurveTo(-0.5, -1.2 + cw, -0.62 + cw, -0.3);
    g.lineTo(-0.15, -0.35); g.closePath(); g.fill();
    // quiver on the back
    g.save(); g.translate(-0.28, -1.15); g.rotate(-0.35);
    torso(g, -0.1, -0.35, 0.2, 0.7, 0.08, '#7a4b22');
    for (const dx of [-0.05, 0.03, 0.09]) {
      g.strokeStyle = '#d8c39a'; g.lineWidth = 0.025; g.beginPath(); g.moveTo(dx, -0.35); g.lineTo(dx, -0.55); g.stroke();
      g.fillStyle = '#e8483a'; g.beginPath(); g.moveTo(dx, -0.62); g.lineTo(dx + 0.05, -0.5); g.lineTo(dx - 0.05, -0.5); g.fill();
    }
    g.restore();
    // legs and body
    limb(g, -0.08, -0.75, -0.12, -0.05, 0.16, '#5a4632');
    limb(g, 0.1, -0.75, 0.15, -0.05, 0.16, '#6a5440');
    torso(g, -0.27, -1.6 + breath, 0.54, 0.92, 0.2, tunic);
    g.fillStyle = '#5a3a1e'; g.fillRect(-0.27, -0.95, 0.54, 0.09);
    g.fillStyle = '#f2c14e'; g.fillRect(0.0, -0.96, 0.09, 0.11);
    // head and hood
    const hx = 0.04, hy = -1.86 + breath;
    ball(g, hx, hy, 0.24, skin);
    g.fillStyle = '#2a1a10'; g.beginPath(); g.arc(hx + 0.12, hy - 0.02, 0.035, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,120,110,.35)'; g.beginPath(); g.arc(hx + 0.09, hy + 0.08, 0.05, 0, TAU); g.fill();
    const hg = g.createLinearGradient(hx - 0.3, hy - 0.3, hx + 0.2, hy + 0.2);
    hg.addColorStop(0, shade(cape, 0.35)); hg.addColorStop(1, shade(cape, -0.3));
    g.fillStyle = hg;
    g.beginPath();
    g.moveTo(hx + 0.2, hy - 0.12);
    g.quadraticCurveTo(hx + 0.05, hy - 0.42, hx - 0.25, hy - 0.3);
    g.quadraticCurveTo(hx - 0.55, hy - 0.2, hx - 0.48, hy + 0.05); // the hood's point falls back
    g.quadraticCurveTo(hx - 0.3, hy + 0.0, hx - 0.25, hy + 0.25);
    g.lineTo(hx - 0.05, hy + 0.28);
    g.quadraticCurveTo(hx - 0.12, hy - 0.1, hx + 0.2, hy - 0.12);
    g.closePath(); g.fill();
    g.strokeStyle = shade(cape, -0.6); g.lineWidth = 0.03; g.stroke();
    // bow, arrow and arms
    const dx = Math.cos(angle), dy = -Math.sin(angle);
    const sh = [0.0, -1.47 + breath];
    const grip = [sh[0] + dx * 0.55, sh[1] + dy * 0.55];
    const pullD = 0.12 + 0.55 * draw;
    const vib = fx.bow > 0 ? Math.sin(fx.bow * 90) * 0.05 : 0;
    const nock = [grip[0] - dx * (pullD + vib), grip[1] - dy * (pullD + vib)];
    limb(g, sh[0] - 0.05, sh[1] + 0.03, nock[0], nock[1], 0.13, shade(tunic, -0.2)); // the drawing arm
    g.save();
    g.translate(grip[0], grip[1]);
    g.rotate(-angle);
    const bend = 0.18 + draw * 0.14;
    const tipY = 0.85 - draw * 0.06;
    const bowPath = () => { g.beginPath(); g.moveTo(-bend, -tipY); g.quadraticCurveTo(0.3, -0.45, 0, 0); g.quadraticCurveTo(0.3, 0.45, -bend, tipY); };
    g.lineCap = 'round';
    bowPath(); g.strokeStyle = '#3a2210'; g.lineWidth = 0.14; g.stroke();
    bowPath(); g.strokeStyle = '#9a6232'; g.lineWidth = 0.1; g.stroke();
    bowPath(); g.strokeStyle = 'rgba(255, 220, 160, .55)'; g.lineWidth = 0.03; g.stroke();
    g.fillStyle = '#d9dee6';
    for (const sy of [-1, 1]) { g.beginPath(); g.arc(-bend, sy * tipY, 0.045, 0, TAU); g.fill(); }
    g.strokeStyle = 'rgba(250, 245, 230, .95)'; g.lineWidth = 0.025;
    g.beginPath(); g.moveTo(-bend, -tipY); g.lineTo(-pullD - vib, 0); g.lineTo(-bend, tipY); g.stroke();
    if (r && r.firing && fx.bow <= 0 && draw > 0.3) {
      const ax = -pullD;
      g.strokeStyle = '#c8a36a'; g.lineWidth = 0.05;
      g.beginPath(); g.moveTo(ax, 0); g.lineTo(ax + 1.05, 0); g.stroke();
      g.fillStyle = metalGrad(g, ax + 1.0, -0.08, ax + 1.0, 0.08);
      g.beginPath(); g.moveTo(ax + 1.22, 0); g.lineTo(ax + 1.02, -0.08); g.lineTo(ax + 1.02, 0.08); g.closePath(); g.fill();
      if (r.up && r.up.fire > 0) { g.fillStyle = 'rgba(255, 150, 40, .9)'; g.beginPath(); g.arc(ax + 1.1, 0, 0.09, 0, TAU); g.fill(); }
      g.fillStyle = '#e8483a';
      g.beginPath(); g.moveTo(ax + 0.02, 0); g.lineTo(ax + 0.24, -0.09); g.lineTo(ax + 0.3, 0); g.lineTo(ax + 0.24, 0.09); g.closePath(); g.fill();
    }
    g.restore();
    limb(g, sh[0] + 0.06, sh[1], grip[0], grip[1], 0.13, tunic); // the bow arm
    ball(g, grip[0], grip[1], 0.07, skin);
    ball(g, nock[0], nock[1], 0.07, skin);
    ctx.restore();
  }

  // ── Arrows: a motion trail, a lit shaft, red fletching and a steel (or burning) head ──
  function drawArrow(x, y, a, len, o = {}) {
    const s = f.scale;
    const p = P(x, y);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-a);
    if (o.trail) {
      const tl = Math.min(s * 3.2, o.trail * s * 0.07);
      const tg = ctx.createLinearGradient(-len * s - tl, 0, -len * s * 0.3, 0);
      tg.addColorStop(0, 'rgba(255, 255, 255, 0)');
      tg.addColorStop(1, o.fire ? 'rgba(255, 170, 60, .55)' : 'rgba(255, 255, 255, .45)');
      ctx.strokeStyle = tg;
      ctx.lineWidth = Math.max(1.5, s * 0.14);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-len * s - tl, 0); ctx.lineTo(-len * s * 0.3, 0); ctx.stroke();
    }
    const lw = Math.max(1.2, s * 0.07);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#4a2e14';
    ctx.lineWidth = lw + 0.8;
    ctx.beginPath(); ctx.moveTo(-len * s, 0); ctx.lineTo(0, 0); ctx.stroke();
    ctx.strokeStyle = '#d4ad74';
    ctx.lineWidth = lw * 0.6;
    ctx.beginPath(); ctx.moveTo(-len * s, -lw * 0.1); ctx.lineTo(0, -lw * 0.1); ctx.stroke();
    // fletching
    const fl = Math.max(4, s * 0.3), fw = Math.max(2, s * 0.13);
    ctx.fillStyle = '#e8483a';
    ctx.beginPath(); ctx.moveTo(-len * s + fl * 0.1, 0); ctx.lineTo(-len * s - fl * 0.1, -fw); ctx.lineTo(-len * s + fl, -lw * 0.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b02a20';
    ctx.beginPath(); ctx.moveTo(-len * s + fl * 0.1, 0); ctx.lineTo(-len * s - fl * 0.1, fw); ctx.lineTo(-len * s + fl, lw * 0.4); ctx.closePath(); ctx.fill();
    // head
    const hl = Math.max(4, s * 0.26), hw = Math.max(2, s * 0.1);
    if (o.fire) {
      ctx.fillStyle = '#ffcf6a';
    } else {
      const hg = ctx.createLinearGradient(0, -hw, 0, hw);
      hg.addColorStop(0, '#f4f7fb'); hg.addColorStop(0.5, '#a9b3c2'); hg.addColorStop(1, '#5d6676');
      ctx.fillStyle = hg;
    }
    ctx.beginPath(); ctx.moveTo(hl * 0.7, 0); ctx.lineTo(-hl * 0.3, -hw); ctx.lineTo(-hl * 0.15, 0); ctx.lineTo(-hl * 0.3, hw); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ── Aiming: the dotted flight, a landing marker, the power ring at the archer and the pull band ──
  function drawPreview(r) {
    if (!r || screen !== 'wave' || !(aiming || keys.Space || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight)) return;
    const s = f.scale;
    const pts = V.trajectory(r, r.aim.angle, r.aim.power, 0.06, 40);
    const n = pts.length;
    const pw = r.aim.power;
    const col = pw < 0.5 ? Fx.mix('#9cf0a8', '#ffe27a', pw / 0.5) : Fx.mix('#ffe27a', '#ff8a5a', (pw - 0.5) / 0.5);
    const flow = (time * 3) % 1;
    pts.forEach((q, k) => {
      const p = P(q.x, q.y), u = k / Math.max(1, n);
      const rad = Math.max(1.3, s * 0.12) * (1 - u * 0.45) * (1 + 0.25 * Math.max(0, 1 - Math.abs(((k / 3 + flow) % 1) - 0.5) * 4));
      ctx.globalAlpha = Math.max(0.2, 1 - u * 0.85);
      ctx.fillStyle = 'rgba(20, 10, 30, .45)';
      ctx.beginPath(); ctx.arc(p.x + 0.6, p.y + 0.8, rad + 0.6, 0, TAU); ctx.fill();
      ctx.fillStyle = k % 4 === 0 ? col : '#ffffff';
      ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, TAU); ctx.fill();
    });
    ctx.globalAlpha = 1;
    const last = pts[n - 1];
    if (last && last.y < 1.5) { // where it lands
      const g0 = P(last.x, 0), pulse = 1 + 0.15 * Math.sin(time * 8);
      ctx.strokeStyle = withAlpha(col, 0.9);
      ctx.lineWidth = Math.max(1.2, s * 0.08);
      ctx.beginPath(); ctx.ellipse(g0.x, g0.y, s * 0.7 * pulse, s * 0.22 * pulse, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = withAlpha(col, 0.25);
      ctx.fill();
    }
  }

  function drawPullBand() {
    if (!aiming || !dragNow || screen !== 'wave') return;
    const rect = aiming.rect;
    if (!rect) return;
    const ax = aiming.x0 - rect.left, ay = aiming.y0 - rect.top, bx = dragNow.x - rect.left, by = dragNow.y - rect.top;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < V.DEAD_DRAG) return;
    const k = Math.min(1, len / V.FULL_DRAG);
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = withAlpha('#ffffff', 0.55);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, .6)';
    ctx.beginPath(); ctx.arc(ax, ay, 10, 0, TAU); ctx.stroke();
    ctx.fillStyle = Fx.mix('#9cf0a8', '#ff8a5a', k);
    ctx.beginPath(); ctx.arc(bx, by, 5 + k * 3, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ── The wave-start ribbon: pops in, holds, slides away ──
  function drawBanner() {
    if (!banner) return;
    const W = f.cssW, tt = banner.t;
    const inK = Fx.ease.outBack(Math.min(1, tt / 0.35));
    const outK = tt > 1.7 ? Fx.ease.inOutQuad(Math.min(1, (tt - 1.7) / 0.5)) : 0;
    const size = Math.max(20, Math.min(40, W * 0.06));
    const cx = W / 2, cy = Math.max(size * 1.4, f.gy * 0.24) - outK * size;
    ctx.save();
    ctx.globalAlpha = 1 - outK;
    ctx.translate(cx, cy);
    ctx.scale(inK, inK);
    ctx.font = `900 ${size}px system-ui, sans-serif`;
    const bw = ctx.measureText(banner.text).width + size * (banner.boss ? 4.4 : 2.6), bh = size * 1.5;
    const red = banner.boss ? '#7a1f3a' : '#b8432f';
    if (banner.boss) Fx.glow(ctx, 0, 0, bw * 0.6, '#ff3a2a', 0.45 + 0.15 * Math.sin(time * 8));
    // folded ribbon ends
    for (const sd of [-1, 1]) {
      ctx.fillStyle = shade(red, -0.35);
      ctx.beginPath();
      ctx.moveTo(sd * bw * 0.42, -bh * 0.3); ctx.lineTo(sd * bw * 0.58, -bh * 0.3); ctx.lineTo(sd * bw * 0.52, bh * 0.1);
      ctx.lineTo(sd * bw * 0.58, bh * 0.5); ctx.lineTo(sd * bw * 0.42, bh * 0.5); ctx.closePath(); ctx.fill();
    }
    Fx.block(ctx, -bw / 2 + bw * 0.04, -bh / 2, bw * 0.92, bh, bh * 0.2, red, { gloss: true, edge: 1.5 });
    ctx.strokeStyle = 'rgba(255, 220, 140, .65)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    Fx.rrect(ctx, -bw * 0.42, -bh / 2 + 4, bw * 0.84, bh - 8, bh * 0.15); ctx.stroke();
    ctx.setLineDash([]);
    Fx.text(ctx, banner.text, 0, 1, { size, color: banner.boss ? '#ffb0a0' : '#ffe9b0' });
    if (banner.boss) { // skulls either side
      for (const sd of [-1, 1]) {
        const x = sd * (bw * 0.46 - size * 1.0);
        ctx.fillStyle = '#f4ead8';
        ctx.beginPath(); ctx.arc(x, -size * 0.1, size * 0.32, 0, TAU); ctx.fill();
        ctx.fillRect(x - size * 0.18, size * 0.1, size * 0.36, size * 0.22);
        ctx.fillStyle = '#3a0f1a';
        for (const ex of [-0.12, 0.12]) { ctx.beginPath(); ctx.arc(x + ex * size, -size * 0.1, size * 0.08, 0, TAU); ctx.fill(); }
      }
    }
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
    const r = screen === 'menu' ? demo : run;
    const W = f.cssW, H = f.cssH, s = f.scale;
    const tint = Math.round(waveTint() * 9) / 9;
    const o = shake.offset();
    // one baked backdrop: sky, sun, mountains, hills, meadow, road and the vignette
    const bg = layer('bg', `${f.w}x${f.h}:${f.gy}:${tint}`, 0, 0, W, H, (g) => {
      paintSky(g, W, H, f.gy, tint);
      paintLand(g, W, H, f.gy, s, tint);
      Fx.vignette(g, W, H, 0.3);
    });
    if (o.x || o.y) blit(bg); // under the shaken edges
    ctx.save();
    ctx.translate(o.x, o.y);
    blit(bg);
    drawClouds(tint);
    for (const st of fx.sticks) {
      ctx.globalAlpha = Math.min(1, 3 - st.t);
      drawArrow(st.x, 0.12, st.a, 0.9);
    }
    ctx.globalAlpha = 1;
    drawCastle(r, false);
    drawTorches(false);
    drawCastleLive();
    if (r) {
      for (const e of r.enemies) drawEnemyShadow(e);
      for (const e of r.enemies) if (e.kind === 'boss') drawBossAura(e);
      for (const e of r.enemies) if (e.kind !== 'flyer') drawEnemy(e);
      for (const e of r.enemies) if (e.kind === 'flyer') drawEnemy(e);
    }
    drawArcher(r);
    drawCastle(r, true);
    if (r) for (const a of r.arrows) drawArrow(a.x, a.y, Math.atan2(a.vy, a.vx), 1.1, { trail: Math.hypot(a.vx, a.vy), fire: a.fire });
    // everything that glows, over the lit world
    drawTorches(true);
    if (r) {
      for (const e of r.enemies) drawEnemyGlow(e);
      for (const a of r.arrows) if (a.fire) { const q = P(a.x, a.y); Fx.glow(ctx, q.x, q.y, s * 0.9, '#ff9a30', 0.9); }
    }
    drawPreview(r);
    parts.draw(ctx);
    ctx.restore();
    floaters.draw(ctx);
    drawPullBand();
    drawBanner();
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
    const label = paused ? t('Дальше') : t('Пауза');
    $('pause-label').textContent = label;
    $('btn-pause').setAttribute('aria-label', label);
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
    dragNow = { x: e.clientX, y: e.clientY };
    aiming.rect = canvas.getBoundingClientRect(); // for the pull band only
    try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    showTip(null);
    sfx('draw');
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!aiming || e.pointerId !== aiming.id || !run) return;
    dragNow = { x: e.clientX, y: e.clientY };
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
  // The run on screen, for the browser smoke test (it aims at real monsters). Read-only use only.
  window.castleDebugRun = () => run;
  resize();
  showMenu();
  requestAnimationFrame(frame);
})();
