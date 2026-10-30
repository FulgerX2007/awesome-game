#!/usr/bin/env node
'use strict';
// Тяни штифт on Godot: bakes the art of web/pins/game.js into images, so the Godot version looks like the
// web one: the masonry board of every level, every pin, the hero and the goblins in all their poses, the keg,
// coins and stone lumps. game.js keeps its drawing functions to itself; the bake serves a copy that hands
// them out (window.__bake) to a headless page. Nothing in web/ changes.
// The sounds of web/pins/audio.js are rendered the same way, through an OfflineAudioContext, into WAV files.
//   node tools/pins-godot/bake.cjs
// Writes godot/pins/assets/{boards,pins,sprites,sounds}/ and godot/pins/data/art.json.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../..');
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, 'godot/pins/assets');
const K_BOARD = 2;  // board images: 720×1080
const K_ART = 3;    // figures, pins, keg, coins

function patchedGame() {
  let src = fs.readFileSync(path.join(WEB, 'pins/game.js'), 'utf8');
  const swaps = [
    ["const ctx = canvas.getContext('2d');", "let ctx = canvas.getContext('2d');"],
    ['  // ───────────── Boot ─────────────', `  window.__bake = {
    level(i) { s = C.buildLevel(LEVELS[i]); },
    setK(v) { k = v; buildSprites(); },
    board() { return buildStatic(); },
    sprites,
    draw(c, fn) { const old = ctx; ctx = c; try { fn(); } finally { ctx = old; } },
    figure: (...a) => drawFigure(...a), keg: (...a) => drawKeg(...a), pin: (...a) => drawPin(...a),
    door: (o) => drawDoor(o), torches: () => drawTorches(),
    place(exit, room) { s.exit = exit; s.room = room; },
    looks: { HERO_LOOK, ENEMY_LOOK, BURNT, POISONED },
    setTime(v) { time = v; },
  };
  // ───────────── Boot ─────────────`],
  ];
  for (const [a, b] of swaps) {
    if (!src.includes(a)) throw new Error(`game.js changed: "${a.trim()}" not found, update bake.cjs`);
    src = src.replace(a, b);
  }
  return src;
}

// audio.js with its context swapped for an OfflineAudioContext the bake hands in.
function patchedAudio() {
  let src = fs.readFileSync(path.join(WEB, 'pins/audio.js'), 'utf8');
  const swaps = [
    ['try { ac = new AC(); }', 'try { ac = root.__offline || new AC(); }'],
    ['  // ───────────── Public ─────────────', `  root.__renderSound = (name, ctx) => { root.__offline = ctx; ac = null; unlocked = true; state.enabled = true; SOUNDS[name] && ensure() && SOUNDS[name](); };
  // ───────────── Public ─────────────`],
  ];
  for (const [a, b] of swaps) {
    if (!src.includes(a)) throw new Error(`audio.js changed: "${a.trim()}" not found, update bake.cjs`);
    src = src.replace(a, b);
  }
  return src;
}

