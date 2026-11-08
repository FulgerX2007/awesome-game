class_name Fx
extends RefCounted
## Particle presets (CPU particles: they work the same in the browser and on every renderer).


static func _quad(size: float, color: Color, glow := 0.0) -> QuadMesh:
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.vertex_color_use_as_albedo = true
	m.albedo_color = color
	if glow > 0.0:
		m.emission_enabled = true
		m.emission = color
		m.emission_energy_multiplier = glow
	q.material = m
	return q


static func _fade(c: Color) -> Gradient:
	var g := Gradient.new()
	g.set_color(0, c)
	g.set_color(1, Color(c, 0.0))
	return g


static func sparks(parent: Node3D, pos: Vector3, color := Kit.LAMP) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.mesh = _quad(0.06, color, 4.0)
	p.amount = 24
	p.lifetime = 0.5
	p.explosiveness = 0.0
	p.direction = Vector3(0, 1, 0)
	p.spread = 70.0
	p.initial_velocity_min = 1.5
	p.initial_velocity_max = 3.5
	p.gravity = Vector3(0, -9, 0)
	p.color_ramp = _fade(color)
	p.position = pos
	p.emitting = false
	parent.add_child(p)
	return p


## A one-shot burst: call .restart() to fire it.
static func burst(parent: Node3D, pos: Vector3, color: Color, amount := 14, speed := 3.0, size := 0.12) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.mesh = _quad(size, color, 0.6)
	p.amount = amount
	p.lifetime = 0.8
	p.one_shot = true
	p.explosiveness = 0.95
	p.direction = Vector3(0, 1, 0)
	p.spread = 60.0
	p.initial_velocity_min = speed * 0.5
	p.initial_velocity_max = speed
	p.gravity = Vector3(0, -9.8, 0)
	p.color_ramp = _fade(color)
	p.position = pos
	p.emitting = false
	parent.add_child(p)
	return p


static func smoke(parent: Node3D, pos: Vector3, color := Color(0.45, 0.38, 0.45, 0.35)) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.mesh = _quad(0.7, color)
	p.amount = 14
	p.lifetime = 4.0
	p.direction = Vector3(0.3, 1, 0)
	p.spread = 15.0
	p.initial_velocity_min = 0.4
	p.initial_velocity_max = 0.8
	p.gravity = Vector3(0.15, 0.05, 0)
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.6
	var curve := Curve.new()
	curve.add_point(Vector2(0, 0.4))
	curve.add_point(Vector2(1, 1.8))
	p.scale_amount_curve = curve
	p.color_ramp = _fade(color)
	p.position = pos
	parent.add_child(p)
	return p


## Dust and embers drifting over the whole yard.
static func dust(parent: Node3D) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.mesh = _quad(0.07, Color(1.0, 0.75, 0.5, 0.55), 1.5)
	p.amount = 90
	p.lifetime = 9.0
	p.preprocess = 9.0
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	p.emission_box_extents = Vector3(22, 4, 10)
	p.position = Vector3(0, 4, -2)
	p.direction = Vector3(1, 0.2, 0)
	p.spread = 30.0
	p.initial_velocity_min = 0.2
	p.initial_velocity_max = 0.6
	p.gravity = Vector3(0, 0.02, 0)
	p.color_ramp = _fade(Color(1.0, 0.75, 0.5, 0.6))
	parent.add_child(p)
	return p
