class_name WinterHud
extends Control
## The HUD over the game: the top bar (four stat bars with icons — health, warmth, food, stamina — that ease to
## their value and pulse when critical; the day, the clock, the weather and the temperature; the camp's stock and
## what the hero carries), the task card (the rules' next task), banners, markers for people off screen, and the
## bottom action bar: Action, To the fire, Eat, Build, Workbench, Inventory, Pause.

signal action(name: String)

const STATS := ["health", "warmth", "food", "energy"]
const STAT_ICON := {"health": "health", "warmth": "warmth", "food": "food", "energy": "stamina"}
const STAT_NAME := {"health": "Здоровье", "warmth": "Тепло", "food": "Сытость", "energy": "Силы"}
const RES := ["wood", "stone", "metal", "hide"]
const BUTTONS := [
	["act", "action", "Действие", "E"], ["fire", "fire", "К костру", "G"], ["eat", "eat", "Поесть", "F"],
	["build", "build", "Постройки", "B"], ["bench", "bench", "Верстак", "T"], ["inventory", "inventory", "Вещи", "I"],
	["pause", "pause", "Пауза", "␣"],
]

var top: PanelContainer
var top_box: BoxContainer
var bars := {}            # stat -> {bar: StatBar, value: Label, shown: float, warn: TextureRect}
var day_label: Label
var clock_label: Label
var weather_icon: TextureRect
var temp_label: Label
var res_labels := {}
var load_label: Label
var task: PanelContainer
var task_label: Label
var banner: PanelContainer
var banner_label: Label
var banner_t := 0.0
var bottom: HBoxContainer
var buttons := {}
var markers: Control
var _blink := 0.0
var _marks := []


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_top()
	_build_task()
	_build_banner()
	_build_bottom()
	markers = Control.new()
	markers.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	markers.mouse_filter = Control.MOUSE_FILTER_IGNORE
	markers.draw.connect(_draw_markers)
	add_child(markers)


func _build_top() -> void:
	top = PanelContainer.new()
	top.add_theme_stylebox_override("panel", _bar_style())
	top.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(top)
	top_box = BoxContainer.new()
	top_box.add_theme_constant_override("separation", 22)
	top.add_child(top_box)
	var stats := HBoxContainer.new()
	stats.add_theme_constant_override("separation", 14)
	stats.name = "Stats"
	top_box.add_child(stats)
	for s in STATS:
		var box := HBoxContainer.new()
		box.add_theme_constant_override("separation", 6)
		box.tooltip_text = tr(STAT_NAME[s])
		box.mouse_filter = Control.MOUSE_FILTER_PASS
		var ic := _icon(STAT_ICON[s], 34)
		box.add_child(ic)
		var col := VBoxContainer.new()
		col.add_theme_constant_override("separation", 0)
		var bar := StatBar.new()
		bar.color = WinterTheme.STAT[s]
		bar.custom_minimum_size = Vector2(110, 14)
		bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var val := Label.new()
		val.theme_type_variation = "Small"
		val.text = "100"
		col.add_child(val)
		col.add_child(bar)
		box.add_child(col)
		stats.add_child(box)
		bars[s] = {"bar": bar, "value": val, "shown": 100.0, "icon": ic, "box": box}
	var mid := HBoxContainer.new()
	mid.name = "Day"
	mid.add_theme_constant_override("separation", 8)
	mid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mid.alignment = BoxContainer.ALIGNMENT_CENTER
	weather_icon = _icon("day", 34)
	mid.add_child(weather_icon)
	var dcol := VBoxContainer.new()
	dcol.add_theme_constant_override("separation", -2)
	day_label = Label.new()
	day_label.add_theme_font_override("font", WinterTheme.font_bold)
	day_label.add_theme_font_size_override("font_size", 20)
	clock_label = Label.new()
	clock_label.theme_type_variation = "Small"
	dcol.add_child(day_label)
	dcol.add_child(clock_label)
	mid.add_child(dcol)
	mid.add_child(_icon("thermometer", 26))
	temp_label = Label.new()
	temp_label.add_theme_font_size_override("font_size", 18)
	mid.add_child(temp_label)
	top_box.add_child(mid)
	var res := HBoxContainer.new()
	res.name = "Res"
	res.add_theme_constant_override("separation", 10)
	for r in RES + ["food"]:
		var b := HBoxContainer.new()
		b.add_theme_constant_override("separation", 3)
		b.add_child(_icon(r if r != "food" else "berries", 26))
		var l := Label.new()
		l.text = "0"
		l.add_theme_font_size_override("font_size", 17)
		b.add_child(l)
		b.mouse_filter = Control.MOUSE_FILTER_PASS
		res.add_child(b)
		res_labels[r] = l
	load_label = Label.new()
	load_label.theme_type_variation = "Small"
	res.add_child(load_label)
	top_box.add_child(res)


