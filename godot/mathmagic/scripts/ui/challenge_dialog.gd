class_name ChallengeDialog
extends Control
## The math panel at the bottom of the screen. The world stays visible above it (the camera frames the puzzle),
## so a wrong answer can be seen doing something there. No timer, unlimited tries: a wrong button is greyed
## out with a gentle "a little more / a little less", and after two misses the numbered hint appears by itself.
## Keys: 1-4 answer, H hint, Esc "later". The requester is any object with prompt(), submit_answer(v) and
## dialog_closed(solved): a puzzle or the boss.

const AUTO_HINT_AFTER := 2

var challenge: MathChallenge
var requester: Object
var _hint_level := 0
var _misses := 0
var _closing := false
var _prompt_text := ""

var _panel: PanelContainer
var _prompt: Label
var _equation: Label
var _view: CountingView
var _answers: HBoxContainer
var _feedback: Label
var _hint_btn: Button
var _later_btn: Button
var _buttons: Array[Button] = []


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	process_mode = Node.PROCESS_MODE_ALWAYS
	visible = false
	_panel = PanelContainer.new()
	_panel.theme_type_variation = "Card"
	_panel.anchor_left = 0.0
	_panel.anchor_right = 1.0
	_panel.anchor_top = 1.0
	_panel.anchor_bottom = 1.0
	_panel.offset_left = 24
	_panel.offset_right = -24
	_panel.offset_bottom = -16
	_panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	add_child(_panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	_panel.add_child(v)
	_prompt = UiTheme.label("", "")
	v.add_child(_prompt)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 24)
	v.add_child(row)
	_equation = UiTheme.label("", "Title")
	_equation.add_theme_font_size_override("font_size", 64)
	_equation.custom_minimum_size.x = 330
	_equation.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	_equation.autowrap_mode = TextServer.AUTOWRAP_OFF
	_equation.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(_equation)
	_view = CountingView.new()
	_view.custom_minimum_size = Vector2(300, 110)
	_view.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_view)
	var bottom := HBoxContainer.new()
	bottom.add_theme_constant_override("separation", 16)
	v.add_child(bottom)
	_hint_btn = UiTheme.button("Hint (H)")
	_hint_btn.pressed.connect(show_hint)
	_hint_btn.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	bottom.add_child(_hint_btn)
	_answers = HBoxContainer.new()
	_answers.alignment = BoxContainer.ALIGNMENT_CENTER
	_answers.add_theme_constant_override("separation", 22)
	_answers.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bottom.add_child(_answers)
	_later_btn = UiTheme.button("Later (Esc)")
	_later_btn.pressed.connect(func(): _close(false))
	_later_btn.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	bottom.add_child(_later_btn)
	_feedback = _prompt  # one line on top: the question, then the feedback in its place
	MathChallengeManager.challenge_opened.connect(open)


func open(c: MathChallenge, who: Object) -> void:
	challenge = c
	requester = who
	_hint_level = 0
	_misses = 0
	_closing = false
	_prompt_text = tr(who.prompt()) if who.has_method("prompt") else ""
	_prompt.text = _prompt_text
	_prompt.add_theme_color_override("font_color", UiTheme.INK)
	_equation.text = c.question_text()
	_equation.modulate = Color.WHITE
	_hint_btn.disabled = false
	for b in _buttons:
		b.queue_free()
	_buttons.clear()
	for i in c.choices.size():
		var b := UiTheme.button(str(c.choices[i]), "AnswerButton")
		b.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		b.custom_minimum_size = Vector2(140, 100)
		b.tooltip_text = str(i + 1)
		var value: int = c.choices[i]
		b.pressed.connect(func(): answer(value))
		_answers.add_child(b)
		_buttons.append(b)
		var key := Label.new()  # the keyboard number in the corner
		key.text = str(i + 1)
		key.theme_type_variation = "Small"
		key.position = Vector2(10, 4)
		b.add_child(key)
	_refresh_view()
	visible = true
	_panel.scale = Vector2(1, 0.85)
	_panel.pivot_offset = Vector2(_panel.size.x / 2.0, _panel.size.y)
	create_tween().tween_property(_panel, "scale", Vector2.ONE, 0.18).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func _refresh_view() -> void:
	_view.visible = challenge.visual or _hint_level > 0
	_view.show_challenge(challenge, _hint_level > 0)


func show_hint() -> void:
	if challenge == null or _closing or _hint_level > 0:
		return
	_hint_level = 1
	_hint_btn.disabled = true
	_feedback.text = tr(challenge.hint_key())
	_feedback.add_theme_color_override("font_color", UiTheme.BLUE)
	Sfx.play("hint")
	_refresh_view()


func answer(value: int) -> void:
	if _closing or challenge == null or requester == null:
		return
	var res: Dictionary = requester.submit_answer(value)
	var btn := _button_for(value)
	if res.get("correct", false):
		_closing = true
		Sfx.play("correct")
		_equation.text = challenge.solved_text()
		_equation.modulate = Color("#e9fff0")
		_feedback.text = tr(res.get("message", "Great job!"))
		_feedback.add_theme_color_override("font_color", UiTheme.GREEN)
		if btn:
			btn.theme_type_variation = "PrimaryButton"
			btn.pivot_offset = btn.size / 2.0
			var tw := btn.create_tween()
			tw.tween_property(btn, "scale", Vector2.ONE * 1.15, 0.12)
			tw.tween_property(btn, "scale", Vector2.ONE, 0.15)
		await get_tree().create_timer(1.1).timeout
		_close(true)
	else:
		_misses += 1
		_feedback.text = tr(res.get("message", "Try again!"))
		_feedback.add_theme_color_override("font_color", UiTheme.ORANGE)
		if btn:
			btn.disabled = true
			var x := btn.position.x
			var tw := btn.create_tween()
			for i in 2:
				tw.tween_property(btn, "position:x", x + 8, 0.05)
				tw.tween_property(btn, "position:x", x - 8, 0.05)
			tw.tween_property(btn, "position:x", x, 0.05)
		if _misses >= AUTO_HINT_AFTER and _hint_level == 0:
			await get_tree().create_timer(0.8).timeout
			if not _closing and visible:
				show_hint()


func _button_for(value: int) -> Button:
	for b in _buttons:
		if b.text == str(value):
			return b
	return null


func _close(solved: bool) -> void:
	if not visible:
		return
	visible = false
	var r := requester
	requester = null
	challenge = null
	MathChallengeManager.close(solved)
	if r and is_instance_valid(r) and r.has_method("dialog_closed"):
		r.dialog_closed(solved)


func _unhandled_input(event: InputEvent) -> void:
	if not visible or _closing:
		return
	for i in 4:
		if event.is_action_pressed("answer_%d" % (i + 1)) and i < _buttons.size() and not _buttons[i].disabled:
			_buttons[i].pressed.emit()
			get_viewport().set_input_as_handled()
			return
	if event.is_action_pressed("hint"):
		show_hint()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("pause"):
		_close(false)
		get_viewport().set_input_as_handled()
