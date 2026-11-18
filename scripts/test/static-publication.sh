#!/usr/bin/env bash
set -euo pipefail

publisher="$(cd "$(dirname "$0")/../cd" && pwd)/publish-static.sh"
checkout=$(mktemp -d)
trap 'rm -rf -- "$checkout"' EXIT
mkdir "$checkout/input"
first=1111111111111111111111111111111111111111
second=2222222222222222222222222222222222222222

publish() {
  tar -cf - -C "$checkout/input" . | bash "$publisher" "$checkout" "$@"
}

printf 'old site\n' > "$checkout/input/index.html"
publish site "$first"
[ "$(cat "$checkout/static/site/current/index.html")" = 'old site' ]
printf 'new docs\n' > "$checkout/input/index.html"
publish docs "$first"
[ "$(cat "$checkout/static/docs/current/index.html")" = 'new docs' ]
[ "$(cat "$checkout/static/site/current/index.html")" = 'old site' ]

printf 'new site\n' > "$checkout/input/index.html"
publish site "$second" --if-empty
[ "$(cat "$checkout/static/site/current/index.html")" = 'old site' ]

ln -s index.html "$checkout/input/link.html"
if publish site "$second"; then
  echo 'publication unexpectedly accepted a symlink' >&2
  exit 1
fi
[ "$(cat "$checkout/static/site/current/index.html")" = 'old site' ]
rm "$checkout/input/link.html"
publish site "$second"
[ "$(cat "$checkout/static/site/current/index.html")" = 'new site' ]
[ "$(cat "$checkout/static/site/releases/$first/index.html")" = 'old site' ]
[ "$(cat "$checkout/static/docs/current/index.html")" = 'new docs' ]
printf 'Static publication verified.\n'
