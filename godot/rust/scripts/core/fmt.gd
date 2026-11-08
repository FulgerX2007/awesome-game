class_name Fmt
extends RefCounted
## Numbers and durations as the web game shows them: whole numbers under 10 000, then "12,3 тыс.",
## "4,5 млн"; rates with one decimal and a sign. Decimal comma in both languages.


static func _dec(v: float) -> String:
	var s := "%.1f" % v
	if s.ends_with(".0"):
		s = s.substr(0, s.length() - 2)
	return s.replace(".", ",")


static func num(n: float) -> String:
	var a := absf(n)
	var sign := "−" if n < 0.0 else ""
	if a < 10000.0:
		return sign + str(int(floorf(a)))
	if a < 1e6:
		return sign + TranslationServer.translate("{v} тыс.").format({v = _dec(a / 1e3)})
	if a < 1e9:
		return sign + TranslationServer.translate("{v} млн").format({v = _dec(a / 1e6)})
	return sign + TranslationServer.translate("{v} млрд").format({v = _dec(a / 1e9)})


## "+1,5/с", "" for (almost) nothing.
static func rate(n: float) -> String:
	if absf(n) < 0.05:
		return ""
	var v := _dec(absf(n)) if absf(n) < 10.0 else num(absf(n))
	return TranslationServer.translate("{s}{v}/с").format({s = "−" if n < 0.0 else "+", v = v})


static func dec(n: float) -> String:
	return _dec(n)


static func duration(sec: float) -> String:
	var h := int(sec / 3600.0)
	var m := int(fmod(sec, 3600.0) / 60.0)
	if h > 0:
		return TranslationServer.translate("{h} ч {m} мин").format({h = h, m = m})
	if m > 0:
		return TranslationServer.translate("{m} мин").format({m = m})
	return TranslationServer.translate("{s} с").format({s = int(sec)})


## Russian plural forms "one|few|many"; Romanian "one|few|many" with its own rule (1 / 0, 2–19 / 20+).
static func plural(n: int, forms_key: String) -> String:
	var forms := TranslationServer.translate(forms_key).split("|")
	if forms.size() < 3:
		return forms[0]
	if TranslationServer.get_locale().begins_with("ro"):
		if n == 1:
			return forms[0]
		var r := n % 100
		return forms[1] if n == 0 or (r >= 1 and r <= 19) else forms[2]
	var m10 := n % 10
	var m100 := n % 100
	if m10 == 1 and m100 != 11:
		return forms[0]
	if m10 >= 2 and m10 <= 4 and (m100 < 12 or m100 > 14):
		return forms[1]
	return forms[2]
