extends SceneTree
## Screenshots of the real game at points of progress, for checking the look (needs a display):
##   xvfb-run -s "-screen 0 1600x900x24" godot --path godot/rust --rendering-driver opengl3 -s res://tests/shot.gd -- early out.png [WxH]
## Scenarios: start, early, mid, late, shortage, portrait.

var main: Node
var scenario := "mid"
var out := "user://shot.png"


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		scenario = args[0]
	if args.size() > 1:
		out = args[1]
	if args.size() > 2:
		var wh := args[2].split("x")
		root.size = Vector2i(int(wh[0]), int(wh[1]))
	SaveManager.dir = "user://shot-saves"
	SaveManager.delete_all()
	main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	_run.call_deferred()


static func scenario_state(name: String) -> GameState:
	var s := GameState.create(3)
	match name:
		"start":
			s.scrap = 4
		"early":
			s.scrap = 40
			s.parts = 18
			s.built = 3
			s.robots = {idle = 1, digger = 1, sorter = 1, mechanic = 0}
			s.up = {shovel = 3, gloves = 1, wrench = 1}
			s.repair = {progress = 9.0, need = 29.0, free = false}
			s.stats.parts = 60
		"mid", "shortage", "portrait":
			s.scrap = 2400
			s.parts = 5200
			s.cores = 6
			s.built = 26
			s.robots = {idle = 2, digger = 9, sorter = 8, mechanic = 7}
			s.up = {shovel = 8, gloves = 5, wrench = 5, magnet = 6, belt = 5, oil = 4, dispatch = 1, smelter = 1, scanner = 2, factory = 2}
			s.stage = 3
			s.zones = ["yard", "north"]
			s.repair = {progress = 40.0, need = 98.0, free = false}
			s.stats.parts = 20000
			s.stats.cores = 14
			s.ev.salvage = {scrap = 300.0, parts = 40.0, cores = 0.0}
			s.ev.salvage_left = 20.0
			s.ev.salvage_at = 9999.0
			s.ev.wreck = true
			s.time = 2400
			if name == "shortage":
				s.ev.shortage_left = 25.0
				s.ev.shortage_at = 99999.0
		"late":
			s.scrap = 90000
			s.parts = 160000
			s.cores = 70
			s.built = 110
			s.robots = {idle = 0, digger = 40, sorter = 38, mechanic = 32}
			s.up = {shovel = 15, gloves = 10, wrench = 10, magnet = 14, belt = 13, oil = 12, dispatch = 1, smelter = 3, scanner = 8, factory = 9, neuro = 3, reactor_stab = 3, drone = 2}
			s.stage = 6
			s.zones = ["yard", "north", "graveyard"]
			s.repair = {progress = 200.0, need = 350.0, free = false}
			s.stats.parts = 700000
			s.stats.cores = 300
			s.time = 4300
			s.blueprints = 2
			s.runs = 1
	for a in GameData.achievements():
		if AchievementManager.met(s, a):
			s.achievements[a.id] = true
	StoryData.check(s)
	if s.built >= 1:
		StoryData.add_log(s, "Брошенный робот ещё моргает. Его оттащили к ремонтной станции: починка бесплатная.")
	s.drain()
	return s


func _run() -> void:
	await process_frame
	var Game = root.get_node("/root/Game")
	Game.s = scenario_state(scenario)
	Game.state_replaced.emit()
	if scenario == "shortage":
		Game.notify.emit(tr("Перебой с питанием! Автоматика на половине мощности"), "warn")
	else:
		Game.notify.emit(tr("Находка! Светящийся ящик на свалке — подбери, пока не засыпало"), "info")
	for i in 240:
		await process_frame
	var img := root.get_texture().get_image()
	img.save_png(out)
	print("saved ", out, " ", img.get_size())
	quit()
