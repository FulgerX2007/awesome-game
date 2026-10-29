extends Node
## Глубина on Godot: the game loop, input, events, saves and language. A port of web/deep/game.js;
## the simulation is core.gd, the picture sea.gd, the interface hud.gd.

const Core := preload("res://scripts/core.gd")
const SAVE_KEY := "deep.save"
const ATLAS_KEY := "deep.atlas"
const STAGE_TEXT := [
	"", "Появились лапки и усики. Теперь тебя видно в микроскоп.",
	"Плавник, хвост и глаза. Стайки мальков разбегаются от тебя.",
	"Ты рыба. Здесь уже водятся хищники, держи ухо востро.",
	"Щупальца ловят всё, что меньше. Ты быстрый и опасный.",
	"Ты акула. Опасаться почти некого.",
	"Ты стал китом. Но моряки рассказывают о тех, кто ещё больше.",
	"Ты стал легендой. Теперь о тебе рассказывают страшные истории.",
	"Ты Левиафан, царь глубин. Океан снова спокоен, и он твой.",
]

var W  # DeepCore.World
var playing := false
var best := 0.0
var atlas := {}           # species id -> {seen, eaten}, the same JSON as the web version
var atlas_dirty := false
var atlas_was_playing := false
var cam := {x = 0.0, y = 0.0, z = 1.0}
var fx := {danger = 0.0, flash = 0.0}
var view := Vector2(1280, 720)
var whale_stage := 0
var touch := false

var sea: DeepSea
var hud: DeepHud
var sound: DeepSound

# input
var pointer := Vector2.ZERO
var pointer_on := false
var pointer_mouse := true
var dash_req := false
var _hud_t := 0.0
var _save_t := 0.0
var _keepalive: JavaScriptObject


func _ready() -> void:
	Core.load_data()
	TranslationServer.set_locale(DeepStore.detect_lang())
	for i in Core.STAGES.size():
		if Core.STAGES[i].kind == "whale":
			whale_stage = i
	touch = DeepStore.touch_screen()

	sea = DeepSea.new()
	sea.reduce_motion = DeepStore.prefers_reduced_motion()
	add_child(sea)
	sound = DeepSound.new()
	add_child(sound)
	hud = DeepHud.new()
	add_child(hud)
	hud.start_pressed.connect(start)
	hud.restart_pressed.connect(func():
		start_world(Core.START_R)
		start())
	hud.atlas_opened.connect(open_atlas)
	hud.atlas_closed.connect(close_atlas)
	hud.sound_pressed.connect(func():
		sound.start()
		sound.toggle()
		update_hud())
	hud.lang_pressed.connect(switch_lang)
	hud.home_pressed.connect(func(): JavaScriptBridge.eval("location.href = new URL('../', location.href).href"))
	hud.dash_pressed.connect(func(): dash_req = true)

	get_window().size_changed.connect(_resize)
	_resize()
	best = float(DeepStore.get_item("deep.best")) if DeepStore.get_item("deep.best") != "" else 0.0
	_load_atlas()
	_load_save()
	if W == null:
		start_world(Core.START_R)
	_menu_texts()
	update_hud()
	_check_home()
	if DeepStore.on_web():
		# keep the save when the tab closes, like the web version
		_keepalive = JavaScriptBridge.create_callback(func(_args): save())
		JavaScriptBridge.get_interface("window").addEventListener("pagehide", _keepalive)
	hud.btn_start.grab_focus.call_deferred()


## Lays the interface out in CSS pixels: the window is scaled by the screen's pixel ratio.
func _resize() -> void:
	var win := get_window()
	var ratio := maxf(1.0, DeepStore.pixel_ratio())
	win.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
	win.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_EXPAND
	win.content_scale_size = Vector2i(maxi(1, int(win.size.x / ratio)), maxi(1, int(win.size.y / ratio)))
	view = Vector2(win.content_scale_size)
	hud.layout(view)


func start_world(r0: float, depth := 0.15) -> void:
	if W:
		Core.free_world(W)
	W = Core.create_world(randi(), r0, depth)
	cam.x = W.player.x
	cam.y = W.player.y
	cam.z = target_zoom()
	sea.clear()


