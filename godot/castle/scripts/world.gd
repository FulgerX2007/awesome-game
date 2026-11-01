class_name CastleWorld
extends Node3D
## The 2.5D stage: a real 3D world seen from the side by a fixed perspective camera.
##   Coordinates: the simulation's (x, y) in metres is the world's (x, y) on the lane z = 0; the castle wall is
##   x ∈ [0, 3], enemies come from x = 60. Scenery lives at other depths: the foreground (z > 4) passes under
##   the camera, hills (z −20…−90), mountains (z −160…−300) and clouds far behind, so the perspective gives the
##   layers their parallax and the depth buffer their draw order. Nothing in the world takes input; the UI is a
##   CanvasLayer on top.
##   One builder for every region: data/environments.json gives the palette, the trees, the weather and the props.

const WIND := preload("res://shaders/wind.gdshader")
const FIELD_X0 := -8.0              # what the camera always shows, left to right, at z = 0
const FIELD_X1 := 63.0
const FOV := 38.0                   # horizontal, degrees (the camera keeps the width)
const TILT := 4.5                   # degrees down: the horizon stays on screen, a fifth from the top

var env := {}
var env_id := ""
var time_id := ""
var camera: Camera3D
var sun: DirectionalLight3D
var world_env: WorldEnvironment
var _shake := 0.0
var _shake_t := 0.0
var _cam_base := Transform3D()
var _birds: Array = []
var _clouds: Array = []
var _flicker: Array = []            # lights that flicker: [OmniLight3D, base energy]
var _storm := false
var _flash := 0.0
var _rng := RandomNumberGenerator.new()
var _t := 0.0
var windmill: Node3D


static func palette(env_name: String, time: String) -> Dictionary:
	var all = JSON.parse_string(FileAccess.get_file_as_string("res://data/environments.json"))
	var e: Dictionary = all[env_name].duplicate(true)
	var tm: Dictionary = all.times.get(time, {})
	var col := func(k): return Color(e[k])
	e.sky_top = Color(e.sky_top) * float(tm.get("sky_top_mul", 1.0))
	e.sky_top.a = 1.0
	e.sky_horizon = Color(e.sky_horizon)
	if tm.has("sky_horizon_mix"):
		e.sky_horizon = e.sky_horizon.lerp(Color(tm.sky_horizon_mix[0]), tm.sky_horizon_mix[1])
	e.sun = Color(e.sun)
	if tm.has("sun_mix"):
		e.sun = e.sun.lerp(Color(tm.sun_mix[0]), tm.sun_mix[1])
	e.sun_energy = float(e.sun_energy) * float(tm.get("sun_energy_mul", 1.0))
	var add: Array = tm.get("sun_angle_add", [0, 0])
	e.sun_angle = [float(e.sun_angle[0]) + float(add[0]), float(e.sun_angle[1]) + float(add[1])]
	e.fog = Color(e.fog)
	if tm.has("fog_mix"):
		e.fog = e.fog.lerp(Color(tm.fog_mix[0]), tm.fog_mix[1])
	e.fog_density = float(e.fog_density) * float(tm.get("fog_density_mul", 1.0))
	e.ambient_energy = float(e.ambient_energy) * float(tm.get("ambient_mul", 1.0))
	e.torches = tm.get("torches", false)
	e.stars = tm.get("stars", false)
	e.storm = tm.get("storm", false)
	for k in ["ambient", "ground_horizon", "grass", "grass_dark", "grass_light", "road", "road_dark", "mountain", "mountain_far", "snowcap", "trunk", "rocks", "clouds"]:
		e[k] = col.call(k)
	e.hills = e.hills.map(func(c): return Color(c))
	e.tree_colors = e.tree_colors.map(func(c): return Color(c))
	e.flowers = e.flowers.map(func(c): return Color(c))
	return e


func build(env_name: String, time := "day") -> void:
	for c in get_children():
		c.queue_free()
	_birds.clear()
	_clouds.clear()
	_flicker.clear()
	windmill = null
	env_id = env_name
	time_id = time
	env = palette(env_name, time)
	_rng.seed = hash(env_name + time)
	_storm = env.storm
	_build_environment()
	_build_camera()
	_build_ground()
	_build_road()
	_build_foreground()
	_build_hills()
	_build_mountains()
	_build_sky_things()
	_build_props()
	_build_weather()


## ── Light, sky, fog ──

func _build_environment() -> void:
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = env.sky_top
	sky_mat.sky_horizon_color = env.sky_horizon
	sky_mat.ground_horizon_color = env.ground_horizon
	sky_mat.ground_bottom_color = env.ground_horizon.darkened(0.4)
	sky_mat.sky_curve = 0.12
	sky_mat.sun_angle_max = 18.0
	sky_mat.sun_curve = 0.08
	var sky := Sky.new()
	sky.sky_material = sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_32
	var e := Environment.new()
	e.background_mode = Environment.BG_SKY
	e.sky = sky
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = env.ambient
	e.ambient_light_energy = env.ambient_energy
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	e.tonemap_white = 6.0
	e.tonemap_exposure = 0.92
	e.fog_enabled = true
	# depth fog that starts behind the lane: the fight stays crisp, the hills and mountains fade into haze
	e.fog_mode = Environment.FOG_MODE_DEPTH
	e.fog_light_color = env.fog
	e.fog_density = clampf(env.fog_density * 140.0, 0.4, 1.0)
	e.fog_depth_begin = 150.0
	e.fog_depth_end = 520.0
	e.fog_depth_curve = 1.4
	e.fog_sky_affect = 0.0
	e.glow_enabled = true
	e.glow_intensity = 0.55
	e.glow_strength = 0.9
	e.glow_bloom = 0.04
	e.glow_hdr_threshold = 1.1
	e.adjustment_enabled = true
	e.adjustment_saturation = 1.18
	e.adjustment_contrast = 1.08
	world_env = WorldEnvironment.new()
	world_env.environment = e
	add_child(world_env)
	sun = DirectionalLight3D.new()
	sun.light_color = env.sun
	sun.light_energy = env.sun_energy
	sun.rotation_degrees = Vector3(env.sun_angle[0], env.sun_angle[1], 0)
	sun.shadow_enabled = true
	sun.shadow_opacity = 0.78
	sun.shadow_blur = 1.6
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	sun.directional_shadow_max_distance = 190.0
	sun.shadow_bias = 0.04
	sun.shadow_normal_bias = 1.2
	add_child(sun)
	# a cool fill from the camera side so faces in shadow keep their colours
	var fill := DirectionalLight3D.new()
	fill.light_color = env.ambient.lerp(Color.WHITE, 0.3)
	fill.light_energy = 0.28
	fill.rotation_degrees = Vector3(-15, 160, 0)
	add_child(fill)


