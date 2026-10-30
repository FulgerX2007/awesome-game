extends Node
## Тяни штифт on Godot: screens, input, progress, sound and the flow of a level. The physics and rules
## are world.gd, the picture board.gd. Laid out like web/pins (index.html + style.css): a header, the HUD,
## the 2:3 board fitted whole, and the menu, level select and result as overlays over the board.

const World := preload("res://scripts/world.gd")
const Board := preload("res://scripts/board.gd")
const PROGRESS_KEY := "pins-godot.progress"  # the levels behave differently from /pins/, so their own stars
const SOUND_KEY := "pins-godot.audio"

const BG := Color("#1b1626")
const BG2 := Color("#2a2238")
const PANEL := Color("#2c2440")
const PANEL2 := Color("#372d50")
const LINE := Color("#4b3f68")
const FG := Color("#f4eee2")
const DIM := Color("#b8aecb")
const ACCENT := Color("#ffb547")
const GOOD := Color("#7ad37a")
const BAD := Color("#ff6a55")

const INSTANT := {lava = "Лава добралась до героя", gas = "Газ отравил героя", blast = "Героя задело взрывом", enemy = "Враг добрался до героя"}
const REASONS := {lava = "Лава преградила путь к выходу", gas = "Газ преградил путь к выходу", nogold = "Золота не хватило"}

var data: Dictionary
var plans: Dictionary
var levels: Array
var progress := {}                  # "0-based level" -> stars
var level := 0
var world: PinsWorld
var board: PinsBoard
var phase := "menu"                 # menu | play | walk | lose | end
var phase_t := 0.0
var outcome := {}
var speed := 1
var sound_on := true
var view := Vector2(390, 700)
var _press := {}                    # the gesture: {id, at (world), moved}
var _sounds := {}
var _players: Array[AudioStreamPlayer] = []
var _last_sound := {}

# UI
var ui: Control
var font: FontVariation
var font_bold: FontVariation
var stage: Control                  # where the board is fitted
var top_title: Label
var btn_lang: Button
var btn_home: Button
var hud: HBoxContainer
var hud_level: Label
var hud_gold: Label
var btn_hint: Button
var btn_speed: Button
var btn_sound: Button
var btn_restart: Button
var btn_levels: Button
var tip: Label
var scr_menu: Control
var btn_play: Button
var btn_sound_menu: Button
var scr_levels: Control
var levels_grid: VBoxContainer
var levels_stars: Label
var scr_result: Control
var res_title: Label
var res_reason: Label
var res_stars: Label
var res_lines: Label
var btn_next: Button


func _ready() -> void:
	data = JSON.parse_string(FileAccess.get_file_as_string("res://data/levels.json"))
	plans = JSON.parse_string(FileAccess.get_file_as_string("res://data/plans.json"))
	levels = data.LEVELS
	TranslationServer.set_locale(PinsStore.detect_lang())
	_load_progress()
	sound_on = PinsStore.get_item(SOUND_KEY) != "0"
	for n in ["pin", "gurgle", "bubble", "hiss", "sizzle", "burn", "boom", "poof", "choke", "hint", "coin", "win", "lose"]:
		_sounds[n] = load("res://assets/sounds/%s.wav" % n)
	for i in 8:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)

	# Bloom for the lava and the blasts.
	get_viewport().use_hdr_2d = true
	var env := Environment.new()
	env.background_mode = Environment.BG_CANVAS
	env.glow_enabled = true
	env.glow_intensity = 0.7
	env.glow_hdr_threshold = 0.95
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	for i in 7:
		env.set_glow_level(i, i in [1, 2, 3])
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	board = Board.new()
	board.reduce_motion = PinsStore.prefers_reduced_motion()
	board.finished_walk.connect(_finish)
	board.coin_landed.connect(func(_pos): _gold_pop())
	board.coin_taken.connect(func(_pos): sfx("coin", 0.05))
	add_child(board)
	_build_ui()
	get_window().size_changed.connect(_resize)
	_resize()
	_load_level(_first_unfinished())
	_show("menu")
	_check_home()


