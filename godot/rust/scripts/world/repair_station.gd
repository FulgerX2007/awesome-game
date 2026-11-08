class_name RepairStation
extends Node3D
## The repair bay. The robot on it is put together piece by piece as the repair progresses (legs, body,
## head, eye), mechanics weld around it, and a finished robot steps off and joins the crew. A click
## works on it with the wrench. The wrench board, oil barrels and the assembly arm show those upgrades.

var area: Interactable
var _pieces: Array[Node3D] = []
var _eye: MeshInstance3D
var _sparks: CPUParticles3D
var _arm: Node3D
var _props := {}
var _bar_fill: MeshInstance3D
var _bar: Node3D
var _free_tag: Label3D
var _lamp_mat: StandardMaterial3D
var _t := 0.0
var _active := false


func _ready() -> void:
	var body := Node3D.new()
	body.name = "Bay"
	add_child(body)
	Kit.cyl(body, 1.3, 1.4, 0.2, Color("33283f"), Vector3(0, 0.1, 0), Vector3.ZERO, 10)
	Kit.cyl(body, 1.1, 1.1, 0.04, Kit.mat(Color("4a3b58"), 0.5, 0.5), Vector3(0, 0.22, 0), Vector3.ZERO, 10)
	for x in [-1.5, 1.5]:
		Kit.box(body, Vector3(0.22, 3.4, 0.22), Kit.CHARCOAL, Vector3(x, 1.7, 0))
		Kit.box(body, Vector3(0.5, 0.15, 0.5), Kit.METAL_DARK, Vector3(x, 0.08, 0))
	Kit.box(body, Vector3(3.4, 0.25, 0.3), Kit.RUST, Vector3(0, 3.45, 0))
	for i in 5:
		Kit.box(body, Vector3(0.05, 0.25, 0.3), Kit.LAMP, Vector3(-1.4 + i * 0.7, 3.45, 0.16))
	_lamp_mat = Kit.own_mat(Kit.LAMP, Kit.LAMP, 0.5)
	Kit.place(body, Kit.box_mesh(Vector3(0.3, 0.12, 0.3)), _lamp_mat, Vector3(0, 3.28, 0))
	Kit.light(body, Color("ffd38a"), Vector3(0, 2.8, 0.6), 1.2, 5.0)
	# welding arm hanging from the beam
	var hang := Node3D.new()
	hang.position = Vector3(0.5, 3.3, 0)
	body.add_child(hang)
	Kit.box(hang, Vector3(0.1, 1.2, 0.1), Kit.METAL_DARK, Vector3(0, -0.6, 0))
	Kit.box(hang, Vector3(0.06, 0.06, 0.5), Kit.METAL_LIGHT, Vector3(0, -1.2, 0.2))
	_arm = hang
	# the robot under repair, in pieces
	var ghost := Node3D.new()
	ghost.position = Vector3(0, 0.24, 0)
	ghost.scale = Vector3.ONE * 1.3
	body.add_child(ghost)
	var legs := Node3D.new()
	ghost.add_child(legs)
	Kit.box(legs, Vector3(0.12, 0.32, 0.14), Kit.METAL_DARK, Vector3(-0.13, 0.16, 0))
	Kit.box(legs, Vector3(0.12, 0.32, 0.14), Kit.METAL_DARK, Vector3(0.13, 0.16, 0))
	var torso := Node3D.new()
	ghost.add_child(torso)
	Kit.box(torso, Vector3(0.48, 0.38, 0.34), Kit.METAL, Vector3(0, 0.54, 0))
	var arms := Node3D.new()
	ghost.add_child(arms)
	Kit.box(arms, Vector3(0.09, 0.34, 0.09), Kit.METAL_DARK, Vector3(0.29, 0.5, 0))
	Kit.box(arms, Vector3(0.09, 0.34, 0.09), Kit.METAL_DARK, Vector3(-0.29, 0.5, 0))
	var head := Node3D.new()
	ghost.add_child(head)
	Kit.box(head, Vector3(0.36, 0.26, 0.3), Kit.METAL_LIGHT, Vector3(0, 0.9, 0))
	_eye = Kit.ball(head, 0.065, Kit.glow(Kit.ROLE_COLORS.idle, 3.0), Vector3(0.06, 0.92, 0.15), 8)
	_pieces = [legs, torso, arms, head]
	_sparks = Fx.sparks(body, Vector3(0.2, 1.1, 0.3))
	# progress bar above the bay
	_bar = Node3D.new()
	_bar.position = Vector3(0, 3.9, 0)
	body.add_child(_bar)
	Kit.box(_bar, Vector3(2.4, 0.14, 0.05), Kit.CHARCOAL, Vector3.ZERO)
	_bar_fill = Kit.box(_bar, Vector3(2.3, 0.08, 0.06), Kit.glow(Kit.LAMP, 2.0), Vector3.ZERO)
	_free_tag = Kit.label(body, "", Vector3(0, 4.35, 0), Kit.VERDIGRIS, 34)
	# upgrade props
	var board := Node3D.new()
	board.position = Vector3(-2.2, 0, -0.6)
	body.add_child(board)
	Kit.box(board, Vector3(0.9, 1.4, 0.08), Color("4a3b58"), Vector3(0, 1.3, 0))
	Kit.box(board, Vector3(0.08, 1.9, 0.08), Kit.CHARCOAL, Vector3(-0.4, 0.95, -0.05))
	Kit.box(board, Vector3(0.08, 1.9, 0.08), Kit.CHARCOAL, Vector3(0.4, 0.95, -0.05))
	for i in 4:
		Kit.box(board, Vector3(0.06, 0.5, 0.04), Kit.METAL_LIGHT, Vector3(-0.27 + i * 0.18, 1.3, 0.06), Vector3(0, 0, 10 - i * 6))
	_props.wrench = board
	var oil := Node3D.new()
	oil.position = Vector3(2.3, 0, 0.6)
	body.add_child(oil)
	for i in 3:
		Kit.cyl(oil, 0.3, 0.3, 0.85, Color("2f5d5a") if i != 1 else Color("6a3f2a"), Vector3((i % 2) * 0.6, 0.43, (i / 2) * 0.62), Vector3.ZERO, 10)
		Kit.cyl(oil, 0.31, 0.31, 0.05, Kit.CHARCOAL, Vector3((i % 2) * 0.6, 0.6, (i / 2) * 0.62), Vector3.ZERO, 10)
	Kit.cyl(oil, 0.5, 0.5, 0.01, Kit.mat(Color("120d14"), 0.05, 0.6), Vector3(0.2, 0.01, 1.1), Vector3.ZERO, 12)
	_props.oil = oil
	var fab := Node3D.new()
	fab.position = Vector3(-1.5, 3.3, 0)
	body.add_child(fab)
	Kit.box(fab, Vector3(0.35, 0.3, 0.35), Kit.LAMP, Vector3(0, -0.15, 0))
	var fab_arm := Node3D.new()
	fab_arm.position = Vector3(0, -0.3, 0)
	fab.add_child(fab_arm)
	Kit.box(fab_arm, Vector3(0.12, 1.0, 0.12), Kit.LAMP, Vector3(0, -0.5, 0))
	Kit.box(fab_arm, Vector3(0.1, 0.1, 0.4), Kit.METAL_DARK, Vector3(0, -1.0, 0.15))
	_props.factory = fab
	_props.factory_arm = fab_arm
	area = Interactable.new()
	add_child(area)
	area.setup(body, Vector3(3.4, 3.6, 2.4), Vector3(0, 1.8, 0), 1.8, "Ремонтная станция", "Клик — чинить робота (E)", Kit.LAMP)


