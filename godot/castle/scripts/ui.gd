extends CanvasLayer
## The interface over the 3D world, all in code: one theme (Golos Text, dark wood and gold, like web/castle),
## the screens (menu, campaign map, armory, briefing, pause, result) and, during a level, the HUD (level, wave,
## wall, gold, ward, pause, sound), the boss bar, enemy health bars, toasts, warnings and the side panel between
## waves. It reads the game through `main` (its sim and progress) and calls back into it; the world takes the
## input the UI doesn't stop.

const FONT := preload("res://assets/fonts/GolosText.ttf")
const FG := Color("#f6ecd6")
const DIM := Color("#c9b796")
const ACCENT := Color("#f2b24a")
const GOOD := Color("#86d36f")
const BAD := Color("#ff6a55")
const WARN := Color("#ffb23a")
const PANEL := Color(0.12, 0.09, 0.065, 0.93)
const PANEL2 := Color(0.2, 0.15, 0.1, 0.96)
const LINE := Color("#7a5c36")
const FULL_DRAG := 170.0            # canvas px of pull for full power (as web/castle/view.js)
const DEAD_DRAG := 8.0
const REGION_COLORS := {frontier = Color("#86d36f"), frost = Color("#9fd4ff"), ash = Color("#ff9a5a"), cursed = Color("#b79cff"), citadel = Color("#ff6a7a")}

var main: Node
var root: Control
var theme: Theme
var screen_box: Control             # the current full screen (menu, map, ...)
var hud: Control
var hud_level: Label
var hud_wave: Label
var hud_wall: Control
var hud_gold: Label
var hud_ward: Label
var hud_ward_box: Control
var btn_pause: Button
var btn_sound: Button
var boss_box: Control
var boss_name: Label
var boss_bar: Control
var boss_hint: Label
var bars: Control                   # enemy health bars and the aim preview over the field
var aim_points: PackedVector2Array = []   # the arrow's flight on screen while aiming (main fills it)
var aim_lands := false              # the last point is where it hits the ground
var toasts: VBoxContainer
var banner_box: PanelContainer
var banner_title: Label
var banner_text: Label
var _banner_t := 0.0
var tip: Label
var side: PanelContainer
var pause_box: Control
var _t := 0.0


class PixelBox extends Control:
	## A Pixel Bars bar (addons/pixel_bars, by heyheythere, CC BY 4.0) drawn at its native pixel size and
	## scaled by a whole number, so the pixel art stays crisp, with a label over it. value is 0..1.
	const K := 3.0
	var bar: PixelBar
	var caption: Label
	var value := 1.0:
		set(v):
			value = v
			if bar:
				bar.value = v
	var fill := "health":
		set(v):
			if v != fill:
				fill = v
				if bar:
					bar.fill = v
	var text := "":
		set(v):
			text = v
			if caption:
				caption.text = v

	func _init(shape: int, px: Vector2, font: Font) -> void:
		custom_minimum_size = px
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		bar = PixelBar.new()
		bar.shape = shape
		bar.style = "wood"
		bar.fill = fill
		bar.max_value = 1.0
		bar.low = 0.3
		bar.scale = Vector2(K, K)
		bar.size = px / K
		bar.custom_minimum_size = px / K
		bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(bar)
		caption = Label.new()
		caption.set_anchors_preset(Control.PRESET_FULL_RECT)
		caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		caption.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		caption.add_theme_font_override("font", font)
		caption.add_theme_font_size_override("font_size", int(px.y * 0.5))
		caption.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
		caption.add_theme_constant_override("outline_size", 5)
		caption.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(caption)


class Icon extends Control:
	## Small drawn icons: coin, shield, star, lock, crown, pause, speaker.
	var kind := "coin"
	var on := true
	var tint := Color.WHITE

	func _init(k := "coin", px := 22.0) -> void:
		kind = k
		custom_minimum_size = Vector2(px, px)
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		var pip: String = {star = "star", star_off = "star_empty", shield = "shield"}.get(k, "")
		if pip != "":
			# the Pixel Bars pips (16 px), crisp
			var pic := TextureRect.new()
			pic.texture = load("res://addons/pixel_bars/pips/%s.png" % pip)
			pic.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
			pic.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
			pic.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			pic.set_anchors_preset(Control.PRESET_FULL_RECT)
			pic.mouse_filter = Control.MOUSE_FILTER_IGNORE
			add_child(pic)

	func _draw() -> void:
		var s := minf(size.x, size.y)
		var c := size * 0.5
		if get_child_count() > 0:
			return
		match kind:
			"coin":
				draw_circle(c, s * 0.45, Color("#b8801e"))
				draw_circle(c, s * 0.37, Color("#ffd257"))
				draw_circle(c - Vector2(s * 0.08, s * 0.08), s * 0.12, Color(1, 1, 1, 0.5))
			"shield":
				var pts := PackedVector2Array([c + Vector2(-s * 0.38, -s * 0.4), c + Vector2(s * 0.38, -s * 0.4), c + Vector2(s * 0.38, 0), c + Vector2(0, s * 0.45), c + Vector2(-s * 0.38, 0)])
				draw_colored_polygon(pts, Color("#6fb6ff"))
				draw_polyline(pts + PackedVector2Array([pts[0]]), Color("#d8ecff"), 2.0)
			"star", "star_off":
				var pts2 := PackedVector2Array()
				for k in 10:
					var a := -PI / 2 + k * PI / 5
					var r := s * (0.48 if k % 2 == 0 else 0.2)
					pts2.append(c + Vector2(cos(a), sin(a)) * r)
				draw_colored_polygon(pts2, Color("#ffd257") if kind == "star" else Color(1, 1, 1, 0.18))
			"lock":
				draw_rect(Rect2(c + Vector2(-s * 0.3, -s * 0.05), Vector2(s * 0.6, s * 0.45)), DIM)
				draw_arc(c + Vector2(0, -s * 0.08), s * 0.2, PI, TAU, 12, DIM, 3.0)
			"crown":
				var pts3 := PackedVector2Array([c + Vector2(-s * 0.42, s * 0.3), c + Vector2(-s * 0.42, -s * 0.25), c + Vector2(-s * 0.18, 0), c + Vector2(0, -s * 0.38), c + Vector2(s * 0.18, 0), c + Vector2(s * 0.42, -s * 0.25), c + Vector2(s * 0.42, s * 0.3)])
				draw_colored_polygon(pts3, Color("#ff7a5a"))
			"pause":
				draw_rect(Rect2(c + Vector2(-s * 0.28, -s * 0.32), Vector2(s * 0.2, s * 0.64)), tint)
				draw_rect(Rect2(c + Vector2(s * 0.08, -s * 0.32), Vector2(s * 0.2, s * 0.64)), tint)
			"sound":
				var body := PackedVector2Array([c + Vector2(-s * 0.4, -s * 0.15), c + Vector2(-s * 0.15, -s * 0.15), c + Vector2(s * 0.1, -s * 0.38), c + Vector2(s * 0.1, s * 0.38), c + Vector2(-s * 0.15, s * 0.15), c + Vector2(-s * 0.4, s * 0.15)])
				draw_colored_polygon(body, tint)
				if on:
					draw_arc(c + Vector2(s * 0.1, 0), s * 0.22, -0.9, 0.9, 8, tint, 2.0)
					draw_arc(c + Vector2(s * 0.1, 0), s * 0.36, -0.9, 0.9, 8, tint, 2.0)
				else:
					draw_line(c + Vector2(s * 0.22, -s * 0.18), c + Vector2(s * 0.5, s * 0.18), BAD, 3.0)
					draw_line(c + Vector2(s * 0.5, -s * 0.18), c + Vector2(s * 0.22, s * 0.18), BAD, 3.0)


