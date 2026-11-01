extends SceneTree
## Rules, bosses, data and saves of Последняя крепость on Godot, headless:
##   godot --headless --path godot/castle -s res://tests/run.gd
## (the campaign balance is tests/balance.gd, the scenes tests/scenes.gd).

var failed := 0
var passed := 0
var current := ""


func ok(cond: bool, what: String) -> void:
	if cond:
		passed += 1
	else:
		failed += 1
		printerr("FAIL [%s] %s" % [current, what])


func _initialize() -> void:
	for m in get_method_list():
		if m.name.begins_with("test_"):
			current = m.name
			call(m.name)
	print("%d passed, %d failed" % [passed, failed])
	quit(1 if failed else 0)


## A level with nobody spawning, for setting scenes up by hand.
func blank(n := 1) -> CastleSim:
	var s := CastleSim.new_level(n)
	s.status = "wave"
	s.slots = CastleSim.SLOT_X.size()
	s.unlocked = 20
	s.queue = []
	s.prep_left = 0
	s.offer = []
	return s


func run_for(s: CastleSim, seconds: float, until := Callable()) -> Array:
	var ev := []
	for k in int(seconds * 60):
		s.tick()
		ev.append_array(s.drain())
		if until.is_valid() and until.call():
			break
	return ev


func types(ev: Array) -> Array:
	return ev.map(func(e): return e.type)


func put(s: CastleSim, kind: String, x: float, opts := {}) -> CastleSim.Enemy:
	opts.x = x
	opts.hp_mul = 1.0
	opts.speed_mul = 1.0
	var e := s.spawn(kind, opts)
	s.drain()
	return e


func defend(s: CastleSim, slot: int, type: String) -> CastleSim.Defense:
	var st := s.status
	s.status = "between"
	s.gold += 1000
	var r := s.place(slot, type)
	s.status = st
	ok(r == "ok", "placing %s in slot %d: %s" % [type, slot, r])
	return s.defense_at(slot)


## ── Data ──

func test_campaign_data() -> void:
	var levels := CastleContent.levels()
	ok(levels.size() >= 20, "at least 20 levels")
	var bosses := []
	for i in levels.size():
		var l: Dictionary = levels[i]
		ok(int(l.n) == i + 1, "levels numbered in order")
		ok(l.waves.size() >= 3, "level %d has at least 3 waves" % l.n)
		ok(CastleContent.region_of(int(l.n)).id == l.region, "level %d's region exists" % l.n)
		for w in l.waves:
			var def := CastleContent.level_wave(w)
			ok(def.spawns.size() > 0, "level %d: no empty wave" % l.n)
			for sp in def.spawns:
				ok(CastleContent.enemies().has(sp.kind) or CastleContent.is_boss(sp.kind), "level %d: kind %s exists" % [l.n, sp.kind])
			if w.has("boss"):
				bosses.append([int(l.n), CastleContent.parse_group(w.boss).kind])
				ok(w == l.waves[-1], "level %d: the boss comes in the last wave" % l.n)
	ok(bosses == [[4, "iron_warlord"], [8, "siege_titan"], [12, "fire_dragon"], [16, "shadow_beast"], [20, "dark_king"]], "the five bosses end the five regions: %s" % [bosses])
	var regions := CastleContent.regions()
	ok(regions.size() == 5, "five regions")
	ok(regions.map(func(r): return r.levels.map(func(v): return int(v))) == [[1, 4], [5, 8], [9, 12], [13, 16], [17, 20]], "regions span four levels each")


