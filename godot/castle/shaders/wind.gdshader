// Wind for grass, foliage and banners: vertices sway by their height above the mesh origin (grass, trees)
// or by their distance from the pole (flags, mode 1). Vertex colours carry the albedo, like Kit's materials.
shader_type spatial;
render_mode cull_disabled;

uniform float strength = 0.15;
uniform float speed = 1.6;
uniform int mode = 0;            // 0: sway by height, 1: flag along +x
uniform float roughness_value = 0.95;

varying vec3 world_pos;

void vertex() {
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float phase = wp.x * 0.35 + wp.z * 0.21;
	vec3 inst_origin = MODEL_MATRIX[3].xyz;
	if (mode == 0) {
		float h = max(VERTEX.y, 0.0);
		float w = sin(TIME * speed + phase + inst_origin.x * 0.7) * 0.6 + sin(TIME * speed * 2.3 + phase * 1.7) * 0.25;
		VERTEX.x += w * strength * h * h;
		VERTEX.z += w * strength * 0.4 * h * h;
	} else {
		float d = max(VERTEX.x, 0.0);
		float w = sin(TIME * speed * 3.0 - d * 3.2 + inst_origin.x);
		VERTEX.z += w * strength * d;
		VERTEX.y += cos(TIME * speed * 2.2 - d * 2.5) * strength * 0.25 * d;
	}
	world_pos = wp;
}

void fragment() {
	ALBEDO = COLOR.rgb;
	ROUGHNESS = roughness_value;
	if (!FRONT_FACING) {
		NORMAL = -NORMAL;
	}
}
