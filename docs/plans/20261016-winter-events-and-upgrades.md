# «Долгая зима»: улучшения дома, мастерская, события дня, торговец и медведь-шатун

## Overview
- This is the first content expansion of «Долгая зима» (`/winter/`). The game was merged in #16, and the fixes from #18 are already in.
- **The problem it solves:** around day 10 the winter runs out of new things to do. By then:
  - the hut is repaired;
  - the tools are made;
  - the survivors are found.

  For the rest of the winter the player only keeps the fire going and fights wolves. This plan adds goals for the second half of the winter and makes the days differ.
- **Улучшения дома.** They unlock after the fourth hut stage (the stove). Each is paid in parts, like the hut:
  - **Утепление** (moss and hides): the stove burns slower, and the hut stays warm in the cold even without it.
  - **Погреб**: the camp holds more food.
  - **Коптильня**: smokes raw meat and fish by itself, without the fire. Smoked food fills more.
  - **Пристройка**: a warm room for the survivors. They heal and work faster while the camp has heat.
  - **Мастерская**: new things to make:
    - **шуба** from hides: the hero gets colder more slowly;
    - **фонарь**: wolves that come close flee from it;
    - **сани**: carry more;
    - **силки**: snares that catch rabbits overnight.
- **Шкуры**: a new resource. They come from deer, the bear, the trader and the wanderer, and they pay for the coat and the insulation.
- **Мелкие события дня.** At most one per day, picked at dawn. Some come with a choice:
  - **Обвал кровли в метель**: repair it now with materials, or live with a hole in the roof and patch it later.
  - **Раненый путник** in the forest: give him food for a reward, or walk past.
  - **Пропавший ребёнок** (when the child is at the camp): find him in the forest before night.
  - **Северное сияние**: a calm night without wolves, and a surge of strength.
  - **Оттепель**, then **наледь**: a warm day, then a day of slippery crust.
- **Торговец на санях.** He comes to the camp gate every few days and stays until night. He trades metal, stone, tools and food for meat, fish and hides.
- **Медведь-шатун.** On some days a bear roams the forest by day:
  - he hits hard and is afraid of fire and torches;
  - he never enters the camp;
  - he gives a lot of meat and hides.
- Everything stays within the game's conventions:
  - rules in the DOM-free `core.js`;
  - art drawn in code on Canvas 2D;
  - RU/RO strings and synthesized sound;
  - saving to `localStorage`;
  - phone controls;
  - no network.
- An old save from before the expansion (`winter.save`, snapshot v1) still loads; the missing fields get defaults.
  The old content plays the same for the same seed (see the second rng stream below).
- One plan and one PR, as agreed.

## Context (from discovery)
- **`web/winter/core.js`** (about 1180 lines) holds:
  - the constants;
  - `newGame`, `warmthRate`, `burnTick`, `statsTick`, `workTick`;
  - `interact`, which checks wolves first, then the other targets;
  - `craft`/`TOOLS`;
  - `needOf`, `contribute`, `finishStage`;
  - `canRescue`/`rescue`;
  - `survivorsTick`, `animalsTick`, `wolvesTick`/`wolfMasks`;
  - `dayTick`, `tick`;
  - `nextTask`/`TASK_TEXTS`;
  - `snapshot`/`restore`;
  - the save helpers;
  - one big export list.
- **Other client files:**
  - `web/winter/view.js`: `camera`, `lights(g)`, `darkness(g)`, `edgeMarker`, `clock`.
  - `web/winter/game.js` (about 2000 lines):
    - drawing (`drawPerson`, the animal and wolf drawers, the night layer);
    - the HUD pills, which `game.js:199` fills from `C.RES`;
    - the «Постройки» and «Верстак» panels;
    - `handle(events)`. Today any `built` id other than `hut` or `bunk` goes to the palisade branch.
  - `index.html`, `style.css`, `lang.js` (RO keyed by the Russian text), `audio.js`.
- **Tests:**
  - `tests/winter/{core,base,balance-normal,balance-harsh,view,audio,build}.test.js`;
  - the bots in `tests/winter/bot.js`;
  - `tests/winter/smoke.cjs`.
