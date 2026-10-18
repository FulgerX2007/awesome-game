'use strict';
// The world clock: days, parts of the day and seasons, and the dawn/season hooks in step() and offline().
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/village/core.js');

const { DAY, SEASON_DAYS, SEASONS } = V;
const YEAR = DAY * SEASON_DAYS * SEASONS.length;

test('a new game starts on a spring dawn of day 0', () => {
  const c = V.clock(V.newGame(1).t);
  assert.deepEqual([c.day, c.part, c.season, c.seasonDay, c.year], [0, 'dawn', 'spring', 0, 0]);
});

test('parts of the day follow the phase boundaries', () => {
  const at = (f) => V.clock(DAY * 5 + DAY * f).part;
  assert.equal(at(0), 'dawn');
  assert.equal(at(V.DAWN_END - 1e-6), 'dawn');
  assert.equal(at(V.DAWN_END), 'day');
  assert.equal(at(V.DUSK_START - 1e-6), 'day');
  assert.equal(at(V.DUSK_START), 'dusk');
  assert.equal(at(V.NIGHT_START), 'night');
  assert.equal(at(0.999), 'night');
  assert.equal(V.clock(DAY * 5).day, 5);
  assert.ok(Math.abs(V.clock(DAY * 5.5).phase - 0.5) < 1e-9);
});

test('seasons turn every SEASON_DAYS days and the year wraps', () => {
  for (let i = 0; i < SEASONS.length; i++) {
    const first = V.clock(i * SEASON_DAYS * DAY);
    const last = V.clock((i + 1) * SEASON_DAYS * DAY - 1);
    assert.equal(first.season, SEASONS[i]);
    assert.equal(first.seasonDay, 0);
    assert.equal(last.season, SEASONS[i]);
    assert.equal(last.seasonDay, SEASON_DAYS - 1);
  }
  const next = V.clock(YEAR + 1);
  assert.deepEqual([next.season, next.year, next.seasonDay], ['spring', 1, 0]);
  // Junk times read as the very start.
  assert.equal(V.clock(-50).day, 0);
  assert.equal(V.clock('x').day, 0);
});

const kinds = (events, type) => events.filter((e) => e.type === type);

test('step() raises one dawn per new day and one season event per new season', () => {
  const s = V.newGame(1);
  V.step(s, SEASON_DAYS * DAY + 10); // through the whole spring into summer
  const dawns = kinds(s.events, 'dawn');
  assert.deepEqual(dawns.map((e) => e.day), [1, 2, 3]);
  assert.deepEqual(kinds(s.events, 'season').map((e) => e.season), ['summer']);
  // The season event comes before that day's dawn.
  const iSeason = s.events.findIndex((e) => e.type === 'season');
  const iDawn3 = s.events.findIndex((e) => e.type === 'dawn' && e.day === 3);
  assert.ok(iSeason < iDawn3);
});

test('a large step does not skip or double a dawn', () => {
  const s = V.newGame(2);
  s.t = DAY - 0.01;
  V.step(s, 0.02);
  assert.equal(kinds(s.events, 'dawn').length, 1);
  s.events.length = 0;
  V.step(s, 0.02);
  assert.equal(kinds(s.events, 'dawn').length, 0);
});

test('offline() passes the same dawns quietly and reports them', () => {
  const a = V.newGame(3), b = V.newGame(3);
  a.t = b.t = DAY - 100;
  const r = V.offline(a, 2 * DAY);
  assert.equal(r.days, 2);
  assert.equal(kinds(a.events, 'dawn').length, 0, 'offline adds no events');
  V.step(b, 2 * DAY);
  assert.equal(kinds(b.events, 'dawn').length, r.days);
  assert.equal(V.clock(a.t).day, V.clock(b.t).day);
  // Through a whole year away (capped at 8 hours): the clock lands on the same season either way.
  const c = V.newGame(4);
  const rc = V.offline(c, V.OFFLINE_MAX);
  assert.equal(rc.days, Math.floor(V.OFFLINE_MAX / DAY));
  assert.equal(V.clock(c.t).season, V.clock(V.OFFLINE_MAX).season);
});
