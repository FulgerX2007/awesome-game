class_name WinterCamp
extends RefCounted
## The camp: the hut by stages (with the roof hole and the scaffold of a stage paid in part), the four palisade
## walls with the south gate (built in part, damaged, broken), the workbench, the fire pit and its flame, bunks,
## the house upgrades, the woodpile and the stone heap, torches, snares and the trader's sled. Everything stands
## on the fixed spots of the rules (WinterSim.SPOT, HUT, BASE). `ghost(id)` shows where a building in the build
## menu will stand.

const TILE := 96.0
const GATE := [27, 28]                # the south gate's tiles
const UP_FOOT := {
	"cellar": Vector2(23.5, 16.9), "smokehouse": Vector2(24.5, 23.9), "annex": Vector2(30.0, 17.95), "workshop": Vector2(32.0, 23.95),
}

var objects: Node2D
var details: Node2D
var shadows: Node2D
var hut: Sprite2D
var hut_hole: Sprite2D
var hut_scaffold: Sprite2D
var hut_stage := -1
var walls := []                       # per segment: [{sprite, kind ("h"/"v"), i}]
var upgrades := {}                    # id -> {built: Sprite2D, frame: Sprite2D}
var bunks := []                       # [{built, frame}]
var bench: Sprite2D
var pit: Sprite2D
var pit_ash: Sprite2D
var flame: Sprite2D
var flame_t := 0.0
var woodpile: Sprite2D
var stonepile: Sprite2D
var torches := {}                     # "x,y" -> {pole, flame}
var snares := {}                      # "x,y" -> Sprite2D
var sled: Sprite2D
var ghosts := []
var _flame_frames := 1
var _small_frames := 1


func _init(objects_layer: Node2D, details_layer: Node2D, shadows_layer: Node2D) -> void:
	objects = objects_layer
	details = details_layer
	shadows = shadows_layer


func _at(key: String, foot_tile: Vector2, layer: Node2D = null, with_shadow := true) -> Sprite2D:
	var s := WinterArt.sprite(key)
	s.position = foot_tile * TILE
	(layer if layer else objects).add_child(s)
	if with_shadow:
		var sh := WinterArt.shadow(key)
		if sh:
			sh.position = s.position
			shadows.add_child(sh)
			s.set_meta("shadow", sh)
	return s


func _vis(s: Sprite2D, on: bool) -> void:
	if s == null:
		return
	s.visible = on
	if s.has_meta("shadow"):
		s.get_meta("shadow").visible = on


func build(g: Dictionary) -> void:
	var hx: float = WinterSim.HUT.x + WinterSim.HUT.w * 0.5
	var hy: float = WinterSim.HUT.y + WinterSim.HUT.h
	hut = _at("hut.0", Vector2(hx, hy))
	hut_hole = WinterArt.sprite("hut.roofhole")
	hut.add_child(hut_hole)
	hut_scaffold = WinterArt.sprite("hut.scaffold")
	hut.add_child(hut_scaffold)
	_build_walls()
	var sp: Dictionary = WinterSim.SPOT
	bench = _at("bench", Vector2(sp.bench.x + 0.5, sp.bench.y + 0.8))
	pit = _at("firepit", Vector2(sp.fire.x + 0.5, sp.fire.y + 0.62), null, false)
	pit_ash = WinterArt.sprite("firepit.ash")
	pit.add_child(pit_ash)
	flame = WinterArt.sprite("fx.flame")
	flame.position = Vector2(0, -10)
	_flame_frames = _sheet(flame, "fx.flame")
	var mat := CanvasItemMaterial.new()
	mat.light_mode = CanvasItemMaterial.LIGHT_MODE_UNSHADED
	flame.material = mat
	pit.add_child(flame)
	for i in sp.bunks.size():
		var b: Dictionary = sp.bunks[i]
		var foot := Vector2(b.x + 0.5, b.y + 0.8)
		bunks.append({"built": _at("bunk", foot), "frame": _at("bunk.frame", foot)})
	for id in UP_FOOT:
		upgrades[id] = {"built": _at("up." + id, UP_FOOT[id]), "frame": _at("up.%s.frame" % id, UP_FOOT[id])}
	woodpile = _at("stock.wood", Vector2(25.35, 17.95))
	stonepile = _at("stock.stone", Vector2(29.55, 21.6))
	sled = _at("trader.sled", Vector2(sp.trader.x + 0.5, sp.trader.y + 0.8))
	sync(g)


