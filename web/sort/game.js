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
  let sparkles = [];
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
    while (lifts.length < n) { lifts.push(0); shakes.push(0); }
    lifts.length = n;
    shakes.length = n;
  }

  function loadLevel(i, state) {
    level = i;
    s = state || C.newGame(LEVELS[i]);
    sel = -1;
    cursor = -1;
    anim = null;
    lifts = [];
    shakes = [];
    sparkles = [];
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
      burst(b, PALETTE[s.tubes[b][0]].color);
    }
    if (phase === 'won') sfx('win');
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
      sfx('lift');
    } else if (sel === i) {
      sel = -1;
    } else if (C.canPour(s, sel, i)) {
      pour(sel, i);
    } else {
      shakes[i] = 0.35;
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
  function burst(i, color) {
    const tb = lay.tubes[i];
    if (!tb) return;
    for (let k = 0; k < 18; k++) {
      const a = Math.random() * TAU;
      const sp = (0.8 + Math.random() * 1.6) * lay.unit;
      sparkles.push({
        x: tb.x + tb.w / 2, y: tb.y + tb.h * 0.15, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - lay.unit,
        life: 0.7 + Math.random() * 0.4, t: 0, color: k % 3 ? color : '#fff',
      });
    }
  }

  function update(dt) {
    time += dt;
    phaseT += dt;
    if (anim) {
      anim.t += dt;
      if (anim.t >= anim.tl.total) finishAnim();
    }
    for (let i = 0; i < lifts.length; i++) {
      const want = i === sel ? 1 : 0;
      lifts[i] += (want - lifts[i]) * Math.min(1, dt * 16);
      shakes[i] = Math.max(0, shakes[i] - dt);
    }
    for (const p of sparkles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 3 * lay.unit * dt;
    }
    sparkles = sparkles.filter((p) => p.t < p.life);
    $('stuck').hidden = !(phase === 'play' && !anim && s && s.status === 'stuck');
    $('btn-tube').classList.toggle('glow', phase === 'play' && s && s.status === 'stuck');
    if (phase === 'won' && !anim && phaseT > 0.9 && $('result').hidden) showResult();
  }

  // ───────────── Drawing ─────────────
  // The glass outline of a tube box (open top, round bottom).
  function tubePath(g, x, y, w, h) {
    const r = w / 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y + h - r);
    g.arc(x + r, y + h - r, r, Math.PI, 0, true);
    g.lineTo(x + w, y);
  }

  // A pattern over a layer box (clip already set to the tube's inside), drawn in a light translucent ink.
  function drawPattern(g, kind, x, y, w, h, u) {
    if (kind === 'plain') return;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,.38)';
    g.fillStyle = 'rgba(255,255,255,.38)';
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

  // Liquid in a tube drawn at (x, y) top-left: `layers` as [{ c, a }] with amounts in layers (bottom first).
  function drawLiquid(g, x, y, w, h, layers) {
    const u = lay.unit;
    const lh = V.LAYER_H * u;
    const bottom = y + h - 0.06 * u;
    g.save();
    tubePath(g, x + 0.06 * u, y, w - 0.12 * u, h - 0.06 * u);
    g.closePath();
    g.clip();
    let level = 0;
    let top = null;
    for (const { c, a } of layers) {
      if (a <= 0.001) continue;
      const pal = PALETTE[c];
      const y1 = bottom - (level + a) * lh;
      const y0 = bottom - level * lh;
      const grad = g.createLinearGradient(x, 0, x + w, 0);
      grad.addColorStop(0, shade(pal.color, 0.25));
      grad.addColorStop(0.45, pal.color);
      grad.addColorStop(1, shade(pal.color, -0.3));
      g.fillStyle = grad;
      g.fillRect(x, y1, w, y0 - y1 + 0.5);
      drawPattern(g, pal.pattern, x, y1, w, y0 - y1, u);
      // a thin dark seam between layers
      if (level > 0) {
        g.fillStyle = 'rgba(0,0,0,.18)';
        g.fillRect(x, y0 - 0.5, w, 1);
      }
      level += a;
      top = { y: y1, color: pal.color };
    }
    if (top) {
      // the meniscus: a light ellipse on the surface
      g.fillStyle = shade(top.color, 0.45);
      g.globalAlpha = 0.85;
      g.beginPath();
      g.ellipse(x + w / 2, top.y, w * 0.42, u * 0.07, 0, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }
    g.restore();
  }

  function drawGlass(g, x, y, w, h, picked) {
    const u = lay.unit;
    // back of the glass
    tubePath(g, x, y, w, h);
    g.closePath();
    g.fillStyle = 'rgba(255,255,255,.05)';
    g.fill();
    return () => {
      // front: outline, rim and a highlight streak
      tubePath(g, x, y, w, h);
      g.lineWidth = Math.max(1.5, u * 0.06);
      g.strokeStyle = picked ? 'rgba(255,236,170,.95)' : 'rgba(225,215,255,.6)';
      g.stroke();
      g.beginPath();
      g.ellipse(x + w / 2, y, w / 2 + u * 0.06, u * 0.07, 0, 0, TAU);
      g.strokeStyle = picked ? 'rgba(255,236,170,.95)' : 'rgba(225,215,255,.7)';
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,.18)';
      g.fillRect(x + w * 0.16, y + u * 0.25, w * 0.1, h - u * 0.9);
    };
  }

  // What tube i shows right now: during a pour the source drains and the target fills.
  function contentsOf(i) {
    if (!anim) return s.tubes[i].map((c) => ({ c, a: 1 }));
    const flow = V.pourAt(anim.tl, anim.t).flow * anim.n;
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

  // Where a pouring tube's mouth (the pivot it turns around) is and how far it is turned.
  function pourPose() {
    const st = V.pourAt(anim.tl, anim.t);
    const u = lay.unit;
    const src = lay.tubes[anim.a], dst = lay.tubes[anim.b];
    const dir = src.x <= dst.x ? 1 : -1;
    const homeX = src.x + src.w / 2, homeY = src.y - V.LIFT * u;
    const tx = dst.x + dst.w / 2, ty = dst.y - V.POUR_HOVER * u;
    const m = V.easeInOut(st.back > 0 ? 1 - st.back : st.move);
    return { x: homeX + (tx - homeX) * m, y: homeY + (ty - homeY) * m, angle: dir * V.easeOut(st.tilt) * V.POUR_ANGLE, st };
  }

  function drawTube(i) {
    const box = lay.tubes[i];
    const u = lay.unit;
    // Every tube is drawn around the middle of its mouth: picked tubes rise, the pouring one flies and turns.
    let px = box.x + box.w / 2, py = box.y - lifts[i] * V.LIFT * u, angle = 0;
    if (shakes[i] > 0) px += Math.sin(shakes[i] * 60) * u * 0.06 * (shakes[i] / 0.35);
    if (anim && i === anim.a) ({ x: px, y: py, angle } = pourPose());
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    const x = -box.w / 2, y = 0;
    const front = drawGlass(ctx, x, y, box.w, box.h, i === sel);
    drawLiquid(ctx, x, y, box.w, box.h, contentsOf(i));
    front();
    ctx.restore();
    if (i === cursor && phase === 'play') {
      ctx.strokeStyle = 'rgba(195,139,255,.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(box.x - u * 0.18, box.y - u * 0.18, box.w + u * 0.36, box.h + u * 0.3);
      ctx.setLineDash([]);
    }
  }

  function drawStream() {
    if (!anim) return;
    const { x: mouthX, y: mouthY, st } = pourPose();
    if (st.flow <= 0 || st.flow >= 1) return;
    const u = lay.unit;
    const dst = lay.tubes[anim.b];
    const filled = anim.before[anim.b].length + st.flow * anim.n;
    const surf = V.layerBox(lay, dst, Math.max(0, Math.ceil(filled) - 1));
    const endY = surf.y + surf.h * (Math.ceil(filled) - filled);
    const w = u * (0.16 + 0.04 * Math.sin(time * 30));
    const col = PALETTE[anim.color].color;
    const grad = ctx.createLinearGradient(mouthX - w, 0, mouthX + w, 0);
    grad.addColorStop(0, shade(col, 0.3));
    grad.addColorStop(1, shade(col, -0.2));
    ctx.fillStyle = grad;
    ctx.fillRect(mouthX - w / 2, mouthY, w, Math.max(0, endY - mouthY));
    // splash
    ctx.fillStyle = shade(col, 0.4);
    for (let k = 0; k < 3; k++) {
      const a = time * 20 + k * 2.1;
      ctx.beginPath();
      ctx.arc(mouthX + Math.cos(a) * u * 0.18, endY - Math.abs(Math.sin(a)) * u * 0.12, u * 0.035, 0, TAU);
      ctx.fill();
    }
  }

  function drawShelves() {
    const u = lay.unit;
    const rows = new Map();
    for (const tb of lay.tubes) rows.set(tb.y + tb.h, Math.min(rows.get(tb.y + tb.h) ?? Infinity, tb.x));
    for (const [yb] of rows) {
      const inRow = lay.tubes.filter((tb) => tb.y + tb.h === yb);
      const x0 = inRow[0].x - u * 0.35, x1 = inRow[inRow.length - 1].x + inRow[0].w + u * 0.35;
      const grad = ctx.createLinearGradient(0, yb, 0, yb + u * 0.22);
      grad.addColorStop(0, '#5a4a8a');
      grad.addColorStop(1, '#2a2148');
      ctx.fillStyle = grad;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0, yb - u * 0.02, x1 - x0, u * 0.2, u * 0.08); else ctx.rect(x0, yb - u * 0.02, x1 - x0, u * 0.2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.fillRect(x0 + u * 0.1, yb + u * 0.2, x1 - x0 - u * 0.2, u * 0.08);
    }
  }

  function draw() {
    ctx.setTransform(lay.dpr, 0, 0, lay.dpr, 0, 0);
    ctx.clearRect(0, 0, lay.cssW, lay.cssH);
    if (!s) return;
    drawShelves();
    // the moving tube last, so it flies over the others
    const order = s.tubes.map((_, i) => i).filter((i) => !(anim && i === anim.a));
    for (const i of order) drawTube(i);
    drawStream();
    if (anim) drawTube(anim.a);
    for (const p of sparkles) {
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, lay.unit * 0.05, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
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
