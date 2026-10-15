'use strict';
// E2E smoke test for «Долгая зима» (/winter/) in Chromium. Not part of `node --test`:
//   node tests/winter/smoke.cjs
// Needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium); with a global
// install, point NODE_PATH at the global modules, e.g. NODE_PATH="$(npm root -g)" node tests/winter/smoke.cjs.
// PW_CHROMIUM=/path/to/chromium picks a specific browser binary instead of Playwright's own.
// Starts the Go server on a free port with in-memory storage. A new winter: walking with keys, chopping a tree by a
// click, feeding the fire, eating; a seeded night with a wolf and a sleep in the repaired hut; a reload; a death and
// «Начать день заново». Then a 360 px RO phone with touch and the action button. Exits non-zero on failure and
// always stops the server.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const CHROMIUM = process.env.PW_CHROMIUM;
const SAVE_KEY = 'winter.save';

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

const ready = (page) => page.waitForFunction(() => window.WinterCore && window.WinterView && window.WinterAudio
  && document.getElementById('field').width > 1);
const game = (page, fn, arg) => page.evaluate(fn, arg);

// The screen point of a tile's centre on the canvas, once the camera has settled (the HUD showing up resizes the
// canvas right after a start, and the camera follows the hero).
async function tilePoint(page, x, y) {
  let prev = '';
  for (let k = 0; k < 20; k++) {
    const cur = await page.evaluate(() => JSON.stringify(window.winterDebugCam()));
    if (cur === prev) break;
    prev = cur;
    await sleep(120);
  }
  return page.evaluate(([x, y]) => {
    const V = window.WinterView, cam = window.winterDebugCam();
    const r = document.getElementById('field').getBoundingClientRect();
    const p = V.toScreen(cam, x + 0.5, y + 0.5);
    return { x: r.left + p.x, y: r.top + p.y };
  }, [x, y]);
}

const nearestTree = (page) => game(page, () => {
  const g = window.winterDebugGame(), C = window.WinterCore, cam = window.winterDebugCam();
  // a tree in view, reachable, with no game next to it (a tap near a rabbit means a hunt)
  const vis = g.nodes.filter((n) => n.kind === 'tree' && n.amount > 0 && n.x > cam.x0 + 1 && n.x < cam.x0 + cam.vw - 2 && n.y > cam.y0 + 1 && n.y < cam.y0 + cam.vh - 2
    && C.pathNextTo(g, g.hero, n.x, n.y) && !g.animals.some((a) => Math.hypot(a.x - n.x - 0.5, a.y - n.y - 0.5) < 3));
  vis.sort((a, b) => Math.hypot(a.x - g.hero.x, a.y - g.hero.y) - Math.hypot(b.x - g.hero.x, b.y - g.hero.y));
  return vis[0] ? { x: vis[0].x, y: vis[0].y } : null;
});

