"""Icons of the camp's buildings, the action buttons, the creatures and the screen states."""
import math

import numpy as np

from icons import cog, handle, heart, icon, paint_flame, paint_log, u
from sdf import smin


# ───────────── buildings ─────────────
def cabin(c, cx, base, w, h, roof_h, door=True, chimney=False, window=True):
    """A log cabin with a snowy pitched roof; base is the y of its sill."""
    x0, x1 = cx - w / 2, cx + w / 2
    top = base - h
    c.fill(c.box(cx, base - h / 2, w, h, 0.01), "wood", hi="wood_hi", lo="wood_dark", bevel=0.03)
    n = 4
    for i in range(n):
        y = top + (i + 0.5) * h / n
        c.fill(c.capsule(x0 + 0.01, y, x1 - 0.01, y, h / n * 0.46), "wood", hi="wood_hi", lo="wood_dark", bevel=h / n * 0.45, spec=0.2)
    if window:
        c.glow(c.box(cx - w * 0.25, base - h * 0.55, w * 0.16, h * 0.3, 0.01), "glow_warm", 0.05, 0.5)
        c.fill(c.box(cx - w * 0.25, base - h * 0.55, w * 0.16, h * 0.3, 0.01), "fire_hi", hi="fire_core", lo="fire", bevel=0.02, edge=0.3)
    if door:
        c.fill(c.box(cx + w * 0.18, base - h * 0.36, w * 0.2, h * 0.72, 0.012), "bark", hi="bark_hi", lo="bark_dark", bevel=0.02)
    if chimney:
        c.fill(c.box(x1 - w * 0.2, top - roof_h * 0.55, w * 0.12, roof_h * 0.8, 0.01), "stone", hi="stone_hi", lo="stone_dark", bevel=0.02)
    roof = c.poly([(x0 - w * 0.1, top + 0.02), (cx, top - roof_h), (x1 + w * 0.1, top + 0.02)])
    c.fill(roof, "bark", hi="bark_hi", lo="bark_dark", bevel=0.04)
    snow = smin(c.poly([(x0 - w * 0.12, top - 0.01), (cx, top - roof_h - 0.035), (x1 + w * 0.12, top - 0.01), (x1 + w * 0.06, top + 0.03), (x0 - w * 0.06, top + 0.03)]),
                c.circle(cx, top - roof_h + 0.01, 0.05), 0.03)
    c.fill(snow, "snow", hi="snow_hi", lo="snow_shade", bevel=0.04, spec=0.6)


@icon("hut")
def _hut(c):
    c.fill(c.ellipse(0.5, 0.86, 0.44, 0.07), "snow", hi="snow_hi", lo="snow_shade", bevel=0.03)
    cabin(c, 0.5, 0.84, 0.62, 0.34, 0.28, chimney=True)


def stakes(c, xs, base, h, color="wood"):
    for i, x in enumerate(xs):
        hh = h * (0.9 + 0.1 * ((i * 7) % 3) / 2)
        st = c.poly([(x - 0.055, base), (x - 0.055, base - hh + 0.06), (x, base - hh), (x + 0.055, base - hh + 0.06), (x + 0.055, base)])
        c.fill(st, color, hi="wood_hi", lo="wood_dark", bevel=0.035)
        c.fill(c.ellipse(x, base - hh + 0.1, 0.05, 0.025), "snow", hi="snow_hi", lo="snow_shade", bevel=0.02, edge=0.2)


@icon("palisade")
def _palisade(c):
    c.fill(c.ellipse(0.5, 0.86, 0.46, 0.07), "snow", hi="snow_hi", lo="snow_shade", bevel=0.03)
    stakes(c, [0.17, 0.33, 0.5, 0.67, 0.83], 0.86, 0.66)
    c.fill(c.capsule(0.1, 0.42, 0.9, 0.42, 0.025), "bark", hi="bark_hi", lo="bark_dark", bevel=0.02)
    c.fill(c.capsule(0.1, 0.68, 0.9, 0.68, 0.025), "bark", hi="bark_hi", lo="bark_dark", bevel=0.02)


