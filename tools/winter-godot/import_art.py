#!/usr/bin/env python3
"""Долгая зима on Godot: brings the painted art supplied by the project owner into the game.

Sources (tools/winter-godot/source/):
  environment_sheet.webp   — one sheet of snowy trees, rocks, bushes, drifts and props;
  hero_walk.gif            — the hero walking (8 frames);
  hero_chop.gif            — chopping with an axe (12 frames, the blow lands on frame 9);
  hero_gather_berries.gif  — picking berries off a bush (16 frames; the bush is in the picture);
  hero_mining.gif          — mining with a pick (16 frames, the blow on frame 11; the rock is in the picture);
  cabin.webp               — the finished log cabin (the hut's last two stages);
  hare_run.gif, deer_walk.gif, wolf_run.gif (16 frames each), bear.webp and bear_attack.webp (the bear standing
  and in its fighting stance) — the animals.

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
           "snow.drift", "hut", "palisade", "bench", "firepit", "bunk", "up", "torch", "stock", "trader", "snare",
           "char.hero", "char.trader", "char.wanderer", "animal.rabbit", "animal.deer", "animal.wolf", "animal.bear"]
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


# ── The cabin: the finished hut (stage 4: the stove lit) and, with the window and the lantern out, stage 3 ──
CABIN_CHIMNEY = (195, 58)      # the chimney's mouth in the source picture
CABIN_WINDOW = (231, 232)      # the lit window (the stove's glow comes from there)
CABIN_HOLE = (240, 150)        # where a blizzard tears the roof


def unlit(img: Image.Image) -> Image.Image:
    """The cabin with its window and lantern out: the warm glowing pixels (and a little around them) turn to
    dark glass."""
    a = np.asarray(img).astype(np.float32)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    warm = (al > 200) & (r > 200) & (g > 150) & (b < 140) & (r - b > 90)
    # the window and the lantern are patches of glow; a lone warm pixel is a highlight on metal or wood
    keep = np.zeros_like(warm)
    for n, ys, xs in components(warm):
        if n >= 12:
            keep[ys, xs] = True
    warm = keep
    glow = warm.copy()
    for d in range(1, 4):
        glow[d:, :] |= warm[:-d, :]
        glow[:-d, :] |= warm[d:, :]
        glow[:, d:] |= warm[:, :-d]
        glow[:, :-d] |= warm[:, d:]
    dark = a.copy()
    dark[glow, :3] = dark[glow, :3] * 0.25 + np.array([38, 48, 70], np.float32) * 0.75
    return Image.fromarray(np.clip(dark, 0, 255).astype(np.uint8), "RGBA")


def cabin(manifest: dict) -> None:
    src = Image.open(SRC / "cabin.webp").convert("RGBA")
    a = np.asarray(src).astype(np.float32)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    warm = (al > 200) & (r > 200) & (g > 150) & (b < 140) & (r - b > 90)
    glow = warm.copy()
    for d in range(1, 4):
        glow[d:, :] |= warm[:-d, :]
        glow[:-d, :] |= warm[d:, :]
        glow[:, d:] |= warm[:, :-d]
        glow[:, :-d] |= warm[:, d:]
    dark = a.copy()
    glass = np.array([38, 48, 70], np.float32)
    dark[glow, :3] = dark[glow, :3] * 0.25 + glass * 0.75
    unlit = Image.fromarray(np.clip(dark, 0, 255).astype(np.uint8), "RGBA")
    (OUT / "buildings").mkdir(parents=True, exist_ok=True)
    for stage, img in ((3, unlit), (4, src)):
        img, (ox, oy) = trim(img)
        fx, fy = foot_of(img)
        name = f"cabin_{stage}.png"
        img.save(OUT / "buildings" / name, optimize=True)
        at = lambda p: [p[0] - ox, p[1] - oy]
        manifest[f"hut.{stage}"] = {"file": RES + "buildings/" + name, "size": [img.width, img.height],
                                    "foot": [round(fx), round(fy)], "block": 1, "painted": True,
                                    "anchor": at(CABIN_CHIMNEY), "window": at(CABIN_WINDOW), "hole": at(CABIN_HOLE),
                                    "_ox": ox, "_oy": oy}
    # the blizzard's hole as a decal of its own (cut from the generated overlay), laid where the hut says
    hole_src = ROOT / "godot/winter/assets/buildings/hut/roofhole.png"
    if hole_src.exists():
        hole, _ = trim(Image.open(hole_src).convert("RGBA"))
        hole.save(OUT / "buildings/roofhole.png", optimize=True)
        manifest["hut.roofhole"] = {"file": RES + "buildings/roofhole.png", "size": [hole.width, hole.height],
                                    "foot": [hole.width // 2, hole.height // 2], "decal": True, "painted": True}


# ── The survivors: the hero's figure in their own clothes ──
# coat: hue (degrees), saturation; scarf: hue, saturation; hat: value scale; face: the scarf pulled up over the
# chin (it hides the hero's beard); work: the hero's clip they work with; scale: the child is smaller.
SURVIVORS = {
    "hunter": {"coat": (95, 0.38), "scarf": (28, 0.7), "hat": 0.9, "face": False, "work": "gather", "scale": 1.0},
    "carpenter": {"coat": (28, 0.58), "scarf": (140, 0.45), "hat": 1.15, "face": False, "work": "chop", "scale": 1.0},
    "herbalist": {"coat": (295, 0.32), "scarf": (172, 0.5), "hat": 1.35, "face": True, "work": "gather", "scale": 0.95},
    "smith": {"coat": (220, 0.06), "scarf": (24, 0.85), "hat": 0.75, "face": False, "work": "mine", "scale": 1.04},
    "child": {"coat": (203, 0.5), "scarf": (48, 0.8), "hat": 1.2, "face": True, "work": "gather", "scale": 0.78},
}


def _hsv(rgb):
    mx, mn = rgb.max(2), rgb.min(2)
    d = np.maximum(mx - mn, 1e-6)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    return h, s, mx


def _rgb(h, s, v):
    h = (h % 360.0) / 60.0
    c = v * s
    x = c * (1 - np.abs(h % 2 - 1))
    z = np.zeros_like(h)
    k = np.floor(h).astype(int) % 6
    r = np.choose(k, [c, x, z, z, x, c])
    g = np.choose(k, [x, c, c, x, z, z])
    b = np.choose(k, [z, z, x, c, c, x])
    m = v - c
    return np.stack([r + m, g + m, b + m], axis=-1)


def dress(cell: Image.Image, look: dict) -> Image.Image:
    """The hero's frame in a survivor's clothes: the cool grey-blue coat and trousers, the red scarf and the dark
    leather of the hat take the survivor's colours; the light keeps its value, so the shading stays painted."""
    a = np.asarray(cell).astype(np.float32) / 255.0
    rgb, al = a[..., :3], a[..., 3]
    h, s, v = _hsv(rgb)
    on = al > 0.05
    ys, xs = np.nonzero(al > 0.5)
    if not len(ys):
        return cell
    top, bot, left, right = ys.min(), ys.max(), xs.min(), xs.max()
    hh = bot - top
    yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    head = yy < top + hh * 0.3
    coat = on & ~head & (((h >= 200) & (h <= 335)) | (s < 0.07)) & (v < 0.62) & ~((s < 0.07) & (v > 0.5))
    scarf = on & ((h <= 15) | (h >= 350)) & (s > 0.52) & (v > 0.3)
    hat = on & head & ((h >= 340) | (h <= 6)) & (s > 0.1) & (s < 0.32) & (v < 0.55)
    out = rgb.copy()
    ch, cs = look["coat"]
    out[coat] = _rgb(np.full(coat.sum(), ch), np.full(coat.sum(), cs) * (0.6 + 0.6 * s[coat] / 0.2).clip(0.6, 1.3), v[coat] * 1.08)
    sh, ss = look["scarf"]
    out[scarf] = _rgb(np.full(scarf.sum(), sh), np.full(scarf.sum(), ss), v[scarf])
    out[hat] = (rgb[hat] * look["hat"]).clip(0, 1)
    if look["face"]:
        # the scarf over the chin: the beard's warm brown in the face (right of the body's middle, between the
        # eyes and the scarf) becomes scarf
        face = on & (yy > top + hh * 0.2) & (yy < top + hh * 0.46) & (xx > left + (right - left) * 0.5) \
            & (h > 6) & (h < 26) & (s > 0.28) & (s < 0.58) & (v > 0.3) & (v < 0.6)
        out[face] = _rgb(np.full(face.sum(), sh), np.full(face.sum(), ss * 0.9), v[face] * 0.95)
    res = np.concatenate([out, al[..., None]], axis=-1)
    return Image.fromarray((res.clip(0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def survivors(manifest: dict) -> None:
    hero_e = manifest["char.hero"]
    sheet = Image.open(OUT / "characters/hero.png").convert("RGBA")
    fw, fh = hero_e["frame"]
    cols = sheet.width // fw

    def clip(name):
        c = hero_e["anims"][name + "_side"]
        return [sheet.crop((((c["from"] + i) % cols) * fw, (c["row"] + (c["from"] + i) // cols) * fh,
                            (((c["from"] + i) % cols) + 1) * fw, (c["row"] + (c["from"] + i) // cols + 1) * fh)) for i in range(c["count"])], c
    for sid, look in SURVIVORS.items():
        walk, wc = clip("walk")
        work, kc = clip(look["work"])
        frames = walk + work
        out = Image.new("RGBA", (16 * fw, 2 * fh), (0, 0, 0, 0))
        for i, fr in enumerate(walk):
            out.paste(dress(fr, look), (i * fw, 0))
        for i, fr in enumerate(work):
            out.paste(dress(fr, look), (i * fw, fh))
        name = f"survivor_{sid}.png"
        out.save(OUT / "characters" / name, optimize=True)
        anims = {
            "walk_side": {"row": 0, "from": 0, "count": len(walk), "fps": wc["fps"], "loop": True},
            "idle_side": {"row": 0, "from": 0, "count": 1, "fps": 1, "loop": True},
            "work_side": {"row": 1, "from": 0, "count": len(work), "fps": max(8, kc["fps"] - 4), "loop": True},
        }
        manifest["char.sv." + sid] = {"sheet": RES + "characters/" + name, "frame": [fw, fh], "foot": hero_e["foot"],
                                      "anims": anims, "scale": look["scale"], "painted": True}
        print(f"survivor {sid}: {len(frames)} frames")


# ── The animals: each faces right; the game mirrors them for left ──
# key: (source, clip name, fps, size on screen: ("w" | "h", px) of the first frame's body)
ANIMALS = {
    "animal.rabbit": ("hare_run.gif", "hop", 14, ("h", 50)),
    "animal.deer": ("deer_walk.gif", "walk", 12, ("h", 150)),
    "animal.wolf": ("wolf_run.gif", "run", 14, ("w", 124)),
    "animal.bear": ("bear.webp", "walk", 1, ("w", 170)),
}


# Single pictures of other poses, shown for a clip of their own (the bear's fighting stance while it strikes).
ANIMAL_POSES = {"animal.bear": [("swipe", "bear_attack.webp")]}


def clean_edge(fr: Image.Image) -> Image.Image:
    """Drops the one-pixel rim of the GIF's hard mask, where the old background's colour fringes the fur."""
    a = np.array(fr)
    m = a[..., 3] > 0
    inner = m.copy()
    inner[1:, :] &= m[:-1, :]
    inner[:-1, :] &= m[1:, :]
    inner[:, 1:] &= m[:, :-1]
    inner[:, :-1] &= m[:, 1:]
    a[~inner, 3] = 0
    return Image.fromarray(a, "RGBA")


def animal(manifest: dict, key: str) -> None:
    src, clip, fps, (axis, px) = ANIMALS[key]
    frames = [clean_edge(f) for f in frames_of(SRC / src)]
    extra = {}   # clip -> frame index of single-picture poses that follow the main clip
    for pose, file in ANIMAL_POSES.get(key, []):
        if (SRC / file).exists():
            extra[pose] = len(frames)
            frames.append(clean_edge(frames_of(SRC / file)[0]))
    n, ys, xs = hero_body(frames[0])
    s = px / ((xs.max() - xs.min()) if axis == "w" else (ys.max() - ys.min()))
    bottom = ys.max()
    low = xs[ys > bottom - (ys.max() - ys.min()) * 0.08]
    foot = ((low.min() + low.max()) / 2, bottom)
    left = right = up = down = 0
    for fr in frames:
        bb = fr.getchannel("A").getbbox()
        left, right = max(left, (foot[0] - bb[0]) * s), max(right, (bb[2] - foot[0]) * s)
        up, down = max(up, (foot[1] - bb[1]) * s), max(down, (bb[3] - foot[1]) * s)
    fw, fh = int(np.ceil(left + right)) + 4, int(np.ceil(up + down)) + 4
    fx, fy = int(np.ceil(left)) + 2, int(np.ceil(up)) + 2
    cols = min(16, len(frames))
    sheet = Image.new("RGBA", (cols * fw, -(-len(frames) // cols) * fh), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        ft, si = foot, s
        if i in extra.values():
            # a separate picture: as tall as the main one, its own paws on the same foot point
            _, eys, exs = hero_body(fr)
            si = s * (ys.max() - ys.min()) / max(1, eys.max() - eys.min())
            el = exs[eys > eys.max() - (eys.max() - eys.min()) * 0.08]
            ft = ((el.min() + el.max()) / 2, eys.max())
        big = fr.resize((max(1, round(fr.width * si)), max(1, round(fr.height * si))), Image.LANCZOS)
        ox, oy = fx - round(ft[0] * si), fy - round(ft[1] * si)
        cell = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        cell.alpha_composite(big.crop((max(0, -ox), max(0, -oy), big.width, big.height)), (max(0, ox), max(0, oy)))
        sheet.paste(cell, ((i % cols) * fw, (i // cols) * fh))
    name = key.split(".")[1] + ".png"
    (OUT / "animals").mkdir(parents=True, exist_ok=True)
    sheet.save(OUT / "animals" / name, optimize=True)
    main_n = len(frames) - len(extra)
    anims = {clip + "_side": {"row": 0, "from": 0, "count": main_n, "fps": fps, "loop": True},
             "idle_side": {"row": 0, "from": 0, "count": 1, "fps": 1, "loop": True}}
    for pose, i in extra.items():
        anims[pose + "_side"] = {"row": i // cols, "from": i % cols, "count": 1, "fps": 1, "loop": True}
    manifest[key] = {"sheet": RES + "animals/" + name, "frame": [fw, fh], "foot": [fx, fy], "anims": anims,
                     "painted": True, "still": main_n == 1}
    # the eyes (yellow, like the wolf's): where they shine at night, in the cell, from the first frame
    a = np.asarray(frames[0]).astype(int)
    eye = (a[..., 3] > 0) & (a[..., 0] > 190) & (a[..., 1] > 140) & (a[..., 2] < 90) & (a[..., 0] - a[..., 2] > 120)
    if eye.sum() >= 3:
        ey, ex = np.nonzero(eye)
        manifest[key]["eyes"] = [round(fx + (ex.mean() - foot[0]) * s), round(fy + (ey.mean() - foot[1]) * s)]
    print(f"{key}: {len(frames)} frames of {fw}×{fh}")


# The trader in a burgundy fur coat and a gold scarf; the wounded wanderer in faded clothes, lying in the snow.
TRADER = {"coat": (356, 0.55), "scarf": (44, 0.75), "hat": 0.7, "face": False}
WANDERER = {"coat": (32, 0.14), "scarf": (210, 0.22), "hat": 1.25, "face": True}


def strangers(manifest: dict) -> None:
    hero_e = manifest["char.hero"]
    sheet = Image.open(OUT / "characters/hero.png").convert("RGBA")
    fw, fh = hero_e["frame"]
    fx, fy = hero_e["foot"]
    stand = sheet.crop((0, 0, fw, fh))
    # the trader: standing by his sled, a slow breath (the idle frame and a slightly raised one)
    trader = dress(stand, TRADER)
    out = Image.new("RGBA", (fw * 2, fh), (0, 0, 0, 0))
    out.paste(trader, (0, 0))
    breath = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    breath.alpha_composite(trader.resize((fw, fh + 2), Image.LANCZOS).crop((0, 2, fw, fh + 2)))
    out.paste(breath, (fw, 0))
    out.save(OUT / "characters/trader.png", optimize=True)
    manifest["char.trader"] = {"sheet": RES + "characters/trader.png", "frame": [fw, fh], "foot": [fx, fy],
                               "anims": {"idle_side": {"row": 0, "from": 0, "count": 2, "fps": 1.2, "loop": True}},
                               "painted": True}
    # the wanderer: the figure laid on its side, head to the right, its middle on the foot point
    worn = dress(stand, WANDERER)
    body, _ = trim(worn)
    lying = body.rotate(90, expand=True, resample=Image.BICUBIC)
    lw, lh = lying.width + 8, lying.height + 8
    cell = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    cell.alpha_composite(lying, (4, 4))
    cell.save(OUT / "characters/wanderer.png", optimize=True)
    manifest["char.wanderer"] = {"sheet": RES + "characters/wanderer.png", "frame": [lw, lh], "foot": [lw // 2, lh - 6],
                                 "anims": {"idle_side": {"row": 0, "from": 0, "count": 1, "fps": 1, "loop": True}},
                                 "painted": True, "lying": True}
    print("trader and wanderer")


def main() -> None:
    manifest = {"_replace": REPLACE}
    env(manifest)
    cabin(manifest)
    hero(manifest)
    import compose_buildings
    compose_buildings.build(manifest, OUT / "environment", SRC / "cabin.webp", OUT / "buildings", RES + "buildings/")
    survivors(manifest)
    strangers(manifest)
    for key in ANIMALS:
        animal(manifest, key)
    MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    size = sum(p.stat().st_size for p in OUT.rglob("*.png"))
    print(f"{len(manifest) - 1} keys, {size // 1024} KB")


if __name__ == "__main__":
    main()
