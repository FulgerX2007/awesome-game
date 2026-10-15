'use strict';
// E2E smoke test for «Путь героя» (/hero/) in Chromium. Not part of `node --test`:
//   node tests/hero/smoke.cjs
// Needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium); with a global
// install, point NODE_PATH at the global modules, e.g. NODE_PATH="$(npm root -g)" node tests/hero/smoke.cjs.
// PW_CHROMIUM=/path/to/chromium picks a specific browser binary instead of Playwright's own.
// Starts the Go server on a free port with in-memory storage. Starts a run with two weapons, enters a map node by
// clicking it on the canvas, swaps the weapon mid-battle with a quick-slot button, walks on until a chest reward is
// taken, reloads on the map and in a battle, then finishes a seeded final boss that starts just above a third of
// its health. Then the same on a 360 px phone in RO with touch. Exits non-zero on failure and stops the server.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const CHROMIUM = process.env.PW_CHROMIUM;
const SAVE_KEY = 'hero.save';

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

const ready = (page) => page.waitForFunction(() => window.HeroCore && window.HeroView && window.HeroAudio
  && document.getElementById('field').width > 1);
const phase = (page) => page.evaluate(() => (window.heroDebugRun() ? window.heroDebugRun().phase : null));

// Clicks (or taps) the reachable map node `pick` chooses from the reachable ids, at its spot on the canvas.
async function enterNode(page, pick, tap) {
  const pt = await page.evaluate((pickSrc) => {
    const run = window.heroDebugRun(), V = window.HeroView, C = window.HeroCore;
    const ids = C.reachable(run);
    const id = new Function('ids', 'run', pickSrc)(ids, run);
    const cv = document.getElementById('field'), r = cv.getBoundingClientRect();
    const L = V.mapLayout(run.map, { w: r.width, h: r.height });
    return { x: r.left + L.pos[id].x, y: r.top + L.pos[id].y, kind: run.map.nodes[id].kind };
  }, pick);
  if (tap) await page.touchscreen.tap(pt.x, pt.y);
  else await page.mouse.click(pt.x, pt.y);
  return pt.kind;
}

// Plays whatever screen the run is on until `stop(phase)` holds; battles are waited out at ×2.
async function walk(page, stop, timeoutMs, tap) {
  const end = Date.now() + timeoutMs;
  const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
  for (;;) {
    const ph = await phase(page);
    if (await stop(ph) || Date.now() > end) return ph;
    const screen = await page.evaluate(() => ({
      choice: !document.getElementById('choice').hidden, bag: !document.getElementById('bag').hidden,
    }));
    if (screen.bag) { await press('#btn-bag-close'); continue; }
    if (ph === 'map') { await enterNode(page, 'return ids[0];', tap); await sleep(150); continue; }
    if (ph === 'battle') { await sleep(300); continue; }
    if (screen.choice) {
      if (ph === 'shop' || ph === 'forge') await press('#choice-actions .btn:last-child');
      else await press('#choice-cards .card:not(:disabled)');
      await sleep(150);
      continue;
    }
    await sleep(200);
  }
}

