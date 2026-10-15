'use strict';
// Путь героя: bots that play whole runs through the HeroCore API only.
//   competent — reads enemy defences, equips and swaps to the counter, prefers chests and forges, spends «Слава» well;
//   casual    — random branches and rewards; reads the first enemy's icons before half the fights, never swaps in
//               normal fights unless its hits show «иммунитет», and reacts to a boss phase only half the time;
//   single    — competent, but keeps only weapons of one damage type and no typed spells (the "one weapon" check).
const C = require('../../web/hero/core.js');
const K = require('../../web/hero/content.js');

const NODE_SECONDS = 10; // the time a player spends on a non-battle screen, for the run-length estimate

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slotOf = (it) => K.ITEMS[it.id].slot;
const weapons = (run) => run.bag.filter((x) => slotOf(x) === 'weapon');

// Expected damage per second of a weapon against an enemy (or an enemy spec's base numbers).
function dps(run, item, enemy) {
  const w = C.itemStats(item), st = C.stats(run);
  const res = enemy.res[w.type];
  const hit = (w.dmg + st.atk) * res * (1 + st.crit * (C.CRIT_MULT - 1));
  const land = w.traits.includes('keen') ? 1 : 1 - (enemy.dodge || 0);
  let v = (hit * land) / (w.interval * (1 - st.haste));
  if (w.traits.includes('cleave')) v *= 1.2;
  return v;
}

// The enemy numbers that matter for a spec, before the battle starts.
function specEnemy(spec) {
  if (spec.boss) {
    const b = K.BOSSES[spec.kind], p = b.phases[0];
    return { res: p.res, dodge: 0, hp: b.hp };
  }
  const e = K.ENEMIES[spec.kind];
  return { res: e.res, dodge: e.dodge || 0, hp: e.hp };
}

// The weapon with the most damage per second against a list of enemies, weighted by their health.
function bestWeapon(run, enemies, pool = weapons(run)) {
  let best = null, bestV = -1;
  for (const it of pool) {
    let v = 0;
    for (const e of enemies) v += dps(run, it, e) / Math.max(1, e.hp);
    if (v > bestV) { bestV = v; best = it; }
  }
  return best;
}

const armorValue = (it) => { const s = C.itemStats(it); return s.armor + s.ward + s.hp * 1.5; };

function weaponValue(run, it) {
  const w = C.itemStats(it);
  return ((w.dmg + C.stats(run).atk) / w.interval) * (w.traits.includes('cleave') ? 1.2 : 1);
}

const CHARM_RANK = { heal_stone: 4, fire_orb: 3, sun_charm: 3, frost_amulet: 2 };

function equipBest(run, cfg) {
  const arm = run.bag.filter((x) => slotOf(x) === 'armor').sort((a, b) => armorValue(b) - armorValue(a))[0];
  if (arm && run.eq.armor !== arm.uid) C.equip(run, arm.uid);
  const charms = run.bag.filter((x) => slotOf(x) === 'charm' && cfg.charmOk(x))
    .sort((a, b) => (CHARM_RANK[b.id] + b.tier) - (CHARM_RANK[a.id] + a.tier));
  if (charms[0] && run.eq.charm !== charms[0].uid) C.equip(run, charms[0].uid);
}

// Drops the least useful item to make room (never the last weapon).
function makeRoom(run, cfg) {
  if (run.bag.length < C.bagMax(run)) return true;
  const score = (it) => {
    const s = slotOf(it);
    if (s === 'weapon') return weaponValue(run, it) * (cfg.typeOk(it) ? 1 : 0.01) + (uniqueType(run, it) ? 50 : 0);
    if (s === 'armor') return run.eq.armor === it.uid ? 1000 : armorValue(it) / 4;
    return run.eq.charm === it.uid ? 1000 : 1;
  };
  const sorted = run.bag.slice().sort((a, b) => score(a) - score(b));
  for (const it of sorted) if (C.discard(run, it.uid)) return true;
  return false;
}