func _bar_style() -> StyleBox:
	var s := WinterTheme.panel_style(true)
	if s is StyleBoxFlat:
		var f := s.duplicate() as StyleBoxFlat
		f.set_corner_radius_all(0)
		f.corner_radius_bottom_left = 18
		f.corner_radius_bottom_right = 18
		f.border_width_top = 0
		f.bg_color = Color(WinterTheme.PANEL, 0.82)
		f.content_margin_top = 8
		f.content_margin_bottom = 8
		return f
	var t := (s as StyleBoxTexture).duplicate() as StyleBoxTexture
	t.content_margin_top = 8
	t.content_margin_bottom = 8
	return t


func _icon(id: String, px: int) -> TextureRect:
	var r := TextureRect.new()
	r.texture = WinterTheme.icon(id)
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	r.custom_minimum_size = Vector2(px, px)
	r.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return r


func _build_task() -> void:
	task = PanelContainer.new()
	var s := WinterTheme.panel_style()
	if s is StyleBoxFlat:
		s = s.duplicate()
		s.bg_color = Color(WinterTheme.PANEL, 0.72)
		s.content_margin_top = 8
		s.content_margin_bottom = 8
		s.content_margin_left = 14
		s.content_margin_right = 16
		s.set_corner_radius_all(12)
		s.shadow_size = 6
	task.add_theme_stylebox_override("panel", s)
	task.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 8)
	var ic := _icon("snow", 24)
	ic.modulate = WinterTheme.WARM
	h.add_child(ic)
	task_label = Label.new()
	task_label.add_theme_font_size_override("font_size", 17)
	h.add_child(task_label)
	task.add_child(h)
	add_child(task)


func _build_banner() -> void:
	banner = PanelContainer.new()
	var s := WinterTheme.panel_style(true)
	if s is StyleBoxFlat:
		s = s.duplicate()
		s.border_color = Color(WinterTheme.WARM, 0.55)
		s.content_margin_top = 10
		s.content_margin_bottom = 10
	banner.add_theme_stylebox_override("panel", s)
	banner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	banner_label = Label.new()
	banner_label.add_theme_font_override("font", WinterTheme.font_bold)
	banner_label.add_theme_font_size_override("font_size", 22)
	banner_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	banner.add_child(banner_label)
	banner.visible = false
	add_child(banner)


func _build_bottom() -> void:
	bottom = HBoxContainer.new()
	bottom.add_theme_constant_override("separation", 8)
	bottom.alignment = BoxContainer.ALIGNMENT_CENTER
	add_child(bottom)
	for b in BUTTONS:
		var btn := Button.new()
		btn.icon = WinterTheme.icon(b[1])
		btn.text = tr(b[2])
		btn.tooltip_text = "%s (%s)" % [tr(b[2]), b[3] if b[3] != "␣" else tr("Пробел")]
		btn.focus_mode = Control.FOCUS_NONE
		btn.expand_icon = false
		btn.custom_minimum_size = Vector2(0, 54)
		if b[0] == "act":
			btn.theme_type_variation = "AccentButton"
		btn.pressed.connect(func(): action.emit(b[0]))
		bottom.add_child(btn)
		buttons[b[0]] = btn


## Places the bars for the screen: one row on a wide screen, the stats over the rest on a narrow one.
func layout(sz: Vector2) -> void:
	var narrow := sz.x < 1100
	var compact := sz.x < 760
	top.position = Vector2(0, 0)
	top.size = Vector2(sz.x, 0)
	top_box.vertical = narrow
	for s in STATS:
		bars[s].bar.custom_minimum_size.x = 70 if compact else 110
	for k in buttons:
		var b: Button = buttons[k]
		b.text = "" if compact and k != "act" else tr(BUTTONS.filter(func(x): return x[0] == k)[0][2])
		b.custom_minimum_size = Vector2(54 if compact else 0, 54)
	await get_tree().process_frame
	top.size = Vector2(sz.x, 0)
	task.position = Vector2(16, top.size.y + 10)
	bottom.position = Vector2((sz.x - bottom.size.x) * 0.5, sz.y - bottom.size.y - 14)
	banner.size = Vector2(minf(560, sz.x - 32), 0)
	banner.position = Vector2((sz.x - banner.size.x) * 0.5, top.size.y + 64)


func show_banner(text: String, seconds := 1.8) -> void:
	banner_label.text = text
	banner.visible = true
	banner.modulate.a = 1.0
	banner_t = seconds
	banner.size = Vector2(banner.size.x, 0)


