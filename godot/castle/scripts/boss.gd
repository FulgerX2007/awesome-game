class_name CastleBoss
extends RefCounted
## The bosses' brains. A boss is a CastleSim.Enemy with boss = true; every tick CastleSim calls tick(), which
## checks the phase thresholds (data/bosses.json) and runs the boss's own state machine. Shared rules:
##   - every big attack is announced first: a "telegraph" event with its kind, the ground it will hit
##     (x0..x1) and how long the warning lasts; the view draws it on the ground;
##   - e.vulnerable > 0 opens a window (no armour, damage × vuln) the player is meant to exploit;
##   - e.immune > 0 lets arrows pass through (evasion, phase transitions), never for long;
##   - while walking a boss is an ordinary ground walker (CastleSim.ground_step): barricades stop it,
##     stakes cut it, and it breaks them like a heavy enemy.

const TICK := CastleSim.TICK


static func init(s: CastleSim, e: CastleSim.Enemy) -> void:
	e.phase = 1
	e.state = "walk"
	match e.kind:
		"iron_warlord":
			e.brain = {charge_cd = 5.0, last_blows = 0}
		"siege_titan":
			e.brain = {slam_cd = 5.0, throw_cd = 3.0}
		"fire_dragon":
			e.alt = 11.0
			e.y = e.alt
			e.state = "approach"
			e.brain = {fb_cd = 2.0, breath_cd = 8.0, dir = -1.0}
		"shadow_beast":
			e.brain = {decide = 1.5, leap_cd = 2.5, evade_cd = 3.0, recent = 0.0, last_hp = e.hp}
		"dark_king":
			e.brain = {sum_cd = 7.0, bolt_cd = 2.0, curse_cd = 4.0, wave_cd = 5.0, last_blows = 0}


static func tick(s: CastleSim, e: CastleSim.Enemy) -> void:
	var th: Array = CastleContent.bosses()[e.kind].phases
	if e.phase - 1 < th.size() and e.frac() <= float(th[e.phase - 1]):
		e.phase += 1
		s.emit("boss_phase", {id = e.id, kind = e.kind, phase = e.phase, final = e.phase - 1 == th.size()})
		_on_phase(s, e)
	match e.kind:
		"iron_warlord": _warlord(s, e)
		"siege_titan": _titan(s, e)
		"fire_dragon": _dragon(s, e)
		"shadow_beast": _beast(s, e)
		"dark_king": _king(s, e)


static func _to(e: CastleSim.Enemy, state: String) -> void:
	e.state = state
	e.state_t = 0.0
	e.speed = 0.0
	e.attacking = false


static func _telegraph(s: CastleSim, e: CastleSim.Enemy, kind: String, x0: float, x1: float, dur: float) -> void:
	e.brain.tt = dur
	s.emit("telegraph", {id = e.id, kind = kind, x0 = minf(x0, x1), x1 = maxf(x0, x1), dur = dur})


static func _on_phase(s: CastleSim, e: CastleSim.Enemy) -> void:
	match e.kind:
		"iron_warlord":
			e.interval *= 0.75
			e.base_speed *= 1.35
		"siege_titan":
			e.base_speed *= 1.3
		"fire_dragon":
			pass
		"shadow_beast":
			e.base_speed *= 1.15 if e.phase == 2 else 1.2
			if e.phase == 3:
				e.interval *= 0.6
				e.damage *= 1.4
			_evade(s, e, 1.2)
		"dark_king":
			if e.phase == 2:
				_to(e, "teleport")
				e.immune = 2.0
			else:
				_to(e, "rage")
				e.immune = 3.0
				e.barrier = false
				for k in 3:
					s.spawn("flyer", {x = e.x + 2.0 + k * 1.5, summoner = e.id, alt = 7.0 + k})


