class_name PinsBoard
extends Node2D
## Draws a level of PinsWorld in the style of the painted reference (tools/pins-godot/reference/sheet.webp),
## cut into separate parts by tools/pins-godot/slice.py (assets/style, data/style.json):
##   - the dungeon: shaders/walls.gdshader draws masonry, chamber walls and the wooden room from the
##     level's cell mask (a blast that breaks rock just changes the mask);
##   - every pin is built from parts (gold rod, collar, cap, ring) along its real cells;
##   - every ball of gold is its own coin or gem sprite at the ball's position;
##   - water, lava and gas are one smooth body (shaders/liquid.gdshader), lava with the reference's texture;
##   - the hero, the door with its sign and the torch are the reference's sprites, animated by code;
##   - the torch and the lava are 2D lights over a dark CanvasModulate; soft shadows, embers and sparks.
## The goblins, kegs and stone lumps are still the art baked from web/pins (tools/pins-godot/bake.cjs).
## Nothing here touches the physics: positions come from PinsWorld every frame.

signal finished_walk
signal coin_landed(pos: Vector2)

const World := preload("res://scripts/world.gd")
const LIQUID := preload("res://shaders/liquid.gdshader")
const WALLS := preload("res://shaders/walls.gdshader")
const C := World.CELL
const S := World.CELL / 10.0     # world px per logical px of the web board (the baked goblins and kegs)
const BLOB := 18.0               # radius of a ball's blob in the fluid texture
const AMBIENT := Color(0.62, 0.6, 0.78)
const WARM := Color(1.0, 0.62, 0.3)
const LAVA_LIGHT := Color(1.0, 0.45, 0.14)

var world: PinsWorld
var art: Dictionary              # the baked web art (goblins, kegs)
var style: Dictionary            # the sliced reference
var level_n := 0
var time := 0.0
var phase := "play"              # play | walk | lose | end
var phase_t := 0.0
var drag_id := -1
var drag_off := 0.0
var hint_id := -1
var reduce_motion := false

var _tex := {}
var _walls: Node2D
var _walls_mat: ShaderMaterial
var _mask: ImageTexture
var _matter: Node2D
var _shadows: Node2D
var _fluid_vp: SubViewport
var _fluid_draw: Node2D
var _fluid: Sprite2D
var _pins := {}                  # id -> Node2D
var _pin_home := {}              # id -> Vector2
var _kegs: Array = []            # {sprite, data}
var _door: Node2D                # the hinge
var _door_light: PointLight2D
var _door_glow: Node2D
var _torches: Array = []         # {node, flame, light}
var _hero: Node2D                # at the feet
var _hero_sprite: Sprite2D
var _enemies: Array = []         # {sprite, data, fade}
var _fx_add: Node2D              # embers, sparks, glows (added light)
var _fx_mix: Node2D              # smoke, steam, debris, confetti
var _parts: Array = []           # {p, v, t, life, size, grow, color, drag, add, fall}
var _flashes: Array = []         # {p, t}
var _overlay: Node2D             # hint ring and arrow
var _lava_lights: Array[PointLight2D] = []
var _blast_light: PointLight2D
var _blob: Texture2D
var _glow: Texture2D
var _light_tex: Texture2D
var _rock_seen := -1
var _in_room := {}               # gold balls already counted in the room


func _ready() -> void:
	art = JSON.parse_string(FileAccess.get_file_as_string("res://data/art.json"))
	style = JSON.parse_string(FileAccess.get_file_as_string("res://data/style.json"))
	_blob = _radial(64, 2)
	_glow = _radial(64, 1)
	_light_tex = _radial(128, 1)


func tex(path: String) -> Texture2D:
	if not _tex.has(path):
		_tex[path] = load(path)
	return _tex[path]


func sprite_tex(name: String) -> Texture2D:
	return tex("res://assets/sprites/%s.png" % name)


func style_tex(name: String) -> Texture2D:
	return tex("res://assets/style/%s.png" % name)


## A soft round spot: kind 2 a metaball falloff (1 - r²)², 1 a light glow.
func _radial(size: int, kind: int) -> Texture2D:
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	for y in size:
		for x in size:
			var d := Vector2(x + 0.5 - size / 2.0, y + 0.5 - size / 2.0).length() / (size / 2.0)
			var a := pow(maxf(0.0, 1.0 - d * d), 2.0) if kind == 2 else pow(maxf(0.0, 1.0 - d), 1.6)
			img.set_pixel(x, y, Color(1, 1, 1, a))
	return ImageTexture.create_from_image(img)


func _light(color: Color, energy: float, radius: float) -> PointLight2D:
	var l := PointLight2D.new()
	l.texture = _light_tex
	l.color = color
	l.energy = energy
	l.texture_scale = radius * 2.0 / 128.0
	add_child(l)
	return l


func _unshaded_add() -> CanvasItemMaterial:
	var m := CanvasItemMaterial.new()
	m.light_mode = CanvasItemMaterial.LIGHT_MODE_UNSHADED
	m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	return m


func _unshaded() -> CanvasItemMaterial:
	var m := CanvasItemMaterial.new()
	m.light_mode = CanvasItemMaterial.LIGHT_MODE_UNSHADED
	return m


