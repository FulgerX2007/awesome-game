// Bends a creature sprite baked straight from web/deep/models.js, so it swims like the canvas model.
// Coordinates are model units (s): x runs from the tail (-) to the head (+), like in models.js.
uniform vec2 tex_px;          // sprite size in pixels
uniform vec2 origin_px;       // the model origin inside the sprite
uniform float s_px = 64.0;    // pixels per model unit
uniform int motion = 0;       // 0 still, 1 fish spine, 2 arms reaching forward, 3 soft body sway
uniform float body_len = 2.0; // fish: L; sway: the whole length
uniform float amp = 0.0;      // the largest bend, in model units
uniform float arm_root = 0.0; // arms: where they leave the body
uniform float arm_len = 1.0;  // arms: how far they reach past the root
uniform float phase = 0.0;    // the creature's own clock (core.gd moves it with the swimming speed)

float bend(float x) {
	if (motion == 1) {
		// the same wave as spine() in models.js: sw * sin(ph * 3 - u * 4.2) * u²
		float u = clamp(0.5 - x / body_len, 0.0, 1.35);
		return amp * sin(phase * 3.0 - u * 4.2) * u * u;
	}
	if (motion == 2) {
		float a = clamp((x - arm_root) / arm_len, 0.0, 1.2);
		return amp * sin(phase * 3.0 - a * 4.0) * a * a;
	}
	if (motion == 3) {
		float u = clamp((body_len * 0.5 - x) / body_len, 0.0, 1.0);
		return amp * sin(phase * 2.0 - u * 3.5) * u;
	}
	return 0.0;
}

// Where to read the straight sprite for this pixel of the bent one; y outside 0..1 means empty.
vec2 bent_uv(vec2 uv) {
	vec2 px = uv * tex_px;
	float x = (px.x - origin_px.x) / s_px;
	return vec2(uv.x, (px.y - bend(x) * s_px) / tex_px.y);
}

float inside(vec2 uv) {
	return step(0.0, uv.y) * step(uv.y, 1.0);
}
