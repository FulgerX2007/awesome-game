class_name WinterSim
extends RefCounted
## Долгая зима — the rules, ported line for line from web/winter/core.js. No nodes: static functions over one
## plain Dictionary per game whose keys are exactly the JS keys ("hero", "stock", "regrowAt"...), so a snapshot is
## the same JSON as the web save. tests/winter-godot/parity.test.js plays the web bot's recorded moves on both
## and compares them every second; keep the two in step when you change anything here.
##
## Porting rules kept throughout (they are what makes the parity hold):
## - only float/int, never Vector2 (float32); WinterRng.hypot is Math.hypot as V8 computes it;
## - a JS array or object is truthy even when empty: `if (h.path)` is `h.path != null` here;
## - indexes taken from the state are cast with int() (JSON gives floats), divisions use float operands;
## - Math.round is _round() (half up), `%` on positive floats is fmod.
## The balance numbers come from data/*.tres through WinterData (generated from core.js).

const TICK := 1.0 / 20.0
const MAX_DT := 0.25
const W := 56
const H := 40
const DAY := 150.0
const NIGHT_AT := 100.0
const DAYS := 30
const STAT_MAX := 100.0

const BASE := {x0 = 22, y0 = 14, x1 = 33, y1 = 25}
const HUT := {x = 26, y = 16, w = 3, h = 2}
const SPOT := {
	fire = {x = 27, y = 20}, bench = {x = 24, y = 20}, bed = {x = 27, y = 17},
	bunks = [{x = 31, y = 17}, {x = 31, y = 19}, {x = 31, y = 21}],
	cellar = {x = 23, y = 16}, smokehouse = {x = 24, y = 23}, annex = {x = 29, y = 16}, workshop = {x = 31, y = 23},
	trader = {x = 27, y = 26},
}
const SEGMENTS := ["north", "east", "south", "west"]
const DIRS4 := [[1, 0], [-1, 0], [0, 1], [0, -1]]
const RES := ["wood", "stone", "metal", "hide"]
const FOOD_ITEMS := ["berries", "meat", "fish", "cookedMeat", "cookedFish", "smokedMeat", "smokedFish"]
const ITEMS := ["wood", "stone", "metal", "hide", "berries", "meat", "fish", "cookedMeat", "cookedFish", "smokedMeat", "smokedFish"]
const EAT_ORDER := ["smokedMeat", "cookedMeat", "smokedFish", "cookedFish", "fish", "berries", "meat"]
const MEATS := ["meat", "cookedMeat", "smokedMeat"]
const ITEM_OF := {tree = "wood", rock = "stone", bush = "berries", scrap = "metal"}
const NODE_KINDS := ["tree", "rock", "bush", "scrap"]
const STATES := ["waiting", "following", "home", "dead", "lost"]
const TASK_TEXTS := [
	"Ты слабеешь: согрейся, поешь и отдохни", "Поешь (F)", "Найди еду: ягоды, зайцы, рыба во льду", "Согрейся в хижине у печи",
	"Согрейся у костра", "Подкинь дров в костёр", "Наруби дров для костра", "Ночь: поспи в хижине", "Почини хижину: стены",
	"Сделай кирку на верстаке", "Почини хижину: крыша", "Почини хижину: дверь", "Сложи печь в хижине", "Построй частокол вокруг лагеря",
	"Сделай лопату: к Плотнику не пройти через сугробы", "Сделай ледоруб: Кузнец за озером", "Спаси выжившего: {name}",
	"Сделай нары для выживших", "Улучши дом: {name}", "Держись до весны", "Помоги путнику", "Почини крышу", "Найди ребёнка до ночи", "Торговец у ворот", "Медведь рядом: уходи в лагерь",
]
const SAVE_KEY := "winter.save"

## The tables of data/*.tres in core.js's shape (TOOLS, HUT_STAGES, FIRE, BEAR...).
static var D: Dictionary = WinterData.tables()

# Caches like the module-level ones in core.js; never saved.
static var _node_index := PackedByteArray()
static var _node_index_of = null
static var _node_index_stamp := -1
static var _node_index_nodes = null
static var _mask_g = null
static var _mask_t := 0.0
static var _mask: Dictionary = {}


# ── Small helpers ──

static func clamp_(v: float, a: float, b: float) -> float:
	return maxf(a, minf(b, v))


static func finite(v) -> bool:
	return (v is float or v is int) and not is_inf(float(v)) and not is_nan(float(v))


static func _is_int(v) -> bool:
	return finite(v) and float(v) == floorf(float(v))


static func _round(v: float) -> float:
	var r := floorf(v)
	return r + 1.0 if v - r >= 0.5 else r


static func hyp(x: float, y: float) -> float:
	return WinterRng.hypot(x, y)


static func _has(list: Array, v) -> bool:
	for e in list:
		if e == v:
			return true
	return false


static func idx(x, y) -> int:
	return int(y) * W + int(x)


static func in_map(x, y) -> bool:
	return x >= 0 and y >= 0 and x < W and y < H


static func in_base(x, y) -> bool:
	return x >= BASE.x0 and x <= BASE.x1 and y >= BASE.y0 and y <= BASE.y1


static func _fl(v) -> int:
	return floori(float(v))


static func _next(holder: Dictionary, key: String) -> float:
	var r := WinterRng.next(int(holder[key]))
	holder[key] = r[0]
	return r[1]


static func rand(g: Dictionary) -> float:
	return _next(g, "rng")


## The second stream, for the content added after the first release (events, the trader, the bear, snares), so the
## old content of a seed (animals, wolves) plays out the same as before.
static func erand(g: Dictionary) -> float:
	return _next(g, "erng")


static func _rnd(g: Dictionary, e: bool) -> float:
	return erand(g) if e else rand(g)


static func erng_of(seed: int) -> int:
	return (seed ^ 0x9e3779b9) & WinterRng.MASK


# ── The map ──
# '.' snow, ':' deep snow (slow), 'D' drift (impassable without the shovel), '~' lake ice (only with the ice pick),
# 'o' an ice hole (fishing, never walkable). Trees, rocks, bushes and scrap are nodes on snow tiles.
static func _gen_tiles(holder: Dictionary) -> Array:
	var t := []
	t.resize(W * H)
	t.fill(".")
	var set_ := func(x: int, y: int, c: String) -> void:
		if in_map(x, y):
			t[idx(x, y)] = c
	for y in range(2, 21):
		for x in range(44, 52):
			set_.call(x, y, "~")
	for x in range(52, W):
		for y in range(2, 6):
			set_.call(x, y, "~")
		for y in range(15, 21):
			set_.call(x, y, "~")
	for p in [[43, 8], [43, 12], [43, 16]]:
		set_.call(p[0] + 1, p[1], "o")
	for y in range(0, 11):
		for x in range(0, 11):
			if x == 10 or y == 10:
				set_.call(x, y, "D")
	for k in 14:
		var cx := floori(_next(holder, "rng") * W)
		var cy := floori(_next(holder, "rng") * H)
		var rad := 1 + floori(_next(holder, "rng") * 3)
		for y in range(cy - rad, cy + rad + 1):
			for x in range(cx - rad, cx + rad + 1):
				if not in_map(x, y) or t[idx(x, y)] != "." or in_base(x, y) or hyp(x - cx, y - cy) > rad:
					continue
				if x <= 10 and y <= 10:
					continue
				set_.call(x, y, ":")
	return t


static func _survivor_spots() -> Array:
	var out := []
	for id in D.SURVIVOR_IDS:
		out.append([D.SURVIVORS[id].x, D.SURVIVORS[id].y])
	return out


static func _gen_nodes(g: Dictionary, holder: Dictionary) -> Array:
	var nodes := []
	var taken := {}
	var spots := _survivor_spots()
	var free := func(x: int, y: int) -> bool:
		if not (in_map(x, y) and g.tiles[idx(x, y)] == "." and not in_base(x, y) and not taken.has(idx(x, y))):
			return false
		for s in spots:
			if absi(s[0] - x) <= 1 and absi(s[1] - y) <= 1:
				return false
		return not (x == BASE.x0 - 1 or x == BASE.x1 + 1 or y == BASE.y0 - 1 or y == BASE.y1 + 1)
	var add := func(kind: String, x: int, y: int, amount) -> void:
		taken[idx(x, y)] = true
		nodes.append({id = nodes.size(), kind = kind, x = x, y = y, amount = amount, max = amount, regrowAt = 0})
	var amount: Dictionary = D.NODE.amount
	# guaranteed resources near the base: trees, rocks, bushes, and scrap worth ≥ 20 metal on this side of the lake
	for pair in [["tree", 8], ["rock", 3], ["bush", 3], ["scrap", 4]]:
		var k := 0
		var guard := 0
		while k < pair[1] and guard < 500:
			var ang := _next(holder, "rng") * PI * 2
			var dist := 8 + _next(holder, "rng") * 7
			var x := int(_round(27.5 + cos(ang) * dist))
			var y := int(_round(19.5 + sin(ang) * dist))
			guard += 1
			if not free.call(x, y) or x >= 43:
				continue
			add.call(pair[0], x, y, amount[pair[0]])
			k += 1
	# the forest
	for y in H:
		for x in W:
			if not free.call(x, y):
				continue
			var v := _next(holder, "rng")
			if v < 0.13:
				add.call("tree", x, y, amount.tree)
			elif v < 0.155:
				add.call("rock", x, y, amount.rock)
			elif v < 0.175:
				add.call("bush", x, y, amount.bush)
			elif v < 0.18:
				add.call("scrap", x, y, amount.scrap)
	# the smith's pocket has scrap of its own
	add.call("scrap", 54, 8, 10)
	return nodes


# ── Game ──
## A new winter. difficulty: "normal" | "harsh". → the state, or {} for a bad difficulty.
static func new_game(difficulty := "normal", seed = 1) -> Dictionary:
	if not D.DIFF.has(difficulty):
		push_error("bad difficulty %s" % difficulty)
		return {}
	var s: int = (floori(float(seed)) & WinterRng.MASK) if finite(seed) else 1
	var holder := {rng = s}
	var survivors := []
	for id in D.SURVIVOR_IDS:
		survivors.append({id = id, state = "waiting", x = D.SURVIVORS[id].x + 0.5, y = D.SURVIVORS[id].y + 0.5, hp = STAT_MAX, food = 70, work = 0, path = null, cd = 0})
	var g := {
		v = 1, seed = s, rng = (s ^ 0x5bd1e995) & WinterRng.MASK, erng = erng_of(s), difficulty = difficulty, t = 0.0, acc = 0.0, status = "playing",
		tiles = _gen_tiles(holder), nodes = [],
		hero = {
			x = SPOT.fire.x + 0.5, y = SPOT.fire.y + 1.5, warmth = STAT_MAX, food = 80, energy = STAT_MAX, health = STAT_MAX,
			path = null, target = null, work = 0, cd = 0, load = 0, sleeping = false, dir = null,
		},
		stock = {wood = 10, stone = 0, metal = 0, hide = 0, berries = 4, meat = 0, fish = 0, cookedMeat = 2, cookedFish = 0, smokedMeat = 0, smokedFish = 0},
		tools = {axe = true, ironAxe = false, pick = false, shovel = false, icePick = false, spear = false},
		fire = {fuel = 12},
		hut = {stage = 0, paid = {}, stove = 0, roofHole = false, patchPaid = {}},
		event = null, lastEvent = null, eventsSeen = {}, iceDay = 0, trader = null, bear = null,
		palisade = [], bunks = [{built = false, paid = {}}, {built = false, paid = {}}, {built = false, paid = {}}],
		upgrades = _new_upgrades(),
		gear = {coat = false, lantern = false, sled = false, snares = 0},
		snares = [], torches = [], survivors = survivors,
		animals = [], wolves = [], nextId = 1,
		events = [], deaths = [],
	}
	for k in SEGMENTS.size():
		g.palisade.append({built = false, hp = 0, paid = {}})
	g.nodes = _gen_nodes(g, holder)
	for k in 6:
		_spawn_animal(g, "rabbit")
	for k in 3:
		_spawn_animal(g, "deer")
	return g


