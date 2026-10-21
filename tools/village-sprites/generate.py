#!/usr/bin/env python3
"""Родник — offline generator of the painted sprites in web/village/sprites/.

The game draws everything with Canvas 2D at runtime; this script bakes the plants, stones and the grass
texture once, with work the browser can't afford every frame: a height field per sprite, per-pixel normals
lit from the top left (the same light as web/fx.js), ambient occlusion in the crevices, leaf and needle relief,
colour ramps from the season palettes and 2x supersampled edges.

    python3 tools/village-sprites/generate.py

Needs numpy and Pillow. Colours come from web/village/view.js (SEASON_LOOKS) through node, so the sprites
always match the code art they replace. Writes PNGs plus sprites.json (the manifest art.js reads): for every
sprite its file, world size and anchor (the node's foot) and the palette colour it was painted for.
An artist can replace any PNG with a hand-painted one of the same size and anchor; nothing else changes.
"""
import json
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'web', 'village', 'sprites')
SCALE = 3          # PNG px per world px (art.js rasters at most 2.5)
SS = 2             # supersampling: painted at SCALE * SS, then downsampled
PX = SCALE * SS    # working px per world px
LIGHT = np.array([-0.5, -0.72, 0.62])
LIGHT = LIGHT / np.linalg.norm(LIGHT)


def palettes():
    js = "const VV = require('./web/village/view.js'); process.stdout.write(JSON.stringify(VV.SEASON_LOOKS));"
    return json.loads(subprocess.check_output(['node', '-e', js], cwd=ROOT))