## Builds the view of a world that was just built from level n (1-based).
func show_level(w: PinsWorld, n: int) -> void:
	for c in get_children():
		c.queue_free()
	world = w
	level_n = n
	phase = "play"
	phase_t = 0.0
	hint_id = -1
	drag_id = -1
	_parts.clear()
	_flashes.clear()
	_pins.clear()
	_pin_home.clear()
	_kegs.clear()
	_torches.clear()
	_enemies.clear()
	_lava_lights.clear()
	_in_room.clear()
	_rock_seen = w.rock_version
	world.reacted.connect(_on_reacted)
	world.pulled.connect(_on_pulled)

	# The dungeon is dim; the torch, the lava and the open door bring the warm light.
	var cm := CanvasModulate.new()
	cm.color = AMBIENT
	add_child(cm)

	_walls = Node2D.new()
	_walls.z_index = -10
	_walls_mat = ShaderMaterial.new()
	_walls_mat.shader = WALLS
	_walls.material = _walls_mat
	_walls.draw.connect(func(): _walls.draw_rect(Rect2(0, 0, World.W * C, World.H * C), Color.WHITE))
	add_child(_walls)
	for k in ["faces", "back", "wood", "band"]:
		_walls_mat.set_shader_parameter(k, style_tex(k))
	_walls_mat.set_shader_parameter("board", Vector2(World.W * C, World.H * C))
	_walls_mat.set_shader_parameter("cell", C)
	_walls_mat.set_shader_parameter("seed", float(n) * 1.37)
	var room: Rect2 = world.room
	var bands := Vector4(-1, -1, -1, -1)
	if room.size.y >= 8:
		bands = Vector4((room.position.y + 1.2) * C, (room.end.y - 3.6) * C, -1, -1)
	_walls_mat.set_shader_parameter("bands", bands)
	_update_mask()

	_add_vines()
	_add_door()
	_add_torches()
	for k in world.kegs:
		var r: Rect2 = k.rect
		var sp := _art_sprite("keg", r.position * 10.0, Vector2(art.keg.ox, art.keg.oy))
		sp.z_index = -6
		_kegs.append({sprite = sp, data = k})

	_shadows = Node2D.new()
	_shadows.z_index = -6
	_shadows.draw.connect(_draw_shadows)
	add_child(_shadows)
	_matter = Node2D.new()
	_matter.z_index = -5
	_matter.draw.connect(_draw_matter)
	add_child(_matter)

	_hero = Node2D.new()
	_hero.z_index = -4
	add_child(_hero)
	_hero_sprite = Sprite2D.new()
	_hero_sprite.texture = style_tex("hero")
	_hero_sprite.centered = false
	var hm: Dictionary = style.hero
	_hero_sprite.offset = -Vector2(hm.feet[0] - hm.x, hm.feet[1] - hm.y)
	_hero.add_child(_hero_sprite)
	for en in world.enemies:
		var sp := Sprite2D.new()
		sp.centered = false
		sp.scale = Vector2.ONE * S / art.kArt
		sp.z_index = -4
		add_child(sp)
		_enemies.append({sprite = sp, data = en, fade = 0.0})

	# the fluid texture: one blob per ball, summed
	_fluid_vp = SubViewport.new()
	_fluid_vp.size = Vector2i(World.W * C, World.H * C)
	_fluid_vp.transparent_bg = true
	_fluid_vp.disable_3d = true
	_fluid_vp.use_hdr_2d = true
	_fluid_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(_fluid_vp)
	_fluid_draw = Node2D.new()
	var add := CanvasItemMaterial.new()
	add.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	_fluid_draw.material = add
	_fluid_draw.draw.connect(_draw_blobs)
	_fluid_vp.add_child(_fluid_draw)
	_fluid = Sprite2D.new()
	_fluid.texture = _fluid_vp.get_texture()
	_fluid.centered = false
	_fluid.z_index = -3
	var m := ShaderMaterial.new()
	m.shader = LIQUID
	m.set_shader_parameter("texel", Vector2.ONE / Vector2(_fluid_vp.size))
	m.set_shader_parameter("lava_tex", style_tex("lava"))
	_fluid.material = m
	add_child(_fluid)

	for p in world.level.pins:
		var node := _make_pin(p)
		_pins[int(p.id)] = node
		_pin_home[int(p.id)] = node.position

	for i in 4:
		var l := _light(LAVA_LIGHT, 0.0, 60)
		l.enabled = false
		_lava_lights.append(l)
	_blast_light = _light(Color(1.0, 0.75, 0.4), 0.0, 120)
	_blast_light.enabled = false

	_fx_mix = Node2D.new()
	_fx_mix.z_index = 3
	_fx_mix.material = _unshaded()
	_fx_mix.draw.connect(_draw_fx_mix)
	add_child(_fx_mix)
	_fx_add = Node2D.new()
	_fx_add.z_index = 3
	_fx_add.material = _unshaded_add()
	_fx_add.draw.connect(_draw_fx_add)
	add_child(_fx_add)
	_overlay = Node2D.new()
	_overlay.z_index = 4
	_overlay.material = _unshaded()
	_overlay.draw.connect(_draw_hint)
	add_child(_overlay)
	_update_figures(0.0)


