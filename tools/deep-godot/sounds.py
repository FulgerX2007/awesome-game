#!/usr/bin/env python3
"""Глубина on Godot: renders the sounds of web/deep/game.js (Web Audio tones) into WAV files.

The web version synthesizes every sound live; Godot plays these recordings and changes their pitch
where the web version changes the frequency (the gulp follows the prey size, the zone chime the depth).
    python3 tools/deep-godot/sounds.py   ->  godot/deep/assets/sounds/*.wav
"""
import math
import os
import random
import struct
import wave

RATE = 22050
MASTER = 0.55  # the master gain of game.js
OUT = os.path.join(os.path.dirname(__file__), '../../godot/deep/assets/sounds')


def wave_fn(kind, phase):
    x = phase % 1.0
    if kind == 'triangle':
        return 4 * abs(x - 0.5) - 1
    if kind == 'sawtooth':
        return 2 * x - 1
    return math.sin(2 * math.pi * x)


def tone(buf, f, t=0.0, d=0.4, vol=0.1, kind='sine', to=None):
    """Same envelope as tone() in game.js: 15 ms exponential attack, exponential fade to silence by d."""
    start = int(t * RATE)
    n = int((d + 0.05) * RATE)
    need = start + n
    if len(buf) < need:
        buf.extend([0.0] * (need - len(buf)))
    phase = 0.0
    for i in range(n):
        s = i / RATE
        freq = f * (to / f) ** min(s / d, 1.0) if to else f
        phase += freq / RATE
        if s < 0.015:
            g = 0.0001 * (vol / 0.0001) ** (s / 0.015)
        elif s < d:
            g = vol * (0.0001 / vol) ** ((s - 0.015) / (d - 0.015))
        else:
            g = 0.0
        buf[start + i] += wave_fn(kind, phase) * g * MASTER


def save(name, buf, peak=None):
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        scale = 1.0 if peak is None else peak / max(1e-9, max(abs(v) for v in buf))
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, v * scale)) * 32767)) for v in buf))


def main():
    st = lambda semis: 2 ** (semis / 12)
    b = []; tone(b, 550, d=0.18, vol=0.09, to=550 * 0.55); save('gulp', b)            # pitch follows the prey
    b = []; tone(b, 180, d=0.35, vol=0.06, to=420, kind='triangle'); save('dash', b)
    b = []
    for i, s in enumerate([0, 4, 7, 12, 16]):
        tone(b, 262 * st(s), t=i * 0.12, d=1.8, vol=0.07, kind='triangle')
    save('stage', b)
    b = []; tone(b, 140, d=1.2, vol=0.18, to=45, kind='sawtooth'); save('eaten', b)
    b = []; tone(b, 330, d=2.2, vol=0.06, to=220); tone(b, 495, t=0.3, d=2, vol=0.04); save('zone', b)  # pitch 1/(1+z/4)
    b = []
    for i, s in enumerate([0, 7, 12]):
        tone(b, 660 * st(s), t=i * 0.08, d=0.9, vol=0.05, kind='triangle')
    save('discover', b)
    b = []; tone(b, 220, d=3, vol=0.06, to=330); tone(b, 330, t=1.4, d=3, vol=0.05, to=196); save('whale', b)
    b = []
    tone(b, 110, d=4, vol=0.08, to=82, kind='triangle'); tone(b, 165, t=0.8, d=3.5, vol=0.05, to=110); tone(b, 55, d=5, vol=0.06)
    save('legend', b)

    # Underwater hum: brown noise through a low-pass whose cutoff breathes (260 Hz ± 120, every 20 s).
    rnd = random.Random(7)
    n = 20 * RATE
    noise, last = [], 0.0
    for _ in range(n):
        last = (last + (rnd.random() * 2 - 1) * 0.02) * 0.995
        noise.append(last * 8)
    out, y = [], 0.0
    for i, v in enumerate(noise):
        fc = 260 + 120 * math.sin(2 * math.pi * 0.05 * i / RATE)
        a = 1 - math.exp(-2 * math.pi * fc / RATE)
        y += (v - y) * a
        out.append(y * 0.16 * MASTER)
    fade = RATE  # one second crossfade, so the loop has no seam
    for i in range(fade):
        k = i / fade
        out[i] = out[i] * k + out[n - fade + i] * (1 - k)
    save('hum', out[: n - fade])

    # Danger throb: 55 Hz, pulsing 2.2 times a second. The loop holds whole periods of both.
    n = int(round(10 / 2.2 * RATE))
    save('danger', [math.sin(2 * math.pi * 55 * i / RATE) * (0.5 + 0.5 * math.sin(2 * math.pi * 2.2 * i / RATE)) for i in range(n)], peak=0.9)


if __name__ == '__main__':
    main()
