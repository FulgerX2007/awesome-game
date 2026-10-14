'use strict';
// E2E smoke test for «Тяни штифт» (/pins/) in Chromium. Not part of `node --test`:
//   node tests/pins/smoke.cjs
// Needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium); with a global
// install, point NODE_PATH at the global modules, e.g. NODE_PATH="$(npm root -g)" node tests/pins/smoke.cjs.
// PW_CHROMIUM=/path/to/chromium picks a specific browser binary instead of Playwright's own.
// Starts the Go server on a free port with in-memory storage, plays level 1 through real input (a mouse
// drag on the pin's handle, keys on a phone in RO) and reads state only from the DOM and localStorage.
// Exits non-zero on failure and always stops the server.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const CHROMIUM = process.env.PW_CHROMIUM;
const PROGRESS_KEY = 'pins.progress';
const AUDIO_KEY = 'pins.audio';

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

async function readProgress(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    try { return raw ? JSON.parse(raw) : null; } catch { return { broken: raw }; }
  }, PROGRESS_KEY);
}

// The winning pin order for level 1 and, per pin, its handle centre and pull direction in page coordinates.
async function levelOnePlan(page) {
  return page.evaluate(() => {
    const C = window.PinsCore;
    const V = window.PinsView;
    const lvl = window.PinsLevels.LEVELS[0];
    const order = C.solve(lvl).wins[0];
    const r = document.getElementById('board').getBoundingClientRect();
    const px = r.width / V.LW; // CSS px per logical px
    return order.map((id) => {
      const pin = lvl.pins.find((p) => p.id === id);
      const h = C.handleCell(pin);
      const d = V.pullDir(pin);
      return {
        id,
        x: r.left + (h.x + 0.5) * V.CELL * px,
        y: r.top + (h.y + 0.5) * V.CELL * px,
        dx: d.dx * V.CELL * px,
        dy: d.dy * V.CELL * px,
      };
    });
  });
}

const resultShown = (page) => page.evaluate(() => {
  const r = document.getElementById('result');
  return !r.hidden && document.getElementById('res-title').textContent;
});

async function desktopChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 1280, height: 900 });
  await page.goto(`${base}/pins/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.PinsCore && window.PinsLevels && window.PinsView && window.PinsAudio
    && document.getElementById('board').width > 1);
  check(await page.isVisible('#menu'), 'the menu is shown first');
  check((await page.textContent('#btn-play')).trim() === 'Играть: уровень 1', '«Играть» starts at level 1');

  // Sound toggle from the menu is saved; turn it back on.
  await page.click('#btn-sound-menu');
  const off = await page.evaluate((k) => localStorage.getItem(k), AUDIO_KEY);
  check(off === '{"enabled":false}', 'the sound toggle is saved to pins.audio', off);
  check((await page.textContent('#btn-sound-menu')).trim() === 'Звук: выкл', 'the menu shows «Звук: выкл»');
  await page.click('#btn-sound-menu');

  // Menu → level select → level 1.
  await page.click('#btn-levels-menu');
  check(await page.isVisible('#levels'), 'the level select opens');
  const locks = await page.$$eval('.lvl-btn', (bs) => bs.map((b) => b.disabled));
  check(locks.length === 30 && !locks[0] && locks.slice(1).every(Boolean), 'level 1 open, 2–30 locked', JSON.stringify(locks));
  await page.click('.lvl-btn >> nth=0');
  check(await page.isVisible('#hud') && (await page.textContent('#hud-level')).trim() === 'Уровень 1', 'level 1 starts with the HUD');
  await sleep(300);

  // Pull the pins of a winning order with a mouse drag on the handle, outwards along the pin.
  const plan = await levelOnePlan(page);
  check(plan.length > 0, 'level 1 has a winning order', JSON.stringify(plan));
  for (const p of plan) {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(p.x + p.dx * k * 0.5, p.y + p.dy * k * 0.5);
    await page.mouse.up();
    await sleep(150);
  }
  const pulled = await page.evaluate(() => document.getElementById('tip').hidden);
  check(pulled, 'the drag pulled a pin (the tip hides on the first pull)');

  const title = await waitFor(() => resultShown(page), 20000, 200);
  check(title === 'Уровень пройден!', 'the level is won', JSON.stringify(title));
  const stars = await page.$$eval('#res-stars .on', (s) => s.length);
  check(stars >= 1, 'the result shows stars', String(stars));
  const prog = await readProgress(page);
  check(prog && prog.v === 1 && prog.stars && prog.stars[0] === stars, 'pins.progress records level 1 with the shown stars', JSON.stringify(prog));
  check(await page.isVisible('#btn-next'), '«Дальше» is offered');

  await page.click('#btn-next');
  check((await page.textContent('#hud-level')).trim() === 'Уровень 2', '«Дальше» opens level 2');

  // After a reload the menu continues from level 2.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('board').width > 1);
  check((await page.textContent('#btn-play')).trim() === 'Играть: уровень 2', 'after a reload «Играть» continues at level 2');

  check(external.length === 0, 'no requests leave the server', external.join('\n'));
  check(errors.length === 0, 'no console errors (desktop)', errors.join('\n'));
  await ctx.close();
}

async function roPhoneChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 360, height: 640 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await page.goto(`${base}/pins/?lang=ro`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.PinsCore && document.getElementById('board').width > 1);
  const ro = await page.evaluate(() => ({
    h1: document.querySelector('h1').textContent.trim(),
    play: document.getElementById('btn-play').textContent.trim(),
    sound: document.getElementById('btn-sound-menu').textContent.trim(),
    levels: document.getElementById('btn-levels-menu').textContent.trim(),
    lang: document.documentElement.lang,
  }));
  check(ro.h1 === 'Trage știftul' && ro.play === 'Joacă: nivelul 1' && ro.sound === 'Sunet: pornit' && ro.levels === 'Niveluri',
    'the menu is in RO', JSON.stringify(ro));
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(scroll, 'no horizontal scroll at 360 px');

  await page.tap('#btn-play');
  check((await page.textContent('#hud-level')).trim() === 'Nivelul 1', 'the HUD is in RO');
  const order = await page.evaluate(() => window.PinsCore.solve(window.PinsLevels.LEVELS[0]).wins[0]);
  for (const id of order) await page.keyboard.press(`Digit${id}`);
  const title = await waitFor(() => resultShown(page), 20000, 200);
  check(title === 'Nivel trecut!', 'the result is in RO', JSON.stringify(title));
  const prog = await readProgress(page);
  check(prog && prog.stars && prog.stars[0] >= 1, 'pins.progress is written on the phone too', JSON.stringify(prog));

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
