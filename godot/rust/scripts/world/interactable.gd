class_name Interactable
extends Area3D
## Makes a scene object clickable. Every interactive object stands on a glowing ring (decor has none),
## grows a little and shows its name and what a click does when hovered, and bounces when clicked.

signal activated

var title := ""
var hint := ""
## The node that bounces and grows (the station itself).
var body: Node3D
var enabled := true:
	set(v):
		enabled = v
		_refresh()
var accent := Kit.LAMP

var _ring: MeshInstance3D
var _ring_mat: StandardMaterial3D
var _label: Label3D
var _hover := false
var _punch := 0.0
var _t := 0.0
var _base_scale := Vector3.ONE


## size/center: the clickable box; radius: the ring on the ground.
func setup(target: Node3D, size: Vector3, center: Vector3, radius: float, title_: String, hint_: String, accent_ := Kit.LAMP) -> void:
	body = target
	_base_scale = target.scale
	title = title_
	hint = hint_
	accent = accent_
	input_ray_pickable = true
	add_to_group("interactables")
	monitoring = false
	var shape := CollisionShape3D.new()
	var b := BoxShape3D.new()
	b.size = size
	shape.shape = b
	shape.position = center
	add_child(shape)
	_ring_mat = Kit.own_mat(accent, accent, 1.2)
	_ring_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_ring_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_ring = Kit.place(self, Kit.torus_mesh(radius - 0.06, radius), _ring_mat, Vector3(0, 0.04, 0), Vector3.ZERO, false)
	_ring.scale = Vector3(1, 0.15, 1)
	_label = Kit.label(self, "", center + Vector3(0, size.y / 2.0 + 0.6, 0), Color.WHITE, 40)
	_label.visible = false
	mouse_entered.connect(func(): _set_hover(true))
	mouse_exited.connect(func(): _set_hover(false))
	_refresh()


func set_texts(title_: String, hint_: String) -> void:
	title = title_
	hint = hint_
	_refresh()


func _set_hover(on: bool) -> void:
	_hover = on
	Input.set_default_cursor_shape(Input.CURSOR_POINTING_HAND if on and enabled else Input.CURSOR_ARROW)
	_refresh()


func _refresh() -> void:
	if _label == null:
		return
	_label.visible = _hover
	_label.text = tr(title) + ("\n" + tr(hint) if hint != "" else "")
	_label.modulate = Color.WHITE if enabled else Color(0.75, 0.7, 0.8)


func _input_event(_camera: Camera3D, event: InputEvent, _pos: Vector3, _normal: Vector3, _idx: int) -> void:
	var press: bool = (event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT) \
		or (event is InputEventScreenTouch and event.pressed)
	if press:
		activate()
		get_viewport().set_input_as_handled()


func activate() -> void:
	if not enabled:
		return
	_punch = 1.0
	activated.emit()


func _process(delta: float) -> void:
	_t += delta
	_punch = maxf(0.0, _punch - delta * 5.0)
	if _ring_mat:
		var a := (0.35 + 0.2 * sin(_t * 3.0)) if enabled else 0.12
		if _hover and enabled:
			a = 0.95
		_ring_mat.albedo_color = Color(accent, a)
		_ring_mat.emission_energy_multiplier = 2.0 if _hover else 1.0
	if body:
		var grow := (1.04 if _hover and enabled else 1.0) + sin(_punch * PI) * 0.06
		body.scale = body.scale.lerp(_base_scale * grow, minf(1.0, delta * 14.0))
