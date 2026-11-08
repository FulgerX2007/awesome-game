class_name UiTheme
extends RefCounted
## The interface's look, taken from web/rust/style.css: dusk panels, rust titles, one body font
## (Golos Text, OFL) and the same accent colours as the scene.

const BG := Color("171223")
const PANEL := Color("211a30")
const PANEL_2 := Color("2b223d")
const LINE := Color("3d3152")
const FG := Color("f1e7dc")
const DIM := Color("a698b1")
const RUST := Color("e2733d")
const RUST_DEEP := Color("a9472a")
const VERDIGRIS := Color("5fc7a9")
const LAMP := Color("f3c24f")
const CORE := Color("8fd3ff")
const DANGER := Color("ff6b6b")

static var _theme: Theme
static var font: Font
static var bold: FontVariation
static var title: FontVariation


static func box(bg: Color, border := Color.TRANSPARENT, radius := 10, pad := 10, bw := 1) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.set_border_width_all(bw if border.a > 0.0 else 0)
	s.set_corner_radius_all(radius)
	s.content_margin_left = pad
	s.content_margin_right = pad
	s.content_margin_top = pad * 0.7
	s.content_margin_bottom = pad * 0.7
	s.anti_aliasing = true
	return s


static func get_theme() -> Theme:
	if _theme:
		return _theme
	font = load("res://assets/fonts/GolosText.ttf")
	bold = FontVariation.new()
	bold.base_font = font
	bold.variation_embolden = 0.6
	title = FontVariation.new()
	title.base_font = font
	title.variation_embolden = 1.1
	title.spacing_glyph = 1
	var t := Theme.new()
	t.default_font = font
	t.default_font_size = 15
	t.set_color("font_color", "Label", FG)
	t.set_stylebox("panel", "PanelContainer", box(PANEL, LINE, 12, 14))
	t.set_stylebox("panel", "Panel", box(PANEL, LINE, 12, 14))
	# buttons
	t.set_stylebox("normal", "Button", box(PANEL_2, LINE, 8, 10))
	t.set_stylebox("hover", "Button", box(PANEL_2.lightened(0.08), LAMP.darkened(0.3), 8, 10))
	t.set_stylebox("pressed", "Button", box(PANEL_2.darkened(0.15), LAMP, 8, 10))
	t.set_stylebox("disabled", "Button", box(PANEL_2.darkened(0.25), LINE.darkened(0.2), 8, 10))
	t.set_stylebox("focus", "Button", box(Color.TRANSPARENT, LAMP, 8, 10, 2))
	t.set_color("font_color", "Button", FG)
	t.set_color("font_hover_color", "Button", Color.WHITE)
	t.set_color("font_disabled_color", "Button", DIM.darkened(0.25))
	t.set_color("font_pressed_color", "Button", LAMP)
	t.set_font("font", "Button", bold)
	# tooltips
	t.set_stylebox("panel", "TooltipPanel", box(Color("120e1b"), LAMP.darkened(0.4), 8, 10))
	t.set_color("font_color", "TooltipLabel", FG)
	t.set_font_size("font_size", "TooltipLabel", 14)
	# progress bars
	t.set_stylebox("background", "ProgressBar", box(Color("120e1b"), Color.TRANSPARENT, 4, 0))
	t.set_stylebox("fill", "ProgressBar", box(LAMP, Color.TRANSPARENT, 4, 0))
	t.set_constant("outline_size", "ProgressBar", 0)
	# check boxes and option buttons
	t.set_color("font_color", "CheckBox", DIM)
	t.set_color("font_hover_color", "CheckBox", FG)
	t.set_stylebox("normal", "CheckBox", StyleBoxEmpty.new())
	t.set_stylebox("hover", "CheckBox", StyleBoxEmpty.new())
	t.set_stylebox("pressed", "CheckBox", StyleBoxEmpty.new())
	t.set_stylebox("focus", "CheckBox", StyleBoxEmpty.new())
	t.set_stylebox("normal", "OptionButton", box(PANEL_2, LINE, 8, 8))
	t.set_stylebox("hover", "OptionButton", box(PANEL_2.lightened(0.08), LAMP.darkened(0.3), 8, 8))
	t.set_stylebox("pressed", "OptionButton", box(PANEL_2, LAMP, 8, 8))
	t.set_stylebox("focus", "OptionButton", box(Color.TRANSPARENT, LAMP, 8, 8, 2))
	t.set_stylebox("panel", "PopupMenu", box(Color("120e1b"), LINE, 8, 6))
	# scroll bars: thin
	var grab := box(LINE, Color.TRANSPARENT, 4, 0)
	t.set_stylebox("grabber", "VScrollBar", grab)
	t.set_stylebox("grabber_highlight", "VScrollBar", box(DIM.darkened(0.3), Color.TRANSPARENT, 4, 0))
	t.set_stylebox("grabber_pressed", "VScrollBar", box(DIM, Color.TRANSPARENT, 4, 0))
	t.set_stylebox("scroll", "VScrollBar", box(Color(0, 0, 0, 0.15), Color.TRANSPARENT, 4, 0))
	_theme = t
	return t


static func lbl(text: String, size := 15, color := FG, f: Font = null) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if f:
		l.add_theme_font_override("font", f)
	return l


static func heading(text: String) -> Label:
	var l := lbl(text, 19, RUST, title)
	return l


## A small round dot in a resource's colour, used as its icon.
static func dot(color: Color, size := 12) -> Panel:
	var p := Panel.new()
	p.custom_minimum_size = Vector2(size, size)
	p.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var s := box(color, color.lightened(0.3), size / 2, 0)
	s.shadow_color = Color(color, 0.5)
	s.shadow_size = 4
	p.add_theme_stylebox_override("panel", s)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return p


static func bar(color: Color, height := 6) -> ProgressBar:
	var b := ProgressBar.new()
	b.show_percentage = false
	b.custom_minimum_size = Vector2(0, height)
	b.max_value = 1.0
	b.step = 0.0
	b.add_theme_stylebox_override("fill", box(color, Color.TRANSPARENT, 3, 0))
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return b
