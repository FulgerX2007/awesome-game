#!/usr/bin/env python3
"""Долгая зима on Godot: brings the painted art supplied by the project owner into the game.

Sources (tools/winter-godot/source/):
  environment_sheet.webp   — one sheet of snowy trees, rocks, bushes, drifts and props;
  hero_walk.gif            — the hero walking (8 frames);
  hero_chop.gif            — chopping with an axe (12 frames, the blow lands on frame 9);
  hero_gather_berries.gif  — picking berries off a bush (16 frames; the bush is in the picture);
  hero_mining.gif          — mining with a pick (16 frames, the blow on frame 11; the rock is in the picture).

Writes godot/winter/assets/painted/ and the manifest fragment assets/manifest/override_painted.json, whose keys
replace the generated ones (WinterArt loads override_* fragments last; "_replace" drops whole groups first, so no
generated variant is left mixed in). Run, then `godot --headless --path godot/winter --import`:

    python3 tools/winter-godot/import_art.py
"""
import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "tools/winter-godot/source"
OUT = ROOT / "godot/winter/assets/painted"
MANIFEST = ROOT / "godot/winter/assets/manifest/override_painted.json"
RES = "res://assets/painted/"

ENV_SCALE = 1.25          # the sheet's pines are ~190 px tall; ours stand about two and a half tiles of 96 px
HERO_HEIGHT = 132         # the hero, boots to the top of the hat, in game pixels

# Items of the sheet: key -> box (x0, y0, x1, y1) in the sheet; the foot is found from the alpha.
ENV = {
    "tree.pine.0": (6, 128, 48, 214),
    "tree.pine.1": (50, 32, 145, 214),
    "tree.pine.2": (152, 38, 268, 202),
    "tree.pine.3": (271, 15, 391, 203),
    "tree.pine.4": (396, 3, 547, 200),
    "tree.dead.0": (541, 18, 682, 197),
    "tree.dead.1": (676, 56, 761, 200),
    "tree.fallen.0": (765, 94, 917, 190),
    "tree.stump.0": (916, 103, 1023, 187),
    "log.0": (1024, 101, 1115, 186),
    "rock.small.0": (11, 258, 76, 310),
    "rock.0": (81, 242, 168, 313),
    "rock.1": (175, 227, 285, 319),
    "rock.2": (288, 214, 424, 324),
    "rock.group.0": (428, 199, 607, 341),
    "rock.group.1": (614, 207, 778, 329),
    "ice.formation.0": (783, 207, 935, 326),
    "ice.formation.1": (938, 215, 1118, 330),
    "bush.berry.2": (12, 330, 146, 449),
    "bush.berry.0": (156, 324, 296, 449),
    "bush.berry.1": (303, 327, 441, 446),
    "bush.snow.0": (451, 344, 571, 444),
    "bush.bare.0": (574, 335, 708, 437),
    "ground.patch.0": (717, 340, 811, 430),
    "branch.2": (818, 348, 917, 423),
    "branch.0": (926, 354, 1014, 416),
    "branch.1": (1023, 357, 1111, 417),
    "rock.small.1": (699, 470, 817, 541),
    "snow.drift.0": (817, 462, 942, 546),
    "snow.drift.1": (945, 449, 1117, 544),
    "ice.formation.2": (19, 580, 121, 701),
    "rock.rubble.0": (131, 595, 241, 704),
    "decor.pond": (243, 594, 423, 704),
    "rock.rubble.1": (432, 600, 572, 709),
    "decor.snowman": (578, 571, 696, 717),
    "decor.signpost": (711, 577, 795, 712),
    "decor.fence": (808, 578, 985, 707),
    "decor.lantern": (984, 557, 1099, 715),
}
# Generated groups the painted art replaces entirely (their generated variants would clash in style).
REPLACE = ["tree.pine", "tree.dead", "tree.fallen", "tree.stump", "log", "rock", "rock.small", "rock.group",
           "rock.rubble", "ice.formation", "bush.berry", "bush.bare", "bush.snow", "branch", "ground.patch",
           "snow.drift", "char.hero"]
SPENT_BUSH = ["bush.bare.0"]     # a picked bush: the bare one


def trim(img: Image.Image, pad=2):
    bb = img.getchannel("A").point(lambda v: 255 if v > 6 else 0).getbbox()
    if not bb:
        return img, (0, 0)
    x0, y0, x1, y1 = max(0, bb[0] - pad), max(0, bb[1] - pad), min(img.width, bb[2] + pad), min(img.height, bb[3] + pad)
    return img.crop((x0, y0, x1, y1)), (x0, y0)


