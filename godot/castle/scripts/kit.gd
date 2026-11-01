class_name Kit
extends RefCounted
## The modelling kit: every 3D object of the game is built in code from primitives (boxes, cylinders, cones,
## spheres, capsules, prisms, tori) with a colour per piece, merged into one mesh per moving part. Pieces share a
## handful of materials (matte, metal, glow, foliage), so a whole army draws with a few materials and no
## textures to download. Units are metres; a model's forward is +x, up is +y.

static var _mats := {}
static var _prims := {}
static var _tex := {}


## ── Materials ──

static func mat(kind: String) -> Material:
	if _mats.has(kind):
		return _mats[kind]
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.roughness = 0.85
	m.specular_mode = BaseMaterial3D.SPECULAR_SCHLICK_GGX
	match kind:
		"metal":
			m.metallic = 0.65
			m.roughness = 0.32
			m.metallic_specular = 0.7
		"glow":
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		"emit":
			m.emission_enabled = true
			m.emission_energy_multiplier = 2.2
			m.emission_operator = BaseMaterial3D.EMISSION_OP_ADD
			m.emission = Color(1.0, 0.55, 0.2)
		"stone":
			m.albedo_texture = noise_texture("stone")
			m.uv1_triplanar = true
			m.uv1_scale = Vector3(0.35, 0.35, 0.35)
			m.roughness = 0.95
		"wood":
			m.albedo_texture = noise_texture("wood")
			m.uv1_triplanar = true
			m.uv1_scale = Vector3(0.6, 0.12, 0.6)
			m.roughness = 0.9
		"ground":
			m.albedo_texture = noise_texture("ground")
			m.uv1_triplanar = true
			m.uv1_world_triplanar = true
			m.uv1_scale = Vector3(0.08, 0.08, 0.08)
			m.roughness = 1.0
		"foliage":
			m.roughness = 1.0
			m.rim_enabled = true
			m.rim = 0.35
			m.rim_tint = 0.6
		"flash":
			m.vertex_color_use_as_albedo = false
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			m.albedo_color = Color(1, 0.95, 0.9)
		"ghost":
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			m.vertex_color_use_as_albedo = true
			m.albedo_color = Color(1, 1, 1, 0.45)
			m.no_depth_test = false
		"shadow":
			m.vertex_color_use_as_albedo = false
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			m.albedo_color = Color(0.05, 0.04, 0.03, 0.35)
	_mats[kind] = m
	return m


## Small grey noise textures that give stone, wood and earth some grain under the vertex colours.
static func noise_texture(kind: String) -> Texture2D:
	if _tex.has(kind):
		return _tex[kind]
	var n := FastNoiseLite.new()
	n.seed = hash(kind)
	var size := 128
	match kind:
		"stone":
			n.noise_type = FastNoiseLite.TYPE_CELLULAR
			n.frequency = 0.06
			n.cellular_return_type = FastNoiseLite.RETURN_DISTANCE2_DIV
		"wood":
			n.noise_type = FastNoiseLite.TYPE_SIMPLEX
			n.frequency = 0.03
			n.fractal_octaves = 3
		_:
			n.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
			n.frequency = 0.05
			n.fractal_octaves = 4
	var img := n.get_seamless_image(size, size)
	img.convert(Image.FORMAT_RGBA8)
	# lift towards white: the vertex colour carries the hue, the texture only a ±15 % grain
	for y in size:
		for x in size:
			var v := img.get_pixel(x, y).r
			var g := 0.85 + v * 0.3 if kind != "wood" else 0.8 + 0.4 * pow(v, 1.5)
			img.set_pixel(x, y, Color(g, g, g))
	img.generate_mipmaps()
	var t := ImageTexture.create_from_image(img)
	_tex[kind] = t
	return t


## ── Primitives (cached, built once) ──