def rgb(c):
    c = c.lstrip('#')
    return np.array([int(c[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def mix(a, b, t):
    return a + (b - a) * t


def ramp(v, stops):
    """Map values 0..1 through colour stops [(pos, rgb), ...] → H×W×3."""
    v = np.clip(v, 0, 1)
    out = np.zeros(v.shape + (3,))
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        m = (v >= p0) & (v <= p1)
        t = ((v - p0) / max(p1 - p0, 1e-9))[m][:, None]
        out[m] = c0 + (c1 - c0) * t
    return out


def blur(a, r):
    """Box blur of radius r px (two passes ≈ gaussian), edges clamped."""
    r = int(max(1, r))
    for _ in range(2):
        for ax in (0, 1):
            pad = [(0, 0), (0, 0)]
            pad[ax] = (r + 1, r)
            p = np.pad(a, pad, mode='edge')
            c = np.cumsum(p, axis=ax)
            if ax == 0:
                a = (c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)
            else:
                a = (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
    return a


def dilate(mask, r):
    """Grow a mask by r px (no wrapping around the image edges)."""
    h, w = mask.shape
    p = np.pad(mask, r)
    out = np.zeros_like(mask)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r:
                out |= p[r + dy:r + dy + h, r + dx:r + dx + w]
    return out


def value_noise(h, w, cell, rng, wrap=False):
    """Smooth noise 0..1 of size h×w with features about `cell` px; seamless when wrap."""
    gh, gw = max(2, int(math.ceil(h / cell)) + 1), max(2, int(math.ceil(w / cell)) + 1)
    if wrap:
        gh, gw = max(2, round(h / cell)), max(2, round(w / cell))
        g = rng.random((gh, gw))
        big = np.tile(g, (3, 3))
        img = Image.fromarray((big * 255).astype(np.uint8)).resize((gw * 3 * cell, gh * 3 * cell), Image.BICUBIC)
        a = np.asarray(img, dtype=np.float64)[gh * cell:2 * gh * cell, gw * cell:2 * gw * cell] / 255
        return np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float64) / 255
    g = rng.random((gh, gw))
    img = Image.fromarray((g * 255).astype(np.uint8)).resize((gw * cell, gh * cell), Image.BICUBIC)
    return np.asarray(img, dtype=np.float64)[:h, :w] / 255


class Canvas:
    """A world-space box [x0, x1] × [y0, y1] (world px, y down, the foot at 0, 0) painted at PX px a world px."""

    def __init__(self, x0, y0, x1, y1):
        self.x0, self.y0 = x0, y0
        self.w, self.h = int(round((x1 - x0) * PX)), int(round((y1 - y0) * PX))
        ys, xs = np.mgrid[0:self.h, 0:self.w]
        self.X = x0 + (xs + 0.5) / PX
        self.Y = y0 + (ys + 0.5) / PX
        self.H = np.full((self.h, self.w), -1e9)   # height field (world px towards the viewer)
        self.id = np.full((self.h, self.w), -1, dtype=np.int32)
        self.tone = np.zeros((self.h, self.w))

    def sphere(self, cx, cy, r, z0, ident, tone, squash=1.0):
        i0, i1 = max(0, int((cy - r - self.y0) * PX) - 1), min(self.h, int((cy + r - self.y0) * PX) + 2)
        j0, j1 = max(0, int((cx - r - self.x0) * PX) - 1), min(self.w, int((cx + r - self.x0) * PX) + 2)
        if i0 >= i1 or j0 >= j1:
            return
        X, Y = self.X[i0:i1, j0:j1], self.Y[i0:i1, j0:j1]
        d2 = (X - cx) ** 2 + ((Y - cy) / squash) ** 2
        inside = d2 < r * r
        h = z0 + np.sqrt(np.clip(r * r - d2, 0, None))
        H = self.H[i0:i1, j0:j1]
        win = inside & (h > H)
        H[win] = h[win]
        self.id[i0:i1, j0:j1][win] = ident
        self.tone[i0:i1, j0:j1][win] = tone

    def surface(self, x, y):
        i, j = int((y - self.y0) * PX), int((x - self.x0) * PX)
        if 0 <= i < self.h and 0 <= j < self.w and self.H[i, j] > -1e8:
            return self.H[i, j]
        return None

    def mask(self):
        return self.H > -1e8

    def normals(self, bump=None):
        H = np.where(self.mask(), self.H, np.nan)
        fill = np.nan_to_num(H, nan=np.nanmin(H) - 4 if np.isfinite(np.nanmin(H)) else 0)
        if bump is not None:
            fill = fill + bump
        gy, gx = np.gradient(fill * PX / PX, 1 / PX)
        n = np.dstack([-gx, -gy, np.ones_like(gx)])
        return n / np.linalg.norm(n, axis=2, keepdims=True), fill

    def image(self, color, alpha):
        """Downsample the supersampled RGB and alpha to a PNG-ready RGBA image."""
        a = np.clip(alpha, 0, 1)
        rgba = np.dstack([np.clip(color, 0, 255) * a[..., None], a * 255])  # premultiplied for clean edges
        img = Image.fromarray(rgba.astype(np.uint8), 'RGBA')
        img = img.resize((self.w // SS, self.h // SS), Image.LANCZOS)
        arr = np.asarray(img, dtype=np.float64)
        al = arr[..., 3:4] / 255
        arr[..., :3] = np.where(al > 0, arr[..., :3] / np.maximum(al, 1e-6), 0)
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')


def shade(cv, bump=None, ao_r=4, ao_k=0.09, height_dark=0.22):
    n, fill = cv.normals(bump)
    diffuse = np.clip((n * LIGHT).sum(axis=2), 0, 1)
    cav = blur(fill, ao_r * SS) - fill
    ao = np.clip(1 - np.clip(cav, 0, None) * ao_k, 0.45, 1)
    m = cv.mask()
    ys = cv.Y[m]
    top, bot = ys.min(), ys.max()
    low = np.clip((cv.Y - top) / max(bot - top, 1), 0, 1)
    return diffuse, ao, low, n


def leaf_ramp(pal, warm=0.45):
    dark, mid, lit = (rgb(c) for c in pal)
    return [(0.0, dark * 0.38), (0.28, dark * 0.8), (0.48, dark), (0.66, mid), (0.84, lit),
            (1.0, mix(lit, np.array([248, 246, 178.0]), warm))]


def foliage(cv, pal, rng, outline=True, macro=None):
    """Light the foliage and colour it with the palette ramp; returns (rgb, alpha). The light follows the big
    masses (`macro`, a canvas with only them, smoothed) so the crown reads as a few round lobes; the leaf
    clumps on top only add soft relief."""
    m = cv.mask()
    bump = (value_noise(cv.h, cv.w, 2 * SS, rng) - 0.5) * 0.5
    diffuse, ao, low, n = shade(cv, bump, ao_r=3, ao_k=0.045)
    if macro is not None:
        mh = np.where(macro.mask(), macro.H, np.nan)
        lo = np.nanmin(mh)
        mh = blur(np.nan_to_num(mh, nan=lo - 6), 3 * SS)
        gy, gx = np.gradient(mh, 1 / PX)
        nm = np.dstack([-gx, -gy, np.ones_like(gx)])
        nm /= np.linalg.norm(nm, axis=2, keepdims=True)
        nb = nm * 0.7 + n * 0.3
        nb /= np.linalg.norm(nb, axis=2, keepdims=True)
        diffuse = np.clip((nb * LIGHT).sum(axis=2), 0, 1)
    jitter = rng.uniform(-0.035, 0.035, size=cv.id.max() + 2)[cv.id + 1]
    v = 0.1 + 0.9 * diffuse * ao * (1 - 0.25 * low) + cv.tone * 0.04 + jitter
    col = ramp(v, leaf_ramp(pal))
    # Rim of sky light on the far (upper) edges and a soft warm bounce from the ground on the lower ones.
    edge = m & ~np.roll(m, 3 * SS, 0)
    col[edge] = mix(col[edge], rgb(pal[2]), 0.25)
    alpha = m.astype(np.float64)
    if outline:
        ring = dilate(m, int(1.2 * SS + 0.5)) & ~m
        col[ring] = rgb(pal[0]) * 0.3
        alpha[ring] = 0.95
    return col, alpha


def crown_canvas(layout, rng, shape, clumps=1.0):
    cv = Canvas(-35, -82, 35, -4)
    macro = Canvas(-35, -82, 35, -4)
    flip = -1 if shape % 2 else 1
    size = [0.92, 1.0, 1.08][shape % 3]
    ident = 0
    balls = []
    for dx, dy, r, tone in layout:
        x = dx * size * flip + rng.uniform(-2, 2)
        y = dy * size - 4 * (1 - size) + rng.uniform(-1.5, 1.5)
        rr = r * size * rng.uniform(0.94, 1.06)
        balls.append((x, y, rr, tone))
    # Big masses of foliage, each lifted towards the viewer by how high it sits in the crown.
    for x, y, r, tone in balls:
        cv.sphere(x, y, r, tone * 3 - y * 0.12, ident, tone)
        macro.sphere(x, y, r * 1.05, tone * 3 - y * 0.12, ident, tone)
        ident += 1
    # Leaf clumps on the surface of each mass.
    for x, y, r, tone in balls:
        k = int(r * 1.3 * clumps)
        for _ in range(k):
            a, d = rng.uniform(0, 2 * math.pi), r * math.sqrt(rng.uniform(0, 0.92))
            px, py = x + math.cos(a) * d, y + math.sin(a) * d
            z = cv.surface(px, py)
            if z is None:
                continue
            rc = rng.uniform(3.4, 5.6) * (r / 12) ** 0.4
            cv.sphere(px, py, rc, z - rc * 0.45, ident, tone)
            ident += 1
    return cv, macro


CROWN = [
    (-12, -27, 12, 0), (12, -27, 12, 0), (0, -23, 13, 0), (-18, -37, 10, 0), (18, -37, 10, 0),
    (-8, -38, 13, 1), (9, -40, 12.5, 1), (0, -31, 13, 1), (-15, -31, 9, 1), (15, -32, 9, 1),
    (-6, -49, 10, 2), (6, -51, 9, 2), (-13, -44, 7, 2), (2, -42, 9, 2),
]
BUSH = [(-9, -8, 8.5, 0), (9, -8, 8.5, 0), (0, -6, 9.5, 0), (-5, -15, 8.5, 1), (6, -15, 8, 1), (-11, -14, 5.5, 1), (0, -20, 6.5, 2), (-6, -21, 4, 2)]
SHRUB = [(-7, -5, 6, 0), (6, -5, 6.5, 0), (0, -4, 7, 0), (-3, -10, 6, 1), (4, -10, 5.5, 1)]


def crown(pal, shape, seed):
    rng = np.random.default_rng(seed)
    cv, macro = crown_canvas(CROWN, rng, shape)
    col, alpha = foliage(cv, pal, rng, macro=macro)
    return cv.image(col, alpha), cv


def bush(pal, shape, seed, layout=BUSH, box=(-23, -32, 23, 2), scale=1.0):
    rng = np.random.default_rng(seed)
    cv = Canvas(*box)
    macro = Canvas(*box)
    flip = -1 if shape % 2 else 1
    ident = 0
    balls = [(dx * scale * flip + rng.uniform(-1, 1), dy * scale + rng.uniform(-0.8, 0.8), r * scale * rng.uniform(0.92, 1.08), t) for dx, dy, r, t in layout]
    for x, y, r, t in balls:
        cv.sphere(x, y, r, t * 2 - y * 0.1, ident, t)
        macro.sphere(x, y, r * 1.05, t * 2 - y * 0.1, ident, t)
        ident += 1
    for x, y, r, t in balls:
        for _ in range(int(r * 1.5)):
            a, d = rng.uniform(0, 2 * math.pi), r * math.sqrt(rng.uniform(0, 0.9))
            px, py = x + math.cos(a) * d, y + math.sin(a) * d
            z = cv.surface(px, py)
            if z is None:
                continue
            rc = rng.uniform(2.4, 3.8)
            cv.sphere(px, py, rc, z - rc * 0.5, ident, t)
            ident += 1
    col, alpha = foliage(cv, pal, rng, macro=macro)
    return cv.image(col, alpha)


def pine(shape, snow, seed):
    rng = np.random.default_rng(seed)
    cv = Canvas(-24, -74, 24, -2)
    s = [0.94, 1.0, 1.06][shape]
    tiers = [(18, -6, -28), (15.5, -18, -40), (12.5, -30, -52), (8.5, -42, -64)]
    X, Y = cv.X, cv.Y
    needles = value_noise(cv.h, cv.w, int(1.2 * PX), rng)
    for i, (w, b, top) in enumerate(tiers):
        w, b, top = w * s, b * s, top * s
        half = w * np.clip((Y - top) / (b - top), 0, None)
        # A ragged lower edge: teeth of needles hang below the tier's line.
        teeth = 2.6 * (np.abs(np.sin(X * 0.62 + i * 1.7 + shape)) ** 0.6) + (needles - 0.5) * 2.5
        inside = (Y >= top) & (Y <= b + teeth) & (np.abs(X) <= half + (needles - 0.5) * 2)
        h = (half - np.abs(X)) * 0.9 + i * 7 + 3 - np.clip(Y - b, 0, None) * 1.5
        win = inside & (h > cv.H)
        cv.H[win] = h[win]
        cv.id[win] = i
        cv.tone[win] = i / 3
    # Needle relief: fine streaks running down and out from the axis.
    ang = np.arctan2(np.abs(X), 1.0)
    streak = np.sin((Y * 1.8 - np.abs(X) * 1.1) * 2.2 + needles * 6) * 0.35
    bump = streak + (value_noise(cv.h, cv.w, SS * 2, rng) - 0.5) * 0.8
    diffuse, ao, low, n = shade(cv, bump, ao_r=3, ao_k=0.12)
    m = cv.mask()
    v = 0.1 + 0.86 * diffuse * ao * (1 - 0.2 * low) + cv.tone * 0.04
    pal = ['#24482c', '#356640', '#5a8f58']
    col = ramp(v, leaf_ramp(pal, warm=0.25))
    if snow:
        up = (n[..., 1] < -0.25) & (needles > 0.35) & m
        col[up] = mix(col[up], np.array([244, 248, 251.0]), 0.92)
    ring = dilate(m, int(1.2 * SS + 0.5)) & ~m
    alpha = m.astype(np.float64)
    col[ring] = rgb(pal[0]) * 0.3
    alpha[ring] = 0.95
    return cv.image(col, alpha)


def rock(shape, seed):
    rng = np.random.default_rng(seed)
    cv = Canvas(-23, -34, 23, 2)
    X, Y = cv.X, cv.Y
    big = value_noise(cv.h, cv.w, int(6 * PX), rng)
    mid = value_noise(cv.h, cv.w, int(2.5 * PX), rng)
    for (cx, cy, rx, ry, hz) in [(-1, -12.5, 15.6, 12, 14), (13, -4.5, 6.6, 4.8, 6)]:
        rx *= [1, 0.92, 1.06, 0.97][shape]
        d = ((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2
        rim = 1 + (big - 0.5) * 0.35 + (mid - 0.5) * 0.12
        inside = d < rim
        h = hz * np.sqrt(np.clip(1 - d / rim, 0, None)) ** 0.8
        # Chiselled facets: quantise the height a little, then smooth back.
        h = h + np.round(h / 3.2) * 0.9 + (mid - 0.5) * 2.4
        win = inside & (h > cv.H)
        cv.H[win] = h[win]
    m = cv.mask()
    diffuse, ao, low, n = shade(cv, (value_noise(cv.h, cv.w, SS * 2, rng) - 0.5) * 0.6, ao_r=3, ao_k=0.1)
    v = 0.12 + 0.86 * diffuse * ao * (1 - 0.3 * low)
    stops = [(0, rgb('#3e3c38')), (0.3, rgb('#6c6962')), (0.55, rgb('#9c988f')), (0.8, rgb('#c9c5bb')), (1, rgb('#efede6'))]
    col = ramp(v, stops)
    col *= (0.94 + mid[..., None] * 0.12)
    speck = rng.random(m.shape) < 0.012
    col[speck & m] *= 0.75
    if shape != 2:  # moss on the top
        moss = (n[..., 1] < -0.35) & (big > 0.5) & m
        col[moss] = mix(col[moss], ramp(v[moss] + 0.1, leaf_ramp(['#3f6f2a', '#5e9a3c', '#8fc35a']))[...], 0.85)
    ring = dilate(m, int(1.1 * SS + 0.5)) & ~m
    alpha = m.astype(np.float64)
    col[ring] = rgb('#2c2a26')
    alpha[ring] = 0.9
    return cv.image(col, alpha)


def trunk(pine_trunk, seed):
    rng = np.random.default_rng(seed)
    h_, rx = (10, 3) if pine_trunk else (22, 4)
    cv = Canvas(-9, -h_ - 3, 9, 4)
    X, Y = cv.X, cv.Y
    bark = value_noise(cv.h, cv.w, SS * 2, rng)
    flare = rx + np.clip(Y + 5, 0, None) * 0.55
    inside = (np.abs(X) <= flare) & (Y >= -h_) & (Y <= 1.5 - (np.abs(X) / (flare + 1e-6)) * 1.5)
    h = np.sqrt(np.clip(flare ** 2 - X ** 2, 0, None))
    cv.H[inside] = h[inside]
    bump = np.sin(X * 3.2 + bark * 4) * 0.25 + (bark - 0.5) * 0.4
    diffuse, ao, low, n = shade(cv, bump, ao_r=2, ao_k=0.1)
    v = 0.1 + 0.85 * diffuse * ao
    stops = [(0, rgb('#2e1d10')), (0.35, rgb('#5a3a20')), (0.6, rgb('#8b5e36')), (0.85, rgb('#b3834f')), (1, rgb('#d8b07a'))]
    col = ramp(v, stops)
    m = cv.mask()
    ring = dilate(m, int(SS)) & ~m
    alpha = m.astype(np.float64)
    col[ring] = rgb('#24160a')
    alpha[ring] = 0.9
    return cv.image(col, alpha)


def grass_texture(seed, size=128):
    """A seamless detail texture for the meadow (size world px square), grey around 128: painted over the
    grass colour with 'soft-light' it adds soft painterly variation without changing the season's colours.
    Made of many soft, slightly elongated dabs of lighter and darker value, like brush strokes, and a few
    tufts lit on their upper left; no fine per-pixel grain."""
    rng = np.random.default_rng(seed)
    n = size * SCALE
    V = np.zeros((n, n))
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float64)

    def dab(cx, cy, rx, ry, ang, val):
        r = int(max(rx, ry) * 1.2) + 2
        i0, j0 = int(cy) - r, int(cx) - r
        ii = (np.arange(i0, i0 + 2 * r) % n)[:, None]
        jj = (np.arange(j0, j0 + 2 * r) % n)[None, :]
        dy = (np.arange(i0, i0 + 2 * r) - cy)[:, None]
        dx = (np.arange(j0, j0 + 2 * r) - cx)[None, :]
        c, s_ = math.cos(ang), math.sin(ang)
        u, v = dx * c + dy * s_, -dx * s_ + dy * c
        f = np.exp(-((u / rx) ** 2 + (v / ry) ** 2) * 2.2)
        V[ii, jj] += f * val

    for _ in range(int(size * size * 0.035)):  # broad strokes
        dab(rng.uniform(0, n), rng.uniform(0, n), rng.uniform(5, 11) * SCALE, rng.uniform(2, 4) * SCALE,
            rng.normal(-0.3, 0.5), rng.normal(0, 0.18))
    for _ in range(int(size * size * 0.02)):   # tufts: a lit upper left, a shaded lower right
        cx, cy, r = rng.uniform(0, n), rng.uniform(0, n), rng.uniform(1.6, 3.2) * SCALE
        dab(cx - r * 0.3, cy - r * 0.35, r, r * 0.7, -0.5, 0.28)
        dab(cx + r * 0.35, cy + r * 0.4, r * 0.9, r * 0.5, -0.5, -0.22)
    V = blur(V, SCALE // 2 + 1)
    v = 0.5 + V
    g = np.clip(v, 0, 1) * 255
    return Image.fromarray(np.dstack([g, g, g]).astype(np.uint8), 'RGB')


# ───────────── Building materials ─────────────
# Seamless grey textures (mean ≈ 128) for the walls and roofs that houses.js draws: laid with 'overlay' over a
# face's own colour and light, they add tiles, straw, boards, bricks and stones without changing the colours.
MAT = 80  # world px square; every period below divides it


def wrap_noise(n, cx, cy, rng):
    """Seamless smooth noise n×n px with features about cx × cy px (anisotropic)."""
    gw, gh = max(2, round(n / cx)), max(2, round(n / cy))
    g = rng.random((gh, gw))
    big = np.tile(g, (3, 3))
    img = Image.fromarray((big * 255).astype(np.uint8)).resize((3 * n, 3 * n), Image.BICUBIC)
    return np.asarray(img, dtype=np.float64)[n:2 * n, n:2 * n] / 255


def lit_gray(H, albedo=None, k=1.0, ao_r=0, contrast=1.7):
    """Light a seamless height field (px units) from the top left; returns a grey PIL image around 128."""
    gx = (np.roll(H, -1, 1) - np.roll(H, 1, 1)) / 2 * k
    gy = (np.roll(H, -1, 0) - np.roll(H, 1, 0)) / 2 * k
    nn = np.dstack([-gx, -gy, np.ones_like(gx)])
    nn /= np.linalg.norm(nn, axis=2, keepdims=True)
    lit = np.clip((nn * LIGHT).sum(axis=2), 0, 1)
    v = 0.5 + (lit - lit.mean()) * contrast
    if ao_r:
        t = np.tile(H, (3, 3))
        cav = (blur(t, ao_r)[H.shape[0]:2 * H.shape[0], H.shape[1]:2 * H.shape[1]] - H)
        v -= np.clip(cav, 0, None) * 0.05
    if albedo is not None:
        v += albedo
    v = v - v.mean() + 0.5
    g = np.clip(v, 0, 1) * 255
    return Image.fromarray(g.astype(np.uint8), 'L')


def material(kind, seed):
    rng = np.random.default_rng(seed)
    S_ = SCALE
    n = MAT * S_
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float64)
    fine = wrap_noise(n, 2 * S_, 2 * S_, rng)
    alb = np.zeros((n, n))
    if kind == 'tile':      # clay roof tiles: barrel tiles in rows, each row's lip shading the next
        P, Wd = 5 * S_, 8 * S_
        row = np.floor(ys / P)
        u = ((xs + (row % 2) * Wd / 2) % Wd) / Wd
        v = (ys % P) / P
        H = v * 5 + np.sin(np.pi * u) * 3.2 + fine * 0.8
        tid = (row * 31 + np.floor((xs + (row % 2) * Wd / 2) / Wd)) % 97
        alb = (np.sin(tid * 12.9898) * 43758.5453 % 1 - 0.5) * 0.12
        return lit_gray(H, alb, k=1.0, ao_r=2)
    if kind == 'thatch':    # bundles of straw laid in courses
        P = 4 * S_
        v = (ys % P) / P
        strands = wrap_noise(n, 0.6 * S_, 7 * S_, rng)
        H = v * 3 + strands * 1.4 + fine * 0.5
        alb = (strands - 0.5) * 0.16
        return lit_gray(H, alb, k=1.0, ao_r=2, contrast=1.1)
    if kind == 'metal':     # standing-seam tin: ribs and soft dents
        Wd = 5 * S_
        u = (xs % Wd) / Wd
        H = np.exp(-((u - 0.05) / 0.06) ** 2) * 3 + wrap_noise(n, 9 * S_, 9 * S_, rng) * 1.5
        alb = (wrap_noise(n, 6 * S_, 6 * S_, rng) - 0.5) * 0.18
        return lit_gray(H, alb, k=1.0, contrast=1.3)
    if kind == 'plaster':   # whitewash over rough plaster, a few hairline cracks
        H = wrap_noise(n, 10 * S_, 10 * S_, rng) * 2.5 + fine * 0.9
        crack = np.zeros((n, n))
        for _ in range(3):
            x, y, a = rng.uniform(0, n), rng.uniform(0, n), rng.uniform(0, 2 * math.pi)
            for _ in range(int(9 * S_)):
                a += rng.normal(0, 0.35)
                x, y = (x + math.cos(a)) % n, (y + math.sin(a)) % n
                crack[int(y), int(x)] = 1
        crack = np.clip(blur(np.tile(crack, (3, 3)), 1)[n:2 * n, n:2 * n] * 2, 0, 1)
        H -= crack * 0.4
        alb = (wrap_noise(n, 14 * S_, 14 * S_, rng) - 0.5) * 0.14 - crack * 0.1
        return lit_gray(H, alb, k=1.0, contrast=1.2)
    if kind == 'planks':    # vertical boards with grain, dark gaps and a nail now and then
        Wd = 5 * S_
        board = np.floor(xs / Wd)
        u = (xs % Wd) / Wd
        grain = wrap_noise(n, 0.8 * S_, 12 * S_, rng)
        H = np.minimum(u, 1 - u).clip(0, 0.08) / 0.08 * 2 + grain * 0.9
        tone = (np.sin(board * 7.31) * 43758.5453 % 1 - 0.5) * 0.18
        alb = tone + (grain - 0.5) * 0.25 - (np.minimum(u, 1 - u) < 0.05) * 0.3
        return lit_gray(H, alb, k=1.0, contrast=1.4)
    if kind == 'brick':     # running bond, recessed mortar
        BW, BH = 8 * S_, 4 * S_
        row = np.floor(ys / BH)
        bx = (xs + (row % 2) * BW / 2) % BW
        by = ys % BH
        m = 0.7 * S_
        edge = np.minimum(np.minimum(bx, BW - bx), np.minimum(by, BH - by))
        H = np.clip(edge / m, 0, 1) * 2.4 + fine * 0.7
        bid = row * 13 + np.floor((xs + (row % 2) * BW / 2) / BW)
        alb = (np.sin(bid * 4.123) * 43758.5453 % 1 - 0.5) * 0.22 - (edge < m) * 0.18
        return lit_gray(H, alb, k=1.0, ao_r=1, contrast=1.4)
    # 'stone': rough fieldstones in mortar (a seamless Voronoi of jittered points)
    cell = 9 * S_
    k_ = n // cell
    pts = []
    for i in range(k_):
        for j in range(k_):
            pts.append(((j + rng.uniform(0.2, 0.8)) * cell, (i + rng.uniform(0.2, 0.8)) * cell))
    d1 = np.full((n, n), 1e9)
    d2 = np.full((n, n), 1e9)
    ids = np.zeros((n, n))
    for idx, (px, py) in enumerate(pts):
        for ox in (-n, 0, n):
            for oy in (-n, 0, n):
                d = np.hypot(xs - px - ox, ys - py - oy)
                closer = d < d1
                d2 = np.where(closer, d1, np.minimum(d2, d))
                ids = np.where(closer, idx, ids)
                d1 = np.where(closer, d, d1)
    edge = d2 - d1
    H = np.sqrt(np.clip(edge / (1.6 * S_), 0, 1)) * 3 + fine * 0.8 - d1 / cell * 1.5
    alb = (np.sin(ids * 3.77) * 43758.5453 % 1 - 0.5) * 0.25 - (edge < 0.9 * S_) * 0.22
    return lit_gray(H, alb, k=1.0, ao_r=1, contrast=1.4)


# ───────────── Ruins ─────────────
# The tumbled walls of a house before it is restored, painted the way art.js draws them (the same layout:
# a broken back wall of dressed blocks, corner stubs, a fallen beam, rubble and weeds on bare earth), lit per
# pixel with chipped edges, moss and grime. `snow` covers what faces up. World box relative to the footprint's
# top-left corner: x from -10 to Wp + 16, y from -16 to Hp + 8.
RUIN_PAD = (10, 16, 16, 8)  # left, top, right, bottom


class Paint:
    """An RGBA painting in world space at PX px a world px, composited back to front. Every layer works on
    the small rectangle it touches (region), so a ruin of dozens of blocks paints in a second."""

    def __init__(self, x0, y0, x1, y1, rng):
        self.x0, self.y0 = x0, y0
        self.w, self.h = int(round((x1 - x0) * PX)), int(round((y1 - y0) * PX))
        ys, xs = np.mgrid[0:self.h, 0:self.w]
        self.X = x0 + (xs + 0.5) / PX
        self.Y = y0 + (ys + 0.5) / PX
        self.C = np.zeros((self.h, self.w, 3))
        self.A = np.zeros((self.h, self.w))
        self.U = np.zeros((self.h, self.w))   # how much the visible surface faces up (for snow)
        # Shared noise fields: fine pits, chips and moss patches.
        self.fine = value_noise(self.h, self.w, int(0.8 * PX), rng)
        self.patch = value_noise(self.h, self.w, int(2 * PX), rng)

    def region(self, x0, y0, x1, y1):
        """Slices for the world box, clamped to the painting (None when it misses)."""
        i0, i1 = max(0, int((y0 - self.y0) * PX) - 2), min(self.h, int((y1 - self.y0) * PX) + 3)
        j0, j1 = max(0, int((x0 - self.x0) * PX) - 2), min(self.w, int((x1 - self.x0) * PX) + 3)
        if i0 >= i1 or j0 >= j1:
            return None
        return (slice(i0, i1), slice(j0, j1))

    def over(self, col, a, up=None, sl=(slice(None), slice(None))):
        a = np.clip(a, 0, 1)
        C, A = self.C[sl], self.A[sl]
        if np.ndim(col) == 1:
            col = np.broadcast_to(col, C.shape)
        self.C[sl] = col * a[..., None] + C * (1 - a[..., None])
        self.A[sl] = a + A * (1 - a)
        if up is not None:
            U = self.U[sl]
            self.U[sl] = np.where(a > 0.5, up, U)

    def shadow(self, mask, r, alpha, sl=(slice(None), slice(None))):
        a = blur(mask.astype(np.float64), int(r * PX)) * alpha
        self.over(np.array([30, 40, 18.0]), a, None, sl)

    def image(self):
        a = np.clip(self.A, 0, 1)
        rgba = np.dstack([np.clip(self.C, 0, 255) * a[..., None], a * 255])
        img = Image.fromarray(rgba.astype(np.uint8), 'RGBA').resize((self.w // SS, self.h // SS), Image.LANCZOS)
        arr = np.asarray(img, dtype=np.float64)
        al = arr[..., 3:4] / 255
        arr[..., :3] = np.where(al > 0, arr[..., :3] / np.maximum(al, 1e-6), 0)
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')


STONE_RAMP = [(0, rgb('#3e3c38')), (0.3, rgb('#6c6962')), (0.55, rgb('#9c988f')), (0.8, rgb('#c9c5bb')), (1, rgb('#efede6'))]
WOOD_RAMP = [(0, rgb('#24160a')), (0.35, rgb('#4a2f18')), (0.6, rgb('#6e4a2b')), (0.85, rgb('#9a6a3e')), (1, rgb('#c99a62'))]
MOSS_RAMP = leaf_ramp(['#3f6f2a', '#5e9a3c', '#8fc35a'])


def stone_block(pt, x, y, w, h, d, tint, moss=False):
    """A dressed block: front face x..x+w, y..y+h, its top face d px deep above. Chipped, bevelled, lit."""
    sl = pt.region(x - 1, y - d - 1, x + w + 1, y + h + 1)
    if sl is None:
        return
    X, Y, noise, patch = pt.X[sl], pt.Y[sl], pt.fine[sl], pt.patch[sl]
    chip = (noise - 0.5) * 0.9
    r = 0.9

    def rbox(x0, y0, x1, y1):
        cx, cy = np.clip(X, x0 + r, x1 - r), np.clip(Y, y0 + r, y1 - r)
        return np.hypot(X - cx, Y - cy) - r + chip * 0.5   # < 0 inside
    top = rbox(x, y - d, x + w, y + 0.6)
    front = rbox(x, y, x + w, y + h)
    for sd, base_n, up in ((top, (0, -0.75, 0.66), 1.0), (front, (0, 0.38, 0.92), 0.0)):
        a = np.clip(-sd * PX / 1.5, 0, 1)
        if not a.any():
            continue
        # Bevel: towards the left and right edges the normal tilts out; fine pits from the noise.
        el, er = np.clip((X - x) / 1.2, 0, 1), np.clip((x + w - X) / 1.2, 0, 1)
        nx = (1 - el) * -0.6 + (1 - er) * 0.6 + (noise - 0.5) * 0.5
        n = np.dstack([nx, np.full_like(nx, base_n[1]) + (noise - 0.5) * 0.3, np.full_like(nx, base_n[2])])
        n /= np.linalg.norm(n, axis=2, keepdims=True)
        lit = np.clip((n * LIGHT).sum(axis=2), 0, 1)
        grime = np.clip((Y - y) / max(h, 1), 0, 1) * 0.12 if up == 0 else 0
        v = 0.15 + 0.85 * lit - grime + tint + (noise - 0.5) * 0.1
        col = ramp(v, STONE_RAMP)
        if moss:
            mm = (patch > (0.45 if up else 0.68)) & (a > 0)
            if up == 0:
                mm &= Y < y + h * 0.5
            col[mm] = mix(col[mm], ramp(v[mm] + 0.05, MOSS_RAMP), 0.85)
        pt.over(col, a, up, sl)


def lay_blade(pt, x, y, ang, length, width, cols):
    """A grass blade stamped as discs along a curve."""
    for t in np.linspace(0, 1, 9):
        px = x + math.sin(ang) * length * t + t * t * math.sin(ang) * 1.5
        py = y - math.cos(ang) * length * t
        r = width * (1 - t * 0.7) / 2
        sl = pt.region(px - r - 0.5, py - r - 0.5, px + r + 0.5, py + r + 0.5)
        if sl is None:
            continue
        d = np.hypot(pt.X[sl] - px, pt.Y[sl] - py)
        a = np.clip((r - d) * PX, 0, 1)
        pt.over(cols[0] if t < 0.5 else cols[1], a, 0.3, sl)


def ruin(wt, ht, seed, snow):
    rng = np.random.default_rng(seed)
    Wp, Hp = wt * 32, ht * 32
    pl, ptop, pr, pb = RUIN_PAD
    pt = Paint(-pl, -ptop, Wp + pr, Hp + pb, rng)
    X, Y = pt.X, pt.Y
    left, right, base = 4, Wp - 4, Hp - 4
    # The floor where the house stood: overgrown, darker than the meadow, with trodden earth showing through.
    ex, ey, erx, ery = Wp / 2, Hp * 0.6, (right - left) / 2 + 2, (Hp - 4) * 0.45
    edge_n = value_noise(pt.h, pt.w, int(3 * PX), rng)
    d = ((X - ex) / erx) ** 2 + ((Y - ey) / ery) ** 2 + (edge_n - 0.5) * 0.5
    a = np.clip((1.05 - d) * 2.5, 0, 1) * 0.85
    dirt = value_noise(pt.h, pt.w, int(2 * PX), rng)
    clod = value_noise(pt.h, pt.w, int(0.7 * PX), rng)
    gy, gx = np.gradient(dirt * 1.2 + clod * 0.6, 1 / PX)
    lit = np.clip((-gx * LIGHT[0] - gy * LIGHT[1] + LIGHT[2]) / np.sqrt(gx ** 2 + gy ** 2 + 1), 0, 1)
    v = 0.3 + lit * 0.55 + (dirt - 0.5) * 0.25
    earth = ramp(v, [(0, rgb('#3e3220')), (0.5, rgb('#6e5a3a')), (1, rgb('#a08660'))])
    moss = ramp(v, [(0, rgb('#2a4a1c')), (0.5, rgb('#3f6a2a')), (1, rgb('#6a9a44'))])
    bare = np.clip((dirt - 0.42) * 4, 0, 1)[..., None]
    pt.over(earth * bare + moss * (1 - bare), a, 0.7)
    for _ in range(int(wt * ht * 3)):   # a few pebbles
        px, py, r = rng.uniform(left + 4, right - 4), rng.uniform(Hp * 0.45, base - 2), rng.uniform(0.6, 1.3)
        sl = pt.region(px - r, py - r, px + r, py + r)
        dd = np.hypot(X[sl] - px, (Y[sl] - py) * 1.3)
        pt.over(rgb('#b5ab98') * (0.85 + rng.uniform(0, 0.3)), np.clip((r - dd) * PX, 0, 1), 0.8, sl)
    # Walls of dressed blocks, broken to uneven heights: the back wall across the width and the two side walls
    # running down towards the viewer, forming a П; each casts its shadow to the lower right.
    BW, BH, BD = 9.6, 6.0, 3.0
    wallY = Hp * 0.36 + 4
    back = []
    x = left
    while x < right - BW + 1:
        if rng.random() >= 0.12:
            back.append((x, 1 + int(rng.random() * 3.4)))
        x += BW
    sides = []
    for sx in (left, right - BW):
        y = wallY + BH
        while y < base + 1:
            if rng.random() >= 0.2:
                sides.append((sx, y, 1 + int(rng.random() * 1.8)))
            y += BH * 0.75
    sh = np.zeros_like(pt.A, dtype=bool)
    for x, n in back:
        sh |= (X > x + 3) & (X < x + BW + 4) & (Y > wallY - 1) & (Y < wallY + 2 + n * 3)
    for sx, y, n in sides:
        sh |= (X > sx + BW - 1) & (X < sx + BW + 2 + n * 2) & (Y > y - BH) & (Y < y + 2)
    pt.shadow(sh, 1.6, 0.45)
    for x, n in back:
        for j in range(n):
            stone_block(pt, x + (1 if j % 2 else 0), wallY - (j + 1) * BH + 1, BW - 0.4, BH - 0.4, BD,
                        rng.uniform(-0.08, 0.08), moss=(j == n - 1 and rng.random() < 0.5))
    for sx, y, n in sorted(sides, key=lambda t: t[1]):
        for j in range(n):
            stone_block(pt, sx + (0.8 if j % 2 else 0), y - (j + 1) * BH + 1, BW - 0.4, BH - 0.4, BD,
                        rng.uniform(-0.08, 0.08), moss=(j == n - 1 and rng.random() < 0.4))
    # The fallen beam: a round log lying across, its shadow first.
    cx, cy, ang = (left + right) / 2, base - 10, -0.35 + rng.random() * 0.7
    L, Wb = Wp * 0.62, 6.0
    ca, sa = math.cos(ang), math.sin(ang)
    u = (X - cx) * ca + (Y - cy) * sa
    v = -(X - cx) * sa + (Y - cy) * ca
    pt.shadow((np.abs(u - 2) < L / 2) & (np.abs(v - 3.5) < Wb / 2), 1.2, 0.45)
    inside = (np.abs(u) < L / 2) & (np.abs(v) < Wb / 2)
    t = np.clip(v / (Wb / 2), -1, 1)
    nz = np.sqrt(np.clip(1 - t * t, 0, 1))
    lit = np.clip(-t * 0.55 + nz * 0.75 + 0.05, 0, 1)
    wv = 0.12 + 0.8 * lit + np.sin(u * 2.2 + pt.fine * 5) * 0.06
    pt.over(ramp(wv, WOOD_RAMP), inside.astype(float), np.clip(-t, 0, 1))
    endx, endy = cx + ca * L / 2, cy + sa * L / 2
    e = ((X - endx) / 1.6) ** 2 + ((Y - endy) / 2.5) ** 2
    pt.over(ramp(0.75 + np.sin(np.sqrt(e) * 9) * 0.06, WOOD_RAMP), (e < 1).astype(float), 0.6)
    # Rubble: small lit stones with soft shadows.
    for _ in range(6 + wt * 2):
        sx, sy, r = rng.uniform(left, right), base - 2 - rng.uniform(0, 10), rng.uniform(1.6, 3.2)
        sl = pt.region(sx - r - 3, sy - r - 3, sx + r + 4, sy + r + 4)
        Xs, Ys = X[sl], Y[sl]
        pt.shadow((((Xs - sx - 1.2) / r) ** 2 + ((Ys - sy - 1.4) / (r * 0.75)) ** 2) < 1, 0.5, 0.4, sl)
        dd = ((Xs - sx) / r) ** 2 + ((Ys - sy) / (r * 0.75)) ** 2
        z = np.sqrt(np.clip(1 - dd, 0, 1))
        nx_, ny_ = (Xs - sx) / r, (Ys - sy) / (r * 0.75)
        lit = np.clip(nx_ * LIGHT[0] + ny_ * LIGHT[1] + z * LIGHT[2], 0, 1)
        pt.over(ramp(0.15 + 0.85 * lit + rng.uniform(-0.06, 0.06), STONE_RAMP), np.clip((1 - dd) * 6, 0, 1), np.clip(-ny_, 0, 1), sl)
    # Weeds through the floor and along the foot of the walls.
    greens = [rgb('#3f7f27'), rgb('#7fbf4a')] if not snow else [rgb('#8a7a4a'), rgb('#c2b07a')]
    for _ in range(10 + wt * 4):
        wx = rng.uniform(left + 2, right - 2)
        wy = [wallY + 2, base + 1, rng.uniform(wallY + 4, base)][int(rng.random() * 3)]  # noqa
        for _ in range(3 + int(rng.random() * 3)):
            lay_blade(pt, wx + rng.uniform(-1.5, 1.5), wy, rng.normal(0, 0.5), rng.uniform(4, 8), 1.2, greens)
    if snow:
        sn = value_noise(pt.h, pt.w, int(1.5 * PX), rng)
        cover = np.clip(pt.U * 1.3 - 0.25 + (sn - 0.5) * 0.6, 0, 1) * (pt.A > 0)
        white = np.array([240, 245, 250.0]) * (0.92 + sn[..., None] * 0.08)
        pt.C = mix(pt.C, white, cover[..., None])
    return pt.image()


def save(img, name, entries, **meta):
    path = os.path.join(OUT, name + '.png')
    # 256-colour PNGs (with alpha) are a quarter of the size and look the same for these soft shapes.
    if img.mode == 'RGBA':
        img = img.quantize(256, method=Image.Quantize.FASTOCTREE)
    else:
        img = img.convert('L')
    img.save(path, optimize=True)
    entries[name] = {'file': name + '.png', **meta}


def main():
    os.makedirs(OUT, exist_ok=True)
    looks = palettes()
    entries = {}
    seed = 1000
    for season in ['spring', 'summer', 'autumn']:
        for si, pal in enumerate(looks[season]['leaves']):
            for shape in range(3):
                seed += 1
                img, _ = crown(pal, shape, seed)
                save(img, f'crown-{season}-{si}-{shape}', entries, kind='crown', mid=pal[1], shape=shape,
                     w=70, h=78, ax=35, ay=82)
    for shape in range(3):
        for snow in (0, 1):
            seed += 1
            save(pine(shape, snow, seed), f'pine-{shape}-{snow}', entries, kind='pine', shape=shape, snow=snow,
                 w=48, h=72, ax=24, ay=74)
    bush_sets = {'full': ['#2f7a2c', '#4b9a36', '#7cc64c'], 'picked': ['#4f8a3c', '#6aa54e', '#94c86c'],
                 'autumn': ['#8c5a2e', '#a8703a', '#c99350']}
    for key, pal in bush_sets.items():
        for shape in range(3):
            seed += 1
            save(bush(pal, shape, seed), f'bush-{key}-{shape}', entries, kind='bush', mid=pal[1], shape=shape,
                 w=46, h=34, ax=23, ay=32)
    shrub_sets = [(f'spring-{i}', p) for i, p in enumerate(looks['spring']['leaves'])] + \
                 [(f'summer-{i}', p) for i, p in enumerate(looks['summer']['leaves'])] + \
                 [('autumn', ['#7d5a2a', '#a8763a', '#d3a14e'])]
    for key, pal in shrub_sets:
        for v in range(3):
            seed += 1
            k0 = 1.2 + v * 0.12
            save(bush(pal, v, seed, layout=SHRUB, box=(-24, -26, 24, 3), scale=k0), f'shrub-{key}-{v}', entries,
                 kind='shrub', mid=pal[1], shape=v, w=48, h=29, ax=24, ay=26)
    for shape in range(4):
        seed += 1
        save(rock(shape, seed), f'rock-{shape}', entries, kind='rock', shape=shape, w=46, h=36, ax=23, ay=34)
    for p in (0, 1):
        seed += 1
        hh = 10 if p else 22
        save(trunk(bool(p), seed), f'trunk-{p}', entries, kind='trunk', pine=p, w=18, h=hh + 7, ax=9, ay=hh + 3)
    seed += 1
    save(grass_texture(seed), 'grass', entries, kind='texture', w=128, h=128)
    for kind in ['tile', 'thatch', 'metal', 'plaster', 'planks', 'brick', 'stone']:
        seed += 1
        save(material(kind, seed), f'mat-{kind}', entries, kind='material', mat=kind, w=MAT, h=MAT)
    pl, ptop, pr, pb = RUIN_PAD
    for (wt, ht, variants) in [(2, 2, 3), (3, 2, 3), (3, 3, 2), (5, 3, 1)]:
        for var in range(variants):
            seed += 1
            for snow in (0, 1):
                save(ruin(wt, ht, seed, snow), f'ruin-{wt}x{ht}-{var}-{snow}', entries, kind='ruin', size=f'{wt}x{ht}',
                     shape=var, snow=snow, w=wt * 32 + pl + pr, h=ht * 32 + ptop + pb, ax=pl, ay=ptop)
    with open(os.path.join(OUT, 'sprites.json'), 'w') as f:
        json.dump({'scale': SCALE, 'sprites': entries}, f, indent=1, sort_keys=True)
        f.write('\n')
    total = sum(os.path.getsize(os.path.join(OUT, e['file'])) for e in entries.values())
    print(f'{len(entries)} sprites, {total / 1024:.0f} KiB → {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    sys.exit(main())
