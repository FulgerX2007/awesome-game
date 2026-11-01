# MathMagic asset manifest

Every file under `assets/` is listed here with where it came from and its license. Licenses were checked
in the packs themselves (each pack's `LICENSE.txt` is kept next to its files). No ripped or commercial assets.

## Final assets (from third-party packs)

| Asset | Files in the project | Source | License | Attribution |
|---|---|---|---|---|
| KayKit Adventurers Character Pack 2.0 (FREE), by Kay Lousberg | `assets/models/heroes/*`: six heroes (Mage, Knight, Ranger, Barbarian, Rogue, Hooded Rogue) and the shared `Rig_Medium` animations (`Rig_Medium_General.glb`, `Rig_Medium_MovementBasic.glb`) | Supplied by the project owner (`KayKit_Adventurers_2.0_FREE.zip`); https://kaylousberg.itch.io/kaykit-adventurers | CC0 1.0 (`heroes/LICENSE.txt`) | Not required. Credited anyway: "Kay Lousberg, www.kaylousberg.com" |
| Kenney Mini Forest 1.0, by Kenney | `assets/models/kenney_forest/*`: floating grass platform, wooden deck (the lift), tall and small pines, plants, grass patches, tent, ladder, rope fence, stumps, rocks; one shared `Textures/colormap.png` | Supplied by the project owner (`kenney_mini-forest_1.0.zip`); https://kenney.nl/assets | CC0 1.0 (`kenney_forest/LICENSE.txt`) | Not required. Credited anyway: "Kenney, www.kenney.nl" |
| KayKit Medieval Hexagon Pack 1.0, by Kay Lousberg | `assets/models/hexagon/*` (hex tiles for ground and sea, trees, rocks, hills, mountains, clouds, houses, windmill, well, tower, tent, fence, flags, barrel, crate, sack; one shared atlas `hexagons_medieval.png`) | https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0 | CC0 1.0 | Not required. Credited anyway |
| KayKit Dungeon Remastered 1.0, by Kay Lousberg | `assets/models/dungeon/*` (gold chest, column, pillar, lit torch, banner) | https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0 | CC0 1.0 | Not required. Credited anyway |
| Golos Text, by The Golos Text Project Authors | `assets/fonts/GolosText.ttf` (Latin, Cyrillic, Romanian diacritics) | https://github.com/googlefonts/golos-text (copied from `godot/pins`) | SIL Open Font License 1.1 | License kept in `assets/fonts/OFL-GolosText.txt` |
| DejaVu Sans (13-glyph subset: ● ◆ ♥ ♡ ✦ ★ ☆ ◀ ▶ ! ? −) | `assets/fonts/Symbols.ttf` | https://dejavu-fonts.github.io/, cut with `pyftsubset` from the system font | Bitstream Vera / DejaVu license (free, redistributable) | License kept in `assets/fonts/LICENSE-DejaVu.txt` |

KayKit and Kenney Mini Forest are both flat-shaded pastel low-poly with one small color atlas per pack, so
they sit together without a style clash (checked side by side in renders before use). Only the files listed
are copied; the rest of each pack (weapons, the Kenney archer) is not in the project. The KayKit Adventurers
1.0 Mage used by the first version was replaced by the 2.0 heroes and removed.

## Original assets (made for this game)

| Asset | Files | How | License |
|---|---|---|---|
| Sound effects (23) and the music loop | `assets/audio/*.wav` | Synthesized by `tools/mathmagic/sounds.py` (numpy): tones, sweeps and filtered noise | CC0, part of this repository |
| Counting stones, gems, gate bars and rune plate, bridge slabs and empty spots, energy machine and meter, lift, rune crystals, Stone Guardian's eyes, core and shield, warning rings | built in code (`scripts/`) from Godot primitive meshes | Original | Same as the code |
| The Stone Guardian | `scripts/bosses/stone_guardian.gd` assembles it from the hexagon pack's rocks and mountain plus primitives | Original design | Same as the code |
| UI theme, buttons, counting view, HUD, menus | `scripts/ui/*` | Drawn in code, no image files | Same as the code |

## Placeholder geometry

These pieces are code-built primitives that do their job and read clearly, but are not modeled art yet.
Replacing one means swapping the mesh in its script; the puzzle logic does not depend on the look.

- gate bars and rune plate (`gate_puzzle.gd`), bridge slabs (`bridge_puzzle.gd`)
- energy machine body, crystal and meter (`energy_puzzle.gd`), lift deck (`lift.gd`)
- rune pedestals and light beams (`boss_rune.gd`), the Guardian's shield bubble and warning rings
- sign posts (`sign_post.gd`), gems (two prisms in `pickup.gd`)

Replaced by pack models since the first version: the floating platforms (now Kenney islands, `ground.gd`
style "island") and the lift deck (Kenney wooden deck).

## Not used

Sources checked but not used: Quaternius (its downloads go through Google Drive), OpenGameArt and itch.io
(not needed). Kenney's site was blocked by the build network; its Mini Forest pack came as a supplied file.
