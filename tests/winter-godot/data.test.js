'use strict';
// Долгая зима on Godot (godot/winter): the data it ships (balance, items, recipes, buildings, survivors, RU/RO)
// must match the web version it was built from. When this fails, run `node tools/winter-godot/data.cjs`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, OUT } = require('../../tools/winter-godot/data.cjs');
const C = require('../../web/winter/core.js');

test('godot/winter/data is what tools/winter-godot/data.cjs builds from web/winter', () => {
  const files = build();
  assert.deepEqual(Object.keys(files).sort(), ['balance.tres', 'buildings.tres', 'items.tres', 'recipes.tres', 'survivors.tres', 'winter.csv']);
  for (const [name, text] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(OUT, name), 'utf8'), text, `data/${name} is stale`);
  }
});

test('the resources carry every cost and table of the rules', () => {
  const files = build();
  for (const id of Object.keys(C.TOOLS)) assert.match(files['recipes.tres'], new RegExp(`id = "${id}"`));
  for (const id of C.GEAR_IDS) assert.match(files['recipes.tres'], new RegExp(`id = "${id}"`));
  for (const id of C.UPGRADE_IDS) assert.match(files['buildings.tres'], new RegExp(`id = "${id}"`));
  for (const s of C.HUT_STAGES) assert.match(files['buildings.tres'], new RegExp(`id = "${s.id}"`));
  for (const id of C.ITEMS) assert.match(files['items.tres'], new RegExp(`id = "${id}"`));
  for (const id of C.SURVIVOR_IDS) assert.match(files['survivors.tres'], new RegExp(`id = "${id}"`));
  assert.match(files['balance.tres'], /^trades = \[/m);
  assert.match(files['balance.tres'], /^bear = \{/m);
});

test('the RU/RO table holds every hint the rules give and the game\'s title', () => {
  const csv = build()['winter.csv'];
  assert.ok(csv.startsWith('keys,ru,ro\n'));
  for (const t of C.TASK_TEXTS) assert.ok(csv.includes(`"${t}"`), t);
  assert.ok(csv.includes('"Долгая зима","Долгая зима","Iarna lungă"'));
});
