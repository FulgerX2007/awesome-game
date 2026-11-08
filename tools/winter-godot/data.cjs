#!/usr/bin/env node
'use strict';
// Долгая зима on Godot: writes the game data of godot/winter/data from the web version it was ported from.
//   node tools/winter-godot/data.cjs          (tests/winter-godot/data.test.js checks the files are fresh)
// - balance.tres    WinterBalance: every number of the rules (rates, caps, timings, tables like DIFF or BEAR)
// - items.tres      WinterCatalog of WinterItemDef: materials and food, with satiety and Russian names
// - recipes.tres    WinterCatalog of WinterRecipeDef: the workbench's tools and the workshop's gear
// - buildings.tres  WinterCatalog of WinterBuildingDef: hut stages, palisade, bunks, upgrades, torch, roof patch
// - survivors.tres  WinterCatalog of WinterSurvivorDef: where the five wait, what they need, how they work
// - winter.csv      RU/RO strings for tr(): the Romanian dictionary of web/winter/lang.js
// Numbers come from web/winter/core.js; the few it keeps private (NODE below) are copied from its source and the
// parity test (tests/winter-godot/parity.test.js) proves the Godot rules still play exactly like core.js.
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../web/winter/core.js');

const ROOT = path.join(__dirname, '../..');
const OUT = path.join(ROOT, 'godot/winter/data');
const DEFS = 'res://scripts/sim/defs';

// ── Russian names from the web client's tables (web/winter/game.js) ──
function gameTables() {
  const src = fs.readFileSync(path.join(ROOT, 'web/winter/game.js'), 'utf8');
  const table = (name) => {
    const m = src.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\});`));
    if (!m) throw new Error(`game.js: no table ${name}`);
    return Function(`return (${m[1]});`)();
  };
  const out = {};
  for (const k of ['TOOL_NAME', 'TOOL_DESC', 'STAGE_NAME', 'SURVIVOR_ROLE', 'NEED_TEXT', 'UP_NAME', 'UP_DESC', 'GEAR_LABEL', 'GEAR_DESC', 'ITEM_NAME', 'EVENT_TEXT', 'SNARE_FAIL']) out[k] = table(k);
  const seg = src.match(/const SEGMENT_NAME = (\[[^\]]*\]);/);
  out.SEGMENT_NAME = Function(`return (${seg[1]});`)();
  const ask = src.match(/const EVENT_ASK = (\{[\s\S]*?\n  \});/);
  out.EVENT_ASK = Function(`return (${ask[1]});`)();
  return out;
}

// ── The Romanian dictionary (web/winter/lang.js, loaded with a stub I18n) ──
function romanian() {
  const dict = {};
  const I18n = { add: (d) => Object.assign(dict, d.ro || {}) };
  Function('I18n', fs.readFileSync(path.join(ROOT, 'web/winter/lang.js'), 'utf8'))(I18n);
  return dict;
}

// Numbers core.js keeps to itself (copied from its source; the parity test guards them).
const NODE = {
  amount: { tree: 12, rock: 10, bush: 6, scrap: 6 },     // genNodes AMOUNT
  regrowDays: { tree: 4, bush: 2 },                     // workTick: rocks and scrap never regrow
  hitCd: { tree: C.HIT_CD, rock: C.HIT_CD, bush: 1, scrap: 1.5 },
  perHit: { tree: 2, treeIronAxe: 3, rock: 2, bush: 1, scrap: 2 },
  item: { tree: 'wood', rock: 'stone', bush: 'berries', scrap: 'metal' },
};
const PRIVATE = {
  fireRest: 0.1, wolfSpeed: 3.2, wolfCd: 1.5, wolfFlee: 0.3, survivorFood: 0.08, survivorEatAt: 50,
  feedCd: 0.4, strikeCd: 0.8, deerReach: 3, animalReach: 1.2, fightReach: 1.3,
  fireRadiusStove: 3, survivorHeal: 0.2, survivorHurt: 0.35, survivorSpeed: 0.95, lostSpeed: 0.6,
  rabbits: 6, deer: 3, rabbitEvery: 30, deerEvery: 60, rabbitSpeed: 1.6, deerSpeed: 2.2,
  childFeedAt: 0.6, palisadeFix: 10, stoveStart: 6,
};

// ── Godot text resources ──
// A value in Godot's text format: JSON is close enough for numbers, strings, arrays and dictionaries (the order
// of dictionary keys is kept; the rules iterate costs in that order, like Object.keys in core.js).
function val(v) {
  if (v === Infinity) return 'inf';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`bad number ${v}`);
    return Number.isInteger(v) ? String(v) : String(v);
  }
  if (typeof v === 'string' || typeof v === 'boolean' || v === null) return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(val).join(', ')}]`;
  const keys = Object.keys(v);
  if (!keys.length) return '{}';
  return `{\n${keys.map((k) => `${JSON.stringify(k)}: ${val(v[k])}`).join(',\n')}\n}`;
}

