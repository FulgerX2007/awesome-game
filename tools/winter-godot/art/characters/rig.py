"""A small 2.5D puppet renderer for the characters of Долгая зима.

A figure is a list of parts in 3D (x right, y up, z towards the viewer, in texture pixels, the foot at the origin):
capsules and spheres with a colour. The camera looks down at TILT; every part projects to a 2D capsule whose dome
gives depth and a normal, the nearest surface wins per subpixel (a z-buffer, so volumes intersect softly), then
the frame is shaded once with the palette's light, a soft same-hue rim, screen-space occlusion and a cool sky bounce.
Supersampled SS×SS and box-filtered. Outputs colour (RGBA), a normal map (green = up on screen, as Godot 2D reads
it) and an optional tint layer (the parts marked `tint`, shaded white, for the coat colour the game picks).
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from palette import LIGHT, AMBIENT, rgb  # noqa: E402

TILT = math.radians(32)
CT, ST = math.cos(TILT), math.sin(TILT)
SS = 3

_L = np.array(LIGHT, dtype=np.float64)
_L /= np.linalg.norm(_L)
_SKY = np.array([0.72, 0.55, 0.38])
_SKY /= np.linalg.norm(_SKY)


def v3(x, y, z):
    return np.array([x, y, z], dtype=np.float64)


def norm(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


class Part:
    __slots__ = ("a", "b", "r0", "r1", "col", "tint", "flat", "bias", "rim")

    def __init__(self, a, b, r0, r1, col, tint=False, flat=False, bias=0.0, rim=1.0):
        self.a, self.b, self.r0, self.r1 = a, b, r0, r1
        self.col = rgb(col) if isinstance(col, str) else col
        self.tint, self.flat, self.bias, self.rim = tint, flat, bias, rim


class Figure:
    """Collects parts for one frame."""

    def __init__(self):
        self.parts = []

    def cap(self, a, b, r0, col, r1=None, **kw):
        self.parts.append(Part(np.asarray(a, float), np.asarray(b, float), r0, r0 if r1 is None else r1, col, **kw))

    def ball(self, c, r, col, **kw):
        c = np.asarray(c, float)
        self.parts.append(Part(c, c, r, r, col, **kw))

    def ring(self, c, axis, side, R, r, col, n=8, phase=0.0, **kw):
        """Spheres round a circle (a fur trim, a scarf, a belt): axis is the ring's normal, side one radius dir."""
        axis = norm(np.asarray(axis, float))
        side = norm(np.asarray(side, float) - axis * np.dot(side, axis))
        other = np.cross(axis, side)
        for k in range(n):
            a = phase + k * 2 * math.pi / n
            self.ball(np.asarray(c, float) + R * (side * math.cos(a) + other * math.sin(a)), r, col, **kw)


def project(p):
    return p[0], -p[1] * CT + p[2] * ST, p[2] * CT + p[1] * ST


