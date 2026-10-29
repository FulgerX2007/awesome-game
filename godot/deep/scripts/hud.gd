class_name DeepHud
extends CanvasLayer
## The interface, laid out like web/deep (index.html + style.css): stage, length and depth top left,
## a depth gauge on the left edge, atlas and sound top right, the dash button for touch screens,
## the menu and the atlas. Sizes are CSS pixels (main.gd scales the window by the pixel ratio).
## Static texts are Russian keys that Godot translates by itself when the language changes.

signal start_pressed
signal restart_pressed
signal atlas_opened
signal atlas_closed
signal sound_pressed
signal lang_pressed
signal home_pressed
signal dash_pressed

const Core := preload("res://scripts/core.gd")
const ABYSS := Color("#031421")
const FG := Color("#e6f4f1")
const DIM := Color("#8fb3b5")
const GLOW := Color("#ffd98a")
const DANGER := Color("#ff6f6f")
const LINE := Color(143 / 255.0, 179 / 255.0, 181 / 255.0, 0.25)
const CARD := Color(4 / 255.0, 24 / 255.0, 36 / 255.0, 0.72)
const ZONE_COLORS := ["#3d93a6", "#1d4f86", "#10244a", "#0b1226", "#1d1024"]

var display: Font
var body: FontVariation
var body_bold: FontVariation

var hud: Control
var stage_name: Label
var length: Label
var depth: Label
var ladder: Array[ColorRect] = []
var ladder_fill: Array[ColorRect] = []
var next_label: Label
var next_fill: ColorRect
var next_track: ColorRect
var gauge: Control
var gauge_mark: ColorRect
var corner: HBoxContainer
var best: Label
var btn_atlas: Button
var btn_sound: Button
var dash: Button
var dash_cd := 1.0
var toast_box: VBoxContainer
var toast_big: Label
var toast_small: Label
var _toast_tween: Tween
var _toast_left := 0.0
var menu: Control
var btn_start: Button
var btn_restart: Button
var btn_home: Button
var btn_lang: Button
var atlas: Control
var atlas_grid: GridContainer
var atlas_count: Label
var atlas_scroll: ScrollContainer
var floaters: Control
var cursor: Control
var cursor_pos := Vector2.ZERO
var cursor_on := false


func _ready() -> void:
	layer = 10
	display = load("res://assets/fonts/Marmelad.ttf")
	var golos: FontFile = load("res://assets/fonts/GolosText.ttf")
	body = FontVariation.new()
	body.base_font = golos
	body.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): 400}
	body_bold = FontVariation.new()
	body_bold.base_font = golos
	body_bold.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): 600}
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = _theme()
	add_child(root)

	floaters = Control.new()
	floaters.set_anchors_preset(Control.PRESET_FULL_RECT)
	floaters.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(floaters)
	cursor = Control.new()
	cursor.set_anchors_preset(Control.PRESET_FULL_RECT)
	cursor.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cursor.draw.connect(func():
		if cursor_on:
			cursor.draw_arc(cursor_pos, 7, 0, TAU, 32, Color(GLOW, 0.5), 1.5, true))
	root.add_child(cursor)

	_build_hud(root)
	_build_toast(root)
	_build_menu(root)
	# the atlas and sound chips stay usable over the menu, the atlas covers them
	root.move_child(corner, -1)
	_build_atlas(root)


func _theme() -> Theme:
	var t := Theme.new()
	t.default_font = body
	t.default_font_size = 15
	t.set_color("font_color", "Label", FG)
	var chip := _box(CARD, 16, LINE, Vector4(12, 6, 12, 6))
	t.set_stylebox("normal", "Button", chip)
	t.set_stylebox("hover", "Button", _box(Color(CARD, 0.9), 16, Color(LINE, 0.5), Vector4(12, 6, 12, 6)))
	t.set_stylebox("pressed", "Button", chip)
	t.set_stylebox("focus", "Button", _box(Color(0, 0, 0, 0), 16, GLOW, Vector4(12, 6, 12, 6)))
	t.set_color("font_color", "Button", DIM)
	t.set_color("font_hover_color", "Button", FG)
	t.set_color("font_pressed_color", "Button", FG)
	t.set_color("font_focus_color", "Button", DIM)
	t.set_font_size("font_size", "Button", 13)
	var bar := StyleBoxFlat.new()
	bar.bg_color = Color(DIM, 0.4)
	bar.set_corner_radius_all(3)
	t.set_stylebox("grabber_area", "VScrollBar", bar)
	t.set_stylebox("grabber", "VScrollBar", bar)
	t.set_stylebox("scroll", "VScrollBar", StyleBoxEmpty.new())
	return t