async function desktopChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 1100, height: 760 });
  await page.goto(`${base}/winter/`);
  await ready(page);
  check(await visible(page, 'menu'), 'the menu shows first');
  check(await page.evaluate(() => document.getElementById('btn-harsh').disabled), 'the harsh winter is locked at first');
  await page.click('#btn-normal');
  check(await game(page, () => !!window.winterDebugGame()), 'a new winter starts');
  const s0 = await readSave(page);
  check(!!(s0 && s0.current && s0.dawn), 'the winter and its dawn are saved at once');

  // keys walk
  const x0 = await game(page, () => window.winterDebugGame().hero.x);
  await page.keyboard.down('KeyD');
  await sleep(500);
  await page.keyboard.up('KeyD');
  const x1 = await game(page, () => window.winterDebugGame().hero.x);
  check(x1 > x0 + 0.5, 'D walks the hero to the right', `${x0} → ${x1}`);

  // a click on a tree: the hero walks up and chops
  const tree = await nearestTree(page);
  check(!!tree, 'a tree is in view');
  const wood0 = await game(page, () => window.winterDebugGame().stock.wood);
  const pt = await tilePoint(page, tree.x, tree.y);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction((w) => window.winterDebugGame().stock.wood >= w + 6, wood0, { timeout: 20000 }).catch(() => {});
  check(await game(page, () => window.winterDebugGame().stock.wood) >= wood0 + 6, 'clicking a tree chops wood');

  // feeding the fire: the fire runs low, a click on it puts logs in
  await game(page, () => { window.winterDebugGame().fire.fuel = 2; });
  const fire = await game(page, () => window.WinterCore.SPOT.fire);
  const fp = await tilePoint(page, fire.x, fire.y);
  await page.mouse.click(fp.x, fp.y);
  await page.waitForFunction(() => window.winterDebugGame().fire.fuel > 5, null, { timeout: 15000 }).catch(() => {});
  check(await game(page, () => window.winterDebugGame().fire.fuel) > 5, 'a click on the fire feeds it');

  // eating
  await game(page, () => { window.winterDebugGame().hero.food = 30; });
  await page.keyboard.press('KeyF');
  check(await game(page, () => window.winterDebugGame().hero.food) > 50, 'F eats');

  // a seeded night: the hut repaired with a fed stove, a wolf outside, the hero goes to bed and the night runs fast
  await page.click('#btn-pause');
  await page.click('#btn-pause-menu');
  await page.evaluate((key) => {
    const C = window.WinterCore;
    const save = JSON.parse(localStorage.getItem(key));
    const g = C.newGame('normal', 3);
    g.t = C.NIGHT_AT + 2;
    g.hut.stage = 4; g.hut.stove = 20;
    g.wolves.push({ id: 900, x: 1.5, y: 38.5, hp: 4, maxHp: 4, cd: 0, flee: false }); // far off: the hero reaches the hut first
    save.current = C.snapshot(g);
    save.dawn = C.snapshot(C.newGame('normal', 3));
    localStorage.setItem(key, JSON.stringify(save));
  }, SAVE_KEY);
  await page.reload();
  await ready(page);
  check(await visible(page, 'btn-continue'), 'the menu offers to continue');
  await page.click('#btn-continue');
  check(await game(page, () => window.WinterView.darkness(window.winterDebugGame())) > 0.5, 'it is dark at night');
  check(await game(page, () => window.winterDebugGame().wolves.length) >= 1, 'a wolf prowls');
  const bed = await game(page, () => window.WinterCore.SPOT.bed);
  const bp = await tilePoint(page, bed.x, bed.y);
  const clicked = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.id; }, [bp.x, bp.y]);
  await page.mouse.click(bp.x, bp.y);
  await page.waitForFunction(() => window.winterDebugGame().hero.sleeping, null, { timeout: 15000 }).catch(() => {});
  const why = await game(page, () => { const g = window.winterDebugGame(); return JSON.stringify({ x: g.hero.x, y: g.hero.y, target: g.hero.target, path: g.hero.path && g.hero.path.length, t: g.t, st: g.status, w: g.wolves.map((w) => [w.x, w.y]) }); });
  check(await game(page, () => window.winterDebugGame().hero.sleeping), 'a click on the bed puts the hero to sleep', `${clicked} ${JSON.stringify(bp)} ${why}`);
  const tA = await game(page, () => window.winterDebugGame().t);
  await sleep(1000);
  const tB = await game(page, () => window.winterDebugGame().t);
  check(tB - tA > 3, 'a night in a warm bed runs fast', `${(tB - tA).toFixed(2)} s in 1 s`);

  // reload: the state comes back
  await page.click('#btn-pause');
  const before = await game(page, () => { const g = window.winterDebugGame(); return { t: Math.round(g.t), hut: g.hut.stage, wood: g.stock.wood }; });
  await page.reload();
  await ready(page);
  await page.click('#btn-continue');
  const back = await game(page, () => { const g = window.winterDebugGame(); return { t: Math.round(g.t), hut: g.hut.stage, wood: g.stock.wood }; });
  check(JSON.stringify(back) === JSON.stringify(before), 'a reload restores the winter', `${JSON.stringify(before)} → ${JSON.stringify(back)}`);

  // death, the result, «Начать день заново»
  await game(page, () => { const g = window.winterDebugGame(); g.hero.health = 0.5; g.hero.food = 0; g.hero.warmth = 0; g.hero.sleeping = false; });
  await page.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 10000 }).catch(() => {});
  check(await text(page, '#res-title') === 'Зима победила', 'death shows the result');
  const rec = await readSave(page);
  check(rec.current === null && !!rec.dawn, 'the end lands in winter.save at once (the dawn stays for a retry)', JSON.stringify({ c: rec.current, d: !!rec.dawn }));
  await page.click('#btn-res-retry');
  check(await game(page, () => { const g = window.winterDebugGame(); return g && g.status === 'playing' && g.t % window.WinterCore.DAY === 0; }), '«Начать день заново» restores the dawn');

  check(external.length === 0, 'no requests leave the server', external.join('\n'));
  check(errors.length === 0, 'no console errors', errors.join('\n'));
  await ctx.close();
}

