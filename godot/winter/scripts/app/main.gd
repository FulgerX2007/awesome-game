extends Node
## Долгая зима on Godot: the game's screens, input and saves. The rules live in scripts/sim (WinterSim, a port of
## web/winter/core.js); the world view in scripts/world; the HUD and windows in scripts/ui. This node owns the one
## game state `g`, steps it with real time, turns its events into banners, sounds and effects, and saves it the way
## the web game does: every 10 s, on pause, when the page or window goes away, and at every dawn (the point
## «Начать день заново» returns to).

const SAVE_KEY := "winter-godot.save"
const WEB_SAVE_KEY := "winter.save"         # the web version's save: a winter started there can go on here
const SETTINGS_KEY := "winter-godot.settings"
const SAVE_EVERY := 10.0

const EVENT_TEXT := {
	"wanderer": "В лесу лежит раненый путник. Найди его до ночи",
	"lostChild": "Ребёнок ушёл в лес и заблудился! Найди его до ночи",
	"aurora": "Ясное небо: ночью будет северное сияние",
	"thaw": "Оттепель: сегодня теплее, но завтра будет наледь",
}
const SURVIVOR_ROLE := {
	"hunter": "приносит мясо", "carpenter": "рубит лес и чинит частокол", "herbalist": "собирает ягоды и готовит",
	"smith": "добывает металл и чинит частокол", "child": "подкладывает дрова в огонь",
}
const NEED_TEXT := {"meat": "Охотник ждёт: принеси 3 куска мяса", "night": "Травница выходит только днём", "palisade": "Ребёнок пойдёт, когда лагерь будет за частоколом"}
const SNARE_FAIL := {"base": "Силки ставят в лесу, не в лагере", "far": "Силок ставят рядом с собой", "blocked": "Здесь силок не поставить", "max": "Больше четырёх силков не поставить"}
const NODE_ACT := {"tree": "Рубить", "rock": "Добыть камень", "bush": "Собрать ягоды", "scrap": "Взять железо"}

var world: WinterWorld
var ui: CanvasLayer
var hud: WinterHud
var panels: WinterPanels
var sfx: WinterSfx
var save: Dictionary
var settings := {"weather": 1.0, "ui": 1.0, "zoom": 1.0}
var g: Dictionary = {}
var screen := "menu"          # menu | play | result
var paused := false
var place_mode := ""          # "" | "torch" | "snare": the next tap places it
var ghost: Sprite2D
var ask_due := false
var trade_due := false
var pending_diff := ""
var since_save := 0.0
var step_t := 0.0
var keys := {}


func _ready() -> void:
	TranslationServer.set_locale(WinterStore.detect_lang())
	_load_settings()
	sfx = WinterSfx.new()
	add_child(sfx)
	world = WinterWorld.new()
	add_child(world)
	ui = CanvasLayer.new()
	ui.layer = 10
	add_child(ui)
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = WinterTheme.build()
	ui.add_child(root)
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hud = WinterHud.new()
	root.add_child(hud)
	hud.action.connect(_on_hud)
	panels = WinterPanels.new()
	root.add_child(panels)
	panels.request.connect(_on_panel)
	panels.hover_build.connect(func(id): if not g.is_empty(): world.camp.ghost(id, g))
	ghost = Sprite2D.new()
	ghost.visible = false
	ghost.z_index = 5
	world.add_child(ghost)
	save = WinterSim.parse_save(WinterStore.get_item(SAVE_KEY))
	if save.current == null and WinterStore.on_web():
		# a winter begun in the web version continues here (same rules, same snapshot format)
		var web := WinterSim.parse_save(WinterStore.get_item(WEB_SAVE_KEY))
		if web.current != null:
			save.current = web.current
			save.dawn = web.dawn
	get_viewport().size_changed.connect(_on_resize)
	_on_resize()
	show_menu()


## ── Settings and screen size ──

