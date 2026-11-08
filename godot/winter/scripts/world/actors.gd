class_name WinterActors
extends RefCounted
## People and animals. Each one is a node in the y-sorted Characters layer: a soft contact shadow, the animated
## sheet (WinterAnimSprite) and, for the hero, frosty breath. The rules move them in ticks of 1/20 s; the view
## eases every figure to its rule position each frame, so the motion is smooth at any frame rate. The animation is
## chosen from what the rules say the figure is doing (walking, the hero's target, sleeping, a bite).

const TILE := 96.0
const COATS := {
	"hunter": Color("4c6f4a"), "carpenter": Color("b98a3a"), "herbalist": Color("7a5c8f"),
	"smith": Color("5a5f6e"), "child": Color("3c5f8f"),
}

var layer: Node2D
var fx: WinterFx
var views := {}            # id -> {node, spr, kind, last: Vector2, dir, busy_until, anim}
var hero_hurt := 0.0
var hero_action := ""      # a short one-off animation: "build" | "craft" after the panels
var hero_action_t := 0.0
var dead := false


func _init(characters_layer: Node2D, effects: WinterFx) -> void:
	layer = characters_layer
	fx = effects


func clear() -> void:
	for v in views.values():
		v.node.queue_free()
	views.clear()
	dead = false


func _make(id: String, key: String, kind: String, tint := Color(0, 0, 0, 0), scale := 1.0) -> Dictionary:
	var node := Node2D.new()
	var sh := Sprite2D.new()
	sh.texture = _shadow_tex()
	sh.scale = Vector2(0.62, 0.26) * scale * (1.6 if kind == "bear" else 1.15 if kind in ["wolf", "deer"] else 0.5 if kind == "rabbit" else 1.0)
	sh.modulate = Color(0.1, 0.12, 0.25, 0.5)
	# the fire's light must not wash the contact shadow out
	var unshaded := CanvasItemMaterial.new()
	unshaded.light_mode = CanvasItemMaterial.LIGHT_MODE_UNSHADED
	sh.material = unshaded
	node.add_child(sh)
	var spr := WinterAnimSprite.new()
	spr.setup(key, tint)
	spr.scale = Vector2.ONE * scale
	node.add_child(spr)
	layer.add_child(node)
	var v := {"node": node, "spr": spr, "kind": kind, "last": Vector2.INF, "dir": "down", "shadow": sh}
	views[id] = v
	return v


static var _sh_tex: Texture2D
static func _shadow_tex() -> Texture2D:
	if _sh_tex == null:
		var g := Gradient.new()
		g.set_color(0, Color(1, 1, 1, 1))
		g.set_color(1, Color(1, 1, 1, 0))
		var t := GradientTexture2D.new()
		t.gradient = g
		t.fill = GradientTexture2D.FILL_RADIAL
		t.fill_from = Vector2(0.5, 0.5)
		t.fill_to = Vector2(1.0, 0.5)
		t.width = 128
		t.height = 128
		_sh_tex = t
	return _sh_tex


## Moves a view toward its rule position; → how far it moved this frame (tiles), and sets its facing.
func _ease(v: Dictionary, x: float, y: float, delta: float) -> float:
	var target := Vector2(x * TILE, y * TILE)
	var node: Node2D = v.node
	if v.last == Vector2.INF or node.position.distance_to(target) > TILE * 3.0:
		node.position = target
		v.last = target
		return 0.0
	var before := node.position
	node.position = node.position.lerp(target, 1.0 - exp(-delta * 18.0))
	var d := node.position - before
	if d.length() > 0.05:
		if absf(d.x) > absf(d.y) * 1.1:
			v.dir = "right" if d.x > 0 else "left"
		else:
			v.dir = "down" if d.y > 0 else "up"
	v.last = target
	return d.length() / TILE / maxf(delta, 1e-4)


func _face_to(v: Dictionary, x: float, y: float, hx: float, hy: float) -> void:
	var dx := x - hx
	var dy := y - hy
	if absf(dx) > absf(dy):
		v.dir = "right" if dx > 0 else "left"
	else:
		v.dir = "down" if dy > 0 else "up"


