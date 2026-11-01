#!/usr/bin/env python3
"""Ember Flipbooks for Последняя крепость on Godot: cuts the purchased sheets down for the web.

The Ember Flipbooks licence (Inkharbor Studio) forbids putting its files, original or modified, in a public
repository, so they never enter git: this script writes them to godot/castle/assets/ember/ (ignored by git).
The game uses them when they are there and falls back to its own particles when they are not; a build made
with them carries them packed inside index.pck, which the licence allows (part of a built product).

    python3 tools/castle-godot/ember.py /path/to/ember-flipbooks-lite.zip   (or the unzipped folder)

Each effect is scaled to 128 px frames and keeps every second frame (15 fps), so the six sheets of 2048 px
become about a megabyte together. Needs Pillow.
"""
import io
import json
import math
import sys
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "godot/castle/assets/ember"
SIZE = 128
KEEP = {  # effect id -> how many frames of the source to use (one-shots end early: their tail is empty)
    "fire_campfire": None,
    "explosion_fireball": 96,
    "magic_arcane_burst": None,
    "elemental_lightning_strike": None,
    "magic_heal_aura": None,
}


def open_source(src: Path):
    if src.is_dir():
        return lambda rel: (src / rel).read_bytes()
    z = zipfile.ZipFile(src)
    names = z.namelist()

    def read(rel):
        hit = next(n for n in names if n.endswith(rel))
        return z.read(hit)
    return read


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    read = open_source(Path(sys.argv[1]))
    effects = json.loads(read("effects.json"))
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {}
    for fx in effects:
        if fx["id"] not in KEEP:
            continue
        sheet = Image.open(io.BytesIO(read(fx["sheet"]))).convert("RGBA")
        fw, fh, cols = fx["frame_w"], fx["frame_h"], fx["columns"]
        frames = fx["frames"] if KEEP[fx["id"]] is None else min(fx["frames"], KEEP[fx["id"]])
        picked = list(range(0, frames, 2))
        out_cols = 8
        out_rows = math.ceil(len(picked) / out_cols)
        out = Image.new("RGBA", (out_cols * SIZE, out_rows * SIZE), (0, 0, 0, 0))
        for k, i in enumerate(picked):
            box = ((i % cols) * fw, (i // cols) * fh, (i % cols + 1) * fw, (i // cols + 1) * fh)
            frame = sheet.crop(box).resize((SIZE, SIZE), Image.LANCZOS)
            out.paste(frame, ((k % out_cols) * SIZE, (k // out_cols) * SIZE))
        out.save(OUT / f"{fx['id']}.png", optimize=True)
        meta[fx["id"]] = {"frames": len(picked), "columns": out_cols, "rows": out_rows,
                          "fps": fx["fps"] / 2, "loop": bool(fx["loop"])}
        print(f"{fx['id']}: {len(picked)} frames, {(OUT / (fx['id'] + '.png')).stat().st_size // 1024} KB")
    (OUT / "ember.json").write_text(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
