// Неон — incremental rules. No DOM, so the balance can be simulated in Node.
// The currency is stolen data, counted in bytes. The twist is the trace meter: clicks and breaches
// are noisy, trace cools down by itself, a hot trace doubles clicks, and a full one locks you out.
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

  const RIGS = [
    { id: 'script', name: 'Скрипт из даркнета', base: 15, rate: 0.1, note: 'Чужой код, зато работает сам.' },
    { id: 'deck', name: 'Кибердека', base: 100, rate: 1, note: 'Самодельная дека на старой плате.' },
    { id: 'botnet', name: 'Ботнет', base: 1100, rate: 8, note: 'Тысячи умных чайников работают на тебя.' },
    { id: 'implant', name: 'Нейроимплант', base: 12000, rate: 47, note: 'Порт за ухом, сеть прямо в голове.' },
    { id: 'drones', name: 'Рой дронов', base: 130000, rate: 260, note: 'Снимают пароли с витрин и экранов.' },
    { id: 'server', name: 'Подпольный дата-центр', base: 1.4e6, rate: 1400, note: 'Стойки в подвале заброшенного метро.' },
    { id: 'ai', name: 'Беглый ИИ', base: 2e7, rate: 7800, note: 'Сбежал от корпорации и работает за свободу.' },
    { id: 'quantum', name: 'Квантовый взломщик', base: 3.3e8, rate: 44000, note: 'Перебирает все ключи сразу.' },
  ];
  // Lower-case Russian names are keys of their own (used inside upgrade names).
  const RU_NAMES = Object.fromEntries(RIGS.map((x) => [x.id, x.name]));
  for (const r of RIGS) localize(r, ['name', 'note']);
  const RIG = Object.fromEntries(RIGS.map((x) => [x.id, x]));
  const COST_GROWTH = 1.15;

  // Each rig doubles at these counts; prices follow the rig's base price.
  const TIERS = [[1, 10], [5, 50], [25, 500], [50, 50000], [100, 5e6]];
  const TIER_NAMES = ['Разгон', 'Чистый код', 'Обход файрвола', 'Нулевой день', 'Легенда сети'];

  const UPGRADES = [];
  for (const rig of RIGS) {
    TIERS.forEach(([need, mult], k) => UPGRADES.push({
      id: `${rig.id}-${k}`,
      get name() { return `${t(TIER_NAMES[k])}: ${t(RU_NAMES[rig.id].toLowerCase())}`; },
      get desc() { return t('{rig} качает вдвое больше', { rig: rig.name }); },
      cost: rig.base * mult, kind: 'rig', rig: rig.id, unlock: (s) => (s.owned[rig.id] || 0) >= need,
    }));
  }
  UPGRADES.push(
    { id: 'click-1', name: 'Механическая клавиатура', desc: 'Клик даёт вдвое больше', cost: 100, kind: 'clickMult', unlock: (s) => s.stats.clicks >= 30 },
    { id: 'click-2', name: 'Макросы', desc: 'Клик даёт ещё 1% потока в секунду', cost: 1e4, kind: 'clickPct', unlock: (s) => s.stats.data >= 5e3 },
    { id: 'click-3', name: 'Нейроразгон', desc: 'Клик даёт ещё 1% потока в секунду', cost: 1e6, kind: 'clickPct', unlock: (s) => s.stats.data >= 5e5 },
    { id: 'click-4', name: 'Боевой софт', desc: 'Клик даёт вдвое больше', cost: 5e7, kind: 'clickMult', unlock: (s) => s.stats.data >= 2e7 },
    { id: 'proxy-1', name: 'Цепочка прокси', desc: 'ЛЁД блокирует вдвое короче и стирает вдвое меньше', cost: 500, kind: 'lock', unlock: (s) => s.stats.locks >= 1 || s.stats.clicks >= 200 },
    { id: 'proxy-2', name: 'Адреналин', desc: 'В красной зоне клик ×3 вместо ×2', cost: 2e5, kind: 'hotMult', unlock: (s) => s.stats.hotClicks >= 50 || s.stats.data >= 1e5 },
    { id: 'proxy-3', name: 'Холодная голова', desc: 'Красная зона начинается с 55%', cost: 3e6, kind: 'hotFrom', unlock: (s) => s.stats.data >= 2e6 },
    { id: 'drone-1', name: 'Перехватчик сигналов', desc: 'Дроны-курьеры летают вдвое чаще', cost: 7.7e5, kind: 'droneFreq', unlock: (s) => s.stats.drones >= 1 },
    { id: 'drone-2', name: 'Вирус-паразит', desc: 'Эффекты дронов длятся вдвое дольше', cost: 7.7e7, kind: 'droneDur', unlock: (s) => s.stats.drones >= 3 },
  );
  for (const u of UPGRADES) if (u.kind !== 'rig') localize(u, ['name', 'desc']);
  const UPGRADE = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

  // Megacorp towers on the skyline. `nodes` is how many ICE nodes must be cracked.
  const CORPS = [
    { id: 'kobalt', name: 'Кобальт Логистик', logo: 'КОБАЛЬТ', need: 50, nodes: 4, bonus: { click: 2 }, bonusText: 'клик ×2' },
    { id: 'sintez', name: 'Синтез-Мед', logo: 'СИНТЕЗ', need: 500, nodes: 5, bonus: { all: 0.1 }, bonusText: 'весь поток +10%' },
    { id: 'aurora', name: 'Аврора Медиа', logo: 'АВРОРА', need: 5e3, nodes: 5, bonus: { droneFreq: 1.5 }, bonusText: 'дроны чаще в 1,5 раза' },
    { id: 'chrom', name: 'Хром и сыновья', logo: 'ХРОМ', need: 5e4, nodes: 6, bonus: { all: 0.15 }, bonusText: 'весь поток +15%' },
    { id: 'oracle', name: 'Банк «Оракул»', logo: 'ОРАКУЛ', need: 5e5, nodes: 6, bonus: { clickPct: 0.02 }, bonusText: 'клик +2% потока в секунду' },
    { id: 'titan', name: 'Титан Оборона', logo: 'ТИТАН', need: 5e6, nodes: 7, bonus: { all: 0.25 }, bonusText: 'весь поток +25%' },
    { id: 'kaze', name: 'Кадзэ Роботикс', logo: 'КАДЗЭ', need: 5e7, nodes: 7, bonus: { droneDur: 1.5 }, bonusText: 'эффекты дронов дольше в 1,5 раза' },
    { id: 'helios', name: 'Гелиос', logo: 'ГЕЛИОС', need: 5e8, nodes: 8, bonus: { all: 0.5 }, bonusText: 'весь поток +50%' },
  ];
  for (const c of CORPS) localize(c, ['name', 'logo', 'bonusText']);
  const CORP = Object.fromEntries(CORPS.map((c) => [c.id, c]));

  // Trace: percent, 0..100.
  const TRACE = { click: 4, node: 15, cool: 6, hot: 70, hotMult: 2, lockSecs: 12, wipe: 0.1 };
  const REFLASH_AT = 1e10;
  const CRED_BONUS = 0.1;

  function newState(cred = 0, reflashes = 0) {
    return {
      v: 1, data: 0, owned: {}, up: {}, corp: {}, cracked: {},
      cred, reflashes, stats: { data: 0, clicks: 0, drones: 0, locks: 0, hotClicks: 0 }, time: 0,
      trace: 0, lock: 0, lost: 0, overdrive: 0, droneIn: 60, seen: {},
    };
  }

  const has = (s, id) => !!s.up[id];
  const count = (s, id) => s.owned[id] || 0;

  function bonuses(s) {
    const b = { click: 1, all: 0, clickPct: 0, droneFreq: 1, droneDur: 1 };
    for (const c of CORPS) {
      if (!s.corp[c.id]) continue;
      for (const [k, v] of Object.entries(c.bonus)) {
        if (k === 'all' || k === 'clickPct') b[k] += v; else b[k] *= v;
      }
    }
    return b;
  }

  const hotFrom = (s) => (has(s, 'proxy-3') ? 55 : TRACE.hot);
  const hot = (s) => s.lock <= 0 && s.trace >= hotFrom(s);

  function derived(s) {
    const b = bonuses(s);
    const fame = 1 + CRED_BONUS * s.cred;
    const od = s.overdrive > 0 ? 7 : 1;
    const global = (1 + b.all) * fame * od;
    const per = {};
    let total = 0;
    for (const rig of RIGS) {
      let mult = 1;
      TIERS.forEach((_, k) => { if (has(s, `${rig.id}-${k}`)) mult *= 2; });
      per[rig.id] = rig.rate * mult * global;
      total += per[rig.id] * count(s, rig.id);
    }
    let clickMult = b.click * fame;
    let clickPct = b.clickPct;
    for (const u of UPGRADES) {
      if (!has(s, u.id)) continue;
      if (u.kind === 'clickMult') clickMult *= 2;
      if (u.kind === 'clickPct') clickPct += 0.01;
    }
    const base = clickMult * od + clickPct * total;
    return {
      per, rate: total, click: base, hotClick: base * (has(s, 'proxy-2') ? 3 : TRACE.hotMult), hotFrom: hotFrom(s),
      clickTrace: TRACE.click, nodeTrace: TRACE.node, cool: TRACE.cool,
      lockSecs: TRACE.lockSecs * (has(s, 'proxy-1') ? 0.5 : 1),
      droneFreq: b.droneFreq * (has(s, 'drone-1') ? 2 : 1),
      droneDur: b.droneDur * (has(s, 'drone-2') ? 2 : 1),
    };
  }

  const cost = (id, owned, n = 1) => {
    const base = RIG[id].base;
    // Geometric series: sum of base * g^k for k in [owned, owned + n).
    return Math.ceil(base * COST_GROWTH ** owned * (COST_GROWTH ** n - 1) / (COST_GROWTH - 1));
  };

  function maxAffordable(s, id) {
    let n = 0;
    while (cost(id, count(s, id), n + 1) <= s.data) n++;
    return n;
  }

  function addData(s, n) { s.data += n; s.stats.data += n; }

  // Raises the trace; at 100% the ICE locks the player out and wipes part of the unspent data.
  // Returns true if this caused a lockout.
  function heat(s, amount, d) {
    s.trace = Math.min(100, s.trace + amount);
    if (s.trace < 100) return false;
    s.lock = d.lockSecs;
    s.lost = s.data * TRACE.wipe * (has(s, 'proxy-1') ? 0.5 : 1);
    s.data -= s.lost;
    s.stats.locks++;
    return true;
  }

  // A manual hack. Returns { amount, hot, locked } or null while locked out.
  function click(s) {
    if (s.lock > 0) return null;
    const d = derived(s);
    const isHot = hot(s);
    const n = isHot ? d.hotClick : d.click;
    addData(s, n);
    s.stats.clicks++;
    if (isHot) s.stats.hotClicks++;
    const locked = heat(s, d.clickTrace, d);
    return { amount: n, hot: isHot, locked };
  }

  function buy(s, id, n = 1) {
    if (!RIG[id] || n < 1) return false;
    const c = cost(id, count(s, id), n);
    if (s.data < c) return false;
    s.data -= c;
    s.owned[id] = count(s, id) + n;
    return true;
  }

  const upgradeAvailable = (s, u) => !has(s, u.id) && u.unlock(s);

  function buyUpgrade(s, id) {
    const u = UPGRADE[id];
    if (!u || !upgradeAvailable(s, u) || s.data < u.cost) return false;
    s.data -= u.cost;
    s.up[id] = true;
    return true;
  }

  // A tower shows up once enough data was stolen in total; the player then cracks its ICE nodes.
  const revealed = (s, c) => s.stats.data >= c.need || !!s.corp[c.id];

  // Cracks one node of a tower. Returns 'node', 'breach' (tower done), 'locked' (trace overflowed) or null.
  function crack(s, corpId, idx) {
    const c = CORP[corpId];
    if (!c || s.lock > 0 || s.corp[c.id] || !revealed(s, c) || idx < 0 || idx >= c.nodes) return null;
    const got = s.cracked[c.id] || [];
    if (got.includes(idx)) return null;
    // Overflowing the trace on a node fails the crack: the node stays and the ICE locks you out.
    const d = derived(s);
    if (heat(s, d.nodeTrace, d)) return 'locked';
    s.cracked[c.id] = [...got, idx];
    if (s.cracked[c.id].length === c.nodes) { s.corp[c.id] = true; return 'breach'; }
    return 'node';
  }

  // Courier drones: the UI shows one when droneIn hits zero; catching it calls catchDrone.
  function catchDrone(s, roll) {
    const d = derived(s);
    s.stats.drones++;
    if (roll < 0.5) {
      const n = Math.min(s.data * 0.15 + 13, d.rate * 900 + 13);
      addData(s, n);
      return { kind: 'cache', amount: n };
    }
    s.overdrive = 60 * d.droneDur;
    return { kind: 'overdrive', seconds: s.overdrive };
  }

  function nextDroneDelay(s, roll) { return (90 + roll * 90) / derived(s).droneFreq; }

  function tick(s, dt) {
    const d = derived(s);
    addData(s, d.rate * dt);
    if (s.lock > 0) {
      s.lock = Math.max(0, s.lock - dt);
      // The lockout ends with a clean trace.
      s.trace = s.lock > 0 ? 100 * (s.lock / d.lockSecs) : 0;
    } else {
      s.trace = Math.max(0, s.trace - d.cool * dt);
    }
    if (s.overdrive > 0) s.overdrive = Math.max(0, s.overdrive - dt);
    s.droneIn -= dt;
    s.time += dt;
  }

  const credGain = (s) => Math.floor(Math.cbrt(s.stats.data / REFLASH_AT));

  function reflash(s) {
    const g = credGain(s);
    if (g < 1) return s;
    return newState(s.cred + g, s.reflashes + 1);
  }

  function offline(s, seconds) {
    const before = s.stats.data;
    const left = Math.min(seconds, 8 * 3600);
    s.overdrive = 0; s.lock = 0; s.trace = 0;
    // Production is constant while nothing is bought, so one step is exact.
    addData(s, derived(s).rate * left);
    s.time += left;
    s.droneIn = Math.min(s.droneIn, 20);
    return s.stats.data - before;
  }

  function migrate(raw) {
    const s = newState();
    if (!raw || typeof raw !== 'object') return s;
    Object.assign(s, raw);
    for (const k of ['owned', 'up', 'corp', 'cracked', 'seen']) s[k] = Object.assign({}, raw[k]);
    s.stats = Object.assign(newState().stats, raw.stats);
    for (const k of ['data', 'cred', 'reflashes', 'time', 'trace', 'lock', 'lost', 'overdrive', 'droneIn']) {
      if (!Number.isFinite(s[k])) s[k] = newState()[k];
    }
    return s;
  }

  const api = {
    RIGS, UPGRADES, CORPS, TRACE, REFLASH_AT, CRED_BONUS, newState, derived, cost, maxAffordable, count, hot,
    click, buy, buyUpgrade, upgradeAvailable, revealed, crack, catchDrone, nextDroneDelay, tick, credGain,
    reflash, offline, migrate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NeonCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
