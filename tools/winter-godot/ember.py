#!/usr/bin/env python3
"""Ember Flipbooks for Долгая зима on Godot: the campfire flipbook, cut down for the game.

The Ember Flipbooks licence (Inkharbor Studio) forbids putting its files, original or modified, in a public
repository, so they never enter git: this script writes them to godot/winter/assets/ember/ (ignored by git).
The game uses them when they are there and falls back to its own generated flame when they are not; a build
made with them carries them packed inside index.pck, which the licence allows (part of a built product).

    python3 tools/winter-godot/ember.py /path/to/ember-flipbooks-lite.zip   (or the unzipped folder)

Only the campfire is used (the camp fire and, smaller, the torches). Every frame of its 64-frame crossfaded
loop is kept (30 fps, no seam); each 256 px frame is cropped to the flame and its embers (the wide glow is dropped:
the game lights the snow itself), then scaled to 3/4. Needs Pillow.
"""
import io
import json
import sys
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "godot/winter/assets/ember"
ID = "fire_campfire"
CROP = (40, 8, 216, 208)        # in a 256 px source frame: the flame, sparks and glow, without the empty corners
BASE = (128, 160)               # where the flame meets the logs, in the source frame
SCALE = 0.75


def clean(frame: Image.Image) -> Image.Image:
    """Keeps the flame, the embers and the sparks; drops the wide dim glow (the game lights the snow with its own
    PointLight2D, and a glow cut by the frame's edge would show as a rectangle) and fades the frame out toward its
    edges so nothing ends on a hard line."""
    import numpy as np
    a = np.asarray(frame, dtype=np.float32) / 255.0
    rgb, alpha = a[..., :3], a[..., 3]
    lum = rgb.max(axis=2) * alpha
    keep = np.clip((lum - 0.34) / 0.3, 0.0, 1.0) ** 0.8
    h, w = alpha.shape
    yy, xx = np.mgrid[0:h, 0:w]
    bx, by = (BASE[0] - CROP[0]) * SCALE, (BASE[1] - CROP[1]) * SCALE
    # an egg around the flame: wide at the base, taller above it
    dx = (xx - bx) / (w * 0.3)
    dy = (yy - by) / np.where(yy < by, h * 0.72, h * 0.22)
    r = np.sqrt(dx * dx + dy * dy)
    fade = np.clip((1.0 - r) / 0.55, 0.0, 1.0) ** 1.5
    a[..., 3] = alpha * keep * fade
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype("uint8"), "RGBA")


def open_source(src: Path):
    if src.is_dir():
        return lambda rel: (src / rel).read_bytes()
    z = zipfile.ZipFile(src)
    names = z.namelist()

    def read(rel):
        return z.read(next(n for n in names if n.endswith(rel)))
    return read


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    read = open_source(Path(sys.argv[1]))
    fx = next(e for e in json.loads(read("effects.json")) if e["id"] == ID)
    sheet = Image.open(io.BytesIO(read(fx["sheet"]))).convert("RGBA")
    fw, fh, cols = fx["frame_w"], fx["frame_h"], fx["columns"]
    cw, ch = CROP[2] - CROP[0], CROP[3] - CROP[1]
    w, h = round(cw * SCALE), round(ch * SCALE)
    n = fx["frames"]
    out_cols = 8
    out_rows = -(-n // out_cols)
    out = Image.new("RGBA", (out_cols * w, out_rows * h), (0, 0, 0, 0))
    for i in range(n):
        x0, y0 = (i % cols) * fw, (i // cols) * fh
        frame = sheet.crop((x0 + CROP[0], y0 + CROP[1], x0 + CROP[2], y0 + CROP[3])).resize((w, h), Image.LANCZOS)
        out.paste(clean(frame), ((i % out_cols) * w, (i // out_cols) * h))
    OUT.mkdir(parents=True, exist_ok=True)
    out.save(OUT / f"{ID}.png", optimize=True)
    meta = {ID: {
        "frame": [w, h], "frames": n, "columns": out_cols, "fps": fx["fps"], "loop": True,
        "base": [round((BASE[0] - CROP[0]) * SCALE), round((BASE[1] - CROP[1]) * SCALE)],
    }}
    (OUT / "ember.json").write_text(json.dumps(meta, indent=1))
    print(f"{ID}: {n} frames of {w}×{h}, {(OUT / (ID + '.png')).stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
