"""People of Долгая зима: one skeleton, outfits, and every animation as poses over a phase 0..1.

Local frame of a figure: x = its right, y = up, z = its forward; the foot point is the origin. A direction maps
that frame into the world (down = facing the viewer, up = the back, side = facing right). Lengths in texture px
(1 tile = 96 px; the hero is about 130 px tall with his hat).
"""
import math

import numpy as np

from rig import Figure, keys, rot, norm, v3

DIRS = {
    "down": (v3(-1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)),
    "up": (v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1)),
    "side": (v3(0, 0, 1), v3(0, 1, 0), v3(1, 0, 0)),
}

OUTFITS = {
    "hero": dict(coat="coat_red", trim="fur", hat="ushanka", hat_col="#6a4a36", scarf="wool", mitt="leather",
                 boots="#6d625c", pants="#4a4252", pack=True, tint=False),
    "villager": dict(coat="#ffffff", trim="fur", hat="knit", hat_col="#d9d2c4", scarf="#7d8fb0", mitt="#5a4636",
                     boots="#5f5650", pants="#4a4652", pack=False, tint=True),
    "trader": dict(coat="#7a4a2e", trim="fur_dark", hat="tall", hat_col="#4a3426", scarf="#e0b84a", mitt="#3e2e28",
                   boots="#3e2e28", pants="#3d3640", pack=False, tint=False, beard=True),
    "wanderer": dict(coat="#5b6b84", trim="#8b8079", hat="none", hat_col="#5a3a2a", scarf="#a88a6a", mitt="#5a4636",
                     boots="#4e4540", pants="#454050", pack=False, tint=False),
}

HIPW, THIGH, SHIN, BOOT = 7.0, 18.5, 18.5, 6.0
SPINE, SHOULDER, UPPER, FORE = 37.0, 13.5, 15.5, 14.5
HEAD = 16.0


def arm_dir(a, r, s):
    """Direction of an arm segment: pitch a forward from hanging down, rolled outward by r (s = +1 right, -1 left)."""
    ca = math.cos(a)
    return v3(s * ca * math.sin(r), -ca * math.cos(r), math.sin(a))


def leg_points(hip, a, b):
    d1 = v3(0, -math.cos(a), math.sin(a))
    knee = hip + THIGH * d1
    d2 = v3(0, -math.cos(a - b), math.sin(a - b))
    return knee, knee + SHIN * d2


POSE0 = dict(lean=0.03, headp=0.0, breathe=0.0, aL=0.0, bL=0.05, aR=0.0, bR=0.05, lift=0.0,
             armL=(0.1, 0.14, 0.25), armR=(0.1, 0.14, 0.25), tool=None, toolb=0.6, eyes="open",
             root=None, shift=(0, 0, 0), ground=False, scarf_sway=0.0, log=False)


