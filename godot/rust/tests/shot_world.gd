extends SceneTree
## The scrapyard alone, full frame, for checking composition (needs a display):
##   xvfb-run godot --path godot/rust --rendering-driver opengl3 -s res://tests/shot_world.gd -- mid out.png [hide=ark,fog]

func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var args := OS.get_cmdline_user_args()
	root.size = Vector2i(1400, 760)
	var Game = root.get_node("/root/Game")
	Game.s = load("res://tests/shot.gd").scenario_state(args[0] if args.size() > 0 else "mid")
	var w = load("res://scenes/world/scrapyard_world.tscn").instantiate()
	root.add_child(w)
	w.camera.make_current()
	w.fit_camera(Vector2(root.size))
	var hide: String = args[2] if args.size() > 2 else ""
	if "ark" in hide:
		w.ark.visible = false
	if "fog" in hide:
		w.env.fog_enabled = false
	Game.state_replaced.emit()
	for i in 30:
		await process_frame
	root.get_texture().get_image().save_png(args[1] if args.size() > 1 else "user://world.png")
	quit()