# ───────────── Layout ─────────────
func _resize() -> void:
	var win := get_window()
	var ratio := maxf(1.0, PinsStore.pixel_ratio())
	win.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
	win.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_EXPAND
	win.content_scale_size = Vector2i(maxi(1, int(win.size.x / ratio)), maxi(1, int(win.size.y / ratio)))
	view = Vector2(win.content_scale_size)
	# On a narrow screen "Заново" and "Уровни" become icons, like in web/pins.
	var narrow := view.x < 520
	btn_restart.text = "↻" if narrow else "Заново"
	btn_levels.text = "☰" if narrow else "Уровни"
	btn_restart.tooltip_text = tr("Заново") if narrow else ""
	btn_levels.tooltip_text = tr("Уровни") if narrow else ""
	top_title.add_theme_font_size_override("font_size", 22 if narrow else 26)
	_fit_board.call_deferred()


## The 2:3 board fitted whole into the stage, centred.
func _fit_board() -> void:
	var r := stage.get_global_rect()
	var bw := World.W * World.CELL
	var bh := World.H * World.CELL
	var k := minf(r.size.x / bw, r.size.y / bh)
	board.scale = Vector2.ONE * k
	# centred across, at the top of the stage (right under the HUD, like web/pins on a phone)
	board.position = r.position + Vector2((r.size.x - bw * k) / 2, minf((r.size.y - bh * k) / 2, 4.0))
	tip.position = Vector2(r.position.x, board.position.y + bh * k - 34)
	tip.size.x = r.size.x


# ───────────── Progress ─────────────
func _load_progress() -> void:
	var p = JSON.parse_string(PinsStore.get_item(PROGRESS_KEY)) if PinsStore.get_item(PROGRESS_KEY) != "" else null
	progress = {}
	if p is Dictionary and p.get("v") == 1 and p.get("stars") is Dictionary:
		for k in p.stars:
			var v = p.stars[k]
			if str(k).is_valid_int() and (v is float or v is int) and int(v) >= 1 and int(v) <= 3:
				progress[str(int(k))] = int(v)


func _save_progress() -> void:
	PinsStore.set_item(PROGRESS_KEY, JSON.stringify({v = 1, stars = progress}))


func stars_of(i: int) -> int:
	return progress.get(str(i), 0)


func _first_unfinished() -> int:
	for i in levels.size():
		if not stars_of(i):
			return i
	return levels.size() - 1


## A level is open when it is finished or none before it is left unfinished.
func unlocked(i: int) -> bool:
	if stars_of(i) > 0:
		return true
	for j in i:
		if not stars_of(j):
			return false
	return true


# ───────────── Sound ─────────────
func sfx(name: String, gap := 0.06) -> void:
	if not sound_on or not _sounds.has(name):
		return
	var now := Time.get_ticks_msec() / 1000.0
	if now - _last_sound.get(name, -10.0) < gap:
		return
	_last_sound[name] = now
	for p in _players:
		if not p.playing:
			p.stream = _sounds[name]
			p.pitch_scale = randf_range(0.95, 1.05)
			p.play()
			return


# ───────────── Level flow ─────────────
func _load_level(i: int) -> void:
	level = clampi(i, 0, levels.size() - 1)
	if world:
		world.queue_free()
	Engine.time_scale = 1.0
	Engine.physics_ticks_per_second = 60
	speed = 1
	# The physics lives outside the board: the board is scaled to the screen, and Godot scales static
	# shapes but not rigid bodies, which would open gaps between them. The board only draws.
	world = World.new()
	world.visible = false
	add_child(world)
	world.build(levels[level])
	world.reacted.connect(_on_reacted)
	world.pulled.connect(func(_id): sfx("pin"))
	board.show_level(world, level + 1)
	outcome = {}
	phase_t = 0.0
	tip.text = tr(data.TIPS.get(str(level), ""))
	tip.visible = tip.text != ""
	_render_hud()


func start_level(i: int) -> void:
	_load_level(i)
	phase = "play"
	_show("play")


func _on_reacted(kind: String, _pos: Vector2) -> void:
	match kind:
		"steam": sfx("hiss", 0.3)
		"sizzle": sfx("sizzle", 0.22)
		"poof": sfx("poof", 0.35)
		"blast":
			sfx("boom", 0.12)
			_shake(7.0)
		"kill_lava", "kill_blast": sfx("burn", 0.2)
		"kill_gas": sfx("choke", 0.3)


var _shake_left := 0.0
var _shake_amp := 0.0


func _shake(amp: float) -> void:
	if board.reduce_motion:
		return
	_shake_amp = amp
	_shake_left = 0.5