def foot_of(img: Image.Image):
    """The ground point: the middle of the solid part's lowest rows, a little above the soft snow skirt."""
    a = np.asarray(img.getchannel("A")) > 150
    ys, xs = np.nonzero(a)
    if not len(ys):
        return img.width / 2, img.height - 2
    y1 = ys.max()
    low = xs[ys > y1 - max(4, (y1 - ys.min()) * 0.12)]
    return float((low.min() + low.max()) / 2), float(y1 - (y1 - ys.min()) * 0.06)


def drop_neighbours(img: Image.Image) -> Image.Image:
    """Removes the parts of neighbouring items that reach into this item's box: every solid piece other than the
    largest one that touches the box's edge, with its soft rim."""
    a = np.array(img)
    solid = a[..., 3] > 90
    comps = sorted(components(solid), key=lambda c: -c[0])
    h, w = solid.shape
    kill = np.zeros_like(solid)
    for n, ys, xs in comps[1:]:
        if xs.min() <= 3 or ys.min() <= 3 or xs.max() >= w - 4 or ys.max() >= h - 4:
            kill[ys, xs] = True
    if kill.any():
        grown = kill.copy()
        for d in range(1, 5):
            grown[d:, :] |= kill[:-d, :]
            grown[:-d, :] |= kill[d:, :]
            grown[:, d:] |= kill[:, :-d]
            grown[:, :-d] |= kill[:, d:]
        keep = np.zeros_like(solid)
        keep[comps[0][1], comps[0][2]] = True
        a[grown & ~keep, 3] = 0
    # the soft snow shadow runs on between the sheet's items: fade it out toward the box so no edge shows
    f = 12.0
    yy, xx = np.mgrid[0:h, 0:w]
    edge = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy)).astype(np.float32)
    ramp = np.clip(edge / f, 0.0, 1.0)
    soft = a[..., 3] < 200
    a[..., 3] = np.where(soft, a[..., 3] * ramp, a[..., 3]).astype(np.uint8)
    # what is still solid on the very edge belongs to a neighbour
    a[..., 3] = np.where(edge < 2, 0, a[..., 3]).astype(np.uint8)
    return Image.fromarray(a, "RGBA")


def env(manifest: dict) -> None:
    sheet = Image.open(SRC / "environment_sheet.webp").convert("RGBA")
    (OUT / "environment").mkdir(parents=True, exist_ok=True)
    for key, box in ENV.items():
        img = drop_neighbours(sheet.crop(box))
        img = img.resize((round(img.width * ENV_SCALE), round(img.height * ENV_SCALE)), Image.LANCZOS)
        img, _ = trim(img)
        fx, fy = foot_of(img)
        name = key.replace(".", "_") + ".png"
        img.save(OUT / "environment" / name, optimize=True)
        manifest[key] = {"file": RES + "environment/" + name, "size": [img.width, img.height], "foot": [round(fx), round(fy)],
                         "block": 0 if key.startswith(("branch", "ground", "log", "decor.pond")) else 1, "painted": True}


# ── The hero ──

def frames_of(path: Path):
    im = Image.open(path)
    out = []
    for fr in ImageSequence.Iterator(im):
        out.append(fr.convert("RGBA"))
    return out


def components(mask: np.ndarray):
    """4-connected components → list of (pixel count, ys, xs)."""
    h, w = mask.shape
    seen = np.zeros_like(mask, bool)
    comps = []
    for y0 in range(h):
        for x0 in np.nonzero(mask[y0] & ~seen[y0])[0]:
            if seen[y0, x0]:
                continue
            q = deque([(y0, x0)])
            seen[y0, x0] = True
            ys, xs = [], []
            while q:
                y, x = q.popleft()
                ys.append(y)
                xs.append(x)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            comps.append((len(ys), np.array(ys), np.array(xs)))
    return comps


def drop_prop(frames):
    """Removes the bush or rock standing right of the hero. The prop drifts a pixel or two between the GIF's
    frames, so it is cut out as a region: the union of its boxes in the frames where it stands apart from the hero
    (a separate component whose centre lies in the right part), grown a little; everything inside goes, in every
    frame. A hand or the pick's tip reaching into the prop is cut with it."""
    w = frames[0].width
    box = None
    for fr in frames:
        a = np.asarray(fr)
        for n, ys, xs in components(a[..., 3] > 0):
            if n > 400 and xs.mean() > w * 0.58 and xs.min() > w * 0.45:
                b = (xs.min(), ys.min(), xs.max(), ys.max())
                box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    x0, y0, x1, y1 = box[0] - 3, box[1] - 4, box[2] + 4, box[3] + 4
    out = []
    for fr in frames:
        a = np.array(fr)
        a[max(0, y0):y1 + 1, max(0, x0):x1 + 1, 3] = 0
        # crumbs of the prop left around the box
        for n, ys, xs in components(a[..., 3] > 0):
            if n < 60 and xs.mean() > x0 - 12:
                a[ys, xs, 3] = 0
        out.append(Image.fromarray(a, "RGBA"))
    return out


