# «Ржавый рассвет» on Godot 4: migration and upgrade

## Overview
- «Ржавый рассвет» (`/rust/`) moves to Godot 4.7 as a 2.5D game: `godot/rust/`, served at `/rust-godot/`
  next to the original, like «Глубина», «Тяни штифт» and «Последняя крепость» before it.
- The original's rules are kept exactly (parity tests replay scenarios against `web/rust/core.js`); new systems sit
  on top of them and are neutral at the start, so the first half hour plays like the web game.
- New: a 3D scrapyard where every robot is visible doing its job, a seven-stage ark that is physically rebuilt,
  world events (salvage, wrecks, power shortages), two new upgrades, scrapyard zones, achievements and challenges,
  manual save slot, portrait layout.

## Inspection of the source
- **Engine and stack.** Vanilla JavaScript, Canvas 2D, no libraries. `core.js` holds the rules without DOM (runs in
  Node), `game.js` the scene, UI and persistence, `lang.js` the Romanian dictionary (keys are the Russian strings),
  `style.css` the layout. Fonts come from Google Fonts; there are no image, sound or model assets, so nothing needed
  licence checks. The Go server embeds `web/` and offers cloud saves by code (`/api/saves/{code}`).
- **Loop.** `requestAnimationFrame`, variable `dt` capped at 0.25 s; a hidden tab catches up through `offline()`.
- **Resources.** Хлам (scrap), Детали (parts: currency and repair material at once), Ядра (cores: 0.5 % of every part
  sorted), Роботы (built, split into idle / digger / sorter / mechanic), Чертежи (blueprints, prestige).
- **Rates and costs** (`derived()`; `bp = 1 + 0.1·blueprints`, `g = bp·2^neuro`):

  | | formula |
  |---|---|
  | dig (click) | `(1 + shovel)·bp` scrap |
  | sort (click) | up to `1 + gloves` parts, `5 − smelter` scrap each |
  | repair (click) | `1 + 2·wrench` work |
  | digger | `1.0·(1 + 0.5·magnet)·g` scrap/s |
  | sorter | `0.5·(1 + 0.5·belt)·g` parts/s, limited by scrap |
  | mechanic | `0.5·(1 + 0.5·oil)·g` work/s; factory adds `factory·g` |
  | robot | `ceil(10·1.075^built)` parts, `20 + 3·built` work |
  | core chance | `0.005·(1 + scanner)` per part |
  | ark | 5 stages after the 5th robot: 1 000 / 5 000 / 20 000 / 60 000 / 150 000 parts, 0 / 5 / 20 / 50 / 100 cores |
  | prestige | `max(1, floor(sqrt(parts / 10 000)))` blueprints, +10 % each |

- **Upgrades** (11): shovel, gloves, wrench, magnet, belt, oil, dispatch (new robots go where needed), smelter,
  scanner, factory, neuro; unlocks by lifetime parts, robots built or cores found.
- **Saves.** `localStorage["rust-dawn.save"]`, `{state, savedAt}` every 5 s and on hide; v1 with `migrate()` for
  missing fields; offline progress capped at 8 hours.
- **Pace.** A greedy bot (4 clicks/s, dispatcher-style assignment, cheapest upgrade, ark first) launches the ark in
  85 / 31 / 19 minutes over three dawns.

## Decisions
- **Godot 4.7.2 and GDScript**, GL Compatibility renderer, single-threaded web export into the shared engine in
  `web/godot/` (only `index.pck`, ~0.4 MB, is new). Nothing in the game calls for C#.
- **3D with an orthographic camera** rather than layered 2D: one light, real shadows and depth fog. Every model is
  built in code from primitives (`Kit`), so the look is consistent and there are no third-party assets or licences;
  the only file asset is the Golos Text font (OFL), as in the other Godot ports. Sounds are synthesized at start.
- **State and rules apart from views.** `GameState` holds only saved data; static managers change it; the `Game`
  autoload is the only caller at run time and turns the rules' events into signals. UI panels and the world only call
  `Game` and listen to it.
- **Data-driven content** as Resources: `UpgradeDef`, `StageDef`, `AchievementDef`, `ResourceDef`, indexed by
  `data/game_data.tres`. Effects are a small set of kinds read by `ProductionManager.derived()`.
- **Fixed 0.1 s simulation step** with an accumulator: the same game at any frame rate; nothing runs while paused.
- **No new currencies.** Parts stay the repair material (as in the original); power is a multiplier, not a resource.

## Changes to the original rules (and why)
- The ark has **seven stages** (reactor core, power, frame, factories, navigation, final assembly, launch) instead of
  five, each with a lasting effect (mechanics, all automation, a new zone, sorters, a zone, all automation, the
  launch). Costs total 607 000 parts and 290 cores: the stage bonuses make the economy faster, and the bot measured
  the result.
- **Blueprints** use `sqrt(parts / 25 000)` instead of 10 000, so a dawn earns about as many as before with the
  bigger ark.
- Two upgrades: **Стабилизатор реактора** (automation +15 %/level, rarer shortages; after the power stage) and
  **Дрон-помощник** (does the chosen manual action, one every 2 s per level; needs the stabilizer).
- Events (salvage crates, abandoned robots repaired free at half the work, power shortages that halve automation
  for 30 s unless the reactor is hit five times) run on the state's own clock and RNG, so they pause, save and replay.
- Result with the same bot: **75 / 29 / 19 minutes** without events, 63 / 26 / 18 when it also uses them
  (`tests/balance.gd` keeps it within bounds).

## Milestones
1. Rules core, data, saves; parity and unit tests — done.
2. Scrapyard scene and the UI layout — done.
3. Production and worker assignment wired to the scene and panels — done.
4. Interactive piles, sorting table, repair bay, reactor, salvage and wrecks — done.
5. Upgrades with world props and the ark's physical progress — done.
6. Lighting, sky backdrop, fog, glow, particles, synthesized sound — done.
7. Autosave, manual slot, migration of web saves, balance bot, scene test, web export, site and CI — done.

## Testing
- `tests/run.gd`: parity with `core.js` (manual actions, derived numbers, a minute of automation, an hour offline
  with the dispatcher), frame-rate independence at 24/60/144 fps, pause, workers, every upgrade's effect, stages,
  events and their determinism, achievements, saves (round trip, backup, damaged and newer files, the web format),
  translations (placeholders, plural forms), texts that state percentages match the data.
- `tests/balance.gd`: the ark's pace over three dawns, with and without events.
- `tests/scenes.gd`: the real main scene headless, played through its own clickable objects up to the launch, a new
  dawn, saves, portrait layout and Romanian.
- Checked by hand in headless Chromium against the Go server: loading, keys, clicking 3D objects, `?lang=ro`, and
  progress surviving a page reload.

## Remaining limitations
- Cloud saves by code (`/api/saves/{code}`) are not ported; the web version keeps them. Progress of the web version
  is imported once, on the first start, when both run on the same site.
- The scene shows at most 12 diggers, 6 sorters, 6 mechanics and 6 idle robots; a counter shows the rest.
- Robots walk straight lines between stations and can pass through each other.
- Sound effects are simple synthesized tones; there is no music.
- Rendering was checked with software rendering (llvmpipe, SwiftShader); real GPUs and phones were not tested here.
