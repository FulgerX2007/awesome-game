class_name StoneGuardian
extends Node3D
## The Stone Guardian of the Island of Addition: an original boss built from the island's own rocks.
##
## Three phases, each the same rhythm: the Guardian attacks a couple of times, always telegraphed (a glowing
## ring, a raised boulder, a shadow on the ground, a warning sound), then gets tired and sits down. Tired, it
## waits for as long as it takes while the child walks to the glowing rune and solves its challenge:
##   1. addition breaks the blue shield;
##   2. subtraction starts the arena mechanism: stone stairs rise toward the Guardian;
##   3. a last challenge on top of the stairs, in the child's weakest skill, calms the Guardian.
## Nothing moves while a challenge is open, a wrong answer only makes it laugh, and a hit only costs a heart.
## The scene places it at the right end of the arena, on ground level (y = 0).

signal changed(phase_text: String, progress: int)
signal defeated

enum State { WAITING, INTRO, ATTACK, TIRED, REACT, DEFEATED }

const PHASE_TEXT := ["Stone Guardian: shield", "Stone Guardian: stairs", "Stone Guardian: last spell", "Stone Guardian is calm"]
const EYE_COLORS := [Color("#5ee1ff"), Color("#ffb347"), Color("#ff5fd2")]
const BODY_TINTS := [Color(0.9, 0.95, 1.1), Color(1.05, 0.9, 0.8), Color(0.8, 0.7, 0.95)]
const ARENA_LEFT := -21.0        # arena start, relative to the Guardian
const INTRO_X := -20.0           # the fight starts when the mage passes this
const TELEGRAPH := 1.3           # seconds of warning before anything can hit
const STAIRS := [[-10.0, 1.2], [-8.0, 2.4], [-6.0, 3.6]]  # x offset, height

var state := State.WAITING
var phase := 0
var attacks_left := 0
var _wait := 0.0                 # time until the next attack
var _hazards: Array = []         # active attacks: {kind, x, t, node, ...}
var level: Level
var runes: Array[BossRune] = []
var _stairs: Array[Ground] = []

var _body_root: Node3D           # everything that moves together
var _torso: Node3D
var _head: Node3D
var _arm_l: Node3D
var _arm_r: Node3D
var _eyes: Array[MeshInstance3D] = []
var _core: MeshInstance3D
var _shield: MeshInstance3D
var _collider: StaticBody3D
var _wall: StaticBody3D
var _zz: Label3D
var _parts: Array[Node3D] = []
var _t := 0.0


func _ready() -> void:
	add_to_group("boss")
	_build_body()
	for i in 3:
		var r := BossRune.new()
		r.name = "Rune%d" % (i + 1)
		r.phase = i
		r.guardian = self
		r.objective = ["Dodge the attacks. Then touch the blue crystal!", "Dodge again. Then pull the orange crystal!", "Climb the stairs to the purple crystal!"][i]
		r.position = [Vector3(-16, 0, 0), Vector3(-19, 0, 0), Vector3(STAIRS[2][0], STAIRS[2][1], 0)][i]
		add_child(r)
		runes.append(r)
	runes[2].visible = false  # it waits on top of the stairs, which are still underground
	for s in STAIRS:  # the arena mechanism: columns hidden in the ground until phase 2
		var g := Ground.new()
		g.style = "terrain"
		g.length = 1
		g.rows = 1
		g.height = int(s[1]) + 3
		g.position = Vector3(s[0], -0.1, 0)  # the column's origin is its top: just under the arena floor
		add_child(g)
		_stairs.append(g)
		g.visible = false
	_collider = StaticBody3D.new()  # nobody walks through the Guardian
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(5.0, 14.0, 4.0)
	cs.shape = box
	cs.position = Vector3(0.5, 7.0, 0)
	_collider.add_child(cs)
	add_child(_collider)
	_wall = StaticBody3D.new()  # an invisible wall at the arena's left edge, only during the fight
	var wcs := CollisionShape3D.new()
	var wb := BoxShape3D.new()
	wb.size = Vector3(0.5, 14.0, 4.0)
	wcs.shape = wb
	wcs.position = Vector3(ARENA_LEFT - 0.3, 7.0, 0)
	_wall.add_child(wcs)
	_wall.process_mode = Node.PROCESS_MODE_DISABLED
	add_child(_wall)
	_body_root.position.y = -7.0  # asleep under the ground until the mage arrives
	level = Level.of(self)


