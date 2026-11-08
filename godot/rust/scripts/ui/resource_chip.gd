class_name ResourceChip
extends PanelContainer
## One resource in the top bar: icon, name, amount and its net rate. The tooltip says what it is for.

var id := ""
var _value: Label
var _rate: Label
var _name: Label


func setup(id_: String) -> void:
	id = id_
	var def := GameData.resource(id)
	add_theme_stylebox_override("panel", UiTheme.box(UiTheme.PANEL, UiTheme.LINE, 999, 12))
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 7)
	h.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(h)
	h.add_child(UiTheme.dot(def.color))
	_name = UiTheme.lbl(def.name, 13, UiTheme.DIM)
	h.add_child(_name)
	_value = UiTheme.lbl("0", 17, UiTheme.FG, UiTheme.bold)
	h.add_child(_value)
	_rate = UiTheme.lbl("", 12, UiTheme.VERDIGRIS)
	h.add_child(_rate)
	tooltip_text = tr(def.purpose)
	mouse_filter = Control.MOUSE_FILTER_PASS


func show_value(v: String, rate := "", negative := false) -> void:
	_value.text = v
	_rate.text = rate
	_rate.add_theme_color_override("font_color", UiTheme.DANGER if negative else UiTheme.VERDIGRIS)
