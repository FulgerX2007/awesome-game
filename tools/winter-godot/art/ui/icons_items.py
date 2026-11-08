"""Icons of the things in the camp: materials, food, tools and the workshop's gear."""
import math

import numpy as np

from icons import fish_field, handle, icon, paint_flame, paint_log, u
from sdf import smin


# ───────────── materials ─────────────
@icon("wood")
def _wood(c):
    paint_log(c, 0.16, 0.74, 0.76, 0.44, 0.13)
    paint_log(c, 0.22, 0.42, 0.8, 0.7, 0.12)


@icon("stone")
def _stone(c):
    rock = c.poly([(0.16, 0.7), (0.24, 0.38), (0.44, 0.22), (0.7, 0.26), (0.86, 0.5), (0.8, 0.76), (0.46, 0.84)])
    c.fill(rock, "stone", hi="stone_hi", lo="stone_dark", bevel=0.14)
    # a lit facet and a crack
    c.fill(c.poly([(0.26, 0.4), (0.45, 0.25), (0.6, 0.3), (0.42, 0.48)]), "stone_hi", hi="#dfe3ec", lo="stone", bevel=0.05, edge=0.1, alpha=0.8)
    c.fill(c.capsule(0.52, 0.56, 0.66, 0.68, 0.012), "stone_dark", flat=True, alpha=0.7)
    small = c.poly([(0.66, 0.84), (0.72, 0.72), (0.86, 0.74), (0.9, 0.86)])
    c.fill(small, "stone_mid", hi="stone_hi", lo="stone_dark", bevel=0.05)


@icon("metal")
def _metal(c):
    for dy, k in ((0.14, 0.0), (-0.06, 0.06)):
        top = c.poly([(0.22 + k, 0.5 + dy), (0.34 + k, 0.36 + dy), (0.74 + k, 0.36 + dy), (0.86 + k, 0.5 + dy)])
        body = c.poly([(0.18 + k, 0.66 + dy), (0.22 + k, 0.5 + dy), (0.86 + k, 0.5 + dy), (0.9 + k, 0.66 + dy)])
        c.fill(body, "iron", hi="iron_hi", lo="#3e4652", bevel=0.05)
        c.fill(top, "iron_hi", hi="#ffffff", lo="iron", bevel=0.06, spec=0.9)


@icon("hide")
def _hide(c):
    pelt = c.poly([(0.5, 0.1), (0.64, 0.2), (0.86, 0.14), (0.78, 0.36), (0.8, 0.62), (0.9, 0.86), (0.66, 0.78),
                   (0.5, 0.9), (0.34, 0.78), (0.1, 0.86), (0.2, 0.62), (0.22, 0.36), (0.14, 0.14), (0.36, 0.2)])
    c.fill(pelt, "fur", hi="#ecdcc0", lo="fur_dark", bevel=0.08)
    c.fill(c.ellipse(0.5, 0.5, 0.17, 0.26), "#d9c5a3", hi="#f4e6cc", lo="fur", bevel=0.06, edge=0.2)
    for x, y, a in ((0.32, 0.36, 0.4), (0.68, 0.42, -0.4), (0.38, 0.66, -0.3), (0.62, 0.68, 0.3)):
        c.fill(c.ellipse(x, y, 0.05, 0.012, a), "fur_dark", flat=True, alpha=0.6)


@icon("berries")
def _berries(c):
    c.fill(c.ellipse(0.66, 0.24, 0.17, 0.08, -0.5), "pine", hi="pine_hi", lo="pine_dark", bevel=0.05)
    c.fill(c.capsule(0.52, 0.34, 0.66, 0.24, 0.012), "pine_dark", flat=True)
    for x, y, r in ((0.36, 0.52, 0.16), (0.62, 0.58, 0.15), (0.46, 0.76, 0.14), (0.7, 0.36, 0.0)):
        if r:
            c.fill(c.circle(x, y, r), "berry", hi="berry_hi", lo="#7a1626", bevel=0.12, spec=0.9)


def bone(c, ax, ay, bx, by, r):
    d = c.capsule(ax, ay, bx, by, r)
    dx, dy = bx - ax, by - ay
    ln = math.hypot(dx, dy)
    nx, ny = -dy / ln * r, dx / ln * r
    for px, py in ((bx, by),):
        d = np.minimum(d, c.circle(px + nx * 0.9, py + ny * 0.9, r * 1.05))
        d = np.minimum(d, c.circle(px - nx * 0.9, py - ny * 0.9, r * 1.05))
    c.fill(d, "wool", hi="#ffffff", lo="#b9ac98", bevel=r)


