class_name DeepSea
extends Node
## Draws the ocean. Everything is placed in screen space every frame, like the canvas version:
## the world can be tens of thousands of units wide, too much for 32-bit node transforms.
## Creatures are sprites baked from web/deep/models.js (tools/deep-godot/bake.cjs) and bent by a
## shader as they swim. The deep zones are real 2D lighting: the zone darkens the scene
## (CanvasModulate), the player carries a light, and glowing creatures and vents shine on their own.

const Core := preload("res://scripts/core.gd")
const BODY_SHADER := preload("res://shaders/creature.gdshader")
const GLOW_SHADER := preload("res://shaders/creature_glow.gdshader")
const WATER_SHADER := preload("res://shaders/water.gdshader")
const OVERLAY_SHADER := preload("res://shaders/overlay.gdshader")

# Water colour by zone: [top, bottom] of the screen (the same table as game.js).
const WATER := [
	[Color8(22, 92, 104), Color8(8, 44, 66)], [Color8(8, 48, 92), Color8(3, 20, 48)], [Color8(3, 12, 30), Color8(1, 5, 14)],
	[Color8(1, 4, 12), Color8(1, 2, 6)], [Color8(3, 2, 10), Color8(1, 1, 4)], [Color8(3, 2, 10), Color8(1, 1, 4)],
]
const ARMS := ["squid", "giantsquid", "colossal", "vampire", "kraken", "dumbo", "gulper"]
const JELLIES := ["moonjelly", "combjelly", "atolla", "siphonophore"]
const MAX_GLOW_LIGHTS := 6

var meta: Dictionary          # creatures.json: how each sprite was baked
var tex := {}                 # species id -> {body, glow}
var views := {}               # entity id (or -1 for the player) -> View
var reduce_motion := false

var _water: ColorRect
var _overlay: ColorRect
var _modulate: CanvasModulate
var _world: Node2D
var _creatures: Node2D
var _floor: Node2D
var _sparks: Node2D
var _player_light: PointLight2D
var _glow_lights: Array[PointLight2D] = []
var _vent_lights: Array[PointLight2D] = []
var _halo_tex: Texture2D
var _light_tex: Texture2D
var _parts: Array = []        # eat bursts: {x, y, vx, vy, t, life, s, c} in world units
var _vents: Array = []        # vents on screen this frame
var _ground := PackedVector2Array()


class View:
	var root: Node2D
	var pose: Node2D
	var body: Sprite2D
	var glow: Sprite2D
	var halo: Sprite2D
	var mat: ShaderMaterial
	var gmat: ShaderMaterial
	var sp := ""
	var used := false


func _ready() -> void:
	meta = JSON.parse_string(FileAccess.get_file_as_string("res://data/creatures.json"))
	_halo_tex = _radial(128, 0.0)
	_light_tex = _radial(256, 0.22)

	var back := CanvasLayer.new()
	back.layer = -10
	add_child(back)
	_water = ColorRect.new()
	_water.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_water.material = ShaderMaterial.new()
	_water.material.shader = WATER_SHADER
	back.add_child(_water)

	_world = Node2D.new()
	add_child(_world)
	_modulate = CanvasModulate.new()
	_world.add_child(_modulate)
	_creatures = Node2D.new()
	_world.add_child(_creatures)
	_floor = Node2D.new()
	_floor.z_index = 3500
	_floor.draw.connect(_draw_floor)
	_world.add_child(_floor)
	_sparks = Node2D.new()
	_sparks.z_index = 3600
	_sparks.material = _unshaded()
	_sparks.draw.connect(_draw_sparks)
	_world.add_child(_sparks)

	_player_light = _light(Color(1, 0.97, 0.9))
	for i in MAX_GLOW_LIGHTS:
		_glow_lights.append(_light(Color(0.45, 0.75, 1.0)))
	for i in 4:
		_vent_lights.append(_light(Color(1.0, 0.5, 0.18)))

	# Bloom: glowing creatures, lures and vents bleed soft light into the dark water.
	get_viewport().use_hdr_2d = true
	var env := Environment.new()
	env.background_mode = Environment.BG_CANVAS
	env.glow_enabled = true
	env.glow_intensity = 1.6
	env.glow_strength = 1.1
	env.glow_bloom = 0.0
	env.glow_hdr_threshold = 0.75
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	for i in 7:
		env.set_glow_level(i, i in [1, 2, 3, 4])
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	var top := CanvasLayer.new()
	top.layer = 5
	add_child(top)
	_overlay = ColorRect.new()
	_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_overlay.material = ShaderMaterial.new()
	_overlay.material.shader = OVERLAY_SHADER
	top.add_child(_overlay)


func _light(c: Color) -> PointLight2D:
	var l := PointLight2D.new()
	l.texture = _light_tex
	l.color = c
	l.enabled = false
	_world.add_child(l)
	return l


