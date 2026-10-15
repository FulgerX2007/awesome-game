'use strict';
// Путь героя: the pure client helpers in view.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/hero/core.js');
const K = require('../../web/hero/content.js');
const V = require('../../web/hero/view.js');

test('the map layout fits the canvas at 320, 360, 768 and 1280 px', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const map = C.genMap(seed, 1 + (seed % 3));
    for (const [w, h] of [[320, 240], [360, 270], [768, 420], [1280, 700]]) {
      const L = V.mapLayout(map, { w, h });
      for (const n of map.nodes) {
        const p = L.pos[n.id];
        assert.ok(p.x - L.r >= 0 && p.x + L.r <= w, `x ${p.x} at ${w}`);
        assert.ok(p.y - L.r >= 0 && p.y + L.r <= h, `y ${p.y} at ${h}`);
      }
      // nodes of a column don't overlap
      for (const ids of map.rows) for (let i = 1; i < ids.length; i++) {
        assert.ok(L.pos[ids[i]].y - L.pos[ids[i - 1]].y >= 2 * L.r * 0.99, 'no overlap');
      }
    }
  }
});

test('nodeAt finds a node by a tap near it and nothing far away', () => {
  const map = C.genMap(3, 1);
  const L = V.mapLayout(map, { w: 360, h: 270 });
  for (const n of map.nodes) {
    const p = L.pos[n.id];
    assert.equal(V.nodeAt(L, p.x, p.y), n.id);
    assert.equal(V.nodeAt(L, p.x + L.r * 0.9, p.y), n.id);
  }
  assert.equal(V.nodeAt(L, -100, -100), null);
});

test('the battle layout keeps the hero on the left and enemies on the right, inside the canvas', () => {
  for (const [w, h] of [[320, 240], [360, 270], [1280, 700]]) {
    for (const n of [1, 2, 3]) {
      const L = V.battleLayout({ w, h }, n);
      assert.equal(L.slots.length, n);
      assert.ok(L.hero.x < L.slots[0].x);
      for (const s of L.slots) assert.ok(s.x + L.s * 0.6 <= w, `slot at ${s.x} of ${w}`);
      assert.ok(L.ground < h && L.ground > h / 2);
    }
  }
});

test('the hero looks like his level and gear: helmet at 6, cape at 12, aura at 15, armour colour by tier', () => {
  const run = C.newRun(C.newSave(), 1);
  let look = V.heroLook(run);
  assert.equal(look.title, 'Новичок');
  assert.equal(look.armor, null);
  assert.ok(!look.helmet && !look.cape && !look.aura);
  assert.equal(look.weapon.shape, 'sword');
  assert.equal(look.weapon.type, 'phys');
  run.hero.level = 6;
  assert.ok(V.heroLook(run).helmet);
  run.hero.level = 12;
  look = V.heroLook(run);
  assert.ok(look.cape && !look.aura);
  run.hero.level = 15;
  assert.ok(V.heroLook(run).aura);
  assert.equal(V.heroLook(run).title, 'Легенда');
  const a = { uid: run.nextUid++, id: 'plate', tier: 1 };
  run.bag.push(a);
  run.eq.armor = a.uid;
  const c1 = V.heroLook(run).armor.color;
  a.tier = 5;
  assert.notEqual(V.heroLook(run).armor.color, c1);
  const staff = { uid: run.nextUid++, id: 'frost_staff', tier: 2 };
  run.bag.push(staff);
  run.eq.weapon = staff.uid;
  assert.deepEqual([V.heroLook(run).weapon.shape, V.heroLook(run).weapon.type], ['staff', 'ice']);
  for (const id of Object.keys(K.ITEMS)) if (K.ITEMS[id].slot === 'weapon') assert.ok(V.WEAPON_SHAPE[id], id);
});

test('defence icons list weaknesses, resistances, immunities and traits', () => {
  const ic = V.defenceIcons({ res: K.ENEMIES.golem.res, thorns: 0.2 });
  assert.deepEqual(ic.map((d) => [d.kind, d.type || null]), [['resist', 'phys'], ['immune', 'fire'], ['weak', 'ice'], ['thorns', null]]);
  assert.deepEqual(V.defenceIcons({ res: K.ENEMIES.wolf.res }), []);
  const all = V.defenceIcons({ res: K.ENEMIES.wolf.res, dodge: 0.3, regen: 2, shield: 3 });
  assert.deepEqual(all.map((d) => d.kind), ['dodge', 'regen', 'shield']);
  for (const p of K.BOSSES.ash_lord.phases) assert.ok(V.defenceIcons({ res: p.res }).length >= 3);
});

test('item lines and number formatting', () => {
  assert.deepEqual(V.itemLine({ id: 'axe', tier: 1 }), { type: 'phys', dmg: 8, speed: 1.45, traits: ['cleave'] });
  assert.deepEqual(V.itemLine({ id: 'chain', tier: 1 }), { armor: 24, ward: 6, hp: 8 });
  assert.deepEqual(V.itemLine({ id: 'heal_stone', tier: 1 }), { spell: 'heal', power: 12, cd: 7 });
  assert.equal(V.itemLine({ id: 'fire_orb', tier: 2 }).power, 13);
  assert.equal(V.fmt(1234567), '1 234 567');
  assert.equal(V.fmt(-5), '−5');
  assert.equal(V.fmt('x'), '0');
  for (const t of K.TYPES) assert.ok(V.TYPE_COLOR[t] && V.TYPE_NAME[t] && V.TYPE_ICON[t]);
  for (const k of C.KINDS) assert.ok(V.KIND_ICON[k] && V.KIND_NAME[k]);
});
