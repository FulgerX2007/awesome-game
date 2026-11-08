# UI kit of Долгая зима on Godot — sources and licenses

Everything in `godot/winter/assets/ui/` is generated in-house by the code in this folder (numpy + Pillow, no
external images, no stock art, no AI-generated pictures). It belongs to the project like the rest of its code.

| Asset | Source | License |
|---|---|---|
| Icons `ui.icon.*`, nine-slice panels, buttons, bars, slot, tooltip | `icons*.py`, `kit.py` (signed distance fields, lit by `palette.LIGHT`) | the project's own |
| Logo `ui.title`, `ui.title.ro` | `title.py`; letters set in **Golos Text** (`godot/winter/assets/fonts/GolosText.ttf`) | the font: SIL Open Font License 1.1 (`OFL-GolosText.txt` next to it), the rest the project's own |
| Menu backdrop `ui.menu.bg` | `menubg.py` (procedural painting) | the project's own |

The OFL lets the font be embedded in the game and used to render images; the rendered logo is not the font
itself and carries no restriction. Regenerate everything with `python3 tools/winter-godot/art/ui/build.py`.