func _ready() -> void:
	layer = 5
	theme = _make_theme()
	root = Control.new()
	root.theme = theme
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	bars = Control.new()
	bars.set_anchors_preset(Control.PRESET_FULL_RECT)
	bars.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bars.draw.connect(_draw_bars)
	bars.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	root.add_child(bars)


func _make_theme() -> Theme:
	var t := Theme.new()
	t.default_font = FONT
	t.default_font_size = 18
	t.set_color("font_color", "Label", FG)
	t.set_constant("outline_size", "Label", 0)
	for state in ["normal", "hover", "pressed", "disabled", "focus"]:
		var s := StyleBoxFlat.new()
		s.set_corner_radius_all(10)
		s.content_margin_left = 16
		s.content_margin_right = 16
		s.content_margin_top = 8
		s.content_margin_bottom = 8
		s.bg_color = {normal = Color("#3a2a1a"), hover = Color("#4d3822"), pressed = Color("#2c2014"), disabled = Color("#2a2119"), focus = Color(0, 0, 0, 0)}[state]
		s.border_color = {normal = LINE, hover = ACCENT, pressed = ACCENT, disabled = Color("#3e3326"), focus = ACCENT}[state]
		s.set_border_width_all(2)
		if state == "focus":
			s.draw_center = false
		s.shadow_color = Color(0, 0, 0, 0.35)
		s.shadow_size = 3 if state != "pressed" else 0
		t.set_stylebox(state, "Button", s)
	t.set_color("font_color", "Button", FG)
	t.set_color("font_hover_color", "Button", Color.WHITE)
	t.set_color("font_pressed_color", "Button", ACCENT)
	t.set_color("font_disabled_color", "Button", Color(0.6, 0.55, 0.48))
	var p := StyleBoxFlat.new()
	p.bg_color = PANEL
	p.set_corner_radius_all(16)
	p.border_color = LINE
	p.set_border_width_all(2)
	p.set_content_margin_all(20)
	p.shadow_color = Color(0, 0, 0, 0.45)
	p.shadow_size = 12
	t.set_stylebox("panel", "PanelContainer", p)
	t.set_constant("separation", "VBoxContainer", 10)
	t.set_constant("separation", "HBoxContainer", 10)
	return t


## ── Builders ──

func nowrap(l: Label) -> Label:
	l.autowrap_mode = TextServer.AUTOWRAP_OFF
	return l


func label(text: String, size := 18, color := FG, align := HORIZONTAL_ALIGNMENT_LEFT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.horizontal_alignment = align
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l


func title(text: String, size := 40) -> Label:
	var l := label(text, size, ACCENT, HORIZONTAL_ALIGNMENT_CENTER)
	l.add_theme_color_override("font_outline_color", Color(0.12, 0.06, 0.02))
	l.add_theme_constant_override("outline_size", 8)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.5))
	l.add_theme_constant_override("shadow_offset_y", 3)
	return l


func button(text: String, cb: Callable, primary := false, size := 20) -> Button:
	var b := Button.new()
	b.text = text
	b.add_theme_font_size_override("font_size", size)
	b.pressed.connect(func():
		main.sfx.play("click")
		cb.call())
	b.focus_mode = Control.FOCUS_NONE
	if primary:
		for state in ["normal", "hover", "pressed"]:
			var s: StyleBoxFlat = theme.get_stylebox(state, "Button").duplicate()
			s.bg_color = {normal = Color("#b8741e"), hover = Color("#d18a2a"), pressed = Color("#94601a")}[state]
			s.border_color = Color("#ffd27a")
			b.add_theme_stylebox_override(state, s)
		b.add_theme_color_override("font_color", Color("#2a1806"))
		b.add_theme_color_override("font_hover_color", Color("#1a0e02"))
		b.add_theme_color_override("font_pressed_color", Color("#2a1806"))
	return b