- **Assertions that must keep holding:**
  - `balance-normal`: greedy wins on 5/5 seeds with ≥ 4 survivors.
  - `balance-normal`: greedy takes **30–65 real minutes**.
  - `balance-normal`: on seed 1, the timeline has `hut:stove ≤ 4`, `palisade:3 ≤ 6` and ≥ 4 `joined:*`.
  - `balance-normal`: casual wins on **≥ 3/5** seeds.
  - `balance-normal`: the first 3 days never kill greedy.
  - `balance-harsh`: noShelter is lost **before day 24** on every seed.
  - `balance-harsh`: greedy wins harsh on ≥ 3/5 seeds.
  - `build.test.js`:
    - every `return '…'` in `nextTask` is in `TASK_TEXTS`;
    - every `TASK_TEXTS` entry has a RO string;
    - every Cyrillic literal in `game.js` has a RO string.
  - `base.test.js:320`: «Держись до весны» once the bunks are built.
  - `core.test.js:68-80`: every recipe's resources are reachable.
- **Patterns to follow:**
  - Partial payments go through `needOf`/`contribute` with colon ids.
  - The core pushes events, and `game.js` turns them into floats, banners and sounds.
  - Dawn and night work lives in `dayTick`.
  - Randomness only comes from a seeded rng kept in the state.
  - Wolves avoid lit tiles and are kept out by the palisade masks.
- **Dependencies:** none new. Plain JS; the Go server doesn't change.

## Development Approach
- **testing approach**: Regular (code first, then tests in the same task).
- Complete each task fully before moving to the next.
- Make small, focused changes.
- **Every task stays green on its own.** A task that adds data or events also adds:
  - the client wiring that reads them (HUD, the `handle` branches, RO strings);
  - the bot's handling of the new content.
- **CRITICAL: every task MUST include new or updated tests** for the code changed in it:
  - tests are not optional; they are a required part of the checklist;
  - write unit tests for new and modified functions, and new test cases for new code paths;
  - update existing test cases if behaviour changes;
  - tests cover both success and error cases (`'nores'`, `'far'`, `'locked'`, `'bad'`, broken saves).
- **CRITICAL: all tests must pass before the next task starts.** No exceptions.
- **CRITICAL: update this plan file when scope changes during implementation.**
- Run `node --test 'tests/**/*.test.js'` and `go vet ./... && go test ./...` after each change.
- Keep backward compatibility. Old snapshots restore, and the old content plays the same for a seed.

## Testing Strategy
- **Unit tests** (`node --test`):
  - the rules of every new feature in `core.js`;
  - the `view.js` helpers;
  - the `audio.js` names;
  - `build.test.js`: RO keys, `TASK_TEXTS`, the new element ids.
- **Balance:**
  - the bots learn each feature in the task that adds it;
  - every existing assertion listed in Context keeps holding;
  - new assertions:
    - greedy builds at least 3 of the 5 upgrades by day 30 (normal);
    - the bear kills no greedy hero on normal;
    - with the lantern, wolves still bite the hero at least once over a greedy winter (the lantern is not immunity).
- **E2E:** `tests/winter/smoke.cjs` grows in the UI task. Run it with
  `NODE_PATH=/opt/node22/lib/node_modules PW_CHROMIUM=/opt/pw-browsers/chromium node tests/winter/smoke.cjs`.

## Progress Tracking
- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with the ➕ prefix.
- Document issues and blockers with the ⚠️ prefix.
- Update the plan if implementation deviates from the original scope.
- Keep the plan in sync with the actual work done.

## Solution Overview
- **A second seeded rng stream, `g.erng`, for all new content**:
  - event rolls;
  - the trader's offers;
  - the wanderer's and the child's tiles;
  - snare catches;
  - the bear.

  Details:
  - it is derived from `seed` in `newGame`;
  - `migrate` gives it a default derived from the seed;
  - `freeTile` gets an rng parameter.

  The old stream `g.rng` keeps driving animals and wolves exactly as before, so the old content of a seed doesn't move. The bot changes are then the only reason for balance shifts.
- **One data table per feature in `core.js`**: `UPGRADES`, `GEAR`, `EVENTS`, `TRADES`/`TRADER_DAYS` and `BEAR`. The effects are read where the rules already live:
  - `warmthRate`, `burnTick` and `statsTick`: insulation, the coat;
  - `roomFor`: the cellar;
  - `survivorsTick`: the annex;
  - `wolvesTick`: the lantern;
  - `carryOf(g)`: the sled.
