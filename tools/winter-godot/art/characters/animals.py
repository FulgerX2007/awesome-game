"""Animals of Долгая зима on one four-legged skeleton: wolf, bear, deer, rabbit.

Local frame as for people (x right, y up, z forward, the feet planted on y = 0). A body is a capsule from the
chest to the hips with a lighter belly and a darker back; legs are two segments with paws; neck, head, snout,
ears, tail on top. Gaits move the legs with phase offsets; the body height follows the planted paws, so the bob
comes for free.
"""
import math

import numpy as np

from rig import Figure, keys, rot, norm, v3
from humans import DIRS, _place

TAU = 2 * math.pi

KINDS = {
    "wolf": dict(L=27, rc=14.5, rh=12.5, up=17, lo=17, lr=4.8, paw=4.6, w=7.5, head=11.5, snout=13, sr=6.2,
                 neck=(14, 15), col="wolf", belly="#dfe1e8", back="#5f5a5c", leg="#7a8194", eye="wolf_eye",
                 nose="#2a2630", ears="pointed", tail="bushy", tail_col="#7d8496", jaw=True),
    "bear": dict(L=32, rc=26, rh=24.5, up=24, lo=21, lr=10.5, paw=9.5, w=12.5, head=18.5, snout=14, sr=9,
                 neck=(14, 24), col="#7d5a42", belly="#9a7658", back="#6a4a36", leg="#57402f", eye="#1a1416",
                 nose="#1a1416", ears="round", tail="stub", tail_col="#7d5a42", jaw=True, hump=True,
                 muzzle="#b08d68"),
    "deer": dict(L=29, rc=16, rh=15.5, up=28, lo=28, lr=4.4, paw=3.6, w=7, head=9.5, snout=13, sr=5.5,
                 neck=(40, 20), col="deer", belly="deer_light", back="#7a5438", leg="#7d5a40", eye="#1a1416",
                 nose="#2a2224", ears="leaf", tail="flag", tail_col="#f4efe6", antlers=True),
    "rabbit": dict(L=3.5, rc=8.5, rh=11, up=5.5, lo=5.5, lr=2.6, paw=2.8, w=4.5, head=8.2, snout=3, sr=4.6,
                   neck=(6, 8), col="rabbit", belly="#ffffff", back="#d9dde6", leg="#e6e9f0", eye="#2a2230",
                   nose="#e9a0a6", ears="long", tail="puff", tail_col="#ffffff"),
}

LEGS = [("LF", -1, 1), ("RF", 1, 1), ("LH", -1, -1), ("RH", 1, -1)]

POSE0 = dict(legs=None, pitch=0.0, stretch=0.0, headp=0.0, heady=0.0, jaw=0.0, tail=0.0, lift=0.0,
             shift=(0, 0, 0), root=None, ground=False, breathe=0.0, eyes="open")


