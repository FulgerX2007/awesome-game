class_name Modal
extends Control
## A dialog over the whole screen (time away, the launch). The game keeps running behind it.

var _title: Label
var _body: Label
var _actions: HBoxContainer


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.color = Color(0.04, 0.02, 0.07, 0.7)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(dim)
	var c := CenterContainer.new()
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(c)
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UiTheme.box(UiTheme.PANEL, UiTheme.RUST.darkened(0.2), 14, 22))
	p.custom_minimum_size = Vector2(420, 0)
	c.add_child(p)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	p.add_child(v)
	_title = UiTheme.heading("")
	_title.add_theme_font_size_override("font_size", 24)
	v.add_child(_title)
	_body = UiTheme.lbl("", 15, UiTheme.FG)
	_body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_body.custom_minimum_size = Vector2(400, 0)
	v.add_child(_body)
	_actions = HBoxContainer.new()
	_actions.alignment = BoxContainer.ALIGNMENT_END
	_actions.add_theme_constant_override("separation", 8)
	v.add_child(_actions)
	visible = false


## actions: [[label, callable or null, primary]]
func open(title: String, body: String, actions: Array) -> void:
	_title.text = title
	_body.text = body
	for c in _actions.get_children():
		c.queue_free()
	for a in actions:
		var b := Button.new()
		b.text = a[0]
		b.focus_mode = Control.FOCUS_ALL
		if a.size() > 2 and a[2]:
			b.add_theme_stylebox_override("normal", UiTheme.box(UiTheme.RUST_DEEP, UiTheme.RUST, 8, 12))
		var run = a[1]
		b.pressed.connect(func():
			visible = false
			if run is Callable:
				run.call())
		_actions.add_child(b)
	visible = true
	if _actions.get_child_count() > 0:
		(_actions.get_child(_actions.get_child_count() - 1) as Button).grab_focus.call_deferred()
