extends Control
## Ржавый рассвет on Godot: the screen. The scrapyard (a 3D SubViewport) on the left with the three
## manual actions and the chronicle under it, the brigade, the workshop and the ark on the right,
## resources along the top. On tall screens everything stacks and scrolls.
## Nothing here changes the game state directly: buttons and keys call the Game autoload, and every
## panel refreshes itself from Game's signals.

const LANDSCAPE := Vector2i(1280, 760)
const PORTRAIT := Vector2i(720, 1180)

var world: ScrapyardWorld
var sfx: Sfx
var modal: Modal
var toasts: ToastLayer

var _scroll: ScrollContainer
var _root: VBoxContainer
var _body: BoxContainer
var _left: VBoxContainer
var _side_scroll: ScrollContainer
var _scene_box: PanelContainer
var _svc: SubViewportContainer
var _vp: SubViewport
var _day: Label
var _chips := {}
var _power: Label
var _act := {}
var _pause_btn: Button
var _pause_overlay: Label
var _portrait := false
var _key_times := {}


func _ready() -> void:
	TranslationServer.set_locale(Settings.detect_lang())
	theme = UiTheme.get_theme()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = UiTheme.BG
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	_build()
	sfx = Sfx.new()
	add_child(sfx)
	Game.ticked.connect(_refresh)
	Game.changed.connect(_refresh)
	Game.state_replaced.connect(_refresh)
	Game.offline_report.connect(_on_offline)
	Game.paused_changed.connect(func(p): _pause_overlay.visible = p; _refresh())
	Game.event.connect(_on_event)
	world.launch_finished.connect(_on_launch_finished)
	get_viewport().size_changed.connect(_layout)
	Game.boot()
	_layout()
	_refresh()


