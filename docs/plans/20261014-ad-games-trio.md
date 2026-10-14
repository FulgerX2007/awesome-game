# «Игры из рекламы»: Тяни штифт, Числовой забег, Тесная парковка

## Overview
- Три новые браузерные игры по мотивам механик из мобильной рекламы, сделанные «честно»: в них есть то, что обещает ролик.
  Это 13-я, 14-я и 15-я игры репозитория:
  1. **«Тяни штифт»** (RO: «Trage știftul»), `/pins/`. Физическая головоломка: вытаскиваешь штифты в нужном порядке,
     вода и лава текут, при встрече вода и лава превращаются в камень, золото сыплется, враги гибнут в лаве, герой
     собирает золото и уходит к выходу. 30 уровней, у части из них несколько решений.
  2. **«Числовой забег»** (RO: «Cursa numerelor»), `/rush/`. Аркада с автобегом в псевдо-3D: толпа бежит вперёд,
     игрок ведёт её влево-вправо через ворота `+N`, `×N`, `−N`, `÷N` и «оружие +1» мимо препятствий и по движущимся
     платформам. В конце уровня битва с армией врага, на каждом 5-м уровне ещё и босс. Между забегами покупаются улучшения.
  3. **«Тесная парковка»** (RO: «Parcarea strâmtă»), `/parking/`. Логическая головоломка на сетке: машины и автобусы
     двигаются только вдоль своей оси, есть столбики, шлагбаумы и медленный тягач. Ходы ограничены, звёзды даются
     за оптимальное решение, а оптимум для каждого уровня посчитан BFS-решателем. 40 уровней.
- Каждая игра законченная: стартовое меню, выбор уровня, сохранение прогресса в `localStorage`, звук с переключателем,
  RU/RO, управление с телефона. Игра работает без сети: никаких внешних ресурсов, шрифты только системные.
- Названия, уровни, графика (рисуется кодом на Canvas 2D) и правила свои. Это не копии коммерческих игр.

## Context (from discovery)
- Go-сервер `main.go` встраивает `web/` через `//go:embed web`. Каждая игра живёт в `web/<name>/`: `index.html`,
  `style.css`, `lang.js`, `core.js`, `game.js`, и по необходимости `view.js` и `audio.js`.
- Ближайшие образцы:
  - `web/village/`: UMD-модули `core.js`, `view.js` и `audio.js` (`(function (root) {...})`, `module.exports`), безопасная
    обёртка над `localStorage` в `game.js:15`, переключатели звука в `audio.js` (`STORE_KEY`), тесты `tests/village/*.test.js`,
    браузерный smoke-тест `tests/village/smoke.cjs`;
  - `web/bastion/`: фиксированный шаг симуляции, звёзды за уровень в `localStorage`, баланс проверен ботом.
- `web/i18n.js`: русский текст служит ключом, переводы задаются через `I18n.add({ ro: {...} })` в `lang.js`, текст берётся через `I18n.t(s, vars)`.
  `web/nav.js` добавляет ссылку «← Игры».
- Регистрация игры:
  - карточка и CSS-переменная цвета в `web/index.html` (строки 8 и ~42);
  - список путей в `main_test.go:21`;
  - раздел в `README.md`, где первая строка («Двенадцать браузерных игр…») считает игры;
  - `docs/roadmap.md`.
- Тесты: `node --test 'tests/**/*.test.js'` (Node 22, `node:test` + `node:assert/strict`) и `go vet ./... && go test ./...`.
  Smoke-тесты: `NODE_PATH=/opt/node22/lib/node_modules node tests/<game>/smoke.cjs` (Playwright, Chromium из `/opt/pw-browsers`).
- ⚠️ `web/village/index.html` грузит Google Fonts. Новым играм так делать нельзя (офлайн), им хватит системного стека шрифтов.
- Таблица рекордов (`boardGames` в `main.go`) не используется: прогресс у всех трёх игр по уровням и звёздам.

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
- maintain backward compatibility: other games and the server API stay untouched, only registration of the new games is added
- the three games are independent. Duplicate small helpers (safe storage, rng, audio unlock) per game instead of a shared
  module, as the repo already does. Each game is self-contained.
- the plan is executed autonomously. Settle judgment calls (exact numbers, colours, texts) yourself and log them as
  `[decision]` in the progress file. If balance numbers change after a bot run, update the tables in this plan.

## Testing Strategy
- **unit tests (JS)**: `tests/<game>/*.test.js` load `web/<game>/core.js` (and `view.js` / `audio.js`) via `require`.
  Tests live in `tests/`, outside `web/`, so they don't land in the embedded FS or the Docker image.
