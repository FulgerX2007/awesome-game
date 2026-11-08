// Долгая зима: the whole ground in one pass. The map's tile kinds come in `cells` (one texel per tile, linear
// filtering gives soft borders): R deep snow, G lake ice, B the camp's trodden ground, A a drift. Smooth noise warps
// the borders and shapes soft dunes, wind ripples and the ice's cracks; the shader also writes the surface normal,
// so the fire and the torches light the bumps of the snow.
shader_type canvas_item;

uniform sampler2D cells : filter_linear;
uniform sampler2D noise : repeat_enable, filter_linear_mipmap;
uniform vec2 map_tiles = vec2(56.0, 40.0);
uniform vec3 sun = vec3(-0.55, -0.65, 0.52);
uniform float wind = 0.0;          // 0 calm … 1 blizzard: the ripples sharpen and drift
uniform float sparkle = 1.0;       // glints of the snow crust (fade at night)

uniform vec3 snow_hi : source_color = vec3(0.957, 0.973, 1.0);
uniform vec3 snow : source_color = vec3(0.875, 0.914, 0.965);
uniform vec3 snow_shade : source_color = vec3(0.624, 0.702, 0.839);
uniform vec3 snow_deep : source_color = vec3(0.498, 0.584, 0.761);
uniform vec3 ice_hi : source_color = vec3(0.847, 0.945, 1.0);
uniform vec3 ice : source_color = vec3(0.624, 0.827, 0.933);
uniform vec3 ice_deep : source_color = vec3(0.247, 0.498, 0.690);
uniform vec3 earth : source_color = vec3(0.416, 0.337, 0.275);
uniform vec3 camp : source_color = vec3(0.78, 0.79, 0.84);

float n1(vec2 p) { return texture(noise, p).r; }

// Height of the snow at a tile point: big soft dunes, smaller lumps, wind ripples stretched along the wind.
float snow_height(vec2 t, float deep) {
	float h = n1(t * 0.045) * 0.9 + n1(t * 0.13 + 3.1) * 0.45 + n1(t * 0.37 + 7.7) * 0.18 * (1.0 + deep);
	vec2 r = vec2(t.x * 0.55 + t.y * 0.18, t.y * 1.9 - t.x * 0.2);
	h += (n1(r * 0.35 + vec2(TIME * 0.004 * wind, 0.0)) - 0.5) * (0.12 + 0.12 * wind);
	return h * (1.0 + deep * 0.9);
}

void fragment() {
	vec2 t = UV * map_tiles;                                    // tile coordinates
	vec2 warp = vec2(n1(t * 0.21 + 11.0), n1(t * 0.21 + 23.0)) - 0.5;
	vec4 c = texture(cells, (t + warp * 0.9) / map_tiles);
	float deep = smoothstep(0.3, 0.7, c.r + (n1(t * 0.6) - 0.5) * 0.35);
	float lake = smoothstep(0.42, 0.58, c.g + (n1(t * 0.9 + 5.0) - 0.5) * 0.18);
	float trod = smoothstep(0.35, 0.75, c.b + (n1(t * 0.8 + 9.0) - 0.5) * 0.3);
	float drift = smoothstep(0.2, 0.7, c.a);

	// the snow's surface normal from its height
	float e = 0.06;
	float h0 = snow_height(t, deep + drift);
	float hx = snow_height(t + vec2(e, 0.0), deep + drift);
	float hy = snow_height(t + vec2(0.0, e), deep + drift);
	vec3 nrm = normalize(vec3(-(hx - h0) / e * 0.35, -(hy - h0) / e * 0.35, 1.0));
	vec3 l = normalize(sun);
	float lam = clamp(dot(nrm, l), 0.0, 1.0);
	float cav = smoothstep(0.25, 1.1, h0);                         // hollows a touch bluer
	vec3 col = mix(snow_shade, snow, smoothstep(0.35, 0.85, lam));
	col = mix(col, snow_hi, smoothstep(0.82, 1.0, lam) * 0.8);
	col = mix(col, snow_deep, (1.0 - cav) * 0.18 + deep * 0.12);

	// the camp: snow trodden flat, earth showing in places
	// big soft thawed patches near the middle of the camp, tracks of trodden snow elsewhere
	float bare = smoothstep(0.62, 0.8, n1(t * 0.12 + 41.0) * 0.75 + n1(t * 0.4 + 13.0) * 0.25) * trod;
	vec3 tcol = mix(mix(snow, camp, 0.55), snow_shade, 0.3 * (1.0 - lam));
	tcol = mix(tcol, mix(earth, camp, 0.35), bare * 0.6);
	col = mix(col, tcol, trod * 0.85);
	nrm = normalize(mix(nrm, vec3(0.0, 0.0, 1.0), trod * 0.6));

	// lake ice: blue depth, white frost, thin cracks, a sheen from the sky
	if (lake > 0.001) {
		float depth = n1(t * 0.08 + 17.0);
		vec3 icol = mix(ice_deep, ice, smoothstep(0.3, 0.75, depth));
		float crack = 1.0 - smoothstep(0.0, 0.025, abs(n1(t * 0.16 + 31.0) - 0.5));
		crack = max(crack, 1.0 - smoothstep(0.0, 0.018, abs(n1(t * 0.31 + 51.0) - 0.5)));
		icol = mix(icol, ice_hi, crack * 0.85);
		float frost = smoothstep(0.55, 0.8, n1(t * 0.25 + 61.0));
		icol = mix(icol, snow, frost * 0.55);
		float sheen = smoothstep(0.6, 1.0, n1(vec2(t.x * 0.05 + t.y * 0.12, t.y * 0.02)));
		icol += vec3(0.12, 0.14, 0.16) * sheen;
		col = mix(col, icol, lake);
		nrm = normalize(mix(nrm, vec3(0.0, 0.0, 1.0), lake * 0.85));
	}

	// glints in the crust
	float g = n1(t * 2.7 + floor(TIME * 0.7) * 0.37);
	col += vec3(0.5) * smoothstep(0.93, 0.99, g) * sparkle * (1.0 - trod) * (1.0 - lake * 0.6) * lam;

	COLOR = vec4(col, 1.0);
	NORMAL = nrm;
}
