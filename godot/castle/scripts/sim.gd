class_name CastleSim
extends RefCounted
## Последняя крепость — the rules of a siege, with no nodes: the same code runs in the game and in the headless
## tests and bots. It is web/castle/core.js carried over (metres and seconds, the ground at y = 0, the wall at
## x ∈ [0, WALL_X], the archer shooting parabolas from ARCHER, fixed 1/60 s ticks, the shield, the ward, the
## between-wave cards and the wall shop) and grown: enemy variants from data/enemies.json, bosses with their own
## brains (boss.gd), defences in slots before the wall (data/defenses.json), area effects and enemy missiles.
## The view reads the state and the events (drain()); it never writes into it.

const TICK := 1.0 / 60.0
const MAX_DT := 0.25
const WALL_X := 3.0
const WALL_TOP := 8.0
const ARCHER := Vector2(2.0, 9.5)
const SPAWN_X := 60.0
const G := 9.8
const V_BASE := 30.0
const MIN_POWER := 0.2
const ANGLE_MIN := -85.0 * PI / 180.0
const ANGLE_MAX := 80.0 * PI / 180.0
const RELOAD_BASE := 0.6
const RELOAD_FLOOR := 0.4
const DAMAGE_BASE := 1.0
const SPREAD := 4.0 * PI / 180.0
const SHIELD_ANGLE := 35.0          # degrees below horizontal: shallower hits on a shield do a quarter
const SHIELD_FACTOR := 0.25
const SHIELD_COVER := 2.4           # the ally up to this far behind a shield bearer gets half its cover
const BURN_TIME := 3.0
const BURN_DPS := 1.0
const WARD_START := 1
const NO_DAMAGE_BONUS := 5
const AURA_RANGE := 5.0
const AURA_SPEED := 1.25
const AURA_DAMAGE := 1.3
const RAGE_AT := 0.5
const SLOT_X := [7.5, 11.0, 14.5, 18.0, 21.5, 25.0]
const PRICE := {repair = [30.0, 1.3], fortify = [50.0, 1.4]}
const REPAIR_SHARE := 0.25
const FORTIFY_SHARE := 0.2
const FIX_PRICE := 0.6              # gold per missing hit point of the defences


class Enemy:
	var id := 0
	var kind := ""
	var boss := false
	var x := 0.0
	var y := 0.0
	var w := 1.0
	var h := 1.0
	var hp := 1.0
	var max_hp := 1.0
	var base_speed := 1.0
	var speed := 0.0                # what it moved at this tick (the view's walk cycle)
	var armor := 0.0
	var damage := 1.0
	var interval := 1.0
	var reach := 0.0
	var gold := 0
	var wall_mult := 1.0
	var structure_mult := 1.0
	var flies := false
	var heavy := false
	var shield := false
	var rage_tag := false
	var aura := false
	var alt := 0.0
	var bob := 0.0
	var dead := false
	var burn := 0.0
	var scorch := 0.0               # standing in fire on the ground (oil, dragon breath): the view shows flames
	var atk_t := 0.0
	var attacking := false
	var target = null               # the Defense it hits, null for the wall
	var stagger := 0.0
	var stake_cd := 0.0
	var last_stakes := 0
	var raging := false
	var buffed := false
	var vulnerable := 0.0
	var vuln_mult := 1.0
	var immune := 0.0
	var barrier := false
	var summoner := 0
	var state := "walk"             # what the view animates: walk, attack, fly, and the bosses' own
	var state_t := 0.0
	var phase := 1
	var brain := {}
	var blows := 0                  # counts swings, so the view can animate each one

	func front() -> float: return x - w * 0.5
	func frac() -> float: return hp / max_hp


class Defense:
	var id := 0
	var type := ""
	var kind := ""
	var cfg := {}
	var slot := 0
	var x := 0.0
	var half := 0.6
	var hp := 1.0
	var max_hp := 1.0
	var armor := 0.0
	var dead := false
	var cd := 0.0
	var armed := true
	var hits := 0                   # counts the blows it took, for the view's shudder


class Arrow:
	var x := 0.0
	var y := 0.0
	var vx := 0.0
	var vy := 0.0
	var damage := 1.0
	var pierce := 0
	var fire := false
	var hits: Array[int] = []


