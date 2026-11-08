class_name UpgradePanel
extends PanelContainer
## «Мастерская»: every upgrade in data order. Locked ones are shown dimmed with what opens them, so the
## path ahead is visible; the next couple of locked ones only, to keep the list short.

const SHOW_LOCKED := 2

var _cards: Array[UpgradeCard] = []
var _hint: Label


func _ready() -> void:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	add_child(v)
	v.add_child(UiTheme.heading("Мастерская"))
	for u in GameData.upgrades():
		var c: UpgradeCard = preload("res://scenes/ui/upgrade_card.tscn").instantiate()
		c.setup(u.id)
		v.add_child(c)
		_cards.append(c)
	_hint = UiTheme.lbl("Новые чертежи откроются, когда свалка оживёт.", 12, UiTheme.DIM)
	_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(_hint)
	Game.ticked.connect(refresh)
	Game.changed.connect(refresh)
	Game.state_replaced.connect(refresh)
	refresh()


func refresh() -> void:
	var s := Game.s
	var locked_shown := 0
	var hidden := 0
	for c in _cards:
		var u := GameData.upgrade(c.id)
		var open := UpgradeManager.unlocked(s, u)
		if open:
			c.visible = true
		else:
			c.visible = locked_shown < SHOW_LOCKED
			locked_shown += 1
			if not c.visible:
				hidden += 1
		if c.visible:
			c.refresh(s)
	_hint.visible = hidden > 0
