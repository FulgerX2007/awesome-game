class_name CastleFx
extends Node3D
## Combat effects over the world: the player's arrows in flight, enemy missiles, burning and cursed ground,
## bosses' warnings on the ground, the aim preview, hit sparks, dust, splinters and explosions, floating numbers.
## Everything is pooled: meshes for arrows and missiles, a few one-shot CPUParticles3D per kind of burst, one shared
## trail emitter fed by emit_particle(), Label3D numbers. Units are the simulation's metres on the lane z = 0.
##   setup(world) once; sync(sim, delta) every frame; on_event(ev) for each event drained from the sim.

const FX_SHADER := preload("res://shaders/ground_fx.gdshader")
const FONT_PATH := "res://assets/fonts/GolosText.ttf"
const TINT := {
	# HDR tints: the warnings must read on a sunlit road after tonemapping
	charge = Color(1.9, 0.4, 0.15), slam = Color(1.9, 0.4, 0.15), leap = Color(1.9, 0.3, 0.2), shockwave = Color(1.9, 0.3, 0.25),
	breath = Color(2.0, 0.9, 0.15), curse = Color(1.2, 0.5, 2.0), summon = Color(1.2, 0.5, 2.0),
}

var world: CastleWorld
var _t := 0.0
var _arrows: Array[Node3D] = []
var _fire_arrows: Array[Node3D] = []
var _missiles := {}                 # kind -> Array of nodes
var _lights: Array[OmniLight3D] = []
var _stuck: Array = []              # [node, age, life]
var _stuck_pool: Array[Node3D] = []
var _decals: Array = []             # {node, mat, t, dur, used}
var _zone_decals: Array = []        # pooled decals for sim zones
var _zone_emitters := {}            # "fire"/"curse" -> Array[CPUParticles3D]
var _pools := {}
var _trail: MultiMeshInstance3D    # glowing beads left by fire arrows, fireballs and bolts (ring buffer)
var _trail_p: Array = []            # [pos, vel, color, size, age]
var _trail_next := 0
const TRAIL_N := 220
const TRAIL_LIFE := 0.5
var _aim: MultiMeshInstance3D
var _labels: Array = []             # {label, age, life, vel}
var _font: Font
var _coins: Array = []              # {node, age}
var _boss_ids := {}
var _boss_dmg := {}                 # id -> [amount, x, y, timer]
var _sim_id := 0


func setup(w: CastleWorld) -> void:
	world = w


func _init() -> void:
	_font = load(FONT_PATH)
	_trail = MultiMeshInstance3D.new()
	var tm := MultiMesh.new()
	tm.transform_format = MultiMesh.TRANSFORM_3D
	tm.use_colors = true
	tm.mesh = _glow_ball()
	tm.instance_count = TRAIL_N
	_trail.multimesh = tm
	_trail.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for i in TRAIL_N:
		_trail_p.append([Vector3.ZERO, Vector3.ZERO, Color(), 0.0, 99.0])
		tm.set_instance_transform(i, Transform3D(Basis().scaled(Vector3.ZERO), Vector3.ZERO))
	add_child(_trail)
	_aim = MultiMeshInstance3D.new()
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var bead := SphereMesh.new()
	bead.radius = 0.5
	bead.height = 1.0
	bead.radial_segments = 8
	bead.rings = 4
	var bm := StandardMaterial3D.new()
	bm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	bm.vertex_color_use_as_albedo = true
	bm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	bm.no_depth_test = true
	bead.material = bm
	mm.mesh = bead
	mm.instance_count = 64
	mm.visible_instance_count = 0
	_aim.multimesh = mm
	_aim.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_aim)


## ── Per frame ──

func sync(sim: CastleSim, delta: float) -> void:
	_t += delta
	if sim.get_instance_id() != _sim_id:
		_sim_id = sim.get_instance_id()
		_reset()
	_boss_ids.clear()
	for e in sim.enemies:
		if e.boss:
			_boss_ids[e.id] = true
			_last_x = e.x
	_sync_arrows(sim)
	_sync_shots(sim)
	_sync_zones(sim)
	_age(delta)


func _reset() -> void:
	for s in _stuck:
		s[0].visible = false
	_stuck.clear()
	for d in _decals:
		d.node.visible = false
		d.used = false
	for c in _coins:
		c.node.queue_free()
	_coins.clear()
	_boss_dmg.clear()


func _sync_arrows(sim: CastleSim) -> void:
	var fire := bool(sim.stats().burn)
	var list := _fire_arrows if fire else _arrows
	var other := _arrows if fire else _fire_arrows
	for a in other:
		a.visible = false
	var i := 0
	for a in sim.arrows:
		if i >= list.size():
			var made := _arrow_node(fire, 1.6)
			add_child(made)
			list.append(made)
		var n: Node3D = list[i]
		n.visible = true
		n.position = Vector3(a.x, a.y, 0.15)
		n.rotation = Vector3(0, 0, atan2(a.vy, a.vx))
		if fire and Engine.get_process_frames() % 2 == 0:
			_trail_emit(n.position, Color(1.0, 0.55, 0.15), 0.8)
		i += 1
	for k in range(i, list.size()):
		list[k].visible = false