func test_enemies_unlock_progressively() -> void:
	var first := {}
	for l in CastleContent.levels():
		for w in l.waves:
			for sp in CastleContent.level_wave(w).spawns:
				if not first.has(sp.kind):
					first[sp.kind] = int(l.n)
	ok(first.footman == 1, "footmen from the first level")
	ok(first.size() == CastleContent.enemies().size() + CastleContent.bosses().size(), "every enemy and boss appears: %s" % [first.keys()])
	var at_one := first.keys().filter(func(k): return first[k] == 1)
	ok(at_one == ["footman"], "the first level only has footmen")
	ok(first.scout <= 4 and first.shield <= 4, "scouts and shield bearers in the first region")
	for k in ["knight", "ram", "archer"]:
		ok(first[k] >= 5 and first[k] <= 8, "%s in the frozen pass" % k)


func test_group_syntax() -> void:
	var g := CastleContent.parse_group("knight*3@4/2.5")
	ok(g.kind == "knight" and g.count == 3 and is_equal_approx(g.at, 4.0) and is_equal_approx(g.gap, 2.5), "group parsed")
	var w := CastleContent.level_wave({groups = ["footman*2@1/1"], boss = "iron_warlord@0.5"})
	ok(w.spawns.map(func(s): return s.kind) == ["iron_warlord", "footman", "footman"], "spawns sorted by time")


func test_endless_generator() -> void:
	ok(CastleContent.endless_wave(1, 3).spawns.size() == 6, "wave 1 teaches with six footmen")
	var w10 := CastleContent.endless_wave(10, 3)
	ok(w10.spawns.any(func(s): return s.kind == "iron_warlord"), "the 10th endless wave brings a boss")
	ok(CastleContent.endless_wave(20, 3).spawns.any(func(s): return s.kind == "siege_titan"), "the 20th the second boss")
	ok(JSON.stringify(CastleContent.endless_wave(17, 5)) == JSON.stringify(CastleContent.endless_wave(17, 5)), "deterministic")
	var w60 := CastleContent.endless_wave(60, 3)
	ok(w60.spawns.size() <= CastleContent.MAX_ENEMIES + 1 and w60.hp_mul > 1.0, "a capped wave gets tougher instead")
	var s := CastleSim.new_endless({}, 9, 4)
	ok(s.start_wave() and s.waves_total == 0, "endless runs have no last wave")


## ── The original rules ──

func test_parabola() -> void:
	var s := blank()
	var p := s.flight(0.5, 1.0, 1.0)
	var v := CastleSim.V_BASE
	ok(absf(p.x - (CastleSim.ARCHER.x + cos(0.5) * v)) < 1e-4 and absf(p.y - (CastleSim.ARCHER.y + sin(0.5) * v - CastleSim.G / 2.0)) < 1e-4, "the flight is a parabola")
	s.aim(5.0, 3.0)
	ok(is_equal_approx(s.aim_angle, CastleSim.ANGLE_MAX) and is_equal_approx(s.aim_power, 1.0), "aim is clamped")


func test_arrow_hits_and_kills() -> void:
	var s := blank()
	var e := put(s, "footman", 20.0)
	e.base_speed = 0.0
	var ev := []
	for k in 6:
		s.arrows.clear()
		var ar := CastleSim.Arrow.new()
		ar.x = 15.0
		ar.y = 1.0
		ar.vx = 20.0
		ar.damage = 1.0
		s.arrows.append(ar)
		ev.append_array(run_for(s, 0.5))
	ok(types(ev).has("hit") and types(ev).has("kill"), "arrows hit and kill")
	ok(s.kills == 1 and s.gold > 0, "a kill pays")


func test_shield_front_and_cover() -> void:
	var s := blank()
	var sh := put(s, "shield", 20.0)
	var buddy := put(s, "footman", 21.5)
	var flat := CastleSim.Arrow.new()
	flat.vx = 20.0
	flat.vy = -1.0
	flat.damage = 1.0
	s._arrow_hit(flat, sh)
	ok(is_equal_approx(sh.max_hp - sh.hp, CastleSim.SHIELD_FACTOR), "a flat shot on a shield does a quarter")
	s._arrow_hit(flat, buddy)
	ok(is_equal_approx(buddy.max_hp - buddy.hp, 0.5), "the ally right behind a shield gets half cover")
	var steep := CastleSim.Arrow.new()
	steep.vx = 5.0
	steep.vy = -20.0
	steep.damage = 1.0
	var before := sh.hp
	s._arrow_hit(steep, sh)
	ok(is_equal_approx(before - sh.hp, 1.0), "a plunging shot ignores the shield")


