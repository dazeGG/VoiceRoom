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

mkdir -p /etc/caddy/domains.d
rm -f /etc/caddy/domains.d/app.caddy /etc/caddy/domains.d/docs.caddy
if [ -n "${APP_DOMAIN:-}" ]; then
  cp /etc/caddy/domains-available/app.caddy /etc/caddy/domains.d/app.caddy
fi
if [ -n "${DOCS_DOMAIN:-}" ]; then
  cp /etc/caddy/domains-available/docs.caddy /etc/caddy/domains.d/docs.caddy
fi

voiceroom-archive-assets

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
