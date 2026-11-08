#!/usr/bin/env bash
# MathMagic: runs the tests and exports the game for the browser to web/mathmagic/ (the engine goes to web/godot/).
#   GODOT=/path/to/godot-4.7.2 tools/mathmagic/build.sh [--sounds]
# --sounds regenerates the sound effects and the music first (Python 3 with numpy).
# Needs Godot 4.7.2 with its web export templates.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GODOT="${GODOT:-godot}"

cd "$ROOT"
if [ "${1:-}" = "--sounds" ]; then
  python3 tools/mathmagic/sounds.py
fi
"$GODOT" --headless --path godot/mathmagic --import >/dev/null 2>&1 || true
"$GODOT" --headless --path godot/mathmagic -s res://tests/run.gd | tail -1
"$GODOT" --headless --fixed-fps 60 --path godot/mathmagic res://tests/playthrough.tscn | tail -1
tools/godot-web/export.sh godot/mathmagic web/mathmagic
