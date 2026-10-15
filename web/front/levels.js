// Рубеж — the 12 levels. Each map character is 4 m: '.' ground, '_' chasm, 'T' forest (wood), 'S' quarry (stone),
// 'M' mine (metal), '#' a build plot. The keep stands on the first two cells, the enemy fortress on the last two.
// waves: when (game seconds) and which enemies leave the fortress; after the last one, patrols keep coming.
// par: the time for the third star. Every level adds one idea (see `idea`, checked by tests/front/levels.test.js).
(function (root) {
  'use strict';
  const LEVELS = [
    {
      name: 'Опушка', idea: 'basics',
      map: '..#T#T#S.M.#.........',
      start: { wood: 120, stone: 60, metal: 60 }, fortressHp: 200, towers: 0, par: 120,
      waves: [{ at: 60, units: { raider: 2 } }],
    },
    {
      name: 'Ручей', idea: 'bridge',
      map: '..#T#T#S.M..#..__..#.......#.......',
      start: { wood: 120, stone: 60, metal: 40 }, fortressHp: 400, towers: 0, par: 220,
      waves: [{ at: 70, units: { raider: 3 } }, { at: 140, units: { raider: 3, brute: 1 } }],
    },
    {
      name: 'Частокол', idea: 'walls',
      map: '..#T#T#S.M.#.#..........#.........',
      start: { wood: 140, stone: 80, metal: 40 }, fortressHp: 500, towers: 0, par: 320,
      waves: [{ at: 45, units: { raider: 6, brute: 1 } }, { at: 100, units: { raider: 6, brute: 4 } }, { at: 160, units: { brute: 5, raider: 5 } }],
    },
    {
      name: 'Дозор', idea: 'towers',
      map: '..#T#T#S.M#.#.#.........#..........',
      start: { wood: 160, stone: 100, metal: 40 }, fortressHp: 600, towers: 1, par: 340,
      waves: [{ at: 50, units: { raider: 11 } }, { at: 100, units: { raider: 14 } }, { at: 150, units: { raider: 14, brute: 4 } }, { at: 200, units: { raider: 18 } }],
    },
    {
      name: 'Рудник за рекой', idea: 'metalBeyond',
      map: '..#T#T#S.#..__.M.M.#.#........#..........',
      start: { wood: 160, stone: 80, metal: 0 }, fortressHp: 700, towers: 1, par: 380,
      waves: [{ at: 70, units: { raider: 6 } }, { at: 140, units: { raider: 6, brute: 3 } }, { at: 210, units: { raider: 8, brute: 3 } }],
    },
    {
      name: 'Пращники', idea: 'slingers',
      map: '..#T#T#S.M.#.#.#..........#..........',
      start: { wood: 180, stone: 100, metal: 50 }, fortressHp: 750, towers: 1, par: 300,
      waves: [{ at: 60, units: { slinger: 4, raider: 2 } }, { at: 120, units: { slinger: 6, raider: 3 } }, { at: 180, units: { slinger: 6, brute: 2 } }, { at: 240, units: { slinger: 8, raider: 4 } }],
    },
    {
      name: 'Огр', idea: 'ogre',
      map: '..#T#T#S.S.M.#.#.#..........#...........',
      start: { wood: 180, stone: 120, metal: 50 }, fortressHp: 850, towers: 1, par: 400,
      waves: [{ at: 60, units: { raider: 6 } }, { at: 130, units: { ogre: 1, raider: 4 } }, { at: 200, units: { brute: 4, slinger: 4 } }, { at: 260, units: { ogre: 1, brute: 3 } }],
    },
    {
      name: 'Две пропасти', idea: 'twoChasms',
      map: '..#T#S.#.__.T.M.M#.#__..#........#.........',
      start: { wood: 200, stone: 80, metal: 40 }, fortressHp: 800, towers: 1, par: 350,
      waves: [{ at: 80, units: { raider: 4 } }, { at: 160, units: { raider: 4, brute: 2 } }, { at: 240, units: { slinger: 4, brute: 2 } }, { at: 320, units: { raider: 6, brute: 3 } }],
    },
    {
      name: 'Кузня', idea: 'forge', armor: 0.5,
      map: '..#T#T#S.S.M.M.#.#.#...........#..........',
      start: { wood: 200, stone: 140, metal: 80 }, fortressHp: 1100, towers: 2, par: 340,
      waves: [{ at: 60, units: { brute: 2 } }, { at: 130, units: { brute: 3, raider: 2 } }, { at: 200, units: { brute: 4, slinger: 2 } }, { at: 270, units: { brute: 5, ogre: 1 } }],
    },
    {
      name: 'Долгий путь', idea: 'longRoad',
      map: '..#T.#S.M.#.#.#..................#.....................#.............',
      start: { wood: 120, stone: 120, metal: 80 }, fortressHp: 1100, towers: 2, par: 450,
      waves: [{ at: 90, units: { raider: 5 } }, { at: 170, units: { raider: 5, brute: 2 } }, { at: 250, units: { slinger: 4, brute: 2 } }, { at: 330, units: { ogre: 1, raider: 5 } }],
    },
    {
      name: 'Твердыня', idea: 'catapult', armor: 0.75,
      map: '..#T#T#S.S.M.M.#.#.#............#...........',
      start: { wood: 240, stone: 160, metal: 120 }, fortressHp: 3000, towers: 3, par: 490,
      waves: [{ at: 70, units: { raider: 8, brute: 3 } }, { at: 150, units: { brute: 5, slinger: 5 } }, { at: 230, units: { ogre: 1, brute: 4 } }, { at: 310, units: { brute: 6, slinger: 6 } }],
    },
    {
      name: 'Последний рубеж', idea: 'finale',
      map: '..#T#T#S.#.__.S.M.M.#.#.#..__..#.........#..............',
      start: { wood: 220, stone: 120, metal: 40 }, fortressHp: 3200, towers: 3, par: 770,
      waves: [
        { at: 70, units: { raider: 5 } }, { at: 140, units: { raider: 5, brute: 2 } }, { at: 210, units: { slinger: 5, brute: 2 } },
        { at: 280, units: { ogre: 1, raider: 5 } }, { at: 350, units: { brute: 5, slinger: 4 } }, { at: 420, units: { ogre: 2, brute: 2 } },
      ],
    },
  ];
  const api = { LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FrontLevels = api;
})(typeof window !== 'undefined' ? window : globalThis);
