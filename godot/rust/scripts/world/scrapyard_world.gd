class_name ScrapyardWorld
extends Node3D
## The scrapyard: environment, stations, the brigade, the ark and the events, all shown from the rules'
## state. It never changes the state itself: clicks on stations call the Game autoload, and the views
## follow Game's signals (ticked, changed, state_replaced, event, acted).

signal launch_finished

const PILE_POS := {yard = Vector3(-10.5, 0, -0.6), north = Vector3(-15.0, 0, -5.4), graveyard = Vector3(14.6, 0, -5.0)}
const PILE_R := {yard = 2.6, north = 2.1, graveyard = 2.3}
const CONVEYOR_START := Vector3(-8.3, 0, 1.7)
const CONVEYOR_LEN := 5.3
const TABLE_POS := Vector3(-1.0, 0, 1.7)
const REACTOR_POS := Vector3(3.4, 0, 2.6)
const BAY_POS := Vector3(8.8, 0, 1.2)
const ARK_POS := Vector3(2.0, 0, -13.0)
const ARK_SCALE := 0.82
const HORIZON_Z := -21.0
const CAM_PITCH := -24.0
const CAM_CENTER := Vector3(0.6, 2.2, -4.6)
const WRECK_POS := Vector3(12.2, 0, 3.4)
const SALVAGE_SPOTS: Array[Vector3] = [Vector3(-5.5, 0, -2.6), Vector3(0.5, 0, -3.4), Vector3(6.0, 0, 4.4),
	Vector3(-12.8, 0, 3.6), Vector3(11.5, 0, -2.0), Vector3(-3.5, 0, 4.5)]

var camera: Camera3D
var piles := {}
var conveyor: Conveyor
var table: SortingStation
var bay: RepairStation
var reactor: ReactorCore
var ark: Ark
var crew: WorkerCrew
var env: Environment

var _sky_mat: ShaderMaterial
var _backdrop: MeshInstance3D
var _key: DirectionalLight3D
var _lamps: Array[StandardMaterial3D] = []
var _lamp_lights: Array[OmniLight3D] = []
var _cables: Array[MeshInstance3D] = []
var _cable_mat: StandardMaterial3D
var _player: Node3D
var _player_arm: Node3D
var _swing := 0.0
var _crane_jib: Node3D
var _magnet: Node3D
var _magnet_mat: StandardMaterial3D
var _dispatch: Node3D
var _beacon: Node3D
var _drone: Node3D
var _drone_rotors: Array[Node3D] = []
var _crate: Node3D
var _crate_area: Interactable
var _crate_beam: MeshInstance3D
var _wreck: Node3D
var _wreck_area: Interactable
var _wreck_eye: StandardMaterial3D
var _floaters: Array = []
var _shake := 0.0
var _t := 0.0
var _cam_base := Vector3.ZERO
var _dawn := 0.0
var _s: GameState


func _ready() -> void:
	_build_environment()
	_build_ground()
	Props.ridges(self)
	_build_decor()
	for zone in PILE_POS:
		var p: ScrapPile = preload("res://scenes/world/scrap_pile.tscn").instantiate()
		p.name = "Pile_" + zone
		p.position = PILE_POS[zone]
		add_child(p)
		p.setup(zone, PILE_R[zone])
		p.area.activated.connect(func(): if p.open: Game.dig())
		piles[zone] = p
	conveyor = preload("res://scenes/world/conveyor.tscn").instantiate()
	conveyor.position = CONVEYOR_START
	add_child(conveyor)
	conveyor.setup(CONVEYOR_LEN)
	table = preload("res://scenes/world/sorting_station.tscn").instantiate()
	table.position = TABLE_POS
	add_child(table)
	table.area.activated.connect(func(): Game.sort())
	reactor = preload("res://scenes/world/reactor_core.tscn").instantiate()
	reactor.position = REACTOR_POS
	add_child(reactor)
	reactor.area.activated.connect(func(): if Game.fix_shortage(): reactor.hit_fx())
	bay = preload("res://scenes/world/repair_station.tscn").instantiate()
	bay.position = BAY_POS
	add_child(bay)
	bay.area.activated.connect(func(): Game.repair())
	ark = preload("res://scenes/world/ark.tscn").instantiate()
	ark.position = ARK_POS
	ark.scale = Vector3.ONE * ARK_SCALE
	add_child(ark)
	ark.launch_finished.connect(func(): launch_finished.emit())
	_build_cables()
	_build_player()
	_build_crane()
	_build_dispatch()
	_build_drone()
	_build_events()
	crew = WorkerCrew.new()
	add_child(crew)
	crew.setup(self)
	Fx.dust(self)
	Game.ticked.connect(_refresh)
	Game.changed.connect(_refresh)
	Game.state_replaced.connect(_on_replaced)
	Game.event.connect(_on_event)
	Game.acted.connect(_on_acted)
	_on_replaced()


