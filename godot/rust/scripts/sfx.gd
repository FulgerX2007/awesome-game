class_name Sfx
extends Node
## Sound effects synthesized at start (no audio files): short mono buffers built from tones and
## filtered noise, played from a small pool, the same sound at most every 40 ms. On/off is a setting.

const RATE := 22050

var enabled := true
var _streams := {}
var _players: Array[AudioStreamPlayer] = []
var _last := {}
var _rng := RandomNumberGenerator.new()
var _hum: AudioStreamPlayer


func _ready() -> void:
	enabled = bool(Settings.get_value("sound", true))
	_rng.seed = 7
	for k in 8:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)
	_make_all()
	_hum = AudioStreamPlayer.new()
	_hum.stream = _streams.hum
	_hum.volume_db = -26.0
	add_child(_hum)
	Game.acted.connect(_on_acted)
	Game.event.connect(_on_event)
	_update_hum()


func set_enabled(on: bool) -> void:
	enabled = on
	Settings.set_value("sound", on)
	_update_hum()


func _update_hum() -> void:
	if enabled and not _hum.playing:
		_hum.play()
	elif not enabled:
		_hum.stop()


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
			p.pitch_scale = pitch * _rng.randf_range(0.95, 1.05)
			p.play()
			return


func _on_acted(kind: String, amount: float, info: Dictionary) -> void:
	if amount <= 0.0:
		play("nope", -8.0)
		return
	match kind:
		"dig": play("dig", -4.0)
		"sort": play("core" if info.get("core", false) else "sort", -5.0)
		"repair": play("built" if info.get("finished", false) else "weld", -6.0)


func _on_event(e: Dictionary) -> void:
	match e.type:
		"upgrade_bought": play("buy", -4.0)
		"stage_built": play("stage", -2.0)
		"robot_built": play("built", -10.0)
		"achievement": play("chime", -4.0)
		"salvage_spawn", "wreck_spawn": play("ping", -6.0)
		"salvage_taken", "wreck_taken": play("buy", -4.0, 1.2)
		"shortage_start": play("alarm", -5.0)
		"shortage_end": play("chime", -6.0, 0.8)
		"core_found": play("core", -6.0)


# ── synthesis ──

func _buf(seconds: float) -> PackedFloat32Array:
	var b := PackedFloat32Array()
	b.resize(int(seconds * RATE))
	return b


func _wav(b: PackedFloat32Array, gain := 0.8, loop := false) -> AudioStreamWAV:
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


func _tone(b: PackedFloat32Array, at: float, dur: float, f0: float, f1: float, amp: float, shape := "sine", attack := 0.005, sustain := false) -> void:
	var start := int(at * RATE)
	var n := int(dur * RATE)
	var ph := 0.0
	for i in n:
		var j := start + i
		if j >= b.size():
			break
		var t := float(i) / n
		ph += lerpf(f0, f1, t) / RATE
		var v := 0.0
		match shape:
			"sine": v = sin(ph * TAU)
			"square": v = 1.0 if fmod(ph, 1.0) < 0.5 else -1.0
			"saw": v = fmod(ph, 1.0) * 2.0 - 1.0
			"tri": v = absf(fmod(ph, 1.0) * 4.0 - 2.0) - 1.0
		var env := 1.0 if sustain else minf(1.0, (i / float(RATE)) / attack) * pow(1.0 - t, 2.0)
		b[j] += v * amp * env


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
	b = _buf(0.22)  # shovel into scrap: crunch and clink
	_noise(b, 0, 0.18, 0.9, 1400, 2.5)
	_tone(b, 0.02, 0.12, 900, 700, 0.18, "square")
	_streams.dig = _wav(b)
	b = _buf(0.16)  # sorting: two metallic ticks
	_tone(b, 0, 0.07, 1800, 1700, 0.3, "tri")
	_tone(b, 0.07, 0.08, 2300, 2200, 0.25, "tri")
	_streams.sort = _wav(b)
	b = _buf(0.18)  # welding zap
	_noise(b, 0, 0.16, 0.6, 5000, 1.2)
	_tone(b, 0, 0.16, 140, 120, 0.25, "saw")
	_streams.weld = _wav(b, 0.7)
	b = _buf(0.5)  # a robot wakes: rising beeps
	for k in 3:
		_tone(b, k * 0.12, 0.12, 520 + k * 260, 560 + k * 260, 0.35, "square")
	_streams.built = _wav(b, 0.5)
	b = _buf(0.35)  # purchase: ratchet and bell
	_noise(b, 0, 0.08, 0.4, 3000)
	_tone(b, 0.05, 0.3, 1320, 1320, 0.3)
	_tone(b, 0.05, 0.3, 1980, 1980, 0.15)
	_streams.buy = _wav(b)
	b = _buf(0.6)  # core found: glassy shimmer
	for k in 4:
		_tone(b, k * 0.07, 0.4, 1400 + k * 330, 1400 + k * 330, 0.18)
	_streams.core = _wav(b)
	b = _buf(1.4)  # ark stage: low boom and a major chord
	_tone(b, 0, 0.8, 70, 40, 0.8)
	_noise(b, 0, 0.6, 0.4, 400)
	for f in [262.0, 330.0, 392.0, 523.0]:
		_tone(b, 0.15, 1.2, f, f, 0.12, "tri", 0.05)
	_streams.stage = _wav(b, 0.8)
	b = _buf(0.8)  # achievement chime
	_tone(b, 0, 0.5, 880, 880, 0.3)
	_tone(b, 0.12, 0.6, 1320, 1320, 0.25)
	_streams.chime = _wav(b)
	b = _buf(0.3)  # an event appears: sonar ping
	_tone(b, 0, 0.28, 1100, 1050, 0.35)
	_streams.ping = _wav(b)
	b = _buf(0.9)  # power shortage: falling alarm
	_tone(b, 0, 0.4, 700, 400, 0.3, "square")
	_tone(b, 0.45, 0.4, 700, 400, 0.3, "square")
	_streams.alarm = _wav(b, 0.5)
	b = _buf(0.12)  # not possible
	_tone(b, 0, 0.1, 200, 160, 0.4, "square")
	_streams.nope = _wav(b, 0.4)
	b = _buf(2.0)  # the yard's machine hum, looped
	_tone(b, 0, 2.0, 55, 55, 0.4, "sine", 0.005, true)
	_tone(b, 0, 2.0, 110, 110, 0.15, "tri", 0.005, true)
	_tone(b, 0, 2.0, 165.5, 165.5, 0.05, "sine", 0.005, true)
	_streams.hum = _wav(b, 0.6, true)
