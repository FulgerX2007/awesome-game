"""The 128 px icons of Долгая зима on Godot: stats, items, tools, gear, buildings, actions and states.

Each icon is a function painting on a supersampled sdf.Canvas in unit coordinates; ICONS maps the manifest id
(`ui.icon.<id>`) to it. Strong silhouettes first (they are read at 24 px), a soft two-tone volume, a light rim.
"""
import math

import numpy as np

from sdf import Canvas, smin

ICONS = {}


def icon(name):
    def reg(f):
        ICONS[name] = f
        return f
    return reg


def u(*fields):
    return np.minimum.reduce(fields)


# ───────────── small builders ─────────────
def heart(c, cx, cy, s):
    lobes = smin(c.circle(cx - 0.17 * s, cy - 0.08 * s, 0.2 * s), c.circle(cx + 0.17 * s, cy - 0.08 * s, 0.2 * s), 0.04 * s)
    return smin(lobes, c.poly([(cx - 0.355 * s, cy - 0.01 * s), (cx + 0.355 * s, cy - 0.01 * s), (cx, cy + 0.36 * s)]), 0.06 * s)


def flame_field(c, cx, cy, s):
    # a teardrop leaning up: a round belly and a pointed tip, a little flick to the side
    body = c.circle(cx, cy + 0.1 * s, 0.24 * s)
    tip = c.poly([(cx - 0.235 * s, cy + 0.06 * s), (cx + 0.05 * s, cy - 0.42 * s), (cx + 0.235 * s, cy + 0.04 * s)])
    flick = c.poly([(cx + 0.1 * s, cy - 0.08 * s), (cx + 0.28 * s, cy - 0.3 * s), (cx + 0.23 * s, cy + 0.02 * s)])
    return np.minimum(np.minimum(body, tip), flick)


def paint_flame(c, cx, cy, s):
    c.glow(flame_field(c, cx, cy, s), "glow_warm", 0.07 * s, 0.35)
    c.fill(flame_field(c, cx, cy, s), "fire", hi="fire_hi", lo="fire_deep", bevel=0.08 * s, spec=0.2)
    c.fill(flame_field(c, cx, cy + 0.12 * s, s * 0.55), "fire_hi", hi="fire_core", lo="fire", bevel=0.05 * s, edge=0.1, spec=0)
    c.fill(flame_field(c, cx, cy + 0.2 * s, s * 0.28), "fire_core", edge=0, spec=0, flat=True)


def log_field(c, ax, ay, bx, by, r):
    return c.capsule(ax, ay, bx, by, r)


def paint_log(c, ax, ay, bx, by, r, cut=True):
    c.fill(c.capsule(ax, ay, bx, by, r), "bark", hi="bark_hi", lo="bark_dark", bevel=r * 0.9)
    # grain lines along the log
    dx, dy = bx - ax, by - ay
    ln = math.hypot(dx, dy)
    nx, ny = -dy / ln, dx / ln
    for k in (-0.35, 0.3):
        c.fill(c.capsule(ax + nx * r * k + dx * 0.15, ay + ny * r * k + dy * 0.15, ax + nx * r * k + dx * 0.7, ay + ny * r * k + dy * 0.7, r * 0.07),
               "bark_dark", flat=True, alpha=0.5)
    if cut:
        c.fill(c.ellipse(bx, by, r * 0.92, r * 0.92), "wood_cut", hi="#f6dcae", lo="wood", bevel=r * 0.4, edge=0.6)
        c.fill(c.ring(bx, by, r * 0.5, r * 0.06), "wood", flat=True, alpha=0.7)
        c.fill(c.circle(bx, by, r * 0.12), "wood_dark", flat=True, alpha=0.7)


def handle(c, ax, ay, bx, by, r=0.045):
    c.fill(c.capsule(ax, ay, bx, by, r), "wood", hi="wood_hi", lo="wood_dark", bevel=r)


