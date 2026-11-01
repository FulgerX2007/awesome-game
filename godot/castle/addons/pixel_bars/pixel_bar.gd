@tool
class_name PixelBar
extends TextureProgressBar
## A TextureProgressBar dressed from the kit: pick a shape, a frame style and a fill, and it takes
## their textures and 9-slice margins. On top of TextureProgressBar it does what a game's bar does:
## the fill runs over the track only, so a boss bar's plate never eats its low values; when the
## value drops the fill flashes and a pale trail holds where it was, then drains to it; at or below
## `low` the fill pulses; `segments` marks the track in equal parts; an orb's liquid shows its
## surface.
##
##     var hp := PixelBar.new()
##     hp.style = "wood"
##     hp.fill = "health"
##     hp.custom_minimum_size = Vector2(96, 12)
##     add_child(hp)
##     hp.value -= 25  # flashes, and the trail drains
##
## The bar draws its frame as texture_under; the fill and the trail are two inner bars over it,
## kept out of the scene file.

enum Shape { BAR, THIN, VERTICAL, BOSS, ORB, RING }

const KIT := "res://addons/pixel_bars/"
const FILES := ["bar", "thin", "vbar", "boss", "orb", "ring"]
## The stretching shapes' 9-slice margins (left, top, right, bottom), as tools/ui_bars.py draws them.
const MARGINS := {Shape.BAR: [4, 4, 4, 4], Shape.THIN: [2, 2, 2, 2], Shape.VERTICAL: [4, 4, 4, 4], Shape.BOSS: [17, 6, 5, 6]}
## Where the fill runs inside the frame (left, top, right, bottom); the orb's is its liquid's height.
const TRACK := {Shape.BAR: [3, 3, 3, 3], Shape.THIN: [1, 1, 1, 1], Shape.VERTICAL: [3, 3, 3, 3], Shape.BOSS: [16, 5, 3, 5], Shape.ORB: [0, 4, 0, 4]}
const LIQUID := 11.9  # the orb's liquid: its radius round the centre of its 32x32
const FLASH_TIME := 0.25

@export var shape := Shape.BAR:
	set(v):
		shape = v
		_dress()
## A folder of frames/: stone, wood, sky, forest, royal, ember, gilded or cyan.
@export var style := "wood":
	set(v):
		style = v
		_dress()
## A folder of fills/: health, mana, stamina, xp, shield, rage, magic or poison.
@export var fill := "health":
	set(v):
		fill = v
		_dress()
## Marks the track in this many equal parts (0 or 1: none). Not on orbs and rings.
@export_range(0, 64) var segments := 0:
	set(v):
		segments = v
		_fill.queue_redraw()
@export_group("Feel")
## On a drop, a pale trail holds where the value was, then drains to it.
@export var trail := true
## Seconds the trail holds before it drains.
@export var trail_hold := 0.4
## The share of the bar the trail drains per second.
@export var trail_speed := 0.8
@export var trail_color := Color(1, 1, 1)
## On a drop, the fill flashes white.
@export var flash := true
## The fill pulses at or below this share of the bar (0: never).
@export_range(0.0, 1.0) var low := 0.0

var _trail_bar := TextureProgressBar.new()
var _fill := TextureProgressBar.new()
var _last := 0.0
var _trail := 0.0
var _hold := 0.0
var _flash := 0.0
var _clock := 0.0


func _init() -> void:
	step = 0.0
	value = max_value
	for b: TextureProgressBar in [_trail_bar, _fill]:
		b.max_value = 1.0
		b.step = 0.0
		b.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(b, false, Node.INTERNAL_MODE_FRONT)
		b.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_fill.draw.connect(_draw_on_fill)
	_dress()


func _ready() -> void:
	settle()


## Puts the trail where the value is and stops a flash: for a bar shown afresh.
func settle() -> void:
	_last = value
	_trail = value
	_hold = 0.0
	_flash = 0.0
	_process(0.0)


