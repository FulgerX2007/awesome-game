class_name CastleSfx
extends Node
## Sound effects synthesized at start (like web/castle/audio.js, which builds them with Web Audio): no files.
## Each sound is a short mono 16-bit buffer made from oscillators, noise and envelopes; a small pool of players
## plays them, the same sound at most every 40 ms. On/off is saved under KEY (the web game keeps "castle.audio").

const KEY := "castle-godot.audio"
const RATE := 22050

var enabled := true
var _streams := {}
var _players: Array[AudioStreamPlayer] = []
var _last := {}
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	enabled = CastleStore.get_item(KEY) != "0"
	_rng.seed = 99
	for k in 10:
		var p := AudioStreamPlayer.new()
		p.bus = "Master"
		add_child(p)
		_players.append(p)
	_make_all()


func set_enabled(on: bool) -> void:
	enabled = on
	CastleStore.set_item(KEY, "1" if on else "0")


func play(name: String, volume_db := 0.0, pitch := 1.0) -> void:
	if not enabled or not _streams.has(name):
		return
	var now := Time.get_ticks_msec()
	if now - int(_last.get(name, -1000)) < 40:
		return
	_last[name] = now
	for p in _players:
		if not p.playing:
			p.stream = _streams[name]
			p.volume_db = volume_db
			p.pitch_scale = pitch * _rng.randf_range(0.96, 1.04)
			p.play()
			return


## ── Synthesis ──

func _buf(seconds: float) -> PackedFloat32Array:
	var b := PackedFloat32Array()
	b.resize(int(seconds * RATE))
	return b


