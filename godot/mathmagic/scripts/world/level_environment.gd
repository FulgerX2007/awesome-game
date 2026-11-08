class_name LevelEnvironment
extends RefCounted
## The shared look of every level: a bright sky, one sun with soft shadows and the sea around the island.
## Built in code so all five levels light the same way and none can drift.

const WATER_Y := -1.1


static func build(parent: Node3D, min_x: float, max_x: float) -> void:
	var env := Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color("#4fa8f0")
	sm.sky_horizon_color = Color("#bfe6ff")
	sm.ground_bottom_color = Color("#2f7fb8")
	sm.ground_horizon_color = Color("#bfe6ff")
	sm.sun_angle_max = 20.0
	sky.sky_material = sm
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("#c9dcff")
	env.ambient_light_energy = 0.45
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 0.9
	env.glow_enabled = true
	env.glow_intensity = 0.25
	env.glow_hdr_threshold = 1.2
	var we := WorldEnvironment.new()
	we.environment = env
	parent.add_child(we)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52, -35, 0)
	sun.light_energy = 1.0
	sun.light_color = Color("#fff4dd")
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
