"""Nine-slice textures of the UI kit: frosted navy glass panels, buttons in four states, stat bars, slots, tooltips.

Each is drawn at 2× and downscaled. The returned margins are the nine-slice borders (left, top, right, bottom) in
output pixels: corners keep their rim, frost and shadow, the middle stretches.
"""
import numpy as np
from PIL import Image

from sdf import col

K = 2   # supersampling


class Plate:
    def __init__(self, w, h):
        self.w, self.h = w * K, h * K
        y, x = np.mgrid[0:self.h, 0:self.w].astype(np.float64)
        self.x, self.y = x + 0.5, y + 0.5
        self.rgb = np.zeros((self.h, self.w, 3))
        self.a = np.zeros((self.h, self.w))

    def rrect(self, x0, y0, x1, y1, r):
        """Signed distance (in output px) to a rounded rectangle given in output px."""
        x0, y0, x1, y1, r = (v * K for v in (x0, y0, x1, y1, r))
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        qx = np.abs(self.x - cx) - ((x1 - x0) / 2 - r)
        qy = np.abs(self.y - cy) - ((y1 - y0) / 2 - r)
        d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
        return d / K

    def vgrad(self, top, bottom, y0, y1):
        t = np.clip((self.y / K - y0) / max(1e-6, y1 - y0), 0, 1)[..., None]
        return col(top)[None, None] * (1 - t) + col(bottom)[None, None] * t

    def over(self, c, a):
        c = np.broadcast_to(c, self.rgb.shape)
        a = np.clip(a, 0, 1)
        out = a + self.a * (1 - a)
        self.rgb = np.where(out[..., None] > 1e-6, (c * a[..., None] + self.rgb * (self.a * (1 - a))[..., None]) / np.maximum(out, 1e-6)[..., None], self.rgb)
        self.a = out

    def image(self, w, h):
        arr = np.dstack([np.clip(self.rgb, 0, 1), np.clip(self.a, 0, 1)])
        return Image.fromarray((arr * 255 + 0.5).astype(np.uint8), "RGBA").resize((w, h), Image.LANCZOS)


def cov(d):
    return np.clip(0.5 - d * K / 1.2, 0, 1)


def shadow(p, d, blur, alpha, dy=0.0):
    """A soft drop shadow from a field d (shifted down by dy px)."""
    if dy:
        d = np.roll(d, int(dy * K), axis=0)
    p.over(col("#05080f"), np.clip(1 - (d + blur * 0.2) / blur, 0, 1) ** 2 * alpha)


def glass(w, h, r, m, top, bottom, alpha, rim_top, rim_bottom, rim_a=0.75, frost=True, glow="#9fd3ee", glow_a=0.16,
          sheen=0.07, warm=None, dy=0.0, inner_shadow=0.0, outer_glow=None):
    p = Plate(w, h)
    d = p.rrect(m, m + dy, w - m, h - m + dy, r)
    shadow(p, p.rrect(m, m + 2, w - m, h - m + 3, r), m * 0.9, 0.55)
    if outer_glow:
        p.over(col(outer_glow), np.clip(1 - np.maximum(d, 0) / (m * 0.9), 0, 1) ** 2 * 0.35 * (d > -1))
    body = cov(d)
    p.over(p.vgrad(top, bottom, m, h - m), body * alpha)
    inside = np.clip(-d, 0, None)
    # cold light along the inner edge, a faint sheen across the top-left
    p.over(col(glow), body * np.exp(-inside / 5.0) * glow_a)
    yy, xx = p.y / K, p.x / K
    p.over(col("#ffffff"), body * np.clip(1 - (yy - m) / (h * 0.45), 0, 1) ** 2 * np.clip(1 - (xx - m) / (w * 0.8), 0.2, 1) * sheen)
    if inner_shadow:
        p.over(col("#05080f"), body * np.exp(-np.clip(yy - m - dy, 0, None) / 4.0) * inner_shadow)
    # the rim: light on top, darker below; warm when active
    ring = np.clip(1 - np.abs(d + 0.9) / 1.0, 0, 1)
    t = np.clip((yy - m) / max(1, h - 2 * m), 0, 1)[..., None]
    rc = col(rim_top)[None, None] * (1 - t) + col(rim_bottom)[None, None] * t
    if warm:
        rc = np.broadcast_to(col(warm), rc.shape)
    p.over(rc, ring * rim_a)
    if frost:
        # hoarfrost settled in the top-left corner: a soft rime along the rim and a few crystals
        haze = np.exp(-np.hypot(xx - m, yy - m) / (r * 0.9)) * np.exp(-inside / 3.0)
        p.over(col("#eaf6ff"), body * haze * 0.55)
        rng = np.random.default_rng(7)
        for _ in range(9):
            a = rng.uniform(np.pi * 1.05, 1.45 * np.pi)
            cx = m + r + np.cos(a) * (r - 1.5)
            cy = m + r + np.sin(a) * (r - 1.5)
            for k in range(3):
                ang = k * np.pi / 3 + a
                arm = np.abs((xx - cx) * np.sin(ang) - (yy - cy) * np.cos(ang)) - 0.35
                arm = np.maximum(arm, np.hypot(xx - cx, yy - cy) - rng.uniform(1.2, 2.2))
                p.over(col("#ffffff"), cov(arm) * body * 0.7)
    return p