func test_armor_and_broadheads() -> void:
	var s := blank()
	var k := put(s, "knight", 30.0)
	s.damage(k, 1.0, "arrow")
	ok(is_equal_approx(k.max_hp - k.hp, 0.6), "a knight's armour takes 40%")
	var s2 := CastleSim.new_level(1, {broadhead = 2})
	s2.status = "wave"
	var k2 := put(s2, "knight", 30.0)
	s2.damage(k2, 1.0, "arrow")
	ok(is_equal_approx(k2.max_hp - k2.hp, 0.76), "broadheads cut armour by 8 points each")
	s.damage(k, 1.0, "fire", 0.0)
	ok(is_equal_approx(k.max_hp - k.hp, 1.6), "fire ignores armour")


func test_ward_downs_a_flyer() -> void:
	var s := blank()
	s.ward = 1
	put(s, "flyer", 6.0)
	put(s, "flyer", 7.5)
	var ev := run_for(s, 4.0)
	ok(types(ev).count("ward") == 1 and s.ward == 0, "the ward downs exactly one flyer")
	ok(s.wall_hp < s.wall_max, "the second flyer hits the wall")


func test_ram_hits_the_gate_hard() -> void:
	var s := blank(1)
	var r := put(s, "ram", CastleSim.WALL_X + 1.3)
	var f := put(s, "footman", CastleSim.WALL_X + 0.4)
	var ev := run_for(s, 10.0)
	var by_ram := 0.0
	var by_foot := 0.0
	for e in ev:
		if e.type == "wall_hit":
			if e.id == r.id: by_ram += e.amount
			if e.id == f.id: by_foot += e.amount
	ok(by_foot > 0.0 and by_ram >= by_foot * 3.5, "a ram hits the wall about four times harder (%.1f vs %.1f)" % [by_ram, by_foot])


func test_waves_and_cards() -> void:
	var s := CastleSim.new_level(1)
	ok(s.offer.is_empty() and s.prep_left == 0, "level 1 has no preparation")
	ok(s.start_wave() and s.status == "wave", "a wave starts")
	s.queue = []
	s.enemies.clear()
	s.tick()
	ok(s.status == "between" and s.offer.size() == 3, "a cleared wave offers three cards")
	var gold := s.gold
	ok(gold >= CastleSim.NO_DAMAGE_BONUS + 1, "an untouched wall pays a bonus")
	ok(s.choose_card(s.offer[0]) and not s.choose_card(s.offer[1]), "one card per break")
	var s9 := CastleSim.new_level(9)
	var picks := 0
	while s9.prep_left > 0 and s9.choose_card(s9.offer[0]):
		picks += 1
	ok(picks == int(CastleContent.level(9).prep) and s9.offer.is_empty(), "preparation picks before the first wave")
	s.wall_hp = 50.0
	ok(s.buy("repair") == "ok" and s.wall_hp == 75.0, "repair +25%")


func test_level_is_won_after_its_waves() -> void:
	var s := CastleSim.new_level(1)
	for w in s.waves_total:
		s.start_wave()
		s.queue = []
		s.tick()
	ok(s.status == "won" and s.stars() == 3, "the last wave wins the level with three stars")
	var lost := CastleSim.new_level(1)
	lost.start_wave()
	lost.wall_hp = 0.5
	lost.queue = []
	put(lost, "ram", CastleSim.WALL_X + 1.3)
	run_for(lost, 3.0)
	ok(lost.status == "lost", "the wall falling loses it")


## ── New enemies ──