def fish_field(c, cx, cy, s, rot=0.0):
    body = c.ellipse(cx, cy, 0.3 * s, 0.15 * s, rot)
    ca, sa = math.cos(rot), math.sin(rot)

    def P(x, y):
        return (cx + x * s * ca - y * s * sa, cy + x * s * sa + y * s * ca)
    tail = c.poly([P(0.22, 0), P(0.44, -0.17), P(0.4, 0), P(0.44, 0.17)])
    fin = c.poly([P(-0.05, -0.12), P(0.08, -0.24), P(0.13, -0.1)])
    return u(body, tail, fin), P


def cog(c, cx, cy, r, teeth=8):
    d = c.circle(cx, cy, r * 0.78)
    for i in range(teeth):
        a = i * 2 * math.pi / teeth
        d = np.minimum(d, c.box(cx + math.cos(a) * r * 0.82, cy + math.sin(a) * r * 0.82, r * 0.42, r * 0.36, r * 0.08, a))
    return np.maximum(d, -c.circle(cx, cy, r * 0.32))


def snowflake_field(c, cx, cy, r, w=0.035):
    d = np.full(c.x.shape, 1e3)
    for i in range(6):
        a = i * math.pi / 3 - math.pi / 2
        ex, ey = cx + math.cos(a) * r, cy + math.sin(a) * r
        d = np.minimum(d, c.capsule(cx, cy, ex, ey, w))
        for t, l in ((0.55, 0.32), (0.8, 0.2)):
            px, py = cx + math.cos(a) * r * t, cy + math.sin(a) * r * t
            for sgn in (-1, 1):
                b = a + sgn * 0.75
                d = np.minimum(d, c.capsule(px, py, px + math.cos(b) * r * l, py + math.sin(b) * r * l, w * 0.8))
    return np.minimum(d, c.circle(cx, cy, w * 2.2))


def snow_cap(c, d_top, color="snow_hi"):
    c.fill(d_top, "snow", hi=color, lo="snow_shade", bevel=0.03, spec=0.6)


# ───────────── stats ─────────────
@icon("health")
def _health(c):
    d = heart(c, 0.5, 0.52, 1.15)
    c.fill(d, "stat_health", hi="#ff9aa2", lo="#a3222f", bevel=0.1)
    c.fill(c.ellipse(0.36, 0.38, 0.08, 0.05, -0.6), "#ffd6da", flat=True, alpha=0.75)


@icon("warmth")
def _warmth(c):
    paint_flame(c, 0.5, 0.56, 1.25)


@icon("food")
def _food(c):
    # a steaming bowl of stew with a wooden spoon
    for x in (0.4, 0.56):
        steam = u(c.ring(x + 0.05, 0.3, 0.06, 0.018, math.pi / 2, 3 * math.pi / 2), c.ring(x + 0.05, 0.18, 0.06, 0.018, -math.pi / 2, math.pi / 2))
        c.fill(steam, "snow_hi", flat=True, alpha=0.6)
    handle(c, 0.66, 0.18, 0.56, 0.5, 0.03)
    bowl = np.maximum(c.ellipse(0.5, 0.52, 0.36, 0.3), 0.5 - c.y)
    c.fill(bowl, "wood", hi="wood_hi", lo="wood_dark", bevel=0.08)
    c.fill(c.ellipse(0.5, 0.52, 0.36, 0.09), "stat_food", hi="#ffe29a", lo="#b07a20", bevel=0.05)
    for x, y in ((0.4, 0.51), (0.55, 0.54), (0.63, 0.5)):
        c.fill(c.circle(x, y, 0.04), "#d9693a", hi="#ff9a6a", bevel=0.03)
    c.fill(c.box(0.5, 0.86, 0.3, 0.06, 0.03), "wood_dark", hi="wood", bevel=0.03)


@icon("stamina")
def _stamina(c):
    d = c.poly([(0.6, 0.06), (0.24, 0.56), (0.47, 0.56), (0.38, 0.94), (0.78, 0.42), (0.54, 0.42)])
    c.glow(d, "stat_energy", 0.06, 0.3)
    c.fill(d, "stat_energy", hi="#d6f4ff", lo="#2a7fb8", bevel=0.07)


