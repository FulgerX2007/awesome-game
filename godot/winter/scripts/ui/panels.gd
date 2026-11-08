class_name WinterPanels
extends Control
## The windows over the game: Build, Workbench (tools, the workshop's gear and the recipes of the fire),
## Inventory, the Trader, the day's Event, Pause, Settings, a confirm, the Result and the main Menu. Each is a
## frosted panel centred on a dimmed screen; rows carry an icon, a name, a description, the cost as chips
## (red when the stock lacks it) and their buttons. main.gd listens to `request` and calls the rules.

signal request(what: String, arg: Variant)
signal hover_build(id: String)

const TOOL_NAME := {"axe": "Каменный топор", "ironAxe": "Железный топор", "pick": "Кирка", "shovel": "Лопата", "icePick": "Ледоруб", "spear": "Копьё"}
const TOOL_DESC := {
	"axe": "Рубить деревья", "ironAxe": "Рубит в полтора раза быстрее", "pick": "Добывать камень", "shovel": "Копать сугробы",
	"icePick": "Ходить по льду озера", "spear": "Охота на оленей, вдвое сильнее против волков",
}
const STAGE_NAME := {"walls": "Стены", "roof": "Крыша", "door": "Дверь", "stove": "Печь"}
const SEGMENT_NAME := ["Частокол: север", "Частокол: восток", "Частокол: юг", "Частокол: запад"]
const UP_NAME := {"insulation": "Утепление", "cellar": "Погреб", "smokehouse": "Коптильня", "annex": "Пристройка", "workshop": "Мастерская"}
const UP_DESC := {
	"insulation": "Мох и шкуры: печь горит дольше, в хижине теплее даже без неё", "cellar": "Ещё 100 места для еды",
	"smokehouse": "Сама коптит сырое мясо и рыбу, копчёное сытнее", "annex": "Тёплая комната: выжившие быстрее лечатся и работают",
	"workshop": "Шуба, фонарь, сани и силки",
}
const GEAR_LABEL := {"coat": "Шуба", "lantern": "Фонарь", "sled": "Сани", "snares": "Силки"}
const GEAR_DESC := {
	"coat": "Мороз пробирает слабее", "lantern": "Ночью волки шарахаются от света", "sled": "Уносишь из леса вдвое больше",
	"snares": "По два за раз, ставь в лесу: утром в них зайцы",
}
const ITEM_NAME := {
	"wood": "Дерево", "stone": "Камень", "metal": "Металл", "hide": "Шкуры", "berries": "Ягоды", "meat": "Сырое мясо", "fish": "Рыба",
	"cookedMeat": "Жареное мясо", "cookedFish": "Жареная рыба", "smokedMeat": "Копчёное мясо", "smokedFish": "Копчёная рыба",
}
const EVENT_ASK := {
	"roof": {"title": "Метель проломила кровлю!", "text": "Через дыру уходит тепло, печь прогорает быстрее. Починить сейчас: {cost}.", "yes": "Чинить сейчас", "no": "Потом"},
	"wanderer": {"title": "Раненый путник", "text": "Он замёрз и ослаб и просит две порции еды. В благодарность он чем-нибудь поделится.", "yes": "Помочь", "no": "Пройти мимо"},
}

var current := ""
var bg: TextureRect                   # the menu's painted backdrop
var dim: ColorRect
var box: PanelContainer
var g: Dictionary = {}
var settings: Dictionary = {}
var save: Dictionary = {}


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	dim = ColorRect.new()
	dim.color = Color(0.02, 0.03, 0.08, 0.55)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	dim.visible = false
	add_child(dim)


func close() -> void:
	if bg:
		bg.visible = false
	if box:
		box.queue_free()
		box = null
	dim.visible = false
	current = ""
	hover_build.emit("")


func is_open() -> bool:
	return current != ""


## ── Building blocks ──

