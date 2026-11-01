class_name CountingView
extends Control
## Draws a challenge as things to count, ten-frame style (rows of five):
##   a + b:  blue stones, a plus sign, orange stones
##   a - b:  a stones with the last b crossed out
##   a + ?:  a stones and dashed empty spots for the missing part
##   a × b:  a boxes with b stones in each (equal groups)
## With numbers on, every stone that matters gets its count: all of them for addition, the ones left for
## subtraction, the empty spots for the missing part. For groups the count runs on from box to box and each
## box shows the total so far under it (counting on: 3, 6, 9).

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
	if challenge.op == MathChallenge.Op.MUL:
		_draw_groups()
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


## a boxes side by side, each with b stones in two columns.
func _draw_groups() -> void:
	var n := challenge.a
	var per := challenge.b
	var rows := ceili(per / 2.0)
	var label_h := 30.0 if numbers else 0.0
	var gap := 18.0
	# each box is 2 stones wide (step 2.4 r) plus padding r; height rows * 2.5 r plus padding
	var r := minf((size.x - gap * (n - 1)) / (n * (2 * 2.4 + 1.0)), (size.y - label_h - 8) / (rows * 2.5 + 1.0))
	r = clampf(r, 6.0, 24.0)
	var step := r * 2.4
	var box := Vector2(2 * step + r, rows * r * 2.5 + r)
	var total_w := n * box.x + (n - 1) * gap
	var x0 := (size.x - total_w) / 2.0
	var y0 := (size.y - box.y - label_h) / 2.0
	var font := get_theme_default_font()
	var count := 0
	for gi in n:
		var col := BLUE if gi % 2 == 0 else ORANGE
		var bx := x0 + gi * (box.x + gap)
		var rect := Rect2(bx, y0, box.x, box.y)
		draw_style_box(_box_style(col), rect)
		for i in per:
			var p := Vector2(bx + r / 2.0 + (i % 2) * step + step / 2.0, y0 + r / 2.0 + (i / 2) * r * 2.5 + r * 1.25)
			if per % 2 == 1 and i == per - 1:
				p.x = bx + box.x / 2.0  # the odd one out sits in the middle
			draw_circle(p, r, col)
			draw_circle(p + Vector2(-r * 0.3, -r * 0.3), r * 0.28, Color(1, 1, 1, 0.45))
			if numbers:
				count += 1
				var s := str(count)
				var fs := int(r * 1.1)
				var w := font.get_string_size(s, HORIZONTAL_ALIGNMENT_CENTER, -1, fs).x
				draw_string(font, p + Vector2(-w / 2.0, fs * 0.36), s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color.WHITE)
		if numbers:
			var t := str((gi + 1) * per)
			var fs2 := 26
			var w2 := font.get_string_size(t, HORIZONTAL_ALIGNMENT_CENTER, -1, fs2).x
			draw_string(font, Vector2(bx + (box.x - w2) / 2.0, y0 + box.y + 26), t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs2, UiTheme.INK)


func _box_style(col: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(col, 0.12)
	sb.border_color = Color(col, 0.8)
	sb.set_border_width_all(3)
	sb.set_corner_radius_all(14)
	return sb


func _dashed_circle(c: Vector2, r: float, col: Color) -> void:
	var segs := 16
	for i in segs:
		if i % 2 == 0:
			var a0 := TAU * i / segs
			var a1 := TAU * (i + 1) / segs
			draw_arc(c, r - 2, a0, a1, 4, col, 4.0)