# ── building ──

func _build_environment() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("140f22")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("564a86")
	env.ambient_light_energy = 0.75
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.0
	env.glow_enabled = true
	env.glow_intensity = 0.55
	env.glow_bloom = 0.04
	env.glow_hdr_threshold = 1.2
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	# only the far back fades into the dusk: the yard stays crisp
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_light_color = Color("4a2c48")
	env.fog_light_energy = 1.0
	env.fog_depth_begin = 47.0
	env.fog_depth_end = 72.0
	env.fog_depth_curve = 1.2
	env.fog_sky_affect = 0.0
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.06
	env.adjustment_contrast = 1.06
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	_key = DirectionalLight3D.new()
	_key.light_color = Color("ffb084")
	_key.light_energy = 0.95
	_key.rotation_degrees = Vector3(-34, -42, 0)
	_key.shadow_enabled = true
	_key.shadow_blur = 1.5
	_key.directional_shadow_max_distance = 80.0
	_key.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	add_child(_key)
	var rim := DirectionalLight3D.new()
	rim.light_color = Color("f08a4a")
	rim.light_energy = 0.55
	rim.rotation_degrees = Vector3(-10, 170, 0)
	add_child(rim)
	camera = Camera3D.new()
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.rotation_degrees = Vector3(CAM_PITCH, 0, 0)
	camera.size = 17.0
	camera.near = 1.0
	camera.far = 160.0
	_cam_base = CAM_CENTER + camera.basis.z * 45.0
	camera.position = _cam_base
	add_child(camera)
	_sky_mat = ShaderMaterial.new()
	_sky_mat.shader = load("res://shaders/backdrop.gdshader")
	var q := QuadMesh.new()
	q.size = Vector2(1, 1)
	_backdrop = Kit.place(camera, q, _sky_mat, Vector3(0, 0, -150), Vector3.ZERO, false)


func _build_ground() -> void:
	var g := PlaneMesh.new()
	g.size = Vector2(160, 40.0)
	Kit.place(self, g, Kit.mat(Kit.GROUND, 1.0, 0.0), Vector3(0, 0, HORIZON_Z + 20.0))
	# scattered junk on the ground, one draw call
	var mmi := MultiMeshInstance3D.new()
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = Kit.box_mesh(Vector3(0.3, 0.06, 0.2))
	mm.instance_count = 420
	var rng := RandomNumberGenerator.new()
	rng.seed = 3
	for i in mm.instance_count:
		var p := Vector3(rng.randf_range(-24, 24), 0.03, rng.randf_range(-12, 7))
		var b := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * rng.randf_range(0.5, 1.8))
		mm.set_instance_transform(i, Transform3D(b, p))
		mm.set_instance_color(i, Kit.SCRAP_COLORS[i % Kit.SCRAP_COLORS.size()].darkened(rng.randf_range(0.2, 0.5)))
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.roughness = 0.9
	mmi.material_override = m
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)
	# paths worn into the ground between stations
	for seg in [[Vector3(-8, 0, 3.4), Vector3(10, 0, 3.4)], [Vector3(-2, 0, -1.8), Vector3(8, 0, -1.8)]]:
		Kit.box(self, Vector3(seg[0].distance_to(seg[1]), 0.01, 1.4), Kit.mat(Color("3a2b38"), 1.0, 0.0), (seg[0] + seg[1]) / 2.0 + Vector3(0, 0.005, 0))