- **level verification**: every level of every game is checked automatically:
  - `pins`: a solver tries pin-pull orders;
  - `rush`: a bot plays with best and worst choices;
  - `parking`: BFS checks the optimum stored in the level data.
- **unit tests (Go)**: the new static paths go into the list in `main_test.go:21`.
- **offline test**: in each game's `build.test.js`, no file under `web/<game>/` contains `http://` or `https://` (except comments,
  if any — better to have none), and `index.html` uses only relative paths plus `../i18n.js` and `../nav.js`.
- **e2e smoke**: `tests/<game>/smoke.cjs` in the same style as `tests/village/smoke.cjs`: start the server on a free port, open the page, play
  through the first level with real input, and check for no console errors, that progress lands in `localStorage`, and that RO works.
  It isn't part of `node --test`, run it manually per task.

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope
- keep plan in sync with actual work done

## Solution Overview
- Same architecture for all three:
  - `core.js` holds deterministic rules with no DOM and a serializable state;
  - `view.js` holds pure client helpers: projection, hit-testing, layout;
  - `audio.js` synthesizes sounds through WebAudio, does nothing without an `AudioContext`, and keeps the mute toggle in `localStorage`;
  - `game.js` is a browser IIFE: Canvas 2D, DOM screens (menu → level select → game → result), input;
  - `lang.js` holds the RO strings.
- Screens are DOM overlays on top of the canvas:
  - **Menu**: «Играть» (continues from the first unfinished level), «Уровни», «Звук вкл/выкл», RU/RO;
  - **Level select**: a grid of numbers, stars, and a lock on levels past the first unfinished one;
  - **Result**: «Дальше», «Ещё раз», «Уровни».
- Progress is the `<game>.progress` key: `{ v: 1, stars: {levelIndex: 0..3}, ...game fields }`. Loading tolerates
  broken or foreign JSON and falls back to a clean state.
- Sound and the RO switch are saved like in `village`. No cloud save or leaderboard (YAGNI).

## Technical Details

### 1. «Тяни штифт» (`/pins/`): cellular automaton

**Grid.** 36×54 cells; the logical canvas is 360×540, so one cell is 10 px and the canvas is scaled to the screen.
Cell types in a `Uint8Array`:

| code | type | behaviour |
|---|---|---|
| 0 | empty | — |
| 1 | wall | static, solid |
| 2 | pin | static, solid. Per-cell `pinId` lives in a separate `Int8Array`. Pulling a pin turns its cells into empty |
| 3 | water | falls down → if blocked, diagonally down → if blocked, sideways by one cell |
| 4 | lava | like water, but only moves on even ticks (slower). Destroys gold it touches (gold → empty) |
| 5 | stone | static, solid. Forms where lava touches water: the lava cell → stone, the water cell → empty |
| 6 | gold | falls straight down, then diagonally (like sand), never spreads sideways. Is pushed out by liquids: it doesn't float, it sinks |

- **Determinism, no rng.** Cells are processed bottom to top. The sideways and diagonal direction depends on
  the parity of `(x + y + tick)`. A cell moves at most once per tick (a `moved` flag array).
- ➕ **Flow budget (added in Task 1).** Each liquid cell carries a sideways budget (`FLOW = 24`): a fall (straight or
  diagonal) refills it, each sideways step spends one, and a sideways step goes only to the parity-preferred side.
  Without it a thin puddle on a flat floor wanders forever and never settles. A diagonal step also needs the side cell
  free of solids, so nothing leaks through a corner. Reactions (stone, burnt gold) run every tick, lava only moves on even ticks.
  The 3000-tick cap counts from the last pull. `pull` with an unknown id returns `false` instead of throwing.
- **Level format.** A JS object:
  - `walls`: rectangles in cells;
  - `pins`: `{id, x, y, w, h, handle: 'left'|'right'|'top'}`, horizontal or vertical bars;
  - `fills`: `{type: 'water'|'lava'|'gold', x, y, w, h}`;
  - `hero`: `{x, y, w:3, h:5}`;
  - `enemies`: `[{x, y, w:3, h:5}]`;
  - `room`: the hero's room rectangle;
  - `exit`: the exit door inside `room`;
  - `goldTarget`: how many gold cells must end up in `room`.

  `buildLevel(def)` rasterizes it onto the grid.
- **Entities**:
  - Hero and enemies are boxes, not cells. Liquids and gold flow around them: entity cells count as solid for the automaton.
  - An enemy dies when ≥3 lava cells touch its box (adjacent or inside). A dead enemy's box becomes free.
  - The hero loses instantly if lava touches the hero's box.
  - The hero also loses if a flood fill over passable cells (empty, water, gold) connects the box of a live enemy
    to the hero's box ("the enemy reached the hero").
