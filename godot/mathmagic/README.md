# MathMagic: Island of Addition and Multiplication Mountains

A 2.5D math adventure for children aged 6–10, made with Godot 4.7 (GDScript). A young hero (six to choose
from: mage, knight, ranger, barbarian, rogue, hooded rogue) crosses a colorful low-poly island and then
climbs the mountains behind it. Counting, adding, subtracting and, in the mountains, multiplying as equal
groups are how the hero moves forward: the answers open gates, build bridges and crystal stairs, power
machines and calm the Stone Guardian. It runs on desktop and in the browser (`/mathmagic/` on this site),
with keyboard, gamepad or on-screen touch buttons, in English, Russian and Romanian. An Android export
preset is ready (not built yet, see below).

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

**Touch screens.** Four round buttons appear while a level is played: ◀ ▶ at the bottom left (slide a finger
between them without lifting it), jump and a sparkle "use" button at the bottom right; the world shows the
same sparkle over the thing you can use. Answers, hints, pause and menus are tapped directly. Settings →
"Touch buttons": Auto (only on a touch screen, the default), On or Off. The buttons hide while the math
dialog or a menu is open.

All actions are input-map actions in `project.godot` (Project Settings → Input Map), so they can be rebound
without touching code. Menus work with the mouse and the keyboard (arrows/Tab + Enter); a gamepad
navigates them through Godot's default `ui_*` actions (not tested yet).

## Run it

- **Editor:** open `godot/mathmagic/project.godot` in Godot 4.7.x and press F5. The main scene is
  `scenes/main/main.tscn`.
- **Browser, through the site:** `go run . -addr :8080` in the repository root, then open
  `http://localhost:8080/mathmagic/` (`?lang=en`, `ru` or `ro` picks the language).
- **Re-convert the Quaternius plants** (only if the `.blend` changes): `python -I tools/mathmagic/nature.py AllModels.blend`
  with Blender as a Python module (`pip install bpy==4.5.9`, Python 3.11).
- **Rebuild the web version:** `GODOT=/path/to/godot-4.7.2 tools/mathmagic/build.sh` runs the tests and
  exports to `web/mathmagic/`. It needs the Godot 4.7.2 web export templates. `--sounds` regenerates the audio
  first (Python 3 + numpy).
- **Desktop builds:** `export_presets.cfg` has Linux and Windows presets (output under `build/mathmagic/`,
  which git ignores). Install the desktop export templates, then use Project → Export.
- **Android:** the "Android" preset builds an arm64 APK to `build/mathmagic/android/MathMagic.apk`
  (package `org.awesomegame.mathmagic`, landscape, immersive). It needs the Godot 4.7.2 Android export
  templates, an Android SDK with platform-tools and build-tools set in Editor Settings, and a keystore (the
  debug one for testing; set a release keystore in the preset before publishing). Then
  `godot --headless --path godot/mathmagic --export-debug Android ../../build/mathmagic/android/MathMagic.apk`.
  Not built here: this machine has neither the templates nor the SDK; Godot reports only those two as
  missing, not any problem with the preset.
- **Level scenes** are written by `python3 tools/mathmagic/levels.py` (all, or e.g. `level7`) from short
  Python descriptions. Edit a level there and regenerate, or edit the `.tscn` in the editor and stop
  regenerating that level.

## The game

| # | Level | New idea | Puzzles |
|---|---|---|---|
| 1 | Counting Beach | Count real stones on pedestals and add small numbers (up to 5) | 2 addition gates with countable stones |
| 2 | Broken Bridges | Collect stones, count the empty spots: the missing amount (`3 + ? = 6`) | 2 bridges, the second longer and harder |
| 3 | Gate Garden | Subtraction ("take away"), then addition, then a gate that picks the harder one for you | 3 gates |
| 4 | Windmill Hill | Puzzles combined: fill an energy machine to start the lift, use the stones from up there to fix a bridge, open a gate | machine + lift + bridge + gate |
| 5 | Stone Guardian | Boss: everything learned, under gentle pressure | 3 phases |
| | **Multiplication Mountains** | | |
| 6 | Equal Groups Trail | Multiplication as equal groups: piles of the same size on pedestals (`2 × 3`) | 3 gates, the last without objects |
| 7 | Crystal Steps | The new puzzle: crystal steps up cliffs too tall to jump, each step needs the same number of crystals | 2 staircases + a gate on the ledge |
| 8 | Summit Path | Everything together, higher difficulty | bridge, staircase, machine + lift, summit gate |

The mountains open after the Stone Guardian; progress is one line through both worlds, so an older save
with the island finished continues in the mountains. The map shows one column per world; the mountains
have a cooler sky and peaks, pines and rocks around the path.

