# «Долгая зима»: улучшения дома, мастерская, события дня, торговец и медведь-шатун

## Overview
- The first content expansion of «Долгая зима» (`/winter/`), merged in #16 with the fixes from #18. Today the winter
  runs out of new things to do around day 10. By then the hut is repaired, the tools are made and the survivors are
  found. After that the player only keeps the fire going and fights wolves. This plan adds goals for the second half
  of the winter and makes the days different from each other.
- **Улучшения дома** (unlocked after the fourth hut stage, the stove). Each is paid in parts, like the hut:
  - **Утепление** (moss and hides): the stove burns slower, and the hut stays warm even in deep cold without it.
  - **Погреб**: the camp holds more food.
  - **Коптильня**: smokes raw meat and fish on its own, without the fire. Smoked food is more filling.
  - **Пристройка**: a warm room for the survivors. They heal faster and work faster.
  - **Мастерская**: new things to make:
    - **шуба** from hides (the hero gets colder more slowly);
    - **фонарь** (a light around the hero that wolves keep out of);
    - **сани** (carry more);
    - **силки** (snares that catch rabbits overnight).
- **Шкуры**: a new resource. They come from deer, the bear and the trader, and are needed for the coat and the
  insulation.
- **Мелкие события дня**: at most one per day, picked at dawn, some of them with a choice:
  - **Обвал кровли в метель**: repair it now with materials, or live with a hole in the roof.
  - **Раненый путник** in the forest: give him food for a reward, or walk past.
  - **Пропавший ребёнок** (once the child is at the camp): find him in the forest before night.
  - **Северное сияние**: a calm, clear night with no wolves and a burst of strength.
  - **Оттепель**, then **наледь**: a warm day, then a day of slippery ice crust where the hero walks slower.
- **Торговец на санях**: comes to the camp gate every few days and stays until night. He trades metal, stone, tools
  and food for meat, fish and hides.
- **Медведь-шатун**: on some days a bear roams the forest by day. He hits hard, is afraid of fire and torches,
  cannot enter a lit camp, and gives a lot of meat and hides.
- Everything stays within the conventions of the game:
  - rules live in the DOM-free `core.js`;
  - art is drawn in code on Canvas 2D in `game.js`;
  - RU/RO strings, synthesized sound, saving to `localStorage`, phone controls;
  - no network.
- An old save from before the expansion (`winter.save`, snapshot v1) still loads. The missing fields get defaults.

## Context (from discovery)
- **Files and areas involved:**
  - `web/winter/core.js` (about 1180 lines). It holds the constants, `newGame`, `warmthRate`, `burnTick`,
    `statsTick`, `workTick`, `craft`, `needOf`/`contribute`/`finishStage`, `survivorsTick`, `animalsTick`,
    `wolvesTick`/`wolfMasks`, `dayTick`, `tick`, `nextTask`/`TASK_TEXTS`, `snapshot`/`restore`, the save helpers
    and one big export list.
  - `web/winter/view.js`: the camera, `lights(g)`, `darkness(g)`, `edgeMarker` and `clock`.
  - `web/winter/game.js` (about 2000 lines):
    - drawing: `drawPerson`, the animal and wolf drawers, the night layer;
    - HUD pills;
    - panels: «Постройки», «Верстак»;
    - `handle(events)` for floats, banners and sounds;
    - debug hooks `winterDebugGame` and `winterDebugCam`.
  - `web/winter/index.html`, `style.css`, `lang.js` (RO strings keyed by the Russian text) and `audio.js`
    (`play(name)`, `setLoop`).
  - Tests:
    - `tests/winter/{core,base,balance-normal,balance-harsh,view,audio,build}.test.js`;
    - the bots in `tests/winter/bot.js`: greedy, casual, noShelter;
    - `tests/winter/smoke.cjs`, which runs Playwright.
- **Patterns to follow:**
  - Partial contributions go through `needOf(g, id)` and `contribute(g, id)`, with ids like `'hut'`, `'palisade:2'`,
    `'bunk:0'`. The new buildings use the same path with new ids. They do not get their own pay function.
  - `TOOLS` and `craft(g, tool)` are the workbench. The workshop items use a gated list on the same `craft`.
  - The core pushes events (`g.events`). `game.js` turns them into floats, banners and sounds.
  - The day's work happens in `dayTick` (dawn, night). Randomness comes only from the seeded `rand(g)`, so a seed
    replays the same winter.
  - Wolves avoid lit tiles (`lit`) and are kept out of the camp by the palisade (`wolfMasks`). The bear reuses that
    idea.
  - The balance tests run the bots on 5 seeds:
    - greedy survives normal 5/5, with 4–5 survivors;
    - greedy survives harsh 3/5;
    - casual survives 5/5;
    - noShelter dies by day 14.
