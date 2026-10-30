'use strict';
// The balance of «Аншлаг» as the bots in bot.js play it for 30 minutes: playing on the beat is the fastest way,
// a sloppy player is not far behind, free play is about half as fast, and blind spamming is the slowest.
const test = require('node:test');
const assert = require('node:assert/strict');
const { simulate } = require('./bot.js');

const runs = {};
for (const kind of ['precise', 'sloppy', 'spam', 'free', 'idle']) runs[kind] = simulate(kind, { minutes: 30, seed: 1 });
const minutes = (kind, id) => (runs[kind].firstHire[id] == null ? Infinity : runs[kind].firstHire[id] / 60);

test('a precise player meets the whole band in about a quarter of an hour', () => {
  const r = runs.precise;
  assert.ok(minutes('precise', 'guitar') >= 1.5 && minutes('precise', 'guitar') <= 5, `guitar at ${minutes('precise', 'guitar')}`);
  assert.ok(minutes('precise', 'sax') >= 12 && minutes('precise', 'sax') <= 22, `sax at ${minutes('precise', 'sax')}`);
  assert.ok(r.stats.perfect / r.stats.hits > 0.95);
  assert.ok(r.bpm > 120, `tempo ${r.bpm}: the bot speeds up as it gets richer`);
});

test('the slower you keep time, the slower you go: precise < sloppy < free < spam', () => {
  const keys = (k) => minutes(k, 'keys');
  assert.ok(keys('precise') < keys('sloppy'));
  assert.ok(keys('sloppy') < keys('free'));
  assert.ok(keys('free') < keys('spam'));
  assert.ok(keys('sloppy') <= keys('precise') * 1.8, `sloppy ${keys('sloppy')} vs precise ${keys('precise')}`);
  assert.ok(keys('free') <= keys('precise') * 2.2, `free ${keys('free')}: about half as fast, not hopeless`);
  const total = (k) => runs[k].total;
  assert.ok(total('precise') > total('sloppy') && total('sloppy') > total('free') && total('free') > total('spam'));
  assert.equal(total('idle'), 0, 'without a single tap nothing happens: the first coins come from the bucket');
});

test('spamming never builds a streak; free play never misses', () => {
  assert.ok(runs.spam.best <= 2, `spam best streak ${runs.spam.best}`);
  assert.ok(runs.spam.stats.misses > runs.spam.stats.hits * 3);
  assert.equal(runs.free.stats.misses, 0);
  assert.ok(runs.sloppy.best >= 16, 'a sloppy player still reaches ×3 now and then');
});