async function desktopChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 1100, height: 760 });
  await page.goto(`${base}/hero/`);
  await ready(page);
  // a save with the first «Оружейная» level: the run starts with the rusty sword and the fire blade
  await page.evaluate((key) => {
    const s = window.HeroCore.newSave();
    s.meta.armory = 1;
    localStorage.setItem(key, JSON.stringify(s));
  }, SAVE_KEY);
  await page.reload();
  await ready(page);
  check(await visible(page, 'menu'), 'the menu shows first');
  await page.click('#btn-run');
  check(await phase(page) === 'map', 'a new run opens the act map');
  check(!!(await readSave(page)).current, 'the run is saved at once');

  const kind = await enterNode(page, 'return ids[0];');
  check(kind === 'battle' && await phase(page) === 'battle', 'a click on a first-row node starts a battle', kind);
  await page.waitForFunction(() => window.heroDebugRun().battle && window.heroDebugRun().battle.t > 0.3, null, { timeout: 5000 });
  const slots = await page.locator('#slots .slot').count();
  check(slots === 2, 'two weapons are on the quick slots', String(slots));
  const before = await page.evaluate(() => window.heroDebugRun().eq.weapon);
  await page.click('#slots .slot:nth-child(2)');
  const swap = await page.evaluate(() => ({ w: window.heroDebugRun().eq.weapon, t: window.heroDebugRun().battle && window.heroDebugRun().battle.swapT }));
  check(swap.w !== before && swap.t > 0, 'the quick slot swaps the weapon mid-battle', JSON.stringify(swap));
  check((await page.textContent('#foe')).length > 2, 'the front enemy and its defences are shown');
  await page.click('#btn-speed');

  // walk on until a chest gives an item
  const bag0 = await page.evaluate(() => window.heroDebugRun().bag.length);
  let gotChest = false;
  for (let k = 0; k < 14 && !gotChest; k++) {
    const ph = await walk(page, (p) => p === 'chest' || p === 'loot' || p === 'lost' || p === 'won', 60000);
    if (ph === 'chest' || ph === 'loot') {
      await page.click('#choice-cards .card');
      await sleep(200);
      gotChest = (await page.evaluate(() => window.heroDebugRun().bag.length)) > bag0;
    } else break;
  }
  check(gotChest, 'a chest reward goes into the bag');

  // reload on the map: the same run comes back
  await walk(page, (p) => p === 'map' || p === 'lost', 60000);
  const mapState = await page.evaluate(() => { const r = window.heroDebugRun(); return { at: r.at, act: r.act, bag: r.bag.length, phase: r.phase }; });
  await page.reload();
  await ready(page);
  check((await text(page, '#btn-run')).startsWith('Продолжить поход'), 'the menu offers to continue the run');
  await page.click('#btn-run');
  const back = await page.evaluate(() => { const r = window.heroDebugRun(); return { at: r.at, act: r.act, bag: r.bag.length, phase: r.phase }; });
  check(JSON.stringify(back) === JSON.stringify(mapState), 'a reload on the map restores the run', `${JSON.stringify(mapState)} → ${JSON.stringify(back)}`);

  // reload mid-battle: the battle restarts with the same enemies at full health
  if (back.phase === 'map') {
    await page.evaluate(() => {
      const run = window.heroDebugRun(), C = window.HeroCore;
      const ids = C.reachable(run);
      // make the next node a battle so the check doesn't depend on the map
      run.map.nodes[ids[0]].kind = 'battle';
    });
    await enterNode(page, 'return ids[0];');
    await page.waitForFunction(() => window.heroDebugRun().battle && window.heroDebugRun().battle.t > 1, null, { timeout: 8000 });
    const fight = await page.evaluate(() => window.heroDebugRun().battle.enemies.map((e) => [e.kind, e.maxHp]));
    await page.reload();
    await ready(page);
    await page.click('#btn-run');
    const again = await page.evaluate(() => { const b = window.heroDebugRun().battle; return b ? b.enemies.map((e) => [e.kind, e.hp]) : null; });
    check(JSON.stringify(again) === JSON.stringify(fight), 'a reload mid-battle restarts it with the same enemies', `${JSON.stringify(fight)} → ${JSON.stringify(again)}`);
  }

  // a seeded final boss just above a third of its health: phase 3 comes, the boss falls, «Слава» lands in the save
  await page.evaluate((key) => {
    const C = window.HeroCore;
    const save = C.loadSave(localStorage);
    const run = C.newRun(save, 77);
    run.act = 3;
    run.map = C.genMap(77, 3);
    run.at = run.map.rows[7][0];
    run.hero.level = 15;
    for (const [id, tier] of [['ice_lance', 5], ['holy_hammer', 5], ['scale', 5], ['heal_stone', 5]]) run.bag.push({ uid: run.nextUid++, id, tier });
    const uid = (id) => run.bag.find((x) => x.id === id).uid;
    run.eq.weapon = uid('ice_lance');
    run.eq.armor = uid('scale');
    run.eq.charm = uid('heal_stone');
    run.hero.hp = C.stats(run).maxHp;
    C.choose(run, run.map.rows[8][0]);
    run.encounter[0].hpFrac = 0.34;
    save.current = C.snapshot(run);
    localStorage.setItem(key, JSON.stringify(save));
  }, SAVE_KEY);
  await page.reload();
  await ready(page);
  const glory0 = (await readSave(page)).glory;
  await page.click('#btn-run');
  await page.waitForFunction(() => window.heroDebugRun() && window.heroDebugRun().battle, null, { timeout: 5000 });
  const p0 = await page.evaluate(() => window.heroDebugRun().battle.enemies[0].phase);
  check(p0 === 1, 'the seeded boss starts in its second phase', String(p0));
  // the shadow body shrugs off ice: change to the holy hammer on its quick slot when the phase comes
  await page.waitForFunction(() => { const b = window.heroDebugRun().battle; return !b || b.enemies[0].phase === 2; }, null, { timeout: 60000 }).catch(() => {});
  const holy = await page.evaluate(() => window.HeroCore.quickSlots(window.heroDebugRun()).findIndex((w) => w.id === 'holy_hammer'));
  check(holy >= 0, 'the holy hammer is on a quick slot', String(holy));
  await page.click(`#slots .slot:nth-child(${holy + 1})`);
  check(/Слабость|Защита|Иммунитет/.test(await page.evaluate(() => [...document.querySelectorAll('#foe .tag')].map((t) => t.title).join(' '))),
    'the boss shows its new defences');
  await page.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 60000 }).catch(() => {});
  const res = await page.evaluate(() => ({ title: document.getElementById('res-title').textContent, phase: window.heroDebugRun() && window.heroDebugRun().phase }));
  check(res.phase === 'won' && /Повелитель пепла повержен/.test(res.title), 'the final boss falls and the result shows', JSON.stringify(res));
  const saved = await readSave(page);
  check(saved.glory > glory0 && saved.wins === 1 && saved.current === null && saved.trialsUnlocked === 1,
    '«Слава», the win and the first trial land in hero.save', JSON.stringify({ g: saved.glory, w: saved.wins, c: saved.current, t: saved.trialsUnlocked }));
  await page.click('#btn-res-hall');
  check(await visible(page, 'hall') && (await page.locator('#hall-list .item').count()) === 6, 'the hall of fame lists the six upgrades');

  check(external.length === 0, 'no requests leave the server', external.join('\n'));
  check(errors.length === 0, 'no console errors', errors.join('\n'));
  await ctx.close();
}

