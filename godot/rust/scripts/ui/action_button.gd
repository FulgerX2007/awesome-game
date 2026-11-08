class_name ActionButton
extends Button
## A big manual action under the scene: name, what it gives, an optional progress bar and its key.

var _name: Label
var _sub: Label
var _bar: ProgressBar
var _key: Label
var accent := UiTheme.RUST


func setup(title: String, key: String, accent_: Color) -> void:
	accent = accent_
	custom_minimum_size = Vector2(0, 74)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	focus_mode = Control.FOCUS_NONE
	var n := UiTheme.box(UiTheme.PANEL, accent.darkened(0.35), 12, 14)
	n.border_width_bottom = 3
	add_theme_stylebox_override("normal", n)
	var hv := UiTheme.box(UiTheme.PANEL_2, accent, 12, 14)
	hv.border_width_bottom = 3
	add_theme_stylebox_override("hover", hv)
	var pr := UiTheme.box(UiTheme.PANEL.darkened(0.2), accent, 12, 14)
	add_theme_stylebox_override("pressed", pr)
	add_theme_stylebox_override("disabled", UiTheme.box(UiTheme.PANEL.darkened(0.3), UiTheme.LINE, 12, 14))
	var v := VBoxContainer.new()
	v.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT, Control.PRESET_MODE_MINSIZE, 12)
	v.add_theme_constant_override("separation", 3)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(v)
	var top := HBoxContainer.new()
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(top)
	_name = UiTheme.lbl(title, 18, accent, UiTheme.title)
	_name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(_name)
	_key = UiTheme.lbl(key, 12, UiTheme.DIM)
	var kb := PanelContainer.new()
	kb.add_theme_stylebox_override("panel", UiTheme.box(Color("120e1b"), UiTheme.LINE, 5, 6))
	kb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	kb.add_child(_key)
	top.add_child(kb)
	_sub = UiTheme.lbl("", 13, UiTheme.DIM)
	v.add_child(_sub)
	_bar = UiTheme.bar(UiTheme.LAMP, 5)
	_bar.visible = false
	v.add_child(_bar)


func show_state(title: String, sub: String, enabled: bool, progress := -1.0) -> void:
	_name.text = title
	_sub.text = sub
	disabled = not enabled
	_name.add_theme_color_override("font_color", accent if enabled else UiTheme.DIM.darkened(0.2))
	_bar.visible = progress >= 0.0
	_bar.value = maxf(progress, 0.0)