async function main() {
  const L = require(path.join(WEB, 'pins/levels.js'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const game = patchedGame();
  await page.route('http://bake.local/**', (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, '');
    if (rel === 'pins/game.js') return route.fulfill({ body: game, contentType: 'text/javascript' });
    const file = path.join(WEB, rel.endsWith('/') ? rel + 'index.html' : rel);
    if (!file.startsWith(WEB) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    return route.fulfill({ body: fs.readFileSync(file), contentType: type });
  });
  await page.goto('http://bake.local/pins/');
  await page.waitForFunction(() => window.__bake);

  const out = await page.evaluate(({ count, K_BOARD, K_ART }) => {
    const B = window.__bake;
    const png = (cv) => cv.toDataURL('image/png');
    const webp = (cv) => cv.toDataURL('image/webp', 0.86);
    // A canvas in logical px (lw×lh) at k device px per logical px, with (ox, oy) as the logical origin.
    const canvas = (lw, lh, k, ox = 0, oy = 0) => {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(lw * k); cv.height = Math.ceil(lh * k);
      const g = cv.getContext('2d');
      g.setTransform(k, 0, 0, k, ox * k, oy * k);
      return { cv, g };
    };
    const res = { boards: [], pins: [], sprites: {} };
    // torches and the door glow use 'lighter' and the time; a still frame is enough
    B.setTime(0.3);

    B.setTime(0);
    B.setK(K_BOARD);
    for (let i = 0; i < count; i++) {
      B.level(i);
      res.boards.push(webp(B.board()));
    }

    B.setK(K_ART);
    // Pins: each one alone on a canvas covering the board (cropped below), in its resting place.
    const lw = 360, lh = 540;
    for (let i = 0; i < count; i++) {
      B.level(i);
      const lv = window.PinsLevels.LEVELS[i];
      for (const p of lv.pins) {
        const { cv, g } = canvas(lw, lh, K_ART);
        B.draw(g, () => B.pin({ ...p, pulled: false }, 0, 1));
        res.pins.push({ level: i + 1, id: p.id, ...crop(cv) });
      }
    }

    // Figures: a 3×5-cell box (30×50 logical) with room for raised arms, the cape and the shadow.
    const FIG = { w: 56, h: 70, ox: 13, oy: 10 };
    const fig = (name, o) => {
      const { cv, g } = canvas(FIG.w, FIG.h, K_ART, FIG.ox, FIG.oy);
      B.draw(g, () => B.figure(0, 0, o));
      res.sprites[name] = png(cv);
    };
    const { HERO_LOOK, ENEMY_LOOK, BURNT, POISONED } = B.looks;
    for (const [face, tag] of [[1, 'r'], [-1, 'l']]) {
      fig(`hero_idle_${tag}`, { look: HERO_LOOK, face, mood: 'idle' });
      fig(`hero_cheer_${tag}`, { look: HERO_LOOK, face, mood: 'cheer' });
      fig(`hero_scared_${tag}`, { look: HERO_LOOK, face, mood: 'scared' });
      fig(`enemy_idle_${tag}`, { look: ENEMY_LOOK, face, mood: 'idle', enemy: true });
      fig(`enemy_cheer_${tag}`, { look: ENEMY_LOOK, face, mood: 'cheer', enemy: true });
      fig(`enemy_scared_${tag}`, { look: ENEMY_LOOK, face, mood: 'scared', enemy: true });
      for (let f = 0; f < 8; f++) {
        fig(`hero_walk_${tag}${f}`, { look: HERO_LOOK, face, walk: (f / 8) * Math.PI * 2, mood: 'idle' });
        fig(`enemy_walk_${tag}${f}`, { look: ENEMY_LOOK, face, walk: (f / 8) * Math.PI * 2, mood: 'idle', enemy: true });
      }
    }
    fig('hero_burnt', { look: BURNT, face: 1, mood: 'burnt' });
    fig('hero_poisoned', { look: POISONED, face: 1, mood: 'burnt' });
    fig('enemy_burnt', { look: BURNT, face: 1, mood: 'burnt', enemy: true });
    fig('enemy_poisoned', { look: POISONED, face: 1, mood: 'burnt', enemy: true });
    res.figure = FIG;

    // The 2×2 keg with room for its fuse and shadow.
    {
      const { cv, g } = canvas(32, 32, K_ART, 6, 8);
      B.draw(g, () => B.keg(0, 0, 20, 20));
      res.sprites.keg = png(cv);
      res.keg = { w: 32, h: 32, ox: 6, oy: 8 };
    }
    // The exit door, from shut to open, and a torch. A door's box is 3×5 cells; (0, 0) is its top left.
    B.level(0);
    B.place({ x: 0, y: 0, w: 3, h: 5 }, { x: -10, y: -10, w: 40, h: 40 });
    for (let f = 0; f <= 4; f++) {
      // big enough for the light that pours out of the open door to fade out inside the image
      const { cv, g } = canvas(120, 120, K_ART, 45, 40);
      B.draw(g, () => B.door(f / 4));
      res.sprites[`door${f}`] = png(cv);
    }
    res.door = { w: 120, h: 120, ox: 45, oy: 40 };
    {
      // the torch left of a door at x = 2 cells sits at x = 10 logical px, its flame at y = 6 (- 2)
      B.place({ x: 2, y: 0, w: 3, h: 5 }, { x: 0, y: -10, w: 2, h: 40 });
      const { cv, g } = canvas(80, 80, K_ART, 30, 34);
      B.draw(g, () => B.torches());
      res.sprites.torch = png(cv);
      res.torch = { w: 80, h: 80, ox: 30, oy: 34, x: -10, y: 6 };
    }
    // Coins, stone lumps, the sparkle: the sprites game.js builds for itself.
    for (const n of ['coin', 'coinTilt', 'stone0', 'stone1', 'stone2', 'sparkle']) res.sprites[n] = png(B.sprites[n]);
    return res;

    // The painted part of a canvas: its pixels and where they sit on the board (logical px).
    function crop(cv) {
      const g = cv.getContext('2d');
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        if (d[(y * cv.width + x) * 4 + 3] > 3) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      const out = document.createElement('canvas');
      out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
      out.getContext('2d').drawImage(cv, -x0, -y0);
      return { png: out.toDataURL('image/png'), x: x0 / K_ART, y: y0 / K_ART, w: out.width / K_ART, h: out.height / K_ART };
    }
  }, { count: L.LEVELS.length, K_BOARD, K_ART });
  // Sounds: each one alone in a silent offline context, 2.5 s long, as 16-bit mono WAV.
  await page.addScriptTag({ content: patchedAudio() });
  const sounds = await page.evaluate(async () => {
    const out = {};
    for (const name of window.PinsAudio.SOUND_NAMES) {
      const rate = 22050;
      const ctx = new OfflineAudioContext(1, rate * 2.5, rate);
      window.__renderSound(name, ctx);
      const buf = await ctx.startRendering();
      let data = buf.getChannelData(0);
      let end = data.length;
      while (end > 1 && Math.abs(data[end - 1]) < 1e-4) end--;
      data = data.subarray(0, Math.min(data.length, end + 200));
      const bytes = new DataView(new ArrayBuffer(44 + data.length * 2));
      const str = (o, t) => { for (let i = 0; i < t.length; i++) bytes.setUint8(o + i, t.charCodeAt(i)); };
      str(0, 'RIFF'); bytes.setUint32(4, 36 + data.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
      bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
      bytes.setUint32(24, rate, true); bytes.setUint32(28, rate * 2, true); bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true);
      str(36, 'data'); bytes.setUint32(40, data.length * 2, true);
      for (let i = 0; i < data.length; i++) bytes.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true);
      let bin = '';
      const u8 = new Uint8Array(bytes.buffer);
      for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode(...u8.subarray(i, i + 8192));
      out[name] = 'data:audio/wav;base64,' + btoa(bin);
    }
    return out;
  });
  await browser.close();

  const write = (rel, url) => {
    const file = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  };
  out.boards.forEach((url, i) => write(`boards/${i + 1}.webp`, url));
  const pins = {};
  for (const p of out.pins) {
    write(`pins/${p.level}-${p.id}.png`, p.png);
    pins[`${p.level}-${p.id}`] = { x: p.x, y: p.y, w: p.w, h: p.h };
  }
  for (const [name, url] of Object.entries(out.sprites)) write(`sprites/${name}.png`, url);
  for (const [name, url] of Object.entries(sounds)) write(`sounds/${name}.wav`, url);
  // Positions are logical px of the web board (one cell = 10 px); Godot scales them to its cell size.
  const art = { cell: 10, kBoard: K_BOARD, kArt: K_ART, figure: out.figure, keg: out.keg, door: out.door, torch: out.torch, pins };
  fs.writeFileSync(path.join(ROOT, 'godot/pins/data/art.json'), `${JSON.stringify(art, null, 1)}\n`);
  console.log(`baked ${out.boards.length} boards, ${out.pins.length} pins, ${Object.keys(out.sprites).length} sprites, ${Object.keys(sounds).length} sounds`);
}

main().catch((e) => { console.error(e); process.exit(1); });
