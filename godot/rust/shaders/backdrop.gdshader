shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, depth_draw_never, shadows_disabled;
// The sky as a backdrop behind the scrapyard (an orthographic camera sees no real sky): purple night
// at the top, rust-orange glow at the horizon line, a low sun; `dawn` (0..1) brightens it as the ark
// is rebuilt, like the web game's sky.

uniform float dawn : hint_range(0.0, 1.0) = 0.0;
uniform float horizon = 0.3;
uniform vec2 sun_pos = vec2(0.62, 0.0);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void fragment() {
	float y = 1.0 - UV.y;
	float h = y - horizon;
	vec3 top = mix(vec3(0.078, 0.059, 0.133), vec3(0.17, 0.24, 0.40), dawn);
	vec3 mid = mix(vec3(0.24, 0.15, 0.28), vec3(0.48, 0.35, 0.54), dawn);
	vec3 hor = mix(vec3(0.77, 0.38, 0.23), vec3(0.94, 0.66, 0.41), dawn);
	vec3 col = mix(hor, mid, smoothstep(0.0, 0.12, h));
	col = mix(col, top, smoothstep(0.12, 0.45, h));
	vec2 sp = vec2(sun_pos.x, horizon + 0.035 + dawn * 0.1);
	vec2 d = (vec2(UV.x, y) - sp) * vec2(2.4, 1.0);
	float r = length(d);
	vec3 sun = mix(vec3(0.95, 0.55, 0.3), vec3(1.0, 0.83, 0.54), dawn);
	col = mix(col, sun * 1.6, smoothstep(0.042, 0.036, r));
	col += sun * (exp(-r * 9.0) * 0.55 + exp(-r * 3.0) * 0.15);
	vec2 cell = floor(UV * vec2(260.0, 90.0));
	float star = step(0.993, hash(cell)) * smoothstep(0.1, 0.3, h) * (1.0 - dawn);
	col += vec3(1.0, 0.94, 0.86) * star * (0.5 + 0.5 * sin(TIME * 1.3 + hash(cell + 3.0) * 6.0));
	ALBEDO = col;
}
