# Долгая зима on Godot — the asset contract

Every generator under `tools/winter-godot/art/` writes PNGs into `godot/winter/assets/…` and one manifest fragment
`godot/winter/assets/manifest/<group>.json`. The game (`scripts/world/*.gd`) loads every fragment and asks for
sprites **by key only**, so a generator may change files freely as long as the keys below stay.

## Rules for every sprite
- Scale: 1 tile = 96 px (`palette.TILE`), drawn 1:1 in the world. The hero is about 1.35 tiles tall, a large pine
  2.6 tiles, a rock about 1 tile wide. Everything shares this scale.
- Light from the upper left (`palette.LIGHT`), shadows blue-violet, the palette from `palette.py`. Soft volumes,
  no black outlines, no pixel art, no noise grain. Transparent background, trimmed (no empty borders beyond 2 px).
- `foot` is the pixel where the object touches the ground (bottom centre of its contact), in texture pixels. Godot
  places that pixel on the object's tile point and y-sorts by it.
- World sprites (environment, buildings, characters) ship a **normal map** (`<name>.n.png`, tangent space,
  +X right, +Y **down** as Godot 2D expects, flat = (128,128,255)) so `PointLight2D` lights them. UI and effects don't.
- Cast shadows are separate soft sprites (`<name>.shadow.png`, black with alpha ≤ 0.45, blurred) falling down-right
  (`palette.SHADOW_DIR`); their own `foot` lines up with the object's foot.
- Variants: a key ending in `.{n}` exists for every n from 0. Deterministic output (fixed seeds).
- Budget (PNG on disk): environment + buildings + effects ≤ 7 MB, characters ≤ 6 MB, UI ≤ 1.5 MB.

## Manifest fragment format
```json
{
  "tree.pine.0": { "file": "res://assets/environment/trees/pine_0.png", "normal": "res://…/pine_0.n.png",
                   "size": [180, 260], "foot": [90, 248],
                   "shadow": { "file": "res://…/pine_0.shadow.png", "foot": [40, 30] },
                   "block": 1 },
  "char.hero": { "sheet": "res://assets/characters/player/hero.png", "normal": "res://…/hero.n.png",
                 "frame": [160, 192], "foot": [80, 180],
                 "anims": { "walk_down": { "row": 1, "from": 0, "count": 8, "fps": 10, "loop": true }, … },
                 "layers": { "tint": "res://…/hero.tint.png" } }
}
```
`row`/`from` index frames in a grid of `frame`-sized cells. `layers.tint` (optional) is a grayscale sheet of the
same layout for clothes that the game tints per person.

## Keys

### environment (group `environment`)
| key | what |
|---|---|
| `tree.pine.0`…`tree.pine.5` | snowy spruces: 0–1 young (1.5 tiles), 2–3 middle, 4–5 tall (2.6 tiles). A map tree node |
| `tree.stump.0`…`2` | a cut tree (node depleted, regrows) |
| `tree.dead.0`…`2` | bare dead trees (decor) |
| `tree.fallen.0`…`1` | a fallen trunk ~2 tiles long (decor) |
| `log.0`…`1`, `branch.0`…`3` | logs, branches in the snow (decor, ground detail) |
| `rock.0`…`3` | a boulder with snow on top (map rock node, ~1 tile) |
| `rock.rubble.0`…`1` | broken stone left after mining (depleted) |
| `rock.small.0`…`2`, `rock.group.0`…`1` | pebbles, groups of rocks (decor) |
| `bush.berry.0`…`2` | a snowy bush with red berries (map bush node) |
| `bush.bare.0`…`2` | the same bushes picked clean (depleted, regrow) |
| `bush.snow.0`…`2` | snowy bushes without berries (decor) |
| `scrap.0`…`2` | rusted iron half in the snow: a sled runner, a cart wheel, a barrel hoop (map scrap node) |
| `snow.hill.0`…`2` | soft snow mounds (decor, ~1.5–2 tiles) |
| `snow.drift.0`…`2` | tall drifts on `D` tiles (impassable until dug) |
| `ice.formation.0`…`2` | ice shards and frozen spikes near the lake (decor) |
| `ice.hole` | a fishing hole in the ice (`o` tile; ground detail, no shadow) |
| `ground.patch.0`…`2` | thawed patches: earth, dry grass through the snow (ground detail) |
| `track.rabbit.0`…`1`, `track.deer.0`, `track.wolf.0` | animal tracks (ground detail, alpha decal) |
| `foot.boot.l`, `foot.boot.r` | boot prints (ground detail, alpha decal, ~0.2 tile) |
| `snow.sparkle` | a tiny star glint (ground detail) |

