class_name MathChallenge
extends RefCounted
## One math question as plain data. Puzzles, the dialog and the boss all read this; nothing here touches a scene.
##   ADD:     a + b = ?
##   SUB:     a - b = ?
##   MISSING: a + ? = total   (how many more do we need?)

enum Op { ADD, SUB, MISSING }

var op: Op = Op.ADD
var a := 0
var b := 0                     # for MISSING this is the unknown, so b == answer
var total := 0                 # a + b for ADD and MISSING, a for SUB
var answer := 0
var choices: Array[int] = []   # distinct, shuffled, contains answer
var difficulty := 1            # 1..ChallengeGenerator.MAX_DIFFICULTY
var skill := ""                # "add" | "sub" | "missing", the learning stat it counts toward
var visual := true             # show countable objects in the dialog


func is_correct(value: int) -> bool:
	return value == answer


## The question as the child reads it, e.g. "3 + 2 = ?" or "4 + ? = 7".
func question_text() -> String:
	match op:
		Op.ADD:
			return "%d + %d = ?" % [a, b]
		Op.SUB:
			return "%d − %d = ?" % [a, b]
		_:
			return "%d + ? = %d" % [a, total]


## The equation with the answer filled in, for the "well done" line.
func solved_text() -> String:
	match op:
		Op.ADD:
			return "%d + %d = %d" % [a, b, answer]
		Op.SUB:
			return "%d − %d = %d" % [a, b, answer]
		_:
			return "%d + %d = %d" % [a, answer, total]


## A short hint in simple words. Untranslated key; the dialog runs it through tr().
func hint_key() -> String:
	match op:
		Op.ADD:
			return "Count all the stones together."
		Op.SUB:
			return "Start with all the stones. Cross some out. Count what is left."
		_:
			return "Count the empty spots."


func to_dict() -> Dictionary:
	return {op = int(op), a = a, b = b, total = total, answer = answer, choices = choices.duplicate(), difficulty = difficulty, skill = skill}
