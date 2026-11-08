"""Contact sheets for looking at animations: python3 preview.py OUTDIR who anim[,anim…] [scale]

`who` is hero | villager | trader | wanderer | rabbit | deer | wolf | bear. Each row is one animation × direction,
frames left to right on a pale snow background.
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import build  # noqa: E402


def main():
    out, who, names = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
    scale = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    spec = build.SPECS[who]
    rows = []
    for anim, d, n, fps, loop, pose in build.frames_of(spec):
        if anim not in names and "all" not in names:
            continue
        row = [build.render_frame(spec, pose, d, k, n, loop)[0] for k in range(n)]
        rows.append(np.concatenate(row, 1))
    w = max(r.shape[1] for r in rows)
    rows = [np.pad(r, ((0, 0), (0, w - r.shape[1]), (0, 0))) for r in rows]
    img = np.concatenate(rows, 0)
    fh = img.shape[0] // len(rows)
    a = img[..., 3].reshape(len(rows), fh, -1).max(0)
    ys = np.nonzero(a.max(1) > 0.01)[0]
    cw = build.CANVAS[0]
    ac = img[..., 3].reshape(img.shape[0], -1, cw).max(axis=(0, 1))
    xs = np.nonzero(ac > 0.01)[0]
    y0, y1, x0, x1 = max(0, ys.min() - 2), min(fh, ys.max() + 3), max(0, xs.min() - 2), min(cw, xs.max() + 3)
    img = img.reshape(len(rows), fh, -1, cw, 4)[:, y0:y1, :, x0:x1]
    img = img.transpose(0, 1, 2, 3, 4).reshape(len(rows) * (y1 - y0), -1, 4)
    bg = np.ones_like(img[..., :3]) * np.array([0.82, 0.87, 0.95])
    o = img[..., :3] * img[..., 3:] + bg * (1 - img[..., 3:])
    im = Image.fromarray((np.clip(o, 0, 1) * 255).astype(np.uint8))
    if scale > 1:
        im = im.resize((im.width * scale, im.height * scale), Image.LANCZOS)
    path = os.path.join(out, f"{who}_{'_'.join(names)}.png")
    im.save(path)
    print(path, im.size)


if __name__ == "__main__":
    main()
