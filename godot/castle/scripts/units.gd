class_name CastleUnits
extends Node3D
## The enemies and bosses on screen: one rig (scripts/models.gd) per CastleSim.Enemy, placed at the sim's
## (x, y) on the lane with a small depth jitter so crowds don't merge, turned towards the castle and a little
## towards the camera. Everything moves by procedural animation read from the sim state each frame: a walk
## cycle from the distance covered, a swing whenever the blow counter ticks, poses for the bosses' wind-ups,
## and looks for the states that matter to the player (open = pulsing gold, shadow = dark glass, barrier,
## rage, the King's last-phase aura). Hits flash white; the dead topple, sink and shrink.

const FACING := -150.0              # degrees about y: the model's +x turned to −x, 30° towards the camera
const DEATH := 0.8
const FLASH := 0.07

class View:
	var id := 0
	var kind := ""
	var boss := false
	var flies := false
	var h := 1.0
	var w := 1.0
	var z := 0.0
	var root: Node3D
	var rig: Node3D
	var p := {}                     # pivot name -> Node3D
	var meshes: Array[MeshInstance3D] = []
	var walk := 0.0
	var last_x := INF
	var blows := 0
	var swing := 0.0
	var flash := 0.0
	var dying := -1.0
	var pulse := 0.0
	var state := ""
	var t := 0.0
	var mode := ""                  # the material look applied: "", flash, shadow
	var overlay := ""
	var stars: Node3D
	var barrier: MeshInstance3D
	var aura: Node3D
	var joints: Node3D
	var rot := {}                   # pivot name -> current Vector3 rotation (smoothed)
	var lean := 0.0
	var squash := 1.0
	var dy := 0.0

var views := {}                     # id -> View
var _t := 0.0
static var _mats := {}


static func _mat(kind: String) -> Material:
	if _mats.has(kind):
		return _mats[kind]
	var m: Material
	match kind:
		"shadow":
			var s := StandardMaterial3D.new()
			s.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			s.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			s.albedo_color = Color(0.12, 0.05, 0.22, 0.45)
			m = s
		"barrier":
			var s := StandardMaterial3D.new()
			s.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			s.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			s.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
			s.cull_mode = BaseMaterial3D.CULL_DISABLED
			s.albedo_color = Color(0.55, 0.25, 1.0, 0.3)
			m = s
		"open", "rage", "buff":
			var sh := Shader.new()
			sh.code = """
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, shadows_disabled;
uniform vec4 tint : source_color;
uniform float speed = 6.0;
void fragment() {
	float rim = 1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	float p = 0.55 + 0.45 * sin(TIME * speed);
	ALBEDO = tint.rgb * (0.08 + rim * rim * 1.4) * p;
}
"""
			var sm := ShaderMaterial.new()
			sm.shader = sh
			var c: Color = {open = Color(1.0, 0.8, 0.2), rage = Color(1.0, 0.15, 0.05), buff = Color(0.9, 0.7, 0.2)}[kind]
			sm.set_shader_parameter("tint", c)
			sm.set_shader_parameter("speed", 9.0 if kind == "open" else 4.0)
			m = sm
	_mats[kind] = m
	return m


## ── The frame ──

func sync(sim: CastleSim, delta: float) -> void:
	_t += delta
	var seen := {}
	for e in sim.enemies:
		if e.dead:
			continue
		seen[e.id] = true
		var v: View = views.get(e.id)
		if v == null:
			v = _make(e)
		_update(v, e, delta)
	for id in views.keys():
		var v: View = views[id]
		if not seen.has(id) and v.dying < 0.0:
			v.dying = 0.0
		if v.dying >= 0.0:
			_die(v, delta)


