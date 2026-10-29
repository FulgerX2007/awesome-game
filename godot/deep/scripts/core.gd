class_name DeepCore
extends RefCounted
## Глубина — the eat-and-grow ocean simulation, a line-by-line port of web/deep/core.js.
## No nodes and no rendering, so tests can run it headless. The tables (species, zones, stages)
## come from data/deep.json, which tools/deep-godot/data.cjs copies out of core.js.
## Keep the order of random draws identical to core.js: tests compare the two runs step by step.

const GAIN := 0.5          # share of prey mass you keep
const DASH_TIME := 0.6
const DASH_MULT := 2.3
const CHASE_LIMIT := 4.5
const REST_TIME := 3.0
const LUNGE_TIME := 1.1
const LUNGE_MULT := 1.9
const ZONE_SWIM := 28.0    # seconds of straight diving at full speed to cross one zone, at any size

static var START_R: float
static var MAX_R: float
static var EAT_RATIO: float
static var DASH_COOLDOWN: float
static var MAX_DEPTH: int
static var FLOOR_M: float
static var LEN_KNOTS: Array
static var KINDS: Array
static var KIND: Dictionary
static var ZONES: Array
static var SPECIES: Array
static var SPECIES_BY_ID: Dictionary
static var STAGES: Array
static var _traits: Dictionary      # species id -> traits
static var _by_cls_zone: Dictionary # "cls/zone" -> species list, in SPECIES order
static var _loaded := false


static func load_data(path := "res://data/deep.json") -> void:
	if _loaded:
		return
	var text := FileAccess.get_file_as_string(path)
	var d: Dictionary = JSON.parse_string(text)
	START_R = d.START_R
	MAX_R = d.MAX_R
	EAT_RATIO = d.EAT_RATIO
	DASH_COOLDOWN = d.DASH_COOLDOWN
	MAX_DEPTH = int(d.MAX_DEPTH)
	FLOOR_M = d.FLOOR_M
	LEN_KNOTS = d.LEN_KNOTS
	KINDS = d.KINDS
	ZONES = d.ZONES
	SPECIES = d.SPECIES
	STAGES = d.STAGES
	for k in KINDS:
		KIND[k.id] = k
	for s in SPECIES:
		SPECIES_BY_ID[s.id] = s
		for z in s.zones:
			var key := "%s/%d" % [s.cls, int(z)]
			if not _by_cls_zone.has(key):
				_by_cls_zone[key] = []
			_by_cls_zone[key].append(s)
	# Class traits with species overrides. Jellies drift; ambushers barely move until they lunge.
	for s in SPECIES:
		var k: Dictionary = KIND[s.cls]
		var jelly: bool = s.get("jelly", false)
		var ambush: bool = s.get("ambush", false)
		_traits[s.id] = {
			speed = 0.3 if jelly else (0.35 if ambush else float(k.speed)),
			flee = s.flee if s.has("flee") else (not jelly and k.get("flee", false)),
			hunter = s.hunter if s.has("hunter") else (not jelly and k.get("hunter", false)),
			school = k.get("school", false), glow = s.get("glow", false), ambush = ambush,
			drift = s.cls == "plankton" or s.cls == "whale" or s.cls == "leviathan" or jelly,
		}
	_loaded = true


## A creature, or the player (who has no species of their own; their body follows the stage).
class Body:
	var id := 0
	var sp := ""
	var cls := ""
	var is_player := false
	var alive := true
	var r := 0.0
	var x := 0.0
	var y := 0.0
	var vx := 0.0
	var vy := 0.0
	var angle := 0.0
	var heading := 0.0
	var mode := "wander"
	var target: Body = null
	var think := 0.0
	var chase := 0.0
	var rest := 0.0
	var lunge := 0.0
	var hue := 0.0
	var phase := 0.0
	var met := false
	var feat: Dictionary  # traits of the species, cached
	# player only
	var peak := 0.0
	var dash_t := 0.0
	var dash_cd := 0.0
	var invuln := 0.0
	var stage := 0
	var depth := 0.0
	var zone := 0
	var max_zone := 0