func _unshaded() -> CanvasItemMaterial:
	var m := CanvasItemMaterial.new()
	m.light_mode = CanvasItemMaterial.LIGHT_MODE_UNSHADED
	m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	return m


## A soft round spot: full inside `core` (0..1 of the radius), fading to nothing at the edge.
func _radial(size: int, core: float) -> Texture2D:
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	if core > 0:
		g.add_point(core, Color(1, 1, 1, 1))
	var t := GradientTexture2D.new()
	t.gradient = g
	t.width = size
	t.height = size
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	return t


## Sprite textures with mipmaps, so a whale far out on a zoomed-out screen stays smooth.
func textures(sp: String) -> Dictionary:
	if tex.has(sp):
		return tex[sp]
	var t := {body = _mip("res://assets/creatures/%s.png" % sp), glow = null}
	if meta[sp].glow:
		t.glow = _mip("res://assets/creatures/%s.glow.png" % sp)
	tex[sp] = t
	return t


func _mip(path: String) -> Texture2D:
	var img: Image = load(path).get_image()
	if img.is_compressed():
		img.decompress()
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func _material(shader: Shader, sp: String, part: Dictionary) -> ShaderMaterial:
	var m: Dictionary = meta[sp]
	var mat := ShaderMaterial.new()
	mat.shader = shader
	mat.set_shader_parameter("tex_px", Vector2(part.w, part.h))
	mat.set_shader_parameter("origin_px", Vector2(part.ox, part.oy))
	mat.set_shader_parameter("s_px", float(m.s))
	var box: Array = m.box
	if m.fish:
		mat.set_shader_parameter("motion", 1)
		mat.set_shader_parameter("body_len", float(m.fish.L))
		mat.set_shader_parameter("amp", float(m.fish.swim) * float(m.fish.H))
	elif sp in ARMS:
		mat.set_shader_parameter("motion", 2)
		mat.set_shader_parameter("arm_root", float(box[1]) * 0.25)
		mat.set_shader_parameter("arm_len", float(box[1]) * 0.75)
		mat.set_shader_parameter("amp", 0.16)
	elif m.upright:
		mat.set_shader_parameter("motion", 0)
	else:
		mat.set_shader_parameter("motion", 3)
		mat.set_shader_parameter("body_len", float(box[0]) + float(box[1]))
		mat.set_shader_parameter("amp", 0.25 if sp == "serpent" else 0.06)
	return mat


func _make_view(sp: String) -> View:
	var v := View.new()
	v.sp = sp
	v.root = Node2D.new()
	v.halo = Sprite2D.new()
	v.halo.texture = _halo_tex
	v.halo.visible = false
	v.root.add_child(v.halo)
	v.pose = Node2D.new()
	v.root.add_child(v.pose)
	var t := textures(sp)
	var m: Dictionary = meta[sp]
	v.body = Sprite2D.new()
	v.body.texture = t.body
	v.body.centered = false
	v.body.offset = -Vector2(m.body.ox, m.body.oy)
	v.body.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	v.mat = _material(BODY_SHADER, sp, m.body)
	v.body.material = v.mat
	v.pose.add_child(v.body)
	if t.glow:
		v.glow = Sprite2D.new()
		v.glow.texture = t.glow
		v.glow.centered = false
		v.glow.offset = -Vector2(m.glow.ox, m.glow.oy)
		v.glow.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
		v.gmat = _material(GLOW_SHADER, sp, m.glow)
		v.glow.material = v.gmat
		v.pose.add_child(v.glow)
	_creatures.add_child(v.root)
	return v


## Positions one creature on screen. s is its radius in screen pixels.
func _place(v: View, x: float, y: float, s: float, angle: float, phase: float, cls: String, z: int) -> void:
	var m: Dictionary = meta[v.sp]
	v.root.position = Vector2(x, y)
	v.root.z_index = z
	var k := s / float(m.s)
	var round_body := cls == "cell" or cls == "plankton"
	if m.upright:
		# face left or right, only tilting a little with the climb (models.js: upright)
		var left := cos(angle) < 0
		v.pose.scale = Vector2(-k if left else k, k)
		v.pose.rotation = (-1.0 if left else 1.0) * sin(angle) * 0.25
		v.pose.position = Vector2(0, sin(phase * 0.8) * s * 0.03)
	else:
		v.pose.rotation = angle
		v.pose.scale = Vector2(k, -k if cos(angle) < 0 and not round_body else k)
		v.pose.position = Vector2.ZERO
	if v.sp in JELLIES:
		v.pose.scale *= Vector2(1.0 - sin(phase * 2) * 0.04, 1.0 + sin(phase * 2) * 0.06)
	v.mat.set_shader_parameter("phase", phase)
	if v.gmat:
		v.gmat.set_shader_parameter("phase", phase)
		v.glow.modulate.a = 0.75 + 0.25 * sin(phase * 2)