static func _new_upgrades() -> Dictionary:
	var u := {}
	for id in D.UPGRADE_IDS:
		u[id] = {built = false, paid = {}}
	u.smokehouse.work = 0
	u.smokehouse.fuel = 0
	return u


static func upgrade_on(g: Dictionary, id: String) -> bool:
	return g.get("upgrades") is Dictionary and g.upgrades.has(id) and g.upgrades[id] is Dictionary and g.upgrades[id].get("built", false) == true


static func status(g: Dictionary) -> String:
	return g.status


## The events since the last call (and forgets them).
static func drain(g: Dictionary) -> Array:
	var ev: Array = g.events
	g.events = []
	return ev


# ── Time and weather ──
static func day_of(g: Dictionary) -> int:
	return floori(float(g.t) / DAY) + 1


static func time_of_day(g: Dictionary) -> float:
	return fmod(float(g.t), DAY)


static func is_night(g: Dictionary) -> bool:
	return time_of_day(g) >= NIGHT_AT


static func is_blizzard(g: Dictionary, day := -1) -> bool:
	return _has(D.BLIZZARDS[g.difficulty], day_of(g) if day < 0 else day)


## The outside temperature on a day: mild at first, the deepest cold on days 15–24, a thaw from day 28.
static func base_temp(day: int) -> float:
	if day <= 10:
		return -5.0 - day
	if day <= 14:
		return -15.0 - (day - 10) * 2
	if day <= 24:
		return -25.0
	if day <= 27:
		return -20.0
	return -8.0


static func temperature(g: Dictionary) -> float:
	var t := base_temp(day_of(g))
	if is_night(g):
		t -= 8
	if is_blizzard(g):
		t -= 10
	if g.event != null and g.event.id == "thaw":
		t += D.THAW.warm
	return t


## Warmth lost per second outside any heat.
static func chill(g: Dictionary) -> float:
	return (maxf(0.0, -temperature(g)) / 15.0) * D.DIFF[g.difficulty].cold


# ── Tiles and walking ──
static func node_at(g: Dictionary, x, y):
	for n in g.nodes:
		if n.x == x and n.y == y and n.amount > 0:
			return n
	return null


static func _blocked_by_node(g: Dictionary, x: int, y: int) -> bool:
	var stamp := int(g.get("nodeStamp", 0))
	if not is_same(_node_index_of, g) or _node_index.is_empty() or _node_index_stamp != stamp or not is_same(_node_index_nodes, g.nodes):
		_node_index = PackedByteArray()
		_node_index.resize(W * H)
		_node_index_stamp = stamp
		_node_index_nodes = g.nodes
		_node_index_of = g
		for n in g.nodes:
			if n.amount > 0:
				_node_index[idx(n.x, n.y)] = 1
	return _node_index[idx(x, y)] == 1


static func _touch_nodes(g: Dictionary) -> void:
	g.nodeStamp = int(g.get("nodeStamp", 0)) + 1


## Can the hero (or a survivor following him) stand on this tile with these tools? null tools = the hero's.
static func walkable(g: Dictionary, x, y, tools = null) -> bool:
	if tools == null:
		tools = g.tools
	if not in_map(x, y):
		return false
	var c: String = g.tiles[idx(x, y)]
	if c == "o":
		return false
	if c == "~" and not tools.get("icePick", false):
		return false
	if c == "D" and not tools.get("shovel", false):
		return false
	return not _blocked_by_node(g, int(x), int(y))


static func _tile_cost(g: Dictionary, x: int, y: int) -> float:
	var c: String = g.tiles[idx(x, y)]
	return D.DEEP if c == ":" else 3.0 if c == "D" else 1.0


## A* over tiles with costs; goal(x, y) decides the end. → [{x, y}] (without the start) or null.
static func astar(g: Dictionary, from: Dictionary, goal: Callable, h: Callable, tools, pass_: Callable, limit := W * H * 4):
	var sx := _fl(from.x)
	var sy := _fl(from.y)
	if not in_map(sx, sy):
		return null
	var dist := PackedFloat64Array()
	dist.resize(W * H)
	dist.fill(INF)
	var prev := PackedInt32Array()
	prev.resize(W * H)
	prev.fill(-1)
	var closed := PackedByteArray()
	closed.resize(W * H)
	var heap := []
	var tie := 0
	var start := idx(sx, sy)
	dist[start] = 0.0
	# push
	heap.append([float(h.call(sx, sy)), tie, start])
	tie += 1
	var guard := 0
	while heap.size() > 0 and guard < limit:
		guard += 1
		# pop
		var top: Array = heap[0]
		var last: Array = heap.pop_back()
		if heap.size() > 0:
			heap[0] = last
			var k := 0
			while true:
				var l := 2 * k + 1
				var r := l + 1
				var m := k
				if l < heap.size() and _less(heap[l], heap[m]):
					m = l
				if r < heap.size() and _less(heap[r], heap[m]):
					m = r
				if m == k:
					break
				var tmp = heap[m]
				heap[m] = heap[k]
				heap[k] = tmp
				k = m
		var i: int = top[2]
		if closed[i]:
			continue
		closed[i] = 1
		var x := i % W
		var y := (i - x) / W
		if goal.call(x, y):
			var path := []
			var kk := i
			while kk != start and kk != -1:
				path.append({x = kk % W, y = kk / W})
				kk = prev[kk]
			path.reverse()
			return path
		for dd in DIRS4:
			var nx: int = x + dd[0]
			var ny: int = y + dd[1]
			if not pass_.is_null():
				if not pass_.call(nx, ny):
					continue
			elif not walkable(g, nx, ny, tools):
				continue
			var j := idx(nx, ny)
			var c := dist[i] + _tile_cost(g, nx, ny)
			if closed[j] or c >= dist[j]:
				continue
			dist[j] = c
			prev[j] = i
			heap.append([c + float(h.call(nx, ny)), tie, j])
			tie += 1
			var q := heap.size() - 1
			while q > 0:
				var p := (q - 1) >> 1
				if _less(heap[p], heap[q]):
					break
				var tmp2 = heap[p]
				heap[p] = heap[q]
				heap[q] = tmp2
				q = p
	return null


static func _less(a: Array, b: Array) -> bool:
	return a[0] < b[0] or (a[0] == b[0] and a[1] < b[1])


static func _manhattan(tx: int, ty: int) -> Callable:
	return func(x: int, y: int) -> float: return float(absi(x - tx) + absi(y - ty))


static func path_to(g: Dictionary, from: Dictionary, tx: int, ty: int, tools = null):
	if not walkable(g, tx, ty, tools):
		return null
	return astar(g, from, func(x: int, y: int) -> bool: return x == tx and y == ty, _manhattan(tx, ty), tools, Callable())


## A path to any walkable tile next to (tx, ty) (or onto it when it's walkable itself).
static func path_next_to(g: Dictionary, from: Dictionary, tx: int, ty: int, tools = null):
	var goal := func(x: int, y: int) -> bool:
		return absi(x - tx) + absi(y - ty) == 1 or (x == tx and y == ty and walkable(g, x, y, tools))
	var h := func(x: int, y: int) -> float: return float(maxi(0, absi(x - tx) + absi(y - ty) - 1))
	return astar(g, from, goal, h, tools, Callable())


static func ice_on(g: Dictionary) -> bool:
	return g.iceDay == day_of(g)


## The crust after a thaw slows the hero outside the camp.
static func _ice_slow(g: Dictionary, e: Dictionary) -> float:
	return D.THAW.ice if is_same(e, g.hero) and ice_on(g) and not in_base(_fl(e.x), _fl(e.y)) else 1.0


## Moves an entity along its path; deep snow slows it. A drift on the way is dug out (the shovel).
static func _follow(g: Dictionary, e: Dictionary, speed: float, dt: float) -> void:
	var left := speed * _ice_slow(g, e) * dt
	while e.path != null and e.path.size() > 0 and left > 0:
		var w: Dictionary = e.path[0]
		if not walkable(g, w.x, w.y, g.tools):
			e.path = null
			break
		var cx: float = w.x + 0.5
		var cy: float = w.y + 0.5
		var here: String = g.tiles[idx(_fl(e.x), _fl(e.y))]
		var slow: float = 1.0 / D.DEEP if here == ":" or g.tiles[idx(w.x, w.y)] == ":" else 1.0
		var d := hyp(cx - e.x, cy - e.y)
		var step_: float = left * slow
		if d <= step_:
			e.x = cx
			e.y = cy
			left -= d / slow
			e.path.pop_front()
			if g.tiles[idx(w.x, w.y)] == "D":
				g.tiles[idx(w.x, w.y)] = "."
				g.events.append({type = "dig", x = w.x, y = w.y})
		else:
			e.x += ((cx - e.x) / d) * step_
			e.y += ((cy - e.y) / d) * step_
			left = 0
	if e.path != null and e.path.size() == 0:
		e.path = null


# ── Stock ──
static func afford(g: Dictionary, cost: Dictionary) -> bool:
	for k in cost:
		if g.stock.get(k, 0) < cost[k]:
			return false
	return true


static func _pay(g: Dictionary, cost: Dictionary) -> void:
	for k in cost:
		g.stock[k] -= cost[k]


static func stock_total(g: Dictionary) -> float:
	var a := 0.0
	for k in RES:
		a += g.stock.get(k, 0)
	return a


static func food_total(g: Dictionary) -> float:
	var a := 0.0
	for k in FOOD_ITEMS:
		a += g.stock.get(k, 0)
	return a


static func food_cap(g: Dictionary) -> float:
	return D.FOOD_CAP + (D.CELLAR_FOOD if upgrade_on(g, "cellar") else 0.0)


static func room_for(g: Dictionary, item: String) -> float:
	return maxf(0.0, food_cap(g) - food_total(g) if _has(FOOD_ITEMS, item) else D.STORE_CAP - stock_total(g))


static func carry_of(g: Dictionary) -> float:
	return D.SLED_CARRY if g.get("gear") is Dictionary and g.gear.get("sled", false) else D.CARRY


static func _hero_in_base(g: Dictionary) -> bool:
	return in_base(_fl(g.hero.x), _fl(g.hero.y))


## Adds gathered items: the hero carries up to carry_of(g) away from the base; the camp holds STORE_CAP of
## materials and FOOD_CAP of food.
static func _gain(g: Dictionary, item: String, n: float) -> float:
	var room := room_for(g, item)
	var carry: float = INF if _hero_in_base(g) else carry_of(g) - g.hero.load
	var k := maxf(0.0, minf(n, minf(room, carry)))
	g.stock[item] += k
	if not _hero_in_base(g):
		g.hero.load += k
	return k


static func _full(g: Dictionary, item: String) -> bool:
	return (room_for(g, item) <= 0 if item != "" else false) or (not _hero_in_base(g) and g.hero.load >= carry_of(g))


# ── Heat ──
static func _near(e: Dictionary, p: Dictionary, r: float) -> bool:
	return hyp(e.x - (p.x + 0.5), e.y - (p.y + 0.5)) <= r


static func in_hut(e: Dictionary) -> bool:
	return e.x >= HUT.x and e.x < HUT.x + HUT.w and e.y >= HUT.y and e.y < HUT.y + HUT.h + 1


static func stove_on(g: Dictionary) -> bool:
	return g.hut.stage >= 4 and g.hut.stove > 0


static func fire_on(g: Dictionary) -> bool:
	return g.fire.fuel > 0


