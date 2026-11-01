# MathMagic: Island of Addition

A 2.5D math adventure for children aged 6–10, made with Godot 4.7 (GDScript). A young hero (six to choose
from: mage, knight, ranger, barbarian, rogue, hooded rogue) walks across a colorful low-poly island.
Counting, adding and subtracting are how the hero moves forward: the answers open
gates, build bridges, power machines and calm the Stone Guardian. It runs on desktop and in the browser
(`/mathmagic/` on this site), in English, Russian and Romanian.

## Play

| Action | Keys | Gamepad |
|---|---|---|
| Walk | A / D or ← / → | D-pad, left stick |
| Jump (hold for higher) | Space, W or ↑ | A / Cross |
| Use (gate, bridge, machine, crystal) | E or Enter | X / Square |
| Pick an answer | 1 2 3 4, or click | |
| Hint in a challenge | H | Y / Triangle |
| Close a challenge for now | Esc | |
| Pause | Esc or P | Start |
| Restart while paused | R | |

All actions are input-map actions in `project.godot` (Project Settings → Input Map), so they can be rebound
without touching code. Menus work with the mouse and the keyboard (arrows/Tab + Enter); a gamepad
navigates them through Godot's default `ui_*` actions (not tested yet).

## Run it

- **Editor:** open `godot/mathmagic/project.godot` in Godot 4.7.x and press F5. The main scene is
  `scenes/main/main.tscn`.
- **Browser, through the site:** `go run . -addr :8080` in the repository root, then open
  `http://localhost:8080/mathmagic/` (`?lang=en`, `ru` or `ro` picks the language).
- **Rebuild the web version:** `GODOT=/path/to/godot-4.7.2 tools/mathmagic/build.sh` runs the tests and
  exports to `web/mathmagic/`. It needs the Godot 4.7.2 web export templates. `--sounds` regenerates the audio
  first (Python 3 + numpy).
- **Desktop builds:** `export_presets.cfg` has Linux and Windows presets (output under `build/mathmagic/`,
  which git ignores). Install the desktop export templates, then use Project → Export.

## The game

| # | Level | New idea | Puzzles |
|---|---|---|---|
| 1 | Counting Beach | Count real stones on pedestals and add small numbers (up to 5) | 2 addition gates with countable stones |
| 2 | Broken Bridges | Collect stones, count the empty spots: the missing amount (`3 + ? = 6`) | 2 bridges, the second longer and harder |
| 3 | Gate Garden | Subtraction ("take away"), then addition, then a gate that picks the harder one for you | 3 gates |
| 4 | Windmill Hill | Puzzles combined: fill an energy machine to start the lift, use the stones from up there to fix a bridge, open a gate | machine + lift + bridge + gate |
| 5 | Stone Guardian | Boss: everything learned, under gentle pressure | 3 phases |

**Heroes.** "Hero" on the title screen opens a picker with the six KayKit Adventurers 2.0 characters; the
choice is saved and the picked hero shows in the menu picture and plays every level. They all share one
skeleton (`Rig_Medium`), so `Art.hero()` gives any of them the same animation library, built once from the
pack's two animation files.

Each level has an intro card with one or two short lines, an objective always shown in the corner (the next
unsolved puzzle), three optional magic gems on harder-to-reach platforms, a treasure chest at the end, and
checkpoints: falling into the sea brings the mage back to the last flag or solved puzzle. Nothing is ever
lost: a level can be replayed for the missing gems.

**Stone Guardian.** Each phase follows the same rhythm. The Guardian attacks twice, always telegraphed: a
glowing ring with "!" where a slam will land, a boulder held up before it rolls, shadows where rocks will
fall. It then gets tired ("z z z") and waits, with no time limit, while the child walks to the glowing
crystal. Phase 1: addition breaks its blue shield. Phase 2: subtraction raises stone stairs in the arena.
Phase 3: a last challenge in the child's weakest skill, on top of the stairs, calms it. It crumbles into a
small, friendly pebble and the chest appears. Eye and core colors, body tint and attacks differ per phase.
A bar at the top shows progress. A hit costs a heart; with no hearts left the mage starts again at the arena
entrance with full hearts, and the Guardian keeps its phase. Nothing moves while a challenge is open, and a
wrong answer only makes it laugh.

