#!/bin/sh
# Keeps the hashed JS and CSS of earlier releases next to this one. A tab
# opened before a deploy still loads its own chunks while it runs, and Caddy
# serves /_app/immutable/ from the archive (Caddyfile). Files are named by
# their content hash, so a file of any release can sit beside the others.
#
# Usage: archive-assets.sh [build-dir] [archive-dir] [retention-days]
set -eu

src="${1:-/srv/web/_app/immutable}"
archive="${2:-/srv/archive/_app/immutable}"
days="${3:-${WEB_ASSET_RETENTION_DAYS:-30}}"

mkdir -p "$archive"
# Prune first, so this release's files are always there even if it was built
# longer ago than the retention.
find "$archive" -type f -mtime +"$days" -delete
find "$archive" -mindepth 1 -type d -empty -delete
cp -R -p "$src/." "$archive/"
