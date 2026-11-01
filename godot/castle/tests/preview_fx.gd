extends SceneTree
## Looks at the defences and the combat effects without the rest of the game (needs a display: xvfb-run):
##   xvfb-run -a godot --path godot/castle --rendering-driver opengl3 -s res://tests/preview_fx.gd -- out=/tmp/d.png close=1 t=3
## Builds the frontier, puts all five defences in slots 0–4 (some damaged), runs a wave with enemies, a boss's
## telegraph, fire and curse zones and enemy missiles, and saves a PNG after t seconds. close=1 moves the camera in.

var args := {}
var frames := 0
var world: CastleWorld
var sim: CastleSim
var defs: CastleDefenses
var fx: CastleFx


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
	defs = CastleDefenses.new()
	world.add_child(defs)
	fx = CastleFx.new()
	world.add_child(fx)
	fx.setup(world)
	sim = CastleSim.new_level(20)
	sim.status = "between"
	sim.slots = 6
	sim.gold = 9999
	sim.prep_left = 0
	sim.offer = []
	var types := ["stakes", "barricade", "reinforced", "tower", "oil", "stakes"]
	for i in types.size():
		sim.place(i, types[i])
	var dmg: bool = args.get("dmg", "1") == "1"
	if dmg:
		sim.defense_at(1).hp *= 0.5
		sim.defense_at(5).hp *= 0.25
		sim.defense_at(2).hp *= 0.3
	sim.status = "wave"
	sim.queue = []
	sim.set_firing(true)
	var anchor := sim.spawn("golem", {x = 58.0})   # keeps the wave going
	anchor.base_speed = 0.0
	anchor.hp = 1e9
	sim.aim(0.25, 0.8)
	if args.has("enemies"):
		for k in 4:
			sim.spawn("footman", {x = 30.0 + k * 2.5})
		sim.spawn("archer", {x = 22.0})
		sim.spawn("flyer", {x = 26.0, alt = 7.0})
	if args.has("boss"):
		var b := sim.spawn("fire_dragon", {x = 30.0})
		b.brain.fb_cd = 0.3
	sim.zones.append({kind = "oil", x0 = 20.0, x1 = 26.0, t = 0.0, dur = 99.0, enemy = 0.0, struct = 0.0, wall = 0.0})
	sim.zones.append({kind = "curse", x0 = 32.0, x1 = 37.0, t = 0.0, delay = 0.0, dur = 99.0, enemy = 0.0, struct = 0.0, wall = 0.0})
	sim.add_shot("boulder", Vector2(40, 4), Vector2(10, 1), null, 1, 1, 6.0)
	sim.add_shot("fireball", Vector2(42, 9), Vector2(15, 1), null, 1, 1, 6.0)
	sim.add_shot("bolt", Vector2(45, 4), Vector2(12, 3), null, 1, 1, 6.0)
	sim.add_shot("arrow", Vector2(35, 2), Vector2(3, 5), null, 1, 1, 6.0)
	if args.has("close"):
		var cam := world.camera
		cam.keep_aspect = Camera3D.KEEP_HEIGHT
		cam.fov = 45.0
	var pts := PackedVector3Array()
	for k in 24:
		var p := sim.flight(0.5, 0.8, k * 0.08)
		pts.append(Vector3(p.x, p.y, 0))
	fx.show_aim(pts)
	defs.show_slots(6, args.get("ghost", "tower"), 5, "nogold" if args.has("bad") else "")


func _process(delta: float) -> bool:
	frames += 1
	if args.has("close"):
		world.set_process(false)
		var tgt := Vector3(float(args.get("cx", 15.0)), 1.6, 0.0)
		world.camera.look_at_from_position(tgt + Vector3(-2.0, 4.5, 17.0), tgt)
	sim.step(1.0 / 60.0)
	for ev in sim.drain():
		defs.on_event(ev)
		fx.on_event(ev)
	if frames == 20:
		var tel: Dictionary = {type = "telegraph", kind = "slam", x0 = 40.0, x1 = 48.0, dur = 3.0}
		fx.on_event(tel)
		fx.on_event({type = "shot_hit", kind = "fireball", x = 10.0, y = 2.0})
		fx.on_event({type = "kill", x = 33.0, y = 0.0, gold = 6, id = 0})
		fx.on_event({type = "wall_hit", amount = 3.0})
		fx.on_event({type = "fixed"})
	if frames == 40 and args.has("destroy"):
		sim.defense_at(0).dead = true
		sim.defenses = sim.defenses.filter(func(d): return not d.dead)
	defs.sync(sim, 1.0 / 60.0)
	fx.sync(sim, 1.0 / 60.0)
	if frames == int(float(args.get("t", 1.0)) * 60.0):
		var img := root.get_texture().get_image()
		img.save_png(args.get("out", "/tmp/claude-0/shots/fx.png"))
		print("saved ", args.get("out", ""))
		quit()
	return false
