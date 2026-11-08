class_name WinterFx
extends Node2D
## Effects in the world: one-shot bursts from a small pool of CPUParticles2D (wood chips, stone chips, snow puffs,
## smoke, blood-free hits), the fire's steady sparks and smoke, frosty breath, boot prints that fade, tap marks and
## floating numbers. Everything is pooled and capped, nothing runs when it isn't needed.

const TILE := 96.0
const POOL := 14
const STEPS := 80

var details: Node2D               # the ground-details layer: boot prints and tap marks go there
var _pool: Array[CPUParticles2D] = []
var _next := 0
var sparks: CPUParticles2D
var smoke: CPUParticles2D
var embers: CPUParticles2D
var chimney: CPUParticles2D
var breath: CPUParticles2D
var _steps: Array[Sprite2D] = []
var _step_i := 0
var _step_acc := 0.0
var _step_side := 1
var _last_hero := Vector2.INF
var _floats: Array = []
var _font: Font


func _init(details_layer: Node2D) -> void:
	details = details_layer
	z_index = 10
	_font = load("res://assets/fonts/GolosText.ttf")
	for k in POOL:
		var p := CPUParticles2D.new()
		p.emitting = false
		p.one_shot = true
		p.explosiveness = 0.95
		p.local_coords = false
		add_child(p)
		_pool.append(p)
	sparks = _emitter("fx.spark", 26, 1.2, Color("ffc861"), true)
	sparks.direction = Vector2(0, -1)
	sparks.spread = 22.0
	sparks.gravity = Vector2(0, -60)
	sparks.initial_velocity_min = 60.0
	sparks.initial_velocity_max = 150.0
	sparks.scale_amount_min = 0.25
	sparks.scale_amount_max = 0.6
	sparks.emission_shape = CPUParticles2D.EMISSION_SHAPE_SPHERE
	sparks.emission_sphere_radius = 14.0
	embers = _emitter("fx.ember", 10, 2.4, Color("ff6a1a"), true)
	embers.direction = Vector2(0, -1)
	embers.spread = 60.0
	embers.gravity = Vector2(0, -12)
	embers.initial_velocity_min = 4.0
	embers.initial_velocity_max = 20.0
	embers.scale_amount_min = 0.15
	embers.scale_amount_max = 0.35
	embers.emission_shape = CPUParticles2D.EMISSION_SHAPE_SPHERE
	embers.emission_sphere_radius = 22.0
	smoke = _emitter("fx.smoke.0", 14, 3.2, Color(0.62, 0.64, 0.7, 0.42), false)
	smoke.direction = Vector2(0.2, -1)
	smoke.spread = 14.0
	smoke.gravity = Vector2(10, -18)
	smoke.initial_velocity_min = 30.0
	smoke.initial_velocity_max = 55.0
	smoke.scale_amount_min = 0.35
	smoke.scale_amount_max = 0.6
	smoke.scale_amount_curve = _grow_curve()
	smoke.color_ramp = _fade_ramp(Color(0.62, 0.64, 0.7, 0.45))
	chimney = smoke.duplicate()
	add_child(chimney)
	chimney.emitting = false
	breath = _emitter("fx.breath", 4, 1.1, Color(0.95, 0.97, 1.0, 0.5), false)
	breath.direction = Vector2(0, -1)
	breath.spread = 25.0
	breath.gravity = Vector2(0, -10)
	breath.initial_velocity_min = 10.0
	breath.initial_velocity_max = 22.0
	breath.scale_amount_min = 0.25
	breath.scale_amount_max = 0.4
	breath.scale_amount_curve = _grow_curve()
	breath.color_ramp = _fade_ramp(Color(0.95, 0.97, 1.0, 0.5))
	breath.emitting = false
	for k in STEPS:
		var s := Sprite2D.new()
		s.visible = false
		details.add_child(s)
		_steps.append(s)


func _emitter(key: String, amount: int, life: float, color: Color, glow: bool) -> CPUParticles2D:
	var p := CPUParticles2D.new()
	p.texture = WinterArt.texture(key, false)
	p.amount = amount
	p.lifetime = life
	p.local_coords = false
	p.color = color
	if glow:
		var m := CanvasItemMaterial.new()
		m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		m.light_mode = CanvasItemMaterial.LIGHT_MODE_UNSHADED
		p.material = m
		p.color_ramp = _fade_ramp(color)
	add_child(p)
	return p


func _grow_curve() -> Curve:
	var c := Curve.new()
	c.add_point(Vector2(0, 0.4))
	c.add_point(Vector2(1, 1.6))
	return c


func _fade_ramp(c: Color) -> Gradient:
	var g := Gradient.new()
	g.set_color(0, Color(c.r, c.g, c.b, 0.0))
	g.add_point(0.12, c)
	g.set_color(g.get_point_count() - 1, Color(c.r, c.g, c.b, 0.0))
	return g


