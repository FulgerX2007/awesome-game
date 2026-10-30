class_name PinsWorld
extends Node2D
## Тяни штифт on Godot: one level as a real 2D physics world. The level data is the grid of web/pins
## (36×54 cells, see tools/pins-godot/data.cjs); here every cell of water, lava, gold and gas becomes a
## small rigid ball, rock and pins become static boxes, and the rules of web/pins/core.js are kept:
##   lava + water → stone (the lava ball freezes in place, the water ball is gone); the new stone stays red-hot
##   for a while and boils away all the water that falls on it,
##   lava burns gold and gas, lava sets off a powder keg, gas rises and bubbles up through water,
##   an enemy dies when lava or gas touches it, the hero is lost when it does,
##   an enemy that can reach the hero through open space gets him,
##   gold that gets into the hero's room is drawn to him and is his once it touches him,
##   when everything has come to rest: enough gold in the room and no lava or gas on the way to the door wins.
## No rendering here (game.gd draws), so the headless tests run exactly the world the player sees.

signal pulled(id: int)
signal reacted(kind: String, pos: Vector2)   # steam, sizzle, poof, blast, kill_lava, kill_gas, kill_blast
signal gold_taken(pos: Vector2)              # a ball of gold reached the hero

const CELL := 12.0
const W := 36
const H := 54
const R_BALL := CELL * 0.5
const KILL := 3                # balls of lava or gas touching an enemy within KILL_WINDOW to kill it
const KILL_WINDOW := 1.0       # s: a cloud of gas drifting past counts every ball that brushed the enemy
const GAS_KILL := 2            # gas drifts by and spreads out: fewer balls of it are enough
const HERO_KILL := 2           # ...or the hero to lose
const BLAST_R := 4.5           # cells wiped out around a keg that goes off
const QUIET_SPEED := 24.0      # px/s: slower than this counts as resting
const QUIET_TIME := 0.6        # s of rest that settles the world
const SETTLE_CAP := 10.0       # s after a pull when a still jittering world counts as settled anyway
const PULL_TIME := 0.22        # s a pin takes to slide out
const MAGNET := 1500.0         # px/s² the hero draws the gold in his room with
const REACH := R_BALL * 1.4    # px from the hero's box where gold is his
const HOT_TIME := 2.5          # s a stone fresh from lava boils away water that touches it...
const HOT_KEEP := 1.0          # ...and each ball it boils keeps it hot at least this much longer

# Collision layers (bits)
const L_SOLID := 1
const L_WATER := 2
const L_LAVA := 4
const L_GOLD := 8
const L_GAS := 16

var level: Dictionary
var rock_grid := PackedByteArray()  # 1 = rock; a blast carves it
var rock: StaticBody2D
var rock_version := 0          # bumped when a blast changes the rock (the view redraws it)
var pins := {}                 # id -> {body, def, pulled}
var balls: Array[RigidBody2D] = []
var stones: Array[RigidBody2D] = []
var kegs: Array = []           # {body, rect (cells), live}
var hero: Dictionary           # {rect (cells), body, area}
var enemies: Array = []        # {rect, body, area, dead, cause}
var room: Rect2                # cells
var exit_rect: Rect2           # cells
var gold_target := 0
var gold_taken_n := 0          # gold the hero already holds (still counts as gold in the room)
var lost := ""                 # "" | "lava" | "gas" | "blast" | "enemy"
var since_pull := 0.0
var quiet := 0.0
var time := 0.0
var settle_log: Array = []     # seconds each pull took to settle (for tuning)
var _pending_kill: Array = []  # balls to remove after the physics step
var _materials := {}


## The cell of a pin's ring (handleCell in web/pins/core.js).
static func _handle_cell(p: Dictionary) -> Vector2i:
	if p.handle == "left":
		return Vector2i(int(p.x) - 1, int(p.y) + ((int(p.h) - 1) >> 1))
	if p.handle == "right":
		return Vector2i(int(p.x + p.w), int(p.y) + ((int(p.h) - 1) >> 1))
	return Vector2i(int(p.x) + ((int(p.w) - 1) >> 1), int(p.y) - 1)


static func px(r: Dictionary) -> Rect2:
	return Rect2(r.x * CELL, r.y * CELL, r.w * CELL, r.h * CELL)