## How warmth changes per second for someone at e.
static func warmth_rate(g: Dictionary, e: Dictionary) -> float:
	if in_hut(e) and stove_on(g):
		return 2.0
	var loss := chill(g)
	if is_same(e, g.hero) and g.get("gear") is Dictionary and g.gear.get("coat", false):
		loss *= D.COAT
	if in_hut(e) and g.hut.stage >= 2:
		loss *= D.ROOF_HOLE.chill if g.hut.roofHole else (D.INSULATION.chill if upgrade_on(g, "insulation") else 0.4)
	if fire_on(g) and _near(e, SPOT.fire, D.FIRE.radius):
		return D.FIRE.warm - loss
	return -loss


## Light keeps wolves away: a fed fire, a fed stove, torches.
static func lit(g: Dictionary, x: int, y: int) -> bool:
	var c := {x = x + 0.5, y = y + 0.5}
	if fire_on(g) and _near(c, SPOT.fire, D.FIRE.radius):
		return true
	if stove_on(g) and _near(c, {x = HUT.x + 1, y = HUT.y}, 3):
		return true
	for t in g.torches:
		if _near(c, t, D.TORCH.radius):
			return true
	return false


static func _burn_tick(g: Dictionary) -> void:
	var blz := 1.5 if is_blizzard(g) else 1.0
	if g.fire.fuel > 0:
		g.fire.fuel = maxf(0.0, g.fire.fuel - (TICK / D.FIRE.burn) * blz)
		if g.fire.fuel == 0:
			g.events.append({type = "fireOut"})
	if g.hut.stage >= 4 and g.hut.stove > 0:
		g.hut.stove = maxf(0.0, g.hut.stove - (TICK / D.STOVE.burn) * (D.INSULATION.stove if upgrade_on(g, "insulation") else 1.0) * (D.ROOF_HOLE.stove if g.hut.roofHole else 1.0))


## The smokehouse smokes raw meat (then fish) from the stock on its own, burning a log for every few pieces.
static func _smoke_tick(g: Dictionary, dt: float) -> void:
	if not upgrade_on(g, "smokehouse"):
		return
	var sh: Dictionary = g.upgrades.smokehouse
	var raw = "meat" if g.stock.meat > 0 else ("fish" if g.stock.fish > 0 else null)
	if raw == null:
		sh.work = 0
		return
	sh.work = minf(D.SMOKE.every, sh.work + dt)
	if sh.work < D.SMOKE.every:
		return
	if sh.fuel <= 0:
		if g.stock.wood <= 0:
			return
		g.stock.wood -= 1
		sh.fuel = D.SMOKE.perLog
	sh.work = 0
	sh.fuel -= 1
	g.stock[raw] -= 1
	var out := "smokedMeat" if raw == "meat" else "smokedFish"
	g.stock[out] += 1
	g.events.append({type = "smoked", item = out})


# ── The hero's stats ──
static func _stats_tick(g: Dictionary, dt: float) -> void:
	var h: Dictionary = g.hero
	h.warmth = clamp_(h.warmth + warmth_rate(g, h) * dt, 0, STAT_MAX)
	h.food = clamp_(h.food - D.FOOD_DRAIN * dt, 0, STAT_MAX)
	var e: float = -D.ENERGY_DRAIN
	if h.sleeping:
		e = D.SLEEP_ENERGY
	elif fire_on(g) and _near(h, SPOT.fire, D.FIRE.radius) and h.path == null and h.target == null:
		e = D.FIRE_REST
	h.energy = clamp_(h.energy + e * dt, 0, STAT_MAX)
	var zeros := int(h.warmth <= 0) + int(h.food <= 0) + int(h.energy <= 0)
	if zeros:
		h.health = clamp_(h.health - D.HEALTH_LOSS * zeros * dt, 0, STAT_MAX)
	elif h.warmth > 40 and h.food > 40 and h.energy > 40:
		h.health = clamp_(h.health + D.HEALTH_GAIN * dt, 0, STAT_MAX)


# ── Actions ──
static func _clear_order(h: Dictionary) -> void:
	h.path = null
	h.target = null
	h.work = 0


static func _sgn(v) -> int:
	if not finite(v) or v == 0:
		return 0
	return 1 if v > 0 else -1


## Free walking (WASD): a direction, or 0, 0 to stop.
static func move_dir(g: Dictionary, dx, dy) -> void:
	var h: Dictionary = g.hero
	var sx := _sgn(dx)
	var sy := _sgn(dy)
	if sx or sy:
		_clear_order(h)
		h.sleeping = false
	h.dir = {x = sx, y = sy} if sx or sy else null


static func _move_free(g: Dictionary, dt: float) -> void:
	var h: Dictionary = g.hero
	var slow: float = 1.0 / D.DEEP if g.tiles[idx(_fl(h.x), _fl(h.y))] == ":" else 1.0
	var len := hyp(h.dir.x, h.dir.y)
	var d: float = (D.SPEED * slow * _ice_slow(g, h) * dt) / len
	if _fits(g, h.x + h.dir.x * d, h.y):
		h.x += h.dir.x * d
	if _fits(g, h.x, h.y + h.dir.y * d):
		h.y += h.dir.y * d
	var tx := _fl(h.x)
	var ty := _fl(h.y)
	if g.tiles[idx(tx, ty)] == "D" and g.tools.shovel:
		g.tiles[idx(tx, ty)] = "."


static func _fits(g: Dictionary, x: float, y: float) -> bool:
	for o in [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]:
		if not walkable(g, floori(x + o[0]), floori(y + o[1])):
			return false
	return true


static func _order(g: Dictionary, target, path) -> void:
	var h: Dictionary = g.hero
	h.dir = null
	h.sleeping = false
	h.target = target
	h.path = path
	h.work = 0


static func _or_empty(p):
	return p if p != null else []


## What a tap on tile (x, y) means. → "chop" | "mine" | "pick" | "scrap" | "hunt" | "fish" | "fire" | "bed" | "rescue"
## | "fight" | "torch" | "walk" | "trader" | "wanderer" | "fetch" | "tool" (a missing tool) | "none".
## opts.torch = true places a torch there instead.
static func interact(g: Dictionary, xf, yf, opts := {}) -> String:
	if g.status != "playing":
		return "none"
	var x := floori(float(xf))
	var y := floori(float(yf))
	if not in_map(x, y):
		return "none"
	var h: Dictionary = g.hero
	for w in g.wolves:
		if _fl(w.x) == x and _fl(w.y) == y:
			_order(g, {type = "wolf", id = w.id}, _or_empty(path_next_to(g, h, x, y)))
			return "fight"
	var bear = g.bear
	if bear != null and absf(bear.x - (x + 0.5)) < 1 and absf(bear.y - (y + 0.5)) < 1:
		_order(g, {type = "bear"}, _or_empty(path_next_to(g, h, _fl(bear.x), _fl(bear.y))))
		return "fight"
	for a in g.animals:
		if absf(a.x - (x + 0.5)) < 1 and absf(a.y - (y + 0.5)) < 1:
			if a.kind == "deer" and not g.tools.spear:
				return "tool"
			_order(g, {type = "animal", id = a.id}, _or_empty(path_next_to(g, h, x, y)))
			return "hunt"
	var n = node_at(g, x, y)
	if n != null:
		var need = "pick" if n.kind == "rock" else ("axe" if n.kind == "tree" else null)
		if need != null and not g.tools[need]:
			return "tool"
		var path = path_next_to(g, h, x, y)
		if path == null:
			return "none"
		_order(g, {type = "node", id = n.id}, path)
		return {tree = "chop", rock = "mine", bush = "pick", scrap = "scrap"}[n.kind]
	if g.tiles[idx(x, y)] == "o":
		var path = path_next_to(g, h, x, y)
		if path == null:
			return "none"
		_order(g, {type = "hole", x = x, y = y}, path)
		return "fish"
	if g.trader != null and g.trader.x == x and g.trader.y == y:
		var path = path_next_to(g, h, x, y)
		if path == null:
			return "none"
		_order(g, {type = "walk"}, path)
		return "trader"
	var ev = g.event
	if ev != null and ev.id == "wanderer" and ev.phase == "active" and ev.x == x and ev.y == y:
		var path = path_next_to(g, h, x, y)
		if path == null:
			return "none"
		_order(g, {type = "wanderer"}, path)
		return "wanderer"
	for s in g.survivors:
		if s.state == "lost" and _fl(s.x) == x and _fl(s.y) == y:
			var path = path_next_to(g, h, x, y)
			if path == null:
				return "none"
			_order(g, {type = "fetch", id = s.id}, path)
			return "fetch"
	for s in g.survivors:
		if s.state == "waiting" and _fl(s.x) == x and _fl(s.y) == y:
			var path = path_next_to(g, h, x, y)
			if path == null:
				return "none"
			_order(g, {type = "survivor", id = s.id}, path)
			return "rescue"
	if x == SPOT.fire.x and y == SPOT.fire.y:
		_order(g, {type = "fire"}, _or_empty(path_next_to(g, h, x, y)))
		return "fire"
	if x == SPOT.bed.x and y == SPOT.bed.y and g.hut.stage >= 2:
		_order(g, {type = "bed"}, _or_empty(path_to(g, h, x, y)))
		return "bed"
	if opts.get("torch", false):
		return "torch" if place_torch(g, x, y) else "none"
	var p = path_to(g, h, x, y)
	if p == null:
		return "none"
	_order(g, {type = "walk"}, p)
	return "walk"


static func _find_id(list: Array, id):
	for e in list:
		if e.id == id:
			return e
	return null


static func _without(list: Array, e) -> Array:
	var out := []
	for x in list:
		if not is_same(x, e):
			out.append(x)
	return out