func _build_camera() -> void:
	camera = Camera3D.new()
	camera.keep_aspect = Camera3D.KEEP_WIDTH
	camera.fov = FOV
	camera.near = 1.0
	camera.far = 900.0
	add_child(camera)
	fit_camera(Vector2(1280, 720))
	camera.current = true


## Places the camera so the field FIELD_X0..FIELD_X1 fills the width at z = 0 and the ground sits low on
## screen with sky above; a taller (portrait) screen shows more sky and foreground, never less field.
func fit_camera(size: Vector2) -> void:
	var w := FIELD_X1 - FIELD_X0
	var d := (w * 0.5) / tan(deg_to_rad(FOV * 0.5))
	var aspect := size.y / maxf(1.0, size.x)
	var vis_h := w * aspect                       # visible height at z = 0
	# the ground line a fifth of the way up from the bottom (more on tall screens, where the band is deep)
	var ground_from_bottom := lerpf(0.2, 0.3, clampf((aspect - 0.56) / 0.6, 0.0, 1.0))
	var cy := vis_h * (0.5 - ground_from_bottom)
	var tilt := deg_to_rad(TILT)
	var target := Vector3((FIELD_X0 + FIELD_X1) * 0.5, cy, 0.0)
	var pos := target + Vector3(0, sin(tilt) * d, cos(tilt) * d)
	_cam_base = Transform3D(Basis(Vector3.RIGHT, -tilt), pos)
	camera.transform = _cam_base


## Overrides the camera (close-ups, the victory sequence); fit_camera() puts it back.
func set_view(xf: Transform3D) -> void:
	_cam_base = xf
	camera.transform = xf


func shake(amount: float) -> void:
	_shake = maxf(_shake, amount)


## Where a world point lands on the screen (canvas coordinates), for labels and bars over the 3D world.
func to_screen(p: Vector3) -> Vector2:
	return camera.unproject_position(p)


## The world point on the lane (z = 0) under a screen position.
func to_lane(screen: Vector2) -> Vector3:
	var o := camera.project_ray_origin(screen)
	var d := camera.project_ray_normal(screen)
	if absf(d.z) < 1e-5:
		return Vector3.ZERO
	return o + d * (-o.z / d.z)


func _process(delta: float) -> void:
	_t += delta
	if camera:
		_shake_t += delta
		_shake = maxf(0.0, _shake - delta * 2.5)
		var off := Vector3(sin(_shake_t * 47.0), cos(_shake_t * 39.0), 0.0) * _shake * 0.35
		camera.transform = _cam_base.translated(off)
	for b in _birds:
		var n: Node3D = b.node
		n.position.x += b.speed * delta
		if n.position.x > 110.0:
			n.position.x = -60.0
		n.position.y = b.y + sin(_t * 0.7 + b.phase) * 1.5
		var flap := sin(_t * b.flap + b.phase) * 0.7
		n.get_child(0).rotation.x = flap
		n.get_child(1).rotation.x = -flap
	for c in _clouds:
		c.position.x += delta * 0.6
		if c.position.x > 190.0:
			c.position.x = -140.0
	for f in _flicker:
		f[0].light_energy = f[1] * (0.82 + 0.18 * sin(_t * 13.0 + f[2]) * sin(_t * 7.3 + f[2] * 2.0))
	if windmill:
		windmill.rotation.z -= delta * 0.6
	if _storm:
		_flash -= delta
		if _flash < -6.0 + _rng.randf() * 3.0:
			_flash = 0.18
		sun.light_energy = env.sun_energy * (1.0 + (2.5 if _flash > 0.0 else 0.0))


## ── Ground ──

func _noise(seed_add: int, freq: float) -> FastNoiseLite:
	var n := FastNoiseLite.new()
	n.seed = _rng.randi() + seed_add
	n.frequency = freq
	n.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	n.fractal_octaves = 3
	return n


## The earth from the foreground to the hills: a grid with gentle bumps away from the lane and colour that
## drifts between the region's greens (or snows, or ashes).
func _build_ground() -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var hn := _noise(1, 0.035)
	var cn := _noise(2, 0.08)
	var x0 := -70.0
	var x1 := 140.0
	var z0 := -40.0
	var z1 := 60.0
	var nx := 84
	var nz := 40
	var height := func(x: float, z: float) -> float:
		var lane := clampf((absf(z) - 3.5) / 8.0, 0.0, 1.0)
		var h := hn.get_noise_2d(x, z) * 1.6 * lane
		if z < -6.0:
			h += (-z - 6.0) * 0.05
		return h
	for i in nz + 1:
		for j in nx + 1:
			var x := lerpf(x0, x1, float(j) / nx)
			var z := lerpf(z0, z1, float(i) / nz)
			var h: float = height.call(x, z)
			var n := (cn.get_noise_2d(x, z) + 1.0) * 0.5
			var c: Color = env.grass_dark.lerp(env.grass_light, n)
			c = c.lerp(env.grass, 0.45)
			var hx: float = height.call(x + 0.5, z) - height.call(x - 0.5, z)
			var hz: float = height.call(x, z + 0.5) - height.call(x, z - 0.5)
			st.set_normal(Vector3(-hx, 1.0, -hz).normalized())
			st.set_color(c)
			st.set_uv(Vector2(x, z) * 0.1)
			st.add_vertex(Vector3(x, h - 0.02, z))
	for i in nz:
		for j in nx:
			var a := i * (nx + 1) + j
			var b := a + 1
			var c := a + nx + 1
			var d := c + 1
			st.add_index(a); st.add_index(b); st.add_index(c)
			st.add_index(b); st.add_index(d); st.add_index(c)
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = Kit.mat("ground")
	mi.name = "Ground"
	add_child(mi)


