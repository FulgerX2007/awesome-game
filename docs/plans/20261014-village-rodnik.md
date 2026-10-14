# «Родник»: спокойная игра о восстановлении села

## Overview
- Новая браузерная игра «Родник» (RO: «Izvorul») по адресу `/village/`. Это двенадцатая игра в репозитории.
- Игрок ходит по заброшенному селу (вид сверху), рубит деревья, бьёт камни, копает глину и собирает ягоды.
  Из добытого он восстанавливает здания: колодец, мост, лесопилку, печь, мельницу, кузницу, дома, часовню.
- Каждое восстановленное здание даёт что-то новое: открывает часть карты, переработку (доски, кирпич), улучшение
  инструментов или жителя-помощника, который дальше добывает сам. Финал — праздник села, после него свободная игра.
- Только для отдыха: нет врагов, голода, усталости, таймеров и проигрыша. Ресурсы на карте медленно отрастают.
- Встраивается как остальные игры: правила в `web/village/core.js` без DOM, Canvas 2D, RU/RO через `i18n.js`,
  автосохранение в `localStorage`, офлайн-прогресс до 8 часов, облачное сохранение через `/api/saves/{code}`,
  управление с телефона, синтезированные звуки и тихая музыка.

## Context (from discovery)
- Go-сервер `main.go` встраивает `web/` через `//go:embed web`. Каждая игра лежит в `web/<name>/`:
  `index.html`, `style.css`, `lang.js`, `core.js`, `game.js`.
- Ближайшие образцы:
  - `web/rust/` — спокойная инкрементальная игра: офлайн-прогресс до 8 часов и облачные сохранения
    (`CLOUD_KEY`, `cloudPut`, блок `#cloud`, примерно `web/rust/game.js:796`);
  - `web/valley/` — спокойная игра с картой и камерой;
  - `web/bastion/` — фиксированный шаг 1/60 с, синтезированный звук, баланс проверен ботом.
- `core.js` оформлен как IIFE `(function (root) { ... })`, экспорт `module.exports = api`, работает и в браузере, и в Node.
- `web/i18n.js`: русский текст служит ключом, `I18n.add({ ro: {...} })` в `lang.js`, `I18n.t(s, vars)`.
- `web/nav.js` даёт ссылку «← Игры» (`home(className)`).
- Регистрация игры:
  - карточка и цветовая переменная в `web/index.html`;
  - список путей в `main_test.go` (тест `TestStatic…`, строка 21);
  - раздел в `README.md`, где первая строка («Одиннадцать браузерных игр…») сейчас считает игры.
- Таблица рекордов (`boardGames` в `main.go:125`) этой игре не нужна: у неё нет счёта.
- JS-тестов в проекте пока нет. CI (`.github/workflows/release-image.yml`) запускает только `go vet` и `go test`.
- Node 22 доступен, поэтому подойдёт встроенный `node --test`. Playwright установлен глобально (`/opt/node22/lib/node_modules/playwright`),
  Chromium лежит в `/opt/pw-browsers`.

## Development Approach
- **testing approach**: Regular (code first, then tests in the same task)
- complete each task fully before moving to the next
- make small, focused changes
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task
  - tests are not optional - they are a required part of the checklist
  - write unit tests for new functions/methods
  - write unit tests for modified functions/methods
  - add new test cases for new code paths
  - update existing test cases if behavior changes
  - tests cover both success and error scenarios
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- run tests after each change: `node --test 'tests/**/*.test.js'` and `go test ./...`
- maintain backward compatibility (other games and server API untouched, except registering the new game)

