class_name ChallengeGenerator
extends RefCounted
## Builds valid MathChallenges for a skill and a difficulty. Static and seeded, so tests can pin it down.
## Every number range lives in LEVELS; level scripts never contain questions, only a skill and a difficulty window.

const MAX_DIFFICULTY := 5
const SKILLS := ["add", "sub", "missing", "mul"]

## Per difficulty: the largest number in the question (the sum, the start of a subtraction or the target of a
## missing addend), the smallest operand, and how many answer buttons. 1-2 stay within five and ten so the
## countable stones fit in one or two rows; 4-5 cross ten.
const LEVELS := {
	1: {max_total = 5, min_operand = 1, choices = 3},
	2: {max_total = 10, min_operand = 1, choices = 3},
	3: {max_total = 12, min_operand = 2, choices = 3},
	4: {max_total = 16, min_operand = 2, choices = 4},
	5: {max_total = 20, min_operand = 3, choices = 4},
}


## Multiplication as equal groups: how many groups and how many in each, per difficulty. Products stay at
## 30 or less, so every group can still be drawn and counted one by one.
const MUL_LEVELS := {
	1: {groups = [2, 2], size = [2, 3], choices = 3},
	2: {groups = [2, 3], size = [2, 4], choices = 3},
	3: {groups = [2, 4], size = [2, 5], choices = 3},
	4: {groups = [3, 5], size = [2, 5], choices = 4},
	5: {groups = [3, 5], size = [3, 6], choices = 4},
}


static func range_for(difficulty: int) -> Dictionary:
	return LEVELS[clampi(difficulty, 1, MAX_DIFFICULTY)]


## skill: "add", "sub", "missing" or "mul". options:
##   max_unknown: int - the answer may not exceed this (a bridge cannot ask for more stones than the pouch holds)
##   min_total:   int - the question's largest number is at least this
##   max_groups:  int - "mul" only: at most this many groups (a staircase has room for so many steps)
static func generate(skill: String, difficulty: int, rng: RandomNumberGenerator, options := {}) -> MathChallenge:
	var d := clampi(difficulty, 1, MAX_DIFFICULTY)
	if skill == "mul":
		return _generate_mul(d, rng, options)
	var r := range_for(d)
	var max_total: int = r.max_total
	var lo: int = r.min_operand
	var max_unknown: int = maxi(1, options.get("max_unknown", max_total))
	var min_total: int = clampi(options.get("min_total", maxi(2 * lo, int(max_total * 0.4))), 2 * lo, max_total)
	var c := MathChallenge.new()
	c.difficulty = d
	c.skill = skill
	c.visual = true
	match skill:
		"sub":
			c.op = MathChallenge.Op.SUB
			c.a = rng.randi_range(maxi(min_total, lo + 1), max_total)
			c.b = rng.randi_range(lo, c.a - 1)  # what is left is at least one
			if c.a - c.b > max_unknown:
				c.b = c.a - max_unknown
			c.answer = c.a - c.b
			c.total = c.a
		"missing":
			c.op = MathChallenge.Op.MISSING
			c.total = rng.randi_range(min_total, max_total)
			var hi := mini(c.total - lo, max_unknown)
			c.b = rng.randi_range(mini(lo, hi), hi)
			c.a = c.total - c.b
			c.answer = c.b
		_:
			c.op = MathChallenge.Op.ADD
			c.skill = "add"
			c.total = rng.randi_range(min_total, max_total)
			c.a = rng.randi_range(lo, c.total - lo)
			c.b = c.total - c.a
			c.answer = c.total
	c.choices = make_choices(c, r.choices, rng)
	return c


static func _generate_mul(d: int, rng: RandomNumberGenerator, options: Dictionary) -> MathChallenge:
	var r: Dictionary = MUL_LEVELS[d]
	var g_hi: int = clampi(options.get("max_groups", r.groups[1]), 2, r.groups[1])
	var g_lo: int = mini(r.groups[0], g_hi)
	var c := MathChallenge.new()
	c.op = MathChallenge.Op.MUL
	c.difficulty = d
	c.skill = "mul"
	c.visual = true
	c.a = rng.randi_range(g_lo, g_hi)
	c.b = rng.randi_range(r.size[0], r.size[1])
	c.total = c.a * c.b
	c.answer = c.total
	c.choices = make_choices(c, r.choices, rng)
	return c


## The answer plus near misses a child would really pick: one off, two off, and the typical slips
## (adding instead of subtracting, giving the total instead of the missing part). Distinct, never negative.
static func make_choices(c: MathChallenge, count: int, rng: RandomNumberGenerator) -> Array[int]:
	var pool: Array[int] = []
	var slips: Array[int] = [c.answer + 1, c.answer - 1]
	match c.op:
		MathChallenge.Op.SUB:
			slips.append(c.a + c.b)
			slips.append(c.b)
		MathChallenge.Op.MISSING:
			slips.append(c.total)
			slips.append(c.a)
		MathChallenge.Op.MUL:  # one group too many or too few, or adding the two numbers
			slips = [c.answer + c.b, c.answer - c.b, c.a + c.b, c.answer + 1, c.answer - 1]
		_:
			slips.append(c.a)
	slips.append_array([c.answer + 2, c.answer - 2, c.answer + 3, c.answer - 3])
	for v in slips:
		if v >= 0 and v != c.answer and not pool.has(v):
			pool.append(v)
	var near: Array[int] = pool.slice(0, 2)       # the two closest stay; the rest is shuffled for variety
	var far: Array[int] = pool.slice(2)
	_shuffle(far, rng)
	var out: Array[int] = [c.answer]
	for v in near + far:
		if out.size() >= count:
			break
		out.append(v)
	var extra := c.answer + 4
	while out.size() < count:  # tiny numbers can run out of slips
		if not out.has(extra):
			out.append(extra)
		extra += 1
	_shuffle(out, rng)
	return out


static func _shuffle(arr: Array, rng: RandomNumberGenerator) -> void:
	for i in range(arr.size() - 1, 0, -1):
		var j := rng.randi_range(0, i)
		var t = arr[i]
		arr[i] = arr[j]
		arr[j] = t
