"""Долгая зима on Godot — reusable object painters built on paint.Canvas (trees, rocks, bushes, logs, snow)."""

import math

import numpy as np

from paint import (Canvas, blur, colour_field, mix, rgb, rng, sd_box, sd_ellipse, sd_poly, sd_segment, smin,
                   smoothstep)


# ───────────── trees ─────────────
def pine(cv, cx, foot_y, height, width, seed, snow=1.0, tiers=None, lean=0.0, dark=0.0):
    """A snowy spruce: a short trunk and drooping tiers of boughs, each with a snow cap and snow on the tips."""
    r = rng(seed)
    X, Y = cv.X, cv.Y
    trunk_h = height * 0.16
    # trunk
    tw = width * 0.07
    d = sd_box(X, Y, cx, foot_y - trunk_h / 2 - 2, tw, trunk_h / 2 + 2, tw * 0.6)
    bark = colour_field(cv, "bark_hi", "bark_dark", (X - (cx - tw)) / (2 * tw) * 0.9 + cv.noise(3, seed) * 0.3)
    cv.part(d, bark, round_=tw, cast=0.0)
    tiers = tiers or int(r.integers(4, 6))
    top = foot_y - height
    base = foot_y - trunk_h * 0.65
    ys = np.linspace(top + height * 0.05, base, tiers + 1)
    for i in reversed(range(tiers)):
        t = (i + 1) / tiers
        y_top = top if i == 0 else ys[i] - (ys[i + 1] - ys[i]) * 0.55
        y_bot = ys[i + 1]
        hw = width * 0.5 * (0.32 + 0.68 * t) * (0.9 + r.random() * 0.15)
        sx = cx + lean * (1 - t) * height * 0.1
        # the tier: a triangle with a scalloped, drooping lower edge
        n_sc = 3 + int(t * 3)
        phase = r.random() * 6.28
        rel = (X - sx) / hw
        edge = y_bot + np.cos(rel * math.pi * n_sc / 2 + phase) * (height * 0.018) - (np.abs(rel) ** 2) * height * 0.03
        prog = np.clip((Y - y_top) / max(1, (y_bot - y_top)), 0, 1)
        half = hw * prog ** 0.8 + 1
        d_side = np.abs(X - sx) - half
        d_bot = Y - edge
        d_top = y_top - Y
        dd = np.maximum(np.maximum(d_side, d_bot), d_top)
        # rough needle edge
        dd = dd + (cv.noise(3.2, seed + i * 11, 2) - 0.5) * 3.0
        # bulge: a cone — rounded across, rising towards the trunk axis
        across = np.clip(1 - ((X - sx) / np.maximum(half, 1)) ** 2, 0, 1)
        bulge = np.sqrt(across) * hw * 0.55 + prog * hw * 0.25
        needles = cv.noise(5, seed + i * 3, 2)
        shade_t = 0.25 + (1 - prog) * -0.15 + needles * 0.35 + dark + (i / tiers) * 0.12
        # deeper inside the tier and towards its underside
        under = smoothstep(0.55, 1.0, prog) * 0.25
        alb = colour_field(cv, "#4a8a62", "#102a2a", np.clip(shade_t + under + (X - sx) / hw * 0.12, 0, 1))
        # frosting: snow lies on the upper part of each tier with a drippy lower edge
        wav = np.cos(rel * math.pi * n_sc + phase) * 0.09 + (cv.noise(2.5, seed + i * 13, 2) - 0.5) * 0.35
        lim = 0.52 + 0.1 * (1 - t) + wav
        smask = 1 - smoothstep(lim - 0.06, lim + 0.04, prog)
        smask = smask * smoothstep(0.0, 0.25, across + 0.1)
        cv.part(dd, alb, bulge=bulge, snow=snow, snow_seed=seed + i * 7, snow_thick=5.0, cast=0.45, cast_r=4,
                cast_off=(2, 4), snow_mask=smask)