@icon("bunk")
def _bunk(c):
    for y in (0.4, 0.72):
        c.fill(c.box(0.5, y, 0.8, 0.1, 0.02), "wood", hi="wood_hi", lo="wood_dark", bevel=0.03)
        fur = smin(c.ellipse(0.52, y - 0.08, 0.32, 0.07), c.ellipse(0.24, y - 0.09, 0.1, 0.06), 0.03)
        c.fill(fur, "fur", hi="#f4e6cc", lo="fur_dark", bevel=0.05)
    for x in (0.12, 0.88):
        c.fill(c.capsule(x, 0.16, x, 0.9, 0.035), "wood_dark", hi="wood", lo="bark_dark", bevel=0.03)


@icon("torch")
def _torch(c):
    c.glow(c.circle(0.5, 0.3, 0.14), "glow_warm", 0.14, 0.5)
    c.fill(c.capsule(0.5, 0.42, 0.5, 0.92, 0.04), "wood", hi="wood_hi", lo="wood_dark", bevel=0.04)
    c.fill(c.box(0.5, 0.44, 0.14, 0.1, 0.03), "leather", hi="#9a7050", lo="#3a2618", bevel=0.03)
    paint_flame(c, 0.5, 0.26, 0.62)


@icon("insulation")
def _insulation(c):
    for i in range(3):
        y = 0.3 + i * 0.22
        c.fill(c.capsule(0.1, y, 0.9, y, 0.1), "wood", hi="wood_hi", lo="wood_dark", bevel=0.08)
    for x, y in ((0.3, 0.42), (0.62, 0.41), (0.46, 0.63), (0.78, 0.64), (0.2, 0.63)):
        c.fill(c.ellipse(x, y, 0.1, 0.045), "moss", hi="#9fc07a", lo="#3e5a30", bevel=0.03)
    pelt = c.poly([(0.56, 0.12), (0.9, 0.16), (0.86, 0.5), (0.6, 0.46)])
    c.fill(pelt, "fur", hi="#f4e6cc", lo="fur_dark", bevel=0.06)


@icon("cellar")
def _cellar(c):
    mound = np.maximum(c.ellipse(0.5, 0.8, 0.44, 0.5), c.y - 0.86)
    c.fill(mound, "snow", hi="snow_hi", lo="snow_shade", bevel=0.1, spec=0.5)
    door = np.maximum(c.ellipse(0.5, 0.86, 0.2, 0.36), c.y - 0.86)
    c.fill(door, "bark", hi="bark_hi", lo="bark_dark", bevel=0.03)
    for x in (0.42, 0.5, 0.58):
        c.fill(c.capsule(x, 0.56, x, 0.84, 0.006), "bark_dark", flat=True, alpha=0.8)
    c.fill(c.circle(0.6, 0.72, 0.02), "iron_hi", flat=True)


@icon("smokehouse")
def _smokehouse(c):
    for i, (x, y) in enumerate(((0.5, 0.2), (0.62, 0.1))):
        c.fill(c.circle(x, y, 0.08 - i * 0.015), "smoke", hi="#c9cfdb", lo="smoke_dark", bevel=0.05, alpha=0.85)
    c.fill(c.ellipse(0.5, 0.88, 0.4, 0.06), "snow", hi="snow_hi", lo="snow_shade", bevel=0.03)
    cabin(c, 0.5, 0.86, 0.46, 0.34, 0.2, door=True, window=False)
    for y in (0.62, 0.7):
        c.fill(c.capsule(0.3, y, 0.42, y + 0.06, 0.03), "#6b2a1e", hi="#a8523a", bevel=0.02)


@icon("annex")
def _annex(c):
    c.fill(c.ellipse(0.5, 0.88, 0.48, 0.06), "snow", hi="snow_hi", lo="snow_shade", bevel=0.03)
    cabin(c, 0.36, 0.86, 0.46, 0.3, 0.22, door=False)
    cabin(c, 0.7, 0.86, 0.34, 0.24, 0.16, window=True, door=True)
    c.fill(c.circle(0.86, 0.22, 0.09), "ui_good", hi="#c4f2cb", lo="#3e8a4a", bevel=0.05)
    c.fill(u(c.capsule(0.86, 0.17, 0.86, 0.27, 0.018), c.capsule(0.81, 0.22, 0.91, 0.22, 0.018)), "#ffffff", flat=True)


