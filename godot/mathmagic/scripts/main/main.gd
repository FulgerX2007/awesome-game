extends Node
## The app: title -> map -> level -> result -> next. Holds the 3D world container, the LevelManager and
## the UIManager and moves between them. Pausing freezes the world; the UI keeps running.

var levels: LevelManager
var ui: UIManager
var world: Node3D
var backdrop: Node3D


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_apply_language()
	world = Node3D.new()
	world.name = "World"
	world.process_mode = Node.PROCESS_MODE_PAUSABLE
	add_child(world)
	levels = LevelManager.new()
	levels.name = "LevelManager"
	levels.container = world
	add_child(levels)
	ui = UIManager.new()
	ui.name = "UI"
	add_child(ui)

	ui.play_pressed.connect(func(): start(ProgressManager.next_level()))
	ui.level_chosen.connect(start)
	ui.map_pressed.connect(show_map)
	ui.menu_pressed.connect(show_title)
	ui.pause_pressed.connect(pause)
	ui.resume_pressed.connect(resume)
	ui.restart_pressed.connect(func(): start(levels.index))
	ui.next_pressed.connect(func(): start(levels.index + 1))
	ui.intro_closed.connect(_on_intro_closed)
	levels.level_completed.connect(_on_completed)
	Sfx.music(true)
	show_title()


func _apply_language() -> void:
	var lang: String = ProgressManager.settings.get("lang", "")
	if lang == "":
		lang = detect_language()
	TranslationServer.set_locale(lang)


## The site's language when running in the browser (?lang=, then its saved choice), else the system's.
static func detect_language() -> String:
	var langs: Array = []
	if OS.has_feature("web"):
		var q = JavaScriptBridge.eval("new URLSearchParams(location.search).get('lang') || (function(){ try { return localStorage.getItem('lang'); } catch (e) { return null; } })() || (navigator.languages || [navigator.language]).join(',')", true)
		if q is String:
			langs = q.split(",")
	else:
		langs = [OS.get_locale()]
	for l in langs:
		var c := String(l).substr(0, 2).to_lower()
		if c == "ro" or c == "mo":
			return "ro"
		if c == "ru":
			return "ru"
		if c == "en":
			return "en"
	return "en"


func _show_backdrop() -> void:
	levels.unload()
	if backdrop == null:
		backdrop = MenuBackdrop.new()
		world.add_child(backdrop)


func _hide_backdrop() -> void:
	if backdrop:
		backdrop.queue_free()
		backdrop = null


func show_title() -> void:
	get_tree().paused = false
	_show_backdrop()
	ui.show_title()


func show_map() -> void:
	get_tree().paused = false
	_show_backdrop()
	ui.show_map()


func start(i: int) -> void:
	get_tree().paused = false
	ui.close_screen()
	_hide_backdrop()
	var lvl := levels.load_level(i)
	ui.show_hud(lvl)
	lvl.player.controls_enabled = false
	ui.show_intro(lvl)


func _on_intro_closed() -> void:
	if levels.current:
		levels.current.player.controls_enabled = true


func pause() -> void:
	if levels.current == null or levels.current.done or ui.has_screen():
		return
	get_tree().paused = true
	ui.show_pause()


func resume() -> void:
	ui.close_screen()
	get_tree().paused = false


func _on_completed(lvl: Level) -> void:
	await get_tree().create_timer(2.2).timeout
	if levels.current == lvl:
		ui.show_result(lvl)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		if get_tree().paused:
			resume()
		elif not MathChallengeManager.is_active():
			pause()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("restart") and get_tree().paused and levels.current:
		start(levels.index)
