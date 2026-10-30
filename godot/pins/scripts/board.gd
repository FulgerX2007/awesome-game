class_name PinsBoard
extends Node2D
## Draws a level of PinsWorld with the art baked from web/pins/game.js (tools/pins-godot/bake.cjs):
## the masonry board, pins, the exit door, torches, kegs, coins, stone lumps and the figures. Water, lava
## and gas are drawn as one smooth body: every ball adds a soft blob to an offscreen HDR texture
## (water in red, lava in green, gas in blue) and shaders/liquid.gdshader turns the sums into pools.
## Positions in art.json are logical px of the web board (10 px a cell); here a cell is PinsWorld.CELL.

signal finished_walk

const World := preload("res://scripts/world.gd")
const LIQUID := preload("res://shaders/liquid.gdshader")
const S := World.CELL / 10.0     # world px per logical px of the web board
const BLOB := 18.0               # radius of a ball's blob in the fluid texture

var world: PinsWorld
var art: Dictionary
var level_n := 0
var time := 0.0
var phase := "play"              # play | walk | lose | end
var phase_t := 0.0
var won_dir := 1
var drag_id := -1
var drag_off := 0.0
var hint_id := -1
var reduce_motion := false

var _tex := {}
var _board: Sprite2D
var _carved: Node2D
var _matter: Node2D
var _fluid_vp: SubViewport
var _fluid_draw: Node2D
var _fluid: Sprite2D
var _pins := {}                  # id -> Sprite2D
var _pin_home := {}              # id -> Vector2
var _kegs: Array = []            # {sprite, data}
var _door: Sprite2D
var _torches: Array[Sprite2D] = []
var _hero: Sprite2D
var _enemies: Array = []         # {sprite, data, fade}
var _fx: Node2D
var _parts: Array = []           # {p, v, t, life, size, grow, color, drag}
var _flashes: Array = []         # {p, t}
var _overlay: Node2D             # hint ring and arrow
var _blob: Texture2D
var _glow: Texture2D
var _rock_seen := -1


func _ready() -> void:
	art = JSON.parse_string(FileAccess.get_file_as_string("res://data/art.json"))
	_blob = _radial(64, true)
	_glow = _radial(64, false)


func tex(path: String) -> Texture2D:
	if not _tex.has(path):
		_tex[path] = load(path)
	return _tex[path]


func sprite_tex(name: String) -> Texture2D:
	return tex("res://assets/sprites/%s.png" % name)


## A soft round spot. blob: a metaball falloff (1 - r²)², else a light glow.
func _radial(size: int, blob: bool) -> Texture2D:
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	for y in size:
		for x in size:
			var d := Vector2(x + 0.5 - size / 2.0, y + 0.5 - size / 2.0).length() / (size / 2.0)
			var a := pow(maxf(0.0, 1.0 - d * d), 2.0) if blob else pow(maxf(0.0, 1.0 - d), 1.6)
			img.set_pixel(x, y, Color(1, 1, 1, a))
	return ImageTexture.create_from_image(img)


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
	_rock_seen = w.rock_version
	world.reacted.connect(_on_reacted)

	_board = Sprite2D.new()
	_board.texture = tex("res://assets/boards/%d.webp" % n)
	_board.centered = false
	_board.scale = Vector2.ONE * S / art.kBoard
	_board.z_index = -10
	add_child(_board)
	_carved = Node2D.new()
	_carved.z_index = -9
	_carved.draw.connect(_draw_carved)
	add_child(_carved)

	var e: Dictionary = world.level.exit
	var room: Dictionary = world.level.room
	for rel in [-10.0, e.w * 10.0 + 10.0]:
		var tx: float = e.x * 10.0 + rel
		if tx < room.x * 10.0 + 5 or tx > (room.x + room.w) * 10.0 - 5:
			continue
		var t := _art_sprite("torch", Vector2(tx, e.y * 10.0 + 6), Vector2(40, 40))
		t.z_index = -8
		_torches.append(t)
	_door = _art_sprite("door0", Vector2(e.x, e.y) * 10.0, Vector2(art.door.ox, art.door.oy))
	_door.z_index = -7
	for k in world.kegs:
		var r: Rect2 = k.rect
		var sp := _art_sprite("keg", r.position * 10.0, Vector2(art.keg.ox, art.keg.oy))
		sp.z_index = -6
		_kegs.append({sprite = sp, data = k})

	_matter = Node2D.new()
	_matter.z_index = -5
	_matter.draw.connect(_draw_matter)
	add_child(_matter)

	_hero = Sprite2D.new()
	_hero.centered = false
	_hero.scale = Vector2.ONE * S / art.kArt
	_hero.z_index = -4
	add_child(_hero)
	for en in world.enemies:
		var sp := Sprite2D.new()
		sp.centered = false
		sp.scale = Vector2.ONE * S / art.kArt
		sp.z_index = -4
		add_child(sp)
		_enemies.append({sprite = sp, data = en, fade = 0.0})

	# the fluid texture: one blob per ball, summed in HDR
	_fluid_vp = SubViewport.new()
	_fluid_vp.size = Vector2i(World.W * World.CELL, World.H * World.CELL)
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
	_fluid.material = m
	add_child(_fluid)

	for p in world.level.pins:
		var key := "%d-%d" % [n, int(p.id)]
		var pa: Dictionary = art.pins[key]
		var sp := Sprite2D.new()
		sp.texture = tex("res://assets/pins/%s.png" % key)
		sp.centered = false
		sp.scale = Vector2.ONE * S / art.kArt
		sp.position = Vector2(pa.x, pa.y) * S
		sp.z_index = 2
		add_child(sp)
		_pins[int(p.id)] = sp
		_pin_home[int(p.id)] = sp.position
	world.pulled.connect(_on_pulled)

	_fx = Node2D.new()
	_fx.z_index = 3
	var fxm := CanvasItemMaterial.new()
	fxm.blend_mode = CanvasItemMaterial.BLEND_MODE_MIX
	_fx.draw.connect(_draw_fx)
	add_child(_fx)
	_overlay = Node2D.new()
	_overlay.z_index = 4
	_overlay.draw.connect(_draw_hint)
	add_child(_overlay)
	_update_figures(0.0)