@icon("day")
def _day(c):
    rays = np.full(c.x.shape, 1e3)
    for i in range(8):
        a = i * math.pi / 4
        rays = np.minimum(rays, c.capsule(0.5 + math.cos(a) * 0.3, 0.5 + math.sin(a) * 0.3, 0.5 + math.cos(a) * 0.42, 0.5 + math.sin(a) * 0.42, 0.035))
    c.glow(c.circle(0.5, 0.5, 0.22), "fire_hi", 0.08, 0.4)
    c.fill(rays, "fire_hi", hi="fire_core", lo="fire", bevel=0.03)
    c.fill(c.circle(0.5, 0.5, 0.22), "fire_hi", hi="fire_core", lo="fire", bevel=0.12)


@icon("night")
def _night(c):
    moon = np.maximum(c.circle(0.46, 0.52, 0.32), -c.circle(0.62, 0.42, 0.27))
    c.glow(moon, "ui_frost", 0.07, 0.3)
    c.fill(moon, "#dfe8ff", hi="#ffffff", lo="#7f95c2", bevel=0.09)
    c.fill(c.star(0.76, 0.24, 0.1, 0.42, 4), "ui_frost", hi="#ffffff", bevel=0.03)
    c.fill(c.star(0.8, 0.62, 0.06, 0.42, 4), "ui_frost", hi="#ffffff", bevel=0.02)


@icon("clock")
def _clock(c):
    c.fill(c.circle(0.5, 0.53, 0.38), "ui_frost", hi="#ffffff", lo="#7f95c2", bevel=0.06)
    c.fill(c.circle(0.5, 0.53, 0.3), "#24314f", hi="#3a4a70", lo="#141c30", bevel=0.04, edge=0.2)
    c.fill(c.box(0.5, 0.12, 0.14, 0.08, 0.03), "ui_frost", hi="#ffffff", bevel=0.03)
    for i in range(12):
        a = i * math.pi / 6
        c.fill(c.circle(0.5 + math.cos(a) * 0.24, 0.53 + math.sin(a) * 0.24, 0.016 if i % 3 else 0.026), "ui_frost", flat=True)
    c.fill(c.capsule(0.5, 0.53, 0.5, 0.33, 0.025), "ui_frost", flat=True)
    c.fill(c.capsule(0.5, 0.53, 0.65, 0.6, 0.03), "ui_warm", flat=True)
    c.fill(c.circle(0.5, 0.53, 0.04), "ui_warm", hi="#ffe0a0", bevel=0.03)


@icon("thermometer")
def _thermo(c):
    tube = u(c.capsule(0.5, 0.16, 0.5, 0.62, 0.1), c.circle(0.5, 0.74, 0.17))
    c.fill(tube, "#dfe8ff", hi="#ffffff", lo="#8fa6cf", bevel=0.06)
    c.fill(u(c.capsule(0.5, 0.36, 0.5, 0.66, 0.045), c.circle(0.5, 0.74, 0.11)), "stat_health", hi="#ff9aa2", lo="#a3222f", bevel=0.06)
    for y in (0.24, 0.34, 0.44, 0.54):
        c.fill(c.capsule(0.62, y, 0.7, y, 0.014), "ui_frost", flat=True)


@icon("snow")
def _snow(c):
    d = snowflake_field(c, 0.5, 0.5, 0.4)
    c.glow(d, "ui_frost", 0.05, 0.3)
    c.fill(d, "ice_hi", hi="#ffffff", lo="ice_mid", bevel=0.03)


@icon("blizzard")
def _blizzard(c):
    d = snowflake_field(c, 0.36, 0.38, 0.27, 0.03)
    c.fill(d, "ice_hi", hi="#ffffff", lo="ice_mid", bevel=0.025)
    for y, x0, x1, curl in ((0.66, 0.12, 0.82, 0.09), (0.82, 0.24, 0.9, 0.07), (0.5, 0.6, 0.92, 0.06)):
        wind = u(c.capsule(x0, y, x1, y, 0.028), c.ring(x1, y - curl, curl, 0.028, -math.pi / 2, math.pi / 2))
        c.fill(wind, "ui_frost", hi="#ffffff", lo="#7f95c2", bevel=0.025)
