'use strict';
// Долгая зима on Godot (godot/winter): the web export, the hub card, the asset contract and the UI's translations.
// When the export test fails, run tools/winter-godot/build.sh.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const GODOT = path.join(ROOT, 'godot/winter');
const WEB = path.join(ROOT, 'web/winter-godot');

// A minimal CSV reader for the translation tables (quoted fields, doubled quotes).
function readCsv(file) {
  const rows = [];
  const text = fs.readFileSync(file, 'utf8');
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const res = (p) => path.join(GODOT, p.replace('res://', ''));

test('the web export is in place: our loading page and the game pack; the engine is shared', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(html, /Разводим костёр/, 'index.html comes from godot/winter/shell.html');
  assert.match(html, /\.\.\/godot\/engine\.js/, 'the page loads the shared engine');
  assert.match(html, /href="\.\.\/winter\/"/, 'a link to the light version');
  assert.ok(fs.statSync(path.join(WEB, 'index.pck')).size > 1e6);
  assert.deepEqual(fs.readdirSync(WEB).sort(), ['index.html', 'index.pck'], 'only the page and the pack: the engine lives in web/godot');
});

test('the hub has the card, right after the web version, with a RO title and description', () => {
  const hub = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
  const card = hub.match(/<a href="winter-godot\/" style="--c: var\(--winter\)"><b>([^<]+)<\/b><span>([^<]+)<\/span><\/a>/);
  assert.ok(card, 'card');
  assert.ok(hub.indexOf('href="winter/"') < hub.indexOf('href="winter-godot/"'));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(hub, new RegExp(`'${esc(card[1])}': '[^']+'`));
  assert.match(hub, new RegExp(`'${esc(card[2])}': '[^']+'`));
  const go = fs.readFileSync(path.join(ROOT, 'main_test.go'), 'utf8');
  assert.match(go, /"\/winter-godot\/", "\/winter-godot\/index\.pck"/);
});

test('every key of the asset contract exists and its files are on disk', () => {
  const m = {};
  const dir = path.join(GODOT, 'assets/manifest');
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) Object.assign(m, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const contract = fs.readFileSync(path.join(ROOT, 'tools/winter-godot/ASSETS.md'), 'utf8');
  // keys in backticks like `tree.pine.0`…`tree.pine.5` or `rock.0`…`3`, single ones like `bench`
  const want = new Set();
  for (const line of contract.split('\n')) {
    if (!line.startsWith('|') && !line.startsWith('- `') && !line.startsWith('`fx')) continue;
    for (const r of line.matchAll(/`([a-z][\w.]*?)\.(\d)`…`(?:[\w.]*\.)?(\d)`/g)) for (let k = +r[2]; k <= +r[3]; k++) want.add(`${r[1]}.${k}`);
  }
  for (const k of ['hut.0', 'hut.4', 'palisade.gate', 'firepit', 'torch', 'char.hero', 'char.villager', 'animal.wolf', 'animal.bear', 'fx.flame', 'fx.light', 'ui.panel', 'ui.icon.stamina', 'ui.title']) want.add(k);
  for (const k of want) assert.ok(m[k], `manifest key ${k}`);
  for (const [k, e] of Object.entries(m)) {
    for (const f of [e.file, e.sheet, e.normal, e.shadow && e.shadow.file, e.layers && e.layers.tint]) {
      if (f) assert.ok(fs.existsSync(res(f)), `${k}: ${f}`);
    }
  }
  for (const id of ['idle', 'run', 'bite', 'hurt', 'death']) assert.ok(Object.keys(m['animal.wolf'].anims).some((a) => a.startsWith(id)), `wolf ${id}`);
  // the painted hero (tools/winter-godot/import_art.py) is drawn from one side; the game mirrors it
  for (const id of ['idle', 'walk', 'chop', 'mine', 'gather', 'build', 'craft', 'fire']) assert.ok(m['char.hero'].anims[`${id}_side`], `hero ${id}_side`);
  for (const sv of ['hunter', 'carpenter', 'herbalist', 'smith', 'child']) {
    for (const id of ['idle', 'walk', 'work']) assert.ok(m[`char.sv.${sv}`] && m[`char.sv.${sv}`].anims[`${id}_side`], `survivor ${sv} ${id}`);
  }
  for (const id of ['chop', 'mine']) {
    const a = m['char.hero'].anims[`${id}_side`];
    assert.ok(Number.isInteger(a.impact) && a.impact > 0 && a.impact < a.count, `hero ${id}: the frame of the blow`);
  }
});

test('every string the Godot UI translates has a Romanian translation', () => {
  const table = new Map();
  for (const f of ['data/winter.csv', 'data/ui.csv']) for (const [k, , ro] of readCsv(path.join(GODOT, f)).slice(1)) if (k) table.set(k, ro);
  const missing = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(GODOT, 'scripts')).filter((f) => f.endsWith('.gd') && !f.includes('/sim/'))) {
    const src = fs.readFileSync(f, 'utf8');
    const keys = [...src.matchAll(/tr\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => m[1]);
    // the tables of names the UI passes through tr()
    for (const m of src.matchAll(/const [A-Z_]+ := \{([\s\S]*?)\n\}/g)) for (const v of m[1].matchAll(/:\s*"([^"]*[А-Яа-яЁё][^"]*)"/g)) keys.push(v[1]);
    for (const m of src.matchAll(/const [A-Z_]+ := \[([\s\S]*?)\n?\]/g)) for (const v of m[1].matchAll(/"([^"]*[А-Яа-яЁё][^"]*)"/g)) keys.push(v[1]);
    for (const k of keys) if (/[А-Яа-яЁё]/.test(k) && !(table.get(k) || '').trim()) missing.push(`${path.basename(f)}: ${k}`);
  }
  assert.deepEqual([...new Set(missing)], []);
});