**Crystal steps** (`StepsPuzzle`). A cliff taller than any jump, with ghost steps leading up to it. Each
step has the same number of empty crystal sockets, so the question is `steps × crystals per step`. The right
answer lights the crystals and the steps rise one group at a time and become solid. A wrong answer fills the
steps in order with that many crystals: too few leaves steps dark ("some steps have no crystals yet"), too
many sends the extra crystals flying ("crystals are left over"). An invisible wall keeps the hero out of the
ghost steps until they are real.

**Multiplication** (`mul` skill). Questions are `a × b` with `a` groups of `b`; the table goes from `2 × 2`
to at most `5 × 6`, so every group can still be counted one by one. The dialog draws each group in its own
box; the hint numbers every stone and writes the running total under each box (3, 6, 9: counting on).
Wrong choices are the typical slips: one group too many or too few, and adding the two numbers. The skill
adapts like the others and is saved with them.
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
  scenes/main/main.tscn  the app; scenes/levels/level_1..8.tscn the levels (written by tools/mathmagic/levels.py)
  scripts/
    main/        main.gd (screen flow), menu_backdrop.gd
    player/      player.gd (PlayerController)
    gameplay/    level.gd, level_manager.gd, game_camera.gd, interactable.gd, pickup.gd, checkpoint.gd, goal.gd,
                 puzzle_base.gd + gate_puzzle.gd, bridge_puzzle.gd, energy_puzzle.gd, steps_puzzle.gd
    bosses/      stone_guardian.gd (BossController), boss_rune.gd
    math/        math_challenge.gd, challenge_generator.gd, math_challenge_manager.gd
    progression/ level_catalog.gd, progress_manager.gd
    save/        save_manager.gd
    ui/          ui_manager.gd, challenge_dialog.gd, counting_view.gd, ui_theme.gd, touch_controls.gd
    world/       ground.gd (hex tiles, floating islands or sculpted terrain), terrain.gd (the sculpted ground mesh),
                 shapes.gd (crystals, gems, bevelled blocks), prop.gd, art.gd (models, heroes, materials), fx.gd,
                 lift.gd, windmill.gd, sign_post.gd, level_environment.gd (sky, light and fog per world)
    audio/       sfx.gd
  data/strings.csv       EN/RU/RO texts (Godot imports it as translations)
  tests/                 run.gd (unit), playthrough.tscn (bot plays the game)
  docs/ASSETS.md         asset manifest and licenses
  docs/ART.md            art direction, the mountain art pass, lighting values
```

| Piece | Responsibility |
|---|---|
| `MathChallenge` | One question as data: operation, operands, answer, choices, difficulty, skill, hint, visual flag. |
| `ChallengeGenerator` | Builds valid questions for a skill and difficulty. Static and seeded; all number ranges live in its `LEVELS` and `MUL_LEVELS` tables. Distinct, non-negative choices made of typical slips (±1, ±2, adding instead of subtracting, giving the total). |
| `MathChallengeManager` (autoload) | Creates challenges at the right difficulty, records results, adapts per skill, finds the weakest skill, and keeps the single open challenge (a second request while one is open is refused). |
| `PuzzleBase` | Puzzle lifecycle (idle → active → solved), signals `solved` / `state_changed`, answer checking, friendly messages, checkpoint. Subclasses only build visuals and say what an answer does to the world. |
| `Level` | Root of each level scene: environment, mage, camera, stones and gems, objective, checkpoints, respawn, hearts, completion. |
| `LevelManager` | Loads (and caches) level scenes, restarts, reports completion. |
| `LevelCatalog` | The worlds and their levels in play order; which world a level is in. |
| `ProgressManager` (autoload) | Unlocked and completed levels, gems, settings. State plus signals only. |
| `SaveManager` (autoload) | Writes ProgressManager + MathChallengeManager as one small JSON (desktop: `user://mathmagic_save.json`, browser: `localStorage["mathmagic.save"]`). Missing, broken or future-version saves load as defaults; every field is type- and range-checked. Saves once per frame when anything changes. |
| `UIManager` | HUD, toasts, intro / pause / result / title / map / settings cards, the challenge dialog. Emits button signals; `main.gd` decides the flow. |
| `TouchControls` | On-screen buttons (`TouchScreenButton`, multi-touch) that press the same input actions as the keys, so nothing else knows about touch. |
| `StoneGuardian` | Boss phases, telegraphed attacks, tired state, reactions, victory. |
| `Sfx` (autoload) | Sound pool and music; loads every sound once at start. |

