class_name WinterBuildingDef
extends Resource
## A building paid in parts: a hut stage, a palisade wall, a bunk, a house upgrade, a torch or the roof patch.

@export var id := ""
@export_enum("hut", "palisade", "bunk", "upgrade", "torch", "patch") var kind := "hut"
## The stage or slot number within its kind.
@export var order := 0
@export var cost: Dictionary = {}
## What a repair costs (palisade walls).
@export var repair: Dictionary = {}
## Strength when built (palisade walls).
@export var hp := 0.0
@export var name := ""
@export var desc := ""
## The lower-case name the rules use in texts (upgrades).
@export var core_name := ""
