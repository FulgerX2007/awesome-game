'use strict';
// «Аншлаг» as shipped: the page's scripts exist, nothing is loaded from the network, every Russian string the
// player sees has a RO translation, and the game is on the hub and served by the Go server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const WEB = path.join(ROOT, 'web');
const DIR = path.join(WEB, 'beat');
const I18n = require(path.join(WEB, 'i18n.js'));
globalThis.I18n = I18n;
require(path.join(DIR, 'lang.js'));

const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const HTML = read('index.html');

function hasRo(key) {
  I18n._use('ro');
  I18n.missing.clear();
  I18n.t(key);
  const ok = I18n.missing.size === 0;
  I18n._use('ru');
  return ok;
}
// Source without comment lines and trailing comments, so a comment can't hide or fake a string.
const code = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\/\/[^'\n]*$/gm, '');
function russianLiterals(src) {
  const keys = new Set();
  for (const m of code(src).matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) if (/[А-Яа-яЁё]/.test(m[1])) keys.add(m[1]);
  return keys;
}

test('index.html loads the scripts in order and every one exists', () => {
  const srcs = [...HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, ['../i18n.js', '../nav.js', '../fx.js', 'lang.js', 'core.js', 'music.js', 'game.js']);
  for (const s of srcs) assert.ok(fs.existsSync(path.join(DIR, s)), s);
  for (const m of HTML.matchAll(/<link [^>]*href="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(DIR, m[1])), m[1]);
});

test('nothing in web/beat/ touches the network', () => {
  const refs = [...HTML.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const r of refs) {
    assert.ok(!/^[a-z]+:|^\/\//i.test(r), `no scheme or protocol-relative URL: ${r}`);
    assert.ok(!r.startsWith('/'), `no absolute path: ${r}`);
  }
  for (const f of fs.readdirSync(DIR)) {
    const src = read(f);
    assert.doesNotMatch(src, /https?:\/\//, f);
    assert.doesNotMatch(src, /@import|url\(\s*['"]?(?!data:)/, `${f}: no external CSS resources`);
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|WebSocket/, f);
  }
});

test('every RO translation keeps the {…} placeholders of its Russian key', () => {
  const ro = {};
  vm.runInNewContext(read('lang.js'), { I18n: { add: (d) => Object.assign(ro, d.ro) } });
  const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  assert.ok(Object.keys(ro).length > 40);
  for (const [ru, value] of Object.entries(ro)) {
    assert.equal(typeof value, 'string', ru);
    assert.deepEqual(holes(value), holes(ru), `«${ru}» → «${value}»`);
  }
});

test('every Russian string in game.js and core.js has a RO translation', () => {
  const keys = new Set([...russianLiterals(read('game.js')), ...russianLiterals(read('core.js'))]);
  assert.ok(keys.has('серия {n}'));
  assert.ok(keys.has('Саксофонист'));
  assert.deepEqual([...keys].filter((k) => !hasRo(k)), []);
});

test('every Russian string in index.html has a RO translation', () => {
  const html = HTML.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const keys = new Set();
  for (const m of html.matchAll(/>([^<]+)</g)) {
    const k = m[1].trim();
    if (k && /[А-Яа-яЁё]/.test(k)) {
      assert.doesNotMatch(k, /\n/, `a text node on one line, or translateDOM won't find it: ${k}`);
      keys.add(k);
    }
  }
  for (const m of html.matchAll(/\b(?:aria-label|title|placeholder|alt|content)="([^"]+)"/g)) if (/[А-Яа-яЁё]/.test(m[1])) keys.add(m[1]);
  assert.ok(keys.has('Аншлаг'));
  assert.ok(keys.has('Калибровка задержки'));
  assert.deepEqual([...keys].filter((k) => !hasRo(k)), []);
});

test('the hub has the «Аншлаг» card after the ad games, with RO text', () => {
  const hub = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(hub, /--beat: #[0-9a-f]{6};/);
  const card = hub.match(/<a href="beat\/" style="--c: var\(--beat\)"><b>([^<]+)<\/b><span>([^<]+)<\/span><\/a>/);
  assert.ok(card, 'card');
  assert.equal(card[1], 'Аншлаг');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(hub, new RegExp(`'${esc(card[1])}': 'Sală plină'`));
  assert.match(hub, new RegExp(`'${esc(card[2])}': '[^']+'`), 'the description has a RO string');
  const order = [...hub.matchAll(/<a href="([a-z-]+)\/"/g)].map((m) => m[1]);
  assert.deepEqual(order.slice(0, 6), ['winter', 'castle', 'sort', 'parking', 'rush', 'pins'], 'the ad games still come first');
  assert.equal(order[order.indexOf('pins-godot') + 1], 'beat');
});

test('main_test.go serves every beat file', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main_test.go'), 'utf8');
  for (const f of fs.readdirSync(DIR)) {
    const p = f === 'index.html' ? '/beat/' : `/beat/${f}`;
    assert.ok(src.includes(`"${p}"`), p);
  }
});
