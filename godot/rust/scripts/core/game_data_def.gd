class_name GameDataDef
extends Resource
## The index of all configurable content, in display order: res://data/game_data.tres.

@export var resources: Array[ResourceDef] = []
@export var upgrades: Array[UpgradeDef] = []
@export var stages: Array[StageDef] = []
@export var achievements: Array[AchievementDef] = []
## Robots built before the ark appears (the web game's ARK_UNLOCK).
@export var ark_unlock_built := 5