- **Dependencies:** none new. Everything stays plain JS, and the Go server does not change.

## Development Approach
- **testing approach**: Regular (code first, then tests in the same task).
- Complete each task fully before moving to the next.
- Make small, focused changes.
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task:
  - tests are not optional; they are a required part of the checklist;
  - write unit tests for new functions;
  - write unit tests for modified functions;
  - add new test cases for new code paths;
  - update existing test cases if behaviour changes;
  - tests cover both success and error scenarios (`'nores'`, `'far'`, `'bad'`, locked items, broken saves).
- **CRITICAL: all tests must pass before starting the next task.** No exceptions.
- **CRITICAL: update this plan file when scope changes during implementation.**
- Run `node --test 'tests/**/*.test.js'` after each change.
- Keep backward compatibility. Old `winter.save` snapshots restore, and the rules a winter without the new content
  depends on stay as they are.

## Testing Strategy
- **Unit tests** (`node --test`):
  - the rules of every new feature in `core.js`;
  - helpers in `view.js` (lights, the aurora);
  - `audio.js` names;
  - `build.test.js` (files, RO keys, the page wiring).
- **Balance**:
  - The bots learn the new content: the upgrades, the workshop, the trader and the event choices.
  - The greedy bot runs away from the bear.
  - The existing thresholds stay.
  - New thresholds:
    - the greedy bot finishes at least 3 of the 5 upgrades by day 30 (normal);
    - the bear kills no bot on normal that has the camp lit;
    - events never kill a greedy winter by themselves.
- **E2E**: `tests/winter/smoke.cjs` grows in the same task as the UI:
  - the building and workshop panels show the new rows;
  - a seeded trader visit opens the trade panel;
  - an event choice modal works by mouse and by touch;
  - the bear draws without page errors.
  - Run it as
    `NODE_PATH=/opt/node22/lib/node_modules PW_CHROMIUM=/opt/pw-browsers/chromium node tests/winter/smoke.cjs`.

## Progress Tracking
- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with the ➕ prefix.
- Document issues and blockers with the ⚠️ prefix.
- Update the plan if implementation deviates from the original scope.
- Keep the plan in sync with the actual work done.

## Solution Overview
- **One data-driven table per feature in `core.js`**: `UPGRADES`, `WORKSHOP_ITEMS`, `EVENTS`, `TRADES` and
  `BEAR`. Each entry holds its cost and condition, and the effects are read where the rules already live:
  - `warmthRate`, `burnTick` and `statsTick`: the insulation, the coat;
  - `roomFor`: the cellar;
  - `survivorsTick`: the annex;
  - `lit` and `wolfMasks`: the lantern;
  - `gain` / `CARRY`: the sled.

  This keeps every number in one place, where the bots and tests can reach it.
- **Upgrades are buildings, not hut stages.** The hut stays four stages, and the stars and the old saves keep their
  meaning. `g.upgrades = { insulation: { built, paid }, … }`. They go through `needOf` and `contribute` with ids
  `'up:insulation'` and so on, and are gated on `g.hut.stage >= 4`.
- **Events are a small state machine.**
  - `g.event` is `null` or `{ id, day, phase, … }`.
  - At dawn `pickEvent(g)` rolls one event from those whose conditions hold, or none. It never rolls the same event
    on two days in a row.
  - Choice events wait in phase `'ask'` until `answerEvent(g, choice)` resolves them.
  - The game is **not** paused while a choice is open, but the modal is shown at dawn, when nothing is attacking.
  - Map events (the wanderer, the lost child) place an entity that the hero walks to with `interact`.
- **The trader** is a scheduled visitor, not an event:
  - `g.trader` is `null` or `{ x, y, until, offers: [...] }`;
  - he comes on the days in `TRADER_DAYS`;
  - his offers are rolled from `TRADES` with the seeded rng;
  - `trade(g, i)` returns `'ok' | 'nores' | 'far' | 'gone' | 'bad'`.
