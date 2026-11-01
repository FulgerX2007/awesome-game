#!/usr/bin/env bash
# Последняя крепость on Godot: runs the rules tests, the campaign balance and the scene smoke test, then exports
# the game to web/castle-godot/ (the engine goes to web/godot/).
#   GODOT=/path/to/godot-4.7.2 tools/castle-godot/build.sh
# Needs Godot 4.7.2 with its web export templates. Everything the game shows is built in code or comes from the
# model packs in godot/castle/assets (Avramania, CC0; Low Poly Winter Pack by reodesuxz), so there is no bake step.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GODOT="${GODOT:-godot}"

cd "$ROOT"
"$GODOT" --headless --path godot/castle --import >/dev/null 2>&1 || true
"$GODOT" --headless --path godot/castle -s res://tests/run.gd | tail -1
"$GODOT" --headless --path godot/castle -s res://tests/balance.gd | tail -2
out="$("$GODOT" --headless --path godot/castle -s res://tests/scenes.gd 2>&1)"
echo "$out" | tail -1
if echo "$out" | grep -q "SCRIPT ERROR"; then echo "$out" | grep -A3 "SCRIPT ERROR" >&2; exit 1; fi
tools/godot-web/export.sh godot/castle web/castle-godot
