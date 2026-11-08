class_name GatePuzzle
extends PuzzleBase
## A wooden gate locked by a rune plate with a question on it. The right answer lifts the bars.
## With show_objects, stones on two pedestals in front of the gate show the numbers, so a child who
## cannot add yet can walk up and count real things.

@export var show_objects := true

const WIDTH := 3.0
const HEIGHT := 3.2

var _vis: Node3D   # the gate turned toward the camera; the collider stays square to the path
var _bars: Node3D
var _body: StaticBody3D
var _plate: MeshInstance3D
var _text: Label3D
var _pedestals: Array[Node3D] = []


func prompt() -> String:
	match challenge.op:
		MathChallenge.Op.SUB:
			return "Some stones rolled away. How many are left?"
		MathChallenge.Op.MISSING:
			return "How many more stones do we need?"
	return "How many stones are there in all?"


func _interact_position() -> Vector3:
	return Vector3(-1.3, 0, 0)


func focus_point() -> Vector3:
	return global_position + Vector3(-1.0, 1.8, 0)


func _build() -> void:
	challenge = _make_challenge()
	_vis = Node3D.new()
	_vis.rotation_degrees.y = -50.0
	add_child(_vis)
	for side in [-1, 1]:  # stone pillars
		var col := Art.instance("dungeon/column")
		col.scale = Vector3(1.1, 2.6, 1.1)
		col.position = Vector3(0, 0, side * (WIDTH / 2.0 + 0.1))
		_vis.add_child(col)
	var beam := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.7, 0.6, WIDTH + 1.4)
	beam.mesh = bm
	beam.material_override = Art.material(Color("#9a8f86"))
	beam.position = Vector3(0, HEIGHT + 0.45, 0)
	_vis.add_child(beam)

	_bars = Node3D.new()
	_vis.add_child(_bars)
	var wood := Art.material(Color("#8a5a33"))
	for i in 6:
		var bar := MeshInstance3D.new()
		var cm := BoxMesh.new()
		cm.size = Vector3(0.22, HEIGHT, 0.32)
		bar.mesh = cm
		bar.material_override = wood
		bar.position = Vector3(0, HEIGHT / 2.0, -WIDTH / 2.0 + 0.25 + i * (WIDTH - 0.5) / 5.0)
		_bars.add_child(bar)
	for y in [0.7, HEIGHT - 0.6]:
		var band := MeshInstance3D.new()
		var bb := BoxMesh.new()
		bb.size = Vector3(0.28, 0.22, WIDTH)
		band.mesh = bb
		band.material_override = Art.material(Color("#4b4e5a"))
		band.position = Vector3(0.02, y, 0)
		_bars.add_child(band)

	_body = StaticBody3D.new()  # tall, so no jump can cheat past it
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(0.8, 12.0, 4.0)
	cs.shape = box
	cs.position.y = 6.0
	_body.add_child(cs)
	add_child(_body)

	_plate = MeshInstance3D.new()  # the rune plate: glows blue, yellow while solving, green when open
	var pm := BoxMesh.new()
	pm.size = Vector3(0.12, 0.9, 2.3)
	_plate.mesh = pm
	_plate.position = Vector3(0.0, HEIGHT + 0.45, 0)
	_plate.rotation_degrees.y = 0
	_vis.add_child(_plate)
	_text = Art.label(challenge.question_text(), 110)
	_text.position = Vector3(0, HEIGHT + 1.45, 0.0)
	add_child(_text)
	if show_objects:
		_build_objects()
	_show_state()


## Stones on pedestals in front of the gate: a + b as two piles, a - b as one pile with b faded out,
## a + ? as a pile and empty rings. Placed toward the camera so they are never hidden by the mage.
func _build_objects() -> void:
	var groups := []
	match challenge.op:
		MathChallenge.Op.ADD:
			groups = [[challenge.a, 0], [challenge.b, 0]]
		MathChallenge.Op.SUB:
			groups = [[challenge.a, challenge.b]]
		_:
			groups = [[challenge.a, 0], [0, challenge.b]]
	var gx := -3.9 - (groups.size() - 1) * 1.4
	for g in groups:
		var ped := Node3D.new()
		ped.position = Vector3(gx, 0, 2.2)
		add_child(ped)
		_pedestals.append(ped)
		var base := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = 0.95
		cyl.bottom_radius = 1.05
		cyl.height = 0.35
		base.mesh = cyl
		base.material_override = Art.material(Color("#8a6a4a"))
		base.position.y = 0.17
		ped.add_child(base)
		var full: int = g[0]
		var faded: int = g[1]
		var n: int = full if challenge.op != MathChallenge.Op.MISSING else maxi(full, faded)
		var count := n if challenge.op != MathChallenge.Op.MISSING or full > 0 else faded
		for i in count:
			var st := Art.counting_stone(1.25)
			var per_row := 3 if count <= 6 else 5
			st.position = Vector3((i % per_row - (mini(count, per_row) - 1) / 2.0) * 0.55, 0.52 + (i / per_row) * 0.42, 0.0)
			ped.add_child(st)
			var is_faded := (challenge.op == MathChallenge.Op.SUB and i >= full - faded) or (challenge.op == MathChallenge.Op.MISSING and full == 0)
			if is_faded:
				st.transparency = 0.75
		var lbl := Art.label(str(count) if challenge.op != MathChallenge.Op.MISSING or full > 0 else "?", 80)
		lbl.position = Vector3(0, 1.5 + (count / 3) * 0.42, 0)
		lbl.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		ped.add_child(lbl)
		gx += 2.8


func _show_state() -> void:
	if _plate == null:
		return
	var c := Color("#4cc9f0")
	if state == State.ACTIVE:
		c = Color("#ffd166")
	elif state == State.SOLVED:
		c = Color("#5be37d")
	_plate.material_override = Art.material(c, 1.2)
	_text.text = challenge.solved_text() if state == State.SOLVED else challenge.question_text()
	_text.modulate = Color("#eaffea") if state == State.SOLVED else Color.WHITE


func _show_wrong(_value: int) -> void:
	Sfx.play("wrong")
	var tw := create_tween()  # the lock rattles, the gate stays shut
	for i in 3:
		tw.tween_property(_bars, "position:z", 0.08, 0.05)
		tw.tween_property(_bars, "position:z", -0.08, 0.05)
	tw.tween_property(_bars, "position:z", 0.0, 0.05)


func _play_solved() -> void:
	Sfx.play("open")
	Fx.burst(self, global_position + Vector3(0, HEIGHT, 0), Color("#5be37d"), 30, 5.0)
	_body.process_mode = Node.PROCESS_MODE_DISABLED
	_body.get_child(0).set_deferred("disabled", true)
	var tw := create_tween()
	tw.tween_property(_bars, "position:y", HEIGHT - 0.3, 1.0).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	tw.parallel().tween_property(_bars, "scale:y", 0.15, 1.0)
	await tw.finished
