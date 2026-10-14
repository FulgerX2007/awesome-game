# «Игры из рекламы», часть 2: Цветные колбы и Последняя крепость

## Overview
- Ещё две игры из той же коллекции «игр из рекламы» (первая часть: `docs/plans/completed/20261014-ad-games-trio.md`).
  Это 16-я и 17-я игры репозитория:
  1. **«Цветные колбы»** (RO: «Eprubete colorate»), `/sort/`. Спокойная логическая головоломка: в колбах лежат цветные слои,
     игрок переливает их, пока в каждой колбе не останется один цвет. Вместимость колб ограничена.
     - Отмена хода без ограничений.
     - Одна лишняя пустая колба на уровень, она стоит одну звезду.
     - 60 уровней, от 3 до 12 цветов.
     - Звёзды за число ходов относительно «пара», найденного решателем.
  2. **«Последняя крепость»** (RO: «Ultima cetate»), `/castle/`. Аркадная оборона, вид сбоку. Лучник стоит на стене слева,
     справа волнами идут монстры: пехота, щитоносцы, летуны, тараны, боссы.
     - Прицеливание оттяжкой мышью или пальцем; видна дуга полёта, стрелы летят по параболе.
     - Между волнами — выбор одного из трёх улучшений (лук, скорострельность, стрелы) и починка или укрепление стены за золото.
     - Кампания из 30 волн и бесконечный режим. Рекорды бесконечного режима идут в серверную таблицу `/api/boards/castle/scores`.
- Обе игры законченные, как первые три:
  - меню, выбор уровня или режима, прогресс в `localStorage`;
  - звук с переключателем, RU/RO, управление с телефона;
  - работа без сети: никаких внешних ресурсов. Отправка рекорда — best effort, без сети игра продолжается.
- Названия, уровни, графика (рисуется кодом на Canvas 2D) и правила свои. Это не копии коммерческих игр.
- Попутно исправить `docs/roadmap.md`: описания Save the Survivor и Hero Evolution там разошлись с исходными концепциями.
  - Save the Survivor — это выживание зимой в лесу: дерево, еда, костёр, дом, звери, спасение выживших.
  - Hero Evolution — это RPG-аркада: выбор оружия, брони и магии по пути, враги с разной защитой, боссы, постоянная прокачка.

## Context (from discovery)
- Go-сервер `main.go` встраивает `web/` (`//go:embed web`). Каждая игра живёт в `web/<name>/`.
- **Образцы прошлого плана (повторять их структуру):**
  - `web/parking/`:
    - головоломка с уровнями;
    - BFS-решатель в `core.js`;
    - генератор уровней `tests/parking/generate.js` → `web/parking/levels.js`;
    - звёзды за оптимум;
    - отмена хода;
    - подсказки, которые считаются кусками между кадрами (`solverFor`);
    - сохранение уровня в процессе (`currentOf` / `resume`).
  - `web/rush/`:
    - фиксированный шаг 1/60 с через аккумулятор;
    - экономика и улучшения;
    - боты в `tests/rush/bot.js`: умный, «небрежный» с шумом прицела и глупый;
    - тесты баланса по нескольким сидам;
    - магазин;
    - демо-автопилот за меню.
  - `web/pins/`: экраны меню → уровни → игра → результат, `recordWin` в момент победы.
  - Во всех трёх играх:
    - `audio.js` (`window.<Game>Audio` с `{enabled, setEnabled, unlock, play(name, opts)}`, ключ `<game>.audio`);
    - `build.test.js`: офлайн, переводы, плейсхолдеры `{…}`, карточка хаба, пути в `main_test.go`;
    - `smoke.cjs`.
- **Таблица рекордов:**
  - сервер: `boardGames` в `main.go:125` (`echo`, `valley`, `wonders`, `bastion`), `internal/leaderboard`;
  - клиент `web/bastion/game.js:9-10,749-761`: `NAME_KEY`, `BOARD_URL`, поле имени, `fetch POST {name, score, level}`;
  - список досок на хабе: `web/index.html:~110`, массив `games`;
  - Go-тесты досок: `main_test.go`.
