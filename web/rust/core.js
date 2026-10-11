// Ржавый рассвет — pure game rules. No DOM here, so the same file runs in the
// browser and in Node (balance simulation).
(function (root) {
  'use strict';

  const ROLES = ['digger', 'sorter', 'mechanic'];

  const UPGRADES = [
    { id: 'shovel', name: 'Лопата', desc: '+1 хлам за удар', max: 15,
      cost: (l) => ({ parts: Math.ceil(5 * 1.8 ** l) }), unlock: () => true },
    { id: 'gloves', name: 'Рабочие перчатки', desc: 'Разбираешь на одну горсть больше за раз', max: 10,
      cost: (l) => ({ parts: Math.ceil(8 * 1.9 ** l) }), unlock: (s) => s.stats.parts >= 3 },
    { id: 'wrench', name: 'Гаечный ключ', desc: '+2 к ремонту за удар', max: 10,
      cost: (l) => ({ parts: Math.ceil(12 * 1.9 ** l) }), unlock: (s) => s.built >= 1 || !!s.repair },
    { id: 'magnet', name: 'Электромагнит', desc: 'Копатели работают на 50% быстрее', max: 20,
      cost: (l) => ({ parts: Math.ceil(30 * 1.7 ** l) }), unlock: (s) => s.built >= 1 },
    { id: 'belt', name: 'Лента транспортёра', desc: 'Сортировщики работают на 50% быстрее', max: 20,
      cost: (l) => ({ parts: Math.ceil(40 * 1.7 ** l) }), unlock: (s) => s.built >= 2 },
    { id: 'oil', name: 'Машинное масло', desc: 'Механики работают на 50% быстрее', max: 20,
      cost: (l) => ({ parts: Math.ceil(40 * 1.7 ** l) }), unlock: (s) => s.built >= 2 },
    { id: 'dispatch', name: 'Диспетчер', desc: 'Новые роботы сами встают туда, где они нужнее', max: 1,
      cost: () => ({ parts: 120 }), unlock: (s) => s.built >= 3 },
    { id: 'smelter', name: 'Плавильня', desc: 'Деталь получается из меньшего количества хлама', max: 3,
      cost: (l) => ({ parts: Math.ceil(150 * 4 ** l) }), unlock: (s) => s.built >= 3 },
    { id: 'scanner', name: 'Сканер', desc: 'Шанс найти ядро среди деталей +0,5%', max: 8,
      cost: (l) => ({ parts: Math.ceil(80 * 2.5 ** l) }), unlock: (s) => s.stats.parts >= 50 },
    { id: 'factory', name: 'Сборочный цех', desc: 'Ремонтирует роботов сам: +1 к ремонту в секунду', max: 15,
      cost: (l) => ({ parts: Math.ceil(200 * 2 ** l), cores: Math.ceil(2 * 1.8 ** l) }), unlock: (s) => s.stats.cores >= 1 },
    { id: 'neuro', name: 'Нейроядро', desc: 'Все роботы работают вдвое быстрее', max: 5,
      cost: (l) => ({ parts: Math.ceil(1000 * 5 ** l), cores: Math.ceil(10 * 3 ** l) }), unlock: (s) => s.stats.cores >= 5 },
  ];
  const UPGRADE = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

  const ARK = [
    { name: 'Каркас', parts: 1000, cores: 0 },
    { name: 'Двигатели', parts: 5000, cores: 5 },
    { name: 'Реактор', parts: 20000, cores: 20 },
    { name: 'Навигация', parts: 60000, cores: 50 },
    { name: 'Запуск', parts: 150000, cores: 100 },
  ];
  const ARK_UNLOCK = 5; // robots built

  function newState(blueprints = 0, runs = 0) {
    return {
      v: 1,
      scrap: 0, parts: 0, cores: 0,
      robots: { idle: 0, digger: 0, sorter: 0, mechanic: 0 },
      built: 0, repair: null, autoRepair: true,
      up: {}, ark: 0, launched: false,
      blueprints, runs,
      stats: { scrap: 0, parts: 0, cores: 0, clicks: 0 },
      time: 0, seen: {},
    };
  }

  const lvl = (s, id) => s.up[id] || 0;

  function derived(s) {
    const bp = 1 + 0.1 * s.blueprints;
    const g = bp * 2 ** lvl(s, 'neuro');
    return {
      click: (1 + lvl(s, 'shovel')) * bp,
      batch: 1 + lvl(s, 'gloves'),
      ratio: 5 - lvl(s, 'smelter'),
      wrench: 1 + 2 * lvl(s, 'wrench'),
      digger: 1.0 * (1 + 0.5 * lvl(s, 'magnet')) * g,
      sorter: 0.5 * (1 + 0.5 * lvl(s, 'belt')) * g,
      mechanic: 0.5 * (1 + 0.5 * lvl(s, 'oil')) * g,
      factory: lvl(s, 'factory') * g,
      coreChance: 0.005 * (1 + lvl(s, 'scanner')),
      robotCost: Math.ceil(10 * 1.075 ** s.built),
      repairNeed: 20 + 3 * s.built,
    };
  }

  function addScrap(s, n) { s.scrap += n; s.stats.scrap += n; }
  function addParts(s, n, d) {
    s.parts += n; s.stats.parts += n;
    const c = n * d.coreChance;
    s.cores += c; s.stats.cores += c;
  }

  const canAfford = (s, c) => s.parts >= (c.parts || 0) && s.cores >= (c.cores || 0);
  function pay(s, c) { s.parts -= c.parts || 0; s.cores -= c.cores || 0; }

  // ── Manual actions ──
  function dig(s) {
    const n = derived(s).click;
    addScrap(s, n);
    s.stats.clicks++;
    return n;
  }

  function disassemble(s) {
    const d = derived(s);
    const n = Math.min(d.batch, Math.floor(s.scrap / d.ratio));
    if (n <= 0) return 0;
    s.scrap -= n * d.ratio;
    addParts(s, n, d);
    s.stats.clicks++;
    return n;
  }

  function startRepair(s) {
    if (s.repair) return false;
    const d = derived(s);
    if (s.parts < d.robotCost) return false;
    s.parts -= d.robotCost;
    s.repair = { progress: 0, need: d.repairNeed };
    return true;
  }

  const hasAutoRepair = (s) => s.robots.mechanic > 0 || lvl(s, 'factory') > 0;

  function repairWork(s, units) {
    if (!s.repair) return;
    s.repair.progress += units;
    while (s.repair && s.repair.progress >= s.repair.need) {
      const extra = s.repair.progress - s.repair.need;
      s.repair = null;
      finishRobot(s);
      if (s.autoRepair && hasAutoRepair(s) && startRepair(s)) s.repair.progress = Math.min(extra, s.repair.need);
    }
  }

  function repairClick(s) {
    if (!s.repair && !startRepair(s)) return 0;
    const n = derived(s).wrench;
    repairWork(s, n);
    s.stats.clicks++;
    return n;
  }

  function finishRobot(s) {
    s.built++;
    if (lvl(s, 'dispatch')) {
      s.robots[neededRole(s)]++;
    } else {
      s.robots.idle++;
    }
  }

  // Keep ~20% mechanics, then balance diggers' output against sorters' intake.
  function neededRole(s) {
    const d = derived(s), r = s.robots;
    const team = r.digger + r.sorter + r.mechanic;
    if (r.mechanic < team * 0.2) return 'mechanic';
    return r.digger * d.digger > r.sorter * d.sorter * d.ratio ? 'sorter' : 'digger';
  }

  function assign(s, role, delta) {
    if (!ROLES.includes(role)) return;
    for (let i = 0; i < Math.abs(delta); i++) {
      if (delta > 0 && s.robots.idle > 0) { s.robots.idle--; s.robots[role]++; }
      else if (delta < 0 && s.robots[role] > 0) { s.robots[role]--; s.robots.idle++; }
    }
  }

  function upgradeState(s, id) {
    const u = UPGRADE[id], l = lvl(s, id);
    return { u, level: l, maxed: l >= u.max, unlocked: u.unlock(s), cost: l >= u.max ? null : u.cost(l) };
  }

  function buy(s, id) {
    const st = upgradeState(s, id);
    if (!st.unlocked || st.maxed || !canAfford(s, st.cost)) return false;
    pay(s, st.cost);
    s.up[id] = st.level + 1;
    return true;
  }

  const arkUnlocked = (s) => s.built >= ARK_UNLOCK || s.ark > 0;

  function buildArk(s) {
    const stage = ARK[s.ark];
    if (!stage || !arkUnlocked(s) || !canAfford(s, stage)) return false;
    pay(s, stage);
    s.ark++;
    if (s.ark === ARK.length) s.launched = true;
    return true;
  }

  const blueprintGain = (s) => Math.max(1, Math.floor(Math.sqrt(s.stats.parts / 10000)));

  function prestige(s) {
    if (!s.launched) return s;
    return newState(s.blueprints + blueprintGain(s), s.runs + 1);
  }

  // ── Automation ──
  function tick(s, dt) {
    const d = derived(s);
    const r = s.robots;
    addScrap(s, r.digger * d.digger * dt);

    const batches = Math.min(r.sorter * d.sorter * dt, s.scrap / d.ratio);
    if (batches > 0) { s.scrap -= batches * d.ratio; addParts(s, batches, d); }

    if (!s.repair && s.autoRepair && hasAutoRepair(s)) startRepair(s);
    if (s.repair) repairWork(s, (r.mechanic * d.mechanic + d.factory) * dt);
    s.time += dt;
  }

  // Net per-second rates at the current moment, for the HUD.
  function rates(s) {
    const d = derived(s), r = s.robots;
    const dig = r.digger * d.digger;
    const sortCap = r.sorter * d.sorter;
    const batches = s.scrap > d.ratio ? sortCap : Math.min(sortCap, dig / d.ratio);
    return {
      scrap: dig - batches * d.ratio,
      parts: batches,
      cores: batches * d.coreChance,
      repair: s.repair || hasAutoRepair(s) ? r.mechanic * d.mechanic + d.factory : 0,
    };
  }

  function offline(s, seconds) {
    const before = { scrap: s.stats.scrap, parts: s.stats.parts, cores: s.stats.cores, built: s.built };
    let left = Math.min(seconds, 8 * 3600);
    while (left > 0) { const dt = Math.min(1, left); tick(s, dt); left -= dt; }
    return {
      scrap: s.stats.scrap - before.scrap, parts: s.stats.parts - before.parts,
      cores: s.stats.cores - before.cores, robots: s.built - before.built,
    };
  }

  // Fill in fields missing from older saves.
  function migrate(raw) {
    const s = newState();
    if (!raw || typeof raw !== 'object') return s;
    Object.assign(s, raw);
    s.robots = Object.assign(newState().robots, raw.robots);
    s.stats = Object.assign(newState().stats, raw.stats);
    s.up = Object.assign({}, raw.up);
    s.seen = Object.assign({}, raw.seen);
    return s;
  }

  const api = {
    ROLES, UPGRADES, neededRole, ARK, ARK_UNLOCK, newState, derived, lvl, canAfford,
    dig, disassemble, startRepair, repairClick, assign, upgradeState, buy,
    arkUnlocked, buildArk, blueprintGain, prestige, tick, rates, offline, migrate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RustCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
