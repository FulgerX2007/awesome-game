class_name StoryData
extends RefCounted
## The chronicle: lines written once when their moment comes. Ids and texts are the web game's
## (so its "seen" list carries over), the ark stages write their own lines (StageDef.story).

const LOG_MAX := 12
const STORY := [
	["wake", "always", 0, "Ты просыпаешься среди ржавых гор. Ни души, только хлам до горизонта и закатное небо."],
	["scrap", "scrap", 10, "Руки помнят: из хлама можно выбирать детали. Пять горстей на одну."],
	["body", "parts", 5, "Под грудой лома лежит робот. Корпус цел. Если собрать десяток деталей, его можно починить."],
	["first", "built", 1, "Робот открывает глаз, смотрит на тебя и тянется к лопате. Дай ему работу в «Бригаде»."],
	["three", "built", 3, "Роботы перещёлкиваются между собой. Похоже, им нравится работать вместе."],
	["core", "cores", 1, "Среди деталей что-то светится. Ядро — сердце старых машин."],
	["ark", "ark", 0, "В дымке на краю свалки виден остов огромного корабля. Ковчег. Его можно достроить."],
	["twenty", "built", 20, "Свалка гудит. Ты сидишь на ящике и просто смотришь, как они работают."],
]


static func check(s: GameState) -> void:
	for st in STORY:
		if s.seen.has(st[0]):
			continue
		var ok := false
		match st[1]:
			"always": ok = true
			"scrap": ok = s.stats.scrap >= st[2]
			"parts": ok = s.stats.parts >= st[2]
			"built": ok = s.built >= st[2]
			"cores": ok = s.stats.cores >= st[2]
			"ark": ok = ReconstructionManager.unlocked(s)
		if ok:
			s.seen[st[0]] = true
			add_log(s, st[3])


static func add_log(s: GameState, text: String, args := {}) -> void:
	s.log.append({text = text, args = args})
	if s.log.size() > LOG_MAX:
		s.log = s.log.slice(-LOG_MAX)
	s.emit("log", {text = text, args = args})
