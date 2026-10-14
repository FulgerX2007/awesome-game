'use strict';
// E2E smoke test for «Тесная парковка» (/parking/) in Chromium. Not part of `node --test`:
//   node tests/parking/smoke.cjs
// Needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium); with a global
// install, point NODE_PATH at the global modules, e.g. NODE_PATH="$(npm root -g)" node tests/parking/smoke.cjs.
// PW_CHROMIUM=/path/to/chromium picks a specific browser binary instead of Playwright's own.
// Starts the Go server on a free port with in-memory storage and solves level 1 by dragging vehicles with the
// mouse along the optimal path that the page's own ParkingCore.solve finds for ParkingLevels.LEVELS[0]; the
// result is read only from the DOM and localStorage.
// Exits non-zero on failure and always stops the server.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const CHROMIUM = process.env.PW_CHROMIUM;
const SAVE_KEY = 'parking.progress';
const AUDIO_KEY = 'parking.audio';

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

const ready = (page) => page.waitForFunction(() => window.ParkingCore && window.ParkingLevels && window.ParkingView
  && window.ParkingAudio && document.getElementById('board').width > 1);

// The optimal path of level 1 from the page's own solver, and the page-pixel drag (from, to) of every move,
// computed on a shadow game that follows the same moves.
const planLevel1 = (page) => page.evaluate(() => {
  const C = window.ParkingCore, V = window.ParkingView;
  const def = window.ParkingLevels.LEVELS[0];
  const sol = C.solve(def);
  const s = C.newGame(def);
  const r = document.getElementById('board').getBoundingClientRect();
  const W = V.worldSize(s.level);
  const cell = r.width / W.w;
  const pad = (W.h - s.level.h) / 2;
  const at = (fx, fy) => ({ x: r.left + (pad + fx) * cell, y: r.top + (pad + fy) * cell });
  const drags = [];
  for (const [id, delta] of sol.path) {
    const v = s.vehicles.find((u) => u.id === id);
    const fx = v.x + 0.5, fy = v.y + 0.5; // the middle of its first cell
    const from = at(fx, fy);
    const to = v.dir === 'h' ? at(fx + delta, fy) : at(fx, fy + delta);
    drags.push({ id, delta, from, to });
    C.move(s, id, delta);
  }
  return { optimal: def.optimal, moves: sol.moves, limit: C.limitFor(def.optimal), drags, won: s.status === 'won' };
});

async function drag(page, { from, to }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) {
    await page.mouse.move(from.x + ((to.x - from.x) * k) / 10, from.y + ((to.y - from.y) * k) / 10);
    await sleep(15);
  }
  await page.mouse.up();
  await sleep(250); // let the car ease into its new cell
}

// Menu → level 1 → the optimal path by dragging, with one undo on the way. Returns the plan.
async function solveLevel1(page, L) {
  const plan = await planLevel1(page);
  check(plan.won && plan.moves === plan.optimal && plan.drags.length >= 1, 'the solver path wins level 1 in the stored optimum', JSON.stringify(plan));
  const movesAt = (n) => L.moves.replace('{n}', n).replace('{limit}', plan.limit);
  check(await text(page, '#hud-moves') === movesAt(0), 'the HUD starts at 0 moves', await text(page, '#hud-moves'));

  // The first move, undone with the «Отменить» button, then the whole path.
  await drag(page, plan.drags[0]);
  check(await text(page, '#hud-moves') === movesAt(1), 'a drag makes one move', await text(page, '#hud-moves'));
  await page.click('#btn-undo');
  check(await text(page, '#hud-moves') === movesAt(0), '«Отменить» takes the move back', await text(page, '#hud-moves'));
  const mid = await readSave(page);
  check(mid && mid.current && mid.current.level === 0 && mid.current.path.length === 0, 'the undone level in progress is saved', JSON.stringify(mid));

  for (const d of plan.drags) await drag(page, d);
  const title = await waitFor(() => resultShown(page), 10000, 100);
  check(title === L.won, 'the optimal drags solve level 1', JSON.stringify(title));
  const on = await page.$$eval('#res-stars .on', (e) => e.length);
  check(on === 3, 'the result shows ★★★', String(on));
  check(await text(page, '#res-moves') === L.result.replace('{n}', plan.optimal).replace('{opt}', plan.optimal), 'the result shows moves and the optimum', await text(page, '#res-moves'));
  const sv = await readSave(page);
  check(sv && sv.v === 1 && sv.stars && sv.stars[0] === 3, 'parking.progress keeps 3 stars for level 1', JSON.stringify(sv));
  return plan;
}

