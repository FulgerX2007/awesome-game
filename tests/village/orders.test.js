'use strict';
// Villager orders on the market board: posting, filling, limits, offline and saves.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');

const { DAY } = V;

// A village with everything up to the market standing (no chapel) and its two villagers at home.
function village(seed = 1) {
  const s = V.newGame(seed);
  for (const id of V.BUILDING_IDS) {
    if (id === 'chapel' || id === 'house3' || id === 'market' || V.BUILDINGS[id].after === 'harvest') continue; // no lake: orders at dawn only
    s.built[id].done = true;
    for (const r of Object.keys(s.built[id].paid)) s.built[id].paid[r] = V.BUILDINGS[id].cost[r];
  }
  s.villagers = [{ role: 'woodcutter', house: 'house1' }, { role: 'mason', house: 'house2' }];
  s.stats.gathered.apples = 1;
  return s;
}
function openMarket(s) {
  for (const [r, n] of Object.entries(V.BUILDINGS.market.cost)) s.res[r] += n;
  assert.equal(V.contribute(s, 'market'), 'built');
}
const kinds = (s, type) => s.events.filter((e) => e.type === type);

test('the market opens with orders, and a new one comes each dawn up to the limit', () => {
  const s = village();
  assert.deepEqual(s.orders, []);
  V.step(s, DAY + 1);
  assert.deepEqual(s.orders, [], 'no orders without the market');
  openMarket(s);
  assert.equal(s.orders.length, V.ORDERS.atMarket);
  V.step(s, DAY);
  assert.equal(s.orders.length, V.ORDERS.atMarket + 1);
  V.step(s, DAY * 5);
  assert.equal(s.orders.length, V.ORDERS.max, 'never more than the limit');
  assert.ok(kinds(s, 'order-new').length >= V.ORDERS.max);
  assert.ok(V.BUILDINGS.chapel.needs.includes('market'), 'the festival needs the market');
});

test('orders ask only for goods the player can get, from the villagers living here', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const s = village(seed);
    openMarket(s);
    V.step(s, DAY * 4);
    const goods = new Set(V.openGoods(s));
    for (const o of s.orders) {
      assert.ok(['woodcutter', 'mason'].includes(o.who), o.who);
      assert.ok(o.reward.coins >= 1);
      for (const [r, n] of Object.entries(o.need)) {
        assert.ok(goods.has(r), `seed ${seed}: ${r} is open`);
        assert.ok(Number.isInteger(n) && n > 0 && n <= s.storage, `${r}: ${n}`);
      }
    }
  }
  // Early on, before the bridge and the workshops, only the meadow's goods.
  assert.deepEqual(V.openGoods(V.newGame(1)), ['wood', 'stone', 'berries']);
});

test('fulfill pays the goods and gives the coins; errors leave the state alone', () => {
  const s = village();
  openMarket(s);
  const o = s.orders[0];
  for (const r of Object.keys(o.need)) s.res[r] = 0;
  assert.equal(V.fulfill(s, o.id), 'cost');
  assert.equal(s.orders.length, V.ORDERS.atMarket);
  for (const [r, n] of Object.entries(o.need)) s.res[r] = n + 3;
  const coins = s.res.coins;
  assert.equal(V.fulfill(s, o.id), 'ok');
  for (const r of Object.keys(o.need)) assert.equal(s.res[r], 3);
  assert.equal(s.res.coins, coins + o.reward.coins);
  assert.equal(s.stats.orders, 1);
  assert.ok(!s.orders.some((q) => q.id === o.id));
  assert.equal(kinds(s, 'order').length, 1);
  assert.equal(V.fulfill(s, o.id), 'none', 'already filled');
  assert.equal(V.fulfill(s, 999), 'none');
});

test('offline posts orders at each dawn just like step()', () => {
  const a = village(4), b = village(4);
  openMarket(a); openMarket(b);
  a.orders.splice(0); b.orders.splice(0);
  V.offline(a, DAY * 2 + 5);
  V.step(b, DAY * 2 + 5);
  assert.deepEqual(a.orders, b.orders);
  assert.equal(a.orders.length, 2);
  assert.equal(a.rng, b.rng);
});

