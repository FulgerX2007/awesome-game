class_name WorkerCrew
extends Node3D
## Keeps the robots in the scene in step with the brigade in the rules: one robot on screen per robot in
## a role, up to a cap per role (beyond it a "×N" counter shows the real number). When a role grows,
## a robot of a role that shrank changes jobs and walks over; new robots step off the repair bay.

const CAP := {digger = 12, sorter = 6, mechanic = 6, idle = 6}
const ROBOT := preload("res://scenes/world/worker_robot.tscn")

var world: Node
var robots: Array[WorkerRobot] = []
var _counters := {}


func setup(world_: Node) -> void:
	world = world_
	for role in CAP:
		var l := Kit.label(self, "", Vector3.ZERO, Kit.ROLE_COLORS[role], 44)
		_counters[role] = l


func clear() -> void:
	for r in robots:
		r.queue_free()
	robots.clear()


## spawn: where new robots appear (the repair bay).
func sync(counts: Dictionary, spawn: Vector3) -> void:
	var want := {}
	var have := {}
	for role in CAP:
		want[role] = mini(int(counts.get(role, 0)), CAP[role])
		have[role] = robots.filter(func(r): return r.role == role)
	var spare: Array[WorkerRobot] = []
	for role in CAP:
		while have[role].size() > want[role]:
			spare.append(have[role].pop_back())
	for role in CAP:
		while have[role].size() < want[role]:
			var r: WorkerRobot
			if not spare.is_empty():
				r = spare.pop_back()
			else:
				r = ROBOT.instantiate()
				r.world = world
				r.slot = randf()
				r.position = spawn + Vector3(randf_range(-0.4, 0.4), 0, randf_range(0.6, 1.2))
				add_child(r)
				robots.append(r)
				r.dropped_chunk.connect(world.on_chunk_dropped)
			r.set_role(role)
			if role == "idle":
				r.target = world.wander_spot()
			have[role].append(r)
	for r in spare:
		robots.erase(r)
		r.queue_free()
	for role in CAP:
		var n := int(counts.get(role, 0))
		var l: Label3D = _counters[role]
		l.visible = n > CAP[role]
		l.text = "×%d" % n
		l.position = world.counter_spot(role)


func set_eye_power(p: float) -> void:
	for r in robots:
		r.set_eye_power(p)


func count(role: String) -> int:
	return robots.filter(func(r): return r.role == role).size()