func _sync_shots(sim: CastleSim) -> void:
	var used := {}
	var light_i := 0
	for s in sim.shots:
		var kind: String = s.kind
		var k: int = used.get(kind, 0)
		used[kind] = k + 1
		var n := _missile(kind, k)
		n.visible = true
		var f: float = clampf(s.t / s.dur, 0.0, 1.0)
		var p := _arc_point(s, f)
		var q := _arc_point(s, minf(1.0, f + 0.02))
		n.position = p
		match kind:
			"arrow":
				n.rotation = Vector3(0, 0, atan2(q.y - p.y, q.x - p.x))
			"boulder":
				n.rotation = Vector3(_t * 3.0, 0, _t * 7.0)
			"fireball":
				var k2 := 1.0 + 0.12 * sin(_t * 30.0)
				n.scale = Vector3(k2, k2, k2)
				_trail_emit(p, Color(1.0, 0.5, 0.12), 1.8)
				_trail_emit(p + Vector3(randf_range(-0.2, 0.2), randf_range(-0.2, 0.2), 0), Color(1.0, 0.8, 0.3), 1.2)
				if light_i < 4:
					var l := _light(light_i)
					l.visible = true
					l.light_color = Color(1.0, 0.55, 0.2)
					l.position = p
					light_i += 1
			"bolt":
				n.rotation = Vector3(0, _t * 4.0, _t * 6.0)
				_trail_emit(p, Color(0.7, 0.35, 1.0), 1.3)
				if light_i < 4:
					var l := _light(light_i)
					l.visible = true
					l.light_color = Color(0.65, 0.35, 1.0)
					l.position = p
					light_i += 1
	for kind in _missiles:
		var arr: Array = _missiles[kind]
		for k in range(used.get(kind, 0), arr.size()):
			arr[k].visible = false
	for k in range(light_i, _lights.size()):
		_lights[k].visible = false


func _arc_point(s: Dictionary, f: float) -> Vector3:
	var x := lerpf(s.x0, s.x1, f)
	var y := lerpf(s.y0, s.y1, f) + float(s.arc) * 4.0 * f * (1.0 - f)
	return Vector3(x, y, 0.2)


func _light(i: int) -> OmniLight3D:
	while _lights.size() <= i:
		var l := OmniLight3D.new()
		l.light_energy = 2.5
		l.omni_range = 7.0
		l.shadow_enabled = false
		add_child(l)
		_lights.append(l)
	return _lights[i]


func _missile(kind: String, k: int) -> Node3D:
	if not _missiles.has(kind):
		_missiles[kind] = []
	var arr: Array = _missiles[kind]
	while arr.size() <= k:
		var n := MeshInstance3D.new()
		n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		match kind:
			"arrow": n.mesh = _arrow_mesh(false, true)
			"boulder":
				# the pack's boulder, centred on its middle and shrunk to a throwable rock
				var rock := Kit.pack_node("nature_boulder_01", Vector3(0, -0.25, 0), 0.75)
				n.add_child(rock)
			"fireball":
				n.mesh = Kit.builder().add("ball", Vector3.ZERO, Vector3(0.7, 0.7, 0.7), Color(2.4, 1.3, 0.4), "glow") \
					.add("ball", Vector3.ZERO, Vector3(1.0, 1.0, 1.0), Color(1.6, 0.5, 0.1), "glow").mesh()
			"bolt":
				n.mesh = Kit.builder().add("ball", Vector3.ZERO, Vector3(0.45, 0.45, 0.45), Color(1.8, 1.4, 2.4), "glow") \
					.add("box", Vector3.ZERO, Vector3(0.75, 0.12, 0.12), Color(1.0, 0.5, 1.8), "glow") \
					.add("box", Vector3.ZERO, Vector3(0.12, 0.75, 0.12), Color(1.0, 0.5, 1.8), "glow").mesh()
			_:
				n.mesh = Kit.builder().add("ball", Vector3.ZERO, Vector3(0.4, 0.4, 0.4), Color.WHITE, "glow").mesh()
		add_child(n)
		arr.append(n)
	return arr[k]


