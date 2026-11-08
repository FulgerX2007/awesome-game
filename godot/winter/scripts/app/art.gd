class_name WinterArt
extends RefCounted
## Sprites by key. The asset generators (tools/winter-godot/art) write assets/manifest/*.json: key → file, normal map,
## size, foot (the ground contact pixel), shadow, animation sheets. The game asks only by key (see
## tools/winter-godot/ASSETS.md). A key with no art yet gets a soft placeholder, so every stage of the work runs.

const DIR := "res://assets/manifest"

static var _m := {}
static var _loaded := false
static var _tex := {}       # path -> Texture2D
static var _canvas := {}    # key -> CanvasTexture (colour + normal map)
static var _ph := {}        # key -> placeholder entry
static var _counts := {}    # prefix -> number of variants


static func manifest() -> Dictionary:
	if not _loaded:
		_loaded = true
		# the generated groups first, then override_* fragments (painted art) on top; an override's "_replace"
		# lists groups whose generated keys go first, so no generated variant is left mixed in
		var files := Array(DirAccess.get_files_at(DIR)).filter(func(f): return String(f).ends_with(".json"))
		files.sort_custom(func(x, y): return (int(String(x).begins_with("override_")) * 1000 - int(String(y).begins_with("override_")) * 1000) + (-1 if String(x) < String(y) else 1) < 0)
		for f in files:
			var d = JSON.parse_string(FileAccess.get_file_as_string(DIR + "/" + f))
			if not d is Dictionary:
				continue
			for prefix in d.get("_replace", []):
				for k in _m.keys():
					if k == prefix or String(k).begins_with(String(prefix) + "."):
						_m.erase(k)
			d.erase("_replace")
			_m.merge(d, true)
	return _m


static func has(key: String) -> bool:
	return manifest().has(key)


## The manifest entry of a key, or a placeholder entry.
static func entry(key: String) -> Dictionary:
	var m := manifest()
	if m.has(key):
		return m[key]
	if not _ph.has(key):
		_ph[key] = _placeholder(key)
	return _ph[key]


## How many variants `prefix.0`, `prefix.1`, … exist (at least 1: a placeholder stands in).
static func variants(prefix: String) -> int:
	if not _counts.has(prefix):
		var n := 0
		while has("%s.%d" % [prefix, n]):
			n += 1
		_counts[prefix] = maxi(1, n)
	return _counts[prefix]


static func tex(path: String) -> Texture2D:
	if path == "":
		return null
	if not _tex.has(path):
		_tex[path] = load(path) if ResourceLoader.exists(path) else null
	return _tex[path]


## The colour texture of a key, with its normal map when it has one (lights then shade its volume).
static func texture(key: String, with_normal := true) -> Texture2D:
	var e := entry(key)
	if e.has("_image"):
		return e._image
	var path: String = e.get("file", e.get("sheet", ""))
	var color := tex(path)
	if not with_normal or not e.has("normal") or e.normal == null:
		return color
	if not _canvas.has(key):
		var ct := CanvasTexture.new()
		ct.diffuse_texture = color
		ct.normal_texture = tex(e.normal)
		_canvas[key] = ct
	return _canvas[key]


## The ground contact pixel of a key: Sprite2D.offset = -foot puts it on the node's position.
static func foot(key: String) -> Vector2:
	var e := entry(key)
	var f = e.get("foot", null)
	if f is Array and f.size() == 2:
		return Vector2(f[0], f[1])
	var s = e.get("frame", e.get("size", [96, 96]))
	return Vector2(s[0] * 0.5, s[1] - 4)


static func size(key: String) -> Vector2:
	var e := entry(key)
	var s = e.get("frame", e.get("size", [96, 96]))
	return Vector2(s[0], s[1])


## A sprite node for a key, its foot on (0, 0). `variant` picks prefix.N for keys with variants.
static func sprite(key: String) -> Sprite2D:
	var s := Sprite2D.new()
	s.texture = texture(key)
	s.centered = false
	s.offset = -foot(key)
	return s


