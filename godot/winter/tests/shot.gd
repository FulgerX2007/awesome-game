extends SceneTree
## Frames of the real game as PNGs, for eyes (needs a display: xvfb-run works):
##   xvfb-run -a godot --path godot/winter -s res://tests/shot.gd --resolution 1600x900 -- <out dir> [scene …]
## Scenes: menu, day, dusk, night, blizzard, build, bench, inventory, forest, chop, mine (the frame of the blow).
## Without names, all of them.

const ALL := ["menu", "day", "dusk", "night", "blizzard", "build", "bench", "inventory", "forest", "chop", "mine"]

var main: Node
var out := "user://shots"


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	WinterStore.set_item("winter-godot.save", "")
	main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	var names: Array = args.slice(1) if args.size() > 1 else ALL
	_run.call_deferred(names)


func _frames(n: int) -> void:
	for k in n:
		await process_frame


func _shot(name: String) -> void:
	await _frames(4)
	var img := root.get_texture().get_image()
	img.save_png("%s/%s.png" % [out, name])
	print("shot ", name)


func _game(seed := 7) -> Dictionary:
	main.begin(WinterSim.new_game("normal", seed))
	var g: Dictionary = main.g
	# a lived-in camp: the hut with its roof, two palisade walls, a torch, wood and stone in stock
	g.hut.stage = 3
	g.palisade[0] = {"built": true, "hp": 100, "paid": {}}
	g.palisade[3] = {"built": true, "hp": 40, "paid": {}}
	g.palisade[1].paid = {"wood": 12}
	g.stock.wood = 60
	g.stock.stone = 25
	g.torches.append({"x": 30, "y": 22})
	g.fire.fuel = 14.0
	main.world.show_game(g)
	return g


func _run(names: Array) -> void:
	await _frames(5)
	for n in names:
		match n:
			"menu":
				main.show_menu()
				await _frames(30)
				await _shot("menu")
			"day", "dusk", "night":
				var g := _game()
				g.t = {"day": 30.0, "dusk": 92.0, "night": 118.0}[n]
				g.hero.x = 28.6
				g.hero.y = 21.4
				await _frames(60)
				await _shot(n)
			"blizzard":
				var g := _game()
				for d in range(1, 31):
					if WinterSim.is_blizzard(g, d):
						g.t = (d - 1) * WinterSim.DAY + 40.0
						break
				await _frames(90)
				await _shot("blizzard")
			"build", "bench", "inventory":
				var g := _game()
				g.t = 40.0
				main._toggle_panel(n)
				await _frames(20)
				await _shot(n)
				main.panels.close()
			"chop", "mine":
				# the hero next to a tree (or a rock, with a pick), the frame right after a blow lands
				var g := _game()
				g.t = 45.0
				g.tools.pick = true
				var kind := "tree" if n == "chop" else "rock"
				var node = null
				for nd in g.nodes:
					if nd.kind == kind and WinterSim.hyp(float(nd.x) - 27.0, float(nd.y) - 20.0) < 14.0:
						node = nd
						break
				g.hero.x = float(node.x) - 0.5
				g.hero.y = float(node.y) + 0.5
				main.world.show_game(g)
				main.tap(int(node.x), int(node.y))
				var hits := 0
				for k in 200:
					WinterSim.step(g, 1.0 / 60.0)
					var ev := WinterSim.drain(g)
					main.handle(ev)
					await process_frame
					if ev.any(func(e): return e.type == "gather"):
						hits += 1
						if hits == 2:
							break
				await _frames(1)
				await _shot(n)
			"forest":
				var g := _game()
				g.t = 50.0
				g.hero.x = 14.5
				g.hero.y = 28.5
				await _frames(60)
				await _shot("forest")
	quit()
