'use strict';
// Fishing at the lake: cast, wait, bite, strike — or the fish gets away and the line goes back in.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');

const DT = V.MAX_DT;
// The lake open: everything up to the harvest festival, the glade and the pier.
function lake(seed = 1, rod = 1) {
  const s = V.newGame(seed);
  for (const id of V.BUILDING_IDS) {
    if (['smokehouse', 'house6', 'boathouse', 'pavilion'].includes(id)) continue;
    s.built[id].done = true;
    for (const r of Object.keys(s.built[id].paid)) s.built[id].paid[r] = V.BUILDINGS[id].cost[r];
  }
  s.bought = ['cuttings'];
  s.festival = true; s.harvestFestival = true;
  s.tools.rod = rod;
  s.villagers = [];
  s.t = V.DAY * 12 + V.DAY * 0.1; // spring of the second year, morning
  return s;
}
// A shore spot (one the player can reach without the pier).
const shoreShoal = (s) => s.nodes.find((n) => n.kind === 'shoal' && [[0, -1], [-1, 0], [1, 0], [0, 1]].some(([dx, dy]) => V.tileAt(n.x + dx, n.y + dy) === ':'));
// Step until an event of one of the types happens; returns it (or null after `limit` seconds).
function until(s, types, limit = 60) {
  const want = [].concat(types);
  for (let t = 0; t < limit; t += DT) {
    s.events.length = 0;
    V.step(s, DT);
    const e = s.events.find((ev) => want.includes(ev.type));
    if (e) return e;
  }
  return null;
}
function startFishing(s, n = shoreShoal(s)) {
  assert.equal(V.interact(s, n.x, n.y), 'fish');
  assert.ok(until(s, 'cast', 120), 'the line goes in once the player is there');
  return n;
}

test('a strike on the bite lands a fish and the line goes back in', () => {
  const s = lake();
  const n = startFishing(s);
  assert.equal(s.player.fish.phase, 'wait');
  assert.ok(until(s, 'bite'), 'a bite comes');
  assert.equal(s.player.fish.phase, 'bite');
  const before = s.res.fish;
  s.events.length = 0;
  assert.equal(V.strike(s), 'catch');
  assert.equal(s.res.fish, before + V.TOOL_YIELD[1]);
  assert.equal(n.hp, V.NODE_KINDS.shoal.hp - 1);
  assert.equal(s.stats.gathered.fish, V.TOOL_YIELD[1]);
  assert.deepEqual(s.events.map((e) => e.type), ['catch', 'cast']);
  assert.equal(s.player.fish.phase, 'wait');
});

test('the wait for a bite stays within FISHING.wait', () => {
  const s = lake(4);
  startFishing(s);
  for (let k = 0; k < 10; k++) {
    const t0 = s.t;
    assert.ok(until(s, 'bite'));
    const waited = s.t - t0;
    assert.ok(waited >= V.FISHING.wait[0] - DT && waited <= V.FISHING.wait[1] + DT, `waited ${waited}`);
    V.strike(s);
    if (!s.player.fish) break; // the shoal is empty
  }
});

test('missing the window: the fish gets away, the line goes back in; three in a row and the player gives up', () => {
  const s = lake();
  startFishing(s);
  for (let k = 1; k <= V.FISHING.giveUp; k++) {
    assert.ok(until(s, 'bite'));
    const bite = s.t;
    const e = until(s, ['escape', 'catch']);
    assert.equal(e.type, 'escape');
    assert.equal(e.misses, k);
    assert.ok(Math.abs(s.t - bite - V.FISHING.window[1]) <= DT * 1.5, `window ${s.t - bite}`);
    if (k < V.FISHING.giveUp) {
      assert.ok(s.events.some((ev) => ev.type === 'cast'), 'the line goes back in');
      assert.equal(s.player.fish.misses, k);
    }
  }
  assert.ok(s.events.some((e) => e.type === 'gone'));
  assert.equal(s.player.target, null);
  assert.equal(s.player.fish, null);
  assert.equal(V.strike(s), 'none');
});

test('a catch resets the misses', () => {
  const s = lake();
  startFishing(s);
  until(s, 'bite');
  until(s, 'escape');
  assert.equal(s.player.fish.misses, 1);
  until(s, 'bite');
  V.strike(s);
  assert.equal(s.player.fish.misses, 0);
});

test('a strike before the bite scares the fish: a longer wait', () => {
  const s = lake();
  startFishing(s);
  const at = s.player.fish.at;
  s.events.length = 0;
  assert.equal(V.strike(s), 'early');
  assert.equal(s.player.fish.at, at + V.FISHING.early);
  assert.equal(s.events[0].type, 'early');
  assert.equal(s.player.fish.phase, 'wait');
});

test('a strike on the last moment of the window still lands the fish', () => {
  const s = lake();
  startFishing(s);
  until(s, 'bite');
  // Step up to just before the window closes.
  while (s.t + DT < s.player.fish.at - 1e-6) V.step(s, DT);
  assert.equal(s.player.fish.phase, 'bite');
  assert.equal(V.strike(s), 'catch');
});

