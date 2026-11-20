#!/bin/sh
set -eu

command=${1:-run}
case "$command" in
  run)
    mkdir -p /etc/caddy/domains.d
    rm -f /etc/caddy/domains.d/app.caddy /etc/caddy/domains.d/docs.caddy
    if [ -n "${APP_DOMAIN:-}" ]; then
      cp /etc/caddy/domains-available/app.caddy /etc/caddy/domains.d/app.caddy
    fi
    if [ -n "${DOCS_DOMAIN:-}" ]; then
      cp /etc/caddy/domains-available/docs.caddy /etc/caddy/domains.d/docs.caddy
    fi
    voiceroom-archive-assets
    voiceroom-archive-voice-assets /srv/web /srv/archive
    ;;
  reload|validate) ;;
  *) echo "usage: voiceroom-prepare-web [reload|validate]" >&2; exit 1 ;;
esac

# Resolve the release directories once. A Caddy config keeps serving its own
# immutable HTML and CSP together while the host stages and reloads another.
WIDGET_RELEASE_DIR=/srv/empty
ADMIN_RELEASE_DIR=/srv/empty
WIDGET_POLICY=/etc/caddy/empty-client-csp.caddy
ADMIN_POLICY=/etc/caddy/empty-client-csp.caddy
if [ -L /srv/static/widget/current ]; then
  WIDGET_RELEASE_DIR=$(readlink -f /srv/static/widget/current)
  WIDGET_POLICY=$WIDGET_RELEASE_DIR/csp.caddy
fi
if [ -L /srv/static/admin/current ]; then
  ADMIN_RELEASE_DIR=$(readlink -f /srv/static/admin/current)
  ADMIN_POLICY=$ADMIN_RELEASE_DIR/csp.caddy
fi
export WIDGET_RELEASE_DIR ADMIN_RELEASE_DIR WIDGET_POLICY ADMIN_POLICY
exec caddy "$command" --config /etc/caddy/Caddyfile --adapter caddyfile