## ── The Iron Warlord: slow and heavy; each great swing leaves him open for a moment; a telegraphed charge
## breaks defences; a charge that ends on stakes or on open ground leaves him stunned and open; below half
## health he swings and charges more often. ──
static func _warlord(s: CastleSim, e: CastleSim.Enemy) -> void:
	var b := e.brain
	match e.state:
		"walk", "attack":
			b.charge_cd -= TICK
			if e.blows != b.last_blows:
				# every heavy swing over-commits: a moment to hit back
				b.last_blows = e.blows
				e.vulnerable = maxf(e.vulnerable, 0.7)
			var stop: float = s.stop_for(e)[0]
			if b.charge_cd <= 0.0 and e.x - stop > 5.0:
				_to(e, "tele_charge")
				b.to = maxf(stop, e.x - (14.0 if e.phase == 1 else 18.0))
				_telegraph(s, e, "charge", b.to - e.w * 0.5, e.front(), 1.4 if e.phase == 1 else 1.1)
			else:
				s.ground_step(e)
		"tele_charge":
			b.tt -= TICK
			if b.tt <= 0.0:
				_to(e, "charge")
				s.emit("charge", {id = e.id})
		"charge":
			var nx := e.x - 10.0 * TICK
			e.speed = 10.0
			for d in s.defenses_in(nx - e.w * 0.5, e.front()):
				if d.kind == "stakes":
					s.damage_defense(d, 25.0, "charge")
					if not d.dead:
						e.x = d.x + d.half + e.w * 0.5
						_warlord_miss(s, e, "stakes")
						return
				elif d.kind == "block":
					s.damage_defense(d, 50.0, "charge")
					e.x = d.x + d.half + e.w * 0.5
					s.emit("impact", {id = e.id, kind = "charge", x0 = d.x - d.half, x1 = d.x + d.half})
					_warlord_reset(e)
					return
			if nx - e.w * 0.5 <= CastleSim.WALL_X:
				e.x = CastleSim.WALL_X + e.w * 0.5
				s.hit_wall(12.0, e)
				s.emit("impact", {id = e.id, kind = "charge", x0 = CastleSim.WALL_X - 1.0, x1 = CastleSim.WALL_X + 1.0})
				_warlord_reset(e)
			elif nx <= b.to:
				e.x = b.to
				_warlord_miss(s, e, "ground")
			else:
				e.x = nx
		"stun":
			if e.state_t >= 3.0:
				_to(e, "walk")


static func _warlord_miss(s: CastleSim, e: CastleSim.Enemy, why: String) -> void:
	_to(e, "stun")
	e.vulnerable = 3.0
	s.emit("stun", {id = e.id, why = why, x = e.x})
	e.brain.charge_cd = 7.0 if e.phase == 1 else 4.5


static func _warlord_reset(e: CastleSim.Enemy) -> void:
	_to(e, "walk")
	e.brain.charge_cd = 7.0 if e.phase == 1 else 4.5


## ── The Siege Titan: a walking fortress. The slam shakes the ground in front of it (every defence there is
## hurt, the wall too when in reach); while it winds up and recovers its joints glow and its armour is off.
## Between slams it hurls boulders at the nearest defence. ──
static func _titan(s: CastleSim, e: CastleSim.Enemy) -> void:
	var b := e.brain
	match e.state:
		"walk", "attack":
			b.slam_cd -= TICK
			b.throw_cd -= TICK
			var x0 := e.front() - 8.0
			var x1 := e.front()
			var any := not s.defenses_in(x0, x1).is_empty() or x0 <= CastleSim.WALL_X + 0.5
			var stop: float = s.stop_for(e)[0]
			if b.slam_cd <= 0.0 and any:
				_to(e, "tele_slam")
				b.zone = [x0, x1]
				_telegraph(s, e, "slam", x0, x1, 1.8)
				e.vulnerable = 1.8 + 2.2
			elif b.throw_cd <= 0.0 and e.x - stop > 6.0:
				_to(e, "tele_throw")
				b.tt = 1.0
			else:
				s.ground_step(e)
		"tele_slam":
			b.tt -= TICK
			if b.tt <= 0.0:
				for d in s.defenses_in(b.zone[0], b.zone[1]):
					s.damage_defense(d, 40.0, "slam")
				if b.zone[0] <= CastleSim.WALL_X + 0.5:
					s.hit_wall(10.0, e)
				s.emit("impact", {id = e.id, kind = "slam", x0 = b.zone[0], x1 = b.zone[1]})
				_to(e, "recover")
		"recover":
			if e.state_t >= 2.2:
				_to(e, "walk")
				b.slam_cd = 8.0 if e.phase == 1 else 5.0
		"tele_throw":
			b.tt -= TICK
			if b.tt <= 0.0:
				var target: CastleSim.Defense = null
				for d in s.defenses:
					if not d.dead and d.x < e.x and (target == null or d.x > target.x):
						target = d
				var to := Vector2(target.x, 1.0) if target else Vector2(CastleSim.WALL_X - 0.3, 5.0)
				s.add_shot("boulder", Vector2(e.x - 1.0, e.h * 0.9), to, target, 6.0, 18.0, 1.3)
				s.emit("throw", {id = e.id})
				_to(e, "walk")
				b.throw_cd = 9.0