func _build() -> void:
	_scroll = ScrollContainer.new()
	_scroll.set_anchors_preset(Control.PRESET_FULL_RECT)
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(_scroll)
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.size_flags_vertical = Control.SIZE_EXPAND_FILL
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 16 if side in ["left", "right"] else 12)
	_scroll.add_child(margin)
	_root = VBoxContainer.new()
	_root.add_theme_constant_override("separation", 12)
	margin.add_child(_root)
	# header
	var header := HFlowContainer.new()
	header.add_theme_constant_override("h_separation", 10)
	header.add_theme_constant_override("v_separation", 8)
	_root.add_child(header)
	var brand := HBoxContainer.new()
	brand.add_theme_constant_override("separation", 12)
	header.add_child(brand)
	var title := UiTheme.lbl("Ржавый рассвет", 30, UiTheme.RUST, UiTheme.title)
	title.add_theme_color_override("font_shadow_color", UiTheme.RUST_DEEP)
	title.add_theme_constant_override("shadow_offset_y", 2)
	title.add_theme_constant_override("shadow_offset_x", 0)
	brand.add_child(title)
	_day = UiTheme.lbl("", 15, UiTheme.DIM)
	_day.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	brand.add_child(_day)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(spacer)
	for id in ["scrap", "parts", "cores", "robots", "blueprints"]:
		var c: ResourceChip = preload("res://scenes/ui/resource_chip.tscn").instantiate()
		c.setup(id)
		header.add_child(c)
		_chips[id] = c
	var pw := PanelContainer.new()
	pw.add_theme_stylebox_override("panel", UiTheme.box(UiTheme.PANEL, UiTheme.LINE, 999, 12))
	_power = UiTheme.lbl("", 13, UiTheme.LAMP)
	pw.add_child(_power)
	pw.tooltip_text = tr("Мощность автоматики: энергосистема ковчега и стабилизатор. При перебое — вдвое меньше.")
	header.add_child(pw)
	_chips.power = pw
	# body
	_body = BoxContainer.new()
	_body.add_theme_constant_override("separation", 16)
	_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_root.add_child(_body)
	_left = VBoxContainer.new()
	_left.add_theme_constant_override("separation", 12)
	_left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_left.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_left.size_flags_stretch_ratio = 1.75
	_body.add_child(_left)
	_scene_box = PanelContainer.new()
	_scene_box.add_theme_stylebox_override("panel", UiTheme.box(Color("120e1b"), UiTheme.LINE, 14, 0))
	_scene_box.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scene_box.clip_contents = true
	_left.add_child(_scene_box)
	_svc = SubViewportContainer.new()
	_svc.stretch = true
	_svc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_svc.mouse_filter = Control.MOUSE_FILTER_STOP
	_scene_box.add_child(_svc)
	_vp = SubViewport.new()
	_vp.physics_object_picking = true
	_vp.msaa_3d = Viewport.MSAA_2X
	_vp.handle_input_locally = true
	_svc.add_child(_vp)
	world = preload("res://scenes/world/scrapyard_world.tscn").instantiate()
	_vp.add_child(world)
	_svc.resized.connect(func(): world.fit_camera(_svc.size))
	var overlay := MarginContainer.new()
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in ["left", "right", "top", "bottom"]:
		overlay.add_theme_constant_override("margin_" + side, 12)
	_scene_box.add_child(overlay)
	toasts = preload("res://scenes/ui/toast_layer.tscn").instantiate()
	toasts.size_flags_horizontal = Control.SIZE_SHRINK_END
	toasts.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	overlay.add_child(toasts)
	_pause_btn = Button.new()
	_pause_btn.focus_mode = Control.FOCUS_NONE
	_pause_btn.tooltip_text = tr("Пауза (Пробел)")
	_pause_btn.custom_minimum_size = Vector2(40, 34)
	_pause_btn.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_pause_btn.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_pause_btn.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	_pause_btn.pressed.connect(func(): Game.set_paused(not Game.paused))
	overlay.add_child(_pause_btn)
	_pause_overlay = UiTheme.lbl("Пауза", 40, UiTheme.FG, UiTheme.title)
	_pause_overlay.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_pause_overlay.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_pause_overlay.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	_pause_overlay.add_theme_constant_override("outline_size", 10)
	_pause_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_pause_overlay.visible = false
	overlay.add_child(_pause_overlay)
	var hint := UiTheme.lbl("Кликай по светящимся местам: кучам, столу, станции", 12, Color(UiTheme.DIM, 0.8))
	hint.size_flags_vertical = Control.SIZE_SHRINK_END
	hint.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(hint)
	# actions
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 10)
	_left.add_child(actions)
	for a in [["dig", "Копать", "Q", UiTheme.RUST], ["sort", "Разобрать", "W", UiTheme.VERDIGRIS], ["repair", "Чинить робота", "E", UiTheme.LAMP]]:
		var b: ActionButton = preload("res://scenes/ui/action_button.tscn").instantiate()
		b.setup(a[1], a[2], a[3])
		actions.add_child(b)
		_act[a[0]] = b
	_act.dig.pressed.connect(func(): Game.dig())
	_act.sort.pressed.connect(func(): Game.sort())
	_act.repair.pressed.connect(func(): Game.repair())
	var log_panel := preload("res://scenes/ui/log_panel.tscn").instantiate()
	log_panel.custom_minimum_size.y = 118
	_left.add_child(log_panel)
	# side panels
	_side_scroll = ScrollContainer.new()
	_side_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_side_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_side_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_side_scroll.custom_minimum_size.x = 380
	_body.add_child(_side_scroll)
	var side := VBoxContainer.new()
	side.add_theme_constant_override("separation", 12)
	side.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_side_scroll.add_child(side)
	side.add_child(preload("res://scenes/ui/worker_panel.tscn").instantiate())
	side.add_child(preload("res://scenes/ui/upgrade_panel.tscn").instantiate())
	var ark: ReconstructionPanel = preload("res://scenes/ui/reconstruction_panel.tscn").instantiate()
	ark.new_dawn_pressed.connect(_ask_new_dawn)
	side.add_child(ark)
	side.add_child(preload("res://scenes/ui/achievements_panel.tscn").instantiate())
	var save: SavePanel = preload("res://scenes/ui/save_panel.tscn").instantiate()
	save.sound_toggled.connect(func(on): sfx.set_enabled(on))
	save.language_changed.connect(_on_language)
	side.add_child(save)
	modal = preload("res://scenes/ui/modal.tscn").instantiate()
	add_child(modal)


