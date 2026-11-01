class_name CastleModels
extends RefCounted
## The enemies and bosses as rigs: a Node3D whose origin is at the feet (flyers and the dragon: the body's
## centre), forward +x, up +y, with named pivots the view animates (scripts/units.gd):
##   humanoids  body, head, arm_l (far side, +z), arm_r (near side, −z: the weapon hand), leg_l, leg_r
##   ram        body, weapon (the swinging log), wheel_f, wheel_b
##   golem      body, head, arm_l, arm_r, leg_l, leg_r
##   flyer      body, head, wing_l, wing_r, tail
##   titan      + joints (the glowing weak points, shown when open), core
##   dragon     body, head, jaw, wing_l, wing_r, tail
##   beast      body, head, jaw, leg_fl, leg_fr, leg_bl, leg_br, tail
##   king       humanoid + aura (hidden until phase 3)
## Weapons from the CC0 model pack (assets/avramania: spear, dagger, round shield, mace, arming sword, short bow
## and quiver, hand axes, short sword and buckler) hang in the arm pivots as their own MeshInstance3D, named
## after the model; the bosses keep their oversized procedural weapons.
## Every mesh is built once per kind (Kit builders, shared materials) and instanced for each enemy.

static var _specs := {}             # kind -> [{name, parent, at, mesh}]
static var _aura_mat: Material

const SKIN := Color("#f0c39a")
const SKIN_DARK := Color("#c98f66")
const DARK := Color("#1d1a1a")
const BOOT := Color("#3b2a1e")
const WOOD := Color("#8a5a32")
const STEEL := Color("#b9c2cc")
const IRON := Color("#55596a")
const GOLD := Color("#e8b84a")


## A fresh rig for an enemy or boss kind.
static func rig(kind: String) -> Node3D:
	if not _specs.has(kind):
		_specs[kind] = _bake(_design(kind))
	var root := Node3D.new()
	root.name = kind
	var nodes := {"": root}
	for p in _specs[kind]:
		if p.has("pack"):
			# a weapon from the model pack, held at its grip
			var w := Kit.pack_node(p.pack, p.at, p.scale)
			w.name = p.pack
			w.rotation_degrees = p.rot
			(nodes[p.parent] as Node3D).add_child(w)
			continue
		var pivot := Node3D.new()
		pivot.name = p.name
		pivot.position = p.at
		(nodes[p.parent] as Node3D).add_child(pivot)
		nodes[p.name] = pivot
		if p.mesh:
			var mi := MeshInstance3D.new()
			mi.mesh = p.mesh
			pivot.add_child(mi)
	if kind == "dark_king":
		var aura := MeshInstance3D.new()
		aura.name = "aura"
		var sm := SphereMesh.new()
		sm.radius = 2.3
		sm.height = 4.6
		aura.mesh = sm
		aura.position = Vector3(0, 2.1, 0)
		aura.material_override = aura_material()
		aura.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		aura.visible = false
		root.add_child(aura)
	return root


static func aura_material() -> Material:
	if _aura_mat == null:
		var m := StandardMaterial3D.new()
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		m.albedo_color = Color(0.9, 0.1, 0.05, 0.22)
		_aura_mat = m
	return _aura_mat


static func _bake(parts: Array) -> Array:
	var out := []
	for p in parts:
		if p.has("pack"):
			out.append(p)
			continue
		var b: Kit.Builder = p.b
		out.append({name = p.name, parent = p.parent, at = p.at, mesh = null if b.is_empty() else b.mesh()})
	return out


static func _p(name: String, parent: String, at: Vector3) -> Dictionary:
	return {name = name, parent = parent, at = at, b = Kit.builder()}


## A pack weapon (assets/avramania, see Kit.pack) in a pivot: grip at `at`, blade along +y turned by rot
## (degrees; z tilts the blade forward when negative, y 90 turns a shield or bow to face forward).
static func _w(parts: Array, parent: String, pack: String, at: Vector3, scale: float, rot := Vector3.ZERO) -> void:
	parts.append({pack = "weapons_" + pack, parent = parent, at = at, scale = scale, rot = rot})


static func _find(parts: Array, name: String) -> Kit.Builder:
	for p in parts:
		if not p.has("pack") and p.name == name:
			return p.b
	return null


static func _design(kind: String) -> Array:
	match kind:
		"footman": return _footman()
		"scout": return _scout()
		"shield": return _shield()
		"knight": return _knight()
		"archer": return _archer()
		"ram": return _ram()
		"golem": return _golem()
		"berserker": return _berserker()
		"commander": return _commander()
		"flyer": return _flyer()
		"iron_warlord": return _warlord()
		"siege_titan": return _titan()
		"fire_dragon": return _dragon()
		"shadow_beast": return _beast()
		"dark_king": return _king()
	return _footman()