static func prim(kind: String) -> Array:
	if _prims.has(kind):
		return _prims[kind]
	var m: PrimitiveMesh
	# every primitive is unit-sized (fits a 1×1×1 box) so `size` in add() is its real size in metres;
	# the capsule is the exception: radius 0.5, height 2 (a 1×2×1 pill)
	match kind:
		"box": m = BoxMesh.new()
		"cyl":
			m = CylinderMesh.new()
			m.height = 1.0
			m.radial_segments = 12
			m.rings = 1
			m.top_radius = 0.5
			m.bottom_radius = 0.5
		"cyl6":
			m = CylinderMesh.new()
			m.height = 1.0
			m.radial_segments = 6
			m.rings = 1
			m.top_radius = 0.5
			m.bottom_radius = 0.5
		"cone":
			m = CylinderMesh.new()
			m.height = 1.0
			m.radial_segments = 12
			m.rings = 1
			m.top_radius = 0.0
			m.bottom_radius = 0.5
		"cone4":
			m = CylinderMesh.new()
			m.height = 1.0
			m.radial_segments = 4
			m.rings = 1
			m.top_radius = 0.0
			m.bottom_radius = 0.5
		"cone6":
			m = CylinderMesh.new()
			m.height = 1.0
			m.radial_segments = 6
			m.rings = 1
			m.top_radius = 0.0
			m.bottom_radius = 0.5
		"ball":
			m = SphereMesh.new()
			m.radial_segments = 12
			m.rings = 6
			m.radius = 0.5
			m.height = 1.0
		"ball_lo":
			m = SphereMesh.new()
			m.radial_segments = 7
			m.rings = 4
			m.radius = 0.5
			m.height = 1.0
		"half":
			m = SphereMesh.new()
			m.radial_segments = 12
			m.rings = 4
			m.radius = 0.5
			m.height = 0.5
			m.is_hemisphere = true
		"capsule":
			m = CapsuleMesh.new()
			m.radial_segments = 10
			m.rings = 2
			m.radius = 0.5
			m.height = 2.0
		"prism":
			m = PrismMesh.new()
		"torus":
			m = TorusMesh.new()
			m.inner_radius = 0.38
			m.outer_radius = 0.5
			m.rings = 12
			m.ring_segments = 5
		"quad":
			m = QuadMesh.new()
	var arrays := m.get_mesh_arrays()
	_prims[kind] = arrays
	return arrays


## ── The builder ──

class Builder:
	var parts := {}                 # material kind -> [verts, normals, colors, uvs, indices]

	## Adds a primitive scaled by `size`, rotated by `rot` (degrees, applied x then y then z) and moved to `at`.
	func add(kind: String, at: Vector3, size: Vector3, color: Color, material := "matte", rot := Vector3.ZERO) -> Builder:
		var b := Basis.from_euler(Vector3(deg_to_rad(rot.x), deg_to_rad(rot.y), deg_to_rad(rot.z)), EULER_ORDER_XYZ)
		return add_xform(kind, Transform3D(b.scaled_local(size), at), color, material)

	func add_xform(kind: String, xf: Transform3D, color: Color, material := "matte") -> Builder:
		var a: Array = Kit.prim(kind)
		if not parts.has(material):
			parts[material] = [PackedVector3Array(), PackedVector3Array(), PackedColorArray(), PackedVector2Array(), PackedInt32Array()]
		var p: Array = parts[material]
		var base: int = p[0].size()
		var vs: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
		var ns: PackedVector3Array = a[Mesh.ARRAY_NORMAL]
		var uvs = a[Mesh.ARRAY_TEX_UV]
		var nb := xf.basis.inverse().transposed()
		for i in vs.size():
			p[0].append(xf * vs[i])
			p[1].append((nb * ns[i]).normalized())
			p[2].append(color)
			p[3].append(uvs[i] if uvs != null and i < uvs.size() else Vector2.ZERO)
		var idx = a[Mesh.ARRAY_INDEX]
		if idx == null or idx.is_empty():
			for i in vs.size():
				p[4].append(base + i)
		else:
			for i in idx:
				p[4].append(base + i)
		return self

	## A box between two points (a beam, a limb, a plank) of the given thickness.
	func beam(from: Vector3, to: Vector3, thick: Vector2, color: Color, material := "matte", kind := "box") -> Builder:
		var d := to - from
		var len := d.length()
		if len < 1e-5:
			return self
		var y := d / len
		var x := y.cross(Vector3.FORWARD if absf(y.dot(Vector3.FORWARD)) < 0.95 else Vector3.RIGHT).normalized()
		var z := x.cross(y).normalized()
		var b := Basis(x * thick.x, y * len, z * thick.y)
		return add_xform(kind, Transform3D(b, (from + to) * 0.5), color, material)

	func is_empty() -> bool:
		return parts.is_empty()

	func mesh() -> ArrayMesh:
		var m := ArrayMesh.new()
		for kind in parts:
			var p: Array = parts[kind]
			var arr := []
			arr.resize(Mesh.ARRAY_MAX)
			arr[Mesh.ARRAY_VERTEX] = p[0]
			arr[Mesh.ARRAY_NORMAL] = p[1]
			arr[Mesh.ARRAY_COLOR] = p[2]
			arr[Mesh.ARRAY_TEX_UV] = p[3]
			arr[Mesh.ARRAY_INDEX] = p[4]
			m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
			m.surface_set_material(m.get_surface_count() - 1, Kit.mat(kind))
		return m

	func instance(name := "") -> MeshInstance3D:
		var mi := MeshInstance3D.new()
		mi.mesh = mesh()
		if name != "":
			mi.name = name
		return mi