- **Upgrades are buildings, not hut stages.** The hut stays four stages, so the stars and old saves keep their meaning.
  - State: `g.upgrades = { insulation: { built, paid }, … }`.
  - Ids: `'up:insulation'` and so on, through `needOf`/`contribute`, gated on `g.hut.stage >= 4` (`'locked'` before that).
  - Finishing one pushes `{ type: 'upgraded', id }`. It is a new event type, so the `built` branch of `game.js` isn't touched.
- **Crafted gear is `g.gear`.** The name avoids a clash with `ITEMS`.
  - Values: `{ coat, lantern, sled }` are booleans, and `snares` is a count of snares in hand.
  - `craft` accepts the `GEAR` ids, and returns `'locked'` without the workshop.
- **Events are a small state machine.**
  - `g.event` is `null` or `{ id, day, phase: 'ask' | 'active', … }`.
  - At dawn `pickEvent(g)` may roll one event among those whose condition holds:
    - never on day 1 or the last day;
    - never the same event two days in a row;
    - never on the day after a thaw, because that day is the ice.
  - `answerEvent(g, choice)` resolves an `'ask'` and returns `'ok' | 'nores' | 'none' | 'bad'`. It works anywhere; it doesn't need the camp.
  - An `'ask'` left unanswered at nightfall takes the default choice: «Потом» for the roof, «Пройти мимо» for the wanderer.
  - The choice labels live in `game.js`, where the RO test checks them. The core only knows the choice ids.
- **The lost child** reuses the survivor machinery, with a few changes:
  - a new survivor state `'lost'`, accepted by `restore`;
  - `interact` on a lost child sets a `'fetch'` target; reaching him turns him to `'following'` with `back: true`, skipping `canRescue`;
  - on entering the camp he becomes `'home'` and pushes `{ type: 'found' }`, not `joined`;
  - `stars()` and the bots count `'lost'` as alive;
  - if night falls while he is lost, he loses 40 hp, then walks home by himself at dawn, before the win check;
  - wolves ignore him, as `people()` does today.
- **The trader** is a scheduled visitor, not an event.
  - `g.trader` is `null` or `{ x, y, offers: [{ give, get, taken }] }`.
  - `trade(g, i)` pays from the stock and puts the goods straight into the stock up to `roomFor`, not through `gain`, which has the carry limit. It returns `'ok' | 'nores' | 'far' | 'taken' | 'gone' | 'bad'`.
  - A tool offer names a tool the hero lacks; when he has them all, it becomes 5 metal.
- **The bear** is a third kind of creature, with its own `bearTick`.
  - It roams by day and chases the hero within sight.
  - **It never steps inside `BASE` nor on lit tiles**, so the camp is always safe from it, even with the fire out.
  - It ignores survivors, including those following the hero.
  - It leaves at nightfall.
  - `interact` checks the bear right after wolves.
- **The lantern scares, it doesn't shield.**
  - A wolf that comes within 2 tiles of a hero with the lantern at night flees, the same way a wolf flees in light today.
  - Then it gets a 6 s cooldown before the lantern can scare it again.
  - The lantern is not added to the cached `wolfMasks`. Wolves still plan paths to the hero and can bite between scares.
- **Saves:** the snapshot stays `v: 1`. `restore` runs `migrate(o)` on a copy before validating, and each task adds its own fields to `migrate` and to the validation.

## Technical Details
- **New stock keys:**
  - `hide` (a material) gets its own HUD pill;
  - the food keys `smokedMeat` (fills 45) and `smokedFish` (fills 35).
- **Eating order.** Smoked food goes first everywhere:
  - `eat`;
  - `survivorsTick`;
  - the `nextTask` food list;
  - the bot's `FOODS`.

  The hunter's rescue also accepts smoked meat (raw first, then roast, then smoked).
- **Hides** come from:
  - deer: 1 each (deer need the spear);
  - the bear: 4;
  - the trader;
  - the wanderer's reward.

  Rabbits and snares give none.
