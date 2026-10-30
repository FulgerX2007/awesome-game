#!/usr/bin/env node
'use strict';
// Глубина on Godot: copies the game data and the Romanian dictionary from the web version, so the two
// versions share one source of truth. Writes godot/deep/data/deep.json, godot/deep/data/deep.csv
// and copies the atlas cards (web/deep/art) to godot/deep/assets/art.
//   node tools/deep-godot/data.cjs
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const OUT = path.join(ROOT, 'godot/deep/data');

// Strings that exist only in the Godot version (the web page keeps them in HTML or does not need them).
const EXTRA_RO = {
  'Плыви за курсором или пальцем. Пробел, зажатая кнопка мыши или кнопка «рывок» — короткое ускорение.':
    'Înoată după cursor sau după deget. Space, butonul mouse-ului ținut apăsat sau butonul „țâșnire” îți dau un scurt avânt.',
  'Опасны только хищники крупнее тебя. Когда хищник тебя заметил, он светится красным. Погоня его утомляет.':
    'Periculoși sunt doar prădătorii mai mari decât tine. Când un prădător te-a observat, strălucește în roșu. Urmărirea îl obosește.',
  'Закрыть': 'Închide',
  'Атлас': 'Atlas',
  '← Игры': '← Jocuri',
  'Русский': 'Русский',
  'Română': 'Română',
};

function build() {
  const C = require(path.join(ROOT, 'web/deep/core.js'));
  const big = (v) => (Number.isFinite(v) ? v : 1e12);
  const data = {
    START_R: C.START_R, MAX_R: C.MAX_R, EAT_RATIO: C.EAT_RATIO, DASH_COOLDOWN: C.DASH_COOLDOWN,
    MAX_DEPTH: C.MAX_DEPTH, FLOOR_M: C.FLOOR_M,
    LEN_KNOTS: C.LEN_KNOTS,
    KINDS: C.KINDS.map((k) => ({ ...k, max: big(k.max) })),
    ZONES: C.ZONES,
    SPECIES: C.SPECIES.map((s) => ({ ...s, art: C.hasArt(s.id) })),
    STAGES: C.STAGES,
  };

  let dict = null;
  globalThis.I18n = { add: (d) => { dict = d.ro; } };
  require(path.join(ROOT, 'web/deep/lang.js'));
  delete globalThis.I18n;
  const ro = { ...dict, ...EXTRA_RO };
  // The fonts have the micro sign (U+00B5) but not the Greek mu (U+03BC); they look the same.
  for (const k of Object.keys(ro)) ro[k] = ro[k].replace(/\u03bc/g, '\u00b5');

  // Godot's CSV translation format: the key column, then one column per locale.
  // The key is the Russian text itself, like in web/i18n.js.
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = ['keys,ru,ro'];
  for (const [ru, tr] of Object.entries(ro)) rows.push([q(ru), q(ru), q(tr)].join(','));
  return { json: `${JSON.stringify(data, null, 1)}\n`, csv: `${rows.join('\n')}\n` };
}

if (require.main === module) {
  const { json, csv } = build();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'deep.json'), json);
  fs.writeFileSync(path.join(OUT, 'deep.csv'), csv);
  // The painted atlas cards: Godot can only load files inside its project.
  const ART = path.join(ROOT, 'godot/deep/assets/art');
  fs.mkdirSync(ART, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'web/deep/art'))) if (f.endsWith('.webp')) fs.copyFileSync(path.join(ROOT, 'web/deep/art', f), path.join(ART, f));
  console.log('wrote godot/deep/data/deep.json, deep.csv and assets/art');
}
module.exports = { build };