## A sprite of the baked art: `at` is a point in logical px of the web board, `origin` the same point
## inside the image (logical px).
func _art_sprite(name: String, at: Vector2, origin: Vector2) -> Sprite2D:
	var sp := Sprite2D.new()
	sp.texture = sprite_tex(name)
	sp.centered = false
	sp.scale = Vector2.ONE * S / art.kArt
	sp.position = (at - origin) * S
	add_child(sp)
	return sp


func _on_pulled(id: int) -> void:
	if hint_id == id:
		hint_id = -1
	var sp: Sprite2D = _pins.get(id)
	if sp == null:
		return
	var d: Dictionary = world.pins[id].def
	var dir := Vector2.LEFT if d.handle == "left" else (Vector2.RIGHT if d.handle == "right" else Vector2.UP)
	var len: float = ((d.h if d.handle == "top" else d.w) + 3) * World.CELL
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(sp, "position", _pin_home[id] + dir * len, 0.4).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
	tw.tween_property(sp, "modulate:a", 0.0, 0.4).set_ease(Tween.EASE_IN)
	tw.chain().tween_callback(sp.queue_free)
	_pins.erase(id)


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
			for i in 26:
				_puff(pos, "debris" if i % 2 else "flame")
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
	match kind:
		"steam": _parts.append({p = p, v = Vector2((r.call() - 0.5) * 20, -26 - r.call() * 22), t = 0.0, life = 0.9 + r.call() * 0.7, size = 3.0 + r.call() * 2.5, grow = 8.0, color = Color(0.93, 0.95, 0.98, 0.85), drag = 0.6})
		"smoke": _parts.append({p = p, v = Vector2((r.call() - 0.5) * 14, -18 - r.call() * 16), t = 0.0, life = 1.0 + r.call() * 0.6, size = 3.0 + r.call() * 2.0, grow = 6.0, color = Color(0.23, 0.2, 0.22, 0.8), drag = 0.5})
		"flame": _parts.append({p = p, v = Vector2((r.call() - 0.5) * 40, -30 - r.call() * 40), t = 0.0, life = 0.35 + r.call() * 0.3, size = 2.5 + r.call() * 2.0, grow = -3.0, color = Color(1.0, 0.6, 0.15, 1.0), drag = 1.2})
		"debris": _parts.append({p = p, v = Vector2((r.call() - 0.5) * 260, -60 - r.call() * 200), t = 0.0, life = 0.8 + r.call() * 0.5, size = 1.8 + r.call() * 1.8, grow = 0.0, color = Color(0.36, 0.29, 0.25, 1.0), drag = 0.2, fall = true})
		"gas": _parts.append({p = p, v = Vector2((r.call() - 0.5) * 16, -14 - r.call() * 10), t = 0.0, life = 1.0 + r.call() * 0.5, size = 3.0 + r.call() * 2.0, grow = 6.0, color = Color(0.6, 0.85, 0.35, 0.6), drag = 0.5})
		"confetti": _parts.append({p = p, v = Vector2((r.call() - 0.5) * 220, -120 - r.call() * 160), t = 0.0, life = 1.4 + r.call() * 0.6, size = 2.0, grow = 0.0, color = Color.from_hsv(r.call(), 0.7, 1.0), drag = 0.4, fall = true})


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
		_carved.queue_redraw()
	for k in _kegs:
		if not k.data.live and is_instance_valid(k.sprite):
			k.sprite.queue_free()
	for t in _torches:
		var f := sin(time * 13 + t.position.x) * 0.6 + sin(time * 7.3 + t.position.x * 2) * 0.4
		t.modulate = Color(1, 1, 1, 0.88 + f * 0.1)
	for id in _pins:
		var sp: Sprite2D = _pins[id]
		var off := drag_off if id == drag_id else 0.0
		var d: Dictionary = world.pins[id].def
		var dir := Vector2.LEFT if d.handle == "left" else (Vector2.RIGHT if d.handle == "right" else Vector2.UP)
		sp.position = _pin_home[id] + dir * off * World.CELL
	for p in _parts:
		p.t += delta
		p.v *= 1.0 - minf(1.0, p.drag * delta)
		if p.get("fall", false):
			p.v.y += 600 * delta
		p.p += p.v * delta
		p.size = maxf(0.5, p.size + p.grow * delta)
	_parts = _parts.filter(func(p): return p.t < p.life and p.p.y < World.H * World.CELL)
	for f in _flashes:
		f.t += delta
	_flashes = _flashes.filter(func(f): return f.t < 0.5)
	_update_figures(delta)
	_matter.queue_redraw()
	_fluid_draw.queue_redraw()
	(_fluid.material as ShaderMaterial).set_shader_parameter("t", time)
	_fx.queue_redraw()
	_overlay.queue_redraw()


