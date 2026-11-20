#!/usr/bin/env bash
# Publish one client's built files and reload the running web edge.
# Usage: publish-client.sh <deploy-path> <widget|admin> <commit>
#        publish-client.sh <deploy-path> <widget|admin> <legacy-commit> --seed-legacy <web-commit>
# The regular mode reads a tar stream with the contents of the build's dist.
# The first web rollout invokes --seed-legacy under its existing deploy locks.
set -euo pipefail

deploy_path=$1 component=$2 commit=$3 mode=${4:-} source_commit=${5:-$3}
case "$component:$mode" in
  widget:|admin:|widget:--seed-legacy|admin:--seed-legacy) ;;
  *) echo 'invalid client publication target' >&2; exit 1 ;;
esac
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || { echo 'invalid publication commit' >&2; exit 1; }
[[ "$source_commit" =~ ^[a-f0-9]{40}$ ]] || { echo 'invalid archive helper commit' >&2; exit 1; }
cd "$deploy_path"
umask 022

if [ -z "$mode" ]; then
  mkdir -p deploy-backups/ci "$HOME/.cache/voiceroom"
  exec 9>deploy-backups/ci/.lock
  flock 9
  exec 8>"$HOME/.cache/voiceroom/deploy.lock"
  flock 8
fi

edge=$(docker compose ps --quiet caddy)
root="$PWD/static/$component"
if [ "$mode" = --seed-legacy ]; then
  if [ -z "$edge" ] || [ -L "$root/current" ] ||
    docker exec "$edge" test -f /etc/caddy/empty-client-csp.caddy; then
    exit 0
  fi
else
  if [ -z "$edge" ] || ! docker exec "$edge" test -f /etc/caddy/empty-client-csp.caddy; then
    echo 'publish the first split web edge release before deploying this client' >&2
    exit 1
  fi
fi

mkdir -p "$root/releases"
staging=$(mktemp -d "$root/.publish.XXXXXXXX")
trap 'rm -rf -- "$staging"' EXIT
mkdir "$staging/dist"
# The deploy host's Compose checkout follows API releases independently.
if ! git cat-file -e "$source_commit^{commit}"; then
  git fetch --quiet --prune origin
fi
git show "$source_commit:config/caddy/archive-assets.sh" > "$staging/archive-assets.sh"
if [ "$component" = widget ]; then
  git show "$source_commit:config/caddy/archive-voice-assets.sh" > "$staging/archive-voice-assets.sh"
  entry=embed/v1/index.html
  chunks=_app/immutable
else
  entry=index.html
  chunks=assets
fi

if [ "$mode" = --seed-legacy ]; then
  if [ "$component" = widget ]; then
    for file in embed widget rnnoise audio-gate.worklet.js desktop-audio-source.worklet.js; do
      docker cp "$edge:/srv/web/$file" "$staging/dist/$file"
    done
    # Includes the chunk tree of the current widget and dependencies of
    # already distributed loaders that predate the widget-specific subtree.
    mkdir "$staging/dist/_app"
    docker cp "$edge:/srv/archive/_app/immutable" "$staging/dist/_app/immutable"
  else
    docker cp "$edge:/srv/admin/." "$staging/dist/"
  fi
  docker cp "$edge:/etc/caddy/$component-csp.caddy" "$staging/dist/csp.caddy"
else
  tar -xf - --no-same-owner --no-same-permissions -C "$staging/dist"
fi

if [ ! -s "$staging/dist/$entry" ] || [ ! -s "$staging/dist/csp.caddy" ] ||
  [ ! -d "$staging/dist/$chunks" ] ||
  [ -n "$(find "$staging/dist" ! -type d ! -type f -print -quit)" ]; then
  echo 'client artifact must contain a nonempty entry and CSP, a chunk tree and regular files' >&2
  exit 1
fi
if [ "$component" = widget ]; then
  test -s "$staging/dist/widget/v1/loader.js"
  sh "$staging/archive-voice-assets.sh" "$staging/dist" "$root/archive"
fi
chmod -R u+rwX,go+rX,go-w "$staging/dist"
sh "$staging/archive-assets.sh" "$staging/dist/$chunks" "$root/archive/$chunks" forever

# The checkout may already be at the commit tagged for the first split
# releases, even while Caddy still serves the legacy client's bytes.
release_id=$commit
if [ "$mode" = --seed-legacy ]; then release_id="legacy-$commit"; fi
release="$root/releases/$release_id"
if [ ! -e "$release" ]; then
  mv -T "$staging/dist" "$release"
fi
test -s "$release/$entry"
previous=$(readlink "$root/current" || true)
ln -s "releases/$release_id" "$staging/current"
mv -Tf "$staging/current" "$root/current"

if [ -z "$mode" ] && ! docker exec "$edge" voiceroom-prepare-web reload; then
  if [ -n "$previous" ]; then
    ln -s "$previous" "$staging/current"
    mv -Tf "$staging/current" "$root/current"
  else
    rm -f "$root/current"
  fi
  # Caddy keeps the previous config on validation failure. Reapply it as
  # well in case the config was accepted but the deploy process lost the reply.
  docker exec "$edge" voiceroom-prepare-web reload || true
  exit 1
fi
printf 'published %s %s\n' "$component" "$commit"