static func cells(r: Dictionary) -> Rect2:
	return Rect2(r.x, r.y, r.w, r.h)


func _material(friction: float, bounce: float) -> PhysicsMaterial:
	var key := "%s/%s" % [friction, bounce]
	if not _materials.has(key):
		var m := PhysicsMaterial.new()
		m.friction = friction
		m.bounce = bounce
		_materials[key] = m
	return _materials[key]


## Builds the level: rock, pins, matter, kegs, the hero and the enemies.
func build(def: Dictionary) -> void:
	level = def
	room = cells(def.room)
	exit_rect = cells(def.exit)
	gold_target = int(def.goldTarget)
	rock_grid.resize(W * H)
	for r in def.walls:
		_fill(rock_grid, cells(r))
	# The levels carve a pocket for each pin's ring. On the grid nothing slips through a corner,
	# but a ball would roll into the pocket, so here the pockets stay rock (the ring is drawn over it).
	for p in def.pins:
		var hc := _handle_cell(p)
		if hc.x >= 0 and hc.y >= 0 and hc.x < W and hc.y < H:
			rock_grid[hc.y * W + hc.x] = 1
	_build_rock()
	for p in def.pins:
		var b := AnimatableBody2D.new()
		b.collision_layer = L_SOLID
		b.collision_mask = 0
		b.sync_to_physics = false
		b.physics_material_override = _material(0.3, 0.0)
		b.position = px(p).get_center()
		var s := CollisionShape2D.new()
		var shape := RectangleShape2D.new()
		shape.size = px(p).size
		s.shape = shape
		b.add_child(s)
		add_child(b)
		pins[int(p.id)] = {body = b, def = p, pulled = false}
	# Balls in perfect columns would stand like a stack of coins; a small offset lets them flow.
	# The generator is seeded by the level, so a level always starts the same.
	var rng := RandomNumberGenerator.new()
	rng.seed = int(def.n) * 7919
	for f in def.fills:
		if f.type == "bomb":
			_keg(f)
			continue
		for y in int(f.h):
			for x in int(f.w):
				var jitter := Vector2(rng.randf_range(-0.12, 0.12), rng.randf_range(-0.04, 0.04)) * CELL
				_ball(f.type, Vector2((f.x + x + 0.5) * CELL, (f.y + y + 0.5) * CELL) + jitter)
	hero = _entity(def.hero)
	for e in def.enemies:
		var en := _entity(e)
		en.dead = false
		en.cause = ""
		en.touched = {}        # instance id of a lava or gas ball -> [type, time it last touched]
		enemies.append(en)


## The rock as few boxes: runs of rock per row, merged downwards while the same run repeats
## (the rock() of web/pins/levels.js).
func _build_rock() -> void:
	if rock:
		rock.queue_free()
	rock = StaticBody2D.new()
	rock.collision_layer = L_SOLID
	rock.collision_mask = 0
	rock.physics_material_override = _material(0.6, 0.0)
	add_child(rock)
	var active := {}
	var rects: Array[Rect2] = []
	for y in H:
		var next := {}
		var x := 0
		while x < W:
			if not rock_grid[y * W + x]:
				x += 1
				continue
			var e := x
			while e < W and rock_grid[y * W + e]:
				e += 1
			var key := "%d,%d" % [x, e]
			if active.has(key):
				var i: int = active[key]
				rects[i].size.y += 1
				next[key] = i
			else:
				rects.append(Rect2(x, y, e - x, 1))
				next[key] = rects.size() - 1
			x = e
		active = next
	for r in rects:
		_box(rock, Rect2(r.position * CELL, r.size * CELL))
	rock_version += 1
	_wake_all()


func _box(body: CollisionObject2D, r: Rect2) -> void:
	var s := CollisionShape2D.new()
	var shape := RectangleShape2D.new()
	shape.size = r.size
	s.shape = shape
	s.position = r.get_center() - (body as Node2D).position
	body.add_child(s)


