class_name Fx
extends RefCounted
## Short particle bursts (sparkles, splashes, confetti). One-shot and freed when done, so they never pile up.


static func burst(parent: Node, at: Vector3, color: Color, amount := 20, spread := 4.0, size := 0.12, life := 0.7) -> void:
	if parent == null or not parent.is_inside_tree():
		return
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = false
	p.amount = amount
	p.lifetime = life
	p.explosiveness = 0.95
	p.direction = Vector3.UP
	p.spread = 70.0
	p.initial_velocity_min = spread * 0.5
	p.initial_velocity_max = spread
	p.gravity = Vector3(0, -9.0, 0)
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.2
	var m := SphereMesh.new()
	m.radius = size
	m.height = size * 2.0
	m.radial_segments = 6
	m.rings = 3
	p.mesh = m
	p.material_override = Art.material(color, 1.5)
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(p)
	p.global_position = at
	p.emitting = true
	p.finished.connect(p.queue_free)


static func confetti(parent: Node, at: Vector3) -> void:
	for c in [Color("#ff5f6d"), Color("#ffd166"), Color("#06d6a0"), Color("#4cc9f0"), Color("#c77dff")]:
		burst(parent, at, c, 14, 7.0, 0.1, 1.4)
