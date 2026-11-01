class_name UIManager
extends CanvasLayer
## Every 2D thing on screen: the in-level HUD, short messages, the intro card, the math dialog, the pause
## menu, the level-complete card and the menu screens. It shows what it is told and reports button presses
## as signals; the flow between screens is Main's job.

signal play_pressed
signal level_chosen(index: int)
signal resume_pressed
signal restart_pressed
signal map_pressed
signal menu_pressed
signal next_pressed
signal intro_closed
signal pause_pressed

var root: Control
var dialog: ChallengeDialog
var hud: Control
var _objective: Label
var _level_title: Label
var _stones: Label
var _gems: Label
var _toast: Label
var _toast_tween: Tween
var _boss_box: VBoxContainer
var _boss_bar: ProgressBar
var _boss_phase: Label
var _hearts: Label
var _screen: Control           # the open overlay (intro, pause, result, title, map, settings)


func _ready() -> void:
	layer = 10
	process_mode = Node.PROCESS_MODE_ALWAYS
	root = Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	apply_theme()
	ProgressManager.settings_changed.connect(apply_theme)
	_build_hud()
	dialog = ChallengeDialog.new()
	root.add_child(dialog)


func apply_theme() -> void:
	root.theme = UiTheme.make(ProgressManager.settings.get("large_text", false))


# --- HUD ------------------------------------------------------------------------------------------------------

func _build_hud() -> void:
	hud = Control.new()
	hud.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.visible = false
	root.add_child(hud)
	var left := _pill()
	left.position = Vector2(16, 14)
	hud.add_child(left)
	var lv := VBoxContainer.new()
	lv.add_theme_constant_override("separation", 0)
	left.add_child(lv)
	_level_title = UiTheme.label("", "Small", HORIZONTAL_ALIGNMENT_LEFT)
	_level_title.autowrap_mode = TextServer.AUTOWRAP_OFF
	lv.add_child(_level_title)
	_objective = UiTheme.label("", "", HORIZONTAL_ALIGNMENT_LEFT)
	_objective.autowrap_mode = TextServer.AUTOWRAP_OFF
	lv.add_child(_objective)

	var right := HBoxContainer.new()
	right.add_theme_constant_override("separation", 10)
	right.anchor_left = 1.0
	right.anchor_right = 1.0
	right.offset_right = -16
	right.offset_top = 14
	right.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	hud.add_child(right)
	var sp := _pill()
	_stones = UiTheme.label("● 0", "Big")
	_stones.add_theme_color_override("font_color", Art.STONE_COLOR.darkened(0.15))
	_stones.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	_stones.autowrap_mode = TextServer.AUTOWRAP_OFF
	sp.add_child(_stones)
	right.add_child(sp)
	var gp := _pill()
	_gems = UiTheme.label("◆ 0/3", "Big")
	_gems.add_theme_color_override("font_color", Color("#e0459b"))
	_gems.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	_gems.autowrap_mode = TextServer.AUTOWRAP_OFF
	gp.add_child(_gems)
	right.add_child(gp)
	var pause := UiTheme.button("II")
	pause.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	pause.custom_minimum_size = Vector2(70, 64)
	pause.pressed.connect(func(): pause_pressed.emit())
	right.add_child(pause)

	_toast = UiTheme.label("", "Big")
	_toast.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_toast.autowrap_mode = TextServer.AUTOWRAP_OFF
	_toast.offset_top = 110
	_toast.offset_left = -500
	_toast.offset_right = 500
	_toast.add_theme_color_override("font_color", Color.WHITE)
	_toast.add_theme_color_override("font_outline_color", Color("#1d3557"))
	_toast.add_theme_constant_override("outline_size", 12)
	_toast.modulate.a = 0.0
	hud.add_child(_toast)

	_boss_box = VBoxContainer.new()
	_boss_box.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_boss_box.offset_top = 16
	_boss_box.offset_left = -220
	_boss_box.offset_right = 220
	_boss_box.visible = false
	hud.add_child(_boss_box)
	_boss_phase = UiTheme.label("", "")
	_boss_phase.add_theme_color_override("font_color", Color.WHITE)
	_boss_phase.add_theme_color_override("font_outline_color", Color("#1d3557"))
	_boss_phase.add_theme_constant_override("outline_size", 10)
	_boss_box.add_child(_boss_phase)
	_boss_bar = ProgressBar.new()
	_boss_bar.custom_minimum_size = Vector2(440, 30)
	_boss_bar.show_percentage = false
	_boss_bar.max_value = 3
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(1, 1, 1, 0.85)
	bg.set_corner_radius_all(14)
	bg.set_border_width_all(3)
	bg.border_color = Color("#5a4b8a")
	var fill := StyleBoxFlat.new()
	fill.bg_color = Color("#9d7bff")
	fill.set_corner_radius_all(14)
	_boss_bar.add_theme_stylebox_override("background", bg)
	_boss_bar.add_theme_stylebox_override("fill", fill)
	_boss_box.add_child(_boss_bar)
	_hearts = UiTheme.label("", "Big")
	_hearts.add_theme_color_override("font_color", Color("#ff4d6d"))
	_hearts.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	_hearts.autowrap_mode = TextServer.AUTOWRAP_OFF
	_boss_box.add_child(_hearts)