@icon("workshop")
def _workshop(c):
    anvil = c.poly([(0.2, 0.42), (0.78, 0.42), (0.9, 0.36), (0.88, 0.5), (0.66, 0.54), (0.62, 0.7), (0.74, 0.82),
                    (0.26, 0.82), (0.38, 0.7), (0.34, 0.54), (0.2, 0.52)])
    c.fill(anvil, "iron", hi="iron_hi", lo="#2e3440", bevel=0.06, spec=0.9)
    handle(c, 0.6, 0.36, 0.84, 0.1, 0.03)
    c.fill(c.box(0.56, 0.3, 0.2, 0.1, 0.02, -0.8), "iron", hi="iron_hi", lo="#2e3440", bevel=0.04)
    for x, y in ((0.3, 0.32), (0.4, 0.26), (0.24, 0.24)):
        c.fill(c.star(x, y, 0.035, 0.4, 4), "fire_hi", hi="fire_core", flat=True)


# ───────────── action buttons ─────────────
@icon("fire")
def _fire(c):
    paint_log(c, 0.14, 0.84, 0.74, 0.7, 0.07, cut=False)
    paint_log(c, 0.86, 0.84, 0.26, 0.7, 0.07, cut=False)
    paint_flame(c, 0.5, 0.48, 1.0)
    for x, y in ((0.24, 0.86), (0.76, 0.86), (0.5, 0.9)):
        c.fill(c.ellipse(x, y, 0.07, 0.04), "stone", hi="stone_hi", lo="stone_dark", bevel=0.03)


@icon("eat")
def _eat(c):
    # a fork and a spoon crossed over a plate
    c.fill(c.ellipse(0.5, 0.56, 0.38, 0.32), "wool", hi="#ffffff", lo="#a89c88", bevel=0.05)
    c.fill(c.ellipse(0.5, 0.56, 0.26, 0.21), "#e8ded0", hi="#ffffff", lo="#b9ac98", bevel=0.03, edge=0.2)
    c.fill(u(c.capsule(0.22, 0.86, 0.66, 0.3, 0.03), c.ellipse(0.72, 0.22, 0.09, 0.13, 0.66)), "iron", hi="iron_hi", lo="#3e4652", bevel=0.04, spec=1.0)
    fork = c.capsule(0.78, 0.86, 0.36, 0.34, 0.03)
    for k in (-1, 0, 1):
        fork = np.minimum(fork, c.capsule(0.36 + k * 0.035, 0.34 - k * 0.025, 0.24 + k * 0.035, 0.18 - k * 0.025, 0.014))
    fork = np.minimum(fork, c.box(0.35, 0.33, 0.13, 0.06, 0.02, -0.92))
    c.fill(fork, "iron", hi="iron_hi", lo="#3e4652", bevel=0.03, spec=1.0)


@icon("build")
def _build(c):
    handle(c, 0.18, 0.86, 0.62, 0.36, 0.05)
    head = smin(c.box(0.62, 0.34, 0.5, 0.17, 0.035, 0.72), c.box(0.64, 0.36, 0.2, 0.22, 0.03, 0.72), 0.03)
    c.fill(head, "iron", hi="iron_hi", lo="#2e3440", bevel=0.06, spec=0.9)
    c.fill(c.box(0.79, 0.49, 0.09, 0.2, 0.02, 0.72), "iron_hi", hi="#ffffff", lo="iron", bevel=0.03, spec=1.0)
    for x, y, r in ((0.3, 0.3, 0.035), (0.84, 0.62, 0.03)):
        c.fill(c.star(x, y, r * 2, 0.35, 4), "fire_hi", hi="fire_core", flat=True)


