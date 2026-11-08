class_name WinterAnimSprite
extends Node2D
## A character from an animation sheet (assets/manifest, key like "char.hero"): a Sprite2D whose texture carries the
## normal map (so the fire lights the figure), plus an optional tinted clothes layer of the same layout. Animations
## are named "<anim>_<dir>" with dir down / up / side; side faces right and is mirrored for left. A missing
## animation falls back along FALLBACK, then to any animation of the same direction, then to a still frame.

const FALLBACK := {
	"chop": "work", "mine": "work", "gather": "work", "build": "work", "craft": "work", "fire": "work",
	"work": "idle", "hurt": "idle", "death": "idle", "sleep": "idle", "hop": "walk", "run": "walk",
	"bite": "idle", "swipe": "idle", "walk": "idle",
}

var key := ""
var anims := {}
var body: Sprite2D
var tint: Sprite2D
var anim := ""
var dir := "down"
var flip := false
var time := 0.0
var speed := 1.0
var done := false           # a non-looping animation reached its last frame
var _cur := {}
var _cols := 1


func setup(sheet_key: String, tint_color := Color(0, 0, 0, 0)) -> void:
	key = sheet_key
	var e := WinterArt.entry(key)
	anims = e.get("anims", {})
	body = WinterArt.sprite(key)
	add_child(body)
	var frame = e.get("frame", null)
	if frame is Array and body.texture:
		var tw := body.texture.get_width()
		_cols = maxi(1, int(tw / float(frame[0])))
		body.hframes = _cols
		body.vframes = maxi(1, int(body.texture.get_height() / float(frame[1])))
	var layers = e.get("layers", {})
	if layers is Dictionary and layers.has("tint") and tint_color.a > 0.0:
		tint = Sprite2D.new()
		tint.texture = WinterArt.tex(layers.tint)
		tint.centered = false
		tint.offset = body.offset
		tint.hframes = body.hframes
		tint.vframes = body.vframes
		tint.modulate = tint_color
		add_child(tint)
	play("idle", "down")


func has_anim(name: String) -> bool:
	return anims.has(name)


## Starts an animation unless it is already playing. `restart` replays it from the first frame.
func play(name: String, d: String, restart := false) -> void:
	var dd := d
	flip = false
	if dd == "left":
		dd = "side"
		flip = true
	elif dd == "right":
		dd = "side"
	var full := _chain(name, dd)
	if full == "" and dd != "side":
		# no such animation facing this way: the same one from the side
		full = _chain(name, "side")
	if full == "":
		full = _resolve(name, dd)
	if full == anim and dir == dd and not restart:
		_apply_flip()
		return
	anim = full
	dir = dd
	time = 0.0
	done = false
	_cur = anims.get(full, {})
	_apply_flip()
	_show(0)


## The animation or its fallbacks (FALLBACK) in one direction, or "".
func _chain(name: String, d: String) -> String:
	var n := name
	for k in 6:
		if anims.has("%s_%s" % [n, d]):
			return "%s_%s" % [n, d]
		if not FALLBACK.has(n):
			return ""
		n = FALLBACK[n]
	return ""


func _resolve(name: String, d: String) -> String:
	var n := name
	for k in 6:
		if anims.has("%s_%s" % [n, d]):
			return "%s_%s" % [n, d]
		if not FALLBACK.has(n):
			break
		n = FALLBACK[n]
	for a in anims:
		if String(a).ends_with("_" + d):
			return a
	return ""


func _apply_flip() -> void:
	if body:
		body.flip_h = flip
		# mirroring around the foot, not the texture's corner
		var f := WinterArt.foot(key)
		var w := WinterArt.size(key).x
		body.offset = Vector2(-(w - f.x) if flip else -f.x, -f.y)
	if tint:
		tint.flip_h = flip
		tint.offset = body.offset


func _process(delta: float) -> void:
	if _cur.is_empty():
		return
	time += delta * speed
	var count := int(_cur.get("count", 1))
	var fps := float(_cur.get("fps", 8))
	var i := int(time * fps)
	if bool(_cur.get("loop", true)):
		i %= maxi(1, count)
	else:
		if i >= count - 1:
			done = true
		i = mini(i, count - 1)
	_show(i)


func _show(i: int) -> void:
	if _cur.is_empty() or body == null:
		return
	var row := int(_cur.get("row", 0))
	var col := int(_cur.get("from", 0)) + i
	var idx := row * _cols + col
	if idx < body.hframes * body.vframes:
		body.frame = idx
		if tint:
			tint.frame = idx