## The dirt road along the lane, with ruts, pebbles and grassy edges.
func _build_road() -> void:
	var b := Kit.builder()
	var rn := _noise(3, 0.25)
	var step := 1.5
	var x := -4.0
	while x < 75.0:
		var w := 2.4 + rn.get_noise_1d(x) * 0.5
		var c: Color = env.road.lerp(env.road_dark, 0.5 + rn.get_noise_1d(x * 3.0) * 0.5)
		b.add("box", Vector3(x, 0.0, rn.get_noise_1d(x + 50.0) * 0.4), Vector3(step + 0.05, 0.06, w * 2.0), c, "ground")
		for rz in [-0.9, 0.9]:
			b.add("box", Vector3(x, 0.035, rz + rn.get_noise_1d(x + 90.0) * 0.2), Vector3(step + 0.05, 0.01, 0.35), env.road_dark, "ground")
		x += step
	var road := b.instance("Road")
	add_child(road)
	# pebbles and stones on and by the road
	var mm := _multimesh(_pebble_mesh(), 260)
	for i in 260:
		var px := _rng.randf_range(-4.0, 74.0)
		var pz := _rng.randf_range(-3.6, 3.6)
		var s := _rng.randf_range(0.08, 0.22)
		var xf := Transform3D(Basis.from_euler(Vector3(_rng.randf() * TAU, _rng.randf() * TAU, 0)).scaled(Vector3(s * 1.4, s, s)), Vector3(px, 0.04, pz))
		mm.multimesh.set_instance_transform(i, xf)
		mm.multimesh.set_instance_color(i, env.rocks.lerp(env.road_dark, _rng.randf() * 0.5))
	add_child(mm)


func _pebble_mesh() -> ArrayMesh:
	return Kit.builder().add("ball_lo", Vector3.ZERO, Vector3.ONE, Color.WHITE, "matte").mesh()


func _multimesh(mesh: Mesh, count: int, material: Material = null) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = mesh
	mm.instance_count = count
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	if material:
		mi.material_override = material
	return mi


const PACK_TREES := {oak = ["nature_oak_01", "nature_birch_01"], pine = ["nature_pine_01"], snowpine = ["winter/pine_snow", "winter/pine_small", "winter/bare_tree"],
	dead = ["nature_deadtree_01", "winter/bare_tree"], twisted = ["nature_deadtree_01", "nature_oak_01"], spire = ["nature_deadtree_01"]}
const REGION_TINT := {frontier = Color(1, 1, 1), frost = Color(0.92, 0.97, 1.05), ash = Color(0.62, 0.55, 0.52),
	cursed = Color(0.72, 0.7, 0.88), citadel = Color(0.55, 0.48, 0.5)}

var _pack_mat: StandardMaterial3D


## The pack's palette material tinted for the region (ash darkens it, the cursed lands turn it violet).
func _pack_material() -> Material:
	if _pack_mat == null or _pack_mat.get_meta("env", "") != env_id:
		_pack_mat = (Kit.palette_material() as StandardMaterial3D).duplicate()
		_pack_mat.albedo_color = REGION_TINT.get(env_id, Color.WHITE)
		_pack_mat.set_meta("env", env_id)
	return _pack_mat


## Scatters one Avramania model: count instances at the positions `where` returns (Vector3), scaled
## s0..s1, turned at random.
func _scatter(model: String, count: int, where: Callable, s0 := 1.0, s1 := 1.0, shadows := true) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = Kit.pack(model)
	mm.instance_count = count
	for i in count:
		var sc := _rng.randf_range(s0, s1)
		var pos: Vector3 = where.call(i)
		mm.set_instance_transform(i, Transform3D(Basis(Vector3.UP, _rng.randf() * TAU).scaled(Vector3(sc, sc, sc)), pos))
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	if Kit.is_palette(model):
		mi.material_override = _pack_material()
	if not shadows:
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.name = model
	add_child(mi)
	return mi


func _wind_material(strength: float, mode := 0) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = WIND
	m.set_shader_parameter("strength", strength)
	m.set_shader_parameter("mode", mode)
	return m


