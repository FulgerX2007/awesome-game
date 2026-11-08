class_name ResourceManager
extends RefCounted
## Adding and spending resources. Every change to scrap, parts and cores goes through here, so the
## lifetime stats (which unlock upgrades and achievements) stay consistent.


static func add_scrap(s: GameState, n: float) -> void:
	s.scrap += n
	s.stats.scrap += n


## Parts come with a chance of cores in them (the web game's addParts).
static func add_parts(s: GameState, n: float, d: Dictionary) -> void:
	s.parts += n
	s.stats.parts += n
	var before := floorf(s.stats.cores)
	var c: float = n * d.core_chance
	s.cores += c
	s.stats.cores += c
	if floorf(s.stats.cores) > before:
		s.emit("core_found")


static func add_cores(s: GameState, n: float) -> void:
	s.cores += n
	s.stats.cores += n


static func can_afford(s: GameState, cost: Dictionary) -> bool:
	return s.parts >= float(cost.get("parts", 0.0)) and s.cores >= float(cost.get("cores", 0.0))


static func pay(s: GameState, cost: Dictionary) -> void:
	s.parts -= float(cost.get("parts", 0.0))
	s.cores -= float(cost.get("cores", 0.0))
