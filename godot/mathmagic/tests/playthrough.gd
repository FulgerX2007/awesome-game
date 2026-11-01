extends Node
## Plays the whole game the way a child would, with the real scenes, physics and challenge dialog:
##   godot --headless --fixed-fps 60 --path godot/mathmagic res://tests/playthrough.tscn
## (a scene rather than a -s script, so the autoloads exist before the game scripts compile)
## A simple bot walks right, jumps over gaps and steps, waits for lifts, picks up stones, opens every
## challenge, answers one wrong first (to test that path), then right, and in level 5 waits until the
## Guardian is tired before going to the glowing crystal. Every level must end in its goal within the time
## limit; afterwards the progress must be saved and load back the same.

const LIMIT := 240.0      # seconds of game time per level

var Save: Node
var Progress: Node
var Math: Node
var main: Node
var failed := 0
var _interact_cd := 0.0
var _answering := false
var _wrong_given := {}
var _stuck_x := 0.0
var _stuck_t := 0.0


func _ready() -> void:
	Save = get_tree().root.get_node("SaveManager")
	Progress = get_tree().root.get_node("ProgressManager")
	Math = get_tree().root.get_node("MathChallengeManager")
	Save.path = "user://test_playthrough.json"
	Save.reset_progress()
	main = load("res://scenes/main/main.tscn").instantiate()
	add_child(main)
	await get_tree().process_frame
	await flows()
	var only := OS.get_cmdline_user_args()  # "-- 5" plays only level 5 (for debugging a level)
	for i in LevelCatalog.count():
		if not only.is_empty() and not only.has(str(i + 1)):
			continue
		var ok: bool = await play(i)
		print(("ok   " if ok else "FAIL ") + "level %d %s" % [i + 1, LevelCatalog.get_level(i).id])
		if not ok:
			failed += 1
	if only.is_empty():
		_check(Progress.completed.size() == LevelCatalog.count(), "all levels completed in the progress")
		_check(Progress.all_completed(), "the game is finished")
	var before := JSON.stringify(Save.snapshot())
	Save.save_game()
	Progress.reset()
	Math.reset()
	Save.load_game()
	var after := JSON.stringify(Save.snapshot())
	_check(after == before, "progress after the playthrough loads back the same")
	if after != before:
		printerr("  before: ", before, "\n  after:  ", after)
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Save.path))
	print("playthrough: %s" % ("PASS" if failed == 0 else "FAIL (%d)" % failed))
	get_tree().quit(1 if failed else 0)


func _check(ok: bool, what: String) -> void:
	print(("ok   " if ok else "FAIL ") + what)
	if not ok:
		failed += 1


## The menu flows a child goes through besides playing: pause and resume, restart, closing a challenge
## with "Later" and opening it again, the title and the map.
func flows() -> void:
	main.start(0)
	_check(main.ui.has_screen() and not main.levels.current.player.controls_enabled, "a level starts with its intro card, mage waiting")
	for b in main.ui.root.find_children("*", "Button", true, false):
		if b.is_visible_in_tree() and b.text == "Let's go!":
			b.pressed.emit()
	await get_tree().process_frame
	var lvl: Level = main.levels.current
	_check(not main.ui.has_screen() and lvl.player.controls_enabled, "Let's go closes the card and frees the mage")
	main.pause()
	_check(get_tree().paused and main.ui.has_screen(), "pause freezes the world and shows the menu")
	var x := lvl.player.global_position.x
	lvl.player.bot_input = {x = 1.0}
	for k in 20:
		await get_tree().process_frame
	_check(is_equal_approx(lvl.player.global_position.x, x), "nothing moves while paused")
	main.resume()
	_check(not get_tree().paused and not main.ui.has_screen(), "resume")
	var gate: PuzzleBase = lvl.puzzles[0]
	lvl.player.bot_input = null
	gate._on_interact(lvl.player)
	_check(Math.is_active() and main.ui.dialog.visible, "the gate opens its challenge")
	gate._on_interact(lvl.player)
	_check(gate.state == PuzzleBase.State.ACTIVE, "a second interaction while open changes nothing")
	main.ui.dialog._close(false)
	_check(not Math.is_active() and gate.state == PuzzleBase.State.IDLE and not gate.is_solved(), "Later closes it and the gate stays shut")
	gate._on_interact(lvl.player)
	_check(main.ui.dialog.visible and main.ui.dialog.challenge == gate.challenge, "it can be opened again with the same question")
	main.ui.dialog._close(false)
	main.start(0)
	_check(main.levels.current != lvl and not Math.is_active(), "restart builds the level fresh")
	main.show_map()
	_check(main.levels.current == null and main.ui.has_screen(), "the map closes the level")
	main.show_title()
	_check(main.ui.has_screen(), "back to the title")