## The key's soft cast shadow as a sprite (or null), its foot on (0, 0).
static func shadow(key: String) -> Sprite2D:
	var e := entry(key)
	var sh = e.get("shadow", null)
	if not sh is Dictionary:
		return null
	var s := Sprite2D.new()
	s.texture = tex(sh.file)
	if s.texture == null:
		return null
	s.centered = false
	var f = sh.get("foot", [0, 0])
	s.offset = -Vector2(f[0], f[1])
	return s


## Nine-slice margins of a UI texture ([l, t, r, b]) or [] when the key has none.
static func slice(key: String) -> Array:
	var s = entry(key).get("slice", [])
	return s if s is Array else []


## ── Placeholders: soft shaded shapes in the palette's colours, so a missing sprite still reads ──

const _PH_COLOR := {
	"tree": Color("2f6457"), "rock": Color("8a90a3"), "bush": Color("4c6f4a"), "scrap": Color("a5552f"),
	"snow": Color("dfe9f6"), "ice": Color("9fd3ee"), "hut": Color("7a4f30"), "palisade": Color("7a4f30"),
	"bench": Color("b07a48"), "firepit": Color("6c7286"), "bunk": Color("b07a48"), "up": Color("7a5638"),
	"torch": Color("5e3f2d"), "trader": Color("a83a32"), "stock": Color("b07a48"), "char": Color("a83a32"),
	"animal": Color("8f96a6"), "fx": Color("ffd36a"), "ui": Color("cfe6ff"), "ground": Color("6a5646"),
	"track": Color("9fb3d6"), "foot": Color("9fb3d6"), "log": Color("7a4f30"), "branch": Color("5e3f2d"),
	"snare": Color("8a6248"),
}

const _PH_SIZE := {
	"tree": Vector2(150, 220), "rock": Vector2(92, 70), "bush": Vector2(84, 66), "scrap": Vector2(84, 50),
	"hut": Vector2(288, 230), "palisade": Vector2(96, 110), "bench": Vector2(96, 70), "firepit": Vector2(90, 50),
	"bunk": Vector2(90, 60), "up": Vector2(100, 90), "torch": Vector2(24, 100), "trader": Vector2(190, 110),
	"char": Vector2(96, 132), "animal": Vector2(96, 70), "ui": Vector2(128, 128),
}


static func _placeholder(key: String) -> Dictionary:
	var kind := key.get_slice(".", 0)
	var c: Color = _PH_COLOR.get(kind, Color("c3d3ea"))
	var sz: Vector2 = _PH_SIZE.get(kind, Vector2(64, 48))
	if key.begins_with("char.villager"):
		c = Color("3c5f8f")
	if key.begins_with("animal.bear"):
		c = Color("5a4032")
		sz = Vector2(150, 100)
	if key.begins_with("animal.rabbit"):
		c = Color("eef0f4")
		sz = Vector2(40, 34)
	var w := int(sz.x)
	var h := int(sz.y)
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	var light := Vector3(-0.55, -0.65, 0.52).normalized()
	for y in h:
		for x in w:
			# an upright ellipsoid sitting on the bottom edge
			var u := (x + 0.5) / w * 2.0 - 1.0
			var v := (y + 0.5) / h * 2.0 - 1.0
			var r2 := u * u + v * v
			if r2 > 1.0:
				continue
			var n := Vector3(u, v, sqrt(1.0 - r2))
			var k := clampf(0.45 + 0.75 * maxf(0.0, n.dot(light)), 0.0, 1.25)
			var a := clampf((1.0 - r2) * 12.0, 0.0, 1.0)
			img.set_pixel(x, y, Color(c.r * k, c.g * k, c.b * k, a))
	var e := {"size": [w, h], "foot": [w * 0.5, h - 2], "_image": ImageTexture.create_from_image(img), "placeholder": true}
	return e
