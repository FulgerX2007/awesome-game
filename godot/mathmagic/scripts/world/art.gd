class_name Art
extends RefCounted
## Loads each model once and hands out instances or meshes. Keys are "<pack>/<file>" without the extension,
## e.g. "hexagon/tree_single_A" or "dungeon/chest". Shared materials live here too, so every scene that wants
## "stone" or "glow" gets the same resource instead of a new one per node.

## The heroes a child can play (KayKit Adventurers 2.0). They share one skeleton, Rig_Medium, so one
## animation library drives all six. Names are translation keys.
const HEROES := [
	{id = "mage", model = "heroes/Mage", name = "Mage"},
	{id = "knight", model = "heroes/Knight", name = "Knight"},
	{id = "ranger", model = "heroes/Ranger", name = "Ranger"},
	{id = "barbarian", model = "heroes/Barbarian", name = "Barbarian"},
	{id = "rogue", model = "heroes/Rogue", name = "Rogue"},
	{id = "rogue_hooded", model = "heroes/Rogue_Hooded", name = "Hooded Rogue"},
]
## The rig's animation files; together they hold idle, run, jump, hit, interact and use clips.
const HERO_ANIMATIONS := ["heroes/Rig_Medium_General", "heroes/Rig_Medium_MovementBasic"]
## Clips that repeat. Everything else plays once.
const HERO_LOOPS := ["Idle_A", "Idle_B", "Running_A", "Running_B", "Walking_A", "Jump_Idle", "Jump_Full_Short"]

static var _scenes := {}
static var _hero_lib: AnimationLibrary
static var _meshes := {}
static var _materials := {}


## The game font (Golos Text) with a tiny DejaVu Sans subset behind it for ● ◆ ♥ ✦ ★, which browsers do not
## supply as system fallbacks. The same resource is the project's default GUI font, so this covers every Label.
static func font() -> Font:
	var f: FontFile = load("res://assets/fonts/GolosText.ttf")
	if f.fallbacks.is_empty():
		f.fallbacks = [load("res://assets/fonts/Symbols.ttf")]
	return f


static func path(key: String) -> String:
	return "res://assets/models/%s.%s" % [key, "gltf" if key.begins_with("hexagon/") else "glb"]


static func scene(key: String) -> PackedScene:
	if not _scenes.has(key):
		_scenes[key] = load(path(key))
	return _scenes[key]


static func instance(key: String) -> Node3D:
	var s := scene(key)
	return s.instantiate() if s else Node3D.new()


static func hero_ids() -> Array:
	return HEROES.map(func(h): return h.id)


static func hero_info(id: String) -> Dictionary:
	for h in HEROES:
		if h.id == id:
			return h
	return HEROES[0]


## A hero model with an AnimationPlayer holding the shared rig animations, ready to play.
static func hero(id: String) -> Node3D:
	var n := instance(hero_info(id).model)
	var ap := AnimationPlayer.new()
	ap.name = "AnimationPlayer"
	n.add_child(ap)
	ap.add_animation_library("", _hero_animations())
	return n


static func _hero_animations() -> AnimationLibrary:
	if _hero_lib == null:
		_hero_lib = AnimationLibrary.new()
		for key in HERO_ANIMATIONS:
			var rig := instance(key)
			var src: AnimationPlayer = rig.find_child("AnimationPlayer", true, false)
			if src:
				for name in src.get_animation_list():
					if name != "T-Pose" and not _hero_lib.has_animation(name):
						var a: Animation = src.get_animation(name).duplicate()
						a.loop_mode = Animation.LOOP_LINEAR if HERO_LOOPS.has(name) else Animation.LOOP_NONE
						_hero_lib.add_animation(name, a)
			rig.free()
	return _hero_lib


## The first mesh of a model, for MultiMesh tiles and other single-mesh pieces.
static func mesh(key: String) -> Mesh:
	if not _meshes.has(key):
		var n := instance(key)
		var mi := _find_mesh(n)
		_meshes[key] = mi.mesh if mi else BoxMesh.new()
		n.free()
	return _meshes[key]


static func _find_mesh(n: Node) -> MeshInstance3D:
	if n is MeshInstance3D:
		return n
	for c in n.get_children():
		var m := _find_mesh(c)
		if m:
			return m
	return null


## The model's own material with its color multiplied by tint (greener grass, deeper sea), shared per key.
static func tinted(key: String, tint: Color) -> Material:
	var k := "tint/%s/%s" % [key, tint.to_html()]
	if not _materials.has(k):
		var src := mesh(key).surface_get_material(0)
		var m: StandardMaterial3D = src.duplicate() if src is StandardMaterial3D else StandardMaterial3D.new()
		m.albedo_color = m.albedo_color * tint
		_materials[k] = m
	return _materials[k]


## A flat, slightly rough material in the island palette. glow > 0 adds emission of the same color.
static func material(color: Color, glow := 0.0, alpha := 1.0) -> StandardMaterial3D:
	var k := "%s/%s/%s" % [color.to_html(), glow, alpha]
	if not _materials.has(k):
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(color, alpha)
		m.roughness = 0.85
		if glow > 0.0:
			m.emission_enabled = true
			m.emission = color
			m.emission_energy_multiplier = glow
		if alpha < 1.0:
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.cull_mode = BaseMaterial3D.CULL_DISABLED
		_materials[k] = m
	return _materials[k]


## One magic counting stone: a single chunky low-poly pebble, so "3" on screen is three things to count.
## The same stone is collected, shown on pedestals and built into bridges.
static func counting_stone(size := 1.0) -> MeshInstance3D:
	if not _meshes.has("counting_stone"):
		var sm := SphereMesh.new()
		sm.radius = 0.2
		sm.height = 0.3
		sm.radial_segments = 7
		sm.rings = 3
		_meshes["counting_stone"] = sm
	var m := MeshInstance3D.new()
	m.mesh = _meshes["counting_stone"]
	m.material_override = material(STONE_COLOR, 0.35)
	m.scale = Vector3.ONE * size
	return m


const STONE_COLOR := Color("#6f8dff")


## A Label3D in the game font, readable from the gameplay camera.
static func label(text: String, size := 64, color := Color.WHITE) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.font = font()
	l.font_size = size
	l.pixel_size = 0.01
	l.modulate = color
	l.outline_size = 14
	l.outline_modulate = Color(0.12, 0.1, 0.2)
	l.double_sided = false
	return l
