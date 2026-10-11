'use strict';
// Муравейник — economy: colony size, upgrades, passive income, the nuptial flight (prestige). No DOM.
// The ant world itself lives in sim.js; this file turns colony state into sim parameters and food into progress.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AntCore = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  const START_ANTS = 5;
  const FLIGHT_AT = 150;       // colony size that allows the nuptial flight
  const VISIBLE = 360;         // must match AntSim.MAX_AGENTS

  // Names and texts are Russian keys for web/i18n.js.
  const UPGRADES = {
    sugar: { name: 'Сладкие крошки', about: 'Крошки, которые ты кладёшь, становятся вдвое больше.', base: 25, grow: 3, max: 4 },
    jaws: { name: 'Крепкие челюсти', about: 'Каждый муравей уносит на 1 кусочек больше.', base: 60, grow: 4, max: 6 },
    legs: { name: 'Быстрые лапки', about: 'Муравьи бегают на 15% быстрее.', base: 40, grow: 3, max: 6 },
    trail: { name: 'Стойкий след', about: 'Запах тропы держится дольше, дорога к еде не теряется.', base: 70, grow: 3, max: 5 },
    scouts: { name: 'Разведчики', about: 'Колония узнаёт дальние места: больше еды и богаче находки.', base: 90, grow: 3.4, max: 5 },
    queen: { name: 'Плодовитая королева', about: 'Королева сама откладывает яйца: новые муравьи без затрат.', base: 300, grow: 3, max: 5 },
    aphids: { name: 'Стадо тли', about: 'Муравьи пасут тлю и получают сладкую падь, даже когда никто не ищет еду.', base: 500, grow: 2.6, max: 8 },
    fungus: { name: 'Грибной сад', about: 'В глубине гнезда растут грибы: вся еда ценится на 50% больше.', base: 2000, grow: 4, max: 5 },
  };
  // Each new colony after a nuptial flight can be a different species.
  const SPECIES = {
    garden: { name: 'Чёрный садовый муравей', about: 'Королева откладывает яйца вдвое чаще.', color: '#2b1a0c', head: '#2b1a0c' },
    rufa: { name: 'Рыжий лесной муравей', about: 'Бегает на 20% быстрее.', color: '#3a1e10', head: '#9a3c18' },
    messor: { name: 'Муравей-жнец', about: 'Каждый муравей уносит на 1 кусочек больше.', color: '#2e2320', head: '#5a2a1e' },
    atta: { name: 'Муравей-листорез', about: 'Грибной сад приносит вдвое больше.', color: '#8a4a1c', head: '#a85a22' },
    honey: { name: 'Медовый муравей', about: 'Тля даёт вдвое больше, а без тебя колония работает в полную силу.', color: '#6b4a1e', head: '#c08a34' },
  };
  const SPECIES_ORDER = ['garden', 'rufa', 'messor', 'atta', 'honey'];
  // Big finds need a crowd to drag home. Each new kind joins the collection: +3% to all food for good.
  const FINDS = {
    raisin: { name: 'Изюминка', need: 3, value: 1, weight: 10 },
    corn: { name: 'Кукурузное зерно', need: 3, value: 1, weight: 10 },
    acorn: { name: 'Жёлудь', need: 4, value: 1.3, weight: 9 },
    cherry: { name: 'Вишня', need: 4, value: 1.4, weight: 8 },
    honeydrop: { name: 'Капля мёда', need: 4, value: 1.6, weight: 7 },
    strawberry: { name: 'Земляника', need: 5, value: 1.6, weight: 7 },
    cookie: { name: 'Кусочек печенья', need: 5, value: 1.8, weight: 6 },
    mushroom: { name: 'Грибочек', need: 6, value: 2, weight: 5 },
    cheese: { name: 'Кусочек сыра', need: 6, value: 2.2, weight: 5 },
    tangerine: { name: 'Долька мандарина', need: 7, value: 2.5, weight: 4 },
    cake: { name: 'Крошка торта', need: 8, value: 3, weight: 3 },
    golden: { name: 'Золотое семечко', need: 10, value: 5, weight: 1 },
  };
  const FIND_ORDER = Object.keys(FINDS);
  const ORDER = ['sugar', 'jaws', 'legs', 'trail', 'scouts', 'queen', 'aphids', 'fungus'];
  // Upgrades appear once the colony has seen enough food, so the panel grows with the game.
  const SHOW_AT = { sugar: 0, jaws: 30, legs: 30, trail: 80, scouts: 120, queen: 400, aphids: 900, fungus: 3000 };

  function newState() {
    const up = {};
    for (const k of ORDER) up[k] = 0;
    return {
      v: 1, food: 0, total: 0, ants: START_ANTS, bought: 0, up, flights: 0, eggT: 0, rate: 0, crumbs: 0, savedAt: 0, best: START_ANTS,
      species: 'garden', found: {}, bigT: 70, rainT: 300, rain: 0,
    };
  }
  function migrate(s) {
    const base = newState();
    if (!s || typeof s !== 'object') return base;
    const out = Object.assign(base, s);
    out.up = Object.assign(newState().up, s.up || {});
    if (!SPECIES[out.species]) out.species = 'garden';
    if (!out.found || typeof out.found !== 'object') out.found = {};
    return out;
  }

  // Only ants you hatched yourself raise the price; the queen's eggs are free and don't.
  const antCost = (S) => Math.ceil(10 * Math.pow(1.05, S.bought));
  const upCost = (S, k) => Math.ceil(UPGRADES[k].base * Math.pow(UPGRADES[k].grow, S.up[k]));
  const maxed = (S, k) => S.up[k] >= UPGRADES[k].max;
  const visible = (S, k) => S.total >= SHOW_AT[k] || S.up[k] > 0;
  const sp = (S, k) => S.species === k;
  const collected = (S) => FIND_ORDER.filter((k) => S.found[k]).length;
  const collectionBonus = (S) => 1 + 0.03 * collected(S);
  const mult = (S) => (1 + (sp(S, 'atta') ? 1 : 0.5) * S.up.fungus) * (1 + 0.5 * S.flights) * collectionBonus(S);
  // Each visible ant stands for this many real ones.
  const scale = (S) => Math.max(1, S.ants / VISIBLE);
  const crumbSize = (S) => 3 * Math.pow(2, S.up.sugar);
  const aphidRate = (S) => S.up.aphids * 1.5 * (sp(S, 'honey') ? 2 : 1) * mult(S);
  const eggEvery = (S) => (S.up.queen ? (sp(S, 'garden') ? 20 : 40) / S.up.queen : Infinity);

  // Parameters for AntSim.step; territory is capped by the world size the UI passes in.
  function simParams(S, worldR) {
    const shown = Math.min(S.ants, VISIBLE);
    return {
      speed: 30 * (1 + 0.15 * S.up.legs) * (sp(S, 'rufa') ? 1.2 : 1) * (S.rain > 0 ? 0.6 : 1),
      carry: 1 + S.up.jaws + (sp(S, 'messor') ? 1 : 0),
      evaporation: 0.12 * Math.pow(0.82, S.up.trail) * (S.rain > 0 ? 3 : 1),
      territory: Math.min(worldR, 80 + 32 * S.up.scouts),
      pileCount: 4 + S.up.scouts,
      pileAmount: Math.round((30 + shown * 1.2) * (1 + 0.25 * S.up.scouts)),
    };
  }

  // Food the ants carried home (in units) becomes currency.
  function deliver(S, units) {
    const got = units * mult(S) * scale(S);
    S.food += got; S.total += got;
    return got;
  }
  // Time passes: aphids, the queen's eggs, and the income estimate used for offline progress.
  function tick(S, dt) {
    const honey = aphidRate(S) * dt;
    S.food += honey; S.total += honey;
    if (S.up.queen) {
      S.eggT += dt;
      while (S.eggT >= eggEvery(S)) { S.eggT -= eggEvery(S); S.ants++; }
    }
    S.best = Math.max(S.best, S.ants);
  }
  // Exponential average of income per second, fed by the UI every second.
  function trackRate(S, perSec) { S.rate = S.rate ? S.rate * 0.9 + perSec * 0.1 : perSec; }

  function buyAnt(S) {
    const c = antCost(S);
    if (S.food < c) return false;
    S.food -= c; S.ants++; S.bought++;
    S.best = Math.max(S.best, S.ants);
    return true;
  }
  function buy(S, k) {
    if (!UPGRADES[k] || maxed(S, k)) return false;
    const c = upCost(S, k);
    if (S.food < c) return false;
    S.food -= c; S.up[k]++;
    return true;
  }
  const canFly = (S) => S.ants >= FLIGHT_AT;
  // The nuptial flight: a young queen founds a new colony; every flight adds +50% to all food for good.
  // The collection and the record survive; the new colony is the species the player picked.
  function fly(S, species = 'garden') {
    if (!canFly(S) || !SPECIES[species]) return false;
    const keep = { flights: S.flights + 1, best: S.best, found: S.found, species };
    Object.assign(S, newState(), keep);
    return true;
  }

  // Big finds: one at a time, every couple of minutes once the colony can carry them.
  function bigDue(S, dt, busy, rnd = Math.random) {
    if (busy || S.ants < 12) return null;
    S.bigT -= dt;
    if (S.bigT > 0) return null;
    S.bigT = 170 + rnd() * 160;
    // Kinds the colony has not found yet come up more often.
    let total = 0;
    const w = FIND_ORDER.map((k) => { const v = FINDS[k].weight * (S.found[k] ? 1 : 1.5); total += v; return v; });
    let x = rnd() * total;
    for (let i = 0; i < w.length; i++) { if ((x -= w[i]) < 0) return FIND_ORDER[i]; }
    return FIND_ORDER[0];
  }
  // How many carriers a find needs grows a little with the colony, so big colonies still have to gather.
  const bigNeed = (S, kind) => Math.min(30, Math.round(FINDS[kind].need * (1 + Math.min(S.ants, VISIBLE) / 200)));
  function bigReward(S, kind) {
    const first = !S.found[kind];
    S.found[kind] = (S.found[kind] || 0) + 1;
    const got = Math.max(30, S.rate * 20) * FINDS[kind].value;
    S.food += got; S.total += got;
    return { got, first };
  }
  // A short calm rain now and then: ants slow down, scent washes away, mushrooms come after.
  function weather(S, dt, rnd = Math.random) {
    if (S.rain > 0) {
      S.rain -= dt;
      if (S.rain <= 0) { S.rain = 0; S.rainT = 360 + rnd() * 240; return 'end'; }
      return null;
    }
    if (S.total < 200) return null;
    S.rainT -= dt;
    if (S.rainT <= 0) { S.rain = 25; return 'start'; }
    return null;
  }
  // While the page was closed the colony kept working at half its recent pace, up to 8 hours.
  function offline(S, secs) {
    const t = Math.min(secs, 8 * 3600);
    if (t < 30) return 0;
    const share = sp(S, 'honey') ? 1 : 0.5;
    const got = (S.rate + aphidRate(S)) * share * t;
    S.food += got; S.total += got;
    if (S.up.queen) S.ants += Math.floor(t / eggEvery(S) / 2);
    return got;
  }

  return {
    START_ANTS, FLIGHT_AT, VISIBLE, UPGRADES, ORDER, SHOW_AT, SPECIES, SPECIES_ORDER, FINDS, FIND_ORDER,
    newState, migrate, antCost, upCost, maxed, visible, mult, scale, crumbSize, aphidRate, eggEvery,
    simParams, deliver, tick, trackRate, buyAnt, buy, canFly, fly, offline,
    collected, collectionBonus, bigDue, bigNeed, bigReward, weather,
  };
});