const uniqueType = (run, it) => weapons(run).filter((x) => C.itemStats(x).type === C.itemStats(it).type).length === 1;

// Value of an offered item for the competent player (higher is better; ≤ 0 means skip).
function offerValue(run, o, cfg) {
  const tpl = K.ITEMS[o.id], it = { id: o.id, tier: o.tier };
  if (tpl.slot === 'weapon') {
    if (!cfg.typeOk(it)) return 0;
    const sameType = weapons(run).filter((x) => C.itemStats(x).type === tpl.type);
    const bestSame = Math.max(0, ...sameType.map((x) => weaponValue(run, x)));
    const v = weaponValue(run, it);
    if (!sameType.length) return 100 + v;
    return v > bestSame * 1.1 ? v - bestSame : 0;
  }
  if (tpl.slot === 'armor') {
    const cur = run.eq.armor ? armorValue(run.bag.find((x) => x.uid === run.eq.armor)) : 0;
    return armorValue(it) > cur ? (armorValue(it) - cur) / 2 : 0;
  }
  if (!cfg.charmOk(it)) return 0;
  const cur = run.eq.charm ? run.bag.find((x) => x.uid === run.eq.charm) : null;
  const val = (x) => CHARM_RANK[x.id] + x.tier;
  return !cur ? 40 : val(it) > val(cur) ? 10 : 0;
}

const PERK_ORDER = ['might', 'vigor', 'haste', 'focus', 'hide', 'spirit', 'leech', 'agility', 'arcana'];
const NODE_PREF = { chest: 6, forge: 5, shop: 3, battle: 3, shrine: 3, camp: 1 };

const BOTS = {
  competent: {
    typeOk: () => true,
    charmOk: () => true,
    swaps: true,
  },
  casual: {
    typeOk: () => true,
    charmOk: () => true,
    swaps: false,
    random: true,
  },
};

function singleCfg(type) {
  return {
    typeOk: (it) => C.itemStats(it).type === type,
    charmOk: (it) => !K.ITEMS[it.id].type,
    swaps: true,
    single: type,
  };
}

function config(name) {
  if (name.startsWith('single:')) return singleCfg(name.slice(7));
  if (!BOTS[name]) throw new Error(`unknown bot ${name}`);
  return BOTS[name];
}