**Learning design.** No timers anywhere. Unlimited tries: a wrong answer button greys out with "Almost! You
need a little more / that is a little too many", and the world shows what that answer would do (stones
leave holes in the bridge or bounce off as extras, the machine sputters or overflows). After two misses the
hint appears by itself: every stone that counts gets its number. Early levels show real objects to count in
the world and in the dialog (ten-frame rows of five). Difficulty adapts per skill: three first-try answers in
a row make that skill one step harder, two misses in a row one step easier, within each puzzle's limits.
"Mixed" puzzles and the last boss phase pick the skill the child currently finds hardest.

## Architecture

```
godot/mathmagic/
  project.godot          input map, autoloads, GL Compatibility renderer (desktop, web, future Android)
  scenes/main/main.tscn  the app; scenes/levels/level_1..5.tscn the levels
  scripts/
    main/        main.gd (screen flow), menu_backdrop.gd
    player/      player.gd (PlayerController)
    gameplay/    level.gd, level_manager.gd, game_camera.gd, interactable.gd, pickup.gd, checkpoint.gd, goal.gd,
                 puzzle_base.gd + gate_puzzle.gd, bridge_puzzle.gd, energy_puzzle.gd
    bosses/      stone_guardian.gd (BossController), boss_rune.gd
    math/        math_challenge.gd, challenge_generator.gd, math_challenge_manager.gd
    progression/ level_catalog.gd, progress_manager.gd
    save/        save_manager.gd
    ui/          ui_manager.gd, challenge_dialog.gd, counting_view.gd, ui_theme.gd
    world/       ground.gd (hex-tile terrain and floating islands), prop.gd, art.gd (models, heroes, materials), fx.gd, lift.gd, windmill.gd, sign_post.gd, level_environment.gd
    audio/       sfx.gd
  data/strings.csv       EN/RU/RO texts (Godot imports it as translations)
  tests/                 run.gd (unit), playthrough.tscn (bot plays the game)
  docs/ASSETS.md         asset manifest and licenses
```

| Piece | Responsibility |
|---|---|
| `MathChallenge` | One question as data: operation, operands, answer, choices, difficulty, skill, hint, visual flag. |
| `ChallengeGenerator` | Builds valid questions for a skill and difficulty. Static and seeded; all number ranges live in its `LEVELS` table. Distinct, non-negative choices made of typical slips (±1, ±2, adding instead of subtracting, giving the total). |
| `MathChallengeManager` (autoload) | Creates challenges at the right difficulty, records results, adapts per skill, finds the weakest skill, and keeps the single open challenge (a second request while one is open is refused). |
| `PuzzleBase` | Puzzle lifecycle (idle → active → solved), signals `solved` / `state_changed`, answer checking, friendly messages, checkpoint. Subclasses only build visuals and say what an answer does to the world. |
| `Level` | Root of each level scene: environment, mage, camera, stones and gems, objective, checkpoints, respawn, hearts, completion. |
| `LevelManager` | Loads (and caches) level scenes, restarts, reports completion. |
| `ProgressManager` (autoload) | Unlocked and completed levels, gems, settings. State plus signals only. |
| `SaveManager` (autoload) | Writes ProgressManager + MathChallengeManager as one small JSON (desktop: `user://mathmagic_save.json`, browser: `localStorage["mathmagic.save"]`). Missing, broken or future-version saves load as defaults; every field is type- and range-checked. Saves once per frame when anything changes. |
| `UIManager` | HUD, toasts, intro / pause / result / title / map / settings cards, the challenge dialog. Emits button signals; `main.gd` decides the flow. |
| `StoneGuardian` | Boss phases, telegraphed attacks, tired state, reactions, victory. |
| `Sfx` (autoload) | Sound pool and music; loads every sound once at start. |

Communication is by signals: a puzzle opens a challenge through the manager, the dialog listens and calls
back `submit_answer()` / `dialog_closed()`; levels emit `objective_changed`, `stones_changed`, `message`,
`completed`; the UI subscribes. The four autoloads are the only global state, and each is a real
cross-scene service. Level scenes are plain `.tscn` files placing reusable pieces (Ground, Prop, puzzles,
pickups, Checkpoint, Goal, StoneGuardian) and are editable in the editor. A new world means new level
scenes and a `LevelCatalog` entry; a new puzzle type means a `PuzzleBase` subclass.

**Decisions (simplest reasonable option, noted for review):**
- Menus and HUD are built in code (`UIManager`, `UiTheme`) rather than hand-made Control scenes. One theme,
  easy to keep consistent, and "big text" is just a different theme.
- The gameplay plane is z = 0. The player's z is reset every physics frame, so nothing can push the mage into
  the background.
