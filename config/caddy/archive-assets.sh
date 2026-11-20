#!/bin/sh
# Keeps the hashed JS and CSS of earlier releases next to this one. A tab
# opened before a deploy still loads its own chunks while it runs, and Caddy
# serves hashed chunks from the archive (Caddyfile).
#
# Usage: archive-assets.sh [build-dir] [archive-dir] [retention-days|forever]
set -eu

src="${1:-/srv/web/_app/immutable}"
archive="${2:-/srv/archive/_app/immutable}"
days="${3:-${WEB_ASSET_RETENTION_DAYS:-30}}"

mkdir -p "$archive"
# Prune first, so this release's files are always there even if it was built
# longer ago than the retention.
if [ "$days" != forever ]; then
  find "$archive" -type f -mtime +"$days" -delete
  find "$archive" -mindepth 1 -type d -empty -delete
fi
# Copy only files the archive lacks: the archived ones may be served right now,
# and their names are content hashes. `cp -n` is not portable (GNU warns, and
# some coreutils versions fail when they skip a file).
(cd "$src" && find . -type f) | while IFS= read -r file; do
  [ -e "$archive/$file" ] && continue
  mkdir -p "$archive/$(dirname "$file")"
  cp -p "$src/$file" "$archive/$file"
done
