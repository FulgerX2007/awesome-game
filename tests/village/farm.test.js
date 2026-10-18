'use strict';
// The garden: plots, the bucket at the well, growth by water and season, dawn, offline, save.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');

const { DAY, SEASON_DAYS } = V;
const SUMMER = DAY * SEASON_DAYS, WINTER = DAY * SEASON_DAYS * 3;

// A game with the well and the garden standing, some berries for seed, at a given time.
function farm(seed = 1, t = DAY * 0.2) {
  const s = V.newGame(seed);
  for (const id of ['well', 'garden']) {
    s.built[id].done = true;
    for (const r of Object.keys(s.built[id].paid)) s.built[id].paid[r] = V.BUILDINGS[id].cost[r];
  }
  s.res.berries = 10;
  s.t = t;
  return s;
}
const kinds = (s, type) => s.events.filter((e) => e.type === type);

test('the map has six plots next to the garden, none walkable', () => {
  assert.equal(V.PLOTS.length, 6);
  const fp = V.FOOTPRINTS.garden;
  assert.ok(fp.length === 4);
  for (const p of V.PLOTS) {
    assert.equal(V.tileAt(p.x, p.y), 'g');
    assert.equal(V.isWalkable(V.newGame(1), p.x, p.y), false);
    assert.ok(Math.min(...fp.map((f) => Math.abs(f.x - p.x) + Math.abs(f.y - p.y))) <= 4, 'close to the garden');
    assert.equal(V.plotAt(p.x, p.y), V.PLOTS.indexOf(p));
  }
  assert.equal(V.plotAt(0, 0), -1);
  assert.ok(V.BUILDINGS.chapel.needs.includes('garden'), 'the festival needs the garden');
});

test('a plot goes sown → watered → ripe → harvested', () => {
  const s = farm();
  assert.equal(V.tendPlot(s, 0), 'sown');
  assert.equal(s.res.berries, 9, 'a berry is the seed');
  assert.equal(V.tendPlot(s, 0), 'bucket', 'no water yet');
  assert.equal(V.fillBucket(s), 'ok');
  assert.equal(s.bucket, V.bucketSize(s));
  assert.equal(V.fillBucket(s), 'full');
  assert.equal(V.tendPlot(s, 0), 'watered');
  assert.equal(s.bucket, V.bucketSize(s) - 1);
  assert.equal(V.tendPlot(s, 0), 'growing');
  V.step(s, DAY * 0.5); // the rest of the morning and the day: half grown
  assert.equal(s.plots[0].stage, 'planted');
  assert.ok(Math.abs(s.plots[0].grow - 0.5) < 0.01);
  V.step(s, DAY * 0.3); // dawn dries it before it ripens
  assert.equal(s.plots[0].water, false, 'water soaks away at dawn');
  const g = s.plots[0].grow;
  V.step(s, DAY * 0.2);
  assert.equal(s.plots[0].grow, g, 'a dry plot does not grow');
  assert.equal(V.tendPlot(s, 0), 'watered');
  V.step(s, DAY * 0.6);
  assert.equal(s.plots[0].stage, 'ripe');
  assert.equal(kinds(s, 'ripe').length, 1);
  assert.equal(V.tendPlot(s, 0), 'harvest');
  assert.equal(s.res.vegetables, V.GARDEN.harvest[1]);
  assert.equal(s.stats.gathered.vegetables, V.GARDEN.harvest[1]);
  assert.deepEqual(s.plots[0], { stage: 'empty', water: false, grow: 0 });
});

test('a better basket brings more vegetables', () => {
  for (const level of [1, 2, 3]) {
    const s = farm();
    s.tools.basket = level;
    s.plots[2] = { stage: 'ripe', water: false, grow: 1 };
    V.tendPlot(s, 2);
    assert.equal(s.res.vegetables, V.GARDEN.harvest[level]);
  }
});

