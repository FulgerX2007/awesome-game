#!/usr/bin/env bash
# Exports a Godot project for the browser and splits it into the game and the shared engine:
#   web/<game>/index.html, index.pck   - the page and the game itself (a few MB)
#   web/godot/engine.js, engine.wasm.gz, engine.audio*.worklet.js - the engine, one copy for every Godot game
# The pages load the engine from ../godot/ (see the shell.html of each project), so the browser caches it once
# and the Go binary embeds it once. engine.wasm (~40 MB) is stored gzipped; the server sends it compressed.
#   GODOT=/path/to/godot-4.7.2 tools/godot-web/export.sh godot/deep web/deep-godot
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GODOT="${GODOT:-godot}"
PROJECT="$ROOT/$1"
OUT="$ROOT/$2"
ENGINE="$ROOT/web/godot"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

"$GODOT" --headless --path "$PROJECT" --import >/dev/null 2>&1 || true
"$GODOT" --headless --path "$PROJECT" --export-release Web "$TMP/index.html" 2>&1 | grep -E "ERROR|SCRIPT ERROR" || true
test -s "$TMP/index.pck" || { echo "export of $1 failed" >&2; exit 1; }
grep -q '../godot/engine.js' "$TMP/index.html" || { echo "$1/shell.html must load ../godot/engine.js" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT" "$ENGINE"
cp "$TMP/index.html" "$TMP/index.pck" "$OUT/"
cp "$TMP/index.js" "$ENGINE/engine.js"
cp "$TMP/index.audio.worklet.js" "$ENGINE/engine.audio.worklet.js"
cp "$TMP/index.audio.position.worklet.js" "$ENGINE/engine.audio.position.worklet.js"
# -n leaves the timestamp out, so the same engine gives the same bytes
gzip -9 -n -c "$TMP/index.wasm" > "$ENGINE/engine.wasm.gz"
ls -la "$OUT" "$ENGINE"
