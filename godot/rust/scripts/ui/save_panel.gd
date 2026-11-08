class_name SavePanel
extends PanelContainer
## «Сохранение»: autosave status, manual save/load slot, start over (asks twice), language and sound.

signal sound_toggled(on: bool)
signal language_changed

var _status: Label
var _reset: Button
var _load: Button
var _sound: Button
var _lang: Button
var _armed := 0.0


func _ready() -> void:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	add_child(v)
	var head := HBoxContainer.new()
	v.add_child(head)
	var h := UiTheme.heading("Сохранение")
	h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(h)
	_status = UiTheme.lbl("сохраняется само", 12, UiTheme.DIM)
	head.add_child(_status)
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 6)
	row.add_theme_constant_override("v_separation", 6)
	v.add_child(row)
	var save := _btn("Сохранить", "Записать игру в отдельный слот")
	save.pressed.connect(func(): Game.save_manual(); _refresh())
	row.add_child(save)
	_load = _btn("Загрузить", "Вернуться к ручному сохранению")
	_load.pressed.connect(func(): Game.load_manual())
	row.add_child(_load)
	_reset = _btn("Начать с нуля", "Стереть прогресс (достижения останутся)")
	_reset.add_theme_color_override("font_color", UiTheme.DANGER)
	_reset.pressed.connect(_on_reset)
	row.add_child(_reset)
	var row2 := HBoxContainer.new()
	row2.add_theme_constant_override("separation", 6)
	v.add_child(row2)
	_lang = _btn("", "Язык: русский / română")
	_lang.pressed.connect(func():
		Settings.set_lang("ro" if TranslationServer.get_locale().begins_with("ru") else "ru")
		language_changed.emit())
	row2.add_child(_lang)
	_sound = _btn("", "Звук (M)")
	_sound.pressed.connect(func(): sound_toggled.emit(not bool(Settings.get_value("sound", true))))
	row2.add_child(_sound)
	Game.saved.connect(func(ok, _manual): _status.text = tr("сохранено") if ok else tr("не удалось сохранить"))
	_refresh()


func _btn(text: String, tip: String) -> Button:
	var b := Button.new()
	b.text = tr(text)
	b.tooltip_text = tr(tip)
	b.focus_mode = Control.FOCUS_NONE
	return b


func _on_reset() -> void:
	if _armed <= 0.0:
		_armed = 3.0
		_reset.text = tr("Точно? Нажми ещё раз")
		return
	_armed = 0.0
	_reset.text = tr("Начать с нуля")
	Game.reset()


func _refresh() -> void:
	_load.disabled = not SaveManager.exists(SaveManager.MANUAL)
	_lang.text = "RU" if TranslationServer.get_locale().begins_with("ru") else "RO"
	_sound.text = tr("Звук: вкл") if bool(Settings.get_value("sound", true)) else tr("Звук: выкл")


func _process(delta: float) -> void:
	if _armed > 0.0:
		_armed -= delta
		if _armed <= 0.0:
			_reset.text = tr("Начать с нуля")
	if Engine.get_process_frames() % 30 == 0:
		_refresh()