def build(out, pose, direction, scale=1.0):
    """The parts of a person in `pose`, seen from `direction`."""
    P = dict(POSE0)
    P.update(pose)
    o = OUTFITS[out] if isinstance(out, str) else out
    f = Figure()
    # legs relative to the pelvis, then the pelvis height that plants the lower foot
    hipL, hipR = v3(-HIPW, 0, 0), v3(HIPW, 0, 0)
    kL, fL = leg_points(hipL, P["aL"], P["bL"])
    kR, fR = leg_points(hipR, P["aR"], P["bR"])
    py = BOOT - min(fL[1], fR[1]) + P["lift"]
    pel = v3(0, py, 0)
    hipL, hipR, kL, fL, kR, fR = (x + pel for x in (hipL, hipR, kL, fL, kR, fR))
    sp = v3(0, math.cos(P["lean"]), math.sin(P["lean"]))
    top = pel + sp * (SPINE + P["breathe"])
    waist = pel + sp * 16
    hem = pel - sp * 13 + v3(0, 0, 1.5)
    neck = top + sp * 4
    hd = norm(sp + v3(0, 0, math.sin(P["headp"])))
    head = neck + hd * 15
    coat, trim = o["coat"], o["trim"]
    T = dict(tint=o["tint"])
    # legs: wool trousers, felt boots to the knee
    for hip, kn, ft in ((hipL, kL, fL), (hipR, kR, fR)):
        f.cap(hip, kn, 7.0, o["pants"], r1=6.6)
        f.cap(kn + (ft - kn) * 0.15, ft, 6.4, o["boots"], r1=6.0)
        fwd = norm(v3(0, 0, 1) + (ft - kn) * 0.02)
        f.cap(ft, ft + fwd * 6.5 + v3(0, -0.8, 0), 6.2, o["boots"], r1=5.4)
    # the padded coat: skirt and chest, a fur hem, a belt
    f.cap(hem, waist, 16.0, coat, r1=13.2, **T)
    f.cap(waist, top - sp * 2, 13.2, coat, r1=14.6, **T)
    f.ring(hem - sp * 1.5, sp, v3(1, 0, 0), 13.6, 4.8, trim, n=26, rim=0.25)
    f.ring(waist, sp, v3(1, 0, 0), 12.4, 2.6, "leather", n=30, bias=0.2, rim=0.2)
    f.ball(waist + v3(0, 0, 13.2), 3.0, "#c9a24a", bias=0.6)          # the buckle
    if o.get("pack"):
        f.cap(top - v3(0, 4, 0) + v3(-11, 0, -12), top - v3(0, 4, 0) + v3(11, 0, -12), 6.4, "#8a6a4a")
        f.ring(top - v3(0, 4, 0) + v3(-6, 0, -12), v3(1, 0, 0), v3(0, 1, 0), 5.0, 2.2, "leather", n=8, bias=0.3)
        f.ring(top - v3(0, 4, 0) + v3(6, 0, -12), v3(1, 0, 0), v3(0, 1, 0), 5.0, 2.2, "leather", n=8, bias=0.3)
    # arms
    hands = {}
    for s, key in ((-1, "armL"), (1, "armR")):
        a, r, e = P[key]
        sh = top - sp * 4 + v3(s * SHOULDER, 0, 0)
        d1 = arm_dir(a, r, s)
        el = sh + UPPER * d1
        d2 = arm_dir(a + e, r * 0.6, s)
        wr = el + FORE * d2
        f.cap(sh, el, 6.6, coat, r1=6.0, **T)
        f.cap(el, wr, 6.0, coat, r1=5.4, **T)
        f.ring(wr - d2 * 1.0, d2, v3(0, 0, 1) if abs(d2[2]) < 0.9 else v3(1, 0, 0), 4.6, 3.2, trim, n=12, rim=0.25)
        hand = wr + d2 * 3.5
        f.ball(hand, 6.0, o["mitt"])
        hands[s] = (hand, a + e, r * 0.6)
    _tool(f, P, hands[1])
    if P["log"]:
        h = hands[1][0]
        f.cap(h + v3(-7, 1, 2), h + v3(7, -1, 2), 4.2, "bark")
        f.ball(h + v3(7.5, -1, 2), 3.6, "wood_cut", bias=0.1)
    # scarf and head
    f.ring(neck - sp * 1, sp, v3(1, 0, 0), 9.0, 6.2, o["scarf"], n=16, rim=0.3)
    sw = P["scarf_sway"]
    f.cap(neck + v3(5, -2, 8), neck + v3(6 + sw * 3, -16, 10 + abs(sw) * 2), 4.2, o["scarf"], r1=3.8)
    f.ball(head, HEAD, "skin")
    fwd = norm(v3(0, 0, 1) * math.cos(P["headp"]) + sp * 0 + v3(0, -math.sin(P["headp"]), 0))
    up = norm(np.cross(fwd, v3(1, 0, 0)))
    right = v3(1, 0, 0)
    if P["eyes"] == "open":
        for s in (-1, 1):
            f.ball(head + fwd * 14.4 + right * (s * 6.2) - up * 1.0, 2.4, "#2a2230", flat=True)
            f.ball(head + fwd * 15.2 + right * (s * 6.2 + 0.7) - up * 0.2, 0.8, "#ffffff", flat=True, bias=0.3)
    else:
        for s in (-1, 1):
            f.cap(head + fwd * 14.6 + right * (s * 6.2 - 2.2) - up * 1.2, head + fwd * 14.6 + right * (s * 6.2 + 2.2) - up * 1.2,
                  0.9, "#4a3438", flat=True)
    for s in (-1, 1):
        f.ball(head + fwd * 13.0 + right * (s * 9.0) - up * 5.5, 3.0, "#e9a49a", flat=True)
    f.ball(head + fwd * 15.7 - up * 3.8, 2.8, "skin_shade")
    if o.get("beard"):
        f.ball(head + fwd * 9 - up * 10, 9.5, "#b9b2a8")
        f.ball(head + fwd * 12 - up * 5 + right * 5, 5, "#c9c2b8")
        f.ball(head + fwd * 12 - up * 5 - right * 5, 5, "#c9c2b8")
    _hat(f, o, head, up, fwd, right)
    return _place(f, P, direction, scale)