## Grass, flowers, bushes, rocks and the fence in front of the lane (z > 3), and along the far side of it.
func _build_foreground() -> void:
	var gm := Kit.builder()
	for k in 5:
		var a := k * TAU / 5.0
		gm.add("cone4", Vector3(cos(a) * 0.1, 0.18, sin(a) * 0.1), Vector3(0.14, 0.36, 0.05), Color.WHITE, "matte", Vector3(sin(a) * 22.0, k * 36.0, cos(a) * 22.0))
	var grass := _multimesh(gm.mesh(), 1800, _wind_material(0.35))
	for i in 1800:
		var px := _rng.randf_range(-8.0, 72.0)
		# thick along the road edges, sparser further out
		var edge := 3.0 + absf(_rng.randfn(0.0, 3.0))
		var pz := edge if i % 4 != 0 else -edge
		var s := _rng.randf_range(0.7, 1.5)
		grass.multimesh.set_instance_transform(i, Transform3D(Basis(Vector3.UP, _rng.randf() * TAU).scaled(Vector3(s, s, s)), Vector3(px, -0.02, pz)))
		grass.multimesh.set_instance_color(i, env.grass_dark.lerp(env.grass_light, _rng.randf()))
	add_child(grass)
	# bushes, rocks, ferns, flowers and tufts from the Avramania pack, thick in front of the lane
	var front := func(_i): return Vector3(_rng.randf_range(-8, 72), 0.0, _rng.randf_range(5.5, 20.0) if _rng.randf() < 0.7 else _rng.randf_range(-9.0, -4.0))
	if env_id in ["frontier", "cursed"]:
		_scatter("nature_bush_01", 34, front, 1.1, 2.1)
	_scatter("nature_boulder_01", 14, front, 0.8, 2.2)
	_scatter("nature_rocks_01", 16, front, 0.8, 1.6)
	if env_id in ["frontier", "cursed", "frost"]:
		_scatter("nature_rocks_01", 10, front, 1.0, 1.8)
	if env_id in ["frontier", "cursed"]:
		_scatter("nature_fern_01", 26, front, 1.0, 1.8)
		_scatter("nature_flowers_01", 40, func(_i): return Vector3(_rng.randf_range(-8, 72), 0.0, _rng.randf_range(3.2, 16.0)), 0.9, 1.5)
		_scatter("nature_grass_01", 60, func(_i): return Vector3(_rng.randf_range(-8, 72), 0.0, (1 if _rng.randf() < 0.75 else -1) * _rng.randf_range(3.0, 14.0)), 0.8, 1.6, false)
	if env_id == "cursed":
		_scatter("nature_mushrooms_01", 18, front, 1.0, 2.0)
	if env_id in ["frontier", "frost", "ash"]:
		_scatter("nature_stump_01", 6, front, 0.9, 1.3)
		_scatter("nature_log_01", 5, front, 0.9, 1.3)
	# the wooden fence of the web version, now with posts and two rails, along the near side of the road
	if "fence" in env.props:
		# the wooden fence of the web version along the near side of the road, from the pack's fence pieces
		_scatter("props_fence_wood_01", 62, func(i): return Vector3(7.0 + i * 1.0, -0.02, 5.2), 1.0, 1.0)
		var fm: MultiMeshInstance3D = get_child(get_child_count() - 1)
		for i in 62:
			fm.multimesh.set_instance_transform(i, Transform3D(Basis(Vector3.UP, _rng.randf_range(-0.04, 0.04)), Vector3(7.0 + i * 1.0, -0.02 + _rng.randf_range(-0.04, 0.0), 5.2)))


## Rolling hills behind the lane in three layers, each with its own forest.
func _build_hills() -> void:
	var layers := [[-22.0, 4.0, 0], [-50.0, 7.0, 1], [-95.0, 12.0, 2]]
	var tree := _tree_mesh(env.trees)
	for L in layers:
		var z: float = L[0]
		var hmax: float = L[1]
		var col: Color = env.hills[L[2]]
		var b := Kit.builder()
		var hn := _noise(10 + L[2], 0.04)
		var x := -80.0
		while x < 150.0:
			var w := _rng.randf_range(18.0, 34.0)
			var h := hmax * (0.55 + 0.45 * (hn.get_noise_1d(x) + 1.0) * 0.5)
			b.add("half", Vector3(x, -0.2, z + _rng.randf_range(-4, 4)), Vector3(w, h * 2.0, w * 0.6), col.lerp(env.grass, 0.15 * _rng.randf()), "ground")
			x += w * 0.55
		var hills := b.instance("Hills%d" % L[2])
		hills.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if L[2] > 0 else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		add_child(hills)
		var n: int = [70, 90, 110][L[2]]
		if L[2] == 0 or env.trees == "snowpine":
			# the nearest forest from the packs' trees; the far ones stay simple under the haze (the winter
			# pack's pines are light enough for every layer)
			var kinds: Array = PACK_TREES.get(env.trees, ["nature_oak_01"])
			for ki in kinds.size():
				_scatter(kinds[ki], n / kinds.size(), func(_i): return Vector3(_rng.randf_range(-70.0, 140.0), hmax * 0.3 * _rng.randf() - 0.3, z + _rng.randf_range(-6.0, 5.0)), 1.1, 1.7)
			continue
		var trees := _multimesh(tree, n, _wind_material(0.012))
		if L[2] > 0:
			trees.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		for i in n:
			var tx := _rng.randf_range(-70.0, 140.0)
			var tz := z + _rng.randf_range(-6.0, 5.0)
			var s: float = _rng.randf_range(0.7, 1.25) * (1.0 + L[2] * 0.35)
			var ty := hmax * 0.35 * _rng.randf()
			trees.multimesh.set_instance_transform(i, Transform3D(Basis(Vector3.UP, _rng.randf() * TAU).scaled(Vector3(s, s, s)), Vector3(tx, ty - 0.3, tz)))
			var tc: Color = env.tree_colors[_rng.randi_range(0, env.tree_colors.size() - 1)]
			trees.multimesh.set_instance_color(i, tc.lerp(env.fog, 0.12 * L[2]))
		add_child(trees)
	# a few near trees right behind the road (they frame the lane)
	var kinds2: Array = PACK_TREES.get(env.trees, ["nature_oak_01"])
	for ki in kinds2.size():
		_scatter(kinds2[ki], 16 / kinds2.size(), func(_i): return Vector3(_rng.randf_range(8.0, 70.0), 0.0, _rng.randf_range(-12.0, -6.0)), 1.2, 1.6)


