class_name Interactable
extends Area3D
## Something the mage can use with E. Shows a gentle bobbing sparkle while it can be used, and a big key
## prompt when it is the nearest one. The player decides who is nearest, so only one prompt shows at a time.

signal interacted(player: Player)

@export var enabled := true:
	set(v):
		enabled = v
		_refresh()
@export var prompt_height := 2.4
@export var radius := 1.6

var _focused := false
var _hint: Label3D
var _prompt: Label3D
var _t := randf() * TAU


func _ready() -> void:
	collision_layer = 4
	collision_mask = 0
	monitoring = false
	if get_child_count() == 0 or not get_children().any(func(c): return c is CollisionShape3D):
		var cs := CollisionShape3D.new()
		var s := SphereShape3D.new()
		s.radius = radius
		cs.shape = s
		cs.position.y = 1.0
		add_child(cs)
	_hint = Art.label("✦", 72, Color("#ffe066"))
	_hint.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_hint.position.y = prompt_height
	add_child(_hint)
	_prompt = Art.label("E", 96, Color.WHITE)
	_prompt.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_prompt.outline_size = 28
	_prompt.outline_modulate = Color("#2b7de9")
	_prompt.position.y = prompt_height
	add_child(_prompt)
	_refresh()


func _process(delta: float) -> void:
	_t += delta
	var bob := sin(_t * 3.0) * 0.12
	_hint.position.y = prompt_height + bob
	_prompt.position.y = prompt_height + 0.1 + bob * 0.5
	_prompt.scale = Vector3.ONE * (1.0 + 0.06 * sin(_t * 6.0))


func set_focused(f: bool) -> void:
	_focused = f
	_refresh()


func interact(player: Player) -> void:
	if enabled:
		interacted.emit(player)


func _refresh() -> void:
	if _hint == null:
		return
	_hint.visible = enabled and not _focused
	_prompt.visible = enabled and _focused
