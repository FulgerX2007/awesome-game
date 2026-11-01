class_name BridgePuzzle
extends PuzzleBase
## A broken stone bridge over the sea. It has `total` slots; some old slabs are still there and the rest
## are glowing empty spots to count. The child picks how many stones from the pouch to put in: the stones
## fly in, and a wrong number visibly leaves holes or has stones left over before they come back.
## Placed at the left edge of the gap, top of the ground at y = 0.

@export var gap := 6.0
## The question never asks for more than this many stones; the level puts at least this many before it.
@export_range(1, 12) var max_missing := 4

const SLAB_H := 0.35
const SLAB_D := 1.7

var _slots: Array[MeshInstance3D] = []   # the empty spots, left to right
var _temp: Array[Node3D] = []
var _body: StaticBody3D
var _text: Label3D


func prompt() -> String:
	return "How many stones do we need to fix the bridge?"


func _make_challenge() -> MathChallenge:
	return MathChallengeManager.create("missing", min_difficulty, max_difficulty, {max_unknown = max_missing})


func _interact_position() -> Vector3:
	return Vector3(-1.0, 0, 0)


func focus_point() -> Vector3:
	return global_position + Vector3(gap / 2.0, 1.0, 0)


func checkpoint_position() -> Vector3:
	return global_position + Vector3(gap + 1.5, 0.5, 0)


func _w() -> float:
	return gap / float(challenge.total)


func _slot_pos(i: int) -> Vector3:
	return Vector3((i + 0.5) * _w(), -SLAB_H / 2.0, 0)


func _build() -> void:
	challenge = _make_challenge()
	for x in [0.0, gap]:
		for z in [-SLAB_D / 2.0 - 0.1, SLAB_D / 2.0 + 0.1]:
			var post := Art.instance("dungeon/column")
			post.scale = Vector3(0.45, 0.9, 0.45)
			post.position = Vector3(x, 0, z)
			add_child(post)
	var rope_m := Art.material(Color("#c8a26b"))
	for z in [-SLAB_D / 2.0 - 0.1, SLAB_D / 2.0 + 0.1]:
		var rope := MeshInstance3D.new()
		var rm := BoxMesh.new()
		rm.size = Vector3(gap, 0.06, 0.06)
		rope.mesh = rm
		rope.material_override = rope_m
		rope.position = Vector3(gap / 2.0, 1.1, z)
		add_child(rope)
	for i in challenge.total:
		var slab := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(_w() - 0.06, SLAB_H, SLAB_D)
		slab.mesh = bm
		slab.position = _slot_pos(i)
		add_child(slab)
		if i < challenge.a:
			slab.material_override = Art.material(Color("#a59c92"))
		else:
			slab.material_override = Art.material(Color("#9ee8ff"), 0.6, 0.35)
			slab.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			_slots.append(slab)
	_body = StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(gap + 0.4, SLAB_H, SLAB_D + 0.6)
	cs.shape = box
	cs.position = Vector3(gap / 2.0, -SLAB_H / 2.0, 0)
	cs.disabled = true
	_body.add_child(cs)
	add_child(_body)
	_text = Art.label(challenge.question_text(), 100)
	_text.position = Vector3(gap / 2.0, 2.3, 0)
	add_child(_text)


func _can_start() -> bool:
	var lvl := Level.of(self)
	if lvl and lvl.stones < challenge.answer:
		lvl.say("We need more stones for this bridge. Look around!" if lvl.stones > 0 else "Collect the shiny stones first!")
		Sfx.play("hint")
		return false
	return true


func _stone_slab(color: Color) -> MeshInstance3D:
	var slab := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(_w() - 0.06, SLAB_H, SLAB_D)
	slab.mesh = bm
	slab.material_override = Art.material(color, 0.3)
	add_child(slab)
	return slab


func _from() -> Vector3:
	var lvl := Level.of(self)
	return to_local(lvl.player.global_position + Vector3(0, 1.2, 0)) if lvl and lvl.player else Vector3(-1, 1, 0)


func _show_wrong(value: int) -> void:
	_reset_wrong()
	Sfx.play("wrong")
	var b := challenge.answer
	for i in value:
		var slab := _stone_slab(Color("#ffb347"))
		slab.position = _from()
		_temp.append(slab)
		# into the empty spots first; the ones that do not fit hover over the middle of the bridge
		var to := _slots[i].position if i < b else Vector3(gap / 2.0 + (i - b - (value - b - 1) / 2.0) * (_w() + 0.1), 1.6, 0)
		var tw := slab.create_tween()
		tw.tween_interval(i * 0.08)
		tw.tween_property(slab, "position", to, 0.3).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		if i >= b:  # leftover stones bounce: one too many!
			tw.tween_property(slab, "position:y", to.y + 0.4, 0.2)
			tw.tween_property(slab, "position:y", to.y, 0.2)
	if value < b:  # the holes that are still empty blink
		for i in range(value, b):
			var s := _slots[i]
			var tw := s.create_tween()
			tw.tween_interval(0.4)
			for k in 3:
				tw.tween_property(s, "scale", Vector3(1, 1.6, 1.1), 0.12)
				tw.tween_property(s, "scale", Vector3.ONE, 0.12)
	get_tree().create_timer(1.6).timeout.connect(_reset_wrong)


func _reset_wrong() -> void:
	for t in _temp:
		if is_instance_valid(t):
			t.queue_free()
	_temp.clear()
	for s in _slots:
		s.scale = Vector3.ONE


func _play_solved() -> void:
	_reset_wrong()
	# solid at once: the stones take a moment to fly in, and a child who walks on right away must not fall
	# through a bridge that is already showing (the playthrough bot did, on long bridges)
	_body.get_child(0).set_deferred("disabled", false)
	var lvl := Level.of(self)
	for i in _slots.size():
		var slab := _stone_slab(Art.STONE_COLOR)
		slab.position = _from()
		var tw := slab.create_tween()
		tw.tween_property(slab, "position", _slots[i].position, 0.25).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		await tw.finished
		_slots[i].visible = false
		Sfx.play("place", 1.0 + i * 0.08)
		var n := Art.label(str(challenge.a + i + 1), 90, Color("#fff4a8"))  # counting on: 5, 6, 7...
		n.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		n.position = _slots[i].position + Vector3(0, 0.8, 0)
		add_child(n)
		var nt := n.create_tween()
		nt.tween_property(n, "position:y", 1.8, 0.8)
		nt.parallel().tween_property(n, "modulate:a", 0.0, 0.8)
		nt.tween_callback(n.queue_free)
		if lvl:
			lvl.add_stones(-1)
	_text.text = challenge.solved_text()
	_text.modulate = Color("#c9ffd2")
	Sfx.play("correct")
	Fx.burst(self, global_position + Vector3(gap / 2.0, 0.5, 0), Color("#5be37d"), 30, 5.0)
