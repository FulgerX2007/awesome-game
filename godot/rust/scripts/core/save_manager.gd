class_name SaveManager
extends RefCounted
## Saves in user:// as JSON: {"version": 2, "saved_at": unix seconds, "state": {...}}.
##   rust_dawn.json         autosave (every 10 s, on pause, when the window loses focus or closes)
##   rust_dawn.bak          the previous autosave, used when the main file is damaged
##   rust_dawn_manual.json  the manual slot ("Сохранить" / "Загрузить")
## On the desktop writes go to a .tmp file first and are then renamed, so a crash mid-write cannot eat the
## save; in the browser the file is written in place (closing it is what stores it in IndexedDB).
## Version 1 is the web game's format (localStorage "rust-dawn.save"); it is migrated on load.

const AUTO := "rust_dawn.json"
const BACKUP := "rust_dawn.bak"
const MANUAL := "rust_dawn_manual.json"
const LEGACY_KEY := "rust-dawn.save"
## In the browser the autosave is mirrored here: localStorage is written at once, while user:// reaches
## IndexedDB a moment later, which a reload or a closed tab can cut short. The newer copy wins on load.
const WEB_KEY := "rust-dawn-godot.save"

static var dir := "user://"


static func path(name: String) -> String:
	return dir.path_join(name)


static func encode(s: GameState, saved_at: float) -> String:
	return JSON.stringify({version = GameState.VERSION, saved_at = saved_at, state = s.to_dict()})


static func write(s: GameState, name := AUTO) -> bool:
	DirAccess.make_dir_recursive_absolute(dir)
	var p := path(name)
	var text := encode(s, Time.get_unix_time_from_system())
	if name == AUTO and FileAccess.file_exists(p):
		_write_file(path(BACKUP), FileAccess.get_file_as_string(p))
	if OS.has_feature("web"):
		if name == AUTO:
			JavaScriptBridge.eval("(() => { try { localStorage.setItem(%s, %s); } catch (e) {} })()" % [JSON.stringify(WEB_KEY), JSON.stringify(text)], true)
		# the browser keeps user:// in IndexedDB and syncs it when a file is closed, not on a rename
		return _write_file(p, text)
	var tmp := p + ".tmp"
	if not _write_file(tmp, text):
		return false
	return DirAccess.rename_absolute(tmp, p) == OK


static func _write_file(p: String, text: String) -> bool:
	var f := FileAccess.open(p, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(text)
	f.close()
	return true


## {status: ok | missing | corrupt | newer, state, saved_at}. On "corrupt" the backup is tried.
static func read(name := AUTO) -> Dictionary:
	var res := read_file(path(name))
	if name == AUTO and OS.has_feature("web"):
		var v = JavaScriptBridge.eval("(() => { try { return localStorage.getItem(%s); } catch (e) { return null; } })()" % JSON.stringify(WEB_KEY), true)
		if v is String and not v.is_empty():
			var mirror := decode(v)
			if mirror.status == "ok" and (res.status != "ok" or mirror.saved_at > res.saved_at):
				return mirror
	if res.status == "corrupt" and name == AUTO:
		var bak := read_file(path(BACKUP))
		if bak.status == "ok":
			bak.status = "restored"
			return bak
	return res


static func read_file(p: String) -> Dictionary:
	if not FileAccess.file_exists(p):
		return {status = "missing"}
	var text := FileAccess.get_file_as_string(p)
	return decode(text)


static func decode(text: String) -> Dictionary:
	var data = JSON.parse_string(text) if not text.is_empty() else null
	if not data is Dictionary:
		return {status = "corrupt"}
	var version := int(data.get("version", 1)) if (data.get("version") is float or data.get("version") is int) else 1
	if version > GameState.VERSION:
		return {status = "newer"}
	var raw = data.get("state")
	if not raw is Dictionary:
		return {status = "corrupt"}
	var saved_at := float(data.get("saved_at", data.get("savedAt", 0.0)))
	if version == 1:
		# the web game stores savedAt in milliseconds
		if data.has("savedAt"):
			saved_at = float(data.savedAt) / 1000.0
		raw = from_legacy(raw)
	return {status = "ok", state = GameState.from_dict(raw), saved_at = saved_at}


## The web game's state (core.js newState, v1) as a v2 dictionary.
static func from_legacy(r: Dictionary) -> Dictionary:
	var d := r.duplicate(true)
	d.auto_repair = r.get("autoRepair", true)
	var ark := int(r.get("ark", 0)) if (r.get("ark") is float or r.get("ark") is int) else 0
	d.stage = ReconstructionManager.stage_from_legacy_ark(ark)
	d.launched = bool(r.get("launched", false))
	if d.launched:
		d.stage = GameData.stages().size()
	d.zones = ["yard"]
	var stages := GameData.stages()
	for i in mini(d.stage, stages.size()):
		if stages[i].effect == "zone":
			d.zones.append(stages[i].effect_target)
	if not r.get("repair") is Dictionary:
		d.repair = {}
	d.erase("ark")
	d.erase("autoRepair")
	return d


static func delete_all() -> void:
	for n in [AUTO, BACKUP, MANUAL]:
		if FileAccess.file_exists(path(n)):
			DirAccess.remove_absolute(path(n))


static func exists(name: String) -> bool:
	return FileAccess.file_exists(path(name))
