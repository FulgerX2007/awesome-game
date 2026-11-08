class_name ReconstructionManager
extends RefCounted
## Rebuilding the ark: seven stages in order, after the fifth robot. The last one launches it and
## opens "Новый рассвет" (prestige with blueprints).


static func unlocked(s: GameState) -> bool:
	return s.built >= GameData.def().ark_unlock_built or s.stage > 0


static func next_stage(s: GameState) -> StageDef:
	var st := GameData.stages()
	return st[s.stage] if s.stage < st.size() else null


static func cost(st: StageDef) -> Dictionary:
	var c := {parts = st.parts}
	if st.cores > 0.0:
		c.cores = st.cores
	return c


static func can_build(s: GameState) -> bool:
	var st := next_stage(s)
	return st != null and unlocked(s) and ResourceManager.can_afford(s, cost(st))


static func build(s: GameState) -> bool:
	if not can_build(s):
		return false
	var st := next_stage(s)
	ResourceManager.pay(s, cost(st))
	s.stage += 1
	if st.effect == "zone" and not st.effect_target in s.zones:
		s.zones.append(st.effect_target)
		s.emit("zone_opened", {zone = st.effect_target})
	if st.effect == "launch" or s.stage >= GameData.stages().size():
		s.launched = true
	s.emit("stage_built", {index = s.stage - 1, id = st.id})
	StoryData.add_log(s, st.story)
	return true


## The web game gives sqrt(parts / 10 000); this ark costs about 2.5 times as much, so the divisor is
## scaled with it and a dawn still earns about as many blueprints.
const BLUEPRINT_DIVISOR := 25000.0


static func blueprint_gain(s: GameState) -> int:
	return maxi(1, int(floorf(sqrt(s.stats.parts / BLUEPRINT_DIVISOR))))


## A fresh dawn with the blueprints earned; achievements and the RNG carry over.
static func prestige(s: GameState) -> GameState:
	if not s.launched:
		return s
	var n := GameState.create(int(s.rng.randi()), s.blueprints + blueprint_gain(s), s.runs + 1)
	n.achievements = s.achievements.duplicate()
	return n


## Map the web game's five ark stages onto the seven here by parts already spent.
static func stage_from_legacy_ark(ark: int) -> int:
	var legacy := [1000.0, 5000.0, 20000.0, 60000.0, 150000.0]
	var spent := 0.0
	for i in clampi(ark, 0, legacy.size()):
		spent += legacy[i]
	if ark >= legacy.size():
		return GameData.stages().size()
	var total := 0.0
	var n := 0
	for st in GameData.stages():
		total += st.parts
		if total > spent:
			break
		n += 1
	return n
