extends SceneTree
## Rules, data and saves of Ржавый рассвет on Godot, headless:
##   godot --headless --path godot/rust -s res://tests/run.gd
## The parity tests replay fixed scenarios whose expected numbers come from web/rust/core.js.

var failed := 0
var passed := 0
var current := ""


func ok(cond: bool, what: String) -> void:
	if cond:
		passed += 1
	else:
		failed += 1
		printerr("FAIL [%s] %s" % [current, what])


func near(a: float, b: float, what: String, eps := 1e-6) -> void:
	ok(absf(a - b) <= eps * maxf(1.0, absf(b)), "%s: %s, expected %s" % [what, a, b])


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	SaveManager.dir = "user://test-saves"
	for m in get_method_list():
		if m.name.begins_with("test_"):
			current = m.name
			call(m.name)
	SaveManager.delete_all()
	print("%d passed, %d failed" % [passed, failed])
	quit(1 if failed else 0)


## The same value as JSON sees it (key order, int or float and String or StringName do not matter).
func norm(v: Variant) -> String:
	return JSON.stringify(JSON.parse_string(JSON.stringify(v)), "", true)


func fresh() -> GameState:
	return GameState.create(7)


func tick_n(s: GameState, n: int, dt := 0.1, events := true) -> void:
	for i in n:
		ProductionManager.tick(s, dt, events)


# ── parity with web/rust/core.js ──

func test_parity_manual() -> void:
	var s := fresh()
	for i in 30:
		ProductionManager.dig(s)
	for i in 5:
		ProductionManager.disassemble(s)
	near(s.scrap, 5, "scrap")
	near(s.parts, 5, "parts")
	near(s.cores, 0.025, "cores")
	ok(s.stats.clicks == 35, "clicks")


func test_parity_derived() -> void:
	var s := GameState.create(1, 2, 1)
	s.up = {shovel = 3, gloves = 2, magnet = 2, belt = 1, oil = 1, smelter = 1, scanner = 2, factory = 1, neuro = 1, wrench = 2}
	s.built = 7
	var d := ProductionManager.derived(s)
	near(d.click, 4.8, "click")
	ok(d.batch == 3, "batch")
	near(d.ratio, 4, "ratio")
	near(d.wrench, 5, "wrench")
	near(d.digger, 4.8, "digger")
	near(d.sorter, 1.8, "sorter")
	near(d.mechanic, 1.8, "mechanic")
	near(d.factory, 2.4, "factory")
	near(d.core_chance, 0.015, "core chance")
	near(d.robot_cost, 17, "robot cost")
	near(d.repair_need, 41, "repair need")


func test_parity_tick() -> void:
	var s := fresh()
	s.robots = {idle = 0, digger = 3, sorter = 2, mechanic = 1}
	s.parts = 100
	s.built = 3
	tick_n(s, 600)
	near(s.scrap, 0, "scrap")
	near(s.parts, 109, "parts", 1e-9)
	near(s.cores, 0.18, "cores", 1e-9)
	ok(s.built == 4 and s.robots.idle == 1, "one robot repaired, waiting for a job")
	near(s.repair.progress, 1.0, "repair progress", 1e-9)
	near(s.repair.need, 32, "repair need")


func test_parity_offline_with_dispatcher() -> void:
	var s := fresh()
	s.robots = {idle = 0, digger = 5, sorter = 2, mechanic = 2}
	s.parts = 50
	s.built = 9
	s.up = {dispatch = 1, magnet = 3}
	var g := ProductionManager.offline(s, 3600)
	near(g.scrap, 184885, "scrap gained", 1e-6)
	near(g.parts, 35793, "parts gained", 1e-6)
	ok(g.robots == 68 and s.built == 77, "68 robots built")
	ok(s.robots.digger == 31 and s.robots.sorter == 30 and s.robots.mechanic == 16 and s.robots.idle == 0,
		"the dispatcher spread them: %s" % s.robots)
	near(s.parts, 1123, "parts left", 1e-6)


