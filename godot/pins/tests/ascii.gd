extends SceneTree
## Debug: ASCII snapshots of a level while a pull order plays (# rock, 1-5 pins, ~ water, L lava, $ gold, g gas,
## S stone, B keg, H hero, E enemy).
##   godot --headless --fixed-fps 60 --path godot/pins -s res://tests/ascii.gd -- <level> <order e.g. 132> <seconds between snapshots>
const World := preload("res://scripts/world.gd")
func _initialize() -> void:
	var a := OS.get_cmdline_user_args()
	var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/levels.json"))
	var def: Dictionary = data.LEVELS[int(a[0]) - 1]
	var order := Array(a[1].split("")).map(func(c): return int(c))
	var every := int(float(a[2]) * 60)
	var w := World.new()
	root.add_child(w)
	w.build(def)
	var nx := 0
	for f in 60 * 30:
		await physics_frame
		if w.settled() and nx < order.size():
			print("== pull %d at %.1fs" % [order[nx], f / 60.0])
			dump(w)
			w.pull(order[nx])
			nx += 1
		elif f % every == every - 1:
			print("== %.1fs %s" % [f / 60.0, w.status()])
			dump(w)
		if w.status().status != "playing":
			print("== END %.1fs %s" % [f / 60.0, w.status()])
			dump(w)
			break
	quit()
func dump(w) -> void:
	var g := []
	for i in World.W * World.H:
		g.append("#" if w.rock_grid[i] else " ")
	var put := func(r: Rect2, ch: String):
		for y in range(int(r.position.y), int(r.end.y)):
			for x in range(int(r.position.x), int(r.end.x)):
				g[y * World.W + x] = ch
	for id in w.pins:
		if not w.pins[id].pulled:
			put.call(World.cells(w.pins[id].def), str(id))
	for k in w.kegs:
		if k.live: put.call(k.rect, "B")
	put.call(w.hero.rect, "H")
	for e in w.enemies:
		put.call(e.rect, "x" if e.dead else "E")
	var ch := {water = "~", lava = "L", gold = "$", gas = "g", stone = "S"}
	for b in w.balls + w.stones:
		var c := Vector2i(b.position / World.CELL)
		if c.x >= 0 and c.y >= 0 and c.x < World.W and c.y < World.H:
			g[c.y * World.W + c.x] = ch[b.get_meta("type")]
	for y in World.H:
		print("".join(g.slice(y * World.W, (y + 1) * World.W)))