func _window(title: String, icon_id: String, width := 640.0, dim_on := true) -> VBoxContainer:
	if box:
		box.queue_free()
	if bg and current != "settings":
		bg.visible = false
	dim.visible = dim_on
	box = PanelContainer.new()
	box.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(box)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	box.add_child(v)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 10)
	if icon_id != "":
		head.add_child(_icon(icon_id, 40))
	var t := Label.new()
	t.theme_type_variation = "Title"
	t.text = title
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(t)
	if current not in ["menu", "result", "event", "confirm"]:
		var x := Button.new()
		x.icon = WinterTheme.icon("close")
		x.expand_icon = true
		x.custom_minimum_size = Vector2(44, 44)
		x.focus_mode = Control.FOCUS_NONE
		x.tooltip_text = tr("Закрыть") + " (Esc)"
		x.pressed.connect(func(): request.emit("close", null))
		head.add_child(x)
	v.add_child(head)
	box.set_meta("width", width)
	_place.call_deferred()
	return v


func _place() -> void:
	if box == null:
		return
	var sz := get_viewport_rect().size
	var w := minf(float(box.get_meta("width", 640.0)), sz.x - 24)
	box.custom_minimum_size = Vector2(w, 0)
	box.size = Vector2(w, 0)
	await get_tree().process_frame
	if box == null:
		return
	var maxh := sz.y - 40
	if box.size.y > maxh:
		box.size.y = maxh
	box.position = ((sz - box.size) * 0.5).floor()


func relayout() -> void:
	_place()


func _icon(id: String, px: int) -> TextureRect:
	var r := TextureRect.new()
	r.texture = WinterTheme.icon(id)
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	r.custom_minimum_size = Vector2(px, px)
	r.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return r


func _lead(v: VBoxContainer, text: String) -> void:
	var l := Label.new()
	l.text = text
	l.theme_type_variation = "Small"
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(l)


func _list(v: VBoxContainer, max_h := 470.0) -> VBoxContainer:
	var sc := ScrollContainer.new()
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sc.custom_minimum_size = Vector2(0, minf(max_h, get_viewport_rect().size.y - 220))
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(sc)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 8)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(list)
	return list


func _head(list: VBoxContainer, text: String, note := "") -> void:
	var h := VBoxContainer.new()
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", WinterTheme.font_bold)
	l.add_theme_color_override("font_color", WinterTheme.WARM)
	h.add_child(l)
	if note != "":
		var n := Label.new()
		n.text = note
		n.theme_type_variation = "Small"
		n.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		h.add_child(n)
	list.add_child(h)


## A row: icon, name and description, cost chips, then buttons [[label, what, arg, enabled]].
func _row(list: VBoxContainer, icon_id: String, name: String, desc: String, cost := {}, paid := {}, actions := [], hover_id := "") -> PanelContainer:
	var p := PanelContainer.new()
	var st := StyleBoxFlat.new()
	st.bg_color = Color(WinterTheme.PANEL_HI, 0.55)
	st.set_corner_radius_all(12)
	st.content_margin_left = 12
	st.content_margin_right = 12
	st.content_margin_top = 8
	st.content_margin_bottom = 8
	p.add_theme_stylebox_override("panel", st)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 12)
	p.add_child(h)
	h.add_child(_icon(icon_id, 44))
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_theme_constant_override("separation", 2)
	var n := Label.new()
	n.text = name
	n.add_theme_font_override("font", WinterTheme.font_bold)
	col.add_child(n)
	if desc != "":
		var d := Label.new()
		d.text = desc
		d.theme_type_variation = "Small"
		d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		col.add_child(d)
	if not cost.is_empty():
		col.add_child(_chips(cost, paid))
	h.add_child(col)
	for a in actions:
		var b := Button.new()
		b.text = a[0]
		b.disabled = not a[3]
		b.focus_mode = Control.FOCUS_ALL
		b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		b.custom_minimum_size = Vector2(118, 44)
		var what: String = a[1]
		var arg = a[2]
		b.pressed.connect(func(): request.emit(what, arg))
		h.add_child(b)
	if hover_id != "":
		p.mouse_entered.connect(func(): hover_build.emit(hover_id))
		p.mouse_exited.connect(func(): hover_build.emit(""))
	list.add_child(p)
	return p


