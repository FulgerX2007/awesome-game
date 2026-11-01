extends Node
## Последняя крепость on Godot: screens, input, sound, progress, and the loop that runs the siege.
##   sim (CastleSim) holds the rules; every frame it steps, its events go to the views (castle, units, defences,
##   effects), the sound and the HUD, then the views sync to its state. The UI never reads enemy internals
##   except through the sim's own summaries (boss(), stats(), prices) and the events.
##   Screens: menu → campaign map (+ armory) → level briefing → the level (HUD; between waves a side panel
##   with the cards, the wall shop and the defences) → result; the endless mode skips the map.

const UI := preload("res://scripts/ui.gd")

const ENEMY_INFO := {
	footman = ["Пехотинец", "Простой воин с копьём."],
	scout = ["Разведчик", "Лёгкий и очень быстрый."],
	shield = ["Щитоносец", "Спереди щит: издалека бей навесом сверху. Прикрывает идущего следом."],
	knight = ["Рыцарь", "Тяжёлые латы и сильные удары."],
	archer = ["Лучник", "Стреляет издалека по укреплениям и стене."],
	ram = ["Таран", "Бьёт ворота вчетверо сильнее пехоты."],
	golem = ["Осадный голем", "Каменная броня; крушит баррикады и колья."],
	berserker = ["Берсерк", "Раненый впадает в ярость: быстрее и злее."],
	commander = ["Командир", "Воодушевляет тех, кто рядом: они быстрее и бьют сильнее."],
	flyer = ["Нетопырь", "Летит над кольями; оберег сбивает одного за волну, башни бьют их первыми."],
}
const BOSS_INFO := {
	iron_warlord = ["Железный полководец", "Рывок ломает укрепления. Колья сбивают его с ног: тогда он оглушён и уязвим. После каждого удара он открыт."],
	siege_titan = ["Осадный титан", "Удар оземь крушит укрепления; пока он замахивается, суставы открыты."],
	fire_dragon = ["Огненный дракон", "Огненные шары и дыхание; после дыхания садится отдохнуть — тогда бей."],
	shadow_beast = ["Теневой зверь", "Прыгает через баррикады, от града стрел уходит в тень. После прыжка открыт."],
	dark_king = ["Тёмный король", "Свита, колдовство за барьером и последний натиск."],
}
const DEFENSE_INFO := {
	stakes = ["Колья", "Ранят и замедляют пеших; тупятся. Сбивают рывок полководца."],
	barricade = ["Баррикада", "Держит пеших, пока цела."],
	reinforced = ["Укреплённая баррикада", "Тяжёлые брёвна и железо: крепче и с бронёй."],
	tower = ["Стрелковая башня", "Стреляет сама, летунов — первыми."],
	oil = ["Масляная ловушка", "Кипящее масло: огненное пятно, раз за волну."],
}
const TELEGRAPH_TEXT := {charge = "Рывок!", slam = "Удар оземь!", breath = "Огненное дыхание!", leap = "Прыжок!",
	curse = "Проклятие!", shockwave = "Волна тьмы!", summon = "Призыв!"}
const WHY_TEXT := {occupied = "Место занято", nogold = "Не хватает золота", locked = "Ещё не открыто",
	noslot = "Это место закрыто", closed = "Строить можно только между волнами"}

var progress: CastleProgress
var sim: CastleSim
var world: CastleWorld
var castle: CastleKeep
var units: CastleUnits
var defs: CastleDefenses
var fx: CastleFx
var sfx: CastleSfx
var ui: UI
var screen := "menu"
var paused := false
var level_n := 1
var _press := {}                    # the aiming gesture: {at, moved}
var _keys_fire := false
var _build_type := ""               # the defence chosen for placing ("" none, "demolish")
var _hover_slot := -1
var _seen_kinds := {}
var _bossed := false
var _result := {}
var _slowmo := 0.0
var _env_key := ""
var _debug := {}
var _debug_bot = null


func _ready() -> void:
	TranslationServer.set_locale(CastleStore.detect_lang())
	progress = CastleProgress.load_saved()
	sfx = CastleSfx.new()
	add_child(sfx)
	world = CastleWorld.new()
	add_child(world)
	ui = UI.new()
	ui.main = self
	add_child(ui)
	get_viewport().size_changed.connect(_on_resize)
	_show_menu()


