shader_type canvas_item;
// The dungeon of a level, drawn from a mask of the level's cells (no picture of the level): the rock is
// masonry of bevelled, chipped stone bricks, each painted with a brick face cut from the style reference;
// open chambers show a dark brick wall behind; the hero's room has wooden planks with iron bands. Where rock
// meets open space the rock gets a warm rim, the open side an inner shadow and the rock's drop shadow.
// The 2D lights (torch, lava) and the CanvasModulate of the scene light the result.
// A blast changes the mask; the walls follow without any extra art.

uniform sampler2D mask_n : filter_nearest;   // r = rock, g = the hero's room (36×54, one texel a cell)
uniform sampler2D mask_l : filter_linear;    // the same mask, smooth: shadows and rims
uniform sampler2D faces : filter_linear_mipmap;              // 4 brick faces, 80×40 each
uniform sampler2D back : filter_linear_mipmap, repeat_enable; // the chamber wall
uniform sampler2D wood : filter_linear_mipmap, repeat_enable; // vertical planks
uniform sampler2D band : filter_linear_mipmap;               // an iron band with rivets
uniform vec2 board = vec2(432.0, 648.0);     // board size, world px
uniform float cell = 12.0;
uniform vec4 bands = vec4(-1.0);             // y (world px) of up to 4 iron bands in the room, -1 = none
uniform float seed = 0.0;

// Mirrored tiling: every other tile flipped, so the edges of a painted texture always meet themselves.
vec2 mirror(vec2 uv) { return 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0); }

float hash(vec2 p) { return fract(sin(dot(p + seed, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// Signed distance to a rounded box (negative inside).
float rbox(vec2 p, vec2 half_size, float r) {
	vec2 q = abs(p) - half_size + r;
	return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 masonry(vec2 px, float rim) {
	// rows of bricks 1.75 cells high, about 3.2 cells long, every row shifted
	float bh = cell * 2.0;
	float row = floor(px.y / bh);
	float bw = cell * (3.2 + hash(vec2(row, 3.0)) * 0.9);
	float shift = hash(vec2(row, 7.0)) * bw;
	float col = floor((px.x + shift) / bw);
	vec2 id = vec2(col, row);
	vec2 local = vec2(px.x + shift - col * bw, px.y - row * bh);
	vec2 half_size = vec2(bw, bh) * 0.5 - 0.9;
	// chipped corners: each brick has its own rounding, and the edge wobbles a little
	float r = 2.0 + hash(id + 11.0) * 4.0;
	float edge_noise = (noise(px * 0.35) - 0.5) * 1.6;
	float d = rbox(local - vec2(bw, bh) * 0.5, half_size, r) + edge_noise;
	// the painted face, a random one of four, flipped and shifted
	float k = floor(hash(id + 5.0) * 4.0);
	vec2 uv = (local / vec2(bw, bh)) * vec2(0.8, 0.8) + vec2(hash(id + 1.0), hash(id + 2.0)) * 0.2;
	if (hash(id + 9.0) > 0.5) uv.x = 1.0 - uv.x;
	vec3 face = texture(faces, vec2((k + clamp(uv.x, 0.02, 0.98)) / 4.0, clamp(uv.y, 0.02, 0.98))).rgb;
	// lift the dark reference a little and vary each brick's tone
	// the reference stone is grey with a cool cast: keep a little of its colour, lift it, warm it slightly,
	// and vary each brick's tone
	float lum = dot(face, vec3(0.3, 0.55, 0.15));
	face = mix(vec3(lum), face, 0.45) * vec3(1.06, 1.0, 1.02);
	face = face * (1.45 + (hash(id + 4.0) - 0.5) * 0.4) + vec3(0.03);
	// bevel: light from the top left, a warm lit top edge, a dark lower right edge
	float inner = smoothstep(0.0, -4.0, d);
	vec2 g = vec2(rbox(local + vec2(0.7, 0) - vec2(bw, bh) * 0.5, half_size, r) - rbox(local - vec2(0.7, 0) - vec2(bw, bh) * 0.5, half_size, r),
	              rbox(local + vec2(0, 0.7) - vec2(bw, bh) * 0.5, half_size, r) - rbox(local - vec2(0, 0.7) - vec2(bw, bh) * 0.5, half_size, r));
	float facing = dot(normalize(g + 1e-4), normalize(vec2(-1.0, -1.3)));
	float bevel = (1.0 - inner) * step(d, 0.0);
	vec3 c = face;
	c += vec3(0.36, 0.3, 0.26) * bevel * max(facing, 0.0) * 0.9;
	c -= vec3(0.14, 0.14, 0.18) * bevel * max(-facing, 0.0);
	// a crack now and then
	float crack = smoothstep(0.03, 0.0, abs(noise(px * 0.18 + id * 3.1) - 0.5)) * step(0.72, hash(id + 13.0));
	c *= 1.0 - crack * 0.35 * inner;
	// mortar: dark seams with a soft contact shadow under each brick
	float seam = smoothstep(0.0, 1.2, d);
	vec3 mortar = vec3(0.07, 0.065, 0.1);
	c = mix(c, mortar, seam);
	c *= 1.0 - smoothstep(-3.0, 0.5, d) * 0.25;
	// sparse moss in the seams of a few bricks
	float moss = step(0.86, hash(id + 21.0)) * smoothstep(0.55, 0.75, noise(px * 0.25)) * smoothstep(-3.0, 1.0, d);
	c = mix(c, vec3(0.2, 0.33, 0.14), moss * 0.85);
	// warm rim where the rock meets a chamber
	c += vec3(0.55, 0.33, 0.14) * rim * 0.55;
	return c;
}

void fragment() {
	vec2 px = UV * board;
	vec2 cuv = px / board;     // 0..1 over the mask
	vec4 m = texture(mask_n, cuv);
	float soft = texture(mask_l, cuv).r;
	vec3 c;
	if (m.r > 0.5) {
		// how close to open space: the smooth mask drops near the edge of the rock
		float rim = smoothstep(0.92, 0.55, soft);
		c = masonry(px, rim);
	} else {
		if (m.g > 0.5) {
			// the hero's room: planks, two cells wide each with a dark seam, and iron bands
			vec2 wuv = px / vec2(380.0, 270.0) * 2.05;
			c = texture(wood, mirror(wuv)).rgb * 1.55;
			float plank = fract(px.x / (cell * 2.0));
			c *= 0.88 + 0.12 * hash(vec2(floor(px.x / (cell * 2.0)), 1.0));
			c *= mix(0.55, 1.0, smoothstep(0.0, 0.06, plank) * smoothstep(1.0, 0.94, plank));
			for (int i = 0; i < 4; i++) {
				float by = bands[i];
				if (by >= 0.0 && px.y >= by && px.y < by + 14.0) {
					vec4 b = texture(band, vec2(fract(px.x / 190.0), (px.y - by) / 14.0));
					c = mix(c, b.rgb, 0.95);
				}
			}
		} else {
			c = texture(back, mirror(px / vec2(305.0, 238.0) * 2.0)).rgb * 1.2;
			c *= 0.85 + 0.15 * noise(px * 0.02);
		}
		// inner shadow along the rock, and the rock's drop shadow down and to the right
		float near = texture(mask_l, cuv).r;
		float drop = texture(mask_l, cuv - vec2(4.0, 6.0) / board).r;
		c *= 1.0 - clamp(near * 0.75 + drop * 0.45, 0.0, 0.8);
	}
	COLOR = vec4(c, 1.0);
}
