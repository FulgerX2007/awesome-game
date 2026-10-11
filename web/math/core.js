'use strict';
// Искорка — rules: levels, problem generators, hints, scoring, rewards. No DOM here, so Node can test it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MathCore = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  // Text goes through the shared I18n (web/i18n.js); level, stage and item names stay Russian keys
  // in data and are translated where they are shown.
  const I18n = typeof module === 'object' && module.exports ? require('../i18n.js') : self.I18n;
  const T = (s, v) => I18n.t(s, v);
  const P = (n, forms) => I18n.p(n, forms);
  const TENS = 'десяток|десятка|десятков';
  // "4 раза по 3": a plural phrase with placeholders, so each language can order it its own way.
  const timesBy = (a, b) => P(a, '{a} раз по {b}|{a} раза по {b}|{a} раз по {b}').replace('{a}', a).replace('{b}', b);

  // ───────────── Randomness ─────────────
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  function shuffle(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ───────────── Problems ─────────────
  // form: 'sum' (a + b = ?), 'missA' (? + b = c), 'missB' (a + ? = c), 'repeat' (b + b + … a times), 'mul' (a × b = ?)
  function mk(op, a, b, form, lv) {
    let answer;
    if (form === 'missA') answer = a;
    else if (form === 'missB') answer = b;
    else answer = op === '+' ? a + b : a * b;
    return { op, a, b, form, lv, answer, key: `${a}${op}${b}${form}` };
  }
  const add = (a, b, lv) => mk('+', a, b, 'sum', lv);
  const mul = (a, b, lv) => mk('×', a, b, 'mul', lv);
  // Both orders of a multiplication are the same fact for statistics and review.
  const factKey = (p) => (p.op === '×' || p.form === 'repeat' ? `${Math.min(p.a, p.b)}×${Math.max(p.a, p.b)}` : p.key);

  function table(t) {
    return (rng, lv) => {
      const out = shuffle(rng, [2, 3, 4, 5, 6, 7, 8, 9, 10]).map((k) => (rng() < 0.5 ? mul(t, k, lv) : mul(k, t, lv)));
      // The tenth problem repeats a harder fact the other way round: 7 × 3 after 3 × 7.
      const k = pick(rng, [6, 7, 8, 9].filter((x) => x !== t));
      const seen = out.find((p) => p.a * p.b === t * k);
      out.push(seen.a === t ? mul(k, t, lv) : mul(t, k, lv));
      return out;
    };
  }
  // A generator either returns one problem (called repeatedly, deduplicated) or a whole list.
  const GEN = {
    add10: (rng, lv) => { const a = ri(rng, 1, 8); return add(a, ri(rng, 1, 10 - a), lv); },
    pairs10: (rng, lv) => {
      const a = ri(rng, 1, 9);
      return rng() < 0.5 ? mk('+', a, 10 - a, 'missB', lv) : mk('+', 10 - a, a, 'missA', lv);
    },
    teen: (rng, lv) => {
      const o = ri(rng, 1, 7), b = ri(rng, 1, 9 - o);
      return rng() < 0.7 ? add(10 + o, b, lv) : add(b, 10 + o, lv);
    },
    cross10: (rng, lv) => { const a = ri(rng, 2, 9); return add(a, ri(rng, 11 - a, 9), lv); },
    round: (rng, lv) => {
      if (rng() < 0.5) { const x = ri(rng, 1, 8); return add(x * 10, ri(rng, 1, 9 - x) * 10, lv); }
      return add(ri(rng, 1, 9) * 10, ri(rng, 1, 9), lv);
    },
    twoOne: (rng, lv) => {
      const x = ri(rng, 1, 8), y = ri(rng, 1, 9);
      const b = rng() < 0.5 ? ri(rng, 1, Math.max(1, 9 - y)) : ri(rng, Math.min(9, 10 - y), 9);
      return add(x * 10 + y, b, lv);
    },
    twoTwo: (rng, lv) => {
      const x = ri(rng, 1, 7), u = ri(rng, 1, 8 - x), y = ri(rng, 0, 8), v = ri(rng, 0, 9 - y);
      return add(x * 10 + y, u * 10 + v, lv);
    },
    twoTwoCarry: (rng, lv) => {
      const x = ri(rng, 1, 7), u = ri(rng, 1, 8 - x), y = ri(rng, 1, 9), v = ri(rng, 10 - y, 9);
      return add(x * 10 + y, u * 10 + v, lv);
    },
    // Multiplication starts as repeated addition: "3 + 3 + 3 + 3", then the same fact as "4 × 3".
    intro: (rng, lv) => {
      const out = [], seen = new Set();
      while (out.length < 10) {
        const n = ri(rng, 2, 4), k = ri(rng, 2, 5);
        if (seen.has(`${n}x${k}`)) continue;
        seen.add(`${n}x${k}`);
        out.push(mk('+', n, k, 'repeat', lv), mul(n, k, lv));
      }
      return out;
    },
    t2: table(2), t3: table(3), t4: table(4), t5: table(5), t6: table(6), t7: table(7), t8: table(8), t9: table(9),
    t10and1: (rng, lv) => {
      const tens = shuffle(rng, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).slice(0, 6).map((k) => (rng() < 0.5 ? mul(10, k, lv) : mul(k, 10, lv)));
      const ones = shuffle(rng, [2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4).map((k) => (rng() < 0.5 ? mul(1, k, lv) : mul(k, 1, lv)));
      return shuffle(rng, tens.concat(ones));
    },
  };

  // ───────────── World ─────────────
  const REGIONS = [
    {
      id: 'forest', name: 'Лес Сложения', unlockText: '',
      levels: [
        { id: 'a1', icon: '🍄', name: 'Грибная полянка', skill: 'Сложение до 10', gen: 'add10' },
        { id: 'a2', icon: '🌼', name: 'Цветочный луг', skill: 'Дружные пары до 10', gen: 'pairs10' },
        { id: 'a3', icon: '🐿️', name: 'Беличье дупло', skill: 'До 20 без перехода', gen: 'teen' },
        { id: 'a4', icon: '🌉', name: 'Старый мостик', skill: 'Через десяток', gen: 'cross10' },
        { id: 'a5', icon: '🦉', name: 'Совиное дерево', skill: 'Круглые числа', gen: 'round' },
        { id: 'a6', icon: '🍯', name: 'Медовая пасека', skill: 'Двузначное + однозначное', gen: 'twoOne' },
        { id: 'a7', icon: '🐸', name: 'Лягушачий пруд', skill: 'Двузначные без перехода', gen: 'twoTwo' },
        { id: 'a8', icon: '🦊', name: 'Лисья нора', skill: 'Двузначные с переходом', gen: 'twoTwoCarry' },
        { id: 'a9', icon: '🧌', name: 'Тролль под мостом', skill: 'Всё сложение', boss: 'troll', mix: ['add10', 'pairs10', 'teen', 'cross10', 'round', 'twoOne', 'twoTwo', 'twoTwoCarry'] },
      ],
    },
    {
      id: 'mountains', name: 'Горы Умножения', unlockText: 'Подружись с Троллем, и тропа в горы откроется',
      levels: [
        { id: 'm1', icon: '🪨', name: 'Подножие', skill: 'Умножение — это сложение', gen: 'intro' },
        { id: 'm2', icon: '🐐', name: 'Козья тропа', skill: 'Таблица на 2', gen: 't2' },
        { id: 'm3', icon: '⛺', name: 'Лагерь', skill: 'На 10 и на 1', gen: 't10and1' },
        { id: 'm4', icon: '🖐️', name: 'Пять вершин', skill: 'Таблица на 5', gen: 't5' },
        { id: 'm5', icon: '🦅', name: 'Орлиное гнездо', skill: 'Таблица на 3', gen: 't3' },
        { id: 'm6', icon: '❄️', name: 'Снежный склон', skill: 'Таблица на 4', gen: 't4' },
        { id: 'm7', icon: '🐻', name: 'Медвежья пещера', skill: 'Таблица на 6', gen: 't6' },
        { id: 'm8', icon: '🌈', name: 'Радужный водопад', skill: 'Таблица на 7', gen: 't7' },
        { id: 'm9', icon: '💎', name: 'Кристальная шахта', skill: 'Таблица на 8', gen: 't8' },
        { id: 'm10', icon: '🌋', name: 'Спящий вулкан', skill: 'Таблица на 9', gen: 't9' },
        { id: 'm11', icon: '🗻', name: 'Ледяной великан', skill: 'Вся таблица', boss: 'giant', mix: ['t2', 't3', 't4', 't5', 't6', 't6', 't7', 't7', 't8', 't8', 't9', 't9'] },
      ],
    },
  ];
  const LEVELS = [];
  for (const r of REGIONS) r.levels.forEach((l, i) => LEVELS.push(Object.assign(l, { region: r.id, index: i })));
  const LEVEL = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
  const BOSSES = {
    troll: { name: 'Тролль', friend: 'Тролль подружился с тобой и пропускает через мост!' },
    giant: { name: 'Ледяной великан', friend: 'Великан растаял от улыбки и стал твоим другом!' },
  };
  const ROUND = 10, BOSS_ROUND = 12;

  // ───────────── State ─────────────
  function newState() {
    return {
      v: 1, name: 'Искорка', crystals: 0,
      stars: {}, plays: {}, stickers: {},
      owned: [], equip: { head: null, face: null, neck: null }, color: 'green',
      review: {}, hard: {},
      totals: { solved: 0, firstTry: 0, bestStreak: 0, rounds: 0 },
      unlockAll: false, sound: true,
    };
  }
  function migrate(s) {
    const base = newState();
    if (!s || typeof s !== 'object') return base;
    const out = Object.assign(base, s);
    out.totals = Object.assign(newState().totals, s.totals || {});
    out.equip = Object.assign(newState().equip, s.equip || {});
    for (const k of ['stars', 'plays', 'stickers', 'review', 'hard']) if (!out[k] || typeof out[k] !== 'object') out[k] = {};
    if (!Array.isArray(out.owned)) out.owned = [];
    return out;
  }
  const totalStars = (S) => Object.values(S.stars).reduce((a, b) => a + b, 0);
  const maxStars = () => LEVELS.length * 3;
  function isUnlocked(S, id) {
    if (S.unlockAll) return true;
    const l = LEVEL[id];
    if (l.index > 0) return !!S.stars[REGIONS.find((r) => r.id === l.region).levels[l.index - 1].id];
    if (l.region === 'forest') return true;
    return !!S.stars.a9;
  }
  const regionUnlocked = (S, rid) => isUnlocked(S, REGIONS.find((r) => r.id === rid).levels[0].id);
  // The level the child should play next: the first unlocked level without stars.
  function currentLevel(S) {
    const l = LEVELS.find((x) => isUnlocked(S, x.id) && !S.stars[x.id]);
    return l ? l.id : null;
  }

  // ───────────── Rounds ─────────────
  function generate(rng, gens, lv, count, avoid) {
    const out = [], seen = new Set(avoid);
    let guard = 0;
    while (out.length < count && guard++ < 500) {
      const g = GEN[pick(rng, gens)];
      const got = g(rng, lv);
      const list = Array.isArray(got) ? got : [got];
      for (const p of list) {
        if (out.length >= count) break;
        if (seen.has(p.key) && guard < 400) continue;
        seen.add(p.key);
        out.push(p);
      }
    }
    return out;
  }
  // Mistakes from earlier rounds come back: up to 2 in a normal level, 4 at a boss.
  function reviewFor(S, rng, ids, n) {
    const pool = Object.values(S.review).filter((r) => ids.includes(r.lv));
    return shuffle(rng, pool).slice(0, n).map((r) => mk(r.op, r.a, r.b, r.form, r.lv));
  }
  function makeRound(S, id, rng = Math.random) {
    const l = LEVEL[id];
    if (l.boss) {
      const ids = REGIONS.find((r) => r.id === l.region).levels.map((x) => x.id);
      const rev = reviewFor(S, rng, ids, 4);
      const rest = [];
      const seen = new Set(rev.map((p) => p.key));
      const mix = shuffle(rng, l.mix);
      for (let i = 0; rev.length + rest.length < BOSS_ROUND && i < 60; i++) {
        const g = mix[i % mix.length];
        const src = LEVELS.find((x) => x.gen === g);
        const [p] = generate(rng, [g], src ? src.id : id, 1, seen);
        if (p) { seen.add(p.key); rest.push(p); }
      }
      return shuffle(rng, rev.concat(rest)).slice(0, BOSS_ROUND);
    }
    const got = GEN[l.gen](rng, id);
    if (Array.isArray(got)) {
      // List generators (tables, intro) keep their own order; review items replace the tail.
      const rev = reviewFor(S, rng, [id], 2).filter((r) => !got.some((p) => p.key === r.key));
      return got.slice(0, ROUND - rev.length).concat(rev);
    }
    const rev = reviewFor(S, rng, [id], 2);
    return shuffle(rng, rev.concat(generate(rng, [l.gen], id, ROUND - rev.length, rev.map((p) => p.key))));
  }
  function makePractice(S, rng = Math.random) {
    const pool = shuffle(rng, Object.values(S.review)).slice(0, ROUND).map((r) => mk(r.op, r.a, r.b, r.form, r.lv));
    const done = LEVELS.filter((l) => S.stars[l.id] && l.gen);
    if (pool.length < ROUND && done.length) {
      pool.push(...generate(rng, done.map((l) => l.gen), 'practice', ROUND - pool.length, pool.map((p) => p.key)));
    }
    return shuffle(rng, pool);
  }

  // A run is one trip through a level. Missed problems come back once at the end of a normal round.
  function newRun(id, problems) {
    const l = LEVEL[id];
    return {
      id, boss: l ? l.boss || null : null,
      queue: problems.slice(), original: problems.length, i: 0, tries: 0,
      missed: [], streak: 0, bestStreak: 0, crystals: 0, hp: l && l.boss ? problems.length : 0, done: false,
    };
  }
  const current = (run) => run.queue[run.i];
  function answer(S, run, value) {
    const p = current(run);
    if (!p || run.done) return null;
    if (value !== p.answer) {
      run.tries++;
      run.streak = 0;
      if (run.tries === 1) {
        if (!run.missed.includes(p.key)) {
          run.missed.push(p.key);
          if (!run.boss && !p.again && run.id !== 'practice') run.queue.push(Object.assign({}, p, { again: true }));
        }
        S.hard[factKey(p)] = (S.hard[factKey(p)] || 0) + 1;
        S.review[p.key] = { lv: p.lv, op: p.op, a: p.a, b: p.b, form: p.form, n: 2 };
      }
      return { ok: false, tries: run.tries, reveal: run.tries >= 2 };
    }
    const first = run.tries === 0;
    let gain = first ? 2 : 1, combo = false;
    S.totals.solved++;
    if (first) {
      S.totals.firstTry++;
      run.streak++;
      run.bestStreak = Math.max(run.bestStreak, run.streak);
      S.totals.bestStreak = Math.max(S.totals.bestStreak, run.streak);
      if (run.streak % 5 === 0) { gain += 3; combo = true; }
      const r = S.review[p.key];
      if (r && --r.n <= 0) delete S.review[p.key];
    }
    run.crystals += gain;
    if (run.boss) run.hp = Math.max(0, run.hp - 1);
    run.tries = 0;
    run.i++;
    if (run.i >= run.queue.length) run.done = true;
    return { ok: true, first, gain, combo, done: run.done };
  }
  const starsFor = (missed) => (missed <= 1 ? 3 : missed <= 3 ? 2 : 1);

  // ───────────── Rewards ─────────────
  const STICKERS = [
    ...['🐱', '🐶', '🐰', '🐻', '🐼', '🐨', '🐸', '🐧', '🐥', '🦔', '🐢', '🐞'].map((e) => ({ e, rarity: 'common' })),
    ...['🦊', '🦉', '🐙', '🦋', '🐬', '🦜', '🦩', '🐳'].map((e) => ({ e, rarity: 'rare' })),
    ...['🦄', '🐉', '🦖', '🦚'].map((e) => ({ e, rarity: 'legend' })),
  ];
  const RARITY = { common: 'Обычная', rare: 'Редкая', legend: 'Легендарная' };
  function drawSticker(S, rng, weights) {
    let x = rng() * (weights.common + weights.rare + weights.legend), tier = 'legend';
    if ((x -= weights.common) < 0) tier = 'common';
    else if ((x -= weights.rare) < 0) tier = 'rare';
    // Prefer a sticker the child does not have yet: first in the drawn tier, then in any tier.
    const fresh = (t) => STICKERS.filter((s) => (!t || s.rarity === t) && !S.stickers[s.e]);
    let pool = fresh(tier);
    if (!pool.length) pool = fresh(null);
    if (!pool.length) return { kind: 'crystals', n: 10 };
    const s = pick(rng, pool);
    S.stickers[s.e] = 1;
    return { kind: 'sticker', e: s.e, rarity: s.rarity, isNew: true };
  }

  const STAGES = [
    { at: 0, name: 'Яйцо' },
    { at: 1, name: 'Малыш' },
    { at: 10, name: 'Дракончик' },
    { at: 25, name: 'Юный дракон' },
    { at: 45, name: 'Великий дракон' },
  ];
  function stage(S) {
    const t = totalStars(S);
    let i = 0;
    while (i + 1 < STAGES.length && t >= STAGES[i + 1].at) i++;
    return i;
  }

  function finish(S, run, rng = Math.random) {
    const stageBefore = stage(S);
    const firstMissed = run.missed.length;
    const res = { crystals: run.crystals, stars: 0, newBest: false, firstClear: false, chest: null, stageBefore, stageAfter: stageBefore };
    S.totals.rounds++;
    if (run.id !== 'practice') {
      const l = LEVEL[run.id];
      res.stars = starsFor(firstMissed);
      res.firstClear = !S.stars[run.id];
      if (res.stars > (S.stars[run.id] || 0)) { S.stars[run.id] = res.stars; res.newBest = true; }
      S.plays[run.id] = (S.plays[run.id] || 0) + 1;
      if (l.boss && res.firstClear) {
        res.chest = drawSticker(S, rng, { common: 0, rare: 0, legend: 1 });
        res.friend = BOSSES[l.boss].friend;
      } else {
        res.chest = drawSticker(S, rng, res.stars === 3 ? { common: 50, rare: 38, legend: 12 } : { common: 70, rare: 25, legend: 5 });
      }
    } else {
      res.chest = drawSticker(S, rng, { common: 60, rare: 32, legend: 8 });
    }
    if (res.chest.kind === 'crystals') res.crystals += res.chest.n;
    S.crystals += res.crystals;
    res.stageAfter = stage(S);
    return res;
  }

  // ───────────── Shop ─────────────
  const COLORS = {
    green: { name: 'Зелёный', price: 0, main: '#5cc96b', dark: '#3a9c4b', belly: '#d9f5c4' },
    blue: { name: 'Небесный', price: 30, main: '#55a8f0', dark: '#3577c4', belly: '#d6ecff' },
    purple: { name: 'Сиреневый', price: 50, main: '#a77ef0', dark: '#7b52c9', belly: '#ece0ff' },
    fire: { name: 'Огненный', price: 80, main: '#ff7a45', dark: '#d1502a', belly: '#ffe2b8' },
    gold: { name: 'Золотой', price: 150, main: '#f3c33f', dark: '#c9921c', belly: '#fff3c4' },
  };
  const ITEMS = {
    bow: { name: 'Бантик', slot: 'head', price: 20 },
    glasses: { name: 'Очки', slot: 'face', price: 40 },
    scarf: { name: 'Шарфик', slot: 'neck', price: 60 },
    hat: { name: 'Шляпа волшебника', slot: 'head', price: 90 },
    crown: { name: 'Корона', slot: 'head', price: 150 },
  };
  function buy(S, id) {
    const c = COLORS[id], it = ITEMS[id];
    const price = c ? c.price : it ? it.price : null;
    if (price == null || S.owned.includes(id) || (c && price === 0)) return false;
    if (S.crystals < price) return false;
    S.crystals -= price;
    S.owned.push(id);
    if (c) S.color = id;
    else S.equip[it.slot] = id;
    return true;
  }
  // Tapping something owned puts it on (or takes it off, for clothes).
  function use(S, id) {
    if (COLORS[id]) { if (id === 'green' || S.owned.includes(id)) S.color = id; return; }
    const it = ITEMS[id];
    if (!it || !S.owned.includes(id)) return;
    S.equip[it.slot] = S.equip[it.slot] === id ? null : id;
  }

  // ───────────── Hints ─────────────
  // A hint explains the way to the answer without saying it; reveal() says it after the second miss.
  function hint(p) {
    const lines = [];
    if (p.form === 'missA' || p.form === 'missB') {
      const known = p.form === 'missA' ? p.b : p.a, total = p.a + p.b;
      lines.push(T('Сколько не хватает от {k} до {n}?', { k: known, n: total }), T('Посчитай пустые клеточки.'));
      return { lines, visual: { type: 'frame', filled: known, total } };
    }
    if (p.form === 'repeat') {
      const seq = [];
      for (let i = 1; i < p.a; i++) seq.push(p.b * i);
      lines.push(T('Считай по {b}: {seq}, …', { b: p.b, seq: seq.join(', ') }));
      return { lines, visual: { type: 'grid', rows: p.a, cols: p.b } };
    }
    if (p.op === '+') {
      const { a, b } = p, sum = a + b;
      if (sum <= 20) {
        if (a < 10 && b < 10 && sum > 10) {
          const big = Math.max(a, b), small = Math.min(a, b), need = 10 - big;
          lines.push(T('Сначала до десяти: {big} + {need} = 10.', { big, need }), T('От {small} осталось {rest}. Сколько будет 10 + {rest}?', { small, rest: small - need }));
        } else if (a >= 10 || b >= 10) {
          const t = a >= 10 ? a : b, o = a >= 10 ? b : a;
          lines.push(T('В {t} — один десяток и {o}.', { t, o: t - 10 }), T('Сложи единицы: {x} + {y} = {z}. И добавь десяток.', { x: t - 10, y: o, z: t - 10 + o }));
        } else {
          lines.push(T('Посчитай все точки: {a} и ещё {b}.', { a, b }));
        }
        return { lines, visual: { type: 'dots', parts: [a, b] } };
      }
      const ta = a - (a % 10), tb = b - (b % 10), oa = a % 10, ob = b % 10;
      if (!oa && !ob) {
        lines.push(T('{a} — это {x} {tensA}, {b} — это {y} {tensB}.', { a, b, x: a / 10, y: b / 10, tensA: P(a / 10, TENS), tensB: P(b / 10, TENS) }),
          T('Сложи десятки: {x} + {y} = {z}. Сколько это?', { x: a / 10, y: b / 10, z: a / 10 + b / 10 }));
        return { lines, visual: { type: 'blocks', parts: [a, b] } };
      }
      if (!ta || !tb) {
        const t = ta ? a : b, o = ta ? b : a;
        if (t % 10 === 0) {
          lines.push(T('В {t} — {n} {tens} и ни одной единицы.', { t, n: t / 10, tens: P(t / 10, TENS) }), T('Добавь {o}: десятки остаются, а единиц становится {o}.', { o }));
          return { lines, visual: { type: 'blocks', parts: [a, b] } };
        }
      }
      if (ta && tb) lines.push(T('Десятки: {x} + {y} = {z}.', { x: ta, y: tb, z: ta + tb }));
      if (oa && ob) lines.push(T('Единицы: {x} + {y} = {z}.', { x: oa, y: ob, z: oa + ob }));
      lines.push(T('Теперь сложи: {x} + {y} = ?', { x: ta + tb, y: oa + ob }));
      return { lines, visual: { type: 'blocks', parts: [a, b] } };
    }
    const { a, b } = p;
    const small = Math.min(a, b), big = Math.max(a, b);
    if (small === 1) lines.push(T('Умножить на 1 — число остаётся тем же.'));
    else if (big === 10) lines.push(T('Умножить на 10 — припиши к {n} ноль.', { n: small }));
    else {
      lines.push(T('{a} × {b} — это {times}.', { a, b, times: timesBy(a, b) }));
      const seq = [];
      for (let i = 1; i < a; i++) seq.push(b * i);
      lines.push(T('Считай по {b}: {seq}, …', { b, seq: seq.join(', ') }));
      if (small === 9 || big === 9) { const n = a === 9 ? b : a; lines.push(T('Хитрость: {n} × 10 = {m}, отними {n}.', { n, m: n * 10 })); }
      else if (a === 5 || b === 5) { const n = a === 5 ? b : a; lines.push(T('Хитрость: {n} × 10 = {m}, а ответ — половина от этого.', { n, m: n * 10 })); }
    }
    return { lines, visual: { type: 'grid', rows: a, cols: b } };
  }
  const reveal = (p) => T('Ответ: {n}. Набери его — и запомним!', { n: p.answer });

  // Parents see the facts that were missed most often.
  function hardest(S, n = 8) {
    return Object.entries(S.hard).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, c]) => ({ fact: k.replace(/(sum|missA|missB)$/, ''), count: c }));
  }

  return {
    mulberry32, REGIONS, LEVELS, LEVEL, BOSSES, STICKERS, RARITY, STAGES, COLORS, ITEMS, ROUND, BOSS_ROUND,
    newState, migrate, totalStars, maxStars, isUnlocked, regionUnlocked, currentLevel,
    makeRound, makePractice, newRun, current, answer, starsFor, finish, stage, buy, use, hint, reveal, hardest, factKey, timesBy,
  };
});