## Testing Strategy
- **unit tests (JS)**: `tests/village/*.test.js` on `node:test` + `node:assert/strict`, they load `web/village/core.js` via `require`.
  Tests live in `tests/`, outside `web/`, so they don't end up in the embedded FS or the Docker image.
  Run with `node --test 'tests/**/*.test.js'` (in Node 22 a bare directory argument doesn't work).
- **unit tests (Go)**: the new paths `/village/`, `/village/core.js`, `/village/view.js`, `/village/game.js`, `/village/lang.js`, `/village/audio.js`
  go into the static-files list in `main_test.go`. Run with `go test ./...`.
- **balance bot**: a test in `tests/village/balance.test.js` plays a full game from a fixed seed through `core.js`
  and checks the timing and that the game can't get stuck.
- **e2e smoke**: `tests/village/smoke.cjs` (CommonJS: ESM ignores `NODE_PATH`; Playwright from the global install, Chromium from `/opt/pw-browsers`) starts
  `go run .`, opens `/village/`, makes a few moves and a hit, and checks for no console errors, that the save lands in `localStorage`,
  and that the RO switch works. It isn't part of `node --test` (it needs a browser and a server).
  Run manually: `NODE_PATH=/opt/node22/lib/node_modules node tests/village/smoke.cjs`.

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope
- keep plan in sync with actual work done

## Solution Overview
- **Rules (`core.js`)** are deterministic and DOM-free. State is one serializable object. The world advances with a fixed
  step of `1/20` s via `step(state, dt)`, and the client calls it in an accumulator loop. Randomness comes from mulberry32,
  and the generator state is saved with the game, as in «Долина».
- **Node placement** excludes paths, sand banks, the 2 tiles around the bridge and the square, so nodes (they block
  movement) can never close off a passage, even after regrowth.
- **The map** is a handmade 48×36 tile layout, written as string rows in `core.js`. The east bank of the river
  (quarry, clay) is cut off until the bridge is restored. The north grove opens with the bridge as well, the west meadow
  is open from the start. Trees, rocks, clay pits and bushes are scattered by seed over allowed tiles in each zone,
  in a fixed number per zone.
- **The player** walks on the grid with smooth movement: keys move by velocity with collisions, taps and clicks use
  A* to the tile. "Gather" is a target node: the player walks up to it and hits on a cooldown until the node is empty,
  or until the player moves or gets another order.
- **Restoration**: each ruin has a cost in resources. The player stands next to it and adds resources (button
  "Внести", it adds what fits). Visually a ruin has 3 stages (ruin → scaffolding → restored). Stages depend on the share
  of resources added. When done, the effect is applied (see the table below).
- **Villagers**: a restored house brings a villager with a role (woodcutter, mason, potter).
  `core.js` counts their production as a rate per second with no paths. A villager only walks in `game.js`,
  between their house and a matching zone, purely for the visuals.
- **Processing**: the sawmill turns wood into planks and the kiln turns clay into bricks automatically, at a fixed rate
  while raw materials are in stock. Both are counted in `step` and in `offline`.
- **Offline**: `offline(state, seconds)` replays the production of villagers and workshops with a 1 s step, capped at 8 h.
  It also regrows nodes and returns a summary for the "Пока тебя не было…" window.
- **Pure client helpers (`view.js`)**: DOM-free UMD like `core.js` (`root.VillageView` / `module.exports`):
  `clampCamera`, `screenToTile`, `visibleRange`, number formatting, choosing the action for a tap. They are tested in Node.
- **Client (`game.js`)**: a browser IIFE like the other games (it isn't loaded in Node). Canvas 2D, a camera following the player, DOM HUD (resources, current goal, panels).
  Autosave every 10 s and on `visibilitychange`/`pagehide`. Cloud save is copied from `rust`.
- **Sound (`audio.js`)**: UMD (`root.VillageAudio` / `module.exports`), no-op without `AudioContext`. Other games keep
  audio inside `game.js`; it's split out here so the melody generator can be tested. WebAudio. Short synth sounds (axe, pickaxe, shovel, berries, add resources, build complete,
  festival) and a quiet generated ambient melody on a pentatonic scale. Mute buttons for music and sounds are saved
  in `localStorage`.

## Technical Details

### Resources
| id | RU | Source |
|---|---|---|
| `wood` | Дерево | trees (axe) |
| `stone` | Камень | rocks (pickaxe) |
| `clay` | Глина | clay pits (shovel), east bank only |
| `berries` | Ягоды | bushes (by hand) |
| `planks` | Доски | sawmill: 2 wood → 1 plank |
| `bricks` | Кирпич | kiln: 2 clay → 1 brick |

- A barn (`storage`) limits stock: 50 at the start, 150 after the barn, 400 after the barn upgrade.
  The limit only applies to automatic income (villagers, workshops). Hand gathering above the limit is still allowed,
  so the game never stops the player. Costs above the limit (house1 120 planks with a cap of 50, the chapel) work
  because `contribute` takes partial contributions: a building gets paid for over several visits.
- **Workshops don't eat what you need**: the sawmill and the kiln only take raw materials above a reserve of 30
  (`WORKSHOP_RESERVE`), and they stop when their output reaches the `storage` limit. So hand-gathered wood
  for tools and clay for buildings always stays with the player.

### Nodes
- `tree` (4 hits, 1 wood per hit × axe level), `rock` (4 hits), `clay` (3 hits), `bush` (3 picks) — tuned by the bot (start values 5/6/4/3).
- An empty node turns into a stump, pebbles or an empty bush and regrows after 150–300 s (from the seed; start value 90–180 s).
  It can't regrow under the player.
- Hit cooldown is 0.6 s. Tools of level 2 and 3 give ×2 and ×3 yield and cut the cooldown to 0.5 and 0.4 s.

### Tools
| Tool | Level 2 | Level 3 (needs the forge) |
|---|---|---|
| axe | 30 stone + 20 wood | 50 bricks + 100 planks |
| pickaxe | 40 wood + 20 stone | 50 bricks + 100 planks |
| shovel (appears after the bridge) | 50 wood | 40 bricks + 80 planks |
| basket (berries) | 30 wood | 80 planks |

Final values after the bot tuning (Task 4). Level 3 is deliberately expensive so the four upgrades arrive one by one
and fill the mid-game instead of all at once.

### Restoration (order is soft, only the dependencies are fixed)
| # | id | Name | Cost (final, tuned by the bot) | Needs | Effect |
|---|---|---|---|---|---|
| 1 | `well` | Колодец | 40 stone, 60 wood | — | the square comes alive, unlocks the barn |
| 2 | `home` | Твой дом | 120 wood, 60 stone | — | unlocks tool upgrades (workbench) |
| 3 | `barn` | Амбар | 200 wood, 100 stone | well | storage limit 150, then an upgrade to 400 (100 planks + 40 bricks) |
| 4 | `bridge` | Мост | 260 wood, 160 stone | home | opens the east bank and the north grove, gives the shovel |
| 5 | `sawmill` | Лесопилка | 300 wood, 200 stone | bridge | wood → planks (0.3 planks/s) |
| 6 | `kiln` | Печь для обжига | 180 stone, 130 clay | bridge | clay → bricks (0.25 bricks/s) |
| 7 | `house1` | Дом лесоруба | 120 planks, 60 bricks | sawmill, kiln | villager: woodcutter (+0.2 wood/s) |
| 8 | `house2` | Дом каменщика | 200 planks, 120 bricks | house1 | villager: mason (+0.15 stone/s) |
| 9 | `forge` | Кузница | 100 bricks, 60 planks, 200 stone | kiln | level 3 tools |
| 10 | `mill` | Мельница | 240 planks, 120 bricks | house2 | all villagers work ×1.5 faster |
| 11 | `house3` | Дом гончара | 240 planks, 160 bricks, 100 berries | mill | villager: potter (+0.15 clay/s) |
| 12 | `chapel` | Часовня с колоколом | 200 planks, 180 bricks, 450 stone, 160 berries | buildings 1–11 (the barn upgrade is not needed) | **festival**: final screen, after it free play |

- Bot result on seed 1 (Task 4): well 1.6 min, sawmill ~44 min, forge ~80 min, festival ~140 min; the longest stretch
  without something new is 13.4 min. All 20 seeds reach the festival in 135–145 min.
- `nextGoal` skips a building that still needs planks/bricks while their workshop isn't built (with the tuned costs the
  forge is cheaper than the sawmill, and the hint would otherwise point at something that can't be paid).

- Berries are gathered by hand only (needed for house3, the chapel and decorations): this is the player's calm "walk to the bushes".

- Free play after the festival: 4 kinds of decorations (flower bed, lantern, bench, fence) placed on free square tiles
  for planks, stones and berries. No other mechanics, purely for relaxing.
- **Goal hint**: the HUD always shows the "Следующее дело" — the cheapest available restoration, or a tool if one blocks
  progress. It's computed by `nextGoal(state)` in `core.js`.

### State (serialized as JSON)
```js
{
  v: 1, seed, rng,                 // save version, seed, generator state
  t,                               // world time, seconds
  player: { x, y, target, path, cd }, // target/path/cd are transient: save() drops them
  events: [],                      // transient: step/contribute/... push events, the client reads and clears them
  res: { wood, stone, clay, berries, planks, bricks },
  tools: { axe: 1, pick: 1, shovel: 0, basket: 1 },
  nodes: [{ id, kind, x, y, hp, regrowAt }],
  built: { well: { paid: {...}, done: false }, ... },
  storage, barnLevel,              // barnLevel 0/1/2 indexes STORAGE; storage is derived from it on load
  villagers: [{ role, house }],
  acc: {},                         // fractional automatic income per producer (house id / workshop id), 0..1
  decor: [{ kind, x, y }],
  festival: false, stats: { gathered: {...}, playTime }
}
```
- `save(s)` returns a plain JSON object without transient fields (`events`, `player.path/target/cd`). It must fit in
  the 64 KB `internal/saves` limit, so it is checked in a test.
- `load(data)` takes an object or a JSON string (the cloud load gets an object from `res.json()`), checks `v`, fills in
  missing fields with defaults and drops junk without throwing. A broken save gives a new game and a flag `recovered: true`.
- **Events** `s.events`: `{type:'hit', kind, gain}`, `'deplete'`, `'regrow'` (Task 2); `'contribute'`, `'built'`,
  `'tool'`, `'festival'`, `'decor'` (Task 3). The client uses them for animations, floating numbers, toasts and sounds.

### Public API of `core.js`
`newGame(seed)`, `step(s, dt)`, `moveDir(s, dx, dy)`, `goTo(s, x, y)`, `interact(s, x, y)` (node → gather,
ruin → open/target), `contribute(s, id)`, `upgradeTool(s, tool)`, `upgradeBarn(s)`, `placeDecor(s, kind, x, y)`,
`nextGoal(s)`, `canAfford(s, cost)`, `isWalkable(s, x, y)`, `findPath(s, from, to)`, `offline(s, seconds)`,
`save(s)`, `load(data)`, constants `MAP`, `BUILDINGS`, `TOOLS`, `NODE_KINDS`, `RESOURCES`.

### Balance targets (checked by the bot)
- A greedy bot on seed `1` (walks to the nearest node of the needed resource, contributes and upgrades tools
  as soon as it can) reaches the festival in 2–3.5 h of game time.
- The first restoration (well) arrives in 1–3 minutes, and something new appears at least every 15 minutes.
- No deadlocks: the bot reaches the festival on 3 seeds by default, and on 20 seeds when `BALANCE=1`. Every resource node can be reached
  (BFS from the start after the bridge).
- **Expected outcome of the tuning**: the table adds up to only about 3,000 raw units, which with ×2/×3 tools and villagers
  is well under 2 h. So the costs will most likely grow 2–3×. Knobs the tuning may change: building and tool
  costs, node `hp`, regrowth time, villager and workshop rates. The structure of the table (dependencies, effects) stays.
- Regrowth uses a queue/check `regrowAt <= t`, not a scan of every node on every step. This keeps the bot test cheap:
  the default run must take under 20 s.

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): rules, client, sound, tests, registration in the hub, README.
- **Post-Completion** (no checkboxes): manual play on desktop and phone, listening to the sound, judging the feel of the pace.