func _on_resize() -> void:
	if world.camera:
		world.fit_camera(get_viewport().get_visible_rect().size)
	ui.layout()


## Builds the stage for a region and time of day; the castle and the views live in it.
func _stage(env_name: String, time: String) -> void:
	var key := env_name + "/" + time
	if key == _env_key and castle:
		return
	_env_key = key
	world.build(env_name, time)
	world.fit_camera(get_viewport().get_visible_rect().size)
	castle = CastleKeep.new()
	world.add_child(castle)
	castle.build(world)
	units = CastleUnits.new()
	defs = CastleDefenses.new()
	fx = CastleFx.new()
	for v in [units, defs, fx]:
		world.add_child(v)
	fx.setup(world)


## ── Screens ──

func _show_menu() -> void:
	screen = "menu"
	sim = null
	paused = false
	Engine.time_scale = 1.0
	_stage("frontier", "day")
	castle.set_health(1.0, true)
	_clear_views()
	ui.show_menu()


func show_map() -> void:
	screen = "map"
	sim = null
	_clear_views()
	ui.show_map()


func show_armory() -> void:
	screen = "armory"
	ui.show_armory()


func show_brief(n: int) -> void:
	level_n = n
	screen = "brief"
	var l := CastleContent.level(n)
	_stage(l.region, l.time)
	castle.set_health(1.0, true)
	ui.show_brief(n)


func _clear_views() -> void:
	if units == null:
		return
	units.clear()
	defs.clear()
	fx.hide_aim()
	defs.hide_slots()


func start_level(n: int) -> void:
	level_n = n
	var l := CastleContent.level(n)
	_stage(l.region, l.time)
	sim = CastleSim.new_level(n, progress.armory, int(Time.get_ticks_usec() % 100000) + n)
	_begin()


func start_endless() -> void:
	_stage("frontier", "day")
	sim = CastleSim.new_endless(progress.armory, progress.opened, int(Time.get_ticks_usec() % 100000))
	_begin()


func _begin() -> void:
	screen = "play"
	paused = false
	Engine.time_scale = 1.0
	_bossed = false
	_build_type = ""
	_press = {}
	_seen_kinds = {}
	_slowmo = 0.0
	_clear_views()
	castle.set_health(1.0, true)
	ui.show_play()
	_refresh_build()


func restart() -> void:
	if sim and sim.mode == "endless":
		start_endless()
	else:
		start_level(level_n)


func next_level() -> void:
	show_brief(mini(level_n + 1, CastleContent.levels().size()))


func toggle_sound() -> void:
	sfx.set_enabled(not sfx.enabled)
	sfx.play("click")
	ui.refresh()


func toggle_lang() -> void:
	var to := "ro" if TranslationServer.get_locale().begins_with("ru") else "ru"
	TranslationServer.set_locale(to)
	CastleStore.set_item("lang", to)
	ui.rebuild()


func set_paused(on: bool) -> void:
	if screen != "play" or sim == null or sim.status in ["won", "lost"]:
		return
	paused = on
	if on:
		sim.set_firing(false)
		_press = {}
	ui.show_pause(on)


func fight() -> void:
	if sim == null or not (sim.status in ["ready", "between"]):
		return
	if sim.prep_left > 0:
		ui.toast(tr("Сначала выбери улучшения: ещё {n}").format({n = sim.prep_left}), UI.BAD)
		return
	_build_type = ""
	_hover_slot = -1
	sim.start_wave()


func choose_card(id: String) -> void:
	if sim and sim.choose_card(id):
		sfx.play("coin")
		ui.refresh()


func buy(item: String) -> void:
	if sim == null:
		return
	var r := sim.buy(item)
	if r == "ok":
		sfx.play("build")
		castle.repair()
	elif r == "nogold":
		ui.toast(tr("Не хватает золота"), UI.BAD)
	elif r == "full":
		ui.toast(tr("Стена цела"), UI.DIM)
	ui.refresh()