func play(i: int) -> bool:
	main.start(i)
	main.ui.close_screen()
	main._on_intro_closed()
	var lvl: Level = main.levels.current
	_wrong_given.clear()
	_stuck_t = 0.0
	_stuck_x = lvl.player.global_position.x
	var t := 0.0
	var falls := [0]
	lvl.player.fell.connect(func(): falls[0] += 1)
	var unlocked_before: int = Progress.unlocked
	while t < LIMIT:
		await get_tree().physics_frame
		t += 1.0 / 60.0
		if lvl.done:
			for k in 30:
				await get_tree().physics_frame
			var gems := lvl.gems_found()
			print("     %s in %.0f s, %d falls, %d/3 gems, %d stones left" % [lvl.level_id, t, falls[0], gems, lvl.stones])
			if i + 1 < LevelCatalog.count():
				_check(Progress.unlocked >= mini(i + 2, LevelCatalog.count()) and Progress.unlocked >= unlocked_before, "level %d opens the next" % (i + 1))
			return true
		_drive(lvl, 1.0 / 60.0)
		if _stuck_t > 25.0:
			printerr("  stuck at x=%.1f y=%.1f after %d falls, objective: %s" % [lvl.player.global_position.x, lvl.player.global_position.y, falls[0], lvl.objective()])
			return false
	printerr("  out of time at x=%.1f y=%.1f after %d falls, objective: %s" % [lvl.player.global_position.x, lvl.player.global_position.y, falls[0], lvl.objective()])
	return false


## One frame of the bot.
func _drive(lvl: Level, dt: float) -> void:
	var p := lvl.player
	var pos := p.global_position
	_interact_cd -= dt
	if Math.is_active():
		p.bot_input = {x = 0.0, jump = false}
		if not _answering:
			_answer()
		return
	var target := _target(lvl)
	var tx: float = target.x
	var dx := tx - pos.x
	var input := {x = 0.0, jump = false, interact = false}

	# a lift nearby and the target far above: ride it
	var lift := _lift_for(lvl, target)
	if lift:
		var on_lift := absf(pos.x - lift.global_position.x) < 0.9 and absf(pos.y - lift.global_position.y) < 0.6
		if not on_lift:
			dx = lift.global_position.x - pos.x
			if absf(dx) < 0.4 and lift.global_position.y > pos.y + 0.3:
				dx = 0.0  # wait for it to come down
		elif lift.global_position.y < lift._start.y + lift.travel.y - 0.15:
			dx = 0.0  # going up
	if absf(dx) > 0.25:
		input.x = signf(dx)
	if target.get("interact", false) and absf(dx) < 1.2 and _interact_cd <= 0.0 and p.focused:
		input.interact = true
		_interact_cd = 0.6
	# jumping: into a wall, at the edge of a gap, or up to something just above
	if p.is_on_floor() and input.x != 0.0:
		var ahead := pos + Vector3(input.x * 0.9, 0.4, 0)
		if p.is_on_wall() or not _ground_below(p, ahead) or (target.y > pos.y + 0.8 and absf(dx) < 2.6):
			input.jump = true
	elif not p.is_on_floor():
		input.jump = p.velocity.y > 0.0  # hold for the full jump
	p.bot_input = input
	if absf(pos.x - _stuck_x) > 1.0:
		_stuck_x = pos.x
		_stuck_t = 0.0
	else:
		_stuck_t += dt


## Where to go: stones still needed before the next puzzle, then that puzzle, then the goal.
func _target(lvl: Level) -> Dictionary:
	var next: PuzzleBase = null
	for pz in lvl.puzzles:
		if not pz.is_solved():
			next = pz
			break
	var limit_x: float = next.global_position.x if next else INF
	var best: Pickup = null
	for pk in lvl.find_children("*", "Pickup", true, false):
		if pk.taken or pk.kind != "stone" or pk.global_position.x > limit_x:
			continue
		if best == null or absf(pk.global_position.x - lvl.player.global_position.x) < absf(best.global_position.x - lvl.player.global_position.x):
			best = pk
	if best and next is BridgePuzzle:
		return {x = best.global_position.x, y = best.global_position.y}
	if next:
		var boss := next as BossRune
		if boss and not boss.interactable.enabled:
			# the Guardian is attacking: wait in the middle of the arena and let it get tired
			var g := boss.guardian
			return {x = g.global_position.x - 14.0, y = 0.0}
		var ip := next.interactable.global_position
		return {x = ip.x, y = ip.y, interact = true}
	var goal: Goal = lvl.get_node_or_null("Goal")
	if goal and goal.visible:
		return {x = goal.global_position.x, y = goal.global_position.y}
	return {x = lvl.player.global_position.x, y = 0.0}


func _lift_for(lvl: Level, target: Dictionary) -> Lift:
	for l in lvl.find_children("*", "Lift", true, false):
		var lift := l as Lift
		if lift.active and target.y > lvl.player.global_position.y + 2.0 and absf(lift.global_position.x - lvl.player.global_position.x) < 6.0:
			return lift
	return null


func _ground_below(p: Player, from: Vector3) -> bool:
	var q := PhysicsRayQueryParameters3D.create(from, from + Vector3(0, -2.5, 0), 1)
	q.exclude = [p.get_rid()]
	return not p.get_world_3d().direct_space_state.intersect_ray(q).is_empty()


## Answers like a child who slips once: a wrong choice first (once per puzzle), then the right one.
func _answer() -> void:
	_answering = true
	var d: ChallengeDialog = main.ui.dialog
	for k in 20:
		await get_tree().physics_frame
	var c := d.challenge
	if c == null:
		_answering = false
		return
	var key := str(d.requester)
	if not _wrong_given.has(key):
		_wrong_given[key] = true
		for v in c.choices:
			if v != c.answer:
				d.answer(v)
				break
		for k in 30:
			await get_tree().physics_frame
	d.answer(c.answer)
	while Math.is_active():
		await get_tree().physics_frame
	_answering = false