## The work at the target, once the hero stands next to it.
static func _work_tick(g: Dictionary, dt: float) -> void:
	var h: Dictionary = g.hero
	var tg = h.target
	if tg == null or h.path != null:
		return
	h.cd = maxf(0.0, h.cd - dt)
	match tg.type:
		"walk":
			_clear_order(h)
		"node":
			var nodes: Array = g.nodes
			var ni := int(tg.id)
			var n = nodes[ni] if ni >= 0 and ni < nodes.size() else null
			if n == null or n.amount <= 0 or _full(g, ITEM_OF[n.kind]):
				_clear_order(h)
				return
			if h.cd > 0:
				return
			h.cd = D.NODE.hitCd[n.kind]
			h.energy = maxf(0.0, h.energy - D.WORK_ENERGY)
			var item: String = ITEM_OF[n.kind]
			var per: float = (D.NODE.perHit.treeIronAxe if g.tools.ironAxe else D.NODE.perHit.tree) if n.kind == "tree" else D.NODE.perHit[n.kind]
			var got := _gain(g, item, minf(per, n.amount))
			n.amount -= got
			g.events.append({type = "gather", kind = n.kind, item = item, n = got, x = n.x, y = n.y})
			if n.amount <= 0:
				var days: float = D.NODE.regrowDays.get(n.kind, INF)
				n.regrowAt = g.t + days * DAY
				_touch_nodes(g)
				_clear_order(h)
		"hole":
			if _full(g, "fish"):
				_clear_order(h)
				return
			h.work += dt
			if h.work >= D.FISH_TIME:
				h.work = 0
				h.energy = maxf(0.0, h.energy - D.WORK_ENERGY)
				_gain(g, "fish", 1)
				g.events.append({type = "fish", x = tg.x, y = tg.y})
		"fire":
			# feed the fire while it's under half, else cook raw food
			if h.cd > 0:
				return
			if g.fire.fuel < D.FIRE.cap / 2.0 and g.stock.wood > 0:
				g.stock.wood -= 1
				g.fire.fuel = minf(D.FIRE.cap, g.fire.fuel + 1)
				h.cd = D.MISC.feedCd
				g.events.append({type = "feed"})
				return
			if g.hut.stage >= 4 and g.hut.stove < D.STOVE.cap / 2.0 and g.stock.wood > 0:
				g.stock.wood -= 1
				g.hut.stove = minf(D.STOVE.cap, g.hut.stove + 1)
				h.cd = D.MISC.feedCd
				g.events.append({type = "feed", stove = true})
				return
			if fire_on(g) and (g.stock.meat > 0 or g.stock.fish > 0):
				h.work += dt
				if h.work >= D.COOK_TIME:
					h.work = 0
					if g.stock.meat > 0:
						g.stock.meat -= 1
						g.stock.cookedMeat += 1
					else:
						g.stock.fish -= 1
						g.stock.cookedFish += 1
					g.events.append({type = "cook"})
				return
			_clear_order(h)
		"bed":
			if not is_night(g) and h.energy >= STAT_MAX - 1:   # rested by day: up
				_clear_order(h)
				h.sleeping = false
				return
			if not h.sleeping:
				h.sleeping = true
				g.events.append({type = "sleep"})
		"wanderer":
			_clear_order(h)
			var ev = g.event
			if ev != null and ev.id == "wanderer" and ev.phase == "active":
				ev.phase = "ask"
				g.events.append({type = "event", id = "wanderer", phase = "ask"})
		"fetch":
			var sv = _find_id(g.survivors, tg.id)
			# he may have walked on: follow him until next to him
			if sv != null and sv.state == "lost" and hyp(sv.x - h.x, sv.y - h.y) > 1.6:
				h.path = path_next_to(g, h, _fl(sv.x), _fl(sv.y))
				if h.path == null:
					_clear_order(h)
				return
			_clear_order(h)
			if sv == null or sv.state != "lost":
				return
			sv.state = "following"
			sv.back = true
			sv.path = null
			if g.event != null and g.event.id == "lostChild":
				g.event = null
				g.events.append({type = "eventDone", id = "lostChild", choice = "fetched"})
		"survivor":
			var sv = _find_id(g.survivors, tg.id)
			_clear_order(h)
			if sv != null:
				rescue(g, sv)
		"animal":
			var a = _find_id(g.animals, tg.id)
			if a == null:
				_clear_order(h)
				return
			var reach: float = D.MISC.deerReach if a.kind == "deer" else D.MISC.animalReach
			var d := hyp(a.x - h.x, a.y - h.y)
			if d > reach:
				h.path = path_next_to(g, h, _fl(a.x), _fl(a.y))
				if h.path == null:
					_clear_order(h)
				return
			if h.cd > 0:
				return
			h.cd = D.MISC.strikeCd
			a.hp -= 2 if g.tools.spear else 1
			h.energy = maxf(0.0, h.energy - D.WORK_ENERGY)
			if a.hp <= 0:
				g.animals = _without(g.animals, a)
				_gain(g, "meat", 3 if a.kind == "deer" else 1)
				if a.kind == "deer":
					_gain(g, "hide", 1)
				g.events.append({type = "hunt", kind = a.kind, x = a.x, y = a.y})
				_clear_order(h)
		"wolf":
			var w = _find_id(g.wolves, tg.id)
			if w == null:
				_clear_order(h)
				return
			var d := hyp(w.x - h.x, w.y - h.y)
			if d > D.MISC.fightReach:
				h.path = path_next_to(g, h, _fl(w.x), _fl(w.y))
				if h.path == null:
					_clear_order(h)
				return
			if h.cd > 0:
				return
			h.cd = D.MISC.strikeCd
			_hit_wolf(g, w, 2 if g.tools.spear else 1)
		"bear":
			var b = g.bear
			if b == null:
				_clear_order(h)
				return
			var d := hyp(b.x - h.x, b.y - h.y)
			if d > D.MISC.fightReach:
				h.path = path_next_to(g, h, _fl(b.x), _fl(b.y))
				if h.path == null:
					_clear_order(h)
				return
			if h.cd > 0:
				return
			h.cd = D.MISC.strikeCd
			h.energy = maxf(0.0, h.energy - D.WORK_ENERGY)
			_hit_bear(g, 2 if g.tools.spear else 1)
		_:
			_clear_order(h)


static func _hit_bear(g: Dictionary, dmg: float) -> void:
	var b: Dictionary = g.bear
	b.hp -= dmg
	g.events.append({type = "bearHit", x = b.x, y = b.y})
	if b.hp > 0:
		return
	g.bear = null
	var meat := _gain(g, "meat", D.BEAR.meat)
	var hide := _gain(g, "hide", D.BEAR.hide)
	g.events.append({type = "bearDead", x = b.x, y = b.y, meat = meat, hide = hide})
	_clear_order(g.hero)


static func _hit_wolf(g: Dictionary, w: Dictionary, dmg: float) -> void:
	w.hp -= dmg
	g.events.append({type = "hitWolf", id = w.id, x = w.x, y = w.y})
	if w.hp <= 0:
		g.wolves = _without(g.wolves, w)
		g.events.append({type = "wolfDead", x = w.x, y = w.y})
		if g.hero.target != null and g.hero.target.get("id") == w.id:
			_clear_order(g.hero)


## Eats the most filling food there is. → the item eaten, or "" (nothing, or full).
static func eat(g: Dictionary) -> String:
	if g.status != "playing":
		return ""
	var h: Dictionary = g.hero
	var item := ""
	for k in EAT_ORDER:
		if g.stock[k] > 0:
			item = k
			break
	if item == "" or h.food >= STAT_MAX - 2:
		return ""
	g.stock[item] -= 1
	h.food = clamp_(h.food + D.FOOD[item], 0, STAT_MAX)
	if item == "meat":
		h.energy = maxf(0.0, h.energy - D.RAW_MEAT_ENERGY)
	g.events.append({type = "eat", item = item})
	return item


static func place_torch(g: Dictionary, x, y) -> bool:
	if g.torches.size() >= D.TORCH.max or not afford(g, {wood = D.TORCH.cost}) or not in_map(x, y) or not walkable(g, x, y):
		return false
	for t in g.torches:
		if t.x == x and t.y == y:
			return false
	_pay(g, {wood = D.TORCH.cost})
	g.torches.append({x = x, y = y})
	g.events.append({type = "torch", x = x, y = y})
	return true


static func at_base(g: Dictionary) -> bool:
	return _hero_in_base(g)


## The workbench stands in the camp: tools are made there.
## → "ok" | "have" | "far" | "nores" | "locked" (gear before the workshop) | "bad"
static func craft(g: Dictionary, tool: String) -> String:
	if D.GEAR.has(tool) and g.status == "playing":
		return _craft_gear(g, tool)
	if not D.TOOLS.has(tool) or g.status != "playing":
		return "bad"
	if g.tools[tool]:
		return "have"
	if not at_base(g):
		return "far"
	if not afford(g, D.TOOLS[tool].cost):
		return "nores"
	_pay(g, D.TOOLS[tool].cost)
	g.tools[tool] = true
	g.events.append({type = "craft", tool = tool})
	return "ok"


## The workshop's gear. Snares are counted: a craft gives SNARE.per, up to SNARE.max in hand and out together.
static func _craft_gear(g: Dictionary, id: String) -> String:
	if not upgrade_on(g, "workshop"):
		return "locked"
	if (g.gear.snares + g.snares.size() >= D.SNARE.max) if id == "snares" else g.gear[id]:
		return "have"
	if not at_base(g):
		return "far"
	if not afford(g, D.GEAR[id].cost):
		return "nores"
	_pay(g, D.GEAR[id].cost)
	if id == "snares":
		g.gear.snares = minf(D.SNARE.max - g.snares.size(), g.gear.snares + D.SNARE.per)
	else:
		g.gear[id] = true
	g.events.append({type = "craft", tool = id})
	return "ok"


## A snare from the hand onto a free tile next to the hero, outside the camp.
## → "ok" | "none" (no snare in hand) | "max" | "base" | "far" | "blocked" | "bad"
static func place_snare(g: Dictionary, xf, yf) -> String:
	if g.status != "playing" or not finite(xf) or not finite(yf):
		return "bad"
	var x := floori(float(xf))
	var y := floori(float(yf))
	if not in_map(x, y):
		return "bad"
	if g.gear.snares <= 0:
		return "none"
	if g.snares.size() >= D.SNARE.max:
		return "max"
	if in_base(x, y):
		return "base"
	if hyp(x + 0.5 - g.hero.x, y + 0.5 - g.hero.y) > 2:
		return "far"
	if g.tiles[idx(x, y)] != "." or _blocked_by_node(g, x, y):
		return "blocked"
	for n in g.snares:
		if n.x == x and n.y == y:
			return "blocked"
	for t in g.torches:
		if t.x == x and t.y == y:
			return "blocked"
	g.gear.snares -= 1
	g.snares.append({x = x, y = y})
	g.events.append({type = "snare", x = x, y = y})
	return "ok"


## At dawn every snare out may hold a rabbit; the meat goes to the camp's stock.
static func _snares_at_dawn(g: Dictionary) -> void:
	for n in g.snares:
		if erand(g) >= D.SNARE.chance or room_for(g, "meat") <= 0:
			continue
		g.stock.meat += 1
		g.events.append({type = "snareCaught", x = n.x, y = n.y})


# ── Events of the day ──
static func _event_when(g: Dictionary, id: String) -> bool:
	match id:
		"roof":
			return is_blizzard(g) and g.hut.stage >= 3 and day_of(g) >= 5 and not g.hut.roofHole
		"lostChild":
			for s in g.survivors:
				if s.id == "child" and s.state == "home" and s.hp >= 50:
					return true
			return false
		"thaw":
			return day_of(g) <= D.THAW.lastDay
	return true


static func _fire_dist(x: int, y: int) -> float:
	return hyp(x - SPOT.fire.x, y - SPOT.fire.y)


static func _event_start(g: Dictionary, id: String):
	match id:
		"roof":
			return {id = "roof", phase = "ask"}
		"wanderer":
			var c := {x = SPOT.fire.x + 0.5, y = SPOT.fire.y + 1.5}
			var pred := func(x: int, y: int) -> bool:
				var d := _fire_dist(x, y)
				return d >= D.WANDERER.near and d <= D.WANDERER.far and path_next_to(g, c, x, y) != null
			var p = _free_tile(g, pred, true)
			return {id = "wanderer", phase = "active", x = p.x, y = p.y} if p != null else null
		"lostChild":
			var sv = _find_id(g.survivors, "child")
			var pred := func(x: int, y: int) -> bool:
				var d := _fire_dist(x, y)
				return d >= D.LOST_CHILD.near and d <= D.LOST_CHILD.far
			var p = _free_tile(g, pred, true)
			var path = path_to(g, sv, p.x, p.y, {}) if p != null else null
			if path == null:
				return null
			sv.state = "lost"
			sv.path = path
			sv.busy = false
			return {id = "lostChild", phase = "active", x = p.x, y = p.y}
		"aurora":
			return {id = "aurora", phase = "active"}
		"thaw":
			g.iceDay = day_of(g) + 1
			return {id = "thaw", phase = "active"}
	return null


## At dawn: maybe one event, never on the first or the last day, never the same twice in a row.
static func _pick_event(g: Dictionary) -> void:
	g.event = null
	var day := day_of(g)
	if day < 2 or day >= DAYS:
		return
	if ice_on(g):   # the thaw's crust takes the day's slot
		g.events.append({type = "ice"})
		return
	if erand(g) >= D.EVENT_CHANCE[g.difficulty]:
		return
	var can := []
	for id in D.EVENT_IDS:
		if id != g.lastEvent and g.eventsSeen.get(id, 0) < D.EVENT_MAX[id] and _event_when(g, id):
			can.append(id)
	if can.is_empty():
		return
	var ev = _event_start(g, can[floori(erand(g) * can.size())])
	if ev == null:
		return
	ev.day = day
	g.event = ev
	g.lastEvent = ev.id
	g.eventsSeen[ev.id] = g.eventsSeen.get(ev.id, 0) + 1
	g.events.append({type = "event", id = ev.id, phase = ev.phase})