func fix_defenses() -> void:
	if sim == null:
		return
	var r := sim.fix_defenses()
	if r == "ok":
		sfx.play("build")
	elif r == "nogold":
		ui.toast(tr("Не хватает золота"), UI.BAD)
	ui.refresh()


func select_build(type: String) -> void:
	_build_type = "" if _build_type == type else type
	sfx.play("click")
	_refresh_build()
	ui.refresh()


func buy_armory(id: String) -> void:
	var r := progress.buy_armory(id)
	if r == "ok":
		progress.save()
		sfx.play("build")
	elif r == "nogold":
		ui.toast(tr("В казне не хватает золота"), UI.BAD)
	ui.refresh()


## ── The loop ──

func _process(delta: float) -> void:
	if _slowmo > 0.0:
		_slowmo -= delta / maxf(0.05, Engine.time_scale)
		if _slowmo <= 0.0:
			Engine.time_scale = 1.0
			_finish()
	if sim == null or screen != "play":
		return
	if not paused:
		if _debug_bot != null:
			_debug_bot.call(sim)
		sim.step(delta)
		for ev in sim.drain():
			_on_event(ev)
	for v in [units, defs, fx]:
		v.sync(sim, 0.0 if paused else delta)
	castle.set_health(sim.wall_hp / sim.wall_max)
	castle.set_aim(sim.aim_angle, sim.firing)
	_update_aim_preview()
	ui.update_play(delta)


func _update_aim_preview() -> void:
	# the dotted flight is drawn by the UI in screen pixels, so it reads at any zoom and over any sky
	fx.hide_aim()
	ui.aim_points.clear()
	var aiming := sim.status == "wave" and (not _press.is_empty() or _keys_fire)
	if not aiming:
		return
	for k in range(1, 60):
		var p := sim.flight(sim.aim_angle, sim.aim_power, k * 0.06)
		if p.x > CastleWorld.FIELD_X1:
			break
		if p.y < 0.0:
			# where it lands: the last point, on the ground
			var prev := sim.flight(sim.aim_angle, sim.aim_power, (k - 1) * 0.06)
			var f := prev.y / maxf(1e-4, prev.y - p.y)
			ui.aim_points.append(world.to_screen(Vector3(lerpf(prev.x, p.x, f), 0.0, 0.0)))
			ui.aim_lands = true
			return
		ui.aim_points.append(world.to_screen(Vector3(p.x, p.y, 0.0)))
	ui.aim_lands = false


func _on_event(ev: Dictionary) -> void:
	for v in [units, defs, fx]:
		v.on_event(ev)
	match ev.type:
		"fire":
			sfx.play("bow", -4.0)
			castle.shoot()
		"hit":
			if ev.cause != "fire":
				sfx.play("hit", -8.0)
		"shield_hit":
			sfx.play("clank", -6.0)
		"kill":
			sfx.play("kill", -5.0)

		"wall_hit":
			sfx.play("wall", -3.0)
			castle.hit()
			world.shake(0.15)
		"ward":
			sfx.play("ward")
		"stake_hit":
			sfx.play("stake", -8.0)
		"struct_broken":
			sfx.play("crack")
			ui.toast(tr("Укрепление разрушено: {name}").format({name = tr(DEFENSE_INFO.get(ev.what, ["?"])[0])}), UI.BAD)
		"placed":
			sfx.play("build")
		"oil", "fireball":
			sfx.play("fire")
		"impact", "shot_hit":
			if ev.type == "impact" or ev.kind == "boulder":
				sfx.play("boom")
				world.shake(0.5 if ev.type == "impact" else 0.3)
		"telegraph":
			sfx.play("warn")
			ui.toast(tr(TELEGRAPH_TEXT.get(ev.kind, "!")), UI.WARN, 1.2)
		"summon", "cast", "teleport", "evade":
			sfx.play("magic", -4.0)
		"rage":
			sfx.play("roar", -10.0, 1.6)
		"stun":
			ui.toast(tr("Оглушён — бей!"), UI.GOOD, 1.6)
		"boss_phase":
			sfx.play("roar")
			world.shake(0.8)
			ui.toast(tr("Последняя фаза!") if ev.final else tr("Фаза {n}").format({n = ev.phase}), UI.WARN, 2.0)
		"boss_dead":
			sfx.play("boom")
			world.shake(1.2)
			if ev.kind == "dark_king":
				Engine.time_scale = 0.3
				_slowmo = 2.4
		"wave_start":
			sfx.play("horn")
			_announce(ev.kinds)
			_refresh_build()
		"wave_clear":
			sfx.play("coin")
			if ev.no_damage:
				ui.toast(tr("Стена без царапины: +{n} золота").format({n = ev.bonus}), UI.GOOD, 2.2)
			_refresh_build()
		"won", "lost":
			if _slowmo <= 0.0:
				_finish()
	if ev.type in ["wave_start", "wave_clear", "won", "lost", "bought", "placed", "demolished", "fixed"]:
		ui.refresh()


