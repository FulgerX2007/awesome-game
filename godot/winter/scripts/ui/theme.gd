class_name WinterTheme
extends RefCounted
## The look of every control: the Golos Text font, frosted dark-navy glass panels with an icy rim, buttons with
## hover / pressed / disabled states and an amber accent for the main action. Nine-slice textures from the UI kit
## (assets/manifest/ui.json) are used when they exist; otherwise flat styles in the same colours stand in.

const INK := Color("eaf2ff")
const DIM := Color("9fb0cc")
const PANEL := Color("1a2338")
const PANEL_HI := Color("2a3755")
const LINE := Color("46577e")
const FROST := Color("cfe6ff")
const WARM := Color("ffb35a")
const GOOD := Color("7fd18b")
const BAD := Color("ff6b5e")
const WARN := Color("ffcc4d")
const STAT := {"health": Color("ff5f6d"), "warmth": Color("ff9a3c"), "food": Color("f0c24a"), "energy": Color("6fd0ff")}

static var font: Font
static var font_bold: FontVariation


static func build() -> Theme:
	font = load("res://assets/fonts/GolosText.ttf")
	font_bold = FontVariation.new()
	font_bold.base_font = font
	font_bold.variation_embolden = 0.6
	var t := Theme.new()
	t.default_font = font
	t.default_font_size = 18
	t.set_color("font_color", "Label", INK)
	t.set_color("font_shadow_color", "Label", Color(0.02, 0.03, 0.08, 0.6))
	t.set_constant("shadow_offset_x", "Label", 0)
	t.set_constant("shadow_offset_y", "Label", 2)
	t.set_constant("shadow_outline_size", "Label", 4)
	t.set_stylebox("panel", "PanelContainer", panel_style())
	t.set_stylebox("panel", "Panel", panel_style())
	for s in ["normal", "hover", "pressed", "disabled", "focus"]:
		t.set_stylebox(s, "Button", button_style(s))
	t.set_color("font_color", "Button", INK)
	t.set_color("font_hover_color", "Button", Color.WHITE)
	t.set_color("font_pressed_color", "Button", Color("fff2dc"))
	t.set_color("font_disabled_color", "Button", Color(0.62, 0.68, 0.8, 0.55))
	t.set_color("font_focus_color", "Button", Color.WHITE)
	t.set_color("icon_disabled_color", "Button", Color(1, 1, 1, 0.35))
	t.set_constant("h_separation", "Button", 10)
	t.set_constant("icon_max_width", "Button", 40)
	t.set_font_size("font_size", "Button", 18)
	t.set_type_variation("AccentButton", "Button")
	for s in ["normal", "hover", "pressed"]:
		t.set_stylebox(s, "AccentButton", button_style(s, true))
	t.set_color("font_color", "AccentButton", Color("2a1606"))
	t.set_color("font_hover_color", "AccentButton", Color("1a0d02"))
	t.set_color("font_pressed_color", "AccentButton", Color("1a0d02"))
	t.set_type_variation("Title", "Label")
	t.set_font("font", "Title", font_bold)
	t.set_font_size("font_size", "Title", 30)
	t.set_color("font_color", "Title", FROST)
	t.set_type_variation("Small", "Label")
	t.set_font_size("font_size", "Small", 14)
	t.set_color("font_color", "Small", DIM)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.6, 0.75, 1.0, 0.25)
	sb.set_corner_radius_all(3)
	t.set_stylebox("grabber_area", "VScrollBar", sb)
	t.set_stylebox("grabber", "VScrollBar", sb)
	var sb2 := StyleBoxEmpty.new()
	t.set_stylebox("scroll", "VScrollBar", sb2)
	t.set_stylebox("panel", "ScrollContainer", sb2)
	t.set_stylebox("panel", "TooltipPanel", tooltip_style())
	t.set_color("font_color", "TooltipLabel", INK)
	return t


