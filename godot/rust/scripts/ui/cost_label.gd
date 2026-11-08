class_name CostLabel
extends HBoxContainer
## A cost as coloured chips: "● 120  ● 3"; a chip turns red while the stock is short of it.

var _chips := {}


func _init() -> void:
	add_theme_constant_override("separation", 10)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	for id in ["parts", "cores"]:
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 4)
		h.mouse_filter = Control.MOUSE_FILTER_IGNORE
		h.add_child(UiTheme.dot(GameData.resource(id).color, 9))
		var l := UiTheme.lbl("", 14)
		h.add_child(l)
		add_child(h)
		_chips[id] = [h, l]


func show_cost(cost: Dictionary, s: GameState) -> void:
	for id in _chips:
		var need := float(cost.get(id, 0.0))
		var h: HBoxContainer = _chips[id][0]
		var l: Label = _chips[id][1]
		h.visible = need > 0.0
		l.text = Fmt.num(need)
		var have: float = s.parts if id == "parts" else s.cores
		l.add_theme_color_override("font_color", UiTheme.DANGER if have < need else UiTheme.FG)
