# Premium 2.5D graphics for the eight ad games

## Overview
- Raise the eight «Игры из рекламы» from flat Canvas 2D art to a polished, stylized casual look:
  lit volumes, soft contact shadows, glossy materials, consistent top-left light, particles, easing and camera feel.
- Rules, levels, controls, scoring and saves do not change. Only the drawing code in each `game.js`
  (and CSS where the frame around the canvas needs it) changes.

## Context (from discovery)
- Engine: none. Each game is plain JS on **Canvas 2D**, served by the Go server from the embedded `web/`.
  Rules are DOM-free in `core.js` (tested in Node), pure view helpers (fitting, hit-testing, gestures) in `view.js`,
  and `game.js` owns screens, input, the loop and all drawing.
- Hard constraints already enforced by `tests/*/build.test.js`: no network, no external assets, relative paths only,
  every RU string has a RO translation. Games are also published as standalone pages.
- Graphics are drawn in code; there are no image assets to replace.

## Rendering decision
- **No WebGL / Three.js.** Vendoring a 3D engine (~600 KB) and rebuilding eight renderers around it would rewrite the
  games, not upgrade them, and would break the "no external assets, drawn in code" property and the hit-testing that
  `view.js` tests pin down. Canvas 2D with a shared lighting/material kit gets the ad look at a fraction of the risk,
  and runs on every phone the games already support.
- **New shared kit `web/fx.js` (`window.Fx`)**, loaded after `nav.js`: one light direction, colour shading,
  lit primitives (`sphere`, `block`, `prism`, `cylinder`, `metalBar`, `bean`, `glass`), baked soft `shadow`/`glow`
  sprites, `vignette`, chunky outlined `text`, easing + `damp`, `Particles`, trauma `Shake`, `Floaters`.
  Pure parts are tested in `tests/fx/fx.test.js`.
- Per game:

| Game | Dir | Approach |
|---|---|---|
| Pull the Pin (Тяни штифт) | `pins` | 2.5D, fixed front camera: bevelled masonry with AO, chrome pins, glossy water with meniscus, emissive lava, splashes |
| Number Rush (Числовой забег) | `rush` | Pseudo-3D perspective, elevated follow camera: extruded gates, lit crowd with run cycle and shadows, volumetric obstacles |
| Save the Survivor (Долгая зима) | `winter` | Top-down → 2.5D three-quarter view on the same ground grid: extruded trees, rocks, cabin, y-sorted, cast shadows |
| Hero Evolution (Путь героя) | `hero` | Side view 2.5D stage with parallax, lit characters/weapons, hit flash, damage numbers; dimensional map tokens |
| Build & Defend (Рубеж) | `front` | Side view with layered parallax, prism buildings, construction animation, projectile trails, impacts |
| Last Castle (Последняя крепость) | `castle` | Fixed side camera, dimensional stone castle, shaded enemies, arrow trails, impact sparks |
| Parking Escape (Тесная парковка) | `parking` | Top-down with dimensional cars (body + roof, glass reflections, contact shadows), asphalt and markings |
| Water Sort (Цветные колбы) | `sort` | Logic stays 2D: glass tubes, glossy liquid with meniscus, poured stream along an arc |

- Input never depends on the drawing: objects extrude **up** from the same ground positions, so every
  `view.js` hit-test, gesture and grid mapping stays as it is. Screen shake offsets only the drawing.

## Performance rules
- Static scenery is baked into offscreen layers when the level loads or the canvas resizes.
- Glows and shadows are baked radial sprites stretched with `drawImage`; no per-cell gradients in hot loops.
- Particle pools are capped; device pixel ratio stays capped as before (≤ 2).

## Tasks
- [x] Shared kit `web/fx.js`, its tests, script tag in the eight pages, build tests and `main_test.go`.
- [x] One task per game: upgrade drawing in `web/<game>/game.js`, keep `node --test tests/<game>/` and
      `tests/<game>/smoke.cjs` green, compare before/after screenshots on a phone viewport.
- [x] README: note the shared kit and the 2.5D look.

## Outcome
- All eight games upgraded; only `game.js` (and `style.css` in sort, winter, hero, front, castle, rush) changed per game.
  No changes to `core.js`, `levels.js`, `content.js`, `view.js` or `lang.js`; no new strings; save formats unchanged.
- Side changes worth knowing:
  - `hero`: the battle canvas may now be up to 1.15× as tall as wide (was 0.75×) so portrait phones fill; DPR cap 3 → 2.
  - `castle`: the canvas fills the whole stage; portrait gets extra sky and a foreground around the same play strip.
  - `winter`: smoothed follow camera; a frame that runs over 40 ms (sprite baking) does not count as game time.
  - `rush`: the vignette moved from the canvas to CSS (≈6 ms/frame saved).
  - `tests/winter/smoke.cjs`: the reload and «Начать день заново» checks read the clock after the game has resumed,
    so they now allow it a frame or two (≤ 2 s / < 1 s of game time) instead of an exact value.
- Heaviest scenes in headless Chromium: rush big crowd ≈ 18 ms/frame (was 13), castle at 4× CPU throttle ≈ 30 fps
  (was 60; the canvas now covers ~3× more pixels), pins slightly faster than before.
