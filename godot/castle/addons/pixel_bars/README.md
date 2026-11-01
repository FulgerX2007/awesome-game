# Pixel Bars

Pixel-art status bars for Godot 4.3+: frames in several styles, fills, hearts, two nodes that
animate them, a Theme per style for plain ProgressBars, and sprite sheets for any other engine.

**The full pack:** **[Pixel Bars](https://heyheythere.itch.io/pixel-bars)** has eight frame styles (wood, stone, sky,
forest, royal, ember, gilded and cyan) and eight fills (adding XP, shield, rage, magic and
poison), with 195 sprite sheets. Same files and names: install it over this one.

## Use it

1. Copy `addons/pixel_bars/` into your project.
2. Project Settings > *Rendering > Textures > Default Texture Filter*: **Nearest**, or the pixels blur.
3. Draw the UI at a whole-number scale. The art is 1x, made for a UI about 240 pixels high: set
   *Display > Window > Stretch > Mode* to `canvas_items` and use a small viewport (320x180,
   480x270), or keep yours and set `get_tree().root.content_scale_factor` to 2, 3 or 4, as
   `demo/demo.gd` does.

## PixelBar

A `TextureProgressBar`. Set `shape`, `style` (a folder of `frames/`) and `fill` (a folder of
`fills/`), then `value` as usual.

| Shape | Size | Stretches |
|---|---|---|
| `BAR` | 16x12 and up | yes, set `custom_minimum_size` |
| `THIN` | 8x7 and up | yes |
| `VERTICAL` | 12x16 and up, fills upward | yes |
| `BOSS` | 32x16 and up, skull plate on the left | yes |
| `ORB` | 32x32, fills upward, with a glass glint | no; scale the node by whole numbers |
| `RING` | 20x20, fills clockwise, for cooldowns | no |

Under *Feel*: `trail` (a pale bar that holds `trail_hold` seconds after a drop, then drains at
`trail_speed` of the bar per second), `flash` (the fill lights up on a drop), `low` (the fill
pulses at or below this share). `segments` marks the track in equal parts. Call `settle()` after
setting a value you don't want animated, such as on load.

## PixelHearts

A `Range` drawn as a row of `icon`s (`heart`, `mini_heart`, `shield`, `star`), `per_icon` points
to each: a heart at 4 empties by quarters, at 2 by halves. `columns` wraps the row, `gap` spaces
it. Icons a drop empties blink.

## Themes

`themes/<style>.tres` styles `ProgressBar` with the style's frame and the health fill, and adds a
variation per fill: `HealthBar`, `ManaBar`, `StaminaBar`, `XPBar`, `ShieldBar`, `RageBar`,
`MagicBar`, `PoisonBar`. It also sets the pixel font (`font/pixel_ui_font.fnt`, 8px glyphs on a
10px line). Keep a ProgressBar 12 pixels high, the frame's height.

## Files

- `frames/<style>/<shape>.png`: the empty frames. `fills/<fill>/<shape>.png`: the fills, each the
  same size as its frame and transparent outside the track; `fills/trail/` is the damage trail.
- `pips/*.png`: hearts, shields and stars, 16x16 (mini hearts 9x8).
- `slices.json`: the stretching shapes' 9-slice margins, left, top, right, bottom.
- `sheets/`, at the download's top level: the sprite sheets, one horizontal strip each, listed
  in `sheets.json` with their frame size, frame count, speed and whether they loop.