## One tree of the region's kind, white-ish so the instance colour tints its leaves (the trunk keeps its hue).
func _tree_mesh(kind: String) -> ArrayMesh:
	var b := Kit.builder()
	var trunk: Color = env.trunk
	match kind:
		"oak":
			b.add("cyl", Vector3(0, 1.2, 0), Vector3(0.45, 2.4, 0.45), trunk * Color(3, 3, 3), "wood")
			b.add("ball", Vector3(0, 3.2, 0), Vector3(3.0, 2.6, 3.0), Color.WHITE, "foliage")
			b.add("ball", Vector3(0.9, 2.7, 0.4), Vector3(2.0, 1.8, 2.0), Color(0.9, 0.92, 0.9), "foliage")
			b.add("ball", Vector3(-0.9, 2.8, -0.3), Vector3(2.1, 1.9, 2.0), Color(1.05, 1.05, 1.0), "foliage")
		"pine", "snowpine":
			b.add("cyl", Vector3(0, 0.8, 0), Vector3(0.35, 1.6, 0.35), trunk * Color(3, 3, 3), "wood")
			for k in 4:
				var y := 1.4 + k * 1.05
				var r := 2.4 - k * 0.5
				b.add("cone", Vector3(0, y + 0.6, 0), Vector3(r, 1.6, r), Color.WHITE, "foliage")
				if kind == "snowpine":
					b.add("cone", Vector3(0, y + 0.95, 0), Vector3(r * 0.62, 0.9, r * 0.62), Color(3.2, 3.2, 3.4), "foliage")
		"dead":
			b.add("cyl", Vector3(0, 1.7, 0), Vector3(0.35, 3.4, 0.35), Color.WHITE, "wood")
			b.beam(Vector3(0, 2.4, 0), Vector3(1.1, 3.4, 0.2), Vector2(0.14, 0.14), Color.WHITE, "wood")
			b.beam(Vector3(0, 2.0, 0), Vector3(-0.9, 2.9, -0.2), Vector2(0.12, 0.12), Color.WHITE, "wood")
			b.beam(Vector3(0.6, 3.0, 0.1), Vector3(1.0, 3.9, 0.3), Vector2(0.08, 0.08), Color.WHITE, "wood")
		"twisted":
			b.beam(Vector3(0, 0, 0), Vector3(0.4, 1.6, 0), Vector2(0.4, 0.4), trunk * Color(3, 3, 3), "wood")
			b.beam(Vector3(0.4, 1.6, 0), Vector3(-0.2, 3.0, 0.1), Vector2(0.32, 0.32), trunk * Color(3, 3, 3), "wood")
			b.add("ball", Vector3(-0.3, 3.4, 0), Vector3(2.2, 1.5, 2.0), Color.WHITE, "foliage")
			b.add("ball", Vector3(0.8, 2.8, 0.2), Vector3(1.4, 1.0, 1.3), Color(0.85, 0.85, 0.9), "foliage")
		"spire":
			b.add("cone6", Vector3(0, 2.2, 0), Vector3(0.9, 4.4, 0.9), Color.WHITE, "matte")
			b.add("cone6", Vector3(0.5, 1.2, 0.2), Vector3(0.5, 2.4, 0.5), Color(0.8, 0.8, 0.8), "matte", Vector3(0, 0, -14))
			b.add("cone6", Vector3(-0.4, 1.0, -0.1), Vector3(0.45, 2.0, 0.45), Color(0.8, 0.8, 0.8), "matte", Vector3(0, 0, 12))
	return b.mesh()


## Mountains in two ranges far behind, hazed by the fog, with caps (snow, glowing lava, cursed light).
func _build_mountains() -> void:
	for range_i in 2:
		var b := Kit.builder()
		var z := -230.0 - range_i * 110.0
		var col: Color = env.mountain if range_i == 0 else env.mountain_far
		var x := -160.0
		while x < 240.0:
			var h := _rng.randf_range(14.0, 30.0) * (1.0 + range_i * 0.6)
			var w := h * _rng.randf_range(2.2, 3.2)
			var zz := z + _rng.randf_range(-20, 20)
			b.add("cone6" if _rng.randf() < 0.6 else "cone", Vector3(x, h * 0.5 - 4.0, zz), Vector3(w, h, w * 0.7), col.lerp(env.fog, _rng.randf() * 0.15), "stone", Vector3(0, _rng.randf() * 60.0, 0))
			# the cap: snow, or glowing lava in the Ashen Lands, or a sickly light over the cursed peaks
			b.add("cone6", Vector3(x, h * 0.84 - 4.0, zz + 0.4), Vector3(w * 0.33, h * 0.33, w * 0.33 * 0.7), env.snowcap, "glow" if env_id == "ash" else "matte", Vector3(0, _rng.randf() * 60.0, 0))
			x += w * _rng.randf_range(0.3, 0.5)
		var m := b.instance("Mountains%d" % range_i)
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(m)


## Clouds, birds, stars.
func _build_sky_things() -> void:
	var cm := Kit.builder()
	for k in 6:
		cm.add("ball", Vector3(k * 2.6 - 6.5, sin(k * 1.7) * 1.2 + (2.0 if k in [2, 3] else 0.0), cos(k * 2.1) * 2.0), Vector3(6.0, 4.0, 4.5) * (1.3 if k in [2, 3] else 1.0), Color.WHITE, "foliage")
	var cloud_mesh := cm.mesh()
	for i in 9:
		var c := MeshInstance3D.new()
		c.mesh = cloud_mesh
		c.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var mat := StandardMaterial3D.new()
		mat.albedo_color = env.clouds
		mat.vertex_color_use_as_albedo = true
		mat.roughness = 1.0
		mat.rim_enabled = true
		mat.rim = 0.6
		mat.emission_enabled = true
		mat.emission = env.clouds * 0.25
		c.material_override = mat
		var s := _rng.randf_range(1.0, 2.2)
		c.scale = Vector3(s, s * 0.7, s)
		c.position = Vector3(_rng.randf_range(-140, 190), _rng.randf_range(38, 62), _rng.randf_range(-200, -130))
		add_child(c)
		_clouds.append(c)
	if env_id != "citadel":
		for i in 5:
			var bird := Node3D.new()
			for side in [-1, 1]:
				var wing := Kit.builder().add("box", Vector3(0, 0, side * 0.35), Vector3(0.25, 0.04, 0.7), Color(0.12, 0.1, 0.1)).instance()
				bird.add_child(wing)
			bird.position = Vector3(_rng.randf_range(-40, 100), 0, _rng.randf_range(-60, -30))
			bird.scale = Vector3.ONE * 1.6
			add_child(bird)
			_birds.append({node = bird, y = _rng.randf_range(22, 36), speed = _rng.randf_range(2.5, 5.0), phase = _rng.randf() * TAU, flap = _rng.randf_range(7, 10)})
	if env.stars:
		var sm := _multimesh(Kit.builder().add("ball_lo", Vector3.ZERO, Vector3.ONE, Color.WHITE, "glow").mesh(), 160)
		sm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		for i in 160:
			var s := _rng.randf_range(0.4, 1.1)
			sm.multimesh.set_instance_transform(i, Transform3D(Basis().scaled(Vector3(s, s, s)), Vector3(_rng.randf_range(-250, 300), _rng.randf_range(60, 220), -500)))
			sm.multimesh.set_instance_color(i, Color(1, 1, 1).lerp(Color(0.7, 0.8, 1.0), _rng.randf()))
		add_child(sm)