- **`carryOf(g)`** is `CARRY` (40), or 80 with the sled. It is used in `gain`, in `full` and in the bot.
- **`UPGRADES`.** All require `hut.stage >= 4`, and all numbers are tuned in Task 9.

  | id | cost | effect |
  |---|---|---|
  | `insulation` | wood 30, hide 4 | the stove burns ×0.6 as fast; in the hut without the stove, `chill × 0.15` instead of `× 0.4` |
  | `cellar` | wood 20, stone 30 | `FOOD_CAP` +100 |
  | `smokehouse` | wood 25, stone 15 | every 15 s, if the stock has wood, 1 raw meat or fish becomes smoked; 1 wood per 3 items; `{ type: 'smoked' }` |
  | `annex` | wood 40, stone 20, metal 4 | home survivors count as warm whenever the fire or the stove burns, with no cold check; hp regen ×2; work timers ×0.75 |
  | `workshop` | wood 30, stone 10, metal 6 | unlocks `GEAR` in «Верстак» |

  The buildings are decorative and don't block walking, like the hut. Free spots in `BASE`:
  - 23–24 × 15–17: the cellar hatch;
  - 23–25 × 22–24: the smokehouse;
  - 29–30 × 16–17, by the hut: the annex;
  - 30–32 × 23–24: the workshop.
- **`GEAR`:**

  | id | cost | effect |
  |---|---|---|
  | `coat` | hide 6 | `chill × 0.7` for the hero |
  | `lantern` | metal 4, wood 2 | at night, wolves within 2 tiles flee (6 s cooldown per wolf); also a light in `V.lights` |
  | `sled` | wood 20, metal 2 | `carryOf` is 80 |
  | `snares` | wood 6 | +2 snares in hand; `'have'` while placed + in hand ≥ 4 |

  Snares:
  - `placeSnare(g, x, y)` places one outside the camp, on a free walkable tile next to the hero;
  - at dawn each placed snare catches with chance 0.6, using `erng`;
  - a catch puts 1 meat into the stock (up to `roomFor`) and pushes `{ type: 'snareCaught', x, y }`;
  - snares don't touch `g.animals`.
- **`EVENTS`.** The roll at dawn is 45% on normal and 55% on harsh, uniform among the eligible events.
  - **`roof`**
    - Condition: a blizzard day, hut stage ≥ 2, no hole yet.
    - Choices: `fix` (wood 15, stone 5; `'nores'` if short) or `later`.
    - `later` sets `g.hut.roofHole = true`, with these effects:
      - in the hut without the stove, the chill factor is 1;
      - sleeping no longer runs faster;
      - the stove burns ×1.5, because the heat escapes. The stove still warms.
    - Patch the hole later with `contribute(g, 'patch')` (same cost), which pushes `{ type: 'patched' }`.
  - **`wanderer`**
    - He lies on a free reachable tile 8–14 tiles from the camp until nightfall.
    - Choices on interacting with him: `help` (2 food: smoked, cooked or fish; `'nores'` without it) or `ignore`.
    - The reward is rolled: metal 6, or hide 3, or a tool the hero lacks.
  - **`lostChild`**
    - Condition: the child is `'home'` and well (hp ≥ 50).
    - The child walks off on a path to a tile 10–16 tiles away.
    - The rest works as described in Solution Overview.
  - **`aurora`**
    - No wolves spawn this night.
    - At nightfall the hero and the home survivors get +20 energy.
    - `V.aurora(g)` gives the strength of the aurora on the night sky.
  - **`thaw`**
    - Days 2–27 only.
    - The temperature is +8 for the day.
    - The next day is `ice` (наледь): speed ×0.8 outside the camp, applied in `moveFree` and `follow`, and it takes that day's event slot.
- **The trader:**
  - `TRADER_DAYS`: `normal: [4, 9, 14, 19, 24]`, `harsh: [5, 11, 17, 23]`.
  - He waits at `SPOT.trader` (27, 26), outside the south gate, from dawn to nightfall. The ring around `BASE` is kept free of nodes.
  - `TRADES` holds about 10 entries. Examples: meat 4 → metal 3, fish 4 → stone 12, meat 6 → a tool, hide 2 → smokedMeat 3.
  - Each visit offers 3 trades rolled with `erng`, plus a fixed hide 3 → metal 5.
  - Each offer can be taken once.
- **`BEAR`:**
  - `hp 14`, `bite 22`, `speed 2.4`, `cd 1.8`, sight 7;
  - days: normal `[8, 15, 21, 26]`, harsh `[6, 11, 15, 19, 23, 27]`;
  - spawns at dawn at the map edge farthest from the camp;
  - drops meat 8 and hide 4;
  - events: `bear`, `bearHit`, `bearDead`, `bearLeft`.
- **New exports:**
  - functions: `carryOf`, `upgradeOn`, `placeSnare`, `answerEvent`, `trade`;
  - constants: `UPGRADES`, `GEAR`, `EVENT_IDS`, `TRADES`, `TRADER_DAYS`, `BEAR`;
  - `contribute` and `craft` take the new ids.