def _tool(f, P, hand):
    tool = P["tool"]
    if not tool:
        return
    h, ang, r = hand
    a = ang + P["toolb"]
    d = arm_dir(a, r, 1)
    perp = arm_dir(a + math.pi / 2, r, 1)
    if tool == "axe":
        end = h + d * 27
        f.cap(h - d * 7, end + d * 2, 2.4, "wood")
        f.cap(end + perp * 2.5, end - perp * 4, 3.4, "stone_mid")
        f.cap(end - perp * 3 - d * 1.5, end - perp * 11 - d * 3, 3.6, "stone", r1=5.6)
        f.cap(end - perp * 3 + d * 1.5, end - perp * 11 + d * 4, 3.0, "stone", r1=4.6)
        f.ring(end, d, perp, 2.4, 1.5, "leather", n=8, bias=0.4)
    elif tool == "pick":
        end = h + d * 26
        f.cap(h - d * 6, end, 2.3, "wood")
        f.cap(end, end + perp * 11 - d * 3, 3.0, "iron", r1=1.4)
        f.cap(end, end - perp * 10 - d * 3, 3.0, "iron", r1=1.4)
        f.ball(end, 3.2, "iron_hi")
    elif tool == "hammer":
        end = h + d * 14
        f.cap(h - d * 4, end, 1.9, "wood")
        f.cap(end - perp * 5, end + perp * 5, 4.2, "wood_dark")
    elif tool == "saw":
        f.cap(h + d * 2, h + d * 23, 1.8, "iron_hi", r1=2.8)
        f.cap(h - d * 3, h + d * 2, 2.6, "wood")


def _hat(f, o, head, up, fwd, right):
    kind, col = o["hat"], o["hat_col"]
    if kind == "ushanka":
        f.ball(head + up * 11, 15.6, col)
        f.ring(head + up * 7.5, up, fwd, 15.0, 5.2, "fur", n=24, rim=0.25)
        for s in (-1, 1):
            f.cap(head + right * (s * 14) + up * 3 - fwd * 4, head + right * (s * 14.5) - up * 9 - fwd * 4, 5.6, "fur", r1=4.8, rim=0.5)
    elif kind == "knit":
        f.ball(head + up * 10, 16.0, col)
        f.ring(head + up * 6.5, up, fwd, 15.2, 4.2, "#b9b0a2", n=24, rim=0.25)
        f.ball(head + up * 26, 5.6, "#efe8dc")
    elif kind == "tall":
        f.cap(head + up * 10, head + up * 24, 15.6, col, r1=14.0)
        f.ring(head + up * 7, up, fwd, 15.4, 5.4, "fur_dark", n=24, rim=0.25)
    else:
        f.ball(head + up * 7 - fwd * 2, 15.6, "hair")


def _place(f, P, direction, scale):
    Rw, Uw, Fw = DIRS[direction]
    M = np.stack([Rw, Uw, Fw], 1) * scale
    root = P["root"]
    sh = np.asarray(P["shift"], float) * scale
    pts = []
    for p in f.parts:
        for k in ("a", "b"):
            q = M @ getattr(p, k)
            if root is not None:
                q = root @ q
            setattr(p, k, q + sh)
        p.r0 *= scale
        p.r1 *= scale
    if P["ground"] or root is not None:
        low = min(min(p.a[1], p.b[1]) - max(p.r0, p.r1) * 0.8 for p in f.parts)
        if low < 0:
            for p in f.parts:
                p.a = p.a + v3(0, -low, 0)
                p.b = p.b + v3(0, -low, 0)
    return f


# ── animations: name -> (frames, fps, loop, pose(p, direction)) ──
TAU = 2 * math.pi


def idle(p, d):
    s = math.sin(TAU * p)
    return dict(breathe=0.9 * s, lean=0.03 + 0.01 * s, headp=0.03 * s,
                armL=(0.08, 0.16 + 0.02 * s, 0.25), armR=(0.08, 0.16 + 0.02 * s, 0.25))


def walk(p, d):
    w = TAU * p
    a = 0.48 * math.sin(w)
    sw = lambda c: 0.12 + 0.85 * max(0.0, c) ** 1.3
    return dict(aL=a, bL=sw(math.cos(w)), aR=-a, bR=sw(-math.cos(w)), lean=0.08,
                armL=(-0.55 * a, 0.12, 0.35), armR=(0.55 * a, 0.12, 0.35), scarf_sway=math.sin(w),
                headp=0.03 * math.cos(2 * w))


def swing(p, rest, wind, hit, follow, lean_w, lean_h, tool, toolb, crouch=0.0):
    ks = [(0.0, rest), (0.34, wind), (0.5, hit), (0.68, follow)]
    def k(i):
        return keys(p, [(t, v[i]) for t, v in ks])
    a, e = k(0), k(1)
    lean = keys(p, [(0, 0.08), (0.34, lean_w), (0.5, lean_h), (0.68, lean_h * 0.9)])
    return dict(armR=(a, 0.08, e), armL=(a - 0.15, -0.05, e + 0.15), tool=tool, toolb=toolb, lean=lean,
                aL=0.25, bL=0.25 + crouch, aR=-0.18, bR=0.2 + crouch, headp=-0.12 * lean)


def chop(p, d):
    return swing(p, (0.65, 0.4), (2.85, 0.65), (1.0, 0.1), (0.55, 0.15), -0.14, 0.26, "axe", 0.55)


