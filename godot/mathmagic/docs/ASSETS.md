# MathMagic asset manifest

Every file under `assets/` is listed here with where it came from and its license. Licenses were checked
in the packs themselves (each pack's `LICENSE.txt` is kept next to its files). No ripped or commercial assets.

## Final assets (from third-party packs)

| Asset | Files in the project | Source | License | Attribution |
|---|---|---|---|---|
| KayKit Adventurers Character Pack 2.0 (FREE), by Kay Lousberg | `assets/models/heroes/*`: six heroes (Mage, Knight, Ranger, Barbarian, Rogue, Hooded Rogue) and the shared `Rig_Medium` animations (`Rig_Medium_General.glb`, `Rig_Medium_MovementBasic.glb`) | Supplied by the project owner (`KayKit_Adventurers_2.0_FREE.zip`); https://kaylousberg.itch.io/kaykit-adventurers | CC0 1.0 (`heroes/LICENSE.txt`) | Not required. Credited anyway: "Kay Lousberg, www.kaylousberg.com" |
| Kenney Mini Forest 1.0, by Kenney | `assets/models/kenney_forest/*`: floating grass platform, wooden deck (the lift), tall and small pines, plants, grass patches, tent, ladder, rope fence, stumps, rocks; one shared `Textures/colormap.png` | Supplied by the project owner (`kenney_mini-forest_1.0.zip`); https://kenney.nl/assets | CC0 1.0 (`kenney_forest/LICENSE.txt`) | Not required. Credited anyway: "Kenney, www.kenney.nl" |
| Ultimate Stylized Nature Pack (May 2022), by Quaternius | `assets/models/nature/*`: 6 bushes, 5 flower clumps, 2 grass tufts, 3 plants (`.gltf` + `.bin`), textures shared in `nature/textures/` at 512 px | Supplied by the project owner as `AllModels.blend` (its texture paths name this pack); converted with `tools/mathmagic/nature.py`; https://quaternius.com/packs/ultimatestylizednature.html | CC0 1.0, per the pack page (`nature/LICENSE.txt`) | Not required. Credited anyway: "Quaternius" |
| KayKit Medieval Hexagon Pack 1.0, by Kay Lousberg | `assets/models/hexagon/*` (hex tiles for ground and sea, trees, rocks, hills, mountains, clouds, houses, windmill, well, tower, tent, fence, flags, barrel, crate, sack; one shared atlas `hexagons_medieval.png`) | https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0 | CC0 1.0 | Not required. Credited anyway |
| KayKit Dungeon Remastered 1.0, by Kay Lousberg | `assets/models/dungeon/*` (gold chest, column, pillar, lit torch, banner) | https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0 | CC0 1.0 | Not required. Credited anyway |
| KayKit Forest Nature Pack 1.0 (FREE), by Kay Lousberg | `assets/models/kaykit_forest/*`: every rock (Rock_1, Rock_2, Rock_3 families), tree (Tree_1–4, Tree_Bare), bush and grass model of the free pack, `.gltf` + `.bin`, one shared `forest_texture.png` (1.8 MB in all). Used in Multiplication Mountains: rounded Rock_3 boulders for the distant range and the cliff feet, Tree_1/3/4 and round bushes along the path | Downloaded from https://kaylousberg.itch.io/kaykit-forest (free "Forest Nature Pack 1.0 FREE" zip, 1 Nov 2026) | CC0 1.0 (`kaykit_forest/LICENSE.txt`) | Not required. Credited anyway: "Kay Lousberg, www.kaylousberg.com" |
| Golos Text, by The Golos Text Project Authors | `assets/fonts/GolosText.ttf` (Latin, Cyrillic, Romanian diacritics) | https://github.com/googlefonts/golos-text (copied from `godot/pins`) | SIL Open Font License 1.1 | License kept in `assets/fonts/OFL-GolosText.txt` |
| DejaVu Sans (13-glyph subset: ● ◆ ♥ ♡ ✦ ★ ☆ ◀ ▶ ! ? −) | `assets/fonts/Symbols.ttf` | https://dejavu-fonts.github.io/, cut with `pyftsubset` from the system font | Bitstream Vera / DejaVu license (free, redistributable) | License kept in `assets/fonts/LICENSE-DejaVu.txt` |

The KayKit Forest pack was chosen for the mountains because it is by the same artist as the heroes and the
hexagon pack (same proportions, rounded silhouettes, one small atlas); a labelled render of every rock, tree
and bush was made before choosing, which showed that Rock_1 and Rock_2 are stacked blocks and Rock_3 the
rounded boulders, so only Rock_3 is used for scenery.

KayKit and Kenney Mini Forest are both flat-shaded pastel low-poly with one small color atlas per pack, so
they sit together without a style clash (checked side by side in renders before use). The Quaternius plants
are textured, so they are used only as small ground decor (bushes behind the path, flowers and grass in
front), where the extra detail reads as richness rather than a different style. Only the files listed
are copied; the rest of each pack (weapons, the Kenney archer) is not in the project. The KayKit Adventurers
1.0 Mage used by the first version was replaced by the 2.0 heroes and removed.

## Original assets (made for this game)

| Asset | Files | How | License |
|---|---|---|---|
| Sound effects (23) and the music loop | `assets/audio/*.wav` | Synthesized by `tools/mathmagic/sounds.py` (numpy): tones, sweeps and filtered noise | CC0, part of this repository |
| Mountain ground and cliffs | `scripts/world/terrain.gd`: one sculpted mesh per ground piece (rounded grass top, worn path, layered rock sides, wedge-shaped floating ledges), vertex-colored | Original, generated in code | Same as the code |
| Crystals, cut gems, bevelled stone blocks | `scripts/world/shapes.gd`: faceted crystal prisms and clusters, an eight-sided cut gem, chamfered boxes (crystal steps, energy machine) | Original, modeled in code | Same as the code |
| Counting stones, gems, gate bars and rune plate, bridge slabs and empty spots, energy machine and meter, lift, rune crystals, crystal steps and their crystals, Stone Guardian's eyes, core and shield, warning rings, the on-screen touch buttons | built in code (`scripts/`) from Godot primitive meshes | Original | Same as the code |
| The Stone Guardian | `scripts/bosses/stone_guardian.gd` assembles it from the hexagon pack's rocks and mountain plus primitives | Original design | Same as the code |
| UI theme, buttons, counting view, HUD, menus | `scripts/ui/*` | Drawn in code, no image files | Same as the code |

## Placeholder geometry

These pieces are code-built primitives that do their job and read clearly, but are not modeled art yet.
Replacing one means swapping the mesh in its script; the puzzle logic does not depend on the look.

- gate bars and rune plate (`gate_puzzle.gd`), bridge slabs (`bridge_puzzle.gd`)
- the energy machine's meter (`energy_puzzle.gd`); its body and crystal are now modeled (`Shapes`)
- rune pedestals and light beams (`boss_rune.gd`), the Guardian's shield bubble and warning rings
- sign posts (`sign_post.gd`)

Multiplication Mountains is built from the KayKit Forest models above on the sculpted terrain, plus the
hexagon pack's flags and tower, under its own lighting (`level_environment.gd`). The Island of Addition still
went through the same pass: all eight levels now use the sculpted terrain and KayKit Forest scenery. The
hexagon tiles, mountains, trees and rocks, the Kenney platforms, plants, stones, fence, tent and ladder, and
the Quaternius plants are no longer placed by any level (still used: the Kenney wooden deck of the lift, the
hexagon buildings, flags, clouds and the rocks the Stone Guardian is built from) (the files stay, and `levels.py` can still write the old style for a level with
`L.terrain = False`).

Not used from the supplied `AllModels.blend`: its trees (birch, maple, pine, palm, "normal", dead) and rocks.
Their textures were not packed into the file (only paths to the author's own disk), so they render blank; the
birches do have textures, but their yellow foliage clashes with the island's teal trees. With the original
pack's texture files, `tools/mathmagic/nature.py` can export the trees too.

Replaced by pack models since the first version: the floating platforms (now Kenney islands, `ground.gd`
style "island") and the lift deck (Kenney wooden deck).

## Not used

**Quaternius Stylized Nature MegaKit (Standard, CC0)** was downloaded (https://quaternius.itch.io/stylized-nature-megakit)
and checked: its painterly, textured foliage and photo-like rock textures do not match the flat KayKit style
of the heroes and props, so none of it is in the project.

**Imp.glb and Puglin.glb** (supplied by the project owner, with three color variants, an emissive mask and a
normal map). By their names, rig (an Unreal-style humanoid skeleton) and texture set they appear to be from
Quaternius' "Bestiary – Dungeon Monsters Kit", which is under the Quaternius Asset License (QAL), not CC0: the
models may be used in a game, but the asset files themselves may not be redistributed. This repository is
public, so the raw files are not committed. They also have no animations of their own (they would need
Quaternius' Universal Animation Library). Not used until their purpose and licensing are decided.

Sources checked but not used: Quaternius (its downloads go through Google Drive), OpenGameArt and itch.io
(not needed). Kenney's site was blocked by the build network; its Mini Forest pack came as a supplied file.
