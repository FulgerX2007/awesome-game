class_name WinterWorld
extends Node2D
## The world view: builds the layers (see docs/plans/20261108-winter-godot.md), follows the rules' state every
## frame and turns their events into effects. It never changes the state: main.gd owns the game and the input.
##   Ground (z −30) · GroundDetails (−20) · Shadows (−10) · Entities (y-sort: WorldObjects + Characters)
##   · Effects (+10) · Weather (+20) · Lights + CanvasModulate.

const TILE := 96.0
const VIEW_TILES := 12.5         # about this many tiles across the screen's shorter side

var ground: WinterGround
var details: Node2D
var shadows: Node2D
var entities: Node2D
var objects: Node2D
var characters: Node2D
var fx: WinterFx
var weather: WinterWeather
var lights: WinterLights
var props: WinterProps
var camp: WinterCamp
var actors: WinterActors
var camera: Camera2D
var atmosphere: CanvasLayer
var atmo_rect: ColorRect
var g: Dictionary = {}
var hurt := 0.0
var zoom_user := 1.0
var _sync_t := 0.0
var _marks: Array = []


func _ready() -> void:
	ground = WinterGround.new()
	add_child(ground)
	details = _layer("GroundDetails", -20)
	shadows = _layer("Shadows", -10)
	shadows.modulate = Color(1, 1, 1, 0.85)
	entities = _layer("Entities", 0)
	entities.y_sort_enabled = true
	objects = Node2D.new()
	objects.name = "WorldObjects"
	objects.y_sort_enabled = true
	entities.add_child(objects)
	characters = Node2D.new()
	characters.name = "Characters"
	characters.y_sort_enabled = true
	entities.add_child(characters)
	fx = WinterFx.new(details)
	fx.name = "Effects"
	add_child(fx)
	weather = WinterWeather.new()
	weather.name = "Weather"
	add_child(weather)
	lights = WinterLights.new()
	lights.name = "Lights"
	add_child(lights)
	props = WinterProps.new(objects, details, shadows)
	camp = WinterCamp.new(objects, details, shadows)
	actors = WinterActors.new(characters, fx)
	camera = Camera2D.new()
	camera.position_smoothing_enabled = true
	camera.position_smoothing_speed = 5.0
	add_child(camera)
	camera.make_current()
	atmosphere = CanvasLayer.new()
	atmosphere.layer = 1
	add_child(atmosphere)
	atmo_rect = ColorRect.new()
	atmo_rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	atmo_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/atmosphere.gdshader")
	var nt := NoiseTexture2D.new()
	nt.seamless = true
	nt.width = 256
	nt.height = 256
	nt.generate_mipmaps = true
	var fn := FastNoiseLite.new()
	fn.frequency = 0.02
	fn.fractal_octaves = 3
	nt.noise = fn
	mat.set_shader_parameter("noise", nt)
	atmo_rect.material = mat
	atmosphere.add_child(atmo_rect)


func _layer(n: String, z: int) -> Node2D:
	var l := Node2D.new()
	l.name = n
	l.z_index = z
	add_child(l)
	return l


## A new winter on screen (a new game or a loaded one).
func show_game(state: Dictionary) -> void:
	g = state
	props.clear()
	actors.clear()
	fx.clear()
	# everything standing is rebuilt; the pooled boot prints stay in the details layer
	for c in objects.get_children():
		c.queue_free()
	for c in shadows.get_children():
		c.queue_free()
	for c in details.get_children():
		if not fx._steps.has(c):
			c.queue_free()
	_marks.clear()
	ghost_free()
	camp = WinterCamp.new(objects, details, shadows)
	fx.camp = camp
	lights.camp = camp
	ground.build(g)
	props.build(g)
	camp.build(g)
	actors.sync(g, 0.0)
	var hero := actors.hero_node()
	_fit_camera()
	camera.position = hero.position if hero else Vector2(WinterSim.W, WinterSim.H) * TILE * 0.5
	camera.reset_smoothing()


func _fit_camera() -> void:
	var vp := get_viewport_rect().size
	var z := minf(vp.x, vp.y) / (VIEW_TILES * TILE) * zoom_user
	camera.zoom = Vector2(z, z)
	camera.limit_left = int(-1.5 * TILE)
	camera.limit_top = int(-1.5 * TILE)
	camera.limit_right = int((WinterSim.W + 1.5) * TILE)
	camera.limit_bottom = int((WinterSim.H + 1.5) * TILE)


