'use strict';
// Тесная парковка — client: screens, input, animation and the Canvas 2D art of the lot. The rules live in core.js
// (window.ParkingCore), the levels in levels.js (window.ParkingLevels), pure helpers in view.js (window.ParkingView).
(() => {
  const C = window.ParkingCore;
  const V = window.ParkingView;
  const LEVELS = window.ParkingLevels.LEVELS;
  const { t } = window.I18n;
  const $ = (id) => document.getElementById(id);
  const { clamp, hash2, PAD, ROAD } = V;
  // A rounded rectangle path; older browsers without roundRect get a plain one.
  const rrect = (g, x, y, w, h, r) => (g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h));
  const TAU = Math.PI * 2;

  // Storage access itself may throw (blocked site data); core's progress functions tolerate a null storage.
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }

  // Sound comes from audio.js (index.html loads it first); its play() is silent while the sound is off.
  // Names: slide ({ dist, kind }), bump, barrier ({ open }), undo, hint, win, lose.
  const Sound = window.ParkingAudio;
  const sfx = (name, opts) => Sound.play(name, opts);

  // Level facts the tips and the art need.
  const PARSED = LEVELS.map((d) => C.parseLevel(d));
  const hasGate = (L) => L.cells.includes(C.GATE);
  const hasTow = (L) => L.vehicles.some((v) => v.kind === 'tow');
  const FIRST_GATE = PARSED.findIndex(hasGate);
  const FIRST_TOW = PARSED.findIndex(hasTow);
  function tipFor(i) {
    if (i === 0) return 'Перетащи машину, чтобы освободить путь красной';
    if (i === 1) return 'Сдвиг на любое число клеток — один ход';
    if (i === FIRST_GATE && i === FIRST_TOW) return 'Шлагбаум открыт на чётных ходах, тягач едет на одну клетку';
    if (i === FIRST_GATE) return 'Шлагбаум открыт только на чётных ходах';
    if (i === FIRST_TOW) return 'Тягач едет только на одну клетку за ход';
    return null;
  }

  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  let progress = C.loadProgress(storage);
  let level = 0;
  let s = null;            // core state of the level on screen
  let phase = 'menu';      // menu | play | exit | lose | end
  let phaseT = 0;          // seconds in the current phase
  let outcome = null;      // { won, stars, moves }
  let hintsUsed = 0;
  let hint = null;         // { id, delta } shown until the next move
  let hintBusy = false;
  let route = null;        // the last solution the hints came from: { base: pathOf when found, sol }
  let version = 0;         // bumps on every change of the board, so a search started before it is dropped
  let drag = null;         // { id, pointer, x0, y0, shift, over, started, bumped }
  let sel = null;          // vehicle picked with the keyboard
  let pending = 0;         // keyboard shift of `sel` not yet made into a move
  let pendingT = 0;
  let rp = {};             // id → drawn position along the vehicle's axis (cells)
  let bumps = {};          // id → { dir, t } a short wobble after hitting something
  let gates = [];          // barrier cells: { x, y, a } with a = 0 closed … 1 raised
  let lift = {};           // id → 0 … 1, how far the vehicle is lifted off the lot (while dragged)
  let vel = {};            // id → drawn speed along its axis (cells/s), for trails and landings
  const particles = new window.Fx.Particles(220);
  const shakeFx = new window.Fx.Shake(0.12, 1.8); // in cells; offsets the drawing only
  let flash = 0;           // the burst of light at the exit when the red car drives out
  let exitV = 0;           // speed of the player's car driving off after the win
  let exitGone = -1;       // phaseT when the red car left the screen
  let exitBurst = false;
  let time = 0;
  let last = 0;

  // ───────────── Canvas size and the cached static layer ─────────────
  let fit = V.fitBoard({}, PARSED[0]);
  let staticLayer = null;
  let staticKey = '';

  function resize() {
    const L = s ? s.level : PARSED[0];
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const next = V.fitBoard({ w: stage.clientWidth - padX, h: stage.clientHeight - padY, dpr: window.devicePixelRatio || 1 }, L);
    if (next.w === canvas.width && next.h === canvas.height && next.cell === fit.cell && next.cols === fit.cols && next.rows === fit.rows) return;
    fit = next;
    canvas.style.width = fit.cssW + 'px';
    canvas.style.height = fit.cssH + 'px';
    canvas.width = fit.w;
    canvas.height = fit.h;
    staticKey = '';
  }

  // Draw in cell units with the grid's top-left corner at (0, 0).
  const worldTransform = (g) => {
    const k = fit.cell * fit.ratio;
    g.setTransform(k, 0, 0, k, fit.ox * fit.ratio, fit.oy * fit.ratio);
  };

  // ───────────── Art kit ─────────────
  // Light comes from the top left (Fx.LIGHT); everything that stands on the lot rises screen-up from its own
  // cells, so hit-testing (view.js) never depends on the drawing. Static scenery is baked once per level/size,
  // vehicle bodies once per (kind, colour, length, facing, cell size) into sprites, and stretched every frame.
  const Fx = window.Fx;
  const { shade, withAlpha } = Fx;
  const pxPerCell = () => fit.cell * fit.ratio;
  const newCanvas = (w, h) => {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    return cv;
  };
  // A point of a vehicle's own frame (front towards +x, rotated by ang) at height z, in screen cells from its centre.
  const toScreen = (ang, x, y, z) => ({ x: x * Math.cos(ang) - y * Math.sin(ang), y: x * Math.sin(ang) + y * Math.cos(ang) - z });
  // A screen-space gradient (top-left → bottom-right over ±R) expressed in a frame rotated by ang.
  function screenGrad(g, ang, R, stops) {
    const c = Math.cos(ang), sn = Math.sin(ang);
    const loc = (x, y) => [x * c + y * sn, -x * sn + y * c];
    const [ax, ay] = loc(-R, -R), [bx, by] = loc(R, R);
    const gr = g.createLinearGradient(ax, ay, bx, by);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    return gr;
  }
  // Runs fn in a vehicle's frame lifted z cells above the ground.
  function at(g, ang, z, fn) {
    g.save();
    g.translate(0, -z);
    g.rotate(ang);
    fn();
    g.restore();
  }

  // Fx's block, prism and metalBar assume pixel units (1 px outlines and bevels); these run them at 1/100 scale
  // so they work in cell units.
  const U = 100;
  function scaled(g, fn) { g.save(); g.scale(1 / U, 1 / U); fn(); g.restore(); }
  const bar = (g, x0, y0, x1, y1, th, tint) => scaled(g, () => Fx.metalBar(g, x0 * U, y0 * U, x1 * U, y1 * U, th * U, tint));
  const box = (g, x, y, w, h, r, color, o = {}) => scaled(g, () => Fx.block(g, x * U, y * U, w * U, h * U, r * U, color, { ...o, edge: o.edge && o.edge * U }));
  const prism = (g, x, y, w, h, d, color, o = {}) => scaled(g, () => Fx.prism(g, x * U, y * U, w * U, h * U, d * U, color, { ...o, r: (o.r || 0) * U, edge: o.edge && o.edge * U }));

  // ───────────── Static layer: pavement, asphalt, curbs, markings, bollards ─────────────
  // Fine asphalt grain: a tile of per-pixel noise (two octaves and a few bright stones), laid as a pattern.
  let grainTile = null;
  function grain() {
    if (grainTile) return grainTile;
    const N = 160;
    const cv = newCanvas(N, N);
    const g = cv.getContext('2d');
    const img = g.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const x = i % N, y = (i / N) | 0;
      const k = hash2(x, y, 77) * 0.55 + hash2(x >> 2, y >> 2, 78) * 0.45;
      const stone = hash2(x, y, 79) > 0.988;
      const light = stone || k > 0.5;
      const v = light ? 255 : 0;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = light ? 245 : 8;
      img.data[i * 4 + 3] = stone ? 70 : Math.round(Math.abs(k - 0.5) * 2 * (light ? 40 : 75));
    }
    g.putImageData(img, 0, 0);
    grainTile = cv;
    return cv;
  }

  function buildStatic() {
    const L = s.level;
    const cv = newCanvas(fit.w, fit.h);
    const g = cv.getContext('2d');
    worldTransform(g);
    const x0 = -PAD, y0 = -PAD, X1 = L.w + PAD + ROAD, Y1 = L.h + PAD;
    const ey = L.exitRow;
    const pattern = g.createPattern(grain(), 'repeat');
    const grainOver = (alpha) => { // the grain over whatever is clipped now, in device pixels
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = alpha;
      g.fillStyle = pattern;
      g.fillRect(0, 0, cv.width, cv.height);
      g.restore();
    };

    // Pavement: bevelled concrete slabs, lit from the top left.
    g.fillStyle = '#69717e';
    g.fillRect(x0, y0, X1 - x0, Y1 - y0);
    const T = 0.5;
    for (let ty = Math.floor(y0 / T); ty * T < Y1; ty++) {
      for (let tx = Math.floor(x0 / T); tx * T < X1; tx++) {
        const v = hash2(tx, ty, 3), px = tx * T, py = ty * T;
        g.fillStyle = v > 0.5 ? `rgba(255, 250, 240, ${(v - 0.5) * 0.12})` : `rgba(10, 12, 30, ${(0.5 - v) * 0.16})`;
        g.fillRect(px, py, T, T);
        g.fillStyle = 'rgba(255, 255, 255, .13)';
        g.fillRect(px + 0.02, py + 0.02, T - 0.04, 0.025);
        g.fillRect(px + 0.02, py + 0.02, 0.025, T - 0.04);
        g.fillStyle = 'rgba(12, 14, 30, .28)';
        g.fillRect(px, py + T - 0.025, T, 0.025);
        g.fillRect(px + T - 0.025, py, 0.025, T);
      }
    }
    g.save();
    g.beginPath(); g.rect(x0, y0, X1 - x0, Y1 - y0); g.clip();
    grainOver(0.5);
    g.restore();

    // Planters: raised boxes of soil with round lit bushes, right of the lot above and below the exit road.
    const rx = L.w + PAD + 0.14, rw = ROAD - 0.28;
    for (const [top, bot] of [[y0 + 0.16, ey - 0.28], [ey + 1.3, Y1 - 0.14]]) {
      if (bot - top < 0.5) continue;
      Fx.shadow(g, rx + rw / 2 + 0.08, (top + bot) / 2 + 0.1, rw * 0.62, (bot - top) * 0.55, 0.45);
      prism(g, rx, top + 0.06, rw, bot - top - 0.06, 0.08, '#aeb5bf', { r: 0.06 });
      const sg = g.createLinearGradient(0, top, 0, bot);
      sg.addColorStop(0, '#4b3a2b');
      sg.addColorStop(1, '#3a2c20');
      g.fillStyle = sg;
      g.beginPath(); rrect(g, rx + 0.07, top + 0.04, rw - 0.14, bot - top - 0.12, 0.05); g.fill();
      for (let by = top + 0.4, i = 0; by < bot - 0.22; by += 0.74, i++) {
        const cx = rx + rw / 2, salt = i + Math.round(top * 10);
        Fx.shadow(g, cx + 0.07, by + 0.12, 0.36, 0.26, 0.55);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU + hash2(k, salt, 9) * 1.2;
          const rr = 0.17 + hash2(k, salt, 4) * 0.06;
          Fx.sphere(g, cx + Math.cos(a) * 0.15, by + Math.sin(a) * 0.12, rr, k % 2 ? '#4f9e45' : '#5cae4c', { gloss: false, shine: 0.35 });
        }
        Fx.sphere(g, cx - 0.02, by - 0.04, 0.2, '#6cbd57', { shine: 0.45, gloss: false });
        g.fillStyle = 'rgba(230, 255, 190, .3)';
        g.beginPath(); g.ellipse(cx - 0.08, by - 0.12, 0.07, 0.045, -0.5, 0, TAU); g.fill();
      }
    }

    // Asphalt: the lot and the exit road. Paint first, then grain over it so the lines look worn into the surface.
    g.save();
    g.beginPath();
    g.rect(0, 0, L.w, L.h);
    g.rect(L.w - 0.01, ey, X1 - L.w + 0.02, 1);
    g.clip();
    const asph = g.createLinearGradient(0, 0, L.w, L.h);
    asph.addColorStop(0, '#454a55');
    asph.addColorStop(1, '#30343d');
    g.fillStyle = asph;
    g.fillRect(0, 0, X1, L.h);
    // Broad tonal patches: patched and worn areas.
    for (let i = 0; i < Math.round(L.w * L.h / 4); i++) {
      const px = hash2(i, 11, level) * L.w, py = hash2(i, 12, level) * L.h;
      const r = 0.6 + hash2(i, 13, level) * 0.9;
      if (hash2(i, 14, level) < 0.5) Fx.shadow(g, px, py, r, r * 0.8, 0.12);
      else Fx.glow(g, px, py, r, '#8a8f99', 0.06);
    }
    // Bay lines: painted strokes along the grid lines with a soft dark edge, open at the crossings.
    const bays = (style, width, off) => {
      g.strokeStyle = style;
      g.lineWidth = width;
      g.lineCap = 'round';
      g.beginPath();
      for (let x = 1; x < L.w; x++) for (let y = 0; y < L.h; y++) { g.moveTo(x + off, y + 0.16 + off); g.lineTo(x + off, y + 0.84 + off); }
      for (let y = 1; y < L.h; y++) for (let x = 0; x < L.w; x++) { g.moveTo(x + 0.16 + off, y + off); g.lineTo(x + 0.84 + off, y + off); }
      g.stroke();
    };
    bays('rgba(10, 12, 20, .25)', 0.06, 0.012);
    bays('rgba(238, 242, 248, .42)', 0.04, 0);
    g.fillStyle = 'rgba(238, 242, 248, .3)';
    for (let x = 1; x < L.w; x++) for (let y = 1; y < L.h; y++) { g.beginPath(); g.arc(x, y, 0.035, 0, TAU); g.fill(); }
    // The exit lane: yellow edge lines and a stop line.
    g.strokeStyle = 'rgba(255, 205, 60, .8)';
    g.lineWidth = 0.05;
    g.setLineDash([0.2, 0.13]);
    g.beginPath(); g.moveTo(L.w + 0.1, ey + 0.09); g.lineTo(X1, ey + 0.09); g.moveTo(L.w + 0.1, ey + 0.91); g.lineTo(X1, ey + 0.91); g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(245, 248, 252, .6)';
    for (let k = 0; k < 4; k++) g.fillRect(L.w + 0.05, ey + 0.1 + k * 0.22, 0.09, 0.12);
    // Barrier boxes: yellow-black hatching.
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        if (L.cells[y * L.w + x] !== C.GATE) continue;
        g.save();
        g.beginPath(); g.rect(x + 0.07, y + 0.07, 0.86, 0.86); g.clip();
        g.fillStyle = 'rgba(255, 196, 30, .14)';
        g.fillRect(x, y, 1, 1);
        g.strokeStyle = 'rgba(255, 196, 30, .6)';
        g.lineWidth = 0.07;
        g.beginPath();
        for (let d = -1; d < 2; d += 0.25) { g.moveTo(x + d, y); g.lineTo(x + d + 1, y + 1); }
        g.stroke();
        g.restore();
        g.strokeStyle = 'rgba(255, 196, 30, .9)';
        g.lineWidth = 0.05;
        g.strokeRect(x + 0.07, y + 0.07, 0.86, 0.86);
      }
    }
    grainOver(0.85);
    // Oil stains and a few cracks.
    for (let i = 0; i < Math.round(L.w * L.h / 7); i++) {
      const px = 0.3 + hash2(i, 5, level) * (L.w - 0.6), py = 0.3 + hash2(i, 6, level) * (L.h - 0.6);
      g.save();
      g.translate(px, py);
      g.rotate(hash2(i, 7, level) * 3);
      g.scale(1, 0.7);
      Fx.shadow(g, 0, 0, 0.3, 0.3, 0.32);
      g.restore();
    }
    g.strokeStyle = 'rgba(14, 16, 22, .55)';
    g.lineWidth = 0.022;
    for (let i = 0; i < 3; i++) {
      let px = hash2(i, 8, level) * L.w, py = hash2(i, 9, level) * L.h;
      g.beginPath(); g.moveTo(px, py);
      for (let k = 0; k < 5; k++) { px += (hash2(i, k, 30) - 0.5) * 0.5; py += hash2(i, k, 31) * 0.3; g.lineTo(px, py); }
      g.stroke();
    }
    // Ambient occlusion along the curbs: the light is top-left, so the top and left rims shade the asphalt.
    const ao = (ax, ay, bx, by, x, y, w, h, a) => {
      const gr = g.createLinearGradient(ax, ay, bx, by);
      gr.addColorStop(0, `rgba(6, 6, 18, ${a})`);
      gr.addColorStop(1, 'rgba(6, 6, 18, 0)');
      g.fillStyle = gr;
      g.fillRect(x, y, w, h);
    };
    ao(0, 0, 0, 0.32, 0, 0, X1, 0.32, 0.42);
    ao(0, 0, 0.3, 0, 0, 0, 0.3, L.h, 0.38);
    ao(0, L.h, 0, L.h - 0.12, 0, L.h - 0.12, L.w, 0.12, 0.2);
    ao(L.w, 0, L.w - 0.12, 0, L.w - 0.12, 0, 0.12, L.h, 0.18);
    ao(0, ey, 0, ey + 0.25, L.w, ey, X1, 0.25, 0.35);
    g.restore();

    // Curbs: raised concrete with a lit top face and a darker front face; drawn top to bottom so they overlap right.
    const t = 0.16, D = 0.07, e = 0.08;
    const bands = [
      [-e - t / 2, -e - t / 2, L.w + 2 * e + t, t],
      [-e - t / 2, -e - t / 2, t, L.h + 2 * e + t],
      [L.w + e - t / 2, -e - t / 2, t, ey + e + t / 2],
      [L.w + e - t / 2, ey - t / 2 + 0.04, X1 - L.w - e + t / 2, t - 0.04],
      [L.w + e - t / 2, ey + 1, X1 - L.w - e + t / 2, t - 0.02],
      [L.w + e - t / 2, ey + 1, t, L.h - ey - 1 + e + t / 2],
      [-e - t / 2, L.h + e - t / 2, L.w + 2 * e + t, t],
    ].sort((a, b) => a[1] + a[3] - (b[1] + b[3]));
    for (const [x, y, w, h] of bands) {
      g.fillStyle = 'rgba(6, 6, 18, .3)';
      g.beginPath(); rrect(g, x + 0.04, y + 0.06, w, h, 0.04); g.fill();
    }
    for (const [x, y, w, h] of bands) {
      g.fillStyle = '#7f8691';
      g.beginPath(); rrect(g, x, y, w, h, 0.04); g.fill();
      const tg = g.createLinearGradient(x, y - D, x + Math.min(w, 1), y - D + Math.min(h, 1));
      tg.addColorStop(0, '#e9ecf0');
      tg.addColorStop(1, '#b9bfc8');
      g.fillStyle = tg;
      g.beginPath(); rrect(g, x, y - D, w, h, 0.04); g.fill();
      g.fillStyle = 'rgba(255, 255, 255, .55)';
      g.fillRect(x + 0.02, y - D + 0.012, w - 0.04, 0.018);
    }

    // Exit sign on a post at the corner of the road.
    const sx = L.w + PAD * 0.55, sy = ey > 0 ? ey - 0.34 : ey + 1.34;
    Fx.shadow(g, sx + 0.1, sy + 0.14, 0.28, 0.2, 0.5);
    bar(g, sx, sy + 0.08, sx, sy + 0.22, 0.06);
    box(g, sx - 0.21, sy - 0.21, 0.42, 0.4, 0.07, '#1f9d55', { edge: 0.02, gloss: true });
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(sx - 0.12, sy - 0.035); g.lineTo(sx + 0.01, sy - 0.035); g.lineTo(sx + 0.01, sy - 0.1); g.lineTo(sx + 0.13, sy);
    g.lineTo(sx + 0.01, sy + 0.1); g.lineTo(sx + 0.01, sy + 0.035); g.lineTo(sx - 0.12, sy + 0.035); g.closePath(); g.fill();

    // Bollards: yellow steel posts with a black reflective band, standing up from their cell.
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        if (L.cells[y * L.w + x] !== C.BOLLARD) continue;
        const cx = x + 0.5, base = y + 0.66, rx = 0.17, ry = 0.075, hgt = 0.36, top = base - hgt;
        g.fillStyle = 'rgba(255, 196, 30, .1)';
        g.beginPath(); g.arc(cx, y + 0.5, 0.42, 0, TAU); g.fill();
        Fx.shadow(g, cx + 0.14, base + 0.04, 0.3, 0.14, 0.6);
        g.fillStyle = '#5b626d';
        g.beginPath(); g.ellipse(cx, base, rx + 0.06, ry + 0.03, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255, 255, 255, .25)';
        g.beginPath(); g.ellipse(cx, base - 0.01, rx + 0.05, ry + 0.02, 0, Math.PI, TAU); g.fill();
        Fx.cylinder(g, cx, top, rx, hgt, '#ffc61f', { ry, capColor: '#ffd84a' });
        const b0 = top + 0.1, b1 = top + 0.18;
        const bg = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
        bg.addColorStop(0, '#2c3038'); bg.addColorStop(0.3, '#5d6470'); bg.addColorStop(1, '#0e1014');
        g.fillStyle = bg;
        g.beginPath();
        g.ellipse(cx, b0, rx, ry, 0, Math.PI, 0, true);
        g.lineTo(cx + rx, b1);
        g.ellipse(cx, b1, rx, ry, 0, 0, Math.PI, false);
        g.closePath(); g.fill();
        g.fillStyle = 'rgba(255, 255, 255, .7)';
        g.beginPath(); g.ellipse(cx - 0.06, top - 0.02, 0.05, 0.022, -0.3, 0, TAU); g.fill();
      }
    }

    // A soft vignette over the whole lot.
    g.setTransform(1, 0, 0, 1, 0, 0);
    Fx.vignette(g, cv.width, cv.height, 0.32);
    return cv;
  }

  // ───────────── Vehicles ─────────────
  const CAR_COLORS = ['#3b82f6', '#22a06b', '#f2c94c', '#8e5cc9', '#e8ecf1', '#2b3240', '#14b8a6', '#8b5e3c', '#94a3b8', '#ec6fa9', '#6c8cff', '#a3d65c'];
  const BUS_COLORS = ['#f4b400', '#2f7fd8', '#2ea86a', '#7a5cd6'];
  const PLAYER_COLOR = '#e3342f';
  const TOW_COLOR = '#ff8a1f';

  const code = (id) => id.charCodeAt(0);
  function colorOf(v) {
    if (v.id === C.PLAYER) return PLAYER_COLOR;
    if (v.kind === 'tow') return TOW_COLOR;
    if (v.kind === 'bus') return BUS_COLORS[(code(v.id) + level) % BUS_COLORS.length];
    return CAR_COLORS[(code(v.id) * 5 + level * 3) % CAR_COLORS.length];
  }
  // Which way the vehicle faces: the player's car looks at the exit, the rest are parked either way.
  function angleOf(v) {
    if (v.id === C.PLAYER) return 0;
    const flip = hash2(code(v.id), level, 7) < 0.5;
    if (v.dir === 'h') return flip ? Math.PI : 0;
    return flip ? -Math.PI / 2 : Math.PI / 2;
  }
  // How tall a vehicle stands (cells): taller ones cast longer shadows.
  const heightOf = (v) => (v.kind === 'bus' ? 0.2 : v.kind === 'tow' ? 0.17 : 0.15);

  const basePos = (v) => (v.dir === 'h' ? v.x : v.y);
  const vehicle = (id) => s && s.vehicles.find((v) => v.id === id);
  // Top-left corner of a vehicle drawn at position p along its axis.
  const cornerAt = (v, p) => (v.dir === 'h' ? { x: p, y: v.y } : { x: v.x, y: p });
  const footprint = (v) => (v.dir === 'h' ? { w: v.len, h: 1 } : { w: 1, h: v.len });

  function bumpOffset(id) {
    const b = bumps[id];
    if (!b || b.settle) return 0;
    return b.dir * 0.09 * Math.exp(-b.t * 9) * Math.sin(b.t * 34);
  }
  // Squash along the axis: a hit compresses the body, then it springs back.
  function squashOf(id) {
    let q = 0;
    const b = bumps[id];
    if (b) q += b.amp * 0.085 * Math.exp(-b.t * 8) * Math.cos(b.t * 26);
    if (drag && drag.started && drag.id === id) q += Math.abs(drag.over) * 0.3;
    return q;
  }

  // Car silhouette: rounder at the front than at the back.
  function carPath(g, L, W, rF, rR) {
    const h = L / 2, w = W / 2;
    g.beginPath();
    if (g.roundRect) g.roundRect(-h, -w, L, W, [rR, rF, rF, rR]);
    else g.rect(-h, -w, L, W);
  }
  // Fills the current path as a lit body panel: a lit ridge along the middle, darker flanks, top-left light.
  function paintPanel(g, ang, L, W, color, ridge = 0.2) {
    const w = W / 2, h = L / 2;
    const bg = g.createLinearGradient(0, -w, 0, w);
    bg.addColorStop(0, shade(color, -0.38));
    bg.addColorStop(0.2, color);
    bg.addColorStop(0.48, shade(color, ridge));
    bg.addColorStop(0.8, color);
    bg.addColorStop(1, shade(color, -0.42));
    g.fillStyle = bg;
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = screenGrad(g, ang, Math.max(h, w), [[0, 'rgba(255, 250, 235, .3)'], [0.45, 'rgba(255, 250, 235, 0)'], [0.6, 'rgba(14, 10, 36, 0)'], [1, 'rgba(14, 10, 36, .38)']]);
    g.fillRect(-h - 0.2, -w - 0.2, L + 0.4, W + 0.4);
    g.restore();
  }
  // A directional bevel on the current path: bright towards the light, dark away from it.
  function bevel(g, ang, R, width, k = 1) {
    g.save();
    g.clip();
    g.lineWidth = width;
    g.strokeStyle = screenGrad(g, ang, R, [[0, `rgba(255, 255, 255, ${0.55 * k})`], [0.5, `rgba(255, 255, 255, ${0.12 * k})`], [0.55, 'rgba(10, 6, 30, .05)'], [1, `rgba(10, 6, 30, ${0.45 * k})`]]);
    g.stroke();
    g.restore();
  }
  // Tinted glass with a diagonal screen-space reflection streak; fills and clips the current path.
  function paintGlass(g, ang, R) {
    g.fillStyle = screenGrad(g, ang, R, [[0, '#5d7f9c'], [0.45, '#22364a'], [1, '#0f1824']]);
    g.fill();
    g.save();
    g.clip();
    g.rotate(-ang);
    g.rotate(Math.PI / 4);
    g.fillStyle = 'rgba(235, 247, 255, .42)';
    g.fillRect(-0.22, -2, 0.07, 4);
    g.fillStyle = 'rgba(235, 247, 255, .2)';
    g.fillRect(-0.11, -2, 0.03, 4);
    g.restore();
  }
  function lamp(g, x, y, w, h, color, glowA) {
    if (glowA) {
      g.fillStyle = withAlpha(color, glowA);
      g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w * 1.1, h * 0.75, 0, 0, TAU); g.fill();
    }
    g.fillStyle = color;
    g.beginPath(); rrect(g, x, y, w, h, Math.min(w, h) * 0.45); g.fill();
    g.fillStyle = 'rgba(255, 255, 255, .6)';
    g.beginPath(); rrect(g, x + w * 0.2, y + h * 0.15, w * 0.4, h * 0.3, Math.min(w, h) * 0.2); g.fill();
  }
  function wheels(g, ang, xs, w, z = 0) {
    at(g, ang, z, () => {
      for (const x of xs) for (const sy of [-1, 1]) {
        g.fillStyle = '#121419';
        g.beginPath(); rrect(g, x - 0.12, sy * w - 0.055, 0.24, 0.11, 0.045); g.fill();
        g.fillStyle = 'rgba(160, 170, 185, .35)';
        g.fillRect(x - 0.08, sy * w - 0.012 + sy * 0.025, 0.16, 0.022);
      }
    });
  }

  function paintCar(g, ang, L, W, color, player) {
    const h = L / 2, w = W / 2, D = 0.08, R = h;
    const ax = h - 0.3, rF = 0.25, rR = 0.19;
    wheels(g, ang, [ax, -ax + 0.04], w);
    // Sides: the body rises from the ground; the lower part is the darker side face.
    at(g, ang, 0, () => { carPath(g, L, W, rF, rR); g.fillStyle = shade(color, -0.62); g.fill(); });
    at(g, ang, D * 0.45, () => { carPath(g, L, W, rF, rR); g.fillStyle = shade(color, -0.4); g.fill(); });
    // Body top.
    at(g, ang, D, () => {
      carPath(g, L, W, rF, rR);
      paintPanel(g, ang, L, W, color, player ? 0.26 : 0.2);
      g.save();
      carPath(g, L, W, rF, rR);
      g.clip();
      // wheel arches
      g.fillStyle = withAlpha(shade(color, -0.65), 0.5);
      for (const x of [ax, -ax + 0.04]) for (const sy of [-1, 1]) { g.beginPath(); g.ellipse(x, sy * w, 0.17, 0.075, 0, 0, TAU); g.fill(); }
      // hood and trunk seams
      g.strokeStyle = withAlpha(shade(color, -0.55), 0.55);
      g.lineWidth = 0.014;
      g.beginPath();
      g.moveTo(h - 0.38, -w + 0.1); g.quadraticCurveTo(h - 0.3, 0, h - 0.38, w - 0.1);
      g.moveTo(-h + 0.22, -w + 0.12); g.quadraticCurveTo(-h + 0.17, 0, -h + 0.22, w - 0.12);
      g.moveTo(h - 0.06, -w * 0.45); g.quadraticCurveTo(h - 0.24, 0, h - 0.06, w * 0.45);
      g.stroke();
      if (player) { // racing stripes
        g.fillStyle = 'rgba(255, 255, 255, .92)';
        g.fillRect(-h, -0.11, L, 0.065);
        g.fillRect(-h, 0.045, L, 0.065);
      }
      g.restore();
      carPath(g, L, W, rF, rR);
      bevel(g, ang, R, 0.07);
      // lights on the body's front and back edges
      lamp(g, h - 0.1, -w + 0.06, 0.08, 0.16, '#fff4c8', 0.22);
      lamp(g, h - 0.1, w - 0.22, 0.08, 0.16, '#fff4c8', 0.22);
      lamp(g, -h + 0.02, -w + 0.06, 0.06, 0.17, '#ff3b30', 0.18);
      lamp(g, -h + 0.02, w - 0.23, 0.06, 0.17, '#ff3b30', 0.18);
      g.strokeStyle = withAlpha(shade(color, -0.75), 0.6);
      g.lineWidth = 0.02;
      carPath(g, L, W, rF, rR);
      g.stroke();
    });
    // Cabin: side walls, the glass house, then the raised roof.
    const c0 = -h + 0.2, c1 = h - 0.36, cw = W - 0.14;
    const cabin = (inset, r) => { g.beginPath(); rrect(g, c0 + inset * 0.6, -cw / 2 + inset, c1 - c0 - inset * 1.2, cw - inset * 2, r); };
    at(g, ang, D, () => { cabin(0, 0.14); g.fillStyle = withAlpha('#0a0e18', 0.45); g.fill(); });
    at(g, ang, D + 0.04, () => {
      cabin(0.02, 0.13);
      paintGlass(g, ang, R);
      // mirrors
      for (const sy of [-1, 1]) {
        g.fillStyle = shade(color, -0.25);
        g.beginPath(); g.ellipse(c1 - 0.03, sy * (w + 0.03), 0.055, 0.04, 0, 0, TAU); g.fill();
      }
    });
    const r0 = c0 + 0.13, r1 = c1 - 0.27;
    at(g, ang, D + 0.09, () => {
      g.beginPath(); rrect(g, r0, -cw / 2 + 0.07, r1 - r0, cw - 0.14, 0.09);
      paintPanel(g, ang, r1 - r0, cw - 0.14, shade(color, 0.06), 0.3);
      if (player) {
        g.fillStyle = 'rgba(255, 255, 255, .92)';
        g.fillRect(r0, -0.11, r1 - r0, 0.065);
        g.fillRect(r0, 0.045, r1 - r0, 0.065);
      }
      g.beginPath(); rrect(g, r0, -cw / 2 + 0.07, r1 - r0, cw - 0.14, 0.09);
      bevel(g, ang, R * 0.6, 0.05);
      g.strokeStyle = withAlpha(shade(color, -0.7), 0.5);
      g.lineWidth = 0.016;
      g.stroke();
    });
    if (player) { // a rear spoiler on struts
      at(g, ang, D + 0.02, () => {
        g.fillStyle = 'rgba(0, 0, 0, .4)';
        g.fillRect(-h + 0.12, -0.2, 0.04, 0.05); g.fillRect(-h + 0.12, 0.15, 0.04, 0.05);
      });
      at(g, ang, D + 0.07, () => {
        g.beginPath(); rrect(g, -h + 0.04, -w + 0.04, 0.1, W - 0.08, 0.04);
        paintPanel(g, ang, 0.1, W - 0.08, '#2a2d35', 0.3);
      });
    }
  }

  function paintBus(g, ang, L, W, color) {
    const h = L / 2, w = W / 2, D = 0.18, R = h;
    wheels(g, ang, [h - 0.42, -h + 0.5, -h + 0.78], w);
    at(g, ang, 0, () => { g.beginPath(); rrect(g, -h, -w, L, W, 0.14); g.fillStyle = shade(color, -0.62); g.fill(); });
    // A band of side windows, then the roof edge above it.
    at(g, ang, D * 0.35, () => { g.beginPath(); rrect(g, -h, -w, L, W, 0.14); g.fillStyle = '#152230'; g.fill(); });
    at(g, ang, D * 0.62, () => {
      g.beginPath(); rrect(g, -h, -w, L, W, 0.14);
      paintGlass(g, ang, R * 0.4);
    });
    at(g, ang, D * 0.8, () => { g.beginPath(); rrect(g, -h, -w, L, W, 0.14); g.fillStyle = shade(color, -0.35); g.fill(); });
    at(g, ang, D, () => {
      g.beginPath(); rrect(g, -h, -w, L, W, 0.14);
      paintPanel(g, ang, L, W, color, 0.24);
      g.beginPath(); rrect(g, -h, -w, L, W, 0.14);
      bevel(g, ang, R, 0.08);
      // windscreen wrapping over the front edge
      g.beginPath(); rrect(g, h - 0.2, -w + 0.05, 0.17, W - 0.1, 0.06);
      paintGlass(g, ang, 0.5);
      // roof panel with ribs
      g.beginPath(); rrect(g, -h + 0.14, -w + 0.13, L - 0.42, W - 0.26, 0.06);
      g.fillStyle = withAlpha(shade(color, 0.35), 0.55);
      g.fill();
      g.strokeStyle = withAlpha(shade(color, -0.4), 0.4);
      g.lineWidth = 0.014;
      g.beginPath();
      for (let x = -h + 0.3; x < h - 0.3; x += 0.25) { g.moveTo(x, -w + 0.14); g.lineTo(x, w - 0.14); }
      g.stroke();
      // rear engine grille and lights
      g.fillStyle = 'rgba(10, 10, 20, .45)';
      for (let k = 0; k < 4; k++) g.fillRect(-h + 0.03, -0.2 + k * 0.11, 0.07, 0.06);
      lamp(g, -h + 0.01, -w + 0.04, 0.05, 0.13, '#ff3b30', 0.18);
      lamp(g, -h + 0.01, w - 0.17, 0.05, 0.13, '#ff3b30', 0.18);
      lamp(g, h - 0.06, -w + 0.05, 0.05, 0.12, '#fff4c8', 0.2);
      lamp(g, h - 0.06, w - 0.17, 0.05, 0.12, '#fff4c8', 0.2);
      g.strokeStyle = withAlpha(shade(color, -0.75), 0.6);
      g.lineWidth = 0.02;
      g.beginPath(); rrect(g, -h, -w, L, W, 0.14); g.stroke();
      // mirrors on stalks
      g.strokeStyle = '#1c2129';
      g.lineWidth = 0.03;
      g.beginPath(); g.moveTo(h - 0.06, -w); g.lineTo(h + 0.03, -w - 0.07); g.moveTo(h - 0.06, w); g.lineTo(h + 0.03, w + 0.07); g.stroke();
    });
    // AC units: small raised boxes on the roof.
    for (const ux of [-h + 0.5, 0.1]) {
      at(g, ang, D, () => { g.fillStyle = 'rgba(10, 8, 30, .3)'; g.beginPath(); rrect(g, ux + 0.03, -0.18, 0.46, 0.4, 0.05); g.fill(); });
      at(g, ang, D + 0.05, () => {
        g.beginPath(); rrect(g, ux, -0.2, 0.46, 0.4, 0.05);
        paintPanel(g, ang, 0.46, 0.4, '#d9dee5', 0.25);
        g.strokeStyle = 'rgba(80, 90, 105, .6)';
        g.lineWidth = 0.016;
        g.beginPath();
        for (let k = 1; k < 6; k++) { g.moveTo(ux + k * 0.077, -0.16); g.lineTo(ux + k * 0.077, 0.16); }
        g.stroke();
        g.beginPath(); rrect(g, ux, -0.2, 0.46, 0.4, 0.05);
        bevel(g, ang, 0.4, 0.04);
      });
    }
    at(g, ang, D + 0.02, () => {
      g.beginPath(); rrect(g, h - 0.66, -0.13, 0.24, 0.26, 0.04);
      paintGlass(g, ang, 0.3);
    });
  }

  function paintTow(g, ang, L, W, color) {
    const h = L / 2, w = W / 2, cab = 0.8, c0 = h - cab, R = h;
    wheels(g, ang, [h - 0.28, -h + 0.32, -h + 0.6], w);
    // The flatbed: a steel deck on a dark chassis.
    const bedL = L - cab + 0.06;
    at(g, ang, 0, () => { g.beginPath(); rrect(g, -h, -w + 0.02, bedL, W - 0.04, 0.08); g.fillStyle = '#1f232a'; g.fill(); });
    at(g, ang, 0.07, () => {
      g.beginPath(); rrect(g, -h, -w + 0.03, bedL, W - 0.06, 0.08);
      paintPanel(g, ang, bedL, W - 0.06, '#7a838f', 0.25);
      g.save();
      g.beginPath(); rrect(g, -h, -w + 0.03, bedL, W - 0.06, 0.08); g.clip();
      g.strokeStyle = 'rgba(20, 24, 32, .45)';
      g.lineWidth = 0.02;
      g.beginPath();
      for (let x = -h + 0.18; x < c0; x += 0.13) { g.moveTo(x, -w + 0.12); g.lineTo(x, w - 0.12); }
      g.stroke();
      g.strokeStyle = 'rgba(255, 255, 255, .16)';
      g.beginPath();
      for (let x = -h + 0.195; x < c0; x += 0.13) { g.moveTo(x, -w + 0.12); g.lineTo(x, w - 0.12); }
      g.stroke();
      // hazard stripes on the rear edge
      g.beginPath(); g.rect(-h, -w, 0.17, W); g.clip();
      g.fillStyle = '#ffcc1f';
      g.fillRect(-h, -w, 0.17, W);
      g.fillStyle = '#1b1d22';
      for (let y = -w - 0.2; y < w; y += 0.16) {
        g.beginPath(); g.moveTo(-h, y); g.lineTo(-h + 0.17, y + 0.17); g.lineTo(-h + 0.17, y + 0.25); g.lineTo(-h, y + 0.08); g.closePath(); g.fill();
      }
      g.restore();
      g.beginPath(); rrect(g, -h, -w + 0.03, bedL, W - 0.06, 0.08);
      bevel(g, ang, R, 0.05);
      lamp(g, -h + 0.01, -w + 0.05, 0.05, 0.12, '#ff3b30', 0.2);
      lamp(g, -h + 0.01, w - 0.17, 0.05, 0.12, '#ff3b30', 0.2);
    });
    // Winch drum across the deck, behind the cab.
    const wx = c0 - 0.14;
    {
      const a = toScreen(ang, wx, -w + 0.12, 0.13), b = toScreen(ang, wx, w - 0.12, 0.13);
      bar(g, a.x, a.y, b.x, b.y, 0.13, '#8d96a3');
      g.strokeStyle = 'rgba(30, 30, 40, .55)';
      g.lineWidth = 0.012;
      g.beginPath();
      for (let k = -2; k <= 2; k++) {
        const p = toScreen(ang, wx - 0.05, k * 0.06, 0.13), q = toScreen(ang, wx + 0.05, k * 0.06 + 0.03, 0.13);
        g.moveTo(p.x, p.y); g.lineTo(q.x, q.y);
      }
      g.stroke();
    }
    // The boom from the winch to the rear, its shadow on the deck, the cable and the hook.
    const bx0 = wx + 0.02, bx1 = -h + 0.3, bz = 0.2;
    {
      const s0 = toScreen(ang, bx0, 0, 0.07), s1 = toScreen(ang, bx1, 0, 0.07);
      g.strokeStyle = 'rgba(10, 8, 30, .35)';
      g.lineWidth = 0.13;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(s0.x + 0.05, s0.y + 0.06); g.lineTo(s1.x + 0.05, s1.y + 0.06); g.stroke();
      const a = toScreen(ang, bx0, 0, bz), b = toScreen(ang, bx1, 0, bz);
      bar(g, a.x, a.y, b.x, b.y, 0.12, '#ffae1f');
      g.strokeStyle = 'rgba(120, 70, 0, .7)';
      g.lineWidth = 0.014;
      g.beginPath();
      for (let k = 0.12; k < 0.9; k += 0.12) {
        const p = toScreen(ang, bx0 + (bx1 - bx0) * k, -0.045, bz), q = toScreen(ang, bx0 + (bx1 - bx0) * (k + 0.06), 0.045, bz);
        g.moveTo(p.x, p.y); g.lineTo(q.x, q.y);
      }
      g.stroke();
      const tip = toScreen(ang, bx1 - 0.04, 0, bz), hk = toScreen(ang, bx1 - 0.1, 0, 0.09);
      g.strokeStyle = '#2a2d33';
      g.lineWidth = 0.018;
      g.beginPath(); g.moveTo(tip.x, tip.y); g.lineTo(hk.x, hk.y - 0.04); g.stroke();
      Fx.sphere(g, tip.x, tip.y, 0.04, '#c9ced6', { gloss: false });
      g.strokeStyle = '#d9dee6';
      g.lineWidth = 0.028;
      g.beginPath(); g.arc(hk.x, hk.y + 0.02, 0.055, -0.6, Math.PI + 0.9); g.stroke();
      g.strokeStyle = 'rgba(255, 255, 255, .7)';
      g.lineWidth = 0.01;
      g.beginPath(); g.arc(hk.x - 0.005, hk.y + 0.015, 0.055, Math.PI, Math.PI + 0.8); g.stroke();
    }
    // The cab.
    const D = 0.12;
    const cabPath = () => { g.beginPath(); if (g.roundRect) g.roundRect(c0, -w, cab, W, [0.08, 0.2, 0.2, 0.08]); else g.rect(c0, -w, cab, W); };
    at(g, ang, 0, () => { cabPath(); g.fillStyle = shade(color, -0.62); g.fill(); });
    at(g, ang, D * 0.5, () => { cabPath(); g.fillStyle = shade(color, -0.38); g.fill(); });
    at(g, ang, D, () => {
      cabPath();
      paintPanel(g, ang, cab, W, color, 0.24);
      cabPath();
      bevel(g, ang, R, 0.07);
      lamp(g, h - 0.08, -w + 0.06, 0.06, 0.14, '#fff4c8', 0.22);
      lamp(g, h - 0.08, w - 0.2, 0.06, 0.14, '#fff4c8', 0.22);
      g.strokeStyle = withAlpha(shade(color, -0.75), 0.6);
      g.lineWidth = 0.02;
      cabPath(); g.stroke();
    });
    at(g, ang, D + 0.04, () => {
      g.beginPath(); rrect(g, c0 + 0.08, -w + 0.07, cab - 0.24, W - 0.14, 0.1);
      paintGlass(g, ang, 0.6);
    });
    at(g, ang, D + 0.08, () => {
      g.beginPath(); rrect(g, c0 + 0.06, -w + 0.11, cab - 0.4, W - 0.22, 0.08);
      paintPanel(g, ang, cab - 0.4, W - 0.22, shade(color, 0.08), 0.3);
      g.beginPath(); rrect(g, c0 + 0.06, -w + 0.11, cab - 0.4, W - 0.22, 0.08);
      bevel(g, ang, 0.5, 0.045);
      // the beacon bar's housing (the lamps blink on top of the sprite)
      g.fillStyle = '#23272e';
      g.beginPath(); rrect(g, c0 + 0.13, -w + 0.1, 0.12, W - 0.2, 0.05); g.fill();
    });
  }

  // ── Sprite caches ──
  const SPR_M = 0.34; // margin around a footprint in the sprites (cells): shadows, mirrors and height fit inside
  const sprites = new Map();
  let spritePx = 0, spriteLevel = -1;
  function cached(key, fw, fh, paint) {
    const px = pxPerCell();
    // one level's worth of sprites at a time, so memory stays flat
    if (px !== spritePx || level !== spriteLevel) { sprites.clear(); spritePx = px; spriteLevel = level; }
    let sp = sprites.get(key);
    if (sp) return sp;
    const cv = newCanvas((fw + SPR_M * 2) * px, (fh + SPR_M * 2) * px);
    const g = cv.getContext('2d');
    g.scale(px, px);
    g.translate(SPR_M + fw / 2, SPR_M + fh / 2);
    paint(g);
    sp = { cv, w: cv.width / px, h: cv.height / px };
    sprites.set(key, sp);
    return sp;
  }
  function bodySprite(v) {
    const { w: fw, h: fh } = footprint(v);
    const ang = angleOf(v), color = colorOf(v), player = v.id === C.PLAYER;
    return cached(`b|${v.kind}|${color}|${v.len}|${ang.toFixed(2)}|${player ? 1 : 0}`, fw, fh, (g) => {
      const L = v.len - (v.kind === 'bus' ? 0.12 : 0.16);
      if (v.kind === 'bus') paintBus(g, ang, L, 0.84, color);
      else if (v.kind === 'tow') paintTow(g, ang, L, 0.8, color);
      else paintCar(g, ang, L, 0.78, color, player);
    });
  }
  // A soft contact shadow of a footprint: stacked translucent rounded rects make a blur that works everywhere.
  function shadowSprite(v) {
    const { w: fw, h: fh } = footprint(v);
    return cached(`s|${fw}x${fh}`, fw, fh, (g) => {
      g.fillStyle = 'rgba(6, 6, 20, .12)';
      for (let i = 0; i < 8; i++) {
        const grow = -0.06 + (i / 7) * 0.2;
        g.beginPath(); rrect(g, -fw / 2 + 0.08 - grow, -fh / 2 + 0.08 - grow, fw - 0.16 + grow * 2, fh - 0.16 + grow * 2, 0.22 + Math.max(0, grow)); g.fill();
      }
    });
  }
  function blit(sp, cx, cy, sx = 1, sy = 1) {
    ctx.save();
    ctx.translate(cx, cy);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    ctx.drawImage(sp.cv, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    ctx.restore();
  }
  const centreAt = (v, p) => {
    const { x, y } = cornerAt(v, p), f = footprint(v);
    return { x: x + f.w / 2, y: y + f.h / 2 };
  };

  const LIFT = 0.13; // cells a dragged vehicle rises
  function drawShadow(v, p) {
    const c = centreAt(v, p), l = lift[v.id] || 0, hk = heightOf(v) / 0.15;
    const sp = shadowSprite(v);
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * 0.55 * (1 - l * 0.7);
    blit(sp, c.x + 0.02, c.y + 0.03, 0.97, 0.97);
    ctx.globalAlpha = a0 * (0.5 + l * 0.08);
    blit(sp, c.x + (0.06 + l * 0.14) * hk, c.y + (0.09 + l * 0.2) * hk, 1 + l * 0.1, 1 + l * 0.1);
    ctx.globalAlpha = a0;
  }

  function drawVehicle(v, p, alpha = 1) {
    const c = centreAt(v, p), l = lift[v.id] || 0;
    const q = squashOf(v.id);
    const k = 1 + l * 0.05;
    const sx = (v.dir === 'h' ? 1 - q : 1 + q * 0.5) * k, sy = (v.dir === 'h' ? 1 + q * 0.5 : 1 - q) * k;
    const sp = bodySprite(v);
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * alpha;
    // motion trail: faint copies behind a fast vehicle
    const sv = vel[v.id] || 0;
    if (Math.abs(sv) > 3 && alpha === 1) {
      const dx = v.dir === 'h' ? 1 : 0, dy = 1 - dx;
      for (let i = 1; i <= 3; i++) {
        const o = -sv * 0.012 * i;
        ctx.globalAlpha = a0 * 0.16 / i;
        blit(sp, c.x + dx * o, c.y + dy * o - l * LIFT, sx, sy);
      }
      ctx.globalAlpha = a0 * alpha;
    }
    blit(sp, c.x, c.y - l * LIFT, sx, sy);
    if (v.kind === 'tow' && alpha === 1) { // blinking amber beacons on the cab roof
      const ang = angleOf(v), L = v.len - 0.16, h = L / 2, w = 0.4;
      const on = Math.sin(time * 9) > 0;
      for (const [y, lit] of [[-w + 0.16, on], [w - 0.16, !on]]) {
        const pt = toScreen(ang, h - 0.8 + 0.19, y, 0.21 + l * LIFT);
        Fx.sphere(ctx, c.x + pt.x, c.y + pt.y, 0.05, lit ? '#ffd23a' : '#8a5a00', { shine: lit ? 0.8 : 0.3 });
        if (lit) Fx.glow(ctx, c.x + pt.x, c.y + pt.y, 0.32, '#ffb21f', 0.55);
      }
    }
    ctx.globalAlpha = a0;
  }

  // Outline around a vehicle at a position (selection, hint and its ghost).
  function outline(v, p, color, width, dash, offset = 0) {
    const { x, y } = cornerAt(v, p);
    const { w, h } = footprint(v);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.lineDashOffset = offset;
    ctx.beginPath(); rrect(ctx, x + 0.03, y + 0.03, w - 0.06, h - 0.06, 0.26); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  function arrowHead(x, y, ang, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.6, -size * 0.75); ctx.lineTo(-size * 0.6, size * 0.75); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // A chunky chevron ">" pointing along ang.
  function chevron(x, y, ang, size, color, width) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-size * 0.5, -size); ctx.lineTo(size * 0.5, 0); ctx.lineTo(-size * 0.5, size); ctx.stroke();
    ctx.restore();
  }

  // ───────────── Exit and the free road ─────────────
  let freeKey = -1, freeVal = false;
  function pathFree() {
    if (freeKey !== version) {
      freeKey = version;
      const r = s.status === 'playing' ? C.moveRange(s, C.PLAYER) : null;
      freeVal = !!(r && r.exit);
    }
    return freeVal;
  }

  function drawExit(free) {
    const L = s.level, ey = L.exitRow;
    const xa = L.w + 0.25, xb = L.w + PAD + ROAD - 0.2;
    ctx.save();
    ctx.beginPath(); ctx.rect(L.w + 0.15, ey + 0.1, xb - L.w, 0.8); ctx.clip();
    for (let i = 0; i < 3; i++) {
      const f = (time * (free ? 1.1 : 0.55) + i / 3) % 1;
      const a = Math.sin(f * Math.PI);
      chevron(xa + f * (xb - xa), ey + 0.5, 0, 0.17, free ? `rgba(255, 220, 90, ${0.95 * a})` : `rgba(240, 244, 250, ${0.55 * a})`, 0.085);
    }
    ctx.restore();
    if (free) Fx.glow(ctx, L.w + 0.6, ey + 0.5, 0.9, '#ffcf4a', 0.18 + 0.08 * Math.sin(time * 5));
  }

  // The player's car glows and a trail of chevrons runs to the exit while its road is free.
  function drawFreeLane(free) {
    if (!free || phase !== 'play') return;
    const v = vehicle(C.PLAYER);
    if (!v) return;
    const c = centreAt(v, rp[v.id]);
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    Fx.glow(ctx, c.x, c.y, v.len * 1.05, '#ff4a2a', 0.35 + 0.2 * pulse);
    outline(v, rp[v.id], `rgba(255, 120, 90, ${0.25 + 0.25 * pulse})`, 0.12);
    const x0 = rp[v.id] + v.len + 0.15, x1 = s.level.w;
    for (let x = x0; x < x1; x += 0.5) {
      const f = ((x - x0) * 0.6 - time * 1.4) % 1;
      const a = 0.25 + 0.4 * (f < 0 ? f + 1 : f);
      chevron(x + 0.1, v.y + 0.5, 0, 0.1, `rgba(255, 210, 90, ${a})`, 0.05);
    }
  }

  // ───────────── Barriers ─────────────
  function cellTaken(x, y) {
    return s.vehicles.some((v) => V.covers(v, x, y));
  }

  // A striped boom on a housing: it swings up (towards the viewer, so it foreshortens and rises screen-up).
  function drawGates(dt) {
    const open = C.gateOpen(s);
    for (const gt of gates) {
      const target = open || cellTaken(gt.x, gt.y) ? 1 : 0;
      gt.a = V.approach(gt.a, target, dt, 6);
      const th = Fx.ease.inOutCubic(gt.a) * Math.PI / 2;
      const px = gt.x + 0.18, py = gt.y + 0.56, z = 0.22, len = 0.76;
      const cs = Math.cos(th), sn = Math.sin(th);
      const ex = px + len * cs, ez = py - z - len * sn * 0.62;
      // shadow on the ground
      ctx.strokeStyle = 'rgba(6, 6, 20, .32)';
      ctx.lineWidth = 0.13;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px + 0.06, py + 0.08); ctx.lineTo(px + 0.06 + len * cs + len * sn * 0.3, py + 0.08 + len * sn * 0.16); ctx.stroke();
      // counterweight behind the pivot
      bar(ctx, px, py - z, px - 0.13 * cs, py - z + 0.13 * sn * 0.62, 0.11, '#4a505a');
      // housing
      Fx.shadow(ctx, px + 0.08, py + 0.1, 0.22, 0.13, 0.6);
      prism(ctx, px - 0.13, py - 0.1, 0.26, 0.2, 0.14, '#f0c419', { r: 0.04, edge: 0.012 });
      ctx.fillStyle = '#1d2026';
      ctx.fillRect(px - 0.13, py + 0.0, 0.26, 0.04);
      const lampOn = target ? '#45e07a' : '#ff4136';
      Fx.sphere(ctx, px + 0.06, py - 0.17, 0.045, lampOn, { shine: 0.7 });
      Fx.glow(ctx, px + 0.06, py - 0.17, 0.24, lampOn, 0.5 + 0.2 * Math.sin(time * 6));
      // the boom: dark underside, white body, red stripes, a specular line and a reflector at the tip
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#4a1210';
      ctx.lineWidth = 0.145;
      ctx.beginPath(); ctx.moveTo(px, py - z + 0.012); ctx.lineTo(ex, ez + 0.012); ctx.stroke();
      ctx.strokeStyle = '#f3f5f8';
      ctx.lineWidth = 0.12;
      ctx.beginPath(); ctx.moveTo(px, py - z); ctx.lineTo(ex, ez); ctx.stroke();
      const seg = Math.hypot(ex - px, ez - (py - z)) / 5;
      ctx.strokeStyle = '#e8322b';
      ctx.lineCap = 'butt';
      ctx.setLineDash([seg, seg]);
      ctx.lineDashOffset = -seg;
      ctx.beginPath(); ctx.moveTo(px, py - z); ctx.lineTo(ex, ez); ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = 'rgba(255, 255, 255, .55)';
      ctx.lineWidth = 0.022;
      ctx.beginPath(); ctx.moveTo(px + 0.02, py - z - 0.032); ctx.lineTo(ex, ez - 0.032); ctx.stroke();
      Fx.sphere(ctx, px, py - z, 0.07, '#9aa3ae', { gloss: false });
      Fx.sphere(ctx, ex, ez, 0.035, '#ff5a3c', { shine: 0.8 });
    }
  }

  // ───────────── Particles ─────────────
  const DUST = ['#c9bea8', '#b8ad98', '#d6ccb8'];
  function dustAt(x, y, nx, ny, n = 4) {
    for (let i = 0; i < n; i++) {
      const side = (i % 2 ? 1 : -1) * (0.2 + Math.random() * 0.25);
      particles.emit({
        x: x + ny * side, y: y + nx * side,
        vx: nx * (0.4 + Math.random() * 0.6) + ny * side * 1.2, vy: ny * (0.4 + Math.random() * 0.6) + nx * side * 1.2 - 0.15,
        life: 0.45 + Math.random() * 0.3, size: 0.05 + Math.random() * 0.04, grow: 0.28, drag: 0.9, shape: 'smoke',
        color: DUST[i % DUST.length], alpha: 0.75,
      });
    }
  }
  // Exhaust behind a vehicle that just moved.
  function exhaust(v) {
    const ang = angleOf(v), c = centreAt(v, rp[v.id]);
    const bx = c.x - Math.cos(ang) * v.len * 0.5, by = c.y - Math.sin(ang) * v.len * 0.5;
    for (let i = 0; i < 3; i++) {
      particles.emit({
        x: bx, y: by + (Math.random() - 0.5) * 0.2, vx: -Math.cos(ang) * (0.3 + Math.random() * 0.4), vy: -Math.sin(ang) * (0.3 + Math.random() * 0.4) - 0.1,
        life: 0.5 + Math.random() * 0.3, size: 0.04, grow: 0.22, drag: 0.85, shape: 'smoke', color: '#aab1bd', alpha: 0.6,
      });
    }
  }
  function celebrate(x, y) {
    particles.burst(x, y, 46, { shape: 'confetti', colors: ['#ffd34d', '#5aa7ff', '#ff6a5c', '#6fdc8c', '#ffffff', '#c58cff'], speed: 4.2, size: 0.13, life: 1.6, gravity: 4.5, drag: 0.7, spin: 9 });
    particles.burst(x, y, 12, { shape: 'star', color: '#ffd34d', speed: 3, size: 0.13, life: 1, drag: 0.8, spin: 5 });
    particles.burst(x, y, 16, { shape: 'spark', color: '#fff1a8', speed: 6, size: 0.035, life: 0.4, drag: 0.9 });
    flash = 1;
    shakeFx.add(0.35);
  }

  // ───────────── Frame ─────────────
  // Where a vehicle should be drawn this frame (cells along its axis).
  function targetPos(v) {
    if (drag && drag.started && drag.id === v.id) return basePos(v) + drag.shift + drag.over;
    if (sel === v.id && pending) return basePos(v) + pending;
    return basePos(v);
  }

  function draw(dt) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!s) return;
    const key = `${level}:${fit.w}x${fit.h}`;
    if (key !== staticKey) { staticLayer = buildStatic(); staticKey = key; }
    const sh = shakeFx.offset();
    ctx.drawImage(staticLayer, sh.x * pxPerCell(), sh.y * pxPerCell());
    worldTransform(ctx);
    ctx.translate(sh.x, sh.y);

    const dragging = (v) => drag && drag.started && drag.id === v.id;
    for (const v of s.vehicles) {
      const id = v.id;
      if (s.status !== 'won' || id !== C.PLAYER) {
        const prev = rp[id];
        const tgt = targetPos(v);
        rp[id] = dragging(v) ? tgt : V.approach(prev, tgt, dt, 15);
        const sp = dt > 0 && Number.isFinite(prev) ? (rp[id] - prev) / dt : 0;
        // landing: a car that was sliding settles with a little squash and a puff of dust at its nose
        if (!dragging(v) && rp[id] === tgt && Math.abs(vel[id] || 0) > 1.2 && phase === 'play') {
          const dir = Math.sign(vel[id]);
          const c = centreAt(v, rp[id]);
          const nx = v.dir === 'h' ? dir : 0, ny = v.dir === 'h' ? 0 : dir;
          dustAt(c.x + nx * v.len / 2, c.y + ny * v.len / 2, nx, ny, 4);
          if (!bumps[id]) bumps[id] = { dir, t: 0, amp: 0.45, settle: true };
        }
        vel[id] = dragging(v) ? 0 : sp;
      }
      lift[id] = Fx.damp(lift[id] || 0, dragging(v) ? 1 : 0, 0.9999, dt);
    }
    const free = phase === 'play' && pathFree();
    drawExit(free);
    // Draw back to front: lower vehicles overlap the ones above them; the dragged one is on top.
    const order = s.vehicles.slice().sort((a, b) => (lift[a.id] || 0) - (lift[b.id] || 0) || centreAt(a, rp[a.id]).y + (a.dir === 'v' ? a.len / 2 : 0.5) - (centreAt(b, rp[b.id]).y + (b.dir === 'v' ? b.len / 2 : 0.5)));
    const drawn = (v) => rp[v.id] + bumpOffset(v.id);
    for (const v of order) drawShadow(v, drawn(v));
    drawFreeLane(free);

    // The hint's ghost: the vehicle where it should go, under the real ones.
    let hv = null;
    if (hint && phase === 'play') hv = vehicle(hint.id);
    if (hv) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      const to = basePos(hv) + hint.delta;
      drawVehicle(hv, to, 0.32 + pulse * 0.1);
      outline(hv, to, `rgba(255, 211, 77, ${0.55 + pulse * 0.35})`, 0.05, [0.14, 0.09], -time * 0.4);
    }
    // Speed lines behind the red car driving off.
    if ((phase === 'exit' || phase === 'end') && exitV > 3) {
      const v = vehicle(C.PLAYER);
      if (v) {
        const x = rp[v.id];
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const y = v.y + 0.18 + hash2(i, 1, 5) * 0.64;
          const ln = Math.min(2.5, exitV * (0.06 + hash2(i, 2, 5) * 0.08));
          const gx = ctx.createLinearGradient(x - ln, 0, x + 0.2, 0);
          gx.addColorStop(0, 'rgba(255, 255, 255, 0)');
          gx.addColorStop(1, 'rgba(255, 255, 255, .5)');
          ctx.strokeStyle = gx;
          ctx.lineWidth = 0.025 + hash2(i, 3, 5) * 0.03;
          ctx.beginPath(); ctx.moveTo(x - ln, y); ctx.lineTo(x + 0.2, y); ctx.stroke();
        }
        vel[v.id] = exitV;
      }
    }
    for (const v of order) drawVehicle(v, drawn(v));
    drawGates(dt);

    // The hint: the vehicle glows gold, chevrons run from it towards where it goes.
    if (hv) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      const to = basePos(hv) + hint.delta;
      const lp = rp[hv.id];
      outline(hv, lp, `rgba(255, 211, 77, ${0.18 + pulse * 0.15})`, 0.2);
      outline(hv, lp, `rgba(255, 226, 120, ${0.75 + pulse * 0.25})`, 0.06);
      const sg = Math.sign(hint.delta);
      const dx = hv.dir === 'h' ? 1 : 0, dy = 1 - dx;
      const from = centreAt(hv, rp[hv.id]), dest = centreAt(hv, to);
      const n = Math.max(2, Math.round(Math.abs(hint.delta) * 2) + 1);
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n;
        const cx = from.x + (dest.x - from.x) * f, cy = from.y + (dest.y - from.y) * f;
        const a = 0.35 + 0.65 * Math.max(0, Math.sin((f - time * 1.2) * Math.PI * 2));
        chevron(cx, cy, Math.atan2(dy * sg, dx * sg), 0.11, `rgba(20, 14, 0, ${0.35 * a})`, 0.1);
        chevron(cx, cy, Math.atan2(dy * sg, dx * sg), 0.11, `rgba(255, 216, 90, ${a})`, 0.06);
      }
    }
    // Keyboard selection: marching dashes and the ways it can go.
    if (sel && phase === 'play') {
      const v = vehicle(sel);
      if (v && v.x < s.level.w) {
        outline(v, rp[v.id], 'rgba(255, 255, 255, .95)', 0.045, [0.1, 0.07], -time * 0.3);
        const r = C.moveRange(s, sel);
        if (r) {
          const { x, y } = cornerAt(v, rp[v.id]);
          const back = pending > r.min, fwd = pending < r.max || r.exit;
          const ends = v.dir === 'h'
            ? [[back, x - 0.12, y + 0.5, Math.PI], [fwd, x + v.len + 0.12, y + 0.5, 0]]
            : [[back, x + 0.5, y - 0.12, -Math.PI / 2], [fwd, x + 0.5, y + v.len + 0.12, Math.PI / 2]];
          for (const [ok, ax, ay, ang] of ends) if (ok) arrowHead(ax, ay, ang, 0.12, 'rgba(255, 255, 255, .9)');
        }
      }
    }
    particles.draw(ctx);
    if (flash > 0) {
      const L = s.level;
      Fx.glow(ctx, L.w + 0.5, L.exitRow + 0.5, 2.4, '#fff3c0', flash * 0.8);
      flash = Math.max(0, flash - dt * 1.8);
    }

    if (phase === 'lose' || (phase === 'end' && outcome && !outcome.won)) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const a = Math.min(1, phaseT * 2) * 0.4;
      const vg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.25, canvas.width / 2, canvas.height / 2, canvas.height * 0.75);
      vg.addColorStop(0, 'rgba(120, 0, 0, 0)');
      vg.addColorStop(1, `rgba(120, 0, 0, ${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function update(dt) {
    phaseT += dt;
    shakeFx.update(dt);
    particles.update(dt);
    for (const id of Object.keys(bumps)) if ((bumps[id].t += dt) > 0.6) delete bumps[id];
    if (phase === 'play' && pending && !drag && (pendingT += dt) > 0.7) commitPending();
    if (phase === 'exit') {
      // The red car speeds away down the road, then the result shows.
      exitV += dt * 10;
      rp[C.PLAYER] = Math.max(rp[C.PLAYER] + exitV * dt, rp[C.PLAYER]);
      const v = vehicle(C.PLAYER);
      if (Math.random() < 0.6) {
        particles.emit({
          x: rp[C.PLAYER] - 0.02, y: v.y + 0.5 + (Math.random() - 0.5) * 0.5, vx: -0.6 - Math.random() * 0.6, vy: (Math.random() - 0.5) * 0.4,
          life: 0.5, size: 0.06, grow: 0.3, drag: 0.85, shape: 'smoke', color: '#b3b9c4', alpha: 0.6,
        });
      }
      if (!exitBurst && rp[C.PLAYER] + v.len > s.level.w + 0.4) {
        exitBurst = true;
        celebrate(s.level.w + 0.6, v.y + 0.5);
      }
      if (exitGone < 0 && rp[C.PLAYER] > s.level.w + PAD + ROAD + 0.3) exitGone = phaseT;
      // the confetti gets a moment on the lot before the result shows
      if ((exitGone >= 0 && phaseT - exitGone > 0.55) || phaseT > 2.8) finish();
    } else if (phase === 'lose' && phaseT > 0.9) {
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

  // ───────────── Levels, moves and results ─────────────
  // Puts level i on screen: a fresh game, or the given state (a restored one).
  function loadLevel(i, state) {
    level = clamp(i, 0, LEVELS.length - 1);
    s = state || C.newGame(LEVELS[level]);
    rp = {};
    for (const v of s.vehicles) rp[v.id] = basePos(v);
    bumps = {};
    lift = {};
    vel = {};
    particles.clear();
    flash = 0;
    exitGone = -1;
    exitBurst = false;
    drag = null;
    sel = null;
    pending = 0;
    hint = null;
    hintBusy = false;
    route = null;
    version++;
    outcome = null;
    exitV = 0;
    shakeFx.trauma = 0;
    gates = [];
    const L = s.level;
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) if (L.cells[y * L.w + x] === C.GATE) gates.push({ x, y, a: C.gateOpen(s) ? 1 : 0 });
    resize();
  }

  // The saved level in progress (playing, or lost with the undo still to offer), or null.
  const restored = () => C.resume(progress, LEVELS);

  function saveCurrent() {
    progress.current = phase !== 'menu' ? C.currentOf(level, s, hintsUsed) : null;
    C.saveProgress(storage, progress);
  }

  function enterPlay() {
    setPhase('play');
    show(null);
    $('hud').hidden = false;
    $('controls').hidden = false;
    renderHUD();
    canvas.focus({ preventScroll: true });
  }

  // Starts level i from scratch with all hints, or resumes it when it's the saved level in progress.
  function startLevel(i) {
    Sound.unlock();
    const r = restored();
    if (r && r.level === i) {
      loadLevel(i, r.state);
      hintsUsed = r.hints;
    } else {
      loadLevel(i);
      hintsUsed = 0;
    }
    enterPlay();
    if (s.status === 'lost') {
      // it was left out of moves: back to the result screen, where the last move can still be taken back
      outcome = { won: false, moves: s.moves, stars: 0 };
      finish();
      return;
    }
    const tip = s.moves === 0 ? tipFor(level) : null;
    showTip(tip);
    saveCurrent();
  }

  function showTip(text) {
    $('tip').textContent = text ? t(text) : '';
    $('tip').hidden = !text;
  }

  function bump(id, dir) {
    bumps[id] = { dir: dir < 0 ? -1 : 1, t: 0, amp: 1 };
    sfx('bump');
    shakeFx.add(0.22);
    const v = vehicle(id);
    if (v) {
      const sg = dir > 0 ? 1 : -1;
      const c = centreAt(v, basePos(v));
      const nx = v.dir === 'h' ? sg : 0, ny = v.dir === 'h' ? 0 : sg;
      dustAt(c.x + nx * v.len / 2, c.y + ny * v.len / 2, nx, ny, 5);
    }
  }

  // Makes a move; the drawn car eases from wherever it is to the new cell.
  function doMove(id, delta) {
    if (phase !== 'play' || !delta) return false;
    if (!C.move(s, id, delta)) { bump(id, delta); return false; }
    const v = vehicle(id);
    version++;
    hint = null;
    showTip(null);
    sfx('slide', { dist: Math.abs(delta), kind: v.kind });
    if (gates.length) sfx('barrier', { open: C.gateOpen(s) });
    exhaust(v);
    if (s.status === 'won') win();
    else if (s.status === 'lost') lose();
    else saveCurrent();
    renderHUD();
    return true;
  }

  function commitPending() {
    if (!pending || !sel) { pending = 0; return; }
    const d = pending;
    pending = 0;
    doMove(sel, d);
  }

  function win() {
    outcome = { won: true, moves: s.moves, stars: C.stars(s.moves, s.optimal) };
    C.recordStars(progress, level, outcome.stars);
    drag = null;
    sel = null;
    exitV = 1.2;
    exitGone = -1;
    exitBurst = false;
    setPhase('exit');
    saveCurrent();
    sfx('win');
  }

  function lose() {
    outcome = { won: false, moves: s.moves, stars: 0 };
    drag = null;
    sel = null;
    shakeFx.add(0.7);
    setPhase('lose');
    saveCurrent();
    sfx('lose');
  }

  function finish() {
    setPhase('end');
    showResult();
    renderHUD();
  }

  function undo() {
    const lost = phase === 'end' && outcome && !outcome.won;
    if (!(phase === 'play' || lost)) return;
    // a keyboard shift not made yet is simply dropped (making it first could even end the level)
    if (pending) { pending = 0; renderHUD(); return; }
    if (!s.history.length) return;
    C.undo(s);
    version++;
    hint = null;
    sfx('undo');
    if (lost) {
      outcome = null;
      enterPlay();
    }
    saveCurrent();
    renderHUD();
  }

  function restart() {
    if (!s || !(phase === 'play' || (phase === 'end' && !outcome.won))) return;
    pending = 0;
    C.restart(s);
    version++;
    hint = null;
    outcome = null;
    if (phase !== 'play') enterPlay();
    sfx('undo');
    saveCurrent();
    renderHUD();
  }

  // Hints follow the last solution while the player keeps to it; otherwise the BFS runs again, a slice per
  // timer tick (a 7×7 search takes a second or more), and is dropped if the board changes meanwhile.
  function useHint() {
    if (phase !== 'play' || hintBusy || hint || hintsUsed >= C.MAX_HINTS) return;
    commitPending();
    if (phase !== 'play') return;
    const now = C.pathOf(s);
    const known = route && C.followRoute(route.base, route.sol, now);
    if (known) { giveHint(known); return; }
    hintBusy = true;
    renderHUD();
    const it = C.solverFor(s);
    const at = version;
    const slice = () => {
      if (phase !== 'play' || version !== at) { hintBusy = false; renderHUD(); return; }
      const t0 = performance.now();
      let r = it.next();
      while (!r.done && performance.now() - t0 < 12) r = it.next();
      if (!r.done) { setTimeout(slice, 0); return; }
      hintBusy = false;
      route = r.value ? { base: now, sol: r.value } : null;
      giveHint(r.value);
    };
    setTimeout(slice, 0);
  }

  function giveHint(sol) {
    const h = C.hintOf(s, sol);
    if (h) {
      hint = h;
      hintsUsed++;
      sfx('hint');
      showTip(null);
      saveCurrent();
    } else {
      // no way out, or not within the moves left: the hint is not spent
      showTip('Отсюда не выехать: отмени ход или начни заново');
    }
    renderHUD();
  }

  function starsHTML(n) {
    let h = '';
    for (let i = 0; i < 3; i++) h += `<span class="${i < n ? 'on' : 'off'}">★</span>`;
    return h;
  }

  function showResult() {
    const o = outcome;
    $('res-title').textContent = o.won ? t('Выехали!') : t('Ходы кончились');
    $('res-title').classList.toggle('lost', !o.won);
    $('res-stars').innerHTML = starsHTML(o.stars);
    $('res-stars').setAttribute('aria-label', t('Звёзды: {n} из 3', { n: o.stars }));
    $('res-moves').textContent = o.won
      ? t('Ходы: {n}, оптимум: {opt}', { n: o.moves, opt: s.optimal })
      : t('Ходы: {n} из {limit}', { n: o.moves, limit: s.limit });
    let note;
    if (!o.won) note = t('Отмени ход или начни заново');
    else if (o.stars === 3) note = t('Идеально: быстрее не выехать!');
    else note = t('Для ★★★ нужно уложиться в {opt}', { opt: s.optimal });
    $('res-note').textContent = note;
    const hasNext = level + 1 < LEVELS.length;
    $('btn-next').hidden = !(o.won && hasNext);
    $('btn-res-undo').hidden = o.won;
    $('res-final').hidden = !(o.won && !hasNext);
    show('result');
    (o.won && hasNext ? $('btn-next') : o.won ? $('btn-again') : $('btn-res-undo')).focus({ preventScroll: true });
  }

  // ───────────── Screens ─────────────
  const SCREENS = ['menu', 'levels', 'result'];
  function show(name) {
    for (const id of SCREENS) $(id).hidden = id !== name;
    stage.classList.toggle('dim', !!name);
  }

  function nextLevel() {
    return Math.min(C.firstUnfinished(progress, LEVELS.length), LEVELS.length - 1);
  }

  function showMenu() {
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
    if (phase === 'play') { commitPending(); saveCurrent(); }
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
      b.className = 'lvl-btn' + (open ? '' : ' locked') + (n ? ' done' : '') + (PARSED[i].w > 6 ? ' big7' : '');
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

  function renderHUD() {
    if (!s) return;
    $('hud-level').textContent = t('Уровень {n}', { n: level + 1 });
    $('hud-moves').textContent = t('Ходы: {n}/{limit}', { n: s.moves, limit: s.limit });
    $('hud-moves-wrap').classList.toggle('low', s.status === 'playing' && s.limit - s.moves <= 2);
    const gate = $('hud-gate');
    gate.hidden = !gates.length;
    if (gates.length) {
      const open = C.gateOpen(s);
      gate.classList.toggle('open', open);
      $('hud-gate-text').textContent = open ? t('Шлагбаум открыт') : t('Шлагбаум закрыт');
    }
    const best = $('hud-best');
    best.hidden = s.status !== 'won';
    best.textContent = t('Оптимум: {n}', { n: s.optimal });
    const lost = phase === 'end' && outcome && !outcome.won;
    $('btn-undo').disabled = !s.history.length || !(phase === 'play' || lost);
    $('btn-restart').disabled = !(phase === 'play' || lost) || (!s.history.length && phase === 'play');
    const left = C.MAX_HINTS - hintsUsed;
    $('hint-left').textContent = String(left);
    $('btn-hint').disabled = phase !== 'play' || left <= 0 || !!hint;
    $('btn-hint').classList.toggle('busy', hintBusy);
    $('btn-hint').setAttribute('aria-label', t('Подсказка, осталось: {n}', { n: left }));
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
  function pointerCell(e) {
    const r = canvas.getBoundingClientRect();
    return V.cellAt(fit, e.clientX - r.left, e.clientY - r.top);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (phase !== 'play' || drag) return;
    Sound.unlock();
    commitPending();
    if (phase !== 'play') return;
    const c = pointerCell(e);
    const id = c.inside ? V.vehicleAt(s, c.x, c.y) : null;
    sel = null;
    if (!id) return;
    drag = { id, pointer: e.pointerId, x0: c.fx, y0: c.fy, shift: 0, over: 0, started: false, bumped: false };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (phase !== 'play') { canvas.style.cursor = ''; return; }
    const c = pointerCell(e);
    if (drag && e.pointerId === drag.pointer) {
      const d = { dx: c.fx - drag.x0, dy: c.fy - drag.y0 };
      const v = vehicle(drag.id);
      const want = V.along(v, d);
      if (!drag.started && Math.abs(want) < V.DRAG_START) return;
      drag.started = true;
      drag.shift = V.dragTarget(s, drag.id, d);
      const push = Math.abs(want - drag.shift); // how far past the stop the pointer pushes
      drag.over = Math.sign(want - drag.shift) * V.give(push);
      if (push > 0.3 && !drag.bumped) {
        drag.bumped = true;
        sfx('bump');
      } else if (push < 0.1) drag.bumped = false;
      return;
    }
    if (!drag) canvas.style.cursor = c.inside && V.vehicleAt(s, c.x, c.y) ? 'grab' : '';
  });
  const release = (e, cancel) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    drag = null;
    canvas.style.cursor = '';
    if (!d.started) return;
    const delta = cancel ? 0 : V.dropDelta(s, d.id, d.shift);
    if (delta) doMove(d.id, delta);
  };
  canvas.addEventListener('pointerup', (e) => release(e, false));
  canvas.addEventListener('pointercancel', (e) => release(e, true));

  // Arrows along the picked vehicle's axis slide it (made into a move on Enter, on picking another vehicle or
  // after a short pause); arrows across pick the nearest vehicle that way.
  function keyArrow(dx, dy) {
    const v = vehicle(sel);
    if (!v || v.x >= s.level.w) { sel = V.cycle(s, null); pending = 0; return; }
    const step = v.dir === 'h' ? dx : dy;
    if (step) {
      const r = C.moveRange(s, sel);
      if (!r) return;
      const exitAt = s.level.w - v.x;
      let next = pending + step;
      if (r.exit && step > 0 && next > r.max) next = exitAt;
      else if (pending > r.max && step < 0) next = r.max;
      if (!C.allowed(r, next)) { bump(sel, step); return; } // an exit is always exactly exitAt here
      pending = next;
      pendingT = 0;
      if (pending > r.max) commitPending(); // straight out through the exit
    } else {
      commitPending();
      if (phase !== 'play') return;
      const n = V.neighbor(s, sel, dx, dy);
      if (n) sel = n;
    }
  }

  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onBoard = phase === 'play' && (document.activeElement === canvas || document.activeElement === document.body);
    if (phase === 'play' && ARROWS[e.code]) {
      Sound.unlock();
      keyArrow(...ARROWS[e.code]);
      e.preventDefault();
    } else if (onBoard && e.code === 'Tab') {
      commitPending();
      if (phase === 'play') sel = V.cycle(s, sel, e.shiftKey ? -1 : 1);
      e.preventDefault();
    } else if (onBoard && (e.code === 'Enter' || e.code === 'Space')) {
      commitPending();
      e.preventDefault();
    } else if (e.code === 'Escape') {
      if (phase === 'play' && (pending || sel)) { pending = 0; sel = null; } else if (!$('levels').hidden) showMenu();
    } else if ((e.code === 'KeyZ' || e.code === 'Backspace') && phase !== 'menu') {
      undo();
      e.preventDefault();
    } else if (e.code === 'KeyR' && (phase === 'play' || phase === 'end')) {
      if (phase === 'end' && outcome && outcome.won) startLevel(level);
      else restart();
      e.preventDefault();
    } else if (e.code === 'KeyH' && phase === 'play') {
      useHint();
      e.preventDefault();
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
  // The move controls hand the keyboard back to the lot, so Tab and the arrows keep working after a click.
  const backToBoard = (fn) => () => { fn(); if (phase === 'play') canvas.focus({ preventScroll: true }); };
  $('btn-undo').addEventListener('click', backToBoard(undo));
  $('btn-restart').addEventListener('click', backToBoard(restart));
  $('btn-hint').addEventListener('click', backToBoard(useHint));
  $('btn-next').addEventListener('click', () => startLevel(level + 1));
  $('btn-again').addEventListener('click', () => (outcome && !outcome.won ? restart() : startLevel(level)));
  $('btn-res-undo').addEventListener('click', undo);
  $('btn-res-levels').addEventListener('click', showLevels);
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  window.addEventListener('pagehide', () => { if (phase === 'play') { commitPending(); saveCurrent(); } });

  // ───────────── Boot ─────────────
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = t(meta.content);
  const actions = $('top-actions');
  actions.append(window.I18n.toggle('chip'));
  if (window.GameNav) actions.append(window.GameNav.home('chip'));
  showMenu();
  requestAnimationFrame(frame);
})();
