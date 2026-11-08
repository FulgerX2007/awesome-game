// Долгая зима: the screen over the world. Blizzard fog drifting with the wind (visibility drops), a soft vignette,
// frost creeping in from the edges when the hero freezes, a red pulse when he is hurt, and the aurora's green
// and violet curtains on a calm night.
shader_type canvas_item;

uniform sampler2D noise : repeat_enable, filter_linear_mipmap;
uniform float fog = 0.0;           // 0 … 1
uniform vec3 fog_color : source_color = vec3(0.86, 0.9, 0.97);
uniform float wind = 0.0;
uniform float frost = 0.0;         // 0 … 1, the hero's cold
uniform float hurt = 0.0;          // 0 … 1, fading after a bite
uniform float aurora = 0.0;        // 0 … 1
uniform float night = 0.0;
uniform vec2 aspect = vec2(1.777, 1.0);

void fragment() {
	vec2 uv = UV;
	vec2 p = uv * aspect;
	vec2 c = (uv - 0.5) * aspect;
	float r = length(c / vec2(aspect.x, 1.0) * 2.0);

	// fog: two layers of noise drifting with the wind, thicker near the edges
	vec2 drift = vec2(TIME * (0.05 + wind * 0.25), TIME * 0.01);
	float f1 = texture(noise, p * 0.35 - drift).r;
	float f2 = texture(noise, p * 0.9 - drift * 1.8 + 3.0).r;
	float fogk = fog * (0.45 + 0.55 * smoothstep(0.25, 0.85, f1 * 0.65 + f2 * 0.35)) * (0.55 + 0.45 * smoothstep(0.1, 1.1, r));
	vec3 col = fog_color * mix(1.0, 0.35, night);
	float a = fogk * 0.85;

	// the vignette, deeper at night
	float vig = smoothstep(0.65, 1.45, r) * (0.28 + night * 0.35);
	col = mix(col, vec3(0.02, 0.03, 0.08), vig / max(a + vig, 0.001));
	a = max(a, vig);

	// frost from the edges: crystalline noise, a pale blue rim
	if (frost > 0.0) {
		float crystal = texture(noise, p * 2.6).r * 0.6 + texture(noise, p * 7.0 + 9.0).r * 0.4;
		float edge = smoothstep(1.25 - frost * 0.65, 1.45, r + crystal * 0.35);
		vec3 fc = mix(vec3(0.75, 0.88, 1.0), vec3(0.95, 0.98, 1.0), crystal);
		col = mix(col, fc, edge / max(a + edge, 0.001));
		a = max(a, edge * 0.9 * frost);
	}

	// hurt: a red rim
	if (hurt > 0.0) {
		float e = smoothstep(0.7, 1.4, r) * hurt;
		col = mix(col, vec3(0.75, 0.08, 0.1), e / max(a + e, 0.001));
		a = max(a, e * 0.7);
	}

	// the aurora: waving curtains across the upper part of the screen, added on top
	vec3 add = vec3(0.0);
	if (aurora > 0.0) {
		float x = uv.x * 3.0;
		float wave = sin(x * 1.7 + TIME * 0.25) * 0.08 + sin(x * 3.9 - TIME * 0.4) * 0.04 + texture(noise, vec2(x * 0.2, TIME * 0.02)).r * 0.12;
		float band = smoothstep(0.0, 0.12, uv.y - (0.08 + wave)) * (1.0 - smoothstep(0.12, 0.45, uv.y - (0.08 + wave)));
		float rays = 0.6 + 0.4 * texture(noise, vec2(x * 1.4 + TIME * 0.05, 0.3)).r;
		vec3 ac = mix(vec3(0.25, 1.0, 0.6), vec3(0.6, 0.35, 1.0), smoothstep(0.1, 0.4, uv.y - wave));
		add = ac * band * rays * aurora * 0.35;
	}
	COLOR = vec4(col * a + add, a + length(add) * 0.6);
	COLOR.rgb = (col * a + add) / max(COLOR.a, 0.001);
}