## A one-shot burst at a world point (pixels).
func burst(at: Vector2, kind: String, n := 10) -> void:
	var p := _pool[_next]
	_next = (_next + 1) % POOL
	var key = {"wood": "fx.chip.wood", "stone": "fx.chip.stone", "snow": "fx.snowflake.0", "smoke": "fx.smoke.1", "spark": "fx.spark", "metal": "fx.chip.stone", "berry": "fx.ember"}.get(kind, "fx.snowflake.1")
	p.texture = WinterArt.texture(key, false)
	p.position = at
	p.amount = n
	p.lifetime = 0.7 if kind != "smoke" else 1.4
	p.direction = Vector2(0, -1)
	p.spread = 70.0 if kind != "smoke" else 30.0
	p.gravity = Vector2(0, 520) if kind in ["wood", "stone", "metal", "berry"] else Vector2(0, 40) if kind == "snow" else Vector2(0, -30)
	p.initial_velocity_min = 90.0 if kind != "smoke" else 20.0
	p.initial_velocity_max = 210.0 if kind != "smoke" else 50.0
	p.angular_velocity_min = -300.0
	p.angular_velocity_max = 300.0
	p.scale_amount_min = 0.35
	p.scale_amount_max = 0.8
	p.color = {"berry": Color("d23a4a"), "metal": Color("a5552f"), "smoke": Color(0.85, 0.87, 0.92, 0.6)}.get(kind, Color.WHITE)
	p.color_ramp = _fade_ramp(p.color)
	p.restart()
	p.emitting = true


func float_text(at: Vector2, text: String, color: Color) -> void:
	_floats.append({"p": at, "t": 0.0, "text": text, "color": color})
	queue_redraw()


## Every frame: the fire's emitters follow its state, breath in the cold, boot prints, floating texts.
func animate(g: Dictionary, delta: float, hero: Node2D, cold: float) -> void:
	var sp: Dictionary = WinterSim.SPOT
	var fire := Vector2((sp.fire.x + 0.5) * TILE, (sp.fire.y + 0.45) * TILE)
	var fuel := float(g.fire.fuel)
	sparks.position = fire
	embers.position = fire + Vector2(0, 14)
	sparks.emitting = fuel > 0.0
	embers.emitting = fuel > 0.0
	smoke.position = fire + Vector2(0, -60 if fuel > 0.0 else -10)
	smoke.emitting = true
	var stove := int(g.hut.stage) >= 4 and float(g.hut.stove) > 0.0
	chimney.emitting = stove
	chimney.position = Vector2((WinterSim.HUT.x + 2.3) * TILE, (WinterSim.HUT.y - 0.9) * TILE)
	if hero:
		# breath: a puff now and then when it's freezing and he isn't sleeping
		breath.position = hero.position + Vector2(10 if hero.get_child_count() else 0, -112)
		breath.emitting = cold > 0.25 and not g.hero.sleeping and g.status == "playing"
		_footsteps(g, hero.position, delta)
	for f in _floats:
		f.t += delta
	_floats = _floats.filter(func(f): return f.t < 1.2)
	queue_redraw()


func _footsteps(g: Dictionary, p: Vector2, _delta: float) -> void:
	if _last_hero == Vector2.INF or p.distance_to(_last_hero) > TILE:
		_last_hero = p
		return
	var d := p.distance_to(_last_hero)
	_step_acc += d
	var tile: String = g.tiles[clampi(int(p.y / TILE), 0, WinterSim.H - 1) * WinterSim.W + clampi(int(p.x / TILE), 0, WinterSim.W - 1)]
	if _step_acc > 30.0 and d > 0.1 and tile != "~":
		_step_acc = 0.0
		var a := (p - _last_hero).angle()
		_step_side = -_step_side
		var s := _steps[_step_i]
		_step_i = (_step_i + 1) % STEPS
		var key := "foot.boot.l" if _step_side < 0 else "foot.boot.r"
		s.texture = WinterArt.texture(key, false)
		s.position = p + Vector2(0, 4) + Vector2(-sin(a), cos(a)) * 8.0 * _step_side
		s.rotation = a + PI * 0.5
		s.modulate = Color(0.55, 0.62, 0.8, 0.55 if tile == ":" else 0.4)
		s.visible = true
		s.set_meta("born", Time.get_ticks_msec())
	_last_hero = p
	# prints fade over 40 s
	var now := Time.get_ticks_msec()
	for s in _steps:
		if s.visible:
			var age := (now - int(s.get_meta("born", now))) / 40000.0
			if age >= 1.0:
				s.visible = false
			else:
				s.modulate.a = (0.5) * (1.0 - age)


func clear() -> void:
	for s in _steps:
		s.visible = false
	_floats.clear()
	_last_hero = Vector2.INF


func _draw() -> void:
	for f in _floats:
		var k: float = f.t / 1.2
		var pos: Vector2 = f.p + Vector2(0, -50.0 * k - 20.0)
		var c: Color = f.color
		c.a = 1.0 - k * k
		draw_string_outline(_font, pos, f.text, HORIZONTAL_ALIGNMENT_CENTER, -1, 30, 8, Color(0.05, 0.07, 0.15, c.a * 0.8))
		draw_string(_font, pos, f.text, HORIZONTAL_ALIGNMENT_CENTER, -1, 30, c)