func _make(e: CastleSim.Enemy) -> View:
	var v := View.new()
	v.id = e.id
	v.kind = e.kind
	v.boss = e.boss
	v.flies = e.flies
	v.h = e.h
	v.w = e.w
	v.blows = e.blows
	v.z = 0.0 if e.boss else lerpf(-0.8, 0.6, fposmod(e.id * 0.618034, 1.0))
	v.root = Node3D.new()
	v.root.name = "e%d" % e.id
	add_child(v.root)
	v.rig = CastleModels.rig(e.kind)
	v.rig.rotation_degrees.y = FACING
	v.root.add_child(v.rig)
	_collect(v, v.rig)
	v.joints = v.p.get("joints")
	if v.joints:
		v.joints.visible = false
	v.aura = v.rig.get_node_or_null("aura")
	if e.kind == "dark_king":
		v.barrier = MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 2.6
		sm.height = 5.2
		v.barrier.mesh = sm
		v.barrier.material_override = _mat("barrier")
		v.barrier.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		v.barrier.position = Vector3(0, 2.1, 0)
		v.barrier.visible = false
		v.root.add_child(v.barrier)
	# grow in from nothing (spawns and summons don't pop)
	v.root.scale = Vector3.ONE * 0.01
	views[e.id] = v
	return v


func _collect(v: View, n: Node) -> void:
	for c in n.get_children():
		if c is MeshInstance3D:
			if c.name != "aura":
				v.meshes.append(c)
		elif c is Node3D:
			v.p[String(c.name)] = c
			v.rot[String(c.name)] = Vector3.ZERO
		_collect(v, c)


func _update(v: View, e: CastleSim.Enemy, delta: float) -> void:
	v.t += delta
	var y := e.y + (e.h * 0.5 if e.flies else 0.0)
	var pos := Vector3(e.x, y, v.z)
	var dx := 0.0 if v.last_x == INF else absf(e.x - v.last_x)
	v.last_x = e.x
	v.root.position = pos
	v.root.scale = v.root.scale.lerp(Vector3.ONE, 1.0 - exp(-delta * 10.0))
	var s := v.h / 1.7
	if not v.flies:
		v.walk += dx / maxf(0.5, 0.75 * s * (2.0 if v.boss else 1.0)) * PI
	if e.blows != v.blows:
		v.blows = e.blows
		v.swing = 0.4
	v.swing = maxf(0.0, v.swing - delta)
	v.flash = maxf(0.0, v.flash - delta)
	v.pulse = maxf(0.0, v.pulse - delta)
	if e.state != v.state:
		v.state = e.state
	_look(v, e)
	var target := _pose(v, e, dx / maxf(delta, 1e-4))
	var k := 1.0 - exp(-delta * 14.0)
	for name in target:
		if not v.p.has(name):
			continue
		var r: Vector3 = v.rot.get(name, Vector3.ZERO)
		r = r.lerp(target[name], k)
		v.rot[name] = r
		var piv: Node3D = v.p[name]
		piv.rotation = r
	# squash/stretch and lean on the whole rig
	var sq := 1.0
	var lean := 0.0
	var bob := 0.0
	match e.state:
		"crouch": sq = 0.72
		"leap": sq = 1.2
		"tele_charge", "tele_slam", "tele_breath", "tele_wave", "tele_summon": sq = 1.0 + 0.04 * sin(v.t * 30.0)
		"charge": lean = -0.35
		"stun": lean = sin(v.t * 6.0) * 0.12
		"rage", "teleport": sq = 1.0 + 0.06 * sin(v.t * 20.0)
	if v.pulse > 0.0:
		sq *= 1.0 + v.pulse * 0.3
	if not v.flies and absf(e.speed) > 0.05:
		bob = absf(sin(v.walk)) * 0.06 * s
	v.squash = lerpf(v.squash, sq, k)
	v.lean = lerpf(v.lean, lean, k)
	v.rig.scale = Vector3(1.0 / sqrt(v.squash), v.squash, 1.0 / sqrt(v.squash))
	v.rig.rotation = Vector3(0, deg_to_rad(FACING), 0)
	v.rig.rotate_object_local(Vector3.BACK, v.lean)
	v.rig.position.y = bob
	if v.flies and not v.boss:
		v.rig.position.y += sin(v.t * 9.0 + v.id) * 0.06
	# stunned stars
	var stunned := e.state == "stun"
	if stunned and v.stars == null:
		v.stars = _stars(v)
	if v.stars:
		v.stars.visible = stunned
		v.stars.rotation.y += delta * 5.0
	if v.joints:
		v.joints.visible = e.vulnerable > 0.0
		if v.joints.visible:
			v.joints.scale = Vector3.ONE * (1.0 + 0.15 * sin(v.t * 12.0))
	if v.barrier:
		v.barrier.visible = e.barrier
		v.barrier.scale = Vector3.ONE * (1.0 + 0.03 * sin(v.t * 3.0))
	if v.aura:
		v.aura.visible = e.phase >= 3
		v.aura.scale = Vector3.ONE * (1.0 + 0.06 * sin(v.t * 5.0))


