extends SceneTree
## Rules, data, saves and translations of Долгая зима on Godot, headless:
##   godot --headless --path godot/winter -s res://tests/run.gd
## Ported from the main cases of tests/winter/*.test.js. That the port plays exactly like web/winter/core.js over a
## whole winter is checked by tests/winter-godot/parity.test.js (tests/parity.gd).

const S := preload("res://scripts/sim/sim.gd")
const V := preload("res://scripts/sim/view_math.gd")

var failed := 0
var passed := 0
var current := ""


func ok(cond: bool, what: String) -> void:
	if cond:
		passed += 1
	else:
		failed += 1
		printerr("FAIL [%s] %s" % [current, what])


func eq(a, b, what: String) -> void:
	ok(a == b, "%s: %s, expected %s" % [what, str(a), str(b)])


func _initialize() -> void:
	for m in get_method_list():
		if m.name.begins_with("test_"):
			current = m.name
			call(m.name)
	print("%d passed, %d failed" % [passed, failed])
	quit(1 if failed else 0)


# ── helpers like the JS tests' ──

func sim(g: Dictionary, seconds: float, frame := 0.25) -> Array:
	var ev := []
	var t := 0.0
	while t < seconds - 1e-9:
		S.step(g, frame)
		ev.append_array(S.drain(g))
		t += frame
	return ev


func settle(g: Dictionary, seconds := 60.0) -> Array:
	var ev := []
	var t := 0.0
	while t < seconds and (g.hero.path != null or g.hero.target != null):
		S.step(g, 0.25)
		ev.append_array(S.drain(g))
		t += 0.25
	return ev


func of(events: Array, type: String) -> Array:
	return events.filter(func(e): return e.type == type)


func quiet(seed := 1, diff := "normal") -> Dictionary:
	var g := S.new_game(diff, seed)
	g.animals = []
	return g


func rich(g: Dictionary) -> void:
	g.stock.wood = 150
	g.stock.stone = 80
	g.stock.metal = 30


func wolf(g: Dictionary, x: float, y: float, hp := 4.0) -> Dictionary:
	var w := {id = g.nextId, x = x, y = y, hp = hp, maxHp = hp, cd = 0, flee = false}
	g.nextId += 1
	g.wolves.append(w)
	return w


func nearest(g: Dictionary, kind: String):
	var best = null
	var bd := INF
	for n in g.nodes:
		if n.kind == kind and n.amount > 0:
			var d := S.hyp(n.x - g.hero.x, n.y - g.hero.y)
			if d < bd:
				bd = d
				best = n
	return best


func clear_around(g: Dictionary, x: int, y: int, r := 2) -> void:
	for n in g.nodes:
		if absi(int(n.x) - x) <= r and absi(int(n.y) - y) <= r:
			n.amount = 0
	g.nodes = g.nodes.duplicate()


# ── numbers and data ──

func test_rng_and_hypot_match_js() -> void:
	# mulberry32(1) and Math.hypot values taken from Node
	var r := WinterRng.next(1)
	eq(r[0], 1831565814, "state after one step")
	eq(r[1], 0.6270739405881613, "first value")
	eq(WinterRng.imul(0xFFFFFFFF, 0xFFFFFFFF), 1, "imul of -1 by -1")
	eq(WinterRng.imul(123456789, 987654321), (123456789 * 987654321) & 0xFFFFFFFF, "imul")
	eq(WinterRng.hypot(3, 4), 5.0, "hypot 3 4")
	eq(WinterRng.hypot(0, 0), 0.0, "hypot 0")
	eq(WinterRng.hypot(-1, 2), 2.23606797749979, "hypot 1 2 (V8)")
	ok(is_inf(WinterRng.hypot(INF, 1)), "hypot inf")