var mode := "level"                 # level | endless
var level_n := 0
var level := {}
var mods := {}
var run_seed := 1
var rng := RandomNumberGenerator.new()
var wave := 0
var waves_total := 0
var status := "ready"               # ready | wave | between | lost | won
var wall_hp := 100.0
var wall_max := 100.0
var gold := 0
var kills := 0
var damage_this_wave := 0.0
var aim_angle := 0.6
var aim_power := 0.7
var firing := false
var cooldown := 0.0
var ward := WARD_START
var up := {power = 0, reload = 0, velocity = 0, pierce = 0, multi = 0, fire = 0, ward = 0}
var bought := {repair = 0, fortify = 0}
var offer: Array = []
var picked := false
var prep_left := 0                  # cards still to pick before the first wave of a level
var meta := {}
var unlocked := 0                   # the campaign level reached: which defences can be built
var slots := 0
var arrows: Array[Arrow] = []
var enemies: Array[Enemy] = []
var defenses: Array[Defense] = []
var shots: Array = []               # enemy missiles {kind, x0, y0, x1, y1, t, dur, target, wall, struct}
var zones: Array = []               # areas on the ground {kind, x0, x1, t, dur, enemy, struct, wall}
var queue: Array = []
var t := 0.0
var acc := 0.0
var next_id := 1
var events: Array = []
var mult := {hp = 1.0, speed = 1.0}
var boss_killed := ""


## ── Runs ──

## A campaign level. meta: the armory levels; unlocked: the highest campaign level open (defences).
static func new_level(n: int, meta_levels := {}, run_seed := 1) -> CastleSim:
	var s := CastleSim.new()
	s.mode = "level"
	s.level_n = n
	s.level = CastleContent.level(n)
	assert(not s.level.is_empty(), "no level %d" % n)
	s.mods = s.level.get("mods", {})
	s.waves_total = s.level.waves.size()
	s.unlocked = n
	s._setup(meta_levels, run_seed, float(s.level.wall), int(s.level.gold), int(s.level.slots))
	s.prep_left = int(s.level.get("prep", 0))
	if s.prep_left > 0:
		s.offer = s._offer_cards()
	return s


## The endless mode: the original generator, wave after wave until the wall falls.
static func new_endless(meta_levels := {}, unlocked_level := 1, run_seed := 1) -> CastleSim:
	var s := CastleSim.new()
	s.mode = "endless"
	s.level_n = 0
	s.unlocked = unlocked_level
	s.waves_total = 0
	s._setup(meta_levels, run_seed, 100.0, 0, 4 if unlocked_level >= 2 else 0)
	return s


func _setup(meta_levels: Dictionary, run_seed: int, wall: float, start_gold: int, level_slots: int) -> void:
	meta = meta_levels.duplicate()
	self.run_seed = run_seed
	rng.seed = run_seed
	wall_max = wall * (1.0 + 0.15 * m("walls"))
	wall_hp = wall_max
	gold = start_gold + 15 * m("tax")
	slots = 0 if level_slots <= 0 else mini(SLOT_X.size(), level_slots + m("slots"))
	ward = stats().ward_max


func m(id: String) -> int:
	return int(meta.get(id, 0))


func mod(id: String, def := 0.0) -> float:
	return float(mods.get(id, def))


## The numbers the cards and the armory give.
func stats() -> Dictionary:
	return {
		damage = DAMAGE_BASE * (1.0 + 0.2 * up.power) * (1.0 + 0.1 * m("bow")),
		reload = maxf(RELOAD_BASE * RELOAD_FLOOR, RELOAD_BASE * (1.0 - 0.12 * up.reload)),
		vmax = V_BASE * (1.0 + 0.1 * up.velocity),
		pierce = up.pierce,
		arrows = 1 + up.multi,
		burn = up.fire > 0,
		ward_max = WARD_START + up.ward,
		armor_pierce = 0.08 * m("broadhead"),
	}


func aim(angle: float, power: float) -> void:
	if is_finite(angle):
		aim_angle = clampf(angle, ANGLE_MIN, ANGLE_MAX)
	if is_finite(power):
		aim_power = clampf(power, MIN_POWER, 1.0)


func set_firing(on: bool) -> void:
	firing = status == "wave" and on


func emit(type: String, data := {}) -> void:
	data.type = type
	events.append(data)


func drain() -> Array:
	var ev := events
	events = []
	return ev


## ── Waves ──

func wave_def(n: int) -> Dictionary:
	if mode == "level":
		return CastleContent.level_wave(level.waves[n - 1])
	return CastleContent.endless_wave(n, run_seed)


