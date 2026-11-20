#!/bin/sh
# Enables the TURN/TLS route only when the deployment asks for it, so an
# unchanged .env keeps the exact edge it had before.
set -eu

mkdir -p /etc/caddy/turn.d
rm -f /etc/caddy/turn.d/*
if [ "${TURN_ENABLED:-false}" = "true" ]; then
  if [ -z "${TURN_DOMAIN:-}" ]; then
    echo "TURN_ENABLED=true requires TURN_DOMAIN" >&2
    exit 1
  fi
  cp /etc/caddy/turn-available/turn.options /etc/caddy/turn-available/turn.site /etc/caddy/turn.d/
fi

# The main web image passes a launcher that resolves its static releases.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
