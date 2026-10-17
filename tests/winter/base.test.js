'use strict';
// Долгая зима: buildings, wolves, survivors, the end of the winter, stars, saves and the hint line.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/winter/core.js');

const sim = (g, seconds, frame = 0.25) => { for (let t = 0; t < seconds - 1e-9; t += frame) C.step(g, frame); };
const of = (events, type) => events.filter((e) => e.type === type);
function quiet(seed = 1, diff = 'normal') {
  const g = C.newGame(diff, seed);
  g.animals = [];
  return g;
}
const rich = (g) => Object.assign(g.stock, { wood: 150, stone: 80, metal: 30 });
const wolf = (g, x, y, hp = C.WOLF_HP) => { const w = { id: g.nextId++, x, y, hp, maxHp: hp, cd: 0, flee: false }; g.wolves.push(w); return w; };

test('the hut goes up in four stages, paid in parts', () => {
  const g = quiet();
  g.stock.wood = 25;
  assert.equal(C.contribute(g, 'hut'), 'part');
  assert.equal(g.stock.wood, 0);
  assert.equal(g.hut.stage, 0);
  assert.equal(C.contribute(g, 'hut'), 'nores');
  g.stock.wood = 15;
  assert.equal(C.contribute(g, 'hut'), 'done');
  assert.equal(g.hut.stage, 1);
  rich(g);
  for (const stage of [2, 3, 4]) { assert.equal(C.contribute(g, 'hut'), 'done'); assert.equal(g.hut.stage, stage); }
  assert.ok(C.stoveOn(g), 'the stove starts with a little wood in it');
  assert.equal(C.contribute(g, 'hut'), 'built');
  assert.equal(C.contribute(g, 'tower'), 'bad');
  g.hero.x = 5.5;
  assert.equal(C.contribute(g, 'bunk:0'), 'far', 'building is done from the camp');
});

test('the palisade: four segments, broken ones are repaired for less', () => {
  const g = quiet();
  rich(g);
  for (let i = 0; i < 3; i++) assert.equal(C.contribute(g, `palisade:${i}`), 'done');
  assert.equal(C.palisadeUp(g), false);
  assert.equal(C.contribute(g, 'palisade:3'), 'done');
  assert.ok(C.palisadeUp(g));
  assert.equal(C.contribute(g, 'palisade:3'), 'built');
  g.palisade[2].hp = 0;
  assert.equal(C.palisadeUp(g), false);
  assert.deepEqual(C.needOf(g, 'palisade:2').cost, C.PALISADE_REPAIR);
  assert.equal(C.contribute(g, 'palisade:2'), 'done');
  assert.ok(C.palisadeUp(g));
  assert.equal(C.contribute(g, 'bunk:0'), 'done');
  assert.equal(C.contribute(g, 'bunk:0'), 'built');
  assert.equal(C.contribute(g, 'bunk:7'), 'bad');
});

test('wolves come at night, more of them later and in the harsh winter, and leave at dawn', () => {
  const g = quiet();
  g.t = C.NIGHT_AT - 0.5;
  const ev = [];
  for (let t = 0; t < 1; t += 0.25) { C.step(g, 0.25); ev.push(...C.drain(g)); }
  assert.equal(of(ev, 'howl').length, 1);
  assert.equal(g.wolves.length, C.wolvesTonight(g));
  for (const w of g.wolves) assert.ok(Math.hypot(w.x - g.hero.x, w.y - g.hero.y) > C.WOLF_SAFE);
  const late = quiet(); late.t = C.DAY * 20;
  const harsh = quiet(1, 'harsh'); harsh.t = C.DAY * 20;
  assert.ok(C.wolvesTonight(late) > C.wolvesTonight(g));
  assert.ok(C.wolvesTonight(harsh) > C.wolvesTonight(late));
  g.t = C.DAY - 0.3;
  sim(g, 0.5);
  assert.equal(g.wolves.length, 0, 'gone at dawn');
});

test('a wolf bites the hero, the hero fights back and kills it', () => {
  const g = quiet();
  g.fire.fuel = 0;
  g.hero.x = 10.5; g.hero.y = 30.5;
  for (const n of g.nodes) if (Math.abs(n.x - 10) <= 2 && Math.abs(n.y - 30) <= 2) n.amount = 0;
  g.nodes = g.nodes.slice();
  const w = wolf(g, 11.5, 30.5);
  const h0 = g.hero.health;
  const ev = [];
  for (let t = 0; t < 15 && g.wolves.length; t += 0.25) { C.step(g, 0.25); ev.push(...C.drain(g)); }
  assert.ok(of(ev, 'bite').length >= 1);
  assert.ok(g.hero.health < h0 - (of(ev, 'bite').length - 1) * C.BITE, 'each bite takes 8 (health comes back slowly)');
  assert.ok(of(ev, 'wolfDead').length === 1 || w.flee, 'killed or put to flight');
});

