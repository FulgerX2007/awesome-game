class_name Conveyor
extends Node3D
## The belt from the scrap pile to the sorting table. Diggers drop chunks at its start; the chunks ride
## to the hopper. It runs faster with the belt upgrade and lights its rollers.

var length := 6.0
var speed := 1.2
var running := true
var _slats: Array[MeshInstance3D] = []
var _chunks: Array = []          # [{node, x}]
var _offset := 0.0
var _roller_mat: StandardMaterial3D


func setup(length_: float) -> void:
	length = length_
	Kit.box(self, Vector3(length, 0.12, 0.9), Kit.CHARCOAL, Vector3(length / 2.0, 0.62, 0))
	Kit.box(self, Vector3(length, 0.16, 0.08), Kit.RUST, Vector3(length / 2.0, 0.72, 0.48))
	Kit.box(self, Vector3(length, 0.16, 0.08), Kit.RUST, Vector3(length / 2.0, 0.72, -0.48))
	_roller_mat = Kit.own_mat(Kit.METAL_DARK, Kit.VERDIGRIS, 0.0)
	var legs := int(length / 1.5) + 1
	for i in legs:
		var x := i * length / float(legs - 1)
		Kit.box(self, Vector3(0.1, 0.6, 0.1), Kit.METAL_DARK, Vector3(x, 0.3, 0.4))
		Kit.box(self, Vector3(0.1, 0.6, 0.1), Kit.METAL_DARK, Vector3(x, 0.3, -0.4))
		Kit.place(self, Kit.cyl_mesh(0.09, 0.09, 0.86, 8), _roller_mat, Vector3(x, 0.6, 0), Vector3(90, 0, 0))
	for i in int(length / 0.45):
		_slats.append(Kit.box(self, Vector3(0.08, 0.025, 0.78), Kit.METAL, Vector3(i * 0.45, 0.69, 0)))


func set_level(belt_level: int) -> void:
	speed = 1.2 * (1.0 + 0.25 * belt_level)
	_roller_mat.emission_energy_multiplier = 0.0 if belt_level == 0 else 1.2 + 0.1 * belt_level


func drop_chunk() -> void:
	if _chunks.size() > 24:
		return
	var c := Kit.box(self, Vector3(0.3, 0.18, 0.24), Kit.SCRAP_COLORS[randi() % Kit.SCRAP_COLORS.size()], Vector3(0.2, 0.82, randf_range(-0.2, 0.2)),
		Vector3(randf() * 40, randf() * 180, 0))
	_chunks.append({node = c, x = 0.2})


func _process(delta: float) -> void:
	if not running:
		return
	_offset = fmod(_offset + speed * delta, 0.45)
	for i in _slats.size():
		_slats[i].position.x = fmod(i * 0.45 + _offset, length)
	for c in _chunks.duplicate():
		c.x += speed * delta
		c.node.position.x = c.x
		if c.x > length - 0.1:
			c.node.queue_free()
			_chunks.erase(c)