## Implementation Steps

### Task 1: Map, generator and game state in `core.js`

**Files:**
- Create: `web/village/core.js`
- Create: `tests/village/core.test.js`

- [x] create `web/village/core.js` as an IIFE like `web/rust/core.js` (`module.exports` in Node, `root.Village` in the browser)
- [x] add mulberry32 with saved state, constants `RESOURCES`, `NODE_KINDS`, `TOOLS`, `BUILDINGS` (the full table: costs, dependencies, effect ids — effects are applied in Task 3), the handmade `MAP` 48×36 (grass, water, path, sand, ruin footprints, bridge site, zones `west`/`east`/`north`)
- [x] implement `newGame(seed)`: scatter nodes by seed over allowed tiles in each zone, start position on the square, starting tools, a `built` skeleton for every building, an empty `events`
- [x] implement `isWalkable` (water, ruins and nodes block; the bridge site is water until restored) and `save`/`load` with version check, defaults and recovery from a broken save
- [x] write tests: same seed gives the same map, different seeds give different ones; node counts per zone; no node on a path/sand/bridge approach/square; the start tile is walkable; save→load round-trip (transient fields dropped, `load` takes a string and an object, save size < 64 KB)
- [x] write tests for errors: `load` of garbage/`null`/foreign version gives a new game with `recovered`, missing fields get defaults
- [x] run `node --test 'tests/**/*.test.js'` and `go test ./...` — must pass before task 2