func test_data_resources_hold_the_rules_numbers() -> void:
	var D := S.D
	eq(D.TICK, S.TICK, "tick")
	eq(D.DAY, S.DAY, "day")
	eq(D.NIGHT_AT, S.NIGHT_AT, "night")
	eq(D.DAYS, S.DAYS, "days")
	eq(D.STAT_MAX, S.STAT_MAX, "stat max")
	eq(D.EAT_ORDER, S.EAT_ORDER, "eat order")
	eq(D.MEATS, S.MEATS, "meats")
	eq(D.RES, S.RES, "materials")
	eq(D.FOOD_ITEMS, S.FOOD_ITEMS, "food items")
	eq(D.ITEMS, S.ITEMS, "items")
	eq(D.TOOLS.keys(), ["axe", "ironAxe", "pick", "shovel", "icePick", "spear"], "tools in order")
	eq(D.TOOLS.ironAxe.cost.keys(), ["stone", "metal"], "cost keys keep their order")
	eq(D.HUT_STAGES.size(), 4, "hut stages")
	eq(D.HUT_STAGES[3].cost, {stone = 30, metal = 6}, "the stove")
	eq(D.UPGRADE_IDS, ["insulation", "cellar", "smokehouse", "annex", "workshop"], "upgrades")
	eq(D.GEAR_IDS, ["coat", "lantern", "sled", "snares"], "gear")
	eq(D.SURVIVOR_IDS, ["hunter", "carpenter", "herbalist", "smith", "child"], "survivors")
	eq(D.TRADES.size(), 10, "trades")
	eq(D.BEAR.days.harsh.size(), 6, "bear days")
	eq(D.FIRE, {burn = 12, cap = 20, radius = 3, warm = 1.2}, "fire")
	var items := WinterData.items()
	eq(items.size(), 11, "item defs")
	ok(items[0] is WinterItemDef and items[0].name == "Дерево", "item def name")
	var pick := WinterData.find(WinterData.recipes(), "pick") as WinterRecipeDef
	ok(pick != null and pick.name == "Кирка" and pick.cost == {wood = 12}, "the pick recipe")
	var ws := WinterData.find(WinterData.recipes(), "coat") as WinterRecipeDef
	ok(ws != null and ws.needs == "workshop", "gear needs the workshop")
	var b := WinterData.buildings()
	eq(b.filter(func(d): return d.kind == "palisade").size(), 4, "palisade walls")
	ok(WinterData.balance() is WinterBalance, "balance resource")


func test_translations_cover_the_rules_texts() -> void:
	var f := FileAccess.open("res://data/winter.csv", FileAccess.READ)
	ok(f != null, "winter.csv")
	if f == null:
		return
	var head := f.get_csv_line()
	eq(Array(head), ["keys", "ru", "ro"], "csv header")
	var ro := {}
	while not f.eof_reached():
		var row := f.get_csv_line()
		if row.size() >= 3:
			ro[row[0]] = row[2]
	ok(ro.size() > 200, "the Romanian dictionary (%d)" % ro.size())
	eq(ro.get("Долгая зима"), "Iarna lungă", "the title")
	for t in S.TASK_TEXTS:
		ok(ro.has(t) and ro[t] != "", "hint «%s» has RO" % t)
	for id in S.D.SURVIVOR_IDS:
		ok(ro.has(S.D.SURVIVORS[id].name), "survivor name %s has RO" % id)
	for d in WinterData.recipes():
		ok(ro.has(d.name), "recipe %s has RO" % d.name)


# ── the map, time, weather ──

func test_a_new_winter() -> void:
	var g := S.new_game("normal", 7)
	eq(g.hero.x, S.SPOT.fire.x + 0.5, "hero x by the fire")
	ok(g.tools.axe and not g.tools.pick, "the stone axe only")
	eq(g.stock.wood, 10, "some wood")
	eq(S.day_of(g), 1, "day 1")
	ok(not S.is_night(g), "morning")
	eq(S.status(g), "playing", "playing")
	eq(S.new_game("nope", 1), {}, "bad difficulty")
	var a := S.new_game("normal", 3)
	var b := S.new_game("normal", 3)
	eq(S.to_json(a), S.to_json(b), "a seed gives the same forest")
	ok(S.to_json(S.new_game("normal", 4)) != S.to_json(a), "another seed another forest")
	var near := 0
	for n in a.nodes:
		if n.kind == "tree" and S.hyp(n.x - 27, n.y - 20) < 16:
			near += 1
	ok(near >= 8, "trees near the camp")


func test_days_and_cold() -> void:
	var g := quiet()
	eq(S.time_of_day(g), 0.0, "dawn")
	g.t = S.NIGHT_AT + 1
	ok(S.is_night(g), "night")
	g.t = S.DAY * 5 + 1
	eq(S.day_of(g), 6, "day 6")
	ok(S.is_blizzard(g), "a blizzard on day 6")
	ok(S.base_temp(1) > S.base_temp(12), "colder later")
	eq(S.base_temp(20), -25.0, "the deep cold")
	var day := quiet()
	day.t = S.DAY * 2 + 10
	var night := quiet()
	night.t = S.DAY * 2 + S.NIGHT_AT + 10
	ok(S.temperature(night) < S.temperature(day), "nights are colder")
	var harsh := quiet(1, "harsh")
	harsh.t = day.t
	ok(S.chill(harsh) > S.chill(day), "the harsh winter")