## A new kind of enemy or a boss gets a warning the first time it marches in this level.
func _announce(kinds: Array) -> void:
	var first := _first_levels()
	for k in kinds:
		if _seen_kinds.has(k):
			continue
		_seen_kinds[k] = true
		if CastleContent.is_boss(k):
			ui.banner(tr("Босс: {name}").format({name = tr(BOSS_INFO[k][0])}), tr(BOSS_INFO[k][1]))
			_bossed = true
			sfx.play("roar")
		elif sim.mode == "level" and int(first.get(k, 0)) == sim.level_n:
			ui.banner(tr("Новый враг: {name}").format({name = tr(ENEMY_INFO[k][0])}), tr(ENEMY_INFO[k][1]))


static var _first_cache := {}


## The level where each kind first appears in the campaign.
static func _first_levels() -> Dictionary:
	if _first_cache.is_empty():
		for l in CastleContent.levels():
			for w in l.waves:
				for sp in CastleContent.level_wave(w).spawns:
					if not _first_cache.has(sp.kind):
						_first_cache[sp.kind] = int(l.n)
	return _first_cache


## The level is over: record it, then the result screen (after the Dark King, the victory sequence first).
func _finish() -> void:
	if screen != "play" or sim == null:
		return
	sim.set_firing(false)
	_press = {}
	var won := sim.status == "won"
	if sim.mode == "level":
		_result = progress.record_level(sim)
		_result.won = won
		_result.final = won and sim.level_n == CastleContent.levels().size()
	else:
		var better := progress.record_endless(sim)
		_result = {won = false, endless = true, score = sim.score(), better = better}
	progress.save()
	sfx.play("win" if won else "lose")
	screen = "result"
	if _result.get("final", false):
		_victory_camera()
	ui.show_result(_result)


## The Dark King has fallen: the camera eases in over the castle while the banners fly.
func _victory_camera() -> void:
	var from := world.camera.transform
	var to := Transform3D(Basis(), Vector3(8, 9, 34)).looking_at(Vector3(2, 7, 0))
	var tw := create_tween()
	tw.tween_method(func(f): world.set_view(from.interpolate_with(to, f)), 0.0, 1.0, 2.5).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


## ── Building ──

func _refresh_build() -> void:
	if sim == null or not (sim.status in ["ready", "between"]) or sim.slots == 0:
		defs.hide_slots()
		return
	var why := ""
	if _build_type != "" and _build_type != "demolish" and _hover_slot >= 0:
		why = sim.can_place(_hover_slot, _build_type)
	defs.show_slots(sim.slots, _build_type if _build_type != "demolish" else "", _hover_slot, why)


## The slot under a screen point (near the lane), or -1.
func _slot_at(screen_pos: Vector2) -> int:
	if sim == null:
		return -1
	var p := world.to_lane(screen_pos)
	var best := -1
	var bd := 1.9
	for i in sim.slots:
		var d := absf(p.x - CastleSim.SLOT_X[i])
		if d < bd and p.y < 9.0:
			bd = d
			best = i
	return best


func _place_at(slot: int) -> void:
	if slot < 0 or sim == null:
		return
	if _build_type == "demolish":
		if sim.demolish(slot):
			sfx.play("crack")
		return
	if _build_type == "":
		if sim.defense_at(slot):
			ui.toast(tr("Выбери «Снести», чтобы убрать укрепление"), UI.DIM)
		else:
			ui.toast(tr("Выбери укрепление внизу панели"), UI.DIM)
		return
	var r := sim.place(slot, _build_type)
	if r != "ok":
		ui.toast(tr(WHY_TEXT.get(r, r)), UI.BAD)
		sfx.play("click")


