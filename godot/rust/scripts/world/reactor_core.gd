class_name ReactorCore
extends Node3D
## The reactor in the middle of the yard. Dark and cracked until the first ark stage brings its core
## back; then it glows, powers the cables (second stage) and wears the stabilizer rings. During a power
## shortage it flickers red and becomes clickable: five hits restore the power.

var area: Interactable
var _core_mat: StandardMaterial3D
var _light: OmniLight3D
var _rings: Array[Node3D] = []
var _core: MeshInstance3D
var _t := 0.0
var _alive := false
var _shortage := false
var _hit := 0.0
var _burst: CPUParticles3D


func _ready() -> void:
	var body := Node3D.new()
	body.name = "Reactor"
	add_child(body)
	Kit.cyl(body, 1.3, 1.6, 0.5, Kit.CHARCOAL, Vector3(0, 0.25, 0), Vector3.ZERO, 8)
	Kit.cyl(body, 1.0, 1.2, 0.3, Kit.METAL_DARK, Vector3(0, 0.62, 0), Vector3.ZERO, 8)
	for i in 6:
		var a := i * TAU / 6.0
		var p := Vector3(cos(a), 0, sin(a)) * 0.95
		Kit.box(body, Vector3(0.16, 2.4, 0.16), Kit.RUST, p + Vector3(0, 1.8, 0), Vector3(0, -rad_to_deg(a), 0))
	Kit.cyl(body, 1.05, 1.05, 0.18, Kit.RUST_LIGHT, Vector3(0, 3.0, 0), Vector3.ZERO, 8)
	Kit.cyl(body, 0.4, 0.7, 0.4, Kit.METAL_DARK, Vector3(0, 3.3, 0), Vector3.ZERO, 8)
	_core_mat = Kit.own_mat(Color("3a4450"), Kit.CORE, 0.0, 0.3)
	_core = Kit.place(body, Kit.sphere_mesh(0.62, 14, 8), _core_mat, Vector3(0, 1.75, 0), Vector3.ZERO, false)
	_light = Kit.light(body, Kit.CORE, Vector3(0, 1.8, 0.4), 0.0, 9.0)
	for i in 3:
		var ring := Node3D.new()
		ring.position = Vector3(0, 1.75, 0)
		body.add_child(ring)
		Kit.place(ring, Kit.torus_mesh(0.86 + i * 0.12, 0.92 + i * 0.12), Kit.glow(Kit.CORE, 1.6), Vector3.ZERO, Vector3(90, 0, 0), false)
		ring.rotation = Vector3(0.3 * i, i * 1.1, 0.5 * i)
		ring.visible = false
		_rings.append(ring)
	_burst = Fx.burst(body, Vector3(0, 1.8, 0.4), Kit.CORE, 18, 3.5, 0.1)
	area = Interactable.new()
	add_child(area)
	area.setup(body, Vector3(2.6, 3.6, 2.6), Vector3(0, 1.8, 0), 1.9, "Реакторное ядро", "", Kit.CORE)


func show_state(s: GameState) -> void:
	_alive = s.stage >= 1
	_shortage = s.shortage_active()
	for i in _rings.size():
		_rings[i].visible = s.lvl("reactor_stab") > i
	area.enabled = _shortage
	if _shortage:
		area.set_texts("Перебой с питанием!", tr("Клик — стукнуть по ядру ({n}/{m})").format({n = s.ev.shortage_fixes, m = EventManager.SHORTAGE_FIXES}))
	elif _alive:
		area.set_texts("Реакторное ядро", "Питает станции и ковчег")
	else:
		area.set_texts("Мёртвый реактор", "Оживёт с первым этапом ковчега")


func hit_fx() -> void:
	_hit = 1.0
	_burst.restart()


func _process(delta: float) -> void:
	_t += delta
	_hit = maxf(0.0, _hit - delta * 3.0)
	var energy := 0.0
	var col := Kit.CORE
	if _alive:
		energy = 2.4 + sin(_t * 2.0) * 0.5
		if _shortage:
			col = Color("ff5a4a")
			energy = 0.6 + (2.5 if fmod(_t, 0.9) < 0.12 else 0.0) + _hit * 3.0
	_core_mat.emission = col
	_core_mat.albedo_color = col.darkened(0.3) if _alive else Color("3a4450")
	_core_mat.emission_energy_multiplier = energy
	_light.light_color = col
	_light.light_energy = energy * 0.9
	_core.scale = Vector3.ONE * (1.0 + sin(_t * 2.0) * 0.03 + _hit * 0.15)
	for i in _rings.size():
		_rings[i].rotate_y(delta * (0.6 + i * 0.4))
		_rings[i].rotate_x(delta * 0.2 * (i + 1))
