class_name BossRune
extends PuzzleBase
## A crystal in the Stone Guardian's arena. It wakes up only while the Guardian is tired in this rune's
## phase; its challenge is what the phase is about (addition, subtraction, then the child's weakest skill).
## The right answer hurts nothing but the Guardian's magic: the guardian decides what happens in the world.

var guardian: StoneGuardian
var phase := 0
var _crystal: MeshInstance3D
var _beam: MeshInstance3D
var _ready_t := 0.0

const PROMPTS := ["Add to break the shield!", "Take away to start the stone stairs!", "The last spell! Solve it to calm the Guardian."]
const COLORS := [Color("#4cc9f0"), Color("#ff9f1c"), Color("#c77dff")]


func prompt() -> String:
	return PROMPTS[phase]


func sort_key() -> float:
	return 10000.0 + phase


## After a rune the mage comes back at the arena entrance, never on top of the stairs.
func checkpoint_position() -> Vector3:
	return guardian.global_position + Vector3(StoneGuardian.ARENA_LEFT + 1.5, 0.6, 0) if guardian else super()


func _make_challenge() -> MathChallenge:
	match phase:
		0:
			return MathChallengeManager.create("add", 2, 3)
		1:
			return MathChallengeManager.create("sub", 2, 3)
	return MathChallengeManager.create(MathChallengeManager.weakest_skill(["add", "sub", "missing"]), 2, 4)


func _build() -> void:
	challenge = _make_challenge()
	var base := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.55
	cyl.bottom_radius = 0.7
	cyl.height = 0.8
	base.mesh = cyl
	base.material_override = Art.material(Color("#8d8a99"))
	base.position.y = 0.4
	add_child(base)
	_crystal = MeshInstance3D.new()
	var pm := PrismMesh.new()
	pm.size = Vector3(0.6, 0.9, 0.6)
	_crystal.mesh = pm
	_crystal.position.y = 1.4
	add_child(_crystal)
	_beam = MeshInstance3D.new()  # a column of light while the rune is waiting for the child
	var bm := CylinderMesh.new()
	bm.top_radius = 0.35
	bm.bottom_radius = 0.35
	bm.height = 8.0
	_beam.mesh = bm
	_beam.material_override = Art.material(COLORS[phase], 1.5, 0.25)
	_beam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_beam.position.y = 4.5
	add_child(_beam)
	set_awake(false)


func _process(delta: float) -> void:
	if _crystal:
		_crystal.rotation.y += delta * (2.5 if interactable.enabled else 0.4)


## Only usable while the Guardian rests in this rune's phase.
func set_awake(on: bool) -> void:
	if state == State.SOLVED:
		on = false
	interactable.enabled = on
	_beam.visible = on
	_crystal.material_override = Art.material(COLORS[phase] if on or state == State.SOLVED else Color("#5b5670"), 2.0 if on else 0.3)
	if state == State.SOLVED:
		_crystal.material_override = Art.material(Color("#5be37d"), 1.2)


func _show_wrong(_value: int) -> void:
	Sfx.play("wrong")
	if guardian:
		guardian.laugh()


func _play_solved() -> void:
	set_awake(false)
	Fx.burst(self, global_position + Vector3(0, 1.4, 0), COLORS[phase], 30, 6.0)
	if guardian:
		await guardian.rune_solved(phase)
	else:
		await get_tree().process_frame
