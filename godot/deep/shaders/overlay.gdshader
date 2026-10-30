shader_type canvas_item;
// Red edges while a predator chases you, and a red flash when you are caught.
uniform vec2 view;
uniform float danger = 0.0;
uniform float flash = 0.0;

void fragment() {
	vec2 c = (UV - 0.5) * view;
	float r = length(c) / (max(view.x, view.y) * 0.75);
	float edge = smoothstep(min(view.x, view.y) * 0.3 / (max(view.x, view.y) * 0.75), 1.0, r);
	vec4 v = vec4(0.55, 0.04, 0.12, 0.35 * danger * edge);
	vec4 f = vec4(0.7, 0.08, 0.16, 0.4 * flash);
	float a = v.a + f.a * (1.0 - v.a);
	COLOR = vec4(a > 0.0 ? (v.rgb * v.a + f.rgb * f.a * (1.0 - v.a)) / a : vec3(0.0), a);
}
