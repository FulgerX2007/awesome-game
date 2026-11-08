# Долгая зима on Godot — asset licenses

Every asset of the game is listed here with its source, author and license. No watermarked or unlicensed files.

## World art: environment, buildings, effects
- Folders: `assets/environment/`, `assets/buildings/`, `assets/effects/`; manifests `assets/manifest/{environment,buildings,effects}.json`.
- Source: generated in-house by code, `tools/winter-godot/art/` (`paint.py` — a heightfield painter on numpy + Pillow;
  `environment.py`, `buildings.py`, `effects.py`). No external images, models or textures are used.
- Author: the Awesome Game project. License: the same as the project's code.
- Regenerate: `python3 tools/winter-godot/art/build_all.py` (deterministic, about 3 minutes).

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

## Sound
- No files: every sound is synthesized at start by `scripts/app/sfx.gd` (a port of `web/winter/audio.js`).

## Fonts
- `assets/fonts/GolosText.ttf` — Golos Text by Paratype, SIL Open Font License 1.1 (`assets/fonts/OFL-GolosText.txt`).
  Free for commercial use, may be bundled with the game.