def bar_fill(w, h, r):
    """White with a gloss band: the game tints it with the stat's colour."""
    p = Plate(w, h)
    d = p.rrect(1, 1, w - 1, h - 1, r)
    p.over(p.vgrad("#ffffff", "#b8c0cc", 1, h - 1), cov(d))
    yy = p.y / K
    p.over(col("#ffffff"), cov(d) * np.clip(1 - np.abs(yy - h * 0.3) / (h * 0.18), 0, 1) * 0.6)
    p.over(col("#606a7a"), cov(d) * np.clip(1 - np.abs(d + 0.6) / 0.9, 0, 1) * 0.5 * (yy > h * 0.5))
    return p


def trough(w, h, r, m):
    p = Plate(w, h)
    d = p.rrect(m, m, w - m, h - m, r)
    body = cov(d)
    yy = p.y / K
    p.over(p.vgrad("#070b15", "#141c30", m, h - m), body * 0.88)
    p.over(col("#000000"), body * np.exp(-np.clip(yy - m, 0, None) / 3.0) * 0.5)
    ring = np.clip(1 - np.abs(d + 0.8) / 1.0, 0, 1)
    t = np.clip((yy - m) / (h - 2 * m), 0, 1)[..., None]
    p.over(col("#1c2640")[None, None] * (1 - t) + col("#7f95c2")[None, None] * t, ring * 0.8)
    return p


# name -> (builder, output size, slice margins)
def build():
    out = {}
    out["ui.panel"] = (glass(128, 128, 20, 8, "#2a3858", "#141c30", 0.9, "#cfe6ff", "#3a4a70"), (128, 128), [32, 32, 32, 32])
    out["ui.panel.dark"] = (glass(128, 128, 20, 8, "#18213a", "#0b101d", 0.96, "#7f95c2", "#232e4a", rim_a=0.6,
                                  glow_a=0.08, sheen=0.04), (128, 128), [32, 32, 32, 32])
    out["ui.button"] = (glass(96, 96, 18, 6, "#3a4d78", "#1e2944", 0.97, "#dbeeff", "#16203a", sheen=0.1, frost=False),
                        (96, 96), [26, 26, 26, 26])
    out["ui.button.hover"] = (glass(96, 96, 18, 6, "#4a63a0", "#26355e", 0.98, "#ffffff", "#2a3a66", rim_a=0.95, sheen=0.14,
                                    glow="#cfe6ff", glow_a=0.3, frost=False, outer_glow="#9fd3ee"), (96, 96), [26, 26, 26, 26])
    out["ui.button.pressed"] = (glass(96, 96, 18, 6, "#1a2440", "#2a385e", 0.98, "#ffb35a", "#ffb35a", rim_a=0.95, sheen=0.0,
                                      glow="#ffb35a", glow_a=0.22, frost=False, warm="#ffb35a", dy=1.5, inner_shadow=0.45),
                                (96, 96), [26, 26, 26, 26])
    out["ui.button.disabled"] = (glass(96, 96, 18, 6, "#2a3040", "#1c2029", 0.7, "#5c6578", "#242833", rim_a=0.5, sheen=0.02,
                                       glow="#5c6578", glow_a=0.05, frost=False), (96, 96), [26, 26, 26, 26])
    out["ui.bar.frame"] = (trough(64, 32, 12, 2), (64, 32), [14, 14, 14, 14])
    out["ui.bar.fill"] = (bar_fill(48, 24, 9), (48, 24), [10, 10, 10, 10])
    slot = Plate(96, 96)
    d = slot.rrect(4, 4, 92, 92, 14)
    body = cov(d)
    yy, xx = slot.y / K, slot.x / K
    slot.over(slot.vgrad("#0a0f1c", "#16203a", 4, 92), body * 0.8)
    slot.over(col("#000000"), body * np.exp(-np.clip(np.minimum(yy, xx) - 4, 0, None) / 6.0) * 0.45)
    ring = np.clip(1 - np.abs(d + 0.8) / 1.0, 0, 1)
    slot.over(col("#5a6e98"), ring * np.clip((yy + xx) / 184, 0.15, 1) * 0.85)
    out["ui.slot"] = (slot, (96, 96), [22, 22, 22, 22])
    out["ui.tooltip"] = (glass(64, 64, 10, 5, "#1c2540", "#0e1424", 0.96, "#ffb35a", "#8a5a2a", rim_a=0.7, glow="#ffb35a",
                               glow_a=0.08, sheen=0.05, frost=False), (64, 64), [18, 18, 18, 18])
    return {k: (p.image(*size), margins) for k, (p, size, margins) in out.items()}