test('wolves keep out of the light of the fire and torches', () => {
  const g = quiet();
  g.fire.fuel = C.FIRE.cap;
  g.hero.x = C.SPOT.fire.x + 0.5; g.hero.y = C.SPOT.fire.y + 1.5;
  wolf(g, C.SPOT.fire.x + 6.5, C.SPOT.fire.y + 1.5);
  sim(g, 10);
  for (const w of g.wolves) assert.ok(!C.lit(g, Math.floor(w.x), Math.floor(w.y)), `wolf at ${w.x},${w.y}`);
  const t = quiet();
  t.fire.fuel = 0;
  t.stock.wood = 10;
  t.hero.x = 10.5; t.hero.y = 30.5;
  for (const [dx, dy] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) C.placeTorch(t, 10 + dx, 30 + dy);
  const w = wolf(t, 18.5, 30.5);
  sim(t, 8);
  assert.ok(Math.hypot(w.x - 10.5, w.y - 30.5) > 1.5, 'the wolf never reaches the hero among torches');
});

test('the palisade keeps wolves out of the camp; they gnaw at it instead', () => {
  const g = quiet();
  rich(g);
  for (let i = 0; i < 4; i++) C.contribute(g, `palisade:${i}`);
  g.fire.fuel = 0;
  g.hero.x = 27.5; g.hero.y = 23.5;
  const w = wolf(g, 27.5, 28.5);
  const ev = [];
  for (let t = 0; t < 20; t += 0.25) { C.step(g, 0.25); ev.push(...C.drain(g)); }
  assert.equal(of(ev, 'bite').length, 0);
  assert.ok(!C.inBase(Math.floor(w.x), Math.floor(w.y)));
  assert.ok(of(ev, 'gnaw').length > 0);
  assert.ok(g.palisade[2].hp < C.PALISADE_HP);
});

test('rescues: meat for the hunter, daylight for the herbalist, the palisade for the child', () => {
  const g = quiet();
  const sv = (id) => g.survivors.find((s) => s.id === id);
  const stand = (id) => { const s = sv(id); g.hero.x = s.x + 1; g.hero.y = s.y; };
  stand('hunter');
  assert.equal(C.rescue(g, sv('hunter')), 'meat');
  g.stock.meat = 3;
  assert.equal(C.rescue(g, sv('hunter')), 'ok');
  assert.equal(g.stock.meat, 0);
  assert.equal(sv('hunter').state, 'following');
  assert.equal(C.rescue(g, sv('hunter')), 'bad');
  stand('herbalist');
  g.t = C.NIGHT_AT + 1;
  assert.equal(C.rescue(g, sv('herbalist')), 'night');
  g.t = 1;
  assert.equal(C.rescue(g, sv('herbalist')), 'ok');
  stand('child');
  assert.equal(C.canRescue(g, sv('child')), 'palisade');
  rich(g);
  g.hero.x = 27.5; g.hero.y = 21.5;
  for (let i = 0; i < 4; i++) C.contribute(g, `palisade:${i}`);
  stand('child');
  assert.equal(C.rescue(g, sv('child')), 'ok');
  g.hero.x = 1.5; g.hero.y = 1.5;
  assert.equal(C.rescue(g, sv('smith')), 'far');
});

test('the hunter takes roast meat too: raw first, then the rest from the roast', () => {
  const g = quiet();
  const s = g.survivors.find((x) => x.id === 'hunter');
  g.hero.x = s.x + 1; g.hero.y = s.y;
  Object.assign(g.stock, { meat: 0, cookedMeat: 2, cookedFish: 9, berries: 9 });
  assert.equal(C.rescue(g, s), 'meat', 'two pieces and a pile of other food are not enough');
  Object.assign(g.stock, { meat: 1, cookedMeat: 5 });
  assert.equal(C.rescue(g, s), 'ok');
  assert.deepEqual([g.stock.meat, g.stock.cookedMeat, g.stock.cookedFish], [0, 3, 9]);
});

test('the carpenter at home adds wood and leaves the fire to the child', () => {
  const g = quiet();
  const s = g.survivors.find((x) => x.id === 'carpenter');
  s.state = 'home'; s.x = 27.5; s.y = 22.5; s.food = 100;
  g.fire.fuel = C.FIRE.cap * 0.3;
  g.stock.wood = 10;
  g.t = 1;
  const fuel = g.fire.fuel;
  sim(g, 60);
  assert.ok(s.busy, 'working by day');
  assert.ok(g.stock.wood >= 10 + Math.floor(60 / C.WORK.carpenter.every) - 1, `wood ${g.stock.wood}`);
  assert.ok(g.fire.fuel < fuel);
  g.t = C.NIGHT_AT + 1;
  sim(g, 1);
  assert.equal(s.busy, false, 'resting at night');
});

