extends SceneTree
## The real game, headless: the main scene boots, every manual action, worker control, upgrade, ark stage
## and event goes through the UI's own paths (the Game autoload and the world's clickable areas), the ark
## launches, a new dawn starts, saves round-trip, the layout switches to portrait and the language to RO.
## A script error anywhere shows up as "SCRIPT ERROR" in the output (CI greps for it).
##   godot --headless --path godot/rust -s res://tests/scenes.gd

var main: Node
var game: Node
var failed := 0


func check(cond: bool, what: String) -> void:
	if not cond:
		failed += 1
		printerr("FAIL ", what)


func _initialize() -> void:
	SaveManager.dir = "user://scene-test"
	SaveManager.delete_all()
	for p in ["res://scenes/world/worker_robot.tscn", "res://scenes/world/scrap_pile.tscn", "res://scenes/world/sorting_station.tscn",
			"res://scenes/world/repair_station.tscn", "res://scenes/world/reactor_core.tscn", "res://scenes/world/ark.tscn",
			"res://scenes/world/conveyor.tscn", "res://scenes/ui/modal.tscn", "res://scenes/ui/toast_layer.tscn"]:
		check(load(p) != null, "loads " + p)
	main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	_run.call_deferred()


func _frames(n: int) -> void:
	for k in n:
		await process_frame


func _run() -> void:
	game = root.get_node("/root/Game")
	await _frames(3)
	var s: GameState = game.s
	check(game.running and s.seen.has("wake"), "the game boots with the first story line")
	var world = main.world
	# manual play through the scene's clickable objects
	for i in 30:
		world.piles.yard.area.activate()
	check(game.s.stats.scrap >= 30.0, "clicking the pile digs")
	for i in 6:
		world.table.area.activate()
	check(game.s.parts >= 5.0, "clicking the table sorts")
	game.s.parts = 10
	for i in 20:
		world.bay.area.activate()
	check(game.s.built == 1 and game.s.robots.idle == 1, "clicking the bay repairs a robot")
	await _frames(2)
	check(world.crew.count("idle") == 1, "the new robot is in the scene")
	game.assign("digger", 1)
	await _frames(2)
	check(world.crew.count("digger") == 1, "the digger goes to work in the scene")
	# a richer yard: workers of all roles, upgrades bought, the ark built stage by stage
	game.s.parts = 1e7
	game.s.cores = 1e5
	game.s.scrap = 500
	game.s.built = 5
	game.s.stats.parts = 1e6
	game.s.stats.cores = 100
	game.s.robots.idle = 12
	game.assign_all("sorter")
	check(game.s.robots.sorter == 12 and game.s.robots.idle == 0, "assign all")
	game.unassign_all("sorter")
	game.assign("sorter", 4)
	game.assign("mechanic", 4)
	game.assign("digger", 4)
	for u in GameData.upgrades():
		game.buy(u.id)
	for u in GameData.upgrades():
		if not u.id in ["drone", "reactor_stab"]:
			check(game.s.lvl(u.id) >= 1, "bought " + u.id)
	game.advance(5.0)
	await _frames(20)
	check(world.crew.count("sorter") == 4 and world.crew.count("mechanic") == 4, "the crew in the scene matches the brigade")
	for i in 6:
		check(game.build_stage(), "stage %d" % (i + 1))
		await _frames(3)
	check(game.buy("reactor_stab"), "the stabilizer after the power stage")
	check(game.buy("drone"), "the drone after the stabilizer")
	for t in ["sort", "repair", "dig"]:
		game.set_drone_task(t)
		game.advance(3.0)
	check("north" in game.s.zones and world.piles.north.open, "the north zone opens in the scene")
	# events through their scene objects
	game.s.ev.salvage_at = game.s.time + 0.05
	game.advance(0.3)
	await _frames(2)
	check(world._crate.visible, "the salvage crate appears")
	world._crate_area.activate()
	check(game.s.stats.salvage == 1, "picked up by a click")
	game.s.ev.wreck_at = game.s.time + 0.05
	game.advance(0.3)
	await _frames(2)
	check(world._wreck.visible, "the wreck appears")
	world._wreck_area.activate()
	check(game.s.stats.wrecks == 1, "recruited by a click")
	game.s.ev.shortage_at = game.s.time + 0.05
	game.advance(0.3)
	await _frames(2)
	check(game.s.shortage_active() and world.reactor.area.enabled, "a shortage makes the reactor clickable")
	for i in 5:
		world.reactor.area.activate()
	check(not game.s.shortage_active(), "five hits fix it")
	# pause
	game.set_paused(true)
	var t0: float = game.s.time
	await _frames(20)
	check(game.s.time == t0, "paused")
	game.set_paused(false)
	# saving
	check(game.save_manual(), "manual save")
	var parts: float = game.s.parts
	game.s.parts = 1
	check(game.load_manual() and is_equal_approx(game.s.parts, parts), "manual load restores")
	# the launch
	check(game.build_stage(), "the last stage")
	check(game.s.launched and world.ark.launching(), "the ark launches")
	for i in 100:
		world.ark._process(0.1)
	await _frames(3)
	check(main.modal.visible, "the launch dialog")
	var bp: int = game.s.blueprints
	game.new_dawn()
	await _frames(3)
	check(game.s.runs == 1 and game.s.blueprints > bp and game.s.stage == 0, "a new dawn")
	check(world.crew.robots.is_empty(), "the yard is empty again")
	# the screen in other shapes and languages
	root.size = Vector2i(720, 1280)
	main._layout()
	await _frames(3)
	check(main._body.vertical, "portrait stacks the panels")
	root.size = Vector2i(1280, 760)
	main._layout()
	Settings.set_lang("ro")
	main._on_language()
	await _frames(3)
	check(tr("Копать") == "Sapă", "Romanian")
	Settings.set_lang("ru")
	main._on_language()
	# time away
	game._catch_up(3600.0, true)
	await _frames(2)
	game.reset()
	await _frames(3)
	check(game.s.built == 0 and not game.s.achievements.is_empty(), "start over keeps achievements")
	SaveManager.delete_all()
	print("scenes: %s" % ("ok" if failed == 0 else "%d problems" % failed))
	quit(1 if failed else 0)
