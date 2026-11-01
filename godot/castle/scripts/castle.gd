class_name CastleKeep
extends Node3D
## The castle: the gameplay wall is the gatehouse at x ∈ [0, 3] (its right side is what the enemies hit), the
## archer stands on its battlements at CastleSim.ARCHER. Built from the Avramania Castle & Siege models: a round
## gatehouse with its door facing the viewer (as in the web version), the keep with its roof and flag, a curtain
## wall, banners, a brazier and torches.
## Damage follows the wall's real health (set_health): soot darkens the stone, cracks spread over the gatehouse,
## rubble piles up at its foot, smoke and then fire rise, the gate sags and the banners fall. repair() plays a
## warm glint over the mended stone.

const STONE := Color("#b9ad98")
const STONE_DARK := Color("#8f8473")
const MORTAR := Color("#6c6255")
const ROOF := Color("#3f5f95")
const WOOD := Color("#7a5232")
const IRON := Color("#3d3d42")
const CLOTH := Color("#b8282e")

var world: CastleWorld
var _rng := RandomNumberGenerator.new()
var _health := 1.0
var _shown := 1.0
var _shake := 0.0
var gate_l: Node3D
var gate_r: Node3D
var archer: Node3D
var arm: Node3D
var bow_string: MeshInstance3D
var _draw := 0.0
var _snap := 0.0
var _aim := 0.6
var _fires: Array[Node3D] = []
var _smokes: Array[Node3D] = []
var rubble: MultiMeshInstance3D
var _t := 0.0
var _repair_t := 0.0


func build(w: CastleWorld) -> void:
	world = w
	_rng.seed = 1234
	var night: bool = w.env.get("torches", false)
	_material = (Kit.palette_material() as StandardMaterial3D).duplicate()
	_structure()
	_cracks()
	_torches(night)
	_archer()
	_rubble()
	_fire_and_smoke()
	set_health(1.0, true)


var _material: StandardMaterial3D
var _parts: Array[MeshInstance3D] = []
var _crack_nodes: Array = []         # [node, shows below]
var banner_l: Node3D
var banner_r: Node3D
const GATEHOUSE := Vector3(0.75, 0, 0.4)
const KEEP := Vector3(-5.6, 0, -2.8)
const S_GATE := 1.1
const S_KEEP := 1.3


func _piece(name: String, at: Vector3, scale := 1.0, yaw := 0.0) -> MeshInstance3D:
	var mi := Kit.pack_node(name, at, scale, yaw)
	mi.material_override = _material
	add_child(mi)
	_parts.append(mi)
	return mi


## The castle from the Avramania Castle & Siege pieces (assets/avramania, CC0): the gatehouse is a round tower
## whose battlements are the archer's platform at the wall top (CastleSim.WALL_TOP); the keep stands behind it
## with its roof and flag; a curtain wall runs off to the left.
func _structure() -> void:
	var g := GATEHOUSE
	_piece("castle_tower_round_base_01", g, S_GATE)
	_piece("castle_tower_round_door_01", g + Vector3(0, 2.4 * S_GATE, 0), S_GATE, 90.0)
	_piece("castle_tower_round_top_01", g + Vector3(0, 7.2 * S_GATE, 0), S_GATE)
	var k := KEEP
	_piece("castle_tower_round_base_01", k, S_KEEP)
	for i in 4:
		_piece("castle_tower_round_mid_01", k + Vector3(0, (2.4 + i * 2.4) * S_KEEP, 0), S_KEEP, i * 37.0)
	_piece("castle_tower_round_top_01", k + Vector3(0, 12.0 * S_KEEP, 0), S_KEEP)
	_piece("castle_tower_round_roof_01", k + Vector3(0, 12.0 * S_KEEP + 0.4, 0), S_KEEP * 1.05)
	add_child(world.flag(k + Vector3(0, 12.0 * S_KEEP + 2.45 * S_KEEP * 1.05 + 0.2, 0), CLOTH, Color("#3a2a20"), 2.8))
	# the curtain wall: plain and arrow-slit pieces, a gate in the middle, running left out of view
	var x := -3.4
	var names := ["castle_curtain_slit_01", "castle_curtain_01", "castle_curtain_gate_01", "castle_curtain_01", "castle_curtain_slit_01", "castle_curtain_01", "castle_curtain_slit_01"]
	for n in names:
		var w := 4.0 if n == "castle_curtain_gate_01" else 2.0
		x -= w * 1.15
		_piece(n, Vector3(x, 0, 1.4), 1.15)
	# the gate leaves in the gatehouse door, facing the viewer as in the web version
	gate_l = Node3D.new()
	gate_l.position = g + Vector3(0, 2.4 * S_GATE, 2.02 * S_GATE)
	add_child(gate_l)
	var doors := Kit.pack_node("castle_gate_doors_01", Vector3.ZERO, 0.82)
	doors.material_override = _material
	gate_l.add_child(doors)
	gate_r = gate_l
	banner_l = _piece("castle_banner_01", g + Vector3(-1.25, 7.0, 2.05), 1.05, -28.0)
	banner_r = _piece("castle_banner_01", g + Vector3(1.6, 7.0, 1.72), 1.05, 32.0)
	_piece("castle_brazier_01", g + Vector3(-1.2, 7.95, -0.6), 1.0)
	_piece("castle_banner_01", KEEP + Vector3(0.6, 10.5, 2.75), 1.3, 12.0)
	# barrels and crates by the gate
	for p in [[Vector3(3.6, 0, 2.9), "props_barrel_01", 1.2], [Vector3(4.3, 0, 3.4), "props_crate_01", 1.3], [Vector3(-2.2, 0, 3.6), "props_barrel_01", 1.1], [Vector3(-2.9, 0, 3.2), "props_sack_01", 1.2]]:
		_piece(p[1], p[0], p[2], _rng.randf() * 360.0)


