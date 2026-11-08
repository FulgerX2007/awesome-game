"""Долгая зима on Godot — effect textures: the fire's flame sheets, embers, sparks, smoke, snowflakes, light
falloffs for PointLight2D, wood and stone chips, breath, fog noise, a glow and the aurora ribbon.

    python3 tools/winter-godot/art/effects.py      → godot/winter/assets/effects/**, manifest/effects.json

Effects are unlit and need no normal maps. Flames loop seamlessly: their noise scrolls up by a whole period over
the loop and wobbles on a circle in time.
"""

import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from paint import ASSETS, Manifest, blur, fbm, res_path, rgb, rng, save_png, smoothstep  # noqa: E402

SS = 2


def down(a, ss=SS):
    h, w = a.shape[0] // ss, a.shape[1] // ss
    if a.ndim == 2:
        return a.reshape(h, ss, w, ss).mean(axis=(1, 3))
    return a.reshape(h, ss, w, ss, a.shape[2]).mean(axis=(1, 3))


def to_rgba(col, alpha):
    """col (H, W, 3) 0..1 straight colour, alpha (H, W) 0..1 → uint8 RGBA."""
    out = np.dstack([np.clip(col, 0, 1), np.clip(alpha, 0, 1)])
    return (out * 255 + 0.5).astype(np.uint8)


def ramp(t, stops):
    """Colour ramp: stops = [(t, '#hex'), …] sorted by t."""
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,))
    ts = [s[0] for s in stops]
    cs = [np.array(rgb(s[1])) for s in stops]
    for i in range(len(stops) - 1):
        a, b = ts[i], ts[i + 1]
        k = np.clip((t - a) / max(1e-6, b - a), 0, 1)[..., None]
        m = ((t >= a) & (t <= b))[..., None] if i < len(stops) - 2 else (t >= a)[..., None]
        out = np.where(m, cs[i] * (1 - k) + cs[i + 1] * k, out)
    out = np.where((t < ts[0])[..., None], cs[0], out)
    return out


FIRE = [(0.0, "ember_dark"), (0.22, "fire_deep"), (0.48, "fire"), (0.75, "fire_hi"), (0.95, "fire_core"), (1.0, "#fffbe8")]


def flame_frames(fw, fh, n, seed, tongues=3, width=0.42):
    """n frames of a looping flame, each fw × fh, the base at the bottom centre."""
    W, H = fw * SS, fh * SS
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    u = (xs + 0.5) / W - 0.5                 # −0.5 … 0.5
    v = 1 - (ys + 0.5) / H                   # 0 at the bottom, 1 at the top
    nA = fbm(H, W, int(H / 3), seed, 4, wrap=True)
    nB = fbm(H, W, int(H / 3), seed + 9, 4, wrap=True)
    nC = fbm(H, W, int(W / 2.5), seed + 21, 3, wrap=True)
    r = rng(seed)
    offs = [(0.0, 1.0, 0.0)] + [((-1) ** k * (0.12 + r.random() * 0.1), 0.5 + r.random() * 0.25, r.random() * 6.28)
                                 for k in range(tongues - 1)]
    frames = []
    for f in range(n):
        ph = f / n * math.tau
        shift = int(round(f * H / n))
        a = np.roll(nA, -shift * 1, axis=0)
        b = np.roll(nB, -shift * 1, axis=0)
        c = np.roll(nC, -shift * 2 % H, axis=0)
        wob = (a - 0.5) * math.cos(ph) + (b - 0.5) * math.sin(ph)
        heat = np.zeros_like(u)
        for (ox, hk, p2) in offs:
            sway = math.sin(ph + p2) * 0.05
            uu = u - ox - sway * v - wob * 0.22 * v ** 0.8
            vv = v / hk
            # a teardrop: wide at the bottom third, a point at the top
            prof = width * np.sqrt(np.clip(vv, 0, 1)) * np.clip(1 - vv, 0, 1) ** 0.75 * 1.55
            body = 1 - np.abs(uu) / np.maximum(prof, 1e-4)
            body = np.where(vv < 1, body, -1)
            heat = np.maximum(heat, np.clip(body, -1, 1) * (1 - vv * 0.35))
        # erosion: the noise eats the edges and the top, leaving licks of flame
        body_on = heat > 0
        heat = (heat - (c - 0.5) * 1.15 * (0.12 + v ** 1.1) - v * 0.18) * body_on
        heat = np.clip(heat, 0, 1)
        alpha = smoothstep(0.0, 0.18, heat)
        # mostly orange; yellow inside; a small white-hot core only near the base
        core = np.exp(-((u / 0.12) ** 2 + ((v - 0.12) / 0.16) ** 2))
        t = np.clip(heat * 0.78 + core * 0.3 - v * 0.12, 0, 1)
        col = ramp(t, FIRE)
        # a hot base glow
        base = np.exp(-((u / 0.28) ** 2 + ((v - 0.05) / 0.12) ** 2))
        col = col + np.array(rgb("fire_hi")) * base[..., None] * 0.25
        alpha = np.maximum(alpha, base * 0.55)
        frames.append(to_rgba(down(col), down(alpha)))
    return frames