## A player arrow pointing +x with its tip at the node's origin; a fire arrow gets a glowing head.
func _arrow_node(fire: bool, scale: float) -> Node3D:
	var n := Node3D.new()
	# a bold arrow, not the real 4 cm one: at gameplay zoom a metre is ~19 px, so the shaft is drawn ~14 cm
	# thick and dark, with a bright steel head and white fletching, to stand out on sky, snow and grass
	var len := 0.78 * scale
	var bb := Kit.builder()
	bb.add("box", Vector3(-len * 0.5, 0, 0), Vector3(len, 0.13, 0.13), Color("#3a2414"), "wood")
	bb.add("cone4", Vector3(0.12, 0, 0), Vector3(0.3, 0.32, 0.3), Color(0.95, 0.95, 1.0) if not fire else Color(2.6, 1.3, 0.4), "metal" if not fire else "glow", Vector3(0, 0, -90))
	bb.add("prism", Vector3(-len + 0.14, 0.1, 0), Vector3(0.34, 0.2, 0.05), Color(1, 1, 1), "matte", Vector3(0, 0, 90))
	bb.add("prism", Vector3(-len + 0.14, -0.1, 0), Vector3(0.34, 0.2, 0.05), Color(1, 1, 1), "matte", Vector3(0, 0, -90))
	var a := bb.instance("Arrow")
	a.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	n.add_child(a)
	# a warm streak behind it, fading towards the tail, so a flying arrow is easy to follow
	var streak := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(2.6, 0.24)
	streak.mesh = q
	streak.position = Vector3(-len - 1.2, 0, -0.02)
	streak.material_override = _streak_material(fire)
	streak.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	n.add_child(streak)
	if fire:
		var g := Kit.builder().add("ball", Vector3(-0.05, 0, 0), Vector3(0.3, 0.22, 0.22), Color(2.6, 1.3, 0.4), "glow").instance()
		n.add_child(g)
	return n


static var _streaks := {}


