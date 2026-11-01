class_name Shapes
extends RefCounted
## Small modeled meshes built in code where no pack has the shape: faceted crystals and bevelled stone
## blocks. Flat-shaded and low-poly like the KayKit models around them. Meshes are cached by their parameters.

static var _cache := {}


## One crystal: a six-sided prism with a pointed tip, standing on y = 0, tilted a little. Flat shaded so the
## facets catch the light differently.
static func crystal(radius := 0.12, height := 0.5, tilt := Vector3.ZERO) -> ArrayMesh:
	var key := "crystal/%s/%s/%s" % [radius, height, tilt]
	if _cache.has(key):
		return _cache[key]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_smooth_group(0xFFFFFFFF)  # flat: every facet keeps its own normal
	_crystal_into(st, Transform3D(Basis.from_euler(tilt), Vector3.ZERO), radius, height)
	st.generate_normals()
	var m := st.commit()
	_cache[key] = m
	return m


## A cluster of three to five crystals of different heights, like a geode growing out of rock.
static func crystal_cluster(size := 1.0, seed := 0) -> ArrayMesh:
	var key := "cluster/%s/%s" % [size, seed]
	if _cache.has(key):
		return _cache[key]
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_smooth_group(0xFFFFFFFF)  # flat: every facet keeps its own normal
	var n := rng.randi_range(3, 5)
	for i in n:
		var a := TAU * i / n + rng.randf_range(-0.3, 0.3)
		var off := Vector3(cos(a), 0, sin(a)) * (0.0 if i == 0 else 0.13 * size)
		var tilt := Vector3(sin(a) * 0.45, 0, -cos(a) * 0.45) if i > 0 else Vector3(0.05, 0, 0.05)
		var h := (0.62 if i == 0 else rng.randf_range(0.3, 0.48)) * size
		var r := (0.11 if i == 0 else rng.randf_range(0.06, 0.09)) * size
		_crystal_into(st, Transform3D(Basis.from_euler(tilt), off), r, h)
	st.generate_normals()
	var m := st.commit()
	_cache[key] = m
	return m


static func _crystal_into(st: SurfaceTool, xf: Transform3D, r: float, h: float) -> void:
	var sides := 6
	var body := h * 0.72
	var ring_lo: Array[Vector3] = []
	var ring_hi: Array[Vector3] = []
	for i in sides:
		var a := TAU * i / sides
		ring_lo.append(Vector3(cos(a) * r * 0.85, -0.05 * h, sin(a) * r * 0.85))
		ring_hi.append(Vector3(cos(a) * r, body, sin(a) * r))
	var tip := Vector3(0, h, 0)
	for i in sides:
		var j := (i + 1) % sides
		var out := (ring_hi[i] + ring_hi[j]) / 2.0
		out.y = 0.0
		_quad(st, xf * ring_lo[i], xf * ring_lo[j], xf * ring_hi[j], xf * ring_hi[i], xf.basis * out)
		_tri(st, xf * ring_hi[i], xf * ring_hi[j], xf * tip, xf.basis * (out + Vector3(0, r, 0)))


## A cut gem: an eight-sided crown with a flat table on top and a pointed pavilion below, centered on y = 0.
static func gem(r := 0.3) -> ArrayMesh:
	var key := "gem/%s" % r
	if _cache.has(key):
		return _cache[key]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_smooth_group(0xFFFFFFFF)
	var n := 8
	var girdle: Array[Vector3] = []
	var table: Array[Vector3] = []
	for i in n:
		var a := TAU * i / n
		girdle.append(Vector3(cos(a) * r, 0, sin(a) * r))
		table.append(Vector3(cos(a + PI / n) * r * 0.55, r * 0.42, sin(a + PI / n) * r * 0.55))
	var top := Vector3(0, r * 0.42, 0)
	var point := Vector3(0, -r * 1.05, 0)
	for i in n:
		var j := (i + 1) % n
		var side := (girdle[i] + girdle[j]) / 2.0
		_tri(st, girdle[i], girdle[j], table[i], side + Vector3(0, r, 0))      # crown facets
		_tri(st, table[i], girdle[j], table[j], side + Vector3(0, r, 0))
		_tri(st, table[i], table[j], top, Vector3.UP)                          # the table
		_tri(st, girdle[i], girdle[j], point, side - Vector3(0, r, 0))          # pavilion
	st.generate_normals()
	var m := st.commit()
	_cache[key] = m
	return m