## ── The humanoid template ──
## o: h (height), bulk (width factor), tunic, pants, sleeve, skin, boot, belt, plate (metal torso colour or null),
## plate_mat. Returns the parts; the caller decorates them through _find().
static func _humanoid(o: Dictionary) -> Array:
	var s: float = float(o.h) / 1.7
	var k: float = o.get("bulk", 1.0)
	var hip := 0.62 * s
	var tunic: Color = o.get("tunic", Color("#5f7d3a"))
	var pants: Color = o.get("pants", Color("#6b4a2b"))
	var sleeve: Color = o.get("sleeve", tunic)
	var skin: Color = o.get("skin", SKIN)
	var boot: Color = o.get("boot", BOOT)
	var belt: Color = o.get("belt", Color("#3a2617"))
	var tmat: String = o.get("tunic_mat", "matte")
	var parts := []
	for side in [1, -1]:
		var leg := _p("leg_l" if side > 0 else "leg_r", "", Vector3(0, hip, 0.13 * s * k * side))
		leg.b.add("box", Vector3(0, -0.24 * s, 0), Vector3(0.2 * s * k, 0.44 * s, 0.19 * s * k), pants, o.get("pants_mat", "matte"))
		leg.b.add("box", Vector3(0.04 * s, -0.53 * s, 0), Vector3(0.3 * s, 0.19 * s, 0.21 * s * k), boot, o.get("boot_mat", "matte"))
		parts.append(leg)
	var body := _p("body", "", Vector3(0, hip, 0))
	body.b.add("box", Vector3(0, 0.29 * s, 0), Vector3(0.4 * s * k, 0.58 * s, 0.52 * s * k), tunic, tmat)
	body.b.add("box", Vector3(0, 0.03 * s, 0), Vector3(0.43 * s * k, 0.12 * s, 0.55 * s * k), tunic.darkened(0.15), tmat)
	body.b.add("box", Vector3(0, 0.08 * s, 0), Vector3(0.44 * s * k, 0.07 * s, 0.56 * s * k), belt)
	body.b.add("box", Vector3(0.22 * s * k, 0.08 * s, 0), Vector3(0.04 * s, 0.09 * s, 0.1 * s), GOLD, "metal")
	parts.append(body)
	var head := _p("head", "body", Vector3(0, 0.58 * s, 0))
	head.b.add("ball", Vector3(0, 0.22 * s, 0), Vector3(0.46, 0.46, 0.44) * s, skin)
	head.b.add("ball", Vector3(0.21 * s, 0.2 * s, 0), Vector3(0.1, 0.1, 0.09) * s, skin.darkened(0.08))
	for z in [0.085, -0.085]:
		head.b.add("ball", Vector3(0.19 * s, 0.26 * s, z * s), Vector3(0.07, 0.08, 0.07) * s, DARK)
	parts.append(head)
	for side in [1, -1]:
		var arm := _p("arm_l" if side > 0 else "arm_r", "body", Vector3(0, 0.52 * s, 0.31 * s * k * side))
		arm.b.beam(Vector3(0, 0.04 * s, 0), Vector3(0, -0.4 * s, 0), Vector2(0.15, 0.15) * s * k, sleeve, o.get("sleeve_mat", tmat))
		arm.b.add("ball", Vector3(0, -0.46 * s, 0), Vector3(0.15, 0.15, 0.15) * s * k, o.get("hand", skin), o.get("hand_mat", "matte"))
		parts.append(arm)
	return parts


static func _kettle_helm(b: Kit.Builder, s: float, c: Color) -> void:
	b.add("cyl", Vector3(0, 0.33 * s, 0), Vector3(0.66, 0.04, 0.66) * s, c, "metal")
	b.add("ball", Vector3(0, 0.36 * s, 0), Vector3(0.5, 0.36, 0.5) * s, c, "metal")


## ── Enemies ──

static func _footman() -> Array:
	var h := 1.7
	var s := h / 1.7
	var parts := _humanoid({h = h, tunic = Color("#5f8a3a"), pants = Color("#7a5232")})
	_kettle_helm(_find(parts, "head"), s, Color("#9aa3ad"))
	# a spear held upright, leaning forward, and a round shield on the far arm
	_w(parts, "arm_r", "spear_01", Vector3(0.02, -0.46, -0.06) * s, 1.05 * s, Vector3(0, 0, -15))
	_w(parts, "arm_l", "shield_round_01", Vector3(0.14, -0.38, 0.0) * s, 0.75 * s, Vector3(0, 90, 0))
	return parts


static func _scout() -> Array:
	var h := 1.5
	var s := h / 1.7
	var green := Color("#3f6a4a")
	var parts := _humanoid({h = h, bulk = 0.8, tunic = green, pants = Color("#4a3c2c"), boot = Color("#2a2018")})
	var hd := _find(parts, "head")
	hd.add("ball", Vector3(-0.06, 0.25, 0) * s, Vector3(0.52, 0.52, 0.52) * s, green.darkened(0.15))
	hd.add("cone", Vector3(-0.24, 0.38, 0) * s, Vector3(0.22, 0.42, 0.22) * s, green.darkened(0.2), "matte", Vector3(0, 0, 60))
	hd.add("box", Vector3(0.12, 0.08, 0) * s, Vector3(0.18, 0.08, 0.38) * s, Color("#c9b27a"))   # scarf
	var bd := _find(parts, "body")
	bd.add("box", Vector3(0.1, 0.3, 0) * s, Vector3(0.05, 0.5, 0.06) * s, Color("#3a2617"), "matte", Vector3(0, 0, -30))
	_w(parts, "arm_l", "dagger_01", Vector3(0.0, -0.46, 0.04) * s, 1.6 * s, Vector3(0, 0, -75))
	_w(parts, "arm_r", "dagger_01", Vector3(0.0, -0.46, -0.04) * s, 1.6 * s, Vector3(0, 0, -75))
	return parts


static func _shield() -> Array:
	var h := 1.8
	var s := h / 1.7
	var blue := Color("#3b62a8")
	var parts := _humanoid({h = h, bulk = 1.1, tunic = blue, pants = Color("#55463a")})
	_kettle_helm(_find(parts, "head"), s, Color("#8f9aa6"))
	var l := _find(parts, "arm_l")
	# the tower shield covers the front, from the shins to the chin
	var z := -0.33 * s * 1.1
	l.add("box", Vector3(0.36, -0.2, 0) * s + Vector3(0, 0, z), Vector3(0.1, 1.15, 0.72) * s, blue.lightened(0.05), "wood")
	l.add("box", Vector3(0.42, -0.2, 0) * s + Vector3(0, 0, z), Vector3(0.03, 1.2, 0.08) * s, Color("#f1e6c8"))
	l.add("box", Vector3(0.42, 0.0, 0) * s + Vector3(0, 0, z), Vector3(0.03, 0.08, 0.5) * s, Color("#f1e6c8"))
	l.add("box", Vector3(0.36, 0.37, 0) * s + Vector3(0, 0, z), Vector3(0.12, 0.06, 0.76) * s, STEEL, "metal")
	l.add("box", Vector3(0.36, -0.77, 0) * s + Vector3(0, 0, z), Vector3(0.12, 0.06, 0.76) * s, STEEL, "metal")
	l.add("ball", Vector3(0.43, 0.0, 0) * s + Vector3(0, 0, z), Vector3(0.1, 0.14, 0.14) * s, GOLD, "metal")
	_w(parts, "arm_r", "mace_01", Vector3(0.0, -0.46, -0.05) * s, 1.5 * s, Vector3(0, 0, -25))
	return parts


