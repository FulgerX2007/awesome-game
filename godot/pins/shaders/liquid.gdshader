shader_type canvas_item;
render_mode unshaded;
// Liquids as one body: the fluid viewport sums a soft blob per ball, water in red, lava in green, gas in
// blue (HDR, so deep pools add up past 1). Here the sums turn into surfaces:
//   - cut off sharply where rock or a pin is (the board mirrors blobs across walls, so pools meet the
//     walls square, and this cut makes the edge crisp), and away from the cells that hold matter, so a
//     blob never shows through a pin or a wall one cell thick;
//   - the surface ripples: the field is read a little higher or lower along x, in two slow waves;
//   - water is clear: the wall behind shows through, bent by the moving water, tinted deeper blue the
//     deeper it gets, with caustics, rising bubbles and a bright line of foam on top;
//   - lava churns with the painted texture of the reference, dark crust plates drift on it with glowing
//     cracks between them, bubbles swell near the top; it is brighter than 1 for the glow;
//   - gas is a soft green haze.
// Unshaded: the scene's CanvasModulate would dim the lava's own light, so the water and gas take the
// ambient colour here (the wall seen through the water has it already).

uniform vec2 texel;   // 1 / size of the fluid texture
uniform float t = 0.0;
uniform vec3 ambient = vec3(0.62, 0.6, 0.78);
uniform sampler2D lava_tex : filter_linear_mipmap, repeat_enable;  // the lava cells of the style reference
uniform sampler2D solid : filter_nearest;  // one texel a cell: r = rock or pin, g = a ball of matter in or next to it
uniform sampler2D screen_tex : hint_screen_texture, filter_linear;

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