func _load_settings() -> void:
	var raw := WinterStore.get_item(SETTINGS_KEY)
	var d = JSON.parse_string(raw) if raw.begins_with("{") else null
	if d is Dictionary:
		for k in settings:
			if d.has(k) and (d[k] is float or d[k] is int):
				settings[k] = clampf(float(d[k]), 0.5, 1.4)


func _store_settings() -> void:
	WinterStore.set_item(SETTINGS_KEY, JSON.stringify(settings))


## The UI is laid out for 1280×720 on a landscape screen and 720×1280 on a portrait one, times the user's size.
func _on_resize() -> void:
	var win := get_window()
	var real := Vector2(win.size)
	var portrait := real.y > real.x * 1.05
	var base := Vector2(720, 1280) if portrait else Vector2(1280, 720)
	var k := minf(real.x / base.x, real.y / base.y)
	win.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
	win.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_EXPAND
	win.content_scale_size = Vector2i(base)
	win.content_scale_factor = clampf(float(settings.ui), 0.8, 1.4) if k > 0.0 else 1.0
	world.zoom_user = float(settings.zoom)
	world.weather.quality = float(settings.weather)
	_relayout.call_deferred()


func _relayout() -> void:
	var sz := hud.get_viewport_rect().size
	hud.layout(sz)
	panels.relayout()


## ── Saving ──

func _persist() -> void:
	WinterStore.set_item(SAVE_KEY, WinterSim.save_text(save))


func save_current() -> void:
	if g.is_empty() or g.status != "playing" or screen != "play":
		return
	save.current = WinterSim.snapshot(g)
	_persist()
	since_save = 0.0


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_APPLICATION_PAUSED or what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		save_current()
		if what == NOTIFICATION_APPLICATION_FOCUS_OUT and screen == "play" and not paused and not panels.is_open():
			set_paused(true)


## ── Games ──

func begin(state: Dictionary, diff := "normal") -> void:
	if state.is_empty():
		g = WinterSim.new_game(diff, int(Time.get_unix_time_from_system() * 1000.0) % 1000000000)
	else:
		g = state
	screen = "play"
	paused = false
	place_mode = ""
	ask_due = false
	trade_due = false
	ghost.visible = false
	panels.close()
	hud.visible = true
	world.visible = true
	world.atmosphere.visible = true
	world.show_game(g)
	if state.is_empty():
		save.current = WinterSim.snapshot(g)
		save.dawn = save.current
		_persist()
	hud.show_banner(tr("День {n}").format({"n": WinterSim.day_of(g)}), 1.6)
	_relayout()


func start(diff: String) -> void:
	if save.current != null:
		pending_diff = diff
		panels.open_confirm(diff)
		return
	begin({}, diff)


func finish() -> void:
	var won: bool = g.status == "won"
	WinterSim.record_game(save, g)
	save.current = null
	if won:
		save.dawn = null
	_persist()
	sfx.play("win" if won else "lose")
	sfx.set_loop("crackle", 0)
	sfx.set_loop("wind", 0)
	screen = "result"
	place_mode = ""
	ghost.visible = false
	panels.open_result(g, not won and save.dawn != null)


func show_menu() -> void:
	if not g.is_empty() and screen == "play":
		save_current()
	screen = "menu"
	paused = false
	place_mode = ""
	ghost.visible = false
	hud.visible = false
	sfx.set_loop("crackle", 0)
	sfx.set_loop("wind", 0.25)
	g = {}
	world.visible = false
	world.atmosphere.visible = false
	var cur = save.current
	panels.open_menu(save, cur != null, int(floor(float(cur.t) / WinterSim.DAY)) + 1 if cur != null else 1)


func set_paused(on: bool) -> void:
	if screen != "play":
		return
	paused = on
	if on:
		save_current()
		panels.open_pause()
	elif panels.current == "pause":
		panels.close()


## ── The frame ──