static func _knight() -> Array:
	var h := 2.0
	var s := h / 1.7
	var parts := _humanoid({h = h, bulk = 1.25, tunic = STEEL, tunic_mat = "metal", sleeve = STEEL, pants = STEEL.darkened(0.15),
		pants_mat = "metal", boot = IRON, boot_mat = "metal", hand = IRON, hand_mat = "metal"})
	var bd := _find(parts, "body")
	bd.add("box", Vector3(0.13, 0.22, 0) * s, Vector3(0.2, 0.5, 0.46) * s, Color("#b8322e"))      # tabard
	bd.add("box", Vector3(0.235, 0.3, 0) * s, Vector3(0.02, 0.22, 0.06) * s, GOLD)
	bd.add("box", Vector3(0.235, 0.33, 0) * s, Vector3(0.02, 0.06, 0.2) * s, GOLD)
	for z in [1, -1]:
		bd.add("ball", Vector3(0, 0.55, 0.32 * z) * s, Vector3(0.3, 0.22, 0.3) * s, STEEL, "metal")
	var hd := _find(parts, "head")
	hd.add("cyl", Vector3(0, 0.25, 0) * s, Vector3(0.52, 0.5, 0.52) * s, STEEL, "metal")
	hd.add("half", Vector3(0, 0.5, 0) * s, Vector3(0.52, 0.3, 0.52) * s, STEEL, "metal")
	hd.add("box", Vector3(0.26, 0.28, 0) * s, Vector3(0.02, 0.05, 0.34) * s, DARK)
	hd.add("ball", Vector3(-0.05, 0.66, 0) * s, Vector3(0.5, 0.24, 0.12) * s, Color("#e0433a"), "matte", Vector3(0, 0, -20))
	_w(parts, "arm_r", "armingsword_01", Vector3(0.0, -0.46, -0.06) * s, 1.3 * s, Vector3(0, 0, -55))
	return parts


static func _archer() -> Array:
	var h := 1.7
	var s := h / 1.7
	var parts := _humanoid({h = h, bulk = 0.9, tunic = Color("#7b8f3a"), pants = Color("#5a4632"), sleeve = Color("#9a6b3e")})
	var hd := _find(parts, "head")
	hd.add("ball", Vector3(-0.02, 0.38, 0) * s, Vector3(0.52, 0.22, 0.5) * s, Color("#6d7f2f"))
	hd.add("cone", Vector3(0.06, 0.48, 0) * s, Vector3(0.34, 0.22, 0.34) * s, Color("#6d7f2f"), "matte", Vector3(0, 0, -15))
	hd.add("box", Vector3(-0.2, 0.56, 0.05) * s, Vector3(0.04, 0.32, 0.06) * s, Color("#d94a3a"), "matte", Vector3(0, 0, 35))
	_w(parts, "body", "quiver_01", Vector3(-0.27, 0.02, 0.1) * s, 1.15 * s, Vector3(0, 0, 25))
	_w(parts, "arm_l", "shortbow_01", Vector3(0.2, -0.42, -0.12) * s, 1.4 * s, Vector3(0, 90, 0))
	return parts


static func _berserker() -> Array:
	var h := 1.8
	var s := h / 1.7
	var parts := _humanoid({h = h, bulk = 1.15, tunic = SKIN_DARK, sleeve = SKIN_DARK, pants = Color("#6e4a2a"), belt = Color("#4a2a18")})
	var bd := _find(parts, "body")
	for k in 3:
		bd.add("box", Vector3(0.205, 0.2 + k * 0.13, 0) * s * Vector3(1.15, 1, 1), Vector3(0.02, 0.05, 0.4) * s, Color("#c42a22"), "matte", Vector3(18 * (k - 1), 0, 0))
	bd.add("box", Vector3(0, -0.02, 0) * s, Vector3(0.5, 0.22, 0.62) * s, Color("#7a5a3a"))         # fur kilt
	bd.add("box", Vector3(0.0, 0.48, 0.0) * s, Vector3(0.48, 0.12, 0.7) * s, Color("#8a6a48"))        # fur mantle
	var hd := _find(parts, "head")
	hd.add("box", Vector3(0.22, 0.24, 0) * s, Vector3(0.02, 0.04, 0.3) * s, Color("#c42a22"))
	for k in 7:
		var a := deg_to_rad(-70 + k * 25)
		hd.add("cone4", Vector3(-0.05 + sin(a) * 0.18, 0.36 + cos(a) * 0.14, (k % 3 - 1) * 0.08) * s, Vector3(0.14, 0.3, 0.14) * s, Color("#e0702a"), "matte", Vector3(0, 0, -rad_to_deg(a) * 0.8))
	hd.add("box", Vector3(0.2, 0.06, 0) * s, Vector3(0.12, 0.16, 0.24) * s, Color("#d0602a"))        # beard
	_w(parts, "arm_l", "handaxe_01", Vector3(0.0, -0.46, 0.04) * s, 1.6 * s, Vector3(0, 0, -55))
	_w(parts, "arm_r", "handaxe_01", Vector3(0.0, -0.46, -0.05) * s, 1.6 * s, Vector3(0, 0, -55))
	return parts


