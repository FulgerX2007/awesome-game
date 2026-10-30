#!/usr/bin/env python3
"""Тяни штифт on Godot: cuts the style reference (tools/pins-godot/reference/sheet.webp, a painted mock-up of a
level) into separate sprites with transparent backgrounds and into textures, so the game builds its own levels
from the parts instead of using the picture as a backdrop.

    python3 tools/pins-godot/slice.py   ->  godot/pins/assets/style/*.png, godot/pins/data/style.json

Sprites (transparent): hero, torch, door, exit sign, pin ring, pin collar, pin cap, coins, gems, vines.
Textures (opaque): stone (the masonry face), back (the dark brick wall of the chambers), wood (the planks of
the hero's room), band (an iron band across the planks), lava, rod (a gold rod, a 1-pixel column across it).
Cut-outs of figures on painted backgrounds use OpenCV GrabCut, seeded with a rough hand-drawn outline.
Coordinates are pixels of the 1058x1487 reference.
"""
import json
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '../..')
SRC = os.path.join(HERE, 'reference/sheet.webp')
OUT = os.path.join(ROOT, 'godot/pins/assets/style')
META = os.path.join(ROOT, 'godot/pins/data/style.json')

img = cv2.imread(SRC)
assert img is not None and img.shape[:2] == (1487, 1058), 'reference/sheet.webp must be the 1058x1487 mock-up'
meta = {}


def save(name, bgr, alpha=None, **info):
    os.makedirs(OUT, exist_ok=True)
    out = bgr if alpha is None else np.dstack([bgr, alpha])
    cv2.imwrite(os.path.join(OUT, name + '.png'), out)
    meta[name] = {'w': int(bgr.shape[1]), 'h': int(bgr.shape[0]), **info}


def feather(mask, r=1):
    return cv2.GaussianBlur(mask, (2 * r + 1, 2 * r + 1), 0) if r else mask


