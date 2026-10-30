class_name DeepStore
extends RefCounted
## Saves. In the browser they live in localStorage under the same keys as web/deep (deep.save,
## deep.atlas, deep.best, deep.muted, lang), so both versions of the game share the atlas and the record.
## Elsewhere (the editor, tests) they go to user://deep.cfg.

const CFG := "user://deep.cfg"
static var _cfg: ConfigFile


static func on_web() -> bool:
	return OS.has_feature("web")


static func get_item(key: String) -> String:
	if on_web():
		var v = JavaScriptBridge.eval("(() => { try { return localStorage.getItem(%s); } catch (e) { return null; } })()" % JSON.stringify(key), true)
		return v if v is String else ""
	_load_cfg()
	return _cfg.get_value("store", key, "")


static func set_item(key: String, value: String) -> void:
	if on_web():
		JavaScriptBridge.eval("(() => { try { localStorage.setItem(%s, %s); } catch (e) {} })()" % [JSON.stringify(key), JSON.stringify(value)], true)
		return
	_load_cfg()
	_cfg.set_value("store", key, value)
	_cfg.save(CFG)


static func _load_cfg() -> void:
	if _cfg == null:
		_cfg = ConfigFile.new()
		_cfg.load(CFG)


## The language the site uses: ?lang= in the address, then the saved choice, then the browser's languages.
static func detect_lang() -> String:
	if on_web():
		var q = JavaScriptBridge.eval("new URLSearchParams(location.search).get('lang')", true)
		if q is String and q in ["ru", "ro"]:
			set_item("lang", q)
			return q
	var saved := get_item("lang")
	if saved in ["ru", "ro"]:
		return saved
	var langs: Array = []
	if on_web():
		var nav = JavaScriptBridge.eval("(navigator.languages || [navigator.language]).join(',')", true)
		if nav is String:
			langs = nav.split(",")
	else:
		langs = [OS.get_locale()]
	for l in langs:
		var c := String(l).substr(0, 2).to_lower()
		if c == "ro" or c == "mo":
			return "ro"
		if c == "ru":
			return "ru"
	return "ru"


## The screen's pixel density: the UI is laid out in CSS pixels, like the web version.
static func pixel_ratio() -> float:
	if on_web():
		var r = JavaScriptBridge.eval("window.devicePixelRatio || 1", true)
		return float(r) if r != null else 1.0
	return DisplayServer.screen_get_scale()


static func prefers_reduced_motion() -> bool:
	if on_web():
		return JavaScriptBridge.eval("matchMedia('(prefers-reduced-motion: reduce)').matches", true) == true
	return false


static func touch_screen() -> bool:
	if on_web():
		return JavaScriptBridge.eval("matchMedia('(hover: none)').matches", true) == true
	return DisplayServer.is_touchscreen_available()