func _pill() -> PanelContainer:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(1, 1, 1, 0.88)
	sb.set_corner_radius_all(18)
	sb.content_margin_left = 16
	sb.content_margin_right = 16
	sb.content_margin_top = 6
	sb.content_margin_bottom = 6
	p.add_theme_stylebox_override("panel", sb)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return p


func show_hud(level: Level) -> void:
	hud.visible = true
	_level_title.text = tr(LevelCatalog.get_level(level.level_index).title)
	set_stones(level.stones)
	set_gems(level.gems_found())
	_boss_box.visible = false
	level.stones_changed.connect(set_stones)
	level.gems_changed.connect(set_gems)
	level.objective_changed.connect(set_objective)
	level.message.connect(toast)
	set_objective(level.objective())


func hide_hud() -> void:
	hud.visible = false


func set_stones(n: int) -> void:
	_stones.text = "● %d" % n
	_bump(_stones)


func set_gems(n: int) -> void:
	_gems.text = "◆ %d/%d" % [n, ProgressManager.GEMS_PER_LEVEL]
	_bump(_gems)


func set_objective(text: String) -> void:
	_objective.text = tr(text)


func _bump(c: Control) -> void:
	c.pivot_offset = c.size / 2.0
	var tw := c.create_tween()
	tw.tween_property(c, "scale", Vector2.ONE * 1.2, 0.08)
	tw.tween_property(c, "scale", Vector2.ONE, 0.12)


## A short message in the middle of the screen that fades by itself.
func toast(text: String) -> void:
	_toast.text = tr(text)
	if _toast_tween:
		_toast_tween.kill()
	_toast_tween = create_tween()
	_toast_tween.tween_property(_toast, "modulate:a", 1.0, 0.15)
	_toast_tween.tween_interval(2.2)
	_toast_tween.tween_property(_toast, "modulate:a", 0.0, 0.4)


func show_boss(phase_text: String, progress: int, hearts: int) -> void:
	_boss_box.visible = true
	_boss_phase.text = tr(phase_text)
	_boss_bar.value = 3 - progress
	_hearts.text = "♥".repeat(hearts) + "♡".repeat(maxi(0, 3 - hearts))


# --- overlays -------------------------------------------------------------------------------------------------

## Replaces the current overlay with a new centered card (or a full screen control).
func _open(c: Control) -> void:
	close_screen()
	_screen = c
	root.add_child(c)
	root.move_child(c, root.get_child_count() - 1)
	var first := _first_button(c)
	if first:
		first.grab_focus.call_deferred()


func close_screen() -> void:
	if _screen and is_instance_valid(_screen):
		_screen.queue_free()
	_screen = null


func has_screen() -> bool:
	return _screen != null and is_instance_valid(_screen)


func _first_button(n: Node) -> Button:
	for c in n.get_children():
		if c is Button and c.visible:
			return c
		var b := _first_button(c)
		if b:
			return b
	return null