func test_warmth() -> void:
	var g := quiet()
	var out := {x = 10.5, y = 30.5}
	ok(S.warmth_rate(g, out) < 0, "outside")
	var by_fire := {x = S.SPOT.fire.x + 0.5, y = S.SPOT.fire.y + 1.5}
	ok(S.warmth_rate(g, by_fire) > 0, "by the fire on day 1")
	g.t = S.DAY * 19 + S.NIGHT_AT + 5
	ok(S.warmth_rate(g, by_fire) < 0, "the fire loses on deep-cold nights")
	var bed := {x = S.SPOT.bed.x + 0.5, y = S.SPOT.bed.y + 0.5}
	g.hut.stage = 2
	ok(S.warmth_rate(g, bed) > S.warmth_rate(g, out), "a roof")
	g.hut.stage = 4
	g.hut.stove = 5
	eq(S.warmth_rate(g, bed), 2.0, "the stove")


func test_stats() -> void:
	var g := quiet()
	g.fire.fuel = 20
	g.hero.x = 10.5
	g.hero.y = 30.5
	var f0: float = g.hero.food
	sim(g, 10)
	ok(absf(g.hero.food - (f0 - 0.12 * 10)) < 0.05, "food drains")
	g.hero.food = 0
	var h0: float = g.hero.health
	sim(g, 5)
	ok(g.hero.health < h0, "hunger hurts")
	g.hero.food = 80
	g.hero.warmth = 80
	g.hero.energy = 80
	var h1: float = g.hero.health
	sim(g, 5)
	ok(g.hero.health > h1, "health comes back")
	g.hero.health = 0.1
	g.hero.food = 0
	var ev := sim(g, 1)
	eq(S.status(g), "lost", "lost")
	eq(of(ev, "lost").size(), 1, "the lost event")


# ── actions ──

func test_chopping_and_tools() -> void:
	var g := quiet()
	var n = nearest(g, "tree")
	eq(S.interact(g, n.x, n.y), "chop", "chop")
	var ev := settle(g, 30)
	var gathered := of(ev, "gather")
	ok(gathered.size() > 0 and gathered[0].n == 2, "2 wood a blow")
	var r = nearest(g, "rock")
	eq(S.interact(g, r.x, r.y), "tool", "rocks need the pick")
	g.hero.path = null
	g.hero.target = null
	g.hero.x = 27.5
	g.hero.y = 21.5
	g.stock.wood = 5
	eq(S.craft(g, "pick"), "nores", "the pick needs 12 wood")
	g.stock.wood = 30
	eq(S.craft(g, "pick"), "ok", "made at the camp")
	eq(S.craft(g, "pick"), "have", "only once")
	eq(S.craft(g, "nothing"), "bad", "bad tool")
	g.hero.x = 10.5
	eq(S.craft(g, "shovel"), "far", "only in the camp")


func test_fire_and_food() -> void:
	var g := quiet()
	g.fire.fuel = 1
	var ev := sim(g, 13)
	eq(g.fire.fuel, 0.0, "the fire burns out")
	eq(of(ev, "fireOut").size(), 1, "fireOut")
	g.stock.wood = 5
	g.stock.meat = 1
	eq(S.interact(g, S.SPOT.fire.x, S.SPOT.fire.y), "fire", "to the fire")
	ev = settle(g, 30)
	ok(g.fire.fuel > 0 and g.stock.wood < 5, "fed from the stock")
	eq(g.stock.cookedMeat, 3, "the meat roasted (2 at the start + 1)")
	g.hero.food = 50
	eq(S.eat(g), "cookedMeat", "the most filling first")
	g.stock.cookedMeat = 0
	g.stock.berries = 0
	g.stock.meat = 1
	g.hero.food = 50
	var e0: float = g.hero.energy
	eq(S.eat(g), "meat", "raw meat")
	ok(g.hero.energy < e0, "raw meat costs strength")
	g.hero.food = 99
	eq(S.eat(g), "", "full")


