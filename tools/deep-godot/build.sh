#!/usr/bin/env bash
# Глубина on Godot: regenerates the assets from the web version and exports the game to web/deep-godot/.
#   GODOT=/path/to/godot-4.7.2 tools/deep-godot/build.sh
# Needs Godot 4.7.2 with its web export templates, Node with Playwright (for the sprite bake) and Python 3.
# The engine goes to web/godot/, shared with the other Godot games (tools/godot-web/export.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GODOT="${GODOT:-godot}"

cd "$ROOT"
node tools/deep-godot/data.cjs
node tools/deep-godot/bake.cjs
python3 tools/deep-godot/sounds.py
"$GODOT" --headless --path godot/deep --import >/dev/null 2>&1 || true
"$GODOT" --headless --path godot/deep -s res://tests/run.gd

tools/godot-web/export.sh godot/deep web/deep-godot
