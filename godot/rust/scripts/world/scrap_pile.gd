class_name ScrapPile
extends Node3D
## A heap of scrap. It grows with the scrap in stock (like the web game's heap), diggers work around it,
## and a click digs. Piles of zones not yet opened stand behind a closed fence.

var zone := "yard"
var radius := 2.6
var open := true
var area: Interactable

var _mound: MeshInstance3D
var _chunks: MultiMeshInstance3D
var _fence: Node3D
var _burst: CPUParticles3D
var _height := 1.0
var _want := 1.0


func setup(zone_: String, radius_: float) -> void:
	zone = zone_
	radius = radius_
	var heap := Node3D.new()
	heap.name = "Heap"
	add_child(heap)
	_mound = Kit.place(heap, Kit.sphere_mesh(1.0, 12, 6), Kit.mat(Color("3a2533")), Vector3.ZERO)
	_chunks = MultiMeshInstance3D.new()
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = Kit.box_mesh(Vector3(0.36, 0.2, 0.26))
	mm.instance_count = 90
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 0.75
	mat.metallic = 0.35
	_chunks.material_override = mat
	_chunks.multimesh = mm
	heap.add_child(_chunks)
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(zone)
	for i in mm.instance_count:
		var a := rng.randf() * TAU
		var r := sqrt(rng.randf()) * 0.95
		var y := sqrt(maxf(0.0, 1.0 - r * r))
		var basis := Basis.from_euler(Vector3(rng.randf() * TAU, rng.randf() * TAU, rng.randf() * TAU))
		basis = basis.scaled(Vector3.ONE * rng.randf_range(0.7, 1.6))
		mm.set_instance_transform(i, Transform3D(basis, Vector3(cos(a) * r, y, sin(a) * r)))
		mm.set_instance_color(i, Kit.SCRAP_COLORS[i % Kit.SCRAP_COLORS.size()])
	_layout()
	# a few big recognisable pieces: a tyre, a pipe, a car door
	Kit.place(heap, Kit.torus_mesh(0.18, 0.42), Kit.mat(Kit.CHARCOAL), Vector3(radius * 0.4, 0.35, radius * 0.35), Vector3(70, 20, 0))
	Kit.cyl(heap, 0.12, 0.12, 1.6, Kit.RUST_LIGHT, Vector3(-radius * 0.3, 0.5, radius * 0.2), Vector3(0, 30, 75))
	Kit.box(heap, Vector3(0.9, 0.6, 0.06), Kit.PURPLE, Vector3(radius * 0.1, 0.55, -radius * 0.4), Vector3(-25, 40, 10))
	_burst = Fx.burst(self, Vector3(0, 1.0, radius * 0.5), Kit.RUST_LIGHT, 16, 4.0)
	area = Interactable.new()
	add_child(area)
	area.setup(heap, Vector3(radius * 2.0, 2.4, radius * 1.6), Vector3(0, 1.2, 0), radius + 0.3,
		"Груда хлама", "Клик — копать (Q)", Kit.ROLE_COLORS.digger)
	_fence = Node3D.new()
	add_child(_fence)
	for i in 9:
		var a := PI * 0.15 + i * PI * 0.7 / 8.0
		var p := Vector3(cos(a), 0, sin(a)) * (radius + 0.9)
		Kit.box(_fence, Vector3(0.12, 1.4, 0.12), Kit.METAL_DARK, p + Vector3(0, 0.7, 0))
		if i < 8:
			var a2 := PI * 0.15 + (i + 1) * PI * 0.7 / 8.0
			var p2 := Vector3(cos(a2), 0, sin(a2)) * (radius + 0.9)
			Kit.beam(_fence, p + Vector3(0, 1.1, 0), p2 + Vector3(0, 1.1, 0), 0.06, Kit.RUST)
			Kit.beam(_fence, p + Vector3(0, 0.5, 0), p2 + Vector3(0, 0.5, 0), 0.06, Kit.RUST)
	Kit.box(_fence, Vector3(1.4, 0.5, 0.05), Color("8a2f2a"), Vector3(0, 1.0, radius + 0.98))


func _layout() -> void:
	_mound.scale = Vector3(radius, _height, radius * 0.8)
	_chunks.scale = Vector3(radius, _height, radius * 0.8)


func set_open(on: bool) -> void:
	open = on
	_fence.visible = not on
	area.enabled = on
	area.set_texts("Груда хлама" if on else "Закрытая зона", "Клик — копать (Q)" if on else "Откроется с этапом ковчега")


## The pile grows with the scrap in stock: log scale, like the web game's heap.
func set_amount(scrap: float) -> void:
	_want = 0.55 + 1.6 * clampf(log(scrap + 1.0) / log(10.0) / 6.0, 0.0, 1.0)


func dig_fx() -> void:
	_burst.restart()


func _process(delta: float) -> void:
	_height = lerpf(_height, _want, minf(1.0, delta * 3.0))
	_layout()


func top() -> Vector3:
	return global_position + Vector3(0, _height + 0.3, 0)
