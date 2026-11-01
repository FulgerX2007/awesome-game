# MathMagic art direction and the art pass

The pass was made on Crystal Steps (level 7), applied to all of Multiplication Mountains, and then to the
Island of Addition (levels 1–5, the boss arena's rising stairs and the menu backdrop).

## Audit before the pass (Crystal Steps, level 7)

| What | Before | Imported asset or primitive |
|---|---|---|
| Ground | `Ground` style "hex": KayKit hexagon tiles (2 units wide, 1 high) in a MultiMesh, tinted green. Each tile is large on screen, so the path read as a grid | Imported (KayKit Medieval Hexagon) |
| Cliffs | The same hex tiles stacked up to 7 high, plus `hexagon/mountain_B` props behind: grey boxes with yellow tops | Imported, but the stacking makes the shape |
| Floating ledges | Kenney Mini Forest `platform` (a flat green slab with a salmon underside) | Imported (Kenney) |
| Crystal steps | `BoxMesh` cubes, lilac when built, translucent blue as ghosts | Primitive |
| Crystals | `SphereMesh` with 4 segments and 1 ring (a diamond), glow 1.4: bloomed to white | Primitive |
| Energy machine | `BoxMesh` + `PrismMesh` | Primitive |
| Gems | Two `PrismMesh` stacked (read as a pink cube) | Primitive |
| Vegetation | Kenney `tree-high` pines and the hexagon pack's trees; Kenney stones and rocks; hexagon `rock_single` (purple blocks) in front | Imported (two packs mixed) |
| Camera | Perspective, FOV 42 (66 below 16:10), offset (0, 4.2, 11.5), aims 1.4 above the hero, never rotates | — |
| Player | KayKit Adventurers 2.0 hero at scale 0.66 (about 1.7 units tall); capsule radius 0.32, height 1.3 | Imported |
| Light | One sun (energy 1.0, pitch −52°), flat ambient color at 0.45, filmic tonemap with the default white point 1.0, glow | — |
| HUD | Objective top left, counters top right; the challenge dialog is a full-width panel over the bottom 44% | — |

Findings:
- The whole level was overexposed: sun plus ambient lit grass beyond 1.0, and with a tonemap white point of
  1.0 everything clipped. Green came out as pale lime and grey rock as near white. Exposure barely helped;
  lowering the light did. This was measured, not guessed: the same scene was rendered with exposure, sun,
  ambient and glow each changed alone.
- Three asset families were mixed (KayKit hexagon, Kenney Mini Forest, Quaternius plants), with stacked
  blocks standing in for cliffs.
- The hero was small on screen (about 15% of the screen height).

## Direction

Polished stylized low-poly in the KayKit family, because the heroes, the gates' columns and the props are
already KayKit: rounded silhouettes, soft flat shading, one small color atlas per pack. For the mountains the
KayKit Forest Nature Pack provides the rocks and trees; what no pack has (ground, crystals, gems, carved
stone) is modeled in code in the same style: low-poly, flat-shaded facets, bevelled edges.

Palette (sRGB):

| Role | Colors |
|---|---|
| Grass | `#78b84a` to `#8fc957`, a worn path `#b8c06c` along the walking line |
| Earth (under the grass rim) | `#8a6646` |
| Rock (cliff layers) | `#a89e92`, `#958b80`, darker toward the sea `#6f675f`; KayKit boulders are a cool grey |
| Carved stone (built steps, machine) | `#9c8670`, darker cap `#7d6a58` |
| Crystal (magic accent) | `#a259ff`, glow 0.5–0.8; empty sockets `#e9e4ff` at 60% |
| Not yet real (ghost steps) | `#9ee8ff` at 30% |
| Gems | `#ff5fb4`, glow 0.9 |

Gameplay colors are kept apart from the scenery: purple means magic you made, light blue means not yet
there, pink is a gem; nothing in the scenery uses those.

## What changed

Ground and cliffs (`scripts/world/terrain.gd`, `ground.gd` style "terrain"):
- One sculpted mesh per ground piece instead of hex tiles: a grass top with a softly rounded rim, a little
  unevenness away from the walking line (none on it, so it never looks like a bump), a lighter worn path,
  and grass turning to earth as it bends over the edge.
- Sides in uneven layers of rock, each layer a different shade, darker cracks between them and darker toward
  the sea (standing in for ambient occlusion, which the Compatibility renderer does not have).
- The left and right edges stay straight: that is where the hero jumps, and the edge must show the truth.
- Floating ledges are the same mesh with a tapered, wedge-shaped rock underside; drawn 2 deep but solid only
  0.9, as before, so they never block a jump from below.
- Cliffs (pieces 4 or more high) get big rounded KayKit boulders (Rock_3) at their foot.
- Collision is the same box as before for every piece.

Puzzle steps (`steps_puzzle.gd`, `shapes.gd`):
- Bevelled carved-stone blocks, each turned a hair differently; a crystal strip along the front edge lights
  up once the step is built.
- Faceted crystals (six-sided prisms with a pointed tip, each slightly tilted) instead of diamonds; lit ones
  purple with a restrained glow, empty sockets pale.
- Positions, sizes and collision are unchanged.

Other modeled pieces: the energy machine is a carved stone pedestal with a growing crystal cluster; gems are
cut gems (eight-sided crown, table, pavilion).

Vegetation and scenery (`tools/mathmagic/levels.py`): one family, KayKit Forest. Pines and round trees well
behind the path (z ≤ −2.9, so they never cover the hero, a sign or a puzzle), round bushes at their foot,
small boulders and grass tufts at the front edge, and the distant range made of rounded KayKit boulders in
two rows. Signs moved in front of the trees.

Hero and camera: the hero model 0.66 → 0.74 (capsule, speed, jump and interaction radius unchanged); the
camera 17% closer at the same angle (offset (0, 3.6, 9.6), aims 1.3 above the hero). Together the hero is
about a third larger on screen. While a challenge is open the camera steps back to 1.2× that distance, which
is where it framed puzzles before, so whole puzzles still fit above the dialog. This applies to every level.

HUD: the challenge dialog is a little more compact (equation 58 px, answer buttons at least 88 px tall, less
spacing): it now covers about 40% of the screen instead of 44%. Gate questions sit lower so the closer
camera does not cut them off.

## Lighting (per world, `level_environment.gd`)

| Setting | Before (both worlds) | Island after | Mountains after |
|---|---|---|---|
| Sun energy | 1.0 | 0.82, warm `#fff0d6` | 0.75, `#ffeacc` |
| Sun pitch | −52° | −44° | −40° (longer, more readable shadows) |
| Ambient energy | 0.45 | 0.36 | 0.34 |
| Tonemap | filmic, exposure 0.9, white 1.0 | filmic, exposure 1.1, white 4.0 | the same |
| Fog | none | depth fog 18–55 units, max 0.4 | the same, max 0.55 |
| Crystal glow | 1.4 (bloomed white) | 0.5 lit crystals, 0.8 the strip; machine 0.8, 1.6 when solved |

No new post effects: the Compatibility renderer used for the browser has no SSAO or SDFGI, so occlusion is
painted into the terrain's vertex colors. Fog and the tonemap are cheap.

## The island pass

The level generator (`tools/mathmagic/levels.py`) does it with one flag per level, `L.terrain = True`:
- Ground pieces become the sculpted terrain, the Kenney floating platforms become grassy rock wedges.
- The island helpers (`kdecor`, `ndecor`, `trees`, `rocks`, `scenery`) switch to KayKit Forest: round trees
  and pines well behind the path (z −3.7 to −4.6, scale 0.55–0.78, so gates and signs stand clear), round
  bushes, knee-high grass tufts and small boulders at the front edge.
- The horizon: small green islands in the sea (the same terrain, tapered, with a few trees) instead of the
  hexagon pack's grey and yellow block mountains.
- Kenney fence and tent become the hexagon pack's (same artist as the heroes); the Kenney ladder is dropped.
- The hexagon buildings (houses, windmill, well, tower), the gates and the Stone Guardian stay: they are
  KayKit already and are characters of the island.
- The boss arena's rising stairs and the menu backdrop use the terrain too.

Found and fixed on the way: a bridge only became solid after its last stone landed (0.25 s per stone), so
on a long bridge a child who walked on at once fell through stones that were already showing. It was there
before the art pass (2 falls in 10 runs of level 2 with the old scene); the bridge is now solid at once
(0 falls in 10 runs).

## Validation

- `tests/run.gd`: 20 passed. `tests/playthrough.tscn`: the bot plays all eight levels (boss included) with
  the new ground, collision, camera and hero scale: all completed, no falls, save round trip identical.
- Screenshots before and after at the same spots (1280×720, Xvfb, OpenGL software rendering).
- No missing textures or import errors in the import log; the hero animations play (checked by the heroes
  test and in the screenshots).

## Not done / next

- Still primitive: gate bars and rune plate, bridge slabs, the energy meter, boss runes, sign posts.
- Grass is vertex color only (no texture or blades): it reads clean at this camera distance, but close up it
  is flat.
- Screenshots come from software rendering; colors on a real GPU and in browsers should be checked once.
