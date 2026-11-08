class_name WinterGround
extends Sprite2D
## The ground layer: one sprite over the whole map drawn by shaders/ground.gdshader. The tile kinds go into a
## 56×40 texture (one texel per tile); when a drift is dug out only that texel changes.

const TILE := 96.0

var _img: Image
var _cells: ImageTexture
var _kinds := PackedStringArray()


func _init() -> void:
	centered = false
	z_index = -30
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/ground.gdshader")
	var nt := NoiseTexture2D.new()
	nt.width = 256
	nt.height = 256
	nt.seamless = true
	nt.generate_mipmaps = true
	var fn := FastNoiseLite.new()
	fn.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	fn.frequency = 0.012
	fn.fractal_octaves = 3
	nt.noise = fn
	mat.set_shader_parameter("noise", nt)
	material = mat
	# a white canvas the size of the map: the shader colours it
	var img := Image.create(8, 8, false, Image.FORMAT_RGBA8)
	img.fill(Color.WHITE)
	texture = ImageTexture.create_from_image(img)


func build(g: Dictionary) -> void:
	var w: int = WinterSim.W
	var h: int = WinterSim.H
	scale = Vector2(w * TILE / 8.0, h * TILE / 8.0)
	_img = Image.create(w, h, false, Image.FORMAT_RGBA8)
	_kinds = PackedStringArray(g.tiles)
	for y in h:
		for x in w:
			_img.set_pixel(x, y, _cell(g, x, y))
	_cells = ImageTexture.create_from_image(_img)
	var mat := material as ShaderMaterial
	mat.set_shader_parameter("cells", _cells)
	mat.set_shader_parameter("map_tiles", Vector2(w, h))


func _cell(g: Dictionary, x: int, y: int) -> Color:
	var c: String = g.tiles[y * WinterSim.W + x]
	var base := WinterSim.in_base(x, y)
	return Color(1.0 if c == ":" else 0.0, 1.0 if c == "~" or c == "o" else 0.0, 1.0 if base else 0.0, 1.0 if c == "D" else 0.0)


## Picks up changed tiles (a dug drift). Cheap: compares 2240 one-letter strings, called a few times a second.
func refresh(g: Dictionary) -> void:
	if _img == null:
		return
	var changed := false
	var tiles: Array = g.tiles
	for i in tiles.size():
		if tiles[i] != _kinds[i]:
			_kinds[i] = tiles[i]
			_img.set_pixel(i % WinterSim.W, i / WinterSim.W, _cell(g, i % WinterSim.W, i / WinterSim.W))
			changed = true
	if changed:
		_cells.update(_img)


func set_weather(wind: float, glints: float) -> void:
	var mat := material as ShaderMaterial
	mat.set_shader_parameter("wind", wind)
	mat.set_shader_parameter("sparkle", glints)