async function roPhoneChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 360, height: 720 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await page.goto(`${base}/winter/?lang=ro`);
  await ready(page);
  check(await text(page, '#menu-title') === 'Iarna lungă', 'the menu is in RO');
  await page.tap('#btn-normal');
  check(await game(page, () => !!window.winterDebugGame()), 'a tap starts a winter on the phone');
  // walk toward the nearest tree by taps until it is on screen
  let tree = await nearestTree(page);
  for (let k = 0; k < 5 && !tree; k++) {
    const step = await game(page, () => {
      const g = window.winterDebugGame(), C = window.WinterCore, cam = window.winterDebugCam();
      const t = g.nodes.filter((n) => n.kind === 'tree' && n.amount > 0 && C.pathNextTo(g, g.hero, n.x, n.y))
        .sort((a, b) => Math.hypot(a.x - g.hero.x, a.y - g.hero.y) - Math.hypot(b.x - g.hero.x, b.y - g.hero.y))[0];
      const d = Math.hypot(t.x - g.hero.x, t.y - g.hero.y), k = Math.min(1, (Math.min(cam.vw, cam.vh) / 2 - 1.5) / d);
      for (let j = 0; j < 8; j++) {
        const x = Math.floor(g.hero.x + (t.x - g.hero.x) * k) + (j % 3) - 1, y = Math.floor(g.hero.y + (t.y - g.hero.y) * k) + Math.floor(j / 3) - 1;
        if (C.walkable(g, x, y)) return { x, y };
      }
      return null;
    });
    if (!step) break;
    const sp = await tilePoint(page, step.x, step.y);
    await page.touchscreen.tap(sp.x, sp.y);
    await page.waitForFunction(() => !window.winterDebugGame().hero.path, null, { timeout: 15000 }).catch(() => {});
    tree = await nearestTree(page);
  }
  check(!!tree, 'a tree comes into view');
  const pt = await tilePoint(page, tree.x, tree.y);
  const w0 = await game(page, () => window.winterDebugGame().stock.wood);
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForFunction((w) => window.winterDebugGame().stock.wood > w, w0, { timeout: 20000 }).catch(() => {});
  check(await game(page, () => window.winterDebugGame().stock.wood) > w0, 'a tap on a tree chops on the phone');
  // the action button: next to the tree it chops on
  await page.waitForFunction(() => !window.winterDebugGame().hero.target, null, { timeout: 20000 }).catch(() => {});
  const label = await text(page, '#btn-act');
  check(/Taie|Acțiune|La foc|Culege|Scoate|Ia fierul|Vânătoare|Pescuiește/.test(label), 'the action button names the action in RO', label);
  await page.tap('#btn-build');
  check(await visible(page, 'build') && await text(page, '#build-title') === 'Construcții', 'the build panel is in RO');
  await page.tap('#btn-build-close');
  await page.tap('#btn-bench');
  check(await text(page, '#bench-title') === 'Bancul de lucru', 'the workbench is in RO');
  await page.tap('#btn-bench-close');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll');
  const hint = await text(page, '#hint');
  check(hint.length > 3 && !/[А-Яа-яЁё]/.test(hint), 'the hint line is in RO', hint);
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
