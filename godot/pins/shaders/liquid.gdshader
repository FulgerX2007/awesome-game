shader_type canvas_item;
// Liquids as one smooth body: the fluid viewport sums a soft blob per ball, water in red, lava in green,
// gas in blue (HDR, so deep pools add up past 1). Here the sums turn into surfaces: a pool where the
// sum passes a threshold, coloured by depth with the ramps of web/pins (water: light blue surface to deep
// blue; lava: yellow-white crust to dark red), a bright surface line, moving caustics on water, a drifting
// crust and hot spots on lava (bright enough for the bloom), and a soft green haze of gas.

uniform vec2 texel;   // 1 / size of the fluid texture
uniform float t = 0.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

vec3 water_ramp(float d) {
	vec3 a = vec3(0.651, 0.902, 1.0), b = vec3(0.337, 0.741, 0.965), c = vec3(0.176, 0.525, 0.855), e = vec3(0.078, 0.235, 0.58);
	if (d < 0.06) return mix(a, b, d / 0.06);
	if (d < 0.35) return mix(b, c, (d - 0.06) / 0.29);
	return mix(c, e, (d - 0.35) / 0.65);
}

vec3 lava_ramp(float d) {
	vec3 a = vec3(1.0, 0.96, 0.69), b = vec3(1.0, 0.784, 0.235), c = vec3(1.0, 0.541, 0.11), e = vec3(0.863, 0.231, 0.09), f = vec3(0.541, 0.09, 0.047);
	if (d < 0.05) return mix(a, b, d / 0.05);
	if (d < 0.25) return mix(b, c, (d - 0.05) / 0.2);
	if (d < 0.6) return mix(c, e, (d - 0.25) / 0.35);
	return mix(e, f, (d - 0.6) / 0.4);
}

// How deep under the surface: the share of samples straight up that are still inside the liquid.
// (Works on a plain 8-bit texture too, where the sums stop at 1.)
float depth_of(sampler2D tex, vec2 uv, float y, int ch) {
	float d = 0.0;
	for (int i = 1; i <= 6; i++) {
		vec4 s = texture(tex, uv - vec2(0.0, y * float(i * i) * 2.0));
		d += step(0.5, ch == 0 ? s.r : s.g);
	}
	return d / 6.0;
}

void fragment() {
	vec4 f = texture(TEXTURE, UV);
	vec2 px = UV / texel;
	vec4 up = texture(TEXTURE, UV - vec2(0.0, texel.y * 3.0));
	vec4 col = vec4(0.0);

	// water
	float w = smoothstep(0.42, 0.62, f.r);
	if (w > 0.0) {
		float top = 1.0 - smoothstep(0.42, 0.62, up.r);
		vec3 c = water_ramp(0.04 + depth_of(TEXTURE, UV, texel.y, 0) * 0.9);
		float caustic = pow(1.0 - abs(noise(px / 10.0 + vec2(t * 0.6, t * 0.3)) - noise(px / 8.0 - vec2(t * 0.4, -t * 0.5))), 18.0);
		c += vec3(0.84, 0.97, 1.0) * caustic * 0.22;
		c = mix(c, vec3(0.86, 0.97, 1.0), top * 0.9);
		col = vec4(c, 0.84 * w);
	}

	// lava, over water
	float l = smoothstep(0.42, 0.62, f.g);
	if (l > 0.0) {
		float top = 1.0 - smoothstep(0.42, 0.62, up.g);
		vec3 c = lava_ramp(0.08 + depth_of(TEXTURE, UV, texel.y, 1) * 0.85);
		float crust = smoothstep(0.55, 0.8, noise(px / 11.0 + vec2(t * 0.15, -t * 0.08)));
		c = mix(c, vec3(0.47, 0.08, 0.02), crust * 0.5);
		float hot = smoothstep(0.72, 0.95, noise(px / 6.0 - vec2(t * 0.25, t * 0.1)));
		c += vec3(1.0, 0.85, 0.45) * hot * 0.5;
		c = mix(c, vec3(1.0, 0.95, 0.7), top * 0.8);
		c *= 1.3;  // past 1: the bloom picks it up
		col = mix(col, vec4(c, 1.0), l);
	}

	// gas, a soft haze over everything
	float g = smoothstep(0.2, 0.7, f.b);
	if (g > 0.0) {
		float swirl = noise(px / 8.0 + vec2(t * 0.5, -t * 0.7));
		vec3 c = mix(vec3(0.47, 0.75, 0.24), vec3(0.75, 0.93, 0.45), swirl);
		float a = g * (0.45 + 0.25 * swirl);
		col = vec4(mix(col.rgb, c, a), max(col.a, a));
	}
	COLOR = col;
}