- **Win.** The automaton has "settled" (no cell changed for 20 ticks), the hero is alive, the number of gold cells
  in `room` is at least `goldTarget`, and there is no lava in `room` on the way from the hero to `exit`.
  Then the client plays the walk to the exit. Hard cap of 3000 ticks: if it hasn't settled by then, check by the same rules.
- **API**:
  - `newLevel(i)`;
  - `pull(state, pinId)` (`false` if already pulled);
  - `step(state)`: one tick at 60 ticks/s, the client uses a fixed-step accumulator;
  - `status(state)`: `'playing' | 'won' | 'lost'` plus the reason (`lava`, `enemy`, `nogold`);
  - `goldInRoom(state)`;
  - `stars`: 3 when the win came with all enemies dead and ≥1.5× `goldTarget` gold, 2 when either holds, otherwise 1.
- **Solver** (`solve(def)` in core.js, used by the tests). DFS over pull orders of all subsets of pins.
  After each pull it simulates "to settled" (a patient player) and caches the state snapshot per prefix.
  It returns the list of winning orders and whether the level is won without pulling at all. Levels have ≤5 pins.
- ➕ **Status details (added in Task 2).** `status(s)` returns `{status, reason}`. Lava touching the hero (4-adjacent)
  and an enemy reaching the hero are latched in `s.lost` at the end of a changing tick and right after a pull. Settled
  with too little gold (or lava on the way) is still `playing` while unpulled pins remain; with none left it is `lost`
  (`lava` if lava blocks the way, else `nogold`). "Touching" an enemy box means inside or 4-adjacent (corners don't count).
  With no enemies, "all enemies dead" holds. `solve(def)` returns `{wins, losses, wonWithoutPull, nodes}`: a won prefix
  ends the order (the game ends there), a lost prefix is a losing order.
- ➕ **Level sources (added in Task 3).** `levels.js` writes each level compactly: the chambers carved out of solid
  rock (`open`), pins `[id, x, y, w, h, handle]` numbered 1..n, fills, hero/enemy/exit corners; `make(src)` turns it into
  the `buildLevel` format with the walls as the complement rectangles. A pin's handle sits in `handleCell(pin)` (in
  `core.js`: the cell just past the handle end), carved as a small pocket in the rock. Every chamber is closed, rooms are
  free of rock and pins, and every level has a 3★ solution (checked in `levels.test.js`).
- **30 levels**, difficulty rising:
  - 1–5: one or two pins, teach the basics (gold, water, lava, enemy, water+lava);
  - 6–20: 3–4 pins;
  - 21–30: 4–5 pins.

  At least 10 levels have ≥2 different winning pin sets or orders ("several solutions").

### 2. «Числовой забег» (`/rush/`): pseudo-3D

- **Track.** Length is `L` metres (300–700 depending on the level), width is `x ∈ [-1, 1]`. The crowd moves forward at
  12 m/s. The player sets the target `x` (drag, mouse, ←/→), and the crowd centre eases towards it at up to 2.5 units/s.
  The crowd radius is `r = min(0.9, 0.08·√count)`.
- **Gates.** A pair of gates at one `z`, the left and right half of the track (sometimes a single gate across the full width).
  The op applies to the side the crowd centre is on. Ops:
  - `add N`, `sub N`, `mul N` (2–3);
  - `div N` (2–3, rounded down);
  - `pow +1`: the soldiers' weapon level goes up.

  `count ≤ 0` means a loss on the spot.
- **Obstacles.** Segments `{z, x0, x1, kind}`:
  - `saw`: a spinning saw, takes `ceil(count·overlap·0.5)`;
  - `wall`: takes `ceil(count·overlap)`;
  - `overlap` is the share of the crowd span `[c−r, c+r]` that overlaps `[x0, x1]`.

  The `Щит` upgrade lowers losses.
- **Moving platforms.** A gap `{z0, z1}` where only a platform of width `w` moves sideways (`x = A·sin(ωt + φ)`).
  On every tick inside the gap, soldiers outside the platform fall. Losses are proportional to the uncovered share of the span.
- **Finale.**
  - Enemy army: `E` soldiers with weapon level `p_e`. Strength is `count·power` against `E·p_e`. Win when ours is greater.
    The rest is `ceil((S − S_e)/power)`.
  - On every 5th level a boss with `HP` comes after the army: the rest of the strength must be ≥ HP. A loss means
    "the boss won".
  - The client shows the battle as a 2–3 s animation. The result is computed by `core`.
- **Economy.** Coins = survivors + `10·level`. Upgrades, each 10 levels, price `base·1.35^level`:

  | upgrade | effect per level |
  |---|---|
  | `Старт` | +3 soldiers at the start |
  | `Оружие` | +0.2 weapon level at the start |
  | `Щит` | −6% losses from obstacles and platforms |
  | `Доход` | +10% coins |