func test_offline_cap() -> void:
	var a := fresh()
	a.robots.digger = 1
	ProductionManager.offline(a, 20 * 3600)
	near(a.stats.scrap, 8 * 3600, "eight hours at most")


# ── frame rate and pause ──

func test_frame_rate_independent() -> void:
	var game = root.get_node("/root/Game")
	var results := []
	for fps in [24, 60, 144]:
		game.s = fresh()
		game.s.robots = {idle = 0, digger = 4, sorter = 2, mechanic = 1}
		game.s.parts = 30
		game.s.built = 3
		game._acc = 0.0
		var steps := 0
		for f in 120 * fps:
			steps += game.feed(1.0 / fps)
		results.append([steps, game.s.stats.scrap, game.s.stats.parts, game.s.built])
	for r in results:
		ok(absi(r[0] - 1200) <= 1, "120 s are 1200 steps at any fps (%d)" % r[0])
		near(r[1], results[0][1], "same scrap at any fps", 0.002)
		near(r[2], results[0][2], "same parts at any fps", 0.002)
		ok(r[3] == results[0][3], "same robots at any fps")
	game.s = fresh()


func test_pause_stops_time() -> void:
	var game = root.get_node("/root/Game")
	game.s = fresh()
	game.s.robots.digger = 3
	game.running = true
	game.set_paused(true)
	for i in 30:
		game._process(0.1)
	ok(game.s.scrap == 0.0 and game.s.time == 0.0, "nothing happens while paused")
	game.set_paused(false)
	game.running = false
	game.s = fresh()


func test_step_size_barely_matters() -> void:
	var a := fresh()
	var b := fresh()
	for s in [a, b]:
		s.robots = {idle = 0, digger = 6, sorter = 3, mechanic = 2}
		s.parts = 40
		s.built = 4
	tick_n(a, 3000, 0.1, false)
	tick_n(b, 6000, 0.05, false)
	near(a.stats.parts, b.stats.parts, "parts with 0.1 s and 0.05 s steps", 0.01)


# ── workers ──

func test_assign() -> void:
	var s := fresh()
	s.robots.idle = 5
	ok(WorkerManager.assign(s, "digger", 2) == 2, "two diggers")
	ok(WorkerManager.assign(s, "sorter", 9) == 3, "only free robots can be assigned")
	ok(s.robots.idle == 0, "none free")
	ok(WorkerManager.assign(s, "mechanic", -1) == 0, "cannot remove what is not there")
	ok(WorkerManager.unassign_all(s, "digger") == 2 and s.robots.idle == 2, "remove all diggers")
	ok(WorkerManager.assign_all(s, "mechanic") == 2 and s.robots.mechanic == 2, "assign all to mechanics")
	ok(WorkerManager.assign(s, "boss", 1) == 0, "unknown role")
	ok(WorkerManager.total(s) == 5, "total stays")


func test_sorters_need_scrap() -> void:
	var s := fresh()
	s.robots.sorter = 4
	tick_n(s, 50)
	ok(s.parts == 0.0, "sorters without scrap make nothing")
	ok(ProductionManager.rates(s).sorter_starved, "they are reported as starved")


func test_repair_by_hand() -> void:
	var s := fresh()
	ok(ProductionManager.repair_click(s) == 0.0, "no parts, no repair")
	s.parts = 10
	ok(ProductionManager.repair_click(s) == 1.0, "first hit")
	ok(s.parts == 0.0 and s.repair.need == 20.0, "a robot costs 10 parts and 20 work")
	for i in 19:
		ProductionManager.repair_click(s)
	ok(s.built == 1 and s.robots.idle == 1 and s.repair.is_empty(), "the robot is ready and free")


# ── upgrades ──

