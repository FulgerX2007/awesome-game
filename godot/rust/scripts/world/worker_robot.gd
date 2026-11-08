class_name WorkerRobot
extends Node3D
## One brigade robot. Its role decides where it goes and what it does there; the numbers come from
## the rules (the crew only shows as many robots as really work, see WorkerCrew):
##   digger    walks to a scrap pile, digs, carries a chunk to the conveyor and drops it there
##   sorter    stands at the sorting table and sorts while there is scrap to sort
##   mechanic  stands at the repair bay and welds while a robot is on it
##   idle      wanders about the yard, waiting for a job

signal dropped_chunk(at: Vector3)

const WALK_SPEED := 2.4

var role := "idle"
var slot := 0.0
## The scrapyard, which knows where the piles, the conveyor, the table and the bay are.
var world: Node

var state := "walk"
var target := Vector3.ZERO
var carrying := false
var _timer := 0.0
var _phase := 0.0
var _working := false
var _speed := WALK_SPEED
var _stripe_mat: StandardMaterial3D
var _eye_mat: StandardMaterial3D
var _antenna_mat: StandardMaterial3D
var _parts := {}


func _ready() -> void:
	scale = Vector3.ONE * 1.25
	_phase = randf() * TAU
	_speed = WALK_SPEED * randf_range(0.85, 1.15)
	_build()
	set_role(role)


func _build() -> void:
	var rig := Node3D.new()
	rig.name = "Rig"
	add_child(rig)
	_parts.rig = rig
	for side in [-1, 1]:
		var hip := Node3D.new()
		hip.position = Vector3(0.13 * side, 0.32, 0)
		rig.add_child(hip)
		Kit.box(hip, Vector3(0.12, 0.32, 0.14), Kit.METAL_DARK, Vector3(0, -0.16, 0))
		Kit.box(hip, Vector3(0.16, 0.06, 0.22), Kit.CHARCOAL, Vector3(0, -0.3, 0.03))
		_parts["leg%d" % side] = hip
	var torso := Node3D.new()
	torso.position = Vector3(0, 0.32, 0)
	rig.add_child(torso)
	_parts.torso = torso
	Kit.box(torso, Vector3(0.48, 0.38, 0.34), Kit.METAL, Vector3(0, 0.22, 0))
	Kit.box(torso, Vector3(0.36, 0.12, 0.04), Kit.METAL_DARK, Vector3(0, 0.26, 0.18))
	_stripe_mat = Kit.own_mat(Kit.ROLE_COLORS.idle, Kit.ROLE_COLORS.idle, 1.5)
	Kit.place(torso, Kit.box_mesh(Vector3(0.5, 0.06, 0.36)), _stripe_mat, Vector3(0, 0.12, 0))
	var head := Node3D.new()
	head.position = Vector3(0, 0.44, 0)
	torso.add_child(head)
	_parts.head = head
	Kit.box(head, Vector3(0.36, 0.26, 0.3), Kit.METAL_LIGHT, Vector3(0, 0.14, 0))
	_eye_mat = Kit.own_mat(Kit.ROLE_COLORS.idle, Kit.ROLE_COLORS.idle, 3.0)
	Kit.place(head, Kit.sphere_mesh(0.065, 8, 4), _eye_mat, Vector3(0.06, 0.16, 0.15), Vector3.ZERO, false)
	Kit.cyl(head, 0.012, 0.012, 0.2, Kit.METAL_DARK, Vector3(-0.08, 0.36, 0))
	_antenna_mat = Kit.own_mat(Color("ff8f6b"), Color("ff8f6b"), 0.0)
	Kit.place(head, Kit.sphere_mesh(0.035, 6, 3), _antenna_mat, Vector3(-0.08, 0.47, 0), Vector3.ZERO, false)
	var arm := Node3D.new()
	arm.position = Vector3(0.29, 0.32, 0)
	torso.add_child(arm)
	_parts.arm = arm
	Kit.box(arm, Vector3(0.09, 0.34, 0.09), Kit.METAL_DARK, Vector3(0, -0.15, 0))
	var tool := Kit.box(arm, Vector3(0.05, 0.05, 0.28), Kit.METAL_LIGHT, Vector3(0, -0.3, 0.1))
	_parts.tool = tool
	var arm2 := Node3D.new()
	arm2.position = Vector3(-0.29, 0.32, 0)
	torso.add_child(arm2)
	_parts.arm2 = arm2
	Kit.box(arm2, Vector3(0.09, 0.34, 0.09), Kit.METAL_DARK, Vector3(0, -0.15, 0))
	var chunk := Kit.box(torso, Vector3(0.3, 0.18, 0.24), Kit.RUST, Vector3(0, 0.95, 0), Vector3(0, 20, 8))
	chunk.visible = false
	_parts.chunk = chunk
	# a soft contact shadow, cheap and readable from far away
	var blob := Kit.place(self, Kit.cyl_mesh(0.3, 0.3, 0.01, 12), Kit.mat(Color(0, 0, 0, 1)), Vector3(0, 0.01, 0), Vector3.ZERO, false)
	var bm := StandardMaterial3D.new()
	bm.albedo_color = Color(0, 0, 0, 0.35)
	bm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	bm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	blob.material_override = bm


