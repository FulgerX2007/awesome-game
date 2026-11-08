class_name WinterRecipeDef
extends Resource
## Something made at the workbench: a tool, or gear once the workshop (a house upgrade) stands.

@export var id := ""
@export_enum("tool", "gear") var kind := "tool"
## What it costs, in the order it is shown: {"wood": 12}.
@export var cost: Dictionary = {}
@export var name := ""
@export var desc := ""
## What has to stand first ("" or "workshop").
@export var needs := ""
## The lower-case name the rules use in texts (gear only).
@export var core_name := ""
