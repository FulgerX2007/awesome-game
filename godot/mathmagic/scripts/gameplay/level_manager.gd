class_name LevelManager
extends Node
## Loads one level at a time into its container, wires it to the UI and reports how it ends.
## Level scenes are loaded on demand and cached, so restarting does not read the file again.

signal level_started(level: Level)
signal level_completed(level: Level)

var container: Node3D
var current: Level
var index := -1
var _cache := {}


func load_level(i: int) -> Level:
	unload()
	index = clampi(i, 0, LevelCatalog.count() - 1)
	var path: String = LevelCatalog.get_level(index).scene
	if not _cache.has(path):
		_cache[path] = load(path)
	current = (_cache[path] as PackedScene).instantiate()
	container.add_child(current)
	current.completed.connect(func(): level_completed.emit(current))
	level_started.emit(current)
	return current


func restart() -> Level:
	return load_level(index)


func unload() -> void:
	if MathChallengeManager.is_active():
		MathChallengeManager.close(false)
	if current and is_instance_valid(current):
		container.remove_child(current)
		current.queue_free()
	current = null