def dead_tree(cv, cx, foot_y, height, seed, snow=0.6):
    """A bare dead tree: a grey trunk forking into crooked branches, snow along their tops."""
    r = rng(seed)
    X, Y = cv.X, cv.Y
    segs = []

    def branch(x, y, ang, length, w, depth):
        x2, y2 = x + math.cos(ang) * length, y + math.sin(ang) * length
        segs.append((x, y, x2, y2, w, w * 0.62))
        if depth <= 0 or w < 1.4:
            return
        n = 2 if depth > 1 else int(r.integers(1, 3))
        for k in range(n):
            da = (0.35 + r.random() * 0.45) * (1 if k % 2 == 0 else -1)
            branch(x2, y2, ang + da, length * (0.5 + r.random() * 0.2), w * 0.6, depth - 1)

    branch(cx, foot_y, -math.pi / 2 + (r.random() - 0.5) * 0.15, height * 0.4, height * 0.042, 4)
    d = None
    for (ax, ay, bx, by, wa, wb) in segs:
        s = sd_segment(X, Y, ax, ay, bx, by, (wa, wb))
        d = s if d is None else smin(d, s, 1.5)
    d = d + (cv.noise(2, seed, 2) - 0.5) * 1.2
    alb = colour_field(cv, "wood_grey", "bark_dark", 0.35 + cv.noise(4, seed + 1, 2) * 0.4)
    cv.part(d, alb, round_=height * 0.03, snow=snow, snow_seed=seed, snow_thick=1.5, cast=0.3)


def stump(cv, cx, foot_y, rad, seed, snow=1.0):
    X, Y = cv.X, cv.Y
    h = rad * 0.9
    # the side of the stump
    d = sd_box(X, Y, cx, foot_y - h / 2, rad, h / 2, rad * 0.25)
    d = np.minimum(d, sd_ellipse(X, Y, cx, foot_y, rad * 1.02, rad * 0.4))
    # roots
    for k, ang in enumerate((-0.9, 0.1, 0.8, 2.6)):
        rx = cx + math.cos(ang) * rad * 1.25
        ry = foot_y + math.sin(ang) * rad * 0.35
        d = smin(d, sd_segment(X, Y, cx, foot_y - rad * 0.2, rx, ry, (rad * 0.32, rad * 0.12)), 3)
    bark = colour_field(cv, "bark_hi", "bark_dark", (X - cx + rad) / (2 * rad) * 0.8 + cv.noise(1.5, seed) * 0.35)
    cv.part(d, bark, round_=rad * 0.5, snow=snow * 0.6, snow_seed=seed, cast=0.0)
    # the cut top: rings of light wood
    dt = sd_ellipse(X, Y, cx, foot_y - h, rad * 0.95, rad * 0.42)
    ring = np.sqrt(((X - cx) / rad) ** 2 + ((Y - foot_y + h) / (rad * 0.42)) ** 2)
    rings = 0.5 + 0.5 * np.sin(ring * 22 + cv.noise(3, seed + 4, 2) * 3)
    alb = colour_field(cv, "wood_cut", "wood", rings * 0.45 + ring * 0.3)
    cv.part(dt, alb, round_=2, cast=0.2, normal_tilt=(0, -0.6))
    if snow > 0:
        ds = sd_ellipse(X, Y, cx - rad * 0.25, foot_y - h - rad * 0.05, rad * 0.55, rad * 0.22) \
            + (cv.noise(2, seed + 9, 2) - 0.5) * 3
        cv.part(ds, rgb("snow"), round_=rad * 0.2, spec=0.4, cast=0.15)


def log(cv, x0, y0, x1, y1, rad, seed, snow=1.0, cut=True, bark="bark"):
    X, Y = cv.X, cv.Y
    d = sd_segment(X, Y, x0, y0, x1, y1, rad)
    t = cv.noise(1.5, seed, 2)
    alb = colour_field(cv, "bark_hi", "bark_dark", 0.3 + t * 0.5)
    elev = np.clip(rad - np.abs(Y - (y0 + y1) / 2) * 0.0, 0, None) * np.ones_like(X) * 0 + rad
    cv.part(d, alb, round_=rad, snow=snow, snow_seed=seed, snow_thick=2.5, elev=elev, cast=0.3)
    if cut:
        # the cut end facing the viewer (the end lower on screen)
        ex, ey = (x1, y1) if y1 >= y0 else (x0, y0)
        dc = sd_ellipse(X, Y, ex, ey, rad * 0.72, rad * 0.95)
        rr = np.sqrt(((X - ex) / (rad * 0.72)) ** 2 + ((Y - ey) / (rad * 0.95)) ** 2)
        alb = colour_field(cv, "wood_cut", "wood", 0.5 + 0.5 * np.sin(rr * 18) * 0.5 + rr * 0.3)
        cv.part(dc, alb, round_=1.5, elev=elev, cast=0.2)