static func _commander() -> Array:
	var h := 2.1
	var s := h / 1.7
	var plate := Color("#3c4150")
	var parts := _humanoid({h = h, bulk = 1.15, tunic = plate, tunic_mat = "metal", sleeve = plate, pants = plate.darkened(0.2),
		pants_mat = "metal", boot = Color("#22242c"), boot_mat = "metal", hand = plate, hand_mat = "metal"})
	var bd := _find(parts, "body")
	bd.add("box", Vector3(-0.24, 0.0, 0) * s, Vector3(0.06, 1.0, 0.62) * s, Color("#6a2c8a"), "matte", Vector3(0, 0, -6))   # cape
	bd.add("box", Vector3(0.23, 0.3, 0) * s, Vector3(0.02, 0.5, 0.05) * s, GOLD, "metal")
	bd.add("box", Vector3(0.23, 0.5, 0) * s, Vector3(0.02, 0.05, 0.45) * s, GOLD, "metal")
	for z in [1, -1]:
		bd.add("ball", Vector3(0, 0.55, 0.33 * z) * s, Vector3(0.32, 0.24, 0.32) * s, GOLD, "metal")
	# the banner on his back, high above the ranks
	bd.beam(Vector3(-0.3, -0.1, 0) * s, Vector3(-0.3, 1.5, 0) * s, Vector2(0.05, 0.05) * s, WOOD, "wood")
	bd.add("box", Vector3(-0.52, 1.18, 0) * s, Vector3(0.44, 0.58, 0.03) * s, Color("#b02a2a"))
	bd.add("box", Vector3(-0.52, 1.2, 0) * s, Vector3(0.18, 0.2, 0.04) * s, GOLD)
	bd.add("ball", Vector3(-0.3, 1.53, 0) * s, Vector3(0.1, 0.1, 0.1) * s, GOLD, "metal")
	var hd := _find(parts, "head")
	hd.add("cyl", Vector3(0, 0.27, 0) * s, Vector3(0.5, 0.42, 0.5) * s, plate, "metal")
	hd.add("box", Vector3(0.25, 0.26, 0) * s, Vector3(0.02, 0.05, 0.32) * s, DARK)
	for k in 5:
		hd.add("cone4", Vector3(0, 0.5, (k - 2) * 0.1) * s, Vector3(0.08, 0.2, 0.08) * s, GOLD, "metal")
	_w(parts, "arm_r", "shortsword_01", Vector3(0.0, -0.46, -0.06) * s, 1.5 * s, Vector3(0, 0, -55))
	_w(parts, "arm_l", "buckler_01", Vector3(0.12, -0.42, 0.02) * s, 1.4 * s, Vector3(0, 90, 0))
	return parts


static func _ram() -> Array:
	var parts := []
	var body := _p("body", "", Vector3.ZERO)
	var b: Kit.Builder = body.b
	var hide := Color("#a0683a")
	# chassis, posts and a hide-covered roof
	b.add("box", Vector3(0, 0.45, 0), Vector3(2.3, 0.14, 1.0), WOOD.darkened(0.1), "wood")
	for x in [-0.95, 0.95]:
		for z in [-0.45, 0.45]:
			b.beam(Vector3(x, 0.45, z), Vector3(x * 0.95, 1.2, z), Vector2(0.1, 0.1), WOOD, "wood")
	b.add("prism", Vector3(0, 1.38, 0), Vector3(1.35, 0.55, 2.5), hide, "matte", Vector3(0, 90, 0))
	b.add("prism", Vector3(0, 1.4, 0), Vector3(1.0, 0.48, 2.55), hide.darkened(0.2), "matte", Vector3(0, 90, 0))
	for k in 4:
		b.add("box", Vector3(-0.9 + k * 0.6, 1.36, 0), Vector3(0.06, 0.06, 1.42), Color("#5a3a20"), "wood")
	b.add("box", Vector3(-1.15, 1.0, 0), Vector3(0.05, 0.45, 0.9), Color("#7a2a22"))
	parts.append(body)
	var log := _p("weapon", "body", Vector3(0.0, 0.85, 0))
	log.b.add("cyl", Vector3(0.25, 0, 0), Vector3(0.32, 2.7, 0.32), Color("#7a4a26"), "wood", Vector3(0, 0, 90))
	for x in [-0.5, 0.6]:
		log.b.add("cyl", Vector3(x, 0, 0), Vector3(0.36, 0.08, 0.36), IRON, "metal", Vector3(0, 0, 90))
	log.b.add("ball", Vector3(1.6, 0.0, 0), Vector3(0.48, 0.42, 0.42), IRON, "metal")
	log.b.add("box", Vector3(1.82, -0.05, 0), Vector3(0.3, 0.22, 0.3), IRON, "metal")
	for z in [0.13, -0.13]:
		log.b.add("cone", Vector3(1.55, 0.25, z), Vector3(0.1, 0.35, 0.1), Color("#e9dcc0"), "matte", Vector3(z * 120, 0, -35))
		log.b.add("ball", Vector3(1.78, 0.08, z), Vector3(0.07, 0.07, 0.07), Color(1.0, 0.35, 0.15), "glow")
	parts.append(log)
	for nx in [["wheel_f", 0.75], ["wheel_b", -0.75]]:
		var w := _p(nx[0], "body", Vector3(nx[1], 0.34, 0))
		for z in [0.56, -0.56]:
			w.b.add("cyl", Vector3(0, 0, z), Vector3(0.68, 0.12, 0.68), WOOD.darkened(0.2), "wood", Vector3(90, 0, 0))
			w.b.add("box", Vector3(0, 0, z), Vector3(0.62, 0.08, 0.14), WOOD.darkened(0.35), "wood")
			w.b.add("cyl", Vector3(0, 0, z), Vector3(0.18, 0.16, 0.18), IRON, "metal", Vector3(90, 0, 0))
		parts.append(w)
	return parts