## Cracks on the gatehouse face, each showing below its own health share: jagged dark lines of short beams.
func _cracks() -> void:
	var center := GATEHOUSE
	var r := 2.05 * S_GATE
	for k in 7:
		var b := Kit.builder()
		var a := deg_to_rad(_rng.randf_range(-60.0, 60.0))
		var y := _rng.randf_range(1.0, 7.0)
		var p := Vector3(sin(a) * r, y, cos(a) * r)
		for seg in 5:
			a += _rng.randf_range(-0.18, 0.18)
			var q := Vector3(sin(a) * (r + 0.02), p.y + _rng.randf_range(-0.6, -0.15), cos(a) * (r + 0.02))
			b.beam(p, q, Vector2(0.07, 0.03), Color(0.1, 0.08, 0.07))
			p = q
		var n := b.instance("Crack")
		n.position = center
		add_child(n)
		_crack_nodes.append([n, 0.9 - k * 0.11])


## Torches by the gate and on the battlements; warm lights that flicker (strong at dusk and night).
func _torches(night: bool) -> void:
	var g := GATEHOUSE
	for p in [g + Vector3(-1.45, 3.6, 1.75), g + Vector3(1.45, 3.6, 1.75), g + Vector3(2.0, 8.6, 1.1)]:
		var b := Kit.builder()
		b.add("cyl", Vector3(0, -0.25, 0), Vector3(0.1, 0.6, 0.1), Color("#4a3020"), "wood")
		b.add("cone", Vector3(0, 0.12, 0), Vector3(0.24, 0.18, 0.24), IRON, "metal", Vector3(180, 0, 0))
		b.add("ball", Vector3(0, 0.25, 0), Vector3(0.22, 0.36, 0.22), Color(1.0, 0.75, 0.3), "glow")
		var t := b.instance("Torch")
		t.position = p
		add_child(t)
		var flame := CPUParticles3D.new()
		flame.amount = 10
		flame.lifetime = 0.5
		flame.mesh = CastleWorld._soft_ball(Color(1.0, 0.6, 0.2, 0.8))
		flame.direction = Vector3.UP
		flame.spread = 10.0
		flame.initial_velocity_min = 0.6
		flame.initial_velocity_max = 1.1
		flame.gravity = Vector3.ZERO
		flame.scale_amount_min = 0.12
		flame.scale_amount_max = 0.22
		var gr := Gradient.new()
		gr.set_color(0, Color(1.6, 1.0, 0.4, 0.9))
		gr.set_color(1, Color(1.0, 0.3, 0.1, 0.0))
		flame.color_ramp = gr
		flame.position = p + Vector3(0, 0.35, 0)
		add_child(flame)
		var light := OmniLight3D.new()
		light.light_color = Color(1.0, 0.65, 0.3)
		light.light_energy = 2.2 if night else 0.7
		light.omni_range = 7.0 if night else 4.0
		light.position = p + Vector3(0, 0.5, 0.4)
		add_child(light)
		world.add_flicker(light)


