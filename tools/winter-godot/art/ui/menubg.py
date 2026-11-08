"""The menu backdrop: a snowy spruce forest at dusk, layers fading into violet haze, mountains, a crescent moon,
a camp far off with a fire whose warm light spills over the snow, and soft falling snow. 1920×1080, JPEG."""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from sdf import col

W, H = 1920, 1080
K = 2


def lerp(a, b, t):
    return a + (b - a) * t


def gradient(stops, h, w):
    ys = np.linspace(0, 1, h)
    out = np.zeros((h, 3))
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        m = (ys >= t0) & (ys <= t1)
        k = ((ys[m] - t0) / (t1 - t0))[:, None]
        out[m] = col(c0) * (1 - k) + col(c1) * k
    return np.repeat(out[:, None, :], w, axis=1)


def to_img(arr):
    return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")


def hexc(c, a=255):
    r, g, b = (int(v * 255 + 0.5) for v in col(c))
    return (r, g, b, a)


def mixc(a, b, t):
    return tuple(col(a) * (1 - t) + col(b) * t)


def pine(d, x, base, h, body, snow, rng, lit=None):
    """A spruce of drooping tiers with snow lying on top of each, brighter on the lit (left) side."""
    lit = lit or snow
    tiers = 7
    w = h * 0.4
    for i in range(tiers):
        t = i / tiers
        ty = base - h * t * 0.84
        tw = w * (1 - t * 0.8) * rng.uniform(0.9, 1.08)
        th = h * 0.22
        ax = x + rng.uniform(-0.006, 0.006) * h
        A = (ax, ty - th)
        L, R = (x - tw, ty + th * 0.1), (x + tw, ty + th * 0.04)
        d.polygon([A, L, (x - tw * 0.55, ty - th * 0.02), (x - tw * 0.2, ty + th * 0.14), (x + tw * 0.25, ty + th * 0.08),
                   (x + tw * 0.6, ty), R], fill=body)
        j = rng.uniform(0.75, 1.15)
        sl = [A, (L[0] + tw * 0.08, L[1] - th * 0.1 * j), (x - tw * 0.55, ty - th * 0.36 * j), (x - tw * 0.2, ty - th * 0.3), (ax, ty - th * 0.42)]
        sr = [A, (ax, ty - th * 0.42), (x + tw * 0.25, ty - th * 0.36), (x + tw * 0.6, ty - th * 0.4 * j), (R[0] - tw * 0.1, R[1] - th * 0.18 * j)]
        d.polygon(sr, fill=snow)
        d.polygon(sl, fill=lit)
    d.polygon([(x, base - h - h * 0.05), (x - w * 0.1, base - h * 0.8), (x + w * 0.1, base - h * 0.8)], fill=body)
    d.polygon([(x, base - h - h * 0.05), (x - w * 0.06, base - h * 0.86), (x, base - h * 0.9)], fill=lit)
    d.rectangle([x - h * 0.02, base - h * 0.06, x + h * 0.02, base + h * 0.02], fill=body)


def hills(y0, amp, seed, w=W * K):
    rng = np.random.default_rng(seed)
    xs = np.arange(w)
    y = np.full(w, y0 * K, dtype=np.float64)
    for f, a in ((1.3, 1.0), (3.1, 0.45), (7.3, 0.18)):
        y += np.sin(xs / w * math.pi * 2 * f + rng.uniform(0, 6.28)) * amp * K * a
    return y


def fill_below(d, ys, color):
    pts = [(x, ys[x]) for x in range(0, len(ys), 8)] + [(len(ys) - 1, ys[-1]), (len(ys) - 1, H * K), (0, H * K)]
    d.polygon(pts, fill=color)


