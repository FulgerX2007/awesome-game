extends SceneTree
## The parity replay: reads a trace written by tools/winter-godot/trace.cjs (a web bot's calls on core.js, frame by
## frame), plays the same calls on WinterSim and writes the same per-second digests next to it.
##   godot --headless --path godot/winter -s res://tests/parity.gd -- <trace.json> <out.json>
## tests/winter-godot/parity.test.js runs it and compares the digests with the web version's.


## A number the way JS's String() writes the integers the digest holds.
static func num(v) -> String:
	if (v is float or v is int) and float(v) == floorf(float(v)) and absf(float(v)) < 1e15:
		return str(int(v))
	return str(v)


static func join_nums(list: Array) -> String:
	return ",".join(PackedStringArray(list.map(func(v): return num(v))))


static func digest(g: Dictionary, events: Array) -> Array:
	var h: Dictionary = g.hero
	var floats := [g.t, h.x, h.y, h.warmth, h.food, h.energy, h.health, g.fire.fuel, g.hut.stove]
	for s in g.survivors:
		floats.append_array([s.x, s.y, s.hp, s.food])
	for w in g.wolves:
		floats.append_array([w.x, w.y, w.hp])
	for a in g.animals:
		floats.append_array([a.x, a.y])
	if g.bear != null:
		floats.append_array([g.bear.x, g.bear.y, g.bear.hp])
	var ev = g.event
	var stock := []
	for k in WinterSim.ITEMS:
		stock.append(g.stock[k])
	var tools := ""
	for k in WinterSim.D.TOOLS:
		tools += "1" if g.tools[k] else "0"
	var pal := []
	for p in g.palisade:
		pal.append("%s:%s" % ["1" if p.built else "0", num(p.hp)])
	var bunks := ""
	for b in g.bunks:
		bunks += "1" if b.built else "0"
	var ups := ""
	for u in WinterSim.D.UPGRADE_IDS:
		ups += "1" if g.upgrades[u].built else "0"
	var offers = null
	if g.trader != null:
		offers = ""
		for o in g.trader.offers:
			offers += "1" if o.taken else "0"
	var amount := 0.0
	for n in g.nodes:
		amount += n.amount
	var drifts := 0
	for c in g.tiles:
		if c == "D":
			drifts += 1
	var exact := [
		WinterSim.day_of(g), g.status, g.rng, g.erng, g.nextId, g.hut.stage, g.hut.roofHole, g.iceDay, g.lastEvent,
		("%s:%s" % [ev.id, ev.phase]) if ev != null else null, offers,
		g.bear.id if g.bear != null else null, h.load, h.sleeping, h.target.type if h.target != null else null, h.path.size() if h.path != null else -1,
		join_nums(stock), tools, ",".join(PackedStringArray(pal)), bunks, ups,
		"%s%s%s%s" % [str(g.gear.coat), str(g.gear.lantern), str(g.gear.sled), num(g.gear.snares)],
		",".join(PackedStringArray(g.survivors.map(func(s): return s.state))),
		join_nums(g.wolves.map(func(w): return w.id)), join_nums(g.animals.map(func(a): return a.id)),
		g.torches.size(), g.snares.size(), amount, drifts,
		",".join(PackedStringArray(events.map(func(e): return e.type))),
	]
	return [floats, exact]


static func apply(g: Dictionary, call: Array) -> void:
	var a := call.slice(1)
	match call[0]:
		"interact": WinterSim.interact(g, a[0], a[1], a[2] if a.size() > 2 and a[2] is Dictionary else {})
		"eat": WinterSim.eat(g)
		"answer_event": WinterSim.answer_event(g, a[0])
		"contribute": WinterSim.contribute(g, a[0])
		"craft": WinterSim.craft(g, a[0])
		"trade": WinterSim.trade(g, a[0])
		"place_snare": WinterSim.place_snare(g, a[0], a[1])
		"place_torch": WinterSim.place_torch(g, int(a[0]), int(a[1]))
		"move_dir": WinterSim.move_dir(g, a[0], a[1])
		_: push_error("unknown call %s" % call[0])


## Replays a trace (the parsed JSON). → the digests
static func replay(tr: Dictionary) -> Array:
	var g := WinterSim.new_game(tr.difficulty, tr.seed)
	var calls: Dictionary = tr.calls
	var out := []
	var events := []
	for f in int(tr.frames):
		var key := str(f)
		if calls.has(key):
			for c in calls[key]:
				apply(g, c)
		WinterSim.step(g, tr.frame)
		events.append_array(WinterSim.drain(g))
		if (f + 1) % 4 == 0:
			out.append(digest(g, events))
			events = []
	if int(tr.frames) % 4 != 0:
		out.append(digest(g, events))   # the last moment (the win, the loss) too
	return out


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 2:
		printerr("usage: -- <trace.json> <out.json>")
		quit(2)
		return
	var tr = JSON.parse_string(FileAccess.get_file_as_string(args[0]))
	var t0 := Time.get_ticks_msec()
	var digests := replay(tr)
	var f := FileAccess.open(args[1], FileAccess.WRITE)
	f.store_string(JSON.stringify(digests, "", false, true))
	f.close()
	print("parity: %d digests in %d ms" % [digests.size(), Time.get_ticks_msec() - t0])
	quit()
