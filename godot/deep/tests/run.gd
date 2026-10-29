extends SceneTree
## Headless tests for the Godot port of Глубина:
##   godot --headless --path godot/deep -s res://tests/run.gd
## With "-- trace <seed> <r0> <depth> <steps>" it prints a bot run instead, for the parity test
## in tests/deep-godot/parity.test.js, which plays the same bot through web/deep/core.js.

const Core := preload("res://scripts/core.gd")

var failed := 0
var passed := 0


func _initialize() -> void:
	Core.load_data()
	var args := OS.get_cmdline_user_args()
	if args.size() >= 5 and args[0] == "trace":
		print(JSON.stringify(trace(int(args[1]), float(args[2]), float(args[3]), int(args[4]))))
		quit(0)
		return
	for name in ["test_rng", "test_length", "test_species_for", "test_stages", "test_bot_grows", "test_leviathan"]:
		var before := failed
		call(name)
		if failed == before:
			passed += 1
			print("ok   ", name)
		else:
			print("FAIL ", name)
	print("%d passed, %d failed" % [passed, failed])
	quit(1 if failed else 0)


func check(ok: bool, what: String) -> void:
	if not ok:
		failed += 1
		printerr("  ", what)


## The greedy bot from tests/deep/core.test.js: flee the nearest big hunter, else chase the best bite.
static func bot_input(w) -> Dictionary:
	var p = w.player
	var threat = null
	var td := INF
	var food = null
	var fs := INF
	for e in w.ents:
		var d := Core.hypot(e.x - p.x, e.y - p.y)
		if Core.is_hunter(e) and e.r > p.r * Core.EAT_RATIO and d < td:
			threat = e
			td = d
		if p.r > e.r * Core.EAT_RATIO and d / (e.r + 1) < fs:
			food = e
			fs = d / (e.r + 1)
	if threat and td < threat.r * 5:
		return {tx = 2 * p.x - threat.x, ty = 2 * p.y - threat.y, dash = td < threat.r * 2.5}
	if food:
		return {tx = food.x, ty = food.y + (2.5 - p.depth) * p.r * 3}
	return {}


static func trace(rng_seed: int, r0: float, depth: float, steps: int) -> Array:
	var w = Core.create_world(rng_seed, r0, depth)
	var out := []
	for i in steps:
		Core.step(w, 1.0 / 30, bot_input(w))
		w.events.clear()
		if i % 30 == 29:
			out.append([w.player.r, w.player.x, w.player.y, w.ents.size(), w.next_id])
	Core.free_world(w)
	return out


func test_rng() -> void:
	# first draws of mulberry32(1) and (123456789), as printed by core.js rng()
	var w = Core.World.new()
	w.seed_state = 1
	check(is_equal_approx(w.R(), 0.6270739405881613), "rng(1) first draw")
	w.seed_state = 123456789
	var a := w.R()
	check(a >= 0 and a < 1, "rng in [0, 1)")


func test_length() -> void:
	var near := func(a: float, b: float) -> bool: return absf(a - b) / b < 0.01
	check(near.call(Core.length_meters(Core.START_R), 1e-5), "10 µm cell")
	check(near.call(Core.length_meters(700), 30), "30 m whale")
	check(near.call(Core.length_meters(Core.MAX_R), 400), "400 m leviathan")
	var last := 0.0
	var r := Core.START_R
	while r <= Core.MAX_R:
		check(Core.length_meters(r) > last, "length grows at r=%f" % r)
		last = Core.length_meters(r)
		r *= 1.05
	check(Core.length_text(70) == "40 см", "length text: %s" % Core.length_text(70))


func test_species_for() -> void:
	var w = Core.create_world(3)
	for k in Core.KINDS:
		for z in Core.ZONES.size():
			var r: float = k.max * 0.9 if k.max < 1e11 else Core.MAX_R * 2
			check(Core.species_for(r, z + 0.5, w).cls == k.id, "%s in zone %d" % [k.id, z])
	Core.free_world(w)


func test_stages() -> void:
	for i in range(1, Core.STAGES.size()):
		check(Core.STAGES[i].from > Core.STAGES[i - 1].from, "stages grow")
	check(Core.STAGES[-1].name == "Левиафан", "last stage")


func test_bot_grows() -> void:
	# the greedy bot of core.test.js: a fish gains at least a third of its size in five minutes
	var w = Core.create_world(7, 30, 1.2)
	for i in 9000:
		Core.step(w, 1.0 / 30, bot_input(w))
		w.events.clear()
	check(w.player.r > 40, "a fish grows in five minutes (r=%.1f)" % w.player.r)
	Core.free_world(w)


func test_leviathan() -> void:
	for s in Core.SPECIES:
		if s.cls == "leviathan":
			check(not Core.traits(s.id).hunter, "%s does not hunt" % s.id)
