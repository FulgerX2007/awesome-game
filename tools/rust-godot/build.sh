#!/usr/bin/env bash
# Ржавый рассвет on Godot: runs the rules tests, the ark's balance and the scene smoke test, then exports the
# game to web/rust-godot/ (the engine goes to web/godot/).
#   GODOT=/path/to/godot-4.7.2 tools/rust-godot/build.sh
# Needs Godot 4.7.2 with its web export templates. Every model is built in code from primitives and every sound
# is synthesized at start, so there are no assets to bake (the only file asset is the Golos Text font, OFL).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GODOT="${GODOT:-godot}"

cd "$ROOT"
"$GODOT" --headless --path godot/rust --import >/dev/null 2>&1 || true
"$GODOT" --headless --path godot/rust -s res://tests/run.gd | tail -1
"$GODOT" --headless --path godot/rust -s res://tests/balance.gd | tail -3
out="$("$GODOT" --headless --path godot/rust -s res://tests/scenes.gd 2>&1)"
echo "$out" | grep "scenes:"
if echo "$out" | grep -q "SCRIPT ERROR"; then echo "$out" | grep -A3 "SCRIPT ERROR" >&2; exit 1; fi
tools/godot-web/export.sh godot/rust web/rust-godot
