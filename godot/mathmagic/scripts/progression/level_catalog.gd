class_name LevelCatalog
extends RefCounted
## The levels of the Island of Addition in order. Titles and goals are translation keys.
## A new world is a new catalog entry and a new scene; nothing else needs to know the list.

const LEVELS := [
	{id = "beach", scene = "res://scenes/levels/level_1.tscn", title = "Counting Beach", goal = "Count the stones and open the gates."},
	{id = "bridge", scene = "res://scenes/levels/level_2.tscn", title = "Broken Bridges", goal = "Find the missing stones and fix the bridges."},
	{id = "garden", scene = "res://scenes/levels/level_3.tscn", title = "Gate Garden", goal = "Add and take away to open the gates."},
	{id = "windmill", scene = "res://scenes/levels/level_4.tscn", title = "Windmill Hill", goal = "Power the lift, then fix the bridge."},
	{id = "guardian", scene = "res://scenes/levels/level_5.tscn", title = "Stone Guardian", goal = "Calm the Stone Guardian."},
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
