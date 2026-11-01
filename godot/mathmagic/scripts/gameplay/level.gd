class_name Level
extends Node3D
## The root of every level scene. Builds the shared environment, spawns the mage and the camera, counts
## stones and gems, keeps the current objective (the first puzzle not solved yet, from left to right),
## moves the respawn point forward at checkpoints and solved puzzles, and reports completion.
## Puzzles, pickups, checkpoints and the goal find it with Level.of(node).

signal completed
signal stones_changed(count: int)
signal gems_changed(found: int)
signal objective_changed(text: String)
signal message(text: String)
signal hearts_changed(hearts: int)

const MAX_HEARTS := 3

@export var level_index := 0
@export var camera_min_x := 0.0
@export var camera_max_x := 60.0
@export var kill_y := -3.5
## Short, simple lines shown one after another on the intro card (translation keys).
@export var intro: PackedStringArray = []

var level_id := ""
var stones := 0
var player: Player
var camera: GameCamera
var respawn_point := Vector3.ZERO
var puzzles: Array = []
var done := false
var hearts := MAX_HEARTS


static func of(node: Node) -> Level:
	var n := node
	while n:
		if n is Level:
			return n
		n = n.get_parent()
	return null


func _ready() -> void:
	add_to_group("level")
	level_id = LevelCatalog.get_level(level_index).id
	LevelEnvironment.build(self, camera_min_x, camera_max_x, LevelCatalog.world_of(level_index))
	var spawn: Node3D = get_node_or_null("Spawn")
	respawn_point = spawn.global_position if spawn else Vector3(0, 1, 0)

	player = Player.new()
	player.name = "Player"
	player.kill_y = kill_y
	add_child(player)
	player.global_position = respawn_point
	player.fell.connect(_on_fell)

	camera = GameCamera.new()
	camera.target = player
	camera.min_x = camera_min_x
	camera.max_x = camera_max_x
	add_child(camera)
	camera.make_current()
	camera.snap()

	for p in find_children("*", "Pickup", true, false):
		p.collected.connect(_on_pickup)
		if p.kind == "gem" and ProgressManager.has_gem(level_id, p.name):
			p.set_ghost()
	puzzles = find_children("*", "PuzzleBase", true, false)
	puzzles.sort_custom(func(a, b): return a.sort_key() < b.sort_key())
	for p in puzzles:
		p.solved.connect(_on_puzzle_solved)
	MathChallengeManager.challenge_opened.connect(_on_challenge_opened)
	MathChallengeManager.challenge_closed.connect(_on_challenge_closed)
	_update_objective.call_deferred()


func _exit_tree() -> void:
	if MathChallengeManager.challenge_opened.is_connected(_on_challenge_opened):
		MathChallengeManager.challenge_opened.disconnect(_on_challenge_opened)
		MathChallengeManager.challenge_closed.disconnect(_on_challenge_closed)


func add_stones(n: int) -> void:
	stones = maxi(0, stones + n)
	stones_changed.emit(stones)


func gems_found() -> int:
	return ProgressManager.gem_count(level_id)


func say(text: String) -> void:
	message.emit(text)


func set_checkpoint(at: Vector3) -> void:
	respawn_point = at


func objective() -> String:
	for p in puzzles:
		if not p.is_solved():
			return p.objective
	return "Reach the flag!"


func _update_objective() -> void:
	objective_changed.emit(objective())


func _on_pickup(p: Pickup) -> void:
	if p.kind == "gem":
		if not p.ghost:
			ProgressManager.collect_gem(level_id, p.name)
			say("You found a magic gem!")
		gems_changed.emit(gems_found())
	else:
		add_stones(1)


func _on_puzzle_solved(p: PuzzleBase) -> void:
	set_checkpoint(p.checkpoint_position())
	_update_objective()


func _on_fell() -> void:
	Sfx.play("splash")
	Fx.burst(self, Vector3(player.global_position.x, LevelEnvironment.WATER_Y, 0), Color("#bfe9ff"), 24, 5.0)
	player.respawn(respawn_point)
	camera.snap()
	say("Splash! Let's try again.")


## A bump from the boss costs a heart. With none left the mage is back at the last checkpoint with all
## hearts again; the boss keeps its phase, so no progress is lost.
func hurt_player(from_x: float) -> void:
	if done or player.is_invulnerable() or MathChallengeManager.is_active():
		return
	player.hurt(from_x)
	camera.shake(0.2, 0.3)
	hearts -= 1
	if hearts <= 0:
		say("Oops! Let's try again.")
		await get_tree().create_timer(0.7).timeout
		player.respawn(respawn_point)
		camera.snap()
		hearts = MAX_HEARTS
	hearts_changed.emit(hearts)


func _on_challenge_opened(_c: MathChallenge, requester: Object) -> void:
	if requester is Node and (requester as Node).has_method("focus_point") and is_ancestor_of(requester):
		camera.focus = requester.focus_point()


func _on_challenge_closed(_r: Object, _solved: bool) -> void:
	camera.focus = null


## Called by the goal. Plays the celebration and tells the level manager.
func complete() -> void:
	if done:
		return
	done = true
	player.controls_enabled = false
	player.play_action("cheer", 3.0)
	Sfx.play("victory")
	Fx.confetti(self, player.global_position + Vector3(0, 2, 0))
	ProgressManager.complete_level(level_index)
	completed.emit()
