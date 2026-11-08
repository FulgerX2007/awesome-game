class_name UpgradeDef
extends Resource
## One workshop upgrade. The rules read only these fields (see ProductionManager.derived and
## UpgradeManager), so a new upgrade is a new .tres file plus, at most, a new effect kind.

## Stable id used in saves (keep the web game's ids: shovel, gloves, ...).
@export var id := ""
@export var name := ""
@export_multiline var description := ""
@export var max_level := 1

@export_group("Cost")
## Cost of level L+1 is ceil(base * growth^L) for each resource; 0 base means "not needed".
@export var parts_base := 0.0
@export var parts_growth := 1.0
@export var cores_base := 0.0
@export var cores_growth := 1.0

@export_group("Effect")
## What one level does. Kinds: click_add, batch_add, ratio_sub, wrench_add, role_speed (target = role),
## dispatch, core_chance, factory, global_mul, power, drone.
@export var effect := ""
@export var effect_target := ""
@export var amount := 0.0

@export_group("Unlock")
## When the card appears. Kinds: always, total_parts, built, built_or_repair, total_cores, stage, upgrade
## (target = upgrade id, value = its level).
@export var unlock_kind := "always"
@export var unlock_target := ""
@export var unlock_value := 0.0

@export_group("Feedback")
## The scrapyard prop that shows this upgrade in the world (ScrapyardWorld reads it).
@export var prop := ""


func cost(level: int) -> Dictionary:
	var c := {}
	if parts_base > 0.0:
		c.parts = ceilf(parts_base * pow(parts_growth, level))
	if cores_base > 0.0:
		c.cores = ceilf(cores_base * pow(cores_growth, level))
	return c