func sync(g: Dictionary, delta: float) -> void:
	var seen := {}
	_hero(g, delta)
	seen["hero"] = true
	for s in g.survivors:
		if s.state == "dead":
			continue
		var id := "sv:" + String(s.id)
		seen[id] = true
		var v = views.get(id)
		if v == null:
			# the painted survivor in their own clothes when there is one, else the generated villager tinted
			var painted := "char.sv." + String(s.id)
			if WinterArt.has(painted):
				v = _make(id, painted, "person", Color(0, 0, 0, 0), float(WinterArt.entry(painted).get("scale", 1.0)))
			else:
				v = _make(id, "char.villager", "person", COATS.get(s.id, Color("7a5638")), 0.78 if s.id == "child" else 1.0)
		var speed := _ease(v, float(s.x), float(s.y), delta)
		var a := "walk" if speed > 0.4 else ("work" if s.state == "home" and s.get("busy", false) else "idle")
		if s.state == "home" and WinterSim.is_night(g):
			a = "sleep"
			v.dir = "down"
		v.spr.play(a, v.dir)
	for a in g.animals:
		var id := "an:%d" % int(a.id)
		seen[id] = true
		var v = views.get(id)
		if v == null:
			v = _make(id, "animal." + String(a.kind), String(a.kind))
		var speed := _ease(v, float(a.x), float(a.y), delta)
		var side = "left" if v.dir == "left" else "right" if v.dir == "right" else v.dir
		v.spr.play(("hop" if a.kind == "rabbit" else "walk") if speed > 0.2 else "idle", side)
	for w in g.wolves:
		var id := "wf:%d" % int(w.id)
		seen[id] = true
		var v = views.get(id)
		if v == null:
			v = _make(id, "animal.wolf", "wolf")
		var speed := _ease(v, float(w.x), float(w.y), delta)
		var near := hypot2(float(w.x) - float(g.hero.x), float(w.y) - float(g.hero.y)) < 1.3
		var anim := "run" if speed > 0.3 else ("bite" if near and float(w.cd) > 1.0 else "idle")
		if v.has("hurt_until") and Time.get_ticks_msec() < int(v.hurt_until):
			anim = "hurt"
		v.spr.play(anim, v.dir)
	if g.bear != null:
		var b: Dictionary = g.bear
		seen["bear"] = true
		var v = views.get("bear")
		if v == null:
			v = _make("bear", "animal.bear", "bear")
		var speed := _ease(v, float(b.x), float(b.y), delta)
		var anim := "walk" if speed > 0.2 else ("swipe" if float(b.cd) > WinterSim.D.BEAR.cd - 0.5 else "idle")
		v.spr.play(anim, v.dir)
	if g.trader != null:
		seen["trader"] = true
		var v = views.get("trader")
		if v == null:
			v = _make("trader", "char.trader", "person")
		_ease(v, float(g.trader.x) + 1.4, float(g.trader.y) + 0.75, delta)
		v.spr.play("idle", "down")
	var ev = g.event
	if ev != null and ev.id == "wanderer" and ev.phase == "active":
		seen["wanderer"] = true
		var v = views.get("wanderer")
		if v == null:
			v = _make("wanderer", "char.wanderer", "person")
		_ease(v, float(ev.x) + 0.5, float(ev.y) + 0.6, delta)
		v.spr.play("idle", "down")
	for id in views.keys():
		if not seen.has(id):
			var v: Dictionary = views[id]
			if v.kind == "wolf" and v.get("dying", false) == false:
				_die(id, v)
			elif not v.get("dying", false):
				v.node.queue_free()
				views.erase(id)


static func hypot2(a: float, b: float) -> float:
	return sqrt(a * a + b * b)


## A wolf that left the rules plays its fall and fades (at dawn the pack just fades).
func _die(id: String, v: Dictionary) -> void:
	v.dying = true
	if v.spr.has_anim("death_side"):
		v.spr.play("death", v.dir)
	var tw: Tween = v.node.create_tween()
	tw.tween_interval(0.6)
	tw.tween_property(v.node, "modulate:a", 0.0, 0.6)
	tw.tween_callback(func():
		v.node.queue_free()
		views.erase(id))


## Seconds between blows on a node, as the rules count them (D.NODE.hitCd): the swing is kept in step
## with that timer, so the frame where the axe or the pick lands is the moment the rules take the wood or stone
## (and the chips, the sound and the shudder of the tree come from that same event).
static func blow_period(kind: String) -> float:
	return float(WinterSim.D.NODE.hitCd[kind])


