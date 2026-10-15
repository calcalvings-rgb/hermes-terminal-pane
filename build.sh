#!/usr/bin/env bash
# Build the Terminal+ desktop plugin into the app's disk door.
#
#   bash ~/workspace/hermes-terminal-pane/build.sh
#
# Env overrides: APP (app checkout), DEST (installed plugin.js).
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/plugin.tsx"
APP="${APP:-/mnt/c/hs-src/apps/desktop}"
DEST="${DEST:-/mnt/c/Users/calvi/AppData/Local/hermes/desktop-plugins/terminal-pane/plugin.js}"
SCRATCH="$APP/.tp-build"

# The entry must live inside the app tree so esbuild resolves @xterm/* from the
# app's node_modules; esbuild itself is the WSL build (run from /tmp, which has
# no local esbuild to shadow it).
mkdir -p "$SCRATCH" "$(dirname "$DEST")"
cp "$SRC" "$SCRATCH/plugin.tsx"

( cd /tmp && npx --yes esbuild "$SCRATCH/plugin.tsx" \
    --bundle --format=esm --platform=browser --target=es2022 \
    --jsx=automatic --loader:.css=text \
    --external:@hermes/plugin-sdk \
    --external:react \
    --external:react/jsx-runtime \
    --external:react/jsx-dev-runtime \
    --outfile="$DEST" )

rm -rf "$SCRATCH"

echo
echo "built: $DEST ($(du -h "$DEST" | cut -f1))"
echo "--- imports (must be allowlisted only) ---"
grep -nE '^(import|export)' "$DEST" || true
