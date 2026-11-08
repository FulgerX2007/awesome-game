extends Node
## Autoload "Game": the one owner of the GameState in the running game.
##   - runs the rules in fixed 0.1 s steps (the same result at any frame rate; nothing runs while paused)
##   - is the only place the UI and the world change the state through (actions below)
##   - turns what the rules report (GameState.out) into signals for the UI, the world and the sound
##   - autosaves, loads, migrates and catches up on time away (up to 8 hours)
## Nothing starts until boot() is called (by the main scene), so tests can use the rules alone.

## After every batch of simulation steps (about 10 Hz): numbers changed.
signal ticked
## After a player action changed the state: refresh now.
signal changed
## The whole state was replaced (load, reset, new dawn): rebuild views.
signal state_replaced
## Every event the rules report: {type, ...} (robot_built, core_found, upgrade_bought, stage_built,
## zone_opened, salvage_spawn, salvage_gone, salvage_taken, wreck_spawn, wreck_taken, shortage_start,
## shortage_end, achievement, log, drone).
signal event(e: Dictionary)
## A manual action: kind is dig | sort | repair; amount 0 means it could not be done.
signal acted(kind: String, amount: float, info: Dictionary)
signal paused_changed(paused: bool)
signal notify(text: String, kind: String)
signal offline_report(report: Dictionary, seconds: float)
signal saved(ok: bool, manual: bool)

const STEP := 0.1
const MAX_STEPS_PER_FRAME := 40
const AUTOSAVE_EVERY := 10.0
const AWAY_THRESHOLD := 3.0

var s: GameState = GameState.create()
var paused := false
var running := false
var _acc := 0.0
var _last_wall := 0
var _since_save := 0.0
var _js_hide: JavaScriptObject


func boot(seed_value := -1) -> void:
	var res := SaveManager.read(SaveManager.AUTO)
	if res.status == "missing":
		var legacy := Settings.legacy_web_save()
		if not legacy.is_empty():
			res = SaveManager.decode(legacy)
			if res.status == "ok":
				res.status = "legacy"
	match res.status:
		"ok", "restored", "legacy":
			s = res.state
		"corrupt", "newer":
			# keep the unreadable file aside, never overwrite it silently
			DirAccess.copy_absolute(SaveManager.path(SaveManager.AUTO), SaveManager.path("rust_dawn.%s.json" % res.status))
			s = GameState.create(seed_value)
		_:
			s = GameState.create(seed_value)
	StoryData.check(s)
	s.drain()
	running = true
	_last_wall = Time.get_ticks_msec()
	if OS.has_feature("web"):
		# save when the tab is hidden or closed (the browser gives no close request)
		_js_hide = JavaScriptBridge.create_callback(func(_args): save())
		var doc := JavaScriptBridge.get_interface("document")
		var win := JavaScriptBridge.get_interface("window")
		doc.addEventListener("visibilitychange", _js_hide)
		win.addEventListener("pagehide", _js_hide)
	state_replaced.emit()
	match res.status:
		"restored": notify.emit(tr("Сохранение было повреждено, загружена резервная копия"), "warn")
		"corrupt": notify.emit(tr("Сохранение повреждено, игра начата заново (файл отложен)"), "warn")
		"newer": notify.emit(tr("Сохранение от более новой версии игры, игра начата заново (файл отложен)"), "warn")
		"legacy": notify.emit(tr("Прогресс из веб-версии перенесён"), "good")
	if res.has("saved_at") and res.saved_at > 0.0:
		_catch_up(Time.get_unix_time_from_system() - res.saved_at, true)
	save()


func _process(delta: float) -> void:
	if not running:
		return
	var now := Time.get_ticks_msec()
	var gap := (now - _last_wall) / 1000.0
	_last_wall = now
	if paused:
		return
	if gap > AWAY_THRESHOLD:
		# the tab was hidden or the machine slept: catch up the quick way
		_catch_up(gap, false)
		return
	feed(delta)
	_since_save += delta
	if _since_save >= AUTOSAVE_EVERY:
		save()


## One frame's worth of time: the rules advance in whole STEPs, the rest waits for the next frame,
## so 30, 60 or 144 fps give the same game.
func feed(delta: float) -> int:
	_acc += minf(delta, 0.25)
	var steps := 0
	while _acc >= STEP - 1e-9 and steps < MAX_STEPS_PER_FRAME:
		_acc -= STEP
		steps += 1
		ProductionManager.tick(s, STEP)
		_flush()
	if steps > 0:
		ticked.emit()
	return steps


## Runs the rules for `seconds` of game time in fixed steps (tests and debugging).
func advance(seconds: float) -> void:
	var n := int(round(seconds / STEP))
	for i in n:
		ProductionManager.tick(s, STEP)
		_flush()
	ticked.emit()


func _catch_up(seconds: float, report: bool) -> void:
	if seconds < 1.0 or s.launched:
		return
	var r := ProductionManager.offline(s, seconds)
	_flush()
	changed.emit()
	if report and seconds > 30.0 and (r.scrap >= 1.0 or r.parts >= 1.0):
		offline_report.emit(r, minf(seconds, ProductionManager.OFFLINE_CAP))


