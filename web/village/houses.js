// Родник — the buildings in 2.5D: ruins, scaffolding and the restored buildings of the village, the hamlet
// and the lake.
// Seen from above at a tilt with the light at the top left: front walls face the viewer, the right side wall
// is in shade, roofs show a shaded front slope and a lit strip of the back slope, and every building casts
// its shadow to the lower right. Browser only: art.js creates it with its canvas helpers and calls draw().
(() => {
  'use strict';
  const VV = window.VillageView;
  const { hash2, clamp } = VV;
  const TAU = Math.PI * 2;

  // env: { ctx, K, WOOD, STONE, GRASS, WINDOW, rect, line, circle, ellipse, poly, blob, emit, spark,
  //        state() → the rules state, time() → the animation clock, sun() → view.sunAt of this frame,
  //        light(x, y, r, color, a) → a light that glows after dark, snow() → 0..1 snow cover }
  function create(env) {
    const { K, WOOD, STONE, GRASS, WINDOW, rect, line, circle, ellipse, poly, blob, emit, spark } = env;
    let ctx = env.ctx; // art.js points it at a sprite while baking one (setCtx)
    let S = null, time = 0; // refreshed on every draw()
    const shadow = (x, y, rx, ry, a = 0.32) => K.shadow(ctx, x, y, rx, ry, a);
    const SIDE = 7; // how far the shaded right side wall shows, px

    // The shadow a block of height h casts on the ground to the lower right of its base line.
    function castBlock(left, right, base, h) {
      const dx = h * 0.42, dy = h * 0.14;
      ctx.fillStyle = `rgba(30, 44, 18, ${(0.16 * env.sun().shadow).toFixed(3)})`;
      for (const grow of [3, 0]) {
        ctx.beginPath();
        ctx.moveTo(left + 4, base + 1);
        ctx.lineTo(right + SIDE, base - SIDE * 0.5);
        ctx.lineTo(right + SIDE + dx + grow, base - h * 0.5 + dy);
        ctx.lineTo(right + dx + grow, base + dy + grow);
        ctx.lineTo(left + dx * 0.5, base + dy + grow);
        ctx.closePath();
        ctx.fill();
      }
    }

    // ── Painted materials ──
    // env.tex(name) gives a seamless grey texture baked by tools/village-sprites (tile, thatch, metal, plaster,
    // planks, brick, stone) or null until the sprites have loaded. It is laid over a face that is already
    // filled and lit, with 'overlay': the face keeps its colour and light and gains the material's relief.
    // The pattern is anchored to the world, so neighbouring faces line up.
    const patterns = new WeakMap(); // canvas context → { material name → CanvasPattern }
    function material(mat, trace, alpha = 0.85) {
      const t = env.tex && env.tex(mat);
      if (!t) return false;
      let byCtx = patterns.get(ctx);
      if (!byCtx) patterns.set(ctx, (byCtx = {}));
      let pat = byCtx[mat];
      if (!pat || pat.img !== t.img) {
        pat = { img: t.img, p: ctx.createPattern(t.img, 'repeat') };
        pat.p.setTransform(new DOMMatrix().scale(t.w / t.img.width));
        byCtx[mat] = pat;
      }
      ctx.save();
      trace();
      ctx.clip();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha *= alpha;
      ctx.fillStyle = pat.p;
      ctx.fill();
      ctx.restore();
      return true;
    }
    // The material a wall of this colour is most likely made of: whitewash, brick, stone or boards.
    function matFor(color) {
      const [r, g, b] = K.parse(color);
      const lum = 0.3 * r + 0.59 * g + 0.11 * b, sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (lum > 200) return 'plaster';
      if (r > 150 && r - b > 60 && g < 130) return 'brick';
      if (sat < 30) return 'stone';
      return 'planks';
    }
    const ROOF_MAT = { tile: 'tile', thatch: 'thatch', metal: 'metal' };

    // A wall face with a soft vertical light gradient (bright under the eave light, darker at the plinth).
    function wall(x, y, w, h, color, mat = matFor(color)) {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, K.shade(color, 0.06));
      g.addColorStop(1, K.shade(color, -0.12));
      rect(x, y, w, h, g);
      return material(mat, () => { ctx.beginPath(); ctx.rect(x, y, w, h); });
    }

    // The right side wall: a parallelogram receding up and to the right, in shade.
    function sideWall(right, top, base, color, mat = matFor(color)) {
      const pts = [right, top, right + SIDE, top - SIDE * 0.5, right + SIDE, base - SIDE * 0.5, right, base];
      poly(pts, K.shade(color, -0.3));
      material(mat, () => tracePoly(pts), 0.7);
    }
    function tracePoly(pts) {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
    }

    function windowBox(x, y, w, h, trim) {
      rect(x - 2.5, y + 1, 2.5, h - 2, trim, 1);
      rect(x + w, y + 1, 2.5, h - 2, trim, 1);
      rect(x - 1, y - 1, w + 2, h + 2, '#f6efe0', 2);
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#fff6d6');
      g.addColorStop(1, WINDOW);
      rect(x, y, w, h, g, 1.5);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'; // a glint of sky on the glass
      ctx.beginPath(); ctx.moveTo(x + 1, y + h - 2); ctx.lineTo(x + w * 0.45, y + 1); ctx.lineTo(x + w * 0.62, y + 1); ctx.lineTo(x + 2.5, y + h - 2); ctx.fill();
      line(x + w / 2, y, x + w / 2, y + h, trim, 1.2);
      line(x, y + h / 2, x + w, y + h / 2, trim, 1.2);
      env.light(x + w / 2, y + h / 2, 26, '#ffcf73', 0.85); // lamplight after dark
      // A flower box under the window.
      K.block(ctx, x - 1.5, y + h + 1, w + 3, 3, 1, WOOD.mid, { top: 0.3 });
      for (let k = 0; k < 3; k++) K.sphere(ctx, x + 1 + k * (w - 2) / 2, y + h, 1.7, k % 2 ? '#f4d35e' : '#e0607e', { gloss: false });
    }

    function door(x, y, w, h, color = '#7b4f2e') {
      rect(x - 1, y - 1, w + 2, h + 1, 'rgba(30, 18, 8, 0.35)', [w / 2 + 1, w / 2 + 1, 0, 0]); // the recess
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, K.shade(color, 0.15));
      g.addColorStop(1, K.shade(color, -0.2));
      rect(x, y, w, h, g, [w / 2, w / 2, 0, 0]);
      for (let k = 1; k < 3; k++) line(x + (k * w) / 3, y + 3, x + (k * w) / 3, y + h, 'rgba(40, 24, 10, 0.35)', 0.8);
      K.sphere(ctx, x + w - 2.5, y + h * 0.6, 1.1, '#e9b44c', { gloss: false });
      K.block(ctx, x - 1.5, y + h - 1, w + 3, 2.5, 1, STONE.mid, { top: 0.3 });
    }

    // A gabled roof seen from above at a tilt: a lit strip of the back slope above the ridge, the front slope
    // in soft shade down to the eave, and the gable end on the right side in deeper shade.
    function roof(left, right, top, eave, col, dark, style = 'tile') {
      const back = 7, mat = ROOF_MAT[style] || 'tile';
      const backPts = [left + 4, top, right - 4, top, right - 6, top - back, left + 6, top - back];
      const gable = [right - 4, top, right + SIDE - 2, top - back * 0.5, right + SIDE, eave - SIDE * 0.5, right, eave];
      poly(backPts, K.shade(col, 0.22));
      material(mat, () => tracePoly(backPts), 0.7);
      poly(gable, K.shade(col, -0.38));
      material(mat, () => tracePoly(gable), 0.6);
      const front = [left, eave, right, eave, right - 4, top, left + 4, top];
      const g = ctx.createLinearGradient(0, top, 0, eave);
      g.addColorStop(0, K.shade(col, 0.06));
      g.addColorStop(1, K.shade(col, -0.16));
      poly(front, g);
      const painted = material(mat, () => tracePoly(front), 0.95);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(left, eave); ctx.lineTo(right, eave); ctx.lineTo(right - 4, top); ctx.lineTo(left + 4, top);
      ctx.closePath();
      ctx.clip();
      if (painted) { /* the painted material carries the tiles, straw or seams */ } else if (style === 'thatch') {
        ctx.lineWidth = 1;
        for (let yy = top + 3, row = 0; yy < eave; yy += 4, row++) {
          for (let xx = left + (row % 2) * 2; xx < right; xx += 4) line(xx, yy - 3, xx + 0.6, yy + 1, row % 3 ? dark : 'rgba(255, 236, 170, 0.5)', 1);
        }
      } else if (style === 'metal') {
        for (let xx = left + 4; xx < right; xx += 6) {
          line(xx, top, xx, eave, dark, 1);
          line(xx + 1.2, top, xx + 1.2, eave, 'rgba(255, 255, 255, 0.16)', 0.8);
        }
      } else {
        for (let yy = top + 5, row = 0; yy < eave; yy += 5, row++) {
          line(left, yy, right, yy, dark, 1);
          line(left, yy - 1.2, right, yy - 1.2, 'rgba(255, 240, 220, 0.14)', 0.8);
          for (let xx = left + (row % 2) * 4; xx < right; xx += 8) line(xx, yy - 5, xx, yy, dark, 0.7);
        }
      }
      ctx.restore();
      const snow = env.snow();
      if (snow > 0) { // winter: snow on the back strip and the upper front slope
        ctx.globalAlpha = snow;
        poly([left + 4, top + 1, right - 4, top + 1, right - 6, top - back, left + 6, top - back], '#f6f9fc');
        const sg = ctx.createLinearGradient(0, top, 0, top + (eave - top) * 0.6);
        sg.addColorStop(0, '#eef3f8');
        sg.addColorStop(1, 'rgba(238, 243, 248, 0)');
        poly([left + 1, top + (eave - top) * 0.6, right - 1, top + (eave - top) * 0.6, right - 4, top, left + 4, top], sg);
        ctx.globalAlpha = 1;
      }
      K.block(ctx, left + 3, top - 2, right - left - 6, 3.5, 1.5, K.shade(col, -0.25), { top: 0.45 }); // ridge
      rect(left - 1, eave - 2, right - left + 2, 3, dark, 1.5);
      rect(left, eave + 1, right - left, 3, 'rgba(20, 12, 4, 0.22)'); // the eave shades the wall top
    }

    function chimney(x, top, color, smoke) {
      K.prism(ctx, x, top - 6, 8, 12, 3, color);
      rect(x + 8, top - 6, 2.5, 12, K.shade(color, -0.35));
      rect(x - 1, top - 10, 11, 3, '#5b3324', 1);
      emit(x + 4, top - 11, smoke || 1);
    }

    // A cottage: white-washed walls with coloured trim (as in the Moldovan villages), a roof and a chimney.
    // Where a cottage's walls and roof go (house() draws them; animated parts find their places from it).
    function houseFrame(b, o) {
      const left = b.X + 5, right = b.X + b.Wp - 5 - SIDE, base = b.Y + b.Hp - 4;
      const wallH = o.wallH || 24;
      return { left, right, base, wallH, wallTop: base - wallH, top: b.Y - (o.roofUp || 10) };
    }
    function house(b, o) {
      const { left, right, base, wallH, wallTop, top } = houseFrame(b, o);
      castBlock(left, right, base, base - top + 8);
      const mat = o.planks ? 'planks' : o.mat || matFor(o.wall);
      sideWall(right, wallTop, base, o.wall, mat);
      const painted = wall(left, wallTop, right - left, wallH, o.wall, mat);
      if (o.planks && !painted) for (let xx = left + 4; xx < right; xx += 5) line(xx, wallTop, xx, base, 'rgba(60, 25, 15, 0.25)', 1);
      K.block(ctx, left, base - 5, right - left, 5, 1, o.plinth || STONE.mid, { top: 0.25 });
      const mid = (left + right) / 2;
      const dx = o.doorAt !== undefined ? o.doorAt : mid - 5;
      if (o.door !== false) door(dx, base - 17, 10, 16, o.doorColor);
      const wy = wallTop + 7;
      for (const wx of o.windows || [left + 7, right - 17]) windowBox(wx, wy, 10, 9, o.trim);
      roof(left - 5, right + 5, top, wallTop + 3, o.roof, o.roofDark, o.roofStyle);
      if (o.chimney) chimney(o.chimney === 'left' ? left + 8 : right - 15, top, o.chimneyColor || '#9c4a35', o.smoke);
      return { left, right, base, wallTop, top };
    }

    // ── The spring (the well on the square) ──
    // A round wall of dressed stone blocks seen from above and in front: two courses of blocks on the front
    // face, a ring of capstones on top, the inner wall showing at the back and the water a little below the rim.
    // `missing` lists capstones (0..13) that have fallen; `murky` is the old, choked water of the ruin.
    const RING = 14;
    function wellRing(cx, cy, o) {
      const R = 22, ry = 13.5, H = 10, inR = R - 6.5, inRy = ry - 4.2;
      const sun = env.sun();
      const stoneCol = (k, j) => K.shade(STONE.mid, (hash2(k, j, 950) - 0.5) * 0.22);
      // Ground: an oblique shadow to the lower right and a soft contact shadow all round.
      ctx.save();
      ctx.translate(cx + 12, cy + H + 6);
      ctx.rotate(0.3);
      K.shadow(ctx, 0, 0, R + 10, ry + 2, 0.3 * sun.shadow);
      ctx.restore();
      K.shadow(ctx, cx + 2, cy + H + 1, R + 5, ry + 4, 0.42 * sun.shadow);
      // Front face: two courses of blocks, offset by half a block, lit from the left.
      const arc = (a, yy, r = R, rr = ry) => [cx + Math.cos(a) * r, yy + Math.sin(a) * rr];
      for (let j = 0; j < 2; j++) {
        const y0 = cy + j * (H / 2), n = 7, off = j ? Math.PI / n / 2 : 0;
        for (let k = -1; k < n; k++) {
          const a0 = Math.max(0, off + (k * Math.PI) / n), a1 = Math.min(Math.PI, off + ((k + 1) * Math.PI) / n);
          if (a1 <= a0) continue;
          const pts = [];
          for (let q = 0; q <= 4; q++) pts.push(arc(lerpA(a0, a1, q / 4), y0));
          for (let q = 4; q >= 0; q--) pts.push(arc(lerpA(a0, a1, q / 4), y0 + H / 2));
          const lightness = Math.cos((a0 + a1) / 2) * 0.2 - 0.05; // left (cos > 0 is right): flip below
          ctx.fillStyle = K.shade(stoneCol(k + 7, j), -lightness - 0.08);
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (const p of pts) ctx.lineTo(p[0], p[1]);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(40, 36, 30, 0.45)';
          ctx.lineWidth = 0.9;
          ctx.stroke();
          // A lit upper edge on each block.
          ctx.strokeStyle = 'rgba(255, 250, 235, 0.25)';
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1] + 0.8);
          for (let q = 1; q <= 4; q++) ctx.lineTo(pts[q][0], pts[q][1] + 0.8);
          ctx.stroke();
        }
      }
      // Capstones: a dark joint ring, then each stone as a ring segment, lit towards the top left.
      ctx.fillStyle = K.shade(STONE.dark, -0.3);
      ctx.beginPath();
      ctx.ellipse(cx, cy, R + 0.6, ry + 0.6, 0, 0, TAU);
      ctx.ellipse(cx, cy, inR - 0.6, inRy - 0.6, 0, 0, TAU, true);
      ctx.fill('evenodd');
      for (let k = 0; k < RING; k++) {
        const a0 = (k / RING) * TAU + 0.04, a1 = ((k + 1) / RING) * TAU - 0.04, mid = (a0 + a1) / 2;
        const gone = o.missing.includes(k);
        const dy = gone ? H / 2 : 0;
        const lit = Math.cos(mid - 3.9) * 0.16; // towards the top-left light (angle ≈ 225°) is brighter
        ctx.fillStyle = gone ? K.shade(STONE.dark, -0.15) : K.shade(K.shade(STONE.light, (hash2(k, 3, 951) - 0.5) * 0.18), lit);
        ctx.beginPath();
        for (let q = 0; q <= 4; q++) { const p = arc(lerpA(a0, a1, q / 4), cy + dy); q ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
        for (let q = 4; q >= 0; q--) { const p = arc(lerpA(a0, a1, q / 4), cy + dy, inR, inRy); ctx.lineTo(p[0], p[1]); }
        ctx.closePath();
        ctx.fill();
        if (!gone && hash2(k, 4, 952) < (o.murky ? 0.4 : 0.12)) { // moss on the capstone
          const p = arc(mid, cy, (R + inR) / 2, (ry + inRy) / 2);
          ctx.fillStyle = 'rgba(96, 150, 60, 0.8)';
          ctx.beginPath(); ctx.ellipse(p[0], p[1], 2.6, 1.4, mid + Math.PI / 2, 0, TAU); ctx.fill();
        }
      }
      // The shaft: the inner wall shows at the back; the water lies a little lower, clipped by the rim.
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, inR, inRy, 0, 0, TAU);
      ctx.clip();
      const inner = ctx.createLinearGradient(0, cy - inRy, 0, cy + inRy);
      inner.addColorStop(0, '#3e4040');
      inner.addColorStop(1, '#6b6a63');
      ctx.fillStyle = inner;
      ctx.fillRect(cx - inR, cy - inRy, inR * 2, inRy * 2);
      for (let k = 0; k < 6; k++) { // block joints on the inner wall
        const x = cx - inR + 3 + k * (inR * 2 - 6) / 5;
        ctx.strokeStyle = 'rgba(20, 20, 20, 0.35)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(x, cy - inRy); ctx.lineTo(x, cy - inRy + 5); ctx.stroke();
      }
      const wy = cy + o.depth, wrx = inR - 0.5, wry = inRy - 0.4;
      const water = ctx.createRadialGradient(cx - 5, wy - 4, 1, cx, wy, wrx * 1.1);
      if (o.murky) {
        water.addColorStop(0, '#79b9a6'); water.addColorStop(0.6, '#3f8277'); water.addColorStop(1, '#25514b');
      } else {
        water.addColorStop(0, '#a8f0ff'); water.addColorStop(0.35, '#3fc0ec'); water.addColorStop(0.8, '#1688cf'); water.addColorStop(1, '#0d5a95');
      }
      ctx.fillStyle = water;
      ctx.beginPath(); ctx.ellipse(cx, wy, wrx, wry, 0, 0, TAU); ctx.fill();
      // The rim's own shadow on the water along the top.
      const rimShade = ctx.createLinearGradient(0, wy - wry, 0, wy - wry + 6);
      rimShade.addColorStop(0, 'rgba(10, 30, 50, 0.45)');
      rimShade.addColorStop(1, 'rgba(10, 30, 50, 0)');
      ctx.fillStyle = rimShade;
      ctx.fillRect(cx - wrx, wy - wry, wrx * 2, 6);
      // Ripples spreading from the middle, and a slow drifting glint.
      for (let k = 0; k < 3; k++) {
        const ph = (time * (o.murky ? 0.18 : 0.4) + k / 3) % 1;
        ctx.strokeStyle = `rgba(230, 252, 255, ${((o.murky ? 0.25 : 0.55) * (1 - ph)).toFixed(3)})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.ellipse(cx + 1, wy + 1, 2 + ph * wrx, (2 + ph * wrx) * (wry / wrx), 0, 0, TAU); ctx.stroke();
      }
      const gx = cx - 6 + Math.sin(time * 0.6) * 3;
      ctx.fillStyle = o.murky ? 'rgba(220, 255, 240, 0.25)' : 'rgba(255, 255, 255, 0.6)';
      ctx.beginPath(); ctx.ellipse(gx, wy - 2.5, 4.5, 1.3, -0.15, 0, TAU); ctx.fill();
      if (o.murky) for (let k = 0; k < 3; k++) { // leaves floating on the old water
        ctx.fillStyle = ['#8a9a3a', '#b5893a', '#6f8a35'][k];
        ctx.beginPath(); ctx.ellipse(cx - 6 + k * 6 + Math.sin(time * 0.3 + k) * 1.2, wy + (k - 1) * 2.2, 2, 1.1, k, 0, TAU); ctx.fill();
      } else for (let k = 0; k < 4; k++) { // sparkles
        const tw = Math.sin(time * 2.3 + k * 1.9);
        if (tw < 0.6) continue;
        const sx = cx - wrx * 0.6 + hash2(k, Math.floor(time * 0.5 + k), 953) * wrx * 1.2, sy = wy - wry * 0.5 + hash2(k, Math.floor(time * 0.5 + k), 954) * wry;
        const z = (tw - 0.6) * 5;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath(); ctx.moveTo(sx - z, sy); ctx.lineTo(sx, sy - z * 0.35); ctx.lineTo(sx + z, sy); ctx.lineTo(sx, sy + z * 0.35); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(sx, sy - z * 0.7); ctx.lineTo(sx + z * 0.25, sy); ctx.lineTo(sx, sy + z * 0.7); ctx.lineTo(sx - z * 0.25, sy); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // Grass growing at the foot of the wall.
      for (let k = 0; k < (o.murky ? 7 : 4); k++) {
        const a = 0.25 + (k / 6) * 2.6, p = arc(a, cy + H, R + 0.5, ry + 0.5);
        ctx.strokeStyle = k % 2 ? GRASS.tuft : GRASS.tuftLight; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p[0] - 2, p[1] + 1); ctx.lineTo(p[0] - 3, p[1] - 4);
        ctx.moveTo(p[0], p[1] + 1); ctx.lineTo(p[0], p[1] - 5.5);
        ctx.moveTo(p[0] + 2, p[1] + 1); ctx.lineTo(p[0] + 3.5, p[1] - 4);
        ctx.stroke();
      }
      return { R, ry, H, wy };
    }
    const lerpA = (a, b, t) => a + (b - a) * t;

    // The ruined spring: capstones fallen into the grass, a broken post, choked water. While it is being
    // restored (stage 1) the fallen stones go back as the payment arrives.
    const FALLEN = [2, 5, 6, 9, 11, 12];
    function wellRuin(b, part) {
      const cx = b.cx, cy = b.base - 24;
      const left = Math.round(FALLEN.length * (1 - part));
      const missing = FALLEN.slice(0, left);
      wellRing(cx, cy, { missing, murky: true, depth: 5 });
      // The stones that fell, lying around the well.
      for (let k = 0; k < left; k++) {
        const a = 0.4 + k * 0.95, x = cx + Math.cos(a) * 31, y = cy + 12 + Math.sin(a) * 15;
        K.shadow(ctx, x + 2, y + 3, 6, 2.6, 0.35);
        K.prism(ctx, x - 4.5, y - 3, 9, 4, 3, K.shade(STONE.mid, (hash2(k, 1, 955) - 0.5) * 0.2), { r: 1.2 });
      }
      // A broken post of the old windlass.
      K.cylinder(ctx, cx - 24, cy - 14, 2.4, 16, WOOD.dark, { ry: 1, capColor: WOOD.pale });
      ctx.save();
      ctx.translate(cx + 18, cy + 20);
      ctx.rotate(0.25);
      K.shadow(ctx, 2, 3, 14, 2.4, 0.3);
      K.block(ctx, -14, -2, 28, 4, 1.5, WOOD.dark);
      ctx.restore();
    }

    // Any restored building without art of its own: a plain cottage.
    const PLAIN = { wall: '#f3ecdc', trim: '#7a6a4f', roof: '#a8563c', roofDark: 'rgba(90, 30, 15, 0.45)' };
    const HOUSE4 = { wall: '#f6eedb', trim: '#c99a2e', roof: '#c9893a', roofDark: 'rgba(110, 60, 20, 0.5)', chimney: 'right', roofStyle: 'thatch' };
    const BOATHOUSE = { wall: '#9a6a3e', trim: '#5b3a2a', roof: '#6b4a3a', roofDark: 'rgba(40, 20, 10, 0.5)', planks: true, door: false, windows: null, wallH: 26 };
    const FORGE = {
      wall: '#9a958a', trim: '#5b5b63', roof: '#4d4f58', roofDark: 'rgba(15, 15, 20, 0.5)',
      door: false, windows: null, chimney: 'left', chimneyColor: STONE.dark, smoke: 1.3,
    };
    const ART = {
      well(b) {
        const cx = b.cx, cy = b.base - 24;
        const sun = env.sun();
        // A restrained glow over the clear water by day; after dark it lights the square.
        K.glow(ctx, cx, cy + 4, 30, '#9ff0ff', 0.12 * (1 - sun.shade));
        env.light(cx, cy + 2, 46, '#8fe2ff', 0.55);
        const { R, wy } = wellRing(cx, cy, { missing: [], murky: false, depth: 4 });
        // The windlass: two lit posts on the rim, a beam with a crank, a rope and a bucket that bobs.
        for (const px of [cx - R + 2, cx + R - 2]) {
          K.shadow(ctx, px + 2, cy + 1, 4, 1.6, 0.35);
          K.cylinder(ctx, px, cy - 34, 2.6, 34, WOOD.mid, { ry: 1.1, capColor: WOOD.pale });
        }
        K.block(ctx, cx - R + 1, cy - 31, R * 2 - 2, 4, 2, WOOD.light, { top: 0.35, bottom: -0.3 });
        line(cx + R + 1, cy - 29, cx + R + 6, cy - 29, WOOD.dark, 2);
        line(cx + R + 6, cy - 29, cx + R + 6, cy - 23, WOOD.dark, 2);
        const bob = Math.sin(time * 1.4) * 1.5;
        line(cx + 1, cy - 27, cx + 1, wy - 14 + bob, '#e0cf9e', 1);
        K.shadow(ctx, cx + 3, wy - 2, 5, 1.6, 0.35);
        K.cylinder(ctx, cx + 1, wy - 14 + bob, 4.2, 7, WOOD.light, { ry: 1.8, capColor: '#5ab8e0' });
        line(cx - 3.2, wy - 11 + bob, cx + 5.2, wy - 11 + bob, '#6a6a6a', 0.9);
        // Now and then a drop falls from the bucket and rings the water.
        const ph = (time * 0.7) % 1;
        if (ph < 0.25) {
          ctx.fillStyle = 'rgba(200, 245, 255, 0.85)';
          ctx.beginPath(); ctx.ellipse(cx + 1, wy - 7 + bob + ph * 28, 0.9, 1.4, 0, 0, TAU); ctx.fill();
        }
        // Pots of flowers around the well bring the square back to life.
        for (const [px, py, c] of [[-30, 14, '#e0607e'], [30, 12, '#f4d35e']]) {
          shadow(cx + px + 2, cy + py + 3, 6, 2.2, 0.3);
          K.cylinder(ctx, cx + px, cy + py - 4, 4, 6, '#b4643c', { ry: 1.6 });
          K.sphere(ctx, cx + px - 1.5, cy + py - 5, 2.4, c, { gloss: false });
          K.sphere(ctx, cx + px + 1.8, cy + py - 6, 2.4, c, { gloss: false });
          K.sphere(ctx, cx + px, cy + py - 7.5, 2, '#5f9446', { gloss: false });
        }
      },
      garden(b) {
        // A tool shed in the corner of a fenced patch.
        const left = b.X + 6, right = b.X + b.Wp - 6 - SIDE, base = b.base - 4;
        castBlock(left, right, base, 30);
        sideWall(right, base - 18, base, '#9a6a3e');
        wall(left, base - 18, right - left, 18, '#a8784a');
        door((left + right) / 2 - 5, base - 15, 10, 14, '#6e4a2b');
        roof(left - 4, right + 4, base - 30, base - 16, '#7d8a52', 'rgba(40, 50, 20, 0.45)', 'thatch');
      },
      apiary: {
        // Painted hives on a low bench, bees drifting around them.
        body(b) {
          const left = b.X + 6, base = b.base - 6;
          K.block(ctx, left - 2, base - 3, b.Wp - 10, 5, 2, WOOD.mid, { top: 0.3 });
          const cols = ['#e2c26a', '#8ec0d8', '#e59b7a'];
          for (let k = 0; k < 3; k++) {
            const hx = left + k * 17, hy = base - 4;
            shadow(hx + 10, hy + 3, 9, 3, 0.3);
            K.prism(ctx, hx, hy - 14, 13, 14, 4, cols[k], { r: 1.5 });
            K.block(ctx, hx - 1.5, hy - 21, 16, 3.5, 1.2, WOOD.dark, { top: 0.35 });
            rect(hx + 4, hy - 3.5, 5, 1.8, '#3b2c1a', 0.8);
          }
        },
        live(b) {
          const left = b.X + 6, base = b.base - 6;
          for (let k = 0; k < 3; k++) {
            const hx = left + k * 17, hy = base - 4;
            for (let j = 0; j < 2; j++) {
              const a = time * (2.2 + j) + k * 2 + j * 3;
              circle(hx + 6.5 + Math.cos(a) * (8 + j * 3), hy - 12 + Math.sin(a * 1.3) * 5, 1.2, '#2b2014');
            }
          }
        },
      },
      market: { body(b) {
        // Three stalls under striped awnings, a notice board for the villagers' orders on the left.
        const base = b.base - 4, colours = [['#d8506a', '#f6efe0'], ['#4d7fb6', '#f6efe0'], ['#e2a43a', '#f6efe0']];
        const w = (b.Wp - 18) / 3;
        castBlock(b.X + 6, b.X + b.Wp - 10, base, 30);
        // The board.
        const bx = b.X + 2;
        K.cylinder(ctx, bx + 2, base - 30, 1.4, 30, WOOD.dark, { ry: 0.7 });
        K.cylinder(ctx, bx + 14, base - 30, 1.4, 30, WOOD.dark, { ry: 0.7 });
        K.block(ctx, bx - 1, base - 30, 18, 14, 1.5, WOOD.light, { top: 0.25 });
        const n = S.orders ? S.orders.length : 0;
        for (let k = 0; k < n; k++) {
          rect(bx + 1 + k * 5, base - 28 + (k % 2) * 2, 4.5, 6, '#fbf6ec', 0.5);
          circle(bx + 3.2 + k * 5, base - 27.5 + (k % 2) * 2, 0.7, '#a8432e');
        }
        for (let k = 0; k < 3; k++) {
          const x = b.X + 20 + k * (w + 1), top = base - 26;
          K.block(ctx, x, base - 11, w - 2, 11, 1.5, WOOD.mid, { top: 0.3 }); // the counter
          for (const px of [x + 1, x + w - 3]) K.cylinder(ctx, px, top, 1.1, 26, WOOD.dark, { ry: 0.5 });
          // A striped awning, lit along its front edge.
          const stripes = 5, sw = (w + 2) / stripes;
          for (let j = 0; j < stripes; j++) {
            poly([x - 2 + j * sw, top - 6, x - 2 + (j + 1) * sw, top - 6, x - 1 + (j + 1) * sw, top + 2, x - 1 + j * sw, top + 2], colours[k][j % 2]);
          }
          poly([x - 2, top - 6, x + w, top - 6, x + w - 2, top - 10, x, top - 10], K.shade(colours[k][0], -0.25));
          for (let j = 0; j < stripes; j++) ellipse(x - 0.5 + (j + 0.5) * sw, top + 2.2, sw / 2, 1.6, colours[k][j % 2]);
          // Goods on the counter.
          const goods = [['#d2453a', '#e8892e', '#8cc46a'], ['#e9b44c', '#f6e7a8', '#e9b44c'], ['#c99a5e', '#d7a560', '#b4643c']][k];
          for (let j = 0; j < 3; j++) K.sphere(ctx, x + 4 + j * (w - 8) / 2, base - 13, 2.6, goods[j], { gloss: false });
        }
      },
      live(b) {
        // On a fair day: a string of flags over the rows.
        if (window.Village.fairOpen(S)) {
          const base = b.base - 4, x0 = b.X + 16, x1 = b.X + b.Wp - 4, y = base - 40;
          line(x0, y, x1, y, 'rgba(60, 40, 25, 0.7)', 1);
          const flags = ['#ff7b6b', '#ffd166', '#8ee08a', '#7bc8f2', '#f7aef8'];
          for (let k = 0, x = x0 + 3; x < x1 - 4; x += 8, k++) {
            const sway = Math.sin(time * 2 + k) * 1.2;
            poly([x, y, x + 6, y, x + 3 + sway, y + 7], flags[k % flags.length]);
          }
        }
      } },
      vineyard(b) {
        // Rows of vines on trellises; grapes hang from them except in winter.
        const winter = env.snow() > 0.5;
        const rows = 3, left = b.X + 6, right = b.X + b.Wp - 6;
        for (let r = 0; r < rows; r++) {
          const y = b.Y + 14 + r * (b.Hp - 16) / (rows - 0.5);
          castBlock(left, right, y, 10);
          for (let x = left; x <= right; x += 24) K.cylinder(ctx, x, y - 16, 1.3, 16, WOOD.dark, { ry: 0.6 });
          line(left, y - 14, right, y - 14, '#c9b48a', 1);
          line(left, y - 8, right, y - 8, '#c9b48a', 1);
          if (winter) { line(left, y - 13, right, y - 13, '#f4f8fb', 1.6); continue; }
          for (let x = left + 3, k = 0; x < right - 2; x += 7, k++) {
            K.sphere(ctx, x, y - 12 + (k % 2) * 2, 4.2, k % 3 ? '#5f9446' : '#4b7c38', { gloss: false, shine: 0.25 });
            if (k % 2 === 0) {
              for (let j = 0; j < 4; j++) K.sphere(ctx, x - 1 + (j % 2) * 2, y - 7 + j * 1.6, 1.5, '#6b3a86', { shine: 0.5 });
            }
          }
        }
      },
      press(b) {
        // A stone shed with an open front: a wooden screw press inside, barrels of juice outside.
        const r = house(b, { wall: '#c8bfae', trim: '#6e4a2b', roof: '#7a5236', roofDark: 'rgba(40, 20, 10, 0.5)', door: false, windows: [b.X + 10], plinth: STONE.dark });
        const px = r.right - 30, py = r.base;
        rect(px - 2, py - 20, 26, 20, '#2f241a', [3, 3, 0, 0]);
        K.cylinder(ctx, px + 11, py - 12, 8, 10, WOOD.mid, { ry: 2.6 });
        rect(px + 10, py - 22, 2.4, 10, '#8d8c92', 1);
        line(px + 4, py - 21, px + 18, py - 21, WOOD.dark, 2.4);
        for (let k = 0; k < 3; k++) {
          const bx = r.right + 4 + (k % 2) * 8, by = r.base + 2 - Math.floor(k / 2) * 10;
          shadow(bx + 3, by, 5, 2, 0.3);
          K.cylinder(ctx, bx, by - 9, 4, 9, '#8b5e36', { ry: 1.6, capColor: '#6b3a2a' });
          line(bx - 4, by - 6, bx + 4, by - 6, '#3d3c40', 0.9);
        }
      },
      house4: {
        body(b) {
          const r = house(b, HOUSE4);
          // Two hives by the beekeeper's door.
          for (let k = 0; k < 2; k++) {
            const hx = r.left - 12 + k * 10, hy = r.base + 2;
            shadow(hx + 4, hy, 5, 2, 0.3);
            K.prism(ctx, hx, hy - 9, 8, 9, 3, k ? '#8ec0d8' : '#e2c26a', { r: 1 });
          }
        },
        live(b) {
          const r = houseFrame(b, HOUSE4);
          for (let k = 0; k < 2; k++) {
            const hx = r.left - 12 + k * 10, hy = r.base + 2;
            circle(hx + 4 + Math.cos(time * 3 + k) * 6, hy - 12 + Math.sin(time * 4 + k) * 3, 1, '#2b2014');
          }
        },
      },
      house5(b) {
        const r = house(b, { wall: '#eef3e2', trim: '#4f8a3a', roof: '#6a8f4a', roofDark: 'rgba(30, 60, 20, 0.5)', chimney: 'left' });
        // Baskets of apples by the gardener's door.
        for (let k = 0; k < 2; k++) {
          const bx = r.right + 4 + k * 9, by = r.base + 2;
          shadow(bx + 3, by, 5, 2, 0.3);
          K.cylinder(ctx, bx, by - 6, 4, 6, '#b3834f', { ry: 1.6, cap: false });
          for (let j = 0; j < 3; j++) K.sphere(ctx, bx - 2 + j * 2, by - 7 - (j % 2), 1.8, '#d2453a', { shine: 0.5 });
        }
      },
      harvest(b) {
        // A big timber hall with a wheat wreath over its doors; at the harvest festival, sheaves and baskets.
        const r = house(b, {
          wall: '#e9d7b0', trim: '#8b5e36', roof: '#9c4a35', roofDark: 'rgba(70, 20, 10, 0.5)', planks: true,
          wallH: 30, roofUp: 14, windows: [b.X + 12, b.X + b.Wp - 26 - SIDE], doorAt: b.cx - 8 - SIDE / 2, chimney: 'right',
        });
        const cx = (r.left + r.right) / 2, wy = r.wallTop - 6;
        ctx.strokeStyle = '#d9a83a'; ctx.lineWidth = 3.2;
        ctx.beginPath(); ctx.arc(cx, wy, 7, 0, TAU); ctx.stroke();
        for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; circle(cx + Math.cos(a) * 7, wy + Math.sin(a) * 7, 1.4, '#f2cf62'); }
        circle(cx, wy + 7, 2, '#d2453a');
        if (S.harvestFestival) {
          for (const dx of [-26, 30]) {
            const sx = cx + dx, sy = r.base + 6;
            shadow(sx + 4, sy, 7, 2.4, 0.3);
            for (let k = -2; k <= 2; k++) line(sx, sy, sx + k * 2.4, sy - 16, '#d9a83a', 1.6);
            rect(sx - 4, sy - 8, 8, 2, '#8b5e36');
          }
          for (let k = 0; k < 3; k++) {
            const bx = cx - 12 + k * 12, by = r.base + 10;
            K.cylinder(ctx, bx, by - 5, 4, 5, '#b3834f', { ry: 1.5, cap: false });
            const fruit = ['#d2453a', '#6b3a86', '#e8892e'][k];
            for (let j = 0; j < 3; j++) K.sphere(ctx, bx - 2 + j * 2, by - 6, 1.7, fruit, { shine: 0.5 });
          }
        }
      },
      smokehouse(b) {
        // A low log hut with a smoking chimney; golden fish hang on a rack beside it.
        const r = house(b, { wall: '#7a5236', trim: '#4a3020', roof: '#5f6a52', roofDark: 'rgba(30, 40, 20, 0.5)', planks: true, wallH: 20, windows: [], chimney: 'right', chimneyColor: '#6e6a62', smoke: 2.5, plinth: STONE.dark });
        const x0 = r.right + SIDE + 4, y0 = r.base;
        for (const px of [x0, x0 + 18]) K.cylinder(ctx, px, y0 - 20, 1.6, 20, WOOD.dark, { ry: 0.8 });
        line(x0 - 1, y0 - 19, x0 + 19, y0 - 19, WOOD.mid, 2);
        for (let k = 0; k < 3; k++) {
          const fx0 = x0 + 4 + k * 5;
          line(fx0, y0 - 19, fx0, y0 - 16, '#d8c79a', 0.8);
          ellipse(fx0, y0 - 11, 2, 5, '#c58a3e');
          poly([fx0, y0 - 6.5, fx0 - 2.4, y0 - 3.5, fx0 + 2.4, y0 - 3.5], '#a8742e');
        }
        shadow(x0 + 12, y0 + 1, 12, 2.4, 0.25);
      },
      house6(b) {
        // The fisher's cottage: blue trim, a net drying on two poles and an oar by the door.
        const r = house(b, { wall: '#eef2f4', trim: '#3d6a8a', roof: '#4f6f8a', roofDark: 'rgba(20, 40, 60, 0.5)', chimney: 'left' });
        const nx = r.right + SIDE + 3, ny = r.base;
        for (const px of [nx, nx + 16]) K.cylinder(ctx, px, ny - 22, 1.4, 22, WOOD.dark, { ry: 0.7 });
        ctx.strokeStyle = 'rgba(220, 210, 180, 0.8)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (let k = 0; k <= 4; k++) { ctx.moveTo(nx + k * 4, ny - 21); ctx.lineTo(nx + k * 4 + Math.sin(k) * 0.6, ny - 6); }
        for (let k = 0; k <= 3; k++) { ctx.moveTo(nx, ny - 21 + k * 5); ctx.quadraticCurveTo(nx + 8, ny - 19 + k * 5, nx + 16, ny - 21 + k * 5); }
        ctx.stroke();
        for (let k = 0; k < 4; k++) circle(nx + 2 + k * 4, ny - 6, 1, '#e8892e');
        ctx.save();
        ctx.translate(r.left - 6, r.base);
        ctx.rotate(-0.25);
        rect(-1, -26, 2, 22, WOOD.light, 1);
        ellipse(0, -4, 3, 6, WOOD.mid);
        ctx.restore();
      },
      boathouse: { body(b) {
        // A wide plank shed open to the water on its left; the boat from the fair rocks at the slip.
        const r = house(b, { ...BOATHOUSE, windows: [b.X + b.Wp - 30] });
        rect(r.left + 4, r.base - 22, 26, 22, '#2b2014', [3, 3, 0, 0]);
        if (S.lanternFestival) {
          // Lanterns strung over the opening, made here for the festival.
          for (let k = 0; k < 4; k++) {
            const lx = r.left + 6 + k * 7, ly = r.base - 26 + Math.sin(k * 1.4) * 1.5;
            rect(lx - 2, ly, 4, 5, ['#ff9f43', '#ff6b6b', '#ffd166', '#f78fb3'][k], 1.5);
            env.light(lx, ly + 2, 16, '#ffb35a', 0.8);
          }
        }
      },
      live(b) {
        const r = houseFrame(b, BOATHOUSE);
        const bob = Math.sin(time * 1.3) * 1.2;
        const bx = b.X - 18, by = r.base - 6 + bob;
        K.shadow(ctx, bx + 4, by + 6, 17, 4, 0.3);
        poly([bx - 16, by - 3, bx + 16, by - 3, bx + 11, by + 5, bx - 11, by + 5], '#8b5e36');
        poly([bx - 14, by - 3, bx + 14, by - 3, bx + 10, by + 1, bx - 10, by + 1], '#5f3d22');
        line(bx - 4, by - 3, bx - 4, by + 1, WOOD.light, 1.6);
        line(bx + 5, by - 3, bx + 5, by + 1, WOOD.light, 1.6);
        line(bx + 2, by - 1, bx + 22, by - 8, WOOD.light, 1.4);
      } },
      pavilion: { body(b) {
        // An eight-sided gazebo on stilts over the water: a plank deck, slim posts, a teal roof and paper
        // lanterns under the eaves that glow at dusk.
        const cx = b.cx, base = b.base - 10, deckY = base - 6;
        const rx = b.Wp / 2 - 6, ry = b.Hp / 2 - 14;
        shadow(cx + 8, base + 4, rx + 6, ry * 0.6 + 4, 0.28);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU;
          K.cylinder(ctx, cx + Math.cos(a) * rx * 0.9, deckY + Math.sin(a) * ry * 0.5, 2, 9, WOOD.dark, { ry: 1 });
        }
        K.cylinder(ctx, cx, deckY - ry, rx, 5, WOOD.light, { ry: ry * 0.75, capColor: '#c9935a' });
        for (let k = -3; k <= 3; k++) line(cx + k * rx / 4, deckY - ry - ry * 0.7 + Math.abs(k) * 1.5, cx + k * rx / 4, deckY - ry + ry * 0.7 - Math.abs(k) * 1.5, 'rgba(90, 55, 25, 0.35)', 0.8);
        const roofY = deckY - ry - 30;
        for (let k = 0; k < 6; k++) {
          const a = Math.PI * (0.1 + k * 0.16);
          K.cylinder(ctx, cx + Math.cos(a) * rx * 0.75, roofY + 6, 1.8, deckY - ry - roofY - 2 + Math.sin(a) * ry * 0.4, WOOD.mid, { ry: 0.8 });
        }
        // The railing at the front.
        line(cx - rx * 0.85, deckY - ry + ry * 0.45, cx + rx * 0.85, deckY - ry + ry * 0.45, WOOD.mid, 2);
        poly([cx - rx - 6, roofY + 8, cx, roofY - 20, cx + rx + 6, roofY + 8, cx + rx * 0.6, roofY + 14, cx - rx * 0.6, roofY + 14], '#3f8f8a');
        poly([cx, roofY - 20, cx + rx + 6, roofY + 8, cx + rx * 0.6, roofY + 14], 'rgba(10, 40, 40, 0.3)');
        line(cx - rx - 4, roofY + 8, cx, roofY - 18, '#7cc6bd', 1.5);
        K.sphere(ctx, cx, roofY - 21, 2.6, '#e9b44c');
      },
      live(b) {
        const cx = b.cx, deckY = b.base - 16, rx = b.Wp / 2 - 6, ry = b.Hp / 2 - 14, roofY = deckY - ry - 30;
        const n = S.lanternFestival ? 7 : 4;
        for (let k = 0; k < n; k++) {
          const lx = cx - rx + (k + 0.5) * (2 * rx) / n, ly = roofY + 16 + Math.sin(time * 1.5 + k) * 1.2;
          line(lx, roofY + 11, lx, ly, '#5b3a2a', 0.7);
          ellipse(lx, ly + 3, 3, 4, ['#ff9f43', '#ff6b6b', '#ffd166', '#f78fb3', '#c3a6ff', '#7bdff2', '#ff9f43'][k]);
          env.light(lx, ly + 3, 20, '#ffb35a', 0.9);
        }
      } },
      home(b) {
        house(b, { wall: '#f5efe2', trim: '#4d7fb6', roof: '#b9583b', roofDark: 'rgba(90, 30, 15, 0.45)', chimney: 'right' });
      },
      house1(b) {
        house(b, { wall: '#f3ecdc', trim: '#3f8a7a', roof: '#cfa65c', roofDark: 'rgba(120, 80, 30, 0.55)', roofStyle: 'thatch', chimney: 'left' });
      },
      house2(b) {
        house(b, { wall: '#efe7d6', trim: '#4d7fb6', roof: '#7a8792', roofDark: 'rgba(40, 45, 55, 0.5)', chimney: 'right', chimneyColor: STONE.mid });
      },
      house3(b) {
        house(b, { wall: '#f6eadb', trim: '#9a5aa8', roof: '#a8563c', roofDark: 'rgba(90, 30, 15, 0.45)', chimney: 'left' });
        // Drying pots by the potter's door.
        for (let k = 0; k < 3; k++) {
          const px = b.X + b.Wp - 2 + k * 5, py = b.base + 1;
          shadow(px + 1.5, py, 3.6, 1.6, 0.3);
          K.cylinder(ctx, px, py - 7, 2.6, 6, k % 2 ? '#c8794a' : '#b4643c', { ry: 1 });
        }
      },
      barn(b) {
        const r = house(b, {
          wall: '#a9553f', planks: true, trim: '#f2e9d8', roof: '#6e5241', roofDark: 'rgba(30, 18, 10, 0.5)',
          door: false, windows: [b.X + 9, b.X + b.Wp - 19 - SIDE], plinth: STONE.dark,
        });
        const mid = (r.left + r.right) / 2;
        rect(mid - 12, r.base - 21, 24, 21, 'rgba(30, 10, 4, 0.35)', 1);
        rect(mid - 11, r.base - 20, 22, 20, '#8c4332', 1);
        ctx.strokeStyle = '#f2e9d8';
        ctx.lineWidth = 1.6;
        ctx.strokeRect(mid - 11, r.base - 20, 22, 20);
        line(mid - 11, r.base - 20, mid + 11, r.base, '#f2e9d8', 1.6);
        line(mid + 11, r.base - 20, mid - 11, r.base, '#f2e9d8', 1.6);
        line(mid, r.base - 20, mid, r.base, '#f2e9d8', 1.2);
        // A hay bale by the wall; the upgraded barn gets a lean-to with sacks.
        shadow(r.right + 12, r.base, 8, 3, 0.3);
        K.block(ctx, r.right + 2, r.base - 10, 12, 10, 3, '#e2c071');
        line(r.right + 2, r.base - 5, r.right + 14, r.base - 5, '#c9a25a', 1);
        if (S.barnLevel >= 2) {
          K.block(ctx, r.left - 14, r.base - 16, 14, 16, 1, WOOD.light);
          poly([r.left - 17, r.base - 14, r.left, r.base - 22, r.left, r.base - 14], '#6e5241');
          K.block(ctx, r.left - 12, r.base - 8, 5, 7, 2, '#e8d7b5');
          K.block(ctx, r.left - 7, r.base - 9, 5, 8, 2, '#dccaa4');
        }
      },
      sawmill: { body(b) {
        const left = b.X + 4, right = b.X + b.Wp - 4 - SIDE, base = b.base - 4, top = b.Y - 4, eave = base - 26;
        castBlock(left, right, base, base - top + 6);
        rect(left + 2, eave, right - left - 4, base - eave, '#3e2c1e');
        sideWall(right - 2, eave, base, '#6e4a2b');
        // A saw bench with a log inside the open shed.
        K.block(ctx, left + 20, base - 12, 40, 4, 1, WOOD.light);
        K.cylinder(ctx, left + 40, base - 19, 18, 0.1, WOOD.mid, { ry: 4, capColor: WOOD.mid });
        ellipse(left + 58, base - 15, 3, 4, WOOD.pale);
        for (const px of [left + 4, (left + right) / 2, right - 4]) K.cylinder(ctx, px, eave - 2, 2, base - eave + 2, WOOD.mid, { ry: 1 });
        roof(left - 4, right + 4, top, eave + 2, '#9a7046', 'rgba(60, 35, 15, 0.45)', 'metal');
        // A log pile on the left, a plank stack on the right.
        for (const [dx, dy] of [[-12, -4], [-4, -4], [-8, -11]]) {
          K.sphere(ctx, left + dx, base + dy, 4.5, WOOD.mid, { gloss: false });
          circle(left + dx + 0.5, base + dy, 3.2, WOOD.pale);
          circle(left + dx + 0.5, base + dy, 1.2, WOOD.light);
        }
        for (let k = 0; k < 4; k++) K.block(ctx, right - 6 + (k % 2), base - 3 - k * 3, 18, 3, 1, k % 2 ? '#e0b779' : '#d7a560');
      },
      live(b) {
        // The spinning blade, with the shed's middle post in front of it again.
        const left = b.X + 4, right = b.X + b.Wp - 4 - SIDE, base = b.base - 4, eave = base - 26;
        ctx.save();
        ctx.translate(left + 34, base - 16);
        ctx.rotate(time * 6);
        K.sphere(ctx, 0, 0, 7, '#c9ccd1', { gloss: false });
        for (let k = 0; k < 8; k++) line(0, 0, Math.cos((k * TAU) / 8) * 7.5, Math.sin((k * TAU) / 8) * 7.5, '#8d9096', 1);
        ctx.restore();
        const mid = (left + right) / 2;
        if (Math.abs(mid - (left + 34)) < 10) K.cylinder(ctx, mid, eave - 2, 2, base - eave + 2, WOOD.mid, { ry: 1 });
      } },
      kiln: { body(b) {
        const cx = b.cx, base = b.base - 4;
        castBlock(cx - 24, cx + 18, base, 40);
        const dome = ctx.createRadialGradient(cx - 10, base - 26, 2, cx, base - 12, 36);
        dome.addColorStop(0, '#dc7a55');
        dome.addColorStop(0.5, '#b5583a');
        dome.addColorStop(1, '#7c3622');
        ctx.fillStyle = dome;
        ctx.beginPath();
        ctx.ellipse(cx, base, 25, 34, 0, Math.PI, TAU);
        ctx.closePath();
        ctx.fill();
        ctx.save();
        ctx.clip();
        for (let yy = base - 4, row = 0; yy > base - 36; yy -= 5, row++) {
          line(cx - 26, yy, cx + 26, yy, 'rgba(90, 30, 15, 0.35)', 0.8);
          for (let xx = cx - 26 + (row % 2) * 5; xx < cx + 26; xx += 10) line(xx, yy, xx, yy - 5, 'rgba(90, 30, 15, 0.3)', 0.8);
        }
        ctx.restore();
        rect(cx - 8, base - 17, 16, 17, '#2b1a12', [8, 8, 0, 0]);
        chimney(cx + 8, base - 34, '#9c4a35', 1.4);
        for (let k = 0; k < 3; k++) {
          const px = b.X + b.Wp + 2 + k * 6, py = base + 2;
          shadow(px + 1.5, py, 4, 1.6, 0.3);
          K.cylinder(ctx, px, py - 8, 3, 7, k === 1 ? '#a8432e' : '#c8794a', { ry: 1.1 });
        }
      },
      live(b) {
        // The fire in the mouth flickers.
        const cx = b.cx, base = b.base - 4;
        const f = 0.75 + Math.sin(time * 9) * 0.12 + Math.sin(time * 23) * 0.08;
        const g = ctx.createRadialGradient(cx, base - 4, 1, cx, base - 6, 13);
        g.addColorStop(0, `rgba(255, 220, 120, ${f})`);
        g.addColorStop(0.5, `rgba(240, 120, 40, ${f * 0.7})`);
        g.addColorStop(1, 'rgba(200, 60, 20, 0)');
        rect(cx - 8, base - 17, 16, 17, g, [8, 8, 0, 0]);
        K.glow(ctx, cx, base - 6, 16, '#ff9a40', 0.35 * f);
        env.light(cx, base - 8, 46, '#ff9a40', f);
      } },
      forge: { body(b) {
        const r = house(b, { ...FORGE, windows: [b.X + 10] });
        for (let yy = r.wallTop + 6; yy < r.base - 4; yy += 6) line(r.left, yy, r.right, yy, 'rgba(60, 55, 48, 0.35)', 0.8);
        // An open hearth on the right with a glow, an anvil in front.
        const hx = r.right - 26, hy = r.base - 18;
        rect(hx, hy, 20, 18, '#2a2420', [4, 4, 0, 0]);
        const ax = r.left + 8, ay = r.base + 6;
        shadow(ax + 9, ay + 1, 11, 3.4, 0.35);
        K.block(ctx, ax + 5, ay - 6, 6, 6, 1, '#3d3c40');
        poly([ax, ay - 11, ax + 16, ay - 11, ax + 20, ay - 8, ax + 12, ay - 6, ax + 4, ay - 6], '#55545a');
        line(ax + 1, ay - 10.5, ax + 15, ay - 10.5, '#b4b3ba', 1.2);
      },
      live(b) {
        // The open hearth glows and now and then throws a spark.
        const r = houseFrame(b, FORGE);
        const hx = r.right - 26, hy = r.base - 18;
        const f = 0.7 + Math.sin(time * 7) * 0.15 + Math.sin(time * 19) * 0.08;
        const g = ctx.createRadialGradient(hx + 10, hy + 14, 1, hx + 10, hy + 12, 14);
        g.addColorStop(0, `rgba(255, 210, 110, ${f})`);
        g.addColorStop(1, 'rgba(230, 90, 30, 0)');
        rect(hx, hy, 20, 18, g, [4, 4, 0, 0]);
        K.glow(ctx, hx + 10, hy + 12, 18, '#ff8a30', 0.35 * f);
        env.light(hx + 10, hy + 12, 44, '#ff8a30', f);
        if (Math.random() < 0.05) spark(hx + 10, hy + 8);
      } },
      mill: { body(b) {
        const cx = b.cx, base = b.base - 4;
        castBlock(cx - 16, cx + 10, base, 60);
        const body = ctx.createLinearGradient(cx - 17, 0, cx + 17, 0);
        body.addColorStop(0, '#fbf5e6');
        body.addColorStop(0.45, '#efe6d2');
        body.addColorStop(1, '#bcae92');
        poly([cx - 17, base, cx + 17, base, cx + 12, base - 42, cx - 12, base - 42], body);
        for (let yy = base - 8; yy > base - 40; yy -= 8) line(cx - 16, yy, cx + 16, yy, 'rgba(150, 120, 80, 0.18)', 0.8);
        door(cx - 5, base - 15, 10, 16);
        circle(cx, base - 29, 3.5, '#4d7fb6');
        circle(cx, base - 29, 2.4, WINDOW);
        env.light(cx, base - 29, 18, '#ffcf73', 0.8);
        poly([cx - 15, base - 41, cx + 15, base - 41, cx, base - 60], '#8a5e3e');
        poly([cx + 2, base - 41, cx + 15, base - 41, cx, base - 60], 'rgba(0, 0, 0, 0.25)');
        line(cx - 14, base - 41.5, cx - 1, base - 59, 'rgba(255, 220, 180, 0.35)', 1.2);
      },
      live(b) {
        // The sails turn; the flour sacks by the door stay in front of them.
        const cx = b.cx, base = b.base - 4;
        const hubY = base - 44, rot = time * 0.9;
        for (let k = 0; k < 4; k++) {
          ctx.save();
          ctx.translate(cx, hubY);
          ctx.rotate(rot + (k * Math.PI) / 2);
          line(0, 0, 0, -36, WOOD.dark, 2);
          rect(1, -36, 9, 28, 'rgba(250, 240, 220, 0.92)', 1);
          ctx.strokeStyle = WOOD.mid;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(1, -36, 9, 28);
          for (let yy = -31; yy < -8; yy += 5) line(1, yy, 10, yy, WOOD.mid, 0.6);
          ctx.restore();
        }
        K.sphere(ctx, cx, hubY, 3.5, WOOD.dark, { gloss: false });
        // Flour sacks by the door.
        K.block(ctx, cx + 10, base - 8, 7, 8, 3, '#ece0c4');
        K.block(ctx, cx + 16, base - 6, 6, 6, 3, '#e2d4b4');
      } },
      chapel: { body(b) {
        const left = b.X + 8, right = b.X + b.Wp - 8 - SIDE, base = b.base - 4, wallH = 30, wallTop = base - wallH, top = b.Y - 4;
        const cx = (left + right) / 2;
        castBlock(left, right, base, 70);
        sideWall(right, wallTop, base, '#f6f1e6');
        wall(left, wallTop, right - left, wallH, '#f6f1e6');
        K.block(ctx, left, base - 5, right - left, 5, 1, STONE.mid, { top: 0.25 });
        for (const wx of [left + 6, right - 14]) {
          rect(wx - 1, wallTop + 7, 10, 16, '#e6dccb', [5, 5, 1, 1]);
          rect(wx, wallTop + 8, 8, 14, '#9ecbe0', [4, 4, 0, 0]);
          env.light(wx + 4, wallTop + 15, 24, '#ffd890', S.festival ? 1 : 0.6);
          rect(wx + 1, wallTop + 9, 3, 6, 'rgba(255, 255, 255, 0.5)', [2, 0, 0, 0]);
        }
        roof(left - 5, right + 5, top, wallTop + 3, '#4f8a7e', 'rgba(20, 50, 45, 0.45)', 'metal');
        // The bell tower over the entrance: a belfry, an onion dome and a cross.
        const tw = 24, tTop = base - 74;
        poly([cx + tw / 2, tTop, cx + tw / 2 + 5, tTop - 2.5, cx + tw / 2 + 5, base - 2.5, cx + tw / 2, base], '#c9bfae');
        wall(cx - tw / 2, tTop, tw, base - tTop, '#fbf6ec');
        door(cx - 6, base - 18, 12, 17, '#8b5a32');
        rect(cx - 7, tTop + 8, 14, 16, '#3d3226', [7, 7, 0, 0]);
        K.block(ctx, cx - tw / 2 - 2, tTop - 2, tw + 4, 4, 1, '#4f8a7e', { top: 0.4 });
        const gold = ctx.createRadialGradient(cx - 5, tTop - 14, 1, cx, tTop - 10, 16);
        gold.addColorStop(0, '#fff2b8');
        gold.addColorStop(0.4, '#e2b44a');
        gold.addColorStop(1, '#9c7426');
        ctx.fillStyle = gold;
        ctx.beginPath();
        ctx.moveTo(cx - 10, tTop - 2);
        ctx.bezierCurveTo(cx - 16, tTop - 12, cx - 4, tTop - 18, cx, tTop - 28);
        ctx.bezierCurveTo(cx + 4, tTop - 18, cx + 16, tTop - 12, cx + 10, tTop - 2);
        ctx.closePath();
        ctx.fill();
        line(cx, tTop - 28, cx, tTop - 40, '#d4a63c', 1.8);
        line(cx - 4, tTop - 35, cx + 4, tTop - 35, '#d4a63c', 1.8);
      },
      live(b) {
        // The bell in the belfry: barely moving, rung hard on the festival.
        const left = b.X + 8, right = b.X + b.Wp - 8 - SIDE, base = b.base - 4, cx = (left + right) / 2, tTop = base - 74;
        const bellA = S.festival ? Math.sin(time * 3.2) * 0.45 : Math.sin(time * 0.8) * 0.04;
        ctx.save();
        ctx.translate(cx, tTop + 11);
        ctx.rotate(bellA);
        poly([-4, 9, 4, 9, 3, 2, 1.5, 0, -1.5, 0, -3, 2], '#e2b44a');
        circle(0, 9.5, 1.3, '#a8802e');
        ctx.restore();
      } },
    };

    // The pavilion before it is done: old stilts in the water (stage 0), then a deck laid with the paid share.
    function pavilionWorks(b, stage, part) {
      const cx = b.cx, deckY = b.base - 16;
      const rx = b.Wp / 2 - 6, ry = b.Hp / 2 - 14;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        const h = stage ? 9 : 4 + hash2(b.x0, k, 420) * 7;
        if (!stage && hash2(b.x0, k, 421) < 0.3) continue;
        K.cylinder(ctx, cx + Math.cos(a) * rx * 0.9, deckY + 10 - h + Math.sin(a) * ry * 0.5, 2, h, WOOD.dark, { ry: 1 });
      }
      if (!stage) return;
      const n = Math.max(1, Math.round(12 * part));
      for (let k = 0; k < n; k++) {
        const y = deckY - ry - ry * 0.7 + k * (ry * 1.4) / 12;
        K.block(ctx, cx - rx * 0.85, y, rx * 1.7, ry * 1.4 / 12 - 0.6, 1, k % 2 ? WOOD.light : '#a8774a', { top: 0.2 });
      }
    }

    // Stage 0: tumbled walls of dressed stone blocks on a patch of bare earth, a fallen beam, rubble and weeds.
    function drawRuin(b) {
      const left = b.X + 4, right = b.X + b.Wp - 4, base = b.base - 4;
      // Bare, trodden earth where the house stood, soft at the edges.
      const ex = (left + right) / 2, ey = b.Y + b.Hp * 0.62, erx = (right - left) / 2 + 3, ery = (base - b.Y) * 0.42;
      const earth = ctx.createRadialGradient(ex, ey, 2, ex, ey, Math.max(erx, ery));
      earth.addColorStop(0, 'rgba(112, 92, 58, 0.55)');
      earth.addColorStop(0.7, 'rgba(112, 92, 58, 0.42)');
      earth.addColorStop(1, 'rgba(112, 92, 58, 0)');
      ctx.fillStyle = earth;
      ctx.beginPath(); ctx.ellipse(ex, ey, erx, ery, 0, 0, TAU); ctx.fill();
      // A column of `n` blocks, 5 px a course, each with its own shade; odd courses are set half a block in.
      const BH = 5;
      const column = (x, bottom, n, seed, w = 8.4) => {
        for (let j = 0; j < n; j++) {
          const col = K.shade(STONE.mid, (hash2(seed, j, 410) - 0.5) * 0.24);
          const dx = j % 2 ? 0.8 : 0;
          K.prism(ctx, x + dx, bottom - (j + 1) * BH + 1, w - 0.6, BH - 0.4, 2.6, col, { r: 1 });
        }
        if (n && hash2(seed, n, 411) < 0.4) { // moss on the top block
          ctx.fillStyle = 'rgba(100, 155, 60, 0.85)';
          ctx.beginPath(); ctx.ellipse(x + 4, bottom - n * BH - 0.8, 3, 1.3, 0, 0, TAU); ctx.fill();
        }
      };
      // The back wall, broken to uneven heights.
      const wallY = b.Y + b.Hp * 0.42;
      castBlock(left, right - SIDE, wallY + 3, 12);
      for (let x = left, k = 0; x < right - 4; x += 8, k++) {
        if (hash2(b.x0, k, 401) < 0.16) continue;
        column(x, wallY + 3, 1 + Math.floor(hash2(b.x0, k, 400) * 3.2), b.x0 * 31 + k);
      }
      // Corner stubs at the front.
      for (const sx of [left, right - 8]) {
        shadow(sx + 8, base, 7, 2.6, 0.32);
        column(sx, base + 1, 1 + Math.floor(hash2(b.x0, sx, 402) * 3), b.y0 * 17 + sx);
      }
      // A fallen roof beam with grain and a pale cut end.
      ctx.save();
      ctx.translate((left + right) / 2, base - 10);
      ctx.rotate(-0.35 + hash2(b.x0, b.y0, 403) * 0.7);
      const bw = b.Wp * 0.62;
      K.shadow(ctx, 3, 4, bw / 2, 3, 0.35);
      K.block(ctx, -bw / 2, -2.5, bw, 5, 1.5, WOOD.dark, { top: 0.3, bottom: -0.3 });
      line(-bw / 2 + 3, -0.5, bw / 2 - 4, -0.8, 'rgba(40, 24, 10, 0.4)', 0.7);
      ellipse(bw / 2 - 0.5, 0, 1.6, 2.5, WOOD.pale);
      ctx.restore();
      // Rubble: small lit stones with shadows.
      for (let k = 0; k < 6; k++) {
        const sx = left + hash2(b.x0, k, 404) * (right - left), sy = base - 2 - hash2(b.y0, k, 405) * 10;
        const r = 2.4 + hash2(b.x0, k, 408) * 2;
        K.shadow(ctx, sx + 1.5, sy + 1.8, r + 1, r * 0.6, 0.35);
        blob(sx, sy, r, r * 0.75, b.x0 * 13 + k, K.shade(STONE.mid, 0.05));
        blob(sx - r * 0.3, sy - r * 0.3, r * 0.5, r * 0.3, b.x0 * 13 + k + 1, 'rgba(255, 250, 235, 0.4)');
      }
      // Weeds pushing up through the floor.
      ctx.lineCap = 'round';
      for (let k = 0; k < 6; k++) {
        const wx = left + 4 + hash2(b.x0, k, 406) * (right - left - 8), wy = base - hash2(b.y0, k, 407) * 12;
        ctx.strokeStyle = k % 2 ? GRASS.tuft : K.shade(GRASS.tuft, 0.25);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(wx, wy); ctx.lineTo(wx - 2.5, wy - 6);
        ctx.moveTo(wx, wy); ctx.lineTo(wx, wy - 7.5);
        ctx.moveTo(wx, wy); ctx.lineTo(wx + 2.8, wy - 5.5);
        ctx.stroke();
      }
    }

    // Stage 1: walls rising with the paid share inside scaffolding of round poles.
    function drawScaffold(b, part) {
      const left = b.X + 6, right = b.X + b.Wp - 6 - SIDE, base = b.base - 4;
      const fullH = b.h >= 3 ? 30 : 24;
      const h = Math.max(4, fullH * (0.25 + 0.75 * part));
      castBlock(left, right, base, h + 10);
      K.block(ctx, left - 2, base - 6, right - left + 4, 8, 2, STONE.dark, { top: 0.3 });
      const brick = b.id === 'kiln' || b.id === 'house1' || b.id === 'house2' || b.id === 'house3' || b.id === 'forge' || b.id === 'mill';
      const col = brick ? '#b8664a' : STONE.mid;
      sideWall(right, base - h, base, col);
      poly([left, base - h, right, base - h, right + SIDE, base - h - SIDE * 0.5, left + SIDE, base - h - SIDE * 0.5], K.shade(col, 0.25));
      wall(left, base - h, right - left, h, col);
      for (let yy = base - 5; yy > base - h; yy -= 5) line(left, yy, right, yy, 'rgba(60, 40, 30, 0.3)', 0.8);
      const poleTop = base - fullH - 16;
      for (const px of [left - 3, right + 3]) K.cylinder(ctx, px, poleTop, 1.6, base - poleTop, WOOD.pale, { ry: 0.8 });
      line(left - 4, base - h - 3, right + 4, base - h - 3, WOOD.light, 3);
      line(left - 3, poleTop + 6, right + 3, base - 6, 'rgba(179, 131, 79, 0.85)', 1.6);
      // A pile of materials waiting by the wall.
      for (let k = 0; k < 3; k++) K.block(ctx, right + 1, base - 3 - k * 3, 12, 3, 1, k % 2 ? WOOD.light : WOOD.pale);
      blob(left - 6, base - 2, 5, 3.5, b.x0 + 77, STONE.light);
    }

    // Draw a building at its stage: 0 ruin, 1 scaffolding (rises with `part`, the paid share), 2 restored.
    // `mode`: 'all' draws everything; 'body' only what stands still (art.js bakes it into a sprite); 'live'
    // only what moves (bees, flags, the boat, lanterns, the saw, fire, sails, the bell), drawn over the body
    // every frame. A restored building is either a function (all of it stands still) or { body, live }.
    function draw(id, stage, b, part, mode = 'all') {
      S = env.state();
      time = env.time();
      if (stage === 2) {
        const art = ART[id] || ((box) => house(box, PLAIN));
        const body = typeof art === 'function' ? art : art.body, live = typeof art === 'function' ? null : art.live;
        if (mode !== 'live' && body) body(b);
        if (mode !== 'body' && live) live(b);
        return;
      }
      if (mode === 'live') return; // ruins and scaffolding stand still
      if (id === 'pavilion') pavilionWorks(b, stage, clamp(part, 0, 1)); // over the water: no stone walls
      else if (id === 'well') wellRuin(b, stage === 1 ? clamp(part, 0, 1) : 0);
      else if (stage === 1) drawScaffold(b, clamp(part, 0, 1));
      else drawRuin(b);
    }

    return { draw, setCtx: (g) => { ctx = g; } };
  }

  window.VillageHouses = { create };
})();