### Task 2: Movement, pathfinding and gathering

**Files:**
- Modify: `web/village/core.js`
- Create: `tests/village/gather.test.js`

- [x] implement `step(s, dt)` with smooth movement: `moveDir` (velocity, sliding collisions along walls) and `goTo` following an A* path from `findPath`
- [x] implement `interact(s, x, y)`: on a node, walk to an adjacent tile and hit on a cooldown until the node is empty; any new order cancels gathering
- [x] implement yield and cooldown by tool level, node depletion and regrowth after 90–180 s (not under the player, check `regrowAt <= t` with no full scan every step), stats `stats.gathered`, events `hit`/`deplete`/`regrow` in `s.events`
- [x] implement `upgradeTool(s, tool)` with costs from the `TOOLS` table, dependencies (home, bridge, forge — in tests set by `s.built.<id>.done = true` directly) and return codes `ok`/`cost`/`locked`/`max`, event `tool`
- [x] write tests: A* finds the shortest path and returns `null` for unreachable targets (east bank before the bridge); walking up and gathering a tree adds the right amount of wood
- [x] write tests: regrowth by timer, no regrowth under the player, every zone stays reachable after forced regrowth of all nodes, events after a hit/depletion, upgrade costs and errors (not enough resources, locked, max level)
- [x] run `node --test 'tests/**/*.test.js'` — must pass before task 3