func _build_body() -> void:
	_body_root = Node3D.new()
	add_child(_body_root)
	_torso = _part("hexagon/mountain_B", Vector3(0, 0, -0.3), 2.6, Vector3(0, 30, 0))
	var belly := _part("hexagon/rock_single_E", Vector3(0, 0.3, 0.6), 9.0, Vector3(0, 0, 0))
	_head = Node3D.new()
	_head.position = Vector3(0, 3.9, 0.2)
	_body_root.add_child(_head)
	var skull := Art.instance("hexagon/rock_single_D")
	skull.scale = Vector3.ONE * 8.0
	skull.position.y = -0.2
	_head.add_child(skull)
	_parts.append(skull)
	for side in [-1, 1]:
		var eye := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.2
		sm.height = 0.4
		eye.mesh = sm
		eye.position = Vector3(side * 0.42, 0.35, 0.95)
		_head.add_child(eye)
		_eyes.append(eye)
	for side in [-1, 1]:
		var pivot := Node3D.new()
		pivot.position = Vector3(side * 2.0, 3.2, 0.3)
		_body_root.add_child(pivot)
		var arm := Art.instance("hexagon/rock_single_C")
		arm.scale = Vector3(7.0, 11.0, 7.0)
		arm.position = Vector3(side * 0.3, -2.2, 0)
		pivot.add_child(arm)
		_parts.append(arm)
		if side < 0:
			_arm_l = pivot
		else:
			_arm_r = pivot
	_core = MeshInstance3D.new()  # the crystal heart that shows the phase
	var pm := PrismMesh.new()
	pm.size = Vector3(0.7, 0.9, 0.3)
	_core.mesh = pm
	_core.position = Vector3(0, 2.4, 1.25)
	_body_root.add_child(_core)
	_shield = MeshInstance3D.new()
	var ss := SphereMesh.new()
	ss.radius = 3.6
	ss.height = 7.2
	_shield.mesh = ss
	_shield.material_override = Art.material(Color("#7fdcff"), 0.6, 0.22)
	_shield.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_shield.position.y = 2.6
	_body_root.add_child(_shield)
	_zz = Art.label("z z z", 80, Color("#bde0ff"))
	_zz.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_zz.position = Vector3(0.8, 5.6, 0.5)
	_zz.visible = false
	_body_root.add_child(_zz)
	_parts.append_array([_torso, belly])
	_paint()


func _part(key: String, pos: Vector3, s: float, rot: Vector3) -> Node3D:
	var n := Art.instance(key)
	n.position = pos
	n.scale = Vector3.ONE * s
	n.rotation_degrees = rot
	_body_root.add_child(n)
	return n


## Eyes, core and stone color tell which phase it is; tired eyes are dim.
func _paint() -> void:
	var p := mini(phase, 2)
	var tired := state == State.TIRED
	for e in _eyes:
		e.material_override = Art.material(EYE_COLORS[p], 0.6 if tired else 3.0)
	_core.material_override = Art.material(EYE_COLORS[p], 2.5)
	for part in _parts:
		for m in part.find_children("*", "MeshInstance3D", true, false):
			var key: String = "hexagon/" + String(m.name)
			if ResourceLoader.exists(Art.path(key)):
				(m as MeshInstance3D).material_override = Art.tinted(key, BODY_TINTS[p])


func _physics_process(delta: float) -> void:
	_t += delta
	if state == State.WAITING:
		if level and level.player and level.player.global_position.x > global_position.x + INTRO_X:
			_intro()
		return
	if MathChallengeManager.is_active() or state in [State.INTRO, State.REACT, State.DEFEATED]:
		_idle_motion(delta)
		return
	_idle_motion(delta)
	_update_hazards(delta)
	if state == State.ATTACK:
		_wait -= delta
		if _wait <= 0.0 and attacks_left > 0:
			attacks_left -= 1
			_start_attack()
			_wait = 2.6
		elif attacks_left <= 0 and _hazards.is_empty() and _wait <= 0.0:
			_set_tired()


func _idle_motion(_delta: float) -> void:
	if state == State.DEFEATED:
		return
	var breathe := sin(_t * (1.2 if state == State.TIRED else 2.0))
	_head.position.y = 3.9 + breathe * 0.06 - (0.5 if state == State.TIRED else 0.0)
	_head.rotation.z = sin(_t * 0.7) * 0.04
	if _shield.visible:
		_shield.scale = Vector3.ONE * (1.0 + sin(_t * 3.0) * 0.015)