## Every frame while a game is on screen. `running` is false while paused (the figures and the fire still breathe).
func frame(delta: float, running: bool) -> void:
	if g.is_empty():
		return
	_fit_camera()
	actors.sync(g, delta)
	var hero := actors.hero_node()
	if hero:
		camera.position = hero.position + Vector2(0, -40)
	camp.animate(g, delta)
	_sync_t -= delta
	if _sync_t <= 0.0:
		_sync_t = 0.15
		props.sync(g)
		camp.sync(g)
		ground.refresh(g)
	props.fade_near(float(g.hero.x), float(g.hero.y), bool(g.hero.sleeping))
	var temp := WinterSim.temperature(g)
	var cold := clampf(-temp / 25.0, 0.0, 1.0)
	fx.animate(g, delta, hero, cold)
	lights.update(g, hero, delta)
	var vp := get_viewport_rect().size / camera.zoom
	weather.update(g, camera.get_screen_center_position(), vp, delta)
	ground.set_weather(weather.wind, 1.0 - lights.night * 0.8)
	shadows.modulate.a = 0.85 * (1.0 - lights.night * 0.85) * (0.5 if weather.level == "blizzard" else 1.0)
	hurt = maxf(0.0, hurt - delta * 1.6)
	var mat := atmo_rect.material as ShaderMaterial
	var fog := 0.0
	if weather.level == "blizzard":
		fog = 0.62 + weather.gust * 0.3
	elif weather.level == "heavy":
		fog = 0.06 + weather.gust * 0.08
	mat.set_shader_parameter("fog", fog)
	mat.set_shader_parameter("wind", weather.wind)
	mat.set_shader_parameter("night", lights.night)
	mat.set_shader_parameter("frost", clampf((35.0 - float(g.hero.warmth)) / 35.0, 0.0, 1.0))
	mat.set_shader_parameter("hurt", hurt)
	mat.set_shader_parameter("aurora", WinterViewMath.aurora(g))
	var sz := get_viewport_rect().size
	mat.set_shader_parameter("aspect", Vector2(sz.x / sz.y, 1.0))
	for m in _marks:
		m.t += delta
		m.node.scale = Vector2.ONE * (0.6 + m.t * 1.4)
		m.node.modulate.a = 1.0 - m.t / 0.5
		if m.t >= 0.5:
			m.node.queue_free()
	_marks = _marks.filter(func(m): return m.t < 0.5)
	if not running:
		return


## The tile a screen tap means: the front-most figure or node whose sprite is under it, else the ground tile.
func tile_at_screen(sp: Vector2) -> Vector2i:
	var p := get_canvas_transform().affine_inverse() * sp
	var who := actors.pick(p, g)
	if not who.is_empty():
		var id: String = who.id
		var e := _entity(id)
		if not e.is_empty():
			return Vector2i(int(floor(float(e.x))), int(floor(float(e.y))))
	# a tree's crown or a rock above the tapped tile
	var best := Vector2i(int(floor(p.x / TILE)), int(floor(p.y / TILE)))
	var by := -INF
	for dy in range(0, 3):
		for dx in range(-1, 2):
			var tx := best.x + dx
			var ty := int(floor(p.y / TILE)) + dy
			var id = props.by_tile.get(ty * WinterSim.W + tx)
			if id == null:
				continue
			var v: Dictionary = props.views[id]
			if not v.standing.visible:
				continue
			var s: Sprite2D = v.standing
			var r := Rect2(v.root.position + s.get_rect().position, s.get_rect().size).grow(-8)
			if r.has_point(p) and v.root.position.y > by:
				by = v.root.position.y
				best = Vector2i(tx, ty)
	return best


func _entity(id: String) -> Dictionary:
	if id.begins_with("sv:"):
		for s in g.survivors:
			if "sv:" + String(s.id) == id:
				return s
	elif id.begins_with("an:"):
		for a in g.animals:
			if "an:%d" % int(a.id) == id:
				return a
	elif id.begins_with("wf:"):
		for w in g.wolves:
			if "wf:%d" % int(w.id) == id:
				return w
	elif id == "bear" and g.bear != null:
		return g.bear
	elif id == "trader" and g.trader != null:
		return {"x": float(g.trader.x) + 0.5, "y": float(g.trader.y) + 0.5}
	elif id == "wanderer" and g.event != null:
		return {"x": float(g.event.x) + 0.5, "y": float(g.event.y) + 0.5}
	return {}