func _process(delta: float) -> void:
	var dt := minf(delta, 0.05)
	var running := screen == "play" and not paused and not panels.is_open()
	if running:
		var dx := int(keys.get(KEY_D, false) or keys.get(KEY_RIGHT, false)) - int(keys.get(KEY_A, false) or keys.get(KEY_LEFT, false))
		var dy := int(keys.get(KEY_S, false) or keys.get(KEY_DOWN, false)) - int(keys.get(KEY_W, false) or keys.get(KEY_UP, false))
		if dx != 0 or dy != 0 or g.hero.dir != null:
			WinterSim.move_dir(g, dx, dy)
		var moving: bool = g.hero.path != null or g.hero.dir != null
		WinterSim.step(g, dt)
		handle(WinterSim.drain(g))
		if moving:
			step_t -= dt
			if step_t <= 0.0:
				step_t = 0.35
				sfx.play("step")
		since_save += dt
		if since_save >= SAVE_EVERY:
			save_current()
		var sp: Dictionary = WinterSim.SPOT
		var near_fire := WinterSim.fire_on(g) and WinterSim.hyp(float(g.hero.x) - sp.fire.x - 0.5, float(g.hero.y) - sp.fire.y - 0.5) < 6.0
		sfx.set_loop("crackle", 1.0 if near_fire else 0.0)
		sfx.set_loop("wind", 1.0 if WinterSim.is_blizzard(g) else 0.4 if WinterSim.is_night(g) else 0.15)
		if g.status != "playing":
			finish()
		elif ask_due:
			ask_due = false
			_open_event()
		elif trade_due and g.trader != null and _trader_near() and g.hero.path == null:
			trade_due = false
			panels.open_trade(g)
		elif trade_due and (g.trader == null or (g.hero.path == null and g.hero.target == null)):
			trade_due = false
	world.frame(dt, running)
	if screen == "play" and not g.is_empty():
		hud.update(g, dt, _task_text(), _action_label())
		hud.set_markers(_markers())
		_update_ghost()


func _trader_near() -> bool:
	return WinterSim.hyp(float(g.trader.x) + 0.5 - float(g.hero.x), float(g.trader.y) + 0.5 - float(g.hero.y)) <= float(WinterSim.D.TRADE_REACH)


func _task_text() -> String:
	if place_mode == "snare":
		return tr("Нажми рядом с героем, где поставить силок")
	if place_mode == "torch":
		return tr("Нажми, где поставить факел")
	var t := WinterSim.next_task(g)
	if t.begins_with("Спаси выжившего: "):
		return tr("Спаси выжившего: {name}").format({"name": tr(t.substr(17))})
	if t.begins_with("Улучши дом: "):
		return tr("Улучши дом: {name}").format({"name": tr(t.substr(12))})
	return tr(t)


## ── Events of the rules → banners, sounds, effects ──

func banner(text: String, seconds := 1.8) -> void:
	hud.show_banner(text, seconds)


