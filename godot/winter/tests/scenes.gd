extends SceneTree
## The real game, headless: the main scene opens on the menu, a winter starts, the hero walks and works, the
## world runs through a dusk, a night with wolves and a blizzard day; every window opens; the game saves, goes to
## the menu and continues from the save; the hero dies and the result screen offers «Начать день заново».
## A script error anywhere shows up as "SCRIPT ERROR" in the output (CI greps for it).
##   godot --headless --path godot/winter -s res://tests/scenes.gd

var main: Node
var failed := 0


func check(cond: bool, what: String) -> void:
	if not cond:
		failed += 1
		printerr("FAIL ", what)


func _initialize() -> void:
	WinterStore.set_item("winter-godot.save", "")
	main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	_run.call_deferred()


func _frames(n: int) -> void:
	for k in n:
		await process_frame


## Advances the rules by `seconds` of world time (in the steps the game uses) and lets the view catch up.
func _advance(seconds: float) -> void:
	var g: Dictionary = main.g
	var left := seconds
	while left > 0.0 and g.status == "playing":
		WinterSim.step(g, 0.25)
		main.handle(WinterSim.drain(g))
		left -= 0.25
	await _frames(3)


func _run() -> void:
	await _frames(3)
	check(main.screen == "menu", "the game opens on the menu")
	check(main.panels.current == "menu", "the menu window is up")
	main._on_panel("start", "normal")
	await _frames(5)
	check(main.screen == "play" and main.g.status == "playing", "a normal winter starts")
	check(main.world.props.views.size() == main.g.nodes.size(), "every map node has a view")
	# walk to a tree and chop it
	var g: Dictionary = main.g
	var tree = null
	for n in g.nodes:
		if n.kind == "tree" and WinterSim.hypot(float(n.x) - g.hero.x, float(n.y) - g.hero.y) < 12:
			tree = n
			break
	check(tree != null, "a tree near the camp")
	if tree:
		main.tap(int(tree.x), int(tree.y))
		await _advance(12.0)
		check(int(g.stock.wood) > 10 or float(tree.amount) < 12.0, "the hero chopped wood")
	for p in ["build", "bench", "inventory"]:
		main._toggle_panel(p)
		await _frames(3)
		check(main.panels.current == p, "window %s opens" % p)
		main.panels.close()
	main.set_paused(true)
	await _frames(2)
	check(main.panels.current == "pause", "pause opens")
	main._on_panel("settings", null)
	await _frames(2)
	check(main.panels.current == "settings", "settings open")
	main._on_panel("setting", ["weather", 0.5])
	main._on_panel("settings_done", "pause")
	main.set_paused(false)
	# dusk, then a night with wolves
	await _advance(WinterSim.NIGHT_AT + 5.0 - WinterSim.time_of_day(g))
	check(WinterSim.is_night(g), "night falls")
	await _frames(10)
	check(main.world.lights.night > 0.3, "the world is dark at night")
	check(g.wolves.size() == main.world.actors.views.keys().filter(func(k): return String(k).begins_with("wf:")).size(), "every wolf has a view")
	# the save and the way back to it
	main.save_current()
	var saved = main.save.current
	check(saved != null, "the game saved")
	main.show_menu()
	await _frames(3)
	check(main.panels.current == "menu", "back on the menu")
	main._on_panel("continue", null)
	await _frames(5)
	check(main.screen == "play" and WinterSim.day_of(main.g) == WinterSim.day_of(g), "the winter continues from the save")
	g = main.g
	# a blizzard day: jump to the first one
	var blz := 0
	for d in range(1, 31):
		if WinterSim.is_blizzard(g, d):
			blz = d
			break
	g.t = (blz - 1) * WinterSim.DAY + 20.0
	g.hero.warmth = 100.0
	g.hero.food = 100.0
	g.hero.health = 100.0
	await _frames(20)
	check(main.world.weather.level == "blizzard", "a blizzard shows on its day")
	# the end: the hero freezes; the result offers the day again
	main.save.dawn = WinterSim.snapshot(g)
	g.hero.health = 0.5
	g.hero.warmth = 0.0
	g.hero.food = 0.0
	await _advance(3.0)
	await _frames(5)
	check(main.screen == "result" and main.panels.current == "result", "losing shows the result")
	main._on_panel("retry", null)
	await _frames(5)
	check(main.screen == "play", "«Начать день заново» starts the day again")
	main.show_menu()
	await _frames(3)
	print("scenes: %s" % ("ok" if failed == 0 else "%d problems" % failed))
	quit(1 if failed else 0)