## The cell mask of the walls shader: red = rock, green = the hero's room.
func _update_mask() -> void:
	var img := Image.create(World.W, World.H, false, Image.FORMAT_RGBA8)
	var room: Rect2 = world.room
	for y in World.H:
		for x in World.W:
			var rock := world.rock_grid[y * World.W + x]
			img.set_pixel(x, y, Color(1.0 if rock else 0.0, 1.0 if room.has_point(Vector2(x, y)) else 0.0, 0, 1))
	if _mask == null or _mask.get_size() != Vector2(World.W, World.H):
		_mask = ImageTexture.create_from_image(img)
	else:
		_mask.update(img)
	_walls_mat.set_shader_parameter("mask_n", _mask)
	_walls_mat.set_shader_parameter("mask_l", _mask)


## A sprite of the baked web art: `at` is a point in logical px of the web board, `origin` the same point
## inside the image (logical px).
func _art_sprite(name: String, at: Vector2, origin: Vector2) -> Sprite2D:
	var sp := Sprite2D.new()
	sp.texture = sprite_tex(name)
	sp.centered = false
	sp.scale = Vector2.ONE * S / art.kArt
	sp.position = (at - origin) * S
	add_child(sp)
	return sp


# ───────────── Dungeon dressing ─────────────
## A few vines hang from rock overhangs, away from the pins (always the same ones for a level).
func _add_vines() -> void:
	var spots: Array = []
	for y in range(2, World.H - 2):
		for x in range(1, World.W - 1):
			if world.rock_grid[y * World.W + x] and not world.rock_grid[(y + 1) * World.W + x] and world.rock_grid[(y - 1) * World.W + x]:
				var ok := true
				for p in world.level.pins:
					if Rect2(p.x - 3, p.y - 3, p.w + 6, p.h + 6).has_point(Vector2(x, y)):
						ok = false
				if ok and not world.room.grow(1).has_point(Vector2(x, y + 1)):
					spots.append(Vector2i(x, y))
	var rng := RandomNumberGenerator.new()
	rng.seed = level_n * 101
	for i in mini(3, spots.size()):
		var at: Vector2i = spots[rng.randi_range(0, spots.size() - 1)]
		var name := "vine%d" % rng.randi_range(0, 2)
		var sp := Sprite2D.new()
		sp.texture = style_tex(name)
		sp.centered = false
		var k := 0.28
		sp.scale = Vector2(k * (1 if rng.randf() < 0.5 else -1), k)
		sp.position = Vector2((at.x + 0.5) * C - (style[name].w * k * 0.5) * signf(sp.scale.x), (at.y + 0.6) * C)
		sp.z_index = -9
		add_child(sp)


## The exit door and its sign; it swings open towards its hinge and the daylight pours out.
func _add_door() -> void:
	var e: Rect2 = world.exit_rect
	var dm: Dictionary = style.door
	var k: float = (5.3 * C) / dm.h
	var bottom := Vector2(e.get_center().x * C, e.end.y * C)
	_door_glow = Node2D.new()
	_door_glow.z_index = -8
	_door_glow.material = _unshaded_add()
	_door_glow.position = bottom
	_door_glow.set_meta("open", 0.0)
	var w: float = dm.w * k
	var h: float = dm.h * k
	_door_glow.draw.connect(func():
		var open: float = _door_glow.get_meta("open")
		if open <= 0.0:
			return
		# the arch of daylight behind the door
		var r := w * 0.42
		var pts := PackedVector2Array()
		for i in 13:
			var a := PI + PI * i / 12.0
			pts.append(Vector2(cos(a) * r, -h + r + 6 + sin(a) * r))
		pts.append(Vector2(r, -3))
		pts.append(Vector2(-r, -3))
		_door_glow.draw_colored_polygon(pts, Color(1.0, 0.85, 0.55, open))
		_door_glow.draw_texture_rect(_glow, Rect2(Vector2(-w * 1.2, -h * 1.1), Vector2(w * 2.4, h * 1.3)), false, Color(1, 0.8, 0.45, open * 0.6)))
	add_child(_door_glow)
	_door = Node2D.new()
	_door.z_index = -7
	_door.position = bottom + Vector2(-w / 2, -h)
	var sp := Sprite2D.new()
	sp.texture = style_tex("door")
	sp.centered = false
	sp.scale = Vector2.ONE * k
	_door.add_child(sp)
	add_child(_door)
	var sign := Sprite2D.new()
	sign.texture = style_tex("sign")
	sign.scale = Vector2.ONE * k * 1.15
	sign.position = bottom + Vector2(0, -h - 5)
	sign.z_index = -7
	add_child(sign)
	_door_light = _light(Color(1.0, 0.85, 0.55), 0.0, 70)
	_door_light.position = bottom + Vector2(0, -h * 0.5)