func test_upgrade_data() -> void:
	var ids := {}
	for u in GameData.upgrades():
		ok(not ids.has(u.id), "unique id %s" % u.id)
		ids[u.id] = true
		ok(u.max_level >= 1 and not u.name.is_empty() and not u.description.is_empty(), "%s is complete" % u.id)
		ok(not u.cost(0).is_empty(), "%s has a cost" % u.id)
		ok(not u.prop.is_empty(), "%s shows up in the world" % u.id)
		if u.unlock_kind == "upgrade":
			ok(GameData.upgrade(u.unlock_target) != null, "%s needs a real upgrade" % u.id)
	for id in ["shovel", "gloves", "wrench", "magnet", "belt", "oil", "dispatch", "smelter", "scanner", "factory", "neuro"]:
		ok(ids.has(id), "the web game's upgrade %s is kept" % id)


## "+15%" in a text must be the effect's real amount, so balancing cannot leave stale descriptions.
func test_texts_match_numbers() -> void:
	var re := RegEx.create_from_string("\\+(\\d+)%")
	for st in GameData.stages():
		for m in re.search_all(st.unlock_text):
			ok(int(m.get_string(1)) == roundi(st.amount * 100), "stage %s says %s%%, amount %s" % [st.id, m.get_string(1), st.amount])
	for u in GameData.upgrades():
		for m in re.search_all(u.description):
			ok(int(m.get_string(1)) == roundi(u.amount * 100), "upgrade %s says %s%%, amount %s" % [u.id, m.get_string(1), u.amount])


func test_every_upgrade_has_an_effect() -> void:
	for u in GameData.upgrades():
		var s := fresh()
		s.built = 10
		var before := ProductionManager.derived(s)
		s.up[u.id] = 1
		var after := ProductionManager.derived(s)
		ok(before != after, "%s changes the numbers" % u.id)


func test_buy() -> void:
	var s := fresh()
	ok(not UpgradeManager.buy(s, "shovel"), "no parts")
	s.parts = 5
	ok(UpgradeManager.buy(s, "shovel") and s.lvl("shovel") == 1 and s.parts == 0.0, "shovel for 5 parts")
	near(UpgradeManager.state_of(s, "shovel").cost.parts, 9, "next shovel: ceil(5 * 1.8)")
	s.parts = 1000
	ok(not UpgradeManager.buy(s, "magnet"), "the magnet waits for the first robot")
	s.built = 1
	ok(UpgradeManager.buy(s, "magnet"), "then it can be bought")
	s.up.dispatch = 1
	s.built = 3
	ok(UpgradeManager.state_of(s, "dispatch").maxed and not UpgradeManager.buy(s, "dispatch"), "max level")
	ok(not UpgradeManager.buy(s, "nothing"), "unknown upgrade")


func test_drone_needs_stabilizer() -> void:
	var s := fresh()
	s.parts = 1e6
	s.cores = 1e3
	s.stage = 2
	ok(not UpgradeManager.state_of(s, "drone").unlocked, "drone locked")
	ok(UpgradeManager.buy(s, "reactor_stab"), "stabilizer after the power stage")
	ok(UpgradeManager.buy(s, "drone"), "then the drone")
	s.drone_task = "dig"
	var scrap := s.scrap
	tick_n(s, 25, 0.1, false)
	ok(s.scrap > scrap, "the drone digs")
	ok(s.stats.clicks == 0, "drone work is not counted as clicks")
	s.drone_task = "repair"
	tick_n(s, 30, 0.1, false)
	ok(not s.repair.is_empty() or s.built > 0, "the drone repairs")


# ── the ark ──

