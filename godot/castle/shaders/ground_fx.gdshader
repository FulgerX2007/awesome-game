// Marks on the ground: a boss's telegraph (stripes that fill up as the blow comes), burning oil, dragon fire,
// cursed earth, and the placement slots. Flat quads lying on the ground; colour and mode from uniforms.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

uniform vec4 tint : source_color = vec4(1.0, 0.2, 0.1, 1.0);
uniform float progress = 0.0;    // telegraph: how far the warning has run (0..1)
uniform int mode = 0;            // 0 telegraph, 1 fire, 2 curse, 3 slot, 4 slot (selected)
uniform float alpha = 1.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec2 uv = UV;
	float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
	float a = 0.0;
	vec3 c = tint.rgb;
	if (mode == 0) {
		float stripes = step(0.5, fract((uv.x + uv.y * 0.6) * 9.0 - TIME * 1.5));
		float fill = step(1.0 - progress, 1.0 - uv.x);
		float border = 1.0 - smoothstep(0.0, 0.06, edge);
		a = border * 0.95 + stripes * 0.22 + fill * 0.28;
		a *= 0.65 + 0.35 * sin(TIME * 14.0 * (0.4 + progress));
	} else if (mode == 1 || mode == 2) {
		float n = noise(uv * vec2(14.0, 4.0) + vec2(0.0, -TIME * (mode == 1 ? 2.5 : 0.8)));
		float soft = smoothstep(0.0, 0.25, edge);
		a = soft * (0.35 + 0.65 * n);
		c = mix(tint.rgb, mode == 1 ? vec3(1.0, 0.9, 0.4) : vec3(0.9, 0.6, 1.0), n * n);
	} else {
		float ring = 1.0 - smoothstep(0.0, 0.08, edge);
		a = ring * 0.9 + 0.12;
		if (mode == 4) { a = ring + 0.3 + 0.15 * sin(TIME * 6.0); }
	}
	ALBEDO = c;
	ALPHA = clamp(a * alpha * tint.a, 0.0, 1.0);
}