func _hero(g: Dictionary, delta: float) -> void:
	var h: Dictionary = g.hero
	var v = views.get("hero")
	if v == null:
		v = _make("hero", "char.hero", "hero")
		v.finish = ""
	var speed := _ease(v, float(h.x), float(h.y), delta)
	var a := "idle"
	var tg = h.target
	var period := 0.0
	hero_action_t = maxf(0.0, hero_action_t - delta)
	hero_hurt = maxf(0.0, hero_hurt - delta)
	var walking: bool = speed > 0.3 or h.path != null or h.dir != null
	if g.status == "lost":
		a = "death"
	elif h.sleeping:
		a = "sleep"
		v.dir = "down"
	elif walking:
		a = "walk"
	elif tg != null:
		match String(tg.type):
			"node":
				var n: Dictionary = g.nodes[int(tg.id)]
				a = {"tree": "chop", "rock": "mine", "bush": "gather", "scrap": "gather"}[n.kind]
				period = blow_period(n.kind)
				_face_to(v, float(n.x) + 0.5, float(n.y) + 0.5, float(h.x), float(h.y))
			"hole":
				a = "gather"
				_face_to(v, float(tg.x) + 0.5, float(tg.y) + 0.5, float(h.x), float(h.y))
			"fire":
				a = "fire"
				_face_to(v, WinterSim.SPOT.fire.x + 0.5, WinterSim.SPOT.fire.y + 0.5, float(h.x), float(h.y))
			"animal", "wolf", "bear":
				a = "chop"
				period = 0.8
	elif _warming(g):
		# standing by a burning fire while cold: warming up (the rules do the warming; this is the look)
		a = "warm"
		_face_to(v, WinterSim.SPOT.fire.x + 0.5, WinterSim.SPOT.fire.y + 0.5, float(h.x), float(h.y))
	if hero_action_t > 0.0 and a == "idle":
		a = hero_action
	var spr: WinterAnimSprite = v.spr
	# a swing that was cut short by the end of the work plays out to its last frame, then idle
	if a == "idle" and v.finish != "" and not walking:
		if spr.anim.begins_with(v.finish) and not spr.done:
			a = v.finish
		else:
			v.finish = ""
	if period > 0.0:
		spr.play(a, v.dir)
		if spr.clip_impact() >= 0:
			spr.show_progress(clampf((period - float(h.cd)) / period, 0.0, 0.999))
			v.finish = a
	else:
		if v.finish != "" and a == v.finish:
			# let the clock run the rest of the swing, without looping back
			spr.driven = false
			if spr.frame_index() >= spr.clip_count() - 1:
				spr.done = true
		else:
			spr.play(a, v.dir)
	spr.speed = 1.0 if a != "walk" else clampf(speed / 3.0, 0.6, 1.4)
	# hurt and death: a red flash and a fall when the sheet has no frames for them
	var red := clampf(hero_hurt / 0.35, 0.0, 1.0)
	spr.modulate = Color(1.0, 1.0 - red * 0.55, 1.0 - red * 0.55)
	var lying := a == "death" and not spr.has_anim("death_side")
	spr.rotation = lerp_angle(spr.rotation, -PI * 0.5 if lying else 0.0, 1.0 - exp(-delta * 6.0))
	v.shadow.visible = a != "sleep" or not WinterSim.in_hut(h)
	v.node.visible = not (h.sleeping and WinterSim.in_hut(h))


## The hero warms up at the fire: it burns, he is in its circle, standing still, not yet warm.
func _warming(g: Dictionary) -> bool:
	var h: Dictionary = g.hero
	if not WinterSim.fire_on(g) or float(h.warmth) >= 95.0 or h.target != null or h.path != null or h.dir != null:
		return false
	var sp: Dictionary = WinterSim.SPOT
	return WinterSim.hyp(float(h.x) - sp.fire.x - 0.5, float(h.y) - sp.fire.y - 0.5) <= float(WinterSim.D.FIRE.radius)


func hero_node() -> Node2D:
	var v = views.get("hero")
	return v.node if v else null


func hurt_wolf(id: int) -> void:
	var v = views.get("wf:%d" % id)
	if v:
		v.hurt_until = Time.get_ticks_msec() + 250


func play_action(name: String, seconds := 1.0) -> void:
	hero_action = name
	hero_action_t = seconds


## The figure under a world point (for taps on a sprite rather than its tile): → {kind, x, y} in tiles or {}.
func pick(p: Vector2, g: Dictionary) -> Dictionary:
	var best := {}
	var by := -INF
	for id in views:
		var v: Dictionary = views[id]
		if v.get("dying", false) or id == "hero":
			continue
		var node: Node2D = v.node
		var sz = WinterArt.size(v.spr.key) * v.spr.scale
		var rect := Rect2(node.position - Vector2(sz.x * 0.35, sz.y * 0.9), Vector2(sz.x * 0.7, sz.y * 0.95))
		if rect.has_point(p) and node.position.y > by:
			by = node.position.y
			best = {"id": id, "x": int(floor(node.position.x / TILE)), "y": int(floor(node.position.y / TILE))}
	return best