- **The bear** is a third kind of creature next to animals and wolves, in its own `bearTick`.
  - It roams by day, chases the hero within sight, and avoids lit tiles and the camp.
  - It leaves at night (it goes back to its den).
  - `BEAR.days` per difficulty decide when it comes.
- **Saves:** the snapshot stays `v: 1`. `restore` runs a small `migrate(o)` first, which fills the new fields
  (`stock.hide`, `stock.smokedMeat`, `stock.smokedFish`, `upgrades`, `items`, `snares`, `event`, `trader`, `bear`)
  with defaults. Then it validates them like the old ones. A v1 save from before the expansion restores and plays on.

## Technical Details
- **New stock keys:**
  - material: `hide`. It counts toward `STORE_CAP`.
  - food:
    - `smokedMeat`: fills 45;
    - `smokedFish`: fills 35.

  All eating orders (`eat`, `survivorsTick`, the bot `FOODS`) put the smoked food first.
- **Hides** come from:
  - deer: 1 each;
  - the bear: 4;
  - the trader;
  - the wanderer's reward.

  Rabbits give none.
- **`UPGRADES`.** All require `hut.stage >= 4`, and everything is tunable in the balance task.

  | id | cost | effect |
  |---|---|---|
  | `insulation` | wood 30, hide 4 | the stove burns ×0.6 as fast; inside the hut without the stove, `chill × 0.15` instead of `× 0.4` |
  | `cellar` | wood 20, stone 30 | `FOOD_CAP` +100 |
  | `smokehouse` | wood 25, stone 15 | every 15 s, if the stock has wood, turns 1 raw meat (or fish) into smoked, using 1 wood per 3 items |
  | `annex` | wood 40, stone 20, metal 4 | home survivors are always warm; hp regen ×2; work timers ×0.75 |
  | `workshop` | wood 30, stone 10, metal 6 | unlocks `WORKSHOP_ITEMS` in «Верстак» |

  The camp spots of the new buildings are added to `SPOT`. The free tiles inside `BASE` are checked in the task,
  because the hut, fire, bench, bed and bunks already take some.
- **`WORKSHOP_ITEMS`.** They go through `craft`, which returns `'locked'` without the workshop.

  | id | cost | effect |
  |---|---|---|
  | `coat` | hide 6 | `chill × 0.7` for the hero |
  | `lantern` | metal 4, wood 2 | the hero is a light source of radius 2 at night; wolves won't step into it; the bear will |
  | `sled` | wood 20, metal 2 | `CARRY` 40 → 80 |
  | `snares` | wood 6 | gives 2 snares; up to 4 can be placed outside the camp with `placeSnare(g, x, y)`; at dawn each catches a rabbit (1 meat) with chance 0.6 |
- **`EVENTS`.** Each entry is `{ id, when(g), start(g), choices?, resolve(g, choice) }`.
  - **The roll:** at dawn, 45% chance of an event (harsh: 55%), picked uniformly from those whose `when` holds.
    Day 1 and the last day have no events.
  - **`roof`**:
    - when: a blizzard day, the hut at stage ≥ 2, the roof whole;
    - the choice is «Чинить сейчас» (wood 15, stone 5) or «Потом»;
    - «Потом» sets `g.hut.roofHole = true`: the hut's chill factor is back to 1 and sleeping no longer runs faster;
    - repair later through `contribute(g, 'roof')`.
  - **`wanderer`**:
    - a stranger lies at a free tile 8–14 tiles from the camp until night;
    - `interact` on him asks for 2 food (smoked, cooked or fish);
    - the reward is rolled: metal 6, or hide 3, or a tool the hero lacks;
    - at night he leaves.
  - **`lostChild`**:
    - when: the child is at home;
    - the child walks off to a tile 10–16 tiles away and waits there in state `'lost'`;
    - the hero brings him back with `rescue`;
    - if night falls first, the child loses 40 hp; he comes home on his own at dawn.
  - **`aurora`**:
    - no wolves this night, and the hero and the survivors get +20 energy at nightfall;
    - `view.js` adds the aurora to the night sky.
  - **`thaw`**:
    - the temperature is +8 for the day;
    - the next day is `ice` (наледь): `SPEED × 0.8` outside the camp.
