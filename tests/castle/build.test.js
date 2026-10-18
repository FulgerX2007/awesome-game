'use strict';
// «Последняя крепость» as shipped: the page's scripts exist, nothing is loaded from the network, every Russian
// string the client shows has a RO translation, and the game is on the hub.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', '..', 'web');
const DIR = path.join(WEB, 'castle');
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
  assert.deepEqual(srcs, ['../i18n.js', '../nav.js', '../fx.js', 'lang.js', 'core.js', 'view.js', 'audio.js', 'game.js']);
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

test('nothing in web/castle/ references the network but its own leaderboard', () => {
  const files = fs.readdirSync(DIR);
  assert.ok(files.length >= 7);
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /https?:\/\//, f);
    assert.doesNotMatch(src, /@import|url\(\s*['"]?(?!data:)/, `${f}: no external CSS resources`);
    assert.doesNotMatch(src, /['"`]\/\//, `${f}: no protocol-relative URLs`);
  }
  // the only network call: the same-origin leaderboard, by a root-absolute path (a relative one would resolve
  // under /castle/ and miss the API)
  const game = read('game.js');
  const fetches = [...game.matchAll(/fetch\(\s*([^,)]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(fetches, ['BOARD_URL']);
  assert.match(game, /const BOARD_URL = '\/api\/boards\/castle\/scores';/);
  for (const f of files.filter((x) => x !== 'game.js')) assert.doesNotMatch(read(f), /\bfetch\(|XMLHttpRequest|WebSocket/, f);
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
  assert.ok(keys.has('Волна {n}'));
  assert.ok(keys.has('Стена пала'));
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
  assert.ok(keys.has('Последняя крепость'));
  assert.ok(keys.has('Как играть'));
  assert.deepEqual([...keys].filter((k) => !hasRo(k)), []);
});

test('the hub has the «Последняя крепость» card and board, first among the ad games', () => {
  const hub = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(hub, /--castle: #d9a35b;/);
  const card = hub.match(/<a href="castle\/" style="--c: var\(--castle\)"><b>([^<]+)<\/b><span>([^<]+)<\/span><\/a>/);
  assert.ok(card, 'card');
  assert.equal(card[1], 'Последняя крепость');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(hub, new RegExp(`'${esc(card[1])}': 'Ultima cetate'`));
  assert.match(hub, new RegExp(`'${esc(card[2])}': '[^']+'`), 'the description has a RO string');
  const order = [...hub.matchAll(/<a href="([a-z]+)\/"/g)].map((m) => m[1]);
  assert.deepEqual(order.slice(0, 6), ['winter', 'castle', 'sort', 'parking', 'rush', 'pins'], 'the ad games come first, newest first');
  // the board list on the hub shows castle right after bastion, with the waves as detail
  const boards = [...hub.matchAll(/\{ id: '([a-z]+)', href:/g)].map((m) => m[1]);
  assert.equal(boards[boards.indexOf('bastion') + 1], 'castle');
  assert.match(hub, /id: 'castle', href: 'castle\/', name: 'Последняя крепость', color: 'var\(--castle\)', detail: \(e\) => I18n\.t\('волна \{n\}'/);
});

test('main.go keeps a castle board and main_test.go serves every castle file', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'main.go'), 'utf8');
  assert.match(main, /var boardGames = \[\]string\{[^}]*"castle"[^}]*\}/);
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'main_test.go'), 'utf8');
  for (const p of ['/castle/', '/castle/core.js', '/castle/view.js', '/castle/game.js', '/castle/lang.js', '/castle/audio.js']) {
    assert.ok(src.includes(`"${p}"`), p);
  }
});
