"""Долгая зима on Godot — the environment sprites (trees, rocks, bushes, scrap, snow, ice, ground details).

    python3 tools/winter-godot/art/environment.py      → godot/winter/assets/environment/**, manifest/environment.json
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from paint import (Canvas, Manifest, blur, colour_field, emit_sprite, mix, rgb, rng, sd_box, sd_ellipse,  # noqa: E402
                   sd_poly, sd_segment, smin, smoothstep)
import shapes  # noqa: E402


def canvas(w, h, fx=None, fy=None):
    return Canvas(w, h, foot=(w / 2 if fx is None else fx, h - 8 if fy is None else fy))


# ───────────── trees ─────────────
def trees(m):
    # young, middle, tall; each its own seed, tier count and lean
    specs = [(150, 108, 3, 4), (165, 116, 11, 4), (200, 146, 21, 5), (212, 150, 29, 5), (250, 182, 37, 6),
             (262, 176, 45, 6)]
    for i, (h, w, seed, tiers) in enumerate(specs):
        cv = canvas(w + 36, h + 26)
        lean = (rng(seed).random() - 0.5) * 0.6
        shapes.pine(cv, cv.foot[0], cv.foot[1], h, w, seed, tiers=tiers, lean=lean, dark=(i % 2) * 0.06)
        emit_sprite(m, f"tree.pine.{i}", cv, f"environment/trees/pine_{i}", block=1)
    for i in range(3):
        cv = canvas(110, 96)
        shapes.stump(cv, 55, 80, 20 + i * 3, 101 + i)
        emit_sprite(m, f"tree.stump.{i}", cv, f"environment/trees/stump_{i}", block=1)
    for i in range(3):
        h = 190 + i * 24
        cv = canvas(190, h + 24)
        shapes.dead_tree(cv, 95, cv.foot[1], h, 201 + i * 7)
        emit_sprite(m, f"tree.dead.{i}", cv, f"environment/trees/dead_{i}")
    for i in range(2):
        cv = canvas(240, 110, 120, 90)
        r = rng(301 + i)
        x0, x1 = 22, 218
        y0, y1 = 78 - i * 14, 84 + i * 8
        # broken branch stubs first (behind), then the trunk, then a cut root plate on one end
        for k in range(4):
            bx = x0 + 40 + k * 38
            by = y0 + (y1 - y0) * (bx - x0) / (x1 - x0)
            cv.part(sd_segment(cv.X, cv.Y, bx, by - 8, bx + (r.random() - 0.3) * 18, by - 16 - r.random() * 6, (4.5, 2.2)),
                    rgb("bark"), round_=2, elev=np.full_like(cv.X, 20.0), snow=0.6, snow_seed=k)
        shapes.log(cv, x0, y0, x1, y1, 13 - i, 303 + i, cut=True)
        root = sd_ellipse(cv.X, cv.Y, x0 + 4, y0 - 4, 14, 26) + (cv.noise(3, 77 + i, 2) - 0.5) * 8
        cv.part(root, colour_field(cv, "earth", "bark_dark", cv.noise(3, 5, 2)), round_=6,
                elev=np.full_like(cv.X, 24.0), snow=0.8, snow_seed=9)
        emit_sprite(m, f"tree.fallen.{i}", cv, f"environment/trees/fallen_{i}", squash=0.5)
    for i in range(2):
        cv = canvas(130, 70, 65, 54)
        shapes.log(cv, 18, 48 - i * 6, 112, 50 + i * 4, 11 - i * 2, 311 + i)
        emit_sprite(m, f"log.{i}", cv, f"environment/resources/log_{i}", squash=0.5)
    for i in range(4):
        cv = canvas(100, 56, 50, 40)
        r = rng(401 + i)
        ang = (r.random() - 0.5) * 0.7
        L = 36 + r.random() * 14
        ax, ay = 50 - math.cos(ang) * L, 34 - math.sin(ang) * L * 0.4
        bx, by = 50 + math.cos(ang) * L, 34 + math.sin(ang) * L * 0.4
        d = sd_segment(cv.X, cv.Y, ax, ay, bx, by, (3.2, 1.4))
        for k in range(3):
            t = 0.25 + k * 0.25
            px, py = ax + (bx - ax) * t, ay + (by - ay) * t
            d = np.minimum(d, sd_segment(cv.X, cv.Y, px, py, px + 6 + r.random() * 8, py - 8 - r.random() * 6, (1.6, 0.6)))
        cv.part(d, colour_field(cv, "twig", "bark_dark", cv.noise(3, i, 2)), round_=1.5, elev=np.full_like(cv.X, 3.0),
                snow=0.5, snow_seed=i)
        emit_sprite(m, f"branch.{i}", cv, f"environment/resources/branch_{i}", shadow_strength=0.3, shadow_soft=1.5)


# ───────────── rocks ─────────────
def rocks(m):
    for i in range(4):
        r = rng(501 + i)
        w, h = 84 + r.random() * 18, 60 + r.random() * 16
        cv = canvas(int(w + 30), int(h + 40))
        shapes.rock(cv, cv.foot[0], cv.foot[1], w, h, 501 + i, moss=0.25 * (i % 2), tone=(i - 1.5) * 0.04)
        emit_sprite(m, f"rock.{i}", cv, f"environment/rocks/rock_{i}", block=1)
    for i in range(2):
        cv = canvas(120, 80)
        r = rng(601 + i)
        for k in range(6):
            x = 26 + r.random() * 68
            y = cv.foot[1] - 4 - r.random() * 22
            s = 14 + r.random() * 14
            shapes.rock(cv, x, y, s, s * 0.7, 601 + i * 10 + k, snow=0.5, facets=5)
        emit_sprite(m, f"rock.rubble.{i}", cv, f"environment/rocks/rubble_{i}")
    for i in range(3):
        s = 30 + i * 8
        cv = canvas(s + 24, int(s * 0.8 + 24))
        shapes.rock(cv, cv.foot[0], cv.foot[1], s, s * 0.72, 701 + i, facets=6)
        emit_sprite(m, f"rock.small.{i}", cv, f"environment/rocks/small_{i}")
    for i in range(2):
        cv = canvas(170, 110)
        r = rng(801 + i)
        parts = [(40, 92, 52, 40), (95, 98, 70, 54), (138, 90, 40, 32)] if i == 0 else \
            [(52, 96, 66, 50), (112, 92, 44, 36), (82, 104, 30, 22)]
        parts.sort(key=lambda p: p[1])
        for k, (x, y, w, h) in enumerate(parts):
            shapes.rock(cv, x, y, w, h, 801 + i * 10 + k, moss=0.2 * k % 2)
        cv.foot = (85, 100)
        emit_sprite(m, f"rock.group.{i}", cv, f"environment/rocks/group_{i}")


# ───────────── bushes ─────────────
def bushes(m):
    for i in range(3):
        r = rng(901 + i)
        w, h = 80 + r.random() * 20, 60 + r.random() * 14
        cv = canvas(int(w + 30), int(h + 34))
        shapes.bush(cv, cv.foot[0], cv.foot[1], w, h, 901 + i, berries=11 + i * 2)
        emit_sprite(m, f"bush.berry.{i}", cv, f"environment/bushes/berry_{i}", block=1)
        cv = canvas(int(w + 30), int(h + 34))
        shapes.bush(cv, cv.foot[0], cv.foot[1], w, h, 951 + i, bare=True)
        emit_sprite(m, f"bush.bare.{i}", cv, f"environment/bushes/bare_{i}", block=1)
        cv = canvas(int(w + 30), int(h + 34))
        shapes.bush(cv, cv.foot[0], cv.foot[1], w * 0.95, h * 0.9, 981 + i, berries=0, snow=1.4)
        emit_sprite(m, f"bush.snow.{i}", cv, f"environment/bushes/snow_{i}")


# ───────────── scrap metal ─────────────
def metal(cv, d, seed, rust=0.5, round_=2.5, elev=None):
    n = cv.noise(4, seed, 3)
    t = smoothstep(0.45 - rust * 0.3, 0.7 - rust * 0.3, n)
    alb = colour_field(cv, "iron", "rust", t) * (0.85 + cv.noise(2.5, seed + 1, 2)[..., None] * 0.25)
    cv.part(d, alb, round_=round_, spec=0.6 * (1 - t), snow=0.7, snow_seed=seed, snow_thick=1.5, elev=elev, cast=0.4)


def snow_skirt(cv, cx, cy, w, h, seed):
    d = sd_ellipse(cv.X, cv.Y, cx, cy, w, h) + (cv.noise(7, seed, 2) - 0.5) * 7
    shapes_bulge = blur(np.sqrt(np.clip(-d / (h * 1.2), 0, 1)) * h * 0.8, 2 * cv.ss)
    cv.part(d, colour_field(cv, "snow_hi", "snow_mid", np.clip((cv.Y - cy) / h * 0.5 + 0.3, 0, 1)),
            bulge=shapes_bulge, spec=0.35, elev=np.clip(-d, 0, None) * 0.3, cast=0.25)


def scrap(m):
    # 0: a broken sled — a curved iron runner and two wooden slats
    cv = canvas(140, 96, 70, 82)
    X, Y = cv.X, cv.Y
    for k, x in enumerate((44, 76)):
        d = sd_box(X, Y, x, 54, 9, 26, 3) + (cv.noise(3, 30 + k, 2) - 0.5) * 2
        cv.part(d, colour_field(cv, "wood_grey", "wood_dark", cv.noise(3, 20 + k, 2)), round_=3, snow=0.8, snow_seed=k,
                elev=np.full_like(X, 14.0))
    t = np.linspace(0, 1, 60)
    run = None
    for a, b in zip(t[:-1], t[1:]):
        x0, y0 = 22 + a * 100, 76 - 30 * max(0, 0.25 - a) * 4
        x1, y1 = 22 + b * 100, 76 - 30 * max(0, 0.25 - b) * 4
        s = sd_segment(X, Y, x0, y0, x1, y1, 3.2)
        run = s if run is None else np.minimum(run, s)
    metal(cv, run, 31, rust=0.6, elev=np.full_like(X, 10.0))
    snow_skirt(cv, 70, 82, 52, 9, 33)
    emit_sprite(m, "scrap.0", cv, "environment/resources/scrap_0", block=1)
    # 1: a cart wheel half buried — iron rim, spokes, hub
    cv = canvas(120, 110, 60, 96)
    X, Y = cv.X, cv.Y
    cx, cy, R = 60, 60, 38
    rim = np.abs(sd_ellipse(X, Y, cx, cy, R, R * 0.92)) - 4.0
    spokes = None
    for k in range(8):
        a = k * math.pi / 4 + 0.2
        s = sd_segment(X, Y, cx, cy, cx + math.cos(a) * R * 0.95, cy + math.sin(a) * R * 0.88, 2.6)
        spokes = s if spokes is None else np.minimum(spokes, s)
    cv.part(spokes, colour_field(cv, "wood", "wood_dark", cv.noise(3, 41, 2)), round_=2, elev=np.full_like(X, 30.0))
    hub = sd_ellipse(X, Y, cx, cy, 9, 9)
    metal(cv, hub, 42, rust=0.4, round_=6, elev=np.full_like(X, 30.0))
    metal(cv, rim, 43, rust=0.7, round_=3, elev=np.full_like(X, 30.0))
    snow_skirt(cv, 60, 92, 52, 14, 44)
    emit_sprite(m, "scrap.1", cv, "environment/resources/scrap_1", block=1)
    # 2: a crushed barrel — hoops and broken staves
    cv = canvas(120, 100, 60, 86)
    X, Y = cv.X, cv.Y
    r = rng(51)
    for k in range(7):
        x = 30 + k * 10
        top = 34 + r.random() * 18
        d = sd_box(X, Y, x, (top + 80) / 2, 4.6, (80 - top) / 2, 2)
        cv.part(d, colour_field(cv, "wood_hi", "wood_dark", 0.3 + cv.noise(2, 50 + k, 2) * 0.5), round_=3,
                elev=np.full_like(X, 20.0), snow=0.6, snow_seed=k)
    for yy in (46, 70):
        hoop = np.abs(sd_ellipse(X, Y, 60, yy, 38, 8)) - 2.4
        hoop = np.maximum(hoop, -(Y - yy))  # only the front half shows
        metal(cv, hoop, 52 + yy, rust=0.8, round_=2, elev=np.full_like(X, 20.0))
    snow_skirt(cv, 60, 86, 50, 12, 55)
    emit_sprite(m, "scrap.2", cv, "environment/resources/scrap_2", block=1)


# ───────────── snow and ice ─────────────
def snow_forms(m):
    for i in range(3):
        r = rng(1101 + i)
        w, h = 150 + r.random() * 40, 52 + r.random() * 22
        cv = canvas(int(w + 90), int(h + 80), fy=int(h + 80) - 34)
        shapes.snow_mound(cv, cv.foot[0], cv.foot[1], w, h, 1101 + i)
        emit_sprite(m, f"snow.hill.{i}", cv, f"environment/snow/hill_{i}", shadow=False)
    for i in range(3):
        cv = canvas(170, 150, 85, 128)
        X, Y = cv.X, cv.Y
        fx, fy = cv.foot
        # a drift: a long wind-carved wave whose crest leans left (the wind blows from the west)
        r = rng(1201 + i)
        base = sd_ellipse(X, Y, fx, fy - 24, 60, 26)
        crest = sd_segment(X, Y, fx - 40, fy - 44 - r.random() * 8, fx + 36, fy - 52 - i * 6, (16, 11))
        d = smin(base, crest, 16)
        d = np.maximum(d, Y - fy) + (cv.noise(9, 1201 + i, 2) - 0.5) * 5
        inside = np.clip(-d, 0, None)
        bulge = blur(np.sqrt(np.clip(inside / 34, 0, 1)) * 52, 3 * cv.ss)
        bulge = bulge + (cv.noise(12, 1210 + i, 2) - 0.5) * 3
        alb = colour_field(cv, "snow_hi", "snow_shade", np.clip(0.05 + (Y - fy + 80) / 110 * 0.5, 0, 1))
        cv.part(d, alb, bulge=bulge, spec=0.4, cast=0.0, soft=10)
        emit_sprite(m, f"snow.drift.{i}", cv, f"environment/snow/drift_{i}", block=1, shadow_strength=0.2,
                    shadow_soft=7, squash=0.6)
    for i in range(3):
        cv = canvas(120, 120)
        r = rng(1301 + i)
        shards = [(60 + (r.random() - 0.5) * 70, 108 - r.random() * 14, 10 + r.random() * 12, 40 + r.random() * 55,
                   (r.random() - 0.5) * 22) for _ in range(5 + i)]
        shards.sort(key=lambda s: s[1])
        snow_skirt(cv, 60, 106, 48, 10, 1300 + i)
        for k, (x, fy, w, h, lean) in enumerate(shards):
            shapes.ice_shard(cv, x, fy, w, h, lean, 1301 + i * 10 + k)
        cv.foot = (60, 108)
        emit_sprite(m, f"ice.formation.{i}", cv, f"environment/snow/ice_{i}")
    # the fishing hole: a dark round of water in a ring of broken ice (a ground detail, no shadow)
    cv = canvas(112, 76, 56, 54)
    X, Y = cv.X, cv.Y
    ring = sd_ellipse(X, Y, 56, 38, 46, 28) + (cv.noise(3, 1401, 2) - 0.5) * 6
    cv.part(ring, colour_field(cv, "ice_hi", "ice", cv.noise(4, 1402, 2)), bulge=np.clip(-ring, 0, 8) * 0.6,
            spec=0.8, elev=np.zeros_like(X), cast=0)
    water = sd_ellipse(X, Y, 56, 38, 28, 16) + (cv.noise(2.5, 1403, 2) - 0.5) * 4
    cv.part(water, colour_field(cv, "water", "#0c1e38", np.clip((Y - 24) / 30, 0, 1)),
            bulge=-np.clip(-water, 0, 6), spec=1.0, elev=np.zeros_like(X), cast=0)
    # a thin bright rim of wet ice and a glint
    cv.part(np.abs(water) - 1.2, rgb("ice_hi"), unlit=True, opacity=0.6, elev=np.zeros_like(X), cast=0)
    for k in range(5):
        a = k * 1.3 + 0.4
        cv.part(sd_segment(X, Y, 56 + math.cos(a) * 30, 38 + math.sin(a) * 18, 56 + math.cos(a) * 46, 38 + math.sin(a) * 28,
                           0.7), rgb("ice_deep"), unlit=True, opacity=0.5, elev=np.zeros_like(X), cast=0)
    emit_sprite(m, "ice.hole", cv, "environment/snow/ice_hole", shadow=False)


# ───────────── ground details (decals) ─────────────
def decal_depression(cv, d, depth, col="snow_shade", opacity=0.75):
    inside = np.clip(-d, 0, None)
    bulge = -np.sqrt(np.clip(inside / max(1, depth), 0, 1)) * depth
    cv.part(d, rgb(col), bulge=bulge, elev=np.zeros_like(cv.X), cast=0, opacity=opacity)


def ground(m):
    for i in range(3):
        cv = canvas(140, 90, 70, 60)
        X, Y = cv.X, cv.Y
        d = sd_ellipse(X, Y, 70, 46, 56, 28) + (cv.noise(9, 1501 + i, 3) - 0.5) * 30
        soil = colour_field(cv, "earth_hi", "earth_dark", cv.noise(4, 1502 + i, 3))
        cv.part(d, soil, round_=4, elev=np.zeros_like(X), cast=0, opacity=0.95)
        # dry grass tufts poking through and pebbles
        r = rng(1503 + i)
        for k in range(14):
            px, py = 70 + (r.random() - 0.5) * 100, 46 + (r.random() - 0.5) * 46
            if sd_ellipse(np.array([[px]]), np.array([[py]]), 70, 46, 56, 28)[0, 0] > 0:
                continue
            for b in range(4):
                a = -math.pi / 2 + (b - 1.5) * 0.35 + (r.random() - 0.5) * 0.2
                L = 8 + r.random() * 7
                cv.part(sd_segment(X, Y, px, py, px + math.cos(a) * L, py + math.sin(a) * L, (1.3, 0.3)),
                        mix("#b9a26a", "#7d6a45", r.random()), round_=1, elev=np.full_like(X, 6.0), cast=0.3)
        for k in range(6):
            px, py = 70 + (r.random() - 0.5) * 80, 46 + (r.random() - 0.5) * 34
            pr = 2.5 + r.random() * 3
            cv.part(sd_ellipse(X, Y, px, py, pr * 1.3, pr), rgb("stone"), round_=pr, elev=np.full_like(X, 2.0), cast=0.3)
        # a soft snow fringe over the patch's edge
        fr = np.abs(d) - 3 + (cv.noise(2.5, 1504 + i, 2) - 0.5) * 6
        cv.part(np.maximum(fr, d - 2), rgb("snow"), round_=2, elev=np.zeros_like(X), cast=0.2, opacity=0.9)
        emit_sprite(m, f"ground.patch.{i}", cv, f"environment/ground/patch_{i}", shadow=False)
    # tracks: soft dents in the snow along a gently curving line
    def tracks(key, rel, seed, print_fn, n, step, w=200, h=70):
        cv = canvas(w, h, w / 2, h / 2)
        r = rng(seed)
        for k in range(n):
            t = k / max(1, n - 1)
            x = 16 + t * (w - 32)
            y = h / 2 + math.sin(t * 3 + seed) * 8
            print_fn(cv, x, y, k, r)
        emit_sprite(m, key, cv, rel, shadow=False)

    def rabbit(cv, x, y, k, r):
        # two long hind prints side by side, two small fore prints behind them
        for dx, dy, rx, ry in ((0, -5, 4, 2.3), (0, 5, 4, 2.3), (-11, -1.5, 2.2, 2), (-17, 1.5, 2.2, 2)):
            decal_depression(cv, sd_ellipse(cv.X, cv.Y, x + dx, y + dy, rx * 1.4, ry * 1.2), 2.5)

    def deer(cv, x, y, k, r):
        side = 5 if k % 2 else -5
        for dx in (-2.5, 2.5):
            decal_depression(cv, sd_ellipse(cv.X, cv.Y, x + dx * 0.5, y + side + dx * 0.15, 2.4, 3.6), 3.0)

    def wolf(cv, x, y, k, r):
        side = 5 if k % 2 else -5
        cx, cy = x, y + side
        decal_depression(cv, sd_ellipse(cv.X, cv.Y, cx, cy + 1, 3.6, 3.2), 2.5)
        for a in (-0.9, -0.3, 0.3, 0.9):
            decal_depression(cv, sd_ellipse(cv.X, cv.Y, cx + 5 + abs(a) * -1.5, cy + a * 4.2, 1.6, 1.4), 1.8)

    tracks("track.rabbit.0", "environment/ground/track_rabbit_0", 1601, rabbit, 5, 1)
    tracks("track.rabbit.1", "environment/ground/track_rabbit_1", 1602, rabbit, 4, 1, w=170)
    tracks("track.deer.0", "environment/ground/track_deer_0", 1603, deer, 8, 1)
    tracks("track.wolf.0", "environment/ground/track_wolf_0", 1604, wolf, 8, 1)
    for side, key in ((-1, "foot.boot.l"), (1, "foot.boot.r")):
        cv = canvas(30, 22, 15, 11)
        X, Y = cv.X, cv.Y
        # a boot print pointing right (the game rotates it along the walk)
        sole = sd_ellipse(X, Y, 17, 11, 8, 5)
        heel = sd_ellipse(X, Y, 6, 11 + side * 0.6, 4.2, 3.8)
        decal_depression(cv, np.minimum(sole, heel), 3.0, opacity=0.8)
        emit_sprite(m, key, cv, f"environment/ground/boot_{'l' if side < 0 else 'r'}", shadow=False)
    cv = canvas(16, 16, 8, 8)
    X, Y = cv.X, cv.Y
    star = np.minimum(np.maximum(np.abs(X - 8) - 0.7, np.abs(Y - 8) - 6), np.maximum(np.abs(Y - 8) - 0.7, np.abs(X - 8) - 6))
    star = np.minimum(star, sd_ellipse(X, Y, 8, 8, 1.8, 1.8))
    cv.part(star, rgb("#ffffff"), unlit=True, elev=np.zeros_like(X), cast=0)
    emit_sprite(m, "snow.sparkle", cv, "environment/snow/sparkle", shadow=False, normal=False)


def build(only=None):
    m = Manifest("environment")
    for fn in (trees, rocks, bushes, scrap, snow_forms, ground):
        if not only or fn.__name__ in only:
            fn(m)
    # a partial run (for iterating on one painter) leaves the manifest alone
    return (m.write() if not only else "(manifest not written)"), m


if __name__ == "__main__":
    path, m = build(sys.argv[1:])
    print(path, len(m.items), "sprites")
