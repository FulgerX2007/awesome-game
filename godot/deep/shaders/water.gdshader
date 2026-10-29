shader_type canvas_item;
// The sea behind everything: water colour by depth, the sky and the surface, light shafts and caustics
// near the top, marine snow, and the darkness of the deep zones around the player's pool of light.
// All positions are in screen pixels of the UI scale (CSS pixels on the web).

uniform vec2 view;              // screen size
uniform vec3 top_col : source_color;
uniform vec3 bot_col : source_color;
uniform float surface_y = -1e6; // the surface line on screen
uniform float shafts = 0.0;     // 1 near the top, 0 below the twilight zone
uniform vec2 cam;               // camera position in screen pixels, for parallax
uniform float dark = 0.0;       // darkness of the zone
uniform vec2 light_pos;         // the player on screen
uniform float light_r = 100.0;  // the pool of light around the player
uniform float snow = 0.5;       // how much marine snow
uniform float t = 0.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// A cheap caustic web: two layers of warped noise, bright where they cross.
float caustic(vec2 p) {
	float a = noise(p + vec2(t * 0.25, t * 0.13));
	float b = noise(p * 1.7 - vec2(t * 0.18, -t * 0.21) + a);
	return pow(1.0 - abs(a - b) * 2.0, 6.0);
}

void fragment() {
	vec2 px = UV * view;
	vec3 col = mix(top_col, bot_col, UV.y);

	// light shafts slanting down from the surface
	if (shafts > 0.0) {
		float below = clamp((px.y - surface_y) / view.y, 0.0, 1.0);
		float s = 0.0;
		for (int i = 0; i < 5; i++) {
			float fi = float(i);
			float x0 = (fract(fi * 0.23 + t * 0.008 + sin(t * 0.2 + fi) * 0.02) * 1.2 - 0.1) * view.x;
			float x = px.x - x0 - (px.y / view.y) * view.x * 0.16;
			float w = view.x * (0.04 + 0.06 * px.y / view.y);
			s += smoothstep(w, 0.0, abs(x)) * (1.0 - UV.y);
		}
		col += vec3(0.78, 0.94, 0.9) * s * 0.09 * shafts;
		// caustics dance in the top few metres
		float c = caustic((px + cam * 0.6) / 70.0);
		col += vec3(0.6, 0.85, 0.8) * c * 0.22 * shafts * exp(-below * 5.0) * step(surface_y, px.y);
	}

	// marine snow: three layers drifting down with parallax, thicker in the deep
	for (int l = 0; l < 3; l++) {
		float z = 0.35 + float(l) * 0.3;
		float cell = 46.0 / z;
		vec2 q = (px + cam * 0.15 * z) / cell + vec2(0.0, -t * 6.0 * z / cell);
		vec2 id = floor(q);
		vec2 f = fract(q) - 0.5;
		float h = hash(id + float(l) * 17.0);
		vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
		float d = length(f - o * 0.7) * cell;
		float on = step(1.0 - snow * 0.6, h);
		col += vec3(0.86, 0.94, 0.92) * on * smoothstep(1.2 * z + 0.4, 0.0, d) * (0.15 + h * 0.25);
	}

	// the sky above the surface and the bright, rippling surface line
	if (px.y < surface_y + 6.0) {
		float k = clamp((surface_y - px.y) / (view.y * 0.5), 0.0, 1.0);
		vec3 sky = mix(vec3(0.549, 0.769, 0.812), vec3(0.184, 0.435, 0.549), k);
		float wave = surface_y + sin(px.x * 0.03 + t * 1.5 + cam.x * 0.03) * 3.0;
		col = px.y < wave ? sky : mix(vec3(0.9, 0.98, 0.98), col, clamp((px.y - wave) / 8.0, 0.0, 1.0) * 0.5 + 0.5);
	}

	// the deep: dark everywhere except a pool of light around the player
	if (dark > 0.03) {
		float d = length(px - light_pos);
		float a = smoothstep(light_r * 0.35, light_r * 1.6, d) * dark;
		col = mix(col, vec3(0.0, 0.008, 0.03), a);
	}
	COLOR = vec4(col, 1.0);
}
