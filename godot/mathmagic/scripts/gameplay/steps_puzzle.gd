class_name StepsPuzzle
extends PuzzleBase
## Crystal steps up a cliff that is too tall to jump. Ghost steps show the way; every step has the same
## number of empty crystal sockets, so the question is equal groups: a steps with b crystals each.
## The right number lights all the crystals and the steps rise, one group at a time. A wrong number fills the
## steps in order, so the child sees steps left empty (too few) or crystals left over (too many).
## Placed at the foot of the cliff, top of the ground at y = 0; the cliff's face is at x = run.

## How high the cliff top is above the puzzle (the last step ends level with it).
@export var height := 3.2
## Horizontal room for the steps, from the puzzle to the cliff face.
@export var run := 5.0
## The staircase never has more steps than this (each step's rise is height / steps).
@export_range(2, 5) var max_steps := 5

const DEPTH := 1.7
const BASE_Y := -0.8             # the steps go down into the ground so they never float
const GHOST := Color("#9ee8ff")         # not real yet: light, see-through blue
const STONE := Color("#9c8670")         # built: warm carved stone, like the rock around it
const CRYSTAL := Color("#a259ff")       # the magic accent: lit crystals and the strip on each built step
const EMPTY := Color("#e9e4ff")         # a socket still waiting for its crystal
const CRYSTAL_GAP := 0.42

var _steps: Array[Node3D] = []           # pivots at the bottom of each step, scaled up when they rise
var _step_meshes: Array[MeshInstance3D] = []
var _strips: Array[MeshInstance3D] = []  # the crystal strip on each step's front edge, lit once it is built
var _bodies: Array[CollisionShape3D] = []
var _crystals: Array = []                # per step, its crystal meshes
var _text: Label3D
var _wall: CollisionShape3D            # keeps the mage out of the ghost steps until they are real
var _wrong_token := 0


func prompt() -> String:
	return "Every step needs the same number of crystals. How many crystals in all?"


func _make_challenge() -> MathChallenge:
	return MathChallengeManager.create("mul", min_difficulty, max_difficulty, {max_groups = max_steps})


func _interact_position() -> Vector3:
	return Vector3(-1.0, 0, 0)


func focus_point() -> Vector3:
	return global_position + Vector3(run / 2.0, height / 2.0 + 0.6, 0)


func checkpoint_position() -> Vector3:
	return global_position + Vector3(run + 1.5, height + 0.5, 0)


func _w() -> float:
	return run / float(challenge.a)


func _top(i: int) -> float:
	return (i + 1) * height / float(challenge.a)


func _build() -> void:
	challenge = _make_challenge()
	var rng := RandomNumberGenerator.new()
	rng.seed = int(global_position.x * 10.0)
	for i in challenge.a:
		var pivot := Node3D.new()
		pivot.position = Vector3((i + 0.5) * _w(), BASE_Y, 0)
		add_child(pivot)
		_steps.append(pivot)
		var h := _top(i) - BASE_Y
		var m := MeshInstance3D.new()   # a carved block with softened edges, each one turned a hair differently
		m.mesh = Shapes.bevel_box(Vector3(_w() - 0.08, h, DEPTH), 0.1)
		m.position.y = h / 2.0
		m.rotation_degrees.y = rng.randf_range(-1.5, 1.5)
		pivot.add_child(m)
		_step_meshes.append(m)
		var strip := MeshInstance3D.new()
		strip.mesh = Shapes.bevel_box(Vector3(_w() - 0.4, 0.09, 0.06), 0.03)
		strip.position = Vector3(0, h - 0.2, DEPTH / 2.0 + 0.01)
		strip.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		pivot.add_child(strip)
		_strips.append(strip)
		var body := StaticBody3D.new()
		body.collision_layer = 1
		body.collision_mask = 0
		var cs := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(_w(), h, DEPTH)
		cs.shape = box
		cs.position = Vector3((i + 0.5) * _w(), BASE_Y + h / 2.0, 0)
		cs.disabled = true
		body.add_child(cs)
		add_child(body)
		_bodies.append(cs)
		var list: Array[MeshInstance3D] = []
		# on the step's top: across its width first (so they never hide each other from the camera), then in
		# up to three rows into the depth
		var cx := clampi(int((_w() - 0.2) / CRYSTAL_GAP), 1, challenge.b)
		if ceili(challenge.b / float(cx)) > 3:
			cx = ceili(challenge.b / 3.0)
		var rows := ceili(challenge.b / float(cx))
		var gap_x := minf(CRYSTAL_GAP, (_w() - 0.2) / maxf(cx - 1, 1))
		for k in challenge.b:
			var cr := MeshInstance3D.new()
			cr.mesh = Shapes.crystal(0.12, 0.52, Vector3(rng.randf_range(-0.2, 0.2), 0, rng.randf_range(-0.2, 0.2)))
			cr.rotation.y = rng.randf_range(0, TAU)
			var row := k / cx
			var in_row := mini(cx, challenge.b - row * cx)
			cr.position = Vector3((k % cx - (in_row - 1) / 2.0) * gap_x, h - 0.03, (row - (rows - 1) / 2.0) * 0.5)
			cr.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			pivot.add_child(cr)
			list.append(cr)
		_crystals.append(list)
	var wb := StaticBody3D.new()
	wb.collision_layer = 1
	wb.collision_mask = 0
	_wall = CollisionShape3D.new()
	var ws := BoxShape3D.new()
	ws.size = Vector3(0.3, 12.0, 4.0)
	_wall.shape = ws
	_wall.position = Vector3(-0.15, 6.0, 0)
	wb.add_child(_wall)
	add_child(wb)
	_text = Art.label(challenge.question_text(), 110)
	_text.position = Vector3(run / 2.0, height + 1.6, -1.0)
	add_child(_text)
	_show_state()


