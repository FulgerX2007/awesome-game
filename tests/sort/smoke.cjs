'use strict';
// E2E smoke test for «Цветные колбы» (/sort/) in Chromium. Not part of `node --test`:
//   node tests/sort/smoke.cjs
// Needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium); with a global
// install, point NODE_PATH at the global modules, e.g. NODE_PATH="$(npm root -g)" node tests/sort/smoke.cjs.
// PW_CHROMIUM=/path/to/chromium picks a specific browser binary instead of Playwright's own.
// Starts the Go server on a free port with in-memory storage and solves level 1 by tapping the tubes along the
// stored optimal solution of SortLevels.LEVELS[0] (mouse on desktop, touch on the phone); the result is read
// only from the DOM and localStorage.
// Exits non-zero on failure and always stops the server.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const CHROMIUM = process.env.PW_CHROMIUM;
const SAVE_KEY = 'sort.progress';
const AUDIO_KEY = 'sort.audio';

let base = '';
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

// A port nobody listens on right now.
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// `go run` forks the compiled binary, so the server runs in its own process group and the whole
// group is killed at the end.
function startServer(port) {
  server = spawn('go', ['run', '.', '-addr', `127.0.0.1:${port}`, '-data', ''], {
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
  try { return (await fetch(`${base}/healthz`)).ok; } catch { return false; }
}

// Every request must go to our server: the game works offline.
async function newPage(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts });
  const external = [];
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    external.push(url);
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The Go server has no /favicon.ico; every game logs this 404.
    if (/\/favicon\.ico$/.test(m.location().url || '')) return;
    errors.push(`console: ${m.text()} (${m.location().url || ''})`);
  });
  return { ctx, page, errors, external };
}

async function readSave(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    try { return raw ? JSON.parse(raw) : null; } catch { return { broken: raw }; }
  }, SAVE_KEY);
}

const text = async (page, sel) => (await page.textContent(sel)).trim();

const resultShown = (page) => page.evaluate(() => {
  const r = document.getElementById('result');
  return !r.hidden && document.getElementById('res-title').textContent;
});

const ready = (page) => page.waitForFunction(() => window.SortCore && window.SortLevels && window.SortView
  && window.SortAudio && document.getElementById('board').width > 1);

// The layout of the tubes on screen, rebuilt from the canvas box: [{ x, y }] page coordinates of each tube.
const tubeCentres = (page, count, cap) => page.evaluate(({ count, cap }) => {
  const c = document.getElementById('board');
  const r = c.getBoundingClientRect();
  const L = window.SortView.layout(count, cap, { w: r.width, h: r.height });
  return L.tubes.map((t) => ({ x: r.left + t.x + t.w / 2, y: r.top + t.y + t.h * 0.6 }));
}, { count, cap });

async function tapTube(page, centres, i, touch) {
  const { x, y } = centres[i];
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await sleep(40);
}

async function pourBy(page, centres, [a, b], touch) {
  await tapTube(page, centres, a, touch);
  await tapTube(page, centres, b, touch);
  await sleep(120);
}

// Menu → level 1 → the stored optimal solution by taps, with one undo on the way.
async function solveLevel1(page, L, touch) {
  const def = await page.evaluate(() => window.SortLevels.LEVELS[0]);
  const centres = await tubeCentres(page, def.tubes.length, def.cap);
  check(def.solution.length === def.par && def.par > 0, 'level 1 has a stored optimal solution', JSON.stringify(def.par));
  check(await text(page, '#hud-moves') === L.moves.replace('{n}', 0), 'the HUD starts at 0 moves', await text(page, '#hud-moves'));
  check(await text(page, '#hud-par') === L.par.replace('{n}', def.par), 'the HUD shows the par', await text(page, '#hud-par'));

  await pourBy(page, centres, def.solution[0], touch);
  check(await text(page, '#hud-moves') === L.moves.replace('{n}', 1), 'two taps make one pour', await text(page, '#hud-moves'));
  await page.click('#btn-undo');
  await sleep(100);
  check(await text(page, '#hud-moves') === L.moves.replace('{n}', 0), '«Отменить» takes the pour back', await text(page, '#hud-moves'));
  const mid = await readSave(page);
  check(mid && mid.current && mid.current.level === 0 && mid.current.path.length === 0, 'the undone level in progress is saved', JSON.stringify(mid));

  for (const m of def.solution) await pourBy(page, centres, m, touch);
  const early = await readSave(page);
  check(early && early.stars && early.stars[0] === 3 && early.current === null, 'the stars are saved the moment the level is won', JSON.stringify(early));
  const title = await waitFor(() => resultShown(page), 10000, 100);
  check(title === L.won, 'the stored solution sorts level 1', JSON.stringify(title));
  const on = await page.$$eval('#res-stars .on', (e) => e.length);
  check(on === 3, 'the result shows ★★★', String(on));
  check(await text(page, '#res-moves') === L.result.replace('{n}', def.par).replace('{par}', def.par), 'the result shows moves and par', await text(page, '#res-moves'));
  return def;
}

const RU = { won: 'Рассортировано!', moves: 'Ходы: {n}', par: 'Пар: {n}', result: 'Ходы: {n}, пар: {par}' };
const RO = { won: 'Sortat!', moves: 'Mutări: {n}', par: 'Par: {n}', result: 'Mutări: {n}, par: {par}' };

