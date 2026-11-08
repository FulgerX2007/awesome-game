"""Долгая зима on Godot — the camp's buildings with their states (the hut's stages, the palisade, the upgrades …).

    python3 tools/winter-godot/art/buildings.py      → godot/winter/assets/buildings/**, manifest/buildings.json

Overlays (`hut.roofhole`, `hut.scaffold`) are painted on the hut's own canvas, so their foot lines up with the hut's.
Some entries carry an `anchor` (texture px): where the game attaches a flame, smoke or light.
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from paint import (Canvas, Manifest, blur, colour_field, emit_sprite, mix, rgb, rng, sd_box, sd_ellipse,  # noqa: E402
                   sd_poly, sd_segment, smin, smoothstep)
import shapes  # noqa: E402

T = 96


def wood(cv, seed, a="wood_hi", b="wood_dark", grain_axis=0, k=0.5, base=0.25):
    """Planks/logs albedo with grain along an axis (0 = horizontal grain)."""
    g = cv.X if grain_axis else cv.Y
    streak = 0.5 + 0.5 * np.sin(g * 1.7 + cv.noise(6, seed, 2) * 9)
    return colour_field(cv, a, b, np.clip(base + streak * 0.25 * k + cv.noise(3, seed + 1, 2) * 0.35, 0, 1))


def log_row(cv, x0, x1, y, r, seed, elev, ends=True, char=0.0, snow=0.0):
    """One horizontal log of a wall from x0 to x1, centre line y."""
    d = sd_segment(cv.X, cv.Y, x0, y, x1, y, r) + (cv.noise(4, seed, 2) - 0.5) * 1.0
    alb = colour_field(cv, "#9a6a46", "#4a2f22", np.clip(0.3 + cv.noise(5, seed + 3, 2) * 0.4 + char, 0, 1))
    if char > 0:
        alb = alb * (1 - char * 0.6)
    cv.part(d, alb, round_=r, elev=elev, cast=0.35, cast_r=2, cast_off=(0, 2), snow=snow, snow_seed=seed,
            snow_thick=2)
    if ends:
        for ex in (x0, x1):
            de = sd_ellipse(cv.X, cv.Y, ex, y, r * 0.8, r * 0.95)
            rr = np.sqrt(((cv.X - ex) / (r * 0.8)) ** 2 + ((cv.Y - y) / (r * 0.95)) ** 2)
            ring = colour_field(cv, "wood_cut", "wood", 0.25 + 0.5 * (0.5 + 0.5 * np.sin(rr * 14)) * 0.5 + rr * 0.3)
            if char > 0:
                ring = ring * (1 - char * 0.6)
            cv.part(de, ring, round_=1.2, elev=elev, cast=0.2)


def log_wall(cv, x0, x1, ybot, height, seed, elev_base=0.0, r=6.5, char=0.0, missing=(), snow_top=0.0):
    n = int(height // (r * 1.8))
    for k in range(n):
        if k in missing:
            continue
        y = ybot - r - k * r * 1.8
        elev = np.full_like(cv.X, elev_base + (ybot - y))
        log_row(cv, x0, x1, y, r, seed + k * 7, elev, char=char, snow=snow_top if k == n - 1 else 0.0)


def stones_row(cv, x0, x1, y, seed, size=11, snow=0.6):
    r = rng(seed)
    x = x0
    while x < x1:
        s = size * (0.8 + r.random() * 0.5)
        shapes.rock(cv, x + s / 2, y + r.random() * 2, s * 1.25, s * 0.9, seed + int(x), snow=snow, facets=5)
        x += s * 1.05


# ───────────── the hut ─────────────
HW, HH = 330, 400                 # the hut's canvas
FX, FY = HW / 2, HH - 18          # its foot: the bottom centre of the 3 × 2 tile footprint
X0, X1 = FX - 1.5 * T, FX + 1.5 * T
WALL = 66                         # the front wall's height
GABLE = 74                        # the front gable above it
DEPTH = 2 * T                     # the footprint's depth on screen


def hut_canvas():
    return Canvas(HW, HH, foot=(FX, FY))


def hut_floor(cv, snow=1.0):
    """The ground inside the walls seen from above (snowed in when there's no roof)."""
    d = sd_box(cv.X, cv.Y, FX, FY - WALL - DEPTH / 2, 1.5 * T - 10, DEPTH / 2 - 4, 4)
    alb = colour_field(cv, "earth", "earth_dark", cv.noise(20, 3, 2))
    s = smoothstep(0.05, 0.18, cv.noise(26, 4, 2)) * snow
    alb = alb * (1 - s[..., None]) + colour_field(cv, "snow", "snow_shade", cv.noise(18, 5, 2) * 0.6) * s[..., None]
    back = 1 - smoothstep(FY - DEPTH - 10, FY - DEPTH + 60, cv.Y) * 0.0
    shade = smoothstep(FY - DEPTH - 20, FY - DEPTH + 50, cv.Y) * 0.35 + 0.65
    cv.part(d, alb * shade[..., None], bulge=blur(np.clip(-d, 0, 8), 6) + s * 3, elev=np.zeros_like(cv.X), cast=0)


def hut_walls(cv, seed=10, char=0.0, ruin=False):
    back_y = FY - DEPTH
    if not ruin:
        # the back wall (its inner face), then the side walls' tops (the log ends), then the front wall
        log_wall(cv, X0 + 6, X1 - 6, back_y, WALL, seed, elev_base=0, char=char, snow_top=0.8)
        for sx in (X0 + 6, X1 - 6):
            d = sd_box(cv.X, cv.Y, sx, FY - WALL - DEPTH / 2, 7, DEPTH / 2 - 2, 4)
            cv.part(d, wood(cv, seed + 3, grain_axis=0), round_=5, elev=np.full_like(cv.X, WALL), snow=1.0,
                    snow_seed=seed + 4, snow_thick=3, cast=0.4)
    stones_row(cv, X0 - 4, X1 + 4, FY - 6, seed + 50)
    if ruin:
        # two charred logs left of the front wall, one broken short, a collapsed log, a snow heap inside
        log_row(cv, X0 + 4, X1 - 4, FY - 16, 7, seed + 1, np.full_like(cv.X, 14.0), char=0.6, snow=0.5)
        log_row(cv, X0 + 4, FX + 30, FY - 28, 7, seed + 2, np.full_like(cv.X, 28.0), char=0.7, snow=0.9)
        d = sd_segment(cv.X, cv.Y, X0 + 50, FY - 40, X1 - 70, FY - 76, 7.5)
        cv.part(d, colour_field(cv, "bark_dark", "#2a1d18", cv.noise(4, 9, 2)), round_=7,
                elev=np.full_like(cv.X, 8.0), snow=1.0, snow_seed=12, cast=0.4)
        return
    log_wall(cv, X0, X1, FY - 8, WALL, seed + 20, char=char)


def door_hole(cv):
    d = sd_box(cv.X, cv.Y, FX, FY - 8 - 28, 19, 28, 3)
    cv.part(d, rgb("#1b1418"), flat=True, elev=np.full_like(cv.X, 30.0), cast=0)
    # the frame
    for sx in (FX - 21, FX + 21):
        cv.part(sd_box(cv.X, cv.Y, sx, FY - 8 - 30, 3.5, 30, 1.5), wood(cv, 61, grain_axis=1), round_=3,
                elev=np.full_like(cv.X, 30.0), cast=0.3)
    cv.part(sd_box(cv.X, cv.Y, FX, FY - 8 - 60, 25, 4, 1.5), wood(cv, 62), round_=3, elev=np.full_like(cv.X, 60.0))


def door(cv):
    d = sd_box(cv.X, cv.Y, FX, FY - 8 - 28, 18, 27, 2)
    planks = 0.5 + 0.5 * np.sign(np.sin((cv.X - FX) / 6.0 * math.pi))
    alb = colour_field(cv, "#a2703f", "#6a4426", np.clip(0.25 + planks * 0.2 + cv.noise(4, 71, 2) * 0.4, 0, 1))
    cv.part(d, alb, round_=2, elev=np.full_like(cv.X, 30.0), cast=0.2)
    for yy in (FY - 52, FY - 22):
        cv.part(sd_box(cv.X, cv.Y, FX, yy, 17, 2.4, 1), rgb("iron"), round_=2, spec=0.6, elev=np.full_like(cv.X, 30.0))
    cv.part(sd_ellipse(cv.X, cv.Y, FX + 11, FY - 36, 2.4, 2.4), rgb("iron_hi"), round_=2, spec=0.8,
            elev=np.full_like(cv.X, 30.0))


def window(cv, x, glow=False):
    y = FY - 8 - 40
    cv.part(sd_box(cv.X, cv.Y, x, y, 15, 12, 2), wood(cv, 81), round_=3, elev=np.full_like(cv.X, 40.0), cast=0.3)
    pane = sd_box(cv.X, cv.Y, x, y, 10, 8, 1)
    if glow:
        cv.part(pane, rgb("#ffcf7a"), unlit=True, emit=np.array(rgb("#40260a")), elev=np.full_like(cv.X, 40.0))
    else:
        cv.part(pane, colour_field(cv, "#3a4a70", "#1b2338", np.clip((cv.Y - y + 8) / 16, 0, 1)), spec=1.0,
                flat=True, elev=np.full_like(cv.X, 40.0))
    cv.part(sd_box(cv.X, cv.Y, x, y, 1.2, 8, 0), wood(cv, 82), round_=1, elev=np.full_like(cv.X, 40.0), cast=0)
    cv.part(sd_box(cv.X, cv.Y, x, y + 13, 17, 2.5, 1), rgb("snow"), round_=2, elev=np.full_like(cv.X, 28.0), cast=0.2)


def roof(cv, seed=30, hole=False):
    """Two slopes running back from the front gable under a thick, uneven blanket of snow: soft lumps and wind
    ripples, a rounded snow ridge, a visible snow slab at the eaves and gable edges, shingle rows and plank ends
    peeking out near the edges, the slope turned from the sun in a cool blue-violet gradient, icicles."""
    top = FY - 8 - WALL
    apex = (FX, top - GABLE)
    over = 14
    half = 1.5 * T + over
    left = [(X0 - over, top + 10), apex, (apex[0], apex[1] - DEPTH), (X0 - over, top + 10 - DEPTH)]
    right = [(X1 + over, top + 10), apex, (apex[0], apex[1] - DEPTH), (X1 + over, top + 10 - DEPTH)]
    X, Y = cv.X, cv.Y
    across = np.clip(np.abs(X - FX) / half, 0, 1)          # 0 at the ridge, 1 at the eave
    # how far a point lies down the slope from the ridge, and back from the gable (towards the top of the image)
    for poly, sign, sd in ((right, 1, seed + 1), (left, -1, seed)):
        d = sd_poly(X, Y, poly)
        # the roof itself: rows of dark shingles, seen only where the snow leaves them
        rows_ = 0.5 + 0.5 * np.sin(across * half / 9.0 * math.pi)
        planks = colour_field(cv, "#8a6248", "#3a2820", np.clip(0.15 + rows_ * 0.55 + cv.noise(6, sd, 2) * 0.25, 0, 1))
        tilt = (1 - across) * 95
        cv.part(d, planks, bulge=tilt + rows_ * 1.5, elev=WALL + GABLE * (1 - across), cast=0.5, cast_r=4)
        # the snow blanket: inset from the eave and the gable edge by an uneven margin, so shingles peek out there
        edge_noise = (cv.noise(9, sd + 4, 3) - 0.5)
        dist_eave = (1 - across) * half                      # px from the eave, along the slope
        front = (top + 10 - Y) - (1 - across) * (top + 10 - apex[1])  # px back from the front edge of the slope
        margin_e = 5 + edge_noise * 9 + smoothstep(0.6, 0.85, cv.noise(14, sd + 8, 2)) * 7
        margin_f = 4 + edge_noise * 6
        ds = np.maximum(d, np.maximum(margin_e - dist_eave, margin_f - front))
        # a few bare patches near the edges where the wind took the snow off
        r = rng(sd + 50)
        for k in range(2):
            px = FX + sign * half * (0.9 + r.random() * 0.06)
            py = apex[1] - DEPTH * (0.25 + k * 0.4 + r.random() * 0.15) + (top + 10 - apex[1]) * 0.9
            ds = np.maximum(ds, -(sd_ellipse(X, Y, px, py, 6 + r.random() * 4, 9 + r.random() * 6) +
                                  (cv.noise(5, sd + 60 + k, 2) - 0.5) * 5))
        inside = np.clip(-ds, 0, None)
        # thickness: a rounded slab edge, soft lumps, long wind ripples across the slope
        slab = np.sqrt(np.clip(inside / 7.0, 0, 1)) * 7.0
        lumps = (cv.noise(30, sd + 11, 3) - 0.5) * 10 + (cv.noise(12, sd + 12, 2) - 0.5) * 1.5
        ripple = np.sin((Y * 0.55 + across * half * 0.35) / 5.5 + cv.noise(40, sd + 13, 2) * 7) * 0.8
        sbulge = tilt + slab + lumps * smoothstep(0, 10, inside) + ripple
        if sign > 0:
            # turned from the sun: cool blue-violet, deeper towards the eave and the ridge
            tone = np.clip(0.25 + across * 0.35 + (1 - smoothstep(0.0, 0.18, across)) * 0.25
                           + cv.noise(22, sd + 14, 2) * 0.2, 0, 1)
            salb = colour_field(cv, "#e4ebf8", "#a9b2dc", tone)
        else:
            # in the sun: warm-white near the ridge, cooler and greyer towards the eave, soft drifts of shade
            tone = np.clip(0.08 + across * 0.45 + (cv.noise(28, sd + 14, 2) - 0.5) * 0.5, 0, 1)
            salb = colour_field(cv, "#f2f4fa", "#bfcae6", tone)
        cv.part(ds, salb, bulge=sbulge, elev=WALL + GABLE * (1 - across) + 6, spec=0.45, cast=0.55, cast_r=3,
                cast_off=(1.0 * sign, 2.0))
    # the ridge: a soft rounded roll of snow, wobbling a little
    wob = (cv.noise(18, seed + 21, 2) - 0.5) * 5
    ridge = sd_segment(X + wob, Y, apex[0], apex[1] - DEPTH + 2, apex[0], apex[1] + 3, 9)
    rr = np.clip(1 - np.abs(X + wob - FX) / 9, 0, 1)
    cv.part(ridge, colour_field(cv, "#fbfdff", "#c9d3ee", np.clip((X + wob - FX) / 9 * 0.5 + 0.4, 0, 1)),
            bulge=np.sqrt(rr) * 9 + 100, elev=np.full_like(X, WALL + GABLE + 8), spec=0.5, cast=0.25, cast_r=3,
            soft=1.2)
    # the front gable: a triangle of logs over the wall
    gable = sd_poly(X, Y, [(X0 + 4, top + 2), (FX, top - GABLE + 10), (X1 - 4, top + 2)])
    logs = 0.5 + 0.5 * np.cos(((top - Y) % 11.0) / 11.0 * math.tau)
    alb = colour_field(cv, "#9a6a46", "#4a2f22", np.clip(0.75 - logs * 0.45 + cv.noise(5, 33, 2) * 0.25, 0, 1))
    cv.part(gable, alb, bulge=logs * 4, elev=WALL + np.clip(top - Y, 0, None), cast=0.3)
    # the barge boards along the gable's edges, with plank ends at the eave corners
    for side, ((ax, ay), (bx, by)) in ((-1, ((X0 - over, top + 10), apex)), (1, ((X1 + over, top + 10), apex))):
        cv.part(sd_segment(X, Y, ax, ay, bx, by, 5), wood(cv, 35, "#8a5e3c", "#4a2f22"), round_=4,
                elev=np.full_like(X, WALL + GABLE / 2), cast=0.45)
        de = sd_ellipse(X, Y, ax + side * 1, ay + 1, 4.2, 4.6)
        cv.part(de, colour_field(cv, "#b88a5a", "#5a3a26", np.clip(np.hypot(X - ax, Y - ay) / 5, 0, 1)), round_=2,
                elev=np.full_like(X, WALL), cast=0.2)
        # the snow slab overhanging the gable edge: a thick lip, uneven, shading the board under it
        t = np.clip(((X - ax) * (bx - ax) + (Y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2), 0, 1)
        lip_r = 5.5 + (cv.noise(8, 40 + side, 2) - 0.5) * 5
        lip = sd_segment(X, Y, ax + side * -3, ay - 6, bx, by - 6, 1.0) - lip_r * smoothstep(0.0, 0.1, t)
        cv.part(lip, colour_field(cv, "#f6f9ff", "#c3cde8", np.clip((Y - (ay + (by - ay) * t)) / 12 + 0.5, 0, 1)),
                round_=5, elev=np.full_like(X, WALL + GABLE / 2 + 6), spec=0.4, cast=0.5, cast_r=2.5, cast_off=(0, 2.5))
    # icicles under the eaves' lowest corners
    r = rng(seed + 9)
    for side in (-1, 1):
        for k in range(6):
            ex = FX + side * (half - 4 - k * 8)
            ey = top + 12 - k * 8 * GABLE / (1.5 * T)
            L = 7 + r.random() * 13
            d = sd_poly(X, Y, [(ex - 2.4, ey), (ex + 2.4, ey), (ex, ey + L)])
            cv.part(d, colour_field(cv, "ice_hi", "ice", np.clip((Y - ey) / L, 0, 1)), round_=1.5, spec=1.0,
                    elev=np.full_like(X, WALL), cast=0.15, opacity=0.92)
    if hole:
        roof_hole(cv)


def roof_hole(cv):
    """A torn patch on the left slope: dark inside, broken shingles and boards sticking out."""
    cx, cy = FX - 60, FY - 8 - WALL - GABLE - 70
    d = sd_ellipse(cv.X, cv.Y, cx, cy, 30, 22) + (cv.noise(3, 91, 2) - 0.5) * 14
    cv.part(d, colour_field(cv, "#120d10", "#2a1d1a", np.clip((cv.Y - cy + 20) / 40, 0, 1)), flat=True,
            elev=np.full_like(cv.X, WALL + GABLE * 0.5), cast=0)
    r = rng(92)
    for k in range(6):
        a = k * math.tau / 6 + r.random() * 0.5
        x0, y0 = cx + math.cos(a) * 24, cy + math.sin(a) * 17
        x1, y1 = cx + math.cos(a) * (8 + r.random() * 8), cy + math.sin(a) * (6 + r.random() * 6)
        cv.part(sd_segment(cv.X, cv.Y, x0, y0, x1, y1, 2.6), wood(cv, 93 + k, "#8a5e3c", "#3e2a22"), round_=2,
                elev=np.full_like(cv.X, WALL + GABLE * 0.5), cast=0.4)
    # a rim of torn snow
    rim = np.abs(d) - 2.5
    cv.part(np.maximum(rim, -d - 1), rgb("snow_hi"), round_=2, elev=np.full_like(cv.X, WALL + GABLE * 0.5), cast=0.2)


def chimney(cv):
    """A stone chimney standing out of the right slope: three courses wide, dark against the snow, a snow cap
    around its sooty mouth, snow heaped against its uphill side. The mouth (the smoke anchor) stays put."""
    cx, top = FX + 70, FY - 8 - WALL - GABLE - 70
    X, Y = cv.X, cv.Y
    base_y = top + 62
    # its shadow and the snow heaped behind it on the slope
    shapes.snow_mound(cv, cx, base_y - 4, 50, 14, 105, sastrugi=False)
    # its shadow falling down-right over the snow of the slope
    sh = sd_ellipse(X, Y, cx + 22, base_y + 6, 24, 9) + (cv.noise(6, 108, 2) - 0.5) * 4
    cv.part(sh, rgb("#5a628e"), flat=True, elev=np.full_like(X, WALL + GABLE + 30), cast=0, opacity=0.38, soft=8)
    stones = None
    for k in range(7):
        for j in range(3):
            x = cx - 15 + j * 15 + (k % 2) * 5 - 2
            y = base_y - 6 - k * 9.5
            s = sd_box(X, Y, x, y, 7.6, 4.6, 2.6) + (cv.noise(2, 102 + k * 3 + j, 2) - 0.5) * 1.6
            stones = s if stones is None else np.minimum(stones, s)
    body = sd_box(X, Y, cx, (base_y + top) / 2 - 4, 20, (base_y - top) / 2 + 2, 3)
    stones = np.maximum(stones, body)
    mortar = sd_box(X, Y, cx, (base_y + top) / 2 - 4, 19, (base_y - top) / 2 + 1, 3)
    cv.part(mortar, rgb("#2e2a30"), round_=6, elev=np.full_like(X, WALL + GABLE + 50), cast=0.75, cast_r=6,
            cast_off=(4, 4))
    alb = colour_field(cv, "#b4aea6", "#4c4650", np.clip(0.28 + cv.noise(3, 103, 2) * 0.45 + (X - cx) / 36, 0, 1))
    cv.part(stones, alb, round_=3.5, elev=np.full_like(X, WALL + GABLE + 50), cast=0.3, cast_r=1.5)
    # snow around its foot on the slope (in front)
    d = sd_ellipse(X, Y, cx + 2, base_y + 2, 26, 7) + (cv.noise(4, 106, 2) - 0.5) * 5
    cv.part(d, colour_field(cv, "#eef2fb", "#b6bfe0", np.clip((X - cx) / 40 + 0.5, 0, 1)), round_=5,
            elev=np.full_like(X, WALL + GABLE + 30), spec=0.4, cast=0.2)
    # the cap: a stone slab, a ring of snow and the dark sooty mouth
    cv.part(sd_box(X, Y, cx + 1, top - 3, 23, 6, 3), colour_field(cv, "#8e90a0", "#3e3e50", np.clip((Y - top + 6) / 10, 0, 1)),
            round_=4, elev=np.full_like(X, WALL + GABLE + 62), cast=0.4)
    ring = sd_ellipse(X, Y, cx + 2, top - 7, 21, 8) + (cv.noise(3, 107, 2) - 0.5) * 3
    cv.part(ring, colour_field(cv, "#fbfdff", "#c9d1ec", np.clip((X - cx) / 30 + 0.4, 0, 1)), round_=5,
            elev=np.full_like(X, WALL + GABLE + 64), spec=0.5, cast=0.2)
    cv.part(sd_ellipse(X, Y, cx + 2, top - 6, 11, 4.6), colour_field(cv, "#2a2024", "#0e0a0c", np.clip((Y - top + 10) / 8, 0, 1)),
            flat=True, elev=np.full_like(X, WALL + GABLE + 66), soft=1.0)
    return (cx + 2, top - 8)


def scaffold(cv):
    """Timber poles, a cross beam and lashings in front of the wall: a stage paid in part."""
    for x in (X0 + 10, FX - 50, FX + 50, X1 - 10):
        cv.part(sd_segment(cv.X, cv.Y, x, FY + 2, x + 3, FY - WALL - 48, 3.2), wood(cv, int(x), "#c99a62", "#7a5634",
                1), round_=3, elev=np.full_like(cv.X, 60.0), cast=0.4)
    for y in (FY - 40, FY - WALL - 30):
        cv.part(sd_segment(cv.X, cv.Y, X0 + 2, y, X1 - 2, y - 3, 3.0), wood(cv, int(y), "#c99a62", "#7a5634"),
                round_=3, elev=np.full_like(cv.X, 60.0), cast=0.4)
    cv.part(sd_segment(cv.X, cv.Y, X0 + 12, FY - 4, FX - 48, FY - WALL - 28, 2.4), wood(cv, 7, "#c99a62", "#7a5634"),
            round_=2, elev=np.full_like(cv.X, 60.0), cast=0.4)
    for x in (X0 + 10, FX - 50, FX + 50, X1 - 10):
        for y in (FY - 40, FY - WALL - 30):
            cv.part(sd_ellipse(cv.X, cv.Y, x + 1, y, 4.5, 3.5), rgb("#cdb48a"), round_=2, elev=np.full_like(cv.X, 60.0))
    # a stack of fresh planks leaning by the wall
    for k in range(4):
        x = X1 - 30 + k * 5
        cv.part(sd_segment(cv.X, cv.Y, x, FY + 4, x - 14, FY - 60, 3.4), wood(cv, 30 + k, "#e0b07a", "#a0723f", 1),
                round_=2, elev=np.full_like(cv.X, 40.0), cast=0.35)


def hut(m):
    rel = "buildings/hut/"
    # 0: the ruin
    cv = hut_canvas()
    shapes.snow_mound(cv, FX + 10, FY - 30, 270, 90, 119, sastrugi=True)
    for k, x in enumerate((X0 + 8, X1 - 8)):
        stake(cv, x, FY - 12 - k * 4, 54 - k * 16, 8, 125 + k, broken=True, snow=0.0)
    hut_walls(cv, ruin=True)
    emit_sprite(m, "hut.0", cv, rel + "hut_0", block=1)
    # 1: walls on the footing, open to the sky
    cv = hut_canvas()
    hut_floor(cv, snow=0.6)
    hut_walls(cv)
    door_hole(cv)
    emit_sprite(m, "hut.1", cv, rel + "hut_1", block=1)
    # 2: the roof; 3: the door; 4: the stove's chimney
    for stage in (2, 3, 4):
        cv = hut_canvas()
        hut_walls(cv)
        roof(cv)
        if stage >= 3:
            door(cv)
            window(cv, FX - 80)
            window(cv, FX + 80)
        else:
            door_hole(cv)
        extra = {}
        if stage == 4:
            sx, sy = chimney(cv)
            extra["anchor"] = [round(sx, 1), round(sy, 1)]
        # the crop the roofed hut has always had (330 × 349, foot 165, 350): the game's placement must not move
        e = emit_sprite(m, f"hut.{stage}", cv, rel + f"hut_{stage}", block=1,
                        box=(0, int(FY) - 350, HW, int(FY) - 350 + 349))
        if extra:
            # the anchor in trimmed coordinates: the foot moved by the trim, so move it the same way
            dx, dy = e["foot"][0] - FX, e["foot"][1] - FY
            e["anchor"] = [round(extra["anchor"][0] + dx, 1), round(extra["anchor"][1] + dy, 1)]
    # overlays on the same canvas
    cv = hut_canvas()
    roof_hole(cv)
    emit_sprite(m, "hut.roofhole", cv, rel + "roofhole", shadow=False)
    cv = hut_canvas()
    scaffold(cv)
    emit_sprite(m, "hut.scaffold", cv, rel + "scaffold", shadow=True)


# ───────────── the palisade ─────────────
def stake(cv, x, foot_y, h, r, seed, tip=True, broken=False, lean=0.0, snow=1.0, char=0.0):
    tx = x + lean * h
    top = foot_y - h
    d = sd_segment(cv.X, cv.Y, x, foot_y, tx, top + (r * 2 if tip and not broken else 0), r)
    if tip and not broken:
        tipd = sd_poly(cv.X, cv.Y, [(tx - r, top + r * 2.2), (tx + r, top + r * 2.2), (tx, top - r * 0.6)])
        d = np.minimum(d, tipd)
    if broken:
        jag = top + (cv.noise(1.5, seed, 2) - 0.5) * 10
        d = np.maximum(d, jag - cv.Y)
    across = np.clip(1 - ((cv.X - (x + (tx - x) * (foot_y - cv.Y) / max(1, h))) / r) ** 2, 0, 1)
    alb = colour_field(cv, "#9a6a46", "#3e2820", np.clip(0.3 + cv.noise(3, seed, 2) * 0.35 + char, 0, 1))
    tipmask = smoothstep(top + r * 3.5, top + r * 1.2, cv.Y)
    alb = alb * (1 - tipmask[..., None] * 0.0) + np.array(rgb("wood_cut")) * tipmask[..., None] * 0.0
    cv.part(d, alb, bulge=np.sqrt(across) * r, cast=0.45, cast_r=3, cast_off=(2, 1), snow=0)
    if snow > 0 and not broken:
        cap = sd_ellipse(cv.X, cv.Y, tx, top + r * 1.4, r * 0.9, r * 0.7)
        cv.part(np.maximum(cap, d - 1.5), rgb("snow_hi"), round_=r * 0.6, spec=0.4, cast=0.1)
    if broken:
        cv.part(sd_ellipse(cv.X, cv.Y, tx, top + 1, r * 0.9, r * 0.45), rgb("wood_cut"), round_=1, cast=0)


def binding(cv, x0, x1, y, seed):
    cv.part(sd_segment(cv.X, cv.Y, x0, y, x1, y - 1, 3.2), wood(cv, seed, "#8a5e3c", "#4a2f22"), round_=3,
            elev=np.full_like(cv.X, 50.0), cast=0.4)
    for x in np.arange(x0 + 8, x1, 19):
        cv.part(sd_box(cv.X, cv.Y, x, y, 2.2, 5, 1), rgb("#b89a6a"), round_=1.5, elev=np.full_like(cv.X, 50.0), cast=0.2)


def palisade(m):
    rel = "buildings/palisade/"
    H = 104
    for state in ("", ".damaged", ".broken"):
        cv = Canvas(120, 150, foot=(60, 142))
        r = rng(201 + len(state))
        snow_line = (shapes.snow_mound, )
        xs = [60 - 38 + k * 19 for k in range(5)]
        for k, x in enumerate(xs):
            h = H + r.random() * 10
            if state == "" or (state == ".damaged" and k not in (1, 3)) or (state == ".broken" and k in (0, 4)):
                stake(cv, x, 142, h if state != ".broken" else h * 0.4, 9.2, 201 + k, broken=state == ".broken",
                      lean=(r.random() - 0.5) * 0.03)
            elif state == ".damaged":
                stake(cv, x, 142, h * (0.55 + r.random() * 0.15), 9.2, 211 + k, broken=True, lean=(r.random() - 0.5) * 0.1)
        if state != ".broken":
            binding(cv, 14, 106, 142 - 64, 220)
        else:
            # stakes lying in the snow
            for k in range(2):
                y = 132 - k * 10
                cv.part(sd_segment(cv.X, cv.Y, 18 + k * 20, y, 100 - k * 8, y - 8 + k * 4, 8), wood(cv, 230 + k, "#9a6a46",
                        "#3e2820"), round_=7, elev=np.full_like(cv.X, 8.0), snow=0.9, snow_seed=k, cast=0.4)
        if state == ".damaged":
            # gnaw marks: pale scratches low on the stakes
            for k in range(5):
                x = 30 + k * 13
                cv.part(sd_segment(cv.X, cv.Y, x, 118, x + 5, 104, 1.1), rgb("wood_cut"), round_=1, unlit=False,
                        elev=np.full_like(cv.X, 20.0), cast=0)
        # snow banked at the foot
        d = sd_ellipse(cv.X, cv.Y, 60, 142, 56, 9) + (cv.noise(5, 240, 2) - 0.5) * 5
        cv.part(d, rgb("snow"), bulge=blur(np.sqrt(np.clip(-d / 9, 0, 1)) * 7, 6), spec=0.3, elev=np.zeros_like(cv.X),
                cast=0.2)
        emit_sprite(m, "palisade.h" + state, cv, rel + "h" + state.replace(".", "_"), block=1)
    # the east/west wall: stakes one behind the other down a tile
    for state in ("", ".damaged", ".broken"):
        cv = Canvas(70, 240, foot=(35, 228))
        r = rng(301 + len(state))
        ys = [228 - 96 + 8 + k * 19 for k in range(5)]
        d = sd_box(cv.X, cv.Y, 35, 228 - 44, 15, 52, 12) + (cv.noise(5, 340, 2) - 0.5) * 5
        cv.part(d, rgb("snow"), bulge=blur(np.sqrt(np.clip(-d / 9, 0, 1)) * 5, 6), spec=0.3, elev=np.zeros_like(cv.X),
                cast=0.0)
        for k, y in enumerate(ys):
            h = H + r.random() * 10
            if state == "" or (state == ".damaged" and k != 2) or (state == ".broken" and k in (0, 4)):
                stake(cv, 35 + (r.random() - 0.5) * 3, y, h if state != ".broken" else h * 0.4, 11, 301 + k,
                      broken=state == ".broken")
            elif state == ".damaged":
                stake(cv, 35, y, h * 0.6, 9.2, 311 + k, broken=True)
        if state != ".broken":
            cv.part(sd_segment(cv.X, cv.Y, 35, 228 - 64 - 92, 35, 228 - 64 + 4, 3.5), wood(cv, 320, "#8a5e3c", "#4a2f22", 1),
                    round_=3, elev=np.full_like(cv.X, 50.0), cast=0.3)
        emit_sprite(m, "palisade.v" + state, cv, rel + "v" + state.replace(".", "_"), block=1)
    # the corner post
    cv = Canvas(60, 150, foot=(30, 140))
    stake(cv, 30, 140, 120, 13, 401)
    cv.part(sd_ellipse(cv.X, cv.Y, 30, 140, 22, 6), rgb("snow"), round_=4, elev=np.zeros_like(cv.X), cast=0.1)
    emit_sprite(m, "palisade.post", cv, rel + "post", block=1)
    # the south gate: two heavy posts, a lintel and the two leaves swung inwards
    cv = Canvas(230, 190, foot=(115, 176))
    for k, x in enumerate((24, 206)):
        stake(cv, x, 176, 140, 13, 411 + k)
    for side in (-1, 1):
        x_post = 115 + side * 82
        # the leaf: a panel of stakes seen edge-on, angled back into the camp
        for j in range(4):
            x = x_post - side * (6 + j * 8)
            y = 176 - 4 - j * 12
            stake(cv, x, y, 92, 6.5, 420 + j + side * 10, snow=0.8)
    cv.part(sd_segment(cv.X, cv.Y, 14, 176 - 132, 216, 176 - 132, 8), wood(cv, 430, "#8a5e3c", "#4a2f22"), round_=7,
            elev=np.full_like(cv.X, 132.0), snow=1.0, snow_seed=431, snow_thick=4, cast=0.5)
    # trodden snow in the opening
    d = sd_ellipse(cv.X, cv.Y, 115, 176, 80, 10) + (cv.noise(5, 432, 2) - 0.5) * 4
    cv.part(d, colour_field(cv, "snow_mid", "snow_shade", cv.noise(3, 433, 2)), round_=3, elev=np.zeros_like(cv.X),
            cast=0, opacity=0.8)
    emit_sprite(m, "palisade.gate", cv, rel + "gate")
    cv = Canvas(40, 140, foot=(20, 130))
    stake(cv, 20, 130, 106, 9.2, 441)
    emit_sprite(m, "palisade.stake", cv, rel + "stake")


# ───────────── camp things ─────────────
def bench(m):
    cv = Canvas(120, 110, foot=(60, 98))
    X, Y = cv.X, cv.Y
    # legs, then the top seen from above with its front edge
    for x, y in ((24, 98), (96, 98), (28, 72), (92, 72)):
        cv.part(sd_box(X, Y, x, y - 14, 4, 15, 2), wood(cv, int(x + y), grain_axis=1), round_=3,
                elev=np.full_like(X, 14.0), cast=0.4)
    cv.part(sd_box(X, Y, 60, 60, 46, 20, 3), wood(cv, 501, "#c79058", "#7a4f30"), round_=4, elev=np.full_like(X, 34.0),
            cast=0.45, snow=0.4, snow_seed=502)
    cv.part(sd_box(X, Y, 60, 83, 46, 4, 2), wood(cv, 503, "#9a6a40", "#5a3a22"), round_=3, elev=np.full_like(X, 30.0),
            cast=0.3)
    # a saw: blade + handle
    cv.part(sd_poly(X, Y, [(30, 56), (66, 50), (66, 58), (30, 62)]), rgb("iron_hi"), round_=1.5, spec=1.0,
            elev=np.full_like(X, 36.0), cast=0.3)
    cv.part(sd_box(X, Y, 72, 54, 6, 5, 2), rgb("wood_dark"), round_=2, elev=np.full_like(X, 36.0))
    # an axe: handle and head
    cv.part(sd_segment(X, Y, 78, 72, 98, 48, 2.6), wood(cv, 504, "#d2a06a", "#8a5e3a"), round_=2,
            elev=np.full_like(X, 36.0), cast=0.35)
    cv.part(sd_poly(X, Y, [(92, 44), (104, 46), (102, 58), (96, 54)]), rgb("iron"), round_=2, spec=0.9,
            elev=np.full_like(X, 36.0), cast=0.3)
    # shavings under it
    r = rng(505)
    for k in range(7):
        x, y = 30 + r.random() * 64, 96 + r.random() * 8
        cv.part(np.abs(sd_ellipse(X, Y, x, y, 3.5, 2)) - 0.8, rgb("wood_cut"), round_=1, elev=np.full_like(X, 1.0),
                cast=0.1)
    emit_sprite(m, "bench", cv, "buildings/camp/bench", block=1)


def firepit(m):
    for burnt in (False, True):
        cv = Canvas(120, 90, foot=(60, 70))
        X, Y = cv.X, cv.Y
        cx, cy = 60, 50
        # a bed of ash and charcoal
        d = sd_ellipse(X, Y, cx, cy, 30, 17) + (cv.noise(3, 601, 2) - 0.5) * 4
        cv.part(d, colour_field(cv, "#5a5250", "#231c1c", cv.noise(2.5, 602, 2)), round_=3, elev=np.zeros_like(X), cast=0)
        r = rng(603)
        # the back half of the stone ring, the logs, the front half (so logs sit inside)
        ring = [(cx + math.cos(a) * 36, cy + math.sin(a) * 21, a) for a in np.linspace(0, math.tau, 11)[:-1]]
        for x, y, a in sorted(ring, key=lambda p: p[1]):
            if y > cy:
                continue
            s = 15 + r.random() * 4
            shapes.rock(cv, x, y + 5, s * 1.25, s * 0.85, 610 + int(a * 10), snow=0.4, facets=5)
        if not burnt:
            for k, (a, L) in enumerate(((0.5, 24), (2.6, 24), (4.4, 22), (1.4, 20))):
                x0, y0 = cx + math.cos(a) * L, cy + math.sin(a) * L * 0.55
                x1, y1 = cx - math.cos(a) * 5, cy - math.sin(a) * 3 - 6
                cv.part(sd_segment(X, Y, x0, y0, x1, y1, (5.2, 4)), colour_field(cv, "bark", "#1f1614",
                        np.clip(0.3 + (1 - np.hypot(X - cx, Y - cy) / 26) * 0.6, 0, 1)), round_=4,
                        elev=np.full_like(X, 8.0), cast=0.4)
        else:
            for k in range(3):
                a = k * 2.1 + 0.3
                cv.part(sd_segment(X, Y, cx + math.cos(a) * 18, cy + math.sin(a) * 9, cx - math.cos(a) * 6,
                                   cy - math.sin(a) * 4, 3.4), rgb("#231a18"), round_=3, elev=np.full_like(X, 4.0),
                        cast=0.3)
            d = sd_ellipse(X, Y, cx, cy - 2, 16, 8) + (cv.noise(2, 620, 2) - 0.5) * 3
            cv.part(d, colour_field(cv, "#b4aca8", "#6c6462", cv.noise(2, 621, 2)), round_=4, elev=np.full_like(X, 3.0),
                    cast=0.2)
        for x, y, a in sorted(ring, key=lambda p: p[1]):
            if y <= cy:
                continue
            s = 16 + r.random() * 4
            shapes.rock(cv, x, y + 5, s * 1.3, s * 0.85, 630 + int(a * 10), snow=0.5, facets=5)
        e = emit_sprite(m, "firepit.ash" if burnt else "firepit", cv, "buildings/camp/" + ("firepit_ash" if burnt else "firepit"))
        e["anchor"] = [round(e["foot"][0], 1), round(e["foot"][1] - 22, 1)]


def bunk(m):
    for frame in (False, True):
        cv = Canvas(120, 120, foot=(60, 106))
        X, Y = cv.X, cv.Y
        for x, y in ((18, 106), (102, 106), (18, 40), (102, 40)):
            cv.part(sd_box(X, Y, x, y - 12, 5, 13, 2), wood(cv, int(x + y), grain_axis=1), round_=3,
                    elev=np.full_like(X, 12.0), cast=0.4)
        for y in (34, 96):
            cv.part(sd_box(X, Y, 60, y, 46, 5, 2), wood(cv, 700 + y), round_=3, elev=np.full_like(X, 22.0), cast=0.4)
        for x in (16, 104):
            cv.part(sd_box(X, Y, x, 66, 5, 34, 2), wood(cv, 710 + x, grain_axis=1), round_=3, elev=np.full_like(X, 22.0),
                    cast=0.4)
        if frame:
            for k in range(2):
                cv.part(sd_box(X, Y, 40 + k * 30, 66, 6, 30, 1.5), wood(cv, 720 + k, "#d8aa72", "#a0723f", 1),
                        round_=2, elev=np.full_like(X, 24.0), cast=0.3)
        else:
            # slats under a thick fur and a straw pillow
            cv.part(sd_box(X, Y, 60, 66, 40, 28, 4), wood(cv, 730, "#c08a52", "#7a4f30", 1), round_=2,
                    elev=np.full_like(X, 24.0), cast=0.3)
            fur = sd_box(X, Y, 62, 72, 38, 24, 10) + (cv.noise(2.5, 731, 2) - 0.5) * 4
            cv.part(fur, colour_field(cv, "fur", "fur_dark", np.clip(cv.noise(2, 732, 3) * 0.8 + (Y - 50) / 60, 0, 1)),
                    round_=10, elev=np.full_like(X, 30.0), cast=0.45)
            cv.part(sd_ellipse(X, Y, 60, 46, 22, 9), colour_field(cv, "wool", "#b9ad98", cv.noise(3, 733, 2)), round_=7,
                    elev=np.full_like(X, 32.0), cast=0.4)
        emit_sprite(m, "bunk.frame" if frame else "bunk", cv, "buildings/camp/" + ("bunk_frame" if frame else "bunk"),
                    block=0)


def small_roof(cv, x0, x1, eave_y, ridge_y, depth, seed, snow=1.0, shed=False):
    """A pitched (or shed) roof over a small building seen like the hut's."""
    cx = (x0 + x1) / 2
    if shed:
        poly = [(x0 - 8, eave_y + 6), (x1 + 8, eave_y + 6), (x1 + 8, eave_y + 6 - depth), (x0 - 8, eave_y + 6 - depth)]
        d = sd_poly(cv.X, cv.Y, poly)
        alb = colour_field(cv, "#7a5a44", "#3e2a22", np.clip(0.3 + cv.noise(4, seed, 2) * 0.4, 0, 1))
        smask = smoothstep(eave_y - 4, eave_y - 12, cv.Y + (cv.noise(4, seed + 1, 2) - 0.5) * 8)
        rows_ = np.sin((eave_y - cv.Y) / 11.0 * math.pi)
        cv.part(d, alb, bulge=np.clip(eave_y + 6 - cv.Y, 0, None) * 0.6 + rows_ * 1.4 + (cv.noise(12, seed + 3, 2) - 0.5) * 5,
                snow=snow, snow_mask=smask, snow_seed=seed, snow_thick=6, elev=np.full_like(cv.X, 90.0), cast=0.5)
        return
    for side in (1, -1):
        xe = x1 + 8 if side > 0 else x0 - 8
        poly = [(xe, eave_y + 6), (cx, ridge_y), (cx, ridge_y - depth), (xe, eave_y + 6 - depth)]
        d = sd_poly(cv.X, cv.Y, poly)
        across = np.clip(np.abs(cv.X - cx) / ((x1 - x0) / 2 + 8), 0, 1)
        alb = colour_field(cv, "#7a5a44", "#3e2a22", np.clip(0.3 + cv.noise(4, seed + side, 2) * 0.4, 0, 1))
        lim = 0.84 + (cv.noise(4, seed + 5 + side, 2) - 0.5) * 0.15
        smask = 1 - smoothstep(lim - 0.03, lim + 0.02, across)
        rows_ = np.sin(across * ((x1 - x0) / 2 + 8) / 11.0 * math.pi)
        cv.part(d, alb, bulge=(1 - across) * 80 + 0, snow=snow, snow_mask=smask, snow_seed=seed + side,
                snow_thick=6, elev=np.full_like(cv.X, 60.0), cast=0.5)
        if side > 0:
            cv.alb = np.where((d < 0)[..., None], cv.alb * np.array([0.9, 0.93, 1.0]), cv.alb)
    gable = sd_poly(cv.X, cv.Y, [(x0 + 3, eave_y + 2), (cx, ridge_y + 6), (x1 - 3, eave_y + 2)])
    cv.part(gable, wood(cv, seed + 9, "#8a5e3c", "#4a2f22", 1), round_=2, elev=np.full_like(cv.X, 50.0), cast=0.3)


def plank_wall(cv, x0, x1, ybot, h, seed, elev=30.0):
    d = sd_box(cv.X, cv.Y, (x0 + x1) / 2, ybot - h / 2, (x1 - x0) / 2, h / 2, 2)
    planks = 0.5 + 0.5 * np.sign(np.sin((cv.X - x0) / 7.0 * math.pi))
    alb = colour_field(cv, "#a2703f", "#5a3a22", np.clip(0.25 + planks * 0.18 + cv.noise(4, seed, 2) * 0.4, 0, 1))
    cv.part(d, alb, round_=2, elev=np.full_like(cv.X, elev), cast=0.35)


def frame_posts(cv, x0, x1, ybot, h, seed, back=40):
    for x in (x0, x1):
        for dy in (0, -back):
            cv.part(sd_segment(cv.X, cv.Y, x, ybot + dy, x, ybot + dy - h, 3.4), wood(cv, seed + int(x + dy), "#c99a62",
                    "#7a5634", 1), round_=3, elev=np.full_like(cv.X, h / 2), cast=0.4)
    for dy in (0, -back):
        cv.part(sd_segment(cv.X, cv.Y, x0 - 4, ybot + dy - h, x1 + 4, ybot + dy - h, 3.2), wood(cv, seed + 5 + dy,
                "#c99a62", "#7a5634"), round_=3, elev=np.full_like(cv.X, h), cast=0.4)
    cv.part(sd_segment(cv.X, cv.Y, x0, ybot - 4, x1, ybot - h + 6, 2.6), wood(cv, seed + 9, "#c99a62", "#7a5634"),
            round_=2, elev=np.full_like(cv.X, h / 2), cast=0.35)


def upgrades(m):
    rel = "buildings/upgrades/"
    # the cellar: a door into a snow mound
    for frame in (False, True):
        cv = Canvas(130, 130, foot=(65, 116))
        X, Y = cv.X, cv.Y
        if frame:
            d = sd_ellipse(X, Y, 65, 100, 44, 18)
            cv.part(d, colour_field(cv, "earth", "earth_dark", cv.noise(4, 801, 2)), bulge=-np.clip(-d, 0, 8),
                    elev=np.zeros_like(X), cast=0)
            frame_posts(cv, 40, 90, 108, 50, 802, back=16)
        else:
            shapes.snow_mound(cv, 65, 108, 120, 70, 803)
            cv.part(sd_box(X, Y, 65, 86, 25, 24, 4), wood(cv, 804, "#8a5e3c", "#4a2f22", 1), round_=3,
                    elev=np.full_like(X, 30.0), cast=0.4)
            planks = 0.5 + 0.5 * np.sign(np.sin((X - 42) / 6.0 * math.pi))
            cv.part(sd_box(X, Y, 65, 88, 19, 20, 2), colour_field(cv, "#a2703f", "#6a4426",
                    np.clip(0.3 + planks * 0.2 + cv.noise(4, 805, 2) * 0.3, 0, 1)), round_=2, elev=np.full_like(X, 30.0))
            cv.part(sd_box(X, Y, 65, 88, 18, 2, 1), rgb("iron"), round_=1.5, spec=0.6, elev=np.full_like(X, 30.0))
        emit_sprite(m, "up.cellar" + (".frame" if frame else ""), cv, rel + ("cellar_frame" if frame else "cellar"))
    # the smokehouse: a tiny plank shed with a smoke hole
    for frame in (False, True):
        cv = Canvas(130, 180, foot=(65, 166))
        if frame:
            frame_posts(cv, 30, 100, 166, 70, 811)
            e = emit_sprite(m, "up.smokehouse.frame", cv, rel + "smokehouse_frame")
            continue
        plank_wall(cv, 30, 100, 166, 64, 812, elev=32)
        cv.part(sd_box(cv.X, cv.Y, 65, 140, 10, 14, 2), rgb("#1a1416"), flat=True, elev=np.full_like(cv.X, 20.0))
        small_roof(cv, 30, 100, 166 - 64, 166 - 64 - 34, 56, 813)
        cv.part(sd_box(cv.X, cv.Y, 65, 166 - 64 - 34 - 46, 7, 7, 2), rgb("#2a2024"), round_=3,
                elev=np.full_like(cv.X, 110.0))
        e = emit_sprite(m, "up.smokehouse", cv, rel + "smokehouse")
        e["anchor"] = [round(e["foot"][0], 1), round(e["foot"][1] - 64 - 34 - 46 - 6, 1)]
    # the annex: a small log room, 2 × 2 tiles
    for frame in (False, True):
        cv = Canvas(230, 320, foot=(115, 306))
        x0, x1 = 115 - 92, 115 + 92
        if frame:
            frame_posts(cv, x0, x1, 306, 60, 821, back=150)
            emit_sprite(m, "up.annex.frame", cv, rel + "annex_frame")
            continue
        stones_row(cv, x0 - 2, x1 + 2, 300, 822, size=10)
        log_wall(cv, x0, x1, 298, 56, 823, r=6)
        cv.part(sd_box(cv.X, cv.Y, 115 - 40, 298 - 32, 13, 11, 2), wood(cv, 824), round_=3, elev=np.full_like(cv.X, 30.0))
        cv.part(sd_box(cv.X, cv.Y, 115 - 40, 298 - 32, 9, 7, 1), rgb("#2a3550"), flat=True, spec=1.0,
                elev=np.full_like(cv.X, 30.0))
        small_roof(cv, x0, x1, 298 - 56, 298 - 56 - 40, 180, 825)
        emit_sprite(m, "up.annex", cv, rel + "annex", block=1)
    # the workshop: an open lean-to with a work table and tools on the back wall, 2 × 1 tiles
    for frame in (False, True):
        cv = Canvas(230, 210, foot=(115, 196))
        x0, x1 = 115 - 92, 115 + 92
        if frame:
            frame_posts(cv, x0, x1, 196, 76, 831, back=60)
            emit_sprite(m, "up.workshop.frame", cv, rel + "workshop_frame")
            continue
        plank_wall(cv, x0, x1, 196 - 64, 72, 832, elev=50)
        for k, x in enumerate((60, 90, 150)):
            cv.part(sd_segment(cv.X, cv.Y, x, 196 - 120, x + 4, 196 - 84, 2.2), rgb("wood_dark"), round_=2,
                    elev=np.full_like(cv.X, 60.0), cast=0.4)
            cv.part(sd_box(cv.X, cv.Y, x + 5, 196 - 82, 7, 5, 1.5), rgb("iron"), round_=2, spec=0.8,
                    elev=np.full_like(cv.X, 60.0), cast=0.3)
        cv.part(sd_box(cv.X, cv.Y, 115, 196 - 34, 70, 14, 3), wood(cv, 833, "#c79058", "#7a4f30"), round_=4,
                elev=np.full_like(cv.X, 30.0), cast=0.45)
        cv.part(sd_ellipse(cv.X, cv.Y, 150, 196 - 38, 12, 6), rgb("iron"), round_=4, spec=0.8, elev=np.full_like(cv.X, 34.0))
        for x in (x0, x1):
            cv.part(sd_segment(cv.X, cv.Y, x, 196, x, 196 - 96, 4), wood(cv, 834 + x, grain_axis=1), round_=4,
                    elev=np.full_like(cv.X, 50.0), cast=0.45)
        small_roof(cv, x0, x1, 196 - 96, 196 - 96, 76, 835, shed=True)
        emit_sprite(m, "up.workshop", cv, rel + "workshop", block=1)


def torch_and_snare(m):
    cv = Canvas(50, 150, foot=(25, 138))
    X, Y = cv.X, cv.Y
    cv.part(sd_segment(X, Y, 25, 138, 26, 34, (4, 3.2)), wood(cv, 901, "#8a5e3c", "#4a2f22", 1), round_=3, cast=0.4)
    head = sd_box(X, Y, 26, 34, 7.5, 12, 4) + (cv.noise(2, 902, 2) - 0.5) * 2.5
    cv.part(head, colour_field(cv, "#4a3a32", "#1c1416", cv.noise(2, 903, 2)), round_=5, cast=0.3)
    for y in (28, 40):
        cv.part(sd_box(X, Y, 26, y, 8, 1.6, 0.8), rgb("#8b6c4a"), round_=1, cast=0.1)
    d = sd_ellipse(X, Y, 25, 138, 20, 6) + (cv.noise(4, 904, 2) - 0.5) * 3
    cv.part(d, rgb("snow"), round_=4, elev=np.zeros_like(X), spec=0.3, cast=0.1)
    e = emit_sprite(m, "torch", cv, "buildings/camp/torch", block=0)
    e["anchor"] = [round(e["foot"][0] + 1, 1), round(e["foot"][1] - 112, 1)]
    cv = Canvas(70, 60, foot=(35, 44))
    X, Y = cv.X, cv.Y
    loop = np.abs(sd_ellipse(X, Y, 32, 44, 18, 8)) - 1.1
    cv.part(loop, rgb("#c9b48a"), round_=1, elev=np.full_like(X, 1.0), cast=0.3)
    cv.part(sd_segment(X, Y, 50, 44, 54, 14, (2.4, 1.6)), wood(cv, 911, "#8a5e3c", "#4a2f22", 1), round_=2, cast=0.35)
    cv.part(sd_segment(X, Y, 54, 16, 46, 40, 0.8), rgb("#c9b48a"), round_=0.8, cast=0.2)
    emit_sprite(m, "snare", cv, "buildings/camp/snare", shadow_strength=0.3)


def sled(m):
    cv = Canvas(230, 170, foot=(115, 150))
    X, Y = cv.X, cv.Y
    # runners: curled at the front (left)
    for y in (150, 112):
        d = sd_segment(X, Y, 34, y, 200, y, 3.6)
        d = np.minimum(d, np.abs(sd_ellipse(X, Y, 34, y - 14, 12, 14)) - 3.2 + np.where(X > 34, 99, 0))
        cv.part(d, colour_field(cv, "iron", "rust", smoothstep(0.5, 0.8, cv.noise(4, 1001 + y, 2))), round_=3, spec=0.6,
                elev=np.full_like(X, 4.0), cast=0.4)
    for x in (60, 110, 160, 196):
        cv.part(sd_segment(X, Y, x, 150, x, 112, 3.2), wood(cv, 1002 + x, "#8a5e3c", "#4a2f22", 1), round_=3,
                elev=np.full_like(X, 12.0), cast=0.3)
    cv.part(sd_box(X, Y, 128, 124, 78, 22, 4), wood(cv, 1003, "#b0804e", "#6a4426"), round_=4, elev=np.full_like(X, 20.0),
            cast=0.45)
    # bundles: a rolled fur, sacks, a small chest
    cv.part(sd_segment(X, Y, 70, 116, 120, 112, 15), colour_field(cv, "fur", "fur_dark", cv.noise(2, 1004, 3)), round_=12,
            elev=np.full_like(X, 36.0), cast=0.45)
    for k, (x, y, rr) in enumerate(((140, 112, 17), (168, 118, 14), (150, 96, 13))):
        d = sd_ellipse(X, Y, x, y, rr, rr * 1.1) + (cv.noise(3, 1010 + k, 2) - 0.5) * 3
        cv.part(d, colour_field(cv, "#c8b088", "#8a7454", cv.noise(3, 1011 + k, 2)), round_=rr * 0.8,
                elev=np.full_like(X, 40.0), cast=0.45, snow=0.6, snow_seed=k)
        cv.part(sd_segment(X, Y, x - 4, y - rr * 0.9, x + 4, y - rr * 0.9, 2.2), rgb("#6a5034"), round_=1.5,
                elev=np.full_like(X, 50.0))
    cv.part(sd_box(X, Y, 96, 130, 18, 12, 2), wood(cv, 1020, "#7a4a2a", "#3a2216"), round_=3, elev=np.full_like(X, 30.0),
            cast=0.4)
    cv.part(sd_box(X, Y, 96, 130, 18, 2, 0.5), rgb("iron"), spec=0.6, round_=1, elev=np.full_like(X, 30.0))
    # a lantern on a crooked pole at the back
    cv.part(sd_segment(X, Y, 200, 120, 204, 40, 2.6), wood(cv, 1030, "#8a5e3c", "#4a2f22", 1), round_=2,
            elev=np.full_like(X, 60.0), cast=0.4)
    cv.part(sd_segment(X, Y, 204, 42, 186, 40, 2.2), wood(cv, 1031), round_=2, elev=np.full_like(X, 80.0), cast=0.3)
    cv.part(sd_box(X, Y, 186, 56, 7, 9, 2), rgb("#3a3036"), round_=2, elev=np.full_like(X, 70.0), cast=0.3)
    cv.part(sd_box(X, Y, 186, 57, 4.5, 6, 1.5), rgb("#ffcf6a"), unlit=True, emit=np.array(rgb("#3a2008")),
            elev=np.full_like(X, 70.0))
    e = emit_sprite(m, "trader.sled", cv, "buildings/camp/trader_sled", block=0)
    e["anchor"] = [round(e["foot"][0] + 71, 1), round(e["foot"][1] - 93, 1)]


def stock(m):
    cv = Canvas(140, 100, foot=(70, 88))
    r = rng(1101)
    rows = [(4, 82, 0), (3, 66, 7), (2, 52, 14)]
    for n, y, off in rows:
        for k in range(n):
            x = 30 + off + k * 26
            shapes.log(cv, x, y - 2, x + 2, y, 11, 1101 + k + n * 10, snow=0.0, cut=False)
            d = sd_ellipse(cv.X, cv.Y, x + 1, y + 3, 10.5, 11)
            rr = np.sqrt(((cv.X - x - 1) / 10.5) ** 2 + ((cv.Y - y - 3) / 11) ** 2)
            cv.part(d, colour_field(cv, "wood_cut", "wood", 0.3 + 0.5 * (0.5 + 0.5 * np.sin(rr * 15)) * 0.4 + rr * 0.3),
                    round_=2, elev=np.full_like(cv.X, 88 - y + 10.0), cast=0.35)
    cv.part(sd_ellipse(cv.X, cv.Y, 72, 48, 30, 8) + (cv.noise(3, 1120, 2) - 0.5) * 4, rgb("snow_hi"), round_=4,
            elev=np.full_like(cv.X, 50.0), spec=0.4, cast=0.3)
    emit_sprite(m, "stock.wood", cv, "buildings/camp/stock_wood")
    cv = Canvas(130, 90, foot=(65, 78))
    pts = [(65 + (r.random() - 0.5) * 80, 78 - r.random() * 24) for _ in range(12)]
    pts.sort(key=lambda p: p[1])
    for k, (x, y) in enumerate(pts):
        s = 18 + r.random() * 10
        shapes.rock(cv, x, y, s * 1.2, s * 0.8, 1130 + k, snow=0.35, facets=5, tone=(r.random() - 0.5) * 0.1)
    emit_sprite(m, "stock.stone", cv, "buildings/camp/stock_stone")


def build(only=None):
    m = Manifest("buildings")
    for fn in (hut, palisade, bench, firepit, bunk, upgrades, torch_and_snare, sled, stock):
        if not only or fn.__name__ in only:
            fn(m)
    # a partial run (for iterating on one painter) leaves the manifest alone
    return (m.write() if not only else "(manifest not written)"), m


if __name__ == "__main__":
    path, m = build(sys.argv[1:])
    print(path, len(m.items), "sprites")