## One ball of matter. Water and lava have no friction so they flow and level out; gold is heavy
## and grainy so it piles and sinks through water; gas floats up and passes through water.
func _ball(type: String, pos: Vector2) -> RigidBody2D:
	var b := RigidBody2D.new()
	b.position = pos
	b.set_meta("type", type)
	b.can_sleep = true
	b.continuous_cd = RigidBody2D.CCD_MODE_DISABLED
	var s := CollisionShape2D.new()
	var shape := CircleShape2D.new()
	shape.radius = R_BALL * 0.92
	s.shape = shape
	b.add_child(s)
	match type:
		"water":
			b.collision_layer = L_WATER
			b.collision_mask = L_SOLID | L_WATER | L_LAVA | L_GOLD
			b.mass = 1.0
			b.physics_material_override = _material(0.0, 0.0)
			b.linear_damp = 0.2
		"lava":
			b.collision_layer = L_LAVA
			b.collision_mask = L_SOLID | L_WATER | L_LAVA | L_GOLD | L_GAS
			b.mass = 1.4
			b.physics_material_override = _material(0.02, 0.0)
			b.linear_damp = 3.0
			b.contact_monitor = true
			b.max_contacts_reported = 6
			b.body_entered.connect(_on_lava_contact.bind(b))
		"gold":
			b.collision_layer = L_GOLD
			b.collision_mask = L_SOLID | L_WATER | L_LAVA | L_GOLD
			b.mass = 4.0
			b.physics_material_override = _material(0.45, 0.0)
			b.linear_damp = 0.3
		"gas":
			b.collision_layer = L_GAS
			b.collision_mask = L_SOLID | L_LAVA | L_GAS
			b.mass = 0.5
			b.gravity_scale = -0.8
			b.physics_material_override = _material(0.0, 0.0)
			b.linear_damp = 1.5
	add_child(b)
	balls.append(b)
	return b


func _keg(f: Dictionary) -> void:
	var b := StaticBody2D.new()
	b.collision_layer = L_SOLID
	b.collision_mask = 0
	b.physics_material_override = _material(0.5, 0.0)
	add_child(b)
	_box(b, px(f))
	kegs.append({body = b, rect = cells(f), live = true})


## The hero and enemies are solid boxes (matter piles against them) with a sensor a little larger
## that counts the lava and gas touching them.
func _entity(r: Dictionary) -> Dictionary:
	var rect := px(r)
	var b := StaticBody2D.new()
	b.collision_layer = L_SOLID
	b.collision_mask = 0
	b.physics_material_override = _material(0.5, 0.0)
	add_child(b)
	_box(b, rect.grow(-1))
	var a := Area2D.new()
	a.collision_layer = 0
	a.collision_mask = L_LAVA | L_GAS
	a.monitorable = false
	var s := CollisionShape2D.new()
	var shape := RectangleShape2D.new()
	shape.size = rect.grow(3).size
	s.shape = shape
	s.position = rect.get_center()
	a.add_child(s)
	add_child(a)
	return {rect = cells(r), body = b, area = a}


## The level is won and the hero walks to the door: his box leaves the world, so the water he stood in
## closes up behind him instead of keeping his shape.
func release_hero() -> void:
	if is_instance_valid(hero.body):
		hero.body.queue_free()


# ───────────── Player action ─────────────
## Slides a pin out of the rock. Returns false for an unknown or already pulled pin.
func pull(id: int, instant := false) -> bool:
	if not pins.has(id) or pins[id].pulled:
		return false
	var p: Dictionary = pins[id]
	p.pulled = true
	since_pull = 0.0
	quiet = 0.0
	var d: Dictionary = p.def
	var dir := Vector2.LEFT if d.handle == "left" else (Vector2.RIGHT if d.handle == "right" else Vector2.UP)
	var dist: float = (d.w if d.handle != "top" else d.h) * CELL + CELL
	var body: AnimatableBody2D = p.body
	# Removing a body does not wake what slept on it, so everything is woken once the pin is out.
	var gone := func():
		body.queue_free()
		_wake_all()
	if instant:
		gone.call()
	else:
		var tw := create_tween().set_process_mode(Tween.TWEEN_PROCESS_PHYSICS)
		tw.tween_property(body, "position", body.position + dir * dist, PULL_TIME).set_ease(Tween.EASE_IN)
		tw.tween_callback(gone)
	_wake_all()
	pulled.emit(id)
	return true


func _wake_all() -> void:
	for b in balls + stones:
		b.sleeping = false


