class_name PuzzleBase
extends Node3D
## The shared life of a math puzzle: idle -> (interact) -> active (the challenge is open) -> solved.
## A wrong answer keeps the same question, shows what that answer would do in the world and lets the child
## try again as often as needed. Subclasses build the challenge and the visuals; this class owns the rules.

signal solved(puzzle: PuzzleBase)
signal state_changed(state: int)

enum State { IDLE, ACTIVE, SOLVED }

@export_enum("add", "sub", "missing", "mixed") var skill := "add"
@export_range(1, 5) var min_difficulty := 1
@export_range(1, 5) var max_difficulty := 2
## Shown in the HUD while this is the next thing to do (a translation key).
@export var objective := "Solve the puzzle."
## Where the mage comes back after a fall once this is solved, relative to the puzzle.
@export var checkpoint_offset := Vector3(2.5, 0.5, 0)

var state := State.IDLE
var challenge: MathChallenge
var attempts := 0
var wrong: Array[int] = []
var interactable: Interactable


func _ready() -> void:
	add_to_group("puzzle")
	interactable = Interactable.new()
	interactable.name = "Interactable"
	interactable.position = _interact_position()
	add_child(interactable)
	interactable.interacted.connect(_on_interact)
	_build()


## The question the dialog shows above the equation, in simple words (a translation key).
func prompt() -> String:
	return "Solve it!"


func is_solved() -> bool:
	return state == State.SOLVED


func focus_point() -> Vector3:
	return global_position + Vector3(0, 1.5, 0)


func checkpoint_position() -> Vector3:
	return global_position + checkpoint_offset


func _on_interact(_player: Player) -> void:
	if state != State.IDLE or not _can_start():
		return
	if challenge == null:
		challenge = _make_challenge()
	wrong.clear()
	attempts = 0
	if MathChallengeManager.open(challenge, self):
		_set_state(State.ACTIVE)
		Sfx.play("click")


## The dialog calls this for every answer. Returns {correct: bool, message: String}.
func submit_answer(value: int) -> Dictionary:
	if state != State.ACTIVE:
		return {correct = false, message = ""}
	attempts += 1
	if challenge.is_correct(value):
		MathChallengeManager.record(challenge, attempts == 1)
		return {correct = true, message = "Great job!"}
	if not wrong.has(value):
		wrong.append(value)
	_show_wrong(value)
	return {correct = false, message = _wrong_message(value)}


## The dialog closed. On success the world reacts; otherwise everything waits, unchanged, for the next try.
func dialog_closed(was_solved: bool) -> void:
	if was_solved:
		_set_state(State.SOLVED)
		interactable.enabled = false
		var p := Level.of(self)
		if p and p.player:
			p.player.play_action("Spellcast_Shoot", 0.9)
		await _play_solved()
		solved.emit(self)
	else:
		_set_state(State.IDLE)
		_reset_wrong()


func _set_state(s: State) -> void:
	state = s
	state_changed.emit(s)
	_show_state()


## "A little more" / "a little less": a direction, never a verdict. Missing-amount puzzles talk about the world.
func _wrong_message(value: int) -> String:
	if value < challenge.answer:
		return "Almost! You need a little more."
	return "Almost! That is a little too many."


# --- for subclasses -------------------------------------------------------------------------------------------

func _build() -> void:
	pass


func _interact_position() -> Vector3:
	return Vector3.ZERO


func _can_start() -> bool:
	return true


func _make_challenge() -> MathChallenge:
	return MathChallengeManager.create(skill, min_difficulty, max_difficulty)


func _show_state() -> void:
	pass


func _show_wrong(_value: int) -> void:
	pass


func _reset_wrong() -> void:
	pass


func _play_solved() -> void:
	await get_tree().process_frame
