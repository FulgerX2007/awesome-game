extends SceneTree
## Renders the enemies and bosses in a row on the lane, to check the models (needs a display: xvfb-run):
##   xvfb-run -a godot --path godot/castle --rendering-driver opengl3 -s res://tests/preview_units.gd -- out=/tmp/u.png
## kinds=a,b,c picks who stands there (default: all ten enemies and five bosses), x0= where the row starts,
## zoom=N brings the camera N times closer to the middle of the row, state=... forces a pose on bosses,
## walk=1 lets them walk for the frames before the shot, env= and time= pick the scenery.

const ENEMIES := ["footman", "scout", "shield", "knight", "archer", "ram", "golem", "berserker", "commander", "flyer"]
const BOSSES := ["iron_warlord", "siege_titan", "fire_dragon", "shadow_beast", "dark_king"]

var args := {}
var frames := 0
var world: CastleWorld
var units: CastleUnits
var sim: CastleSim
var mid := 30.0


func _initialize() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := String(a).split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var size := Vector2i(int(args.get("w", 1280)), int(args.get("h", 720)))
	root.size = size
	DisplayServer.window_set_size(size)
	world = CastleWorld.new()
	root.add_child(world)
	world.build(args.get("env", "frontier"), args.get("time", "day"))
	units = CastleUnits.new()
	world.add_child(units)
	sim = CastleSim.new_level(1)
	sim.status = "wave"
	var kinds: Array = (ENEMIES + BOSSES) if not args.has("kinds") else Array(String(args.kinds).split(","))
	var x := float(args.get("x0", 6.0))
	var xs := []
	for k in kinds:
		var c := CastleContent.body(k)
		x += float(c.w) * 0.5 + 0.6
		var e := sim.spawn(k, {x = x, hp_mul = 1.0, speed_mul = 1.0})
		if args.has("state") and e.boss:
			e.state = args.state
		if args.has("vuln"):
			e.vulnerable = 5.0
		if not args.has("walk"):
			e.base_speed = 0.0
		xs.append(x)
		x += float(c.w) * 0.5 + 0.6
	mid = (xs[0] + xs[-1]) * 0.5
	sim.drain()


func _process(delta: float) -> bool:
	frames += 1
	if args.has("walk"):
		for e in sim.enemies:
			if not e.flies and not e.boss:
				sim.ground_step(e)
	units.sync(sim, 1.0 / 30.0)
	if args.has("zoom"):
		var z := float(args.zoom)
		if frames == 1:
			var t: Transform3D = world._cam_base
			var target := Vector3(float(args.get("cx", mid)), float(args.get("cy", 2.2)), 0)
			# the world's camera shake reads its base transform every frame: move that
			world._cam_base = Transform3D(t.basis, target + t.basis.z * t.origin.z / t.basis.z.z / z)
	if frames == int(args.get("frames", 24)):
		var img := root.get_texture().get_image()
		img.save_png(args.get("out", "/tmp/claude-0/shots/units.png"))
		print("saved ", args.get("out", ""))
		quit()
	return false