@icon("bench")
def _bench(c):
    c.fill(c.box(0.5, 0.44, 0.84, 0.12, 0.02), "wood", hi="wood_hi", lo="wood_dark", bevel=0.04)
    for x in (0.18, 0.82):
        c.fill(c.box(x, 0.68, 0.08, 0.4, 0.015), "wood_dark", hi="wood", lo="bark_dark", bevel=0.03)
    c.fill(c.box(0.5, 0.66, 0.66, 0.05, 0.015), "wood_dark", hi="wood", bevel=0.02)
    saw = c.poly([(0.22, 0.36), (0.56, 0.2), (0.6, 0.27), (0.27, 0.4)])
    for i in range(7):
        x = 0.25 + i * 0.05
        saw = np.minimum(saw, c.poly([(x, 0.39 - i * 0.022), (x + 0.025, 0.42 - i * 0.022), (x + 0.05, 0.37 - i * 0.022)]))
    c.fill(saw, "iron", hi="iron_hi", lo="#3e4652", bevel=0.02, spec=0.9)
    c.fill(c.box(0.64, 0.24, 0.12, 0.08, 0.03, -0.4), "wood", hi="wood_hi", lo="wood_dark", bevel=0.03)
    for x, y in ((0.7, 0.36), (0.78, 0.35)):
        c.fill(c.ring(x, y, 0.025, 0.008), "wood_cut", flat=True)


@icon("pause")
def _pause(c):
    for x in (0.36, 0.64):
        c.fill(c.box(x, 0.5, 0.17, 0.6, 0.05), "ui_frost", hi="#ffffff", lo="#7f95c2", bevel=0.06)


@icon("play")
def _play(c):
    tri = c.poly([(0.32, 0.18), (0.82, 0.5), (0.32, 0.82)])
    c.fill(tri - 0.03, "ui_warm", hi="#ffe0a0", lo="#b0661e", bevel=0.08)


@icon("inventory")
def _inventory(c):
    bag = smin(c.box(0.5, 0.6, 0.66, 0.6, 0.12), c.ellipse(0.5, 0.36, 0.3, 0.14), 0.05)
    c.fill(c.ring(0.5, 0.3, 0.14, 0.03, math.pi, 2 * math.pi), "leather", hi="#9a7050", lo="#3a2618", bevel=0.02)
    c.fill(bag, "coat_brown", hi="#b0805a", lo="#3e2a1a", bevel=0.1)
    flap = np.maximum(c.box(0.5, 0.46, 0.58, 0.26, 0.1), c.y - 0.56)
    c.fill(flap, "leather", hi="#9a7050", lo="#3a2618", bevel=0.05)
    c.fill(c.box(0.5, 0.58, 0.12, 0.1, 0.02), "wood_hi", hi="#ffe0a0", lo="wood_dark", bevel=0.03, spec=0.8)
    c.fill(c.box(0.5, 0.78, 0.4, 0.12, 0.04), "#5e3f2d", hi="#8a6248", bevel=0.03)
    c.fill(c.ellipse(0.5, 0.25, 0.22, 0.05), "fur", hi="#f4e6cc", lo="fur_dark", bevel=0.03)


@icon("settings")
def _settings(c):
    c.fill(cog(c, 0.5, 0.5, 0.42, 8), "ui_frost", hi="#ffffff", lo="#6f84ad", bevel=0.07, spec=0.8)


def speaker(c):
    d = u(c.box(0.24, 0.5, 0.16, 0.26, 0.03), c.poly([(0.26, 0.4), (0.5, 0.18), (0.5, 0.82), (0.26, 0.6)]))
    c.fill(d, "ui_frost", hi="#ffffff", lo="#6f84ad", bevel=0.06)


@icon("sound_on")
def _sound_on(c):
    speaker(c)
    for r in (0.16, 0.3):
        c.fill(c.ring(0.5, 0.5, r, 0.035, -0.85, 0.85), "ui_warm", hi="#ffe0a0", lo="#b0661e", bevel=0.03)


@icon("sound_off")
def _sound_off(c):
    speaker(c)
    x = u(c.capsule(0.62, 0.36, 0.88, 0.64, 0.04), c.capsule(0.62, 0.64, 0.88, 0.36, 0.04))
    c.fill(x, "ui_bad", hi="#ffb0a8", lo="#a3222f", bevel=0.04)


