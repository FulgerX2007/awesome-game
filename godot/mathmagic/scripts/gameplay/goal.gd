class_name Goal
extends Area3D
## The end of a level: a treasure chest under a banner. Reaching it opens the lid, a star flies up and the
## level is complete. While a puzzle before it is unsolved the path is blocked anyway, so no lock is needed.

## A goal that appears later (after the boss) starts hidden and switched off.
@export var hidden := false

var _lid: Node3D
var _opened := false


func _ready() -> void:
	collision_layer = 0
	collision_mask = 2
	var cs := CollisionShape3D.new()
	var b := BoxShape3D.new()
	b.size = Vector3(2.0, 3, 2)
	cs.shape = b
	cs.position.y = 1.5
	add_child(cs)
	var chest := Art.instance("dungeon/chest_gold")
	chest.rotation_degrees.y = 0
	chest.scale = Vector3.ONE * 0.9
	add_child(chest)
	_lid = chest.find_child("chest_gold_lid", true, false)
	var banner := Art.instance("dungeon/banner_patternA_yellow")
	banner.position = Vector3(0, 0, -1.6)
	banner.scale = Vector3.ONE * 0.8
	add_child(banner)
	var star := Art.label("★", 140, Color("#ffd23f"))
	star.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	star.position.y = 2.4
	star.name = "Star"
	add_child(star)
	body_entered.connect(_on_body)
	if hidden:
		visible = false
		monitoring = false


func reveal() -> void:
	visible = true
	set_deferred("monitoring", true)
	scale = Vector3.ONE * 0.1
	create_tween().tween_property(self, "scale", Vector3.ONE, 0.6).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	Fx.confetti(get_parent(), global_position + Vector3(0, 2, 0))


func _process(delta: float) -> void:
	var s: Node3D = get_node_or_null("Star")
	if s and not _opened:
		s.position.y = 2.4 + sin(Time.get_ticks_msec() / 300.0) * 0.15


func _on_body(b: Node) -> void:
	if _opened or not b is Player:
		return
	_opened = true
	if _lid:
		create_tween().tween_property(_lid, "rotation_degrees:x", -110.0, 0.5).set_trans(Tween.TRANS_BACK)
	var s: Node3D = get_node_or_null("Star")
	if s:
		var tw := create_tween()
		tw.tween_property(s, "position:y", 4.5, 0.8).set_trans(Tween.TRANS_SINE)
		tw.parallel().tween_property(s, "scale", Vector3.ONE * 1.8, 0.8)
	var lvl := Level.of(self)
	if lvl:
		lvl.complete()