def build(kind, pose, direction):
    K = KINDS[kind]
    P = dict(POSE0)
    P.update(pose)
    f = Figure()
    L = K["L"] * (1 + P["stretch"])
    sp = v3(0, math.sin(P["pitch"]), math.cos(P["pitch"]))
    chest0, hip0 = sp * L, -sp * L
    legs = P["legs"] or {k: (0.0, 0.0) for k, _, _ in LEGS}
    pts = {}
    for name, s, fr in LEGS:
        a, b = legs[name]
        base = (chest0 if fr > 0 else hip0) + v3(s * K["w"], -0.35 * (K["rc"] if fr > 0 else K["rh"]), 0)
        if fr > 0:
            d1 = v3(0, -math.cos(a - 0.05), math.sin(a - 0.05))
            d2 = v3(0, -math.cos(a + 0.05 - b), math.sin(a + 0.05 - b))
        else:
            d1 = v3(0, -math.cos(a + 0.4), math.sin(a + 0.4))
            d2 = v3(0, -math.cos(a - 0.35 - b * 0.6), math.sin(a - 0.35 - b * 0.6))
        knee = base + d1 * K["up"]
        foot = knee + d2 * K["lo"]
        pts[name] = (base, knee, foot)
    hgt = K["paw"] - min(p[2][1] for p in pts.values()) + P["lift"]
    off = v3(0, hgt, 0)
    chest, hip = chest0 + off, hip0 + off
    col, belly, back, leg = K["col"], K["belly"], K["back"], K["leg"]
    # far legs first is handled by the z-buffer; legs a little darker than the body
    for name, s, fr in LEGS:
        base, knee, foot = (q + off for q in pts[name])
        r = K["lr"]
        f.cap(base + v3(0, 3, 0), knee, r * 1.45, col, r1=r)
        f.cap(knee, foot, r, leg, r1=r * 0.85)
        f.ball(foot + v3(0, 0, r * 0.3), K["paw"], leg)
    # body, belly, back
    f.cap(hip, chest, K["rh"], col, r1=K["rc"] * (1 + 0.02 * P["breathe"]))
    f.cap(hip - v3(0, K["rh"] * 0.5, -K["rh"] * 0.1), chest - v3(0, K["rc"] * 0.5, 0), K["rh"] * 0.58, belly,
          r1=K["rc"] * 0.6, rim=0.5)
    f.cap(hip + v3(0, K["rh"] * 0.46, 0), chest + v3(0, K["rc"] * 0.42, -K["rc"] * 0.2), K["rh"] * 0.62, back,
          r1=K["rc"] * 0.62, rim=0.5)
    if K.get("hump"):
        f.ball(chest + v3(0, K["rc"] * 0.45, -K["rc"] * 0.2), K["rc"] * 0.72, back, bias=-1)
    if kind == "wolf":
        f.ball(chest + v3(0, -1, K["rc"] * 0.45), K["rc"] * 0.82, "#c3c8d4", rim=0.4)     # the pale ruff
        f.ball(chest + v3(0, K["rc"] * 0.35, K["rc"] * 0.3), K["rc"] * 0.75, "#7f8698", rim=0.4)
    # neck and head
    nh, nf = K["neck"]
    hp = P["headp"]
    hd = v3(0, math.cos(hp) * nh - math.sin(hp) * nf, math.sin(hp) * nh + math.cos(hp) * nf)
    head = chest + v3(0, K["rc"] * 0.25 + P["heady"], K["rc"] * 0.15) + hd
    f.cap(chest + v3(0, K["rc"] * 0.2, 0), head, K["rc"] * 0.62, col, r1=K["head"] * 0.85)
    fwd = norm(v3(0, -math.sin(hp + 0.25), math.cos(hp + 0.25)))
    up = norm(np.cross(fwd, v3(1, 0, 0)))
    right = v3(1, 0, 0)
    R = K["head"]
    f.ball(head, R, col)
    if kind == "wolf":
        for s in (-1, 1):
            f.ball(head - fwd * R * 0.2 - up * R * 0.25 + right * s * R * 0.62, R * 0.55, "#c3c8d4", rim=0.4)
    tip = head + fwd * (R * 0.6 + K["snout"]) - up * R * 0.15
    jaw = P["jaw"]
    f.cap(head + fwd * R * 0.4, tip, K["sr"], K.get("muzzle", belly if kind in ("wolf", "deer") else col), r1=K["sr"] * 0.62)
    if K.get("jaw"):
        jd = norm(fwd * math.cos(jaw) - up * math.sin(jaw))
        f.cap(head + fwd * R * 0.35 - up * R * 0.35, head + fwd * R * 0.35 - up * R * 0.35 + jd * K["snout"] * 0.95,
              K["sr"] * 0.62, belly, r1=K["sr"] * 0.4)
        if jaw > 0.1:
            f.ball(head + fwd * (R * 0.5 + K["snout"] * 0.5) - up * R * 0.3, K["sr"] * 0.45, "#7a2a34", bias=-1)
    f.ball(tip + fwd * K["sr"] * 0.45, K["sr"] * 0.42, K["nose"])
    if P["eyes"] == "open":
        for s in (-1, 1):
            f.ball(head + fwd * R * 0.5 + right * (s * R * 0.62) + up * R * 0.3, max(1.4, R * 0.16), K["eye"], flat=True)
    else:
        for s in (-1, 1):
            c = head + fwd * R * 0.5 + right * (s * R * 0.62) + up * R * 0.3
            f.cap(c - fwd * 1.5, c + fwd * 1.5, 0.8, "#3a3036", flat=True)
    _ears(f, K, head, up, fwd, right, R)
    if K.get("antlers"):
        for s in (-1, 1):
            b0 = head + up * R * 0.8 + right * s * R * 0.4
            b1 = b0 + up * 14 + right * s * 6 - fwd * 4
            b2 = b1 + up * 12 + right * s * 4 - fwd * 6
            f.cap(b0, b1, 2.2, "#e6d6b8", r1=1.8)
            f.cap(b1, b2, 1.8, "#e6d6b8", r1=1.2)
            f.cap(b1, b1 + up * 7 + fwd * 6, 1.6, "#e6d6b8", r1=1.0)
            f.cap(b0 + up * 6 + right * s * 3, b0 + up * 10 + fwd * 7 + right * s * 3, 1.6, "#e6d6b8", r1=1.0)
    _tail(f, K, hip, P["tail"])
    return _place(f, P, direction, 1.0)