async function roPhoneChecks() {
  const { ctx, page, errors, external } = await newPage({ width: 360, height: 720 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await page.goto(`${base}/hero/?lang=ro`);
  await ready(page);
  check(await text(page, '#menu-title') === 'Drumul eroului', 'the menu is in RO');
  await page.tap('#btn-run');
  check(await phase(page) === 'map', 'a tap starts a run on the phone');
  await enterNode(page, 'return ids[ids.length - 1];', true);
  check(await phase(page) === 'battle', 'a tap on a node starts the battle');
  await page.waitForFunction(() => !document.getElementById('battlebar').hidden, null, { timeout: 3000 });
  check(/Oțel/.test(await page.textContent('#slots')), 'the quick slots are in RO');
  const hud = await page.evaluate(() => document.getElementById('hud').offsetHeight);
  check(hud < 80, 'the HUD stays compact at 360 px', String(hud));
  await page.tap('#btn-pause');
  check(await visible(page, 'pause') && await text(page, '#pause-title') === 'Pauză', 'the pause screen is in RO');
  await page.tap('#btn-resume');
  const ph = await walk(page, (p) => p !== 'battle', 60000, true);
  check(['map', 'perk', 'chest', 'loot', 'shrine', 'shop', 'forge', 'camp', 'lost'].includes(ph), 'the battle ends on the phone', ph);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll');
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
