class_name Settings
extends RefCounted
## Player preferences (language, sound) in user://settings.cfg. In the browser the language follows the
## site like every game there: ?lang=, then localStorage "lang", then the browser's languages.

const PATH := "user://settings.cfg"
static var _cfg: ConfigFile


static func _c() -> ConfigFile:
	if _cfg == null:
		_cfg = ConfigFile.new()
		_cfg.load(PATH)
	return _cfg


static func get_value(key: String, def: Variant) -> Variant:
	return _c().get_value("settings", key, def)


static func set_value(key: String, v: Variant) -> void:
	_c().set_value("settings", key, v)
	_c().save(PATH)


static func on_web() -> bool:
	return OS.has_feature("web")


static func detect_lang() -> String:
	if on_web():
		var q = JavaScriptBridge.eval("new URLSearchParams(location.search).get('lang')", true)
		if q is String and q in ["ru", "ro"]:
			return q
		var ls = JavaScriptBridge.eval("(() => { try { return localStorage.getItem('lang'); } catch (e) { return null; } })()", true)
		if ls is String and ls in ["ru", "ro"]:
			return ls
	var saved := str(get_value("lang", ""))
	if saved in ["ru", "ro"]:
		return saved
	var loc := OS.get_locale_language()
	return "ro" if loc in ["ro", "mo"] else "ru"


static func set_lang(lang: String) -> void:
	set_value("lang", lang)
	TranslationServer.set_locale(lang)
	if on_web():
		JavaScriptBridge.eval("(() => { try { localStorage.setItem('lang', %s); } catch (e) {} })()" % JSON.stringify(lang), true)


## The web version's save (same site, localStorage), so progress moves over to this version.
static func legacy_web_save() -> String:
	if not on_web():
		return ""
	var v = JavaScriptBridge.eval("(() => { try { return localStorage.getItem('rust-dawn.save'); } catch (e) { return null; } })()", true)
	return v if v is String else ""
