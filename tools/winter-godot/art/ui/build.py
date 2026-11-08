"""Builds the UI kit of Долгая зима on Godot into godot/winter/assets/ui and its manifest fragment:
    python3 tools/winter-godot/art/ui/build.py
Deterministic: the same code gives the same files. Takes about half a minute.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import kit  # noqa: E402
import menubg  # noqa: E402
import title  # noqa: E402
from catalog import ICONS  # noqa: E402
from sdf import Canvas, finish_icon  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, "../../../../godot/winter"))
OUT = os.path.join(ROOT, "assets/ui")
SS = 384        # icons are painted at 3× and downscaled to 128


def res(path):
    return "res://" + os.path.relpath(path, ROOT).replace(os.sep, "/")


def save(img, path, **kw):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not path.endswith(".webp"):
        kw["optimize"] = True
    img.save(path, **kw)
    return path


def main():
    manifest = {}
    for name, paint in sorted(ICONS.items()):
        c = Canvas(SS)
        paint(c)
        p = save(finish_icon(c.image(), 128), os.path.join(OUT, "icons", f"{name}.png"))
        manifest[f"ui.icon.{name}"] = {"file": res(p), "size": [128, 128]}
    folder = {"ui.panel": "panels", "ui.panel.dark": "panels", "ui.tooltip": "panels", "ui.slot": "indicators",
              "ui.bar.frame": "indicators", "ui.bar.fill": "indicators"}
    for key, (img, margins) in kit.build().items():
        sub = folder.get(key, "buttons")
        p = save(img, os.path.join(OUT, sub, key[3:].replace(".", "_") + ".png"))
        manifest[key] = {"file": res(p), "size": list(img.size), "slice": margins}
    for key, text in (("ui.title", "Долгая зима"), ("ui.title.ro", "Iarna lungă")):
        img = title.make(text)
        # lossy WebP with alpha: the wide soft glow makes a PNG of the logo ten times larger
        p = save(img, os.path.join(OUT, "panels", key[3:].replace(".", "_") + ".webp"), quality=92, method=6)
        manifest[key] = {"file": res(p), "size": list(img.size)}
    bg = menubg.make()
    p = save(bg, os.path.join(OUT, "panels", "menu_bg.jpg"), quality=86, progressive=True)
    manifest["ui.menu.bg"] = {"file": res(p), "size": list(bg.size)}
    os.makedirs(os.path.join(ROOT, "assets/manifest"), exist_ok=True)
    with open(os.path.join(ROOT, "assets/manifest/ui.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    total = sum(os.path.getsize(os.path.join(dp, n)) for dp, _, ns in os.walk(OUT) for n in ns if not n.endswith(".import"))
    print(f"{len(manifest)} keys, {total / 1024:.0f} KB in {os.path.relpath(OUT)}")


if __name__ == "__main__":
    main()