func start_wave() -> bool:
	if status != "ready" and status != "between":
		return false
	wave += 1
	status = "wave"
	t = 0.0
	damage_this_wave = 0.0
	ward = stats().ward_max
	cooldown = 0.0
	var def := wave_def(wave)
	mult = {hp = def.hp_mul, speed = def.speed_mul}
	offer = []
	prep_left = 0
	queue = def.spawns.duplicate(true)
	for d in defenses:
		if d.kind == "oil":
			d.armed = true
	emit("wave_start", {wave = wave, kinds = _kinds_in(queue)})
	return true


func _kinds_in(list: Array) -> Array:
	var out := []
	for s in list:
		if not s.kind in out:
			out.append(s.kind)
	return out


## ── Enemies ──

func spawn(kind: String, opts := {}) -> Enemy:
	var c := CastleContent.body(kind)
	var e := Enemy.new()
	e.id = next_id
	next_id += 1
	e.kind = kind
	e.boss = CastleContent.is_boss(kind)
	e.w = c.w
	e.h = c.h
	# a boss takes half the level's toughness: its fight is about patterns, not a longer health bar
	var hp_mod := mod("hp", 1.0)
	if CastleContent.is_boss(kind):
		hp_mod = 1.0 + (hp_mod - 1.0) * 0.5
	var hp := float(c.hp) * hp_mod * float(opts.get("hp_mul", mult.hp))
	if e.boss and mode == "endless":
		hp *= 1.0 + 0.25 * floor((wave - 1) / 10.0)
	e.hp = hp
	e.max_hp = hp
	e.base_speed = float(c.speed) * mod("speed", 1.0) * float(opts.get("speed_mul", mult.speed))
	e.armor = clampf(float(c.armor) + mod("armor"), 0.0, 0.9)
	e.damage = float(c.damage)
	e.interval = float(c.interval)
	e.reach = float(c.get("range", 0))
	e.gold = int(c.gold)
	e.wall_mult = float(c.get("wall_mult", 1))
	e.structure_mult = float(c.get("structure_mult", 1))
	e.vuln_mult = float(c.get("vuln", 1.0))
	var tags: Array = c.get("tags", [])
	e.flies = "flies" in tags or c.get("flies", false)
	e.heavy = "heavy" in tags or e.boss
	e.shield = "shield" in tags
	e.rage_tag = "rage" in tags
	e.aura = "aura" in tags
	e.x = float(opts.get("x", SPAWN_X + e.w * 0.5 + rng.randf() * 0.6))
	e.bob = rng.randf() * TAU
	e.summoner = int(opts.get("summoner", 0))
	if e.flies:
		e.alt = float(opts.get("alt", 6.0 + rng.randf() * 4.0))
		e.y = e.alt
		e.state = "fly"
	if e.boss:
		CastleBoss.init(self, e)
	enemies.append(e)
	if opts.has("summoner"):
		emit("spawned", {id = e.id, kind = kind, x = e.x})
	return e


func boss() -> Enemy:
	for e in enemies:
		if e.boss and not e.dead:
			return e
	return null


## ── Damage ──

## Damage to an enemy: armour (less the broadheads) takes its share times armor_scale; a vulnerable enemy
## has no armour and takes vuln_mult; an immune one takes nothing.
func damage(e: Enemy, amount: float, cause: String, armor_scale := 1.0) -> void:
	if e.dead:
		return
	if e.immune > 0.0:
		emit("immune", {id = e.id, x = e.x, y = e.y + e.h * 0.5})
		return
	var armor := 0.0 if e.vulnerable > 0.0 else maxf(0.0, e.armor - stats().armor_pierce)
	amount *= 1.0 - armor * armor_scale
	if e.vulnerable > 0.0:
		amount *= e.vuln_mult
	if e.barrier:
		amount *= 0.4
	e.hp -= amount
	emit("hit", {id = e.id, amount = amount, cause = cause, x = e.x, y = e.y + e.h * 0.5, weak = e.vulnerable > 0.0, armored = armor > 0.2})
	if e.hp <= 1e-9:
		kill(e)


func kill(e: Enemy) -> void:
	if e.dead:
		return
	e.dead = true
	var g := int(round(e.gold * mod("gold", 1.0) * (1.0 + 0.1 * m("tax"))))
	gold += g
	kills += 1
	emit("kill", {id = e.id, kind = e.kind, x = e.x, y = e.y, gold = g, boss = e.boss})
	if e.boss:
		boss_killed = e.kind
		emit("boss_dead", {id = e.id, kind = e.kind, x = e.x})