func _layout() -> void:
	var win := get_window()
	var real := Vector2(win.size)
	var portrait := real.y > real.x * 1.05
	if portrait != _portrait or win.content_scale_size == Vector2i.ZERO:
		_portrait = portrait
		win.content_scale_size = PORTRAIT if portrait else LANDSCAPE
	_body.vertical = _portrait
	var view := get_viewport_rect().size
	if _portrait:
		_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
		_side_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		_side_scroll.custom_minimum_size.x = 0
		_root.custom_minimum_size.y = 0
		_scene_box.custom_minimum_size.y = maxf(360.0, view.y * 0.42)
	else:
		_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		_side_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
		_side_scroll.custom_minimum_size.x = clampf(view.x * 0.3, 360.0, 460.0)
		_root.custom_minimum_size.y = view.y - 24.0
		_scene_box.custom_minimum_size.y = 260
	world.fit_camera(_svc.size)


func _refresh() -> void:
	var s := Game.s
	var d := ProductionManager.derived(s)
	var r := ProductionManager.rates(s)
	_day.text = tr("День {n}").format({n = s.day()}) + (tr(" · Рассвет №{n}").format({n = s.runs + 1}) if s.runs > 0 else "")
	_chips.scrap.show_value(Fmt.num(s.scrap), Fmt.rate(r.scrap), r.scrap < -0.05)
	_chips.parts.show_value(Fmt.num(s.parts), Fmt.rate(r.parts))
	_chips.cores.visible = s.stats.cores >= 1.0 or s.cores >= 1.0
	_chips.cores.show_value(Fmt.num(s.cores), tr("+{v}/мин").format({v = Fmt.dec(r.cores * 60.0) if r.cores * 60.0 < 10.0 else Fmt.num(r.cores * 60.0)}) if r.cores >= 0.01 else "")
	_chips.robots.visible = s.built >= 1
	_chips.robots.show_value(str(WorkerManager.total(s)), tr("свободны: {n}").format({n = s.robots.idle}) if s.robots.idle > 0 else "")
	_chips.blueprints.visible = s.blueprints >= 1
	_chips.blueprints.show_value(str(s.blueprints), "+%d%%" % (s.blueprints * 10))
	_chips.power.visible = s.stage >= 2
	_power.text = tr("Питание ×{v}").format({v = Fmt.dec(d.power)})
	_power.add_theme_color_override("font_color", UiTheme.DANGER if s.shortage_active() else UiTheme.LAMP)
	_pause_btn.icon = UiTheme.icon("play" if Game.paused else "pause")
	# actions
	_act.dig.show_state(tr("Копать"), tr("+{n} хлам").format({n = Fmt.num(d.click)}), true)
	_act.sort.show_state(tr("Разобрать"), tr("{a} хлама → {b} дет.").format({a = Fmt.dec(d.ratio * d.batch), b = d.batch, pl = Fmt.plural(int(d.batch), "деталь|детали|деталей")}), s.scrap >= d.ratio)
	if not s.repair.is_empty():
		_act.repair.show_state(tr("Чинить робота"), tr("+{w} к ремонту · {p}/{n}").format({w = Fmt.num(d.wrench), p = Fmt.num(s.repair.progress), n = Fmt.num(s.repair.need)}),
			true, s.repair.progress / s.repair.need)
	else:
		var name := tr("Чинить следующего") if s.built > 0 else tr("Чинить робота")
		if s.free_jobs > 0:
			_act.repair.show_state(name, tr("брошенный робот — бесплатно"), true, 0.0)
		else:
			_act.repair.show_state(name, tr("нужно {n} деталей").format({n = Fmt.num(d.robot_cost), pl = Fmt.plural(int(d.robot_cost), "деталь|детали|деталей")}), s.parts >= d.robot_cost, clampf(s.parts / d.robot_cost, 0.0, 1.0))


