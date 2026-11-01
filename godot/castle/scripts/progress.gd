class_name CastleProgress
extends RefCounted
## The player's progress between sieges, saved as JSON under KEY (localStorage in the browser, user:// elsewhere,
## see store.gd): the levels open, the best stars of each, the treasury and the armory, the endless record.
##   treasury — the gold a won level sends home: its reward (a third on a replay) plus a fifth of the gold left;
##   armory   — permanent upgrades bought from the treasury (data/meta.json "armory").
## The web game keeps its own save (castle.save); this one is separate because the rules differ.

const KEY := "castle-godot.save"
const REPLAY_SHARE := 1.0 / 3.0
const LEFTOVER_SHARE := 0.2

var opened := 1                     # the highest level that can be played
var stars := {}                     # "n" -> best stars (1..3) of won levels
var treasury := 0
var armory := {}                    # id -> level bought
var endless_best := 0
var endless_wave := 0
var finished := false               # the Dark King fell


static func parse(raw: String) -> CastleProgress:
	var p := CastleProgress.new()
	var d = JSON.parse_string(raw) if raw.begins_with("{") else null
	if not d is Dictionary or int(d.get("v", 0)) != 1:
		return p
	var last := CastleContent.levels().size()
	p.opened = clampi(int(d.get("opened", 1)), 1, last)
	var st = d.get("stars", {})
	if st is Dictionary:
		for k in st:
			var n := int(k)
			var v := int(st[k])
			if n >= 1 and n <= last and v >= 1 and v <= 3:
				p.stars[str(n)] = v
	p.treasury = clampi(int(d.get("treasury", 0)), 0, 1000000000)
	var arm = d.get("armory", {})
	var catalog: Dictionary = CastleContent.meta().armory
	if arm is Dictionary:
		for id in arm:
			if catalog.has(id):
				p.armory[id] = clampi(int(arm[id]), 0, catalog[id].costs.size())
	p.endless_best = maxi(0, int(d.get("endless_best", 0)))
	p.endless_wave = maxi(0, int(d.get("endless_wave", 0)))
	p.finished = d.get("finished", false) == true
	return p


func dump() -> String:
	return JSON.stringify({v = 1, opened = opened, stars = stars, treasury = treasury, armory = armory,
		endless_best = endless_best, endless_wave = endless_wave, finished = finished})


static func load_saved() -> CastleProgress:
	return parse(CastleStore.get_item(KEY))


func save() -> void:
	CastleStore.set_item(KEY, dump())


func total_stars() -> int:
	var t := 0
	for k in stars:
		t += int(stars[k])
	return t


## A finished level → what it brought home: {gold, first, stars, opened (the level it opened, or 0)}.
func record_level(sim: CastleSim) -> Dictionary:
	var out := {gold = 0, first = false, stars = 0, opened = 0}
	if sim.mode != "level" or sim.status != "won":
		return out
	var key := str(sim.level_n)
	out.first = not stars.has(key)
	out.stars = sim.stars()
	stars[key] = maxi(int(stars.get(key, 0)), out.stars)
	var reward := int(sim.level.reward)
	out.gold = (reward if out.first else int(round(reward * REPLAY_SHARE))) + int(sim.gold * LEFTOVER_SHARE)
	treasury += out.gold
	if sim.level_n >= opened and sim.level_n < CastleContent.levels().size():
		opened = sim.level_n + 1
		out.opened = opened
	if sim.level_n == CastleContent.levels().size():
		finished = true
	return out


## An endless run that ended: the record, by the web game's score. True when it improved.
func record_endless(sim: CastleSim) -> bool:
	if sim.mode != "endless":
		return false
	var better := sim.score() > endless_best
	endless_best = maxi(endless_best, sim.score())
	endless_wave = maxi(endless_wave, sim.wave - 1 if sim.status == "lost" else sim.wave)
	return better


func armory_level(id: String) -> int:
	return int(armory.get(id, 0))


## The next step of an armory upgrade, or -1 when it is maxed.
func armory_price(id: String) -> int:
	var costs: Array = CastleContent.meta().armory[id].costs
	var lv := armory_level(id)
	return -1 if lv >= costs.size() else int(costs[lv])


## → ok | max | nogold | unknown
func buy_armory(id: String) -> String:
	if not CastleContent.meta().armory.has(id):
		return "unknown"
	var p := armory_price(id)
	if p < 0:
		return "max"
	if treasury < p:
		return "nogold"
	treasury -= p
	armory[id] = armory_level(id) + 1
	return "ok"
