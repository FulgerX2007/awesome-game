class_name SortingStation
extends Node3D
## The sorting table: scrap comes in through the hopper, parts go into the glowing bin. Sorters stand
## along the back; a click sorts by hand. Gloves, the smelter and the scanner appear here when bought.

var area: Interactable
var _bin_parts: Array[MeshInstance3D] = []
var _lamp: OmniLight3D
var _props := {}
var _dish: Node3D
var _smoke: CPUParticles3D
var _fire_mat: StandardMaterial3D
var _pop: CPUParticles3D
var _t := 0.0


func _ready() -> void:
	var body := Node3D.new()
	body.name = "Table"
	add_child(body)
	# table
	Kit.box(body, Vector3(3.0, 0.14, 1.3), Color("4a3b58"), Vector3(0, 0.9, 0))
	Kit.box(body, Vector3(3.1, 0.08, 1.4), Kit.CHARCOAL, Vector3(0, 0.98, 0))
	for x in [-1.35, 1.35]:
		for z in [-0.5, 0.5]:
			Kit.box(body, Vector3(0.12, 0.9, 0.12), Kit.METAL_DARK, Vector3(x, 0.45, z))
	# hopper (end of the belt)
	Kit.cyl(body, 0.7, 0.35, 0.7, Kit.RUST, Vector3(-1.9, 1.3, 0), Vector3.ZERO, 6)
	# sorted bits on the table
	for i in 6:
		Kit.box(body, Vector3(0.18, 0.06, 0.12), Kit.SCRAP_COLORS[i], Vector3(-0.9 + i * 0.32, 1.04, randf_range(-0.3, 0.3)), Vector3(0, randf() * 90, 0))
	# the parts bin
	Kit.box(body, Vector3(0.9, 0.55, 0.8), Color("33283f"), Vector3(1.9, 0.28, 0.1))
	var glow := Kit.glow(Kit.VERDIGRIS, 2.2)
	for i in 8:
		var p := Kit.place(body, Kit.torus_mesh(0.04, 0.1), glow, Vector3(1.7 + (i % 3) * 0.2, 0.6 + (i / 3) * 0.07, -0.1 + (i % 2) * 0.2), Vector3(70, i * 40, 0), false)
		p.visible = false
		_bin_parts.append(p)
	# lamp
	Kit.box(body, Vector3(0.08, 2.4, 0.08), Kit.CHARCOAL, Vector3(1.2, 1.2, -0.75))
	Kit.box(body, Vector3(0.7, 0.06, 0.06), Kit.CHARCOAL, Vector3(0.9, 2.4, -0.75))
	Kit.cyl(body, 0.08, 0.2, 0.18, Kit.CHARCOAL, Vector3(0.6, 2.3, -0.75))
	Kit.ball(body, 0.08, Kit.glow(Kit.LAMP, 4.0), Vector3(0.6, 2.2, -0.75), 8)
	_lamp = Kit.light(body, Kit.LAMP, Vector3(0.6, 2.0, -0.5), 1.6, 5.0)
	# upgrade props
	var gloves := Node3D.new()
	body.add_child(gloves)
	Kit.box(gloves, Vector3(0.22, 0.08, 0.3), Color("d08a3a"), Vector3(-0.3, 1.05, 0.45), Vector3(0, 20, 0))
	Kit.box(gloves, Vector3(0.22, 0.08, 0.3), Color("d08a3a"), Vector3(-0.05, 1.05, 0.48), Vector3(0, -15, 0))
	_props.gloves = gloves
	var smelter := Node3D.new()
	smelter.position = Vector3(-0.4, 0, -1.6)
	body.add_child(smelter)
	Kit.box(smelter, Vector3(1.2, 1.3, 1.0), Color("4f3f4f"), Vector3(0, 0.65, 0))
	Kit.cyl(smelter, 0.2, 0.25, 1.6, Kit.CHARCOAL, Vector3(0.3, 2.0, 0))
	_fire_mat = Kit.own_mat(Kit.EMBER, Kit.EMBER, 3.0)
	Kit.place(smelter, Kit.box_mesh(Vector3(0.6, 0.35, 0.05)), _fire_mat, Vector3(0, 0.55, 0.51))
	Kit.light(smelter, Kit.EMBER, Vector3(0, 0.6, 0.9), 1.2, 3.5)
	_smoke = Fx.smoke(smelter, Vector3(0.3, 2.9, 0))
	_props.smelter = smelter
	var scanner := Node3D.new()
	scanner.position = Vector3(-1.1, 0, -0.75)
	body.add_child(scanner)
	Kit.box(scanner, Vector3(0.08, 2.2, 0.08), Kit.METAL_DARK, Vector3(0, 1.1, 0))
	_dish = Node3D.new()
	_dish.position = Vector3(0, 2.25, 0)
	scanner.add_child(_dish)
	Kit.cyl(_dish, 0.45, 0.1, 0.18, Kit.METAL_LIGHT, Vector3(0, 0, 0.1), Vector3(70, 0, 0), 10)
	Kit.ball(_dish, 0.06, Kit.glow(Kit.CORE, 4.0), Vector3(0, 0.1, 0.4), 6)
	_props.scanner = scanner
	_pop = Fx.burst(body, Vector3(1.9, 0.8, 0.1), Kit.VERDIGRIS, 8, 2.0, 0.08)
	area = Interactable.new()
	add_child(area)
	area.setup(body, Vector3(3.4, 2.0, 1.8), Vector3(0, 1.0, 0), 2.2, "Сортировочный стол", "Клик — разобрать хлам (W)", Kit.VERDIGRIS)


func show_props(s: GameState) -> void:
	_props.gloves.visible = s.lvl("gloves") > 0
	_props.smelter.visible = s.lvl("smelter") > 0
	_props.scanner.visible = s.lvl("scanner") > 0
	_smoke.emitting = s.lvl("smelter") > 0
	var n := clampi(int(ceil(log(s.parts + 1.0) / log(10.0) * 2.0)), 0, _bin_parts.size())
	for i in _bin_parts.size():
		_bin_parts[i].visible = i < n


func pop() -> void:
	_pop.restart()


func _process(delta: float) -> void:
	_t += delta
	if _dish and _props.scanner.visible:
		_dish.rotation.y = _t * 1.4
	if _fire_mat:
		_fire_mat.emission_energy_multiplier = 2.5 + sin(_t * 7.0) * 0.6 + sin(_t * 13.0) * 0.3
	_lamp.light_energy = 1.6 + sin(_t * 23.0) * 0.04
