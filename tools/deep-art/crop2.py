"""Cut the second creature sheet (sheet-2.png) into atlas cards for Глубина: web/deep/art/<species>.webp.

sheet-2 has one panel per animal: a big side view under a caption, plus small extra views (top, front,
silhouette) that the game does not use. Each card is the inside of the big panel with the caption painted over
by the background just under it, padded to the 2:1 card shape with its own plain background edge.
Run from the repo root: python3 tools/deep-art/crop2.py
"""
import os

from PIL import Image, ImageFilter

# id: (inside of the big panel, caption box to paint over).
CARDS = {
    'bluewhale': ((12, 10, 549, 247), (14, 12, 290, 68)),
    'orca': ((796, 10, 1153, 247), (798, 12, 1008, 66)),
    'frilled': ((12, 266, 407, 509), (14, 268, 385, 326)),
    'fangtooth': ((796, 266, 1155, 509), (798, 268, 1080, 326)),
    'barreleye': ((12, 526, 365, 756), (14, 528, 340, 587)),
    'abysso': ((796, 526, 1195, 756), (798, 528, 1155, 587)),
    'sunfish': ((104, 774, 612, 1012), (104, 776, 302, 834)),
}
OUT = 'web/deep/art'
RATIO = 2.0
FEATHER = 14


def pad(card):
    """Grow the card to RATIO with plain background: its outer edge stretched outwards, blurred, faded in."""
    w, h = card.size
    if w / h < RATIO:
        nw, nh = round(h * RATIO), h
        ox, oy = (nw - w) // 2, 0
        out = Image.new('RGB', (nw, nh))
        out.paste(card.crop((0, 0, 4, h)).resize((1, h)).resize((ox + FEATHER, h)), (0, 0))
        out.paste(card.crop((w - 4, 0, w, h)).resize((1, h)).resize((nw - ox - w + FEATHER, h)), (ox + w - FEATHER, 0))
    else:
        nw, nh = w, round(w / RATIO)
        ox, oy = 0, (nh - h) // 2
        out = Image.new('RGB', (nw, nh))
        out.paste(card.crop((0, 0, w, 4)).resize((w, 1)).resize((w, oy + FEATHER)), (0, 0))
        out.paste(card.crop((0, h - 4, w, h)).resize((w, 1)).resize((w, nh - oy - h + FEATHER)), (0, oy + h - FEATHER))
    out = out.filter(ImageFilter.GaussianBlur(10))
    # the card fades into the padding over FEATHER pixels on the padded sides
    mask = Image.new('L', (w, h), 255)
    for i in range(FEATHER):
        a = round(255 * (i + 1) / (FEATHER + 1))
        if ox:
            mask.paste(a, (i, 0, i + 1, h)); mask.paste(a, (w - 1 - i, 0, w - i, h))
        if oy:
            mask.paste(a, (0, i, w, i + 1)); mask.paste(a, (0, h - 1 - i, w, h - i))
    out.paste(card, (ox, oy), mask)
    return out


def main():
    here = os.path.dirname(__file__)
    sheet = Image.open(os.path.join(here, 'sheet-2.png')).convert('RGB')
    os.makedirs(OUT, exist_ok=True)
    for sid, (box, cover) in CARDS.items():
        art = sheet.copy()
        if cover:
            l, t, r, b = cover
            below = art.crop((l, b + 2, r, b + 3)).resize((r - l, b - t)).filter(ImageFilter.GaussianBlur(4))
            art.paste(below, (l, t))
        pad(art.crop(box)).save(os.path.join(OUT, sid + '.webp'), 'WEBP', quality=88, method=6)
    print(f'{len(CARDS)} cards in {OUT}')


if __name__ == '__main__':
    main()