func _build_decor() -> void:
	Props.car(self, Vector3(-6.0, 0, -4.8), 20, Color("6e4a3a"))
	Props.car(self, Vector3(9.5, 0, -4.2), -150, Color("4f5c63"))
	Props.car(self, Vector3(-17.5, 0, 1.5), 75, Color("7a6a58"))
	Props.tyres(self, Vector3(-4.6, 0, 4.6), 4)
	Props.tyres(self, Vector3(14.5, 0, 1.2), 3)
	Props.barrels(self, Vector3(-13.8, 0, 4.2))
	Props.barrels(self, Vector3(5.6, 0, 5.2))
	Props.container(self, Vector3(-19.0, 0, -4.0), 70, Color("6a3f2a"))
	Props.container(self, Vector3(18.5, 0, -1.0), -80, Color("2f5d5a"))
	Props.container(self, Vector3(17.6, 2.0, -1.4), -60, Color("7b4a5e"))
	Props.giant_head(self, Vector3(-9.0, 0, -7.6))
	Props.fence(self, Vector3(-22, 0, -8.6), Vector3(-9, 0, -9.4))
	Props.fence(self, Vector3(10, 0, -9.2), Vector3(22, 0, -8.4))
	for p in [Vector3(-6.5, 0, -1.6), Vector3(0.8, 0, -1.4), Vector3(6.4, 0, -0.4), Vector3(12.0, 0, 0.0), Vector3(-15.5, 0, -1.8)]:
		_lamps.append(Props.lamp_post(self, p))
		_lamp_lights.append(Kit.light(self, Kit.LAMP, p + Vector3(0.6, 3.2, 0.3), 0.0, 6.0))


func _build_cables() -> void:
	_cable_mat = Kit.own_mat(Kit.CHARCOAL, Color("4fb3c9"), 0.0)
	var r := REACTOR_POS + Vector3(0, 0.08, 0)
	for to in [TABLE_POS + Vector3(1.6, 0.08, -0.4), BAY_POS + Vector3(-1.4, 0.08, 0), Vector3(ARK_POS.x - 1.0, 0.08, ARK_POS.z + 2.6)]:
		var mid := Vector3(to.x, 0.08, r.z)
		for seg in [[r, mid], [mid, to]]:
			if seg[0].distance_to(seg[1]) > 0.1:
				_cables.append(Kit.beam(self, seg[0], seg[1], 0.1, _cable_mat))


func _build_player() -> void:
	_player = Node3D.new()
	_player.position = Vector3(-7.3, 0, 2.9)
	_player.rotation_degrees.y = -70
	_player.scale = Vector3.ONE * 1.25
	add_child(_player)
	Kit.cyl(_player, 0.26, 0.38, 1.1, Color("3a2d4a"), Vector3(0, 0.55, 0), Vector3.ZERO, 8)
	Kit.cyl(_player, 0.27, 0.27, 0.14, Color("e2733d"), Vector3(0, 1.12, 0), Vector3.ZERO, 8)
	Kit.box(_player, Vector3(0.12, 0.4, 0.06), Color("e2733d"), Vector3(0.12, 0.92, 0.27))
	Kit.ball(_player, 0.27, Color("4a3a5c"), Vector3(0, 1.4, 0), 10)
	Kit.ball(_player, 0.17, Color("20182c"), Vector3(0, 1.38, 0.14), 8)
	Kit.ball(_player, 0.03, Kit.glow(Kit.LAMP, 3.0), Vector3(0.06, 1.42, 0.3), 4)
	_player_arm = Node3D.new()
	_player_arm.position = Vector3(0.28, 1.0, 0)
	_player.add_child(_player_arm)
	Kit.box(_player_arm, Vector3(0.12, 0.45, 0.12), Color("3a2d4a"), Vector3(0, -0.2, 0))
	Kit.box(_player_arm, Vector3(0.05, 0.05, 1.3), Color("8a7a6a"), Vector3(0, -0.4, 0.45))
	Kit.box(_player_arm, Vector3(0.3, 0.04, 0.32), Color("a0a6ad"), Vector3(0, -0.4, 1.15), Vector3(25, 0, 0))
	var a := Interactable.new()
	_player.add_child(a)
	a.setup(_player, Vector3(1.0, 1.8, 1.0), Vector3(0, 0.9, 0), 0.6, "Это ты", "Последний механик свалки", Kit.ROLE_COLORS.idle)
	a.enabled = false