func _chips(cost: Dictionary, paid := {}) -> HFlowContainer:
	var f := HFlowContainer.new()
	f.add_theme_constant_override("h_separation", 10)
	for k in cost:
		var left := int(cost[k]) - int(paid.get(k, 0))
		if left <= 0:
			continue
		var c := HBoxContainer.new()
		c.add_theme_constant_override("separation", 3)
		c.add_child(_icon(k, 22))
		var l := Label.new()
		var have := int(g.stock.get(k, 0)) if not g.is_empty() else 0
		l.text = "%d" % left if have >= left else "%d / %d" % [have, left]
		l.add_theme_font_size_override("font_size", 15)
		l.add_theme_color_override("font_color", WinterTheme.GOOD if have >= left else WinterTheme.BAD)
		c.add_child(l)
		c.tooltip_text = tr(ITEM_NAME.get(k, k))
		c.mouse_filter = Control.MOUSE_FILTER_PASS
		f.add_child(c)
	return f


func _buttons(v: VBoxContainer, list: Array, vertical := false) -> BoxContainer:
	var h: BoxContainer = VBoxContainer.new() if vertical else HBoxContainer.new()
	h.add_theme_constant_override("separation", 10)
	if not vertical:
		(h as HBoxContainer).alignment = BoxContainer.ALIGNMENT_CENTER
	var first: Button = null
	for a in list:
		var b := Button.new()
		b.text = a[0]
		b.custom_minimum_size = Vector2(220 if vertical else 170, 52)
		if a.size() > 3 and a[3] == "accent":
			b.theme_type_variation = "AccentButton"
		if a.size() > 4:
			b.disabled = not a[4]
		if a.size() > 5:
			b.tooltip_text = a[5]
		var what: String = a[1]
		var arg = a[2]
		b.pressed.connect(func(): request.emit(what, arg))
		h.add_child(b)
		if first == null and not b.disabled:
			first = b
	v.add_child(h)
	if first:
		first.call_deferred("grab_focus")
	return h


func _cost_text(cost: Dictionary, paid := {}) -> String:
	var parts := []
	for k in cost:
		parts.append("%d %s" % [maxi(0, int(cost[k]) - int(paid.get(k, 0))), tr(ITEM_NAME.get(k, k)).to_lower()])
	return ", ".join(parts)


## ── The windows ──

func open_build(state: Dictionary) -> void:
	g = state
	current = "build"
	var v := _window(tr("Постройки"), "build")
	var away := not WinterSim.at_base(g)
	_lead(v, tr("Строить можно только в лагере.") if away else tr("Вноси, что есть: постройка достраивается по частям."))
	var list := _list(v)
	var stages: Array = WinterSim.D.HUT_STAGES
	var hs := int(g.hut.stage)
	if hs < stages.size():
		var st: Dictionary = stages[hs]
		_row(list, "hut", tr("Хижина: {stage}").format({"stage": tr(STAGE_NAME[st.id])}), tr("Этап {n} из 4").format({"n": hs + 1}), st.cost, g.hut.paid, [[tr("Внести"), "contribute", "hut", not away]], "hut")
	else:
		_row(list, "hut", tr("Хижина"), tr("Готова: печь греет, пока в ней дрова"))
	for i in 4:
		var p: Dictionary = g.palisade[i]
		var need = WinterSim.need_of(g, "palisade:%d" % i)
		if need == null:
			_row(list, "palisade", tr(SEGMENT_NAME[i]), tr("Стоит"))
		else:
			var desc := tr("Починить, прочность {hp}").format({"hp": int(p.hp)}) if p.built else tr("Стена из заострённых кольев")
			_row(list, "palisade", tr(SEGMENT_NAME[i]), desc, need.cost, need.paid, [[tr("Починить") if p.built else tr("Внести"), "contribute", "palisade:%d" % i, not away]], "palisade:%d" % i)
	for i in g.bunks.size():
		var b: Dictionary = g.bunks[i]
		if b.built:
			_row(list, "bunk", tr("Нары {n}").format({"n": i + 1}), tr("Готовы: двое спят в тепле"))
		else:
			_row(list, "bunk", tr("Нары {n}").format({"n": i + 1}), tr("Двое выживших спят в тепле"), WinterSim.D.BUNK_COST, b.paid, [[tr("Внести"), "contribute", "bunk:%d" % i, not away]], "bunk:%d" % i)
	if g.hut.roofHole:
		_row(list, "hut", tr("Залатать крышу"), tr("Через дыру уходит тепло"), WinterSim.D.ROOF_FIX, g.hut.patchPaid, [[tr("Внести"), "contribute", "patch", not away]])
	_head(list, tr("Улучшения дома"), tr("Откроются, когда в хижине будет печь") if hs < stages.size() else "")
	if hs >= stages.size():
		for id in WinterSim.D.UPGRADE_IDS:
			var u: Dictionary = g.upgrades[id]
			if u.built:
				_row(list, id, tr(UP_NAME[id]), tr(UP_DESC[id]) + " · " + tr("готово"))
			else:
				_row(list, id, tr(UP_NAME[id]), tr(UP_DESC[id]), WinterSim.D.UPGRADES[id].cost, u.paid, [[tr("Внести"), "contribute", "up:" + id, not away]], "up:" + id)
	var tc: Dictionary = WinterSim.D.TORCH
	var can_torch = g.torches.size() < int(tc.max) and int(g.stock.wood) >= int(tc.cost)
	_row(list, "torch", tr("Факел"), tr("{n} дерева, отгоняет волков. Стоит: {k} из {m}").format({"n": int(tc.cost), "k": g.torches.size(), "m": int(tc.max)}), {}, {}, [[tr("Поставить"), "torch", null, can_torch]])


