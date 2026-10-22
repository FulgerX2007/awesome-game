"""Cut the third creature sheet (sheet-3.webp) into atlas cards for Глубина: web/deep/art/<species>.webp.

sheet-3 paints each animal on a checkerboard that only looks transparent: the squares are in the pixels.
The checkerboard is light and grey, so the background is every light, colourless pixel joined to the edge of
the sheet; below the jelly's bell it is every such pixel, since its see-through tentacles show squares that are
not joined to the edge.
The mask is shrunk a little and softened, so no light fringe is left, and the animal is laid on the dark
water gradient of the other cards, fitted into a 2:1 card. Only the big view of each animal is used.
Run from the repo root: python3 tools/deep-art/crop3.py
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# id: (region of the big view, extra rectangle of it beside the small views, row from which every checker
# pixel is background, not only the joined ones)
CARDS = {
    'leatherback': ((8, 0, 505, 335), None, None),
    'manta': ((510, 10, 1010, 322), None, None),
    'colossal': ((1008, 0, 1530, 340), (1435, 330, 1530, 492), None),
    'atolla': ((10, 495, 505, 782), None, 645),
    'yeti': ((1015, 515, 1525, 795), None, None),
}
OUT = 'web/deep/art'
W, H = 520, 260
MARGIN = 14


def checker(a):
    return (a.min(2) >= 196) & ((a.max(2) - a.min(2)) <= 14)


def joined_to_edge(mask):
    """The part of mask reachable from the border of the image, by repeated 4-neighbour growth."""
    bg = np.zeros_like(mask)
    bg[0], bg[-1], bg[:, 0], bg[:, -1] = mask[0], mask[-1], mask[:, 0], mask[:, -1]
    while True:
        g = bg.copy()
        g[1:] |= bg[:-1]; g[:-1] |= bg[1:]; g[:, 1:] |= bg[:, :-1]; g[:, :-1] |= bg[:, 1:]
        g &= mask
        if (g == bg).all():
            return bg
        bg = g


def water():
    """The dark water of the other cards: a soft radial glow in deep blue, with a few specks."""
    img = Image.new('RGB', (W, H))
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2).clip(0, 1.4) / 1.4
    inner, outer = np.array([18, 62, 92]), np.array([5, 22, 38])
    px = (inner * (1 - d[..., None]) + outer * d[..., None]).astype(np.uint8)
    img = Image.fromarray(px)
    dots = Image.new('L', (W, H), 0)
    draw = ImageDraw.Draw(dots)
    rnd = np.random.default_rng(7)
    for _ in range(40):
        x, y, r = rnd.uniform(0, W), rnd.uniform(0, H), rnd.uniform(0.6, 2.2)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=int(rnd.uniform(40, 110)))
    dots = dots.filter(ImageFilter.GaussianBlur(0.8))
    img.paste(Image.new('RGB', (W, H), (150, 200, 230)), (0, 0), dots)
    return img


def main():
    here = os.path.dirname(__file__)
    sheet = Image.open(os.path.join(here, 'sheet-3.webp')).convert('RGB')
    a = np.asarray(sheet).astype(int)
    light = checker(a)
    bg_joined = joined_to_edge(light)
    os.makedirs(OUT, exist_ok=True)
    for sid, (rect, extra, every) in CARDS.items():
        keep = np.zeros(light.shape, bool)
        for (l, t, r, b) in [rect] + ([extra] if extra else []):
            keep[t:b, l:r] = True
        bg = bg_joined.copy()
        if every:
            bg[every:] |= light[every:]
        fg = keep & ~bg
        l, t = min(rect[0], extra[0] if extra else 9999), rect[1]
        r, b = max(rect[2], extra[2] if extra else 0), max(rect[3], extra[3] if extra else 0)
        alpha = Image.fromarray((fg[t:b, l:r] * 255).astype(np.uint8))
        alpha = alpha.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1.2))
        art = sheet.crop((l, t, r, b))
        box = alpha.getbbox()
        art, alpha = art.crop(box), alpha.crop(box)
        k = min((W - 2 * MARGIN) / art.width, (H - 2 * MARGIN) / art.height)
        size = (round(art.width * k), round(art.height * k))
        art, alpha = art.resize(size, Image.LANCZOS), alpha.resize(size, Image.LANCZOS)
        card = water()
        card.paste(art, ((W - size[0]) // 2, (H - size[1]) // 2), alpha)
        card.save(os.path.join(OUT, sid + '.webp'), 'WEBP', quality=88, method=6)
    print(f'{len(CARDS)} cards in {OUT}')


if __name__ == '__main__':
    main()