## Torches on the wall by the door (where the room has space): a flame that flickers and lights the room.
func _add_torches() -> void:
	var e: Rect2 = world.exit_rect
	var room: Rect2 = world.room
	var tm: Dictionary = style.torch
	var k: float = (2.6 * C) / tm.h
	for side in [-1, 1]:
		var x: float = (e.position.x - 0.9) * C if side < 0 else (e.end.x + 0.9) * C
		if x < room.position.x * C + 6 or x > room.end.x * C - 6:
			continue
		var node := Node2D.new()
		node.position = Vector2(x, (e.position.y + 0.9) * C)
		node.z_index = -8
		var sp := Sprite2D.new()
		sp.texture = style_tex("torch")
		sp.centered = false
		sp.scale = Vector2.ONE * k
		sp.offset = -Vector2(tm.flame[0] - tm.x, tm.flame[1] - tm.y)
		node.add_child(sp)
		add_child(node)
		var l := _light(WARM, 1.1, 5.5 * C)
		l.position = node.position
		_torches.append({node = node, sprite = sp, light = l})


# ───────────── Pins ─────────────
## A pin built from the reference's parts along its real cells: the ring sits on the handle cell, the rod
## runs over the pin's cells to its far end, where the cap is. The node is at the ring's centre with +x
## pointing along the pin, so a pull just slides it along -x.
func _make_pin(p: Dictionary) -> Node2D:
	var node := Node2D.new()
	node.z_index = -2
	var hc := handle_cell(p)
	node.position = (hc + Vector2(0.5, 0.5)) * C
	var horiz: bool = p.handle != "top"
	var length: float = ((p.w if horiz else p.h) + 0.5) * C
	if p.handle == "left":
		node.rotation = 0
	elif p.handle == "right":
		node.rotation = PI
		node.scale = Vector2(1, -1)  # keep the lit side on top
	else:
		node.rotation = PI / 2
		node.scale = Vector2(1, -1)
	var ring_r := 1.25 * C
	var thick := 10.0
	# soft shadow on the wall behind, down and to the right on screen
	var shadow := Node2D.new()
	shadow.set_meta("len", length)
	shadow.draw.connect(func():
		shadow.draw_rect(Rect2(ring_r * 0.6, -thick * 0.5, length - ring_r * 0.6, thick), Color(0, 0, 0, 0.35))
		shadow.draw_arc(Vector2.ZERO, ring_r * 0.75, 0, TAU, 24, Color(0, 0, 0, 0.3), ring_r * 0.45, true))
	var screen_off := Vector2(2.5, 3.5)
	shadow.position = screen_off.rotated(-node.rotation) * Vector2(node.scale.x, node.scale.y)
	node.add_child(shadow)
	var rod := Sprite2D.new()
	rod.texture = style_tex("rod")
	rod.centered = false
	rod.position = Vector2(ring_r * 0.7, -thick / 2)
	rod.scale = Vector2(length - ring_r * 0.7 - 2, thick / style.rod.h)
	node.add_child(rod)
	var collar := Sprite2D.new()
	collar.texture = style_tex("collar")
	collar.scale = Vector2.ONE * (thick * 1.55) / style.collar.h
	collar.position = Vector2(ring_r * 0.95, 0)
	node.add_child(collar)
	var cap := Sprite2D.new()
	cap.texture = style_tex("cap")
	cap.scale = Vector2.ONE * (thick * 1.5) / style.cap.h
	cap.position = Vector2(length - 3, 0)
	node.add_child(cap)
	var ring := Sprite2D.new()
	ring.texture = style_tex("ring")
	ring.scale = Vector2.ONE * (ring_r * 2.0) / 72.0
	node.add_child(ring)
	# the pin's number (keys 1–5) on a small badge beside the ring, always upright (a node of its own)
	var badge := Node2D.new()
	badge.z_index = -1
	var id := int(p.id)
	badge.draw.connect(func():
		badge.draw_circle(Vector2.ZERO, 6.5, Color(0.12, 0.09, 0.16))
		badge.draw_arc(Vector2.ZERO, 6.5, 0, TAU, 20, Color(1, 0.8, 0.45, 0.85), 1.0, true)
		badge.draw_string(ThemeDB.fallback_font, Vector2(-3.4, 3.6), str(id), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(1, 0.92, 0.66)))
	badge.set_meta("off", Vector2(0, -ring_r - 6) if horiz else Vector2(ring_r + 7, 0))
	badge.position = node.position + badge.get_meta("off")
	add_child(badge)
	node.set_meta("badge", badge)
	add_child(node)
	return node


func _pull_dir(id: int) -> Vector2:
	var d: Dictionary = world.pins[id].def
	return Vector2.LEFT if d.handle == "left" else (Vector2.RIGHT if d.handle == "right" else Vector2.UP)


func _on_pulled(id: int) -> void:
	if hint_id == id:
		hint_id = -1
	var node: Node2D = _pins.get(id)
	if node == null:
		return
	var d: Dictionary = world.pins[id].def
	var dir := _pull_dir(id)
	var len: float = ((d.h if d.handle == "top" else d.w) + 3) * C
	# a few sparks and a puff of dust where the rod slides out of the rock
	var mouth: Vector2 = (handle_cell(d) + Vector2(0.5, 0.5)) * C - dir * C * 0.8
	for i in 8:
		_puff(mouth, "spark")
	for i in 4:
		_puff(mouth, "dust")
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(node, "position", _pin_home[id] + dir * len, 0.38).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_CUBIC)
	tw.tween_property(node, "modulate:a", 0.0, 0.38).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
	var badge: Node2D = node.get_meta("badge")
	tw.tween_property(badge, "modulate:a", 0.0, 0.15)
	tw.chain().tween_callback(func():
		node.queue_free()
		badge.queue_free())
	_pins.erase(id)