func test_stages() -> void:
	var st := GameData.stages()
	ok(st.size() == 7, "seven stages")
	ok(st[-1].effect == "launch", "the last one launches")
	var s := fresh()
	s.parts = 1e7
	s.cores = 1e4
	ok(not ReconstructionManager.build(s), "the ark waits for five robots")
	s.built = 5
	for i in st.size():
		ok(ReconstructionManager.build(s), "stage %d" % (i + 1))
		if i == 2:
			ok("north" in s.zones, "the frame opens the north zone")
	ok(s.launched and "graveyard" in s.zones, "launched, all zones open")
	ok(not ReconstructionManager.build(s), "nothing after the launch")
	s.stats.parts = 250000
	var n := ReconstructionManager.prestige(s)
	ok(n.blueprints == 3 and n.runs == 1 and n.stage == 0 and n.parts == 0.0, "new dawn with 3 blueprints")
	near(ProductionManager.derived(n).click, 1.3, "blueprints speed up the work")


func test_stage_effects() -> void:
	var s := fresh()
	s.built = 5
	var d0 := ProductionManager.derived(s)
	var st := GameData.stages()
	s.stage = 2
	var d2 := ProductionManager.derived(s)
	near(d2.mechanic, d0.mechanic * (1 + st[0].amount) * (1 + st[1].amount), "reactor + power for mechanics")
	near(d2.digger, d0.digger * (1 + st[1].amount), "power for diggers")
	s.stage = 3
	near(ProductionManager.derived(s).digger, d0.digger * (1 + st[1].amount) * (1 + st[2].amount), "the north zone")


# ── events ──

func test_salvage() -> void:
	var s := fresh()
	s.built = 1
	tick_n(s, 10)
	ok(s.ev.salvage_left == 0.0, "not yet")
	tick_n(s, 450)
	ok(s.ev.salvage_left > 0.0, "a crate after 45 s")
	var parts := s.parts
	var r := EventManager.collect_salvage(s)
	ok(not r.is_empty() and s.parts > parts and s.stats.salvage == 1, "picked up")
	ok(EventManager.collect_salvage(s).is_empty(), "only once")
	tick_n(s, 1300)
	ok(s.ev.salvage_left > 0.0 or s.ev.salvage_at > s.time, "the next one is scheduled")
	var t := 0
	while s.ev.salvage_left <= 0.0 and t < 3000:
		ProductionManager.tick(s, 0.1)
		t += 1
	tick_n(s, 260)
	ok(s.ev.salvage_left <= 0.0 and s.ev.salvage.is_empty(), "an untouched crate disappears")


func test_wreck() -> void:
	var s := fresh()
	s.built = 3
	tick_n(s, 920)
	ok(s.ev.wreck, "a wreck after 90 s")
	ok(EventManager.recruit_wreck(s) and s.free_jobs == 1, "recruited")
	ok(ProductionManager.start_repair(s), "goes on the bay without parts")
	ok(s.repair.free and s.repair.need == ceilf((20.0 + 9.0) / 2.0), "free, half the work")


func test_shortage() -> void:
	var s := fresh()
	s.built = 5
	s.stage = 2
	var normal: float = ProductionManager.derived(s).digger
	tick_n(s, 1210)
	ok(s.shortage_active(), "a shortage after 2 minutes")
	near(ProductionManager.derived(s).digger, normal * 0.5, "half power")
	for i in 4:
		EventManager.fix_shortage(s)
	ok(s.shortage_active(), "four hits are not enough")
	EventManager.fix_shortage(s)
	ok(not s.shortage_active() and s.stats.shortages == 1, "five hits fix it")
	ok(not EventManager.fix_shortage(s), "nothing to fix")


func test_events_wait_for_progress() -> void:
	var s := fresh()
	tick_n(s, 5000)
	ok(s.ev.salvage_left == 0.0 and not s.ev.wreck and not s.shortage_active(), "no events before the first robot")


func test_events_are_deterministic() -> void:
	var a := GameState.create(42)
	var b := GameState.create(42)
	for s in [a, b]:
		s.built = 5
		s.stage = 2
		s.robots.digger = 3
		tick_n(s, 6000)
	ok(a.ev == b.ev and a.stats.scrap == b.stats.scrap, "same seed, same events")


