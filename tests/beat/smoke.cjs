'use strict';
// E2E smoke test for «Аншлаг» (/beat/) in Chromium. Not part of `node --test`:
//   node tests/beat/smoke.cjs
// Needs Playwright with Chromium; PW_CHROMIUM=/path/to/chromium picks a specific browser binary.
// Starts the Go server on a free port with in-memory storage. Plays twenty beats on time (the taps are timed in
// the page against the game's own clock), hires the shaker, reloads and finds the save, buys a faster tempo,
// spams, calibrates, then opens the RO version on a phone. Exits non-zero on failure and always stops the server.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const CHROMIUM = process.env.PW_CHROMIUM;
const SAVE_KEY = 'beat.save';

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
    if (v || Date.now() > end) return v;
    await sleep(stepMs);
  }
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
// `go run` forks the compiled binary, so the server runs in its own process group and the group is killed.
function startServer(port) {
  server = spawn('go', ['run', '.', '-addr', `127.0.0.1:${port}`, '-data', ''], { cwd: ROOT, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  server.stderr.on('data', (d) => { log += d; });
  server.on('exit', (code) => { if (code) console.error(`server exited with ${code}\n${log}`); });
}
function stopServer() {
  if (!server || server.exitCode !== null) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
  try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ }
}
async function healthy() { try { return (await fetch(`${base}/healthz`)).ok; } catch { return false; } }

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
    if (m.type() !== 'error' || /\/favicon\.ico$/.test(m.location().url || '')) return;
    errors.push(`console: ${m.text()}`);
  });
  return { ctx, page, errors, external };
}

// Taps `n` beats in the page, each on time by the game's clock (judge time). `grid` picks the grid to follow.
function tapBeats(page, n, which = 'run') {
  return page.evaluate(async ({ n, which }) => {
    const C = window.BeatCore;
    const grid = () => (which === 'calib' ? Beat.calib.grid : Beat.state.run.grid);
    // calibration measures raw heard time, play subtracts the offset: follow the matching clock
    const now = () => (which === 'calib' ? BeatMusic.heardNow() : Beat.clock());
    for (let i = 0; i < n; i++) {
      if (which === 'calib' && !Beat.calib) break;
      const t = now();
      const next = C.timeOf(grid(), Math.floor(C.beatAt(grid(), t + 0.1)) + 1);
      await new Promise((r) => setTimeout(r, Math.max(0, (next - now()) * 1000)));
      Beat.onTap(performance.now());
    }
  }, { n, which });
}
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.BeatCore.serialize(Beat.state))));