## How many frames a sheet sprite has (it is set up as an hframes strip or grid).
func _sheet(s: Sprite2D, key: String) -> int:
	var e := WinterArt.entry(key)
	var fr = e.get("frame", null)
	if not fr is Array or s.texture == null:
		return 1
	s.hframes = maxi(1, int(s.texture.get_width() / float(fr[0])))
	s.vframes = maxi(1, int(s.texture.get_height() / float(fr[1])))
	var f := WinterArt.foot(key)
	s.offset = -f
	return s.hframes * s.vframes


func _build_walls() -> void:
	var B: Dictionary = WinterSim.BASE
	walls = [[], [], [], []]
	# north (0) and south (2) run along x; east (1) and west (3) along y
	for x in range(B.x0, B.x1 + 1):
		walls[0].append(_wall("h", Vector2(x + 0.5, B.y0 + 0.02)))
		if x in GATE:
			continue
		walls[2].append(_wall("h", Vector2(x + 0.5, B.y1 + 1.02)))
	for y in range(B.y0, B.y1 + 1):
		walls[1].append(_wall("v", Vector2(B.x1 + 1.0, y + 0.95)))
		walls[3].append(_wall("v", Vector2(B.x0, y + 0.95)))
	for c in [Vector2(B.x0, B.y0 + 0.02), Vector2(B.x1 + 1, B.y0 + 0.02), Vector2(B.x0, B.y1 + 1.02), Vector2(B.x1 + 1, B.y1 + 1.02)]:
		_at("palisade.post", c)
	var gate := _at("palisade.gate", Vector2(GATE[0] + 1.0, B.y1 + 1.02))
	gate.set_meta("gate", true)
	walls[2].append({"sprite": gate, "kind": "gate"})


func _wall(kind: String, foot: Vector2) -> Dictionary:
	var s := _at("palisade." + kind, foot)
	return {"sprite": s, "kind": kind, "foot": foot}


func _wall_state(w: Dictionary, state: String) -> void:
	var s: Sprite2D = w.sprite
	var key := "palisade.gate" if w.kind == "gate" else "palisade.%s%s" % [w.kind, "" if state == "" else "." + state]
	if s.get_meta("key", "") != key:
		s.set_meta("key", key)
		s.texture = WinterArt.texture(key)
		s.offset = -WinterArt.foot(key)


func sync(g: Dictionary) -> void:
	var hs := int(g.hut.stage)
	if hs != hut_stage:
		hut_stage = hs
		var key := "hut.%d" % hs
		hut.texture = WinterArt.texture(key)
		hut.offset = -WinterArt.foot(key)
		var sh := WinterArt.shadow(key)
		if hut.has_meta("shadow"):
			hut.get_meta("shadow").queue_free()
			hut.remove_meta("shadow")
		if sh:
			sh.position = hut.position
			shadows.add_child(sh)
			hut.set_meta("shadow", sh)
	hut_hole.visible = bool(g.hut.roofHole) and hs >= 2
	hut_scaffold.visible = hs < 4 and not (g.hut.paid as Dictionary).is_empty()
	# the palisade
	for i in 4:
		var p: Dictionary = g.palisade[i]
		var list: Array = walls[i]
		var shown := list.size()
		if not p.built:
			var paid := float((p.paid as Dictionary).get("wood", 0))
			shown = int(floor(paid / float(WinterSim.D.PALISADE_COST.get("wood", 25)) * list.size()))
		var state := ""
		if p.built:
			var hp := float(p.hp)
			state = "broken" if hp <= 0.0 else "damaged" if hp < 60.0 else ""
		for k in list.size():
			var w: Dictionary = list[k]
			_vis(w.sprite, k < shown)
			if k < shown:
				_wall_state(w, state)
	# bunks and upgrades: built, or the frame of one paid in part
	for i in bunks.size():
		var b: Dictionary = g.bunks[i]
		_vis(bunks[i].built, b.built)
		_vis(bunks[i].frame, not b.built and not (b.paid as Dictionary).is_empty())
	for id in upgrades:
		var u: Dictionary = g.upgrades[id]
		_vis(upgrades[id].built, u.built)
		_vis(upgrades[id].frame, not u.built and not (u.paid as Dictionary).is_empty())
	# stock piles grow with the stock
	var wood := float(g.stock.wood)
	_vis(woodpile, wood > 0)
	woodpile.scale = Vector2.ONE * clampf(0.6 + wood / 120.0, 0.6, 1.15)
	var stone := float(g.stock.stone)
	_vis(stonepile, stone > 0)
	stonepile.scale = Vector2.ONE * clampf(0.6 + stone / 120.0, 0.6, 1.15)
	_vis(sled, g.trader != null)
	_sync_torches(g)
	_sync_snares(g)


