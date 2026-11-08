"""Bakes every character sheet of Долгая зима and the manifest fragment `characters.json`.

    python3 tools/winter-godot/art/characters/build.py          # all sheets
    python3 tools/winter-godot/art/characters/build.py wolf     # one

Each sheet is a grid: one row per animation × direction, frames left to right, every cell the same size with the
same foot pixel. Cells are cropped to the union of all frames of the sheet (plus a 2 px margin). Next to the colour
sheet: `<name>.n.png` (normal map, green = up) and, for the villager, `<name>.tint.png`.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import humans as Hm  # noqa: E402
import animals as An  # noqa: E402
from rig import render  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
ASSETS = os.path.join(ROOT, "godot", "winter", "assets")
CANVAS = (280, 270)
FOOT = (140, 225)
MAX_SIDE = 4096   # WebGL 2 on phones may refuse bigger textures

H3 = ("down", "up", "side")


def human_spec(key, out, folder, anims, dirs=H3, extra=(), scale=1.2, tint=False):
    rows = [(a, d, n, fps, loop, fn) for (a, n, fps, loop, fn) in anims for d in dirs]
    rows += list(extra)
    return dict(key=key, kind="human", outfit=out, rows=rows, scale=scale, tint=tint,
                file=os.path.join("characters", folder, out))


def sleep_rows():
    return [("sleep", "down", 2, 1.5, True, lambda p, d: Hm.lying(p))]


SPECS = {
    "hero": human_spec("char.hero", "hero", "player", Hm.HERO_ANIMS, extra=sleep_rows()),
    "villager": human_spec("char.villager", "villager", "survivors", Hm.VILLAGER_ANIMS, extra=sleep_rows(), tint=True),
    "trader": human_spec("char.trader", "trader", "survivors", [("idle", 4, 4, True, Hm.idle)], dirs=("down",)),
    "wanderer": human_spec("char.wanderer", "wanderer", "survivors", [],
                           extra=[("idle", "down", 4, 6, True, lambda p, d: Hm.lying(p, shiver=0.6, eyes="open"))]),
}
SPECS.update(An.SPECS)


def frames_of(spec):
    for row in spec["rows"]:
        yield row


def render_frame(spec, pose, d, k, n, loop):
    p = k / n if loop else k / max(1, n - 1)
    if spec["kind"] == "human":
        fig = Hm.build(spec["outfit"], pose(p, d), d, spec["scale"])
    else:
        fig = An.build(spec["animal"], pose(p, d), d)
    return render(fig, CANVAS[0], CANVAS[1], FOOT)


def bake(name):
    spec = SPECS[name]
    cells = []
    for anim, d, n, fps, loop, pose in frames_of(spec):
        cells.append([(anim, d, fps, loop)] + [render_frame(spec, pose, d, k, n, loop) for k in range(n)])
    alpha = np.zeros(CANVAS[::-1])
    for row in cells:
        for c, _, _ in row[1:]:
            alpha = np.maximum(alpha, c[..., 3])
    ys, xs = np.nonzero(alpha > 0.01)
    x0, x1 = max(0, xs.min() - 2), min(CANVAS[0], xs.max() + 3)
    y0, y1 = max(0, ys.min() - 2), min(CANVAS[1], ys.max() + 3)
    if x0 == 0 or y0 == 0 or x1 == CANVAS[0] or y1 == CANVAS[1]:
        print(f"warning: {name} touches the render canvas", file=sys.stderr)
    fw, fh = x1 - x0, y1 - y0
    # pack the animations into lines of at most `cap` cells, several animations to a line when they fit
    cap = max(max(len(r) - 1 for r in cells), min(16, MAX_SIDE // fw))
    place, line, used = [], 0, 0
    for row in cells:
        n = len(row) - 1
        if used and used + n > cap:
            line, used = line + 1, 0
        place.append((line, used))
        used += n
    lines = line + 1
    cols = max(fr + len(r) - 1 for (ln, fr), r in zip(place, cells))
    assert fw * cols <= MAX_SIDE and fh * lines <= MAX_SIDE, (name, fw * cols, fh * lines)
    sheet = np.zeros((fh * lines, fw * cols, 4))
    nsheet = np.zeros((fh * lines, fw * cols, 3))
    nsheet[...] = (0, 0, 1)
    tsheet = np.zeros_like(sheet)
    anims = {}
    for (ln, fr), row in zip(place, cells):
        anim, d, fps, loop = row[0]
        for c, (col, nrm, tin) in enumerate(row[1:]):
            sl = (slice(ln * fh, (ln + 1) * fh), slice((fr + c) * fw, (fr + c + 1) * fw))
            sheet[sl] = col[y0:y1, x0:x1]
            nsheet[sl] = nrm[y0:y1, x0:x1]
            tsheet[sl] = tin[y0:y1, x0:x1]
        anims[f"{anim}_{d}"] = {"row": ln, "from": fr, "count": len(row) - 1, "fps": fps, "loop": loop}
    base = os.path.join(ASSETS, spec["file"])
    os.makedirs(os.path.dirname(base), exist_ok=True)
    _save_rgba(sheet, base + ".png")
    # normal map: red = +x right, green = up on screen (the renderer's y points down), blue = out
    enc = np.stack([nsheet[..., 0], -nsheet[..., 1], nsheet[..., 2]], -1) * 0.5 + 0.5
    Image.fromarray((np.clip(enc, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(base + ".n.png", optimize=True)
    entry = {"sheet": res(base + ".png"), "normal": res(base + ".n.png"), "frame": [int(fw), int(fh)],
             "foot": [int(FOOT[0] - x0), int(FOOT[1] - y0)], "anims": anims}
    if spec.get("tint"):
        _save_rgba(tsheet, base + ".tint.png")
        entry["layers"] = {"tint": res(base + ".tint.png")}
    if spec.get("scale_hint"):
        entry["scale_hint"] = spec["scale_hint"]
    return spec["key"], entry


def _save_rgba(img, path):
    a = img[..., 3:]
    rgb = np.where(a > 0.002, img[..., :3], 0)
    arr = np.concatenate([rgb, a], -1)
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(path, optimize=True)


def res(path):
    return "res://" + os.path.relpath(path, os.path.join(ROOT, "godot", "winter")).replace(os.sep, "/")


def main():
    names = sys.argv[1:] or list(SPECS)
    mpath = os.path.join(ASSETS, "manifest", "characters.json")
    manifest = {}
    if os.path.exists(mpath):
        with open(mpath) as fh:
            manifest = json.load(fh)
    for n in names:
        k, e = bake(n)
        manifest[k] = e
        print(k, e["frame"], e["foot"], len(e["anims"]), "anims")
    os.makedirs(os.path.dirname(mpath), exist_ok=True)
    with open(mpath, "w") as fh:
        json.dump(dict(sorted(manifest.items())), fh, ensure_ascii=False, indent=1)
        fh.write("\n")


if __name__ == "__main__":
    main()
