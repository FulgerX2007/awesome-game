class_name GameCamera
extends Camera3D
## The fixed, angled 2.5D camera. Follows the mage with a little look-ahead, never rotates, stays inside the
## level's limits, and frames a puzzle while its challenge is open so the answer can be seen changing the world.

@export var offset := Vector3(0, 4.2, 11.5)
@export var look_up := 1.4          # the camera aims this far above the target
@export var look_ahead := 1.8
@export var smooth := 4.0

var target: Node3D
var min_x := -INF
var max_x := INF
var focus: Variant = null           # a Vector3 to frame instead of the target
var _ahead := 0.0
var _shake := 0.0
var _shake_t := 0.0


func _ready() -> void:
	fov = 42.0
	near = 0.3
	far = 120.0
	rotation = Vector3(-atan2(offset.y - look_up, offset.z), 0, 0)
	snap()


func _process(delta: float) -> void:
	_fit_aspect()
	var goal := _goal(delta)
	var k := 1.0 - exp(-smooth * delta)
	position = position.lerp(goal, k)
	if _shake_t > 0.0:
		_shake_t -= delta
		position += Vector3(randf_range(-1, 1), randf_range(-1, 1), 0) * _shake * (_shake_t / 0.4)


func _goal(delta: float) -> Vector3:
	var p := Vector3.ZERO
	if focus is Vector3:
		p = focus + Vector3(0, -2.3, 2.5)  # the challenge panel covers the bottom half: frame the object above it
	elif target and is_instance_valid(target):
		var f: float = target.get("facing") if target.get("facing") != null else 1.0
		_ahead = lerpf(_ahead, f * look_ahead, 1.0 - exp(-2.0 * delta))
		p = target.global_position + Vector3(_ahead, 0, 0)
		p.y = maxf(p.y, 0.0) * 0.8   # rise with high ledges, never dive after a fall into the sea
	p.x = clampf(p.x, min_x, max_x)
	return p + offset


func snap() -> void:
	position = _goal(1.0)


## Narrow windows keep the width in view instead of the height, so the path ahead never disappears.
func _fit_aspect() -> void:
	var s := get_viewport().get_visible_rect().size
	if s.y <= 0:
		return
	if s.x / s.y < 1.6:
		keep_aspect = Camera3D.KEEP_WIDTH
		fov = 66.0
	else:
		keep_aspect = Camera3D.KEEP_HEIGHT
		fov = 42.0


func shake(amount := 0.25, time := 0.4) -> void:
	_shake = amount
	_shake_t = time
