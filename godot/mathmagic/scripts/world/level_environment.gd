class_name LevelEnvironment
extends RefCounted
## The shared look of every level: a bright sky, one sun with soft shadows and the sea around the island.
## Built in code so all levels of a world light the same way and none can drift. Each world has a palette:
## the island is warm and sunny, the mountains a little cooler and higher, with a pale sky.

const WATER_Y := -1.1
## Light per world. The island keeps its first tuning. The mountains were retuned with the art pass: a
## softer, lower sun and less flat ambient light, and a higher tonemap white point, so lit grass stays green
## instead of clipping to pale lime and shadows show the shape of the rock.
const PALETTES := [
	{top = "#4fa8f0", horizon = "#bfe6ff", sea = "#2f7fb8", ambient = "#c9dcff", sun = "#fff4dd",
		sun_energy = 1.0, sun_pitch = -52.0, ambient_energy = 0.45, exposure = 0.9, white = 1.0},
	{top = "#5d8fe0", horizon = "#e6e4fa", sea = "#3b6fb0", ambient = "#cfd8f5", sun = "#ffeacc",
		sun_energy = 0.75, sun_pitch = -40.0, ambient_energy = 0.34, exposure = 1.1, white = 4.0, fog = 0.55},
]


static func build(parent: Node3D, min_x: float, max_x: float, world := 0) -> void:
	var pal: Dictionary = PALETTES[clampi(world, 0, PALETTES.size() - 1)]
	var env := Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(pal.top)
	sm.sky_horizon_color = Color(pal.horizon)
	sm.ground_bottom_color = Color(pal.sea)
	sm.ground_horizon_color = Color(pal.horizon)
	sm.sun_angle_max = 20.0
	sky.sky_material = sm
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(pal.ambient)
	env.ambient_light_energy = pal.ambient_energy
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = pal.exposure
	env.tonemap_white = pal.white
	if pal.has("fog"):  # haze toward the horizon: far rocks fade into the sky and the path stands out
		env.fog_enabled = true
		env.fog_mode = Environment.FOG_MODE_DEPTH   # starts behind the play area, so nothing near is hazy
		env.fog_light_color = Color(pal.horizon)
		env.fog_density = pal.fog
		env.fog_depth_begin = 18.0
		env.fog_depth_end = 55.0
		env.fog_sky_affect = 0.0
	env.glow_enabled = true
	env.glow_intensity = 0.25
	env.glow_hdr_threshold = 1.2
	var we := WorldEnvironment.new()
	we.environment = env
	parent.add_child(we)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(pal.sun_pitch, -35, 0)
	sun.light_energy = pal.sun_energy
	sun.light_color = Color(pal.sun)
	sun.shadow_enabled = true
	sun.shadow_opacity = 0.55
	sun.directional_shadow_max_distance = 45.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	parent.add_child(sun)

	# the sea: one MultiMesh of water hexes from far behind the island to just in front of it
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = Art.mesh("hexagon/hex_water")
	var pts := []
	var x0 := floorf((min_x - 26.0) / 2.0) * 2.0
	for r in range(-9, 4):
		var z := r * Ground.ROW_Z
		var shift := 1.0 if absi(r) % 2 == 1 else 0.0
		var x := x0 + shift
		while x < max_x + 26.0:
			pts.append(Vector3(x, WATER_Y + 0.2, z))
			x += Ground.TILE_W
	mm.instance_count = pts.size()
	for i in pts.size():
		mm.set_instance_transform(i, Transform3D(Basis(), pts[i]))
	var water := MultiMeshInstance3D.new()
	water.multimesh = mm
	water.material_override = Art.tinted("hexagon/hex_water", Color(0.55, 0.75, 1.0))
	water.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(water)
