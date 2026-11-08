class_name WinterLights
extends Node2D
## Daylight and fire light. A CanvasModulate tints the whole world by the time of day: a cold clear day, a warm
## violet dusk, a deep blue night (darker in a blizzard, greener under the aurora). PointLight2D sources glow where
## the rules say there is light — the fire (its strength and flicker follow the fuel), the stove's window, the
## torches, the hero's lantern — and a faint moonlight halo keeps the hero visible at night. At most MAX lights.

const TILE := 96.0
const MAX := 16
const DAY_COLOR := Color(0.98, 0.99, 1.0)
const DUSK_COLOR := Color(0.86, 0.72, 0.78)
const NIGHT_COLOR := Color(0.13, 0.17, 0.33)
const STORM_COLOR := Color(0.72, 0.78, 0.88)
const DAWN_COLOR := Color(0.93, 0.80, 0.82)

var modulate_node: CanvasModulate
var camp: WinterCamp              # for the window the stove glows from
var fire: PointLight2D
var stove: PointLight2D
var lantern: PointLight2D
var moon: PointLight2D
var torches: Array[PointLight2D] = []
var night := 0.0              # 0 day … 1 the darkest night (for other layers)
var dusk := 0.0
var _t := 0.0
var _noise := FastNoiseLite.new()


func _init() -> void:
	modulate_node = CanvasModulate.new()
	add_child(modulate_node)
	fire = _light(Color(1.0, 0.62, 0.28), 4.4, 1.6)
	stove = _light(Color(1.0, 0.66, 0.34), 2.6, 1.0)
	lantern = _light(Color(1.0, 0.82, 0.5), 2.4, 0.9)
	moon = _light(Color(0.55, 0.65, 1.0), 2.2, 0.35)
	for k in 12:
		torches.append(_light(Color(1.0, 0.6, 0.3), 3.2, 1.1))
	_noise.frequency = 2.2


func _light(c: Color, radius_tiles: float, energy: float) -> PointLight2D:
	var l := PointLight2D.new()
	l.texture = WinterArt.texture("fx.light", false)
	if l.texture == null:
		l.texture = _fallback_light()
	l.texture_scale = radius_tiles * TILE * 2.0 / float(l.texture.get_width())
	l.color = c
	l.energy = energy
	l.height = 40.0
	l.blend_mode = Light2D.BLEND_MODE_ADD
	l.set_meta("energy", energy)
	l.visible = false
	add_child(l)
	return l


static func _fallback_light() -> Texture2D:
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.add_point(0.45, Color(1, 1, 1, 0.45))
	g.set_color(g.get_point_count() - 1, Color(1, 1, 1, 0))
	var t := GradientTexture2D.new()
	t.gradient = g
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	t.width = 256
	t.height = 256
	return t


## The sky's tint for the moment (time of day 0..150 s, blizzard, aurora 0..1).
static func sky(tod: float, blizzard: bool, aurora: float, night_k: float) -> Color:
	var c := DAY_COLOR
	# dawn: the first 12 s warm up from the night
	if tod < 12.0:
		c = DAWN_COLOR.lerp(DAY_COLOR, smoothstep(0.0, 12.0, tod))
	# evening: from 70 s the light warms and drops toward dusk
	var ev := smoothstep(70.0, 100.0, tod) if tod < 100.0 else 1.0
	c = c.lerp(DUSK_COLOR, ev * (1.0 - night_k))
	c = c.lerp(NIGHT_COLOR, night_k)
	if blizzard:
		c = c.lerp(c * STORM_COLOR, 0.8)
	if aurora > 0.0:
		c = c.lerp(Color(0.16, 0.32, 0.36), aurora * 0.45)
	return c


func update(g: Dictionary, hero: Node2D, delta: float) -> void:
	_t += delta
	var tod := WinterSim.time_of_day(g)
	night = clampf(WinterViewMath.darkness(g) / 0.82, 0.0, 1.0)
	dusk = smoothstep(70.0, 100.0, tod) if tod < 100.0 else 1.0
	var blz := WinterSim.is_blizzard(g)
	modulate_node.color = sky(tod, blz, WinterViewMath.aurora(g), night)
	# lights matter more as it gets dark; by day they still warm the snow a little around the fire
	var k := 0.35 + 0.65 * maxf(night, dusk * 0.6)
	var sp: Dictionary = WinterSim.SPOT
	var fuel := float(g.fire.fuel)
	fire.visible = fuel > 0.0
	if fire.visible:
		var strength := clampf(0.35 + fuel / 12.0, 0.35, 1.0)
		var flick := 0.88 + 0.12 * _noise.get_noise_1d(_t * 9.0) + 0.05 * sin(_t * 23.0)
		fire.energy = float(fire.get_meta("energy")) * k * strength * flick
		fire.texture_scale = (2.2 + 2.4 * strength) * TILE * 2.0 / float(fire.texture.get_width())
		fire.position = Vector2((sp.fire.x + 0.5) * TILE + _noise.get_noise_1d(_t * 4.0 + 50.0) * 6.0, (sp.fire.y + 0.3) * TILE)
	stove.visible = WinterSim.stove_on(g)
	if stove.visible:
		var by_art := Vector2((WinterSim.HUT.x + 1.5) * TILE, (WinterSim.HUT.y + 1.7) * TILE)
		stove.position = camp.hut_world("window", by_art) + Vector2(0, 30) if camp else by_art
		stove.energy = float(stove.get_meta("energy")) * k * (0.9 + 0.1 * sin(_t * 3.1))
	var n := 0
	for t in g.torches:
		if n >= torches.size():
			break
		var l := torches[n]
		l.visible = true
		l.position = WinterCamp.torch_light(t)
		l.energy = float(l.get_meta("energy")) * k * (0.9 + 0.1 * _noise.get_noise_1d(_t * 8.0 + n * 13.0))
		n += 1
	for i in range(n, torches.size()):
		torches[i].visible = false
	var lit_lantern: bool = g.gear.lantern and WinterSim.is_night(g) and not g.hero.sleeping
	lantern.visible = lit_lantern and hero != null
	moon.visible = hero != null and night > 0.05 and not lit_lantern
	if hero:
		lantern.position = hero.position + Vector2(18, -60)
		lantern.energy = float(lantern.get_meta("energy")) * (0.92 + 0.08 * sin(_t * 5.0))
		moon.position = hero.position + Vector2(0, -40)
		moon.energy = float(moon.get_meta("energy")) * night
