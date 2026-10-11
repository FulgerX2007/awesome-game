'use strict';
// Shared i18n for all games. Russian is the source language: the Russian text itself is the key,
// so untranslated strings fall back to Russian. Dictionaries come from each game's lang.js via I18n.add().
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.I18n = factory(root);
})(typeof self !== 'undefined' ? self : this, (win) => {
  const LANGS = { ru: { name: 'Русский', short: 'RU', locale: 'ru-RU' }, ro: { name: 'Română', short: 'RO', locale: 'ro-RO' } };
  const KEY = 'lang';
  const dict = { ro: {} };
  const missing = new Set();

  function detect() {
    if (!win) return 'ru';
    try {
      const q = new URLSearchParams(win.location.search).get('lang');
      if (q && LANGS[q]) { try { win.localStorage.setItem(KEY, q); } catch { /* private mode */ } return q; }
    } catch { /* no location */ }
    try { const s = win.localStorage.getItem(KEY); if (s && LANGS[s]) return s; } catch { /* blocked storage */ }
    const nav = (win.navigator && (win.navigator.languages || [win.navigator.language])) || [];
    for (const l of nav) {
      const c = String(l).slice(0, 2).toLowerCase();
      if (c === 'ro' || c === 'mo') return 'ro';
      if (c === 'ru') return 'ru';
    }
    return 'ru';
  }
  let lang = detect();

  const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s);
  // t('Ещё {n} звёзд', { n }) — looks up the Russian text, then fills {placeholders}.
  function t(key, vars) {
    let s = key;
    if (lang !== 'ru') {
      const d = dict[lang];
      if (d && Object.prototype.hasOwnProperty.call(d, key)) s = d[key];
      else missing.add(key);
    }
    return fill(s, vars);
  }
  // Plural forms. Russian: 'звезда|звезды|звёзд'; Romanian: 'stea|stele|de stele' (1 / 0, 2–19 / 20+).
  function formIndex(n, l) {
    n = Math.abs(Math.floor(n));
    if (l === 'ro') {
      if (n === 1) return 0;
      const m = n % 100;
      return n === 0 || (m >= 1 && m <= 19) ? 1 : 2;
    }
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 0;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 1;
    return 2;
  }
  // p(5, 'звезда|звезды|звёзд') → 'звёзд' or 'de stele'.
  function p(n, forms) {
    const f = t(forms).split('|');
    return f[Math.min(formIndex(n, lang), f.length - 1)];
  }
  function add(d) {
    for (const l of Object.keys(d)) dict[l] = Object.assign(dict[l] || {}, d[l]);
  }

  // Translates static markup: text nodes whose trimmed text is a key, plus a few attributes.
  const ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];
  function translateDOM(rootEl) {
    if (!win || lang === 'ru') return;
    const doc = win.document;
    const node = rootEl || doc.documentElement;
    const d = dict[lang] || {};
    const walker = doc.createTreeWalker(node, 4 /* SHOW_TEXT */);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (const tn of texts) {
      const parent = tn.parentNode;
      if (parent && (parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE' || parent.closest('[data-i18n-skip]'))) continue;
      const raw = tn.nodeValue, key = raw.trim();
      if (!key || !/[А-Яа-яЁё]/.test(key)) continue;
      if (Object.prototype.hasOwnProperty.call(d, key)) tn.nodeValue = raw.replace(key, d[key]);
      else missing.add(key);
    }
    for (const el of node.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','))) {
      if (el.closest('[data-i18n-skip]')) continue;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v || !/[А-Яа-яЁё]/.test(v)) continue;
        if (Object.prototype.hasOwnProperty.call(d, v)) el.setAttribute(a, d[v]);
        else missing.add(v);
      }
    }
    if (doc.title && Object.prototype.hasOwnProperty.call(d, doc.title)) doc.title = d[doc.title];
  }

  function set(l) {
    if (!LANGS[l] || !win) return;
    let stored = false;
    try { win.localStorage.setItem(KEY, l); stored = win.localStorage.getItem(KEY) === l; } catch { /* blocked */ }
    const url = new URL(win.location.href);
    if (stored) { url.searchParams.delete('lang'); } else url.searchParams.set('lang', l);
    if (url.href === win.location.href) win.location.reload();
    else win.location.replace(url.href);
  }
  // A small button that switches to the other language (the page reloads; games keep their saves).
  function toggle(className) {
    const other = lang === 'ru' ? 'ro' : 'ru';
    const b = win.document.createElement('button');
    b.type = 'button';
    b.className = className || 'lang-toggle';
    b.textContent = LANGS[other].short;
    b.title = LANGS[other].name;
    b.setAttribute('aria-label', LANGS[other].name);
    b.setAttribute('lang', other);
    // Its label names the other language in that language, so the DOM pass must leave it alone.
    b.setAttribute('data-i18n-skip', '');
    b.addEventListener('click', () => set(other));
    return b;
  }

  if (win && win.document) {
    win.document.documentElement.lang = lang;
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', () => translateDOM());
  }

  return {
    get lang() { return lang; },
    get locale() { return LANGS[lang].locale; },
    LANGS, t, p, add, translateDOM, set, toggle, missing, formIndex,
    // For Node tests: switch language without a browser.
    _use(l) { if (LANGS[l]) lang = l; },
  };
});