# ───────────── Reactions and particles ─────────────
func _on_reacted(kind: String, pos: Vector2) -> void:
	match kind:
		"steam":
			for i in 3:
				_puff(pos, "steam")
		"sizzle", "poof":
			_puff(pos, "smoke")
			_puff(pos, "flame")
		"blast":
			_flashes.append({p = pos, t = 0.0})
			for i in 30:
				_puff(pos, ["debris", "flame", "spark"][i % 3])
		"kill_lava", "kill_blast":
			for i in 8:
				_puff(pos + Vector2(randf_range(-12, 12), randf_range(-20, 20)), "smoke" if i % 3 else "flame")
		"kill_gas":
			for i in 5:
				_puff(pos + Vector2(randf_range(-10, 10), randf_range(-16, 16)), "gas")


func _puff(p: Vector2, kind: String) -> void:
	if reduce_motion and _parts.size() > 40:
		return
	var r := randf
	var o: Dictionary
	match kind:
		"steam": o = {v = Vector2((r.call() - 0.5) * 20, -26 - r.call() * 22), life = 0.9 + r.call() * 0.7, size = 3.0 + r.call() * 2.5, grow = 8.0, color = Color(0.93, 0.95, 0.98, 0.8), drag = 0.6}
		"smoke": o = {v = Vector2((r.call() - 0.5) * 14, -18 - r.call() * 16), life = 1.0 + r.call() * 0.6, size = 3.0 + r.call() * 2.0, grow = 6.0, color = Color(0.2, 0.17, 0.2, 0.75), drag = 0.5}
		"dust": o = {v = Vector2((r.call() - 0.5) * 30, -6 - r.call() * 14), life = 0.6 + r.call() * 0.4, size = 2.0 + r.call() * 1.5, grow = 5.0, color = Color(0.62, 0.55, 0.5, 0.55), drag = 1.5}
		"flame": o = {v = Vector2((r.call() - 0.5) * 40, -30 - r.call() * 40), life = 0.35 + r.call() * 0.3, size = 2.5 + r.call() * 2.0, grow = -3.0, color = Color(1.0, 0.6, 0.15, 1.0), drag = 1.2, add = true}
		"ember": o = {v = Vector2((r.call() - 0.5) * 10, -18 - r.call() * 26), life = 0.9 + r.call() * 1.1, size = 1.0 + r.call() * 1.0, grow = -0.4, color = Color(1.0, 0.55 + r.call() * 0.3, 0.15, 1.0), drag = 0.3, add = true, wobble = r.call() * 6.0}
		"spark": o = {v = Vector2((r.call() - 0.5) * 120, -30 - r.call() * 90), life = 0.3 + r.call() * 0.35, size = 1.2 + r.call() * 0.8, grow = -1.5, color = Color(1.0, 0.85, 0.4, 1.0), drag = 0.6, add = true, fall = true}
		"twinkle": o = {v = Vector2((r.call() - 0.5) * 30, -20 - r.call() * 30), life = 0.5 + r.call() * 0.3, size = 2.0 + r.call() * 1.5, grow = -2.0, color = Color(1.0, 0.95, 0.6, 1.0), drag = 1.0, add = true, star = true}
		"debris": o = {v = Vector2((r.call() - 0.5) * 260, -60 - r.call() * 200), life = 0.8 + r.call() * 0.5, size = 1.8 + r.call() * 1.8, grow = 0.0, color = Color(0.36, 0.33, 0.38, 1.0), drag = 0.2, fall = true, square = true}
		"gas": o = {v = Vector2((r.call() - 0.5) * 16, -14 - r.call() * 10), life = 1.0 + r.call() * 0.5, size = 3.0 + r.call() * 2.0, grow = 6.0, color = Color(0.6, 0.85, 0.35, 0.6), drag = 0.5}
		"confetti": o = {v = Vector2((r.call() - 0.5) * 220, -120 - r.call() * 160), life = 1.4 + r.call() * 0.6, size = 2.0, grow = 0.0, color = Color.from_hsv(r.call(), 0.7, 1.0), drag = 0.4, fall = true, square = true}
		_: return
	o.p = p
	o.t = 0.0
	_parts.append(o)


func celebrate(at: Vector2) -> void:
	for i in 40:
		_puff(at, "confetti")


