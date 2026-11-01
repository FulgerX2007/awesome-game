class_name TouchControls
extends Control
## On-screen buttons for phones and tablets: left and right at the bottom left, jump and "use" at the
## bottom right. Each one presses the same input action as the keyboard (TouchScreenButton does that and
## handles several fingers at once), so the player, the dialog and the bot need no touch code of their own.
## Shown only while a level is being played, with no menu or math dialog open, and when the "touch"
## setting says so: "auto" (only on a touch screen), "on" or "off".

## Whether the buttons are on screen right now; the world's "use" prompt shows the button's sign then.
static var shown := false

var ui: UIManager
var _buttons: Array[TouchPad] = []


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_buttons = [
		TouchPad.make("move_left", "left", 78.0, true),
		TouchPad.make("move_right", "right", 78.0, true),
		TouchPad.make("interact", "use", 66.0, false),
		TouchPad.make("jump", "jump", 92.0, false),
	]
	for b in _buttons:
		add_child(b)
	resized.connect(_layout)
	_layout()
	visible = false


static func wanted() -> bool:
	match str(ProgressManager.settings.get("touch", "auto")):
		"on":
			return true
		"off":
			return false
	return DisplayServer.is_touchscreen_available()


func _layout() -> void:
	var s := size
	_buttons[0].position = Vector2(110, s.y - 110)
	_buttons[1].position = Vector2(290, s.y - 110)
	_buttons[2].position = Vector2(s.x - 330, s.y - 96)
	_buttons[3].position = Vector2(s.x - 130, s.y - 130)


func _process(_delta: float) -> void:
	var v := wanted() and ui != null and ui.hud.visible and not ui.has_screen() and not MathChallengeManager.is_active()
	if v != visible:
		visible = v
		shown = v
		if not v:
			for b in _buttons:  # a finger still down when the buttons hide must not keep the action pressed
				if Input.is_action_pressed(b.action):
					Input.action_release(b.action)


## One round button. Drawn in code: a soft white disc with a blue sign, darker while pressed.
class TouchPad:
	extends TouchScreenButton

	var radius := 70.0
	var glyph := ""

	static func make(act: String, what: String, r: float, slide: bool) -> TouchPad:
		var b := TouchPad.new()
		b.action = act
		b.glyph = what
		b.radius = r
		b.passby_press = slide  # slide a finger from left to right without lifting it
		var c := CircleShape2D.new()
		c.radius = r
		b.shape = c
		b.shape_centered = false  # with no texture "centered" would shift the circle by its radius
		b.shape_visible = false
		b.pressed.connect(b.queue_redraw)
		b.released.connect(b.queue_redraw)
		return b

	func _draw() -> void:
		var down := is_pressed()
		draw_circle(Vector2.ZERO, radius, Color(1, 1, 1, 0.75 if down else 0.45))
		draw_arc(Vector2.ZERO, radius - 2, 0, TAU, 48, Color(0.17, 0.49, 0.91, 0.9), 4.0, true)
		var ink := Color("#1d4fa8") if down else Color("#2b7de9")
		var k := radius * 0.42
		match glyph:
			"left":
				draw_colored_polygon(PackedVector2Array([Vector2(-k, 0), Vector2(k * 0.7, -k), Vector2(k * 0.7, k)]), ink)
			"right":
				draw_colored_polygon(PackedVector2Array([Vector2(k, 0), Vector2(-k * 0.7, -k), Vector2(-k * 0.7, k)]), ink)
			"jump":
				draw_colored_polygon(PackedVector2Array([Vector2(0, -k), Vector2(k, k * 0.7), Vector2(-k, k * 0.7)]), ink)
			_:
				draw_colored_polygon(TouchPad.star(k * 1.1), ink)

	## The same four-point sparkle the world shows over things you can use.
	static func star(r: float) -> PackedVector2Array:
		var pts := PackedVector2Array()
		for i in 8:
			var a := i * TAU / 8.0 - PI / 2.0
			var d := r if i % 2 == 0 else r * 0.38
			pts.append(Vector2(cos(a), sin(a)) * d)
		return pts