func halo(v: View, s: float, color: Color, radius: float, unshaded: bool) -> void:
	v.halo.visible = true
	v.halo.modulate = color
	v.halo.scale = Vector2.ONE * (s * radius * 2 / 128.0)
	var want := unshaded
	var has := v.halo.material != null
	if want != has:
		v.halo.material = _unshaded() if want else null


## Draws one frame. w: the world, cam: {x, y, z}, view: screen size, fx: {danger, flash}.
func render(w, cam: Dictionary, view: Vector2, t: float, dt: float, fx: Dictionary) -> void:
	var p = w.player
	var sx := func(x: float) -> float: return (x - cam.x) * cam.z + view.x / 2
	var sy := func(y: float) -> float: return (y - cam.y) * cam.z + view.y / 2
	var dark: float = Core.dark_at(p.depth)
	var light_px: float = maxf(70.0, Core.light_radius(p) * cam.z)

	# water
	_water.size = view
	_overlay.size = view
	var d: float = p.depth
	var zi := floori(d)
	var k := d - zi
	var wm: ShaderMaterial = _water.material
	wm.set_shader_parameter("view", view)
	wm.set_shader_parameter("top_col", WATER[zi][0].lerp(WATER[zi + 1][0], k))
	wm.set_shader_parameter("bot_col", WATER[zi][1].lerp(WATER[zi + 1][1], k))
	var surface: float = sy.call(p.y - p.depth * Core.depth_scale(p))
	wm.set_shader_parameter("surface_y", surface)
	wm.set_shader_parameter("shafts", 0.0 if reduce_motion else clampf(1.2 - d, 0, 1))
	wm.set_shader_parameter("cam", Vector2(cam.x, cam.y) * cam.z)
	wm.set_shader_parameter("dark", dark)
	wm.set_shader_parameter("light_pos", Vector2(sx.call(p.x), sy.call(p.y)))
	wm.set_shader_parameter("light_r", light_px)
	wm.set_shader_parameter("snow", 0.5 + clampf(d / 3, 0, 0.5))
	wm.set_shader_parameter("t", t)
	var om: ShaderMaterial = _overlay.material
	om.set_shader_parameter("view", view)
	om.set_shader_parameter("danger", fx.danger)
	om.set_shader_parameter("flash", fx.flash)

	# darkness and the player's light
	_modulate.color = Color.WHITE.lerp(Color(0.0, 0.012, 0.04), dark)
	_player_light.enabled = dark > 0.03
	_player_light.energy = dark
	_player_light.position = Vector2(sx.call(p.x), sy.call(p.y))
	_player_light.texture_scale = light_px * 1.6 * 2 / 256.0

	# creatures
	for v in views.values():
		v.used = false
	var glowers: Array = []
	for e in w.ents:
		var x: float = sx.call(e.x)
		var y: float = sy.call(e.y)
		var s: float = e.r * cam.z
		var reach := s * 6
		if x < -reach or x > view.x + reach or y < -reach or y > view.y + reach:
			continue
		var v: View = views.get(e.id)
		if v == null or v.sp != e.sp:
			if v:
				v.root.queue_free()
			v = _make_view(e.sp)
			views[e.id] = v
		v.used = true
		_place(v, x, y, s, e.angle, e.phase, e.cls, clampi(int(log(e.r / p.r) * 80), -3000, 3000))
		if Core.is_hunter(e) and e.r > p.r * Core.EAT_RATIO:
			var chasing: bool = e.mode == "hunt" and e.target == p
			var a := 0.35 + 0.25 * sin(t * 8) if chasing else 0.12
			halo(v, s, Color(1, 0.35, 0.35, a), 2.2, chasing)
		else:
			v.halo.visible = false
		if e.feat.glow and dark > 0.3:
			glowers.append([Core.dist(e, p), x, y, s])
	# the player, between the smaller and the bigger ones
	var me: View = views.get(-1)
	var sp: String = Core.STAGES[p.stage].species
	if me == null or me.sp != sp:
		if me:
			me.root.queue_free()
		me = _make_view(sp)
		views[-1] = me
	me.used = true
	var ps: float = p.r * cam.z
	_place(me, sx.call(p.x), sy.call(p.y), ps, p.angle, t * 3 + Core.hypot(p.vx, p.vy) * 0.01, Core.STAGES[p.stage].kind, 0)
	halo(me, ps, Color(1, 0.85, 0.54, 0.28), 2.6, false)
	me.root.modulate.a = 0.5 + 0.5 * sin(t * 14) if p.invuln > 0 else 1.0
	for id in views.keys():
		if not views[id].used:
			views[id].root.queue_free()
			views.erase(id)

	# glowing creatures light up the water around them, the nearest few
	glowers.sort_custom(func(a, b): return a[0] < b[0])
	for i in MAX_GLOW_LIGHTS:
		var l := _glow_lights[i]
		l.enabled = i < glowers.size()
		if l.enabled:
			var g: Array = glowers[i]
			l.position = Vector2(g[1], g[2])
			l.energy = 0.55 * dark
			l.texture_scale = maxf(50.0, g[3] * 5) * 2 / 256.0

	# the trench floor and its vents
	_floor_frame(sy.call(p.y + (Core.MAX_DEPTH - p.depth) * Core.depth_scale(p)), cam, view, t, p, dark)

	# eat bursts
	for pt in _parts:
		pt.t += dt
		pt.x += pt.vx * dt
		pt.y += pt.vy * dt
	_parts = _parts.filter(func(pt): return pt.t < pt.life)
	_sparks.set_meta("frame", {sx = sx, sy = sy, z = cam.z, dark = dark})
	_sparks.queue_redraw()


