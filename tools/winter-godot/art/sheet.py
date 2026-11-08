"""Долгая зима on Godot — contact sheets of the generated sprites, for looking at them.

    python3 tools/winter-godot/art/sheet.py <out.png> [group ...] [--scale 2] [--normals] [--bg night]

Every sprite of the groups' manifests is drawn with its cast shadow on a snow-coloured field, its foot marked.
"""

import json
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from paint import ASSETS, GAME, rgb  # noqa: E402


def path_of(res):
    return os.path.join(GAME, res[len("res://"):])


def main(argv):
    out = argv[0]
    skip = {argv[i + 1] for i, a in enumerate(argv[:-1]) if a in ("--scale", "--bg")}
    groups = [a for a in argv[1:] if not a.startswith("--") and a not in skip]
    scale = float(argv[argv.index("--scale") + 1]) if "--scale" in argv else 1.0
    normals = "--normals" in argv
    bg = rgb("snow_mid") if "--bg" not in argv else rgb(argv[argv.index("--bg") + 1])
    entries = []
    for g in groups or ["environment", "buildings", "effects"]:
        with open(os.path.join(ASSETS, "manifest", g + ".json"), encoding="utf-8") as f:
            entries += list(json.load(f).items())
    W = int(1600 * scale)
    pad = int(14 * scale)
    tiles = []
    for key, e in entries:
        f = e.get("normal") if normals and e.get("normal") else e.get("file") or e.get("sheet")
        im = Image.open(path_of(f)).convert("RGBA")
        if "frame" in e and not normals:
            fw, fh = e["frame"]
            im = im.crop((0, 0, min(im.width, fw * 4), fh))
        sh = Image.open(path_of(e["shadow"]["file"])).convert("RGBA") if e.get("shadow") and not normals else None
        tiles.append((key, e, im, sh))
    x = y = pad
    row_h = 0
    rows = []
    for key, e, im, sh in tiles:
        w = int(max(im.width, 60) * scale) + pad
        h = int((im.height + 40) * scale) + pad
        if x + w > W:
            x = pad
            y += row_h
            row_h = 0
        rows.append((x, y, key, e, im, sh))
        x += w
        row_h = max(row_h, h)
    H = y + row_h + pad
    canvas = Image.new("RGBA", (W, H), tuple(int(c * 255) for c in bg) + (255,))
    draw = ImageDraw.Draw(canvas)
    for x, y, key, e, im, sh in rows:
        fx, fy = e.get("foot", [im.width / 2, im.height])
        if sh is not None:
            sfx, sfy = e["shadow"]["foot"]
            s2 = sh.resize((int(sh.width * scale), int(sh.height * scale)), Image.LANCZOS)
            canvas.alpha_composite(s2, (int(x + (fx - sfx) * scale), int(y + (fy - sfy) * scale)))
        i2 = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
        canvas.alpha_composite(i2, (int(x), int(y)))
        draw.ellipse([x + fx * scale - 2, y + fy * scale - 2, x + fx * scale + 2, y + fy * scale + 2], fill=(255, 0, 80))
        draw.text((x, y + im.height * scale + 4), key, fill=(30, 40, 70))
    canvas.save(out)
    print(out, canvas.size)


if __name__ == "__main__":
    main(sys.argv[1:])