- The camera never rotates. It follows with look-ahead, is clamped to the level, pulls back in the boss arena,
  and frames the puzzle above the dialog while a challenge is open. Below 16:10 it keeps the width instead of
  the height, so the path ahead stays visible on narrow and portrait screens.
- Terrain is hex tiles in one MultiMesh per layer (a few draw calls per strip), one shadowed sun, no other
  real-time lights. Particles are one-shot and free themselves. Models and level scenes are loaded once and cached.
- No puzzle hard-codes a question. Levels only choose a skill and a difficulty window; the bridge also caps
  the answer so it never asks for more stones than the level offers.
- While a challenge is open, the world keeps animating (so wrong answers can show their effect) but the
  mage and the boss are frozen. Pause stops the world entirely.

## Tests

```bash
godot --headless --path godot/mathmagic --import
godot --headless --path godot/mathmagic -s res://tests/run.gd
godot --headless --fixed-fps 60 --path godot/mathmagic res://tests/playthrough.tscn
```

`tests/run.gd` (17 tests, about 1 s): addition, subtraction and missing-addend results over 300 random
questions per skill and difficulty; right and wrong answer detection; distinct, non-negative choices that
contain the answer; number ranges per difficulty; difficulty clamping and monotonic ranges; the bridge's
answer cap; question text; adaptation up and down and its bounds; weak-skill repetition; save/load round
trip; broken, empty, wrong-version and missing saves; sanitizing bad values; every level scene loading with
spawn, camera limits, three gems, a goal or boss and valid challenges; every visible text translated;
every hero building with every animation the game plays, its tracks reaching its skeleton.

`tests/playthrough.tscn` (about 5 s; `--fixed-fps 60` runs the physics as fast as the machine allows): first the menu flows (intro card, pause and
resume with a frozen world, a double interaction ignored, "Later" closing and reopening the same question,
restart, map, title, picking a hero and seeing that hero in the level), then a bot plays all five levels with the real scenes, physics and dialog. It walks,
jumps gaps and steps, waits for the lift, collects stones, answers one wrong and then right at every puzzle,
and in the boss fight waits for the Guardian to tire before going to each crystal. Each level must end at its
goal; afterwards the saved progress must load back identical. The bot found real layout bugs (platforms that
blocked the path, stones nobody could reach, a lift that could crush the mage) that are now fixed.

CI runs both (`.github/workflows/release-image.yml`). They are also run by `tools/mathmagic/build.sh`.

### Manual checks still worth doing on real hardware

The automated tests cover logic, physics and flows, but not how the game looks and feels at full speed. On a
desktop with a GPU and in a browser:
- [ ] steady 60 FPS in every level, and in the boss arena during the falling rocks
- [ ] sounds and music play; the volume sliders and "Big text" apply at once and survive a reload
- [ ] jump feel with the keyboard and with a gamepad; menus reachable with the gamepad only
- [ ] all texts fit in Russian and Romanian with "Big text" on, at 1280×720 and on a narrow window
- [ ] a child (or an adult acting as one) understands each level's goal from the intro and the corner text

## Known limitations

- The gate bars, bridge slabs, machine, gems, crystals and signs are code-built primitives (see
  `docs/ASSETS.md`). They are readable and consistent but simpler than the pack models around them.
- The 2.0 hero rig has no cheer or spell clips: the level-end cheer is a happy hop (`Jump_Full_Short`), a
  solved puzzle plays `Use_Item`, and the hero thinks with `Idle_B` during a challenge. Heroes carry no weapons.
- No touch controls yet. The UI works with a mouse, but walking and jumping need a keyboard or a gamepad.
  This is the main step for Android.
- The browser version was checked in headless Chromium with software rendering (under 2 FPS there), which
  confirms that it loads, reads input, saves to localStorage and switches language. Real-speed performance in
  browsers has not been measured.
- The bot answers wrong first on purpose, so the playthrough always runs at the lowest difficulty. Higher
  difficulties are covered by the unit tests, not by a full playthrough.
- Music is one short synthesized loop for every level.

## Next milestone

Touch controls (on-screen left/right/jump/use buttons, shown on touch screens) plus an Android export preset,
then a second world ("Multiplication Mountains") on the same systems: a new `LevelCatalog` entry, a `mul`
skill in `ChallengeGenerator` (equal groups as the countable visual) and one new puzzle type. A short
playtest with children before that would say more than any further polish.
