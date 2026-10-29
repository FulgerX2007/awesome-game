#!/usr/bin/env node
'use strict';
// Глубина on Godot: bakes every creature from web/deep/models.js into sprites, so the Godot version
// shows the same hand-made models. Each species gets a body sprite and, if it glows, a lights sprite.
// The fish are baked straight (no body wave): the Godot shader bends them while they swim.
//   node tools/deep-godot/bake.cjs
// Writes godot/deep/assets/creatures/<id>.png, <id>.glow.png and godot/deep/data/creatures.json.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../..');
const OUT_IMG = path.join(ROOT, 'godot/deep/assets/creatures');
const OUT_JSON = path.join(ROOT, 'godot/deep/data/creatures.json');
const S = 96;        // pixels per model unit s
const MAX_SIDE = 960; // the longest creatures are baked smaller

// The bake needs two things models.js keeps to itself: a straight fish spine and the fish proportions.
function patchedModels() {
  let src = fs.readFileSync(path.join(ROOT, 'web/deep/models.js'), 'utf8');
  const wave = 'sw = (c.swim ?? 0.35) * H';
  if (!src.includes(wave)) throw new Error('models.js: fish wave not found, update bake.cjs');
  src = src.replace(wave, 'sw = (globalThis.BAKE_STRAIGHT ? 0 : (c.swim ?? 0.35)) * H');
  const api = 'root.DeepModels = { draw,';
  if (!src.includes(api)) throw new Error('models.js: export not found, update bake.cjs');
  src = src.replace(api, 'root.DeepModels = { fish: (id) => FISH[id] && { L: FISH[id].L, H: FISH[id].H, swim: FISH[id].swim ?? 0.35 }, draw,');
  return src;
}

async function main() {
  const C = require(path.join(ROOT, 'web/deep/core.js'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: 'globalThis.BAKE_STRAIGHT = true;' });
  await page.addScriptTag({ content: patchedModels() });

  const ids = C.SPECIES.map((s) => s.id);
  const result = await page.evaluate(({ ids, S, MAX_SIDE }) => {
    const M = window.DeepModels;
    // Draw on a generous canvas, then crop to what was painted.
    function bake(id, s, mode) {
      const [back, front, half] = M.box(id);
      const pad = 7; // glow halos reach well past the body
      const w = Math.ceil((back + front + pad * 2) * s), h = Math.ceil((half + pad) * 2 * s);
      const ox = Math.ceil((back + pad) * s), oy = Math.ceil(h / 2);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.translate(ox, oy);
      M.draw(ctx, id, s, 0, mode);
      const px = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (px[(y * w + x) * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
      }
      if (x1 < 0) return null;
      // a transparent border keeps linear filtering clean at the edges, and the extra height
      // leaves room for the swim shader to bend the body up and down
      const bend = Math.ceil(s * 0.2);
      x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2 - bend); x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2 + bend);
      const out = document.createElement('canvas');
      out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
      out.getContext('2d').drawImage(cv, -x0, -y0);
      return { png: out.toDataURL('image/png'), w: out.width, h: out.height, ox: ox - x0, oy: oy - y0 };
    }
    const all = {};
    for (const id of ids) {
      const [back, front, half] = M.box(id);
      const s = Math.min(S, Math.floor(MAX_SIDE / Math.max(back + front, half * 2)));
      all[id] = { s, box: [back, front, half], upright: M.upright(id), fish: M.fish(id) || null, body: bake(id, s, 'body'), glow: bake(id, s, 'lights') };
    }
    return all;
  }, { ids, S, MAX_SIDE });
  await browser.close();

  fs.mkdirSync(OUT_IMG, { recursive: true });
  const manifest = {};
  for (const id of ids) {
    const r = result[id];
    if (!r.body) throw new Error(`${id}: the model drew nothing`);
    const write = (img, name) => fs.writeFileSync(path.join(OUT_IMG, name), Buffer.from(img.png.split(',')[1], 'base64'));
    write(r.body, `${id}.png`);
    if (r.glow) write(r.glow, `${id}.glow.png`);
    const place = (img) => img && { w: img.w, h: img.h, ox: img.ox, oy: img.oy };
    manifest[id] = { s: r.s, box: r.box, upright: r.upright, fish: r.fish, body: place(r.body), glow: place(r.glow) };
  }
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`baked ${ids.length} creatures, ${Object.values(manifest).filter((m) => m.glow).length} of them glow`);
}

main().catch((e) => { console.error(e); process.exit(1); });