static func _box(bg: Color, radius: int, border: Color, pad: Vector4) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.set_corner_radius_all(radius)
	if border.a > 0:
		s.border_color = border
		s.set_border_width_all(1)
	s.content_margin_left = pad.x
	s.content_margin_top = pad.y
	s.content_margin_right = pad.z
	s.content_margin_bottom = pad.w
	s.anti_aliasing = true
	return s


func _label(text: String, size: int, color := FG, font: Font = null, translate := true) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if font:
		l.add_theme_font_override("font", font)
	l.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_ALWAYS if translate else Node.AUTO_TRANSLATE_MODE_DISABLED
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


## A soft dark edge that keeps text readable over bright water (CSS: text-shadow 0 2px 12px).
func _shadow(l: Label, size := 12) -> void:
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.35))
	l.add_theme_constant_override("shadow_offset_y", 1)
	l.add_theme_constant_override("shadow_outline_size", maxi(3, size / 4))


func _button(text: String, big := false, ghost := false) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_ALL
	b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	if big:
		var pad := Vector4(28, 12, 28, 12)
		var bg := Color(0, 0, 0, 0) if ghost else GLOW
		var border := LINE if ghost else Color(0, 0, 0, 0)
		b.add_theme_stylebox_override("normal", _box(bg, 24, border, pad))
		b.add_theme_stylebox_override("hover", _box(bg.lightened(0.08) if not ghost else Color(1, 1, 1, 0.04), 24, border, pad))
		b.add_theme_stylebox_override("pressed", _box(bg, 24, border, pad))
		b.add_theme_stylebox_override("focus", _box(Color(0, 0, 0, 0), 24, GLOW, pad))
		var c := FG if ghost else ABYSS
		for k in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
			b.add_theme_color_override(k, c)
		b.add_theme_font_override("font", body if ghost else display)
		b.add_theme_font_size_override("font_size", 15 if ghost else 18)
	return b


