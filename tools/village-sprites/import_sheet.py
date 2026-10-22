#!/usr/bin/env python3
"""Родник — import hand-painted sprites from a sprite sheet into web/village/sprites.

    python3 tools/village-sprites/import_sheet.py tools/village-sprites/sheets/sheet-1.json

The sheet is a flat picture (no transparency): objects painted on a dark grey checkerboard, the way image
tools show "transparent". This script
  1. floods the checkerboard (and the grey drop shadows on it) from the edges, splits the rest into objects,
     closes their outlines and fills holes, so grey stones are not eaten by the grey background;
  2. cuts each object listed in the sheet's JSON with a soft one-pixel edge;
  3. scales it to the world size the game expects and finds its anchor (the foot: where it meets the ground);
  4. writes the PNG and marks its entry in sprites.json as hand-made ("hand": the sheet), so generate.py keeps
     it instead of painting over it.

The sheet's JSON names the image and, per game sprite, the object index (as in the numbered preview this
script writes with --preview) and options: flip, the world height or width to scale to, a colour change.
Ruins also get a winter copy with snow on the grass and moss.
"""
import json
import math
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'web', 'village', 'sprites')
BG_LUM, BG_SAT = 58, 11   # the checkerboard and the shadows on it are darker and greyer than any object


def segment(rgb):
    """Objects of the sheet: a list of (box, mask) in sheet order (rows top to bottom, then left to right)."""
    a = rgb.astype(np.int32)
    lum, sat = a.mean(2), a.max(2) - a.min(2)
    bgl = (sat <= BG_SAT) & (lum < BG_LUM)
    h, w = bgl.shape
    seen = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bgl[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bgl[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and bgl[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    fg = ~seen
    lab = np.zeros((h, w), np.int32)
    found = []
    n = 0
    for y0 in range(h):
        for x0 in np.nonzero(fg[y0] & (lab[y0] == 0))[0]:
            if lab[y0, x0]:
                continue
            n += 1
            lab[y0, x0] = n
            q = deque([(y0, x0)])
            ys, xs = [], []
            while q:
                y, x = q.popleft()
                ys.append(y)
                xs.append(x)
                for dy in (-2, -1, 0, 1, 2):     # 2 px reach: tufts and leaves next to a body join it
                    for dx in (-2, -1, 0, 1, 2):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n
                            q.append((ny, nx))
            if len(xs) > 150:
                found.append((n, (int(min(xs)), int(min(ys)), int(max(xs)) + 1, int(max(ys)) + 1)))
    found.sort(key=lambda t: ((t[1][1] + t[1][3]) / 2, t[1][0]))
    rows = []
    for t in found:
        cy = (t[1][1] + t[1][3]) / 2
        if rows and abs(rows[-1][0] - cy) < 40:
            rows[-1][1].append(t)
        else:
            rows.append([cy, [t]])
    objects = []
    for _, r in rows:
        for n_, box in sorted(r, key=lambda t: t[1][0]):
            x0, y0, x1, y1 = box
            objects.append((box, solid(lab[y0:y1, x0:x1] == n_)))
    return objects


def solid(mask):
    """Close small gaps in the outline (2 px) and fill the holes inside it."""
    m = np.pad(mask, 3)
    def grow(a, r):
        out = a.copy()
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r:
                    out |= np.roll(np.roll(a, dy, 0), dx, 1)
        return out
    closed = ~grow(~grow(m, 2), 2)
    # Holes: background pixels not reachable from the border.
    h, w = closed.shape
    outside = np.zeros_like(closed)
    q = deque([(0, 0)])
    outside[0, 0] = True
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not outside[ny, nx] and not closed[ny, nx]:
                outside[ny, nx] = True
                q.append((ny, nx))
    return (~outside | m)[3:-3, 3:-3]


def cut(rgb, obj):
    """The object as RGBA with a soft one-pixel edge, trimmed to its pixels."""
    (x0, y0, x1, y1), mask = obj
    alpha = Image.fromarray(mask.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    img = Image.fromarray(rgb[y0:y1, x0:x1]).convert('RGBA')
    img.putalpha(alpha)
    return img.crop(img.getbbox())


def foot(img, kind):
    """The anchor in image px: the middle of the base, a little above the lowest pixels (grass tufts)."""
    a = np.asarray(img)[..., 3] > 128
    ys, xs = np.nonzero(a)
    bottom = ys.max()
    h = bottom - ys.min() + 1
    band = ys >= bottom - h * 0.12
    ax = xs[band].mean()
    lift = {'tree': 0.035, 'pine': 0.03, 'stump': 0.12, 'rock': 0.12, 'bush': 0.08, 'shrub': 0.08}.get(kind, 0)
    return float(ax), float(bottom + 1 - h * lift)


def recolor(img, o):
    """Optional colour changes: brightness, saturation, a hue rotation (degrees)."""
    if not o:
        return img
    a = img.getchannel('A')
    rgb = img.convert('RGB')
    if 'bright' in o:
        rgb = ImageEnhance.Brightness(rgb).enhance(o['bright'])
    if 'sat' in o:
        rgb = ImageEnhance.Color(rgb).enhance(o['sat'])
    if 'hue' in o:
        hsv = np.asarray(rgb.convert('HSV')).astype(np.int32)
        hsv[..., 0] = (hsv[..., 0] + int(o['hue'] / 360 * 255)) % 256
        rgb = Image.fromarray(hsv.astype(np.uint8), 'HSV').convert('RGB')
    out = rgb.convert('RGBA')
    out.putalpha(a)
    return out


def snowy(img, seed):
    """Winter: grass, moss and leaves turn to snow; stone and wood stay."""
    arr = np.asarray(img).astype(np.float64)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    # Plants: any pixel where green leads (the sheet's mossy greens are muted, so the threshold is low),
    # plus the upper faces of stones, found as pixels lighter than the pixel a few rows below them.
    green = np.clip((g - np.maximum(r * 0.92, b * 1.05)) / 18, 0, 1)
    lum = arr[..., :3].mean(2)
    below = np.roll(lum, -3, 0)
    top = np.clip((lum - below) / 25, 0, 1) * (arr[..., 3] > 0)
    green = np.maximum(green, top * 0.8)
    rng = np.random.default_rng(seed)
    noise = np.asarray(Image.fromarray((rng.random((arr.shape[0] // 6 + 2, arr.shape[1] // 6 + 2)) * 255).astype(np.uint8))
                       .resize((arr.shape[1], arr.shape[0]), Image.BICUBIC)) / 255
    lumv = arr[..., :3].mean(2) / 255
    cover = np.clip(green * 1.3 + (lumv - 0.55) * 0.9 + (noise - 0.5) * 0.4, 0, 0.95)[..., None]
    snow = np.array([238, 244, 250.0]) * (0.85 + 0.15 * lumv[..., None])
    arr[..., :3] = arr[..., :3] * (1 - cover) + snow * cover
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')


def preview(rgb, objects, path):
    vis = Image.fromarray(rgb)
    d = ImageDraw.Draw(vis)
    for i, ((x0, y0, x1, y1), _) in enumerate(objects):
        d.rectangle((x0, y0, x1, y1), outline=(255, 0, 255))
        d.text((x0 + 2, y0 + 1), str(i), fill=(255, 255, 0))
    vis.save(path)


def main():
    spec_path = sys.argv[1]
    spec = json.load(open(spec_path))
    base = os.path.dirname(os.path.abspath(spec_path))
    rgb = np.asarray(Image.open(os.path.join(base, spec['image'])).convert('RGB'))
    objects = segment(rgb)
    print(f'{len(objects)} objects on the sheet')
    if '--preview' in sys.argv:
        out = sys.argv[sys.argv.index('--preview') + 1]
        preview(rgb, objects, out)
        print('numbered preview →', out)
        return
    man_path = os.path.join(OUT, 'sprites.json')
    man = json.load(open(man_path))
    sprites = man['sprites']
    written = 0
    for name, o in spec['sprites'].items():
        img = cut(rgb, objects[o['object']])
        if o.get('flip'):
            img = ImageOps.mirror(img)
        img = recolor(img, o.get('color'))
        kind = o['kind']
        if kind == 'ruin':
            # Fit the ruin to its footprint: o['fit'] = [x, y, w] in world px from the footprint's top-left
            # (where the image's left edge, bottom edge and width go).
            fx, fbottom, fw = o['fit']
            k = fw / img.width
            w, h = fw, img.height * k
            ax, ay = -fx, -(fbottom - h)          # the footprint's top-left inside the image, world px
        else:
            k = (o['height'] / img.height) if 'height' in o else (o['width'] / img.width)
            w, h = img.width * k, img.height * k
            fx_, fy_ = foot(img, kind)
            ax, ay = fx_ * k, fy_ * k
        res = o.get('res', spec.get('res', 2))   # PNG px per world px: the sheet's own detail, no upscaling past it
        res = min(res, 1 / k) if not o.get('upscale') else res
        pw, ph = max(1, round(w * res)), max(1, round(h * res))
        out = img.resize((pw, ph), Image.LANCZOS)
        variants = [(name, out, {})]
        if isinstance(o.get('snow'), str):   # a ruin: also write its winter copy under this name
            variants.append((o['snow'], snowy(out, len(name)), {'snow': 1}))
        for vname, vimg, extra in variants:
            entry = {k_: v for k_, v in o.items() if k_ in ('mid', 'shape', 'size', 'pine', 'full')}
            if isinstance(o.get('snow'), int):
                entry['snow'] = o['snow']
            entry.update(extra)
            if kind == 'ruin' and 'snow' not in extra:
                entry['snow'] = 0
            entry.update({'file': vname + '.png', 'kind': kind, 'w': round(w, 2), 'h': round(h, 2),
                          'ax': round(ax, 2), 'ay': round(ay, 2), 'res': round(pw / w, 4), 'hand': spec['image']})
            # 256 colours with alpha: a quarter of the size, and the eye can't tell on these painted shapes.
            vimg.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(os.path.join(OUT, vname + '.png'), optimize=True)
            sprites[vname] = entry
            written += 1
    for name in spec.get('remove', []):
        if name in sprites:
            path = os.path.join(OUT, sprites[name]['file'])
            if os.path.exists(path):
                os.remove(path)
            del sprites[name]
    with open(man_path, 'w') as f:
        json.dump(man, f, indent=1, sort_keys=True)
        f.write('\n')
    print(f'{written} sprites written to {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
