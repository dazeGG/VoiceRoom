#!/bin/sh
set -eu

mkdir -p /etc/caddy/domains.d
rm -f /etc/caddy/domains.d/app.caddy /etc/caddy/domains.d/docs.caddy
if [ -n "${APP_DOMAIN:-}" ]; then
  cp /etc/caddy/domains-available/app.caddy /etc/caddy/domains.d/app.caddy
fi
if [ -n "${DOCS_DOMAIN:-}" ]; then
  cp /etc/caddy/domains-available/docs.caddy /etc/caddy/domains.d/docs.caddy
fi

voiceroom-archive-assets