func panel(min_w := 0.0) -> PanelContainer:
	var p := PanelContainer.new()
	p.custom_minimum_size.x = min_w
	p.mouse_filter = Control.MOUSE_FILTER_STOP
	return p


func vbox(sep := 10) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", sep)
	return v


func hbox(sep := 10) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", sep)
	return h


func pill(icon: String, text: String) -> Array:
	var p := PanelContainer.new()
	var s := StyleBoxFlat.new()
	s.bg_color = Color(0.1, 0.07, 0.05, 0.82)
	s.set_corner_radius_all(16)
	s.border_color = LINE
	s.set_border_width_all(2)
	s.content_margin_left = 8
	s.content_margin_right = 12
	s.content_margin_top = 3
	s.content_margin_bottom = 3
	p.add_theme_stylebox_override("panel", s)
	var h := hbox(6)
	h.add_child(Icon.new(icon, 20))
	var l := label(text, 19)
	l.autowrap_mode = TextServer.AUTOWRAP_OFF
	h.add_child(l)
	p.add_child(h)
	return [p, l]


func stars(n: int, of := 3, px := 22.0) -> HBoxContainer:
	var h := hbox(2)
	for k in of:
		h.add_child(Icon.new("star" if k < n else "star_off", px))
	return h


func _center(c: Control) -> CenterContainer:
	var cc := CenterContainer.new()
	cc.set_anchors_preset(Control.PRESET_FULL_RECT)
	cc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cc.add_child(c)
	return cc


func _dim(alpha := 0.55) -> ColorRect:
	var d := ColorRect.new()
	d.color = Color(0.05, 0.03, 0.02, alpha)
	d.set_anchors_preset(Control.PRESET_FULL_RECT)
	d.mouse_filter = Control.MOUSE_FILTER_STOP
	return d


func _clear_screen() -> void:
	aim_points.clear()
	for n in [screen_box, hud, side, pause_box, banner_box, boss_box, tip, toasts]:
		if is_instance_valid(n):
			n.queue_free()
	screen_box = null
	hud = null
	side = null
	pause_box = null
	banner_box = null
	boss_box = null
	tip = null
	toasts = null


func _screen(c: Control) -> void:
	screen_box = c
	root.add_child(c)


func layout() -> void:
	pass


## The current screen again, in the new language.
func rebuild() -> void:
	match main.screen:
		"menu": show_menu()
		"map": show_map()
		"armory": show_armory()
		"brief": show_brief(main.level_n)
		"play":
			show_play()
			show_pause(main.paused)
		_: refresh()


func refresh() -> void:
	match main.screen:
		"map": show_map()
		"armory": show_armory()
		"play":
			_refresh_hud()
			_refresh_side()


## ── Menu ──

func show_menu() -> void:
	_clear_screen()
	var box := Control.new()
	box.set_anchors_preset(Control.PRESET_FULL_RECT)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var shade := ColorRect.new()
	shade.color = Color(0.05, 0.03, 0.02, 0.25)
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(shade)
	var col := vbox(14)
	col.custom_minimum_size.x = 520
	col.add_child(title(tr("Последняя крепость"), 54))
	col.add_child(label(tr("Монстры идут к стене. Ты — последний лучник. Держись."), 20, FG, HORIZONTAL_ALIGNMENT_CENTER))
	var p := panel(420)
	var v := vbox(12)
	var p_campaign := tr("Кампания") if progress().opened <= 1 and progress().stars.is_empty() else tr("Кампания: уровень {n}").format({n = progress().opened})
	v.add_child(button(p_campaign, main.show_map, true, 24))
	v.add_child(button(tr("Бесконечный режим"), main.start_endless))
	v.add_child(button(tr("Арсенал"), main.show_armory))
	var row := hbox()
	var snd := button(tr("Звук: вкл") if main.sfx.enabled else tr("Звук: выкл"), main.toggle_sound)
	snd.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(snd)
	row.add_child(button("RO" if TranslationServer.get_locale().begins_with("ru") else "RU", main.toggle_lang))
	v.add_child(row)
	var rec := []
	if progress().total_stars() > 0:
		rec.append(tr("Звёзд: {n} из {total}").format({n = progress().total_stars(), total = CastleContent.levels().size() * 3}))
	if progress().endless_best > 0:
		rec.append(tr("Рекорд бесконечного режима: {n}").format({n = progress().endless_best}))
	if progress().finished:
		rec.append(tr("Кампания пройдена"))
	if not rec.is_empty():
		v.add_child(label(" · ".join(rec), 16, DIM, HORIZONTAL_ALIGNMENT_CENTER))
	var credits := label(tr("Графика") + ": Pixel Bars Free by heyheythere (CC BY 4.0) · Avramania (CC0) · Low Poly Winter Pack by reodesuxz", 12, DIM.darkened(0.15), HORIZONTAL_ALIGNMENT_CENTER)
	var how := label(tr("Потяни назад от любой точки поля — стрела полетит в другую сторону; пока держишь, лук стреляет сам. Между волнами выбери улучшение, почини стену и поставь укрепления перед ней. Клавиши: стрелки — угол и сила, Пробел — стрелять, P — пауза."), 15, DIM)
	v.add_child(how)
	v.add_child(credits)
	p.add_child(v)
	col.add_child(p)
	var right := MarginContainer.new()
	right.set_anchors_preset(Control.PRESET_RIGHT_WIDE)
	right.offset_left = -560
	right.add_theme_constant_override("margin_right", 60)
	right.add_theme_constant_override("margin_top", 40)
	right.add_theme_constant_override("margin_bottom", 40)
	var cc := CenterContainer.new()
	cc.add_child(col)
	right.add_child(cc)
	box.add_child(right)
	_screen(box)


func progress() -> CastleProgress:
	return main.progress


## ── Campaign map ──