func mark(tile: Vector2i) -> void:
	var s := Sprite2D.new()
	s.texture = WinterArt.texture("fx.glow", false)
	s.modulate = Color(1, 0.9, 0.6, 1)
	s.position = (Vector2(tile) + Vector2(0.5, 0.5)) * TILE
	s.scale = Vector2.ONE * 0.6
	details.add_child(s)
	_marks.append({"node": s, "t": 0.0})


## A rules event as an effect in the world.
func effect(e: Dictionary) -> void:
	match String(e.type):
		"gather":
			var at := Vector2((float(e.x) + 0.5) * TILE, (float(e.y) + 0.3) * TILE)
			var kind = {"tree": "wood", "rock": "stone", "bush": "berry", "scrap": "metal"}.get(e.kind, "snow")
			fx.burst(at, kind, 8)
			fx.burst(at + Vector2(0, -30), "snow", 6)
			var id := props.view_at(g, int(e.x), int(e.y))
			if id >= 0:
				props.hit(id)
			fx.float_text(at + Vector2(0, -40), "+%d" % int(e.n), {"wood": Color("e6c08a"), "stone": Color("c8ccd2"), "metal": Color("e7eef5")}.get(e.item, Color("ff7a7f")))
		"fish":
			fx.float_text(Vector2((float(e.x) + 0.5) * TILE, float(e.y) * TILE), "+1", Color("9fd0ff"))
		"hunt":
			fx.burst(Vector2(float(e.x) * TILE, float(e.y) * TILE), "snow", 12)
			fx.float_text(Vector2(float(e.x) * TILE, (float(e.y) - 0.6) * TILE), "+3" if e.kind == "deer" else "+1", Color("ff9a8a"))
		"hitWolf":
			actors.hurt_wolf(int(e.id))
			fx.burst(Vector2(float(e.x) * TILE, float(e.y) * TILE - 30), "snow", 8)
		"bearHit":
			actors.hurt_bear()
			fx.burst(Vector2(float(e.x) * TILE, float(e.y) * TILE - 40), "snow", 10)
		"feed":
			var sp: Dictionary = WinterSim.SPOT
			fx.burst(Vector2((sp.fire.x + 0.5) * TILE, (sp.fire.y + 0.3) * TILE), "spark", 14)
		"built", "upgraded", "patched":
			var hp := Vector2((WinterSim.HUT.x + 1.5) * TILE, (WinterSim.HUT.y + 2) * TILE)
			fx.burst(hp, "smoke", 10)
			actors.play_action("build", 1.0)
		"craft":
			actors.play_action("craft", 1.0)
		"bite":
			if e.who == "hero":
				hurt = 1.0
				actors.hero_hurt = 0.35
		"dig":
			fx.burst(Vector2((float(e.x) + 0.5) * TILE, (float(e.y) + 0.5) * TILE), "snow", 16)
		"torch":
			fx.burst(Vector2((float(e.x) + 0.5) * TILE, (float(e.y) + 0.5) * TILE - 80), "spark", 10)
		"wolfDead":
			fx.float_text(Vector2(float(e.x) * TILE, (float(e.y) - 0.5) * TILE), tr("Волк убит"), Color("cfe0ff"))
		"smoked":
			fx.float_text(Vector2((WinterSim.SPOT.smokehouse.x + 0.5) * TILE, (WinterSim.SPOT.smokehouse.y - 0.6) * TILE), "+1", Color("c9a46a"))
		"snareCaught":
			fx.float_text(Vector2((float(e.x) + 0.5) * TILE, float(e.y) * TILE), tr("+1 мясо в силках"), Color("ff9a8a"))
		"bearDead":
			fx.float_text(Vector2(float(e.x) * TILE, (float(e.y) - 0.6) * TILE), "+%d / +%d" % [int(e.meat), int(e.hide)], Color("ff9a8a"))


func ghost_free() -> void:
	if camp:
		camp.ghosts.clear()