- **Hints.** Each is added in the task of its feature, with `TASK_TEXTS` and its RO string:
  - «Почини крышу»;
  - «Торговец у ворот»;
  - «Медведь рядом: уходи в лагерь»;
  - «Найди ребёнка до ночи»;
  - «Помоги путнику»;
  - «Улучши дом: {name}».

  The last one comes after the old goals but before «Держись до весны». The test at `base.test.js:320` is updated so the upgrades are built in that state.

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): code changes, tests and documentation in this repository.
- **Post-Completion** (no checkboxes): manual play on a phone.

## Implementation Steps

### Task 1: The second rng stream, hides, smoked food and save migration

**Files:**
- Modify: `web/winter/core.js`
- Modify: `web/winter/game.js`
- Modify: `web/winter/index.html`
- Modify: `web/winter/lang.js`
- Modify: `tests/winter/bot.js`
- Modify: `tests/winter/core.test.js`
- Modify: `tests/winter/base.test.js`
- Modify: `tests/winter/build.test.js`

- [x] add `g.erng` (from the seed) and `erand(g)`; `freeTile` takes an rng argument
- [x] add `migrate(o)` in `restore`, working on a copy: `erng` and the new stock keys
- [x] add `hide` to the materials, and `smokedMeat` and `smokedFish` to `FOOD`. Smoked food goes first in `eat`, in `survivorsTick` and in the `nextTask` food list. The hunter accepts smoked meat
- [x] deer drop 1 hide; add the `res-hide` HUD pill (`index.html`, its RO title); the bot's `FOODS` gets the smoked keys
- [x] write tests:
  - a seed plays the old content the same as before, comparing a fixed-seed timeline with and without `erand` calls;
  - hides from deer;
  - the eating order;
  - caps;
  - the hunter with smoked meat.
- [x] write tests for saves:
  - a v1 snapshot without the new fields restores and plays on;
  - bad new fields are refused.

  Also extend `build.test.js` for the `res-hide` id.
- [x] run the tests (`node --test` and `go test`); they must pass before Task 2

### Task 2: House upgrades

**Files:**
- Modify: `web/winter/core.js`
- Modify: `web/winter/game.js`
- Modify: `web/winter/lang.js`
- Modify: `tests/winter/bot.js`
- Create: `tests/winter/upgrades.test.js`
- Modify: `tests/winter/core.test.js`
- Modify: `tests/winter/base.test.js`

- [x] add `UPGRADES`, `g.upgrades` (plus `migrate` and validation), the `'up:<id>'` ids in `needOf`/`contribute` (`'locked'` before stage 4), `upgradeOn(g, id)` and the `{ type: 'upgraded', id }` event
- [x] add the effects:
  - insulation in `burnTick` and `warmthRate`;
  - the cellar in `roomFor`;
  - the smokehouse in `tick`;
  - the annex in `survivorsTick`.

  Add the camp spots to `SPOT`.
- [x] client: a minimal `upgraded` branch in `handle` (banner and sound); the «Улучши дом: {name}» hint with RO strings
- [x] bot: the upgrade goals after the old ones; the timeline records `up:<id>`
- [x] write tests:
  - each upgrade: locked, then paid in parts, then built;
  - each effect, measured against the same game without it;
  - `'nores'`, `'far'`, `'built'`;
  - a save and restore with half-paid upgrades.

  Also extend the reachability test (`core.test.js:68`) with the new costs and hides, and update the hint test (`base.test.js:320`).
- [x] run the tests, including the balance tests; they must pass before Task 3

### Task 3: Workshop gear

**Files:**
- Modify: `web/winter/core.js`
- Modify: `tests/winter/bot.js`
- Modify: `tests/winter/upgrades.test.js`

- [x] add `GEAR`, `g.gear` (plus `migrate` and validation); `craft` accepts it, with `'locked'` and the snare count rules
- [x] coat in `warmthRate`; sled through `carryOf` (`gain`, `full`, the bot)
- [x] lantern in `wolvesTick`: the flee within 2 tiles and the per-wolf cooldown. It doesn't touch the masks
- [x] snares: `placeSnare(g, x, y)` (`'far'`, `'base'`, `'blocked'`, `'none'`, `'max'`) and the dawn catches with `erng`
- [x] bot: the coat and the sled after the workshop; snares near the camp
- [x] write tests:
  - each item: locked, crafted, its effect;
  - with the lantern a wolf flees, then comes back after the cooldown and can bite;
  - the snare placement rules;
  - catches over several dawns with a fixed seed;
  - a save and restore with placed snares.
