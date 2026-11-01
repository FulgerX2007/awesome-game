extends Node
## Autoload Sfx: plays the short sounds and the music loop. Streams are loaded once at start, players are
## pooled, and the same sound is not restarted more than once per 50 ms, so a burst of events stays pleasant.

const NAMES := ["jump", "land", "collect", "gem", "correct", "wrong", "hint", "click", "open", "place", "pop",
	"power", "fizzle", "splash", "respawn", "checkpoint", "warn", "slam", "hurt", "shield", "rumble", "victory", "step"]
const POOL := 8

var _streams := {}
var _players: Array[AudioStreamPlayer] = []
var _next := 0
var _last := {}
var _music: AudioStreamPlayer


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS  # menus make sounds while the game is paused
	for n in NAMES:
		_streams[n] = load("res://assets/audio/%s.wav" % n)
	for i in POOL:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)
	_music = AudioStreamPlayer.new()
	var m: AudioStreamWAV = load("res://assets/audio/music.wav")
	m.loop_mode = AudioStreamWAV.LOOP_FORWARD
	m.loop_end = m.data.size() / 2  # 16-bit mono: two bytes a frame
	_music.stream = m
	add_child(_music)
	ProgressManager.settings_changed.connect(_apply_volume)
	_apply_volume()


func play(name: String, pitch := 1.0) -> void:
	var s: AudioStream = _streams.get(name)
	if s == null:
		push_warning("Sfx: no sound %s" % name)
		return
	var now := Time.get_ticks_msec()
	if now - int(_last.get(name, -1000)) < 50:
		return
	_last[name] = now
	var p := _players[_next]
	_next = (_next + 1) % POOL
	p.stream = s
	p.pitch_scale = pitch
	p.volume_db = _db(ProgressManager.settings.sfx)
	p.play()


func music(on: bool) -> void:
	if on and not _music.playing:
		_music.play()
	elif not on:
		_music.stop()


func _apply_volume() -> void:
	_music.volume_db = _db(ProgressManager.settings.music) - 6.0


static func _db(v: float) -> float:
	return -80.0 if v <= 0.01 else linear_to_db(v)