func _intro() -> void:
	state = State.INTRO
	if level:
		level.player.controls_enabled = false
		level.camera.min_x = global_position.x - 9.5
		level.camera.max_x = global_position.x - 9.5
		level.camera.zoom = 1.45
		_wall.process_mode = Node.PROCESS_MODE_INHERIT  # the arena closes behind the mage until the end
		level.say("The Stone Guardian wakes up!")
	Sfx.play("rumble")
	var tw := create_tween()
	tw.tween_property(_body_root, "position:y", 0.0, 2.2).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	await tw.finished
	level.camera.shake(0.3, 0.5)
	Sfx.play("slam")
	await get_tree().create_timer(0.6).timeout
	if level:
		level.player.controls_enabled = true
		level.set_checkpoint(global_position + Vector3(ARENA_LEFT + 1.5, 0.6, 0))
	_start_phase()


func _start_phase() -> void:
	state = State.ATTACK
	attacks_left = 2
	_wait = 1.2
	_paint()
	changed.emit(PHASE_TEXT[phase], phase)


func _set_tired() -> void:
	state = State.TIRED
	_zz.visible = true
	_arm_l.rotation.z = 0.0
	_arm_r.rotation.z = 0.0
	_paint()
	runes[phase].set_awake(true)
	if level:
		level.say("The Guardian is tired. Find the glowing crystal!")
	Sfx.play("hint")


# --- attacks --------------------------------------------------------------------------------------------------

func _player_x() -> float:
	return level.player.global_position.x if level and level.player else global_position.x - 12.0


func _arena_x(x: float) -> float:
	return clampf(x, global_position.x + ARENA_LEFT + 1.0, global_position.x - 3.5)


func _start_attack() -> void:
	match phase:
		0:
			_slam()
		1:
			_boulder()
		_:
			_rain()


## Phase 1: a ring glows where the mage stands, the arm rises, and a shockwave hits the ring.
func _slam() -> void:
	var x := _arena_x(_player_x())
	var ring := _ring(x, 1.6, Color("#ff7a59"))
	Sfx.play("warn")
	var tw := create_tween()
	tw.tween_property(_arm_r, "rotation:z", 2.2, TELEGRAPH * 0.8).set_trans(Tween.TRANS_SINE)
	_hazards.append({kind = "slam", x = x, t = TELEGRAPH, node = ring, r = 1.6})


## Phase 2: a boulder is lifted overhead, then rolls along the ground toward the mage. Jump over it.
func _boulder() -> void:
	var rock := Art.instance("hexagon/rock_single_E")
	rock.scale = Vector3.ONE * 5.0
	rock.position = Vector3(-1.0, 6.2, 0.6)
	_body_root.add_child(rock)
	Sfx.play("warn")
	var arrow := Art.label("◀ !", 120, Color("#ff7a59"))
	arrow.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	arrow.position = Vector3(-3.0, 4.0, 1.0)
	add_child(arrow)
	var tw := create_tween()
	tw.tween_property(_arm_l, "rotation:z", -2.6, TELEGRAPH * 0.6)
	tw.parallel().tween_property(_arm_r, "rotation:z", 2.6, TELEGRAPH * 0.6)
	_hazards.append({kind = "boulder", t = TELEGRAPH, node = rock, arrow = arrow, x = global_position.x - 3.5, rolling = false})


## Phase 3: shadows grow where rocks will fall; one is always under the mage, so it has to move.
func _rain() -> void:
	var px := _player_x()
	var xs := [_arena_x(px)]
	for i in 2:
		var x := _arena_x(px + (randf_range(2.6, 4.5) * (1 if i == 0 else -1)))
		if absf(x - xs[0]) > 1.5:
			xs.append(x)
	Sfx.play("warn")
	_arm_l.rotation.z = -1.5
	_arm_r.rotation.z = 1.5
	for x in xs:
		var y := _ground_y(x)
		var shadow := _ring(x, 1.0, Color("#3a2d55"), y)
		_hazards.append({kind = "rock", x = x, y = y, t = TELEGRAPH + 0.2, node = shadow, r = 1.05})