func handle(events: Array) -> void:
	for e in events:
		world.effect(e)
		match String(e.type):
			"gather":
				sfx.play({"tree": "chop", "rock": "mine"}.get(e.kind, "pick"))
			"fish":
				sfx.play("pick")
			"hunt", "hitWolf", "bearHit":
				sfx.play("hit")
			"feed", "cook", "torch":
				sfx.play("fire")
			"eat":
				sfx.play("eat")
			"craft":
				sfx.play("craft")
				var nm = WinterPanels.TOOL_NAME.get(e.tool, WinterPanels.GEAR_LABEL.get(e.tool, e.tool))
				banner(tr("Готово: {tool}").format({"tool": tr(nm)}))
			"snare", "snareCaught":
				sfx.play("snare")
			"event":
				if e.id == "roof":
					sfx.play("creak")
				if e.phase == "ask":
					ask_due = true
				else:
					banner(tr(EVENT_TEXT[e.id]), 3.5)
			"eventDone":
				_event_done(e)
			"patched":
				sfx.play("build")
				banner(tr("Крыша залатана"))
			"found":
				sfx.play("rescue")
				banner(tr("{name} снова в лагере").format({"name": tr(_sv_name(e.id))}), 2.2)
			"aurora":
				sfx.play("aurora")
				banner(tr("Северное сияние: этой ночью волки не придут"), 3)
			"ice":
				banner(tr("Наледь: вне лагеря идти тяжелее"), 2.6)
			"trader":
				sfx.play("bells")
				banner(tr("Торговец на санях у южных ворот"), 2.6)
			"traderLeft":
				banner(tr("Торговец уехал"))
				if panels.current == "trade":
					panels.close()
			"traded":
				sfx.play("trade")
			"bear":
				sfx.play("roar")
				banner(tr("В лесу бродит медведь-шатун!"), 2.6)
			"bearDead":
				banner(tr("Медведь повержен!"), 2.2)
			"built":
				sfx.play("build")
			"upgraded":
				sfx.play("build")
				banner(tr("Дом стал лучше: {name}").format({"name": tr(WinterPanels.UP_NAME[e.id])}), 2.4)
			"dig":
				sfx.play("step")
			"howl":
				sfx.play("howl")
				banner(tr("Ночь. Волки вышли на охоту"))
			"bite":
				sfx.play("bite")
			"palisadeBroken":
				banner(tr("Волки прогрызли частокол!"))
			"needs":
				banner(tr(NEED_TEXT.get(e.need, "Пока не пойдёт")), 2.4)
			"rescue":
				sfx.play("rescue")
				banner(tr("{name} идёт за тобой").format({"name": tr(_sv_name(e.id))}), 2.2)
			"joined":
				banner(tr("{name} в лагере: {role}").format({"name": tr(_sv_name(e.id)), "role": tr(SURVIVOR_ROLE[e.id])}), 2.6)
			"died":
				banner(tr("{name} не пережил холода").format({"name": tr(_sv_name(e.id))}), 2.6)
			"fireOut":
				banner(tr("Костёр погас"))
			"dawn":
				sfx.play("dawn")
				banner(tr("День {n}. Метель!").format({"n": e.day}) if e.blizzard else tr("День {n}").format({"n": e.day}))
				save.dawn = WinterSim.snapshot(g)
				save_current()


func _sv_name(id: String) -> String:
	return String(WinterSim.D.SURVIVORS[id].name)


func _event_done(e: Dictionary) -> void:
	if e.id == "lostChild":
		if e.choice == "night":
			banner(tr("Ребёнок провёл ночь в лесу"), 2.6)
		return
	if e.id == "roof":
		banner(tr("Крыша починена") if e.choice == "fix" else tr("В крыше дыра: в хижине холодно, печь прогорает быстрее"), 2.6)
		return
	if e.choice != "help":
		banner(tr("Путник ушёл"))
		return
	var r: Dictionary = e.get("reward", {})
	var gift := tr(WinterPanels.TOOL_NAME[r.tool]) if r.has("tool") else "%d %s" % [int(r.get("n", 0)), tr(WinterPanels.ITEM_NAME.get(r.get("item", ""), "")).to_lower()]
	banner(tr("Путник благодарит: {gift}").format({"gift": gift}), 2.6)
	sfx.play("rescue")


func _open_event() -> void:
	if g.event == null or g.event.phase != "ask" or screen != "play":
		return
	panels.open_event(g)


func answer(yes: bool) -> void:
	if g.is_empty() or g.event == null or g.event.phase != "ask":
		return
	var r := WinterSim.answer_event(g, WinterSim.D.EVENT_CHOICES[g.event.id][0 if yes else 1])
	if r == "nores":
		banner(tr("Не хватает припасов"))
		return
	handle(WinterSim.drain(g))
	if panels.current == "event":
		panels.close()
	save_current()


## ── Actions ──