@icon("action")
def _action(c):
    # an open hand reaching out: palm, four fingers, thumb
    d = c.box(0.52, 0.64, 0.4, 0.36, 0.12)
    for i, (x, top) in enumerate(((0.36, 0.26), (0.47, 0.16), (0.58, 0.18), (0.68, 0.28))):
        d = smin(d, c.capsule(x, 0.56, x, top, 0.052), 0.03)
    d = smin(d, c.capsule(0.34, 0.68, 0.2, 0.5, 0.055), 0.04)
    c.fill(d, "skin", hi="#ffd8bc", lo="skin_shade", bevel=0.08)
    c.fill(c.box(0.54, 0.9, 0.38, 0.1, 0.03), "coat_red", hi="#d86a5a", lo="#5e1a16", bevel=0.04)
    c.fill(c.ellipse(0.54, 0.84, 0.22, 0.04), "fur", hi="#f4e6cc", lo="fur_dark", bevel=0.03)


@icon("star")
def _star(c):
    d = c.star(0.5, 0.53, 0.44, 0.46)
    c.glow(d, "fire_hi", 0.05, 0.3)
    c.fill(d, "fire_hi", hi="fire_core", lo="#c07a1a", bevel=0.12, spec=0.8)


@icon("star_empty")
def _star_empty(c):
    d = c.star(0.5, 0.53, 0.44, 0.46)
    c.fill(d, "#2a3755", hi="#46577e", lo="#141c30", bevel=0.12, edge=0.2)
    c.fill(np.abs(d) - 0.02, "ui_dim", hi="#dfe8ff", lo="#46577e", bevel=0.02)


# ───────────── creatures and people ─────────────
@icon("wolf")
def _wolf(c):
    head = c.poly([(0.5, 0.92), (0.3, 0.7), (0.18, 0.5), (0.16, 0.1), (0.36, 0.3), (0.5, 0.28),
                   (0.64, 0.3), (0.84, 0.1), (0.82, 0.5), (0.7, 0.7)])
    c.fill(head, "wolf", hi="#c9cfdb", lo="wolf_dark", bevel=0.1)
    for s in (-1, 1):
        c.fill(c.poly([(0.5 + s * 0.27, 0.18), (0.5 + s * 0.3, 0.42), (0.5 + s * 0.18, 0.34)]), "wolf_dark", flat=True, alpha=0.8)
        c.fill(c.poly([(0.5 + s * 0.06, 0.52), (0.5 + s * 0.2, 0.46), (0.5 + s * 0.16, 0.54)]), "wolf_eye", hi="#fff0a0", bevel=0.01)
    c.fill(c.poly([(0.38, 0.64), (0.62, 0.64), (0.5, 0.92)]), "#dfe3ec", hi="#ffffff", lo="wolf", bevel=0.04, edge=0.2)
    c.fill(c.ellipse(0.5, 0.86, 0.06, 0.04), "#1a1d26", flat=True)


@icon("bear")
def _bear(c):
    for s in (-1, 1):
        c.fill(c.circle(0.5 + s * 0.27, 0.24, 0.12), "bear", hi="#8a6450", lo="bear_dark", bevel=0.06)
        c.fill(c.circle(0.5 + s * 0.27, 0.25, 0.055), "bear_dark", flat=True)
    c.fill(c.ellipse(0.5, 0.56, 0.38, 0.34), "bear", hi="#8a6450", lo="bear_dark", bevel=0.12)
    c.fill(c.ellipse(0.5, 0.68, 0.18, 0.14), "#a8846a", hi="#d0b090", lo="#5a4032", bevel=0.06)
    c.fill(c.ellipse(0.5, 0.62, 0.07, 0.045), "#1a1410", hi="#4a3a30", bevel=0.03)
    for s in (-1, 1):
        c.fill(c.circle(0.5 + s * 0.15, 0.48, 0.035), "#1a1410", flat=True)
        c.fill(c.circle(0.5 + s * 0.15 - 0.01, 0.47, 0.01), "#ffffff", flat=True)