def sheet(frames):
    return np.concatenate(frames, axis=1)


def soft_blob(size, seed, lumps=5, color="smoke", shade=True, alpha_k=0.75):
    W = H = size * SS
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    x, y = (xs + 0.5) / SS, (ys + 0.5) / SS
    r = rng(seed)
    field = np.zeros((H, W))
    for k in range(lumps):
        cx, cy = size / 2 + (r.random() - 0.5) * size * 0.35, size / 2 + (r.random() - 0.5) * size * 0.3
        rr = size * (0.18 + r.random() * 0.12)
        field += np.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / (rr * rr)))
    field += (fbm(H, W, int(size * SS / 4), seed + 3, 3) - 0.5) * 0.5
    a = smoothstep(0.15, 1.5, field) ** 1.3
    col = np.broadcast_to(np.array(rgb(color)), (H, W, 3)).copy()
    if shade:
        gy, gx = np.gradient(blur(field, SS * 2))
        lit = np.clip(0.5 - (gx * -0.55 + gy * -0.65) * size * 0.6, 0, 1)
        col = col * (0.88 + 0.22 * lit[..., None])
    return to_rgba(down(col), down(a * alpha_k))


def radial(size, falloff, color="#ffffff"):
    W = H = size
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    d = np.sqrt(((xs + 0.5) - W / 2) ** 2 + ((ys + 0.5) - H / 2) ** 2) / (W / 2)
    a = np.clip(falloff(np.clip(d, 0, 1)), 0, 1) * (d < 1)
    col = np.broadcast_to(np.array(rgb(color)), (H, W, 3)) * a[..., None]
    return to_rgba(col, a)


def entry_single(m, key, arr, rel, anchor_centre=True, extra=None):
    path = os.path.join(ASSETS, "effects", rel + ".png")
    save_png(arr, path)
    e = {"file": res_path(path), "size": [int(arr.shape[1]), int(arr.shape[0])],
         "foot": [arr.shape[1] / 2, arr.shape[0] / 2 if anchor_centre else arr.shape[0] - 1]}
    if extra:
        e.update(extra)
    m.add(key, e)