## A dimmed backdrop with a card in the middle; returns the card's VBox to fill.
func _card(dim := true) -> Array:
	var shade := ColorRect.new()
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.color = Color(0.05, 0.1, 0.2, 0.45) if dim else Color(0, 0, 0, 0)
	shade.mouse_filter = Control.MOUSE_FILTER_STOP
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.add_child(center)
	var card := PanelContainer.new()
	card.theme_type_variation = "Card"
	card.custom_minimum_size.x = 560
	center.add_child(card)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 16)
	card.add_child(v)
	card.scale = Vector2.ONE * 0.9
	card.pivot_offset = Vector2(280, 150)
	card.create_tween().tween_property(card, "scale", Vector2.ONE, 0.2).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	return [shade, v]


func show_intro(level: Level) -> void:
	var c := _card()
	var v: VBoxContainer = c[1]
	var info: Dictionary = LevelCatalog.get_level(level.level_index)
	v.add_child(UiTheme.label(tr("Level %d") % (level.level_index + 1), "Small"))
	v.add_child(UiTheme.label(info.title, "Title"))
	for line in level.intro:
		v.add_child(UiTheme.label(line, "Big"))
	var go := UiTheme.button("Let's go!", "PrimaryButton")
	go.pressed.connect(func():
		close_screen()
		intro_closed.emit())
	v.add_child(go)
	_open(c[0])


func show_pause() -> void:
	var c := _card()
	var v: VBoxContainer = c[1]
	v.add_child(UiTheme.label("Paused", "Title"))
	var b1 := UiTheme.button("Keep playing", "PrimaryButton")
	b1.pressed.connect(func(): resume_pressed.emit())
	v.add_child(b1)
	var b2 := UiTheme.button("Start the level again")
	b2.pressed.connect(func(): restart_pressed.emit())
	v.add_child(b2)
	var b3 := UiTheme.button("Island map")
	b3.pressed.connect(func(): map_pressed.emit())
	v.add_child(b3)
	var b4 := UiTheme.button("Settings")
	b4.pressed.connect(func(): show_settings(true))
	v.add_child(b4)
	_open(c[0])


func show_result(level: Level) -> void:
	var c := _card()
	var v: VBoxContainer = c[1]
	var last := level.level_index >= LevelCatalog.count() - 1
	v.add_child(UiTheme.label("You saved the island!" if last else "Level complete!", "Title"))
	var star := UiTheme.label("★", "Title")
	star.add_theme_font_size_override("font_size", 110)
	star.add_theme_color_override("font_color", Color("#ffc53d"))
	star.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	v.add_child(star)
	var g := level.gems_found()
	v.add_child(UiTheme.label(tr("Magic gems found: %d of %d") % [g, ProgressManager.GEMS_PER_LEVEL], "Big"))
	if g < ProgressManager.GEMS_PER_LEVEL:
		v.add_child(UiTheme.label("Some gems are still hiding. You can come back for them!", "Small"))
	if not last:
		var n := UiTheme.button("Next level", "PrimaryButton")
		n.pressed.connect(func(): next_pressed.emit())
		v.add_child(n)
	var m := UiTheme.button("Island map", "" if not last else "PrimaryButton")
	m.pressed.connect(func(): map_pressed.emit())
	v.add_child(m)
	_open(c[0])


# --- menu screens ---------------------------------------------------------------------------------------------

func show_title() -> void:
	hide_hud()
	var c := _card(false)
	var v: VBoxContainer = c[1]
	var t := UiTheme.label("MathMagic", "Title")
	t.add_theme_font_size_override("font_size", 84)
	t.add_theme_color_override("font_color", Color("#6a4cff"))
	v.add_child(t)
	v.add_child(UiTheme.label("Island of Addition", "Big"))
	var play := UiTheme.button("Play", "PrimaryButton")
	play.custom_minimum_size.y = 90
	play.pressed.connect(func(): play_pressed.emit())
	v.add_child(play)
	var levels := UiTheme.button("Island map")
	levels.pressed.connect(func(): map_pressed.emit())
	v.add_child(levels)
	var settings := UiTheme.button("Settings")
	settings.pressed.connect(func(): show_settings(false))
	v.add_child(settings)
	var gems := ProgressManager.total_gems()
	if gems > 0:
		var gl := UiTheme.label(tr("Magic gems: %d") % gems, "Small")
		v.add_child(gl)
	_open(c[0])