- **Levels.** Generated from the seed `level·7919` by a deterministic generator.
  - It places gates, obstacles and platforms.
  - It sizes the enemy army so that with the "expected" upgrades for that level, a "smart" path (the best side at
    every gate, dodging obstacles) wins with a margin of 15–40%.
  - Levels 1–3 are hand-written for teaching. After 30, levels keep coming (endless mode) with growing difficulty.
- **API**: `newRun(levelIdx, upgrades)`, `step(run, dt, targetX)`, `run.status`, `finishBattle(run)`,
  `reward(run, upgrades)`, `buy(save, upgradeId)`, `levelDef(i)`.
- **Bot** (in the tests): a "smart" bot looks one gate ahead and picks the side with the larger resulting strength,
  steering around obstacles. A "dumb" bot always picks the worse side.
- **Projection** (`view.js`): `project(x, z, camZ, viewport)` gives screen `{sx, sy, scale}`, with the horizon at 30% of
  the height and the camera 6 m behind the crowd. Objects are drawn far to near. A soldier is a simple figure
  (circle + body), up to 150 are drawn, and above that the crowd shows the number.

### 3. «Тесная парковка» (`/parking/`): BFS

- **Grid.** 6×6 (from level 26, 7×7). The exit is on the right edge, in the row of the red player car (length 2, horizontal).
- **Objects**:
  - `car` (length 2), `bus` (length 3): orientation `h|v`;
  - `bollard`: a 1×1 bollard, immovable;
  - `gate`: a barrier on a cell. It is closed on odd moves and open on even ones (the state flips after every move).
    A vehicle can't pass through or stop on a closed barrier;
  - `tow`: a slow tow truck (length 2 or 3) that moves at most 1 cell per move.
- **Move**: shifting one vehicle any distance along its axis = 1 move. The level is solved when the player car leaves
  through the exit (its tail passes the edge; the move "into the exit" counts as one move).
- **Level format.** Rows like `"..AA.B"`:
  - letters are vehicles; `X` is the player;
  - `#` is a bollard, `|` is a barrier;
  - the vehicles' list gives orientation and kind (`bus`/`tow`) where it isn't obvious from length.

  `parseLevel(def)` validates: overlaps, an `X` that is horizontal and in the exit row, lengths.
- **State.** Vehicle positions + move parity. Key for BFS: a string of positions + parity.
  `solve(level)` returns the optimal number of moves and the path, or `null`. Limit is 200k states.
- **Moves and stars**:
  - limit: `optimal + max(5, ceil(optimal·0.5))`;
  - 3★ at `≤ optimal`, 2★ at `≤ optimal+3`, 1★ within the limit;
  - the limit runs out → "Ходы кончились", with «Ещё раз» and «Отменить ход».
- **Moves.** Undo restores the full state, including parity and the counter. «Подсказка» shows the next move from
  `solve` of the current state (at most 3 hints per level, no stars spent).
- **40 levels.** Created by a generator script `tests/parking/generate.js` (a dev tool, not part of `node --test`).
  It generates random boards, picks them by optimum, and writes them into `web/parking/levels.js` as `LEVELS` with the
  `optimal` field. Difficulty:
  - 1–5: optimum 2–5;
  - 6–15: 6–10;
  - 16–25: 10–16;
  - 26–40: 14–25, with barriers and tow trucks starting from level 12.
- **Input.** Drag a vehicle along its axis. The vehicle moves to the nearest allowed cell; a release snaps it and
  counts one move if the position changed. Keyboard: Tab/arrows pick a vehicle, arrows move it.

### Shared
- Storage keys: `pins.progress`, `rush.save`, `parking.progress`, `<game>.audio`.
- Sounds are synthesized:
  - pins: metallic "click" of the pin, gurgle, hiss of lava with water, coins, victory/loss;
  - rush: gate (higher for good gates), hit, battle, coins;
  - parking: car slide, bump into an obstacle, barrier, victory.
- Hub colours: `--pins: #ffb547`, `--rush: #4fd17a`, `--parking: #5aa7ff`.
- System font stack: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

## What Goes Where
- **Implementation Steps**: code, levels, tests, docs inside the repository.
- **Post-Completion**: manual check on a phone, tuning level feel by hand.

## Implementation Steps

### Task 1: «Тяни штифт» — cellular automaton and level rasterizing in core.js

**Files:**
- Create: `web/pins/core.js`
- Create: `tests/pins/core.test.js`