func _sync_torches(g: Dictionary) -> void:
	var seen := {}
	for t in g.torches:
		var k := "%d,%d" % [int(t.x), int(t.y)]
		seen[k] = true
		if torches.has(k):
			continue
		var pole := _at("torch", Vector2(t.x + 0.5, t.y + 0.7))
		var f := WinterArt.sprite("fx.flame.small")
		var n := _sheet(f, "fx.flame.small")
		f.position = Vector2(0, -WinterArt.size("torch").y * 0.86)
		var mat := CanvasItemMaterial.new()
		mat.light_mode = CanvasItemMaterial.LIGHT_MODE_UNSHADED
		f.material = mat
		pole.add_child(f)
		torches[k] = {"pole": pole, "flame": f, "frames": n, "phase": randf() * 3.0}
	for k in torches.keys():
		if not seen.has(k):
			var v: Dictionary = torches[k]
			if v.pole.has_meta("shadow"):
				v.pole.get_meta("shadow").queue_free()
			v.pole.queue_free()
			torches.erase(k)


func _sync_snares(g: Dictionary) -> void:
	var seen := {}
	for n in g.snares:
		var k := "%d,%d" % [int(n.x), int(n.y)]
		seen[k] = true
		if not snares.has(k):
			snares[k] = _at("snare", Vector2(n.x + 0.5, n.y + 0.6), details, false)
	for k in snares.keys():
		if not seen.has(k):
			snares[k].queue_free()
			snares.erase(k)


## Every frame: the flame's frames and its size from the fuel, the torches' flames.
func animate(g: Dictionary, delta: float) -> void:
	flame_t += delta
	var fuel := float(g.fire.fuel)
	var on := fuel > 0.0
	flame.visible = on
	pit_ash.visible = not on
	if on:
		var k := clampf(fuel / 10.0, 0.0, 1.0)
		var s := 0.4 + 0.6 * k
		flame.scale = Vector2(s * (1.0 + sin(flame_t * 7.3) * 0.03), s * (1.0 + sin(flame_t * 5.1) * 0.06))
		flame.frame = int(flame_t * 12.0) % _flame_frames
	for k in torches:
		var t: Dictionary = torches[k]
		t.flame.frame = int((flame_t + t.phase) * 11.0) % int(t.frames)


## The silhouette of a building to come, on its spot (the build menu shows where it will stand). "" hides it.
func ghost(id: String, g: Dictionary) -> void:
	for s in ghosts:
		s.queue_free()
	ghosts.clear()
	if id == "":
		return
	var add := func(key: String, foot: Vector2):
		var s := WinterArt.sprite(key)
		s.position = foot * TILE
		s.modulate = Color(0.75, 0.95, 1.0, 0.45)
		objects.add_child(s)
		ghosts.append(s)
	if id == "hut":
		add.call("hut.%d" % mini(4, int(g.hut.stage) + 1), hut.position / TILE)
	elif id.begins_with("palisade:"):
		var i := int(id.get_slice(":", 1))
		for w in walls[i]:
			if w.kind != "gate":
				add.call("palisade." + w.kind, w.foot)
	elif id.begins_with("bunk:"):
		var b: Dictionary = WinterSim.SPOT.bunks[int(id.get_slice(":", 1))]
		add.call("bunk", Vector2(b.x + 0.5, b.y + 0.8))
	elif id.begins_with("up:"):
		var u := id.substr(3)
		add.call("up." + u, UP_FOOT[u])
