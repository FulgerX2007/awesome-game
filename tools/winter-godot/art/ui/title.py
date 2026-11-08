"""The game logo: «Долгая зима» (and «Iarna lungă») in Golos Text Black, carved from ice: a rounded lit volume,
snow caps on the tops of the letters, icicles hanging from their bottoms, a warm fire glow underneath."""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from sdf import col

FONT = os.path.join(os.path.dirname(__file__), "../../../../godot/winter/assets/fonts/GolosText.ttf")
LIGHT = np.array([-0.55, -0.65, 0.52])
LIGHT = LIGHT / np.linalg.norm(LIGHT)
K = 2


def blur(a, r):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(r))
    return np.asarray(im, dtype=np.float64) / 255


def lit(h, scale):
    gy, gx = np.gradient(h * scale)
    n = np.dstack([-gx, -gy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return np.clip(n @ LIGHT, 0, 1)


def over(rgb, a, c, ca):
    ca = np.clip(ca, 0, 1)
    out = ca + a * (1 - ca)
    c = np.broadcast_to(c, rgb.shape)
    rgb = np.where(out[..., None] > 1e-6, (c * ca[..., None] + rgb * (a * (1 - ca))[..., None]) / np.maximum(out, 1e-6)[..., None], rgb)
    return rgb, out


def make(text, out_w=1200, seed=3):
    size = 150 * K
    font = ImageFont.truetype(FONT, size)
    font.set_variation_by_name("Black")
    l, t, r, b = font.getbbox(text)
    pad = 60 * K
    W, H = r - l + pad * 2, b - t + pad * 2
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).text((pad - l, pad - t), text, font=font, fill=255)
    M = np.asarray(m, dtype=np.float64) / 255
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)

    # snow caps: lumps along the top edges of the letters
    hard = M > 0.5
    above = np.zeros_like(hard)
    below = np.zeros_like(hard)
    for k in range(3, 40):                      # open sky above / open air below, not a letter's counter
        above |= np.roll(hard, k * K, axis=0)
        below |= np.roll(hard, -k * K, axis=0)
    top = hard & ~np.roll(hard, 4 * K, axis=0) & ~above
    bottom = hard & ~np.roll(hard, -2 * K, axis=0) & ~below
    snow = np.zeros_like(M)
    ty, tx = np.nonzero(top)
    for i in rng.choice(len(tx), size=min(len(tx), 150), replace=False):
        rad = rng.uniform(4.5, 8.5) * K
        cy = ty[i] + rad * 0.25
        x0, x1, y0, y1 = int(tx[i] - rad - 2), int(tx[i] + rad + 3), int(cy - rad - 2), int(cy + rad + 3)
        sub = np.hypot(xx[y0:y1, x0:x1] - tx[i], yy[y0:y1, x0:x1] - cy)
        snow[y0:y1, x0:x1] = np.maximum(snow[y0:y1, x0:x1], np.clip(rad - sub + 0.5, 0, 1))
    snow = np.maximum(blur(snow, 1.5 * K) * 1.4, 0) * (blur(M, 9 * K) > 0.08)
    snow = np.clip(snow, 0, 1)

    # icicles: tapered spikes hanging from the bottom edges
    ice = np.zeros_like(M)
    by, bx = np.nonzero(bottom)
    picks = rng.choice(len(bx), size=min(len(bx), 70), replace=False)
    for i in picks:
        ln = rng.uniform(10, 34) * K * (1.0 if rng.random() < 0.7 else 0.5)
        w = rng.uniform(2.5, 4.5) * K
        x, y = bx[i], by[i] - 2 * K
        x0, x1, y0, y1 = int(x - w - 2), int(x + w + 3), int(y), int(y + ln + 2)
        sx, sy = xx[y0:y1, x0:x1] - x, yy[y0:y1, x0:x1] - y
        half = w * np.clip(1 - sy / ln, 0, 1) ** 1.3
        ice[y0:y1, x0:x1] = np.maximum(ice[y0:y1, x0:x1], np.clip(half - np.abs(sx) + 0.5, 0, 1) * (sy >= 0))

    rgb = np.zeros((H, W, 3))
    a = np.zeros((H, W))
    # warm fire glow underneath and a navy halo for legibility on any backdrop
    glow = np.exp(-(((xx - W / 2) / (W * 0.36)) ** 2 + ((yy - H * 0.72) / (H * 0.24)) ** 2))
    win = np.clip(np.minimum(xx, W - xx) / (W * 0.15), 0, 1) * np.clip(np.minimum(yy, H - yy) / (H * 0.25), 0, 1)
    rgb, a = over(rgb, a, col("#ff8a2a"), glow * 0.42 * win ** 2)
    halo = blur(np.maximum(M, snow), 14 * K)
    rgb, a = over(rgb, a, col("#0b1226"), np.clip(halo * 1.6, 0, 1) * 0.55)

    # the letters: ice, lit from the upper left, deeper blue towards the bottom
    h = blur(M, 7 * K) * M
    d = lit(h, 30.0)
    vert = np.clip((yy - pad) / (H - 2 * pad), 0, 1)[..., None]
    hi = col("#ffffff") * (1 - vert) + col("#cfe6ff") * vert
    lo = col("#4f74b0") * (1 - vert) + col("#1f3d78") * vert
    c = lo + (hi - lo) * np.clip((d - 0.1) / 0.75, 0, 1)[..., None]
    edge = np.clip(1 - blur(M, 1.2 * K) * 1.0, 0, 1) * M
    c = c * (1 - edge[..., None] * 0.4)
    # an inner frost texture: faint diagonal streaks
    streak = (np.sin((xx * 0.7 + yy) / (9 * K)) * 0.5 + 0.5) ** 8 * 0.18
    c = c + streak[..., None] * (1 - c)
    rgb, a = over(rgb, a, c, M)

    # icicles: translucent ice with a bright core line
    ic = col("#bfe4ff") * 0.8 + col("#ffffff") * 0.2
    rgb, a = over(rgb, a, ic, ice * 0.88)
    core = ice * (blur(ice, 0.8 * K) > 0.85)
    rgb, a = over(rgb, a, col("#ffffff"), core * 0.6)

    # snow: soft white lumps, lit
    sd = lit(blur(snow, 2 * K), 18.0)
    sc = col("#a9bddf") + (col("#ffffff") - col("#a9bddf")) * np.clip((sd - 0.1) / 0.7, 0, 1)[..., None]
    rgb, a = over(rgb, a, sc, snow)

    # sparkles on the ice
    for _ in range(9):
        i = rng.integers(len(tx))
        x, y = tx[i] + rng.uniform(-20, 20) * K, ty[i] + rng.uniform(10, 50) * K
        s = rng.uniform(6, 13) * K
        star = np.maximum(np.clip(1 - np.abs(xx - x) / (0.9 * K), 0, 1) * np.clip(1 - np.abs(yy - y) / s, 0, 1),
                          np.clip(1 - np.abs(yy - y) / (0.9 * K), 0, 1) * np.clip(1 - np.abs(xx - x) / s, 0, 1))
        rgb, a = over(rgb, a, col("#ffffff"), star * 0.9 * M)

    img = Image.fromarray((np.dstack([np.clip(rgb, 0, 1), np.clip(a, 0, 1)]) * 255 + 0.5).astype(np.uint8), "RGBA")
    bbox = img.getchannel("A").point(lambda v: 255 if v > 6 else 0).getbbox()
    img = img.crop(bbox)
    out_h = round(img.size[1] * out_w / img.size[0])
    return img.resize((out_w, out_h), Image.LANCZOS)
