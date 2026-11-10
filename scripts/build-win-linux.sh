#!/usr/bin/env bash
# Build the Windows NSIS .exe and the Linux .deb + AppImage locally, in Docker.
#   scripts/build-win-linux.sh
# Needs Docker and ~3 GB of disk for the image and caches. Output: client/release/<version>/
# (CI does the same natively on GitHub runners: see .github/workflows/release.yml.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${WR_BUILDER_IMAGE:-electronuserland/builder:wine}"
UID_GID="$(id -u):$(id -g)"

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }

# Electron / electron-builder downloads are cached in a named volume between runs.
docker volume create wr-cache >/dev/null
docker run --rm -v wr-cache:/cache "$IMAGE" chown -R "$UID_GID" /cache

# The build runs as your own uid so client/release and node_modules are not root-owned. HOME lives in
# the cache volume because wine refuses to create its prefix under a root-owned HOME such as /tmp.
# node_modules is kept in the container (named volume) so it never clobbers a host install of another OS.
docker volume create wr-node-modules >/dev/null
docker run --rm -v wr-node-modules:/nm "$IMAGE" chown -R "$UID_GID" /nm

docker run --rm --user "$UID_GID" \
  -e HOME=/cache/home -e ELECTRON_CACHE=/cache/electron -e ELECTRON_BUILDER_CACHE=/cache/builder \
  -v "$ROOT/client:/project" -v wr-node-modules:/project/node_modules -v wr-cache:/cache \
  -w /project "$IMAGE" bash -euc '
    mkdir -p "$HOME"
    node -v; npm -v
    npm ci --no-audit --no-fund
    npx electron-vite build
    npx electron-builder --win --x64 --linux --x64 --publish never
    ls -lh release/*/
  '
