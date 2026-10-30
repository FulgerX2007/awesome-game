#!/usr/bin/env bash
# Глубина on Godot: regenerates the assets from the web version and exports the game to web/deep-godot/.
#   GODOT=/path/to/godot-4.7.2 tools/deep-godot/build.sh
# Needs Godot 4.7.2 with its web export templates, Node with Playwright (for the sprite bake) and Python 3.
# The engine (index.wasm, ~40 MB) is stored gzipped as index.wasm.gz: the Go server sends it compressed,
# and it only changes when Godot is upgraded. Only index.pck changes with the game.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GODOT="${GODOT:-godot}"
OUT="$ROOT/web/deep-godot"

cd "$ROOT"
node tools/deep-godot/data.cjs
node tools/deep-godot/bake.cjs
python3 tools/deep-godot/sounds.py
"$GODOT" --headless --path godot/deep --import >/dev/null 2>&1 || true
"$GODOT" --headless --path godot/deep -s res://tests/run.gd

rm -rf "$OUT"
mkdir -p "$OUT"
"$GODOT" --headless --path godot/deep --export-release Web "$OUT/index.html" 2>&1 | grep -E "ERROR|WARNING" || true
test -s "$OUT/index.pck" || { echo "export failed" >&2; exit 1; }
rm -f "$OUT/index.png" "$OUT/index.icon.png" "$OUT/index.apple-touch-icon.png"
# -n leaves the timestamp out, so the same engine gives the same bytes
gzip -9 -n "$OUT/index.wasm"
ls -la "$OUT"
