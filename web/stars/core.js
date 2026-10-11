// Звездочёт — incremental rules. No DOM, so the balance can be simulated in Node.
(function (root) {
  'use strict';
  // Russian text is the i18n key; names are translated on read, so state only ever holds ids.
  const I18n = typeof module === 'object' && module.exports ? require('../i18n.js') : root.I18n;
  const t = (key, vars) => (I18n ? I18n.t(key, vars) : key);
  // Replaces fixed Russian fields with getters that translate on every read.
  function localize(o, keys) {
    for (const k of keys) {
      const raw = o[k];
      Object.defineProperty(o, k, { get: () => t(raw), enumerable: true, configurable: true });
    }
    return o;
  }

  const INSTRUMENTS = [
    { id: 'spyglass', name: 'Подзорная труба', base: 15, rate: 0.1, note: 'Видно Луну и пару планет.' },
    { id: 'refractor', name: 'Рефрактор', base: 100, rate: 1, note: 'Линза Галилея, кольца Сатурна как «уши».' },
    { id: 'reflector', name: 'Рефлектор Ньютона', base: 1100, rate: 8, note: 'Зеркало вместо линзы, без радуги по краям.' },
    { id: 'observatory', name: 'Обсерватория', base: 12000, rate: 47, note: 'Купол на холме и ночные смены.' },
    { id: 'radio', name: 'Радиотелескоп', base: 130000, rate: 260, note: 'Слушает небо, а не смотрит.' },
    { id: 'orbital', name: 'Орбитальный телескоп', base: 1.4e6, rate: 1400, note: 'Над атмосферой звёзды не мерцают.' },
    { id: 'interferometer', name: 'Интерферометр', base: 2e7, rate: 7800, note: 'Несколько антенн работают как одна размером с планету.' },
    { id: 'gw', name: 'Гравитационно-волновая обсерватория', base: 3.3e8, rate: 44000, note: 'Ловит рябь пространства от слияния чёрных дыр.' },
  ];
  // Lower-case Russian names are keys of their own (used inside upgrade names).
  const RU_NAMES = Object.fromEntries(INSTRUMENTS.map((x) => [x.id, x.name]));
  for (const inst of INSTRUMENTS) localize(inst, ['name', 'note']);
  const INSTRUMENT = Object.fromEntries(INSTRUMENTS.map((x) => [x.id, x]));
  const COST_GROWTH = 1.15;

  // Each instrument doubles at these counts; prices follow the instrument's base price.
  const TIERS = [[1, 10], [5, 50], [25, 500], [50, 50000], [100, 5e6]];
  const TIER_NAMES = ['Чистая оптика', 'Точная монтировка', 'Тёмное небо', 'Адаптивная оптика', 'Нобелевская премия'];

  const UPGRADES = [];
  for (const inst of INSTRUMENTS) {
    TIERS.forEach(([need, mult], k) => UPGRADES.push({
      id: `${inst.id}-${k}`,
      get name() { return `${t(TIER_NAMES[k])}: ${t(RU_NAMES[inst.id].toLowerCase())}`; },
      get desc() { return t('{inst} даёт вдвое больше света', { inst: inst.name }); },
      cost: inst.base * mult, kind: 'inst', inst: inst.id, unlock: (s) => (s.owned[inst.id] || 0) >= need,
    }));
  }
  UPGRADES.push(
    { id: 'eye-1', name: 'Привыкшие к темноте глаза', desc: 'Клик даёт вдвое больше', cost: 100, kind: 'clickMult', unlock: (s) => s.stats.clicks >= 30 },
    { id: 'eye-2', name: 'Карта звёздного неба', desc: 'Клик даёт ещё 1% света в секунду', cost: 1e4, kind: 'clickPct', unlock: (s) => s.stats.light >= 5e3 },
    { id: 'eye-3', name: 'Красный фонарик', desc: 'Клик даёт ещё 1% света в секунду', cost: 1e6, kind: 'clickPct', unlock: (s) => s.stats.light >= 5e5 },
    { id: 'eye-4', name: 'Астролябия', desc: 'Клик даёт вдвое больше', cost: 5e7, kind: 'clickMult', unlock: (s) => s.stats.light >= 2e7 },
    { id: 'meteor-1', name: 'Каталог метеорных потоков', desc: 'Метеоры появляются вдвое чаще', cost: 7.7e5, kind: 'meteorFreq', unlock: (s) => s.stats.meteors >= 1 },
    { id: 'meteor-2', name: 'Длинная выдержка', desc: 'Эффекты метеоров длятся вдвое дольше', cost: 7.7e7, kind: 'meteorDur', unlock: (s) => s.stats.meteors >= 3 },
  );
  for (const u of UPGRADES) if (u.kind !== 'inst') localize(u, ['name', 'desc']);
  const UPGRADE = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

  // Real asterisms with approximate shapes (x right, y down, unit ≈ 10° of sky).
  const CONSTELLATIONS = [
    { id: 'uma', name: 'Большая Медведица', need: 50, bonus: { click: 2 }, bonusText: 'клик ×2',
      stars: [['Дубхе', 0, 0], ['Мерак', 0.1, 0.55], ['Фекда', 0.75, 0.7], ['Мегрец', 0.85, 0.2], ['Алиот', 1.4, 0.3], ['Мицар', 1.9, 0.45], ['Бенетнаш', 2.4, 0.85]],
      lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]] },
    { id: 'cas', name: 'Кассиопея', need: 500, bonus: { all: 0.1 }, bonusText: 'весь свет +10%',
      stars: [['Каф', 0, 0], ['Шедар', 0.45, 0.6], ['Нави', 0.9, 0.25], ['Рукбах', 1.35, 0.55], ['Сегин', 1.8, 0.05]],
      lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
    { id: 'lyr', name: 'Лира', need: 5e3, bonus: { meteorFreq: 1.5 }, bonusText: 'метеоры чаще в 1,5 раза',
      stars: [['Вега', 0.3, 0], ['Эпсилон', 0, 0.35], ['Шелиак', 0.25, 0.9], ['Сулафат', 0.75, 0.8], ['Дзета', 0.55, 0.3]],
      lines: [[0, 1], [0, 4], [1, 4], [4, 3], [3, 2], [2, 1]] },
    { id: 'cyg', name: 'Лебедь', need: 5e4, bonus: { all: 0.15 }, bonusText: 'весь свет +15%',
      stars: [['Денеб', 0.9, 0], ['Садр', 0.9, 0.6], ['Альбирео', 0.9, 1.6], ['Гиена', 0.2, 0.75], ['Дельта', 1.6, 0.4]],
      lines: [[0, 1], [1, 2], [3, 1], [1, 4]] },
    { id: 'leo', name: 'Лев', need: 5e5, bonus: { clickPct: 0.02 }, bonusText: 'клик +2% света в секунду',
      stars: [['Регул', 0.2, 1.0], ['Альгиеба', 0.3, 0.45], ['Адхафера', 0.1, 0.1], ['Расалас', 0.4, -0.15], ['Зосма', 1.5, 0.45], ['Денебола', 2.2, 0.8], ['Хорт', 1.4, 0.95]],
      lines: [[0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [5, 6], [6, 0]] },
    { id: 'ori', name: 'Орион', need: 5e6, bonus: { all: 0.25 }, bonusText: 'весь свет +25%',
      stars: [['Бетельгейзе', 0, 0], ['Беллатрикс', 1.2, 0.1], ['Альнитак', 0.45, 0.95], ['Альнилам', 0.6, 0.88], ['Минтака', 0.75, 0.8], ['Саиф', 0.2, 1.75], ['Ригель', 1.3, 1.65]],
      lines: [[0, 1], [0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]] },
    { id: 'sco', name: 'Скорпион', need: 5e7, bonus: { meteorDur: 1.5 }, bonusText: 'эффекты метеоров дольше в 1,5 раза',
      stars: [['Дшубба', 0, 0], ['Антарес', 0.5, 0.45], ['Тау', 0.65, 0.75], ['Эпсилон', 0.8, 1.15], ['Мю', 0.9, 1.5], ['Сарган', 1.4, 1.75], ['Шаула', 1.75, 1.55]],
      lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]] },
    { id: 'and', name: 'Андромеда', need: 5e8, bonus: { all: 0.5 }, bonusText: 'весь свет +50%',
      stars: [['Альферац', 0, 0.6], ['Мирах', 1.0, 0.35], ['Аламак', 1.9, 0.05], ['Дельта', 0.5, 0.5], ['Туманность М31', 1.15, -0.2]],
      lines: [[0, 3], [3, 1], [1, 2], [1, 4]] },
  ];

  for (const c of CONSTELLATIONS) localize(c, ['name', 'bonusText']);

  const SUPERNOVA_AT = 1e8;
  const DUST_BONUS = 0.1;

  function newState(dust = 0, novae = 0) {
    return {
      v: 1, light: 0, owned: {}, up: {}, const: {}, found: {},
      dust, novae, stats: { light: 0, clicks: 0, meteors: 0 }, time: 0,
      frenzy: 0, meteorIn: 60, seen: {},
    };
  }

  const has = (s, id) => !!s.up[id];
  const count = (s, id) => s.owned[id] || 0;

  function bonuses(s) {
    const b = { click: 1, all: 0, clickPct: 0, meteorFreq: 1, meteorDur: 1 };
    for (const c of CONSTELLATIONS) {
      if (!s.const[c.id]) continue;
      for (const [k, v] of Object.entries(c.bonus)) {
        if (k === 'all' || k === 'clickPct') b[k] += v; else b[k] *= v;
      }
    }
    return b;
  }

  function derived(s) {
    const b = bonuses(s);
    const global = (1 + b.all) * (1 + DUST_BONUS * s.dust) * (s.frenzy > 0 ? 7 : 1);
    const per = {};
    let total = 0;
    for (const inst of INSTRUMENTS) {
      let mult = 1;
      TIERS.forEach((_, k) => { if (has(s, `${inst.id}-${k}`)) mult *= 2; });
      per[inst.id] = inst.rate * mult * global;
      total += per[inst.id] * count(s, inst.id);
    }
    let clickMult = b.click * (1 + DUST_BONUS * s.dust);
    let clickPct = b.clickPct;
    for (const u of UPGRADES) {
      if (!has(s, u.id)) continue;
      if (u.kind === 'clickMult') clickMult *= 2;
      if (u.kind === 'clickPct') clickPct += 0.01;
    }
    const meteorFreq = b.meteorFreq * (has(s, 'meteor-1') ? 2 : 1);
    const meteorDur = b.meteorDur * (has(s, 'meteor-2') ? 2 : 1);
    return { per, rate: total, click: clickMult * (s.frenzy > 0 ? 7 : 1) + clickPct * total, meteorFreq, meteorDur };
  }

  const cost = (id, owned, n = 1) => {
    const base = INSTRUMENT[id].base;
    // Geometric series: sum of base * g^k for k in [owned, owned + n).
    return Math.ceil(base * COST_GROWTH ** owned * (COST_GROWTH ** n - 1) / (COST_GROWTH - 1));
  };

  function maxAffordable(s, id) {
    let n = 0;
    while (cost(id, count(s, id), n + 1) <= s.light) n++;
    return n;
  }

  function addLight(s, n) { s.light += n; s.stats.light += n; }

  function click(s) {
    const n = derived(s).click;
    addLight(s, n);
    s.stats.clicks++;
    return n;
  }

  function buy(s, id, n = 1) {
    if (!INSTRUMENT[id] || n < 1) return false;
    const c = cost(id, count(s, id), n);
    if (s.light < c) return false;
    s.light -= c;
    s.owned[id] = count(s, id) + n;
    return true;
  }

  const upgradeAvailable = (s, u) => !has(s, u.id) && u.unlock(s);

  function buyUpgrade(s, id) {
    const u = UPGRADE[id];
    if (!u || !upgradeAvailable(s, u) || s.light < u.cost) return false;
    s.light -= u.cost;
    s.up[id] = true;
    return true;
  }

  // A constellation is "revealed" once enough light was gathered; the player then clicks its stars.
  const revealed = (s, c) => s.stats.light >= c.need || !!s.const[c.id];

  function findStar(s, constId, idx) {
    const c = CONSTELLATIONS.find((x) => x.id === constId);
    if (!c || s.const[c.id] || !revealed(s, c)) return null;
    const got = s.found[c.id] || [];
    if (got.includes(idx)) return null;
    s.found[c.id] = [...got, idx];
    if (s.found[c.id].length === c.stars.length) { s.const[c.id] = true; return 'complete'; }
    return 'star';
  }

  // Meteors: the UI shows one when meteorIn hits zero; catching it calls catchMeteor.
  function catchMeteor(s, roll) {
    const d = derived(s);
    s.stats.meteors++;
    if (roll < 0.5) {
      const n = Math.min(s.light * 0.15 + 13, d.rate * 900 + 13);
      addLight(s, n);
      return { kind: 'burst', amount: n };
    }
    s.frenzy = 60 * d.meteorDur;
    return { kind: 'frenzy', seconds: s.frenzy };
  }

  function nextMeteorDelay(s, roll) { return (90 + roll * 90) / derived(s).meteorFreq; }

  function tick(s, dt) {
    addLight(s, derived(s).rate * dt);
    if (s.frenzy > 0) s.frenzy = Math.max(0, s.frenzy - dt);
    s.meteorIn -= dt;
    s.time += dt;
  }

  const dustGain = (s) => Math.floor(Math.cbrt(s.stats.light / SUPERNOVA_AT));

  function supernova(s) {
    const g = dustGain(s);
    if (g < 1) return s;
    return newState(s.dust + g, s.novae + 1);
  }

  function offline(s, seconds) {
    const before = s.stats.light;
    let left = Math.min(seconds, 8 * 3600);
    s.frenzy = 0;
    // Production is constant while nothing is bought, so one step is exact.
    addLight(s, derived(s).rate * left);
    s.time += left;
    s.meteorIn = Math.min(s.meteorIn, 20);
    return s.stats.light - before;
  }

  function migrate(raw) {
    const s = newState();
    if (!raw || typeof raw !== 'object') return s;
    Object.assign(s, raw);
    for (const k of ['owned', 'up', 'const', 'found', 'seen']) s[k] = Object.assign({}, raw[k]);
    s.stats = Object.assign(newState().stats, raw.stats);
    return s;
  }

  const api = {
    INSTRUMENTS, UPGRADES, CONSTELLATIONS, SUPERNOVA_AT, DUST_BONUS, newState, derived, cost, maxAffordable, count,
    click, buy, buyUpgrade, upgradeAvailable, revealed, findStar, catchMeteor, nextMeteorDelay, tick, dustGain,
    supernova, offline, migrate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StarsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