### Task 3: Restoration, villagers, workshops and offline

**Files:**
- Modify: `web/village/core.js`
- Create: `tests/village/build.test.js`

- [x] implement `contribute(s, id)` on top of `BUILDINGS` from Task 1: add as much as fits, keep progress in `paid`, visual stage (0/1/2) from the paid share, block on dependencies
- [x] implement completion effects: the bridge opens the east bank and the north grove and gives the shovel; barn and its upgrade (`upgradeBarn`); villagers from houses; the mill gives ×1.5 to villagers; the forge unlocks level 3; the chapel sets `festival`; events `contribute`/`built`/`festival`
- [x] implement the sawmill and kiln (raw materials above `WORKSHOP_RESERVE`=30 → product at a fixed rate, stop when output is at the `storage` limit) and villager production in `step`, with the storage limit for automatic income only
- [x] implement `offline(s, seconds)` (cap 8 h, 1 s step, summary of gains) and `nextGoal(s)`; after the festival, `placeDecor` on free square tiles
- [x] write tests: partial and full contribution, blocking on dependencies, effects of each building (bridge → walkability, house → villager, chapel → festival)
- [x] write tests: workshops don't go below the reserve and stop at the output limit, house1 (60 planks) is finished with no barn through two partial contributions, the limit doesn't cut hand gathering, offline caps at 8 h and is deterministic, `nextGoal` after the festival, `placeDecor` on an occupied tile is refused
- [x] run `node --test 'tests/**/*.test.js'` — must pass before task 4

### Task 4: Balance bot and tuning

**Files:**
- Create: `tests/village/balance.test.js`
- Create: `tests/village/bot.js` (the bot itself, a helper outside the `*.test.js` glob so tuning scripts can reuse it)
- Modify: `web/village/core.js`
- Modify: `tests/village/build.test.js`, `tests/village/core.test.js`, `tests/village/gather.test.js` (read costs from the tables)

- [x] write a greedy bot on top of the public `core.js` API: picks a goal through `nextGoal`, walks to the nearest node of the needed resource, contributes, upgrades tools
- [x] write a test: on seed `1` the festival comes in 2–3.5 h of game time, the well in 1–3 min, and the gap between new things is at most 15 min
- [x] write a test: the bot reaches the festival with no deadlock on 3 seeds (on 20 seeds when `BALANCE=1`); after the bridge every resource node can be reached by BFS; the default run of the whole file takes < 20 s
- [x] tune only the allowed knobs (costs, node `hp`, regrowth time, villager/workshop rates — see Balance targets) until the targets are met; log the final values with `[decision]` in the progress file
- [x] run `node --test 'tests/**/*.test.js'` — must pass before task 5

