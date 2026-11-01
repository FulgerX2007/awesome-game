class_name Terrain
extends RefCounted
## One piece of island as a single mesh: a grassy top with a softly rounded rim and a lighter worn path along
## the walking line, and rocky sides in uneven layers that reach down into the sea. Replaces the hex tiles
## for Ground's "terrain" style. Only the look: the collision stays Ground's box, so gameplay is unchanged.
## Colors are vertex colors (one material for every piece), with darker crevices and a darker foot standing
## in for ambient occlusion, which the Compatibility renderer does not have.

const GRASS_A := Color("#78b84a")
const GRASS_B := Color("#8fc957")
const PATH := Color("#b8c06c")
const DIRT := Color("#8a6646")
const ROCK_A := Color("#a89e92")
const ROCK_B := Color("#958b80")
const ROCK_DARK := Color("#6f675f")

const STEP := 0.5          # grid spacing of the top surface
const RIM := 0.45          # width of the rounded edge
const DROP := 0.32         # how far the rounded edge falls before the rock begins
const LAYER := 0.9         # height of one rock layer on the sides

static var _material: StandardMaterial3D


static func material() -> StandardMaterial3D:
	if _material == null:
		_material = StandardMaterial3D.new()
		_material.vertex_color_use_as_albedo = true
		_material.vertex_color_is_srgb = true
		_material.roughness = 0.92
	return _material


## x0..x1 along the path, z_back..z_front across it, top at y = 0, sides down to -depth.
## seed keeps every piece different but stable between runs.
## taper narrows the rock toward the bottom (a floating ledge is a wedge of rock under a grass top).
static func build(x0: float, x1: float, z_back: float, z_front: float, depth: float, seed: int, taper := 0.0) -> ArrayMesh:
	var noise := FastNoiseLite.new()
	noise.seed = seed
	noise.frequency = 0.35
	var big := FastNoiseLite.new()
	big.seed = seed + 7
	big.frequency = 0.08
	var mesh := ArrayMesh.new()
	_top(mesh, x0, x1, z_back, z_front, noise, big)
	_sides(mesh, x0, x1, z_back, z_front, depth, noise, taper)
	mesh.surface_set_material(0, material())
	mesh.surface_set_material(1, material())
	return mesh


## The outline of the top: the front and back edges wave a little; the left and right edges stay straight,
## because that is where the mage jumps and the edge must show the truth.
static func _front(x: float, z_front: float, noise: FastNoiseLite) -> float:
	return z_front + noise.get_noise_2d(x * 0.7, 40.0) * 0.28


static func _back(x: float, z_back: float, noise: FastNoiseLite) -> float:
	return z_back + noise.get_noise_2d(x * 0.7, -40.0) * 0.35


## Height of the top at a point: flat on the walking line, gentle bumps away from it, and the rounded rim.
static func _height(x: float, z: float, x0: float, x1: float, zb: float, zf: float, noise: FastNoiseLite) -> float:
	var away := clampf((absf(z) - 0.9) / 1.2, 0.0, 1.0)
	var y := noise.get_noise_2d(x * 1.3, z * 1.3) * 0.09 * away
	var d := minf(minf(x - x0, x1 - x), minf(z - zb, zf - z))
	if d < RIM:
		var t := 1.0 - d / RIM
		y -= DROP * t * t
	return y


static func _top(mesh: ArrayMesh, x0: float, x1: float, z_back: float, z_front: float, noise: FastNoiseLite, big: FastNoiseLite) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var nx := maxi(2, ceili((x1 - x0) / STEP))
	var nz := maxi(4, ceili((z_front - z_back) / STEP))
	var grid := []
	for i in nx + 1:
		var x := lerpf(x0, x1, float(i) / nx)
		var zb := _back(x, z_back, noise)
		var zf := _front(x, z_front, noise)
		var col := []
		for k in nz + 1:
			var t := float(k) / nz
			t = t * t * (3.0 - 2.0 * t) * 0.35 + t * 0.65  # a few more rows near the rims
			var z := lerpf(zb, zf, t)
			var p := Vector3(x, _height(x, z, x0, x1, zb, zf, noise), z)
			col.append(p)
		grid.append(col)
	for i in nx:
		for k in nz:
			var a: Vector3 = grid[i][k]
			var b: Vector3 = grid[i + 1][k]
			var c: Vector3 = grid[i + 1][k + 1]
			var d: Vector3 = grid[i][k + 1]
			for p in [a, b, c, a, c, d]:
				st.set_color(_grass_color(p, big))
				st.add_vertex(p)
	st.generate_normals()
	st.commit(mesh)