func test_walking_drifts_and_ice() -> void:
	var g := quiet()
	ok(not S.walkable(g, 10, 5), "a drift without the shovel")
	ok(not S.walkable(g, 45, 5), "the lake without the ice pick")
	g.tools.shovel = true
	g.tools.icePick = true
	ok(S.walkable(g, 10, 5) and S.walkable(g, 45, 5), "with the tools")
	ok(not S.walkable(g, 44, 8), "never into an ice hole")
	eq(S.path_to(g, g.hero, 44, 8), null, "no path into an ice hole")
	var p = S.path_next_to(g, g.hero, 44, 8)
	ok(p != null and p.size() > 0, "a path to the hole's edge")


func test_keyboard_walking() -> void:
	var g := quiet()
	S.interact(g, 20, 30)
	ok(g.hero.target != null, "an order")
	S.move_dir(g, 1, 0)
	eq(g.hero.target, null, "the keys stop the order")
	var x0: float = g.hero.x
	sim(g, 0.5)
	ok(g.hero.x > x0, "walks right")
	S.move_dir(g, 0, 0)
	eq(g.hero.dir, null, "stops")


func test_hunting_and_torches() -> void:
	var g := quiet()
	g.animals = [{id = 99, kind = "deer", x = 20.5, y = 30.5, hp = 2, tx = 20, ty = 30, cd = 99}]
	eq(S.interact(g, 20, 30), "tool", "deer need the spear")
	g.tools.spear = true
	eq(S.interact(g, 20, 30), "hunt", "with the spear")
	g.stock.wood = 3
	ok(S.place_torch(g, 12, 30), "a torch")
	ok(not S.place_torch(g, 12, 30), "not twice on a tile")
	ok(S.lit(g, 12, 30) and S.lit(g, 13, 31), "a torch lights the ground")
	ok(not S.place_torch(g, 13, 30), "no wood left")


func test_step_bad_dt_and_determinism() -> void:
	var g := quiet()
	S.step(g, -1)
	S.step(g, NAN)
	S.step(g, "x")
	eq(g.t, 0.0, "bad dt does nothing")
	S.step(g, 10)
	ok(absf(g.t - 0.25) < 1e-9, "a long frame is capped")
	var a := S.new_game("normal", 5)
	var b := S.new_game("normal", 5)
	for k in 240:
		S.step(a, 0.25)
	for k in 1200:
		S.step(b, 0.05)
	eq(S.to_json(S.snapshot(a)).length() > 0, true, "snapshot")
	ok(absf(a.t - b.t) < 1e-6 and a.rng == b.rng, "the frame size doesn't change a minute")


# ── buildings, wolves, survivors ──

func test_the_hut_in_parts() -> void:
	var g := quiet()
	g.stock.wood = 25
	eq(S.contribute(g, "hut"), "part", "paid in part")
	eq(g.hut.paid.wood, 25, "paid wood")
	g.stock.wood = 100
	eq(S.contribute(g, "hut"), "done", "walls")
	eq(g.hut.stage, 1, "stage 1")
	rich(g)
	for k in 3:
		S.contribute(g, "hut")
	eq(g.hut.stage, 4, "the stove stands")
	ok(S.stove_on(g), "the stove burns")
	eq(S.contribute(g, "hut"), "built", "nothing left")
	eq(S.contribute(g, "bogus"), "bad", "a bad id")
	eq(S.contribute(g, "palisade:9"), "bad", "a bad wall")
	eq(S.need_of(g, "bunk:0").cost, {wood = 20}, "a bunk's cost")
	g.hero.x = 5.5
	eq(S.contribute(g, "bunk:0"), "far", "only in the camp")


func test_the_palisade_and_wolves() -> void:
	var g := quiet()
	rich(g)
	for i in 4:
		eq(S.contribute(g, "palisade:%d" % i), "done", "wall %d" % i)
	ok(S.palisade_up(g), "the palisade stands")
	g.palisade[1].hp = 40
	eq(S.need_of(g, "palisade:1").cost, {wood = 15}, "a repair costs less")
	g.palisade[1].hp = 100
	g.fire.fuel = 0
	g.hero.x = 27.5
	g.hero.y = 23.5
	var w := wolf(g, 27.5, 28.5)
	var ev := sim(g, 20)
	eq(of(ev, "bite").size(), 0, "no bites inside")
	ok(not S.in_base(floori(w.x), floori(w.y)), "the wolf stays out")
	ok(of(ev, "gnaw").size() > 0 and g.palisade[2].hp < 100, "it gnaws instead")