func target_zoom() -> float:
	return minf(view.x, view.y) / Core.view_size(W.player.r)


func save() -> void:
	if W:
		DeepStore.set_item(SAVE_KEY, JSON.stringify({r = W.player.r, peak = W.player.peak, depth = W.player.depth}))


## Continue at the size you reached last time, in a fresh stretch of ocean.
func _load_save() -> void:
	var saved = JSON.parse_string(DeepStore.get_item(SAVE_KEY)) if DeepStore.get_item(SAVE_KEY) != "" else null
	if saved is Dictionary and float(saved.get("r", 0)) > Core.START_R + 0.5:
		var d = saved.get("depth")
		start_world(float(saved.r), float(d) if d is float else 0.15)
		W.player.peak = float(saved.get("peak", saved.r))
		hud.btn_restart.visible = true


func _load_atlas() -> void:
	var a = JSON.parse_string(DeepStore.get_item(ATLAS_KEY)) if DeepStore.get_item(ATLAS_KEY) != "" else null
	atlas = a if a is Dictionary else {}
	# The first cell used to be the freshwater paramecium; its record now belongs to the marine ciliate.
	if atlas.has("paramecium"):
		if not atlas.has("ciliate"):
			atlas.ciliate = atlas.paramecium
		atlas.erase("paramecium")
		DeepStore.set_item(ATLAS_KEY, JSON.stringify(atlas))


func note(sp: String, field: String) -> bool:
	if not atlas.has(sp):
		atlas[sp] = {seen = 0, eaten = 0}
	var rec: Dictionary = atlas[sp]
	var is_new: bool = not rec.get("seen", 0)
	rec[field] = rec.get(field, 0) + 1
	if field == "eaten" and not rec.get("seen", 0):
		rec.seen = 1
	atlas_dirty = true
	return is_new


func known() -> int:
	var n := 0
	for s in Core.SPECIES:
		if atlas.has(s.id) and atlas[s.id].get("seen", 0):
			n += 1
	return n


# ───────────── Text helpers ─────────────
func t(key: String, vars := {}) -> String:
	return tr(key).format(vars)


func stage_name(i: int) -> String:
	return tr(Core.STAGES[i].name)


func sp_name(id: String) -> String:
	return tr(Core.SPECIES_BY_ID[id].name)


## Thousands grouped like Intl.NumberFormat: "10 994" in Russian, "10.994" in Romanian.
func group(n: int) -> String:
	var s := str(n)
	var sep := "." if TranslationServer.get_locale().begins_with("ro") else " "
	var out := ""
	while s.length() > 3:
		out = sep + s.right(3) + out
		s = s.left(s.length() - 3)
	return s + out


func pct(v: float) -> String:
	var s := ("%.1f" % v).trim_suffix(".0").replace(".", ",")
	return s


func _menu_texts() -> void:
	var ro := TranslationServer.get_locale().begins_with("ro")
	hud.btn_lang.text = "RU" if ro else "RO"
	hud.btn_lang.tooltip_text = "Русский" if ro else "Română"
	if hud.btn_restart.visible and W and W.player.r > Core.START_R + 0.5:
		hud.btn_start.text = t("Продолжить: {stage}, {len}", {stage = stage_name(W.player.stage).to_lower(), len = Core.length_text(W.player.r)})
	else:
		hud.btn_start.text = tr("Нырнуть")


func switch_lang() -> void:
	var next := "ru" if TranslationServer.get_locale().begins_with("ro") else "ro"
	DeepStore.set_item("lang", next)
	TranslationServer.set_locale(next)
	_menu_texts()
	update_hud()


func update_hud() -> void:
	var p = W.player
	var pr := Core.progress(p.r)
	var k: float = pr.k
	var next: String
	if pr.next == -1:
		next = t("Рост до {len} · {pct}%", {len = Core.length_text(Core.MAX_R), pct = int(k * 100)})
	else:
		next = t("Дальше: {stage} · {pct}%", {stage = stage_name(pr.next), pct = int(k * 100)})
	hud.update(p,
		stage_name(p.stage),
		t("длина {len}", {len = Core.length_text(p.r)}),
		t("глубина {m} м · {zone}", {m = group(int(round(Core.meters_at(p.depth)))), zone = tr(Core.ZONES[p.zone].name)}),
		next, k, p.invuln > 0 and W.deaths > 0,
		t("рекорд: {len}", {len = Core.length_text(best)}) if best > 0 else "",
		t("Атлас {n}/{total}", {n = known(), total = Core.SPECIES.size()}),
		tr("Звук: выкл" if sound.muted else "Звук: вкл"))