- [x] create `web/pins/core.js` as UMD (`root.PinsCore` / `module.exports`): constants W=36, H=54, cell codes, `buildLevel(def)`, `pull`, `step`
- [x] implement the rules for water, lava, gold and stone exactly as in the Technical Details table (bottom-to-top pass, parity of `x+y+tick`, `moved` flags, lava only on even ticks, lava+water → stone, lava destroys gold)
- [x] implement `settled` tracking (20 ticks with no changes) and the 3000-tick cap
- [x] write tests: rasterizing walls/pins/fills, pulling a pin clears its cells and re-pulling returns `false`, water falls and spreads, gold falls like sand and sinks in water, lava+water gives stone, lava destroys gold, determinism (two runs give the same grid), cell count is conserved for water/gold without reactions
- [x] write tests for errors: an invalid `pinId`, a level with overlapping or out-of-bounds rectangles throws from `buildLevel`
- [x] run `node --test 'tests/**/*.test.js'` — must pass before next task

### Task 2: «Тяни штифт» — hero, enemies, win/loss, stars and solver

**Files:**
- Modify: `web/pins/core.js`
- Create: `tests/pins/rules.test.js`

- [x] entities as solid boxes for the automaton; an enemy dies from ≥3 lava cells, a dead enemy frees its box
- [x] `status(state)`: an instant loss from lava (`lava`) and from a flood fill connecting a live enemy to the hero (`enemy`); a win after settling with `goldInRoom ≥ goldTarget` and no lava on the way to `exit`; otherwise `nogold`
- [x] `stars(state)` by the rules in Technical Details; `solve(def)` (DFS over orders of pin subsets with prefix-snapshot caching)
- [x] write tests on small hand-made test levels: an enemy burns in lava; opening the path to a live enemy → `enemy`; lava on the hero → `lava`; gold in the room → win; too little gold → `nogold`; stars 1/2/3
- [x] write tests for `solve`: finds the only correct order on a 2-pin test level, finds two solutions where there are two, returns an empty list for an unsolvable level
- [x] run tests — must pass before next task

### Task 3: «Тяни штифт» — 30 levels and their verification

**Files:**
- Create: `web/pins/levels.js`
- Create: `tests/pins/levels.test.js`

- [x] create `web/pins/levels.js` (UMD, `root.PinsLevels`) with 30 levels by the difficulty curve from Technical Details: teaching levels 1–5 (gold, water, lava, enemy, water+lava → stone), then 6–20 with 3–4 pins, 21–30 with 4–5 pins
- [x] make every level fit the grid, with the hero, `room`, `exit` and the pin handles not overlapping walls
- [x] write `tests/pins/levels.test.js`: every level builds, has ≥1 winning order from `solve`, isn't won without pulling, has ≥1 losing order (order matters); ≥10 levels have ≥2 distinct winning orders; the pin count follows the difficulty curve
- [x] keep the full check of 30 levels in `node --test` under ~60 s (if slower, speed up `step` instead of cutting the checks)
- [x] run tests — must pass before next task

### Task 4: «Тяни штифт» — page, rendering, input, screens and saving

**Files:**
- Create: `web/pins/index.html`
- Create: `web/pins/style.css`
- Create: `web/pins/view.js`
- Create: `web/pins/game.js`
- Create: `web/pins/lang.js`
- Create: `tests/pins/view.test.js`
- Create: `tests/pins/progress.test.js`