func pull(id: int) -> void:
	if phase != "play" or world == null or not world.pull(id):
		return
	tip.visible = false
	board.hint_id = -1


func _process(delta: float) -> void:
	if world == null:
		return
	phase_t += delta
	if _shake_left > 0:
		_shake_left -= delta
		board.position += Vector2(randf_range(-1, 1), randf_range(-1, 1)) * _shake_amp * (_shake_left / 0.5) * 0.3
		if _shake_left <= 0:
			_fit_board()
	if phase == "play":
		var gold := world.gold_in_room()
		var st := world.status()
		if st.status == "won":
			outcome = {won = true, stars = world.stars(), gold = gold}
			_record_win(outcome.stars)
			sfx("win")
			board.celebrate(Vector2(world.hero.rect.get_center() * World.CELL))
			world.release_hero()
			_set_phase("walk")
		elif st.status == "lost":
			outcome = {won = false, reason = st.reason, gold = gold}
			sfx("lose")
			_set_phase("lose")
		_render_hud()
	elif phase == "lose" and phase_t > 1.4:
		_finish()


func _set_phase(p: String) -> void:
	phase = p
	phase_t = 0.0
	board.phase = "walk" if p == "walk" else ("lose" if p == "lose" else board.phase)
	board.phase_t = 0.0
	Engine.time_scale = 1.0
	Engine.physics_ticks_per_second = 60
	speed = 1


func _finish() -> void:
	if phase == "end":
		return
	phase = "end"
	board.phase = "end"
	_show_result()


func _record_win(stars: int) -> void:
	if stars > stars_of(level):
		progress[str(level)] = stars
		_save_progress()


## Fast-forward: the physics runs twice as often, each step the same size, so nothing behaves differently.
func toggle_speed() -> void:
	if phase != "play":
		return
	speed = 2 if speed == 1 else 1
	Engine.physics_ticks_per_second = 60 * speed
	Engine.time_scale = speed
	Engine.max_physics_steps_per_frame = 16
	_render_hud()


func show_hint() -> void:
	if phase != "play":
		return
	var plan: Array = plans.get(str(level + 1), [])
	for id in plan:
		if world.pins.has(int(id)) and not world.pins[int(id)].pulled:
			board.hint_id = int(id)
			sfx("hint")
			return
	tip.text = tr("Всё получится, просто подожди") if world.pins_left() == 0 else tr("Так уже не выйти. Начни заново")
	tip.visible = true


# ───────────── Input ─────────────
func _to_world(screen: Vector2) -> Vector2:
	return (screen - board.position) / board.scale.x


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if scr_levels.visible and event.keycode == KEY_ESCAPE:
			_show("play" if world and phase != "menu" else "menu")
			return
		if phase == "play" and scr_menu.visible == false:
			if event.keycode >= KEY_1 and event.keycode <= KEY_5:
				pull(event.keycode - KEY_0)
			elif event.keycode == KEY_R:
				start_level(level)
			elif event.keycode == KEY_H:
				show_hint()
			elif event.keycode == KEY_F:
				toggle_speed()
		elif scr_menu.visible and event.keycode in [KEY_ENTER, KEY_KP_ENTER]:
			start_level(_first_unfinished())
		elif scr_result.visible and event.keycode in [KEY_ENTER, KEY_KP_ENTER, KEY_SPACE]:
			start_level(level + 1 if outcome.get("won", false) and level + 1 < levels.size() else level)
		return
	if phase != "play" or scr_menu.visible or scr_levels.visible:
		return
	var pos := Vector2.ZERO
	var pressed := false
	var released := false
	var moved := false
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		pos = event.position
		pressed = event.pressed
		released = not event.pressed
	elif event is InputEventMouseMotion:
		pos = event.position
		moved = true
	else:
		return
	var w := _to_world(pos)
	if pressed:
		var id := board.pin_at(w)
		if id >= 0:
			_press = {id = id, at = w}
			board.drag_id = id
			board.drag_off = 0.0
	elif moved and _press:
		var d: Dictionary = world.pins[_press.id].def
		var dir := Vector2.LEFT if d.handle == "left" else (Vector2.RIGHT if d.handle == "right" else Vector2.UP)
		var along: float = (w - _press.at).dot(dir) / World.CELL
		board.drag_off = clampf(along * 0.6, 0.0, 1.6)
		if along >= 2.0:
			var id: int = _press.id
			_press = {}
			board.drag_id = -1
			pull(id)
	elif released and _press:
		var id: int = _press.id
		var far: float = (w - _press.at).length() / World.CELL
		_press = {}
		board.drag_id = -1
		board.drag_off = 0.0
		if far <= 1.0:
			pull(id)