func _process(delta: float) -> void:
	if world == null:
		return
	time += delta
	phase_t += delta
	if world.rock_version != _rock_seen:
		_rock_seen = world.rock_version
		_update_mask()
	for k in _kegs:
		if not k.data.live and is_instance_valid(k.sprite):
			k.sprite.queue_free()
	for t in _torches:
		var f := sin(time * 13 + t.node.position.x) * 0.6 + sin(time * 7.3 + t.node.position.x * 2) * 0.4
		t.node.scale = Vector2(1.0 + f * 0.02, 1.0 + f * 0.05)
		t.light.energy = 1.05 + f * 0.15
		t.light.texture_scale = (5.5 * C + f * 3) * 2.0 / 128.0
	for id in _pins:
		var node: Node2D = _pins[id]
		var off := drag_off if id == drag_id else 0.0
		node.position = _pin_home[id] + _pull_dir(id) * off * C
		var badge: Node2D = node.get_meta("badge")
		badge.position = node.position + badge.get_meta("off")
	_lava_frame(delta)
	_gold_frame()
	for p in _parts:
		p.t += delta
		p.v *= 1.0 - minf(1.0, p.drag * delta)
		if p.get("fall", false):
			p.v.y += 600 * delta
		if p.has("wobble"):
			p.v.x += sin(time * 5 + p.wobble) * 12 * delta
		p.p += p.v * delta
		p.size = maxf(0.4, p.size + p.grow * delta)
	_parts = _parts.filter(func(p): return p.t < p.life and p.p.y < World.H * C)
	for f in _flashes:
		f.t += delta
	_flashes = _flashes.filter(func(f): return f.t < 0.5)
	_blast_light.enabled = _flashes.size() > 0
	if _blast_light.enabled:
		var f: Dictionary = _flashes[-1]
		_blast_light.position = f.p
		_blast_light.energy = 2.5 * (1.0 - f.t / 0.5)
	_update_figures(delta)
	_matter.queue_redraw()
	_shadows.queue_redraw()
	_fluid_draw.queue_redraw()
	(_fluid.material as ShaderMaterial).set_shader_parameter("t", time)
	_fx_add.queue_redraw()
	_fx_mix.queue_redraw()
	_overlay.queue_redraw()
	_door_glow.queue_redraw()


## Lava lights the stone around it: up to four lights at the biggest pools, flickering; embers rise
## from the surface of the pools.
func _lava_frame(delta: float) -> void:
	var buckets := {}
	var tops := {}
	for b in world.balls:
		if b.get_meta("type") != "lava" or b.get_meta("gone", false):
			continue
		var key := Vector2i(b.position / (C * 6))
		var e: Array = buckets.get(key, [Vector2.ZERO, 0])
		e[0] += b.position
		e[1] += 1
		buckets[key] = e
		var col := int(b.position.x / C)
		if not tops.has(col) or b.position.y < tops[col].y:
			tops[col] = b.position
	var list := buckets.values()
	list.sort_custom(func(a, b): return a[1] > b[1])
	for i in _lava_lights.size():
		var l := _lava_lights[i]
		l.enabled = i < list.size() and list[i][1] >= 3
		if l.enabled:
			var n: int = list[i][1]
			l.position = list[i][0] / n + Vector2(0, -C)
			l.energy = 0.75 + 0.1 * sin(time * 3.1 + i) + 0.05 * sin(time * 7.7 + i * 2)
			l.texture_scale = (clampf(sqrt(n) * 1.6, 3.0, 9.0) * C) * 2.0 / 128.0
	if reduce_motion or tops.is_empty():
		return
	var cols := tops.keys()
	var chance := delta * 3.0 * sqrt(float(cols.size()))
	while chance > 0.0:
		if randf() < chance:
			var at: Vector2 = tops[cols[randi() % cols.size()]]
			_puff(at + Vector2(randf_range(-4, 4), -4), "ember")
		chance -= 1.0


## Gold that reaches the hero's room for the first time twinkles (the HUD counts it).
func _gold_frame() -> void:
	var room := Rect2(world.room.position * C, world.room.size * C)
	for b in world.balls:
		if b.get_meta("type") != "gold" or b.get_meta("gone", false):
			continue
		var id := b.get_instance_id()
		if not _in_room.has(id) and room.has_point(b.position):
			_in_room[id] = true
			if b.linear_velocity.length() < 400:
				_puff(b.position, "twinkle")
				coin_landed.emit(b.position)


# ───────────── Figures ─────────────
func _fig_pos(r: Rect2) -> Vector2:
	return (r.position * 10.0 - Vector2(art.figure.ox, art.figure.oy)) * S


