class_name Ark
extends Node3D
## The ark in the background. Each of the seven stages is a group of parts; parts not yet built show as
## a faint blueprint once the ark is discovered (fifth robot), built ones are solid and lit:
##   1 reactor housing   2 power conduits   3 frame (keel and ribs)   4 factory decks and arms
##   5 antenna and cockpit   6 hull plates, nose and engines   7 ignition and the launch itself

signal launch_finished

const LENGTH := 20.0
const HULL_Y := 3.4
const HULL_R := 2.7

var _solid: Array[Node3D] = []
var _ghost: Array[Node3D] = []
var _ship: Node3D
var _blink: Array[StandardMaterial3D] = []
var _windows: StandardMaterial3D
var _flames: Array[MeshInstance3D] = []
var _flame_mat: StandardMaterial3D
var _exhaust: Array[CPUParticles3D] = []
var _launch_t := -1.0
var _t := 0.0
var _built := 0
var _arms: Array[Node3D] = []


func _ready() -> void:
	_ship = Node3D.new()
	_ship.name = "Ship"
	add_child(_ship)
	_build_cradle()
	_windows = Kit.own_mat(Color("ffd38a"), Color("ffd38a"), 2.5)
	_flame_mat = Kit.own_mat(Color("ffbe5a"), Color("ffbe5a"), 6.0)
	_flame_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	for i in 7:
		var solid := Node3D.new()
		solid.name = "Stage%d" % (i + 1)
		_ship.add_child(solid)
		_build_stage(i, solid, null)
		_solid.append(solid)
		var ghost := Node3D.new()
		ghost.name = "Ghost%d" % (i + 1)
		_ship.add_child(ghost)
		_build_stage(i, ghost, Kit.ghost())
		_ghost.append(ghost)


## Scaffolding and a launch cradle: always there, the ark is abandoned, not absent.
func _build_cradle() -> void:
	for x in [-7.0, -2.5, 2.5, 7.0]:
		for z in [-1.6, 1.6]:
			Kit.box(self, Vector3(0.3, HULL_Y - HULL_R + 0.6, 0.3), Kit.CHARCOAL, Vector3(x, (HULL_Y - HULL_R + 0.6) / 2.0, z))
		Kit.box(self, Vector3(0.3, 0.3, 3.6), Kit.RUST, Vector3(x, HULL_Y - HULL_R + 0.6, 0))
	Kit.box(self, Vector3(LENGTH + 2.0, 0.2, 5.0), Color("2a1f2c"), Vector3(0, 0.1, 0))
	# scaffold tower with a crane arm and a warning light
	var tower := Node3D.new()
	tower.position = Vector3(-LENGTH / 2.0 - 2.0, 0, 1.5)
	add_child(tower)
	for k in 6:
		Kit.box(tower, Vector3(1.4, 0.1, 1.4), Kit.RUST, Vector3(0, 1.4 * (k + 1), 0))
	for c in [Vector3(-0.65, 0, -0.65), Vector3(0.65, 0, -0.65), Vector3(-0.65, 0, 0.65), Vector3(0.65, 0, 0.65)]:
		Kit.box(tower, Vector3(0.12, 8.6, 0.12), Kit.CHARCOAL, c + Vector3(0, 4.3, 0))
	Kit.beam(tower, Vector3(0, 8.6, 0), Vector3(6.5, 8.8, -1.0), 0.25, Kit.RUST_LIGHT)
	Kit.beam(tower, Vector3(6.5, 8.8, -1.0), Vector3(6.5, 6.0, -1.0), 0.04, Kit.CHARCOAL)
	var warn := Kit.own_mat(Color("ff4a3a"), Color("ff4a3a"), 3.0)
	Kit.place(tower, Kit.sphere_mesh(0.14, 6, 3), warn, Vector3(0, 8.9, 0), Vector3.ZERO, false)
	_blink.append(warn)
	# fallen plates lying around
	for i in 5:
		Kit.box(self, Vector3(randf_range(1.5, 3.0), 0.12, randf_range(1.0, 2.0)), Kit.PURPLE.darkened(0.2),
			Vector3(-8.0 + i * 4.0, 0.2, 3.2 + (i % 2) * 0.6), Vector3(randf_range(-8, 8), randf() * 60, randf_range(-12, 12)))


func _m(own: Material, c: Variant) -> Variant:
	return own if own != null else c


