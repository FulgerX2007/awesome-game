@tool
class_name Prop
extends Node3D
## A decoration from the asset packs, chosen by key (see Art). No collision: props never block the path.

@export var model := "hexagon/tree_single_A":
	set(v):
		model = v
		if is_inside_tree():
			_build()


func _ready() -> void:
	_build()


func _build() -> void:
	for c in get_children():
		if c.has_meta("generated"):
			c.free()
	if model.is_empty() or not ResourceLoader.exists(Art.path(model)):
		return
	var n := Art.instance(model)
	n.set_meta("generated", true)
	add_child(n)