# ───────────── Reactions ─────────────
func _on_lava_contact(other: Node, lava: RigidBody2D) -> void:
	if not is_instance_valid(lava) or lava.get_meta("type") != "lava" or lava.get_meta("gone", false):
		return
	if not other is RigidBody2D or other.get_meta("gone", false):
		_check_keg_touch(lava, other)
		return
	match other.get_meta("type", ""):
		"water":
			_remove(other)
			_to_stone(lava)
			reacted.emit("steam", lava.position)
		"gold":
			_remove(other)
			reacted.emit("sizzle", other.position)
		"gas":
			_remove(other)
			reacted.emit("poof", other.position)


func _check_keg_touch(lava: RigidBody2D, other: Node) -> void:
	for k in kegs:
		if k.live and k.body == other:
			_explode(k)
			return


func _remove(b: RigidBody2D) -> void:
	if b.get_meta("gone", false):
		return
	b.set_meta("gone", true)
	_pending_kill.append(b)


## Lava touched by water sets into stone: a heavy, rough ball. It stays where it is while something
## holds it and falls when that goes, so a crust over a shaft drops with the pin under it.
## It is red-hot at first (see _boil): the water that keeps pouring onto it turns to steam.
func _to_stone(b: RigidBody2D) -> void:
	b.set_meta("type", "stone")
	b.set_meta("hot_until", time + HOT_TIME)
	balls.erase(b)
	stones.append(b)
	b.set_deferred("collision_layer", L_SOLID)
	b.set_deferred("collision_mask", L_SOLID | L_WATER | L_LAVA | L_GOLD | L_GAS)
	b.set_deferred("mass", 3.0)
	b.set_deferred("linear_damp", 0.5)
	b.set_deferred("physics_material_override", _material(0.8, 0.0))


## A keg goes off: everything within BLAST_R cells of it is wiped out (rock and pins hold), other kegs
## in reach go off too, enemies in it die and the hero in it is lost. Everything further out is pushed.
func _explode(k: Dictionary) -> void:
	if not k.live:
		return
	k.live = false
	var c: Vector2 = (k.rect as Rect2).get_center() * CELL
	var reach := ((k.rect as Rect2).size.x * 0.5 + BLAST_R) * CELL
	k.body.queue_free()
	reacted.emit("blast", c)
	for b in balls + stones:
		if b.get_meta("gone", false):
			continue
		var d := b.position.distance_to(c)
		if d < reach:
			_remove(b)
		elif d < reach * 2:
			b.sleeping = false
			b.apply_central_impulse((b.position - c).normalized() * b.mass * 260.0 * (1.0 - d / (reach * 2)))
	for e in enemies:
		if not e.dead and _rect_near(e.rect, c, reach):
			_kill(e, "blast")
	if lost == "" and _rect_near(hero.rect, c, reach):
		lost = "blast"
	# rock within reach is gone too; the frame of the board holds
	var carved := false
	for y in range(1, H - 1):
		for x in range(1, W - 1):
			if rock_grid[y * W + x] and Vector2((x + 0.5) * CELL, (y + 0.5) * CELL).distance_to(c) < reach:
				rock_grid[y * W + x] = 0
				carved = true
	if carved:
		_build_rock.call_deferred()
	for other in kegs:
		if other.live and ((other.rect as Rect2).get_center() * CELL).distance_to(c) < reach + CELL:
			_explode.call_deferred(other)
	_wake_all()


func _rect_near(r: Rect2, c: Vector2, reach: float) -> bool:
	var rp := Rect2(r.position * CELL, r.size * CELL)
	var q := Vector2(clampf(c.x, rp.position.x, rp.end.x), clampf(c.y, rp.position.y, rp.end.y))
	return q.distance_to(c) < reach


func _kill(e: Dictionary, cause: String) -> void:
	e.dead = true
	e.cause = cause
	e.body.queue_free()
	e.area.set_deferred("monitoring", false)
	reacted.emit("kill_" + cause, (e.rect as Rect2).get_center() * CELL)


# ───────────── Entities ─────────────
func _touching(area: Area2D, type: String) -> int:
	var n := 0
	for b in area.get_overlapping_bodies():
		if b.get_meta("type", "") == type and not b.get_meta("gone", false):
			n += 1
	return n