test('seasons: faster in summer, nothing sown or grown in winter', () => {
  const sum = farm(1, SUMMER + DAY * 0.1);
  V.tendPlot(sum, 0); V.fillBucket(sum); V.tendPlot(sum, 0);
  V.step(sum, DAY * 0.5);
  assert.ok(Math.abs(sum.plots[0].grow - 0.5 * V.GARDEN.grow.summer) < 0.01);

  const win = farm(1, WINTER + DAY * 0.1);
  assert.equal(V.tendPlot(win, 0), 'winter');
  assert.equal(win.res.berries, 10, 'no seed spent');
  win.plots[1] = { stage: 'planted', water: true, grow: 0.4 };
  V.step(win, DAY * 0.5);
  assert.equal(win.plots[1].grow, 0.4, 'a sown plot waits out the winter');
});

test('errors: no garden, no berries, unknown plot', () => {
  const s = V.newGame(1);
  s.res.berries = 5;
  assert.equal(V.tendPlot(s, 0), 'locked');
  assert.equal(V.fillBucket(s), 'locked');
  s.built.well.done = true;
  assert.equal(V.fillBucket(s), 'locked', 'the well fills buckets only once there is a garden');
  const f = farm();
  f.res.berries = 0;
  assert.equal(V.tendPlot(f, 0), 'seed');
  assert.equal(V.tendPlot(f, 99), 'unknown');
});

test('interact walks to a plot or the well and tends it on arrival', () => {
  const s = farm();
  s.player.x = V.START.x + 0.5; s.player.y = V.START.y + 0.5;
  const p = V.PLOTS[0];
  assert.equal(V.interact(s, p.x, p.y), 'plot');
  for (let i = 0; i < 400 && (s.player.path || s.player.target); i++) V.step(s, 0.05);
  assert.equal(s.plots[0].stage, 'planted');
  const w = V.FOOTPRINTS.well[0];
  assert.equal(V.interact(s, w.x, w.y), 'well');
  for (let i = 0; i < 400 && (s.player.path || s.player.target); i++) V.step(s, 0.05);
  assert.equal(s.bucket, V.bucketSize(s));
  // Without a garden the plots are part of its ruin and the well is a ruin to open.
  const t = V.newGame(1);
  assert.equal(V.interact(t, p.x, p.y), 'ruin');
  t.built.well.done = true;
  assert.equal(V.interact(t, w.x, w.y), 'ruin');
});

test('offline grows watered plots just like step()', () => {
  const make = () => {
    const s = farm(3, DAY * 0.5);
    s.plots[0] = { stage: 'planted', water: true, grow: 0.2 };  // ripens before dawn? no: dries at dawn
    s.plots[1] = { stage: 'planted', water: true, grow: 0.7 };  // ripens before dawn
    s.plots[2] = { stage: 'planted', water: false, grow: 0.5 }; // dry: waits
    return s;
  };
  const a = make(), b = make();
  V.offline(a, DAY * 2);
  V.step(b, DAY * 2);
  const round = (plots) => plots.map((p) => ({ ...p, grow: +p.grow.toFixed(6) })); // float drift only
  assert.deepEqual(round(a.plots), round(b.plots));
  assert.equal(a.plots[1].stage, 'ripe');
  assert.equal(a.plots[2].grow, 0.5);
  assert.equal(a.plots[0].water, false);
});

test('plots and the bucket survive a save; junk is cleaned', () => {
  const s = farm();
  s.bucket = 4;
  s.plots[0] = { stage: 'planted', water: true, grow: 0.3 };
  s.plots[1] = { stage: 'ripe', water: false, grow: 1 };
  const back = V.load(JSON.parse(JSON.stringify(V.save(s))));
  assert.deepEqual(back.plots, s.plots);
  assert.equal(back.bucket, 4);
  const junk = V.load({ ...V.save(s), bucket: 99, plots: [{ stage: 'gold' }, null, { stage: 'planted', grow: 5, water: 'yes' }, {}, {}, {}] });
  assert.equal(junk.bucket, 0);
  assert.deepEqual(junk.plots[0], { stage: 'empty', water: false, grow: 0 });
  assert.equal(junk.plots[2].water, false);
  assert.ok(junk.plots[2].grow < 1);
  assert.equal(V.load({ ...V.save(s), plots: [{}] }).plots.length, V.PLOTS.length, 'a wrong length gives fresh plots');
});