@icon("meat")
def _meat(c):
    bone(c, 0.56, 0.5, 0.86, 0.22, 0.045)
    steak = c.ellipse(0.42, 0.58, 0.31, 0.25, -0.4)
    c.fill(steak, "#c8414a", hi="#ff7f86", lo="#7a1d26", bevel=0.1)
    c.fill(c.ring(0.42, 0.58, 0.2, 0.025, 2.2, 4.6), "#ffe0dc", hi="#ffffff", bevel=0.02, edge=0.1)
    c.fill(c.circle(0.56, 0.5, 0.06), "wool", hi="#ffffff", lo="#b9ac98", bevel=0.04)


@icon("fish")
def _fish(c):
    d, P = fish_field(c, 0.46, 0.52, 1.25, -0.25)
    c.fill(d, "#8fb0cf", hi="#e4f1ff", lo="#3c5f8f", bevel=0.1, spec=0.9)
    c.fill(c.ellipse(*P(-0.02, 0.07), 0.2, 0.04, -0.25), "#e8f2ff", flat=True, alpha=0.5)
    c.fill(c.circle(*P(-0.2, -0.03), 0.028), "#1a2338", flat=True)
    c.fill(c.ring(*P(-0.11, 0), 0.07, 0.01, -0.9, 0.9), "#3c5f8f", flat=True, alpha=0.8)


@icon("cookedMeat")
def _cooked_meat(c):
    bone(c, 0.52, 0.5, 0.84, 0.18, 0.045)
    leg = smin(c.ellipse(0.38, 0.62, 0.26, 0.22, -0.7), c.capsule(0.38, 0.62, 0.56, 0.46, 0.08), 0.05)
    c.fill(leg, "#a8572a", hi="#e89a52", lo="#5e2a14", bevel=0.12, spec=0.8)
    for k in (-1, 0, 1):
        c.fill(c.capsule(0.28 + k * 0.06, 0.52 + k * 0.08, 0.4 + k * 0.06, 0.68 + k * 0.08, 0.012), "#5e2a14", flat=True, alpha=0.55)


@icon("cookedFish")
def _cooked_fish(c):
    d, P = fish_field(c, 0.46, 0.52, 1.25, -0.25)
    c.fill(d, "#c98a4a", hi="#f7c27e", lo="#6b3a1a", bevel=0.1, spec=0.7)
    for k in (-0.12, 0.0, 0.12):
        c.fill(c.capsule(*P(k - 0.04, -0.1), *P(k + 0.04, 0.1), 0.014), "#5a2c12", flat=True, alpha=0.75)
    c.fill(c.circle(*P(-0.2, -0.03), 0.026), "#2a1a10", flat=True)


def smoke_wisp(c, x, y):
    w = u(c.ring(x, y - 0.06, 0.05, 0.016, math.pi / 2, 3 * math.pi / 2), c.ring(x, y - 0.16, 0.05, 0.016, -math.pi / 2, math.pi / 2))
    c.fill(w, "smoke", hi="#c9cfdb", flat=True, alpha=0.8)


@icon("smokedMeat")
def _smoked_meat(c):
    for k, (x, y, a) in enumerate(((0.34, 0.6, 0.5), (0.52, 0.58, 0.3), (0.68, 0.62, 0.1))):
        strip = c.box(x, y, 0.15, 0.48, 0.06, a)
        c.fill(strip, "#6b2a1e", hi="#a8523a", lo="#33120c", bevel=0.06, spec=0.6)
        c.fill(c.capsule(x - 0.03, y - 0.15, x + 0.02, y + 0.14, 0.01), "#d8a090", flat=True, alpha=0.4)
    c.fill(c.capsule(0.18, 0.32, 0.84, 0.32, 0.022), "wood", hi="wood_hi", lo="wood_dark", bevel=0.02)
    smoke_wisp(c, 0.8, 0.26)


@icon("smokedFish")
def _smoked_fish(c):
    d, P = fish_field(c, 0.46, 0.6, 1.2, -0.12)
    c.fill(d, "#7a4a2a", hi="#c08a52", lo="#3a1e10", bevel=0.1, spec=0.7)
    for k in (-0.12, 0.0, 0.12):
        c.fill(c.capsule(*P(k, -0.11), *P(k, 0.11), 0.016), "#e0b070", flat=True, alpha=0.5)
    c.fill(c.circle(*P(-0.2, -0.03), 0.026), "#1a0e08", flat=True)
    smoke_wisp(c, 0.36, 0.38)
    smoke_wisp(c, 0.58, 0.34)