## What the action button (E) would do: the nearest thing next to the hero (like the web version).
func action_target() -> Dictionary:
	if g.is_empty():
		return {}
	var h: Dictionary = g.hero
	var hx := int(floor(float(h.x)))
	var hy := int(floor(float(h.y)))
	var best := {}
	var bd := INF
	var consider := func(x: int, y: int, label: String):
		var d := WinterSim.hyp(x + 0.5 - float(h.x), y + 0.5 - float(h.y))
		if d <= 1.6 and d < bd:
			bd = d
			best = {"x": x, "y": y, "label": label}
	for w in g.wolves:
		consider.call(int(floor(float(w.x))), int(floor(float(w.y))), "Бить волка")
	for y in range(hy - 1, hy + 2):
		for x in range(hx - 1, hx + 2):
			var n = WinterSim.node_at(g, x, y)
			if n != null:
				consider.call(x, y, NODE_ACT[n.kind])
			if WinterSim.in_map(x, y) and g.tiles[WinterSim.idx(x, y)] == "o":
				consider.call(x, y, "Рыбачить")
	for a in g.animals:
		consider.call(int(floor(float(a.x))), int(floor(float(a.y))), "Охота")
	for s in g.survivors:
		if s.state == "waiting":
			consider.call(int(floor(float(s.x))), int(floor(float(s.y))), "Позвать")
		elif s.state == "lost":
			consider.call(int(floor(float(s.x))), int(floor(float(s.y))), "Забрать домой")
	if g.event != null and g.event.id == "wanderer" and g.event.phase == "active":
		consider.call(int(g.event.x), int(g.event.y), "К путнику")
	if g.trader != null:
		consider.call(int(g.trader.x), int(g.trader.y), "Торговать")
	if g.bear != null:
		consider.call(int(floor(float(g.bear.x))), int(floor(float(g.bear.y))), "Бить медведя")
	var sp: Dictionary = WinterSim.SPOT
	consider.call(int(sp.fire.x), int(sp.fire.y), "К костру")
	if int(g.hut.stage) >= 2:
		consider.call(int(sp.bed.x), int(sp.bed.y), "Спать")
	return best


func _action_label() -> String:
	var a := action_target()
	return tr(a.label) if not a.is_empty() else ""


func act() -> void:
	if screen != "play" or paused or panels.is_open():
		return
	var a := action_target()
	if not a.is_empty():
		tap(a.x, a.y)


func tap(x: int, y: int) -> void:
	if place_mode == "torch":
		place_mode = ""
		if not WinterSim.place_torch(g, x, y):
			banner(tr("Здесь факел не поставить"))
		handle(WinterSim.drain(g))
		return
	if place_mode == "snare":
		place_mode = ""
		var sr := WinterSim.place_snare(g, x, y)
		if sr != "ok":
			banner(tr(SNARE_FAIL.get(sr, "Здесь силок не поставить")), 1.6)
		handle(WinterSim.drain(g))
		return
	var r = WinterSim.interact(g, x, y)
	if r == "trader":
		trade_due = true
	if r == "tool":
		var n = WinterSim.node_at(g, x, y)
		banner(tr("Нужна кирка (верстак)") if n != null and n.kind == "rock" else tr("Нужен топор") if n != null else tr("Нужно копьё (верстак)"))
	elif r == "none":
		banner(tr("Туда не пройти"), 1.0)
	else:
		world.mark(Vector2i(x, y))
	handle(WinterSim.drain(g))


func eat() -> void:
	if screen != "play" or g.is_empty():
		return
	var item := WinterSim.eat(g)
	if item == "":
		banner(tr("Ты сыт") if float(g.hero.food) >= 98.0 else tr("Еды нет"), 1.2)
	handle(WinterSim.drain(g))


func to_fire() -> void:
	var sp: Dictionary = WinterSim.SPOT
	tap(int(sp.fire.x), int(sp.fire.y))