func _build_crane() -> void:
	var c := Node3D.new()
	c.position = Vector3(-13.6, 0, -3.6)
	add_child(c)
	Kit.box(c, Vector3(1.6, 0.5, 1.6), Kit.CHARCOAL, Vector3(0, 0.25, 0))
	for k in 5:
		Kit.box(c, Vector3(0.9, 0.08, 0.9), Kit.LAMP.darkened(0.35), Vector3(0, 1.3 * (k + 1), 0))
	for corner in [Vector3(-0.4, 0, -0.4), Vector3(0.4, 0, -0.4), Vector3(-0.4, 0, 0.4), Vector3(0.4, 0, 0.4)]:
		Kit.box(c, Vector3(0.1, 6.8, 0.1), Kit.LAMP.darkened(0.35), corner + Vector3(0, 3.4, 0))
	_crane_jib = Node3D.new()
	_crane_jib.position = Vector3(0, 6.9, 0)
	c.add_child(_crane_jib)
	Kit.box(_crane_jib, Vector3(1.0, 0.6, 1.0), Kit.RUST, Vector3(0, 0.2, 0))
	Kit.box(_crane_jib, Vector3(5.6, 0.3, 0.4), Kit.LAMP.darkened(0.25), Vector3(2.4, 0.3, 0))
	Kit.box(_crane_jib, Vector3(1.6, 0.3, 0.4), Kit.LAMP.darkened(0.25), Vector3(-1.0, 0.3, 0))
	Kit.box(_crane_jib, Vector3(0.7, 0.7, 0.7), Kit.CHARCOAL, Vector3(-1.6, 0.0, 0))
	_magnet = Node3D.new()
	_magnet.position = Vector3(3.9, 0, 0)
	_crane_jib.add_child(_magnet)
	Kit.box(_magnet, Vector3(0.04, 3.0, 0.04), Kit.CHARCOAL, Vector3(0, -1.5, 0))
	_magnet_mat = Kit.own_mat(Kit.METAL_DARK, Kit.CORE, 0.0)
	Kit.place(_magnet, Kit.cyl_mesh(0.6, 0.6, 0.3, 12), _magnet_mat, Vector3(0, -3.1, 0))
	var lump := Kit.box(_magnet, Vector3(0.5, 0.3, 0.4), Kit.RUST, Vector3(0, -3.4, 0), Vector3(10, 30, 0))
	lump.name = "Lump"


func _build_dispatch() -> void:
	_dispatch = Node3D.new()
	_dispatch.position = Vector3(5.9, 0, -2.9)
	add_child(_dispatch)
	Kit.box(_dispatch, Vector3(1.2, 2.6, 1.2), Color("4a3b58"), Vector3(0, 1.3, 0))
	Kit.box(_dispatch, Vector3(1.5, 0.12, 1.5), Kit.CHARCOAL, Vector3(0, 2.66, 0))
	Kit.box(_dispatch, Vector3(1.0, 0.4, 0.05), Kit.glow(Color("ffd38a"), 2.0), Vector3(0, 2.0, 0.61))
	_beacon = Node3D.new()
	_beacon.position = Vector3(0, 2.95, 0)
	_dispatch.add_child(_beacon)
	Kit.cyl(_beacon, 0.18, 0.22, 0.4, Kit.glow(Kit.EMBER, 3.0), Vector3.ZERO, Vector3.ZERO, 8)
	Kit.box(_beacon, Vector3(0.05, 0.3, 0.6), Kit.CHARCOAL, Vector3(0, 0, 0.0))
	Kit.light(_beacon, Kit.EMBER, Vector3(0, 0.3, 0), 0.8, 4.0)


