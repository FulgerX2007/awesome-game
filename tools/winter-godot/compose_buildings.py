"""Долгая зима on Godot: the camp's buildings in the painted style, put together from the owner's painted pieces.

There is no painted sheet of buildings yet, so they are composed from what there is: the log cabin and the props of
the environment sheet (fence posts, the signpost's planks, the stone ring of the frozen pond, the lantern post, logs,
stones, drifts). import_art.py calls build(manifest) after it has cut the sheet; the keys written here replace the
generated buildings (trader.sled and the snare stay generated).
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TILE = 96
CABIN_DOOR = (100, 205, 154, 292)       # the door in the cabin picture (x0, y0, x1, y1)
SNOW = (236, 241, 249)


def rng(k):
    return np.random.default_rng(20261108 + k)


def scaled(img, k):
    return img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)


def solid_box(img, thr=40):
    return img.getchannel("A").point(lambda v: 255 if v > thr else 0).getbbox()


def canvas(w, h):
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def put(dst, src, foot_xy, src_foot):
    """Pastes src so that its point src_foot lands on foot_xy of dst."""
    dst.alpha_composite(src, (round(foot_xy[0] - src_foot[0]), round(foot_xy[1] - src_foot[1])))


def dim(img, k=0.62, desat=0.45):
    a = np.asarray(img).astype(np.float32)
    g = a[..., :3].mean(axis=2, keepdims=True)
    a[..., :3] = (a[..., :3] * (1 - desat) + g * desat) * k
    return Image.fromarray(a.clip(0, 255).astype(np.uint8), "RGBA")


def fade(img, k):
    a = np.array(img)
    a[..., 3] = (a[..., 3] * k).astype(np.uint8)
    return Image.fromarray(a, "RGBA")


def cut_below(img, y):
    """Keeps the part of the picture below row y, its top edge feathered over a few pixels."""
    a = np.array(img)
    a[:max(0, y), :, 3] = 0
    for d in range(6):
        if 0 <= y + d < a.shape[0]:
            a[y + d, :, 3] = (a[y + d, :, 3] * (d + 1) / 7).astype(np.uint8)
    return Image.fromarray(a, "RGBA")


class Parts:
    """The painted pieces, each with its own ground point."""

    def __init__(self, env_dir, cabin_path):
        self.env = lambda k: Image.open(env_dir / (k.replace(".", "_") + ".png")).convert("RGBA")
        fence = self.env("decor.fence")
        # the fence's left post, with its snow cap and its foot in the snow
        bb = solid_box(fence.crop((0, 0, fence.width // 4, fence.height)), 120)
        x0, x1 = max(0, bb[0] - 3), bb[2] + 3
        self.post = fence.crop((x0, 0, x1, fence.height))
        self.post = self.post.crop(solid_box(self.post, 8))
        self.fence = fence
        sign = self.env("decor.signpost")
        # the signpost's upper board: a plank
        sb = solid_box(sign, 120)
        self.plank = sign.crop((sb[0], sb[1] + int((sb[3] - sb[1]) * 0.18), sb[2], sb[1] + int((sb[3] - sb[1]) * 0.42)))
        self.lantern = self.env("decor.lantern")
        self.logs = self.env("log.0")
        self.stones = self.env("rock.rubble.1")
        self.drift = self.env("snow.drift.1")
        pond = np.array(self.env("decor.pond"))
        r, g, b, al = [pond[..., i].astype(int) for i in range(4)]
        # the ice inside the ring goes; the stones and their snow stay
        ice = (b > r + 25) & (b > 120) & (g > r) & ~((r > 200) & (g > 205) & (b > 215))
        h, w = ice.shape
        yy, xx = np.mgrid[0:h, 0:w]
        inner = ((xx - w / 2) / (w * 0.36)) ** 2 + ((yy - h * 0.5) / (h * 0.3)) ** 2 < 1.0
        pond[ice & inner, 3] = 0
        self.ring = Image.fromarray(pond, "RGBA")
        self.cabin = Image.open(cabin_path).convert("RGBA")


def post_foot(post):
    return (post.width / 2, post.height - 6)


def palisade_pieces(P: Parts, out, res, manifest):
    """One tile of the north/south wall (three posts side by side) and of the east/west wall (two posts one
    behind the other), whole, damaged (leaning, one short) and broken (stumps)."""
    post = scaled(P.post, 1.18)
    pf = post_foot(post)

    def stump(p, k):
        h = round(p.height * k)
        st = np.array(p.crop((0, p.height - h, p.width, p.height)))
        # a broken top: a jagged, feathered edge rather than a straight cut
        R = rng(h)
        for x in range(st.shape[1]):
            cut = int(R.integers(0, 9))
            st[:cut, x, 3] = 0
            for d in range(4):
                if cut + d < st.shape[0]:
                    st[cut + d, x, 3] = (st[cut + d, x, 3] * (d + 1) / 5).astype(np.uint8)
        return Image.fromarray(st, "RGBA")

    def wall(kind, state, seed):
        R = rng(seed)
        W, H = (TILE + 40, post.height + 30) if kind == "h" else (post.width + 30, post.height + TILE // 2 + 30)
        c = canvas(W, H)
        foot = (W / 2, H - 8)
        spots = [(-30, 0), (0, 0), (30, 0)] if kind == "h" else [(0, -TILE / 2), (0, 0)]
        for i, (dx, dy) in enumerate(spots):
            p = post
            tilt = R.uniform(-0.03, 0.03)
            if state == "damaged":
                tilt = R.uniform(-0.2, 0.2)
                if i == 1:
                    p = stump(post, 0.62)
            elif state == "broken":
                p = stump(post, R.uniform(0.28, 0.42))
            p = p.rotate(np.degrees(tilt), resample=Image.BICUBIC, expand=True, center=(p.width / 2, p.height))
            put(c, p, (foot[0] + dx + R.uniform(-2, 2), foot[1] + dy), (p.width / 2, p.height - 6))
        c = c.crop(solid_box(c, 4))
        return c

    for kind in ("h", "v"):
        for state in ("", "damaged", "broken"):
            img = wall(kind, state, hash((kind, state)) % 1000)
            key = f"palisade.{kind}" + (f".{state}" if state else "")
            name = f"palisade_{kind}{'_' + state if state else ''}.png"
            img.save(out / name, optimize=True)
            manifest[key] = {"file": res + name, "size": [img.width, img.height],
                             "foot": [img.width // 2, img.height - 8], "block": 1, "painted": True}
    corner = scaled(P.post, 1.36)
    corner.save(out / "palisade_post.png", optimize=True)
    manifest["palisade.post"] = {"file": res + "palisade_post.png", "size": [corner.width, corner.height],
                                 "foot": [corner.width // 2, corner.height - 7], "block": 1, "painted": True}
    stake = scaled(P.post, 1.18)
    stake.save(out / "palisade_stake.png", optimize=True)
    manifest["palisade.stake"] = {"file": res + "palisade_stake.png", "size": [stake.width, stake.height],
                                  "foot": [stake.width // 2, stake.height - 6], "block": 1, "painted": True}
    # the south gate: the rope fence, two tiles wide
    gate = scaled(P.fence, (2 * TILE + 10) / P.fence.width)
    gate.save(out / "palisade_gate.png", optimize=True)
    manifest["palisade.gate"] = {"file": res + "palisade_gate.png", "size": [gate.width, gate.height],
                                 "foot": [gate.width // 2, gate.height - 12], "block": 1, "painted": True}


def camp_pieces(P: Parts, out, res, manifest):
    # the torch: the lantern post (it glows with its own lantern, no flame on top)
    lan = scaled(P.lantern, 0.82)
    lan.save(out / "torch.png", optimize=True)
    a = np.asarray(lan).astype(int)
    glow = (a[..., 3] > 200) & (a[..., 0] > 220) & (a[..., 1] > 170) & (a[..., 2] < 150)
    gy, gx = np.nonzero(glow)
    anchor = [int(gx.mean()), int(gy.mean())] if len(gx) else [lan.width * 3 // 4, lan.height // 2]
    manifest["torch"] = {"file": res + "torch.png", "size": [lan.width, lan.height], "foot": [lan.width // 3, lan.height - 10],
                         "anchor": anchor, "lantern": True, "block": 0, "painted": True}
    # the fire pit: the stone ring; burnt out, a bed of ash inside
    ring = scaled(P.ring, 0.62)
    ring.save(out / "firepit.png", optimize=True)
    foot = [ring.width // 2, int(ring.height * 0.62)]
    manifest["firepit"] = {"file": res + "firepit.png", "size": [ring.width, ring.height], "foot": foot,
                           "anchor": [ring.width // 2, int(ring.height * 0.5)], "painted": True}
    ash = canvas(ring.width, ring.height)
    d = ImageDraw.Draw(ash)
    cx, cy = ring.width / 2, ring.height * 0.5
    d.ellipse((cx - ring.width * 0.27, cy - ring.height * 0.2, cx + ring.width * 0.27, cy + ring.height * 0.2), fill=(52, 46, 46, 235))
    d.ellipse((cx - ring.width * 0.14, cy - ring.height * 0.1, cx + ring.width * 0.1, cy + ring.height * 0.08), fill=(88, 80, 78, 220))
    ash = ash.filter(ImageFilter.GaussianBlur(3))
    ash.alpha_composite(ring)
    ash.save(out / "firepit_ash.png", optimize=True)
    manifest["firepit.ash"] = {"file": res + "firepit_ash.png", "size": [ash.width, ash.height], "foot": foot,
                               "anchor": manifest["firepit"]["anchor"], "painted": True}
    # the workbench: a plank on two short posts, a log at its side
    leg = P.post.crop((0, P.post.height - round(P.post.height * 0.52), P.post.width, P.post.height))
    leg = scaled(leg, 0.9)
    top = P.plank.resize((104, max(10, round(P.plank.height * 104 / P.plank.width * 0.45))), Image.LANCZOS)
    W, H = 130, leg.height + top.height + 10
    c = canvas(W, H)
    foot = (W / 2, H - 6)
    for dx in (-36, 36):
        put(c, leg, (foot[0] + dx, foot[1]), (leg.width / 2, leg.height - 5))
    put(c, top, (foot[0], foot[1] - leg.height + 14), (top.width / 2, top.height * 0.6))
    c = c.crop(solid_box(c, 4))
    c.save(out / "bench.png", optimize=True)
    manifest["bench"] = {"file": res + "bench.png", "size": [c.width, c.height], "foot": [c.width // 2, c.height - 6],
                         "block": 1, "painted": True}
    # the camp's woodpile and stone heap
    for key, img in (("stock.wood", P.logs), ("stock.stone", P.stones)):
        name = key.replace(".", "_") + ".png"
        img.save(out / name, optimize=True)
        manifest[key] = {"file": res + name, "size": [img.width, img.height], "foot": [img.width // 2, img.height - 10],
                         "block": 0, "painted": True}
    # bunks: a log bed with a fur on it; paid in part, the logs only
    bed = scaled(P.logs, 0.78)
    fur = canvas(bed.width, bed.height)
    d = ImageDraw.Draw(fur)
    # a shaggy brown fur thrown over the top logs: a soft blob with a darker rim and a light top
    d.ellipse((bed.width * 0.06, bed.height * 0.02, bed.width * 0.94, bed.height * 0.5), fill=(108, 78, 56, 240))
    d.ellipse((bed.width * 0.12, bed.height * 0.04, bed.width * 0.8, bed.height * 0.36), fill=(146, 108, 78, 235))
    d.ellipse((bed.width * 0.22, bed.height * 0.06, bed.width * 0.58, bed.height * 0.2), fill=(178, 142, 108, 220))
    fur = fur.filter(ImageFilter.GaussianBlur(2.6))
    fa = np.array(fur)
    R = rng(7)
    fa[..., 3] = (fa[..., 3] * (0.86 + 0.14 * R.random(fa.shape[:2]))).astype(np.uint8)
    fur = Image.fromarray(fa, "RGBA")
    full = bed.copy()
    full.alpha_composite(fur)
    for key, img in (("bunk", full), ("bunk.frame", fade(bed, 0.75))):
        name = key.replace(".", "_") + ".png"
        img.save(out / name, optimize=True)
        manifest[key] = {"file": res + name, "size": [img.width, img.height], "foot": [img.width // 2, img.height - 8],
                         "block": 1, "painted": True}


def hut_stages(P: Parts, out, res, manifest):
    """The hut from a ruin to the stove: the foundation under snow, the walls, the roof (no door yet, no chimney),
    the door; stage 4 is the cabin itself, written by import_art.py."""
    cab = P.cabin
    # the chimney stays on every stage (the stove is inside); only the lit stove sends smoke out of it
    a = np.array(cab)
    no_chimney = Image.fromarray(a, "RGBA")
    # the door not yet hung: a dark doorway
    b = np.array(no_chimney)
    dx0, dy0, dx1, dy1 = CABIN_DOOR
    door = b[dy0:dy1, dx0:dx1]
    door[..., :3] = (door[..., :3] * 0.18 + np.array([24, 20, 26]) * 0.82).astype(np.uint8)
    doorway = Image.fromarray(b, "RGBA")
    # the unlit windows of the roofed stages
    from import_art import unlit as unlit_fn
    stages = {
        2: unlit_fn(doorway),
        1: cut_below(unlit_fn(doorway), 172),
        0: None,
    }
    ruin = cut_below(dim(unlit_fn(doorway), 0.8, 0.35), 238)
    drift = scaled(P.drift, 1.2)
    ruin_c = ruin.copy()
    rb = solid_box(ruin, 30)
    put(ruin_c, fade(drift, 0.92), ((rb[0] + rb[2]) / 2 + 30, rb[3] + 4), (drift.width / 2, drift.height - 8))
    stages[0] = ruin_c
    from import_art import trim, foot_of
    ref = manifest["hut.4"]
    # every stage stands on the cabin's own ground point (shifted by its own trim), so the hut doesn't jump
    shift = lambda p, ox, oy: [p[0] + (ref["_ox"] - ox), p[1] + (ref["_oy"] - oy)]
    stages[3] = unlit_fn(no_chimney)      # the door hangs, the windows still dark
    for st, img in stages.items():
        t, (ox, oy) = trim(img)
        name = f"cabin_{st}.png"
        t.save(out / name, optimize=True)
        e = {"file": res + name, "size": [t.width, t.height], "foot": shift(ref["foot"], ox, oy), "block": 1, "painted": True}
        if st >= 2:
            e["hole"] = shift(ref["hole"], ox, oy)
        if st == 3:
            e["window"] = shift(ref["window"], ox, oy)
        manifest[f"hut.{st}"] = e
    # the scaffold of a stage paid in part: two posts and a plank across, at the hut's sides
    sc = canvas(360, 230)
    foot = (180, 222)
    post = scaled(P.post, 1.25)
    for dx in (-136, 136):
        put(sc, post, (foot[0] + dx, foot[1]), (post.width / 2, post.height - 6))
    plank = P.plank.resize((292, max(8, round(P.plank.height * 292 / P.plank.width * 0.3))), Image.LANCZOS)
    put(sc, plank, (foot[0], foot[1] - post.height + 30), (plank.width / 2, plank.height / 2))
    sc = sc.crop(solid_box(sc, 4))
    foot = (sc.width / 2, sc.height - 8)
    sc.save(out / "scaffold.png", optimize=True)
    manifest["hut.scaffold"] = {"file": res + "scaffold.png", "size": [sc.width, sc.height], "foot": [round(foot[0]), round(foot[1])],
                                "painted": True}


def upgrades(P: Parts, out, res, manifest):
    """The house upgrades as small buildings of the same logs: the cellar's door in a snow mound, the smokehouse
    (a small hut with its chimney), the annex and the workshop (smaller huts facing the other way). Paid in part:
    the lower half, muted."""
    from import_art import unlit as unlit_fn
    cab = P.cabin
    door = cab.crop(CABIN_DOOR)
    mound = scaled(P.drift, 0.62)
    cellar = canvas(mound.width, mound.height + 20)
    cellar.alpha_composite(mound, (0, 20))
    d2 = scaled(door, 0.62)
    put(cellar, d2, (cellar.width * 0.46, cellar.height - 10), (d2.width / 2, d2.height))
    pieces = {
        "cellar": cellar,
        "smokehouse": scaled(unlit_fn(cab), 0.48),
        "annex": scaled(cab.transpose(Image.FLIP_LEFT_RIGHT), 0.72),
        "workshop": scaled(unlit_fn(cab).transpose(Image.FLIP_LEFT_RIGHT), 0.62),
    }
    from import_art import trim, foot_of
    for uid, img in pieces.items():
        t, _ = trim(img)
        fx, fy = foot_of(t)
        name = f"up_{uid}.png"
        t.save(out / name, optimize=True)
        manifest["up." + uid] = {"file": res + name, "size": [t.width, t.height], "foot": [round(fx), round(fy)],
                                 "block": 1, "painted": True}
        fr = dim(cut_below(t, int(t.height * 0.48)), 0.7, 0.5)
        fr.save(out / f"up_{uid}_frame.png", optimize=True)
        manifest[f"up.{uid}.frame"] = {"file": res + f"up_{uid}_frame.png", "size": [fr.width, fr.height],
                                       "foot": [round(fx), round(fy)], "block": 1, "painted": True}


def _hero_pack(hero_sheet, hero_frame):
    """The bedroll and packs off the hero's back (frame 0 faces right, so they are on the left): the warm
    leather-brown pieces left of his body, grown into one piece."""
    fw, fh = hero_frame
    a = np.array(hero_sheet.crop((0, 0, fw, fh)))
    rgb = a[..., :3].astype(np.float32) / 255.0
    mx, mn = rgb.max(2), rgb.min(2)
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    brown = (a[..., 3] > 120) & (r > g) & (g > b) & (sat > 0.3) & (mx > 0.25) & (mx < 0.9)
    ys, xs = np.nonzero(a[..., 3] > 120)
    left = xs.min()
    mid = left + (xs.max() - left) * 0.36
    yy, xx = np.mgrid[0:fh, 0:fw]
    region = brown & (xx < mid) & (yy < ys.min() + (ys.max() - ys.min()) * 0.72)
    from import_art import components
    comps = sorted(components(region), key=lambda c: -c[0])
    keep = np.zeros_like(region)
    for n, cy, cx in comps[:3]:
        if n > 60:
            keep[cy, cx] = True
    # close small gaps (straps, seams)
    for d in range(1, 3):
        k2 = keep.copy()
        k2[d:, :] |= keep[:-d, :]
        k2[:-d, :] |= keep[d:, :]
        k2[:, d:] |= keep[:, :-d]
        k2[:, :-d] |= keep[:, d:]
        keep = k2 & (a[..., 3] > 60) & (xx < mid + 2)
    a[~keep, 3] = 0
    img = Image.fromarray(a, "RGBA")
    return img.crop(solid_box(img, 20))


def _sack(w, h, base):
    """A soft bundle lit from the upper left: a rounded body, a darker rim below, a light top, a cord across,
    a cap of snow."""
    k = 3
    big = canvas(w * k, h * k)
    d = ImageDraw.Draw(big)
    bc = tuple(int(v) for v in base)
    dark = tuple(int(v * 0.62) for v in base)
    light = tuple(min(255, int(v * 1.22)) for v in base)
    d.ellipse((0, h * k * 0.12, w * k, h * k), fill=dark + (255,))
    d.ellipse((w * k * 0.04, h * k * 0.06, w * k * 0.94, h * k * 0.9), fill=bc + (255,))
    d.ellipse((w * k * 0.14, h * k * 0.1, w * k * 0.62, h * k * 0.44), fill=light + (255,))
    d.line((w * k * 0.5, h * k * 0.05, w * k * 0.56, h * k * 0.96), fill=(82, 58, 40, 255), width=k * 3)
    d.ellipse((w * k * 0.16, 0, w * k * 0.7, h * k * 0.26), fill=(238, 243, 250, 245))
    img = big.filter(ImageFilter.GaussianBlur(k * 1.6)).resize((w, h), Image.LANCZOS)
    a = np.array(img)
    R = rng(w * h)
    a[..., :3] = np.clip(a[..., :3].astype(int) + R.integers(-2, 3, a.shape[:2])[..., None], 0, 255).astype(np.uint8)
    return Image.fromarray(a, "RGBA")


def _rope_loop(w, h):
    """A coil of rope seen from above: a ring with a tan core, a dark underside and a light top, a knot."""
    k = 4
    big = canvas(w * k, h * k)
    d = ImageDraw.Draw(big)
    box = (k * 3, k * 3, w * k - k * 3, h * k - k * 3)
    d.ellipse(box, outline=(92, 66, 42, 255), width=k * 4)
    d.ellipse((box[0] + k, box[1] + k, box[2] - k, box[3] - k), outline=(176, 140, 96, 255), width=k * 2)
    d.arc((box[0] + k, box[1], box[2] - k, box[3] - k * 2), 200, 330, fill=(222, 196, 152, 255), width=k)
    d.ellipse((w * k * 0.12, h * k * 0.42, w * k * 0.12 + k * 7, h * k * 0.42 + k * 6), fill=(120, 88, 58, 255))
    return big.resize((w, h), Image.LANCZOS)


def sled_and_snare(P: Parts, out, res, manifest, hero_sheet, hero_frame):
    """The trader's sled: dark plank runners, a bed of logs, his goods (the hero's bedroll and packs, cut off his
    back), a lamp post at the front. The snare: a short stake and a rope loop lying on the snow."""
    W, H = 300, 200
    c = canvas(W, H)
    foot = (W * 0.45, H - 12)
    plank = P.plank.resize((190, max(8, round(P.plank.height * 190 / P.plank.width * 0.22))), Image.LANCZOS)
    plank = dim(plank, 0.68, 0.2)
    for dx, dy in ((0, 0), (10, -24)):
        r = plank.rotate(4, resample=Image.BICUBIC, expand=True)
        put(c, r, (foot[0] + dx, foot[1] + dy), (r.width / 2, r.height - 4))
    logs = scaled(P.logs, 1.05)
    put(c, logs, (foot[0] - 32, foot[1] - 10), (logs.width / 2, logs.height - 8))
    put(c, logs.transpose(Image.FLIP_LEFT_RIGHT), (foot[0] + 26, foot[1] - 16), (logs.width / 2, logs.height - 8))
    # his goods: two burlap sacks and a rolled fur, tied on the logs
    for (dx, dy, w, h, base) in ((-30, -46, 62, 46, (168, 140, 100)), (14, -50, 54, 42, (150, 122, 86)), (44, -40, 60, 30, (120, 84, 58))):
        put(c, _sack(w, h, base), (foot[0] + dx, foot[1] + dy), (w / 2, h))
    lamp = scaled(P.lantern, 0.42)
    put(c, lamp, (foot[0] + 92, foot[1] - 22), (lamp.width / 3, lamp.height - 8))
    c = c.crop(solid_box(c, 4))
    c.save(out / "trader_sled.png", optimize=True)
    a = np.asarray(c).astype(int)
    glow = (a[..., 3] > 200) & (a[..., 0] > 220) & (a[..., 1] > 170) & (a[..., 2] < 150)
    gy, gx = np.nonzero(glow)
    manifest["trader.sled"] = {"file": res + "trader_sled.png", "size": [c.width, c.height], "foot": [c.width // 2, c.height - 10],
                               "anchor": [int(gx.mean()), int(gy.mean())] if len(gx) else [c.width - 20, 20],
                               "block": 0, "painted": True}
    stake = P.post.crop((0, P.post.height - round(P.post.height * 0.42), P.post.width, P.post.height))
    stake = scaled(stake, 0.55)
    sn = canvas(80, 76)
    loop = _rope_loop(46, 24)
    put(sn, loop, (46, 66), (loop.width / 2, loop.height - 3))
    put(sn, stake, (20, 62), (stake.width / 2, stake.height - 3))
    sn = sn.crop(solid_box(sn, 4))
    sn.save(out / "snare.png", optimize=True)
    manifest["snare"] = {"file": res + "snare.png", "size": [sn.width, sn.height], "foot": [sn.width // 2, sn.height - 6],
                         "painted": True}


def build(manifest, env_dir, cabin_path, out, res):
    out.mkdir(parents=True, exist_ok=True)
    P = Parts(env_dir, cabin_path)
    palisade_pieces(P, out, res, manifest)
    camp_pieces(P, out, res, manifest)
    hut_stages(P, out, res, manifest)
    upgrades(P, out, res, manifest)
    hs = out.parent / "characters/hero.png"
    sled_and_snare(P, out, res, manifest, Image.open(hs).convert("RGBA") if hs.exists() else None,
                   manifest.get("char.hero", {}).get("frame", (133, 159)))
    for k in ("hut.3", "hut.4"):
        manifest[k].pop("_ox", None)
        manifest[k].pop("_oy", None)