func show_map() -> void:
	_clear_screen()
	var box := Control.new()
	box.set_anchors_preset(Control.PRESET_FULL_RECT)
	box.add_child(_dim(0.62))
	var m := MarginContainer.new()
	m.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side_name in ["left", "right"]:
		m.add_theme_constant_override("margin_" + side_name, 36)
	m.add_theme_constant_override("margin_top", 18)
	m.add_theme_constant_override("margin_bottom", 18)
	var v := vbox(10)
	var head := hbox(14)
	head.add_child(button(tr("Меню"), main._show_menu))
	var t := nowrap(title(tr("Кампания"), 34))
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(t)
	var st := hbox(4)
	st.add_child(Icon.new("star", 24))
	st.add_child(nowrap(label("%d/%d" % [progress().total_stars(), CastleContent.levels().size() * 3], 20)))
	head.add_child(st)
	head.add_child(pill("coin", tr("Казна: {n}").format({n = progress().treasury}))[0])
	head.add_child(button(tr("Арсенал"), main.show_armory, true))
	v.add_child(head)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var rows := vbox(8)
	rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for r in CastleContent.regions():
		var row := hbox(10)
		var name_box := vbox(0)
		name_box.custom_minimum_size.x = 210
		var rl := label(tr(r.name), 20, REGION_COLORS.get(r.id, ACCENT))
		name_box.add_child(rl)
		name_box.add_child(label(tr("Уровни {a}–{b}").format({a = int(r.levels[0]), b = int(r.levels[1])}), 14, DIM))
		row.add_child(name_box)
		for n in range(int(r.levels[0]), int(r.levels[1]) + 1):
			row.add_child(_level_card(n))
		rows.add_child(row)
	scroll.add_child(rows)
	v.add_child(scroll)
	m.add_child(v)
	box.add_child(m)
	_screen(box)


func _level_card(n: int) -> Control:
	var l := CastleContent.level(n)
	var open: bool = n <= progress().opened
	var b := Button.new()
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(220, 92)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.disabled = not open
	b.clip_text = true
	b.pressed.connect(func():
		main.sfx.play("click")
		main.show_brief(n))
	var v := vbox(2)
	v.set_anchors_preset(Control.PRESET_FULL_RECT)
	v.offset_left = 12
	v.offset_top = 8
	v.offset_right = -10
	v.offset_bottom = -6
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var top := hbox(6)
	top.add_child(nowrap(label(str(n), 22, ACCENT if open else DIM)))
	var is_boss: bool = l.waves[-1].has("boss")
	if is_boss:
		top.add_child(Icon.new("crown", 20))
	if not open:
		top.add_child(Icon.new("lock", 20))
	v.add_child(top)
	var name_l := label(tr(l.name), 15, FG if open else DIM)
	name_l.autowrap_mode = TextServer.AUTOWRAP_OFF
	name_l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	name_l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(name_l)
	var got := int(progress().stars.get(str(n), 0))
	if open:
		v.add_child(stars(got, 3, 16))
	for c in v.get_children():
		c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(v)
	return b


## ── Armory ──

func show_armory() -> void:
	_clear_screen()
	var box := Control.new()
	box.set_anchors_preset(Control.PRESET_FULL_RECT)
	box.add_child(_dim(0.62))
	var p := panel(760)
	var v := vbox(10)
	var head := hbox(14)
	var t := nowrap(title(tr("Арсенал"), 34))
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	head.add_child(t)
	head.add_child(pill("coin", tr("Казна: {n}").format({n = progress().treasury}))[0])
	v.add_child(head)
	v.add_child(label(tr("Навсегда, на все уровни. Золото в казну приносят победы; кампанию можно пройти и без арсенала."), 15, DIM))
	var arm: Dictionary = CastleContent.meta().armory
	for id in arm:
		var a: Dictionary = arm[id]
		var row := hbox(12)
		var info := vbox(0)
		info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		info.add_child(label(tr(a.name), 19))
		info.add_child(label(tr(a.desc), 14, DIM))
		row.add_child(info)
		var pips := hbox(3)
		for k in a.costs.size():
			var dot := ColorRect.new()
			dot.custom_minimum_size = Vector2(14, 14)
			dot.color = ACCENT if k < progress().armory_level(id) else Color(1, 1, 1, 0.15)
			pips.add_child(dot)
		var pc := CenterContainer.new()
		pc.add_child(pips)
		row.add_child(pc)
		var price := progress().armory_price(id)
		var b := button(tr("Максимум") if price < 0 else tr("Купить — {n}").format({n = price}), main.buy_armory.bind(id), price >= 0 and price <= progress().treasury, 17)
		b.custom_minimum_size.x = 170
		b.disabled = price < 0
		row.add_child(b)
		v.add_child(row)
	var back := button(tr("Назад"), func(): main.show_map() if main.sim == null else main._show_menu())
	v.add_child(back)
	p.add_child(v)
	box.add_child(_center(p))
	_screen(box)


## ── Briefing ──

