class_name CountingView
extends Control
## Draws a challenge as things to count, ten-frame style (rows of five):
##   a + b:  blue stones, a plus sign, orange stones
##   a - b:  a stones with the last b crossed out
##   a + ?:  a stones and dashed empty spots for the missing part
## With numbers on, every stone that matters gets its count: all of them for addition, the ones left for
## subtraction, the empty spots for the missing part.

const BLUE := Color("#6f8dff")
const ORANGE := Color("#ffa94d")
const GRAY := Color("#c3c8d2")
const RED := Color("#ff6b6b")

var challenge: MathChallenge
var numbers := false


func show_challenge(c: MathChallenge, with_numbers: bool) -> void:
	challenge = c
	numbers = with_numbers
	queue_redraw()


func _draw() -> void:
	if challenge == null:
		return
	var groups := []   # each: {n, color, crossed_from, empty}
	var sign := ""
	match challenge.op:
		MathChallenge.Op.ADD:
			groups = [{n = challenge.a, color = BLUE}, {n = challenge.b, color = ORANGE}]
			sign = "+"
		MathChallenge.Op.SUB:
			groups = [{n = challenge.a, color = BLUE, crossed_from = challenge.a - challenge.b}]
		_:
			groups = [{n = challenge.a, color = BLUE}, {n = challenge.b, color = ORANGE, empty = true}]
			sign = "+"
	var cols := 5
	var max_rows := 1
	var widths := []  # columns each group really uses, so the plus sign sits right between them
	for g in groups:
		max_rows = maxi(max_rows, ceili(g.n / float(cols)))
		widths.append(clampi(g.n, 1, cols))
	var gap_w := 60.0 if sign != "" else 0.0
	var units := 0
	for w in widths:
		units += w
	var r := minf((size.x - gap_w * (groups.size() - 1)) / (maxi(units, 5) * 2.4), (size.y - 8) / (max_rows * 2.5))
	r = clampf(r, 6.0, 30.0)
	var step := r * 2.4
	var total_w := units * step + gap_w * (groups.size() - 1)
	var x0 := (size.x - total_w) / 2.0
	var y0 := (size.y - max_rows * r * 2.5) / 2.0 + r * 1.25
	var font := get_theme_default_font()
	var count := 0
	var gx := x0
	for gi in groups.size():
		var g: Dictionary = groups[gi]
		for i in g.n:
			var p := Vector2(gx + (i % cols) * step + step / 2.0, y0 + (i / cols) * r * 2.5)
			var crossed: bool = g.has("crossed_from") and i >= g.crossed_from
			var empty: bool = g.get("empty", false)
			if empty:
				_dashed_circle(p, r, g.color)
			else:
				draw_circle(p, r, GRAY if crossed else g.color)
				draw_circle(p + Vector2(-r * 0.3, -r * 0.3), r * 0.28, Color(1, 1, 1, 0.45))
			if crossed:
				draw_line(p + Vector2(-r, -r), p + Vector2(r, r), RED, 4.0)
				draw_line(p + Vector2(-r, r), p + Vector2(r, -r), RED, 4.0)
			var counted := not crossed and (challenge.op != MathChallenge.Op.MISSING or empty)
			if numbers and counted:
				count += 1
				var s := str(count)
				var fs := int(r * 1.1)
				var w := font.get_string_size(s, HORIZONTAL_ALIGNMENT_CENTER, -1, fs).x
				draw_string(font, p + Vector2(-w / 2.0, fs * 0.36), s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color.WHITE if not empty else g.color)
		gx += widths[gi] * step
		if gi < groups.size() - 1 and sign != "":
			var sx := gx + gap_w / 2.0
			var fs := int(r * 2.0)
			draw_string(font, Vector2(sx - fs * 0.3, y0 + fs * 0.35), sign, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, UiTheme.INK)
			gx += gap_w


func _dashed_circle(c: Vector2, r: float, col: Color) -> void:
	var segs := 16
	for i in segs:
		if i % 2 == 0:
			var a0 := TAU * i / segs
			var a1 := TAU * (i + 1) / segs
			draw_arc(c, r - 2, a0, a1, 4, col, 4.0)
