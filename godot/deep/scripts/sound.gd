class_name DeepSound
extends Node
## The sounds of web/deep/game.js, rendered to WAV by tools/deep-godot/sounds.py.
## A quiet underwater hum loops all the time; a low throb fades in while a predator chases you.

var muted := false
var _hum: AudioStreamPlayer
var _danger: AudioStreamPlayer
var _streams := {}
var _pool: Array[AudioStreamPlayer] = []


func _ready() -> void:
	muted = DeepStore.get_item("deep.muted") == "1"
	for n in ["gulp", "dash", "stage", "eaten", "zone", "discover", "whale", "legend", "hum", "danger"]:
		_streams[n] = load("res://assets/sounds/%s.wav" % n)
	_hum = _loop("hum", 0.0)
	_danger = _loop("danger", -80.0)
	for i in 8:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_pool.append(p)
	_apply_mute()


func _loop(n: String, db: float) -> AudioStreamPlayer:
	var s: AudioStreamWAV = _streams[n].duplicate()
	s.loop_mode = AudioStreamWAV.LOOP_FORWARD
	s.loop_begin = 0
	s.loop_end = s.get_length() * s.mix_rate
	var p := AudioStreamPlayer.new()
	p.stream = s
	p.volume_db = db
	add_child(p)
	return p


## Browsers start audio only after a tap or a key; the game calls this from its first input.
func start() -> void:
	if not _hum.playing:
		_hum.play()
		_danger.play()


func toggle() -> void:
	muted = not muted
	DeepStore.set_item("deep.muted", "1" if muted else "0")
	_apply_mute()


func _apply_mute() -> void:
	AudioServer.set_bus_mute(0, muted)


func _play(n: String, pitch := 1.0, db := 0.0) -> void:
	for p in _pool:
		if not p.playing:
			p.stream = _streams[n]
			p.pitch_scale = pitch
			p.volume_db = db
			p.play()
			return


## ratio: prey size over yours; smaller prey squeaks higher (300–800 Hz in the web version, 550 Hz recorded).
func gulp(ratio: float) -> void:
	_play("gulp", (300.0 + 500.0 * (1.0 - clampf(ratio, 0, 1))) / 550.0)


func dash() -> void: _play("dash")
func stage() -> void: _play("stage")
func eaten() -> void: _play("eaten")
func zone(z: int) -> void: _play("zone", 1.0 / (1.0 + z * 0.25))
func discover() -> void: _play("discover")
func whale() -> void: _play("whale")
func legend() -> void: _play("legend")


## k: 0 calm .. 1 chased.
func set_danger(k: float) -> void:
	_danger.volume_db = linear_to_db(maxf(k * 0.12 * 0.55 / 0.9, 0.00001))
