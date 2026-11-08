class_name ProductionManager
extends RefCounted
## The numbers every rule uses (derived), the manual actions, and automation over time (tick).
## Formulas match web/rust/core.js; the ark stages, power and the drone multiply on top of them and
## are 1 (or 0) at the start, so an early game plays exactly like the web version.

const OFFLINE_CAP := 8 * 3600.0


static func derived(s: GameState) -> Dictionary:
	var bp := 1.0 + 0.1 * s.blueprints
	var g := bp
	var click_add := 0.0
	var batch_add := 0.0
	var ratio_sub := 0.0
	var wrench_add := 0.0
	var speed := {digger = 0.0, sorter = 0.0, mechanic = 0.0}
	var stage_speed := {digger = 1.0, sorter = 1.0, mechanic = 1.0}
	var core_add := 0.0
	var factory := 0.0
	var power_add := 0.0
	var drone := 0.0
	var dispatch := false
	for u in GameData.upgrades():
		var l := s.lvl(u.id)
		if l == 0:
			continue
		match u.effect:
			"click_add": click_add += u.amount * l
			"batch_add": batch_add += u.amount * l
			"ratio_sub": ratio_sub += u.amount * l
			"wrench_add": wrench_add += u.amount * l
			"role_speed": speed[u.effect_target] += u.amount * l
			"dispatch": dispatch = true
			"core_chance": core_add += u.amount * l
			"factory": factory += u.amount * l
			"global_mul": g *= pow(u.amount, l)
			"power": power_add += u.amount * l
			"drone": drone += u.amount * l
	var zone_mul := 1.0
	var stages := GameData.stages()
	for i in mini(s.stage, stages.size()):
		var st := stages[i]
		match st.effect:
			"role_speed": stage_speed[st.effect_target] *= 1.0 + st.amount
			"power": power_add += st.amount
			"zone": zone_mul *= 1.0 + st.amount
	var power := (1.0 + power_add) * (0.5 if s.shortage_active() else 1.0)
	return {
		click = (1.0 + click_add) * bp,
		batch = int(1 + batch_add),
		ratio = maxf(1.0, 5.0 - ratio_sub),
		wrench = 1.0 + wrench_add,
		digger = 1.0 * (1.0 + speed.digger) * g * stage_speed.digger * zone_mul * power,
		sorter = 0.5 * (1.0 + speed.sorter) * g * stage_speed.sorter * power,
		mechanic = 0.5 * (1.0 + speed.mechanic) * g * stage_speed.mechanic * power,
		factory = factory * g * power,
		core_chance = 0.005 + core_add,
		robot_cost = ceilf(10.0 * pow(1.075, s.built)),
		repair_need = 20.0 + 3.0 * s.built,
		power = power,
		drone = drone,
		dispatch = dispatch,
	}


# ── Manual actions (also what the drone does) ──

static func dig(s: GameState, by_hand := true) -> float:
	var n: float = derived(s).click
	ResourceManager.add_scrap(s, n)
	if by_hand:
		s.stats.clicks += 1
	return n


static func disassemble(s: GameState, by_hand := true) -> int:
	var d := derived(s)
	var n := mini(d.batch, int(floorf(s.scrap / d.ratio)))
	if n <= 0:
		return 0
	s.scrap -= n * d.ratio
	ResourceManager.add_parts(s, n, d)
	if by_hand:
		s.stats.clicks += 1
	return n


static func has_auto_repair(s: GameState) -> bool:
	return s.robots.mechanic > 0 or s.lvl("factory") > 0


## Puts the next robot on the bay: a recruited wreck if one waits (free, half the work), else a
## robot from the scrap pile for robot_cost parts.
static func start_repair(s: GameState) -> bool:
	if not s.repair.is_empty():
		return false
	var d := derived(s)
	if s.free_jobs > 0:
		s.free_jobs -= 1
		s.repair = {progress = 0.0, need = ceilf(d.repair_need / 2.0), free = true}
		return true
	if s.parts < d.robot_cost:
		return false
	s.parts -= d.robot_cost
	s.repair = {progress = 0.0, need = d.repair_need, free = false}
	return true