def cut_outline(name, outline, pad=6, iters=10, **info):
    """GrabCut inside a rough outline: the outline (eroded) is surely the figure, far outside surely not."""
    pts = np.array(outline, np.int32)
    x0, y0 = pts.min(0) - pad
    x1, y1 = pts.max(0) + pad + 1
    crop = img[y0:y1, x0:x1].copy()
    poly = np.zeros(crop.shape[:2], np.uint8)
    cv2.fillPoly(poly, [pts - [x0, y0]], 255)
    mask = np.full(crop.shape[:2], cv2.GC_BGD, np.uint8)
    mask[cv2.dilate(poly, np.ones((7, 7), np.uint8)) > 0] = cv2.GC_PR_BGD
    mask[poly > 0] = cv2.GC_PR_FGD
    mask[cv2.erode(poly, np.ones((9, 9), np.uint8)) > 0] = cv2.GC_FGD
    bgd, fgd = np.zeros((1, 65)), np.zeros((1, 65))
    cv2.grabCut(crop, mask, None, bgd, fgd, iters, cv2.GC_INIT_WITH_MASK)
    a = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(a)
    if n > 1:
        a = np.where(lab == 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]), 255, 0).astype(np.uint8)
    a = cv2.morphologyEx(a, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    save(name, crop, feather(a), x=int(x0), y=int(y0), **info)


def cut_mask(name, box, draw):
    """A sprite whose shape is known exactly: draw(mask, offset) paints it."""
    x0, y0, x1, y1 = box
    crop = img[y0:y1, x0:x1].copy()
    m = np.zeros(crop.shape[:2], np.uint8)
    draw(m, (x0, y0))
    save(name, crop, feather(m, 1), x=x0, y=y0)


def texture(name, box, **info):
    x0, y0, x1, y1 = box
    save(name, img[y0:y1, x0:x1].copy(), x=x0, y=y0, **info)


# ── Figures ──
cut_outline('hero', [(178, 1242), (190, 1235), (205, 1235), (220, 1242), (232, 1251), (232, 1268), (229, 1290),
                     (223, 1300), (232, 1318), (238, 1345), (236, 1360), (229, 1364), (229, 1386), (227, 1400),
                     (189, 1400), (186, 1386), (175, 1376), (160, 1364), (162, 1340), (168, 1318), (176, 1301),
                     (172, 1291), (167, 1283), (171, 1270), (175, 1257)],
            feet=[208, 1400])
cut_outline('torch', [(396, 1207), (406, 1222), (411, 1245), (415, 1262), (410, 1277), (404, 1281), (404, 1300),
                      (392, 1300), (392, 1281), (386, 1276), (384, 1262), (388, 1240), (392, 1222)],
            flame=[398, 1250])


# ── The door: an arch (a half circle on a rectangle), and the exit sign over it ──
def arch(m, o):
    cx, cy, r = 474.5 - o[0], 1275.5 - o[1], 60.5
    cv2.circle(m, (int(cx), int(cy)), int(r), 255, -1, cv2.LINE_AA)
    cv2.rectangle(m, (int(cx - r), int(cy)), (int(cx + r), 1397 - o[1]), 255, -1)


cut_mask('door', (412, 1213, 538, 1398), arch)
meta['door']['arch'] = [474.5, 1275.5, 60.5]


def sign(m, o):
    cv2.rectangle(m, (452 - o[0], 1185 - o[1]), (499 - o[0], 1210 - o[1]), 255, -1)


cut_mask('sign', (449, 1182, 503, 1213), sign)


# ── The pin: its ring (a torus), the collar by the ring and the cap at the far end; the rod is a texture ──
def ring(m, o):
    # the gold of the torus inside its outer circle (the hole shows the wall behind, so go by colour)
    disc = np.zeros_like(m)
    cv2.circle(disc, (int(93.5 - o[0]), int(810 - o[1])), 36, 255, -1, cv2.LINE_AA)
    hsv = cv2.cvtColor(img[o[1]:o[1] + m.shape[0], o[0]:o[0] + m.shape[1]], cv2.COLOR_BGR2HSV)
    gold = cv2.inRange(hsv, np.array((8, 90, 70)), np.array((40, 255, 255)))
    gold = cv2.morphologyEx(gold, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    m[:] = cv2.bitwise_and(gold, disc)


cut_mask('ring', (56, 773, 132, 848), ring)
meta['ring']['center'] = [93.5, 810]


def collar(m, o):
    cv2.rectangle(m, (118 - o[0], 797 - o[1]), (149 - o[0], 830 - o[1]), 255, -1)


cut_mask('collar', (116, 795, 151, 832), collar)


def cap(m, o):
    cv2.ellipse(m, (513 - o[0], 813 - o[1]), (13, 17), 0, 0, 360, 255, -1, cv2.LINE_AA)


cut_mask('cap', (498, 794, 528, 832), cap)
texture('rod', (300, 803, 301, 825), axis=[814])


# ── Gold: three front-facing coins and the three gems ──
for i, (cx, cy, r) in enumerate([(238.5, 753.5, 22), (460, 753, 23), (381, 700, 21)]):
    def coin(m, o, cx=cx, cy=cy, r=r):
        cv2.circle(m, (int(cx - o[0]), int(cy - o[1])), r, 255, -1, cv2.LINE_AA)
    cut_mask(f'coin{i}', (int(cx - r - 2), int(cy - r - 2), int(cx + r + 3), int(cy + r + 3)), coin)

for name, (cx, cy, r), (lo, hi) in [('gem_blue', (198.5, 687.5, 22), ((90, 80, 80), (130, 255, 255))),
                                    ('gem_green', (324.5, 735, 24), ((40, 80, 60), (85, 255, 255))),
                                    ('gem_red', (435, 716, 22), ((150, 80, 80), (180, 255, 255)))]:
    x0, y0, x1, y1 = int(cx - r), int(cy - r), int(cx + r), int(cy + r)
    crop = img[y0:y1, x0:x1].copy()
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    m = cv2.inRange(hsv, np.array(lo), np.array(hi))
    if name == 'gem_red':  # red wraps around the hue circle
        m |= cv2.inRange(hsv, np.array((0, 80, 80)), np.array((8, 255, 255)))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    if n > 1:
        m = np.where(lab == 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]), 255, 0).astype(np.uint8)
    hull = cv2.convexHull(cv2.findNonZero(m))
    m2 = np.zeros_like(m)
    cv2.fillConvexPoly(m2, hull, 255, cv2.LINE_AA)
    save(name, crop, feather(m2), x=x0, y=y0)


# ── Vines: the green leaves hanging over the rock at the edges ──
for i, box in enumerate([(30, 485, 85, 650), (985, 110, 1045, 245), (975, 770, 1045, 965)]):
    x0, y0, x1, y1 = box
    crop = img[y0:y1, x0:x1].copy()
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    m = cv2.inRange(hsv, np.array((35, 60, 35)), np.array((95, 255, 255)))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    save(f'vine{i}', crop, feather(m), x=x0, y=y0)


# ── Textures ──
texture('stone', (598, 905, 918, 1385), brick=[80, 46])  # the masonry face of the rock
texture('back', (600, 92, 905, 330))                       # the dark wall at the back of a chamber (above the lava's glow)
texture('wood', (148, 910, 528, 1180), plank=48)           # the planks of the hero's room
texture('band', (148, 880, 528, 908))                      # an iron band with rivets across the planks
texture('lava', (620, 660, 905, 825))                      # the cells of the lava pool
# Faces of four single bricks (no mortar), side by side, 80x40 each: every brick of the rock takes one of
# them (flipped and shifted at random) for its painted surface, the shader draws the bevel and the seams.
faces = [cv2.resize(img[y0:y1, x0:x1], (80, 40), interpolation=cv2.INTER_AREA)
         for x0, y0, x1, y1 in [(706, 941, 788, 979), (748, 1053, 826, 1093), (686, 1053, 732, 1093), (653, 1112, 710, 1155)]]
save('faces', np.hstack(faces), count=4)
texture('crust', (140, 1390, 600, 1430))                   # the lit stone ledge of the floor

with open(META, 'w') as f:
    f.write(json.dumps(meta, indent=1) + '\n')
print('sliced %d parts into godot/pins/assets/style' % len(meta))