Communication is by signals: a puzzle opens a challenge through the manager, the dialog listens and calls
back `submit_answer()` / `dialog_closed()`; levels emit `objective_changed`, `stones_changed`, `message`,
`completed`; the UI subscribes. The four autoloads are the only global state, and each is a real
cross-scene service. Level scenes are plain `.tscn` files placing reusable pieces (Ground, Prop, puzzles,
pickups, Checkpoint, Goal, StoneGuardian) and are editable in the editor. A new world means new level
scenes and `LevelCatalog` entries; a new puzzle type means a `PuzzleBase` subclass. Multiplication Mountains
was added exactly that way: a `mul` skill in the generator, one new puzzle (`StepsPuzzle`), three level
scenes, a world entry with its own sky palette, and the gate learning to show equal piles.

**Decisions (simplest reasonable option, noted for review):**
- Menus and HUD are built in code (`UIManager`, `UiTheme`) rather than hand-made Control scenes. One theme,
  easy to keep consistent, and "big text" is just a different theme.
- The gameplay plane is z = 0. The player's z is reset every physics frame, so nothing can push the mage into
  the background.
- The camera never rotates. It follows with look-ahead, is clamped to the level, pulls back in the boss
  arena, and frames the puzzle above the dialog while a challenge is open (stepping back 20% so the whole
  puzzle fits). It sits close enough that the hero is a clear figure; the hero model is also drawn a little
  larger than its collision capsule, which is unchanged. Below 16:10 it keeps the width instead of
  the height, so the path ahead stays visible on narrow and portrait screens.
- Island terrain is hex tiles in one MultiMesh per layer (a few draw calls per strip); mountain terrain is one
  generated mesh per ground piece (`Terrain`), with its own colors baked into the vertices. One shadowed sun, no other
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

`tests/run.gd` (20 tests, about 1 s): addition, subtraction, missing-addend and multiplication results over 300 random
questions per skill and difficulty; right and wrong answer detection; distinct, non-negative choices that
contain the answer; number ranges per difficulty; difficulty clamping and monotonic ranges; the bridge's
answer cap; question text; adaptation up and down and its bounds; weak-skill repetition; save/load round
trip; broken, empty, wrong-version and missing saves; sanitizing bad values; every level scene loading with
spawn, camera limits, three gems, a goal or boss and valid challenges; every visible text translated;
every hero building with every animation the game plays, its tracks reaching its skeleton; every
decoration in every level pointing at a model that exists; multiplication within its table (groups, group
size, product at most 30, a staircase's cap on groups, the one-group-off slip offered, adaptation, an old save
without it); worlds in order with every level in one; a save from before the mountains opening them.

`tests/playthrough.tscn` (about 5 s; `--fixed-fps 60` runs the physics as fast as the machine allows): first the menu flows (intro card, pause and
resume with a frozen world, a double interaction ignored, "Later" closing and reopening the same question,
restart, map, title, picking a hero and seeing that hero in the level, and the touch buttons: real screen-touch
events walk right and jump, with two fingers down at once, release cleanly, and the buttons hide during the
dialog and when turned off), then a bot plays all eight levels with the real scenes, physics and dialog. It walks,
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
- [ ] on a phone and a tablet (browser, and the Android build once made): the buttons sit under the thumbs,
  sliding between ◀ and ▶ feels right, nothing important is hidden under them

## Known limitations

- The gate bars, bridge slabs, machine, gems, crystals and signs are code-built primitives (see
  `docs/ASSETS.md`). They are readable and consistent but simpler than the pack models around them.
- The 2.0 hero rig has no cheer or spell clips: the level-end cheer is a happy hop (`Jump_Full_Short`), a
  solved puzzle plays `Use_Item`, and the hero thinks with `Idle_B` during a challenge. Heroes carry no weapons.
- Touch controls are tested with synthetic touch events, not yet on a real phone or tablet. The Android
  preset is written and accepted by Godot, but no APK has been built or installed yet.
- The browser version was checked in headless Chromium with software rendering (under 2 FPS there), which
  confirms that it loads, reads input, saves to localStorage and switches language. Real-speed performance in
  browsers has not been measured.
- The bot answers wrong first on purpose, so the playthrough always runs at the lowest difficulty. Higher
  difficulties are covered by the unit tests, not by a full playthrough.
- Music is one short synthesized loop for every level.

## Next milestone

Build and install the Android APK and play both worlds on a real phone and tablet (button size and
placement, performance on a mid-range device). Then a short playtest with children: it would say more about
the difficulty curve of the multiplication levels and the crystal steps than any further polish. After
that, a boss for the mountains, reusing the Guardian's phase rhythm with multiplication.