test('a better rod: a wider window and more fish a bite', () => {
  for (const lvl of [1, 2, 3]) {
    const s = lake(1, lvl);
    startFishing(s);
    until(s, 'bite');
    const bite = s.t;
    until(s, 'escape');
    assert.ok(Math.abs(s.t - bite - V.FISHING.window[lvl]) <= DT * 1.5, `level ${lvl}: window ${s.t - bite}`);
    until(s, 'bite');
    const before = s.res.fish;
    V.strike(s);
    assert.equal(s.res.fish - before, V.TOOL_YIELD[lvl]);
  }
  assert.ok(V.FISHING.window[1] < V.FISHING.window[2] && V.FISHING.window[2] < V.FISHING.window[3]);
});

test('an empty shoal ends the fishing and comes back later', () => {
  const s = lake();
  const n = startFishing(s);
  for (let k = 0; k < V.NODE_KINDS.shoal.hp; k++) {
    assert.ok(until(s, 'bite'));
    s.events.length = 0;
    V.strike(s);
  }
  assert.equal(n.hp, 0);
  assert.ok(s.events.some((e) => e.type === 'deplete'));
  assert.equal(s.player.target, null);
  assert.ok(n.regrowAt > s.t);
  assert.equal(V.interact(s, n.x, n.y), 'none', 'nothing to fish there now');
  V.step(s, V.NODE_KINDS.shoal.regrow[1] + 1);
  assert.equal(n.hp, V.NODE_KINDS.shoal.hp, 'the fish come back');
});

test('the same seed fishes the same way', () => {
  const log = () => {
    const s = lake(9);
    startFishing(s);
    const out = [];
    for (let t = 0; t < 60; t += DT) {
      s.events.length = 0;
      V.step(s, DT);
      for (const e of s.events) {
        out.push(`${e.type}@${s.t.toFixed(2)}`);
        if (e.type === 'bite' && out.length % 2) V.strike(s); // strike every other bite
      }
    }
    return out;
  };
  const a = log(), b = log();
  assert.ok(a.length > 10);
  assert.deepEqual(a, b);
});

test('a new tap, keys, reeling in or closing the game end the fishing; it is never saved', () => {
  const tapAway = lake();
  startFishing(tapAway);
  assert.equal(V.goTo(tapAway, V.START.x, V.START.y), true);
  assert.equal(tapAway.player.fish, null);
  assert.equal(tapAway.player.target, null);

  const keys = lake();
  startFishing(keys);
  V.moveDir(keys, 1, 0);
  assert.equal(keys.player.fish, null);
  assert.equal(V.strike(keys), 'none');

  const reel = lake();
  startFishing(reel);
  assert.equal(V.stopFishing(reel), 'ok');
  assert.equal(reel.player.fish, null);
  assert.equal(V.stopFishing(reel), 'none');

  const away = lake();
  startFishing(away);
  V.offline(away, 600);
  assert.equal(away.player.fish, null);
  assert.equal(away.player.target, null);
  V.step(away, 30);
  assert.equal(away.events.filter((e) => e.type === 'bite' || e.type === 'escape').length, 0, 'no stale bite after coming back');

  const saved = lake();
  startFishing(saved);
  const back = V.load(V.save(saved));
  assert.equal(back.player.fish, undefined);
  assert.equal(back.player.target, null);
});

test('no rod, no fishing; strike without a line does nothing', () => {
  const s = lake(1, 0);
  const n = shoreShoal(s);
  assert.equal(V.interact(s, n.x, n.y), 'tool');
  assert.equal(V.strike(s), 'none');
  assert.equal(V.stopFishing(s), 'none');
  // Walking up to a shoal (not yet there) is not fishing either.
  s.tools.rod = 1;
  V.interact(s, n.x, n.y);
  assert.equal(V.strike(s), 'none');
});

test('fishing goes on in winter (through the ice) and across the night into a new day', () => {
  const s = lake(1);
  const n = shoreShoal(s);
  const [dx, dy] = [[0, -1], [-1, 0], [1, 0], [0, 1]].find(([ax, ay]) => V.tileAt(n.x + ax, n.y + ay) === ':');
  s.player.x = n.x + dx + 0.5; s.player.y = n.y + dy + 0.5; // already on the shore
  s.t = V.DAY * (V.SEASON_DAYS * 4 - 1) - 1; // a second before the last dawn of winter
  assert.equal(V.clock(s.t).season, 'winter');
  startFishing(s, n);
  const day = V.clock(s.t).day;
  let caught = 0;
  for (let k = 0; k < 3 && s.player.fish; k++) {
    assert.ok(until(s, 'bite'), 'bites come in winter too');
    if (V.strike(s) === 'catch') caught++;
  }
  assert.ok(caught >= 1);
  assert.ok(V.clock(s.t).day > day, 'the dawn passed while fishing');
});
