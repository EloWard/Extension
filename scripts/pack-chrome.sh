#!/usr/bin/env bash
set -euo pipefail

# Always run from the script's directory
cd "$(dirname "$0")"

echo "[pack-chrome] Generating Chrome manifest..."
node build-manifest.js chrome

ZIP_NAME="EloWardApp-chrome.zip"
APP_ROOT="$(cd .. && pwd)"

echo "[pack-chrome] Removing previous zip (if any)..."
rm -f "$ZIP_NAME"

# Prevent macOS from adding resource forks / __MACOSX
export COPYFILE_DISABLE=1

echo "[pack-chrome] Creating clean zip from app root..."
pushd "$APP_ROOT" >/dev/null
zip -r -X -9 "${OLDPWD}/${ZIP_NAME}" . \
  -x "__MACOSX/*" \
  -x "*.DS_Store" \
  -x "*.AppleDouble" \
  -x "Thumbs.db" \
  -x "*.zip" \
  -x ".*" \
  -x ".git" \
  -x ".git/*" \
  -x ".github" \
  -x ".github/*" \
  -x "scripts/*" \
  -x "scripts/*/*" \
  -x "node_modules" \
  -x "node_modules/*" \
  -x "manifest-firefox.json" \
  -x "manifest-chrome.json"
popd >/dev/null

echo "[pack-chrome] Done → $ZIP_NAME"


