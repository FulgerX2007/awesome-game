# «Игры из рекламы», часть 3: Путь героя, Рубеж и Долгая зима

## Overview
- The last three concepts from `docs/roadmap.md`, games 18–20 of the repository. Earlier parts:
  `docs/plans/completed/20261014-ad-games-trio.md` and `docs/plans/completed/20261014-ad-games-sort-castle.md`.
  1. **«Путь героя»** (RO «Drumul eroului»), `/hero/`. The Hero Evolution concept, "from noob to legend", as a roguelite.
     - A level-1 warrior walks a branching map of three acts. The player picks the branch at every fork:
       battle, elite, chest, forge, shrine, camp, merchant.
     - Battles are automatic, seen from the side.
     - Enemies have different defences: armour, ethereal body, dodge, regeneration, elements.
     - The hero carries weapons, armour and a spell, and can swap the weapon **during a battle**.
     - The hero's look changes as he grows: armour, helmet, cape, aura.
     - Bosses end every act. The final boss changes its resistances by phase, so only the right combination
       of equipment wins.
     - «Слава» earned in every run buys permanent upgrades in «Зал славы».
  2. **«Рубеж»** (RO «Frontiera»), `/front/`. The Build & Defend concept, seen from the side along a front line.
     - The player's keep is on the left and the enemy fortress on the right.
     - Workers bring wood, stone and metal.
     - The player builds bridges over chasms, walls, towers and barracks, and recruits soldiers.
     - Enemy waves come on a schedule. To win, the army must take the enemy fortress.
     - 12 levels with stars.
  3. **«Долгая зима»** (RO «Iarna lungă»), `/winter/`. The Save the Survivor concept: a top-down survival game.
     - A lone hero in a winter forest chops wood, hunts, fishes and keeps a fire going.
     - Warmth, food and strength must be watched. Wolves come at night.
     - The player repairs the hut, builds the base and rescues 5 survivors, who then work on their own.
     - Goal: live through 30 days until spring. Unlike «Родник», the game can be lost.
- All three are finished games, like the five before them:
  - a menu and level/mode select, progress in `localStorage` saved the moment it is earned, resume after a reload;
  - synthesized sound with a toggle, RU/RO, phone controls;
  - no network at all: no external resources and no server requests. None of the three uses a leaderboard.
- Names, levels, art (drawn in code on Canvas 2D) and rules are original. These are not copies of commercial games.
- The three concepts leave `docs/roadmap.md`; the «Игры из рекламы» list there ends.

## Context (from discovery)
- The Go server `main.go` embeds `web/` (`//go:embed web`). Each game lives in `web/<name>/`.
  The server does not change in this plan; only `main_test.go` gets the new static paths.
- **Patterns to reuse (copy their structure, not their code):**
  - `web/castle/`:
    - fixed tick 1/60 s through an accumulator with `MAX_DT` 0.25;
    - a seeded rng kept in the state;
    - `drain(run)` events for sounds and effects;
    - roguelite upgrade offers;
    - snapshots at safe points (`snapshot`/`restore`), one `current` run in the save;
    - bots in `tests/castle/bot.js` with balance tests split across files.
  - `web/village/`:
    - a top-down tile map drawn from strings plus a seeded resource layout;
    - movement and pathfinding;
    - gathering, buildings with partial contributions, villagers who work on their own;
    - fixed step 1/20 s;
    - saves every 10 s and on `pagehide`;
    - the «Следующее дело» hint;
    - a phone action button;
    - the greedy bot `tests/village/bot.js` measuring the timeline.
    - «Долгая зима» reuses the shape; the code is duplicated per game, as the repo does.
  - `web/sort/`, `web/parking/`: level select with stars and locks, `recordStars` at the moment of the win, `currentOf`/`resume`.
  - All ad games:
    - `audio.js` (`window.<Game>Audio` with `{enabled, setEnabled, unlock, play(name, opts)}`, key `<game>.audio`);
    - `lang.js` (`I18n.add({ro:{…}})`, Russian strings are the keys);
    - `build.test.js`: script order, offline, RO with matching `{…}` placeholders, hub card order, `main_test.go` paths;
    - `smoke.cjs` with Playwright.
- Registration:
  - card and CSS variable in `web/index.html`; ad games first, newest first.
    The new order is `winter, front, hero, castle, sort, parking, rush, pins`;
  - the card-order assertions in `tests/{rush,parking,sort,castle}/build.test.js` (`slice(0, 5)`) move to `slice(0, 8)`;
  - static paths in `main_test.go`;
  - README: «Семнадцать браузерных игр» → «Двадцать», plus three sections in «## Игры из рекламы»;
  - `docs/roadmap.md`.
- Tests:
  - `node --test 'tests/**/*.test.js'`;
  - `go vet ./... && go test ./...`;
  - `NODE_PATH=/opt/node22/lib/node_modules node tests/<game>/smoke.cjs` (Chromium in `/opt/pw-browsers`).
    Rebuild or restart the server before each browser check: the files are embedded.
- Lessons from the last two plans, built in from the start:
  - progress is saved at the moment it is earned;
  - balance is checked by an independent "casual" bot, not only by the bot it was tuned on;
  - a "no-X" bot proves the core mechanic is required (here: no weapon swaps, no buildings, no fire/house);
  - placeholders match between RU and RO;
  - layouts are checked at 320/360 px and in portrait;
  - every export is exercised by tests.

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
- maintain backward compatibility: other games and the server stay untouched, except the hub registration
  and the card-order assertions
- duplicate small helpers (safe storage, rng, audio engine) per game instead of a shared module, as the repo already does
- the plan is executed interactively, but judgment calls (exact numbers, colours, texts) are settled by the implementer
  and logged as `[decision]`; balance tables in this plan are updated after bot runs

## Testing Strategy
- **unit tests (JS)**: `tests/<game>/*.test.js` load `web/<game>/core.js` (and `content.js`/`levels.js`, `view.js`,
  `audio.js`) with `require`.
- **balance**:
  - **hero**:
    - a competent bot (reads enemy defences and swaps to counter them) and a casual bot (random branches, random picks,
      never swaps mid-battle) play repeated runs with «Слава» carried over;
    - a "one weapon" bot with full permanent upgrades must not beat the final boss.
  - **front**:
    - a competent bot and a casual bot (delays, worse build order) play all 12 levels on several seeds;
    - an "army only" bot that never builds walls or towers loses the later levels.
  - **winter**:
    - a greedy bot plays 30 days on several seeds;
    - a "no shelter" bot that never repairs the hut or builds the palisade dies early.
- **unit tests (Go)**: the new static paths in `main_test.go`.
- **offline test**: `build.test.js` for each game checks:
  - no `http://`, `https://` or `fetch(` in `web/<game>/`;
  - only relative paths in `index.html`, plus `../i18n.js` and `../nav.js`.
- **e2e smoke**: `tests/<game>/smoke.cjs` in the style of `tests/castle/smoke.cjs`:
  - free port, `go run . -data ""`;
  - requests outside the server are blocked;
  - real input;
  - no console errors;
  - progress lands in `localStorage`, reload resumes;
  - RO on a 360 px phone with touch.

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope
- keep plan in sync with actual work done