# ───────────── rocks ─────────────
def rock(cv, cx, foot_y, w, h, seed, snow=1.0, facets=7, moss=0.0, tone=0.0):
    """A boulder: a lumpy blob with flattened facets, a snow cap, a dark contact line."""
    r = rng(seed)
    X, Y = cv.X, cv.Y
    cy = foot_y - h * 0.45
    d = sd_ellipse(X, Y, cx, cy, w * 0.5, h * 0.55)
    for k in range(3):
        ox, oy = (r.random() - 0.5) * w * 0.55, (r.random() - 0.6) * h * 0.4
        d = smin(d, sd_ellipse(X, Y, cx + ox, cy + oy, w * (0.22 + r.random() * 0.12), h * (0.3 + r.random() * 0.15)),
                 w * 0.12)
    # cut facets: planes that flatten the blob
    for k in range(facets):
        a = r.random() * math.tau
        nx, ny = math.cos(a), math.sin(a) * 0.8
        off = (0.42 + r.random() * 0.12) * min(w, h * 1.4)
        plane = (X - cx) * nx + (Y - cy) * ny - off
        d = np.maximum(d, plane)
    d = np.maximum(d, Y - foot_y)  # sits on the ground
    d = d + (cv.noise(2.5, seed + 3, 3) - 0.5) * 2.0
    # bulge: a convex faceted top — the lowest of a few tilted planes, softened a little
    top = foot_y - h * 0.62
    planes = [np.full_like(X, h * 0.85)]
    for k in range(facets):
        a = (k / facets) * math.tau + r.random() * 0.6
        slope = 0.55 + r.random() * 0.5
        planes.append(h * (0.6 + r.random() * 0.15) - slope * ((X - cx) * math.cos(a) + (Y - top) * math.sin(a) * 1.3))
    bulge = np.min(np.stack(planes), axis=0)
    bulge = np.clip(bulge, 0, None)
    edge = np.clip(-d / (w * 0.08), 0, 1)
    bulge = blur(bulge, 1.5 * cv.ss) * np.sqrt(edge)
    grain = cv.noise(4, seed + 5, 3)
    alb = colour_field(cv, "#9aa0b2", "#3e4356", np.clip(0.35 + grain * 0.35 + tone + (Y - cy) / h * 0.3, 0, 1))
    if moss > 0:
        m = smoothstep(0.55, 0.7, cv.noise(3, seed + 8, 2)) * moss
        alb = alb * (1 - m[..., None]) + np.array(rgb("moss")) * m[..., None]
    smask = smoothstep(0.35, 0.6, -cv._normals(bulge)[..., 1] + (cv.noise(3, seed + 2, 2) - 0.5) * 0.5) \
        * (1 - smoothstep(top + h * 0.05, top + h * 0.35, Y + (cv.noise(4, seed + 6, 2) - 0.5) * h * 0.4))
    cv.part(d, alb, bulge=bulge, snow=snow, snow_seed=seed + 1, snow_thick=3.5, cast=0.3, spec=0.05,
            elev=np.clip(foot_y - Y, 0, None) * 0.9, snow_mask=smask)