async function desktopChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 1280, height: 800 });
  await page.goto(`${base}/beat/`);
  await page.waitForFunction(() => window.Beat && window.BeatCore && window.BeatMusic);
  check(await page.isVisible('#intro'), 'the intro screen greets the player');
  check(await waitFor(() => page.isVisible('.home-link'), 3000), 'the link back to the hub shows on the server');
  await page.click('#btn-play');
  check(await page.evaluate(() => Beat.mode) === 'play' && !(await page.isVisible('#intro')), 'Играть starts the session');
  check(await page.evaluate(() => !!BeatMusic.context), 'the audio clock is running');

  await tapBeats(page, 20);
  let s = await state(page);
  const streak = await page.evaluate(() => Beat.state.streak);
  check(streak >= 16, 'twenty taps on the beat build a streak', `streak ${streak}, stats ${JSON.stringify(s.stats)}`);
  check(s.stats.perfect >= 16, 'and most of them are perfect', JSON.stringify(s.stats));
  check(s.coins >= 15, 'and pay enough for a shaker', String(s.coins));

  await page.waitForTimeout(300);
  await page.click('.buy[data-id="shaker"]');
  s = await state(page);
  check(s.levels.shaker === 1, 'clicking the shaker hires it');
  check(await page.textContent('.buy[data-id="shaker"] .buy-lv') === 'ур. 1', 'the panel shows its level');

  await page.reload();
  await page.waitForFunction(() => window.Beat);
  s = await state(page);
  check(s.levels.shaker === 1 && s.stats.hits >= 16, 'the save survives a reload', JSON.stringify(s));
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), SAVE_KEY);
  check(saved && saved.state && Number.isFinite(saved.savedAt), 'the save is in localStorage');

  // a faster tempo
  await page.click('#btn-play');
  await page.evaluate(() => { Beat.state.coins = 1e4; Beat.state.total = Math.max(Beat.state.total, 1e4); });
  await page.waitForFunction(() => !document.getElementById('rush').hidden);
  await page.click('#rush');
  s = await state(page);
  check(s.rush === 1 && s.bpm === 95, '«Разгон» raises the tempo to 95', JSON.stringify({ rush: s.rush, bpm: s.bpm }));
  check(await page.evaluate(() => Beat.state.run.grid.bpm) === 95, 'the running grid follows');
  await page.waitForTimeout(300);
  check((await page.textContent('#rate')).includes('95 уд/мин'), 'the HUD shows the tempo');
  await page.click('#bpm-down');
  check((await state(page)).bpm === 90, 'the tempo can be lowered again');

  // spam: thirty taps in a second
  await tapBeats(page, 8);
  await page.evaluate(async () => { for (let i = 0; i < 30; i++) { Beat.onTap(performance.now()); await new Promise((r) => setTimeout(r, 33)); } });
  const spam = await page.evaluate(() => Beat.state.streak);
  check(spam <= 2, 'spamming kills the streak', String(spam));

  // calibration on an exact tapper measures no delay
  await page.click('#btn-calib');
  check(await page.isVisible('#calib') && await page.evaluate(() => Beat.mode) === 'calib', 'calibration opens');
  await tapBeats(page, 12, 'calib');
  await waitFor(() => page.evaluate(() => Beat.mode === 'play'), 3000);
  const offset = await page.evaluate(() => Beat.prefs.offset);
  check(!(await page.isVisible('#calib')) && Math.abs(offset) <= 0.03, 'ten taps measure the delay and return to play', String(offset));
  check(await page.isVisible('#toast'), 'the result is shown');
  check(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).offset, 'beat.prefs') === offset, 'the delay is remembered');

  check(external.length === 0, 'no requests leave the server (desktop)', external.join('\n'));
  check(errors.length === 0, 'no console errors (desktop)', errors.join('\n'));
  await ctx.close();
}

async function roPhoneChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(`${base}/beat/?lang=ro`);
  await page.waitForFunction(() => window.Beat);
  check(await page.title() === 'Sală plină', 'the RO title');
  check((await page.textContent('#btn-play')).trim() === 'Joacă', 'the RO intro');
  await page.tap('#btn-play');
  await tapBeats(page, 6);
  await page.waitForTimeout(400);
  check(await page.evaluate(() => Beat.state.streak) >= 4, 'tapping in time works on a phone');
  check((await page.textContent('#hint')).startsWith('Lovește când'), 'the touch hint is in RO and says nothing about the space bar');
  check(await page.evaluate(() => I18n.missing.size === 0), 'no untranslated strings', await page.evaluate(() => [...I18n.missing].join(' | ')));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll');
  check(external.length === 0, 'no requests leave the server (RO phone)', external.join('\n'));
  check(errors.length === 0, 'no console errors (RO phone)', errors.join('\n'));
  await ctx.close();
}

async function main() {
  base = `http://127.0.0.1:${await freePort()}`;
  startServer(Number(base.split(':').pop()));
  if (!(await waitFor(healthy, 120000, 250))) throw new Error('server did not answer /healthz');
  browser = await chromium.launch({ ...(CHROMIUM ? { executablePath: CHROMIUM } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
  await desktopChecks();
  await roPhoneChecks();
}

process.on('SIGINT', () => { stopServer(); process.exit(130); });
process.on('SIGTERM', () => { stopServer(); process.exit(143); });

main()
  .catch((e) => { failures.push(e.message); console.error(`FAIL ${e.stack || e}`); })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    stopServer();
    if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
    console.log('\nsmoke: all checks passed');
    process.exit(0);
  });