function resource(className, script, props) {
  return `[gd_resource type="Resource" script_class="${className}" load_steps=2 format=3]\n\n`
    + `[ext_resource type="Script" path="${DEFS}/${script}" id="1"]\n\n[resource]\nscript = ExtResource("1")\n`
    + Object.entries(props).map(([k, v]) => `${k} = ${val(v)}`).join('\n') + '\n';
}

// A catalog: one file, the entries as sub-resources in order.
function catalog(script, className, entries) {
  let s = `[gd_resource type="Resource" script_class="WinterCatalog" load_steps=${entries.length + 3} format=3]\n\n`;
  s += `[ext_resource type="Script" path="${DEFS}/catalog.gd" id="1"]\n[ext_resource type="Script" path="${DEFS}/${script}" id="2"]\n\n`;
  entries.forEach((e, i) => {
    s += `[sub_resource type="Resource" id="${className}_${i}"]\nscript = ExtResource("2")\n`;
    s += Object.entries(e).map(([k, v]) => `${k} = ${val(v)}`).join('\n') + '\n\n';
  });
  s += `[resource]\nscript = ExtResource("1")\nentries = [${entries.map((_, i) => `SubResource("${className}_${i}")`).join(', ')}]\n`;
  return s;
}

const plain = (o) => JSON.parse(JSON.stringify(o));

