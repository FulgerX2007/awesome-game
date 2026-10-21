'use strict';
// RO translations for «Родник» and the client helper modules that must load in Node.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', '..', 'web');
const I18n = require(path.join(WEB, 'i18n.js'));
globalThis.I18n = I18n;
require(path.join(WEB, 'village', 'lang.js'));
const V = require(path.join(WEB, 'village', 'core.js'));

// Looks a key up in the RO dictionary; I18n.t falls back to the key and records it in `missing`.
function hasRo(key) {
  I18n._use('ro');
  I18n.missing.clear();
  I18n.t(key);
  const ok = I18n.missing.size === 0;
  I18n._use('ru');
  return ok;
}

test('every name from the core tables has a RO translation', () => {
  const tables = { RESOURCES: V.RESOURCES, NODE_KINDS: V.NODE_KINDS, TOOLS: V.TOOLS, BUILDINGS: V.BUILDINGS, VILLAGERS: V.VILLAGERS, DECOR: V.DECOR, FAIR: V.FAIR };
  const missing = [];
  for (const [table, rows] of Object.entries(tables)) {
    for (const [id, row] of Object.entries(rows)) {
      assert.equal(typeof row.name, 'string', `${table}.${id}.name`);
      if (!hasRo(row.name)) missing.push(`${table}.${id}: ${row.name}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('resources show their RO names', () => {
  I18n._use('ro');
  try {
    assert.equal(I18n.t(V.RESOURCES.wood.name), 'Lemn');
    assert.equal(I18n.t(V.RESOURCES.stone.name), 'Piatră');
  } finally {
    I18n._use('ru');
  }
});

test('every Russian string in index.html has a RO translation', () => {
  let html = fs.readFileSync(path.join(WEB, 'village', 'index.html'), 'utf8');
  html = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const keys = new Set();
  // Text between tags, the way I18n.translateDOM sees text nodes (trimmed).
  for (const m of html.matchAll(/>([^<]+)</g)) {
    const k = m[1].trim();
    if (k && /[А-Яа-яЁё]/.test(k)) keys.add(k);
  }
  for (const m of html.matchAll(/\b(?:aria-label|title|placeholder|alt|content)="([^"]+)"/g)) {
    if (/[А-Яа-яЁё]/.test(m[1])) keys.add(m[1]);
  }
  assert.ok(keys.has('Родник'));
  assert.ok(keys.has('Дерево'));
  const missing = [...keys].filter((k) => !hasRo(k));
  assert.deepEqual(missing, []);
});

test('index.html loads the scripts in order', () => {
  const html = fs.readFileSync(path.join(WEB, 'village', 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, ['../i18n.js', '../nav.js', '../fx.js', 'lang.js', 'core.js', 'view.js', 'audio.js', 'houses.js', 'art.js', 'game.js']);
  for (const s of srcs) assert.ok(fs.existsSync(path.join(WEB, 'village', s)), s);
});

test('index.html uses only relative paths and needs no network', () => {
  const html = fs.readFileSync(path.join(WEB, 'village', 'index.html'), 'utf8');
  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0);
  for (const r of refs) {
    assert.ok(!/^[a-z]+:|^\/\//i.test(r), `no scheme or protocol-relative URL: ${r}`);
    assert.ok(!r.startsWith('/'), `no absolute path: ${r}`);
    assert.ok(!r.startsWith('../') || ['../i18n.js', '../nav.js', '../fx.js'].includes(r), `only shared hub scripts above the folder: ${r}`);
  }
  const css = fs.readFileSync(path.join(WEB, 'village', 'style.css'), 'utf8');
  // The resource icons are inline SVGs (data URIs): they stay in the file, so they are the only url() allowed.
  const icons = css.match(/url\("data:image\/svg\+xml,[^"]*"\)/g) || [];
  assert.ok(icons.length >= 12, 'every resource has an inline icon');
  assert.doesNotMatch(html + css.replace(/url\("data:image\/svg\+xml,[^"]*"\)/g, ''), /@import|url\(|https?:/, 'no CSS imports, url() or links out of the page');
});

test('view.js and audio.js load in Node without errors', () => {
  const view = require(path.join(WEB, 'village', 'view.js'));
  assert.equal(typeof view, 'object');
  assert.ok(view.TILE > 0);
  const audio = require(path.join(WEB, 'village', 'audio.js'));
  assert.equal(typeof audio, 'object');
  // No AudioContext in Node: every call is a no-op and must not throw.
  assert.doesNotThrow(() => {
    audio.unlock();
    audio.play('axe');
    audio.setMusic(false);
    audio.setSounds(false);
  });
  assert.equal(audio.state.music, false);
  assert.equal(audio.state.sounds, false);
});

test('the hub lists «Родник» with a RO description', () => {
  const hub = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  // Newer games go in front of it, so only its card is checked, not its place.
  assert.match(hub, /<a href="village\/" style="--c: var\(--village\)"><b>Родник<\/b>/);
  assert.match(hub, /--village:/);
  assert.match(hub, /'Родник': 'Izvorul'/);
});

test('every Russian string in game.js has a RO translation', () => {
  const src = fs.readFileSync(path.join(WEB, 'village', 'game.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')  // skip comment lines
    .replace(/\/\/[^'\n]*$/gm, '');                             // and trailing comments
  const keys = new Set();
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
    if (/[А-Яа-яЁё]/.test(m[1])) keys.add(m[1]);
  }
  assert.ok(keys.has('Пока тебя не было…'));
  assert.ok(keys.has('Восстановить: {name}'));
  const missing = [...keys].filter((k) => !hasRo(k));
  assert.deepEqual(missing, []);
});

test('the drawing code has no untranslated Russian strings', () => {
  // The art draws with code only; any Russian text it ever shows must be in the RO dictionary too.
  for (const file of ['art.js', 'houses.js', 'view.js']) {
    const src = fs.readFileSync(path.join(WEB, 'village', file), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
      .replace(/\/\/[^'\n]*$/gm, '');
    const missing = [];
    for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
      if (/[А-Яа-яЁё]/.test(m[1]) && !hasRo(m[1])) missing.push(m[1]);
    }
    assert.deepEqual(missing, [], file);
  }
});

test('every villager role has a look in the art', () => {
  const src = fs.readFileSync(path.join(WEB, 'village', 'art.js'), 'utf8');
  const looks = src.slice(src.indexOf('const LOOKS = {'), src.indexOf('};', src.indexOf('const LOOKS = {')));
  for (const role of Object.keys(V.VILLAGERS)) assert.match(looks, new RegExp(`\\b${role}: \\{`), role);
});