# ───────────── UI ─────────────
func _build_ui() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 5
	add_child(layer)
	var back := CanvasLayer.new()
	back.layer = -20
	add_child(back)
	var bg := ColorRect.new()
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.color = BG
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	back.add_child(bg)
	var golos: FontFile = load("res://assets/fonts/GolosText.ttf")
	# Golos has no stars or notes; a tiny cut of DejaVu Sans fills in ★ ☆ ♪ ● × (the web has no system fonts)
	golos.fallbacks = [load("res://assets/fonts/Symbols.ttf")]
	var wght := TextServerManager.get_primary_interface().name_to_tag("wght")
	font = FontVariation.new()
	font.base_font = golos
	font.variation_opentype = {wght: 450}
	font_bold = FontVariation.new()
	font_bold.base_font = golos
	font_bold.variation_opentype = {wght: 800}

	ui = MarginContainer.new()
	ui.set_anchors_preset(Control.PRESET_FULL_RECT)
	ui.theme = _theme()
	ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in ["left", "right"]:
		ui.add_theme_constant_override("margin_" + side, 10)
	for side in ["top", "bottom"]:
		ui.add_theme_constant_override("margin_" + side, 6)
	layer.add_child(ui)
	var center := HBoxContainer.new()
	center.alignment = BoxContainer.ALIGNMENT_CENTER
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(center)
	var col := VBoxContainer.new()
	col.custom_minimum_size.x = 0
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_theme_constant_override("separation", 6)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	center.add_child(col)

	var top := HBoxContainer.new()
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(top)
	top_title = _label("Тяни штифт", 26, ACCENT, font_bold)
	top_title.add_theme_color_override("font_shadow_color", Color.BLACK)
	top_title.add_theme_constant_override("shadow_offset_y", 2)
	top_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(top_title)
	btn_home = _chip("← Игры")
	btn_home.visible = false
	btn_home.pressed.connect(func(): JavaScriptBridge.eval("location.href = new URL('../', location.href).href"))
	top.add_child(btn_home)
	btn_lang = _chip("")
	btn_lang.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	btn_lang.pressed.connect(_switch_lang)
	top.add_child(btn_lang)

	hud = HBoxContainer.new()
	hud.add_theme_constant_override("separation", 6)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(hud)
	hud_level = _label("", 15, FG, font_bold, false)
	hud.add_child(hud_level)
	hud_gold = _label("", 15, ACCENT, font_bold, false)
	hud.add_child(hud_gold)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	spacer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(spacer)
	btn_hint = _chip("?")
	btn_hint.tooltip_text = "Подсказка (H)"
	btn_hint.pressed.connect(show_hint)
	hud.add_child(btn_hint)
	btn_speed = _chip("×2")
	btn_speed.tooltip_text = "Ускорить (F)"
	btn_speed.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	btn_speed.pressed.connect(toggle_speed)
	hud.add_child(btn_speed)
	btn_restart = _chip("Заново")
	btn_restart.pressed.connect(func(): start_level(level))
	hud.add_child(btn_restart)
	btn_levels = _chip("Уровни")
	btn_levels.pressed.connect(func(): _show("levels"))
	hud.add_child(btn_levels)
	var b: Button
	btn_sound = _chip("")
	btn_sound.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	btn_sound.pressed.connect(_toggle_sound)
	hud.add_child(btn_sound)

	stage = Control.new()
	stage.size_flags_vertical = Control.SIZE_EXPAND_FILL
	stage.mouse_filter = Control.MOUSE_FILTER_IGNORE
	stage.resized.connect(_fit_board)
	col.add_child(stage)

	tip = _label("", 15, FG, font_bold, true)
	tip.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tip.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	tip.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	tip.add_theme_constant_override("outline_size", 6)
	tip.theme = ui.theme
	layer.add_child(tip)

	scr_menu = _screen(layer)
	var p := _panel(scr_menu, 420)
	p.add_child(_label("Тяни штифт", 34, ACCENT, font_bold))
	var lead := _label("Вытаскивай штифты в нужном порядке. Золото должно упасть к герою, а лава и враги не должны до него добраться.", 16, FG)
	lead.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	p.add_child(lead)
	var phys := _label("Вода, лава, газ и золото здесь — настоящая физика: всё течёт, плещется и пересыпается.", 14, DIM)
	phys.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	p.add_child(phys)
	btn_play = _button("Играть", true)
	btn_play.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	btn_play.pressed.connect(func(): start_level(_first_unfinished()))
	p.add_child(btn_play)
	b = _button("Уровни")
	b.pressed.connect(func(): _show("levels"))
	p.add_child(b)
	btn_sound_menu = _button("")
	btn_sound_menu.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	btn_sound_menu.pressed.connect(_toggle_sound)
	p.add_child(btn_sound_menu)
	p.add_child(_label("Как играть", 15, ACCENT, font_bold))
	for t in ["Потяни штифт за кольцо в сторону кольца или просто нажми на него.",
			"Золото падает и тонет в воде. Лава сжигает золото и врагов.",
			"Вода и лава вместе превращаются в камень.",
			"Ядовитый газ поднимается вверх, душит врагов и героя, а лава его сжигает.",
			"Бочка с порохом взрывается от лавы: взрыв пробивает камень и задевает всех рядом.",
			"Победа, когда в комнате героя достаточно золота и путь к выходу свободен.",
			"★ за победу, ещё ★ если все враги повержены и ★ за полтора запаса золота.",
			"Клавиши: 1–5 штифты, R заново, H подсказка, F ускорение."]:
		var l := _label(t, 13, DIM)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		p.add_child(l)

	scr_levels = _screen(layer)
	p = _panel(scr_levels, 560)
	var head := HBoxContainer.new()
	p.add_child(head)
	var lt := _label("Уровни", 26, ACCENT, font_bold)
	lt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(lt)
	levels_stars = _label("", 14, DIM, null, false)
	head.add_child(levels_stars)
	b = _chip("Назад")
	b.pressed.connect(func(): _show("play" if phase != "menu" else "menu"))
	head.add_child(b)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.custom_minimum_size.y = 360
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	p.add_child(scroll)
	levels_grid = VBoxContainer.new()
	levels_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(levels_grid)

	scr_result = _screen(layer)
	p = _panel(scr_result, 360)
	res_title = _label("", 28, ACCENT, font_bold, false)
	res_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	p.add_child(res_title)
	res_stars = _label("", 40, ACCENT, font_bold, false)
	res_stars.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	p.add_child(res_stars)
	res_reason = _label("", 16, BAD, null, false)
	res_reason.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	res_reason.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	p.add_child(res_reason)
	res_lines = _label("", 14, DIM, null, false)
	res_lines.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	res_lines.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	p.add_child(res_lines)
	btn_next = _button("Дальше", true)
	btn_next.pressed.connect(func(): start_level(level + 1))
	p.add_child(btn_next)
	b = _button("Ещё раз")
	b.pressed.connect(func(): start_level(level))
	p.add_child(b)
	b = _button("Уровни")
	b.pressed.connect(func(): _show("levels"))
	p.add_child(b)
	_lang_texts()