static func _nine(key: String, margins_fallback := 18) -> StyleBoxTexture:
	if not WinterArt.has(key):
		return null
	var s := StyleBoxTexture.new()
	s.texture = WinterArt.texture(key, false)
	var sl := WinterArt.slice(key)
	var m: Array = sl if sl.size() == 4 else [margins_fallback, margins_fallback, margins_fallback, margins_fallback]
	s.texture_margin_left = m[0]
	s.texture_margin_top = m[1]
	s.texture_margin_right = m[2]
	s.texture_margin_bottom = m[3]
	return s


static func panel_style(dark := false) -> StyleBox:
	var s = _nine("ui.panel.dark" if dark else "ui.panel")
	if s:
		s.content_margin_left = 22
		s.content_margin_right = 22
		s.content_margin_top = 18
		s.content_margin_bottom = 18
		return s
	var f := StyleBoxFlat.new()
	f.bg_color = Color(PANEL, 0.9 if not dark else 0.95)
	f.border_color = Color(FROST, 0.35)
	f.set_border_width_all(2)
	f.set_corner_radius_all(16)
	f.shadow_color = Color(0, 0, 0.05, 0.45)
	f.shadow_size = 14
	f.shadow_offset = Vector2(0, 5)
	f.content_margin_left = 22
	f.content_margin_right = 22
	f.content_margin_top = 18
	f.content_margin_bottom = 18
	return f


static func button_style(state: String, accent := false) -> StyleBox:
	if not accent:
		var key = {"normal": "ui.button", "hover": "ui.button.hover", "pressed": "ui.button.pressed", "disabled": "ui.button.disabled", "focus": "ui.button.hover"}[state]
		var s = _nine(key, 14)
		if s:
			s.content_margin_left = 16
			s.content_margin_right = 16
			s.content_margin_top = 8
			s.content_margin_bottom = 8
			if state == "focus":
				s.modulate_color = Color(1, 1, 1, 0.0)
			return s
	var f := StyleBoxFlat.new()
	f.set_corner_radius_all(12)
	f.set_border_width_all(2)
	f.content_margin_left = 16
	f.content_margin_right = 16
	f.content_margin_top = 8
	f.content_margin_bottom = 8
	if accent:
		f.bg_color = {"normal": WARM, "hover": Color("ffc678"), "pressed": Color("e0913a")}.get(state, WARM)
		f.border_color = Color("ffe0b0")
		f.shadow_color = Color(1.0, 0.6, 0.2, 0.35)
		f.shadow_size = 10
		return f
	match state:
		"normal":
			f.bg_color = Color(PANEL_HI, 0.92)
			f.border_color = Color(FROST, 0.3)
		"hover":
			f.bg_color = Color("34456a")
			f.border_color = Color(FROST, 0.7)
			f.shadow_color = Color(0.6, 0.8, 1.0, 0.25)
			f.shadow_size = 8
		"pressed":
			f.bg_color = Color("1e2a44")
			f.border_color = Color(WARM, 0.8)
		"disabled":
			f.bg_color = Color(PANEL, 0.7)
			f.border_color = Color(LINE, 0.5)
		"focus":
			f.bg_color = Color(0, 0, 0, 0)
			f.border_color = Color(FROST, 0.8)
			f.draw_center = false
	return f


static func tooltip_style() -> StyleBox:
	var s = _nine("ui.tooltip", 10)
	if s:
		return s
	var f := StyleBoxFlat.new()
	f.bg_color = Color(0.06, 0.08, 0.14, 0.95)
	f.border_color = Color(FROST, 0.4)
	f.set_border_width_all(1)
	f.set_corner_radius_all(8)
	f.content_margin_left = 10
	f.content_margin_right = 10
	f.content_margin_top = 6
	f.content_margin_bottom = 6
	return f


## An icon from the UI kit (or a soft placeholder disc).
static func icon(id: String) -> Texture2D:
	return WinterArt.texture("ui.icon." + id, false)
