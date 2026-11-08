class_name AchievementDef
extends Resource
## A milestone or an optional challenge. AchievementManager checks `kind` against the state.

@export var id := ""
@export var name := ""
@export var description := ""
## Kinds: built, total_parts, total_cores, clicks, salvage, wrecks, shortages, stage, runs,
## challenge_no_upgrade (target = upgrade id that must stay at 0 until `value` robots are built).
@export var kind := ""
@export var target := ""
@export var value := 0.0
@export var challenge := false