// ── Apiary and apples ──
function withApiary(t) {
  const s = farm(1, t);
  s.built.apiary.done = true;
  return s;
}

test('the apiary makes honey on its own, except in winter, up to the barn limit', () => {
  const pr = V.PRODUCERS.apiary;
  const s = withApiary(DAY * 0.1);
  V.step(s, 600);
  assert.equal(s.res.honey, Math.floor(600 * pr.rate + 1e-6));
  const w = withApiary(WINTER + DAY * 0.1);
  V.step(w, 600);
  assert.equal(w.res.honey, 0, 'bees sleep in winter');
  const full = withApiary(DAY * 0.1);
  full.res.honey = full.storage;
  V.step(full, 600);
  assert.equal(full.res.honey, full.storage);
  assert.deepEqual(V.rates(full).full, ['honey']);
  assert.ok(Math.abs(V.rates(withApiary(DAY * 0.1)).rate.honey - pr.rate) < 1e-9);
  assert.deepEqual(V.rates(withApiary(WINTER + 10)).rate, {});
});

test('the apiary needs the garden and the woodcutter, and the festival needs it', () => {
  assert.deepEqual(V.BUILDINGS.apiary.needs.slice().sort(), ['garden', 'house1']);
  assert.ok(V.BUILDINGS.chapel.needs.includes('apiary'));
  const ids = V.BUILDING_IDS;
  for (const id of ids) for (const d of V.BUILDINGS[id].needs) assert.ok(ids.indexOf(d) < ids.indexOf(id), `${d} before ${id}`);
  // Late buildings ask for the farm's goods.
  assert.ok(V.BUILDINGS.house3.cost.vegetables > 0);
  for (const r of ['vegetables', 'honey', 'apples']) assert.ok(V.BUILDINGS.chapel.cost[r] > 0, r);
});

test('apple trees bear fruit only in summer and autumn', () => {
  const s = V.newGame(2);
  const apples = s.nodes.filter((n) => n.kind === 'apple');
  assert.ok(apples.length >= 3);
  assert.ok(apples.every((n) => n.hp === 0), 'bare in the first spring');
  V.step(s, SUMMER + 120);
  assert.ok(apples.every((n) => n.hp === V.NODE_KINDS.apple.hp), 'ripe in summer');
  // Picked bare in autumn, they wait out winter and spring.
  const t = V.newGame(2);
  t.t = WINTER - 100;
  const a = t.nodes.find((n) => n.kind === 'apple');
  a.hp = 0; a.regrowAt = WINTER + 50;
  V.step(t, 300);
  assert.equal(a.hp, 0);
  assert.ok(a.regrowAt >= DAY * SEASON_DAYS * 5, 'back next summer');
});

test('offline through winter keeps honey and apples in step with step()', () => {
  const make = () => {
    const s = withApiary(WINTER - 600);
    const a = s.nodes.find((n) => n.kind === 'apple');
    a.hp = 0; a.regrowAt = WINTER - 300;
    return s;
  };
  const a = make(), b = make();
  const span = DAY * SEASON_DAYS * 3; // winter, spring and into summer
  V.offline(a, span);
  V.step(b, span);
  assert.equal(a.res.honey, b.res.honey);
  assert.deepEqual(a.nodes.filter((n) => n.kind === 'apple').map((n) => n.hp), b.nodes.filter((n) => n.kind === 'apple').map((n) => n.hp));
});