### buildings (group `buildings`)
| key | what |
|---|---|
| `hut.0`…`hut.4` | the hut, 3×2 tiles (foot at the bottom centre): 0 a ruin under snow (game start), 1 walls on a stone footing, 2 roof (snowy, two slopes), 3 door, 4 stove chimney |
| `hut.roofhole` | an overlay for stage ≥ 2: the hole the blizzard tore |
| `hut.scaffold` | an overlay: timber and ropes of a stage paid in part |
| `palisade.h`, `palisade.h.damaged`, `palisade.h.broken` | one tile of the north/south wall (sharpened stakes) |
| `palisade.v`, `palisade.v.damaged`, `palisade.v.broken` | one tile of the east/west wall |
| `palisade.post` | the corner post |
| `palisade.gate` | the south gate, 2 tiles wide, open |
| `palisade.stake` | a single stake (the parts of a wall paid in part) |
| `bench` | the workbench (1 tile): a saw, an axe, shavings |
| `firepit`, `firepit.ash` | the fire's stone ring and logs (the flame is an effect); `ash` — burnt out |
| `bunk`, `bunk.frame` | a bunk bed with furs; `frame` — paid in part |
| `up.cellar`, `up.smokehouse`, `up.annex`, `up.workshop` (+ `.frame` each) | the house upgrades: cellar door in a snow mound 1×1, smokehouse 1×1, annex 2×2, workshop 2×1 |
| `torch` | a torch pole (the flame is an effect) |
| `snare` | a snare loop on a stick (ground detail) |
| `trader.sled` | the trader's sled with bundles and a lantern (2×1 tiles) |
| `stock.wood`, `stock.stone` | the camp's woodpile and stone heap (shown when the stock has some) |

### characters (group `characters`, AnimatedSprite2D sheets)
- `char.hero`: animations × directions `down`, `up`, `side` (side faces right; the game mirrors it for left):
  `idle_*` (breathing, 4+ frames), `walk_*` (8), `chop_*` (6, axe swing with an impact frame), `mine_*` (6, pick),
  `gather_*` (6, picking/bending), `build_*` (6, hammering), `craft_*` (6, at a bench), `fire_*` (6, crouched feeding
  the fire/cooking), `hurt_*` (3), `death_*` (6, ends lying), `sleep_down` (2, lying). Layer `tint` optional.
- `char.villager`: the five survivors share it, with a `tint` layer for the coat: `idle_*`, `walk_*`, `work_*`, `sleep_down`.
  The child uses it scaled down. `char.trader` (`idle_down`), `char.wanderer` (`idle_down`: lying, shivering).
- `animal.rabbit`: `idle_side`, `hop_side` (+ `down`/`up` if possible). `animal.deer`: `idle_side`, `walk_side`.
- `animal.wolf`: `idle_side`, `run_side`, `bite_side`, `hurt_side`, `death_side` (+ `down`/`up` for run if possible).
- `animal.bear`: `idle_side`, `walk_side`, `swipe_side`, `hurt_side`, `death_side`.
- Every frame shares the sheet's `foot`; shadows are drawn by the game as a soft ellipse, so characters need no shadow file.

### effects (group `effects`)
`fx.flame` (sheet, 8 frames loop, the campfire flame ~0.9 × 1.4 tiles), `fx.flame.small` (6 frames, torches),
`fx.ember`, `fx.spark`, `fx.smoke.0`…`2`, `fx.snowflake.0`…`2`, `fx.light` (256 px radial falloff for PointLight2D),
`fx.light.soft`, `fx.chip.wood`, `fx.chip.stone`, `fx.breath`, `fx.fog` (512 px tileable noise), `fx.glow`,
`fx.aurora` (a 1024×256 tileable ribbon).

### ui (group `ui`)
Icons at 128 px, one style (frosted rim, warm accents): `ui.icon.<id>` for `health`, `warmth`, `food`, `stamina`,
`day`, `night`, `clock`, `wood`, `stone`, `metal`, `hide`, `berries`, `meat`, `fish`, `cookedMeat`, `cookedFish`,
`smokedMeat`, `smokedFish`, `axe`, `ironAxe`, `pick`, `shovel`, `icePick`, `spear`, `coat`, `lantern`, `sled`,
`snares`, `hut`, `palisade`, `bunk`, `torch`, `insulation`, `cellar`, `smokehouse`, `annex`, `workshop`, `fire`, `eat`,
`build`, `bench`, `pause`, `play`, `inventory`, `settings`, `sound_on`, `sound_off`, `action`, `star`, `star_empty`,
`wolf`, `bear`, `trader`, `survivor`, `warning`, `close`, `back`, `home`, `snow`, `blizzard`, `thermometer`.
Nine-slice textures (with `"slice": [l, t, r, b]` in the manifest): `ui.panel`, `ui.panel.dark`, `ui.button`,
`ui.button.hover`, `ui.button.pressed`, `ui.button.disabled`, `ui.bar.frame`, `ui.bar.fill`, `ui.slot`, `ui.tooltip`;
plus `ui.title` (the logo «Долгая зима», and `ui.title.ro` «Iarna lungă») and `ui.menu.bg` (1920×1080 menu backdrop).
