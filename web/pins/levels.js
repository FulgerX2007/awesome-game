// Тяни штифт — the 42 levels in three chapters. A level is written compactly as the chambers carved out of solid rock
// plus pins, fills and entities; make() turns it into the definition PinsCore.buildLevel() takes, with the walls
// as rectangles covering everything that is not carved. Every level is checked by the solver in the tests.
(function (root) {
  'use strict';

  const Core = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.PinsCore;
  const { W, H, handleCell } = Core;
  const HERO_W = 3, HERO_H = 5;

  // Walls = the complement of the carved cells, as rectangles: runs of rock per row, merged downwards
  // while the same run repeats in the next row.
  function rock(carved) {
    const open = new Uint8Array(W * H);
    for (const r of carved) {
      for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++) {
        for (let x = Math.max(0, r.x); x < Math.min(W, r.x + r.w); x++) open[y * W + x] = 1;
      }
    }
    const walls = [];
    let active = new Map(); // "x0,x1" → rect still growing downwards
    for (let y = 0; y < H; y++) {
      const next = new Map();
      for (let x = 0; x < W;) {
        if (open[y * W + x]) { x++; continue; }
        let e = x;
        while (e < W && !open[y * W + e]) e++;
        const key = x + ',' + e;
        const r = active.get(key);
        if (r) { r.h++; next.set(key, r); } else {
          const nr = { x, y, w: e - x, h: 1 };
          walls.push(nr);
          next.set(key, nr);
        }
        x = e;
      }
      active = next;
    }
    return walls;
  }

  const rect = (a) => ({ x: a[0], y: a[1], w: a[2], h: a[3] });

  // Compact form → buildLevel definition (pins are numbered 1..n, so keys 1–5 can pull them):
  //   open:    [[x, y, w, h]]                       chambers (everything else is rock)
  //   pins:    [[id, x, y, w, h, handle]]           pins are carved too, and so is the cell of each handle
  //                                                (a pocket in the rock, so pulling a pin opens nothing else)
  //   fills:   [[type, x, y, w, h]]                type: gold, water, lava, gas or bomb (a powder keg)
  //   hero:    [x, y], enemies: [[x, y]]            3×5 boxes, (x, y) is the top-left cell
  //   room:    [x, y, w, h], exit: [x, y]           the exit door is 3×5 too
  function make(src) {
    const pins = (src.pins || []).map(([id, x, y, w, h, handle]) => ({ id, x, y, w, h, handle }));
    const carved = (src.open || []).map(rect);
    for (const p of pins) {
      carved.push(p);
      const c = handleCell(p);
      carved.push({ x: c.x, y: c.y, w: 1, h: 1 });
    }
    return {
      walls: rock(carved),
      pins,
      fills: (src.fills || []).map(([type, x, y, w, h]) => ({ type, x, y, w, h })),
      hero: { x: src.hero[0], y: src.hero[1], w: HERO_W, h: HERO_H },
      enemies: (src.enemies || []).map(([x, y]) => ({ x, y, w: HERO_W, h: HERO_H })),
      room: rect(src.room),
      exit: { x: src.exit[0], y: src.exit[1], w: HERO_W, h: HERO_H },
      goldTarget: src.goldTarget,
    };
  }

  const SRC = [
    // 1. Gold: the left half of the floor drops the gold to the hero, the right half wastes it.
    {
      open: [[8, 18, 20, 14], [2, 33, 16, 20], [19, 33, 12, 20]],
      pins: [[1, 8, 32, 10, 1, 'left'], [2, 18, 32, 10, 1, 'right']],
      fills: [['gold', 8, 24, 20, 8]],
      hero: [3, 48], room: [2, 33, 16, 20], exit: [14, 48], goldTarget: 77,
    },
    // 2. Water: it is harmless, gold sinks through it.
    {
      open: [[8, 16, 20, 16], [5, 33, 12, 20], [18, 33, 16, 20]],
      pins: [[1, 8, 32, 10, 1, 'left'], [2, 18, 32, 10, 1, 'right']],
      fills: [['gold', 8, 26, 20, 6], ['water', 8, 20, 20, 6]],
      hero: [30, 48], room: [18, 33, 16, 20], exit: [19, 48], goldTarget: 54,
    },
    // 3. Lava: it burns gold. Drop the gold before the lava gets to it.
    {
      open: [[10, 6, 14, 12], [10, 19, 14, 12], [2, 32, 32, 21]],
      pins: [[1, 10, 31, 14, 1, 'right'], [2, 10, 18, 14, 1, 'left']],
      fills: [['lava', 10, 12, 14, 6], ['gold', 10, 23, 14, 8]],
      hero: [3, 48], room: [2, 32, 32, 21], exit: [30, 48], goldTarget: 60,
    },
    // 4. Enemy: burn it with lava before the gold opens the way to the hero.
    {
      open: [[3, 14, 14, 18], [17, 14, 3, 3], [20, 14, 12, 18], [20, 3, 12, 10], [2, 33, 16, 20]],
      pins: [[1, 20, 13, 12, 1, 'right'], [2, 3, 32, 14, 1, 'left']],
      fills: [['gold', 3, 24, 14, 8], ['lava', 20, 7, 12, 6]],
      hero: [3, 48], enemies: [[24, 27]], room: [2, 33, 16, 20], exit: [14, 48], goldTarget: 70,
    },
    // 5. Water + lava = stone: turn the lava to stone before the long pin drops the gold.
    {
      open: [[3, 14, 10, 18], [15, 22, 10, 10], [15, 8, 10, 13], [2, 33, 24, 20]],
      pins: [[1, 15, 21, 10, 1, 'right'], [2, 3, 32, 22, 1, 'left']],
      fills: [['gold', 3, 24, 10, 8], ['lava', 15, 31, 10, 1], ['water', 15, 12, 10, 9]],
      hero: [21, 48], room: [2, 33, 24, 20], exit: [3, 48], goldTarget: 50,
    },
    // 6. Two gold tanks, both needed; the lava over the right one must stay shut.
    {
      open: [[3, 16, 8, 16], [14, 22, 8, 10], [14, 8, 8, 13], [2, 33, 22, 20]],
      pins: [[1, 3, 32, 8, 1, 'left'], [2, 14, 32, 8, 1, 'right'], [3, 14, 21, 8, 1, 'right']],
      fills: [['gold', 3, 25, 8, 7], ['gold', 14, 25, 8, 7], ['lava', 14, 15, 8, 6]],
      hero: [19, 48], room: [2, 33, 22, 20], exit: [3, 48], goldTarget: 74,
    },
    // 7. A door to the enemy: leave it shut, or burn the enemy first and keep the door shut anyway.
    {
      open: [[3, 14, 14, 18], [2, 33, 16, 20], [18, 48, 3, 5], [21, 30, 11, 23], [21, 14, 11, 15]],
      pins: [[1, 3, 32, 14, 1, 'left'], [2, 21, 29, 11, 1, 'right'], [3, 19, 48, 1, 5, 'top']],
      fills: [['gold', 3, 24, 14, 8], ['lava', 21, 22, 11, 7]],
      hero: [12, 48], enemies: [[26, 48]], room: [2, 33, 16, 20], exit: [3, 48], goldTarget: 70,
    },
    // 8. Gold in two steps; the middle chamber is open to the enemy.
    {
      open: [[4, 4, 12, 12], [4, 17, 12, 14], [16, 17, 3, 3], [19, 17, 12, 14], [19, 4, 12, 12], [2, 32, 20, 21]],
      pins: [[1, 4, 16, 12, 1, 'left'], [2, 4, 31, 12, 1, 'left'], [3, 19, 16, 12, 1, 'right']],
      fills: [['gold', 4, 8, 12, 8], ['lava', 19, 10, 12, 6]],
      hero: [16, 48], enemies: [[23, 26]], room: [2, 32, 20, 21], exit: [3, 48], goldTarget: 64,
    },
    // 9. Cool the lava and burn the enemy, in any order, before the long pin.
    {
      open: [[2, 14, 5, 18], [7, 14, 1, 3], [8, 14, 8, 18], [2, 3, 5, 10], [18, 22, 8, 10], [18, 8, 8, 13],
        [2, 33, 26, 20]],
      pins: [[1, 2, 13, 5, 1, 'left'], [2, 18, 21, 8, 1, 'right'], [3, 8, 32, 18, 1, 'left']],
      fills: [['gold', 8, 24, 8, 8], ['lava', 2, 7, 5, 6], ['lava', 18, 31, 8, 1], ['water', 18, 11, 8, 10]],
      hero: [21, 48], enemies: [[3, 27]], room: [2, 33, 26, 20], exit: [3, 48], goldTarget: 42,
    },
    // 10. Two enemies under one long lava pin. Never open the floor of their chamber.
    {
      open: [[2, 17, 7, 15], [9, 17, 2, 3], [11, 17, 7, 15], [18, 17, 2, 3], [20, 17, 7, 15],
        [11, 3, 7, 13], [20, 3, 7, 13], [2, 33, 16, 20]],
      pins: [[1, 2, 32, 7, 1, 'left'], [2, 11, 16, 16, 1, 'right'], [3, 11, 32, 7, 1, 'right']],
      fills: [['gold', 2, 23, 7, 9], ['lava', 11, 9, 7, 7], ['lava', 20, 9, 7, 7]],
      hero: [13, 48], enemies: [[13, 27], [22, 27]], room: [2, 33, 16, 20], exit: [3, 48], goldTarget: 40,
    },
    // 11. Cool the lava, and keep all the gold: the left half of its floor drops into a pit.
    {
      open: [[3, 14, 12, 18], [2, 33, 6, 20], [9, 33, 24, 20], [24, 22, 9, 10], [24, 6, 9, 15]],
      pins: [[1, 3, 32, 5, 1, 'left'], [2, 8, 32, 25, 1, 'right'], [3, 24, 21, 9, 1, 'left']],
      fills: [['gold', 3, 22, 12, 10], ['lava', 24, 31, 9, 1], ['water', 24, 10, 9, 11]],
      hero: [27, 48], room: [9, 33, 24, 20], exit: [10, 48], goldTarget: 73,
    },
    // 12. Gold in two steps, with lava waiting above it.
    {
      open: [[12, 2, 10, 8], [12, 11, 10, 10], [12, 22, 10, 10], [2, 33, 32, 20]],
      pins: [[1, 12, 21, 10, 1, 'left'], [2, 12, 32, 10, 1, 'right'], [3, 12, 10, 10, 1, 'right']],
      fills: [['lava', 12, 5, 10, 5], ['gold', 12, 14, 10, 7]],
      hero: [3, 48], room: [2, 33, 32, 20], exit: [30, 48], goldTarget: 45,
    },
    // 13. Two enemies, two lava tanks, and a floor that must stay shut.
    {
      open: [[13, 12, 10, 20], [3, 12, 7, 20], [10, 12, 3, 3], [3, 2, 7, 9], [26, 12, 7, 20], [23, 12, 3, 3],
        [26, 2, 7, 9], [2, 33, 32, 20]],
      pins: [[1, 3, 11, 7, 1, 'left'], [2, 26, 11, 7, 1, 'right'], [3, 13, 32, 10, 1, 'left'],
        [4, 3, 32, 7, 1, 'left']],
      fills: [['gold', 13, 23, 10, 9], ['lava', 3, 5, 7, 6], ['lava', 26, 5, 7, 6]],
      hero: [16, 48], enemies: [[5, 27], [28, 27]], room: [2, 33, 32, 20], exit: [30, 48], goldTarget: 60,
    },
    // 14. Burn the enemy, cool the lava with all the water (half of its floor drains into a pit), then the long pin.
    {
      open: [[2, 14, 5, 18], [7, 14, 1, 3], [8, 14, 8, 18], [2, 3, 5, 10], [18, 4, 14, 10], [18, 15, 8, 17],
        [27, 15, 5, 17], [2, 33, 30, 20]],
      pins: [[1, 2, 13, 5, 1, 'left'], [2, 18, 14, 8, 1, 'left'], [3, 8, 32, 18, 1, 'left'],
        [4, 26, 14, 6, 1, 'right']],
      fills: [['gold', 8, 22, 8, 10], ['lava', 2, 7, 5, 6], ['lava', 18, 31, 8, 1], ['water', 18, 11, 14, 3]],
      hero: [21, 48], enemies: [[3, 27]], room: [2, 33, 30, 20], exit: [3, 48], goldTarget: 50,
    },
    // 15. Gold in two steps past the enemy's chamber; its floor is a trap.
    {
      open: [[4, 3, 10, 10], [4, 14, 10, 14], [14, 14, 3, 3], [17, 14, 10, 14], [17, 3, 10, 10], [2, 29, 20, 24]],
      pins: [[1, 4, 13, 10, 1, 'left'], [2, 4, 28, 10, 1, 'right'], [3, 17, 13, 10, 1, 'right'],
        [4, 17, 28, 10, 1, 'right']],
      fills: [['gold', 4, 6, 10, 7], ['lava', 17, 7, 10, 6]],
      hero: [3, 48], enemies: [[20, 23]], room: [2, 29, 20, 24], exit: [17, 48], goldTarget: 45,
    },
    // 16. Two gold tanks: one under lava that must stay shut, one on a long pin with a lava strip to cool.
    {
      open: [[2, 16, 7, 16], [2, 3, 7, 12], [11, 16, 7, 16], [20, 22, 8, 10], [20, 6, 8, 15], [2, 33, 28, 20]],
      pins: [[1, 2, 32, 7, 1, 'left'], [2, 2, 15, 7, 1, 'left'], [3, 20, 21, 8, 1, 'right'],
        [4, 11, 32, 17, 1, 'right']],
      fills: [['gold', 2, 24, 7, 8], ['lava', 2, 9, 7, 6], ['gold', 11, 24, 7, 8], ['lava', 20, 31, 8, 1],
        ['water', 20, 10, 8, 11]],
      hero: [23, 48], room: [2, 33, 28, 20], exit: [3, 48], goldTarget: 70,
    },
    // 17. Two enemies under one lava pin, a lava strip to cool, and a trap floor.
    {
      open: [[2, 22, 7, 10], [2, 6, 7, 15], [11, 12, 8, 20], [19, 12, 2, 3], [21, 12, 6, 20], [27, 12, 2, 3],
        [29, 12, 6, 20], [21, 2, 6, 9], [29, 2, 6, 9], [2, 33, 33, 20]],
      pins: [[1, 2, 21, 7, 1, 'left'], [2, 2, 32, 17, 1, 'left'], [3, 21, 11, 14, 1, 'right'],
        [4, 29, 32, 6, 1, 'right']],
      fills: [['lava', 2, 31, 7, 1], ['water', 2, 9, 7, 12], ['gold', 11, 22, 8, 10], ['lava', 21, 5, 6, 6],
        ['lava', 29, 5, 6, 6]],
      hero: [4, 48], enemies: [[22, 27], [30, 27]], room: [2, 33, 33, 20], exit: [30, 48], goldTarget: 50,
    },
    // 18. Two gold tanks, both needed; the enemy is open to the left one, lava waits over the right one.
    {
      open: [[2, 12, 6, 20], [8, 12, 2, 3], [2, 2, 6, 9], [10, 12, 8, 20], [20, 17, 8, 15], [20, 4, 8, 12],
        [2, 33, 28, 20]],
      pins: [[1, 2, 11, 6, 1, 'left'], [2, 10, 32, 8, 1, 'left'], [3, 20, 32, 8, 1, 'right'],
        [4, 20, 16, 8, 1, 'right']],
      fills: [['lava', 2, 5, 6, 6], ['gold', 10, 25, 8, 7], ['gold', 20, 25, 8, 7], ['lava', 20, 10, 8, 6]],
      hero: [23, 48], enemies: [[3, 27]], room: [2, 33, 28, 20], exit: [3, 48], goldTarget: 74,
    },
    // 19. One enemy is open to the gold, the other waits behind a door.
    {
      open: [[2, 12, 6, 20], [8, 12, 2, 3], [2, 2, 6, 9], [10, 12, 10, 20], [2, 33, 20, 20], [22, 48, 3, 5],
        [25, 30, 10, 23], [25, 14, 10, 15]],
      pins: [[1, 2, 11, 6, 1, 'left'], [2, 25, 29, 10, 1, 'right'], [3, 10, 32, 10, 1, 'left'],
        [4, 23, 48, 1, 5, 'top']],
      fills: [['lava', 2, 5, 6, 6], ['gold', 10, 24, 10, 8], ['lava', 25, 22, 10, 7]],
      hero: [17, 48], enemies: [[3, 27], [29, 48]], room: [2, 33, 20, 20], exit: [3, 48], goldTarget: 50,
    },
    // 20. Two lava strips beside the gold under one long pin; the water above them has a floor in two halves.
    {
      open: [[2, 2, 32, 6], [2, 9, 8, 23], [12, 9, 12, 23], [26, 9, 8, 23], [2, 33, 32, 20]],
      pins: [[1, 2, 8, 16, 1, 'left'], [2, 18, 8, 16, 1, 'right'], [3, 2, 32, 32, 1, 'left']],
      fills: [['water', 2, 3, 32, 5], ['lava', 2, 31, 8, 1], ['gold', 12, 22, 12, 10], ['lava', 26, 31, 8, 1]],
      hero: [5, 48], room: [2, 33, 32, 20], exit: [29, 48], goldTarget: 80,
    },
    // 21. Gold in two steps past the enemy, then the long pin with a lava strip to cool.
    {
      open: [[2, 13, 5, 19], [2, 2, 5, 10], [7, 13, 2, 3], [9, 2, 10, 10], [9, 13, 10, 19], [22, 22, 9, 10],
        [22, 6, 9, 15], [2, 33, 30, 20]],
      pins: [[1, 9, 12, 10, 1, 'right'], [2, 2, 12, 5, 1, 'left'], [3, 22, 21, 9, 1, 'right'],
        [4, 9, 32, 22, 1, 'left']],
      fills: [['gold', 9, 5, 10, 7], ['lava', 2, 6, 5, 6], ['lava', 22, 31, 9, 1], ['water', 22, 10, 9, 11]],
      hero: [25, 48], enemies: [[3, 27]], room: [2, 33, 30, 20], exit: [3, 48], goldTarget: 46,
    },
    // 22. The left half of the floor wastes gold, lava waits above it, the enemy is open to it.
    {
      open: [[16, 12, 14, 20], [13, 33, 9, 20], [23, 33, 12, 20], [30, 12, 2, 3], [32, 12, 3, 20], [32, 2, 3, 9],
        [16, 2, 14, 9]],
      pins: [[1, 16, 32, 6, 1, 'left'], [2, 22, 32, 8, 1, 'right'], [3, 32, 11, 3, 1, 'right'],
        [4, 16, 11, 14, 1, 'left']],
      fills: [['gold', 16, 22, 14, 10], ['lava', 32, 5, 3, 6], ['lava', 16, 6, 14, 5]],
      hero: [31, 48], enemies: [[32, 27]], room: [23, 33, 12, 20], exit: [24, 48], goldTarget: 80,
    },
    // 23. Water over the enemy would shield it from lava. Save the water for the lava strip.
    {
      open: [[2, 16, 10, 16], [2, 2, 4, 13], [7, 4, 5, 11], [12, 16, 3, 3], [15, 16, 8, 16], [25, 22, 8, 10],
        [25, 6, 8, 15], [2, 33, 32, 20]],
      pins: [[1, 2, 15, 4, 1, 'left'], [2, 7, 15, 5, 1, 'left'], [3, 25, 21, 8, 1, 'right'],
        [4, 15, 32, 18, 1, 'left']],
      fills: [['water', 2, 3, 4, 12], ['lava', 7, 9, 5, 6], ['gold', 15, 23, 8, 9], ['lava', 25, 31, 8, 1],
        ['water', 25, 10, 8, 11]],
      hero: [28, 48], enemies: [[5, 27]], room: [2, 33, 32, 20], exit: [3, 48], goldTarget: 48,
    },
    // 24. Gold in two steps past the enemy, a lava strip to cool, and the enemy's floor is a trap.
    {
      open: [[2, 13, 5, 19], [2, 2, 5, 10], [7, 13, 2, 3], [9, 2, 10, 10], [9, 13, 10, 19], [22, 22, 9, 10],
        [22, 6, 9, 15], [2, 33, 30, 20]],
      pins: [[1, 9, 12, 10, 1, 'right'], [2, 2, 12, 5, 1, 'left'], [3, 22, 21, 9, 1, 'right'],
        [4, 9, 32, 22, 1, 'left'], [5, 2, 32, 5, 1, 'left']],
      fills: [['gold', 9, 5, 10, 7], ['lava', 2, 6, 5, 6], ['lava', 22, 31, 9, 1], ['water', 22, 10, 9, 11]],
      hero: [25, 48], enemies: [[3, 27]], room: [2, 33, 30, 20], exit: [12, 48], goldTarget: 46,
    },
    // 25. Water would shield the enemy at the gold; the other enemy waits behind a door.
    {
      open: [[2, 16, 10, 16], [2, 2, 4, 13], [7, 4, 5, 11], [12, 16, 3, 3], [15, 16, 8, 16], [2, 33, 22, 20],
        [24, 48, 3, 5], [27, 30, 8, 23], [27, 14, 8, 15]],
      pins: [[1, 2, 15, 4, 1, 'left'], [2, 7, 15, 5, 1, 'left'], [3, 15, 32, 8, 1, 'left'],
        [4, 27, 29, 8, 1, 'right'], [5, 25, 48, 1, 5, 'top']],
      fills: [['water', 2, 3, 4, 12], ['lava', 7, 9, 5, 6], ['gold', 15, 23, 8, 9], ['lava', 27, 21, 8, 8]],
      hero: [19, 48], enemies: [[5, 27], [30, 48]], room: [2, 33, 22, 20], exit: [3, 48], goldTarget: 45,
    },
    // 26. Two gold tanks: one on a long pin with a lava strip, one open to the enemy and under lava.
    {
      open: [[2, 22, 7, 10], [2, 6, 7, 15], [11, 14, 7, 18], [20, 17, 7, 15], [20, 4, 7, 12], [27, 17, 2, 3],
        [29, 17, 6, 15], [29, 4, 6, 12], [2, 33, 30, 20]],
      pins: [[1, 2, 21, 7, 1, 'left'], [2, 2, 32, 16, 1, 'left'], [3, 20, 32, 7, 1, 'right'],
        [4, 20, 16, 7, 1, 'left'], [5, 29, 16, 6, 1, 'right']],
      fills: [['lava', 2, 31, 7, 1], ['water', 2, 9, 7, 12], ['gold', 11, 24, 7, 8], ['gold', 20, 24, 7, 8],
        ['lava', 20, 10, 7, 6], ['lava', 29, 10, 6, 6]],
      hero: [4, 48], enemies: [[30, 27]], room: [2, 33, 30, 20], exit: [27, 48], goldTarget: 74,
    },
    // 27. Enemies on both sides of the gold; water over the left one is a trap, so is the floor of the right one.
    {
      open: [[2, 16, 10, 16], [2, 2, 4, 13], [7, 4, 5, 11], [12, 16, 3, 3], [15, 12, 8, 20], [23, 12, 3, 3],
        [26, 12, 8, 20], [26, 2, 8, 9], [2, 33, 32, 20]],
      pins: [[1, 2, 15, 4, 1, 'left'], [2, 7, 15, 5, 1, 'left'], [3, 15, 32, 8, 1, 'left'],
        [4, 26, 11, 8, 1, 'right'], [5, 26, 32, 8, 1, 'right']],
      fills: [['water', 2, 3, 4, 12], ['lava', 7, 9, 5, 6], ['gold', 15, 23, 8, 9], ['lava', 26, 5, 8, 6]],
      hero: [17, 48], enemies: [[5, 27], [29, 27]], room: [2, 33, 32, 20], exit: [3, 48], goldTarget: 48,
    },
    // 28. Gold in two steps: half of its floor wastes it into a pit; lava above it, a lava strip below it.
    {
      open: [[4, 1, 14, 2], [4, 4, 14, 10], [4, 15, 6, 17], [11, 15, 7, 17], [20, 20, 8, 12], [20, 4, 8, 15],
        [2, 33, 30, 20]],
      pins: [[1, 10, 14, 8, 1, 'right'], [2, 4, 14, 6, 1, 'left'], [3, 20, 19, 8, 1, 'right'],
        [4, 11, 32, 17, 1, 'left'], [5, 4, 3, 14, 1, 'left']],
      fills: [['lava', 4, 1, 14, 2], ['gold', 4, 7, 14, 7], ['lava', 20, 31, 8, 1], ['water', 20, 8, 8, 11]],
      hero: [22, 48], room: [2, 33, 30, 20], exit: [3, 48], goldTarget: 50,
    },
    // 29. Two lava strips with a water tank each, an enemy at the gold and lava above the gold.
    {
      open: [[2, 14, 6, 18], [2, 3, 6, 10], [8, 14, 2, 3], [10, 14, 8, 18], [10, 3, 8, 10], [20, 22, 6, 10],
        [20, 8, 6, 13], [28, 22, 6, 10], [28, 8, 6, 13], [2, 33, 32, 20]],
      pins: [[1, 20, 21, 6, 1, 'left'], [2, 28, 21, 6, 1, 'right'], [3, 2, 13, 6, 1, 'left'],
        [4, 10, 32, 24, 1, 'left'], [5, 10, 13, 8, 1, 'right']],
      fills: [['lava', 2, 7, 6, 6], ['gold', 10, 23, 8, 9], ['lava', 10, 8, 8, 5], ['lava', 20, 31, 6, 1],
        ['water', 20, 11, 6, 10], ['lava', 28, 31, 6, 1], ['water', 28, 11, 6, 10]],
      hero: [29, 48], enemies: [[3, 27]], room: [2, 33, 32, 20], exit: [3, 48], goldTarget: 48,
    },
    // 30. Everything at once: gold in two steps past the enemy, a water trap, a lava strip, the long pin.
    {
      open: [[2, 16, 8, 16], [2, 2, 3, 13], [6, 4, 4, 11], [10, 16, 2, 3], [12, 2, 8, 12], [12, 15, 8, 17],
        [23, 22, 9, 10], [23, 6, 9, 15], [2, 33, 32, 20]],
      pins: [[1, 2, 15, 3, 1, 'left'], [2, 6, 15, 4, 1, 'left'], [3, 12, 14, 8, 1, 'right'],
        [4, 23, 21, 9, 1, 'right'], [5, 12, 32, 20, 1, 'left']],
      fills: [['water', 2, 3, 3, 12], ['lava', 6, 9, 4, 6], ['gold', 12, 6, 8, 8], ['lava', 23, 31, 9, 1],
        ['water', 23, 10, 9, 11]],
      hero: [26, 48], enemies: [[4, 27]], room: [2, 33, 32, 20], exit: [3, 48], goldTarget: 42,
    },
    // 31. Gas rises: let it up beside the enemy, then drop the gold.
    {
      open: [[3, 14, 14, 18], [17, 19, 3, 3], [20, 16, 9, 6], [23, 23, 6, 7], [2, 33, 16, 20]],
      pins: [[1, 23, 22, 6, 1, 'right'], [2, 3, 32, 14, 1, 'left']],
      fills: [['gold', 3, 24, 14, 8], ['gas', 23, 25, 6, 5]],
      hero: [3, 48], enemies: [[20, 17]], room: [2, 33, 16, 20], exit: [14, 48], goldTarget: 70,
    },
    // 32. Gas bubbles up through water: open the water tank from either side, then drop the gold.
    {
      open: [[3, 14, 14, 18], [17, 19, 3, 3], [20, 16, 9, 6], [23, 23, 6, 3], [23, 27, 6, 4], [2, 33, 16, 20]],
      pins: [[1, 23, 22, 6, 1, 'right'], [2, 23, 26, 6, 1, 'right'], [3, 3, 32, 14, 1, 'left']],
      fills: [['gold', 3, 24, 14, 8], ['water', 23, 23, 6, 3], ['gas', 23, 27, 6, 4]],
      hero: [3, 48], enemies: [[20, 17]], room: [2, 33, 16, 20], exit: [14, 48], goldTarget: 70,
    },
    // 33. A low corridor: gas let into it reaches the hero's head. Gas belongs to the enemy.
    {
      open: [[6, 20, 10, 14], [16, 22, 3, 3], [19, 20, 9, 6], [22, 27, 6, 6], [6, 35, 10, 12], [2, 47, 26, 6],
        [29, 47, 5, 6]],
      pins: [[1, 22, 26, 6, 1, 'right'], [2, 6, 34, 10, 1, 'left'], [3, 28, 47, 1, 6, 'top']],
      fills: [['gold', 6, 26, 10, 8], ['gas', 22, 28, 6, 5], ['gas', 29, 47, 5, 3]],
      hero: [22, 48], enemies: [[19, 21]], room: [2, 47, 26, 6], exit: [3, 48], goldTarget: 40,
    },
    // 34. Lava would burn the enemy and then the gold next door; gas from below kills it cleanly.
    {
      open: [[3, 14, 14, 18], [17, 26, 3, 3], [20, 20, 9, 9], [20, 12, 9, 7], [23, 30, 6, 3], [2, 33, 16, 20]],
      pins: [[1, 20, 19, 9, 1, 'right'], [2, 23, 29, 6, 1, 'right'], [3, 3, 32, 14, 1, 'left']],
      fills: [['gold', 3, 24, 14, 8], ['lava', 20, 15, 9, 4], ['gas', 23, 30, 6, 3]],
      hero: [3, 48], enemies: [[20, 24]], room: [2, 33, 16, 20], exit: [14, 48], goldTarget: 70,
    },
    // 35. Two enemies, a gas tank under each; the third gas tank opens into the corridor.
    {
      open: [[13, 18, 10, 15], [13, 34, 10, 13], [2, 47, 27, 6], [30, 47, 4, 6],
        [4, 20, 6, 6], [10, 22, 3, 3], [7, 27, 3, 5], [26, 20, 6, 6], [23, 22, 3, 3], [26, 27, 3, 5]],
      pins: [[1, 7, 26, 3, 1, 'right'], [2, 26, 26, 3, 1, 'left'], [3, 13, 33, 10, 1, 'left'],
        [4, 29, 47, 1, 6, 'top']],
      fills: [['gold', 13, 25, 10, 8], ['gas', 30, 47, 4, 3], ['gas', 7, 27, 3, 5], ['gas', 26, 27, 3, 5]],
      hero: [24, 48], enemies: [[4, 21], [29, 21]], room: [2, 47, 27, 6], exit: [2, 48], goldTarget: 40,
    },
    // 36. Gas for the enemy, water for the lava strip on the long pin; lava over the gold stays shut.
    {
      open: [[3, 14, 10, 18], [3, 6, 10, 7], [15, 24, 10, 8], [15, 10, 10, 13], [25, 9, 2, 3], [27, 8, 7, 6],
        [30, 15, 4, 5], [2, 33, 30, 20]],
      pins: [[1, 30, 14, 4, 1, 'right'], [2, 15, 23, 10, 1, 'right'], [3, 3, 32, 22, 1, 'left'],
        [4, 3, 13, 10, 1, 'left']],
      fills: [['gold', 3, 24, 10, 8], ['lava', 3, 9, 10, 4], ['lava', 15, 31, 10, 1], ['water', 15, 13, 10, 10],
        ['gas', 30, 15, 4, 5]],
      hero: [27, 48], enemies: [[27, 9]], room: [2, 33, 30, 20], exit: [3, 48], goldTarget: 45,
    },
    // 37. A keg under the gold: lava sets it off and the blast opens the gold chamber. Water would spoil it.
    {
      open: [[8, 14, 8, 10], [9, 24, 7, 1], [10, 25, 6, 1], [11, 26, 5, 1], [12, 27, 4, 1], [13, 28, 3, 3],
        [17, 4, 2, 29], [20, 14, 9, 8], [2, 34, 30, 19]],
      pins: [[1, 17, 10, 2, 1, 'left'], [2, 19, 18, 1, 4, 'top']],
      fills: [['gold', 8, 16, 8, 8], ['lava', 17, 5, 2, 3], ['bomb', 17, 31, 2, 2], ['water', 20, 18, 9, 4]],
      hero: [26, 48], room: [2, 34, 30, 19], exit: [29, 48], goldTarget: 36,
    },
    // 38. Two kegs: one blows up the enemy, the other one hangs over the hero.
    {
      open: [[13, 20, 10, 12], [13, 33, 10, 14], [2, 47, 30, 6], [23, 21, 3, 3], [26, 20, 7, 8], [27, 14, 2, 5],
        [3, 36, 2, 4], [3, 41, 2, 5]],
      pins: [[1, 27, 19, 2, 1, 'right'], [2, 3, 40, 2, 1, 'right'], [3, 13, 32, 10, 1, 'right']],
      fills: [['gold', 13, 24, 10, 8], ['lava', 27, 16, 2, 3], ['bomb', 27, 20, 2, 2], ['lava', 3, 37, 2, 3],
        ['bomb', 3, 44, 2, 2]],
      hero: [3, 48], enemies: [[29, 23]], room: [2, 47, 30, 6], exit: [28, 48], goldTarget: 40,
    },
    // 39. A chain of kegs runs from the shaft to the sealed gold chamber. Water spoils the fuse, lava over the gold
    //     burns it.
    {
      open: [[3, 14, 9, 10], [4, 24, 7, 1], [5, 25, 5, 1], [6, 26, 3, 3], [30, 4, 2, 24], [24, 10, 5, 6],
        [3, 6, 9, 7], [2, 34, 32, 19],
        [6, 30, 2, 2], [11, 30, 2, 2], [16, 30, 2, 2], [21, 30, 2, 2], [26, 30, 2, 2], [30, 28, 2, 2]],
      pins: [[1, 30, 8, 2, 1, 'left'], [2, 29, 12, 1, 4, 'top'], [3, 3, 13, 9, 1, 'right']],
      fills: [['gold', 3, 16, 9, 8], ['lava', 30, 5, 2, 3], ['water', 24, 12, 5, 4], ['lava', 3, 9, 9, 4],
        ['bomb', 6, 30, 2, 2], ['bomb', 11, 30, 2, 2], ['bomb', 16, 30, 2, 2], ['bomb', 21, 30, 2, 2],
        ['bomb', 26, 30, 2, 2], ['bomb', 30, 28, 2, 2]],
      hero: [28, 48], room: [2, 34, 32, 19], exit: [3, 48], goldTarget: 30,
    },
    // 40. Lava for the left enemy, a keg for the right one; the right chamber's floor is a trap while it lives.
    {
      open: [[12, 14, 12, 18], [3, 14, 6, 18], [9, 14, 3, 3], [3, 4, 6, 9], [27, 14, 6, 8], [24, 14, 3, 3],
        [27, 9, 2, 4], [27, 23, 6, 10], [2, 33, 32, 20]],
      pins: [[1, 3, 13, 6, 1, 'left'], [2, 27, 13, 2, 1, 'right'], [3, 27, 22, 6, 1, 'right'],
        [4, 12, 32, 12, 1, 'left']],
      fills: [['gold', 12, 24, 12, 8], ['lava', 3, 8, 6, 5], ['lava', 27, 10, 2, 3], ['bomb', 27, 15, 2, 2]],
      hero: [16, 48], enemies: [[3, 27], [30, 17]], room: [2, 33, 32, 20], exit: [30, 48], goldTarget: 60,
    },
    // 41. Gas for the enemy over the gold, then the keg; water in the shaft spoils it.
    {
      open: [[8, 14, 8, 10], [9, 24, 7, 1], [10, 25, 6, 1], [11, 26, 5, 1], [12, 27, 4, 1], [13, 28, 3, 3],
        [3, 6, 13, 7], [12, 13, 3, 1], [3, 14, 4, 6], [17, 4, 2, 29], [20, 14, 9, 8], [2, 34, 30, 19]],
      pins: [[1, 3, 13, 4, 1, 'left'], [2, 17, 10, 2, 1, 'right'], [3, 19, 18, 1, 4, 'top']],
      fills: [['gold', 8, 16, 8, 8], ['gas', 3, 15, 4, 5], ['lava', 17, 5, 2, 3], ['bomb', 17, 31, 2, 2],
        ['water', 20, 18, 9, 4]],
      hero: [27, 48], enemies: [[7, 8]], room: [2, 34, 30, 19], exit: [3, 48], goldTarget: 36,
    },
    // 42. Everything at once: a keg for the enemy over the gold, gas for the other one, water for the lava strip
    //     on the long pin — and a drain that wastes the water.
    {
      open: [[3, 14, 10, 18], [3, 4, 10, 8], [5, 12, 2, 2], [4, 1, 2, 2], [15, 24, 10, 8], [15, 10, 10, 13],
        [25, 9, 2, 3], [27, 8, 7, 6], [30, 15, 4, 3], [26, 19, 8, 13], [2, 33, 30, 20]],
      pins: [[1, 30, 14, 4, 1, 'right'], [2, 15, 23, 10, 1, 'left'], [3, 4, 3, 2, 1, 'left'], [4, 3, 32, 22, 1, 'left'],
        [5, 25, 19, 1, 4, 'top']],
      fills: [['gold', 3, 24, 10, 8], ['lava', 4, 1, 2, 2], ['bomb', 4, 4, 2, 2], ['lava', 15, 31, 10, 1],
        ['water', 15, 17, 10, 6], ['gas', 30, 15, 4, 3]],
      hero: [27, 48], enemies: [[8, 7], [27, 9]], room: [2, 33, 30, 20], exit: [3, 48], goldTarget: 45,
    },
  ];

  const LEVELS = SRC.map(make);

  // Chapters of the level select: the first level (0-based) of each and its title (a Russian source string).
  const CHAPTERS = [
    { from: 0, title: 'Подземелье' },
    { from: 30, title: 'Ядовитый газ' },
    { from: 36, title: 'Пороховые бочки' },
  ];

  const api = { LEVELS, SRC, CHAPTERS, make, rock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PinsLevels = api;
})(typeof window !== 'undefined' ? window : globalThis);
