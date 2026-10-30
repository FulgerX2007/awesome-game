shader_type canvas_item;
render_mode blend_add, unshaded;
// What a creature makes glow (photophores, lures, rainbow combs): added light, seen in the dark.
#include "res://shaders/creature.gdshaderinc"

void fragment() {
	vec2 uv = bent_uv(UV);
	COLOR = texture(TEXTURE, uv) * inside(uv) * COLOR;
}
