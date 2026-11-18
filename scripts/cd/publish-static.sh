#!/usr/bin/env bash
# Publish an already built site or docs tar stream under the Caddy bind mount.
# Usage: publish-static.sh <deploy-path> <site|docs> <commit> [--if-empty]
set -euo pipefail

deploy_path=$1
component=$2
commit=$3
mode=${4:-}
case "$component:$mode" in
  site:|docs:|site:--if-empty) ;;
  *) echo 'invalid static publication target' >&2; exit 1 ;;
esac
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || { echo 'invalid publication commit' >&2; exit 1; }

cd "$deploy_path"
umask 022
root="$PWD/static/$component"
mkdir -p "$root/releases"
exec 9>"$root/.lock"
flock 9

if [ "$mode" = --if-empty ] && [ -s "$root/current/index.html" ]; then
  cat > /dev/null
  exit 0
fi

staging=$(mktemp -d "$root/.publish.XXXXXXXX")
trap 'rm -rf -- "$staging"' EXIT
mkdir "$staging/dist"
tar -xf - --no-same-owner --no-same-permissions -C "$staging/dist"
if [ ! -s "$staging/dist/index.html" ] || [ -n "$(find "$staging/dist" ! -type d ! -type f -print -quit)" ]; then
  echo 'static artifact must contain a nonempty index.html and regular files' >&2
  exit 1
fi
# docker cp and the CI runner can supply different file modes. Caddy only
# needs read access to regular files and traversal access to directories.
chmod -R u+rwX,go+rX,go-w "$staging/dist"
release="$root/releases/$commit"
if [ ! -e "$release" ]; then
  mv -T "$staging/dist" "$release"
fi
[ -s "$release/index.html" ]
ln -s "releases/$commit" "$staging/current"
mv -Tf "$staging/current" "$root/current"
printf 'published %s %s\n' "$component" "$commit"