func _build_drone() -> void:
	_drone = Node3D.new()
	add_child(_drone)
	Kit.box(_drone, Vector3(0.5, 0.18, 0.5), Kit.METAL_LIGHT, Vector3.ZERO)
	Kit.ball(_drone, 0.09, Kit.glow(Kit.CORE, 4.0), Vector3(0, -0.12, 0.2), 6)
	for corner in [Vector3(-0.4, 0, -0.4), Vector3(0.4, 0, -0.4), Vector3(-0.4, 0, 0.4), Vector3(0.4, 0, 0.4)]:
		Kit.beam(_drone, Vector3.ZERO, corner, 0.06, Kit.METAL_DARK)
		var rot := Node3D.new()
		rot.position = corner + Vector3(0, 0.08, 0)
		_drone.add_child(rot)
		Kit.box(rot, Vector3(0.5, 0.02, 0.06), Kit.CHARCOAL, Vector3.ZERO)
		_drone_rotors.append(rot)
	_drone.position = Vector3(-2, 4, 0)
	_drone.set_meta("burst", Fx.burst(_drone, Vector3(0, -0.2, 0), Kit.CORE, 8, 2.0, 0.08))


func _build_events() -> void:
	_crate = Node3D.new()
	add_child(_crate)
	var body := Node3D.new()
	_crate.add_child(body)
	Kit.box(body, Vector3(0.9, 0.6, 0.7), Color("6a4f2a"), Vector3(0, 0.3, 0), Vector3(0, 15, 0))
	Kit.box(body, Vector3(0.95, 0.1, 0.75), Kit.glow(Kit.LAMP, 3.0), Vector3(0, 0.62, 0), Vector3(0, 15, 0))
	var beam_mat := StandardMaterial3D.new()
	beam_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	beam_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	beam_mat.albedo_color = Color(1.0, 0.85, 0.4, 0.10)
	beam_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_crate_beam = Kit.place(_crate, Kit.cyl_mesh(0.25, 0.5, 8.0, 10), beam_mat, Vector3(0, 4.3, 0), Vector3.ZERO, false)
	Kit.light(_crate, Kit.LAMP, Vector3(0, 1.0, 0.3), 1.5, 4.0)
	_crate_area = Interactable.new()
	_crate.add_child(_crate_area)
	_crate_area.setup(body, Vector3(1.4, 1.4, 1.4), Vector3(0, 0.6, 0), 0.9, "Находка", "Клик — подобрать", Kit.LAMP)
	_crate_area.activated.connect(func(): Game.collect_salvage())
	_crate.visible = false
	_wreck = Node3D.new()
	_wreck.position = WRECK_POS
	add_child(_wreck)
	var w := Node3D.new()
	w.rotation_degrees = Vector3(0, -30, 80)
	w.position = Vector3(0, 0.3, 0)
	_wreck.add_child(w)
	Kit.box(w, Vector3(0.48, 0.38, 0.34), Kit.METAL.darkened(0.3), Vector3(0, 0.3, 0))
	Kit.box(w, Vector3(0.36, 0.26, 0.3), Kit.METAL_LIGHT.darkened(0.3), Vector3(0, 0.66, 0), Vector3(0, 0, 20))
	Kit.box(w, Vector3(0.12, 0.32, 0.14), Kit.METAL_DARK, Vector3(0.12, 0.0, 0.1), Vector3(40, 0, 0))
	_wreck_eye = Kit.own_mat(Kit.ROLE_COLORS.idle, Color("ff8f6b"), 3.0)
	Kit.place(w, Kit.sphere_mesh(0.065, 8, 4), _wreck_eye, Vector3(0.06, 0.68, 0.15), Vector3.ZERO, false)
	_wreck_area = Interactable.new()
	_wreck.add_child(_wreck_area)
	_wreck_area.setup(w, Vector3(1.4, 1.2, 1.4), Vector3(0, 0.5, 0), 0.9, "Брошенный робот", "Клик — забрать в ремонт (бесплатно)", Kit.VERDIGRIS)
	_wreck_area.activated.connect(func(): Game.recruit_wreck())
	_wreck.visible = false