func show_brief(n: int) -> void:
	_clear_screen()
	var l := CastleContent.level(n)
	var box := Control.new()
	box.set_anchors_preset(Control.PRESET_FULL_RECT)
	box.add_child(_dim(0.35))
	var p := panel(620)
	var v := vbox(8)
	var region := CastleContent.region_of(n)
	v.add_child(label(tr("Уровень {n}").format({n = n}) + " · " + tr(region.name), 16, REGION_COLORS.get(region.id, ACCENT), HORIZONTAL_ALIGNMENT_CENTER))
	v.add_child(title(tr(l.name), 38))
	var facts := [tr("Волн: {n}").format({n = l.waves.size()})]
	if int(l.slots) > 0:
		facts.append(tr("мест под укрепления: {n}").format({n = mini(CastleSim.SLOT_X.size(), int(l.slots) + progress().armory_level("slots"))}))
	if int(l.get("prep", 0)) > 0:
		facts.append(tr("улучшений перед боем: {n}").format({n = int(l.prep)}))
	v.add_child(label(", ".join(facts), 17, FG, HORIZONTAL_ALIGNMENT_CENTER))
	var first: Dictionary = main._first_levels()
	var kinds := []
	for w in l.waves:
		for sp in CastleContent.level_wave(w).spawns:
			if not sp.kind in kinds:
				kinds.append(sp.kind)
	var names := []
	for k in kinds:
		if CastleContent.is_boss(k):
			continue
		var nm := tr(main.ENEMY_INFO[k][0])
		if int(first.get(k, 0)) == n:
			nm += " (" + tr("новый") + ")"
		names.append(nm)
	v.add_child(label(tr("Враги: {list}").format({list = ", ".join(names)}), 16, DIM, HORIZONTAL_ALIGNMENT_CENTER))
	for k in kinds:
		if CastleContent.is_boss(k):
			var bl := hbox(8)
			bl.alignment = BoxContainer.ALIGNMENT_CENTER
			bl.add_child(Icon.new("crown", 24))
			bl.add_child(nowrap(label(tr("Босс: {name}").format({name = tr(main.BOSS_INFO[k][0])}), 20, Color("#ff9a7a"))))
			v.add_child(bl)
			v.add_child(label(tr(main.BOSS_INFO[k][1]), 15, DIM, HORIZONTAL_ALIGNMENT_CENTER))
	for type in CastleContent.defenses():
		if int(CastleContent.defenses()[type].unlock) == n:
			v.add_child(label(tr("Новое укрепление: {name} — {desc}").format({name = tr(main.DEFENSE_INFO[type][0]), desc = tr(main.DEFENSE_INFO[type][1])}), 16, GOOD, HORIZONTAL_ALIGNMENT_CENTER))
	var reward := int(l.reward) if not progress().stars.has(str(n)) else int(round(int(l.reward) * CastleProgress.REPLAY_SHARE))
	v.add_child(label(tr("Награда в казну: {n}").format({n = reward}), 16, ACCENT, HORIZONTAL_ALIGNMENT_CENTER))
	var row := hbox(12)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_child(button(tr("К карте"), main.show_map))
	row.add_child(button(tr("В бой"), main.start_level.bind(n), true, 24))
	v.add_child(row)
	p.add_child(v)
	box.add_child(_center(p))
	_screen(box)


## ── The level ──

func show_play() -> void:
	_clear_screen()
	hud = MarginContainer.new()
	hud.set_anchors_preset(Control.PRESET_TOP_WIDE)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for s in ["left", "right", "top"]:
		hud.add_theme_constant_override("margin_" + s, 14)
	var row := hbox(10)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var lv := vbox(0)
	hud_level = label("", 16, DIM)
	hud_level.autowrap_mode = TextServer.AUTOWRAP_OFF
	hud_wave = label("", 22, FG)
	hud_wave.autowrap_mode = TextServer.AUTOWRAP_OFF
	hud_wave.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
	hud_wave.add_theme_constant_override("outline_size", 5)
	hud_level.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
	hud_level.add_theme_constant_override("outline_size", 4)
	lv.add_child(hud_level)
	lv.add_child(hud_wave)
	row.add_child(lv)
	var wall := PixelBox.new(PixelBar.Shape.BAR, Vector2(216, 36), FONT)
	wall.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	hud_wall = wall
	row.add_child(wall)
	var g := pill("coin", "0")
	hud_gold = g[1]
	row.add_child(g[0])
	var w := pill("shield", "1")
	hud_ward = w[1]
	hud_ward_box = w[0]
	hud_ward_box.tooltip_text = tr("Оберег от летунов")
	row.add_child(w[0])
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	spacer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(spacer)
	btn_pause = _icon_button("pause", func(): main.set_paused(not main.paused))
	btn_pause.tooltip_text = tr("Пауза")
	row.add_child(btn_pause)
	btn_sound = _icon_button("sound", main.toggle_sound)
	row.add_child(btn_sound)
	hud.add_child(row)
	root.add_child(hud)
	# the boss bar, under the HUD in the middle
	boss_box = vbox(2)
	boss_box.set_anchors_preset(Control.PRESET_CENTER_TOP)
	boss_box.offset_left = -270
	boss_box.offset_right = 270
	boss_box.offset_top = 64
	boss_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	boss_name = label("", 20, Color("#ffb09a"), HORIZONTAL_ALIGNMENT_CENTER)
	boss_name.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	boss_name.add_theme_constant_override("outline_size", 6)
	boss_box.add_child(boss_name)
	var bb := PixelBox.new(PixelBar.Shape.BOSS, Vector2(540, 48), FONT)
	bb.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	boss_bar = bb
	boss_box.add_child(bb)
	boss_hint = label("", 16, ACCENT, HORIZONTAL_ALIGNMENT_CENTER)
	boss_hint.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	boss_hint.add_theme_constant_override("outline_size", 5)
	boss_box.add_child(boss_hint)
	boss_box.visible = false
	root.add_child(boss_box)
	toasts = vbox(6)
	toasts.set_anchors_preset(Control.PRESET_CENTER_TOP)
	toasts.offset_left = -300
	toasts.offset_right = 300
	toasts.offset_top = 140
	toasts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(toasts)
	banner_box = panel(520)
	banner_box.set_anchors_preset(Control.PRESET_CENTER)
	banner_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var bv := vbox(4)
	banner_title = title("", 30)
	banner_text = label("", 17, FG, HORIZONTAL_ALIGNMENT_CENTER)
	bv.add_child(banner_title)
	bv.add_child(banner_text)
	banner_box.add_child(bv)
	banner_box.visible = false
	root.add_child(banner_box)
	if main.sim.mode == "level" and main.sim.level_n == 1:
		tip = label(tr("Потяни назад и держи, чтобы стрелять"), 20, FG, HORIZONTAL_ALIGNMENT_CENTER)
		tip.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
		tip.offset_top = -120
		tip.offset_left = -300
		tip.offset_right = 300
		tip.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
		tip.add_theme_constant_override("outline_size", 8)
		tip.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.add_child(tip)
	_refresh_hud()
	_refresh_side()