func hit_wall(amount: float, src: Enemy) -> void:
	if amount <= 0.0:
		return
	wall_hp = maxf(0.0, wall_hp - amount)
	damage_this_wave += amount
	emit("wall_hit", {id = src.id if src else 0, kind = src.kind if src else "", amount = amount})


func damage_defense(d: Defense, amount: float, cause := "blow") -> void:
	if d.dead or amount <= 0.0:
		return
	amount *= 1.0 - d.armor
	d.hp -= amount
	d.hits += 1
	emit("struct_hit", {did = d.id, amount = amount, cause = cause, x = d.x})
	if d.hp <= 1e-9:
		d.dead = true
		emit("struct_broken", {did = d.id, what = d.type, x = d.x})


## Live defences whose footprint touches [x0, x1].
func defenses_in(x0: float, x1: float) -> Array[Defense]:
	var out: Array[Defense] = []
	for d in defenses:
		if not d.dead and d.x + d.half >= x0 and d.x - d.half <= x1:
			out.append(d)
	return out


## ── Arrows ──

func fire() -> void:
	var st := stats()
	var v := aim_power * float(st.vmax)
	for k in st.arrows:
		var a: float = aim_angle + (k - (st.arrows - 1) / 2.0) * SPREAD
		var ar := Arrow.new()
		ar.x = ARCHER.x
		ar.y = ARCHER.y
		ar.vx = cos(a) * v
		ar.vy = sin(a) * v
		ar.damage = st.damage
		ar.pierce = st.pierce
		ar.fire = st.burn
		arrows.append(ar)
	emit("fire", {n = st.arrows})


## Where along p→q (0..1) the segment first enters the box, or -1.
static func segment_box(px: float, py: float, qx: float, qy: float, x0: float, y0: float, x1: float, y1: float) -> float:
	var t0 := 0.0
	var t1 := 1.0
	for axis in [[px, qx - px, x0, x1], [py, qy - py, y0, y1]]:
		var p: float = axis[0]
		var d: float = axis[1]
		if absf(d) < 1e-12:
			if p < axis[2] or p > axis[3]:
				return -1.0
		else:
			var a: float = (axis[2] - p) / d
			var b: float = (axis[3] - p) / d
			if a > b:
				var tmp := a
				a = b
				b = tmp
			t0 = maxf(t0, a)
			t1 = minf(t1, b)
			if t0 > t1:
				return -1.0
	return t0


static func descent(vx: float, vy: float) -> float:
	return rad_to_deg(atan2(-vy, absf(vx)))


## The cover a shallow arrow meets: the bearer's own shield, or half of it for the ally right behind one.
func _shield_factor(a: Arrow, e: Enemy) -> float:
	if a.vx <= 0.0 or descent(a.vx, a.vy) >= SHIELD_ANGLE:
		return 1.0
	if e.shield:
		return SHIELD_FACTOR
	for s in enemies:
		if s.shield and not s.dead and s != e and e.x > s.x and e.x - s.x <= SHIELD_COVER and not e.flies:
			return 0.5
	return 1.0


func _arrow_hit(a: Arrow, e: Enemy) -> void:
	var amount := a.damage
	var f := _shield_factor(a, e)
	if f < 1.0:
		amount *= f
		emit("shield_hit", {id = e.id, x = e.front(), y = e.y + e.h * 0.5})
	if a.fire:
		e.burn = BURN_TIME
	damage(e, amount, "arrow")


func _step_arrows() -> void:
	var live: Array[Arrow] = []
	for a in arrows:
		var px := a.x
		var py := a.y
		a.vy -= G * TICK
		a.x += a.vx * TICK
		a.y += a.vy * TICK
		var hits := []
		for e in enemies:
			if e.dead or e.immune > 0.0 or a.hits.has(e.id):
				continue
			var tt := segment_box(px, py, a.x, a.y, e.x - e.w * 0.5, e.y, e.x + e.w * 0.5, e.y + e.h)
			if tt >= 0.0:
				hits.append([tt, e])
		hits.sort_custom(func(p, q): return p[0] < q[0])
		var gone := false
		for h in hits:
			var e: Enemy = h[1]
			a.hits.append(e.id)
			_arrow_hit(a, e)
			if a.hits.size() > a.pierce:
				emit("stick", {x = px + (a.x - px) * h[0], y = py + (a.y - py) * h[0], id = e.id})
				gone = true
				break
		if gone:
			continue
		if a.y <= 0.0:
			emit("ground", {x = a.x, vx = a.vx, vy = a.vy})
			continue
		if a.x > SPAWN_X + 20.0 or a.x < -10.0:
			continue
		live.append(a)
	arrows = live


