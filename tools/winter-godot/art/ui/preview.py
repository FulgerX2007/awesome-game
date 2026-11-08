"""Contact sheet of the icons at 128, 48 and 24 px on the panel colour, for checking them by eye.
    python3 tools/winter-godot/art/ui/preview.py out.png [icon ids...]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw  # noqa: E402

from catalog import ICONS  # noqa: E402
from sdf import Canvas, finish_icon  # noqa: E402


def render(name, ss=384):
    c = Canvas(ss)
    ICONS[name](c)
    return finish_icon(c.image(), 128)


def sheet(path, names):
    tiles = [(n, render(n)) for n in names]
    cols = 6
    cw = 128 + 48 + 24 + 40
    rows = (len(tiles) + cols - 1) // cols
    img = Image.new("RGBA", (cols * cw + 20, rows * 150 + 20), (26, 35, 56, 255))
    dr = ImageDraw.Draw(img)
    for i, (n, im) in enumerate(tiles):
        x, y = 10 + (i % cols) * cw, 10 + (i // cols) * 150
        img.alpha_composite(im, (x, y))
        img.alpha_composite(im.resize((48, 48), Image.LANCZOS), (x + 134, y + 20))
        img.alpha_composite(im.resize((24, 24), Image.LANCZOS), (x + 190, y + 32))
        dr.text((x, y + 130), n, fill=(160, 176, 204, 255))
    img.save(path)


if __name__ == "__main__":
    sheet(sys.argv[1], sys.argv[2:] or list(ICONS))
