'use strict';
// «Цветные колбы» as shipped: the page's scripts exist, nothing is loaded from the network, every Russian
// string the client shows has a RO translation, and the game is on the hub.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', '..', 'web');
const DIR = path.join(WEB, 'sort');
const I18n = require(path.join(WEB, 'i18n.js'));
globalThis.I18n = I18n;
require(path.join(DIR, 'lang.js'));

const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const HTML = read('index.html');

// Looks a key up in the RO dictionary; I18n.t falls back to the key and records it in `missing`.
function hasRo(key) {
  I18n._use('ro');
  I18n.missing.clear();
  I18n.t(key);
  const ok = I18n.missing.size === 0;
  I18n._use('ru');
  return ok;
}

// Source without comment lines and trailing comments, so a comment can't hide or fake a string.
function code(src) {
  return src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\/\/[^'\n]*$/gm, '');
}

test('index.html loads the scripts in order and every one exists', () => {
  const srcs = [...HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, ['../i18n.js', '../nav.js', '../fx.js', 'lang.js', 'core.js', 'levels.js', 'view.js', 'audio.js', 'game.js']);
  for (const s of srcs) assert.ok(fs.existsSync(path.join(DIR, s)), s);
  for (const m of HTML.matchAll(/<link [^>]*href="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(DIR, m[1])), m[1]);
});

test('index.html uses only relative paths', () => {
  const refs = [...HTML.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0);
  for (const r of refs) {
    assert.ok(!/^[a-z]+:|^\/\//i.test(r), `no scheme or protocol-relative URL: ${r}`);
    assert.ok(!r.startsWith('/'), `no absolute path: ${r}`);
    assert.ok(!r.startsWith('../') || ['../i18n.js', '../nav.js', '../fx.js'].includes(r), `only shared hub scripts above the folder: ${r}`);
  }
  assert.doesNotMatch(HTML, /@import|url\(/, 'no CSS imports or url() in the page');
});

test('nothing in web/sort/ references the network', () => {
  const files = fs.readdirSync(DIR);
  assert.ok(files.length >= 8);
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /https?:\/\//, f);
    assert.doesNotMatch(src, /@import|url\(\s*['"]?(?!data:)/, `${f}: no external CSS resources`);
  }
});

test('every RO translation keeps the {…} placeholders of its Russian key', () => {
  const ro = {};
  require('node:vm').runInNewContext(read('lang.js'), { I18n: { add: (d) => Object.assign(ro, d.ro) } });
  const holes = (str) => [...str.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  assert.ok(Object.keys(ro).length > 20);
  assert.ok(Object.keys(ro).some((k) => holes(k).length > 0), 'some keys have placeholders');
  for (const [ru, value] of Object.entries(ro)) {
    assert.equal(typeof value, 'string', ru);
    assert.deepEqual(holes(value), holes(ru), `«${ru}» → «${value}»`);
  }
});

test('every Russian string passed to t( in game.js has a RO translation', () => {
  const src = code(read('game.js'));
  const keys = new Set();
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\\n]|\\.)*)'/g)) keys.add(m[1]);
  assert.ok(keys.has('Уровень {n}'));
  assert.ok(keys.has('Ходы: {n}'));
  assert.ok(keys.has('Пар: {n}'));
  assert.deepEqual([...keys].filter((k) => !hasRo(k)), []);
});

test('every Russian string literal in game.js has a RO translation (tips and titles reach t( indirectly)', () => {
  const src = code(read('game.js'));
  const keys = new Set();
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) if (/[А-Яа-яЁё]/.test(m[1])) keys.add(m[1]);
  assert.ok(keys.size > 15, String(keys.size));
  assert.deepEqual([...keys].filter((k) => !hasRo(k)), []);
});

test('every Russian string in index.html has a RO translation', () => {
  const html = HTML.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const keys = new Set();
  // Text between tags, the way I18n.translateDOM sees text nodes (trimmed).
  for (const m of html.matchAll(/>([^<]+)</g)) {
    const k = m[1].trim();
    if (k && /[А-Яа-яЁё]/.test(k)) keys.add(k);
  }
  for (const m of html.matchAll(/\b(?:aria-label|title|placeholder|alt|content)="([^"]+)"/g)) {
    if (/[А-Яа-яЁё]/.test(m[1])) keys.add(m[1]);
  }
  assert.ok(keys.has('Цветные колбы'));
  assert.ok(keys.has('Как играть'));
  assert.deepEqual([...keys].filter((k) => !hasRo(k)), []);
});

test('the hub has the «Цветные колбы» card with its colour and RO text, among the ad games at the top', () => {
  const hub = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(hub, /--sort: #c38bff;/);
  const card = hub.match(/<a href="sort\/" style="--c: var\(--sort\)"><b>([^<]+)<\/b><span>([^<]+)<\/span><\/a>/);
  assert.ok(card, 'card');
  assert.equal(card[1], 'Цветные колбы');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(hub, new RegExp(`'${esc(card[1])}': 'Eprubete colorate'`));
  assert.match(hub, new RegExp(`'${esc(card[2])}': '[^']+'`), 'the description has a RO string');
  const order = [...hub.matchAll(/<a href="([a-z]+)\/"/g)].map((m) => m[1]);
  assert.deepEqual(order.slice(0, 8), ['winter', 'front', 'hero', 'castle', 'sort', 'parking', 'rush', 'pins'], 'the ad games come first, newest first');
});

test('main_test.go serves every sort file', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'main_test.go'), 'utf8');
  for (const p of ['/sort/', '/sort/core.js', '/sort/levels.js', '/sort/view.js', '/sort/game.js', '/sort/lang.js', '/sort/audio.js']) {
    assert.ok(src.includes(`"${p}"`), p);
  }
});