def hero_body(frame: Image.Image):
    """The hero's own pixels: the largest component (drops chips and stray specks only when they are tiny)."""
    a = np.asarray(frame)
    comps = sorted(components(a[..., 3] > 0), key=lambda c: -c[0])
    return comps[0]


def hero(manifest: dict) -> None:
    anims_src = [
        ("walk", "hero_walk.gif", False, None, True),
        ("chop", "hero_chop.gif", False, 8, True),
        ("gather", "hero_gather_berries.gif", True, 6, False),
        ("mine", "hero_mining.gif", True, 10, True),
    ]
    clips = []
    for name, file, has_prop, impact, loop in anims_src:
        frames = frames_of(SRC / file)
        if has_prop:
            frames = drop_prop(frames)
        # the scale: the hero's height in the first frame (the body only) → HERO_HEIGHT
        n, ys, xs = hero_body(frames[0])
        h = ys.max() - ys.min()
        s = HERO_HEIGHT / h
        bottom = ys.max()
        low = xs[ys > bottom - h * 0.06]
        foot = ((low.min() + low.max()) / 2, bottom)
        clips.append((name, frames, s, foot, impact, loop))
    # one cell size for every clip: the union of the scaled frames around the foot
    left = right = up = down = 0
    for name, frames, s, foot, impact, loop in clips:
        for fr in frames:
            bb = fr.getchannel("A").getbbox()
            if not bb:
                continue
            left = max(left, (foot[0] - bb[0]) * s)
            right = max(right, (bb[2] - foot[0]) * s)
            up = max(up, (foot[1] - bb[1]) * s)
            down = max(down, (bb[3] - foot[1]) * s)
    fw, fh = int(np.ceil(left + right)) + 4, int(np.ceil(up + down)) + 4
    fx, fy = int(np.ceil(left)) + 2, int(np.ceil(up)) + 2
    cols = 16
    total = sum(len(c[1]) for c in clips)
    rows = sum(-(-len(c[1]) // cols) for c in clips)
    sheet = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    anims = {}
    row = 0
    for name, frames, s, foot, impact, loop in clips:
        for i, fr in enumerate(frames):
            big = fr.resize((max(1, round(fr.width * s)), max(1, round(fr.height * s))), Image.LANCZOS)
            ox = fx - round(foot[0] * s)
            oy = fy - round(foot[1] * s)
            cell = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
            cell.alpha_composite(big.crop((max(0, -ox), max(0, -oy), big.width, big.height)), (max(0, ox), max(0, oy)))
            sheet.paste(cell, ((i % cols) * fw, (row + i // cols) * fh))
        n = len(frames)
        fps = {"walk": 12, "chop": 14, "gather": 10, "mine": 14}[name]
        clip = {"row": row, "from": 0, "count": n, "fps": fps, "loop": loop}
        if impact is not None:
            clip["impact"] = impact
        anims[name + "_side"] = clip
        row += -(-n // cols)
    # standing still: the first walking frame; the jobs the sheet lacks borrow the nearest motion
    anims["idle_side"] = {"row": anims["walk_side"]["row"], "from": 0, "count": 1, "fps": 1, "loop": True}
    anims["build_side"] = dict(anims["chop_side"])
    anims["craft_side"] = dict(anims["gather_side"])
    anims["fire_side"] = dict(anims["gather_side"])      # feeding the fire, cooking: crouched, hands forward
    (OUT / "characters").mkdir(parents=True, exist_ok=True)
    sheet.save(OUT / "characters/hero.png", optimize=True)
    manifest["char.hero"] = {"sheet": RES + "characters/hero.png", "frame": [fw, fh], "foot": [fx, fy], "anims": anims,
                             "painted": True}
    print(f"hero: {total} frames of {fw}×{fh}, sheet {sheet.width}×{sheet.height}")


def main() -> None:
    manifest = {"_replace": REPLACE}
    env(manifest)
    hero(manifest)
    MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    size = sum(p.stat().st_size for p in OUT.rglob("*.png"))
    print(f"{len(manifest) - 1} keys, {size // 1024} KB")


if __name__ == "__main__":
    main()
