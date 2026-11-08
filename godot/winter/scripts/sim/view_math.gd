class_name WinterViewMath
extends RefCounted
## The pure helpers of web/winter/view.js the Godot view needs, over the same state: the clock, how dark the
## night is, the aurora, the lights that burn, and markers on the screen edge. No nodes, no rendering.


## "14:20": the hour of the day on a 6:00–24:00 clock (light from 6 to 22, night from 22 to 6).
static func clock(g: Dictionary) -> String:
	var t := WinterSim.time_of_day(g)
	var minutes: float
	if t < WinterSim.NIGHT_AT:
		minutes = 6 * 60 + (t / WinterSim.NIGHT_AT) * 16 * 60
	else:
		minutes = 22 * 60 + ((t - WinterSim.NIGHT_AT) / (WinterSim.DAY - WinterSim.NIGHT_AT)) * 8 * 60
	var m := floori(minutes) % (24 * 60)
	return "%02d:%02d" % [m / 60, m % 60]


## How dark the night is (0 by day, up to 0.82 at midnight), fading in over 10 s and out over the last 8 s.
static func darkness(g: Dictionary) -> float:
	var t := WinterSim.time_of_day(g)
	if t < WinterSim.NIGHT_AT - 10:
		return 0.0
	var k: float
	if t < WinterSim.NIGHT_AT:
		k = (t - (WinterSim.NIGHT_AT - 10)) / 10.0
	elif t > WinterSim.DAY - 8:
		k = (WinterSim.DAY - t) / 8.0
	else:
		k = 1.0
	return 0.82 * clampf(k, 0.0, 1.0)


## The aurora on an «aurora» night: 0 by day, rising over 10 s after nightfall, fading over the last 8 s to dawn.
static func aurora(g: Dictionary) -> float:
	if g.event == null or g.event.id != "aurora" or not WinterSim.is_night(g):
		return 0.0
	var t := WinterSim.time_of_day(g)
	return clampf(minf((t - WinterSim.NIGHT_AT) / 10.0, (WinterSim.DAY - t) / 8.0), 0.0, 1.0)


## The lights that burn now: [{x, y, r, kind}] in tiles. kind: "fire" | "stove" | "torch" | "lantern".
static func lights(g: Dictionary) -> Array:
	var out := []
	var D := WinterSim.D
	if WinterSim.fire_on(g):
		out.append({x = WinterSim.SPOT.fire.x + 0.5, y = WinterSim.SPOT.fire.y + 0.5, r = D.FIRE.radius + 0.5, kind = "fire"})
	if WinterSim.stove_on(g):
		out.append({x = WinterSim.HUT.x + 1.5, y = WinterSim.HUT.y + 0.5, r = 3.0, kind = "stove"})
	for t in g.torches:
		out.append({x = t.x + 0.5, y = t.y + 0.5, r = float(D.TORCH.radius), kind = "torch"})
	# the hero's lantern, at night while he is up
	if g.gear.get("lantern", false) and WinterSim.is_night(g) and not g.hero.sleeping:
		out.append({x = g.hero.x, y = g.hero.y, r = D.LANTERN.radius + 0.5, kind = "lantern"})
	return out


## A marker on the screen edge pointing at a point outside the view, or null when it is on screen.
## view: the visible rectangle in screen pixels; p: the point in the same pixels. → {x, y, angle}
static func edge_marker(view_size_x: float, view_size_y: float, px: float, py: float, pad := 14.0):
	if px >= 0 and py >= 0 and px <= view_size_x and py <= view_size_y:
		return null
	var cx := view_size_x / 2.0
	var cy := view_size_y / 2.0
	var dx := px - cx
	var dy := py - cy
	var k := minf((view_size_x / 2.0 - pad) / maxf(1e-9, absf(dx)), (view_size_y / 2.0 - pad) / maxf(1e-9, absf(dy)))
	return {x = cx + dx * k, y = cy + dy * k, angle = atan2(dy, dx)}
