class_name WinterProps
extends RefCounted
## The forest: map nodes (trees, rocks, bushes, scrap) with a standing and a spent look, drifts on 'D' tiles, ice
## holes, and decor placed from the seed — ground details on free snow, a forest wall around the map's edge.
## Decor never stands where the rules let people walk, except flat things lying on the ground, so nothing tall is
## walked through. Variants come from a hash of the tile, so the same winter always looks the same.

const TILE := 96.0
const STANDING := {"tree": "tree.pine", "rock": "rock", "bush": "bush.berry", "scrap": "scrap"}
const SPENT := {"tree": "tree.stump", "rock": "rock.rubble", "bush": "bush.bare", "scrap": ""}
const RING := 4                      # tiles of forest drawn beyond the map's edge

var objects: Node2D                  # y-sorted
var details: Node2D
var shadows: Node2D
var views := {}                      # node id -> {root, standing, spent, shadow, amount}
var drifts := {}                     # tile index -> Node2D
var by_tile := {}                    # tile index -> node id
var _faded := []                     # standing sprites made see-through in front of the hero
var seed := 1


static func hash2(x: int, y: int, s: int) -> int:
	var h := (x * 374761393 + y * 668265263 + s * 2246822519) & 0x7fffffff
	h = ((h ^ (h >> 13)) * 1274126177) & 0x7fffffff
	return h ^ (h >> 16)


static func pick(prefix: String, x: int, y: int, s: int) -> String:
	return "%s.%d" % [prefix, hash2(x, y, s) % WinterArt.variants(prefix)]


func _init(objects_layer: Node2D, details_layer: Node2D, shadows_layer: Node2D) -> void:
	objects = objects_layer
	details = details_layer
	shadows = shadows_layer


func clear() -> void:
	for n in [objects, details, shadows]:
		for c in n.get_children():
			c.queue_free()
	views.clear()
	drifts.clear()
	by_tile.clear()
	_faded.clear()


func build(g: Dictionary) -> void:
	seed = int(g.seed)
	for n in g.nodes:
		_node_view(n)
	var W: int = WinterSim.W
	var H: int = WinterSim.H
	var nodes_at := {}
	for n in g.nodes:
		nodes_at[int(n.y) * W + int(n.x)] = true
	for y in H:
		for x in W:
			var c: String = g.tiles[y * W + x]
			var i := y * W + x
			if c == "D":
				var d := _place(objects, pick("snow.drift", x, y, seed), x, y, Vector2(0, 8), true)
				drifts[i] = d
			elif c == "o":
				_place(details, "ice.hole", x, y, Vector2(0, -38), false)
			elif c == "~":
				if hash2(x, y, seed + 7) % 100 < 4:
					_place(details, pick("ice.formation", x, y, seed), x, y, Vector2(_jit(x, y, 1), 0), false)
			elif not nodes_at.has(i) and not WinterSim.in_base(x, y):
				_decor(x, y, c)
	_ring(W, H)


## Flat things on free snow: patches of earth, branches, pebbles, tracks, low mounds, glints.
func _decor(x: int, y: int, c: String) -> void:
	var r := hash2(x, y, seed + 3) % 1000
	var off := Vector2(_jit(x, y, 2), _jit(x, y, 3) * 0.6)
	if c == ":":
		if r < 90:
			_place(details, pick("snow.hill", x, y, seed), x, y, off, false)
		return
	if r < 22:
		_place(details, pick("ground.patch", x, y, seed), x, y, off, false)
	elif r < 52:
		_place(details, pick("branch", x, y, seed), x, y, off, false)
	elif r < 72:
		_place(details, pick("rock.small", x, y, seed), x, y, off, false)
	elif r < 88:
		var t := ["track.rabbit.0", "track.rabbit.1", "track.deer.0", "track.wolf.0"][hash2(x, y, seed + 5) % 4]
		var s := _place(details, t, x, y, off, false)
		s.rotation = (hash2(x, y, seed + 6) % 628) / 100.0
	elif r < 100:
		_place(details, pick("log", x, y, seed), x, y, off, false)
	elif r < 140:
		_place(details, "snow.sparkle", x, y, off, false)


## A forest wall around the map, so its edge reads as deep woods, not the end of the world.
func _ring(W: int, H: int) -> void:
	for y in range(-RING, H + RING):
		for x in range(-RING, W + RING):
			if x >= 0 and y >= 0 and x < W and y < H:
				continue
			var r := hash2(x, y, seed + 11) % 100
			var off := Vector2(_jit(x, y, 4), _jit(x, y, 5) * 0.5)
			var key := ""
			if r < 55:
				key = "tree.pine.%d" % (2 + hash2(x, y, seed) % maxi(1, WinterArt.variants("tree.pine") - 2))
			elif r < 66:
				key = pick("tree.dead", x, y, seed)
			elif r < 78:
				key = pick("snow.hill", x, y, seed)
			elif r < 86:
				key = pick("rock.group", x, y, seed)
			elif r < 90:
				key = pick("tree.fallen", x, y, seed)
			elif r < 96:
				key = pick("bush.snow", x, y, seed)
			if key != "":
				_place(objects, key, x, y, off, true)