## The placement preview: the torch or the snare under the pointer, green where it fits, red where it doesn't.
func _update_ghost() -> void:
	if place_mode == "" or panels.is_open():
		ghost.visible = false
		return
	var t := world.tile_at_screen(world.get_viewport().get_mouse_position())
	var key := "torch" if place_mode == "torch" else "snare"
	if ghost.get_meta("key", "") != key:
		ghost.set_meta("key", key)
		ghost.texture = WinterArt.texture(key, false)
		ghost.centered = false
		ghost.offset = -WinterArt.foot(key)
	ghost.visible = true
	ghost.position = Vector2(t.x + 0.5, t.y + (0.7 if key == "torch" else 0.6)) * WinterWorld.TILE
	ghost.modulate = Color(0.6, 1.0, 0.7, 0.7) if _fits(t) else Color(1.0, 0.45, 0.4, 0.6)


func _fits(t: Vector2i) -> bool:
	var x := t.x
	var y := t.y
	if not WinterSim.in_map(x, y):
		return false
	for k in g.torches:
		if int(k.x) == x and int(k.y) == y:
			return false
	if place_mode == "torch":
		return WinterSim.walkable(g, x, y) and g.torches.size() < int(WinterSim.D.TORCH.max)
	for n in g.snares:
		if int(n.x) == x and int(n.y) == y:
			return false
	return not WinterSim.in_base(x, y) and g.tiles[WinterSim.idx(x, y)] == "." and WinterSim.node_at(g, x, y) == null \
		and WinterSim.hyp(x + 0.5 - float(g.hero.x), y + 0.5 - float(g.hero.y)) <= 2.0


## Arrows toward who waits off screen: survivors to rescue, the lost child, the trader, the wanderer.
func _markers() -> Array:
	var out := []
	var cam := world.camera
	var vp := hud.get_viewport_rect().size
	var xf := world.get_canvas_transform()
	var add := func(wx: float, wy: float, c: Color):
		var p: Vector2 = xf * (Vector2(wx, wy) * WinterWorld.TILE)
		if p.x >= 0 and p.y >= 0 and p.x <= vp.x and p.y <= vp.y:
			return
		var center := vp * 0.5
		var d := p - center
		# inside the band between the top bar with the task card and the bottom buttons
		var k := minf((vp.x * 0.5 - 40) / maxf(1e-6, absf(d.x)), (vp.y * 0.5 - 150) / maxf(1e-6, absf(d.y)))
		out.append({"p": center + d * k, "a": d.angle(), "color": c})
	for s in g.survivors:
		if s.state == "waiting":
			add.call(float(s.x), float(s.y), WinterTheme.WARM)
		elif s.state == "lost":
			add.call(float(s.x), float(s.y), WinterTheme.BAD)
	if g.trader != null:
		add.call(float(g.trader.x) + 0.5, float(g.trader.y) + 0.5, WinterTheme.GOOD)
	if g.event != null and g.event.id == "wanderer" and g.event.phase == "active":
		add.call(float(g.event.x) + 0.5, float(g.event.y) + 0.5, WinterTheme.FROST)
	var _c := cam
	return out


## ── Input ──

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventKey:
		_key(e)
		return
	if screen != "play" or paused or panels.is_open():
		return
	var press := false
	var pos := Vector2.ZERO
	if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		press = true
		pos = e.position
	elif e is InputEventScreenTouch and e.pressed:
		press = true
		pos = e.position
	elif e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_RIGHT and place_mode != "":
		place_mode = ""
		return
	if press:
		var t := world.tile_at_screen(pos)
		if WinterSim.in_map(t.x, t.y):
			tap(t.x, t.y)


