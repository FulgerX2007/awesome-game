extends SceneTree
## Headless tests for MathMagic:
##   godot --headless --path godot/mathmagic -s res://tests/run.gd
## Math generation and checking, difficulty adaptation, save/load, and every level scene loading with its
## puzzles solvable. The full playthrough by a bot is tests/playthrough.gd.

var failed := 0
var passed := 0
var Math: Node
var Progress: Node
var Save: Node


func _initialize() -> void:
	Math = root.get_node("MathChallengeManager")
	Progress = root.get_node("ProgressManager")
	Save = root.get_node("SaveManager")
	Save.path = "user://test_save.json"
	for name in ["test_addition", "test_subtraction", "test_missing", "test_answer_checking", "test_choices_unique",
			"test_ranges", "test_difficulty_boundaries", "test_max_unknown", "test_text", "test_adaptation",
			"test_weakest_skill", "test_save_roundtrip", "test_save_invalid", "test_progress_sanitize",
			"test_levels_load"]:
		var before := failed
		var finished = await call(name)
		if finished != true:
			failed += 1
			printerr("  %s stopped early (script error)" % name)
		if failed == before:
			passed += 1
			print("ok   ", name)
		else:
			print("FAIL ", name)
	DirAccess.remove_absolute(ProjectSettings.globalize_path("user://test_save.json"))
	print("%d passed, %d failed" % [passed, failed])
	quit(1 if failed else 0)


func check(ok: bool, what: String) -> void:
	if not ok:
		failed += 1
		printerr("  ", what)


func _rng(seed: int) -> RandomNumberGenerator:
	var r := RandomNumberGenerator.new()
	r.seed = seed
	return r


func _each(skill: String, fn: Callable) -> void:
	for d in range(1, ChallengeGenerator.MAX_DIFFICULTY + 1):
		var rng := _rng(d * 1000 + skill.length())
		for i in 300:
			fn.call(ChallengeGenerator.generate(skill, d, rng), d)


func test_addition():
	_each("add", func(c: MathChallenge, _d):
		check(c.op == MathChallenge.Op.ADD, "add op")
		check(c.a + c.b == c.answer and c.total == c.answer, "add %s" % c.solved_text()))
	return true


func test_subtraction():
	_each("sub", func(c: MathChallenge, _d):
		check(c.op == MathChallenge.Op.SUB, "sub op")
		check(c.a - c.b == c.answer, "sub %s" % c.solved_text())
		check(c.answer >= 1 and c.b >= 1, "sub keeps something and takes something: %s" % c.solved_text()))
	return true


func test_missing():
	_each("missing", func(c: MathChallenge, _d):
		check(c.op == MathChallenge.Op.MISSING, "missing op")
		check(c.a + c.answer == c.total and c.b == c.answer, "missing %s" % c.solved_text())
		check(c.answer >= 1, "missing part is at least one"))
	return true


func test_answer_checking():
	for skill in ChallengeGenerator.SKILLS:
		_each(skill, func(c: MathChallenge, _d):
			check(c.is_correct(c.answer), "right answer accepted")
			for v in c.choices:
				if v != c.answer:
					check(not c.is_correct(v), "wrong answer %d rejected for %s" % [v, c.question_text()])
			check(not c.is_correct(c.answer + 1) and not c.is_correct(c.answer - 1), "near misses rejected"))
	return true


func test_choices_unique():
	for skill in ChallengeGenerator.SKILLS:
		_each(skill, func(c: MathChallenge, d: int):
			var seen := {}
			for v in c.choices:
				check(not seen.has(v), "duplicate choice %d in %s" % [v, c.question_text()])
				seen[v] = true
				check(v >= 0, "negative choice")
			check(c.choices.has(c.answer), "answer among the choices")
			check(c.choices.size() == ChallengeGenerator.range_for(d).choices, "choice count at difficulty %d" % d))
	return true


func test_ranges():
	for skill in ChallengeGenerator.SKILLS:
		_each(skill, func(c: MathChallenge, d: int):
			var r := ChallengeGenerator.range_for(d)
			for n in [c.a, c.b, c.total, c.answer]:
				check(n >= 0 and n <= r.max_total, "%s out of range at difficulty %d" % [c.question_text(), d])
			check(c.difficulty == d, "difficulty recorded"))
	return true