# ───────────── HUD ─────────────
func _build_hud(root: Control) -> void:
	hud = Control.new()
	hud.set_anchors_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.visible = false
	root.add_child(hud)

	var col := VBoxContainer.new()
	col.position = Vector2(16, 14)
	col.add_theme_constant_override("separation", 2)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(col)
	stage_name = _label("", 32, GLOW, display, false)
	_shadow(stage_name)
	col.add_child(stage_name)
	length = _label("", 15, FG, null, false)
	_shadow(length)
	col.add_child(length)
	depth = _label("", 13, DIM, null, false)
	_shadow(depth)
	col.add_child(depth)
	var lad := HBoxContainer.new()
	lad.add_theme_constant_override("separation", 4)
	lad.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(_spacer(6))
	col.add_child(lad)
	for i in Core.STAGES.size() - 1:
		var track := ColorRect.new()
		track.custom_minimum_size = Vector2(22, 5)
		track.color = Color(DIM, 0.25)
		track.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var fill := ColorRect.new()
		fill.color = GLOW
		fill.size = Vector2(0, 5)
		track.add_child(fill)
		lad.add_child(track)
		ladder.append(track)
		ladder_fill.append(fill)
	col.add_child(_spacer(6))
	next_label = _label("", 13, FG, null, false)
	_shadow(next_label)
	col.add_child(next_label)
	next_track = ColorRect.new()
	next_track.custom_minimum_size = Vector2(190, 8)
	next_track.color = Color(DIM, 0.22)
	next_track.mouse_filter = Control.MOUSE_FILTER_IGNORE
	next_fill = ColorRect.new()
	next_fill.color = GLOW
	next_fill.size = Vector2(0, 8)
	next_track.add_child(next_fill)
	col.add_child(next_track)

	gauge = Control.new()
	gauge.mouse_filter = Control.MOUSE_FILTER_IGNORE
	gauge.set_anchors_preset(Control.PRESET_CENTER_LEFT)
	root.add_child(gauge)
	for i in 5:
		var z := ColorRect.new()
		z.color = Color(ZONE_COLORS[i])
		z.mouse_filter = Control.MOUSE_FILTER_IGNORE
		gauge.add_child(z)
	gauge_mark = ColorRect.new()
	gauge_mark.color = GLOW
	gauge_mark.size = Vector2(13, 3)
	gauge_mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
	gauge.add_child(gauge_mark)

	corner = HBoxContainer.new()
	corner.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	corner.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	corner.position = Vector2(-16, 12)
	corner.add_theme_constant_override("separation", 10)
	corner.alignment = BoxContainer.ALIGNMENT_END
	root.add_child(corner)
	best = _label("", 13, DIM, null, false)
	corner.add_child(best)
	btn_atlas = _button("Атлас")
	btn_atlas.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	btn_atlas.pressed.connect(func(): atlas_opened.emit())
	corner.add_child(btn_atlas)
	btn_sound = _button("Звук: вкл")
	btn_sound.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	btn_sound.pressed.connect(func(): sound_pressed.emit())
	corner.add_child(btn_sound)

	dash = Button.new()
	dash.custom_minimum_size = Vector2(74, 74)
	dash.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	dash.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	dash.grow_vertical = Control.GROW_DIRECTION_BEGIN
	dash.position = Vector2(-94, -98)
	dash.flat = true
	dash.focus_mode = Control.FOCUS_NONE
	dash.text = "рывок"
	dash.add_theme_color_override("font_color", GLOW)
	dash.add_theme_color_override("font_pressed_color", GLOW)
	dash.add_theme_color_override("font_hover_color", GLOW)
	dash.add_theme_font_size_override("font_size", 13)
	for k in ["normal", "hover", "pressed", "focus"]:
		dash.add_theme_stylebox_override(k, StyleBoxEmpty.new())
	dash.button_down.connect(func(): dash_pressed.emit())
	dash.draw.connect(func():
		var c := dash.size / 2
		var r := minf(c.x, c.y) - 1
		dash.draw_circle(c, r, CARD)
		if dash_cd < 1:
			dash.draw_arc(c, r * 0.5, -PI / 2, -PI / 2 + TAU * dash_cd, 48, Color(GLOW, 0.25), r, true)
		else:
			dash.draw_circle(c, r, Color(GLOW, 0.25))
		dash.draw_arc(c, r, 0, TAU, 64, GLOW, 2, true))
	dash.visible = false
	root.add_child(dash)


func _spacer(h: float) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(0, h)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c


func layout(view: Vector2) -> void:
	var h := minf(view.y * 0.4, 260.0) if view.x > 600 else view.y * 0.28
	gauge.position = Vector2(6, view.y / 2 - h / 2)
	gauge.size = Vector2(5, h)
	for i in 5:
		var z: ColorRect = gauge.get_child(i)
		z.position = Vector2(0, h * i / 5.0)
		z.size = Vector2(5, h / 5.0)
	best.visible = view.x > 520
	stage_name.add_theme_font_size_override("font_size", int(clampf(view.x * 0.05, 26, 36)))
	toast_box.position = Vector2(16, view.y * 0.22)
	toast_box.size.x = view.x - 32
	var cols := maxi(1, int((minf(view.x, 880.0) - 32) / 210.0))
	if atlas_grid.columns != cols:
		atlas_grid.columns = cols
	menu_panel_width(view)


func update(p, stage_text: String, len_text: String, depth_text: String, next_text: String, k: float, lost: bool, best_text: String, atlas_text: String, sound_text: String) -> void:
	stage_name.text = stage_text
	length.text = len_text
	depth.text = depth_text
	next_label.text = next_text
	next_fill.size.x = next_track.size.x * k
	next_fill.color = DANGER if lost else GLOW
	for i in ladder.size():
		var st: Dictionary = Core.STAGES[i + 1]
		var prev: Dictionary = Core.STAGES[i]
		var f: float = 1.0 if p.r >= st.from else (0.0 if p.r <= prev.from else (p.r - prev.from) / (st.from - prev.from))
		ladder[i].color = GLOW if f >= 1 else Color(DIM, 0.25)
		ladder_fill[i].size.x = 0.0 if f >= 1 else 22 * f
	gauge_mark.position = Vector2(-4, gauge.size.y * p.depth / Core.MAX_DEPTH - 1)
	best.text = best_text
	btn_atlas.text = atlas_text
	btn_sound.text = sound_text
	dash_cd = 1.0 - p.dash_cd / Core.DASH_COOLDOWN
	if dash.visible:
		dash.queue_redraw()