static func _grass_color(p: Vector3, big: FastNoiseLite) -> Color:
	var c := GRASS_A.lerp(GRASS_B, clampf(big.get_noise_2d(p.x, p.z) * 0.9 + 0.5, 0.0, 1.0))
	var path := clampf(1.0 - absf(p.z) / 0.75, 0.0, 1.0)  # the worn line the mage walks on
	c = c.lerp(PATH, path * 0.35)
	if p.y < -0.06:  # the rounded rim: grass turns to earth as it bends over the edge
		c = c.lerp(DIRT, clampf((-p.y - 0.06) / (DROP - 0.06), 0.0, 1.0) * 0.8)
	return c


## The sides follow the outline of the top all around, in layers that step in and out a little like stacked
## rock, each layer a different shade, with the cracks between them darker.
static func _sides(mesh: ArrayMesh, x0: float, x1: float, z_back: float, z_front: float, depth: float, noise: FastNoiseLite, taper: float) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var ring: Array[Vector3] = []   # the rim outline, counter-clockwise seen from above
	var nx := maxi(2, ceili((x1 - x0) / 0.6))
	for i in nx + 1:
		var x := lerpf(x0, x1, float(i) / nx)
		ring.append(Vector3(x, 0, _front(x, z_front, noise)))
	var zr0 := _front(x1, z_front, noise)
	var zr1 := _back(x1, z_back, noise)
	for k in range(1, 4):
		ring.append(Vector3(x1, 0, lerpf(zr0, zr1, k / 4.0)))
	for i in range(nx, -1, -1):
		var x := lerpf(x0, x1, float(i) / nx)
		ring.append(Vector3(x, 0, _back(x, z_back, noise)))
	var zl0 := _back(x0, z_back, noise)
	var zl1 := _front(x0, z_front, noise)
	for k in range(1, 4):
		ring.append(Vector3(x0, 0, lerpf(zl0, zl1, k / 4.0)))
	var center := Vector3((x0 + x1) / 2.0, 0, (z_back + z_front) / 2.0)
	var layers := maxi(1, ceili((depth - DROP) / LAYER))
	if taper > 0.0:
		layers = maxi(layers, 3)   # a wedge needs a few steps to look round
	var inset := minf(x1 - x0, z_front - z_back) * 0.45 * taper
	var levels: Array[float] = [-DROP]
	for l in layers:
		levels.append(-DROP - (depth - DROP) * float(l + 1) / layers)
	var n := ring.size()
	for l in layers:
		var y_top: float = levels[l]
		var y_bot: float = levels[l + 1]
		var out_top := 0.0 if l == 0 else noise.get_noise_1d(l * 13.0) * 0.12
		var out_bot := 0.08 + noise.get_noise_1d(l * 13.0 + 6.0) * 0.14
		out_top -= inset * pow(float(l) / layers, 1.4)
		out_bot -= inset * pow(float(l + 1) / layers, 1.4)
		var shade := ROCK_A.lerp(ROCK_B, 0.5 + noise.get_noise_1d(l * 31.0) * 0.8)
		shade = shade.lerp(ROCK_DARK, clampf(float(l) / maxf(layers, 1) * 0.6, 0.0, 0.6))  # darker toward the sea
		for i in n:
			var a := ring[i]
			var b := ring[(i + 1) % n]
			var ja := noise.get_noise_2d(a.x * 2.1, l * 5.0) * 0.1
			var jb := noise.get_noise_2d(b.x * 2.1, l * 5.0) * 0.1
			var a_top := _push(a, center, out_top + ja * float(l > 0)) + Vector3(0, y_top, 0)
			var b_top := _push(b, center, out_top + jb * float(l > 0)) + Vector3(0, y_top, 0)
			var a_bot := _push(a, center, out_bot + ja) + Vector3(0, y_bot, 0)
			var b_bot := _push(b, center, out_bot + jb) + Vector3(0, y_bot, 0)
			var top_col := DIRT if l == 0 else shade.darkened(0.18)   # the crack under the layer above
			var bot_col := shade
			# clockwise seen from outside (Godot's front face)
			st.set_color(top_col); st.add_vertex(a_top)
			st.set_color(bot_col); st.add_vertex(b_bot)
			st.set_color(bot_col); st.add_vertex(a_bot)
			st.set_color(top_col); st.add_vertex(a_top)
			st.set_color(top_col); st.add_vertex(b_top)
			st.set_color(bot_col); st.add_vertex(b_bot)
	st.generate_normals()
	st.commit(mesh)


## Moves a rim point outward (away from the piece's middle) in the horizontal plane.
static func _push(p: Vector3, center: Vector3, amount: float) -> Vector3:
	var d := Vector3(p.x - center.x, 0, p.z - center.z)
	if absf(p.x - center.x) > absf(p.z - center.z) * 0.5:  # left and right ends move only sideways
		d = Vector3(signf(d.x), 0, 0)
	else:
		d = Vector3(0, 0, signf(d.z))
	return p + d * amount