## ── The Fire Dragon: circles out of reach of the ground, spits fireballs, and breathes fire on the busiest
## stretch of the defences after a long inhale. After the breath it lands to rest: then it is open, and the
## stakes under it bite. ──
static func _dragon(s: CastleSim, e: CastleSim.Enemy) -> void:
	var b := e.brain
	e.bob += TICK * 2.0
	match e.state:
		"approach":
			e.speed = e.base_speed
			e.x -= e.base_speed * TICK
			e.y = e.alt + sin(e.bob) * 0.8
			if e.x <= 34.0:
				_to(e, "hover")
		"hover":
			e.x += b.dir * 1.2 * TICK
			if e.x < 22.0:
				b.dir = 1.0
			elif e.x > 36.0:
				b.dir = -1.0
			e.speed = 1.2
			e.y = e.alt + sin(e.bob) * 0.8
			b.fb_cd -= TICK
			b.breath_cd -= TICK
			if b.breath_cd <= 0.0:
				var cx := _busiest(s)
				b.zone = [cx - 4.0, cx + 4.0]
				_to(e, "tele_breath")
				_telegraph(s, e, "breath", b.zone[0], b.zone[1], 1.6)
			elif b.fb_cd <= 0.0:
				var n := 1 if e.phase == 1 else 3
				for k in n:
					var live := s.defenses.filter(func(d): return not d.dead)
					var target: CastleSim.Defense = null if live.is_empty() or s.rng.randf() < 0.35 else live[s.rng.randi_range(0, live.size() - 1)]
					var to := Vector2(target.x + (k - (n - 1) * 0.5) * 1.5, 0.8) if target else Vector2(CastleSim.WALL_X - 0.2, 3.0 + k * 1.5)
					s.add_shot("fireball", Vector2(e.x - 1.8, e.y + 0.6), to, target, 4.0, 12.0, 1.1, 1.2 if target else 0.0)
				s.emit("fireball", {id = e.id, n = n})
				b.fb_cd = 2.8 if e.phase == 1 else 2.2
		"tele_breath":
			e.y = e.alt + sin(e.bob) * 0.3
			b.tt -= TICK
			if b.tt <= 0.0:
				var wall := 3.0 if b.zone[0] <= CastleSim.WALL_X + 0.5 else 0.0
				s.zones.append({kind = "breath", x0 = b.zone[0], x1 = b.zone[1], t = 0.0, dur = 2.5, enemy = 0.0, struct = 16.0, wall = wall})
				s.emit("impact", {id = e.id, kind = "breath", x0 = b.zone[0], x1 = b.zone[1]})
				_to(e, "breath")
		"breath":
			if e.state_t >= 2.5:
				_to(e, "descend")
				s.emit("land", {id = e.id})
		"descend":
			e.y = maxf(0.0, e.y - 9.0 * TICK)
			if e.y <= 0.0:
				_to(e, "landed")
				e.vulnerable = 4.0
		"landed":
			s._stakes(e)
			if e.state_t >= 4.0:
				_to(e, "ascend")
		"ascend":
			e.y = minf(e.alt, e.y + 8.0 * TICK)
			if e.y >= e.alt:
				_to(e, "hover")
				b.breath_cd = 10.0 if e.phase == 1 else 7.0


## The middle of the most crowded stretch of defences, or just before the wall when there are none.
static func _busiest(s: CastleSim) -> float:
	var best := CastleSim.WALL_X + 3.0
	var most := 0
	for d in s.defenses:
		if d.dead:
			continue
		var n := s.defenses_in(d.x - 4.0, d.x + 4.0).size()
		if n > most:
			most = n
			best = d.x
	return best


