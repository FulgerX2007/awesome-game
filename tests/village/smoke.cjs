'use strict';
// E2E smoke test for «Родник» (/village/) in Chromium. Not part of `node --test`:
//   node tests/village/smoke.cjs
// Needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium); with a global
// install, point NODE_PATH at the global modules, e.g. NODE_PATH="$(npm root -g)" node tests/village/smoke.cjs.
// PW_CHROMIUM=/path/to/chromium picks a specific browser binary instead of Playwright's own.
// Starts the Go server on :18080 with in-memory storage, drives the page through real input
// (keyboard, taps) and reads state only from the DOM and localStorage. Exits non-zero on failure
// and always stops the server.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 18080;
const BASE = `http://127.0.0.1:${PORT}`;
// Optional: a Chromium binary to use instead of Playwright's own browser.
const CHROMIUM = process.env.PW_CHROMIUM;
const SAVE_KEY = 'village.save';

let server = null;
let browser = null;
const failures = [];

function check(ok, name, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, stepMs = 100) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(stepMs);
  }
}

// `go run` forks the compiled binary, so the server runs in its own process group and the whole
// group is killed at the end.
function startServer() {
  server = spawn('go', ['run', '.', '-addr', `:${PORT}`, '-data', ''], {
    cwd: ROOT, detached: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let log = '';
  server.stderr.on('data', (d) => { log += d; });
  server.on('exit', (code) => { if (code) console.error(`server exited with ${code}\n${log}`); });
}

function stopServer() {
  if (!server || server.exitCode !== null) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
  try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already gone */ }
}

async function healthy() {
  try { return (await fetch(`${BASE}/healthz`)).ok; } catch { return false; }
}

// Fonts come from Google; the test stays offline by answering those requests with empty bodies.
async function newPage(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The Go server has no /favicon.ico; every game logs this 404.
    if (/\/favicon\.ico$/.test(m.location().url || '')) return;
    errors.push(`console: ${m.text()} (${m.location().url || ''})`);
  });
  return { ctx, page, errors };
}

// game.js saves on pagehide; firing the event flushes the current state without a test hook.
async function readSave(page) {
  return page.evaluate((key) => {
    window.dispatchEvent(new Event('pagehide'));
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, SAVE_KEY);
}

async function canvasFilled(page) {
  return page.evaluate(() => {
    const c = document.getElementById('scene');
    if (!c || !c.width || !c.height) return { ok: false, why: 'no size' };
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    let opaque = 0, sum = 0, sum2 = 0;
    const step = 4 * 97;
    for (let i = 0; i < d.length; i += step) {
      if (d[i + 3] > 0) opaque++;
      colors.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4));
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += lum; sum2 += lum * lum;
    }
    const samples = Math.ceil(d.length / step);
    // The spread of brightness: lit faces and shadows make a 2.5D frame far from flat.
    const spread = Math.sqrt(Math.max(0, sum2 / samples - (sum / samples) ** 2));
    return { ok: opaque / samples > 0.95 && colors.size > 20, opaque: opaque / samples, colors: colors.size, spread: +spread.toFixed(1), mean: +(sum / samples).toFixed(1) };
  });
}