def render(fig, w, h, foot):
    """→ (color HxWx4 float, normal HxWx3 float in -1..1 screen space y down, tint HxWx4 float)."""
    W, H = w * SS, h * SS
    fx, fy = foot[0] * SS, foot[1] * SS
    depth = np.full((H, W), -1e9)
    nrm = np.zeros((H, W, 3))
    base = np.zeros((H, W, 3))
    edge = np.zeros((H, W))
    flags = np.zeros((H, W), np.int8)   # 1 covered, 2 tint, 4 flat
    for p in fig.parts:
        ax, ay, ad = project(p.a)
        bx, by, bd = project(p.b)
        ax, ay, bx, by = fx + ax * SS, fy + ay * SS, fx + bx * SS, fy + by * SS
        r0, r1 = p.r0 * SS, p.r1 * SS
        rm = max(r0, r1)
        x0, x1 = int(max(0, math.floor(min(ax, bx) - rm))), int(min(W, math.ceil(max(ax, bx) + rm) + 1))
        y0, y1 = int(max(0, math.floor(min(ay, by) - rm))), int(min(H, math.ceil(max(ay, by) + rm) + 1))
        if x0 >= x1 or y0 >= y1:
            continue
        ys, xs = np.mgrid[y0:y1, x0:x1]
        px, py = xs + 0.5, ys + 0.5
        dx, dy = bx - ax, by - ay
        ll = dx * dx + dy * dy
        if ll < 1e-6:
            t = np.zeros_like(px)
        else:
            t = np.clip(((px - ax) * dx + (py - ay) * dy) / ll, 0, 1)
        qx, qy = ax + t * dx, ay + t * dy
        ox, oy = px - qx, py - qy
        d2 = ox * ox + oy * oy
        r = r0 + (r1 - r0) * t
        inside = d2 < r * r
        if not inside.any():
            continue
        hh = np.sqrt(np.maximum(r * r - d2, 0))
        dep = (ad + (bd - ad) * t) * SS + hh + p.bias * SS
        sub = depth[y0:y1, x0:x1]
        win = inside & (dep > sub)
        if not win.any():
            continue
        sub[win] = dep[win]
        nn = np.stack([ox / r, oy / r, hh / r], -1)
        if p.flat:
            nn[...] = (0, 0, 1)
        nrm[y0:y1, x0:x1][win] = nn[win]
        base[y0:y1, x0:x1][win] = p.col
        edge[y0:y1, x0:x1][win] = (np.sqrt(d2) / r)[win] * p.rim
        f = 1 | (2 if p.tint else 0) | (4 if p.flat else 0)
        flags[y0:y1, x0:x1][win] = f
    cov = (flags & 1) > 0
    # screen-space occlusion: a surface well behind its neighbourhood sits in a crease
    dfill = np.where(cov, depth, np.nan)
    ao = _ao(dfill, cov)
    lam = np.clip((nrm * _L).sum(-1), 0, 1)
    sky = np.clip((nrm * _SKY).sum(-1), 0, 1) ** 3
    shade = AMBIENT + (1 - AMBIENT) * lam
    warm = np.array([1.05, 1.0, 0.93])
    cool = np.array([0.74, 0.82, 1.0])
    tone = cool + (warm - cool) * lam[..., None]
    e = np.clip((edge - 0.72) / 0.28, 0, 1) ** 2
    def shade_of(col):
        c = col * shade[..., None] * tone
        c = c + np.array([0.55, 0.68, 0.95]) * (0.16 * sky)[..., None]
        c = c * (1 - 0.3 * e)[..., None] * (1 - 0.45 * ao)[..., None]
        return c
    flat = (flags & 4) > 0
    color = shade_of(base)
    color[flat] = (base * (0.82 + 0.18 * (1 - ao))[..., None])[flat]
    tintm = (flags & 2) > 0
    tcol = shade_of(np.ones_like(base))
    # box filter down to the frame
    a = cov.astype(float)
    out = _down(np.concatenate([np.clip(color, 0, 1) * a[..., None], a[..., None]], -1))
    col = out[..., :3] / np.maximum(out[..., 3:], 1e-6)
    color_out = np.concatenate([col, out[..., 3:]], -1)
    n_out = _down(np.where(cov[..., None], nrm, 0))
    nl = np.linalg.norm(n_out, axis=-1, keepdims=True)
    n_out = np.where(nl > 1e-6, n_out / np.maximum(nl, 1e-6), np.array([0, 0, 1.0]))
    ta = tintm.astype(float)
    tout = _down(np.concatenate([np.clip(tcol, 0, 1) * ta[..., None], ta[..., None]], -1))
    tc = tout[..., :3] / np.maximum(tout[..., 3:], 1e-6)
    return color_out, n_out, np.concatenate([tc, tout[..., 3:]], -1)


def _down(img):
    H, W = img.shape[:2]
    return img.reshape(H // SS, SS, W // SS, SS, -1).mean(axis=(1, 3))


def _ao(dfill, cov):
    k = 6 * SS
    d = np.where(cov, dfill, 0.0)
    m = cov.astype(float)
    sd, sm = _box(d, k), _box(m, k)
    avg = sd / np.maximum(sm, 1e-6)
    ao = np.clip((avg - np.where(cov, dfill, avg)) / (14.0 * SS), 0, 1)
    return np.where(cov, ao, 0)


def _box(a, k):
    c = np.cumsum(np.cumsum(np.pad(a, ((1, 0), (1, 0))), 0), 1)
    H, W = a.shape
    y0 = np.clip(np.arange(H) - k, 0, H)
    y1 = np.clip(np.arange(H) + k + 1, 0, H)
    x0 = np.clip(np.arange(W) - k, 0, W)
    x1 = np.clip(np.arange(W) + k + 1, 0, W)
    return c[y1][:, x1] - c[y0][:, x1] - c[y1][:, x0] + c[y0][:, x0]


# ── keyframes ──
def smooth(t):
    return t * t * (3 - 2 * t)


def keys(p, ks, loop=True):
    """Interpolates a list of (time 0..1, value) keyframes with smoothstep easing at phase p."""
    if loop:
        p = p % 1.0
    if p <= ks[0][0]:
        return ks[0][1]
    for (t0, a), (t1, b) in zip(ks, ks[1:]):
        if p <= t1:
            u = smooth((p - t0) / max(t1 - t0, 1e-9))
            return a + (b - a) * u
    if loop and ks[-1][0] < 1:
        t0, a = ks[-1]
        t1, b = 1.0, ks[0][1]
        u = smooth((p - t0) / max(t1 - t0, 1e-9))
        return a + (b - a) * u
    return ks[-1][1]


def rot(axis, ang):
    """Rotation matrix about a unit axis."""
    x, y, z = norm(np.asarray(axis, float))
    c, s = math.cos(ang), math.sin(ang)
    C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])
