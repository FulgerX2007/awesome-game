extends SceneTree
## The campaign against the bots of tests/bot.gd, with no armory upgrades bought (the campaign must not need them):
##   - a competent archer (aim error σ 1.5°, leads its target) who builds defences wins every level on 3 seeds;
##   - a player who never shoots loses every level, even with defences built: traps alone never win;
##   - a casual archer (σ 4°, ±10 % pull, re-aims every 0.3 s, doesn't lead, random cards — the casual bot of
##     tests/castle/bot.js) wins the first three levels and at least 12 of 20, but not all: the bosses bite;
##   - the competent archer without defences loses at least one level: defences matter.
##   godot --headless --path godot/castle -s res://tests/balance.gd [-- 4 8 12]

const Bot := preload("res://tests/bot.gd")
const CASUAL := {noise = 4.0, power_noise = 0.1, react = 0.3, lead = false, random_cards = true}
const SEEDS := [7, 11, 23]


func _initialize() -> void:
	var only := Array(OS.get_cmdline_user_args()).filter(func(a): return a.is_valid_int()).map(func(a): return int(a))
	var bad := []
	var t0 := Time.get_ticks_msec()
	var casual_won := 0
	var bare_lost := 0
	var played := 0
	for l in CastleContent.levels():
		var n := int(l.n)
		if only.size() and not n in only:
			continue
		played += 1
		var good := []
		for sd in SEEDS:
			good.append(Bot.play(n, {noise = 1.5, seed = sd}))
		var idle: Dictionary = Bot.play(n, {passive = true})
		var casual: Dictionary = Bot.play(n, CASUAL)
		var bare: Dictionary = Bot.play(n, {noise = 1.5, defenses = false})
		casual_won += 1 if casual.status == "won" else 0
		bare_lost += 1 if bare.status != "won" else 0
		print("L%2d %-24s competent: %s | idle: %s | casual: %s w%d %3d%% | no defences: %s w%d %3d%%" % [n, l.name,
			" ".join(good.map(func(g): return "%s %3d%% ★%d" % [g.status, int(g.wall * 100), g.stars])), idle.status,
			casual.status, casual.wave, int(casual.wall * 100), bare.status, bare.wave, int(bare.wall * 100)])
		for k in SEEDS.size():
			if good[k].status != "won":
				bad.append("level %d: the competent bot lost on wave %d (seed %d)" % [n, good[k].wave, SEEDS[k]])
		if idle.status != "lost":
			bad.append("level %d: a player who never shoots did not lose" % n)
		if n <= 3 and casual.status != "won":
			bad.append("level %d: the casual bot lost a tutorial level" % n)
	if only.is_empty():
		if casual_won < 12 or casual_won == played:
			bad.append("the casual bot won %d of %d levels (expected 12..%d)" % [casual_won, played, played - 1])
		if bare_lost == 0:
			bad.append("without defences the competent bot still won every level")
	print("casual won %d of %d, no-defences lost %d; %.1f s" % [casual_won, played, bare_lost, (Time.get_ticks_msec() - t0) / 1000.0])
	for b in bad:
		printerr(b)
	print("balance: %s" % ("ok" if bad.is_empty() else "%d problems" % bad.size()))
	quit(1 if bad.size() else 0)
