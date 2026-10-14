// Родник — pure rules for the village restoration game. No DOM here, so the same file runs
// in the browser and in Node (tests and the balance bot).
// Coordinates: tiles are integers, the player moves in continuous tile units (tile centre = x + 0.5).
(function (root) {
  'use strict';

  const VERSION = 1;

  // ── Constants ──
  const RESOURCES = {
    wood: { name: 'Дерево' },
    stone: { name: 'Камень' },
    clay: { name: 'Глина' },
    berries: { name: 'Ягоды' },
    planks: { name: 'Доски' },
    bricks: { name: 'Кирпич' },
  };
  const RES_IDS = Object.keys(RESOURCES);

  // hp = hits until the node is empty; regrow = [min, max] seconds until it comes back.
  const NODE_KINDS = {
    tree: { name: 'Дерево', res: 'wood', hp: 5, tool: 'axe', regrow: [90, 180] },
    rock: { name: 'Камень', res: 'stone', hp: 6, tool: 'pick', regrow: [90, 180] },
    clay: { name: 'Глиняная яма', res: 'clay', hp: 4, tool: 'shovel', regrow: [90, 180] },
    bush: { name: 'Ягодный куст', res: 'berries', hp: 3, tool: 'basket', regrow: [90, 180] },
  };

  // Level 2 needs the workbench (home), level 3 needs the forge. The shovel starts at 0 and comes with the bridge.
  const TOOLS = {
    axe: { name: 'Топор', node: 'tree', start: 1, costs: { 2: { stone: 15, wood: 10 }, 3: { bricks: 10, planks: 20 } } },
    pick: { name: 'Кирка', node: 'rock', start: 1, costs: { 2: { wood: 20, stone: 10 }, 3: { bricks: 10, planks: 20 } } },
    shovel: { name: 'Лопата', node: 'clay', start: 0, costs: { 2: { wood: 20 }, 3: { bricks: 8, planks: 15 } } },
    basket: { name: 'Корзина', node: 'bush', start: 1, costs: { 2: { wood: 15 }, 3: { planks: 15 } } },
  };
  const TOOL_NEEDS = { 2: 'home', 3: 'forge' };
  const TOOL_YIELD = [0, 1, 2, 3];       // per hit, by tool level
  const TOOL_CD = [0.6, 0.6, 0.5, 0.4];  // seconds between hits, by tool level
  const MAX_TOOL = 3;

  // ch is the ruin footprint character in MAP. Effects are applied when a building is done.
  const BUILDINGS = {
    well: { id: 'well', ch: 'W', name: 'Колодец', cost: { stone: 20, wood: 10 }, needs: [], effect: 'square' },
    home: { id: 'home', ch: 'H', name: 'Твой дом', cost: { wood: 40, stone: 20 }, needs: [], effect: 'workbench' },
    barn: { id: 'barn', ch: 'A', name: 'Амбар', cost: { wood: 60, stone: 30 }, needs: ['well'], effect: 'storage' },
    bridge: { id: 'bridge', ch: 'b', name: 'Мост', cost: { wood: 80, stone: 40 }, needs: ['home'], effect: 'bridge' },
    sawmill: { id: 'sawmill', ch: 'S', name: 'Лесопилка', cost: { wood: 100, stone: 50 }, needs: ['bridge'], effect: 'sawmill' },
    kiln: { id: 'kiln', ch: 'K', name: 'Печь для обжига', cost: { stone: 60, clay: 60 }, needs: ['bridge'], effect: 'kiln' },
    house1: { id: 'house1', ch: '1', name: 'Дом лесоруба', cost: { planks: 60, bricks: 20 }, needs: ['sawmill', 'kiln'], effect: 'villager', role: 'woodcutter' },
    house2: { id: 'house2', ch: '2', name: 'Дом каменщика', cost: { planks: 60, bricks: 30 }, needs: ['house1'], effect: 'villager', role: 'mason' },
    forge: { id: 'forge', ch: 'F', name: 'Кузница', cost: { bricks: 80, planks: 40, stone: 60 }, needs: ['kiln'], effect: 'forge' },
    mill: { id: 'mill', ch: 'M', name: 'Мельница', cost: { planks: 120, bricks: 40 }, needs: ['house2'], effect: 'mill' },
    house3: { id: 'house3', ch: '3', name: 'Дом гончара', cost: { planks: 80, bricks: 40, berries: 40 }, needs: ['mill'], effect: 'villager', role: 'potter' },
    chapel: {
      id: 'chapel', ch: 'C', name: 'Часовня с колоколом', cost: { planks: 200, bricks: 150, stone: 150, berries: 60 },
      needs: ['well', 'home', 'barn', 'bridge', 'sawmill', 'kiln', 'house1', 'house2', 'forge', 'mill', 'house3'], effect: 'festival',
    },
  };
  const BUILDING_IDS = Object.keys(BUILDINGS);
  const BARN_UPGRADE = { planks: 100, bricks: 40 };
  const STORAGE = [50, 150, 400]; // start, after the barn, after the barn upgrade
  const WORKSHOP_RESERVE = 30;

  // Nodes scattered per zone. West is open from the start, north and east open with the bridge.
  const ZONE_NODES = {
    west: { tree: 22, rock: 10, bush: 10 },
    north: { tree: 18, bush: 8, rock: 2 },
    east: { rock: 14, clay: 12, tree: 4, bush: 3 },
  };

  // ── Map ──
  // .  grass       ~  water      :  sand (river bank)   =  path   #  square
  // b  bridge site (water until the bridge is restored)
  // W H A S K 1 2 3 F M C  ruin footprints (see BUILDINGS[].ch)
  const MAP = [
    '................................................',
    '.......:::::....................................',
    '.......:~~~:....................................',
    '.......:~~~:....................................',
    '.......:::::....................................',
    '................................................',
    '................................................',
    ':::::::::::..........:::::::::::::..............',
    '~~~~~~~~~~::::::::::::~~~~~~~~~~~:..............',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~:..............',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~:..............',
    '::::::::::~~~~~~~~~~~~::::::::~~~:..............',
    '.........:::::::=::::::MM....:~~~:..............',
    '................=======MM....:~~~:..............',
    '................=............:~~~:..............',
    '................=............:~~~:..............',
    '................=............:~~~:..............',
    '............AAA.=............:~~~:..............',
    '............AAA.=............:~~~:..............',
    '................=............:~~~:..............',
    '............########.........:bbb:..............',
    '........HH..########==========bbb=========......',
    '........HH..###WW###.....SSS.:~~~:..KK..........',
    '...=========###WW###.....SSS.:~~~:..KK..........',
    '.....11..22.########.........:~~~:..............',
    '.....11..22.########........::~~~:..............',
    '...............=............:~~~::..............',
    '............FF.=.33.........:~~~:...............',
    '............FF.=.33.........:~~~:...............',
    '...............=............:~~~:...............',
    '...............=............:~~~:...............',
    '..............CCC...........:~~~:...............',
    '..............CCC...........:~~~:...............',
    '..............CCC...........:~~~:...............',
    '............................:~~~:...............',
    '............................:~~~:...............',
  ];
  const W = MAP[0].length;
  const H = MAP.length;
  const START = { x: 13, y: 24 }; // a square tile next to the well

  const RUIN_CH = {};
  for (const b of Object.values(BUILDINGS)) RUIN_CH[b.ch] = b.id;

  const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const tileAt = (x, y) => (inMap(x, y) ? MAP[y][x] : null);
  const idx = (x, y) => y * W + x;
  // Base terrain walkability, ignoring nodes; the bridge site counts only when open.
  const groundWalkable = (c, bridgeOpen) =>
    c === '.' || c === ':' || c === '=' || c === '#' || (c === 'b' && bridgeOpen);

  // Tiles of each ruin footprint, keyed by building id.
  const FOOTPRINTS = {};
  for (const id of BUILDING_IDS) FOOTPRINTS[id] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const id = RUIN_CH[MAP[y][x]];
    if (id) FOOTPRINTS[id].push({ x, y });
  }

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

  // Zones: land reachable from the start without the bridge is west; the rest is north (above the river) or east.
  const ZONES = new Array(W * H).fill(null);
  {
    const west = flood(START, (x, y) => groundWalkable(MAP[y][x], false)).seen;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = MAP[y][x];
      if (c === '~' || c === 'b') continue;
      ZONES[idx(x, y)] = west[idx(x, y)] ? 'west' : y < 8 ? 'north' : 'east';
    }
  }
  const zoneAt = (x, y) => (inMap(x, y) ? ZONES[idx(x, y)] : null);

  // Chebyshev distance from (x, y) to the nearest tile matching pred.
  function nearDist(x, y, r, pred) {
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
    if (nearDist(x, y, 2, (c) => c === 'b')) continue;
    if (nearDist(x, y, 1, (c) => c === '#' || RUIN_CH[c])) continue;
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
    const pass = (x, y) => !blocked[idx(x, y)] && groundWalkable(MAP[y][x], true);
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
  const freshBuilt = () => Object.fromEntries(BUILDING_IDS.map((id) => [id, {
    paid: Object.fromEntries(Object.keys(BUILDINGS[id].cost).map((r) => [r, 0])), done: false,
  }]));
  const freshTools = () => Object.fromEntries(Object.entries(TOOLS).map(([id, t]) => [id, t.start]));

  function newGame(seed) {
    if (!Number.isFinite(seed)) seed = Math.floor(Math.random() * 4294967296);
    seed = seed >>> 0;
    const R = rng(seed);
    const nodes = scatterNodes(R);
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
      decor: [],
      festival: false,
      stats: { gathered: zeroRes(), playTime: 0 },
    };
  }

  const bridgeOpen = (s) => !!(s.built.bridge && s.built.bridge.done);

  // Walkable for the player: in the map, not water, not a ruin or building, not a standing node.
  // The bridge site is water until the bridge is restored.
  function isWalkable(s, x, y) {
    x = Math.floor(x); y = Math.floor(y);
    const c = tileAt(x, y);
    if (c === null || !groundWalkable(c, !!s && bridgeOpen(s))) return false;
    const n = s ? nodeAt(s, x, y) : null;
    return !(n && n.hp > 0);
  }

  function canAfford(s, cost) {
    for (const [r, n] of Object.entries(cost || {})) if (!((s.res[r] || 0) >= n)) return false;
    return true;
  }

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
  const MAX_DT = 0.05;     // step() splits longer intervals into chunks of this size
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

  // Walk to a tile along an A* path. Returns false (and keeps the current order) when it can't be reached.
  function goTo(s, x, y) {
    const p = s.player;
    const path = findPath(s, p, { x, y });
    if (!path) return false;
    clearOrder(p);
    p.dir = null;
    p.path = path;
    return true;
  }

  // Click or tap on a tile: a standing node → walk up and gather; a ruin → walk up (the client opens the panel
  // on the 'ruin' event); a walkable tile → walk there. Returns 'gather' | 'ruin' | 'walk' | 'tool' | 'none'.
  function interact(s, x, y) {
    x = Math.floor(x); y = Math.floor(y);
    const p = s.player;
    const n = nodeAt(s, x, y);
    if (n && n.hp > 0) {
      if (!s.tools[NODE_KINDS[n.kind].tool]) return 'tool';
      const path = pathNextTo(s, p, [n]);
      if (!path) return 'none';
      clearOrder(p);
      p.dir = null;
      p.target = { type: 'node', id: n.id };
      p.path = path;
      return 'gather';
    }
    const ruin = RUIN_CH[tileAt(x, y)];
    if (ruin) {
      const path = pathNextTo(s, p, FOOTPRINTS[ruin]);
      if (!path) return 'none';
      clearOrder(p);
      p.dir = null;
      p.target = { type: 'ruin', id: ruin };
      p.path = path;
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

  function regrow(s) {
    if (nextRegrow(s) > s.t) return;
    let m = Infinity;
    for (const n of s.nodes) {
      if (n.hp > 0 || n.regrowAt === null) continue;
      if (n.regrowAt <= s.t) {
        if (playerOn(s, n.x, n.y)) n.regrowAt = s.t + REGROW_RETRY;
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

  function tick(s, dt) {
    const p = s.player;
    s.t += dt;
    s.stats.playTime += dt;
    p.cd = Math.max(0, (p.cd || 0) - dt);
    regrow(s);
    if (p.dir) moveFree(s, dt);
    else if (p.path) followPath(s, dt);
    if (!p.path && p.target) {
      if (p.target.type === 'node') gatherTick(s);
      else if (p.target.type === 'ruin') {
        s.events.push({ type: 'ruin', id: p.target.id });
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
    for (const [r, n] of Object.entries(cost)) s.res[r] -= n;
    s.tools[tool] = next;
    s.events.push({ type: 'tool', tool, level: next });
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

  function recovered() {
    const s = newGame();
    s.recovered = true;
    return s;
  }

  // Accepts an object or a JSON string. Fills missing fields with defaults and drops junk.
  // A broken or foreign save gives a new game with recovered: true; load never throws.
  function load(data) {
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { return recovered(); }
    }
    if (!isObj(data) || data.v !== VERSION || !Number.isFinite(data.seed)) return recovered();
    try {
      return restore(data);
    } catch (e) {
      return recovered();
    }
  }

  function restore(d) {
    const s = newGame(d.seed);
    s.rng = Number.isFinite(d.rng) ? d.rng >>> 0 : s.rng;
    s.t = num(d.t, 0);

    if (isObj(d.player)) {
      const px = num(d.player.x, null, 0, W), py = num(d.player.y, null, 0, H);
      if (px !== null && py !== null) { s.player.x = px; s.player.y = py; }
      for (const [k, v] of Object.entries(d.player)) {
        if (!(k in s.player) && !TRANSIENT_PLAYER.includes(k)) s.player[k] = v;
      }
    }

    if (isObj(d.res)) for (const r of RES_IDS) s.res[r] = num(d.res[r], 0);

    if (isObj(d.tools)) {
      for (const id of Object.keys(TOOLS)) {
        const l = d.tools[id];
        if (Number.isInteger(l) && l >= 0 && l <= MAX_TOOL) s.tools[id] = l;
      }
    }

    // Node layout comes from the seed; only hp and regrowth are taken from the save.
    if (Array.isArray(d.nodes)) {
      for (const n of d.nodes) {
        if (!isObj(n)) continue;
        const own = s.nodes[n.id];
        if (!own || own.kind !== n.kind || own.x !== n.x || own.y !== n.y) continue;
        if (Number.isInteger(n.hp) && n.hp >= 0 && n.hp <= NODE_KINDS[own.kind].hp) own.hp = n.hp;
        own.regrowAt = Number.isFinite(n.regrowAt) ? n.regrowAt : null;
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
    }

    s.barnLevel = Number.isInteger(d.barnLevel) && d.barnLevel >= 0 && d.barnLevel < STORAGE.length ? d.barnLevel : 0;
    if (s.barnLevel > 0 && !s.built.barn.done) s.barnLevel = 0;
    s.storage = STORAGE[s.barnLevel];

    if (Array.isArray(d.villagers)) {
      const roles = new Set(BUILDING_IDS.map((id) => BUILDINGS[id].role).filter(Boolean));
      s.villagers = d.villagers
        .filter((v) => isObj(v) && roles.has(v.role) && BUILDINGS[v.house] && BUILDINGS[v.house].role === v.role)
        .map((v) => ({ role: v.role, house: v.house }));
    }

    if (Array.isArray(d.decor)) {
      s.decor = d.decor
        .filter((o) => isObj(o) && typeof o.kind === 'string' && Number.isInteger(o.x) && Number.isInteger(o.y) && inMap(o.x, o.y))
        .map((o) => ({ kind: o.kind, x: o.x, y: o.y }));
    }

    s.festival = d.festival === true;

    if (isObj(d.stats)) {
      if (isObj(d.stats.gathered)) for (const r of RES_IDS) s.stats.gathered[r] = num(d.stats.gathered[r], 0);
      s.stats.playTime = num(d.stats.playTime, 0);
    }
    return s;
  }

  const api = {
    VERSION, RESOURCES, NODE_KINDS, TOOLS, TOOL_NEEDS, TOOL_YIELD, TOOL_CD, MAX_TOOL,
    BUILDINGS, BARN_UPGRADE, STORAGE, WORKSHOP_RESERVE, ZONE_NODES,
    MAP, W, H, START, FOOTPRINTS, SPEED,
    rng, rand, tileAt, zoneAt, nodeAt, newGame, isWalkable, canAfford, findPath,
    step, moveDir, goTo, interact, upgradeTool, save, load,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Village = api;
})(typeof window !== 'undefined' ? window : globalThis);