## ── Enemies ──

func _step_enemies() -> void:
	# commanders' aura first, so everyone moves with this tick's buff
	for e in enemies:
		e.buffed = false
	for c in enemies:
		if c.aura and not c.dead:
			for e in enemies:
				if e != c and not e.dead and absf(e.x - c.x) <= AURA_RANGE:
					e.buffed = true
	for e in enemies:
		if e.dead:
			continue
		e.stake_cd = maxf(0.0, e.stake_cd - TICK)
		e.stagger = maxf(0.0, e.stagger - TICK)
		e.vulnerable = maxf(0.0, e.vulnerable - TICK)
		e.immune = maxf(0.0, e.immune - TICK)
		e.scorch = maxf(0.0, e.scorch - TICK)
		e.state_t += TICK
		if e.burn > 0.0:
			e.burn = maxf(0.0, e.burn - TICK)
			damage(e, BURN_DPS * TICK * (1.0 - mod("fire_resist")), "fire", 0.0)
			if e.dead:
				continue
		if e.rage_tag and not e.raging and e.frac() <= RAGE_AT:
			e.raging = true
			emit("rage", {id = e.id})
		if e.boss:
			CastleBoss.tick(self, e)
		elif e.flies:
			_fly(e)
		else:
			ground_step(e)
	enemies = enemies.filter(func(e): return not e.dead)


func speed_mul(e: Enemy) -> float:
	var s := 1.0
	if e.buffed:
		s *= AURA_SPEED
	if e.raging:
		s *= 1.8
	return s


func damage_mul(e: Enemy) -> float:
	var s := 1.0
	if e.buffed:
		s *= AURA_DAMAGE
	if e.raging:
		s *= 1.5
	return s


func _interval(e: Enemy) -> float:
	return e.interval * (0.6 if e.raging else 1.0)


## Where a ground enemy has to stop: the wall, or the nearest barricade in front. → [stop x, Defense or null]
func stop_for(e: Enemy) -> Array:
	var stop := WALL_X + e.w * 0.5
	var block: Defense = null
	for d in defenses:
		if not d.dead and d.kind == "block" and d.x < e.x - 0.01:
			var s := d.x + d.half + e.w * 0.5
			if s > stop:
				stop = s
				block = d
	return [stop, block]


## Stakes under a ground enemy: a slower step, and every `every` seconds a cut for the enemy and wear for the
## stakes (heavy feet wear them much faster). Returns the speed factor.
func _stakes(e: Enemy) -> float:
	var f := 1.0
	for d in defenses:
		if d.dead or d.kind != "stakes" or absf(e.x - d.x) >= d.half + e.w * 0.5:
			continue
		var c := d.cfg
		f = minf(f, float(c.heavy_slow) if e.heavy else float(c.slow))
		if e.last_stakes != d.id:
			e.last_stakes = d.id
			if not e.heavy:
				e.stagger = maxf(e.stagger, float(c.stagger))
		if e.stake_cd <= 0.0:
			e.stake_cd = float(c.every)
			var cut := float(c.damage) * (1.0 + 0.3 * m("stakes"))
			emit("stake_hit", {did = d.id, id = e.id, x = d.x})
			damage(e, cut, "stake", 0.5)
			var wear := float(c.get("wear", 1.0)) + (e.damage * e.structure_mult * 0.5 if e.heavy else 0.0)
			damage_defense(d, wear, "trample")
	return f


## One tick of a ground walker: oil traps, stakes, the stop, the blows. Bosses use it in their walking states.
func ground_step(e: Enemy, speed_factor := 1.0) -> void:
	_oil_check(e)
	var f := _stakes(e)
	var stop_block := stop_for(e)
	var stop: float = stop_block[0]
	var target = stop_block[1]
	var shooting := false
	if e.reach > 0.0:
		var rt = _ranged_target(e)
		if rt != null:
			shooting = true
			target = rt if rt is Defense else null
	var sp := e.base_speed * speed_factor * speed_mul(e) * f
	e.speed = 0.0
	if not shooting and e.x > stop + 1e-6:
		if e.stagger <= 0.0:
			var nx := maxf(stop, e.x - sp * TICK)
			e.speed = (e.x - nx) / TICK
			e.x = nx
		e.attacking = false
		if e.state == "attack":
			e.state = "walk"
		return
	if not e.attacking:
		e.attacking = true
		e.atk_t = _interval(e) * 0.5
		e.state = "attack"
	e.target = target
	e.atk_t -= TICK
	if e.atk_t <= 0.0:
		e.atk_t += _interval(e)
		blow(e)


