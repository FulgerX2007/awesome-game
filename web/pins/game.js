'use strict';
// Тяни штифт — client: screens, input, the fixed-step loop and the Canvas 2D art. The rules live in
// core.js (window.PinsCore), the levels in levels.js (window.PinsLevels), pure helpers in view.js (window.PinsView).
(() => {
  const C = window.PinsCore;
  const V = window.PinsView;
  const Fx = window.Fx;
  const { LEVELS, CHAPTERS } = window.PinsLevels;
  const { t } = window.I18n;
  const { W, H, EMPTY, WALL, WATER, LAVA, STONE, GOLD, GAS, BOMB, NEIGHBOURS } = C;
  const { CELL, LW, LH, hash2, clamp } = V;
  const $ = (id) => document.getElementById(id);
  // A rounded rectangle path; older browsers without roundRect get a plain one.
  const rrect = (g, x, y, w, h, r) => (g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h));

  // Storage access itself may throw (blocked site data); core's progress functions tolerate a null storage.
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }

  // Sound comes from audio.js (index.html loads it first); its play() is silent while the sound is off.
  const Sound = window.PinsAudio;
  const sfx = (name) => Sound.play(name);

  // The win walk: the hero cheers, walks to the exit (V.walkTime), fades through the door, then the result shows.
  const CHEER_T = 0.5;   // seconds of cheering before the walk
  const DOOR_T = 0.5;    // seconds to open the door / fade through it
  const WALK_TAIL = 0.6; // seconds after reaching the door before the result screen

  // One-line lessons for the teaching levels (by 0-based level), shown until the first pull.
  const TIPS = {
    0: 'Потяни штифт, чтобы золото упало к герою',
    1: 'Вода не опасна: золото тонет в ней',
    2: 'Лава сжигает золото. Успей уронить его раньше',
    3: 'Сожги врага лавой, пока он не добрался до героя',
    4: 'Вода и лава вместе дают камень',
    30: 'Газ поднимается вверх и душит врагов',
    36: 'Лава взрывает бочку, а взрыв пробивает камень',
  };

  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  let progress = C.loadProgress(storage);
  let level = 0;
  let s = null;            // core state of the level on screen
  let phase = 'menu';      // menu | play | walk | lose | end
  let phaseT = 0;          // seconds in the current phase
  let acc = 0;             // fixed-step accumulator (ticks)
  let drag = null;         // the pull gesture in progress (view.dragStart)
  let pulled = [];         // pins sliding out: { pin, t }
  let burning = [];        // enemies burning up: { e, t }
  let prevGrid = null;
  let prevGold = 0;
  let deadSeen = [];
  let outcome = null;      // { won, reason, stars, gold }
  let hint = null;         // pin id to point at: on level 1 and after the hint button, until the next pull
  let speed = 1;           // 1 or 2: the fast-forward button runs the automaton twice as fast
  let flashes = [];        // keg blasts: { x, y, t } in logical px
  let time = 0;
  let last = 0;

  // ───────────── Canvas size and cached art ─────────────
  // The look: 2.5D with a fixed front camera and one light from the top left (Fx.LIGHT). The rock is a
  // bevelled masonry face; chambers are recessed into it (inner shadow, ambient occlusion, a lit floor ledge).
  // Everything that never changes during a level is baked into one offscreen layer; per-frame drawing uses
  // cached sprites and patterns only, never a gradient per cell.
  const TAU = Math.PI * 2;
  let fit = V.fitCanvas({ w: LW, h: LH, dpr: 1 });
  let k = 1;               // device px per logical px
  let staticLayer = null;  // rock, chamber backs and edges of the current level
  let staticKey = '';
  const sprites = {};
  const fx = new Fx.Particles(260);  // steam, smoke, sparks, splashes, debris, confetti (capped pool)
  const quake = new Fx.Shake(7, 1.7); // visual only: offsets the drawing, never the input

  // Fits the canvas into the stage. Runs on window resizes and whenever the stage itself changes size
  // (the HUD showing up or wrapping onto a second line).
  function resize() {
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const next = V.fitCanvas({ w: stage.clientWidth - padX, h: stage.clientHeight - padY, dpr: window.devicePixelRatio || 1 });
    if (next.w === canvas.width && next.h === canvas.height && next.cssW === fit.cssW && sprites.coin) return;
    fit = next;
    k = fit.scale * fit.ratio;
    canvas.style.width = fit.cssW + 'px';
    canvas.style.height = fit.cssH + 'px';
    canvas.width = fit.w;
    canvas.height = fit.h;
    buildSprites();
    staticKey = '';
  }

  // An offscreen canvas sized in logical px (w×h) at the current device resolution, drawn in logical units.
  function offscreen(w, h) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w * k));
    cv.height = Math.max(1, Math.ceil(h * k));
    const g = cv.getContext('2d');
    g.setTransform(cv.width / w, 0, 0, cv.height / h, 0, 0);
    return { cv, g };
  }

  // A repeating pattern of a T×T logical tile, mapped back to logical units on the main canvas.
  function tilePattern(T, paint) {
    const { cv, g } = offscreen(T, T);
    // Everything painted three times over (shifted by ±T) so the tile wraps seamlessly.
    for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) { g.save(); g.translate(ox, oy); paint(g, T); g.restore(); }
    const pat = ctx.createPattern(cv, 'repeat');
    if (pat && pat.setTransform && window.DOMMatrix) pat.setTransform(new DOMMatrix([T / cv.width, 0, 0, T / cv.height, 0, 0]));
    return pat;
  }

  // A vertical colour ramp (surface → depth) as a 2×128 px strip, stretched per liquid column.
  function ramp(stops) {
    const cv = document.createElement('canvas');
    cv.width = 2; cv.height = 128;
    const g = cv.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of stops) grd.addColorStop(o, c);
    g.fillStyle = grd;
    g.fillRect(0, 0, 2, 128);
    return cv;
  }

  function buildSprites() {
    // Gold coin, front and tilted: a thick rim under a domed face, an embossed inner ring and a hard glint.
    for (const [name, sy] of [['coin', 1], ['coinTilt', 0.62]]) {
      const { cv, g } = offscreen(12, 12);
      g.translate(6, 5.6);
      const rimG = g.createLinearGradient(-5, 0, 5, 0);
      rimG.addColorStop(0, '#b5740c'); rimG.addColorStop(0.35, '#e0a52a'); rimG.addColorStop(1, '#6e4306');
      g.fillStyle = rimG;
      g.beginPath(); g.ellipse(0, 1.1, 5.1, 5.1 * sy, 0, 0, TAU); g.fill();
      const face = g.createRadialGradient(-1.8, -2 * sy, 0.4, 0, 0, 5.4);
      face.addColorStop(0, '#fff8d2'); face.addColorStop(0.35, '#ffd84f'); face.addColorStop(0.8, '#e9a51e'); face.addColorStop(1, '#b97910');
      g.fillStyle = face;
      g.beginPath(); g.ellipse(0, 0, 5.1, 5.1 * sy, 0, 0, TAU); g.fill();
      g.lineWidth = 0.7;
      g.strokeStyle = 'rgba(150, 92, 8, .75)';
      g.beginPath(); g.ellipse(0, 0, 3.4, 3.4 * sy, 0, -0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
      g.strokeStyle = 'rgba(255, 250, 215, .8)';
      g.beginPath(); g.ellipse(0, 0, 3.4, 3.4 * sy, 0, 0.8 * Math.PI, 1.8 * Math.PI); g.stroke();
      g.fillStyle = 'rgba(170, 105, 10, .55)'; // a small diamond mark in the middle
      g.beginPath(); g.moveTo(0, -1.5 * sy); g.lineTo(1.1, 0); g.lineTo(0, 1.5 * sy); g.lineTo(-1.1, 0); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255, 255, 255, .9)';
      g.beginPath(); g.ellipse(-2, -2.1 * sy, 1.3, 0.7 * sy + 0.15, -0.6, 0, TAU); g.fill();
      sprites[name] = cv;
    }
    // Soft glows (drawn with 'lighter'), a puff of gas, the flash of a blast.
    for (const [name, inner, outer] of [['lavaGlow', 'rgba(255, 150, 40, .55)', 'rgba(255, 80, 0, 0)'],
      ['torchGlow', 'rgba(255, 190, 90, .32)', 'rgba(255, 140, 40, 0)'],
      ['gasPuff', 'rgba(170, 230, 90, .55)', 'rgba(120, 190, 60, 0)'],
      ['heat', 'rgba(255, 200, 120, .22)', 'rgba(255, 120, 40, 0)'],
      ['blastGlow', 'rgba(255, 240, 190, .95)', 'rgba(255, 120, 20, 0)']]) {
      const { cv, g } = offscreen(40, 40);
      const grd = g.createRadialGradient(20, 20, 0, 20, 20, 20);
      grd.addColorStop(0, inner);
      grd.addColorStop(1, outer);
      g.fillStyle = grd;
      g.fillRect(0, 0, 40, 40);
      sprites[name] = cv;
    }
    // A four-pointed twinkle with a soft halo: gold and water sparkles.
    {
      const { cv, g } = offscreen(16, 16);
      const halo = g.createRadialGradient(8, 8, 0, 8, 8, 8);
      halo.addColorStop(0, 'rgba(255, 250, 220, .75)'); halo.addColorStop(0.3, 'rgba(255, 230, 150, .25)'); halo.addColorStop(1, 'rgba(255, 220, 120, 0)');
      g.fillStyle = halo;
      g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#fffef4';
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 ? 1 : 7.5, a = (i / 8) * TAU - Math.PI / 2;
        g.lineTo(8 + Math.cos(a) * r, 8 + Math.sin(a) * r);
      }
      g.closePath(); g.fill();
      sprites.sparkle = cv;
    }
    // Basalt lumps for the stone that forms where water meets lava (three variants).
    for (let v = 0; v < 3; v++) {
      const { cv, g } = offscreen(12, 12);
      const grd = g.createRadialGradient(4 + v * 0.5, 3.5, 0.5, 6, 6, 7);
      grd.addColorStop(0, ['#8d8f99', '#7f8590', '#959089'][v]);
      grd.addColorStop(0.55, ['#555863', '#4c515c', '#5b5650'][v]);
      grd.addColorStop(1, '#2a2b33');
      g.fillStyle = grd;
      Fx.rrect(g, 0.8, 0.8, 10.4, 10.4, 3 + v * 0.6);
      g.fill();
      g.fillStyle = 'rgba(255, 255, 255, .18)';
      g.beginPath(); g.ellipse(4, 3.2, 2.2, 1, -0.4, 0, TAU); g.fill();
      g.fillStyle = 'rgba(10, 8, 20, .35)';
      g.fillRect(3 + v * 2, 7.5 - v, 1.2, 1.2);
      sprites['stone' + v] = cv;
    }
    // Liquids: depth ramps and moving surface textures.
    sprites.waterRamp = ramp([[0, '#a6e6ff'], [0.06, '#56bdf6'], [0.35, '#2d86da'], [1, '#143c94']]);
    sprites.lavaRamp = ramp([[0, '#fff5b0'], [0.05, '#ffc83c'], [0.25, '#ff8a1c'], [0.6, '#dc3b17'], [1, '#8a170c']]);
    sprites.caustics = tilePattern(48, (g, T) => {
      g.strokeStyle = 'rgba(215, 248, 255, .55)';
      g.lineWidth = 0.9;
      for (let i = 0; i < 4; i++) {
        const base = (i + 0.5) * T / 4;
        g.beginPath();
        for (let x = 0; x <= T; x += 2) g.lineTo(x, base + 3.2 * Math.sin(TAU * x / T * (1 + (i % 2)) + i * 1.7) + 1.6 * Math.sin(TAU * x / T * 3 + i));
        g.stroke();
        g.beginPath();
        for (let y = 0; y <= T; y += 2) g.lineTo(base + 3 * Math.sin(TAU * y / T * (2 - (i % 2)) + i * 2.3), y);
        g.stroke();
      }
    });
    sprites.crust = tilePattern(40, (g, T) => {
      // Soft cooler patches (no hard edges) and a few thin dark veins of crust.
      for (let i = 0; i < 6; i++) {
        const x = hash2(i, 1, 71) * T, y = hash2(i, 2, 71) * T, r = 6 + hash2(i, 3, 71) * 8;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(120, 20, 6, .6)');
        grd.addColorStop(1, 'rgba(120, 20, 6, 0)');
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      g.strokeStyle = 'rgba(90, 14, 4, .45)';
      g.lineWidth = 0.7;
      g.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        let x = hash2(i, 8, 72) * T, y = hash2(i, 9, 72) * T;
        g.beginPath(); g.moveTo(x, y);
        for (let j = 0; j < 4; j++) { x += (hash2(i, j, 74) - 0.3) * 9; y += (hash2(j, i, 75) - 0.5) * 7; g.lineTo(x, y); }
        g.stroke();
      }
    });
    sprites.hot = tilePattern(32, (g, T) => {
      for (let i = 0; i < 5; i++) {
        const x = hash2(i, 5, 73) * T, y = hash2(i, 6, 73) * T, r = 4 + hash2(i, 7, 73) * 5;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(255, 245, 170, .8)');
        grd.addColorStop(1, 'rgba(255, 200, 80, 0)');
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
  }

  // ───────────── Static layer: masonry rock, recessed chambers, edges ─────────────
  const isWall = (x, y) => C.cellAt(s, x, y) === WALL;
  const inRect = (r, x, y) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const hsl = (h, sat, l) => `hsl(${h}, ${sat}%, ${l}%)`;

  // Path2D of horizontal runs of cells where test(x, y) holds.
  function cellPath(test) {
    const p = new Path2D();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W;) {
        if (!test(x, y)) { x++; continue; }
        const x0 = x;
        while (x < W && test(x, y)) x++;
        p.rect(x0 * CELL, y * CELL, (x - x0) * CELL, CELL);
      }
    }
    return p;
  }

  function buildStatic() {
    const { cv, g } = offscreen(LW, LH);
    const room = s.room;
    // Masonry: rows one cell high, blocks two cells wide, every other row shifted. Each block is a little
    // bevelled slab: lit from the top left, a bright top/left edge, a dark bottom/right edge, a few pores.
    g.fillStyle = '#100b0a';
    g.fillRect(0, 0, LW, LH);
    for (let row = 0; row < H; row++) {
      const shift = row % 2 ? -CELL : 0;
      for (let bx = shift, n = 0; bx < LW; bx += 2 * CELL, n++) {
        const v = hash2(n, row, 11), v2 = hash2(n, row, 12);
        const hue = 24 + v * 12, sat = 11 + v2 * 8, l = 31 + v * 9 - (row / H) * 7;
        const x = bx + 0.7, y = row * CELL + 0.7, w = 2 * CELL - 1.4, h = CELL - 1.4;
        const grd = g.createLinearGradient(x, y, x + w * 0.35, y + h);
        grd.addColorStop(0, hsl(hue, sat, l + 7));
        grd.addColorStop(1, hsl(hue, sat, l - 6));
        g.fillStyle = grd;
        Fx.rrect(g, x, y, w, h, 1.8);
        g.fill();
        g.fillStyle = 'rgba(255, 238, 210, .2)';
        g.fillRect(x + 1.2, y, w - 2.4, 0.9);
        g.fillRect(x, y + 1.2, 0.8, h - 2.4);
        g.fillStyle = 'rgba(12, 6, 2, .38)';
        g.fillRect(x + 1.2, y + h - 1.1, w - 2.4, 1.1);
        g.fillRect(x + w - 0.8, y + 1.2, 0.8, h - 2.4);
        g.fillStyle = 'rgba(10, 5, 0, .22)';
        for (let i = 0; i < 3; i++) g.fillRect(x + 2 + hash2(n, row, 20 + i) * (w - 4), y + 2 + hash2(n, row, 30 + i) * (h - 4), 0.8, 0.8);
        if (v > 0.86) { // a crack
          g.strokeStyle = 'rgba(0, 0, 0, .35)';
          g.lineWidth = 0.6;
          g.beginPath(); g.moveTo(bx + 4 + v * 8, y + 0.5); g.lineTo(bx + 7 + v * 6, y + 4.5); g.lineTo(bx + 5 + v * 9, y + 8.5); g.stroke();
          g.strokeStyle = 'rgba(255, 235, 200, .12)';
          g.beginPath(); g.moveTo(bx + 4.6 + v * 8, y + 0.5); g.lineTo(bx + 7.6 + v * 6, y + 4.5); g.stroke();
        } else if (v < 0.04) { // a bit of moss on the top edge
          g.fillStyle = 'rgba(110, 150, 66, .45)';
          g.beginPath(); g.ellipse(bx + 6 + v * 60, y + 1, 4.5, 1.6, 0, 0, TAU); g.fill();
          g.fillStyle = 'rgba(170, 210, 110, .3)';
          g.beginPath(); g.ellipse(bx + 5 + v * 60, y + 0.6, 2.5, 0.8, 0, 0, TAU); g.fill();
        }
      }
    }

    // Large soft patches of light and shade so the rock face is not one flat tone.
    for (let i = 0; i < 26; i++) {
      const px = hash2(i, level, 51) * LW, py = hash2(i, level, 52) * LH, r = 30 + hash2(i, level, 53) * 60;
      const dark = i % 2 === 0;
      const grd = g.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, dark ? 'rgba(8, 4, 12, .22)' : 'rgba(255, 225, 180, .07)');
      grd.addColorStop(1, dark ? 'rgba(8, 4, 12, 0)' : 'rgba(255, 225, 180, 0)');
      g.fillStyle = grd;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    }

    const rock = cellPath(isWall);
    const open = cellPath((x, y) => !isWall(x, y));

    // Chamber backs, recessed: a darker, cooler cave wall of big soft slabs; warm planks in the hero's room.
    g.save();
    g.clip(open);
    const cave = g.createLinearGradient(0, 0, 0, LH);
    cave.addColorStop(0, '#3b3352');
    cave.addColorStop(0.6, '#2a2339');
    cave.addColorStop(1, '#1a1523');
    g.fillStyle = cave;
    g.fillRect(0, 0, LW, LH);
    for (let row = 0; row * 15 < LH; row++) {
      const y = row * 15;
      for (let x = (row % 2) * -15, n = 0; x < LW; x += 30, n++) {
        const v = hash2(n, row, 41);
        g.fillStyle = `rgba(${v > 0.5 ? '190, 180, 230' : '0, 0, 0'}, ${0.03 + Math.abs(v - 0.5) * 0.08})`;
        Fx.rrect(g, x + 0.8, y + 0.8, 28.4, 13.4, 3);
        g.fill();
        g.fillStyle = 'rgba(210, 200, 255, .05)';
        g.fillRect(x + 2, y + 0.8, 26, 0.8);
        g.fillStyle = 'rgba(0, 0, 0, .14)';
        g.fillRect(x + 2, y + 13.4, 26, 0.9);
      }
    }
    if (room) {
      const rx = room.x * CELL, ry = room.y * CELL, rw = room.w * CELL, rh = room.h * CELL;
      for (let x = rx, n = 0; x < rx + rw; x += 15, n++) {
        const v = hash2(n, 3, 5);
        const plank = g.createLinearGradient(x, 0, x + 15, 0);
        plank.addColorStop(0, hsl(24, 36, 26 + v * 5));
        plank.addColorStop(0.5, hsl(24, 38, 21 + v * 5));
        plank.addColorStop(1, hsl(24, 40, 15 + v * 4));
        g.fillStyle = plank;
        g.fillRect(x, ry, 15, rh);
        g.fillStyle = 'rgba(0, 0, 0, .1)'; // grain
        for (let i = 0; i < 3; i++) g.fillRect(x + 3 + hash2(n, i, 6) * 9, ry, 0.6, rh);
        g.fillStyle = 'rgba(0, 0, 0, .5)';
        g.fillRect(x, ry, 1, rh);
        g.fillStyle = 'rgba(255, 220, 170, .08)';
        g.fillRect(x + 1, ry, 0.8, rh);
        for (const ny of [ry + 12, ry + rh - 34]) { // nail heads
          g.fillStyle = 'rgba(0, 0, 0, .4)'; g.beginPath(); g.arc(x + 7.5, ny + 0.3, 0.9, 0, TAU); g.fill();
          g.fillStyle = 'rgba(255, 230, 190, .25)'; g.beginPath(); g.arc(x + 7.3, ny, 0.5, 0, TAU); g.fill();
        }
      }
      // A beam across the room: a lit top face over a darker front.
      g.fillStyle = '#4a321f'; g.fillRect(rx, ry + rh - 37, rw, 5);
      g.fillStyle = 'rgba(255, 220, 170, .18)'; g.fillRect(rx, ry + rh - 37, rw, 1);
      g.fillStyle = 'rgba(0, 0, 0, .35)'; g.fillRect(rx, ry + rh - 32, rw, 2);
    }
    // A soft key light from the top left falling into every chamber.
    const key = g.createRadialGradient(LW * 0.2, LH * 0.05, 0, LW * 0.2, LH * 0.05, LH * 0.9);
    key.addColorStop(0, 'rgba(255, 225, 190, .1)');
    key.addColorStop(1, 'rgba(255, 225, 190, 0)');
    g.fillStyle = key;
    g.fillRect(0, 0, LW, LH);
    // Ambient occlusion: the rock casts a soft shadow down and to the right onto the chamber back, and
    // every corner darkens. The rock itself is filled outside the clip, so only its shadow lands.
    g.fillStyle = '#000';
    g.shadowColor = 'rgba(4, 2, 10, .9)';
    g.shadowBlur = 12 * k; g.shadowOffsetX = 4 * k; g.shadowOffsetY = 5.5 * k;
    g.fill(rock);
    g.shadowColor = 'rgba(4, 2, 10, .75)';
    g.shadowBlur = 5 * k; g.shadowOffsetX = 0; g.shadowOffsetY = 0;
    g.fill(rock);
    g.fill(rock);
    g.shadowColor = 'transparent';
    g.restore();

    // Floor ledges: the top face of the rock under each chamber, seen from slightly above.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W;) {
        if (isWall(x, y) || !isWall(x, y + 1)) { x++; continue; }
        const x0 = x, wood = inRect(room, x, y);
        while (x < W && !isWall(x, y) && isWall(x, y + 1) && inRect(room, x, y) === wood) x++;
        const px = x0 * CELL, py = (y + 1) * CELL - 3, w = (x - x0) * CELL;
        const ledge = g.createLinearGradient(0, py, 0, py + 3);
        ledge.addColorStop(0, wood ? '#9a6a40' : '#7a6a60');
        ledge.addColorStop(1, wood ? '#5c3c22' : '#4a3f3a');
        g.fillStyle = ledge;
        g.fillRect(px, py, w, 3);
        g.fillStyle = 'rgba(255, 238, 205, .35)';
        g.fillRect(px, py, w, 0.7);
      }
    }

    // The rim of every opening, bevelled: rock edges facing the light (floors, right-hand walls) catch a
    // bright lip, edges facing away (ceilings, left-hand walls) fall into shade.
    g.save();
    g.clip(rock);
    // A rounded lip a few px wide along every opening (stroking the open runs: inner seams fall outside the clip).
    g.lineJoin = 'round';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(255, 232, 196, .1)';
    g.stroke(open);
    g.lineWidth = 2.4;
    g.strokeStyle = 'rgba(12, 6, 2, .55)';
    g.stroke(open);
    g.fillStyle = 'rgba(255, 228, 190, .7)';
    g.shadowColor = 'rgba(255, 228, 190, .7)';
    g.shadowBlur = 2.5 * k; g.shadowOffsetX = 1.8 * k; g.shadowOffsetY = 1.8 * k;
    g.fill(open);
    g.fillStyle = 'rgba(0, 0, 0, .85)';
    g.shadowColor = 'rgba(6, 2, 0, .85)';
    g.shadowOffsetX = -2 * k; g.shadowOffsetY = -2.4 * k; g.shadowBlur = 3.5 * k;
    g.fill(open);
    g.shadowColor = 'transparent';
    g.restore();

    // Handle pockets: a socket with a dark hole and a steel grommet that the pin's ring sits in.
    for (const p of s.pins) {
      const h = C.handleCell(p), cx = h.x * CELL + 5, cy = h.y * CELL + 5;
      const hole = g.createRadialGradient(cx - 1, cy - 1, 0.5, cx, cy, 5);
      hole.addColorStop(0, 'rgba(0, 0, 0, .85)');
      hole.addColorStop(1, 'rgba(0, 0, 0, .25)');
      g.fillStyle = hole;
      g.beginPath(); g.arc(cx, cy, 5, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255, 235, 200, .22)';
      g.lineWidth = 0.8;
      g.beginPath(); g.arc(cx, cy, 5.2, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
    }

    // Global grading: a warm light from the top left, darker towards the bottom right.
    const fall = g.createLinearGradient(0, 0, LW * 0.5, LH);
    fall.addColorStop(0, 'rgba(255, 230, 190, .06)');
    fall.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
    fall.addColorStop(1, 'rgba(6, 2, 14, .28)');
    g.fillStyle = fall;
    g.fillRect(0, 0, LW, LH);
    // A thin frame around the whole board.
    g.strokeStyle = 'rgba(0, 0, 0, .6)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, LW - 2, LH - 2);
    g.strokeStyle = 'rgba(255, 235, 200, .1)';
    g.lineWidth = 0.8;
    g.strokeRect(2.4, 2.4, LW - 4.8, LH - 4.8);
    return cv;
  }

  // ───────────── Cells: stone, gold, water, lava ─────────────
  const openCell = (c) => c === EMPTY || c === GAS;
  const cell = (x, y) => (x < 0 || x >= W || y < 0 || y >= H ? WALL : s.grid[y * W + x]);

  // Stone and gold, drawn before the door (the pile lies behind it).
  function drawSolids() {
    const g = s.grid;
    // Stone formed where lava met water: a dark basalt bed with lit lumps.
    let any = false;
    ctx.fillStyle = '#2b2c34';
    ctx.beginPath();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W;) {
        if (g[y * W + x] !== STONE) { x++; continue; }
        const x0 = x;
        while (x < W && g[y * W + x] === STONE) x++;
        ctx.rect(x0 * CELL - 0.3, y * CELL - 0.3, (x - x0) * CELL + 0.6, CELL + 0.6);
        any = true;
      }
    }
    if (any) {
      ctx.fill();
      for (let i = 0; i < W * H; i++) {
        if (g[i] !== STONE) continue;
        const x = i % W, y = (i - x) / W;
        ctx.drawImage(sprites['stone' + ((hash2(x, y, 7) * 3) | 0)], x * CELL - 1, y * CELL - 1, 12, 12);
      }
    }
    // Gold coins, a little jitter per cell so the pile looks loose; a few twinkle on top of the pile.
    let tw = 0;
    for (let i = 0; i < W * H; i++) {
      if (g[i] !== GOLD) continue;
      const x = i % W, y = (i - x) / W, v = hash2(x, y, 3);
      ctx.drawImage(v > 0.6 ? sprites.coinTilt : sprites.coin, x * CELL - 1 + (v - 0.5) * 2, y * CELL - 1 + (hash2(y, x, 4) - 0.5) * 1.5, 12, 12);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < W * H && tw < 10; i++) {
      if (g[i] !== GOLD) continue;
      const x = i % W, y = (i - x) / W;
      if (cell(x, y - 1) === GOLD) continue;
      const ph = time * 0.9 + hash2(x, y, 8) * 7, slot = Math.floor(ph);
      if (hash2(x, slot, 41) > 0.22) continue;
      const a = Math.sin((ph - slot) * Math.PI), r = 3 + a * 4;
      ctx.globalAlpha = a;
      ctx.drawImage(sprites.sparkle, x * CELL + 5 - r, y * CELL + 3 - r, r * 2, r * 2);
      tw++;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Liquids are drawn as merged column runs with rounded free corners, so a pool reads as one smooth body
  // and a falling stream as a rounded jet. The body is a depth ramp per column, then a moving texture
  // (caustics on water, a drifting crust and hot spots on lava), then the surface line and its effects.
  const runs = new Int16Array(W * H * 3);
  const spans = new Int16Array(W * H * 4); // runs merged across columns: x0, x1, y0, code
  const spanAt = new Int16Array(H);
  const surf = new Uint8Array(W * H);
  const wave = (type, x) => (type === WATER ? 0.6 + 0.6 * Math.sin(time * 3 + x * 0.9) : 0.4 + 0.4 * Math.sin(time * 1.6 + x * 0.7));

  function liquid(type, dt) {
    const g = s.grid;
    let n = 0, minX = W, maxX = -1, minY = H, maxY = -1;
    surf.fill(0);
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H;) {
        if (g[y * W + x] !== type) { y++; continue; }
        const y0 = y;
        while (y < H && g[y * W + x] === type) y++;
        const y1 = y - 1;
        const top = openCell(cell(x, y0 - 1));
        if (top) surf[y0 * W + x] = 1;
        const ty = y0 * CELL + (top ? wave(type, x) : 0);
        const fall = openCell(cell(x, y1 + 1));
        const r = 4.2;
        const radii = [top && openCell(cell(x - 1, y0)) ? r : 0, top && openCell(cell(x + 1, y0)) ? r : 0,
          fall && openCell(cell(x + 1, y1)) ? r : 0, fall && openCell(cell(x - 1, y1)) ? r : 0];
        if (ctx.roundRect) ctx.roundRect(x * CELL - 0.35, ty, CELL + 0.7, (y1 + 1) * CELL - ty, radii);
        else ctx.rect(x * CELL - 0.35, ty, CELL + 0.7, (y1 + 1) * CELL - ty);
        runs[n++] = x; runs[n++] = y0; runs[n++] = (top ? 0 : 1) + (y1 - y0 + 1) * 2;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y0); maxY = Math.max(maxY, y1);
      }
    }
    if (!n) return;
    const water = type === WATER;
    const bx = minX * CELL - 2, by = minY * CELL - 2, bw = (maxX - minX + 1) * CELL + 4, bh = (maxY - minY + 1) * CELL + 4;
    ctx.save();
    ctx.clip();
    // Body: the depth ramp down each column (a run that starts under a ceiling starts a little deeper).
    const rampCv = water ? sprites.waterRamp : sprites.lavaRamp;
    const D = water ? 110 : 90, deep = water ? '#143c94' : '#8a170c';
    // Side-by-side columns with the same run merge into one span, so a pool is one translucent body
    // without seams between its columns.
    let m = 0;
    spanAt.fill(-1);
    for (let i = 0; i < n; i += 3) {
      const x = runs[i], y0 = runs[i + 1], code = runs[i + 2], j = spanAt[y0];
      if (j >= 0 && spans[j + 1] === x - 1 && spans[j + 3] === code) { spans[j + 1] = x; continue; }
      spans[m] = x; spans[m + 1] = x; spans[m + 2] = y0; spans[m + 3] = code;
      spanAt[y0] = m;
      m += 4;
    }
    ctx.globalAlpha = water ? 0.88 : 1;
    ctx.fillStyle = deep;
    for (let i = 0; i < m; i += 4) {
      const x = spans[i] * CELL - 0.5, w = (spans[i + 1] - spans[i] + 1) * CELL + 1, y0 = spans[i + 2] * CELL;
      const covered = spans[i + 3] & 1, len = (spans[i + 3] >> 1) * CELL;
      const s0 = covered ? 30 : 0, part = Math.min(len, D - s0);
      ctx.drawImage(rampCv, 0, (s0 / D) * 128, 2, (part / D) * 128, x, y0 - 2, w, part + 2);
      if (len > part) ctx.fillRect(x, y0 + part, w, len - part);
    }
    ctx.globalAlpha = 1;
    if (water) {
      // Caustics: two layers of the same light net sliding against each other.
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = sprites.caustics;
      for (const [vx, vy, a] of [[7, 3, 0.15], [-5, 4.5, 0.1]]) {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate((time * vx) % 48, (time * vy) % 48);
        ctx.fillRect(bx - 48, by - 48, bw + 48, bh + 48);
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.save();
      ctx.fillStyle = sprites.crust;
      ctx.globalAlpha = 0.6;
      ctx.translate((time * 2.5) % 40, (time * 0.8) % 40);
      ctx.fillRect(bx - 40, by - 40, bw + 40, bh + 40);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = sprites.hot;
      ctx.globalAlpha = 0.3 + 0.15 * Math.sin(time * 2.2);
      ctx.translate((-time * 3) % 32, (time * 1.3) % 32);
      ctx.fillRect(bx - 32, by - 32, bw + 32, bh + 32);
      ctx.restore();
    }
    ctx.restore();

    // Surface: chains of side-by-side surface cells get one bright line (a meniscus on water, a white-hot
    // skin on lava), a soft band under it and their effects (sparkles, bubbles, heat shimmer, embers).
    let tw = 0, embers = 0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W;) {
        if (!surf[y * W + x]) { x++; continue; }
        const x0 = x;
        while (x < W && surf[y * W + x]) x++;
        const x1 = x - 1, py = y * CELL;
        const leftWall = !openCell(cell(x0 - 1, y)), rightWall = !openCell(cell(x1 + 1, y));
        const lx = x0 * CELL + (leftWall ? 0 : 3), rx = (x1 + 1) * CELL - (rightWall ? 0 : 3);
        if (rx - lx < 3) {
          ctx.fillStyle = water ? 'rgba(235, 250, 255, .8)' : 'rgba(255, 245, 190, .9)';
          ctx.beginPath(); ctx.arc(x0 * CELL + 3.6, py + 3.4, 1.3, 0, TAU); ctx.fill();
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(lx, py + wave(type, x0) + (leftWall && water ? -0.8 : 0.5));
        for (let cx = x0; cx <= x1; cx++) ctx.lineTo(cx * CELL + 5, py + wave(type, cx) + 0.5);
        ctx.lineTo(rx, py + wave(type, x1) + (rightWall && water ? -0.8 : 0.5));
        ctx.strokeStyle = water ? 'rgba(190, 240, 255, .28)' : 'rgba(255, 220, 120, .35)';
        ctx.lineWidth = 3.4;
        ctx.save(); ctx.translate(0, 2); ctx.stroke(); ctx.restore();
        ctx.strokeStyle = water ? 'rgba(240, 252, 255, .95)' : 'rgba(255, 250, 210, .95)';
        ctx.lineWidth = water ? 1.3 : 1.6;
        ctx.stroke();
        for (let cx = x0; cx <= x1; cx++) {
          if (water) {
            const ph = time * 1.3 + hash2(cx, y, 9) * 5, slot = Math.floor(ph);
            if (tw < 8 && hash2(cx, slot, 43) < 0.12) {
              const a = Math.sin((ph - slot) * Math.PI), r = 2 + a * 3.5;
              ctx.globalCompositeOperation = 'lighter';
              ctx.globalAlpha = a * 0.9;
              ctx.drawImage(sprites.sparkle, cx * CELL + 5 - r, py + wave(type, cx) + 1 - r, r * 2, r * 2);
              ctx.globalAlpha = 1;
              ctx.globalCompositeOperation = 'source-over';
              tw++;
            }
          } else {
            // A bubble swells on the skin and pops.
            const ph = time * 0.9 + hash2(cx, y, 5) * 3, slot = Math.floor(ph), b = ph - slot;
            if (hash2(cx, slot, 6) < 0.2) {
              ctx.fillStyle = `rgba(255, 210, 110, ${0.9 * (1 - b)})`;
              ctx.beginPath(); ctx.arc(cx * CELL + 5, py + 2.5 - b * 3, 1 + b * 2.2, 0, TAU); ctx.fill();
              ctx.strokeStyle = `rgba(255, 250, 220, ${0.8 * (1 - b)})`;
              ctx.lineWidth = 0.6;
              ctx.beginPath(); ctx.arc(cx * CELL + 5, py + 2.5 - b * 3, 1 + b * 2.2, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
            }
            // Heat shimmer rising off the surface, and an ember now and then.
            ctx.globalCompositeOperation = 'lighter';
            if (cx % 2 === 0) {
              const hp = (time * 0.7 + hash2(cx, y, 12)) % 1;
              ctx.globalAlpha = Math.sin(hp * Math.PI) * 0.6;
              ctx.drawImage(sprites.heat, cx * CELL + 5 - 7 + Math.sin(time * 4 + cx) * 2, py - 4 - hp * 22, 14, 18);
            }
            ctx.globalAlpha = 0.55 + 0.1 * Math.sin(time * 3 + cx);
            ctx.drawImage(sprites.lavaGlow, cx * CELL - 12, py - 14, 34, 30);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            if (embers < 2 && Math.random() < dt * 0.35) {
              embers++;
              fx.emit({ x: cx * CELL + 5, y: py, vx: (Math.random() - 0.5) * 20, vy: -30 - Math.random() * 40, gravity: 30, life: 0.9, size: 1.2, color: '#ffb347', shape: 'spark' });
            }
          }
        }
      }
    }
    // Lava lights the rock beside it, not only above it.
    if (!water) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.06 * Math.sin(time * 3);
      for (let i = 0; i < W * H; i++) {
        if (g[i] !== LAVA) continue;
        const x = i % W, y = (i - x) / W;
        if (y % 2 || (openCell(cell(x - 1, y)) === false && openCell(cell(x + 1, y)) === false)) continue;
        ctx.drawImage(sprites.lavaGlow, x * CELL - 12, y * CELL - 12, 34, 34);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // Water and lava, drawn after the door so a flood shows over it.
  function drawLiquids(dt) {
    liquid(WATER, dt);
    liquid(LAVA, dt);
  }

  // Gas: a dense green haze per cell and soft puffs drifting over it.
  function drawGas() {
    const g = s.grid;
    ctx.fillStyle = 'rgba(110, 170, 60, .28)';
    for (let i = 0; i < W * H; i++) if (g[i] === GAS) ctx.fillRect((i % W) * CELL, Math.floor(i / W) * CELL, CELL, CELL);
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < W * H; i++) {
      if (g[i] !== GAS) continue;
      const x = i % W, y = (i - x) / W, v = hash2(x, y, 31);
      const dx = Math.sin(time * 1.3 + v * 7) * 2.5, dy = Math.cos(time * 1.1 + v * 5) * 2;
      ctx.drawImage(sprites.gasPuff, x * CELL - 6 + dx, y * CELL - 6 + dy, 22, 22);
    }
    ctx.globalAlpha = 1;
  }

  // Powder kegs: every group of touching keg cells is one barrel with hoops and a warning sign.
  const kegSeen = new Uint8Array(W * H);
  function drawKegs() {
    const g = s.grid;
    kegSeen.fill(0);
    for (let i0 = 0; i0 < W * H; i0++) {
      if (g[i0] !== BOMB || kegSeen[i0]) continue;
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      const stack = [i0];
      kegSeen[i0] = 1;
      while (stack.length) {
        const i = stack.pop(), x = i % W, y = (i - x) / W;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx, ny = y + dy, j = ny * W + nx;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && g[j] === BOMB && !kegSeen[j]) { kegSeen[j] = 1; stack.push(j); }
        }
      }
      drawKeg(x0 * CELL, y0 * CELL, (x1 + 1 - x0) * CELL, (y1 + 1 - y0) * CELL);
    }
  }

  function drawKeg(px, py, w, h) {
    const bulge = Math.min(2, w * 0.1);
    Fx.shadow(ctx, px + w / 2 + 1.5, py + h, w * 0.6, 3, 0.55);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px + bulge, py + 0.5);
    ctx.quadraticCurveTo(px - bulge, py + h / 2, px + bulge, py + h - 0.5);
    ctx.lineTo(px + w - bulge, py + h - 0.5);
    ctx.quadraticCurveTo(px + w + bulge, py + h / 2, px + w - bulge, py + 0.5);
    ctx.closePath();
    const wood = ctx.createLinearGradient(px, 0, px + w, 0);
    wood.addColorStop(0, '#6e3814');
    wood.addColorStop(0.28, '#c4732f');
    wood.addColorStop(0.55, '#9a5222');
    wood.addColorStop(1, '#3e1d0a');
    ctx.fillStyle = wood;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(0, 0, 0, .3)';
    ctx.lineWidth = 0.7;
    for (let x = px + w / 4; x < px + w; x += w / 4) { ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x, py + h); ctx.stroke(); }
    const shadeV = ctx.createLinearGradient(0, py, 0, py + h);
    shadeV.addColorStop(0, 'rgba(255, 230, 190, .18)');
    shadeV.addColorStop(0.3, 'rgba(0, 0, 0, 0)');
    shadeV.addColorStop(1, 'rgba(0, 0, 0, .35)');
    ctx.fillStyle = shadeV;
    ctx.fillRect(px - 2, py, w + 4, h);
    for (const f of [0.18, 0.82]) {
      ctx.fillStyle = '#353a42'; ctx.fillRect(px - 2, py + h * f - 1.3, w + 4, 2.6);
      ctx.fillStyle = 'rgba(255, 255, 255, .4)'; ctx.fillRect(px - 2, py + h * f - 1.3, w + 4, 0.6);
      ctx.fillStyle = 'rgba(0, 0, 0, .35)'; ctx.fillRect(px - 2, py + h * f + 0.8, w + 4, 0.5);
    }
    ctx.fillStyle = 'rgba(255, 255, 255, .16)';
    ctx.fillRect(px + w * 0.18, py + 1, w * 0.1, h - 2);
    ctx.restore();
    // A warning sign: a yellow triangle with "!".
    const cx = px + w / 2, cy = py + h / 2 + 0.5, r = Math.min(w, h) * 0.26;
    ctx.fillStyle = '#ffd34d';
    ctx.strokeStyle = '#3a240a';
    ctx.lineWidth = 0.8;
    ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 1.1, cy + r * 0.8); ctx.lineTo(cx - r * 1.1, cy + r * 0.8); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2a1a08';
    ctx.fillRect(cx - 0.6, cy - r * 0.45, 1.2, r * 0.75);
    ctx.fillRect(cx - 0.6, cy + r * 0.45, 1.2, 1.2);
    // A short fuse on top with a glowing tip.
    ctx.strokeStyle = '#2b2620';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cx, py + 0.5); ctx.quadraticCurveTo(cx + 3, py - 3, cx + 5, py - 4); ctx.stroke();
    ctx.fillStyle = `rgba(255, ${170 + Math.sin(time * 9) * 40 | 0}, 60, .95)`;
    ctx.beginPath(); ctx.arc(cx + 5, py - 4, 1.2, 0, TAU); ctx.fill();
    Fx.glow(ctx, cx + 5, py - 4, 5 + Math.sin(time * 9) * 1.2, '#ff9a30', 0.7);
  }

  // Blasts: a white-hot flash that turns into an orange glow.
  function drawFlashes(dt) {
    flashes = flashes.filter((f) => (f.t += dt) < 0.5);
    if (!flashes.length) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flashes) {
      const p = f.t / 0.5, r = (C.BLAST_R + 1) * CELL * (0.6 + p * 0.9);
      ctx.globalAlpha = (1 - p) * 0.9;
      ctx.drawImage(sprites.blastGlow, f.x - r, f.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ───────────── Pins ─────────────
  // A chrome rod with a soft shadow on the wall behind it, a brass collar and a brass ring (a lit torus).
  function drawPin(p, off, alpha) {
    const { dx, dy } = V.pullDir(p);
    const h = C.handleCell(p);
    const ox = dx * off * CELL, oy = dy * off * CELL;
    const hx = h.x * CELL + 5 + ox, hy = h.y * CELL + 5 + oy;
    const horiz = p.handle !== 'top';
    const T = 5.6, R = T / 2;
    let x0, y0, x1, y1;
    if (horiz) {
      y0 = y1 = p.y * CELL + 5;
      x0 = p.x * CELL + 1 + R; x1 = (p.x + p.w) * CELL - 1 - R;
      if (p.handle === 'left') x0 -= 4;
      if (p.handle === 'right') x1 += 4;
    } else {
      x0 = x1 = p.x * CELL + 5;
      y0 = p.y * CELL - 2 + R; y1 = (p.y + p.h) * CELL - 1 - R;
    }
    x0 += ox; x1 += ox; y0 += oy; y1 += oy;
    ctx.save();
    ctx.globalAlpha = alpha;
    // Shadow on the back wall, down and to the right of the rod.
    if (horiz) Fx.shadow(ctx, (x0 + x1) / 2 + 2, y0 + 3.4, (x1 - x0) / 2 + 5, 3.6, 0.6);
    else Fx.shadow(ctx, x0 + 2.6, (y0 + y1) / 2 + 2, 3.6, (y1 - y0) / 2 + 5, 0.6);
    Fx.shadow(ctx, hx + 1.8, hy + 2.6, 8.5, 8, 0.5);
    Fx.metalBar(ctx, x0, y0, x1, y1, T, '#c7d0de');
    // The brass collar where the rod meets the ring.
    const cx = horiz ? (p.handle === 'left' ? x0 + 1 : x1 - 1) : x0;
    const cy = horiz ? y0 : y0 + 1;
    const col = horiz ? ctx.createLinearGradient(0, cy - 4, 0, cy + 4) : ctx.createLinearGradient(cx - 4, 0, cx + 4, 0);
    col.addColorStop(0, '#fff2b0'); col.addColorStop(0.35, '#e8b23a'); col.addColorStop(0.75, '#9a6510'); col.addColorStop(1, '#6a420a');
    ctx.fillStyle = col;
    ctx.beginPath();
    if (horiz) rrect(ctx, cx - 1.8, cy - 3.9, 3.6, 7.8, 1.2); else rrect(ctx, cx - 3.9, cy - 1.8, 7.8, 3.6, 1.2);
    ctx.fill();
    ctx.restore();

    // The ring: a brass torus with a hard specular on its upper-left curve.
    ctx.save();
    ctx.globalAlpha = alpha;
    const hot = drag && drag.id === p.id;
    if (hot) Fx.glow(ctx, hx, hy, 16, '#ffd060', 0.5);
    ctx.lineWidth = 4.8;
    ctx.strokeStyle = '#4a3106';
    ctx.beginPath(); ctx.arc(hx, hy, 6.2, 0, TAU); ctx.stroke();
    const ring = ctx.createLinearGradient(hx - 7, hy - 7, hx + 7, hy + 7);
    ring.addColorStop(0, '#fff6c0');
    ring.addColorStop(0.3, '#f6c445');
    ring.addColorStop(0.65, '#bf8416');
    ring.addColorStop(1, '#7d500a');
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = ring;
    ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = 'rgba(90, 55, 5, .55)';
    ctx.beginPath(); ctx.arc(hx, hy, 4.7, Math.PI, Math.PI * 1.75); ctx.stroke();
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = 'rgba(255, 255, 255, .9)';
    ctx.beginPath(); ctx.arc(hx, hy, 7, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(255, 240, 190, .55)';
    ctx.beginPath(); ctx.arc(hx, hy, 5.2, Math.PI * 0.1, Math.PI * 0.4); ctx.stroke();
    // The pin's number (keys 1–5) on a small glossy badge beside the ring.
    if (off === 0 && alpha === 1) {
      const bx = hx + (horiz ? 0 : 9), by = hy + (horiz ? -10 : 0);
      Fx.shadow(ctx, bx + 1, by + 2, 5.5, 4, 0.45);
      const bg = ctx.createLinearGradient(0, by - 4.6, 0, by + 4.6);
      bg.addColorStop(0, '#4a3f62'); bg.addColorStop(1, '#16111f');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(bx, by, 4.6, 0, TAU); ctx.fill();
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = 'rgba(255, 210, 120, .75)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, .18)';
      ctx.beginPath(); ctx.ellipse(bx - 1, by - 2.2, 2.6, 1.3, -0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.font = 'bold 7px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.id), bx, by + 0.4);
    }
    ctx.restore();
  }

  function drawPins(dt) {
    for (const p of s.pins) {
      if (p.pulled) continue;
      const off = drag && drag.id === p.id ? Math.min(1.6, drag.along * 0.6) : 0;
      drawPin(p, off, 1);
    }
    pulled = pulled.filter((a) => (a.t += dt) < 0.4);
    for (const a of pulled) {
      const f = a.t / 0.4;
      const len = (a.pin.handle === 'top' ? a.pin.h : a.pin.w) + 3;
      drawPin(a.pin, (0.3 + f * f) * len, 1 - f * f);
    }
  }

  // A pulsing ring and an arrow on the pin to pull (level 1, the hint button), until the next pull.
  function drawHint() {
    if (hint == null || phase !== 'play') return;
    const p = s.pins.find((q) => q.id === hint);
    if (!p || p.pulled) return;
    const h = C.handleCell(p);
    const { dx, dy } = V.pullDir(p);
    const cx = h.x * CELL + 5, cy = h.y * CELL + 5;
    const f = (time % 1.4) / 1.4;
    Fx.glow(ctx, cx, cy, 14 + f * 6, '#fff2b0', 0.4 * (1 - f));
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * (1 - f)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 8 + f * 12, 0, TAU); ctx.stroke();
    const o = 12 + Math.sin(time * 5) * 3;
    const ax = cx + dx * o, ay = cy + dy * o;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(dy, dx));
    Fx.shadow(ctx, 1.5, 2.5, 9, 5, 0.4);
    const ag = ctx.createLinearGradient(0, -6, 0, 6);
    ag.addColorStop(0, '#ffffff'); ag.addColorStop(1, '#d6dceb');
    ctx.fillStyle = ag;
    ctx.strokeStyle = 'rgba(20, 14, 34, .45)';
    ctx.lineWidth = 0.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(10, 0); ctx.lineTo(2, -6); ctx.lineTo(2, -2.5); ctx.lineTo(-6, -2.5);
    ctx.lineTo(-6, 2.5); ctx.lineTo(2, 2.5); ctx.lineTo(2, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ───────────── Hero, enemies, the door, torches ─────────────
  const HERO_LOOK = { skin: '#f5c9a0', hair: '#6b3f1f', body: ['#5b9bff', '#2b5fb8'], cape: '#c8324a', belt: '#5b3a1e', legs: '#3b3550', boots: '#2a1d14' };
  const ENEMY_LOOK = { skin: '#7cc04f', hair: '#8a8f98', body: ['#8a5a34', '#5a3a20'], cape: null, belt: '#2f2018', legs: '#4a3a2a', boots: '#21170f' };
  const BURNT = { skin: '#3a302b', hair: '#1d1714', body: ['#2e2622', '#1d1714'], cape: '#2a1f1c', belt: '#151010', legs: '#1d1714', boots: '#120d0b' };
  const POISONED = { skin: '#a8c98a', hair: '#55603f', body: ['#6f8a5a', '#465a38'], cape: '#6a7a4a', belt: '#3a4030', legs: '#4a5540', boots: '#2c3326' };

  // A figure in a 3×5-cell box at logical (bx, by). o: { look, face, walk (phase or null), mood, enemy, alpha }.
  // Lit volumes: every part is shaded from the screen's top left whichever way the figure faces.
  function drawFigure(bx, by, o) {
    const L = o.look;
    const cx = bx + 15;
    const f = o.face || 1;  // local x is mirrored when facing left; lx(-1) is always the lit side
    const lx = (v) => v * f;
    const bob = o.walk == null ? Math.sin(time * 2.2 + bx) * 0.6 : Math.abs(Math.sin(o.walk)) * -1.5;
    ctx.save();
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    Fx.shadow(ctx, cx + 1.5, by + 49.6, 13 + bob, 3.4, 0.6);
    ctx.translate(cx, by + bob);
    ctx.scale(f, 1);
    // Legs and boots.
    const sw = o.walk == null ? 0 : Math.sin(o.walk) * 3;
    for (const [x, d] of [[-5, sw], [2, -sw]]) {
      ctx.fillStyle = L.legs;
      ctx.beginPath(); rrect(ctx, x + d * 0.5, 36, 4, 10, 1.5); ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, .1)';
      ctx.fillRect(x + d * 0.5 + (f > 0 ? 0.6 : 2.6), 37, 0.8, 8);
      ctx.fillStyle = L.boots;
      ctx.beginPath(); rrect(ctx, x - 1 + d, 44.5, 6.5, 5, 1.8); ctx.fill();
      ctx.fillStyle = 'rgba(255, 240, 220, .2)';
      ctx.fillRect(x + d, 44.8, 4.5, 0.8);
    }
    // Cape behind the body.
    if (L.cape) {
      const cg = ctx.createLinearGradient(0, 21, 0, 41);
      cg.addColorStop(0, Fx.shade(L.cape, 0.15)); cg.addColorStop(1, Fx.shade(L.cape, -0.35));
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(-7, 21); ctx.lineTo(7, 21);
      ctx.lineTo(10 + (o.walk == null ? 0 : -Math.abs(sw)), 41); ctx.lineTo(-11 - (o.walk == null ? 0 : Math.abs(sw)), 41);
      ctx.closePath(); ctx.fill();
    }
    // Arms (raised when cheering), body, belt.
    const up = o.mood === 'cheer';
    for (const ax of [-11, 7]) {
      const swing = o.walk == null ? 0 : (ax < 0 ? sw : -sw) * 0.6;
      const litArm = (ax < 0) === (f > 0);
      ctx.fillStyle = litArm ? Fx.shade(L.body[0], -0.05) : L.body[1];
      if (up) { ctx.beginPath(); rrect(ctx, ax, 9, 4, 14, 2); ctx.fill(); }
      else { ctx.beginPath(); rrect(ctx, ax + swing * 0.3, 21, 4, 13, 2); ctx.fill(); }
      ctx.fillStyle = L.skin;
      ctx.beginPath(); ctx.arc(ax + 2 + (up ? 0 : swing * 0.3), up ? 9 : 34, 2.4, 0, TAU); ctx.fill();
    }
    const bodyG = ctx.createLinearGradient(lx(-8), 0, lx(8), 0);
    bodyG.addColorStop(0, Fx.shade(L.body[0], 0.3));
    bodyG.addColorStop(0.45, L.body[0]);
    bodyG.addColorStop(1, Fx.shade(L.body[1], -0.15));
    ctx.fillStyle = bodyG;
    ctx.beginPath(); rrect(ctx, -8, 20, 16, 18, 4.5); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, .22)';
    ctx.beginPath(); ctx.ellipse(lx(-4), 24.5, 2, 3.4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = L.belt;
    ctx.fillRect(-8, 31, 16, 3);
    ctx.fillStyle = 'rgba(255, 255, 255, .12)';
    ctx.fillRect(-8, 31, 16, 0.7);
    ctx.fillStyle = o.enemy ? '#7b808a' : '#ffcf4a';
    ctx.fillRect(-1.6, 31, 3.2, 3);
    // Head: a lit sphere.
    const hg = ctx.createRadialGradient(lx(-3), 8.5, 0.8, 0, 12, 9.5);
    hg.addColorStop(0, Fx.shade(L.skin, 0.35));
    hg.addColorStop(0.55, L.skin);
    hg.addColorStop(1, Fx.shade(L.skin, -0.3));
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0, 12, 8.5, 0, TAU); ctx.fill();
    if (o.enemy) {
      // Pointy ears, an iron helmet with horns, angry brows, red eyes, fangs.
      ctx.fillStyle = L.skin;
      ctx.beginPath(); ctx.moveTo(-8, 10); ctx.lineTo(-13, 7); ctx.lineTo(-7.5, 14); ctx.fill();
      ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(13, 7); ctx.lineTo(7.5, 14); ctx.fill();
      ctx.fillStyle = '#ece6d2';
      ctx.beginPath(); ctx.moveTo(-6, 5); ctx.quadraticCurveTo(-12, 1, -10, -4); ctx.lineTo(-4, 4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(6, 5); ctx.quadraticCurveTo(12, 1, 10, -4); ctx.lineTo(4, 4); ctx.fill();
      const helm = ctx.createLinearGradient(lx(-9), 2, lx(9), 12);
      helm.addColorStop(0, Fx.shade(L.hair, 0.45)); helm.addColorStop(0.5, L.hair); helm.addColorStop(1, Fx.shade(L.hair, -0.4));
      ctx.fillStyle = helm;
      ctx.beginPath(); ctx.arc(0, 11, 9, Math.PI, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, .45)';
      ctx.beginPath(); ctx.ellipse(lx(-4), 5.5, 2.6, 1, lx(-0.4), 0, TAU); ctx.fill();
      ctx.fillStyle = o.mood === 'burnt' ? '#222' : '#ff3b2f';
      ctx.beginPath(); ctx.arc(-3, 13, 1.6, 0, TAU); ctx.arc(3.2, 13, 1.6, 0, TAU); ctx.fill();
      if (o.mood !== 'burnt') Fx.glow(ctx, 0.1, 13, 5, '#ff3020', 0.35);
      ctx.strokeStyle = '#1d2a12';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-5.5, 10); ctx.lineTo(-1, 11.6); ctx.moveTo(5.5, 10); ctx.lineTo(1.2, 11.6); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(-3, 17); ctx.lineTo(-2, 19.5); ctx.lineTo(-1, 17); ctx.moveTo(1, 17); ctx.lineTo(2, 19.5); ctx.lineTo(3, 17); ctx.fill();
      // A club raised over the shoulder, swaying.
      ctx.save();
      ctx.translate(9, 28);
      ctx.rotate(-0.5 + Math.sin(time * 3 + bx) * 0.12);
      ctx.fillStyle = '#7a4d26';
      ctx.fillRect(-1.3, -18, 2.6, 18);
      const club = ctx.createRadialGradient(-1.2, -21, 0.5, 0, -19, 5.5);
      club.addColorStop(0, '#a87244'); club.addColorStop(1, '#4e2f15');
      ctx.fillStyle = club;
      ctx.beginPath(); ctx.ellipse(0, -19, 3.6, 5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e4e4e4';
      ctx.fillRect(-3.8, -21, 1.2, 1.2); ctx.fillRect(2.6, -18, 1.2, 1.2);
      ctx.restore();
    } else {
      // Hair, eyes looking ahead, cheeks, a mouth that follows the mood.
      const hair = ctx.createLinearGradient(lx(-8), 2, lx(8), 10);
      hair.addColorStop(0, Fx.shade(L.hair, 0.3)); hair.addColorStop(1, Fx.shade(L.hair, -0.25));
      ctx.fillStyle = hair;
      ctx.beginPath(); ctx.arc(0, 10.5, 9, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-8.6, 9); ctx.quadraticCurveTo(-2, 7, 3, 4); ctx.lineTo(8.6, 9); ctx.lineTo(8.6, 6); ctx.lineTo(-8.6, 6); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-1, 2.5); ctx.quadraticCurveTo(2, -2, 5, 1); ctx.quadraticCurveTo(2, 0, 1, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255, 235, 200, .3)';
      ctx.beginPath(); ctx.ellipse(lx(-3.5), 4.2, 2.6, 0.9, lx(-0.3), 0, TAU); ctx.fill();
      if (o.mood === 'burnt') {
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1;
        for (const ex of [-2.5, 4]) { ctx.beginPath(); ctx.moveTo(ex - 1.4, 11); ctx.lineTo(ex + 1.4, 14); ctx.moveTo(ex + 1.4, 11); ctx.lineTo(ex - 1.4, 14); ctx.stroke(); }
      } else {
        ctx.fillStyle = '#2a1a10';
        ctx.beginPath(); ctx.ellipse(-2.5, 12.5, 1.3, 1.7, 0, 0, TAU); ctx.ellipse(4, 12.5, 1.3, 1.7, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(-2.3, 11.4, 0.8, 0.8); ctx.fillRect(4.2, 11.4, 0.8, 0.8);
        ctx.fillStyle = 'rgba(255, 110, 110, .35)';
        ctx.beginPath(); ctx.arc(-4.8, 15.5, 1.8, 0, TAU); ctx.arc(6.4, 15.5, 1.8, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = '#7a3b22';
      ctx.fillStyle = '#7a3b22';
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      if (o.mood === 'scared') { ctx.beginPath(); ctx.ellipse(1, 17.2, 1.4, 1.9, 0, 0, TAU); ctx.fill(); }
      else if (o.mood === 'cheer') { ctx.beginPath(); ctx.arc(1, 16, 2.8, 0, Math.PI); ctx.fill(); }
      else if (o.mood !== 'burnt') { ctx.beginPath(); ctx.arc(1, 15.4, 2.4, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); }
      if (o.mood === 'scared') { // a drop of sweat
        ctx.fillStyle = '#9fd8ff';
        ctx.beginPath(); ctx.moveTo(-8, 5); ctx.quadraticCurveTo(-10, 9, -8, 10); ctx.quadraticCurveTo(-6, 9, -8, 5); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawDoor(open) {
    const e = s.exit;
    if (!e) return;
    const x = e.x * CELL, y = e.y * CELL;
    const arch = (r) => { ctx.beginPath(); ctx.moveTo(x + 15 - r, y + 50); ctx.lineTo(x + 15 - r, y + 12); ctx.arc(x + 15, y + 12, r, Math.PI, 0); ctx.lineTo(x + 15 + r, y + 50); ctx.closePath(); };
    // Stone arch frame: lit voussoirs with a shadow on the wall behind.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, .5)';
    ctx.shadowBlur = 4 * k; ctx.shadowOffsetX = 1.5 * k; ctx.shadowOffsetY = 2 * k;
    const frame = ctx.createLinearGradient(x - 3, y - 6, x + 33, y + 50);
    frame.addColorStop(0, '#a49a90'); frame.addColorStop(0.5, '#746a63'); frame.addColorStop(1, '#4a4340');
    ctx.fillStyle = frame;
    arch(18.5);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(20, 12, 8, .45)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      ctx.beginPath(); ctx.moveTo(x + 15 + Math.cos(a) * 15, y + 12 + Math.sin(a) * 15); ctx.lineTo(x + 15 + Math.cos(a) * 18.5, y + 12 + Math.sin(a) * 18.5); ctx.stroke();
    }
    for (const sy of [22, 34, 46]) for (const sx of [x - 3.5, x + 30]) { ctx.beginPath(); ctx.moveTo(sx, y + sy); ctx.lineTo(sx + 3.5, y + sy); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255, 240, 220, .35)';
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.arc(x + 15, y + 12, 18, Math.PI * 1.05, Math.PI * 1.55); ctx.stroke();
    // The opening: warm daylight behind the door, a dark reveal around it for depth.
    ctx.save();
    arch(15);
    ctx.clip();
    const light = ctx.createLinearGradient(0, y - 3, 0, y + 50);
    light.addColorStop(0, '#fff8dc');
    light.addColorStop(1, '#ffc768');
    ctx.fillStyle = light;
    ctx.fillRect(x, y - 3, 30, 53);
    // The door swings open: its visible width shrinks towards the hinge.
    const dw = 30 * (1 - open * 0.85);
    const wood = ctx.createLinearGradient(x, 0, x + dw, 0);
    wood.addColorStop(0, '#a3622f');
    wood.addColorStop(0.5, '#7e4720');
    wood.addColorStop(1, '#4e2a10');
    ctx.fillStyle = wood;
    ctx.fillRect(x, y - 3, dw, 53);
    for (let i = 1; i < 4; i++) {
      ctx.fillStyle = 'rgba(0, 0, 0, .35)'; ctx.fillRect(x + (dw * i) / 4, y - 3, 0.8, 53);
      ctx.fillStyle = 'rgba(255, 220, 170, .12)'; ctx.fillRect(x + (dw * i) / 4 + 0.8, y - 3, 0.6, 53);
    }
    for (const by of [12, 38]) {
      ctx.fillStyle = '#2d2a2a'; ctx.fillRect(x, y + by, dw, 2.6);
      ctx.fillStyle = 'rgba(255, 255, 255, .25)'; ctx.fillRect(x, y + by, dw, 0.6);
      ctx.fillStyle = 'rgba(255, 255, 255, .35)';
      for (let i = 0; i < 3; i++) ctx.fillRect(x + 3 + i * (dw - 6) / 2, y + by + 0.9, 0.9, 0.9);
    }
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(0, 0, 0, .4)';
    arch(15);
    ctx.stroke();
    if (open < 0.5) {
      ctx.strokeStyle = '#e8b84a';
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(x + dw - 6, y + 27, 2.4, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, .6)';
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.arc(x + dw - 6, y + 27, 2.4, Math.PI, Math.PI * 1.5); ctx.stroke();
    }
    ctx.restore();
    if (open > 0) Fx.glow(ctx, x + 15, y + 28, 30 + open * 14, '#ffd27a', open * 0.75);
    // A green arrow sign over the arch.
    Fx.shadow(ctx, x + 16, y - 7, 12, 4, 0.5);
    Fx.block(ctx, x + 5, y - 13, 20, 8, 2.2, '#249a4a');
    ctx.fillStyle = '#eaffee';
    ctx.beginPath(); ctx.moveTo(x + 9, y - 9); ctx.lineTo(x + 17, y - 9); ctx.lineTo(x + 17, y - 11.5); ctx.lineTo(x + 21.5, y - 9); ctx.lineTo(x + 17, y - 6.5); ctx.lineTo(x + 17, y - 9); ctx.fill();
    ctx.fillRect(x + 9, y - 9.8, 8, 1.6);
  }

  // Torches on the wall on both sides of the door (where the room has space), with a flicker and a warm light.
  function drawTorches() {
    const r = s.room, e = s.exit;
    if (!r || !e) return;
    const ty = e.y * CELL + 6;
    for (const tx of [e.x * CELL - 10, (e.x + e.w) * CELL + 10]) {
      if (tx < r.x * CELL + 5 || tx > (r.x + r.w) * CELL - 5) continue;
      const f = Math.sin(time * 13 + tx) * 0.6 + Math.sin(time * 7.3 + tx * 2) * 0.4;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85 + f * 0.1;
      ctx.drawImage(sprites.torchGlow, tx - 34, ty - 36, 68, 68);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      Fx.shadow(ctx, tx + 2, ty + 10, 4, 2, 0.4);
      const st = ctx.createLinearGradient(tx - 1.5, 0, tx + 1.5, 0);
      st.addColorStop(0, '#7a5232'); st.addColorStop(1, '#3a2414');
      ctx.fillStyle = st;
      ctx.fillRect(tx - 1.5, ty, 3, 9);
      ctx.fillStyle = '#4a4440';
      ctx.fillRect(tx - 3, ty + 6, 6, 2);
      ctx.fillStyle = 'rgba(255, 255, 255, .3)';
      ctx.fillRect(tx - 3, ty + 6, 6, 0.6);
      ctx.fillStyle = '#ff8a1e';
      ctx.beginPath(); ctx.ellipse(tx, ty - 2, 3 + f * 0.4, 5.5 + f, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffe58a';
      ctx.beginPath(); ctx.ellipse(tx, ty - 0.5, 1.6, 3, 0, 0, TAU); ctx.fill();
      Fx.glow(ctx, tx, ty - 2, 9, '#ffb040', 0.6);
    }
  }

  function drawEntities(dt) {
    for (const e of s.enemies) {
      if (!e.dead) drawFigure(e.x * CELL, e.y * CELL, { look: ENEMY_LOOK, enemy: true, face: s.hero && s.hero.x < e.x ? -1 : 1, mood: 'idle' });
    }
    burning = burning.filter((b) => (b.t += dt) < 1);
    for (const b of burning) {
      const f = b.t, cause = b.e.cause;
      const look = f < 0.25 ? ENEMY_LOOK : cause === 'gas' ? POISONED : BURNT;
      const lift = cause === 'blast' ? f * 30 : f * 4; // a blast flings the enemy up
      drawFigure(b.e.x * CELL, b.e.y * CELL - lift, { look, enemy: true, mood: 'burnt', alpha: 1 - f });
      if (cause !== 'gas' && Math.random() < 0.5) puff(b.e.x * CELL + 5 + Math.random() * 20, b.e.y * CELL + 10 + Math.random() * 35, Math.random() < 0.3 ? 'flame' : 'smoke');
    }
    const h = s.hero;
    if (!h) return;
    if (phase === 'end' && outcome && outcome.won) return; // gone through the door
    if (phase === 'walk') {
      const tw = Math.max(0, phaseT - CHEER_T);
      const p = V.walkPos(h, s.exit, tw);
      const into = p.done ? clamp((tw - V.walkTime(h, s.exit)) / DOOR_T, 0, 1) : 0;
      const hop = phaseT < CHEER_T ? -Math.abs(Math.sin(phaseT * Math.PI * 2 / CHEER_T)) * 5 : 0;
      if (phaseT < CHEER_T + 0.6) Fx.glow(ctx, p.x * CELL + 15, p.y * CELL + 25, 34, '#ffe08a', 0.35 * (1 - phaseT / (CHEER_T + 0.6)));
      drawFigure(p.x * CELL, p.y * CELL + hop, { look: HERO_LOOK, face: p.face, walk: phaseT < CHEER_T || p.done ? null : tw * 14, mood: phaseT < CHEER_T ? 'cheer' : 'idle', alpha: 1 - into });
      return;
    }
    const lostTo = s.lost || (outcome && !outcome.won && outcome.reason);
    const mood = s.lost && s.lost !== 'enemy' ? 'burnt' : lostTo ? 'scared' : 'idle';
    const tremble = mood === 'scared' && phase === 'lose' ? Math.sin(time * 40) * 0.8 : 0;
    const face = s.exit && s.exit.x < h.x ? -1 : 1;
    const look = mood !== 'burnt' ? HERO_LOOK : s.lost === 'gas' ? POISONED : BURNT;
    drawFigure(h.x * CELL + tremble, h.y * CELL, { look, face, mood });
  }

  // ───────────── Particles ─────────────
  // Kinds: steam and smoke drift up and grow; sparks, flames and rock debris fly and fall; splashes are
  // droplets thrown up where a falling liquid lands; stars glint where gold reaches the room.
  function puff(x, y, kind) {
    const r = Math.random;
    switch (kind) {
      case 'steam': fx.emit({ x, y, vx: (r() - 0.5) * 16, vy: -22 - r() * 18, drag: 0.6, life: 0.9 + r() * 0.7, size: 2.5 + r() * 2, grow: 7, color: '#eef3fa', shape: 'smoke', alpha: 0.9 }); break;
      case 'smoke': fx.emit({ x, y, vx: (r() - 0.5) * 12, vy: -16 - r() * 14, drag: 0.5, life: 1 + r() * 0.6, size: 2.5 + r() * 2, grow: 5, color: '#3a3238', shape: 'smoke' }); break;
      case 'spark': fx.emit({ x, y, vx: (r() - 0.5) * 70, vy: -50 - r() * 60, gravity: 200, life: 0.5 + r() * 0.3, size: 1.3, color: '#ffc04a', shape: 'spark' }); break;
      case 'flame': fx.emit({ x, y, vx: (r() - 0.5) * 20, vy: -30 - r() * 30, gravity: -40, drag: 0.4, life: 0.5 + r() * 0.3, size: 2 + r() * 1.5, color: '#ff9a2a', shape: 'spark' }); break;
      case 'debris': fx.emit({ x, y, vx: (r() - 0.5) * 220, vy: -60 - r() * 140, gravity: 420, life: 0.7 + r() * 0.5, size: 1.6 + r() * 2.2, color: r() < 0.5 ? '#7d6655' : '#54463e', shape: 'chunk', spin: (r() - 0.5) * 20, angle: r() * TAU }); break;
      case 'splash': fx.emit({ x, y, vx: (r() - 0.5) * 70, vy: -40 - r() * 50, gravity: 320, life: 0.35 + r() * 0.25, size: 0.9 + r() * 0.7, color: '#bfe8ff' }); break;
      case 'lavaSplash': fx.emit({ x, y, vx: (r() - 0.5) * 60, vy: -35 - r() * 45, gravity: 320, life: 0.35 + r() * 0.25, size: 1 + r() * 0.7, color: '#ffb030', shape: 'spark' }); break;
      case 'star': fx.emit({ x, y, vx: (r() - 0.5) * 40, vy: -30 - r() * 30, gravity: 60, life: 0.6 + r() * 0.3, size: 2.6 + r() * 1.6, color: '#ffd84a', shape: 'star', spin: (r() - 0.5) * 8 }); break;
      default: break;
    }
  }

  // The win: confetti over the room and a ring of stars around the hero.
  function celebrate() {
    const h = s.hero;
    const room = s.room || { x: 0, y: 0, w: W, h: H };
    for (let n = 0; n < 40; n++) {
      fx.emit({
        x: (room.x + Math.random() * room.w) * CELL, y: room.y * CELL + Math.random() * 20,
        vx: (Math.random() - 0.5) * 60, vy: 20 + Math.random() * 50, gravity: 40, drag: 0.6, life: 1.6 + Math.random() * 0.8,
        size: 2.5 + Math.random() * 1.5, color: ['#ffd34d', '#ff6a55', '#7ad37a', '#5b9bff', '#ffffff'][n % 5], shape: 'confetti',
        spin: (Math.random() - 0.5) * 16, angle: Math.random() * TAU,
      });
    }
    if (h) for (let n = 0; n < 10; n++) puff(h.x * CELL + 15, h.y * CELL + 18, 'star');
  }

  const FLOW_CELLS = 6; // liquid cells that moved into empty space in one frame to count as pouring
  // Changes since the last frame: new stone hisses with steam, burnt gold sparks, gold reaching the room clinks,
  // pouring water gurgles and pouring lava bubbles, a freshly dead enemy starts burning up.
  // Gas burnt by lava flares up; a keg blast flashes, throws rock and shakes the board.
  function watchChanges() {
    for (const b of s.blasts.splice(0)) {
      const x = b.x * CELL + 5, y = b.y * CELL + 5;
      flashes.push({ x, y, t: 0 });
      for (let n = 0; n < 12; n++) puff(x, y, 'debris');
      for (let n = 0; n < 5; n++) puff(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30, 'smoke');
      for (let n = 0; n < 6; n++) puff(x, y, 'spark');
      quake.add(0.75);
      sfx('boom');
    }
    s.enemies.forEach((e, n) => {
      if (!e.dead || deadSeen[n]) return;
      deadSeen[n] = true;
      burning.push({ e, t: 0 });
      if (e.cause === 'gas') sfx('choke');
      else if (e.cause === 'lava') sfx('burn');
    });
    const g = s.grid;
    if (!prevGrid) { prevGrid = g.slice(); prevGold = C.goldInRoom(s); return; }
    let hiss = false, burn = false, flare = false, water = 0, lava = 0, stones = 0, splashes = 0, glints = 0;
    for (let i = 0; i < W * H; i++) {
      const was = prevGrid[i], now = g[i];
      if (was === now) continue;
      const x = i % W, y = (i - x) / W;
      if (was === EMPTY && now === WATER) water++;
      else if (was === EMPTY && now === LAVA) lava++;
      if (now === STONE && was !== STONE) {
        hiss = true;
        if (stones++ < 10) {
          puff(x * CELL + 5, y * CELL + 2, 'steam');
          if (stones % 3 === 0) puff(x * CELL + 5, y * CELL + 2, 'smoke');
          if (stones % 2 === 0) puff(x * CELL + 5, y * CELL + 2, 'splash');
        }
      } else if ((was === GOLD || was === GAS) && now === EMPTY) {
        const nearLava = NEIGHBOURS.some(([dx, dy]) => C.cellAt(s, x + dx, y + dy) === LAVA);
        if (nearLava && was === GOLD) {
          burn = true;
          for (let n = 0; n < 2; n++) puff(x * CELL + 5, y * CELL + 5, 'spark');
        } else if (nearLava) {
          flare = true;
          puff(x * CELL + 5, y * CELL + 5, 'flame');
        }
      } else if ((now === WATER || now === LAVA) && splashes < 6 && y > 0 && prevGrid[i - W] === now
        && !openCell(cell(x, y + 1)) && cell(x, y + 1) !== now && Math.random() < 0.5) {
        // A falling stream landing on a floor or on something solid splashes.
        splashes++;
        puff(x * CELL + 5, y * CELL + 2, now === WATER ? 'splash' : 'lavaSplash');
      } else if (now === GOLD && glints < 1 && inRect(s.room, x, y) && !openCell(cell(x, y + 1)) && Math.random() < 0.08) {
        glints++;
        puff(x * CELL + 5, y * CELL + 4, 'star');
      }
    }
    prevGrid.set(g);
    if (hiss) sfx('hiss');
    if (burn) sfx('sizzle');
    if (flare) sfx('poof');
    if (water >= FLOW_CELLS) sfx('gurgle');
    if (lava >= FLOW_CELLS) sfx('bubble');
    const gold = C.goldInRoom(s);
    if (gold > prevGold) sfx('coin');
    prevGold = gold;
  }

  // ───────────── Frame ─────────────
  function draw(dt) {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (!s) return;
    quake.update(dt);
    const sh = quake.offset();
    if (sh.x || sh.y) {
      ctx.fillStyle = '#100b0a';
      ctx.fillRect(0, 0, LW, LH);
      ctx.translate(sh.x, sh.y);
    }
    const key = `${level}:${s.rock}`; // a blast that broke rock redraws it; resize() clears staticKey
    if (key !== staticKey) { staticLayer = buildStatic(); staticKey = key; }
    ctx.drawImage(staticLayer, 0, 0, LW, LH);
    drawTorches();
    // The door opens as the hero comes close and stays open once the hero is through.
    let open = 0;
    if (phase === 'walk') open = clamp((phaseT - V.walkTime(s.hero, s.exit)) / DOOR_T, 0, 1);
    else if (outcome && outcome.won && phase === 'end') open = 1;
    drawSolids();
    drawKegs();
    drawDoor(open);
    drawLiquids(dt);
    drawEntities(dt);
    drawGas();
    drawPins(dt);
    drawFlashes(dt);
    fx.update(dt);
    fx.draw(ctx);
    drawHint();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    Fx.vignette(ctx, LW, LH, 0.3);
    if (phase === 'lose' || (phase === 'end' && outcome && !outcome.won)) {
      const a = Math.min(1, phaseT * 2) * 0.35;
      const vg = ctx.createRadialGradient(LW / 2, LH / 2, LH * 0.25, LW / 2, LH / 2, LH * 0.7);
      vg.addColorStop(0, 'rgba(120, 0, 0, 0)');
      vg.addColorStop(1, `rgba(120, 0, 0, ${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, LW, LH);
    }
  }

  function update(dt) {
    phaseT += dt;
    if (phase === 'play' || phase === 'lose' || phase === 'walk') {
      const r = V.fixedSteps(acc, phase === 'play' ? dt * speed : dt);
      acc = r.acc;
      for (let i = 0; i < r.n; i++) C.step(s);
      watchChanges();
    }
    if (phase === 'play') {
      const st = C.status(s);
      if (st.status === 'won') {
        outcome = { won: true, reason: null, stars: C.stars(s), gold: C.goldInRoom(s), allDead: C.liveEnemies(s) === 0 };
        C.recordWin(storage, progress, level, outcome.stars);
        drag = null;
        setPhase('walk');
        celebrate();
        sfx('win');
      } else if (st.status === 'lost') {
        outcome = { won: false, reason: st.reason, instant: s.lost, stars: 0, gold: C.goldInRoom(s), allDead: C.liveEnemies(s) === 0 };
        drag = null;
        setPhase('lose');
        quake.add(s.lost ? 0.5 : 0.3);
        sfx('lose');
      }
    }
    if (phase === 'play' || phase === 'lose' || phase === 'walk') renderHUD();
    if (phase === 'walk' && phaseT > CHEER_T + V.walkTime(s.hero, s.exit) + WALK_TAIL) {
      finish();
    } else if (phase === 'lose' && phaseT > 1.3) {
      finish();
    }
  }

  function frame(now) {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    time += dt;
    if (s) update(dt);
    draw(dt);
    requestAnimationFrame(frame);
  }

  function setPhase(p) {
    phase = p;
    phaseT = 0;
  }

  // ───────────── Levels and results ─────────────
  function loadLevel(i) {
    level = clamp(i, 0, LEVELS.length - 1);
    s = C.buildLevel(LEVELS[level]);
    acc = 0;
    drag = null;
    pulled = [];
    burning = [];
    fx.clear();
    flashes = [];
    quake.trauma = 0;
    prevGrid = null;
    deadSeen = s.enemies.map((e) => e.dead);
    outcome = null;
    hint = null;
    if (level === 0) {
      const sol = C.solve(LEVELS[0]);
      if (sol.wins.length) hint = sol.wins[0][0];
    }
  }

  function startLevel(i) {
    Sound.unlock();
    loadLevel(i);
    setPhase('play');
    show(null);
    $('hud').hidden = false;
    const tip = TIPS[level];
    clearTimeout(tipTimer);
    $('tip').textContent = tip ? t(tip) : '';
    $('tip').hidden = !tip;
    renderHUD();
  }

  function doPull(id) {
    if (phase !== 'play' || !s) return false;
    const pin = s.pins.find((p) => p.id === id);
    if (!C.pull(s, id)) return false;
    pulled.push({ pin: { ...pin }, t: 0 });
    hint = null;
    $('tip').hidden = true;
    sfx('pin');
    return true;
  }

  function finish() {
    if (!outcome.won) outcome.gold = C.goldInRoom(s);
    setPhase('end');
    showResult();
  }

  // Why a level was lost: an instant loss (what reached the hero) or a settled one (what is left in the way).
  const INSTANT = {
    lava: 'Лава добралась до героя',
    gas: 'Газ отравил героя',
    blast: 'Героя задело взрывом',
    enemy: 'Враг добрался до героя',
  };
  const REASONS = {
    lava: 'Лава преградила путь к выходу',
    gas: 'Газ преградил путь к выходу',
    nogold: 'Золота не хватило',
  };

  function starsHTML(n) {
    let h = '';
    for (let i = 0; i < 3; i++) h += `<span class="${i < n ? 'on' : 'off'}">★</span>`;
    return h;
  }

  function showResult() {
    const o = outcome;
    $('res-title').textContent = o.won ? t('Уровень пройден!') : t('Неудача');
    $('res-reason').textContent = o.won ? '' : t(INSTANT[o.instant] || REASONS[o.reason] || REASONS.nogold);
    $('res-reason').hidden = o.won;
    $('res-stars').innerHTML = starsHTML(o.stars);
    $('res-stars').setAttribute('aria-label', t('Звёзды: {n} из 3', { n: o.stars }));
    $('res-gold').textContent = t('Золото: {n} из {target}', { n: o.gold, target: s.goldTarget });
    const goals = $('res-goals');
    goals.innerHTML = '';
    const rich = C.richEnough(o.gold, s.goldTarget);
    for (const [ok, text] of [[o.won, 'Герой дошёл до выхода'], [o.won && o.allDead, s.enemies.length ? 'Все враги повержены' : 'Врагов нет'],
      [o.won && rich, 'Золота в полтора раза больше нужного']]) {
      const li = document.createElement('li');
      li.className = ok ? 'ok' : 'no';
      li.textContent = t(text);
      goals.append(li);
    }
    const hasNext = level + 1 < LEVELS.length;
    $('btn-next').hidden = !(o.won && hasNext);
    $('res-final').hidden = !(o.won && !hasNext);
    show('result');
    (o.won && hasNext ? $('btn-next') : $('btn-again')).focus({ preventScroll: true });
  }

  // ───────────── Screens ─────────────
  const SCREENS = ['menu', 'levels', 'result'];
  function show(name) {
    for (const id of SCREENS) $(id).hidden = id !== name;
    stage.classList.toggle('dim', !!name);
  }

  // The first level without stars (the last one once all are done).
  const nextLevel = () => Math.min(C.firstUnfinished(progress, LEVELS.length), LEVELS.length - 1);

  function showMenu() {
    const next = nextLevel();
    loadLevel(next);
    setPhase('menu');
    $('hud').hidden = true;
    $('tip').hidden = true;
    $('btn-play').textContent = t('Играть: уровень {n}', { n: next + 1 });
    renderSound();
    show('menu');
    $('btn-play').focus({ preventScroll: true });
  }

  function showLevels() {
    setPhase('menu'); // the level behind the screen stands still
    const grid = $('level-grid');
    grid.innerHTML = '';
    let total = 0;
    LEVELS.forEach((_, i) => {
      const chapter = CHAPTERS.findIndex((c) => c.from === i);
      if (chapter >= 0) {
        const c = CHAPTERS[chapter];
        const end = chapter + 1 < CHAPTERS.length ? CHAPTERS[chapter + 1].from : LEVELS.length;
        let got = 0;
        for (let j = c.from; j < end; j++) got += C.starsOf(progress, j);
        const head = document.createElement('h3');
        head.className = 'chapter';
        head.innerHTML = '<span></span><small></small>';
        head.firstChild.textContent = t(c.title);
        head.lastChild.textContent = `★ ${got}/${(end - c.from) * 3}`;
        grid.append(head);
      }
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
    $('tip').hidden = true;
    show('levels');
    const cur = grid.querySelectorAll('.lvl-btn')[nextLevel()];
    if (cur) {
      cur.focus({ preventScroll: true });
      grid.scrollTop = Math.max(0, cur.offsetTop - grid.offsetTop - grid.clientHeight / 2 + cur.offsetHeight / 2);
    }
  }

  let hudKey = '';
  function renderHUD() {
    if (!s) return;
    const gold = C.goldInRoom(s);
    const key = `${level}:${gold}/${s.goldTarget}`;
    if (key === hudKey) return;
    hudKey = key;
    $('hud-level').textContent = t('Уровень {n}', { n: level + 1 });
    $('hud-gold').textContent = `${gold}/${s.goldTarget}`;
    $('hud-gold-wrap').classList.toggle('full', gold >= s.goldTarget);
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

  // The hint: the planner looks for the best way on from the current state and points at its next pin.
  let tipTimer = 0;
  function flashTip(text) {
    $('tip').textContent = t(text);
    $('tip').hidden = false;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { $('tip').hidden = true; }, 2600);
  }

  function showHint() {
    if (phase !== 'play' || !s) return;
    Sound.unlock();
    const plan = C.bestPlan(s);
    if (!plan) flashTip('Так уже не выйти. Начни заново');
    else if (!plan.order.length) flashTip('Всё получится, просто подожди');
    else {
      hint = plan.order[0];
      $('tip').hidden = true;
    }
    sfx('hint');
  }

  function renderSpeed() {
    const b = $('btn-speed');
    b.setAttribute('aria-pressed', String(speed > 1));
    b.classList.toggle('on', speed > 1);
  }

  function toggleSpeed() {
    speed = speed > 1 ? 1 : 2;
    renderSpeed();
  }

  // ───────────── Input ─────────────
  function pointerCell(e) {
    const r = canvas.getBoundingClientRect();
    return V.screenToCell(e.clientX - r.left, e.clientY - r.top, fit);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (phase !== 'play' || drag) return;
    Sound.unlock();
    const c = pointerCell(e);
    drag = V.dragStart(s, c.fx, c.fy);
    if (!drag) return;
    drag.pointer = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (phase !== 'play') { canvas.style.cursor = ''; return; }
    const c = pointerCell(e);
    if (drag && e.pointerId === drag.pointer) {
      V.dragMove(drag, c.fx, c.fy);
      if (drag.along >= V.PULL_DRAG) { // pulled far enough: no need to wait for the release
        const id = drag.id;
        drag = null;
        canvas.style.cursor = '';
        doPull(id);
      }
      return;
    }
    if (!drag) canvas.style.cursor = V.pinAt(s, c.x, c.y) ? 'grab' : '';
  });
  const release = (e, cancel) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const c = pointerCell(e);
    const d = drag;
    drag = null;
    canvas.style.cursor = '';
    if (!cancel && V.dragEnd(d, c.fx, c.fy)) doPull(d.id);
  };
  canvas.addEventListener('pointerup', (e) => release(e, false));
  canvas.addEventListener('pointercancel', (e) => release(e, true));

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (phase === 'play' && /^Digit[1-5]$/.test(e.code)) {
      doPull(Number(e.code.slice(5)));
      e.preventDefault();
    } else if (e.code === 'KeyR' && s && phase !== 'menu') {
      startLevel(level);
      e.preventDefault();
    } else if (e.code === 'KeyH' && phase === 'play') {
      showHint();
      e.preventDefault();
    } else if (e.code === 'KeyF' && phase === 'play') {
      toggleSpeed();
      e.preventDefault();
    } else if (e.code === 'Escape' && !$('levels').hidden) {
      showMenu();
    }
  });

  $('btn-play').addEventListener('click', () => startLevel(nextLevel()));
  $('btn-levels-menu').addEventListener('click', showLevels);
  $('btn-sound-menu').addEventListener('click', toggleSound);
  $('btn-levels-back').addEventListener('click', showMenu);
  $('btn-restart').addEventListener('click', () => startLevel(level));
  $('btn-levels').addEventListener('click', showLevels);
  $('btn-sound').addEventListener('click', toggleSound);
  $('btn-hint').addEventListener('click', showHint);
  $('btn-speed').addEventListener('click', toggleSpeed);
  $('btn-next').addEventListener('click', () => startLevel(level + 1));
  $('btn-again').addEventListener('click', () => startLevel(level));
  $('btn-res-levels').addEventListener('click', showLevels);
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);

  // ───────────── Boot ─────────────
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = t(meta.content);
  const actions = $('top-actions');
  actions.append(window.I18n.toggle('chip'));
  if (window.GameNav) actions.append(window.GameNav.home('chip'));
  resize();
  renderSpeed();
  showMenu();
  requestAnimationFrame(frame);
})();
