class_name WinterSfx
extends Node
## The sounds of web/winter/audio.js, synthesized at start into short buffers (no files): the axe, the pick,
## crunching snow, the fire, wolves, the bear, the trader's bells, snares, the aurora, the creaking roof, and two
## loops — the fire's crackle and the wind — whose volume follows the game. Each sound has the same minimum gap
## as on the web. On/off is saved under KEY.

const KEY := "winter-godot.audio"
const RATE := 22050
const GAPS := {
	"chop": 140, "mine": 140, "step": 180, "pick": 160, "eat": 300, "fire": 300, "howl": 3000, "bite": 200, "hit": 120,
	"build": 300, "craft": 300, "rescue": 800, "dawn": 1500, "win": 1000, "lose": 1000, "roar": 2000, "bells": 1500,
	"trade": 200, "snare": 300, "aurora": 4000, "creak": 1500, "click": 60,
}

var enabled := true
var _streams := {}
var _players: Array[AudioStreamPlayer] = []
var _loops := {}
var _last := {}
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	enabled = WinterStore.get_item(KEY) != "0"
	_rng.seed = 7
	for k in 10:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)
	_make_all()
	for n in ["crackle", "wind"]:
		var p := AudioStreamPlayer.new()
		p.stream = _streams[n]
		p.volume_db = -80.0
		add_child(p)
		_loops[n] = {"player": p, "level": 0.0, "target": 0.0}


func set_enabled(on: bool) -> void:
	enabled = on
	WinterStore.set_item(KEY, "1" if on else "0")
	if not on:
		for l in _loops.values():
			l.player.stop()
			l.level = 0.0


func play(name: String, pitch := 1.0) -> void:
	if not enabled or not _streams.has(name):
		return
	var now := Time.get_ticks_msec()
	if now - int(_last.get(name, -100000)) < int(GAPS.get(name, 200)):
		return
	_last[name] = now
	for p in _players:
		if not p.playing:
			p.stream = _streams[name]
			p.pitch_scale = pitch * _rng.randf_range(0.95, 1.05)
			p.play()
			return


## A loop's level 0..1; it fades there over about 0.4 s.
func set_loop(name: String, level: float) -> void:
	if _loops.has(name):
		_loops[name].target = clampf(level, 0.0, 1.0)


func _process(delta: float) -> void:
	for n in _loops:
		var l: Dictionary = _loops[n]
		var target: float = l.target if enabled else 0.0
		l.level = move_toward(l.level, target, delta * 2.5)
		var p: AudioStreamPlayer = l.player
		if l.level > 0.001:
			if not p.playing:
				p.play()
			p.volume_db = linear_to_db(l.level * (0.55 if n == "crackle" else 0.8))
		elif p.playing:
			p.stop()


## ── Synthesis: oscillators and band-passed noise with exponential envelopes, like the Web Audio original ──

func _buf(seconds: float) -> PackedFloat32Array:
	var b := PackedFloat32Array()
	b.resize(int(seconds * RATE))
	return b