class World:
	var seed_state := 0
	var time := 0.0
	var next_id := 1
	var ents: Array[Body] = []
	var events: Array[Dictionary] = []
	var deaths := 0
	var player: Body

	## mulberry32, bit for bit the same as rng() in core.js (32-bit unsigned patterns in 64-bit ints).
	func R() -> float:
		seed_state = (seed_state + 0x6d2b79f5) & 0xFFFFFFFF
		var a := seed_state
		var t := DeepCore.imul(a ^ (a >> 15), 1 | a)
		t = ((t + DeepCore.imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
		return float(t ^ (t >> 14)) / 4294967296.0


## Math.imul for unsigned 32-bit patterns, without overflowing 64-bit ints.
static func imul(a: int, b: int) -> int:
	return (a * (b & 0xFFFF) + (((a * (b >> 16)) & 0xFFFF) << 16)) & 0xFFFFFFFF


## Takes a creature out of the world. Clearing its target breaks reference cycles (RefCounted has no GC).
static func drop(e: Body) -> void:
	e.alive = false
	e.target = null


static func zone_at(d: float) -> int:
	return clampi(floori(d), 0, ZONES.size() - 1)


static func meters_at(d: float) -> float:
	var z := zone_at(d)
	var top: float = ZONES[z].top
	var bottom: float = ZONES[z + 1].top if z + 1 < ZONES.size() else FLOOR_M
	return top + (bottom - top) * clampf(d - z, 0, 1)


## Darkness 0..1, smoothly blended across zone borders.
static func dark_at(d: float) -> float:
	var z := zone_at(d)
	var k := clampf(d - z, 0, 1)
	var nxt: float = ZONES[mini(z + 1, ZONES.size() - 1)].dark
	var cur: float = ZONES[z].dark
	return cur + (nxt - cur) * k * k


static func class_of(r: float) -> String:
	for k in KINDS:
		if r < k.max:
			return k.id
	return KINDS[-1].id


## A species of the right size for this depth. Classes missing from a zone borrow from the zone above.
static func species_for(r: float, d: float, w: World) -> Dictionary:
	var cls := class_of(r)
	for z in range(zone_at(d), -1, -1):
		var list: Array = _by_cls_zone.get("%s/%d" % [cls, z], [])
		if list.size():
			return list[floori(w.R() * list.size())]
	for s in SPECIES:
		if s.cls == cls:
			return s
	return SPECIES[0]


static func traits(sp: String) -> Dictionary:
	return _traits[sp]


static func is_hunter(e: Body) -> bool:
	return not e.is_player and e.feat.hunter


static func stage_of(r: float) -> int:
	var s := 0
	for i in STAGES.size():
		if r >= STAGES[i].from:
			s = i
	return s


static func base_speed(r: float) -> float:
	return 90.0 * pow(r / 4.0, 0.7)


## World height that fits on screen for a player of radius r.
static func view_size(r: float) -> float:
	return 170.0 * pow(maxf(r, START_R) / 4.0, 0.85)


## World units per unit of depth progress, at the player's current size.
static func depth_scale(p: Body) -> float:
	return ZONE_SWIM * base_speed(p.r)


static func depth_of(w: World, y: float) -> float:
	return w.player.depth + (y - w.player.y) / depth_scale(w.player)


## How far the player sees in the dark, in world units.
static func light_radius(p: Body) -> float:
	return p.r * 5 + view_size(p.r) * 0.12


## Real-world length, a power law between knots at the stage borders.
static func length_meters(r: float) -> float:
	var i := 0
	while i < LEN_KNOTS.size() - 2 and r > LEN_KNOTS[i + 1][0]:
		i += 1
	var r0: float = LEN_KNOTS[i][0]
	var m0: float = LEN_KNOTS[i][1]
	var r1: float = LEN_KNOTS[i + 1][0]
	var m1: float = LEN_KNOTS[i + 1][1]
	return m0 * pow(r / r0, log(m1 / m0) / log(r1 / r0))


## "40 см", "1,5 м" — the unit words go through tr(), like I18n.t in the web version.
static func length_text(r: float) -> String:
	var m := length_meters(r)
	var f := func(v: float) -> String:
		return ("%.1f" % v).replace(".", ",") if v < 10 else str(int(round(v)))
	if m < 1e-3:
		return TranslationServer.translate("{n} мкм").format({n = f.call(m * 1e6)})
	if m < 1e-2:
		return TranslationServer.translate("{n} мм").format({n = f.call(m * 1e3)})
	if m < 1:
		return TranslationServer.translate("{n} см").format({n = f.call(m * 1e2)})
	return TranslationServer.translate("{n} м").format({n = f.call(m)})


static func create_world(rng_seed: int, r0: float = -1.0, depth := 0.15) -> World:
	load_data()
	if r0 < 0:
		r0 = START_R
	var w := World.new()
	w.seed_state = rng_seed & 0xFFFFFFFF
	var p := Body.new()
	p.is_player = true
	p.r = r0
	p.peak = r0
	p.invuln = 2
	p.stage = stage_of(r0)
	p.depth = clampf(depth, 0, MAX_DEPTH - 0.02)
	p.zone = zone_at(depth)
	p.max_zone = p.zone
	w.player = p
	populate(w, true)
	return w


## Lets go of a world: its creatures point at each other, and RefCounted cannot free cycles alone.
static func free_world(w: World) -> void:
	for e in w.ents:
		drop(e)
	w.ents.clear()


static func spawn(w: World, r: float, near: bool) -> Body:
	var p := w.player
	var V := view_size(p.r)
	var a := w.R() * PI * 2
	var dd := V * (0.35 + w.R() * 1.5) if near else V * (1.15 + w.R() * 0.75)
	var x := p.x + cos(a) * dd
	var y := p.y + sin(a) * dd
	# Nothing lives above the surface or below the floor, so the water there is just emptier.
	var top := p.y - p.depth * depth_scale(p)
	var floor_y := p.y + (MAX_DEPTH - p.depth) * depth_scale(p)
	if y < top + r or y > floor_y - r:
		return null
	var sp := species_for(r, depth_of(w, y), w)
	var e := Body.new()
	e.id = w.next_id
	w.next_id += 1
	e.sp = sp.id
	e.cls = sp.cls
	e.feat = _traits[sp.id]
	e.r = r
	e.x = x
	e.y = y
	e.angle = w.R() * PI * 2
	e.heading = w.R() * PI * 2
	e.think = w.R() * 0.3
	e.hue = w.R()
	e.phase = w.R() * 6
	# Don't drop a hungry hunter right on top of the player.
	if e.feat.hunter and r > p.r and hypot(e.x - p.x, e.y - p.y) < V * 0.9:
		return null
	w.ents.append(e)
	return e


## Keep a steady population around the player, sized relative to the player and shaped by the zone.
static func populate(w: World, initial: bool) -> void:
	var p := w.player
	var V := view_size(p.r)
	var Z: Dictionary = ZONES[p.zone]
	var kept: Array[Body] = []
	for e in w.ents:
		if hypot(e.x - p.x, e.y - p.y) < V * 2.3:
			kept.append(e)
		else:
			drop(e)
	w.ents = kept
	var food := 0
	var others := 0
	var big_hunters := 0
	for e in w.ents:
		if e.r < p.r * 0.45:
			food += 1
		else:
			others += 1
		if is_hunter(e) and e.r > p.r * EAT_RATIO:
			big_hunters += 1
	var guard := 0
	while food < Z.food and guard < 200:
		if spawn(w, p.r * (0.25 + w.R() * 0.3), initial):
			food += 1
		guard += 1
	guard = 0
	while others < 34 and guard < 200:
		guard += 1
		var roll := w.R()
		var r: float
		if roll < 0.5:
			r = p.r * (0.45 + w.R() * 0.4)
		elif roll < 0.7:
			r = p.r * (0.85 + w.R() * 0.4)
		else:
			r = p.r * (1.3 + w.R() * 2.4)
		var e := spawn(w, r, initial)
		if e == null:
			continue
		if is_hunter(e) and r > p.r * EAT_RATIO:
			if big_hunters >= Z.hunters:
				drop(w.ents.pop_back())
				continue
			big_hunters += 1
		others += 1


## Godot's Vector2 is 32-bit; the simulation needs doubles like JavaScript to stay in step with core.js.
static func hypot(x: float, y: float) -> float:
	return sqrt(x * x + y * y)


static func dist(a: Body, b: Body) -> float:
	return hypot(a.x - b.x, a.y - b.y)


static func think(w: World, e: Body) -> void:
	var p := w.player
	var t := e.feat
	var sense := e.r * 7 + 80
	if e.lunge > 0:
		return
	e.mode = "wander"
	e.target = null
	if t.flee:
		var threat: Body = null
		var td := INF
		for o in [p] + w.ents:
			if o == e or o.r <= e.r * EAT_RATIO:
				continue
			if o != p and not o.feat.hunter:
				continue
			var d := dist(o, e)
			if d < sense and d < td:
				threat = o
				td = d
		if threat:
			e.mode = "flee"
			e.target = threat
			return
	if t.hunter and e.rest <= 0:
		# Ambushers only strike at what swims right up to them.
		var reach: float = e.r * 4 if t.ambush else sense
		var prey: Body = null
		var pd := INF
		var cands: Array = ([p] if p.invuln <= 0 else []) + w.ents
		for o in cands:
			if o == e or e.r <= o.r * EAT_RATIO:
				continue
			var d := dist(o, e)
			if d < reach and d < pd:
				prey = o
				pd = d
		if prey:
			e.mode = "hunt"
			e.target = prey
			if t.ambush:
				e.lunge = LUNGE_TIME


static func move_entity(w: World, e: Body, dt: float) -> void:
	var t := e.feat
	e.think -= dt
	if e.think <= 0:
		e.think = 0.25 + w.R() * 0.15
		think(w, e)
	if e.target and e.target != w.player and not e.target.alive:
		e.target = null
		e.mode = "wander"
	var speed: float = base_speed(e.r) * t.speed
	var dir_x: float
	var dir_y: float
	if e.lunge > 0:
		e.lunge -= dt
		if e.lunge <= 0:
			e.rest = REST_TIME
			e.mode = "wander"
			e.target = null
		speed = base_speed(e.r) * LUNGE_MULT
	if e.mode == "flee" and e.target:
		dir_x = e.x - e.target.x
		dir_y = e.y - e.target.y
	elif e.mode == "hunt" and e.target:
		e.chase += dt
		if e.chase > CHASE_LIMIT:
			e.rest = REST_TIME
			e.chase = 0
			e.mode = "wander"
			e.target = null
		dir_x = (e.target.x if e.target else e.x) - e.x
		dir_y = (e.target.y if e.target else e.y) - e.y
		speed *= 0.95
	else:
		e.heading += (w.R() - 0.5) * dt * 2
		dir_x = cos(e.heading)
		dir_y = sin(e.heading)
		speed *= 0.1 if t.ambush else (0.6 if t.drift else 0.35)
	if e.rest > 0:
		e.rest -= dt
		speed *= 0.5
	# Turn back at the surface and the floor.
	var ed := depth_of(w, e.y)
	if ed < 0.02 and dir_y < 0:
		dir_y = absf(dir_y) + 0.3
		e.heading = fmod(absf(e.heading), PI)
	if ed > MAX_DEPTH - 0.02 and dir_y > 0:
		dir_y = -absf(dir_y) - 0.3
		e.heading = fmod(-absf(e.heading), PI)
	var len := hypot(dir_x, dir_y)
	if len == 0:
		len = 1
	var k := 1 - exp(-dt * 3)
	e.vx += ((dir_x / len) * speed - e.vx) * k
	e.vy += ((dir_y / len) * speed - e.vy) * k
	e.x += e.vx * dt
	e.y += e.vy * dt
	var v := hypot(e.vx, e.vy)
	if v > 1:
		e.angle = atan2(e.vy, e.vx)
	e.phase += dt * (2 + v / (e.r + 4))


static func grow(p: Body, prey: Body, gain: float) -> void:
	p.r = minf(MAX_R, sqrt(p.r * p.r + prey.r * prey.r * GAIN * gain))
	p.peak = maxf(p.peak, p.r)


## Can the player make this creature out right now? Glowing ones are visible from afar in the dark.
static func visible(w: World, e: Body) -> bool:
	var p := w.player
	var d := dist(p, e)
	if d > view_size(p.r) * 0.55:
		return false
	return dark_at(p.depth) < 0.6 or e.feat.glow or d < light_radius(p) + e.r


## input: {tx, ty} point to swim toward (world), or no tx to drift; dash: bool.
static func step(w: World, dt: float, input: Dictionary) -> void:
	var p := w.player
	w.time += dt
	p.invuln = maxf(0, p.invuln - dt)
	p.dash_cd = maxf(0, p.dash_cd - dt)
	p.dash_t = maxf(0, p.dash_t - dt)
	if input.get("dash", false) and p.dash_cd <= 0:
		p.dash_t = DASH_TIME
		p.dash_cd = DASH_COOLDOWN
		w.events.append({type = "dash"})

	var ax := 0.0
	var ay := 0.0
	if input.has("tx"):
		var dx: float = input.tx - p.x
		var dy: float = input.ty - p.y
		var d := hypot(dx, dy)
		if d > 0.5:
			var f := minf(1, d / (p.r * 2.5))
			ax = (dx / d) * f
			ay = (dy / d) * f
	var mx := base_speed(p.r) * (DASH_MULT if p.dash_t > 0 else 1.0)
	var k := 1 - exp(-dt * 4)
	p.vx += (ax * mx - p.vx) * k
	p.vy += (ay * mx - p.vy) * k
	# The surface and the trench floor stop you.
	var ddy := p.vy * dt / depth_scale(p)
	if p.depth + ddy < 0 or p.depth + ddy > MAX_DEPTH - 0.02:
		p.vy = 0
	p.depth = clampf(p.depth + p.vy * dt / depth_scale(p), 0, MAX_DEPTH - 0.02)
	p.x += p.vx * dt
	p.y += p.vy * dt
	if hypot(p.vx, p.vy) > 2:
		p.angle = atan2(p.vy, p.vx)
	var zone := zone_at(p.depth)
	if zone != p.zone:
		w.events.append({type = "zone", zone = zone, first = zone > p.max_zone, down = zone > p.zone})
		p.zone = zone
		p.max_zone = maxi(p.max_zone, zone)

	for e in w.ents:
		move_entity(w, e, dt)

	# Who eats whom.
	var eaten := {}
	var gain: float = ZONES[p.zone].gain
	for e in w.ents:
		if not e.met and visible(w, e):
			e.met = true
			w.events.append({type = "meet", sp = e.sp})
		var d := dist(p, e)
		if p.r > e.r * EAT_RATIO and d < p.r:
			eaten[e] = true
			grow(p, e, gain)
			var pct := 0.0 if p.r >= MAX_R else e.r * e.r * GAIN * gain / stage_area(p.stage) * 100
			w.events.append({type = "eat", r = e.r, sp = e.sp, x = e.x, y = e.y, pct = pct})
		elif is_hunter(e) and e.r > p.r * EAT_RATIO and d < e.r and p.invuln <= 0:
			die(w, e)
			break
	for h in w.ents:
		if not is_hunter(h) or eaten.has(h) or h.mode != "hunt":
			continue
		for o in w.ents:
			if o == h or eaten.has(o) or h.r <= o.r * EAT_RATIO:
				continue
			if dist(h, o) < h.r:
				eaten[o] = true
				h.mode = "wander"
				h.target = null
				break
	if eaten.size():
		var kept: Array[Body] = []
		for e in w.ents:
			if eaten.has(e):
				drop(e)
			else:
				kept.append(e)
		w.ents = kept

	var st := stage_of(p.r)
	if st > p.stage:
		p.stage = st
		w.events.append({type = "stage", stage = st})
	if st < p.stage:
		p.stage = st
	populate(w, false)


## Growth inside a stage, by mass (r²), so every bite of the same size moves the bar the same amount.
static func stage_end(i: int) -> float:
	return STAGES[i + 1].from if i + 1 < STAGES.size() else MAX_R


static func stage_start(i: int) -> float:
	return START_R if i == 0 else float(STAGES[i].from)


static func stage_area(i: int) -> float:
	return stage_end(i) ** 2 - stage_start(i) ** 2


## {stage, next (-1 at the last stage), k 0..1}
static func progress(r: float) -> Dictionary:
	var i := stage_of(r)
	return {stage = i, next = i + 1 if i + 1 < STAGES.size() else -1,
		k = clampf((r * r - stage_start(i) ** 2) / stage_area(i), 0, 1)}


## Being eaten costs half your mass, never the run.
static func die(w: World, killer: Body) -> void:
	var p := w.player
	w.deaths += 1
	w.events.append({type = "death", x = p.x, y = p.y, by = killer.sp})
	p.r = maxf(START_R, p.r / sqrt(2.0))
	p.invuln = 3
	p.vx = 0
	p.vy = 0
	p.stage = stage_of(p.r)
	var V := view_size(p.r)
	var kept: Array[Body] = []
	for e in w.ents:
		if is_hunter(e) and e.r > p.r and dist(e, p) < V * 1.5:
			drop(e)
		else:
			kept.append(e)
	w.ents = kept
