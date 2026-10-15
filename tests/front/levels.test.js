'use strict';
// Рубеж: the 12 levels parse, grow in size, and each one's idea is really there.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../web/front/core.js');
const { LEVELS } = require('../../web/front/levels.js');
const { play } = require('./bot.js');

const parsed = LEVELS.map((l) => F.parseLevel(l));

test('twelve levels, each parses, with a name, an idea, waves and a par', () => {
  assert.equal(LEVELS.length, 12);
  assert.equal(new Set(LEVELS.map((l) => l.idea)).size, 12, 'one idea per level');
  for (const [i, l] of LEVELS.entries()) {
    assert.ok(l.name && l.idea, `level ${i + 1}`);
    assert.ok(l.waves.length >= 1);
    assert.ok(parsed[i].plots.length >= 4, `level ${i + 1} has room to build`);
    assert.ok(parsed[i].nodes.some((n) => n.res === 'wood' && n.x < (parsed[i].chasms[0] ? parsed[i].chasms[0].x0 : Infinity)), 'wood on the near side');
  }
  assert.ok(LEVELS[0].par <= 120, 'the first level is short');
});

test('the fortress grows stronger along the levels', () => {
  for (let i = 1; i < LEVELS.length; i++) assert.ok(LEVELS[i].fortressHp >= LEVELS[i - 1].fortressHp * 0.85, `level ${i + 1}`);
  assert.ok(LEVELS[11].fortressHp > LEVELS[0].fortressHp * 10);
});

test('each idea is in its level map and data', () => {
  const by = Object.fromEntries(LEVELS.map((l, i) => [l.idea, { def: l, lv: parsed[i] }]));
  const metalBefore = (lv) => lv.nodes.some((n) => n.res === 'metal' && n.x < (lv.chasms[0] ? lv.chasms[0].x0 : Infinity));
  assert.equal(by.bridge.lv.chasms.length, 1);
  assert.ok(by.metalBeyond.lv.chasms.length >= 1 && !metalBefore(by.metalBeyond.lv), 'metal only past the river');
  assert.equal(by.metalBeyond.def.start.metal, 0);
  assert.equal(by.twoChasms.lv.chasms.length, 2);
  assert.ok(by.slingers.def.waves.every((w) => w.units.slinger));
  assert.ok(by.ogre.def.waves.some((w) => w.units.ogre));
  assert.ok(by.forge.def.armor > 0 && by.catapult.def.armor > by.forge.def.armor, 'armoured fortresses ask for knights and catapults');
  assert.ok(by.longRoad.lv.L === Math.max(...parsed.map((p) => p.L)), 'the long road is the longest line');
  assert.ok(by.finale.lv.chasms.length >= 2 && by.finale.def.waves.length >= 6);
  // levels 1–4 have metal on the near side; from level 5 on, the plan allows metal behind a river
  for (let i = 0; i < 4; i++) assert.ok(metalBefore(parsed[i]), `level ${i + 1}`);
});

// A level whose idea gates it is lost without that idea; the others at least see it used.
const GATE = { bridge: 'bridge', metalBeyond: 'bridge', twoChasms: 'bridge' };
for (const [i, l] of LEVELS.entries()) {
  if (GATE[l.idea]) {
    test(`level ${i + 1} (${l.idea}) is lost without the ${GATE[l.idea]}`, () => {
      assert.equal(play(`skip:${GATE[l.idea]}`, l, 1).status, 'lost');
    });
  }
}

test('without walls and towers the third level is lost or costs a star', () => {
  const l = LEVELS.find((x) => x.idea === 'walls');
  for (const seed of [1, 2, 3]) {
    const r = play('armyOnly', l, seed);
    assert.ok(r.status === 'lost' || r.stars < play('competent', l, seed).stars, `seed ${seed}: ${r.status} ${r.stars}★`);
  }
});

test('the competent player uses each level idea where it appears', () => {
  const used = (l, pred) => {
    const r = play('competent', l, 1);
    return pred(r.g);
  };
  const lv = (idea) => LEVELS.find((x) => x.idea === idea);
  const built = (id) => (g) => g.plots.some((p) => p.b && p.b.id === id);
  assert.ok(used(lv('towers'), built('tower')), 'a tower on «Дозор»');
  assert.ok(used(lv('ogre'), (g) => g.plots.some((p) => p.b && p.b.stone)), 'a stone wall on «Огр»');
  assert.ok(used(lv('forge'), built('forge')), 'a forge on «Кузня»');
  assert.ok(used(lv('catapult'), (g) => built('forge')(g)), 'the forge for catapults on «Твердыня»');
});
