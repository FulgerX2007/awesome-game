class_name GameData
extends RefCounted
## Read-only access to the content in res://data/game_data.tres (upgrades, stages, achievements, resources).

const PATH := "res://data/game_data.tres"
const ROLES: Array[String] = ["digger", "sorter", "mechanic"]
## Zones of the scrapyard. "yard" is always open; the others come from ark stages (StageDef effect "zone").
const ZONES: Array[String] = ["yard", "north", "graveyard"]

static var _def: GameDataDef
static var _upgrades := {}


static func def() -> GameDataDef:
	if _def == null:
		_def = load(PATH)
		for u in _def.upgrades:
			_upgrades[u.id] = u
	return _def


static func upgrades() -> Array[UpgradeDef]:
	return def().upgrades


static func upgrade(id: String) -> UpgradeDef:
	def()
	return _upgrades.get(id)


static func stages() -> Array[StageDef]:
	return def().stages


static func achievements() -> Array[AchievementDef]:
	return def().achievements


static func resource(id: String) -> ResourceDef:
	for r in def().resources:
		if r.id == id:
			return r
	return null
