class_name LogPanel
extends PanelContainer
## The chronicle under the scene: the latest lines of the story and of what happened, newest on top.

const SHOW := 5
var _box: VBoxContainer


func _ready() -> void:
	add_theme_stylebox_override("panel", UiTheme.box(Color("1b1528"), UiTheme.LINE, 12, 14))
	_box = VBoxContainer.new()
	_box.add_theme_constant_override("separation", 4)
	add_child(_box)
	Game.event.connect(func(e): if e.type == "log": refresh())
	Game.state_replaced.connect(refresh)
	refresh()


func refresh() -> void:
	for c in _box.get_children():
		c.queue_free()
	var lines := Game.s.log.slice(-SHOW)
	lines.reverse()
	for i in lines.size():
		var item: Dictionary = lines[i]
		var l := UiTheme.lbl(tr(item.text).format(item.get("args", {})), 13 if i > 0 else 14, UiTheme.FG if i == 0 else UiTheme.DIM)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.modulate.a = 1.0 - i * 0.15
		_box.add_child(l)