func _update_hazards(delta: float) -> void:
	for h in _hazards.duplicate():
		h.t -= delta
		match h.kind:
			"slam":
				_pulse(h)
				if h.t <= 0.0:
					_arm_r.rotation.z = -0.3
					create_tween().tween_property(_arm_r, "rotation:z", 0.0, 0.5)
					_impact(h.x, 0.0, h.r)
					_remove(h)
			"rock":
				_pulse(h)
				if h.t <= 0.0:
					var rock := Art.instance("hexagon/rock_single_A")
					rock.scale = Vector3.ONE * 5.0
					add_child(rock)
					rock.global_position = Vector3(h.x, h.y + 9.0, 0)
					var tw := rock.create_tween()
					tw.tween_property(rock, "global_position:y", h.y, 0.3).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
					tw.tween_interval(0.4)
					tw.tween_property(rock, "scale", Vector3.ZERO, 0.3)
					tw.tween_callback(rock.queue_free)
					h.kind = "landing"
					h.t = 0.3
			"landing":
				if h.t <= 0.0:
					_impact(h.x, h.y, h.r)
					_remove(h)
			"boulder":
				if not h.rolling:
					if h.t <= 0.0:
						h.rolling = true
						h.arrow.queue_free()
						var n: Node3D = h.node
						var gp := n.global_position
						n.get_parent().remove_child(n)
						add_child(n)
						n.global_position = gp
						create_tween().tween_property(n, "global_position", Vector3(h.x, 0.0, 0.0), 0.35)
						_arm_l.rotation.z = 0.0
						_arm_r.rotation.z = 0.0
						h.t = -0.35
				elif h.t < -0.35:
					var n: Node3D = h.node
					h.x -= 5.5 * delta
					n.global_position = Vector3(h.x, 0.0, 0.0)
					n.rotation.z += 5.5 * delta / 0.6
					if level and level.player:
						var p := level.player.global_position
						if absf(p.x - h.x) < 0.9 and p.y < 1.1:
							level.hurt_player(h.x + 1.0)
					if h.x < global_position.x + ARENA_LEFT:
						Fx.burst(get_parent(), n.global_position, Color("#b8afa4"), 14)
						_remove(h)


func _impact(x: float, y: float, r: float) -> void:
	Sfx.play("slam")
	Fx.burst(get_parent(), Vector3(x, y + 0.2, 0), Color("#d8cfc4"), 18, 5.0, 0.15)
	if level:
		level.camera.shake(0.18, 0.3)
		if level.player:
			var p := level.player.global_position
			if absf(p.x - x) < r and p.y < y + 1.2:
				level.hurt_player(x)


func _remove(h: Dictionary) -> void:
	_hazards.erase(h)
	if h.has("node") and is_instance_valid(h.node):
		h.node.queue_free()


func _pulse(h: Dictionary) -> void:
	var n: Node3D = h.node
	if is_instance_valid(n):
		var k := 1.0 - clampf(h.t / TELEGRAPH, 0.0, 1.0)
		n.scale = Vector3.ONE * (0.4 + 0.6 * k) * (1.0 + 0.06 * sin(_t * 18.0))


## A flat glowing disc on the ground: the warning of where something will land.
func _ring(x: float, r: float, color: Color, y := 0.0) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	var c := CylinderMesh.new()
	c.top_radius = r
	c.bottom_radius = r
	c.height = 0.05
	m.mesh = c
	m.material_override = Art.material(color, 1.2, 0.6)
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(m)
	m.global_position = Vector3(x, y + 0.04, 0)
	var mark := Art.label("!", 110, color.lightened(0.3))
	mark.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	mark.position.y = 2.2
	m.add_child(mark)
	return m


func _ground_y(x: float) -> float:
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(Vector3(x, 12, 0), Vector3(x, -3, 0), 1)
	var hit := space.intersect_ray(q)
	return hit.position.y if hit else 0.0


# --- reactions ------------------------------------------------------------------------------------------------

## A wrong answer: the Guardian chuckles and its eyes flicker. Nothing else happens.
func laugh() -> void:
	var tw := create_tween()
	for i in 3:
		tw.tween_property(_head, "rotation:z", 0.15, 0.08)
		tw.tween_property(_head, "rotation:z", -0.15, 0.08)
	tw.tween_property(_head, "rotation:z", 0.0, 0.08)