func _build_stage(i: int, g: Node3D, own: Material) -> void:
	match i:
		0: # reactor housing
			Kit.cyl(g, 1.3, 1.3, 2.2, _m(own, Kit.METAL_DARK), Vector3(0, HULL_Y, 0), Vector3(0, 0, 90), 10)
			Kit.ball(g, 0.9, _m(own, Kit.glow(Kit.CORE, 3.0)), Vector3(0, HULL_Y, 0), 12)
			for x in [-1.3, 1.3]:
				Kit.cyl(g, 1.4, 1.4, 0.2, _m(own, Kit.RUST), Vector3(x, HULL_Y, 0), Vector3(0, 0, 90), 10)
		1: # power conduits: a glowing line along the keel and junction boxes
			Kit.box(g, Vector3(LENGTH * 0.9, 0.1, 0.1), _m(own, Kit.glow(Color("4fb3c9"), 1.1)), Vector3(0, HULL_Y - HULL_R + 0.78, HULL_R * 0.55))
			for x in [-6.0, -2.0, 2.0, 6.0]:
				Kit.box(g, Vector3(0.6, 0.5, 0.3), _m(own, Kit.METAL_DARK), Vector3(x, HULL_Y - HULL_R + 1.0, HULL_R * 0.55))
				Kit.box(g, Vector3(0.3, 0.1, 0.05), _m(own, Kit.glow(Kit.VERDIGRIS, 2.0)), Vector3(x, HULL_Y - HULL_R + 1.1, HULL_R * 0.55 + 0.16))
		2: # frame: keel and ribs
			Kit.box(g, Vector3(LENGTH, 0.35, 0.5), _m(own, Kit.RUST), Vector3(0, HULL_Y - HULL_R + 0.55, 0))
			Kit.box(g, Vector3(LENGTH, 0.3, 0.3), _m(own, Kit.RUST), Vector3(0, HULL_Y + HULL_R, 0))
			for k in 9:
				var x := -LENGTH / 2.0 + 1.0 + k * (LENGTH - 2.0) / 8.0
				var taper := 1.0 - 0.45 * pow(absf(x) / (LENGTH / 2.0), 2.0)
				var prev := Vector3.ZERO
				for j in 9:
					var a := deg_to_rad(-90.0 + j * 45.0)
					var p := Vector3(x, HULL_Y + sin(a) * HULL_R * taper, cos(a) * HULL_R * taper)
					if j > 0:
						Kit.beam(g, prev, p, 0.22, _m(own, Kit.RUST_LIGHT if k % 2 == 0 else Kit.RUST))
					prev = p
		3: # factory decks and arms
			for k in 4:
				var x := -6.0 + k * 4.0
				Kit.box(g, Vector3(2.4, 1.2, 2.6), _m(own, Kit.METAL_DARK), Vector3(x, HULL_Y - 1.2, 0))
				Kit.box(g, Vector3(2.0, 0.3, 0.05), _m(own, _windows), Vector3(x, HULL_Y - 1.0, 1.32))
				if own == null:
					var arm := Node3D.new()
					arm.position = Vector3(x + 0.8, HULL_Y - 0.6, 0.8)
					g.add_child(arm)
					Kit.box(arm, Vector3(0.15, 1.0, 0.15), Kit.LAMP, Vector3(0, 0.5, 0))
					Kit.box(arm, Vector3(0.12, 0.12, 0.6), Kit.LAMP, Vector3(0, 1.0, 0.25))
					_arms.append(arm)
		4: # navigation: antenna, dish, cockpit, nav lights
			Kit.cyl(g, 0.08, 0.14, 3.0, _m(own, Kit.METAL_LIGHT), Vector3(-2.0, HULL_Y + HULL_R + 1.5, 0))
			Kit.cyl(g, 0.9, 0.15, 0.3, _m(own, Kit.METAL_LIGHT), Vector3(-2.0, HULL_Y + HULL_R + 3.0, 0.2), Vector3(60, 0, 0), 12)
			Kit.box(g, Vector3(1.6, 0.5, 2.2), _m(own, _windows), Vector3(LENGTH / 2.0 - 1.4, HULL_Y + 1.1, 0), Vector3(0, 0, -25))
			if own == null:
				for p in [Vector3(-2.0, HULL_Y + HULL_R + 3.1, 0.2), Vector3(LENGTH / 2.0, HULL_Y, 1.0), Vector3(-LENGTH / 2.0, HULL_Y + 1.0, 1.4)]:
					var c := Color("4aff8a") if p.x > 0 else Color("ff4a3a")
					var lm := Kit.own_mat(c, c, 4.0)
					Kit.place(g, Kit.sphere_mesh(0.13, 6, 3), lm, p, Vector3.ZERO, false)
					_blink.append(lm)
		5: # hull plates, nose and engines
			for k in 6:
				var x := -LENGTH / 2.0 + 2.2 + k * 3.1
				var taper := 1.0 - 0.4 * pow(absf(x) / (LENGTH / 2.0), 2.0)
				for a_deg in [35.0, 90.0, 145.0]:
					var a := deg_to_rad(a_deg)
					var p := Vector3(x, HULL_Y + sin(a) * HULL_R * taper, cos(a) * HULL_R * taper)
					var col: Color = [Kit.PURPLE, Kit.METAL, Color("8a4a33")][(k + int(a_deg)) % 3]
					Kit.box(g, Vector3(3.0, 0.14, 1.9 * taper), _m(own, col), p, Vector3(a_deg - 90.0, 0, 0))
				Kit.box(g, Vector3(3.0, 0.14, 1.5 * taper), _m(own, Kit.PURPLE.darkened(0.15)), Vector3(x, HULL_Y - 0.4, HULL_R * taper * 0.95), Vector3(90, 0, 0))
			Kit.cyl(g, 0.2, HULL_R * 0.62, 3.0, _m(own, Kit.RUST_LIGHT), Vector3(LENGTH / 2.0 + 1.3, HULL_Y, 0), Vector3(0, 0, -90), 10)
			for z in [-1.4, 1.4]:
				Kit.cyl(g, 0.9, 0.7, 2.6, _m(own, Kit.METAL_DARK), Vector3(-LENGTH / 2.0 - 0.6, HULL_Y - 0.6, z), Vector3(0, 0, 90), 10)
				Kit.cyl(g, 0.7, 0.95, 0.4, _m(own, Kit.CHARCOAL), Vector3(-LENGTH / 2.0 - 2.0, HULL_Y - 0.6, z), Vector3(0, 0, 90), 10)
		6: # ignition: the engine flames, lit at the launch
			for z in [-1.4, 1.4]:
				if own != null:
					Kit.cyl(g, 0.75, 0.75, 0.2, own, Vector3(-LENGTH / 2.0 - 2.25, HULL_Y - 0.6, z), Vector3(0, 0, 90), 10)
					continue
				var f := Kit.place(g, Kit.cyl_mesh(0.7, 0.05, 3.0, 10), _flame_mat, Vector3(-LENGTH / 2.0 - 3.7, HULL_Y - 0.6, z), Vector3(0, 0, -90), false)
				f.visible = false
				_flames.append(f)
				var ex := Fx.smoke(g, Vector3(-LENGTH / 2.0 - 3.0, HULL_Y - 0.8, z), Color(0.9, 0.7, 0.55, 0.5))
				ex.emitting = false
				ex.amount = 40
				ex.direction = Vector3(-1, -0.4, 0)
				ex.initial_velocity_min = 2.0
				ex.initial_velocity_max = 4.0
				_exhaust.append(ex)


