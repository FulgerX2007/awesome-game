@tool
class_name Ground
extends StaticBody3D
## A strip of island made of hex tiles: grass on top, earth below, a box collider for the walkable top.
## The local origin is the top of the first tile's center; the strip runs to the right along +X.
## Tiles are 2 wide, 1 high. Rows go into the depth (Z); the player walks on the middle row at z = 0.

@export_range(1, 60) var length := 4:
	set(v):
		length = v
		_queue_build()
@export_range(1, 6) var rows := 3:
	set(v):
		rows = v
		_queue_build()
## hex: island ground of hex tiles. island: a floating grass platform (Kenney Mini Forest), one per tile.
## terrain: one sculpted piece (Terrain): rounded grass top with a worn path, layered rock sides.
@export_enum("hex", "island", "terrain") var style := "hex":
	set(v):
		style = v
		_queue_build()
@export_range(1, 8) var height := 3:
	set(v):
		height = v
		_queue_build()

## terrain only: how much the rock narrows toward the bottom (0 straight sides, 1 a wedge), for floating ledges.
@export_range(0.0, 1.0) var taper := 0.0:
	set(v):
		taper = v
		_queue_build()
## terrain only: the collision box's height when it should be thinner than the drawn rock (0 = the full
## height). A floating ledge is drawn deep but must not block jumps from below.
@export var solid := 0.0

const TILE_W := 2.0
const ROW_Z := 1.732
const GRASS_TINT := Color(0.62, 0.9, 0.55)
const ISLAND_SCALE := Vector3(2.0, 2.0, 2.1)   # the Kenney platform is 1 x 0.47 x 1, its top at 0.47
const ISLAND_TOP := 0.47

var _dirty := false


func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	_build()


func _queue_build() -> void:
	if not is_inside_tree() or _dirty:
		return
	_dirty = true
	_build.call_deferred()


func _build() -> void:
	_dirty = false
	for c in get_children():
		if c.has_meta("generated"):
			c.free()
	if style == "island":
		_build_islands()
		return
	if style == "terrain":
		_build_terrain()
		return
	var top := []
	var below := []
	var mid := (rows - 1) / 2.0
	for r in rows:
		var shift := 1.0 if int(abs(r - mid)) % 2 == 1 else 0.0
		var z := (r - mid) * ROW_Z
		var n := length - (1 if shift > 0.0 else 0)
		for i in n:
			var x := i * TILE_W + shift
			top.append(Vector3(x, 0, z))
			for h in range(1, height):
				below.append(Vector3(x, -h, z))
	_add_multimesh("hexagon/hex_grass", top, GRASS_TINT)
	_add_multimesh("hexagon/hex_grass_bottom", below, Color.WHITE)
	var col := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(length * TILE_W, height, maxf(rows, 1) * ROW_Z + 0.6)
	col.shape = box
	col.position = Vector3((length - 1) * TILE_W / 2.0, -height / 2.0, 0)
	col.set_meta("generated", true)
	add_child(col)


func _depth() -> float:
	return maxf(rows, 1) * ROW_Z + 0.6


func _build_terrain() -> void:
	var d := _depth()
	var x0 := -TILE_W / 2.0
	var x1 := (length - 0.5) * TILE_W
	var mi := MeshInstance3D.new()
	var seed := int(global_position.x * 10.0 + global_position.y * 1000.0)
	mi.mesh = Terrain.build(x0, x1, -d / 2.0 - 0.3, d / 2.0, float(height), seed, taper)
	mi.set_meta("generated", true)
	add_child(mi)
	var h := float(height) if solid <= 0.0 else solid
	_add_box(Vector3(length * TILE_W, h, d), Vector3((length - 1) * TILE_W / 2.0, -h / 2.0, 0))
	if height >= 4 and not Engine.is_editor_hint():
		_dress_cliff(x0, x1, d / 2.0, seed)


## Big rounded boulders (KayKit Forest) along the foot of a high piece's front face, so it reads as a cliff
## standing on a scree of rocks rather than one carved wall. They stay well below the rim, where nothing walks.
func _dress_cliff(x0: float, x1: float, z_front: float, seed: int) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var tall := ["Rock_3_K", "Rock_3_L", "Rock_3_M", "Rock_3_N", "Rock_3_O", "Rock_3_P"]   # rounded boulders
	var x := x0 + rng.randf_range(0.4, 1.0)
	while x < x1 - 0.4:
		var r := Art.instance("kaykit_forest/%s_Color1" % tall[rng.randi() % tall.size()])
		var s := clampf((height - 1.2) / 3.6, 0.7, 1.8) * rng.randf_range(0.75, 1.0)
		r.scale = Vector3(s * rng.randf_range(0.85, 1.1), s, s * 0.5)
		r.position = Vector3(x, -height + 0.6 * s, z_front - 0.3)
		r.rotation.y = rng.randf_range(-0.5, 0.5)
		r.set_meta("generated", true)
		add_child(r)
		x += rng.randf_range(1.5, 2.4) * s


func _add_box(size: Vector3, at: Vector3) -> void:
	var col := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	col.shape = box
	col.position = at
	col.set_meta("generated", true)
	add_child(col)


func _build_islands() -> void:
	for i in length:
		var n := Art.instance("kenney_forest/platform")
		n.scale = ISLAND_SCALE
		n.position = Vector3(i * TILE_W, -ISLAND_TOP * ISLAND_SCALE.y, 0)
		n.set_meta("generated", true)
		add_child(n)
	var col := CollisionShape3D.new()
	var box := BoxShape3D.new()
	var h := ISLAND_TOP * ISLAND_SCALE.y
	box.size = Vector3(length * TILE_W - 0.1, h, 1.9)
	col.shape = box
	col.position = Vector3((length - 1) * TILE_W / 2.0, -h / 2.0, 0)
	col.set_meta("generated", true)
	add_child(col)


func _add_multimesh(key: String, points: Array, tint: Color) -> void:
	if points.is_empty():
		return
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = Art.mesh(key)
	mm.instance_count = points.size()
	for i in points.size():
		mm.set_instance_transform(i, Transform3D(Basis(), points[i]))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	if tint != Color.WHITE:
		mmi.material_override = Art.tinted(key, tint)
	mmi.set_meta("generated", true)
	add_child(mmi)


## World-space x of the strip's left and right walkable edges.
func left_x() -> float:
	return global_position.x - TILE_W / 2.0


func right_x() -> float:
	return global_position.x + (length - 0.5) * TILE_W
