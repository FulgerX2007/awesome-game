class_name Art
extends RefCounted
## Loads each model once and hands out instances or meshes. Keys are "<pack>/<file>" without the extension,
## e.g. "hexagon/tree_single_A" or "dungeon/chest". Shared materials live here too, so every scene that wants
## "stone" or "glow" gets the same resource instead of a new one per node.

static var _scenes := {}
static var _meshes := {}
static var _materials := {}


static func path(key: String) -> String:
	return "res://assets/models/%s.%s" % [key, "gltf" if key.begins_with("hexagon/") else "glb"]


static func scene(key: String) -> PackedScene:
	if not _scenes.has(key):
		_scenes[key] = load(path(key))
	return _scenes[key]


static func instance(key: String) -> Node3D:
	var s := scene(key)
	return s.instantiate() if s else Node3D.new()


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
	l.font = load("res://assets/fonts/GolosText.ttf")
	l.font_size = size
	l.pixel_size = 0.01
	l.modulate = color
	l.outline_size = 14
	l.outline_modulate = Color(0.12, 0.1, 0.2)
	l.double_sided = false
	return l
