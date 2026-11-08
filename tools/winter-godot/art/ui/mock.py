"""A mock HUD built from the kit, for judging it by eye (not shipped):
    python3 tools/winter-godot/art/ui/mock.py out.png [backdrop.png]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

import kit  # noqa: E402
from preview import render  # noqa: E402

FONT = os.path.join(os.path.dirname(__file__), "../../../../godot/winter/assets/fonts/GolosText.ttf")


def nine(img, m, w, h):
    l, t, r, b = m
    W, H = img.size
    out = Image.new("RGBA", (w, h))
    xs = [(0, l, 0, l), (l, W - r, l, w - r), (W - r, W, w - r, w)]
    ys = [(0, t, 0, t), (t, H - b, t, h - b), (H - b, H, h - b, h)]
    for sx0, sx1, dx0, dx1 in xs:
        for sy0, sy1, dy0, dy1 in ys:
            if dx1 > dx0 and dy1 > dy0:
                out.alpha_composite(img.crop((sx0, sy0, sx1, sy1)).resize((dx1 - dx0, dy1 - dy0), Image.LANCZOS), (dx0, dy0))
    return out


def main(path, bg=None):
    K = kit.build()
    W, H = 1280, 720
    base = Image.open(bg).convert("RGBA").resize((W, H)) if bg else Image.new("RGBA", (W, H), (120, 140, 170, 255))
    f = ImageFont.truetype(FONT, 18)
    fb = ImageFont.truetype(FONT, 22)
    icons = {n: render(n) for n in ["health", "warmth", "food", "stamina", "day", "wood", "stone", "metal", "hide", "meat",
                                    "fire", "eat", "build", "bench", "pause", "star", "warning"]}
    ic = lambda n, s: icons[n].resize((s, s), Image.LANCZOS)  # noqa: E731
    # top bar
    p, m = K["ui.panel"]
    base.alpha_composite(nine(p, m, W - 24, 92), (12, 8))
    d = ImageDraw.Draw(base)
    stats = [("health", 0.82, "#ff5f6d"), ("warmth", 0.21, "#ff9a3c"), ("food", 0.56, "#f0c24a"), ("stamina", 0.7, "#6fd0ff")]
    for i, (n, v, colr) in enumerate(stats):
        x = 34 + i * 190
        base.alpha_composite(ic(n, 40), (x, 34))
        fr, fm = K["ui.bar.frame"]
        base.alpha_composite(nine(fr, fm, 130, 26), (x + 44, 42))
        fl, flm = K["ui.bar.fill"]
        fw = max(20, int(122 * v))
        fill = nine(fl, flm, fw, 18)
        tint = Image.new("RGBA", fill.size, colr)
        fill = Image.composite(Image.blend(fill, tint, 0.0), fill, fill)
        r, g, b = Image.new("RGB", (1, 1), colr).getpixel((0, 0))
        px = fill.load()
        for yy in range(fill.size[1]):
            for xx in range(fill.size[0]):
                q = px[xx, yy]
                px[xx, yy] = (q[0] * r // 255, q[1] * g // 255, q[2] * b // 255, q[3])
        base.alpha_composite(fill, (x + 48, 46))
        if v < 0.25:
            base.alpha_composite(ic("warning", 26), (x + 150, 22))
    base.alpha_composite(ic("day", 40), (800, 34))
    d.text((846, 34), "День 7", font=fb, fill="#eaf2ff")
    d.text((846, 60), "14:20 · −18 °C", font=f, fill="#9fb0cc")
    for i, (n, v) in enumerate([("wood", 34), ("stone", 12), ("metal", 4), ("meat", 9)]):
        x = 1010 + i * 64
        base.alpha_composite(ic(n, 30), (x, 30))
        d.text((x + 6, 62), str(v), font=f, fill="#eaf2ff")
    # bottom bar of buttons
    pd, pm = K["ui.panel.dark"]
    base.alpha_composite(nine(pd, pm, 600, 112), ((W - 600) // 2, H - 124))
    states = ["ui.button", "ui.button.hover", "ui.button.pressed", "ui.button", "ui.button.disabled"]
    names = [("fire", "К костру"), ("eat", "Поесть"), ("build", "Постройки"), ("bench", "Верстак"), ("pause", "Пауза")]
    for i, ((n, label), st) in enumerate(zip(names, states)):
        b, bm = K[st]
        x = (W - 600) // 2 + 18 + i * 114
        base.alpha_composite(nine(b, bm, 106, 86), (x, H - 112))
        im = ic(n, 44)
        if st == "ui.button.disabled":
            im = Image.blend(Image.new("RGBA", im.size, (0, 0, 0, 0)), im.convert("LA").convert("RGBA"), 0.5)
        base.alpha_composite(im, (x + 31, H - 106 + (2 if st.endswith("pressed") else 0)))
        tw = d.textlength(label, font=f)
        d.text((x + 53 - tw / 2, H - 58), label, font=f, fill="#eaf2ff" if st != "ui.button.disabled" else "#6a7488")
    # a slot grid and a tooltip
    s, sm = K["ui.slot"]
    for i, n in enumerate(["wood", "stone", "metal", "hide"]):
        base.alpha_composite(nine(s, sm, 72, 72), (40 + i * 80, 300))
        base.alpha_composite(ic(n, 48), (52 + i * 80, 312))
    t, tm = K["ui.tooltip"]
    base.alpha_composite(nine(t, tm, 300, 70), (40, 390))
    d.text((60, 404), "Кирка: 12 дерева", font=fb, fill="#ffb35a")
    d.text((60, 432), "Добывать камень", font=f, fill="#9fb0cc")
    base.convert("RGB").save(path)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
