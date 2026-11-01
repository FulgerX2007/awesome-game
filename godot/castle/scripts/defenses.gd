class_name CastleDefenses
extends Node3D
## The defences in front of the wall, as the simulation has them (sim.defenses), and the build-mode preview.
## Every model is made of pieces (one MeshInstance3D each, meshes cached): when a defence loses health its pieces
## tilt, char and fall away in two steps (≤ 66 %, ≤ 33 %); when it is gone the pieces fly off with splinters and
## dust. Forward (+x) faces the enemies. Rows are turned a little towards the camera so their depth reads.
##   sync(sim, delta) every frame; on_event(ev) for the sim's events; show_slots()/hide_slots() in build mode.

const FX_SHADER := preload("res://shaders/ground_fx.gdshader")
const TURN := 28.0                  # degrees the rows are turned towards the camera
const WOOD := Color("#9a6a3c")
const WOOD_DARK := Color("#6b4526")
const WOOD_PALE := Color("#e8cf9e")
const ROPE := Color("#cfae6c")
const IRON := Color("#5d6068")
const BURLAP := Color("#b89466")

static var _meshes := {}


class Piece:
	var node: Node3D
	var hide_at := 99               # damage state that knocks it off
	var tilt_at := 99               # damage state that tilts it
	var tilt := Vector3.ZERO        # degrees added when tilted
	var char_at := 99               # damage state that chars it
	var base_rot := Vector3.ZERO
	var base_pos := Vector3.ZERO


class View:
	var id := 0
	var type := ""
	var slot := 0
	var root: Node3D
	var body: Node3D
	var pieces: Array = []
	var extras: Array = []          # nodes shown from a damage state on: [node, state]
	var state := 0
	var hits := 0
	var shake := 0.0
	var archer: Node3D
	var bow_arm: Node3D
	var draw := 0.0
	var face := 1.0
	var armed := true
	var oil_surface: Node3D
	var scorch: Node3D
	var glint := 0.0


var views := {}                     # defence id -> View
var _sim_id := 0
var _t := 0.0
var _debris: Array = []             # [node, velocity, spin, age]
var _pools := {}
var _pending_pop := {}
var _slots: Array = []              # [plate MeshInstance3D, post Node3D, label Label3D]
var _ghost: Node3D
var _ghost_type := ""
var _ghost_ok := true
var _char_mat: StandardMaterial3D
var _ghost_mats := {}
var _occupied := {}                 # slot -> true, from the last sync


func _init() -> void:
	_char_mat = StandardMaterial3D.new()
	_char_mat.vertex_color_use_as_albedo = true
	_char_mat.albedo_color = Color(0.42, 0.36, 0.33)
	_char_mat.roughness = 1.0


## ── Sync ──

func sync(sim: CastleSim, delta: float) -> void:
	_t += delta
	if sim.get_instance_id() != _sim_id:
		_sim_id = sim.get_instance_id()
		clear()
	var seen := {}
	_occupied.clear()
	for d in sim.defenses:
		if d.dead:
			continue
		seen[d.id] = true
		_occupied[d.slot] = true
		var v: View = views.get(d.id)
		if v == null:
			v = _make_view(d)
			views[d.id] = v
			if _pending_pop.has(d.id):
				_pending_pop.erase(d.id)
				_pop(v)
		var f := d.hp / maxf(1.0, d.max_hp)
		var st := 0 if f > 0.66 else (1 if f > 0.33 else 2)
		if st != v.state:
			v.state = st
			_apply_state(v)
		if d.hits != v.hits:
			v.hits = d.hits
			v.shake = 1.0
		if d.kind == "oil" and d.armed != v.armed:
			v.armed = d.armed
			if v.oil_surface:
				v.oil_surface.visible = d.armed
			if v.scorch:
				v.scorch.visible = not d.armed
	for id in views.keys():
		if not seen.has(id):
			_destroy(views[id])
			views.erase(id)
	_animate(delta)


## Drops every view at once (a new level, a restart): no debris.
func clear() -> void:
	for id in views:
		views[id].root.queue_free()
	views.clear()
	for d in _debris:
		d[0].queue_free()
	_debris.clear()
	_pending_pop.clear()


