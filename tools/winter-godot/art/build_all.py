"""Долгая зима on Godot — regenerates every world asset (environment, buildings, effects) from scratch.

    python3 tools/winter-godot/art/build_all.py

Old PNGs of these groups are removed first (their .import files too, so Godot re-imports cleanly), then the
generators write the PNGs and the manifest fragments. Deterministic: the same code gives the same files.
"""

import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from paint import ASSETS  # noqa: E402
import buildings  # noqa: E402
import effects  # noqa: E402
import environment  # noqa: E402


def main():
    for d in ("environment", "buildings", "effects"):
        shutil.rmtree(os.path.join(ASSETS, d), ignore_errors=True)
    total = 0
    for mod in (environment, buildings, effects):
        t = time.time()
        path, m = mod.build()
        total += len(m.items)
        print(f"{os.path.basename(path)}: {len(m.items)} keys in {time.time() - t:.0f} s")
    size = 0
    for d in ("environment", "buildings", "effects"):
        for root, _, files in os.walk(os.path.join(ASSETS, d)):
            size += sum(os.path.getsize(os.path.join(root, f)) for f in files if f.endswith(".png"))
    print(f"{total} keys, {size / 1e6:.2f} MB of PNG")


if __name__ == "__main__":
    main()
