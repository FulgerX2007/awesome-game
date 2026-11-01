class_name Pickup
extends Area3D
## A stone for the pouch or one of the level's three gems. Spins and bobs, flies to the mage when touched.
## The level counts them; a gem found on an earlier visit shows as a glassy ghost and counts only once.

signal collected(pickup: Pickup)

@export_enum("stone", "gem") var kind := "stone"

var taken := false
var _visual: Node3D
var _t := randf() * TAU
var ghost := false


func _ready() -> void:
	add_to_group("pickup")
	collision_layer = 0
	collision_mask = 2
	var cs := CollisionShape3D.new()
	var s := SphereShape3D.new()
	s.radius = 0.65
	cs.shape = s
	cs.position.y = 0.5
	add_child(cs)
	_visual = Node3D.new()
	add_child(_visual)
	if kind == "gem":
		var m := MeshInstance3D.new()  # a cut gem with facets, gently glowing
		m.mesh = Shapes.gem(0.34)
		m.material_override = Art.material(Color("#ff5fb4"), 0.9)
		m.position.y = 0.95
		_visual.add_child(m)
	else:
		var st := Art.counting_stone(1.6)
		st.position.y = 0.45
		_visual.add_child(st)
		var glow := MeshInstance3D.new()  # a soft halo so stones read as collectible, not as scenery
		var q := SphereMesh.new()
		q.radius = 0.55
		q.height = 1.1
		glow.mesh = q
		glow.material_override = Art.material(Color("#fff3a0"), 0.8, 0.22)
		glow.position.y = 0.45
		glow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_visual.add_child(glow)
	body_entered.connect(_on_body)


func set_ghost() -> void:
	ghost = true
	for m in _visual.find_children("*", "MeshInstance3D", true, false):
		(m as MeshInstance3D).transparency = 0.6


func _process(delta: float) -> void:
	if taken:
		return
	_t += delta
	_visual.rotation.y += delta * (2.0 if kind == "gem" else 1.0)
	_visual.position.y = sin(_t * 2.5) * 0.1


func _on_body(body: Node) -> void:
	if taken or not body is Player:
		return
	taken = true
	set_deferred("monitoring", false)
	Sfx.play("gem" if kind == "gem" else "collect", randf_range(0.95, 1.1))
	Fx.burst(get_parent(), global_position + Vector3(0, 0.6, 0), Color("#ff8fd0") if kind == "gem" else Color("#fff1a0"), 16)
	var tw := create_tween()
	tw.tween_property(self, "global_position", (body as Node3D).global_position + Vector3(0, 1.0, 0), 0.25)
	tw.parallel().tween_property(_visual, "scale", Vector3.ONE * 0.2, 0.25)
	tw.tween_callback(queue_free)
	collected.emit(self)