func _animate(delta: float) -> void:
	for id in views:
		var v: View = views[id]
		v.shake = maxf(0.0, v.shake - delta * 4.0)
		v.glint = maxf(0.0, v.glint - delta * 2.0)
		var s := v.shake * v.shake
		v.body.position = Vector3(sin(_t * 70.0) * 0.09 * s, 0, 0)
		v.body.rotation.z = sin(_t * 55.0 + 1.0) * 0.05 * s
		if v.glint > 0.0:
			var k := 1.0 + 0.08 * sin(v.glint * PI)
			v.root.scale = Vector3(k, k, k)
		if v.archer:
			v.draw = maxf(0.0, v.draw - delta * 2.5)
			var want := 0.0 if v.face > 0.0 else PI
			v.archer.rotation.y = lerp_angle(v.archer.rotation.y, want - deg_to_rad(TURN) * 0.0, minf(1.0, delta * 8.0))
			# draw: the string hand goes back, then snaps forward on the release
			var pull := v.draw if v.draw < 0.6 else (1.0 - v.draw) / 0.4 * 0.6
			v.bow_arm.position.x = -0.25 * pull
			v.archer.position.y = 5.25 + sin(_t * 2.0 + v.id) * 0.02
	var live := []
	for d in _debris:
		var n: Node3D = d[0]
		d[3] += delta
		d[1].y -= 14.0 * delta
		n.position += d[1] * delta
		n.rotation += d[2] * delta
		if n.position.y < 0.05 and d[1].y < 0.0:
			n.position.y = 0.05
			d[1] *= Vector3(0.4, -0.25, 0.4)
			d[2] *= 0.5
		var age: float = d[3]
		if age > 1.1:
			var k := maxf(0.0, 1.0 - (age - 1.1) / 0.5)
			n.scale = Vector3(k, k, k)
		if age > 1.6:
			n.queue_free()
		else:
			live.append(d)
	_debris = live


## ── Events ──

func on_event(ev: Dictionary) -> void:
	match ev.type:
		"placed":
			var v: View = views.get(ev.did)
			if v:
				_pop(v)
			else:
				_pending_pop[ev.did] = true
		"struct_hit", "stake_hit":
			var v: View = views.get(ev.did)
			if v:
				v.shake = 1.0 if ev.type == "struct_hit" else 0.6
				_burst("splinter", v.root.position + Vector3(0.2, 0.8, 0.3), 0.6 if ev.type == "stake_hit" else 1.0)
		"struct_broken", "demolished":
			_burst("dust", Vector3(ev.x, 0.4, 0.3), 1.6)
		"tower_shot":
			var v: View = views.get(ev.did)
			if v:
				v.face = 1.0 if ev.x1 >= v.root.position.x else -1.0
				v.draw = 1.0
		"oil":
			var v: View = views.get(ev.did)
			if v:
				_burst("flame", v.root.position + Vector3(0, 0.4, 0), 1.2)
				_burst("smoke", v.root.position + Vector3(0, 1.0, 0), 1.0)
		"fixed":
			for id in views:
				views[id].glint = 1.0
				_burst("glint", views[id].root.position + Vector3(0, 1.2, 0.4), 1.0)


func _pop(v: View) -> void:
	v.root.scale = Vector3(1.0, 0.05, 1.0)
	var tw := create_tween()
	tw.tween_property(v.root, "scale", Vector3.ONE, 0.45).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_burst("dust", v.root.position + Vector3(0, 0.2, 0.3), 1.0)


## ── Views ──

func _make_view(d: CastleSim.Defense) -> View:
	var v := View.new()
	v.id = d.id
	v.type = d.type
	v.slot = d.slot
	v.root = Node3D.new()
	v.root.name = "%s_%d" % [d.type, d.id]
	v.root.position = Vector3(d.x, 0, -2.6 if d.kind == "tower" else 0.0)
	add_child(v.root)
	v.body = Node3D.new()
	v.root.add_child(v.body)
	_build_into(v, d.type)
	return v


## Fills v.body with the pieces of a defence of this type (also used for the ghost).
func _build_into(v: View, type: String) -> void:
	match type:
		"stakes": _build_stakes(v)
		"barricade": _build_barricade(v, false)
		"reinforced": _build_barricade(v, true)
		"tower": _build_tower(v)
		"oil": _build_oil(v)


func _piece(v: View, mesh: Mesh, pos: Vector3, rot_deg: Vector3, hide_at := 99, tilt_at := 99, tilt := Vector3.ZERO, char_at := 99, scale := Vector3.ONE) -> Piece:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = pos
	mi.rotation_degrees = rot_deg
	mi.scale = scale
	v.body.add_child(mi)
	var p := Piece.new()
	p.node = mi
	p.hide_at = hide_at
	p.tilt_at = tilt_at
	p.tilt = tilt
	p.char_at = char_at
	p.base_rot = rot_deg
	p.base_pos = pos
	v.pieces.append(p)
	return p


func _apply_state(v: View) -> void:
	for p in v.pieces:
		p.node.visible = v.state < p.hide_at
		p.node.rotation_degrees = p.base_rot + (p.tilt if v.state >= p.tilt_at else Vector3.ZERO)
		p.node.position = p.base_pos + (Vector3(0, -0.12, 0) if v.state >= p.tilt_at else Vector3.ZERO)
		if p.node is MeshInstance3D:
			(p.node as MeshInstance3D).material_override = _char_mat if v.state >= p.char_at else null
	for e in v.extras:
		e[0].visible = v.state >= e[1]


static func _mesh(name: String, make: Callable) -> Mesh:
	if not _meshes.has(name):
		_meshes[name] = make.call()
	return _meshes[name]