func _dress() -> void:
	var file: String = FILES[shape]
	var stretch := shape in MARGINS
	var mode: int = {Shape.VERTICAL: FILL_BOTTOM_TO_TOP, Shape.ORB: FILL_BOTTOM_TO_TOP, Shape.RING: FILL_CLOCKWISE}.get(shape, FILL_LEFT_TO_RIGHT)
	for b: TextureProgressBar in [self, _trail_bar, _fill]:
		b.nine_patch_stretch = stretch
		b.fill_mode = mode
		if stretch:
			var m: Array = MARGINS[shape]
			b.stretch_margin_left = m[0]
			b.stretch_margin_top = m[1]
			b.stretch_margin_right = m[2]
			b.stretch_margin_bottom = m[3]
	texture_under = _texture("frames/%s/%s.png" % [style, file])
	_trail_bar.texture_progress = _texture("fills/trail/%s.png" % file)
	_fill.texture_progress = _texture("fills/%s/%s.png" % [fill, file])
	_fill.texture_over = _texture("fills/glint.png") if shape == Shape.ORB else null
	_process(0.0)


## Null when the kit leaves the file out (the free sampler has fewer styles and fills).
static func _texture(path: String) -> Texture2D:
	return load(KIT + path) if ResourceLoader.exists(KIT + path) else null


func _value_changed(new_value: float) -> void:
	if new_value < _last and not Engine.is_editor_hint():
		_trail = maxf(_trail, _last)
		_hold = trail_hold
		if flash:
			_flash = 1.0
	_last = new_value


## TextureProgressBar clips a 9-slice fill over the whole rect, frame included; this maps a share
## of the bar onto its track.
func _on_track(share: float) -> float:
	if not shape in TRACK:
		return share
	var t: Array = TRACK[shape]
	var vertical := shape in [Shape.VERTICAL, Shape.ORB]
	var whole := (size.y if vertical else size.x) if shape in MARGINS else 32.0
	var start: float = t[3] if vertical else t[0]
	var end: float = t[1] if vertical else t[2]
	if share <= 0.0 or whole <= start + end:
		return 0.0
	return (start + share * (whole - start - end)) / whole


func _process(delta: float) -> void:
	_clock += delta
	if Engine.is_editor_hint():
		_trail = value
	if _hold > 0.0:
		_hold -= delta
	else:
		_trail = maxf(value, _trail - trail_speed * (max_value - min_value) * delta)
	_trail = maxf(_trail, value)
	_flash = maxf(0.0, _flash - delta / FLASH_TIME)
	var pulse := 0.0
	if low > 0.0 and ratio <= low and ratio > 0.0:
		pulse = 0.5 + 0.5 * sin(_clock * TAU * 1.5)
	var k := 1.0 + 2.5 * _flash + 0.6 * pulse  # above 1 lights the fill toward white
	_fill.tint_progress = Color(k, k, k)
	_fill.value = _on_track(ratio)
	var span := max_value - min_value
	_trail_bar.value = _on_track((_trail - min_value) / span if trail and span > 0.0 else 0.0)
	_trail_bar.tint_progress = trail_color
	if shape == Shape.ORB or segments > 1:
		_fill.queue_redraw()


func _draw_on_fill() -> void:
	var tex := _fill.texture_progress
	if shape == Shape.ORB and tex and ratio > 0.0 and ratio < 1.0:
		var y := ceilf(32.0 - 32.0 * _fill.value)
		var dy := y + 0.5 - 16.0
		if absf(dy) < LIQUID:
			var half := sqrt(LIQUID * LIQUID - dy * dy)
			var x0 := ceilf(16.0 - half)
			var row := Rect2(x0, y, floorf(16.0 + half) - x0, 1)
			var k := 1.8 + 2.5 * _flash
			_fill.draw_texture_rect_region(tex, row, row, Color(k, k, k))
	if segments > 1 and shape in MARGINS:
		var t: Array = TRACK[shape]
		var inner := Rect2(t[0], t[1], size.x - t[0] - t[2], size.y - t[1] - t[3])
		var mark := Color(0, 0, 0, 0.55)
		for i in range(1, segments):
			if shape == Shape.VERTICAL:
				_fill.draw_rect(Rect2(inner.position.x, inner.end.y - roundf(inner.size.y * i / segments), inner.size.x, 1), mark)
			else:
				_fill.draw_rect(Rect2(inner.position.x + roundf(inner.size.x * i / segments), inner.position.y, 1, inner.size.y), mark)