## The materials: a hit flash beats the shadow look; open, rage and the commander's buff are overlays.
func _look(v: View, e: CastleSim.Enemy) -> void:
	var mode := "flash" if v.flash > 0.0 else ("shadow" if e.immune > 0.0 and e.kind == "shadow_beast" or e.state == "evade" else "")
	if e.kind == "dark_king" and e.immune > 0.0 and e.state == "teleport":
		mode = "shadow" if v.flash <= 0.0 else mode
	if mode != v.mode:
		v.mode = mode
		var m: Material = null
		if mode == "flash":
			m = Kit.mat("flash")
		elif mode == "shadow":
			m = _mat("shadow")
		for mi in v.meshes:
			mi.material_override = m
	var ov := ""
	if e.vulnerable > 0.0:
		ov = "open"
	elif e.raging or (e.boss and e.phase >= 3 and e.kind == "dark_king"):
		ov = "rage"
	elif e.buffed:
		ov = "buff"
	if ov != v.overlay:
		v.overlay = ov
		var m: Material = null if ov == "" else _mat(ov)
		for mi in v.meshes:
			mi.material_overlay = m


## Target rotations for the pivots this frame.
func _pose(v: View, e: CastleSim.Enemy, speed: float) -> Dictionary:
	var r := {}
	var moving := speed > 0.05 or absf(e.speed) > 0.05
	var sw := sin(v.walk) * (0.6 if moving else 0.0)
	var idle := sin(v.t * 2.0 + v.id) * 0.05
	# a blow: wind back, then strike forward (positive z = forward)
	var strike := 0.0
	if v.swing > 0.0:
		var f := 1.0 - v.swing / 0.4
		strike = -1.6 * sin(f * PI * 0.5) if f < 0.45 else lerpf(-1.6, 1.3, minf(1.0, (f - 0.45) / 0.25))
	match v.kind:
		"ram":
			var wr := -v.walk * 1.2
			r.wheel_f = Vector3(0, 0, wr)
			r.wheel_b = Vector3(0, 0, wr)
			r.weapon = Vector3(0, 0, 0)
			if v.swing > 0.0:
				v.p.weapon.position.x = -0.5 * sin((1.0 - v.swing / 0.4) * PI)
			else:
				v.p.weapon.position.x = lerpf(v.p.weapon.position.x, sin(v.t * 2.0) * 0.05, 0.2)
			return r
		"flyer":
			# wings held up (negative x lifts the far one, positive the near one) and flapping about that
			var fl := sin(v.t * 16.0 + v.id) * 0.8
			r.wing_l = Vector3(-0.5 + fl, 0, 0)
			r.wing_r = Vector3(0.5 - fl, 0, 0)
			r.tail = Vector3(0, 0, sin(v.t * 5.0) * 0.3)
			r.head = Vector3(0, 0, -0.4 if v.swing > 0.0 else 0.0)
			r.body = Vector3(0, 0, -0.5 * (v.swing / 0.4))
			return r
		"fire_dragon":
			return _dragon_pose(v, e)
		"shadow_beast":
			return _beast_pose(v, e, moving)
	# humanoids, the golem, the titan
	r.leg_l = Vector3(0, 0, sw)
	r.leg_r = Vector3(0, 0, -sw)
	r.arm_l = Vector3(0, 0, -sw * 0.6 + idle)
	r.arm_r = Vector3(0, 0, sw * 0.6 - idle + strike)
	r.body = Vector3(0, 0, -0.08 if moving else idle * 0.3)
	r.head = Vector3(0, 0, 0)
	if v.kind == "shield":
		r.arm_l = Vector3(0, 0, 0.15)
	if v.kind == "archer" and e.attacking:
		r.arm_l = Vector3(0, 0, 1.45)
		r.arm_r = Vector3(0, 0, 1.25 - (0.0 if v.swing > 0.0 else 0.35))
	if v.kind == "berserker" or v.kind == "golem" or v.kind == "siege_titan":
		if v.swing > 0.0:
			r.arm_l = Vector3(0, 0, strike)
	match e.state:
		"tele_charge":
			r.arm_r = Vector3(0, 0, 2.7)
			r.body = Vector3(0, 0, 0.25)
			r.leg_l = Vector3(0, 0, 0.4)
			r.leg_r = Vector3(0, 0, -0.5)
		"charge":
			r.arm_r = Vector3(0, 0, 1.4)
			r.arm_l = Vector3(0, 0, 1.2)
			var run := sin(v.t * 18.0) * 0.9
			r.leg_l = Vector3(0, 0, run)
			r.leg_r = Vector3(0, 0, -run)
		"stun":
			r.arm_r = Vector3(0, 0, -0.4)
			r.arm_l = Vector3(0, 0, -0.4)
			r.head = Vector3(sin(v.t * 5.0) * 0.3, 0, -0.3)
			r.body = Vector3(0, 0, 0.2)
		"tele_slam", "tele_wave", "tele_summon", "rage":
			r.arm_r = Vector3(0, 0, 2.9)
			r.arm_l = Vector3(0, 0, 2.9 if e.state != "tele_summon" else 0.3)
			r.body = Vector3(0, 0, 0.2)
			r.head = Vector3(0, 0, 0.3)
		"recover":
			r.arm_r = Vector3(0, 0, 0.9)
			r.arm_l = Vector3(0, 0, 0.9)
			r.body = Vector3(0, 0, -0.35)
			r.head = Vector3(0, 0, -0.2)
		"tele_throw":
			r.arm_r = Vector3(0, 0, -2.2)
			r.body = Vector3(0, 0, 0.2)
		"cast":
			r.arm_l = Vector3(0, 0, 1.6 + sin(v.t * 3.0) * 0.15)
			r.arm_r = Vector3(0, 0, 0.3 + strike)
		"teleport":
			r.arm_l = Vector3(0, 0, 2.5)
			r.arm_r = Vector3(0, 0, 2.5)
	return r