## The nearest structure within reach of a ranged enemy, or the wall (true), or null.
func _ranged_target(e: Enemy):
	var best: Defense = null
	for d in defenses:
		if d.dead or d.kind == "oil" or d.x >= e.x or e.x - d.x > e.reach:
			continue
		if best == null or d.x > best.x:
			best = d
	if best:
		return best
	if e.x - WALL_X <= e.reach:
		return true
	return null


## One blow of e at its target (a Defense, or the wall when null); ranged enemies loose a missile instead.
func blow(e: Enemy) -> void:
	e.blows += 1
	var dmg := e.damage * damage_mul(e)
	var d = e.target
	if d is Defense and d.dead:
		d = null
	if e.reach > 0.0:
		var tx: float = d.x if d else WALL_X - 0.3
		var ty := 1.2 if d else 4.0 + rng.randf() * 3.0
		add_shot("arrow", Vector2(e.x - 0.3, e.y + e.h * 0.75), Vector2(tx, ty), d, dmg * e.wall_mult, dmg * e.structure_mult, 0.0)
		emit("attack", {id = e.id, ranged = true})
		return
	emit("attack", {id = e.id})
	if d:
		damage_defense(d, dmg * e.structure_mult)
	else:
		hit_wall(dmg * e.wall_mult, e)


## A missile from `from` to `to`: hits the Defense (if it still stands when it lands) or the wall (null).
## The flight takes dur seconds (by default from the distance).
func add_shot(kind: String, from: Vector2, to: Vector2, target, wall_dmg: float, struct_dmg: float, dur := 0.0, splash := 0.0) -> void:
	if dur <= 0.0:
		dur = clampf(from.distance_to(to) / 22.0, 0.25, 1.4)
	shots.append({kind = kind, x0 = from.x, y0 = from.y, x1 = to.x, y1 = to.y, t = 0.0, dur = dur, target = target,
		wall = wall_dmg, struct = struct_dmg, splash = splash, arc = clampf(from.distance_to(to) * 0.18, 0.5, 6.0)})


func _step_shots() -> void:
	var live := []
	for s in shots:
		s.t += TICK
		if s.t < s.dur:
			live.append(s)
			continue
		var d = s.target
		if s.splash > 0.0:
			for dd in defenses_in(s.x1 - s.splash, s.x1 + s.splash):
				damage_defense(dd, s.struct, s.kind)
			if s.x1 - s.splash <= WALL_X:
				_wall_from_shot(s)
		elif d is Defense:
			if not d.dead:
				damage_defense(d, s.struct, s.kind)
		elif d == null:
			_wall_from_shot(s)
		emit("shot_hit", {kind = s.kind, x = s.x1, y = s.y1})
	shots = live


func _wall_from_shot(s: Dictionary) -> void:
	wall_hp = maxf(0.0, wall_hp - s.wall)
	damage_this_wave += s.wall
	emit("wall_hit", {id = 0, kind = s.kind, amount = s.wall})


## The original flyer: straight at the archer's wall at its cruising height; the ward downs one per charge.
func _fly(e: Enemy) -> void:
	e.bob += TICK * 3.0
	e.y = e.alt + sin(e.bob) * 0.6
	var stop := WALL_X + e.w * 0.5
	if not e.attacking:
		e.speed = e.base_speed * speed_mul(e)
		e.x -= e.speed * TICK
		if e.x <= stop:
			e.x = stop
			if ward > 0:
				ward -= 1
				emit("ward", {id = e.id, x = e.x, y = e.y})
				kill(e)
				return
			e.attacking = true
			e.atk_t = _interval(e) * 0.5
			e.target = null
	else:
		e.speed = 0.0
		e.atk_t -= TICK
		if e.atk_t <= 0.0:
			e.atk_t += _interval(e)
			blow(e)


## ── Defences ──

func defense_unlocked(type: String) -> bool:
	return unlocked >= int(CastleContent.defenses()[type].unlock)


