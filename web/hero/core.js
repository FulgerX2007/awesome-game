// Путь героя — pure rules for the roguelite "from noob to legend". No DOM, so the same file runs in the browser
// and in Node (tests and the balance bots). A run is three acts; each act is a seeded map of rows of nodes, and the
// player picks the path. Battles are automatic and run in fixed ticks of 1/60 s; between battles everything is
// discrete. Content (items, enemies, perks…) comes from content.js.
(function (root) {
  'use strict';

  const K = typeof module !== 'undefined' && module.exports ? require('./content.js') : root.HeroContent;
  const { TYPES, ITEMS, ARMORY, ENEMIES, ELITE, BOSSES, BOSS_OF_ACT, PERKS, TITLES, META } = K;

  const TICK = 1 / 60;
  const MAX_DT = 0.25;              // step() simulates at most this much per call
  const ACTS = 3;
  const ROWS = 8;                   // rows 0–6 are mixed, row 7 is the camp; the boss follows as row 8
  const HP_BASE = 70, ATK_BASE = 2, CRIT_BASE = 0.05, CRIT_MULT = 1.5;
  const CRIT_CAP = 0.5, DODGE_CAP = 0.4, HASTE_CAP = 0.4;
  const LEVEL_HP = 8, LEVEL_ATK = 1, LEVEL_HEAL = 0.25;
  const META_HP = 15, META_ATK = 1.5;          // per level of the permanent «Закалённое тело» and «Крепкая рука»
  const SWAP_TIME = 0.8;            // seconds without attacks while the weapon is changed in battle
  const POTION_HEAL = 0.35, MAX_POTIONS = 3;
  const BAG_BASE = 6;
  const TIER_GROWTH = 1.3, MAX_TIER = 5;
  const REGEN_STOP = 3;             // a fire hit stops regeneration for this long
  const CHILL = { slow: 0.25, time: 2 }, NOVA_SLOW = { slow: 0.4, time: 3 };
  const LIFESTEAL = 0.15, CLEAVE = 0.5, PHASE_PAUSE = 1.5;
  // A battle that drags on (an immune enemy, a regenerating one) ends anyway: from ENRAGE_AT seconds the enemies
  // hit harder by ENRAGE_STEP for every further second.
  const ENRAGE_AT = 45, ENRAGE_STEP = 0.1;
  const CAMP_HEAL = 0.4, BOSS_HEAL = 0.3, WIN_HEAL = 0.15, SELL_SHARE = 0.3, POTION_PRICE = 25;
  const TRIALS = 3, TRIAL_MUL = 1.15, TRIAL_GLORY = 0.2;
  const KINDS = ['battle', 'elite', 'chest', 'forge', 'shrine', 'camp', 'shop', 'boss'];
  const PHASES = ['map', 'battle', 'perk', 'chest', 'loot', 'shrine', 'shop', 'forge', 'camp', 'won', 'lost'];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // mulberry32 over a state field: the run carries its generator, so a restored run continues the same way.
  function next(holder) {
    holder.rng = (holder.rng + 0x6D2B79F5) >>> 0;
    let t = holder.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rand = (run) => next(run);
  const pick = (r, list) => list[Math.floor(r() * list.length)];

  // ── Hero ──
  const xpToNext = (level) => Math.round(12 * level ** 1.25);

  function title(level) {
    let t = TITLES[0].name;
    for (const x of TITLES) if (level >= x.from) t = x.name;
    return t;
  }

  const tierMul = (tier) => TIER_GROWTH ** (tier - 1);

  // The numbers of one bag item at its tier (and, for a reforged weapon, its new damage type).
  function itemStats(item) {
    const tpl = ITEMS[item.id], m = tierMul(item.tier);
    if (tpl.slot === 'weapon') {
      return { slot: 'weapon', type: item.type || tpl.type, dmg: tpl.dmg * m, interval: tpl.interval, traits: tpl.traits };
    }
    if (tpl.slot === 'armor') {
      return { slot: 'armor', armor: Math.round(tpl.armor * m), ward: Math.round(tpl.ward * m), hp: Math.round(tpl.hp * m) };
    }
    const power = tpl.spell === 'heal' ? tpl.power + 0.03 * (item.tier - 1) : tpl.power * m;
    return { slot: 'charm', spell: tpl.spell, type: tpl.type || null, power, cd: tpl.cd };
  }

  const priceOf = (item) => Math.round((20 + 25 * item.tier) * (ITEMS[item.id].slot === 'weapon' ? 1 : 0.9));

  const itemBy = (run, uid) => run.bag.find((it) => it.uid === uid) || null;
  const equipped = (run, slot) => (run.eq[slot] == null ? null : itemBy(run, run.eq[slot]));
  const bagMax = (run) => BAG_BASE + run.meta.bag;

  // Everything derived from level, perks, permanent upgrades and the equipment.
  function stats(run) {
    const h = run.hero, b = h.bonus, m = run.meta;
    const arm = equipped(run, 'armor'), a = arm ? itemStats(arm) : { armor: 0, ward: 0, hp: 0 };
    const wpn = equipped(run, 'weapon'), w = wpn ? itemStats(wpn) : null;
    const ch = equipped(run, 'charm'), c = ch ? itemStats(ch) : null;
    return {
      maxHp: Math.round(HP_BASE + META_HP * m.vigor + LEVEL_HP * (h.level - 1) + b.hp + a.hp),
      atk: ATK_BASE + META_ATK * m.might + LEVEL_ATK * (h.level - 1) + b.atk,
      crit: Math.min(CRIT_CAP, CRIT_BASE + b.crit),
      dodge: Math.min(DODGE_CAP, b.dodge),
      armor: a.armor + b.armor,
      ward: a.ward + b.ward,
      haste: Math.min(HASTE_CAP, b.haste),
      leech: b.leech,
      spell: 1 + b.spell,
      weapon: w,
      charm: c,
    };
  }

  const fixHp = (run) => { run.hero.hp = clamp(run.hero.hp, 0, stats(run).maxHp); };

  function heal(run, amount) {
    const max = stats(run).maxHp, before = run.hero.hp;
    run.hero.hp = Math.min(max, run.hero.hp + amount);
    return run.hero.hp - before;
  }

  function gainXp(run, n) {
    const h = run.hero;
    h.xp += n;
    while (h.xp >= xpToNext(h.level)) {
      h.xp -= xpToNext(h.level);
      h.level++;
      run.perkQueue++;
      h.hp += LEVEL_HP;
      heal(run, stats(run).maxHp * LEVEL_HEAL);
      run.events.push({ type: 'levelup', level: h.level, title: title(h.level) });
    }
  }

  // Three different perks from the run's generator.
  function perkOffer(run) {
    const pool = Object.keys(PERKS), out = [];
    while (out.length < 3) out.push(pool.splice(Math.floor(rand(run) * pool.length), 1)[0]);
    return out;
  }

  function applyPerk(run, id, times) {
    const p = PERKS[id], b = run.hero.bonus;
    for (const k of ['hp', 'atk', 'crit', 'dodge', 'armor', 'ward', 'haste', 'leech', 'spell']) if (p[k]) b[k] += p[k] * times;
    if (p.hp) run.hero.hp += p.hp * times;
    fixHp(run);
  }

  // ── Map ──
  // One act: row 0 holds 2–3 battles (the start is picked), rows 1–6 hold 2–4 nodes, row 7 is a single camp and
  // row 8 the boss. Edges join neighbouring rows as a monotone staircase, so they never cross, every node has an
  // edge in and out, and no node has more than two ways forward.
  function linkRows(r, a, b) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const edges = [[0, 0]], out = new Array(a).fill(0);
      out[0] = 1;
      let i = 0, j = 0, ok = true;
      while (i < a - 1 || j < b - 1) {
        let move;
        if (i === a - 1) move = 'j';
        else if (j === b - 1) move = 'i';
        else move = pick(r, ['i', 'j', 'both']);
        if (move === 'j' && out[i] >= 2) move = i < a - 1 ? 'both' : 'j';
        if (move !== 'j') i++;
        if (move !== 'i') j++;
        out[i]++;
        if (out[i] > 2) { ok = false; break; }
        edges.push([i, j]);
      }
      if (ok) return edges;
    }
    return null;
  }

  const KIND_WEIGHTS = { battle: 40, elite: 12, chest: 14, forge: 10, shrine: 10, camp: 7, shop: 9 };

  function drawKind(r, row) {
    const ks = Object.keys(KIND_WEIGHTS).filter((k) => !(k === 'elite' && row < 2));
    const total = ks.reduce((s, k) => s + KIND_WEIGHTS[k], 0);
    let x = r() * total;
    for (const k of ks) { x -= KIND_WEIGHTS[k]; if (x <= 0) return k; }
    return ks[ks.length - 1];
  }

  // Every path from row 0 to the camp passes a node of this kind.
  function everyPathHas(map, kind) {
    const nodes = map.nodes, free = new Array(nodes.length).fill(false); // free: a path from here avoids `kind`
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.kind === kind) { free[i] = false; continue; }
      if (n.kind === 'boss') { free[i] = true; continue; }
      free[i] = n.next.some((k) => free[k]);
    }
    return map.rows[0].every((id) => !free[id]);
  }

  function shopsApart(map) {
    return map.nodes.every((n) => n.kind !== 'shop' || n.next.every((k) => map.nodes[k].kind !== 'shop'));
  }

  function validMap(map) {
    return everyPathHas(map, 'forge') && everyPathHas(map, 'chest') && shopsApart(map);
  }

  // A path from row 0 to the camp that has no node of `kind` (node ids), or null.
  function pathWithout(map, kind) {
    const memo = new Map();
    const walk = (id) => {
      if (memo.has(id)) return memo.get(id);
      const n = map.nodes[id];
      let res = null;
      if (n.kind === kind) res = null;
      else if (n.kind === 'camp') res = [id];
      else for (const k of n.next) { const p = walk(k); if (p) { res = [id, ...p]; break; } }
      memo.set(id, res);
      return res;
    };
    for (const id of map.rows[0]) { const p = walk(id); if (p) return p; }
    return null;
  }

  // Turns a plain node on every path that lacks a forge (or a chest) into one, until no such path is left.
  function repair(map, r) {
    for (const kind of ['chest', 'forge']) {
      for (let guard = 0; guard < 40; guard++) {
        const path = pathWithout(map, kind);
        if (!path) break;
        const plain = path.map((id) => map.nodes[id]).filter((n) => n.row >= 1 && n.row <= 6 && ['battle', 'shrine', 'camp'].includes(n.kind));
        if (!plain.length) return false;
        const battles = plain.filter((n) => n.kind === 'battle');
        pick(r, battles.length > 1 ? battles : plain).kind = kind;
      }
    }
    return true;
  }

  function genMap(seed, act) {
    const holder = { rng: (Math.imul(seed >>> 0, 2654435761) ^ (act * 0x9E3779B9)) >>> 0 };
    const r = () => next(holder);
    for (let attempt = 0; attempt < 400; attempt++) {
      const counts = [2 + Math.floor(r() * 2)];
      for (let row = 1; row < 7; row++) counts.push(2 + Math.floor(r() * 3));
      counts.push(1, 1); // camp, boss
      const nodes = [], rows = [];
      for (let row = 0; row < counts.length; row++) {
        rows.push([]);
        for (let col = 0; col < counts[row]; col++) {
          let kind = row === 0 ? 'battle' : row === 7 ? 'camp' : row === 8 ? 'boss' : drawKind(r, row);
          rows[row].push(nodes.length);
          nodes.push({ id: nodes.length, row, col, kind, next: [] });
        }
      }
      let ok = true;
      for (let row = 0; row < counts.length - 1 && ok; row++) {
        const edges = linkRows(r, counts[row], counts[row + 1]);
        if (!edges) { ok = false; break; }
        for (const [i, j] of edges) {
          const from = nodes[rows[row][i]], to = rows[row + 1][j];
          if (!from.next.includes(to)) from.next.push(to);
        }
      }
      const map = { act, rows, nodes };
      if (ok && repair(map, r) && validMap(map)) return map;
    }
    // Never reached with the weights above (map.test.js checks 200 seeds); kept so a map always exists.
    return genFallback(act);
  }

  function genFallback(act) {
    const kinds = ['battle', 'battle', 'chest', 'battle', 'forge', 'shrine', 'battle', 'camp', 'boss'];
    const nodes = kinds.map((kind, row) => ({ id: row, row, col: 0, kind, next: row < kinds.length - 1 ? [row + 1] : [] }));
    const rows = kinds.map((_, row) => [row]);
    return { act, rows, nodes };
  }

  const mapOf = (run) => run.map;

  // Node ids the player may enter now.
  function reachable(run) {
    if (run.phase !== 'map') return [];
    if (run.at == null) return run.map.rows[0].slice();
    return run.map.nodes[run.at].next.slice();
  }

  // ── Run ──
  const emptyBonus = () => ({ hp: 0, atk: 0, crit: 0, dodge: 0, armor: 0, ward: 0, haste: 0, leech: 0, spell: 0 });

  function cleanMeta(m) {
    const out = {};
    for (const id of Object.keys(META)) {
      const v = m && Number.isInteger(m[id]) ? m[id] : 0;
      out[id] = clamp(v, 0, META[id].max);
    }
    return out;
  }

  function addItem(run, id, tier, type) {
    const item = { uid: run.nextUid++, id, tier: clamp(tier, 1, MAX_TIER) };
    if (type) item.type = type;
    run.bag.push(item);
    return item;
  }

  // phase: map | battle | perk | chest | loot | shrine | shop | forge | camp | won | lost
  function newRun(save, seed = 1, trial = 0) {
    const s = finite(seed) ? Math.floor(seed) >>> 0 : 1;
    const meta = cleanMeta(save && save.meta);
    const maxTrial = save && Number.isInteger(save.trialsUnlocked) ? clamp(save.trialsUnlocked, 0, TRIALS) : 0;
    const run = {
      v: 1, seed: s, rng: s, trial: clamp(Number.isInteger(trial) ? trial : 0, 0, maxTrial), meta,
      act: 1, map: genMap(s, 1), at: null, phase: 'map',
      hero: { level: 1, xp: 0, hp: 0, potions: Math.min(MAX_POTIONS, 1 + meta.potion), bonus: emptyBonus() },
      bag: [], eq: { weapon: null, armor: null, charm: null }, nextUid: 1,
      gold: 25 * meta.purse, kills: 0, bosses: 0, depth: 0,
      offer: [], perkQueue: 0, pendingLoot: false, pendingAct: false,
      encounter: null, battle: null, checkpoint: null, gloryPaid: false,
      t: 0, acc: 0, events: [],
    };
    run.eq.weapon = addItem(run, 'rusty_sword', 1).uid;
    for (const id of ARMORY.slice(0, meta.armory)) addItem(run, id, 1);
    run.hero.hp = stats(run).maxHp;
    return run;
  }

  const status = (run) => run.phase;

  function drain(run) {
    const ev = run.events;
    run.events = [];
    return ev;
  }

  const trialMul = (run) => TRIAL_MUL ** run.trial;
  const actPool = (act) => Object.keys(ENEMIES).filter((k) => ENEMIES[k].act === act);

  // The enemies of a battle node, drawn when the node is entered so a restarted battle is the same battle.
  function genEncounter(run, node) {
    const r = () => rand(run), pool = actPool(run.act), row = node.row;
    if (node.kind === 'boss') return [{ kind: BOSS_OF_ACT[run.act], boss: true, row }];
    if (node.kind === 'elite') {
      const list = [{ kind: pick(r, pool), elite: true, trait: Math.floor(r() * ELITE.traits.length), row }];
      if (row >= 5 && r() < 0.5) list.push({ kind: pick(r, pool), row });
      return list;
    }
    const n = row <= 1 ? 1 : row <= 4 ? 1 + (r() < 0.5 ? 1 : 0) : 2 + (r() < 0.4 ? 1 : 0);
    const list = [];
    for (let i = 0; i < n; i++) list.push({ kind: pick(r, pool), row });
    return list;
  }

  // Three different item ids from the act's pool, at a tier.
  function itemOffer(run, n, tierFn) {
    const pool = Object.keys(ITEMS).filter((id) => ITEMS[id].pool.includes(run.act)), out = [];
    while (out.length < n && pool.length) {
      const id = pool.splice(Math.floor(rand(run) * pool.length), 1)[0];
      out.push({ id, tier: clamp(tierFn(), 1, MAX_TIER) });
    }
    return out;
  }

  // Moves on after a node is done: pending level-up perks first, then the elite/boss loot, then the next act.
  function advance(run) {
    if (run.phase === 'won' || run.phase === 'lost') return;
    if (run.perkQueue > 0) { run.phase = 'perk'; run.offer = perkOffer(run); return; }
    if (run.pendingLoot) {
      run.pendingLoot = false;
      run.phase = 'loot';
      run.offer = itemOffer(run, 3, () => run.act + 1);
      return;
    }
    if (run.pendingAct) {
      run.pendingAct = false;
      run.act++;
      run.map = genMap(run.seed, run.act);
      run.at = null;
      heal(run, stats(run).maxHp * BOSS_HEAL);
      run.events.push({ type: 'act', act: run.act });
    }
    run.phase = 'map';
    run.offer = [];
  }

  // Enters a reachable node. Returns true when it did.
  function choose(run, nodeId) {
    if (!reachable(run).includes(nodeId)) return false;
    const node = run.map.nodes[nodeId];
    run.at = nodeId;
    run.depth++;
    run.offer = [];
    run.events.push({ type: 'node', kind: node.kind });
    switch (node.kind) {
      case 'battle': case 'elite': case 'boss':
        run.phase = 'battle';
        run.encounter = genEncounter(run, node);
        run.battle = null;
        break;
      case 'chest':
        run.phase = 'chest';
        run.offer = itemOffer(run, 3, () => run.act + (rand(run) < 0.35 ? 1 : 0));
        break;
      case 'shrine':
        run.phase = 'shrine';
        run.offer = perkOffer(run);
        break;
      case 'shop': {
        run.phase = 'shop';
        const items = itemOffer(run, 4, () => run.act + (rand(run) < 0.5 ? 1 : 0));
        run.offer = items.map((it) => ({ kind: 'item', item: it, price: priceOf(it), sold: false }));
        run.offer.push({ kind: 'potion', price: POTION_PRICE, sold: false });
        break;
      }
      default:
        run.phase = node.kind; // forge, camp
    }
    return true;
  }

  // ── Battle ──
  function makeEnemy(run, spec, uid) {
    const boss = spec.boss ? BOSSES[spec.kind] : null, base = boss || ENEMIES[spec.kind];
    const rowMul = 1 + 0.06 * (spec.row || 0), tm = trialMul(run);
    let hp = base.hp * (boss ? 1 : rowMul) * tm, dmg = base.dmg * (boss ? 1 : 1 + 0.04 * (spec.row || 0)) * tm;
    let xp = base.xp, gold = base.gold;
    const e = {
      uid, kind: spec.kind, boss: !!boss, elite: !!spec.elite, summoned: !!spec.summoned,
      maxHp: 0, hp: 0, dmg: 0, interval: base.interval, timer: base.interval * 0.6,
      dmgType: boss ? boss.phases[0].dmgType : base.dmgType,
      res: Object.assign({}, boss ? boss.phases[0].res : base.res),
      dodge: base.dodge || 0, regen: base.regen || 0, thorns: base.thorns || 0, shield: base.shield || 0,
      slow: 0, slowT: 0, regenStop: 0, pause: 0, phase: 0, summonT: boss && boss.summon ? boss.summon.every : 0,
      xp, gold, dead: false,
    };
    if (spec.elite) {
      hp *= ELITE.hp; dmg *= ELITE.dmg;
      e.xp = Math.round(xp * ELITE.xp); e.gold = Math.round(gold * ELITE.gold);
      const t = ELITE.traits[clamp(spec.trait | 0, 0, ELITE.traits.length - 1)];
      for (const k of Object.keys(t)) e[k] = Math.max(e[k], t[k]);
    }
    if (spec.summoned) { e.xp = Math.round(xp / 2); e.gold = 0; }
    e.maxHp = Math.round(hp);
    e.hp = spec.hpFrac ? Math.max(1, Math.round(e.maxHp * spec.hpFrac)) : e.maxHp;
    e.dmg = dmg;
    if (boss) {
      e.phase = phaseFor(boss, e.hp / e.maxHp);
      Object.assign(e, phaseFields(boss, e.phase));
    }
    return e;
  }

  function phaseFor(boss, frac) {
    let p = 0;
    boss.phases.forEach((ph, i) => { if (frac <= ph.at + 1e-9) p = i; });
    return p;
  }
  const phaseFields = (boss, p) => ({ res: Object.assign({}, boss.phases[p].res), dmgType: boss.phases[p].dmgType });

  // Starts (or restarts) the battle of the current node from the encounter drawn when the node was entered.
  function startBattle(run) {
    if (run.phase !== 'battle' || !run.encounter || run.battle) return false;
    run.checkpoint = snapshot(run);
    const st = stats(run);
    run.battle = {
      t: 0, heroTimer: st.weapon ? st.weapon.interval * 0.5 : 1, swapT: 0,
      spellT: st.charm ? st.charm.cd * 0.5 : 0, enemies: [], nextUid: 1,
    };
    for (const spec of run.encounter) run.battle.enemies.push(makeEnemy(run, spec, run.battle.nextUid++));
    run.events.push({ type: 'battle', boss: run.encounter.some((s) => s.boss) });
    return true;
  }

  const alive = (b) => b.enemies.filter((e) => !e.dead);

  function kill(run, e) {
    e.dead = true;
    run.kills++;
    run.gold += e.gold;
    run.events.push({ type: 'kill', uid: e.uid, kind: e.kind, boss: e.boss, gold: e.gold });
    gainXp(run, e.xp);
  }

  function checkPhase(run, e) {
    if (!e.boss || e.dead) return;
    const boss = BOSSES[e.kind], p = phaseFor(boss, e.hp / e.maxHp);
    if (p !== e.phase) {
      e.phase = p;
      Object.assign(e, phaseFields(boss, p));
      e.pause = PHASE_PAUSE;
      run.events.push({ type: 'phase', uid: e.uid, phase: p, name: boss.phases[p].name });
    }
  }

  // One hit from the hero (weapon or spell) on an enemy. Returns the damage dealt (0 for a miss, block or immunity).
  function strike(run, e, base, type, o) {
    const st = stats(run);
    if (e.dodge && !o.keen && rand(run) < e.dodge) { run.events.push({ type: 'miss', uid: e.uid }); return 0; }
    if (e.shield > 0) { e.shield--; run.events.push({ type: 'block', uid: e.uid, left: e.shield }); return 0; }
    const mult = e.res[type];
    if (!(mult > 0)) { run.events.push({ type: 'immune', uid: e.uid, dmgType: type }); return 0; }
    const crit = o.crit !== false && rand(run) < st.crit;
    const dmg = Math.max(1, Math.round(base * mult * (crit ? CRIT_MULT : 1)));
    e.hp -= dmg;
    if (type === 'fire') e.regenStop = REGEN_STOP;
    run.events.push({ type: 'hit', uid: e.uid, dmg, dmgType: type, crit, spell: !!o.spell });
    if (o.melee && e.thorns) {
      const back = Math.max(1, Math.round(dmg * e.thorns));
      run.hero.hp -= back;
      run.events.push({ type: 'thorns', dmg: back });
    }
    if (e.hp <= 0) kill(run, e);
    else checkPhase(run, e);
    return dmg;
  }

  function slowDown(e, s) {
    if (e.slowT <= 0 || s.slow >= e.slow) { e.slow = s.slow; e.slowT = s.time; }
  }

  function heroAttack(run) {
    const st = stats(run), w = st.weapon, b = run.battle, targets = alive(b);
    if (!w || !targets.length) return;
    const front = targets[0], base = w.dmg + st.atk;
    const o = { melee: true, keen: w.traits.includes('keen') };
    const dealt = strike(run, front, base, w.type, o);
    if (dealt > 0) {
      if (w.traits.includes('chill') && !front.dead) slowDown(front, CHILL);
      const steal = (w.traits.includes('lifesteal') ? LIFESTEAL : 0) + st.leech;
      if (steal > 0) heal(run, dealt * steal);
    }
    if (w.traits.includes('cleave') && targets[1] && !targets[1].dead) strike(run, targets[1], base * CLEAVE, w.type, o);
  }

  function castSpell(run) {
    const st = stats(run), c = st.charm, b = run.battle, targets = alive(b);
    if (!c || !targets.length) return false;
    if (c.spell === 'heal') {
      if (run.hero.hp > st.maxHp * 0.9) return false;
      const got = heal(run, st.maxHp * c.power * st.spell);
      run.events.push({ type: 'spell', spell: 'heal', amount: Math.round(got) });
      return true;
    }
    run.events.push({ type: 'spell', spell: c.spell });
    const o = { keen: true, crit: false, spell: true };
    if (c.spell === 'nova') {
      for (const e of targets) { if (!e.dead) { strike(run, e, c.power * st.spell, 'ice', o); if (!e.dead) slowDown(e, NOVA_SLOW); } }
    } else {
      strike(run, targets[0], c.power * st.spell, c.type, o);
    }
    return true;
  }

  function enemyAttack(run, e) {
    const st = stats(run);
    if (st.dodge && rand(run) < st.dodge) { run.events.push({ type: 'dodge', uid: e.uid }); return; }
    const def = e.dmgType === 'phys' ? st.armor : st.ward;
    const rage = 1 + Math.max(0, run.battle.t - ENRAGE_AT) * ENRAGE_STEP;
    const dmg = Math.max(1, Math.round(e.dmg * rage * 100 / (100 + def)));
    run.hero.hp -= dmg;
    run.events.push({ type: 'hurt', uid: e.uid, dmg, dmgType: e.dmgType });
  }

  function tick(run) {
    const b = run.battle, st = stats(run);
    b.t += TICK;
    run.t += TICK;
    if (!b.enraged && b.t >= ENRAGE_AT) { b.enraged = true; run.events.push({ type: 'enrage' }); }
    if (b.swapT > 0) {
      b.swapT -= TICK;
      if (b.swapT <= 1e-9) { b.swapT = 0; run.events.push({ type: 'swapped' }); }
    } else {
      b.heroTimer -= TICK;
      if (b.heroTimer <= 1e-9) {
        heroAttack(run);
        b.heroTimer += (st.weapon ? st.weapon.interval : 1) * (1 - st.haste);
      }
    }
    if (st.charm) {
      b.spellT -= TICK;
      if (b.spellT <= 1e-9) {
        if (castSpell(run)) b.spellT = st.charm.cd;
        else b.spellT = 0;
      }
    }
    for (const e of b.enemies) {
      if (e.dead) continue;
      if (e.slowT > 0) e.slowT -= TICK;
      if (e.regenStop > 0) e.regenStop -= TICK;
      else if (e.regen) e.hp = Math.min(e.maxHp, e.hp + e.regen * TICK);
      if (e.pause > 0) { e.pause -= TICK; continue; }
      e.timer -= TICK * (e.slowT > 0 ? 1 - e.slow : 1);
      if (e.timer <= 1e-9) { e.timer += e.interval; enemyAttack(run, e); }
      if (e.boss) {
        const sm = BOSSES[e.kind].summon;
        if (sm) {
          e.summonT -= TICK;
          if (e.summonT <= 0) {
            e.summonT = sm.every;
            if (alive(b).filter((x) => x.kind === sm.kind).length < sm.max) {
              const add = makeEnemy(run, { kind: sm.kind, row: 4, summoned: true }, b.nextUid++);
              b.enemies.push(add);
              run.events.push({ type: 'summon', uid: add.uid, kind: sm.kind });
            }
          }
        }
      }
      if (run.hero.hp <= 0) break;
    }
    if (run.hero.hp <= 0) { endBattle(run, false); return; }
    if (!alive(b).length) endBattle(run, true);
  }

  function endBattle(run, won) {
    const kind = run.map.nodes[run.at].kind;
    run.battle = null;
    run.checkpoint = null;
    run.encounter = null;
    if (!won) {
      run.hero.hp = 0;
      run.phase = 'lost';
      run.events.push({ type: 'defeat' });
      return;
    }
    run.events.push({ type: 'victory', kind });
    heal(run, stats(run).maxHp * WIN_HEAL);
    if (kind === 'boss') {
      run.bosses++;
      if (run.act >= ACTS) { run.phase = 'won'; run.events.push({ type: 'won' }); return; }
      run.pendingAct = true;
      run.pendingLoot = true;
    } else if (kind === 'elite') {
      run.pendingLoot = true;
    }
    advance(run);
  }

  function step(run, dt) {
    if (run.phase !== 'battle' || !run.battle) return;
    if (!finite(dt) || dt <= 0) return;
    run.acc += Math.min(dt, MAX_DT);
    while (run.acc >= TICK - 1e-9) {
      run.acc -= TICK;
      tick(run);
      if (run.phase !== 'battle') { run.acc = 0; break; }
    }
  }

  // ── Actions ──
  function swapWeapon(run, uid) {
    const b = run.battle;
    if (run.phase !== 'battle' || !b || b.swapT > 0) return false;
    const it = itemBy(run, uid);
    if (!it || ITEMS[it.id].slot !== 'weapon' || run.eq.weapon === uid) return false;
    run.eq.weapon = uid;
    b.swapT = SWAP_TIME;
    b.heroTimer = 0;
    run.events.push({ type: 'swap', uid });
    return true;
  }

  function usePotion(run) {
    if (run.phase === 'won' || run.phase === 'lost' || run.hero.potions <= 0) return false;
    const max = stats(run).maxHp;
    if (run.hero.hp >= max) return false;
    run.hero.potions--;
    const got = heal(run, max * POTION_HEAL);
    run.events.push({ type: 'potion', amount: Math.round(got) });
    return true;
  }

  const calm = (run) => !['battle', 'won', 'lost'].includes(run.phase);

  function equip(run, uid) {
    if (!calm(run)) return false;
    const it = itemBy(run, uid);
    if (!it) return false;
    run.eq[ITEMS[it.id].slot] = uid;
    fixHp(run);
    return true;
  }

  // Drops an item from the bag. The last weapon can't go; an equipped weapon is replaced by the next one.
  function discard(run, uid) {
    if (!calm(run)) return false;
    const it = itemBy(run, uid);
    if (!it) return false;
    const slot = ITEMS[it.id].slot;
    if (slot === 'weapon') {
      const others = run.bag.filter((x) => x.uid !== uid && ITEMS[x.id].slot === 'weapon');
      if (!others.length) return false;
      if (run.eq.weapon === uid) run.eq.weapon = others[0].uid;
    } else if (run.eq[slot] === uid) {
      run.eq[slot] = null;
    }
    run.bag = run.bag.filter((x) => x.uid !== uid);
    fixHp(run);
    return true;
  }

  // Moves a bag item to a new position (the first four weapons are the battle quick slots).
  function moveItem(run, uid, index) {
    if (!calm(run)) return false;
    const i = run.bag.findIndex((x) => x.uid === uid);
    if (i < 0 || !Number.isInteger(index)) return false;
    const [it] = run.bag.splice(i, 1);
    run.bag.splice(clamp(index, 0, run.bag.length), 0, it);
    return true;
  }

  // The bag's weapons in the four battle quick slots.
  const quickSlots = (run) => run.bag.filter((x) => ITEMS[x.id].slot === 'weapon').slice(0, 4);

  // Chest, elite/boss loot or shrine: take one offer, or skip with null → 'ok' | 'full' | 'bad'.
  function pickReward(run, index) {
    if (!['chest', 'loot', 'shrine'].includes(run.phase)) return 'bad';
    if (index !== null) {
      if (!Number.isInteger(index) || index < 0 || index >= run.offer.length) return 'bad';
      if (run.phase === 'shrine') applyPerk(run, run.offer[index], 2);
      else {
        if (run.bag.length >= bagMax(run)) return 'full';
        const o = run.offer[index];
        addItem(run, o.id, o.tier);
      }
    }
    run.events.push({ type: 'reward', skipped: index === null });
    run.offer = [];
    run.phase = 'map';
    advance(run);
    return 'ok';
  }

  function pickPerk(run, index) {
    if (run.phase !== 'perk' || !Number.isInteger(index) || index < 0 || index >= run.offer.length) return false;
    applyPerk(run, run.offer[index], 1);
    run.perkQueue--;
    run.offer = [];
    run.phase = 'map';
    advance(run);
    return true;
  }

  // The forge: raise an item's tier, or give a weapon another damage type → 'ok' | 'max' | 'same' | 'bad'.
  function forge(run, uid, action, type) {
    if (run.phase !== 'forge') return 'bad';
    const it = itemBy(run, uid);
    if (!it) return 'bad';
    if (action === 'upgrade') {
      if (it.tier >= MAX_TIER) return 'max';
      it.tier++;
    } else if (action === 'reforge') {
      if (ITEMS[it.id].slot !== 'weapon' || !TYPES.includes(type)) return 'bad';
      if (itemStats(it).type === type) return 'same';
      it.type = type;
    } else {
      return 'bad';
    }
    fixHp(run);
    run.events.push({ type: 'forge', action, uid });
    run.phase = 'map';
    advance(run);
    return 'ok';
  }

  function buy(run, index) {
    if (run.phase !== 'shop') return 'bad';
    const o = run.offer[index];
    if (!o) return 'bad';
    if (o.sold) return 'sold';
    if (run.gold < o.price) return 'nogold';
    if (o.kind === 'potion') {
      if (run.hero.potions >= MAX_POTIONS) return 'full';
      run.hero.potions++;
    } else {
      if (run.bag.length >= bagMax(run)) return 'full';
      addItem(run, o.item.id, o.item.tier);
      o.sold = true;
    }
    run.gold -= o.price;
    run.events.push({ type: 'buy' });
    return 'ok';
  }

  const sellPrice = (item) => Math.round(priceOf(item) * SELL_SHARE);

  function sell(run, uid) {
    if (run.phase !== 'shop') return false;
    const it = itemBy(run, uid);
    if (!it || !discard(run, uid)) return false;
    run.gold += sellPrice(it);
    run.events.push({ type: 'sell' });
    return true;
  }

  // Leaves the shop or the forge without (more) business.
  function leave(run) {
    if (run.phase !== 'shop' && run.phase !== 'forge') return false;
    run.phase = 'map';
    advance(run);
    return true;
  }

  function camp(run, choice) {
    if (run.phase !== 'camp') return false;
    if (choice === 'rest') heal(run, stats(run).maxHp * CAMP_HEAL);
    else if (choice === 'train') gainXp(run, xpToNext(run.hero.level) - run.hero.xp);
    else return false;
    run.events.push({ type: 'camp', choice });
    run.phase = 'map';
    advance(run);
    return true;
  }

  // ── Score and permanent progression ──
  const glory = (run) => Math.round((run.depth * 8 + run.kills * 2 + run.bosses * 60) * (1 + TRIAL_GLORY * run.trial));

  const metaPrice = (save, id) => Math.round(META[id].base * META[id].growth ** save.meta[id]);

  function buyMeta(save, id) {
    if (!has(META, id)) return 'unknown';
    if (save.meta[id] >= META[id].max) return 'max';
    const price = metaPrice(save, id);
    if (save.glory < price) return 'noglory';
    save.glory -= price;
    save.meta[id]++;
    return 'ok';
  }

  // ── Snapshots ──
  // A run outside battle is plain data. During a battle the snapshot is the state at the battle's start, so a
  // reload restarts it with the same enemies.
  function snapshot(run) {
    if (run.phase === 'battle' && run.battle && run.checkpoint) return clone(run.checkpoint);
    const o = {};
    for (const k of Object.keys(run)) if (!['battle', 'checkpoint', 'events', 'acc'].includes(k)) o[k] = run[k];
    return clone(o);
  }

  const num = (v, lo, hi) => finite(v) && v >= lo && v <= hi;
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

  function validItem(it) {
    return it && int(it.uid, 1, 1e9) && typeof it.id === 'string' && has(ITEMS, it.id) && int(it.tier, 1, MAX_TIER)
      && (it.type === undefined || (TYPES.includes(it.type) && ITEMS[it.id].slot === 'weapon'));
  }

  function validMapData(m, act) {
    if (!m || m.act !== act || !Array.isArray(m.nodes) || !Array.isArray(m.rows) || m.nodes.length > 60) return false;
    return m.nodes.every((n, i) => n && n.id === i && KINDS.includes(n.kind) && int(n.row, 0, 8)
      && Array.isArray(n.next) && n.next.every((k) => int(k, 0, m.nodes.length - 1) && k > i))
      && m.rows.every((r) => Array.isArray(r) && r.every((k) => int(k, 0, m.nodes.length - 1)));
  }

  function validSpec(s) {
    if (!s || typeof s.kind !== 'string') return false;
    if (s.boss ? !has(BOSSES, s.kind) : !has(ENEMIES, s.kind)) return false;
    return s.hpFrac === undefined || num(s.hpFrac, 0.01, 1);
  }

  // A run from a snapshot, or null when it doesn't look right.
  function restore(o) {
    if (!o || typeof o !== 'object' || o.v !== 1) return null;
    if (!PHASES.includes(o.phase) || !int(o.act, 1, ACTS) || !int(o.seed, 0, 2 ** 32) || !int(o.rng, 0, 2 ** 32)) return null;
    if (!int(o.trial, 0, TRIALS) || !num(o.gold, 0, 1e9) || !int(o.kills, 0, 1e9) || !int(o.bosses, 0, ACTS) || !int(o.depth, 0, 1e4)) return null;
    const h = o.hero;
    if (!h || !int(h.level, 1, 999) || !num(h.xp, 0, 1e9) || !num(h.hp, 0, 1e7) || !int(h.potions, 0, MAX_POTIONS)) return null;
    if (!h.bonus || !Object.keys(emptyBonus()).every((k) => num(h.bonus[k], 0, 1e6))) return null;
    if (!Array.isArray(o.bag) || !o.bag.every(validItem) || o.bag.length > BAG_BASE + META.bag.max) return null;
    if (new Set(o.bag.map((x) => x.uid)).size !== o.bag.length) return null;
    if (!o.eq || !['weapon', 'armor', 'charm'].every((s) => o.eq[s] == null || o.bag.some((x) => x.uid === o.eq[s] && ITEMS[x.id].slot === s))) return null;
    if (o.eq.weapon == null || !int(o.nextUid, 1, 1e9) || o.bag.some((x) => x.uid >= o.nextUid)) return null;
    if (!validMapData(o.map, o.act) || !(o.at === null || int(o.at, 0, o.map.nodes.length - 1))) return null;
    if (!int(o.perkQueue, 0, 999) || !Array.isArray(o.offer)) return null;
    if (o.phase === 'battle' && (!Array.isArray(o.encounter) || !o.encounter.length || !o.encounter.every(validSpec))) return null;
    const run = newRun({ meta: o.meta, trialsUnlocked: TRIALS }, o.seed, o.trial);
    for (const k of ['rng', 'act', 'map', 'at', 'phase', 'hero', 'bag', 'eq', 'nextUid', 'gold', 'kills', 'bosses', 'depth',
      'offer', 'perkQueue', 'encounter']) run[k] = clone(o[k] === undefined ? null : o[k]);
    run.pendingLoot = o.pendingLoot === true;
    run.pendingAct = o.pendingAct === true;
    run.gloryPaid = o.gloryPaid === true;
    run.t = num(o.t, 0, 1e9) ? o.t : 0;
    if (!Array.isArray(run.offer)) run.offer = [];
    if (run.phase !== 'battle') run.encounter = null;
    fixHp(run);
    return run;
  }

  // ── Save ──
  // hero.save: { v: 1, glory, meta: {id: level}, wins, bestDepth, trial (picked), trialsUnlocked, current }
  const SAVE_KEY = 'hero.save';
  const newSave = () => ({ v: 1, glory: 0, meta: cleanMeta(null), wins: 0, bestDepth: 0, trial: 0, trialsUnlocked: 0, current: null });

  function parseSave(raw) {
    const out = newSave();
    if (typeof raw !== 'string') return out;
    let d;
    try { d = JSON.parse(raw); } catch { return out; }
    if (!d || typeof d !== 'object' || d.v !== 1) return out;
    if (int(d.glory, 0, 1e9)) out.glory = d.glory;
    out.meta = cleanMeta(d.meta);
    if (int(d.wins, 0, 1e9)) out.wins = d.wins;
    if (int(d.bestDepth, 0, 1e4)) out.bestDepth = d.bestDepth;
    if (int(d.trialsUnlocked, 0, TRIALS)) out.trialsUnlocked = d.trialsUnlocked;
    if (int(d.trial, 0, out.trialsUnlocked)) out.trial = d.trial;
    out.current = restore(d.current) ? d.current : null;
    return out;
  }

  function loadSave(storage) {
    let raw = null;
    try { raw = storage ? storage.getItem(SAVE_KEY) : null; } catch { raw = null; }
    return parseSave(raw);
  }

  function storeSave(storage, save) {
    try {
      if (!storage) return false;
      storage.setItem(SAVE_KEY, JSON.stringify(save));
      return true;
    } catch {
      return false;
    }
  }

  // Folds a finished run into the save once: «Слава», wins, the best depth and the next trial. Returns the glory
  // earned (0 when the run isn't over or was already counted).
  function recordRun(save, run) {
    if ((run.phase !== 'won' && run.phase !== 'lost') || run.gloryPaid) return 0;
    const g = glory(run);
    run.gloryPaid = true;
    save.glory += g;
    if (run.depth > save.bestDepth) save.bestDepth = run.depth;
    if (run.phase === 'won') {
      save.wins++;
      if (run.trial === save.trialsUnlocked && save.trialsUnlocked < TRIALS) save.trialsUnlocked++;
    }
    save.current = null;
    return g;
  }

  const api = {
    TICK, MAX_DT, ACTS, ROWS, HP_BASE, ATK_BASE, CRIT_BASE, CRIT_MULT, CRIT_CAP, DODGE_CAP, HASTE_CAP, LEVEL_HP, LEVEL_ATK,
    LEVEL_HEAL, META_HP, META_ATK, SWAP_TIME, POTION_HEAL, MAX_POTIONS, BAG_BASE, TIER_GROWTH, MAX_TIER, REGEN_STOP, CHILL, NOVA_SLOW,
    LIFESTEAL, CLEAVE, PHASE_PAUSE, ENRAGE_AT, ENRAGE_STEP, CAMP_HEAL, BOSS_HEAL, WIN_HEAL, SELL_SHARE, POTION_PRICE, TRIALS, TRIAL_MUL, TRIAL_GLORY,
    KINDS, PHASES, SAVE_KEY, KIND_WEIGHTS,
    clamp, rand, xpToNext, title, tierMul, itemStats, priceOf, sellPrice, stats, bagMax, quickSlots,
    genMap, validMap, everyPathHas, mapOf, reachable, newRun, status, drain, choose, startBattle, step,
    swapWeapon, usePotion, equip, discard, moveItem, pickReward, pickPerk, forge, buy, sell, leave, camp,
    glory, metaPrice, buyMeta, snapshot, restore, newSave, parseSave, loadSave, storeSave, recordRun,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HeroCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