func _dragon_pose(v: View, e: CastleSim.Enemy) -> Dictionary:
	var r := {}
	var flap := sin(v.t * 4.5) * 0.75
	var jaw := 0.0
	var head := sin(v.t * 1.5) * 0.08
	match e.state:
		"landed":
			flap = sin(v.t * 1.2) * 0.05
			head = -0.25
		"descend", "ascend":
			flap = sin(v.t * 9.0) * 0.9
		"tele_breath":
			head = 0.55
			jaw = 0.15
			flap = sin(v.t * 2.0) * 0.4
		"breath":
			head = -0.45
			jaw = 0.65
	if v.swing > 0.0:
		jaw = 0.6
		head = -0.3
	var lift := 0.15 if e.state == "landed" else 0.85
	r.wing_l = Vector3(-lift + flap, 0, 0)
	r.wing_r = Vector3(lift - flap, 0, 0)
	r.head = Vector3(0, 0, head)
	r.jaw = Vector3(0, 0, -jaw)
	r.tail = Vector3(0, sin(v.t * 2.0) * 0.25, sin(v.t * 1.6) * 0.15)
	r.body = Vector3(0, 0, (-0.15 if e.state == "breath" else 0.0) + sin(v.t * 4.5 + 1.0) * 0.04)
	return r