func show_map() -> void:
	hide_hud()
	var c := _card(false)
	var v: VBoxContainer = c[1]
	v.get_parent().custom_minimum_size.x = 760
	v.add_child(UiTheme.label("Island map", "Title"))
	var grid := GridContainer.new()
	grid.columns = 1
	grid.add_theme_constant_override("v_separation", 10)
	v.add_child(grid)
	for i in LevelCatalog.count():
		var info: Dictionary = LevelCatalog.get_level(i)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		var open := ProgressManager.is_unlocked(i)
		var b := UiTheme.button("", "PrimaryButton" if open and not ProgressManager.is_completed(i) else "")
		b.text = "%d. %s" % [i + 1, tr(info.title) if open else tr("Locked")]
		b.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		b.disabled = not open
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		var idx := i
		b.pressed.connect(func(): level_chosen.emit(idx))
		row.add_child(b)
		var status := UiTheme.label("", "Big")
		status.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		status.custom_minimum_size.x = 170
		if open:
			status.text = ("★ " if ProgressManager.is_completed(i) else "☆ ") + "◆ %d/3" % ProgressManager.gem_count(info.id)
		status.add_theme_color_override("font_color", Color("#e0459b"))
		row.add_child(status)
		grid.add_child(row)
	var back := UiTheme.button("Back")
	back.pressed.connect(func(): menu_pressed.emit())
	v.add_child(back)
	_open(c[0])


## Settings as a card. From the pause menu, Back returns there.
func show_settings(from_pause: bool) -> void:
	var c := _card()
	var v: VBoxContainer = c[1]
	v.add_child(UiTheme.label("Settings", "Title"))
	for item in [["Sounds", "sfx"], ["Music", "music"]]:
		var row := HBoxContainer.new()
		var l := UiTheme.label(item[0], "", HORIZONTAL_ALIGNMENT_LEFT)
		l.custom_minimum_size.x = 200
		row.add_child(l)
		var s := HSlider.new()
		s.min_value = 0.0
		s.max_value = 1.0
		s.step = 0.1
		s.value = ProgressManager.settings[item[1]]
		s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		s.custom_minimum_size.y = 40
		var key: String = item[1]
		s.value_changed.connect(func(val): ProgressManager.set_setting(key, val))
		s.drag_ended.connect(func(_c): Sfx.play("click"))
		row.add_child(s)
		v.add_child(row)
	var big := CheckButton.new()
	big.text = "Big text"
	big.button_pressed = ProgressManager.settings.large_text
	big.toggled.connect(func(on): ProgressManager.set_setting("large_text", on))
	v.add_child(big)
	var langs := HBoxContainer.new()
	langs.alignment = BoxContainer.ALIGNMENT_CENTER
	langs.add_theme_constant_override("separation", 10)
	for code in [["en", "English"], ["ru", "Русский"], ["ro", "Română"]]:
		var b := UiTheme.button(code[1], "PrimaryButton" if TranslationServer.get_locale().begins_with(code[0]) else "")
		b.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		var lc: String = code[0]
		b.pressed.connect(func():
			ProgressManager.set_setting("lang", lc)
			TranslationServer.set_locale(lc)
			show_settings(from_pause))
		langs.add_child(b)
	v.add_child(langs)
	var reset := UiTheme.button("Start over")
	reset.pressed.connect(func(): _confirm_reset(from_pause))
	reset.visible = not from_pause
	v.add_child(reset)
	var back := UiTheme.button("Back", "PrimaryButton")
	back.pressed.connect(func(): show_pause() if from_pause else show_title())
	v.add_child(back)
	_open(c[0])


func _confirm_reset(from_pause: bool) -> void:
	var c := _card()
	var v: VBoxContainer = c[1]
	v.add_child(UiTheme.label("Start over? All levels and gems will be forgotten.", "Big"))
	var yes := UiTheme.button("Yes, start over")
	yes.pressed.connect(func():
		SaveManager.reset_progress()
		show_title())
	v.add_child(yes)
	var no := UiTheme.button("No, keep my progress", "PrimaryButton")
	no.pressed.connect(func(): show_settings(from_pause))
	v.add_child(no)
	_open(c[0])