func test_difficulty_boundaries():
	check(ChallengeGenerator.range_for(0) == ChallengeGenerator.range_for(1), "below 1 clamps to 1")
	check(ChallengeGenerator.range_for(99) == ChallengeGenerator.range_for(ChallengeGenerator.MAX_DIFFICULTY), "above max clamps")
	var c := ChallengeGenerator.generate("add", 0, _rng(1))
	check(c.difficulty == 1 and c.total <= 5, "difficulty 0 behaves as 1")
	var prev := 0
	for d in range(1, ChallengeGenerator.MAX_DIFFICULTY + 1):
		var m: int = ChallengeGenerator.range_for(d).max_total
		check(m >= prev, "ranges never shrink as difficulty grows")
		prev = m
	Math.reset()
	check(Math.difficulty_for("add", 2, 3) == 2, "a puzzle's minimum applies")
	Math.learning.add.level = 5
	check(Math.difficulty_for("add", 1, 2) == 2, "a puzzle's maximum applies")
	Math.reset()
	return true


func test_max_unknown():
	var rng := _rng(5)
	for d in range(1, 6):
		for i in 200:
			for cap in [1, 2, 3, 5]:
				var c := ChallengeGenerator.generate("missing", d, rng, {max_unknown = cap})
				check(c.answer <= cap and c.answer >= 1, "bridge never asks for more than the pouch: %s cap %d" % [c.question_text(), cap])
				check(c.a + c.answer == c.total, "still valid with a cap")
	return true


func test_text():
	var c := MathChallenge.new()
	c.op = MathChallenge.Op.MISSING
	c.a = 4
	c.b = 3
	c.total = 7
	c.answer = 3
	check(c.question_text() == "4 + ? = 7", "missing text: " + c.question_text())
	check(c.solved_text() == "4 + 3 = 7", "missing solved text")
	c.op = MathChallenge.Op.SUB
	c.a = 7
	c.total = 7
	c.answer = 4
	check(c.question_text() == "7 − 3 = ?", "sub text")
	return true


func test_adaptation():
	Math.reset()
	var c := ChallengeGenerator.generate("add", 1, _rng(2))
	for i in Math.UP_STREAK:
		Math.record(c, true)
	check(Math.learning.add.level == 2, "three right in a row: one step harder")
	Math.record(c, false)
	check(Math.learning.add.level == 2, "one miss changes nothing")
	Math.record(c, false)
	check(Math.learning.add.level == 1, "two misses in a row: one step easier")
	for i in 3:
		Math.record(c, false)
	check(Math.learning.add.level == 1, "never below 1")
	for i in 40:
		Math.record(c, true)
	check(Math.learning.add.level == ChallengeGenerator.MAX_DIFFICULTY, "never above the max")
	check(Math.learning.add.history.size() <= Math.HISTORY, "history is bounded")
	Math.reset()
	return true


func test_weakest_skill():
	Math.reset()
	var add := ChallengeGenerator.generate("add", 1, _rng(3))
	var sub := ChallengeGenerator.generate("sub", 1, _rng(3))
	for i in 4:
		Math.record(add, true)
		Math.record(sub, i % 2 == 0)
	check(Math.weakest_skill(["add", "sub"]) == "sub", "the skill with more misses is the weak one")
	var n := 0
	for i in 400:
		if Math.create("mixed").skill == "sub":
			n += 1
	check(n > 220, "mixed puzzles bring the weak skill back more often (%d of 400)" % n)
	Math.reset()
	return true


func test_save_roundtrip():
	Progress.reset()
	Math.reset()
	Progress.complete_level(0)
	Progress.complete_level(1)
	Progress.collect_gem("beach", "Gem1")
	Progress.collect_gem("beach", "Gem2")
	Progress.set_setting("music", 0.3)
	Progress.set_setting("lang", "ro")
	Math.record(ChallengeGenerator.generate("sub", 2, _rng(4)), false)
	Math.learning.add.level = 3
	check(Save.save_game(), "save written")
	var before: Dictionary = Save.snapshot()
	Progress.reset()
	Math.reset()
	Save.load_game()
	var after: Dictionary = Save.snapshot()
	check(JSON.stringify(before) == JSON.stringify(after), "what is loaded is what was saved\n%s\n%s" % [before, after])
	check(Progress.is_unlocked(2) and not Progress.is_unlocked(3), "unlocks survive")
	check(Progress.has_gem("beach", "Gem2") and Progress.gem_count("beach") == 2, "gems survive")
	check(Math.learning.add.level == 3 and Math.learning.sub.history == [false], "learning survives")
	check(is_equal_approx(Progress.settings.music, 0.3) and Progress.settings.lang == "ro", "settings survive")
	Progress.reset()
	Math.reset()
	return true