- [x] run the tests, including the balance tests; they must pass before Task 4
- [x] ➕ the lantern first scared a wolf for 2.5 s with a 6 s cooldown: a lone wolf came back exactly as the cooldown ended and never bit, so it acted as a shield. Now it scares for 1.2 s with an 8 s cooldown, and the wolf returns and bites between scares

### Task 4: Events: roof and wanderer

**Files:**
- Modify: `web/winter/core.js`
- Modify: `web/winter/game.js`
- Modify: `web/winter/lang.js`
- Modify: `tests/winter/bot.js`
- Create: `tests/winter/events.test.js`

- [x] add `EVENTS`/`EVENT_IDS`, `g.event` (plus `migrate` and validation), `pickEvent` at dawn with `erng` and the day rules, `answerEvent` and its result codes, and the default choice at nightfall
- [x] roof: `roofHole` and its effects; `contribute(g, 'patch')`; `{ type: 'patched' }`
- [x] wanderer: placed on a free reachable tile; `interact` on him; the help and ignore choices; the reward; he leaves at night
- [x] client: a temporary banner for an `'ask'` event, and a key (Y/N) to answer it; the full modal comes in Task 10. Add the hints «Почини крышу» and «Помоги путнику» with RO strings
- [x] bot: fix the roof when it can pay; help the wanderer when it has plenty of food; patch a hole later
- [x] write tests:
  - each event starts only when its condition holds and resolves each way;
  - the nightfall default;
  - no event on day 1 or the last day, and none twice in a row;
  - a seed replays the same events;
  - `answerEvent` with no event, or with a bad choice;
  - a save and restore with an `'ask'` open.
- [x] run the tests, including the balance tests; they must pass before Task 5
- [x] ➕ the roof event struck on almost every blizzard of the harsh winter, and each fix or patch took wood when wood was scarcest. Now there are caps per winter (`EVENT_MAX`: roof 2, wanderer 4), and the roof only comes from day 5 with the door hung
- [x] ➕ the hole in the roof was too harsh: no fast sleep pushed greedy past 60 real minutes, and full chill in the hut killed harsh seeds. Now the hut's chill factor is 0.7 instead of 0.4, the stove burns ×1.3, and sleep stays fast
- [x] ➕ the wanderer's tool gift could be the shovel or the ice pick, which skips the gates on the way to the survivors. His tools are now the pick, the spear and the iron axe
- [x] ➕ bot: it left the camp with no wood and froze by dead ashes. Now it fetches a log when there is no fire, no stove and no wood; it walks to the wanderer only with wood and warmth to spare; it fixes the roof only with 30 wood left over

### Task 5: Events: the lost child, the aurora, the thaw and the ice

**Files:**
- Modify: `web/winter/core.js`
- Modify: `web/winter/game.js`
- Modify: `web/winter/lang.js`
- Modify: `tests/winter/bot.js`
- Modify: `tests/winter/events.test.js`

- [x] the lost child:
  - the `'lost'` state, accepted by `restore`;
  - the `'fetch'` target;
  - the `back: true` way home without `joined`;
  - the `found` event;
  - the night penalty;
  - the dawn return before the win check;
  - `stars()` and the bot count him as alive.
- [x] aurora: no wolf spawn that night, and the energy bonus at nightfall. Thaw: the temperature, and the ice the next day (×0.8 in `moveFree` and `follow` outside the camp)
- [x] client: the `found` banner (not «… в лагере» again); the hint «Найди ребёнка до ночи» with RO strings
- [x] bot: fetches a lost child before anything else by day
- [x] write tests:
  - the child is lost, fetched and home, with no second `joined`;
  - the night penalty and the dawn return;
  - stars with a lost child at the final dawn;
  - the aurora night has no wolves;
  - the ice slows only outside the camp;
  - a thaw never comes on day 28 or later;
  - a save and restore with the child lost.
- [x] run the tests, including the balance tests; they must pass before Task 6

### Task 6: Trader

**Files:**
- Modify: `web/winter/core.js`
- Modify: `web/winter/game.js`
- Modify: `web/winter/lang.js`
- Modify: `tests/winter/bot.js`
- Create: `tests/winter/trader.test.js`

