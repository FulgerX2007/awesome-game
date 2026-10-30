extends SceneTree
## Plays one level with a pull order and prints the outcome, for tuning and for the level tests.
##   godot --headless --fixed-fps 60 --path godot/pins -s res://tests/replay.gd -- <level 1..42> <order e.g. 132|best|loss>
## Like a patient player, each pin is pulled once the world has come to rest.

const World := preload("res://scripts/world.gd")


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/levels.json"))
	var n := int(args[0])
	var def: Dictionary = data.LEVELS[n - 1]
	var order: Array = def.best if args[1] == "best" else Array(args[1].split("")).map(func(c): return int(c))
	var r := await play(self, def, order, float(args[2]) if args.size() > 2 else 0.0)
	print(JSON.stringify(r))
	quit()


## eager: pull the next pin this many seconds after the previous one instead of waiting for rest (0 = patient).
static func play(tree: SceneTree, def: Dictionary, order: Array, eager := 0.0) -> Dictionary:
	var w := World.new()
	tree.root.add_child(w)
	w.build(def)
	var t0 := Time.get_ticks_msec()
	var next := 0
	var st := {}
	var frames := 0
	while frames < 60 * 90:
		await tree.physics_frame
		frames += 1
		st = w.status()
		if st.status != "playing":
			break
		if w.settled() and next >= order.size():
			break  # the order is done and nothing moves: what is not won by now is not won
		var ready := w.settled() if eager <= 0 or next == 0 else w.since_pull >= eager
		if ready and next < order.size():
			w.pull(int(order[next]))
			next += 1
	var out := {status = st.status, reason = st.reason, stars = w.stars(), gold = w.gold_in_room(), target = w.gold_target,
		enemies = w.live_enemies(), pulled = next, hazard = w.hazard_on_way(), settles = w.settle_log, game_s = snappedf(frames / 60.0, 0.1), wall_ms = Time.get_ticks_msec() - t0}
	w.queue_free()
	return out