def _ears(f, K, head, up, fwd, right, R):
    e = K["ears"]
    for s in (-1, 1):
        b = head + up * R * 0.7 + right * s * R * 0.5 - fwd * R * 0.15
        if e == "pointed":
            f.cap(b, b + up * 9 + right * s * 2 - fwd * 1, 4.2, K["col"], r1=1.2)
            f.ball(b + up * 3 + fwd * 1.5, 2.0, "#3e3640", bias=0.2)
        elif e == "round":
            f.ball(b + up * 2, 5.5, K["col"])
            f.ball(b + up * 2 + fwd * 2.5, 3.0, "#3a2a22", bias=0.3)
        elif e == "leaf":
            f.cap(b, b + right * s * 9 + up * 3 - fwd * 2, 3.4, K["col"], r1=1.8)
        elif e == "long":
            f.cap(b, b + up * 11 - fwd * 5 + right * s * 2, 2.9, K["col"], r1=2.0)
            f.cap(b + up * 2 + fwd * 0.8, b + up * 9 - fwd * 4, 1.5, "#f2c8cc", flat=False, bias=0.4)


def _tail(f, K, hip, sway):
    t = K["tail"]
    back = v3(0, 0, -1)
    if t == "bushy":
        p0 = hip + v3(0, K["rh"] * 0.4, -K["rh"] * 0.6)
        p1 = p0 + v3(sway * 4, -8, -12)
        p2 = p1 + v3(sway * 7, -10, -6)
        f.cap(p0, p1, 5.0, K["tail_col"], r1=7.0)
        f.cap(p1, p2, 7.0, K["tail_col"], r1=3.6)
        f.ball(p2 + v3(0, -1, 0), 3.2, "#3e4250")
    elif t == "stub":
        f.ball(hip + v3(0, K["rh"] * 0.3, -K["rh"] * 0.95), 6, K["tail_col"])
    elif t == "flag":
        p0 = hip + v3(0, K["rh"] * 0.5, -K["rh"] * 0.85)
        f.cap(p0, p0 + v3(sway * 2, 2 + 3 * sway, -6), 3.8, K["tail_col"], r1=3.0)
        f.ball(hip + v3(0, 0, -K["rh"] * 0.75), K["rh"] * 0.55, "#efe6d6", bias=-1)
    elif t == "puff":
        f.ball(hip + v3(0, K["rh"] * 0.3, -K["rh"] * 0.95), 4.5, K["tail_col"])
    del back


# ── gaits ──
def walk_legs(p, A, B, offs=(("LH", 0.0), ("LF", 0.25), ("RH", 0.5), ("RF", 0.75))):
    out = {}
    for name, o in offs:
        w = TAU * (p + o)
        out[name] = (A * math.sin(w), B * max(0.0, math.cos(w)) ** 1.2)
    return out


def idle(p, d):
    s = math.sin(TAU * p)
    return dict(breathe=s, tail=0.4 * math.sin(TAU * p), headp=0.04 * s, legs=walk_legs(0, 0.0, 0.0))


def walk(p, d):
    return dict(legs=walk_legs(p, 0.42, 0.9), tail=0.6 * math.sin(TAU * p), headp=0.05 * math.sin(2 * TAU * p))


def walk_deer(p, d):
    return dict(legs=walk_legs(p, 0.26, 0.75), tail=0.6 * math.sin(TAU * p), headp=0.04 * math.sin(2 * TAU * p))


def run(p, d):
    offs = (("LF", 0.0), ("RF", 0.1), ("LH", 0.5), ("RH", 0.6))
    s = math.sin(TAU * p)
    return dict(legs=walk_legs(p, 0.75, 1.3, offs), pitch=0.1 * s, stretch=0.1 * s, headp=-0.12 - 0.06 * s,
                tail=0.3 * s, lift=3 * max(0, math.sin(TAU * (p + 0.25))))


