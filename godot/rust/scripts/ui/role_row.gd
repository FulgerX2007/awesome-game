class_name RoleRow
extends VBoxContainer
## One role in the brigade: how many work there, what each one produces, and the controls to move
## robots in and out (one, or all of them).

var role := ""
var _count: Label
var _desc: Label
var _rate: Label
var _bar: ProgressBar
var _minus_all: Button
var _minus: Button
var _plus: Button
var _plus_all: Button

const META := {
	digger = ["Копатели", "Копают хлам из куч"],
	sorter = ["Сортировщики", "Разбирают хлам на детали"],
	mechanic = ["Механики", "Чинят роботов на станции"],
}


func setup(role_: String) -> void:
	role = role_
	add_theme_constant_override("separation", 4)
	var color: Color = Kit.ROLE_COLORS[role]
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 6)
	add_child(top)
	top.add_child(UiTheme.dot(color, 10))
	var name_l := UiTheme.lbl(META[role][0], 15, UiTheme.FG, UiTheme.bold)
	name_l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_l.tooltip_text = tr(META[role][1])
	name_l.mouse_filter = Control.MOUSE_FILTER_PASS
	top.add_child(name_l)
	_minus_all = _btn("«", "Снять всех")
	_minus = _btn("−", "Снять одного")
	_count = UiTheme.lbl("0", 17, color, UiTheme.bold)
	_count.custom_minimum_size = Vector2(38, 0)
	_count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_plus = _btn("+", "Назначить одного")
	_plus_all = _btn("все", "Назначить всех свободных")
	_plus_all.custom_minimum_size = Vector2(48, 30)
	for c in [_minus_all, _minus, _count, _plus, _plus_all]:
		top.add_child(c)
	_minus_all.pressed.connect(func(): Game.unassign_all(role))
	_minus.pressed.connect(func(): Game.assign(role, -1))
	_plus.pressed.connect(func(): Game.assign(role, 1))
	_plus_all.pressed.connect(func(): Game.assign_all(role))
	var info := HBoxContainer.new()
	add_child(info)
	_desc = UiTheme.lbl("", 12, UiTheme.DIM)
	_desc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	info.add_child(_desc)
	_rate = UiTheme.lbl("", 12, color)
	info.add_child(_rate)
	_bar = UiTheme.bar(color, 4)
	add_child(_bar)


func _btn(text: String, tip: String) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tr(tip)
	b.custom_minimum_size = Vector2(30, 30)
	b.focus_mode = Control.FOCUS_NONE
	return b


func refresh(s: GameState, d: Dictionary, r: Dictionary) -> void:
	var n: int = s.robots[role]
	_count.text = str(n)
	_minus.disabled = n == 0
	_minus_all.disabled = n == 0
	_plus.disabled = s.robots.idle == 0
	_plus_all.disabled = s.robots.idle == 0
	match role:
		"digger":
			_desc.text = tr("{v} хлама/с каждый").format({v = Fmt.dec(d.digger)})
			_rate.text = tr("+{v} хлама/с").format({v = Fmt.dec(n * d.digger) if n * d.digger < 1000.0 else Fmt.num(n * d.digger)}) if n > 0 else ""
		"sorter":
			_desc.text = tr("{v} деталей/с каждый · {r} хлама → 1 деталь").format({v = Fmt.dec(d.sorter), r = Fmt.dec(d.ratio)})
			if r.sorter_starved:
				_rate.text = tr("ждут хлам")
				_rate.add_theme_color_override("font_color", UiTheme.DANGER)
			else:
				_rate.text = tr("+{v} дет./с").format({v = Fmt.dec(r.parts) if r.parts < 1000.0 else Fmt.num(r.parts)}) if n > 0 else ""
				_rate.add_theme_color_override("font_color", Kit.ROLE_COLORS[role])
		"mechanic":
			_desc.text = tr("{v} ремонта/с каждый").format({v = Fmt.dec(d.mechanic)})
			_rate.text = tr("+{v} ремонта/с").format({v = Fmt.dec(n * d.mechanic) if n * d.mechanic < 1000.0 else Fmt.num(n * d.mechanic)}) if n > 0 else ""
	var team := WorkerManager.total(s)
	_bar.value = float(n) / team if team > 0 else 0.0