func _update_figures(delta: float) -> void:
	var hr: Rect2 = world.hero.rect
	var k: float = (5.5 * C) / float(style.hero.h)
	var feet := Vector2(hr.get_center().x * C, hr.end.y * C)
	var face := -1.0 if world.exit_rect.position.x < hr.position.x else 1.0
	var bob := 0.0
	var tilt := 0.0
	var squash := 1.0 + 0.012 * sin(time * 2.4)
	var tint := Color.WHITE
	var alpha := 1.0
	var open := 0.0
	if phase == "walk" or phase == "end":
		# cheer for half a second, walk to the door, go through it
		var cheer := 0.5
		var dist: float = world.exit_rect.get_center().x - hr.get_center().x
		var walk_t := absf(dist) / 9.0
		var tw := maxf(0.0, phase_t - cheer) if phase == "walk" else walk_t + 1.2
		feet.x += signf(dist) * minf(absf(dist), tw * 9.0) * C
		face = -1.0 if dist < 0 else 1.0
		if phase == "walk" and phase_t < cheer:
			bob = -absf(sin(phase_t * PI * 2 / cheer)) * 7
			squash = 1.0 + 0.06 * sin(phase_t * PI * 4 / cheer)
		elif tw < walk_t:
			bob = -absf(sin(tw * 12.0)) * 2.5
			tilt = sin(tw * 12.0) * 0.07
		else:
			alpha = 1.0 - clampf((tw - walk_t) / 0.5, 0, 1)
			if tw - walk_t > 1.1 and phase == "walk":
				phase = "end"
				finished_walk.emit()
		open = clampf((tw - walk_t + 0.35) / 0.5, 0, 1)
	elif world.lost != "":
		if world.lost == "enemy":
			feet.x += sin(time * 40) * 0.8
			tint = Color(0.85, 0.9, 1.0)
		elif world.lost == "gas":
			tint = Color(0.5, 0.85, 0.4)
		else:
			tint = Color(0.28, 0.22, 0.22)
			if randf() < 0.15:
				_puff(feet + Vector2(randf_range(-8, 8), -randf_range(10, 50)), "smoke")
	_hero.position = feet + Vector2(0, bob)
	_hero.rotation = tilt
	_hero.scale = Vector2(face * k, k * squash)
	_hero.modulate = Color(tint, alpha)
	# the door swings towards its hinge (its left edge) and lets the daylight out
	var dsp: Sprite2D = _door.get_child(0)
	dsp.scale.x = (5.3 * C) / style.door.h * (1.0 - open * 0.8)
	_door_glow.set_meta("open", open)
	_door_light.energy = open * 1.6

	for en in _enemies:
		var d: Dictionary = en.data
		var sp: Sprite2D = en.sprite
		var ep := _fig_pos(d.rect)
		var eface := "l" if hr.position.x < (d.rect as Rect2).position.x else "r"
		if d.dead:
			en.fade += delta
			var f: float = en.fade
			sp.texture = sprite_tex("enemy_idle_" + eface if f < 0.25 else ("enemy_poisoned" if d.cause == "gas" else "enemy_burnt"))
			sp.position = ep - Vector2(0, (f * 30 if d.cause == "blast" else f * 4) * S)
			sp.modulate.a = maxf(0.0, 1.0 - f)
		else:
			var mood := "cheer" if world.lost == "enemy" else ("scared" if world.lost != "" else "idle")
			sp.texture = sprite_tex("enemy_%s_%s" % [mood, eface])
			sp.position = ep + Vector2(0, sin(time * 2.2 + (d.rect as Rect2).position.x) * 0.6 * S)


# ───────────── Drawing ─────────────
## Soft contact shadows under the hero, the goblins and the kegs.
func _draw_shadows() -> void:
	var hr: Rect2 = world.hero.rect
	var feet := Vector2(_hero.position.x, hr.end.y * C)
	var lift := clampf((hr.end.y * C - _hero.position.y) / 10.0, 0, 1)
	_shadows.draw_texture_rect(_glow, Rect2(feet + Vector2(-17, -5), Vector2(34, 10)), false, Color(0, 0, 0, 0.55 * (1.0 - lift * 0.5) * _hero.modulate.a))
	for en in _enemies:
		if en.data.dead:
			continue
		var r: Rect2 = en.data.rect
		_shadows.draw_texture_rect(_glow, Rect2(Vector2(r.get_center().x * C - 17, r.end.y * C - 5), Vector2(34, 10)), false, Color(0, 0, 0, 0.5))
	for k in _kegs:
		if k.data.live:
			var r: Rect2 = k.data.rect
			_shadows.draw_texture_rect(_glow, Rect2(Vector2(r.position.x * C - 3, r.end.y * C - 4), Vector2(r.size.x * C + 6, 8)), false, Color(0, 0, 0, 0.5))


## Every ball of gold as its own coin (one in sixteen a gem), and the stone lumps.
func _draw_matter() -> void:
	var coins := [style_tex("coin0"), style_tex("coin1"), style_tex("coin2")]
	var gems := [style_tex("gem_blue"), style_tex("gem_green"), style_tex("gem_red")]
	for b in world.balls:
		if b.get_meta("type") != "gold" or b.get_meta("gone", false):
			continue
		# a stable random number per ball picks its look: mostly coins, one in twenty-four a gem
		var h := hash(b.get_instance_id())
		var gem := h % 24 == 0
		var t: Texture2D = gems[(h / 24) % 3] if gem else coins[h % 3]
		var sz := Vector2.ONE * (14.0 if gem else 15.0 + float((h / 7) % 5) * 0.7)
		_matter.draw_set_transform(b.position, b.rotation * 0.15 + float((h / 3) % 7 - 3) * 0.08, Vector2.ONE)
		_matter.draw_texture_rect(t, Rect2(-sz / 2, sz), false)
	var i := 0
	var ssize := Vector2.ONE * 12.0 * S
	for s in world.stones:
		if s.get_meta("gone", false):
			continue
		i += 1
		_matter.draw_set_transform(s.position, s.rotation, Vector2.ONE)
		_matter.draw_texture_rect(sprite_tex("stone%d" % (i % 3)), Rect2(-ssize / 2, ssize), false)
	_matter.draw_set_transform(Vector2.ZERO, 0, Vector2.ONE)


func _draw_blobs() -> void:
	var r := Vector2.ONE * BLOB
	for b in world.balls:
		if b.get_meta("gone", false):
			continue
		var c: Color
		match b.get_meta("type"):
			"water": c = Color(1, 0, 0)
			"lava": c = Color(0, 1, 0)
			"gas": c = Color(0, 0, 1)
			_: continue
		_fluid_draw.draw_texture_rect(_blob, Rect2(b.position - r, r * 2), false, c)