## progress 0..1, or -1 when the bay is empty
func show_repair(progress: float, free: bool) -> void:
	_active = progress >= 0.0
	for i in _pieces.size():
		_pieces[i].visible = _active and progress >= i * 0.25
	_bar.visible = _active
	if _active:
		_bar_fill.scale.x = maxf(0.01, progress)
		_bar_fill.position.x = -1.15 * (1.0 - progress)
	_eye.visible = _active and progress >= 0.9
	_free_tag.text = tr("бесплатно") if _active and free else ""


func show_props(s: GameState) -> void:
	_props.wrench.visible = s.lvl("wrench") > 0
	_props.oil.visible = s.lvl("oil") > 0
	_props.factory.visible = s.lvl("factory") > 0


func set_welding(on: bool) -> void:
	_sparks.emitting = on


func hit_fx() -> void:
	_sparks.emitting = true
	_lamp_mat.emission_energy_multiplier = 4.0


func _process(delta: float) -> void:
	_t += delta
	_arm.rotation.z = sin(_t * 1.3) * 0.25 if _active else lerpf(_arm.rotation.z, 0.0, 0.1)
	_props.factory_arm.rotation.x = sin(_t * 3.0) * 0.5 if _active else 0.0
	_lamp_mat.emission_energy_multiplier = lerpf(_lamp_mat.emission_energy_multiplier, 1.5 + sin(_t * 9.0) * 0.8 if _active else 0.3, 0.2)