func _theme() -> Theme:
	var t := Theme.new()
	t.default_font = font
	t.default_font_size = 15
	t.set_color("font_color", "Label", FG)
	var chip := _box(PANEL, 10, LINE, Vector4(10, 6, 10, 6))
	t.set_stylebox("normal", "Button", chip)
	t.set_stylebox("hover", "Button", _box(PANEL2, 10, LINE, Vector4(10, 6, 10, 6)))
	t.set_stylebox("pressed", "Button", _box(PANEL2, 10, ACCENT, Vector4(10, 6, 10, 6)))
	t.set_stylebox("focus", "Button", _box(Color(0, 0, 0, 0), 10, ACCENT, Vector4(10, 6, 10, 6)))
	t.set_stylebox("disabled", "Button", _box(Color(PANEL, 0.5), 10, Color(LINE, 0.5), Vector4(10, 6, 10, 6)))
	for k in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		t.set_color(k, "Button", FG)
	t.set_color("font_disabled_color", "Button", Color(DIM, 0.5))
	t.set_font_size("font_size", "Button", 14)
	t.set_font("font", "Button", font_bold)
	return t


static func _box(bg: Color, radius: int, border: Color, pad: Vector4) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.set_corner_radius_all(radius)
	s.border_color = border
	s.set_border_width_all(1 if border.a > 0 else 0)
	s.content_margin_left = pad.x
	s.content_margin_top = pad.y
	s.content_margin_right = pad.z
	s.content_margin_bottom = pad.w
	s.anti_aliasing = true
	return s


