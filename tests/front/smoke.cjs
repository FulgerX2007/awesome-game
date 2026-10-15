'use strict';
// E2E smoke test for «Рубеж» (/front/) in Chromium. Not part of `node --test`:
//   node tests/front/smoke.cjs
// Needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium); with a global
// install, point NODE_PATH at the global modules, e.g. NODE_PATH="$(npm root -g)" node tests/front/smoke.cjs.
// PW_CHROMIUM=/path/to/chromium picks a specific browser binary instead of Playwright's own.
// Starts the Go server on a free port with in-memory storage. Plays level 1 with real taps (build panel, recruit
// buttons, the attack order), then finishes it from a near-win snapshot and checks the 3 stars; builds a bridge on
// level 2 and reloads mid-level. Then a 360 px RO phone with touch: panning by drag and a plot tap.
// Exits non-zero on failure and always stops the server.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const CHROMIUM = process.env.PW_CHROMIUM;
const SAVE_KEY = 'front.progress';

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
const visible = (page, id) => page.evaluate((id) => !document.getElementById(id).hidden, id);

const ready = (page) => page.waitForFunction(() => window.FrontCore && window.FrontView && window.FrontAudio
  && document.getElementById('field').width > 1);
const game = (page, fn) => page.evaluate(fn);

// The screen point of a plot or a chasm middle on the canvas, from the camera on screen.
async function pointOf(page, tg) {
  return page.evaluate((tg) => {
    const g = window.frontDebugGame(), V = window.FrontView, cam = window.frontDebugCam();
    const x = tg.plot != null ? g.plots[tg.plot].x : (g.chasms[tg.chasm].x0 + g.chasms[tg.chasm].x1) / 2;
    const r = document.getElementById('field').getBoundingClientRect();
    const p = V.toScreen(cam, x, 0);
    return { x: r.left + p.x, y: r.top + p.y - 6 };
  }, tg);
}

async function buildAt(page, tg, name, tap) {
  let pt = await pointOf(page, tg);
  const box = await page.locator('#field').boundingBox();
  if (!tap && (pt.x < box.x + 20 || pt.x > box.x + box.width - 20)) {
    // drag the line so the target comes to the middle
    const cx = box.x + box.width / 2, cy = box.y + box.height * 0.4;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - (pt.x - cx), cy, { steps: 12 });
    await page.mouse.up();
    pt = await pointOf(page, tg);
  }
  if (tap) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction(() => !document.getElementById('build').hidden, null, { timeout: 2000 });
  const row = page.locator('#build-list .item', { hasText: name });
  if (tap) await row.locator('button').tap(); else await row.locator('button').click();
}