# ── showing the state ──

func _on_replaced() -> void:
	_s = Game.s
	crew.clear()
	for f in _floaters:
		f.node.queue_free()
	_floaters.clear()
	ark.show_stage(_s.stage, ReconstructionManager.unlocked(_s), _s.launched)
	_refresh()


func _refresh() -> void:
	_s = Game.s
	var s := _s
	for zone in piles:
		var p: ScrapPile = piles[zone]
		p.set_open(zone in s.zones)
		p.set_amount(s.scrap if zone == "yard" else s.scrap * 0.5)
	conveyor.set_level(s.lvl("belt"))
	conveyor.running = s.robots.digger > 0 or s.robots.sorter > 0
	table.show_props(s)
	bay.show_props(s)
	var progress: float = s.repair.progress / s.repair.need if not s.repair.is_empty() else -1.0
	bay.show_repair(progress, not s.repair.is_empty() and s.repair.free)
	bay.set_welding(not s.repair.is_empty() and (s.robots.mechanic > 0 or s.lvl("factory") > 0))
	reactor.show_state(s)
	if not ark.launching():
		ark.show_stage(s.stage, ReconstructionManager.unlocked(s), s.launched)
	crew.sync(s.robots, BAY_POS)
	crew.set_eye_power(s.lvl("neuro") * 1.2)
	var powered := s.stage >= 2
	for i in _lamps.size():
		_lamps[i].emission_energy_multiplier = 3.0 if powered else 0.0
		_lamp_lights[i].light_energy = 1.4 if powered else 0.0
	_magnet.visible = s.lvl("magnet") > 0
	_dispatch.visible = s.lvl("dispatch") > 0
	_drone.visible = s.lvl("drone") > 0
	_crate.visible = s.ev.salvage_left > 0.0
	_wreck.visible = s.ev.wreck
	_dawn = clampf((s.stage + minf(s.built, 40) / 40.0) / 8.0, 0.0, 1.0)


