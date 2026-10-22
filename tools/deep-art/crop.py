"""Cut the creature sheet (sheet.png) into atlas cards for Глубина: web/deep/art/<species>.webp.

The sheet is one painted picture, 7 rows of 5 cards in the species order of web/deep/core.js,
with a caption under every picture. Each card is cut above its caption.
Run from the repo root: python3 tools/deep-art/crop.py
"""
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from cells import cells  # noqa: E402

# Species ids in sheet order (the order of SPECIES in web/deep/core.js when the sheet was painted).
IDS = [
    'diatom', 'noctiluca', 'snow', 'ciliate', 'radiolarian',
    'foram', 'xeno', 'copepod', 'krill', 'shrimp',
    'amphipod', 'anchovy', 'lanternfish', 'hatchetfish', 'snailfish',
    'mackerel', 'moonjelly', 'combjelly', 'viperfish', 'angler',
    'tripod', 'squid', 'vampire', 'gulper', 'dumbo',
    'shark', 'goblin', 'giantsquid', 'humpback', 'sperm',
    'siphonophore', 'serpent', 'kraken', 'aspidochelone', 'leviathan',
]
# Where the captions start in each row (the first caption line is white text).
CAPTION_TOP = [139, 305, 468, 640, 817, 980, 1149]
OUT = 'web/deep/art'


def main():
    here = os.path.dirname(__file__)
    sheet = Image.open(os.path.join(here, 'sheet.png')).convert('RGB')
    os.makedirs(OUT, exist_ok=True)
    for i, (sid, (l, t, r, _)) in enumerate(zip(IDS, cells())):
        card = sheet.crop((l, t, r, CAPTION_TOP[i // 5] - 3))
        card.save(os.path.join(OUT, sid + '.webp'), 'WEBP', quality=88, method=6)
    print(f'{len(IDS)} cards in {OUT}')


if __name__ == '__main__':
    main()