- Регистрация игры:
  - карточка и CSS-переменная в `web/index.html`; новые игры идут первыми, вместе с остальными играми из рекламы;
  - пути в `main_test.go:21`;
  - README («Пятнадцать браузерных игр…» → «Семнадцать»; раздел «## Игры из рекламы»);
  - `docs/roadmap.md`;
  - порядок карточек проверяют `tests/{rush,parking}/build.test.js`, их нужно обновить.
- Тесты: `node --test 'tests/**/*.test.js'`, `go vet ./... && go test ./...`,
  `NODE_PATH=/opt/node22/lib/node_modules node tests/<game>/smoke.cjs` (Playwright, Chromium в `/opt/pw-browsers`).
- В прошлом плане полезные проверки добавляли уже ревьюеры. Здесь они заложены сразу:
  - победа сохраняется в момент её обнаружения;
  - тяжёлые вычисления на главном потоке режутся на куски;
  - баланс проверяется независимым «небрежным» ботом, а не только автопилотом, по которому он настроен;
  - каждый уровень проверен по смыслу (механика в нём действительно нужна);
  - плейсхолдеры переводов совпадают.

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
- run tests after each change: `node --test 'tests/**/*.test.js'` and `go vet ./... && go test ./...`
- maintain backward compatibility:
  - other games and the server API stay untouched;
  - the only exceptions are registering the new games and adding `castle` to `boardGames`.
- duplicate small helpers (safe storage, rng, audio engine) per game instead of a shared module, as the repo already does
- the plan is executed autonomously:
  - settle judgment calls (exact numbers, colours, texts) yourself and log them as `[decision]` in the progress file;
  - if balance numbers change after a bot run, update the tables in this plan.

## Testing Strategy
- **unit tests (JS)**: `tests/<game>/*.test.js` load `web/<game>/core.js` (and `levels.js`, `view.js`, `audio.js`) via `require`.
  Tests live in `tests/`, outside the embedded FS.
- **level verification**:
  - `sort`:
    - every level is solvable and has no colour already sorted at the start;
    - the stored `par` equals the solver's result, which is exact up to the size the solver proves (see Technical Details);
    - replaying the solver's path solves the level.
  - `castle`:
    - a competent bot and an independent "casual" bot (aim noise, reaction lag, random upgrade picks) play the campaign
      on several seeds;
    - a bot with no upgrades loses early;
    - the endless mode always ends.
- **unit tests (Go)**: the new static paths in `main_test.go:21`; `castle` accepted by `/api/boards/castle/scores` (POST and GET).
- **offline test**: `build.test.js` for each game checks:
  - no `http://` or `https://` in `web/<game>/`;
  - only relative paths in `index.html`, plus `../i18n.js` and `../nav.js`;
  - in `castle`, the only `fetch` target is exactly `'/api/boards/castle/scores'`: same origin, no scheme, no `//`.
- **e2e smoke**: `tests/<game>/smoke.cjs` in the same style as `tests/pins/smoke.cjs`:
  - free port, `go run` with `-data ""`;
  - block requests outside the server;
  - play through with real input;
  - no console errors, progress lands in `localStorage`, RO on a 360 px phone.

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope
- keep plan in sync with actual work done

## Solution Overview
- Same architecture as the first part:
  - `core.js`: deterministic rules, no DOM, serializable state;
  - `view.js`: pure client helpers (layout, hit-testing, projection, ballistics preview);
  - `audio.js`: synthesized WebAudio;
  - `game.js`: browser IIFE with Canvas 2D and DOM screens;
  - `lang.js`: RO strings.
- Screens: menu → level select (sort) / mode select (castle) → game → result. Progress is saved the moment it is earned,
  never only after an animation.
- **Sort.** Levels come from a seeded generator plus a solver: `tests/sort/generate.js` → `web/sort/levels.js` with `par`.
  - The hint solver is not needed: the game has unlimited undo instead.
  - When no move is left, the game says so and offers «Отменить» and «Лишняя колба».
- **Castle.** Real-time simulation with a fixed step of 1/60 s.
  - The run is a roguelite: upgrades last until the run ends.
  - Between runs only these are kept:
    - campaign progress (best wave reached, campaign completed);
    - best endless score.
  - The endless score goes to the existing leaderboard API, like «Бастион».

## Technical Details

### 1. «Цветные колбы» (`/sort/`)

**State**
- `tubes`: an array of arrays of colour indices, bottom to top.
- `cap`: tube capacity, 4 (5 from level 41).
- `moves` and `history` for undo. History entries are `{pour: [from, to, n]}` or `{addTube: true}`.
- `extraUsed`: whether the spare tube has been added.
- `status`: `playing` | `won` | `stuck`.

**Pour from A to B** is allowed when:
- A is not empty;
- A ≠ B;
- B is not full;
- B is empty, or its top colour equals A's top colour.

The whole run of same-coloured top layers of A moves, as many as fit in B. One pour is one move.

**End of the level**
- **Win:** every tube is empty, or full with one colour.
- **`stuck`:** stuck ⇔ there is no legal pour, or every legal pour moves a uniform tube into an empty tube.
  Back-and-forth pours keep the game `playing` even when it can no longer be won. That is acceptable, because undo is unlimited.

**Spare tube**
- `addTube(state)` adds one empty tube, once per level, and records `{addTube: true}` in the history.
- Undo is LIFO: undoing `addTube` removes the tube and clears `extraUsed`, so 3★ is possible again and the tube can be added again later.
- `current` (the level in progress) stores the same history entries, and `resume` replays them.
- Finishing with `extraUsed` true caps the result at 2★.

**Stars**
- 3★: `moves ≤ par` and no spare tube.
- 2★: `moves ≤ par + max(2, ⌈par·0.25⌉)`, or 3★ conditions met but the spare tube was used.
- 1★: any win.
- There is no move limit (a calm game).

**Solver** `solve(level, opts)`:
- Canonical state key: the tubes sorted as strings, because the order of tubes doesn't matter.
- Pruning:
  - don't pour out of a uniform full tube;
  - don't pour a uniform tube into an empty one;
  - of several empty tubes, consider only one.
- Search: A* with an admissible heuristic, the number of colour boundaries above the lowest layer in each tube.
- `solve` returns `{moves, path}`, or `null` when the level is unsolvable or the search goes over `maxStates` (default 300k).
- The plan review prototyped this A*:
  - 12 colours × capacity 5 solved in ≤104k states and ≤1.6 s;
  - 10 × 4 solved in ≤43k states and ≤0.55 s.

  So there is no fallback search: the generator rejects boards that come back `null`.
- The canonical key is only for the visited set:
  - states keep the real tube order;
  - `path` is a list of `[from, to]` real tube indices that replays on `newGame(level)` without remapping.
- In the browser the solver isn't needed; it runs in tests and in the generator.

**Levels**
- 60 levels from `tests/sort/generate.js`:
  - seeded shuffles of `colors × cap` layers into `colors` tubes, plus 2 empty tubes;
  - reject boards that are too easy (par below the band's lower bound) or start with a sorted tube;
  - within each band, sort the accepted levels by par instead of rejecting by an upper bound;
  - write `{ tubes, cap, par, solution }`.
- Difficulty bands. The colour count is the hard rule; the par numbers are the lower bounds measured by the plan review's
  prototype (7×4 ≈ 21, 10×4 ≈ 30, 12×4 ≈ 35–38, 9×5 ≈ 36–40, 12×5 ≈ 47–53):

| Levels | Colours | Empty tubes | Capacity | par lower bound | par generated |
|---|---|---|---|---|---|
| 1–5 | 3–4 | 2 | 4 | 5 | 5–8 |
| 6–20 | 5–7 | 2 | 4 | 12 | 13–21 |
| 21–40 | 8–10 | 2 | 4 | 22 | 23–34 |
| 41–60 | 9–12 | 2 | 5 | 29 | 35–53 |

➕ Calibration (20 boards per colour count, Task 2), par min/median/max:
3×4 4/7/10, 4×4 9/12/14, 5×4 12/15/17, 6×4 16/18/20, 7×4 19/22/24, 8×4 22/25/28, 9×4 25/27/30, 10×4 27/31/34,
9×5 29/37/39, 10×5 38/40/44, 11×5 42/45/47, 12×5 46/50/53. The worst A* run expanded 12.4k states (11×5, 0.34 s).
The whole generator takes 0.3 s, so `levels.test.js` checks that its output equals the committed `levels.js`.

- The generator first runs a calibration pass (20 boards per colour count and capacity) and adjusts the lower bounds
  if the measured distribution differs. It logs the result as a `[decision]` and updates this table.

**Colours**
- 12 clearly different colours.
- Each one also has a small pattern or symbol on the layer (dots, stripes…), so colour-blind players can tell them apart.

**Client**
- Tubes in one or two rows.
- Tap a tube to lift it, tap another to pour: the tube tilts, a stream flows, the levels animate.
- An illegal pour shakes the tube.
- Undo button (unlimited), «Заново», «Лишняя колба».
- `sort.progress` holds `{v:1, stars, current}`; `current` is the level in progress as its list of moves, restored on reload.

### 2. «Последняя крепость» (`/castle/`)

**World**
- Side view, units are metres; ground at `y = 0`; the castle wall occupies `x ∈ [0, 3]`, top at `y = 8`.
- The archer stands at `(2, 9.5)`. Enemies spawn at `x = 60` and walk left.

**Arrows**
- Ballistic: `v0` from aim power (max `V_MAX`, upgradable), angle −85°…+80° (➕ was −30°: Task 7 showed enemies at the wall's foot could not be hit at all), gravity is a tunable constant `G` (start at 9.8 m/s², tune for feel). No wind.
- An arrow hits the first enemy box it crosses (swept segment-vs-box per tick), or the ground (it sticks, then fades).
- Pierce upgrade: the arrow passes through N enemies.
- Multishot upgrade: extra arrows at ±4° per extra arrow.

**Firing** (the same rule everywhere: here, in Task 7 and in the `setFiring` tests)
- Pointer down starts aiming and firing.
- While held, the bow fires at the reload rate along the current aim. The first arrow goes as soon as the current cooldown ends.
  Ads show this as the "rain of arrows".
- Release stops firing and fires nothing extra.
- The aim comes from the drag vector relative to where the touch started, not from the archer's position.

**Enemies** (start values; the bot tunes them):

| id | RU | HP | speed m/s | trait |
|---|---|---|---|---|
| `grunt` | Пехотинец | 3 | 1.6 | — |
| `shield` | Щитоносец | 4 | 1.2 | a shield on the front: an arrow whose flight angle at impact is shallower than 35° below horizontal does 1/4 damage. Lobbed arrows from above do full damage. |
| `flyer` | Нетопырь | 2 | 2.4 | flies at y 6–10 with a sine bob, attacks the archer's ward, not the wall |
| `ram` | Таран | 18 | 0.7 | wall damage ×4 |
| `boss` | Вожак | 60 + 12·bossIndex (bossIndex = wave / 10) | 0.6 | every 10th wave; summons grunts at 50% HP |

- **Ward:** starts with 1 charge and refills at every wave start. Each charge destroys one flyer on contact.
- ➕ Geometry (found in Task 5): the archer stands at 9.5 m, so close to the wall every arrow comes down steeply.
  The shield rule (shallower than 35° → ¼ damage) therefore protects shield-bearers at range only (beyond ~25–30 m).
  Near the wall they take full damage. Pierce helps against crowds that overlap along the arrow's descending path,
  not against a spaced line.
- ➕ Core API in Task 5:
  - `startWave(run, list)` takes an explicit spawn list `[{ kind, at, x?, hpMul?, speedMul? }]`, or `waveDef(...)` from Task 6 when it is omitted;
  - `drain(run)` returns and clears `run.events`;
  - `flight(run, angle, power, t)` is the closed-form arrow position for the preview and the bots.

- An enemy that reaches the wall (`x ≤ 3`) stops and hits the wall every second for its wall damage.
- Flyers hit the ward instead; if they get through it, they hit the wall.
- At wall HP 0 the run is lost.

**Waves**
- `waveDef(n, seed)`: a deterministic composition.
  - Waves 1–3 are hand-made for teaching: grunts, then shields, then flyers.
  - Then a budget grows ~12% per wave and is spent on the enemy types unlocked so far.
  - A wave has at most 40 enemies. Budget beyond that becomes an HP and speed multiplier for the wave's enemies,
    which keeps late waves and the bot simulations fast.
  - Every 10th wave is a boss wave.
- **Modes:**
  - The campaign ends after clearing wave 30.
  - Endless starts at wave 1 with the same `waveDef`, has no end, and is otherwise identical.
  - `castle.save.current` holds one run of either mode. Starting a new run when one exists asks before overwriting it.
- Gold for each kill; a bonus for a wave lost without wall damage.

**Between waves**
- Pick 1 of 3 upgrades, drawn from the run's seeded rng:

| id | effect |
|---|---|
| `power` | +20% arrow damage |
| `reload` | −12% reload time |
| `velocity` | +10% max arrow speed |
| `pierce` | +1 pierce |
| `multi` | +1 arrow |
| `fire` | burning: 1 dmg/s for 3 s |
| `ward` | +1 ward charge against flyers |

- Upgrades stack additively, with caps:
  - `multi` up to 4 arrows;
  - `pierce` up to 3;
  - reload time no lower than 40% of base;
  - `ward` up to 3 charges.

  Capped upgrades are no longer offered.
- Shop (start values, tunable):
  - «Починить стену»: +25% of max HP, 30 gold, ×1.3 per purchase;
  - «Укрепить стену»: +20% max HP and heals the same amount, 50 gold, ×1.4 per purchase.

**Run and save**
- Run state is a serializable object.
- The campaign is won when wave 30 is cleared.
- Snapshots are taken:
  - at each wave start;
  - at each wave clear, including the drawn upgrade offer and the rng state, so a reload shows the same 3 cards;
  - after each upgrade pick or purchase.
- A reload during a wave restarts that wave. A reload on the between-wave screen keeps the cleared wave, the same offer and what was bought.
- `campaignBest` is updated at wave clear.
- `castle.save` holds:
  - `{v:1, campaignBest, campaignDone, endlessBest}`;
  - the run `current`.

**Score**
- Endless score = `kills·10 + (wave − 1)·100`, shown before the score is sent.
- Name field and POST `{name, score, level: wave}` to the same-origin URL `const BOARD_URL = '/api/boards/castle/scores'`.
  This is a root-absolute path, as in `web/bastion/game.js:10`. A relative `api/...` would resolve to `/castle/api/...` and give 404.
- Failures are ignored quietly; the game works offline.
- `main.go` `boardGames` gets `"castle"`, and the hub's `games` list of boards gets the castle entry («волна {n}»).

**API**
- `newRun(mode, seed)`;
- `aim(run, angle, power)`;
- `setFiring(run, bool)`;
- `step(run, dt)`: a fixed-tick accumulator, as in rush;
- `chooseUpgrade(run, id)`;
- `buy(run, item)`;
- `startWave(run)`;
- `status(run)`;
- `score(run)`;
- `waveDef(n, seed)`.

**Helpers in view.js**
- `trajectory(origin, angle, power, g, n)` for the dotted arc preview;
- `aimFromDrag(dx, dy)`.

**Bots** (in tests):
- **Competent:**
  - solves the ballistic equation for each target with lead;
  - prefers rams, then the nearest;
  - lobs at shield enemies;
  - picks upgrades by a fixed priority;
  - repairs below 50%.
- **Casual:** aim noise ±6°, power noise ±10%, 0.3 s reaction lag, random upgrade picks, repairs below 25%.
- **No-upgrades:** competent aim, but always skips upgrades and the shop.
- Bots re-plan every ~6 ticks, not every tick, to keep the balance tests fast.
- ➕ Measured after tuning (Task 7, 5 seeds):
  - competent clears the campaign 5/5;
  - casual clears it 5/5;
  - no-upgrades falls at waves 17–18;
  - endless (competent) ends at waves 55–56.

  Changes that got there:
  - the competent bot shoots whoever reaches the wall first (heavy hitters count double) instead of rams first;
  - the aim goes down to −85°;
  - past wave 30 the budget grows by 1.16 a wave instead of 1.12.

  The enemy and upgrade numbers stayed at their start values. The two balance files run in ~10 s.

**Balance targets** (the bot tunes the numbers):
- the competent bot clears the 30-wave campaign on all 5 seeds;
- the casual bot clears it on ≥ 3 of 5 seeds, and otherwise reaches wave ≥ 20;
- the no-upgrades bot falls by wave 12–18;
- in endless mode the competent bot always falls by wave 60 (the scaling guarantees an end).
- If a target is still unreachable after tuning:
  - log ⚠️ in this plan with the measured numbers and the closest targets reached;
  - loosen that target by at most one step (for example casual ≥ 2/5) instead of stalling.

### Shared
- Storage keys: `sort.progress`, `sort.audio`, `castle.save`, `castle.audio`, `castle.name`.
- Sounds are synthesized:
  - sort: lift tube, pour (gurgle whose length depends on the layers), tube complete (chime), win, stuck;
  - castle: draw bow, release, hit, shield clank, enemy death, wall hit, wave start horn, upgrade pick, win, lose.
- Hub colours: `--sort: #c38bff`, `--castle: #d9a35b`. System font stack.

## What Goes Where
- **Implementation Steps**: code, levels, tests, docs, the leaderboard registration inside the repository.
- **Post-Completion**: manual check on a phone, tuning the feel of aiming by hand.

## Implementation Steps

### Task 1: «Цветные колбы» — rules and solver in core.js

**Files:**
- Create: `web/sort/core.js`
- Create: `tests/sort/core.test.js`
- Create: `tests/sort/solver.test.js`

- [x] UMD `root.SortCore`:
  - `parseLevel(def)` with validation: equal counts per colour, `cap` 3–6, layers fit;
  - `newGame(level)`, `canPour`, `pour` (moves the whole same-coloured top run as far as it fits);
  - `undo`, `addTube` (once per level, undoable while the tube is empty);
  - `status` (`playing` / `won` / `stuck`), `stars(state)`.
- [x] progress helpers like parking:
  - `loadProgress` / `saveProgress` (tolerant of broken JSON and blocked storage), `recordStars`, `unlocked`, `firstUnfinished`;
  - `currentOf` / `resume` for the level in progress.
- [x] `solve(level, {maxStates})`: A* over canonical states with the pruning rules from Technical Details.
  It returns `{moves, path}`, or `null` when the level is unsolvable or the search goes over `maxStates`.
  - The canonical key is only for the visited set.
  - `path` is a list of `[from, to]` real tube indices that replays on `newGame(level)` without remapping.
- [x] write tests for the rules:
  - partial pours;
  - pouring a whole run;
  - pouring onto a different colour or into a full tube is refused;
  - `stuck` detection, including the "only useless moves" case;
  - undo across `addTube`;
  - stars at the boundaries;
  - progress load/save with broken data;
  - `currentOf` / `resume`.
- [x] write tests for the solver:
  - hand-checked small boards with known optima, verified by brute force;
  - an unsolvable board gives `null`;
  - the returned path replays to a win;
  - the path replays from `newGame(level)` using real indices;
  - a 9 × 5 test board finishes under the default `maxStates`.
- [x] run tests — must pass before next task

### Task 2: «Цветные колбы» — generator and 60 levels

**Files:**
- Create: `tests/sort/generate.js`
- Create: `web/sort/levels.js`
- Create: `tests/sort/levels.test.js`
- Create: `tests/sort/par.test.js`

- [x] `tests/sort/generate.js` (run by hand: `node tests/sort/generate.js > web/sort/levels.js`):
  - seeded shuffles by the difficulty bands from Technical Details;
  - rejects boards with a sorted tube at the start or with par outside the band;
  - writes the UMD `root.SortLevels = { LEVELS }` with `{ tubes, cap, par, solution }`.
- [x] run the calibration pass from Technical Details; adjust the par lower bounds if needed and update the bands table (log a `[decision]`).
- [x] generate the 60 levels and commit `levels.js`. The generator logs its runtime to stderr.
- [x] write `levels.test.js`:
  - every level parses;
  - no tube is sorted at the start;
  - colours and capacity follow the bands;
  - `par` is the length of the stored `solution`, and replaying it wins;
  - `solve` confirms `par` on levels 1–40 and on every 5th level of 41–60. The re-solve check lives in its own file
    `tests/sort/par.test.js`, so `node --test` runs it in parallel;
  - there are no duplicates;
  - par does not drop within a band.
- [x] run tests — must pass before next task

### Task 3: «Цветные колбы» — page, rendering, input, screens and saving

**Files:**
- Create: `web/sort/index.html`
- Create: `web/sort/style.css`
- Create: `web/sort/view.js`
- Create: `web/sort/game.js`
- Create: `web/sort/lang.js`
- Create: `tests/sort/view.test.js`

- [x] `view.js` (UMD):
  - `layout(nTubes, cap, viewport)`: one row up to 7 tubes, two rows above that, fits 360 px;
  - `tubeAt(layout, x, y)` with a padded hit area;
  - the pour-animation timeline helper.
- [x] `game.js` drawing:
  - glass tubes with highlights;
  - liquid layers with a meniscus and the colour-blind pattern;
  - lift on select;
  - a tilt-and-stream pour animation;
  - a shake on an illegal move;
  - a sparkle when a tube completes.
- [x] `game.js` flow:
  - stars are recorded the moment the win is detected (`recordStars` + `saveProgress` before the animation);
  - the move in progress is saved after every move;
  - the «stuck» banner offers «Отменить» and «Лишняя колба».
- [x] screens:
  - menu;
  - level select (60 levels, stars, locks);
  - HUD: level, «Ходы n», «Пар n», undo, restart, spare tube;
  - result.
- [x] `lang.js` with all RO strings; `index.html` with no external URLs. Keyboard:
  - digits 1–9 and 0 pick tubes 1–10, Q W E R Y pick tubes 11–15;
  - arrows plus Enter also pick tubes;
  - Z undo, Backspace restart, T spare tube, Esc deselect.
- [x] write `view.test.js`:
  - the layout fits at 360 / 768 / 1280 px for 5, 9 and 15 tubes (12 colours + 2 empty + the spare);
  - `tubeAt` hits and misses;
  - animation timeline boundaries.
- [x] run tests — must pass before next task

### Task 4: «Цветные колбы» — sound, hub registration, offline check, smoke

**Files:**
- Create: `web/sort/audio.js`
- Create: `tests/sort/audio.test.js`
- Create: `tests/sort/build.test.js`
- Create: `tests/sort/smoke.cjs`
- Modify: `web/sort/index.html`
- Modify: `web/index.html`
- Modify: `main_test.go`
- Modify: `tests/rush/build.test.js`
- Modify: `tests/parking/build.test.js`

- [x] `audio.js` (`window.SortAudio`): lift, pour (`{layers}`), complete, win, stuck; the toggle is in `sort.audio`. Load it before `game.js`.
- [x] hub card (`--sort`, RU text plus RO string), placed first. The hub order becomes `sort, parking, rush, pins`. Add the `/sort/*` paths to `main_test.go`.
  Update the card-order assertions in `tests/{rush,parking}/build.test.js` (for example `slice(0, 4)`), and rename the parking test title «first among the ad games».
- [x] write `audio.test.js` and `build.test.js`:
  - scripts exist and load in order;
  - no external URLs;
  - RO for every Russian string, with matching `{…}` placeholders;
  - hub card and its order;
  - `main_test.go` paths.
- [x] write `tests/sort/smoke.cjs`:
  - menu → level 1;
  - solve it by tapping along the level's stored `solution`;
  - check 3★ in the UI and in `sort.progress`;
  - undo mid-level, spare tube on level 2;
  - reload mid-level restores the board;
  - RO on a 360 px phone, no console errors, no external requests.
- [x] run `node --test`, `go test ./...`, the sort smoke, and re-run the pins/rush/parking smokes (the hub changed) — must pass before next task

### Task 5: «Последняя крепость» — world, arrows, enemies and wall in core.js

**Files:**
- Create: `web/castle/core.js`
- Create: `tests/castle/core.test.js`

- [x] UMD `root.CastleCore`:
  - world constants;
  - `newRun(mode, seed)`;
  - `aim`, `setFiring`;
  - `step(run, dt)` with a 1/60 s fixed-tick accumulator, at most 0.25 s per call; `dt ≤ 0` or NaN is ignored.
- [x] arrows:
  - ballistic flight;
  - swept segment-vs-box hits;
  - ground hits;
  - pierce and multishot;
  - the impact angle passed to the damage rule (shield enemies take 1/4 damage from shallow hits);
  - burning damage over time.
- [x] enemies and wall:
  - `grunt`, `shield`, `flyer`, `ram`, `boss` with the traits from Technical Details;
  - walking and stopping at the wall;
  - wall damage per second;
  - flyers hit the ward, then the wall;
  - the boss summons grunts at 50% HP;
  - wall HP 0 loses the run;
  - kills pay gold;
  - `run.events` records `fire`, `hit`, `shieldHit`, `kill`, `wallHit` and `waveClear` for animations and sounds.
- [x] write tests:
  - the arrow trajectory matches the closed-form parabola;
  - a hit at a steep angle against a shield does full damage, at a shallow angle 1/4;
  - pierce passes through N enemies;
  - multishot spread;
  - a ram does ×4 wall damage;
  - flyers versus the ward;
  - the boss summons at half HP;
  - losing at wall 0;
  - determinism (same inputs give the same run);
  - `dt` slicing gives the same result.
- [x] write tests for errors and edges: invalid `aim` values are clamped, `step` with bad `dt` is ignored, `setFiring` before a wave starts does nothing.
- [x] write tests for the firing rule: with firing held, the first arrow goes when the cooldown ends, then one per reload; release fires nothing extra.
- [x] run tests — must pass before next task

### Task 6: «Последняя крепость» — waves, upgrades, shop, saving and score

**Files:**
- Modify: `web/castle/core.js`
- Create: `tests/castle/waves.test.js`

- [x] waves:
  - `waveDef(n, seed)`: teaching waves 1–3, a growing budget, unlocking of enemy types, boss every 10th wave;
  - at most 40 enemies per wave, with the extra budget becoming an HP/speed multiplier;
  - campaign end at 30, endless with no end;
  - `startWave`, wave clear and the no-damage bonus; the ward refills at each wave start.
- [x] upgrades and shop:
  - `offerUpgrades(run)` draws 3 different ones from the run's seeded rng and never offers capped ones;
  - `chooseUpgrade` applies one: additive stacking with the caps from Technical Details;
  - `buy(run, 'repair'|'fortify')` with the start prices and growth from Technical Details;
  - refusals: no gold, wall already full for repair, unknown item.
- [x] save and score:
  - `castle.save` helpers `loadSave` / `storeSave` / `recordRun`, tolerant of broken data;
  - one `current` run of either mode;
  - `snapshot` / `restore` at wave start, at wave clear (with the drawn offer and rng state) and after each pick or purchase;
  - `campaignBest` updated at wave clear;
  - `score(run) = kills·10 + (wave − 1)·100`.
- [x] write `waves.test.js`:
  - `waveDef` is deterministic, its budget grows, and the enemy count cap holds;
  - teaching waves have the enemy types they are meant to teach;
  - boss waves; upgrade offers are distinct, seeded and respect caps;
  - stacking and caps;
  - shop prices and refusals;
  - snapshot/restore round-trip, including a reload on the between-wave screen keeping the cleared wave, the same 3 offers and purchases;
  - broken saves fall back to defaults;
  - the score formula.
- [x] run tests — must pass before next task

### Task 7: «Последняя крепость» — bots and balance tuning

**Files:**
- Modify: `web/castle/core.js` (tuning numbers only)
- Create: `tests/castle/bot.js`
- Create: `tests/castle/balance-campaign.test.js`
- Create: `tests/castle/balance-endless.test.js`

- [x] `tests/castle/bot.js`:
  - competent, casual and no-upgrades bots that only use the core API;
  - they re-plan every ~6 ticks;
  - the competent bot solves the ballistic equation with lead and lobs at shield enemies.
- [x] `balance-campaign.test.js` (5 seeds):
  - competent bot clears the campaign on 5/5;
  - casual clears it on ≥ 3/5 and otherwise reaches wave ≥ 20;
  - no-upgrades falls at waves 12–18.
- [x] `balance-endless.test.js`: endless always ends by wave 60 for the competent bot on 5 seeds. The test files are split so `node --test` runs them in parallel; keep each under ~60 s.
- [x] tune enemy, wave and upgrade numbers until the targets hold, and update the tables in this plan.
  If a target is still unreachable, follow the fallback rule in Technical Details: ⚠️ note with measured numbers, loosen by at most one step.
- [x] run tests — must pass before next task

### Task 8: «Последняя крепость» — rendering, aiming, screens and saving

**Files:**
- Create: `web/castle/index.html`
- Create: `web/castle/style.css`
- Create: `web/castle/view.js`
- Create: `web/castle/game.js`
- Create: `web/castle/lang.js`
- Create: `tests/castle/view.test.js`

- [x] `view.js` (UMD):
  - `fit(viewport)` maps world metres to pixels; the whole field 0–60 m is visible on a phone held landscape or portrait;
  - `aimFromDrag(dx, dy)` gives angle and power from the drag vector relative to where the touch started, like a slingshot (pull back to shoot forward);
  - `trajectory(...)` gives the preview points;
  - number formatting.
- [x] `game.js` drawing:
  - sky with a day-to-dusk gradient by wave, distant hills, ground;
  - a stone wall with battlements and cracks by HP stage;
  - the archer with the bow drawing back;
  - a dotted arc preview;
  - flying arrows, arrows stuck in the ground or enemies;
  - enemy walk and attack animations with hit flashes;
  - the shield spark on a shallow hit, fire, death puffs;
  - floating damage numbers and screen shake when the wall is hit.
- [x] input:
  - pointer down anywhere starts aiming and firing; the drag sets angle and power; firing follows the rule in Technical Details > Firing (first arrow after the current cooldown, release stops and fires nothing extra);
  - keyboard: ←/→ angle, ↑/↓ power, Space fire/hold, P pause, Esc menu.
- [x] screens:
  - menu: «Кампания» (continue from saved wave), «Бесконечный режим», records, sound, RU/RO;
  - between waves: 3 upgrade cards plus shop;
  - HUD: wave, wall HP bar, gold, ward charges;
  - result.

  Progress is saved the moment it is earned. Snapshots follow Technical Details > Run and save.
  Starting a new run while one is saved asks before overwriting it.
- [x] `lang.js` with RO; `index.html` with no external URLs.
- [x] write `view.test.js`:
  - `fit` keeps the field visible at 360×640, 640×360 and 1280×800;
  - `aimFromDrag` clamps;
  - `trajectory` matches `CastleCore`'s flight;
  - formatting.
- ➕ Found while checking screenshots:
  - the field is capped at 0.62 of its width (`MAX_ASPECT`), so a portrait phone gets a centred band instead of a tower of sky;
  - aiming listens on the whole stage, so the empty space around the band works as a pull area;
  - wave 1 on a portrait phone tips to rotate the phone.
- [x] run tests — must pass before next task

### Task 9: «Последняя крепость» — leaderboard, sound, hub registration, offline check, smoke

**Files:**
- Modify: `main.go`
- Modify: `main_test.go`
- Create: `web/castle/audio.js`
- Modify: `web/castle/index.html`
- Modify: `web/castle/game.js`
- Modify: `web/index.html`
- Create: `tests/castle/audio.test.js`
- Create: `tests/castle/build.test.js`
- Create: `tests/castle/smoke.cjs`
- Modify: `tests/{rush,parking,sort}/build.test.js`

- [x] server: add `"castle"` to `boardGames` in `main.go`; Go test that POST and GET `/api/boards/castle/scores` work.
- [x] client: at the end of an endless run, show the score and a name field (`castle.name`), then POST it to `const BOARD_URL = '/api/boards/castle/scores'` (root-absolute, as in `web/bastion/game.js:10,749-761`). A network error shows a quiet note and never blocks the game.
- [x] hub:
  - castle card (`--castle`, RO string), first among the ad games;
  - castle entry in the hub's list of boards right after bastion, reusing the existing `'волна {n}'` RO key;
  - hub card order becomes `castle, sort, parking, rush, pins`;
  - `/castle/*` paths in `main_test.go`;
  - update the card-order assertions in the other `build.test.js` files.
- [x] `audio.js` (`window.CastleAudio`): draw, release, hit, shield, death, wall, horn, upgrade, win, lose; the toggle is in `castle.audio`. Load it before `game.js`.
- [x] write `audio.test.js` and `build.test.js`:
  - scripts in order;
  - no `http(s)://`; the only `fetch` target is exactly `'/api/boards/castle/scores'`;
  - RO with matching placeholders;
  - hub card and board entry;
  - `main_test.go` paths.
- [x] write `tests/castle/smoke.cjs`:
  - campaign wave 1 played by real pointer drags aimed with `view.aimFromDrag`/`trajectory` from the page;
  - wave clear, then an upgrade pick;
  - reload restores the run at the wave start;
  - an endless run that ends: before load, seed `localStorage['castle.save']` with an endless `current` snapshot built in the page by `CastleCore` (`newRun('endless', seed)`, wall HP set to 1). Let one grunt reach the wall, check the score screen, then POST;
  - score POST lands in the board (GET shows it);
  - RO on a 360 px phone, no console errors, no external requests.
- ➕ Additions made during this task:
  - `game.js` exposes `window.castleDebugRun()`, a read-only view of the run, so the smoke can aim at real monsters;
  - on narrow screens the pause button shows only its icon, so the HUD stays on one line;
  - the touch check sends real touch events through CDP.
- [x] run `node --test`, `go vet ./... && go test ./...`, the castle smoke, and re-run all ad-game smokes — must pass before next task

### Task 10: Verify acceptance criteria
- [ ] verify every requirement from the Overview in both games: menu, levels or modes, progress saving, sound toggle, RU/RO, phone control, offline play, leaderboard best effort
- [ ] verify edge cases:
  - broken or blocked `localStorage`;
  - reload mid-level (sort) and mid-wave (castle);
  - 360 px and 320 px screens;
  - switching language on every screen;
  - leaderboard request failing (server returns 500, or no network)
- [ ] run full test suite: `node --test 'tests/**/*.test.js'` and `go vet ./... && go test ./...`
- [ ] run the e2e smoke of every ad game: `NODE_PATH=/opt/node22/lib/node_modules node tests/{pins,rush,parking,sort,castle}/smoke.cjs`
- [ ] verify every export of the new `core.js`/`view.js`/`audio.js` is exercised by tests (name grep plus a call-recording hook, as in the previous plan)

### Task 11: [Final] Update documentation
- [ ] `README.md`:
  - first line «Семнадцать браузерных игр…»;
  - two new subsections in «## Игры из рекламы» describing what was actually built: rules, controls, stars and economy, storage keys, how levels and balance are verified;
  - the sort generator command;
  - `castle` in the README list of leaderboards (the line that names `echo`, `valley`, `wonders` и `bastion`)
- [ ] `docs/roadmap.md`:
  - update the line «Последними вышли…» to name the two new games, and remove them from the list;
  - restore the original concepts for Save the Survivor (winter survival: wood, food, fire, house, animals, rescuing survivors) and Hero Evolution (RPG arcade: weapons, armour and magic picked along the way, enemies with different defence types, bosses, permanent progression);
  - keep Build & Defend
- [ ] update CLAUDE.md if new patterns were found (there is no file — don't create one unless needed)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Items requiring manual intervention or external systems — no checkboxes, informational only*

**Manual verification**:
- play several sort levels on a phone: tap targets in two rows, readability of colours and patterns
- the feel of aiming in castle on a phone: drag length versus power, whether the preview arc helps, fatigue from holding
- check the sound on iOS Safari (unlock on the first gesture)

**Next steps**:
- the remaining three concepts as separate plans: Hero Evolution, Build & Defend, Save the Survivor