func _icon_button(kind: String, cb: Callable) -> Button:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(48, 44)
	var cc := CenterContainer.new()
	cc.set_anchors_preset(Control.PRESET_FULL_RECT)
	cc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ic := Icon.new(kind, 26)
	ic.name = "Icon"
	ic.tint = FG
	cc.add_child(ic)
	b.add_child(cc)
	b.pressed.connect(func():
		main.sfx.play("click")
		cb.call())
	return b


func tip_visible() -> bool:
	return is_instance_valid(tip) and tip.visible


func hide_tip() -> void:
	if is_instance_valid(tip):
		tip.visible = false


func _refresh_hud() -> void:
	var s: CastleSim = main.sim
	if s == null or hud == null:
		return
	if s.mode == "level":
		hud_level.text = tr("Уровень {n}").format({n = s.level_n}) + " · " + tr(s.level.name)
		hud_wave.text = tr("Волна {n}/{total}").format({n = maxi(1, s.wave), total = s.waves_total})
	else:
		hud_level.text = tr("Бесконечный режим") + " · " + tr("Счёт: {n}").format({n = s.score()})
		hud_wave.text = tr("Волна {n}").format({n = maxi(1, s.wave)})
	hud_gold.text = str(s.gold)
	hud_ward.text = str(s.ward)
	var ic: Icon = btn_sound.get_child(0).get_node("Icon")
	ic.on = main.sfx.enabled
	ic.queue_redraw()


func update_play(delta: float) -> void:
	_t += delta
	var s: CastleSim = main.sim
	if s == null or hud == null:
		return
	var wb: PixelBox = hud_wall
	wb.value = s.wall_hp / s.wall_max
	wb.text = "%d/%d" % [ceili(s.wall_hp), roundi(s.wall_max)]
	hud_gold.text = str(s.gold)
	hud_ward.text = str(s.ward)
	if s.mode == "endless":
		hud_level.text = tr("Бесконечный режим") + " · " + tr("Счёт: {n}").format({n = s.score()})
	# the boss
	var b := s.boss()
	boss_box.visible = b != null
	if b:
		var th: Array = CastleContent.bosses()[b.kind].phases
		boss_name.text = tr(main.BOSS_INFO[b.kind][0]) + ("  ·  " + tr("Фаза {n}").format({n = b.phase}) if th.size() > 0 else "")
		var bb: PixelBox = boss_bar
		bb.value = clampf(b.frac(), 0.0, 1.0)
		# the fill tells the state: red as usual, green while open to a hit, blue behind a shield
		if b.vulnerable > 0.0:
			boss_hint.text = tr("Уязвим — бей!")
			boss_hint.add_theme_color_override("font_color", GOOD)
			bb.fill = "stamina"
		elif b.immune > 0.0:
			boss_hint.text = tr("Неуязвим")
			boss_hint.add_theme_color_override("font_color", DIM)
			bb.fill = "mana"
		elif b.barrier:
			boss_hint.text = tr("Барьер: убей свиту короля")
			boss_hint.add_theme_color_override("font_color", Color("#c9a0ff"))
			bb.fill = "mana"
		else:
			boss_hint.text = ""
			bb.fill = "health"
	# the banner
	if banner_box and banner_box.visible:
		_banner_t -= delta
		banner_box.modulate.a = clampf(_banner_t / 0.5, 0.0, 1.0)
		if _banner_t <= 0.0:
			banner_box.visible = false
	bars.queue_redraw()


## Health bars over wounded enemies (bosses have their own bar at the top).
func _draw_bars() -> void:
	_draw_aim()
	_draw_health()


## The aim preview: dots along the flight, big and bright near the bow, smaller further on, each with a dark
## rim so they show on a pale sky and on snow; a ring where the arrow will land.
func _draw_aim() -> void:
	var n := aim_points.size()
	if n == 0:
		return
	var last := n - 1 if aim_lands else n
	for i in last:
		var f := float(i) / maxf(1.0, n - 1)
		var r := lerpf(5.5, 3.0, f)
		var a := lerpf(1.0, 0.55, f)
		var p := aim_points[i]
		bars.draw_circle(p, r + 1.8, Color(0.12, 0.07, 0.03, 0.75 * a))
		bars.draw_circle(p, r, Color(1.0, 0.95, 0.75, a))
	if aim_lands:
		var p := aim_points[n - 1]
		bars.draw_arc(p, 9.0, 0, TAU, 24, Color(0.12, 0.07, 0.03, 0.8), 5.0)
		bars.draw_arc(p, 9.0, 0, TAU, 24, Color(1.0, 0.82, 0.35), 2.5)
		bars.draw_circle(p, 2.5, Color(1.0, 0.82, 0.35))


func _draw_health() -> void:
	var s: CastleSim = main.sim
	if s == null or main.screen != "play" or main.units == null:
		return
	for e in s.enemies:
		if e.boss or e.hp >= e.max_hp - 1e-6 or e.dead:
			continue
		var a: Vector3 = main.units.anchor(e.id)
		if a == Vector3.INF:
			continue
		var p: Vector2 = main.world.to_screen(a)
		# the Pixel Bars thin bar at twice its pixels: a wooden frame and the red fill over its track
		var w := roundf(clampf(e.w * 11.0, 11.0, 23.0))
		bars.draw_set_transform(Vector2(roundf(p.x - w), roundf(p.y - 16)), 0.0, Vector2(2, 2))
		bars.draw_style_box(_thin("frames/wood"), Rect2(0, 0, w, 7))
		var inner := 1.0 + clampf(e.frac(), 0.0, 1.0) * (w - 2.0)
		if inner > 1.5:
			bars.draw_style_box(_thin("fills/health"), Rect2(0, 0, inner + 1.0, 7))
	bars.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


