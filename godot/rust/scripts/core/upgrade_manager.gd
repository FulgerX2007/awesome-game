class_name UpgradeManager
extends RefCounted
## The workshop: which upgrades are visible, what the next level costs, buying.


static func unlocked(s: GameState, u: UpgradeDef) -> bool:
	match u.unlock_kind:
		"always": return true
		"total_parts": return s.stats.parts >= u.unlock_value
		"built": return s.built >= u.unlock_value
		"built_or_repair": return s.built >= u.unlock_value or not s.repair.is_empty()
		"total_cores": return s.stats.cores >= u.unlock_value
		"stage": return s.stage >= u.unlock_value
		"upgrade": return s.lvl(u.unlock_target) >= u.unlock_value
	return false


## {def, level, maxed, unlocked, cost (empty when maxed), affordable}
static func state_of(s: GameState, id: String) -> Dictionary:
	var u := GameData.upgrade(id)
	var l := s.lvl(id)
	var maxed := l >= u.max_level
	var cost := {} if maxed else u.cost(l)
	return {def = u, level = l, maxed = maxed, unlocked = unlocked(s, u), cost = cost,
		affordable = not maxed and ResourceManager.can_afford(s, cost)}


static func buy(s: GameState, id: String) -> bool:
	if GameData.upgrade(id) == null:
		return false
	var st := state_of(s, id)
	if not st.unlocked or st.maxed or not st.affordable:
		return false
	ResourceManager.pay(s, st.cost)
	s.up[id] = st.level + 1
	s.emit("upgrade_bought", {id = id, level = st.level + 1})
	return true


## A human-readable condition for a locked upgrade, as [template, args] for tr().format().
static func requirement(u: UpgradeDef) -> Array:
	match u.unlock_kind:
		"total_parts": return ["Откроется, когда соберёшь {n} деталей", {n = int(u.unlock_value)}]
		"built", "built_or_repair": return ["Откроется после {n}-го робота", {n = int(u.unlock_value)}]
		"total_cores": return ["Откроется, когда найдёшь ядер: {n}", {n = int(u.unlock_value)}]
		"stage": return ["Откроется на этапе ковчега {n}", {n = int(u.unlock_value)}]
		"upgrade": return ["Нужно: {name}", {name = GameData.upgrade(u.unlock_target).name}]
	return ["", {}]