## The region's own touches: a windmill, a frozen lake, lava and vents, ruins and graves, the dark citadel.
func _build_props() -> void:
	var p: Array = env.props
	if "windmill" in p:
		var b := Kit.builder()
		b.add("cyl", Vector3(0, 4, 0), Vector3(3.2, 8, 3.2), Color("#e9dcc4"), "stone")
		b.add("cone", Vector3(0, 9.3, 0), Vector3(4.0, 2.8, 4.0), Color("#a5482f"))
		b.add("box", Vector3(0, 1.2, 1.55), Vector3(1.0, 2.2, 0.2), Color("#6b4a2f"), "wood")
		var mill := b.instance("Windmill")
		mill.position = Vector3(44, 3.5, -40)
		add_child(mill)
		var blades := Kit.builder()
		for k in 4:
			var a := k * 90.0
			blades.add("box", Vector3(cos(deg_to_rad(a)) * 2.6, sin(deg_to_rad(a)) * 2.6, 0), Vector3(5.0, 0.9, 0.1), Color("#efe6d2"), "wood", Vector3(0, 0, a))
		blades.add("cyl", Vector3.ZERO, Vector3(0.5, 0.6, 0.5), Color("#5a3e28"), "wood", Vector3(90, 0, 0))
		windmill = blades.instance("Blades")
		windmill.position = Vector3(44, 12.2, -38.2)
		add_child(windmill)
	if "haystacks" in p:
		_scatter("farm_haystack_02", 4, func(i): return Vector3(18 + i * 3.5, 0, -15 - (i % 2) * 2.0), 2.0, 2.6)
		_scatter("farm_hay_bale_01", 6, func(i): return Vector3(30 + i * 1.6, 0, -9.5 - (i % 3)), 1.3, 1.5)
		add_child(Kit.pack_node("farm_scarecrow_01", Vector3(26, 0, -12), 1.4, -30.0))
		var cot := Kit.pack_node("village_cottage_01", Vector3(52, 0, -20), 1.3, 20.0)
		cot.material_override = _pack_material()
		add_child(cot)
		add_child(Kit.pack_node("village_well_01", Vector3(46, 0, -14), 1.3))
		add_child(Kit.pack_node("props_signpost_01", Vector3(57, 0, 3.6), 1.5, -20.0))
		add_child(Kit.pack_node("props_cart_wheel_01", Vector3(40, 0, 7.5), 1.4, 70.0))
	if false:
		var hb := Kit.builder()
		for k in 4:
			hb.add("half", Vector3(k * 3.3, 0, sin(k) * 2.0), Vector3(2.4, 3.2, 2.4), Color("#e2b65a"))
		var hay := hb.instance("Hay")
		hay.position = Vector3(20, 0, -16)
		add_child(hay)
	if "icicles" in p:
		_scatter("winter/snow_pile", 14, func(_i): return Vector3(_rng.randf_range(-6, 70), -0.05, _rng.randf_range(4.5, 16) if _rng.randf() < 0.7 else _rng.randf_range(-10, -4)), 1.0, 2.2)
		_scatter("winter/ice_block", 5, func(_i): return Vector3(_rng.randf_range(10, 66), 0, _rng.randf_range(-12, -7)), 0.9, 1.4)
		_scatter("winter/ice_crystal", 6, func(_i): return Vector3(_rng.randf_range(10, 66), 0, _rng.randf_range(7, 14)), 0.9, 1.5)
		_scatter("winter/firewood_stack", 2, func(i): return Vector3(-3.5 - i * 1.8, 0, 3.6), 1.1, 1.2)
		_scatter("winter/fence_snow", 28, func(i): return Vector3(7.5 + i * 2.2, 0, 5.2), 1.0, 1.0)
		add_child(Kit.pack_node("winter/wood_cabin", Vector3(48, 0, -18), 1.6, -25.0))
		add_child(Kit.pack_node("winter/campfire_snow", Vector3(44, 0, -14), 1.3))
		add_child(Kit.pack_node("winter/signpost_snow", Vector3(57, 0, 3.6), 1.4, -20.0))
		add_child(Kit.pack_node("winter/sled", Vector3(40, 0, 8.0), 1.3, 60.0))
	if "frozen_lake" in p:
		var lake := MeshInstance3D.new()
		var pm := PlaneMesh.new()
		pm.size = Vector2(40, 10)
		lake.mesh = pm
		var lm := StandardMaterial3D.new()
		lm.albedo_color = Color("#b9d8ee")
		lm.metallic = 0.4
		lm.roughness = 0.08
		lake.material_override = lm
		lake.position = Vector3(36, 0.03, -15)
		add_child(lake)
	if "lava" in p:
		for k in 4:
			var pool := MeshInstance3D.new()
			var pm := PlaneMesh.new()
			pm.size = Vector2(_rng.randf_range(4, 9), _rng.randf_range(2, 4))
			pool.mesh = pm
			var lm := StandardMaterial3D.new()
			lm.albedo_color = Color("#ff7a20")
			lm.emission_enabled = true
			lm.emission = Color("#ff5a10")
			lm.emission_energy_multiplier = 2.5
			pool.material_override = lm
			pool.position = Vector3(_rng.randf_range(10, 65), 0.04, [-9.0, -14.0, 10.0, 15.0][k])
			add_child(pool)
			var light := OmniLight3D.new()
			light.light_color = Color("#ff7a30")
			light.light_energy = 1.6
			light.omni_range = 9.0
			light.position = pool.position + Vector3(0, 1.0, 0)
			add_child(light)
			_flicker.append([light, 1.6, _rng.randf() * 10.0])
	if "smoke_vents" in p:
		for k in 3:
			add_child(_smoke(Vector3(_rng.randf_range(15, 60), 0, _rng.randf_range(-30, -14)), 2.0))
	if "ruins" in p or "gravestones" in p:
		_scatter("props_tombstone_01", 10, func(_i): return Vector3(_rng.randf_range(12, 66), 0, _rng.randf_range(-13, -7.5) if _rng.randf() < 0.6 else _rng.randf_range(7.5, 13)), 1.2, 1.6)
		_scatter("props_grave_marker_01", 8, func(_i): return Vector3(_rng.randf_range(12, 66), 0, _rng.randf_range(-12, -7)), 1.2, 1.5)
		_scatter("dungeon_pillar_01", 5, func(_i): return Vector3(_rng.randf_range(15, 65), 0, _rng.randf_range(-16, -10)), 1.3, 1.9)
		_scatter("dungeon_arch_01", 2, func(i): return Vector3(24 + i * 26, 0, -17), 1.5, 1.6)
		_scatter("dungeon_skull_01", 8, func(_i): return Vector3(_rng.randf_range(8, 70), 0, _rng.randf_range(3.4, 9)), 1.5, 2.2)
	if false:
		var rb := Kit.builder()
		for k in 7:
			var x := _rng.randf_range(10, 68)
			var z := _rng.randf_range(-15, -8) if k % 2 else _rng.randf_range(8, 16)
			if k < 3:
				var h := _rng.randf_range(2.0, 5.0)
				rb.add("box", Vector3(x, h * 0.5, z), Vector3(1.2, h, 1.2), env.rocks, "stone", Vector3(0, 0, _rng.randf_range(-8, 8)))
				rb.add("box", Vector3(x + 1.2, 0.4, z), Vector3(1.0, 0.8, 0.9), env.rocks.darkened(0.1), "stone", Vector3(0, 30, 10))
			else:
				rb.add("box", Vector3(x, 0.55, z), Vector3(0.7, 1.1, 0.22), env.rocks.lightened(0.1), "stone", Vector3(0, 0, _rng.randf_range(-12, 12)))
				rb.add("cyl", Vector3(x, 1.1, z), Vector3(0.7, 0.22, 0.7), env.rocks.lightened(0.1), "stone", Vector3(90, 0, 0))
		add_child(rb.instance("Ruins"))
	if "citadel" in p:
		var cb := Kit.builder()
		var dark := Color("#1d1519")
		cb.add("box", Vector3(0, 14, 0), Vector3(60, 28, 14), dark, "stone")
		for k in 7:
			var x := -27.0 + k * 9.0
			var h := 34.0 + (k % 3) * 9.0 + (18.0 if k == 3 else 0.0)
			cb.add("cyl", Vector3(x, h * 0.5, 2), Vector3(6, h, 6), dark.lightened(0.04), "stone")
			cb.add("cone", Vector3(x, h + 5.0, 2), Vector3(7.5, 10.0, 7.5), Color("#2a1018"))
			for w in 3:
				cb.add("box", Vector3(x, h * (0.45 + w * 0.15), 5.1), Vector3(0.8, 1.6, 0.3), Color("#ff4a3a"), "glow")
		var cit := cb.instance("Citadel")
		cit.position = Vector3(70, 0, -120)
		cit.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(cit)
	if "spikes" in p:
		var sb := Kit.builder()
		for k in 24:
			var x := _rng.randf_range(8, 70)
			var z := _rng.randf_range(-12, -6) if k % 2 else _rng.randf_range(7, 13)
			sb.add("cone4", Vector3(x, 0.9, z), Vector3(0.35, 1.8, 0.35), Color("#3a2f2a"), "wood", Vector3(_rng.randf_range(-15, 15), 0, _rng.randf_range(-15, 15)))
		add_child(sb.instance("Spikes"))
	if "banners" in p:
		for k in 4:
			add_child(flag(Vector3(_rng.randf_range(14, 60), 0, _rng.randf_range(-13, -8)), Color("#6a1020"), Color("#1a1418"), 4.5))
	if "bones" in p or "spikes" in p:
		_scatter("dungeon_skull_01", 10, func(_i): return Vector3(_rng.randf_range(8, 70), 0, _rng.randf_range(3.4, 10)), 1.5, 2.2)
		_scatter("dungeon_rubble_01", 6, func(_i): return Vector3(_rng.randf_range(10, 70), 0, _rng.randf_range(-12, -6) if _rng.randf() < 0.5 else _rng.randf_range(7, 14)), 1.2, 1.8)
	if "citadel" in p:
		_scatter("dungeon_pillar_01", 6, func(_i): return Vector3(_rng.randf_range(12, 66), 0, _rng.randf_range(-15, -9)), 1.6, 2.2)
	if "bones" in p:
		var bb := Kit.builder()
		for k in 10:
			var x := _rng.randf_range(8, 70)
			var z := _rng.randf_range(3.5, 9.0)
			bb.add("capsule", Vector3(x, 0.08, z), Vector3(0.12, 0.35, 0.12), Color("#e8dcc6"), "matte", Vector3(0, _rng.randf() * 180, 90))
		add_child(bb.instance("Bones"))


