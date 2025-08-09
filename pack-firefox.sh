#!/usr/bin/env bash
set -euo pipefail

# Always run from the script's directory
cd "$(dirname "$0")"

echo "[pack-firefox] Generating Firefox manifest..."
node build-manifest.js firefox

ZIP_NAME="EloWardApp-firefox.zip"

echo "[pack-firefox] Removing previous zip (if any)..."
rm -f "$ZIP_NAME"

# Prevent macOS from adding resource forks / __MACOSX
export COPYFILE_DISABLE=1

echo "[pack-firefox] Creating clean zip for AMO..."
zip -r -X -9 "$ZIP_NAME" . \
  -x "./$ZIP_NAME" \
  -x "__MACOSX/*" \
  -x "*.DS_Store" \
  -x "*.AppleDouble" \
  -x "Thumbs.db" \
  -x "*.zip" \
  -x ".*" \
  -x ".git" \
  -x ".git/*" \
  -x ".gitignore" \
  -x ".gitattributes" \
  -x ".github" \
  -x ".github/*" \
  -x ".claude" \
  -x ".claude/*" \
  -x "node_modules" \
  -x "node_modules/*"

echo "[pack-firefox] Done → $ZIP_NAME"