func test_wolves_at_night() -> void:
	var g := quiet()
	g.t = S.NIGHT_AT - 0.5
	var ev := sim(g, 1)
	eq(of(ev, "howl").size(), 1, "a howl")
	eq(g.wolves.size(), S.wolves_tonight(g), "the pack")
	for w in g.wolves:
		ok(S.hyp(w.x - g.hero.x, w.y - g.hero.y) > 14, "far from people")
	var late := quiet()
	late.t = S.DAY * 20
	var harsh := quiet(1, "harsh")
	harsh.t = S.DAY * 20
	ok(S.wolves_tonight(late) > S.wolves_tonight(g) and S.wolves_tonight(harsh) > S.wolves_tonight(late), "more later and harsh")
	g.t = S.DAY - 0.3
	sim(g, 0.5)
	eq(g.wolves.size(), 0, "gone at dawn")


func test_a_wolf_fight() -> void:
	var g := quiet()
	g.fire.fuel = 0
	g.hero.x = 10.5
	g.hero.y = 30.5
	clear_around(g, 10, 30)
	var w := wolf(g, 11.5, 30.5)
	var ev := []
	var t := 0.0
	while t < 15 and g.wolves.size() > 0:
		S.step(g, 0.25)
		ev.append_array(S.drain(g))
		t += 0.25
	ok(of(ev, "bite").size() >= 1, "bitten")
	ok(of(ev, "wolfDead").size() == 1 or w.flee, "killed or put to flight")


func test_rescues() -> void:
	var g := quiet()
	var hunter: Dictionary = g.survivors[0]
	g.hero.x = hunter.x + 1
	g.hero.y = hunter.y
	eq(S.rescue(g, hunter), "meat", "the hunter wants meat")
	g.stock.meat = 1
	g.stock.cookedMeat = 2
	eq(S.rescue(g, hunter), "ok", "raw and roast count")
	eq(g.stock.meat + g.stock.cookedMeat, 0, "three pieces given")
	eq(hunter.state, "following", "he follows")
	var herb: Dictionary = g.survivors[2]
	g.hero.x = herb.x + 1
	g.hero.y = herb.y
	g.t = S.NIGHT_AT + 1
	eq(S.rescue(g, herb), "night", "the herbalist only by day")
	var child: Dictionary = g.survivors[4]
	g.hero.x = child.x + 1
	g.hero.y = child.y
	eq(S.can_rescue(g, child), "palisade", "the child wants the palisade")
	g.hero.x = 1.5
	eq(S.rescue(g, child), "far", "too far")


func test_survivors_at_home() -> void:
	var g := quiet()
	var c: Dictionary = g.survivors[1]
	c.state = "home"
	c.x = 27.5
	c.y = 22.5
	c.food = 10
	g.stock.berries = 5
	g.fire.fuel = 20
	var w0: float = g.stock.wood
	var f0 := S.food_total(g)
	sim(g, 7)
	ok(S.food_total(g) < f0, "they eat from the stock")
	ok(g.stock.wood > w0, "the carpenter adds wood")
	g.stock = {wood = 0, stone = 0, metal = 0, hide = 0, berries = 0, meat = 0, fish = 0, cookedMeat = 0, cookedFish = 0, smokedMeat = 0, smokedFish = 0}
	c.food = 0
	c.hp = 1
	g.fire.fuel = 0
	var ev := sim(g, 5)
	eq(c.state, "dead", "no food, no warmth: dead")
	eq(of(ev, "died").size(), 1, "died")


func test_the_end_and_stars() -> void:
	var g := quiet()
	g.t = S.DAY * S.DAYS - 0.1
	g.hero.warmth = 100
	g.hero.food = 100
	sim(g, 0.5)
	eq(S.status(g), "won", "spring")
	eq(S.stars(g), 1, "alone: one star")
	for s in g.survivors:
		s.state = "home"
	eq(S.stars(g), 2, "five but the hut unfinished")
	g.hut.stage = 4
	eq(S.stars(g), 3, "all five and the hut")
	var save := S.new_save()
	ok(S.record_game(save, g), "a record")
	eq(save.best.normal, 31, "the winter lived")
	eq(save.stars.normal, 3, "stars")
	ok(save.unlocked, "the harsh winter unlocked")
	ok(not S.record_game(save, g), "no better twice")