test('orders survive a save; junk orders are dropped', () => {
  const s = village();
  openMarket(s);
  const back = V.load(JSON.parse(JSON.stringify(V.save(s))));
  assert.deepEqual(back.orders, s.orders);
  assert.equal(back.orderSeq, s.orderSeq);
  const junk = V.load({
    ...V.save(s),
    orders: [
      s.orders[0], s.orders[0], // a duplicate
      { id: 50, who: 'x', need: { wood: 5 }, reward: { coins: 2 } }, // id above the counter
      { id: 1, need: { gold: 5 }, reward: { coins: 2 } },
      { id: 2, need: { wood: -5 }, reward: { coins: 2 } },
      { id: 2, need: {}, reward: { coins: 2 } },
      null, 'x',
    ],
  });
  assert.deepEqual(junk.orders, [s.orders[0]]);
});

// ── Fair ──
const SEASON = DAY * V.SEASON_DAYS;

test('the fair is open on a season’s first day while it is light, once the market stands', () => {
  const s = village();
  s.t = SEASON + DAY * 0.3;
  assert.equal(V.fairOpen(s), false, 'no market');
  openMarket(s);
  assert.equal(V.fairOpen(s), true);
  s.t = SEASON + DAY * 0.8; // dusk
  assert.equal(V.fairOpen(s), false);
  s.t = SEASON + DAY * 1.3; // the second day
  assert.equal(V.fairOpen(s), false);
  for (let k = 0; k < 8; k++) { s.t = SEASON * k + DAY * 0.4; assert.equal(V.fairOpen(s), true, `season ${k}`); }
});

test('buy: closed, not enough coins, bought once; cuttings at every fair', () => {
  const s = village();
  openMarket(s);
  s.t = DAY * 1.4;
  s.res.coins = 100;
  assert.equal(V.buy(s, 'cuttings'), 'closed');
  s.t = SEASON + DAY * 0.4;
  s.res.coins = V.FAIR.cuttings.price - 1;
  assert.equal(V.buy(s, 'cuttings'), 'coins');
  s.res.coins = 100;
  assert.equal(V.buy(s, 'cuttings'), 'ok');
  assert.equal(s.res.coins, 100 - V.FAIR.cuttings.price);
  assert.deepEqual(s.bought, ['cuttings']);
  assert.equal(V.buy(s, 'cuttings'), 'owned');
  assert.equal(V.buy(s, 'gold'), 'unknown');
  assert.ok(s.events.some((e) => e.type === 'buy' && e.id === 'cuttings'));
  // Every fair sells the cuttings: a fresh village can buy them at any season's fair.
  for (let k = 1; k <= 4; k++) {
    const t = village(k);
    openMarket(t);
    t.t = SEASON * k + DAY * 0.2;
    t.res.coins = 50;
    assert.equal(V.buy(t, 'cuttings'), 'ok');
  }
});

test('the big bucket holds more; fair decorations need buying first', () => {
  const s = village();
  openMarket(s);
  s.t = SEASON + DAY * 0.4;
  s.res.coins = 100;
  assert.equal(V.bucketSize(s), V.GARDEN.bucket);
  V.buy(s, 'bucket');
  assert.equal(V.bucketSize(s), V.BIG_BUCKET);
  V.fillBucket(s);
  assert.equal(s.bucket, V.BIG_BUCKET);
  s.festival = true;
  const sq = (() => { for (let y = 0; y < V.H; y++) for (let x = 0; x < V.W; x++) if (V.tileAt(x, y) === '#' && !V.ruinAt(x, y)) return { x, y }; })();
  s.res.planks = 100; s.res.wood = 100;
  assert.equal(V.placeDecor(s, 'swing', sq.x, sq.y), 'locked', 'not bought yet');
  V.buy(s, 'swing');
  assert.equal(V.placeDecor(s, 'swing', sq.x, sq.y), 'ok');
  assert.equal(V.placeDecor(s, 'bench', sq.x + 1, sq.y), 'ok', 'old decorations need nothing');
});

test('purchases survive a save; unknown ones are dropped; the bucket fits its size', () => {
  const s = village();
  s.bought = ['bucket', 'arch'];
  s.bucket = 9;
  const back = V.load(JSON.parse(JSON.stringify(V.save(s))));
  assert.deepEqual(back.bought, ['bucket', 'arch']);
  assert.equal(back.bucket, 9);
  const junk = V.load({ ...V.save(s), bought: ['arch', 'arch', 'gold', 5], bucket: 9 });
  assert.deepEqual(junk.bought, ['arch']);
  assert.equal(junk.bucket, 0, 'no big bucket: 9 does not fit');
});