func _jit(x: int, y: int, k: int) -> float:
	return float(hash2(x, y, seed + 100 + k) % 41) - 20.0


## One sprite with its foot near the tile's centre (+ its cast shadow when it has one). → the sprite.
func _place(layer: Node2D, key: String, x: int, y: int, off: Vector2, with_shadow: bool) -> Sprite2D:
	var s := WinterArt.sprite(key)
	s.position = Vector2((x + 0.5) * TILE, (y + 0.6) * TILE) + off
	if hash2(x, y, seed + 9) % 2 == 1 and not key.begins_with("track"):
		s.flip_h = true
		s.offset.x = -(WinterArt.size(key).x - WinterArt.foot(key).x)
	layer.add_child(s)
	if with_shadow:
		var sh := WinterArt.shadow(key)
		if sh:
			sh.position = s.position
			shadows.add_child(sh)
			s.set_meta("shadow", sh)
	return s


func _node_view(n: Dictionary) -> void:
	var kind: String = n.kind
	var x := int(n.x)
	var y := int(n.y)
	var root := Node2D.new()
	root.position = Vector2((x + 0.5) * TILE, (y + 0.62) * TILE)
	objects.add_child(root)
	var stand_key := pick(STANDING[kind], x, y, seed)
	# one tree in eight is a dead one: it still gives wood
	if kind == "tree" and hash2(x, y, seed + 21) % 8 == 0 and WinterArt.has("tree.dead.0"):
		stand_key = pick("tree.dead", x, y, seed)
	var standing := WinterArt.sprite(stand_key)
	root.add_child(standing)
	var flip := hash2(x, y, seed + 9) % 2 == 1
	if flip:
		standing.flip_h = true
		standing.offset.x = -(WinterArt.size(stand_key).x - WinterArt.foot(stand_key).x)
	var spent: Sprite2D = null
	if SPENT[kind] != "":
		var sk := pick(SPENT[kind], x, y, seed)
		spent = WinterArt.sprite(sk)
		root.add_child(spent)
	var shadow := WinterArt.shadow(stand_key)
	if shadow:
		shadow.position = root.position
		shadows.add_child(shadow)
	by_tile[y * WinterSim.W + x] = int(n.id)
	views[int(n.id)] = {"root": root, "standing": standing, "spent": spent, "shadow": shadow, "amount": -1.0, "kind": kind}
	_show(views[int(n.id)], float(n.amount) > 0.0)


func _show(v: Dictionary, up: bool) -> void:
	v.standing.visible = up
	if v.spent:
		v.spent.visible = not up
	if v.shadow:
		v.shadow.visible = up


## Called a few times a second: spent nodes, regrowth, drifts dug out.
func sync(g: Dictionary) -> void:
	for n in g.nodes:
		var v = views.get(int(n.id))
		if v == null:
			continue
		var a := float(n.amount)
		if a != v.amount:
			_show(v, a > 0.0)
			v.amount = a
	if not drifts.is_empty():
		for i in drifts.keys():
			if g.tiles[i] != "D":
				var d: Node2D = drifts[i]
				if d.has_meta("shadow"):
					d.get_meta("shadow").queue_free()
				d.queue_free()
				drifts.erase(i)


## A hit on a node: a short shake of the standing sprite.
func hit(id: int) -> void:
	var v = views.get(id)
	if v == null or not v.standing.visible:
		return
	var s: Sprite2D = v.standing
	var tw := s.create_tween()
	var k := 0.05 if v.kind == "tree" else 0.02
	tw.tween_property(s, "rotation", k, 0.05)
	tw.tween_property(s, "rotation", -k * 0.6, 0.08)
	tw.tween_property(s, "rotation", 0.0, 0.12)


## The view of the node on tile (x, y), for hits by position.
func view_at(g: Dictionary, x: int, y: int) -> int:
	for n in g.nodes:
		if int(n.x) == x and int(n.y) == y:
			return int(n.id)
	return -1


## Trees and tall rocks right in front of the hero turn see-through, so he is never lost behind them.
func fade_near(hx: float, hy: float, sleeping: bool) -> void:
	for s in _faded:
		if is_instance_valid(s):
			s.modulate.a = 1.0
	_faded.clear()
	if sleeping:
		return
	var tx := int(floor(hx))
	var ty := int(floor(hy))
	for y in range(ty, ty + 3):
		for x in range(tx - 1, tx + 2):
			var id = by_tile.get(y * WinterSim.W + x)
			if id == null:
				continue
			var v: Dictionary = views[id]
			var fy := y + 0.62
			var dx := hx - (x + 0.5)
			var dy := fy - hy
			if v.standing.visible and absf(dx) < 0.8 and dy > 0.05 and dy < (2.4 if v.kind == "tree" else 1.0):
				v.standing.modulate.a = 0.45
				_faded.append(v.standing)
