'use strict';
// E2E smoke test for «Родник» (/village/) in Chromium. Not part of `node --test`:
//   NODE_PATH=/opt/node22/lib/node_modules node tests/village/smoke.cjs
// Starts the Go server on :18080 with in-memory storage, drives the page through real input
// (keyboard, taps) and reads state only from the DOM and localStorage. Exits non-zero on failure
// and always stops the server.
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 18080;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROMIUM = '/opt/pw-browsers/chromium';
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
    let opaque = 0;
    const step = 4 * 97;
    for (let i = 0; i < d.length; i += step) {
      if (d[i + 3] > 0) opaque++;
      colors.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4));
    }
    const samples = Math.ceil(d.length / step);
    return { ok: opaque / samples > 0.95 && colors.size > 20, opaque: opaque / samples, colors: colors.size };
  });
}

// The nearest standing tree to the player that is inside the canvas, in page (client) coordinates.
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
  const { ctx, page, errors } = await newPage({ width: 390, height: 844 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
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
  check(errors.length === 0, 'no console errors (phone, RO)', errors.join('\n'));
  await ctx.close();
}

async function main() {
  if (await healthy()) throw new Error(`port ${PORT} is already in use`);
  startServer();
  const up = await waitFor(healthy, 120000, 250);
  if (!up) throw new Error('server did not answer /healthz');
  browser = await chromium.launch(fs.existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
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
