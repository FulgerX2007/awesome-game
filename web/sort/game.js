'use strict';
// Цветные колбы — client: screens, input, the pour animation and the Canvas 2D art of the tubes. The rules live in
// core.js (window.SortCore), the levels in levels.js (window.SortLevels), pure helpers in view.js (window.SortView).
(() => {
  const C = window.SortCore;
  const V = window.SortView;
  const LEVELS = window.SortLevels.LEVELS;
  const { t } = window.I18n;
  const $ = (id) => document.getElementById(id);
  const { clamp, PALETTE, shade } = V;
  const TAU = Math.PI * 2;

  // Storage access itself may throw (blocked site data); core's progress functions tolerate a null storage.
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }

  // Sound comes from audio.js (index.html loads it first); its play() is silent while the sound is off.
  // Names: lift, pour ({ layers }), complete, undo, deny, win, stuck.
  const Sound = window.SortAudio;
  const sfx = (name, opts) => Sound.play(name, opts);

  const FIRST_CAP5 = LEVELS.findIndex((l) => l.cap === 5);
  function tipFor(i) {
    if (i === 0) return 'Нажми на колбу, затем на ту, куда перелить';
    if (i === 1) return 'Лить можно в пустую колбу или на тот же цвет';
    if (i === FIRST_CAP5) return 'Теперь в колбу входит пять слоёв';
    return null;
  }

  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  let progress = C.loadProgress(storage);
  let level = 0;
  let s = null;            // core state of the level on screen
  let phase = 'menu';      // menu | play | won
  let phaseT = 0;
  let outcome = null;      // { stars, moves, extra }
  let sel = -1;            // picked tube
  let cursor = -1;         // keyboard focus
  let anim = null;         // { a, b, n, color, before, tl, t }
  let lifts = [];          // per tube: drawn lift 0..1
  let shakes = [];         // per tube: seconds of shake left
  let liftV = [];          // per tube: lift spring velocity
  let slosh = [];          // per tube: how hard its liquid surface sways, 0..1
  let corkT = [];          // per tube: seconds since its cork went on (Infinity: long on), null: no cork
  let winT = -1;           // seconds since the win celebration began
  let flash = 0;
  let splashAcc = 0;
  const Fx = window.Fx;
  const fxp = new Fx.Particles(320);
  let wasStuck = false;
  let time = 0;
  let last = 0;

  // ───────────── Canvas size ─────────────
  let lay = V.layout(5, 4, { w: 320, h: 400 });

  function resize() {
    if (!s) return;
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const next = V.layout(s.tubes.length, s.level.cap,
      { w: stage.clientWidth - padX, h: stage.clientHeight - padY, dpr: window.devicePixelRatio || 1 });
    if (next.w === canvas.width && next.h === canvas.height && next.tubes.length === lay.tubes.length) { lay = next; return; }
    lay = next;
    canvas.width = lay.w;
    canvas.height = lay.h;
    canvas.style.width = lay.cssW + 'px';
    canvas.style.height = lay.cssH + 'px';
  }

  // ───────────── Game flow ─────────────
  function setPhase(p) { phase = p; phaseT = 0; }

  function syncArrays() {
    const n = s.tubes.length;
    while (lifts.length < n) { lifts.push(0); shakes.push(0); liftV.push(0); slosh.push(0); corkT.push(null); }
    lifts.length = n;
    shakes.length = n;
    liftV.length = n;
    slosh.length = n;
    corkT.length = n;
  }

  function loadLevel(i, state) {
    level = i;
    s = state || C.newGame(LEVELS[i]);
    sel = -1;
    cursor = -1;
    anim = null;
    lifts = [];
    shakes = [];
    liftV = [];
    slosh = [];
    corkT = [];
    winT = -1;
    flash = 0;
    fxp.clear();
    wasStuck = s.status === 'stuck';
    outcome = null;
    syncArrays();
    resize();
    renderHUD();
  }

  function saveCurrent() {
    progress.current = C.currentOf(level, s);
    C.saveProgress(storage, progress);
  }

  // The saved level in progress, if it still replays.
  const restored = () => C.resume(progress, LEVELS);

  function startLevel(i, state) {
    const r = restored();
    loadLevel(i, state || (r && r.level === i ? r.state : null));
    setPhase('play');
    show(null);
    $('hud').hidden = false;
    $('controls').hidden = false;
    showTip(s.history.length ? null : tipFor(i));
    saveCurrent();
    renderHUD();
    canvas.focus({ preventScroll: true });
  }

  function finishAnim() {
    if (!anim) return;
    const b = anim.b;
    anim = null;
    afterPourShown(b);
  }

  // The pour animation is over: celebrate a completed tube, and the win.
  function afterPourShown(b) {
    if (C.complete(s.tubes[b], s.level.cap)) {
      sfx('complete');
      corkT[b] = 0;
    }
    if (phase === 'won') { sfx('win'); celebrateWin(); }
    else if (s.status === 'stuck' && !wasStuck) sfx('stuck');
    wasStuck = s.status === 'stuck';
  }

  function tap(i) {
    if (phase !== 'play' || i < 0 || i >= s.tubes.length) return;
    Sound.unlock();
    finishAnim();
    if (sel < 0) {
      if (!s.tubes[i].length) return;
      sel = i;
      slosh[i] = 0.7;
      sfx('lift');
    } else if (sel === i) {
      sel = -1;
    } else if (C.canPour(s, sel, i)) {
      pour(sel, i);
    } else {
      shakes[i] = 0.35;
      slosh[i] = 0.6;
      sfx('deny');
      if (s.tubes[i].length && !C.complete(s.tubes[i], s.level.cap)) { sel = i; sfx('lift'); }
    }
    renderHUD();
  }

  function pour(a, b) {
    const before = s.tubes.map((tb) => tb.slice());
    const color = before[a][before[a].length - 1];
    const n = C.pour(s, a, b);
    if (!n) return;
    sel = -1;
    showTip(null);
    anim = { a, b, n, color, before, tl: V.pourTimeline(n), t: 0 };
    sfx('pour', { layers: n });
    if (s.status === 'won') win();
    saveCurrent();
    renderHUD();
  }

  // The win counts the moment it happens: stars are saved before any animation.
  function win() {
    const stars = C.stars(s);
    C.recordStars(progress, level, stars);
    outcome = { stars, moves: s.moves, extra: s.extraUsed };
    setPhase('won');
  }

  function undo() {
    if (phase !== 'play') return;
    finishAnim();
    const n = s.tubes.length;
    if (!C.undo(s)) return;
    sel = -1;
    sfx('undo');
    if (s.tubes.length !== n) { syncArrays(); resize(); }
    wasStuck = s.status === 'stuck';
    saveCurrent();
    renderHUD();
  }

  function restart() {
    if (phase !== 'play' || !s.history.length) return;
    finishAnim();
    loadLevel(level, C.newGame(LEVELS[level]));
    setPhase('play');
    sfx('undo');
    saveCurrent();
    renderHUD();
  }

  function addTube() {
    if (phase !== 'play') return;
    finishAnim();
    if (!C.addTube(s)) return;
    sel = -1;
    syncArrays();
    resize();
    sfx('lift');
    wasStuck = s.status === 'stuck';
    showTip('Лишняя колба: теперь не больше ★★');
    saveCurrent();
    renderHUD();
  }

  // ───────────── Animation ─────────────
  // Purely visual state: none of it is saved and none of it takes part in the rules or the hit-testing.
  function celebrateCork(i) {
    const tb = lay.tubes[i];
    if (!tb) return;
    const u = lay.unit;
    const x = tb.x + tb.w / 2, y = tb.y - u * 0.1;
    const col = PALETTE[s.tubes[i][0]] ? PALETTE[s.tubes[i][0]].color : '#ffffff';
    fxp.burst(x, y, 10, { shape: 'star', colors: ['#fff6c8', '#ffd34d', col], speed: u * 2.6, size: u * 0.09, life: 0.8, gravity: u * 3, drag: 0.6, spin: 6 });
    fxp.burst(x, y, 12, { shape: 'spark', colors: ['#ffffff', '#ffe9a0', shade(col, 0.5)], speed: u * 4.2, size: u * 0.04, life: 0.45, drag: 0.85 });
    fxp.emit({ x, y, shape: 'ring', size: u * 0.12, grow: u * 1.6, life: 0.35, color: 'rgba(255, 244, 200, .45)' });
  }

  function celebrateWin() {
    const u = lay.unit, w = lay.cssW, h = lay.cssH;
    winT = 0;
    flash = 1;
    const cols = [...new Set(s.tubes.filter((tb) => tb.length).map((tb) => PALETTE[tb[0]].color))].concat(['#ffd34d', '#ffffff']);
    const pick = () => cols[(Math.random() * cols.length) | 0];
    for (let k = 0; k < 110; k++) {
      const side = k % 2 ? 1 : -1;
      const a = -Math.PI / 2 - side * (0.25 + Math.random() * 0.45);
      const sp = Math.min(h * 2.4, u * 11) * (0.55 + Math.random() * 0.6);
      fxp.emit({
        x: side < 0 ? 0 : w, y: h, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        shape: 'confetti', color: pick(), size: u * (0.1 + Math.random() * 0.08),
        life: 1.8 + Math.random() * 1.1, gravity: u * 5, drag: 0.75, spin: (Math.random() - 0.5) * 16, angle: Math.random() * TAU,
      });
    }
    fxp.burst(w / 2, h * 0.42, 22, { shape: 'star', colors: ['#ffd34d', '#fff2b0', '#ffffff'], speed: u * 5, size: u * 0.13, life: 1.1, gravity: u * 2, drag: 0.7, spin: 5 });
    fxp.emit({ x: w / 2, y: h * 0.42, shape: 'ring', size: u * 0.4, grow: u * 6, life: 0.6, color: 'rgba(255, 236, 170, .8)' });
  }

  // How much of a pour has flowed, eased so the levels start and settle softly.
  const smooth = (x) => x * x * (3 - 2 * x);

  function update(dt) {
    time += dt;
    phaseT += dt;
    if (anim) {
      anim.t += dt;
      const st = V.pourAt(anim.tl, anim.t);
      if (st.flow > 0 && st.flow < 1) { slosh[anim.a] = 1; slosh[anim.b] = 1; splashAcc += dt; }
      if (anim.t >= anim.tl.total) finishAnim();
    }
    // the picked tube rides a spring: it overshoots a little and settles
    const steps = dt > 0.02 ? 2 : 1, h = dt / steps;
    for (let i = 0; i < lifts.length; i++) {
      const want = i === sel ? 1 : 0;
      for (let k = 0; k < steps; k++) {
        liftV[i] += ((want - lifts[i]) * 330 - liftV[i] * 21) * h;
        lifts[i] += liftV[i] * h;
      }
      shakes[i] = Math.max(0, shakes[i] - dt);
      slosh[i] = Math.max(0, slosh[i] - dt * 1.1);
      // corks: on every complete tube; the one a pour just completed pops on (afterPourShown starts it)
      const done = C.complete(s.tubes[i], s.level.cap) && !(anim && (i === anim.b || i === anim.a));
      if (!done) corkT[i] = null;
      else if (corkT[i] == null) corkT[i] = Infinity;
      else if (corkT[i] < 5) {
        const before = corkT[i];
        corkT[i] += dt;
        if (before < 0.3 && corkT[i] >= 0.3) celebrateCork(i);
      }
    }
    fxp.update(dt);
    if (winT >= 0) winT += dt;
    flash = Math.max(0, flash - dt * 2.2);
    $('stuck').hidden = !(phase === 'play' && !anim && s && s.status === 'stuck');
    $('btn-tube').classList.toggle('glow', phase === 'play' && s && s.status === 'stuck');
    if (phase === 'won' && !anim && phaseT > 0.9 && $('result').hidden) showResult();
  }

  // ───────────── Drawing ─────────────
  // Every tube is drawn in its own frame: the origin is the middle of its mouth, +y runs down the tube.
  // The glass is two baked sprites per tube size (the back before the liquid, the front over it); the liquid is
  // drawn in screen-aligned bands so its surfaces stay level when the pouring tube turns.
  const WALL = 0.07;          // glass wall, in units
  const FLOOR = 0.14;         // the thick round bottom
  const RIM_RY = 0.11;        // the elliptical opening seen slightly from above

  // The open-top outline of a tube box (round bottom).
  function tubePath(g, x, y, w, h) {
    const r = w / 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y + h - r);
    g.arc(x + r, y + h - r, r, Math.PI, 0, true);
    g.lineTo(x + w, y);
  }

  // Geometry of the inside of a tube in its own frame, cached per layout.
  function geo() {
    if (lay._geo) return lay._geo;
    const u = lay.unit, box = lay.tubes[0] || { w: u, h: u * 3 };
    const w = box.w, h = box.h, iw = w / 2 - WALL * u, hb = h - FLOOR * u, cy = hb - iw;
    const poly = [[-iw, 0], [-iw, cy]];
    for (let k = 1; k < 16; k++) { const a = Math.PI - (k / 16) * Math.PI; poly.push([iw * Math.cos(a), cy + iw * Math.sin(a)]); }
    poly.push([iw, cy], [iw, 0]);
    lay._geo = { u, w, h, iw, hb, cy, lh: V.LAYER_H * u, poly };
    return lay._geo;
  }

  function cavityPath(g, G) {
    g.beginPath();
    g.moveTo(-G.iw, -G.u * 0.02);
    g.lineTo(-G.iw, G.cy);
    g.arc(0, G.cy, G.iw, Math.PI, 0, true);
    g.lineTo(G.iw, -G.u * 0.02);
    g.closePath();
  }

  // Polygon helpers for the tilted tube: the part of a polygon below a level line, its area, the turned outline.
  const turn = (poly, a) => { const c = Math.cos(a), sn = Math.sin(a); return poly.map(([x, y]) => [x * c - y * sn, x * sn + y * c]); };
  function below(poly, Y) {
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length];
      const pin = p[1] >= Y, qin = q[1] >= Y;
      if (pin) out.push(p);
      if (pin !== qin) { const f = (Y - p[1]) / (q[1] - p[1]); out.push([p[0] + (q[0] - p[0]) * f, Y]); }
    }
    return out;
  }
  function area(poly) {
    let a = 0;
    for (let k = 0; k < poly.length; k++) { const p = poly[k], q = poly[(k + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(a) / 2;
  }
  // The level line (screen y in the tube frame) under which a turned outline holds `vol`.
  function levelFor(polyT, vol) {
    let lo = Infinity, hi = -Infinity;
    for (const p of polyT) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
    for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (area(below(polyT, m)) > vol) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  // Volume (area) of `layers` layers in an upright tube.
  const volOf = (G, layers) => (layers <= 0 ? 0 : area(below(G.poly, G.hb - layers * G.lh)));
  // How much a tube turned by `a` holds before it spills over the lower lip.
  function holds(G, a) {
    const pt = turn(G.poly, a);
    return area(below(pt, Math.max(pt[0][1], pt[pt.length - 1][1])));
  }
  // The turn at which a tube holding `vol` is just about to spill: the pouring tube follows its contents.
  function tiltFor(G, vol) {
    let lo = 0, hi = MAX_TILT;
    if (holds(G, hi) >= vol) return hi;
    for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (holds(G, m) > vol) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  const MAX_TILT = 1.68;
  const MIN_POUR_TILT = 1.0;

  // Baked glass for the current tube size: [back, front] sprites, plus the pad around the tube they carry.
  const glassCache = new Map();
  function glassSprites() {
    const G = geo(), u = G.u, dpr = lay.dpr;
    const key = `${G.w.toFixed(2)}|${G.h.toFixed(2)}|${dpr}`;
    let v = glassCache.get(key);
    if (v) return v;
    if (glassCache.size > 6) glassCache.clear();
    const pad = u * 0.3, W = Math.ceil((G.w + pad * 2) * dpr), H = Math.ceil((G.h + pad * 2) * dpr);
    const mk = (paint) => {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      g.scale(dpr, dpr);
      g.translate(pad + G.w / 2, pad);
      paint(g);
      return cv;
    };
    const w = G.w, h = G.h, x0 = -w / 2, ry = RIM_RY * u;
    const back = mk((g) => {
      tubePath(g, x0, 0, w, h);
      g.closePath();
      const bg = g.createLinearGradient(x0, 0, x0 + w, 0);
      bg.addColorStop(0, 'rgba(200, 220, 255, .16)');
      bg.addColorStop(0.35, 'rgba(200, 220, 255, .05)');
      bg.addColorStop(0.7, 'rgba(200, 220, 255, .04)');
      bg.addColorStop(1, 'rgba(200, 220, 255, .14)');
      g.fillStyle = bg;
      g.fill();
      // the inside of the opening and the far half of the lip
      g.fillStyle = 'rgba(14, 8, 36, .22)';
      g.beginPath(); g.ellipse(0, 0, G.iw, ry * 0.8, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(225, 235, 255, .42)';
      g.lineWidth = Math.max(1, u * 0.05);
      g.beginPath(); g.ellipse(0, 0, w / 2 + u * 0.03, ry, 0, Math.PI, TAU); g.stroke();
    });
    const front = mk((g) => {
      g.save();
      tubePath(g, x0, 0, w, h);
      g.closePath();
      g.clip();
      // the glass wall itself, thicker at the round bottom
      tubePath(g, x0, 0, w, h);
      g.closePath();
      cavityPath(g, G);
      g.fillStyle = 'rgba(225, 238, 255, .13)';
      g.fill('evenodd');
      // refraction: the glass darkens towards its edges
      const eg = g.createLinearGradient(x0, 0, x0 + w, 0);
      eg.addColorStop(0, 'rgba(12, 6, 34, .42)');
      eg.addColorStop(0.1, 'rgba(12, 6, 34, .1)');
      eg.addColorStop(0.22, 'rgba(12, 6, 34, 0)');
      eg.addColorStop(0.76, 'rgba(12, 6, 34, 0)');
      eg.addColorStop(0.9, 'rgba(12, 6, 34, .16)');
      eg.addColorStop(1, 'rgba(12, 6, 34, .48)');
      g.fillStyle = eg;
      g.fillRect(x0, 0, w, h);
      // the long highlight streak on the lit side
      const sx = x0 + w * 0.15, sw = w * 0.085, sy = u * 0.28, sh = h - u * 0.8;
      const lg = g.createLinearGradient(0, sy, 0, sy + sh);
      lg.addColorStop(0, 'rgba(255, 255, 255, 0)');
      lg.addColorStop(0.12, 'rgba(255, 255, 255, .78)');
      lg.addColorStop(0.7, 'rgba(255, 255, 255, .5)');
      lg.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = lg;
      Fx.rrect(g, sx, sy, sw, sh, sw / 2);
      g.fill();
      g.fillStyle = 'rgba(255, 255, 255, .22)';
      Fx.rrect(g, x0 + w * 0.285, u * 0.5, w * 0.03, h * 0.42, w * 0.015);
      g.fill();
      // the soft reflection on the far side
      const ry0 = u * 0.42, rh = h * 0.6;
      const rg = g.createLinearGradient(0, ry0, 0, ry0 + rh);
      rg.addColorStop(0, 'rgba(255, 255, 255, 0)');
      rg.addColorStop(0.4, 'rgba(255, 255, 255, .2)');
      rg.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = rg;
      Fx.rrect(g, x0 + w * 0.73, ry0, w * 0.1, rh, w * 0.05);
      g.fill();
      // light gathered in the thick bottom
      const cyo = h - w / 2;
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255, 255, 255, .55)';
      g.lineWidth = Math.max(1, u * 0.035);
      g.beginPath(); g.arc(0, cyo, w / 2 - u * 0.04, Math.PI * 0.6, Math.PI * 0.86); g.stroke();
      g.strokeStyle = 'rgba(255, 255, 255, .18)';
      g.beginPath(); g.arc(0, cyo, w / 2 - u * 0.04, Math.PI * 0.12, Math.PI * 0.32); g.stroke();
      const fg = g.createRadialGradient(0, h - u * 0.07, 0, 0, h - u * 0.07, G.iw * 0.8);
      fg.addColorStop(0, 'rgba(255, 255, 255, .3)');
      fg.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = fg;
      g.beginPath(); g.ellipse(0, h - u * 0.07, G.iw * 0.8, u * 0.06, 0, 0, TAU); g.fill();
      g.restore();
      // outline and the inner wall line
      tubePath(g, x0, 0, w, h);
      g.strokeStyle = 'rgba(235, 242, 255, .62)';
      g.lineWidth = Math.max(1, u * 0.03);
      g.stroke();
      g.beginPath();
      g.moveTo(-G.iw, ry * 0.6); g.lineTo(-G.iw, G.cy); g.arc(0, G.cy, G.iw, Math.PI, 0, true); g.lineTo(G.iw, ry * 0.6);
      g.strokeStyle = 'rgba(255, 255, 255, .13)';
      g.lineWidth = 1;
      g.stroke();
      // the near half of the lip: a thick, bright glass ring
      const lipG = g.createLinearGradient(x0, 0, x0 + w, 0);
      lipG.addColorStop(0, 'rgba(255, 255, 255, .95)');
      lipG.addColorStop(0.5, 'rgba(225, 235, 255, .55)');
      lipG.addColorStop(1, 'rgba(240, 245, 255, .8)');
      g.strokeStyle = lipG;
      g.lineWidth = Math.max(1.5, u * 0.075);
      g.beginPath(); g.ellipse(0, 0, w / 2 + u * 0.03, ry, 0, 0, Math.PI); g.stroke();
      g.strokeStyle = 'rgba(30, 20, 70, .28)';
      g.lineWidth = Math.max(0.8, u * 0.02);
      g.beginPath(); g.ellipse(0, u * 0.01, G.iw, ry * 0.75, 0, 0.15, Math.PI - 0.15); g.stroke();
      g.fillStyle = 'rgba(255, 255, 255, .95)';
      g.beginPath(); g.ellipse(-w * 0.3, ry * 0.55, u * 0.06, u * 0.025, -0.3, 0, TAU); g.fill();
    });
    v = { back, front, pad, dw: W / dpr, dh: H / dpr };
    glassCache.set(key, v);
    return v;
  }
  const drawSprite = (g, cv, gs) => g.drawImage(cv, -geo().w / 2 - gs.pad, -gs.pad, gs.dw, gs.dh);

  // Gradients that only depend on colours and the tube size, built once per layout and placed with a translate.
  const grads = new Map();
  let gradsUnit = 0;
  function cachedGrad(key, make) {
    if (gradsUnit !== lay.unit || grads.size > 400) { grads.clear(); gradsUnit = lay.unit; }
    let v = grads.get(key);
    if (!v) { v = make(); grads.set(key, v); }
    return v;
  }

  // Per colour: a vertical gradient one layer tall, used with a translate so it can be reused by every tube.
  const layerGrads = new Map();
  function layerGrad(g, color) {
    const k = color + '|' + lay.unit;
    let v = layerGrads.get(k);
    if (!v) {
      const lh = geo().lh;
      v = g.createLinearGradient(0, 0, 0, lh);
      v.addColorStop(0, shade(color, 0.16));
      v.addColorStop(0.55, color);
      v.addColorStop(1, shade(color, -0.2));
      if (layerGrads.size > 64) layerGrads.clear();
      layerGrads.set(k, v);
    }
    return v;
  }
  let bodyShade = null, bodyShadeKey = '';
  function liquidShade(g) {
    const G = geo(), k = G.w + '|' + G.iw;
    if (bodyShadeKey !== k) {
      bodyShade = g.createLinearGradient(-G.iw, 0, G.iw, 0);
      bodyShade.addColorStop(0, 'rgba(10, 4, 30, .34)');
      bodyShade.addColorStop(0.1, 'rgba(255, 255, 255, .05)');
      bodyShade.addColorStop(0.24, 'rgba(255, 255, 255, .2)');
      bodyShade.addColorStop(0.36, 'rgba(255, 255, 255, 0)');
      bodyShade.addColorStop(0.7, 'rgba(10, 4, 30, .05)');
      bodyShade.addColorStop(0.9, 'rgba(10, 4, 30, .26)');
      bodyShade.addColorStop(1, 'rgba(10, 4, 30, .48)');
      bodyShadeKey = k;
    }
    return bodyShade;
  }

  // A pattern over a layer box (clip already set to the tube's inside), drawn in a light translucent ink.
  function drawPattern(g, kind, x, y, w, h, u) {
    if (kind === 'plain') return;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,.34)';
    g.fillStyle = 'rgba(255,255,255,.34)';
    g.lineWidth = Math.max(1, u * 0.05);
    const step = u * 0.22;
    g.beginPath();
    if (kind === 'dots') {
      for (let yy = y + step / 2; yy < y + h; yy += step) for (let xx = x + step / 2; xx < x + w; xx += step) {
        g.moveTo(xx + u * 0.035, yy);
        g.arc(xx, yy, u * 0.035, 0, TAU);
      }
      g.fill();
    } else if (kind === 'diag' || kind === 'rdiag') {
      const sgn = kind === 'diag' ? 1 : -1;
      for (let k = -h; k < w + h; k += step) {
        g.moveTo(x + k, y + (sgn > 0 ? h : 0));
        g.lineTo(x + k + h, y + (sgn > 0 ? 0 : h));
      }
      g.stroke();
    } else if (kind === 'hlines') {
      for (let yy = y + step / 2; yy < y + h; yy += step) { g.moveTo(x, yy); g.lineTo(x + w, yy); }
      g.stroke();
    } else if (kind === 'vlines') {
      for (let xx = x + step / 2; xx < x + w; xx += step) { g.moveTo(xx, y); g.lineTo(xx, y + h); }
      g.stroke();
    } else if (kind === 'grid') {
      for (let yy = y + step / 2; yy < y + h; yy += step) { g.moveTo(x, yy); g.lineTo(x + w, yy); }
      for (let xx = x + step / 2; xx < x + w; xx += step) { g.moveTo(xx, y); g.lineTo(xx, y + h); }
      g.stroke();
    } else if (kind === 'rings') {
      for (let yy = y + step; yy < y + h; yy += step * 1.6) for (let xx = x + step; xx < x + w; xx += step * 1.6) {
        g.moveTo(xx + u * 0.07, yy);
        g.arc(xx, yy, u * 0.07, 0, TAU);
      }
      g.stroke();
    } else if (kind === 'zigzag') {
      for (let yy = y + step / 2; yy < y + h; yy += step) {
        g.moveTo(x, yy);
        for (let xx = x, k = 0; xx <= x + w + step; xx += step / 2, k++) g.lineTo(xx, yy + (k % 2 ? -step / 3 : step / 3));
      }
      g.stroke();
    } else if (kind === 'checks') {
      for (let yy = y, r = 0; yy < y + h; yy += step, r++) for (let xx = x + (r % 2) * step; xx < x + w; xx += step * 2) {
        g.rect(xx, yy, step, step);
      }
      g.globalAlpha = 0.6;
      g.fill();
    } else if (kind === 'cross') {
      for (let yy = y + step / 2; yy < y + h; yy += step * 1.4) for (let xx = x + step / 2; xx < x + w; xx += step * 1.4) {
        const d = u * 0.06;
        g.moveTo(xx - d, yy - d); g.lineTo(xx + d, yy + d);
        g.moveTo(xx + d, yy - d); g.lineTo(xx - d, yy + d);
      }
      g.stroke();
    } else if (kind === 'tri') {
      for (let yy = y + step; yy < y + h; yy += step * 1.4) for (let xx = x + step / 2; xx < x + w; xx += step * 1.4) {
        const d = u * 0.07;
        g.moveTo(xx, yy - d); g.lineTo(xx + d, yy + d * 0.7); g.lineTo(xx - d, yy + d * 0.7); g.closePath();
      }
      g.fill();
    }
    g.restore();
  }

  // Where a level line crosses a turned outline: [left x, right x].
  function chord(polyT, Y) {
    let a = Infinity, b = -Infinity;
    for (let k = 0; k < polyT.length; k++) {
      const p = polyT[k], q = polyT[(k + 1) % polyT.length];
      if ((p[1] - Y) * (q[1] - Y) > 0 || p[1] === q[1]) continue;
      const x = p[0] + (q[0] - p[0]) * (Y - p[1]) / (q[1] - p[1]);
      a = Math.min(a, x); b = Math.max(b, x);
    }
    return a <= b ? [a, b] : [0, 0];
  }

  // The liquid of tube i in its frame (already translated to the mouth), turned by `ang`. `layers` as [{ c, a }].
  function drawLiquid(g, i, layers, ang) {
    const G = geo(), u = G.u;
    const live = layers.filter((l) => l.a > 0.001);
    if (!live.length) return;
    const tilted = Math.abs(ang) > 0.002;
    const polyT = tilted ? turn(G.poly, ang) : G.poly;
    const cap = tilted ? holds(G, ang) : Infinity;
    // band edges (screen-aligned y in the tube frame), bottom first
    const ys = [];
    let lvl = 0;
    let lowY = G.hb;
    if (tilted) { lowY = -Infinity; for (const p of polyT) lowY = Math.max(lowY, p[1]); }
    ys.push(lowY);
    // a turned tube shows at most what it holds; every layer shrinks alike so the one at the lip stays visible
    let total = 0;
    for (const l of live) total += l.a;
    const squeeze = tilted ? Math.min(1, cap / Math.max(1e-6, volOf(G, total))) : 1;
    for (const l of live) {
      lvl += l.a;
      ys.push(tilted ? levelFor(polyT, volOf(G, lvl) * squeeze) : G.hb - lvl * G.lh);
    }
    let xl = -G.iw, xr = G.iw;
    if (tilted) { xl = Infinity; xr = -Infinity; for (const p of polyT) { xl = Math.min(xl, p[0]); xr = Math.max(xr, p[0]); } }
    const topY = ys[ys.length - 1];
    if (lowY - topY < 0.5) return;
    const [ca, cb] = tilted ? chord(polyT, topY) : [-G.iw, G.iw];
    const xc = (ca + cb) / 2;
    // the surface sways: a slow idle tilt plus a stronger slosh after a lift or a pour, and a small ripple
    const e = slosh[i] || 0;
    const slope = (0.03 * Math.sin(time * 1.7 + i * 1.9) + e * 0.16 * Math.sin(time * 9 + i)) * (tilted ? 0.4 : 1);
    const ripple = (x) => u * (0.012 + e * 0.02) * Math.sin(x / G.iw * 4 + time * 4.2 + i);
    const surf = (x) => topY + slope * (x - xc) + ripple(x);

    g.save();
    g.rotate(ang);
    cavityPath(g, G);
    g.rotate(-ang);
    g.clip();
    for (let k = 0; k < live.length; k++) {
      const pal = PALETTE[live[k].c];
      const y0 = ys[k], y1 = ys[k + 1];
      if (y0 - y1 < 0.05) continue;
      const top = k === live.length - 1;
      g.save();
      g.translate(0, y1);
      g.fillStyle = layerGrad(g, pal.color);
      if (top) {
        g.beginPath();
        const n = 10;
        for (let j = 0; j <= n; j++) { const x = xl + (xr - xl) * j / n; g.lineTo(x, surf(x) - y1); }
        g.lineTo(xr, y0 - y1 + 1); g.lineTo(xl, y0 - y1 + 1); g.closePath();
        g.fill();
      } else {
        g.fillRect(xl, 0, xr - xl, y0 - y1 + 1);
      }
      g.restore();
      drawPattern(g, pal.pattern, xl, y1 + (top ? u * 0.08 : 0), xr - xl, y0 - y1 - (top ? u * 0.08 : 0), u);
    }
    // soft boundaries: neighbouring colours melt into each other over a few pixels
    const f = u * 0.06;
    for (let k = 1; k < live.length; k++) {
      const Y = ys[k];
      if (ys[k - 1] - Y < 0.5 || Y - ys[k + 1] < 0.5) continue;
      const lo = PALETTE[live[k - 1].c].color, hi = PALETTE[live[k].c].color;
      if (lo !== hi) {
        g.save();
        g.translate(0, Y - f);
        g.fillStyle = cachedGrad('seam|' + hi + lo, () => {
          const sg = g.createLinearGradient(0, 0, 0, f * 2);
          sg.addColorStop(0, withA(hi, 0));
          sg.addColorStop(0.5, Fx.mix(hi, lo, 0.5));
          sg.addColorStop(1, withA(lo, 0));
          return sg;
        });
        g.fillRect(xl, 0, xr - xl, f * 2);
        g.restore();
        g.fillStyle = 'rgba(20, 8, 40, .16)';
        g.fillRect(xl, Y - 0.5, xr - xl, 1);
      } else {
        g.fillStyle = 'rgba(20, 8, 40, .07)';
        g.fillRect(xl, Y - 0.5, xr - xl, 1);
      }
    }
    // the glass bends light at the sides of the column: dark edges, a soft lit band near the left
    g.save();
    g.rotate(ang);
    g.fillStyle = liquidShade(g);
    g.fillRect(-G.iw, -G.h, G.iw * 2, G.h * 3);
    g.restore();
    // small bubbles rising through an upright tube
    if (!tilted && lowY - topY > u * 0.5) {
      const hh = lowY - topY - u * 0.15;
      for (let k = 0; k < 3; k++) {
        const per = 2.6 + k * 0.9 + (i % 3) * 0.3;
        const ph = (time / per + k * 0.37 + i * 0.23) % 1;
        const bx = G.iw * (((k * 0.41 + i * 0.29) % 1) - 0.5) * 1.2 + Math.sin(time * 3 + k + i) * u * 0.03;
        const by = lowY - u * 0.08 - ph * hh;
        const r = u * (0.018 + 0.02 * ph);
        g.globalAlpha = 0.6 * Math.sin(ph * Math.PI);
        g.strokeStyle = 'rgba(255, 255, 255, .8)';
        g.lineWidth = Math.max(0.6, u * 0.012);
        g.beginPath(); g.arc(bx, by, r, 0, TAU); g.stroke();
        g.fillStyle = 'rgba(255, 255, 255, .55)';
        g.beginPath(); g.arc(bx - r * 0.35, by - r * 0.35, r * 0.35, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }
    // the lit surface (meniscus) of the top layer
    const topCol = PALETTE[live[live.length - 1].c].color;
    const rx = Math.max(0, (cb - ca) / 2), ry = u * (tilted ? 0.05 : 0.085);
    if (rx > 1) {
      const my = surf(xc), rot = Math.atan(slope);
      g.save();
      g.translate(0, my);
      g.fillStyle = cachedGrad('surf|' + topCol + '|' + ry, () => {
        const mg = g.createLinearGradient(0, -ry, 0, ry);
        mg.addColorStop(0, shade(topCol, 0.55));
        mg.addColorStop(1, shade(topCol, 0.18));
        return mg;
      });
      g.beginPath(); g.ellipse(xc, 0, rx, ry, rot, 0, TAU); g.fill();
      g.restore();
      g.strokeStyle = 'rgba(255, 255, 255, .55)';
      g.lineWidth = Math.max(0.8, u * 0.02);
      g.beginPath(); g.ellipse(xc, my, rx * 0.98, ry * 0.95, rot, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      g.fillStyle = 'rgba(255, 255, 255, .7)';
      g.beginPath(); g.ellipse(xc - rx * 0.42, my - ry * 0.15, rx * 0.2, ry * 0.32, rot - 0.15, 0, TAU); g.fill();
    }
    g.restore();
  }
  const withA = (hex, a) => Fx.withAlpha(hex, a);

  // What tube i shows right now: during a pour the source drains and the target fills.
  function contentsOf(i) {
    if (!anim) return s.tubes[i].map((c) => ({ c, a: 1 }));
    const flow = smooth(V.pourAt(anim.tl, anim.t).flow) * anim.n;
    const base = anim.before[i];
    if (i === anim.a) {
      const out = base.map((c) => ({ c, a: 1 }));
      let left = flow;
      for (let k = out.length - 1; k >= 0 && left > 0; k--) {
        const take = Math.min(out[k].a, left);
        out[k].a -= take;
        left -= take;
      }
      return out;
    }
    if (i === anim.b) return base.map((c) => ({ c, a: 1 })).concat(flow > 0 ? [{ c: anim.color, a: flow }] : []);
    return (anim.before[i] || s.tubes[i]).map((c) => ({ c, a: 1 }));
  }

  // Where a pouring tube's mouth (the pivot it turns around) is and how far it is turned. The turn follows what is
  // left in the tube, so the liquid reaches the lip just as it flows.
  function pourPose() {
    const st = V.pourAt(anim.tl, anim.t);
    const G = geo(), u = G.u;
    const src = lay.tubes[anim.a], dst = lay.tubes[anim.b];
    // the lip faces the target and the body lies towards the middle of the board, so it never leaves the canvas
    const dir = dst.x + dst.w / 2 >= lay.cssW / 2 ? 1 : -1;
    const v0 = anim.before[anim.a].length;
    const left = v0 - smooth(st.flow) * anim.n, end = v0 - anim.n;
    const pourTilt = (layers) => Math.max(MIN_POUR_TILT, tiltFor(G, volOf(G, layers)));
    let th;
    if (st.back > 0) th = pourTilt(end) * (1 - V.easeInOut(st.back));
    else if (st.flow > 0) th = pourTilt(left);
    else th = V.easeOut(st.tilt) * pourTilt(v0);
    const homeX = src.x + src.w / 2, homeY = src.y - V.LIFT * u;
    // over the target the lower lip hangs above the middle of its opening
    const tx = dst.x + dst.w / 2 - dir * (G.w / 2) * Math.cos(th) + dir * u * 0.04;
    const ty = dst.y - u * 0.32 - (G.w / 2) * Math.sin(th);
    const m = V.easeInOut(st.back > 0 ? 1 - st.back : st.move);
    return { x: homeX + (tx - homeX) * m, y: homeY + (ty - homeY) * m, angle: dir * th, dir, th, st };
  }

  // Pose of tube i: the middle of its mouth and its turn.
  function poseOf(i) {
    if (anim && i === anim.a) return pourPose();
    const box = lay.tubes[i], u = lay.unit;
    let x = box.x + box.w / 2, y = box.y - lifts[i] * V.LIFT * u;
    if (shakes[i] > 0) x += Math.sin(shakes[i] * 60) * u * 0.06 * (shakes[i] / 0.35);
    if (winT >= 0) { const b = (winT - i * 0.06) / 0.42; if (b > 0 && b < 1) y -= Math.sin(b * Math.PI) * u * 0.32; }
    return { x, y, angle: 0 };
  }

  function haloSprite() {
    return Fx.bake('sort-halo', 64, (c, sz) => {
      const grd = c.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
      grd.addColorStop(0, 'rgba(255, 226, 150, .9)');
      grd.addColorStop(0.45, 'rgba(255, 200, 110, .35)');
      grd.addColorStop(1, 'rgba(255, 190, 90, 0)');
      c.fillStyle = grd;
      c.fillRect(0, 0, sz, sz);
    });
  }

  // A cork pushed into the mouth of a complete tube; t = seconds since it went on (pops in with an overshoot).
  function drawCork(g, i, t) {
    const G = geo(), u = G.u;
    const p = Math.min(1, t / 0.42);
    const dy = -(1 - Fx.ease.outBack(p)) * u * 0.9;
    const sq = 1 + 0.18 * Fx.ease.pulse((t - 0.24) / 0.22);
    g.save();
    g.globalAlpha = Math.min(1, t / 0.08);
    g.translate(0, dy);
    g.scale(sq, 1 / sq);
    const top = -u * 0.26, bot = u * 0.24, wt = G.iw * 1.08, wb = G.iw * 0.92, ery = u * 0.075;
    const cg = g.createLinearGradient(-wt, 0, wt, 0);
    cg.addColorStop(0, '#b77a45');
    cg.addColorStop(0.28, '#e9b981');
    cg.addColorStop(0.62, '#c78b53');
    cg.addColorStop(1, '#7c4d28');
    g.fillStyle = cg;
    g.beginPath();
    g.moveTo(-wt, top); g.lineTo(-wb, bot);
    g.ellipse(0, bot, wb, ery, 0, Math.PI, 0, true);
    g.lineTo(wt, top); g.closePath();
    g.fill();
    // a band of the tube's colour: the seal
    const col = PALETTE[s.tubes[i][0]] ? PALETTE[s.tubes[i][0]].color : '#ffffff';
    const by = -u * 0.07;
    const sg = g.createLinearGradient(-wt, 0, wt, 0);
    sg.addColorStop(0, shade(col, -0.1));
    sg.addColorStop(0.3, shade(col, 0.35));
    sg.addColorStop(1, shade(col, -0.45));
    g.fillStyle = sg;
    g.beginPath();
    g.ellipse(0, by - u * 0.05, wt * 1.01, ery, 0, Math.PI, 0, true);
    g.ellipse(0, by + u * 0.03, wt * 0.99, ery, 0, 0, Math.PI, false);
    g.closePath();
    g.fill();
    // the top face with a few pores
    const tg = g.createLinearGradient(0, top - ery, 0, top + ery);
    tg.addColorStop(0, '#f7d6a6');
    tg.addColorStop(1, '#d9a266');
    g.fillStyle = tg;
    g.beginPath(); g.ellipse(0, top, wt, ery, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(110, 62, 26, .45)';
    for (let k = 0; k < 6; k++) {
      const a = k * 2.4 + i, r = wt * (0.25 + (k % 3) * 0.22);
      g.beginPath(); g.arc(Math.cos(a) * r, top + Math.sin(a) * ery * 0.6, u * 0.014, 0, TAU); g.fill();
    }
    g.fillStyle = 'rgba(255, 255, 255, .5)';
    g.beginPath(); g.ellipse(-wt * 0.45, top - ery * 0.2, wt * 0.22, ery * 0.3, -0.2, 0, TAU); g.fill();
    g.restore();
  }

  function drawTube(i) {
    const box = lay.tubes[i];
    if (!box) return;
    const G = geo(), u = G.u, gs = glassSprites();
    const P = poseOf(i);
    const pouring = anim && i === anim.a;
    const ground = box.y + box.h;
    if (!pouring) {
      // contact shadow and a faint reflection on the glossy shelf, both fading as the tube rises
      const rise = Math.max(0, box.y - P.y) / (V.LIFT * u);
      const near = 1 / (1 + rise * 1.4);
      Fx.shadow(ctx, P.x, ground + u * 0.02, box.w * (0.62 - rise * 0.12), u * 0.1, 0.55 * near);
      const contents = s.tubes[i];
      if (contents.length && !(anim && i === anim.b && !anim.before[i].length)) {
        const col = PALETTE[contents[0]].color;
        ctx.save();
        ctx.translate(P.x, ground);
        ctx.globalAlpha = near;
        ctx.fillStyle = cachedGrad('refl|' + col, () => {
          const rg = ctx.createLinearGradient(0, 0, 0, u * 0.12);
          rg.addColorStop(0, withA(col, 0.38));
          rg.addColorStop(1, withA(col, 0));
          return rg;
        });
        ctx.beginPath(); ctx.ellipse(0, u * 0.02, G.iw * 0.9, u * 0.1, 0, 0, Math.PI); ctx.fill();
        ctx.restore();
      }
    }
    const picked = i === sel ? Math.min(1, Math.max(0, lifts[i])) : 0;
    ctx.save();
    ctx.translate(P.x, P.y);
    if (picked > 0.01) {
      const a0 = ctx.globalAlpha, op = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = picked * (0.32 + 0.08 * Math.sin(time * 5));
      ctx.drawImage(haloSprite(), -box.w * 1.15, -u * 0.6, box.w * 2.3, box.h + u * 1.2);
      ctx.globalAlpha = a0;
      ctx.globalCompositeOperation = op;
    }
    ctx.rotate(P.angle);
    drawSprite(ctx, gs.back, gs);
    ctx.rotate(-P.angle);
    drawLiquid(ctx, i, contentsOf(i), P.angle);
    ctx.rotate(P.angle);
    drawSprite(ctx, gs.front, gs);
    if (picked > 0.01) {
      ctx.save();
      ctx.shadowColor = 'rgba(255, 196, 90, .95)';
      ctx.shadowBlur = u * 0.3 * lay.dpr;
      ctx.strokeStyle = `rgba(255, 222, 140, ${0.85 * picked})`;
      ctx.lineWidth = Math.max(1.5, u * 0.045);
      tubePath(ctx, -box.w / 2, 0, box.w, box.h);
      ctx.stroke();
      ctx.restore();
    }
    if (corkT[i] != null && !pouring) drawCork(ctx, i, corkT[i]);
    ctx.restore();
    if (i === cursor && phase === 'play') {
      ctx.save();
      ctx.strokeStyle = 'rgba(195, 139, 255, .95)';
      ctx.shadowColor = 'rgba(195, 139, 255, .8)';
      ctx.shadowBlur = 8 * lay.dpr;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      Fx.rrect(ctx, box.x - u * 0.2, box.y - u * 0.25, box.w + u * 0.4, box.h + u * 0.4, u * 0.25);
      ctx.stroke();
      ctx.restore();
    }
  }

  const bez = (a, b, c, d, t) => { const k = 1 - t; return k * k * k * a + 3 * k * k * t * b + 3 * k * t * t * c + t * t * t * d; };

  // The stream: a curved ribbon from the lower lip of the pouring tube down into the target's liquid.
  function drawStream() {
    if (!anim) return;
    const P = pourPose();
    const tl = anim.tl, tf = anim.t - tl.move - tl.tilt;
    if (tf <= 0) return;
    const head = Math.min(1, tf / 0.07), tail = Math.max(0, Math.min(1, (tf - tl.flow) / 0.1));
    if (tail >= 1) return;
    const G = geo(), u = G.u;
    const D = poseOf(anim.b), dst = lay.tubes[anim.b];
    const filled = anim.before[anim.b].length + smooth(P.st.flow) * anim.n;
    const endY = D.y + G.hb - filled * G.lh;
    // lower lip, in screen space
    const lx = G.iw * P.dir, c = Math.cos(P.angle), sn = Math.sin(P.angle);
    const x0 = P.x + lx * c, y0 = P.y + lx * sn;
    const x3 = dst.x + dst.w / 2, y3 = endY;
    const x1 = x0 + P.dir * u * 0.22, y1 = y0 + u * 0.02;
    const x2 = x3, y2 = y0 + (y3 - y0) * 0.35;
    const col = PALETTE[anim.color].color;
    const N = 16, L = [], R = [];
    const w0 = u * 0.17, w1 = u * 0.1;
    for (let k = 0; k <= N; k++) {
      const t = tail + (head - tail) * (k / N);
      const x = bez(x0, x1, x2, x3, t), y = bez(y0, y1, y2, y3, t);
      const dx = bez(x0, x1, x2, x3, Math.min(1, t + 0.01)) - bez(x0, x1, x2, x3, Math.max(0, t - 0.01));
      const dy = bez(y0, y1, y2, y3, Math.min(1, t + 0.01)) - bez(y0, y1, y2, y3, Math.max(0, t - 0.01));
      const len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
      const hw = ((w0 + (w1 - w0) * t) / 2) * (1 + 0.12 * Math.sin(time * 38 - t * 12));
      L.push([x + nx * hw, y + ny * hw]);
      R.push([x - nx * hw, y - ny * hw, x, y, nx, ny, hw]);
    }
    ctx.save();
    const sg = ctx.createLinearGradient(x3 - u * 0.12, 0, x3 + u * 0.12, 0);
    sg.addColorStop(0, shade(col, 0.35));
    sg.addColorStop(0.5, col);
    sg.addColorStop(1, shade(col, -0.3));
    ctx.fillStyle = sg;
    ctx.beginPath();
    for (const p of L) ctx.lineTo(p[0], p[1]);
    for (let k = R.length - 1; k >= 0; k--) ctx.lineTo(R[k][0], R[k][1]);
    ctx.closePath();
    ctx.fill();
    // a glossy highlight running down the stream
    ctx.strokeStyle = 'rgba(255, 255, 255, .6)';
    ctx.lineWidth = Math.max(1, u * 0.025);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const r of R) { const o = -r[6] * 0.4 * P.dir; ctx.lineTo(r[2] + r[4] * o, r[3] + r[5] * o); }
    ctx.stroke();
    ctx.restore();
    // the target's glass passes in front of the stream inside it
    const gs = glassSprites();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x3 - u * 0.2, D.y + RIM_RY * u, u * 0.4, Math.max(0, endY - D.y));
    ctx.clip();
    ctx.translate(D.x, D.y);
    drawSprite(ctx, gs.front, gs);
    ctx.restore();
    // where it lands: foam and droplets
    if (head >= 1 && tf < tl.flow) {
      ctx.fillStyle = 'rgba(255, 255, 255, .45)';
      ctx.beginPath(); ctx.ellipse(x3, endY, u * (0.16 + 0.03 * Math.sin(time * 30)), u * 0.035, 0, 0, TAU); ctx.fill();
      while (splashAcc > 0.03) {
        splashAcc -= 0.03;
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
        const sp = u * (1.2 + Math.random() * 1.4);
        fxp.emit({ x: x3 + (Math.random() - 0.5) * u * 0.1, y: endY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, gravity: u * 14, life: 0.32, size: u * (0.025 + Math.random() * 0.025), color: shade(col, 0.15) });
      }
    } else splashAcc = 0;
  }

  // The backdrop of the board: a soft pool of light, bokeh, and the glossy shelves, baked when the layout changes.
  let bg = null, bgKey = '';
  function backdrop() {
    const key = `${lay.w}x${lay.h}|${lay.tubes.length}|${lay.unit}`;
    if (bg && bgKey === key) return bg;
    bgKey = key;
    const u = lay.unit, W = lay.cssW, H = lay.cssH, dpr = lay.dpr;
    const mk = () => { const cv = document.createElement('canvas'); cv.width = lay.w; cv.height = lay.h; const g = cv.getContext('2d'); g.scale(dpr, dpr); return [cv, g]; };
    const [glowCv, gg] = mk();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rows = new Map();
    for (const tb of lay.tubes) {
      const yb = tb.y + tb.h;
      const r = rows.get(yb) || { yb, x0: Infinity, x1: -Infinity, top: tb.y };
      r.x0 = Math.min(r.x0, tb.x); r.x1 = Math.max(r.x1, tb.x + tb.w);
      rows.set(yb, r);
    }
    for (const r of rows.values()) {
      const cy = (r.top + r.yb) / 2, rx = W * 0.62, ry = (r.yb - r.top) * 0.85;
      gg.save();
      gg.translate(W / 2, cy);
      gg.scale(1, ry / rx);
      const pg = gg.createRadialGradient(0, 0, 0, 0, 0, rx);
      pg.addColorStop(0, 'rgba(176, 140, 255, .2)');
      pg.addColorStop(0.6, 'rgba(140, 100, 240, .07)');
      pg.addColorStop(1, 'rgba(120, 80, 220, 0)');
      gg.fillStyle = pg;
      gg.beginPath(); gg.arc(0, 0, rx, 0, TAU); gg.fill();
      gg.restore();
    }
    const bokeh = ['#ff6fd0', '#4aa3ff', '#c38bff', '#28c2b4', '#ffd34d', '#ffffff'];
    for (let k = 0; k < 14; k++) {
      const x = rnd() * W, y = rnd() * H, r = u * (0.15 + rnd() * 0.55), col = bokeh[(rnd() * bokeh.length) | 0];
      const a = 0.04 + rnd() * 0.06;
      const bgr = gg.createRadialGradient(x, y, 0, x, y, r);
      bgr.addColorStop(0, withA(col, a * 0.7));
      bgr.addColorStop(0.75, withA(col, a));
      bgr.addColorStop(0.9, withA(col, a * 0.5));
      bgr.addColorStop(1, withA(col, 0));
      gg.fillStyle = bgr;
      gg.beginPath(); gg.arc(x, y, r, 0, TAU); gg.fill();
    }
    // fade the glow out towards the canvas edges so the board melts into the page
    gg.globalCompositeOperation = 'destination-in';
    const fx = gg.createLinearGradient(0, 0, W, 0);
    fx.addColorStop(0, 'rgba(0,0,0,0)'); fx.addColorStop(0.12, '#000'); fx.addColorStop(0.88, '#000'); fx.addColorStop(1, 'rgba(0,0,0,0)');
    gg.fillStyle = fx; gg.fillRect(0, 0, W, H);
    const fy = gg.createLinearGradient(0, 0, 0, H);
    fy.addColorStop(0, 'rgba(0,0,0,0)'); fy.addColorStop(0.1, '#000'); fy.addColorStop(0.9, '#000'); fy.addColorStop(1, 'rgba(0,0,0,0)');
    gg.fillStyle = fy; gg.fillRect(0, 0, W, H);

    const [cv, g] = mk();
    g.drawImage(glowCv, 0, 0, W, H);
    for (const r of rows.values()) {
      const x0 = r.x0 - u * 0.4, x1 = r.x1 + u * 0.4, yb = r.yb;
      const topH = u * 0.2, frontH = u * 0.15, yt = yb - topH * 0.45;
      Fx.shadow(g, (x0 + x1) / 2, yt + topH + frontH + u * 0.02, (x1 - x0) * 0.55, u * 0.1, 0.55);
      // front face
      const fg = g.createLinearGradient(0, yt + topH, 0, yt + topH + frontH);
      fg.addColorStop(0, '#3b2f73');
      fg.addColorStop(1, '#1a1338');
      g.fillStyle = fg;
      Fx.rrect(g, x0, yt + topH - u * 0.04, x1 - x0, frontH + u * 0.04, u * 0.06);
      g.fill();
      // glossy top face, lit from the front-left
      const tg = g.createLinearGradient(0, yt, 0, yt + topH);
      tg.addColorStop(0, '#5a4aa0');
      tg.addColorStop(1, '#7e6cc8');
      g.fillStyle = tg;
      Fx.rrect(g, x0, yt, x1 - x0, topH, u * 0.06);
      g.fill();
      const sh = g.createLinearGradient(x0, 0, x1, 0);
      sh.addColorStop(0, 'rgba(255, 255, 255, .22)');
      sh.addColorStop(0.3, 'rgba(255, 255, 255, .05)');
      sh.addColorStop(0.65, 'rgba(255, 255, 255, .1)');
      sh.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = sh;
      Fx.rrect(g, x0, yt, x1 - x0, topH, u * 0.06);
      g.fill();
      // bright front edge
      g.fillStyle = 'rgba(235, 225, 255, .55)';
      g.fillRect(x0 + u * 0.06, yt + topH - 1, x1 - x0 - u * 0.12, Math.max(1, u * 0.02));
      g.fillStyle = 'rgba(255, 255, 255, .3)';
      g.fillRect(x0 + u * 0.08, yt + 0.5, (x1 - x0) * 0.4, 1);
    }
    bg = cv;
    return bg;
  }

  function draw() {
    ctx.setTransform(lay.dpr, 0, 0, lay.dpr, 0, 0);
    ctx.clearRect(0, 0, lay.cssW, lay.cssH);
    if (!s) return;
    ctx.drawImage(backdrop(), 0, 0, lay.cssW, lay.cssH);
    // the moving tube last, so it flies over the others
    for (let i = 0; i < s.tubes.length; i++) if (!(anim && i === anim.a)) drawTube(i);
    drawStream();
    if (anim) drawTube(anim.a);
    fxp.draw(ctx);
    if (flash > 0) Fx.glow(ctx, lay.cssW / 2, lay.cssH * 0.45, Math.min(lay.cssW, lay.cssH) * 0.5, '#ffe6a8', flash * 0.45);
  }
  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ───────────── HUD, tips, screens ─────────────
  function showTip(text) {
    const el = $('tip');
    el.hidden = !text;
    if (text) el.textContent = t(text);
  }

  function renderHUD() {
    if (!s) return;
    $('hud-level').textContent = t('Уровень {n}', { n: level + 1 });
    $('hud-moves').textContent = t('Ходы: {n}', { n: s.moves });
    $('hud-par').textContent = t('Пар: {n}', { n: s.level.par });
    $('hud-par').classList.toggle('over', s.moves > s.level.par);
    const playing = phase === 'play';
    $('btn-undo').disabled = !playing || !s.history.length;
    $('btn-restart').disabled = !playing || !s.history.length;
    $('btn-tube').disabled = !playing || s.extraUsed || s.status === 'won';
  }

  function starsHTML(n) {
    let h = '';
    for (let i = 0; i < 3; i++) h += `<span class="${i < n ? 'on' : 'off'}">★</span>`;
    return h;
  }

  function showResult() {
    const o = outcome;
    $('res-stars').innerHTML = starsHTML(o.stars);
    $('res-stars').setAttribute('aria-label', t('Звёзды: {n} из 3', { n: o.stars }));
    $('res-moves').textContent = t('Ходы: {n}, пар: {par}', { n: o.moves, par: s.level.par });
    let note;
    if (o.stars === 3) note = t('Идеально: короче не бывает!');
    else if (o.extra && o.moves <= s.level.par) note = t('С лишней колбой — не больше ★★');
    else note = t('Для ★★★ нужно уложиться в {par}', { par: s.level.par });
    $('res-note').textContent = note;
    const hasNext = level + 1 < LEVELS.length;
    $('btn-next').hidden = !hasNext;
    $('res-final').hidden = hasNext;
    show('result');
    (hasNext ? $('btn-next') : $('btn-again')).focus({ preventScroll: true });
  }

  const SCREENS = ['menu', 'levels', 'result'];
  function show(name) {
    for (const id of SCREENS) $(id).hidden = id !== name;
    stage.classList.toggle('dim', !!name);
  }

  const nextLevel = () => Math.min(C.firstUnfinished(progress, LEVELS.length), LEVELS.length - 1);

  function showMenu() {
    finishAnim();
    if (phase === 'play') saveCurrent();
    const r = restored();
    if (r) loadLevel(r.level, r.state);
    else loadLevel(nextLevel());
    setPhase('menu');
    $('hud').hidden = true;
    $('controls').hidden = true;
    showTip(null);
    $('btn-play').textContent = r ? t('Продолжить: уровень {n}', { n: r.level + 1 }) : t('Играть: уровень {n}', { n: level + 1 });
    renderSound();
    show('menu');
    $('btn-play').focus({ preventScroll: true });
  }

  function showLevels() {
    finishAnim();
    if (phase === 'play') saveCurrent();
    setPhase('menu');
    const grid = $('level-grid');
    grid.innerHTML = '';
    let total = 0;
    LEVELS.forEach((_, i) => {
      const n = C.starsOf(progress, i);
      total += n;
      const open = C.unlocked(progress, i, LEVELS.length);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lvl-btn' + (open ? '' : ' locked') + (n ? ' done' : '');
      b.disabled = !open;
      b.innerHTML = `<b>${i + 1}</b>` + (open ? `<span class="mini-stars">${starsHTML(n)}</span>` : '<i class="lock" aria-hidden="true"></i>');
      b.setAttribute('aria-label', open ? t('Уровень {n}, звёзды: {s} из 3', { n: i + 1, s: n }) : t('Уровень {n} закрыт', { n: i + 1 }));
      b.addEventListener('click', () => startLevel(i));
      grid.append(b);
    });
    $('levels-total').textContent = t('Звёзд: {n} из {total}', { n: total, total: LEVELS.length * 3 });
    $('hud').hidden = true;
    $('controls').hidden = true;
    showTip(null);
    show('levels');
    const cur = grid.children[nextLevel()];
    if (cur) {
      cur.focus({ preventScroll: true });
      cur.scrollIntoView({ block: 'nearest' });
    }
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
  canvas.addEventListener('pointerdown', (e) => {
    if (phase !== 'play') return;
    const r = canvas.getBoundingClientRect();
    const i = V.tubeAt(lay, e.clientX - r.left, e.clientY - r.top);
    cursor = -1;
    if (i >= 0) tap(i);
    else if (sel >= 0) { sel = -1; renderHUD(); }
    e.preventDefault();
  });

  // Keys that pick tubes: 1–9, 0 for the first ten, then Q W E R Y.
  const TUBE_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
    'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyY'];

  // Arrow keys move the keyboard cursor through the tubes in reading order (up/down jump between rows).
  function moveCursor(dx, dy) {
    const n = s.tubes.length;
    if (cursor < 0) { cursor = sel >= 0 ? sel : 0; return; }
    if (dx) cursor = (cursor + dx + n) % n;
    if (dy && lay.rows > 1) {
      const perRow = Math.ceil(n / 2);
      const next = cursor + dy * perRow;
      if (next >= 0 && next < n) cursor = next;
      else if (dy > 0) cursor = n - 1;
    }
  }

  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (phase === 'play') {
      const k = TUBE_KEYS.indexOf(e.code);
      if (k >= 0) { cursor = -1; tap(k); e.preventDefault(); return; }
      if (ARROWS[e.code]) { moveCursor(...ARROWS[e.code]); e.preventDefault(); return; }
      if ((e.code === 'Enter' || e.code === 'Space') && cursor >= 0 && document.activeElement === canvas) {
        tap(cursor); e.preventDefault(); return;
      }
      if (e.code === 'KeyZ') { undo(); e.preventDefault(); return; }
      if (e.code === 'KeyT') { addTube(); e.preventDefault(); return; }
      if (e.code === 'Backspace') { restart(); e.preventDefault(); return; }
    }
    if (e.code === 'Escape') {
      if (phase === 'play' && (sel >= 0 || cursor >= 0)) { sel = -1; cursor = -1; renderHUD(); }
      else if (!$('levels').hidden) showMenu();
    }
  });

  $('btn-play').addEventListener('click', () => {
    const r = restored();
    startLevel(r ? r.level : nextLevel());
  });
  $('btn-levels-menu').addEventListener('click', showLevels);
  $('btn-sound-menu').addEventListener('click', toggleSound);
  $('btn-levels-back').addEventListener('click', showMenu);
  $('btn-levels').addEventListener('click', showLevels);
  $('btn-sound').addEventListener('click', toggleSound);
  const backToBoard = (fn) => () => { fn(); if (phase === 'play') canvas.focus({ preventScroll: true }); };
  $('btn-undo').addEventListener('click', backToBoard(undo));
  $('btn-restart').addEventListener('click', backToBoard(restart));
  $('btn-tube').addEventListener('click', backToBoard(addTube));
  $('btn-next').addEventListener('click', () => startLevel(level + 1, C.newGame(LEVELS[level + 1])));
  $('btn-again').addEventListener('click', () => startLevel(level, C.newGame(LEVELS[level])));
  $('btn-res-levels').addEventListener('click', showLevels);
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  window.addEventListener('pagehide', () => { if (phase === 'play') saveCurrent(); });

  // ───────────── Boot ─────────────
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = t(meta.content);
  const actions = $('top-actions');
  actions.append(window.I18n.toggle('chip'));
  if (window.GameNav) actions.append(window.GameNav.home('chip'));
  showMenu();
  requestAnimationFrame(frame);
})();