## An unshaded quad material that fades from the arrow (UV x = 1) to nothing at the tail (UV x = 0).
static func _streak_material(fire: bool) -> Material:
	if _streaks.has(fire):
		return _streaks[fire]
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;
uniform vec4 tint : source_color;
void fragment() {
	float along = UV.x;
	float across = 1.0 - abs(UV.y - 0.5) * 2.0;
	ALBEDO = tint.rgb;
	ALPHA = tint.a * along * along * smoothstep(0.0, 0.6, across);
}
"""
	var m := ShaderMaterial.new()
	m.shader = sh
	m.set_shader_parameter("tint", Color(1.0, 0.5, 0.1, 0.85) if fire else Color(0.95, 0.72, 0.3, 0.7))
	_streaks[fire] = m
	return m


static var _arrow_cache := {}


## An arrow pointing +x: shaft, iron head, fletching. Fire arrows have a glowing head; enemy arrows are darker.
static func _arrow_mesh(fire: bool, enemy: bool) -> Mesh:
	var key := "%s%s" % [fire, enemy]
	if _arrow_cache.has(key):
		return _arrow_cache[key]
	var b := Kit.builder()
	var shaft := Color("#4a3322") if enemy else Color("#c9a26a")
	b.add("box", Vector3(-0.35, 0, 0), Vector3(1.1, 0.05, 0.05), shaft, "wood")
	if fire:
		b.add("ball", Vector3(0.24, 0, 0), Vector3(0.3, 0.2, 0.2), Color(2.6, 1.3, 0.4), "glow")
	else:
		b.add("cone4", Vector3(0.27, 0, 0), Vector3(0.12, 0.22, 0.12), Color("#3c3f46") if enemy else Color("#b8bcc4"), "metal", Vector3(0, 0, -90))
	var fl := Color("#2b2b2b") if enemy else Color("#e9e2d0")
	b.add("prism", Vector3(-0.82, 0.05, 0), Vector3(0.25, 0.1, 0.02), fl, "matte", Vector3(0, 0, 90))
	b.add("prism", Vector3(-0.82, -0.05, 0), Vector3(0.25, 0.1, 0.02), fl, "matte", Vector3(0, 0, -90))
	var m := b.mesh()
	_arrow_cache[key] = m
	return m


func _sync_zones(sim: CastleSim) -> void:
	var i := 0
	var counts := {fire = 0, curse = 0}
	for z in sim.zones:
		var d := _zone_decal(i)
		i += 1
		d.node.visible = true
		var x0: float = z.x0
		var x1: float = z.x1
		d.node.position = Vector3((x0 + x1) * 0.5, 0.09, 0)
		(d.node.mesh as QuadMesh).size = Vector2(x1 - x0, 3.4)
		var m: ShaderMaterial = d.mat
		var delay: float = z.get("delay", 0.0)
		var t: float = z.t
		var fade := clampf((z.dur - t) / 0.5, 0.0, 1.0)
		if t < delay:
			m.set_shader_parameter("mode", 0)
			m.set_shader_parameter("tint", TINT.curse)
			m.set_shader_parameter("progress", t / delay)
			m.set_shader_parameter("alpha", 1.0)
			continue
		var curse: bool = z.kind == "curse"
		m.set_shader_parameter("mode", 2 if curse else 1)
		m.set_shader_parameter("tint", Color(0.55, 0.2, 0.9) if curse else Color(1.0, 0.35, 0.05))
		m.set_shader_parameter("alpha", fade * minf(1.0, (t - delay) / 0.25))
		var key := "curse" if curse else "fire"
		var e := _zone_emitter(key, counts[key])
		counts[key] += 1
		e.visible = true
		e.emitting = fade > 0.3
		e.position = Vector3((x0 + x1) * 0.5, 0.1, 0)
		e.emission_box_extents = Vector3((x1 - x0) * 0.5, 0.1, 1.5)
	for k in range(i, _zone_decals.size()):
		_zone_decals[k].node.visible = false
	for key in _zone_emitters:
		var arr: Array = _zone_emitters[key]
		for k in range(counts[key], arr.size()):
			arr[k].emitting = false


func _zone_decal(i: int) -> Dictionary:
	while _zone_decals.size() <= i:
		_zone_decals.append(_new_decal())
	return _zone_decals[i]


func _new_decal() -> Dictionary:
	var n := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(4, 3.4)
	n.mesh = q
	n.rotation_degrees = Vector3(-90, 0, 0)
	n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var m := ShaderMaterial.new()
	m.shader = FX_SHADER
	n.material_override = m
	n.visible = false
	add_child(n)
	return {node = n, mat = m, t = 0.0, dur = 1.0, used = false}


func _zone_emitter(key: String, i: int) -> CPUParticles3D:
	if not _zone_emitters.has(key):
		_zone_emitters[key] = []
	var arr: Array = _zone_emitters[key]
	while arr.size() <= i:
		var p := CPUParticles3D.new()
		p.amount = 60 if key == "fire" else 30
		p.lifetime = 0.9 if key == "fire" else 1.6
		p.local_coords = false
		p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
		p.mesh = _glow_ball()
		p.direction = Vector3(0, 1, 0)
		p.spread = 15.0
		p.initial_velocity_min = 1.5 if key == "fire" else 0.4
		p.initial_velocity_max = 3.5 if key == "fire" else 1.2
		p.gravity = Vector3(0, 1.5 if key == "fire" else 0.3, 0)
		p.scale_amount_min = 0.12 if key == "fire" else 0.1
		p.scale_amount_max = 0.32 if key == "fire" else 0.2
		var sc := Curve.new()
		sc.add_point(Vector2(0, 1.0))
		sc.add_point(Vector2(1, 0.2))
		p.scale_amount_curve = sc
		var g := Gradient.new()
		if key == "fire":
			g.set_color(0, Color(1.0, 0.85, 0.35, 1))
			g.add_point(0.45, Color(1.0, 0.4, 0.08, 0.85))
			g.set_color(g.get_point_count() - 1, Color(0.25, 0.08, 0.04, 0))
		else:
			g.set_color(0, Color(0.85, 0.6, 1.0, 0.9))
			g.set_color(1, Color(0.4, 0.2, 0.8, 0))
		p.color_ramp = g
		p.emitting = false
		add_child(p)
		arr.append(p)
	return arr[i]


## ── Aim preview ──

func show_aim(points: PackedVector3Array) -> void:
	var mm := _aim.multimesh
	var n := mini(points.size(), mm.instance_count)
	for i in n:
		var f := float(i) / maxf(1.0, n - 1)
		var s := lerpf(0.26, 0.12, f)
		mm.set_instance_transform(i, Transform3D(Basis().scaled(Vector3(s, s, s)), points[i] + Vector3(0, 0, 0.4)))
		mm.set_instance_color(i, Color(1.0, 0.97, 0.85, lerpf(0.95, 0.15, f)))
	mm.visible_instance_count = n
	_aim.visible = true


func hide_aim() -> void:
	_aim.visible = false


## ── Events ──

func on_event(ev: Dictionary) -> void:
	match ev.type:
		"hit":
			var at := Vector3(ev.x, ev.y, 0.5)
			if ev.cause == "arrow" or ev.cause == "tower":
				if ev.get("armored", false):
					_burst("tink", at)
				elif ev.get("weak", false):
					_burst("weak", at)
				else:
					_burst("spark", at)
			if _boss_ids.has(ev.id):
				var acc: Array = _boss_dmg.get(ev.id, [0.0, 0.0, 0.0, 0.0])
				acc[0] += float(ev.amount)
				acc[1] = ev.x
				acc[2] = ev.y
				_boss_dmg[ev.id] = acc
		"stick":
			_stick(Vector3(ev.x, ev.y, 0.2), 0.0, 0.9)
		"ground":
			var ang := atan2(float(ev.vy), float(ev.vx))
			_stick(Vector3(ev.x, 0.05, 0.2), ang, 2.0)
			_burst("puff", Vector3(ev.x, 0.1, 0.3), 0.5)
		"shield_hit":
			_burst("metal", Vector3(ev.x, ev.y, 0.5))
		"kill":
			_burst("poof", Vector3(ev.x, ev.y + 0.8, 0.4), 1.6 if ev.get("boss", false) else 1.0)
			if int(ev.get("gold", 0)) > 0:
				_coin(Vector3(ev.x, ev.y + 1.2, 0.6))
				number(Vector3(ev.x, ev.y + 2.2, 0.8), "+%d" % ev.gold, Color(1.7, 1.35, 0.35))
		"wall_hit":
			var y := randf_range(1.0, 6.0)
			_burst("chips", Vector3(3.1, y, 0.5))
			_burst("puff", Vector3(3.3, y, 0.6), 0.8)
			_shake(0.12 + minf(0.3, float(ev.get("amount", 1.0)) * 0.03))
		"struct_hit":
			_burst("splinter", Vector3(ev.x, 0.9, 0.4), 0.7)
		"shot_hit":
			var at := Vector3(ev.x, ev.y, 0.4)
			match ev.kind:
				"boulder":
					_burst("chips", at, 1.6)
					_burst("puff", at, 1.8)
					_shake(0.45)
				"fireball":
					_burst("explode", at, 1.0)
					_burst("embers", at)
					_shake(0.25)
				"bolt":
					_burst("magic", at, 0.8)
				_:
					_burst("puff", at, 0.5)
		"telegraph":
			_telegraph(ev)
		"impact":
			var x0: float = ev.x0
			var x1: float = ev.x1
			_burst("ring", Vector3((x0 + x1) * 0.5, 0.2, 0.2), 1.0, Vector3(maxf(0.5, (x1 - x0) * 0.5), 0.1, 1.4))
			if ev.kind != "breath":
				_burst("chips", Vector3((x0 + x1) * 0.5, 0.3, 0.3), 1.2)
			_shake(0.6)
		"tower_shot":
			var from := Vector3(ev.x0, ev.y0, -2.6)
			var to := Vector3(ev.x1, ev.y1, 0.0)
			for k in 6:
				var f := k / 5.0
				_trail_emit(from.lerp(to, f) + Vector3(0, sin(f * PI) * 0.8, 0), Color(1.0, 0.95, 0.8), 0.5)
			_burst("spark", to, 0.7)
		"ward":
			_burst("ward", Vector3(ev.x, ev.y, 0.5), 1.0)
			_burst("ring", Vector3(ev.x, ev.y, 0.5), 0.6, Vector3(0.3, 0.3, 0.3))
		"rage":
			_burst("rage", Vector3(0, 0, 0) + _enemy_hint(ev), 1.0)
		"summon", "teleport", "spawned":
			var at := Vector3(float(ev.get("x", 0.0)), 0.3, 0.2)
			if ev.type == "summon" and not ev.has("x"):
				at.x = _last_boss_x()
			_burst("portal", at, 1.2 if ev.type != "spawned" else 0.7)
		"evade":
			_burst("shadow", Vector3(ev.x, 1.0, 0.3), 1.4)
		"land", "stun":
			var x := float(ev.get("x", _last_boss_x()))
			_burst("ring", Vector3(x, 0.2, 0.2), 1.0, Vector3(2.0, 0.1, 1.4))
			_shake(0.5 if ev.type == "land" else 0.3)
		"boss_phase":
			var x := _last_boss_x()
			var big: bool = ev.get("final", false)
			_burst("flash", Vector3(x, 2.5, 0.4), 2.0 if big else 1.3)
			_burst("ring", Vector3(x, 0.3, 0.3), 1.0, Vector3(4.0 if big else 2.5, 0.2, 2.0))
			_shake(0.9 if big else 0.5)
		"boss_dead":
			var at := Vector3(ev.x, 1.5, 0.4)
			_burst("explode", at, 2.2)
			_burst("flash", at, 2.4)
			_burst("embers", at, 1.5)
			_burst("chips", at, 1.5)
			_burst("ring", Vector3(ev.x, 0.2, 0.3), 1.0, Vector3(5.0, 0.2, 2.0))
			_shake(1.2)


var _last_x := 30.0


func _last_boss_x() -> float:
	return _last_x


## Rage events carry only the id; the sync keeps the boss position, and enemies' positions come from hits.
func _enemy_hint(_ev: Dictionary) -> Vector3:
	return Vector3(_last_hit_x, 1.2, 0.4)


var _last_hit_x := 30.0


func _shake(a: float) -> void:
	if world:
		world.shake(a)


func _telegraph(ev: Dictionary) -> void:
	var d: Dictionary
	for x in _decals:
		if not x.used:
			d = x
			break
	if d.is_empty():
		d = _new_decal()
		_decals.append(d)
	d.used = true
	d.t = 0.0
	d.dur = maxf(0.1, float(ev.dur))
	var x0: float = ev.x0
	var x1: float = ev.x1
	d.node.position = Vector3((x0 + x1) * 0.5, 0.11, 0)
	(d.node.mesh as QuadMesh).size = Vector2(maxf(0.5, x1 - x0), 3.2)
	d.node.visible = true
	var m: ShaderMaterial = d.mat
	m.set_shader_parameter("mode", 0)
	m.set_shader_parameter("tint", TINT.get(ev.kind, Color(1.0, 0.3, 0.2)))
	m.set_shader_parameter("progress", 0.0)
	m.set_shader_parameter("alpha", 1.0)


func _stick(at: Vector3, angle: float, life: float) -> void:
	var n: Node3D
	for s in _stuck_pool:
		if not s.visible:
			n = s
			break
	if n == null:
		if _stuck_pool.size() >= 40:
			return
		n = _arrow_node(false, 1.6)
		add_child(n)
		_stuck_pool.append(n)
	n.visible = true
	var ang := angle if angle != 0.0 else randf_range(-0.5, 0.2)
	n.position = at + Vector3(cos(ang), sin(ang), 0) * 0.35
	n.rotation = Vector3(0, randf_range(-0.3, 0.3), ang)
	_stuck.append([n, 0.0, life])


func _coin(at: Vector3) -> void:
	var n := MeshInstance3D.new()
	n.mesh = _coin_mesh()
	n.position = at
	n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(n)
	_coins.append({node = n, age = 0.0, y = at.y})


static var _coin_cache: Mesh


static func _coin_mesh() -> Mesh:
	if _coin_cache == null:
		_coin_cache = Kit.builder().add("cyl", Vector3.ZERO, Vector3(0.5, 0.08, 0.5), Color("#f2c33c"), "metal", Vector3(90, 0, 0)) \
			.add("cyl", Vector3(0, 0, 0.045), Vector3(0.3, 0.02, 0.3), Color("#ffe48a"), "glow", Vector3(90, 0, 0)).mesh()
	return _coin_cache


## A number that rises and fades over the world (damage on bosses, gold on kills).
func number(at: Vector3, text: String, color: Color) -> void:
	var item: Dictionary
	for l in _labels:
		if not l.label.visible:
			item = l
			break
	if item.is_empty():
		if _labels.size() >= 28:
			item = _labels[0]
			for l in _labels:
				if l.age > item.age:
					item = l
		else:
			var lab := Label3D.new()
			lab.font = _font
			lab.font_size = 56
			lab.pixel_size = 0.016
			lab.outline_size = 14
			lab.billboard = BaseMaterial3D.BILLBOARD_ENABLED
			lab.no_depth_test = true
			lab.fixed_size = false
			lab.render_priority = 10
			lab.outline_render_priority = 9
			add_child(lab)
			item = {label = lab, age = 0.0, life = 1.0}
			_labels.append(item)
	var lab: Label3D = item.label
	lab.text = text
	lab.modulate = color
	lab.outline_modulate = Color(0.12, 0.06, 0.02, 0.9)
	lab.position = at
	lab.visible = true
	item.age = 0.0
	item.life = 1.1


func _age(delta: float) -> void:
	_age_trail(delta)
	var live := []
	for s in _stuck:
		s[1] += delta
		if s[1] >= s[2]:
			s[0].visible = false
		else:
			live.append(s)
	_stuck = live
	for d in _decals:
		if not d.used:
			continue
		d.t += delta
		var p: float = d.t / d.dur
		d.mat.set_shader_parameter("progress", minf(1.0, p))
		if p >= 1.0:
			d.mat.set_shader_parameter("alpha", maxf(0.0, 1.0 - (d.t - d.dur) / 0.25))
		if d.t > d.dur + 0.25:
			d.used = false
			d.node.visible = false
	var coins := []
	for c in _coins:
		c.age += delta
		var a: float = c.age
		c.node.position.y = c.y + a * 2.4 - a * a * 1.2
		c.node.rotation.y = a * 9.0
		var k := 1.0 if a < 0.6 else maxf(0.0, 1.0 - (a - 0.6) / 0.3)
		c.node.scale = Vector3(k, k, k)
		if a > 0.9:
			c.node.queue_free()
		else:
			coins.append(c)
	_coins = coins
	for l in _labels:
		if not l.label.visible:
			continue
		l.age += delta
		var lab: Label3D = l.label
		lab.position.y += delta * 1.6
		var f: float = l.age / l.life
		lab.modulate.a = clampf(1.6 - f * 1.6, 0.0, 1.0)
		lab.outline_modulate.a = lab.modulate.a * 0.9
		var s := 1.0 + 0.35 * maxf(0.0, 1.0 - l.age * 6.0)
		lab.scale = Vector3(s, s, s)
		if l.age >= l.life:
			lab.visible = false
	for id in _boss_dmg.keys():
		var acc: Array = _boss_dmg[id]
		acc[3] += delta
		if acc[3] >= 0.3:
			if acc[0] >= 0.05:
				number(Vector3(acc[1] + randf_range(-0.6, 0.6), acc[2] + 1.8, 1.0), str(snappedf(acc[0], 0.1)), Color(1.6, 1.55, 1.45))
			_boss_dmg.erase(id)


## ── Particles ──

func _trail_emit(at: Vector3, color: Color, size: float) -> void:
	_trail_p[_trail_next] = [at, Vector3(randf_range(-0.3, 0.3), randf_range(0.2, 0.9), 0), color, size * 0.22, 0.0]
	_trail_next = (_trail_next + 1) % TRAIL_N


func _age_trail(delta: float) -> void:
	var mm := _trail.multimesh
	for i in TRAIL_N:
		var p: Array = _trail_p[i]
		if p[4] >= TRAIL_LIFE:
			if p[4] < 90.0:
				p[4] = 99.0
				mm.set_instance_transform(i, Transform3D(Basis().scaled(Vector3.ZERO), Vector3.ZERO))
			continue
		p[4] += delta
		p[0] += p[1] * delta
		var f: float = p[4] / TRAIL_LIFE
		var sz: float = p[3] * (1.0 - f * 0.8)
		mm.set_instance_transform(i, Transform3D(Basis().scaled(Vector3(sz, sz, sz)), p[0]))
		var c: Color = p[2]
		mm.set_instance_color(i, Color(c.r, c.g, c.b, 1.0 - f))


static var _glow_cache: Mesh


static func _glow_ball() -> Mesh:
	if _glow_cache == null:
		var m := SphereMesh.new()
		m.radius = 0.5
		m.height = 1.0
		m.radial_segments = 6
		m.rings = 3
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.vertex_color_use_as_albedo = true
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.albedo_color = Color(1.8, 1.8, 1.8)
		m.material = mat
		_glow_cache = m
	return _glow_cache


func _burst(kind: String, at: Vector3, scale := 1.0, box := Vector3.ZERO) -> void:
	if at.x == 0.0 and kind == "rage":
		return
	_last_hit_x = at.x if kind in ["spark", "tink", "weak"] else _last_hit_x
	if not _pools.has(kind):
		_pools[kind] = {list = [], next = 0}
		var n := 6 if kind in ["spark", "tink", "puff", "chips", "poof", "weak"] else 3
		for k in n:
			var p := _emitter(kind)
			add_child(p)
			_pools[kind].list.append(p)
	var pool: Dictionary = _pools[kind]
	var p: CPUParticles3D = pool.list[pool.next]
	pool.next = (pool.next + 1) % pool.list.size()
	p.position = at
	p.scale_amount_min = float(p.get_meta("smin")) * scale
	p.scale_amount_max = float(p.get_meta("smax")) * scale
	if box != Vector3.ZERO:
		p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
		p.emission_box_extents = box
	p.restart()


func _ramp(a: Color, b: Color, mid := Color(0, 0, 0, -1)) -> Gradient:
	var g := Gradient.new()
	g.set_color(0, a)
	g.set_color(1, b)
	if mid.a >= 0.0:
		g.add_point(0.4, mid)
	return g


func _emitter(kind: String) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = false
	p.explosiveness = 0.95
	p.local_coords = false
	p.direction = Vector3(0, 1, 0)
	var smin := 1.0
	var smax := 1.0
	var bits := func(size: Vector3, mat: String) -> Mesh: return Kit.builder().add("box", Vector3.ZERO, size, Color.WHITE, mat).mesh()
	match kind:
		"spark", "tink", "metal", "weak":
			p.amount = 7 if kind != "metal" else 12
			p.lifetime = 0.3
			p.mesh = _glow_ball()
			p.spread = 180.0
			p.initial_velocity_min = 3.0
			p.initial_velocity_max = 6.0
			p.gravity = Vector3(0, -12, 0)
			smin = 0.07
			smax = 0.14
			var c: Color = {spark = Color(1.0, 0.9, 0.6), tink = Color(0.85, 0.88, 0.95), metal = Color(1.0, 0.95, 0.75), weak = Color(1.0, 0.55, 0.15)}[kind]
			p.color_ramp = _ramp(c, Color(c.r, c.g, c.b, 0))
			if kind == "weak":
				p.amount = 10
				smax = 0.2
		"puff", "poof":
			p.amount = 8 if kind == "puff" else 12
			p.lifetime = 0.8 if kind == "puff" else 1.0
			p.mesh = CastleWorld._soft_ball(Color(0.85, 0.78, 0.66, 0.6) if kind == "puff" else Color(0.92, 0.9, 0.86, 0.7))
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
			p.emission_sphere_radius = 0.3
			p.spread = 90.0
			p.initial_velocity_min = 0.8
			p.initial_velocity_max = 2.4
			p.gravity = Vector3(0, 0.3, 0)
			p.damping_min = 2.0
			p.damping_max = 3.0
			smin = 0.35
			smax = 0.7
			var c := Curve.new()
			c.add_point(Vector2(0, 0.6))
			c.add_point(Vector2(1, 1.6))
			p.scale_amount_curve = c
			p.color_ramp = _ramp(Color(1, 1, 1, 0.8), Color(1, 1, 1, 0))
		"chips":
			p.amount = 10
			p.lifetime = 0.9
			p.mesh = bits.call(Vector3(0.18, 0.14, 0.16), "stone")
			p.spread = 75.0
			p.direction = Vector3(1, 1, 0)
			p.initial_velocity_min = 3.0
			p.initial_velocity_max = 6.0
			p.gravity = Vector3(0, -16, 0)
			p.angular_velocity_min = -600
			p.angular_velocity_max = 600
			p.color = Color("#a49c90")
			smin = 0.6
			smax = 1.3
		"splinter":
			p.amount = 9
			p.lifetime = 0.8
			p.mesh = bits.call(Vector3(0.05, 0.05, 0.3), "wood")
			p.spread = 70.0
			p.initial_velocity_min = 2.5
			p.initial_velocity_max = 5.5
			p.gravity = Vector3(0, -15, 0)
			p.angular_velocity_min = -720
			p.angular_velocity_max = 720
			p.color = Color("#b98a52")
			smin = 0.7
			smax = 1.3
		"explode":
			p.amount = 22
			p.lifetime = 0.65
			p.mesh = _glow_ball()
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
			p.emission_sphere_radius = 0.4
			p.spread = 180.0
			p.initial_velocity_min = 2.0
			p.initial_velocity_max = 5.0
			p.damping_min = 3.0
			p.damping_max = 5.0
			p.gravity = Vector3(0, 2, 0)
			smin = 0.5
			smax = 1.1
			p.color_ramp = _ramp(Color(1.0, 0.95, 0.6, 1), Color(0.2, 0.08, 0.05, 0), Color(1.0, 0.45, 0.1, 0.9))
		"embers":
			p.amount = 16
			p.lifetime = 1.2
			p.mesh = _glow_ball()
			p.spread = 70.0
			p.initial_velocity_min = 2.0
			p.initial_velocity_max = 6.0
			p.gravity = Vector3(0, -5, 0)
			smin = 0.06
			smax = 0.14
			p.color_ramp = _ramp(Color(1.0, 0.7, 0.2, 1), Color(1.0, 0.3, 0.05, 0))
		"magic", "portal", "ward", "rage", "flash":
			p.amount = 16 if kind != "flash" else 24
			p.lifetime = 0.7 if kind != "portal" else 1.1
			p.mesh = _glow_ball()
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_RING
			p.emission_ring_axis = Vector3(0, 0, 1) if kind != "portal" else Vector3(0, 1, 0)
			p.emission_ring_radius = 0.6 if kind != "flash" else 1.0
			p.emission_ring_inner_radius = 0.3
			p.emission_ring_height = 0.1
			p.spread = 180.0
			p.initial_velocity_min = 1.0 if kind != "flash" else 4.0
			p.initial_velocity_max = 3.0 if kind != "flash" else 8.0
			p.damping_min = 2.0
			p.damping_max = 4.0
			p.gravity = Vector3(0, 1.5 if kind == "portal" else 0.0, 0)
			smin = 0.12
			smax = 0.3
			var c: Color = {magic = Color(0.8, 0.5, 1.0), portal = Color(0.55, 0.25, 0.9), ward = Color(0.75, 0.9, 1.0), rage = Color(1.0, 0.25, 0.15), flash = Color(1.0, 0.95, 0.8)}[kind]
			p.color_ramp = _ramp(Color(c.r, c.g, c.b, 1), Color(c.r, c.g, c.b, 0))
		"shadow":
			p.amount = 14
			p.lifetime = 1.0
			p.mesh = CastleWorld._soft_ball(Color(0.12, 0.08, 0.18, 0.7))
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
			p.emission_sphere_radius = 0.8
			p.spread = 90.0
			p.initial_velocity_min = 0.5
			p.initial_velocity_max = 1.5
			p.gravity = Vector3(0, 0.5, 0)
			smin = 0.6
			smax = 1.2
			p.color_ramp = _ramp(Color(1, 1, 1, 0.85), Color(1, 1, 1, 0))
		"ring":
			p.amount = 18
			p.lifetime = 0.8
			p.mesh = CastleWorld._soft_ball(Color(0.8, 0.72, 0.6, 0.55))
			p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
			p.emission_box_extents = Vector3(2, 0.1, 1.4)
			p.direction = Vector3(0, 0.4, 0)
			p.spread = 80.0
			p.initial_velocity_min = 1.0
			p.initial_velocity_max = 2.5
			p.gravity = Vector3(0, -0.5, 0)
			p.damping_min = 2.0
			p.damping_max = 3.0
			smin = 0.5
			smax = 1.0
			p.color_ramp = _ramp(Color(1, 1, 1, 0.8), Color(1, 1, 1, 0))
	p.set_meta("smin", smin)
	p.set_meta("smax", smax)
	p.scale_amount_min = smin
	p.scale_amount_max = smax
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return p