## Sharpened stakes: a row of logs leaning at the enemy, lashed to a cross-beam, pale points with an iron cap.
func _build_stakes(v: View) -> void:
	v.body.rotation_degrees.y = TURN
	var log := _mesh("stake_log", func():
		var b := Kit.builder()
		b.add("cyl", Vector3(0, 0.95, 0), Vector3(0.22, 1.9, 0.22), WOOD, "wood")
		b.add("cone", Vector3(0, 2.12, 0), Vector3(0.22, 0.45, 0.22), WOOD_PALE, "wood")
		b.add("cyl", Vector3(0, 1.82, 0), Vector3(0.25, 0.1, 0.25), IRON, "metal")
		b.add("cone", Vector3(0, 2.33, 0), Vector3(0.07, 0.1, 0.07), IRON.lightened(0.2), "metal")
		b.add("ball_lo", Vector3(0, 0.02, 0), Vector3(0.3, 0.12, 0.3), WOOD_DARK, "wood")
		return b.mesh())
	var frame := _mesh("stake_frame", func():
		var b := Kit.builder()
		b.add("cyl", Vector3(0.12, 0.72, 0), Vector3(0.2, 3.7, 0.2), WOOD_DARK, "wood", Vector3(90, 0, 0))
		for z in [-1.65, 0.0, 1.65]:
			b.beam(Vector3(0.12, 0.72, z), Vector3(-0.75, -0.05, z), Vector2(0.14, 0.14), WOOD_DARK, "wood")
			b.add("ball_lo", Vector3(-0.75, 0.0, z), Vector3(0.35, 0.18, 0.3), Color("#8a8478"), "stone")
		for i in 7:
			var z := -1.5 + i * 0.5
			b.add("torus", Vector3(0.12, 0.72, z), Vector3(0.3, 0.42, 0.3), ROPE, "matte", Vector3(0, 0, 90))
		return b.mesh())
	_piece(v, frame, Vector3.ZERO, Vector3.ZERO, 99, 2, Vector3(0, 0, -6), 2)
	_piece(v, Kit.pack("props_rope_coil_01"), Vector3(-1.0, 0.0, 1.2), Vector3(0, 30, 0), 2, 1, Vector3(0, 0, 0), 99, Vector3.ONE * 1.2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 41
	for i in 7:
		var z := -1.5 + i * 0.5
		var lean := -38.0 + rng.randf_range(-5, 5) + (8.0 if i % 2 else 0.0)
		var hide := 1 if i in [1, 5] else (2 if i in [3, 6] else 99)
		var tilt := Vector3(rng.randf_range(-15, 15), 0, rng.randf_range(15, 35))
		var x := -0.55 + (0.18 if i % 2 else 0.0)
		_piece(v, log, Vector3(x, -0.15, z), Vector3(rng.randf_range(-4, 4), 0, lean), hide, 1 if i % 2 == 0 else 2, tilt, 2 if i in [0, 2, 4] else 99,
			Vector3(1, rng.randf_range(0.92, 1.08), 1))
	# broken stumps where logs snapped off
	var stump := _mesh("stake_stump", func():
		return Kit.builder().add("cyl", Vector3(0, 0.3, 0), Vector3(0.22, 0.6, 0.22), WOOD, "wood") \
			.add("cone4", Vector3(0, 0.66, 0), Vector3(0.24, 0.18, 0.24), WOOD_PALE, "wood", Vector3(0, 45, 20)).mesh())
	for i in [1, 5, 3, 6]:
		var mi := MeshInstance3D.new()
		mi.mesh = stump
		mi.position = Vector3(-0.55 + (0.18 if i % 2 else 0.0), -0.1, -1.5 + i * 0.5)
		mi.rotation_degrees = Vector3(0, 0, -38)
		mi.visible = false
		v.body.add_child(mi)
		v.extras.append([mi, 1 if i in [1, 5] else 2])


## A palisade of pointed planks with braces and sandbags; reinforced: heavy timbers, iron plates, rivets, spikes.
func _build_barricade(v: View, heavy: bool) -> void:
	v.body.rotation_degrees.y = TURN
	var key := "heavy" if heavy else "light"
	var plank := _mesh("plank_" + key, func():
		var b := Kit.builder()
		var w := 0.42 if heavy else 0.34
		var h := 2.3 if heavy else 2.0
		var c := WOOD_DARK.lightened(0.05) if heavy else WOOD
		b.add("box", Vector3(0, h * 0.5, 0), Vector3(0.2 if heavy else 0.14, h, w), c, "wood")
		b.add("prism", Vector3(0, h + 0.17, 0), Vector3(0.2 if heavy else 0.14, 0.34, w), c.lightened(0.15), "wood", Vector3(90, 0, 0) * 0.0)
		if heavy:
			b.add("box", Vector3(0.11, h * 0.62, 0), Vector3(0.04, 0.5, w * 0.9), IRON, "metal")
			for y in [h * 0.52, h * 0.72]:
				for z in [-w * 0.3, w * 0.3]:
					b.add("ball_lo", Vector3(0.14, y, z), Vector3(0.07, 0.07, 0.07), IRON.lightened(0.3), "metal")
		return b.mesh())
	var frame := _mesh("bframe_" + key, func():
		var b := Kit.builder()
		var c := WOOD_DARK if heavy else WOOD_DARK.lightened(0.1)
		for y in ([0.55, 1.45] if not heavy else [0.5, 1.2, 1.9]):
			b.add("box", Vector3(-0.14, y, 0), Vector3(0.14, 0.16, 3.3), c, "wood")
		for z in [-1.3, 0.0, 1.3]:
			b.beam(Vector3(-0.15, 1.6 if heavy else 1.4, z), Vector3(-1.1, 0.0, z), Vector2(0.16, 0.16), c, "wood")
		if heavy:
			for z in [-1.2, -0.4, 0.4, 1.2]:
				b.beam(Vector3(0.1, 0.5, z), Vector3(1.0, 0.85, z), Vector2(0.09, 0.09), IRON.darkened(0.2), "metal", "cone4")
		if heavy:
			for i in 7:
				b.add("ball_lo", Vector3(0.38, 0.18, -1.45 + i * 0.48), Vector3(0.5, 0.36, 0.45), Color("#8c877d"), "stone", Vector3(0, i * 40, 0))
		return b.mesh())
	_piece(v, frame, Vector3.ZERO, Vector3.ZERO, 99, 2, Vector3(0, 0, -5), 2)
	# the pile at the foot: sacks and crates (barrels behind the heavy one)
	if heavy:
		_piece(v, Kit.pack("props_barrel_01"), Vector3(-0.75, 0, -0.9), Vector3(0, 20, 0), 2, 1, Vector3(0, 0, 70), 99, Vector3.ONE * 1.3)
		_piece(v, Kit.pack("props_barrel_01"), Vector3(-0.8, 0, 0.7), Vector3(0, 70, 0), 99, 2, Vector3(80, 0, 0), 2, Vector3.ONE * 1.3)
		_piece(v, Kit.pack("props_crate_01"), Vector3(0.62, 0, 1.1), Vector3(0, 15, 0), 1, 99, Vector3.ZERO, 2, Vector3.ONE * 1.3)
	else:
		for i in 5:
			var z := -1.3 + i * 0.62
			var pack := "props_crate_01" if i == 2 else "props_sack_01"
			_piece(v, Kit.pack(pack), Vector3(0.45, 0, z), Vector3(0, i * 37.0, 0), 2 if i % 2 else 99, 2, Vector3(0, 0, -12), 99, Vector3.ONE * (1.2 if pack == "props_crate_01" else 1.0))
	var rng := RandomNumberGenerator.new()
	rng.seed = 77 if heavy else 13
	var n := 8
	var step := 3.2 / n
	for i in n:
		var z := -1.6 + step * (i + 0.5)
		var hide := 1 if i in [2, 6] else (2 if i in [0, 4, 7] else 99)
		_piece(v, plank, Vector3(0, -0.05, z), Vector3(0, 0, rng.randf_range(-3, 3)), hide, 1, Vector3(rng.randf_range(-12, 12), 0, rng.randf_range(-25, -10)),
			2 if i % 2 else 99, Vector3(1, rng.randf_range(0.88, 1.08), 1))
	# cracks (dark splits across the planks) once damaged
	var cracks := _mesh("cracks_" + key, func():
		var b := Kit.builder()
		var r := RandomNumberGenerator.new()
		r.seed = 5
		for k in 7:
			var z := r.randf_range(-1.4, 1.4)
			var y := r.randf_range(0.4, 1.7)
			b.beam(Vector3(0.09, y, z), Vector3(0.09, y + r.randf_range(-0.4, 0.4), z + r.randf_range(-0.3, 0.3)), Vector2(0.03, 0.04), Color("#1e140c"), "matte")
		return b.mesh())
	var cm := MeshInstance3D.new()
	cm.mesh = cracks
	cm.visible = false
	v.body.add_child(cm)
	v.extras.append([cm, 1])


## A wooden archery tower: four legs with cross-braces, a railed platform, a pyramid roof and an archer.
func _build_tower(v: View) -> void:
	v.body.rotation_degrees.y = TURN * 0.6
	var legs := _mesh("tower_legs", func():
		var b := Kit.builder()
		for sx in [-1, 1]:
			for sz in [-1, 1]:
				b.beam(Vector3(sx * 1.05, -0.1, sz * 1.05), Vector3(sx * 0.78, 5.0, sz * 0.78), Vector2(0.22, 0.22), WOOD_DARK, "wood")
				b.add("box", Vector3(sx * 1.05, 0.1, sz * 1.05), Vector3(0.45, 0.25, 0.45), Color("#8a8478"), "stone")
		# cross bracing on every side
		for side in 4:
			var a := Vector3(-1, 0, 1) if side == 0 else (Vector3(1, 0, 1) if side == 1 else (Vector3(1, 0, -1) if side == 2 else Vector3(-1, 0, -1)))
			var c := Vector3(1, 0, 1) if side == 0 else (Vector3(1, 0, -1) if side == 1 else (Vector3(-1, 0, -1) if side == 2 else Vector3(-1, 0, 1)))
			for lv in [[0.3, 2.5], [2.5, 4.7]]:
				var k0: float = lerpf(1.02, 0.8, lv[0] / 5.0)
				var k1: float = lerpf(1.02, 0.8, lv[1] / 5.0)
				b.beam(a * k0 + Vector3(0, lv[0], 0), c * k1 + Vector3(0, lv[1], 0), Vector2(0.1, 0.1), WOOD, "wood")
				b.beam(c * k0 + Vector3(0, lv[0], 0), a * k1 + Vector3(0, lv[1], 0), Vector2(0.1, 0.1), WOOD, "wood")
		# a ladder up the back
		b.beam(Vector3(-1.1, 0, 0.3), Vector3(-0.85, 5.0, 0.3), Vector2(0.07, 0.07), WOOD_PALE.darkened(0.2), "wood")
		b.beam(Vector3(-1.1, 0, -0.3), Vector3(-0.85, 5.0, -0.3), Vector2(0.07, 0.07), WOOD_PALE.darkened(0.2), "wood")
		for k in 9:
			var y := 0.4 + k * 0.52
			var x := lerpf(-1.1, -0.85, y / 5.0)
			b.add("box", Vector3(x, y, 0), Vector3(0.06, 0.06, 0.6), WOOD_PALE.darkened(0.2), "wood")
		return b.mesh())
	var deck := _mesh("tower_deck", func():
		var b := Kit.builder()
		b.add("box", Vector3(0, 5.05, 0), Vector3(2.3, 0.22, 2.3), WOOD, "wood")
		b.add("box", Vector3(0, 4.9, 0), Vector3(2.0, 0.12, 2.0), WOOD_DARK, "wood")
		return b.mesh())
	var rail := _mesh("tower_rail", func():
		var b := Kit.builder()
		for k in 5:
			b.add("box", Vector3(-1.05 + k * 0.525, 5.55, 1.08), Vector3(0.09, 0.85, 0.09), WOOD_DARK, "wood")
		b.add("box", Vector3(0, 5.95, 1.08), Vector3(2.25, 0.1, 0.1), WOOD, "wood")
		b.add("box", Vector3(0, 5.55, 1.1), Vector3(2.2, 0.5, 0.05), WOOD.lightened(0.05), "wood")
		return b.mesh())
	var roof := _mesh("tower_roof", func():
		var b := Kit.builder()
		for sx in [-1, 1]:
			for sz in [-1, 1]:
				b.add("box", Vector3(sx * 0.95, 6.35, sz * 0.95), Vector3(0.12, 2.4, 0.12), WOOD_DARK, "wood")
		b.add("cone4", Vector3(0, 8.05, 0), Vector3(3.6, 1.5, 3.6), Color("#a8452e"), "matte", Vector3(0, 45, 0))
		b.add("cone4", Vector3(0, 7.55, 0), Vector3(3.75, 0.25, 3.75), Color("#7e3020"), "matte", Vector3(0, 45, 0))
		b.add("cyl", Vector3(0, 9.1, 0), Vector3(0.05, 0.9, 0.05), WOOD_DARK, "wood")
		b.add("box", Vector3(0.25, 9.35, 0), Vector3(0.5, 0.3, 0.03), Color("#d8b13a"), "matte")
		return b.mesh())
	_piece(v, legs, Vector3.ZERO, Vector3.ZERO, 99, 2, Vector3(0, 0, 3), 2)
	_piece(v, deck, Vector3.ZERO, Vector3.ZERO, 99, 2, Vector3(0, 0, 3), 99)
	for side in 4:
		var rot := Vector3(0, side * 90.0, 0)
		_piece(v, rail, Vector3.ZERO, rot, 1 if side == 1 else (2 if side == 3 else 99), 2, Vector3(0, side * 90.0 * 0.0, 12), 2 if side == 0 else 99)
	_piece(v, roof, Vector3.ZERO, Vector3.ZERO, 99, 1, Vector3(-6, 0, 9), 2)
	_piece(v, Kit.pack("castle_brazier_01"), Vector3(-0.7, 5.16, -0.7), Vector3.ZERO, 2, 1, Vector3(0, 0, 25), 99, Vector3.ONE * 0.8)
	_piece(v, Kit.pack("castle_banner_01"), Vector3(0, 5.9, 1.16), Vector3.ZERO, 1, 99, Vector3.ZERO, 99, Vector3.ONE * 0.85)
	var cr := MeshInstance3D.new()
	cr.mesh = _mesh("tower_cracks", func():
		var b := Kit.builder()
		b.beam(Vector3(1.0, 1.0, 1.0), Vector3(0.86, 2.5, 0.9), Vector2(0.24, 0.24), Color("#2a1b10"), "matte")
		b.add("box", Vector3(0.4, 5.05, 1.16), Vector3(0.9, 0.24, 0.05), Color("#2a1b10"), "matte")
		return b.mesh())
	cr.visible = false
	v.body.add_child(cr)
	v.extras.append([cr, 1])
	# the archer on the platform
	v.archer = Node3D.new()
	v.archer.position = Vector3(0, 5.25, 0.15)
	v.body.add_child(v.archer)
	var fig := MeshInstance3D.new()
	fig.mesh = _mesh("tower_archer", func():
		var b := Kit.builder()
		var tunic := Color("#3f7a3a")
		b.add("capsule", Vector3(0, 0.75, 0), Vector3(0.42, 0.42, 0.36), tunic)
		b.add("ball", Vector3(0.02, 1.3, 0), Vector3(0.36, 0.38, 0.36), Color("#f0c49a"))
		b.add("cone", Vector3(-0.02, 1.47, 0), Vector3(0.44, 0.38, 0.44), tunic.darkened(0.25))
		b.add("box", Vector3(0, 0.62, 0), Vector3(0.44, 0.07, 0.38), Color("#5b3a1e"))
		# the bow, held forward (+x)
		for k in 7:
			var a0 := deg_to_rad(-60.0 + k * 20.0)
			var a1 := deg_to_rad(-60.0 + (k + 1) * 20.0)
			b.beam(Vector3(0.35 + cos(a0) * 0.12, 0.95 + sin(a0) * 0.5, 0.12), Vector3(0.35 + cos(a1) * 0.12, 0.95 + sin(a1) * 0.5, 0.12), Vector2(0.05, 0.05), WOOD_DARK, "wood")
		b.add("box", Vector3(0.18, 0.95, 0.12), Vector3(0.36, 0.08, 0.08), tunic.darkened(0.1))
		return b.mesh())
	v.archer.add_child(fig)
	v.bow_arm = MeshInstance3D.new()
	(v.bow_arm as MeshInstance3D).mesh = _mesh("tower_arm", func():
		return Kit.builder().add("box", Vector3(0.1, 0.95, 0.12), Vector3(0.3, 0.08, 0.08), Color("#f0c49a")) \
			.add("box", Vector3(0.22, 0.95, 0.12), Vector3(0.45, 0.025, 0.025), WOOD_PALE).mesh())
	v.archer.add_child(v.bow_arm)


## The oil trap: an iron cauldron sunk into the road, brimming with black oil, a puddle and a trip lever.
func _build_oil(v: View) -> void:
	v.body.rotation_degrees.y = TURN
	var pot := _mesh("oil_pot", func():
		var b := Kit.builder()
		b.add("cyl", Vector3(0, 0.02, 0), Vector3(2.6, 0.03, 1.9), Color("#231a12"), "metal")
		# the trip lever and a cord across the road
		b.beam(Vector3(0.55, 0.3, 0.3), Vector3(1.1, 1.05, 0.55), Vector2(0.07, 0.07), WOOD_DARK, "wood")
		b.add("ball_lo", Vector3(1.1, 1.08, 0.55), Vector3(0.14, 0.14, 0.14), Color("#c0392b"))
		b.beam(Vector3(1.1, 1.0, 0.55), Vector3(1.3, 0.12, -1.4), Vector2(0.025, 0.025), ROPE, "matte")
		b.add("box", Vector3(1.3, 0.12, -1.4), Vector3(0.1, 0.24, 0.1), WOOD_DARK, "wood")
		return b.mesh())
	_piece(v, pot, Vector3(0, -0.12, 0), Vector3.ZERO, 99, 2, Vector3(0, 0, 8), 2)
	_piece(v, Kit.pack("interiors_cauldron_01"), Vector3(0, -0.3, 0), Vector3.ZERO, 99, 2, Vector3(0, 0, 10), 2, Vector3.ONE * 1.9)
	var surf := MeshInstance3D.new()
	surf.mesh = _mesh("oil_surface", func():
		return Kit.builder().add("cyl", Vector3(0, 0.9, 0), Vector3(0.82, 0.04, 0.82), Color("#120c08"), "metal") \
			.add("ball_lo", Vector3(0.15, 0.92, 0.1), Vector3(0.16, 0.05, 0.16), Color("#3b2a1a"), "metal").mesh())
	surf.position.y = -0.12
	v.body.add_child(surf)
	v.oil_surface = surf
	var sc := MeshInstance3D.new()
	sc.mesh = _mesh("oil_scorch", func():
		var b := Kit.builder()
		b.add("cyl", Vector3(0, 0.04, 0), Vector3(3.6, 0.02, 2.6), Color("#0d0a08"), "matte")
		b.add("cyl", Vector3(0, 0.88, 0), Vector3(0.8, 0.03, 0.8), Color("#2a1e14"), "matte")
		return b.mesh())
	sc.visible = false
	v.body.add_child(sc)
	v.scorch = sc


## ── Destruction ──

func _destroy(v: View) -> void:
	var gx := v.root.global_transform
	for p in v.pieces:
		if not p.node.visible or not (p.node is MeshInstance3D):
			continue
		var mi := MeshInstance3D.new()
		mi.mesh = (p.node as MeshInstance3D).mesh
		mi.material_override = _char_mat
		add_child(mi)
		mi.global_transform = p.node.global_transform
		var out := (mi.global_position - gx.origin)
		var vel := Vector3(randf_range(1.0, 4.0), randf_range(3.0, 7.0), out.z * 1.5 + randf_range(-1.5, 1.5))
		_debris.append([mi, vel, Vector3(randf_range(-6, 6), randf_range(-3, 3), randf_range(-8, 8)), 0.0])
	_burst("splinter", v.root.position + Vector3(0, 1.0, 0.2), 1.6)
	_burst("splinter", v.root.position + Vector3(0, 0.4, -0.3), 1.2)
	_burst("dust", v.root.position + Vector3(0, 0.3, 0.3), 2.0)
	v.root.queue_free()


## ── Build mode ──

## Marks the first `open` slots; with a defence type selected and a slot hovered, a ghost of it there (green when
## it can be built, red with `why` when not).
func show_slots(open: int, selected: String, hover: int, why: String) -> void:
	if _slots.is_empty():
		_make_slots()
	for i in _slots.size():
		var on := i < open
		var plate: MeshInstance3D = _slots[i][0]
		plate.visible = on
		_slots[i][1].visible = on
		if not on:
			continue
		var m: ShaderMaterial = plate.material_override
		var hovered := i == hover
		var taken := _occupied.has(i)
		m.set_shader_parameter("mode", 4 if hovered else 3)
		var tint := Color(1.0, 0.86, 0.45, 0.9)
		if taken:
			tint = Color(0.7, 0.7, 0.75, 0.55)
		if hovered:
			tint = Color(0.45, 1.0, 0.5, 1.0) if why == "" else Color(1.0, 0.35, 0.3, 1.0)
		m.set_shader_parameter("tint", tint)
	var want := selected != "" and hover >= 0 and hover < open
	if want and (selected != _ghost_type or (why == "") != _ghost_ok or _ghost == null):
		if _ghost:
			_ghost.queue_free()
		_ghost = _make_ghost(selected, why == "")
		_ghost_type = selected
		_ghost_ok = why == ""
	if _ghost:
		_ghost.visible = want
		if want:
			_ghost.position = Vector3(CastleSim.SLOT_X[hover], 0.02, -2.6 if selected == "tower" else 0.0)
			var k := 1.0 + 0.03 * sin(_t * 6.0)
			_ghost.scale = Vector3(k, k, k)


func hide_slots() -> void:
	for s in _slots:
		s[0].visible = false
		s[1].visible = false
	if _ghost:
		_ghost.visible = false


func _make_slots() -> void:
	var font := load("res://assets/fonts/GolosText.ttf")
	for i in CastleSim.SLOT_X.size():
		var x: float = CastleSim.SLOT_X[i]
		var plate := MeshInstance3D.new()
		var q := QuadMesh.new()
		q.size = Vector2(2.6, 3.6)
		plate.mesh = q
		plate.rotation_degrees = Vector3(-90, 0, 0)
		plate.position = Vector3(x, 0.07, 0)
		var m := ShaderMaterial.new()
		m.shader = FX_SHADER
		m.set_shader_parameter("mode", 3)
		plate.material_override = m
		plate.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(plate)
		var post := Node3D.new()
		post.position = Vector3(x + 0.9, 0, 2.0)
		post.add_child(Kit.builder().add("cyl", Vector3(0, 0.55, 0), Vector3(0.1, 1.1, 0.1), WOOD_DARK, "wood") \
			.add("box", Vector3(0.22, 1.05, 0), Vector3(0.45, 0.32, 0.04), Color("#e8c46a")).instance())
		var lab := Label3D.new()
		lab.text = str(i + 1)
		lab.font = font
		lab.font_size = 48
		lab.pixel_size = 0.02
		lab.outline_size = 10
		lab.modulate = Color("#3a2410")
		lab.outline_modulate = Color("#f6e3b0")
		lab.position = Vector3(0.22, 1.05, 0.05)
		post.add_child(lab)
		add_child(post)
		plate.visible = false
		post.visible = false
		_slots.append([plate, post, lab])


func _make_ghost(type: String, ok: bool) -> Node3D:
	var v := View.new()
	v.root = Node3D.new()
	v.body = Node3D.new()
	v.root.add_child(v.body)
	_build_into(v, type)
	var key := "ok" if ok else "bad"
	if not _ghost_mats.has(key):
		var m := StandardMaterial3D.new()
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.albedo_color = Color(0.45, 1.0, 0.5, 0.42) if ok else Color(1.0, 0.3, 0.25, 0.42)
		_ghost_mats[key] = m
	_ghost_paint(v.root, _ghost_mats[key])
	add_child(v.root)
	return v.root


func _ghost_paint(n: Node, m: Material) -> void:
	if n is MeshInstance3D:
		(n as MeshInstance3D).material_override = m
		(n as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for c in n.get_children():
		_ghost_paint(c, m)


## ── Particles (a few pooled one-shot emitters per kind) ──

func _burst(kind: String, at: Vector3, scale := 1.0) -> void:
	if not _pools.has(kind):
		_pools[kind] = {list = [], next = 0}
		for k in 4:
			var p := _emitter(kind)
			add_child(p)
			_pools[kind].list.append(p)
	var pool: Dictionary = _pools[kind]
	var p: CPUParticles3D = pool.list[pool.next]
	pool.next = (pool.next + 1) % pool.list.size()
	p.position = at
	p.scale_amount_min = p.get_meta("smin") * scale
	p.scale_amount_max = p.get_meta("smax") * scale
	p.restart()


func _emitter(kind: String) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = false
	p.explosiveness = 0.95
	p.local_coords = false
	var smin := 1.0
	var smax := 1.0
	match kind:
		"splinter":
			p.amount = 12
			p.lifetime = 0.9
			var b := Kit.builder().add("box", Vector3.ZERO, Vector3(0.05, 0.05, 0.28), Color.WHITE, "wood")
			p.mesh = b.mesh()
			p.direction = Vector3(0.4, 1, 0)
			p.spread = 70.0
			p.initial_velocity_min = 3.0
			p.initial_velocity_max = 6.5
			p.gravity = Vector3(0, -15, 0)
			p.angular_velocity_min = -720
			p.angular_velocity_max = 720
			p.particle_flag_rotate_y = true
			p.color = WOOD.lightened(0.15)
			smin = 0.7
			smax = 1.4
		"dust":
			p.amount = 12
			p.lifetime = 1.1
			p.mesh = CastleWorld._soft_ball(Color(0.78, 0.68, 0.52, 0.55))
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
			p.emission_box_extents = Vector3(0.9, 0.1, 1.2)
			p.direction = Vector3(0, 1, 0)
			p.spread = 70.0
			p.initial_velocity_min = 0.8
			p.initial_velocity_max = 2.2
			p.gravity = Vector3(0, -0.6, 0)
			p.damping_min = 1.5
			p.damping_max = 2.5
			smin = 0.5
			smax = 1.0
			var c := Curve.new()
			c.add_point(Vector2(0, 0.5))
			c.add_point(Vector2(1, 1.8))
			p.scale_amount_curve = c
			var g := Gradient.new()
			g.set_color(0, Color(1, 1, 1, 0.75))
			g.set_color(1, Color(1, 1, 1, 0))
			p.color_ramp = g
		"flame":
			p.amount = 18
			p.lifetime = 0.7
			var m := SphereMesh.new()
			m.radius = 0.5
			m.height = 1.0
			m.radial_segments = 8
			m.rings = 4
			var mat := StandardMaterial3D.new()
			mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			mat.vertex_color_use_as_albedo = true
			mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			mat.albedo_color = Color(2.2, 1.4, 0.7)
			m.material = mat
			p.mesh = m
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
			p.emission_sphere_radius = 0.9
			p.direction = Vector3(0, 1, 0)
			p.spread = 30.0
			p.initial_velocity_min = 2.0
			p.initial_velocity_max = 4.5
			p.gravity = Vector3(0, 2, 0)
			smin = 0.4
			smax = 0.9
			var g := Gradient.new()
			g.set_color(0, Color(1.0, 0.85, 0.4, 1))
			g.add_point(0.5, Color(1.0, 0.4, 0.1, 0.8))
			g.set_color(g.get_point_count() - 1, Color(0.3, 0.1, 0.05, 0))
			p.color_ramp = g
		"smoke":
			p.amount = 10
			p.lifetime = 2.0
			p.mesh = CastleWorld._soft_ball(Color(0.2, 0.18, 0.17, 0.5))
			p.direction = Vector3(0.2, 1, 0)
			p.spread = 20.0
			p.initial_velocity_min = 1.0
			p.initial_velocity_max = 2.0
			p.gravity = Vector3(0.3, 0.5, 0)
			smin = 0.8
			smax = 1.6
			var g := Gradient.new()
			g.set_color(0, Color(1, 1, 1, 0.7))
			g.set_color(1, Color(1, 1, 1, 0))
			p.color_ramp = g
		"glint":
			p.amount = 10
			p.lifetime = 0.6
			var b := Kit.builder().add("box", Vector3.ZERO, Vector3(0.1, 0.1, 0.1), Color.WHITE, "glow")
			p.mesh = b.mesh()
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
			p.emission_sphere_radius = 1.2
			p.direction = Vector3(0, 1, 0)
			p.spread = 40.0
			p.initial_velocity_min = 0.5
			p.initial_velocity_max = 1.5
			p.gravity = Vector3.ZERO
			p.color = Color(1.0, 0.95, 0.6)
	p.set_meta("smin", smin)
	p.set_meta("smax", smax)
	p.scale_amount_min = smin
	p.scale_amount_max = smax
	return p