- **The trader:**
  - `TRADER_DAYS = { normal: [4, 9, 14, 19, 24], harsh: [5, 11, 17, 23] }`;
  - he arrives at dawn at the south gate (`SPOT.trader`, outside the palisade) and leaves at nightfall;
  - `TRADES` holds about 10 entries: `{ give: { meat: 4 }, get: { metal: 3 } }`, `{ give: { hide: 3 }, get: { metal: 5 } }`,
    `{ give: { fish: 4 }, get: { stone: 12 } }`, `{ give: { meat: 6 }, get: { tool: <one the hero lacks> } }`,
    `{ give: { hide: 2 }, get: { smokedMeat: 3 } }`, and so on;
  - each visit offers 3 rolled trades plus one fixed hide → metal trade;
  - every offer can be taken once per visit.
- **The bear** (`BEAR`):
  - stats: `hp 14`, `bite 22`, `speed 2.4`, `cd 1.8`, sight 7 tiles;
  - days: normal `[8, 15, 21, 26]`, harsh `[6, 11, 15, 19, 23, 27]`;
  - spawns at dawn at the map edge far from the camp, and wanders between random forest tiles;
  - chases the hero within sight;
  - never steps on lit tiles or inside `BASE`, and doesn't attack survivors at home;
  - at night it leaves;
  - when killed, it drops meat 8 and hide 4, then `{ type: 'bearDead' }`.

  Hits use the existing hero attack (`interact` on the bear), with the spear doing 2.
- **New API** (exported):
  - `contribute(g, 'up:<id>')` and `contribute(g, 'roof')`;
  - `craft(g, '<workshop item>')`;
  - `placeSnare(g, x, y)`;
  - `answerEvent(g, choice)`;
  - `trade(g, i)`;
  - `upgradeOn(g, id)`.

  Plus the constants `UPGRADES`, `WORKSHOP_ITEMS`, `EVENTS` (ids and choices), `TRADES`, `TRADER_DAYS` and `BEAR`.
- **New events for the client:**
  - `event` (start), `eventDone`;
  - `trader`, `traderLeft`, `traded`;
  - `bear`, `bearHit`, `bearDead`;
  - `snareCaught`;
  - `smoked`;
  - `built` with an `id` of `up:<id>` or `roof`.
- **Hints (`nextTask`):** new lines, kept in the `TASK_TEXTS` list the test checks:
  - «Почини крышу»;
  - «Торговец у ворот»;
  - «Медведь рядом: беги к огню»;
  - «Найди ребёнка до ночи»;
  - «Помоги путнику».

  The upgrades are suggested after the old goals are done.

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): code changes, tests and documentation in this repository.
- **Post-Completion** (no checkboxes): manual play on a phone.

## Implementation Steps

### Task 1: Hides, smoked food and save migration in core.js

**Files:**
- Modify: `web/winter/core.js`
- Modify: `tests/winter/core.test.js`
- Modify: `tests/winter/base.test.js`