func test_hints() -> void:
	var g := quiet()
	ok(S.TASK_TEXTS.has(S.next_task(g)), "a known hint")
	eq(S.next_task(g), "Почини хижину: стены", "first the walls")
	g.hero.health = 10
	eq(S.next_task(g), "Ты слабеешь: согрейся, поешь и отдохни", "weak")
	g.hero.health = 100
	g.fire.fuel = 1
	eq(S.next_task(g), "Подкинь дров в костёр", "the fire")
	g.fire.fuel = 20
	rich(g)
	for k in 4:
		S.contribute(g, "hut")
	g.tools.pick = true
	rich(g)
	for i in 4:
		S.contribute(g, "palisade:%d" % i)
	g.tools.shovel = true
	eq(S.next_task(g), "Спаси выжившего: Охотник", "a rescue, with the name")


# ── events, upgrades, bear, trader ──

func test_events_of_the_day() -> void:
	var seen := {}
	for seed in range(1, 16):
		var g := quiet(seed)
		var last = null
		for day in range(2, 30):
			g.t = S.DAY * (day - 1) - 0.05
			g.event = null
			var ev := sim(g, 0.1)
			if g.event != null:
				seen[g.event.id] = true
				ok(g.event.id != last, "never twice in a row")
				last = g.event.id
			for e in of(ev, "event"):
				ok(S.D.EVENT_IDS.has(e.id), "a known event")
		for id in g.eventsSeen:
			ok(g.eventsSeen[id] <= S.D.EVENT_MAX[id], "%s at most %d times" % [id, S.D.EVENT_MAX[id]])
	ok(seen.has("wanderer") and seen.has("aurora") and seen.has("thaw"), "events happen: %s" % str(seen.keys()))


func test_the_roof_event() -> void:
	var g := quiet()
	g.hut.stage = 3
	g.t = S.DAY * 6 + 1   # day 7 is no blizzard; ask directly
	g.event = {id = "roof", phase = "ask", day = 7}
	eq(S.answer_event(g, "bogus"), "bad", "a bad choice")
	g.stock.wood = 0
	eq(S.answer_event(g, "fix"), "nores", "no wood for the fix")
	eq(S.answer_event(g, "later"), "ok", "later")
	ok(g.hut.roofHole, "a hole in the roof")
	eq(S.answer_event(g, "later"), "none", "nothing asks now")
	g.hut.stage = 4
	g.hut.stove = 10
	var bed := {x = S.SPOT.bed.x + 0.5, y = S.SPOT.bed.y + 0.5}
	g.hut.stove = 0
	var with_hole := S.warmth_rate(g, bed)
	g.hut.roofHole = false
	ok(S.warmth_rate(g, bed) > with_hole, "the hole lets the cold in")
	g.hut.roofHole = true
	rich(g)
	eq(S.contribute(g, "patch"), "done", "patched")
	ok(not g.hut.roofHole, "no hole")


func test_the_wanderer() -> void:
	var g := quiet()
	g.event = {id = "wanderer", phase = "active", x = 20, y = 30, day = 2}
	g.t = S.DAY + 1
	eq(S.interact(g, 20, 30), "wanderer", "a tap walks to him")
	g.event.phase = "ask"
	g.stock.cookedMeat = 0
	g.stock.fish = 0
	eq(S.answer_event(g, "help"), "nores", "no food to give")
	g.stock.cookedMeat = 2
	eq(S.answer_event(g, "help"), "ok", "helped")
	var ev := S.drain(g)
	ok(of(ev, "eventDone")[0].has("reward"), "a gift")


func test_upgrades() -> void:
	var g := quiet()
	rich(g)
	eq(S.contribute(g, "up:cellar"), "locked", "locked before the stove")
	eq(S.contribute(g, "up:nothing"), "bad", "a bad upgrade")
	for k in 4:
		S.contribute(g, "hut")
	rich(g)
	eq(S.contribute(g, "up:cellar"), "done", "the cellar")
	eq(S.food_cap(g), 250.0, "more room for food")
	eq(S.contribute(g, "up:cellar"), "built", "once")
	eq(S.craft(g, "coat"), "locked", "gear needs the workshop")
	g.stock.hide = 4
	rich(g)
	eq(S.contribute(g, "up:workshop"), "done", "the workshop")
	g.stock.hide = 6
	eq(S.craft(g, "coat"), "ok", "the coat")
	g.stock.wood = 50
	eq(S.craft(g, "snares"), "ok", "snares")
	eq(g.gear.snares, 2, "two at a time")
	g.hero.x = 15.5
	g.hero.y = 30.5
	clear_around(g, 15, 30)
	g.tiles[S.idx(16, 30)] = "."
	eq(S.place_snare(g, 16, 30), "ok", "a snare outside the camp")
	eq(S.place_snare(g, 25, 20), "base", "not in the camp")
	eq(S.place_snare(g, 30, 30), "far", "next to the hero")