void fragment() {
	vec2 cell = texture(solid, UV).rg;
	if (cell.r > 0.5 || cell.g < 0.5) {
		COLOR = vec4(0.0);
	} else {
		vec2 px = UV / texel;
		// ripples, in px: water quick and choppy, lava slow and heavy
		float ww = sin(px.x * 0.21 + t * 2.7) * 0.9 + sin(px.x * 0.083 - t * 1.6) * 0.8 + (noise(vec2(px.x * 0.12, t * 1.4)) - 0.5) * 1.4;
		float lw = sin(px.x * 0.11 + t * 1.1) * 0.8 + (noise(vec2(px.x * 0.07, t * 0.5)) - 0.5) * 1.2;
		vec2 uw = UV + vec2(0.0, ww * texel.y);
		vec2 ul = UV + vec2(0.0, lw * texel.y);
		float fw = texture(TEXTURE, uw).r;
		float fl = texture(TEXTURE, ul).g;
		float fg = texture(TEXTURE, UV).b;
		float upw = texture(TEXTURE, uw - vec2(0.0, texel.y * 2.5)).r;
		float upl = texture(TEXTURE, ul - vec2(0.0, texel.y * 3.0)).g;
		// How deep under the surface: the share of samples straight up that are still inside the liquid
		// (works on a plain 8-bit texture too, where the sums stop at 1). x for water, y for lava.
		vec2 deep = vec2(0.0);
		for (int i = 1; i <= 6; i++) {
			vec2 o = vec2(0.0, texel.y * float(i * i) * 2.0);
			deep += step(vec2(0.5), vec2(texture(TEXTURE, uw - o).r, texture(TEXTURE, ul - o).g));
		}
		deep /= 6.0;
		vec4 col = vec4(0.0);

		// water
		float w = smoothstep(0.44, 0.56, fw);
		if (w > 0.0) {
			float top = 1.0 - smoothstep(0.44, 0.56, upw);
			float d = deep.x;
			// the wall behind, bent by the moving water
			vec2 bend = vec2(noise(px / 9.0 + vec2(t * 0.7, t * 0.4)), noise(px / 9.0 - vec2(t * 0.5, -t * 0.6) + 5.0)) - 0.5;
			vec3 behind = texture(screen_tex, SCREEN_UV + bend * SCREEN_PIXEL_SIZE * 7.0).rgb;
			vec3 tint = water_ramp(0.05 + d * 0.9) * ambient * 1.15;
			vec3 c = mix(behind * vec3(0.55, 0.8, 1.0) + tint * 0.25, tint, 0.12 + d * 0.5);
			// caustics: a moving net of light
			float caustic = pow(1.0 - abs(noise(px / 10.0 + vec2(t * 0.6, t * 0.3)) - noise(px / 8.0 - vec2(t * 0.4, -t * 0.5))), 14.0);
			c += vec3(0.55, 0.8, 1.0) * caustic * 0.3 * (1.0 - d * 0.6);
			// small bubbles rising, now and then
			vec2 q = px / 7.0 + vec2(0.0, t * 1.8);
			vec2 id = floor(q);
			vec2 fq = fract(q) - 0.5 + (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.4;
			float bub = step(0.94, hash(id)) * smoothstep(0.22, 0.12, length(fq)) * smoothstep(0.05, 0.12, length(fq));
			c += vec3(0.7, 0.9, 1.0) * bub * 0.5 * smoothstep(0.1, 0.3, d);
			// foam on top, with glints running along it
			float glint = smoothstep(0.75, 0.95, noise(vec2(px.x / 6.0 - t * 2.0, t)));
			c = mix(c, vec3(0.82, 0.95, 1.0) * (0.85 + glint * 0.5), top * 0.85);
			col = vec4(c, 0.95 * w);
		}

		// lava, over water
		float l = smoothstep(0.44, 0.56, fl);
		if (l > 0.0) {
			float top = 1.0 - smoothstep(0.44, 0.56, upl);
			float d = deep.y;
			// the painted lava cells, slowly churning: a drifting, wobbling lookup into the reference texture
			vec2 warp = vec2(noise(px / 14.0 + t * 0.35), noise(px / 14.0 - t * 0.3 + 7.0)) - 0.5;
			vec3 cells = texture(lava_tex, px / vec2(142.0, 82.0) + vec2(t * 0.02, t * -0.015) + warp * 0.12).rgb;
			vec3 c = mix(lava_ramp(0.08 + d * 0.85), cells * 1.15, 0.6);
			// crust: dark plates drifting on the pool, cracks glowing between them
			float n = noise(px / 12.0 + vec2(t * 0.12, -t * 0.05) + warp * 0.8);
			float plate = smoothstep(0.52, 0.66, n) * smoothstep(0.05, 0.3, d);
			float crack = 1.0 - smoothstep(0.0, 0.05, abs(n - 0.5));
			c = mix(c, c * vec3(0.38, 0.22, 0.18), plate * 0.8);
			c += vec3(1.0, 0.7, 0.25) * crack * 0.45 * smoothstep(0.05, 0.3, d);
			// a slow pulse of heat, and bubbles that swell and pop near the top
			c *= 0.92 + 0.12 * noise(px / 30.0 + vec2(0.0, t * 0.6));
			float bub = smoothstep(0.82, 0.95, noise(px / 5.0 + vec2(0.0, -t * 0.8))) * (1.0 - d);
			c += vec3(1.0, 0.85, 0.4) * bub * 0.6;
			c = mix(c, vec3(1.0, 0.93, 0.6), top * 0.85);
			c *= 1.15;  // a little past 1 for the glow
			col = mix(col, vec4(c, 1.0), l);
		}

		// gas, a soft haze over everything
		float g = smoothstep(0.2, 0.7, fg);
		if (g > 0.0) {
			float swirl = noise(px / 8.0 + vec2(t * 0.5, -t * 0.7));
			vec3 c = mix(vec3(0.47, 0.75, 0.24), vec3(0.75, 0.93, 0.45), swirl) * ambient * 1.2;
			float a = g * (0.45 + 0.25 * swirl);
			col = vec4(mix(col.rgb, c, a), max(col.a, a));
		}
		COLOR = col;
	}
}