func _check_entities() -> void:
	for e in enemies:
		if e.dead:
			continue
		var seen: Dictionary = e.touched
		for b in e.area.get_overlapping_bodies():
			var t: String = b.get_meta("type", "")
			if (t == "lava" or t == "gas") and not b.get_meta("gone", false):
				seen[b.get_instance_id()] = [t, time]
		var n := {lava = 0, gas = 0}
		for id in seen.keys():
			if time - seen[id][1] > KILL_WINDOW:
				seen.erase(id)
			else:
				n[seen[id][0]] += 1
		if n.lava >= KILL:
			_kill(e, "lava")
		elif n.gas >= GAS_KILL:
			_kill(e, "gas")
	if lost == "":
		if _touching(hero.area, "lava") >= HERO_KILL:
			lost = "lava"
		elif _touching(hero.area, "gas") >= HERO_KILL:
			lost = "gas"
	if lost == "" and enemy_reaches_hero():
		lost = "enemy"


## What blocks a walker on the 36×54 grid now: rock, pins still in, stone, kegs and lava.
func blocked_grid() -> PackedByteArray:
	var g := rock_grid.duplicate()
	for id in pins:
		if not pins[id].pulled:
			_fill(g, cells(pins[id].def))
	for k in kegs:
		if k.live:
			_fill(g, k.rect)
	for b in stones + balls:
		var t: String = b.get_meta("type")
		if (t == "stone" or t == "lava") and not b.get_meta("gone", false):
			var c := Vector2i(b.position / CELL)
			if c.x >= 0 and c.x < W and c.y >= 0 and c.y < H:
				g[c.y * W + c.x] = 1
	return g


func _fill(g: PackedByteArray, r: Rect2) -> void:
	for y in range(int(r.position.y), int(r.end.y)):
		for x in range(int(r.position.x), int(r.end.x)):
			if x >= 0 and x < W and y >= 0 and y < H:
				g[y * W + x] = 1


## Flood fill through open cells from every live enemy: true if one reaches the hero (like core.js).
func enemy_reaches_hero() -> bool:
	var live := enemies.filter(func(e): return not e.dead)
	if live.is_empty():
		return false
	var g := blocked_grid()
	var seen := PackedByteArray()
	seen.resize(W * H)
	var q: Array[int] = []
	for e in live:
		var r: Rect2 = e.rect
		for y in range(int(r.position.y), int(r.end.y)):
			for x in range(int(r.position.x), int(r.end.x)):
				var i := y * W + x
				if not seen[i]:
					seen[i] = 1
					q.append(i)
	var hr: Rect2 = hero.rect
	var head := 0
	while head < q.size():
		var i := q[head]
		head += 1
		var x := i % W
		var y := i / W
		if hr.has_point(Vector2(x, y)):
			return true
		for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var nx: int = x + d.x
			var ny: int = y + d.y
			if nx < 0 or ny < 0 or nx >= W or ny >= H:
				continue
			var j := ny * W + nx
			if seen[j] or g[j]:
				continue
			seen[j] = 1
			q.append(j)
	return false


# ───────────── State ─────────────
func gold_in_room() -> int:
	var n := gold_taken_n
	var r := Rect2(room.position * CELL, room.size * CELL)
	for b in balls:
		if b.get_meta("type") == "gold" and not b.get_meta("gone", false) and r.has_point(b.position):
			n += 1
	return n


func live_enemies() -> int:
	return enemies.filter(func(e): return not e.dead).size()


## Lava or gas in the room between the hero and the door, on the rows of the hero's box.
func hazard_on_way() -> String:
	var hr: Rect2 = hero.rect
	var x0 := minf(hr.position.x, exit_rect.position.x) * CELL
	var x1 := maxf(hr.end.x, exit_rect.end.x) * CELL
	var y0 := hr.position.y * CELL
	var y1 := hr.end.y * CELL
	var found := ""
	for b in balls:
		var t: String = b.get_meta("type")
		if (t == "lava" or t == "gas") and not b.get_meta("gone", false):
			var p := b.position
			if p.x >= x0 and p.x <= x1 and p.y >= y0 and p.y <= y1:
				if t == "lava":
					return "lava"
				found = "gas"
	return found


func settled() -> bool:
	return quiet >= QUIET_TIME or since_pull >= SETTLE_CAP


func pins_left() -> int:
	var n := 0
	for id in pins:
		if not pins[id].pulled:
			n += 1
	return n