func _flush() -> void:
	for e in s.drain():
		event.emit(e)
		match e.type:
			"achievement":
				notify.emit(tr("Достижение: {name}").format({name = tr(e.name)}), "good")
			"salvage_spawn":
				notify.emit(tr("Находка! Светящийся ящик на свалке — подбери, пока не засыпало"), "info")
			"wreck_spawn":
				notify.emit(tr("Брошенный робот у ограды. Его можно починить бесплатно"), "info")
			"shortage_start":
				notify.emit(tr("Перебой с питанием! Автоматика на половине мощности"), "warn")
			"shortage_end":
				if e.fixed:
					notify.emit(tr("Питание восстановлено"), "good")
			"stage_built":
				notify.emit(tr("Этап готов: {name}").format({name = tr(GameData.stages()[e.index].name)}), "good")
			"zone_opened":
				notify.emit(tr("Открыта новая зона свалки"), "good")


# ── Player actions: the only way the game changes the state ──

func dig() -> float:
	var n := ProductionManager.dig(s)
	_after("dig", n)
	return n


func sort() -> int:
	var cores := floorf(s.stats.cores)
	var n := ProductionManager.disassemble(s)
	_after("sort", n, {core = floorf(s.stats.cores) > cores})
	return n


func repair() -> float:
	var built := s.built
	var n := ProductionManager.repair_click(s)
	_after("repair", n, {finished = s.built > built, cost = ProductionManager.derived(s).robot_cost})
	return n


func _after(kind: String, amount: float, info := {}) -> void:
	StoryData.check(s)
	AchievementManager.check(s)
	_flush()
	acted.emit(kind, amount, info)
	changed.emit()


func assign(role: String, delta: int) -> void:
	if WorkerManager.assign(s, role, delta) > 0:
		changed.emit()


func assign_all(role: String) -> void:
	if WorkerManager.assign_all(s, role) > 0:
		changed.emit()


func unassign_all(role: String) -> void:
	if WorkerManager.unassign_all(s, role) > 0:
		changed.emit()


func set_auto_repair(on: bool) -> void:
	s.auto_repair = on
	changed.emit()


func set_drone_task(task: String) -> void:
	if task in ["dig", "sort", "repair"]:
		s.drone_task = task
		changed.emit()


func buy(id: String) -> bool:
	var ok := UpgradeManager.buy(s, id)
	if ok:
		_after_change()
	return ok


func build_stage() -> bool:
	var ok := ReconstructionManager.build(s)
	if ok:
		_after_change()
		save()
	return ok


func collect_salvage() -> Dictionary:
	var r := EventManager.collect_salvage(s)
	if not r.is_empty():
		_after_change()
	return r


func recruit_wreck() -> bool:
	var ok := EventManager.recruit_wreck(s)
	if ok:
		_after_change()
	return ok


func fix_shortage() -> bool:
	var ok := EventManager.fix_shortage(s)
	if ok:
		_after_change()
	return ok


func _after_change() -> void:
	StoryData.check(s)
	AchievementManager.check(s)
	_flush()
	changed.emit()


func new_dawn() -> void:
	if not s.launched:
		return
	s = ReconstructionManager.prestige(s)
	StoryData.check(s)
	StoryData.add_log(s, "Новый рассвет. В тетради чертежей: {n}, руки помнят больше.", {n = s.blueprints})
	AchievementManager.check(s)
	s.drain()
	state_replaced.emit()
	save()


func reset() -> void:
	var keep := s.achievements.duplicate()
	s = GameState.create()
	s.achievements = keep
	StoryData.check(s)
	s.drain()
	state_replaced.emit()
	save()


func set_paused(p: bool) -> void:
	if paused == p:
		return
	paused = p
	if p:
		save()
	paused_changed.emit(p)


# ── Saving ──

func save() -> bool:
	if not running:
		return false
	_since_save = 0.0
	var ok := SaveManager.write(s, SaveManager.AUTO)
	saved.emit(ok, false)
	return ok


func save_manual() -> bool:
	var ok := SaveManager.write(s, SaveManager.MANUAL)
	saved.emit(ok, true)
	notify.emit(tr("Игра сохранена") if ok else tr("Не удалось сохранить"), "good" if ok else "warn")
	return ok


func load_manual() -> bool:
	var res := SaveManager.read(SaveManager.MANUAL)
	if res.status != "ok":
		notify.emit(tr("Ручного сохранения нет") if res.status == "missing" else tr("Ручное сохранение не читается"), "warn")
		return false
	s = res.state
	s.drain()
	state_replaced.emit()
	notify.emit(tr("Сохранение загружено"), "good")
	save()
	return true


func _notification(what: int) -> void:
	if what in [NOTIFICATION_WM_CLOSE_REQUEST, NOTIFICATION_APPLICATION_FOCUS_OUT, NOTIFICATION_APPLICATION_PAUSED]:
		save()
