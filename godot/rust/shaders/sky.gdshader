shader_type sky;
// Sunset over the scrapyard: purple night above, rust-orange at the horizon, a low sun behind the ark.
// `dawn` (0..1) brightens it as the ark is rebuilt, like the web game's sky.

uniform float dawn : hint_range(0.0, 1.0) = 0.0;
uniform vec3 sun_dir = vec3(0.25, 0.08, -1.0);

vec3 mix3(vec3 a, vec3 b, float k) { return a * (1.0 - k) + b * k; }

float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void sky() {
	vec3 top = mix3(vec3(0.078, 0.059, 0.133), vec3(0.17, 0.24, 0.40), dawn);
	vec3 mid = mix3(vec3(0.24, 0.15, 0.28), vec3(0.48, 0.35, 0.54), dawn);
	vec3 hor = mix3(vec3(0.77, 0.38, 0.23), vec3(0.94, 0.66, 0.41), dawn);
	vec3 low = vec3(0.10, 0.07, 0.12);
	float y = EYEDIR.y;
	vec3 col = mix3(hor, mid, smoothstep(0.0, 0.22, y));
	col = mix3(col, top, smoothstep(0.22, 0.7, y));
	col = mix3(col, low, smoothstep(0.0, -0.15, y));
	vec3 sd = normalize(sun_dir + vec3(0.0, dawn * 0.15, 0.0));
	float d = max(dot(EYEDIR, sd), 0.0);
	vec3 sun = mix3(vec3(0.94, 0.54, 0.29), vec3(1.0, 0.83, 0.54), dawn);
	col += sun * (smoothstep(0.9985, 0.9992, d) * 2.5 + pow(d, 12.0) * 0.55 + pow(d, 3.0) * 0.12);
	float star = step(0.9975, hash(floor(EYEDIR * 400.0))) * smoothstep(0.15, 0.5, y) * (1.0 - dawn);
	col += vec3(1.0, 0.94, 0.86) * star * 0.8;
	COLOR = col;
}