# ───────────── Toast ─────────────
func _build_toast(root: Control) -> void:
	toast_box = VBoxContainer.new()
	toast_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	toast_box.add_theme_constant_override("separation", 4)
	toast_box.modulate.a = 0
	root.add_child(toast_box)
	toast_big = _label("", 26, FG, display, false)
	toast_big.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_big.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_shadow(toast_big, 20)
	toast_box.add_child(toast_big)
	toast_small = _label("", 15, DIM, null, false)
	toast_small.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_small.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_shadow(toast_small, 16)
	toast_box.add_child(toast_small)


func toast(big: String, small: String, secs := 3.5) -> void:
	toast_big.text = big
	toast_small.text = small
	toast_small.visible = small != ""
	if _toast_tween:
		_toast_tween.kill()
	_toast_tween = create_tween()
	toast_box.modulate.a = 0
	var y := toast_box.position.y
	toast_box.position.y = y + 10
	_toast_tween.set_parallel(true)
	_toast_tween.tween_property(toast_box, "modulate:a", 1.0, 0.6).set_ease(Tween.EASE_OUT)
	_toast_tween.tween_property(toast_box, "position:y", y, 0.6).set_ease(Tween.EASE_OUT)
	_toast_tween.chain().tween_property(toast_box, "modulate:a", 0.0, 0.3).set_delay(secs - 0.6)


## "+2,4%" rising over a bite, in screen pixels.
func floater(pos: Vector2, text: String) -> void:
	var l := _label(text, 14, GLOW, body_bold, false)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.5))
	l.add_theme_constant_override("outline_size", 3)
	l.position = pos - Vector2(30, 24)
	l.size = Vector2(60, 20)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	floaters.add_child(l)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(l, "position:y", l.position.y - 34, 1.2)
	tw.tween_property(l, "modulate:a", 0.0, 1.0).set_delay(0.2)
	tw.chain().tween_callback(l.queue_free)


# ───────────── Menu ─────────────
var _menu_panel: VBoxContainer


func _build_menu(root: Control) -> void:
	menu = _overlay(Color(3 / 255.0, 20 / 255.0, 33 / 255.0, 0.6))
	root.add_child(menu)
	var scroll := ScrollContainer.new()
	scroll.set_anchors_preset(Control.PRESET_FULL_RECT)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	menu.add_child(scroll)
	var center := CenterContainer.new()
	center.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.add_child(center)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 16 if side in ["left", "right"] else 24)
	center.add_child(margin)
	_menu_panel = VBoxContainer.new()
	_menu_panel.add_theme_constant_override("separation", 12)
	margin.add_child(_menu_panel)
	var title := _label("Глубина", 72, GLOW, display)
	title.add_theme_color_override("font_shadow_color", Color(GLOW, 0.12))
	title.add_theme_constant_override("shadow_outline_size", 18)
	title.add_theme_constant_override("shadow_offset_y", 0)
	_menu_panel.add_child(title)
	for t in [
		["Ты — крошечная клетка в толще океана. Ешь тех, кто меньше тебя, и расти: рачок, малёк, рыба, кальмар, акула, кит. А дальше — то, что встречается только в морских легендах.", 17, FG],
		["Океан уходит вниз на 11 километров. Чем глубже, тем темнее, но и еда там сытнее, а живут там удивительные существа.", 15, DIM],
	]:
		var l := _label(t[0], t[1], t[2])
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_menu_panel.add_child(l)
	var rules := VBoxContainer.new()
	rules.add_theme_constant_override("separation", 6)
	for t in [
		"Плыви за курсором или пальцем. Пробел, зажатая кнопка мыши или кнопка «рывок» — короткое ускорение.",
		"Опасны только хищники крупнее тебя. Когда хищник тебя заметил, он светится красным. Погоня его утомляет.",
		"В темноте видно только то, что рядом, и тех, кто светится сам. Не плыви на одинокий огонёк.",
		"Каждый новый вид попадает в атлас, он сохраняется навсегда.",
		"Если тебя съедят, ты потеряешь половину размера и поплывёшь дальше. Конца игры нет.",
	]:
		var row := HBoxContainer.new()
		var dot := _label("•", 15, DIM, null, false)
		dot.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		row.add_child(dot)
		var l := _label(t, 15, DIM)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(l)
		rules.add_child(row)
	_menu_panel.add_child(rules)
	var buttons := HFlowContainer.new()
	buttons.add_theme_constant_override("h_separation", 10)
	buttons.add_theme_constant_override("v_separation", 10)
	buttons.alignment = FlowContainer.ALIGNMENT_END
	_menu_panel.add_child(buttons)
	btn_home = _button("← Игры")
	btn_home.visible = false
	btn_home.pressed.connect(func(): home_pressed.emit())
	buttons.add_child(btn_home)
	btn_lang = _button("")
	btn_lang.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	btn_lang.pressed.connect(func(): lang_pressed.emit())
	buttons.add_child(btn_lang)
	var gap := Control.new()
	gap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	buttons.add_child(gap)
	var b_atlas := _button("Атлас", true, true)
	b_atlas.pressed.connect(func(): atlas_opened.emit())
	buttons.add_child(b_atlas)
	btn_restart = _button("Начать с клетки", true, true)
	btn_restart.visible = false
	btn_restart.pressed.connect(func(): restart_pressed.emit())
	buttons.add_child(btn_restart)
	btn_start = _button("Нырнуть", true)
	btn_start.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	btn_start.pressed.connect(func(): start_pressed.emit())
	buttons.add_child(btn_start)


