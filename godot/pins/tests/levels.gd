extends SceneTree
## Every level with real physics. The grid solver of web/pins gives each level its winning pull orders
## and its shortest losing orders (data/levels.json, made by tools/pins-godot/data.cjs). Here:
##   - the level's plan (data/plans.json) must win for a patient player, who pulls each pin once
##     everything rests; the plan is also the hint the game shows;
##   - at least one of the losing orders must not win;
##   - an eager player (the next pin half a second after the last) is only reported: in physics,
##     gas and lava take their time, and some levels want patience.
## With "-- plan" it looks for each level's plan among the solver's winning orders and writes data/plans.json.
##   godot --headless --fixed-fps 60 --path godot/pins -s res://tests/levels.gd [-- plan] [-- 1 5 7]

const Replay := preload("res://tests/replay.gd")
const EAGER := 0.5
const PLANS := "res://data/plans.json"


func _initialize() -> void:
	var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/levels.json"))
	var args := Array(OS.get_cmdline_user_args())
	var planning := args.has("plan")
	var only := args.filter(func(a): return a.is_valid_int()).map(func(a): return int(a))
	var plans: Dictionary = {} if planning or not FileAccess.file_exists(PLANS) else JSON.parse_string(FileAccess.get_file_as_string(PLANS))
	var bad := []
	var hurried := []
	for def in data.LEVELS:
		var key := str(int(def.n))
		if only.size() and not int(def.n) in only:
			continue
		var plan = null
		var patient := {}
		var candidates: Array = def.wins if planning else ([plans[key]] if plans.has(key) else [])
		for order in candidates:
			patient = await Replay.play(self, def, order)
			if patient.status == "won":
				plan = order
				break
		var eager = await Replay.play(self, def, plan, EAGER) if plan != null else {}
		var loses := ""
		for order in def.losses:
			var r := await Replay.play(self, def, order)
			if r.status != "won":
				loses = "%s %s" % [_s(order), r.reason]
				break
		var ok: bool = plan != null and (loses != "" or def.losses.is_empty())
		if not ok:
			bad.append(int(def.n))
		if plan != null:
			plans[key] = plan.map(func(x): return int(x))
			if eager.status != "won":
				hurried.append(int(def.n))
		print("%s %2d  plan %-5s %s  eager %s  loses %s" % ["ok  " if ok else "FAIL", def.n, _s(plan) if plan != null else "-",
			_r(patient) if patient else "-", _r(eager) if eager else "-", loses if loses != "" else "NONE"])
	if planning:
		var keys := plans.keys()
		keys.sort_custom(func(a, b): return int(a) < int(b))
		var lines := keys.map(func(k): return '"%s":%s' % [k, JSON.stringify(plans[k])])
		var f := FileAccess.open(PLANS, FileAccess.WRITE)
		f.store_string("{\n%s\n}\n" % ",\n".join(lines))
	print("%d failing: %s; eager players lose %s" % [bad.size(), bad, hurried])
	quit(1 if bad.size() else 0)


static func _s(order) -> String:
	return "".join(order.map(func(x): return str(int(x)))) if order != null else "-"


static func _r(r: Dictionary) -> String:
	return "%s%s gold %d/%d%s%s" % [r.status, (" " + r.reason) if r.reason != "" else "", r.gold, r.target,
		(" hazard " + r.hazard) if r.hazard != "" else "", (" enemies %d" % r.enemies) if r.enemies else ""]
