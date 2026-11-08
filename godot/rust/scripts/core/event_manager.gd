class_name EventManager
extends RefCounted
## Things that happen in the scrapyard on their own, driven by GameState.time and its RNG, so they
## pause, save and replay with the game:
##   salvage   — a glowing crate after the first robot; pick it up within 25 s for a bonus (sometimes a core)
##   wreck     — an abandoned robot after the third; recruit it and it is repaired for free at half the work
##   shortage  — after the power system stage the reactor sometimes falters: automation at half speed for
##               30 s, unless you hit the reactor five times

const SALVAGE_LIFE := 25.0
const SHORTAGE_LEN := 30.0
const SHORTAGE_FIXES := 5


static func tick(s: GameState, dt: float) -> void:
	var e: Dictionary = s.ev
	# salvage
	if s.built >= 1:
		if e.salvage_at <= 0.0:
			e.salvage_at = s.time + 45.0
		if e.salvage_left > 0.0:
			e.salvage_left -= dt
			if e.salvage_left <= 0.0:
				e.salvage = {}
				s.emit("salvage_gone")
		elif s.time >= e.salvage_at:
			_spawn_salvage(s)
	# wrecks
	if s.built >= 3 and not e.wreck:
		if e.wreck_at <= 0.0:
			e.wreck_at = s.time + 90.0
		elif s.time >= e.wreck_at:
			e.wreck = true
			s.emit("wreck_spawn")
	# power shortages
	if s.stage >= 2:
		if e.shortage_left > 0.0:
			e.shortage_left -= dt
			if e.shortage_left <= 0.0:
				e.shortage_left = 0.0
				s.emit("shortage_end", {fixed = false})
		elif e.shortage_at <= 0.0:
			e.shortage_at = s.time + 120.0
		elif s.time >= e.shortage_at:
			e.shortage_left = SHORTAGE_LEN
			e.shortage_fixes = 0
			e.shortage_at = s.time + SHORTAGE_LEN + s.rng.randf_range(180.0, 300.0) * (1 + s.lvl("reactor_stab"))
			s.emit("shortage_start")
			StoryData.add_log(s, "Реактор закашлял: напряжение упало, автоматика еле шевелится. Постучи по ядру!")


static func _spawn_salvage(s: GameState) -> void:
	var d := ProductionManager.derived(s)
	var r := ProductionManager.rates(s)
	var reward := {
		scrap = ceilf(maxf(15.0 * d.click, 12.0 * r.scrap_gross)),
		parts = ceilf(maxf(3.0, 8.0 * r.parts)),
		cores = 1.0 if s.rng.randf() < 0.15 else 0.0,
	}
	s.ev.salvage = reward
	s.ev.salvage_left = SALVAGE_LIFE
	var interval := s.rng.randf_range(70.0, 130.0)
	if "graveyard" in s.zones:
		interval *= 0.7
	s.ev.salvage_at = s.time + SALVAGE_LIFE + interval
	s.emit("salvage_spawn", {reward = reward})


static func collect_salvage(s: GameState) -> Dictionary:
	if s.ev.salvage_left <= 0.0 or s.ev.salvage.is_empty():
		return {}
	var rw: Dictionary = s.ev.salvage
	ResourceManager.add_scrap(s, rw.scrap)
	s.parts += rw.parts
	s.stats.parts += rw.parts
	if rw.cores > 0.0:
		ResourceManager.add_cores(s, rw.cores)
	s.ev.salvage = {}
	s.ev.salvage_left = 0.0
	s.stats.salvage += 1
	s.emit("salvage_taken", {reward = rw})
	if rw.cores > 0.0:
		StoryData.add_log(s, "В ящике под ветошью нашлось целое ядро. Редкая удача.")
	return rw


static func recruit_wreck(s: GameState) -> bool:
	if not s.ev.wreck:
		return false
	s.ev.wreck = false
	s.ev.wreck_at = s.time + s.rng.randf_range(150.0, 240.0)
	s.free_jobs += 1
	s.stats.wrecks += 1
	s.emit("wreck_taken")
	StoryData.add_log(s, "Брошенный робот ещё моргает. Его оттащили к ремонтной станции: починка бесплатная.")
	return true


## One hit on the reactor during a shortage; the fifth one ends it.
static func fix_shortage(s: GameState) -> bool:
	if not s.shortage_active():
		return false
	s.ev.shortage_fixes += 1
	if s.ev.shortage_fixes >= SHORTAGE_FIXES:
		s.ev.shortage_left = 0.0
		s.stats.shortages += 1
		s.emit("shortage_end", {fixed = true})
	return true
