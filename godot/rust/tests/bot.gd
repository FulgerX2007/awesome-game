class_name RustBot
extends RefCounted
## A greedy player for balance tests: 4 clicks a second (repair, else sort, else dig), puts every free
## robot where the dispatcher would, builds the ark as soon as it can, otherwise buys the cheapest upgrade
## (a core counted as 100 parts), and reacts to events when `events` is on. The same strategy, without
## events, launches the web game's ark in 85 / 31 / 19 minutes (web/rust/core.js).

var events := true
var _clicks := 0.0


func step(s: GameState, dt: float) -> void:
	_clicks += dt * 4.0
	while _clicks >= 1.0:
		_clicks -= 1.0
		var d := ProductionManager.derived(s)
		if events and s.shortage_active():
			EventManager.fix_shortage(s)
		elif not s.repair.is_empty() or (s.parts >= d.robot_cost and s.robots.mechanic == 0) or s.free_jobs > 0:
			ProductionManager.repair_click(s)
		elif s.scrap >= d.ratio:
			ProductionManager.disassemble(s)
		else:
			ProductionManager.dig(s)
	while s.robots.idle > 0:
		WorkerManager.assign(s, WorkerManager.needed_role(s), 1)
	if events:
		EventManager.collect_salvage(s)
		EventManager.recruit_wreck(s)
		s.drone_task = "repair"
	if not (ReconstructionManager.unlocked(s) and ReconstructionManager.build(s)):
		var best := ""
		var best_cost := INF
		for u in GameData.upgrades():
			var st := UpgradeManager.state_of(s, u.id)
			if not st.unlocked or st.maxed:
				continue
			var c: float = st.cost.get("parts", 0.0) + st.cost.get("cores", 0.0) * 100.0
			if c < best_cost:
				best_cost = c
				best = u.id
		if best != "":
			UpgradeManager.buy(s, best)
	ProductionManager.tick(s, dt, events)
	s.drain()


## Plays until the launch (or `limit` seconds); returns the seconds it took.
func play(s: GameState, limit := 6 * 3600.0) -> float:
	var t := 0.0
	while not s.launched and t < limit:
		step(s, 0.1)
		t += 0.1
	return t