func open_bench(state: Dictionary) -> void:
	g = state
	current = "bench"
	var v := _window(tr("Верстак"), "bench")
	var away := not WinterSim.at_base(g)
	_lead(v, tr("Верстак стоит в лагере.") if away else tr("Инструменты открывают новые места и работу."))
	var list := _list(v)
	_head(list, tr("Инструменты"))
	var tools: Dictionary = WinterSim.D.TOOLS
	for id in tools:
		var have: bool = g.tools[id]
		if have:
			_row(list, id, tr(TOOL_NAME[id]), tr(TOOL_DESC[id]) + " · " + tr("есть"))
		else:
			_row(list, id, tr(TOOL_NAME[id]), tr(TOOL_DESC[id]), tools[id].cost, {}, [[tr("Сделать"), "craft", id, not away and WinterSim.afford(g, tools[id].cost)]])
	var shop := WinterSim.upgrade_on(g, "workshop")
	_head(list, tr("Мастерская"), "" if shop else tr("Построй мастерскую (улучшение дома), чтобы делать снаряжение"))
	var gear: Dictionary = WinterSim.D.GEAR
	var snare_max := int(WinterSim.D.SNARE.max)
	for id in gear:
		var snares: bool = id == "snares"
		var have: bool = (int(g.gear.snares) + g.snares.size() >= snare_max) if snares else bool(g.gear[id])
		var acts := []
		if not have:
			acts.append([tr("Сделать"), "craft", id, shop and not away and WinterSim.afford(g, gear[id].cost)])
		if snares and int(g.gear.snares) > 0:
			acts.append([tr("Поставить"), "snare", null, true])
		var desc := tr(GEAR_DESC[id])
		if snares:
			desc += " · " + tr("в руках: {n}, стоит: {k}").format({"n": int(g.gear.snares), "k": g.snares.size()})
		elif have:
			desc += " · " + tr("есть")
		_row(list, id, tr(GEAR_LABEL[id]), desc, {} if have else gear[id].cost, {}, acts)
	_head(list, tr("Рецепты огня"), tr("Жарят у костра: подойди к огню, когда есть сырое"))
	var food: Dictionary = WinterSim.D.FOOD
	_row(list, "cookedMeat", tr("Жареное мясо"), tr("Сырое мясо у костра, 2 секунды · сытость {n}").format({"n": int(food.cookedMeat)}))
	_row(list, "cookedFish", tr("Жареная рыба"), tr("Рыба у костра, 2 секунды · сытость {n}").format({"n": int(food.cookedFish)}))
	_row(list, "smokedMeat", tr("Копчёное мясо и рыба"), tr("Коптильня сама коптит запасы, полено на три куска · сытость {n}").format({"n": int(food.smokedMeat)}))


