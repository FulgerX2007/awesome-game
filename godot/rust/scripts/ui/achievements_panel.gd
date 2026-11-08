class_name AchievementsPanel
extends PanelContainer
## «Достижения»: milestones and optional challenges; done ones are lit. Folds to its header.

var _grid: GridContainer
var _count: Label
var _items := {}
var _open := false


func _ready() -> void:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	add_child(v)
	var head := Button.new()
	head.flat = true
	head.focus_mode = Control.FOCUS_NONE
	head.alignment = HORIZONTAL_ALIGNMENT_LEFT
	head.add_theme_font_override("font", UiTheme.title)
	head.add_theme_font_size_override("font_size", 19)
	head.add_theme_color_override("font_color", UiTheme.RUST)
	head.add_theme_color_override("font_hover_color", UiTheme.RUST.lightened(0.2))
	head.text = tr("Достижения")
	head.pressed.connect(func():
		_open = not _open
		_grid.visible = _open)
	var hr := HBoxContainer.new()
	v.add_child(hr)
	head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hr.add_child(head)
	_count = UiTheme.lbl("", 13, UiTheme.DIM)
	hr.add_child(_count)
	_grid = GridContainer.new()
	_grid.columns = 2
	_grid.add_theme_constant_override("h_separation", 8)
	_grid.add_theme_constant_override("v_separation", 6)
	_grid.visible = false
	v.add_child(_grid)
	for a in GameData.achievements():
		var p := PanelContainer.new()
		p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var b := VBoxContainer.new()
		p.add_child(b)
		var n := UiTheme.lbl(a.name, 13, UiTheme.FG, UiTheme.bold)
		b.add_child(n)
		var d := UiTheme.lbl(a.description, 11, UiTheme.DIM)
		d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		d.custom_minimum_size.x = 120
		b.add_child(d)
		p.tooltip_text = tr(a.description)
		_grid.add_child(p)
		_items[a.id] = [p, n, a.challenge]
	Game.event.connect(func(e): if e.type == "achievement": refresh())
	Game.state_replaced.connect(refresh)
	refresh()


func refresh() -> void:
	var s := Game.s
	var got := 0
	for id in _items:
		var have := s.achievements.has(id)
		if have:
			got += 1
		var p: PanelContainer = _items[id][0]
		var accent := UiTheme.CORE if _items[id][2] else UiTheme.LAMP
		p.add_theme_stylebox_override("panel", UiTheme.box(UiTheme.PANEL_2 if have else UiTheme.PANEL, accent.darkened(0.2) if have else UiTheme.LINE, 8, 8))
		p.modulate.a = 1.0 if have else 0.55
		_items[id][1].add_theme_color_override("font_color", accent if have else UiTheme.FG)
	_count.text = "%d/%d" % [got, _items.size()]