static func builder() -> Builder:
	return Builder.new()


## A colour a bit lighter (k > 0) or darker (k < 0).
static func shade(c: Color, k: float) -> Color:
	return c.lightened(k) if k > 0.0 else c.darkened(-k)


## ── The Avramania models (assets/avramania, CC0) ──
## Low-poly, flat-shaded models in metres that all share one 256×256 palette texture. pack(name) bakes a model
## (every mesh of its scene, with its transform) into one ArrayMesh with the shared palette material, cached,
## so it can go into MultiMeshes; name is the file name without "mdvl_" and ".glb" (e.g. "nature_oak_01").

static var _pack := {}
static var _palette: Material


static func pack(name: String) -> ArrayMesh:
	if _pack.has(name):
		return _pack[name]
	if name.begins_with("winter/"):
		_pack[name] = _own_materials("res://assets/winter/%s.glb" % name.substr(7))
		return _pack[name]
	var scene: PackedScene = load("res://assets/avramania/mdvl_%s.glb" % name)
	assert(scene != null, "no model %s" % name)
	var root: Node3D = scene.instantiate()
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for mi in root.find_children("*", "MeshInstance3D", true, false):
		var xf: Transform3D = _local_xform(mi, root)
		for s in mi.mesh.get_surface_count():
			if _palette == null:
				_palette = _make_palette(mi.mesh.surface_get_material(s) if mi.get_surface_override_material(s) == null else mi.get_surface_override_material(s))
			st.append_from(mi.mesh, s, xf)
	root.free()
	var m := st.commit()
	m.surface_set_material(0, palette_material())
	_pack[name] = m
	return m


## The Low Poly Winter Pack (assets/winter, by reodesuxz; see its LICENSE.txt): flat colour materials per
## surface, no palette. The model is baked with each surface keeping its own material ("winter/pine_snow").
static func _own_materials(path: String) -> ArrayMesh:
	var scene: PackedScene = load(path)
	assert(scene != null, "no model %s" % path)
	var root: Node3D = scene.instantiate()
	var out := ArrayMesh.new()
	for mi in root.find_children("*", "MeshInstance3D", true, false):
		var xf: Transform3D = _local_xform(mi, root)
		for s in mi.mesh.get_surface_count():
			var st := SurfaceTool.new()
			st.begin(Mesh.PRIMITIVE_TRIANGLES)
			st.append_from(mi.mesh, s, xf)
			st.commit(out)
			var src: Material = mi.get_surface_override_material(s) if mi.get_surface_override_material(s) else mi.mesh.surface_get_material(s)
			if src is BaseMaterial3D:
				src = (src as BaseMaterial3D).duplicate()
				(src as BaseMaterial3D).roughness = 0.9
				(src as BaseMaterial3D).metallic = 0.0
			out.surface_set_material(out.get_surface_count() - 1, src)
	root.free()
	return out


static func is_palette(name: String) -> bool:
	return not name.begins_with("winter/")


static func _local_xform(n: Node3D, root: Node3D) -> Transform3D:
	var xf := n.transform
	var p := n.get_parent()
	while p != null and p != root:
		if p is Node3D:
			xf = (p as Node3D).transform * xf
		p = p.get_parent()
	return xf


static func _make_palette(src: Material) -> Material:
	var m := StandardMaterial3D.new()
	if src is BaseMaterial3D:
		m.albedo_texture = (src as BaseMaterial3D).albedo_texture
	# linear without mipmaps: nearest catches the neighbouring swatch at texel edges, mipmaps blend swatches
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	m.roughness = 0.85
	m.vertex_color_use_as_albedo = false
	return m


static func palette_material() -> Material:
	if _palette == null:
		pack("weapons_arrow_01")
	return _palette


## A pack model as its own node.
static func pack_node(name: String, at := Vector3.ZERO, scale := 1.0, yaw_deg := 0.0) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = pack(name)
	mi.position = at
	mi.scale = Vector3.ONE * scale
	mi.rotation_degrees.y = yaw_deg
	return mi