## Solution Overview
- The same architecture as before:
  - `core.js`: deterministic rules, no DOM, a serializable state, a seeded rng inside the state;
  - `content.js` (hero) / `levels.js` (front): data only;
  - `view.js`: pure client helpers (layout, camera, hit-testing, formatting);
  - `audio.js`: synthesized WebAudio;
  - `game.js`: browser IIFE with Canvas 2D and DOM screens;
  - `lang.js`: RO strings.
- **Hero** is a run of discrete nodes plus real-time auto-battles with a fixed tick of 1/60 s. Snapshots are taken at
  every node boundary, so a reload during a battle restarts that battle.
- **Front** is a real-time 1-D strategy with a fixed tick of 1/20 s (there are many units; 1/20 is enough for the line).
  It saves every 10 s and on leave.
- **Winter** is a real-time top-down simulation with a fixed tick of 1/20 s, as in village. It saves every 10 s,
  on leave and at every dawn; the dawn save is used for «Начать день заново».

## Technical Details

### 1. «Путь героя» (`/hero/`)

**Hero**
- Stats:
  - `hp`/`maxHp` (start 70; ➕ was 60, raised in Task 1 so a level-1 hero survives two act-1 enemies);
  - `level` and `xp`: XP to the next level is `12·level^1.25` (➕ was `20·level^1.4`: Task 3 showed winning runs ending at level 4–6, far from «Легенда»);
  - `atk`, a base (2) added to the weapon's damage;
  - `armor`: incoming physical damage × `100/(100+armor)`;
  - `ward`: the same formula for magic (fire/ice/holy) damage;
  - `crit` (5% start, ×1.5);
  - `dodge` (0 start).
- A level-up gives +8 max HP, +1 atk, heals 25% of max HP and offers 1 of 3 small perks. The perk choice is shown
  after the battle (`pickPerk(run, index)`); a pending offer is part of the snapshot.
- Title by level, shown on the HUD and in the result:

| Levels | RU | RO |
|---|---|---|
| 1–2 | Новичок | Începător |
| 3–5 | Оруженосец | Scutier |
| 6–8 | Воин | Războinic |
| 9–11 | Рыцарь | Cavaler |
| 12–14 | Герой | Erou |
| 15+ | Легенда | Legendă |

- The look comes from the parts the hero has on:
  - body;
  - an armour piece coloured by its tier;
  - a helmet from level 6;
  - a cape from level 12;
  - an aura at «Легенда»;
  - the weapon's own shape.
  - `view.js` exposes `heroLook(hero)` → a plain description the renderer draws, so it is testable.

**Damage types and defences**
- Damage types: `phys`, `fire`, `ice`, `holy`.
- Every enemy has `res: {phys, fire, ice, holy}`: damage multipliers, where 1 is normal, 0.25 resistant, 0 immune
  and 2 weak. It may also have traits:
  - `dodge`: a chance to avoid a hit, ignored by `keen` weapons;
  - `regen`: HP per second, stopped for 3 s by any fire hit;
  - `thorns`: reflects 20% of melee damage;
  - `shield`: absorbs the first N hits.
- A hit deals `max(1, round((weaponDmg + atk) · res[type] · (crit ? 1.5 : 1)))`.
- The UI shows every enemy's defences as icons before the battle (shield, ghost, feather, drop, flame, snowflake, sun),
  so the counter is readable.

**Equipment**
- Slots:
  - `weapon`: damage type, damage, attack interval, traits `keen`/`cleave`/`lifesteal`;
  - `armor`: armour, ward, max HP;
  - `charm`: one spell cast automatically on its cooldown — fireball, frost nova (slows enemies 40% for 3 s),
    healing light, holy smite.
- **Bag**: up to 6 items (8 with permanent upgrades).
  - Outside battle the player can equip anything from the bag.
  - During battle only the weapon can be swapped, from the bag's weapons. A swap takes 0.8 s, during which the hero
    doesn't attack. The renderer shows it.
  - Up to 4 weapons sit in the battle quick slots (the first 4 weapons in bag order; the bag panel reorders them).
  - A full bag never blocks a reward: `discard(run, itemId)` drops an item (at a shop it sells for 30% of its price),
    and any reward can be skipped.
