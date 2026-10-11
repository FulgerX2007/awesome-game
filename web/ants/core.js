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
  const ORDER = ['sugar', 'jaws', 'legs', 'trail', 'scouts', 'queen', 'aphids', 'fungus'];
  // Upgrades appear once the colony has seen enough food, so the panel grows with the game.
  const SHOW_AT = { sugar: 0, jaws: 30, legs: 30, trail: 80, scouts: 120, queen: 400, aphids: 900, fungus: 3000 };

  function newState() {
    const up = {};
    for (const k of ORDER) up[k] = 0;
    return { v: 1, food: 0, total: 0, ants: START_ANTS, bought: 0, up, flights: 0, eggT: 0, rate: 0, crumbs: 0, savedAt: 0, best: START_ANTS };
  }
  function migrate(s) {
    const base = newState();
    if (!s || typeof s !== 'object') return base;
    const out = Object.assign(base, s);
    out.up = Object.assign(newState().up, s.up || {});
    return out;
  }

  // Only ants you hatched yourself raise the price; the queen's eggs are free and don't.
  const antCost = (S) => Math.ceil(10 * Math.pow(1.05, S.bought));
  const upCost = (S, k) => Math.ceil(UPGRADES[k].base * Math.pow(UPGRADES[k].grow, S.up[k]));
  const maxed = (S, k) => S.up[k] >= UPGRADES[k].max;
  const visible = (S, k) => S.total >= SHOW_AT[k] || S.up[k] > 0;
  const mult = (S) => (1 + 0.5 * S.up.fungus) * (1 + 0.5 * S.flights);
  // Each visible ant stands for this many real ones.
  const scale = (S) => Math.max(1, S.ants / VISIBLE);
  const crumbSize = (S) => 3 * Math.pow(2, S.up.sugar);
  const aphidRate = (S) => S.up.aphids * 1.5 * mult(S);
  const eggEvery = (S) => (S.up.queen ? 40 / S.up.queen : Infinity);

  // Parameters for AntSim.step; territory is capped by the world size the UI passes in.
  function simParams(S, worldR) {
    const shown = Math.min(S.ants, VISIBLE);
    return {
      speed: 30 * (1 + 0.15 * S.up.legs),
      carry: 1 + S.up.jaws,
      evaporation: 0.12 * Math.pow(0.82, S.up.trail),
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
  function fly(S) {
    if (!canFly(S)) return false;
    const flights = S.flights + 1;
    const fresh = newState();
    Object.assign(S, fresh, { flights, best: S.best });
    return true;
  }
  // While the page was closed the colony kept working at half its recent pace, up to 8 hours.
  function offline(S, secs) {
    const t = Math.min(secs, 8 * 3600);
    if (t < 30) return 0;
    const got = (S.rate * 0.5 + aphidRate(S) * 0.5) * t;
    S.food += got; S.total += got;
    if (S.up.queen) S.ants += Math.floor(t / eggEvery(S) / 2);
    return got;
  }

  return {
    START_ANTS, FLIGHT_AT, VISIBLE, UPGRADES, ORDER, SHOW_AT,
    newState, migrate, antCost, upCost, maxed, visible, mult, scale, crumbSize, aphidRate, eggEvery,
    simParams, deliver, tick, trackRate, buyAnt, buy, canFly, fly, offline,
  };
});
