extends SceneTree
## Plays one level with the competent bot and prints the bosses' and defences' events and a status line
## every 5 s, for tuning: godot --headless --path godot/castle -s res://tests/trace.gd -- 20
const Bot := preload("res://tests/bot.gd")
func _initialize():
	var n := int(OS.get_cmdline_user_args()[0])
	var s := CastleSim.new_level(n, {}, 7)
	var t := 0.0
	var next := 0.0
	while s.status in ["ready", "between", "wave"]:
		if s.status != "wave":
			print("-- wave %d done wall %d gold %d up %s defs %d" % [s.wave, s.wall_hp, s.gold, s.up, s.defenses.size()])
			Bot.between(s, {})
			s.start_wave()
		var a = Bot.solve(s)
		if a != null:
			s.aim(a.x + deg_to_rad(randfn(0, 1.5)), a.y); s.set_firing(true)
		s.tick(); t += CastleSim.TICK
		for ev in s.drain():
			if ev.type in ["boss_phase", "telegraph", "stun", "impact", "summon", "boss_dead", "evade", "land", "struct_broken", "teleport"]:
				print("%6.1f %s" % [t, ev])
		if t >= next:
			next += 5.0
			var b := s.boss()
			print("%6.1f wave %d wall %.0f enemies %d %s" % [t, s.wave, s.wall_hp, s.enemies.size(), ("boss %s hp %.0f/%.0f ph%d %s x%.1f" % [b.kind, b.hp, b.max_hp, b.phase, b.state, b.x]) if b else ""])
	print(s.status)
	quit()
