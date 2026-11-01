class_name Player
extends CharacterBody3D
## The young mage. Moves left and right on the gameplay plane (z = 0), jumps, and talks to the nearest
## interactable object. Kind to small hands: coyote time, a jump buffer and a short jump when the key is
## released early. Never moves while a math challenge is open.

signal fell
signal landed

@export var speed := 5.5
@export var accel := 45.0
@export var air_accel := 28.0
@export var jump_velocity := 9.6
@export var coyote_time := 0.13
@export var jump_buffer := 0.14
@export var interact_cooldown := 0.35

const MODEL_SCALE := 0.7
const LOOPS := ["Idle", "Running_A", "Walking_A", "Jump_Idle", "Cheer", "Spellcasting", "Unarmed_Idle"]

var controls_enabled := true
var kill_y := -4.0
var facing := 1.0
var gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity", 22.0)
## A test or bot can drive the player without the keyboard: {x: -1..1, jump: bool, interact: bool}.
var bot_input: Variant = null

var model: Node3D
var anim: AnimationPlayer
var _coyote := 0.0
var _buffer := 0.0
var _cooldown := 0.0
var _was_on_floor := true
var _action_t := 0.0          # a one-shot animation (cheer, spell, hit) plays for this long
var _knock := 0.0             # horizontal push after being hit, decays
var _invuln := 0.0
var _candidates: Array[Interactable] = []
var focused: Interactable
var _bot_jump_held := false
var _step_t := 0.0


func _ready() -> void:
	add_to_group("player")
	collision_layer = 2
	collision_mask = 1
	floor_snap_length = 0.25
	var shape := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.32
	cap.height = 1.3
	shape.shape = cap
	shape.position.y = 0.65
	add_child(shape)

	model = Art.instance("adventurers/Mage")
	model.scale = Vector3.ONE * MODEL_SCALE
	add_child(model)
	anim = model.find_child("AnimationPlayer", true, false)
	if anim:
		for n in LOOPS:
			if anim.has_animation(n):
				anim.get_animation(n).loop_mode = Animation.LOOP_LINEAR
		anim.play("Idle")

	var area := Area3D.new()  # finds interactables nearby
	area.collision_layer = 0
	area.collision_mask = 4
	var ac := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 1.4
	ac.shape = sphere
	ac.position.y = 0.7
	area.add_child(ac)
	add_child(area)
	area.area_entered.connect(func(a): if a is Interactable and not _candidates.has(a): _candidates.append(a))
	area.area_exited.connect(func(a): _candidates.erase(a))


func locked() -> bool:
	return not controls_enabled or MathChallengeManager.is_active()


func _input_x() -> float:
	if bot_input is Dictionary:
		return clampf(bot_input.get("x", 0.0), -1.0, 1.0)
	return Input.get_axis("move_left", "move_right")


func _jump_pressed() -> bool:
	if bot_input is Dictionary:
		var j: bool = bot_input.get("jump", false)
		var pressed := j and not _bot_jump_held
		_bot_jump_held = j
		return pressed
	return Input.is_action_just_pressed("jump")


func _jump_held() -> bool:
	return bot_input.get("jump", false) if bot_input is Dictionary else Input.is_action_pressed("jump")


func _interact_pressed() -> bool:
	if bot_input is Dictionary:
		var i: bool = bot_input.get("interact", false)
		bot_input.interact = false
		return i
	return Input.is_action_just_pressed("interact")