func test_the_smokehouse() -> void:
	var g := quiet()
	g.hut.stage = 4
	g.upgrades.smokehouse.built = true
	g.stock.meat = 2
	g.stock.wood = 5
	var ev := sim(g, 31)
	eq(of(ev, "smoked").size(), 2, "two smoked")
	eq(g.stock.smokedMeat, 2, "smoked meat")
	eq(g.stock.wood, 4, "one log for three pieces")


func test_the_bear() -> void:
	var g := quiet()
	var day: int = S.D.BEAR.days.normal[0]
	g.t = S.DAY * (day - 1) - 0.05
	var ev := sim(g, 0.25)
	ok(g.bear != null, "the bear comes on his day")
	ok(S.hyp(floori(g.bear.x) - 27, floori(g.bear.y) - 20) >= 18, "far from the camp")
	g.hero.x = g.bear.x + 1
	g.hero.y = g.bear.y
	g.hero.health = 100
	g.bear.cd = 0
	g.bear.calm = 0
	ev = sim(g, 0.5)
	if of(ev, "bite").size():
		ok(g.hero.health < 90, "a hard bite")
	g.bear.hp = 1
	g.tools.spear = true
	S.interact(g, g.bear.x, g.bear.y)
	ev = sim(g, 3)
	if g.bear == null:
		ok(of(ev, "bearDead").size() == 1, "killed: meat and hides")
	g.t = S.DAY * day + S.NIGHT_AT - 0.05
	g.bear = {id = 1, x = 5.5, y = 30.5, hp = 10, cd = 0, calm = 0, path = null, plan = 0, chase = false}
	sim(g, 0.25)
	eq(g.bear, null, "he leaves at nightfall")


func test_the_trader() -> void:
	var g := quiet()
	var day: int = S.D.TRADER_DAYS.normal[0]
	g.t = S.DAY * (day - 1) - 0.05
	sim(g, 0.25)
	ok(g.trader != null, "the trader on his day")
	eq(g.trader.offers.size(), 4, "three offers and a fixed one")
	g.hero.x = 10.5
	eq(S.trade(g, 3), "far", "next to the sled")
	g.hero.x = 27.5
	g.hero.y = 25.5
	g.stock.hide = 3
	eq(S.trade(g, 3), "ok", "hides for metal")
	eq(g.stock.metal, 5, "metal")
	eq(S.trade(g, 3), "taken", "once")
	eq(S.trade(g, 9), "bad", "a bad offer")
	eq(S.trade(g, 1.5), "bad", "not a number")
	eq(S.interact(g, S.SPOT.trader.x, S.SPOT.trader.y), "trader", "a tap on the sled")
	g.t = S.DAY * (day - 1) + S.NIGHT_AT - 0.05
	sim(g, 0.25)
	eq(g.trader, null, "gone at night")


# ── saves ──

func test_snapshot_round_trip() -> void:
	var g := S.new_game("normal", 9)
	for k in 400:
		S.step(g, 0.25)
	# a rock mined out: regrowAt is "never"
	var r = nearest(g, "rock")
	r.amount = 0
	r.regrowAt = INF
	var text := S.to_json(S.snapshot(g))
	ok(not text.contains("inf"), "no inf in the JSON")
	var back = S.restore(JSON.parse_string(text))
	ok(back != null, "restores")
	if back == null:
		return
	ok(JSON.parse_string(S.to_json(S.snapshot(back))) == JSON.parse_string(text), "the same snapshot again")
	ok(is_inf(back.nodes[int(r.id)].regrowAt), "a mined rock never regrows after a reload (the core.js fix)")
	for k in 200:
		S.step(g, 0.25)
		S.step(back, 0.25)
	eq(back.rng, g.rng, "a restored winter goes on the same way")
	ok(absf(back.hero.x - g.hero.x) < 1e-9 and back.t == g.t, "same hero, same time")
	eq(S.restore(null), null, "null")
	eq(S.restore({}), null, "empty")
	var bad: Dictionary = JSON.parse_string(text)
	bad.hero.warmth = 500
	eq(S.restore(bad), null, "a stat out of range")
	bad = JSON.parse_string(text)
	bad.tiles = bad.tiles.slice(0, 10)
	eq(S.restore(bad), null, "a short map")
	bad = JSON.parse_string(text)
	bad.status = "won"
	eq(S.restore(bad), null, "a finished winter")