func _label(text: String, size: int, color: Color, f: Font = null, translate := true) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if f:
		l.add_theme_font_override("font", f)
	l.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_ALWAYS if translate else Node.AUTO_TRANSLATE_MODE_DISABLED
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _chip(text: String) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	return b


func _button(text: String, primary := false) -> Button:
	var b := _chip(text)
	b.focus_mode = Control.FOCUS_ALL
	var pad := Vector4(18, 12, 18, 12)
	if primary:
		b.add_theme_stylebox_override("normal", _box(ACCENT, 12, Color(0, 0, 0, 0), pad))
		b.add_theme_stylebox_override("hover", _box(ACCENT.lightened(0.1), 12, Color(0, 0, 0, 0), pad))
		b.add_theme_stylebox_override("pressed", _box(Color("#c9811c"), 12, Color(0, 0, 0, 0), pad))
		for k in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
			b.add_theme_color_override(k, Color("#2a1a08"))
		b.add_theme_font_size_override("font_size", 18)
	else:
		b.add_theme_stylebox_override("normal", _box(PANEL2, 12, LINE, pad))
		b.add_theme_stylebox_override("hover", _box(PANEL2.lightened(0.08), 12, LINE, pad))
		b.add_theme_font_size_override("font_size", 15)
	return b


## An overlay over the board: a dim veil with a centred panel.
func _screen(layer: CanvasLayer) -> Control:
	var s := ColorRect.new()
	s.color = Color(BG, 0.72)
	s.set_anchors_preset(Control.PRESET_FULL_RECT)
	s.mouse_filter = Control.MOUSE_FILTER_STOP
	s.visible = false
	s.theme = ui.theme  # overlays sit on the layer, outside ui: they need the theme (and its font) too
	layer.add_child(s)
	return s


func _panel(screen: Control, width: float) -> VBoxContainer:
	var c := CenterContainer.new()
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	screen.add_child(c)
	var pc := PanelContainer.new()
	pc.add_theme_stylebox_override("panel", _box(PANEL, 16, LINE, Vector4(18, 16, 18, 18)))
	pc.custom_minimum_size.x = width
	pc.set_meta("width", width)
	c.add_child(pc)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	pc.add_child(v)
	return v


func _show(name: String) -> void:
	scr_menu.visible = name == "menu"
	scr_levels.visible = name == "levels"
	scr_result.visible = name == "result"
	hud.visible = name != "menu"
	if name == "menu":
		phase = "menu"
		btn_play.text = tr("Играть: уровень {n}").format({n = _first_unfinished() + 1}) if progress.size() else tr("Играть")
	if name == "play" and phase == "menu":
		phase = "play"
	if name == "levels":
		_render_levels()
	# panels fit narrow phones
	for scr in [scr_menu, scr_levels, scr_result]:
		var pc: PanelContainer = scr.get_child(0).get_child(0)
		pc.custom_minimum_size.x = minf(pc.get_meta("width"), view.x - 24)
	_render_hud()


func _render_hud() -> void:
	if world == null:
		return
	hud_level.text = tr("Уровень {n}").format({n = level + 1})
	hud_gold.text = "● %d/%d" % [world.gold_in_room(), world.gold_target]
	btn_speed.modulate = ACCENT if speed == 2 else Color.WHITE
	btn_sound.text = "♪" if sound_on else "×♪"
	btn_sound_menu.text = tr("Звук: вкл" if sound_on else "Звук: выкл")