func open_inventory(state: Dictionary) -> void:
	g = state
	current = "inventory"
	var v := _window(tr("Вещи"), "inventory", 700)
	var at_base := WinterSim.at_base(g)
	if at_base:
		_lead(v, tr("Склад лагеря. Вне лагеря уносишь до {n} вещей.").format({"n": WinterSim.carry_of(g)}))
	else:
		_lead(v, tr("Ноша: {n} из {m}. В лагере всё уходит на склад.").format({"n": int(g.hero.load), "m": WinterSim.carry_of(g)}))
	var list := _list(v, 520)
	_head(list, tr("Материалы: {n} из {m}").format({"n": WinterSim.stock_total(g), "m": WinterSim.D.STORE_CAP}))
	list.add_child(_grid(WinterSim.RES))
	_head(list, tr("Еда: {n} из {m}").format({"n": WinterSim.food_total(g), "m": WinterSim.food_cap(g)}))
	list.add_child(_grid(WinterSim.FOOD_ITEMS))
	_head(list, tr("Инструменты"))
	var tg := GridContainer.new()
	tg.columns = 6
	for id in WinterSim.D.TOOLS:
		tg.add_child(_slot(id, tr(TOOL_NAME[id]), "", g.tools[id]))
	for id in WinterSim.D.GEAR:
		var on: bool = int(g.gear.snares) > 0 if id == "snares" else bool(g.gear[id])
		tg.add_child(_slot(id, tr(GEAR_LABEL[id]), str(int(g.gear.snares)) if id == "snares" and on else "", on))
	list.add_child(tg)


func _grid(items: Array) -> GridContainer:
	var gr := GridContainer.new()
	gr.columns = 6
	gr.add_theme_constant_override("h_separation", 8)
	gr.add_theme_constant_override("v_separation", 8)
	for k in items:
		gr.add_child(_slot(k, tr(ITEM_NAME[k]), str(int(g.stock[k])), int(g.stock[k]) > 0))
	return gr


func _slot(id: String, name: String, count: String, on: bool) -> Control:
	var p := PanelContainer.new()
	var st := StyleBoxFlat.new()
	st.bg_color = Color(WinterTheme.PANEL_HI, 0.7 if on else 0.3)
	st.border_color = Color(WinterTheme.FROST, 0.35 if on else 0.12)
	st.set_border_width_all(1)
	st.set_corner_radius_all(10)
	st.content_margin_left = 6
	st.content_margin_right = 6
	st.content_margin_top = 6
	st.content_margin_bottom = 4
	p.add_theme_stylebox_override("panel", st)
	p.custom_minimum_size = Vector2(92, 92)
	p.tooltip_text = name
	var v := VBoxContainer.new()
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_theme_constant_override("separation", 0)
	var ic := _icon(id, 48)
	ic.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	ic.modulate = Color(1, 1, 1, 1 if on else 0.3)
	v.add_child(ic)
	var l := Label.new()
	l.text = count if count != "" else name
	l.theme_type_variation = "Small" if count == "" else ""
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.clip_text = true
	l.custom_minimum_size = Vector2(80, 0)
	v.add_child(l)
	p.add_child(v)
	return p


func open_trade(state: Dictionary) -> void:
	g = state
	current = "trade"
	var v := _window(tr("Торговец"), "trader")
	if g.trader == null:
		_lead(v, tr("Торговец уехал"))
		return
	var near := WinterSim.hyp(float(g.trader.x) + 0.5 - float(g.hero.x), float(g.trader.y) + 0.5 - float(g.hero.y)) <= float(WinterSim.D.TRADE_REACH)
	_lead(v, tr("Каждый обмен — один раз. До вечера он у ворот.") if near else tr("Подойди к саням у южных ворот."))
	var list := _list(v)
	var offers: Array = g.trader.offers
	for i in offers.size():
		var o: Dictionary = offers[i]
		var get_txt := _bag(o.get)
		var ok := WinterSim.afford(g, o.give)
		var icon_id: String = o.get.keys()[0] if not o.get.has("tool") else String(o.get.tool)
		_row(list, icon_id, tr("Получишь: {get}").format({"get": get_txt}), tr("уже обменяно") if o.taken else tr("Отдашь:"), {} if o.taken else o.give, {},
			[] if o.taken else [[tr("Обменять"), "trade", i, near and ok]])


