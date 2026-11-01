class_name MenuBackdrop
extends Node3D
## The living picture behind the menus: a little island with the mage cheering and the camera drifting.

var _cam: Camera3D
var _t := 0.0


func _ready() -> void:
	LevelEnvironment.build(self, -10, 10)
	var g := Ground.new()
	g.length = 7
	g.rows = 5
	g.position = Vector3(-6, 0, -1)
	add_child(g)
	for p in [["hexagon/building_windmill_yellow", Vector3(-4.5, 0, -2.4), 2.4], ["hexagon/tree_single_A", Vector3(3.6, 0, -2.2), 2.6],
			["hexagon/tree_single_B", Vector3(5.6, 0, -1.2), 2.3], ["hexagon/building_home_A_blue", Vector3(1.5, 0, -3.2), 2.0],
			["hexagon/mountain_A_grass_trees", Vector3(-8, -1.2, -12), 4.0], ["hexagon/mountain_C_grass_trees", Vector3(6, -1.2, -13), 4.2],
			["hexagon/cloud_big", Vector3(-3, 8, -14), 2.0], ["dungeon/chest_gold", Vector3(2.8, 0, 0.6), 0.6]]:
		var n := Art.instance(p[0])
		n.position = p[1]
		n.scale = Vector3.ONE * p[2]
		add_child(n)
	for i in 5:
		var s := Art.counting_stone(1.4)
		s.position = Vector3(-2.6 + i * 0.55, 0.25, 1.2)
		add_child(s)
	var mage := Art.instance("adventurers/Mage")
	mage.scale = Vector3.ONE * 0.75
	mage.position = Vector3(0, 0, 0.4)
	mage.rotation_degrees.y = 15
	add_child(mage)
	var anim: AnimationPlayer = mage.find_child("AnimationPlayer", true, false)
	if anim:
		anim.get_animation("Cheer").loop_mode = Animation.LOOP_LINEAR
		anim.play("Cheer")
	_cam = Camera3D.new()
	_cam.fov = 45
	add_child(_cam)
	_cam.make_current()


func _process(delta: float) -> void:
	_t += delta * 0.15
	_cam.position = Vector3(sin(_t) * 2.5, 3.2, 9.5)
	_cam.look_at(Vector3(0, 0.9, 0))