static func _golem() -> Array:
	var stone := Color("#8d8577")
	var rune := Color(0.35, 0.95, 1.0)
	var parts := []
	for side in [1, -1]:
		var leg := _p("leg_l" if side > 0 else "leg_r", "", Vector3(0, 0.95, 0.42 * side))
		leg.b.add("box", Vector3(0, -0.45, 0), Vector3(0.55, 0.95, 0.55), stone.darkened(0.08), "stone", Vector3(0, 8 * side, 3))
		leg.b.add("box", Vector3(0.1, -0.88, 0), Vector3(0.75, 0.2, 0.62), stone.darkened(0.15), "stone")
		parts.append(leg)
	var body := _p("body", "", Vector3(0, 0.95, 0))
	body.b.add("box", Vector3(0, 0.75, 0), Vector3(1.25, 1.3, 1.5), stone, "stone", Vector3(0, 0, -6))
	body.b.add("box", Vector3(0.05, 0.1, 0), Vector3(0.95, 0.4, 1.2), stone.darkened(0.1), "stone")
	body.b.add("ball_lo", Vector3(-0.3, 1.45, 0.4), Vector3(0.6, 0.45, 0.6), stone.lightened(0.05), "stone")
	body.b.add("ball_lo", Vector3(-0.2, 1.4, -0.45), Vector3(0.55, 0.42, 0.55), stone.darkened(0.05), "stone")
	body.b.add("box", Vector3(0.63, 0.85, 0), Vector3(0.04, 0.5, 0.1), rune, "glow")
	body.b.add("box", Vector3(0.63, 0.85, 0), Vector3(0.04, 0.1, 0.45), rune, "glow")
	body.b.add("box", Vector3(0.6, 0.45, 0.35), Vector3(0.04, 0.25, 0.08), rune, "glow", Vector3(30, 0, 0))
	body.b.add("half", Vector3(-0.2, 1.42, 0), Vector3(0.9, 0.3, 0.9), Color("#5c8a3a"), "foliage")     # moss
	parts.append(body)
	var head := _p("head", "body", Vector3(0.2, 1.45, 0))
	head.b.add("box", Vector3(0.05, 0.12, 0), Vector3(0.5, 0.42, 0.55), stone.lightened(0.08), "stone")
	for z in [0.12, -0.12]:
		head.b.add("box", Vector3(0.31, 0.15, z), Vector3(0.04, 0.08, 0.12), rune, "glow")
	parts.append(head)
	for side in [1, -1]:
		var arm := _p("arm_l" if side > 0 else "arm_r", "body", Vector3(0, 1.2, 0.95 * side))
		arm.b.add("box", Vector3(0, -0.35, 0), Vector3(0.5, 0.75, 0.5), stone, "stone", Vector3(0, 0, 8))
		arm.b.add("ball_lo", Vector3(0.05, -0.95, 0), Vector3(0.8, 0.7, 0.75), stone.darkened(0.1), "stone")
		arm.b.add("box", Vector3(0.0, -0.3, 0.26 * side), Vector3(0.18, 0.04, 0.04), rune, "glow")
		parts.append(arm)
	return parts


static func _flyer() -> Array:
	var purple := Color("#7a3a8e")
	var wingc := Color("#4a2a5a")
	var parts := []
	var body := _p("body", "", Vector3.ZERO)
	body.b.add("ball", Vector3(0, 0, 0), Vector3(0.48, 0.42, 0.38), purple)
	body.b.add("ball", Vector3(0.05, -0.06, 0), Vector3(0.3, 0.26, 0.3), Color("#c08ad0"))
	for z in [0.1, -0.1]:
		body.b.beam(Vector3(0, -0.15, z), Vector3(-0.05, -0.32, z), Vector2(0.06, 0.06), purple.darkened(0.2))
	parts.append(body)
	var head := _p("head", "body", Vector3(0.24, 0.1, 0))
	head.b.add("ball", Vector3(0.04, 0.02, 0), Vector3(0.34, 0.3, 0.32), purple.lightened(0.1))
	for z in [0.09, -0.09]:
		head.b.add("cone", Vector3(-0.02, 0.2, z), Vector3(0.11, 0.24, 0.07), purple.darkened(0.1), "matte", Vector3(z * 150, 0, 15))
		head.b.add("ball", Vector3(0.18, 0.05, z * 0.8), Vector3(0.08, 0.08, 0.07), Color(1.0, 0.9, 0.2), "glow")
	head.b.add("cone", Vector3(0.2, -0.08, 0.04), Vector3(0.03, 0.08, 0.03), Color.WHITE, "matte", Vector3(180, 0, 0))
	head.b.add("cone", Vector3(0.2, -0.08, -0.04), Vector3(0.03, 0.08, 0.03), Color.WHITE, "matte", Vector3(180, 0, 0))
	parts.append(head)
	for side in [1, -1]:
		var w := _p("wing_l" if side > 0 else "wing_r", "body", Vector3(-0.02, 0.1, 0.14 * side))
		w.b.add("prism", Vector3(-0.08, 0, 0.38 * side), Vector3(0.6, 0.72, 0.025), wingc, "matte", Vector3(90 * side, 0, 0))
		w.b.beam(Vector3(0, 0, 0), Vector3(0.1, 0.05, 0.74 * side), Vector2(0.04, 0.04), purple.darkened(0.3))
		w.b.beam(Vector3(0.1, 0.05, 0.74 * side), Vector3(-0.3, 0, 0.55 * side), Vector2(0.025, 0.025), purple.darkened(0.3))
		parts.append(w)
	var tail := _p("tail", "body", Vector3(-0.2, -0.02, 0))
	tail.b.beam(Vector3.ZERO, Vector3(-0.35, -0.12, 0), Vector2(0.05, 0.05), purple.darkened(0.15))
	tail.b.add("cone4", Vector3(-0.42, -0.14, 0), Vector3(0.14, 0.16, 0.04), Color("#c83a5a"), "matte", Vector3(0, 0, 70))
	parts.append(tail)
	return parts


## ── Bosses ──

