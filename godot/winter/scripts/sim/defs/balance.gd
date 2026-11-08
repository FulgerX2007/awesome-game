class_name WinterBalance
extends Resource
## Every number of the rules of Долгая зима (data/balance.tres, generated from web/winter/core.js by
## tools/winter-godot/data.cjs). Times are seconds, distances tiles, stats 0..stat_max.

@export_group("Time")
@export var tick := 0.05
@export var max_dt := 0.25
@export var day := 150.0
@export var night_at := 100.0
@export var days := 30
@export var sleep_speed := 6.0

@export_group("Walking and carrying")
@export var speed := 3.0
@export var deep := 1.7
@export var carry := 40.0
@export var sled_carry := 80.0
@export var store_cap := 200.0
@export var food_cap := 150.0
@export var cellar_food := 100.0

@export_group("Stats")
@export var stat_max := 100.0
@export var food_drain := 0.12
@export var energy_drain := 0.04
@export var work_energy := 0.25
@export var sleep_energy := 0.6
@export var fire_rest := 0.1
@export var health_loss := 1.0
@export var health_gain := 0.3
@export var raw_meat_energy := 10.0
@export var coat := 0.7

@export_group("Work")
@export var cook_time := 2.0
@export var hit_cd := 0.7
@export var fish_time := 6.0
@export var hunter_meat := 3.0
@export var palisade_hp := 100.0
@export var trade_offers := 3
@export var trade_reach := 2.5

@export_group("Wolves and survivors")
@export var bite := 8.0
@export var gnaw := 2.0
@export var wolf_hp := 4.0
@export var wolf_speed := 3.2
@export var wolf_cd := 1.5
@export var wolf_flee := 0.3
@export var wolf_safe := 14.0
@export var survivor_food := 0.08
@export var survivor_eat_at := 50.0

@export_group("Tables")
@export var fire: Dictionary = {}
@export var stove: Dictionary = {}
@export var torch: Dictionary = {}
@export var diff: Dictionary = {}
@export var insulation: Dictionary = {}
@export var smoke: Dictionary = {}
@export var annex: Dictionary = {}
@export var lantern: Dictionary = {}
@export var snare: Dictionary = {}
@export var event_chance: Dictionary = {}
@export var event_choices: Dictionary = {}
@export var event_default: Dictionary = {}
@export var event_ids: Array = []
@export var event_max: Dictionary = {}
@export var lost_child: Dictionary = {}
@export var aurora: Dictionary = {}
@export var thaw: Dictionary = {}
@export var trader_days: Dictionary = {}
@export var trades: Array = []
@export var trade_fixed: Dictionary = {}
@export var trade_no_tool: Dictionary = {}
@export var bear: Dictionary = {}
@export var roof_fix: Dictionary = {}
@export var roof_hole: Dictionary = {}
@export var wanderer: Dictionary = {}
@export var blizzards: Dictionary = {}
@export var eat_order: Array = []
@export var meats: Array = []
## Map nodes: amounts, regrow days, hit cooldowns, pieces per hit, what each gives.
@export var node: Dictionary = {}
## The small numbers core.js keeps private (cooldowns, reaches, speeds of animals...).
@export var misc: Dictionary = {}