def snowfield(img, ground, top, low, depth):
    """Snow below a ridge line: bright along the crest, bluer lower down (the ridge casts its own shade)."""
    w = W
    gx = ground[::K][:w] / K
    yy = np.arange(H)[:, None].astype(np.float64)
    t = np.clip((yy - gx[None, :]) / depth, 0, 1)
    c = np.array(top)[None, None] * (1 - t[..., None]) + np.array(low)[None, None] * t[..., None]
    # a lit lip right at the crest
    c = c + np.exp(-np.abs(yy - gx[None, :] - 3) / 3)[..., None] * 0.08
    layer = to_img(c).convert("RGBA").resize(img.size, Image.BICUBIC)
    mask = Image.new("L", img.size, 0)
    fill_below(ImageDraw.Draw(mask), ground, 255)
    layer.putalpha(mask)
    img.alpha_composite(layer)


def camp(img, ground, xx, yy, rng):
    """A cabin with a lit window and a campfire in the clearing; its warm light pools on the snow."""
    cx = 1230 * K
    cy = ground[cx] + 10 * K
    g = np.exp(-(((xx - cx / K) / 260) ** 2 + ((yy - cy / K) / 80) ** 2)) * 0.8
    g += np.exp(-(((xx - cx / K) / 110) ** 2 + ((yy - cy / K + 50) / 110) ** 2)) * 0.6
    glow = Image.fromarray((np.clip(g, 0, 1) * 255).astype(np.uint8), "L").resize(img.size, Image.BICUBIC)
    warm = Image.new("RGBA", img.size, hexc("#ff9a40"))
    warm.putalpha(glow.point(lambda v: int(v * 0.7)))
    img.alpha_composite(warm)
    d = ImageDraw.Draw(img)
    s = 1.5 * K
    hx, hy = cx - 150 * K, cy - 14 * K
    d.rectangle([hx - 46 * s, hy - 38 * s, hx + 46 * s, hy], fill=hexc("#2b2338"))
    for k in range(4):
        y = hy - 38 * s + k * 9.5 * s
        d.line([hx - 46 * s, y, hx + 46 * s, y], fill=hexc("#3d3048"), width=int(2 * s))
    d.rectangle([hx + 24 * s, hy - 74 * s, hx + 34 * s, hy - 40 * s], fill=hexc("#2b2338"))
    d.polygon([(hx - 58 * s, hy - 36 * s), (hx, hy - 72 * s), (hx + 58 * s, hy - 36 * s)], fill=hexc("#221b30"))
    d.polygon([(hx - 61 * s, hy - 35 * s), (hx, hy - 76 * s), (hx + 61 * s, hy - 35 * s), (hx + 30 * s, hy - 46 * s), (hx, hy - 63 * s), (hx - 30 * s, hy - 46 * s)], fill=hexc("#dcdcf0"))
    d.rectangle([hx - 30 * s, hy - 28 * s, hx - 12 * s, hy - 12 * s], fill=hexc("#ffc46a"))
    d.rectangle([hx + 8 * s, hy - 30 * s, hx + 24 * s, hy], fill=hexc("#1a1424"))
    # logs and flames
    for k in (-1, 1):
        d.line([cx - 16 * K * k, cy + 2 * K, cx + 14 * K * k, cy - 6 * K], fill=hexc("#3a2620"), width=int(5 * K))
    for k, (fw, fh0) in enumerate(((16, 70), (13, 56), (14, 62), (10, 44), (9, 40), (7, 30))):
        fx = cx + rng.uniform(-10, 10) * K
        fh = fh0 * K * rng.uniform(0.85, 1.1)
        d.polygon([(fx - fw * K, cy - 2 * K), (fx - fw * 0.4 * K, cy - fh * 0.5), (fx + rng.uniform(-6, 6) * K, cy - fh),
                   (fx + fw * 0.5 * K, cy - fh * 0.45), (fx + fw * K, cy - 2 * K)], fill=hexc(["#e2541c", "#ff7a2a", "#ff9a2e", "#ffc04a", "#ffd36a", "#fff0b0"][k]))
    d.polygon([(cx - 7 * K, cy - 2 * K), (cx, cy - 26 * K), (cx + 7 * K, cy - 2 * K)], fill=hexc("#fff4c2"))
    soft = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(soft)
    for k in range(7):
        r = (9 + k * 6) * s
        sx, sy = hx + 29 * s + k * 12 * s, hy - 84 * s - k * 20 * s
        sd.ellipse([sx - r, sy - r, sx + r, sy + r], fill=hexc("#9a98b8", max(10, 90 - k * 12)))
    soft = soft.filter(ImageFilter.GaussianBlur(8 * K))
    img.alpha_composite(soft)
    sparks = Image.new("RGBA", img.size, (0, 0, 0, 0))
    spd = ImageDraw.Draw(sparks)
    for _ in range(36):
        sx, sy = cx + rng.normal(0, 16) * K, cy - rng.uniform(60, 240) * K
        r = rng.uniform(1.0, 2.2) * K
        spd.ellipse([sx - r, sy - r, sx + r, sy + r], fill=hexc("#ffc46a", int(rng.uniform(120, 255))))
    img.alpha_composite(sparks.filter(ImageFilter.GaussianBlur(0.6 * K)))