## The answer to an event that asks. → "ok" | "nores" | "none" (nothing asks) | "bad"
static func answer_event(g: Dictionary, choice: String) -> String:
	if g.status != "playing":
		return "bad"
	var ev = g.event
	if ev == null or ev.phase != "ask":
		return "none"
	if not _has(D.EVENT_CHOICES.get(ev.id, []), choice):
		return "bad"
	var out := {type = "eventDone", id = ev.id, choice = choice}
	if ev.id == "roof":
		if choice == "fix":
			if not afford(g, D.ROOF_FIX):
				return "nores"
			_pay(g, D.ROOF_FIX)
		else:
			g.hut.roofHole = true
	elif ev.id == "wanderer" and choice == "help":
		var have := 0.0
		for k in D.WANDERER.foods:
			have += g.stock[k]
		if have < D.WANDERER.food:
			return "nores"
		var left: float = D.WANDERER.food
		for k in D.WANDERER.foods:
			var n := minf(left, g.stock[k])
			g.stock[k] -= n
			left -= n
		out.reward = _wanderer_reward(g)
	g.event = null
	g.events.append(out)
	return "ok"


## The wanderer's thanks: metal, hides or a tool the hero lacks. → {item, n} | {tool}
static func _wanderer_reward(g: Dictionary) -> Dictionary:
	var r := erand(g)
	var lack := []
	for k in D.WANDERER.tools:
		if not g.tools[k]:
			lack.append(k)
	if r < 1.0 / 3.0 and lack.size() > 0:
		var tool: String = lack[floori(erand(g) * lack.size())]
		g.tools[tool] = true
		return {tool = tool}
	var item := "hide" if r < 2.0 / 3.0 else "metal"
	var n := 3.0 if r < 2.0 / 3.0 else 6.0
	var k := minf(n, room_for(g, item))
	g.stock[item] += k
	return {item = item, n = k}


## Nightfall: an unanswered event takes its default; the wanderer leaves.
static func _events_at_night(g: Dictionary) -> void:
	var ev = g.event
	if ev == null:
		return
	if ev.phase == "ask":
		answer_event(g, D.EVENT_DEFAULT[ev.id])
		return
	if ev.id == "wanderer":
		g.event = null
		g.events.append({type = "eventDone", id = "wanderer", choice = "ignore"})
	if ev.id == "lostChild":
		# not found by night: a night in the forest; he finds his way back at dawn
		g.event = null
		g.events.append({type = "eventDone", id = "lostChild", choice = "night"})
		for sv in g.survivors:
			if sv.state != "lost":
				continue
			sv.hp = maxf(0.0, sv.hp - D.LOST_CHILD.night)
			if sv.hp <= 0:
				_kill_survivor(g, sv)
	if ev.id == "aurora":
		g.hero.energy = clamp_(g.hero.energy + D.AURORA.energy, 0, STAT_MAX)
		for sv in g.survivors:
			if sv.state == "home":
				sv.hp = clamp_(sv.hp + D.AURORA.hp, 0, STAT_MAX)
		g.events.append({type = "aurora"})


## At dawn a child still lost comes home by himself.
static func _lost_at_dawn(g: Dictionary) -> void:
	for sv in g.survivors:
		if sv.state != "lost":
			continue
		sv.state = "home"
		sv.path = null
		sv.x = SPOT.fire.x + 0.5
		sv.y = SPOT.fire.y + 2.5
		g.events.append({type = "found", id = sv.id})


static func _kill_survivor(g: Dictionary, sv: Dictionary) -> void:
	sv.state = "dead"
	g.deaths.append({id = sv.id, day = day_of(g)})
	g.events.append({type = "died", id = sv.id})


# ── The trader ──
static func _trader_arrives(g: Dictionary) -> void:
	g.trader = null
	if not _has(D.TRADER_DAYS[g.difficulty], day_of(g)):
		return
	var pool := []
	for i in D.TRADES.size():
		pool.append(i)
	var offers := []
	for k in D.TRADE_OFFERS:
		var t: Dictionary = D.TRADES[pool.pop_at(floori(erand(g) * pool.size()))]
		offers.append(t.duplicate(true))
	offers.append(D.TRADE_FIXED.duplicate(true))
	for o in offers:
		if not o["get"].get("tool", 0):
			continue
		var lack := []
		for k in D.TOOLS:
			if not g.tools[k]:
				lack.append(k)
		o["get"] = {tool = lack[floori(erand(g) * lack.size())]} if lack.size() > 0 else D.TRADE_NO_TOOL.duplicate(true)
	for o in offers:
		o.taken = false
	g.trader = {x = SPOT.trader.x, y = SPOT.trader.y, offers = offers}
	g.events.append({type = "trader"})


static func _trader_leaves(g: Dictionary) -> void:
	if g.trader == null:
		return
	g.trader = null
	g.events.append({type = "traderLeft"})


## One trade with the trader, standing next to his sled. → "ok" | "nores" | "far" | "taken" | "gone" | "bad"
static func trade(g: Dictionary, i) -> String:
	if g.status != "playing":
		return "bad"
	if g.trader == null:
		return "gone"
	if not _is_int(i) or int(i) < 0 or int(i) >= g.trader.offers.size():
		return "bad"
	var o: Dictionary = g.trader.offers[int(i)]
	if o.taken:
		return "taken"
	if hyp(g.trader.x + 0.5 - g.hero.x, g.trader.y + 0.5 - g.hero.y) > D.TRADE_REACH:
		return "far"
	if not afford(g, o.give):
		return "nores"
	_pay(g, o.give)
	var got := {}
	var get_: Dictionary = o["get"]
	if get_.has("tool"):
		g.tools[get_.tool] = true
		got.tool = get_.tool
	else:
		for k in get_:
			var n := minf(get_[k], room_for(g, k))
			g.stock[k] += n
			got[k] = n
	o.taken = true
	g.events.append({type = "traded", i = int(i), got = got})
	return "ok"


# ── Building (partial contributions) ──
## id: "hut" | "palisade:0"…"palisade:3" | "bunk:0"…"bunk:2" | "up:<upgrade>" | "patch".
## → {cost, paid} still to pay, null when there is nothing left, false for a bad id.
static func need_of(g: Dictionary, id):
	if not id is String:
		return false
	if id.begins_with("up:"):
		var u: String = id.substr(3)
		if not D.UPGRADES.has(u):
			return false
		return null if g.upgrades[u].built else {cost = D.UPGRADES[u].cost, paid = g.upgrades[u].paid}
	if id == "patch":
		return {cost = D.ROOF_FIX, paid = g.hut.patchPaid} if g.hut.roofHole else null
	if id == "hut":
		return {cost = D.HUT_STAGES[int(g.hut.stage)].cost, paid = g.hut.paid} if g.hut.stage < D.HUT_STAGES.size() else null
	var parts: PackedStringArray = id.split(":")
	if parts.size() != 2 or not parts[1].is_valid_int():
		return false
	var i := parts[1].to_int()
	if parts[0] == "palisade" and i >= 0 and i < g.palisade.size():
		var p: Dictionary = g.palisade[i]
		if p.built and p.hp >= D.PALISADE_HP:
			return null
		return {cost = D.PALISADE_REPAIR if p.built else D.PALISADE_COST, paid = p.paid}
	if parts[0] == "bunk" and i >= 0 and i < g.bunks.size():
		return null if g.bunks[i].built else {cost = D.BUNK_COST, paid = g.bunks[i].paid}
	return false


## Puts what the stock has toward the next stage of a building.
## → "done" (a stage finished) | "part" (paid in part) | "nores" | "built" (nothing left) | "locked" | "far" | "bad"
static func contribute(g: Dictionary, id) -> String:
	if g.status != "playing":
		return "bad"
	var need = need_of(g, id)
	if need is bool:
		return "bad"
	if need == null:
		return "built"
	if id.begins_with("up:") and g.hut.stage < D.HUT_STAGES.size():
		return "locked"
	if not at_base(g):
		return "far"
	var put := 0.0
	var left := 0.0
	for k in need.cost:
		var want: float = need.cost[k] - need.paid.get(k, 0)
		var n := minf(want, g.stock.get(k, 0))
		if n > 0:
			g.stock[k] -= n
			need.paid[k] = need.paid.get(k, 0) + n
			put += n
		left += want - n
	if left > 0:
		return "part" if put > 0 else "nores"
	_finish_stage(g, id)
	return "done"


static func _finish_stage(g: Dictionary, id: String) -> void:
	if id == "patch":
		g.hut.roofHole = false
		g.hut.patchPaid = {}
		g.events.append({type = "patched"})
		return
	if id.begins_with("up:"):
		var u := id.substr(3)
		g.upgrades[u].built = true
		g.upgrades[u].paid = {}
		g.events.append({type = "upgraded", id = u})
		return
	if id == "hut":
		g.events.append({type = "built", id = "hut", stage = D.HUT_STAGES[int(g.hut.stage)].id})
		g.hut.stage += 1
		g.hut.paid = {}
		if g.hut.stage == 4:
			g.hut.stove = D.MISC.stoveStart
		return
	var parts := id.split(":")
	var i := parts[1].to_int()
	if parts[0] == "palisade":
		g.palisade[i] = {built = true, hp = D.PALISADE_HP, paid = {}}
		g.events.append({type = "built", id = "palisade", segment = i})
	else:
		g.bunks[i] = {built = true, paid = {}}
		g.events.append({type = "built", id = "bunk", bunk = i})


static func palisade_up(g: Dictionary) -> bool:
	for p in g.palisade:
		if not (p.built and p.hp > 0):
			return false
	return true


# ── Survivors ──
## → "ok" or what is missing: "meat" | "night" | "palisade"
static func can_rescue(g: Dictionary, sv: Dictionary) -> String:
	var need: String = D.SURVIVORS[sv.id].need
	if need == "meat":
		var a := 0.0
		for k in MEATS:
			a += g.stock[k]
		return "ok" if a >= D.HUNTER_MEAT else "meat"
	if need == "day":
		return "night" if is_night(g) else "ok"
	if need == "palisade":
		return "ok" if palisade_up(g) else "palisade"
	return "ok"   # shovel and ice pick only gate the way there


static func rescue(g: Dictionary, sv: Dictionary) -> String:
	if sv.state != "waiting":
		return "bad"
	if hyp(sv.x - g.hero.x, sv.y - g.hero.y) > 1.6:
		return "far"
	var r := can_rescue(g, sv)
	if r != "ok":
		g.events.append({type = "needs", id = sv.id, need = r})
		return r
	if D.SURVIVORS[sv.id].need == "meat":
		# raw meat first; the hero cooks it at the fire and the smokehouse smokes it, so those count too
		var left: float = D.HUNTER_MEAT
		for k in MEATS:
			var n := minf(left, g.stock[k])
			g.stock[k] -= n
			left -= n
	sv.state = "following"
	g.events.append({type = "rescue", id = sv.id})
	return "ok"


