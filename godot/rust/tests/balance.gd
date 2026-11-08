extends SceneTree
## The ark's pace: a greedy bot (tests/bot.gd) plays three dawns, with world events and without.
##   godot --headless --path godot/rust -s res://tests/balance.gd
## The web game's ark takes the same bot 85 / 31 / 19 minutes; this version must stay close to that.

const LIMITS := [[60.0, 115.0], [22.0, 45.0], [13.0, 30.0]]


func _initialize() -> void:
	var failed := 0
	for events in [false, true]:
		var bot := RustBot.new()
		bot.events = events
		var s := GameState.create(11)
		var line := []
		for run in 3:
			var t := bot.play(s) / 60.0
			line.append("%.1f" % t)
			if not s.launched or t < LIMITS[run][0] or t > LIMITS[run][1]:
				failed += 1
				printerr("FAIL dawn %d %s events: %.1f min (want %s)" % [run + 1, "with" if events else "without", t, LIMITS[run]])
			print("  dawn %d: built %d, ups %s" % [run + 1, s.built, s.up])
			s = ReconstructionManager.prestige(s)
		print("ark %s events: %s min" % ["with" if events else "without", " / ".join(line)])
	print("balance: %s" % ("ok" if failed == 0 else "%d problems" % failed))
	quit(1 if failed else 0)