# ───────────── Figures ─────────────
func _fig_pos(r: Rect2) -> Vector2:
	return (r.position * 10.0 - Vector2(art.figure.ox, art.figure.oy)) * S


func _update_figures(delta: float) -> void:
	var h: Dictionary = world.hero
	var hr: Rect2 = h.rect
	var face := "l" if world.exit_rect.position.x < hr.position.x else "r"
	var pos := _fig_pos(hr)
	var name := "hero_idle_" + face
	var alpha := 1.0
	var bob := sin(time * 2.2 + hr.position.x) * 0.6
	if phase == "walk":
		# cheer for half a second, walk to the door, go through it
		var cheer := 0.5
		var target: float = world.exit_rect.position.x
		var dist := target - hr.position.x
		var walk_t := absf(dist) / 9.0
		var tw := maxf(0.0, phase_t - cheer)
		var x := hr.position.x + signf(dist) * minf(absf(dist), tw * 9.0)
		pos = _fig_pos(Rect2(Vector2(x, hr.position.y), hr.size))
		face = "l" if dist < 0 else "r"
		if phase_t < cheer:
			name = "hero_cheer_" + face
			bob = -absf(sin(phase_t * PI * 2 / cheer)) * 5
		elif tw < walk_t:
			name = "hero_walk_%s%d" % [face, int(tw * 14 / (PI * 2) * 8) % 8]
			bob = 0.0
		else:
			name = "hero_idle_" + face
			alpha = 1.0 - clampf((tw - walk_t) / 0.5, 0, 1)
			if tw - walk_t > 1.1 and phase == "walk":
				phase = "end"
				finished_walk.emit()
		var open := clampf((tw - walk_t + 0.25) / 0.5, 0, 1)
		_door.texture = sprite_tex("door%d" % int(round(open * 4)))
	elif phase == "end" and world.status().status == "won":
		alpha = 0.0
	elif world.lost != "":
		if world.lost == "enemy":
			name = "hero_scared_" + face
			pos.x += sin(time * 40) * 0.8
		elif world.lost == "gas":
			name = "hero_poisoned"
		else:
			name = "hero_burnt"
		bob = 0.0
	_hero.texture = sprite_tex(name)
	_hero.position = pos + Vector2(0, bob * S)
	_hero.modulate.a = alpha

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
## Rock a blast broke: the chamber wall behind it, darker at the edges.
func _draw_carved() -> void:
	var c := World.CELL
	for y in World.H:
		for x in World.W:
			var i := y * World.W + x
			if world.rock_grid[i] or not _was_rock(x, y):
				continue
			# the chamber wall behind, a shade darker next to the rock that is left
			var edge := 0
			for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
				var nx: int = x + d.x
				var ny: int = y + d.y
				if nx < 0 or ny < 0 or nx >= World.W or ny >= World.H or world.rock_grid[ny * World.W + nx]:
					edge += 1
			var v := float((x * 7 + y * 13) % 5) / 5.0
			_carved.draw_rect(Rect2(x * c - 0.5, y * c - 0.5, c + 1, c + 1), Color8(50, 42, 64).darkened(0.12 * edge + 0.04 * v))


