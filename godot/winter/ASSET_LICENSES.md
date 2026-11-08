# Долгая зима on Godot — asset licenses

Every asset of the game is listed here with its source, author and license. No watermarked or unlicensed files.

## World art: environment, buildings, effects
- Folders: `assets/environment/`, `assets/buildings/`, `assets/effects/`; manifests `assets/manifest/{environment,buildings,effects}.json`.
- Source: generated in-house by code, `tools/winter-godot/art/` (`paint.py` — a heightfield painter on numpy + Pillow;
  `environment.py`, `buildings.py`, `effects.py`). No external images, models or textures are used.
- Author: the Awesome Game project. License: the same as the project's code.
- Regenerate: `python3 tools/winter-godot/art/build_all.py` (deterministic, about 3 minutes).

## Painted art (the hero and the forest)
- Folder: `assets/painted/`; manifest `assets/manifest/override_painted.json` (it replaces the generated hero, trees,
  rocks, bushes, branches, drifts and ice, the hut's last two stages, the five survivors (made from the hero's
  frames recoloured), and the hare, deer, wolf and bear; the other generated buildings and effects stay).
- Source: images supplied by the project owner (`tools/winter-godot/source/`: an environment sheet, four GIFs of
  the hero walking, chopping, picking berries and mining, the finished log cabin, three GIFs of the hare, the deer
  and the wolf, and two pictures of the bear: standing and in its fighting stance). Cut, cleaned (the bush and the rock removed from the
  hero's frames, neighbours removed from each item's box) and scaled by `tools/winter-godot/import_art.py`.
- License: the project owner's; used with their permission as part of the project.
- Regenerate: `python3 tools/winter-godot/import_art.py`.

## Characters and animals
- Folder: `assets/characters/`; manifest `assets/manifest/characters.json`.
- Source: generated in-house by code, `tools/winter-godot/art/characters/` (a 2.5D puppet renderer on numpy + Pillow:
  `rig.py`, `humans.py`, `animals.py`, `build.py`). No external images, models or textures.
- Author: the Awesome Game project. License: the same as the project's code.
- Regenerate: `python3 tools/winter-godot/art/characters/build.py` (about 2.5 minutes).

## UI kit
- Folder: `assets/ui/`; manifest `assets/manifest/ui.json`.
- Source: generated in-house by code, `tools/winter-godot/art/ui/` (icons and nine-slices from signed distance fields,
  the logo set in Golos Text, the menu backdrop painted procedurally). No external images or stock art.
- Author: the Awesome Game project. License: the same as the project's code.
- Regenerate: `python3 tools/winter-godot/art/ui/build.py`.

## Fire flipbook (not in the repository)
- `assets/ember/fire_campfire.png` + `ember.json` — Fire Campfire from **Ember Flipbooks Lite** by Inkharbor Studio,
  bought from the official store page. Licence: Ember Flipbooks Licence 1.0 — use in products, modification and
  distribution inside a built product are allowed; publishing the files on their own or in a public repository is
  not (section 4.2). So the folder is in `.gitignore`; `tools/winter-godot/ember.py` makes it from the purchased archive
  (crops the flame and sparks, drops the wide glow, scales to 3/4), and the exported `index.pck` carries it.
  Without it the game uses its own generated flame (`assets/effects/fire/`).

## Sound
- No files: every sound is synthesized at start by `scripts/app/sfx.gd` (a port of `web/winter/audio.js`).

## Fonts
- `assets/fonts/GolosText.ttf` — Golos Text by Paratype, SIL Open Font License 1.1 (`assets/fonts/OFL-GolosText.txt`).
  Free for commercial use, may be bundled with the game.