// One whole run. Returns the result and the measured run length.
function playRun(name, save, seed, trial = 0) {
  const cfg = config(name), r = mulberry(seed * 7919 + 13);
  const run = C.newRun(save, seed, trial);
  let screens = 0, guard = 0;
  const actLevel = {};
  if (cfg.single) {
    // keep only the chosen type: the armory start weapons give one of each, reforging covers phys
    const keep = weapons(run).find((x) => cfg.typeOk(x));
    if (keep) { C.equip(run, keep.uid); for (const w of weapons(run)) if (w.uid !== keep.uid) C.discard(run, w.uid); }
  }
  while (!['won', 'lost'].includes(run.phase) && guard++ < 2000) {
    const ph = run.phase;
    if (ph !== 'battle') screens++;
    if (ph === 'map') {
      const ids = C.reachable(run);
      let id;
      if (cfg.random) id = ids[Math.floor(r() * ids.length)];
      else {
        const hpShare = run.hero.hp / C.stats(run).maxHp;
        const val = (k) => {
          const kind = run.map.nodes[k].kind;
          if (kind === 'elite') return hpShare > 0.7 ? 5.5 : 0;
          if (kind === 'camp') return hpShare < 0.6 ? 7 : 1;
          if (kind === 'shop') return run.gold >= 60 ? 4 : 1;
          return NODE_PREF[kind] || 2;
        };
        id = ids.slice().sort((a, b) => val(b) - val(a))[0];
      }
      if (run.map.nodes[id].kind === 'boss') actLevel[run.act] = run.hero.level;
      C.choose(run, id);
    } else if (ph === 'battle') {
      fight(run, cfg, r);
    } else if (ph === 'perk') {
      if (cfg.random) C.pickPerk(run, Math.floor(r() * run.offer.length));
      else C.pickPerk(run, bestPerk(run.offer));
    } else if (ph === 'chest' || ph === 'loot') {
      if (cfg.random) {
        const i = Math.floor(r() * run.offer.length);
        if (C.pickReward(run, i) === 'full') { makeRoom(run, cfg); if (C.pickReward(run, i) !== 'ok') C.pickReward(run, null); }
        const got = run.bag[run.bag.length - 1];
        if (got && slotOf(got) !== 'weapon') C.equip(run, got.uid);
        else if (got && r() < 0.5) C.equip(run, got.uid);
      } else {
        const vals = run.offer.map((o) => offerValue(run, o, cfg));
        const i = vals.indexOf(Math.max(...vals));
        if (vals[i] <= 0) C.pickReward(run, null);
        else {
          makeRoom(run, cfg);
          if (C.pickReward(run, i) !== 'ok') C.pickReward(run, null);
          equipBest(run, cfg);
        }
      }
    } else if (ph === 'shrine') {
      C.pickReward(run, cfg.random ? Math.floor(r() * run.offer.length) : bestPerk(run.offer));
    } else if (ph === 'forge') {
      forgeTurn(run, cfg, r);
    } else if (ph === 'shop') {
      shopTurn(run, cfg, r);
    } else if (ph === 'camp') {
      const hpShare = run.hero.hp / C.stats(run).maxHp;
      C.camp(run, cfg.random ? (r() < 0.5 ? 'rest' : 'train') : hpShare < 0.7 ? 'rest' : 'train');
    }
    C.drain(run);
  }
  return {
    phase: run.phase, act: run.act, depth: run.depth, level: run.hero.level, kills: run.kills, run,
    minutes: (run.t + screens * NODE_SECONDS) / 60, actLevel,
  };
}

const bestPerk = (offer) => {
  let best = 0;
  offer.forEach((id, i) => { if (PERK_ORDER.indexOf(id) < PERK_ORDER.indexOf(offer[best])) best = i; });
  return best;
};

function forgeTurn(run, cfg, r) {
  const ws = weapons(run);
  if (cfg.random) {
    if (C.forge(run, run.eq.weapon, 'upgrade') !== 'ok') C.leave(run);
    return;
  }
  // a missing damage type first (from act 2 on), else the main weapon's tier
  if (!cfg.single && run.act >= 2) {
    const have = new Set(ws.map((x) => C.itemStats(x).type));
    const missing = ['holy', 'ice', 'fire'].filter((t) => !have.has(t));
    const spare = ws.filter((x) => !uniqueType(run, x)).sort((a, b) => weaponValue(run, a) - weaponValue(run, b))[0];
    if (missing.length && spare && C.forge(run, spare.uid, 'reforge', missing[0]) === 'ok') return;
  }
  if (cfg.single) {
    const off = ws.find((x) => !cfg.typeOk(x));
    if (off && C.forge(run, off.uid, 'reforge', cfg.single) === 'ok') return;
  }
  const main = ws.filter((x) => cfg.typeOk(x)).sort((a, b) => weaponValue(run, b) - weaponValue(run, a));
  for (const w of main) if (C.forge(run, w.uid, 'upgrade') === 'ok') return;
  if (run.eq.armor && C.forge(run, run.eq.armor, 'upgrade') === 'ok') return;
  C.leave(run);
}

