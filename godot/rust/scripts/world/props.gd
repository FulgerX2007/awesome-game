class_name Props
extends RefCounted
## Decorative scenery (no rings, no clicks): wrecked cars, tyres, barrels, containers, a fallen giant's
## head, fences, lamp posts and the ridges of junk on the horizon.


static func car(parent: Node3D, pos: Vector3, rot: float, color: Color) -> void:
	var c := Node3D.new()
	c.position = pos
	c.rotation_degrees = Vector3(randf_range(-6, 6), rot, randf_range(-10, 10))
	parent.add_child(c)
	Kit.box(c, Vector3(2.6, 0.6, 1.3), color, Vector3(0, 0.55, 0))
	Kit.box(c, Vector3(1.4, 0.5, 1.2), color.darkened(0.25), Vector3(-0.2, 1.05, 0))
	Kit.box(c, Vector3(1.3, 0.38, 1.22), Kit.mat(Color("2c3540"), 0.2, 0.3), Vector3(-0.2, 1.06, 0))
	for x in [-0.85, 0.85]:
		for z in [-0.62, 0.62]:
			if randf() < 0.75:
				Kit.place(c, Kit.torus_mesh(0.12, 0.3), Kit.mat(Kit.CHARCOAL), Vector3(x, 0.28, z), Vector3(90, 0, 0))


static func tyres(parent: Node3D, pos: Vector3, n: int) -> void:
	for i in n:
		Kit.place(parent, Kit.torus_mesh(0.15, 0.4), Kit.mat(Color("231b26")), pos + Vector3(randf_range(-0.05, 0.05), 0.15 + i * 0.27, 0),
			Vector3(0, randf() * 90, randf_range(-5, 5)))


static func barrels(parent: Node3D, pos: Vector3) -> void:
	var cols := [Color("6a3f2a"), Color("2f5d5a"), Color("7a6a58")]
	for i in 3:
		var tipped := i == 2
		Kit.cyl(parent, 0.3, 0.3, 0.85, cols[i], pos + Vector3(i * 0.55, 0.3 if tipped else 0.43, (i % 2) * 0.4),
			Vector3(90 if tipped else 0, randf() * 40, 0), 10)


static func container(parent: Node3D, pos: Vector3, rot: float, color: Color) -> void:
	var c := Node3D.new()
	c.position = pos
	c.rotation_degrees.y = rot
	parent.add_child(c)
	Kit.box(c, Vector3(4.6, 2.0, 1.9), color, Vector3(0, 1.0, 0))
	for i in 9:
		Kit.box(c, Vector3(0.06, 1.9, 1.95), color.darkened(0.2), Vector3(-2.1 + i * 0.52, 1.0, 0))
	Kit.box(c, Vector3(4.7, 0.1, 2.0), color.darkened(0.35), Vector3(0, 2.02, 0))


static func giant_head(parent: Node3D, pos: Vector3) -> void:
	var h := Node3D.new()
	h.position = pos
	h.rotation_degrees = Vector3(0, 25, -28)
	parent.add_child(h)
	Kit.box(h, Vector3(3.0, 2.2, 2.6), Kit.METAL.darkened(0.15), Vector3(0, 1.1, 0))
	Kit.box(h, Vector3(2.4, 0.4, 0.1), Kit.CHARCOAL, Vector3(0, 0.6, 1.31))
	Kit.ball(h, 0.32, Kit.mat(Color("3a4450"), 0.3, 0.2, Color("ff8f6b"), 0.6), Vector3(0.6, 1.4, 1.3), 10)
	Kit.cyl(h, 0.06, 0.06, 1.6, Kit.METAL_DARK, Vector3(-0.8, 2.8, 0), Vector3(0, 0, 20))


static func lamp_post(parent: Node3D, pos: Vector3) -> StandardMaterial3D:
	Kit.box(parent, Vector3(0.12, 3.6, 0.12), Kit.CHARCOAL, pos + Vector3(0, 1.8, 0))
	Kit.box(parent, Vector3(0.7, 0.08, 0.08), Kit.CHARCOAL, pos + Vector3(0.3, 3.6, 0))
	var m := Kit.own_mat(Kit.LAMP, Kit.LAMP, 0.0)
	Kit.place(parent, Kit.box_mesh(Vector3(0.3, 0.12, 0.2)), m, pos + Vector3(0.6, 3.52, 0), Vector3.ZERO, false)
	return m


static func fence(parent: Node3D, a: Vector3, b: Vector3) -> void:
	var n := int(a.distance_to(b) / 1.6)
	for i in n + 1:
		var p := a.lerp(b, float(i) / n)
		Kit.box(parent, Vector3(0.12, 1.6 + randf_range(-0.3, 0.2), 0.12), Kit.METAL_DARK, p + Vector3(0, 0.8, 0), Vector3(randf_range(-6, 6), 0, randf_range(-6, 6)))
		if i < n and randf() < 0.8:
			var q := a.lerp(b, float(i + 1) / n)
			Kit.beam(parent, p + Vector3(0, 1.3, 0), q + Vector3(0, 1.25, 0), 0.05, Kit.RUST)
			Kit.box(parent, Vector3(p.distance_to(q), 0.9, 0.03), Kit.mat(Color(0.42, 0.33, 0.4)), (p + q) / 2.0 + Vector3(0, 0.75, 0),
				Vector3(0, -rad_to_deg(atan2(q.z - p.z, q.x - p.x)), 0))


## Long ridges of junk on the horizon, darker the further away.
static func ridges(parent: Node3D) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	for row in 3:
		var z := -22.0 - row * 4.0
		var col := Color("2b1d36").lerp(Color("4a2c4e"), row * 0.4)
		for i in 18:
			var x := -50.0 + i * 6.0 + rng.randf_range(-2, 2)
			var r := rng.randf_range(3.5, 6.5)
			var m := Kit.place(parent, Kit.sphere_mesh(1.0, 8, 4), Kit.mat(col, 1.0, 0.0), Vector3(x, -0.3, z + rng.randf_range(-1.5, 1.5)), Vector3.ZERO, false)
			m.scale = Vector3(r, rng.randf_range(0.3, 0.8) * (1.0 + row * 0.5), r * 0.6)