func _was_rock(x: int, y: int) -> bool:
	for r in world.level.walls:
		if x >= r.x and x < r.x + r.w and y >= r.y and y < r.y + r.h:
			return true
	return false


## Gold coins, stone lumps and a few twinkles on top of the pile.
func _draw_matter() -> void:
	var coin := sprite_tex("coin")
	var tilt := sprite_tex("coinTilt")
	var size := Vector2.ONE * 12.0 * S
	var i := 0
	for b in world.balls:
		if b.get_meta("type") != "gold" or b.get_meta("gone", false):
			continue
		i += 1
		_matter.draw_set_transform(b.position, b.rotation * 0.25, Vector2.ONE)
		_matter.draw_texture_rect(tilt if i % 5 < 2 else coin, Rect2(-size / 2, size), false)
	for s in world.stones:
		if s.get_meta("gone", false):
			continue
		i += 1
		_matter.draw_set_transform(s.position, s.rotation, Vector2.ONE)
		_matter.draw_texture_rect(sprite_tex("stone%d" % (i % 3)), Rect2(-size / 2, size), false)
	_matter.draw_set_transform(Vector2.ZERO, 0, Vector2.ONE)
	# twinkles
	var spark := sprite_tex("sparkle")
	var n := 0
	for b in world.balls:
		if n >= 6 or b.get_meta("type") != "gold":
			continue
		var ph := time * 0.9 + float(b.get_instance_id() % 97) * 0.13
		var slot := floorf(ph)
		if fmod(slot * 0.618 + float(b.get_instance_id() % 13) * 0.31, 1.0) > 0.08:
			continue
		var a := sin((ph - slot) * PI)
		var r := (3.0 + a * 4.0) * S
		_matter.draw_texture_rect(spark, Rect2(b.position - Vector2(r, r), Vector2(r, r) * 2), false, Color(1, 1, 1, a))
		n += 1


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


func _draw_fx() -> void:
	for f in _flashes:
		var p: float = f.t / 0.5
		var rad := (World.BLAST_R + 1) * World.CELL * (0.6 + p * 0.9)
		_fx.draw_texture_rect(_glow, Rect2(f.p - Vector2(rad, rad), Vector2(rad, rad) * 2), false, Color(1.6, 1.2, 0.6, (1 - p) * 0.9))
	for p in _parts:
		var c: Color = p.color
		c.a *= clampf(1.0 - p.t / p.life, 0, 1)
		if p.get("fall", false):
			_fx.draw_rect(Rect2(p.p - Vector2(p.size, p.size) * 0.5, Vector2(p.size, p.size)), c)
		else:
			_fx.draw_texture_rect(_glow, Rect2(p.p - Vector2(p.size, p.size) * 1.5, Vector2(p.size, p.size) * 3), false, c)
	# lava lights the rock around it
	for b in world.balls:
		if b.get_meta("type") == "lava" and b.get_instance_id() % 4 == 0 and not b.get_meta("gone", false):
			_fx.draw_texture_rect(_glow, Rect2(b.position - Vector2(26, 26), Vector2(52, 52)), false, Color(1.0, 0.45, 0.1, 0.16))


## The hint: a pulsing ring around the handle of the pin to pull, and an arrow the way to pull it.
func _draw_hint() -> void:
	if hint_id < 0 or not world.pins.has(hint_id) or world.pins[hint_id].pulled:
		return
	var d: Dictionary = world.pins[hint_id].def
	var hc := handle_cell(d)
	var c := (hc + Vector2(0.5, 0.5)) * World.CELL
	var pulse := 0.5 + 0.5 * sin(time * 6)
	_overlay.draw_arc(c, 13 + pulse * 5, 0, TAU, 40, Color(1, 0.85, 0.35, 0.9 - pulse * 0.5), 2.5, true)
	var dir := Vector2.LEFT if d.handle == "left" else (Vector2.RIGHT if d.handle == "right" else Vector2.UP)
	var tip := c + dir * (30 + pulse * 6)
	var base := c + dir * 18
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


## The pin under a point (world px), or -1: its bar grown by a cell, or two cells around its ring.
func pin_at(pt: Vector2) -> int:
	var best := -1
	var best_d := INF
	for id in world.pins:
		if world.pins[id].pulled:
			continue
		var d: Dictionary = world.pins[id].def
		var bar := Rect2(Vector2(d.x, d.y) * World.CELL, Vector2(d.w, d.h) * World.CELL).grow(World.CELL)
		var ring := (handle_cell(d) + Vector2(0.5, 0.5)) * World.CELL
		var dist := ring.distance_to(pt)
		if dist < World.CELL * 2.5 and dist < best_d:
			best = id
			best_d = dist
		elif bar.has_point(pt) and best < 0:
			best = id
	return best
