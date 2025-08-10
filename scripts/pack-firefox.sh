#!/usr/bin/env bash
set -euo pipefail

# Always run from the script's directory
cd "$(dirname "$0")"

echo "[pack-firefox] Generating Firefox manifest..."
node build-manifest.js firefox

ZIP_NAME="EloWardApp-firefox.zip"
APP_ROOT="$(cd .. && pwd)"

echo "[pack-firefox] Removing previous zip (if any)..."
rm -f "$ZIP_NAME"

# Prevent macOS from adding resource forks / __MACOSX
export COPYFILE_DISABLE=1

echo "[pack-firefox] Creating clean zip from app root..."
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
  -x "manifest-chrome.json" \
  -x "manifest-firefox.json"
popd >/dev/null

echo "[pack-firefox] Done → $ZIP_NAME"