# ── achievements and story ──

func test_achievements() -> void:
	var ids := {}
	for a in GameData.achievements():
		ok(not ids.has(a.id), "unique %s" % a.id)
		ids[a.id] = true
	var s := fresh()
	s.parts = 10
	for i in 20:
		ProductionManager.repair_click(s)
	AchievementManager.check(s)
	ok(s.achievements.has("first_robot"), "first robot")
	s.built = 5
	AchievementManager.check(s)
	ok(s.achievements.has("bare_hands"), "the challenge without a shovel")
	var t := fresh()
	t.up.shovel = 1
	t.built = 5
	AchievementManager.check(t)
	ok(not t.achievements.has("bare_hands"), "failed with a shovel")


func test_story() -> void:
	var s := fresh()
	StoryData.check(s)
	ok(s.seen.has("wake") and s.log.size() == 1, "the first line")
	for i in 40:
		StoryData.add_log(s, "x")
	ok(s.log.size() == StoryData.LOG_MAX, "the log is capped")


# ── saves ──

func test_round_trip() -> void:
	var s := GameState.create(5)
	s.scrap = 12.5
	s.parts = 40
	s.cores = 2.25
	s.robots = {idle = 1, digger = 4, sorter = 2, mechanic = 1}
	s.built = 8
	s.repair = {progress = 3.0, need = 44.0, free = false}
	s.up = {shovel = 2, magnet = 1}
	s.stage = 3
	s.zones = ["yard", "north"]
	s.time = 1234.5
	s.achievements = {first_robot = true}
	s.drone_task = "sort"
	s.ev.wreck = true
	s.rng.randf()
	StoryData.add_log(s, "строка {n}", {n = 3})
	var res := SaveManager.decode(SaveManager.encode(s, 1000.0))
	ok(res.status == "ok" and res.saved_at == 1000.0, "decoded")
	var t: GameState = res.state
	var a := t.to_dict()
	var b := s.to_dict()
	for k in b:
		ok(norm(a[k]) == norm(b[k]), "%s survives a save: %s vs %s" % [k, a[k], b[k]])
	ok(t.rng.randf() == s.rng.randf(), "the random stream continues")
	ok(t.day() == 6, "day %d" % t.day())


func test_files() -> void:
	SaveManager.delete_all()
	ok(SaveManager.read().status == "missing", "no save yet")
	var s := fresh()
	s.parts = 77
	ok(SaveManager.write(s), "written")
	s.parts = 88
	ok(SaveManager.write(s), "written again")
	ok(SaveManager.read().state.parts == 88.0, "read back")
	var f := FileAccess.open(SaveManager.path(SaveManager.AUTO), FileAccess.WRITE)
	f.store_string("{not json")
	f.close()
	var r := SaveManager.read()
	ok(r.status == "restored" and r.state.parts == 77.0, "a damaged save falls back to the backup")
	ok(SaveManager.write(s, SaveManager.MANUAL) and SaveManager.read(SaveManager.MANUAL).state.parts == 88.0, "manual slot")
	SaveManager.delete_all()


func test_bad_saves() -> void:
	ok(SaveManager.decode("").status == "corrupt", "empty")
	ok(SaveManager.decode("[1,2]").status == "corrupt", "not an object")
	ok(SaveManager.decode('{"version": 99, "state": {}}').status == "newer", "from a newer version")
	var r := SaveManager.decode('{"version": 2, "state": {"scrap": "lots", "robots": {"digger": -4, "idle": 2}, "up": {"shovel": 999, "fake": 3}, "stage": 40, "zones": ["moon"], "drone_task": "dance"}}')
	ok(r.status == "ok", "wrong types are tolerated")
	var s: GameState = r.state
	ok(s.scrap == 0.0 and s.robots.digger == 0 and s.robots.idle == 2, "numbers sanitized")
	ok(s.lvl("shovel") == 15 and not s.up.has("fake"), "levels clamped, unknown upgrades dropped")
	ok(s.stage == 7 and s.launched, "stage clamped")
	ok(s.zones == ["yard"] and s.drone_task == "dig", "unknown zones and tasks dropped")


