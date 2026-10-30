#!/usr/bin/env node
'use strict';
// Тяни штифт on Godot: copies the 42 levels and the Romanian dictionary from the web version (web/pins), so
// both versions share one source of truth. For every level it also stores what the grid solver of the web
// version says: the best winning pull order and a losing one. The Godot tests replay them with real physics.
//   node tools/pins-godot/data.cjs   ->  godot/pins/data/levels.json, godot/pins/data/pins.csv
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const OUT = path.join(ROOT, 'godot/pins/data');

// Strings that exist only in the Godot version.
const EXTRA_RO = {
  'Тяни штифт': 'Trage știftul',
  'Закрыть': 'Închide',
  '← Игры': '← Jocuri',
  'Клавиши: 1–5 штифты, R заново, H подсказка, F ускорение.': 'Taste: 1–5 știfturi, R de la capăt, H indiciu, F accelerare.',
  'Вода, лава, газ и золото здесь — настоящая физика: всё течёт, плещется и пересыпается.':
    'Apa, lava, gazul și aurul sunt aici fizică adevărată: totul curge, se varsă și se rostogolește.',
  'Лёгкая версия без Godot': 'Versiunea ușoară, fără Godot',
};

// Replays an order on the grid and returns its stars (0 = lost or not won).
function replay(C, def, order) {
  const s = C.buildLevel(def);
  C.settle(s);
  for (const id of order) {
    C.pull(s, id);
    C.settle(s);
  }
  return { stars: C.stars(s), status: C.status(s) };
}

function build() {
  const C = require(path.join(ROOT, 'web/pins/core.js'));
  const L = require(path.join(ROOT, 'web/pins/levels.js'));
  const levels = L.LEVELS.map((def, i) => {
    const sol = C.solve(def);
    const wins = sol.wins.map((order) => ({ order, stars: replay(C, def, order).stars }))
      .sort((a, b) => b.stars - a.stars || a.order.length - b.order.length);
    // the shortest losing orders: physics is kinder than the grid, a level just needs one of them to lose
    const losses = sol.losses.slice().sort((a, b) => a.length - b.length).slice(0, 6);
    return {
      n: i + 1,
      walls: def.walls, pins: def.pins, fills: def.fills, hero: def.hero, enemies: def.enemies || [],
      room: def.room, exit: def.exit, goldTarget: def.goldTarget,
      best: wins[0].order, bestStars: wins[0].stars, wins: wins.slice(0, 6).map((w) => w.order), losses,
    };
  });
  // The one-line lessons of the teaching levels live in game.js (const TIPS = {...}).
  const game = fs.readFileSync(path.join(ROOT, 'web/pins/game.js'), 'utf8');
  const tipsSrc = /const TIPS = (\{[\s\S]*?\});/.exec(game);
  if (!tipsSrc) throw new Error('game.js: TIPS not found, update data.cjs');
  const TIPS = Function(`return ${tipsSrc[1]}`)();
  const data = { W: C.W, H: C.H, CHAPTERS: L.CHAPTERS, TIPS, LEVELS: levels };

  let dict = null;
  globalThis.I18n = { add: (d) => { dict = Object.assign(dict || {}, d.ro); } };
  require(path.join(ROOT, 'web/pins/lang.js'));
  delete globalThis.I18n;
  const ro = { ...dict, ...EXTRA_RO };
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = ['keys,ru,ro'];
  for (const [ru, tr] of Object.entries(ro)) rows.push([q(ru), q(ru), q(tr)].join(','));
  // One level per line keeps the diff of a level change small.
  const json = `{"W":${data.W},"H":${data.H},"CHAPTERS":${JSON.stringify(data.CHAPTERS)},"TIPS":${JSON.stringify(TIPS)},"LEVELS":[\n${levels.map((l) => JSON.stringify(l)).join(',\n')}\n]}\n`;
  return { json, csv: `${rows.join('\n')}\n` };
}

if (require.main === module) {
  const { json, csv } = build();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'levels.json'), json);
  fs.writeFileSync(path.join(OUT, 'pins.csv'), csv);
  console.log('wrote godot/pins/data/levels.json and pins.csv');
}
module.exports = { build };