static func _survivors_tick(g: Dictionary, dt: float) -> void:
	var bunks_free := 0
	for b in g.bunks:
		if b.built:
			bunks_free += 2
	var placed := 0
	for sv in g.survivors:
		if sv.state == "following":
			sv.cd -= dt
			if sv.cd <= 0 or sv.path == null:
				sv.cd = 1
				var d := hyp(sv.x - g.hero.x, sv.y - g.hero.y)
				sv.path = path_next_to(g, sv, _fl(g.hero.x), _fl(g.hero.y)) if d > 1.5 else null
			_follow(g, sv, D.SPEED * D.MISC.survivorSpeed, dt)
			if in_base(_fl(sv.x), _fl(sv.y)):
				sv.state = "home"
				sv.path = null
				if sv.get("back", false):
					sv.erase("back")
					g.events.append({type = "found", id = sv.id})
				else:
					g.events.append({type = "joined", id = sv.id})
			continue
		if sv.state == "lost":
			if sv.path != null:
				_follow(g, sv, D.SPEED * D.MISC.lostSpeed, dt)
			continue
		if sv.state != "home":
			continue
		# needs: food from the stock, a bunk, warmth (the stove or a fed fire)
		sv.food = clamp_(sv.food - D.SURVIVOR_FOOD * dt, 0, STAT_MAX)
		if sv.food < D.SURVIVOR_EAT_AT:
			for k in EAT_ORDER:
				if g.stock[k] > 0:
					g.stock[k] -= 1
					sv.food = clamp_(sv.food + D.FOOD[k], 0, STAT_MAX)
					break
		var bunk := placed < bunks_free
		placed += 1
		var annex := upgrade_on(g, "annex")
		var warm: bool = stove_on(g) or (fire_on(g) and chill(g) <= D.FIRE.warm) or (fire_on(g) and (bunk or annex))
		var ok: bool = sv.food > 0 and warm
		sv.hp = clamp_(sv.hp + (D.MISC.survivorHeal * (D.ANNEX.heal if annex else 1.0) if ok else -D.MISC.survivorHurt) * dt, 0, STAT_MAX)
		if sv.hp <= 0:
			_kill_survivor(g, sv)
			continue
		# work by day while well
		sv.busy = ok and not is_night(g)
		if not sv.busy:
			continue
		sv.work += dt
		var w: Dictionary = D.WORK[sv.id]
		if sv.work >= w.every * (D.ANNEX.work if annex else 1.0):
			sv.work = 0
			for k in w.give:
				if room_for(g, k) > 0:
					g.stock[k] += w.give[k]
			if sv.id == "herbalist" and (g.stock.meat > 0 or g.stock.fish > 0) and fire_on(g):
				if g.stock.meat > 0:
					g.stock.meat -= 1
					g.stock.cookedMeat += 1
				else:
					g.stock.fish -= 1
					g.stock.cookedFish += 1
			if sv.id == "child":
				if g.fire.fuel < D.FIRE.cap * D.MISC.childFeedAt and g.stock.wood > 0:
					g.stock.wood -= 1
					g.fire.fuel = minf(D.FIRE.cap, g.fire.fuel + 1)
				if g.hut.stage >= 4 and g.hut.stove < D.STOVE.cap * D.MISC.childFeedAt and g.stock.wood > 0:
					g.stock.wood -= 1
					g.hut.stove = minf(D.STOVE.cap, g.hut.stove + 1)
			if sv.id == "smith" or sv.id == "carpenter":
				for p in g.palisade:
					if p.built and p.hp < D.PALISADE_HP:
						p.hp = minf(D.PALISADE_HP, p.hp + D.MISC.palisadeFix)
						break
			g.events.append({type = "work", id = sv.id})


# ── Animals ──
static func _free_tile(g: Dictionary, pred: Callable = Callable(), use_e := false):
	for guard in 400:
		var x := floori(_rnd(g, use_e) * W)
		var y := floori(_rnd(g, use_e) * H)
		if g.tiles[idx(x, y)] == "." and not _blocked_by_node(g, x, y) and not in_base(x, y) and x < 43 and (pred.is_null() or pred.call(x, y)):
			return {x = x, y = y}
	return null


static func _spawn_animal(g: Dictionary, kind: String) -> void:
	var p = _free_tile(g, func(x: int, y: int) -> bool: return hyp(x - 27, y - 20) > 8)
	if p == null:
		return
	var id = g.nextId
	g.nextId += 1
	g.animals.append({id = id, kind = kind, x = p.x + 0.5, y = p.y + 0.5, hp = 2 if kind == "deer" else 1, tx = p.x, ty = p.y, cd = 0})


static func _count_kind(list: Array, kind: String) -> int:
	var n := 0
	for a in list:
		if a.kind == kind:
			n += 1
	return n


static func _animals_tick(g: Dictionary, dt: float) -> void:
	for a in g.animals:
		a.cd -= dt
		var d := hyp(a.x - g.hero.x, a.y - g.hero.y)
		var speed: float = D.MISC.deerSpeed if a.kind == "deer" else D.MISC.rabbitSpeed
		if a.cd <= 0 or (a.x == a.tx + 0.5 and a.y == a.ty + 0.5):
			a.cd = 2 + rand(g) * 3
			# wander, or step away from the hero when close (deer run, rabbits hop)
			var tx := _fl(a.x) + floori(rand(g) * 5) - 2
			var ty := _fl(a.y) + floori(rand(g) * 5) - 2
			if d < 3:
				tx = floori(a.x + _sgnf(a.x - g.hero.x) * 2)
				ty = floori(a.y + _sgnf(a.y - g.hero.y) * 2)
			if walkable(g, tx, ty, {}) and not in_base(tx, ty):
				a.tx = tx
				a.ty = ty
		var cx: float = a.tx + 0.5
		var cy: float = a.ty + 0.5
		var dd := hyp(cx - a.x, cy - a.y)
		if dd > 0.01:
			var st := minf(dd, speed * dt)
			a.x += ((cx - a.x) / dd) * st
			a.y += ((cy - a.y) / dd) * st
		else:
			a.x = cx
			a.y = cy
	# keep the herds: a rabbit or a deer comes back now and then
	if _count_kind(g.animals, "rabbit") < D.MISC.rabbits and rand(g) < dt / D.MISC.rabbitEvery:
		_spawn_animal(g, "rabbit")
	if _count_kind(g.animals, "deer") < D.MISC.deer and rand(g) < dt / D.MISC.deerEvery:
		_spawn_animal(g, "deer")


## Math.sign for the offsets: -1, 0 or 1 (0 for 0 and NaN).
static func _sgnf(v: float) -> float:
	return 0.0 if v == 0 or is_nan(v) else (1.0 if v > 0 else -1.0)


# ── The bear ──
static func _bear_arrives(g: Dictionary) -> void:
	g.bear = null
	if not _has(D.BEAR.days[g.difficulty], day_of(g)):
		return
	var p = _free_tile(g, func(x: int, y: int) -> bool: return _fire_dist(x, y) >= D.BEAR.far, true)
	if p == null:
		return
	var id = g.nextId
	g.nextId += 1
	g.bear = {id = id, x = p.x + 0.5, y = p.y + 0.5, hp = D.BEAR.hp, cd = 0, calm = 0, path = null, plan = 0, chase = false}
	g.events.append({type = "bear", x = p.x, y = p.y})


static func _bear_leaves(g: Dictionary) -> void:
	if g.bear == null:
		return
	g.bear = null
	g.events.append({type = "bearLeft"})


## The tiles the bear may step on: open ground outside the camp and out of the light.
static func _bear_pass(g: Dictionary, x: int, y: int) -> bool:
	return in_map(x, y) and not "oD".contains(g.tiles[idx(x, y)]) and not _blocked_by_node(g, x, y) and not in_base(x, y) and not lit(g, x, y)


static func _bear_tick(g: Dictionary, dt: float) -> void:
	var b = g.bear
	if b == null:
		return
	b.cd = maxf(0.0, b.cd - dt)
	b.calm = maxf(0.0, b.get("calm", 0) - dt)
	var h: Dictionary = g.hero
	var hx := _fl(h.x)
	var hy := _fl(h.y)
	var d := hyp(h.x - b.x, h.y - b.y)
	var sees: bool = b.calm <= 0 and d <= D.BEAR.sight and not h.sleeping and _bear_pass(g, hx, hy)
	if sees and d <= D.BEAR.reach:
		if b.cd <= 0:
			b.cd = D.BEAR.cd
			b.calm = D.BEAR.calm
			b.plan = 0
			h.health = maxf(0.0, h.health - D.BEAR.bite * D.DIFF[g.difficulty].bite)
			g.events.append({type = "bite", who = "hero", by = "bear"})
		return
	b.plan -= dt
	if b.plan <= 0 or (sees and not b.chase):
		b.plan = 0.8 if sees else 3 + erand(g) * 3
		b.chase = sees
		var tx := hx
		var ty := hy
		if not sees:
			# wander: a tile within a few steps, away from the camp and the light (and from the hero while calm)
			tx = _fl(b.x) + floori(erand(g) * 9) - 4
			ty = _fl(b.y) + floori(erand(g) * 9) - 4
			if b.calm > 0:
				tx = floori(b.x + _sgnf(b.x - h.x) * 4)
				ty = floori(b.y + _sgnf(b.y - h.y) * 4)
			# near the camp he loses interest and drifts off into the forest
			elif hyp(b.x - SPOT.fire.x, b.y - SPOT.fire.y) < D.BEAR.far - 4:
				tx = floori(b.x + _sgnf(b.x - SPOT.fire.x - 0.5) * 4)
				ty = floori(b.y + _sgnf(b.y - SPOT.fire.y - 0.5) * 4)
			if not _bear_pass(g, tx, ty):
				b.path = null
				return
		var here := _fl(b.x)
		var there := _fl(b.y)
		var pass_ := func(x: int, y: int) -> bool: return _bear_pass(g, x, y) or (x == here and y == there)
		var goal: Callable
		if sees:
			goal = func(x: int, y: int) -> bool: return absi(x - tx) + absi(y - ty) <= 1
		else:
			goal = func(x: int, y: int) -> bool: return x == tx and y == ty
		b.path = astar(g, b, goal, _manhattan(tx, ty), null, pass_, 500)
	if b.path == null or b.path.size() == 0:
		b.path = null
		return
	var n: Dictionary = b.path[0]
	if not _bear_pass(g, int(n.x), int(n.y)):
		b.path = null
		b.plan = 0
		return
	var cx: float = n.x + 0.5
	var cy: float = n.y + 0.5
	var dd := hyp(cx - b.x, cy - b.y)
	var sp: float = D.BEAR.speed * dt
	if dd <= sp:
		b.x = cx
		b.y = cy
		b.path.pop_front()
	else:
		b.x += ((cx - b.x) / dd) * sp
		b.y += ((cy - b.y) / dd) * sp


# ── Wolves ──
static func wolves_tonight(g: Dictionary) -> int:
	return floori((1 + day_of(g) / 5.0) * D.DIFF[g.difficulty].wolves)


static func _people(g: Dictionary) -> Array:
	var out := [g.hero]
	for s in g.survivors:
		if s.state == "following" or s.state == "home":
			out.append(s)
	return out


static func _spawn_wolves(g: Dictionary) -> void:
	var n := wolves_tonight(g)
	var hp: float = D.WOLF_HP * (1.5 if g.difficulty == "harsh" else 1.0)
	for k in n:
		var pred := func(x: int, y: int) -> bool:
			for e in _people(g):
				if not (hyp(x + 0.5 - e.x, y + 0.5 - e.y) > D.WOLF_SAFE):
					return false
			return true
		var p = _free_tile(g, pred)
		if p == null:
			continue
		var id = g.nextId
		g.nextId += 1
		g.wolves.append({id = id, x = p.x + 0.5, y = p.y + 0.5, hp = hp, maxHp = hp, cd = 0, flee = false})
	if n:
		g.events.append({type = "howl", n = n})


## A person the wolf can reach: outside a standing palisade, or anyone when it's broken.
## Survivors at home sleep behind the hut's door once it hangs.
static func _prey(g: Dictionary, e: Dictionary) -> bool:
	var hero := is_same(e, g.hero)
	if not hero and e.state == "home" and g.hut.stage >= 3:
		return false
	if hero and g.hut.stage >= 3 and in_hut(e):   # the hero behind the hut's door, too
		return false
	return not (palisade_up(g) and in_base(_fl(e.x), _fl(e.y)))