## ── The Shadow Beast: fast and hard to read. It decides every second or two between running on, leaping
## (a short crouch first, then it clears barricades and lands hard, open for a moment) and a feint back.
## Under a hail of arrows it melts into shadow and slips away, briefly untouchable. Each phase it gets faster;
## the last makes it frantic. ──
static func _beast(s: CastleSim, e: CastleSim.Enemy) -> void:
	var b := e.brain
	var lost: float = maxf(0.0, b.last_hp - e.hp)
	b.last_hp = e.hp
	b.recent = b.recent * exp(-TICK / 1.5) + lost
	match e.state:
		"walk", "attack":
			b.decide -= TICK
			b.leap_cd -= TICK
			b.evade_cd -= TICK
			if b.evade_cd <= 0.0 and b.recent > e.max_hp * 0.07:
				_evade(s, e, 0.9)
				return
			var sb := s.stop_for(e)
			var blocked: bool = sb[1] != null and e.x <= float(sb[0]) + 0.05
			if b.leap_cd <= 0.0 and (blocked or b.decide <= 0.0) and (blocked or s.rng.randf() < 0.55):
				var to := maxf(CastleSim.WALL_X + e.w * 0.5, e.x - (6.0 + s.rng.randf() * 4.0))
				b.to = to
				b.from = e.x
				_to(e, "crouch")
				_telegraph(s, e, "leap", to - 1.8, to + 1.8, 0.55 if e.phase < 3 else 0.4)
				return
			if b.decide <= 0.0:
				b.decide = (1.0 + s.rng.randf()) if e.phase < 3 else (0.6 + s.rng.randf() * 0.6)
				if s.rng.randf() < 0.2 and e.x < CastleSim.SPAWN_X - 8.0:
					_to(e, "feint")
					return
			s.ground_step(e)
		"crouch":
			b.tt -= TICK
			if b.tt <= 0.0:
				_to(e, "leap")
				s.emit("leap", {id = e.id})
		"leap":
			var f := minf(1.0, e.state_t / 0.7)
			e.x = lerpf(b.from, b.to, f)
			e.y = sin(f * PI) * 4.0
			e.speed = absf(b.from - b.to) / 0.7
			if f >= 1.0:
				e.y = 0.0
				for d in s.defenses_in(b.to - 2.0, b.to + 2.0):
					s.damage_defense(d, 22.0, "leap")
				if b.to - e.w * 0.5 <= CastleSim.WALL_X + 0.1:
					s.hit_wall(6.0, e)
				s.emit("impact", {id = e.id, kind = "leap", x0 = b.to - 2.0, x1 = b.to + 2.0})
				e.vulnerable = 0.9
				_to(e, "walk")
				b.leap_cd = [4.0, 3.0, 2.0][e.phase - 1]
		"feint":
			e.x = minf(CastleSim.SPAWN_X, e.x + 5.0 * TICK)
			e.speed = -5.0
			if e.state_t >= 0.6:
				_to(e, "walk")
		"evade":
			e.x = minf(CastleSim.SPAWN_X, e.x + 7.0 * TICK)
			e.speed = -7.0
			if e.immune <= 0.0:
				_to(e, "walk")
				b.recent = 0.0


static func _evade(s: CastleSim, e: CastleSim.Enemy, dur: float) -> void:
	_to(e, "evade")
	e.immune = dur
	e.y = 0.0
	e.brain.evade_cd = 5.0 if e.phase < 3 else 3.5
	s.emit("evade", {id = e.id, x = e.x})