## A pole with a cloth that ripples in the wind (the castle uses it too).
func flag(at: Vector3, cloth: Color, pole_col: Color, height: float) -> Node3D:
	var n := Node3D.new()
	n.position = at
	var pole := Kit.builder().add("cyl", Vector3(0, height * 0.5, 0), Vector3(0.09, height, 0.09), pole_col, "wood") \
		.add("ball", Vector3(0, height + 0.08, 0), Vector3(0.2, 0.2, 0.2), Color("#e5c06a"), "metal")
	n.add_child(pole.instance())
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var cols := 10
	var rows := 4
	var fw := height * 0.42
	var fh := height * 0.26
	for r in rows + 1:
		for c in cols + 1:
			var u := float(c) / cols
			var v := float(r) / rows
			var col := cloth if r != 0 and r != rows else cloth.darkened(0.25)
			if c == cols:
				col = cloth.lightened(0.15)
			st.set_color(col)
			st.set_normal(Vector3(0, 0, 1))
			# a swallowtail: the free edge is cut in towards the middle
			var notch := 0.35 * fh * (1.0 - absf(v - 0.5) * 2.0) if c == cols else 0.0
			st.add_vertex(Vector3(u * fw - notch, height - 0.1 - v * fh, 0))
	for r in rows:
		for c in cols:
			var a := r * (cols + 1) + c
			st.add_index(a); st.add_index(a + cols + 1); st.add_index(a + 1)
			st.add_index(a + 1); st.add_index(a + cols + 1); st.add_index(a + cols + 2)
	var cl := MeshInstance3D.new()
	cl.mesh = st.commit()
	cl.material_override = _wind_material(0.16, 1)
	n.add_child(cl)
	return n