func test_web_save_migrates() -> void:
	var web := {state = {v = 1, scrap = 30, parts = 7000, cores = 9, robots = {idle = 0, digger = 10, sorter = 8, mechanic = 4},
		built = 22, repair = {progress = 5, need = 86}, autoRepair = false, up = {shovel = 4, magnet = 3, dispatch = 1},
		ark = 3, launched = false, blueprints = 1, runs = 1, stats = {scrap = 90000, parts = 30000, cores = 12, clicks = 400},
		time = 3000, seen = {wake = true, first = true, ark = true}}, savedAt = 1700000000000}
	var r := SaveManager.decode(JSON.stringify(web))
	ok(r.status == "ok", "the web format loads")
	var s: GameState = r.state
	ok(s.built == 22 and s.robots.digger == 10 and s.lvl("dispatch") == 1 and not s.auto_repair, "crew and upgrades kept")
	ok(s.stage == 3 and "north" in s.zones, "ark 3/5 (26 000 parts spent) is stage 3/7: %d" % s.stage)
	ok(s.repair.need == 86.0 and s.blueprints == 1 and s.seen.has("ark"), "repair, blueprints and story kept")
	near(r.saved_at, 1700000000.0, "milliseconds become seconds")
	ok(ReconstructionManager.stage_from_legacy_ark(5) == 7, "a launched ark stays launched")
	ok(ReconstructionManager.stage_from_legacy_ark(0) == 0, "nothing built")


# ── translations ──

func test_translations_keep_placeholders() -> void:
	var f := FileAccess.open("res://data/rust.csv", FileAccess.READ)
	var re := RegEx.create_from_string("\\{(\\w+)\\}")
	f.get_csv_line()
	var n := 0
	while not f.eof_reached():
		var row := f.get_csv_line()
		if row.size() < 3:
			continue
		n += 1
		var ru := {}
		for m in re.search_all(row[1]):
			ru[m.get_string(1)] = true
		var ro := {}
		for m in re.search_all(row[2]):
			ro[m.get_string(1)] = true
		ro.erase("pl")
		ok(ru.keys() == ro.keys() or (ru.keys().all(func(k): return ro.has(k)) and ro.keys().all(func(k): return ru.has(k))),
			"placeholders of %s: %s vs %s" % [row[0], ru.keys(), ro.keys()])
		ok(row[2].count("|") == row[1].count("|"), "plural forms of %s" % row[0])
	ok(n > 200, "the table has %d lines" % n)


func test_plurals() -> void:
	TranslationServer.set_locale("ru")
	ok(Fmt.plural(1, "деталь|детали|деталей") == "деталь" and Fmt.plural(3, "деталь|детали|деталей") == "детали"
		and Fmt.plural(11, "деталь|детали|деталей") == "деталей" and Fmt.plural(22, "деталь|детали|деталей") == "детали", "Russian plurals")
	ok(Fmt.num(12345) == "12,3 тыс." and Fmt.num(9999) == "9999" and Fmt.rate(-1.25) == "−1,2/с", "Russian numbers: %s %s" % [Fmt.num(12345), Fmt.rate(-1.25)])
	TranslationServer.set_locale("ro")
	ok(Fmt.plural(1, "деталь|детали|деталей") == "piesă" and Fmt.plural(5, "деталь|детали|деталей") == "piese"
		and Fmt.plural(25, "деталь|детали|деталей") == "de piese", "Romanian plurals")
	ok(tr("{a} хлама → {b} дет.").format({a = 5, b = 1, pl = Fmt.plural(1, "деталь|детали|деталей")}) == "5 fier vechi → 1 piesă", "a sentence with a plural")
	TranslationServer.set_locale("ru")
