'use strict';
// E2E smoke test for «Числовой забег» (/rush/) in Chromium. Not part of `node --test`:
//   node tests/rush/smoke.cjs
// Needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium); with a global
// install, point NODE_PATH at the global modules, e.g. NODE_PATH="$(npm root -g)" node tests/rush/smoke.cjs.
// PW_CHROMIUM=/path/to/chromium picks a specific browser binary instead of Playwright's own.
// Starts the Go server on a free port with in-memory storage, plays level 1 through real input (held arrow
// keys, steered by the HUD's progress bar) and reads state only from the DOM and localStorage.
// Exits non-zero on failure and always stops the server.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const CHROMIUM = process.env.PW_CHROMIUM;
const SAVE_KEY = 'rush.save';
const AUDIO_KEY = 'rush.audio';

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

const resultShown = (page) => page.evaluate(() => {
  const r = document.getElementById('result');
  return !r.hidden && document.getElementById('res-title').textContent;
});

// Share of the track run so far, 0–100, as the HUD's progress bar reports it.
const progress = (page) => page.evaluate(() => Number(document.getElementById('hud-bar').getAttribute('aria-valuenow')));

async function hold(page, key, ms) {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
}

// Holds `key` until the HUD shows at least `pct`% of the track run.
async function holdUntil(page, key, pct) {
  await page.keyboard.down(key);
  await waitFor(async () => (await progress(page)) >= pct || !!(await resultShown(page)), 40000, 50);
  await page.keyboard.up(key);
}

const ready = (page) => page.waitForFunction(() => window.RushCore && window.RushView && window.RushAudio
  && document.getElementById('scene').width > 1);

async function desktopChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 1280, height: 800 });
  await page.goto(`${base}/rush/`, { waitUntil: 'load' });
  await ready(page);
  check(await page.isVisible('#menu'), 'the menu is shown first');
  check((await page.textContent('#btn-play')).trim() === 'Играть: уровень 1', '«Играть» starts at level 1');
  check(await page.evaluate(() => window.RushAudio.STORE_KEY === 'rush.audio'), 'audio.js is loaded');

  // Sound toggle from the menu is saved; turn it back on.
  await page.click('#btn-sound-menu');
  const off = await page.evaluate((k) => localStorage.getItem(k), AUDIO_KEY);
  check(off === '{"enabled":false}', 'the sound toggle is saved to rush.audio', off);
  check((await page.textContent('#btn-sound-menu')).trim() === 'Звук: выкл', 'the menu shows «Звук: выкл»');
  await page.click('#btn-sound-menu');
  check((await page.textContent('#btn-sound-menu')).trim() === 'Звук: вкл', 'the sound is back on');

  // Menu → level 1; hold → for a few seconds and let the crowd run to the finish.
  await page.click('#btn-play');
  check(await page.isVisible('#hud') && (await page.textContent('#hud-level')).trim() === 'Уровень 1', 'level 1 starts with the HUD');
  await hold(page, 'ArrowRight', 3000);
  const moved = await progress(page);
  check(moved > 0, 'the crowd runs forward', String(moved));

  // P pauses the run: the pause screen shows and the crowd stands still; P again goes on.
  await page.keyboard.press('KeyP');
  check(await page.isVisible('#pause'), '«P» opens the pause screen');
  const p0 = await progress(page);
  await sleep(700);
  check((await progress(page)) === p0, 'nothing moves while paused', `${p0} → ${await progress(page)}`);
  await page.keyboard.press('KeyP');
  check(!(await page.isVisible('#pause')), '«P» again closes the pause screen');
  await sleep(400);
  check((await progress(page)) > p0, 'the run goes on after the pause');
  let title = await waitFor(() => resultShown(page), 60000, 250);
  check(title === 'Победа!' || title === 'Поражение', 'the run ends on the result screen', JSON.stringify(title));
  const coins = Number((await page.textContent('#res-coins')).replace(/[^0-9]/g, ''));
  let sv = await readSave(page);
  check(sv && sv.v === 1 && sv.coins === coins && coins >= 10, 'rush.save banks the coins shown on the result screen', JSON.stringify({ sv, coins }));

  // Again, this time taking the better gate of every pair: left (+10), right (×2), left (+15).
  await page.click('#btn-again');
  check((await page.textContent('#hud-level')).trim() === 'Уровень 1', '«Ещё раз» restarts level 1');
  await holdUntil(page, 'ArrowLeft', 30);
  await holdUntil(page, 'ArrowRight', 52);
  await holdUntil(page, 'ArrowLeft', 75);
  title = await waitFor(() => resultShown(page), 60000, 250);
  check(title === 'Победа!', 'the better gates win level 1', JSON.stringify(title));
  sv = await readSave(page);
  check(sv && sv.level === 2 && sv.best === 1 && sv.coins > coins, 'rush.save advances to level 2 and adds the coins', JSON.stringify(sv));
  const shown = await page.evaluate(() => {
    const box = document.getElementById('res-stars');
    return { visible: !box.hidden, on: box.querySelectorAll('.star.on').length, all: box.querySelectorAll('.star').length };
  });
  check(shown.visible && shown.all === 3 && shown.on >= 1, 'the result shows the stars', JSON.stringify(shown));
  check(sv && Array.isArray(sv.stars) && sv.stars.length === 1 && sv.stars[0] === shown.on, 'rush.save keeps the stars', JSON.stringify(sv));
  check(await page.isVisible('#btn-next'), '«Дальше» is offered');
  await page.click('#btn-next');
  check((await page.textContent('#hud-level')).trim() === 'Уровень 2', '«Дальше» opens level 2');

  // The HUD's pause button pauses too; «Меню» there leaves the run.
  await page.click('#btn-pause');
  check(await page.isVisible('#pause'), 'the pause button opens the pause screen');
  await page.click('#btn-pause-menu');
  check(await page.isVisible('#menu'), '«Меню» on the pause screen goes to the menu');
  await page.click('#btn-levels-menu');
  const grid = await page.evaluate(() => ({
    stars: document.querySelectorAll('#level-grid .lvl-btn.done .star').length,
    total: document.getElementById('levels-total').textContent.trim(),
  }));
  check(grid.stars === 3 && /^Звёзды: [1-3] из 3$/.test(grid.total), 'the level select shows the stars', JSON.stringify(grid));
  await page.click('#btn-levels-back');

  // After a reload the menu continues from level 2 with the coins kept.
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  check((await page.textContent('#btn-play')).trim() === 'Играть: уровень 2', 'after a reload «Играть» continues at level 2');
  check((await page.textContent('#menu-coins')).trim() === String(sv.coins), 'after a reload the menu shows the saved coins');

  check(external.length === 0, 'no requests leave the server', external.join('\n'));
  check(errors.length === 0, 'no console errors (desktop)', errors.join('\n'));
  await ctx.close();
}

