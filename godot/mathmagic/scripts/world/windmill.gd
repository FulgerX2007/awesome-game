class_name Windmill
extends Node3D
## The windmill from the hexagon pack. Its sails turn slowly, and fast once the machine is powered.

var _fan: Node3D
var _speed := 0.4


func _ready() -> void:
	var m := Art.instance("hexagon/building_windmill_yellow")
	add_child(m)
	_fan = m.find_child("building_windmill_top_fan_yellow", true, false)


func _process(delta: float) -> void:
	if _fan:
		_fan.rotation.z += _speed * delta


func activate() -> void:
	create_tween().tween_property(self, "_speed", 4.0, 1.5)
