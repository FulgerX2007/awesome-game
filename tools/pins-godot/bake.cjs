#!/usr/bin/env node
'use strict';
// Тяни штифт on Godot: bakes the parts of web/pins/game.js the Godot version still uses: the goblins in all
// their poses, the keg and the stone lumps (the dungeon, pins, gold, hero, door and torch now come from the
// style reference, see slice.py). game.js keeps its drawing functions to itself; the bake serves a copy that
// hands them out (window.__bake) to a headless page. Nothing in web/ changes.
// The sounds of web/pins/audio.js are rendered the same way, through an OfflineAudioContext, into WAV files.
//   node tools/pins-godot/bake.cjs
// Writes godot/pins/assets/{sprites,sounds}/ and godot/pins/data/art.json.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../..');
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, 'godot/pins/assets');
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

  const out = await page.evaluate(({ K_ART }) => {
    const B = window.__bake;
    const png = (cv) => cv.toDataURL('image/png');
    // A canvas in logical px (lw×lh) at k device px per logical px, with (ox, oy) as the logical origin.
    const canvas = (lw, lh, k, ox = 0, oy = 0) => {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(lw * k); cv.height = Math.ceil(lh * k);
      const g = cv.getContext('2d');
      g.setTransform(k, 0, 0, k, ox * k, oy * k);
      return { cv, g };
    };
    const res = { sprites: {} };

    B.setTime(0);
    B.setK(K_ART);
    // Figures: a 3×5-cell box (30×50 logical) with room for raised arms, the cape and the shadow.
    const FIG = { w: 56, h: 70, ox: 13, oy: 10 };
    const fig = (name, o) => {
      const { cv, g } = canvas(FIG.w, FIG.h, K_ART, FIG.ox, FIG.oy);
      B.draw(g, () => B.figure(0, 0, o));
      res.sprites[name] = png(cv);
    };
    const { ENEMY_LOOK, BURNT, POISONED } = B.looks;
    for (const [face, tag] of [[1, 'r'], [-1, 'l']]) {
      fig(`enemy_idle_${tag}`, { look: ENEMY_LOOK, face, mood: 'idle', enemy: true });
      fig(`enemy_cheer_${tag}`, { look: ENEMY_LOOK, face, mood: 'cheer', enemy: true });
      fig(`enemy_scared_${tag}`, { look: ENEMY_LOOK, face, mood: 'scared', enemy: true });
    }
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
    // Coins, stone lumps, the sparkle: the sprites game.js builds for itself.
    for (const n of ['stone0', 'stone1', 'stone2']) res.sprites[n] = png(B.sprites[n]);
    return res;
  }, { K_ART });
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
  for (const [name, url] of Object.entries(out.sprites)) write(`sprites/${name}.png`, url);
  for (const [name, url] of Object.entries(sounds)) write(`sounds/${name}.wav`, url);
  // Positions are logical px of the web board (one cell = 10 px); Godot scales them to its cell size.
  const art = { cell: 10, kArt: K_ART, figure: out.figure, keg: out.keg };
  fs.writeFileSync(path.join(ROOT, 'godot/pins/data/art.json'), `${JSON.stringify(art, null, 1)}\n`);
  console.log(`baked ${Object.keys(out.sprites).length} sprites, ${Object.keys(sounds).length} sounds`);
}

main().catch((e) => { console.error(e); process.exit(1); });