# ───────────── bushes ─────────────
def bush(cv, cx, foot_y, w, h, seed, berries=0, snow=1.0, bare=False):
    """A round snowy bush made of overlapping leafy lumps; berries as glossy red beads; `bare` — twigs only."""
    r = rng(seed)
    X, Y = cv.X, cv.Y
    if bare:
        d = None
        for k in range(9):
            a = -math.pi / 2 + (r.random() - 0.5) * 2.2
            L = h * (0.6 + r.random() * 0.4)
            bx, by = cx + math.cos(a) * L * 0.8, foot_y + math.sin(a) * L
            s = sd_segment(X, Y, cx + (r.random() - 0.5) * w * 0.2, foot_y, bx, by, (2.2, 0.8))
            d = s if d is None else np.minimum(d, s)
            # forks
            mx, my = (cx + bx) / 2, (foot_y + by) / 2
            s2 = sd_segment(X, Y, mx, my, mx + math.cos(a + 0.7) * L * 0.35, my + math.sin(a + 0.7) * L * 0.35,
                            (1.3, 0.6))
            d = np.minimum(d, s2)
        alb = colour_field(cv, "twig", "bark_dark", cv.noise(3, seed, 2))
        cv.part(d, alb, round_=1.5, snow=snow * 0.7, snow_seed=seed, snow_thick=1.2, cast=0.25)
        # a bit of snow heaped at the base
        ds = sd_ellipse(X, Y, cx, foot_y - 2, w * 0.4, h * 0.12) + (cv.noise(3, seed + 2, 2) - 0.5) * 4
        cv.part(ds, rgb("snow"), round_=6, spec=0.3, cast=0.15)
        return
    lumps = []
    for k in range(7):
        a = r.random() * math.pi
        rr = w * (0.18 + r.random() * 0.12)
        lx = cx + math.cos(a) * w * 0.28 * (1 if k % 2 else -1) * r.random()
        ly = foot_y - rr * 0.9 - r.random() * h * 0.45
        lumps.append((lx, ly, rr))
    lumps.sort(key=lambda l: l[1])
    for i, (lx, ly, rr) in enumerate(lumps):
        d = sd_ellipse(X, Y, lx, ly, rr * 1.1, rr) + (cv.noise(2.6, seed + i, 2) - 0.5) * 4.0
        d = np.maximum(d, Y - foot_y)
        leaf = cv.noise(4, seed + i * 5, 2)
        alb = colour_field(cv, "#5f9060", "#1d3b30", np.clip(0.2 + leaf * 0.6 + (Y - ly) / rr * 0.2, 0, 1))
        cv.part(d, alb, round_=rr * 0.9, snow=snow, snow_seed=seed + i, snow_thick=3, cast=0.4, cast_r=3, snow_bias=-0.12)
    for k in range(berries):
        bx = cx + (r.random() - 0.5) * w * 0.75
        by = foot_y - r.random() * h * 0.7 - 4
        br = 2.6 + r.random() * 1.3
        d = sd_ellipse(X, Y, bx, by, br, br)
        alb = colour_field(cv, "berry_hi", "berry", np.clip((Y - by) / br * 0.5 + 0.5, 0, 1))
        cv.part(d, alb, round_=br, cast=0.35, cast_r=1.5, cast_off=(0.8, 1.2), spec=0.9)


# ───────────── snow forms ─────────────
def snow_mound(cv, cx, foot_y, w, h, seed, tone=0.0, sastrugi=True):
    X, Y = cv.X, cv.Y
    r = rng(seed)
    cy = foot_y - h * 0.4
    d = sd_ellipse(X, Y, cx, cy, w * 0.5, h * 0.6)
    for k in range(2):
        d = smin(d, sd_ellipse(X, Y, cx + (r.random() - 0.5) * w * 0.5, cy + (r.random() - 0.3) * h * 0.3,
                               w * 0.3, h * 0.4), w * 0.15)
    d = d + (cv.noise(10, seed, 2) - 0.5) * 4
    inside = np.clip(-d, 0, None)
    t = np.clip(inside / (h * 0.9), 0, 1)
    bulge = blur(t * t * (3 - 2 * t) * h * 0.75, 2 * cv.ss)
    if sastrugi:
        bulge = bulge + (cv.noise(16, seed + 1, 2) - 0.5) * 2
    alb = colour_field(cv, "snow_hi", "snow", np.clip(0.1 + (Y - cy) / h * 0.4 + tone, 0, 1))
    # feathered: the mound melts into the snow around it
    cv.part(d, alb, bulge=bulge, cast=0.0, spec=0.35, elev=np.clip(foot_y - Y, 0, None) * 0.7, soft=h * 0.35)


def ice_shard(cv, x, foot_y, w, h, lean, seed):
    X, Y = cv.X, cv.Y
    pts = [(x - w / 2, foot_y), (x + w / 2, foot_y), (x + lean + w * 0.08, foot_y - h), (x + lean - w * 0.1, foot_y - h * 0.92)]
    d = sd_poly(X, Y, pts)
    # facets: left half darker, right lit... the light is up-left, so the left facet catches it
    side = (X - (x + lean * (foot_y - Y) / h))
    alb = colour_field(cv, "ice_hi", "ice_deep", np.clip(0.35 + side / w * 0.9 + (Y - foot_y + h) / h * 0.15, 0, 1))
    bulge = np.clip(1 - np.abs(side) / (w * 0.5), 0, 1) * w * 0.25
    cv.part(d, alb, bulge=bulge, cast=0.35, spec=1.0, opacity=0.94)
    # a bright edge
    d2 = sd_segment(X, Y, x - w * 0.15, foot_y - 2, x + lean - w * 0.04, foot_y - h * 0.9, 0.8)
    cv.part(d2, rgb("#ffffff"), unlit=True, cast=0, opacity=0.7)
