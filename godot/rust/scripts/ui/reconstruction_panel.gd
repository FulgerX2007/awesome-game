class_name ReconstructionPanel
extends PanelContainer
## «Ковчег»: the seven stages of rebuilding, the overall progress and, after the launch, «Новый рассвет».

signal new_dawn_pressed

var _rows: Array[StageRow] = []
var _label: Label
var _total: ProgressBar
var _locked: Label
var _done: VBoxContainer
var _dawn_btn: Button
var _list: VBoxContainer


func _ready() -> void:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	add_child(v)
	var head := HBoxContainer.new()
	v.add_child(head)
	var h := UiTheme.heading("Ковчег")
	h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(h)
	_label = UiTheme.lbl("", 13, UiTheme.DIM)
	head.add_child(_label)
	_total = UiTheme.bar(UiTheme.RUST, 6)
	v.add_child(_total)
	_locked = UiTheme.lbl("", 13, UiTheme.DIM)
	_locked.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(_locked)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 6)
	v.add_child(_list)
	for i in GameData.stages().size():
		var r: StageRow = preload("res://scenes/ui/stage_row.tscn").instantiate()
		r.setup(i)
		r.build_pressed.connect(func(): Game.build_stage())
		_list.add_child(r)
		_rows.append(r)
	_done = VBoxContainer.new()
	v.add_child(_done)
	var p := UiTheme.lbl("Ковчег ушёл в небо. Свалка затихла, но в тетради остались чертежи.", 14, UiTheme.FG)
	p.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_done.add_child(p)
	_dawn_btn = Button.new()
	_dawn_btn.focus_mode = Control.FOCUS_NONE
	_dawn_btn.pressed.connect(func(): new_dawn_pressed.emit())
	_dawn_btn.add_theme_stylebox_override("normal", UiTheme.box(UiTheme.RUST_DEEP, UiTheme.RUST, 8, 12))
	_done.add_child(_dawn_btn)
	Game.ticked.connect(refresh)
	Game.changed.connect(refresh)
	Game.state_replaced.connect(refresh)
	refresh()


func refresh() -> void:
	var s := Game.s
	var n := GameData.stages().size()
	var open := ReconstructionManager.unlocked(s)
	visible = s.built >= 1 or s.stage > 0
	_label.text = tr("улетел") if s.launched else "%d/%d" % [s.stage, n]
	_total.value = float(s.stage) / n
	_locked.visible = not open
	_locked.text = tr("В дымке на краю свалки что-то есть. Почини {n} роботов, чтобы рассмотреть.").format({n = GameData.def().ark_unlock_built})
	_list.visible = open and not s.launched
	_done.visible = s.launched
	if s.launched:
		var g := ReconstructionManager.blueprint_gain(s)
		_dawn_btn.text = tr("Новый рассвет: +{n} {bp}").format({n = g, bp = Fmt.plural(g, "чертёж|чертежа|чертежей")})
	if _list.visible:
		for r in _rows:
			r.refresh(s)