- [x] `view.js` (UMD): `fitCanvas(viewport)`, `screenToCell`, `pinAt(state, cellX, cellY)` with a padded hit area for the handle, `drag` (a pull counts when the handle is dragged ≥ 2 cells along the pin's axis or on a tap)
- [x] `game.js`: Canvas 2D (walls as stone masonry, metal pins with a ring, water and lava with a gradient and edge glow, gold coins, hero/enemies as figures, the exit door), animated pin pull-out, fixed step 60/s, hero walking to the exit after a win
- [x] DOM screens: menu, level select (stars, locks), HUD (level, «Заново», «Уровни», sound), result screen with stars; progress `pins.progress` with tolerant loading (functions `loadProgress`/`saveProgress`/`unlocked` in `core.js`)
- [x] `lang.js` with all RO strings; `index.html` with no external URLs, links to `../i18n.js` and `../nav.js`; keyboard 1–5 pulls pins by number, `R` restarts
- [x] write tests: `view.test.js` (scaling, `screenToCell`, `pinAt` on handle and pin, drag threshold), `progress.test.js` (save/load, broken JSON → clean state, unlocking levels, keeping the best stars)
- [x] run tests — must pass before next task
- ➕ `view.js` also holds `pullDir`, `fixedSteps` (60 ticks/s, a backlog over 8 ticks is dropped) and `walkPos`/`walkTime` (the hero walk); `core.js` also exports `newProgress`/`parseProgress`/`starsOf`/`recordStars`/`firstUnfinished`. `loadProgress`/`saveProgress` take a Storage-like object (null or throwing → clean state / `false`). The sound toggle uses `window.PinsAudio` (`enabled`, `setEnabled`, `unlock`, `play(name)`) when it exists — Task 5's `audio.js` provides it; game.js plays `pin`, `hiss`, `sizzle`, `burn`, `coin`, `win`, `lose`

### Task 5: «Тяни штифт» — sound, hub registration, offline check, smoke

**Files:**
- Create: `web/pins/audio.js`
- Create: `tests/pins/audio.test.js`
- Create: `tests/pins/build.test.js`
- Create: `tests/pins/smoke.cjs`
- Modify: `web/pins/game.js`
- Modify: `web/index.html`
- Modify: `main_test.go`

- [x] `audio.js` (UMD, no-op without `AudioContext`, unlocks on the first gesture): pin pull, liquid, hiss, coins, win/loss; the toggle is saved in `pins.audio`
- [x] the hub card in `web/index.html` (`--pins` colour, RU text), the RO string for the card in the hub's translations (wherever they live — check `web/index.html`/`web/i18n.js`), the paths `/pins/`, `/pins/core.js`, `/pins/levels.js`, `/pins/view.js`, `/pins/game.js`, `/pins/lang.js`, `/pins/audio.js` in `main_test.go`
- [x] write `audio.test.js` (no-op without a context, saving the toggle with broken storage) and `build.test.js` (all script files from `index.html` exist; no `http://`/`https://` in `web/pins/`; every Russian string passed to `t(` in `game.js` has a RO translation in `lang.js`)
- [x] write `tests/pins/smoke.cjs` modelled on `tests/village/smoke.cjs`: open `/pins/`, from the menu go to level 1, pull the pin with a mouse drag, wait for the win, check for no console errors, that `pins.progress` is written, and that RO works
- [x] run `node --test 'tests/**/*.test.js'`, `go vet ./... && go test ./...` and the smoke — must pass before next task
- ➕ `audio.js` also has `gurgle` (pouring water) and `bubble` (pouring lava): `game.js` plays them when ≥6 liquid cells move into empty space in one frame (per-sound rate limits in `audio.js`). The toggle is stored as `{"enabled":bool}` in `pins.audio`. The hub card goes first (newest first), so `tests/village/lang.test.js` now checks only that the «Родник» card exists, not its place. The smoke test picks a free port, blocks and reports any request that leaves the server, and also checks the sound toggle, locks in the level select, «Дальше» and a reload continuing at level 2

### Task 6: «Числовой забег» — track, gates, obstacles and platforms in core.js

**Files:**
- Create: `web/rush/core.js`
- Create: `tests/rush/core.test.js`

- [x] UMD `root.RushCore`: level format (`gates`, `obstacles`, `platforms`, `enemy`, `boss`, `length`), `newRun(levelDef, upgrades)`, `step(run, dt, targetX)` with movement, crowd radius, crossing gates (each pair at most once), obstacles and platforms
- [x] gate ops `add/sub/mul/div/pow` with rounding as in Technical Details; `count ≤ 0` → `status='lost'`, reason `crowd`
- [x] losses from `saw`/`wall`/platforms through the crowd span overlap, scaled down by the `Щит` upgrade
- [x] write tests: each gate op, picking the side by the crowd centre, a single pass through a gate, overlap and losses (full/partial/none), falling off a platform at different phases, determinism, losing at zero
- [x] write tests for errors: an invalid op in a level, `dt ≤ 0`/NaN in `step` is ignored
- [x] run tests — must pass before next task
- ➕ `core.js` runs in fixed 60 Hz ticks whatever `dt` is passed (an accumulator, at most 0.25 s per `step` call), with `z` and time computed from the tick count; the crowd centre is clamped to `[-(1−r), 1−r]` so the whole crowd stays on the track; the side at a gate is `x < 0` → left, `x ≥ 0` → right; gates are `{z, left, right}` or `{z, full}` with `mul`/`div` n ∈ {2, 3} and `pow` always +1; platform falls are a rate (`FALL_RATE` = 4/s of the uncovered share, times the shield) accumulated over ticks, so `Щит` matters there too; `run.events` (`gate`/`hit`/`fall`) feeds the client's animations and sounds; `newRun` takes a level definition (Task 7 may add an index via `levelDef`); `run.status` is `running` → `battle` at the finish line (Task 7's `finishBattle` settles it) or `lost` (reason `crowd`)

### Task 7: «Числовой забег» — battle, boss, economy, level generator and bot

**Files:**
- Modify: `web/rush/core.js`
- Create: `tests/rush/bot.js`
- Create: `tests/rush/balance.test.js`
- Create: `tests/rush/economy.test.js`