### Task 5: Page skeleton, translation and hub registration

**Files:**
- Create: `web/village/index.html`
- Create: `web/village/style.css`
- Create: `web/village/lang.js`
- Create: `web/village/game.js` (stub: load the state and draw the map tiles)
- Create: `web/village/view.js` (DOM-free UMD for pure client helpers)
- Create: `web/village/audio.js` (no-op UMD stub `VillageAudio`, filled in in Task 8)
- Modify: `web/index.html`
- Modify: `main_test.go`
- Modify: `.github/workflows/release-image.yml`

- [x] create `index.html` in the style of `web/rust/index.html`: canvas, HUD (resources, "Следующее дело"), slots for the building, tools and settings panels, link `i18n.js`, `nav.js`, `lang.js`, `core.js`, `view.js`, `audio.js`, `game.js`; boot like `web/rust/game.js` (meta description translation, `GameNav.home(...)` and `I18n.toggle(...)` after DOMContentLoaded)
- [x] create `style.css` (warm village palette, layout working down to a 360 px wide screen, safe-area for phones) and `lang.js` with RO translations of all strings, including building, resource and tool names from `core.js`
- [x] add a «Родник» card at the top of `.games` (the newest game goes first) with a variable `--village` in `web/index.html`, and the RO card description in the first `I18n.add` block of the hub
- [x] add `/village/`, `/village/core.js`, `/village/view.js`, `/village/game.js`, `/village/lang.js`, `/village/audio.js` to the path list in `main_test.go`
- [x] add `actions/setup-node` (Node 22) and `node --test 'tests/**/*.test.js'` to the `test` job in `release-image.yml`
- [x] write a test in `tests/village/lang.test.js`: every name from `BUILDINGS`, `TOOLS` and `RESOURCES` has an RO translation in `lang.js` (load the real `web/i18n.js`, put it on `globalThis.I18n`, then `require` `lang.js`); `view.js` and `audio.js` load in Node without errors
- [x] run `go test ./...` and `node --test 'tests/**/*.test.js'` — must pass before task 6

### Task 6: Drawing the world in `game.js`

**Files:**
- Modify: `web/village/game.js`
- Modify: `web/village/view.js`
- Create: `tests/village/view.test.js`

- [x] game loop: `requestAnimationFrame`, accumulator with a fixed step of `core.step`, interpolated player position
- [x] drawing with Canvas 2D code: grass with variations, river with gentle ripples, paths, trees/rocks/clay/bushes, stumps and empty bushes, ruins in 3 stages and restored buildings, the bridge, decorations, the player with a walk cycle and a swing animation
- [x] villagers walking in the view between their house and their zone (cosmetic only), chimney smoke and the spinning mill when built, the festival (lanterns, fireworks)
- [x] animations from `s.events` (swing on `hit`, a node shaking/falling on `deplete`); the camera follows the player with clamping at map edges, DPR support and resize, only visible tiles drawn
- [x] pure camera functions (`clampCamera`, `screenToTile`, `visibleRange`) live in `web/village/view.js` (`VillageView`), `game.js` only calls them; cover them in `tests/village/view.test.js` (bounds, DPR, edges)
- [x] run `node --test 'tests/**/*.test.js'` — must pass before task 7

### Task 7: Input, HUD, panels and saving

**Files:**
- Modify: `web/village/game.js`
- Modify: `web/village/index.html`
- Modify: `web/village/style.css`
- Modify: `web/village/view.js`
- Modify: `tests/village/view.test.js`