def build(only=None):
    m = Manifest("effects")
    # the campfire flame: 8 frames, ~0.9 × 1.4 tiles
    fw, fh = 88, 136
    fr = flame_frames(fw, fh, 8, 7001, tongues=5, width=0.3)
    path = os.path.join(ASSETS, "effects", "fire", "flame.png")
    save_png(sheet(fr), path)
    m.add("fx.flame", {"sheet": res_path(path), "frame": [fw, fh], "foot": [fw / 2, fh - 6],
                       "anims": {"burn": {"row": 0, "from": 0, "count": 8, "fps": 12, "loop": True}}})
    fw, fh = 40, 64
    fr = flame_frames(fw, fh, 6, 7101, tongues=2, width=0.4)
    path = os.path.join(ASSETS, "effects", "fire", "flame_small.png")
    save_png(sheet(fr), path)
    m.add("fx.flame.small", {"sheet": res_path(path), "frame": [fw, fh], "foot": [fw / 2, fh - 4],
                             "anims": {"burn": {"row": 0, "from": 0, "count": 6, "fps": 12, "loop": True}}})
    entry_single(m, "fx.ember", radial(16, lambda d: np.exp(-(d / 0.42) ** 2), "#ffb050"), "fire/ember")
    # a spark: a short bright streak (the game rotates it along its motion)
    W, H = 24 * SS, 8 * SS
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    x, y = (xs + 0.5) / SS - 12, (ys + 0.5) / SS - 4
    a = np.exp(-((x / 8.0) ** 2 + (y / 1.6) ** 2)) * np.clip(1 - (x + 8) / 22, 0, 1) ** 0.5
    col = ramp(np.clip(a * 1.3, 0, 1), [(0, "fire"), (0.6, "fire_hi"), (1, "fire_core")])
    entry_single(m, "fx.spark", to_rgba(down(col), down(np.clip(a * 1.4, 0, 1))), "fire/spark")
    for i in range(3):
        entry_single(m, f"fx.smoke.{i}", soft_blob(72, 7201 + i, lumps=5 + i), f"smoke/smoke_{i}")
    # snowflakes: a soft dot, a six-armed flake, a bigger blurred flake (near the camera)
    W = 16 * SS
    ys, xs = np.mgrid[0:W, 0:W].astype(np.float64)
    x, y = (xs + 0.5) / SS - 8, (ys + 0.5) / SS - 8
    d = np.sqrt(x * x + y * y)
    a0 = np.exp(-(d / 2.4) ** 2)
    ang = np.arctan2(y, x)
    arms = np.exp(-((np.abs(np.sin(ang * 3)) * d) / 0.9) ** 2) * (d < 6.5) + np.exp(-(d / 1.6) ** 2)
    a1 = np.clip(arms, 0, 1) * 0.95
    a2 = blur(np.clip(np.exp(-(d / 4.2) ** 2) * 1.2, 0, 1), SS * 2) * 0.8
    for i, a in enumerate((a0, a1, a2)):
        col = np.broadcast_to(np.array(rgb("snow_hi")), a.shape + (3,))
        entry_single(m, f"fx.snowflake.{i}", to_rgba(down(col), down(a)), f"snow/flake_{i}")
    # PointLight2D textures: a warm-friendly plateau with a smooth falloff, and a soft gaussian
    entry_single(m, "fx.light", radial(256, lambda d: (1 - d * d) ** 2), "weather/light")
    entry_single(m, "fx.light.soft", radial(256, lambda d: np.exp(-(d / 0.45) ** 2) * (1 - d) ** 0.5), "weather/light_soft")
    entry_single(m, "fx.glow", radial(64, lambda d: np.exp(-(d / 0.38) ** 2), "#fff2d8"), "fire/glow")
    # chips
    for key, rel, colors, seed in (("fx.chip.wood", "fire/chip_wood", ("wood_cut", "wood_dark"), 7301),
                                   ("fx.chip.stone", "smoke/chip_stone", ("stone_hi", "stone_dark"), 7302)):
        W = 16 * SS
        ys, xs = np.mgrid[0:W, 0:W].astype(np.float64)
        x, y = (xs + 0.5) / SS - 8, (ys + 0.5) / SS - 8
        r = rng(seed)
        pts = [(math.cos(a) * (4 + r.random() * 2.5), math.sin(a) * (2.5 + r.random() * 2)) for a in
               np.linspace(0, math.tau, 6, endpoint=False) + r.random()]
        inside = np.ones_like(x, dtype=bool)
        for i in range(len(pts)):
            (ax, ay), (bx, by) = pts[i], pts[(i + 1) % len(pts)]
            inside &= (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0
        a = blur(inside.astype(np.float64), SS)
        col = np.where((y < -x * 0.4)[..., None], np.array(rgb(colors[0])), np.array(rgb(colors[1])))
        entry_single(m, key, to_rgba(down(col), down(a)), rel)
    entry_single(m, "fx.breath", soft_blob(48, 7401, lumps=4, color="snow_hi", shade=False, alpha_k=0.55), "weather/breath")
    # fog: tileable noise in the alpha, white colour (the game tints it)
    n = fbm(512, 512, 128, 7501, 5, wrap=True)
    n = smoothstep(0.25, 0.8, n)
    col = np.ones((512, 512, 3))
    entry_single(m, "fx.fog", to_rgba(col, n), "weather/fog")
    # the aurora: vertical rays in a wavy curtain, tileable across
    W, H = 1024, 256
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    phase = xs / W * math.tau
    band = 0.45 + 0.12 * np.sin(phase * 2 + 0.6) + 0.06 * np.sin(phase * 5 + 1.3)
    vy = ys / H
    curtain = np.exp(-((vy - band) / 0.13) ** 2) * (vy > band - 0.3)
    tail = np.clip((band + 0.05 - vy) / 0.45, 0, 1) ** 1.5 * (vy < band)
    rays = fbm(1, W, 6, 7601, 3, wrap=True)[0][None, :] * np.ones((H, 1))
    rays = 0.55 + 0.6 * smoothstep(0.35, 0.75, rays)
    a = np.clip((curtain * 0.9 + tail * 0.45 * smoothstep(0.0, 0.3, vy)) * rays, 0, 1)
    t = np.clip((band - vy) / 0.4 + 0.3, 0, 1)
    col = ramp(t, [(0, "#4dffb0"), (0.5, "#3fd6d0"), (0.8, "#6a7bff"), (1, "#b06aff")])
    entry_single(m, "fx.aurora", to_rgba(col, a * 0.9), "weather/aurora")
    return m.write(), m


if __name__ == "__main__":
    path, m = build()
    print(path, len(m.items), "textures")