## {status: "playing" | "won" | "lost", reason: "" | "lava" | "gas" | "blast" | "enemy" | "nogold"}
func status() -> Dictionary:
	if lost != "":
		return {status = "lost", reason = lost}
	if not settled():
		return {status = "playing", reason = ""}
	var blocked := hazard_on_way()
	if blocked == "" and gold_in_room() >= gold_target:
		return {status = "won", reason = ""}
	if pins_left() > 0:
		return {status = "playing", reason = ""}
	return {status = "lost", reason = blocked if blocked != "" else "nogold"}


## 3 with every enemy dead and ≥1.5× the target gold, 2 when either holds, 1 otherwise; 0 unless won.
func stars() -> int:
	if status().status != "won":
		return 0
	return 1 + (1 if live_enemies() == 0 else 0) + (1 if gold_in_room() * 2 >= gold_target * 3 else 0)


func _physics_process(delta: float) -> void:
	time += delta
	since_pull += delta
	for b in _pending_kill:
		balls.erase(b)
		stones.erase(b)
		if is_instance_valid(b):
			b.queue_free()
	_pending_kill.clear()
	# Balls that fall out of the board (through a gap at the frame) are gone.
	for b in balls + stones:
		if b.position.y > H * CELL + 40 or b.position.y < -40:
			_remove(b)
	_check_entities()
	_boil()
	_draw_gold()
	# Rest means almost nothing moves: a ball or two always shiver on a flat puddle, they don't count.
	var moving := 0
	for b in balls + stones:
		if not b.sleeping and b.linear_velocity.length() > QUIET_SPEED:
			moving += 1
	var fast := moving > maxi(2, balls.size() / 50)
	for id in pins:
		if pins[id].pulled and is_instance_valid(pins[id].body):
			fast = true  # still sliding out
	var was := settled()
	quiet = 0.0 if fast else quiet + delta
	if settled() and not was:
		settle_log.append(snappedf(since_pull, 0.1) if since_pull < SETTLE_CAP else "cap:%s" % _slowest())


## Water that touches a red-hot stone boils away; while water keeps coming the stone stays hot, so a
## stream falling on lava steams off completely instead of piling up on the new crust.
func _boil() -> void:
	for s in stones:
		var until: float = s.get_meta("hot_until", 0.0)
		if until <= time or s.get_meta("gone", false):
			continue
		for o in s.get_colliding_bodies():
			if o is RigidBody2D and o.get_meta("type", "") == "water" and not o.get_meta("gone", false):
				_remove(o)
				reacted.emit("steam", o.position)
				until = maxf(until, time + HOT_KEEP)
		s.set_meta("hot_until", until)


## How hot a stone still is, 1 just set to 0 cold (for the view).
func heat(s: RigidBody2D) -> float:
	return clampf((s.get_meta("hot_until", 0.0) - time) / HOT_TIME, 0.0, 1.0)


## Gold in the hero's room is pulled to him (a pull, not a jump: rock and pins in the way still stop it);
## a ball that comes within REACH of him is gone from the world and counted as his.
func _draw_gold() -> void:
	var r := Rect2(room.position * CELL, room.size * CELL)
	var hr: Rect2 = hero.rect
	var hb := Rect2(hr.position * CELL, hr.size * CELL)
	var near := hb.grow(REACH)
	var c := hb.get_center()
	for b in balls:
		if b.get_meta("type") != "gold" or b.get_meta("gone", false) or not r.has_point(b.position):
			continue
		if near.has_point(b.position):
			gold_taken_n += 1
			_remove(b)
			gold_taken.emit(b.position)
			continue
		if not b.get_meta("drawn", false):
			# from now on it slips through water and the other coins (nothing heavy can pin it down)
			# and hardly falls; rock, pins, the hero and lava still stop it
			b.set_meta("drawn", true)
			b.collision_layer = 0
			b.collision_mask = L_SOLID | L_LAVA
			b.physics_material_override = _material(0.0, 0.0)
			b.gravity_scale = 0.3
			b.linear_damp = 2.0
		b.sleeping = false
		b.apply_central_force((c - b.position).normalized() * MAGNET * b.mass)


## What keeps the world from resting, for tuning: the type and speed of the fastest ball.
func _slowest() -> String:
	var best: RigidBody2D = null
	for b in balls:
		if best == null or b.linear_velocity.length() > best.linear_velocity.length():
			best = b
	return "%s %.0f" % [best.get_meta("type"), best.linear_velocity.length()] if best else "-"
