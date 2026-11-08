class_name WinterSurvivorDef
extends Resource
## One of the five survivors: where they wait, what they need to follow the hero, how they work at home.

@export var id := ""
@export var name := ""
@export var x := 0
@export var y := 0
## "meat" | "shovel" | "day" | "icePick" | "palisade"
@export var need := ""
## Seconds of work per gift, and the gift: {"wood": 1}.
@export var work_every := 0.0
@export var work_give: Dictionary = {}
@export var role := ""
@export var need_text := ""