## ── Input ──

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_P:
				set_paused(not paused)
			KEY_ESCAPE:
				if screen == "play":
					set_paused(not paused)
				elif screen in ["map", "armory", "brief"]:
					_show_menu() if screen == "map" else show_map()
			KEY_M:
				toggle_sound()
			KEY_ENTER, KEY_KP_ENTER:
				if screen == "play" and sim and sim.status in ["ready", "between"]:
					fight()
	if screen != "play" or sim == null or paused:
		return
	if event is InputEventKey:
		if event.keycode == KEY_SPACE:
			_keys_fire = event.pressed
			sim.set_firing(event.pressed)
		elif event.pressed and event.keycode in [KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT]:
			var da := deg_to_rad(2.0) * (1 if event.keycode == KEY_UP else (-1 if event.keycode == KEY_DOWN else 0))
			var dp := 0.04 * (1 if event.keycode == KEY_RIGHT else (-1 if event.keycode == KEY_LEFT else 0))
			sim.aim(sim.aim_angle + da, sim.aim_power + dp)
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			if sim.status in ["ready", "between"]:
				_place_at(_slot_at(event.position))
				_refresh_build()
				return
			_press = {at = event.position}
			if ui.tip_visible():
				ui.hide_tip()
		else:
			_press = {}
			sim.set_firing(false)
	elif event is InputEventMouseMotion:
		if sim.status in ["ready", "between"]:
			var s := _slot_at(event.position)
			if s != _hover_slot:
				_hover_slot = s
				_refresh_build()
		elif not _press.is_empty():
			var a = UI.aim_from_drag(event.position - _press.at)
			if a != null:
				sim.aim(a.x, a.y)
				sim.set_firing(true)


## ── Debug (tests/shot.gd) ──

func debug_setup(args: Dictionary) -> void:
	_debug = args
	if args.has("lang"):
		TranslationServer.set_locale(args.lang)
		ui.rebuild()
	if args.has("level"):
		var n := int(args.level)
		start_level(n)
		var bot = load("res://tests/bot.gd")
		_debug_bot = func(s: CastleSim):
			if s.status in ["ready", "between"] and not args.has("stay"):
				if not args.has("nobuild"):
					bot.between(s, {})
				else:
					while s.prep_left > 0 and s.choose_card(s.offer[0]): pass
				s.start_wave()
			var a = bot.solve(s)
			if a != null:
				s.aim(a.x, a.y)
				s.set_firing(true)
		var t := float(args.get("t", 8.0))
		if args.has("wave"):
			# skip ahead to a wave (the bot plays the ones before at full speed)
			while sim.wave < int(args.wave) and sim.status in ["ready", "between", "wave"]:
				_debug_bot.call(sim)
				sim.tick()
				sim.drain()
		_refresh_build()
		if args.has("spawn"):
			for k in String(args.spawn).split(","):
				var kv := k.split("@")
				sim.spawn(kv[0], {x = float(kv[1]) if kv.size() > 1 else 30.0})
		if args.has("wall"):
			sim.wall_hp = sim.wall_max * float(args.wall)
		var steps := int(t * 60)
		for i in steps:
			_debug_bot.call(sim)
			sim.tick()
			for ev in sim.drain():
				_on_event(ev)
		if args.has("burn"):
			for e in sim.enemies:
				e.burn = CastleSim.BURN_TIME
		if args.has("aim"):
			# hold the aim (the preview shows) at angle,power
			var v := String(args.aim).split(",")
			_debug_bot = null
			sim.aim(deg_to_rad(float(v[0])), float(v[1]))
			_keys_fire = true
			sim.set_firing(true)
		if args.has("stay"):
			_debug_bot = null
		ui.refresh()
	elif args.has("screen"):
		match args.screen:
			"map": show_map()
			"armory": show_armory()
			"brief": show_brief(int(args.get("n", 4)))
			"result":
				start_level(int(args.get("n", 4)))
				sim.status = "won" if args.get("won", "1") == "1" else "lost"
				_finish()