- [ ] `finishBattle(run)` (army, then a boss on every 5th level), `reward`, the `buy` upgrades with price `base·1.35^level` and a cap of 10, `newSave`/`loadSave` tolerant of broken JSON
- [ ] `levelDef(i)`: levels 1–3 by hand, the rest from the seed generator with growing length and difficulty, enemy army sized by the "expected upgrades" for the level; endless mode past 30
- [ ] `tests/rush/bot.js`: smart and dumb bots through the `core` API only
- [ ] `balance.test.js`: on levels 1–30 the smart bot with the expected upgrades wins with a margin of 15–40%, the dumb one loses on ≥80% of levels; boss levels are winnable
- [ ] `economy.test.js`: a smart bot playing in a row and buying the cheapest upgrade reaches level 30 with no more than 3 losses in a row on any level; `buy` without coins and above the cap is refused
- [ ] run tests — must pass before next task (tune the generator and the prices if needed; update the table in this plan)

### Task 8: «Числовой забег» — pseudo-3D rendering, control, screens and shop

**Files:**
- Create: `web/rush/index.html`
- Create: `web/rush/style.css`
- Create: `web/rush/view.js`
- Create: `web/rush/game.js`
- Create: `web/rush/lang.js`
- Create: `tests/rush/view.test.js`

- [ ] `view.js` (UMD): `project(x, z, camZ, viewport)`, `unproject` for the pointer's X, crowd soldier layout (spiral, up to 150 figures), number formatting
- [ ] `game.js`: track with perspective (stripes, edges, sky/horizon), gates as translucent panels with large numbers (green for good, red for bad), saws, walls, platforms over a gap, the crowd, the enemy army and the boss, animations of gates/losses/battle
- [ ] control by drag/mouse/←→; screens: menu, «Магазин» (4 upgrades, prices, coins), run HUD (count, weapon level, track progress), result (coins, «Дальше»/«Ещё раз»/«Магазин»); `rush.save`
- [ ] `lang.js` with RO strings; `index.html` with no external URLs
- [ ] write `view.test.js`: projection (near is larger and lower, horizon, symmetry in x), `unproject` is the inverse of `project`, soldier layout fits in the radius
- [ ] run tests — must pass before next task

### Task 9: «Числовой забег» — sound, hub registration, offline check, smoke

**Files:**
- Create: `web/rush/audio.js`
- Create: `tests/rush/audio.test.js`
- Create: `tests/rush/build.test.js`
- Create: `tests/rush/smoke.cjs`
- Modify: `web/rush/game.js`
- Modify: `web/index.html`
- Modify: `main_test.go`

- [ ] `audio.js`: gate (pitch depends on good/bad), hit, battle, coins, win/loss, the toggle in `rush.audio`
- [ ] hub card (`--rush`), RO string, `/rush/*` paths in `main_test.go`
- [ ] `audio.test.js` and `build.test.js` (scripts exist, no external URLs, RO translations for all `t(` strings)
- [ ] `tests/rush/smoke.cjs`: menu → level 1, hold → (keyboard) for a few seconds, wait for the finish, check the result screen, `rush.save`, no console errors, RO
- [ ] run `node --test`, `go test ./...`, the smoke — must pass before next task

### Task 10: «Тесная парковка» — rules, parsing and BFS solver

**Files:**
- Create: `web/parking/core.js`
- Create: `tests/parking/core.test.js`
- Create: `tests/parking/solver.test.js`

- [ ] UMD `root.ParkingCore`: `parseLevel(def)` with validation, `newGame(level)`, `canMove(state, id, delta)`, `move(state, id, delta)` (barriers by move parity, `tow` by 1 cell, bollards), the exit and `status`
- [ ] `undo(state)` restores the full state; move limit and `stars(moves, optimal)` by the rules in Technical Details
- [ ] `solve(level|state)`: BFS over (positions, parity), returns `{moves, path}` or `null`, cap of 200k states
- [ ] write tests: moving only along the axis, blocking by vehicles/bollards/walls, a barrier closed/open by parity, a tow truck by 1 cell, exiting through the exit, undo, the limit runs out → `lost`, stars at the boundaries
- [ ] write tests for `solve`: a trivial board (1 move), a known board with a hand-checked optimum, a board where the optimum needs to wait for the barrier, an unsolvable board → `null`, invalid levels → `parseLevel` throws
- [ ] run tests — must pass before next task

### Task 11: «Тесная парковка» — level generator and 40 levels

**Files:**
- Create: `tests/parking/generate.js`
- Create: `web/parking/levels.js`
- Create: `tests/parking/levels.test.js`