func menu_panel_width(view: Vector2) -> void:
	_menu_panel.custom_minimum_size.x = minf(460.0, view.x - 32)


func _overlay(bg: Color) -> Control:
	var o := ColorRect.new()
	o.color = bg
	o.set_anchors_preset(Control.PRESET_FULL_RECT)
	o.mouse_filter = Control.MOUSE_FILTER_STOP
	return o


# ───────────── Atlas ─────────────
func _build_atlas(root: Control) -> void:
	atlas = _overlay(Color(3 / 255.0, 16 / 255.0, 26 / 255.0, 0.97))
	atlas.visible = false
	root.add_child(atlas)
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 16 if side in ["left", "right"] else 24)
	atlas.add_child(margin)
	var center := HBoxContainer.new()
	center.alignment = BoxContainer.ALIGNMENT_CENTER
	margin.add_child(center)
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.custom_minimum_size.x = 0
	col.add_theme_constant_override("separation", 14)
	center.add_child(col)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 12)
	col.add_child(head)
	head.add_child(_label("Атлас", 32, GLOW, display))
	atlas_count = _label("", 15, DIM, null, false)
	atlas_count.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(atlas_count)
	var close := _button("Закрыть")
	close.pressed.connect(func(): atlas_closed.emit())
	head.add_child(close)
	atlas_scroll = ScrollContainer.new()
	atlas_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	atlas_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	col.add_child(atlas_scroll)
	atlas_grid = GridContainer.new()
	atlas_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	atlas_grid.add_theme_constant_override("h_separation", 10)
	atlas_grid.add_theme_constant_override("v_separation", 10)
	atlas_scroll.add_child(atlas_grid)


## One card: picture, name, zones, fact and counts (or a dark silhouette for a species not met yet).
func atlas_card(pic: Texture2D, silhouette: bool, painted: bool, name_text: String, zones: String, fact: String, count: String) -> Control:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", _box(CARD, 14, LINE, Vector4(10, 10, 10, 10)))
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 6)
	card.add_child(col)
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", _box(Color("#0b2c3f"), 10, Color(0, 0, 0, 0), Vector4(0, 0, 0, 0)))
	frame.clip_children = CanvasItem.CLIP_CHILDREN_AND_DRAW
	frame.custom_minimum_size = Vector2(0, 100)  # cards are about 200 px wide: a 2:1 picture
	var img := TextureRect.new()
	img.texture = pic
	img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED if painted else TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	img.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	if silhouette:
		img.modulate = Color("#0d2333")
	frame.add_child(img)
	col.add_child(frame)
	var n := _label(name_text, 18, FG if not silhouette else DIM, display, false)
	n.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(n)
	var z := _label(zones, 12, Color(GLOW, 0.8), null, false)
	z.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(z)
	var f := _label(fact, 13, DIM, null, false)
	f.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	f.custom_minimum_size.x = 160
	col.add_child(f)
	if count != "":
		col.add_child(_label(count, 12, Color(DIM, 0.8), null, false))
	return card