## The tiles wolves may use this tick (no trees, rocks, ice holes or drifts) and the lit ones.
static func _wolf_masks(g: Dictionary) -> Dictionary:
	var open := PackedByteArray()
	open.resize(W * H)
	var light := PackedByteArray()
	light.resize(W * H)
	for y in H:
		for x in W:
			var i := idx(x, y)
			open[i] = 0 if "oD".contains(g.tiles[i]) or _blocked_by_node(g, x, y) else 1
	var mark := func(c: Dictionary, r: float) -> void:
		for y in range(floori(c.y - r), ceili(c.y + r) + 1):
			for x in range(floori(c.x - r), ceili(c.x + r) + 1):
				if in_map(x, y) and hyp(x - c.x, y - c.y) <= r:
					light[idx(x, y)] = 1
	if fire_on(g):
		mark.call(SPOT.fire, D.FIRE.radius)
	if stove_on(g):
		mark.call({x = HUT.x + 1, y = HUT.y}, 3.0)
	for t in g.torches:
		mark.call(t, D.TORCH.radius)
	return {open = open, light = light}


static func _wolves_tick(g: Dictionary, dt: float) -> void:
	if g.wolves.is_empty():
		return
	# the masks change slowly (a torch, a fire going out): they are rebuilt twice a second
	if _mask_g == null or not is_same(_mask_g, g) or g.t - _mask_t >= 0.5 or g.t < _mask_t:
		_mask_g = g
		_mask_t = g.t
		_mask = _wolf_masks(g)
	var M := _mask
	var mopen: PackedByteArray = M.open
	var mlight: PackedByteArray = M.light
	var fence := palisade_up(g)
	var lantern: bool = g.get("gear") is Dictionary and g.gear.get("lantern", false) and is_night(g) and not g.hero.sleeping
	for w in g.wolves:
		w.cd = maxf(0.0, w.cd - dt)
		if w.hp < w.maxHp * D.WOLF_FLEE:
			w.flee = true
		# the lantern scares a wolf that comes close, for a moment; it can come back once it wears off
		w.scared = maxf(0.0, w.get("scared", 0) - dt)
		w.lanternCd = maxf(0.0, w.get("lanternCd", 0) - dt)
		if lantern and w.lanternCd <= 0 and hyp(g.hero.x - w.x, g.hero.y - w.y) <= D.LANTERN.radius:
			w.scared = D.LANTERN.scare
			w.lanternCd = D.LANTERN.cd
			g.events.append({type = "scared", x = w.x, y = w.y})
		var target = null
		var td := INF
		var people := _people(g)
		for e in people:
			if not _prey(g, e):
				continue
			var d := hyp(e.x - w.x, e.y - w.y)
			if d < td:
				td = d
				target = e
		var gx: float
		var gy: float
		if w.flee or w.scared > 0 or target == null:
			# run from the nearest person (or stand)
			var nr: Dictionary = g.hero
			for e in people:
				if hyp(e.x - w.x, e.y - w.y) < hyp(nr.x - w.x, nr.y - w.y):
					nr = e
			gx = w.x + _sgnf(w.x - nr.x) * 3
			gy = w.y + _sgnf(w.y - nr.y) * 3
			# a wolf with nobody to hunt circles the palisade and gnaws at a segment
			if not w.flee and not (w.scared > 0) and palisade_up(g):
				var inside := false
				for e in people:
					if in_base(_fl(e.x), _fl(e.y)):
						inside = true
						break
				if inside:
					var seg := _nearest_segment(w)
					var sp := _segment_point(seg)
					if hyp(sp.x - w.x, sp.y - w.y) < 1.3:
						if w.cd <= 0:
							w.cd = D.WOLF_CD
							var p: Dictionary = g.palisade[seg]
							p.hp -= D.GNAW
							g.events.append({type = "gnaw", segment = seg})
							if p.hp <= 0:
								p.hp = 0
								g.events.append({type = "palisadeBroken", segment = seg})
						continue
					gx = sp.x
					gy = sp.y
		elif td <= 1.1:
			if w.cd <= 0:
				w.cd = D.WOLF_CD
				var bite: float = D.BITE * D.DIFF[g.difficulty].bite
				if is_same(target, g.hero):
					g.hero.health = maxf(0.0, g.hero.health - bite)
					# bitten awake: the hero turns on the wolf unless he is busy with something else
					var ht = g.hero.target
					if g.hero.sleeping or ht == null or ht.type == "bed" or ht.type == "walk":
						g.hero.sleeping = false
						_order(g, {type = "wolf", id = w.id}, [])
					g.events.append({type = "bite", who = "hero"})
				else:
					target.hp = maxf(0.0, target.hp - bite)
					g.events.append({type = "bite", who = target.id})
					if target.hp <= 0 and target.state != "dead":
						target.state = "dead"
						g.deaths.append({id = target.id, day = day_of(g)})
						g.events.append({type = "died", id = target.id})
			continue
		else:
			gx = target.x
			gy = target.y
		# a path toward the goal (re-planned every second) around trees and rocks, out of the light and the palisade
		var wx := _fl(w.x)
		var wy := _fl(w.y)
		var in_light := in_map(wx, wy) and mlight[idx(wx, wy)] == 1
		var outside := not in_base(wx, wy)
		var pass_ := func(x: int, y: int) -> bool:
			if not in_map(x, y):
				return false
			var i := idx(x, y)
			return mopen[i] == 1 and (mlight[i] == 0 or in_light) and not (fence and outside and in_base(x, y))
		var tx := clampi(floori(gx), 0, W - 1)
		var ty := clampi(floori(gy), 0, H - 1)
		w.plan = w.get("plan", 0) - dt
		if w.plan <= 0 or w.get("path") == null:
			w.plan = 1
			w.path = astar(g, w, func(x: int, y: int) -> bool: return absi(x - tx) + absi(y - ty) <= 1, _manhattan(tx, ty), null, pass_, 700)
		if w.path != null and w.path.size() > 0:
			var n: Dictionary = w.path[0]
			if not pass_.call(int(n.x), int(n.y)):
				w.path = null
				continue
			var cx: float = n.x + 0.5
			var cy: float = n.y + 0.5
			var d := hyp(cx - w.x, cy - w.y)
			var spd: float = D.WOLF_SPEED * dt
			if d <= spd:
				w.x = cx
				w.y = cy
				w.path.pop_front()
			else:
				w.x += ((cx - w.x) / d) * spd
				w.y += ((cy - w.y) / d) * spd
		else:
			# the last stretch to the goal (or no path): straight, if the tile allows
			var d := hyp(gx - w.x, gy - w.y)
			var spd := minf(d, D.WOLF_SPEED * dt)
			if d > 0.01:
				var nx: float = w.x + ((gx - w.x) / d) * spd
				var ny: float = w.y + ((gy - w.y) / d) * spd
				if pass_.call(floori(nx), floori(ny)) or (floori(nx) == wx and floori(ny) == wy):
					w.x = nx
					w.y = ny
	# a lit wolf runs: wolves inside the light flee
	for w in g.wolves:
		var i := idx(clampi(_fl(w.x), 0, W - 1), clampi(_fl(w.y), 0, H - 1))
		if mlight[i]:
			w.flee = true


static func _nearest_segment(w: Dictionary) -> int:
	var d := [absf(w.y - BASE.y0), absf(w.x - BASE.x1 - 1), absf(w.y - BASE.y1 - 1), absf(w.x - BASE.x0)]
	var m: float = d.min()
	return d.find(m)


static func _segment_point(i: int) -> Dictionary:
	return [{x = 27.5, y = BASE.y0 - 0.5}, {x = BASE.x1 + 1.5, y = 19.5}, {x = 27.5, y = BASE.y1 + 1.5}, {x = BASE.x0 - 0.5, y = 19.5}][i]


# ── Day changes ──
static func _day_tick(g: Dictionary, before: float) -> void:
	var was := floori(before / DAY)
	var now := floori(float(g.t) / DAY)
	var night_was := fmod(before, DAY) >= NIGHT_AT
	var night_now := is_night(g)
	if not night_was and night_now and now == was:
		g.events.append({type = "night", day = day_of(g)})
		var calm: bool = g.event != null and g.event.id == "aurora"
		_events_at_night(g)
		_trader_leaves(g)
		_bear_leaves(g)
		if not calm:
			_spawn_wolves(g)
	if now > was:
		# dawn: the wolves leave, bushes and trees regrow, the dawn save point
		g.wolves = []
		g.hero.sleeping = false
		for n in g.nodes:
			if n.amount <= 0 and g.t >= n.regrowAt:
				n.amount = n.max
				_touch_nodes(g)
		g.hero.load = 0 if _hero_in_base(g) else g.hero.load
		_snares_at_dawn(g)
		_lost_at_dawn(g)
		if now < DAYS:
			_trader_arrives(g)
			_bear_arrives(g)
		else:
			g.trader = null
			g.bear = null
		g.events.append({type = "dawn", day = day_of(g), blizzard = is_blizzard(g)})
		g.dawnDue = true
		if now < DAYS:
			_pick_event(g)
		if now >= DAYS:
			g.status = "won"
			g.events.append({type = "won"})


## One world tick of TICK seconds.
static func tick(g: Dictionary) -> void:
	var before: float = g.t
	g.t += TICK
	var h: Dictionary = g.hero
	if _hero_in_base(g):
		h.load = 0
	if h.dir != null:
		_move_free(g, TICK)
	elif h.path != null:
		_follow(g, h, D.SPEED, TICK)
	_work_tick(g, TICK)
	_burn_tick(g)
	_smoke_tick(g, TICK)
	_stats_tick(g, TICK)
	_survivors_tick(g, TICK)
	_animals_tick(g, TICK)
	_bear_tick(g, TICK)
	_wolves_tick(g, TICK)
	_day_tick(g, before)
	if h.health <= 0 and g.status == "playing":
		g.status = "lost"
		g.events.append({type = "lost", day = day_of(g)})


## Time asleep runs faster: a sleeping hero with a fed stove turns real time into SLEEP_SPEED × as much world time.
static func sleep_fast(g: Dictionary) -> bool:
	return g.hero.sleeping and stove_on(g) and in_hut(g.hero)


## Advances the world by dt real seconds, in fixed ticks.
static func step(g: Dictionary, dt) -> void:
	if g.status != "playing" or not finite(dt) or dt <= 0:
		return
	g.acc += minf(dt, MAX_DT) * (D.SLEEP_SPEED if sleep_fast(g) else 1.0)
	while g.acc >= TICK - 1e-9:
		g.acc -= TICK
		tick(g)
		if g.status != "playing":
			g.acc = 0.0
			break


## ★ survived, ★★ ≥ 3 survivors alive at the end, ★★★ all five alive and the hut fully repaired.
static func stars(g: Dictionary) -> int:
	if g.status != "won":
		return 0
	var alive := 0
	for s in g.survivors:
		if s.state == "home" or s.state == "lost":
			alive += 1
	if alive >= 5 and g.hut.stage >= D.HUT_STAGES.size():
		return 3
	return 2 if alive >= 3 else 1