func _wav(b: PackedFloat32Array, gain := 0.8) -> AudioStreamWAV:
	var bytes := PackedByteArray()
	bytes.resize(b.size() * 2)
	for i in b.size():
		bytes.encode_s16(i * 2, int(clampf(b[i] * gain, -1.0, 1.0) * 32767.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.stereo = false
	w.data = bytes
	return w


## Adds a tone: frequency sliding f0 → f1, a wave shape, attack/decay envelope, starting at `at` seconds.
func _tone(b: PackedFloat32Array, at: float, dur: float, f0: float, f1: float, amp: float, shape := "sine", attack := 0.005) -> void:
	var start := int(at * RATE)
	var n := int(dur * RATE)
	var ph := 0.0
	for i in n:
		var j := start + i
		if j >= b.size():
			break
		var t := float(i) / n
		var f := lerpf(f0, f1, t)
		ph += f / RATE
		var v := 0.0
		match shape:
			"sine": v = sin(ph * TAU)
			"square": v = 1.0 if fmod(ph, 1.0) < 0.5 else -1.0
			"saw": v = fmod(ph, 1.0) * 2.0 - 1.0
			"tri": v = absf(fmod(ph, 1.0) * 4.0 - 2.0) - 1.0
		var env := minf(1.0, (i / float(RATE)) / attack) * pow(1.0 - t, 2.0)
		b[j] += v * amp * env


## Adds filtered noise (a one-pole low-pass at `cut` Hz), shaped like _tone.
func _noise(b: PackedFloat32Array, at: float, dur: float, amp: float, cut := 2000.0, decay := 2.0) -> void:
	var start := int(at * RATE)
	var n := int(dur * RATE)
	var y := 0.0
	var a := 1.0 - exp(-TAU * cut / RATE)
	for i in n:
		var j := start + i
		if j >= b.size():
			break
		var t := float(i) / n
		y += a * (_rng.randf_range(-1.0, 1.0) - y)
		b[j] += y * amp * pow(1.0 - t, decay) * minf(1.0, i / 60.0)


func _make_all() -> void:
	var b: PackedFloat32Array
	# the bowstring: a plucked low note and a hiss of the arrow leaving
	b = _buf(0.22)
	_tone(b, 0, 0.18, 190, 120, 0.6, "tri")
	_noise(b, 0, 0.14, 0.35, 3500)
	_streams.bow = _wav(b)
	# an arrow thudding into flesh/wood
	b = _buf(0.14)
	_noise(b, 0, 0.12, 0.8, 900, 3.0)
	_tone(b, 0, 0.08, 160, 80, 0.4)
	_streams.hit = _wav(b)
	# a clank on a shield or armour
	b = _buf(0.25)
	_tone(b, 0, 0.22, 1450, 1380, 0.35, "square")
	_tone(b, 0, 0.2, 2100, 2050, 0.2)
	_noise(b, 0, 0.05, 0.4, 6000)
	_streams.clank = _wav(b, 0.6)
	# an enemy falls: a puff and a low drop
	b = _buf(0.3)
	_noise(b, 0, 0.25, 0.6, 700)
	_tone(b, 0, 0.25, 220, 70, 0.4, "tri")
	_streams.kill = _wav(b)
	# blows on the wall: stone thump
	b = _buf(0.35)
	_tone(b, 0, 0.3, 90, 45, 0.9)
	_noise(b, 0, 0.25, 0.6, 500)
	_streams.wall = _wav(b)
	# the war horn at a wave's start
	b = _buf(1.2)
	_tone(b, 0, 1.15, 147, 150, 0.45, "saw", 0.12)
	_tone(b, 0, 1.15, 220, 224, 0.25, "saw", 0.12)
	_tone(b, 0.0, 1.1, 74, 75, 0.35, "sine", 0.1)
	_streams.horn = _wav(b, 0.7)
	# coins
	b = _buf(0.3)
	_tone(b, 0, 0.12, 1320, 1320, 0.35, "square")
	_tone(b, 0.07, 0.2, 1760, 1760, 0.3, "square")
	_streams.coin = _wav(b, 0.5)
	# building: hammer knocks
	b = _buf(0.5)
	for k in 3:
		_tone(b, k * 0.14, 0.08, 420 - k * 30, 260, 0.6, "tri")
		_noise(b, k * 0.14, 0.06, 0.4, 2500)
	_streams.build = _wav(b)
	# stakes biting: a dry crunch
	b = _buf(0.16)
	_noise(b, 0, 0.14, 0.7, 2600, 2.5)
	_tone(b, 0, 0.06, 600, 300, 0.25, "square")
	_streams.stake = _wav(b, 0.6)
	# wood breaking
	b = _buf(0.6)
	for k in 5:
		_noise(b, k * 0.07, 0.15, 0.6 - k * 0.08, 3000, 3.0)
	_tone(b, 0, 0.4, 140, 60, 0.4, "saw")
	_streams.crack = _wav(b)
	# a heavy impact (charge, slam, boulder)
	b = _buf(0.8)
	_tone(b, 0, 0.7, 70, 30, 1.0)
	_noise(b, 0, 0.6, 0.7, 400, 1.5)
	_streams.boom = _wav(b)
	# a boss roar
	b = _buf(1.1)
	_tone(b, 0, 1.0, 110, 70, 0.45, "saw", 0.08)
	_tone(b, 0, 1.0, 116, 74, 0.35, "saw", 0.08)
	_noise(b, 0, 1.0, 0.35, 900, 1.2)
	_streams.roar = _wav(b, 0.8)
	# fire: a whoosh
	b = _buf(0.7)
	_noise(b, 0, 0.65, 0.7, 1600, 1.2)
	_streams.fire = _wav(b, 0.7)
	# magic: a shimmering sweep
	b = _buf(0.7)
	for k in 4:
		_tone(b, k * 0.05, 0.5, 600 + k * 220, 900 + k * 300, 0.18)
	_streams.magic = _wav(b, 0.8)
	# the ward's flash
	b = _buf(0.5)
	_tone(b, 0, 0.45, 880, 1760, 0.3)
	_tone(b, 0.03, 0.4, 1320, 2200, 0.2)
	_streams.ward = _wav(b, 0.8)
	# a warning (boss telegraph)
	b = _buf(0.35)
	_tone(b, 0, 0.15, 520, 520, 0.35, "square")
	_tone(b, 0.17, 0.15, 520, 520, 0.35, "square")
	_streams.warn = _wav(b, 0.45)
	# UI click
	b = _buf(0.06)
	_tone(b, 0, 0.05, 900, 700, 0.4, "tri")
	_streams.click = _wav(b, 0.5)
	# victory fanfare and defeat
	b = _buf(1.6)
	var notes := [523.25, 659.25, 783.99, 1046.5]
	for k in notes.size():
		_tone(b, k * 0.14, 0.5 if k < 3 else 1.0, notes[k], notes[k], 0.3, "square", 0.01)
		_tone(b, k * 0.14, 0.5 if k < 3 else 1.0, notes[k] * 0.5, notes[k] * 0.5, 0.2, "tri", 0.01)
	_streams.win = _wav(b, 0.5)
	b = _buf(1.4)
	var low := [392.0, 349.23, 311.13, 261.63]
	for k in low.size():
		_tone(b, k * 0.25, 0.45 if k < 3 else 0.9, low[k], low[k] * (0.97 if k == 3 else 1.0), 0.3, "saw", 0.02)
	_streams.lose = _wav(b, 0.45)