## The player's archer on the battlements: the body turns with the aim, the bow arm points along it.
func _archer() -> void:
	archer = Node3D.new()
	archer.position = Vector3(CastleSim.ARCHER.x - 0.2, 7.2 * S_GATE + 0.1, 0.9)
	var b := Kit.builder()
	var tunic := Color("#2f6b45")
	b.add("box", Vector3(0, 0.45, 0), Vector3(0.36, 0.9, 0.42), Color("#4a3428"))
	b.add("box", Vector3(0, 1.05, 0), Vector3(0.44, 0.62, 0.5), tunic)
	b.add("box", Vector3(0, 0.78, 0), Vector3(0.48, 0.12, 0.54), Color("#5a3a22"))
	b.add("ball", Vector3(0.02, 1.55, 0), Vector3(0.42, 0.44, 0.42), Color("#f0c49a"))
	b.add("half", Vector3(-0.02, 1.62, 0), Vector3(0.5, 0.42, 0.5), tunic.darkened(0.2))
	b.add("cone", Vector3(-0.12, 1.75, 0), Vector3(0.36, 0.42, 0.36), tunic.darkened(0.2), "matte", Vector3(0, 0, 35))
	b.add("box", Vector3(-0.26, 1.1, 0.0), Vector3(0.14, 0.7, 0.2), Color("#6a4628"), "wood", Vector3(0, 0, 12))
	for k in 4:
		b.add("cyl", Vector3(-0.3 + k * 0.02, 1.52, -0.04 + k * 0.03), Vector3(0.025, 0.3, 0.025), Color("#d8d0c0"), "matte", Vector3(0, 0, 12))
	archer.add_child(b.instance("Body"))
	arm = Node3D.new()
	arm.position = Vector3(0.1, 1.25, 0.05)
	var ab := Kit.builder()
	ab.beam(Vector3.ZERO, Vector3(0.55, 0, 0), Vector2(0.13, 0.13), tunic.lightened(0.1))
	# the bow: an arc of short segments
	var prev := Vector3.ZERO
	for k in 9:
		var a := lerpf(-1.1, 1.1, k / 8.0)
		var p := Vector3(0.6 + cos(a) * 0.12 - 0.12 + absf(a) * -0.05, sin(a) * 0.6, 0)
		if k > 0:
			ab.beam(prev, p, Vector2(0.06, 0.06), Color("#8a5a2a"), "wood")
		prev = p
	ab.add("box", Vector3(0.56, 0, 0), Vector3(0.08, 0.14, 0.09), Color("#3a2a20"))
	arm.add_child(ab.instance("Bow"))
	bow_string = Kit.builder().add("box", Vector3.ZERO, Vector3(0.015, 1.0, 0.015), Color(0.95, 0.95, 0.9), "glow").instance("String")
	arm.add_child(bow_string)
	archer.add_child(arm)
	add_child(archer)


func set_aim(angle: float, drawing: bool) -> void:
	_aim = angle
	_draw = move_toward(_draw, 1.0 if drawing else 0.0, 0.25)


func shoot() -> void:
	_snap = 1.0


## ── Damage ──

func _rubble() -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = Kit.builder().add("box", Vector3.ZERO, Vector3.ONE, Color.WHITE, "stone").mesh()
	mm.instance_count = 40
	for i in 40:
		var s := _rng.randf_range(0.25, 0.6)
		var p := Vector3(_rng.randf_range(2.6, 5.2), s * 0.3, _rng.randf_range(-2.0, 3.4))
		mm.set_instance_transform(i, Transform3D(Basis.from_euler(Vector3(_rng.randf(), _rng.randf() * TAU, _rng.randf())).scaled(Vector3(s, s * 0.7, s)), p))
		mm.set_instance_color(i, STONE.lerp(STONE_DARK, _rng.randf()))
	mm.visible_instance_count = 0
	rubble = MultiMeshInstance3D.new()
	rubble.multimesh = mm
	add_child(rubble)