# ── The next thing to do (the hint line) ──
## A text of TASK_TEXTS (the rescue and upgrade ones with the name filled in, as in core.js).
static func next_task(g: Dictionary) -> String:
	var h: Dictionary = g.hero
	if h.health < 30:
		return "Ты слабеешь: согрейся, поешь и отдохни"
	if g.bear != null and not at_base(g) and hyp(g.bear.x - h.x, g.bear.y - h.y) <= D.BEAR.sight + 2:
		return "Медведь рядом: уходи в лагерь"
	var any_food := false
	for k in EAT_ORDER:
		if g.stock[k] > 0:
			any_food = true
	if h.food < 30 and any_food:
		return "Поешь (F)"
	if h.food < 30:
		return "Найди еду: ягоды, зайцы, рыба во льду"
	if h.warmth < 35:
		return "Согрейся в хижине у печи" if g.hut.stage >= 4 else "Согрейся у костра"
	if g.fire.fuel < 4:
		return "Подкинь дров в костёр" if g.stock.wood > 0 else "Наруби дров для костра"
	if is_night(g) and g.hut.stage >= 2 and h.energy < 60:
		return "Ночь: поспи в хижине"
	for s in g.survivors:
		if s.state == "lost" and not is_night(g):
			return "Найди ребёнка до ночи"
	if g.event != null and g.event.id == "wanderer" and g.event.phase == "active":
		return "Помоги путнику"
	if g.trader != null:
		for o in g.trader.offers:
			if not o.taken and afford(g, o.give):
				return "Торговец у ворот"
	if g.hut.roofHole:
		return "Почини крышу"
	if g.hut.stage < 1:
		return "Почини хижину: стены"
	if not g.tools.pick:
		return "Сделай кирку на верстаке"
	if g.hut.stage < 2:
		return "Почини хижину: крыша"
	if g.hut.stage < 3:
		return "Почини хижину: дверь"
	if g.hut.stage < 4:
		return "Сложи печь в хижине"
	if not palisade_up(g):
		return "Построй частокол вокруг лагеря"
	for s in g.survivors:
		if s.state == "waiting":
			var sv: Dictionary = D.SURVIVORS[s.id]
			if sv.need == "shovel" and not g.tools.shovel:
				return "Сделай лопату: к Плотнику не пройти через сугробы"
			if sv.need == "icePick" and not g.tools.icePick:
				return "Сделай ледоруб: Кузнец за озером"
			return "Спаси выжившего: %s" % sv.name
	for b in g.bunks:
		if not b.built:
			return "Сделай нары для выживших"
	for id in D.UPGRADE_IDS:
		if not g.upgrades[id].built:
			return "Улучши дом: %s" % D.UPGRADES[id].name
	return "Держись до весны"


# ── Snapshots and the save ──
## A deep copy of the game as plain JSON-ready data (the web save shape). Fix of a core.js bug: there a depleted
## rock or scrap keeps regrowAt = Infinity, JSON turns it into null and after a reload `t >= null` regrows it at the
## next dawn. Here the snapshot writes null and restore() reads null back as "never".
static func snapshot(g: Dictionary) -> Dictionary:
	var o: Dictionary = g.duplicate(true)
	o.events = []
	o.acc = 0.0
	o.erase("dawnDue")
	o.erase("nodeStamp")
	for n in o.nodes:
		if n.regrowAt is float and is_inf(n.regrowAt):
			n.regrowAt = null
	return o


## The snapshot as JSON text (full precision, keys in their order).
static func to_json(v) -> String:
	return JSON.stringify(v, "", false, true)


static func _num(v, lo: float, hi: float) -> bool:
	return finite(v) and v >= lo and v <= hi


static func _obj(v) -> bool:
	return v is Dictionary


## Fills what a snapshot from an older build lacks, on a copy; restore validates the result as usual.
static func _migrate(o):
	if not o is Dictionary:
		return o
	var m: Dictionary = o.duplicate(true)
	if not m.has("erng") and _is_int(m.get("seed")):
		m.erng = erng_of(int(m.seed))
	if m.get("stock") is Dictionary:
		for k in ["hide", "smokedMeat", "smokedFish"]:
			if not m.stock.has(k):
				m.stock[k] = 0
	if not m.has("upgrades"):
		m.upgrades = _new_upgrades()
	if not m.has("gear"):
		m.gear = {coat = false, lantern = false, sled = false, snares = 0}
	if not m.has("snares"):
		m.snares = []
	if m.get("hut") is Dictionary:
		if not m.hut.has("roofHole"):
			m.hut.roofHole = false
		if not m.hut.has("patchPaid"):
			m.hut.patchPaid = {}
	for k in ["event", "lastEvent", "trader", "bear"]:
		if not m.has(k):
			m[k] = null
	if not m.has("eventsSeen"):
		m.eventsSeen = {}
	if not m.has("iceDay"):
		m.iceDay = 0
	return m


static func _every(list, pred: Callable) -> bool:
	if not list is Array:
		return false
	for e in list:
		if not pred.call(e):
			return false
	return true


## A game from a snapshot (a Dictionary, e.g. parsed from the save's JSON), or null when it doesn't hold up.
static func restore(raw):
	var o = _migrate(raw)
	if not o is Dictionary or o.get("v") != 1 or o.get("status") != "playing" or not D.DIFF.has(o.get("difficulty", "")):
		return null
	if not _num(o.get("t"), 0, DAY * (DAYS + 1)) or not _is_int(o.get("rng")) or not _is_int(o.get("erng")) or not o.get("tiles") is Array or o.tiles.size() != W * H:
		return null
	if not _every(o.tiles, func(c) -> bool: return c is String and ".:D~o".contains(c)):
		return null
	var h = o.get("hero")
	if not h is Dictionary:
		return null
	for k in ["warmth", "food", "energy", "health"]:
		if not _num(h.get(k), 0, STAT_MAX):
			return null
	if not _num(h.get("x"), 0, W) or not _num(h.get("y"), 0, H):
		return null
	if not _obj(o.get("stock")) or not _obj(o.get("tools")):
		return null
	for k in ITEMS:
		if not _num(o.stock.get(k), 0, 1e6):
			return null
	for k in D.TOOLS:
		if not o.tools.get(k) is bool:
			return null
	if not _every(o.get("nodes"), func(n) -> bool: return n is Dictionary and _has(NODE_KINDS, n.get("kind")) and _num(n.get("x"), 0, W - 1) and _num(n.get("y"), 0, H - 1)):
		return null
	if not _obj(o.get("hut")) or not _num(o.hut.get("stage"), 0, D.HUT_STAGES.size()) or not o.get("palisade") is Array or o.palisade.size() != 4 or not o.get("bunks") is Array:
		return null
	if not o.get("survivors") is Array or o.survivors.size() != D.SURVIVOR_IDS.size() or not _every(o.survivors, func(s) -> bool: return s is Dictionary and _has(D.SURVIVOR_IDS, s.get("id")) and _has(STATES, s.get("state"))):
		return null
	if not _obj(o.get("upgrades")):
		return null
	for id in D.UPGRADE_IDS:
		var u = o.upgrades.get(id)
		if not (u is Dictionary and u.get("built") is bool and u.get("paid") is Dictionary):
			return null
	if not _num(o.upgrades.smokehouse.get("work"), 0, D.SMOKE.every) or not _num(o.upgrades.smokehouse.get("fuel"), 0, D.SMOKE.perLog):
		return null
	var gr = o.get("gear")
	if not gr is Dictionary or not (gr.get("coat") is bool and gr.get("lantern") is bool and gr.get("sled") is bool) or not _is_int(gr.get("snares")) or not _num(gr.snares, 0, D.SNARE.max):
		return null
	if not o.get("snares") is Array or o.snares.size() > D.SNARE.max or not _every(o.snares, func(n) -> bool: return n is Dictionary and _is_int(n.get("x")) and _is_int(n.get("y")) and in_map(n.x, n.y)):
		return null
	if not o.hut.get("roofHole") is bool or not o.hut.get("patchPaid") is Dictionary:
		return null
	if o.get("lastEvent") != null and not _has(D.EVENT_IDS, o.lastEvent):
		return null
	if not _is_int(o.get("iceDay")) or not _num(o.iceDay, 0, DAYS + 1):
		return null
	if o.get("trader") != null and not _valid_trader(o.trader):
		return null
	var b = o.get("bear")
	if b != null and not (b is Dictionary and _is_int(b.get("id")) and _num(b.get("x"), 0, W) and _num(b.get("y"), 0, H) and _num(b.get("hp"), 0.001, D.BEAR.hp) and _num(b.get("cd"), 0, D.BEAR.cd) and _num(b.get("calm"), 0, D.BEAR.calm)):
		return null
	var es = o.get("eventsSeen")
	if not es is Dictionary:
		return null
	for k in es:
		if not _has(D.EVENT_IDS, k) or not _is_int(es[k]) or es[k] < 0:
			return null
	if o.get("event") != null and not _valid_event(o.event):
		return null
	if not _obj(o.get("fire")) or not _num(o.fire.get("fuel"), 0, D.FIRE.cap) or not o.get("torches") is Array or not o.get("wolves") is Array or not o.get("animals") is Array:
		return null
	var g: Dictionary = o.duplicate(true)
	g.events = []
	g.acc = 0.0
	for n in g.nodes:
		if n.get("regrowAt") == null:
			n.regrowAt = INF
	for k in ["deaths"]:
		if not g.get(k) is Array:
			g[k] = []
	_touch_nodes(g)
	return g


static func _valid_bag(bg) -> bool:
	if not bg is Dictionary or bg.is_empty():
		return false
	for k in bg:
		if not _has(ITEMS, k) or not _is_int(bg[k]) or bg[k] <= 0:
			return false
	return true


static func _valid_trader(t) -> bool:
	if not t is Dictionary or t.get("x") != SPOT.trader.x or t.get("y") != SPOT.trader.y or not t.get("offers") is Array or t.offers.size() != D.TRADE_OFFERS + 1:
		return false
	for o in t.offers:
		if not (o is Dictionary and o.get("taken") is bool and _valid_bag(o.get("give")) and o.get("get") is Dictionary):
			return false
		var get_: Dictionary = o["get"]
		if get_.has("tool"):
			if not (D.TOOLS.has(get_.tool) and get_.size() == 1):
				return false
		elif not _valid_bag(get_):
			return false
	return true


static func _valid_event(e) -> bool:
	if not e is Dictionary or not _has(D.EVENT_IDS, e.get("id")) or not _has(["ask", "active"], e.get("phase")) or not _num(e.get("day"), 1, DAYS):
		return false
	if e.id == "wanderer" or e.id == "lostChild":
		return _is_int(e.get("x")) and _is_int(e.get("y")) and in_map(e.x, e.y) and (e.id == "wanderer" or e.phase == "active")
	if e.id == "roof":
		return e.phase == "ask"
	return e.phase == "active"


## winter.save: {v: 1, best: {normal, harsh} (days survived, 31 = won), stars: {normal, harsh}, unlocked (harsh),
## current: snapshot | null, dawn: snapshot | null}
static func new_save() -> Dictionary:
	return {v = 1, best = {normal = 0, harsh = 0}, stars = {normal = 0, harsh = 0}, unlocked = false, current = null, dawn = null}


## Reads the save's JSON text; anything broken falls back to a fresh save (a broken current game is dropped).
static func parse_save(raw) -> Dictionary:
	var out := new_save()
	if not raw is String:
		return out
	var d = JSON.parse_string(raw)
	if not d is Dictionary or d.get("v") != 1:
		return out
	for k in ["normal", "harsh"]:
		if d.get("best") is Dictionary and _is_int(d.best.get(k)) and d.best[k] >= 0 and d.best[k] <= DAYS + 1:
			out.best[k] = int(d.best[k])
		if d.get("stars") is Dictionary and _is_int(d.stars.get(k)) and d.stars[k] >= 0 and d.stars[k] <= 3:
			out.stars[k] = int(d.stars[k])
	out.unlocked = d.get("unlocked") == true
	out.current = d.get("current") if restore(d.get("current")) != null else null
	out.dawn = d.get("dawn") if out.current != null and restore(d.get("dawn")) != null else null
	return out


## The save as JSON text.
static func save_text(save: Dictionary) -> String:
	return to_json(save)


## Folds a game into the records: the days lived, the stars, the harsh winter unlocked by a win.
## Returns true when a record improved.
static func record_game(save: Dictionary, g: Dictionary) -> bool:
	var k: String = g.difficulty
	var better := false
	var days := DAYS + 1 if g.status == "won" else day_of(g) - 1
	if days > save.best[k]:
		save.best[k] = days
		better = true
	var st := stars(g)
	if st > save.stars[k]:
		save.stars[k] = st
		better = true
	if g.status == "won" and not save.unlocked:
		save.unlocked = true
		better = true
	return better


## «Начать день заново»: the game as it was at the last dawn.
static func retry_day(save: Dictionary):
	return restore(save.get("dawn"))
