class_name CastleFlipbook
extends Sprite3D
## A billboarded flipbook from the Ember Flipbooks sheets (assets/ember, made by tools/castle-godot/ember.py).
## Those files are licensed for the built game only and kept out of the public repository, so every caller
## asks available() first and keeps its own particles as the fallback.
##   var fb := CastleFlipbook.make("explosion_fireball", 4.0)   # null without the sheets
##   if fb: add_child(fb)
## A one-shot frees itself after its last frame; a loop runs until freed or hidden.

const DIR := "res://assets/ember/"

static var _meta = null
static var _tex := {}
static var _mats := {}

var id := ""
var fps := 15.0
var count := 1
var loop := false
var t := 0.0


static func meta() -> Dictionary:
	if _meta == null:
		_meta = {}
		if FileAccess.file_exists(DIR + "ember.json"):
			var d = JSON.parse_string(FileAccess.get_file_as_string(DIR + "ember.json"))
			if d is Dictionary:
				for k in d:
					if ResourceLoader.exists(DIR + k + ".png"):
						_meta[k] = d[k]
	return _meta


static func available(effect: String) -> bool:
	return meta().has(effect)


## A flipbook `size` metres across, or null when the sheet isn't there. start_random makes loops of the
## same effect not flicker in step.
static func make(effect: String, size: float, start_random := false) -> CastleFlipbook:
	if not available(effect):
		return null
	var m: Dictionary = meta()[effect]
	var f := CastleFlipbook.new()
	f.id = effect
	f.count = int(m.frames)
	f.fps = float(m.fps)
	f.loop = bool(m.loop)
	f.texture = _texture(effect)
	f.hframes = int(m.columns)
	f.vframes = int(m.rows)
	f.pixel_size = size / 128.0
	f.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	f.shaded = false
	f.double_sided = true
	f.alpha_cut = SpriteBase3D.ALPHA_CUT_DISABLED
	f.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	f.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	f.no_depth_test = false
	if start_random and f.loop:
		f.t = randf() * f.count / f.fps
	f.frame = 0
	return f


static func _texture(effect: String) -> Texture2D:
	if not _tex.has(effect):
		_tex[effect] = load(DIR + effect + ".png")
	return _tex[effect]


func _process(delta: float) -> void:
	if not visible:
		return
	t += delta
	var i := int(t * fps)
	if i >= count:
		if loop:
			i %= count
		else:
			queue_free()
			return
	frame = i
