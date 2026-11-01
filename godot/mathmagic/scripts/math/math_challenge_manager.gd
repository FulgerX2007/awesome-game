extends Node
## Autoload MathChallengeManager: hands out challenges, checks answers, adapts difficulty and remembers
## what the child finds hard. Puzzles ask it for a challenge and open it; the UI listens and shows the dialog.
## It never touches scenes itself, so the same questions work for gates, bridges, machines and the boss.

signal challenge_opened(challenge: MathChallenge, requester: Object)
signal challenge_closed(requester: Object, solved: bool)
signal learning_changed

const HISTORY := 8          # recent answers kept per skill
const UP_STREAK := 3        # this many first-try answers in a row: a little harder
const DOWN_STREAK := 2      # this many misses in a row: a little easier

## skill -> {level: int, history: Array[bool] (true = right on the first try), streak: int}
var learning := {}
var rng := RandomNumberGenerator.new()
var _active: Object = null


func _ready() -> void:
	rng.randomize()
	reset()


func reset() -> void:
	learning = {}
	for s in ChallengeGenerator.SKILLS:
		learning[s] = _fresh()


## Builds a challenge for a puzzle. skill may be "mixed": add or sub, leaning toward the one the child
## finds harder so it comes back more often. The puzzle's [min_d, max_d] keeps early levels gentle.
func create(skill: String, min_d := 1, max_d := ChallengeGenerator.MAX_DIFFICULTY, options := {}) -> MathChallenge:
	var s := skill
	if skill == "mixed":
		var weak := weakest_skill(["add", "sub"])
		s = weak if rng.randf() < 0.65 else ("sub" if weak == "add" else "add")
	return ChallengeGenerator.generate(s, difficulty_for(s, min_d, max_d), rng, options)


func difficulty_for(skill: String, min_d := 1, max_d := ChallengeGenerator.MAX_DIFFICULTY) -> int:
	var lvl: int = learning.get(skill, {level = 1}).level
	return clampi(lvl, min_d, max_d)


## The skill with the lowest recent accuracy (needs two answers to count); ties go to the lower level.
func weakest_skill(candidates: Array) -> String:
	var best: String = candidates[0]
	var best_score := INF
	for s in candidates:
		var st: Dictionary = learning.get(s, {level = 1, history = []})
		var h: Array = st.history
		var acc: float = 1.0 if h.size() < 2 else float(h.count(true)) / h.size()
		var score: float = acc * 10.0 + float(st.level)
		if score < best_score:
			best_score = score
			best = s
	return best


func accuracy(skill: String) -> float:
	var h: Array = learning.get(skill, {history = []}).history
	return 1.0 if h.is_empty() else float(h.count(true)) / h.size()


## Records how a challenge went and moves that skill's level up or down. streak counts first-try answers
## in a row (positive) or misses in a row (negative) and restarts after every level change.
func record(challenge: MathChallenge, first_try: bool) -> void:
	var st: Dictionary = learning.get(challenge.skill, _fresh())
	st.history.append(first_try)
	while st.history.size() > HISTORY:
		st.history.pop_front()
	if first_try:
		st.streak = mini(maxi(st.streak, 0) + 1, UP_STREAK)
	else:
		st.streak = maxi(mini(st.streak, 0) - 1, -DOWN_STREAK)
	if st.streak >= UP_STREAK and st.level < ChallengeGenerator.MAX_DIFFICULTY:
		st.level += 1
		st.streak = 0
	elif -st.streak >= DOWN_STREAK and st.level > 1:
		st.level -= 1
		st.streak = 0
	learning[challenge.skill] = st
	learning_changed.emit()


func _fresh() -> Dictionary:
	return {level = 1, history = [], streak = 0}


# --- the open challenge ---------------------------------------------------------------------------------------

func is_active() -> bool:
	return _active != null and is_instance_valid(_active)


## A puzzle (or the boss) opens a challenge. Only one at a time: a second request while one is open is
## ignored, which also guards against double interaction from overlapping signals.
func open(challenge: MathChallenge, requester: Object) -> bool:
	if is_active():
		return false
	_active = requester
	challenge_opened.emit(challenge, requester)
	return true


func close(solved: bool) -> void:
	var r := _active
	_active = null
	challenge_closed.emit(r, solved)


# --- save data ------------------------------------------------------------------------------------------------

func to_dict() -> Dictionary:
	return learning.duplicate(true)


func from_dict(d: Variant) -> void:
	reset()
	if not d is Dictionary:
		return
	for s in ChallengeGenerator.SKILLS:
		var st = d.get(s)
		if not st is Dictionary:
			continue
		var lvl := clampi(_int(st.get("level"), 1), 1, ChallengeGenerator.MAX_DIFFICULTY)
		var hist: Array = []
		if st.get("history") is Array:
			for v in st.history:
				if v is bool:
					hist.append(v)
		while hist.size() > HISTORY:
			hist.pop_front()
		learning[s] = {level = lvl, history = hist, streak = clampi(_int(st.get("streak"), 0), -DOWN_STREAK, UP_STREAK)}


## JSON numbers come back as floats; anything else falls back to the default.
static func _int(v: Variant, fallback: int) -> int:
	return int(v) if (v is int or v is float) else fallback
