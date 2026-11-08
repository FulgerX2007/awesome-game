class_name ToastLayer
extends VBoxContainer
## Notifications in the corner of the scene: discoveries, finished stages, achievements, warnings.

const LIFE := 4.5
var _items: Array = []


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_theme_constant_override("separation", 6)
	alignment = BoxContainer.ALIGNMENT_BEGIN
	Game.notify.connect(show_toast)


func show_toast(text: String, kind := "info") -> void:
	var accent: Color = {good = UiTheme.VERDIGRIS, warn = UiTheme.DANGER, info = UiTheme.LAMP}.get(kind, UiTheme.LAMP)
	var p := PanelContainer.new()
	var sb := UiTheme.box(Color(0.07, 0.05, 0.11, 0.92), accent, 10, 12)
	sb.border_width_left = 4
	p.add_theme_stylebox_override("panel", sb)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var l := UiTheme.lbl(text, 14, UiTheme.FG)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = 260
	p.add_child(l)
	add_child(p)
	_items.append({node = p, t = 0.0})
	while _items.size() > 4:
		_items.pop_front().node.queue_free()


func _process(delta: float) -> void:
	for it in _items.duplicate():
		it.t += delta
		it.node.modulate.a = clampf((LIFE - it.t) / 0.6, 0.0, 1.0) * clampf(it.t / 0.2, 0.0, 1.0)
		if it.t > LIFE:
			it.node.queue_free()
			_items.erase(it)
