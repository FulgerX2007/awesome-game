class_name MenuBackdrop
extends Node3D
## The living picture behind the menus: a little island with the mage cheering and the camera drifting.

var _cam: Camera3D
var _hero: Node3D
var _hero_id := ""
var _t := 0.0


func _ready() -> void:
	LevelEnvironment.build(self, -10, 10)
	var g := Ground.new()
	g.style = "terrain"
	g.length = 7
	g.rows = 5
	g.position = Vector3(-6, 0, -1)
	add_child(g)
	for p in [["hexagon/building_windmill_yellow", Vector3(-4.5, 0, -2.4), 2.4], ["kaykit_forest/Tree_1_A_Color1", Vector3(3.6, 0, -2.6), 0.85],
			["kaykit_forest/Tree_3_A_Color1", Vector3(6.0, 0, -1.6), 0.8], ["hexagon/building_home_A_blue", Vector3(1.5, 0, -3.2), 2.0],
			["kaykit_forest/Bush_1_E_Color1", Vector3(-1.6, 0, -2.4), 1.1], ["kaykit_forest/Grass_1_A_Color1", Vector3(4.4, 0, 1.6), 1.8],
			["kaykit_forest/Rock_3_Q_Color1", Vector3(-9, -1.6, -16), 1.6], ["kaykit_forest/Rock_3_R_Color1", Vector3(8, -1.6, -17), 1.5],
			["hexagon/cloud_big", Vector3(-3, 8, -14), 2.0], ["dungeon/chest_gold", Vector3(2.8, 0, 0.6), 0.6]]:
		var n := Art.instance(p[0])
		n.position = p[1]
		n.scale = Vector3.ONE * p[2]
		add_child(n)
	for i in 5:
		var s := Art.counting_stone(1.4)
		s.position = Vector3(-1.9 + i * 0.55, 0.25, 1.6)
		add_child(s)
	_show_hero()
	ProgressManager.settings_changed.connect(_show_hero)
	_cam = Camera3D.new()
	_cam.fov = 45
	add_child(_cam)
	_cam.make_current()


func _process(delta: float) -> void:
	_t += delta * 0.15
	_cam.position = Vector3(sin(_t) * 1.5, 3.0, 9.5)
	_cam.look_at(Vector3(0, -0.6, 0))


## The chosen hero stands in the middle and waves; picking another hero swaps it at once.
func _show_hero() -> void:
	var id: String = ProgressManager.settings.get("hero", "mage")
	if id == _hero_id:
		return
	_hero_id = id
	if _hero:
		_hero.queue_free()
	_hero = Art.hero(id)
	_hero.scale = Vector3.ONE * 0.72
	_hero.position = Vector3(-3.6, 0, 1.2)  # left of the menu cards, high enough to stay above the hero picker
	_hero.rotation_degrees.y = 25
	add_child(_hero)
	(_hero.get_node("AnimationPlayer") as AnimationPlayer).play("Idle_B")
	Fx.burst(self, _hero.global_position + Vector3(0, 1.0, 0), Color("#ffe066"), 18, 4.0)