func _key(e: InputEventKey) -> void:
	var k := e.keycode
	if k in [KEY_W, KEY_A, KEY_S, KEY_D, KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT]:
		keys[k] = e.pressed
		if not e.pressed and not g.is_empty() and screen == "play" and not keys.values().has(true):
			WinterSim.move_dir(g, 0, 0)
		return
	if not e.pressed or e.echo:
		return
	if k == KEY_M:
		_toggle_sound()
		return
	if k == KEY_ESCAPE:
		if place_mode != "":
			place_mode = ""
		elif panels.current in ["build", "bench", "trade", "inventory"]:
			panels.close()
		elif panels.current == "event":
			answer(false)
		elif panels.current == "settings":
			_on_panel("settings_done", "pause" if paused else "menu")
		elif panels.current == "confirm":
			show_menu()
		elif screen == "play":
			if not paused:
				set_paused(true)
			else:
				show_menu()
		elif screen == "result":
			show_menu()
		return
	if screen != "play" or g.is_empty():
		return
	if panels.current == "event" and k in [KEY_Y, KEY_N]:
		answer(k == KEY_Y)
		return
	if k == KEY_SPACE:
		set_paused(not paused)
		return
	if paused:
		return
	match k:
		KEY_E, KEY_ENTER:
			act()
		KEY_F:
			eat()
		KEY_G:
			to_fire()
		KEY_B:
			_toggle_panel("build")
		KEY_T:
			_toggle_panel("bench")
		KEY_I:
			_toggle_panel("inventory")


func _toggle_panel(name: String) -> void:
	if panels.current == name:
		panels.close()
		return
	match name:
		"build": panels.open_build(g)
		"bench": panels.open_bench(g)
		"inventory": panels.open_inventory(g)
	sfx.play("click")


func _toggle_sound() -> void:
	sfx.set_enabled(not sfx.enabled)


func _on_hud(name: String) -> void:
	if screen != "play":
		return
	sfx.play("click")
	match name:
		"act": act()
		"fire": to_fire()
		"eat": eat()
		"build", "bench", "inventory": _toggle_panel(name)
		"pause": set_paused(not paused)


func _on_panel(what: String, arg: Variant) -> void:
	sfx.play("click")
	match what:
		"close":
			panels.close()
		"contribute":
			var r := WinterSim.contribute(g, arg)
			if r == "nores":
				banner(tr("Нечего внести"), 1.2)
			elif r == "locked":
				banner(tr("Сначала печь в хижине"), 1.2)
			elif r == "far":
				banner(tr("Строить можно только в лагере."), 1.2)
			handle(WinterSim.drain(g))
			panels.open_build(g)
			save_current()
		"torch":
			place_mode = "torch"
			panels.close()
		"snare":
			place_mode = "snare"
			panels.close()
		"craft":
			var r := WinterSim.craft(g, arg)
			if r == "nores":
				banner(tr("Не хватает"), 1.2)
			handle(WinterSim.drain(g))
			panels.open_bench(g)
			save_current()
		"trade":
			var r := WinterSim.trade(g, arg)
			if r != "ok":
				banner(tr("Не хватает") if r == "nores" else tr("Не получилось"), 1.2)
			handle(WinterSim.drain(g))
			panels.open_trade(g)
			save_current()
		"answer":
			answer(bool(arg))
		"resume":
			set_paused(false)
		"settings":
			panels.open_settings(settings, sfx.enabled)
		"settings_done":
			panels.close()
			if screen == "play" and paused:
				panels.open_pause()
			elif screen == "menu":
				show_menu()
		"setting":
			var key: String = arg[0]
			var val = arg[1]
			match key:
				"sound": sfx.set_enabled(bool(val))
				"lang":
					TranslationServer.set_locale(val)
					WinterStore.set_item("lang", val)
				_:
					settings[key] = float(val)
					_store_settings()
					_on_resize()
			panels.open_settings(settings, sfx.enabled)
		"menu":
			show_menu()
		"continue":
			var st = WinterSim.restore(save.current)
			if st == null:
				save.current = null
				_persist()
				show_menu()
				return
			begin(st)
		"start":
			start(arg)
		"confirm_new":
			save.current = null
			save.dawn = null
			_persist()
			begin({}, arg)
		"again":
			begin({}, arg)
		"retry":
			var st = WinterSim.retry_day(save)
			if st != null:
				begin(st)
		"classic":
			JavaScriptBridge.eval("location.href = '../winter/'")
		"home":
			JavaScriptBridge.eval("location.href = '../'")
