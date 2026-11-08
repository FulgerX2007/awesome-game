class_name Kit
extends RefCounted
## Low-poly building blocks for the scrapyard: cached materials and primitive meshes placed in one call.
## Everything in the world is built from these, so the whole game has one look and one scale
## (1 unit ≈ 1 metre; a worker robot is 1.1 units tall).

const RUST := Color("a9572f")
const RUST_LIGHT := Color("c46a3a")
const METAL := Color("7b6d86")
const METAL_LIGHT := Color("968aa0")
const METAL_DARK := Color("3b3247")
const CHARCOAL := Color("2a2034")
const PURPLE := Color("6e5a6e")
const GROUND := Color("231a2a")
const LAMP := Color("f3c24f")
const VERDIGRIS := Color("5fc7a9")
const CORE := Color("8fd3ff")
const EMBER := Color("ff8f4b")
const SCRAP_COLORS: Array[Color] = [Color("8a4a33"), Color("a9572f"), Color("6e5a6e"), Color("5a4a5e"),
	Color("7a6a58"), Color("b5683a"), Color("4f5c63")]
const ROLE_COLORS := {digger = Color("e2733d"), sorter = Color("5fc7a9"), mechanic = Color("f3c24f"), idle = Color("a698b1")}

static var _mats := {}
static var _meshes := {}


static func mat(color: Color, rough := 0.85, metal := 0.15, emission := Color.BLACK, energy := 0.0) -> StandardMaterial3D:
	var key := "%s|%s|%s|%s|%s" % [color.to_html(), rough, metal, emission.to_html(), energy]
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = rough
	m.metallic = metal
	if energy > 0.0:
		m.emission_enabled = true
		m.emission = emission
		m.emission_energy_multiplier = energy
	_mats[key] = m
	return m


## A material of its own (not cached), for things that animate their colour or glow.
static func own_mat(color: Color, emission := Color.BLACK, energy := 0.0, rough := 0.7) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = rough
	m.metallic = 0.2
	m.emission_enabled = true
	m.emission = emission
	m.emission_energy_multiplier = energy
	return m


static func glow(color: Color, energy := 2.5) -> StandardMaterial3D:
	return mat(color, 0.4, 0.0, color, energy)


## See-through blueprint material for unbuilt parts of the ark.
static func ghost() -> StandardMaterial3D:
	if _mats.has("ghost"):
		return _mats.ghost
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(0.5, 0.78, 1.0, 0.06)
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.no_depth_test = false
	_mats.ghost = m
	return m


static func box_mesh(size: Vector3) -> BoxMesh:
	var key := "box%s" % size
	if not _meshes.has(key):
		var b := BoxMesh.new()
		b.size = size
		_meshes[key] = b
	return _meshes[key]


static func cyl_mesh(top: float, bottom: float, h: float, sides := 8) -> CylinderMesh:
	var key := "cyl%s|%s|%s|%s" % [top, bottom, h, sides]
	if not _meshes.has(key):
		var c := CylinderMesh.new()
		c.top_radius = top
		c.bottom_radius = bottom
		c.height = h
		c.radial_segments = sides
		c.rings = 1
		_meshes[key] = c
	return _meshes[key]


static func sphere_mesh(r: float, segments := 10, rings := 6) -> SphereMesh:
	var key := "sph%s|%s|%s" % [r, segments, rings]
	if not _meshes.has(key):
		var s := SphereMesh.new()
		s.radius = r
		s.height = r * 2.0
		s.radial_segments = segments
		s.rings = rings
		_meshes[key] = s
	return _meshes[key]


static func torus_mesh(inner: float, outer: float) -> TorusMesh:
	var key := "tor%s|%s" % [inner, outer]
	if not _meshes.has(key):
		var t := TorusMesh.new()
		t.inner_radius = inner
		t.outer_radius = outer
		t.rings = 24
		t.ring_segments = 6
		_meshes[key] = t
	return _meshes[key]


static func place(parent: Node3D, mesh: Mesh, material: Material, pos: Vector3, rot_deg := Vector3.ZERO, shadows := true) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.mesh = mesh
	m.material_override = material
	m.position = pos
	m.rotation_degrees = rot_deg
	if not shadows:
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(m)
	return m


static func box(parent: Node3D, size: Vector3, color: Variant, pos: Vector3, rot_deg := Vector3.ZERO) -> MeshInstance3D:
	return place(parent, box_mesh(size), color if color is Material else mat(color), pos, rot_deg)


static func cyl(parent: Node3D, top: float, bottom: float, h: float, color: Variant, pos: Vector3, rot_deg := Vector3.ZERO, sides := 8) -> MeshInstance3D:
	return place(parent, cyl_mesh(top, bottom, h, sides), color if color is Material else mat(color), pos, rot_deg)


static func ball(parent: Node3D, r: float, color: Variant, pos: Vector3, segments := 10) -> MeshInstance3D:
	return place(parent, sphere_mesh(r, segments, maxi(4, segments / 2)), color if color is Material else mat(color), pos)


## A beam between two points (cables, struts, crane jibs).
static func beam(parent: Node3D, a: Vector3, b: Vector3, thick: float, color: Variant) -> MeshInstance3D:
	var m := box(parent, Vector3(thick, thick, a.distance_to(b)), color, (a + b) / 2.0)
	if a.distance_to(b) > 0.001:
		# in the parent's own space (look_at would use global coordinates)
		var dir := (b - a).normalized()
		var up := Vector3.UP if absf(dir.dot(Vector3.UP)) < 0.99 else Vector3.RIGHT
		m.transform = Transform3D(Basis.looking_at(dir, up), (a + b) / 2.0)
	return m


static func light(parent: Node3D, color: Color, pos: Vector3, energy := 1.5, range_ := 6.0) -> OmniLight3D:
	var l := OmniLight3D.new()
	l.light_color = color
	l.light_energy = energy
	l.omni_range = range_
	l.omni_attenuation = 1.4
	l.position = pos
	l.shadow_enabled = false
	parent.add_child(l)
	return l


## A 3D label that always faces the camera (counters, floating numbers, names).
static func label(parent: Node3D, text: String, pos: Vector3, color := Color.WHITE, size := 48) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.position = pos
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	l.modulate = color
	l.font_size = size
	l.outline_size = 10
	l.outline_modulate = Color(0.08, 0.05, 0.1, 0.85)
	l.pixel_size = 0.01
	l.no_depth_test = true
	l.fixed_size = false
	l.render_priority = 10
	l.outline_render_priority = 9
	if ResourceLoader.exists("res://assets/fonts/GolosText.ttf"):
		l.font = load("res://assets/fonts/GolosText.ttf")
	parent.add_child(l)
	return l
