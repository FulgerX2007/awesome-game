// Долгая зима — pure rules for the winter survival game, seen from above. No DOM, so the same file runs in the
// browser and in Node (tests and the balance bots). A lone hero in a frozen forest keeps three stats up (warmth,
// food, energy), chops, mines, hunts and fishes, feeds the fire, repairs the hut, builds the palisade, rescues five
// survivors who then work on their own, and has to live through 30 days. Wolves come at night. The world advances in
// fixed ticks of 1/20 s; tiles are 1 × 1, positions are tile coordinates (the centre of tile (x, y) is x + .5, y + .5).
(function (root) {
  'use strict';

  const TICK = 1 / 20;
  const MAX_DT = 0.25;
  const W = 56, H = 40;
  const DAY = 150, NIGHT_AT = 100;          // a day is 150 s: 100 s of light, 50 s of night
  const DAYS = 30;
  const SLEEP_SPEED = 6;                    // a night slept in a warm bed runs this much faster
  const SPEED = 3;                          // tiles per second
  const DEEP = 1.7;                         // deep snow costs (and slows) this much
  const CARRY = 40;                         // what the hero carries away from the base before he must go back
  const STORE_CAP = 200;                     // wood, stone and metal in the camp
  const FOOD_CAP = 150;                      // and the food, counted apart
  const FIRE = { burn: 12, cap: 20, radius: 3, warm: 1.2 };
  const STOVE = { burn: 15, cap: 30 };
  const TORCH = { cost: 2, radius: 3, max: 12 };
  const STAT_MAX = 100;
  const FOOD_DRAIN = 0.12, ENERGY_DRAIN = 0.04, WORK_ENERGY = 0.25, SLEEP_ENERGY = 0.6, FIRE_REST = 0.1;
  const HEALTH_LOSS = 1, HEALTH_GAIN = 0.3;
  const FOOD = { berries: 8, meat: 10, fish: 12, cookedMeat: 35, cookedFish: 25, smokedMeat: 45, smokedFish: 35 };
  // What is eaten first: the most filling food, raw meat last (it costs strength)
  const EAT_ORDER = ['smokedMeat', 'cookedMeat', 'smokedFish', 'cookedFish', 'fish', 'berries', 'meat'];
  const RAW_MEAT_ENERGY = 10;
  const COOK_TIME = 2;
  const HIT_CD = 0.7;                       // seconds between hits on a node
  const FISH_TIME = 6;
  const BITE = 8, GNAW = 2, WOLF_HP = 4, WOLF_SPEED = 3.2, WOLF_CD = 1.5, WOLF_FLEE = 0.3, WOLF_SAFE = 14;
  const DIFF = { normal: { cold: 1, wolves: 1, bite: 1 }, harsh: { cold: 1.4, wolves: 1.6, bite: 1.5 } };
  const SURVIVOR_FOOD = 0.08, SURVIVOR_EAT_AT = 50;

  // Base area (the palisade runs on its border) and the fixed spots inside.
  const BASE = { x0: 22, y0: 14, x1: 33, y1: 25 };
  const HUT = { x: 26, y: 16, w: 3, h: 2 };
  const SPOT = {
    fire: { x: 27, y: 20 }, bench: { x: 24, y: 20 }, bed: { x: 27, y: 17 }, bunks: [{ x: 31, y: 17 }, { x: 31, y: 19 }, { x: 31, y: 21 }],
    // the upgrades: decorative, they don't block walking (like the hut)
    cellar: { x: 23, y: 16 }, smokehouse: { x: 24, y: 23 }, annex: { x: 29, y: 16 }, workshop: { x: 31, y: 23 },
  };
  const SEGMENTS = ['north', 'east', 'south', 'west'];

  // Tools from the workbench: cost and what they give.
  const TOOLS = {
    axe: { cost: {} },                              // the stone axe the hero starts with
    ironAxe: { cost: { stone: 10, metal: 4 } },
    pick: { cost: { wood: 12 } },
    shovel: { cost: { wood: 12 } },
    icePick: { cost: { metal: 6 } },
    spear: { cost: { wood: 8, stone: 4 } },
  };

  // Buildings with partial contributions. The hut goes in four stages.
  const HUT_STAGES = [
    { id: 'walls', cost: { wood: 40 } },
    { id: 'roof', cost: { wood: 30, stone: 10 } },
    { id: 'door', cost: { wood: 20 } },
    { id: 'stove', cost: { stone: 30, metal: 6 } },
  ];
  const PALISADE_COST = { wood: 25 }, PALISADE_HP = 100, PALISADE_REPAIR = { wood: 15 };
  const BUNK_COST = { wood: 20 };

  // House upgrades, once the stove stands (hut stage 4). Paid in parts like the hut; the effects are read where the
  // rules live (warmthRate, burnTick, roomFor, smokeTick, survivorsTick, craft).
  const UPGRADES = {
    insulation: { name: 'утепление', cost: { wood: 30, hide: 4 } },
    cellar: { name: 'погреб', cost: { wood: 20, stone: 30 } },
    smokehouse: { name: 'коптильня', cost: { wood: 25, stone: 15 } },
    annex: { name: 'пристройка', cost: { wood: 40, stone: 20, metal: 4 } },
    workshop: { name: 'мастерская', cost: { wood: 30, stone: 10, metal: 6 } },
  };
  const UPGRADE_IDS = Object.keys(UPGRADES);
  const INSULATION = { stove: 0.6, chill: 0.15 };   // the stove burns this much as fast; the hut's chill factor
  const CELLAR_FOOD = 100;
  const SMOKE = { every: 15, perLog: 3 };           // one item every 15 s; a log smokes three
  const ANNEX = { heal: 2, work: 0.75 };

  // The five survivors: where they wait, what they need, what they do once at the base.
  const SURVIVORS = {
    hunter: { name: 'Охотник', x: 48, y: 34, need: 'meat' },
    carpenter: { name: 'Плотник', x: 5, y: 5, need: 'shovel' },
    herbalist: { name: 'Травница', x: 5, y: 34, need: 'day' },
    smith: { name: 'Кузнец', x: 53, y: 10, need: 'icePick' },
    child: { name: 'Ребёнок', x: 28, y: 3, need: 'palisade' },
  };
  const SURVIVOR_IDS = Object.keys(SURVIVORS);
  const HUNTER_MEAT = 3;     // pieces of meat, raw, roast or smoked, the hunter asks for
  const MEATS = ['meat', 'cookedMeat', 'smokedMeat'];
  const WORK = {
    hunter: { every: 40, give: { meat: 1 } },
    carpenter: { every: 6, give: { wood: 1 } },
    herbalist: { every: 12, give: { berries: 1 } },
    smith: { every: 30, give: { metal: 1 } },
    child: { every: 10, give: {} },
  };

  const RES = ['wood', 'stone', 'metal', 'hide'];
  const FOOD_ITEMS = Object.keys(FOOD);
  const ITEMS = RES.concat(FOOD_ITEMS);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const idx = (x, y) => y * W + x;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const inBase = (x, y) => x >= BASE.x0 && x <= BASE.x1 && y >= BASE.y0 && y <= BASE.y1;
  const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function next(holder) {
    holder.rng = (holder.rng + 0x6D2B79F5) >>> 0;
    let t = holder.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rand = (s) => next(s);
  // The second stream, for the content added after the first release (events, the trader, the bear, snares), so
  // the old content of a seed (animals, wolves) plays out the same as before.
  function erand(g) {
    const h = { rng: g.erng };
    const v = next(h);
    g.erng = h.rng;
    return v;
  }
  const erngOf = (seed) => (seed ^ 0x9e3779b9) >>> 0;

  // ── The map ──
  // '.' snow, ':' deep snow (slow), 'D' drift (impassable without the shovel), '~' lake ice (only with the ice pick),
  // 'o' an ice hole (fishing, never walkable). Trees, rocks, bushes and scrap are nodes on snow tiles.
  function genTiles(holder) {
    const t = new Array(W * H).fill('.');
    const set = (x, y, c) => { if (inMap(x, y)) t[idx(x, y)] = c; };
    // the lake on the east side, with a pocket for the smith past it
    for (let y = 2; y <= 20; y++) for (let x = 44; x <= 51; x++) set(x, y, '~');
    for (let x = 52; x < W; x++) { for (let y = 2; y <= 5; y++) set(x, y, '~'); for (let y = 15; y <= 20; y++) set(x, y, '~'); }
    for (const [x, y] of [[43, 8], [43, 12], [43, 16]]) set(x + 1, y, 'o');
    // drifts around the carpenter's camp in the north-west corner
    for (let y = 0; y <= 10; y++) for (let x = 0; x <= 10; x++) if (x === 10 || y === 10) set(x, y, 'D');
    // patches of deep snow
    const r = () => next(holder);
    for (let k = 0; k < 14; k++) {
      const cx = Math.floor(r() * W), cy = Math.floor(r() * H), rad = 1 + Math.floor(r() * 3);
      for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) {
        if (!inMap(x, y) || t[idx(x, y)] !== '.' || inBase(x, y) || Math.hypot(x - cx, y - cy) > rad) continue;
        if (x <= 10 && y <= 10) continue;
        set(x, y, ':');
      }
    }
    return t;
  }

  const SURVIVOR_SPOTS = Object.values(SURVIVORS).map((s) => [s.x, s.y]);

  function genNodes(g, holder) {
    const r = () => next(holder);
    const nodes = [];
    const taken = new Set();
    const free = (x, y) => inMap(x, y) && g.tiles[idx(x, y)] === '.' && !inBase(x, y) && !taken.has(idx(x, y))
      && !SURVIVOR_SPOTS.some(([sx, sy]) => Math.abs(sx - x) <= 1 && Math.abs(sy - y) <= 1)
      && !(x === BASE.x0 - 1 || x === BASE.x1 + 1 || y === BASE.y0 - 1 || y === BASE.y1 + 1);
    const add = (kind, x, y, amount) => {
      taken.add(idx(x, y));
      nodes.push({ id: nodes.length, kind, x, y, amount, max: amount, regrowAt: 0 });
    };
    const AMOUNT = { tree: 12, rock: 10, bush: 6, scrap: 6 };
    // guaranteed resources near the base: trees, rocks, bushes, and scrap worth ≥ 20 metal on this side of the lake
    const near = [['tree', 8], ['rock', 3], ['bush', 3], ['scrap', 4]];
    for (const [kind, n] of near) {
      for (let k = 0, guard = 0; k < n && guard < 500; guard++) {
        const ang = r() * Math.PI * 2, dist = 8 + r() * 7;
        const x = Math.round(27.5 + Math.cos(ang) * dist), y = Math.round(19.5 + Math.sin(ang) * dist);
        if (!free(x, y) || x >= 43) continue;
        add(kind, x, y, AMOUNT[kind]);
        k++;
      }
    }
    // the forest
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!free(x, y)) continue;
      const v = r();
      if (v < 0.13) add('tree', x, y, AMOUNT.tree);
      else if (v < 0.155) add('rock', x, y, AMOUNT.rock);
      else if (v < 0.175) add('bush', x, y, AMOUNT.bush);
      else if (v < 0.18) add('scrap', x, y, AMOUNT.scrap);
    }
    // the smith's pocket has scrap of its own
    add('scrap', 54, 8, 10);
    return nodes;
  }

  // ── Game ──
  function newGame(difficulty = 'normal', seed = 1) {
    if (!has(DIFF, difficulty)) throw new Error(`bad difficulty ${difficulty}`);
    const s = finite(seed) ? Math.floor(seed) >>> 0 : 1;
    const holder = { rng: s };
    const g = {
      v: 1, seed: s, rng: (s ^ 0x5bd1e995) >>> 0, erng: erngOf(s), difficulty, t: 0, acc: 0, status: 'playing',
      tiles: genTiles(holder), nodes: [],
      hero: {
        x: SPOT.fire.x + 0.5, y: SPOT.fire.y + 1.5, warmth: STAT_MAX, food: 80, energy: STAT_MAX, health: STAT_MAX,
        path: null, target: null, work: 0, cd: 0, load: 0, sleeping: false, dir: null,
      },
      stock: { wood: 10, stone: 0, metal: 0, hide: 0, berries: 4, meat: 0, fish: 0, cookedMeat: 2, cookedFish: 0, smokedMeat: 0, smokedFish: 0 },
      tools: { axe: true, ironAxe: false, pick: false, shovel: false, icePick: false, spear: false },
      fire: { fuel: 12 },
      hut: { stage: 0, paid: {}, stove: 0 },
      palisade: SEGMENTS.map(() => ({ built: false, hp: 0, paid: {} })),
      bunks: [{ built: false, paid: {} }, { built: false, paid: {} }, { built: false, paid: {} }],
      upgrades: newUpgrades(),
      torches: [],
      survivors: SURVIVOR_IDS.map((id) => ({ id, state: 'waiting', x: SURVIVORS[id].x + 0.5, y: SURVIVORS[id].y + 0.5, hp: STAT_MAX, food: 70, work: 0, path: null, cd: 0 })),
      animals: [], wolves: [], nextId: 1,
      events: [], deaths: [],
    };
    g.nodes = genNodes(g, holder);
    for (let k = 0; k < 6; k++) spawnAnimal(g, 'rabbit');
    for (let k = 0; k < 3; k++) spawnAnimal(g, 'deer');
    return g;
  }

  function newUpgrades() {
    const u = {};
    for (const id of UPGRADE_IDS) u[id] = { built: false, paid: {} };
    u.smokehouse.work = 0;
    u.smokehouse.fuel = 0;
    return u;
  }
  const upgradeOn = (g, id) => !!(g.upgrades && g.upgrades[id] && g.upgrades[id].built);

  const status = (g) => g.status;
  function drain(g) {
    const ev = g.events;
    g.events = [];
    return ev;
  }

  // ── Time and weather ──
  const dayOf = (g) => Math.floor(g.t / DAY) + 1;
  const timeOfDay = (g) => g.t % DAY;
  const isNight = (g) => timeOfDay(g) >= NIGHT_AT;
  const BLIZZARDS = { normal: [6, 12, 16, 19, 22, 25], harsh: [4, 6, 9, 12, 14, 16, 19, 21, 22, 25, 27] };
  const isBlizzard = (g, day = dayOf(g)) => BLIZZARDS[g.difficulty].includes(day);

  // The outside temperature on a day: mild at first, the deepest cold on days 15–24, a thaw from day 28.
  function baseTemp(day) {
    if (day <= 10) return -5 - day;                    // −6 … −15
    if (day <= 14) return -15 - (day - 10) * 2;        // … −23
    if (day <= 24) return -25;
    if (day <= 27) return -20;
    return -8;
  }

  function temperature(g) {
    let t = baseTemp(dayOf(g));
    if (isNight(g)) t -= 8;
    if (isBlizzard(g)) t -= 10;
    return t;
  }

  // Warmth lost per second outside any heat.
  const chill = (g) => (Math.max(0, -temperature(g)) / 15) * DIFF[g.difficulty].cold;

  // ── Tiles and walking ──
  function nodeAt(g, x, y) {
    for (const n of g.nodes) if (n.x === x && n.y === y && n.amount > 0) return n;
    return null;
  }
  let nodeIndex = null, nodeIndexOf = null; // a cache of standing nodes by tile, rebuilt when it goes stale
  function blockedByNode(g, x, y) {
    if (nodeIndexOf !== g || !nodeIndex || nodeIndex.stamp !== g.nodeStamp || nodeIndex.nodes !== g.nodes) {
      nodeIndex = new Uint8Array(W * H);
      nodeIndex.stamp = g.nodeStamp;
      nodeIndex.nodes = g.nodes;
      nodeIndexOf = g;
      for (const n of g.nodes) if (n.amount > 0) nodeIndex[idx(n.x, n.y)] = 1;
    }
    return nodeIndex[idx(x, y)] === 1;
  }
  const touchNodes = (g) => { g.nodeStamp = (g.nodeStamp || 0) + 1; };

  // Can the hero (or a survivor following him) stand on this tile with these tools?
  function walkable(g, x, y, tools = g.tools) {
    if (!inMap(x, y)) return false;
    const c = g.tiles[idx(x, y)];
    if (c === 'o') return false;
    if (c === '~' && !tools.icePick) return false;
    if (c === 'D' && !tools.shovel) return false;
    return !blockedByNode(g, x, y);
  }
  const tileCost = (g, x, y) => { const c = g.tiles[idx(x, y)]; return c === ':' ? DEEP : c === 'D' ? 3 : 1; };

  // A* over tiles with costs; goal(x, y) decides the end. → [{x, y}] (without the start) or null.
  function astar(g, from, goal, h, tools, pass, limit = W * H * 4) {
    const sx = Math.floor(from.x), sy = Math.floor(from.y);
    if (!inMap(sx, sy)) return null;
    const dist = new Float64Array(W * H).fill(Infinity);
    const prev = new Int32Array(W * H).fill(-1);
    const closed = new Uint8Array(W * H);
    const heap = [];
    let tie = 0;
    const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const push = (f, i) => {
      heap.push([f, tie++, i]);
      for (let k = heap.length - 1; k > 0;) {
        const p = (k - 1) >> 1;
        if (less(heap[p], heap[k])) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let k = 0; ;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const start = idx(sx, sy);
    dist[start] = 0;
    push(h(sx, sy), start);
    let guard = 0;
    while (heap.length && guard++ < limit) {
      const i = pop()[2];
      if (closed[i]) continue;
      closed[i] = 1;
      const x = i % W, y = (i - x) / W;
      if (goal(x, y)) {
        const path = [];
        for (let k = i; k !== start && k !== -1; k = prev[k]) path.push({ x: k % W, y: Math.floor(k / W) });
        return path.reverse();
      }
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (pass ? !pass(nx, ny) : !walkable(g, nx, ny, tools)) continue;
        const j = idx(nx, ny), c = dist[i] + tileCost(g, nx, ny);
        if (closed[j] || c >= dist[j]) continue;
        dist[j] = c;
        prev[j] = i;
        push(c + h(nx, ny), j);
      }
    }
    return null;
  }

  const manhattan = (tx, ty) => (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
  function pathTo(g, from, tx, ty, tools) {
    if (!walkable(g, tx, ty, tools)) return null;
    return astar(g, from, (x, y) => x === tx && y === ty, manhattan(tx, ty), tools);
  }
  // A path to any walkable tile next to (tx, ty) (or onto it when it's walkable itself and `onto`).
  function pathNextTo(g, from, tx, ty, tools) {
    const goal = (x, y) => Math.abs(x - tx) + Math.abs(y - ty) === 1 || (x === tx && y === ty && walkable(g, x, y, tools));
    return astar(g, from, goal, (x, y) => Math.max(0, Math.abs(x - tx) + Math.abs(y - ty) - 1), tools);
  }

  // Moves an entity along its path; deep snow slows it. A drift on the way is dug out (the shovel).
  function follow(g, e, speed, dt) {
    let left = speed * dt;
    while (e.path && e.path.length && left > 0) {
      const w = e.path[0];
      if (!walkable(g, w.x, w.y, e === g.hero ? g.tools : FOLLOW_TOOLS(g))) { e.path = null; break; }
      const cx = w.x + 0.5, cy = w.y + 0.5;
      const here = g.tiles[idx(Math.floor(e.x), Math.floor(e.y))];
      const slow = here === ':' || g.tiles[idx(w.x, w.y)] === ':' ? 1 / DEEP : 1;
      const d = Math.hypot(cx - e.x, cy - e.y);
      const step = left * slow;
      if (d <= step) {
        e.x = cx; e.y = cy;
        left -= d / slow;
        e.path.shift();
        if (g.tiles[idx(w.x, w.y)] === 'D') { g.tiles[idx(w.x, w.y)] = '.'; g.events.push({ type: 'dig', x: w.x, y: w.y }); }
      } else {
        e.x += ((cx - e.x) / d) * step;
        e.y += ((cy - e.y) / d) * step;
        left = 0;
      }
    }
    if (e.path && !e.path.length) e.path = null;
  }
  const FOLLOW_TOOLS = (g) => g.tools;

  // ── Stock ──
  const afford = (g, cost) => Object.keys(cost).every((k) => (g.stock[k] || 0) >= cost[k]);
  const pay = (g, cost) => { for (const k of Object.keys(cost)) g.stock[k] -= cost[k]; };
  const stockTotal = (g) => RES.reduce((a, k) => a + (g.stock[k] || 0), 0);
  const foodTotal = (g) => FOOD_ITEMS.reduce((a, k) => a + (g.stock[k] || 0), 0);
  const foodCap = (g) => FOOD_CAP + (upgradeOn(g, 'cellar') ? CELLAR_FOOD : 0);
  const roomFor = (g, item) => Math.max(0, FOOD_ITEMS.includes(item) ? foodCap(g) - foodTotal(g) : STORE_CAP - stockTotal(g));

  // Adds gathered items: the hero carries up to CARRY away from the base; the camp holds STORE_CAP of materials
  // and FOOD_CAP of food.
  function gain(g, item, n) {
    const room = roomFor(g, item);
    const carry = inBase(Math.floor(g.hero.x), Math.floor(g.hero.y)) ? Infinity : CARRY - g.hero.load;
    const k = Math.max(0, Math.min(n, room, carry));
    g.stock[item] += k;
    if (!inBase(Math.floor(g.hero.x), Math.floor(g.hero.y))) g.hero.load += k;
    return k;
  }
  const full = (g, item) => (item ? roomFor(g, item) <= 0 : false) || (!inBase(Math.floor(g.hero.x), Math.floor(g.hero.y)) && g.hero.load >= CARRY);
  const ITEM_OF = { tree: 'wood', rock: 'stone', bush: 'berries', scrap: 'metal' };

  // ── Heat ──
  const near = (e, p, r) => Math.hypot(e.x - (p.x + 0.5), e.y - (p.y + 0.5)) <= r;
  const inHut = (e) => e.x >= HUT.x && e.x < HUT.x + HUT.w && e.y >= HUT.y && e.y < HUT.y + HUT.h + 1;
  const stoveOn = (g) => g.hut.stage >= 4 && g.hut.stove > 0;
  const fireOn = (g) => g.fire.fuel > 0;

  // How warmth changes per second for someone at e.
  function warmthRate(g, e) {
    if (inHut(e) && stoveOn(g)) return 2;
    let loss = chill(g);
    if (inHut(e) && g.hut.stage >= 2) loss *= upgradeOn(g, 'insulation') ? INSULATION.chill : 0.4;
    if (fireOn(g) && near(e, SPOT.fire, FIRE.radius)) return FIRE.warm - loss;
    return -loss;
  }

  // Light keeps wolves away: a fed fire, a fed stove, torches.
  function lit(g, x, y) {
    const c = { x: x + 0.5, y: y + 0.5 };
    if (fireOn(g) && near(c, SPOT.fire, FIRE.radius)) return true;
    if (stoveOn(g) && near(c, { x: HUT.x + 1, y: HUT.y }, 3)) return true;
    return g.torches.some((t) => near(c, t, TORCH.radius));
  }

  function burnTick(g) {
    const blz = isBlizzard(g) ? 1.5 : 1;
    if (g.fire.fuel > 0) {
      g.fire.fuel = Math.max(0, g.fire.fuel - (TICK / FIRE.burn) * blz);
      if (g.fire.fuel === 0) g.events.push({ type: 'fireOut' });
    }
    if (g.hut.stage >= 4 && g.hut.stove > 0) g.hut.stove = Math.max(0, g.hut.stove - (TICK / STOVE.burn) * (upgradeOn(g, 'insulation') ? INSULATION.stove : 1));
  }

  // The smokehouse smokes raw meat (then fish) from the stock on its own, burning a log for every few pieces.
  function smokeTick(g, dt) {
    if (!upgradeOn(g, 'smokehouse')) return;
    const sh = g.upgrades.smokehouse;
    const raw = g.stock.meat > 0 ? 'meat' : g.stock.fish > 0 ? 'fish' : null;
    if (!raw) { sh.work = 0; return; }
    sh.work = Math.min(SMOKE.every, sh.work + dt);
    if (sh.work < SMOKE.every) return;
    if (sh.fuel <= 0) {
      if (g.stock.wood <= 0) return;
      g.stock.wood--;
      sh.fuel = SMOKE.perLog;
    }
    sh.work = 0;
    sh.fuel--;
    g.stock[raw]--;
    const out = raw === 'meat' ? 'smokedMeat' : 'smokedFish';
    g.stock[out]++;
    g.events.push({ type: 'smoked', item: out });
  }

  // ── The hero's stats ──
  function statsTick(g, dt) {
    const h = g.hero;
    h.warmth = clamp(h.warmth + warmthRate(g, h) * dt, 0, STAT_MAX);
    h.food = clamp(h.food - FOOD_DRAIN * dt, 0, STAT_MAX);
    let e = -ENERGY_DRAIN;
    if (h.sleeping) e = SLEEP_ENERGY;
    else if (fireOn(g) && near(h, SPOT.fire, FIRE.radius) && !h.path && !h.target) e = FIRE_REST;
    h.energy = clamp(h.energy + e * dt, 0, STAT_MAX);
    const zeros = (h.warmth <= 0) + (h.food <= 0) + (h.energy <= 0);
    if (zeros) h.health = clamp(h.health - HEALTH_LOSS * zeros * dt, 0, STAT_MAX);
    else if (h.warmth > 40 && h.food > 40 && h.energy > 40) h.health = clamp(h.health + HEALTH_GAIN * dt, 0, STAT_MAX);
  }

  // ── Actions ──
  // Orders: walk, a node (chop/mine/pick/scrap), an animal, a hole (fish), the fire (feed/cook), the bed (sleep),
  // a survivor (rescue), a wolf (fight). The hero walks next to the target, then works on it.
  function clearOrder(h) { h.path = null; h.target = null; h.work = 0; }

  function moveDir(g, dx, dy) {
    const h = g.hero;
    dx = Math.sign(dx) || 0; dy = Math.sign(dy) || 0;
    if (dx || dy) { clearOrder(h); h.sleeping = false; }
    h.dir = dx || dy ? { x: dx, y: dy } : null;
  }

  function moveFree(g, dt) {
    const h = g.hero;
    const slow = g.tiles[idx(Math.floor(h.x), Math.floor(h.y))] === ':' ? 1 / DEEP : 1;
    const len = Math.hypot(h.dir.x, h.dir.y), d = (SPEED * slow * dt) / len;
    const fits = (x, y) => [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].every(([ox, oy]) => walkable(g, Math.floor(x + ox), Math.floor(y + oy)));
    if (fits(h.x + h.dir.x * d, h.y)) h.x += h.dir.x * d;
    if (fits(h.x, h.y + h.dir.y * d)) h.y += h.dir.y * d;
    const tx = Math.floor(h.x), ty = Math.floor(h.y);
    if (g.tiles[idx(tx, ty)] === 'D' && g.tools.shovel) g.tiles[idx(tx, ty)] = '.';
  }

  function order(g, target, path) {
    const h = g.hero;
    h.dir = null;
    h.sleeping = false;
    h.target = target;
    h.path = path;
    h.work = 0;
  }

  // What a tap on tile (x, y) means. Returns the action taken: 'chop' | 'mine' | 'pick' | 'scrap' | 'hunt' | 'fish'
  // | 'fire' | 'bed' | 'rescue' | 'fight' | 'torch' | 'walk' | 'tool' (a missing tool) | 'none'.
  function interact(g, x, y, opts = {}) {
    if (g.status !== 'playing') return 'none';
    x = Math.floor(x); y = Math.floor(y);
    if (!inMap(x, y)) return 'none';
    const h = g.hero;
    const wolf = g.wolves.find((w) => Math.floor(w.x) === x && Math.floor(w.y) === y);
    if (wolf) {
      order(g, { type: 'wolf', id: wolf.id }, pathNextTo(g, h, x, y) || []);
      return 'fight';
    }
    const animal = g.animals.find((a) => Math.abs(a.x - (x + 0.5)) < 1 && Math.abs(a.y - (y + 0.5)) < 1);
    if (animal) {
      if (animal.kind === 'deer' && !g.tools.spear) return 'tool';
      order(g, { type: 'animal', id: animal.id }, pathNextTo(g, h, x, y) || []);
      return 'hunt';
    }
    const n = nodeAt(g, x, y);
    if (n) {
      const need = n.kind === 'rock' ? 'pick' : n.kind === 'tree' ? 'axe' : null;
      if (need && !g.tools[need]) return 'tool';
      const path = pathNextTo(g, h, x, y);
      if (!path) return 'none';
      order(g, { type: 'node', id: n.id }, path);
      return { tree: 'chop', rock: 'mine', bush: 'pick', scrap: 'scrap' }[n.kind];
    }
    if (g.tiles[idx(x, y)] === 'o') {
      const path = pathNextTo(g, h, x, y);
      if (!path) return 'none';
      order(g, { type: 'hole', x, y }, path);
      return 'fish';
    }
    const sv = g.survivors.find((s) => s.state === 'waiting' && Math.floor(s.x) === x && Math.floor(s.y) === y);
    if (sv) {
      const path = pathNextTo(g, h, x, y);
      if (!path) return 'none';
      order(g, { type: 'survivor', id: sv.id }, path);
      return 'rescue';
    }
    if (x === SPOT.fire.x && y === SPOT.fire.y) {
      order(g, { type: 'fire' }, pathNextTo(g, h, x, y) || []);
      return 'fire';
    }
    if (x === SPOT.bed.x && y === SPOT.bed.y && g.hut.stage >= 2) {
      order(g, { type: 'bed' }, pathTo(g, h, x, y) || []);
      return 'bed';
    }
    if (opts.torch) return placeTorch(g, x, y) ? 'torch' : 'none';
    const path = pathTo(g, h, x, y);
    if (!path) return 'none';
    order(g, { type: 'walk' }, path);
    return 'walk';
  }

  // The work at the target, once the hero stands next to it.
  function workTick(g, dt) {
    const h = g.hero, tg = h.target;
    if (!tg || h.path) return;
    h.cd = Math.max(0, h.cd - dt);
    switch (tg.type) {
      case 'walk': clearOrder(h); return;
      case 'node': {
        const n = g.nodes[tg.id];
        if (!n || n.amount <= 0 || full(g, ITEM_OF[n.kind])) { clearOrder(h); return; }
        if (h.cd > 0) return;
        h.cd = n.kind === 'bush' ? 1 : n.kind === 'scrap' ? 1.5 : HIT_CD;
        h.energy = Math.max(0, h.energy - WORK_ENERGY);
        const item = ITEM_OF[n.kind];
        const per = n.kind === 'tree' ? (g.tools.ironAxe ? 3 : 2) : n.kind === 'bush' ? 1 : 2;
        const got = gain(g, item, Math.min(per, n.amount));
        n.amount -= got;
        g.events.push({ type: 'gather', kind: n.kind, item, n: got, x: n.x, y: n.y });
        if (n.amount <= 0) {
          n.regrowAt = g.t + (n.kind === 'bush' ? 2 : n.kind === 'tree' ? 4 : Infinity) * DAY;
          touchNodes(g);
          clearOrder(h);
        }
        return;
      }
      case 'hole':
        if (full(g, 'fish')) { clearOrder(h); return; }
        h.work += dt;
        if (h.work >= FISH_TIME) {
          h.work = 0;
          h.energy = Math.max(0, h.energy - WORK_ENERGY);
          gain(g, 'fish', 1);
          g.events.push({ type: 'fish', x: tg.x, y: tg.y });
        }
        return;
      case 'fire': {
        // feed the fire while it's under half, else cook raw food
        if (h.cd > 0) return;
        if (g.fire.fuel < FIRE.cap / 2 && g.stock.wood > 0) {
          g.stock.wood--;
          g.fire.fuel = Math.min(FIRE.cap, g.fire.fuel + 1);
          h.cd = 0.4;
          g.events.push({ type: 'feed' });
          return;
        }
        if (g.hut.stage >= 4 && g.hut.stove < STOVE.cap / 2 && g.stock.wood > 0) {
          g.stock.wood--;
          g.hut.stove = Math.min(STOVE.cap, g.hut.stove + 1);
          h.cd = 0.4;
          g.events.push({ type: 'feed', stove: true });
          return;
        }
        if (fireOn(g) && (g.stock.meat > 0 || g.stock.fish > 0)) {
          h.work += dt;
          if (h.work >= COOK_TIME) {
            h.work = 0;
            if (g.stock.meat > 0) { g.stock.meat--; g.stock.cookedMeat++; } else { g.stock.fish--; g.stock.cookedFish++; }
            g.events.push({ type: 'cook' });
          }
          return;
        }
        clearOrder(h);
        return;
      }
      case 'bed':
        if (!isNight(g) && h.energy >= STAT_MAX - 1) { clearOrder(h); return; }
        if (!h.sleeping) { h.sleeping = true; g.events.push({ type: 'sleep' }); }
        return;
      case 'survivor': {
        const sv = g.survivors.find((s) => s.id === tg.id);
        clearOrder(h);
        if (sv) rescue(g, sv);
        return;
      }
      case 'animal': {
        const a = g.animals.find((x) => x.id === tg.id);
        if (!a) { clearOrder(h); return; }
        const reach = a.kind === 'deer' ? 3 : 1.2;
        const d = Math.hypot(a.x - h.x, a.y - h.y);
        if (d > reach) { h.path = pathNextTo(g, h, Math.floor(a.x), Math.floor(a.y)); if (!h.path) clearOrder(h); return; }
        if (h.cd > 0) return;
        h.cd = 0.8;
        a.hp -= g.tools.spear ? 2 : 1;
        h.energy = Math.max(0, h.energy - WORK_ENERGY);
        if (a.hp <= 0) {
          g.animals = g.animals.filter((x) => x !== a);
          gain(g, 'meat', a.kind === 'deer' ? 3 : 1);
          if (a.kind === 'deer') gain(g, 'hide', 1);
          g.events.push({ type: 'hunt', kind: a.kind, x: a.x, y: a.y });
          clearOrder(h);
        }
        return;
      }
      case 'wolf': {
        const w = g.wolves.find((x) => x.id === tg.id);
        if (!w) { clearOrder(h); return; }
        const d = Math.hypot(w.x - h.x, w.y - h.y);
        if (d > 1.3) { h.path = pathNextTo(g, h, Math.floor(w.x), Math.floor(w.y)); if (!h.path) clearOrder(h); return; }
        if (h.cd > 0) return;
        h.cd = 0.8;
        hitWolf(g, w, g.tools.spear ? 2 : 1);
        return;
      }
      default: clearOrder(h);
    }
  }

  function hitWolf(g, w, dmg) {
    w.hp -= dmg;
    g.events.push({ type: 'hitWolf', id: w.id, x: w.x, y: w.y });
    if (w.hp <= 0) {
      g.wolves = g.wolves.filter((x) => x !== w);
      g.events.push({ type: 'wolfDead', x: w.x, y: w.y });
      if (g.hero.target && g.hero.target.id === w.id) clearOrder(g.hero);
    }
  }

  function eat(g) {
    if (g.status !== 'playing') return null;
    const h = g.hero;
    // the most filling food that doesn't overfill too much
    const item = EAT_ORDER.find((k) => g.stock[k] > 0);
    if (!item || h.food >= STAT_MAX - 2) return null;
    g.stock[item]--;
    h.food = clamp(h.food + FOOD[item], 0, STAT_MAX);
    if (item === 'meat') h.energy = Math.max(0, h.energy - RAW_MEAT_ENERGY);
    g.events.push({ type: 'eat', item });
    return item;
  }

  function placeTorch(g, x, y) {
    if (g.torches.length >= TORCH.max || !afford(g, { wood: TORCH.cost }) || !inMap(x, y) || !walkable(g, x, y)) return false;
    if (g.torches.some((t) => t.x === x && t.y === y)) return false;
    pay(g, { wood: TORCH.cost });
    g.torches.push({ x, y });
    g.events.push({ type: 'torch', x, y });
    return true;
  }

  const atBase = (g) => inBase(Math.floor(g.hero.x), Math.floor(g.hero.y));

  // The workbench stands in the camp: tools are made there.
  function craft(g, tool) {
    if (!has(TOOLS, tool) || g.status !== 'playing') return 'bad';
    if (g.tools[tool]) return 'have';
    if (!atBase(g)) return 'far';
    if (!afford(g, TOOLS[tool].cost)) return 'nores';
    pay(g, TOOLS[tool].cost);
    g.tools[tool] = true;
    g.events.push({ type: 'craft', tool });
    return 'ok';
  }

  // ── Building (partial contributions) ──
  // id: 'hut' | 'palisade:0'…'palisade:3' | 'bunk:0'…'bunk:2'. Puts what the stock has toward the next stage.
  // → 'done' (a stage finished) | 'part' (paid in part) | 'nores' | 'built' (nothing left) | 'bad'
  function needOf(g, id) {
    if (typeof id !== 'string') return undefined;
    if (id.startsWith('up:')) {
      const u = id.slice(3);
      if (!has(UPGRADES, u)) return undefined;
      return g.upgrades[u].built ? null : { cost: UPGRADES[u].cost, paid: g.upgrades[u].paid };
    }
    if (id === 'hut') return g.hut.stage < HUT_STAGES.length ? { cost: HUT_STAGES[g.hut.stage].cost, paid: g.hut.paid } : null;
    const [kind, k] = id.split(':');
    const i = Number(k);
    if (kind === 'palisade' && g.palisade[i]) {
      const p = g.palisade[i];
      if (p.built && p.hp >= PALISADE_HP) return null;
      return { cost: p.built ? PALISADE_REPAIR : PALISADE_COST, paid: p.paid };
    }
    if (kind === 'bunk' && g.bunks[i]) return g.bunks[i].built ? null : { cost: BUNK_COST, paid: g.bunks[i].paid };
    return undefined;
  }

  function contribute(g, id) {
    if (g.status !== 'playing') return 'bad';
    const need = needOf(g, id);
    if (need === undefined) return 'bad';
    if (need === null) return 'built';
    if (id.startsWith('up:') && g.hut.stage < HUT_STAGES.length) return 'locked';
    if (!atBase(g)) return 'far';
    let put = 0, left = 0;
    for (const k of Object.keys(need.cost)) {
      const want = need.cost[k] - (need.paid[k] || 0);
      const n = Math.min(want, g.stock[k] || 0);
      if (n > 0) { g.stock[k] -= n; need.paid[k] = (need.paid[k] || 0) + n; put += n; }
      left += want - n;
    }
    if (left > 0) return put > 0 ? 'part' : 'nores';
    finishStage(g, id);
    return 'done';
  }

  function finishStage(g, id) {
    if (id.startsWith('up:')) {
      const u = id.slice(3);
      g.upgrades[u].built = true;
      g.upgrades[u].paid = {};
      g.events.push({ type: 'upgraded', id: u });
      return;
    }
    if (id === 'hut') {
      g.events.push({ type: 'built', id: 'hut', stage: HUT_STAGES[g.hut.stage].id });
      g.hut.stage++;
      g.hut.paid = {};
      if (g.hut.stage === 4) g.hut.stove = 6;
      return;
    }
    const [kind, k] = id.split(':');
    const i = Number(k);
    if (kind === 'palisade') {
      g.palisade[i] = { built: true, hp: PALISADE_HP, paid: {} };
      g.events.push({ type: 'built', id: 'palisade', segment: i });
    } else {
      g.bunks[i] = { built: true, paid: {} };
      g.events.push({ type: 'built', id: 'bunk', bunk: i });
    }
  }

  const palisadeUp = (g) => g.palisade.every((p) => p.built && p.hp > 0);

  // ── Survivors ──
  function canRescue(g, sv) {
    const need = SURVIVORS[sv.id].need;
    if (need === 'meat') return MEATS.reduce((a, k) => a + g.stock[k], 0) >= HUNTER_MEAT ? 'ok' : 'meat';
    if (need === 'day') return isNight(g) ? 'night' : 'ok';
    if (need === 'palisade') return palisadeUp(g) ? 'ok' : 'palisade';
    return 'ok'; // shovel and ice pick only gate the way there
  }

  function rescue(g, sv) {
    if (sv.state !== 'waiting') return 'bad';
    if (Math.hypot(sv.x - g.hero.x, sv.y - g.hero.y) > 1.6) return 'far';
    const r = canRescue(g, sv);
    if (r !== 'ok') { g.events.push({ type: 'needs', id: sv.id, need: r }); return r; }
    if (SURVIVORS[sv.id].need === 'meat') {
      // raw meat first; the hero cooks it at the fire and the smokehouse smokes it, so those count too
      let left = HUNTER_MEAT;
      for (const k of MEATS) { const n = Math.min(left, g.stock[k]); g.stock[k] -= n; left -= n; }
    }
    sv.state = 'following';
    g.events.push({ type: 'rescue', id: sv.id });
    return 'ok';
  }

  function survivorsTick(g, dt) {
    const bunksFree = g.bunks.filter((b) => b.built).length * 2;
    let placed = 0;
    for (const sv of g.survivors) {
      if (sv.state === 'following') {
        sv.cd -= dt;
        if (sv.cd <= 0 || !sv.path) {
          sv.cd = 1;
          const d = Math.hypot(sv.x - g.hero.x, sv.y - g.hero.y);
          sv.path = d > 1.5 ? pathNextTo(g, sv, Math.floor(g.hero.x), Math.floor(g.hero.y)) : null;
        }
        follow(g, sv, SPEED * 0.95, dt);
        if (inBase(Math.floor(sv.x), Math.floor(sv.y))) {
          sv.state = 'home';
          sv.path = null;
          g.events.push({ type: 'joined', id: sv.id });
        }
        continue;
      }
      if (sv.state !== 'home') continue;
      // needs: food from the stock, a bunk, warmth (the stove or a fed fire)
      sv.food = clamp(sv.food - SURVIVOR_FOOD * dt, 0, STAT_MAX);
      if (sv.food < SURVIVOR_EAT_AT) {
        const item = EAT_ORDER.find((k) => g.stock[k] > 0);
        if (item) { g.stock[item]--; sv.food = clamp(sv.food + FOOD[item], 0, STAT_MAX); }
      }
      const bunk = placed < bunksFree;
      placed++;
      const annex = upgradeOn(g, 'annex');
      const warm = stoveOn(g) || (fireOn(g) && chill(g) <= FIRE.warm) || (fireOn(g) && (bunk || annex));
      const ok = sv.food > 0 && warm;
      sv.hp = clamp(sv.hp + (ok ? 0.2 * (annex ? ANNEX.heal : 1) : -0.35) * dt, 0, STAT_MAX);
      if (sv.hp <= 0) {
        sv.state = 'dead';
        g.deaths.push({ id: sv.id, day: dayOf(g) });
        g.events.push({ type: 'died', id: sv.id });
        continue;
      }
      // work by day while well
      sv.busy = ok && !isNight(g);
      if (!sv.busy) continue;
      sv.work += dt;
      const w = WORK[sv.id];
      if (sv.work >= w.every * (annex ? ANNEX.work : 1)) {
        sv.work = 0;
        for (const k of Object.keys(w.give)) if (roomFor(g, k) > 0) g.stock[k] += w.give[k];
        if (sv.id === 'herbalist' && (g.stock.meat > 0 || g.stock.fish > 0) && fireOn(g)) {
          if (g.stock.meat > 0) { g.stock.meat--; g.stock.cookedMeat++; } else { g.stock.fish--; g.stock.cookedFish++; }
        }
        if (sv.id === 'child') {
          if (g.fire.fuel < FIRE.cap * 0.6 && g.stock.wood > 0) { g.stock.wood--; g.fire.fuel = Math.min(FIRE.cap, g.fire.fuel + 1); }
          if (g.hut.stage >= 4 && g.hut.stove < STOVE.cap * 0.6 && g.stock.wood > 0) { g.stock.wood--; g.hut.stove = Math.min(STOVE.cap, g.hut.stove + 1); }
        }
        if (sv.id === 'smith' || sv.id === 'carpenter') {
          const p = g.palisade.find((x) => x.built && x.hp < PALISADE_HP);
          if (p) p.hp = Math.min(PALISADE_HP, p.hp + 10);
        }
        g.events.push({ type: 'work', id: sv.id });
      }
    }
  }

  // ── Animals ──
  function freeTile(g, pred, rnd = rand) {
    for (let guard = 0; guard < 400; guard++) {
      const x = Math.floor(rnd(g) * W), y = Math.floor(rnd(g) * H);
      if (g.tiles[idx(x, y)] === '.' && !blockedByNode(g, x, y) && !inBase(x, y) && x < 43 && (!pred || pred(x, y))) return { x, y };
    }
    return null;
  }

  function spawnAnimal(g, kind) {
    const p = freeTile(g, (x, y) => Math.hypot(x - 27, y - 20) > 8);
    if (!p) return;
    g.animals.push({ id: g.nextId++, kind, x: p.x + 0.5, y: p.y + 0.5, hp: kind === 'deer' ? 2 : 1, tx: p.x, ty: p.y, cd: 0 });
  }

  function animalsTick(g, dt) {
    for (const a of g.animals) {
      a.cd -= dt;
      const d = Math.hypot(a.x - g.hero.x, a.y - g.hero.y);
      const speed = a.kind === 'deer' ? 2.2 : 1.6;
      if (a.cd <= 0 || (a.x === a.tx + 0.5 && a.y === a.ty + 0.5)) {
        a.cd = 2 + rand(g) * 3;
        // wander, or step away from the hero when close (deer run, rabbits hop)
        let tx = Math.floor(a.x) + Math.floor(rand(g) * 5) - 2, ty = Math.floor(a.y) + Math.floor(rand(g) * 5) - 2;
        if (d < 3) { tx = Math.floor(a.x + Math.sign(a.x - g.hero.x) * 2); ty = Math.floor(a.y + Math.sign(a.y - g.hero.y) * 2); }
        if (walkable(g, tx, ty, {}) && !inBase(tx, ty)) { a.tx = tx; a.ty = ty; }
      }
      const cx = a.tx + 0.5, cy = a.ty + 0.5, dd = Math.hypot(cx - a.x, cy - a.y);
      if (dd > 0.01) {
        const st = Math.min(dd, speed * dt);
        a.x += ((cx - a.x) / dd) * st;
        a.y += ((cy - a.y) / dd) * st;
      } else { a.x = cx; a.y = cy; }
    }
    // keep the herds: a rabbit or a deer comes back now and then
    if (g.animals.filter((a) => a.kind === 'rabbit').length < 6 && rand(g) < dt / 30) spawnAnimal(g, 'rabbit');
    if (g.animals.filter((a) => a.kind === 'deer').length < 3 && rand(g) < dt / 60) spawnAnimal(g, 'deer');
  }

  // ── Wolves ──
  const wolvesTonight = (g) => Math.floor((1 + dayOf(g) / 5) * DIFF[g.difficulty].wolves);
  const people = (g) => [g.hero].concat(g.survivors.filter((s) => s.state === 'following' || s.state === 'home'));

  function spawnWolves(g) {
    const n = wolvesTonight(g);
    for (let k = 0; k < n; k++) {
      const p = freeTile(g, (x, y) => people(g).every((e) => Math.hypot(x + 0.5 - e.x, y + 0.5 - e.y) > WOLF_SAFE));
      if (!p) continue;
      g.wolves.push({ id: g.nextId++, x: p.x + 0.5, y: p.y + 0.5, hp: WOLF_HP * (g.difficulty === 'harsh' ? 1.5 : 1), maxHp: WOLF_HP * (g.difficulty === 'harsh' ? 1.5 : 1), cd: 0, flee: false });
    }
    if (n) g.events.push({ type: 'howl', n });
  }

  // A person the wolf can reach: outside a standing palisade, or anyone when it's broken.
  // Survivors at home sleep behind the hut's door once it hangs.
  function prey(g, e) {
    if (e !== g.hero && e.state === 'home' && g.hut.stage >= 3) return false;
    if (e === g.hero && g.hut.stage >= 3 && inHut(e)) return false; // the hero behind the hut's door, too
    return !(palisadeUp(g) && inBase(Math.floor(e.x), Math.floor(e.y)));
  }

  // The tiles wolves may use this tick (no trees, rocks, ice holes or drifts) and the lit ones.
  function wolfMasks(g) {
    const open = new Uint8Array(W * H), light = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      open[i] = 'oD'.includes(g.tiles[i]) || blockedByNode(g, x, y) ? 0 : 1;
    }
    const mark = (c, r) => {
      for (let y = Math.floor(c.y - r); y <= Math.ceil(c.y + r); y++) for (let x = Math.floor(c.x - r); x <= Math.ceil(c.x + r); x++) {
        if (inMap(x, y) && Math.hypot(x - c.x, y - c.y) <= r) light[idx(x, y)] = 1;
      }
    };
    if (fireOn(g)) mark(SPOT.fire, FIRE.radius);
    if (stoveOn(g)) mark({ x: HUT.x + 1, y: HUT.y }, 3);
    for (const t of g.torches) mark(t, TORCH.radius);
    return { open, light };
  }

  // The masks change slowly (a torch, a fire going out): they are rebuilt twice a second.
  let maskCache = null;
  function wolvesTick(g, dt) {
    if (!g.wolves.length) return;
    if (!maskCache || maskCache.g !== g || g.t - maskCache.t >= 0.5 || g.t < maskCache.t) maskCache = { g, t: g.t, M: wolfMasks(g) };
    const M = maskCache.M;
    const fence = palisadeUp(g);
    for (const w of g.wolves) {
      w.cd = Math.max(0, w.cd - dt);
      if (w.hp < w.maxHp * WOLF_FLEE) w.flee = true;
      let target = null, td = Infinity;
      for (const e of people(g)) {
        if (!prey(g, e)) continue;
        const d = Math.hypot(e.x - w.x, e.y - w.y);
        if (d < td) { td = d; target = e; }
      }
      let gx, gy;
      if (w.flee || !target) {
        // run from the nearest person (or stand)
        const near = people(g).reduce((a, e) => (Math.hypot(e.x - w.x, e.y - w.y) < Math.hypot(a.x - w.x, a.y - w.y) ? e : a), g.hero);
        gx = w.x + Math.sign(w.x - near.x) * 3; gy = w.y + Math.sign(w.y - near.y) * 3;
        // a wolf with nobody to hunt circles the palisade and gnaws at a segment
        if (!w.flee && palisadeUp(g)) {
          const inside = people(g).some((e) => inBase(Math.floor(e.x), Math.floor(e.y)));
          if (inside) {
            const seg = nearestSegment(w);
            const sp = segmentPoint(seg);
            if (Math.hypot(sp.x - w.x, sp.y - w.y) < 1.3) {
              if (w.cd <= 0) {
                w.cd = WOLF_CD;
                const p = g.palisade[seg];
                p.hp -= GNAW;
                g.events.push({ type: 'gnaw', segment: seg });
                if (p.hp <= 0) { p.hp = 0; g.events.push({ type: 'palisadeBroken', segment: seg }); }
              }
              continue;
            }
            gx = sp.x; gy = sp.y;
          }
        }
      } else if (td <= 1.1) {
        if (w.cd <= 0) {
          w.cd = WOLF_CD;
          const bite = BITE * DIFF[g.difficulty].bite;
          if (target === g.hero) {
            g.hero.health = Math.max(0, g.hero.health - bite);
            // bitten awake: the hero turns on the wolf unless he is busy with something else
            if (g.hero.sleeping || !g.hero.target || g.hero.target.type === 'bed' || g.hero.target.type === 'walk') {
              g.hero.sleeping = false;
              order(g, { type: 'wolf', id: w.id }, []);
            }
            g.events.push({ type: 'bite', who: 'hero' });
          } else {
            target.hp = Math.max(0, target.hp - bite);
            g.events.push({ type: 'bite', who: target.id });
            if (target.hp <= 0 && target.state !== 'dead') {
              target.state = 'dead';
              g.deaths.push({ id: target.id, day: dayOf(g) });
              g.events.push({ type: 'died', id: target.id });
            }
          }
        }
        continue;
      } else { gx = target.x; gy = target.y; }
      // a path toward the goal (re-planned every second) around trees and rocks, out of the light and the palisade
      const wx = Math.floor(w.x), wy = Math.floor(w.y);
      const inLight = inMap(wx, wy) && M.light[idx(wx, wy)] === 1, outside = !inBase(wx, wy);
      const pass = (x, y) => {
        if (!inMap(x, y)) return false;
        const i = idx(x, y);
        return M.open[i] === 1 && (M.light[i] === 0 || inLight) && !(fence && outside && inBase(x, y));
      };
      const tx = clamp(Math.floor(gx), 0, W - 1), ty = clamp(Math.floor(gy), 0, H - 1);
      w.plan = (w.plan || 0) - dt;
      if (w.plan <= 0 || !w.path) {
        w.plan = 1;
        w.path = astar(g, w, (x, y) => Math.abs(x - tx) + Math.abs(y - ty) <= 1, manhattan(tx, ty), null, pass, 700);
      }
      if (w.path && w.path.length) {
        const n = w.path[0];
        if (!pass(n.x, n.y)) { w.path = null; continue; }
        const cx = n.x + 0.5, cy = n.y + 0.5, d = Math.hypot(cx - w.x, cy - w.y), sp = WOLF_SPEED * dt;
        if (d <= sp) { w.x = cx; w.y = cy; w.path.shift(); } else { w.x += ((cx - w.x) / d) * sp; w.y += ((cy - w.y) / d) * sp; }
      } else {
        // the last stretch to the goal (or no path): straight, if the tile allows
        const d = Math.hypot(gx - w.x, gy - w.y), sp = Math.min(d, WOLF_SPEED * dt);
        if (d > 0.01) {
          const nx = w.x + ((gx - w.x) / d) * sp, ny = w.y + ((gy - w.y) / d) * sp;
          if (pass(Math.floor(nx), Math.floor(ny)) || (Math.floor(nx) === wx && Math.floor(ny) === wy)) { w.x = nx; w.y = ny; }
        }
      }
    }
    // a lit wolf runs: wolves inside the light flee
    for (const w of g.wolves) { const i = idx(clamp(Math.floor(w.x), 0, W - 1), clamp(Math.floor(w.y), 0, H - 1)); if (M.light[i]) w.flee = true; }
  }

  const nearestSegment = (w) => {
    const d = [Math.abs(w.y - BASE.y0), Math.abs(w.x - BASE.x1 - 1), Math.abs(w.y - BASE.y1 - 1), Math.abs(w.x - BASE.x0)];
    return d.indexOf(Math.min(...d));
  };
  const segmentPoint = (i) => [
    { x: 27.5, y: BASE.y0 - 0.5 }, { x: BASE.x1 + 1.5, y: 19.5 }, { x: 27.5, y: BASE.y1 + 1.5 }, { x: BASE.x0 - 0.5, y: 19.5 },
  ][i];

  // ── Day changes ──
  function dayTick(g, before) {
    const was = Math.floor(before / DAY), now = Math.floor(g.t / DAY);
    const nightWas = before % DAY >= NIGHT_AT, nightNow = isNight(g);
    if (!nightWas && nightNow && now === was) {
      g.events.push({ type: 'night', day: dayOf(g) });
      spawnWolves(g);
    }
    if (now > was) {
      // dawn: the wolves leave, bushes and trees regrow, the dawn save point
      g.wolves = [];
      g.hero.sleeping = false;
      for (const n of g.nodes) if (n.amount <= 0 && g.t >= n.regrowAt) { n.amount = n.max; touchNodes(g); }
      g.hero.load = inBase(Math.floor(g.hero.x), Math.floor(g.hero.y)) ? 0 : g.hero.load;
      g.events.push({ type: 'dawn', day: dayOf(g), blizzard: isBlizzard(g) });
      g.dawnDue = true;
      if (now >= DAYS) {
        g.status = 'won';
        g.events.push({ type: 'won' });
      }
    }
  }

  function tick(g) {
    const dtWorld = TICK;
    const before = g.t;
    g.t += dtWorld;
    const h = g.hero;
    if (inBase(Math.floor(h.x), Math.floor(h.y))) h.load = 0;
    if (h.dir) moveFree(g, dtWorld);
    else if (h.path) follow(g, h, SPEED, dtWorld);
    workTick(g, dtWorld);
    burnTick(g);
    smokeTick(g, dtWorld);
    statsTick(g, dtWorld);
    survivorsTick(g, dtWorld);
    animalsTick(g, dtWorld);
    wolvesTick(g, dtWorld);
    dayTick(g, before);
    if (h.health <= 0 && g.status === 'playing') {
      g.status = 'lost';
      g.events.push({ type: 'lost', day: dayOf(g) });
    }
  }

  // Time asleep runs faster: the client calls step with real dt, and a sleeping hero with a fed stove turns it
  // into SLEEP_SPEED × as much world time (still in fixed ticks).
  const sleepFast = (g) => g.hero.sleeping && stoveOn(g) && inHut(g.hero);

  function step(g, dt) {
    if (g.status !== 'playing' || !finite(dt) || dt <= 0) return;
    g.acc += Math.min(dt, MAX_DT) * (sleepFast(g) ? SLEEP_SPEED : 1);
    while (g.acc >= TICK - 1e-9) {
      g.acc -= TICK;
      tick(g);
      if (g.status !== 'playing') { g.acc = 0; break; }
    }
  }

  // ★ survived, ★★ ≥ 3 survivors alive at the end, ★★★ all five alive and the hut fully repaired.
  function stars(g) {
    if (g.status !== 'won') return 0;
    const alive = g.survivors.filter((s) => s.state === 'home').length;
    if (alive >= 5 && g.hut.stage >= HUT_STAGES.length) return 3;
    return alive >= 3 ? 2 : 1;
  }

  // ── The next thing to do (the hint line) ──
  function nextTask(g) {
    const h = g.hero;
    if (h.health < 30) return 'Ты слабеешь: согрейся, поешь и отдохни';
    if (h.food < 30 && EAT_ORDER.some((k) => g.stock[k] > 0)) return 'Поешь (F)';
    if (h.food < 30) return 'Найди еду: ягоды, зайцы, рыба во льду';
    if (h.warmth < 35) return g.hut.stage >= 4 ? 'Согрейся в хижине у печи' : 'Согрейся у костра';
    if (g.fire.fuel < 4) return g.stock.wood > 0 ? 'Подкинь дров в костёр' : 'Наруби дров для костра';
    if (isNight(g) && g.hut.stage >= 2 && h.energy < 60) return 'Ночь: поспи в хижине';
    if (g.hut.stage < 1) return 'Почини хижину: стены';
    if (!g.tools.pick) return 'Сделай кирку на верстаке';
    if (g.hut.stage < 2) return 'Почини хижину: крыша';
    if (g.hut.stage < 3) return 'Почини хижину: дверь';
    if (g.hut.stage < 4) return 'Сложи печь в хижине';
    if (!palisadeUp(g)) return 'Построй частокол вокруг лагеря';
    const waiting = g.survivors.find((s) => s.state === 'waiting');
    if (waiting) {
      const sv = SURVIVORS[waiting.id];
      if (sv.need === 'shovel' && !g.tools.shovel) return 'Сделай лопату: к Плотнику не пройти через сугробы';
      if (sv.need === 'icePick' && !g.tools.icePick) return 'Сделай ледоруб: Кузнец за озером';
      return `Спаси выжившего: ${sv.name}`;
    }
    if (g.bunks.some((b) => !b.built)) return 'Сделай нары для выживших';
    const up = UPGRADE_IDS.find((id) => !g.upgrades[id].built);
    if (up) return `Улучши дом: ${UPGRADES[up].name}`;
    return 'Держись до весны';
  }
  // The texts nextTask may return (the client translates them; tests check their RO strings).
  const TASK_TEXTS = [
    'Ты слабеешь: согрейся, поешь и отдохни', 'Поешь (F)', 'Найди еду: ягоды, зайцы, рыба во льду', 'Согрейся в хижине у печи',
    'Согрейся у костра', 'Подкинь дров в костёр', 'Наруби дров для костра', 'Ночь: поспи в хижине', 'Почини хижину: стены',
    'Сделай кирку на верстаке', 'Почини хижину: крыша', 'Почини хижину: дверь', 'Сложи печь в хижине', 'Построй частокол вокруг лагеря',
    'Сделай лопату: к Плотнику не пройти через сугробы', 'Сделай ледоруб: Кузнец за озером', 'Спаси выжившего: {name}',
    'Сделай нары для выживших', 'Улучши дом: {name}', 'Держись до весны',
  ];

  // ── Snapshots and the save ──
  function snapshot(g) {
    const o = clone(g);
    o.events = [];
    o.acc = 0;
    delete o.dawnDue;
    delete o.nodeStamp;
    return o;
  }

  const num = (v, lo, hi) => finite(v) && v >= lo && v <= hi;

  // Fills what a snapshot from an older build lacks, on a copy; restore validates the result as usual.
  function migrate(o) {
    if (!o || typeof o !== 'object') return o;
    const m = clone(o);
    if (m.erng === undefined && Number.isInteger(m.seed)) m.erng = erngOf(m.seed);
    if (m.stock && typeof m.stock === 'object') for (const k of ['hide', 'smokedMeat', 'smokedFish']) if (m.stock[k] === undefined) m.stock[k] = 0;
    if (m.upgrades === undefined) m.upgrades = newUpgrades();
    return m;
  }

  function restore(raw) {
    const o = migrate(raw);
    if (!o || typeof o !== 'object' || o.v !== 1 || o.status !== 'playing' || !has(DIFF, o.difficulty)) return null;
    if (!num(o.t, 0, DAY * (DAYS + 1)) || !Number.isInteger(o.rng) || !Number.isInteger(o.erng) || !Array.isArray(o.tiles) || o.tiles.length !== W * H) return null;
    if (!o.tiles.every((c) => typeof c === 'string' && '.:D~o'.includes(c))) return null;
    const h = o.hero;
    if (!h || !['warmth', 'food', 'energy', 'health'].every((k) => num(h[k], 0, STAT_MAX)) || !num(h.x, 0, W) || !num(h.y, 0, H)) return null;
    if (!o.stock || !ITEMS.every((k) => num(o.stock[k], 0, 1e6)) || !o.tools || !Object.keys(TOOLS).every((k) => typeof o.tools[k] === 'boolean')) return null;
    if (!Array.isArray(o.nodes) || !o.nodes.every((n) => n && ['tree', 'rock', 'bush', 'scrap'].includes(n.kind) && num(n.x, 0, W - 1) && num(n.y, 0, H - 1))) return null;
    if (!o.hut || !num(o.hut.stage, 0, HUT_STAGES.length) || !Array.isArray(o.palisade) || o.palisade.length !== 4 || !Array.isArray(o.bunks)) return null;
    if (!Array.isArray(o.survivors) || o.survivors.length !== SURVIVOR_IDS.length || !o.survivors.every((s) => SURVIVOR_IDS.includes(s.id) && ['waiting', 'following', 'home', 'dead'].includes(s.state))) return null;
    if (!o.upgrades || typeof o.upgrades !== 'object' || !UPGRADE_IDS.every((id) => o.upgrades[id] && typeof o.upgrades[id].built === 'boolean' && o.upgrades[id].paid && typeof o.upgrades[id].paid === 'object')) return null;
    if (!num(o.upgrades.smokehouse.work, 0, SMOKE.every) || !num(o.upgrades.smokehouse.fuel, 0, SMOKE.perLog)) return null;
    if (!o.fire || !num(o.fire.fuel, 0, FIRE.cap) || !Array.isArray(o.torches) || !Array.isArray(o.wolves) || !Array.isArray(o.animals)) return null;
    const g = clone(o);
    g.events = [];
    g.acc = 0;
    touchNodes(g);
    return g;
  }

  // winter.save: { v: 1, best: { normal, harsh } (days survived, 31 = won), stars: { normal, harsh }, unlocked
  // (harsh), current: snapshot | null, dawn: snapshot | null }
  const SAVE_KEY = 'winter.save';
  const newSave = () => ({ v: 1, best: { normal: 0, harsh: 0 }, stars: { normal: 0, harsh: 0 }, unlocked: false, current: null, dawn: null });

  function parseSave(raw) {
    const out = newSave();
    if (typeof raw !== 'string') return out;
    let d;
    try { d = JSON.parse(raw); } catch { return out; }
    if (!d || d.v !== 1) return out;
    for (const k of ['normal', 'harsh']) {
      if (d.best && Number.isInteger(d.best[k]) && d.best[k] >= 0 && d.best[k] <= DAYS + 1) out.best[k] = d.best[k];
      if (d.stars && Number.isInteger(d.stars[k]) && d.stars[k] >= 0 && d.stars[k] <= 3) out.stars[k] = d.stars[k];
    }
    out.unlocked = d.unlocked === true;
    out.current = restore(d.current) ? d.current : null;
    out.dawn = out.current && restore(d.dawn) ? d.dawn : null;
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

  // Folds a game into the records: the days lived, the stars, the harsh winter unlocked by a win.
  // Returns true when a record improved.
  function recordGame(save, g) {
    const k = g.difficulty;
    let better = false;
    const days = g.status === 'won' ? DAYS + 1 : dayOf(g) - 1;
    if (days > save.best[k]) { save.best[k] = days; better = true; }
    const st = stars(g);
    if (st > save.stars[k]) { save.stars[k] = st; better = true; }
    if (g.status === 'won' && !save.unlocked) { save.unlocked = true; better = true; }
    return better;
  }

  // «Начать день заново»: the game as it was at the last dawn.
  function retryDay(save) {
    const g = restore(save.dawn);
    return g;
  }

  const api = {
    TICK, MAX_DT, W, H, DAY, NIGHT_AT, DAYS, SLEEP_SPEED, SPEED, DEEP, CARRY, HIT_CD, STORE_CAP, FOOD_CAP, FIRE, STOVE, TORCH, STAT_MAX,
    FOOD_DRAIN, ENERGY_DRAIN, WORK_ENERGY, SLEEP_ENERGY, HEALTH_LOSS, HEALTH_GAIN, FOOD, RAW_MEAT_ENERGY, COOK_TIME,
    FISH_TIME, BITE, GNAW, WOLF_HP, WOLF_SAFE, DIFF, BASE, HUT, SPOT, SEGMENTS, TOOLS, HUT_STAGES, PALISADE_COST, PALISADE_HP,
    PALISADE_REPAIR, BUNK_COST, UPGRADES, UPGRADE_IDS, INSULATION, CELLAR_FOOD, SMOKE, ANNEX, SURVIVORS, SURVIVOR_IDS, HUNTER_MEAT, MEATS, WORK, RES, FOOD_ITEMS, ITEMS, EAT_ORDER, BLIZZARDS, SAVE_KEY, TASK_TEXTS,
    clamp, rand, erand, idx, inMap, inBase, newGame, status, drain, dayOf, timeOfDay, isNight, isBlizzard, baseTemp,
    temperature, chill, nodeAt, walkable, pathTo, pathNextTo, afford, stockTotal, foodTotal, foodCap, roomFor, upgradeOn, warmthRate, lit, inHut, stoveOn,
    fireOn, atBase, moveDir, interact, eat, placeTorch, craft, needOf, contribute, palisadeUp, canRescue, rescue,
    wolvesTonight, step, stars, nextTask, snapshot, restore, newSave, parseSave, loadSave, storeSave, recordGame,
    retryDay,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WinterCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