func defense_hp(type: String) -> float:
	var c: Dictionary = CastleContent.defenses()[type]
	var hp := float(c.hp)
	if c.kind == "stakes":
		hp *= 1.0 + 0.25 * m("stakes")
	elif c.kind == "block" or c.kind == "tower":
		hp *= 1.0 + 0.25 * m("carpentry")
	return hp


func defense_at(slot: int) -> Defense:
	for d in defenses:
		if d.slot == slot and not d.dead:
			return d
	return null


## Why a defence can't go into a slot right now, or "" when it can.
func can_place(slot: int, type: String) -> String:
	if not CastleContent.defenses().has(type):
		return "unknown"
	if status != "ready" and status != "between":
		return "closed"
	if slot < 0 or slot >= slots:
		return "noslot"
	if not defense_unlocked(type):
		return "locked"
	if defense_at(slot):
		return "occupied"
	if gold < int(CastleContent.defenses()[type].cost):
		return "nogold"
	return ""


func place(slot: int, type: String) -> String:
	var why := can_place(slot, type)
	if why != "":
		return why
	var c: Dictionary = CastleContent.defenses()[type]
	gold -= int(c.cost)
	var d := Defense.new()
	d.id = next_id
	next_id += 1
	d.type = type
	d.kind = c.kind
	d.cfg = c
	d.slot = slot
	d.x = SLOT_X[slot]
	d.half = float(c.half)
	d.max_hp = defense_hp(type)
	d.hp = d.max_hp
	d.armor = float(c.get("armor", 0))
	defenses.append(d)
	emit("placed", {did = d.id, what = type, x = d.x})
	return "ok"


## Takes a defence down for half its price back (only between waves).
func demolish(slot: int) -> bool:
	var d := defense_at(slot)
	if d == null or (status != "ready" and status != "between"):
		return false
	gold += int(int(d.cfg.cost) * 0.5 * d.hp / d.max_hp)
	d.dead = true
	defenses.erase(d)
	emit("demolished", {did = d.id, what = d.type, x = d.x})
	return true


func fix_price() -> int:
	var missing := 0.0
	for d in defenses:
		if not d.dead:
			missing += d.max_hp - d.hp
	return int(ceil(missing * FIX_PRICE))


## Mends every damaged defence → ok | nogold | full | closed.
func fix_defenses() -> String:
	if status != "ready" and status != "between":
		return "closed"
	var p := fix_price()
	if p <= 0:
		return "full"
	if gold < p:
		return "nogold"
	gold -= p
	for d in defenses:
		d.hp = d.max_hp
	emit("fixed", {})
	return "ok"


func _oil_check(e: Enemy) -> void:
	for d in defenses:
		if d.kind == "oil" and d.armed and not d.dead and absf(e.x - d.x) < d.half + e.w * 0.5:
			d.armed = false
			var r := float(d.cfg.radius)
			zones.append({kind = "oil", x0 = d.x - r, x1 = d.x + r, t = 0.0, dur = float(d.cfg.burn), enemy = float(d.cfg.dps), struct = 0.0, wall = 0.0, resist = false})
			emit("oil", {did = d.id, x = d.x})


func _step_towers() -> void:
	for d in defenses:
		if d.dead or d.kind != "tower":
			continue
		d.cd -= TICK
		if d.cd > 0.0:
			continue
		var best: Enemy = null
		var best_score := INF
		for e in enemies:
			if e.dead or e.immune > 0.0 or absf(e.x - d.x) > float(d.cfg.range):
				continue
			var sc := absf(e.x - d.x) - (100.0 if e.flies else 0.0)
			if sc < best_score:
				best_score = sc
				best = e
		if best == null:
			d.cd = 0.1
			continue
		d.cd = float(d.cfg.every)
		emit("tower_shot", {did = d.id, id = best.id, x0 = d.x, y0 = 6.5, x1 = best.x, y1 = best.y + best.h * 0.6})
		damage(best, float(d.cfg.damage) * (1.0 + 0.1 * m("bow")), "tower")


## Fire on the ground, dragon breath, curses: what stands in them gets hurt every tick.
func _step_zones() -> void:
	var live := []
	for z in zones:
		z.t += TICK
		if z.t > z.dur:
			continue
		live.append(z)
		if z.get("delay", 0.0) > z.t:
			continue
		if z.enemy > 0.0:
			for e in enemies:
				if not e.dead and (not e.flies or e.state == "landed") and e.x + e.w * 0.5 >= z.x0 and e.x - e.w * 0.5 <= z.x1:
					# boiling oil is no fire arrow: the Ashen Lands' fire resistance doesn't help against it
					var res := mod("fire_resist") if z.get("resist", true) else 0.0
					e.scorch = 0.25
					damage(e, z.enemy * TICK * (1.0 - res), "fire", 0.0)
		if z.struct > 0.0:
			for d in defenses_in(z.x0, z.x1):
				damage_defense(d, z.struct * TICK, z.kind)
		if z.wall > 0.0 and z.x0 <= WALL_X + 0.5:
			wall_hp = maxf(0.0, wall_hp - z.wall * TICK)
			damage_this_wave += z.wall * TICK
	zones = live


