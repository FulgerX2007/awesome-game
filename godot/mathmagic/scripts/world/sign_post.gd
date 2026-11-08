@tool
class_name SignPost
extends Node3D
## A wooden sign with a short line of text (a translation key) for the child to read.

@export_multiline var text := "Hello!":
	set(v):
		text = v
		if _label:
			_label.text = text

var _label: Label3D


func _ready() -> void:
	var wood := Art.material(Color("#a8703f"))
	var post := MeshInstance3D.new()
	var pm := BoxMesh.new()
	pm.size = Vector3(0.18, 1.6, 0.18)
	post.mesh = pm
	post.material_override = wood
	post.position.y = 0.8
	add_child(post)
	var board := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(2.8, 1.1, 0.12)
	board.mesh = bm
	board.material_override = Art.material(Color("#d9a066"))
	board.position = Vector3(0, 1.75, 0)
	add_child(board)
	_label = Art.label(text, 28, Color("#3b2414"))
	_label.outline_size = 0
	_label.position = Vector3(0, 1.75, 0.07)
	_label.width = 250.0
	_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_label)
