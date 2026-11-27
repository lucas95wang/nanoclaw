#!/usr/bin/env bash
#
# Learning mode: run the host in the foreground with NANOCLAW_LEARNING=1 and
# serve the learning panel. The official service (systemd / launchd) is
# stopped while this runs and started again on exit, so the two never share
# the sockets. Official starts never set NANOCLAW_LEARNING, so tracing stays
# off there.
#
#   pnpm run learn              # build if needed, then start
#   pnpm run learn -- --no-build
#
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"
export PATH="$HOME/.local/bin:$HOME/node/bin:$PATH"
PORT="${NANOCLAW_LEARNING_PORT:-7788}"
BUILD=1
for a in "$@"; do [ "$a" = "--no-build" ] && BUILD=0; done

# shellcheck source=setup/lib/install-slug.sh
source "$ROOT/setup/lib/install-slug.sh"

stop_service() {
  if [ "$(uname -s)" = "Darwin" ]; then
    launchctl unload "$HOME/Library/LaunchAgents/$(launchd_label).plist" 2>/dev/null || true
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl --user stop "$(systemd_unit)" 2>/dev/null || true
  fi
}
start_service() {
  if [ "$(uname -s)" = "Darwin" ]; then
    launchctl load "$HOME/Library/LaunchAgents/$(launchd_label).plist" 2>/dev/null || true
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl --user start "$(systemd_unit)" 2>/dev/null || true
  fi
}

if [ "$BUILD" = 1 ]; then
  echo "▸ building host (tsc)…"
  pnpm run build >/dev/null
  if [ ! -f learning/panel/dist/index.html ]; then
    echo "▸ building panel (vite)…"
    (cd learning/panel && pnpm install --silent && pnpm run build >/dev/null)
  fi
fi

# The upgrade tripwire compares the checkout to data/upgrade-state.json; the
# learning branch is our own, so stamp it (same step a deploy script runs).
pnpm exec tsx scripts/upgrade-state.ts set >/dev/null 2>&1 || true

echo "▸ wiring the panel channel to the first agent group…"
NANOCLAW_LEARNING=1 pnpm exec tsx learning/scripts/init-web-channel.ts

echo "▸ stopping the official service while learning mode runs…"
stop_service
trap 'echo; echo "▸ learning mode stopped, starting the official service again…"; start_service' EXIT

echo "▸ NanoClaw learning mode on http://127.0.0.1:${PORT}/  (Ctrl-C to stop)"
NANOCLAW_LEARNING=1 NANOCLAW_LEARNING_PORT="$PORT" node dist/index.js
