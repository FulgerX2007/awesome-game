class_name WorkerPanel
extends PanelContainer
## «Бригада»: totals, the three roles with their rates and controls, what the next robot costs, the
## mechanics' auto-repair switch and, with the drone, the task it automates.

var _summary: Label
var _free: Label
var _rows := {}
var _auto: CheckBox
var _next: Label
var _drone_row: HBoxContainer
var _drone: OptionButton
var _factory: Label

const DRONE_TASKS := ["dig", "sort", "repair"]


func _ready() -> void:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	add_child(v)
	var head := HBoxContainer.new()
	v.add_child(head)
	var h := UiTheme.heading("Бригада")
	h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(h)
	_free = UiTheme.lbl("", 13, UiTheme.LAMP)
	head.add_child(_free)
	_summary = UiTheme.lbl("", 13, UiTheme.DIM)
	v.add_child(_summary)
	for role in GameData.ROLES:
		var r := preload("res://scenes/ui/role_row.tscn").instantiate()
		r.setup(role)
		v.add_child(r)
		_rows[role] = r
	_factory = UiTheme.lbl("", 12, UiTheme.LAMP)
	v.add_child(_factory)
	_next = UiTheme.lbl("", 12, UiTheme.DIM)
	_next.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(_next)
	_auto = CheckBox.new()
	_auto.text = tr("Механики сами берутся за следующего робота")
	_auto.focus_mode = Control.FOCUS_NONE
	_auto.add_theme_font_size_override("font_size", 13)
	_auto.toggled.connect(func(on): Game.set_auto_repair(on))
	v.add_child(_auto)
	_drone_row = HBoxContainer.new()
	v.add_child(_drone_row)
	var dl := UiTheme.lbl("Дрон-помощник:", 13, UiTheme.CORE)
	dl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_drone_row.add_child(dl)
	_drone = OptionButton.new()
	_drone.focus_mode = Control.FOCUS_NONE
	for t in ["копает", "разбирает", "чинит"]:
		_drone.add_item(tr(t))
	_drone.item_selected.connect(func(i): Game.set_drone_task(DRONE_TASKS[i]))
	_drone.tooltip_text = tr("Какое ручное дело дрон делает за тебя")
	_drone_row.add_child(_drone)
	Game.ticked.connect(refresh)
	Game.changed.connect(refresh)
	Game.state_replaced.connect(refresh)
	refresh()


func refresh() -> void:
	var s := Game.s
	visible = s.built >= 1
	if not visible:
		return
	var d := ProductionManager.derived(s)
	var r := ProductionManager.rates(s)
	var total := WorkerManager.total(s)
	_summary.text = tr("Всего роботов: {t} · за работой: {w}").format({t = total, w = total - s.robots.idle})
	_free.text = tr("свободны: {n}").format({n = s.robots.idle}) if s.robots.idle > 0 else tr("все при деле")
	_free.add_theme_color_override("font_color", UiTheme.LAMP if s.robots.idle > 0 else UiTheme.DIM)
	for role in _rows:
		_rows[role].refresh(s, d, r)
	_factory.visible = d.factory > 0.0
	_factory.text = tr("Сборочный цех: +{v} ремонта/с").format({v = Fmt.dec(d.factory)})
	var need: float = ceilf(d.repair_need / 2.0) if s.free_jobs > 0 else d.repair_need
	var cost := tr("бесплатно") if s.free_jobs > 0 else tr("{n} деталей").format({n = Fmt.num(d.robot_cost), pl = Fmt.plural(int(d.robot_cost), "деталь|детали|деталей")})
	_next.text = tr("Следующий робот: {cost}, {need} ед. ремонта").format({cost = cost, need = Fmt.num(need)})
	if r.repair > 0.0:
		_next.text += tr(" · ~{t}").format({t = Fmt.duration(maxf(1.0, need / r.repair))})
	_auto.visible = ProductionManager.has_auto_repair(s)
	_auto.set_pressed_no_signal(s.auto_repair)
	_drone_row.visible = s.lvl("drone") > 0
	_drone.select(DRONE_TASKS.find(s.drone_task))