async function desktopChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 1100, height: 760 });
  await page.goto(`${base}/front/`);
  await ready(page);
  check(await visible(page, 'menu'), 'the menu shows first');
  await page.click('#btn-play');
  const lv = await page.evaluate(() => [...document.querySelectorAll('#level-grid .lvl')].map((b) => b.disabled));
  check(lv.length === 12 && !lv[0] && lv.slice(1).every(Boolean), 'twelve levels, only the first open', JSON.stringify(lv));
  await page.click('#level-grid .lvl');
  check(await game(page, () => !!window.frontDebugGame()), 'level 1 starts');

  await buildAt(page, { plot: 0 }, 'Казарма');
  check(await game(page, () => window.frontDebugGame().plots[0].b && window.frontDebugGame().plots[0].b.id === 'barracks'), 'a tap on a plot and «Строить» lay a barracks');
  await buildAt(page, { plot: 1 }, 'Дом');
  check(await game(page, () => window.frontDebugGame().plots[1].b.id === 'house'), 'and a house');
  await page.click('#btn-speed');
  await page.waitForFunction(() => window.FrontCore.hasBuilding(window.frontDebugGame(), 'barracks'), null, { timeout: 20000 });
  await page.click('#recruit .unit:nth-child(2)');
  await page.click('#recruit .unit:nth-child(2)');
  check(await game(page, () => window.frontDebugGame().queue.filter((k) => k === 'soldier').length) === 2, 'the recruit button queues soldiers');
  await page.waitForFunction(() => window.frontDebugGame().units.filter((u) => u.kind === 'soldier').length >= 1, null, { timeout: 20000 });
  await page.click('#btn-order');
  check(await game(page, () => window.frontDebugGame().order) === 'attack', 'the order button sends the army to attack');
  const saved = await readSave(page);
  check(saved && saved.current && saved.current.level === 0, 'the level in progress is saved');

  // finish from a near-win snapshot: the fortress one blow from falling, soldiers at its gate. The level is left
  // through the pause menu first (that saves it), so the page has no game of its own to save on reload.
  const snap = await page.evaluate(() => window.FrontCore.snapshot(window.frontDebugGame()));
  await page.click('#btn-pause');
  await page.click('#btn-pause-menu');
  await page.evaluate(({ key, s }) => {
    const F = window.FrontCore;
    s.fort.hp = 3;
    for (const u of s.units) if (u.kind === 'soldier') u.x = s.L - F.FORT_W - 0.5;
    s.order = 'attack';
    const p = JSON.parse(localStorage.getItem(key));
    p.current = { level: 0, state: s };
    localStorage.setItem(key, JSON.stringify(p));
  }, { key: SAVE_KEY, s: snap });
  await page.reload();
  await ready(page);
  await page.click('#btn-play');
  check(await page.evaluate(() => document.querySelector('#level-grid .lvl').classList.contains('current')), 'the level in progress is marked');
  await page.click('#level-grid .lvl');
  await page.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 20000 }).catch(() => {});
  check(/★★★/.test(await text(page, '#res-stars')), 'the win shows three stars', await text(page, '#res-stars'));
  const after = await readSave(page);
  check(after.stars[0] === 3 && after.current === null, 'the stars land in front.progress', JSON.stringify({ s: after.stars[0], c: after.current }));

  // level 2: a bridge over the stream, then a reload mid-level
  await page.click('#btn-res-next');
  check(await game(page, () => window.frontDebugGame().chasms.length) === 1, 'level 2 has a chasm');
  await buildAt(page, { chasm: 0 }, 'Мост');
  check(await game(page, () => window.frontDebugGame().chasms[0].busy), 'a tap on the chasm starts a bridge');
  await page.waitForFunction(() => window.frontDebugGame().chasms[0].bridged, null, { timeout: 20000 }).catch(() => {});
  check(await game(page, () => window.frontDebugGame().chasms[0].bridged), 'the bridge is built');
  await page.click('#btn-pause'); // pausing saves
  const before = await game(page, () => { const g = window.frontDebugGame(); return { res: g.res, units: g.units.length, t: Math.round(g.t), bridged: g.chasms[0].bridged }; });
  await page.reload();
  await ready(page);
  await page.click('#btn-play');
  await page.click('#level-grid .lvl:nth-child(2)');
  const back = await game(page, () => { const g = window.frontDebugGame(); return { res: g.res, units: g.units.length, t: Math.round(g.t), bridged: g.chasms[0].bridged }; });
  check(JSON.stringify(back) === JSON.stringify(before), 'a reload mid-level restores the line', `${JSON.stringify(before)} → ${JSON.stringify(back)}`);

  check(external.length === 0, 'no requests leave the server', external.join('\n'));
  check(errors.length === 0, 'no console errors', errors.join('\n'));
  await ctx.close();
}

async function roPhoneChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 360, height: 720 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await page.goto(`${base}/front/?lang=ro`);
  await ready(page);
  check(await text(page, '#menu-title') === 'Frontiera', 'the menu is in RO');
  await page.tap('#btn-play');
  await page.tap('#level-grid .lvl');
  check(await game(page, () => !!window.frontDebugGame()), 'a tap starts level 1 on the phone');
  // a touch drag pans the line
  const box = await page.locator('#field').boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const x0 = await game(page, () => window.frontDebugCam().x0);
  const ty = box.y + box.height * 0.4;
  await touch('touchStart', box.x + box.width * 0.8, ty);
  for (let k = 1; k <= 8; k++) await touch('touchMove', box.x + box.width * 0.8 - k * 20, ty);
  await touch('touchEnd', 0, 0);
  const x1 = await game(page, () => window.frontDebugCam().x0);
  check(x1 > x0, 'a drag pans along the line', `${x0} → ${x1}`);
  await page.evaluate(() => { window.frontDebugGame(); });
  // back to the keep and tap a plot
  await touch('touchStart', box.x + box.width * 0.2, ty);
  for (let k = 1; k <= 12; k++) await touch('touchMove', box.x + box.width * 0.2 + k * 25, ty);
  await touch('touchEnd', 0, 0);
  await buildAt(page, { plot: 0 }, 'Cazarmă', true);
  check(await game(page, () => window.frontDebugGame().plots[0].b && window.frontDebugGame().plots[0].b.id === 'barracks'), 'a tap on a plot builds on the phone');
  check(/Spadasin/.test(await page.textContent('#recruit')), 'the recruit bar is in RO');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll');
  await page.tap('#btn-alloc');
  check(await visible(page, 'alloc') && await text(page, '#alloc-title') === 'Extracție', 'the workers panel is in RO');
  await page.tap('#btn-alloc-close');
  await page.tap('#btn-pause');
  check(await text(page, '#pause-title') === 'Pauză', 'the pause screen is in RO');
  const missing = await page.evaluate(() => [...window.I18n.missing]);
  check(missing.length === 0, 'no untranslated strings on the way', missing.join(' | '));
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