function shopTurn(run, cfg, r) {
  if (cfg.random) {
    const p = run.offer.length - 1;
    if (r() < 0.6) C.buy(run, p);
    C.leave(run);
    return;
  }
  if (run.hero.potions < 2) C.buy(run, run.offer.length - 1);
  const order = run.offer.map((o, i) => ({ o, i })).filter((x) => x.o.kind === 'item')
    .map((x) => ({ ...x, v: offerValue(run, x.o.item, cfg) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  for (const x of order) {
    if (run.gold < x.o.price) continue;
    makeRoom(run, cfg);
    C.buy(run, x.i);
  }
  equipBest(run, cfg);
  C.leave(run);
}

function fight(run, cfg, r) {
  // the competent player always reads the defence icons before a fight; the casual one only half the time
  if (!cfg.random || r() < 0.5) {
    const pool = cfg.random ? C.quickSlots(run) : weapons(run).filter((x) => cfg.typeOk(x));
    const w = bestWeapon(run, cfg.random ? [specEnemy(run.encounter[0])] : run.encounter.map(specEnemy), pool);
    if (w && w.uid !== run.eq.weapon) C.equip(run, w.uid);
  }
  C.startBattle(run);
  let front = null, react = -1;
  const frame = 1 / 15;
  for (let i = 0; i < 20000 && run.phase === 'battle'; i++) {
    C.step(run, frame);
    const ev = C.drain(run);
    if (run.phase !== 'battle') break;
    const st = C.stats(run);
    if (run.hero.hp < st.maxHp * (cfg.random ? 0.25 : 0.3)) C.usePotion(run);
    const alive = run.battle.enemies.filter((e) => !e.dead);
    if (!alive.length) continue;
    if (cfg.swaps) {
      // re-pick on a new front enemy or a boss phase
      const changed = alive[0].uid !== front || ev.some((e) => e.type === 'phase');
      if (changed) {
        front = alive[0].uid;
        const w = bestWeapon(run, [alive[0]], C.quickSlots(run).filter((x) => cfg.typeOk(x)));
        if (w && w.uid !== run.eq.weapon && dps(run, w, alive[0]) > dps(run, run.bag.find((x) => x.uid === run.eq.weapon), alive[0]) * 1.15) {
          C.swapWeapon(run, w.uid);
        }
      }
    } else if (cfg.random) {
      if (ev.some((e) => e.type === 'phase')) react = r() < 0.5 ? run.battle.t + 2.5 : -1;
      // «Иммунитет» over the enemy is hard to miss: then it always changes the weapon, a little late
      if (react < 0 && ev.some((e) => e.type === 'immune')) react = run.battle.t + 2.5;
      if (react > 0 && run.battle.t >= react) {
        react = -1;
        const w = bestWeapon(run, [alive[0]], C.quickSlots(run));
        if (w && w.uid !== run.eq.weapon) C.swapWeapon(run, w.uid);
      }
    }
  }
}

// Spends «Слава» on the cheapest upgrade that isn't maxed (the bag after the rest of the basics).
function spend(save) {
  for (;;) {
    const ids = Object.keys(K.META).filter((id) => save.meta[id] < K.META[id].max)
      .sort((a, b) => C.metaPrice(save, a) - C.metaPrice(save, b));
    if (!ids.length || C.buyMeta(save, ids[0]) !== 'ok') return;
  }
}

// Repeated runs with «Слава» carried over until the first win (or maxRuns). Run seeds are seed·1000 + run index.
function campaign(name, seed, maxRuns = 20) {
  const save = C.newSave();
  const runs = [];
  for (let i = 0; i < maxRuns; i++) {
    const res = playRun(name, save, seed * 1000 + i);
    C.recordRun(save, res.run);
    spend(save);
    runs.push(res);
    if (res.phase === 'won') return { won: true, runs: i + 1, list: runs, save };
  }
  return { won: false, runs: maxRuns, list: runs, save };
}

// A save with every permanent upgrade bought.
function fullMeta() {
  const save = C.newSave();
  for (const id of Object.keys(K.META)) save.meta[id] = K.META[id].max;
  save.trialsUnlocked = C.TRIALS;
  return save;
}

module.exports = { playRun, campaign, spend, fullMeta, dps, bestWeapon, mulberry };