func _bag(bag: Dictionary) -> String:
	var parts := []
	for k in bag:
		parts.append(tr(TOOL_NAME[bag.tool]) if k == "tool" else "%s ×%d" % [tr(ITEM_NAME.get(k, k)), int(bag[k])])
	return ", ".join(parts)


func open_event(state: Dictionary) -> void:
	g = state
	current = "event"
	var ev: Dictionary = g.event
	var a: Dictionary = EVENT_ASK[ev.id]
	var v := _window(tr(a.title), "warning", 560)
	var l := Label.new()
	l.text = tr(a.text).format({"cost": _cost_text(WinterSim.D.ROOF_FIX)})
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(l)
	_buttons(v, [[tr(a.yes) + "  (Y)", "answer", true, "accent"], [tr(a.no) + "  (N)", "answer", false]])


func open_pause() -> void:
	current = "pause"
	var v := _window(tr("Пауза"), "pause", 420)
	_lead(v, tr("Зима ждёт. Игра сохранена."))
	_buttons(v, [[tr("Продолжить"), "resume", null, "accent"], [tr("Настройки"), "settings", null], [tr("Главное меню"), "menu", null]], true)


func open_settings(s: Dictionary, sound_on: bool) -> void:
	settings = s
	var back := current
	current = "settings"
	var v := _window(tr("Настройки"), "settings", 560)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 10)
	v.add_child(list)
	_option(list, "sound_on" if sound_on else "sound_off", tr("Звук"), [[tr("Вкл"), true], [tr("Выкл"), false]], sound_on, "sound")
	_option(list, "settings", tr("Язык"), [["Русский", "ru"], ["Română", "ro"]], TranslationServer.get_locale().substr(0, 2), "lang")
	_option(list, "snow", tr("Погода"), [[tr("Полная"), 1.0], [tr("Экономная"), 0.5]], float(s.get("weather", 1.0)), "weather")
	_option(list, "inventory", tr("Размер интерфейса"), [["90%", 0.9], ["100%", 1.0], ["115%", 1.15], ["130%", 1.3]], float(s.get("ui", 1.0)), "ui")
	_option(list, "action", tr("Приближение"), [[tr("Дальше"), 0.85], [tr("Обычно"), 1.0], [tr("Ближе"), 1.2]], float(s.get("zoom", 1.0)), "zoom")
	_buttons(v, [[tr("Готово"), "settings_done", back, "accent"]])


func _option(list: VBoxContainer, icon_id: String, name: String, choices: Array, value, key: String) -> void:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 10)
	h.add_child(_icon(icon_id, 32))
	var l := Label.new()
	l.text = name
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(l)
	for c in choices:
		var b := Button.new()
		b.text = c[0]
		b.toggle_mode = true
		b.button_pressed = (c[1] == value) if not (c[1] is float) else absf(float(c[1]) - float(value)) < 0.01
		b.custom_minimum_size = Vector2(86, 42)
		var val = c[1]
		b.pressed.connect(func(): request.emit("setting", [key, val]))
		h.add_child(b)
	list.add_child(h)


func open_confirm(diff: String) -> void:
	current = "confirm"
	var v := _window(tr("Начать новую зиму?"), "warning", 520)
	_lead(v, tr("Текущая зима будет потеряна."))
	_buttons(v, [[tr("Начать заново"), "confirm_new", diff, "accent"], [tr("Отмена"), "menu", null]])