// The nearest standing tree to the player that is inside the canvas, in page (client) coordinates.
// A save object built by core.js in a throwaway page; `make` runs in the page and returns it.
async function coreSave(make) {
  const { ctx, page } = await newPage({ width: 800, height: 600 });
  await page.goto(`${BASE}/village/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Village);
  const save = await page.evaluate(make);
  await ctx.close();
  return save;
}

async function nearestTreePoint(page, save) {
  return page.evaluate((s) => {
    const VV = window.VillageView;
    const V = window.Village;
    const c = document.getElementById('scene').getBoundingClientRect();
    const T = VV.TILE;
    const cam = VV.clampCamera(s.player.x * T, s.player.y * T, Math.round(c.width), Math.round(c.height), V.W * T, V.H * T);
    let best = null;
    for (const n of s.nodes) {
      if (n.kind !== 'tree' || n.hp <= 0) continue;
      const sx = (n.x + 0.5) * T - cam.x;
      const sy = (n.y + 0.5) * T - cam.y;
      if (sx < T || sy < T || sx > c.width - T || sy > c.height - T) continue;
      const d = Math.hypot(n.x + 0.5 - s.player.x, n.y + 0.5 - s.player.y);
      if (!best || d < best.d) best = { d, x: c.left + sx, y: c.top + sy, id: n.id };
    }
    return best;
  }, save);
}

async function desktopChecks() {
  const { ctx, page, errors } = await newPage({ width: 1280, height: 900 });
  await page.goto(`${BASE}/village/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Village && window.VillageView && document.getElementById('scene').width > 1);
  await sleep(800); // a few frames

  const fill = await canvasFilled(page);
  check(fill.ok, 'canvas is drawn', JSON.stringify(fill));
  check(fill.spread > 12, 'the frame has light and shade (not flat)', JSON.stringify(fill));

  const saved = await waitFor(() => page.evaluate((k) => localStorage.getItem(k), SAVE_KEY), 3000);
  check(!!saved, 'save is in localStorage');

  const before = await readSave(page);
  await page.keyboard.down('KeyD');
  await sleep(600);
  await page.keyboard.up('KeyD');
  await sleep(200);
  const after = await readSave(page);
  check(before && after && after.player.x > before.player.x + 0.5,
    'D moves the player right', `${before && before.player.x} -> ${after && after.player.x}`);

  const wood0 = Number(await page.textContent('#r-wood'));
  const tree = await nearestTreePoint(page, after);
  check(!!tree, 'a tree is on screen');
  if (tree) {
    await page.mouse.click(tree.x, tree.y);
    const got = await waitFor(async () => Number(await page.textContent('#r-wood')) > wood0, 10000, 200);
    check(got, 'tapping the nearest tree adds wood within 10 s', `tree ${tree.id} at ${tree.d.toFixed(1)} tiles`);
    const s = await readSave(page);
    check(s && s.res && s.res.wood > 0, 'gathered wood is saved', JSON.stringify(s && s.res));
  }

  check(errors.length === 0, 'no console errors (desktop)', errors.join('\n'));
  await ctx.close();
}