func test_scout_is_fast_and_berserker_rages() -> void:
	var s := blank(1)
	var sc := put(s, "scout", 50.0)
	var ft := put(s, "footman", 50.0)
	run_for(s, 2.0)
	ok(50.0 - sc.x > (50.0 - ft.x) * 1.7, "scouts outrun footmen")
	var b := put(s, "berserker", 40.0)
	var x0 := b.x
	run_for(s, 1.0)
	var calm := x0 - b.x
	b.hp = b.max_hp * 0.4
	x0 = b.x
	var ev := run_for(s, 1.0)
	ok(types(ev).has("rage") and x0 - b.x > calm * 1.6, "a wounded berserker rages and runs faster")
	ok(s.damage_mul(b) > 1.4, "and hits harder")


func test_commander_aura() -> void:
	var s := blank(1)
	var lone := put(s, "footman", 50.0)
	var s2 := blank(1)
	var near := put(s2, "footman", 50.0)
	put(s2, "commander", 52.0)
	run_for(s, 2.0)
	run_for(s2, 2.0)
	ok(50.0 - near.x > (50.0 - lone.x) * 1.2, "a commander speeds up the ranks near him")
	ok(near.buffed and s2.damage_mul(near) > 1.2, "and makes them hit harder")


func test_archer_shoots_from_range() -> void:
	var s := blank(1)
	var a := put(s, "archer", 30.0)
	run_for(s, 20.0)
	ok(a.x >= CastleSim.WALL_X + a.reach - 0.1, "an archer stops at its range (x %.1f)" % a.x)
	ok(s.wall_hp < s.wall_max, "and wears the wall down from there")
	var b := defend(s, 2, "barricade")
	var hp := b.hp
	run_for(s, 6.0)
	ok(b.hp < hp, "archers shoot at defences in reach first")


func test_golem_breaks_barricades() -> void:
	var s := blank(5)
	var d := defend(s, 2, "barricade")
	var g := put(s, "golem", d.x + 3.0)
	var f := put(s, "footman", d.x + 3.0)
	run_for(s, 4.0)
	ok(f.x >= d.x + d.half and g.x >= d.x + d.half, "a barricade stops ground enemies")
	run_for(s, 40.0, func(): return d.dead)
	ok(d.dead, "a golem smashes it")
	run_for(s, 40.0, func(): return f.attacking and f.target == null)
	ok(f.x <= CastleSim.WALL_X + f.w, "then the footman walks on to the wall: nobody gets stuck")


## ── Defences ──

func test_stakes() -> void:
	var s := blank(2)
	var st := defend(s, 2, "stakes")
	var e := put(s, "footman", st.x + 3.0)
	var free := blank(2)
	var e2 := put(free, "footman", st.x + 3.0)
	var ev := run_for(s, 4.5)
	run_for(free, 4.5)
	ok(types(ev).has("stake_hit") and e.hp < e.max_hp, "crossing stakes cuts a footman")
	ok(e.x > e2.x + 1.0, "and slows it (%.1f vs %.1f)" % [e.x, e2.x])
	ok(st.hp < st.max_hp, "the stakes wear out")
	var fl := put(s, "flyer", st.x + 2.0, {alt = 6.0})
	var hp := fl.hp
	run_for(s, 2.0)
	ok(fl.hp == hp, "flyers pass over stakes")
	var s2 := blank(9)
	var st2 := defend(s2, 2, "stakes")
	for k in 3:
		put(s2, "golem", st2.x + 2.0 + k * 2.5)
	run_for(s2, 30.0, func(): return st2.dead)
	ok(st2.dead, "heavy feet trample stakes to splinters")


func test_stakes_never_stop_anyone() -> void:
	var s := blank(2)
	for slot in 5:
		defend(s, slot, "stakes")
	var e := put(s, "knight", 30.0)
	run_for(s, 120.0, func(): return e.attacking)
	ok(e.attacking and e.target == null, "a knight crosses five rows of stakes and reaches the wall")