## A box with chamfered edges, centered on the origin. Cached by size and bevel.
static func bevel_box(size: Vector3, bevel := 0.08) -> ArrayMesh:
	var key := "bevel/%s/%s" % [size, bevel]
	if _cache.has(key):
		return _cache[key]
	var h := size / 2.0
	var b := minf(bevel, minf(h.x, minf(h.y, h.z)) * 0.9)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_smooth_group(0xFFFFFFFF)  # flat: every facet keeps its own normal
	# every point of the chamfered box: the 8 corners each split into 3 points (one per face it touches)
	var corners := []
	for sx in [-1, 1]:
		for sy in [-1, 1]:
			for sz in [-1, 1]:
				var c := Vector3(sx * h.x, sy * h.y, sz * h.z)
				corners.append({
					x = c - Vector3(0, sy * b, sz * b),   # on the x face
					y = c - Vector3(sx * b, 0, sz * b),   # on the y face
					z = c - Vector3(sx * b, sy * b, 0),   # on the z face
					s = Vector3(sx, sy, sz)})
	var at := func(sx: int, sy: int, sz: int) -> Dictionary:
		for c in corners:
			if c.s == Vector3(sx, sy, sz):
				return c
		return {}
	# the six faces
	for axis in ["x", "y", "z"]:
		for s in [-1, 1]:
			var quad := []
			for u in [-1, 1]:
				for v in [-1, 1]:
					var p: Vector3
					match axis:
						"x": p = at.call(s, u, v).x
						"y": p = at.call(u, s, v).y
						_: p = at.call(u, v, s).z
					quad.append(p)
			_quad(st, quad[0], quad[1], quad[3], quad[2], Vector3(s if axis == "x" else 0, s if axis == "y" else 0, s if axis == "z" else 0))
	# the twelve bevel strips between neighbouring faces
	for sx in [-1, 1]:
		for sy in [-1, 1]:  # edges along z
			_quad(st, at.call(sx, sy, -1).x, at.call(sx, sy, 1).x, at.call(sx, sy, 1).y, at.call(sx, sy, -1).y, Vector3(sx, sy, 0))
		for sz in [-1, 1]:  # edges along y
			_quad(st, at.call(sx, -1, sz).x, at.call(sx, 1, sz).x, at.call(sx, 1, sz).z, at.call(sx, -1, sz).z, Vector3(sx, 0, sz))
	for sy in [-1, 1]:
		for sz in [-1, 1]:  # edges along x
			_quad(st, at.call(-1, sy, sz).y, at.call(1, sy, sz).y, at.call(1, sy, sz).z, at.call(-1, sy, sz).z, Vector3(0, sy, sz))
	# the eight corner triangles
	for c in corners:
		_tri(st, c.x, c.y, c.z, c.s)
	st.generate_normals()
	var m := st.commit()
	_cache[key] = m
	return m


## Adds a quad, flipping it if needed so it faces `out` (Godot's front faces are clockwise).
static func _quad(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, d: Vector3, out: Vector3) -> void:
	_tri(st, a, b, c, out)
	_tri(st, a, c, d, out)


static func _tri(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, out: Vector3) -> void:
	var n := (b - a).cross(c - a)
	if n.dot(out) > 0.0:  # counter-clockwise as seen from outside: swap to make it clockwise
		var t := b
		b = c
		c = t
	st.add_vertex(a)
	st.add_vertex(b)
	st.add_vertex(c)