def bite(p, d):
    k = keys(p, [(0, 0.0), (0.35, -0.4), (0.55, 1.0), (0.8, 0.6)], loop=True)
    return dict(shift_z=10 * k, headp=-0.2 - 0.25 * max(k, 0), jaw=0.55 * max(0.0, 1 - abs(k - 0.4) * 2.2),
                pitch=-0.06 * k, legs={"LF": (0.3 * k, 0.1), "RF": (0.35 * k, 0.1), "LH": (-0.2 * k, 0.2),
                                       "RH": (-0.25 * k, 0.2)}, tail=0.5 * k)


def hurt(p, d):
    k = keys(p, [(0, 1.0), (0.5, 0.7), (1.0, 0.2)], loop=False)
    return dict(shift_z=-8 * k, pitch=0.18 * k, headp=0.35 * k, jaw=0.3 * k, legs=walk_legs(0.1, 0.2 * k, 0.4 * k),
                tail=-0.6 * k)


def death(p, d):
    k = keys(p, [(0, 0.0), (0.25, 0.1), (1.0, 1.0)], loop=False)
    F = DIRS[d][2]
    root = rot(F, -k * math.pi / 2 * 0.92)
    return dict(root=root, ground=True, headp=0.3 * k, legs=walk_legs(0.2, 0.25 * k, 0.6 * k), eyes="closed" if k > 0.7 else "open",
                tail=0.0)


def swipe(p, d):
    k = keys(p, [(0, 0.0), (0.35, 1.0), (0.55, 1.0), (0.8, 0.3)], loop=True)
    paw = keys(p, [(0, 0.0), (0.35, 1.6), (0.55, -0.2), (0.8, 0.2)], loop=True)
    return dict(pitch=0.55 * k, headp=-0.35 * k, jaw=0.5 * k,
                legs={"LF": (0.5 * k, 0.6 * k), "RF": (paw, 0.9 * k), "LH": (-0.5 * k, 0.3), "RH": (-0.45 * k, 0.3)})


def hop(p, d):
    u = math.sin(math.pi * p)
    push = keys(p, [(0, 0.0), (0.2, -0.9), (0.5, -0.3), (0.8, 0.5)], loop=True)
    return dict(lift=9 * u, pitch=0.25 * math.cos(math.pi * p) * u,
                legs={"LF": (0.7 * u, 0.2), "RF": (0.75 * u, 0.2), "LH": (push, 0.9 * (1 - u)), "RH": (push - 0.05, 0.9 * (1 - u))},
                headp=-0.1 * u)


def _wrap(fn, kind):
    def pose(p, d):
        P = fn(p, d)
        z = P.pop("shift_z", 0.0)
        if z:
            F = DIRS[d][2]
            P["shift"] = tuple(F * z)
        return P
    return pose


def spec(key, kind, rows, file):
    return dict(key=key, kind="animal", animal=kind, file=file,
                rows=[(a, d, n, fps, loop, _wrap(fn, kind)) for (a, d, n, fps, loop, fn) in rows])


SPECS = {
    "rabbit": spec("animal.rabbit", "rabbit", [("idle", "side", 4, 4, True, idle), ("hop", "side", 6, 12, True, hop),
                                               ("hop", "down", 6, 12, True, hop), ("hop", "up", 6, 12, True, hop)],
                   "characters/animals/rabbit"),
    "deer": spec("animal.deer", "deer", [("idle", "side", 4, 3, True, idle), ("walk", "side", 8, 9, True, walk_deer),
                                         ("walk", "down", 8, 9, True, walk_deer), ("walk", "up", 8, 9, True, walk_deer)],
                 "characters/animals/deer"),
    "wolf": spec("animal.wolf", "wolf", [("idle", "side", 4, 4, True, idle), ("run", "side", 6, 12, True, run),
                                         ("run", "down", 6, 12, True, run), ("run", "up", 6, 12, True, run),
                                         ("bite", "side", 5, 12, True, bite), ("hurt", "side", 3, 12, False, hurt),
                                         ("death", "side", 5, 9, False, death)],
                 "characters/animals/wolf"),
    "bear": spec("animal.bear", "bear", [("idle", "side", 4, 3, True, idle), ("walk", "side", 8, 8, True, walk),
                                         ("walk", "down", 8, 8, True, walk), ("walk", "up", 8, 8, True, walk),
                                         ("swipe", "side", 6, 10, True, swipe), ("hurt", "side", 3, 12, False, hurt),
                                         ("death", "side", 6, 8, False, death)],
                 "characters/animals/bear"),
}
