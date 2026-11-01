extends SceneTree
## Renders a frame to a PNG, to look at the game without a browser (needs a display: xvfb-run works):
##   xvfb-run -a godot --path godot/castle --rendering-driver opengl3 -s res://tests/shot.gd -- out=/tmp/a.png env=frost time=night
## With level=N the whole game runs that level for t seconds (a bot plays it) before the shot.

var args := {}
var frames := 0
var main: Node


func _initialize() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := String(a).split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var size := Vector2i(int(args.get("w", 1280)), int(args.get("h", 720)))
	root.size = size
	DisplayServer.window_set_size(size)
	if args.has("level") or args.has("screen") or args.has("menu"):
		main = load("res://scenes/main.tscn").instantiate()
		root.add_child(main)
		main.call_deferred("debug_setup", args)
	else:
		var w := CastleWorld.new()
		root.add_child(w)
		w.build(args.get("env", "frontier"), args.get("time", "day"))
		if args.has("castle"):
			var c := CastleKeep.new()
			w.add_child(c)
			c.build(w)
			c.set_health(float(args.castle), true)
		if args.has("look"):
			# a close-up: look=x,y,z,distance
			var v := String(args.look).split(",")
			var at := Vector3(float(v[0]), float(v[1]), float(v[2]))
			w.set_view(Transform3D(Basis(), at + Vector3(float(v[3]) * 0.35, float(v[3]) * 0.12, float(v[3]))).looking_at(at))


func _process(_delta: float) -> bool:
	frames += 1
	if frames == int(args.get("frames", 30)):
		var img := root.get_texture().get_image()
		img.save_png(args.get("out", "/tmp/claude-0/shots/shot.png"))
		print("saved ", args.get("out", ""))
		quit()
	return false
