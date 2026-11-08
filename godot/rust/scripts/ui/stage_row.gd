class_name StageRow
extends PanelContainer
## One stage of the ark: number, name, what it gives; for the next stage the cost with progress bars
## and the build button. Done stages are ticked off, later ones are dimmed.

signal build_pressed

var index := 0
var _num: Label
var _name: Label
var _desc: Label
var _gain: Label
var _cost: CostLabel
var _bars: VBoxContainer
var _parts_bar: ProgressBar
var _cores_bar: ProgressBar
var _btn: Button


func setup(i: int) -> void:
	index = i
	var st := GameData.stages()[i]
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 10)
	add_child(h)
	_num = UiTheme.lbl("%d" % (i + 1), 16, UiTheme.DIM, UiTheme.title)
	_num.custom_minimum_size = Vector2(22, 0)
	_num.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	h.add_child(_num)
	var v := VBoxContainer.new()
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_theme_constant_override("separation", 3)
	h.add_child(v)
	_name = UiTheme.lbl(st.name, 15, UiTheme.FG, UiTheme.bold)
	v.add_child(_name)
	_desc = UiTheme.lbl(st.description, 12, UiTheme.DIM)
	_desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(_desc)
	_gain = UiTheme.lbl(st.unlock_text, 12, UiTheme.VERDIGRIS)
	_gain.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(_gain)
	var row := HBoxContainer.new()
	v.add_child(row)
	_cost = CostLabel.new()
	_cost.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_cost)
	_btn = Button.new()
	_btn.text = tr("Построить")
	_btn.focus_mode = Control.FOCUS_NONE
	_btn.pressed.connect(func(): build_pressed.emit())
	row.add_child(_btn)
	_bars = VBoxContainer.new()
	_bars.add_theme_constant_override("separation", 2)
	v.add_child(_bars)
	_parts_bar = UiTheme.bar(UiTheme.VERDIGRIS, 4)
	_cores_bar = UiTheme.bar(UiTheme.CORE, 4)
	_bars.add_child(_parts_bar)
	_bars.add_child(_cores_bar)


func refresh(s: GameState) -> void:
	var st := GameData.stages()[index]
	var done := index < s.stage
	var next := index == s.stage
	_num.text = "%d" % (index + 1)
	_name.text = tr(st.name) + (" — " + tr("готово") if done else "")
	_num.add_theme_color_override("font_color", UiTheme.VERDIGRIS if done else (UiTheme.LAMP if next else UiTheme.DIM))
	_desc.visible = next
	_gain.visible = next or done
	_cost.visible = next
	_btn.visible = next
	_bars.visible = next
	modulate.a = 1.0 if next or done else 0.5
	var border := UiTheme.LAMP.darkened(0.3) if next else UiTheme.LINE
	add_theme_stylebox_override("panel", UiTheme.box(UiTheme.PANEL_2 if next else UiTheme.PANEL, border, 10, 10))
	if next:
		var cost := ReconstructionManager.cost(st)
		_cost.show_cost(cost, s)
		_btn.disabled = not ReconstructionManager.can_build(s)
		_parts_bar.value = clampf(s.parts / st.parts, 0.0, 1.0)
		_cores_bar.visible = st.cores > 0.0
		_cores_bar.value = clampf(s.cores / maxf(st.cores, 1.0), 0.0, 1.0)
		_btn.text = tr("Запустить!") if st.effect == "launch" else tr("Построить")