# ───────────── tools ─────────────
def stone_head(c, pts, light=False):
    d = c.poly(pts)
    if light:
        c.fill(d, "iron", hi="#eef4fa", lo="#3e4652", bevel=0.05, spec=1.0)
    else:
        c.fill(d, "stone", hi="stone_hi", lo="stone_dark", bevel=0.06)
    return d


@icon("axe")
def _axe(c):
    handle(c, 0.24, 0.88, 0.64, 0.16, 0.045)
    stone_head(c, [(0.5, 0.2), (0.78, 0.14), (0.88, 0.36), (0.74, 0.44), (0.56, 0.38)])
    c.fill(c.capsule(0.55, 0.26, 0.64, 0.36, 0.03), "leather", hi="#9a7050", lo="#3a2618", bevel=0.02)


@icon("ironAxe")
def _iron_axe(c):
    handle(c, 0.22, 0.9, 0.62, 0.14, 0.05)
    blade = c.poly([(0.5, 0.18), (0.66, 0.14), (0.84, 0.04), (0.94, 0.3), (0.86, 0.52), (0.66, 0.38), (0.52, 0.34)])
    c.fill(blade, "iron", hi="#f2f7fc", lo="#3e4652", bevel=0.06, spec=1.0)
    c.fill(c.capsule(0.88, 0.1, 0.92, 0.44, 0.012), "#ffffff", flat=True, alpha=0.7)


@icon("pick")
def _pick(c):
    handle(c, 0.5, 0.92, 0.5, 0.26, 0.045)
    head = c.ring(0.5, 0.58, 0.44, 0.065, -2.55, -0.59)
    c.fill(head, "iron", hi="#eef4fa", lo="#3e4652", bevel=0.05, spec=0.9)
    c.fill(c.box(0.5, 0.18, 0.13, 0.13, 0.03), "leather", hi="#9a7050", lo="#3a2618", bevel=0.03)


@icon("shovel")
def _shovel(c):
    handle(c, 0.3, 0.14, 0.56, 0.6, 0.04)
    c.fill(c.capsule(0.22, 0.14, 0.36, 0.06, 0.035), "wood", hi="wood_hi", lo="wood_dark", bevel=0.03)
    blade = c.poly([(0.5, 0.56), (0.66, 0.46), (0.88, 0.76), (0.84, 0.9), (0.68, 0.94)])
    c.fill(smin(blade, c.circle(0.78, 0.84, 0.1), 0.05), "iron", hi="#eef4fa", lo="#3e4652", bevel=0.06, spec=0.9)
    c.fill(c.ellipse(0.8, 0.86, 0.07, 0.04, 0.9), "snow_hi", hi="#ffffff", lo="snow_shade", bevel=0.03)


@icon("icePick")
def _ice_pick(c):
    for x, y, r in ((0.24, 0.8, 0.12), (0.4, 0.86, 0.09)):
        shard = c.poly([(x - r, y + r * 0.6), (x - r * 0.2, y - r * 1.6), (x + r * 0.5, y - r * 0.4), (x + r, y + r * 0.6)])
        c.fill(shard, "ice", hi="ice_hi", lo="ice_deep", bevel=0.04, spec=1.0)
    handle(c, 0.32, 0.12, 0.7, 0.86, 0.045)
    head = c.poly([(0.22, 0.2), (0.4, 0.06), (0.56, 0.1), (0.42, 0.22), (0.3, 0.42)])
    c.fill(head, "iron", hi="#eef4fa", lo="#3e4652", bevel=0.05, spec=1.0)
    c.fill(c.capsule(0.62, 0.7, 0.72, 0.9, 0.05), "leather", hi="#9a7050", lo="#3a2618", bevel=0.04)


@icon("spear")
def _spear(c):
    handle(c, 0.16, 0.9, 0.66, 0.3, 0.035)
    blade = c.poly([(0.6, 0.38), (0.66, 0.22), (0.9, 0.08), (0.78, 0.32), (0.66, 0.42)])
    c.fill(blade, "stone", hi="stone_hi", lo="stone_dark", bevel=0.05, spec=0.6)
    c.fill(c.capsule(0.58, 0.36, 0.66, 0.44, 0.03), "leather", hi="#9a7050", lo="#3a2618", bevel=0.02)
    c.fill(c.capsule(0.62, 0.42, 0.56, 0.62, 0.012), "#c94a3a", flat=True)