static func repair_work(s: GameState, units: float) -> void:
	if s.repair.is_empty():
		return
	s.repair.progress += units
	while not s.repair.is_empty() and s.repair.progress >= s.repair.need:
		var extra: float = s.repair.progress - s.repair.need
		s.repair = {}
		WorkerManager.finish_robot(s)
		if s.auto_repair and has_auto_repair(s) and start_repair(s):
			s.repair.progress = minf(extra, s.repair.need)


static func repair_click(s: GameState, by_hand := true) -> float:
	if s.repair.is_empty() and not start_repair(s):
		return 0.0
	var n: float = derived(s).wrench
	repair_work(s, n)
	if by_hand:
		s.stats.clicks += 1
	return n


# ── Automation ──

static func tick(s: GameState, dt: float, events := true) -> void:
	var d := derived(s)
	var r: Dictionary = s.robots
	ResourceManager.add_scrap(s, r.digger * d.digger * dt)

	var batches := minf(r.sorter * d.sorter * dt, s.scrap / d.ratio)
	if batches > 0.0:
		s.scrap -= batches * d.ratio
		ResourceManager.add_parts(s, batches, d)

	if s.repair.is_empty() and s.auto_repair and has_auto_repair(s):
		start_repair(s)
	if not s.repair.is_empty():
		repair_work(s, (r.mechanic * d.mechanic + d.factory) * dt)

	if d.drone > 0.0:
		s.drone_acc += d.drone * dt
		while s.drone_acc >= 1.0:
			s.drone_acc -= 1.0
			drone_act(s)
	s.time += dt
	if events:
		EventManager.tick(s, dt)
		AchievementManager.check(s)
		StoryData.check(s)


static func drone_act(s: GameState) -> void:
	var done := 0.0
	match s.drone_task:
		"dig": done = dig(s, false)
		"sort": done = disassemble(s, false)
		"repair": done = repair_click(s, false)
	if done > 0.0:
		s.emit("drone", {task = s.drone_task, amount = done})


## Net per-second rates at this moment, for the HUD (the web game's rates()).
static func rates(s: GameState) -> Dictionary:
	var d := derived(s)
	var r: Dictionary = s.robots
	var dig_rate: float = r.digger * d.digger
	var sort_cap: float = r.sorter * d.sorter
	var batches := sort_cap if s.scrap > d.ratio else minf(sort_cap, dig_rate / d.ratio)
	var drone: float = d.drone
	var extra_scrap: float = drone * d.click if s.drone_task == "dig" else 0.0
	return {
		scrap = dig_rate + extra_scrap - batches * d.ratio,
		scrap_gross = dig_rate,
		parts = batches,
		cores = batches * d.core_chance,
		repair = r.mechanic * d.mechanic + d.factory if (not s.repair.is_empty() or has_auto_repair(s)) else 0.0,
		sorter_starved = r.sorter > 0 and s.scrap < d.ratio and dig_rate / d.ratio < sort_cap * 0.999,
	}


## Catches up on time away (closed game, hidden tab), at most eight hours, without world events.
static func offline(s: GameState, seconds: float) -> Dictionary:
	var before := {scrap = s.stats.scrap, parts = s.stats.parts, cores = s.stats.cores, built = s.built}
	var left := minf(seconds, OFFLINE_CAP)
	while left > 0.0:
		var dt := minf(1.0, left)
		tick(s, dt, false)
		left -= dt
	s.drain()
	AchievementManager.check(s)
	StoryData.check(s)
	return {
		scrap = s.stats.scrap - before.scrap, parts = s.stats.parts - before.parts,
		cores = s.stats.cores - before.cores, robots = s.built - before.built,
	}