func _physics_process(delta: float) -> void:
	var lock := locked()
	var ix := 0.0 if lock else _input_x()
	_cooldown = maxf(0.0, _cooldown - delta)
	_action_t = maxf(0.0, _action_t - delta)
	_invuln = maxf(0.0, _invuln - delta)

	if is_on_floor():
		_coyote = coyote_time
	else:
		_coyote -= delta
		velocity.y -= gravity * delta
	if not lock and _jump_pressed():
		_buffer = jump_buffer
	else:
		_buffer -= delta
	if _buffer > 0.0 and _coyote > 0.0:
		velocity.y = jump_velocity
		_buffer = 0.0
		_coyote = 0.0
		Sfx.play("jump")
	if velocity.y > 0.0 and not _jump_held():
		velocity.y -= gravity * delta * 1.6  # short hop when the key is let go

	var target := ix * speed
	var a := accel if is_on_floor() else air_accel
	velocity.x = move_toward(velocity.x, target, a * delta) + _knock
	_knock = move_toward(_knock, 0.0, 30.0 * delta)
	velocity.z = 0.0
	move_and_slide()
	position.z = 0.0  # the gameplay plane: nothing may push the mage into the background
	if absf(ix) > 0.1:
		facing = signf(ix)

	if is_on_floor() and not _was_on_floor:
		Sfx.play("land")
		landed.emit()
	_was_on_floor = is_on_floor()

	if global_position.y < kill_y:
		fell.emit()

	_update_focus()
	if not lock and _cooldown <= 0.0 and _interact_pressed() and focused:
		_cooldown = interact_cooldown
		focused.interact(self)
	_animate(delta, ix)


func _update_focus() -> void:
	var best: Interactable = null
	var best_d := INF
	if not locked():
		for c in _candidates:
			if not is_instance_valid(c) or not c.enabled:
				continue
			var d := absf(c.global_position.x - global_position.x)
			if d < best_d:
				best_d = d
				best = c
	if best != focused:
		if focused and is_instance_valid(focused):
			focused.set_focused(false)
		focused = best
		if focused:
			focused.set_focused(true)


func _animate(delta: float, ix: float) -> void:
	if model == null:
		return
	var yaw := deg_to_rad(68.0) * facing  # turned partly toward the camera so the face stays visible
	if MathChallengeManager.is_active():
		yaw = deg_to_rad(20.0) * facing
	model.rotation.y = lerp_angle(model.rotation.y, yaw, 1.0 - exp(-12.0 * delta))
	model.visible = _invuln <= 0.0 or int(_invuln * 12.0) % 2 == 0
	if anim == null or _action_t > 0.0:
		return
	var name := "Idle"
	if MathChallengeManager.is_active():
		name = "Spellcasting"
	elif not is_on_floor():
		name = "Jump_Idle" if velocity.y < 2.0 else "Jump_Start"
	elif absf(velocity.x) > 0.4:
		name = "Running_A"
		_step_t -= delta * absf(velocity.x)
		if _step_t <= 0.0:
			_step_t = 1.6
			Sfx.play("step", randf_range(0.9, 1.1))
	if anim.current_animation != name:
		anim.play(name, 0.15)
	anim.speed_scale = clampf(absf(velocity.x) / speed, 0.6, 1.2) if name == "Running_A" else 1.0


## Plays a one-shot animation (Cheer, Spellcast_Shoot, Hit_A, PickUp...) over the movement ones.
func play_action(name: String, duration := 0.8) -> void:
	if anim and anim.has_animation(name):
		anim.speed_scale = 1.0
		anim.play(name, 0.1)
		_action_t = duration


func respawn(at: Vector3) -> void:
	global_position = Vector3(at.x, at.y, 0.0)
	velocity = Vector3.ZERO
	_knock = 0.0
	_invuln = 1.2
	_buffer = 0.0
	Sfx.play("respawn")


func is_invulnerable() -> bool:
	return _invuln > 0.0


## A bump from the boss: pushed away from the hit, a short blink of safety. No game over.
func hurt(from_x: float) -> void:
	if _invuln > 0.0:
		return
	_invuln = 1.5
	_knock = 9.0 * signf(global_position.x - from_x if global_position.x != from_x else -1.0)
	velocity.y = 6.0
	play_action("Hit_A", 0.5)
	Sfx.play("hurt")