- [x] add `TRADES`, `TRADER_DAYS`, `g.trader` (plus `migrate` and validation): he arrives at dawn and leaves at nightfall; his offers are rolled with `erng`
- [x] `trade(g, i)`: its result codes; the goods capped by `roomFor`; the tool offer and its fallback
- [x] client: the `trader` and `traderLeft` banners; the hint «Торговец у ворот» with RO strings
- [x] bot: trades hides for metal, and meat for a tool it lacks
- [x] write tests:
  - the schedule per difficulty;
  - a seed repeats the offers;
  - every `trade` result;
  - the caps;
  - the tool fallback;
  - a save and restore on a trader day.
- [x] run the tests, including the balance tests; they must pass before Task 7

### Task 7: Bear

**Files:**
- Modify: `web/winter/core.js`
- Modify: `web/winter/game.js`
- Modify: `web/winter/lang.js`
- Modify: `tests/winter/bot.js`
- Create: `tests/winter/bear.test.js`

- [x] add `BEAR` and `g.bear` (plus `migrate` and validation)
- [x] `bearTick`:
  - spawning on the bear days with `erng`;
  - wandering, and chasing within sight;
  - staying out of `BASE` and off lit tiles;
  - ignoring survivors;
  - leaving at nightfall.
- [x] the hero's attack through `interact`, checked right after wolves; the bite; the drop; the events
- [x] client: a placeholder bear drawing (a brown ellipse) so the page shows it; the hint «Медведь рядом: уходи в лагерь» with RO strings
- [x] bot: when the bear is within sight, go back to the camp; fight it only with the spear and high health
- [x] write tests:
  - the schedule;
  - the chase in the open;
  - the bear stops at the light and at the camp edge;
  - it leaves at night;
  - the kill and the drop;
  - nothing happens on other days;
  - a save and restore with the bear out.
- [x] run the tests, including the balance tests; they must pass before Task 8
- [x] ➕ the bear bit 22 every 1.8 s and the hero fought back on his own, so the casual bot was mauled to death. Now he bites 15 and then backs off for 4 s (`BEAR.calm`), and the hero no longer throws himself at him
- [x] ➕ the bear lingered at the camp edge after the hero ran inside, and the bot spent the day running back and forth. Now near the camp he loses interest and drifts back into the forest, and the bot gathers from nodes away from the bear
- [x] ➕ ⚠️ a core bug, older than this plan: a hero who lay down by day and got rested had his order cleared but stayed `sleeping`, so he slept on with no order (and in a warm hut fast-forwarded the day). The fix: he gets up. The bots' harsh balance had leaned on this. With the fix alone, the original game wins 1/5 harsh. Each greedy-bot change below is something a player can do too:
  - in a killing frost (chill ≥ 1.3) with the stove lit, it sleeps it off in the hut;
  - it fetches a log when the fires are dying and there is no wood;
  - it stops waiting by a fire that loses to the frost;
  - it pays for comforts (upgrades, gear) in full, leaving 30 wood.

  Greedy now wins harsh 3/5 and normal 5/5 with all five upgrades, in about 51 real minutes

### Task 8: Rendering: camp buildings, upgrades, snares, roof hole, lantern

**Files:**
- Modify: `web/winter/game.js`
- Modify: `web/winter/view.js`
- Modify: `web/winter/lang.js`
- Modify: `tests/winter/view.test.js`

- [ ] the upgrades:
  - insulation strips on the hut;
  - the cellar hatch;
  - the smokehouse, with smoke while it works;
  - the annex;
  - the workshop shed;
  - ghost outlines of unbuilt upgrades after stage 4.

  Also draw the hole in the roof.
- [ ] snares, and a caught rabbit at dawn; the lantern glow on the hero; the lantern in `V.lights` at night
- [ ] write tests for `view.js`: the lantern light only at night, and only with the lantern
- [ ] run the tests; they must pass before Task 9

### Task 9: Rendering: the bear, the trader, the wanderer, the lost child, the aurora

**Files:**
- Modify: `web/winter/game.js`
- Modify: `web/winter/view.js`
- Modify: `web/winter/lang.js`
- Modify: `tests/winter/view.test.js`

- [ ] the real bear: a big body, a walk cycle, a swipe on a bite, a hp bar, an edge marker when it is near
- [ ] the trader's sled with a reindeer at the gate; the wanderer lying in the snow with a badge; the lost child with an edge marker
- [ ] the aurora: `V.aurora(g)`, drawn as moving bands over the dark layer
- [ ] write tests for `V.aurora`, and for edge markers covering the new targets
- [ ] run the tests; they must pass before Task 10

