"""Долгая зима on Godot — the shared painter of the world art.

A sprite is painted at a supersampled resolution as a stack of *parts*. Each part is a soft 2D shape (from a signed
distance field) with a *bulge* (its surface height across the shape, which gives the normals), an albedo, and an
*elevation* above the ground (which gives the cast shadow). Parts are composited back to front; a part casts a soft
contact shadow onto what is behind it. At the end the stack is shaded once with the one light of the game
(palette.LIGHT): wrapped lambert, a cool sky fill, ambient occlusion from the bulge, snow caps where a surface faces
up, a little specular on snow and ice. Then it is downsampled (anti-aliased), trimmed and written as

    <name>.png         colour (straight alpha)
    <name>.n.png       tangent-space normal map, +X right, green = up on screen (OpenGL), flat = (128, 128, 255)
    <name>.shadow.png  a soft cast shadow falling down-right (palette.SHADOW_DIR), black with alpha

All randomness comes from explicit seeds, so the output is deterministic.
"""

import json
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from palette import AMBIENT, LIGHT, P, SHADOW_DIR, TILE, mix, rgb  # noqa: E402,F401

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
GAME = os.path.join(ROOT, "godot", "winter")
ASSETS = os.path.join(GAME, "assets")

_L = np.array(LIGHT, dtype=np.float64)
_L /= np.linalg.norm(_L)


def _flat_gain():
    d = _L[2]
    wrap = np.clip((d + 0.3) / 1.3, 0, 1) ** 1.15
    sun = np.array(rgb("#fff4e4")); sky = np.array(rgb("#9db4e8"))
    v = sun * wrap * (1 - AMBIENT) * 1.12 + sky * AMBIENT * (0.55 + 0.45 * 0.6)
    return 1.0 / float(v.mean())


_GAIN = _flat_gain() * 0.97


# ───────────── noise and filters ─────────────
def rng(seed):
    return np.random.default_rng(seed & 0xFFFFFFFF)


def value_noise(h, w, cell, seed, wrap=False):
    """Smooth value noise in 0..1 on an h×w grid with features about `cell` pixels apart."""
    gh, gw = max(2, int(math.ceil(h / cell)) + 2), max(2, int(math.ceil(w / cell)) + 2)
    r = rng(seed)
    if wrap:
        gh, gw = max(2, int(round(h / cell))), max(2, int(round(w / cell)))
        g = r.random((gh, gw))
        g = np.tile(g, (3, 3))
        img = Image.fromarray(g.astype(np.float32), mode="F")
        big = np.asarray(img.resize((w * 3, h * 3), Image.BICUBIC), dtype=np.float64)
        return np.clip(big[h:2 * h, w:2 * w], 0, 1)
    g = r.random((gh, gw)).astype(np.float32)
    img = Image.fromarray(g, mode="F")
    big = np.asarray(img.resize((gw * cell, gh * cell), Image.BICUBIC), dtype=np.float64)
    ox, oy = int(r.integers(0, cell)), int(r.integers(0, cell))
    return np.clip(big[oy:oy + h, ox:ox + w], 0, 1)