## built: stages done; discovered: show the blueprint of the rest; launched: the ark is gone.
func show_stage(built: int, discovered: bool, launched: bool) -> void:
	_built = built
	visible = true
	_ship.visible = not (launched and _launch_t < 0.0)
	for i in 7:
		_solid[i].visible = i < built and i != 6
		_ghost[i].visible = discovered and i >= built
	if _launch_t < 0.0:
		_ship.position = Vector3.ZERO
		_ship.rotation = Vector3.ZERO


func launch() -> void:
	_launch_t = 0.0
	_ship.visible = true
	_solid[6].visible = true
	for f in _flames:
		f.visible = true
	for e in _exhaust:
		e.emitting = true


func launching() -> bool:
	return _launch_t >= 0.0


func _process(delta: float) -> void:
	_t += delta
	for i in _blink.size():
		_blink[i].emission_energy_multiplier = 4.0 if fmod(_t + i * 0.37, 1.6) < 0.25 else 0.3
	for k in _arms.size():
		_arms[k].rotation.y = sin(_t * 1.4 + k) * 0.9
	_windows.emission_energy_multiplier = 2.2 + sin(_t * 0.7) * 0.3
	if _launch_t >= 0.0:
		_launch_t += delta
		var t := _launch_t
		for f in _flames:
			f.scale = Vector3(1.0, 0.6 + randf() * 0.6 + minf(t, 3.0) * 0.4, 1.0)
		_flame_mat.emission_energy_multiplier = 5.0 + randf() * 3.0
		if t < 2.5:
			_ship.position = Vector3(randf_range(-0.05, 0.05), 0, randf_range(-0.05, 0.05))
		else:
			var u := t - 2.5
			_ship.position = Vector3(u * u * 0.6, u * u * 1.6, -u * u * 0.4)
			_ship.rotation.z = minf(0.35, u * 0.06)
		if t > 9.0:
			_launch_t = -1.0
			_ship.visible = false
			for e in _exhaust:
				e.emitting = false
			launch_finished.emit()