func test_placement_rules() -> void:
	var s := CastleSim.new_level(3)
	ok(s.slots == 3, "level 3 opens three slots")
	ok(s.can_place(0, "tower") == "locked", "towers are locked until level 7")
	ok(s.can_place(5, "stakes") == "noslot", "no slot past the open ones")
	s.gold = 10
	ok(s.can_place(0, "stakes") == "nogold", "stakes cost gold")
	s.gold = 100
	ok(s.place(0, "stakes") == "ok" and s.gold == 80, "placing pays the price")
	ok(s.can_place(0, "barricade") == "occupied", "one structure per slot")
	s.start_wave()
	ok(s.can_place(1, "stakes") == "closed", "nothing is built during a wave")
	var s1 := CastleSim.new_level(1)
	ok(s1.slots == 0, "the first level has no defences")
	var meta := CastleSim.new_level(3, {slots = 2})
	ok(meta.slots == 5, "surveyors open more slots")


func test_fix_and_demolish() -> void:
	var s := CastleSim.new_level(5)
	s.gold = 200
	s.place(1, "barricade")
	var d := s.defense_at(1)
	d.hp = d.max_hp * 0.5
	var p := s.fix_price()
	ok(p > 0 and s.fix_defenses() == "ok" and d.hp == d.max_hp and s.gold == 200 - 30 - p, "mending defences costs gold")
	ok(s.demolish(1) and s.defense_at(1) == null and s.gold == 200 - 30 - p + 15, "taking one down returns half")


func test_tower_prefers_flyers() -> void:
	var s := blank(9)
	var tw := defend(s, 2, "tower")
	var g := put(s, "footman", tw.x + 2.0)
	g.base_speed = 0.0
	var f := put(s, "flyer", tw.x + 10.0, {alt = 7.0})
	f.base_speed = 0.0
	var ev := run_for(s, 1.5)
	var shots := ev.filter(func(e): return e.type == "tower_shot")
	ok(not shots.is_empty() and shots[0].id == f.id, "towers shoot flyers first")


func test_oil_trap() -> void:
	var s := blank(9)
	var o := defend(s, 2, "oil")
	var e := put(s, "knight", o.x + 2.0)
	var ev := run_for(s, 6.0)
	ok(types(ev).has("oil") and not o.armed, "a ground enemy sets the oil off")
	ok(e.hp < e.max_hp * 0.7 or e.dead, "the burning patch hurts it")
	s.status = "between"
	s.start_wave()
	ok(o.armed, "the trap re-arms for the next wave")


## ── Bosses ──

func test_warlord_charge_and_phases() -> void:
	var s := blank(4)
	var b := put(s, "iron_warlord", 40.0)
	var ev := run_for(s, 20.0, func(): return b.state == "stun")
	var t := types(ev)
	ok(t.has("telegraph") and t.find("telegraph") < t.find("charge"), "the charge is announced first")
	ok(b.state == "stun" and b.vulnerable > 2.5, "a charge into open ground leaves him stunned and open")
	var hp := b.hp
	s.damage(b, 10.0, "arrow")
	ok(is_equal_approx(hp - b.hp, 10.0 * b.vuln_mult), "while open he takes extra damage and no armour")
	var interval := b.interval
	b.hp = b.max_hp * 0.45
	ev = run_for(s, 0.1)
	ok(types(ev).has("boss_phase") and b.phase == 2 and b.interval < interval, "below half he swings faster")
	# a charge into stakes trips him; into a barricade breaks it
	var s2 := blank(4)
	var st := defend(s2, 3, "stakes")
	var b2 := put(s2, "iron_warlord", st.x + 12.0)
	b2.brain.charge_cd = 0.0
	ev = run_for(s2, 6.0, func(): return b2.state == "stun")
	ok(b2.state == "stun" and ev.any(func(e): return e.type == "stun" and e.why == "stakes"), "stakes trip the charge")
	var s3 := blank(4)
	var bar := defend(s3, 3, "reinforced")
	var b3 := put(s3, "iron_warlord", bar.x + 12.0)
	b3.brain.charge_cd = 0.0
	ev = run_for(s3, 6.0, func(): return types(s3.events).has("impact") or bar.hp < bar.max_hp)
	ok(bar.hp < bar.max_hp * 0.7, "a charge batters a barricade")