async function desktopChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 1280, height: 800 });
  await page.goto(`${base}/sort/`, { waitUntil: 'load' });
  await ready(page);
  check(await page.isVisible('#menu'), 'the menu is shown first');
  check(await text(page, '#btn-play') === 'Играть: уровень 1', '«Играть» starts at level 1');
  check(await page.evaluate(() => window.SortAudio.STORE_KEY === 'sort.audio'), 'audio.js is loaded');

  await page.click('#btn-sound-menu');
  const off = await page.evaluate((k) => localStorage.getItem(k), AUDIO_KEY);
  check(off === '{"enabled":false}', 'the sound toggle is saved to sort.audio', off);
  check(await text(page, '#btn-sound-menu') === 'Звук: выкл', 'the menu shows «Звук: выкл»');
  await page.click('#btn-sound-menu');
  check(await text(page, '#btn-sound-menu') === 'Звук: вкл', 'the sound is back on');

  await page.click('#btn-play');
  check(await page.isVisible('#hud') && await text(page, '#hud-level') === 'Уровень 1', 'level 1 starts with the HUD');
  await solveLevel1(page, RU, false);
  check(await page.isVisible('#btn-next'), '«Дальше» is offered');
  await page.click('#btn-next');
  await sleep(150);
  check(await text(page, '#hud-level') === 'Уровень 2', '«Дальше» opens level 2');

  // The spare tube on level 2, then one pour into it; both are saved and come back after a reload.
  const def2 = await page.evaluate(() => window.SortLevels.LEVELS[1]);
  await page.click('#btn-tube');
  await sleep(150);
  check(await page.isDisabled('#btn-tube'), 'the spare tube is used once per level');
  const centres = await tubeCentres(page, def2.tubes.length + 1, def2.cap);
  const first = def2.tubes.findIndex((t) => t.length);
  await pourBy(page, centres, [first, def2.tubes.length], false);
  check(await text(page, '#hud-moves') === 'Ходы: 1', 'a pour into the spare tube counts', await text(page, '#hud-moves'));
  const sv = await readSave(page);
  check(sv && sv.current && sv.current.level === 1 && JSON.stringify(sv.current.path) === JSON.stringify(['tube', [first, def2.tubes.length]]),
    'the level in progress keeps the spare tube and the pour', JSON.stringify(sv && sv.current));

  await page.reload({ waitUntil: 'load' });
  await ready(page);
  check(await text(page, '#btn-play') === 'Продолжить: уровень 2', 'after a reload the menu offers to continue level 2', await text(page, '#btn-play'));
  await page.click('#btn-play');
  await sleep(150);
  check(await text(page, '#hud-moves') === 'Ходы: 1' && await page.isDisabled('#btn-tube'), 'the board comes back with the spare tube and the pour');
  // Undo twice: the pour, then the spare tube, which can be taken again.
  await page.keyboard.press('KeyZ');
  await page.keyboard.press('KeyZ');
  await sleep(100);
  check(await text(page, '#hud-moves') === 'Ходы: 0' && !(await page.isDisabled('#btn-tube')), 'undo takes back the pour and then the spare tube');

  await page.click('#btn-levels');
  const stars1 = await page.$eval('#level-grid > *', (b) => b.querySelectorAll('.mini-stars .on').length);
  check(stars1 === 3, 'the level select shows ★★★ on level 1', String(stars1));

  check(external.length === 0, 'no requests leave the server', external.join('\n'));
  check(errors.length === 0, 'no console errors (desktop)', errors.join('\n'));
  await ctx.close();
}

async function roPhoneChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 360, height: 640 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await page.goto(`${base}/sort/?lang=ro`, { waitUntil: 'load' });
  await ready(page);
  const ro = await page.evaluate(() => ({
    h1: document.querySelector('h1').textContent.trim(),
    play: document.getElementById('btn-play').textContent.trim(),
    sound: document.getElementById('btn-sound-menu').textContent.trim(),
  }));
  check(ro.h1 === 'Eprubete colorate' && ro.play === 'Joacă: nivelul 1' && ro.sound === 'Sunet: pornit', 'the menu is in RO', JSON.stringify(ro));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll at 360 px');

  await page.tap('#btn-play');
  check(await text(page, '#hud-level') === 'Nivelul 1', 'the HUD is in RO');
  const hudLines = await page.evaluate(() => {
    const hud = document.getElementById('hud');
    const saved = [];
    const set = (id, v) => { const e = document.getElementById(id); saved.push([e, e.textContent]); e.textContent = v; };
    set('hud-level', 'Nivelul 1');
    set('hud-moves', 'Mutări: 0');
    const h0 = hud.offsetHeight;
    set('hud-level', 'Nivelul 60');
    set('hud-moves', 'Mutări: 188');
    set('hud-par', 'Par: 53');
    const h1 = hud.offsetHeight;
    for (const [e, v] of saved.reverse()) e.textContent = v;
    return { h0, h1 };
  });
  check(hudLines.h1 === hudLines.h0 && hudLines.h0 < 50, 'the HUD keeps one line from the first to the longest values at 360 px', JSON.stringify(hudLines));
  check(await text(page, '#btn-tube') === 'Eprubetă în plus', 'the controls are in RO', await text(page, '#btn-tube'));
  await solveLevel1(page, RO, true);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll on the result screen');

  check(external.length === 0, 'no requests leave the server (RO phone)', external.join('\n'));
  check(errors.length === 0, 'no console errors (RO phone)', errors.join('\n'));
  await ctx.close();
}
async function main() {
  base = `http://127.0.0.1:${await freePort()}`;
  startServer(Number(base.split(':').pop()));
  const up = await waitFor(healthy, 120000, 250);
  if (!up) throw new Error('server did not answer /healthz');
  browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  await desktopChecks();
  await roPhoneChecks();
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