func _show_state() -> void:
	if _text == null:
		return
	var solved := state == State.SOLVED
	for i in _steps.size():
		_paint_step(i, solved, challenge.b if solved else 0)
	_text.text = challenge.solved_text() if solved else challenge.question_text()
	_text.modulate = Color("#eaffea") if solved else (Color("#fff3c4") if state == State.ACTIVE else Color.WHITE)


## A step is a ghost until it is real; lit is how many of its crystals glow.
func _paint_step(i: int, real: bool, lit: int) -> void:
	var m := _step_meshes[i]
	m.material_override = Art.material(STONE) if real else Art.material(GHOST, 0.5, 0.3)
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if real else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_strips[i].visible = real
	_strips[i].material_override = Art.material(CRYSTAL, 0.8)
	var list: Array = _crystals[i]
	for k in list.size():
		var cr: MeshInstance3D = list[k]
		cr.material_override = Art.material(CRYSTAL, 0.5) if k < lit else Art.material(EMPTY, 0.25, 0.6)


func _wrong_message(value: int) -> String:
	if value < challenge.answer:
		return "Some steps have no crystals yet. We need more."
	return "Crystals are left over. That is too many."


## Fills the steps in order with the chosen number: full steps go solid for a moment (still not walkable),
## and crystals that do not fit pop away above the cliff.
func _show_wrong(value: int) -> void:
	Sfx.play("wrong")
	_wrong_token += 1
	var token := _wrong_token
	var left := value
	for i in _steps.size():
		var lit := clampi(left, 0, challenge.b)
		left -= lit
		_paint_step(i, false, lit)
		if lit == challenge.b:
			_step_meshes[i].material_override = Art.material(GHOST, 1.0, 0.6)
	if left > 0:
		Sfx.play("fizzle")
		Fx.burst(self, global_position + Vector3(run, height + 0.6, 0), CRYSTAL, mini(left * 4, 40), 3.0)
	await get_tree().create_timer(2.2).timeout
	if token == _wrong_token and state != State.SOLVED:
		_show_state()


func _reset_wrong() -> void:
	_wrong_token += 1
	_show_state()


func _play_solved() -> void:
	_wrong_token += 1
	for i in _steps.size():
		_steps[i].scale.y = 0.05
	for i in _steps.size():
		_paint_step(i, true, 0)
		var tw := create_tween()
		tw.tween_property(_steps[i], "scale:y", 1.0, 0.35).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		Sfx.play("place")
		await tw.finished
		_bodies[i].set_deferred("disabled", false)
		var list: Array = _crystals[i]
		for k in list.size():
			list[k].material_override = Art.material(CRYSTAL, 0.5)
		Fx.burst(self, _steps[i].global_position + Vector3(0, _top(i) - BASE_Y + 0.3, 0), CRYSTAL, 12, 2.5)
	_wall.set_deferred("disabled", true)
	Sfx.play("open")
	await get_tree().create_timer(0.3).timeout
