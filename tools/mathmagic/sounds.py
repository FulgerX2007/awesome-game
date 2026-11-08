#!/usr/bin/env python3
"""MathMagic: synthesizes every sound effect and the music loop into godot/mathmagic/assets/audio/.
Original, procedurally generated, released as CC0 with the game. Needs Python 3 and numpy.
    python3 tools/mathmagic/sounds.py
"""
import os, wave
import numpy as np

SR = 22050
OUT = os.path.join(os.path.dirname(__file__), '../../godot/mathmagic/assets/audio')
rng = np.random.default_rng(7)


def t(d):
    return np.arange(int(SR * d)) / SR


def env(n, a=0.005, r=0.1):
    """attack-release envelope over n samples"""
    e = np.ones(n)
    na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    e[:na] = np.linspace(0, 1, na)
    if nr < n:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def tone(f, d, wave_='sine', a=0.005, r=None, vol=0.5):
    x = t(d)
    ph = 2 * np.pi * np.cumsum(np.full_like(x, f) if np.isscalar(f) else f) / SR
    if wave_ == 'square':
        y = np.sign(np.sin(ph)) * 0.6
    elif wave_ == 'tri':
        y = 2 / np.pi * np.arcsin(np.sin(ph))
    else:
        y = np.sin(ph) + 0.25 * np.sin(2 * ph)
    return y * env(len(x), a, r if r is not None else d * 0.8) * vol


def sweep(f0, f1, d, **kw):
    return tone(np.geomspace(f0, f1, int(SR * d)), d, **kw)


def noise(d, vol=0.4, lp=0.2):
    y = rng.uniform(-1, 1, int(SR * d))
    out = np.zeros_like(y)
    acc = 0.0
    for i, v in enumerate(y):  # one-pole low-pass
        acc += lp * (v - acc)
        out[i] = acc
    return out / (np.abs(out).max() + 1e-9) * vol * env(len(y), 0.005, d * 0.9)


def seq(*parts, gap=0.0):
    out = []
    for p in parts:
        out.append(p)
        if gap:
            out.append(np.zeros(int(gap * SR)))
    return np.concatenate(out)


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[:len(p)] += p
    return out


def at(x, start, total):
    out = np.zeros(int(total * SR))
    s = int(start * SR)
    out[s:s + len(x)] += x[:len(out) - s]
    return out


def note(n):  # MIDI note to Hz
    return 440.0 * 2 ** ((n - 69) / 12)


def save(name, y, peak=0.8):
    y = y / (np.abs(y).max() + 1e-9) * peak
    data = (np.clip(y, -1, 1) * 32767).astype('<i2')
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def music():
    """16 bars of a calm, bouncy C-major loop: bass, chords and a simple melody. Loops seamlessly."""
    bpm = 104
    beat = 60 / bpm
    bars = 8
    total = bars * 4 * beat
    y = np.zeros(int(total * SR))
    chords = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]] * 2  # C Am F G
    melody = [76, 74, 72, 74, 76, 76, 76, None, 74, 74, 74, None, 76, 79, 79, None,
              76, 74, 72, 74, 76, 76, 76, 76, 74, 74, 76, 74, 72, None, None, None]
    for bar, ch in enumerate(chords):
        for b in range(4):
            st = (bar * 4 + b) * beat
            y += at(tone(note(ch[0] - 12), beat * 0.9, 'tri', r=beat * 0.5, vol=0.35), st, total)
            if b % 2 == 1:
                for n in ch:
                    y += at(tone(note(n + 12), beat * 0.5, 'sine', r=beat * 0.4, vol=0.09), st, total)
    for i, m in enumerate(melody):
        if m is not None:
            y += at(tone(note(m), beat * 0.9, 'tri', a=0.01, r=beat * 0.6, vol=0.22), i * beat, total)
    return y


SOUNDS = {
    'jump': lambda: sweep(300, 620, 0.16, wave_='tri', vol=0.5),
    'land': lambda: noise(0.07, 0.3, 0.08),
    'collect': lambda: seq(tone(988, 0.07, vol=0.4), tone(1319, 0.18, vol=0.4)),
    'gem': lambda: seq(*[tone(note(n), 0.08, 'tri', vol=0.4) for n in (72, 76, 79, 84)], tone(note(88), 0.3, 'tri', vol=0.4)),
    'correct': lambda: mix(seq(tone(note(72), 0.12, vol=0.4), tone(note(76), 0.12, vol=0.4), tone(note(79), 0.35, vol=0.45)),
                           at(tone(note(84), 0.4, 'tri', vol=0.15), 0.24, 0.7)),
    'wrong': lambda: seq(tone(note(60), 0.14, 'tri', vol=0.35), tone(note(57), 0.22, 'tri', vol=0.3)),  # soft "hmm", not a buzzer
    'hint': lambda: sweep(500, 900, 0.25, vol=0.3),
    'click': lambda: tone(1200, 0.03, 'tri', r=0.02, vol=0.3),
    'open': lambda: mix(noise(0.6, 0.25, 0.03), at(seq(tone(note(67), 0.1), tone(note(74), 0.25)), 0.35, 0.8)),
    'place': lambda: mix(noise(0.08, 0.5, 0.15), tone(180, 0.1, vol=0.4)),
    'pop': lambda: sweep(700, 300, 0.12, vol=0.35),
    'power': lambda: mix(sweep(110, 440, 0.9, wave_='tri', vol=0.3), at(tone(note(84), 0.3, vol=0.3), 0.8, 1.2)),
    'fizzle': lambda: mix(sweep(400, 120, 0.4, wave_='tri', vol=0.3), noise(0.4, 0.15, 0.3)),
    'splash': lambda: noise(0.45, 0.5, 0.25),
    'respawn': lambda: sweep(300, 1200, 0.35, vol=0.35),
    'checkpoint': lambda: seq(tone(note(79), 0.1, vol=0.35), tone(note(84), 0.25, vol=0.35)),
    'warn': lambda: sweep(200, 520, 0.6, wave_='tri', vol=0.35),
    'slam': lambda: mix(noise(0.5, 0.8, 0.04), sweep(120, 40, 0.5, vol=0.7)),
    'hurt': lambda: sweep(500, 250, 0.2, wave_='tri', vol=0.4),
    'shield': lambda: mix(*[at(tone(f, 0.5, vol=0.2), i * 0.04, 0.8) for i, f in enumerate((1800, 2400, 2000, 2900, 2200))], noise(0.3, 0.2, 0.6)),
    'rumble': lambda: noise(1.0, 0.6, 0.02),
    'victory': lambda: seq(*[tone(note(n), d, 'tri', vol=0.4) for n, d in ((72, .15), (76, .15), (79, .15), (84, .3), (79, .15), (84, .6))]),
    'step': lambda: noise(0.04, 0.15, 0.1),
}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, fn in SOUNDS.items():
        save(name, fn())
    save('music', music(), peak=0.6)
    print('wrote', len(SOUNDS) + 1, 'sounds to', os.path.normpath(OUT))