- Items have a tier from 1 to 5. The forge raises a tier by 1 (+30% to the item's numbers) or reforges a weapon's
  damage type.
- About 24 item templates in `content.js`. Examples:

| Item | Type | Character |
|---|---|---|
| Ржавый меч | phys | the start weapon |
| Тяжёлый топор | phys | cleave |
| Кинжал ловкача | phys | keen, fast |
| Огненный клинок | fire | — |
| Морозный посох | ice | slow |
| Молот света | holy | — |
| Копьё охотника | phys | keen |
| Кровавый серп | phys | lifesteal |

**Enemies** (start values; the bots tune them). Act 1 is the forest, act 2 the crypt, act 3 the volcano.

| id | RU | Act | Defence |
|---|---|---|---|
| `wolf` | Волк | 1 | — |
| `bandit` | Разбойник | 1 | dodge 30% |
| `slime` | Слизень | 1 | regen |
| `skeleton` | Скелет-латник | 2 | phys 0.4, holy 2 |
| `ghost` | Призрак | 2 | phys 0.15, holy 2 |
| `troll` | Тролль | 2 | regen 4/s, fire stops it |
| `imp` | Бесёнок | 3 | fire 0, ice 2, dodge 25% |
| `golem` | Лавовый голем | 3 | phys 0.5, fire 0, ice 2, thorns |
| `knight` | Чёрный рыцарь | 3 | shield 3, phys 0.6 |

- Enemies deal `phys` damage unless listed otherwise: the ghost deals `ice`, the imp and the golem `fire`;
  the final boss deals the type of its phase (P1 `phys`, P2 `fire`, P3 `ice`). So the hero's `ward` matters in acts 2–3.
- Elites are a stronger variant of the act's enemies with one extra trait.
- **Bosses:**
  - act 1 «Король волков»: summons wolves;
  - act 2 «Костяной лорд»: phys 0.3, holy 2, raises skeletons;
  - act 3, the final boss «Повелитель пепла». Three phases at 100% / 66% / 33% HP, each with a different best type,
    and every type is at ≤ 0.25 in at least one phase:

| Phase | phys | fire | ice | holy |
|---|---|---|---|---|
| 1, armoured | 0.25 | 2 | 1 | 0.25 |
| 2, a flame body | 1 | 0 | 2 | 0.25 |
| 3, a shadow body | 0.25 | 1 | 0 | 2 |

    Relative time to kill over three equal thirds: phys only 3.0, fire only ∞, ice only ∞, holy only 2.83;
    the best two-type bags (fire + ice, ice + holy) 0.67, three types 0.5. ➕ Task 3 tightened phase 2 holy
    (0.5 → 0.25) and phase 3 ice (0.25 → 0): with the first table ice-only and holy-only bots with full meta won. Every phase change is announced and shows the new defence icons.
    A multiplier of 0 is a true immunity: the `max(1, …)` floor applies only to non-zero multipliers.

**Map**
- Each act is a seeded graph of 8 rows: row 0 holds 2–3 battle nodes and the player picks the start, rows 1–6 hold
  2–4 nodes, row 7 is a single camp, then the boss.
- Every node links to 1–2 nodes of the next row (row 6 links to the camp), every node has ≥ 1 incoming edge,
  and edges never cross.
- Node kinds: `battle`, `elite`, `chest` (pick 1 of 3 items), `forge`, `shrine` (pick 1 of 3 perks from the level-up pool, one tier higher), `camp`
  (heal 40% or train for +1 level), `shop` (gold for items and potions).
- Generation rules, as in classic map roguelites:
  - no elites in the first two rows;
  - at least one forge and one chest on every path from start to boss;
  - no two shops one after another on any path.
- Gold and XP come from battles. Potions (up to 3) are used with a tap at any moment: +35% HP.

**Battle**
- 1 hero against 1–3 enemies; the front enemy is the target (`cleave` also hits the next one).
- Attack timers and spells run in real time, 1/60 s ticks, ×1/×2 speed and pause.
- The battle ends when one side is dead. The hero's death ends the run.
- ➕ A won battle heals 15% of max HP (Task 1: without it the attrition of act 1 killed a level-1 hero by row 4).
- ➕ Enrage: from 45 s into a battle, enemy damage grows by 10% per further second. Without it a hero facing an
  immune or regenerating enemy (and the bots) could fight forever.

**Runs and permanent progression**
- «Слава» is earned at the end of every run: `depth·8 + kills·2 + bosses·60` (➕ raised from `depth·5 + kills + bosses·40` in Task 3, so that a casual player has the basic upgrades in about 8 runs). Spent in «Зал славы»:

| id | Effect | Levels | Price |
|---|---|---|---|
| `vigor` | +15 max HP | 5 | 30·1.6ⁿ |
| `might` | +1.5 atk | 5 | 40·1.6ⁿ |
| `purse` | +25 start gold | 3 | 35·1.7ⁿ |
| `bag` | +1 bag slot | 2 | 80·2ⁿ |
| `potion` | +1 start potion | 2 | 60·2ⁿ |
| `armory` | a start weapon of another type: fire → ice → holy, unlocked in that order | 3 | 70·1.8ⁿ |

- Difficulty «Испытания» 1–3 unlock one by one after a win: enemies ×1.15ⁿ HP and damage (➕ was 1.2ⁿ: trial 1 was won on 2/5), +20% «Слава» per tier.
- `hero.save` holds `{v:1, glory, meta:{…}, wins, bestDepth, trial, trialsUnlocked, current}`. `current` is the run
  snapshot at the last node boundary.
  - Snapshot points: entering a node, after a chest/shop/forge/shrine/camp choice, after a battle is won.
  - A reload during a battle restarts that battle with the same seeded enemies.
  - The «Слава» of a finished run is written at the moment the run ends.

**API**
- `newRun(save, seed, trial)`;
- `mapOf(run)`, `choose(run, nodeId)`;
- `startBattle(run)`, `step(run, dt)`, `swapWeapon(run, itemId)`, `usePotion(run)`;
- `equip(run, itemId)`, `discard(run, itemId)`, `pickReward(run, index | null)` (null skips), `pickPerk(run, index)`,
  `forge(run, itemId, 'upgrade'|'reforge', type?)`, `buy(run, index)`, `sell(run, itemId)`, `camp(run, 'rest'|'train')`;
- `status(run)`, `drain(run)`;
- `glory(run)`, `buyMeta(save, id)`, `snapshot`/`restore`, `loadSave`/`storeSave`.

**Bots** (in tests):
- **Competent:**
  - picks branches by a fixed preference (chest/forge > elite when HP > 70% > battle > shrine > camp);
  - before every battle and at every boss phase change, equips the weapon with the best expected DPS against
    the current target;
  - spends «Слава» on the cheapest useful upgrade.
- **Casual:** random branches, random rewards, uses potions below 25% HP. Before half of the battles it reads the
  first enemy's icons and equips the best quick slot for it. It does not swap in normal battles, except when its
  hits show «иммунитет» (then always, 2.5 s late); after a boss phase change it waits 2.5 s and then, with 50%
  chance, swaps to the quick slot whose type the new icons favour.
- **Single type:** competent with full permanent upgrades, but only weapons of one damage type and no typed charm
  spells (fireball, smite); run once for each of the 4 types.
- Run seeds are `seed·1000 + runIndex`.

**Balance targets**
- Competent with no permanent upgrades:
  - beats the act 1 boss on ≥ 8/10 seeds;
  - beats the final boss on ≤ 2/10 (the first run is rarely a win, as in the ads).
- Competent with «Слава» carried between runs: the first win comes within 8 runs on all 5 seeds, and not on the
  first run on ≥ 3/5 (➕ was "within 2–8": a lucky first-run win on one seed is allowed, the 10-seed first-run
  limit above covers how rare it is).
- Casual with «Слава» carried: the first win comes within 15 runs on ≥ 3/5 seeds.
- Single type, each of the 4 types: loses to the final boss on ≥ 4/5 seeds.
- A competent winning run ends at level ≥ 12 («Герой»), and «Легенда» is reached in at least one winning run.
  The level reached at the end of each act is logged.
- Competent with full meta wins «Испытание 1» on ≥ 3/5 seeds.
- A winning run takes 10–25 minutes of game time at ×1 (measured by the bot: battle ticks plus 10 s per screen;
  ➕ was 12–25, measured 11.7–13).
- ➕ Measured after tuning (Task 3):
  - first run, competent, 10 seeds: the first boss beaten 10/10, the run won 2/10;
  - competent with «Слава»: first wins after 3, 1, 2, 2, 2 runs; winning runs end at levels 14–19 and take 12–13 min;
  - casual with «Слава»: first wins after 15, 8, 3, —, 10 runs;
  - one damage type with full meta: phys, fire, ice and holy each lose 5/5;
  - «Испытание 1» with full meta: won 3/5.

  Changes that got there: the XP curve, the win heal, enrage, the stronger permanent upgrades, act 2 enemies
  ×1.2 HP and ×1.1 damage, act 3 ×1.4 / ×1.25, the first two bosses ×1.2, the final boss ×3 HP and ×2 damage,
  the stricter final boss table, the bone lord's phys resistance 0.3 → 0.5 and the casual bot reading icons.
  All the hero balance files run in about a second.
- If a target is still unreachable after tuning:
  - log ⚠️ with the measured numbers and the closest targets reached;
  - loosen that target by at most one step.

**Client**
- Screens:
  - menu: «Новый поход» / «Продолжить», «Зал славы», trials, sound, RU/RO;
  - the act map: scrollable, current node highlighted, reachable nodes pulse;
  - the battle scene;
  - reward / forge / shop / shrine / camp panels;
  - the bag panel;
  - result: depth, kills, «Слава» earned.
- Battle HUD:
  - hero HP, XP and title;
  - enemy HP and defence icons;
  - weapon quick-slot buttons (the bag's weapons), the potion button, ×2, pause.
- Keyboard:
  - 1–4 swap weapons (the quick slots);
  - Q potion;
  - Space pause;
  - arrows plus Enter pick map nodes;
  - M sound;
  - Esc menu.

### 2. «Рубеж» (`/front/`)

**World**
- A 1-D line `x ∈ [0, L]` in metres, `L` 140–260 by level.
- The keep stands at `x = 0..6` (HP 400), the enemy fortress at `x = L−8..L` (HP by level).
- Segments are defined by a level string. Every character is 4 m:

| Char | Meaning |
|---|---|
| `.` | ground |
| `_` | chasm: impassable until a bridge (wood) is built over it |
| `T` | forest: a wood node |
| `S` | quarry: a stone node |
| `M` | mine: a metal node |
| `#` | a build plot |

- Nodes are inexhaustible. Each node serves at most 2 workers at a time; more workers queue next to it.

**Economy**
- Resources: `wood`, `stone`, `metal`. The start values depend on the level.
- Workers walk to the nearest reachable node of the requested resource, gather 5 units in 3 s and carry them to the keep.
  A bridge over a chasm makes the nodes beyond it reachable.
- The «Добыча» panel sets the number of workers per resource with +/− buttons; new workers go to wood.
- Food is not modelled. The worker cap is 3 + 3 per house; a level starts with 2 workers.
- Levels 1–4 give metal at the start and have a reachable `M`; from level 5 the metal sits beyond a chasm.

**Buildings**, all on plots `#`; a bridge goes over a chasm:

| id | RU | Cost | Effect |
|---|---|---|---|
| `bridge` | Мост | 30 wood per segment | opens the way and the nodes beyond |
| `house` | Дом | 30 wood | +3 workers to the cap |
| `wall` | Стена | 40 wood, 20 stone; upgraded to stone 60 stone | blocks enemies; 300 HP, 800 as stone |
| `tower` | Башня | 50 wood, 40 stone | arrows, range 22 m |
| `barracks` | Казарма | 60 wood, 30 stone | unlocks soldiers and archers |
| `forge` | Кузница | 40 stone, 40 metal | unlocks knights, +25% soldier damage |

**Units**

| id | RU | Cost | HP | Damage | Range | Speed |
|---|---|---|---|---|---|---|
| `worker` | Рабочий | 15 wood | 20 | 2 | 1 | 1.8 |
| `soldier` | Мечник | 20 wood, 10 metal | 60 | 8 | 1.2 | 1.4 |
| `archer` | Лучник | 25 wood, 5 metal | 35 | 6 | 16 | 1.4 |
| `knight` | Рыцарь | 30 metal | 140 | 14 | 1.3 | 1.6 |
| `catapult` | Катапульта | 80 wood, 40 metal | 80 | 30, ×4 against the fortress and walls | 20 | 0.8 |

- Soldiers and archers need a barracks; knights and catapults need a forge as well.
- Own units pass through own walls; enemies stop at them.
- The seed drives attack-timer jitter and a ±10% damage spread, so seeds differ while waves stay level data.

- The army has two orders, «Держать рубеж» and «В атаку».
  - Hold: soldiers stand just in front of the frontmost own wall (or the keep).
  - Attack: they march right, fight what they meet and then attack the enemy fortress.

**Enemies**
- Waves come from the fortress on a schedule: wave `k` comes at `t0 + k·interval`.
- Each wave is a list from the level's data, from these types:
  - `raider`: fast, weak;
  - `brute`: slow, strong;
  - `slinger`: ranged;
  - `ogre`: a boss with wall damage ×3.
- The fortress also has towers that shoot in range.
- Enemies attack the first own object in their way: a unit, a wall, a building on a plot, then the keep.
- After the last scheduled wave the fortress keeps sending patrols every 40 s, each 15% stronger than the last,
  so a passive keep eventually falls.

**Win, loss, stars**
- Win: the fortress HP reaches 0. Loss: the keep HP reaches 0.
- In tests, a bot that has not won within 3× the level's `par` of game time counts as lost (a time cap, so no test hangs).
- Stars:
  - ★ any win;
  - ★★ the keep keeps ≥ 60% HP;
  - ★★★ ★★ and the win comes before the level's `par` time.
- Recorded at the moment of the win.

**Levels**
- 12 hand-written levels in `web/front/levels.js`. Each one is `{map, start, waves, fortressHp, par}`.
- Each level adds one idea:

| # | Idea |
|---|---|
| 1 | gather, build a house and a barracks, attack; short: `par` ≤ 2 min |
| 2 | the first chasm and bridge |
| 3 | walls hold a wave |
| 4 | towers |
| 5 | metal behind a chasm |
| 6 | slingers outrange towers |
| 7 | the ogre |
| 8 | two chasms |
| 9 | the forge and knights |
| 10 | a long line with scarce wood |
| 11 | a strong fortress, the catapult |
| 12 | the finale: everything at once |

- `levels.test.js` checks a meaning for each level: the bots prove the new mechanic is needed (Balance).

**Bots** (in tests):
- **Competent:**
  - a scripted priority list: houses until 8 workers, a barracks, walls in front of the plots nearest the enemy side,
    towers, then units;
  - sets the resource shares from the next goal's cost;
  - attacks when army power exceeds the fortress power estimate.
- **Casual:** acts every 4 s, picks among the top three actions at random, attacks at a random army size.
- **Army only:** never builds walls or towers.

**Balance targets**
- Competent wins all 12 levels on 3/3 seeds and gets ★★★ on ≥ 8 levels.
- Casual wins ≥ 9/12 levels on each of 3 seeds.
- Army only loses at least 4 of levels 5–12.
- Each level 2–12 is lost by a bot variant that skips that level's idea (no bridge → cannot reach; no towers on 4,
  and so on), where such a variant makes sense. The skipped idea is listed per level in `levels.test.js`.
- Level length 4–10 minutes of game time for the competent bot.

**Saving**
- `front.progress` holds `{v:1, stars:[…], current}`. `current` is a full state snapshot (positions, units,
  timers, rng), written every 10 s, on `pagehide` and on pause.
- A reload continues the level from the snapshot.

**Client**
- A side-scrolling field with parallax hills and the ground strip. The camera pans by drag or ←/→.
- Tap a plot or a chasm → a build panel listing options with prices; impossible options are greyed with the missing
  resources shown.
- The menu has «Играть» (the level select), sound and RU/RO, like the other ad games.
- The bottom bar:
  - resources;
  - recruit buttons with queue counts;
  - the hold/attack toggle;
  - ×2 speed and pause.
- Keyboard:
  - ←/→ pan;
  - 1–5 recruit (worker, soldier, archer, knight, catapult);
  - A attack, H hold;
  - M sound;
  - B the build menu at the camera's nearest plot;
  - Space pause;
  - Esc menu.

### 3. «Долгая зима» (`/winter/`)

**World**
- A 56×40 tile map: a fixed hand-drawn base area around the ruined hut in the centre plus a seeded forest.
- Tiles: snow, deep snow (movement ×0.6), trees, rocks, bushes, ice (the frozen lake), the hut ruin, base plots.
- 5 survivors stand at fixed spots on the map edges, each at a camp marker with its own short need:
  - «Охотник» needs 3 meat to come;
  - «Плотник» is behind deep snow: needs the shovel;
  - «Травница» is found only by day;
  - «Кузнец» is beyond the frozen lake: an ice pick;
  - «Ребёнок» is reached only after the palisade is built, for safety.

  Rescued survivors follow the hero and join the base when they reach it.

**Day cycle**
- A day is 150 s of game time at ×1: 100 s day, 50 s night.
- The hut's bed comes with stage 2 (the roof). Sleeping in it while the hut stove is fed fast-forwards the night ×6.
- The outside temperature follows a curve over 30 days: mild at the start, the deepest cold on days 15–24, a thaw on 28–30.
- Blizzards on scheduled days drop it further and cut visibility.

**Stats** (0–100), shown as three bars:

| Stat | Falls | Restored by |
|---|---|---|
| `warmth` | by `chill` (from the outside temperature, night, blizzard) when outside a heat source | fire within 3 tiles, the inside of a hut with a fed stove |
| `food` | 0.12/s | eating: cooked meat +35, fish +25, berries +8 (raw meat +10, but −10 energy) |
| `energy` | with work, 0.04/s otherwise | sleep (+), sitting by the fire (slow) |

- Health (0–100) falls while any stat is at 0 and recovers while all are above 40.
- At health 0 the run is lost: «Начать день заново» from the dawn save, or a new game.
- A wolf bite takes 8 health directly (×1.5 in «Лютая зима»).

**Actions and items**
- Chop (axe), mine stone (pick), gather berries, hunt (rabbit: a quick chase; deer: 2 hits), fish at an ice hole
  (wait 6 s), cook at the fire, feed the fire, build, attack wolves.
- Tools come from the workbench:

| Tool | Cost | Gives |
|---|---|---|
| Каменный топор | — (start) | chopping |
| Кирка | wood 12 | mining |
| Железный топор | stone 10, metal 4 | chopping ×1.8 |
| Лопата | wood 12 | deep snow → snow tiles where dug |
| Ледоруб | metal 6 | the way across the lake |
| Копьё | wood 8, stone 4 | wolf damage ×2, deer hunting |

- Metal comes from scrap piles found on the map. At least 20 metal of scrap lies within reach without crossing
  the lake or deep snow.
- The workbench stands at the base from the start (a fixed object, not a building).
- A core test proves the whole tech tree is reachable from the start state.

**Fire and buildings**
- The campfire burns 1 wood per 12 s (×1.5 in a blizzard) and goes out at 0 fuel; the fuel bar holds 20.
- The hut stove has its own fuel: 1 wood per 15 s, capacity 30. A "fed stove" means fuel > 0.
- A campfire alone gives warmth +1.2/s within 3 tiles. That covers the chill of days 1–10 but not the nights when
  the outside temperature drops below −20 °C (from about day 11): then only the inside of the hut with a fed stove
  keeps warmth up.
- Buildings (with partial contributions, as in village):

| id | RU | Cost | Effect |
|---|---|---|---|
| `hut` | Хижина | 4 stages: walls 40 wood → roof 30 wood + 10 stone → door 20 wood → stove 30 stone + 6 metal | the stove keeps the inside warm while fed; the bed restores energy |
| `palisade` | Частокол | 4 segments × 25 wood | wolves cannot enter the base while the segments stand; they attack segments |
| `bunk` | Нары | 20 wood each, up to 3 | sleeping places for survivors, 2 each |
| `torches` | Факелы | 2 wood each | light; wolves avoid lit tiles |

**Wolves**
- They spawn at night more than 14 tiles from any person, more on later days and in «Лютая зима».
- They hunt the nearest person outside the palisade and bite. They flee from fire and torches and when hurt below 30%.

**Survivors**
- Food at the base is a pool of points: items put into it are converted at their eat values (cooked meat 35,
  fish 25, berries 8). Each survivor eats 0.08 points/s from the pool and needs a bunk and warmth (the hut stove,
  or a fed campfire). The hero carries up to 40 items; the base storage is fixed at 200 items.
- When cold or hungry they stop working and lose health. They die at 0, with a message. The run goes on.
- Roles by who they are:
  - Охотник brings meat;
  - Плотник chops and repairs;
  - Травница gathers and cooks;
  - Кузнец gives metal from scrap and repairs the palisade;
  - Ребёнок feeds the fire.
- Each role is a simple work loop, as in village.

**Win and scoring**
- Win: survive until the morning of day 31.
- The result shows days, survivors saved alive, the base built (buildings done) and stars:
  - ★ survived;
  - ★★ ≥ 3 survivors alive at the end;
  - ★★★ all 5 alive and the hut fully repaired.
- Difficulties: «Обычная зима» and «Лютая зима» (cold ×1.4, wolves ×1.6, unlocked after the first win). Each keeps
  its best result.

**Saving**
- `winter.save` holds `{v:1, best:{normal, harsh}, unlocked, current, dawn}`:
  - `current` is written every 10 s, on `pagehide` and on pause;
  - `dawn` is the snapshot at the last sunrise.

**Bots** (in tests):
- **Greedy:**
  - a priority list: keep the fire ≥ 6 fuel, eat at food < 40, sleep at night, repair the hut stage by stage,
    the pick, the palisade, tools, then rescue survivors one by one;
  - plays only through the core API, re-plans every 1 s.
- **Casual:** acts with a 3 s delay and a 25% chance to pick a random action from the list.
- **No shelter:** never builds the hut stove or the palisade.

**Balance targets**
- Greedy survives 30 days on «Обычная» on 5/5 seeds with ≥ 4 survivors alive.
- Greedy survives «Лютая» on ≥ 3/5 seeds.
- Casual survives «Обычная» on ≥ 3/5.
- No shelter (no stove, no palisade, no torches) dies before day 24 on 5/5.
- Days 1–3 never kill the greedy bot (a gentle start).
- A winter takes 30 × 150 s = 75 min of game time; with nights slept through it is about 50–60 min of real time at ×1.

**Client**
- Top-down tile rendering with soft snow, footprints, falling snow, a dark night with light circles around fires
  and torches, and a blizzard veil.
- Stat bars and the day/time clock in the HUD. Survivor markers sit on the edge of the screen when off-view.
- «Следующее дело» hint, as in village.
- Controls:
  - WASD/arrows walk;
  - E/Space act;
  - F eat;
  - B build;
  - T workbench;
  - Z sleep;
  - M sound;
  - Esc close.
  - Click or tap a tile: walk there and act. On a phone there are an action button and an eat button, plus HUD chips
    «Постройки» and «Верстак» (as village's `#btn-buildings`/`#btn-tools`); sleep is the context action at the bed.

### Shared
- Storage keys:
  - `hero.save`, `hero.audio`;
  - `front.progress`, `front.audio`;
  - `winter.save`, `winter.audio`.
- Sounds are synthesized:
  - hero: step, hit (per damage type), crit, dodge, swap, spell, level-up, chest, forge, potion, boss phase, win, lose;
  - front: chop, mine, build, recruit, clash, arrow, wall hit, horn (wave), fortress hit, win, lose;
  - winter: chop, mine, crunch steps, fire crackle loop, eat, wolf howl, bite, build, rescue, dawn chime, blizzard
    wind loop, lose, win.
- Every game has an M key for sound.
- Script order: hero `lang, content, core, view, audio, game`; front `lang, levels, core, view, audio, game`;
  winter `lang, core, view, audio, game`. `build.test.js` checks every Russian literal for RO in `game.js`,
  `index.html` and also in hero `content.js`, front `levels.js` (level names) and winter `core.js` (`nextTask`).
- Hub colours: `--hero: #ff6f91`, `--front: #b9c26b`, `--winter: #a9c7ff`. System font stack.

## What Goes Where
- **Implementation Steps**: code, content, levels, tests, docs and the hub registration inside the repository.
- **Post-Completion**: a manual check on a phone, tuning the feel by hand.

## Implementation Steps

### Task 1: «Путь героя» — hero, items, damage and battles in core.js

**Files:**
- Create: `web/hero/core.js`
- Create: `web/hero/content.js`
- Create: `tests/hero/core.test.js`

- [x] `content.js` (UMD `root.HeroContent`): item templates, enemies, elites, bosses with phases, perks, blessings,
  titles, meta upgrades.
- [x] `core.js` (UMD `root.HeroCore`):
  - rng and state;
  - hero stats and the XP curve, level-ups with perk offers, titles;
  - the damage formula with types, resistances and the traits `dodge`/`keen`, `regen` stopped by fire, `thorns`,
    `shield`, `cleave`, `lifesteal`;
  - spells on cooldown;
  - `startBattle`, `step` (1/60 s fixed ticks, at most 0.25 s per call, bad `dt` ignored);
  - `swapWeapon` with the 0.8 s delay, `usePotion`;
  - boss phases;
  - `status`, `drain` events.
- [x] write tests:
  - the damage formula per type and resistance;
  - dodge, and `keen` ignoring it;
  - regen paused by fire;
  - thorns, shield, cleave, lifesteal;
  - spell cooldowns;
  - a swap blocks attacks for 0.8 s;
  - potions;
  - boss phase changes and their new resistances;
  - level-ups and titles at boundaries;
  - determinism; `dt` slicing gives the same result.
- [x] write tests for errors: an unknown item for a swap, a swap outside battle, a potion with none left,
  `step` with bad `dt`.
- [x] run tests — must pass before next task

### Task 2: «Путь героя» — map, nodes, runs, permanent progression and saving

**Files:**
- Modify: `web/hero/core.js`
- Create: `tests/hero/map.test.js`
- Create: `tests/hero/run.test.js`

- [x] map: a seeded 8-row graph per act with non-crossing edges and the generation rules from Technical Details > Map.
- [x] nodes: `choose`, and the effects of chest/forge/shop/shrine/camp/elite/boss.
  The bag limit and `equip`; gold, XP and potion rewards.
- [x] runs: acts 1→3, the final boss, `glory`, run end. Meta: `buyMeta` with prices and caps, `armory` unlock order,
  trials and their multipliers.
- [x] saves: `snapshot`/`restore` at node boundaries; a reload during a battle restarts it with the same enemies;
  `loadSave`/`storeSave` tolerant of broken data and blocked storage; «Слава» written at run end.
- [x] write `map.test.js`:
  - the rules hold on 200 seeds: no crossings, every node reachable (≥ 1 incoming edge), a forge and a chest on every
    path, no early elites, no two shops one after another, a camp before the boss;
  - the same seed gives the same map.
- [x] write `run.test.js`:
  - every node kind;
  - a full bag: a reward is refused until `discard`, and skipping works; `pickPerk` and the pending offer in snapshots;
  - forge upgrade and reforge;
  - shop prices and refusals;
  - meta prices and caps;
  - trial multipliers;
  - snapshot/restore round-trips at every node kind;
  - broken saves fall back to defaults.
- [x] run tests — must pass before next task

### Task 3: «Путь героя» — bots and balance

**Files:**
- Modify: `web/hero/content.js` (tuning numbers only)
- Create: `tests/hero/bot.js`
- Create: `tests/hero/balance-first.test.js`
- Create: `tests/hero/balance-meta.test.js`

- [x] `tests/hero/bot.js`: the competent, casual and single-type bots from Technical Details, core API only.
- [x] `balance-first.test.js`: competent bot without meta, 10 seeds; the run-length bounds; the level reached.
- [x] `balance-meta.test.js`: repeated runs with «Слава» carried over (competent, casual); the single-type bots
  with full meta against the final boss (4 types); «Испытание 1».
- [x] tune content until the balance targets hold; update the tables in this plan; ⚠️ and the fallback rule if needed.
  Keep each balance file under ~60 s.
- [x] run tests — must pass before next task

### Task 4: «Путь героя» — page, rendering, screens, input and saving

**Files:**
- Create: `web/hero/index.html`
- Create: `web/hero/style.css`
- Create: `web/hero/view.js`
- Create: `web/hero/game.js`
- Create: `web/hero/lang.js`
- Create: `tests/hero/view.test.js`

- [x] `view.js` (UMD):
  - `mapLayout(map, viewport)` and `nodeAt`;
  - `battleLayout(viewport)`;
  - `heroLook(hero)`;
  - defence icons for an enemy (`defenceIcons(enemy)`);
  - number formatting.
- [x] `game.js` drawing:
  - an act background per act (forest, crypt, volcano) with parallax;
  - the hero assembled from `heroLook`, with walk/attack/swap/hurt poses;
  - enemies per type;
  - hit numbers coloured by damage type, crit and dodge text;
  - spell effects;
  - the boss phase change flash;
  - the map with paths and node icons.
- [x] screens and panels from Technical Details > Client. Progress and «Слава» are saved the moment they are earned.
  Starting a new run while one is saved asks first.
- [x] input: taps on nodes, items and quick slots; the keyboard from Technical Details; nothing needs hover.
- [x] `lang.js` with every RO string; `index.html` with no external URLs.
- [x] write `view.test.js`:
  - the map layout fits at 320/360/768/1280 px;
  - `nodeAt` hits and misses;
  - `heroLook` changes at title boundaries and with the armour tier;
  - `defenceIcons`;
  - formatting.
- [x] run tests — must pass before next task

### Task 5: «Путь героя» — sound, hub registration, offline check, smoke

**Files:**
- Create: `web/hero/audio.js`
- Create: `tests/hero/audio.test.js`
- Create: `tests/hero/build.test.js`
- Create: `tests/hero/smoke.cjs`
- Modify: `web/index.html`
- Modify: `main_test.go`
- Modify: `tests/{rush,parking,sort,castle}/build.test.js`

- [ ] `audio.js` (`window.HeroAudio`) with the sounds from Shared; the toggle is in `hero.audio`. Load it before `game.js`.
- [ ] hub card (`--hero`, RO string), first among the ad games; `/hero/*` paths in `main_test.go`.
  The card-order assertions become `slice(0, 6)` with hero first (Tasks 9 and 14 extend them).
- [ ] write `audio.test.js` and `build.test.js`, as in castle (no network at all: no `fetch(`).
- [ ] write `tests/hero/smoke.cjs`:
  - a new run;
  - choose a node, win a battle with a mid-battle weapon swap via the quick slot;
  - pick a chest reward;
  - reload on the map restores the run, and a reload mid-battle restarts the battle;
  - a seeded save at the final boss node, built in the page by `HeroCore` with the test-only `restore` field
    `bossHp` preset just above 33%, plays into phase 3 and ends on the result screen; «Слава» lands in `hero.save`;
  - RO on a 360 px phone with touch, no console errors, no external requests.
- [ ] run `node --test`, `go vet ./... && go test ./...`, the hero smoke, and re-run the other ad-game smokes — must pass before next task

### Task 6: «Рубеж» — line, economy, buildings and units in core.js

**Files:**
- Create: `web/front/core.js`
- Create: `tests/front/core.test.js`

- [ ] UMD `root.FrontCore`:
  - `parseLevel` with validation of map characters and data;
  - `newGame(level, seed)`;
  - `step` with 1/20 s fixed ticks, at most 0.25 s per call, bad `dt` ignored.
- [ ] economy:
  - workers' gather/carry loop over reachable nodes;
  - resource shares;
  - the worker cap from houses.
- [ ] building:
  - `canBuild`/`build(plot or chasm, id)` with costs and refusals;
  - construction time;
  - bridges opening the way;
  - wall upgrade;
  - building HP.
- [ ] units:
  - `recruit` and queues;
  - hold/attack orders;
  - melee and ranged combat on the line;
  - towers;
  - walls blocking;
  - the catapult against the fortress.
- [ ] enemies: the wave schedule, enemy types, fortress towers, patrols after the last wave, target priority.
- [ ] `status` (`playing`/`won`/`lost`), `stars`, `drain` events.
- [ ] write tests:
  - gathering rates;
  - unreachable nodes beyond a chasm until the bridge is built;
  - costs and refusals;
  - wall blocking and HP;
  - tower range;
  - combat outcomes in small set-ups;
  - the orders;
  - the wave schedule;
  - the patrols;
  - win/loss and stars at boundaries;
  - determinism; `dt` slicing gives the same result.
- [ ] run tests — must pass before next task

### Task 7: «Рубеж» — 12 levels, bots and balance

**Files:**
- Create: `web/front/levels.js`
- Create: `tests/front/bot.js`
- Create: `tests/front/levels.test.js`
- Create: `tests/front/balance.test.js`
- Modify: `web/front/core.js` (tuning numbers only)

- [ ] write the 12 levels from Technical Details > Levels.
- [ ] `bot.js`: the competent, casual and army-only bots, plus the per-level "skip the idea" variants.
- [ ] `levels.test.js`:
  - every level parses;
  - plots and chasms are where the idea needs them;
  - the per-level "skip the idea" check.
- [ ] `balance.test.js`: the targets from Technical Details > Balance on 3 seeds. Split it into two files if it runs
  longer than ~60 s.
- [ ] tune the level data and numbers until the targets hold; update the tables; ⚠️ and the fallback rule if needed.
- [ ] run tests — must pass before next task

### Task 8: «Рубеж» — page, rendering, input, screens and saving

**Files:**
- Create: `web/front/index.html`
- Create: `web/front/style.css`
- Create: `web/front/view.js`
- Create: `web/front/game.js`
- Create: `web/front/lang.js`
- Create: `tests/front/view.test.js`

- [ ] `view.js` (UMD):
  - `camera(viewport, L)` with clamped pan;
  - `toScreen`/`toWorld`;
  - `plotAt`;
  - `buildMenu(plot, state)` listing options with affordability and missing resources (a list panel);
  - formatting.
- [ ] `game.js` drawing:
  - parallax sky and hills;
  - the ground strip with forest, quarry and mine art;
  - chasms and bridges;
  - the keep and the fortress with damage states;
  - buildings under construction;
  - workers carrying loads;
  - units with walk/attack animations;
  - arrows and catapult stones;
  - damage numbers.
- [ ] screens:
  - menu;
  - level select (12 levels, stars, locks);
  - HUD and the bottom bar;
  - pause;
  - result.
  - Stars are recorded the moment the win is detected; the snapshot rules from Saving apply.
- [ ] input: drag to pan; tap a plot for the build menu; the keyboard from Technical Details.
- [ ] `lang.js` with RO; `index.html` with no external URLs.
- [ ] write `view.test.js`:
  - the camera clamps at both ends;
  - `toScreen`/`toWorld` round-trip;
  - `plotAt` hits and misses;
  - the build menu at 320/360 px.
- [ ] run tests — must pass before next task

### Task 9: «Рубеж» — sound, hub registration, offline check, smoke

**Files:**
- Create: `web/front/audio.js`
- Create: `tests/front/audio.test.js`
- Create: `tests/front/build.test.js`
- Create: `tests/front/smoke.cjs`
- Modify: `web/index.html`
- Modify: `main_test.go`
- Modify: `tests/{rush,parking,sort,castle,hero}/build.test.js`

- [ ] `audio.js` (`window.FrontAudio`) with the sounds from Shared; the toggle is in `front.audio`.
- [ ] hub card (`--front`, RO), first among the ad games; `/front/*` paths in `main_test.go`; the card-order assertions
  become `slice(0, 7)` with `front, hero, …`.
- [ ] write `audio.test.js` and `build.test.js`.
- [ ] write `tests/front/smoke.cjs`:
  - level 1 played by real taps at ×2: build a house and a barracks, recruit, attack; then a seeded near-win snapshot
    finishes the fortress, and 3★ lands in the UI and in `front.progress`;
  - level 2 with a bridge;
  - reload mid-level restores units and resources;
  - RO on a 360 px phone with touch and drag panning;
  - no console errors, no external requests.
- [ ] run `node --test`, `go vet ./... && go test ./...`, the front smoke and the other ad-game smokes — must pass before next task

### Task 10: «Долгая зима» — world, stats, actions and fire in core.js

**Files:**
- Create: `web/winter/core.js`
- Create: `tests/winter/core.test.js`

- [ ] UMD `root.WinterCore`:
  - the map from the base strings plus a seeded forest, with guaranteed resources near the base;
  - `newGame(difficulty, seed)`;
  - `step` with 1/20 s ticks, at most 0.25 s per call, bad `dt` ignored.
- [ ] movement and A* pathfinding over tiles (deep snow costs more, dug tiles get cheaper); click-to-act targets.
- [ ] the day cycle, the temperature curve, blizzard days, chill.
- [ ] stats: warmth/food/energy/health with the rates from Technical Details; sleep and the ×6 night fast-forward.
- [ ] actions: chop/mine/berries/hunt/fish/cook/eat/feed fire/scrap; the workbench tools; the fire's fuel burn.
- [ ] write tests:
  - stat rates near and away from heat;
  - the whole tech tree is reachable from the start state on 20 seeds (no recipe needs what it unlocks);
  - night and blizzard chill;
  - health loss and recovery;
  - each action's yield and tool requirements;
  - the fire burn rate and going out;
  - sleep fast-forward only with a fed fire and a bed;
  - pathfinding through deep snow before and after digging;
  - determinism.
- [ ] run tests — must pass before next task

### Task 11: «Долгая зима» — buildings, wolves, survivors, win/loss and saving

**Files:**
- Modify: `web/winter/core.js`
- Create: `tests/winter/base.test.js`

- [ ] buildings with partial contributions: the hut stages, palisade segments, bunks, torches.
- [ ] wolves:
  - night spawns by day and difficulty;
  - hunting and biting, fleeing from fire and torches and when hurt;
  - palisade segments block them and are damaged.
- [ ] survivors:
  - the five rescue conditions;
  - following the hero and joining the base;
  - needs (food, bunk, warmth), work loops per role;
  - death with a message.
- [ ] win at the morning of day 31, loss at health 0; stars; difficulties and their unlocks.
- [ ] saves:
  - `snapshot`/`restore`;
  - the dawn snapshot and `retryDay`;
  - `loadSave`/`storeSave`, tolerant of broken data and blocked storage;
  - the best result per difficulty written at the moment of the win.
- [ ] the «Следующее дело» hint function (`nextTask(state)`), as in village.
- [ ] write `base.test.js`:
  - building stages and partial contributions;
  - the palisade keeps wolves out;
  - wolves avoid torches;
  - each rescue condition;
  - survivors' needs and work;
  - win/loss and stars at boundaries;
  - `retryDay` returns the dawn state;
  - save round-trips and broken saves;
  - `nextTask` on key states.
- [ ] run tests — must pass before next task

### Task 12: «Долгая зима» — bots and balance

**Files:**
- Modify: `web/winter/core.js` (tuning numbers only)
- Create: `tests/winter/bot.js`
- Create: `tests/winter/balance-normal.test.js`
- Create: `tests/winter/balance-harsh.test.js`

- [ ] `bot.js`: the greedy, casual and no-shelter bots from Technical Details, core API only, re-planning every 1 s.
- [ ] the balance files cover the targets from Technical Details > Balance. Log the timeline of the greedy bot on seed 1:
  the hut done on day N, the palisade on day N, each rescue on day N. Keep each file under ~60 s.
- [ ] tune the numbers until the targets hold; update the tables; ⚠️ and the fallback rule if needed.
- [ ] run tests — must pass before next task

### Task 13: «Долгая зима» — page, rendering, input, screens and saving

**Files:**
- Create: `web/winter/index.html`
- Create: `web/winter/style.css`
- Create: `web/winter/view.js`
- Create: `web/winter/game.js`
- Create: `web/winter/lang.js`
- Create: `tests/winter/view.test.js`

- [ ] `view.js` (UMD):
  - the camera following the hero, clamped to the map;
  - `toScreen`/`toWorld`;
  - `tileAt`;
  - the light map helper (radii of fires and torches);
  - offscreen markers for survivors;
  - clock formatting.
- [ ] `game.js` drawing:
  - snow tiles with soft noise, trees with snow caps, rocks, bushes, the lake and ice holes;
  - the hut by stage, buildings, the palisade, torches, the fire with flames and smoke;
  - the hero and survivors with walking and work poses, footprints;
  - wolves;
  - falling snow, the night darkness with light circles, the blizzard veil.
- [ ] screens:
  - menu: «Новая зима» with the difficulty choice, «Продолжить», records, sound, RU/RO;
  - HUD: three stat bars, health, the clock and the day number, resources and the hint;
  - build and workbench panels;
  - pause;
  - result (win or death) with «Начать день заново».
- [ ] input: keyboard and touch from Technical Details; the phone action and eat buttons.
- [ ] saving every 10 s, on `pagehide`, on pause and at dawn; starting a new winter while one is saved asks first.
- [ ] `lang.js` with RO; `index.html` with no external URLs.
- [ ] write `view.test.js`:
  - the camera clamps;
  - `toScreen`/`toWorld` round-trip;
  - `tileAt`;
  - light radii;
  - offscreen markers sit on the screen edge;
  - clock formatting;
  - the layout at 320/360 px.
- [ ] run tests — must pass before next task

### Task 14: «Долгая зима» — sound, hub registration, offline check, smoke

**Files:**
- Create: `web/winter/audio.js`
- Create: `tests/winter/audio.test.js`
- Create: `tests/winter/build.test.js`
- Create: `tests/winter/smoke.cjs`
- Modify: `web/index.html`
- Modify: `main_test.go`
- Modify: `tests/{rush,parking,sort,castle,hero,front}/build.test.js`

- [ ] `audio.js` (`window.WinterAudio`) with the sounds from Shared (the crackle and wind loops stop when sound is off);
  the toggle is in `winter.audio`.
- [ ] hub card (`--winter`, RO), first among the ad games; `/winter/*` paths in `main_test.go`; the card-order
  assertions become `slice(0, 8)` with `winter, front, hero, castle, sort, parking, rush, pins`.
- [ ] write `audio.test.js` and `build.test.js`.
- [ ] write `tests/winter/smoke.cjs`:
  - a new winter: walk with keys to a tree, chop, feed the fire, eat berries;
  - a seeded save at night shows the darkness and a wolf, and the hero sleeps in a repaired hut;
  - reload restores the state;
  - death leads to the result screen and «Начать день заново» restores dawn;
  - RO on a 360 px phone with touch and the action button;
  - no console errors, no external requests.
- [ ] run `node --test`, `go vet ./... && go test ./...`, the winter smoke and all ad-game smokes — must pass before next task

### Task 15: Verify acceptance criteria
- [ ] verify every requirement from the Overview in all three games: menu, levels or modes, progress saving,
  sound toggle, RU/RO, phone control, offline play.
- [ ] verify edge cases:
  - broken or blocked `localStorage`;
  - reload mid-battle (hero), mid-level (front), mid-night (winter);
  - 360 px and 320 px screens, portrait and landscape;
  - switching language on every screen;
  - pause and tab switch (no time jumps beyond `MAX_DT`).
- [ ] run the full test suite: `node --test 'tests/**/*.test.js'` and `go vet ./... && go test ./...`.
- [ ] run the e2e smoke of every ad game:
  `NODE_PATH=/opt/node22/lib/node_modules node tests/{pins,rush,parking,sort,castle,hero,front,winter}/smoke.cjs`.
- [ ] verify every export of the new `core.js`/`view.js`/`audio.js` is exercised by tests (a call-recording hook,
  as in the previous plan).

### Task 16: [Final] Update documentation
- [ ] `README.md`:
  - first line «Двадцать браузерных игр…»;
  - the intro of «## Игры из рекламы» (eight games; modes per game);
  - three new subsections describing what was actually built: rules, controls, saving keys, how balance is verified.
- [ ] `docs/roadmap.md`: the «Последними вышли…» line names the three new games; the ad-games list is done,
  so the section is removed or says so.
- [ ] update CLAUDE.md if new patterns were found (there is no file now; only if needed).
- [ ] move this plan to `docs/plans/completed/`.

## Post-Completion
*Items requiring manual intervention or external systems — no checkboxes, informational only*

**Manual verification**:
- hero on a phone: readability of the defence icons, tapping the quick slots during a battle, the length of a run
- front on a phone: drag panning versus taps on plots, the build menu at the screen edges
- winter on a phone: walking by taps and the action button, the darkness at night (not too dark), the length of a winter
- the sound on iOS Safari (unlock on the first gesture), the wind and crackle loops

**Next steps**:
- nothing planned in the ad-games collection after this part