func _process(delta: float) -> void:
	_t += delta
	if _s == null:
		return
	_sky_mat.set_shader_parameter("dawn", _dawn)
	_swing = maxf(0.0, _swing - delta * 4.0)
	_player_arm.rotation.x = -0.4 - sin((1.0 - _swing) * PI) * 1.4 if _swing > 0.0 else lerpf(_player_arm.rotation.x, -0.2 + sin(_t) * 0.05, 0.1)
	# crane: swings between the pile and the conveyor when the magnet is fitted
	if _magnet.visible:
		_crane_jib.rotation.y = sin(_t * 0.35) * 0.6 - 0.2
		_magnet_mat.emission_energy_multiplier = 1.5 + sin(_t * 3.0) * 0.5
		_magnet.get_node("Lump").visible = sin(_t * 0.35) > 0.0
	else:
		_crane_jib.rotation.y = -0.6
	if _dispatch.visible:
		_beacon.rotation.y = _t * 3.0
	var shortage := _s.shortage_active()
	var cable_e := 0.0
	if _s.stage >= 2:
		cable_e = 0.9 + sin(_t * 4.0) * 0.2
		if shortage:
			cable_e = 1.4 if fmod(_t, 0.7) < 0.1 else 0.1
	_cable_mat.emission_energy_multiplier = cable_e
	if _drone.visible:
		var target := _drone_target()
		_drone.position = _drone.position.lerp(target + Vector3(sin(_t * 1.3) * 0.4, 3.0 + sin(_t * 2.1) * 0.2, cos(_t * 1.1) * 0.3), minf(1.0, delta * 1.5))
		for r in _drone_rotors:
			r.rotation.y += delta * 40.0
	if _crate.visible:
		_crate.get_child(0).position.y = 0.1 + absf(sin(_t * 2.5)) * 0.15
		_crate_beam.scale = Vector3.ONE * (1.0 + sin(_t * 4.0) * 0.08)
	if _wreck.visible:
		_wreck_eye.emission_energy_multiplier = 3.0 if fmod(_t, 1.3) < 0.3 else 0.2
	for f in _floaters.duplicate():
		f.t += delta
		f.node.position = f.from + Vector3(0, f.t * 1.4, 0)
		f.node.modulate.a = clampf(1.4 - f.t, 0.0, 1.0)
		f.node.outline_modulate.a = f.node.modulate.a * 0.85
		if f.t > 1.4:
			f.node.queue_free()
			_floaters.erase(f)
	_shake = maxf(0.0, _shake - delta * 1.5)
	camera.position = _cam_base + Vector3(sin(_t * 0.17) * 0.12, 0, 0) \
		+ Vector3(randf_range(-1, 1), randf_range(-1, 1), 0) * _shake * 0.25
	_crate_area.enabled = _crate.visible
	_wreck_area.enabled = _wreck.visible


func _drone_target() -> Vector3:
	match _s.drone_task:
		"sort": return TABLE_POS
		"repair": return BAY_POS
	return PILE_POS.yard + Vector3(1.5, 0, 1.0)


## Keeps the scrapyard framed for any viewport shape: at least 34 units wide and 15 tall.
func fit_camera(size: Vector2) -> void:
	if size.y <= 0.0:
		return
	var aspect := size.x / size.y
	camera.keep_aspect = Camera3D.KEEP_HEIGHT
	camera.size = maxf(15.5, 34.0 / aspect)
	# extra height goes to the sky: the front edge of the yard stays at the bottom
	_cam_base = CAM_CENTER + camera.basis.z * 45.0 + camera.basis.y * (camera.size / 2.0 - 7.75)
	camera.position = _cam_base
	# the backdrop fills the view; its horizon sits where the ground ends
	_backdrop.scale = Vector3(camera.size * aspect * 1.1, camera.size * 1.1, 1)
	var local := camera.global_transform.affine_inverse() * Vector3(0, 0, HORIZON_Z)
	_sky_mat.set_shader_parameter("horizon", 0.5 + local.y / (camera.size * 1.1))
	_sky_mat.set_shader_parameter("aspect", aspect)


# ── events from the rules ──

func _on_acted(kind: String, amount: float, info: Dictionary) -> void:
	match kind:
		"dig":
			_swing = 1.0
			piles.yard.dig_fx()
			floater(piles.yard.top(), "+%s" % Fmt.num(amount), Kit.ROLE_COLORS.digger)
		"sort":
			if amount <= 0.0:
				floater(TABLE_POS + Vector3(0, 2.2, 0), tr("мало хлама"), Color("a698b1"))
			else:
				table.pop()
				floater(TABLE_POS + Vector3(0, 2.2, 0), tr("+{n} дет.").format({n = Fmt.num(amount), pl = Fmt.plural(int(amount), "деталь|детали|деталей")}), Kit.VERDIGRIS)
				if info.get("core", false):
					floater(TABLE_POS + Vector3(0, 3.0, 0), tr("+ядро"), Kit.CORE)
		"repair":
			if amount <= 0.0:
				floater(BAY_POS + Vector3(0, 4.6, 0), tr("нужно {n} дет.").format({n = Fmt.num(info.get("cost", 0)), pl = Fmt.plural(int(info.get("cost", 0)), "деталь|детали|деталей")}), Color("a698b1"))
			else:
				bay.hit_fx()
				if info.get("finished", false):
					floater(BAY_POS + Vector3(0, 4.6, 0), tr("робот готов!"), Kit.LAMP)


