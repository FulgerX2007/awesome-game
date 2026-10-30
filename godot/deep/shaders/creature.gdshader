shader_type canvas_item;
// A creature's body: lit by the 2D lights, so the deep hides it outside the light.
#include "res://shaders/creature.gdshaderinc"

void fragment() {
	vec2 uv = bent_uv(UV);
	COLOR = texture(TEXTURE, uv) * inside(uv) * COLOR;
}
