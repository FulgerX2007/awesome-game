class_name AchievementManager
extends RefCounted
## Milestones and optional challenges (res://data/achievements). Once unlocked they stay, across dawns.


static func met(s: GameState, a: AchievementDef) -> bool:
	match a.kind:
		"built": return s.built >= a.value
		"total_parts": return s.stats.parts >= a.value
		"total_cores": return s.stats.cores >= a.value
		"clicks": return s.stats.clicks >= a.value
		"salvage": return s.stats.salvage >= a.value
		"wrecks": return s.stats.wrecks >= a.value
		"shortages": return s.stats.shortages >= a.value
		"stage": return s.stage >= a.value
		"runs": return s.runs >= a.value
		"challenge_no_upgrade": return s.built >= a.value and s.lvl(a.target) == 0
	return false


static func check(s: GameState) -> void:
	for a in GameData.achievements():
		if not s.achievements.has(a.id) and met(s, a):
			s.achievements[a.id] = true
			s.emit("achievement", {id = a.id, name = a.name})