static func _warlord() -> Array:
	var h := 3.0
	var s := h / 1.7
	var iron := Color("#4b4f5c")
	var parts := _humanoid({h = h, bulk = 1.4, tunic = iron, tunic_mat = "metal", sleeve = iron, pants = iron.darkened(0.2),
		pants_mat = "metal", boot = Color("#2a2c33"), boot_mat = "metal", hand = iron, hand_mat = "metal", belt = Color("#6a1a16")})
	var bd := _find(parts, "body")
	bd.add("box", Vector3(-0.27, -0.05, 0) * s, Vector3(0.06, 1.05, 0.8) * s, Color("#9a1f1a"), "matte", Vector3(0, 0, -5))
	bd.add("box", Vector3(0.29, 0.3, 0) * s, Vector3(0.03, 0.42, 0.3) * s, Color("#9a1f1a"))
	bd.add("ball", Vector3(0.29, 0.35, 0) * s, Vector3(0.05, 0.14, 0.14) * s, GOLD, "metal")
	for z in [1, -1]:
		bd.add("ball", Vector3(0, 0.56, 0.42 * z) * s, Vector3(0.42, 0.3, 0.42) * s, iron.lightened(0.1), "metal")
		for k in 3:
			bd.add("cone", Vector3(-0.1 + k * 0.1, 0.72, 0.45 * z) * s, Vector3(0.07, 0.22, 0.07) * s, Color("#d8d2c4"), "metal")
	var hd := _find(parts, "head")
	hd.add("cyl", Vector3(0, 0.26, 0) * s, Vector3(0.56, 0.54, 0.56) * s, iron, "metal")
	hd.add("half", Vector3(0, 0.53, 0) * s, Vector3(0.56, 0.28, 0.56) * s, iron, "metal")
	hd.add("box", Vector3(0.28, 0.3, 0) * s, Vector3(0.02, 0.05, 0.36) * s, Color(1.0, 0.25, 0.1), "glow")
	for z in [1, -1]:
		hd.beam(Vector3(0, 0.5, 0.24 * z) * s, Vector3(0.05, 0.75, 0.42 * z) * s, Vector2(0.09, 0.09) * s, Color("#e9dcc0"), "matte", "cone")
	var r := _find(parts, "arm_r")
	# the great maul
	r.beam(Vector3(-0.05, -0.75, 0) * s, Vector3(0.12, 0.85, 0) * s, Vector2(0.07, 0.07) * s, Color("#3a2618"), "wood")
	r.add("box", Vector3(0.14, 0.92, 0) * s, Vector3(0.5, 0.32, 0.36) * s, iron.darkened(0.2), "metal", Vector3(0, 0, -6))
	for k in 3:
		r.add("cone4", Vector3(0.42, 0.82 + k * 0.1, 0) * s, Vector3(0.08, 0.16, 0.08) * s, Color("#d8d2c4"), "metal", Vector3(0, 0, -90))
	return parts


static func _titan() -> Array:
	var stone := Color("#7f7668")
	var plate := Color("#5c5f66")
	var fire := Color(1.0, 0.55, 0.15)
	var parts := []
	for side in [1, -1]:
		var leg := _p("leg_l" if side > 0 else "leg_r", "", Vector3(0, 1.9, 0.85 * side))
		leg.b.add("box", Vector3(0, -0.9, 0), Vector3(1.0, 1.9, 1.0), stone, "stone")
		leg.b.add("box", Vector3(0.05, -0.55, 0), Vector3(1.08, 0.5, 1.08), plate, "metal")
		leg.b.add("box", Vector3(0.2, -1.78, 0), Vector3(1.4, 0.3, 1.2), stone.darkened(0.15), "stone")
		parts.append(leg)
	var body := _p("body", "", Vector3(0, 1.9, 0))
	body.b.add("box", Vector3(0, 1.45, 0), Vector3(2.4, 2.5, 3.0), stone, "stone")
	body.b.add("box", Vector3(0.05, 1.9, 0), Vector3(2.5, 0.35, 3.1), plate, "metal")
	body.b.add("box", Vector3(0.05, 0.75, 0), Vector3(2.5, 0.3, 3.1), plate, "metal")
	body.b.add("box", Vector3(-0.2, 0.15, 0), Vector3(2.0, 0.5, 2.4), stone.darkened(0.1), "stone")
	for z in [-1.0, 0.0, 1.0]:
		body.b.add("ball", Vector3(1.26, 1.9, z), Vector3(0.14, 0.14, 0.14), Color("#d8d2c4"), "metal")
	body.b.add("half", Vector3(-0.4, 2.7, 0.6), Vector3(1.2, 0.4, 1.0), Color("#5c8a3a"), "foliage")
	body.b.add("box", Vector3(-0.5, 2.85, -0.7), Vector3(0.6, 0.6, 0.6), stone.darkened(0.05), "stone", Vector3(10, 20, 8))
	parts.append(body)
	var core := _p("core", "body", Vector3(1.21, 1.35, 0))
	core.b.add("cyl6", Vector3.ZERO, Vector3(0.7, 0.08, 0.7), plate.darkened(0.2), "metal", Vector3(0, 0, 90))
	core.b.add("ball", Vector3(0.04, 0, 0), Vector3(0.18, 0.5, 0.5), fire, "glow")
	parts.append(core)
	var head := _p("head", "body", Vector3(0.3, 2.7, 0))
	head.b.add("box", Vector3(0, 0.35, 0), Vector3(0.9, 0.7, 1.0), plate, "metal")
	head.b.add("box", Vector3(0.46, 0.38, 0), Vector3(0.04, 0.1, 0.6), fire, "glow")
	head.b.add("cone4", Vector3(0, 0.82, 0), Vector3(0.5, 0.35, 0.5), plate.darkened(0.2), "metal", Vector3(0, 45, 0))
	parts.append(head)
	for side in [1, -1]:
		var arm := _p("arm_l" if side > 0 else "arm_r", "body", Vector3(0, 2.3, 1.85 * side))
		arm.b.add("ball_lo", Vector3(0, 0.1, 0), Vector3(1.1, 0.9, 1.1), plate, "metal")
		arm.b.add("box", Vector3(0, -0.8, 0), Vector3(0.75, 1.6, 0.75), stone, "stone")
		arm.b.add("box", Vector3(0.1, -1.95, 0), Vector3(1.1, 0.9, 1.0), stone.darkened(0.12), "stone")
		arm.b.add("box", Vector3(0.1, -1.6, 0), Vector3(1.15, 0.2, 1.05), plate, "metal")
		parts.append(arm)
	var joints := _p("joints", "body", Vector3.ZERO)
	# the weak points: shoulder sockets and hip joints, glowing through the gaps in the armour
	for side in [1, -1]:
		joints.b.add("ball", Vector3(0.35, 2.25, 1.5 * side), Vector3(0.85, 0.85, 0.7), fire, "glow")
		joints.b.add("ball", Vector3(0.55, -0.15, 0.85 * side), Vector3(0.55, 0.5, 0.6), fire, "glow")
	joints.b.add("ball", Vector3(1.25, 1.35, 0), Vector3(0.3, 0.75, 0.75), Color(1.0, 0.85, 0.4), "glow")
	parts.append(joints)
	return parts


