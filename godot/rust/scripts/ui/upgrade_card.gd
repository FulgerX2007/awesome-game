class_name UpgradeCard
extends Button
## One workshop upgrade: name, level pips, what it does, the next level's cost; locked ones show what
## opens them, maxed ones say so. A click buys the next level.

var id := ""
var _name: Label
var _lvl: Label
var _desc: Label
var _cost: CostLabel
var _pips: ProgressBar
var _req: Label
var _done: Label
var _flash := 0.0


func setup(id_: String) -> void:
	id = id_
	var u := GameData.upgrade(id)
	focus_mode = Control.FOCUS_NONE
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT, Control.PRESET_MODE_MINSIZE, 10)
	v.add_theme_constant_override("separation", 3)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(v)
	var top := HBoxContainer.new()
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(top)
	_name = UiTheme.lbl(u.name, 15, UiTheme.FG, UiTheme.bold)
	_name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(_name)
	_lvl = UiTheme.lbl("", 12, UiTheme.DIM)
	top.add_child(_lvl)
	_desc = UiTheme.lbl(u.description, 12, UiTheme.DIM)
	_desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(_desc)
	_pips = UiTheme.bar(UiTheme.LAMP, 4)
	_pips.visible = u.max_level > 1
	v.add_child(_pips)
	var bottom := HBoxContainer.new()
	bottom.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(bottom)
	_cost = CostLabel.new()
	bottom.add_child(_cost)
	_req = UiTheme.lbl("", 12, UiTheme.DIM)
	_req.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_req.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bottom.add_child(_req)
	_done = UiTheme.lbl("готово", 12, UiTheme.VERDIGRIS)
	bottom.add_child(_done)
	pressed.connect(func():
		if Game.buy(id):
			_flash = 1.0)
	_resize.call_deferred()
	v.minimum_size_changed.connect(_resize)


func _resize() -> void:
	var v := get_child(0) as Control
	custom_minimum_size.y = v.get_combined_minimum_size().y + 20


func refresh(s: GameState) -> void:
	var st := UpgradeManager.state_of(s, id)
	var u: UpgradeDef = st.def
	var locked: bool = not st.unlocked
	_name.text = tr(u.name)
	_lvl.text = ("%d/%d" % [st.level, u.max_level]) if u.max_level > 1 else (tr("есть") if st.maxed else "")
	_pips.value = float(st.level) / u.max_level
	_desc.visible = not locked
	_cost.visible = not locked and not st.maxed
	if _cost.visible:
		_cost.show_cost(st.cost, s)
	_done.visible = st.maxed
	_req.visible = locked
	if locked:
		var req := UpgradeManager.requirement(u)
		var args: Dictionary = req[1].duplicate()
		if args.has("name"):
			args.name = tr(args.name)
		_req.text = tr(req[0]).format(args)
	disabled = locked or st.maxed or not st.affordable
	modulate.a = 0.55 if locked else 1.0
	tooltip_text = tr(u.description) if not locked else ""
	var border := UiTheme.LINE
	if st.affordable and not locked:
		border = UiTheme.LAMP.darkened(0.2)
	var n := UiTheme.box(UiTheme.PANEL_2 if not st.maxed else UiTheme.PANEL, border, 10, 10)
	add_theme_stylebox_override("normal", n)
	add_theme_stylebox_override("disabled", UiTheme.box(UiTheme.PANEL.darkened(0.1), UiTheme.LINE.darkened(0.2), 10, 10))
	add_theme_stylebox_override("hover", UiTheme.box(UiTheme.PANEL_2.lightened(0.06), UiTheme.LAMP, 10, 10))
	add_theme_stylebox_override("pressed", UiTheme.box(UiTheme.PANEL_2.darkened(0.1), UiTheme.LAMP, 10, 10))


func _process(delta: float) -> void:
	if _flash > 0.0:
		_flash = maxf(0.0, _flash - delta * 2.0)
		self_modulate = Color(1, 1, 1).lerp(Color(1.6, 1.4, 0.8), _flash)
