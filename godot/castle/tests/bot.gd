extends RefCounted
## A player for the balance tests: aims at the enemy closest to the wall with the ballistic formula (leading
## it by its speed), shoots without pause, takes a card, mends the wall and builds defences between waves.
## opts: noise is the aiming error in degrees (σ); react how often it re-aims (s); lead false aims where the
## enemy is, not where it will be; power_noise shakes the pull (share of the max); random_cards picks cards
## at random; defenses false keeps the slots empty; passive never shoots.

const TICK := CastleSim.TICK
const CARD_ORDER := ["multi", "power", "reload", "pierce", "fire", "velocity", "ward"]
const BUILD := ["stakes", "barricade", "stakes", "tower", "oil", "reinforced"]


static func play(level_n: int, opts := {}) -> Dictionary:
	var s := CastleSim.new_level(level_n, opts.get("meta", {}), int(opts.get("seed", 7)))
	return run(s, opts)


static func run(s: CastleSim, opts := {}) -> Dictionary:
	var noise := float(opts.get("noise", 1.5))
	var rng := RandomNumberGenerator.new()
	rng.seed = int(opts.get("seed", 7)) * 31 + s.level_n
	var max_waves := int(opts.get("max_waves", 1000))
	var events := {}
	var time := 0.0
	var aim_t := 0.0
	while true:
		if s.status == "ready" or s.status == "between":
			if s.wave >= max_waves:
				break
			between(s, opts, rng)
			s.start_wave()
		elif s.status != "wave":
			break
		if not opts.get("passive", false):
			aim_t -= TICK
			if aim_t <= 0.0:
				aim_t = float(opts.get("react", 0.12))
				var a = solve(s, opts.get("lead", true))
				if a != null:
					s.aim(a.x + deg_to_rad(rng.randfn(0.0, noise)), a.y * (1.0 + rng.randf_range(-1.0, 1.0) * float(opts.get("power_noise", 0.0))))
					s.set_firing(true)
				else:
					s.set_firing(false)
		s.tick()
		time += TICK
		for ev in s.drain():
			events[ev.type] = events.get(ev.type, 0) + 1
		if time > 3600.0:
			break
	return {status = s.status, wave = s.wave, wall = s.wall_hp / s.wall_max, gold = s.gold, kills = s.kills, time = time,
		stars = s.stars(), events = events, defenses = s.defenses.size()}


static func between(s: CastleSim, opts: Dictionary, rng: RandomNumberGenerator = null) -> void:
	while not s.offer.is_empty() and (s.prep_left > 0 or (s.status == "between" and not s.picked)):
		var took := false
		if opts.get("random_cards", false) and rng:
			took = s.choose_card(s.offer[rng.randi_range(0, s.offer.size() - 1)])
		for id in ([] if took else CARD_ORDER):
			if s.choose_card(id):
				took = true
				break
		if not took:
			break
	if s.wall_hp < s.wall_max * 0.6:
		s.buy("repair")
	if opts.get("defenses", true):
		if s.fix_price() > 0 and s.fix_price() <= s.gold:
			s.fix_defenses()
		for type in BUILD:
			for slot in s.slots:
				if s.defense_at(slot) == null and s.can_place(slot, type) == "":
					s.place(slot, type)
					break
	while s.wall_hp < s.wall_max * 0.85 and s.buy("repair") == "ok":
		pass


## The enemy to shoot: whatever is closest to the wall (a vulnerable boss first), and the aim that hits it.
static func solve(s: CastleSim, lead := true):
	var best: CastleSim.Enemy = null
	var best_score := INF
	for e in s.enemies:
		if e.dead or e.immune > 0.0 or e.x > CastleSim.SPAWN_X - 2.0:
			continue
		var sc := e.x - (30.0 if e.boss and e.vulnerable > 0.0 else 0.0)
		if sc < best_score:
			best_score = sc
			best = e
	if best == null:
		return null
	var v: float = s.stats().vmax
	var high := best.shield
	var tx := best.x
	var ty := best.y + best.h * 0.5
	var ang := 0.0
	for it in 4:
		var dx := tx - CastleSim.ARCHER.x
		var dy := ty - CastleSim.ARCHER.y
		var g := CastleSim.G
		var disc := v * v * v * v - g * (g * dx * dx + 2.0 * dy * v * v)
		if disc < 0.0 or dx <= 0.2:
			ang = atan2(dy, maxf(dx, 0.2))
			break
		var r := sqrt(disc)
		ang = atan((v * v + (r if high and dx > 8.0 else -r)) / (g * dx))
		if ang > CastleSim.ANGLE_MAX:
			ang = atan((v * v - r) / (g * dx))
		var tf := dx / (v * cos(ang))
		if lead:
			tx = best.x - best.speed * tf
	return Vector2(ang, 1.0)