func _unhandled_key_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or modal.visible:
		return
	var k := event as InputEventKey
	if k.ctrl_pressed or k.meta_pressed or k.alt_pressed:
		return
	var acts := {KEY_Q: Game.dig, KEY_1: Game.dig, KEY_W: Game.sort, KEY_2: Game.sort, KEY_E: Game.repair, KEY_3: Game.repair}
	if acts.has(k.keycode):
		var now := Time.get_ticks_msec()
		if k.echo and now - int(_key_times.get(k.keycode, 0)) < 110:
			return
		_key_times[k.keycode] = now
		acts[k.keycode].call()
		get_viewport().set_input_as_handled()
	elif k.keycode in [KEY_SPACE, KEY_P] and not k.echo:
		Game.set_paused(not Game.paused)
		get_viewport().set_input_as_handled()
	elif k.keycode == KEY_M and not k.echo:
		sfx.set_enabled(not sfx.enabled)


func _on_language() -> void:
	get_tree().call_group("interactables", "_refresh")
	_refresh()
	Game.changed.emit()


func _on_offline(r: Dictionary, seconds: float) -> void:
	var lines := [tr("Бригада работала {time}:").format({time = Fmt.duration(seconds)})]
	if seconds >= ProductionManager.OFFLINE_CAP:
		lines[0] = tr("Бригада работала {time} (больше восьми часов роботы без присмотра не работают):").format({time = Fmt.duration(seconds)})
	if r.scrap >= 1.0:
		lines.append("• " + tr("+{n} хлама").format({n = Fmt.num(r.scrap)}))
	if r.parts >= 1.0:
		lines.append("• " + tr("+{n} деталей").format({n = Fmt.num(r.parts), pl = Fmt.plural(int(r.parts), "деталь|детали|деталей")}))
	if r.cores >= 1.0:
		lines.append("• +%s %s" % [Fmt.num(r.cores), Fmt.plural(int(r.cores), "ядро|ядра|ядер")])
	if r.robots > 0:
		lines.append("• " + tr("+{n} {robots} в строю").format({n = r.robots, robots = Fmt.plural(r.robots, "робот|робота|роботов")}))
	modal.open(tr("Пока тебя не было"), "\n".join(lines), [[tr("Отлично"), null, true]])


func _on_event(e: Dictionary) -> void:
	if e.type == "stage_built":
		Game.save()


func _on_launch_finished() -> void:
	var s := Game.s
	var gain := ReconstructionManager.blueprint_gain(s)
	var body := "\n\n".join([
		tr("Свалка провожает его щелчками сотен роботов. Ты остаёшься на земле, но небо уже светлеет."),
		tr("За {time} ты собрал {parts} деталей и починил {n} {robots}.").format({time = Fmt.duration(s.time), parts = Fmt.num(s.stats.parts), pl = Fmt.plural(int(s.stats.parts), "деталь|детали|деталей"),
			n = s.built, robots = Fmt.plural(s.built, "робота|роботов|роботов")}),
		tr("«Новый рассвет» начнёт всё сначала, но даст {n} {bp}: каждый навсегда ускоряет всю работу на 10%.").format({n = gain,
			bp = Fmt.plural(gain, "чертёж|чертежа|чертежей")}),
	])
	modal.open(tr("Ковчег взлетел"), body, [[tr("Посмотреть ещё"), null], [tr("Новый рассвет"), Game.new_dawn, true]])


func _ask_new_dawn() -> void:
	var gain := ReconstructionManager.blueprint_gain(Game.s)
	modal.open(tr("Новый рассвет"), tr("Свалка начнётся заново, но с {n} {bp} в тетради. Достижения останутся.").format({n = Game.s.blueprints + gain,
		bp = Fmt.plural(Game.s.blueprints + gain, "чертежом|чертежами|чертежами")}), [[tr("Подождать"), null], [tr("Начать"), Game.new_dawn, true]])