func _fire_and_smoke() -> void:
	for p in [Vector3(-0.8, 8.3, 1.4), Vector3(1.9, 8.3, -1.0), Vector3(-4.2, 13.6, 0.4)]:
		var smoke := world._smoke(p, 1.6)
		smoke.emitting = false
		add_child(smoke)
		_smokes.append(smoke)
		var fire := CPUParticles3D.new()
		fire.amount = 16
		fire.lifetime = 0.7
		fire.mesh = CastleWorld._soft_ball(Color(1.0, 0.55, 0.15, 0.85))
		fire.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
		fire.emission_sphere_radius = 0.5
		fire.direction = Vector3.UP
		fire.spread = 15.0
		fire.initial_velocity_min = 1.2
		fire.initial_velocity_max = 2.4
		fire.gravity = Vector3.ZERO
		fire.scale_amount_min = 0.35
		fire.scale_amount_max = 0.7
		var g := Gradient.new()
		g.set_color(0, Color(1.8, 1.1, 0.3, 0.9))
		g.set_color(1, Color(0.9, 0.2, 0.05, 0.0))
		fire.color_ramp = g
		fire.position = p
		fire.emitting = false
		add_child(fire)
		_fires.append(fire)


## The wall's health share (0..1). The castle shows exactly this: soot, cracks, rubble, smoke and fire, the
## sagging gate, the banners. instant skips the falling.
func set_health(f: float, instant := false) -> void:
	_health = clampf(f, 0.0, 1.0)
	if instant:
		_shown = _health
		_apply()


func hit() -> void:
	_shake = 0.25


## Stones knit back after the wall is repaired or fortified.
func repair() -> void:
	_repair_t = 1.0
	var aura := CastleFlipbook.make("magic_heal_aura", 9.0)
	if aura:
		aura.position = GATEHOUSE + Vector3(0, 4.5, 2.6)
		add_child(aura)
		# the aura loops: let it glow for a moment and fade
		var tw := aura.create_tween()
		tw.tween_interval(1.2)
		tw.tween_property(aura, "modulate:a", 0.0, 0.6)
		tw.tween_callback(aura.queue_free)


func _apply() -> void:
	# soot darkens the stones as the wall weakens
	_material.albedo_color = Color.WHITE.lerp(Color(0.62, 0.56, 0.5), 1.0 - _shown)
	for c in _crack_nodes:
		c[0].visible = _shown < c[1]
	rubble.multimesh.visible_instance_count = int((1.0 - _shown) * 40.0)
	var low := _shown < 0.4
	var lower := _shown < 0.2
	for k in _smokes.size():
		_smokes[k].emitting = _shown < 0.55 - k * 0.12
	for k in _fires.size():
		_fires[k].emitting = (low and k == 0) or (lower and k > 0)
	# the gate sags below a third; the banners tear and fall
	gate_l.rotation.z = -0.07 if _shown < 0.33 else 0.0
	banner_r.visible = _shown >= 0.5
	banner_l.rotation.z = 0.25 if _shown < 0.25 else 0.0


func _process(delta: float) -> void:
	_t += delta
	if absf(_shown - _health) > 0.001:
		_shown = move_toward(_shown, _health, delta * 0.5)
		_apply()
	if _shake > 0.0:
		_shake = maxf(0.0, _shake - delta)
		position = Vector3(sin(_t * 80.0), cos(_t * 67.0), 0) * _shake * 0.12
	else:
		position = Vector3.ZERO
	if _repair_t > 0.0:
		# a warm glint runs over the stones as they are mended
		_repair_t = maxf(0.0, _repair_t - delta * 1.2)
		_material.albedo_color = _material.albedo_color.lerp(Color(1.25, 1.15, 0.95), sin(_repair_t * PI) * 0.5)
	if archer:
		_snap = maxf(0.0, _snap - delta * 6.0)
		arm.rotation.z = lerp_angle(arm.rotation.z, _aim, minf(1.0, delta * 18.0))
		archer.rotation.y = -0.35
		var pull := _draw * (1.0 - _snap)
		bow_string.position = Vector3(0.5 - pull * 0.35, 0, 0)
		bow_string.scale = Vector3(1, 1.15 - pull * 0.1, 1)
		archer.get_child(0).rotation.z = sin(_t * 1.6) * 0.02
