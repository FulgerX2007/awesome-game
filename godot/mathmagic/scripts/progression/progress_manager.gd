extends Node
## Autoload ProgressManager: which levels are open and finished, which gems were found, and the settings.
## Pure state with signals; SaveManager writes it to disk when it changes.

signal progress_changed
signal settings_changed

const GEMS_PER_LEVEL := 3
const DEFAULT_SETTINGS := {sfx = 0.8, music = 0.5, lang = "", large_text = false}

var unlocked := 1                 # how many levels can be played, counting from the first
var completed: Array[String] = [] # level ids
var gems := {}                    # level id -> Array[String] of gem names
var settings := DEFAULT_SETTINGS.duplicate()


func reset() -> void:
	unlocked = 1
	completed = []
	gems = {}
	progress_changed.emit()


func is_unlocked(index: int) -> bool:
	return index >= 0 and index < unlocked


func is_completed(index: int) -> bool:
	return index >= 0 and index < LevelCatalog.count() and completed.has(LevelCatalog.get_level(index).id)


func all_completed() -> bool:
	return completed.size() >= LevelCatalog.count()


## The level the Play button continues: the first one not finished yet, else the last.
func next_level() -> int:
	for i in LevelCatalog.count():
		if not is_completed(i) and is_unlocked(i):
			return i
	return LevelCatalog.count() - 1


func complete_level(index: int) -> void:
	var id: String = LevelCatalog.get_level(index).id
	if not completed.has(id):
		completed.append(id)
	unlocked = clampi(maxi(unlocked, index + 2), 1, LevelCatalog.count())
	progress_changed.emit()


func has_gem(level_id: String, gem: String) -> bool:
	return gems.get(level_id, []).has(gem)


## Gems are saved the moment they are picked up, so leaving the level never loses one.
func collect_gem(level_id: String, gem: String) -> void:
	if has_gem(level_id, gem):
		return
	var list: Array = gems.get(level_id, [])
	list.append(gem)
	gems[level_id] = list
	progress_changed.emit()


func gem_count(level_id: String) -> int:
	return gems.get(level_id, []).size()


func total_gems() -> int:
	var n := 0
	for k in gems:
		n += gems[k].size()
	return n


func set_setting(key: String, value: Variant) -> void:
	if settings.get(key) == value:
		return
	settings[key] = value
	settings_changed.emit()
	progress_changed.emit()


# --- save data ------------------------------------------------------------------------------------------------

func to_dict() -> Dictionary:
	return {unlocked = unlocked, completed = completed.duplicate(), gems = gems.duplicate(true), settings = settings.duplicate()}


## Takes whatever was on disk and keeps only what makes sense: unknown levels, wrong types and
## out-of-range numbers fall back to defaults instead of breaking the game.
func from_dict(d: Variant) -> void:
	unlocked = 1
	completed = []
	gems = {}
	settings = DEFAULT_SETTINGS.duplicate()
	if not d is Dictionary:
		return
	var ids := LevelCatalog.LEVELS.map(func(l): return l.id)
	if d.get("completed") is Array:
		for id in d.completed:
			if _is_str(id) and ids.has(str(id)) and not completed.has(str(id)):
				completed.append(str(id))
	var u = d.get("unlocked")
	unlocked = clampi(int(u) if (u is int or u is float) else 1, 1, LevelCatalog.count())
	for id in completed:  # a finished level always opens the next one
		unlocked = clampi(maxi(unlocked, ids.find(id) + 2), 1, LevelCatalog.count())
	if d.get("gems") is Dictionary:
		for id in d.gems:
			if _is_str(id) and ids.has(str(id)) and d.gems[id] is Array:
				var list: Array = []
				for g in d.gems[id]:
					if _is_str(g) and not list.has(str(g)) and list.size() < GEMS_PER_LEVEL:
						list.append(str(g))
				gems[str(id)] = list
	if d.get("settings") is Dictionary:
		var s: Dictionary = d.settings
		for k in ["sfx", "music"]:
			if s.get(k) is float or s.get(k) is int:
				settings[k] = clampf(float(s[k]), 0.0, 1.0)
		if _is_str(s.get("lang")) and str(s.lang) in ["", "en", "ru", "ro"]:
			settings.lang = str(s.lang)
		if s.get("large_text") is bool:
			settings.large_text = s.large_text


static func _is_str(v: Variant) -> bool:
	return v is String or v is StringName