def mine(p, d):
    return swing(p, (0.6, 0.5), (2.95, 0.55), (0.55, 0.05), (0.35, 0.1), -0.12, 0.42, "pick", 0.75, crouch=0.15)


def gather(p, d):
    u = keys(p, [(0, 0.0), (0.4, 1.0), (0.6, 1.0)])
    hand = keys(p, [(0, 0.2), (0.3, 1.0), (0.6, 1.0), (0.8, 0.1)])
    return dict(lean=0.3 + 0.4 * u, aL=0.75 * u, bL=1.35 * u + 0.1, aR=0.55 * u, bR=1.2 * u + 0.1,
                armR=(0.35 + 0.15 * (1 - hand), 0.12, 0.05 + 1.5 * (1 - hand)), armL=(0.45 * u + 0.1, 0.1, 0.2),
                headp=0.3 * u)


def hammer(p, d):
    a = keys(p, [(0, 1.0), (0.3, 1.9), (0.5, 0.7), (0.62, 0.85)])
    e = keys(p, [(0, 0.9), (0.3, 1.3), (0.5, 0.25), (0.62, 0.35)])
    return dict(lean=0.32, aL=0.5, bL=1.1, aR=0.05, bR=0.6, armR=(a, 0.1, e), armL=(0.75, 0.05, 0.45),
                tool="hammer", toolb=1.25, headp=0.2)


def craft(p, d):
    e = 0.65 + 0.6 * (0.5 + 0.5 * math.sin(TAU * p))
    return dict(lean=0.22, armR=(1.05 - 0.25 * math.sin(TAU * p), 0.05, e), armL=(0.85, 0.02, 0.75),
                tool="saw", toolb=-0.25 - 0.2 * math.sin(TAU * p), headp=0.25, aL=0.12, aR=-0.08)


def fire(p, d):
    t = keys(p, [(0, 0.0), (0.35, 1.0), (0.55, 1.0)])
    return dict(lean=0.38, aL=1.25, bL=2.2, aR=1.05, bR=2.0, armR=(1.45 - 0.55 * t, 0.12, 0.5 - 0.3 * t),
                armL=(1.0 + 0.15 * math.sin(TAU * p), 0.1, 0.35), headp=0.2, log=p < 0.45)


def hurt(p, d):
    k = keys(p, [(0, 1.0), (0.5, 0.75), (1.0, 0.25)], loop=False)
    return dict(lean=-0.3 * k, headp=-0.35 * k, armR=(1.25 * k, 0.65 * k, 0.6), armL=(1.15 * k, 0.6 * k, 0.6),
                aL=0.2 * k, bL=0.3, aR=-0.3 * k, bR=0.25, lift=1.5 * k)


def death(p, d, final=False):
    q = 1.0 if final else p
    k = keys(q, [(0, 0.0), (0.2, 0.06), (1.0, 1.0)], loop=False)
    kn = keys(q, [(0, 0.3), (0.3, 1.0), (1.0, 0.3)], loop=False)
    th = k * math.pi / 2
    root = rot(v3(1, 0, 0), -0.5 * k) @ rot(v3(0, 0, 1), th)
    return dict(root=root, shift=(62 * k, 0, 0), lean=-0.2, headp=-0.25, aL=0.45 * kn, bL=1.1 * kn, aR=0.3 * kn,
                bR=0.9 * kn, armR=(1.2 + 0.9 * q, 0.9, 0.4), armL=(1.1 + 0.9 * q, 0.8, 0.5),
                eyes="closed" if q > 0.6 else "open")


def lying(p, shiver=0.0, eyes="closed"):
    s = math.sin(TAU * p)
    root = rot(v3(1, 0, 0), -0.95) @ rot(v3(0, 0, 1), math.pi / 2)
    return dict(root=root, shift=(62, 0, 0), breathe=0.8 * s + shiver * math.sin(TAU * p * 4), eyes=eyes,
                armL=(0.25, 0.25, 0.6), armR=(0.25, 0.25, 0.6), aL=0.05, aR=-0.05, lean=0.0, ground=True)


HERO_ANIMS = [
    # name, frames, fps, loop, pose
    ("idle", 4, 4, True, idle), ("walk", 8, 12, True, walk), ("chop", 6, 10, True, chop),
    ("mine", 6, 10, True, mine), ("gather", 6, 8, True, gather), ("build", 6, 10, True, hammer),
    ("craft", 6, 8, True, craft), ("fire", 6, 7, True, fire), ("hurt", 3, 12, False, hurt),
    ("death", 6, 9, False, death),
]
VILLAGER_ANIMS = [("idle", 4, 4, True, idle), ("walk", 8, 12, True, walk), ("work", 6, 9, True, hammer)]