async function roPhoneChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 360, height: 640 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await page.goto(`${base}/rush/?lang=ro`, { waitUntil: 'load' });
  await ready(page);
  const ro = await page.evaluate(() => ({
    h1: document.querySelector('h1').textContent.trim(),
    play: document.getElementById('btn-play').textContent.trim(),
    sound: document.getElementById('btn-sound-menu').textContent.trim(),
    shop: document.getElementById('btn-shop-menu').textContent.trim(),
    lang: document.documentElement.lang,
  }));
  check(ro.h1 === 'Cursa numerelor' && ro.play === 'Joacă: nivelul 1' && ro.sound === 'Sunet: pornit' && ro.shop === 'Magazin',
    'the menu is in RO', JSON.stringify(ro));
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(scroll, 'no horizontal scroll at 360 px');

  await page.tap('#btn-play');
  check((await page.textContent('#hud-level')).trim() === 'Nivelul 1', 'the HUD is in RO');

  // The HUD must not change height while a level is played (the scene would jump): from the first to the
  // longest realistic values of the last level it keeps its height, and at 360 px that is one line.
  const hudLines = await page.evaluate(() => {
    const hud = document.getElementById('hud');
    const saved = [];
    const set = (id, v) => { const e = document.getElementById(id); saved.push([e, e.textContent]); e.textContent = v; };
    set('hud-level', 'Nivelul 30');
    set('hud-count', '1');
    set('hud-power', '1');
    const h0 = hud.offsetHeight;
    set('hud-count', '99999');
    set('hud-power', '99');
    const h1 = hud.offsetHeight;
    for (const [e, v] of saved.reverse()) e.textContent = v;
    return { h0, h1 };
  });
  check(hudLines.h1 === hudLines.h0 && hudLines.h0 < 50, 'the HUD keeps one line from the first to the longest values at 360 px', JSON.stringify(hudLines));
  await hold(page, 'ArrowRight', 3000);
  const title = await waitFor(() => resultShown(page), 60000, 250);
  check(title === 'Victorie!' || title === 'Înfrângere', 'the result is in RO', JSON.stringify(title));
  const total = (await page.textContent('#res-total')).trim();
  check(/^Monede în total: \d+$/.test(total), 'the result lines are in RO', total);
  const sv = await readSave(page);
  check(sv && sv.coins >= 10, 'rush.save is written on the phone too', JSON.stringify(sv));
  const scroll2 = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(scroll2, 'no horizontal scroll on the result screen');

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