### Task 10: UI: panels, the event modal, the trade panel

**Files:**
- Modify: `web/winter/game.js`
- Modify: `web/winter/index.html`
- Modify: `web/winter/style.css`
- Modify: `web/winter/lang.js`
- Modify: `tests/winter/build.test.js`

- [ ] «Постройки»:
  - an «Улучшения дома» section, locked until stage 4, paid in parts like the hut;
  - «Залатать крышу» while there is a hole.
- [ ] «Верстак»: the gear below the tools, locked with a reason until the workshop is built; a snare placement mode like the torches
- [ ] the event modal: the text and the choice buttons, by keyboard, mouse and touch. It replaces the Task 4 banner
- [ ] the trade panel, opened by a tap on the sled; floats for `smoked`, `snareCaught`, `traded`
- [ ] write `build.test.js` checks: the new ids, and no missing RO keys
- [ ] run the tests; they must pass before Task 11

### Task 11: Balance tuning

**Files:**
- Modify: `web/winter/core.js`
- Modify: `tests/winter/bot.js`
- Modify: `tests/winter/balance-normal.test.js`
- Modify: `tests/winter/balance-harsh.test.js`

- [ ] tune `UPGRADES`, `GEAR`, `EVENTS`, `TRADES` and `BEAR` until:
  - every assertion in Context holds;
  - greedy builds ≥ 3 upgrades on normal;
  - the bear kills no greedy hero on normal;
  - wolves still bite a lantern-carrying greedy hero at least once over a winter.
- [ ] write the new balance assertions; log each tuning step in this plan with ➕
- [ ] run the tests; they must pass before Task 12

### Task 12: Sound and the smoke test

**Files:**
- Modify: `web/winter/audio.js`
- Modify: `tests/winter/audio.test.js`
- Modify: `tests/winter/smoke.cjs`

- [ ] sounds: `roar`, `bells`, `trade`, `snare`, `aurora` (a soft shimmer), `creak` (the roof)
- [ ] write audio tests for the new names
- [ ] smoke, desktop, with a seeded state:
  - build the workshop and craft the coat in the panel;
  - open the trader on his day and trade;
  - answer the roof event in the modal;
  - show the bear for a few seconds with no page errors.
- [ ] smoke, phone: the event modal and the trade panel at 360 px in RO, by touch, with no horizontal scroll
- [ ] run `node --test`, then the smoke 3 times in a row; everything must pass

### Task 13: Verify acceptance criteria
- [ ] verify all requirements from the Overview are implemented
- [ ] verify edge cases:
  - old saves;
  - every event across a save and reload;
  - a trader and a bear on the same day;
  - the lost child when the child dies;
  - the stock full of hides;
  - an event left unanswered all day.
- [ ] run the full suite: `node --test 'tests/**/*.test.js'` and `go vet ./... && go test ./...`
- [ ] run every game's smoke test (`tests/*/smoke.cjs`)
- [ ] check by hand (no automated test does this) that every new export of `core.js` and `view.js` is called by a test

### Task 14: [Final] Update documentation
- [ ] update the «Долгая зима» section in `README.md`: upgrades, the workshop, hides, events, the trader, the bear
- [ ] add a `CLAUDE.md` only if new repo-wide patterns were found (there is none today)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Items requiring manual intervention or external systems; informational only.*

**Manual verification:**
- Play a whole normal winter on a real phone and check:
  - whether the event modal comes at a good moment;
  - whether the trader is worth visiting;
  - whether the bear is scary but fair;
  - whether the second half of the winter now has things to do.
- On iOS, check the new sounds after the audio unlock.

## Review notes
- The automated plan review asked for these fixes, and they are applied above:
  - a separate rng stream for the new content;
  - per-task bot and client wiring, so every task stays green;
  - the real balance thresholds;
  - the lost child spelled out;
  - the `'roof'` id renamed to `'patch'`, and `items` to `gear`;
  - a lantern that scares instead of shielding;
  - `carryOf`;
  - `answerEvent` codes and the nightfall default;
  - one bear rule (the camp is always safe);
  - the annex warm only with heat;
  - hints with their RO strings in each feature task;
  - `go test` in every run.
- The review also suggested two separate plans. This plan stays one plan and one PR, as asked.
- If the scope has to shrink, cut in this order: snares, then the lost child.