func open_result(state: Dictionary, can_retry: bool) -> void:
	g = state
	current = "result"
	var won: bool = g.status == "won"
	var v := _window(tr("Весна!") if won else tr("Зима победила"), "star" if won else "warning", 560)
	if won:
		var st := WinterSim.stars(g)
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_CENTER
		for k in 3:
			row.add_child(_icon("star" if k < st else "star_empty", 64))
		v.add_child(row)
	var alive := 0
	for s in g.survivors:
		if s.state == "home" or s.state == "lost":
			alive += 1
	var main := Label.new()
	main.text = tr("Ты пережил зиму. Спасено: {n} из 5.").format({"n": alive}) if won else tr("День {n}: герой не выдержал.").format({"n": WinterSim.day_of(g)})
	main.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	main.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(main)
	var built := 0
	for p in g.palisade:
		if p.built:
			built += 1
	_lead(v, tr("Хижина: {s} из 4 · постройки частокола: {p} из 4").format({"s": int(g.hut.stage), "p": built}))
	var acts := []
	if not won and can_retry:
		acts.append([tr("Начать день заново"), "retry", null, "accent"])
	acts.append([tr("Ещё одна зима"), "again", g.difficulty, "accent" if won or not can_retry else ""])
	acts.append([tr("Меню"), "menu", null])
	_buttons(v, acts)


func open_menu(sv: Dictionary, has_current: bool, current_day: int) -> void:
	save = sv
	current = "menu"
	if box:
		box.queue_free()
	dim.visible = false
	if bg == null:
		bg = TextureRect.new()
		bg.texture = WinterArt.texture("ui.menu.bg", false)
		bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		bg.set_anchors_preset(Control.PRESET_FULL_RECT)
		bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(bg)
		move_child(bg, 0)
	bg.visible = true
	box = PanelContainer.new()
	box.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
	add_child(box)
	var v := VBoxContainer.new()
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_theme_constant_override("separation", 14)
	box.add_child(v)
	var title_key := "ui.title.ro" if TranslationServer.get_locale().begins_with("ro") else "ui.title"
	if WinterArt.has(title_key):
		var t := TextureRect.new()
		t.texture = WinterArt.texture(title_key, false)
		t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		t.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		t.custom_minimum_size = Vector2(560, 190)
		v.add_child(t)
	else:
		var t := Label.new()
		t.text = tr("Долгая зима")
		t.theme_type_variation = "Title"
		t.add_theme_font_size_override("font_size", 72)
		t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(t)
	var sub := Label.new()
	sub.text = tr("Продержись 30 дней до весны: тепло, огонь, хижина и пятеро выживших.")
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	sub.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	sub.custom_minimum_size = Vector2(420, 0)
	v.add_child(sub)
	var acts := []
	if has_current:
		acts.append([tr("Продолжить: день {n}").format({"n": current_day}), "continue", null, "accent"])
	acts.append([tr("Обычная зима"), "start", "normal", "" if has_current else "accent"])
	acts.append([tr("Лютая зима"), "start", "harsh", "", bool(sv.unlocked), "" if sv.unlocked else tr("Откроется после первой весны")])
	acts.append([tr("Настройки"), "settings", null])
	if WinterStore.on_web():
		acts.append([tr("Лёгкая версия"), "classic", null])
		acts.append([tr("Все игры"), "home", null])
	var bb := _buttons(v, acts, true)
	bb.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var lines := []
	for k in ["normal", "harsh"]:
		var b := int(sv.best[k])
		if b == 0:
			continue
		var name := tr("Обычная зима") if k == "normal" else tr("Лютая зима")
		lines.append(tr("{name}: пережита, звёзд {s} из 3").format({"name": name, "s": int(sv.stars[k])}) if b > WinterSim.DAYS else tr("{name}: дней прожито — {n}").format({"name": name, "n": b}))
	if not lines.is_empty():
		var r := Label.new()
		r.text = "\n".join(lines)
		r.theme_type_variation = "Small"
		r.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(r)
	var keys := Label.new()
	keys.text = tr("Клик — идти и делать · WASD — идти · E — действие · F — поесть · B — постройки · T — верстак · I — вещи · Пробел — пауза")
	keys.theme_type_variation = "Small"
	keys.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	keys.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	keys.custom_minimum_size = Vector2(520, 0)
	v.add_child(keys)
	box.set_meta("width", 640.0)
	_place.call_deferred()
