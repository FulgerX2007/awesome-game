extends Node
## Autoload SaveManager: reads and writes the save. It owns no game state; it collects ProgressManager and
## MathChallengeManager into one small JSON document and hands it back to them on load.
## Desktop and tests: user://mathmagic_save.json. Browser: localStorage["mathmagic.save"].

const VERSION := 1
const WEB_KEY := "mathmagic.save"

var path := "user://mathmagic_save.json"
var last_error := ""        # why the last load fell back to defaults ("" when it did not)
var _pending := false


func _ready() -> void:
	load_game()
	ProgressManager.progress_changed.connect(request_save)
	MathChallengeManager.learning_changed.connect(request_save)


## Saves once at the end of the frame, however many things changed during it.
func request_save() -> void:
	if not _pending:
		_pending = true
		save_game.call_deferred()


func save_game() -> bool:
	_pending = false
	var text := JSON.stringify(snapshot())
	if OS.has_feature("web"):
		JavaScriptBridge.eval("(() => { try { localStorage.setItem(%s, %s); } catch (e) {} })()" % [JSON.stringify(WEB_KEY), JSON.stringify(text)], true)
		return true
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		push_warning("MathMagic: cannot write the save: %s" % error_string(FileAccess.get_open_error()))
		return false
	f.store_string(text)
	f.close()
	return true


func snapshot() -> Dictionary:
	return {version = VERSION, progress = ProgressManager.to_dict(), learning = MathChallengeManager.to_dict()}


func load_game() -> void:
	var data := parse(_read())
	ProgressManager.from_dict(data.get("progress"))
	MathChallengeManager.from_dict(data.get("learning"))


## The save text as a dictionary, or {} (defaults) when it is missing, broken or from a newer version.
func parse(text: String) -> Dictionary:
	last_error = ""
	if text.strip_edges().is_empty():
		last_error = "missing"
		return {}
	var json := JSON.new()
	var d = json.data if json.parse(text) == OK else null
	if not d is Dictionary:
		last_error = "invalid"
		push_warning("MathMagic: the save is not valid JSON; starting fresh")
		return {}
	var v = d.get("version")
	if not (v is int or v is float) or int(v) > VERSION or int(v) < 1:
		last_error = "version"
		push_warning("MathMagic: unknown save version; starting fresh")
		return {}
	return d


func _read() -> String:
	if OS.has_feature("web"):
		var v = JavaScriptBridge.eval("(() => { try { return localStorage.getItem(%s); } catch (e) { return null; } })()" % JSON.stringify(WEB_KEY), true)
		return v if v is String else ""
	if not FileAccess.file_exists(path):
		return ""
	return FileAccess.get_file_as_string(path)


## Forget everything (Settings > Start over). Settings themselves are kept.
func reset_progress() -> void:
	var keep := ProgressManager.settings.duplicate()
	ProgressManager.reset()
	ProgressManager.settings = keep
	MathChallengeManager.reset()
	save_game()