def make(seed=11):
    rng = np.random.default_rng(seed)
    sky = gradient([(0, "#0b1230"), (0.28, "#1f2a5a"), (0.46, "#4a3f78"), (0.6, "#a8687a"), (0.7, "#f0a070"), (1, "#f0a070")], H, W)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    # an aurora ribbon, faint
    band = np.exp(-((yy - (210 + 60 * np.sin(xx / 380) + 25 * np.sin(xx / 97))) / 55) ** 2) * np.clip(1 - np.abs(xx - 1100) / 900, 0, 1)
    sky = sky + band[..., None] * col("#3fe0b0")[None, None] * 0.16
    # stars
    for _ in range(420):
        x, y = rng.uniform(0, W), rng.uniform(0, H * 0.45) ** 1.0
        b = rng.uniform(0.25, 1.0) * (1 - y / (H * 0.5))
        r = rng.uniform(0.6, 1.5)
        x0, y0 = int(x), int(y)
        sub = np.exp(-((xx[y0 - 3:y0 + 4, x0 - 3:x0 + 4] - x) ** 2 + (yy[y0 - 3:y0 + 4, x0 - 3:x0 + 4] - y) ** 2) / r ** 2)
        if sub.size:
            sky[y0 - 3:y0 + 4, x0 - 3:x0 + 4] += sub[..., None] * b * 0.8
    # the moon
    mx, my = 1510, 190
    moon = np.hypot(xx - mx, yy - my)
    sky += np.exp(-moon / 120)[..., None] * col("#9fb3ff")[None, None] * 0.25
    crescent = (moon < 46) & (np.hypot(xx - mx - 22, yy - my + 12) > 40)
    sky[crescent] = col("#f4f2ff")
    img = to_img(sky).convert("RGBA").resize((W * K, H * K), Image.BICUBIC)
    d = ImageDraw.Draw(img)

    # mountains
    for layer, (base, amp, c, cap) in enumerate(((560, 150, "#3e3f74", "#8a86b8"), (610, 110, "#2e3366", "#6f73a8"))):
        xs = np.linspace(0, W * K, 40)
        peaks = [(x, (base - rng.uniform(0.2, 1) * amp) * K) for x in xs]
        d.polygon(peaks + [(W * K, H * K), (0, H * K)], fill=hexc(c))
        for j in range(1, len(peaks) - 1):
            (px, py), (lx, ly), (rx, ry) = peaks[j], peaks[j - 1], peaks[j + 1]
            if py < min(ly, ry) and py < (base - amp * 0.45) * K:
                k1, k2 = 0.3, 0.22
                pl, pr = (px + (lx - px) * k1, py + (ly - py) * k1), (px + (rx - px) * k2, py + (ry - py) * k2)
                mid = (px + (pr[0] - px) * 0.3, (pl[1] + pr[1]) / 2 + 6 * K)
                d.polygon([(px, py), pl, ((pl[0] + px) / 2, pl[1] + 4 * K), (px - 4 * K, (py + pl[1]) / 2 + 10 * K), mid, pr], fill=hexc(cap))
    img = img.filter(ImageFilter.GaussianBlur(1.2 * K))
    d = ImageDraw.Draw(img)

    # forest layers, far to near: each hazier towards the horizon colour
    haze = "#9a7fa8"
    layers = [  # ground y, hill amp, tree heights, count, body, snow in shade, snow lit, haze amount
        (690, 14, (70, 120), 80, "#263a5c", "#7f86b8", "#a9a6d0", 0.55),
        (770, 22, (120, 200), 50, "#1b3350", "#8592c4", "#c3c6e6", 0.35),
        (880, 30, (220, 340), 22, "#12283e", "#8a9ac8", "#dfe6f6", 0.12),
    ]
    for i, (gy, amp, (h0, h1), n, body, shade, lit, hz) in enumerate(layers):
        ground = hills(gy, amp, seed + i)
        trees = Image.new("RGBA", img.size, (0, 0, 0, 0))
        td = ImageDraw.Draw(trees)
        spots = sorted(rng.uniform(-40, W + 40, n))
        for x in spots:
            x *= K
            if i == 2 and 980 * K < x < 1480 * K:      # the clearing with the camp
                continue
            h = rng.uniform(h0, h1) * K
            pine(td, x, ground[int(np.clip(x, 0, W * K - 1))] + 6 * K, h, hexc(mixc(body, haze, hz)), hexc(mixc(shade, haze, hz * 0.7)),
                 rng, hexc(mixc(lit, haze, hz * 0.7)))
        img.alpha_composite(trees)
        snowfield(img, ground, mixc("#eef3ff", haze, hz), mixc("#8fa2d0", haze, hz), 160)
        if i == 2:
            camp(img, ground, xx, yy, rng)
        # a band of mist above each farther layer's ground
        if i < 2:
            mist = np.exp(-((yy - gy + 30) / 45) ** 2) * 0.35
            m = Image.fromarray((mist * 255).astype(np.uint8), "L").resize(img.size, Image.BICUBIC)
            mi = Image.new("RGBA", img.size, hexc(haze))
            mi.putalpha(m)
            img.alpha_composite(mi)

    # the near foreground: big dark spruces framing the sides, a lit snowdrift
    fg = Image.new("RGBA", img.size, (0, 0, 0, 0))
    fd = ImageDraw.Draw(fg)
    near = hills(1010, 26, seed + 9)
    for x, h in ((-60, 900), (150, 700), (1770, 840), (1960, 980), (330, 470), (1590, 520)):
        pine(fd, x * K, near[int(np.clip(x * K, 0, W * K - 1))] + 10 * K, h * K, hexc("#0b1a2c"), hexc("#6a7aa8"), rng, hexc("#a8b8e0"))
    img.alpha_composite(fg)
    snowfield(img, near, (0.93, 0.95, 1.0), (0.55, 0.62, 0.82), 120)
    img = img.resize((W, H), Image.LANCZOS).convert("RGB")
    arr = np.asarray(img, dtype=np.float64) / 255

    # warm light on the foreground snow from the camp side, cold on the left; falling snow; a vignette
    arr += (np.exp(-(((xx - 1230) / 700) ** 2 + ((yy - 1080) / 260) ** 2)) * 0.12)[..., None] * col("#ffa04a")[None, None]
    flakes = np.zeros((H, W))
    for _ in range(900):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        r = rng.uniform(0.7, 2.2) if rng.random() < 0.92 else rng.uniform(4, 9)
        a = rng.uniform(0.3, 0.8) if r < 3 else rng.uniform(0.12, 0.25)
        x0, x1, y0, y1 = int(max(0, x - r * 3)), int(min(W, x + r * 3 + 1)), int(max(0, y - r * 3)), int(min(H, y + r * 3 + 1))
        sub = np.exp(-((xx[y0:y1, x0:x1] - x) ** 2 + (yy[y0:y1, x0:x1] - y) ** 2) / (r * r))
        flakes[y0:y1, x0:x1] = np.maximum(flakes[y0:y1, x0:x1], sub * a)
    arr = arr + flakes[..., None] * (col("#eef4ff")[None, None] - arr)
    vig = np.clip(1 - (((xx - W / 2) / (W * 0.7)) ** 2 + ((yy - H * 0.45) / (H * 0.8)) ** 2), 0, 1) ** 0.6
    arr = arr * (0.55 + 0.45 * vig[..., None])
    return to_img(arr)