test('a rescued survivor follows the hero home and then works', () => {
  const g = quiet();
  g.fire.fuel = C.FIRE.cap;
  const s = g.survivors.find((x) => x.id === 'herbalist');
  g.hero.x = s.x + 1; g.hero.y = s.y;
  C.rescue(g, s);
  C.interact(g, 27, 21);
  for (let t = 0; t < 80 && s.state !== 'home'; t += 0.25) C.step(g, 0.25);
  assert.equal(s.state, 'home');
  const ev = [];
  const b = g.stock.berries;
  for (let t = 0; t < 30; t += 0.25) { C.step(g, 0.25); ev.push(...C.drain(g)); }
  assert.ok(of(ev, 'work').some((e) => e.id === 'herbalist'));
  assert.ok(g.stock.berries > b - 5);
});

test('survivors at home eat from the stock and weaken without food and warmth, and can die', () => {
  const g = quiet();
  const s = g.survivors[0];
  s.state = 'home';
  s.x = 27.5; s.y = 22.5;
  s.food = 10;
  g.stock.cookedMeat = 1;
  sim(g, 1);
  assert.equal(g.stock.cookedMeat, 0);
  assert.ok(s.food > 40);
  // no food, no fire, deep cold: the survivor dies
  for (const k of C.FOOD_ITEMS) g.stock[k] = 0;
  s.food = 0;
  g.fire.fuel = 0;
  g.t = C.DAY * 18 + 1;
  const ev = [];
  for (let t = 0; t < 400 && s.state === 'home'; t += 0.5) { g.hero.health = 100; C.step(g, 0.5); ev.push(...C.drain(g)); }
  assert.equal(s.state, 'dead');
  assert.ok(of(ev, 'died').length === 1);
  assert.equal(g.deaths[0].id, s.id);
});

test('the winter ends on the morning of day 31; stars count survivors and the hut', () => {
  const g = quiet();
  g.t = C.DAY * C.DAYS - 0.2;
  g.fire.fuel = C.FIRE.cap;
  const ev = [];
  for (let t = 0; t < 1; t += 0.25) { C.step(g, 0.25); ev.push(...C.drain(g)); }
  assert.equal(C.status(g), 'won');
  assert.equal(of(ev, 'won').length, 1);
  assert.equal(C.stars(g), 1);
  for (const s of g.survivors.slice(0, 3)) s.state = 'home';
  assert.equal(C.stars(g), 2);
  for (const s of g.survivors) s.state = 'home';
  assert.equal(C.stars(g), 2, 'all five, but the hut is not done');
  g.hut.stage = 4;
  assert.equal(C.stars(g), 3);
  assert.equal(C.stars(quiet()), 0, 'no stars while playing');
});

test('the dawn save and «Начать день заново»', () => {
  const g = quiet();
  const save = C.newSave();
  save.current = C.snapshot(g);
  save.dawn = C.snapshot(g);
  sim(g, 30);
  const back = C.retryDay(save);
  assert.equal(back.t, 0);
  assert.deepEqual(C.snapshot(back), save.dawn);
  assert.equal(C.retryDay(C.newSave()), null);
});

test('snapshots round-trip, a restored winter goes on the same way, broken ones are refused', () => {
  const g = C.newGame('normal', 4);
  C.interact(g, 30, 22);
  sim(g, 40);
  const snap = JSON.parse(JSON.stringify(C.snapshot(g)));
  const back = C.restore(snap);
  assert.deepEqual(C.snapshot(back), C.snapshot(g));
  sim(back, 20);
  sim(g, 20);
  assert.deepEqual(C.snapshot(back), C.snapshot(g));
  for (const bad of [null, {}, { ...snap, v: 3 }, { ...snap, status: 'won' }, { ...snap, difficulty: 'mild' }, { ...snap, tiles: [] },
    { ...snap, hero: { ...snap.hero, food: -1 } }, { ...snap, stock: { wood: 1 } }, { ...snap, survivors: [] }, { ...snap, fire: { fuel: 99 } }]) {
    assert.equal(C.restore(bad), null, JSON.stringify(bad).slice(0, 50));
  }
});

