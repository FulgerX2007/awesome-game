class_name Checkpoint
extends Area3D
## A flag pole. Touch it and the flag goes up; falling into the sea brings you back here.

var reached := false
var _flag: Node3D


func _ready() -> void:
	collision_layer = 0
	collision_mask = 2
	var cs := CollisionShape3D.new()
	var b := BoxShape3D.new()
	b.size = Vector3(1.4, 3, 2)
	cs.shape = b
	cs.position.y = 1.5
	add_child(cs)
	_flag = Art.instance("hexagon/flag_red")
	_flag.scale = Vector3.ONE * 2.6
	add_child(_flag)
	body_entered.connect(_on_body)


func _on_body(b: Node) -> void:
	if reached or not b is Player:
		return
	reached = true
	var lvl := Level.of(self)
	if lvl:
		lvl.set_checkpoint(global_position + Vector3(0, 0.5, 0))
	Sfx.play("checkpoint")
	Fx.burst(get_parent(), global_position + Vector3(0, 2.5, 0), Color("#7cf29a"), 18)
	var green := Art.instance("hexagon/flag_green")
	green.scale = _flag.scale
	add_child(green)
	_flag.queue_free()
	_flag = green
	_flag.scale = Vector3(2.6, 0.3, 2.6)
	create_tween().tween_property(_flag, "scale", Vector3.ONE * 2.6, 0.4).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
