class_name EnergyPuzzle
extends PuzzleBase
## A crystal machine with an energy meter laid out like a ten-frame (rows of five). Some cells already glow;
## the child works out how many more are needed to fill it. Too few leaves dark cells blinking, too many
## overflows in sparks; the right amount powers the machine and switches on whatever `target` points at.

@export var target: NodePath
@export var windmill: NodePath

const CELL := 0.42

var _cells: Array[MeshInstance3D] = []
var _temp: Array[Node3D] = []
var _crystal: MeshInstance3D
var _text: Label3D
var _panel: Node3D


func prompt() -> String:
	return "How much more energy fills the machine?"


func _make_challenge() -> MathChallenge:
	return MathChallengeManager.create("missing", min_difficulty, max_difficulty)


func _interact_position() -> Vector3:
	return Vector3(-1.4, 0, 0)


func focus_point() -> Vector3:
	return global_position + Vector3(0.6, 1.8, 0)


func _build() -> void:
	challenge = _make_challenge()
	var base := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(1.4, 1.2, 1.4)
	base.mesh = bm
	base.material_override = Art.material(Color("#8d8a99"))
	base.position.y = 0.6
	add_child(base)
	_crystal = MeshInstance3D.new()
	var pm := PrismMesh.new()
	pm.size = Vector3(0.7, 1.0, 0.7)
	_crystal.mesh = pm
	_crystal.position.y = 1.75
	add_child(_crystal)
	_panel = Node3D.new()  # the meter faces the camera, behind and above the machine
	_panel.position = Vector3(1.6, 0.4, -0.6)
	add_child(_panel)
	var rows := ceili(challenge.total / 5.0)
	var back := MeshInstance3D.new()
	var bk := BoxMesh.new()
	bk.size = Vector3(5 * CELL + 0.3, rows * CELL + 0.3, 0.15)
	back.mesh = bk
	back.material_override = Art.material(Color("#4b3f68"))
	back.position = Vector3(2 * CELL, (rows - 1) * CELL / 2.0, -0.12)
	_panel.add_child(back)
	for i in challenge.total:
		var c := MeshInstance3D.new()
		var cm := BoxMesh.new()
		cm.size = Vector3(CELL - 0.06, CELL - 0.06, 0.14)
		c.mesh = cm
		c.position = _cell_pos(i)
		_panel.add_child(c)
		_cells.append(c)
	_text = Art.label(challenge.question_text(), 100)
	_text.position = Vector3(2.4, rows * CELL + 1.0, 0)
	add_child(_text)
	_paint(challenge.a)
	_show_state()


func _cell_pos(i: int) -> Vector3:
	return Vector3((i % 5) * CELL, (i / 5) * CELL, 0)


## Lights the first n cells; the extra ones (from a wrong try) glow orange.
func _paint(n: int, extra_from := -1) -> void:
	for i in _cells.size():
		var on := i < n
		var col := Color("#ffd23f") if on else Color("#2a2340")
		if on and extra_from >= 0 and i >= extra_from:
			col = Color("#ff9f43")
		_cells[i].material_override = Art.material(col, 1.4 if on else 0.0)


func _show_state() -> void:
	if _crystal == null:
		return
	var c := Color("#7b6cff")
	if state == State.ACTIVE:
		c = Color("#ffd166")
	elif state == State.SOLVED:
		c = Color("#5be37d")
	_crystal.material_override = Art.material(c, 1.0 if state != State.SOLVED else 3.0)


func _show_wrong(value: int) -> void:
	_reset_wrong()
	var a := challenge.a
	var total := challenge.total
	_paint(mini(a + value, total), a)
	if a + value < total:
		Sfx.play("fizzle")
		for i in range(a + value, total):
			var c := _cells[i]
			var tw := c.create_tween()
			for k in 3:
				tw.tween_property(c, "scale", Vector3(1.25, 1.25, 1), 0.12)
				tw.tween_property(c, "scale", Vector3.ONE, 0.12)
	else:
		Sfx.play("fizzle", 1.3)
		for k in (a + value - total):  # overflow: the cells that do not fit pop out as sparks
			var spark := MeshInstance3D.new()
			var sm := BoxMesh.new()
			sm.size = Vector3.ONE * (CELL - 0.06)
			spark.mesh = sm
			spark.material_override = Art.material(Color("#ff6b6b"), 1.6)
			spark.position = _cell_pos(total - 1) + Vector3(0.2, 0.2, 0.1)
			_panel.add_child(spark)
			_temp.append(spark)
			var tw := spark.create_tween()
			tw.tween_property(spark, "position", spark.position + Vector3(randf_range(-0.6, 1.2), 1.2 + k * 0.3, 0.3), 0.4).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	get_tree().create_timer(1.4).timeout.connect(_reset_wrong)


func _reset_wrong() -> void:
	for t in _temp:
		if is_instance_valid(t):
			t.queue_free()
	_temp.clear()
	for c in _cells:
		c.scale = Vector3.ONE
	if state != State.SOLVED:
		_paint(challenge.a)


func _play_solved() -> void:
	_reset_wrong()
	for i in range(challenge.a, challenge.total):
		_paint(i + 1)
		Sfx.play("place", 1.0 + (i - challenge.a) * 0.1)
		var n := Art.label(str(i + 1), 80, Color("#fff4a8"))
		n.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		n.position = _panel.position + _cell_pos(i) + Vector3(0, 0.5, 0.3)
		add_child(n)
		var nt := n.create_tween()
		nt.tween_property(n, "position:y", n.position.y + 1.0, 0.7)
		nt.parallel().tween_property(n, "modulate:a", 0.0, 0.7)
		nt.tween_callback(n.queue_free)
		await get_tree().create_timer(0.18).timeout
	Sfx.play("power")
	_text.text = challenge.solved_text()
	_text.modulate = Color("#c9ffd2")
	Fx.burst(self, global_position + Vector3(0, 2.0, 0), Color("#ffe066"), 36, 6.0)
	var t := get_node_or_null(target)
	if t and t.has_method("activate"):
		t.activate()
	var w := get_node_or_null(windmill)
	if w and w.has_method("activate"):
		w.activate()
	await get_tree().create_timer(0.6).timeout