# ───────────── gear ─────────────
@icon("coat")
def _coat(c):
    body = c.poly([(0.32, 0.22), (0.68, 0.22), (0.86, 0.36), (0.9, 0.7), (0.78, 0.72), (0.76, 0.5),
                   (0.74, 0.92), (0.26, 0.92), (0.24, 0.5), (0.22, 0.72), (0.1, 0.7), (0.14, 0.36)])
    c.fill(body, "coat_brown", hi="#b0805a", lo="#3e2a1a", bevel=0.08)
    c.fill(c.capsule(0.5, 0.3, 0.5, 0.9, 0.012), "#3e2a1a", flat=True, alpha=0.7)
    for y in (0.46, 0.6, 0.74):
        c.fill(c.circle(0.54, y, 0.022), "wood_hi", hi="#ffe0a0", bevel=0.015)
    collar = smin(c.ellipse(0.38, 0.24, 0.16, 0.09, 0.3), c.ellipse(0.62, 0.24, 0.16, 0.09, -0.3), 0.04)
    c.fill(collar, "fur", hi="#f4e6cc", lo="fur_dark", bevel=0.06)
    c.fill(c.box(0.5, 0.91, 0.48, 0.06, 0.03), "fur", hi="#f4e6cc", lo="fur_dark", bevel=0.03)
    for x in (0.16, 0.84):
        c.fill(c.ellipse(x, 0.72, 0.07, 0.04), "fur", hi="#f4e6cc", lo="fur_dark", bevel=0.03)


@icon("lantern")
def _lantern(c):
    c.glow(c.circle(0.5, 0.58, 0.16), "glow_warm", 0.12, 0.55)
    c.fill(c.ring(0.5, 0.16, 0.08, 0.018, math.pi, 2 * math.pi), "iron", hi="iron_hi", lo="#3e4652", bevel=0.015)
    c.fill(c.poly([(0.32, 0.3), (0.68, 0.3), (0.6, 0.2), (0.4, 0.2)]), "iron", hi="iron_hi", lo="#3e4652", bevel=0.04)
    glass = c.box(0.5, 0.56, 0.32, 0.4, 0.04)
    c.fill(glass, "fire_hi", hi="fire_core", lo="fire", bevel=0.08, spec=0.3, edge=0.1)
    paint_flame(c, 0.5, 0.58, 0.42)
    for x in (0.34, 0.66):
        c.fill(c.capsule(x, 0.34, x, 0.78, 0.022), "iron", hi="iron_hi", lo="#3e4652", bevel=0.02)
    c.fill(c.box(0.5, 0.8, 0.4, 0.07, 0.02), "iron", hi="iron_hi", lo="#3e4652", bevel=0.03)


@icon("sled")
def _sled(c):
    runner = np.minimum(c.capsule(0.12, 0.8, 0.82, 0.8, 0.025), c.ring(0.84, 0.7, 0.1, 0.025, -math.pi / 2, math.pi / 2))
    c.fill(runner, "iron", hi="iron_hi", lo="#3e4652", bevel=0.02)
    for x in (0.26, 0.5, 0.72):
        c.fill(c.capsule(x, 0.62, x, 0.8, 0.022), "wood_dark", hi="wood", bevel=0.02)
    c.fill(c.box(0.48, 0.6, 0.72, 0.09, 0.03), "wood", hi="wood_hi", lo="wood_dark", bevel=0.04)
    pack = smin(c.ellipse(0.38, 0.44, 0.18, 0.13), c.ellipse(0.6, 0.46, 0.14, 0.12), 0.05)
    c.fill(pack, "fur", hi="#f4e6cc", lo="fur_dark", bevel=0.07)
    c.fill(c.capsule(0.3, 0.36, 0.62, 0.56, 0.016), "leather", flat=True)
    c.fill(c.ellipse(0.44, 0.34, 0.18, 0.05), "snow_hi", hi="#ffffff", lo="snow_shade", bevel=0.03)


@icon("snares")
def _snares(c):
    c.fill(c.capsule(0.3, 0.9, 0.36, 0.16, 0.035), "wood", hi="wood_hi", lo="wood_dark", bevel=0.03)
    c.fill(c.capsule(0.33, 0.24, 0.52, 0.34, 0.016), "#c9b48a", flat=True)
    loop = c.ring(0.62, 0.56, 0.2, 0.024)
    c.fill(loop, "#d8c49a", hi="#fff0cc", lo="#7a6440", bevel=0.02)
    c.fill(c.capsule(0.52, 0.34, 0.56, 0.38, 0.03), "#c9b48a", hi="#fff0cc", bevel=0.02)
    c.fill(c.ellipse(0.62, 0.9, 0.3, 0.05), "snow", hi="snow_hi", lo="snow_shade", bevel=0.03)
