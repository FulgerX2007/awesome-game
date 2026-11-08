"""Tiny signed-distance painter for the UI kit of Долгая зима on Godot.

Shapes are signed distance fields over a square canvas in unit coordinates (0..1, y down; negative inside).
`Canvas.fill` turns a field into a soft, lit volume: a dome height from the distance, a normal from its slope,
Lambert light from palette.LIGHT, a darker same-hue edge and a small specular glint. Everything is rendered
supersampled and downscaled by the caller, so edges come out smooth without outlines.
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from palette import LIGHT, rgb  # noqa: E402

_L = np.array(LIGHT, dtype=np.float64)
_L /= np.linalg.norm(_L)


def smin(a, b, k):
    """Smooth union of two fields (k: blend width in unit coordinates)."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def col(c):
    return np.array(rgb(c) if isinstance(c, str) else c, dtype=np.float64)


class Canvas:
    def __init__(self, size):
        self.n = size
        y, x = np.mgrid[0:size, 0:size].astype(np.float64)
        self.x = (x + 0.5) / size
        self.y = (y + 0.5) / size
        self.rgb = np.zeros((size, size, 3))
        self.a = np.zeros((size, size))

    # ── primitives (return fields) ──
    def circle(self, cx, cy, r):
        return np.hypot(self.x - cx, self.y - cy) - r

    def ellipse(self, cx, cy, rx, ry, rot=0.0):
        px, py = self._rot(cx, cy, rot)
        k = np.hypot(px / rx, py / ry)
        return (k - 1.0) * min(rx, ry)

    def box(self, cx, cy, w, h, r=0.0, rot=0.0):
        px, py = self._rot(cx, cy, rot)
        qx = np.abs(px) - (w / 2 - r)
        qy = np.abs(py) - (h / 2 - r)
        return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r

    def capsule(self, ax, ay, bx, by, r, r2=None):
        r2 = r if r2 is None else r2
        pax, pay = self.x - ax, self.y - ay
        bax, bay = bx - ax, by - ay
        h = np.clip((pax * bax + pay * bay) / (bax * bax + bay * bay + 1e-12), 0, 1)
        return np.hypot(pax - bax * h, pay - bay * h) - (r + (r2 - r) * h)

    def poly(self, pts):
        pts = np.asarray(pts, dtype=np.float64)
        d = np.full(self.x.shape, 1e9)
        s = np.ones(self.x.shape)
        n = len(pts)
        for i in range(n):
            ax, ay = pts[i]
            bx, by = pts[i - 1]
            ex, ey = bx - ax, by - ay
            wx, wy = self.x - ax, self.y - ay
            h = np.clip((wx * ex + wy * ey) / (ex * ex + ey * ey + 1e-12), 0, 1)
            d = np.minimum(d, np.hypot(wx - ex * h, wy - ey * h))
            c1 = self.y >= ay
            c2 = self.y < by
            c3 = ex * wy > ey * wx
            flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
            s = np.where(flip, -s, s)
        return s * d

    def ring(self, cx, cy, r, w, a0=None, a1=None):
        d = np.abs(np.hypot(self.x - cx, self.y - cy) - r) - w
        if a0 is not None:
            ang = np.arctan2(self.y - cy, self.x - cx)
            mid, half = (a0 + a1) / 2, (a1 - a0) / 2
            da = np.abs((ang - mid + math.pi) % (2 * math.pi) - math.pi)
            d = np.where(da <= half, d, 1e3)
            for a in (a0, a1):
                ex, ey = cx + math.cos(a) * r, cy + math.sin(a) * r
                d = np.minimum(d, np.hypot(self.x - ex, self.y - ey) - w)
        return d

    def star(self, cx, cy, r, inner=0.45, points=5, rot=-math.pi / 2):
        pts = []
        for i in range(points * 2):
            rr = r if i % 2 == 0 else r * inner
            a = rot + i * math.pi / points
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
        return self.poly(pts)

    def _rot(self, cx, cy, rot):
        px, py = self.x - cx, self.y - cy
        if rot:
            c, s = math.cos(rot), math.sin(rot)
            px, py = px * c + py * s, -px * s + py * c
        return px, py

    # ── painting ──
    def fill(self, d, base, hi=None, lo=None, bevel=0.05, edge=0.55, spec=0.5, grad=0.18, alpha=1.0, flat=False):
        """Paint field d as a lit volume of colour base (hi / lo override the lit and shaded ends)."""
        base = col(base)
        hi = col(hi) if hi is not None else np.minimum(1, base * 1.25 + 0.08)
        lo = col(lo) if lo is not None else base * 0.55 + col("#1a2338") * 0.12
        px = 1.0 / self.n
        cov = np.clip(0.5 - d / (1.2 * px), 0, 1) * alpha
        if flat:
            c = np.broadcast_to(base, self.rgb.shape).copy()
        else:
            t = np.clip(-d / bevel, 0, 1)
            h = np.sqrt(1 - (1 - t) ** 2) * bevel          # a rounded shoulder of height bevel
            gy, gx = np.gradient(h, px)
            nx, ny, nz = -gx, -gy, np.ones_like(h)
            ln = np.sqrt(nx * nx + ny * ny + nz * nz)
            dif = np.clip((nx * _L[0] + ny * _L[1] + nz * _L[2]) / ln, 0, 1)
            f = np.clip((dif - 0.15) / 0.8, 0, 1)
            f = np.clip(f + (0.5 - self.y) * grad, 0, 1)    # a touch lighter at the top of the icon
            c = lo[None, None] + (hi - lo)[None, None] * f[..., None]
            # darker same-hue edge for a crisp silhouette
            e = np.clip(1 + d / (2.5 * px), 0, 1) * edge
            c = c * (1 - e[..., None] * 0.45)
            if spec:
                sp = np.clip((dif - 0.88) / 0.1, 0, 1) ** 2 * spec
                c = c + sp[..., None] * (1 - c)
        self._over(c, cov)
        return self

    def glow(self, d, color, radius=0.08, strength=0.8):
        """Soft additive-looking light around (and inside) a field."""
        g = np.exp(-np.maximum(d, 0) / radius) * strength
        edge = np.minimum.reduce([self.x, 1 - self.x, self.y, 1 - self.y])
        g = g * np.clip(edge / 0.12, 0, 1) ** 2          # fade out before the canvas border
        self._over(np.broadcast_to(col(color), self.rgb.shape), np.clip(g, 0, 1))
        return self

    def tint(self, d, color, amount):
        """Recolour what is already painted inside d (keeps alpha)."""
        cov = np.clip(0.5 - d * self.n / 1.2, 0, 1) * amount
        self.rgb = self.rgb * (1 - cov[..., None]) + col(color)[None, None] * cov[..., None]
        return self

    def _over(self, c, a):
        a3 = a[..., None]
        out_a = a + self.a * (1 - a)
        self.rgb = np.where(out_a[..., None] > 1e-6,
                            (c * a3 + self.rgb * self.a[..., None] * (1 - a3)) / np.maximum(out_a, 1e-6)[..., None],
                            self.rgb)
        self.a = out_a

    def image(self):
        arr = np.dstack([np.clip(self.rgb, 0, 1), np.clip(self.a, 0, 1)])
        return Image.fromarray((arr * 255 + 0.5).astype(np.uint8), "RGBA")


def finish_icon(img, out_size, shadow=True):
    """Downscale a supersampled icon and give it a soft navy drop shadow for legibility on any background."""
    small = img.resize((out_size, out_size), Image.LANCZOS)
    if not shadow:
        return small
    a = small.split()[3]
    sh = Image.new("L", small.size, 0)
    sh.paste(a, (max(1, out_size // 64), max(2, out_size // 40)))
    sh = sh.filter(ImageFilter.GaussianBlur(out_size / 48))
    sh = sh.point(lambda v: int(v * 0.5))
    base = Image.new("RGBA", small.size, (10, 14, 30, 0))
    base.putalpha(sh)
    return Image.alpha_composite(base, small)
