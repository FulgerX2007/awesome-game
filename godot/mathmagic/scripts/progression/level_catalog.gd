class_name LevelCatalog
extends RefCounted
## The worlds and their levels in play order. Titles and goals are translation keys.
## A new level is a new entry here and a new scene; nothing else needs to know the list.
## Progress stays one line through all worlds: finishing a level opens the next, across worlds too.

const WORLDS := [
	{id = "island", title = "Island of Addition", finale = "You saved the island!"},
	{id = "mountains", title = "Multiplication Mountains", finale = "You climbed the mountains!"},
]

const LEVELS := [
	{id = "beach", scene = "res://scenes/levels/level_1.tscn", title = "Counting Beach", goal = "Count the stones and open the gates."},
	{id = "bridge", scene = "res://scenes/levels/level_2.tscn", title = "Broken Bridges", goal = "Find the missing stones and fix the bridges."},
	{id = "garden", scene = "res://scenes/levels/level_3.tscn", title = "Gate Garden", goal = "Add and take away to open the gates."},
	{id = "windmill", scene = "res://scenes/levels/level_4.tscn", title = "Windmill Hill", goal = "Power the lift, then fix the bridge."},
	{id = "guardian", scene = "res://scenes/levels/level_5.tscn", title = "Stone Guardian", goal = "Calm the Stone Guardian."},
	{id = "groups", world = 1, scene = "res://scenes/levels/level_6.tscn", title = "Equal Groups Trail", goal = "Count the same-size piles to open the gates."},
	{id = "steps", world = 1, scene = "res://scenes/levels/level_7.tscn", title = "Crystal Steps", goal = "Light the crystals and build the steps."},
	{id = "summit", world = 1, scene = "res://scenes/levels/level_8.tscn", title = "Summit Path", goal = "Use all your magic to reach the summit."},
]


static func count() -> int:
	return LEVELS.size()


static func get_level(index: int) -> Dictionary:
	return LEVELS[clampi(index, 0, LEVELS.size() - 1)]


static func index_of(id: String) -> int:
	for i in LEVELS.size():
		if LEVELS[i].id == id:
			return i
	return -1


## Which world a level belongs to (levels without a world field are in the first one).
static func world_of(index: int) -> int:
	return int(get_level(index).get("world", 0))


static func world(w: int) -> Dictionary:
	return WORLDS[clampi(w, 0, WORLDS.size() - 1)]


## The level indexes of a world, in order.
static func levels_in(w: int) -> Array[int]:
	var out: Array[int] = []
	for i in LEVELS.size():
		if world_of(i) == w:
			out.append(i)
	return out


static func is_last_in_world(index: int) -> bool:
	return index >= LEVELS.size() - 1 or world_of(index + 1) != world_of(index)
