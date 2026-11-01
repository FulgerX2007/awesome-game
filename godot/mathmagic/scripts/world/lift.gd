class_name Lift
extends AnimatableBody3D
## A wooden lift that does nothing until a machine powers it, then rides up and down forever, pausing at
## each end, so a child who falls off can always take it again.

@export var travel := Vector3(0, 4, 0)
@export var duration := 2.2
@export var pause := 1.3
@export var active := false

var _start: Vector3
var _lamp: MeshInstance3D


func _ready() -> void:
	sync_to_physics = true
	collision_layer = 1
	_start = position
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(2.6, 0.4, 2.2)
	cs.shape = box
	cs.position.y = -0.2
	add_child(cs)
	var deck := Art.instance("kenney_forest/building-platform")  # a wooden deck, 1.3 x 0.5 x 1.3
	deck.scale = Vector3(2.0, 1.0, 1.7)
	deck.position.y = -0.5
	add_child(deck)
	_lamp = MeshInstance3D.new()  # off: dim purple, on: bright yellow
	var lm := SphereMesh.new()
	lm.radius = 0.18
	lm.height = 0.36
	_lamp.mesh = lm
	_lamp.position = Vector3(0, 0.0, 1.15)
	add_child(_lamp)
	_light(active)
	if active:
		_run()


func activate() -> void:
	if active:
		return
	active = true
	_light(true)
	_run()


func _light(on: bool) -> void:
	_lamp.material_override = Art.material(Color("#ffd23f") if on else Color("#5b4b8a"), 2.0 if on else 0.3)


func _run() -> void:
	var tw := create_tween().set_loops()
	tw.set_process_mode(Tween.TWEEN_PROCESS_PHYSICS)
	tw.tween_interval(pause)
	tw.tween_property(self, "position", _start + travel, duration).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	tw.tween_interval(pause)
	tw.tween_property(self, "position", _start, duration).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
