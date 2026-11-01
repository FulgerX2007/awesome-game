class_name UiTheme
extends RefCounted
## The one theme of the game: big rounded buttons, a friendly font, high contrast. "Large text" scales it up.
## Type variations: AnswerButton (the number buttons), PrimaryButton (green), Card (a white panel), Title.

const INK := Color("#23304a")
const BLUE := Color("#2b7de9")
const GREEN := Color("#2fbf71")
const ORANGE := Color("#ff9f1c")
const SOFT := Color("#f3f8ff")


static func make(large := false) -> Theme:
	var k := 1.2 if large else 1.0
	var t := Theme.new()
	t.default_font = Art.font()
	t.default_font_size = int(28 * k)
	t.set_color("font_color", "Label", INK)
	t.set_constant("outline_size", "Label", 0)

	_button(t, "Button", Color.WHITE, BLUE, int(30 * k))
	t.add_type("AnswerButton")
	t.set_type_variation("AnswerButton", "Button")
	_button(t, "AnswerButton", Color.WHITE, BLUE, int(60 * k), 6)
	t.add_type("PrimaryButton")
	t.set_type_variation("PrimaryButton", "Button")
	_button(t, "PrimaryButton", GREEN, Color("#1e8f52"), int(34 * k))
	t.set_color("font_color", "PrimaryButton", Color.WHITE)
	t.set_color("font_hover_color", "PrimaryButton", Color.WHITE)
	t.set_color("font_pressed_color", "PrimaryButton", Color.WHITE)
	t.set_color("font_focus_color", "PrimaryButton", Color.WHITE)

	var card := StyleBoxFlat.new()
	card.bg_color = Color(1, 1, 1, 0.96)
	card.set_corner_radius_all(26)
	card.set_content_margin_all(24 * k)
	card.shadow_color = Color(0, 0.1, 0.3, 0.25)
	card.shadow_size = 12
	t.add_type("Card")
	t.set_type_variation("Card", "PanelContainer")
	t.set_stylebox("panel", "Card", card)
	t.set_stylebox("panel", "PanelContainer", card)

	t.add_type("Title")
	t.set_type_variation("Title", "Label")
	t.set_font_size("font_size", "Title", int(54 * k))
	t.set_color("font_color", "Title", INK)
	t.add_type("Big")
	t.set_type_variation("Big", "Label")
	t.set_font_size("font_size", "Big", int(40 * k))
	t.add_type("Small")
	t.set_type_variation("Small", "Label")
	t.set_font_size("font_size", "Small", int(22 * k))
	t.set_color("font_color", "Small", Color("#5a6782"))

	# sliders with a thick track and a big round knob, easy to drag with a small finger
	var slider := StyleBoxFlat.new()
	slider.bg_color = Color("#d6e4f7")
	slider.set_corner_radius_all(10)
	slider.content_margin_top = 10
	slider.content_margin_bottom = 10
	t.set_stylebox("slider", "HSlider", slider)
	var filled := slider.duplicate()
	filled.bg_color = BLUE
	t.set_stylebox("grabber_area", "HSlider", filled)
	t.set_stylebox("grabber_area_highlight", "HSlider", filled)
	var knob := _circle(int(40 * k), BLUE)
	t.set_icon("grabber", "HSlider", knob)
	t.set_icon("grabber_highlight", "HSlider", _circle(int(44 * k), ORANGE))
	return t


static func _circle(d: int, color: Color) -> ImageTexture:
	var img := Image.create(d, d, false, Image.FORMAT_RGBA8)
	var r := d / 2.0
	for y in d:
		for x in d:
			var dist := Vector2(x + 0.5 - r, y + 0.5 - r).length()
			var c := Color.WHITE if dist < r - 6 else color
			c.a = clampf(r - dist, 0.0, 1.0)
			img.set_pixel(x, y, c)
	return ImageTexture.create_from_image(img)


static func _button(t: Theme, type: String, bg: Color, border: Color, size: int, bw := 4) -> void:
	var states := {normal = bg, hover = bg.lightened(0.12) if bg != Color.WHITE else Color("#eaf3ff"),
		pressed = bg.darkened(0.12) if bg != Color.WHITE else Color("#cfe3ff"), disabled = Color("#e4e7ec"), focus = Color(0, 0, 0, 0)}
	for st in states:
		var sb := StyleBoxFlat.new()
		sb.bg_color = states[st]
		sb.set_corner_radius_all(20)
		sb.set_border_width_all(bw)
		sb.border_color = border if st != "disabled" else Color("#c3c8d2")
		if st == "focus":
			sb.border_color = ORANGE
			sb.set_border_width_all(5)
			sb.draw_center = false
		sb.content_margin_left = 22
		sb.content_margin_right = 22
		sb.content_margin_top = 12
		sb.content_margin_bottom = 12
		sb.shadow_color = Color(0, 0.1, 0.3, 0.18) if st == "normal" else Color(0, 0, 0, 0)
		sb.shadow_size = 4
		t.set_stylebox(st, type, sb)
	t.set_font_size("font_size", type, size)
	t.set_color("font_color", type, INK)
	t.set_color("font_hover_color", type, INK)
	t.set_color("font_pressed_color", type, INK)
	t.set_color("font_focus_color", type, INK)
	t.set_color("font_disabled_color", type, Color("#9aa3b2"))


## A button with text that is a translation key.
static func button(text: String, variation := "") -> Button:
	var b := Button.new()
	b.text = text
	if variation != "":
		b.theme_type_variation = variation
	b.focus_mode = Control.FOCUS_ALL
	b.pressed.connect(func(): Sfx.play("click"))
	return b


static func label(text: String, variation := "", align := HORIZONTAL_ALIGNMENT_CENTER) -> Label:
	var l := Label.new()
	l.text = text
	l.theme_type_variation = variation
	l.horizontal_alignment = align
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l