- [ ] add `hide` to the materials, and `smokedMeat` and `smokedFish` to `FOOD`; put smoked food first in every eating order (`eat`, `survivorsTick`, `nextTask`)
- [ ] deer drop 1 hide; carrying and caps count hides as a material
- [ ] add `migrate(o)` before validation in `restore`, filling all new fields with defaults (this task's fields, plus stubs for later tasks: `upgrades`, `items`, `snares`, `event`, `trader`, `bear`)
- [ ] write tests:
  - hides from deer;
  - eating order with smoked food;
  - caps.
- [ ] write tests for saves:
  - a v1 snapshot without the new fields restores and plays on;
  - a snapshot with bad new fields is refused.
- [ ] run the tests; they must pass before Task 2

### Task 2: House upgrades in core.js

**Files:**
- Modify: `web/winter/core.js`
- Create: `tests/winter/upgrades.test.js`

- [ ] add `UPGRADES` and `g.upgrades`, with `needOf`/`contribute` for `'up:<id>'`, gated on hut stage 4 (`'locked'` before that)
- [ ] pick free camp tiles for the cellar hatch, the smokehouse, the annex and the workshop; add them to `SPOT`; keep the buildings out of paths and wolf masks the way the hut is
- [ ] add the effects:
  - insulation in `burnTick` and `warmthRate`;
  - cellar in `roomFor`;
  - smokehouse tick in `burnTick`/`tick`;
  - annex in `survivorsTick`;
  - `upgradeOn(g, id)`.
- [ ] write tests:
  - each upgrade is locked before stage 4, then paid in parts, then built;
  - the effect of each upgrade, measured against the same game without it;
  - `'nores'`, `'far'`, `'built'`.
- [ ] run the tests; they must pass before Task 3

### Task 3: Workshop items in core.js

**Files:**
- Modify: `web/winter/core.js`
- Modify: `tests/winter/upgrades.test.js`

- [ ] add `WORKSHOP_ITEMS` and `g.items`; `craft` accepts them, returning `'locked'` without the workshop
- [ ] coat in `warmthRate`; lantern in `lit` and `wolfMasks` (a light around the hero at night); sled in `gain` (carry 80)
- [ ] snares: `placeSnare(g, x, y)` outside the camp (up to 4, tiles must be free); catches at dawn with the seeded rng; `{ type: 'snareCaught' }`
- [ ] write tests:
  - every item is locked, crafted, and its effect works;
  - the lantern keeps a wolf off the hero;
  - snares: placement rules (inside the camp, too many, a blocked tile) and catches over several dawns with a fixed seed.
- [ ] run the tests; they must pass before Task 4

### Task 4: Day events in core.js

**Files:**
- Modify: `web/winter/core.js`
- Create: `tests/winter/events.test.js`

- [ ] add `EVENTS`, `g.event` and `pickEvent(g)` at dawn in `dayTick`; `answerEvent(g, choice)`
- [ ] roof: `g.hut.roofHole` and its effects (chill, no fast sleep), plus `contribute(g, 'roof')`
- [ ] wanderer: placed on a free reachable tile; `interact` gives food and rolls the reward; he leaves at night
- [ ] lost child: the `'lost'` state, a path out, `rescue` brings him back, the night penalty
- [ ] aurora: no wolves that night, the energy bonus. Thaw and ice: the temperature and the speed outside the camp
- [ ] write tests:
  - each event starts only when its condition holds, and resolves each way;
  - no event on day 1, and none twice in a row;
  - a seed replays the same events.
- [ ] write tests for edge cases: an answer with no event, a bad choice, the wanderer with no food, a save/restore in the middle of every event
- [ ] run the tests; they must pass before Task 5

### Task 5: Trader in core.js

**Files:**
- Modify: `web/winter/core.js`
- Create: `tests/winter/trader.test.js`

- [ ] add `TRADES`, `TRADER_DAYS` and `g.trader`: he arrives at dawn on his days, rolls offers, and leaves at nightfall
- [ ] `trade(g, i)` returns `'ok' | 'nores' | 'far' | 'gone' | 'taken' | 'bad'`; a tool offer only lists tools the hero lacks
- [ ] write tests:
  - the schedule per difficulty;
  - the offers repeat for a seed;
  - every trade result;
  - the stock caps on what he gives.
- [ ] write a test that the trader survives a save/restore
- [ ] run the tests; they must pass before Task 6

### Task 6: Bear in core.js

**Files:**
- Modify: `web/winter/core.js`
- Create: `tests/winter/bear.test.js`

- [ ] add `BEAR` and `g.bear`; spawn on its days at the map edge; `bearTick`: wander, chase within sight, never enter lit tiles or `BASE`, leave at night
- [ ] the hero attacks it through `interact` (the spear does 2); it bites hard; the meat and hide drop; the events
- [ ] write tests:
  - the schedule;
  - it chases a hero in the open;
  - it stops at the edge of the light and of the palisade;
  - it leaves at night;
  - the kill and its drop;
  - it does nothing on non-bear days.
- [ ] run the tests; they must pass before Task 7

### Task 7: Bots and balance

**Files:**
- Modify: `tests/winter/bot.js`
- Modify: `tests/winter/balance-normal.test.js`
- Modify: `tests/winter/balance-harsh.test.js`

- [ ] the bots learn the new content:
  - the upgrade goals after the old ones (insulation, cellar, smokehouse, workshop, annex);
  - the coat and the sled;
  - snares;
  - trading (hides → metal);
  - answering events («чинить» when affordable; help the wanderer when food is plentiful; fetch the lost child).
- [ ] the bots run from the bear into the light; noShelter keeps its old shortcuts
- [ ] tune the numbers in `UPGRADES`, `WORKSHOP_ITEMS`, `EVENTS`, `TRADES` and `BEAR` until:
  - the old thresholds hold;
  - greedy builds ≥ 3 upgrades on normal;
  - the bear kills no greedy hero on normal.
- [ ] write the new balance assertions; log the tuning steps in this plan with ➕
- [ ] run the tests; they must pass before Task 8

### Task 8: Rendering: camp buildings, upgrades and snares

**Files:**
- Modify: `web/winter/game.js`
- Modify: `web/winter/view.js`
- Modify: `tests/winter/view.test.js`

- [ ] draw the upgrades:
  - insulation: moss and hide strips on the hut walls;
  - the cellar hatch;
  - the smokehouse with smoke while it works;
  - the annex next to the hut;
  - the workshop shed.

  Also draw ghost outlines for unbuilt upgrades once stage 4 is done, and a hole in the roof for `roofHole`.
- [ ] draw snares (and a caught rabbit at dawn); draw the lantern glow around the hero; add the lantern to `V.lights`
- [ ] write tests for the `view.js` changes (the lantern light only at night, and only with the lantern)
- [ ] run the tests; they must pass before Task 9

### Task 9: Rendering: bear, trader, wanderer, lost child and the aurora

**Files:**
- Modify: `web/winter/game.js`
- Modify: `web/winter/view.js`
- Modify: `tests/winter/view.test.js`

- [ ] the bear: a big body, a walk cycle, a swipe when it bites, a hp bar; screen-edge markers when it is near
- [ ] the trader's sled with a reindeer and bells at the gate; the wanderer lying in the snow, with a badge; the lost child, with an edge marker
- [ ] the aurora: `V.aurora(g)` (strength over the night), drawn as moving bands over the dark layer
- [ ] write tests for `V.aurora`, and for edge markers covering the new targets
- [ ] run the tests; they must pass before Task 10

### Task 10: UI: panels, the event modal, the trade panel and the HUD

**Files:**
- Modify: `web/winter/game.js`
- Modify: `web/winter/index.html`
- Modify: `web/winter/style.css`
- Modify: `web/winter/lang.js`
- Modify: `tests/winter/build.test.js`

- [ ] «Постройки»:
  - an «Улучшения дома» section (locked until stage 4, partial payment like the hut);
  - «Починить крышу» while `roofHole` is set.
- [ ] «Верстак»: the workshop items below the tools, locked with a reason until the workshop is built; a snare placement mode like torches
- [ ] an event modal with the event text and its choice buttons (keyboard, mouse, touch); a trade panel opened by a tap on the sled
- [ ] a hide pill in the HUD; banners and floats for the new events; the new hints
- [ ] all new strings in RO; write the `build.test.js` checks (no missing RO keys, new element ids present)
- [ ] run the tests; they must pass before Task 11

### Task 11: Sound and the smoke test

**Files:**
- Modify: `web/winter/audio.js`
- Modify: `tests/winter/audio.test.js`
- Modify: `tests/winter/smoke.cjs`

- [ ] sounds: `roar`, `bells`, `trade`, `snare`, `aurora` (a soft shimmer), `creak` (the roof)
- [ ] write audio tests for the new names
- [ ] smoke, desktop:
  - with a seeded state, build the workshop, then craft the coat in the panel;
  - open the trader on his day and make a trade;
  - answer the roof event in the modal;
  - draw a bear for a few seconds without page errors.
- [ ] smoke, phone: the event modal and the trade panel at 360 px in RO, by touch, with no horizontal scroll
- [ ] run the smoke 3 times in a row; it must pass every time

### Task 12: Verify acceptance criteria
- [ ] verify all requirements from the Overview are implemented
- [ ] verify edge cases:
  - old saves;
  - events across save and reload;
  - a trader and a bear on the same day;
  - the lost child when the child dies;
  - storage full of hides.
- [ ] run the full test suite: `node --test 'tests/**/*.test.js'` and `go vet ./... && go test ./...`
- [ ] run every game smoke (`tests/*/smoke.cjs`): shared files could break other games
- [ ] check that every new export of `core.js` and `view.js` is called by a test

### Task 13: [Final] Update documentation
- [ ] update the «Долгая зима» section in `README.md`: upgrades, the workshop, hides, events, the trader, the bear
- [ ] update `CLAUDE.md` if new patterns were found
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Items requiring manual intervention or external systems; informational only.*

**Manual verification:**
- Play a whole normal winter on a real phone:
  - whether the event modal comes at a good moment;
  - whether the trader is worth visiting;
  - whether the bear is scary but fair;
  - whether the upgrades make the second half of the winter interesting.
- On iOS: the new sounds after the audio unlock.
