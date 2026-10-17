'use strict';
// Долгая зима: the trader on his sled at the south gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/winter/core.js');

const of = (events, type) => events.filter((e) => e.type === type);
function quiet(seed = 1, diff = 'normal') {
  const g = C.newGame(diff, seed);
  g.animals = [];
  return g;
}
function dawnOf(g, day) {
  g.t = (day - 1) * C.DAY - 0.01;
  g.hero.sleeping = false;
  g.wolves = [];
  C.step(g, 0.05);
  return C.drain(g);
}
const atSled = (g) => { g.hero.x = C.SPOT.trader.x + 0.5; g.hero.y = C.SPOT.trader.y - 0.5; };

test('the trader comes at dawn on his days and leaves at nightfall', () => {
  for (const diff of ['normal', 'harsh']) {
    const days = [];
    const g = quiet(1, diff);
    for (let d = 2; d <= C.DAYS; d++) {
      const ev = dawnOf(g, d);
      if (g.trader) { days.push(d); assert.equal(of(ev, 'trader').length, 1); }
      if (g.event && g.event.phase === 'ask') C.answerEvent(g, C.EVENT_DEFAULT[g.event.id]);
    }
    assert.deepEqual(days, C.TRADER_DAYS[diff]);
  }
  const g = quiet();
  dawnOf(g, 4);
  assert.ok(g.trader);
  assert.equal(g.trader.offers.length, C.TRADE_OFFERS + 1);
  assert.deepEqual(g.trader.offers.at(-1), { ...C.TRADE_FIXED, taken: false });
  g.t = 3 * C.DAY + C.NIGHT_AT - 0.01;
  C.step(g, 0.05);
  assert.equal(g.trader, null);
  assert.equal(of(C.drain(g), 'traderLeft').length, 1);
});

test('his offers repeat for a seed, differ between offers, and never touch the first rng stream', () => {
  const offers = (s) => { const g = quiet(s); dawnOf(g, 4); return { o: JSON.stringify(g.trader.offers), rng: g.rng }; };
  assert.deepEqual(offers(3), offers(3));
  const seen = new Set();
  for (let s = 1; s <= 20; s++) {
    const g = quiet(s);
    dawnOf(g, 4);
    const rolled = g.trader.offers.slice(0, C.TRADE_OFFERS).map((o) => JSON.stringify(o.give));
    assert.equal(new Set(rolled).size, C.TRADE_OFFERS, 'three different trades');
    seen.add(rolled.join('|'));
  }
  assert.ok(seen.size > 5);
  // the first stream is where it would be without the trader: same as a day-4 dawn on a non-trader schedule
  const a = quiet(3, 'harsh');
  dawnOf(a, 4);
  assert.equal(a.trader, null);
  assert.equal(a.rng, offers(3).rng);
});

test('trading: next to the sled, paid from the stock, once per offer, capped by the store', () => {
  let g = null, i = -1;
  for (let s = 1; s < 200 && i < 0; s++) {
    g = quiet(s);
    dawnOf(g, 4);
    i = g.trader.offers.findIndex((o) => o.give.meat === 4 && o.get.metal === 3);
  }
  assert.ok(i >= 0, 'a seed with meat → metal');
  assert.equal(C.trade(g, i), 'far');
  atSled(g);
  g.stock.meat = 3;
  assert.equal(C.trade(g, i), 'nores');
  g.stock.meat = 5;
  const metal = g.stock.metal;
  assert.equal(C.trade(g, i), 'ok');
  assert.deepEqual([g.stock.meat, g.stock.metal], [1, metal + 3]);
  assert.deepEqual(of(C.drain(g), 'traded')[0], { type: 'traded', i, got: { metal: 3 } });
  g.stock.meat = 10;
  assert.equal(C.trade(g, i), 'taken');
  assert.equal(C.trade(g, 99), 'bad');
  assert.equal(C.trade(g, 'x'), 'bad');
  // the fixed offer, into a full store: what doesn't fit is lost
  const f = g.trader.offers.length - 1;
  Object.assign(g.stock, { wood: C.STORE_CAP - 3, stone: 0, metal: 0, hide: 3 });
  assert.equal(C.trade(g, f), 'ok');
  assert.equal(g.stock.metal, 3, 'the 3 hides paid make room for 3 metal; the other 2 are lost');
  g.trader = null;
  assert.equal(C.trade(g, 0), 'gone');
  g.status = 'won';
  assert.equal(C.trade(g, 0), 'bad');
});

test('a tool offer names a tool the hero lacks, or turns into metal when he has them all', () => {
  let g = null;
  for (let s = 1; s < 300; s++) {
    const h = quiet(s);
    for (const k of Object.keys(C.TOOLS)) h.tools[k] = k !== 'spear';
    dawnOf(h, 4);
    if (h.trader.offers.some((o) => o.give.meat === 6)) { g = h; break; }
  }
  assert.ok(g, 'a seed with the tool offer');
  const i = g.trader.offers.findIndex((o) => o.give.meat === 6);
  assert.deepEqual(g.trader.offers[i].get, { tool: 'spear' });
  atSled(g);
  g.stock.meat = 6;
  assert.equal(C.trade(g, i), 'ok');
  assert.equal(g.tools.spear, true);
  let h = null;
  for (let s = 1; s < 300; s++) {
    const k = quiet(s);
    for (const t of Object.keys(C.TOOLS)) k.tools[t] = true;
    dawnOf(k, 4);
    if (k.trader.offers.some((o) => o.give.meat === 6)) { h = k; break; }
  }
  assert.deepEqual(h.trader.offers.find((o) => o.give.meat === 6).get, C.TRADE_NO_TOOL);
});

test('the trader shows in the hints, the tap on the sled walks to him, and he survives a save', () => {
  const g = quiet();
  dawnOf(g, 4);
  g.stock.hide = 3;
  assert.equal(C.nextTask(g), 'Торговец у ворот');
  assert.equal(C.interact(g, C.SPOT.trader.x, C.SPOT.trader.y), 'trader');
  const back = C.restore(JSON.parse(JSON.stringify(C.snapshot(g))));
  assert.deepEqual(back.trader, g.trader);
  const old = JSON.parse(JSON.stringify(C.snapshot(g)));
  delete old.trader;
  assert.equal(C.restore(old).trader, null);
  const snap = C.snapshot(g);
  const o = snap.trader.offers;
  for (const bad of [{ ...snap, trader: { ...snap.trader, x: 3 } }, { ...snap, trader: { ...snap.trader, offers: o.slice(1) } },
    { ...snap, trader: { ...snap.trader, offers: [{ ...o[0], give: { gold: 1 } }, ...o.slice(1)] } },
    { ...snap, trader: { ...snap.trader, offers: [{ ...o[0], get: { tool: 'sword' } }, ...o.slice(1)] } },
    { ...snap, trader: { ...snap.trader, offers: [{ ...o[0], taken: 'no' }, ...o.slice(1)] } }]) {
    assert.equal(C.restore(bad), null);
  }
});