## ── The Dark King. Phase 1: marches with a greatsword and raises knights. Phase 2: vanishes to the back of the
## field and wages a sorcerer's war — dark bolts, cursed ground under the defences (each curse leaves him open
## for a moment), a new warband; while his summoned guard lives a barrier soaks most of the damage. Phase 3, after a roar that can't be hurt: he comes
## for the wall himself, and every shockwave or cleave leaves him open for a moment. ──
static func _king(s: CastleSim, e: CastleSim.Enemy) -> void:
	var b := e.brain
	match e.state:
		"walk", "attack":
			if e.phase == 1:
				b.sum_cd -= TICK
				if b.sum_cd <= 0.0:
					_to(e, "tele_summon")
					_telegraph(s, e, "summon", e.x, e.x + 4.0, 1.2)
					return
			elif e.phase == 3:
				b.wave_cd -= TICK
				if e.blows != b.last_blows:
					b.last_blows = e.blows
					e.vulnerable = maxf(e.vulnerable, 0.7)
				if b.wave_cd <= 0.0:
					b.zone = [e.front() - 8.0, e.front()]
					_to(e, "tele_wave")
					_telegraph(s, e, "shockwave", b.zone[0], b.zone[1], 1.2)
					return
			s.ground_step(e)
		"tele_summon":
			b.tt -= TICK
			if b.tt <= 0.0:
				for k in 2:
					s.spawn("knight", {x = e.x + 2.0 + k * 1.4, summoner = e.id, hp_mul = 1.0, speed_mul = 1.0})
				s.emit("summon", {id = e.id, n = 2})
				b.sum_cd = 12.0
				_to(e, "walk")
		"teleport":
			if e.state_t >= 1.0 and e.x < 30.0:
				e.x = 30.0
				s.emit("teleport", {id = e.id, x = e.x})
			if e.immune <= 0.0:
				_to(e, "cast")
				b.sum_cd = 0.0
		"cast":
			e.barrier = s.enemies.any(func(o): return not o.dead and o.summoner == e.id)
			b.bolt_cd -= TICK
			b.curse_cd -= TICK
			b.sum_cd -= TICK
			if b.sum_cd <= 0.0:
				s.spawn("commander", {x = e.x + 1.5, summoner = e.id})
				for k in 3:
					s.spawn("footman", {x = e.x + 3.0 + k * 1.0, summoner = e.id})
				s.emit("summon", {id = e.id, n = 4})
				b.sum_cd = 16.0
			if b.curse_cd <= 0.0:
				var live := s.defenses.filter(func(d): return not d.dead)
				var cx: float = live[s.rng.randi_range(0, live.size() - 1)].x if not live.is_empty() else CastleSim.WALL_X + 2.5
				var wall := 1.0 if cx - 2.5 <= CastleSim.WALL_X + 0.5 else 0.0
				s.zones.append({kind = "curse", x0 = cx - 2.5, x1 = cx + 2.5, t = 0.0, delay = 2.0, dur = 6.0, enemy = 0.0, struct = 15.0, wall = wall})
				s.emit("telegraph", {id = e.id, kind = "curse", x0 = cx - 2.5, x1 = cx + 2.5, dur = 2.0})
				b.curse_cd = 7.0
				e.vulnerable = 1.5
			if b.bolt_cd <= 0.0:
				var live2 := s.defenses.filter(func(d): return not d.dead)
				var target: CastleSim.Defense = null if live2.is_empty() or s.rng.randf() < 0.5 else live2[s.rng.randi_range(0, live2.size() - 1)]
				var to := Vector2(target.x, 1.2) if target else Vector2(CastleSim.WALL_X - 0.2, 3.0 + s.rng.randf() * 4.0)
				s.add_shot("bolt", Vector2(e.x - 0.8, e.h * 0.8), to, target, 3.0, 10.0, 0.9)
				s.emit("cast", {id = e.id})
				b.bolt_cd = 2.4
		"rage":
			if e.immune <= 0.0:
				e.base_speed = 1.4
				e.interval = 1.4
				_to(e, "walk")
				b.last_blows = e.blows
		"tele_wave":
			b.tt -= TICK
			if b.tt <= 0.0:
				for d in s.defenses_in(b.zone[0], b.zone[1]):
					s.damage_defense(d, 30.0, "shockwave")
				if b.zone[0] <= CastleSim.WALL_X + 0.5:
					s.hit_wall(8.0, e)
				s.emit("impact", {id = e.id, kind = "shockwave", x0 = b.zone[0], x1 = b.zone[1]})
				e.vulnerable = 1.6
				b.wave_cd = 6.0
				_to(e, "walk")
