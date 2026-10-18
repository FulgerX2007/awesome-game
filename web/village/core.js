// Родник — pure rules for the village restoration game. No DOM here, so the same file runs
// in the browser and in Node (tests and the balance bot).
// Coordinates: tiles are integers, the player moves in continuous tile units (tile centre = x + 0.5).
(function (root) {
  'use strict';

  // 2: the world clock (days and seasons). Older saves start a new village (load says recovered: 'old').
  // 3: the map grows east (the hamlet). A version 2 save loads as is: only the nodes are laid out anew.
  const VERSION = 3;

  // ── World clock ──
  // A day is 8 minutes: dawn, 6 minutes of daylight, dusk and night. Three days make a season, four a year.
  // The clock is read from s.t, so it needs no state of its own; the game starts on a spring morning.
  const DAY = 480;
  const DAWN_END = 0.05, DUSK_START = 0.75, NIGHT_START = 0.85; // parts of the day, as a fraction of it
  const SEASON_DAYS = 3;
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

  function clock(t) {
    t = Math.max(0, Number(t) || 0);
    const day = Math.floor(t / DAY);
    const phase = (t - day * DAY) / DAY;
    const part = phase < DAWN_END ? 'dawn' : phase < DUSK_START ? 'day' : phase < NIGHT_START ? 'dusk' : 'night';
    const seasonIndex = Math.floor(day / SEASON_DAYS) % SEASONS.length;
    return {
      day, phase, part, season: SEASONS[seasonIndex], seasonIndex,
      seasonDay: day % SEASON_DAYS, year: Math.floor(day / (SEASON_DAYS * SEASONS.length)),
    };
  }

  // ── Constants ──
  const RESOURCES = {
    wood: { name: 'Дерево' },
    stone: { name: 'Камень' },
    clay: { name: 'Глина' },
    berries: { name: 'Ягоды' },
    planks: { name: 'Доски' },
    bricks: { name: 'Кирпич' },
    vegetables: { name: 'Овощи' },
    honey: { name: 'Мёд' },
    apples: { name: 'Яблоки' },
    coins: { name: 'Монеты' },
  };
  const RES_IDS = Object.keys(RESOURCES);

  // hp = hits until the node is empty; regrow = [min, max] seconds until it comes back.
  // Values tuned by the balance bot (tests/village/balance.test.js).
  const NODE_KINDS = {
    tree: { name: 'Дерево', res: 'wood', hp: 4, tool: 'axe', regrow: [150, 300] },
    rock: { name: 'Камень', res: 'stone', hp: 4, tool: 'pick', regrow: [150, 300] },
    clay: { name: 'Глиняная яма', res: 'clay', hp: 3, tool: 'shovel', regrow: [150, 300] },
    bush: { name: 'Ягодный куст', res: 'berries', hp: 3, tool: 'basket', regrow: [150, 300], rests: ['winter'] },
    // Apples ripen in summer and autumn only; an apple tree is bare the rest of the year.
    apple: { name: 'Яблоня', res: 'apples', hp: 3, tool: 'basket', regrow: [150, 300], rests: ['winter', 'spring'] },
  };

  // Level 2 needs the workbench (home), level 3 needs the forge. The shovel starts at 0 and comes with the bridge.
  const TOOLS = {
    axe: { name: 'Топор', node: 'tree', start: 1, costs: { 2: { stone: 30, wood: 20 }, 3: { bricks: 50, planks: 100 } } },
    pick: { name: 'Кирка', node: 'rock', start: 1, costs: { 2: { wood: 40, stone: 20 }, 3: { bricks: 50, planks: 100 } } },
    shovel: { name: 'Лопата', node: 'clay', start: 0, costs: { 2: { wood: 50 }, 3: { bricks: 40, planks: 80 } } },
    basket: { name: 'Корзина', node: 'bush', start: 1, costs: { 2: { wood: 30 }, 3: { planks: 80 } } },
  };
  const TOOL_NEEDS = { 2: 'home', 3: 'forge' };
  const TOOL_YIELD = [0, 1, 2, 3];       // per hit, by tool level
  const TOOL_CD = [0.6, 0.6, 0.5, 0.4];  // seconds between hits, by tool level
  const MAX_TOOL = 3;

  // ch is the ruin footprint character in MAP. Effects are applied when a building is done.
  // Costs tuned by the balance bot: the festival in about 2¼ h, something new at least every 15 min.
  const BUILDINGS = {
    well: { id: 'well', ch: 'W', name: 'Колодец', cost: { stone: 40, wood: 60 }, needs: [], effect: 'square' },
    home: { id: 'home', ch: 'H', name: 'Твой дом', cost: { wood: 120, stone: 60 }, needs: [], effect: 'workbench' },
    garden: { id: 'garden', ch: 'G', name: 'Огород', cost: { wood: 80, stone: 30 }, needs: ['well'], effect: 'garden' },
    barn: { id: 'barn', ch: 'A', name: 'Амбар', cost: { wood: 200, stone: 100 }, needs: ['well'], effect: 'storage' },
    bridge: { id: 'bridge', ch: 'b', name: 'Мост', cost: { wood: 260, stone: 160 }, needs: ['home'], effect: 'bridge' },
    sawmill: { id: 'sawmill', ch: 'S', name: 'Лесопилка', cost: { wood: 300, stone: 200 }, needs: ['bridge'], effect: 'sawmill' },
    kiln: { id: 'kiln', ch: 'K', name: 'Печь для обжига', cost: { stone: 180, clay: 130 }, needs: ['bridge'], effect: 'kiln' },
    house1: { id: 'house1', ch: '1', name: 'Дом лесоруба', cost: { planks: 120, bricks: 60 }, needs: ['sawmill', 'kiln'], effect: 'villager', role: 'woodcutter' },
    apiary: { id: 'apiary', ch: 'P', name: 'Пасека', cost: { planks: 60, wood: 40 }, needs: ['garden', 'house1'], effect: 'apiary' },
    house2: { id: 'house2', ch: '2', name: 'Дом каменщика', cost: { planks: 200, bricks: 120 }, needs: ['house1'], effect: 'villager', role: 'mason' },
    market: { id: 'market', ch: 'R', name: 'Ярмарочные ряды', cost: { planks: 80, wood: 60 }, needs: ['house2'], effect: 'market' },
    forge: { id: 'forge', ch: 'F', name: 'Кузница', cost: { bricks: 100, planks: 60, stone: 200 }, needs: ['kiln'], effect: 'forge' },
    mill: { id: 'mill', ch: 'M', name: 'Мельница', cost: { planks: 240, bricks: 120 }, needs: ['house2'], effect: 'mill' },
    house3: { id: 'house3', ch: '3', name: 'Дом гончара', cost: { planks: 240, bricks: 160, berries: 40, vegetables: 30 }, needs: ['mill'], effect: 'villager', role: 'potter' },
    chapel: {
      id: 'chapel', ch: 'C', name: 'Часовня с колоколом', cost: { planks: 200, bricks: 180, stone: 450, berries: 60, vegetables: 40, honey: 30, apples: 20 },
      needs: ['well', 'home', 'garden', 'barn', 'bridge', 'sawmill', 'kiln', 'house1', 'apiary', 'house2', 'market', 'forge', 'mill', 'house3'], effect: 'festival',
    },
    // After the festival: the hamlet over the hill. `after: 'festival'` keeps these out of the first goal.
    road: { id: 'road', ch: 't', name: 'Дорога через холм', cost: { stone: 300, planks: 150 }, needs: ['chapel'], effect: 'road', after: 'festival' },
  };
  const BUILDING_IDS = Object.keys(BUILDINGS);
  const BARN_UPGRADE = { planks: 100, bricks: 40 };
  const STORAGE = [50, 150, 400]; // start, after the barn, after the barn upgrade
  const WORKSHOP_RESERVE = 30;

  // The garden: plots on the map ('g'), sown with a berry, watered from the bucket (filled at the well),
  // ripe after a day of growth with water. Water lasts until the next dawn. Nothing grows in winter.
  const GARDEN = {
    seed: { berries: 1 },               // what sowing a plot costs
    bucket: 6,                          // waterings per filled bucket
    harvest: [0, 4, 5, 6],              // vegetables per plot, by basket level
    grow: { spring: 1, summer: 1.25, autumn: 0.8, winter: 0 }, // growth speed by season
  };

  // Automatic income, per second. Villagers come from the houses, the mill speeds them up.
  const VILLAGERS = {
    woodcutter: { name: 'Лесоруб', res: 'wood', rate: 0.2 },
    mason: { name: 'Каменщик', res: 'stone', rate: 0.15 },
    potter: { name: 'Гончар', res: 'clay', rate: 0.15 },
  };
  const MILL_BONUS = 1.5;
  // Orders from the villagers, posted on the board at the market rows: a few goods for coins.
  // ORDER_GOODS: the usual amount asked for and what one unit is worth in coins.
  const ORDERS = { max: 3, atMarket: 2 };
  const ORDER_GOODS = {
    wood: { n: 30, worth: 1 }, stone: { n: 25, worth: 1 }, clay: { n: 20, worth: 1.2 }, berries: { n: 12, worth: 1.5 },
    planks: { n: 20, worth: 2.5 }, bricks: { n: 15, worth: 3 }, vegetables: { n: 8, worth: 4 }, honey: { n: 6, worth: 5 },
    apples: { n: 6, worth: 4 },
  };

  // The fair: on the first day of every season, in daylight, at the market rows. Each thing is bought once.
  const FAIR = {
    cuttings: { name: 'Черенки винограда', price: 12 },
    bucket: { name: 'Большое ведро', price: 20 },
    swing: { name: 'Качели', price: 15 },
    sweep: { name: 'Колодезный журавль', price: 18 },
    scarecrow: { name: 'Пугало', price: 10 },
    arch: { name: 'Арка с цветами', price: 14 },
  };
  const BIG_BUCKET = 10;

  // Buildings that produce on their own, resting in some seasons.
  const PRODUCERS = {
    apiary: { res: 'honey', rate: 0.05, rests: ['winter'] },
  };
  // Workshops turn `ratio` raw units into one product, `rate` products per second.
  const WORKSHOPS = {
    sawmill: { from: 'wood', to: 'planks', ratio: 2, rate: 0.3 },
    kiln: { from: 'clay', to: 'bricks', ratio: 2, rate: 0.25 },
  };
  const OFFLINE_MAX = 8 * 3600;

  // Free play after the festival: decorations on free square tiles.
  const DECOR = {
    bed: { name: 'Клумба', cost: { berries: 5, planks: 2 } },
    lantern: { name: 'Фонарь', cost: { planks: 4, stone: 2 } },
    bench: { name: 'Скамейка', cost: { planks: 6 } },
    fence: { name: 'Забор', cost: { planks: 3, stone: 1 } },
    // Bought at the fair first; then built like the others.
    swing: { name: 'Качели', cost: { planks: 8, wood: 4 }, fair: true },
    sweep: { name: 'Колодезный журавль', cost: { wood: 10, stone: 4 }, fair: true },
    scarecrow: { name: 'Пугало', cost: { wood: 4, berries: 2 }, fair: true },
    arch: { name: 'Арка с цветами', cost: { planks: 6, berries: 6 }, fair: true },
  };

  // Nodes scattered per zone. West is open from the start, north and east open with the bridge.
  const ZONE_NODES = {
    west: { tree: 22, rock: 10, bush: 10, apple: 3 },
    north: { tree: 18, bush: 8, rock: 2 },
    east: { rock: 14, clay: 12, tree: 4, bush: 3 },
    hamlet: { apple: 8, tree: 8, bush: 5, rock: 3 },
  };

  // ── Map ──
  // .  grass       ~  water      :  sand (river bank)   =  path   #  square
  // b  bridge site (water until the bridge is restored)
  // ^  the hill east of the village (never walkable)   t  the trail over it (blocked until the road is built)
  // W H A S K 1 2 3 F M C G P R  ruin footprints (see BUILDINGS[].ch)
  // g  a garden plot (part of the garden, never walkable)
  const MAP = [
    '................................................^^^.............',
    '.......:::::....................................^^^.............',
    '.......:~~~:....................................^^^.............',
    '.......:~~~:....................................^^^.............',
    '.......:::::....................................^^^.............',
    '................................................^^^.............',
    '................................................^^^.............',
    ':::::::::::..........:::::::::::::..............^^^.............',
    '~~~~~~~~~~::::::::::::~~~~~~~~~~~:..............^^^.............',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~:..............^^^.............',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~:..............^^^.............',
    '::::::::::~~~~~~~~~~~~::::::::~~~:..............^^^.............',
    '.........:::::::=::::::MM....:~~~:..............^^^.............',
    '................=======MM....:~~~:..............^^^.............',
    '................=............:~~~:..............^^^.............',
    '................=............:~~~:..............^^^.............',
    '................=............:~~~:..............^^^.............',
    '............AAA.=............:~~~:..............^^^.............',
    '............AAA.=............:~~~:..............^^^.............',
    '................=............:~~~:..............^^^.............',
    '............########.........:bbb:..............^^^.............',
    '........HH..########==========bbb===============ttt=============',
    '........HH..###WW###.....SSS.:~~~:..KK..........^^^.....=.......',
    '...=========###WW###.....SSS.:~~~:..KK..........^^^.....=.......',
    '.....11..22.########.RRR.....:~~~:..............^^^.....=.......',
    '.....11..22.########.RRR....::~~~:..............^^^.....=.......',
    '...............=............:~~~::..............^^^.....=.......',
    '...GG.ggg...FF.=.33.........:~~~:...............^^^.....=.......',
    '...GG.ggg...FF.=.33.........:~~~:...............^^^.............',
    '...............=............:~~~:...............^^^.............',
    '...............=............:~~~:...............^^^.............',
    '...PP.........CCC...........:~~~:...............^^^.............',
    '...PP.........CCC...........:~~~:...............^^^.............',
    '..............CCC...........:~~~:...............^^^.............',
    '............................:~~~:...............^^^.............',
    '............................:~~~:...............^^^.............',
  ];
  const W = MAP[0].length;
  const H = MAP.length;
  const START = { x: 13, y: 24 }; // a square tile next to the well

  const RUIN_CH = {};
  for (const b of Object.values(BUILDINGS)) RUIN_CH[b.ch] = b.id;

  const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const tileAt = (x, y) => (inMap(x, y) ? MAP[y][x] : null);
  // The building whose ruin footprint covers a tile, or null.
  const ruinAt = (x, y) => RUIN_CH[tileAt(x, y)] || null;
  const idx = (x, y) => y * W + x;
  // Base terrain walkability, ignoring nodes; the bridge site counts only when open.
  const groundWalkable = (c, bridgeOpen, roadOpen) =>
    c === '.' || c === ':' || c === '=' || c === '#' || (c === 'b' && bridgeOpen) || (c === 't' && roadOpen);

  // Tiles of each ruin footprint, keyed by building id.
  const FOOTPRINTS = {};
  for (const id of BUILDING_IDS) FOOTPRINTS[id] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const id = RUIN_CH[MAP[y][x]];
    if (id) FOOTPRINTS[id].push({ x, y });
  }

  // Garden plots in reading order; s.plots[i] belongs to PLOTS[i].
  const PLOTS = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (MAP[y][x] === 'g') PLOTS.push({ x, y });
  const plotAt = (x, y) => PLOTS.findIndex((p) => p.x === x && p.y === y);

  function flood(start, pass) {
    const seen = new Uint8Array(W * H);
    const q = [start.x, start.y];
    seen[idx(start.x, start.y)] = 1;
    let count = 1;
    for (let i = 0; i < q.length; i += 2) {
      const x = q[i], y = q[i + 1];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inMap(nx, ny) || seen[idx(nx, ny)] || !pass(nx, ny)) continue;
        seen[idx(nx, ny)] = 1;
        count++;
        q.push(nx, ny);
      }
    }
    return { seen, count };
  }

  // Zones: land reachable from the start without the bridge is west; the hamlet lies past the hill (x ≥ HAMLET_X);
  // the rest is north (above the river) or east.
  const HAMLET_X = 48;
  const ZONES = new Array(W * H).fill(null);
  {
    const west = flood(START, (x, y) => groundWalkable(MAP[y][x], false)).seen;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = MAP[y][x];
      if (c === '~' || c === 'b' || c === '^' || c === 't') continue;
      ZONES[idx(x, y)] = west[idx(x, y)] ? 'west' : x >= HAMLET_X ? 'hamlet' : y < 8 ? 'north' : 'east';
    }
  }
  const zoneAt = (x, y) => (inMap(x, y) ? ZONES[idx(x, y)] : null);

  // Whether a tile matching pred lies within Chebyshev distance r of (x, y).
  function near(x, y, r, pred) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (inMap(x + dx, y + dy) && pred(MAP[y + dy][x + dx])) return true;
    }
    return false;
  }

  // Grass tiles where a node may ever stand: away from paths (grass only), the square,
  // ruins (1 tile buffer, so each stays reachable), the bridge approach (2 tiles) and the start.
  const NODE_SITES = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (MAP[y][x] !== '.') continue;
    if (near(x, y, 2, (c) => c === 'b' || c === 't')) continue;
    if (near(x, y, 1, (c) => c === '#' || c === 'g' || RUIN_CH[c])) continue;
    if (Math.abs(x - START.x) <= 1 && Math.abs(y - START.y) <= 1) continue;
    NODE_SITES.push({ x, y, zone: ZONES[idx(x, y)] });
  }

  // ── Random ──
  // mulberry32 with an exposed state, so a saved game continues the same sequence.
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.state = () => a >>> 0;
    return next;
  }

  // One draw from the generator kept in the state.
  function rand(s) {
    const R = rng(s.rng);
    const v = R();
    s.rng = R.state();
    return v;
  }

  // ── Nodes ──
  // Scatter nodes by seed. A node never touches another one (8-neighbourhood) and never cuts off
  // walkable ground (checked by flood fill with the bridge open), so every node and every tile stays reachable.
  function scatterNodes(R) {
    const blocked = new Uint8Array(W * H);
    const pass = (x, y) => !blocked[idx(x, y)] && groundWalkable(MAP[y][x], true, true);
    let reach = flood(START, pass).count;
    const nodes = [];
    for (const zone of Object.keys(ZONE_NODES)) {
      const sites = NODE_SITES.filter((t) => t.zone === zone);
      for (let i = sites.length - 1; i > 0; i--) {
        const j = Math.floor(R() * (i + 1));
        [sites[i], sites[j]] = [sites[j], sites[i]];
      }
      let k = 0;
      for (const [kind, count] of Object.entries(ZONE_NODES[zone])) {
        let placed = 0;
        for (; k < sites.length && placed < count; k++) {
          const { x, y } = sites[k];
          if (touchesNode(blocked, x, y)) continue;
          blocked[idx(x, y)] = 1;
          const after = flood(START, pass).count;
          if (after !== reach - 1) { blocked[idx(x, y)] = 0; continue; }
          reach = after;
          nodes.push({ id: nodes.length, kind, x, y, hp: NODE_KINDS[kind].hp, regrowAt: null });
          placed++;
        }
      }
    }
    return nodes;
  }

  function touchesNode(blocked, x, y) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (inMap(x + dx, y + dy) && blocked[idx(x + dx, y + dy)]) return true;
    }
    return false;
  }

  // Tile → node lookup, cached per nodes array (node positions never change).
  const nodeCache = new WeakMap();
  function nodeAt(s, x, y) {
    let m = nodeCache.get(s.nodes);
    if (!m) {
      m = new Map();
      for (const n of s.nodes) m.set(idx(n.x, n.y), n);
      nodeCache.set(s.nodes, m);
    }
    return m.get(idx(x, y)) || null;
  }

  // ── State ──
  const zeroRes = () => Object.fromEntries(RES_IDS.map((r) => [r, 0]));
  const freshPlot = () => ({ stage: 'empty', water: false, grow: 0 });
  const freshBuilt = () => Object.fromEntries(BUILDING_IDS.map((id) => [id, {
    paid: Object.fromEntries(Object.keys(BUILDINGS[id].cost).map((r) => [r, 0])), done: false,
  }]));
  const freshTools = () => Object.fromEntries(Object.entries(TOOLS).map(([id, t]) => [id, t.start]));

  function newGame(seed) {
    if (!Number.isFinite(seed)) seed = Math.floor(Math.random() * 4294967296);
    seed = seed >>> 0;
    const R = rng(seed);
    const nodes = scatterNodes(R);
    // Fruit that is out of season at the start waits for its season.
    for (const n of nodes) {
      const rests = NODE_KINDS[n.kind].rests;
      if (rests && rests.includes(clock(0).season)) { n.hp = 0; n.regrowAt = restEnd(0, rests) + (n.id % 12) * 5; }
    }
    return {
      v: VERSION, seed, rng: R.state(),
      t: 0,
      player: { x: START.x + 0.5, y: START.y + 0.5, target: null, path: null, cd: 0, dir: null },
      events: [],
      res: zeroRes(),
      tools: freshTools(),
      nodes,
      built: freshBuilt(),
      storage: STORAGE[0],
      barnLevel: 0,
      villagers: [],
      acc: {},                      // fractional automatic income per producer, 0..1
      decor: [],
      plots: PLOTS.map(() => freshPlot()),
      orders: [],
      orderSeq: 0,
      bought: [],
      bucket: 0,
      festival: false,
      stats: { gathered: zeroRes(), playTime: 0, orders: 0 },
    };
  }

  const bridgeOpen = (s) => !!(s.built.bridge && s.built.bridge.done);
  const roadOpen = (s) => !!(s.built.road && s.built.road.done);

  // Walkable for the player: in the map, not water, not a ruin or building, not a standing node.
  // The bridge site is water until the bridge is restored.
  function isWalkable(s, x, y) {
    x = Math.floor(x); y = Math.floor(y);
    const c = tileAt(x, y);
    if (c === null || !groundWalkable(c, !!s && bridgeOpen(s), !!s && roadOpen(s))) return false;
    const n = s ? nodeAt(s, x, y) : null;
    return !(n && n.hp > 0);
  }

  function canAfford(s, cost) {
    for (const [r, n] of Object.entries(cost || {})) if (!((s.res[r] || 0) >= n)) return false;
    return true;
  }

  // Take a cost out of the stock; callers check canAfford first.
  function pay(s, cost) {
    for (const [r, n] of Object.entries(cost)) s.res[r] -= n;
  }

  const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

  // ── Pathfinding ──
  // A* on the 4-neighbour grid. isGoal(x, y) ends the search, h(x, y) is an admissible estimate.
  // Returns the tiles from start to goal inclusive, or null when no goal is reachable.
  const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function astar(s, from, isGoal, h) {
    const sx = Math.floor(from.x), sy = Math.floor(from.y);
    if (!inMap(sx, sy)) return null;
    const g = new Float64Array(W * H).fill(Infinity);
    const prev = new Int32Array(W * H).fill(-1);
    const closed = new Uint8Array(W * H);
    // Binary heap of [f, tie, index]; tie keeps the order stable between equal f values.
    const heap = [];
    let tie = 0;
    const push = (f, i) => {
      heap.push([f, tie++, i]);
      for (let k = heap.length - 1; k > 0;) {
        const p = (k - 1) >> 1;
        if (less(heap[p], heap[k])) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
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
    g[start] = 0;
    push(h(sx, sy), start);
    while (heap.length) {
      const i = pop()[2];
      if (closed[i]) continue;
      closed[i] = 1;
      const x = i % W, y = (i - x) / W;
      if (isGoal(x, y)) {
        const path = [];
        for (let k = i; k !== -1; k = prev[k]) path.push({ x: k % W, y: Math.floor(k / W) });
        return path.reverse();
      }
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (!isWalkable(s, nx, ny)) continue;
        const j = idx(nx, ny);
        if (closed[j] || g[i] + 1 >= g[j]) continue;
        g[j] = g[i] + 1;
        prev[j] = i;
        push(g[j] + h(nx, ny), j);
      }
    }
    return null;
  }

  // Shortest walkable path between two tiles (both inclusive), null when unreachable.
  function findPath(s, from, to) {
    const tx = Math.floor(to.x), ty = Math.floor(to.y);
    if (!isWalkable(s, tx, ty)) return null;
    return astar(s, from, (x, y) => x === tx && y === ty, (x, y) => Math.abs(x - tx) + Math.abs(y - ty));
  }

  // Shortest path to any walkable tile next to one of the given tiles (a node or a ruin footprint).
  function pathNextTo(s, from, tiles) {
    const set = new Set(tiles.map((t) => idx(t.x, t.y)));
    const isGoal = (x, y) => DIRS4.some(([dx, dy]) => inMap(x + dx, y + dy) && set.has(idx(x + dx, y + dy)));
    const h = (x, y) => {
      let best = Infinity;
      for (const t of tiles) best = Math.min(best, Math.abs(x - t.x) + Math.abs(y - t.y) - 1);
      return Math.max(0, best);
    };
    return astar(s, from, isGoal, h);
  }

  // ── Movement ──
  const SPEED = 4;         // tiles per second
  const RADIUS = 0.3;      // half-size of the player's collision box
  const MAX_DT = 0.05;     // step() splits longer intervals into chunks of this size (the client's fixed step too)
  const NEAR_NODE = 1.5;   // the player hits a node when its centre is this close to the node's centre

  // The player's box at (x, y) overlaps only walkable tiles.
  function fits(s, x, y) {
    for (const cy of [y - RADIUS, y + RADIUS]) for (const cx of [x - RADIUS, x + RADIUS]) {
      if (!isWalkable(s, cx, cy)) return false;
    }
    return true;
  }

  // The player's box overlaps tile (tx, ty).
  function playerOn(s, tx, ty) {
    const p = s.player;
    return p.x + RADIUS > tx && p.x - RADIUS < tx + 1 && p.y + RADIUS > ty && p.y - RADIUS < ty + 1;
  }

  function clearOrder(p) {
    p.target = null;
    p.path = null;
  }

  // Keyboard movement: a direction held by the player (0, 0 stops). Any non-zero direction cancels an order.
  function moveDir(s, dx, dy) {
    const p = s.player;
    dx = Math.sign(dx) || 0; dy = Math.sign(dy) || 0;
    if (dx || dy) clearOrder(p);
    p.dir = dx || dy ? { x: dx, y: dy } : null;
  }

  // A new order replaces key walking and the previous order.
  function setOrder(p, target, path) {
    p.dir = null;
    p.target = target;
    p.path = path;
  }

  // Walk to a tile along an A* path. Returns false (and keeps the current order) when it can't be reached.
  function goTo(s, x, y) {
    const path = findPath(s, s.player, { x, y });
    if (!path) return false;
    setOrder(s.player, null, path);
    return true;
  }

  const gardenOpen = (s) => s.built.garden.done;
  // The well fills the bucket once both the well and the garden stand; before that it is a ruin like any other.
  const wellPump = (s) => s.built.well.done && gardenOpen(s);

  // Click or tap on a tile: a standing node → walk up and gather; a garden plot → walk up and tend it; the
  // restored well (with a garden) → walk up and fill the bucket; a ruin → walk up (the client opens the panel
  // on the 'ruin' event); a walkable tile → walk there.
  // Returns 'gather' | 'plot' | 'well' | 'ruin' | 'walk' | 'tool' | 'none'.
  function interact(s, x, y) {
    x = Math.floor(x); y = Math.floor(y);
    const p = s.player;
    const pi = plotAt(x, y);
    if (pi >= 0 && gardenOpen(s)) {
      const path = pathNextTo(s, p, [PLOTS[pi]]);
      if (!path) return 'none';
      setOrder(p, { type: 'plot', i: pi }, path);
      return 'plot';
    }
    if (ruinAt(x, y) === 'well' && wellPump(s)) {
      const path = pathNextTo(s, p, FOOTPRINTS.well);
      if (!path) return 'none';
      setOrder(p, { type: 'well' }, path);
      return 'well';
    }
    const n = nodeAt(s, x, y);
    if (n && n.hp > 0) {
      if (!s.tools[NODE_KINDS[n.kind].tool]) return 'tool';
      const path = pathNextTo(s, p, [n]);
      if (!path) return 'none';
      setOrder(p, { type: 'node', id: n.id }, path);
      return 'gather';
    }
    const ruin = pi >= 0 ? 'garden' : ruinAt(x, y);
    if (ruin) {
      const path = pathNextTo(s, p, FOOTPRINTS[ruin]);
      if (!path) return 'none';
      setOrder(p, { type: 'ruin', id: ruin }, path);
      return 'ruin';
    }
    return goTo(s, x, y) ? 'walk' : 'none';
  }

  // Free movement by keys with sliding: each axis is tried on its own, so the player glides along walls.
  function moveFree(s, dt) {
    const p = s.player;
    let { x: dx, y: dy } = p.dir;
    const len = Math.hypot(dx, dy);
    const d = (SPEED * dt) / len;
    dx *= d; dy *= d;
    if (fits(s, p.x + dx, p.y)) p.x += dx;
    if (fits(s, p.x, p.y + dy)) p.y += dy;
  }

  // Follow the path through tile centres. A tile that became blocked (a regrown node) triggers a new path.
  function followPath(s, dt) {
    const p = s.player;
    let left = SPEED * dt;
    let repathed = false;
    while (p.path && p.path.length && left > 0) {
      const w = p.path[0];
      if (!isWalkable(s, w.x, w.y)) {
        if (repathed) { clearOrder(p); break; }
        repathed = true;
        repath(s);
        continue;
      }
      const cx = w.x + 0.5, cy = w.y + 0.5;
      const dist = Math.hypot(cx - p.x, cy - p.y);
      if (dist <= left) {
        p.x = cx; p.y = cy;
        left -= dist;
        p.path.shift();
      } else {
        p.x += ((cx - p.x) / dist) * left;
        p.y += ((cy - p.y) / dist) * left;
        left = 0;
      }
    }
    if (p.path && !p.path.length) p.path = null;
  }

  function repath(s) {
    const p = s.player;
    const t = p.target;
    let path = null;
    if (t && t.type === 'node') path = pathNextTo(s, p, [s.nodes[t.id]]);
    else if (t && t.type === 'ruin') path = pathNextTo(s, p, FOOTPRINTS[t.id]);
    else if (t && t.type === 'plot') path = pathNextTo(s, p, [PLOTS[t.i]]);
    else if (t && t.type === 'well') path = pathNextTo(s, p, FOOTPRINTS.well);
    else if (p.path && p.path.length) path = findPath(s, p, p.path[p.path.length - 1]);
    if (path) p.path = path;
    else clearOrder(p);
  }

  // ── Gathering ──
  function gatherTick(s) {
    const p = s.player;
    const n = s.nodes[p.target.id];
    if (!n || n.hp <= 0) { clearOrder(p); return; }
    if (Math.hypot(n.x + 0.5 - p.x, n.y + 0.5 - p.y) > NEAR_NODE) { repath(s); return; }
    if (p.cd > 0) return;
    const kind = NODE_KINDS[n.kind];
    const level = s.tools[kind.tool];
    if (!level) { clearOrder(p); return; }
    const gain = TOOL_YIELD[level];
    n.hp--;
    s.res[kind.res] += gain;
    s.stats.gathered[kind.res] += gain;
    p.cd = TOOL_CD[level];
    s.events.push({ type: 'hit', kind: n.kind, res: kind.res, gain, id: n.id, x: n.x, y: n.y });
    if (n.hp === 0) {
      const [lo, hi] = kind.regrow;
      n.regrowAt = s.t + lo + rand(s) * (hi - lo);
      noteRegrow(s, n.regrowAt);
      s.events.push({ type: 'deplete', kind: n.kind, id: n.id, x: n.x, y: n.y });
      clearOrder(p);
    }
  }

  // ── Regrowth ──
  // The earliest regrowAt among empty nodes, cached per state object (not saved). step() only scans
  // the nodes when that moment has come, so a normal step costs O(1).
  const regrowCache = new WeakMap();
  const REGROW_RETRY = 2; // seconds to wait when the player stands on an empty node

  function nextRegrow(s) {
    if (!regrowCache.has(s)) {
      let m = Infinity;
      for (const n of s.nodes) if (n.hp <= 0 && n.regrowAt !== null && n.regrowAt < m) m = n.regrowAt;
      regrowCache.set(s, m);
    }
    return regrowCache.get(s);
  }

  function noteRegrow(s, at) {
    if (at < nextRegrow(s)) regrowCache.set(s, at);
  }

  // The first moment after t that falls outside the resting seasons (bushes rest in winter).
  function restEnd(t, rests) {
    const len = DAY * SEASON_DAYS;
    let start = (Math.floor(t / len) + 1) * len;
    for (let k = 0; k < SEASONS.length && rests.includes(clock(start).season); k++) start += len;
    return start;
  }

  function regrow(s) {
    if (nextRegrow(s) > s.t) return;
    let m = Infinity;
    for (const n of s.nodes) {
      if (n.hp > 0 || n.regrowAt === null) continue;
      if (n.regrowAt <= s.t) {
        const rests = NODE_KINDS[n.kind].rests;
        if (rests && rests.includes(clock(s.t).season)) n.regrowAt = restEnd(s.t, rests) + (n.id % 12) * 5;
        else if (playerOn(s, n.x, n.y)) n.regrowAt = s.t + REGROW_RETRY;
        else {
          n.hp = NODE_KINDS[n.kind].hp;
          n.regrowAt = null;
          s.events.push({ type: 'regrow', kind: n.kind, id: n.id, x: n.x, y: n.y });
          continue;
        }
      }
      if (n.regrowAt < m) m = n.regrowAt;
    }
    regrowCache.set(s, m);
  }

  // ── Step ──
  // Advance the world by dt seconds (split into chunks of at most MAX_DT).
  function step(s, dt) {
    if (!(dt > 0)) return;
    while (dt > 1e-9) {
      const h = Math.min(dt, MAX_DT);
      tick(s, h);
      dt -= h;
    }
  }

  // Hooks run once for every dawn and every new season the clock passes, the same way from step() and
  // offline(): `quiet` (offline) keeps the events out and only counts. Each returns nothing.
  function onDawn(s, day, quiet) {
    for (const pl of s.plots) pl.water = false; // the water soaks away overnight
    if (s.built.market.done && s.orders.length < ORDERS.max) postOrder(s, quiet);
    if (!quiet) s.events.push({ type: 'dawn', day });
  }
  function onSeason(s, season, quiet) {
    if (!quiet) s.events.push({ type: 'season', season });
  }
  // Moves s.t forward by dt and runs the hooks for the days crossed; returns how many dawns passed.
  function advanceClock(s, dt, quiet) {
    const before = Math.floor(s.t / DAY);
    s.t += dt;
    const after = Math.floor(s.t / DAY);
    for (let d = before + 1; d <= after; d++) {
      if (d % SEASON_DAYS === 0) onSeason(s, SEASONS[Math.floor(d / SEASON_DAYS) % SEASONS.length], quiet);
      onDawn(s, d, quiet);
    }
    return after - before;
  }

  function tick(s, dt) {
    const p = s.player;
    growPlots(s, dt); // before the clock: water lasts exactly until dawn
    advanceClock(s, dt, false);
    s.stats.playTime += dt;
    p.cd = Math.max(0, (p.cd || 0) - dt);
    regrow(s);
    produce(s, dt);
    if (p.dir) moveFree(s, dt);
    else if (p.path) followPath(s, dt);
    if (!p.path && p.target) {
      if (p.target.type === 'node') gatherTick(s);
      else if (p.target.type === 'ruin') {
        s.events.push({ type: 'ruin', id: p.target.id });
        p.target = null;
      } else if (p.target.type === 'plot') {
        tendPlot(s, p.target.i);
        p.target = null;
      } else if (p.target.type === 'well') {
        fillBucket(s);
        p.target = null;
      }
    }
  }

  // ── Tools ──
  // Returns 'ok' | 'cost' (not enough resources) | 'locked' (needs home/bridge/forge) | 'max' | 'unknown'.
  function upgradeTool(s, tool) {
    const t = TOOLS[tool];
    if (!t) return 'unknown';
    const level = s.tools[tool];
    if (level >= MAX_TOOL) return 'max';
    // Level 0 means the tool hasn't been found yet (the shovel comes with the bridge).
    if (level < 1) return 'locked';
    const next = level + 1;
    const need = TOOL_NEEDS[next];
    if (need && !s.built[need].done) return 'locked';
    const cost = t.costs[next];
    if (!canAfford(s, cost)) return 'cost';
    pay(s, cost);
    s.tools[tool] = next;
    s.events.push({ type: 'tool', tool, level: next });
    return 'ok';
  }

  // ── Restoration ──
  const share = (s, id) => {
    let paid = 0, total = 0;
    for (const [r, n] of Object.entries(BUILDINGS[id].cost)) { paid += s.built[id].paid[r]; total += n; }
    return total ? paid / total : 1;
  };
  const needsMet = (s, id) => BUILDINGS[id].needs.every((d) => s.built[d].done);
  const remaining = (s, id) => {
    const out = {};
    for (const [r, n] of Object.entries(BUILDINGS[id].cost)) {
      const left = n - s.built[id].paid[r];
      if (left > 0) out[r] = left;
    }
    return out;
  };

  // Visual stage of a building: 0 ruin, 1 scaffolding (something paid), 2 restored.
  function stage(s, id) {
    if (!BUILDINGS[id]) return 0;
    if (s.built[id].done) return 2;
    return share(s, id) > 0 ? 1 : 0;
  }

  // Add as much as fits from the stock. Returns 'ok' (paid in part) | 'built' | 'none' (nothing to add)
  // | 'locked' (dependencies) | 'done' | 'unknown'.
  function contribute(s, id) {
    const b = BUILDINGS[id];
    if (!b) return 'unknown';
    const own = s.built[id];
    if (own.done) return 'done';
    if (!needsMet(s, id)) return 'locked';
    const given = {};
    for (const [r, left] of Object.entries(remaining(s, id))) {
      const n = Math.min(left, Math.floor(s.res[r]));
      if (n <= 0) continue;
      s.res[r] -= n;
      own.paid[r] += n;
      given[r] = n;
    }
    const paidNow = Object.keys(given).length > 0;
    if (paidNow) s.events.push({ type: 'contribute', id, given, stage: stage(s, id) });
    // A building may already be fully paid without being done (a loaded save whose dependencies were missing).
    if (Object.keys(remaining(s, id)).length) return paidNow ? 'ok' : 'none';
    own.done = true;
    applyEffect(s, id);
    s.events.push({ type: 'built', id, effect: b.effect });
    // The market opens with a few orders on its board (once, when built; a loaded save keeps its own).
    if (b.effect === 'market') while (s.orders.length < ORDERS.atMarket) postOrder(s, false);
    if (b.effect === 'festival') s.events.push({ type: 'festival' });
    return 'built';
  }

  // Effects that change the state. Others (workbench, sawmill, kiln, forge, mill) are read from s.built.
  function applyEffect(s, id) {
    const b = BUILDINGS[id];
    if (b.effect === 'storage' && s.barnLevel < 1) setBarn(s, 1);
    else if (b.effect === 'bridge' && s.tools.shovel < 1) s.tools.shovel = 1;
    else if (b.effect === 'villager' && !s.villagers.some((v) => v.house === id)) s.villagers.push({ role: b.role, house: id });
    else if (b.effect === 'festival') s.festival = true;
  }

  function setBarn(s, level) {
    s.barnLevel = level;
    s.storage = STORAGE[level];
  }

  // Second barn level. Returns 'ok' | 'locked' (no barn) | 'cost' | 'max'.
  function upgradeBarn(s) {
    if (s.barnLevel >= STORAGE.length - 1) return 'max';
    if (!s.built.barn.done) return 'locked';
    if (!canAfford(s, BARN_UPGRADE)) return 'cost';
    pay(s, BARN_UPGRADE);
    setBarn(s, s.barnLevel + 1);
    s.events.push({ type: 'built', id: 'barn', effect: 'storage', level: s.barnLevel });
    return 'ok';
  }

  // ── Garden ──
  const bucketSize = (s) => (s && s.bought && s.bought.includes('bucket') ? BIG_BUCKET : GARDEN.bucket);

  // One action on a plot, whatever it needs next: sow (a berry; not in winter), water (from the bucket),
  // wait while it grows, or harvest. Returns 'sown' | 'watered' | 'growing' | 'harvest' | 'winter' | 'seed'
  // (no berry to sow) | 'bucket' (the bucket is empty) | 'locked' (no garden) | 'unknown'.
  function tendPlot(s, i) {
    const pl = s.plots[i];
    if (!pl) return 'unknown';
    if (!gardenOpen(s)) return 'locked';
    let result, gain = 0;
    if (pl.stage === 'empty') {
      if (clock(s.t).season === 'winter') result = 'winter';
      else if (!canAfford(s, GARDEN.seed)) result = 'seed';
      else {
        pay(s, GARDEN.seed);
        Object.assign(pl, { stage: 'planted', water: false, grow: 0 });
        result = 'sown';
      }
    } else if (pl.stage === 'planted') {
      if (pl.water) result = 'growing';
      else if (s.bucket <= 0) result = 'bucket';
      else {
        s.bucket--;
        pl.water = true;
        result = 'watered';
      }
    } else {
      gain = GARDEN.harvest[s.tools.basket] || GARDEN.harvest[1];
      s.res.vegetables += gain;
      s.stats.gathered.vegetables += gain;
      Object.assign(pl, freshPlot());
      result = 'harvest';
    }
    s.events.push({ type: 'plot', i, result, gain, x: PLOTS[i].x, y: PLOTS[i].y });
    return result;
  }

  // Fill the bucket at the restored well. Returns 'ok' | 'full' | 'locked'.
  function fillBucket(s) {
    if (!wellPump(s)) return 'locked';
    if (s.bucket >= bucketSize(s)) { s.events.push({ type: 'bucket', n: s.bucket, full: true }); return 'full'; }
    s.bucket = bucketSize(s);
    s.events.push({ type: 'bucket', n: s.bucket });
    return 'ok';
  }

  // Watered plots grow, faster in summer and not at all in winter; a plot that ripens stops needing water.
  // Called before the clock moves: growth counts only up to the next dawn, when the water is gone (seasons
  // also turn at dawn), so any step size gives the same result.
  function growPlots(s, dt) {
    const speed = GARDEN.grow[clock(s.t).season] || 0;
    if (!speed) return;
    dt = Math.min(dt, DAY - (s.t % DAY));
    s.plots.forEach((pl, i) => {
      if (pl.stage !== 'planted' || !pl.water) return;
      pl.grow = Math.min(1, pl.grow + (dt / DAY) * speed);
      if (pl.grow >= 1 - EPS) {
        Object.assign(pl, { stage: 'ripe', water: false, grow: 1 });
        s.events.push({ type: 'ripe', i, x: PLOTS[i].x, y: PLOTS[i].y });
      }
    });
  }

  // ── Orders ──
  // Goods the player can get by now, so every order can be filled: raw goods as their nodes open,
  // products once their workshop or the garden stands, apples once some have been picked.
  function openGoods(s) {
    const out = ['wood', 'stone', 'berries'];
    if (bridgeOpen(s)) out.push('clay');
    if (s.built.sawmill.done) out.push('planks');
    if (s.built.kiln.done) out.push('bricks');
    if (gardenOpen(s)) out.push('vegetables');
    if (s.built.apiary.done) out.push('honey');
    if (s.stats.gathered.apples > 0) out.push('apples');
    return out;
  }

  // A villager posts a new order: one or two goods, a little more or less than usual, paid by their worth.
  function postOrder(s, quiet) {
    const goods = openGoods(s);
    const who = s.villagers.length ? s.villagers[Math.floor(rand(s) * s.villagers.length)].role : 'neighbour';
    const need = {};
    const count = rand(s) < 0.45 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const r = goods[Math.floor(rand(s) * goods.length)];
      const base = ORDER_GOODS[r].n * (0.8 + rand(s) * 0.6);
      need[r] = (need[r] || 0) + (base >= 15 ? Math.round(base / 5) * 5 : Math.max(1, Math.round(base)));
      need[r] = Math.min(need[r], s.storage); // always something the barn can hold
    }
    const value = Object.entries(need).reduce((a, [r, n]) => a + n * ORDER_GOODS[r].worth, 0);
    const order = { id: ++s.orderSeq, who, need, reward: { coins: Math.max(1, Math.round(value / 5)) } };
    s.orders.push(order);
    if (!quiet) s.events.push({ type: 'order-new', id: order.id, who });
    return order;
  }

  // Hand over an order's goods for its coins. Returns 'ok' | 'none' (no such order) | 'cost' (not enough).
  function fulfill(s, id) {
    const i = s.orders.findIndex((o) => o.id === id);
    if (i < 0) return 'none';
    const o = s.orders[i];
    if (!canAfford(s, o.need)) return 'cost';
    pay(s, o.need);
    s.res.coins += o.reward.coins;
    s.orders.splice(i, 1);
    s.stats.orders++;
    s.events.push({ type: 'order', id, who: o.who, coins: o.reward.coins });
    return 'ok';
  }

  // ── Fair ──
  // Open on a season's first day while it is light, once the market rows stand.
  function fairOpen(s) {
    if (!s.built.market.done) return false;
    const c = clock(s.t);
    return c.seasonDay === 0 && (c.part === 'dawn' || c.part === 'day');
  }

  // Buy one thing at the fair. Returns 'ok' | 'closed' | 'coins' (not enough) | 'owned' | 'unknown'.
  function buy(s, id) {
    const item = FAIR[id];
    if (!item) return 'unknown';
    if (s.bought.includes(id)) return 'owned';
    if (!fairOpen(s)) return 'closed';
    if (s.res.coins < item.price) return 'coins';
    s.res.coins -= item.price;
    s.bought.push(id);
    if (id === 'bucket') s.bucket = Math.min(s.bucket, bucketSize(s));
    s.events.push({ type: 'buy', id });
    return 'ok';
  }

  // ── Automatic income ──
  // Fractional progress builds up in s.acc; whole units are added while there is room under the storage limit.
  // A blocked producer keeps at most one unit pending, so it doesn't burst later.
  // EPS absorbs float drift, so many small steps give the same units as one big step (offline).
  const EPS = 1e-6;
  const villagerRate = (s, role) => role.rate * (s.built.mill.done ? MILL_BONUS : 1);
  const hasRoom = (s, r) => s.res[r] < s.storage;
  const hasRaw = (s, w) => s.res[w.from] - w.ratio >= WORKSHOP_RESERVE;

  function produce(s, dt) {
    for (const v of s.villagers) {
      const role = VILLAGERS[v.role];
      if (!role) continue;
      const key = v.house;
      let a = (s.acc[key] || 0) + villagerRate(s, role) * dt;
      while (a >= 1 - EPS && hasRoom(s, role.res)) { s.res[role.res] += 1; a -= 1; }
      s.acc[key] = clamp01(a);
    }
    const season = clock(s.t).season;
    for (const [id, pr] of Object.entries(PRODUCERS)) {
      if (!s.built[id].done || pr.rests.includes(season)) continue;
      let a = (s.acc[id] || 0) + pr.rate * dt;
      while (a >= 1 - EPS && hasRoom(s, pr.res)) { s.res[pr.res] += 1; a -= 1; }
      s.acc[id] = clamp01(a);
    }
    for (const [id, w] of Object.entries(WORKSHOPS)) {
      if (!s.built[id].done) continue;
      let a = (s.acc[id] || 0) + w.rate * dt;
      while (a >= 1 - EPS && hasRaw(s, w) && hasRoom(s, w.to)) {
        s.res[w.from] -= w.ratio;
        s.res[w.to] += 1;
        a -= 1;
      }
      s.acc[id] = clamp01(a);
    }
  }

  // Automatic income right now, per second, by the same rules as produce(). `full` lists resources whose
  // producers are stopped by the storage limit. Used by the HUD.
  function rates(s) {
    const rate = {};
    const full = new Set();
    const add = (r, v) => { rate[r] = (rate[r] || 0) + v; };
    for (const v of s.villagers) {
      const role = VILLAGERS[v.role];
      if (!role) continue;
      if (hasRoom(s, role.res)) add(role.res, villagerRate(s, role));
      else full.add(role.res);
    }
    const season = clock(s.t).season;
    for (const [id, pr] of Object.entries(PRODUCERS)) {
      if (!s.built[id].done || pr.rests.includes(season)) continue;
      if (hasRoom(s, pr.res)) add(pr.res, pr.rate);
      else full.add(pr.res);
    }
    for (const [id, w] of Object.entries(WORKSHOPS)) {
      if (!s.built[id].done) continue;
      if (!hasRoom(s, w.to)) { full.add(w.to); continue; }
      if (!hasRaw(s, w)) continue;
      add(w.to, w.rate);
      add(w.from, -w.rate * w.ratio);
    }
    return { rate, full: [...full] };
  }

  // Time away from the game: villagers and workshops work in 1 s steps (capped at 8 h), empty nodes regrow.
  // The player doesn't move. Returns a summary for the "while you were away" window.
  function offline(s, seconds) {
    const total = Math.floor(Math.min(Math.max(Number(seconds) || 0, 0), OFFLINE_MAX));
    const before = { ...s.res };
    let days = 0;
    const mark = s.events.length;
    for (let i = 0; i < total; i++) {
      growPlots(s, 1);
      days += advanceClock(s, 1, true);
      produce(s, 1);
      regrow(s); // every second, so a node due before a resting season regrows just as step() would
    }
    regrow(s);
    const regrown = s.events.filter((e, i) => i >= mark && e.type === 'regrow').length;
    s.events.length = mark; // a summary instead of a burst of regrow events
    const gains = {};
    for (const r of RES_IDS) if (s.res[r] !== before[r]) gains[r] = s.res[r] - before[r];
    return { seconds: total, gains, regrown, days };
  }

  // The hint in the HUD: the cheapest available restoration (by what is left to pay), or the tool that blocks it.
  // After the festival: decorations. Returns { type: 'build', id } | { type: 'tool', tool } | { type: 'decor' } | null.
  // A building that still needs planks or bricks is skipped until their workshop works, so the hint never
  // points at something that can't be paid yet.
  const PRODUCT_OF = Object.fromEntries(Object.entries(WORKSHOPS).map(([id, w]) => [w.to, id]));
  function nextGoal(s) {
    const stage = s.festival ? 'festival' : undefined; // before the festival only the village, after it the hamlet
    let best = null, bestLeft = Infinity;
    for (const id of BUILDING_IDS) {
      if (BUILDINGS[id].after !== stage || s.built[id].done || !needsMet(s, id)) continue;
      const rest = remaining(s, id);
      if (Object.keys(rest).some((r) => PRODUCT_OF[r] && !s.built[PRODUCT_OF[r]].done && s.res[r] < rest[r])) continue;
      const left = Object.values(rest).reduce((a, n) => a + n, 0);
      if (left < bestLeft) { best = id; bestLeft = left; }
    }
    if (!best) return s.festival ? { type: 'decor' } : null;
    for (const r of Object.keys(remaining(s, best))) {
      for (const [tool, t] of Object.entries(TOOLS)) {
        if (NODE_KINDS[t.node].res === r && s.tools[tool] < 1) return { type: 'tool', tool };
      }
    }
    return { type: 'build', id: best };
  }

  // Free play: a decoration on a free square tile. Returns 'ok' | 'locked' (before the festival, or a fair
  // decoration not bought yet) | 'cost'
  // | 'occupied' (not a free square tile) | 'unknown'.
  function placeDecor(s, kind, x, y) {
    const d = DECOR[kind];
    if (!d) return 'unknown';
    if (!s.festival || (d.fair && !s.bought.includes(kind))) return 'locked';
    x = Math.floor(x); y = Math.floor(y);
    if (tileAt(x, y) !== '#' || s.decor.some((o) => o.x === x && o.y === y)) return 'occupied';
    if (!canAfford(s, d.cost)) return 'cost';
    pay(s, d.cost);
    s.decor.push({ kind, x, y });
    s.events.push({ type: 'decor', kind, x, y });
    return 'ok';
  }

  // ── Save / load ──
  const TRANSIENT_PLAYER = ['target', 'path', 'cd', 'dir'];

  // Plain JSON object without transient fields (events, the player's order and cooldown).
  function save(s) {
    const out = JSON.parse(JSON.stringify(s));
    delete out.events;
    delete out.recovered;
    for (const k of TRANSIENT_PLAYER) delete out.player[k];
    return out;
  }

  const num = (v, def, min = 0, max = Infinity) => (Number.isFinite(v) && v >= min && v <= max ? v : def);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  // why: true for junk or a foreign save, 'old' for a save of an earlier version of the game.
  function recovered(why = true) {
    const s = newGame();
    s.recovered = why;
    return s;
  }

  // Accepts an object or a JSON string. Fills missing fields with defaults and drops junk.
  // A broken or foreign save gives a new game with recovered: true, a save of an earlier version one with
  // recovered: 'old'; load never throws.
  function load(data) {
    try {
      if (typeof data === 'string') data = JSON.parse(data);
      if (!isObj(data) || !Number.isFinite(data.seed)) return recovered();
      if (data.v === 2) data = { ...data, v: VERSION }; // same state; restore() re-lays the nodes for the new map
      if (Number.isInteger(data.v) && data.v >= 1 && data.v < VERSION) return recovered('old');
      if (data.v !== VERSION) return recovered();
      return restore(data);
    } catch (e) {
      return recovered();
    }
  }

  function restore(d) {
    const s = newGame(d.seed);
    s.rng = Number.isFinite(d.rng) ? d.rng >>> 0 : s.rng;
    s.t = num(d.t, 0);

    if (isObj(d.res)) for (const r of RES_IDS) s.res[r] = num(d.res[r], 0);

    if (isObj(d.tools)) {
      for (const id of Object.keys(TOOLS)) {
        if (Number.isInteger(d.tools[id])) s.tools[id] = num(d.tools[id], s.tools[id], 0, MAX_TOOL);
      }
    }

    // Node layout comes from the seed; only hp and regrowth are taken from the save.
    if (Array.isArray(d.nodes)) {
      for (const n of d.nodes) {
        if (!isObj(n)) continue;
        const own = s.nodes[n.id];
        if (!own || own.kind !== n.kind || own.x !== n.x || own.y !== n.y) continue;
        if (Number.isInteger(n.hp) && n.hp >= 0 && n.hp <= NODE_KINDS[own.kind].hp) own.hp = n.hp;
        // An empty node comes back no later than its longest regrowth from now (for fruit: from its season).
        const kind = NODE_KINDS[own.kind];
        const latest = (kind.rests ? restEnd(s.t, kind.rests) : s.t) + kind.regrow[1];
        own.regrowAt = Number.isFinite(n.regrowAt) ? Math.min(n.regrowAt, latest) : null;
        if (own.hp > 0) own.regrowAt = null;
        else if (own.regrowAt === null) own.regrowAt = s.t;
      }
    }

    if (isObj(d.built)) {
      for (const id of BUILDING_IDS) {
        const b = d.built[id];
        if (!isObj(b)) continue;
        const own = s.built[id];
        own.done = b.done === true;
        for (const [r, need] of Object.entries(BUILDINGS[id].cost)) {
          const v = num(isObj(b.paid) ? b.paid[r] : 0, 0);
          own.paid[r] = own.done ? need : Math.min(v, need);
        }
      }
      // A done building needs its dependencies done. BUILDING_IDS lists dependencies first, so one pass is
      // enough. Such a building stays fully paid and is finished by the next contribute once its needs are met.
      for (const id of BUILDING_IDS) if (s.built[id].done && !needsMet(s, id)) s.built[id].done = false;
    }

    // The saved position counts only where the player fits (not water, not a standing node, not off the map).
    if (isObj(d.player) && Number.isFinite(d.player.x) && Number.isFinite(d.player.y) && fits(s, d.player.x, d.player.y)) {
      s.player.x = d.player.x;
      s.player.y = d.player.y;
    }

    s.barnLevel = Number.isInteger(d.barnLevel) ? num(d.barnLevel, 0, 0, STORAGE.length - 1) : 0;
    if (s.barnLevel > 0 && !s.built.barn.done) s.barnLevel = 0;

    if (Array.isArray(d.villagers)) {
      s.villagers = d.villagers
        .filter((v) => isObj(v) && BUILDINGS[v.house] && BUILDINGS[v.house].role === v.role && s.built[v.house].done)
        .filter((v, i, all) => all.findIndex((o) => o.house === v.house) === i)
        .map((v) => ({ role: v.role, house: v.house }));
    }

    if (isObj(d.acc)) {
      for (const [k, v] of Object.entries(d.acc)) {
        if ((BUILDINGS[k] && (BUILDINGS[k].role || WORKSHOPS[k] || PRODUCERS[k])) && Number.isFinite(v)) s.acc[k] = clamp01(v);
      }
    }

    // The same rules as placeDecor: square tiles only, one decoration per tile.
    if (Array.isArray(d.decor)) {
      s.decor = d.decor
        .filter((o) => isObj(o) && DECOR[o.kind] && Number.isInteger(o.x) && Number.isInteger(o.y) && tileAt(o.x, o.y) === '#')
        .filter((o, i, all) => all.findIndex((q) => q.x === o.x && q.y === o.y) === i)
        .map((o) => ({ kind: o.kind, x: o.x, y: o.y }));
    }

    if (Array.isArray(d.plots) && d.plots.length === PLOTS.length) {
      s.plots = d.plots.map((pl) => {
        if (!isObj(pl) || !['empty', 'planted', 'ripe'].includes(pl.stage)) return freshPlot();
        if (pl.stage === 'empty') return freshPlot();
        if (pl.stage === 'ripe') return { stage: 'ripe', water: false, grow: 1 };
        return { stage: 'planted', water: pl.water === true, grow: Math.min(num(pl.grow, 0), 0.999) };
      });
    }
    if (Array.isArray(d.bought)) s.bought = [...new Set(d.bought.filter((id) => typeof id === 'string' && FAIR[id]))];
    s.bucket = Number.isInteger(d.bucket) ? num(d.bucket, 0, 0, bucketSize(s)) : 0;

    // Orders: known goods in whole positive amounts, at most ORDERS.max, ids unique and below the counter.
    s.orderSeq = Number.isInteger(d.orderSeq) ? num(d.orderSeq, 0) : 0;
    if (Array.isArray(d.orders)) {
      s.orders = d.orders.filter((o) => isObj(o) && Number.isInteger(o.id) && o.id > 0 && o.id <= s.orderSeq
        && isObj(o.need) && Object.keys(o.need).length > 0
        && Object.entries(o.need).every(([r, n]) => ORDER_GOODS[r] && Number.isInteger(n) && n > 0 && n < 1000)
        && isObj(o.reward) && Number.isInteger(o.reward.coins) && o.reward.coins > 0)
        .filter((o, i, all) => all.findIndex((q) => q.id === o.id) === i)
        .slice(0, ORDERS.max)
        .map((o) => ({ id: o.id, who: typeof o.who === 'string' ? o.who : 'neighbour', need: { ...o.need }, reward: { coins: o.reward.coins } }));
    }

    // Effects of done buildings, in case the save lost them. The festival comes from the chapel, not the save.
    for (const id of BUILDING_IDS) if (s.built[id].done) applyEffect(s, id);
    s.storage = STORAGE[s.barnLevel];

    if (isObj(d.stats)) {
      if (isObj(d.stats.gathered)) for (const r of RES_IDS) s.stats.gathered[r] = num(d.stats.gathered[r], 0);
      s.stats.playTime = num(d.stats.playTime, 0);
      s.stats.orders = Number.isInteger(d.stats.orders) ? num(d.stats.orders, 0) : 0;
    }
    return s;
  }

  const api = {
    VERSION, DAY, DAWN_END, DUSK_START, NIGHT_START, SEASON_DAYS, SEASONS, clock, RESOURCES, NODE_KINDS, TOOLS, TOOL_NEEDS, TOOL_YIELD, TOOL_CD, MAX_TOOL,
    BUILDINGS, BARN_UPGRADE, STORAGE, WORKSHOP_RESERVE, ZONE_NODES, VILLAGERS, MILL_BONUS, WORKSHOPS, PRODUCERS,
    OFFLINE_MAX, DECOR, RES_IDS, BUILDING_IDS, MAX_DT,
    MAP, W, H, START, FOOTPRINTS, SPEED, HAMLET_X, FAIR, BIG_BUCKET, fairOpen, buy, ORDERS, ORDER_GOODS, openGoods, fulfill, GARDEN, PLOTS, plotAt, tendPlot, fillBucket, bucketSize,
    rng, rand, tileAt, zoneAt, nodeAt, ruinAt, newGame, isWalkable, canAfford, findPath,
    step, moveDir, goTo, interact, upgradeTool, contribute, upgradeBarn, share, remaining, stage, rates, nextGoal, offline,
    placeDecor, save, load,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Village = api;
})(typeof window !== 'undefined' ? window : globalThis);
