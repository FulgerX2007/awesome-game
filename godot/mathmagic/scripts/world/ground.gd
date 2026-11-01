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
@export_range(1, 8) var height := 3:
	set(v):
		height = v
		_queue_build()

const TILE_W := 2.0
const ROW_Z := 1.732
const GRASS_TINT := Color(0.62, 0.9, 0.55)

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