func set_role(r: String) -> void:
	role = r
	state = "walk"
	carrying = false
	if _parts.has("chunk"):
		_parts.chunk.visible = false
		_parts.tool.visible = r in ["digger", "mechanic"]
	var c: Color = Kit.ROLE_COLORS.get(r, Kit.ROLE_COLORS.idle)
	if _stripe_mat:
		_stripe_mat.albedo_color = c
		_stripe_mat.emission = c
		_eye_mat.albedo_color = c
		_eye_mat.emission = c
	target = position


## Brighter eyes with the neural core upgrade.
func set_eye_power(p: float) -> void:
	if _eye_mat:
		_eye_mat.emission_energy_multiplier = 3.0 + p


func _go(to: Vector3, delta: float) -> bool:
	var d := to - position
	d.y = 0
	var dist := d.length()
	if dist < 0.05:
		position = Vector3(to.x, 0, to.z)
		return true
	var step := minf(dist, _speed * delta * (world.walk_mult() if world else 1.0))
	position += d / dist * step
	_face(d)
	return false


func _face(dir: Vector3) -> void:
	if dir.length() > 0.01:
		var want := atan2(dir.x, dir.z)
		rotation.y = lerp_angle(rotation.y, want, 0.2)


func _process(delta: float) -> void:
	if world == null:
		return
	var walking := false
	_working = false
	match role:
		"digger":
			match state:
				"walk", "to_pile":
					state = "to_pile"
					walking = not _go(world.pile_spot(self), delta)
					if not walking:
						state = "dig"
						_timer = randf_range(0.9, 1.6) / world.work_speed("digger")
				"dig":
					_working = true
					_face(world.pile_center(self) - position)
					_timer -= delta
					if _timer <= 0.0:
						state = "to_drop"
						carrying = true
				"to_drop":
					walking = not _go(world.drop_spot(self), delta)
					if not walking:
						state = "drop"
						_timer = 0.35
						carrying = false
						dropped_chunk.emit(global_position + Vector3(0, 0.9, 0))
				"drop":
					_timer -= delta
					if _timer <= 0.0:
						state = "to_pile"
		"sorter":
			walking = not _go(world.station_spot(self), delta)
			if not walking:
				_face(world.station_center() - position)
				_working = world.sorting_active()
		"mechanic":
			walking = not _go(world.bay_spot(self), delta)
			if not walking:
				_face(world.bay_center() - position)
				_working = world.repair_active()
		_:
			if state == "walk":
				walking = not _go(target, delta)
				if not walking:
					state = "rest"
					_timer = randf_range(1.5, 4.0)
			else:
				_timer -= delta
				if _timer <= 0.0:
					target = world.wander_spot()
					state = "walk"
	_animate(delta, walking)


func _animate(delta: float, walking: bool) -> void:
	_phase += delta * (9.0 if walking else (11.0 * world.work_speed(role) if _working else 2.0))
	var rig: Node3D = _parts.rig
	var bob := absf(sin(_phase)) * 0.05 if walking else 0.0
	rig.position.y = bob
	var swing := sin(_phase) * 0.6 if walking else 0.0
	_parts["leg-1"].rotation.x = swing
	_parts["leg1"].rotation.x = -swing
	var arm: Node3D = _parts.arm
	var arm2: Node3D = _parts.arm2
	if _working:
		match role:
			"digger":
				arm.rotation.x = -1.2 + sin(_phase) * 0.9
				arm2.rotation.x = -1.0 + sin(_phase) * 0.7
				_parts.torso.rotation.x = 0.25 + sin(_phase) * 0.1
			"sorter":
				arm.rotation.x = -1.1 + sin(_phase * 1.3) * 0.35
				arm2.rotation.x = -1.1 + cos(_phase * 1.1) * 0.35
				_parts.torso.rotation.x = 0.12
			"mechanic":
				arm.rotation.x = -1.4 + sin(_phase * 2.0) * 0.12
				arm2.rotation.x = -0.4
				_parts.torso.rotation.x = 0.1
	elif carrying:
		arm.rotation.x = -2.9
		arm2.rotation.x = -2.9
		_parts.torso.rotation.x = 0.0
	else:
		arm.rotation.x = lerpf(arm.rotation.x, swing * 0.6, 0.2)
		arm2.rotation.x = lerpf(arm2.rotation.x, -swing * 0.6, 0.2)
		_parts.torso.rotation.x = lerpf(_parts.torso.rotation.x, 0.0, 0.2)
	_parts.chunk.visible = carrying
	_parts.head.rotation.y = sin(_phase * 0.3) * 0.3 if not (walking or _working) else 0.0
	_antenna_mat.emission_energy_multiplier = 3.0 if sin(_phase * 0.37) > 0.6 else 0.0


func is_working() -> bool:
	return _working