## Called by a rune after its challenge was answered right. Plays the world change, then the next phase.
func rune_solved(p: int) -> void:
	state = State.REACT
	_zz.visible = false
	_clear_hazards()
	var tw := create_tween()  # a big stagger
	tw.tween_property(_body_root, "rotation:z", -0.12, 0.15)
	tw.tween_property(_body_root, "rotation:z", 0.08, 0.2)
	tw.tween_property(_body_root, "rotation:z", 0.0, 0.25)
	match p:
		0:
			Sfx.play("shield")
			Fx.burst(get_parent(), global_position + Vector3(0, 2.6, 1.5), Color("#9ee8ff"), 40, 7.0)
			var st := create_tween()
			st.tween_property(_shield, "scale", Vector3.ONE * 1.25, 0.15)
			st.tween_property(_shield, "scale", Vector3.ZERO, 0.25)
			await st.finished
			_shield.visible = false
			if level:
				level.say("The shield is broken!")
		1:
			if level and level.player:  # keep the mage out from under the rising columns
				var px := level.player.global_position.x
				if px > global_position.x + STAIRS[0][0] - 1.5:
					level.player.global_position.x = global_position.x + STAIRS[0][0] - 2.0
			Sfx.play("rumble")
			for i in _stairs.size():
				var g := _stairs[i]
				g.visible = true
				var gt := create_tween()
				gt.tween_property(g, "position:y", STAIRS[i][1], 1.0).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
				level.camera.shake(0.12, 0.4)
				await gt.finished
				Sfx.play("place", 1.0 + i * 0.15)
			runes[2].visible = true
			if level:
				level.say("Stone stairs! Climb up to the Guardian.")
		2:
			await _crumble()
			return
	await get_tree().create_timer(0.8).timeout
	phase = p + 1
	_start_phase()


func _clear_hazards() -> void:
	for h in _hazards.duplicate():
		_remove(h)
		if h.has("arrow") and is_instance_valid(h.arrow):
			h.arrow.queue_free()


## Victory: the Guardian falls apart into harmless pebbles, and a small friendly pebble waves hello.
func _crumble() -> void:
	state = State.DEFEATED
	phase = 3
	changed.emit(PHASE_TEXT[3], 3)
	Sfx.play("rumble")
	for e in _eyes:
		e.material_override = Art.material(Color("#333344"))
	var all: Array[Node3D] = [_head, _arm_l, _arm_r, _core, _torso]
	for n in _body_root.get_children():
		if n is Node3D and not all.has(n):
			all.append(n)
	for n in all:
		var tw := n.create_tween()
		var dir := Vector3(randf_range(-3, 3), randf_range(1, 3), randf_range(0.5, 2))
		tw.tween_property(n, "position", n.position + dir, 0.5).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tw.parallel().tween_property(n, "rotation", Vector3(randf_range(-2, 2), randf_range(-2, 2), randf_range(-2, 2)), 0.9)
		tw.tween_property(n, "position:y", -1.0, 0.5).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		tw.tween_property(n, "scale", Vector3.ZERO, 0.4)
	if level:
		level.camera.shake(0.35, 0.8)
	await get_tree().create_timer(1.6).timeout
	_collider.queue_free()
	_wall.queue_free()
	Sfx.play("victory")
	_spawn_friend()
	if level:
		level.camera.min_x = level.camera_min_x
		level.camera.max_x = level.camera_max_x
		level.camera.zoom = 1.0
		level.say("The Stone Guardian is calm again. Thank you!")
		var goal: Goal = level.get_node_or_null("Goal")
		if goal:
			goal.reveal()
	defeated.emit()


func _spawn_friend() -> void:
	var f := Node3D.new()
	add_child(f)
	f.position = Vector3(-2.5, 0, 0.5)
	var body := Art.instance("hexagon/rock_single_B")
	body.scale = Vector3.ONE * 4.0
	f.add_child(body)
	for side in [-1, 1]:
		var eye := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.09
		sm.height = 0.18
		eye.mesh = sm
		eye.material_override = Art.material(Color("#5ee1ff"), 2.0)
		eye.position = Vector3(side * 0.18, 0.45, 0.55)
		f.add_child(eye)
	var tw := f.create_tween().set_loops(8)  # happy hops
	tw.tween_property(f, "position:y", 0.8, 0.25).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_property(f, "position:y", 0.0, 0.25).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	Fx.confetti(get_parent(), f.global_position + Vector3(0, 1.5, 0))