static func _dragon() -> Array:
	var red := Color("#c8402a")
	var belly := Color("#f2c46a")
	var wing := Color("#e0703a")
	var horn := Color("#efe2c4")
	var parts := []
	var body := _p("body", "", Vector3.ZERO)
	body.b.add("capsule", Vector3(0, 0, 0), Vector3(1.15, 1.05, 1.0), red, "matte", Vector3(0, 0, 90))
	body.b.add("ball", Vector3(0.1, -0.28, 0), Vector3(1.7, 0.6, 0.75), belly)
	for k in 5:
		body.b.add("cone4", Vector3(-0.8 + k * 0.4, 0.55, 0), Vector3(0.2, 0.32, 0.08), red.darkened(0.3), "matte", Vector3(0, 0, -20))
	# legs tucked under in flight: thigh down, shin swept back, claws forward
	for x in [0.55, -0.6]:
		for z in [0.34, -0.34]:
			body.b.beam(Vector3(x, -0.3, z), Vector3(x + 0.1, -0.7, z), Vector2(0.24, 0.22), red.darkened(0.15))
			body.b.beam(Vector3(x + 0.1, -0.7, z), Vector3(x - 0.3, -0.85, z), Vector2(0.16, 0.15), red.darkened(0.2))
			body.b.add("cone4", Vector3(x - 0.38, -0.88, z), Vector3(0.08, 0.16, 0.08), horn, "matte", Vector3(0, 0, 90))
	parts.append(body)
	var head := _p("head", "body", Vector3(0.95, 0.25, 0))
	head.b.beam(Vector3(0, 0, 0), Vector3(0.65, 0.55, 0), Vector2(0.48, 0.42), red)
	head.b.add("box", Vector3(0.9, 0.65, 0), Vector3(0.62, 0.42, 0.48), red.lightened(0.05))
	head.b.add("box", Vector3(1.28, 0.6, 0), Vector3(0.38, 0.24, 0.36), red.lightened(0.08))
	for z in [0.16, -0.16]:
		head.b.add("cone", Vector3(0.65, 0.98, z), Vector3(0.1, 0.4, 0.1), horn, "matte", Vector3(0, 0, 60))
		head.b.add("ball", Vector3(1.05, 0.76, z * 1.25), Vector3(0.1, 0.08, 0.06), Color(1.0, 0.9, 0.2), "glow")
		head.b.add("ball", Vector3(1.44, 0.66, z * 0.5), Vector3(0.05, 0.05, 0.05), DARK)
	parts.append(head)
	var jaw := _p("jaw", "head", Vector3(0.7, 0.45, 0))
	jaw.b.add("box", Vector3(0.35, -0.04, 0), Vector3(0.72, 0.12, 0.38), red.darkened(0.1))
	for k in 3:
		jaw.b.add("cone4", Vector3(0.3 + k * 0.17, 0.06, 0.12), Vector3(0.05, 0.1, 0.05), Color.WHITE)
		jaw.b.add("cone4", Vector3(0.3 + k * 0.17, 0.06, -0.12), Vector3(0.05, 0.1, 0.05), Color.WHITE)
	jaw.b.add("box", Vector3(0.3, 0.02, 0), Vector3(0.5, 0.04, 0.26), Color(1.0, 0.5, 0.2), "glow")
	parts.append(jaw)
	for side in [1, -1]:
		var w := _p("wing_l" if side > 0 else "wing_r", "body", Vector3(0.15, 0.45, 0.3 * side))
		w.b.beam(Vector3.ZERO, Vector3(0.3, 0.5, 1.4 * side), Vector2(0.12, 0.12), red.darkened(0.2))
		w.b.beam(Vector3(0.3, 0.5, 1.4 * side), Vector3(-0.2, 0.2, 2.6 * side), Vector2(0.08, 0.08), red.darkened(0.2))
		w.b.add("prism", Vector3(-0.5, 0.2, 1.05 * side), Vector3(2.0, 2.1, 0.04), wing, "matte", Vector3(90 * side, 0, 0))
		w.b.add("prism", Vector3(-0.1, 0.3, 1.9 * side), Vector3(1.0, 1.4, 0.04), wing.darkened(0.1), "matte", Vector3(90 * side, 0, 0))
		parts.append(w)
	var tail := _p("tail", "body", Vector3(-1.05, 0.0, 0))
	tail.b.beam(Vector3.ZERO, Vector3(-0.8, -0.15, 0), Vector2(0.45, 0.4), red)
	tail.b.beam(Vector3(-0.8, -0.15, 0), Vector3(-1.6, 0.05, 0), Vector2(0.28, 0.25), red)
	tail.b.add("cone4", Vector3(-1.8, 0.1, 0), Vector3(0.35, 0.45, 0.06), red.darkened(0.3), "matte", Vector3(0, 0, 80))
	parts.append(tail)
	return parts


