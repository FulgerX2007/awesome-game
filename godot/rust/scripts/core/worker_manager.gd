class_name WorkerManager
extends RefCounted
## The brigade: who works where. Robots are built by repairs (ProductionManager) and arrive here.


static func finish_robot(s: GameState) -> void:
	s.built += 1
	var role := "idle"
	if ProductionManager.derived(s).dispatch:
		role = needed_role(s)
	s.robots[role] += 1
	s.emit("robot_built", {role = role})


## Keep ~20% mechanics, then balance diggers' output against sorters' intake (as in the web game).
static func needed_role(s: GameState) -> String:
	var d := ProductionManager.derived(s)
	var r: Dictionary = s.robots
	var team: int = r.digger + r.sorter + r.mechanic
	if r.mechanic < team * 0.2:
		return "mechanic"
	return "sorter" if r.digger * d.digger > r.sorter * d.sorter * d.ratio else "digger"


## Moves up to |delta| robots between the free pool and a role. Returns how many moved.
static func assign(s: GameState, role: String, delta: int) -> int:
	if not role in GameData.ROLES:
		return 0
	var moved := 0
	if delta > 0:
		moved = mini(delta, s.robots.idle)
		s.robots.idle -= moved
		s.robots[role] += moved
	elif delta < 0:
		moved = mini(-delta, s.robots[role])
		s.robots[role] -= moved
		s.robots.idle += moved
	return moved


static func assign_all(s: GameState, role: String) -> int:
	return assign(s, role, s.robots.idle)


static func unassign_all(s: GameState, role: String) -> int:
	return assign(s, role, -int(s.robots.get(role, 0)))


static func total(s: GameState) -> int:
	return s.robots.idle + s.robots.digger + s.robots.sorter + s.robots.mechanic