func _beast_pose(v: View, e: CastleSim.Enemy, moving: bool) -> Dictionary:
	var r := {}
	var gallop := sin(v.walk * 0.7) * (0.8 if moving else 0.0)
	r.leg_fl = Vector3(0, 0, gallop)
	r.leg_fr = Vector3(0, 0, gallop * 0.8)
	r.leg_bl = Vector3(0, 0, -gallop)
	r.leg_br = Vector3(0, 0, -gallop * 0.8)
	r.tail = Vector3(0, sin(v.t * 6.0) * 0.4, 0.2)
	r.head = Vector3(0, 0, sin(v.t * 3.0) * 0.06)
	r.jaw = Vector3(0, 0, -0.5 if v.swing > 0.0 else -0.08)
	r.body = Vector3.ZERO
	match e.state:
		"crouch":
			r.leg_fl = Vector3(0, 0, 0.9)
			r.leg_fr = Vector3(0, 0, 0.9)
			r.leg_bl = Vector3(0, 0, -0.9)
			r.leg_br = Vector3(0, 0, -0.9)
			r.head = Vector3(0, 0, -0.3)
			r.jaw = Vector3(0, 0, -0.4)
		"leap":
			r.leg_fl = Vector3(0, 0, 1.3)
			r.leg_fr = Vector3(0, 0, 1.2)
			r.leg_bl = Vector3(0, 0, -1.3)
			r.leg_br = Vector3(0, 0, -1.2)
			r.jaw = Vector3(0, 0, -0.7)
			r.body = Vector3(0, 0, 0.15)
	return r


func _stars(v: View) -> Node3D:
	var n := Node3D.new()
	var b := Kit.builder()
	for k in 3:
		var a := k * TAU / 3.0
		b.add("ball_lo", Vector3(cos(a) * 0.5, 0, sin(a) * 0.5), Vector3(0.22, 0.22, 0.22), Color(1.0, 0.9, 0.2), "glow")
	n.add_child(b.instance())
	n.position = Vector3(0, v.h + 0.3, 0)
	v.root.add_child(n)
	return n


func _die(v: View, delta: float) -> void:
	if v.dying == 0.0:
		for mi in v.meshes:
			mi.material_override = null
			mi.material_overlay = null
		if v.stars:
			v.stars.visible = false
		if v.barrier:
			v.barrier.visible = false
	v.dying += delta
	var f := minf(1.0, v.dying / (DEATH * (2.0 if v.boss else 1.0)))
	# topple backwards (away from the castle), sink, shrink at the end
	v.rig.rotation = Vector3(0, deg_to_rad(FACING), 0)
	v.rig.rotate_object_local(Vector3.BACK, ease(minf(1.0, f * 1.6), 0.5) * 1.45)
	if v.flies:
		v.root.position.y = maxf(0.2, v.root.position.y - delta * 8.0)
	else:
		v.rig.position.y = -f * f * v.h * 0.25
	var sc := 1.0 if f < 0.65 else 1.0 - (f - 0.65) / 0.35
	v.root.scale = Vector3.ONE * maxf(0.01, sc)
	if f >= 1.0:
		v.root.queue_free()
		views.erase(v.id)


## ── Events ──

func on_event(ev: Dictionary) -> void:
	var v: View = views.get(int(ev.get("id", -1)))
	if v == null:
		return
	match ev.type:
		"hit":
			v.flash = FLASH
		"kill", "ward":
			if v.dying < 0.0:
				v.dying = 0.0
		"attack":
			v.swing = 0.4
		"boss_phase", "summon", "teleport":
			v.pulse = 0.5
		"rage":
			v.pulse = 0.3


## The world point above an enemy's head (for its health bar), or Vector3.INF.
func anchor(id: int) -> Vector3:
	var v: View = views.get(id)
	if v == null or v.dying >= 0.0:
		return Vector3.INF
	var top := v.h * (0.5 if v.flies else 1.0) + 0.35
	var xf := global_transform if is_inside_tree() else transform
	return xf * (v.root.position + Vector3(0, top, 0))


func clear() -> void:
	for id in views:
		(views[id] as View).root.queue_free()
	views.clear()