@icon("trader")
def _trader(c):
    sack = smin(c.ellipse(0.46, 0.62, 0.32, 0.3), c.poly([(0.34, 0.36), (0.58, 0.36), (0.5, 0.16), (0.4, 0.16)]), 0.05)
    c.fill(sack, "#c9a46a", hi="#f0d49a", lo="#7a5a30", bevel=0.1)
    c.fill(c.capsule(0.36, 0.34, 0.56, 0.34, 0.025), "coat_red", hi="#d86a5a", bevel=0.02)
    for x, y in ((0.7, 0.78), (0.82, 0.7), (0.76, 0.6)):
        c.fill(c.circle(x, y, 0.08), "fire_hi", hi="fire_core", lo="#c07a1a", bevel=0.05, spec=0.9)
        c.fill(c.ring(x, y, 0.045, 0.008), "#c07a1a", flat=True, alpha=0.7)


@icon("survivor")
def _survivor(c):
    body = np.maximum(c.ellipse(0.5, 0.96, 0.34, 0.38), c.y - 0.92)
    c.fill(body, "coat_blue", hi="#6f92c2", lo="#1f3354", bevel=0.1)
    c.fill(c.ellipse(0.5, 0.6, 0.2, 0.06), "fur", hi="#f4e6cc", lo="fur_dark", bevel=0.03)
    c.fill(c.circle(0.5, 0.38, 0.17), "skin", hi="#ffd8bc", lo="skin_shade", bevel=0.08)
    hat = np.maximum(c.circle(0.5, 0.34, 0.19), c.y - 0.32)
    c.fill(hat, "coat_red", hi="#d86a5a", lo="#5e1a16", bevel=0.06)
    c.fill(c.circle(0.5, 0.13, 0.06), "wool", hi="#ffffff", lo="#b9ac98", bevel=0.04)
    c.fill(c.box(0.5, 0.32, 0.4, 0.06, 0.03), "wool", hi="#ffffff", lo="#b9ac98", bevel=0.03)


# ───────────── states and navigation ─────────────
@icon("warning")
def _warning(c):
    tri = c.poly([(0.5, 0.1), (0.92, 0.86), (0.08, 0.86)]) - 0.04
    c.glow(tri, "ui_warn", 0.05, 0.25)
    c.fill(tri, "ui_warn", hi="#ffe9a0", lo="#b0861e", bevel=0.08)
    c.fill(c.capsule(0.5, 0.36, 0.5, 0.6, 0.045, 0.03), "#3a2a10", flat=True)
    c.fill(c.circle(0.5, 0.73, 0.045), "#3a2a10", flat=True)


@icon("close")
def _close(c):
    x = u(c.capsule(0.24, 0.24, 0.76, 0.76, 0.07), c.capsule(0.24, 0.76, 0.76, 0.24, 0.07))
    c.fill(x, "ui_frost", hi="#ffffff", lo="#6f84ad", bevel=0.06)


@icon("back")
def _back(c):
    d = u(c.capsule(0.3, 0.5, 0.8, 0.5, 0.07), c.capsule(0.26, 0.5, 0.52, 0.24, 0.07), c.capsule(0.26, 0.5, 0.52, 0.76, 0.07))
    c.fill(d, "ui_frost", hi="#ffffff", lo="#6f84ad", bevel=0.06)


@icon("home")
def _home(c):
    roof = c.poly([(0.08, 0.5), (0.5, 0.12), (0.92, 0.5), (0.82, 0.58), (0.5, 0.3), (0.18, 0.58)])
    house = np.maximum(c.box(0.5, 0.66, 0.56, 0.42, 0.04), -c.box(0.5, 0.74, 0.16, 0.28, 0.03))
    c.fill(house, "ui_frost", hi="#ffffff", lo="#6f84ad", bevel=0.06)
    c.fill(roof, "ui_warm", hi="#ffe0a0", lo="#b0661e", bevel=0.05)


# keep heart importable for other modules that might draw hearts in panels
__all__ = ["heart"]