function build() {
  const T = gameTables();
  const files = {};

  files['balance.tres'] = resource('WinterBalance', 'balance.gd', {
    tick: C.TICK, max_dt: C.MAX_DT, day: C.DAY, night_at: C.NIGHT_AT, days: C.DAYS, sleep_speed: C.SLEEP_SPEED,
    speed: C.SPEED, deep: C.DEEP, carry: C.CARRY, sled_carry: C.SLED_CARRY, store_cap: C.STORE_CAP, food_cap: C.FOOD_CAP,
    cellar_food: C.CELLAR_FOOD, stat_max: C.STAT_MAX, food_drain: C.FOOD_DRAIN, energy_drain: C.ENERGY_DRAIN,
    work_energy: C.WORK_ENERGY, sleep_energy: C.SLEEP_ENERGY, fire_rest: PRIVATE.fireRest, health_loss: C.HEALTH_LOSS,
    health_gain: C.HEALTH_GAIN, raw_meat_energy: C.RAW_MEAT_ENERGY, cook_time: C.COOK_TIME, hit_cd: C.HIT_CD,
    fish_time: C.FISH_TIME, bite: C.BITE, gnaw: C.GNAW, wolf_hp: C.WOLF_HP, wolf_speed: PRIVATE.wolfSpeed,
    wolf_cd: PRIVATE.wolfCd, wolf_flee: PRIVATE.wolfFlee, wolf_safe: C.WOLF_SAFE, survivor_food: PRIVATE.survivorFood,
    survivor_eat_at: PRIVATE.survivorEatAt, coat: C.COAT, hunter_meat: C.HUNTER_MEAT, palisade_hp: C.PALISADE_HP,
    trade_offers: C.TRADE_OFFERS, trade_reach: C.TRADE_REACH,
    fire: plain(C.FIRE), stove: plain(C.STOVE), torch: plain(C.TORCH), diff: plain(C.DIFF), insulation: plain(C.INSULATION),
    smoke: plain(C.SMOKE), annex: plain(C.ANNEX), lantern: plain(C.LANTERN), snare: plain(C.SNARE),
    event_chance: plain(C.EVENT_CHANCE), event_choices: plain(C.EVENT_CHOICES), event_default: plain(C.EVENT_DEFAULT),
    event_ids: plain(C.EVENT_IDS), event_max: plain(C.EVENT_MAX), lost_child: plain(C.LOST_CHILD), aurora: plain(C.AURORA),
    thaw: plain(C.THAW), trader_days: plain(C.TRADER_DAYS), trades: plain(C.TRADES), trade_fixed: plain(C.TRADE_FIXED),
    trade_no_tool: plain(C.TRADE_NO_TOOL), bear: plain(C.BEAR), roof_fix: plain(C.ROOF_FIX), roof_hole: plain(C.ROOF_HOLE),
    wanderer: plain(C.WANDERER), blizzards: plain(C.BLIZZARDS), eat_order: plain(C.EAT_ORDER), meats: plain(C.MEATS),
    node: plain(NODE), misc: plain(PRIVATE),
  });

  const items = C.ITEMS.map((id) => ({
    id, kind: C.RES.includes(id) ? 'material' : 'food', food: C.FOOD[id] || 0, name: T.ITEM_NAME[id],
    eat_rank: C.EAT_ORDER.indexOf(id),
  }));
  files['items.tres'] = catalog('item_def.gd', 'WinterItemDef', items);

  const recipes = [];
  for (const id of Object.keys(C.TOOLS)) recipes.push({ id, kind: 'tool', cost: plain(C.TOOLS[id].cost), name: T.TOOL_NAME[id], desc: T.TOOL_DESC[id], needs: '' });
  for (const id of C.GEAR_IDS) recipes.push({ id, kind: 'gear', cost: plain(C.GEAR[id].cost), name: T.GEAR_LABEL[id], desc: T.GEAR_DESC[id], needs: 'workshop', core_name: C.GEAR[id].name });
  files['recipes.tres'] = catalog('recipe_def.gd', 'WinterRecipeDef', recipes);

  const buildings = [];
  C.HUT_STAGES.forEach((s, i) => buildings.push({ id: s.id, kind: 'hut', order: i, cost: plain(s.cost), repair: {}, hp: 0, name: T.STAGE_NAME[s.id], desc: '' }));
  C.SEGMENTS.forEach((s, i) => buildings.push({ id: `palisade:${i}`, kind: 'palisade', order: i, cost: plain(C.PALISADE_COST), repair: plain(C.PALISADE_REPAIR), hp: C.PALISADE_HP, name: T.SEGMENT_NAME[i], desc: s }));
  for (let i = 0; i < 3; i++) buildings.push({ id: `bunk:${i}`, kind: 'bunk', order: i, cost: plain(C.BUNK_COST), repair: {}, hp: 0, name: `Нары ${i + 1}`, desc: 'Готовы: двое спят в тепле' });
  C.UPGRADE_IDS.forEach((id, i) => buildings.push({ id, kind: 'upgrade', order: i, cost: plain(C.UPGRADES[id].cost), repair: {}, hp: 0, name: T.UP_NAME[id], desc: T.UP_DESC[id], core_name: C.UPGRADES[id].name }));
  buildings.push({ id: 'torch', kind: 'torch', order: 0, cost: { wood: C.TORCH.cost }, repair: {}, hp: 0, name: 'Факел', desc: 'Отгоняет волков' });
  buildings.push({ id: 'patch', kind: 'patch', order: 0, cost: plain(C.ROOF_FIX), repair: {}, hp: 0, name: 'Залатать крышу', desc: '' });
  for (const b of buildings) if (b.core_name === undefined) b.core_name = '';
  files['buildings.tres'] = catalog('building_def.gd', 'WinterBuildingDef', buildings);

  const survivors = C.SURVIVOR_IDS.map((id) => ({
    id, name: C.SURVIVORS[id].name, x: C.SURVIVORS[id].x, y: C.SURVIVORS[id].y, need: C.SURVIVORS[id].need,
    work_every: C.WORK[id].every, work_give: plain(C.WORK[id].give), role: T.SURVIVOR_ROLE[id],
    need_text: T.NEED_TEXT[C.SURVIVORS[id].need] || '',
  }));
  files['survivors.tres'] = catalog('survivor_def.gd', 'WinterSurvivorDef', survivors);

  // ── RU/RO: every Russian string of the Romanian dictionary, plus the names the rules build into texts ──
  const ro = romanian();
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = ['keys,ru,ro'];
  for (const k of Object.keys(ro)) rows.push([q(k), q(k), q(ro[k])].join(','));
  files['winter.csv'] = rows.join('\n') + '\n';
  return files;
}

function write() {
  fs.mkdirSync(OUT, { recursive: true });
  const files = build();
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), text);
  return Object.keys(files);
}

if (require.main === module) console.log(write().join('\n'));
module.exports = { build, write, OUT, NODE, PRIVATE };