func _wav(b: PackedFloat32Array, gain := 1.0, loop := false) -> AudioStreamWAV:
	var bytes := PackedByteArray()
	bytes.resize(b.size() * 2)
	for i in b.size():
		bytes.encode_s16(i * 2, int(clampf(b[i] * gain, -1.0, 1.0) * 32767.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.data = bytes
	if loop:
		w.loop_mode = AudioStreamWAV.LOOP_FORWARD
		w.loop_end = b.size()
	return w


static func freq(m: float) -> float:
	return 440.0 * pow(2.0, (m - 69.0) / 12.0)


## An exponential attack/decay envelope like setValueAtTime(0.0001) → ramp to vol → ramp to 0.0001.
func _env(t: float, d: float, attack: float) -> float:
	if t < attack:
		return pow(10.0, -4.0 * (1.0 - t / attack))
	return pow(10.0, -4.0 * ((t - attack) / maxf(1e-4, d - attack)))


func _tone(b: PackedFloat32Array, f: float, at := 0.0, d := 0.3, vol := 0.1, type := "sine", to := 0.0, attack := 0.005) -> void:
	var start := int(at * RATE)
	var n := int(d * RATE)
	var ph := 0.0
	for i in n:
		var j := start + i
		if j >= b.size():
			break
		var t := float(i) / RATE
		var fr := f * pow(to / f, t / d) if to > 0.0 else f
		ph += fr / RATE
		var x := fmod(ph, 1.0)
		var v := 0.0
		match type:
			"sine": v = sin(ph * TAU)
			"square": v = 1.0 if x < 0.5 else -1.0
			"sawtooth": v = x * 2.0 - 1.0
			"triangle": v = absf(x * 4.0 - 2.0) - 1.0
		b[j] += v * vol * _env(t, d, attack)


## Noise through a state-variable filter (bandpass or lowpass), the cutoff gliding to `sweep`.
func _noise(b: PackedFloat32Array, at := 0.0, d := 0.1, vol := 0.2, f := 1000.0, q := 1.0, type := "bandpass", attack := 0.004, sweep := 0.0) -> void:
	var start := int(at * RATE)
	var n := int(d * RATE)
	var low := 0.0
	var band := 0.0
	for i in n:
		var j := start + i
		if j >= b.size():
			break
		var t := float(i) / RATE
		var fc := f * pow(sweep / f, t / d) if sweep > 0.0 else f
		var k := 2.0 * sin(PI * minf(fc, RATE * 0.22) / RATE)
		var x := _rng.randf_range(-1.0, 1.0)
		low += k * band
		var high := x - low - band / maxf(0.3, q)
		band += k * high
		var v := band if type == "bandpass" else low
		b[j] += v * vol * 2.2 * _env(t, d, attack)


func _vary(f: float, amt := 0.05) -> float:
	return f * (1.0 + _rng.randf_range(-amt, amt))


func _make_all() -> void:
	var G := 4.2      # the web's bus is 0.45 with voices at 0.03–0.12
	var b := _buf(0.12)
	_noise(b, 0, 0.09, 0.1, 650, 1.2)
	_tone(b, _vary(170, 0.08), 0, 0.07, 0.04, "square", 110)
	_streams.chop = _wav(b, G)
	b = _buf(0.15)
	_tone(b, _vary(1500, 0.06), 0, 0.12, 0.05, "square", 1200)
	_noise(b, 0, 0.05, 0.06, 3200, 2)
	_streams.mine = _wav(b, G)
	b = _buf(0.09)
	_noise(b, 0, 0.07, 0.05, 2600, 0.7, "bandpass", 0.004, 1200)
	_streams.step = _wav(b, G)
	b = _buf(0.14)
	_noise(b, 0, 0.12, 0.04, 1800, 1.5)
	_streams.pick = _wav(b, G)
	b = _buf(0.22)
	_noise(b, 0, 0.06, 0.05, 900, 2)
	_noise(b, 0.12, 0.06, 0.05, 900, 2)
	_streams.eat = _wav(b, G)
	b = _buf(0.34)
	_noise(b, 0, 0.3, 0.08, 500, 0.6, "bandpass", 0.004, 1500)
	_streams.fire = _wav(b, G)
	b = _buf(2.2)
	_tone(b, 330, 0, 1.6, 0.05, "sine", 520, 0.3)
	_tone(b, 480, 0.9, 1.2, 0.03, "sine", 300, 0.2)
	_streams.howl = _wav(b, G)
	b = _buf(0.15)
	_noise(b, 0, 0.1, 0.12, 400, 0.8, "lowpass")
	_tone(b, 220, 0, 0.12, 0.06, "sawtooth", 120)
	_streams.bite = _wav(b, G)
	b = _buf(0.09)
	_noise(b, 0, 0.07, 0.1, 700, 1)
	_streams.hit = _wav(b, G)
	b = _buf(0.34)
	for at in [0.0, 0.12, 0.24]:
		_noise(b, at, 0.07, 0.09, 500, 1.5)
	_streams.build = _wav(b, G)
	b = _buf(0.48)
	_tone(b, 1300, 0, 0.25, 0.05, "square", 1100)
	_tone(b, freq(84), 0.15, 0.3, 0.04, "triangle")
	_streams.craft = _wav(b, G)
	b = _buf(0.9)
	for k in 4:
		_tone(b, freq([60, 64, 67, 72][k]), k * 0.08, 0.6, 0.05, "triangle")
	_streams.rescue = _wav(b, G)
	b = _buf(1.35)
	_tone(b, freq(84), 0, 1.2, 0.05)
	_tone(b, freq(91), 0.1, 1.2, 0.03)
	_streams.dawn = _wav(b, G)
	b = _buf(2.0)
	var up := [60, 64, 67, 72, 76, 79]
	for k in up.size():
		_tone(b, freq(up[k]), k * 0.11, 0.4, 0.07, "triangle", 0.0, 0.01)
	for m in [72, 76, 79]:
		_tone(b, freq(m), 0.7, 1.2, 0.05, "sine", 0.0, 0.05)
	_streams.win = _wav(b, G)
	b = _buf(1.4)
	_noise(b, 0, 1.2, 0.08, 300, 0.6, "lowpass", 0.2)
	var dn := [64, 60, 57, 52]
	for k in dn.size():
		_tone(b, freq(dn[k]), 0.2 + k * 0.2, 0.5, 0.06, "triangle", 0.0, 0.01)
	_streams.lose = _wav(b, G)
	b = _buf(1.2)
	_tone(b, 90, 0, 1.1, 0.09, "sawtooth", 60, 0.15)
	_noise(b, 0, 1.0, 0.08, 260, 0.7, "lowpass", 0.15, 140)
	_streams.roar = _wav(b, G)
	b = _buf(0.8)
	var bells := [88, 91, 88, 93, 88]
	for k in bells.size():
		_tone(b, freq(bells[k]), k * 0.09, 0.35, 0.035, "triangle")
	_streams.bells = _wav(b, G)
	b = _buf(0.55)
	_tone(b, 2200, 0, 0.12, 0.04, "square", 1900)
	_tone(b, 2600, 0.08, 0.12, 0.035, "square", 2300)
	_tone(b, freq(79), 0.18, 0.35, 0.04, "triangle")
	_streams.trade = _wav(b, G)
	b = _buf(0.3)
	_tone(b, 520, 0, 0.25, 0.05, "triangle", 420)
	_noise(b, 0, 0.05, 0.04, 1500, 2)
	_streams.snare = _wav(b, G)
	b = _buf(3.0)
	var au := [84, 88, 91, 96]
	for k in au.size():
		_tone(b, freq(au[k]) * (1.0 + k * 0.003), k * 0.25, 2.2, 0.02, "sine", 0.0, 0.6)
	_streams.aurora = _wav(b, G)
	b = _buf(0.8)
	_tone(b, 140, 0, 0.7, 0.06, "sawtooth", 95, 0.1)
	_noise(b, 0.55, 0.18, 0.12, 900, 1)
	_streams.creak = _wav(b, G)
	b = _buf(0.05)
	_tone(b, 900, 0, 0.04, 0.06, "triangle", 700)
	_streams.click = _wav(b, G)
	# the loops: two seconds of filtered noise with a soft crackle on top for the fire
	b = _buf(2.0)
	_loop_noise(b, 1800, 0.8, "bandpass", 0.05)
	for k in 40:
		_noise(b, _rng.randf() * 1.9, 0.03, _rng.randf_range(0.03, 0.08), 2600, 2)
	_streams.crackle = _wav(b, G * 1.4, true)
	b = _buf(3.0)
	_loop_noise(b, 500, 0.4, "lowpass", 0.09)
	_streams.wind = _wav(b, G * 1.2, true)


## Steady filtered noise for a loop, its ends cross-faded so the seam doesn't click.
func _loop_noise(b: PackedFloat32Array, f: float, q: float, type: String, vol: float) -> void:
	var low := 0.0
	var band := 0.0
	var k := 2.0 * sin(PI * f / RATE)
	var tmp := PackedFloat32Array()
	tmp.resize(b.size() + 4000)
	for i in tmp.size():
		var x := _rng.randf_range(-1.0, 1.0)
		low += k * band
		var high := x - low - band / q
		band += k * high
		# a slow swell, like gusts
		var sw := 0.75 + 0.25 * sin(i / float(RATE) * TAU * 0.4)
		tmp[i] = (band if type == "bandpass" else low) * vol * 2.2 * sw
	var n := b.size()
	var fade := 2000
	for i in n:
		var v := tmp[i + 2000]
		if i < fade:
			var t := float(i) / fade
			v = v * t + tmp[i + 2000 + n] * (1.0 - t) if i + 2000 + n < tmp.size() else v
		b[i] += v