- [ ] `tests/parking/generate.js` (run by hand: `node tests/parking/generate.js > web/parking/levels.js`): a seeded generator of random boards, picking by optimum with `solve`, deduplication, writing out the UMD `root.ParkingLevels`
- [ ] generate 40 levels by the difficulty curve from Technical Details (barriers and tow trucks from level 12, 7×7 from level 26) and commit `levels.js`
- [ ] write `levels.test.js`: every level parses, the stored `optimal` equals `solve`, the optimum follows the difficulty bands, there are no duplicates, levels with barriers/tow trucks/7×7 are where the curve says
- [ ] run tests — must pass before next task

### Task 12: «Тесная парковка» — rendering, dragging, hints, screens and saving

**Files:**
- Create: `web/parking/index.html`
- Create: `web/parking/style.css`
- Create: `web/parking/view.js`
- Create: `web/parking/game.js`
- Create: `web/parking/lang.js`
- Create: `tests/parking/view.test.js`
- Create: `tests/parking/progress.test.js`

- [ ] `view.js` (UMD): board layout for the screen, `cellAt`, `vehicleAt`, `dragTarget(state, id, pointerDelta)` → the allowed shift (no passing through obstacles)
- [ ] `game.js`: top view of the lot (markings, the exit with an arrow, bollards, a barrier with an open/closed animation), cars/buses/the tow truck with shading, smooth movement and snapping, the car leaving after the win
- [ ] screens: menu, level select with stars, HUD (moves/limit, optimum after the win, «Отменить», «Заново», «Подсказка» ×3), result; keyboard control; `parking.progress` (`loadProgress`/`saveProgress`/`unlocked` in `core.js`)
- [ ] `lang.js` with RO; `index.html` with no external URLs
- [ ] write `view.test.js` (hit-test, `dragTarget` stops at an obstacle, at the edge, at a closed barrier) and `progress.test.js` (saving, broken JSON, best stars, unlocking)
- [ ] run tests — must pass before next task

### Task 13: «Тесная парковка» — sound, hub registration, offline check, smoke

**Files:**
- Create: `web/parking/audio.js`
- Create: `tests/parking/audio.test.js`
- Create: `tests/parking/build.test.js`
- Create: `tests/parking/smoke.cjs`
- Modify: `web/parking/game.js`
- Modify: `web/index.html`
- Modify: `main_test.go`

- [ ] `audio.js`: slide, bump, barrier, victory; the toggle in `parking.audio`
- [ ] hub card (`--parking`), RO string, `/parking/*` paths in `main_test.go`
- [ ] `audio.test.js` and `build.test.js` (scripts exist, no external URLs, RO translations)
- [ ] `tests/parking/smoke.cjs`: menu → level 1, solve it by dragging along the path from `solve` (read from `ParkingCore`/`ParkingLevels` in the page), check 3★ in the UI and in `parking.progress`, undo, no console errors, RO
- [ ] run `node --test`, `go test ./...`, the smoke — must pass before next task

### Task 14: Verify acceptance criteria
- [ ] verify all requirements from Overview are implemented in all three games: menu, levels, progress saving, sound toggle, RU/RO, phone control, no external resources
- [ ] verify edge cases: broken `localStorage`, a reload in the middle of a level, a narrow screen of 360 px, switching language on any screen
- [ ] run full test suite: `node --test 'tests/**/*.test.js'` and `go vet ./... && go test ./...`
- [ ] run the e2e smoke of all three games: `NODE_PATH=/opt/node22/lib/node_modules node tests/{pins,rush,parking}/smoke.cjs`
- [ ] verify that every `core.js`/`view.js`/`audio.js` of the new games is covered by tests (every exported function is called in some test)

### Task 15: [Final] Update documentation
- [ ] `README.md`: the first line «Пятнадцать браузерных игр…»; a short intro about «Игры из рекламы» and three sections (`/pins/`, `/rush/`, `/parking/`) in the style of the existing ones: rules, controls, saving, where the rules live, how the levels are verified
- [ ] `docs/roadmap.md`: mention that the other ad games (Save the Survivor, Hero Evolution, Build & Defend, Water Sort, Last Castle) are queued
- [ ] update CLAUDE.md if new patterns were found (there is no file — don't create one unless needed)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Items requiring manual intervention or external systems — no checkboxes, informational only*

**Manual verification**:
- play through a few levels of each game on a phone: the pin-pull gesture, steering the crowd with a finger, dragging cars
- the feel of the difficulty curve; fine tuning of the levels after playing by hand
- check the sound on iOS Safari (unlock on the first gesture)

**Next steps**:
- the remaining five concepts (Water Sort, Last Castle, Hero Evolution, Build & Defend, Save the Survivor) as separate plans
- if needed, a leaderboard for the «Числовой забег» endless mode through the existing `/api/boards/{game}/scores`
