class_name CastleContent
extends RefCounted
## The game's data (data/*.json), loaded once: enemy variants, bosses, defences, the campaign and the upgrades.
## Also turns a level's wave groups ("footman*6@1/1.6") into a timed spawn list, and builds the endless
## waves with the original web game's budget generator (see waves()).

static var _cache := {}


static func _json(name: String) -> Dictionary:
	if not _cache.has(name):
		var d = JSON.parse_string(FileAccess.get_file_as_string("res://data/%s.json" % name))
		assert(d is Dictionary, "data/%s.json is broken" % name)
		d.erase("_doc")
		_cache[name] = d
	return _cache[name]


static func enemies() -> Dictionary: return _json("enemies")
static func bosses() -> Dictionary: return _json("bosses")
static func defenses() -> Dictionary: return _json("defenses")
static func meta() -> Dictionary: return _json("meta")
static func campaign() -> Dictionary: return _json("levels")
static func levels() -> Array: return campaign().levels
static func regions() -> Array: return campaign().regions


static func level(n: int) -> Dictionary:
	for l in levels():
		if int(l.n) == n:
			return l
	return {}


static func region_of(n: int) -> Dictionary:
	var l := level(n)
	for r in regions():
		if r.id == l.get("region", ""):
			return r
	return regions()[0]


static func is_boss(kind: String) -> bool:
	return bosses().has(kind)


static func body(kind: String) -> Dictionary:
	return bosses()[kind] if is_boss(kind) else enemies()[kind]


## "kind*count@start/gap" → {kind, count, at, gap}; a bare "kind@start" is one enemy.
static func parse_group(s: String) -> Dictionary:
	var g := {kind = s, count = 1, at = 0.0, gap = 1.0}
	var at_i := s.find("@")
	var head := s if at_i < 0 else s.substr(0, at_i)
	var tail := "" if at_i < 0 else s.substr(at_i + 1)
	var star := head.find("*")
	if star >= 0:
		g.kind = head.substr(0, star)
		g.count = int(head.substr(star + 1))
	else:
		g.kind = head
	if tail != "":
		var parts := tail.split("/")
		g.at = float(parts[0])
		if parts.size() > 1:
			g.gap = float(parts[1])
	return g


## A level wave → {spawns: [{kind, at}], hp_mul, speed_mul}, the spawns sorted by time.
static func level_wave(wave: Dictionary) -> Dictionary:
	var spawns := []
	for s in wave.get("groups", []):
		var g := parse_group(s)
		for k in g.count:
			spawns.append({kind = g.kind, at = snappedf(g.at + k * g.gap, 0.01)})
	if wave.has("boss"):
		var b := parse_group(wave.boss)
		spawns.append({kind = b.kind, at = b.at})
	spawns.sort_custom(func(a, b): return a.at < b.at)
	return {spawns = spawns, hp_mul = 1.0, speed_mul = 1.0}


## ── Endless ──
## The original generator of web/castle/core.js (waveDef): waves 1–3 teach, then a budget that grows by
## BUDGET_GROWTH per wave (ENDLESS_GROWTH past the 30th) buys the kinds unlocked so far; at most MAX_ENEMIES,
## the rest of the budget makes them tougher. The new kinds join at their own waves; every 10th wave brings a
## boss, the five in turn.
const MAX_ENEMIES := 40
const BUDGET_START := 9.0
const BUDGET_GROWTH := 1.12
const ENDLESS_GROWTH := 1.16
const SURVIVAL_WAVES := 30
const COST := {footman = 1.0, shield = 1.5, flyer = 1.4, ram = 5.0, scout = 1.0, knight = 4.0, archer = 1.8, berserker = 2.2, golem = 8.0, commander = 6.0}
const UNLOCK := {footman = 1, shield = 2, flyer = 3, ram = 5, scout = 4, knight = 7, archer = 9, berserker = 12, golem = 15, commander = 18}
const WEIGHT := {footman = 5.0, shield = 3.0, flyer = 2.5, ram = 1.2, scout = 2.5, knight = 1.5, archer = 2.0, berserker = 1.5, golem = 0.7, commander = 0.5}
const BOSS_ORDER := ["iron_warlord", "siege_titan", "fire_dragon", "shadow_beast", "dark_king"]


static func budget_of(n: int) -> float:
	return BUDGET_START * pow(BUDGET_GROWTH, min(n, SURVIVAL_WAVES) - 1) * pow(ENDLESS_GROWTH, max(0, n - SURVIVAL_WAVES))


static func endless_wave(n: int, seed: int) -> Dictionary:
	var r := RandomNumberGenerator.new()
	r.seed = hash([seed, n])
	var spawns := []
	var gap := maxf(0.4, 1.9 - n * 0.04)
	var at := [1.0]
	var add := func(kind):
		spawns.append({kind = kind, at = snappedf(at[0], 0.01)})
		at[0] += gap * (0.6 + r.randf() * 0.8)
	if n == 1:
		for k in 6: add.call("footman")
		return {spawns = spawns, hp_mul = 1.0, speed_mul = 1.0}
	if n == 2:
		for k in ["footman", "footman", "shield", "footman", "shield", "footman", "shield"]: add.call(k)
		return {spawns = spawns, hp_mul = 1.0, speed_mul = 1.0}
	if n == 3:
		for k in ["footman", "flyer", "footman", "flyer", "shield", "flyer", "footman", "flyer"]: add.call(k)
		return {spawns = spawns, hp_mul = 1.0, speed_mul = 1.0}
	var budget := budget_of(n)
	if n % 10 == 0:
		spawns.append({kind = BOSS_ORDER[(n / 10 - 1) % BOSS_ORDER.size()], at = 3.0})
		budget *= 0.6
	var kinds := COST.keys().filter(func(k): return n >= UNLOCK[k])
	var spent := 0.0
	while spawns.size() < MAX_ENEMIES:
		var left := budget - spent
		var can := kinds.filter(func(k): return COST[k] <= left + 1e-9)
		if can.is_empty():
			break
		var total := 0.0
		for k in can: total += WEIGHT[k]
		var x := r.randf() * total
		var kind: String = can[-1]
		for k in can:
			x -= WEIGHT[k]
			if x <= 0:
				kind = k
				break
		add.call(kind)
		spent += COST[kind]
	var extra := maxf(0.0, budget - spent) / maxf(1.0, spent) if spawns.size() >= MAX_ENEMIES else 0.0
	spawns.sort_custom(func(a, b): return a.at < b.at)
	return {spawns = spawns, hp_mul = snappedf(1.0 + extra, 0.001), speed_mul = snappedf(minf(1.5, 1.0 + extra * 0.25), 0.001)}