func test_save_invalid():
	for text in ["", "   ", "{not json", "[1,2,3]", "{\"version\": 99}", "{\"progress\": {}}", "null"]:
		var d: Dictionary = Save.parse(text)
		check(d.is_empty(), "invalid save %s gives defaults" % text)
		check(Save.last_error != "", "invalid save %s is reported" % text)
	var f := FileAccess.open(Save.path, FileAccess.WRITE)
	f.store_string("{ broken")
	f.close()
	Progress.complete_level(2)
	Save.load_game()
	check(Progress.unlocked == 1 and Progress.completed.is_empty(), "a broken file loads as a fresh game")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Save.path))
	Save.load_game()
	check(Progress.unlocked == 1, "a missing file loads as a fresh game")
	return true


func test_progress_sanitize():
	Progress.from_dict({unlocked = 99, completed = ["beach", "nowhere", 7, "beach"], gems = {beach = ["a", "a", "b", "c", "d"], nowhere = ["x"], bridge = "x"},
		settings = {sfx = 7, music = "loud", lang = "xx", large_text = 1}})
	check(Progress.unlocked == LevelCatalog.count(), "unlocked clamps to the number of levels")
	check(Progress.completed == ["beach"], "unknown and repeated levels dropped")
	check(Progress.gems.beach == ["a", "b", "c"], "gems unique and at most three")
	check(not Progress.gems.has("nowhere") and not Progress.gems.has("bridge"), "bad gem lists dropped")
	check(Progress.settings.sfx == 1.0 and Progress.settings.music == Progress.DEFAULT_SETTINGS.music, "settings clamped or defaulted")
	check(Progress.settings.lang == "" and Progress.settings.large_text == false, "bad settings fall back")
	Progress.from_dict({completed = ["bridge"]})
	check(Progress.is_unlocked(2), "a finished level opens the next even if 'unlocked' was lost")
	Math.from_dict({add = {level = 9, history = [true, "x", false, true, true, true, true, true, true, true, true]}, sub = "bad"})
	check(Math.learning.add.level == ChallengeGenerator.MAX_DIFFICULTY, "learning level clamped")
	check(Math.learning.add.history.size() == Math.HISTORY and not Math.learning.add.history.has("x"), "learning history cleaned")
	check(Math.learning.sub.level == 1, "bad learning entry falls back")
	Progress.reset()
	Math.reset()
	return true


## Every level scene loads, has a spawn, a goal and its puzzles, and the camera limits make sense.
func test_levels_load():
	for i in LevelCatalog.count():
		var info: Dictionary = LevelCatalog.get_level(i)
		check(ResourceLoader.exists(info.scene), "%s exists" % info.scene)
		if not ResourceLoader.exists(info.scene):
			continue
		var lvl = load(info.scene).instantiate()
		root.add_child(lvl)
		await process_frame
		check(lvl.level_index == i, "%s has level_index %d" % [info.id, i])
		check(lvl.get_node_or_null("Spawn") != null, "%s has a spawn" % info.id)
		check(lvl.camera_min_x < lvl.camera_max_x, "%s camera limits" % info.id)
		check(lvl.player != null and lvl.camera != null, "%s spawns the mage and camera" % info.id)
		var gems: Array = lvl.find_children("*", "Pickup", true, false).filter(func(p): return p.kind == "gem")
		check(gems.size() == ProgressManager.GEMS_PER_LEVEL, "%s has %d gems" % [info.id, gems.size()])
		var has_goal: bool = lvl.find_children("*", "Goal", true, false).size() == 1
		var has_boss: bool = lvl.find_children("*", "StoneGuardian", true, false).size() == 1
		check(has_goal or has_boss, "%s has a way to finish" % info.id)
		for p in lvl.puzzles:
			check(p.challenge != null and p.challenge.choices.has(p.challenge.answer), "%s/%s has a valid challenge" % [info.id, p.name])
		lvl.queue_free()
		await process_frame
	return true