func _smoke(at: Vector3, size: float) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.position = at
	p.amount = 18
	p.lifetime = 5.0
	p.mesh = _soft_ball(Color(0.25, 0.22, 0.22, 0.5))
	p.direction = Vector3(0.2, 1, 0)
	p.spread = 12.0
	p.initial_velocity_min = 1.0
	p.initial_velocity_max = 2.0
	p.gravity = Vector3(0.3, 0.4, 0)
	p.scale_amount_min = size * 0.6
	p.scale_amount_max = size * 1.2
	var curve := Curve.new()
	curve.add_point(Vector2(0, 0.4))
	curve.add_point(Vector2(1, 2.2))
	p.scale_amount_curve = curve
	var grad := Gradient.new()
	grad.set_color(0, Color(1, 1, 1, 0.6))
	grad.set_color(1, Color(1, 1, 1, 0.0))
	p.color_ramp = grad
	return p


static var _soft_cache := {}


## A low ball with a translucent unshaded material for smoke and dust (colour from the particle ramp).
static func _soft_ball(c: Color) -> Mesh:
	var key := c.to_html()
	if _soft_cache.has(key):
		return _soft_cache[key]
	var m := SphereMesh.new()
	m.radius = 0.5
	m.height = 1.0
	m.radial_segments = 8
	m.rings = 4
	var mat := StandardMaterial3D.new()
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.vertex_color_use_as_albedo = true
	mat.albedo_color = c
	m.material = mat
	_soft_cache[key] = m
	return m


## Leaves, snow, embers, motes or ash drifting through the whole view; rain in a storm.
func _build_weather() -> void:
	var kind: String = env.particles
	var p := CPUParticles3D.new()
	p.amount = 160
	p.lifetime = 9.0
	p.preprocess = 9.0
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	p.emission_box_extents = Vector3(60, 2, 14)
	p.position = Vector3(30, 34, 2)
	var q := QuadMesh.new()
	q.size = Vector2(0.25, 0.25)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	q.material = m
	p.mesh = q
	p.direction = Vector3(0, -1, 0)
	p.spread = 25.0
	p.gravity = Vector3(0.6, -1.2, 0)
	p.initial_velocity_min = 0.5
	p.initial_velocity_max = 1.5
	match kind:
		"leaves":
			p.amount = 50
			p.color = Color("#d9a441")
			p.angular_velocity_min = -180
			p.angular_velocity_max = 180
			q.size = Vector2(0.3, 0.18)
			p.gravity = Vector3(1.2, -0.7, 0)
		"snow":
			p.amount = 420
			p.color = Color(1, 1, 1, 0.9)
			q.size = Vector2(0.16, 0.16)
			p.gravity = Vector3(0.8, -1.4, 0)
		"embers":
			p.amount = 140
			p.color = Color(1.0, 0.55, 0.15)
			q.size = Vector2(0.12, 0.12)
			p.position.y = 0.0
			p.direction = Vector3(0, 1, 0)
			p.gravity = Vector3(0.4, 1.1, 0)
			m.albedo_color = Color(2.2, 1.2, 0.6)
		"motes":
			p.amount = 90
			p.color = Color(0.75, 0.6, 1.0, 0.85)
			q.size = Vector2(0.14, 0.14)
			p.position.y = 4.0
			p.emission_box_extents.y = 6.0
			p.gravity = Vector3(0.1, 0.25, 0)
			m.albedo_color = Color(1.8, 1.5, 2.2)
		"ash":
			p.amount = 220
			p.color = Color(0.55, 0.5, 0.5, 0.8)
			q.size = Vector2(0.12, 0.12)
			p.gravity = Vector3(0.9, -0.9, 0)
	add_child(p)
	if env.storm:
		var rain := CPUParticles3D.new()
		rain.amount = 500
		rain.lifetime = 1.6
		rain.preprocess = 2.0
		rain.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
		rain.emission_box_extents = Vector3(60, 1, 14)
		rain.position = Vector3(30, 36, 2)
		var rq := QuadMesh.new()
		rq.size = Vector2(0.04, 0.9)
		var rm := StandardMaterial3D.new()
		rm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		rm.billboard_mode = BaseMaterial3D.BILLBOARD_FIXED_Y
		rm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		rm.albedo_color = Color(0.8, 0.85, 1.0, 0.35)
		rq.material = rm
		rain.mesh = rq
		rain.direction = Vector3(0.15, -1, 0)
		rain.spread = 2.0
		rain.initial_velocity_min = 22.0
		rain.initial_velocity_max = 26.0
		rain.gravity = Vector3.ZERO
		add_child(rain)


## The castle's torches and other warm lights register here so they flicker.
func add_flicker(light: OmniLight3D) -> void:
	_flicker.append([light, light.light_energy, _rng.randf() * 10.0])