func test_old_snapshot_migrates() -> void:
	var g := S.new_game("normal", 2)
	var o: Dictionary = JSON.parse_string(S.to_json(S.snapshot(g)))
	for k in ["erng", "upgrades", "gear", "snares", "event", "lastEvent", "eventsSeen", "iceDay", "trader", "bear"]:
		o.erase(k)
	o.stock.erase("hide")
	o.hut.erase("roofHole")
	var back = S.restore(o)
	ok(back != null, "an old save restores")
	if back != null:
		eq(back.erng, S.erng_of(2), "the second stream from the seed")
		eq(back.stock.hide, 0, "hides")
		S.step(back, 1)
		eq(back.status, "playing", "and plays on")


func test_the_save_file() -> void:
	var save := S.parse_save("")
	eq(save, S.new_save(), "empty")
	eq(S.parse_save("{broken"), S.new_save(), "broken JSON")
	eq(S.parse_save(null), S.new_save(), "nothing")
	var g := S.new_game("harsh", 4)
	save.current = S.snapshot(g)
	save.dawn = S.snapshot(g)
	save.best.normal = 12
	save.stars.harsh = 2
	save.unlocked = true
	var back := S.parse_save(S.save_text(save))
	eq(back.best.normal, 12, "best")
	eq(back.stars.harsh, 2, "stars")
	ok(back.unlocked, "unlocked")
	ok(back.current != null and back.dawn != null, "the winter and its dawn")
	ok(S.retry_day(back) != null, "«Начать день заново»")
	var d: Dictionary = JSON.parse_string(S.save_text(save))
	d.best.normal = 99
	d.stars.harsh = 7
	d.current.hero.health = -5
	var x := S.parse_save(JSON.stringify(d))
	eq(x.best.normal, 0, "a bad record is dropped")
	eq(x.stars.harsh, 0, "bad stars dropped")
	eq(x.current, null, "a broken winter is dropped")
	eq(x.dawn, null, "and its dawn")


func test_web_save_loads() -> void:
	# a save written by the web version (core.js snapshot JSON shape) loads in the port
	var g := S.new_game("normal", 11)
	var text := S.save_text({v = 1, best = {normal = 3, harsh = 0}, stars = {normal = 0, harsh = 0}, unlocked = false, current = S.snapshot(g), dawn = null})
	var s := S.parse_save(text)
	ok(s.current != null and S.restore(s.current) != null, "restores")


# ── view helpers ──

func test_view_math() -> void:
	var g := quiet()
	eq(V.clock(g), "06:00", "dawn at six")
	g.t = S.NIGHT_AT / 2.0
	eq(V.clock(g), "14:00", "midday at two")
	g.t = S.NIGHT_AT
	eq(V.clock(g), "22:00", "night at ten")
	g.t = S.DAY - 0.001
	eq(V.clock(g), "05:59", "almost dawn")
	g.t = 10
	eq(V.darkness(g), 0.0, "light by day")
	g.t = S.NIGHT_AT + 20
	eq(V.darkness(g), 0.82, "dark at night")
	g.t = S.NIGHT_AT - 5
	ok(absf(V.darkness(g) - 0.41) < 1e-9, "dusk")
	eq(V.aurora(g), 0.0, "no aurora")
	g.event = {id = "aurora", phase = "active", day = 1}
	g.t = S.NIGHT_AT + 20
	eq(V.aurora(g), 1.0, "aurora")
	var l: Array = V.lights(g)
	eq(l.size(), 1, "the fire")
	eq(l[0].kind, "fire", "kind")
	g.gear.lantern = true
	eq(V.lights(g).size(), 2, "the lantern at night")
	eq(V.edge_marker(100, 100, 50, 50), null, "on screen")
	var m = V.edge_marker(100, 100, 300, 50)
	ok(m != null and absf(m.x - 86) < 1e-9 and absf(m.y - 50) < 1e-9 and m.angle == 0.0, "on the right edge")
