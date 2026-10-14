'use strict';
// E2E smoke test for «Последняя крепость» (/castle/) in Chromium. Not part of `node --test`:
//   node tests/castle/smoke.cjs
// Needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium); with a global
// install, point NODE_PATH at the global modules, e.g. NODE_PATH="$(npm root -g)" node tests/castle/smoke.cjs.
// PW_CHROMIUM=/path/to/chromium picks a specific browser binary instead of Playwright's own.
// Starts the Go server on a free port with in-memory storage. Plays campaign wave 1 with real mouse pulls (the
// aim for the nearest monster is solved in the page and turned into a pull with CastleView's slingshot rule),
// picks an upgrade, reloads in the break, and finishes an endless run that is seeded one blow from falling, then
// sends the score to the leaderboard. Results are read from the DOM, localStorage and the board API.
// Exits non-zero on failure and always stops the server.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const CHROMIUM = process.env.PW_CHROMIUM;
const SAVE_KEY = 'castle.save';
const AUDIO_KEY = 'castle.audio';

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

const ready = (page) => page.waitForFunction(() => window.CastleCore && window.CastleView && window.CastleAudio
  && document.getElementById('field').width > 1);

// Holds the mouse down on the field and keeps re-aiming at the nearest monster until `done` says so.
async function fightWave(page, done, timeoutMs) {
  const box = await page.locator('#field').boundingBox();
  const x0 = box.x + box.width * 0.6, y0 = box.y + box.height * 0.4;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  const end = Date.now() + timeoutMs;
  let finished = false;
  while (Date.now() < end) {
    if (await done()) { finished = true; break; }
    // aim at the monster nearest the wall: its position comes from the run on screen (castleDebugRun)
    const pull = await page.evaluate(() => {
      const C = window.CastleCore, V = window.CastleView;
      const run = window.castleDebugRun ? window.castleDebugRun() : null;
      if (!run || !run.enemies.length) return null;
      const e = run.enemies.reduce((a, b) => (b.x < a.x ? b : a));
      const v = C.stats(run).vmax;
      let x = e.x;
      const y = e.y + e.h / 2;
      let angle = null;
      for (let k = 0; k < 3; k++) {
        const dx = x - C.ARCHER.x, dy = y - C.ARCHER.y;
        const disc = v ** 4 - C.G * (C.G * dx * dx + 2 * dy * v * v);
        if (disc < 0) return null;
        angle = Math.atan2(v * v - Math.sqrt(disc), C.G * dx);
        const t = dx / (v * Math.cos(angle));
        x = e.atWall ? e.x : Math.max(C.WALL_X + e.w / 2, e.x - e.speed * t);
      }
      const len = V.FULL_DRAG * 1.05; // full power
      return { dx: -Math.cos(angle) * len, dy: Math.sin(angle) * len };
    });
    if (pull) await page.mouse.move(x0 + pull.dx, y0 + pull.dy);
    await sleep(120);
  }
  await page.mouse.up();
  return finished;
}