func test_titan_slam_exposes_joints() -> void:
	var s := blank(8)
	var d := defend(s, 1, "barricade")
	var t := put(s, "siege_titan", d.x + 8.0)
	t.brain.slam_cd = 0.0
	t.brain.throw_cd = 99.0
	var ev := run_for(s, 0.2)
	ok(types(ev).has("telegraph") and t.state == "tele_slam" and t.vulnerable > 0.0, "the slam is announced and opens its joints")
	ev = run_for(s, 2.0)
	ok(types(ev).has("impact") and (d.dead or d.hp < d.max_hp - 20.0), "the slam batters defences in front")
	var s2 := blank(8)
	var t2 := put(s2, "siege_titan", 40.0)
	t2.brain.throw_cd = 0.0
	ev = run_for(s2, 4.0)
	ok(types(ev).has("throw"), "it hurls boulders from afar")
	var hp := t2.hp
	s2.damage(t2, 10.0, "arrow")
	ok(hp - t2.hp < 4.0, "its armour shrugs off most arrows otherwise")


func test_dragon_flies_breathes_lands() -> void:
	var s := blank(12)
	var d := defend(s, 1, "barricade")
	var dr := put(s, "fire_dragon", 40.0)
	var ev := run_for(s, 6.0)
	ok(dr.y > 5.0 and dr.state == "hover", "the dragon circles high")
	ok(types(ev).has("fireball"), "it spits fireballs")
	dr.brain.breath_cd = 0.0
	ev = run_for(s, 4.5)
	ok(types(ev).has("telegraph") and types(ev).has("impact") and d.hp < d.max_hp, "a long inhale, then breath scorches defences")
	ev = run_for(s, 4.0, func(): return dr.state == "landed")
	ok(dr.state == "landed" and dr.y == 0.0 and dr.vulnerable > 0.0, "then it lands to rest, open")
	run_for(s, 6.0)
	ok(dr.state == "hover" or dr.state == "ascend", "and takes off again")
	ok(not types(ev).has("ward"), "the ward can't touch it")


func test_beast_leaps_and_evades() -> void:
	var s := blank(16)
	var b := put(s, "shadow_beast", 45.0)
	b.brain.leap_cd = 0.0
	b.brain.decide = 0.0
	var ev := run_for(s, 8.0, func(): return types(s.events).has("impact"))
	ok(types(ev).has("leap") or b.state == "leap" or b.state == "crouch", "it leaps")
	var s2 := blank(16)
	var b2 := put(s2, "shadow_beast", 45.0)
	b2.brain.evade_cd = 0.0
	for k in 12:
		s2.damage(b2, 2.0, "arrow")
	ev = run_for(s2, 0.2)
	ok(types(ev).has("evade") and b2.immune > 0.0, "a hail of arrows makes it melt into shadow")
	var hp := b2.hp
	s2.damage(b2, 5.0, "arrow")
	ok(b2.hp == hp, "while in shadow arrows pass through")
	run_for(s2, 2.0)
	b2.hp = b2.max_hp * 0.6
	ev = run_for(s2, 0.1)
	b2.hp = b2.max_hp * 0.3
	ev.append_array(run_for(s2, 0.1))
	ok(b2.phase == 3 and types(ev).count("boss_phase") == 2, "three phases")