const RU = { won: 'Выехали!', moves: 'Ходы: {n}/{limit}', result: 'Ходы: {n}, оптимум: {opt}' };
const RO = { won: 'Ai ieșit!', moves: 'Mutări: {n}/{limit}', result: 'Mutări: {n}, optim: {opt}' };

async function desktopChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 1280, height: 800 });
  await page.goto(`${base}/parking/`, { waitUntil: 'load' });
  await ready(page);
  check(await page.isVisible('#menu'), 'the menu is shown first');
  check(await text(page, '#btn-play') === 'Играть: уровень 1', '«Играть» starts at level 1');
  check(await page.evaluate(() => window.ParkingAudio.STORE_KEY === 'parking.audio'), 'audio.js is loaded');

  // Sound toggle from the menu is saved; turn it back on.
  await page.click('#btn-sound-menu');
  const off = await page.evaluate((k) => localStorage.getItem(k), AUDIO_KEY);
  check(off === '{"enabled":false}', 'the sound toggle is saved to parking.audio', off);
  check(await text(page, '#btn-sound-menu') === 'Звук: выкл', 'the menu shows «Звук: выкл»');
  await page.click('#btn-sound-menu');
  check(await text(page, '#btn-sound-menu') === 'Звук: вкл', 'the sound is back on');

  await page.click('#btn-play');
  check(await page.isVisible('#hud') && await text(page, '#hud-level') === 'Уровень 1', 'level 1 starts with the HUD');
  await solveLevel1(page, RU);
  check(await page.isVisible('#btn-next'), '«Дальше» is offered');
  await page.click('#btn-next');
  check(await text(page, '#hud-level') === 'Уровень 2', '«Дальше» opens level 2');

  // After a reload level 1 keeps its stars and the menu goes on with level 2.
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  check(/уровень 2$/.test(await text(page, '#btn-play')), 'after a reload the menu continues at level 2', await text(page, '#btn-play'));
  await page.click('#btn-levels-menu');
  const first = await page.$eval('#level-grid > *', (b) => b.querySelectorAll('.mini-stars .on').length);
  check(first === 3, 'the level select shows ★★★ on level 1', String(first));

  check(external.length === 0, 'no requests leave the server', external.join('\n'));
  check(errors.length === 0, 'no console errors (desktop)', errors.join('\n'));
  await ctx.close();
}

async function roPhoneChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 360, height: 640 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await page.goto(`${base}/parking/?lang=ro`, { waitUntil: 'load' });
  await ready(page);
  const ro = await page.evaluate(() => ({
    h1: document.querySelector('h1').textContent.trim(),
    play: document.getElementById('btn-play').textContent.trim(),
    sound: document.getElementById('btn-sound-menu').textContent.trim(),
    lang: document.documentElement.lang,
  }));
  check(ro.h1 === 'Parcarea strâmtă' && ro.play === 'Joacă: nivelul 1' && ro.sound === 'Sunet: pornit',
    'the menu is in RO', JSON.stringify(ro));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll at 360 px');

  await page.tap('#btn-play');
  check(await text(page, '#hud-level') === 'Nivelul 1', 'the HUD is in RO');

  // The HUD must not change height while a level is played (the lot would jump): from the first to the
  // longest realistic values of the last level it keeps its height, and at 360 px that is one line.
  const hudLines = await page.evaluate(() => {
    const hud = document.getElementById('hud');
    const saved = [];
    const set = (id, v) => { const e = document.getElementById(id); saved.push([e, e.textContent]); e.textContent = v; };
    set('hud-level', 'Nivelul 40');
    set('hud-moves', 'Mutări: 0/38');
    const h0 = hud.offsetHeight;
    set('hud-moves', 'Mutări: 38/38');
    const h1 = hud.offsetHeight;
    for (const [e, v] of saved.reverse()) e.textContent = v;
    return { h0, h1 };
  });
  check(hudLines.h1 === hudLines.h0 && hudLines.h0 < 50, 'the HUD keeps one line from the first to the longest values at 360 px', JSON.stringify(hudLines));
  check(await text(page, '#btn-undo') === 'Anulează', 'the controls are in RO', await text(page, '#btn-undo'));
  await solveLevel1(page, RO);
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
