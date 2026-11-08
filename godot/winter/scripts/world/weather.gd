class_name WinterWeather
extends Node2D
## Falling snow in the world (so the fire and torches light the flakes), drifting snow along the ground, and the
## weather of the day. Only the blizzard is a rule (colder, the fire burns faster); light snow, snowfall and the
## snowfall before a storm are looks picked from the day, so they don't change the balance. Wind gusts swell and
## fade; in a blizzard the flakes fly sideways and the Atmosphere layer thickens the fog.

const TILE := 96.0
const LEVELS := ["light", "snow", "heavy", "blizzard"]
const AMOUNT := {"light": 0.25, "snow": 0.5, "heavy": 0.8, "blizzard": 1.0}

var flakes: GPUParticles2D
var near: GPUParticles2D          # bigger, faster flakes close to the camera
var drift: GPUParticles2D         # snow streaming along the ground
var level := "snow"
var wind := 0.0                   # -1 … 1 sideways; also how hard it blows
var gust := 0.0
var quality := 1.0                # the settings' weather quality: 0.5 or 1
var _t := 0.0
var _noise := FastNoiseLite.new()


func _init() -> void:
	z_index = 20
	flakes = _system("fx.snowflake.0", 1400, 5.0, Vector2(0.7, 1.5))
	near = _system("fx.snowflake.1", 260, 2.6, Vector2(1.6, 2.8))
	drift = _system("fx.snowflake.2", 500, 1.6, Vector2(0.8, 1.4))
	_noise.frequency = 0.08


func _system(key: String, amount: int, life: float, scale_range: Vector2) -> GPUParticles2D:
	var p := GPUParticles2D.new()
	p.amount = amount
	p.lifetime = life
	p.local_coords = false
	p.texture = WinterArt.texture(key, false)
	p.visibility_rect = Rect2(-4000, -4000, 8000, 8000)
	p.preprocess = life
	var m := ParticleProcessMaterial.new()
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	m.emission_box_extents = Vector3(1400, 900, 0)
	m.direction = Vector3(0, 1, 0)
	m.spread = 12.0
	m.initial_velocity_min = 60.0
	m.initial_velocity_max = 120.0
	m.gravity = Vector3(0, 30, 0)
	m.scale_min = scale_range.x
	m.scale_max = scale_range.y
	m.angular_velocity_min = -90.0
	m.angular_velocity_max = 90.0
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 0))
	g.add_point(0.1, Color(1, 1, 1, 0.95))
	g.add_point(0.85, Color(1, 1, 1, 0.9))
	g.set_color(g.get_point_count() - 1, Color(1, 1, 1, 0))
	var gt := GradientTexture1D.new()
	gt.gradient = g
	m.color_ramp = gt
	p.process_material = m
	add_child(p)
	return p


## The look of the day: deterministic from the day number, a blizzard when the rules have one, heavy snow on the
## evening before a blizzard, light snow on a thaw.
static func level_of(g: Dictionary) -> String:
	var day := WinterSim.day_of(g)
	if WinterSim.is_blizzard(g):
		return "blizzard"
	if g.event != null and g.event.id == "thaw":
		return "light"
	if WinterSim.is_blizzard(g, day + 1) and WinterSim.time_of_day(g) > 60.0:
		return "heavy"
	var h := (day * 2654435761) % 7
	return "heavy" if h == 0 else "light" if h <= 2 else "snow"


func update(g: Dictionary, cam_center: Vector2, view_size: Vector2, delta: float) -> void:
	_t += delta
	level = level_of(g)
	var blz := level == "blizzard"
	gust = maxf(0.0, _noise.get_noise_1d(_t * (1.6 if blz else 0.7)))
	var base_wind := 0.85 if blz else 0.22 if level == "heavy" else 0.1
	wind = base_wind + gust * (0.9 if blz else 0.45)
	var k: float = AMOUNT[level] * quality
	var ext := Vector3(view_size.x * 0.5 + 300, view_size.y * 0.5 + 300, 0)
	for p in [flakes, near]:
		p.position = cam_center - Vector2(wind * 600.0, 200.0)
		var m: ParticleProcessMaterial = p.process_material
		m.emission_box_extents = ext
		m.gravity = Vector3(wind * (900.0 if p == near else 520.0), 40.0 if blz else 25.0, 0)
		m.initial_velocity_min = 140.0 if blz else 60.0
		m.initial_velocity_max = 260.0 if blz else 120.0
	flakes.amount_ratio = k
	near.amount_ratio = k * (1.0 if blz else 0.5)
	drift.position = cam_center + Vector2(-wind * 300.0, 120.0)
	var dm: ParticleProcessMaterial = drift.process_material
	dm.emission_box_extents = ext
	dm.direction = Vector3(1, 0, 0)
	dm.spread = 6.0
	dm.gravity = Vector3(wind * 400.0, 0, 0)
	dm.initial_velocity_min = 300.0
	dm.initial_velocity_max = 520.0
	drift.amount_ratio = clampf((wind - 0.3) * 1.4, 0.0, 1.0) * quality
	drift.emitting = drift.amount_ratio > 0.01