async function desktopChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 1100, height: 640 });
  await page.goto(`${base}/castle/`, { waitUntil: 'load' });
  await ready(page);
  check(await visible(page, 'menu'), 'the menu is shown first');
  check(await text(page, '#btn-campaign') === 'Кампания', '«Кампания» with no run saved', await text(page, '#btn-campaign'));
  check(await page.evaluate(() => window.CastleAudio.STORE_KEY === 'castle.audio'), 'audio.js is loaded');

  await page.click('#btn-sound-menu');
  const off = await page.evaluate((k) => localStorage.getItem(k), AUDIO_KEY);
  check(off === '{"enabled":false}', 'the sound toggle is saved to castle.audio', off);
  await page.click('#btn-sound-menu');
  check(await text(page, '#btn-sound-menu') === 'Звук: вкл', 'the sound is back on');

  await page.click('#btn-campaign');
  check(await visible(page, 'hud') && await text(page, '#hud-wave') === 'Волна 1/30', 'wave 1 of the campaign starts with the HUD', await text(page, '#hud-wave'));
  const s0 = await readSave(page);
  check(s0 && s0.current && s0.current.mode === 'campaign' && s0.current.wave === 0 && s0.current.status === 'ready',
    'the start of the wave is the save point', JSON.stringify(s0 && s0.current));

  const cleared = await fightWave(page, () => visible(page, 'between'), 120000);
  check(cleared, 'mouse pulls clear wave 1');
  check(await text(page, '#between-title') === 'Волна 1 отбита!', 'the break between waves opens', await text(page, '#between-title'));
  const cards = await page.$$eval('#cards .card', (b) => b.length);
  check(cards === 3, 'three upgrade cards are offered', String(cards));
  const s1 = await readSave(page);
  check(s1 && s1.campaignBest === 1 && s1.current && s1.current.status === 'between' && s1.current.offer.length === 3,
    'the cleared wave and the offer are saved at once', JSON.stringify(s1));

  await page.click('#cards .card');
  check(await page.$eval('#cards .card', (b) => b.classList.contains('picked')), 'the picked card is marked');
  check(await page.$$eval('#cards .card', (bs) => bs.every((b) => b.disabled)), 'one pick per break');
  const s2 = await readSave(page);
  check(s2.current.picked === true && Object.values(s2.current.up).reduce((a, b) => a + b, 0) === 1, 'the pick is saved', JSON.stringify(s2.current.up));

  // A reload in the break keeps the cleared wave, the same three cards and the pick.
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  check(await text(page, '#btn-campaign') === 'Кампания: волна 2', 'after a reload the menu continues at wave 2', await text(page, '#btn-campaign'));
  await page.click('#btn-campaign');
  check(await visible(page, 'between'), 'it comes back to the break');
  const s3 = await readSave(page);
  check(JSON.stringify(s3.current.offer) === JSON.stringify(s1.current.offer), 'the same three cards after the reload');
  check(await page.$$eval('#cards .card', (bs) => bs.every((b) => b.disabled)), 'and the pick still counts');
  await page.click('#btn-fight');
  check(await text(page, '#hud-wave') === 'Волна 2/30', '«В бой» starts wave 2', await text(page, '#hud-wave'));
  await page.keyboard.press('KeyP');
  check(await visible(page, 'pause'), 'P pauses the wave');
  await page.click('#btn-pause-menu');
  check(await visible(page, 'menu'), 'the pause menu leads back to the menu');

  // Endless: a run seeded one blow from falling. Starting it asks before dropping the campaign run.
  await page.evaluate((key) => {
    const C = window.CastleCore;
    const run = C.newRun('endless', 4);
    run.wave = 39; run.status = 'between'; run.wallHp = 1; run.kills = 120; run.offer = []; run.picked = true;
    const save = JSON.parse(localStorage.getItem(key));
    save.current = C.snapshot(run);
    localStorage.setItem(key, JSON.stringify(save));
  }, SAVE_KEY);
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  check(await text(page, '#btn-endless') === 'Бесконечный: волна 40', 'the seeded endless run is offered', await text(page, '#btn-endless'));
  await page.click('#btn-endless');
  await page.click('#btn-fight');
  const fell = await waitFor(() => visible(page, 'result'), 90000, 250);
  check(fell && await text(page, '#res-title') === 'Стена пала', 'the wall falls and the result shows', fell ? await text(page, '#res-title') : 'no result');
  const score = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).endlessBest, SAVE_KEY);
  check(score >= 120 * 10 + 39 * 100, 'the endless record is saved', String(score));
  check((await text(page, '#res-main')).startsWith('Счёт:'), 'the score is shown', await text(page, '#res-main'));
  check(await visible(page, 'submit'), 'the leaderboard form is offered');
  await page.fill('#name', 'Смоук');
  await page.click('#btn-submit');
  const sent = await waitFor(async () => /Место в таблице рекордов: 1/.test(await text(page, '#submit-status')), 5000, 100);
  check(sent, 'the score lands first on the board', await text(page, '#submit-status'));
  const board = await (await fetch(`${base}/api/boards/castle/scores`)).json();
  check(board.length === 1 && board[0].name === 'Смоук' && board[0].score === score && board[0].level === 40,
    'GET /api/boards/castle/scores shows it', JSON.stringify(board));
  check((await readSave(page)).current === null, 'a finished run leaves no run to continue');

  check(external.length === 0, 'no requests leave the server', external.join('\n'));
  check(errors.length === 0, 'no console errors (desktop)', errors.join('\n'));
  await ctx.close();
}

async function roPhoneChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 360, height: 640 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await page.goto(`${base}/castle/?lang=ro`, { waitUntil: 'load' });
  await ready(page);
  const ro = await page.evaluate(() => ({
    h1: document.querySelector('h1').textContent.trim(),
    campaign: document.getElementById('btn-campaign').textContent.trim(),
    endless: document.getElementById('btn-endless').textContent.trim(),
  }));
  check(ro.h1 === 'Ultima cetate' && ro.campaign === 'Campanie' && ro.endless === 'Mod fără sfârșit', 'the menu is in RO', JSON.stringify(ro));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll at 360 px');
  await page.tap('#btn-campaign');
  check(await text(page, '#hud-wave') === 'Valul 1/30', 'the HUD is in RO', await text(page, '#hud-wave'));
  check(await text(page, '#tip') === 'Întoarce telefonul — câmpul e mai mare așa', 'a portrait phone is told to turn', await text(page, '#tip'));
  const hud = await page.evaluate(() => {
    const el = document.getElementById('hud');
    const saved = [];
    const set = (id, v) => { const e = document.getElementById(id); saved.push([e, e.textContent]); e.textContent = v; };
    const h0 = el.offsetHeight;
    set('hud-wave', 'Valul 30/30');
    set('wall-text', '248/248');
    set('hud-gold', '12 345');
    const h1 = el.offsetHeight;
    for (const [e, v] of saved.reverse()) e.textContent = v;
    return { h0, h1 };
  });
  check(hud.h1 === hud.h0 && hud.h0 < 50, 'the HUD keeps one line from the first to the longest values at 360 px', JSON.stringify(hud));
  // a touch pull fires arrows
  const box = await page.locator('#stage').boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const tx = box.x + box.width * 0.7, ty = box.y + box.height * 0.3;
  await touch('touchStart', tx, ty);
  for (let k = 1; k <= 6; k++) await touch('touchMove', tx - k * 18, ty + k * 10);
  await sleep(1500);
  const shots = await page.evaluate(() => window.castleDebugRun().arrows.length + window.castleDebugRun().kills);
  await touch('touchEnd', 0, 0);
  check(shots > 0, 'a touch pull fires arrows', String(shots));
  await page.tap('#btn-pause');
  check(await visible(page, 'pause') && await text(page, '#pause-title') === 'Pauză', 'the pause screen is in RO');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll in a wave');

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
