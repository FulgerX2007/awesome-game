class_name GameState
extends RefCounted
## Everything that is saved about one game, and nothing else. The rules that change it live in the
## managers (ProductionManager, WorkerManager, UpgradeManager, ReconstructionManager, EventManager,
## AchievementManager); the Game autoload is the only caller in the running game.
## Field names follow web/rust/core.js where a field exists there.

const VERSION := 2

var scrap := 0.0
var parts := 0.0
var cores := 0.0
var robots := {idle = 0, digger = 0, sorter = 0, mechanic = 0}
var built := 0
## The robot on the repair bay: {} when the bay is empty, else {progress, need, free}.
var repair := {}
## Recruited wrecks waiting for the bay: repaired without paying parts, at half the work.
var free_jobs := 0
var auto_repair := true
var up := {}
## Ark stages built (0..stages.size()).
var stage := 0
var launched := false
var blueprints := 0
var runs := 0
var stats := {scrap = 0.0, parts = 0.0, cores = 0.0, clicks = 0, salvage = 0, wrecks = 0, shortages = 0}
## Seconds of play in this dawn (the day counter is derived from it).
var time := 0.0
var seen := {}
## Kept across dawns.
var achievements := {}
var zones: Array = ["yard"]
var drone_task := "dig"
var drone_acc := 0.0
## World events: next times (in `time`) and what is active now.
var ev := {salvage_at = 0.0, salvage_left = 0.0, salvage = {}, wreck_at = 0.0, wreck = false,
	shortage_at = 0.0, shortage_left = 0.0, shortage_fixes = 0}
## The chronicle shown in the log, newest last: [{text, args}].
var log: Array = []
var rng := RandomNumberGenerator.new()

## Not saved: what happened during the last calls, for the Game facade to turn into signals.
var out: Array = []


static func create(seed_value := -1, blueprints_ := 0, runs_ := 0) -> GameState:
	var s := GameState.new()
	s.blueprints = blueprints_
	s.runs = runs_
	s.rng.seed = seed_value if seed_value >= 0 else randi()
	return s


func lvl(id: String) -> int:
	return int(up.get(id, 0))


func emit(type: String, data := {}) -> void:
	data.type = type
	out.append(data)


func drain() -> Array:
	var o := out
	out = []
	return o


## Seconds of play are counted in days of four minutes: "День 1", "День 2"...
func day() -> int:
	return 1 + int(time / 240.0)


func shortage_active() -> bool:
	return float(ev.shortage_left) > 0.0


func to_dict() -> Dictionary:
	return {
		scrap = scrap, parts = parts, cores = cores, robots = robots.duplicate(), built = built,
		repair = repair.duplicate(), free_jobs = free_jobs, auto_repair = auto_repair, up = up.duplicate(),
		stage = stage, launched = launched, blueprints = blueprints, runs = runs, stats = stats.duplicate(),
		time = time, seen = seen.duplicate(), achievements = achievements.duplicate(), zones = zones.duplicate(),
		drone_task = drone_task, drone_acc = drone_acc, ev = ev.duplicate(true), log = log.duplicate(true),
		rng_seed = str(rng.seed), rng_state = str(rng.state),
	}


## Builds a state from saved data, keeping defaults for anything missing or of the wrong type.
static func from_dict(d: Dictionary) -> GameState:
	var s := GameState.new()
	s.scrap = _num(d, "scrap", 0.0)
	s.parts = _num(d, "parts", 0.0)
	s.cores = _num(d, "cores", 0.0)
	var r = d.get("robots")
	if r is Dictionary:
		for k in s.robots:
			s.robots[k] = maxi(0, int(_num(r, k, 0)))
	s.built = maxi(0, int(_num(d, "built", 0)))
	var rp = d.get("repair")
	if rp is Dictionary and rp.has("need"):
		s.repair = {progress = maxf(0.0, _num(rp, "progress", 0.0)), need = maxf(1.0, _num(rp, "need", 20.0)),
			free = bool(rp.get("free", false))}
	s.free_jobs = maxi(0, int(_num(d, "free_jobs", 0)))
	s.auto_repair = bool(d.get("auto_repair", true))
	var u = d.get("up")
	if u is Dictionary:
		for id in u:
			var def := GameData.upgrade(str(id))
			if def != null:
				s.up[str(id)] = clampi(int(u[id]), 0, def.max_level)
	s.stage = clampi(int(_num(d, "stage", 0)), 0, GameData.stages().size())
	s.launched = bool(d.get("launched", false)) or s.stage >= GameData.stages().size()
	s.blueprints = maxi(0, int(_num(d, "blueprints", 0)))
	s.runs = maxi(0, int(_num(d, "runs", 0)))
	var st = d.get("stats")
	if st is Dictionary:
		for k in s.stats:
			s.stats[k] = _num(st, k, 0.0) if s.stats[k] is float else int(_num(st, k, 0))
	s.time = maxf(0.0, _num(d, "time", 0.0))
	for key in ["seen", "achievements"]:
		var v = d.get(key)
		if v is Dictionary:
			var m := {}
			for k in v:
				m[str(k)] = true
			s.set(key, m)
	var z = d.get("zones")
	if z is Array:
		s.zones = ["yard"]
		for id in z:
			if str(id) in GameData.ZONES and not str(id) in s.zones:
				s.zones.append(str(id))
	var task := str(d.get("drone_task", "dig"))
	s.drone_task = task if task in ["dig", "sort", "repair"] else "dig"
	s.drone_acc = clampf(_num(d, "drone_acc", 0.0), 0.0, 1.0)
	var e = d.get("ev")
	if e is Dictionary:
		for k in s.ev:
			if k == "salvage":
				s.ev.salvage = e.salvage.duplicate() if e.get("salvage") is Dictionary else {}
			elif k == "wreck":
				s.ev.wreck = bool(e.get("wreck", false))
			elif k == "shortage_fixes":
				s.ev[k] = int(_num(e, k, 0))
			else:
				s.ev[k] = _num(e, k, 0.0)
	var l = d.get("log")
	if l is Array:
		for item in l.slice(-12):
			if item is Dictionary and item.get("text") is String:
				s.log.append({text = item.text, args = item.get("args", {}) if item.get("args") is Dictionary else {}})
	s.rng.seed = int(str(d.get("rng_seed", randi())))
	if d.has("rng_state"):
		s.rng.state = int(str(d.rng_state))
	return s


static func _num(d: Dictionary, k: String, def: float) -> float:
	var v = d.get(k)
	if v is float or v is int:
		return v if is_finite(float(v)) else def
	return def