static var _thin_boxes := {}


## A thin bar piece as a 9-slice (the pack's 2 px margins), for the enemies' health over the field.
static func _thin(dir: String) -> StyleBoxTexture:
	if not _thin_boxes.has(dir):
		var sb := StyleBoxTexture.new()
		sb.texture = load("res://addons/pixel_bars/%s/thin.png" % dir)
		sb.set_texture_margin_all(2)
		sb.axis_stretch_horizontal = StyleBoxTexture.AXIS_STRETCH_MODE_STRETCH
		_thin_boxes[dir] = sb
	return _thin_boxes[dir]


func toast(text: String, color := FG, dur := 2.0) -> void:
	if toasts == null:
		return
	for c in toasts.get_children():
		if c is Label and c.text == text:
			return
	var l := label(text, 22, color, HORIZONTAL_ALIGNMENT_CENTER)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	l.add_theme_constant_override("outline_size", 7)
	toasts.add_child(l)
	if toasts.get_child_count() > 3:
		toasts.get_child(0).queue_free()
	var tw := l.create_tween()
	tw.tween_interval(dur)
	tw.tween_property(l, "modulate:a", 0.0, 0.4)
	tw.tween_callback(l.queue_free)


func banner(head: String, text: String) -> void:
	if banner_box == null:
		return
	banner_title.text = head
	banner_text.text = text
	banner_box.visible = true
	banner_box.modulate.a = 1.0
	banner_box.reset_size()
	banner_box.position = (root.size - banner_box.size) * Vector2(0.5, 0.36)
	_banner_t = 3.4


## ── Between waves ──

func _refresh_side() -> void:
	var s: CastleSim = main.sim
	if is_instance_valid(side):
		side.queue_free()
		side = null
	if s == null or not (s.status in ["ready", "between"]) or main.screen != "play":
		return
	side = panel(380)
	side.set_anchors_preset(Control.PRESET_RIGHT_WIDE)
	side.offset_left = -400
	side.offset_right = -12
	side.offset_top = 70
	side.offset_bottom = -12
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var v := vbox(9)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if s.status == "ready":
		v.add_child(title(tr("Подготовка"), 28))
	else:
		v.add_child(title(tr("Волна {n} отбита!").format({n = s.wave}), 28))
	v.add_child(label(tr("Золото: {gold}. Стена: {hp} из {max}.").format({gold = s.gold, hp = ceili(s.wall_hp), max = roundi(s.wall_max)}), 16, DIM))
	# cards
	if not s.offer.is_empty() and (s.prep_left > 0 or (s.status == "between" and not s.picked)):
		var head := tr("Выбери улучшение") if s.prep_left <= 1 else tr("Выбери улучшения: ещё {n}").format({n = s.prep_left})
		v.add_child(label(head, 18, ACCENT))
		for id in s.offer:
			var c: Dictionary = CastleContent.meta().cards[id]
			var b := button("%s\n%s" % [tr(c.name), tr(c.desc)], main.choose_card.bind(id), false, 16)
			b.alignment = HORIZONTAL_ALIGNMENT_LEFT
			v.add_child(b)
	# the wall
	v.add_child(label(tr("Стена"), 18, ACCENT))
	var wr := hbox(8)
	var rep := button(tr("Починить +25% — {p} зол.").format({p = s.price_of("repair")}), main.buy.bind("repair"), false, 15)
	rep.disabled = s.wall_hp >= s.wall_max or s.gold < s.price_of("repair")
	rep.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var fort := button(tr("Укрепить +20% — {p} зол.").format({p = s.price_of("fortify")}), main.buy.bind("fortify"), false, 15)
	fort.disabled = s.gold < s.price_of("fortify")
	fort.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rep.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	fort.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	wr.add_child(rep)
	wr.add_child(fort)
	v.add_child(wr)
	# defences
	if s.slots > 0:
		v.add_child(label(tr("Укрепления"), 18, ACCENT))
		var grid := GridContainer.new()
		grid.columns = 2
		grid.add_theme_constant_override("h_separation", 8)
		grid.add_theme_constant_override("v_separation", 8)
		for type in CastleContent.defenses():
			var c: Dictionary = CastleContent.defenses()[type]
			var unlocked := s.defense_unlocked(type)
			var txt := "%s — %d" % [tr(main.DEFENSE_INFO[type][0]), int(c.cost)] if unlocked else tr("С уровня {n}").format({n = int(c.unlock)})
			var b := button(txt, main.select_build.bind(type), main._build_type == type, 15)
			b.disabled = not unlocked
			b.tooltip_text = tr(main.DEFENSE_INFO[type][1])
			b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			grid.add_child(b)
		var dem := button(tr("Снести (½ цены)"), main.select_build.bind("demolish"), main._build_type == "demolish", 15)
		dem.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		grid.add_child(dem)
		v.add_child(grid)
		var hint := tr("Выбери укрепление и нажми на место перед стеной.") if main._build_type == "" else (tr("Нажми на укрепление, чтобы снести.") if main._build_type == "demolish" else tr(main.DEFENSE_INFO[main._build_type][1]))
		v.add_child(label(hint, 14, DIM))
		var fp := s.fix_price()
		if fp > 0:
			var fixb := button(tr("Починить укрепления — {p} зол.").format({p = fp}), main.fix_defenses, false, 15)
			fixb.disabled = s.gold < fp
			v.add_child(fixb)
	var bottom := hbox(8)
	bottom.add_child(button(tr("Меню"), func(): main.set_paused(true)))
	var go := button(tr("В бой"), main.fight, true, 24)
	go.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	go.disabled = s.prep_left > 0
	bottom.add_child(go)
	v.add_child(bottom)
	scroll.add_child(v)
	side.add_child(scroll)
	root.add_child(side)