func _on_event(e: Dictionary) -> void:
	match e.type:
		"stage_built":
			_shake = 1.0
			if e.index == GameData.stages().size() - 1:
				_shake = 2.5
				ark.launch()
		"salvage_spawn":
			var i := int(_s.time) % SALVAGE_SPOTS.size()
			_crate.position = SALVAGE_SPOTS[i]
		"salvage_taken":
			var rw: Dictionary = e.reward
			floater(_crate.position + Vector3(0, 1.5, 0), "+%s / +%s" % [Fmt.num(rw.scrap), Fmt.num(rw.parts)], Kit.LAMP)
		"drone":
			_drone.get_meta("burst").restart()
		"robot_built":
			pass
	_refresh()


func on_chunk_dropped(_at: Vector3) -> void:
	conveyor.drop_chunk()


func floater(at: Vector3, text: String, color: Color) -> void:
	var l := Kit.label(self, text, at, color, 56)
	_floaters.append({node = l, t = 0.0, from = at + Vector3(randf_range(-0.3, 0.3), 0, 0)})


# ── places for the robots (WorkerRobot asks) ──

func _open_piles() -> Array:
	return _s.zones.filter(func(z): return piles.has(z))


func _pile_for(r: WorkerRobot) -> String:
	var open := _open_piles()
	return open[int(r.slot * 1000.0) % open.size()]


func pile_center(r: WorkerRobot) -> Vector3:
	return PILE_POS[_pile_for(r)]


func pile_spot(r: WorkerRobot) -> Vector3:
	var zone := _pile_for(r)
	var a := deg_to_rad(20.0 + r.slot * 140.0)
	return PILE_POS[zone] + Vector3(cos(a), 0, sin(a)) * (PILE_R[zone] + 0.4)


func drop_spot(r: WorkerRobot) -> Vector3:
	return CONVEYOR_START + Vector3(0.3 + r.slot * 0.6, 0, 0.9)


func station_center() -> Vector3:
	return TABLE_POS


func station_spot(r: WorkerRobot) -> Vector3:
	return TABLE_POS + Vector3(-1.1 + r.slot * 2.2, 0, -1.15)


func bay_center() -> Vector3:
	return BAY_POS


func bay_spot(r: WorkerRobot) -> Vector3:
	var a := deg_to_rad(-30.0 + r.slot * 240.0)
	return BAY_POS + Vector3(cos(a) * 2.1, 0, sin(a) * 1.7)


func wander_spot() -> Vector3:
	return Vector3(randf_range(-4.5, 1.5), 0, randf_range(3.6, 5.2))


func counter_spot(role: String) -> Vector3:
	match role:
		"digger": return PILE_POS.yard + Vector3(0, 3.6, 0)
		"sorter": return TABLE_POS + Vector3(0, 3.0, -1.2)
		"mechanic": return BAY_POS + Vector3(0, 5.0, 0)
	return Vector3(-1.5, 2.0, 4.4)


func sorting_active() -> bool:
	return _s != null and _s.robots.sorter > 0 and not ProductionManager.rates(_s).sorter_starved


func repair_active() -> bool:
	return _s != null and not _s.repair.is_empty()


func work_speed(role: String) -> float:
	if _s == null:
		return 1.0
	var d := ProductionManager.derived(_s)
	match role:
		"digger": return clampf(d.digger, 0.6, 3.0)
		"sorter": return clampf(d.sorter * 2.0, 0.6, 3.0)
		"mechanic": return clampf(d.mechanic * 2.0, 0.6, 3.0)
	return 1.0


func walk_mult() -> float:
	return 0.6 if _s != null and _s.shortage_active() else 1.0
