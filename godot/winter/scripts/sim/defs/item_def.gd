class_name WinterItemDef
extends Resource
## A thing the camp can hold: a material (wood, stone, metal, hide) or food.

@export var id := ""
@export_enum("material", "food") var kind := "material"
## How much satiety one piece gives (food only).
@export var food := 0.0
## The Russian name (the key for tr()).
@export var name := ""
## The place in the order food is eaten (the most filling first; -1 for materials).
@export var eat_rank := -1