## ── Pause and result ──

func show_pause(on: bool) -> void:
	if is_instance_valid(pause_box):
		pause_box.queue_free()
		pause_box = null
	if not on:
		return
	pause_box = Control.new()
	pause_box.set_anchors_preset(Control.PRESET_FULL_RECT)
	pause_box.add_child(_dim(0.5))
	var p := panel(380)
	var v := vbox(12)
	v.add_child(title(tr("Пауза"), 36))
	v.add_child(button(tr("Продолжить"), func(): main.set_paused(false), true, 22))
	v.add_child(button(tr("Начать заново"), main.restart))
	v.add_child(button(tr("К карте") if main.sim and main.sim.mode == "level" else tr("Меню"), func(): main.show_map() if main.sim.mode == "level" else main._show_menu()))
	v.add_child(button(tr("Звук: вкл") if main.sfx.enabled else tr("Звук: выкл"), func():
		main.toggle_sound()
		show_pause(true)))
	p.add_child(v)
	pause_box.add_child(_center(p))
	root.add_child(pause_box)


func show_result(r: Dictionary) -> void:
	if is_instance_valid(side):
		side.queue_free()
	if boss_box:
		boss_box.visible = false
	var box := Control.new()
	box.set_anchors_preset(Control.PRESET_FULL_RECT)
	box.add_child(_dim(0.25 if r.get("final", false) else 0.45))
	var p := panel(560)
	var v := vbox(10)
	var s: CastleSim = main.sim
	if r.get("final", false):
		v.add_child(title(tr("Королевство спасено!"), 44))
		v.add_child(label(tr("Тёмный король повержен, цитадель пала. Последняя крепость выстояла."), 18, FG, HORIZONTAL_ALIGNMENT_CENTER))
	elif r.get("won", false):
		v.add_child(title(tr("Победа!"), 44))
	else:
		v.add_child(title(tr("Стена пала"), 44))
	if r.get("won", false):
		var sr := stars(int(r.stars), 3, 44)
		sr.alignment = BoxContainer.ALIGNMENT_CENTER
		v.add_child(sr)
		v.add_child(label(tr("В казну: +{n} золота").format({n = r.gold}), 20, ACCENT, HORIZONTAL_ALIGNMENT_CENTER))
		if int(r.get("opened", 0)) > 0:
			var nl := CastleContent.level(int(r.opened))
			v.add_child(label(tr("Открыт уровень {n}: {name}").format({n = int(r.opened), name = tr(nl.name)}), 18, GOOD, HORIZONTAL_ALIGNMENT_CENTER))
			if CastleContent.region_of(int(r.opened)).id != CastleContent.region_of(s.level_n).id:
				v.add_child(label(tr("Новая земля: {name}").format({name = tr(CastleContent.region_of(int(r.opened)).name)}), 18, REGION_COLORS.get(CastleContent.region_of(int(r.opened)).id, GOOD), HORIZONTAL_ALIGNMENT_CENTER))
			for type in CastleContent.defenses():
				if int(CastleContent.defenses()[type].unlock) == int(r.opened):
					v.add_child(label(tr("Новое укрепление: {name}").format({name = tr(main.DEFENSE_INFO[type][0])}), 18, GOOD, HORIZONTAL_ALIGNMENT_CENTER))
	elif r.get("endless", false):
		v.add_child(label(tr("Волна {n}, врагов повержено: {k}.").format({n = s.wave, k = s.kills}), 18, FG, HORIZONTAL_ALIGNMENT_CENTER))
		v.add_child(label(tr("Счёт: {n}").format({n = r.score}) + "  ·  " + tr("Рекорд: {n}").format({n = progress().endless_best}), 20, ACCENT, HORIZONTAL_ALIGNMENT_CENTER))
		if r.better:
			v.add_child(label(tr("Новый рекорд!"), 20, GOOD, HORIZONTAL_ALIGNMENT_CENTER))
	else:
		v.add_child(label(tr("Волна {n} из {total}. Попробуй поставить укрепления иначе или загляни в арсенал.").format({n = s.wave, total = s.waves_total}), 17, DIM, HORIZONTAL_ALIGNMENT_CENTER))
	var row := hbox(10)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	if s.mode == "level":
		row.add_child(button(tr("К карте"), main.show_map))
		row.add_child(button(tr("Ещё раз"), main.restart, not r.get("won", false)))
		if r.get("won", false) and not r.get("final", false):
			row.add_child(button(tr("Дальше"), main.next_level, true, 22))
		if r.get("final", false):
			row.add_child(button(tr("Бесконечный режим"), main.start_endless, true))
	else:
		row.add_child(button(tr("Меню"), main._show_menu))
		row.add_child(button(tr("Ещё раз"), main.restart, true))
	v.add_child(row)
	p.add_child(v)
	box.add_child(_center(p))
	if r.get("final", false):
		box.modulate.a = 0.0
		box.create_tween().tween_property(box, "modulate:a", 1.0, 1.2).set_delay(2.0)
	_screen(box)


## Slingshot aim from a pull in canvas px (screen y grows down): the arrow flies opposite to the pull,
## as web/castle/view.js. → Vector2(angle, power) or null for a pull too short to mean anything.
static func aim_from_drag(d: Vector2):
	var len := d.length()
	if len < DEAD_DRAG:
		return null
	var fx := maxf(0.0, -d.x)
	var angle := clampf(atan2(d.y, fx), CastleSim.ANGLE_MIN, CastleSim.ANGLE_MAX)
	var power := clampf(len / FULL_DRAG, CastleSim.MIN_POWER, 1.0)
	return Vector2(angle, power)
