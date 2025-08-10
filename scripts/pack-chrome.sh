#!/usr/bin/env bash
set -euo pipefail

# Always run from the script's directory
cd "$(dirname "$0")"

echo "[pack-chrome] Generating Chrome manifest..."
node build-manifest.js chrome

ZIP_NAME="EloWardApp-chrome.zip"

echo "[pack-chrome] Removing previous zip (if any)..."
rm -f "$ZIP_NAME"

# Prevent macOS from adding resource forks / __MACOSX
export COPYFILE_DISABLE=1

echo "[pack-chrome] Creating clean zip for Chrome Web Store..."
zip -r -X -9 "$ZIP_NAME" . \
  -x "./$ZIP_NAME" \
  -x "__MACOSX/*" \
  -x "*.DS_Store" \
  -x "*.AppleDouble" \
  -x "Thumbs.db" \
  -x "*.zip" \
  -x "pack*.sh" \
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
  -x "node_modules/*" \
  -x "manifest-firefox.json" \
  -x "manifest-chrome.json"

echo "[pack-chrome] Done → $ZIP_NAME"