func test_dark_king_three_phases_and_victory() -> void:
	var s := blank(20)
	var k := put(s, "dark_king", 50.0)
	k.brain.sum_cd = 0.0
	var ev := run_for(s, 2.0)
	ok(types(ev).has("summon") and s.enemies.size() == 3, "phase 1: he raises knights")
	for e in s.enemies:
		if e != k:
			e.dead = true
	s.enemies = s.enemies.filter(func(e): return not e.dead)
	k.hp = k.max_hp * 0.6
	ev = run_for(s, 2.5)
	ok(k.phase == 2 and k.x >= 30.0 and types(ev).has("boss_phase"), "phase 2: he withdraws to the back")
	ev.append_array(run_for(s, 3.0))
	ok(k.barrier and types(ev).has("summon"), "and summons a warband that shields him")
	ev = run_for(s, 8.0)
	ok(types(ev).has("telegraph") and types(ev).has("cast"), "curses and dark bolts")
	k.hp = k.max_hp * 0.3
	ev = run_for(s, 0.1)
	ok(k.phase == 3 and k.immune > 2.0 and ev.any(func(e): return e.type == "boss_phase" and e.final), "a clear final phase")
	run_for(s, 3.5)
	ok(k.state == "walk" or k.state == "attack", "then he marches on the wall")
	k.vulnerable = 0.0
	k.immune = 0.0
	k.barrier = false
	s.damage(k, 99999.0, "arrow")
	ev = s.drain()
	ok(types(ev).has("boss_dead") and s.boss_killed == "dark_king", "his death is the victory")


func test_bosses_take_level_toughness_by_half() -> void:
	var s := CastleSim.new_level(20)
	s.status = "wave"
	var k := put(s, "dark_king", 50.0)
	var base := float(CastleContent.bosses().dark_king.hp)
	ok(is_equal_approx(k.max_hp, base * (1.0 + (float(CastleContent.level(20).mods.hp) - 1.0) * 0.5)), "boss hp scales by half the level's")


## ── Progress ──

func test_progress_round_trip() -> void:
	var p := CastleProgress.new()
	var s := CastleSim.new_level(1)
	for w in s.waves_total:
		s.start_wave()
		s.queue = []
		s.tick()
	var r := p.record_level(s)
	ok(r.first and r.opened == 2 and p.treasury == r.gold and r.gold >= 40, "a first win opens the next level and pays the reward")
	var again := p.record_level(s)
	ok(not again.first and again.gold < r.gold, "a replay pays a third")
	p.treasury = 1000
	ok(p.buy_armory("walls") == "ok" and p.armory_level("walls") == 1 and p.treasury == 940, "buying an armory step")
	var q := CastleProgress.parse(p.dump())
	ok(q.opened == 2 and q.treasury == 940 and q.armory_level("walls") == 1 and q.stars["1"] == 3, "the save round-trips")
	var junk := CastleProgress.parse('{"v":1,"opened":999,"stars":{"5":9,"x":1},"treasury":-5,"armory":{"walls":99,"nope":1}}')
	ok(junk.opened == CastleContent.levels().size() and junk.stars.is_empty() and junk.treasury == 0 and junk.armory == {walls = 5}, "a broken save is cleaned")
	ok(CastleProgress.parse("not json").opened == 1, "garbage gives a fresh start")
	var meta := CastleSim.new_level(1, {walls = 2, tax = 1})
	ok(is_equal_approx(meta.wall_max, 130.0) and meta.gold == 45, "the armory changes the next level")


func test_translations_cover_the_data() -> void:
	var f := FileAccess.open("res://data/castle.csv", FileAccess.READ)
	ok(f != null, "castle.csv exists")
	if f == null:
		return
	var keys := {}
	f.get_csv_line()
	while not f.eof_reached():
		var row := f.get_csv_line()
		if row.size() >= 3:
			keys[row[0]] = row[2]
	var need := []
	for l in CastleContent.levels():
		need.append(l.name)
	for r in CastleContent.regions():
		need.append(r.name)
	for c in CastleContent.meta().cards.values() + CastleContent.meta().armory.values():
		need.append(c.name)
		need.append(c.desc)
	for k in need:
		ok(keys.has(k) and keys[k] != "", "Romanian for «%s»" % k)
