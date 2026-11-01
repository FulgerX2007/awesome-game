extends SceneTree
## The real game, headless: the main scene runs the first level and each region's boss level for a while with
## a bot playing (castle, units, defences, effects and the HUD all live), the menu screens open, and every
## model of assets/ loads. A script error anywhere shows up as "SCRIPT ERROR" in the output (CI greps for it).
##   godot --headless --path godot/castle -s res://tests/scenes.gd

var main: Node
var failed := 0


func check(cond: bool, what: String) -> void:
	if not cond:
		failed += 1
		printerr("FAIL ", what)


func _initialize() -> void:
	for dir in ["res://assets/avramania", "res://assets/winter"]:
		for n in DirAccess.get_files_at(dir):
			if n.ends_with(".glb"):
				var name := n.replace("mdvl_", "").replace(".glb", "")
				var m := Kit.pack(name if dir.ends_with("avramania") else "winter/" + name)
				check(m != null and m.get_surface_count() > 0, "model %s" % n)
	main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	_run.call_deferred()


func _frames(n: int) -> void:
	for k in n:
		await process_frame


func _run() -> void:
	await _frames(3)
	check(main.screen == "menu", "the game opens on the menu")
	for s in ["map", "armory"]:
		main.debug_setup({screen = s})
		await _frames(2)
		check(main.screen == s, "screen %s" % s)
	main.show_brief(4)
	await _frames(2)
	for n in [1, 4, 8, 12, 16, 20]:
		main.debug_setup({level = n, t = 25.0})
		await _frames(30)
		check(main.screen in ["play", "result"] and main.sim != null and main.sim.level_n == n, "level %d runs" % n)
		check(main.units.views.size() >= main.sim.enemies.size(), "level %d: every enemy has a view" % n)
		main.set_paused(true)
		await _frames(2)
		main.set_paused(false)
	main.start_endless()
	main.debug_setup({t = 5.0})
	await _frames(10)
	check(main.sim.mode == "endless", "the endless mode runs")
	main.sim.status = "lost"
	main._finish()
	await _frames(3)
	check(main.screen == "result", "the endless run ends on the result screen")
	print("scenes: %s" % ("ok" if failed == 0 else "%d problems" % failed))
	quit(1 if failed else 0)