async function roPhoneChecks() {
  // The phone view shows only a few tiles, so the game starts next to a tree (a save made by core).
  const near = await coreSave(() => {
    const V = window.Village;
    const s = V.newGame(7);
    const n = s.nodes.find((o) => o.kind === 'tree' && V.isWalkable(s, o.x + 1, o.y));
    s.player.x = n.x + 1.5;
    s.player.y = n.y + 0.5;
    return V.save(s);
  });
  const { ctx, page, errors } = await newPage({ width: 390, height: 844 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await ctx.addInitScript(({ key, raw }) => {
    if (!sessionStorage.getItem('prepared')) { localStorage.setItem(key, raw); sessionStorage.setItem('prepared', '1'); }
  }, { key: SAVE_KEY, raw: JSON.stringify(near) });
  await page.goto(`${BASE}/village/?lang=ro`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Village && document.getElementById('scene').width > 1);
  await sleep(500);

  const label = (await page.textContent('.res-item[data-res="wood"] dt')).trim();
  check(label === 'Lemn', 'HUD shows Lemn in RO', JSON.stringify(label));

  for (const id of ['btn-buildings', 'btn-tools', 'btn-settings']) {
    await page.click(`#${id}`);
    await sleep(250);
    const panel = await page.evaluate((b) => {
      const p = document.getElementById(document.getElementById(b).getAttribute('aria-controls'));
      return !!p && !p.hidden;
    }, id);
    check(panel, `${id} opens its panel`);
    await page.keyboard.press('Escape');
    await sleep(150);
  }
  const missing = await page.evaluate(() => [...window.I18n.missing]);
  check(missing.length === 0, 'I18n.missing is empty after opening the panels', missing.join(' | '));

  const fit = await page.evaluate(() => {
    const doc = document.documentElement;
    const res = document.getElementById('res').getBoundingClientRect();
    const top = document.querySelector('header.top').getBoundingClientRect();
    return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, resL: res.left, resR: res.right, topR: top.right, vw: window.innerWidth };
  });
  check(fit.scrollW <= fit.clientW, 'no horizontal scroll at 390×844', JSON.stringify(fit));
  check(fit.resL >= 0 && fit.resR <= fit.vw && fit.topR <= fit.vw, 'HUD fits the phone screen', JSON.stringify(fit));

  const fill = await canvasFilled(page);
  check(fill.ok, 'canvas is drawn (phone)', JSON.stringify(fill));

  // Touch path: a tap on the nearest tree walks there and gathers; the action button works too.
  const wood0 = Number(await page.textContent('#r-wood'));
  const tree = await nearestTreePoint(page, await readSave(page));
  check(!!tree, 'a tree is on screen (phone)');
  if (tree) {
    await page.touchscreen.tap(tree.x, tree.y);
    const got = await waitFor(async () => Number(await page.textContent('#r-wood')) > wood0, 10000, 200);
    check(got, 'tapping the nearest tree adds wood (phone)', `tree ${tree.id} at ${tree.d.toFixed(1)} tiles`);
  }
  await page.tap('#btn-act');
  await sleep(300);
  check(errors.length === 0, 'no console errors (phone, RO)', errors.join('\n'));
  await ctx.close();
}

// A page whose localStorage is prepared before game.js runs. `setup` runs in the page as an init script.
async function preparedPage(setup, arg) {
  const p = await newPage({ width: 1280, height: 900 });
  await p.ctx.addInitScript(setup, arg);
  await p.page.goto(`${BASE}/village/`, { waitUntil: 'load' });
  await p.page.waitForFunction(() => window.Village && document.getElementById('scene').width > 1);
  await sleep(300);
  return p;
}


const modalText = (page) => page.evaluate(() => {
  const m = document.getElementById('modal');
  return m && !m.hidden ? m.textContent : '';
});

// Error paths and the time-away window: broken save, blocked storage, >30 s and >8 h away, hidden tab.
async function edgeChecks() {
  {
    const { ctx, page, errors } = await preparedPage((key) => {
      if (!sessionStorage.getItem('prepared')) { localStorage.setItem(key, '{oops'); sessionStorage.setItem('prepared', '1'); }
    }, SAVE_KEY);
    const kept = await page.evaluate((k) => localStorage.getItem(`${k}.broken`), SAVE_KEY);
    check(kept === '{oops', 'a broken save is kept aside in village.save.broken', JSON.stringify(kept));
    const toast = await page.textContent('#toast');
    check(/повреждено/.test(toast || ''), 'a broken save shows a toast', JSON.stringify(toast));
    const fresh = await readSave(page);
    const version = await page.evaluate(() => window.Village.VERSION);
    check(fresh && fresh.v === version, 'a new village is saved over the broken one');
    check(errors.length === 0, 'no console errors (broken save)', errors.join('\n'));
    await ctx.close();
  }
  {
    // The same village at noon and at night: the night frame is clearly darker.
    const V = require('../../web/village/core.js');
    const at = (phase) => { const s = V.newGame(11); s.t = V.DAY * 4 + V.DAY * phase; return JSON.stringify({ ...V.save(s), savedAt: Date.now() }); };
    const mean = {};
    for (const [name, phase] of [['noon', 0.4], ['night', 0.92]]) {
      const { ctx, page, errors } = await preparedPage(([key, data]) => {
        if (!sessionStorage.getItem('prepared')) { localStorage.setItem(key, data); sessionStorage.setItem('prepared', '1'); }
      }, [SAVE_KEY, at(phase)]);
      mean[name] = (await canvasFilled(page)).mean;
      check(errors.length === 0, `no console errors (${name})`, errors.join('\n'));
      await ctx.close();
    }
    check(mean.night < mean.noon * 0.75, 'the night frame is darker than noon', JSON.stringify(mean));
  }
  {
    // A village from version 1 with a cloud code: kept aside, the code forgotten, a friendly toast.
    const old = JSON.stringify({ v: 1, seed: 5, t: 100, res: { wood: 40 } });
    const { ctx, page, errors } = await preparedPage(([key, data]) => {
      if (!sessionStorage.getItem('prepared')) {
        localStorage.setItem(key, data);
        localStorage.setItem('village.cloud', 'abcdabcdabcdabcd');
        sessionStorage.setItem('prepared', '1');
      }
    }, [SAVE_KEY, old]);
    const kept = await page.evaluate((k) => localStorage.getItem(`${k}.v1`), SAVE_KEY);
    check(kept === old, 'an old save is kept aside in village.save.v1', JSON.stringify(kept));
    const code = await page.evaluate(() => localStorage.getItem('village.cloud'));
    check(code === null, 'the old cloud code is forgotten', JSON.stringify(code));
    const toast = await page.textContent('#toast');
    check(/Новая версия/.test(toast || ''), 'an old save shows the new-version toast', JSON.stringify(toast));
    check(!(await page.evaluate((k) => localStorage.getItem(`${k}.broken`), SAVE_KEY)), 'an old save is not called broken');
    check(errors.length === 0, 'no console errors (old save)', errors.join('\n'));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await preparedPage(() => {
      Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
    });
    const status = await page.textContent('#save-status');
    check(/браузер не даёт сохранять/.test(status || ''), 'blocked storage is reported in settings', JSON.stringify(status));
    check(errors.length === 0, 'no console errors (storage full)', errors.join('\n'));
    await ctx.close();
  }
  // A woodcutter at work and nothing in stock.
  const base = await coreSave(() => {
    const V = window.Village;
    const s = V.newGame(7);
    for (const id of ['home', 'bridge', 'sawmill', 'kiln', 'house1']) s.built[id].done = true;
    return V.save(V.load(V.save(s)));
  });
  for (const [away, note] of [[120, false], [9 * 3600, true]]) {
    const { ctx, page, errors } = await preparedPage(({ key, raw }) => {
      if (sessionStorage.getItem('prepared')) return;
      const data = JSON.parse(raw);
      data.savedAt = Date.now() - data.away * 1000;
      delete data.away;
      localStorage.setItem(key, JSON.stringify(data));
      sessionStorage.setItem('prepared', '1');
    }, { key: SAVE_KEY, raw: JSON.stringify({ ...base, away }) });
    const text = await modalText(page);
    check(/Пока тебя не было/.test(text), `the time-away window opens after ${away} s`, JSON.stringify(text));
    check(/Дерево/.test(text), `the window lists the woodcutter's wood (${away} s)`, JSON.stringify(text));
    check(/дольше 8 ч /.test(text) === note, `the 8 h note is ${note ? 'shown' : 'absent'} (${away} s)`, JSON.stringify(text));
    check(errors.length === 0, `no console errors (${away} s away)`, errors.join('\n'));
    await ctx.close();
  }
  {
    // A hidden tab keeps the moment it was hidden as savedAt, so closing it there loses no time away.
    const { ctx, page, errors } = await preparedPage(() => {});
    const r = await page.evaluate(async (key) => {
      let state = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      const t0 = Date.now();
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((res) => setTimeout(res, 1500));
      window.dispatchEvent(new Event('pagehide'));
      const hidden = JSON.parse(localStorage.getItem(key)).savedAt;
      state = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      const shown = JSON.parse(localStorage.getItem(key)).savedAt;
      return { t0, hidden, shown };
    }, SAVE_KEY);
    check(r.hidden >= r.t0 && r.hidden < r.t0 + 500, 'a save while hidden keeps the hide time', JSON.stringify(r));
    check(r.shown >= r.t0 + 1400, 'back to visible, savedAt is current again', JSON.stringify(r));
    check(errors.length === 0, 'no console errors (hidden tab)', errors.join('\n'));
    await ctx.close();
  }
  {
    // A hidden tab writes once on hiding and then stays quiet: no autosaves, no pagehide save, no cloud PUTs.
    // Timers run 100x faster here so the 10 s save and 60 s cloud intervals fire within the test.
    const { ctx, page, errors } = await preparedPage((cloudKey) => {
      const si = window.setInterval;
      window.setInterval = (fn, ms, ...rest) => si(fn, Math.max(10, (ms || 0) / 100), ...rest);
      window.__writes = 0;
      window.__puts = 0;
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'village.save') window.__writes++; return set.call(this, k, v); };
      const f = window.fetch;
      window.fetch = (url, opts) => { if (opts && opts.method === 'PUT') window.__puts++; return f(url, opts); };
      localStorage.setItem(cloudKey, 'abcdefghjkmnpqrs');
    }, 'village.cloud');
    await sleep(1500);
    const visible = await page.evaluate(() => ({ writes: window.__writes, puts: window.__puts }));
    check(visible.writes > 2 && visible.puts > 0, 'a visible tab autosaves locally and to the cloud', JSON.stringify(visible));
    const r = await page.evaluate(async () => {
      let state = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
      const before = { writes: window.__writes, puts: window.__puts };
      await new Promise((res) => setTimeout(res, 1500));
      window.dispatchEvent(new Event('pagehide'));
      const after = { writes: window.__writes, puts: window.__puts };
      state = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((res) => setTimeout(res, 1000));
      return { before, after, back: { writes: window.__writes, puts: window.__puts } };
    });
    check(r.after.writes === r.before.writes, 'no localStorage writes while hidden (interval, pagehide)', JSON.stringify(r));
    check(r.after.puts === r.before.puts, 'no cloud PUTs while hidden', JSON.stringify(r));
    check(r.back.writes > r.after.writes && r.back.puts > r.after.puts, 'saving resumes once visible again', JSON.stringify(r));
    check(errors.length === 0, 'no console errors (quiet hidden tab)', errors.join('\n'));
    await ctx.close();
  }
  {
    // Tab A goes to the background, the village is played on in another tab; A coming back picks up that
    // newer save instead of writing its stale state over it.
    const { ctx, page, errors } = await preparedPage(() => {});
    const r = await page.evaluate(async (key) => {
      let state = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
      const other = JSON.parse(localStorage.getItem(key));
      other.res.wood = 77;
      other.savedAt = Date.now();
      other.writtenAt = Date.now() + 1;
      localStorage.setItem(key, JSON.stringify(other));
      state = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((res) => setTimeout(res, 300));
      return {
        hud: document.getElementById('r-wood').textContent,
        stored: JSON.parse(localStorage.getItem(key)).res.wood,
        toast: document.getElementById('toast').textContent,
      };
    }, SAVE_KEY);
    check(r.stored === 77 && Number(r.hud) === 77, 'a returning tab keeps the newer save from another tab', JSON.stringify(r));
    check(/другой вкладки/.test(r.toast), 'a returning tab says it took the other tab\'s save', JSON.stringify(r));
    check(errors.length === 0, 'no console errors (stale tab)', errors.join('\n'));
    await ctx.close();
  }
  {
    // Tab A has cloud code X and goes to the background; another tab loads cloud code Y and saves.
    // A adopts that save, so it must take code Y too: no PUT of village Y to code X, panel shows Y.
    const X = 'abcdefghjkmnpqrs';
    const Y = 'zyxwvutsrqpnmkjh';
    const { ctx, page, errors } = await preparedPage((code) => {
      const si = window.setInterval;
      window.setInterval = (fn, ms, ...rest) => si(fn, Math.max(10, (ms || 0) / 100), ...rest);
      window.__puts = [];
      const f = window.fetch;
      window.fetch = (url, opts) => { if (opts && opts.method === 'PUT') window.__puts.push(String(url)); return f(url, opts); };
      localStorage.setItem('village.cloud', code);
    }, X);
    await waitFor(() => page.evaluate(() => window.__puts.length > 0), 5000);
    const r = await page.evaluate(async ({ key, Y }) => {
      let state = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
      const other = JSON.parse(localStorage.getItem(key));
      other.res.wood = 66;
      other.savedAt = Date.now();
      other.writtenAt = Date.now() + 1;
      localStorage.setItem(key, JSON.stringify(other));
      localStorage.setItem('village.cloud', Y);
      const mark = window.__puts.length;
      state = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((res) => setTimeout(res, 1500));
      return { puts: window.__puts.slice(mark), shown: document.getElementById('cloud-code').textContent };
    }, { key: SAVE_KEY, Y });
    check(r.puts.length > 0 && r.puts.every((u) => u.endsWith(`/api/saves/${Y}`)),
      'a tab adopting another tab\'s save PUTs only to that tab\'s cloud code', JSON.stringify(r));
    check(r.shown.replace(/-/g, '') === Y, 'the settings panel shows the adopted cloud code', JSON.stringify(r));
    check(errors.length === 0, 'no console errors (adopted cloud code)', errors.join('\n'));
    await ctx.close();
  }
  {
    // Without another tab's save in between, a returning tab carries on with its own state.
    const { ctx, page, errors } = await preparedPage(() => {});
    const r = await page.evaluate(async (key) => {
      let state = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
      const old = JSON.parse(localStorage.getItem(key));
      old.res.wood = 55;
      old.writtenAt -= 5000; // an older save must not win
      localStorage.setItem(key, JSON.stringify(old));
      state = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((res) => setTimeout(res, 300));
      return { stored: JSON.parse(localStorage.getItem(key)).res.wood };
    }, SAVE_KEY);
    check(r.stored !== 55, 'an older save in storage does not replace the returning tab\'s state', JSON.stringify(r));
    check(errors.length === 0, 'no console errors (own state kept)', errors.join('\n'));
    await ctx.close();
  }
  {
    // "Начать заново" with a cloud code: the dialog shows the old code, the new village gets no code,
    // the sped-up cloud autosave never PUTs to the old code, and loading that code brings the old village back.
    const X = 'qrstuvwxyz234567';
    const { ctx, page, errors } = await preparedPage(() => {
      const si = window.setInterval;
      window.setInterval = (fn, ms, ...rest) => si(fn, Math.max(10, (ms || 0) / 100), ...rest);
      window.__puts = [];
      const f = window.fetch;
      window.__fetch = f;
      window.fetch = (url, opts) => { if (opts && opts.method === 'PUT') window.__puts.push(String(url)); return f(url, opts); };
    });
    // Put an old village (wood 55) under code X and load it through the cloud form.
    await page.evaluate(async (code) => {
      const s = window.Village.newGame();
      s.res.wood = 55;
      await window.__fetch(`/api/saves/${code}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(window.Village.save(s)),
      });
    }, X);
    await page.click('#btn-settings');
    await page.fill('#cloud-input', X);
    await page.press('#cloud-input', 'Enter');
    await waitFor(() => page.evaluate((c) => window.__puts.some((u) => u.endsWith(`/api/saves/${c}`)), X), 5000);
    const before = await page.evaluate(() => ({ wood: Number(document.getElementById('r-wood').textContent), code: document.getElementById('cloud-code').textContent }));
    check(before.wood >= 55 && before.code.replace(/-/g, '') === X, 'the old village is loaded from cloud code X', JSON.stringify(before));
    if (await page.isHidden('#panel-settings')) await page.click('#btn-settings');
    await page.click('#btn-reset');
    const dialog = await modalText(page);
    check(dialog.includes(before.code), 'the reset dialog shows the cloud code to write down', JSON.stringify(dialog));
    await page.click('#modal-actions .danger');
    const mark = await page.evaluate(() => window.__puts.length);
    await sleep(1500);
    const after = await page.evaluate(async ({ mark, code }) => {
      const res = await window.__fetch(`/api/saves/${code}`);
      return {
        puts: window.__puts.slice(mark),
        shown: document.getElementById('cloud-code').textContent,
        stored: localStorage.getItem('village.cloud'),
        wood: Number(document.getElementById('r-wood').textContent),
        cloudWood: (await res.json()).res.wood,
      };
    }, { mark, code: X });
    check(after.puts.length === 0, 'after a reset no cloud PUTs go to the old code', JSON.stringify(after));
    check(after.shown === '' && !after.stored && after.wood < 55, 'after a reset the cloud code is cleared and the village is new', JSON.stringify(after));
    check(after.cloudWood >= 55, 'the cloud copy under the old code is untouched by the reset', JSON.stringify(after));
    if (await page.isHidden('#panel-settings')) await page.click('#btn-settings');
    await page.fill('#cloud-input', X);
    await page.press('#cloud-input', 'Enter');
    const back = await waitFor(() => page.evaluate(() => Number(document.getElementById('r-wood').textContent) >= 55), 5000);
    check(back, 'loading the old code after a reset restores the old village');
    check(errors.length === 0, 'no console errors (reset with cloud code)', errors.join('\n'));
    await ctx.close();
  }
  {
    // "Сохранить в облако" on a slow network, then "Начать заново" before the PUT returns: the late reply
    // must not bring the old code back, so the sped-up autosave never sends the new village to it.
    const X = 'mnpqrstuvwxyz234';
    const { ctx, page, errors } = await preparedPage((code) => {
      const si = window.setInterval;
      window.setInterval = (fn, ms, ...rest) => si(fn, Math.max(10, (ms || 0) / 100), ...rest);
      window.__puts = [];
      const f = window.fetch;
      window.fetch = (url, opts) => { if (opts && opts.method === 'PUT') window.__puts.push(String(url)); return f(url, opts); };
      localStorage.setItem('village.cloud', code);
    }, X);
    await ctx.route('**/api/saves/*', async (route) => {
      if (route.request().method() === 'PUT') await sleep(1500);
      await route.continue().catch(() => {});
    });
    await page.click('#btn-settings');
    await page.click('#btn-cloud-save');
    await page.click('#btn-reset');
    await page.click('#modal-actions .danger');
    const mark = await page.evaluate(() => window.__puts.length);
    await sleep(2500);
    const r = await page.evaluate((mark) => ({
      puts: window.__puts.slice(mark),
      shown: document.getElementById('cloud-code').textContent,
      stored: localStorage.getItem('village.cloud'),
      msg: document.getElementById('cloud-msg').textContent,
    }), mark);
    check(!r.stored && r.shown === '', 'a cloud save that returns after a reset keeps the code cleared', JSON.stringify(r));
    check(r.puts.length === 0, 'after a reset during a cloud save no PUTs go to the old code', JSON.stringify(r));
    check(r.msg === '', 'a stale cloud save reply leaves no message after a reset', JSON.stringify(r));
    check(errors.length === 0, 'no console errors (reset during cloud save)', errors.join('\n'));
    await ctx.close();
  }
}

async function main() {
  if (await healthy()) throw new Error(`port ${PORT} is already in use`);
  startServer();
  const up = await waitFor(healthy, 120000, 250);
  if (!up) throw new Error('server did not answer /healthz');
  browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  await desktopChecks();
  await roPhoneChecks();
  await edgeChecks();
}

async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  stopServer();
}

process.on('SIGINT', () => { stopServer(); process.exit(130); });
process.on('SIGTERM', () => { stopServer(); process.exit(143); });

main()
  .catch((e) => { failures.push(e.message); console.error(`FAIL ${e.stack || e}`); })
  .finally(async () => {
    await cleanup();
    if (failures.length) {
      console.error(`\n${failures.length} check(s) failed`);
      process.exit(1);
    }
    console.log('\nsmoke: all checks passed');
    process.exit(0);
  });