def fbm(h, w, cell, seed, octaves=4, wrap=False):
    out = np.zeros((h, w))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        c = max(2, cell // (2 ** o))
        out += value_noise(h, w, c, seed * 7 + o * 131, wrap) * amp
        tot += amp
        amp *= 0.5
    return out / tot


def box_blur(a, r):
    """Separable box blur of radius r (pixels), edges clamped. Works on 2D or 3D (H, W, C) arrays."""
    r = int(r)
    if r <= 0:
        return a
    def blur1(x, axis):
        pad = [(0, 0)] * x.ndim
        pad[axis] = (r + 1, r)
        xp = np.pad(x, pad, mode="edge")
        c = np.cumsum(xp, axis=axis)
        hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
        lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
        return (hi - lo) / (2 * r + 1)
    return blur1(blur1(a, 0), 1)


def blur(a, r):
    """About-gaussian blur: three box passes."""
    r = max(1, int(round(r / 1.7)))
    for _ in range(3):
        a = box_blur(a, r)
    return a


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def smin(a, b, k):
    """Smooth minimum of two distance fields (blobby union)."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


# ───────────── signed distance fields (pixel units, negative inside) ─────────────
def sd_ellipse(X, Y, cx, cy, rx, ry):
    # good-enough ellipse distance: scaled circle distance times the smaller radius
    k = np.sqrt(((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2)
    return (k - 1.0) * min(rx, ry)


def sd_box(X, Y, cx, cy, hw, hh, r=0.0):
    qx = np.abs(X - cx) - hw + r
    qy = np.abs(Y - cy) - hh + r
    return np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0) - r


def sd_segment(X, Y, ax, ay, bx, by, r):
    """Capsule from (ax, ay) to (bx, by) with radius r (r may be an array or (ra, rb) for a taper)."""
    pax, pay = X - ax, Y - ay
    bax, bay = bx - ax, by - ay
    h = np.clip((pax * bax + pay * bay) / max(1e-9, bax * bax + bay * bay), 0, 1)
    if isinstance(r, tuple):
        r = r[0] + (r[1] - r[0]) * h
    return np.sqrt((pax - bax * h) ** 2 + (pay - bay * h) ** 2) - r


def sd_poly(X, Y, pts):
    """Polygon distance (pts: list of (x, y))."""
    pts = np.asarray(pts, dtype=np.float64)
    d = np.full(X.shape, 1e9)
    s = np.ones(X.shape)
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        wx, wy = X - ax, Y - ay
        h = np.clip((wx * ex + wy * ey) / max(1e-9, ex * ex + ey * ey), 0, 1)
        dx, dy = wx - ex * h, wy - ey * h
        d = np.minimum(d, dx * dx + dy * dy)
        c1 = Y >= ay
        c2 = Y < by
        c3 = ex * wy > ey * wx
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s = np.where(flip, -s, s)
    return s * np.sqrt(d)


# ───────────── the canvas ─────────────
class Canvas:
    """A sprite being painted. Coordinates are final-image pixels (floats); the buffers are supersampled."""

    def __init__(self, w, h, ss=3, foot=None):
        self.w, self.h, self.ss = int(w), int(h), ss
        H, W = self.h * ss, self.w * ss
        ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
        self.X = (xs + 0.5) / ss
        self.Y = (ys + 0.5) / ss
        self.alb = np.zeros((H, W, 3))
        self.nrm = np.zeros((H, W, 3))
        self.nrm[..., 2] = 1.0
        self.a = np.zeros((H, W))
        self.bulge = np.zeros((H, W))      # surface height of the part on top (normals, AO)
        self.elev = np.zeros((H, W))       # height above the ground (shadows)
        self.occl = np.ones((H, W))        # contact shadows cast by later parts
        self.spec = np.zeros((H, W))
        self.emit = np.zeros((H, W, 3))    # unlit colour added after shading (embers, glowing windows)
        self.unlit = np.zeros((H, W))      # 1 = take albedo as is (no shading)
        self.foot = foot if foot is not None else (w / 2.0, h - 4.0)

    # a field over the canvas from a function of (X, Y)
    def noise(self, cell, seed, octaves=3):
        return fbm(self.h * self.ss, self.w * self.ss, max(2, int(cell * self.ss)), seed, octaves)

    def part(self, sdf, albedo, bulge=None, round_=6.0, elev=None, snow=0.0, snow_seed=0, snow_thick=3.0,
             cast=0.35, cast_r=3.0, cast_off=(1.5, 2.5), spec=0.0, unlit=False, emit=None, opacity=1.0,
             normal_tilt=(0.0, 0.0), flat=False, snow_bias=0.0, snow_mask=None, soft=0.0):
        """Composite one part over the canvas.

        sdf      — signed distance (px, negative inside);
        albedo   — (r, g, b) or an (H, W, 3) array;
        bulge    — surface height in px over the shape (default: a rounded bevel of width round_);
        elev     — height above the ground per pixel (default: the foot's y minus Y, i.e. an upright object);
        snow     — 0..1, how readily snow settles on up-facing surfaces of this part;
        cast     — strength of the soft shadow this part throws on what is behind it.
        """
        ss = self.ss
        H, W = sdf.shape
        pad = cast_r * 3 + max(abs(cast_off[0]), abs(cast_off[1])) + 4 + (4 if snow > 0 else 0) + soft
        ys, xs = np.nonzero(sdf < pad)
        if not len(xs):
            return None
        y0, y1 = max(0, ys.min() - 2), min(H, ys.max() + 3)
        x0, x1 = max(0, xs.min() - 2), min(W, xs.max() + 3)
        sl = (slice(y0, y1), slice(x0, x1))
        shape = (y1 - y0, x1 - x0)

        def crop(v):
            if isinstance(v, np.ndarray) and v.ndim >= 2 and v.shape[:2] == (H, W):
                return v[sl]
            return v

        sdf = sdf[sl]
        if soft > 0:
            cov = smoothstep(soft * 0.5, -soft * 0.5, sdf) * opacity
        else:
            cov = np.clip(0.5 - sdf * ss / 1.2, 0, 1) * opacity
        inside = np.clip(-sdf, 0, None)
        bulge = crop(bulge)
        if bulge is None:
            t = np.clip(inside / max(0.5, round_), 0, 1)
            bulge = np.sqrt(1 - (1 - t) ** 2) * round_
        if flat:
            bulge = np.zeros_like(sdf)
        bulge = np.broadcast_to(bulge, shape).astype(np.float64)
        albedo = crop(albedo)
        if isinstance(albedo, np.ndarray) and albedo.ndim == 3:
            alb = albedo.copy()
        else:
            alb = np.broadcast_to(np.asarray(albedo, dtype=np.float64), shape + (3,)).copy()
        spec = crop(spec)
        n = self._normals(bulge, normal_tilt)
        if snow > 0:
            nz = fbm(shape[0], shape[1], max(2, int(5 * ss)), snow_seed + 17, 3)
            if snow_mask is None:
                up = -n[..., 1]
                s = smoothstep(0.12, 0.38, up + (nz - 0.5) * 0.35 + snow_bias)
            else:
                s = crop(snow_mask)
            s = s * snow * (cov > 0.01)
            # snow piles a little: it bulges and rounds the surface
            sb = blur(s, 2 * ss)
            bulge = bulge + sb * snow_thick
            n = self._normals(bulge, normal_tilt)
            tint = (fbm(shape[0], shape[1], max(2, int(9 * ss)), snow_seed + 5, 2)[..., None] - 0.5) * 0.06
            sc = np.asarray(rgb("snow"), dtype=np.float64) + tint
            alb = alb * (1 - sb[..., None]) + sc * sb[..., None]
            spec = np.maximum(spec, sb * 0.5)
        if elev is None:
            elev = np.clip(self.foot[1] - self.Y[sl], 0, None)
        elev = np.broadcast_to(crop(elev), shape)
        A = self.a[sl]
        # the contact shadow onto what is already there
        if cast > 0:
            r = max(1, int(cast_r * ss))
            m = np.zeros_like(cov)
            dy, dx = int(cast_off[1] * ss), int(cast_off[0] * ss)
            hh, ww = shape
            m[max(0, dy):hh + min(0, dy), max(0, dx):ww + min(0, dx)] = \
                cov[max(0, -dy):hh - max(0, dy), max(0, -dx):ww - max(0, dx)]
            m = blur(m, r)
            self.occl[sl] *= 1 - np.clip(m - cov, 0, 1) * cast * (A > 0.01)
        # straight-alpha "over": the new part's share of each sample, so half-covered edges keep their own colour
        A_new = A + cov * (1 - A)
        w = np.where(A_new > 1e-6, cov / np.maximum(A_new, 1e-6), 0.0)
        c = w[..., None]
        self.alb[sl] = self.alb[sl] * (1 - c) + alb * c
        self.nrm[sl] = self.nrm[sl] * (1 - c) + n * c
        self.bulge[sl] = self.bulge[sl] * (1 - w) + bulge * w
        self.elev[sl] = np.maximum(self.elev[sl] * (1 - w), elev * w)
        self.spec[sl] = self.spec[sl] * (1 - w) + np.broadcast_to(spec, shape) * w
        self.occl[sl] = self.occl[sl] * (1 - w) + w  # a fresh part starts unshadowed
        self.unlit[sl] = self.unlit[sl] * (1 - w) + (1.0 if unlit else 0.0) * w
        if emit is not None:
            e = np.broadcast_to(np.asarray(crop(emit), dtype=np.float64), shape + (3,))
            self.emit[sl] = self.emit[sl] * (1 - c) + e * c
        else:
            self.emit[sl] = self.emit[sl] * (1 - c)
        self.a[sl] = A_new
        return cov

    def _normals(self, bulge, tilt=(0.0, 0.0)):
        ss = self.ss
        gy, gx = np.gradient(bulge * ss)  # bulge is in final px; the grid is ss times finer
        n = np.stack([-gx + tilt[0], -gy + tilt[1], np.ones_like(bulge)], -1)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        return n

    def darken_bottom(self, y0, y1, k=0.35):
        """Ambient occlusion near the ground: darker towards the foot (between y0 and y1)."""
        t = smoothstep(y0, y1, self.Y)
        self.occl *= 1 - t * k

    # ───────── shading and output ─────────
    def shade(self):
        n = self.nrm / np.maximum(1e-9, np.linalg.norm(self.nrm, axis=-1, keepdims=True))
        d = n @ _L
        wrap = np.clip((d + 0.3) / 1.3, 0, 1) ** 1.15
        sun = np.array(rgb("#fff4e4"))
        sky = np.array(rgb("#9db4e8"))
        bounce = np.array(rgb("#c8d4f0"))
        # sky fill from above (faces towards the camera and the top of the screen), a little ground bounce from below
        skyk = np.clip(n[..., 2] * 0.6 - n[..., 1] * 0.4, 0, 1)
        bnc = np.clip(n[..., 1], 0, 1) * 0.25
        ao = np.clip(1 - np.clip(blur(self.bulge, 6 * self.ss) - self.bulge, 0, None) * 0.06, 0.55, 1)
        # no occlusion on soft, half-covered edges (feathered snow would get a dark halo)
        ao = 1 - (1 - ao) * np.clip(self.a, 0, 1) ** 3
        light = sun * wrap[..., None] * (1 - AMBIENT) * 1.12 + sky * (AMBIENT * (0.55 + 0.45 * skyk))[..., None] \
            + bounce * bnc[..., None]
        light = light * _GAIN
        col = self.alb * light * (ao * self.occl)[..., None]
        # specular glints (snow, ice, metal)
        hv = _L + np.array([0, 0, 1.0])
        hv /= np.linalg.norm(hv)
        sp = np.clip(n @ hv, 0, 1) ** 24 * self.spec
        col = col + sp[..., None] * 0.45
        # cool rim on edges turned away from the sun: reads as volume against the snow
        rim = np.clip(1 - n[..., 2], 0, 1) ** 2 * np.clip(-(n[..., :2] @ _L[:2]) + 0.2, 0, 1) * self.a ** 2
        col = col + rim[..., None] * np.array(rgb("#a9c4ff")) * 0.18
        u = self.unlit[..., None]
        col = col * (1 - u) + self.alb * u + self.emit
        return np.clip(col, 0, 1)

    def _down(self, a):
        ss = self.ss
        if a.ndim == 2:
            return a.reshape(self.h, ss, self.w, ss).mean(axis=(1, 3))
        return a.reshape(self.h, ss, self.w, ss, a.shape[2]).mean(axis=(1, 3))

    def render(self):
        """→ (rgba uint8, normal rgba uint8, alpha float) at the final resolution."""
        col = self.shade()
        a = self.a
        pc = self._down(col * a[..., None])
        pa = self._down(a)
        rgbf = pc / np.maximum(pa[..., None], 1e-6)
        rgba = np.dstack([np.clip(rgbf, 0, 1), np.clip(pa, 0, 1)])
        n = self.nrm / np.maximum(1e-9, np.linalg.norm(self.nrm, axis=-1, keepdims=True))
        pn = self._down(n * a[..., None]) / np.maximum(pa[..., None], 1e-6)
        pn /= np.maximum(1e-9, np.linalg.norm(pn, axis=-1, keepdims=True))
        # Godot 2D reads normal maps OpenGL-style: green > 128 faces the top of the screen (our ny is screen-down)
        nm = np.dstack([pn[..., 0] * 0.5 + 0.5, 0.5 - pn[..., 1] * 0.5, pn[..., 2] * 0.5 + 0.5, np.clip(pa, 0, 1)])
        return (rgba * 255 + 0.5).astype(np.uint8), (nm * 255 + 0.5).astype(np.uint8), pa

    def shadow(self, strength=0.42, soft=3.0, sdir=SHADOW_DIR, squash=1.0):
        """The cast shadow: every covered sample is moved to its ground point plus elevation × sdir."""
        ss = self.ss
        e = self.elev * squash
        gx = self.X + e * sdir[0]
        gy = self.Y + e + e * sdir[1]   # its ground point is e px below it on screen, then the shadow offset
        m = self.a > 0.05
        pad = int(soft * 3 + 4)
        x0 = int(math.floor(min(gx[m].min(), 0))) - pad if m.any() else -pad
        y0 = int(math.floor(min(gy[m].min(), 0))) - pad if m.any() else -pad
        x1 = int(math.ceil(max(gx[m].max(), self.w))) + pad if m.any() else self.w + pad
        y1 = int(math.ceil(max(gy[m].max(), self.h))) + pad if m.any() else self.h + pad
        W, H = (x1 - x0) * ss, (y1 - y0) * ss
        acc = np.zeros((H, W))
        ix = np.clip(((gx[m] - x0) * ss).astype(np.int64), 0, W - 1)
        iy = np.clip(((gy[m] - y0) * ss).astype(np.int64), 0, H - 1)
        np.maximum.at(acc, (iy, ix), self.a[m])
        # close the holes the stretch leaves, then soften
        acc = np.maximum(acc, box_blur(acc, ss) * 1.6)
        acc = np.clip(acc, 0, 1)
        acc = acc.reshape(H // ss, ss, W // ss, ss).mean(axis=(1, 3))
        acc = blur(acc, soft)
        # fade with distance from the foot: long shadows are lighter at their tips
        hh, ww = acc.shape
        yy, xx = np.mgrid[0:hh, 0:ww]
        fx, fy = self.foot[0] - x0, self.foot[1] - y0
        dist = np.sqrt((xx - fx) ** 2 + (yy - fy) ** 2)
        fade = np.clip(1 - dist / max(60.0, dist[acc > 0.05].max() * 1.15 if (acc > 0.05).any() else 60.0), 0.35, 1)
        alpha = np.clip(acc * fade * strength, 0, 1)
        img = np.zeros((hh, ww, 4), dtype=np.uint8)
        img[..., 0:3] = np.array([18, 22, 52], dtype=np.uint8)
        img[..., 3] = (alpha * 255 + 0.5).astype(np.uint8)
        return img, (fx, fy)


# ───────────── output and the manifest ─────────────
def trim(rgba, foot, extra=None, margin=2):
    """Crop to the alpha's bounds (+margin); returns cropped images and the moved foot."""
    a = rgba[..., 3]
    ys, xs = np.nonzero(a > 2)
    if not len(xs):
        return rgba, foot, extra
    x0, x1 = max(0, xs.min() - margin), min(rgba.shape[1], xs.max() + 1 + margin)
    y0, y1 = max(0, ys.min() - margin), min(rgba.shape[0], ys.max() + 1 + margin)
    out = rgba[y0:y1, x0:x1]
    ex = [e[y0:y1, x0:x1] for e in extra] if extra else extra
    return out, (foot[0] - x0, foot[1] - y0), ex


def save_png(arr, path, quantize=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img = Image.fromarray(arr, "RGBA" if arr.shape[2] == 4 else "RGB")
    if quantize:
        img = img.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    img.save(path, optimize=True)


def res_path(path):
    return "res://" + os.path.relpath(path, GAME).replace(os.sep, "/")


class Manifest:
    def __init__(self, group):
        self.group = group
        self.items = {}

    def add(self, key, entry):
        assert key not in self.items, key
        self.items[key] = entry

    def write(self):
        path = os.path.join(ASSETS, "manifest", self.group + ".json")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(dict(sorted(self.items.items())), f, ensure_ascii=False, indent=1)
            f.write("\n")
        return path


def emit_sprite(man, key, cv, rel, shadow=True, normal=True, block=None, shadow_strength=0.42, shadow_soft=3.0,
                normal_scale=1.0, squash=1.0, extra=None, box=None):
    """Render a Canvas, trim it, write the PNGs under assets/<rel> and add the key to the manifest."""
    rgba, nm, _ = cv.render()
    foot = cv.foot
    if box is not None:
        # a fixed crop (x0, y0, x1, y1) in canvas px: keeps a sprite's size and foot when its content changes
        x0, y0, x1, y1 = box
        rgba, nm, foot2 = rgba[y0:y1, x0:x1], nm[y0:y1, x0:x1], (foot[0] - x0, foot[1] - y0)
    else:
        rgba, foot2, ex = trim(rgba, foot, [nm])
        nm = ex[0]
    path = os.path.join(ASSETS, rel + ".png")
    save_png(rgba, path)
    entry = {"file": res_path(path), "size": [int(rgba.shape[1]), int(rgba.shape[0])],
             "foot": [round(float(foot2[0]), 1), round(float(foot2[1]), 1)]}
    if normal:
        npath = os.path.join(ASSETS, rel + ".n.png")
        if normal_scale != 1.0:
            im = Image.fromarray(nm, "RGBA")
            im = im.resize((max(1, int(nm.shape[1] * normal_scale)), max(1, int(nm.shape[0] * normal_scale))),
                           Image.LANCZOS)
            nm = np.asarray(im)
        save_png(nm, npath)
        entry["normal"] = res_path(npath)
    if shadow:
        simg, sfoot = cv.shadow(shadow_strength, shadow_soft, squash=squash)
        z = np.zeros(4)
        simg, sfoot, _ = trim(simg, sfoot, None, margin=1)
        spath = os.path.join(ASSETS, rel + ".shadow.png")
        save_png(simg, spath)
        entry["shadow"] = {"file": res_path(spath), "foot": [round(float(sfoot[0]), 1), round(float(sfoot[1]), 1)]}
    if block is not None:
        entry["block"] = block
    if extra:
        entry.update(extra)
    man.add(key, entry)
    return entry


def colour_field(cv, a, b, t):
    """Per-pixel blend of two palette colours by field t (0..1)."""
    ca, cb = np.array(rgb(a) if isinstance(a, str) else a), np.array(rgb(b) if isinstance(b, str) else b)
    t = np.clip(t, 0, 1)[..., None]
    return ca * (1 - t) + cb * t