## ── The clock ──

func tick() -> void:
	if status != "wave":
		return
	t += TICK
	while not queue.is_empty() and queue[0].at <= t + 1e-9:
		var s: Dictionary = queue.pop_front()
		spawn(s.kind, s)
	cooldown = maxf(0.0, cooldown - TICK)
	if firing and cooldown <= 1e-9:
		fire()
		cooldown = stats().reload
	_step_arrows()
	_step_towers()
	_step_enemies()
	_step_shots()
	_step_zones()
	defenses = defenses.filter(func(d): return not d.dead)
	if wall_hp <= 0.0:
		status = "lost"
		firing = false
		emit("lost", {wave = wave})
		return
	if queue.is_empty() and enemies.is_empty():
		_clear_wave()


func _clear_wave() -> void:
	arrows.clear()
	shots.clear()
	zones.clear()
	firing = false
	var no_damage := damage_this_wave == 0.0
	var bonus := NO_DAMAGE_BONUS + wave if no_damage else 0
	gold += bonus
	status = "won" if mode == "level" and wave >= waves_total else "between"
	picked = false
	offer = _offer_cards() if status == "between" else []
	emit("wave_clear", {wave = wave, no_damage = no_damage, bonus = bonus})
	if status == "won":
		emit("won", {level = level_n})


func step(dt: float) -> void:
	if not is_finite(dt) or dt <= 0.0:
		return
	acc += minf(dt, MAX_DT)
	while acc >= TICK - 1e-9:
		acc -= TICK
		tick()


## Where an arrow shot with (angle, power) is after t seconds: the aim preview and the bots.
func flight(angle: float, power: float, time: float) -> Vector2:
	var v := clampf(power, MIN_POWER, 1.0) * float(stats().vmax)
	return Vector2(ARCHER.x + cos(angle) * v * time, ARCHER.y + sin(angle) * v * time - G * time * time / 2.0)


## ── Cards and the wall shop (as the web game) ──

func card_cap(id: String) -> int:
	return int(CastleContent.meta().cards[id].cap)


func _offer_cards() -> Array:
	var pool := up.keys().filter(func(id): return up[id] < card_cap(id))
	var out := []
	while out.size() < 3 and not pool.is_empty():
		out.append(pool.pop_at(rng.randi_range(0, pool.size() - 1)))
	return out


## One of the offered cards: once per break, or prep_left times before a level's first wave.
func choose_card(id: String) -> bool:
	var open := (status == "between" and not picked) or (status == "ready" and prep_left > 0)
	if not open or not offer.has(id) or up[id] >= card_cap(id):
		return false
	up[id] += 1
	if status == "ready":
		prep_left -= 1
		offer = _offer_cards() if prep_left > 0 else []
	else:
		picked = true
	if id == "ward":
		ward = stats().ward_max
	return true


func price_of(item: String) -> int:
	return int(round(PRICE[item][0] * pow(PRICE[item][1], bought[item])))


func buy(item: String) -> String:
	if not PRICE.has(item):
		return "unknown"
	if status != "between" and status != "ready":
		return "closed"
	if item == "repair" and wall_hp >= wall_max:
		return "full"
	var p := price_of(item)
	if gold < p:
		return "nogold"
	gold -= p
	bought[item] += 1
	if item == "repair":
		wall_hp = minf(wall_max, wall_hp + wall_max * REPAIR_SHARE)
	else:
		var add := wall_max * FORTIFY_SHARE
		wall_max += add
		wall_hp += add
	emit("bought", {item = item})
	return "ok"


## Endless score, as the web game: 10 per kill and 100 per wave before the current one.
func score() -> int:
	return kills * 10 + maxi(0, wave - 1) * 100


## Stars for a won level: by the wall left standing.
func stars() -> int:
	if status != "won":
		return 0
	var f := wall_hp / wall_max
	return 3 if f >= 0.7 else (2 if f >= 0.35 else 1)
