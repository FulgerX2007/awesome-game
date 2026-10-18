// Родник — the buildings in 2.5D: ruins, scaffolding and the twelve restored buildings.
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
  //        light(x, y, r, color, a) → a light that glows after dark }
  function create(env) {
    const { ctx, K, WOOD, STONE, GRASS, WINDOW, rect, line, circle, ellipse, poly, blob, emit, spark } = env;
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

    // A wall face with a soft vertical light gradient (bright under the eave light, darker at the plinth).
    function wall(x, y, w, h, color) {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, K.shade(color, 0.06));
      g.addColorStop(1, K.shade(color, -0.12));
      rect(x, y, w, h, g);
    }

    // The right side wall: a parallelogram receding up and to the right, in shade.
    function sideWall(right, top, base, color) {
      poly([right, top, right + SIDE, top - SIDE * 0.5, right + SIDE, base - SIDE * 0.5, right, base], K.shade(color, -0.3));
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
      const back = 7;
      poly([left + 4, top, right - 4, top, right - 6, top - back, left + 6, top - back], K.shade(col, 0.22));
      poly([right - 4, top, right + SIDE - 2, top - back * 0.5, right + SIDE, eave - SIDE * 0.5, right, eave], K.shade(col, -0.38));
      const front = [left, eave, right, eave, right - 4, top, left + 4, top];
      const g = ctx.createLinearGradient(0, top, 0, eave);
      g.addColorStop(0, K.shade(col, 0.06));
      g.addColorStop(1, K.shade(col, -0.16));
      poly(front, g);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(left, eave); ctx.lineTo(right, eave); ctx.lineTo(right - 4, top); ctx.lineTo(left + 4, top);
      ctx.closePath();
      ctx.clip();
      if (style === 'thatch') {
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
    function house(b, o) {
      const left = b.X + 5, right = b.X + b.Wp - 5 - SIDE, base = b.Y + b.Hp - 4;
      const wallH = o.wallH || 24, wallTop = base - wallH, top = b.Y - (o.roofUp || 10);
      castBlock(left, right, base, base - top + 8);
      sideWall(right, wallTop, base, o.wall);
      wall(left, wallTop, right - left, wallH, o.wall);
      if (o.planks) for (let xx = left + 4; xx < right; xx += 5) line(xx, wallTop, xx, base, 'rgba(60, 25, 15, 0.25)', 1);
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

    const ART = {
      well(b) {
        const cx = b.cx, cy = b.base - 22;
        castBlock(cx - 20, cx + 12, cy + 12, 40);
        shadow(cx + 3, cy + 10, 23, 8, 0.3);
        K.cylinder(ctx, cx, cy - 2, 20, 6, STONE.mid, { ry: 13, capColor: STONE.light });
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * TAU;
          line(cx + Math.cos(a) * 14, cy - 2 + Math.sin(a) * 9, cx + Math.cos(a) * 20, cy - 2 + Math.sin(a) * 13, STONE.dark, 1);
        }
        const water = ctx.createRadialGradient(cx - 4, cy - 6, 1, cx, cy - 3, 13);
        water.addColorStop(0, '#5aa3bb');
        water.addColorStop(1, '#1f4a5c');
        ellipse(cx, cy - 3, 13, 8, water);
        ellipse(cx - 3, cy - 5, 4, 1.5, 'rgba(255, 255, 255, 0.45)');
        K.cylinder(ctx, cx - 17, cy - 34, 2.2, 34, WOOD.mid, { ry: 1 });
        K.cylinder(ctx, cx + 17, cy - 34, 2.2, 34, WOOD.mid, { ry: 1 });
        line(cx - 15, cy - 26, cx + 15, cy - 26, WOOD.dark, 2.5);
        const bob = Math.sin(time * 1.4) * 1.5;
        line(cx + 2, cy - 26, cx + 2, cy - 14 + bob, '#d8c79a', 1);
        K.block(ctx, cx - 2, cy - 14 + bob, 8, 7, 2, WOOD.light);
        poly([cx - 26, cy - 28, cx, cy - 46, cx + 26, cy - 28, cx + 22, cy - 24, cx, cy - 41, cx - 22, cy - 24], '#a8503a');
        poly([cx, cy - 46, cx + 26, cy - 28, cx + 22, cy - 24, cx, cy - 41], 'rgba(40, 10, 0, 0.25)');
        line(cx - 24, cy - 27, cx, cy - 44, '#d57a5a', 1.5);
        // Pots of flowers around the well bring the square back to life.
        for (const [px, py, c] of [[-24, 8, '#e0607e'], [24, 6, '#f4d35e']]) {
          shadow(cx + px + 2, cy + py + 3, 6, 2.2, 0.3);
          K.cylinder(ctx, cx + px, cy + py - 4, 4, 6, '#b4643c', { ry: 1.6 });
          K.sphere(ctx, cx + px - 1.5, cy + py - 5, 2.4, c, { gloss: false });
          K.sphere(ctx, cx + px + 1.8, cy + py - 6, 2.4, c, { gloss: false });
          K.sphere(ctx, cx + px, cy + py - 7.5, 2, '#5f9446', { gloss: false });
        }
      },
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
      sawmill(b) {
        const left = b.X + 4, right = b.X + b.Wp - 4 - SIDE, base = b.base - 4, top = b.Y - 4, eave = base - 26;
        castBlock(left, right, base, base - top + 6);
        rect(left + 2, eave, right - left - 4, base - eave, '#3e2c1e');
        sideWall(right - 2, eave, base, '#6e4a2b');
        // A saw bench with a log inside the open shed.
        K.block(ctx, left + 20, base - 12, 40, 4, 1, WOOD.light);
        K.cylinder(ctx, left + 40, base - 19, 18, 0.1, WOOD.mid, { ry: 4, capColor: WOOD.mid });
        ellipse(left + 58, base - 15, 3, 4, WOOD.pale);
        ctx.save();
        ctx.translate(left + 34, base - 16);
        ctx.rotate(time * 6);
        K.sphere(ctx, 0, 0, 7, '#c9ccd1', { gloss: false });
        for (let k = 0; k < 8; k++) line(0, 0, Math.cos((k * TAU) / 8) * 7.5, Math.sin((k * TAU) / 8) * 7.5, '#8d9096', 1);
        ctx.restore();
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
      kiln(b) {
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
        const f = 0.75 + Math.sin(time * 9) * 0.12 + Math.sin(time * 23) * 0.08;
        const g = ctx.createRadialGradient(cx, base - 4, 1, cx, base - 6, 13);
        g.addColorStop(0, `rgba(255, 220, 120, ${f})`);
        g.addColorStop(0.5, `rgba(240, 120, 40, ${f * 0.7})`);
        g.addColorStop(1, 'rgba(200, 60, 20, 0)');
        rect(cx - 8, base - 17, 16, 17, g, [8, 8, 0, 0]);
        K.glow(ctx, cx, base - 6, 16, '#ff9a40', 0.35 * f);
        env.light(cx, base - 8, 46, '#ff9a40', f);
        chimney(cx + 8, base - 34, '#9c4a35', 1.4);
        for (let k = 0; k < 3; k++) {
          const px = b.X + b.Wp + 2 + k * 6, py = base + 2;
          shadow(px + 1.5, py, 4, 1.6, 0.3);
          K.cylinder(ctx, px, py - 8, 3, 7, k === 1 ? '#a8432e' : '#c8794a', { ry: 1.1 });
        }
      },
      forge(b) {
        const r = house(b, {
          wall: '#9a958a', trim: '#5b5b63', roof: '#4d4f58', roofDark: 'rgba(15, 15, 20, 0.5)',
          door: false, windows: [b.X + 10], chimney: 'left', chimneyColor: STONE.dark, smoke: 1.3,
        });
        for (let yy = r.wallTop + 6; yy < r.base - 4; yy += 6) line(r.left, yy, r.right, yy, 'rgba(60, 55, 48, 0.35)', 0.8);
        // An open hearth on the right with a glow, an anvil in front.
        const hx = r.right - 26, hy = r.base - 18;
        rect(hx, hy, 20, 18, '#2a2420', [4, 4, 0, 0]);
        const f = 0.7 + Math.sin(time * 7) * 0.15 + Math.sin(time * 19) * 0.08;
        const g = ctx.createRadialGradient(hx + 10, hy + 14, 1, hx + 10, hy + 12, 14);
        g.addColorStop(0, `rgba(255, 210, 110, ${f})`);
        g.addColorStop(1, 'rgba(230, 90, 30, 0)');
        rect(hx, hy, 20, 18, g, [4, 4, 0, 0]);
        K.glow(ctx, hx + 10, hy + 12, 18, '#ff8a30', 0.35 * f);
        env.light(hx + 10, hy + 12, 44, '#ff8a30', f);
        const ax = r.left + 8, ay = r.base + 6;
        shadow(ax + 9, ay + 1, 11, 3.4, 0.35);
        K.block(ctx, ax + 5, ay - 6, 6, 6, 1, '#3d3c40');
        poly([ax, ay - 11, ax + 16, ay - 11, ax + 20, ay - 8, ax + 12, ay - 6, ax + 4, ay - 6], '#55545a');
        line(ax + 1, ay - 10.5, ax + 15, ay - 10.5, '#b4b3ba', 1.2);
        if (Math.random() < 0.05) spark(hx + 10, hy + 8);
      },
      mill(b) {
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
      },
      chapel(b) {
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
        const bellA = S.festival ? Math.sin(time * 3.2) * 0.45 : Math.sin(time * 0.8) * 0.04;
        ctx.save();
        ctx.translate(cx, tTop + 11);
        ctx.rotate(bellA);
        poly([-4, 9, 4, 9, 3, 2, 1.5, 0, -1.5, 0, -3, 2], '#e2b44a');
        circle(0, 9.5, 1.3, '#a8802e');
        ctx.restore();
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
    };

    // Stage 0: tumbled walls of stone blocks, a fallen beam and weeds.
    function drawRuin(b) {
      const left = b.X + 4, right = b.X + b.Wp - 4, base = b.base - 4;
      rect(left, b.Y + b.Hp * 0.3, right - left, base - b.Y - b.Hp * 0.3, 'rgba(120, 100, 70, 0.45)', 6);
      if (b.id === 'well') {
        const cx = b.cx, cy = b.base - 22;
        ctx.strokeStyle = STONE.dark;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.ellipse(cx + 1, cy + 2, 17, 11, 0, 0.6, 4.4);
        ctx.stroke();
        ctx.strokeStyle = STONE.mid;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 17, 11, 0, 0.6, 4.4);
        ctx.stroke();
        ellipse(cx, cy - 1, 11, 7, '#2c3a30');
        for (let k = 0; k < 4; k++) blob(cx + 10 + k * 5, cy + 4 + (k % 2) * 4, 3.5, 2.5, 900 + k, k % 2 ? STONE.light : STONE.mid);
        K.block(ctx, cx - 21, cy - 14, 4, 14, 1, WOOD.dark);
        return;
      }
      const wallY = b.Y + b.Hp * 0.42;
      for (let x = left, k = 0; x < right - 4; x += 8, k++) {
        const hgt = 3 + hash2(b.x0, k, 400) * 13;
        if (hash2(b.x0, k, 401) < 0.18) continue;
        K.prism(ctx, x, wallY - hgt + 3, 8, hgt + 1, 3, STONE.mid, { r: 1 });
      }
      for (const sx of [left, right - 7]) {
        const hgt = 8 + hash2(b.x0, sx, 402) * 10;
        shadow(sx + 7, base, 6, 2.4, 0.3);
        K.prism(ctx, sx, base - hgt + 3, 7, hgt - 3, 3, STONE.mid, { r: 1 });
      }
      ctx.save();
      ctx.translate((left + right) / 2, base - 10);
      ctx.rotate(-0.35 + hash2(b.x0, b.y0, 403) * 0.7);
      K.shadow(ctx, 3, 4, b.Wp * 0.3, 3, 0.3);
      K.block(ctx, -b.Wp * 0.3, -2, b.Wp * 0.6, 4, 1, WOOD.dark);
      ctx.restore();
      for (let k = 0; k < 5; k++) {
        const sx = left + hash2(b.x0, k, 404) * (right - left), sy = base - 2 - hash2(b.y0, k, 405) * 8;
        blob(sx + 1, sy + 1, 3.5, 2.5, b.x0 * 13 + k, STONE.dark);
        blob(sx, sy, 3.5, 2.5, b.x0 * 13 + k, STONE.light);
      }
      for (let k = 0; k < 4; k++) {
        const wx = left + 4 + hash2(b.x0, k, 406) * (right - left - 8), wy = base - hash2(b.y0, k, 407) * 4;
        line(wx - 2, wy - 6, wx, wy, GRASS.tuft, 1.3);
        line(wx + 2, wy - 7, wx, wy, GRASS.tuft, 1.3);
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
    function draw(id, stage, b, part) {
      S = env.state();
      time = env.time();
      if (stage === 2) ART[id](b);
      else if (stage === 1 && id !== 'well') drawScaffold(b, clamp(part, 0, 1));
      else drawRuin(b);
    }

    return { draw };
  }

  window.VillageHouses = { create };
})();