# ───────────── Events ─────────────
func handle_events() -> void:
	var p = W.player
	for e in W.events:
		match e.type:
			"eat":
				sound.gulp(e.r / p.r)
				sea.burst(e.x, e.y, e.r, Color(220 / 255.0, 1, 230 / 255.0, 0.8))
				# How far this bite moved you towards the next stage.
				if e.pct >= 0.05:
					hud.floater(world_to_screen(e.x, e.y), "+%s%%" % pct(e.pct))
				if note(e.sp, "eaten"):
					new_species(e.sp)
			"meet":
				if note(e.sp, "seen"):
					new_species(e.sp)
			"zone":
				var z: Dictionary = Core.ZONES[e.zone]
				if e.down:
					sound.zone(e.zone)
				hud.toast(tr(z.name), tr(z.text) if e.first else t("глубина {m} м", {m = group(int(z.top))}), 5.0 if e.first else 2.5)
			"dash":
				sound.dash()
			"stage":
				sound.stage()
				if e.stage == whale_stage:
					sound.whale()
				if e.stage > whale_stage:
					sound.legend()
				hud.toast(stage_name(e.stage), tr(STAGE_TEXT[e.stage]), 5)
				save()
			"death":
				sound.eaten()
				fx.flash = 1.0
				hud.toast(t("Тебя поймали: {name}", {name = sp_name(e.by)}), tr("Ты потерял половину размера, но плывёшь дальше."), 4)
				save()
	W.events.clear()
	if atlas_dirty:
		atlas_dirty = false
		DeepStore.set_item(ATLAS_KEY, JSON.stringify(atlas))
	if p.peak > best:
		best = p.peak
		DeepStore.set_item("deep.best", str(best))


func new_species(id: String) -> void:
	sound.discover()
	hud.toast(t("Новый вид: {name}", {name = sp_name(id)}), t("Запись в атласе: {n} из {total}", {n = known(), total = Core.SPECIES.size()}), 3.5)


func world_to_screen(x: float, y: float) -> Vector2:
	return Vector2((x - cam.x) * cam.z + view.x / 2, (y - cam.y) * cam.z + view.y / 2)


# ───────────── Atlas ─────────────
func open_atlas() -> void:
	atlas_was_playing = playing
	playing = false
	for c in hud.atlas_grid.get_children():
		c.queue_free()
	for sp in Core.SPECIES:
		var rec = atlas.get(sp.id)
		var seen: bool = rec != null and rec.get("seen", 0)
		var zones: Array = []
		if sp.get("legend", false):
			zones.append(tr("Легенда"))
		for z in sp.zones:
			zones.append(tr(Core.ZONES[int(z)].name))
		var painted: bool = seen and sp.art
		var pic: Texture2D = load("res://assets/art/%s.webp" % sp.id) if painted else sea.textures(sp.id).body
		var card := hud.atlas_card(pic, not seen, painted,
			sp_name(sp.id) if seen else "???", ", ".join(zones),
			tr(sp.fact) if seen else tr("Ещё не встречался."),
			t("встречено: {seen} · съедено: {eaten}", {seen = int(rec.seen), eaten = int(rec.get("eaten", 0))}) if seen else "")
		hud.atlas_grid.add_child(card)
	hud.atlas_count.text = t("{n} из {total}", {n = known(), total = Core.SPECIES.size()})
	hud.atlas_scroll.scroll_vertical = 0
	hud.atlas.visible = true


func close_atlas() -> void:
	hud.atlas.visible = false
	if atlas_was_playing:
		playing = true


