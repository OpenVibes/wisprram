#!/usr/bin/env bash
# Build the macOS arm64 .dmg on the Mac. Output: client/release/<version>/WisprRam-<version>-arm64.dmg
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/client"

[ -d node_modules ] || npm ci
# Icons are committed; regenerate with: python3 build/make-icons.py [Figtree.ttf InstrumentSerif-Italic.ttf] (needs Pillow and numpy)

npx electron-vite build
npx electron-builder --mac --arm64 --publish never

VERSION="$(node -p "require('./package.json').version")"
DMG="$(ls -1 "release/$VERSION"/*.dmg | head -n1)"
echo
echo "DMG: $ROOT/client/$DMG"
ls -lh "$DMG"