- [x] keyboard: WASD/arrows to walk, `E`/`Пробел` to interact with what's in front of you, `B` buildings, `T` tools, `M` sound, `Esc` close panels
- [x] mouse and touch: a click or tap on a tile walks there, on a node gathers it, on a ruin walks over and opens the panel; drag to look around is not needed (the camera follows the player)
- [x] HUD: resources with income per minute, "Следующее дело", progress X/12 buildings; the building panel (cost, paid, "Внести" button, effect), the tools panel, floating "+3 дерево" numbers and a toast when a building is done
- [x] saving: autosave to `localStorage` (`village.save`) every 10 s and on `visibilitychange`/`pagehide`, offline progress on start with a "Пока тебя не было…" window, a "Начать заново" button with confirmation
- [x] cloud save following the `web/rust/game.js` pattern (`village.cloud`, `/api/saves/{code}`), the block appears only when the Go server answers
- [x] put the pure HUD helpers (number formatting, choosing the action for a tap on a tile) in `view.js` and cover them in `view.test.js`
- [x] run `node --test 'tests/**/*.test.js'` — must pass before task 8
- ➕ free-play decoration UI (a "Украшения" block in the buildings panel, then a tap on a free square tile) — `placeDecor` had no client entry point otherwise

### Task 8: Sounds and music

**Files:**
- Modify: `web/village/audio.js`
- Modify: `web/village/game.js`
- Modify: `web/village/view.js` (`soundFor`: core event → sound name, tested in Node)
- Create: `tests/village/audio.test.js`

- [x] `audio.js`: lazy `AudioContext` on the first gesture; sounds for the axe, pickaxe, shovel, berries, adding resources, finishing a building, tool upgrade, festival — all synthesized (oscillators + noise + envelopes)
- [x] a quiet ambient melody: generated phrases on a pentatonic scale with soft pads and long pauses, volume ~0.15, a day birdsong layer
- [x] separate "Музыка" and "Звуки" toggles, saved in `localStorage` (`village.audio`), the `M` key mutes everything, no autoplay before a gesture
- [x] connect the sounds to the existing `s.events` (from Tasks 2–3); the client reads and clears the list once per frame
- [x] write tests: `audio.js` loads in Node without `AudioContext` and doesn't throw (no-op mode); the music phrase generator (a pure function from a seed) only gives notes from the pentatonic scale
- [x] run `node --test 'tests/**/*.test.js'` — must pass before task 9

### Task 9: E2E smoke test in the browser

**Files:**
- Create: `tests/village/smoke.cjs`

- [x] the script starts `go run . -addr :18080 -data ""`, waits for `/healthz`, opens `/village/` in Chromium (`executablePath: '/opt/pw-browsers/chromium'` when needed)
- [x] checks: no console errors, the canvas isn't empty, a `D` press moves the player, a tap on the nearest tree adds wood within 10 s, the save shows up in `localStorage`
- [x] checks the `?lang=ro` switch: the HUD shows `Lemn` instead of `Дерево`, and after opening the panels `I18n.missing.size === 0`; checks a 390×844 viewport (phone) — the HUD fits on screen without horizontal scroll
- [x] run the smoke test and fix whatever it finds; stop the server at the end even after an error

### Task 10: Verify acceptance criteria
- [x] verify all requirements from Overview are implemented (gathering, restoration, villagers, festival, no enemies/losing, offline, cloud, phone, sound, RU/RO)
- [x] verify edge cases: broken save, storage full, closed tab for more than 8 hours, play after the festival
- [x] run full test suite: `go vet ./... && go test ./... && node --test 'tests/**/*.test.js'`
- [x] run e2e smoke: `NODE_PATH=/opt/node22/lib/node_modules node tests/village/smoke.cjs`
- [x] verify every public function of `core.js` is covered by tests

### Task 11: [Final] Update documentation
- [x] add a `## Родник (/village/)` section to `README.md` in the style of the others: what it is, controls, saves, the rules in `core.js` and the bot's results
- [x] update the first line of `README.md` (game count: twelve), the `Запуск` section (the `node --test 'tests/**/*.test.js'` command) and the «Готовый образ» list (CI runs JS tests too)
- [x] update `docs/roadmap.md`: «Родник» is out (the list stays empty)
- [x] move this plan to `docs/plans/completed/` (skipped - the harness moves the plan after all phases finish)

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- play 20–30 minutes on desktop: is the pace calm, does the eye get bored, are the goals clear
- play on a phone (iOS Safari, Android Chrome): taps, panel sizes, sound after the first touch
- listen to the music for 10+ minutes: does it get tiresome, is the volume comfortable
- check the RO translation with a native speaker

**External system updates**:
- after merging, push a `v*` tag to build the image with the new game (the CI now runs JS tests too)