# ───────────── Flow ─────────────
func start() -> void:
	sound.start()
	if W == null:
		start_world(Core.START_R)
	playing = true
	hud.menu.visible = false
	hud.hud.visible = true
	hud.dash.visible = touch
	hud.toast(stage_name(W.player.stage), tr("Ешь тех, кто меньше. Красное свечение — опасность."), 4)


## Shows "← Игры" only when the Go server that hosts all the games answers.
func _check_home() -> void:
	if not DeepStore.on_web():
		return
	var url = JavaScriptBridge.eval("new URL('../healthz', location.href).href", true)
	if not url is String:
		return
	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(func(result, code, _h, body):
		hud.btn_home.visible = result == HTTPRequest.RESULT_SUCCESS and code == 200 and body.get_string_from_utf8().strip_edges() == "ok"
		req.queue_free())
	req.request(url)


# ───────────── Input ─────────────
func _unhandled_input(event: InputEvent) -> void:
	if hud.atlas.visible:
		if event.is_action_pressed("ui_cancel"):
			close_atlas()
		return
	if event is InputEventScreenTouch:
		sound.start()
		pointer = event.position
		pointer_on = event.pressed
		pointer_mouse = false
		if playing and not touch:
			touch = true
			hud.dash.visible = true
	elif event is InputEventScreenDrag:
		pointer = event.position
		pointer_on = true
		pointer_mouse = false
	elif event is InputEventMouseButton and event.device != InputEvent.DEVICE_ID_EMULATION:
		if event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			sound.start()
			pointer = event.position
			pointer_on = true
			pointer_mouse = true
			dash_req = true
	elif event is InputEventMouseMotion and event.device != InputEvent.DEVICE_ID_EMULATION:
		pointer = event.position
		pointer_on = true
		pointer_mouse = true
	elif event is InputEventKey and event.pressed and not event.echo:
		sound.start()
		if not playing:
			if event.keycode in [KEY_ENTER, KEY_KP_ENTER]:
				start()
			return
		if event.keycode == KEY_SPACE:
			dash_req = true
			get_viewport().set_input_as_handled()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_MOUSE_EXIT and pointer_mouse:
		pointer_on = false
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		save()


func read_input() -> Dictionary:
	var p = W.player
	var kx := 0
	var ky := 0
	if Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT):
		kx -= 1
	if Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT):
		kx += 1
	if Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP):
		ky -= 1
	if Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN):
		ky += 1
	var dash := dash_req
	dash_req = false
	if kx or ky:
		return {tx = p.x + kx * p.r * 20, ty = p.y + ky * p.r * 20, dash = dash}
	if pointer_on:
		return {tx = (pointer.x - view.x / 2) / cam.z + cam.x, ty = (pointer.y - view.y / 2) / cam.z + cam.y, dash = dash}
	return {dash = dash}


func _process(delta: float) -> void:
	var dt := minf(delta, 0.05)
	var now := Time.get_ticks_msec() / 1000.0
	if playing:
		Core.step(W, dt, read_input())
		handle_events()
		var chased := false
		for e in W.ents:
			if e.mode == "hunt" and e.target == W.player:
				chased = true
				break
		fx.danger += ((1.0 if chased else 0.0) - fx.danger) * (1 - exp(-dt * 3))
		sound.set_danger(fx.danger)
		_save_t += dt
		if _save_t > 5:
			_save_t = 0
			save()
	else:
		W.player.invuln = 1  # the menu is a safe window onto the sea
		Core.step(W, dt, {})
		W.events.clear()
		for e in W.ents:
			e.met = false  # the atlas only counts what you meet while swimming
		sound.set_danger(0)
	fx.flash = maxf(0, fx.flash - dt * 1.5)
	var k := 1 - exp(-dt * 4)
	cam.x += (W.player.x - cam.x) * k
	cam.y += (W.player.y - cam.y) * k
	cam.z += (target_zoom() - cam.z) * (1 - exp(-dt * 1.2))
	sea.render(W, cam, view, now, dt, fx)
	hud.cursor_on = pointer_on and pointer_mouse and playing
	hud.cursor_pos = pointer
	hud.cursor.queue_redraw()
	_hud_t += dt
	if _hud_t > 0.1:
		_hud_t = 0
		update_hud()
