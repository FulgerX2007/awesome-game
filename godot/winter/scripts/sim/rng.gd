class_name WinterRng
extends RefCounted
## The number helpers that make the GDScript rules play bit for bit like web/winter/core.js:
## mulberry32 over uint32 (Math.imul and >>> emulated on 64-bit ints) and Math.hypot as V8 computes it.

const MASK := 0xFFFFFFFF


## Math.imul(a, b) >>> 0 for uint32 a, b: the low 32 bits of the product, without overflowing int64.
static func imul(a: int, b: int) -> int:
	a &= MASK
	b &= MASK
	var lo := (a * (b & 0xFFFF)) & MASK
	var hi := ((a * (b >> 16)) & 0xFFFF) << 16
	return (lo + hi) & MASK


## One mulberry32 step: the new state and a float in [0, 1). → [state, value]
static func next(state: int) -> Array:
	state = (state + 0x6D2B79F5) & MASK
	var t := state
	t = imul(t ^ (t >> 15), t | 1)
	t = (t ^ ((t + imul(t ^ (t >> 7), t | 61)) & MASK)) & MASK
	return [state, float((t ^ (t >> 14)) & MASK) / 4294967296.0]


## Math.hypot(x, y) exactly as V8 does it: scale by the larger magnitude, add the squares with Kahan
## compensation, then sqrt × max. (sqrt(x*x + y*y) differs from it in the last bit now and then.)
static func hypot(x: float, y: float) -> float:
	var ax := absf(x)
	var ay := absf(y)
	if is_inf(ax) or is_inf(ay):
		return INF
	var m := maxf(ax, ay)
	if is_nan(ax) or is_nan(ay):
		return NAN
	if m == 0.0:
		return 0.0
	var s := 0.0
	var comp := 0.0
	for v in [ax, ay]:
		var n: float = v / m
		var summand := n * n - comp
		var pre := s + summand
		comp = (pre - s) - summand
		s = pre
	return sqrt(s) * m