func _render_levels() -> void:
	for c in levels_grid.get_children():
		c.queue_free()
	var total := 0
	for k in progress:
		total += progress[k]
	levels_stars.text = tr("Звёзд: {n} из {total}").format({n = total, total = levels.size() * 3})
	var chapters: Array = data.CHAPTERS
	for ci in chapters.size():
		var from: int = chapters[ci].from
		var to: int = chapters[ci + 1].from if ci + 1 < chapters.size() else levels.size()
		levels_grid.add_child(_label(chapters[ci].title, 16, ACCENT, font_bold))
		var grid := GridContainer.new()
		grid.columns = clampi(int((minf(view.x - 60, 520)) / 62), 4, 8)
		grid.add_theme_constant_override("h_separation", 6)
		grid.add_theme_constant_override("v_separation", 6)
		levels_grid.add_child(grid)
		for i in range(from, to):
			var b := Button.new()
			b.custom_minimum_size = Vector2(56, 52)
			b.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
			var st := stars_of(i)
			b.text = "%d\n%s" % [i + 1, "★".repeat(st) + "☆".repeat(3 - st)]
			b.disabled = not unlocked(i)
			b.tooltip_text = tr("Уровень {n} закрыт").format({n = i + 1}) if b.disabled else tr("Уровень {n}, звёзды: {s} из 3").format({n = i + 1, s = st})
			if i == level and phase != "menu":
				b.add_theme_stylebox_override("normal", _box(PANEL2, 10, ACCENT, Vector4(6, 4, 6, 4)))
			var idx := i
			b.pressed.connect(func(): start_level(idx))
			grid.add_child(b)


func _show_result() -> void:
	var o := outcome
	res_title.text = tr("Уровень пройден!" if o.won else "Неудача")
	res_title.add_theme_color_override("font_color", GOOD if o.won else BAD)
	res_stars.text = "★".repeat(o.get("stars", 0)) + "☆".repeat(3 - o.get("stars", 0)) if o.won else ""
	res_stars.visible = o.won
	var reason: String = INSTANT.get(o.get("reason", ""), REASONS.get(o.get("reason", ""), REASONS.nogold))
	res_reason.text = "" if o.won else tr(reason)
	res_reason.visible = not o.won
	var lines: Array = [tr("Золото: {n} из {target}").format({n = o.gold, target = world.gold_target})]
	if o.won:
		lines.append(tr("Все враги повержены") if world.enemies.size() and world.live_enemies() == 0 else (tr("Врагов нет") if world.enemies.is_empty() else ""))
		if o.gold * 2 >= world.gold_target * 3:
			lines.append(tr("Золота в полтора раза больше нужного"))
		if level + 1 >= levels.size() and _first_unfinished() == levels.size() - 1 and stars_of(levels.size() - 1):
			lines.append(tr("Все уровни пройдены!"))
	res_lines.text = "\n".join(lines.filter(func(l): return l != ""))
	btn_next.visible = o.won and level + 1 < levels.size()
	_show("result")
	if btn_next.visible:
		btn_next.grab_focus.call_deferred()


## The gold counter jumps a little when a coin lands in the hero's room.
var _gold_tween: Tween


func _gold_pop() -> void:
	if hud_gold == null or board.reduce_motion:
		return
	hud_gold.pivot_offset = hud_gold.size / 2
	if _gold_tween:
		_gold_tween.kill()
	_gold_tween = create_tween()
	hud_gold.scale = Vector2.ONE * 1.18
	_gold_tween.tween_property(hud_gold, "scale", Vector2.ONE, 0.18).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func _toggle_sound() -> void:
	sound_on = not sound_on
	PinsStore.set_item(SOUND_KEY, "1" if sound_on else "0")
	_render_hud()


func _lang_texts() -> void:
	var ro := TranslationServer.get_locale().begins_with("ro")
	btn_lang.text = "RU" if ro else "RO"
	if DisplayServer.get_name() != "headless":
		get_window().title = tr("Тяни штифт")
	_render_hud()


func _switch_lang() -> void:
	var next := "ru" if TranslationServer.get_locale().begins_with("ro") else "ro"
	PinsStore.set_item("lang", next)
	TranslationServer.set_locale(next)
	_lang_texts()
	tip.text = tr(data.TIPS.get(str(level), ""))
	if scr_levels.visible:
		_render_levels()
	if scr_menu.visible:
		_show("menu")


## "← Игры" only when the Go server that hosts all the games answers.
func _check_home() -> void:
	if not PinsStore.on_web():
		return
	var url = JavaScriptBridge.eval("new URL('../healthz', location.href).href", true)
	if not url is String:
		return
	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(func(result, code, _h, body):
		btn_home.visible = result == HTTPRequest.RESULT_SUCCESS and code == 200 and body.get_string_from_utf8().strip_edges() == "ok"
		req.queue_free())
	req.request(url)
