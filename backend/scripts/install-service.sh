#!/usr/bin/env bash
# Install (or update) and start the systemd --user unit for this checkout.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd is not available on this system; start the server with: $HERE/scripts/run.sh serve" >&2
  exit 1
fi

# Escape the checkout path for sed ("&", "|", "\") and for systemd ("%" is a specifier).
esc="${HERE//%/%%}"
esc="$(printf '%s' "$esc" | sed -e 's/[\\&|]/\\&/g')"

# Carry WISPRRAM_* settings exported in this shell (e.g. a custom port) over to the service, once.
ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/wisprram/server.env"
if [ ! -e "$ENV_FILE" ] && [ -n "$(env | grep '^WISPRRAM_' || true)" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  env | grep '^WISPRRAM_' | grep -v '^WISPRRAM_VENV=' > "$ENV_FILE" || true
  echo "Saved your WISPRRAM_* settings to $ENV_FILE (edit it, then: systemctl --user restart wisprram)"
fi

mkdir -p "$UNIT_DIR"
sed "s|@BACKEND_DIR@|$esc|g" "$HERE/systemd/wisprram.service" > "$UNIT_DIR/wisprram.service"
systemctl --user daemon-reload
systemctl --user enable wisprram.service
systemctl --user restart wisprram.service   # restart (not just start) so re-running upgrades a live service
sleep 1
systemctl --user --no-pager status wisprram.service | head -12 || true
echo
echo "Logs:   journalctl --user -u wisprram -f"
echo "Pair:   $HERE/scripts/run.sh pair"
echo "Tip:    run 'sudo loginctl enable-linger \$USER' once so the server keeps running when you are logged out."
