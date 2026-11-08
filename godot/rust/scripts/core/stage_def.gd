class_name StageDef
extends Resource
## One stage of rebuilding the ark. Stages are built in order; each one costs parts and cores and
## switches on a lasting capability (effect), which ProductionManager.derived applies.

@export var id := ""
@export var name := ""
@export_multiline var description := ""
## What the player gets, shown on the stage card.
@export var unlock_text := ""
@export var parts := 0.0
@export var cores := 0.0
## Kinds: role_speed (target = role), power, zone (target = zone id), salvage_freq, launch.
@export var effect := ""
@export var effect_target := ""
@export var amount := 0.0
## The chronicle line written when the stage is done.
@export_multiline var story := ""