## Every frame while playing: eases the bars, blinks the critical ones, writes the numbers.
func update(g: Dictionary, delta: float, task_text: String, action_label: String) -> void:
	_blink += delta
	var h: Dictionary = g.hero
	for s in STATS:
		var v: float = float(h[s])
		var b: Dictionary = bars[s]
		b.shown = lerpf(b.shown, v, 1.0 - exp(-delta * 6.0))
		b.bar.value = b.shown / 100.0
		b.value.text = str(int(round(v)))
		var crit := v < 25.0
		b.bar.critical = crit
		b.icon.modulate = Color(1, 1, 1, 1) if not crit else Color(1, 0.55 + 0.45 * absf(sin(_blink * 5.0)), 0.55 + 0.45 * absf(sin(_blink * 5.0)))
		b.value.add_theme_color_override("font_color", WinterTheme.BAD if crit else WinterTheme.DIM)
	day_label.text = tr("День {n}").format({"n": WinterSim.day_of(g)})
	var blz := WinterSim.is_blizzard(g)
	clock_label.text = "%s · %s" % [WinterViewMath.clock(g), tr("метель") if blz else tr("ночь") if WinterSim.is_night(g) else tr("вечер") if WinterSim.time_of_day(g) >= 80.0 else tr("день")]
	weather_icon.texture = WinterTheme.icon("blizzard" if blz else "night" if WinterSim.is_night(g) else "day")
	weather_icon.modulate = Color(1, 0.75, 0.6) if not blz and not WinterSim.is_night(g) and WinterSim.time_of_day(g) >= 80.0 else Color.WHITE
	var t := WinterSim.temperature(g)
	temp_label.text = "%d °C" % int(round(t))
	temp_label.add_theme_color_override("font_color", WinterTheme.FROST if t > -15 else Color("9fc4ff") if t > -24 else Color("c9b8ff"))
	for r in RES:
		res_labels[r].text = str(int(g.stock[r]))
	res_labels.food.text = str(int(WinterSim.food_total(g)))
	var away := not WinterSim.at_base(g)
	load_label.visible = away
	if away:
		var cap := WinterSim.carry_of(g)
		load_label.text = tr("ноша {n}/{m}").format({"n": int(h.load), "m": int(cap)})
		load_label.add_theme_color_override("font_color", WinterTheme.WARN if float(h.load) >= cap else WinterTheme.DIM)
	task_label.text = task_text
	buttons.act.text = action_label if action_label != "" else tr("Действие")
	buttons.eat.disabled = WinterSim.food_total(g) == 0 or float(h.food) >= 98.0
	if banner_t > 0.0:
		banner_t -= delta
		if banner_t < 0.3:
			banner.modulate.a = maxf(0.0, banner_t / 0.3)
		if banner_t <= 0.0:
			banner.visible = false
	markers.queue_redraw()


## Arrows on the screen's edge toward people who wait for help, the lost child and the trader.
func set_markers(list: Array) -> void:
	_marks = list


func _draw_markers() -> void:
	for m in _marks:
		var p: Vector2 = m.p
		var a: float = m.a
		var c: Color = m.color
		var pts := PackedVector2Array([p + Vector2.from_angle(a) * 16, p + Vector2.from_angle(a + 2.5) * 11, p + Vector2.from_angle(a - 2.5) * 11])
		markers.draw_circle(p, 17, Color(0.06, 0.08, 0.15, 0.75))
		markers.draw_colored_polygon(pts, c)


## A bar that eases to its value: a dark trough, the fill with a highlight, a pulse when critical.
class StatBar extends Control:
	var value := 1.0:
		set(v):
			value = clampf(v, 0.0, 1.0)
			queue_redraw()
	var color := Color.WHITE
	var critical := false
	var _t := 0.0

	func _process(delta: float) -> void:
		_t += delta
		if critical:
			queue_redraw()

	func _draw() -> void:
		var r := Rect2(Vector2.ZERO, size)
		var rad := size.y * 0.5
		_round(r, rad, Color(0.04, 0.06, 0.12, 0.85))
		var w := maxf(size.y, size.x * value) if value > 0.0 else 0.0
		if w > 0.0:
			var c := color
			if critical:
				c = c.lerp(Color.WHITE, 0.25 + 0.25 * sin(_t * 8.0))
			var fr := Rect2(Vector2(1, 1), Vector2(w - 2, size.y - 2))
			_round(fr, rad - 1, c.darkened(0.25))
			_round(Rect2(fr.position, Vector2(fr.size.x, fr.size.y * 0.55)), rad - 1, c.lightened(0.12))
		draw_rect(Rect2(Vector2(rad, 1), Vector2(size.x - rad * 2, 1)), Color(1, 1, 1, 0.08))

	func _round(r: Rect2, rad: float, c: Color) -> void:
		var sb := StyleBoxFlat.new()
		sb.bg_color = c
		sb.set_corner_radius_all(int(rad))
		draw_style_box(sb, r)