func burst(x: float, y: float, r: float, c: Color) -> void:
	if reduce_motion:
		return
	for i in 10:
		var a := randf() * TAU
		var v := randf_range(0.5, 2.0) * r
		_parts.append({x = x, y = y, vx = cos(a) * v, vy = sin(a) * v, t = 0.0, life = randf_range(0.4, 0.9), s = r * randf_range(0.08, 0.18), c = c})


func _draw_sparks() -> void:
	if not _sparks.has_meta("frame"):
		return
	var f: Dictionary = _sparks.get_meta("frame")
	# the vents' hot glow, seen through the darkness (the light itself is a PointLight2D)
	var vd: float = f.get("dark", 0.0)
	for v in _vents:
		_sparks.draw_texture_rect(_halo_tex, Rect2(v + Vector2(-60, -106), Vector2(120, 120)), false, Color(1, 0.47, 0.16, 0.45 * vd))
	for pt in _parts:
		var c: Color = pt.c
		c.a *= clampf(1 - pt.t / pt.life, 0, 1)
		_sparks.draw_circle(Vector2(f.sx.call(pt.x), f.sy.call(pt.y)), maxf(1, pt.s * f.z), c)


## Silty hills along the trench floor, with a hydrothermal vent every ~1200 world units.
func _floor_frame(floor_y: float, cam: Dictionary, view: Vector2, t: float, p, dark: float) -> void:
	_vents.clear()
	_ground.clear()
	for l in _vent_lights:
		l.enabled = false
	if floor_y > view.y + 60:
		_floor.queue_redraw()
		return
	var ground := func(x: float) -> float:
		var wx: float = (x - view.x / 2) / cam.z + cam.x
		return floor_y - (sin(wx * 0.004) * 0.5 + sin(wx * 0.011 + 1) * 0.3 + sin(wx * 0.031) * 0.2) * 40 - 20
	var step := 16.0
	var x := 0.0
	while x <= view.x + step:
		_ground.append(Vector2(x, ground.call(x)))
		x += step
	_ground.append(Vector2(view.x + step, view.y + 10))
	_ground.append(Vector2(0, view.y + 10))
	var span := 1200.0 * pow(2, maxf(0, round(log(Core.view_size(p.r) / 7000.0) / log(2.0))))
	var w0: float = -view.x / 2 / cam.z + cam.x
	var w1: float = view.x / 2 / cam.z + cam.x
	var wx := ceilf(w0 / span) * span
	while wx < w1:
		var vx: float = (wx - cam.x) * cam.z + view.x / 2
		_vents.append(Vector2(vx, ground.call(vx)))
		wx += span
	for i in mini(_vents.size(), _vent_lights.size()):
		var l := _vent_lights[i]
		l.enabled = dark > 0.03
		l.position = _vents[i] + Vector2(0, -50)
		l.energy = 0.9 * dark
		l.texture_scale = 260.0 / 256.0
	_floor.set_meta("t", t)
	_floor.queue_redraw()


func _draw_floor() -> void:
	if _ground.size() < 3:
		return
	_floor.draw_colored_polygon(_ground, Color8(23, 19, 28))
	var t: float = _floor.get_meta("t", 0.0)
	for v in _vents:
		_floor.draw_colored_polygon(PackedVector2Array([v + Vector2(-18, 4), v + Vector2(-6, -46), v + Vector2(6, -46), v + Vector2(18, 4)]), Color8(35, 27, 32))
		for k in 6:
			var f := fmod(t * 0.4 + k / 6.0, 1.0)
			_floor.draw_circle(v + Vector2(sin(t + k) * 8 * f, -50 - f * 120), 8 + f * 26, Color(90 / 255.0, 80 / 255.0, 90 / 255.0, 0.35 * (1 - f)))


func clear() -> void:
	for v in views.values():
		v.root.queue_free()
	views.clear()
	_parts.clear()