func _draw_fx_mix() -> void:
	for p in _parts:
		if p.get("add", false):
			continue
		var c: Color = p.color
		c.a *= clampf(1.0 - p.t / p.life, 0, 1)
		if p.get("square", false):
			_fx_mix.draw_rect(Rect2(p.p - Vector2(p.size, p.size) * 0.5, Vector2(p.size, p.size)), c)
		else:
			_fx_mix.draw_texture_rect(_glow, Rect2(p.p - Vector2(p.size, p.size) * 1.5, Vector2(p.size, p.size) * 3), false, c)


func _draw_fx_add() -> void:
	for f in _flashes:
		var q: float = f.t / 0.5
		var rad := (World.BLAST_R + 1) * C * (0.6 + q * 0.9)
		_fx_add.draw_texture_rect(_glow, Rect2(f.p - Vector2(rad, rad), Vector2(rad, rad) * 2), false, Color(1.6, 1.2, 0.6, (1 - q) * 0.9))
	for t in _torches:
		var a := 0.42 + 0.06 * sin(time * 11.0 + t.node.position.x)
		_fx_add.draw_texture_rect(_glow, Rect2(t.node.position - Vector2(26, 30), Vector2(52, 52)), false, Color(1, 0.62, 0.25, a))
	for p in _parts:
		if not p.get("add", false):
			continue
		var c: Color = p.color
		c.a *= clampf(1.0 - p.t / p.life, 0, 1)
		if p.get("star", false):
			var s: float = p.size * 2.2
			_fx_add.draw_line(p.p - Vector2(s, 0), p.p + Vector2(s, 0), c, 1.2, true)
			_fx_add.draw_line(p.p - Vector2(0, s), p.p + Vector2(0, s), c, 1.2, true)
		_fx_add.draw_texture_rect(_glow, Rect2(p.p - Vector2(p.size, p.size) * 2, Vector2(p.size, p.size) * 4), false, c)
	# twinkles on the top of the gold piles now and then
	var n := 0
	for b in world.balls:
		if n >= 5 or b.get_meta("type") != "gold":
			continue
		var ph := time * 0.8 + float(b.get_instance_id() % 97) * 0.13
		var slot := floorf(ph)
		if fmod(slot * 0.618 + float(b.get_instance_id() % 13) * 0.31, 1.0) > 0.07:
			continue
		var a := sin((ph - slot) * PI)
		var s := 2.0 + a * 5.0
		var c := Color(1, 0.96, 0.75, a)
		_fx_add.draw_line(b.position - Vector2(s, 0), b.position + Vector2(s, 0), c, 1.0, true)
		_fx_add.draw_line(b.position - Vector2(0, s), b.position + Vector2(0, s), c, 1.0, true)
		n += 1


## The hint: a pulsing ring around the handle of the pin to pull, and an arrow the way to pull it.
func _draw_hint() -> void:
	if hint_id < 0 or not world.pins.has(hint_id) or world.pins[hint_id].pulled:
		return
	var d: Dictionary = world.pins[hint_id].def
	var c := (handle_cell(d) + Vector2(0.5, 0.5)) * C
	var pulse := 0.5 + 0.5 * sin(time * 6)
	_overlay.draw_arc(c, 17 + pulse * 5, 0, TAU, 40, Color(1, 0.85, 0.35, 0.9 - pulse * 0.5), 2.5, true)
	var dir := _pull_dir(hint_id)
	var tip := c + dir * (34 + pulse * 6)
	var base := c + dir * 22
	_overlay.draw_line(base, tip, Color(1, 0.85, 0.35), 3, true)
	var side := dir.orthogonal()
	_overlay.draw_colored_polygon(PackedVector2Array([tip + dir * 7, tip + side * 6, tip - side * 6]), Color(1, 0.85, 0.35))


## The cell of a pin's ring (handleCell in web/pins/core.js).
static func handle_cell(p: Dictionary) -> Vector2:
	if p.handle == "left":
		return Vector2(p.x - 1, p.y + ((int(p.h) - 1) >> 1))
	if p.handle == "right":
		return Vector2(p.x + p.w, p.y + ((int(p.h) - 1) >> 1))
	return Vector2(p.x + ((int(p.w) - 1) >> 1), p.y - 1)


## The pin under a point (world px), or -1: its bar grown by a cell, or two and a half cells around its ring.
## The interaction area is the pin's cells, not its picture.
func pin_at(pt: Vector2) -> int:
	var best := -1
	var best_d := INF
	for id in world.pins:
		if world.pins[id].pulled:
			continue
		var d: Dictionary = world.pins[id].def
		var bar := Rect2(Vector2(d.x, d.y) * C, Vector2(d.w, d.h) * C).grow(C)
		var ring := (handle_cell(d) + Vector2(0.5, 0.5)) * C
		var dist := ring.distance_to(pt)
		if dist < C * 2.5 and dist < best_d:
			best = id
			best_d = dist
		elif bar.has_point(pt) and best < 0:
			best = id
	return best