static func _beast() -> Array:
	var fur := Color("#2b2438")
	var glow := Color(0.75, 0.45, 1.0)
	var parts := []
	var body := _p("body", "", Vector3(0, 1.1, 0))
	body.b.add("capsule", Vector3(-0.1, 0, 0), Vector3(0.95, 0.85, 0.8), fur, "matte", Vector3(0, 0, 90))
	body.b.add("ball", Vector3(0.55, 0.12, 0), Vector3(1.0, 1.0, 0.9), fur.lightened(0.05))
	for k in 6:
		body.b.add("cone4", Vector3(0.6 - k * 0.32, 0.5 - absf(k - 1.5) * 0.04, 0), Vector3(0.14, 0.45 - k * 0.04, 0.14), fur.darkened(0.3), "matte", Vector3(0, 0, 25))
		body.b.add("ball", Vector3(0.6 - k * 0.32 - 0.08, 0.72 - k * 0.03, 0), Vector3(0.07, 0.07, 0.07), glow, "glow")
	parts.append(body)
	var head := _p("head", "body", Vector3(0.95, 0.3, 0))
	head.b.add("box", Vector3(0.25, 0.05, 0), Vector3(0.55, 0.5, 0.55), fur.lightened(0.04))
	head.b.add("box", Vector3(0.62, -0.05, 0), Vector3(0.45, 0.25, 0.32), fur.lightened(0.08))
	for z in [0.16, -0.16]:
		head.b.add("cone4", Vector3(0.1, 0.4, z), Vector3(0.14, 0.38, 0.1), fur.darkened(0.2), "matte", Vector3(0, 0, 30))
		head.b.add("box", Vector3(0.5, 0.15, z), Vector3(0.12, 0.07, 0.07), glow, "glow")
	head.b.add("ball", Vector3(0.86, 0.0, 0), Vector3(0.1, 0.1, 0.14), DARK)
	parts.append(head)
	var jaw := _p("jaw", "head", Vector3(0.45, -0.15, 0))
	jaw.b.add("box", Vector3(0.18, -0.06, 0), Vector3(0.42, 0.12, 0.28), fur.lightened(0.02))
	for k in 3:
		jaw.b.add("cone4", Vector3(0.05 + k * 0.12, 0.06, 0.1), Vector3(0.04, 0.12, 0.04), Color.WHITE)
		jaw.b.add("cone4", Vector3(0.05 + k * 0.12, 0.06, -0.1), Vector3(0.04, 0.12, 0.04), Color.WHITE)
	parts.append(jaw)
	for leg in [["leg_fl", 0.6, 0.32], ["leg_fr", 0.6, -0.32], ["leg_bl", -0.75, 0.3], ["leg_br", -0.75, -0.3]]:
		var p := _p(leg[0], "", Vector3(leg[1], 1.0, leg[2]))
		p.b.beam(Vector3(0, 0.05, 0), Vector3(0.05, -0.55, 0), Vector2(0.28, 0.28), fur)
		p.b.beam(Vector3(0.05, -0.55, 0), Vector3(-0.05, -0.92, 0), Vector2(0.2, 0.2), fur.darkened(0.1))
		p.b.add("box", Vector3(0.05, -0.96, 0), Vector3(0.32, 0.1, 0.24), fur.darkened(0.2))
		for z in [-0.07, 0.0, 0.07]:
			p.b.add("cone4", Vector3(0.22, -0.97, z), Vector3(0.04, 0.12, 0.04), Color("#e6e0f0"), "matte", Vector3(0, 0, -90))
		parts.append(p)
	var tail := _p("tail", "body", Vector3(-0.95, 0.1, 0))
	tail.b.beam(Vector3.ZERO, Vector3(-0.7, 0.35, 0), Vector2(0.2, 0.2), fur)
	tail.b.add("cone4", Vector3(-0.8, 0.42, 0), Vector3(0.18, 0.35, 0.18), glow, "glow", Vector3(0, 0, 60))
	parts.append(tail)
	return parts


static func _king() -> Array:
	var h := 4.0
	var s := h / 1.7
	var black := Color("#2a2433")
	var violet := Color(0.75, 0.4, 1.0)
	var parts := _humanoid({h = h, bulk = 1.15, tunic = black, tunic_mat = "metal", sleeve = black, pants = black.darkened(0.2),
		pants_mat = "metal", boot = Color("#1a161e"), boot_mat = "metal", hand = black, hand_mat = "metal", belt = Color("#5a1a6a")})
	var bd := _find(parts, "body")
	bd.add("box", Vector3(-0.25, -0.15, 0) * s, Vector3(0.06, 1.25, 0.82) * s, Color("#4a1a5e"), "matte", Vector3(0, 0, -6))
	bd.add("box", Vector3(-0.27, -0.15, 0) * s, Vector3(0.04, 1.2, 0.76) * s, Color("#8a1a2a"), "matte", Vector3(0, 0, -6))
	bd.add("box", Vector3(0.215, 0.32, 0) * s, Vector3(0.02, 0.42, 0.05) * s, violet, "glow")
	bd.add("box", Vector3(0.215, 0.42, 0) * s, Vector3(0.02, 0.05, 0.3) * s, violet, "glow")
	for z in [1, -1]:
		bd.add("ball", Vector3(0, 0.56, 0.36 * z) * s, Vector3(0.36, 0.26, 0.36) * s, black.lightened(0.08), "metal")
		bd.add("cone", Vector3(0, 0.72, 0.4 * z) * s, Vector3(0.08, 0.26, 0.08) * s, GOLD, "metal", Vector3(25 * z, 0, 0))
	var hd := _find(parts, "head")
	hd.add("ball", Vector3(0, 0.22, 0) * s, Vector3(0.5, 0.5, 0.48) * s, black, "metal")
	hd.add("box", Vector3(0.25, 0.25, 0) * s, Vector3(0.02, 0.06, 0.32) * s, violet, "glow")
	hd.add("cyl", Vector3(0, 0.45, 0) * s, Vector3(0.46, 0.1, 0.46) * s, GOLD, "metal")
	for k in 7:
		var a := k * TAU / 7.0
		hd.add("cone4", Vector3(cos(a) * 0.2, 0.58, sin(a) * 0.2) * s, Vector3(0.07, 0.2, 0.07) * s, GOLD, "metal")
	hd.add("ball", Vector3(0.22, 0.47, 0) * s, Vector3(0.06, 0.06, 0.06) * s, Color(1.0, 0.2, 0.3), "glow")
	var r := _find(parts, "arm_r")
	r.beam(Vector3(0.02, -0.46, 0) * s, Vector3(0.8, 0.35, 0) * s, Vector2(0.12, 0.035) * s, Color("#3a3446"), "metal")
	r.beam(Vector3(0.12, -0.33, 0) * s, Vector3(0.81, 0.37, 0) * s, Vector2(0.035, 0.045) * s, violet, "glow")
	r.add("box", Vector3(0.06, -0.42, 0) * s, Vector3(0.06, 0.06, 0.38) * s, GOLD, "metal", Vector3(0, 0, 45))
	r.add("ball", Vector3(-0.01, -0.58, 0) * s, Vector3(0.08, 0.08, 0.08) * s, violet, "glow")
	return parts