test('the save: records, stars, the harsh winter unlocked by a win; broken or blocked storage', () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const save = C.loadSave(storage);
  assert.deepEqual(save, C.newSave());
  const g = quiet();
  g.t = C.DAY * 9 + 3;
  g.status = 'lost';
  assert.ok(C.recordGame(save, g));
  assert.equal(save.best.normal, 9);
  assert.equal(save.unlocked, false);
  g.status = 'won';
  g.hut.stage = 4;
  for (const s of g.survivors) s.state = 'home';
  assert.ok(C.recordGame(save, g));
  assert.equal(save.best.normal, C.DAYS + 1);
  assert.equal(save.stars.normal, 3);
  assert.ok(save.unlocked);
  assert.equal(C.recordGame(save, g), false);
  save.current = C.snapshot(quiet());
  save.dawn = save.current;
  assert.ok(C.storeSave(storage, save));
  assert.deepEqual(C.loadSave(storage), save);
  assert.deepEqual(C.parseSave(JSON.stringify(save)), save);
  assert.deepEqual(C.parseSave(42), C.newSave());
  mem.set(C.SAVE_KEY, '{oops');
  assert.deepEqual(C.loadSave(storage), C.newSave());
  mem.set(C.SAVE_KEY, JSON.stringify({ v: 1, best: { normal: 99, harsh: 4 }, stars: { normal: 5 }, unlocked: 'yes', current: { v: 2 } }));
  const odd = C.loadSave(storage);
  assert.equal(odd.best.normal, 0);
  assert.equal(odd.best.harsh, 4);
  assert.equal(odd.stars.normal, 0);
  assert.equal(odd.unlocked, false);
  assert.equal(odd.current, null);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(C.loadSave(blocked), C.newSave());
  assert.equal(C.storeSave(blocked, save), false);
  assert.equal(C.storeSave(null, save), false);
});

test('the hint line follows the state of the camp, and every hint is a known text', () => {
  const g = quiet();
  const hints = new Set();
  const take = () => { const h = C.nextTask(g); hints.add(h); return h; };
  assert.equal(take(), 'Почини хижину: стены');
  g.fire.fuel = 1;
  assert.equal(take(), 'Подкинь дров в костёр');
  g.fire.fuel = 10;
  g.hero.food = 10;
  assert.equal(take(), 'Поешь (F)');
  g.hero.food = 80;
  g.hut.stage = 1;
  assert.equal(take(), 'Сделай кирку на верстаке');
  g.tools.pick = true;
  g.hut.stage = 4;
  assert.equal(take(), 'Построй частокол вокруг лагеря');
  rich(g);
  for (let i = 0; i < 4; i++) C.contribute(g, `palisade:${i}`);
  assert.equal(take(), 'Спаси выжившего: Охотник');
  for (const s of g.survivors) s.state = 'home';
  assert.equal(take(), 'Сделай нары для выживших');
  rich(g);
  for (let i = 0; i < 3; i++) C.contribute(g, `bunk:${i}`);
  assert.equal(take(), 'Улучши дом: утепление');
  for (const id of C.UPGRADE_IDS) { Object.assign(g.stock, { wood: 60, stone: 40, metal: 10, hide: 10 }); assert.equal(C.contribute(g, `up:${id}`), 'done'); }
  assert.equal(take(), 'Держись до весны');
  g.hero.health = 10;
  assert.equal(take(), 'Ты слабеешь: согрейся, поешь и отдохни');
  for (const h of hints) assert.ok(C.TASK_TEXTS.includes(h) || /^(Спаси выжившего|Улучши дом): /.test(h), h);
});

test('a snapshot from before the expansion (no second stream, no hides or smoked food) restores and plays on', () => {
  const g = C.newGame('normal', 3);
  sim(g, 30);
  const old = JSON.parse(JSON.stringify(C.snapshot(g)));
  delete old.erng;
  for (const k of ['hide', 'smokedMeat', 'smokedFish']) delete old.stock[k];
  const back = C.restore(old);
  assert.ok(back, 'restored');
  assert.equal(back.stock.hide, 0);
  assert.equal(back.stock.smokedMeat, 0);
  assert.ok(Number.isInteger(back.erng));
  assert.ok(!('erng' in old), 'the input is not changed');
  sim(back, 30);
  assert.equal(back.status, 'playing');
  // the old content goes on exactly as in the game it came from
  sim(g, 30);
  assert.deepEqual(back.animals, g.animals);
  // broken new fields are refused
  const snap = JSON.parse(JSON.stringify(C.snapshot(g)));
  for (const bad of [{ ...snap, erng: 1.5 }, { ...snap, erng: 'x' }, { ...snap, stock: { ...snap.stock, hide: -1 } }, { ...snap, stock: { ...snap.stock, smokedFish: 'a' } }]) {
    assert.equal(C.restore(bad), null, JSON.stringify(bad.stock).slice(0, 80));
  }
});
