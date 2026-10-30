#!/usr/bin/env bash
# Тяни штифт on Godot: regenerates the levels, art and sounds from the web version (web/pins), checks every
# level with real physics and exports the game to web/pins-godot/ (the engine goes to web/godot/).
#   GODOT=/path/to/godot-4.7.2 tools/pins-godot/build.sh [--plan]
# --plan looks for each level's plan again (the pull order the hint shows) and rewrites data/plans.json.
# Needs Godot 4.7.2 with its web export templates and Node with Playwright (for the art bake).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GODOT="${GODOT:-godot}"

cd "$ROOT"
node tools/pins-godot/data.cjs
node tools/pins-godot/bake.cjs
"$GODOT" --headless --path godot/pins --import >/dev/null 2>&1 || true
if [ "${1:-}" = "--plan" ]; then
  "$GODOT" --headless --fixed-fps 60 --path godot/pins -s res://tests/levels.gd -- plan
fi
"$GODOT" --headless --fixed-fps 60 --path godot/pins -s res://tests/levels.gd | tail -1
tools/godot-web/export.sh godot/pins web/pins-godot
